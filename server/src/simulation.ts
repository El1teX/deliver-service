// Демо-симуляция: курьер едет по построенному маршруту, сервер рассылает его координаты.
import { prisma } from './db';
import { emitToUser } from './realtime';
import { haversineKm, type Point, type Route } from './routing';
import { markDelivered, markPicked } from './modules/orders';

const TICK_MS = 400;
const running = new Map<string, NodeJS.Timeout>();

export function stopSimulation(orderId: string) {
  clearInterval(running.get(orderId));
  running.delete(orderId);
}

export const stopAllSimulations = () => [...running.keys()].forEach(stopSimulation);

export async function startSimulation(orderId: string, { autoDeliver = false } = {}) {
  stopSimulation(orderId);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const route = order?.route as Route | null;
  if (!order?.courierId || !route) return;
  const courierId = order.courierId;

  const coords: Point[] = route.coords.map(([lat, lng]) => ({ lat, lng }));
  // Накопленная дистанция до каждой точки маршрута.
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  const total = cum.at(-1) || 0.001;
  const pickupDist = cum[Math.min(route.pickupIndex ?? 0, cum.length - 1)];

  // Вся поездка занимает 30–75 секунд независимо от длины — чтобы демо было наглядным.
  const durationMs = Math.min(75000, Math.max(30000, total * 7000));
  const step = total / (durationMs / TICK_MS);

  let status = order.status;
  let s = status === 'picked' ? pickupDist : 0;
  let pause = 0;
  let segment = 0;
  let busy = false;

  const timer = setInterval(async () => {
    if (busy) return;
    if (pause > 0) return void pause--;
    busy = true;
    try {
      s = Math.min(total, s + step);
      while (segment < cum.length - 2 && cum[segment + 1] < s) segment++;
      const a = coords[segment];
      const b = coords[segment + 1] ?? a;
      const len = cum[segment + 1] - cum[segment] || 1;
      const t = Math.min(1, (s - cum[segment]) / len);
      const loc = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };

      const current = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, customerId: true } });
      if (!current || !['accepted', 'picked'].includes(current.status)) return stopSimulation(orderId);
      await prisma.user.update({ where: { id: courierId }, data: loc });
      emitToUser(current.customerId, 'courier:location', { orderId, ...loc });
      emitToUser(courierId, 'courier:location', { orderId, ...loc });

      if (status === 'accepted' && s >= pickupDist) {
        await markPicked(courierId, orderId);
        status = 'picked';
        pause = 6; // «покупает товары» пару секунд
      }
      if (s >= total) {
        stopSimulation(orderId);
        if (autoDeliver) setTimeout(() => markDelivered(courierId, orderId).catch(() => {}), 1500);
      }
    } catch (e) {
      console.warn('simulation:', (e as Error).message);
      stopSimulation(orderId);
    } finally {
      busy = false;
    }
  }, TICK_MS);
  running.set(orderId, timer);
}
