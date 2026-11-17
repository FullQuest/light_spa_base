import type { Annotation, Point } from './types';

export type DrawingTool = 'pan' | 'select' | 'freehand' | 'line' | 'rectangle' | 'text' | 'erase' | 'erase-part';
export function annotationPoints(a: Annotation): Point[] {
  if (a.points?.length) return a.points;
  const end = a.end ?? { x: 180, y: 0 };
  return a.kind === 'rectangle' ? [{ x: 0, y: 0 }, { x: end.x, y: 0 }, end, { x: 0, y: end.y }, { x: 0, y: 0 }] : [{ x: 0, y: 0 }, end];
}
export function annotationBounds(a: Annotation) {
  const points = a.kind === 'text' ? [{ x: 0, y: -18 }, { x: Math.max(30, ...a.text.split('\n').map(line => line.length * 10)), y: a.text.split('\n').length * 24 }] : annotationPoints(a);
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x: a.position.x + x, y: a.position.y + y, width: Math.max(8, Math.max(...points.map(p => p.x)) - x), height: Math.max(8, Math.max(...points.map(p => p.y)) - y) };
}
export function annotationHit(a: Annotation, point: Point, radius: number): boolean {
  const p = { x: point.x - a.position.x, y: point.y - a.position.y };
  if (a.erasures?.some(e => Math.hypot(p.x - e.x, p.y - e.y) + radius < e.radius)) return false;
  if (a.kind === 'text') { const b = annotationBounds(a); return point.x >= b.x - radius && point.x <= b.x + b.width + radius && point.y >= b.y - radius && point.y <= b.y + b.height + radius; }
  const points = annotationPoints(a);
  return points.slice(1).some((b, i) => {
    const start = points[i], dx = b.x - start.x, dy = b.y - start.y;
    const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - start.x - t * dx, p.y - start.y - t * dy) <= radius + (a.width ?? 3) / 2;
  });
}
// Ластик сохраняет маску только у пометки: объекты и связи под ней не затрагиваются.
// Движение интерполируется, поэтому быстрый жест не оставляет пропусков.
export function eraseAnnotations(annotations: Annotation[], from: Point, to: Point, radius: number, whole: boolean): Annotation[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, radius / 2)));
  const samples = Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }));
  return annotations.flatMap(a => {
    const hits = samples.filter(p => annotationHit(a, p, radius));
    if (!hits.length) return [a];
    if (whole) return [];
    return [{ ...a, erasures: [...(a.erasures ?? []), ...hits.map(p => ({ x: p.x - a.position.x, y: p.y - a.position.y, radius }))] }];
  });
}
