import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { accessNames, downloadOriginal, statusNames, uploadedAt } from './documents';
import type { DocumentDetail } from './documents';
import { AccessSettings } from './AccessSettings';
import './documents.css';

function OriginalPreview({ document }: { document: DocumentDetail }) {
  const [preview, setPreview] = useState<{ url: string; text: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (document.format === 'docx') return;
    let active = true;
    let url = '';
    authRequest<Blob>(`/documents/${document.id}/original`, {}, 'blob')
      .then(async (blob) => {
        let text = '';
        if (document.format !== 'pdf') {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255)) {
            text = new TextDecoder(bytes[0] === 255 ? 'utf-16le' : 'utf-16be').decode(bytes);
          } else {
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { text = new TextDecoder('windows-1251').decode(bytes); }
          }
        }
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, text });
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Ошибка предпросмотра'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [document.id, document.format]);
  if (document.format === 'docx') return <p>Точное оформление DOCX доступно в исходном файле. Скачайте его для открытия в редакторе. Абзацы и таблицы показаны во вкладке «Извлечённые данные».</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!preview) return <p>Загрузка оригинала…</p>;
  return document.format === 'pdf'
    ? <><p>Если браузер не показывает PDF, скачайте оригинал.</p><iframe className="document-pdf" title="Оригинал PDF" src={preview.url} /></>
    : <pre className="document-text">{preview.text}</pre>;
}

function DocumentCard({ id }: { id: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { search } = useLocation();
  const back = `/documents${search}`;
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [tab, setTab] = useState('extracted');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    authRequest<DocumentDetail>(`/documents/${id}`)
      .then((item) => { if (active) setDocument(item); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Ошибка загрузки'); });
    return () => { active = false; };
  }, [id]);

  async function download() {
    if (!document) return;
    setBusy(true); setError('');
    try { await downloadOriginal(document); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось скачать оригинал'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Удалить документ и его оригинал?')) return;
    setBusy(true); setError('');
    try { await authRequest(`/documents/${id}`, { method: 'DELETE' }); navigate(back); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить документ'); }
    finally { setBusy(false); }
  }

  return <section className="documents">
    <Link to={back}>← К документам</Link>
    {error && <p role="alert">{error}</p>}
    {!document && !error && <p>Загрузка…</p>}
    {document && <>
      <h1>{document.original_name}</h1>
      <p>{document.format.toUpperCase()} · {document.size_bytes.toLocaleString('ru-RU')} байт · {uploadedAt(document.uploaded_at)} · {document.uploaded_by_name}</p>
      <p>Состояние: {statusNames[document.status] ?? document.status} · Доступ: {accessNames[document.access_mode]}</p>
      <div className="document-actions">
        <button onClick={download} disabled={busy}>Скачать оригинал</button>
        {user?.permissions.includes('documents.manage') && (user.role === 'superadmin' || user.id === document.uploaded_by) && <button onClick={remove} disabled={busy}>Удалить</button>}
      </div>
      {(user?.role === 'superadmin' || user?.id === document.uploaded_by) && <AccessSettings document={document} onSaved={setDocument} />}
      {document.error && <p role="alert">{document.error}</p>}
      {document.warnings.length > 0 && <ul className="document-warnings">{document.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      <div className="document-actions" role="group" aria-label="Представление документа">
        <button aria-pressed={tab === 'original'} onClick={() => setTab('original')}>Оригинал</button>
        <button aria-pressed={tab === 'extracted'} onClick={() => setTab('extracted')}>Извлечённые данные</button>
      </div>
      {tab === 'original' ? <OriginalPreview document={document} /> : <>
        <h2>Текст</h2>
        {document.text ? <pre className="document-text">{document.text}</pre> : <p>Извлечённого текста нет.</p>}
        {document.tables.map((table, index) => <section key={index}>
          <h2>{table.name}</h2>
          <div className="document-table"><table><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, col) => <td key={col}>{cell}</td>)}</tr>)}</tbody></table></div>
        </section>)}
      </>}
    </>}
  </section>;
}

export function DocumentPage() {
  const { id = '' } = useParams();
  return <DocumentCard key={id} id={id} />;
}
