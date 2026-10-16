import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Demo() {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');

  async function reset() {
    setReady(false);
    setMessage('Готовим демо-данные…');
    await api('/demo/reset', { method: 'POST' });
    setVersion((v) => v + 1);
    setReady(true);
    setMessage('Демо готово: оформите заказ за Анну или примите заказ за Дмитрия.');
  }

  useEffect(() => {
    reset().catch((e) => setMessage(e.message));
  }, []);

  async function autoplay() {
    try {
      await api('/demo/autoplay', { method: 'POST' });
      setMessage('Автосценарий: Анна оформила заказ, Дмитрий примет его через 3 секунды и поедет по маршруту.');
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
        <div className="demo-msg">{message}</div>
        <div className="demo-buttons">
          <button className="btn btn-primary" onClick={autoplay} disabled={!ready}>
            ▶ Автосценарий
          </button>
          <button className="btn btn-ghost" onClick={() => reset()}>
            ↺ Сбросить демо
          </button>
        </div>
      </header>
      {ready && (
        <div className="demo-split">
          <section>
            <div className="demo-label">🛍️ Клиент — Анна</div>
            <iframe key={`c${version}`} title="Клиент" src="/app?as=demo_customer&embed=1" />
          </section>
          <section>
            <div className="demo-label">🛵 Курьер — Дмитрий</div>
            <iframe key={`k${version}`} title="Курьер" src="/app?as=demo_courier&embed=1" />
          </section>
        </div>
      )}
    </div>
  );
}
