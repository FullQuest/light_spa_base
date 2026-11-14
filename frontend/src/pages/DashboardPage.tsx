import { useAuth } from '../context/AuthContext';

export function DashboardPage() {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <span className="topbar-brand">App</span>
        <div className="topbar-actions">
          <span className="topbar-user">{user.email}</span>
          <button type="button" className="btn-link" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="profile-card">
          <h1>Профиль</h1>
          <div className="profile-row">
            <span className="profile-row-label">ID</span>
            <span className="profile-row-value">{user.id}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">Email</span>
            <span className="profile-row-value">{user.email}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">Имя</span>
            <span className="profile-row-value">
              {user.full_name ?? '—'}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}