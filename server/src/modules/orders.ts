import type { OrderStatus, Prisma, User } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth';
import { isUniqueViolation, prisma } from '../db';
import { httpError, parse, wrap } from '../lib/http';
import { emitToCouriers, emitToUser } from '../realtime';
import { buildRoute, type Route } from '../routing';
import { startSimulation, stopSimulation } from '../simulation';
import { checkAchievements } from './gamification';
import { announcePoints, courierReward, customerCashback, deliveryFee, grantPoints, type PointsGrant } from './points';
import { emitMe, publicUser } from './users';

const ACTIVE: OrderStatus[] = ['accepted', 'picked'];
const DEFAULT_COURIER_LOCATION = { lat: 55.7558, lng: 37.6173 };
const NUMBER_OFFSET = 1000;

const orderInclude = { store: true, items: true, ratings: true, customer: true, courier: true } satisfies Prisma.OrderInclude;
type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const ms = (d: Date | null) => (d ? +d : null);

// Формат заказа для клиента (совпадает с тем, что ждёт фронтенд).
export async function serializeOrder(o: FullOrder) {
  const rating = (fromId: string | null) => {
    const r = o.ratings.find((x) => x.fromId === fromId);
    return r ? { stars: r.stars, comment: r.comment, at: +r.createdAt } : null;
  };
  const [customer, courier] = await Promise.all([publicUser(o.customer), publicUser(o.courier)]);
  return {
    id: o.id,
    number: NUMBER_OFFSET + o.number,
    customerId: o.customerId,
    courierId: o.courierId,
    status: o.status,
    store: { id: o.store.id, name: o.store.name, address: o.store.address, icon: o.store.icon, lat: o.store.lat, lng: o.store.lng },
    items: o.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    itemsTotal: o.itemsTotal,
    discount: o.discount,
    deliveryFee: o.deliveryFee,
    total: o.total,
    perksUsed: o.perksUsed,
    dropoff: { lat: o.dropoffLat, lng: o.dropoffLng, address: o.dropoffAddress },
    comment: o.comment,
    distanceKm: o.distanceKm,
    reward: o.reward,
    route: o.route as Route | null,
    createdAt: +o.createdAt,
    acceptedAt: ms(o.acceptedAt),
    pickedAt: ms(o.pickedAt),
    deliveredAt: ms(o.deliveredAt),
    ratingByCustomer: rating(o.customerId),
    ratingByCourier: rating(o.courierId),
    customer,
    courier: courier && o.courier ? { ...courier, location: o.courier.lat === null ? null : { lat: o.courier.lat, lng: o.courier.lng } } : null,
  };
}

export const loadOrder = (id: string) => prisma.order.findUnique({ where: { id }, include: orderInclude });

async function loadOrThrow(id: string) {
  const order = await loadOrder(id);
  if (!order) throw httpError(404, 'Заказ не найден');
  return order;
}

export async function emitOrder(orderId: string) {
  const order = await loadOrder(orderId);
  if (!order) return null;
  const payload = await serializeOrder(order);
  emitToUser(order.customerId, 'order:update', payload);
  emitToUser(order.courierId, 'order:update', payload);
  return payload;
}

// ---------- Оформление ----------

export const placeOrderSchema = z.object({
  storeId: z.string({ message: 'Выберите магазин' }).min(1, 'Выберите магазин'),
  items: z
    .array(z.object({ name: z.string().trim().max(80), qty: z.coerce.number().int().min(1).max(99).catch(1), price: z.coerce.number().min(0).max(1_000_000).catch(0) }))
    .max(30)
    .transform((items) => items.filter((i) => i.name))
    .refine((items) => items.length > 0, 'Добавьте хотя бы один товар'),
  dropoff: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), address: z.string().trim().max(120).optional() }, { message: 'Укажите точку доставки на карте' }),
  comment: z.string().trim().max(300).optional().default(''),
});

export async function placeOrder(customer: User, input: z.input<typeof placeOrderSchema>) {
  const data = parse(placeOrderSchema, input);
  const store = await prisma.store.findUnique({ where: { id: data.storeId } });
  if (!store) throw httpError(400, 'Выберите магазин');

  const route = await buildRoute([store, data.dropoff]);
  const itemsTotal = Math.round(data.items.reduce((s, i) => s + i.qty * i.price, 0));
  const hour = new Date().getHours();

  const order = await prisma.$transaction(async (tx) => {
    // Бонус списываем условным UPDATE: два параллельных заказа не потратят один бонус дважды.
    const usePerk = async (field: 'freeDeliveryPerks' | 'discount10Perks') =>
      (await tx.user.updateMany({ where: { id: customer.id, [field]: { gt: 0 } }, data: { [field]: { decrement: 1 } } })).count > 0;
    const free = await usePerk('freeDeliveryPerks');
    const discounted = await usePerk('discount10Perks');
    const fee = free ? 0 : deliveryFee(route.distanceKm);
    const discount = discounted ? Math.round(itemsTotal * 0.1) : 0;

    return tx.order.create({
      data: {
        customerId: customer.id,
        storeId: store.id,
        itemsTotal,
        discount,
        deliveryFee: fee,
        total: itemsTotal - discount + fee,
        perksUsed: [free && 'Бесплатная доставка', discounted && 'Скидка 10%'].filter((x): x is string => Boolean(x)),
        dropoffLat: data.dropoff.lat,
        dropoffLng: data.dropoff.lng,
        dropoffAddress: data.dropoff.address || 'Точка на карте',
        comment: data.comment,
        distanceKm: route.distanceKm,
        reward: courierReward(route.distanceKm),
        isNight: hour >= 22 || hour < 6,
        items: { create: data.items },
        events: { create: { status: 'new', actorId: customer.id } },
      },
    });
  });

  await checkAchievements(customer.id);
  await emitMe(customer.id);
  emitToCouriers('orders:changed');
  return loadOrThrow(order.id);
}

