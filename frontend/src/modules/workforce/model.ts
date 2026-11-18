import { experienceYears, resourceLabel } from './types.ts';
import type { Employee } from './types.ts';

export interface WorkerColumn {
  key: string;
  title: string;
  kind: 'text' | 'number' | 'date';
  resource?: string;
  value: (employee: Employee) => string | number | null;
}
export type ColumnFilter = { text?: string; min?: string; max?: string; missing?: boolean };
export type WorkerFilters = Record<string, ColumnFilter>;
export interface Sort { key: string; direction: 'asc' | 'desc' }

export function workerColumns(employees: Employee[]): WorkerColumn[] {
  const resources = [...new Set(['water', 'energy', ...employees.flatMap(employee => employee.qualifications.map(q => q.resource_type))])];
  return [
    { key: 'tabel', title: 'Табельный № / ID', kind: 'number', value: e => e.tabel },
    { key: 'last_name', title: 'Фамилия', kind: 'text', value: e => e.last_name },
    { key: 'first_name', title: 'Имя', kind: 'text', value: e => e.first_name },
    { key: 'middle_name', title: 'Отчество', kind: 'text', value: e => e.middle_name },
    { key: 'start_date_experience', title: 'Начало стажа', kind: 'date', value: e => e.start_date_experience || null },
    { key: 'experience', title: 'Стаж, полных лет', kind: 'number', value: e => experienceYears(e.start_date_experience) },
    ...resources.flatMap(resource => [
      { key: `${resource}_id`, title: `${resourceLabel(resource)} · ID квалификации`, kind: 'number' as const, resource, value: (e: Employee) => e.qualifications.find(q => q.resource_type === resource)?.id_qualification ?? null },
      { key: `${resource}_proff`, title: `${resourceLabel(resource)} · уровень`, kind: 'number' as const, resource, value: (e: Employee) => e.qualifications.find(q => q.resource_type === resource)?.proff ?? null },
    ]),
  ];
}

const normalized = (value: string) => value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
export function filterWorkers(employees: Employee[], columns: WorkerColumn[], filters: WorkerFilters, search: string, sort: Sort): Employee[] {
  const query = normalized(search);
  return employees.filter(employee => {
    if (query && !normalized(columns.map(column => column.value(employee) ?? '').join(' ') + ' ' + employee.qualifications.map(q => resourceLabel(q.resource_type)).join(' ')).includes(query)) return false;
    return columns.every(column => {
      const filter = filters[column.key];
      if (!filter) return true;
      const value = column.value(employee);
      if (filter.missing) return value === null || value === '';
      if (filter.text && !normalized(String(value ?? '')).includes(normalized(filter.text))) return false;
      if (filter.min && (value === null || (column.kind === 'number' ? Number(value) < Number(filter.min.replace(',', '.')) : String(value) < filter.min))) return false;
      if (filter.max && (value === null || (column.kind === 'number' ? Number(value) > Number(filter.max.replace(',', '.')) : String(value) > filter.max))) return false;
      return true;
    });
  }).sort((a, b) => {
    const column = columns.find(c => c.key === sort.key) ?? columns[0];
    const left = column.value(a), right = column.value(b);
    // Missing qualifications always stay at the bottom, in both directions.
    if (left === null || right === null) return left === right ? a.tabel - b.tabel : left === null ? 1 : -1;
    const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'ru', { numeric: true });
    return (sort.direction === 'asc' ? result : -result) || a.tabel - b.tabel;
  });
}
