import { HttpError, request } from '../shared/http';
import type { TokenResponse, UserPublic } from './types';

const TOKEN_KEY = 'auth_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);

export function getAuthConfig() {
  return request<{ registration_enabled: boolean }>('/auth/config');
}

export function login(email: string, password: string) {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: new URLSearchParams({ username: email, password }),
  });
}

export function register(email: string, fullName: string, password: string) {
  return request<UserPublic>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, full_name: fullName.trim() || null, password }),
  });
}

export function getMe(token: string) {
  return request<UserPublic>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Защищённые запросы модулей: токен добавляется здесь, а не в каждой странице.
export function authRequest<T>(path: string, init: RequestInit = {}, responseType: 'json' | 'blob' = 'json') {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return request<T>(path, { ...init, headers }, responseType).catch((err: unknown) => {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      window.dispatchEvent(new Event("auth-refresh"));
    }
    throw err;
  });
}
