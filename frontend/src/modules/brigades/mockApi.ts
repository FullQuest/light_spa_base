import employeeFixture from '../workforce/employees.fixture.json';
import type { Employee } from '../workforce/types.ts';
import type { FormationJob, FormationResult, ScheduledIncident } from './types.ts';

const prefix = 'repair-mock:';
const memory = new Map<string, string>();
function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(prefix + key) ?? memory.get(key); return raw ? JSON.parse(raw) as T : null; }
  catch { return null; }
}
function write(key: string, value: unknown) {
  const text = JSON.stringify(value);
  memory.set(key, text);
  try { localStorage.setItem(prefix + key, text); } catch { /* Session memory still supports the workflow. */ }
}
function revision() { return read<string>('revision') ?? 'module2-fixture-v1'; }
function delay(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 180);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export const formationResetEvent = 'repair-data-reset';
export function invalidateFormationResults() {
  // A tombstone also invalidates jobs already in flight and results in other tabs.
  write('revision', `${Date.now()}-${Math.random()}`);
  for (const key of [...memory.keys()]) if (key.startsWith('result:') || key.startsWith('job:')) memory.delete(key);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix + 'result:') || key?.startsWith(prefix + 'job:')) localStorage.removeItem(key);
    }
  } catch { /* The revision invalidates all previously stored results as well. */ }
  window.dispatchEvent(new Event(formationResetEvent));
}

export function makeMockResult(employees: Employee[], dataRevision: string): FormationResult {
  const brigades = Array.from({ length: 7 }, (_, index) => ({ brigadeId: index + 1, employeeIds: employees.slice(index * 4, index * 4 + 4).map(e => e.tabel) }));
  const names = ['Водозабор «Северный»', 'Подстанция №12', 'Насосная станция «Заречная»', 'Жилой квартал «Солнечный»', 'Городская больница №2', 'Школа №14', 'Промышленный узел «Восточный»', 'Очистные сооружения', 'Трансформаторная подстанция №8', 'Детский сад «Радуга»', 'Тепловой пункт №3', 'Спортивный комплекс', 'Улица Лесная, 24', 'Административный центр'];
  const origin = Date.parse('2026-11-18T08:00:00+03:00');
  const incidents: ScheduledIncident[] = names.map((objectName, index) => {
    const brigadeId = index % 7 + 1, sequence = Math.floor(index / 7) + 1;
    const start = origin + (sequence === 1 ? index * 600000 : 10800000 + (index - 7) * 900000);
    const actualDurationSeconds = 2700 + index % 4 * 900;
    return { eventId: 501 + index, objectId: 100 + index, objectName, resourceType: index % 3 ? 'water' : 'energy',
      occurredAt: '2026-11-18T06:30:00+03:00', startAt: new Date(start).toISOString(), finishAt: new Date(start + actualDurationSeconds * 1000).toISOString(),
      baseDurationSeconds: actualDurationSeconds * 3, actualDurationSeconds, brigadeId, sequence };
  });
  return { id: `plan-${Date.now()}`, generatedAt: new Date().toISOString(), dataRevision, employees, brigades, incidents };
}

interface StoredJob { id: string; startedAt: number; revision: string; employees: Employee[] }
export const mockFormationApi = {
  async employees(signal?: AbortSignal) {
    await delay(signal);
    return structuredClone(read<Employee[]>('employees') ?? employeeFixture);
  },
  async result(scope: string, signal?: AbortSignal) {
    await delay(signal);
    const result = read<FormationResult>(`result:${scope}`);
    return result?.dataRevision === revision() ? result : null;
  },
  async currentJob(scope: string, signal?: AbortSignal): Promise<FormationJob | null> {
    await delay(signal);
    const job = read<StoredJob>(`job:${scope}`);
    return job?.revision === revision() ? this.job(scope, job.id, signal) : null;
  },
  async start(scope: string, signal?: AbortSignal): Promise<FormationJob> {
    await delay(signal);
    const employees = await this.employees(signal);
    const job: StoredJob = { id: `job-${Date.now()}`, startedAt: Date.now(), revision: revision(), employees };
    write(`job:${scope}`, job);
    return { id: job.id, status: 'running', progress: 0, stage: 'Подготовка данных' };
  },
  async job(scope: string, id: string, signal?: AbortSignal): Promise<FormationJob> {
    await delay(signal);
    const job = read<StoredJob>(`job:${scope}`);
    if (!job || job.id !== id || job.revision !== revision()) throw new Error('Данные были очищены. Сформируйте бригады заново.');
    const progress = Math.min(100, Math.floor((Date.now() - job.startedAt) / 35));
    if (progress < 100) return { id, status: 'running', progress, stage: progress < 30 ? 'Подготовка данных' : progress < 70 ? 'Формирование составов бригад' : 'Построение расписания' };
    const outcome = read<string>('outcome');
    if (outcome === 'error') return { id, status: 'failed', progress: 100, stage: 'Расчёт не выполнен', error: 'Не удалось сформировать решение. Попробуйте ещё раз.' };
    const result = makeMockResult(job.employees, job.revision);
    if (outcome === 'empty') { result.brigades = []; result.incidents = []; }
    write(`result:${scope}`, result);
    write(`job:${scope}`, null);
    return { id, status: 'completed', progress: 100, stage: 'Расписание готово', result };
  },
};
