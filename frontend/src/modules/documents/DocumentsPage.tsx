import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { accessNames, appendAccess, defaultAccess, statusNames, uploadedAt } from './documents';
import type { DocumentAccess, DocumentSummary } from './documents';
import { AccessFields } from './AccessSettings';
import './documents.css';

interface ListResult {
  query: string;
  items: DocumentSummary[];
  authors: { id: number; name: string }[];
  error: string;
}

export function DocumentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [access, setAccess] = useState<DocumentAccess>(defaultAccess);
  const current = result?.query === query ? result : null;

  useEffect(() => {
    let active = true;
    Promise.all([authRequest<DocumentSummary[]>(`/documents?${query}`),
      authRequest<{ id: number; name: string }[]>('/documents/authors')])
      .then(([items, authors]) => { if (active) setResult({ query, items, authors, error: '' }); })
      .catch((err: unknown) => { if (active) setResult({ query, items: [], authors: [], error: err instanceof Error ? err.message : 'Ошибка загрузки' }); });
    return () => { active = false; };
  }, [query]);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [key, value] of values) if (value) next.set(key, String(value));
    setParams(next);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    appendAccess(data, access);
    setUploading(true); setError('');
    try {
      const document = await authRequest<DocumentSummary>('/documents', { method: 'POST', body: data });
      navigate(`/documents/${document.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось загрузить документ'); }
    finally { setUploading(false); }
  }

  return <section className="documents">
    <h1>Документы</h1>
    {user?.permissions.includes('documents.manage') && <form onSubmit={upload} className="document-upload">
      <fieldset disabled={uploading}>
        <label>Файл<input name="file" type="file" accept=".txt,.md,.csv,.pdf,.docx" required /></label>
        <AccessFields value={access} onChange={setAccess} />
        <button type="submit">{uploading ? 'Чтение документа…' : 'Загрузить'}</button>
      </fieldset>
      <small>TXT, Markdown, CSV, PDF и DOCX. До 20 МиБ. Для сканированных PDF требуется OCR.</small>
    </form>}
    {current && <form key={query} onSubmit={filter} className="document-filters">
      <label>Название<input name="q" defaultValue={params.get('q') ?? ''} /></label>
      <label>Добавил<select aria-label="Добавил" name="author_id" defaultValue={params.get('author_id') ?? ''}>
        <option value="">Все авторы</option>{current.authors.map((author) => <option key={author.id} value={author.id}>{author.name}</option>)}
      </select></label>
      <label>Дата с (UTC)<input name="date_from" type="date" defaultValue={params.get('date_from') ?? ''} /></label>
      <label>Дата по (UTC)<input name="date_to" type="date" defaultValue={params.get('date_to') ?? ''} /></label>
      <label>Формат<select aria-label="Формат" name="format" defaultValue={params.get('format') ?? ''}><option value="">Все форматы</option>
        {['txt', 'md', 'csv', 'pdf', 'docx'].map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
      </select></label>
      <label>Состояние<select aria-label="Состояние" name="status" defaultValue={params.get('status') ?? ''}><option value="">Все состояния</option>
        {Object.entries(statusNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select></label>
      <label>Сортировка<select aria-label="Сортировка" name="sort" defaultValue={params.get('sort') ?? 'newest'}>
        <option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По названию</option>
      </select></label>
      <label><input name="mine" type="checkbox" value="true" defaultChecked={params.get('mine') === 'true'} />Только мои</label>
      <button type="submit">Применить</button><button type="button" onClick={() => setParams({})}>Сбросить</button>
    </form>}
    {error && <p role="alert">{error}</p>}{current?.error && <p role="alert">{current.error}</p>}
    {!current && <p>Загрузка…</p>}
    {current && !current.error && current.items.length === 0 && <p>Документы не найдены.</p>}
    <div className="document-list">
      {current?.items.map((document) => <article key={document.id}>
        <Link to={`/documents/${document.id}${query ? '?' + query : ''}`}>{document.original_name}</Link>
        <small>{document.format.toUpperCase()} · {Math.ceil(document.size_bytes / 1024)} КБ · {uploadedAt(document.uploaded_at)} · {document.uploaded_by_name}</small>
        <span>{statusNames[document.status] ?? document.status} · {accessNames[document.access_mode]}{document.warnings.length > 0 ? ' · Есть предупреждения' : ''}</span>
      </article>)}
    </div>
  </section>;
}
