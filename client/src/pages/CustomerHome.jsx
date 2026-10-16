import { useEffect, useMemo, useState } from 'react';
import { api, fetchRoute, km, rub, STATUS } from '../api.js';
import { BaseMap, FitBounds, PinMarker, RouteLine } from '../components/MapKit.jsx';
import { ItemsList, RateForm, Steps, UserLine } from '../components/ui.jsx';
import { useToast, useUser } from '../UserContext.jsx';

const ACTIVE = ['new', 'accepted', 'picked'];
const SUGGESTIONS = ['Молоко', 'Хлеб', 'Яйца', 'Бананы', 'Кофе', 'Вода', 'Сыр', 'Цветы', 'Лекарство'];
const emptyItem = () => ({ name: '', qty: 1, price: '' });

export default function CustomerHome() {
  const { me, socket } = useUser();
  const toast = useToast();
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState(null);
  const [courierLoc, setCourierLoc] = useState(null);
  const [dismissed, setDismissed] = useState([]);

  // Форма заказа
  const [storeId, setStoreId] = useState(null);
  const [items, setItems] = useState([emptyItem()]);
  const [dropoff, setDropoff] = useState(() => me.location ?? { lat: 55.7536, lng: 37.6398 });
  const [address, setAddress] = useState(me.location?.address ?? '');
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/stores').then(setStores);
    api('/orders/my').then(setOrders);
  }, []);

  const current = useMemo(
    () =>
      orders?.find((o) => ACTIVE.includes(o.status)) ??
      orders?.find((o) => o.status === 'delivered' && !o.ratingByCustomer && !dismissed.includes(o.id) && Date.now() - o.deliveredAt < 3 * 3600e3),
    [orders, dismissed],
  );

  useEffect(() => {
    if (!socket) return;
    const onOrder = (o) => {
      setOrders((list) => (list?.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [o, ...(list ?? [])]));
      if (o.courier?.location) setCourierLoc(o.courier.location);
    };
    const onLoc = (p) => setCourierLoc({ lat: p.lat, lng: p.lng });
    socket.on('order:update', onOrder);
    socket.on('courier:location', onLoc);
    return () => {
      socket.off('order:update', onOrder);
      socket.off('courier:location', onLoc);
    };
  }, [socket]);

  // Уведомления о смене статуса
  const [lastStatus, setLastStatus] = useState(null);
  useEffect(() => {
    if (!current) return;
    const key = `${current.id}:${current.status}`;
    if (lastStatus && lastStatus !== key && lastStatus.startsWith(current.id)) {
      const text = { accepted: `${current.courier?.name} принял заказ`, picked: 'Курьер купил товары и едет к вам', delivered: 'Заказ доставлен! Оцените курьера' }[current.status];
      if (text) toast({ icon: '📦', title: STATUS[current.status], text });
    }
    setLastStatus(key);
    setCourierLoc(current.courier?.location ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.status]);

  const store = stores.find((s) => s.id === storeId);

  // Предпросмотр маршрута магазин → адрес
  useEffect(() => {
    if (current || !store) return setPreview(null);
    const t = setTimeout(() => fetchRoute([store, dropoff]).then(setPreview).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [store, dropoff, current]);

  const itemsTotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const discount = me.perks?.discount10 ? Math.round(itemsTotal * 0.1) : 0;
  const fee = preview ? (me.perks?.freeDelivery ? 0 : Math.round(99 + preview.distanceKm * 20)) : null;

  function setItem(i, patch) {
    setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const order = await api('/orders', { method: 'POST', body: { storeId, items, dropoff: { ...dropoff, address }, comment } });
      setOrders((list) => [order, ...(list ?? [])]);
      setItems([emptyItem()]);
      setComment('');
      toast({ icon: '✅', title: `Заказ №${order.number} оформлен`, text: 'Ищем курьера поблизости' });
    } catch (err) {
      toast({ kind: 'error', icon: '⚠️', title: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      const o = await api(`/orders/${current.id}/cancel`, { method: 'POST' });
      setOrders((list) => list.map((x) => (x.id === o.id ? o : x)));
    } catch (err) {
      toast({ kind: 'error', icon: '⚠️', title: err.message });
    }
  }

  async function rate(stars, text) {
    const o = await api(`/orders/${current.id}/rate`, { method: 'POST', body: { stars, comment: text } });
    setOrders((list) => list.map((x) => (x.id === o.id ? o : x)));
    toast({ icon: '⭐', title: 'Спасибо за оценку!' });
  }

  const route = current?.route ?? preview;
  const mapStores = current ? [current.store] : stores;
  const dest = current?.dropoff ?? dropoff;

  return (
    <div className="split">
      <div className="map-wrap">
        <BaseMap onClick={current ? undefined : setDropoff}>
          {mapStores.map((s) => (
            <PinMarker
              key={s.id}
              position={s}
              emoji={s.icon}
              kind={current || s.id === storeId ? 'store-active' : 'store'}
              title={s.name}
              onClick={current ? undefined : () => setStoreId(s.id)}
            />
          ))}
          <PinMarker position={dest} emoji="🏠" kind="home" title="Адрес доставки" />
          {route && <RouteLine route={route} preview={!current} />}
          {current && courierLoc && ACTIVE.includes(current.status) && <PinMarker position={courierLoc} emoji="🛵" kind="courier" title={current.courier?.name} />}
          <FitBounds points={current ? [current.store, current.dropoff, current.status !== 'new' ? courierLoc : null] : [store, dropoff]} deps={[current?.id, current?.status, storeId]} />
        </BaseMap>
        {!current && <div className="map-hint">Нажмите на карту, чтобы указать адрес доставки, и на магазин, чтобы выбрать его</div>}
      </div>

      <aside className="panel">
        {orders === null ? (
          <div className="muted">Загрузка…</div>
        ) : current ? (
          <Tracking order={current} courierLoc={courierLoc} onCancel={cancel} onRate={rate} onClose={() => setDismissed((d) => [...d, current.id])} />
        ) : (
          <form onSubmit={submit} className="order-form">
            <h2>Новый заказ</h2>

            <div className="field-label">1. Где купить</div>
            <div className="store-chips">
              {stores.map((s) => (
                <button type="button" key={s.id} className={`chip ${s.id === storeId ? 'active' : ''}`} onClick={() => setStoreId(s.id)}>
                  {s.icon} {s.name}
                </button>
              ))}
            </div>
            {store && <div className="muted small">{store.type} · {store.address}</div>}

            <div className="field-label">2. Что купить</div>
            {items.map((it, i) => (
              <div className="item-row" key={i}>
                <input placeholder="Товар" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                <input type="number" min="1" className="qty" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} title="Количество" />
                <input type="number" min="0" className="price" placeholder="₽ / шт" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} title="Примерная цена" />
                <button type="button" className="icon-btn" onClick={() => setItems((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [emptyItem()]))} aria-label="Удалить">
                  ✕
                </button>
              </div>
            ))}
            <div className="suggestions">
              <button type="button" className="chip chip-add" onClick={() => setItems((l) => [...l, emptyItem()])}>
                + Товар
              </button>
              {SUGGESTIONS.map((s) => (
                <button
                  type="button"
                  key={s}
                  className="chip chip-light"
                  onClick={() => setItems((l) => (l.at(-1)?.name ? [...l, { ...emptyItem(), name: s }] : [...l.slice(0, -1), { ...emptyItem(), name: s }]))}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="field-label">3. Куда доставить</div>
            <input placeholder="Улица, дом, квартира" value={address} onChange={(e) => setAddress(e.target.value)} />
            <div className="muted small">
              📍 {dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)} — точку можно сдвинуть кликом по карте
            </div>
            <textarea placeholder="Комментарий курьеру" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />

            <div className="summary card-soft">
              <div>
                <span>Товары</span>
                <b>{rub(itemsTotal)}</b>
              </div>
              {discount > 0 && (
                <div className="perk">
                  <span>🏷️ Скидка 10%</span>
                  <b>−{rub(discount)}</b>
                </div>
              )}
              <div>
                <span>Доставка {preview && <span className="muted">· {preview.distanceKm.toFixed(1)} км</span>}</span>
                <b>{fee === null ? '—' : fee === 0 ? <span className="perk">🚚 0 ₽</span> : rub(fee)}</b>
              </div>
              <div className="total">
                <span>Итого</span>
                <b>{rub(itemsTotal - discount + (fee ?? 0))}</b>
              </div>
              <div className="muted small">🪙 После доставки начислим +{Math.round(itemsTotal * 0.05) + 10} баллов</div>
            </div>

            <button className="btn btn-primary btn-lg" disabled={busy || !storeId}>
              {storeId ? 'Оформить заказ' : 'Выберите магазин'}
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}

function Tracking({ order, courierLoc, onCancel, onRate, onClose }) {
  const distLeft = courierLoc && order.status !== 'new' ? km(courierLoc, order.status === 'accepted' ? order.store : order.dropoff) : null;
  return (
    <div className="tracking">
      <div className="panel-head">
        <h2>Заказ №{order.number}</h2>
        <span className={`status status-${order.status}`}>{STATUS[order.status]}</span>
      </div>
      <Steps status={order.status} />

      {order.status === 'new' && (
        <div className="searching card-soft">
          <div className="radar" />
          <div>
            <b>Ищем курьера</b>
            <div className="muted small">Курьеры поблизости уже видят ваш заказ на карте</div>
          </div>
        </div>
      )}

      {order.courier && (
        <div className="card-soft">
          <div className="muted small">Ваш курьер</div>
          <UserLine user={order.courier} subtitle={`${order.courier.delivered} доставок`} />
          {distLeft !== null && order.status !== 'delivered' && (
            <div className="eta">
              {order.status === 'accepted' ? '🏪 До магазина' : '🏠 До вас'} ≈ <b>{distLeft < 1 ? `${Math.round(distLeft * 1000)} м` : `${distLeft.toFixed(1)} км`}</b>
            </div>
          )}
        </div>
      )}

      {order.status === 'delivered' && !order.ratingByCustomer && <RateForm title="Как вам курьер?" onSubmit={onRate} />}
      {order.status === 'delivered' && (
        <button className="btn btn-ghost" onClick={onClose}>
          Новый заказ
        </button>
      )}

      <div className="card-soft">
        <div className="muted small">
          {order.store.icon} {order.store.name} → 🏠 {order.dropoff.address}
        </div>
        <ItemsList items={order.items} />
        <div className="summary">
          {order.discount > 0 && (
            <div>
              <span>Скидка</span>
              <b>−{rub(order.discount)}</b>
            </div>
          )}
          <div>
            <span>Доставка</span>
            <b>{rub(order.deliveryFee)}</b>
          </div>
          <div className="total">
            <span>Итого</span>
            <b>{rub(order.total)}</b>
          </div>
        </div>
      </div>

      {order.status === 'new' && (
        <button className="btn btn-danger-ghost" onClick={onCancel}>
          Отменить заказ
        </button>
      )}
    </div>
  );
}
