// Сессия: JWT-токен. В демо (?as=demo_customer) у каждого iframe своя сессия в window.name,
// иначе токен хранится в localStorage.
const params = new URLSearchParams(window.location.search);
const PREFIX = 'migom:';
const TOKEN_KEY = 'migom:token';

function readFrameSession() {
  try {
    return window.name.startsWith(PREFIX) ? JSON.parse(window.name.slice(PREFIX.length)) : null;
  } catch {
    return null;
  }
}
const writeFrameSession = (session) => (window.name = PREFIX + JSON.stringify(session));

if (params.get('as')) writeFrameSession({ demoAs: params.get('as'), token: null });

export const embedded = params.has('embed') || window.self !== window.top;
export const demoAs = () => readFrameSession()?.demoAs ?? null;

export function getToken() {
  const frame = readFrameSession();
  if (frame) return frame.token;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  const frame = readFrameSession();
  if (frame) return writeFrameSession({ ...frame, token });
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // приватный режим — сессия проживёт до перезагрузки
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
