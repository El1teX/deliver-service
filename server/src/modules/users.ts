import type { Role, User } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import type { RatingSummary, Stats } from '../catalog';
import { prisma } from '../db';
import { httpError, parse, wrap } from '../lib/http';
import { emitToUser } from '../realtime';
import { achievementsFor } from './gamification';
import { pointsSummary } from './points';

const FAST_DELIVERY_MS = 20 * 60 * 1000;

export async function ratingOf(userId: string): Promise<RatingSummary> {
  const agg = await prisma.rating.aggregate({ where: { toId: userId }, _avg: { stars: true }, _count: true });
  return { avg: agg._avg.stars === null ? null : Math.round(agg._avg.stars * 100) / 100, count: agg._count };
}

// Статистика считается из данных, а не хранится счётчиками — её нельзя «рассинхронизировать».
export async function statsOf(userId: string): Promise<Stats> {
  const [asCustomer, delivered, ratingsGiven, purchases] = await Promise.all([
    prisma.order.aggregate({ where: { customerId: userId, status: { not: 'cancelled' } }, _count: true, _max: { itemsTotal: true } }),
    prisma.order.findMany({ where: { courierId: userId, status: 'delivered' }, select: { acceptedAt: true, deliveredAt: true, courierDistanceKm: true } }),
    prisma.rating.count({ where: { fromId: userId } }),
    prisma.purchase.count({ where: { userId } }),
  ]);
  const nightOrders = await prisma.order.count({ where: { customerId: userId, isNight: true, status: { not: 'cancelled' } } });
  return {
    orders: asCustomer._count,
    maxOrder: asCustomer._max.itemsTotal ?? 0,
    nightOrders,
    ratingsGiven,
    purchases,
    delivered: delivered.length,
    distanceKm: Math.round(delivered.reduce((s, o) => s + (o.courierDistanceKm ?? 0), 0) * 100) / 100,
    fastDeliveries: delivered.filter((o) => o.acceptedAt && o.deliveredAt && +o.deliveredAt - +o.acceptedAt < FAST_DELIVERY_MS).length,
  };
}

const location = (u: Pick<User, 'lat' | 'lng' | 'address'>) => (u.lat === null || u.lng === null ? null : { lat: u.lat, lng: u.lng, address: u.address ?? undefined });

// То, что о пользователе видят другие.
export async function publicUser(user: User | null) {
  if (!user) return null;
  const [rating, stats, achievementsCount] = await Promise.all([ratingOf(user.id), statsOf(user.id), prisma.userAchievement.count({ where: { userId: user.id } })]);
  return { id: user.id, name: user.name, role: user.role, frame: user.frame, rating, achievementsCount, delivered: stats.delivered, orders: stats.orders };
}

// Полный профиль текущего пользователя.
export async function buildMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { achievements: true, purchases: { orderBy: { createdAt: 'desc' } } },
  });
  const [rating, stats, points] = await Promise.all([ratingOf(userId), statsOf(userId), pointsSummary(userId)]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isDemo: user.isDemo,
    frame: user.frame,
    createdAt: +user.createdAt,
    location: location(user),
    points: points.balance,
    totalEarned: points.totalEarned,
    perks: { freeDelivery: user.freeDeliveryPerks, discount10: user.discount10Perks },
    achievements: user.achievements.map((a) => ({ id: a.achievementId, at: +a.unlockedAt })),
    purchases: user.purchases.map((p) => ({ id: p.id, prizeId: p.prizeId, title: p.title, icon: p.icon, cost: p.cost, code: p.code, at: +p.createdAt })),
    stats,
    rating,
  };
}

export const emitMe = async (userId: string | null | undefined) => {
  if (userId) emitToUser(userId, 'me:update', await buildMe(userId));
};

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, wrap(async (req, res) => res.json(await buildMe(req.user.id))));

const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

usersRouter.patch('/me/location', requireAuth, wrap(async (req, res) => {
  const { lat, lng } = parse(locationSchema, req.body);
  await prisma.user.update({ where: { id: req.user.id }, data: { lat, lng } });
  if (req.user.role === 'courier') {
    const active = await prisma.order.findFirst({ where: { courierId: req.user.id, status: { in: ['accepted', 'picked'] } } });
    if (active) {
      emitToUser(active.customerId, 'courier:location', { orderId: active.id, lat, lng });
      emitToUser(req.user.id, 'courier:location', { orderId: active.id, lat, lng });
    }
  }
  res.json({ ok: true });
}));

usersRouter.get('/users/:id', wrap(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw httpError(404, 'Пользователь не найден');
  const reviews = await prisma.rating.findMany({ where: { toId: user.id }, include: { from: true }, orderBy: { createdAt: 'desc' }, take: 10 });
  const achievements = (await achievementsFor(user)).filter((a) => a.unlockedAt);
  res.json({
    ...(await publicUser(user)),
    reviews: reviews.map((r) => ({ fromName: r.from.name, stars: r.stars, comment: r.comment, at: +r.createdAt })),
    achievements,
  });
}));

usersRouter.get('/leaderboard', wrap(async (_req, res) => {
  const rank = async (role: Role) => {
    const users = await prisma.user.findMany({ where: { role } });
    const rows = await Promise.all(users.map(async (u) => ({ ...(await publicUser(u))!, totalEarned: (await pointsSummary(u.id)).totalEarned })));
    return rows
      .sort((a, b) => (b.rating.avg ?? 0) - (a.rating.avg ?? 0) || b.rating.count - a.rating.count || b.totalEarned - a.totalEarned)
      .slice(0, 20);
  };
  const [couriers, customers] = await Promise.all([rank('courier'), rank('customer')]);
  res.json({ couriers, customers });
}));
