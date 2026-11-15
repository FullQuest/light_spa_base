import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './auth';
import { getAuthConfig } from './api';
import './auth.css';

export function AuthPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    let active = true;
    getAuthConfig()
      .then((config) => { if (active) setRegistrationEnabled(config.registration_enabled); })
      .catch(() => { if (active) setConfigError(true); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email'));
    const password = String(data.get('password'));
    setError('');
    setSubmitting(true);
    try {
      if (isRegister) await register(email, String(data.get('fullName')), password);
      else await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить запрос');
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode() {
    setIsRegister(!isRegister);
    setError('');
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">{isRegister ? 'Регистрация' : 'Вход'}</h1>
        <label className="field">
          <span>{isRegister ? 'Email' : 'Логин или email'}</span>
          <input name="email" type={isRegister ? 'email' : 'text'} required
            autoComplete={isRegister ? 'email' : 'username'} />
        </label>
        {isRegister && (
          <label className="field">
            <span>Имя (опционально)</span>
            <input name="fullName" autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>Пароль</span>
          <input name="password" type="password" required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            maxLength={isRegister ? 128 : undefined} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Подождите…' : isRegister ? 'Создать аккаунт' : 'Войти'}
        </button>
        {registrationEnabled && <button type="button" disabled={submitting} className="btn-link-inline" onClick={switchMode}>
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>}
        {configError && <p role="alert">Не удалось загрузить настройки регистрации. Обновите страницу для повторной попытки.</p>}
      </form>
    </div>
  );
}
