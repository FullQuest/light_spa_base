import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();
  const [showRegister, setShowRegister] = useState(false);

  if (loading) {
    return <div className="page-loading">Загрузка…</div>;
  }

  if (user) {
    return <DashboardPage />;
  }

  if (showRegister) {
    return <RegisterPage onSwitchToLogin={() => setShowRegister(false)} />;
  }

  return <LoginPage onSwitchToRegister={() => setShowRegister(true)} />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;