import type { FormationResult, M2Export, ScheduledIncident } from './types.ts';

export function dateTime(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';
}
export function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds === 0) return '0 с';
  if (seconds < 1) return '< 1 с';
  const rounded = Math.ceil(seconds);
  const days = Math.floor(rounded / 86400), hours = Math.floor(rounded % 86400 / 3600), minutes = Math.floor(rounded % 3600 / 60), rest = rounded % 60;
  return [days && `${days} д`, hours && `${hours} ч`, minutes && `${minutes} мин`, rest && `${rest} с`].filter(Boolean).join(' ');
}
export const incidentOrder = (a: ScheduledIncident, b: ScheduledIncident) => a.sequence - b.sequence || a.eventId - b.eventId;
export function exportM2(result: FormationResult): M2Export {
  return { brigades: result.brigades.map(brigade => ({ brigade_id: brigade.brigadeId, employees: [...brigade.employeeIds],
    event_order: result.incidents.filter(item => item.brigadeId === brigade.brigadeId).sort(incidentOrder).map(item => item.eventId) })) };
}
export function validInterval(item: ScheduledIncident) {
  const start = Date.parse(item.startAt), end = Date.parse(item.finishAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}
export function scheduleSpanSeconds(incidents: ScheduledIncident[]) {
  let start = Infinity, end = -Infinity;
  for (const item of incidents) if (validInterval(item)) {
    start = Math.min(start, Date.parse(item.startAt)); end = Math.max(end, Date.parse(item.finishAt));
  }
  return start === Infinity ? null : (end - start) / 1000;
}
export interface PositionedIncident { incident: ScheduledIncident; start: number; end: number; track: number }
export interface TimelineLane { brigadeId: number; items: PositionedIncident[]; tracks: number; busySeconds: number; waitSeconds: number }

// Pack overlapping intervals into separate tracks rather than drawing them over one another.
export function timelineLayout(result: FormationResult, minimumVisualDuration = 0) {
  const valid = result.incidents.filter(validInterval);
  let start = Infinity, end = -Infinity;
  for (const item of valid) { start = Math.min(start, Date.parse(item.startAt)); end = Math.max(end, Date.parse(item.finishAt)); }
  if (!valid.length) return { start: 0, end: 3600000, lanes: result.brigades.map(b => ({ brigadeId: b.brigadeId, items: [], tracks: 1, busySeconds: 0, waitSeconds: 0 })) as TimelineLane[] };
  if (end === start) end = start + 60000;
  const lanes: TimelineLane[] = result.brigades.map(brigade => {
    const trackEnds: number[] = [];
    let unionEnd = start, busy = 0;
    const items = valid.filter(item => item.brigadeId === brigade.brigadeId).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || incidentOrder(a, b)).map(incident => {
      const itemStart = Date.parse(incident.startAt), itemEnd = Date.parse(incident.finishAt);
      let track = trackEnds.findIndex(value => value <= itemStart);
      if (track === -1) track = trackEnds.length;
      trackEnds[track] = Math.max(itemEnd, itemStart + Math.max(1, minimumVisualDuration));
      busy += Math.max(0, itemEnd - Math.max(unionEnd, itemStart));
      unionEnd = Math.max(unionEnd, itemEnd);
      return { incident, start: itemStart, end: itemEnd, track };
    });
    return { brigadeId: brigade.brigadeId, items, tracks: Math.max(1, trackEnds.length), busySeconds: busy / 1000, waitSeconds: Math.max(0, (end - start - busy) / 1000) };
  });
  return { start, end, lanes };
}

export function scheduleIssues(result: FormationResult): string[] {
  const issues = new Set<string>();
  const ids = new Set<number>(), employees = new Set<number>(), brigadeIds = new Set<number>();
  for (const brigade of result.brigades) {
    if (brigadeIds.has(brigade.brigadeId)) issues.add(`Повторяется номер бригады ${brigade.brigadeId}.`);
    brigadeIds.add(brigade.brigadeId);
    if (brigade.employeeIds.length < 2 || brigade.employeeIds.length > 5) issues.add(`В бригаде №${brigade.brigadeId} должно быть от 2 до 5 рабочих.`);
    for (const id of brigade.employeeIds) {
      if (employees.has(id)) issues.add(`Рабочий №${id} включён в состав несколько раз.`);
      employees.add(id);
      if (!result.employees.some(e => e.tabel === id)) issues.add(`Нет сведений о рабочем №${id}.`);
    }
    const ordered = result.incidents.filter(i => i.brigadeId === brigade.brigadeId).sort(incidentOrder);
    const sequences = new Set<number>();
    if (!ordered.length) issues.add(`У бригады №${brigade.brigadeId} нет назначенных инцидентов.`);
    for (const item of ordered) {
      if (!Number.isInteger(item.sequence) || item.sequence < 1 || sequences.has(item.sequence)) issues.add(`У бригады №${brigade.brigadeId} некорректная нумерация порядка работ.`);
      sequences.add(item.sequence);
      if (!brigade.employeeIds.some(id => result.employees.find(e => e.tabel === id)?.qualifications.some(q => q.resource_type === item.resourceType && (q.proff ?? 0) > 0))) issues.add(`У бригады №${brigade.brigadeId} нет квалификации для события №${item.eventId}.`);
    }
    for (let index = 1; index < ordered.length; index++) {
      if (Date.parse(ordered[index].startAt) < Date.parse(ordered[index - 1].finishAt)) issues.add(`У бригады №${brigade.brigadeId} пересекаются работы или нарушен их порядок.`);
    }
  }
  if (result.incidents.length && result.employees.some(e => !employees.has(e.tabel))) issues.add('В формировании задействованы не все рабочие.');
  for (const item of result.incidents) {
    if (ids.has(item.eventId)) issues.add(`Событие №${item.eventId} назначено несколько раз.`);
    ids.add(item.eventId);
    if (!brigadeIds.has(item.brigadeId)) issues.add(`Для события №${item.eventId} указана неизвестная бригада.`);
    if (!validInterval(item)) issues.add(`У события №${item.eventId} некорректный интервал. Он исключён только из диаграммы.`);
    if (!Number.isFinite(item.baseDurationSeconds) || item.baseDurationSeconds < 0 || !Number.isFinite(item.actualDurationSeconds) || item.actualDurationSeconds < 0) issues.add(`У события №${item.eventId} некорректная длительность.`);
    if (validInterval(item) && Math.abs((Date.parse(item.finishAt) - Date.parse(item.startAt)) / 1000 - item.actualDurationSeconds) > 1) issues.add(`У события №${item.eventId} длительность не совпадает с интервалом работ.`);
    if (validInterval(item) && Date.parse(item.startAt) < Date.parse(item.occurredAt)) issues.add(`Работы по событию №${item.eventId} начинаются до аварии.`);
  }
  return [...issues];
}
