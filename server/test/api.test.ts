import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ACHIEVEMENTS } from '../src/catalog';
import { prisma } from '../src/db';
import { ensureStores } from '../src/demo';
import { grantPoints } from '../src/modules/points';

const app = createApp();
let seq = 0;

async function register(role: 'customer' | 'courier', name: string = role) {
  const email = `${role}${++seq}-${Date.now()}@test.local`;
  const res = await request(app).post('/api/auth/register').send({ email, password: 'secret123', name, role });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, user: res.body.user, email };
}

const as = (token: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string, body?: object) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
});

const ORDER = {
  storeId: 's1',
  items: [{ name: 'Молоко', qty: 2, price: 100 }, { name: '', qty: 1, price: 0 }],
  dropoff: { lat: 55.75, lng: 37.64, address: 'ул. Тестовая, 1' },
};

async function placeOrder(token: string) {
  const res = await as(token).post('/api/orders', ORDER);
  expect(res.status).toBe(201);
  return res.body;
}

const me = async (token: string) => (await as(token).get('/api/me')).body;
const achievementPoints = (ids: { id: string }[]) => ids.reduce((s, a) => s + (ACHIEVEMENTS.find((x) => x.id === a.id)?.points ?? 0), 0);

beforeAll(async () => {
  await ensureStores();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('авторизация', () => {
  it('регистрирует, выдаёт приветственные баллы и пускает по токену', async () => {
    const { token, email } = await register('customer', 'Маша');
    const profile = await me(token);
    expect(profile).toMatchObject({ email, name: 'Маша', role: 'customer', points: 100 });

    const login = await request(app).post('/api/auth/login').send({ email: email.toUpperCase(), password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('отклоняет неверный пароль, повторный email и запросы без токена', async () => {
    const { email } = await register('courier');
    expect((await request(app).post('/api/auth/login').send({ email, password: 'wrong-pass' })).status).toBe(401);
    expect((await request(app).post('/api/auth/register').send({ email, password: 'secret123', name: 'X', role: 'courier' })).status).toBe(409);
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer forged.token.value')).status).toBe(401);
  });

  it('проверяет входные данные', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'не-email', password: '1', name: '', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe('заказы', () => {
  it('клиент оформляет заказ, пустые строки товаров отбрасываются, курьер видит его в открытых', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const order = await placeOrder(customer.token);
    expect(order.items).toEqual([{ name: 'Молоко', qty: 2, price: 100 }]);
    expect(order.itemsTotal).toBe(200);
    expect(order.status).toBe('new');

    const open = await as(courier.token).get('/api/orders/open');
    expect(open.body.map((o: { id: string }) => o.id)).toContain(order.id);
    // Клиенту список открытых заказов недоступен.
    expect((await as(customer.token).get('/api/orders/open')).status).toBe(403);
  });

  it('не принимает заказ без товаров', async () => {
    const customer = await register('customer');
    const res = await as(customer.token).post('/api/orders', { ...ORDER, items: [{ name: '  ', qty: 1, price: 1 }] });
    expect(res.status).toBe(400);
  });

  it('два курьера одновременно берут один заказ — достаётся ровно одному', async () => {
    const customer = await register('customer');
    const couriers = await Promise.all([register('courier'), register('courier'), register('courier')]);
    const order = await placeOrder(customer.token);

    const results = await Promise.all(couriers.map((c) => as(c.token).post(`/api/orders/${order.id}/accept`)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);

    const winner = couriers[results.findIndex((r) => r.status === 200)];
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true } });
    expect(saved.courierId).toBe(winner.user.id);
    expect(saved.events.filter((e) => e.status === 'accepted')).toHaveLength(1);
  });

  it('у курьера не может быть двух активных заказов, даже при одновременных запросах', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const [a, b] = [await placeOrder(customer.token), await placeOrder(customer.token)];

    const results = await Promise.all([as(courier.token).post(`/api/orders/${a.id}/accept`), as(courier.token).post(`/api/orders/${b.id}/accept`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.order.count({ where: { courierId: courier.user.id, status: { in: ['accepted', 'picked'] } } })).toBe(1);
  });

  it('отменённый заказ нельзя взять, а взятый — отменить', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const first = await placeOrder(customer.token);
    expect((await as(customer.token).post(`/api/orders/${first.id}/cancel`)).body.status).toBe('cancelled');
    expect((await as(courier.token).post(`/api/orders/${first.id}/accept`)).status).toBe(409);

    const second = await placeOrder(customer.token);
    await as(courier.token).post(`/api/orders/${second.id}/accept`);
    expect((await as(customer.token).post(`/api/orders/${second.id}/cancel`)).status).toBe(409);
  });

  it('статусы идут строго по порядку: нельзя доставить, не забрав', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const order = await placeOrder(customer.token);
    await as(courier.token).post(`/api/orders/${order.id}/accept`);
    expect((await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'delivered' })).status).toBe(409);
    expect((await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'picked' })).body.status).toBe('picked');
  });
});

describe('журнал баллов и оценки', () => {
  it('после доставки начисляет баллы обоим, и баланс сходится с журналом', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const order = await placeOrder(customer.token);
    await as(courier.token).post(`/api/orders/${order.id}/accept`);
    await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'picked' });
    const delivered = await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'delivered' });
    expect(delivered.body.status).toBe('delivered');

    const courierMe = await me(courier.token);
    expect(courierMe.stats.delivered).toBe(1);
    expect(courierMe.achievements.map((a: { id: string }) => a.id)).toContain('first_delivery');
    expect(courierMe.points).toBe(50 + order.reward + achievementPoints(courierMe.achievements));

    const customerMe = await me(customer.token);
    const cashback = Math.round(order.itemsTotal * 0.05) + 10;
    expect(customerMe.points).toBe(100 + cashback + achievementPoints(customerMe.achievements));

    const entries = await prisma.pointsEntry.findMany({ where: { orderId: order.id } });
    expect(entries.map((e) => e.kind).sort()).toEqual(['delivery_reward', 'order_cashback']);
  });

  it('оценить заказ можно один раз, 5★ даёт бонус получателю', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const order = await placeOrder(customer.token);
    expect((await as(customer.token).post(`/api/orders/${order.id}/rate`, { stars: 5 })).status).toBe(409); // ещё не доставлен
    await as(courier.token).post(`/api/orders/${order.id}/accept`);
    await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'picked' });
    await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'delivered' });

    const before = await me(courier.token);
    const pointsWithoutAchievements = (m: { points: number; achievements: { id: string }[] }) => m.points - achievementPoints(m.achievements);
    const rated = await as(customer.token).post(`/api/orders/${order.id}/rate`, { stars: 5, comment: 'Супер' });
    expect(rated.body.ratingByCustomer).toMatchObject({ stars: 5, comment: 'Супер' });
    const after = await me(courier.token);
    expect(after.rating).toEqual({ avg: 5, count: 1 });
    expect(pointsWithoutAchievements(after) - pointsWithoutAchievements(before)).toBe(15);

    expect((await as(customer.token).post(`/api/orders/${order.id}/rate`, { stars: 1 })).status).toBe(409);
    expect((await as(customer.token).post(`/api/orders/${order.id}/rate`, { stars: 7 })).status).toBe(400);
  });
});

