import type { User } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../auth';
import { ACHIEVEMENTS } from '../catalog';
import { isUniqueViolation, prisma } from '../db';
import { wrap } from '../lib/http';
import { emitToUser } from '../realtime';
import { grantPoints } from './points';
import { ratingOf, statsOf } from './users';

const forRole = (user: Pick<User, 'role'>) => ACHIEVEMENTS.filter((a) => a.role === 'any' || a.role === user.role);

// Выдаёт заработанные достижения вместе с бонусными баллами. Безопасно вызывать сколько угодно раз:
// повторную выдачу отсекает первичный ключ (userId, achievementId).
export async function checkAchievements(userId: string, { silent = false } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { achievements: true } });
  if (!user) return [];
  const [stats, rating] = await Promise.all([statsOf(userId), ratingOf(userId)]);
  const have = new Set(user.achievements.map((a) => a.achievementId));
  const unlocked = [];
  for (const a of forRole(user)) {
    if (have.has(a.id) || !a.check(stats, rating)) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.userAchievement.create({ data: { userId, achievementId: a.id } });
        await grantPoints(tx, { userId, amount: a.points, kind: 'achievement', reason: `Достижение «${a.title}»` });
      });
      unlocked.push(a);
      if (!silent) emitToUser(userId, 'notify', { type: 'achievement', id: a.id, icon: a.icon, title: a.title, points: a.points });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // уже выдано параллельным запросом
    }
  }
  return unlocked;
}

export async function achievementsFor(user: User) {
  const [got, stats] = await Promise.all([prisma.userAchievement.findMany({ where: { userId: user.id } }), statsOf(user.id)]);
  return forRole(user).map((a) => {
    const unlocked = got.find((x) => x.achievementId === a.id);
    return {
      id: a.id,
      icon: a.icon,
      title: a.title,
      desc: a.desc,
      points: a.points,
      unlockedAt: unlocked ? +unlocked.unlockedAt : null,
      progress: a.goal ? a.goal(stats) : null,
    };
  });
}

export const achievementsRouter = Router();
achievementsRouter.get('/achievements', requireAuth, wrap(async (req, res) => res.json(await achievementsFor(req.user))));
