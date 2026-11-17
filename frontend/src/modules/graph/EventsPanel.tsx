import { useEffect, useRef, useState } from 'react';
import type { CurrentEvent, LiveGraph } from './snapshot';
import type { Resource } from './types';
import { resourceNames, stateIcons, stateNames } from './types';
export function EventsPanel({ data, focused, resource, visibleIds, districtNames, onSelect }: {
  data: LiveGraph; focused: string | null; resource: Resource | null; visibleIds: Set<string>; districtNames: Map<string, string>;
  onSelect: (event: CurrentEvent) => void;
}) {
  const [statuses, setStatuses] = useState({ incident: true, maintenance: true, normal: false });
  const [resources, setResources] = useState({ water: true, energy: true });
  const events = data.currentEvents.filter(event => statuses[event.status] && resources[event.resource]);
  const list = useRef<HTMLDivElement>(null);
  // Выбор вершины подсвечивает все её текущие ресурсные события. При опросе
  // сохраняется objectId, поэтому заменившее его событие тоже выделится.
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused, resource]);
  return <aside className="graph-events" aria-label="Актуальные события">
    <header><h2>Актуальные события <span>{events.length} / {data.currentEvents.length}</span></h2>
      <fieldset className="event-filters"><legend>Состояния событий</legend>{Object.entries(statuses).map(([key, checked]) => <label key={key}><input type="checkbox" checked={checked} onChange={() => setStatuses(current => ({ ...current, [key]: !checked }))} />{stateNames[key as keyof typeof statuses]}</label>)}</fieldset>
      <fieldset className="event-filters"><legend>Ресурсы событий</legend>{Object.entries(resources).map(([key, checked]) => <label key={key}><input type="checkbox" checked={checked} onChange={() => setResources(current => ({ ...current, [key]: !checked }))} />{resourceNames[key as Resource]}</label>)}</fieldset>
      {focused && data.currentEvents.some(event => event.objectId === focused && (!resource || event.resource === resource)) && !events.some(event => event.objectId === focused && (!resource || event.resource === resource)) && <p role="status">События выбранного объекта скрыты фильтрами.</p>}
      {focused && !data.currentEvents.some(event => event.objectId === focused) && <p role="status">Для выбранного объекта событий нет.</p>}
    </header>
    <div className="graph-event-list" ref={list}>
      {!events.length && <p>Нет событий по выбранным условиям.</p>}
      {events.map(event => {
        const object = data.objects.find(item => item.id === event.objectId)!;
        const selected = event.objectId === focused && (!resource || event.resource === resource);
        return <button key={event.id} data-event-id={event.id} data-object-id={event.objectId} data-resource={event.resource}
          className={`graph-event ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(event)}>
          <span className={`object-state ${event.status}`}>{stateIcons[event.status]} {stateNames[event.status]}</span>
          <strong>{object.name}</strong><span>{resourceNames[event.resource]} · {districtNames.get(object.id) ?? 'Без района'}</span>
          <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString('ru-RU')}</time>
          <small>{event.statusName}</small>{event.description && <small>{event.description}</small>}
          {!visibleIds.has(object.id) && <small>Объект скрыт · нажмите, чтобы показать</small>}
        </button>;
      })}
    </div>
  </aside>;
}