describe('призы', () => {
  it('не продаёт приз, если не хватает баллов', async () => {
    const customer = await register('customer');
    const res = await as(customer.token).post('/api/prizes/coffee/buy');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Не хватает 50/);
  });

  it('параллельные покупки не уводят баланс в минус', async () => {
    const courier = await register('courier');
    await grantPoints(prisma, { userId: courier.user.id, amount: 100, kind: 'demo_seed', reason: 'тест' }); // ровно 150 на один кофе
    const results = await Promise.all([1, 2, 3].map(() => as(courier.token).post('/api/prizes/coffee/buy')));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);

    const profile = await me(courier.token);
    expect(profile.purchases).toHaveLength(1);
    expect(profile.points).toBe(achievementPoints(profile.achievements)); // 150 − 150 + бонус «Шопоголик»
    expect(profile.points).toBeGreaterThanOrEqual(0);
  });

  it('бесплатная доставка из магазина призов применяется к следующему заказу', async () => {
    const customer = await register('customer');
    await grantPoints(prisma, { userId: customer.user.id, amount: 100, kind: 'demo_seed', reason: 'тест' });
    expect((await as(customer.token).post('/api/prizes/free_delivery/buy')).status).toBe(200);
    const order = await placeOrder(customer.token);
    expect(order.deliveryFee).toBe(0);
    expect(order.perksUsed).toContain('Бесплатная доставка');
    expect((await placeOrder(customer.token)).deliveryFee).toBeGreaterThan(0);
  });
});

describe('чат по заказу', () => {
  it('участники переписываются, посторонний получает 404, после доставки писать нельзя', async () => {
    const customer = await register('customer');
    const courier = await register('courier');
    const stranger = await register('courier');
    const order = await placeOrder(customer.token);
    const url = `/api/orders/${order.id}/messages`;

    // Пока курьера нет — писать некому.
    expect((await as(customer.token).post(url, { text: 'Привет' })).status).toBe(409);
    await as(courier.token).post(`/api/orders/${order.id}/accept`);

    const sent = await as(courier.token).post(url, { text: '  Подъезжаю  ' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ fromId: courier.user.id, text: 'Подъезжаю', readAt: null });
    expect((await as(customer.token).post(url, { text: 'Жду' })).status).toBe(201);

    expect((await as(customer.token).post(url, { text: '   ' })).status).toBe(400);
    expect((await as(customer.token).post(url, { text: 'а'.repeat(501) })).status).toBe(400);

    expect((await as(stranger.token).get(url)).status).toBe(404);
    expect((await as(stranger.token).post(url, { text: 'Я тут' })).status).toBe(404);

    expect((await as(customer.token).post(`${url}/read`)).body.read).toBe(1);
    const history = await as(customer.token).get(url);
    expect(history.body.canWrite).toBe(true);
    expect(history.body.messages.map((m: { text: string }) => m.text)).toEqual(['Подъезжаю', 'Жду']);
    expect(history.body.messages[0].readAt).toBeTruthy();

    await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'picked' });
    await as(courier.token).post(`/api/orders/${order.id}/status`, { status: 'delivered' });
    expect((await as(courier.token).post(url, { text: 'Спасибо!' })).status).toBe(409);
    const after = await as(courier.token).get(url);
    expect(after.body.canWrite).toBe(false);
    expect(after.body.messages).toHaveLength(2);
  });
});
