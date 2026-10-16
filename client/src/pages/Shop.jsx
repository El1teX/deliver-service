import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../components/ui.jsx';
import { useToast, useUser } from '../UserContext.jsx';

export default function Shop() {
  const { me, setMe } = useUser();
  const toast = useToast();
  const [prizes, setPrizes] = useState([]);
  const [bought, setBought] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    api('/prizes').then(setPrizes);
  }, []);

  async function buy(prize) {
    setConfirm(null);
    try {
      const { purchase, me: updated } = await api(`/prizes/${prize.id}/buy`, { method: 'POST' });
      setMe(updated);
      setBought(purchase);
    } catch (err) {
      toast({ kind: 'error', icon: '⚠️', title: err.message });
    }
  }

  return (
    <div className="page">
      <div className="shop-head">
        <div>
          <h1>Призы за баллы</h1>
          <p className="muted">
            {me.role === 'courier' ? 'Баллы начисляются за каждую доставку, оценки 5★ и достижения.' : 'Баллы начисляются за заказы (5% от суммы), оценки и достижения.'}
          </p>
        </div>
        <div className="balance card">
          <span className="muted small">Ваш баланс</span>
          <b>🪙 {me.points}</b>
          <span className="muted small">заработано всего: {me.totalEarned}</span>
        </div>
      </div>

      {(me.perks?.freeDelivery > 0 || me.perks?.discount10 > 0) && (
        <div className="perks card-soft">
          Активные бонусы: {me.perks.freeDelivery > 0 && <span className="pill">🚚 Бесплатная доставка × {me.perks.freeDelivery}</span>}{' '}
          {me.perks.discount10 > 0 && <span className="pill">🏷️ Скидка 10% × {me.perks.discount10}</span>}
        </div>
      )}

      <div className="prize-grid">
        {prizes.map((p) => {
          const owned = p.effect === 'frame' && me.frame;
          const enough = me.points >= p.cost;
          return (
            <div key={p.id} className="card prize">
              <div className="prize-icon">{p.icon}</div>
              <b>{p.title}</b>
              <div className="muted small grow">{p.desc}</div>
              <div className="prize-foot">
                <span className="cost">🪙 {p.cost}</span>
                <button className="btn btn-primary btn-sm" disabled={!enough || owned} onClick={() => setConfirm(p)}>
                  {owned ? 'Уже есть' : enough ? 'Получить' : `ещё ${p.cost - me.points}`}
                </button>
              </div>
              {!enough && !owned && (
                <div className="progress-bar progress-sm">
                  <span style={{ width: `${(me.points / p.cost) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {me.purchases.length > 0 && (
        <>
          <h2>Мои призы</h2>
          <div className="history">
            {me.purchases.map((p) => (
              <div key={p.id} className="card history-row">
                <span className="order-icon">{p.icon}</span>
                <div className="grow">
                  <b>{p.title}</b>
                  <div className="muted small">{new Date(p.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </div>
                <code className="code">{p.code}</code>
              </div>
            ))}
          </div>
        </>
      )}

      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <div className="prize-icon">{confirm.icon}</div>
          <h2>{confirm.title}</h2>
          <p>
            Списать <b>{confirm.cost}</b> баллов? Останется {me.points - confirm.cost}.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={() => buy(confirm)}>
              Обменять баллы
            </button>
          </div>
        </Modal>
      )}
      {bought && (
        <Modal onClose={() => setBought(null)}>
          <div className="prize-icon">{bought.icon}</div>
          <h2>Готово! 🎉</h2>
          <p>
            «{bought.title}» теперь ваш. Код получения: <code className="code">{bought.code}</code>
          </p>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setBought(null)}>
              Отлично
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
