import { useEffect, useState } from 'react';
import type { LiveGraph } from './snapshot';

export function SyncStatus({ data, receivedAt }: { data: LiveGraph; receivedAt: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  // Возраст проверяется независимо от ответов API: зависший запрос не оставит
  // зелёный индикатор на неопределённое время. Считаем прошедшее время локально,
  // чтобы разница часов сервера и браузера не давала ложного предупреждения.
  const sourceAge = data.syncedAt ? Math.max(0, Date.parse(data.asOf) - Date.parse(data.syncedAt)) : Infinity;
  const age = sourceAge + (receivedAt ? Math.max(0, now - Date.parse(receivedAt)) : 0);
  const delayed = data.sourceStatus === 'online' && age > 5000;
  const unavailable = data.sourceStatus !== 'online';
  return <div className={`graph-sync ${unavailable || delayed ? 'graph-sync-warning' : ''}`} role="status">
    <strong>{data.legacyDemo ? 'Демонстрационные данные' : unavailable
      ? 'Источник недоступен · показан последний сохранённый снимок'
      : delayed ? 'Обновление задерживается более 5 с · актуальность данных не подтверждена' : 'Источник доступен'}</strong>
    <span>Снимок: {new Date(data.asOf).toLocaleString('ru-RU')} · Синхронизация: {data.syncedAt ? new Date(data.syncedAt).toLocaleString('ru-RU') : 'нет данных'}</span>
    <small>Опрос каждую 1 с · Получен: {receivedAt ? new Date(receivedAt).toLocaleTimeString('ru-RU') : '—'}</small>
  </div>;
}
