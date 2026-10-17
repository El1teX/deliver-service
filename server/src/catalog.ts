// Статические справочники: магазины, достижения, призы.
import type { Role } from '@prisma/client';

export type Stats = {
  orders: number;
  maxOrder: number;
  nightOrders: number;
  ratingsGiven: number;
  delivered: number;
  distanceKm: number;
  fastDeliveries: number;
  purchases: number;
};
export type RatingSummary = { avg: number | null; count: number };

type Achievement = {
  id: string;
  role: Role | 'any';
  icon: string;
  title: string;
  desc: string;
  points: number;
  check: (s: Stats, rating: RatingSummary) => boolean;
  goal?: (s: Stats) => [number, number];
};

export type Prize = { id: string; icon: string; title: string; desc: string; cost: number; roles: Role[]; effect?: 'frame' | 'freeDelivery' | 'discount10' };

export const STORES = [
  { id: 's1', name: 'Пятёрочка', type: 'Продукты', icon: '🛒', address: 'ул. Мясницкая, 24', lat: 55.7628, lng: 37.6368 },
  { id: 's2', name: 'ВкусВилл', type: 'Продукты', icon: '🥦', address: 'ул. Тверская, 18', lat: 55.7662, lng: 37.6035 },
  { id: 's3', name: 'Перекрёсток', type: 'Супермаркет', icon: '🏬', address: 'ул. Новый Арбат, 15', lat: 55.7524, lng: 37.5892 },
  { id: 's4', name: 'Аптека 36,6', type: 'Аптека', icon: '💊', address: 'ул. Покровка, 12', lat: 55.7590, lng: 37.6455 },
  { id: 's5', name: 'Азбука вкуса', type: 'Деликатесы', icon: '🧀', address: 'Смоленская пл., 3', lat: 55.7478, lng: 37.5826 },
  { id: 's6', name: 'Магнит', type: 'Продукты', icon: '🧲', address: 'ул. Таганская, 1', lat: 55.7412, lng: 37.6558 },
  { id: 's7', name: 'Даниловский рынок', type: 'Рынок', icon: '🍎', address: 'ул. Мытная, 74', lat: 55.7128, lng: 37.6205 },
  { id: 's8', name: 'Цветы «Флора»', type: 'Цветы', icon: '💐', address: 'ул. Пятницкая, 20', lat: 55.7405, lng: 37.6282 },
  { id: 's9', name: 'Хлебница', type: 'Пекарня', icon: '🥐', address: 'ул. Маросейка, 9', lat: 55.7572, lng: 37.6345 },
];


