// Простое хранилище на JSON-файле: без нативных зависимостей, переживает перезапуск.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, '../data/db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { users: [], orders: [] };
  }
}

export const db = load();

let timer;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  }, 200);
}

export const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const findUser = (id) => db.users.find((u) => u.id === id);
export const findOrder = (id) => db.orders.find((o) => o.id === id);

export function createUser({ id, name, role, isDemo = false, location = null }) {
  const user = {
    id: id ?? newId('u'),
    name,
    role,
    isDemo,
    createdAt: Date.now(),
    location,
    points: role === 'courier' ? 50 : 100,
    totalEarned: 0,
    frame: null,
    perks: { freeDelivery: 0, discount10: 0 },
    ratings: [],
    achievements: [],
    purchases: [],
    stats: {
      orders: 0,
      maxOrder: 0,
      nightOrders: 0,
      ratingsGiven: 0,
      delivered: 0,
      distanceKm: 0,
      fastDeliveries: 0,
      purchases: 0,
    },
  };
  db.users.push(user);
  save();
  return user;
}

export function ratingOf(user) {
  if (!user.ratings.length) return { avg: null, count: 0 };
  const sum = user.ratings.reduce((s, r) => s + r.stars, 0);
  return { avg: Math.round((sum / user.ratings.length) * 100) / 100, count: user.ratings.length };
}

// Публичное представление пользователя (то, что видят другие).
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    frame: user.frame,
    rating: ratingOf(user),
    achievementsCount: user.achievements.length,
    delivered: user.stats.delivered,
    orders: user.stats.orders,
  };
}

export function privateUser(user) {
  return { ...user, rating: ratingOf(user) };
}