// ---------- Взятие заказа ----------

export async function acceptOrder(courier: User, orderId: string) {
  const order = await loadOrThrow(orderId);
  if (order.status !== 'new') throw httpError(409, 'Заказ уже забрал другой курьер');
  const active = await prisma.order.findFirst({ where: { courierId: courier.id, status: { in: ACTIVE } } });
  if (active) throw httpError(409, 'Сначала завершите текущий заказ');

  const from = courier.lat !== null && courier.lng !== null ? { lat: courier.lat, lng: courier.lng } : DEFAULT_COURIER_LOCATION;
  const route = await buildRoute([from, order.store, { lat: order.dropoffLat, lng: order.dropoffLng }]);

  try {
    await prisma.$transaction(async (tx) => {
      // Атомарно: заказ достаётся только тому, чей UPDATE первым застал статус 'new'.
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'new' },
        data: { status: 'accepted', courierId: courier.id, acceptedAt: new Date(), route, courierDistanceKm: route.distanceKm },
      });
      if (count === 0) throw httpError(409, 'Заказ уже забрал другой курьер');
      await tx.orderEvent.create({ data: { orderId, status: 'accepted', actorId: courier.id } });
      if (courier.lat === null) await tx.user.update({ where: { id: courier.id }, data: from });
    });
  } catch (e) {
    // Частичный уникальный индекс: у курьера не может быть двух активных заказов.
    if (isUniqueViolation(e)) throw httpError(409, 'Сначала завершите текущий заказ');
    throw e;
  }

  await emitOrder(orderId);
  emitToCouriers('orders:changed');
  return loadOrThrow(orderId);
}

// ---------- Статусы ----------

export async function markPicked(courierId: string, orderId: string) {
  const { count } = await prisma.$transaction(async (tx) => {
    const res = await tx.order.updateMany({ where: { id: orderId, courierId, status: 'accepted' }, data: { status: 'picked', pickedAt: new Date() } });
    if (res.count) await tx.orderEvent.create({ data: { orderId, status: 'picked', actorId: courierId } });
    return res;
  });
  if (!count) throw httpError(409, 'Нельзя сменить статус');
  await emitOrder(orderId);
}

export async function markDelivered(courierId: string, orderId: string) {
  const grants: PointsGrant[] = [];
  const order = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({ where: { id: orderId, courierId, status: 'picked' }, data: { status: 'delivered', deliveredAt: new Date() } });
    if (!count) throw httpError(409, 'Нельзя сменить статус');
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await tx.orderEvent.create({ data: { orderId, status: 'delivered', actorId: courierId } });
    const number = NUMBER_OFFSET + o.number;
    grants.push(
      { userId: courierId, amount: o.reward, kind: 'delivery_reward', reason: `Доставка заказа №${number}`, orderId },
      { userId: o.customerId, amount: customerCashback(o.itemsTotal), kind: 'order_cashback', reason: `Заказ №${number} доставлен`, orderId },
    );
    for (const g of grants) await grantPoints(tx, g);
    return o;
  });
  stopSimulation(orderId);
  announcePoints(grants);
  await Promise.all([checkAchievements(courierId), checkAchievements(order.customerId)]);
  await Promise.all([emitMe(courierId), emitMe(order.customerId), emitOrder(orderId)]);
}

export async function cancelOrder(customerId: string, orderId: string) {
  const { count } = await prisma.$transaction(async (tx) => {
    const res = await tx.order.updateMany({ where: { id: orderId, customerId, status: 'new' }, data: { status: 'cancelled' } });
    if (res.count) await tx.orderEvent.create({ data: { orderId, status: 'cancelled', actorId: customerId } });
    return res;
  });
  if (!count) {
    const exists = await prisma.order.findFirst({ where: { id: orderId, customerId } });
    throw exists ? httpError(409, 'Курьер уже взял заказ — отменить нельзя') : httpError(404, 'Заказ не найден');
  }
  await emitOrder(orderId);
  emitToCouriers('orders:changed');
}

// ---------- Оценки ----------

