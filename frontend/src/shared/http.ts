export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Пути передаются без /api; токен добавляет authRequest из auth/api.ts.
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new Error('Сервер недоступен. Проверьте подключение.');
  }
  if (!response.ok) {
    let message = 'Не удалось выполнить запрос';
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') message = data.detail;
      else if (Array.isArray(data.detail)) message = 'Проверьте введённые данные';
    } catch { /* Прокси может вернуть HTML вместо JSON; оставляем общее сообщение. */ }
    if (response.status >= 500) message = 'Сервер недоступен. Попробуйте позже.';
    throw new HttpError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
