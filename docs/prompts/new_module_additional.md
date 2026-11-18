# FORAI

_8 files bundled by ctx_

## File index

- `RequestForm.tsx` (TypeScript) — 2.5KB
- `RequestPage.tsx` (TypeScript) — 2.9KB
- `RequestsPage.tsx` (TypeScript) — 4.0KB
- `models.py` (Python) — 1.2KB
- `modules.ts` (TypeScript) — 3.0KB
- `requests.css` (CSS) — 1.7KB
- `requests.ts` (TypeScript) — 636B
- `router.py` (Python) — 3.7KB

---


## RequestForm.tsx

```typescript
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
```


## RequestPage.tsx

```typescript
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { RequestForm } from './RequestForm';
import { requestStatuses, requestDate } from './requests';
import type { RequestItem, Assignee } from './requests';
import './requests.css';

function RequestCard({ id }: { id: string }) {
  const { user } = useAuth();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [item, setItem] = useState<RequestItem | null>(null);
  const [people, setPeople] = useState<Assignee[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([authRequest<RequestItem>(`/requests/${id}`), authRequest<Assignee[]>('/requests/assignees')])
      .then(([value, assignees]) => { if (active) { setItem(value); setPeople(assignees); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Не удалось загрузить заявку'); });
    return () => { active = false; };
  }, [id]);
  async function remove() {
    if (!window.confirm('Удалить заявку?')) return;
    setBusy(true); setError('');
    try { await authRequest(`/requests/${id}`, { method: 'DELETE' }); navigate(`/requests${search}`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить заявку'); }
    finally { setBusy(false); }
  }
  return <section className="requests-page">
    <Link to={`/requests${search}`}>← К заявкам</Link>
    {error && <p role="alert">{error}</p>}
    {!item && !error && <p>Загрузка…</p>}
    {item && <>
      <h1>{item.title}</h1>
      <span className="request-status">{requestStatuses[item.status]}</span>
      <p className="request-description">{item.description || 'Описание не указано.'}</p>
      <dl className="request-details">
        <div><dt>Автор</dt><dd>{item.author_name}</dd></div><div><dt>Исполнитель</dt><dd>{item.assignee_name ?? 'Не назначен'}</dd></div>
        <div><dt>Создана</dt><dd>{requestDate(item.created_at)}</dd></div><div><dt>Изменена</dt><dd>{requestDate(item.updated_at)}</dd></div>
      </dl>
      {notice && <p role="status">{notice}</p>}
      {user?.permissions.includes('requests.manage') && <>
        <RequestForm key={item.updated_at} item={item} people={people} onSaved={(value) => { setItem(value); setNotice('Заявка сохранена'); }} />
        <button className="button-danger request-delete" onClick={remove} disabled={busy}>Удалить заявку</button>
      </>}
    </>}
  </section>;
}
export function RequestPage() {
  const { id = '' } = useParams();
  return <RequestCard key={id} id={id} />;
}
```


## RequestsPage.tsx

```typescript
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { RequestForm } from './RequestForm';
import { requestStatuses, requestDate } from './requests';
import type { RequestItem, Assignee } from './requests';
import './requests.css';

export function RequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [result, setResult] = useState<{ query: string; items: RequestItem[]; people: Assignee[]; error: string } | null>(null);
  const current = result?.query === query ? result : null;
  useEffect(() => {
    let active = true;
    Promise.all([authRequest<RequestItem[]>(`/requests?${query}`), authRequest<Assignee[]>('/requests/assignees')])
      .then(([items, people]) => { if (active) setResult({ query, items, people, error: '' }); })
      .catch((err: unknown) => { if (active) setResult({ query, items: [], people: [], error: err instanceof Error ? err.message : 'Не удалось загрузить заявки' }); });
    return () => { active = false; };
  }, [query]);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (value) next.set(key, String(value));
    setParams(next);
  }
  return <section className="requests-page">
    <h1>Заявки</h1>
    <p>Создавайте поручения, назначайте исполнителей и отслеживайте состояние.</p>
    {result && !result.error && user?.permissions.includes('requests.manage') && <RequestForm people={result.people} onSaved={(item) => navigate(`/requests/${item.id}`)} />}
    {!current && <p>Загрузка…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current && !current.error && <>
      <form key={query} className="request-filters" onSubmit={filter}>
        <label>Поиск заявок<input type="search" name="q" defaultValue={params.get('q') ?? ''} placeholder="Название или описание" /></label>
        <label>Статус<select name="status" aria-label="Фильтр статуса" defaultValue={params.get('status') ?? ''}>
          <option value="">Все статусы</option>{Object.entries(requestStatuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select></label>
        <label>Исполнитель<select name="assignee_id" aria-label="Фильтр исполнителя" defaultValue={params.get('assignee_id') ?? ''}>
          <option value="">Все исполнители</option>{current.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <label className="request-check"><input name="mine" type="checkbox" value="true" defaultChecked={params.get('mine') === 'true'} />Только мои</label>
        <button type="submit">Применить</button><button type="button" onClick={() => setParams({})}>Сбросить</button>
      </form>
      <p role="status">Найдено заявок: {current.items.length}</p>
      {current.items.length === 0 && <p className="request-empty">Заявки не найдены.</p>}
      <div className="request-list">{current.items.map((item) => <article key={item.id}>
        <h2><Link to={`/requests/${item.id}${query ? '?' + query : ''}`}>{item.title}</Link></h2>
        <span className="request-status">{requestStatuses[item.status]}</span>
        {item.description && <p>{item.description.slice(0, 180)}{item.description.length > 180 ? '…' : ''}</p>}
        <small>Автор: {item.author_name} · Исполнитель: {item.assignee_name ?? 'Не назначен'} · {requestDate(item.created_at)}</small>
      </article>)}</div>
    </>}
  </section>;
}
```


