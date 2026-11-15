import { AuthProvider } from '../auth/AuthProvider';
import { useAuth } from '../auth/auth';
import { AuthPage } from '../auth/AuthPage';
import { Layout } from './Layout';
import './app.css';

function AppContent() {
  const { user, loading, error, logout } = useAuth();
  if (loading) return <div className="page-loading">Загрузка…</div>;
  if (error) return (
    <div className="page-loading"><div role="alert">
      <p>{error}</p>
      <button type="button" onClick={() => window.location.reload()}>Повторить</button>
      <button type="button" onClick={logout}>Перейти ко входу</button>
    </div></div>
  );
  if (user) return <Layout />;
  return <AuthPage />;
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}
