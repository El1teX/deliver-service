// Демо-симуляция: курьер едет по построенному маршруту, сервер рассылает его координаты.
import { emitCourierLocation, setOrderStatus } from './index.js';
import { haversineKm } from './routing.js';
import { findOrder, findUser, save } from './store.js';

const TICK_MS = 400;
const running = new Map();

export function stopSimulation(orderId) {
  clearInterval(running.get(orderId));
  running.delete(orderId);
}

export function startSimulation(order, { autoDeliver = false } = {}) {
  stopSimulation(order.id);
  const coords = order.route.coords.map(([lat, lng]) => ({ lat, lng }));
  // Накопленная дистанция до каждой точки маршрута.
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  const total = cum.at(-1) || 0.001;
  const pickupDist = cum[Math.min(order.route.pickupIndex ?? 0, cum.length - 1)];

  // Вся поездка занимает 30–75 секунд независимо от длины — чтобы демо было наглядным.
  const durationMs = Math.min(75000, Math.max(30000, total * 7000));
  const step = total / (durationMs / TICK_MS);

  // Если заказ уже забран, начинаем от магазина.
  let s = order.status === 'picked' ? pickupDist : 0;
  let pause = 0;
  let segment = 0;

  const timer = setInterval(() => {
    const current = findOrder(order.id);
    const courier = findUser(current?.courierId);
    if (!current || !courier || !['accepted', 'picked'].includes(current.status)) return stopSimulation(order.id);
    if (pause > 0) return pause--;

    s = Math.min(total, s + step);
    while (segment < cum.length - 2 && cum[segment + 1] < s) segment++;
    const a = coords[segment];
    const b = coords[segment + 1] ?? a;
    const len = cum[segment + 1] - cum[segment] || 1;
    const t = Math.min(1, (s - cum[segment]) / len);
    courier.location = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    emitCourierLocation(current, courier.location);

    if (current.status === 'accepted' && s >= pickupDist) {
      setOrderStatus(courier, current, 'picked');
      pause = 6; // «покупает товары» пару секунд
    }
    if (s >= total) {
      stopSimulation(order.id);
      save();
      if (autoDeliver) setTimeout(() => current.status === 'picked' && setOrderStatus(courier, current, 'delivered'), 1500);
    }
  }, TICK_MS);
  running.set(order.id, timer);
}
