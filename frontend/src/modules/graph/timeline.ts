import { latestEvents } from './snapshot.ts';
import type { CurrentEvent, LiveGraph } from './snapshot';

// Берём весь архив, включая события ДО начала периода: они задают исходные
// состояния ресурсов. Диапазон ограничивает только точки проигрывателя.
export function timelinePoints(events: CurrentEvent[], from = '', to = ''): string[] {
  const start = from ? Date.parse(from) : -Infinity, end = to ? Date.parse(to) : Infinity;
  return [...new Set(events.map(event => Date.parse(event.occurredAt)))]
    .filter(time => time >= start && time <= end).sort((a, b) => a - b).map(time => new Date(time).toISOString());
}
export function historicalSnapshot(topology: LiveGraph, events: CurrentEvent[], at: string): LiveGraph {
  const objects = new Map(topology.objects.map(object => [object.id, object]));
  const currentEvents = latestEvents(events.filter(event => objects.get(event.objectId)?.resources.includes(event.resource)), at);
  return { ...topology, asOf: at, currentEvents,
    objects: topology.objects.map(object => ({ ...object, states: Object.fromEntries(currentEvents
      .filter(event => event.objectId === object.id).map(event => [event.resource, event.status])) })) };
}
