import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar, Rating } from '../components/ui.jsx';
import { useUser } from '../UserContext.jsx';

export default function Leaderboard() {
  const { me } = useUser();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(me.role === 'courier' ? 'couriers' : 'customers');
  useEffect(() => {
    api('/leaderboard').then(setData);
  }, []);

  const rows = data?.[tab] ?? [];
  return (
    <div className="page">
      <h1>Рейтинг</h1>
      <p className="muted">Рейтинг складывается из взаимных оценок после каждой доставки: клиенты оценивают курьеров, курьеры — клиентов.</p>
      <div className="seg">
        <button className={tab === 'couriers' ? 'active' : ''} onClick={() => setTab('couriers')}>
          🛵 Курьеры
        </button>
        <button className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>
          🛍️ Клиенты
        </button>
      </div>
      <div className="card leaders">
        {rows.map((u, i) => (
          <div key={u.id} className={`leader ${u.id === me.id ? 'leader-me' : ''}`}>
            <span className="place">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
            <Avatar user={u} size={36} />
            <span className="grow">
              <b>{u.name}</b>
              <span className="muted small"> · {tab === 'couriers' ? `${u.delivered} доставок` : `${u.orders} заказов`} · 🏅 {u.achievementsCount}</span>
            </span>
            <Rating rating={u.rating} />
          </div>
        ))}
      </div>
    </div>
  );
}
