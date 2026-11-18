import { calendarDate, experienceYears, fullName, resourceLabel } from '../workforce/types';
import { dateTime, duration, incidentOrder } from './schedule';
import type { FormationResult, ScheduledIncident } from './types';

export function BrigadeTree({ result, incidents }: { result: FormationResult; incidents: ScheduledIncident[] }) {
  return <section className="plan-section" aria-labelledby="brigades-title"><div className="section-heading"><h2 id="brigades-title">Составы и последовательность работ</h2><span>Раскройте бригаду для просмотра</span></div>
    <div className="brigade-tree">{result.brigades.map((brigade, index) => {
      const assigned = incidents.filter(item => item.brigadeId === brigade.brigadeId).sort(incidentOrder);
      return <details className="brigade-card" key={`${brigade.brigadeId}-${index}`}><summary><span className="brigade-number">{brigade.brigadeId}</span><strong>Бригада №{brigade.brigadeId}</strong><span>{brigade.employeeIds.length} рабочих</span><span>{assigned.length} инцидентов</span><span className="brigade-expand" aria-hidden="true">⌄</span></summary>
        <div className="brigade-content"><h3>План выполнения</h3>{assigned.length ? <ol className="brigade-sequence">{assigned.map((item, i) => <li key={`${item.eventId}-${i}`}><span className="sequence-number">{item.sequence}</span><div><strong>{item.objectName}</strong><p>Событие #{item.eventId} · ID объекта {item.objectId}</p><p>{dateTime(item.startAt)} → {dateTime(item.finishAt)} · {duration(item.actualDurationSeconds)}</p></div><span className={`resource-badge ${item.resourceType === 'water' ? 'water' : item.resourceType === 'energy' ? 'energy' : 'other'}`}>{resourceLabel(item.resourceType)}</span></li>)}</ol> : <p className="operations-note">Нет инцидентов по выбранным фильтрам.</p>}
          <h3>Списочный состав</h3><div className="operations-table-scroll" tabIndex={0} role="region" aria-label={`Состав бригады №${brigade.brigadeId}`}><table className="operations-table roster-table"><thead><tr><th>Табельный № / ID</th><th>ФИО</th><th>Начало стажа</th><th>Стаж, лет</th><th>Все квалификации</th></tr></thead><tbody>{brigade.employeeIds.map((id, i) => {
            const employee = result.employees.find(e => e.tabel === id);
            return <tr key={`${id}-${i}`}><td>{id}</td><td>{employee ? fullName(employee) : 'Сведения о рабочем отсутствуют'}</td><td>{employee ? calendarDate(employee.start_date_experience) : '—'}</td><td>{employee ? experienceYears(employee.start_date_experience) ?? '—' : '—'}</td><td>{employee?.qualifications.length ? employee.qualifications.map(q => <span className="roster-qualification" key={q.id_qualification}>{resourceLabel(q.resource_type)}: <strong>{q.proff?.toLocaleString('ru-RU', { minimumFractionDigits: 1 }) ?? '—'}</strong> · ID квалификации {q.id_qualification} · ID рабочего {q.id_employee}</span>) : 'Нет квалификаций'}</td></tr>;
          })}</tbody></table></div></div>
      </details>;
    })}</div>
  </section>;
}
