import { authRequest } from '../../auth/api';

export interface DocumentSummary {
  id: string;
  original_name: string;
  format: string;
  size_bytes: number;
  uploaded_by: number;
  uploaded_by_name: string;
  access_mode: AccessMode;
  uploaded_at: string;
  status: string;
  warnings: string[];
  error: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  allowed_role_ids: string[];
  allowed_user_ids: number[];
  text: string;
  tables: { name: string; rows: string[][] }[];
}

export const statusNames: Record<string, string> = {
  processing: 'Обработка', ready: 'Прочитан', failed: 'Ошибка чтения',
};

export async function downloadOriginal(document: DocumentSummary) {
  const blob = await authRequest<Blob>(`/documents/${document.id}/original?download=true`, {}, 'blob');
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.original_name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function uploadedAt(value: string) {
  return new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z').toLocaleString('ru-RU');
}

export type AccessMode = 'all' | 'roles' | 'private' | 'users';
export interface DocumentAccess {
  access_mode: AccessMode;
  allowed_role_ids: string[];
  allowed_user_ids: number[];
}
export const accessNames: Record<AccessMode, string> = {
  all: 'Всем', roles: 'По ролям', private: 'Личный', users: 'Выбранным людям',
};
export const defaultAccess: DocumentAccess = { access_mode: 'all', allowed_role_ids: [], allowed_user_ids: [] };

export function appendAccess(data: FormData, access: DocumentAccess) {
  data.set('access_mode', access.access_mode);
  if (access.access_mode === 'roles') access.allowed_role_ids.forEach((id) => data.append('allowed_role_ids', id));
  if (access.access_mode === 'users') access.allowed_user_ids.forEach((id) => data.append('allowed_user_ids', String(id)));
}
