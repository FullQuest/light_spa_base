import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { canOpenModule, modules } from '../app/modules';
import { HttpError } from '../shared/http';
import { AuthContext } from './auth';
import * as api from './api';
import type { UserPublic } from './types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(() => Boolean(api.getToken()));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = api.getToken();
    if (!token) return;
    // После отключения компонента результат запроса уже не должен менять состояние.
    let cancelled = false;
    api.getMe(token)
      .then((me) => { if (!cancelled) setUser(me); })
      .catch((err: unknown) => {
        if (cancelled) return;
        // При сетевом сбое сохраняем токен для повторной попытки.
        if (err instanceof HttpError && err.status === 401) api.clearToken();
        else setError(err instanceof Error ? err.message : 'Не удалось восстановить сессию');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let active = true;
    function refresh() {
      const token = api.getToken();
      if (!token) return;
      api.getMe(token).then((me) => {
        if (active && api.getToken() === token) setUser(me);
      }).catch((err: unknown) => {
        if (active && api.getToken() === token && err instanceof HttpError && err.status === 401) {
          api.clearToken();
          setUser(null);
        }
      });
    }
    window.addEventListener('focus', refresh);
    window.addEventListener('auth-refresh', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('auth-refresh', refresh);
    };
  }, []);

  async function startSession(email: string, password: string, registration = false) {
    const token = await api.login(email, password);
    // Сохраняем токен только после успешного получения профиля.
    const me = await api.getMe(token.access_token);
    const destination = modules.find((module) => matchPath(module.path, pathname));
    if (registration || !destination || !canOpenModule(destination, me)) {
      navigate('/', { replace: true });
    }
    api.setToken(token.access_token);
    setUser(me);
    setError(null);
  }

  async function login(email: string, password: string) {
    await startSession(email, password);
  }

  async function register(email: string, fullName: string, password: string) {
    await api.register(email, fullName, password);
    try {
      await startSession(email, password, true);
    } catch {
      throw new Error('Аккаунт создан, но автоматический вход не удался. Перейдите ко входу и попробуйте снова.');
    }
  }

  function logout() {
    api.clearToken();
    setUser(null);
    setError(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
