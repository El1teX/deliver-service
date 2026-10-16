// Идентификатор пользователя: из ?as= (демо в iframe) — хранится в window.name, чтобы
// у каждого iframe была своя сессия; иначе — из localStorage.
const params = new URLSearchParams(window.location.search);
const PREFIX = 'migom:';
if (params.get('as')) window.name = PREFIX + params.get('as');

export const embedded = params.has('embed') || window.self !== window.top;
const sessionUser = () => (window.name.startsWith(PREFIX) ? window.name.slice(PREFIX.length) : null);

export function getUserId() {
  return sessionUser() ?? localStorage.getItem('migom:user');
}

export function setUserId(id) {
  if (sessionUser()) {
    window.name = id ? PREFIX + id : '';
    return;
  }
  if (id) localStorage.setItem('migom:user', id);
  else localStorage.removeItem('migom:user');
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-user-id': getUserId() ?? '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Ошибка сети');
  return data;
}

export const fetchRoute = (points) => api(`/route?points=${points.map((p) => `${p.lat},${p.lng}`).join(';')}`);

export const STATUS = {
  new: 'Ищем курьера',
  accepted: 'Курьер едет в магазин',
  picked: 'Курьер везёт заказ',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

export const rub = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

export function km(a, b) {
  const R = 6371;
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
