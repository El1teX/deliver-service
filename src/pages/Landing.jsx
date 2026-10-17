import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

export default function Landing() {
  const { me, login } = useUser();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('customer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/app" replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = mode === 'login' ? { email, password } : { email, password, name, role };
      login(await api(`/auth/${mode}`, { method: 'POST', body }));
      navigate('/app');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function enterAs(userId) {
    await api('/demo/reset', { method: 'POST' }).catch(() => {});
    login(await api('/demo/login', { method: 'POST', body: { userId } }));
    navigate('/app');
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
        <div className="seg">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Вход
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Регистрация
          </button>
        </div>

        {mode === 'register' && (
          <>
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
              Имя
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Максим" maxLength={40} autoComplete="name" />
            </label>
          </>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'Минимум 6 символов' : ''}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={mode === 'register' ? 6 : undefined}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
        <p className="muted small">
          {mode === 'login' ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
          <button type="button" className="link-btn link-accent" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
          </button>
          {mode === 'register' && ' · новым клиентам 100 баллов, курьерам — 50'}
        </p>
      </form>
    </div>
  );
}
