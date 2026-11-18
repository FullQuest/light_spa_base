import { useEffect, useMemo, useState } from 'react';
import { formationApi, isMockApi } from '../brigades/api';
import { formationResetEvent } from '../brigades/events';
import { calendarDate } from './types';
import type { Employee } from './types';
import { filterWorkers, workerColumns } from './model';
import type { ColumnFilter, Sort, WorkerFilters } from './model';
import { exportWorkers } from './export';
import './workforce.css';

export function WorkersPage() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<WorkerFilters>({});
  const [sort, setSort] = useState<Sort>({ key: 'tabel', direction: 'asc' });
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    formationApi.employees(controller.signal).then(setEmployees).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить рабочих.');
    });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const refresh = () => { setEmployees(null); setError(''); setAttempt(value => value + 1); };
    window.addEventListener(formationResetEvent, refresh);
    return () => window.removeEventListener(formationResetEvent, refresh);
  }, []);
  const columns = useMemo(() => workerColumns(employees ?? []), [employees]);
  const visible = useMemo(() => filterWorkers(employees ?? [], columns, filters, search, sort), [employees, columns, filters, search, sort]);
  const change = (key: string, patch: ColumnFilter) => setFilters(current => ({ ...current, [key]: { ...current[key], ...patch } }));
  async function download() {
    setExporting(true); setError('');
    try { await exportWorkers(visible, columns); }
    catch { setError('Не удалось создать XLSX-файл. Попробуйте ещё раз.'); }
    finally { setExporting(false); }
  }
  return <section className="operations-page workers-page">
    <header className="operations-heading"><div><p className="operations-eyebrow">ПЕРСОНАЛ</p><h1>Рабочие</h1><p>Квалификации и профессионализм ремонтных специалистов</p></div>
      <button className="btn-primary" disabled={!visible.length || exporting} onClick={download}>{exporting ? 'Подготовка файла…' : '↓ Экспорт в XLSX'}</button></header>
    {isMockApi && <p className="operations-demo">Демонстрационные данные · подключение к БД готовится</p>}
    <div className="workers-toolbar"><label>Поиск по всем полям<input type="search" placeholder="ФИО, табельный номер, квалификация…" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button onClick={() => { setFilters({}); setSearch(''); setSort({ key: 'tabel', direction: 'asc' }); }}>Сбросить фильтры и сортировку</button>
      <span aria-live="polite">Показано <strong>{visible.length}</strong> из {employees?.length ?? '…'}</span></div>
    <p className="operations-note">Табельный номер — ID рабочего. Уровень квалификации: 0,1–10,0. «—» — квалификация отсутствует. Выгрузка учитывает фильтры и сортировку.</p>
    {error && <div role="alert">{error} {!employees && <button onClick={() => { setError(''); setAttempt(a => a + 1); }}>Повторить загрузку</button>}</div>}
    {!employees && !error && <p role="status">Загрузка рабочих…</p>}
    {employees && <div className="operations-table-scroll workers-table-scroll" tabIndex={0} role="region" aria-label="Таблица рабочих с горизонтальной прокруткой"><table className="operations-table workers-table">
      <caption className="visually-hidden">Рабочие и все их квалификации. Без пагинации.</caption>
      <thead><tr>{columns.map(column => <th scope="col" key={column.key} className={column.resource ? `resource-column ${column.resource === 'water' ? 'water' : column.resource === 'energy' ? 'energy' : ''}` : ''} aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
        <button className="sort-button" aria-label={`Сортировать: ${column.title}`} onClick={() => setSort(current => ({ key: column.key, direction: current.key === column.key && current.direction === 'asc' ? 'desc' : 'asc' }))}>{column.title}<span aria-hidden="true">{sort.key === column.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button>
      </th>)}</tr>
        <tr className="column-filters">{columns.map(column => <th key={column.key}>
          {column.kind === 'text' ? <input aria-label={`Фильтр: ${column.title}`} placeholder="Содержит…" value={filters[column.key]?.text ?? ''} onChange={e => change(column.key, { text: e.target.value })} /> : <div className="range-filter">
            <input aria-label={`${column.title}: от`} type={column.kind === 'date' ? 'date' : 'number'} step="any" placeholder="От" value={filters[column.key]?.min ?? ''} onChange={e => change(column.key, { min: e.target.value })} />
            <input aria-label={`${column.title}: до`} type={column.kind === 'date' ? 'date' : 'number'} step="any" placeholder="До" value={filters[column.key]?.max ?? ''} onChange={e => change(column.key, { max: e.target.value })} />
          </div>}
          {column.resource && <label className="missing-filter"><input type="checkbox" checked={filters[column.key]?.missing ?? false} onChange={e => change(column.key, { missing: e.target.checked })} />Нет квалификации<span className="visually-hidden">: {column.title}</span></label>}
        </th>)}</tr></thead>
      <tbody>{visible.map(employee => <tr key={employee.tabel} data-employee-id={employee.tabel}>{columns.map(column => {
        const value = column.value(employee);
        return <td key={column.key} className={column.resource ? `resource-column ${column.resource === 'water' ? 'water' : column.resource === 'energy' ? 'energy' : ''}` : ''}>{value === null || value === '' ? <span className="missing-value">—</span> : column.kind === 'date' ? calendarDate(String(value)) : column.key.endsWith('_proff') ? <strong className="qualification-level">{Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 1 })}</strong> : value}</td>;
      })}</tr>)}</tbody>
    </table>{!visible.length && <div className="operations-empty"><strong>{employees.length ? 'Рабочие не найдены' : 'Список рабочих пуст'}</strong><p>{employees.length ? 'Измените условия поиска или сбросьте фильтры.' : 'Загрузите данные рабочих из источника.'}</p></div>}</div>}
  </section>;
}
