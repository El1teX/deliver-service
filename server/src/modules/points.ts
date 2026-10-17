import type { PointsKind } from '@prisma/client';
import { type Db, prisma } from '../db';
import { emitToUser } from '../realtime';

// Курьеру за доставку: база + километры. Клиенту — 5% от суммы товаров + 10.
export const courierReward = (distanceKm: number) => Math.round(25 + distanceKm * 8);
export const deliveryFee = (distanceKm: number) => Math.round(99 + distanceKm * 20);
export const customerCashback = (itemsTotal: number) => Math.round(itemsTotal * 0.05) + 10;
export const WELCOME_POINTS = { customer: 100, courier: 50 } as const;

export type PointsGrant = { userId: string; amount: number; kind: PointsKind; reason: string; orderId?: string };

export async function grantPoints(db: Db, grant: PointsGrant) {
  if (!grant.amount) return;
  await db.pointsEntry.create({ data: grant });
}

// Уведомление шлём только после коммита транзакции, иначе клиент может увидеть баллы, которых нет.
export function announcePoints(grants: PointsGrant[]) {
  for (const g of grants) if (g.amount > 0) emitToUser(g.userId, 'notify', { type: 'points', amount: g.amount, reason: g.reason });
}

export async function pointsSummary(userId: string, db: Db = prisma) {
  const [balance, earned] = await Promise.all([
    db.pointsEntry.aggregate({ where: { userId }, _sum: { amount: true } }),
    db.pointsEntry.aggregate({ where: { userId, amount: { gt: 0 } }, _sum: { amount: true } }),
  ]);
  return { balance: balance._sum.amount ?? 0, totalEarned: earned._sum.amount ?? 0 };
}
