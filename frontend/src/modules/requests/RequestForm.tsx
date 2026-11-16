import { useState } from 'react';
import type { FormEvent } from 'react';
import { authRequest } from '../../auth/api';
import { requestStatuses } from './requests';
import type { RequestItem, Assignee } from './requests';

export function RequestForm({ item, people, onSaved }: { item?: RequestItem; people: Assignee[]; onSaved: (item: RequestItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const result = await authRequest<RequestItem>(item ? `/requests/${item.id}` : '/requests', {
        method: item ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: data.get('title'), description: data.get('description'), status: data.get('status'),
          assignee_id: data.get('assignee_id') ? Number(data.get('assignee_id')) : null }),
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить заявку');
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="request-form">
    <h2>{item ? 'Редактирование' : 'Новая заявка'}</h2>
    <fieldset disabled={busy}>
      <label className="request-wide">Название<input name="title" required maxLength={200} defaultValue={item?.title ?? ''} /></label>
      <label className="request-wide">Описание<textarea name="description" rows={4} maxLength={10000} defaultValue={item?.description ?? ''} /></label>
      <label>Статус<select aria-label="Статус заявки" name="status" defaultValue={item?.status ?? 'new'}>
        {Object.entries(requestStatuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select></label>
      <label>Исполнитель<select aria-label="Исполнитель заявки" name="assignee_id" defaultValue={item?.assignee_id ?? ''}>
        <option value="">Не назначен</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.is_active ? '' : ' (заблокирован)'}</option>)}
      </select></label>
      <button type="submit" className="btn-primary">{busy ? 'Сохранение…' : item ? 'Сохранить заявку' : 'Создать заявку'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
}
