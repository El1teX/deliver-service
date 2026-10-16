import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

export default function Landing() {
  const { me, login } = useUser();
  const navigate = useNavigate();
  const [role, setRole] = useState('customer');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  if (me) return <Navigate to="/app" replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      login(await api('/auth/login', { method: 'POST', body: { name, role } }));
      navigate('/app');
    } catch (err) {
      setError(err.message);
    }
  }

  async function enterAs(userId) {
    await api('/demo/reset', { method: 'POST' }).catch(() => {});
    login({ id: userId });
    window.location.href = '/app';
  }

  return (
    <div className="landing">
      <section className="hero">
        <div className="logo logo-big">
          <span>🛵</span> Мигом
        </div>
        <h1>
          Купим и привезём
          <br />
          <em>что угодно</em> из любого магазина
        </h1>
        <p className="lead">
          Клиент составляет список покупок и отмечает адрес на карте. Курьер выбирает заказ на карте, покупает и привозит.
          За доставки и заказы начисляются баллы — их можно потратить на призы.
        </p>
        <div className="hero-features">
          <span>🗺️ Живая карта и маршруты</span>
          <span>⭐ Взаимные рейтинги</span>
          <span>🏅 Достижения</span>
          <span>🎁 Призы за баллы</span>
        </div>

        <div className="demo-card card">
          <div>
            <h3>Демонстрационный режим</h3>
            <p className="muted">
              Клиент Анна и курьер Дмитрий на одном экране — выбирать роль не нужно, вы управляете обоими: оформите заказ слева и возьмите его
              справа или запустите автосценарий.
            </p>
          </div>
          <Link to="/demo" className="btn btn-primary btn-lg">
            ▶ Открыть демо: клиент + курьер
          </Link>
          <div className="muted small">
            Или зайти в демо-аккаунт на весь экран:{' '}
            <button className="link-btn link-accent" onClick={() => enterAs('demo_customer')}>
              клиентом
            </button>{' '}
            ·{' '}
            <button className="link-btn link-accent" onClick={() => enterAs('demo_courier')}>
              курьером
            </button>
          </div>
        </div>
      </section>

      <form className="login card" onSubmit={submit}>
        <h2>Вход</h2>
        <div className="role-switch">
          <button type="button" className={role === 'customer' ? 'active' : ''} onClick={() => setRole('customer')}>
            <span>🛍️</span>
            <b>Я клиент</b>
            <small>Заказываю доставку</small>
          </button>
          <button type="button" className={role === 'courier' ? 'active' : ''} onClick={() => setRole('courier')}>
            <span>🛵</span>
            <b>Я курьер</b>
            <small>Доставляю заказы</small>
          </button>
        </div>
        <label>
          Как вас зовут?
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Максим" maxLength={40} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-lg">Продолжить</button>
        <p className="muted small">Новые клиенты получают 100 приветственных баллов, курьеры — 50.</p>
      </form>
    </div>
  );
}
