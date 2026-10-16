import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { findPrize, findStore, PRIZES, STORES } from './catalog.js';
import { achievementsFor, addPoints, checkAchievements, courierReward, deliveryFee, setNotifier } from './gamification.js';
import { buildRoute } from './routing.js';
import { createUser, db, findOrder, findUser, newId, privateUser, publicUser, save } from './store.js';
import { setupDemo } from './demo.js';
import { startSimulation, stopSimulation } from './simulation.js';

// --port из командной строки важнее переменной PORT (её могут выставить чужие dev-инструменты).
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : (process.env.PORT ?? 3001));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ---------- Реалтайм ----------

io.on('connection', (socket) => {
  const user = findUser(socket.handshake.auth?.userId);
  if (!user) return socket.disconnect();
  socket.join(`user:${user.id}`);
  if (user.role === 'courier') socket.join('couriers');
});

export const emitMe = (user) => io.to(`user:${user.id}`).emit('me:update', privateUser(user));
const emitOpenOrdersChanged = () => io.to('couriers').emit('orders:changed');

export function emitOrder(order) {
  const payload = serializeOrder(order);
  io.to(`user:${order.customerId}`).emit('order:update', payload);
  if (order.courierId) io.to(`user:${order.courierId}`).emit('order:update', payload);
}

export function emitCourierLocation(order, loc) {
  io.to(`user:${order.customerId}`).emit('courier:location', { orderId: order.id, ...loc });
  io.to(`user:${order.courierId}`).emit('courier:location', { orderId: order.id, ...loc });
}

setNotifier((user, event) => {
  io.to(`user:${user.id}`).emit('notify', event);
  emitMe(user);
});

// ---------- Хелперы ----------

export function serializeOrder(o) {
  return {
    ...o,
    customer: publicUser(findUser(o.customerId)),
    courier: o.courierId ? { ...publicUser(findUser(o.courierId)), location: findUser(o.courierId)?.location } : null,
  };
}

const ACTIVE = ['accepted', 'picked'];
const activeOrderOf = (user) =>
  db.orders.find((o) => ACTIVE.includes(o.status) && (user.role === 'courier' ? o.courierId === user.id : o.customerId === user.id));

const fail = (res, code, message) => res.status(code).json({ error: message });

function auth(req, res, next) {
  const user = findUser(req.header('x-user-id'));
  if (!user) return fail(res, 401, 'Нужно войти');
  req.user = user;
  next();
}

const onlyRole = (role) => (req, res, next) => (req.user.role === role ? next() : fail(res, 403, 'Недоступно для вашей роли'));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Бизнес-логика заказов (используется и в демо) ----------

export async function placeOrder(customer, { storeId, items, dropoff, comment }) {
  const store = findStore(storeId);
  if (!store) throw httpError(400, 'Выберите магазин');
  const cleanItems = (items ?? [])
    .map((i) => ({ name: String(i.name ?? '').trim().slice(0, 80), qty: Math.max(1, Math.min(99, Number(i.qty) || 1)), price: Math.max(0, Number(i.price) || 0) }))
    .filter((i) => i.name);
  if (!cleanItems.length) throw httpError(400, 'Добавьте хотя бы один товар');
  if (!Number.isFinite(dropoff?.lat) || !Number.isFinite(dropoff?.lng)) throw httpError(400, 'Укажите точку доставки на карте');

  const route = await buildRoute([store, dropoff]);
  const itemsTotal = cleanItems.reduce((s, i) => s + i.qty * i.price, 0);
  let fee = deliveryFee(route.distanceKm);
  let discount = 0;
  const perksUsed = [];
  if (customer.perks.freeDelivery > 0) {
    customer.perks.freeDelivery--;
    fee = 0;
    perksUsed.push('Бесплатная доставка');
  }
  if (customer.perks.discount10 > 0) {
    customer.perks.discount10--;
    discount = Math.round(itemsTotal * 0.1);
    perksUsed.push('Скидка 10%');
  }

  const order = {
    id: newId('o'),
    number: 1000 + db.orders.length + 1,
    customerId: customer.id,
    courierId: null,
    store: { id: store.id, name: store.name, address: store.address, icon: store.icon, lat: store.lat, lng: store.lng },
    items: cleanItems,
    itemsTotal,
    discount,
    deliveryFee: fee,
    total: itemsTotal - discount + fee,
    perksUsed,
    dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: String(dropoff.address ?? '').slice(0, 120) || 'Точка на карте' },
    comment: String(comment ?? '').slice(0, 300),
    distanceKm: route.distanceKm,
    reward: courierReward(route.distanceKm),
    status: 'new',
    route: null,
    createdAt: Date.now(),
    acceptedAt: null,
    pickedAt: null,
    deliveredAt: null,
    ratingByCustomer: null,
    ratingByCourier: null,
  };
  db.orders.push(order);

  const hour = new Date().getHours();
  customer.stats.orders++;
  customer.stats.maxOrder = Math.max(customer.stats.maxOrder, itemsTotal);
  if (hour >= 22 || hour < 6) customer.stats.nightOrders++;
  save();
  checkAchievements(customer);
  emitMe(customer);
  emitOpenOrdersChanged();
  return order;
}

