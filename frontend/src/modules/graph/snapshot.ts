import type { GraphData, InfrastructureObject, ObjectState, Resource } from './types';

// Один атомарный снимок графа и событий на asOf.
// GET /api/graph?at=<ISO-8601>. Без at сервер выбирает текущее время сам.
// currentEvents — последнее событие для каждой пары objectId + resource,
// occurredAt <= asOf; при одинаковом времени побеждает больший числовой id.
// status — уже нормализованная сервером категория; statusName — исходное название.
export interface CurrentEvent {
  id: string; objectId: string; resource: Resource; occurredAt: string;
  status: Exclude<ObjectState, 'unknown'>; statusName: string; description?: string;
}
export interface GraphSnapshot {
  topologyRevision: string; eventRevision: string; asOf: string; syncedAt: string | null;
  sourceStatus: 'online' | 'stale' | 'unavailable';
  objects: InfrastructureObject[]; dependencies: GraphData['dependencies']; currentEvents: CurrentEvent[];
}
export interface LiveGraph extends GraphData {
  topologyRevision: string; eventRevision: string; asOf: string; syncedAt: string | null;
  sourceStatus: GraphSnapshot['sourceStatus']; currentEvents: CurrentEvent[];
}
function validTime(value: unknown): value is string {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
const statuses = ['normal', 'maintenance', 'incident'];
export function eventOrder(a: CurrentEvent, b: CurrentEvent) {
  const time = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  return time || b.id.localeCompare(a.id, 'en', { numeric: true });
}
export function latestEvents(events: CurrentEvent[], asOf: string): CurrentEvent[] {
  const result = new Map<string, CurrentEvent>();
  for (const event of [...events].sort(eventOrder)) {
    const key = JSON.stringify([event.objectId, event.resource]);
    if (Date.parse(event.occurredAt) <= Date.parse(asOf) && !result.has(key)) result.set(key, event);
  }
  return [...result.values()];
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
export function normalizeSnapshot(raw: unknown): LiveGraph {
  if (!isRecord(raw) || !Array.isArray(raw.objects) || !Array.isArray(raw.dependencies)) throw new Error('Некорректный снимок графа');
  const objects = raw.objects as InfrastructureObject[], dependencies = raw.dependencies as GraphData['dependencies'];
  const ids = new Set<string>();
  for (const item of objects) {
    if (typeof item.id !== 'string' || ids.has(item.id) || typeof item.name !== 'string' ||
      !Array.isArray(item.resources) || item.resources.some(r => !['water', 'energy'].includes(r)) || typeof item.district !== 'string' || !['station', 'consumer'].includes(item.kind) || typeof item.address !== 'string' || typeof item.description !== 'string') throw new Error('Некорректный объект графа');
    ids.add(item.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of dependencies) {
    if (typeof edge.id !== 'string' || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target) || !['water', 'energy'].includes(edge.resource)) throw new Error('Некорректная связь графа');
    edgeIds.add(edge.id);
  }
  const adjacency = new Map<string, string[]>(), indegree = new Map(objects.map(item => [item.id, 0]));
  for (const edge of dependencies) {
    if (!objects.find(item => item.id === edge.source)!.resources.includes(edge.resource) ||
      !objects.find(item => item.id === edge.target)!.resources.includes(edge.resource)) throw new Error('Ресурс связи отсутствует у объекта');
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
  }
  const roots = [...indegree].filter(([, count]) => !count).map(([id]) => id);
  for (const id of roots) for (const target of adjacency.get(id) ?? []) {
    const degree = indegree.get(target)! - 1; indegree.set(target, degree); if (!degree) roots.push(target);
  }
  if (roots.length !== objects.length) throw new Error('Источник вернул циклический граф');
  // Состояние строится только по событиям, а не по потенциально устаревшим states.
  const asOf = raw.asOf;
  if (!validTime(asOf)) throw new Error('В снимке отсутствует корректное время asOf');
  const incoming = raw.currentEvents;
  if (!Array.isArray(incoming)) throw new Error('В снимке отсутствует currentEvents');
  const eventIds = new Set<string>();
  for (const event of incoming) {
    const object = objects.find(item => item.id === event.objectId);
    if (typeof event.id !== 'string' || eventIds.has(event.id) || !object?.resources.includes(event.resource) || !statuses.includes(event.status) ||
      typeof event.statusName !== 'string' || !validTime(event.occurredAt)) throw new Error('Некорректное событие графа');
    eventIds.add(event.id);
  }
  const currentEvents = latestEvents(incoming, asOf);
  const states = new Map<string, InfrastructureObject['states']>();
  for (const event of currentEvents) states.set(event.objectId, { ...states.get(event.objectId), [event.resource]: event.status });
  if (typeof raw.topologyRevision !== 'string' || typeof raw.eventRevision !== 'string' ||
    !['online', 'stale', 'unavailable'].includes(String(raw.sourceStatus)) ||
    (raw.syncedAt !== null && (!validTime(raw.syncedAt)))) throw new Error('Некорректные метаданные синхронизации');
  return { revision: String(raw.topologyRevision),
    topologyRevision: String(raw.topologyRevision), eventRevision: String(raw.eventRevision),
    asOf, syncedAt: raw.syncedAt as string | null,
    sourceStatus: raw.sourceStatus as GraphSnapshot['sourceStatus'],
    objects: objects.map(item => ({ ...item, states: states.get(item.id) ?? {} })), dependencies, currentEvents };
}
// Геометрию сравниваем отдельно от событий: обновление состояния не запускает ELK.
// Страхуемся и от ошибочно неизменённой версии топологии на сервере.
export function topologyKey(data: GraphData): string {
  return JSON.stringify([data.objects.map(o => o.id).sort(), data.dependencies.map(e => [e.id, e.source, e.target, e.resource]).sort()]);
}
