// Демонстрационный режим: готовые клиент и курьер с историей, открытые заказы и автосценарий.
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, signToken } from './auth';
import { STORES } from './catalog';
import { prisma } from './db';
import { httpError, parse, wrap } from './lib/http';
import { sendMessage } from './modules/chat';
import { checkAchievements } from './modules/gamification';
import { acceptOrder, placeOrder } from './modules/orders';
import { grantPoints, pointsSummary } from './modules/points';
import { buildMe } from './modules/users';
import { startSimulation, stopAllSimulations } from './simulation';

export const DEMO_CUSTOMER = 'demo_customer';
export const DEMO_COURIER = 'demo_courier';
// Тестовый пароль демо-аккаунтов — можно войти и обычной формой.
export const DEMO_PASSWORD = 'demo12345';
const HOME = { lat: 55.7536, lng: 37.6398, address: 'ул. Солянка, 1 (демо-адрес)' };

type Npc = { id: string; name: string; role: 'customer' | 'courier'; stars: number[]; delivered?: number; km?: number };

const NPC: Npc[] = [
  { id: 'demo_c1', name: 'Мария К.', role: 'customer', stars: [5, 5, 5, 5, 4] },
  { id: 'demo_c2', name: 'Игорь П.', role: 'customer', stars: [4, 4, 5, 3] },
  { id: 'demo_c3', name: 'Ольга С.', role: 'customer', stars: [5, 5, 5] },
  { id: 'demo_c4', name: 'Сергей Л.', role: 'customer', stars: [3, 4, 4, 3, 5] },
  { id: 'demo_k1', name: 'Алексей В.', role: 'courier', stars: [5, 4, 5, 5, 4, 5], delivered: 12, km: 31.5 },
  { id: 'demo_k2', name: 'Камила Р.', role: 'courier', stars: [5, 5, 5, 5, 5, 5, 4, 5], delivered: 30, km: 74.2 },
];
const NPC_CUSTOMERS = NPC.filter((n) => n.role === 'customer').map((n) => n.id);
const NPC_COURIERS = NPC.filter((n) => n.role === 'courier').map((n) => n.id);

const BASKETS = [
  [{ name: 'Молоко 3,2%', qty: 2, price: 95 }, { name: 'Хлеб бородинский', qty: 1, price: 65 }, { name: 'Яйца С0, 10 шт', qty: 1, price: 140 }],
  [{ name: 'Бананы, кг', qty: 1, price: 150 }, { name: 'Йогурт греческий', qty: 3, price: 89 }, { name: 'Кофе зерновой', qty: 1, price: 790 }],
  [{ name: 'Ибупрофен', qty: 1, price: 120 }, { name: 'Пластыри', qty: 1, price: 90 }, { name: 'Витамин D', qty: 1, price: 450 }],
  [{ name: 'Букет тюльпанов', qty: 1, price: 2500 }, { name: 'Открытка', qty: 1, price: 150 }],
  [{ name: 'Круассан', qty: 4, price: 120 }, { name: 'Багет', qty: 1, price: 90 }],
  [{ name: 'Сыр бри', qty: 1, price: 690 }, { name: 'Виноград, кг', qty: 1, price: 420 }, { name: 'Хамон, 100 г', qty: 2, price: 560 }],
  [{ name: 'Вода 5 л', qty: 2, price: 120 }, { name: 'Пельмени', qty: 1, price: 380 }, { name: 'Сметана', qty: 1, price: 110 }],
];

const DROPOFFS = [
  { lat: 55.7697, lng: 37.6211, address: 'Цветной бульвар, 11' },
  { lat: 55.744, lng: 37.601, address: 'ул. Остоженка, 7' },
  { lat: 55.7337, lng: 37.6434, address: 'ул. Большая Татарская, 5' },
  { lat: 55.7604, lng: 37.6626, address: 'ул. Земляной Вал, 33' },
  { lat: 55.7731, lng: 37.597, address: 'ул. Малая Дмитровка, 23' },
];

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const DAY = 86_400_000;

