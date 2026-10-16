import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export const MOSCOW = [55.7539, 37.6208];

export function BaseMap({ children, onClick, center = MOSCOW, zoom = 13 }) {
  return (
    <MapContainer center={center} zoom={zoom} className="map" zoomControl={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={onClick} />
      {children}
    </MapContainer>
  );
}

function ClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

const iconCache = new Map();
export function pin(emoji, kind = 'default', badge = '') {
  const key = `${emoji}|${kind}|${badge}`;
  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: '',
        html: `<div class="pin pin-${kind}"><span>${emoji}</span>${badge ? `<b class="pin-badge">${badge}</b>` : ''}</div>`,
        iconSize: [40, 48],
        iconAnchor: [20, 46],
      }),
    );
  }
  return iconCache.get(key);
}

export function courierIcon() {
  return pin('🛵', 'courier');
}

export function PinMarker({ position, emoji, kind, badge, onClick, title, children }) {
  if (!position) return null;
  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={pin(emoji, kind, badge)}
      title={title}
      eventHandlers={onClick ? { click: (e) => { L.DomEvent.stopPropagation(e); onClick(); } } : undefined}
    >
      {children}
    </Marker>
  );
}

// Маршрут: до магазина — пунктир, от магазина до клиента — сплошная линия.
export function RouteLine({ route, preview }) {
  if (!route?.coords?.length) return null;
  const split = route.pickupIndex ?? 0;
  const toStore = route.coords.slice(0, split + 1);
  const toClient = route.coords.slice(split);
  const hasTwoLegs = split > 0 && split < route.coords.length - 1;
  return (
    <>
      <Polyline positions={route.coords} pathOptions={{ color: '#fff', weight: 9, opacity: 0.9 }} />
      {hasTwoLegs && <Polyline positions={toStore} pathOptions={{ color: '#2f80ed', weight: 5, dashArray: '8 10' }} />}
      <Polyline positions={hasTwoLegs ? toClient : route.coords} pathOptions={{ color: preview ? '#ff9a6b' : '#ff6b2c', weight: 5, dashArray: preview ? '6 8' : undefined }} />
    </>
  );
}

export function FitBounds({ points, deps }) {
  const map = useMap();
  useEffect(() => {
    const valid = points.filter(Boolean).map((p) => (Array.isArray(p) ? p : [p.lat, p.lng]));
    if (valid.length >= 2) map.fitBounds(valid, { padding: [60, 60], maxZoom: 16 });
    else if (valid.length === 1) map.setView(valid[0], Math.max(map.getZoom(), 14));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return null;
}
