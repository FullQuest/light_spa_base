export const requestStatuses = { new: 'Новая', in_progress: 'В работе', done: 'Готово' };
export type RequestStatus = keyof typeof requestStatuses;
export interface RequestItem {
  id: number;
  title: string;
  description: string;
  status: RequestStatus;
  author_id: number;
  author_name: string;
  assignee_id: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
}
export interface Assignee { id: number; name: string; is_active: boolean; }
export function requestDate(value: string) {
  return new Date(value + (value.endsWith('Z') ? '' : 'Z')).toLocaleString('ru-RU');
}