export const ensureStores = () =>
  prisma.$transaction(STORES.map((s) => prisma.store.upsert({ where: { id: s.id }, create: s, update: s })));

async function seedRatings(toId: string, stars: number[], fromIds: string[]) {
  await prisma.rating.createMany({
    data: stars.map((s, i) => ({ toId, fromId: fromIds[i % fromIds.length], stars: s, comment: s === 5 ? 'Всё отлично!' : '', createdAt: new Date(Date.now() - (i + 1) * DAY) })),
  });
}

// Прошлые доставки курьера — чтобы у демо-пользователей была история и статистика.
async function seedHistory(courierId: string, count: number, totalKm: number) {
  for (let i = 0; i < count; i++) {
    const store = STORES[i % STORES.length];
    const basket = BASKETS[i % BASKETS.length];
    const dropoff = DROPOFFS[i % DROPOFFS.length];
    const itemsTotal = basket.reduce((s, it) => s + it.qty * it.price, 0);
    const km = Math.round((totalKm / count) * 100) / 100;
    const deliveredAt = new Date(Date.now() - (i + 1) * DAY);
    await prisma.order.create({
      data: {
        customerId: NPC_CUSTOMERS[i % NPC_CUSTOMERS.length],
        courierId,
        storeId: store.id,
        status: 'delivered',
        itemsTotal,
        deliveryFee: 150,
        total: itemsTotal + 150,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        dropoffAddress: dropoff.address,
        distanceKm: km,
        courierDistanceKm: km,
        reward: Math.round(25 + km * 8),
        createdAt: new Date(+deliveredAt - 45 * 60_000),
        acceptedAt: new Date(+deliveredAt - 35 * 60_000),
        pickedAt: new Date(+deliveredAt - 20 * 60_000),
        deliveredAt,
        items: { create: basket },
      },
    });
  }
}

async function topUpTo(userId: string, target: number) {
  const { balance } = await pointsSummary(userId);
  await grantPoints(prisma, { userId, amount: target - balance, kind: 'demo_seed', reason: 'Стартовые баллы демо-режима' });
}

async function doReset() {
  stopAllSimulations();
  const demoIds = [DEMO_CUSTOMER, DEMO_COURIER, ...NPC.map((n) => n.id)];
  // Заказы настоящих клиентов, которые вёз демо-курьер, возвращаем в общий пул.
  await prisma.order.updateMany({
    where: { courierId: { in: demoIds }, status: { in: ['accepted', 'picked'] }, customerId: { notIn: demoIds } },
    data: { status: 'new', courierId: null, route: Prisma.DbNull, courierDistanceKm: null, acceptedAt: null, pickedAt: null },
  });
  await prisma.user.deleteMany({ where: { isDemo: true } }); // каскадом удаляет их заказы, оценки, баллы
  await ensureStores();

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const email = (id: string) => `${id.replace('_', '-')}@demo.migom`;
  await prisma.user.createMany({
    data: [
      { id: DEMO_CUSTOMER, email: email(DEMO_CUSTOMER), name: 'Анна (демо)', role: 'customer', isDemo: true, passwordHash, ...HOME },
      { id: DEMO_COURIER, email: email(DEMO_COURIER), name: 'Дмитрий (демо)', role: 'courier', isDemo: true, passwordHash, lat: 55.7577, lng: 37.6262 },
      ...NPC.map((n) => ({ id: n.id, email: email(n.id), name: n.name, role: n.role, isDemo: true, passwordHash })),
    ],
  });

  await seedRatings(DEMO_CUSTOMER, [5, 5, 4, 5], NPC_COURIERS);
  await seedRatings(DEMO_COURIER, [5, 5, 5, 4, 5], NPC_CUSTOMERS);
  for (const n of NPC) await seedRatings(n.id, n.stars, n.role === 'customer' ? NPC_COURIERS : NPC_CUSTOMERS);

  await seedHistory(DEMO_COURIER, 4, 7.4);
  for (const n of NPC) if (n.delivered) await seedHistory(n.id, n.delivered, n.km ?? 0);

  for (const id of demoIds) await checkAchievements(id, { silent: true });
  // Стартовые баллы, чтобы сразу можно было зайти в магазин призов.
  await topUpTo(DEMO_CUSTOMER, 450);
  await topUpTo(DEMO_COURIER, 720);

  // Открытые заказы от других клиентов — их курьер увидит на карте.
  for (let i = 0; i < 4; i++) {
    const customer = await prisma.user.findUniqueOrThrow({ where: { id: NPC_CUSTOMERS[i] } });
    await placeOrder(customer, {
      storeId: STORES[[0, 3, 7, 4][i]].id,
      items: BASKETS[[0, 2, 3, 5][i]],
      dropoff: DROPOFFS[i],
      comment: ['Домофон 12, 4 этаж', 'Позвоните за 5 минут', 'Это сюрприз — не звоните в дверь 🙂', ''][i],
    });
  }
  return { customerId: DEMO_CUSTOMER, courierId: DEMO_COURIER };
}

