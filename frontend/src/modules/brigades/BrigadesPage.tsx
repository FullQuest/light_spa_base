import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/auth';
import { formationApi, isMockApi } from './api';
import { formationResetEvent } from './mockApi';
import { resourceLabel } from '../workforce/types';
import { dateTime, duration, exportM2, scheduleIssues, scheduleSpanSeconds } from './schedule';
import type { FormationJob, FormationResult } from './types';
import { BrigadeTree } from './BrigadeTree';
import { ScheduleTable } from './ScheduleTable';
import { SwimlaneTimeline } from './SwimlaneTimeline';
import '../workforce/workforce.css';
import './brigades.css';

export function BrigadesPage() {
  const { user } = useAuth();
  const scope = String(user?.id ?? '');
  const [result, setResult] = useState<FormationResult | null>(null);
  const [job, setJob] = useState<FormationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState('brigades');
  const [brigadeFilter, setBrigadeFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const startRequest = useRef<AbortController | null>(null);
  const loadRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    Promise.all([formationApi.result(scope, controller.signal), formationApi.currentJob(scope, controller.signal)]).then(([saved, current]) => {
      if (!controller.signal.aborted) { setResult(current?.status === 'completed' ? current.result ?? saved : saved); setJob(current?.status === 'running' ? current : null); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить результат.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope, attempt]);

  useEffect(() => {
    function reset() {
      startRequest.current?.abort();
      loadRequest.current?.abort();
      setResult(null); setJob(null); setStarting(false); setError('');
      setLoading(false);
      setBrigadeFilter(''); setResourceFilter(''); setSearch('');
      setNotice('Данные очищены. Предыдущий результат и JSON удалены.');
    }
    const storage = (event: StorageEvent) => { if (event.key === 'repair-mock:revision' || event.key === null) reset(); };
    window.addEventListener(formationResetEvent, reset);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(formationResetEvent, reset); window.removeEventListener('storage', storage); startRequest.current?.abort(); };
  }, []);

  const runningId = job?.status === 'running' ? job.id : null;
  useEffect(() => {
    if (!runningId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = setTimeout(() => {
      controller.abort(); setJob(null); setError('Расчёт не завершился за 180 секунд. Попробуйте снова.');
    }, 180000);
    async function poll() {
      try {
        const current = await formationApi.job(scope, runningId!, controller.signal);
        if (controller.signal.aborted) return;
        setJob(current);
        if (current.status === 'completed') {
          if (!current.result) throw new Error('Сервер завершил расчёт без результата.');
          setResult(current.result); setBrigadeFilter(''); setResourceFilter(''); setSearch(''); setNotice('Бригады сформированы. Результат готов к выгрузке.');
        } else if (current.status === 'failed') setError(current.error || 'Не удалось сформировать бригады.');
        else timer = setTimeout(poll, 500);
      } catch (reason) {
        if (!controller.signal.aborted) { setJob(null); setError(reason instanceof Error ? reason.message : 'Не удалось получить результат.'); }
      }
    }
    timer = setTimeout(poll, 0);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(deadline); };
  }, [runningId, scope]);

  async function start() {
    if (startRequest.current && !startRequest.current.signal.aborted || runningId) return;
    const controller = new AbortController(); startRequest.current = controller;
    setStarting(true); setError(''); setNotice('');
    try {
      const current = await formationApi.start(scope, controller.signal);
      if (!controller.signal.aborted) {
        setJob(current);
        if (current.status === 'completed' && current.result) setResult(current.result);
        if (current.status === 'failed') setError(current.error || 'Не удалось начать формирование.');
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось начать формирование.'); }
    finally { if (!controller.signal.aborted) setStarting(false); if (startRequest.current === controller) startRequest.current = null; }
  }

  const issues = useMemo(() => result ? scheduleIssues(result) : [], [result]);
  const visible = useMemo(() => (result?.incidents ?? []).filter(item => (!brigadeFilter || String(item.brigadeId) === brigadeFilter) && (!resourceFilter || item.resourceType === resourceFilter) && (!search.trim() || `${item.eventId} ${item.objectId} ${item.objectName}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))), [result, brigadeFilter, resourceFilter, search]);
  const filteredResult = useMemo(() => result ? { ...result, brigades: result.brigades.filter(b => !brigadeFilter || String(b.brigadeId) === brigadeFilter) } : null, [result, brigadeFilter]);
  const totalDuration = useMemo(() => result ? scheduleSpanSeconds(result.incidents) : null, [result]);
  const working = starting || !!runningId;
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportM2(result), null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'brigades.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="operations-page brigades-page"><header className="operations-heading"><div><p className="operations-eyebrow">ПЛАНИРОВАНИЕ РЕМОНТА</p><h1>Формирование бригад</h1><p>Распределение специалистов и последовательность ликвидации аварий</p></div><div className="operations-actions"><button className="btn-primary" onClick={start} disabled={working || loading}>{working ? 'Формирование…' : result ? 'Сформировать заново' : 'Сформировать бригады'}</button><button onClick={download} disabled={!result || working || !!issues.length}>↓ Скачать JSON</button></div></header>
    {isMockApi && <p className="operations-demo">Демонстрационный расчёт · результат иллюстрирует интерфейс и не является оптимальным решением</p>}
    <div className="formation-control"><div><strong>{working ? job?.stage ?? 'Запуск расчёта' : result ? 'Последний успешный результат' : 'Готово к формированию'}</strong><p>{working ? 'Ожидаем результат. Расчёт может занять до 180 секунд.' : result ? `Сформирован ${dateTime(result.generatedAt)} · время МСК` : 'Запустите расчёт, чтобы получить составы бригад, расписание и файл M2.'}</p></div>
      {working && <div className="formation-progress"><progress aria-label="Прогресс формирования бригад" max={100} value={job?.progress ?? undefined} /><span>{job?.progress == null ? 'Выполняется…' : `${job.progress}%`}</span></div>}
    </div>
    {loading && <p role="status">Загрузка последнего результата…</p>}
    {notice && <p className="formation-notice" role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p>{result && <p>Последний успешный результат сохранён.</p>}<button onClick={() => { setError(''); setLoading(true); setAttempt(a => a + 1); }}>Повторить загрузку</button></div>}
    {result && <>
      <dl className="plan-metrics"><div><dt>Сформировано бригад</dt><dd>{result.brigades.length}</dd></div><div><dt>Рабочих в составе</dt><dd>{new Set(result.brigades.flatMap(b => b.employeeIds)).size}</dd></div><div><dt>Назначено инцидентов</dt><dd>{result.incidents.length}</dd></div><div><dt>До завершения всех работ</dt><dd>{totalDuration === null ? '—' : duration(totalDuration)}</dd></div></dl>
      {!!issues.length && <details className="schedule-issues" open><summary>Проверьте результат: {issues.length} замечаний</summary><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>JSON недоступен до получения корректного результата.</p></details>}
      {!result.brigades.length && !result.incidents.length ? <div className="operations-empty"><strong>Нет активных инцидентов</strong><p>Расписание пусто. Новое формирование будет доступно после обновления данных.</p></div> : <>
        <div className="plan-filters"><label>Бригада<select aria-label="Бригада" value={brigadeFilter} onChange={e => setBrigadeFilter(e.target.value)}><option value="">Все бригады</option>{result.brigades.map((b, index) => <option key={`${b.brigadeId}-${index}`} value={b.brigadeId}>Бригада №{b.brigadeId}</option>)}</select></label><label>Ресурс<select aria-label="Ресурс" value={resourceFilter} onChange={e => setResourceFilter(e.target.value)}><option value="">Все ресурсы</option>{[...new Set(result.incidents.map(i => i.resourceType))].map(r => <option key={r} value={r}>{resourceLabel(r)}</option>)}</select></label><label className="plan-search">Поиск инцидента<input type="search" placeholder="Объект, ID объекта или события…" value={search} onChange={e => setSearch(e.target.value)} /></label><button onClick={() => { setBrigadeFilter(''); setResourceFilter(''); setSearch(''); }}>Сбросить фильтры</button><span>{visible.length} / {result.incidents.length}</span></div>
        <div className="plan-tabs" role="tablist" aria-label="Представление результата">{[['brigades', 'Бригады и составы'], ['table', 'Сводное расписание'], ['timeline', 'Временная диаграмма']].map(([key, title]) => <button role="tab" type="button" id={`tab-${key}`} aria-controls={`panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => setTab(key)} onKeyDown={event => {
          const keys = ['brigades', 'table', 'timeline'];
          const next = event.key === 'ArrowRight' ? keys[(keys.indexOf(key) + 1) % keys.length] : event.key === 'ArrowLeft' ? keys[(keys.indexOf(key) + 2) % keys.length] : event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[2] : null;
          if (next) { event.preventDefault(); setTab(next); document.getElementById(`tab-${next}`)?.focus(); }
        }}>{title}</button>)}</div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={`${result.id}-${tab}`}>
          {filteredResult && tab === 'brigades' && <BrigadeTree result={filteredResult} incidents={visible} />}
          {tab === 'table' && <ScheduleTable incidents={visible} />}
          {filteredResult && tab === 'timeline' && <SwimlaneTimeline result={filteredResult} incidents={visible} />}
        </div>
      </>}
    </>}
  </section>;
}
