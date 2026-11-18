import { useEffect, useMemo, useRef, useState } from 'react';
import { resourceLabel } from '../workforce/types';
import { dateTime, duration, timelineLayout } from './schedule';
import type { FormationResult, ScheduledIncident } from './types';

export function SwimlaneTimeline({ result, incidents }: { result: FormationResult; incidents: ScheduledIncident[] }) {
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<ScheduledIncident | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(1000, containerWidth - 182) * zoom;
  const layout = useMemo(() => {
    const input = { ...result, incidents };
    const range = timelineLayout(input);
    return timelineLayout(input, (range.end - range.start) * 3 / width);
  }, [result, incidents, width]);
  const span = layout.end - layout.start;
  const ticks = Array.from({ length: 9 }, (_, index) => layout.start + span * index / 8);
  const resources = [...new Set(incidents.map(item => item.resourceType))];
  return <section className="plan-section" aria-labelledby="timeline-title" ref={container}><div className="section-heading"><div><h2 id="timeline-title">Расписание бригад</h2><p className="operations-note">Время МСК · свободные участки дорожки — ожидание · нажмите на блок для подробностей</p></div><label className="timeline-zoom">Масштаб<select aria-label="Масштаб" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={2}>200%</option><option value={4}>400%</option></select></label></div>
    <div className="timeline-legend">{resources.map(resource => <span key={resource} className={`resource-badge ${resource === 'water' ? 'water' : resource === 'energy' ? 'energy' : 'other'}`}>{resourceLabel(resource)}</span>)}<span className="timeline-idle-key">Ожидание</span></div>
    {!incidents.length ? <p className="operations-empty">Нет инцидентов для отображения на диаграмме.</p> : <div className="swimlane-scroll" tabIndex={0} role="region" aria-label="Временная диаграмма с горизонтальной прокруткой"><div className="swimlane-canvas" style={{ width: width + 180 }}>
      <div className="swimlane-axis"><div className="swimlane-label">Бригада / занятость</div><div className="swimlane-ticks" style={{ width }}>{ticks.map((value, index) => <time key={index} dateTime={new Date(value).toISOString()} style={{ left: `${index * 12.5}%` }}><span>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' }).format(value)}</span><strong>{new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: span < 120000 ? '2-digit' : undefined, timeZone: 'Europe/Moscow' }).format(value)}</strong></time>)}</div></div>
      {layout.lanes.map((lane, laneIndex) => <div key={`${lane.brigadeId}-${laneIndex}`} className="swimlane-row" style={{ minHeight: 66 * lane.tracks + 20 }}><div className="swimlane-label"><strong>Бригада №{lane.brigadeId}</strong><small>Работа: {duration(lane.busySeconds)}</small><small>Ожидание: {duration(lane.waitSeconds)}</small></div><div className="swimlane-track" style={{ width, minHeight: 66 * lane.tracks + 20 }}>
        {ticks.map((_, index) => <span className="swimlane-gridline" key={index} style={{ left: `${index * 12.5}%` }} />)}
        {!lane.items.length && <span className="swimlane-no-work">Нет назначенных работ</span>}
        {lane.items.map(({ incident, start, end, track }, index) => {
          const left = (start - layout.start) / span * width;
          const blockWidth = Math.max(3, (end - start) / span * width);
          const label = `Бригада №${lane.brigadeId}, событие #${incident.eventId}, ${incident.objectName}, ${resourceLabel(incident.resourceType)}, ${dateTime(incident.startAt)} — ${dateTime(incident.finishAt)}`;
          return <button key={`${incident.eventId}-${index}`} type="button" className={`swimlane-block ${incident.resourceType === 'water' ? 'water' : incident.resourceType === 'energy' ? 'energy' : 'other'} ${blockWidth < 54 ? 'compact' : ''}`} data-timeline-event={incident.eventId} aria-label={label} title={label} style={{ left: Math.min(left, width - 3), width: Math.min(blockWidth, width - left || 3), top: 10 + track * 66 }} onClick={() => setSelected(incident)}>
            <strong>#{incident.eventId}</strong><span>{incident.objectName}</span><small>{duration(incident.actualDurationSeconds)}</small>
          </button>;
        })}</div></div>)}
    </div></div>}
    {selected && incidents.includes(selected) && <aside className="timeline-detail" role="status" aria-label="Подробности инцидента"><button aria-label="Закрыть подробности инцидента" onClick={() => setSelected(null)}>×</button><strong>Событие #{selected.eventId} · {selected.objectName}</strong><p>Бригада №{selected.brigadeId} · {resourceLabel(selected.resourceType)} · работа №{selected.sequence}</p><p>{dateTime(selected.startAt)} → {dateTime(selected.finishAt)}</p><p>Базовое время: {duration(selected.baseDurationSeconds)} · с учётом состава: {duration(selected.actualDurationSeconds)}</p></aside>}
  </section>;
}
