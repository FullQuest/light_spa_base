import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authRequest } from '../../auth/api';
import type { Role } from '../../auth/types';
import '../users/users.css';

export function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([authRequest<Role[]>('/roles'), authRequest<Record<string, string>>('/roles/permissions')])
      .then(([items, available]) => { if (active) { setRoles(items); setPermissions(available); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Ошибка загрузки'); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, role?: Role) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    try {
      const result = await authRequest<Role>(role ? `/roles/${role.id}` : '/roles', {
        method: role ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.get('name'), permissions: data.getAll('permissions') }),
      });
      setRoles((items) => role ? items!.map((item) => item.id === role.id ? result : item) : [...items!, result]);
      if (!role) form.reset();
    } catch (err) {
      if (role) form.reset();
      setError(err instanceof Error ? err.message : 'Не удалось сохранить роль');
    } finally { setBusy(false); }
  }

  async function remove(role: Role) {
    setBusy(true);
    setError('');
    try {
      await authRequest(`/roles/${role.id}`, { method: 'DELETE' });
      setRoles((items) => items!.filter((item) => item.id !== role.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить роль');
    } finally { setBusy(false); }
  }

  function fields(role?: Role) {
    return <>
      <label>Название<input name="name" required maxLength={80} defaultValue={role?.name ?? ''} /></label>
      {Object.entries(permissions).map(([key, title]) => <label key={key}>
        <input type="checkbox" name="permissions" value={key} defaultChecked={role?.permissions.includes(key)} /> {title}
      </label>)}
      <button type="submit">{role ? 'Сохранить' : 'Создать'}</button>
    </>;
  }

  return <section>
    <h1>Роли</h1>
    <p>Разрешения действуют для всех пользователей роли. Перед удалением роли переназначьте её пользователей.</p>
    {error && <p role="alert">{error}</p>}
    {!roles && !error && <p>Загрузка…</p>}
    <form className="user-create" onSubmit={(event) => save(event)}>
      <h2>Новая роль</h2>
      <fieldset disabled={!roles || busy}>{fields()}</fieldset>
    </form>
    {roles?.map((role) => <form className="user-create" key={role.id} onSubmit={(event) => save(event, role)}>
      {role.id === 'superadmin' ? <>
        <h2>{role.name}</h2><p>Системная роль. Полный доступ ко всем возможностям.</p>
      </> : <fieldset disabled={busy}>
        {fields(role)}
        {role.id === 'user' ? <small>Системная роль для регистрации. Нельзя удалить.</small> :
          <button type="button" onClick={() => remove(role)}>Удалить</button>}
      </fieldset>}
    </form>)}
  </section>;
}
