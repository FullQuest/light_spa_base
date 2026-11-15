import { useState } from 'react';
import type { FormEvent } from 'react';
import { authRequest } from '../../auth/api';
import { weekdayNames } from './sources';
import type { SourceSettings } from './sources';

export function SourceForm({ source, onSaved }: { source?: SourceSettings; onSaved: (source: SourceSettings) => void }) {
  const [authType, setAuthType] = useState(source?.auth_type ?? 'none');
  const [scheduleMode, setScheduleMode] = useState(source?.schedule_mode ?? 'interval');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const result = await authRequest<SourceSettings>(source ? `/sources/${source.id}` : '/sources', {
        method: source ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.get('name'), url: data.get('url'), auth_type: authType,
          token: data.get('token') ?? '', interval_seconds: Number(data.get('interval_seconds') ?? source?.interval_seconds ?? 300), enabled: data.has('enabled'),
          schedule_mode: scheduleMode, schedule_time: data.get('schedule_time') ?? '09:00', weekdays: data.getAll('weekdays').map(Number) }),
      });
      onSaved(result);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить источник'); }
    finally { setBusy(false); }
  }
  return <form className="source-form" onSubmit={save}>
    <h2>{source ? 'Настройки подключения' : 'Новый источник'}</h2>
    <fieldset disabled={busy}>
      <label>Название<input name="name" required maxLength={120} defaultValue={source?.name ?? ''} /></label>
      <label>URL API<input name="url" type="url" required defaultValue={source?.url ?? ''} placeholder="https://example.org/api/data" /></label>
      <label>Режим опроса<select aria-label="Режим опроса" value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as 'interval' | 'calendar')}>
        <option value="interval">Через интервал</option><option value="calendar">По расписанию</option>
      </select></label>
      {scheduleMode === 'interval' ? <label>Интервал, секунд<input name="interval_seconds" type="number" min={1} max={86400} required defaultValue={source?.interval_seconds ?? 300} /></label> : <>
        <label>Время опроса (МСК, UTC+3)<input name="schedule_time" type="time" required defaultValue={source?.schedule_time ?? '09:00'} /></label>
        <fieldset className="source-weekdays"><legend>Дни недели</legend>{weekdayNames.map((name, day) => <label key={day}>
          <input name="weekdays" type="checkbox" value={day} defaultChecked={source?.weekdays.includes(day) ?? true} />{name}
        </label>)}</fieldset>
      </>}
      <label>Авторизация<select aria-label="Авторизация" value={authType} onChange={(event) => setAuthType(event.target.value)}>
        <option value="none">Без авторизации</option><option value="bearer">Bearer-токен</option>
      </select></label>
      {authType === 'bearer' && <label>Bearer-токен<input name="token" type="password" autoComplete="new-password" maxLength={4096}
        required={!source?.has_token} placeholder={source?.has_token ? 'Оставьте пустым, чтобы сохранить токен' : 'Токен доступа'} /></label>}
      <label className="source-check"><input name="enabled" type="checkbox" defaultChecked={source?.enabled ?? true} />Автоопрос включён</label>
      <button type="submit" className="btn-primary">{busy ? 'Сохранение…' : source ? 'Сохранить настройки' : 'Добавить источник'}</button>
    </fieldset>
    <small>GET API с ответом JSON. Отключение автоопроса сохраняет ручной запуск. Данные доступны пользователям с правом просмотра источников.</small>
    {error && <p role="alert">{error}</p>}
  </form>;
}
