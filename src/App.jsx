import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { embedded } from './api.js';
import { Avatar } from './components/ui.jsx';
import Achievements from './pages/Achievements.jsx';
import CourierHome from './pages/CourierHome.jsx';
import CustomerHome from './pages/CustomerHome.jsx';
import Demo from './pages/Demo.jsx';
import Landing from './pages/Landing.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Orders from './pages/Orders.jsx';
import Profile from './pages/Profile.jsx';
import Shop from './pages/Shop.jsx';
import { useUser } from './UserContext.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/app/*" element={<Shell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Shell() {
  const { me, loading } = useUser();
  if (loading) return <div className="center-screen">Загрузка…</div>;
  if (!me) return <Navigate to="/" replace />;
  const isCourier = me.role === 'courier';

  const tabs = [
    ['', '🗺️', isCourier ? 'Карта' : 'Заказать'],
    ['orders', '📦', isCourier ? 'Доставки' : 'Заказы'],
    ['achievements', '🏅', 'Награды'],
    ['shop', '🎁', 'Призы'],
    ['profile', '👤', 'Профиль'],
  ];
  const links = (className) =>
    tabs.map(([path, icon, label]) => (
      <NavLink key={path} to={`/app/${path}`} end={path === ''} className={className}>
        <span className="tab-icon">{icon}</span>
        <span className="tab-label">{label}</span>
      </NavLink>
    ));

  return (
    <div className={`shell ${embedded ? 'shell-embedded' : ''}`}>
      <header className="topbar">
        <NavLink to="/app" className="logo">
          <span>🛵</span> Мигом
          <span className={`role-tag role-${me.role}`}>{isCourier ? 'курьер' : 'клиент'}</span>
        </NavLink>
        <nav className="tabs">{links('tab')}</nav>
        <div className="topbar-right">
          <NavLink to="/app/shop" className="points-badge" title="Ваши баллы">
            🪙 {me.points}
          </NavLink>
          <NavLink to="/app/profile" className="me-chip" title="Профиль">
            <Avatar user={me} size={32} />
          </NavLink>
        </div>
      </header>
      <main className="shell-main">
        <Routes>
          <Route index element={isCourier ? <CourierHome /> : <CustomerHome />} />
          <Route path="orders" element={<Orders />} />
          <Route path="achievements" element={<Achievements />} />
          <Route path="shop" element={<Shop />} />
          <Route path="leaders" element={<Leaderboard />} />
          <Route path="profile" element={<Profile />} />
        </Routes>
      </main>
      <nav className="bottom-nav">{links('bottom-tab')}</nav>
    </div>
  );
}
