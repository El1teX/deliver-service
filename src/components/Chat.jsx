import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast, useUser } from '../UserContext.jsx';
import { Modal } from './ui.jsx';

const QUICK_REPLIES = ['Товара нет — заменить на похожий?', 'Подъезжаю', 'Не могу дозвониться'];
const time = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// Кнопка «Чат» со счётчиком непрочитанных; переписка открывается во всплывающей шторке.
export function ChatButton({ order, peer }) {
  const { me, socket } = useUser();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [canWrite, setCanWrite] = useState(false);
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  const markRead = useCallback(() => {
    setMessages((list) => list.map((m) => (m.fromId !== me.id && !m.readAt ? { ...m, readAt: Date.now() } : m)));
    api(`/orders/${order.id}/messages/read`, { method: 'POST' }).catch(() => {});
  }, [order.id, me.id]);

  // История перечитывается при смене статуса: после доставки писать уже нельзя.
  useEffect(() => {
    if (!order.courierId) return;
    api(`/orders/${order.id}/messages`)
      .then((r) => {
        setMessages(r.messages);
        setCanWrite(r.canWrite);
      })
      .catch(() => {});
  }, [order.id, order.courierId, order.status]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (m) => {
      if (m.orderId !== order.id) return;
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (m.fromId === me.id) return;
      if (openRef.current) markRead();
      else toast({ icon: '💬', title: peer?.name ?? 'Новое сообщение', text: m.text });
    };
    const onRead = (e) => {
      if (e.orderId === order.id) setMessages((list) => list.map((m) => (m.fromId === me.id && !m.readAt ? { ...m, readAt: Date.now() } : m)));
    };
    socket.on('chat:message', onMessage);
    socket.on('chat:read', onRead);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:read', onRead);
    };
  }, [socket, order.id, me.id, peer?.name, markRead, toast]);

  if (!order.courierId || (!canWrite && messages.length === 0)) return null;
  const unread = messages.filter((m) => m.fromId !== me.id && !m.readAt).length;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm chat-button"
        onClick={() => {
          setOpen(true);
          if (unread) markRead();
        }}
      >
        💬 Чат
        {unread > 0 && <span className="chat-badge">{unread}</span>}
      </button>
      {open && <ChatSheet order={order} peer={peer} messages={messages} canWrite={canWrite} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChatSheet({ order, peer, messages, canWrite, onClose }) {
  const { me } = useUser();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(value) {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api(`/orders/${order.id}/messages`, { method: 'POST', body: { text: body } });
      if (value === text) setText('');
    } catch (e) {
      toast({ kind: 'error', title: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} className="chat-sheet">
      <div className="panel-head">
        <div>
          <h3 className="chat-title">{peer?.name ?? 'Чат'}</h3>
          <div className="muted small">Заказ №{order.number}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть чат">
          ✕
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="muted small chat-empty">Сообщений пока нет — напишите первым</div>}
        {messages.map((m) => {
          const mine = m.fromId === me.id;
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'mine' : ''}`}>
              {m.text}
              <span className="chat-time">
                {time(m.createdAt)}
                {mine && (m.readAt ? ' ✓✓' : ' ✓')}
              </span>
            </div>
          );
        })}
      </div>

      {canWrite ? (
        <>
          {me.role === 'courier' && (
            <div className="chat-quick">
              {QUICK_REPLIES.map((q) => (
                <button key={q} type="button" className="chip" disabled={busy} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Сообщение" aria-label="Сообщение" />
            <button className="btn btn-primary" disabled={busy || !text.trim()}>
              ➤
            </button>
          </form>
        </>
      ) : (
        <div className="muted small chat-empty">Заказ завершён — чат только для чтения</div>
      )}
    </Modal>
  );
}
