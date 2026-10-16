import { ACHIEVEMENTS } from './catalog.js';
import { ratingOf, save } from './store.js';

let notify = () => {};
export const setNotifier = (fn) => (notify = fn);

export function addPoints(user, amount, reason) {
  if (!amount) return;
  user.points += amount;
  if (amount > 0) user.totalEarned += amount;
  notify(user, { type: 'points', amount, reason });
}

// Проверяет все достижения пользователя и выдаёт новые вместе с бонусными баллами.
export function checkAchievements(user) {
  const ctx = { rating: ratingOf(user) };
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (a.role !== 'any' && a.role !== user.role) continue;
    if (user.achievements.some((x) => x.id === a.id)) continue;
    if (!a.check(user, ctx)) continue;
    user.achievements.push({ id: a.id, at: Date.now() });
    unlocked.push(a);
    user.points += a.points;
    user.totalEarned += a.points;
    notify(user, { type: 'achievement', id: a.id, icon: a.icon, title: a.title, points: a.points });
  }
  if (unlocked.length) save();
  return unlocked;
}

export function achievementsFor(user) {
  return ACHIEVEMENTS.filter((a) => a.role === 'any' || a.role === user.role).map((a) => {
    const got = user.achievements.find((x) => x.id === a.id);
    return {
      id: a.id,
      icon: a.icon,
      title: a.title,
      desc: a.desc,
      points: a.points,
      unlockedAt: got?.at ?? null,
      progress: a.goal ? a.goal(user) : null,
    };
  });
}

// Баллы курьеру за доставку: база + километры.
export const courierReward = (distanceKm) => Math.round(25 + distanceKm * 8);
// Стоимость доставки для клиента, ₽.
export const deliveryFee = (distanceKm) => Math.round(99 + distanceKm * 20);
