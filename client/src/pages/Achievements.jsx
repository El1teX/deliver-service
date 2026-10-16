import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

export default function Achievements() {
  const { me } = useUser();
  const [list, setList] = useState([]);
  useEffect(() => {
    api('/achievements').then(setList);
    // Перезагружаем, когда пользователь получил новые достижения
  }, [me.achievements.length]);

  const got = list.filter((a) => a.unlockedAt).length;
  return (
    <div className="page">
      <h1>Достижения</h1>
      <p className="muted">
        Открыто {got} из {list.length}. За каждое достижение начисляются бонусные баллы.
      </p>
      <div className="progress-bar">
        <span style={{ width: `${list.length ? (got / list.length) * 100 : 0}%` }} />
      </div>
      <div className="ach-grid">
        {list.map((a) => (
          <div key={a.id} className={`card ach ${a.unlockedAt ? 'ach-on' : ''}`}>
            <div className="ach-icon">{a.icon}</div>
            <b>{a.title}</b>
            <div className="muted small">{a.desc}</div>
            {a.progress && !a.unlockedAt && (
              <div className="ach-progress">
                <div className="progress-bar progress-sm">
                  <span style={{ width: `${Math.min(100, (a.progress[0] / a.progress[1]) * 100)}%` }} />
                </div>
                <span className="small muted">
                  {Math.min(a.progress[0], a.progress[1])}/{a.progress[1]}
                </span>
              </div>
            )}
            <div className="ach-foot">
              <span className="pill">+{a.points} 🪙</span>
              {a.unlockedAt && <span className="small muted">{new Date(a.unlockedAt).toLocaleDateString('ru-RU')}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
