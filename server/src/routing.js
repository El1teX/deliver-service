// Построение маршрутов: OSRM (по дорогам), при недоступности — прямые линии.

const OSRM = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const cache = new Map();

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function legRoute(a, b) {
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join(',');
  if (cache.has(key)) return cache.get(key);
  let leg;
  try {
    const url = `${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    const r = json.routes?.[0];
    if (!r) throw new Error('no route');
    leg = {
      coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      source: 'osrm',
    };
  } catch {
    const km = haversineKm(a, b) * 1.3;
    leg = { coords: [[a.lat, a.lng], [b.lat, b.lng]], distanceKm: km, durationMin: (km / 20) * 60, source: 'line' };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, leg);
  return leg;
}

// points: [{lat,lng}, ...] → { legs: [{coords, distanceKm, durationMin}], coords, distanceKm, durationMin }
export async function buildRoute(points) {
  const pairs = points.slice(1).map((p, i) => [points[i], p]);
  const legs = await Promise.all(pairs.map(([a, b]) => legRoute(a, b)));
  return {
    legs,
    coords: legs.flatMap((l) => l.coords),
    distanceKm: Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 100) / 100,
    durationMin: Math.round(legs.reduce((s, l) => s + l.durationMin, 0)),
    source: legs.every((l) => l.source === 'osrm') ? 'osrm' : 'line',
  };
}