let resetting: Promise<{ customerId: string; courierId: string }> | null = null;
// Сброс сериализуется: параллельные вызовы ждут один и тот же результат.
export function resetDemo() {
  resetting ??= doReset().finally(() => (resetting = null));
  return resetting;
}

export async function ensureDemo() {
  await ensureStores();
  if (!(await prisma.user.findUnique({ where: { id: DEMO_CUSTOMER } }))) {
    await resetDemo();
    console.log('Демо-данные созданы');
  }
}

export const demoRouter = Router();

demoRouter.post('/demo/reset', wrap(async (_req, res) => res.json(await resetDemo())));

// Вход в демо-аккаунт без пароля — только для пользователей с флагом isDemo.
demoRouter.post('/demo/login', wrap(async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string() }), req.body);
  if (resetting) await resetting;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.isDemo) throw httpError(404, 'Демо-пользователь не найден');
  res.json({ token: signToken(user), user: await buildMe(user.id) });
}));

// Автосценарий: Анна оформляет заказ → Дмитрий берёт его → едет в магазин → везёт клиенту.
demoRouter.post('/demo/autoplay', wrap(async (_req, res) => {
  const customer = await prisma.user.findUnique({ where: { id: DEMO_CUSTOMER } });
  if (!customer) throw httpError(409, 'Сначала запустите демо');
  const busy = await prisma.order.findFirst({
    where: { status: { in: ['new', 'accepted', 'picked'] }, OR: [{ courierId: DEMO_COURIER }, { customerId: DEMO_CUSTOMER }] },
  });
  if (busy) throw httpError(409, 'У демо-пользователей уже есть активный заказ');

  const order = await placeOrder(customer, {
    storeId: pick([STORES[1], STORES[8], STORES[2], STORES[5]]).id,
    items: pick(BASKETS),
    dropoff: { lat: customer.lat ?? HOME.lat, lng: customer.lng ?? HOME.lng, address: customer.address ?? HOME.address },
    comment: 'Демо-заказ: оставьте у двери',
  });
  setTimeout(async () => {
    try {
      const courier = await prisma.user.findUniqueOrThrow({ where: { id: DEMO_COURIER } });
      await acceptOrder(courier, order.id);
      // Перед доставкой курьер пишет клиенту в чат.
      const onApproach = () => sendMessage(courier.id, order.id, { text: 'Подъезжаю' }).catch(() => {});
      setTimeout(() => startSimulation(order.id, { autoDeliver: true, onApproach }), 1500);
    } catch (e) {
      console.warn('autoplay:', (e as Error).message);
    }
  }, 3000);
  res.json({ orderId: order.id });
}));
