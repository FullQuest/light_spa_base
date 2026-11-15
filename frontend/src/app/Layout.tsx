import { NavLink, Route, Routes } from 'react-router';
import { useAuth } from '../auth/auth';
import { modules } from './modules';

function RouteMessage({ title }: { title: string }) {
  return <section>
    <h1>{title}</h1>
    <p>Выберите доступный раздел в меню.</p>
  </section>;
}

export function Layout() {
  const { user, logout } = useAuth();
  const enabled = modules.filter((module) => module.enabled !== false);
  // Эти правила управляют интерфейсом; доступ к данным отдельно проверяет API.
  function canOpen(module: typeof modules[number]) {
    return (!module.superadminOnly || user?.role === 'superadmin') &&
      (!module.permission || user?.permissions.includes(module.permission));
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <span className="topbar-brand">Light SPA</span>
        <nav aria-label="Разделы">
          {enabled.filter((module) => module.menu !== false && canOpen(module)).map((module) => (
            <NavLink key={module.path} to={module.path} end>{module.title}</NavLink>
          ))}
        </nav>
        <button type="button" className="btn-link" onClick={logout}>Выйти</button>
      </header>
      <main className="dashboard-main">
        <Routes>
          {enabled.map((module) => (
            <Route key={module.path} path={module.path} element={canOpen(module)
              ? <module.Page />
              : <RouteMessage title="Нет доступа" />} />
          ))}
          <Route path="*" element={<RouteMessage title="Страница не найдена" />} />
        </Routes>
      </main>
    </div>
  );
}
