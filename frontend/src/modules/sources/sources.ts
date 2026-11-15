export interface SourceInfo {
  id: string;
  name: string;
  interval_seconds: number;
  schedule_mode: 'interval' | 'calendar';
  schedule_time: string;
  weekdays: number[];
  enabled: boolean;
  next_poll_at: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  status: string;
  error: string | null;
}
export interface SourceDetail extends SourceInfo { payload: unknown; }
export interface SourceSettings extends SourceInfo { url: string; auth_type: string; has_token: boolean; }
export const sourceStatuses: Record<string, string> = {
  never: 'Ещё не опрашивался', success: 'Успешно', error: 'Ошибка последней попытки',
};
export function sourceTime(value: string | null) {
  return value ? new Date(value + (value.endsWith('Z') ? '' : 'Z')).toLocaleString('ru-RU') : '—';
}

export const weekdayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export function scheduleLabel(source: SourceInfo) {
  if (!source.enabled) return 'Автоопрос выключен';
  return source.schedule_mode === 'calendar'
    ? `${source.weekdays.map((day) => weekdayNames[day]).join(', ')} в ${source.schedule_time} (МСК)`
    : `Автоопрос каждые ${source.interval_seconds} сек.`;
}
