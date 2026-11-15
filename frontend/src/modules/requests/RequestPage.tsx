import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { RequestForm } from './RequestForm';
import { requestStatuses, requestDate } from './requests';
import type { RequestItem, Assignee } from './requests';
import './requests.css';

function RequestCard({ id }: { id: string }) {
  const { user } = useAuth();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [item, setItem] = useState<RequestItem | null>(null);
  const [people, setPeople] = useState<Assignee[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([authRequest<RequestItem>(`/requests/${id}`), authRequest<Assignee[]>('/requests/assignees')])
      .then(([value, assignees]) => { if (active) { setItem(value); setPeople(assignees); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить заявку'); });
    return () => { active = false; };
  }, [id]);
  async function remove() {
    if (!window.confirm('Удалить заявку?')) return;
    setBusy(true); setError('');
    try { await authRequest(`/requests/${id}`, { method: 'DELETE' }); navigate(`/requests${search}`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить заявку'); }
    finally { setBusy(false); }
  }
  return <section className="requests-page">
    <Link to={`/requests${search}`}>← К заявкам</Link>
    {error && <p role="alert">{error}</p>}
    {!item && !error && <p>Загрузка…</p>}
    {item && <>
      <h1>{item.title}</h1>
      <span className="request-status">{requestStatuses[item.status]}</span>
      <p className="request-description">{item.description || 'Описание не указано.'}</p>
      <dl className="request-details">
        <div><dt>Автор</dt><dd>{item.author_name}</dd></div><div><dt>Исполнитель</dt><dd>{item.assignee_name ?? 'Не назначен'}</dd></div>
        <div><dt>Создана</dt><dd>{requestDate(item.created_at)}</dd></div><div><dt>Изменена</dt><dd>{requestDate(item.updated_at)}</dd></div>
      </dl>
      {notice && <p role="status">{notice}</p>}
      {user?.permissions.includes('requests.manage') && <>
        <RequestForm key={item.updated_at} item={item} people={people} onSaved={(value) => { setItem(value); setNotice('Заявка сохранена'); }} />
        <button className="button-danger request-delete" onClick={remove} disabled={busy}>Удалить заявку</button>
      </>}
    </>}
  </section>;
}
export function RequestPage() {
  const { id = '' } = useParams();
  return <RequestCard key={id} id={id} />;
}
