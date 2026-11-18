// Fields mirror employee and qualification in the module 2 PostgreSQL dump.
export interface Qualification {
  id_qualification: number;
  id_employee: number;
  resource_type: string;
  proff: number;
}

export interface Employee {
  tabel: number;
  first_name: string;
  last_name: string;
  middle_name: string;
  start_date_experience: string;
  qualifications: Qualification[];
}

export const resourceLabels: Record<string, string> = { water: 'Вода', energy: 'Электроэнергия' };
export const resourceLabel = (resource: string) => resourceLabels[resource] ?? resource;
export const fullName = (employee: Employee) => [employee.last_name, employee.first_name, employee.middle_name].filter(Boolean).join(' ');

export function experienceYears(date: string, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = today.split('-').map(Number);
  return nowYear - year - (nowMonth < month || nowMonth === month && nowDay < day ? 1 : 0);
}

export function calendarDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date(value));
}
