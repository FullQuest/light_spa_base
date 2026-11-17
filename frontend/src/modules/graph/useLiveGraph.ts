import { useEffect, useState } from 'react';
import { authRequest } from '../../auth/api';
import { createGraphStore, defaultPreferences, graphActions, loadPreferences, savePreferences } from './store';
import type { GraphStore } from './store';
import type { Preferences } from './types';
import { layoutGraph, NODE_WIDTH } from './layout';
import { normalizeSnapshot, topologyKey } from './snapshot';
import type { LiveGraph } from './snapshot';
export interface LoadedGraph { data: LiveGraph; store: GraphStore; key: string }
// В архиве live=false: та же раскладка из IndexedDB, один запрос топологии,
// без фонового опроса и без перезаписи оформления основной страницы.
export function useLiveGraph(userId: number | undefined, attempt: number, live = true) {
  const [loaded, setLoaded] = useState<LoadedGraph | null>(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true, current: LoadedGraph | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let busy = false;
    async function refresh() {
      if (!active || busy) return;
      busy = true;
      const startedAt = performance.now();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 2800);
      try {
        // Для живой карты момент снимка задаёт сервер ПОСЛЕ синхронизации.
        // Это исключает рассинхронизацию часов браузера и сервера. В архиве
        // здесь читается только текущая топология; состояния восстанавливаются
        // локально по полному архиву событий (timeline.ts), без повторных запросов.
        const data = normalizeSnapshot(await authRequest<unknown>('/graph',
          { signal: controller.signal, cache: 'no-store' }));
        if (!active) return;
        if (!current) {
          const key = `user-${userId}`;
          const preferences = await loadPreferences(key).catch(() => {
            if (active) setStorageWarning('Хранилище браузера недоступно. Настройки сохраняются только до закрытия страницы.');
            return defaultPreferences();
          });
          if (data.objects.some(item => !preferences.positions[item.id])) {
            const layout = await layoutGraph(data);
            preferences.positions = { ...layout.positions, ...preferences.positions };
            preferences.routes = { ...layout.routes, ...preferences.routes };
          }
          if (!active) return;
          current = { data, key, store: createGraphStore(preferences) };
        } else {
          if (topologyKey(data) !== topologyKey(current.data)) {
            // Только структурные изменения требуют новых координат. Существующие
            // позиции берём ПОСЛЕ await: пользователь мог двигать объекты во время расчёта.
            const needsLayout = data.objects.some(item => !current!.store.getState().present.positions[item.id]);
            const layout = needsLayout ? await layoutGraph(data) : null;
            if (!active) return;
            const prefs = current.store.getState().present;
            const ids = new Set(data.objects.map(item => item.id));
            const edges = new Set(data.dependencies.map(edge => edge.id));
            const positions = Object.fromEntries(Object.entries(prefs.positions).filter(([id]) => ids.has(id)));
            if (layout) {
              const offset = Math.max(0, ...Object.values(positions).map(p => p.x)) + NODE_WIDTH + 160;
              for (const item of data.objects) if (!positions[item.id]) positions[item.id] = { x: layout.positions[item.id].x + offset, y: layout.positions[item.id].y };
            }
            const groups = prefs.groups.map(group => ({ ...group, members: group.members.filter(id => ids.has(id)) })).filter(group => group.members.length);
            const patch: Partial<Preferences> = { positions,
              routes: Object.fromEntries(Object.entries(prefs.routes).filter(([id]) => edges.has(id))),
              manualRouteIds: prefs.manualRouteIds?.filter(id => edges.has(id)),
              hidden: prefs.hidden.filter(id => ids.has(id)),
              groups, filters: { ...prefs.filters, district: groups.some(group => group.id === prefs.filters.district) ? prefs.filters.district : '' } };
            current.store.dispatch(graphActions.reconcile(patch));
          }
          current = { ...current, data };
        }
        if (active) { setLoaded(current); setError(''); setRefreshError(''); setReceivedAt(new Date().toISOString()); }
      } catch (err) {
        if (active) {
          const message = controller?.signal.aborted ? 'Сервер не ответил за 3 секунды.' : err instanceof Error ? err.message : 'Не удалось обновить граф';
          if (current) setRefreshError(`Обновление недоступно. Показан последний полученный снимок. ${message}`);
          else setError(message);
        }
      } finally {
        clearTimeout(timeout); busy = false;
        // Интервал отсчитывается от начала запроса, обработка не добавляется
        // к каждой секунде. Долгие запросы не перекрываются и не копятся в очереди.
        if (active && live) timer = setTimeout(() => { if (!document.hidden) void refresh(); },
          Math.max(0, 1000 - (performance.now() - startedAt)));
      }
    }
    const resume = () => { if (live && !document.hidden) { clearTimeout(timer); void refresh(); } };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    void refresh();
    return () => { active = false; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  }, [userId, attempt, live]);
  const store = loaded?.store, key = loaded?.key;
  useEffect(() => {
    if (!store || !key || !live) return;
    let timer: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void savePreferences(key, store.getState().present).catch(() =>
        setStorageWarning('Не удалось сохранить настройки в браузере.')); }, 250);
    };
    save();
    const unsubscribe = store.subscribe(save);
    return () => { clearTimeout(timer); unsubscribe(); void savePreferences(key, store.getState().present).catch(() => {}); };
  }, [store, key, live]);
  return { loaded, error, refreshError, storageWarning, receivedAt };
}
