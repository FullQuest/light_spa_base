import ELK from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { GraphData, Point } from './types';
import { layoutModel } from './layoutModel';
export { NODE_WIDTH, NODE_HEIGHT } from './layoutModel';
type Layout = { positions: Record<string, Point>; routes: Record<string, Point[]> };
const pending = new Map<string, Promise<Layout>>();
export function layoutGraph(data: GraphData): Promise<Layout> {
  const key = JSON.stringify([data.revision, data.objects.map(o => o.id), data.dependencies]);
  const existing = pending.get(key);
  if (existing) return existing;
  const result = computeLayout(data).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}
async function computeLayout(data: GraphData): Promise<Layout> {
  const worker = new ElkWorker();
  const elk = new ELK({ workerFactory: () => worker });
  let timer: ReturnType<typeof setTimeout>;
  const failed = new Promise<never>((_resolve, reject) => {
    worker.addEventListener('error', () => reject(new Error('Не удалось запустить расчёт схемы')));
    timer = setTimeout(() => reject(new Error('Расчёт схемы превысил 20 секунд. Повторите попытку.')), 20000);
  });
  try {
    const result = await Promise.race([failed, elk.layout<ElkNode>(layoutModel(data))]);
    const positions: Record<string, Point> = {};
    for (const node of result.children ?? []) positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
    const routes: Record<string, Point[]> = {};
    for (const edge of result.edges ?? []) routes[edge.id] = edge.sections?.[0]?.bendPoints ?? [];
    return { positions, routes };
  } finally { clearTimeout(timer!); worker.terminate(); }
}
