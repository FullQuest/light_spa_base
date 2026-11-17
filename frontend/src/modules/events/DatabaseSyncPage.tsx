import { useCallback, useEffect, useState } from 'react';
import { HttpError } from '../../shared/http';
import { authRequest } from '../../auth/api';
import './database-sync.css';

interface SyncStatus {
  sourceStatus: 'online' | 'stale' | 'unavailable';
  syncedAt: string | null;
  counts: Record<string, number>;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : 'Нет успешной синхронизации';
}

function failureMessage(error: unknown) {
  if (error instanceof HttpError && error.status === 503) return 'Внешняя БД не ответила. Локальный кэш сохранён.';
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}

export function DatabaseSyncPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshStatus = useCallback(async () => {
    const result = await authRequest<SyncStatus>('/infra-loader/status', { cache: 'no-store' });
    setStatus(result);
  }, []);

  useEffect(() => {
    let active = true;
    authRequest<SyncStatus>('/infra-loader/status', { cache: 'no-store' })
      .then(result => { if (active) setStatus(result); })
      .catch(reason => { if (active) setError(failureMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function synchronize() {
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await authRequest<Record<string, number>>('/infra-loader/fetch-all', { method: 'POST' });
      await refreshStatus();
      setNotice(`Локальная копия обновлена: ${result.edifices ?? 0} объектов, ${result.edifice_dependencies ?? 0} связей, ${result.events ?? 0} событий.`);
    } catch (reason) {
      setError(failureMessage(reason));
      await refreshStatus().catch(() => {});
    } finally { setWorking(false); }
  }

  async function clearCache() {
    if (!window.confirm('Удалить текущую локальную копию объектов, связей и событий? Внешняя БД не изменится.')) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await authRequest<Record<string, number>>('/infra-loader/delete-all', { method: 'POST' });
      await refreshStatus();
      const removed = Object.values(result).reduce((sum, count) => sum + count, 0);
      setNotice(`Локальный кэш очищен (${removed} записей). Граф автоматически загрузит текущую версию при следующем запросе.`);
    } catch (reason) {
      setError(failureMessage(reason));
    } finally { setWorking(false); }
  }

  return <section className="database-sync-page">
    <header className="database-sync-heading"><div><p className="database-sync-eyebrow">ИНФРАСТРУКТУРА</p><h1>Данные графа</h1></div></header>
    <div className="database-sync-status" aria-live="polite">
      <strong className={status?.sourceStatus === 'online' ? 'source-online' : 'source-offline'}>
        {loading ? 'Загрузка состояния…' : status?.sourceStatus === 'online' ? 'Внешний источник доступен' : status?.sourceStatus === 'stale' ? 'Источник недоступен · используется локальная копия' : 'Нет загруженной копии'}
      </strong>
      <span>Последняя успешная синхронизация: {formatDate(status?.syncedAt ?? null)}</span>
    </div>
    {status && <dl className="database-sync-counts">
      <div><dt>Объекты</dt><dd>{status.counts.edifices ?? 0}</dd></div>
      <div><dt>Зависимости</dt><dd>{status.counts.edifice_dependencies ?? 0}</dd></div>
      <div><dt>События</dt><dd>{status.counts.events ?? 0}</dd></div>
      <div><dt>Типы событий</dt><dd>{status.counts.event_statuses ?? 0}</dd></div>
    </dl>}
    <div className="database-sync-actions">
      <button type="button" className="btn-primary" onClick={synchronize} disabled={working}>
        {working ? 'Выполняется…' : 'Загрузить актуальную БД'}
      </button>
      <button type="button" onClick={clearCache} disabled={working}>Очистить локальный кэш</button>
    </div>
    {notice && <p className="database-sync-notice" role="status">{notice}</p>}
    {error && <p className="database-sync-error" role="alert">{error}</p>}
  </section>;
}
