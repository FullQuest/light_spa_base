import type { Dependency, Point } from './types';

// Смещение промежуточных точек распределяется между концами связи. Так ручной
// изгиб не остаётся у старой вершины после перемещения объекта или группы.
export function moveRoutes(routes: Record<string, Point[]>, edges: Dependency[], before: Record<string, Point>, after: Record<string, Point>) {
  const result = { ...routes };
  for (const edge of edges) {
    const source = before[edge.source], target = before[edge.target];
    if (!source || !target) continue;
    const ds = { x: (after[edge.source]?.x ?? source.x) - source.x, y: (after[edge.source]?.y ?? source.y) - source.y };
    const dt = { x: (after[edge.target]?.x ?? target.x) - target.x, y: (after[edge.target]?.y ?? target.y) - target.y };
    if (!ds.x && !ds.y && !dt.x && !dt.y) continue;
    result[edge.id] = (routes[edge.id] ?? []).map((p, index, points) => {
      const t = (index + 1) / (points.length + 1);
      return { x: p.x + ds.x * (1 - t) + dt.x * t, y: p.y + ds.y * (1 - t) + dt.y * t };
    });
  }
  return result;
}
export function roundedPath(points: Point[], radius = 18): string {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], point = points[i], next = points[i + 1];
    const d1 = Math.hypot(point.x - prev.x, point.y - prev.y), d2 = Math.hypot(next.x - point.x, next.y - point.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a = { x: point.x + (prev.x - point.x) * r / (d1 || 1), y: point.y + (prev.y - point.y) * r / (d1 || 1) };
    const b = { x: point.x + (next.x - point.x) * r / (d2 || 1), y: point.y + (next.y - point.y) * r / (d2 || 1) };
    path += ` L ${a.x} ${a.y} Q ${point.x} ${point.y} ${b.x} ${b.y}`;
  }
  const last = points.at(-1)!;
  return path + ` L ${last.x} ${last.y}`;
}
