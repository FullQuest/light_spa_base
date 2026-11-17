import { useEffect, useRef } from 'react';
import type { CurrentEvent, LiveGraph } from './snapshot';
import type { Resource } from './types';
import { resourceNames, stateIcons, stateNames } from './types';
export function EventsPanel({ data, focused, resource, visibleIds, districtNames, onSelect }: {
  data: LiveGraph; focused: string | null; resource: Resource | null; visibleIds: Set<string>; districtNames: Map<string, string>;
  onSelect: (event: CurrentEvent) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Выбор вершины подсвечивает все её текущие ресурсные события. При опросе
  // сохраняется objectId, поэтому заменившее его событие тоже выделится.
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused, resource]);
  return <aside className="graph-events" aria-label="Актуальные события">
    <header><h2>Актуальные события <span>{data.currentEvents.length}</span></h2>
      <p>Последнее событие для каждого объекта и ресурса. Новые — сверху.</p>
      {data.legacyDemo && <small>Демонстрационные записи, не данные внешней БД.</small>}
      {focused && !data.currentEvents.some(event => event.objectId === focused) && <p role="status">Для выбранного объекта событий нет.</p>}
    </header>
    <div className="graph-event-list" ref={list}>
      {!data.currentEvents.length && <p>На момент снимка событий нет. Состояния объектов неизвестны.</p>}
      {data.currentEvents.map(event => {
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
