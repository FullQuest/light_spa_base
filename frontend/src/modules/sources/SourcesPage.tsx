import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { SourceForm } from './SourceForm';
import { scheduleLabel, sourceStatuses, sourceTime } from './sources';
import type { SourceInfo } from './sources';
import './sources.css';

export function SourcesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<SourceInfo[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    authRequest<SourceInfo[]>('/sources')
      .then((result) => { if (active) { setItems(result); setError(''); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить источники'); });
    return () => { active = false; };
  }, [attempt]);
  return <section className="sources-page">
    <h1>Источники</h1>
    <p>Подключайте JSON API и получайте актуальные данные автоматически или по запросу.</p>
    {user?.permissions.includes('sources.manage') && <SourceForm onSaved={(source) => navigate(`/sources/${source.id}`)} />}
    <button type="button" className="source-refresh" onClick={() => setAttempt((value) => value + 1)}>Обновить список</button>
    {error && <p role="alert">{error}</p>}
    {!items && !error && <p>Загрузка…</p>}
    {items?.length === 0 && <p className="source-empty">Источников пока нет.</p>}
    <div className="source-list">{items?.map((source) => <article key={source.id}>
      <h2><Link to={`/sources/${source.id}`}>{source.name}</Link></h2>
      <p>{sourceStatuses[source.status] ?? source.status} · {scheduleLabel(source)}</p>
      <small>Последний успех: {sourceTime(source.last_success_at)}</small>
      {source.error && <p role="alert">{source.error}</p>}
    </article>)}</div>
  </section>;
}
