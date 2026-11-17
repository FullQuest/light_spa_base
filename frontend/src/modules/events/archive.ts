import type { Resource } from '../graph/types';

export type ArchiveStatus = 'normal' | 'maintenance' | 'incident';
export interface ArchivedEvent {
  id: string;
  objectId: string;
  objectName: string;
  resource: Resource;
  occurredAt: string;
  status: ArchiveStatus;
  statusName: string;
  description: string;
}
export interface ArchiveFilters {
  objectId: string;
  statusName: string;
  resource: Resource | '';
  from: string;
  to: string;
  search: string;
}
export const emptyArchiveFilters: ArchiveFilters = { objectId: '', statusName: '', resource: '', from: '', to: '', search: '' };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
// Контракт полного архива: GET /api/events/archive -> { events: [...] }.
// ID от PostgreSQL передаётся строкой; даты обязательно содержат часовой пояс.
export function normalizeArchive(raw: unknown): ArchivedEvent[] {
  if (!record(raw) || !Array.isArray(raw.events)) throw new Error('Сервер вернул архив в неверном формате');
  const ids = new Set<string>();
  return raw.events.map((value): ArchivedEvent => {
    if (!record(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id) ||
      typeof value.objectId !== 'string' || !value.objectId ||
      (value.objectName !== undefined && typeof value.objectName !== 'string') ||
      !['water', 'energy'].includes(String(value.resource)) || !validDate(value.occurredAt) ||
      !['normal', 'maintenance', 'incident'].includes(String(value.status)) || typeof value.statusName !== 'string' ||
      (value.description !== undefined && typeof value.description !== 'string')) {
      throw new Error('В архиве есть некорректная или повторяющаяся запись');
    }
    ids.add(value.id);
    return { id: value.id, objectId: value.objectId, objectName: value.objectName as string ?? value.objectId,
      resource: value.resource as Resource, occurredAt: value.occurredAt, status: value.status as ArchiveStatus,
      statusName: value.statusName, description: value.description as string ?? '' };
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id, 'en', { numeric: true }));
}
export function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function filterArchive(events: ArchivedEvent[], filters: ArchiveFilters): ArchivedEvent[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return events.filter(event => (!filters.objectId || event.objectId === filters.objectId) &&
    (!filters.statusName || event.statusName === filters.statusName) &&
    (!filters.resource || event.resource === filters.resource) &&
    (!filters.from || localDateKey(event.occurredAt) >= filters.from) &&
    (!filters.to || localDateKey(event.occurredAt) <= filters.to) &&
    (!query || `${event.id} ${event.objectId} ${event.objectName} ${event.statusName} ${event.description}`.toLocaleLowerCase().includes(query)));
}
