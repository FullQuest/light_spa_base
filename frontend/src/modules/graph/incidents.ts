import type { CurrentEvent } from './snapshot.ts';
import type { GraphData, Resource } from './types.ts';
import { influenceZone } from './types.ts';

export interface ResourceIncident {
  own?: CurrentEvent;
  origins: CurrentEvent[];
  since: string;
}
export type IncidentMap = Record<string, Partial<Record<Resource, ResourceIncident>>>;
// Сервер возвращает исходные актуальные события. Производные аварии на потомках
// не создают новых событий: сохраняем исходный event и его occurredAt для таймера.
// Для собственной аварии используем её время; для влияния нескольких источников
// — самое раннее АКТИВНОЕ событие. После закрытия источника расчёт обновляется.
export function incidentImpact(data: GraphData, events: CurrentEvent[]) {
  const byObject: IncidentMap = {}, counts: Record<string, number> = {};
  const sources = new Map<string, Set<string>>();
  const objects = new Map(data.objects.map(item => [item.id, item]));
  for (const event of events) {
    if (event.status !== 'incident') continue;
    const zone = influenceZone([{ id: event.objectId, resource: event.resource }], data.dependencies);
    const influenced = sources.get(event.objectId) ?? new Set<string>();
    for (const id of zone.nodes) {
      if (!objects.get(id)?.resources.includes(event.resource)) continue;
      if (id !== event.objectId) influenced.add(id);
      const resources = byObject[id] ??= {};
      const entry = resources[event.resource] ??= { origins: [], since: event.occurredAt };
      entry.origins.push(event);
      if (id === event.objectId) { entry.own = event; entry.since = event.occurredAt; }
      else if (!entry.own && Date.parse(event.occurredAt) < Date.parse(entry.since)) entry.since = event.occurredAt;
    }
    sources.set(event.objectId, influenced);
  }
  for (const [id, nodes] of sources) counts[id] = nodes.size;
  return { byObject, counts };
}
export function formatDuration(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return [days ? `${days} д` : '', hours || days ? `${hours} ч` : '', minutes || hours || days ? `${minutes} мин` : '', `${seconds % 60} с`].filter(Boolean).join(' ');
}