## models.py

```python
from datetime import datetime, timezone
from typing import Literal
from pydantic import field_validator
from sqlmodel import SQLModel, Field

RequestStatus = Literal["new", "in_progress", "done"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class RequestWrite(SQLModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    status: RequestStatus = "new"
    assignee_id: int | None = None

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название не должно быть пустым")
        return value


class Request(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    description: str = ""
    status: str = "new"
    author_id: int
    assignee_id: int | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class RequestPublic(RequestWrite):
    id: int
    author_id: int
    author_name: str
    assignee_name: str | None
    created_at: datetime
    updated_at: datetime
```


## modules.ts

```typescript
import type { ComponentType } from 'react';
import type { UserPublic } from '../auth/types';
import { HomePage } from '../modules/home/HomePage';
import { ProfilePage } from '../modules/profile/ProfilePage';
import { UsersPage } from '../modules/users/UsersPage';
import { RolesPage } from '../modules/roles/RolesPage';
import { DocumentsPage } from '../modules/documents/DocumentsPage';
import { DocumentPage } from '../modules/documents/DocumentPage';
import { SearchPage } from '../modules/search/SearchPage';
import { SourcesPage } from '../modules/sources/SourcesPage';
import { SourcePage } from '../modules/sources/SourcePage';
import { RequestsPage } from '../modules/requests/RequestsPage';
import { RequestPage } from '../modules/requests/RequestPage';

interface AppModule {
  path: string;
  title: string;
  Page: ComponentType;
  permission?: string;
  superadminOnly?: boolean;
  enabled?: boolean;
  menu?: boolean;
}

// Общие правила для меню, маршрутов и перехода после входа.
export function canOpenModule(module: AppModule, user: UserPublic) {
  return module.enabled !== false &&
    (!module.superadminOnly || user.role === 'superadmin') &&
    (!module.permission || user.permissions.includes(module.permission));
}

// Запись подключает меню и страницу; без ограничений раздел доступен всем вошедшим.
// enabled: false отключает страницу, menu: false только скрывает ссылку из меню.
export const features = { profile: true, users: true, roles: true, documents: true, search: true, sources: true, requests: true };

export const modules: AppModule[] = [
  { path: '/', title: 'Главная', Page: HomePage },
  { path: '/profile', title: 'Профиль', Page: ProfilePage, enabled: features.profile },
  { path: '/users', title: 'Пользователи', Page: UsersPage, permission: 'users.manage', enabled: features.users },
  { path: '/roles', title: 'Роли', Page: RolesPage, superadminOnly: true, enabled: features.roles },
  { path: '/documents', title: 'Документы', Page: DocumentsPage, permission: 'documents.view', enabled: features.documents },
  { path: '/documents/:id', title: 'Документ', Page: DocumentPage, permission: 'documents.view', enabled: features.documents, menu: false },
  { path: '/search', title: 'Поиск', Page: SearchPage, permission: 'documents.view', enabled: features.search && features.documents },
  { path: '/sources', title: 'Источники', Page: SourcesPage, permission: 'sources.view', enabled: features.sources },
  { path: '/sources/:id', title: 'Источник', Page: SourcePage, permission: 'sources.view', enabled: features.sources, menu: false },
  { path: '/requests', title: 'Заявки', Page: RequestsPage, permission: 'requests.view', enabled: features.requests },
  { path: '/requests/:id', title: 'Заявка', Page: RequestPage, permission: 'requests.view', enabled: features.requests, menu: false },
];
```


