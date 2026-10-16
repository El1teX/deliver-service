import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getUserId, setUserId } from './api.js';

const UserCtx = createContext(null);
const ToastCtx = createContext(() => {});

export const useUser = () => useContext(UserCtx);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, ...toast }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), toast.kind === 'achievement' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind ?? 'info'}`}>
            {t.icon && <span className="toast-icon">{t.icon}</span>}
            <div>
              <b>{t.title}</b>
              {t.text && <div className="muted">{t.text}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function UserProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(Boolean(getUserId()));
  const [socket, setSocket] = useState(null);
  const toast = useToast();

  useEffect(() => {
    if (!getUserId()) return;
    api('/me')
      .then(setMe)
      .catch(() => setUserId(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    const s = io({ auth: { userId: me.id } });
    s.on('me:update', setMe);
    s.on('notify', (e) => {
      if (e.type === 'achievement') toast({ kind: 'achievement', icon: e.icon, title: `Достижение: ${e.title}`, text: `+${e.points} баллов` });
      if (e.type === 'points' && e.amount > 0) toast({ kind: 'points', icon: '🪙', title: `+${e.amount} баллов`, text: e.reason });
    });
    setSocket(s);
    return () => s.disconnect();
  }, [me?.id, toast]);

  const value = useMemo(
    () => ({
      me,
      setMe,
      loading,
      socket,
      login(user) {
        setUserId(user.id);
        setMe(user);
      },
      logout() {
        setUserId(null);
        setMe(null);
      },
    }),
    [me, loading, socket],
  );
  return <UserCtx.Provider value={value}>{children}</UserCtx.Provider>;
}
