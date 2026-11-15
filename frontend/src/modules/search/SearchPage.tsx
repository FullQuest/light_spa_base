import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authRequest } from '../../auth/api';
import { statusNames, uploadedAt } from '../documents/documents';
import './search.css';

interface SearchResult {
  id: string;
  original_name: string;
  format: string;
  uploaded_by_name: string;
  uploaded_at: string;
  status: string;
  snippet: string;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.trim().split(/\s+/))].filter(Boolean).sort((a, b) => b.length - a.length);
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!pattern) return <>{text}</>;
  return <>{text.split(new RegExp(`(${pattern})`, 'giu')).map((part, index) => index % 2
    ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>)}</>;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const [result, setResult] = useState<{ query: string; items: SearchResult[]; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = result?.query === query ? result : null;

  useEffect(() => {
    if (!query) return;
    let active = true;
    authRequest<SearchResult[]>(`/search?${new URLSearchParams({ q: query })}`)
      .then((items) => { if (active) setResult({ query, items, error: '' }); })
      .catch((err: unknown) => { if (active) setResult({ query, items: [], error: err instanceof Error ? err.message : 'Не удалось выполнить поиск' }); });
    return () => { active = false; };
  }, [query, attempt]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    setParams(q ? { q } : {});
    if (q === query) setAttempt((value) => value + 1);
  }

  return <section className="search-page">
    <h1>Поиск</h1>
    <p>Поиск по названиям и извлечённому тексту доступных документов. Все слова запроса должны присутствовать.</p>
    <form key={query} onSubmit={submit} className="search-form">
      <label>Поисковый запрос<input type="search" name="q" maxLength={200} defaultValue={query} placeholder="Например, охрана труда" /></label>
      <button type="submit" className="btn-primary">Найти</button>
      <button type="button" onClick={() => setParams({})}>Очистить</button>
    </form>
    {!query && <p className="search-empty">Введите запрос, чтобы найти сведения внутри документов.</p>}
    {query && !current && <p role="status">Поиск…</p>}
    {query && current?.error && <div role="alert"><p>{current.error}</p><button onClick={() => setAttempt((value) => value + 1)}>Повторить</button></div>}
    {query && current && !current.error && <>
      <p role="status">Найдено документов: {current.items.length}</p>
      {current.items.length === 0 && <p className="search-empty">Ничего не найдено. Попробуйте другие слова.</p>}
      <div className="search-results">
        {current.items.map((item) => <article key={item.id}>
          <h2><Link to={`/documents/${item.id}?${new URLSearchParams({ from: 'search', q: query })}`}><Highlight text={item.original_name} query={query} /></Link></h2>
          <small>{item.format.toUpperCase()} · {item.uploaded_by_name} · {uploadedAt(item.uploaded_at)} · {statusNames[item.status] ?? item.status}</small>
          {item.snippet ? <p><Highlight text={item.snippet} query={query} /></p> : <p>Извлечённого текста нет; совпадение найдено в названии.</p>}
        </article>)}
      </div>
    </>}
  </section>;
}
