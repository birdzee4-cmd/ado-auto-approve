import { useEffect, useState } from 'react';
import { loadCurrentUser } from './api';
import { Dashboard } from './modules/Dashboard';
import { Incidents } from './modules/Incidents';
import type { CurrentUser, RouteId } from './types';

const routes: Array<{ id: RouteId; label: string; short: string }> = [
  { id: 'dashboard', label: 'Dashboard', short: 'DB' },
  { id: 'incidents', label: 'Incidents', short: 'IN' }
];

function routeFromHash(): RouteId {
  const value = window.location.hash.replace(/^#\/?/, '').split('/')[0] as RouteId;
  return routes.some(route => route.id === value) ? value : 'dashboard';
}

const previewUser: CurrentUser = { name: 'Authorized User', email: '', userRoles: [], isAdmin: false };

export function App() {
  const [route, setRoute] = useState<RouteId>(routeFromHash());
  const [user, setUser] = useState<CurrentUser>(previewUser);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const changeRoute = () => { setRoute(routeFromHash()); setMenuOpen(false); };
    window.addEventListener('hashchange', changeRoute);
    loadCurrentUser().then(setUser).catch(() => undefined);
    return () => window.removeEventListener('hashchange', changeRoute);
  }, []);

  const content = route === 'incidents' ? <Incidents /> : <Dashboard />;

  return <div className="ops-app">
    <header className="ops-topbar">
      <div className="ops-brand"><button className="ops-mobile-menu" onClick={() => setMenuOpen(value => !value)} aria-label="Open navigation">☰</button><img src="/assets/buzzebees-icon.png" alt="Buzzebees" /><div><strong>Operations Hub</strong><span>Buzzebees Internal Applications</span></div></div>
      <nav><a href="/applications.html">All applications</a><span className="ops-user">{user.email || user.name}</span><a className="ops-logout" href="/.auth/logout?post_logout_redirect_uri=/">Logout</a><img src="/assets/buzzebees-powered.png" alt="Powered by Buzzebees" /></nav>
    </header>
    <div className="ops-workspace">
      <aside className={`ops-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="ops-sidebar-context"><span>POWER AUTOMATE</span><strong>Incident tracking</strong></div>
        <nav>{routes.map(item => <a key={item.id} href={`#/${item.id}`} className={route === item.id ? 'is-active' : ''}><span>{item.short}</span>{item.label}</a>)}</nav>
        <div className="ops-sidebar-foot"><span className="ops-live-dot" /> SharePoint incident store<strong>{user.name}</strong></div>
      </aside>
      {menuOpen && <button className="ops-menu-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <main className="ops-main">{content}</main>
    </div>
  </div>;
}
