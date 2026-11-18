import { useState } from 'react';
import { resourceLabel } from '../workforce/types';
import { dateTime, duration } from './schedule';
import type { ScheduledIncident } from './types';

const columns = [
  { key: 'brigadeId', title: 'Бригада', type: 'number' },
  { key: 'sequence', title: 'Порядок', type: 'number' },
  { key: 'objectName', title: 'Объект ликвидации аварии', type: 'text' },
  { key: 'eventId', title: '№ события', type: 'number' },
  { key: 'resourceType', title: 'Ресурс', type: 'text' },
  { key: 'occurredAt', title: 'Возникновение аварии', type: 'date' },
  { key: 'startAt', title: 'Начало работ', type: 'date' },
  { key: 'finishAt', title: 'Плановое завершение', type: 'date' },
  { key: 'baseDurationSeconds', title: 'Базовое время', type: 'duration' },
  { key: 'actualDurationSeconds', title: 'Фактическое время*', type: 'duration' },
] as const;

export function ScheduleTable({ incidents }: { incidents: ScheduledIncident[] }) {
  const [sort, setSort] = useState<{ key: typeof columns[number]['key']; desc: boolean }>({ key: 'startAt', desc: false });
  const column = columns.find(c => c.key === sort.key)!;
  const sorted = [...incidents].sort((a, b) => {
    const left = a[sort.key], right = b[sort.key];
    const result = column.type === 'date' ? (Date.parse(String(left)) || 0) - (Date.parse(String(right)) || 0) : typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'ru', { numeric: true });
    return (sort.desc ? -result : result) || a.eventId - b.eventId;
  });
  return <section className="plan-section" aria-labelledby="schedule-title"><div className="section-heading"><h2 id="schedule-title">Сводное расписание</h2><span>{incidents.length} инцидентов · время МСК</span></div>
    <div className="operations-table-scroll" role="region" aria-label="Сводное расписание с горизонтальной прокруткой" tabIndex={0}><table className="operations-table schedule-table"><thead><tr>{columns.map(c => <th key={c.key} scope="col" aria-sort={sort.key === c.key ? sort.desc ? 'descending' : 'ascending' : 'none'}>
      <button className="sort-button" aria-label={`Сортировать расписание: ${c.title}`} onClick={() => setSort(current => ({ key: c.key, desc: current.key === c.key && !current.desc }))}>{c.title}<span aria-hidden="true">{sort.key === c.key ? sort.desc ? ' ↓' : ' ↑' : ' ↕'}</span></button>
    </th>)}</tr></thead><tbody>{sorted.map((item, index) => <tr key={`${item.eventId}-${index}`} data-schedule-event={item.eventId}>
      <td><strong>№{item.brigadeId}</strong></td><td>{item.sequence}</td><td><strong>{item.objectName}</strong><small>ID объекта: {item.objectId}</small></td><td>#{item.eventId}</td>
      <td><span className={`resource-badge ${item.resourceType === 'water' ? 'water' : item.resourceType === 'energy' ? 'energy' : 'other'}`}>{resourceLabel(item.resourceType)}</span></td>
      <td><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time></td><td><time dateTime={item.startAt}>{dateTime(item.startAt)}</time></td><td><time dateTime={item.finishAt}>{dateTime(item.finishAt)}</time></td>
      <td>{duration(item.baseDurationSeconds)}</td><td>{duration(item.actualDurationSeconds)}</td>
    </tr>)}</tbody></table>{!sorted.length && <p className="operations-empty">Инцидентов по заданным фильтрам нет.</p>}</div>
    <p className="operations-note">* Время работы бригады, рассчитанное алгоритмом с учётом квалификаций и конфликтности. Это прогноз, а не замер выполненного ремонта.</p>
  </section>;
}
