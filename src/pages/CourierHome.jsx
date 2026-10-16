import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fetchRoute, km, rub, STATUS } from '../api.js';
import { Popup } from 'react-leaflet';
import { BaseMap, FitBounds, PinMarker, RouteLine } from '../components/MapKit.jsx';
import { ItemsList, Modal, RateForm, Steps, UserLine } from '../components/ui.jsx';
import { useToast, useUser } from '../UserContext.jsx';

const DEFAULT_LOC = { lat: 55.7558, lng: 37.6173 };

export default function CourierHome() {
  const { me, socket } = useUser();
  const toast = useToast();
  const [open, setOpen] = useState([]);
  const [mine, setMine] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loc, setLoc] = useState(me.location ?? DEFAULT_LOC);
  const [placing, setPlacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState([]);

  const loadOpen = useCallback(() => api('/orders/open').then(setOpen), []);
  useEffect(() => {
    loadOpen();
    api('/orders/my').then(setMine);
  }, [loadOpen]);

  useEffect(() => {
    if (!socket) return;
    const onOrder = (o) => setMine((list) => (list?.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [o, ...(list ?? [])]));
    const onLoc = (p) => setLoc({ lat: p.lat, lng: p.lng });
    socket.on('orders:changed', loadOpen);
    socket.on('order:update', onOrder);
    socket.on('courier:location', onLoc);
    return () => {
      socket.off('orders:changed', loadOpen);
      socket.off('order:update', onOrder);
      socket.off('courier:location', onLoc);
    };
  }, [socket, loadOpen]);

  const active = useMemo(
    () =>
      mine?.find((o) => ['accepted', 'picked'].includes(o.status)) ??
      mine?.find((o) => o.status === 'delivered' && !o.ratingByCourier && !dismissed.includes(o.id) && Date.now() - o.deliveredAt < 3 * 3600e3),
    [mine, dismissed],
  );
  const selected = open.find((o) => o.id === selectedId);

  // Если выбранный заказ забрал кто-то другой — сбрасываем выбор.
  useEffect(() => {
    if (selectedId && !selected) {
      setSelectedId(null);
      setPreview(null);
    }
  }, [selectedId, selected]);

  // Маршрут курьер → магазин → клиент для выбранного заказа.
  useEffect(() => {
    if (!selected || active) return setPreview(null);
    let cancelled = false;
    fetchRoute([loc, selected.store, selected.dropoff]).then((r) => !cancelled && setPreview(r));
    return () => (cancelled = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, active?.id]);

  async function updateLocation(p) {
    setLoc(p);
    setPlacing(false);
    await api('/me/location', { method: 'PATCH', body: { lat: p.lat, lng: p.lng } });
  }

  function useGeolocation() {
    if (!navigator.geolocation) return toast({ kind: 'error', icon: '⚠️', title: 'Геолокация недоступна' });
    navigator.geolocation.getCurrentPosition(
      (pos) => updateLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => toast({ kind: 'error', icon: '⚠️', title: 'Не удалось получить геопозицию' }),
    );
  }

  async function accept() {
    setConfirming(false);
    try {
      const o = await api(`/orders/${selected.id}/accept`, { method: 'POST' });
      setMine((list) => [o, ...(list ?? []).filter((x) => x.id !== o.id)]);
      setSelectedId(null);
      loadOpen();
      toast({ icon: '🛵', title: `Заказ №${o.number} ваш!`, text: `Езжайте в ${o.store.name}` });
    } catch (err) {
      toast({ kind: 'error', icon: '⚠️', title: err.message });
      loadOpen();
    }
  }

  async function act(path, body) {
    try {
      const o = await api(`/orders/${active.id}/${path}`, { method: 'POST', body });
      if (o.id) setMine((list) => list.map((x) => (x.id === o.id ? o : x)));
    } catch (err) {
      toast({ kind: 'error', icon: '⚠️', title: err.message });
    }
  }

  const sortedOpen = [...open].sort((a, b) => km(loc, a.store) - km(loc, b.store));
  const route = active?.status !== 'delivered' ? active?.route : null;

  return (
    <div className="split">
      <div className={`map-wrap ${placing ? 'placing' : ''}`}>
        <BaseMap onClick={placing ? updateLocation : undefined}>
          {active ? (
            <>
              <PinMarker position={active.store} emoji={active.store.icon} kind="store-active" title={active.store.name} />
              <PinMarker position={active.dropoff} emoji="🏠" kind="home" title={active.dropoff.address} />
            </>
          ) : (
            open.map((o) => (
              <PinMarker
                key={o.id}
                position={o.store}
                emoji={o.store.icon}
                kind={o.id === selectedId ? 'order-active' : 'order'}
                badge={`+${o.reward}`}
                title={`${o.store.name} — ${rub(o.itemsTotal)}`}
                onClick={() => setSelectedId(o.id)}
              >
                <Popup>
                  <OrderPopup order={o} route={o.id === selectedId ? preview : null} onAccept={() => { setSelectedId(o.id); setConfirming(true); }} />
                </Popup>
              </PinMarker>
            ))
          )}
          {selected && !active && <PinMarker position={selected.dropoff} emoji="🏠" kind="home" title={selected.dropoff.address} />}
          {(route || preview) && <RouteLine route={route ?? preview} />}
          <PinMarker position={loc} emoji="🛵" kind="courier" title="Вы здесь" />
          <FitBounds points={active ? [loc, active.store, active.dropoff] : selected ? [loc, selected.store, selected.dropoff] : [loc]} deps={[active?.id, selectedId]} />
        </BaseMap>
        <div className="map-tools">
          <button className={`btn btn-sm ${placing ? 'btn-primary' : 'btn-white'}`} onClick={() => setPlacing((p) => !p)}>
            {placing ? 'Кликните на карту…' : '📍 Указать моё место'}
          </button>
          <button className="btn btn-sm btn-white" onClick={useGeolocation}>
            🎯 Геолокация
          </button>
        </div>
      </div>

      <aside className="panel">
        {mine === null ? (
          <div className="muted">Загрузка…</div>
        ) : active ? (
          <ActiveDelivery
            order={active}
            loc={loc}
            onPicked={() => act('status', { status: 'picked' })}
            onDelivered={() => act('status', { status: 'delivered' })}
            onSimulate={() => act('simulate', { autoDeliver: false })}
            onRate={async (stars, comment) => {
              await act('rate', { stars, comment });
              toast({ icon: '⭐', title: 'Оценка отправлена' });
            }}
            onClose={() => setDismissed((d) => [...d, active.id])}
          />
        ) : selected ? (
          <OrderDetails order={selected} loc={loc} route={preview} onBack={() => setSelectedId(null)} onAccept={() => setConfirming(true)} />
        ) : (
          <>
            <div className="panel-head">
              <h2>Заказы рядом</h2>
              <span className="pill">{open.length}</span>
            </div>
            <p className="muted small">Нажмите на метку на карте или на заказ в списке, чтобы увидеть детали и маршрут.</p>
            {!open.length && <div className="empty">Пока нет свободных заказов. Новые появятся автоматически.</div>}
            <div className="order-list">
              {sortedOpen.map((o) => (
                <button key={o.id} className="order-card" onClick={() => setSelectedId(o.id)}>
                  <span className="order-icon">{o.store.icon}</span>
                  <span className="order-main">
                    <b>{o.store.name}</b>
                    <span className="muted small">
                      {o.items.length} поз. · {rub(o.itemsTotal)} · {km(loc, o.store).toFixed(1)} км от вас
                    </span>
                    <span className="small">
                      {o.customer.name} · <span className="rating">★ {o.customer.rating.avg?.toFixed(1) ?? 'нов.'}</span>
                    </span>
                  </span>
                  <span className="reward">+{o.reward} 🪙</span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      {confirming && selected && (
        <Modal onClose={() => setConfirming(false)}>
          <h2>Взять заказ №{selected.number}?</h2>
          <p>
            Нужно купить {selected.items.length} поз. в «{selected.store.name}» на ~{rub(selected.itemsTotal)} и доставить по адресу {selected.dropoff.address}.
          </p>
          <p className="muted">
            Маршрут {preview ? `${preview.distanceKm.toFixed(1)} км, ~${preview.durationMin} мин` : 'строится…'} · награда <b>+{selected.reward} баллов</b>
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={accept}>
              Подтвердить выбор
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OrderDetails({ order, loc, route, onBack, onAccept }) {
  return (
    <div className="details">
      <button className="link-btn" onClick={onBack}>
        ← Все заказы
      </button>
      <div className="panel-head">
        <h2>Заказ №{order.number}</h2>
        <span className="reward reward-big">+{order.reward} 🪙</span>
      </div>

      <div className="card-soft">
        <div className="muted small">Клиент</div>
        <UserLine user={order.customer} subtitle={`${order.customer.orders} заказов`} />
      </div>

      <div className="card-soft">
        <div className="muted small">Купить в магазине</div>
        <div className="store-line">
          <span className="order-icon">{order.store.icon}</span>
          <div>
            <b>{order.store.name}</b>
            <div className="muted small">{order.store.address}</div>
          </div>
        </div>
        <ItemsList items={order.items} />
        <div className="summary">
          <div className="total">
            <span>Сумма покупки</span>
            <b>{rub(order.itemsTotal - order.discount)}</b>
          </div>
        </div>
      </div>

      <div className="card-soft">
        <div className="muted small">Доставить</div>
        <div>🏠 {order.dropoff.address}</div>
        {order.comment && <div className="comment">💬 {order.comment}</div>}
      </div>

      <div className="route-stats">
        <div>
          <b>{km(loc, order.store).toFixed(1)} км</b>
          <span>до магазина</span>
        </div>
        <div>
          <b>{route ? `${route.distanceKm.toFixed(1)} км` : '…'}</b>
          <span>весь маршрут</span>
        </div>
        <div>
          <b>{route ? `~${route.durationMin} мин` : '…'}</b>
          <span>в пути</span>
        </div>
      </div>
      <div className="legend small muted">
        <span className="lg lg-blue" /> к магазину <span className="lg lg-orange" /> к клиенту
      </div>

      <div className="sticky-actions">
        <button className="btn btn-primary btn-lg" onClick={onAccept}>
          Взять заказ · +{order.reward} 🪙
        </button>
      </div>
    </div>
  );
}

function OrderPopup({ order, route, onAccept }) {
  const rest = order.items.length - 3;
  return (
    <div className="popup">
      <div className="popup-head">
        <b>
          {order.store.icon} {order.store.name}
        </b>
        <span className="reward">+{order.reward} 🪙</span>
      </div>
      <div className="popup-row">
        <span>
          👤 {order.customer.name}
        </span>
        <span className="rating">{order.customer.rating.count ? `★ ${order.customer.rating.avg.toFixed(2)}` : 'новичок'}</span>
      </div>
      <div>
        <span className="muted">Купить:</span>
        <ul className="popup-items">
          {order.items.slice(0, 3).map((it, i) => (
            <li key={i}>
              {it.name} × {it.qty}
            </li>
          ))}
          {rest > 0 && <li className="muted">и ещё {rest}</li>}
        </ul>
      </div>
      <div className="popup-row">
        <span className="muted">Сумма покупки</span>
        <b>{rub(order.itemsTotal - order.discount)}</b>
      </div>
      <div className="popup-row">
        <span className="muted">🏠 {order.dropoff.address}</span>
      </div>
      <div className="popup-row">
        <span className="muted">Маршрут</span>
        <b>{route ? `${route.distanceKm.toFixed(1)} км · ~${route.durationMin} мин` : 'строится…'}</b>
      </div>
      <button className="btn btn-primary" onClick={onAccept}>
        Взять заказ
      </button>
    </div>
  );
}

function ActiveDelivery({ order, loc, onPicked, onDelivered, onSimulate, onRate, onClose }) {
  const target = order.status === 'accepted' ? order.store : order.dropoff;
  const dist = km(loc, target);
  return (
    <div className="tracking">
      <div className="panel-head">
        <h2>Заказ №{order.number}</h2>
        <span className={`status status-${order.status}`}>{STATUS[order.status]}</span>
      </div>
      <Steps status={order.status} />

      {order.status !== 'delivered' && (
        <div className="card-soft next-step">
          <div className="muted small">{order.status === 'accepted' ? 'Следующая точка — магазин' : 'Следующая точка — клиент'}</div>
          <b>
            {order.status === 'accepted' ? `${order.store.icon} ${order.store.name}, ${order.store.address}` : `🏠 ${order.dropoff.address}`}
          </b>
          <div className="eta">≈ {dist < 1 ? `${Math.round(dist * 1000)} м` : `${dist.toFixed(1)} км`} по прямой</div>
        </div>
      )}


      {order.status === 'delivered' && (
        <>
          <div className="success card-soft">
            🎉 Доставлено! <b>+{order.reward} баллов</b>
          </div>
          {!order.ratingByCourier && <RateForm title="Оцените клиента" onSubmit={onRate} />}
          <button className="btn btn-ghost" onClick={onClose}>
            К новым заказам
          </button>
        </>
      )}

      <div className="card-soft">
        <div className="muted small">Клиент</div>
        <UserLine user={order.customer} />
        {order.comment && <div className="comment">💬 {order.comment}</div>}
      </div>

      <div className="card-soft">
        <div className="muted small">Список покупок — отмечайте купленное</div>
        <ItemsList items={order.items} checkable={order.status === 'accepted'} />
        <div className="summary">
          <div className="total">
            <span>К оплате в магазине</span>
            <b>{rub(order.itemsTotal - order.discount)}</b>
          </div>
        </div>
      </div>

      {order.status !== 'delivered' && (
        <div className="sticky-actions">
          {order.status === 'accepted' ? (
            <button className="btn btn-primary btn-lg" onClick={onPicked}>
              ✅ Товары куплены, еду к клиенту
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={onDelivered}>
              📦 Заказ доставлен
            </button>
          )}
          <button className="btn btn-ghost" onClick={onSimulate}>
            ▶ Демо: проехать маршрут автоматически
          </button>
        </div>
      )}
    </div>
  );
}