## requests.css

```css
.requests-page { display: grid; gap: 20px; min-width: 0; }
.requests-page > h1 { margin-bottom: 0; }
.request-form, .request-filters, .request-list article { padding: 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); min-width: 0; }
.request-form fieldset { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 0; margin: 0; border: 0; min-width: 0; }
.request-form label, .request-filters label { display: grid; gap: 6px; font-size: 14px; min-width: 0; }
.request-form input, .request-form select, .request-form textarea { width: 100%; }
.request-form textarea { resize: vertical; }
.request-wide { grid-column: 1 / -1; }
.request-form button, .request-delete { justify-self: start; }
.request-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.request-filters .request-check { display: flex; align-items: center; min-height: 40px; }
.request-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.request-list article { display: grid; gap: 12px; align-content: start; }
.request-list h2 { margin: 0; }
.request-list p, .request-description { white-space: pre-wrap; overflow-wrap: anywhere; }
.request-status { justify-self: start; font-size: 14px; border-radius: 6px; padding: 4px 10px; color: var(--accent); background: var(--accent-bg); }
.request-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 0; }
.request-details dd { margin: 6px 0 0; color: var(--text-h); }
.request-empty { padding: 24px; border: 1px dashed var(--border); border-radius: 8px; }
@media (max-width: 600px) { .request-list, .request-form fieldset, .request-details { grid-template-columns: 1fr; } .request-filters label { max-width: 100%; } }
```


## requests.ts

```typescript
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
```


## router.py

```python
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select
from core.db import get_session
from modules.users.dependencies import require_permission
from modules.users.models import User
from .models import Request, RequestWrite, RequestPublic, RequestStatus, now_utc

router = APIRouter(prefix="/requests", tags=["requests"])
Database = Annotated[Session, Depends(get_session)]
Viewer = Annotated[User, Depends(require_permission("requests.view"))]
Manager = Annotated[User, Depends(require_permission("requests.manage"))]


def get_request(session: Session, request_id: int) -> Request:
    item = session.get(Request, request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return item


def public_request(session: Session, item: Request) -> dict:
    author = session.get(User, item.author_id)
    assignee = session.get(User, item.assignee_id) if item.assignee_id else None
    return {**item.model_dump(),
            "author_name": (author.full_name or author.email) if author else f"Пользователь #{item.author_id}",
            "assignee_name": (assignee.full_name or assignee.email) if assignee else None}


def validate_assignee(session: Session, data: RequestWrite):
    if data.assignee_id is not None and session.get(User, data.assignee_id) is None:
        raise HTTPException(status_code=422, detail="Исполнитель не найден")


@router.get("", response_model=list[RequestPublic])
def list_requests(session: Database, user: Viewer, q: str = "", status: RequestStatus | None = None,
                  assignee_id: int | None = None, mine: bool = False):
    query = q.strip().casefold()
    items = session.exec(select(Request).order_by(Request.created_at.desc(), Request.id.desc())).all()
    return [public_request(session, item) for item in items
            if (not query or query in (item.title + "\n" + item.description).casefold())
            and (not status or item.status == status)
            and (assignee_id is None or item.assignee_id == assignee_id)
            and (not mine or item.author_id == user.id)]


@router.get("/assignees")
def assignees(session: Database, user: Viewer):
    return [{"id": person.id, "name": person.full_name or person.email, "is_active": person.is_active}
            for person in session.exec(select(User).order_by(User.email)).all()]


@router.post("", response_model=RequestPublic, status_code=201)
def create_request(data: RequestWrite, session: Database, user: Viewer, manager: Manager):
    validate_assignee(session, data)
    item = Request(**data.model_dump(), author_id=user.id)
    session.add(item)
    session.commit()
    session.refresh(item)
    return public_request(session, item)


@router.get("/{request_id}", response_model=RequestPublic)
def detail(request_id: int, session: Database, user: Viewer):
    return public_request(session, get_request(session, request_id))


@router.put("/{request_id}", response_model=RequestPublic)
def update_request(request_id: int, data: RequestWrite, session: Database, user: Viewer, manager: Manager):
    item = get_request(session, request_id)
    validate_assignee(session, data)
    for field, value in data.model_dump().items():
        setattr(item, field, value)
    item.updated_at = now_utc()
    session.add(item)
    session.commit()
    session.refresh(item)
    return public_request(session, item)


@router.delete("/{request_id}", status_code=204)
def delete_request(request_id: int, session: Database, user: Viewer, manager: Manager):
    session.delete(get_request(session, request_id))
    session.commit()
    return Response(status_code=204)
```