export async function acceptOrder(courier, order) {
  if (order.status !== 'new') throw httpError(409, 'Заказ уже забрал другой курьер');
  if (activeOrderOf(courier)) throw httpError(409, 'Сначала завершите текущий заказ');
  if (!courier.location) courier.location = { lat: 55.7558, lng: 37.6173 };
  order.status = 'accepted';
  order.courierId = courier.id;
  order.acceptedAt = Date.now();
  order.route = await buildRoute([courier.location, order.store, order.dropoff]);
  order.route.pickupIndex = order.route.legs[0].coords.length - 1;
  order.route.legs = undefined;
  save();
  emitOrder(order);
  emitOpenOrdersChanged();
  return order;
}

export function setOrderStatus(courier, order, status) {
  if (order.courierId !== courier.id) throw httpError(403, 'Это не ваш заказ');
  if (status === 'picked' && order.status === 'accepted') {
    order.status = 'picked';
    order.pickedAt = Date.now();
  } else if (status === 'delivered' && order.status === 'picked') {
    order.status = 'delivered';
    order.deliveredAt = Date.now();
    stopSimulation(order.id);
    const customer = findUser(order.customerId);
    courier.stats.delivered++;
    courier.stats.distanceKm = Math.round((courier.stats.distanceKm + (order.route?.distanceKm ?? order.distanceKm)) * 100) / 100;
    if (order.deliveredAt - order.acceptedAt < 20 * 60 * 1000) courier.stats.fastDeliveries++;
    addPoints(courier, order.reward, `Доставка заказа №${order.number}`);
    addPoints(customer, Math.round(order.itemsTotal * 0.05) + 10, `Заказ №${order.number} доставлен`);
    checkAchievements(courier);
    checkAchievements(customer);
  } else {
    throw httpError(409, 'Нельзя сменить статус');
  }
  save();
  emitOrder(order);
  return order;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---------- API ----------

app.post('/api/auth/login', (req, res) => {
  const name = String(req.body.name ?? '').trim().slice(0, 40);
  const role = req.body.role;
  if (!name) return fail(res, 400, 'Введите имя');
  if (!['customer', 'courier'].includes(role)) return fail(res, 400, 'Выберите роль');
  const user = db.users.find((u) => !u.isDemo && u.name === name && u.role === role) ?? createUser({ name, role });
  res.json(privateUser(user));
});

app.get('/api/me', auth, (req, res) => res.json(privateUser(req.user)));

app.patch('/api/me/location', auth, (req, res) => {
  const { lat, lng } = req.body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'Некорректные координаты');
  req.user.location = { lat, lng };
  save();
  const active = req.user.role === 'courier' && activeOrderOf(req.user);
  if (active) emitCourierLocation(active, req.user.location);
  res.json({ ok: true });
});

app.get('/api/stores', (req, res) => res.json(STORES));

app.get('/api/route', wrap(async (req, res) => {
  const points = String(req.query.points ?? '')
    .split(';')
    .map((p) => p.split(',').map(Number))
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    .map(([lat, lng]) => ({ lat, lng }));
  if (points.length < 2 || points.length > 5) return fail(res, 400, 'Нужно 2–5 точек');
  const route = await buildRoute(points);
  res.json({ ...route, pickupIndex: route.legs[0].coords.length - 1, legs: undefined });
}));

app.get('/api/orders/open', auth, onlyRole('courier'), (req, res) => {
  res.json(db.orders.filter((o) => o.status === 'new').map(serializeOrder));
});

app.get('/api/orders/my', auth, (req, res) => {
  const key = req.user.role === 'courier' ? 'courierId' : 'customerId';
  res.json(db.orders.filter((o) => o[key] === req.user.id).sort((a, b) => b.createdAt - a.createdAt).map(serializeOrder));
});

app.get('/api/orders/:id', auth, (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Заказ не найден');
  res.json(serializeOrder(order));
});

app.post('/api/orders', auth, onlyRole('customer'), wrap(async (req, res) => {
  res.json(serializeOrder(await placeOrder(req.user, req.body)));
}));

app.post('/api/orders/:id/cancel', auth, onlyRole('customer'), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order || order.customerId !== req.user.id) return fail(res, 404, 'Заказ не найден');
  if (order.status !== 'new') return fail(res, 409, 'Курьер уже взял заказ — отменить нельзя');
  order.status = 'cancelled';
  save();
  emitOrder(order);
  emitOpenOrdersChanged();
  res.json(serializeOrder(order));
});

