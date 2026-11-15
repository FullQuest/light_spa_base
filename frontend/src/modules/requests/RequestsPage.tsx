import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { RequestForm } from './RequestForm';
import { requestStatuses, requestDate } from './requests';
import type { RequestItem, Assignee } from './requests';
import './requests.css';

export function RequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [result, setResult] = useState<{ query: string; items: RequestItem[]; people: Assignee[]; error: string } | null>(null);
  const current = result?.query === query ? result : null;
  useEffect(() => {
    let active = true;
    Promise.all([authRequest<RequestItem[]>(`/requests?${query}`), authRequest<Assignee[]>('/requests/assignees')])
      .then(([items, people]) => { if (active) setResult({ query, items, people, error: '' }); })
      .catch((err: unknown) => { if (active) setResult({ query, items: [], people: [], error: err instanceof Error ? err.message : 'Не удалось загрузить заявки' }); });
    return () => { active = false; };
  }, [query]);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (value) next.set(key, String(value));
    setParams(next);
  }
  return <section className="requests-page">
    <h1>Заявки</h1>
    <p>Создавайте поручения, назначайте исполнителей и отслеживайте состояние.</p>
    {result && !result.error && user?.permissions.includes('requests.manage') && <RequestForm people={result.people} onSaved={(item) => navigate(`/requests/${item.id}`)} />}
    {!current && <p>Загрузка…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current && !current.error && <>
      <form key={query} className="request-filters" onSubmit={filter}>
        <label>Поиск заявок<input type="search" name="q" defaultValue={params.get('q') ?? ''} placeholder="Название или описание" /></label>
        <label>Статус<select name="status" aria-label="Фильтр статуса" defaultValue={params.get('status') ?? ''}>
          <option value="">Все статусы</option>{Object.entries(requestStatuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></label>
        <label>Исполнитель<select name="assignee_id" aria-label="Фильтр исполнителя" defaultValue={params.get('assignee_id') ?? ''}>
          <option value="">Все исполнители</option>{current.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <label className="request-check"><input name="mine" type="checkbox" value="true" defaultChecked={params.get('mine') === 'true'} />Только мои</label>
        <button type="submit">Применить</button><button type="button" onClick={() => setParams({})}>Сбросить</button>
      </form>
      <p role="status">Найдено заявок: {current.items.length}</p>
      {current.items.length === 0 && <p className="request-empty">Заявки не найдены.</p>}
      <div className="request-list">{current.items.map((item) => <article key={item.id}>
        <h2><Link to={`/requests/${item.id}${query ? '?' + query : ''}`}>{item.title}</Link></h2>
        <span className="request-status">{requestStatuses[item.status]}</span>
        {item.description && <p>{item.description.slice(0, 180)}{item.description.length > 180 ? '…' : ''}</p>}
        <small>Автор: {item.author_name} · Исполнитель: {item.assignee_name ?? 'Не назначен'} · {requestDate(item.created_at)}</small>
      </article>)}</div>
    </>}
  </section>;
}
