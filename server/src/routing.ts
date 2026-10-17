// Построение маршрутов: OSRM (по дорогам), при недоступности — прямые линии.
import { config } from './config';

export type Point = { lat: number; lng: number };
type Leg = { coords: [number, number][]; distanceKm: number; durationMin: number; source: 'osrm' | 'line' };
export type Route = { coords: [number, number][]; distanceKm: number; durationMin: number; pickupIndex: number; source: 'osrm' | 'line' };

const cache = new Map<string, Leg>();

export function haversineKm(a: Point, b: Point) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function lineLeg(a: Point, b: Point): Leg {
  const km = haversineKm(a, b) * 1.3;
  return { coords: [[a.lat, a.lng], [b.lat, b.lng]], distanceKm: km, durationMin: (km / 20) * 60, source: 'line' };
}

async function legRoute(a: Point, b: Point): Promise<Leg> {
  if (config.routing === 'line') return lineLeg(a, b);
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join(',');
  const cached = cache.get(key);
  if (cached) return cached;
  let leg: Leg;
  try {
    const url = `${config.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as { routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[] };
    const r = json.routes?.[0];
    if (!r) throw new Error('no route');
    leg = {
      coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      source: 'osrm',
    };
  } catch {
    leg = lineLeg(a, b);
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, leg);
  return leg;
}

// points: [{lat,lng}, ...] → маршрут по всем точкам; pickupIndex — индекс конца первого участка (магазин).
export async function buildRoute(points: Point[]): Promise<Route> {
  const pairs = points.slice(1).map((p, i) => [points[i], p] as const);
  const legs = await Promise.all(pairs.map(([a, b]) => legRoute(a, b)));
  return {
    coords: legs.flatMap((l) => l.coords),
    pickupIndex: legs[0].coords.length - 1,
    distanceKm: Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 100) / 100,
    durationMin: Math.round(legs.reduce((s, l) => s + l.durationMin, 0)),
    source: legs.every((l) => l.source === 'osrm') ? 'osrm' : 'line',
  };
}
