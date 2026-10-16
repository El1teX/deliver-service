import { useState } from 'react';

const COLORS = ['#ff6b2c', '#2f80ed', '#27ae60', '#9b51e0', '#eb5757', '#f2a90f', '#00a3a3'];

export function Avatar({ user, size = 40 }) {
  const name = user?.name ?? '?';
  const initials = name.split(' ').map((p) => p[0]).filter((c) => /[\p{L}]/u.test(c ?? '')).slice(0, 2).join('');
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className={`avatar ${user?.frame === 'gold' ? 'avatar-gold' : ''}`} style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {initials || '?'}
    </span>
  );
}

export function Rating({ rating, compact }) {
  if (!rating?.count) return <span className="rating rating-new">новичок</span>;
  return (
    <span className="rating" title={`${rating.count} оценок`}>
      ★ {rating.avg.toFixed(2)}
      {!compact && <span className="muted"> · {rating.count}</span>}
    </span>
  );
}

export function UserLine({ user, subtitle }) {
  if (!user) return null;
  return (
    <div className="user-line">
      <Avatar user={user} size={44} />
      <div>
        <div className="user-name">{user.name}</div>
        <div className="muted small">
          <Rating rating={user.rating} /> {subtitle && <>· {subtitle}</>}
        </div>
      </div>
    </div>
  );
}

export function StarInput({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="star-input" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={(hover || value) >= n ? 'on' : ''} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)} aria-label={`${n} звёзд`}>
          ★
        </button>
      ))}
    </div>
  );
}

export function RateForm({ title, onSubmit }) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card rate-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(stars, comment);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{title}</h3>
      <StarInput value={stars} onChange={setStars} />
      <textarea placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
      <button className="btn btn-primary" disabled={busy}>
        Отправить оценку · +5 баллов
      </button>
    </form>
  );
}

export function Steps({ status }) {
  const steps = [
    ['new', 'Поиск курьера'],
    ['accepted', 'В магазин'],
    ['picked', 'В пути к вам'],
    ['delivered', 'Доставлено'],
  ];
  const idx = status === 'delivered' ? steps.length : steps.findIndex(([s]) => s === status);
  return (
    <ol className="steps">
      {steps.map(([s, label], i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''}>
          <span className="dot">{i < idx ? '✓' : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function Modal({ children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ItemsList({ items, checkable }) {
  const [checked, setChecked] = useState({});
  return (
    <ul className="items">
      {items.map((it, i) => (
        <li key={i} className={checked[i] ? 'checked' : ''}>
          {checkable && <input type="checkbox" checked={Boolean(checked[i])} onChange={() => setChecked((c) => ({ ...c, [i]: !c[i] }))} />}
          <span className="item-name">{it.name}</span>
          <span className="muted">× {it.qty}</span>
          <span className="item-price">{Math.round(it.qty * it.price).toLocaleString('ru-RU')} ₽</span>
        </li>
      ))}
    </ul>
  );
}
