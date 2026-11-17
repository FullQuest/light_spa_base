import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { normalizeArchive } from '../events/archive';
import type { ArchivedEvent } from '../events/archive';
import { GraphView } from './GraphPage';
import { useLiveGraph } from './useLiveGraph';
import { historicalSnapshot, timelinePoints } from './timeline';
import './timeline.css';

function localInput(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
const displayTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

export function GraphArchivePage() {
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const graph = useLiveGraph(user?.id, attempt, false);
  const [archive, setArchive] = useState<ArchivedEvent[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    // Полный архив загружается один раз. При подключении другого API необходимо
    // сохранить всю предысторию, а не только события внутри выбранного периода.
    void authRequest<unknown>('/events/archive', { signal: controller.signal, cache: 'no-store' })
      .then(raw => { if (!controller.signal.aborted) { setArchive(normalizeArchive(raw)); setError(''); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить архив'); });
    return () => controller.abort();
  }, [attempt]);
  if (graph.error || error) return <section><h1>Архив</h1><p role="alert">{graph.error || error}</p><button onClick={() => { setError(''); setArchive(null); setAttempt(value => value + 1); }}>Повторить</button></section>;
  if (!graph.loaded || !archive) return <section><h1>Архив</h1><p role="status">Загрузка истории и схемы…</p></section>;
  return <TimelineGraph key={attempt} loaded={graph.loaded} events={archive} storageWarning={graph.storageWarning} />;
}

function TimelineGraph({ loaded, events, storageWarning }: {
  loaded: NonNullable<ReturnType<typeof useLiveGraph>['loaded']>; events: ArchivedEvent[]; storageWarning: string;
}) {
  const allPoints = useMemo(() => timelinePoints(events), [events]);
  const [from, setFrom] = useState(() => allPoints.length ? localInput(allPoints[0]) : '');
  const [to, setTo] = useState(() => allPoints.length ? localInput(allPoints.at(-1)!) : '');
  const points = useMemo(() => timelinePoints(events, from, to), [events, from, to]);
  const [index, setIndex] = useState(() => Math.max(0, points.length - 1));
  const [playing, setPlaying] = useState(false);
  const selected = Math.min(index, Math.max(0, points.length - 1));
  const at = points[selected];
  const data = useMemo(() => historicalSnapshot(loaded.data, events, at ?? loaded.data.asOf), [loaded.data, events, at]);
  const isPlaying = playing && selected < points.length - 1;
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setTimeout(() => {
      setIndex(selected + 1);
      if (selected + 1 === points.length - 1) setPlaying(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [isPlaying, selected, points.length]);
  const choose = (value: number) => { setPlaying(false); setIndex(value); };
  const invalid = !!from && !!to && Date.parse(from) > Date.parse(to);
  const changes = at ? events.filter(event => Date.parse(event.occurredAt) === Date.parse(at)) : [];
  const header = <header className="timeline-panel">
    <div className="timeline-heading"><div><h1>Архив</h1><p>Временная шкала состояния инфраструктуры</p></div><Link to="/graph">К текущей схеме →</Link></div>
    <div className="timeline-period" role="group" aria-label="Период архива">
      <label>Начало периода<input type="datetime-local" step="0.001" aria-label="Начало периода" value={from} onChange={event => { setFrom(event.target.value); choose(0); }} /></label>
      <label>Конец периода<input type="datetime-local" step="0.001" aria-label="Конец периода" value={to} onChange={event => { setTo(event.target.value); choose(0); }} /></label>
      <button onClick={() => { setFrom(allPoints.length ? localInput(allPoints[0]) : ''); setTo(allPoints.length ? localInput(allPoints.at(-1)!) : ''); choose(0); }}>Весь период</button>
    </div>
    {invalid ? <p role="alert">Начало периода должно быть раньше конца.</p> : !points.length ? <p role="status">В выбранном периоде нет изменений состояния.</p> : <>
      <div className="timeline-player">
        <button aria-label="Предыдущее изменение" disabled={!selected} onClick={() => choose(selected - 1)}>←</button>
        <button aria-label={isPlaying ? 'Приостановить воспроизведение' : 'Воспроизвести'} disabled={points.length < 2} onClick={() => {
          if (isPlaying) setPlaying(false); else { if (selected === points.length - 1) setIndex(0); setPlaying(true); }
        }}>{isPlaying ? 'Ⅱ Пауза' : '▶ Воспроизвести'}</button>
        <button aria-label="Следующее изменение" disabled={selected === points.length - 1} onClick={() => choose(selected + 1)}>→</button>
        <output aria-live="polite">{selected + 1} / {points.length} · <time dateTime={at}>{displayTime(at)}</time></output>
      </div>
      <input className="timeline-slider" type="range" list="timeline-points" aria-label="Временная шкала" aria-valuetext={displayTime(at)} min="0" max={Math.max(1, points.length - 1)} step="1" value={selected} disabled={points.length === 1} onChange={event => choose(Number(event.target.value))} />
      <datalist id="timeline-points">{points.map((point, index) => <option key={point} value={index} label={displayTime(point)} />)}</datalist>
      <div className="timeline-endpoints"><span>{displayTime(points[0])}</span><span>{displayTime(points.at(-1)!)}</span></div>
      <p className="timeline-caption">Шаг — зарегистрированное изменение · Воспроизведение: 1 шаг в секунду · Событий в точке: {changes.length}</p>
      <details><summary>События выбранной точки</summary><ul>{changes.map(event => <li key={event.id}>#{event.id} · {event.objectName} · {event.statusName}</li>)}</ul></details>
    </>}
    <p className="timeline-caption">История состояний показана на текущей схеме с вашими районами и пометками. Время указано в часовом поясе браузера.</p>
    {loaded.data.sourceStatus !== 'online' && <p role="status">Внешний источник недоступен. Используется сохранённая локальная история.</p>}
  </header>;
  // Не показываем текущие состояния под пустой исторической шкалой.
  if (!at || invalid) return <section className="graph-page">{header}{storageWarning && <p role="alert">{storageWarning}</p>}</section>;
  return <GraphView store={loaded.store} data={data} historical storageWarning={storageWarning} refreshError="" receivedAt={null}>{header}</GraphView>;
}
