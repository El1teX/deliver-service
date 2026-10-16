import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const VIEWS = [
  ['both', '🖥️ Оба экрана'],
  ['customer', '🛍️ Клиент'],
  ['courier', '🛵 Курьер'],
];

const narrow = () => window.innerWidth < 900;

export default function Demo() {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  // На узком экране два окна не помещаются — показываем по одному с переключателем.
  const [view, setView] = useState(() => (narrow() ? 'customer' : 'both'));
  const started = useRef(false);

  async function reset() {
    setReady(false);
    setMessage('Готовим демо-данные…');
    await api('/demo/reset', { method: 'POST' });
    setVersion((v) => v + 1);
    setReady(true);
    setMessage('');
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    reset().catch((e) => setMessage(e.message));
  }, []);

  useEffect(() => {
    const onResize = () => setView((v) => (v === 'both' && narrow() ? 'customer' : v));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  async function autoplay() {
    try {
      await api('/demo/autoplay', { method: 'POST' });
      setMessage('Автосценарий: Анна оформила заказ — через 3 секунды Дмитрий примет его и поедет по маршруту.');
    } catch (e) {
      setMessage(e.message);
    }
  }

  return (
    <div className="demo">
      <header className="demo-bar">
        <Link to="/" className="logo">
          <span>🛵</span> Мигом <span className="role-tag">демо</span>
        </Link>
        <div className="seg seg-dark">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)} disabled={id === 'both' && narrow()}>
              {label}
            </button>
          ))}
        </div>
        <div className="demo-buttons">
          <button className="btn btn-primary" onClick={autoplay} disabled={!ready}>
            ▶ Автосценарий
          </button>
          <button className="btn btn-ghost" onClick={() => reset()}>
            ↺ Сбросить
          </button>
        </div>
      </header>

      <div className="demo-msg">
        {message || (
          <>
            Вы управляете обоими: <b>1</b> Анна заказывает → <b>2</b> Дмитрий жмёт на метку и «Взять заказ» → <b>3</b> «Проехать
            автоматически». Или «Автосценарий».
          </>
        )}
      </div>

      {ready && (
        <div className={`demo-split demo-view-${view}`}>
          <section className="demo-pane-customer">
            <div className="demo-label">🛍️ Клиент — Анна</div>
            <iframe key={`c${version}`} title="Клиент" src="/app?as=demo_customer&embed=1" />
          </section>
          <section className="demo-pane-courier">
            <div className="demo-label">🛵 Курьер — Дмитрий</div>
            <iframe key={`k${version}`} title="Курьер" src="/app?as=demo_courier&embed=1" />
          </section>
        </div>
      )}
    </div>
  );
}
