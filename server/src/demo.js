// Демонстрационный режим: готовые клиент и курьер, история, открытые заказы и автосценарий.
import { STORES } from './catalog.js';
import { checkAchievements } from './gamification.js';
import { startSimulation } from './simulation.js';
import { createUser, db, findUser, save } from './store.js';

export const DEMO_CUSTOMER = 'demo_customer';
export const DEMO_COURIER = 'demo_courier';
const HOME = { lat: 55.7536, lng: 37.6398, address: 'ул. Солянка, 1 (демо-адрес)' };

const NPC = [
  { id: 'demo_c1', name: 'Мария К.', role: 'customer', stars: [5, 5, 5, 5, 4] },
  { id: 'demo_c2', name: 'Игорь П.', role: 'customer', stars: [4, 4, 5, 3] },
  { id: 'demo_c3', name: 'Ольга С.', role: 'customer', stars: [5, 5, 5] },
  { id: 'demo_c4', name: 'Сергей Л.', role: 'customer', stars: [3, 4, 4, 3, 5] },
  { id: 'demo_k1', name: 'Алексей В.', role: 'courier', stars: [5, 4, 5, 5, 4, 5], delivered: 12, km: 31.5 },
  { id: 'demo_k2', name: 'Камила Р.', role: 'courier', stars: [5, 5, 5, 5, 5, 5, 4, 5], delivered: 30, km: 74.2 },
];

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
  { lat: 55.7440, lng: 37.6010, address: 'ул. Остоженка, 7' },
  { lat: 55.7337, lng: 37.6434, address: 'ул. Большая Татарская, 5' },
  { lat: 55.7604, lng: 37.6626, address: 'ул. Земляной Вал, 33' },
  { lat: 55.7731, lng: 37.5970, address: 'ул. Малая Дмитровка, 23' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function seedRatings(user, stars) {
  user.ratings = stars.map((s, i) => ({ from: 'demo', fromName: 'Демо-пользователь', orderId: null, stars: s, comment: s === 5 ? 'Всё отлично!' : '', at: Date.now() - (i + 1) * 86400000 }));
}

export async function resetDemo({ placeOrder }) {
  const demoIds = new Set([DEMO_CUSTOMER, DEMO_COURIER, ...NPC.map((n) => n.id)]);
  db.orders = db.orders.filter((o) => !demoIds.has(o.customerId) && !demoIds.has(o.courierId));
  db.users = db.users.filter((u) => !demoIds.has(u.id));

  const customer = createUser({ id: DEMO_CUSTOMER, name: 'Анна (демо)', role: 'customer', isDemo: true, location: HOME });
  seedRatings(customer, [5, 5, 4, 5]);
  const courier = createUser({ id: DEMO_COURIER, name: 'Дмитрий (демо)', role: 'courier', isDemo: true, location: { lat: 55.7577, lng: 37.6262 } });
  seedRatings(courier, [5, 5, 5, 4, 5]);
  Object.assign(courier.stats, { delivered: 4, distanceKm: 7.4 });

  for (const n of NPC) {
    const u = createUser({ id: n.id, name: n.name, role: n.role, isDemo: true });
    seedRatings(u, n.stars);
    if (n.delivered) Object.assign(u.stats, { delivered: n.delivered, distanceKm: n.km });
    checkAchievements(u);
  }
  checkAchievements(courier);
  // Стартовые баллы, чтобы сразу можно было зайти в магазин призов.
  customer.points = 450;
  courier.points = 720;

  // Открытые заказы от других клиентов — их курьер увидит на карте.
  const customers = NPC.filter((n) => n.role === 'customer');
  for (let i = 0; i < 4; i++) {
    await placeOrder(findUser(customers[i].id), {
      storeId: STORES[[0, 3, 7, 4][i]].id,
      items: BASKETS[[0, 2, 3, 5][i]],
      dropoff: DROPOFFS[i],
      comment: ['Домофон 12, 4 этаж', 'Позвоните за 5 минут', 'Это сюрприз — не звоните в дверь 🙂', ''][i],
    });
  }
  save();
  return { customerId: DEMO_CUSTOMER, courierId: DEMO_COURIER };
}

export function setupDemo(app, { placeOrder, acceptOrder, wrap }) {
  app.post('/api/demo/reset', wrap(async (req, res) => res.json(await resetDemo({ placeOrder }))));

  // Автосценарий: Анна оформляет заказ → Дмитрий берёт его → едет в магазин → везёт клиенту.
  app.post('/api/demo/autoplay', wrap(async (req, res) => {
    const customer = findUser(DEMO_CUSTOMER);
    const courier = findUser(DEMO_COURIER);
    if (!customer || !courier) return res.status(409).json({ error: 'Сначала запустите демо' });
    const busy = db.orders.find((o) => ['new', 'accepted', 'picked'].includes(o.status) && (o.courierId === courier.id || o.customerId === customer.id));
    if (busy) return res.status(409).json({ error: 'У демо-пользователей уже есть активный заказ' });

    const order = await placeOrder(customer, {
      storeId: pick([STORES[1], STORES[8], STORES[2], STORES[5]]).id,
      items: pick(BASKETS),
      dropoff: customer.location ?? HOME,
      comment: 'Демо-заказ: оставьте у двери',
    });
    setTimeout(async () => {
      try {
        await acceptOrder(courier, order);
        setTimeout(() => startSimulation(order, { autoDeliver: true }), 1500);
      } catch (e) {
        console.warn('autoplay:', e.message);
      }
    }, 3000);
    res.json({ orderId: order.id });
  }));

  if (!findUser(DEMO_CUSTOMER)) resetDemo({ placeOrder }).then(() => console.log('Демо-данные созданы'));
}
