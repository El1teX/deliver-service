import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../auth';
import { findPrize, PRIZES } from '../catalog';
import { prisma } from '../db';
import { httpError, wrap } from '../lib/http';
import { checkAchievements } from './gamification';
import { grantPoints, pointsSummary } from './points';
import { buildMe, emitMe } from './users';

export const prizesRouter = Router();

prizesRouter.get('/prizes', requireAuth, (req, res) => {
  res.json(PRIZES.filter((p) => p.roles.includes(req.user.role)));
});

prizesRouter.post('/prizes/:id/buy', requireAuth, wrap(async (req, res) => {
  const prize = findPrize(req.params.id);
  if (!prize || !prize.roles.includes(req.user.role)) throw httpError(404, 'Приз не найден');
  const userId = req.user.id;

  const purchase = await prisma.$transaction(async (tx) => {
    // Блокируем строку пользователя: параллельные покупки встанут в очередь и не уведут баланс в минус.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (prize.effect === 'frame' && user.frame) throw httpError(409, 'Рамка уже есть');
    const { balance } = await pointsSummary(userId, tx);
    if (balance < prize.cost) throw httpError(409, `Не хватает ${prize.cost - balance} баллов`);

    await grantPoints(tx, { userId, amount: -prize.cost, kind: 'purchase', reason: `Приз «${prize.title}»` });
    if (prize.effect === 'frame') await tx.user.update({ where: { id: userId }, data: { frame: 'gold' } });
    if (prize.effect === 'freeDelivery') await tx.user.update({ where: { id: userId }, data: { freeDeliveryPerks: { increment: 1 } } });
    if (prize.effect === 'discount10') await tx.user.update({ where: { id: userId }, data: { discount10Perks: { increment: 1 } } });
    return tx.purchase.create({
      data: { userId, prizeId: prize.id, title: prize.title, icon: prize.icon, cost: prize.cost, code: `MGM-${randomBytes(4).toString('hex').toUpperCase()}` },
    });
  });

  await checkAchievements(userId);
  await emitMe(userId);
  res.json({
    purchase: { id: purchase.id, prizeId: purchase.prizeId, title: purchase.title, icon: purchase.icon, cost: purchase.cost, code: purchase.code, at: +purchase.createdAt },
    me: await buildMe(userId),
  });
}));