const rateSchema = z.object({ stars: z.coerce.number().int().min(1, 'Оценка от 1 до 5').max(5, 'Оценка от 1 до 5'), comment: z.string().trim().max(200).optional().default('') });

export async function rateOrder(user: User, orderId: string, input: unknown) {
  const { stars, comment } = parse(rateSchema, input);
  const order = await loadOrThrow(orderId);
  if (order.status !== 'delivered' || !order.courierId) throw httpError(409, 'Оценить можно только доставленный заказ');
  const isCustomer = user.id === order.customerId;
  if (!isCustomer && user.id !== order.courierId) throw httpError(403, 'Это не ваш заказ');
  const toId = isCustomer ? order.courierId : order.customerId;

  const grants: PointsGrant[] = [{ userId: user.id, amount: 5, kind: 'rating_thanks', reason: 'Спасибо за оценку', orderId }];
  if (stars === 5) grants.push({ userId: toId, amount: 15, kind: 'five_stars', reason: 'Вам поставили 5★', orderId });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.rating.create({ data: { orderId, fromId: user.id, toId, stars, comment } });
      for (const g of grants) await grantPoints(tx, g);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw httpError(409, 'Вы уже оценили этот заказ');
    throw e;
  }
  announcePoints(grants);
  await Promise.all([checkAchievements(user.id), checkAchievements(toId)]);
  await Promise.all([emitMe(user.id), emitMe(toId), emitOrder(orderId)]);
}

// ---------- HTTP ----------

export const ordersRouter = Router();

const send = async (res: import('express').Response, orderId: string) => res.json(await serializeOrder(await loadOrThrow(orderId)));

ordersRouter.get('/orders/open', requireAuth, requireRole('courier'), wrap(async (_req, res) => {
  const orders = await prisma.order.findMany({ where: { status: 'new' }, include: orderInclude, orderBy: { createdAt: 'asc' } });
  res.json(await Promise.all(orders.map(serializeOrder)));
}));

ordersRouter.get('/orders/my', requireAuth, wrap(async (req, res) => {
  const where = req.user.role === 'courier' ? { courierId: req.user.id } : { customerId: req.user.id };
  const orders = await prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json(await Promise.all(orders.map(serializeOrder)));
}));

ordersRouter.get('/orders/:id', requireAuth, wrap(async (req, res) => {
  const order = await loadOrThrow(req.params.id);
  // Новый заказ видят все курьеры, остальные — только участники.
  const allowed = order.customerId === req.user.id || order.courierId === req.user.id || (order.status === 'new' && req.user.role === 'courier');
  if (!allowed) throw httpError(404, 'Заказ не найден');
  res.json(await serializeOrder(order));
}));

ordersRouter.post('/orders', requireAuth, requireRole('customer'), wrap(async (req, res) => {
  const order = await placeOrder(req.user, req.body);
  res.status(201).json(await serializeOrder(order));
}));

ordersRouter.post('/orders/:id/cancel', requireAuth, requireRole('customer'), wrap(async (req, res) => {
  await cancelOrder(req.user.id, req.params.id);
  await send(res, req.params.id);
}));

ordersRouter.post('/orders/:id/accept', requireAuth, requireRole('courier'), wrap(async (req, res) => {
  const order = await acceptOrder(req.user, req.params.id);
  res.json(await serializeOrder(order));
}));

const statusSchema = z.object({ status: z.enum(['picked', 'delivered'], { message: 'Нельзя сменить статус' }) });

ordersRouter.post('/orders/:id/status', requireAuth, requireRole('courier'), wrap(async (req, res) => {
  const { status } = parse(statusSchema, req.body);
  if (status === 'picked') await markPicked(req.user.id, req.params.id);
  else await markDelivered(req.user.id, req.params.id);
  await send(res, req.params.id);
}));

ordersRouter.post('/orders/:id/simulate', requireAuth, requireRole('courier'), wrap(async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, courierId: req.user.id, status: { in: ACTIVE } } });
  if (!order) throw httpError(409, 'Нет активного заказа');
  startSimulation(order.id, { autoDeliver: Boolean(req.body?.autoDeliver) });
  res.json({ ok: true });
}));

ordersRouter.post('/orders/:id/rate', requireAuth, wrap(async (req, res) => {
  await rateOrder(req.user, req.params.id, req.body);
  await send(res, req.params.id);
}));

const routeQuery = z.object({ points: z.string() });

ordersRouter.get('/route', wrap(async (req, res) => {
  const { points } = parse(routeQuery, req.query);
  const list = points
    .split(';')
    .map((p) => p.split(',').map(Number))
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    .map(([lat, lng]) => ({ lat, lng }));
  if (list.length < 2 || list.length > 5) throw httpError(400, 'Нужно 2–5 точек');
  res.json(await buildRoute(list));
}));

ordersRouter.get('/stores', wrap(async (_req, res) => res.json(await prisma.store.findMany({ orderBy: { id: 'asc' } }))));
