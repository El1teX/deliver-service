import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, embedded } from '../api.js';
import { Avatar, Rating } from '../components/ui.jsx';
import { useUser } from '../UserContext.jsx';

export default function Profile() {
  const { me, logout } = useUser();
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    api(`/users/${me.id}`).then(setProfile);
  }, [me.id, me.ratings.length, me.achievements.length]);

  const isCourier = me.role === 'courier';
  const stats = isCourier
    ? [
        ['Доставок', me.stats.delivered],
        ['Километров', me.stats.distanceKm.toFixed(1)],
        ['Быстрых доставок', me.stats.fastDeliveries],
        ['Призов', me.stats.purchases],
      ]
    : [
        ['Заказов', me.stats.orders],
        ['Оценок дано', me.stats.ratingsGiven],
        ['Самый большой заказ', `${me.stats.maxOrder.toLocaleString('ru-RU')} ₽`],
        ['Призов', me.stats.purchases],
      ];

  return (
    <div className="page">
      <div className="profile-head card">
        <Avatar user={me} size={84} />
        <div className="grow">
          <h1>{me.name}</h1>
          <div className="muted">
            {isCourier ? 'Курьер' : 'Клиент'} · с {new Date(me.createdAt).toLocaleDateString('ru-RU')}
          </div>
          <div className="profile-rating">
            <Rating rating={me.rating} />
          </div>
        </div>
        <div className="balance">
          <span className="muted small">Баллы</span>
          <b>🪙 {me.points}</b>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <div key={label} className="card stat">
            <b>{value}</b>
            <span className="muted small">{label}</span>
          </div>
        ))}
      </div>

      <div className="link-cards">
        <Link to="/app/leaders" className="card link-card">
          <span>📊</span>
          <b>Рейтинг пользователей</b>
          <span className="muted">→</span>
        </Link>
        <Link to="/app/achievements" className="card link-card">
          <span>🏅</span>
          <b>Мои достижения</b>
          <span className="muted">→</span>
        </Link>
      </div>

      {profile?.achievements.length > 0 && (
        <>
          <h2>Полученные достижения</h2>
          <div className="badges">
            {profile.achievements.map((a) => (
              <span key={a.id} className="badge" title={a.desc}>
                {a.icon} {a.title}
              </span>
            ))}
          </div>
        </>
      )}

      <h2>Отзывы обо мне</h2>
      {!profile?.reviews.length && <div className="empty">Пока нет отзывов.</div>}
      <div className="history">
        {profile?.reviews.map((r, i) => (
          <div key={i} className="card history-row">
            <span className="stars">{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span>
            <div className="grow">
              <b>{r.fromName}</b>
              {r.comment && <div>{r.comment}</div>}
            </div>
            <span className="muted small">{new Date(r.at).toLocaleDateString('ru-RU')}</span>
          </div>
        ))}
      </div>

      {!embedded && (
        <button className="btn btn-danger-ghost" onClick={logout}>
          Выйти из аккаунта
        </button>
      )}
    </div>
  );
}
