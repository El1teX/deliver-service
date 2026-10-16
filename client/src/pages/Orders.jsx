import { useEffect, useState } from 'react';
import { api, rub, STATUS } from '../api.js';
import { Avatar, Rating } from '../components/ui.jsx';
import { useUser } from '../UserContext.jsx';

export default function Orders() {
  const { me } = useUser();
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    api('/orders/my').then(setOrders);
  }, []);
  const isCourier = me.role === 'courier';

  return (
    <div className="page">
      <h1>{isCourier ? 'Мои доставки' : 'Мои заказы'}</h1>
      {orders?.length === 0 && <div className="empty">Здесь появится история {isCourier ? 'доставок' : 'заказов'}.</div>}
      <div className="history">
        {orders?.map((o) => {
          const other = isCourier ? o.customer : o.courier;
          const myRating = isCourier ? o.ratingByCourier : o.ratingByCustomer;
          const theirRating = isCourier ? o.ratingByCustomer : o.ratingByCourier;
          return (
            <div key={o.id} className="card history-row">
              <span className="order-icon">{o.store.icon}</span>
              <div className="grow">
                <div>
                  <b>№{o.number}</b> · {o.store.name} → {o.dropoff.address}
                </div>
                <div className="muted small">
                  {new Date(o.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · {o.items.map((i) => i.name).join(', ')}
                </div>
                {other && (
                  <div className="small history-other">
                    <Avatar user={other} size={20} /> {other.name} <Rating rating={other.rating} compact />
                  </div>
                )}
              </div>
              <div className="history-right">
                <span className={`status status-${o.status}`}>{STATUS[o.status]}</span>
                <b>{isCourier ? `+${o.reward} 🪙` : rub(o.total)}</b>
                <span className="small muted">
                  {myRating && <>вы: {'★'.repeat(myRating.stars)} </>}
                  {theirRating && <>вам: {'★'.repeat(theirRating.stars)}</>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
