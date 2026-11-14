import type { TokenResponse, UserPublic } from '../types/auth';

const TOKEN_KEY = 'auth_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function parseError(res: Response, fallback: string): Promise<string> {
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return 'Сервер недоступен. Проверьте, что API запущен.';
  }
  try {
    const data = await res.json();
    if (data && typeof data.detail === 'string') return data.detail;
  } catch {
    /* ignore */
  }
  return fallback;
}

async function request<T>(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Сервер недоступен. Проверьте подключение.');
  }
  if (!res.ok) {
    throw new Error(await parseError(res, fallback));
  }
  return (await res.json()) as T;
}

export function login(
  email: string,
  password: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({ username: email, password });
  return request<TokenResponse>(
    '/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    'Не удалось войти',
  );
}

export function register(
  email: string,
  fullName: string,
  password: string,
): Promise<UserPublic> {
  return request<UserPublic>(
    '/auth/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        full_name: fullName.trim() || null,
        password,
      }),
    },
    'Не удалось зарегистрироваться',
  );
}

export function getMe(): Promise<UserPublic> {
  const token = getToken();
  return request<UserPublic>(
    '/auth/me',
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    'Не удалось получить профиль',
  );
}