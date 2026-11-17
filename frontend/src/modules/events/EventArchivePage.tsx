import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { HttpError } from '../../shared/http';
import { authRequest } from '../../auth/api';
import { resourceNames, stateNames } from '../graph/types';
import type { Resource } from '../graph/types';
import { emptyArchiveFilters, filterArchive, normalizeArchive } from './archive';
import type { ArchiveFilters, ArchivedEvent } from './archive';
import './events.css';

function dateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

export function EventArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<ArchivedEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<ArchiveFilters>(() => ({ ...emptyArchiveFilters, objectId: searchParams.get('objectId') ?? '' }));

  useEffect(() => {
    let active = true;
    // Полный архив читаем один раз при открытии страницы. Даты и остальные
    // фильтры применяются в браузере; архив не участвует в 5-секундном опросе схемы.
    authRequest<unknown>('/events/archive', { cache: 'no-store' }).then(raw => {
      const all = normalizeArchive(raw);
      if (active) { setEvents(all); setError(''); }
    }).catch((reason: unknown) => {
      if (!active) return;
      setEvents(null);
      setError(reason instanceof HttpError && reason.status === 404
        ? 'API архива событий ещё не подключён.'
        : reason instanceof Error ? reason.message : 'Не удалось загрузить архив событий.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const objects = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events ?? []) map.set(event.objectId, event.objectName);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [events]);
  const types = useMemo(() => [...new Set((events ?? []).map(event => event.statusName))].sort((a, b) => a.localeCompare(b, 'ru')), [events]);
  const visible = useMemo(() => filterArchive(events ?? [], filters), [events, filters]);
  const change = (patch: Partial<ArchiveFilters>) => setFilters(current => ({ ...current, ...patch }));
  const updateObjectFilter = (objectId: string) => {
    change({ objectId });
    const next = new URLSearchParams(searchParams);
    if (objectId) next.set('objectId', objectId); else next.delete('objectId');
    setSearchParams(next, { replace: true });
  };

  return <section className="archive-page">
    <header className="archive-heading"><div><p className="archive-eyebrow">СОБЫТИЯ</p><h1>Архив событий</h1></div>
      {events && <strong className="archive-count">{visible.length.toLocaleString('ru-RU')} / {events.length.toLocaleString('ru-RU')}</strong>}
    </header>
    <div className="archive-filters" aria-label="Фильтры архива">
      <label>Объект<select aria-label="Объект графа" value={filters.objectId} onChange={e => updateObjectFilter(e.target.value)}>
        {filters.objectId && !objects.some(object => object.id === filters.objectId) && <option value={filters.objectId}>{filters.objectId}</option>}
        <option value="">Все объекты</option>{objects.map(object => <option key={object.id} value={object.id}>{object.name} · {object.id}</option>)}
      </select></label>
      <label>Тип события<select aria-label="Тип события" value={filters.statusName} onChange={e => change({ statusName: e.target.value })}>
        <option value="">Все типы</option>{types.map(type => <option key={type}>{type}</option>)}
      </select></label>
      <label>Ресурс<select aria-label="Ресурс события" value={filters.resource} onChange={e => change({ resource: e.target.value as Resource | '' })}>
        <option value="">Все ресурсы</option>{Object.entries(resourceNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select></label>
      <label>С даты<input aria-label="С даты" type="date" value={filters.from} max={filters.to || undefined} onChange={e => change({ from: e.target.value })} /></label>
      <label>По дату<input aria-label="По дату" type="date" value={filters.to} min={filters.from || undefined} onChange={e => change({ to: e.target.value })} /></label>
      <label className="archive-search">Поиск по ID или тексту<input aria-label="Поиск события" type="search" value={filters.search} placeholder="ID, объект, описание…" onChange={e => change({ search: e.target.value })} /></label>
      <button type="button" onClick={() => { setFilters(emptyArchiveFilters); setSearchParams({}, { replace: true }); }}>Сбросить фильтры</button>
    </div>
    {loading && <p className="archive-message" role="status">Загрузка полного архива событий…</p>}
    {!loading && error && <div className="archive-message" role="alert"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Повторить</button></div>}
    {!loading && !error && events && <>
      <div className="archive-table-wrap">
        <table className="archive-table">
          <thead><tr><th scope="col">ID</th><th scope="col">Дата и время</th><th scope="col">Объект</th><th scope="col">Тип события</th><th scope="col">Ресурс</th><th scope="col">Описание</th></tr></thead>
          <tbody>{visible.map(event => <tr key={event.id} data-event-id={event.id}>
            <td><code title={`ID события ${event.id}`}>{event.id}</code></td>
            <td><time dateTime={event.occurredAt}>{dateTime(event.occurredAt)}</time></td>
            <td><strong>{event.objectName}</strong><small className="archive-object-id">ID объекта: {event.objectId}</small></td>
            <td><span className={`archive-status ${event.status}`}>{event.statusName}</span><small>{stateNames[event.status]}</small></td>
            <td>{resourceNames[event.resource]}</td>
            <td>{event.description || '—'}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className="archive-empty">По заданным фильтрам событий нет.</p>}
      </div>
      <p className="archive-footnote">Загружено записей: {events.length.toLocaleString('ru-RU')}</p>
    </>}
  </section>;
}