// check(stats, rating) → true, если достижение заработано.
export const ACHIEVEMENTS: Achievement[] = [
  // Клиент
  { id: 'first_order', role: 'customer', icon: '🎉', title: 'Первый заказ', desc: 'Оформите свой первый заказ', points: 50, check: (s) => s.orders >= 1 },
  { id: 'regular', role: 'customer', icon: '🛍️', title: 'Постоянный клиент', desc: 'Оформите 5 заказов', points: 120, check: (s) => s.orders >= 5, goal: (s) => [s.orders, 5] },
  { id: 'vip', role: 'customer', icon: '👑', title: 'VIP', desc: 'Оформите 15 заказов', points: 400, check: (s) => s.orders >= 15, goal: (s) => [s.orders, 15] },
  { id: 'big_basket', role: 'customer', icon: '🧺', title: 'Большая корзина', desc: 'Заказ на сумму от 3000 ₽', points: 80, check: (s) => s.maxOrder >= 3000 },
  { id: 'critic', role: 'customer', icon: '📝', title: 'Ценитель', desc: 'Оцените 3 курьеров', points: 60, check: (s) => s.ratingsGiven >= 3, goal: (s) => [s.ratingsGiven, 3] },
  { id: 'night_owl', role: 'customer', icon: '🦉', title: 'Ночная сова', desc: 'Сделайте заказ с 22:00 до 06:00', points: 40, check: (s) => s.nightOrders >= 1 },
  { id: 'loved_client', role: 'customer', icon: '💛', title: 'Любимый клиент', desc: 'Рейтинг от 4.8 по 3+ оценкам курьеров', points: 150, check: (_s, r) => r.count >= 3 && (r.avg ?? 0) >= 4.8 },
  // Курьер
  { id: 'first_delivery', role: 'courier', icon: '🚀', title: 'Первая доставка', desc: 'Выполните первую доставку', points: 50, check: (s) => s.delivered >= 1 },
  { id: 'city_rhythm', role: 'courier', icon: '🏙️', title: 'В ритме города', desc: 'Выполните 5 доставок', points: 120, check: (s) => s.delivered >= 5, goal: (s) => [s.delivered, 5] },
  { id: 'legend', role: 'courier', icon: '🏆', title: 'Легенда доставки', desc: 'Выполните 25 доставок', points: 500, check: (s) => s.delivered >= 25, goal: (s) => [s.delivered, 25] },
  { id: 'marathon', role: 'courier', icon: '🏃', title: 'Марафонец', desc: 'Проедьте 10 км с заказами', points: 100, check: (s) => s.distanceKm >= 10, goal: (s) => [Math.floor(s.distanceKm), 10] },
  { id: 'ultra', role: 'courier', icon: '🛣️', title: 'Ультрамарафонец', desc: 'Проедьте 50 км с заказами', points: 300, check: (s) => s.distanceKm >= 50, goal: (s) => [Math.floor(s.distanceKm), 50] },
  { id: 'lightning', role: 'courier', icon: '⚡', title: 'Молния', desc: 'Доставьте заказ быстрее 20 минут', points: 80, check: (s) => s.fastDeliveries >= 1 },
  { id: 'five_stars', role: 'courier', icon: '⭐', title: 'Пять звёзд', desc: 'Рейтинг от 4.8 по 3+ оценкам клиентов', points: 200, check: (_s, r) => r.count >= 3 && (r.avg ?? 0) >= 4.8 },
  // Общие
  { id: 'shopper', role: 'any', icon: '🎁', title: 'Шопоголик', desc: 'Купите приз за баллы', points: 30, check: (s) => s.purchases >= 1 },
  { id: 'collector', role: 'any', icon: '💎', title: 'Коллекционер', desc: 'Купите 5 призов', points: 150, check: (s) => s.purchases >= 5, goal: (s) => [s.purchases, 5] },
];

// effect — что приз делает в сервисе (если что-то делает).
export const PRIZES: Prize[] = [
  { id: 'gold_frame', icon: '🖼️', title: 'Золотая рамка', desc: 'Золотая рамка вокруг аватара — её видят все', cost: 100, roles: ['customer', 'courier'], effect: 'frame' },
  { id: 'coffee', icon: '☕', title: 'Кофе в подарок', desc: 'Купон на капучино в кофейнях-партнёрах', cost: 150, roles: ['customer', 'courier'] },
  { id: 'free_delivery', icon: '🚚', title: 'Бесплатная доставка', desc: 'Следующая доставка — за 0 ₽', cost: 200, roles: ['customer'], effect: 'freeDelivery' },
  { id: 'discount10', icon: '🏷️', title: 'Скидка 10%', desc: 'Скидка 10% на товары в следующем заказе', cost: 300, roles: ['customer'], effect: 'discount10' },
  { id: 'cinema', icon: '🎬', title: 'Билет в кино', desc: 'Электронный билет на любой сеанс', cost: 500, roles: ['customer', 'courier'] },
  { id: 'thermo_bag', icon: '🎒', title: 'Термосумка', desc: 'Фирменная термосумка «Мигом» на 40 л', cost: 400, roles: ['courier'] },
  { id: 'raincoat', icon: '🧥', title: 'Дождевик', desc: 'Светоотражающий дождевик курьера', cost: 350, roles: ['courier'] },
  { id: 'powerbank', icon: '🔋', title: 'Powerbank', desc: 'Внешний аккумулятор 10 000 мАч', cost: 600, roles: ['courier'] },
  { id: 'hoodie', icon: '👕', title: 'Худи «Мигом»', desc: 'Фирменное худи из лимитированной коллекции', cost: 900, roles: ['customer', 'courier'] },
  { id: 'scooter_day', icon: '🛴', title: 'Самокат на день', desc: 'Сутки аренды электросамоката', cost: 750, roles: ['courier'] },
];

export const findPrize = (id: string) => PRIZES.find((p) => p.id === id);