app.post('/api/orders/:id/accept', auth, onlyRole('courier'), wrap(async (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Заказ не найден');
  res.json(serializeOrder(await acceptOrder(req.user, order)));
}));

app.post('/api/orders/:id/status', auth, onlyRole('courier'), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Заказ не найден');
  res.json(serializeOrder(setOrderStatus(req.user, order, req.body.status)));
});

app.post('/api/orders/:id/simulate', auth, onlyRole('courier'), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order || order.courierId !== req.user.id || !ACTIVE.includes(order.status)) return fail(res, 409, 'Нет активного заказа');
  startSimulation(order, { autoDeliver: Boolean(req.body.autoDeliver) });
  res.json({ ok: true });
});

app.post('/api/orders/:id/rate', auth, (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Заказ не найден');
  if (order.status !== 'delivered') return fail(res, 409, 'Оценить можно только доставленный заказ');
  const stars = Math.round(Number(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) return fail(res, 400, 'Оценка от 1 до 5');
  const comment = String(req.body.comment ?? '').slice(0, 200);
  const isCustomer = req.user.id === order.customerId;
  const isCourier = req.user.id === order.courierId;
  if (!isCustomer && !isCourier) return fail(res, 403, 'Это не ваш заказ');
  const field = isCustomer ? 'ratingByCustomer' : 'ratingByCourier';
  if (order[field]) return fail(res, 409, 'Вы уже оценили этот заказ');
  const target = findUser(isCustomer ? order.courierId : order.customerId);
  order[field] = { stars, comment, at: Date.now() };
  target.ratings.push({ from: req.user.id, fromName: req.user.name, orderId: order.id, stars, comment, at: Date.now() });
  req.user.stats.ratingsGiven++;
  addPoints(req.user, 5, 'Спасибо за оценку');
  if (stars === 5) addPoints(target, 15, 'Вам поставили 5★');
  save();
  checkAchievements(req.user);
  checkAchievements(target);
  emitMe(target);
  emitOrder(order);
  res.json(serializeOrder(order));
});

app.get('/api/achievements', auth, (req, res) => res.json(achievementsFor(req.user)));

app.get('/api/prizes', auth, (req, res) => res.json(PRIZES.filter((p) => p.roles.includes(req.user.role))));

app.post('/api/prizes/:id/buy', auth, (req, res) => {
  const prize = findPrize(req.params.id);
  if (!prize || !prize.roles.includes(req.user.role)) return fail(res, 404, 'Приз не найден');
  if (prize.effect === 'frame' && req.user.frame) return fail(res, 409, 'Рамка уже есть');
  if (req.user.points < prize.cost) return fail(res, 409, `Не хватает ${prize.cost - req.user.points} баллов`);
  req.user.points -= prize.cost;
  const purchase = { id: newId('p'), prizeId: prize.id, title: prize.title, icon: prize.icon, cost: prize.cost, code: `MGM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, at: Date.now() };
  req.user.purchases.unshift(purchase);
  if (prize.effect === 'frame') req.user.frame = 'gold';
  if (prize.effect === 'freeDelivery') req.user.perks.freeDelivery++;
  if (prize.effect === 'discount10') req.user.perks.discount10++;
  req.user.stats.purchases++;
  save();
  checkAchievements(req.user);
  emitMe(req.user);
  res.json({ purchase, me: privateUser(req.user) });
});

app.get('/api/leaderboard', (req, res) => {
  const rank = (role) =>
    db.users
      .filter((u) => u.role === role)
      .map((u) => ({ ...publicUser(u), totalEarned: u.totalEarned }))
      .sort((a, b) => (b.rating.avg ?? 0) - (a.rating.avg ?? 0) || b.rating.count - a.rating.count || b.totalEarned - a.totalEarned)
      .slice(0, 20);
  res.json({ couriers: rank('courier'), customers: rank('customer') });
});

app.get('/api/users/:id', (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return fail(res, 404, 'Пользователь не найден');
  res.json({ ...publicUser(user), reviews: user.ratings.slice(-10).reverse(), achievements: achievementsFor(user).filter((a) => a.unlockedAt) });
});

setupDemo(app, { placeOrder, acceptOrder, wrap });

// ---------- Ошибки и статика ----------

app.use('/api', (req, res) => fail(res, 404, 'Нет такого метода'));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  fail(res, err.status ?? 500, err.status ? err.message : 'Внутренняя ошибка сервера');
});

const dist = path.resolve(import.meta.dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`Мигом API: http://localhost:${PORT}`);
  if (fs.existsSync(dist)) console.log(`Собранный клиент: http://localhost:${PORT}`);
});

