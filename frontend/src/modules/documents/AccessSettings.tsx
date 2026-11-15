import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authRequest } from '../../auth/api';
import type { AccessMode, DocumentAccess, DocumentDetail } from './documents';

interface Options {
  roles: { id: string; name: string }[];
  users: { id: number; name: string; is_active: boolean }[];
}

export function AccessFields({ value, onChange }: { value: DocumentAccess; onChange: (value: DocumentAccess) => void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    authRequest<Options>('/documents/access-options')
      .then((items) => { if (active) setOptions(items); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить варианты доступа'); });
    return () => { active = false; };
  }, []);

  const roles = [...(options?.roles ?? [])];
  value.allowed_role_ids.forEach((id) => { if (!roles.some((role) => role.id === id)) roles.push({ id, name: `Удалённая роль (${id})` }); });

  return <div className="document-access-fields">
    <label>Доступ к документу
      <select aria-label="Доступ к документу" value={value.access_mode} onChange={(event) => onChange({
        access_mode: event.target.value as AccessMode, allowed_role_ids: [], allowed_user_ids: [],
      })}>
        <option value="all">Всем</option><option value="roles">По ролям</option>
        <option value="private">Только владельцу</option><option value="users">Конкретным людям</option>
      </select>
    </label>
    <small>Владелец и суперадминистратор сохраняют доступ. Получатели должны иметь разрешение на просмотр документов.</small>
    {error && <p role="alert">{error}</p>}
    {(value.access_mode === 'roles' || value.access_mode === 'users') && !options && !error && <p>Загрузка вариантов доступа…</p>}
    {value.access_mode === 'roles' && options && <fieldset><legend>Роли с доступом</legend>
      {roles.map((role) => <label key={role.id}><input type="checkbox" checked={value.allowed_role_ids.includes(role.id)}
        onChange={(event) => onChange({ ...value, allowed_role_ids: event.target.checked
          ? [...value.allowed_role_ids, role.id] : value.allowed_role_ids.filter((id) => id !== role.id) })} />{role.name}</label>)}
    </fieldset>}
    {value.access_mode === 'users' && options && <fieldset><legend>Люди с доступом</legend>
      {options.users.map((person) => <label key={person.id}><input type="checkbox" checked={value.allowed_user_ids.includes(person.id)}
        onChange={(event) => onChange({ ...value, allowed_user_ids: event.target.checked
          ? [...value.allowed_user_ids, person.id] : value.allowed_user_ids.filter((id) => id !== person.id) })} />
        {person.name}{person.is_active ? '' : ' (заблокирован)'}</label>)}
    </fieldset>}
  </div>;
}

export function AccessSettings({ document, onSaved }: { document: DocumentDetail; onSaved: (document: DocumentDetail) => void }) {
  const [access, setAccess] = useState<DocumentAccess>({ access_mode: document.access_mode,
    allowed_role_ids: document.allowed_role_ids, allowed_user_ids: document.allowed_user_ids });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const result = await authRequest<DocumentDetail>(`/documents/${document.id}/access`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(access),
      });
      setAccess({ access_mode: result.access_mode, allowed_role_ids: result.allowed_role_ids, allowed_user_ids: result.allowed_user_ids });
      onSaved(result); setSaved(true);
    } catch (err) {
      setAccess({ access_mode: document.access_mode, allowed_role_ids: document.allowed_role_ids, allowed_user_ids: document.allowed_user_ids });
      setError(err instanceof Error ? err.message : 'Не удалось сохранить доступ');
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="document-access">
    <h2>Настройки доступа</h2>
    <fieldset disabled={busy}><AccessFields value={access} onChange={(value) => { setAccess(value); setSaved(false); }} />
      <button type="submit">{busy ? 'Сохранение…' : 'Сохранить доступ'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}{saved && <p role="status">Доступ сохранён</p>}
  </form>;
}
