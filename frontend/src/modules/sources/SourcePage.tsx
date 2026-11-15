import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { SourceForm } from './SourceForm';
import { scheduleLabel, sourceStatuses, sourceTime } from './sources';
import type { SourceDetail, SourceSettings } from './sources';
import './sources.css';

function SourceCard({ id }: { id: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = Boolean(user?.permissions.includes('sources.manage'));
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [settings, setSettings] = useState<SourceSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await authRequest<SourceDetail>(`/sources/${id}`);
        if (active) { setSource(result); setRefreshError(''); }
      } catch (err) { if (active) setRefreshError(err instanceof Error ? err.message : 'Не удалось обновить данные'); }
    }
    void refresh();
    if (canManage) authRequest<SourceSettings>(`/sources/${id}/settings`)
      .then((value) => { if (active) setSettings(value); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить настройки'); });
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, canManage]);

  async function poll() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await authRequest<SourceDetail>(`/sources/${id}/poll`, { method: 'POST' });
      setSource(result);
      if (result.status === 'success') setNotice('Данные обновлены');
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось опросить источник'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Удалить источник и сохранённый ответ?')) return;
    setBusy(true); setError('');
    try { await authRequest(`/sources/${id}`, { method: 'DELETE' }); navigate('/sources'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить источник'); }
    finally { setBusy(false); }
  }
  async function saved(value: SourceSettings) {
    setSettings(value); setRevision((current) => current + 1); setNotice('Настройки сохранены'); setError('');
    try { setSource(await authRequest<SourceDetail>(`/sources/${id}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось обновить карточку'); }
  }

  return <section className="sources-page">
    <Link to="/sources">← К источникам</Link>
    {error && <p role="alert">{error}</p>}
    {refreshError && <p role="alert">{refreshError}</p>}
    {!source && !error && !refreshError && <p>Загрузка…</p>}
    {source && <>
      <h1>{source.name}</h1>
      <p>{sourceStatuses[source.status] ?? source.status} · {scheduleLabel(source)}</p>
      <dl className="source-times">
        <div><dt>Последняя попытка</dt><dd>{sourceTime(source.last_attempt_at)}</dd></div>
        <div><dt>Последний успех</dt><dd>{sourceTime(source.last_success_at)}</dd></div>
        <div><dt>Следующий автоопрос</dt><dd>{sourceTime(source.next_poll_at)}</dd></div>
      </dl>
      {canManage && <div className="source-actions">
        <button onClick={poll} disabled={busy}>{busy ? 'Опрос…' : 'Опросить сейчас'}</button>
        <button onClick={remove} disabled={busy} className="button-danger">Удалить источник</button>
      </div>}
      {notice && <p role="status">{notice}</p>}
      {source.error && <p role="alert">{source.error}</p>}
      <section className="source-snapshot"><h2>Последний успешный ответ</h2>
        <p>Получен: {sourceTime(source.last_success_at)}. При ошибке следующего опроса эти данные сохраняются.</p>
        {source.last_success_at ? <pre>{JSON.stringify(source.payload, null, 2)}</pre> : <p>Успешных ответов пока нет.</p>}
      </section>
      {canManage && settings && <SourceForm key={revision} source={settings} onSaved={saved} />}
    </>}
  </section>;
}

export function SourcePage() {
  const { id = '' } = useParams();
  return <SourceCard key={id} id={id} />;
}
