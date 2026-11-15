import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import type { Role, UserPublic } from '../../auth/types';
import './users.css';

export function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([authRequest<UserPublic[]>('/users'), authRequest<Role[]>('/roles')])
      .then(([result, availableRoles]) => { if (active) { setUsers(result); setRoles(availableRoles); } })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить пользователей');
      });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(id);
    setError('');
    try {
      const updated = await authRequest<UserPublic>(`/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: data.get('role'), is_active: data.has('is_active') }),
      });
      setUsers((current) => current!.map((item) => item.id === id ? updated : item));
    } catch (err) {
      form.reset();
      setError(err instanceof Error ? err.message : 'Не удалось сохранить пользователя');
    } finally {
      setSaving(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setError('');
    try {
      const created = await authRequest<UserPublic>('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'), password: data.get('password'),
          full_name: data.get('full_name') || null,
          role: data.get('role'), is_active: data.has('is_active'),
        }),
      });
      setUsers((current) => [...current!, created]);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать пользователя');
    } finally {
      setCreating(false);
    }
  }

  const assignableRoles = roles.filter((role) => role.id !== 'superadmin' || user?.role === 'superadmin');

  return (
    <section>
      <h1>Пользователи</h1>
      {error && <p role="alert">{error}</p>}
      {users && <form className="user-create" onSubmit={create}>
        <h2>Новый пользователь</h2>
        <fieldset disabled={!users || creating || saving !== null}>
          <label>Email<input name="email" type="email" required autoComplete="off" /></label>
          <label>Имя<input name="full_name" /></label>
          <label>Пароль<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>
          <label>Роль
            <select name="role" defaultValue="user">
              {assignableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label><input name="is_active" type="checkbox" defaultChecked /> Активен</label>
          <button type="submit">{creating ? 'Создание…' : 'Создать'}</button>
        </fieldset>
      </form>}
      {!users && !error && <p>Загрузка…</p>}
      {users?.map((item) => (
        <form className="user-row" key={`${item.id}:${item.role}:${item.is_active}`} onSubmit={(event) => save(event, item.id)}>
          <div className="user-name">
            <strong>{item.full_name || item.email}</strong>
            <small>{item.email}{item.id === user?.id ? ' (вы)' : ''}</small>
          </div>
          <fieldset disabled={creating || saving !== null || (item.id === user?.id || (item.role === "superadmin" && user?.role !== "superadmin"))}>
            <label>
              Роль{' '}
              <select name="role" defaultValue={item.role}>
                {item.role === "superadmin" && user?.role !== "superadmin" && <option value="superadmin">{item.role_name}</option>}
                {assignableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <label><input type="checkbox" name="is_active" defaultChecked={item.is_active} /> Активен</label>
            <button type="submit">{saving === item.id ? 'Сохранение…' : 'Сохранить'}</button>
          </fieldset>
        </form>
      ))}
    </section>
  );
}
