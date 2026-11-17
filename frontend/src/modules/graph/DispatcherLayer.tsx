import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import type { Annotation, Point } from './types';
import { newMapId } from './types';
import { annotationBounds, annotationHit, annotationPoints, eraseAnnotations } from './drawing';
import type { DrawingTool } from './drawing';

export function DispatcherLayer({ annotations, active, tool, color, width, eraserSize, text, selected, onSelect, onChange }: {
  annotations: Annotation[]; active: boolean; tool: DrawingTool; color: string; width: number; eraserSize: number; text: string;
  selected: string | null; onSelect: (id: string | null) => void; onChange: (annotations: Annotation[]) => void;
}) {
  const viewport = useViewport(), flow = useReactFlow();
  const [preview, setPreview] = useState<Annotation[] | null>(null);
  const gesture = useRef<{ start: Point; last: Point; original: Annotation[]; current: Annotation[]; id: string | null } | null>(null);
  const point = (e: PointerEvent) => flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!active || tool === 'pan' || e.button !== 0) return;
    const p = point(e);
    const hit = [...annotations].reverse().find(a => annotationHit(a, p, 7 / viewport.zoom));
    if (tool === 'select' && !hit) { onSelect(null); return; }
    if (tool === 'text' && !text.trim()) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    let current = annotations, id = hit?.id ?? null;
    if (tool === 'erase' || tool === 'erase-part') current = eraseAnnotations(current, p, p, eraserSize / viewport.zoom / 2, tool === 'erase');
    else if (tool !== 'select') {
      id = newMapId('annotation');
      current = [...annotations, { id, kind: tool, position: p, text: text.trim(), color, width,
        points: tool === 'freehand' ? [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }] : undefined, end: { x: 0, y: 0 } }];
    }
    gesture.current = { start: p, last: p, original: annotations, current, id };
    onSelect(tool.startsWith('erase') ? null : id); setPreview(current);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g) return;
    const p = point(e);
    if (tool === 'erase' || tool === 'erase-part') g.current = eraseAnnotations(g.current, g.last, p, eraserSize / viewport.zoom / 2, tool === 'erase');
    else g.current = g.current.map(a => {
      if (a.id !== g.id) return a;
      const end = { x: p.x - g.start.x, y: p.y - g.start.y };
      if (tool === 'select') { const original = g.original.find(item => item.id === a.id)!; return { ...a, position: { x: original.position.x + end.x, y: original.position.y + end.y } }; }
      if (tool === 'freehand') return Math.hypot(p.x - g.last.x, p.y - g.last.y) * viewport.zoom >= 1 ? { ...a, points: [...(a.points ?? []), end] } : a;
      return { ...a, end };
    });
    g.last = p; setPreview(g.current);
  };
  const finish = () => { const g = gesture.current; if (!g) return; gesture.current = null; setPreview(null); if (g.current !== g.original) onChange(g.current); };
  return <svg className={`dispatcher-layer ${active && tool !== 'pan' ? 'active' : ''} tool-${tool}`} aria-label="Полотно пометок диспетчера"
    onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setPreview(null); }}>
    <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
      {(preview ?? annotations).map(a => {
        const bounds = annotationBounds(a), mask = `erase-${a.id}`;
        const x = bounds.x - a.position.x - 30, y = bounds.y - a.position.y - 30;
        return <g key={a.id} transform={`translate(${a.position.x},${a.position.y})`}>
          <defs><mask id={mask} maskUnits="userSpaceOnUse" x={x} y={y} width={bounds.width + 60} height={bounds.height + 60}>
            <rect x={x} y={y} width={bounds.width + 60} height={bounds.height + 60} fill="white" />
            {a.erasures?.map((e, i) => <circle key={i} cx={e.x} cy={e.y} r={e.radius} fill="black" />)}
          </mask></defs>
          <g opacity="0.45" mask={`url(#${mask})`}>
            {a.kind === 'text' ? <text fill={a.color ?? '#875dc7'} fontSize="18" fontWeight="600">{a.text.split('\n').map((line, i) => <tspan key={i} x="0" dy={i ? 24 : 0}>{line}</tspan>)}</text> :
              <polyline points={annotationPoints(a).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={a.color ?? '#875dc7'} strokeWidth={a.width ?? 3} strokeLinecap="round" strokeLinejoin="round" />}
          </g>
          {active && selected === a.id && <rect x={x + 24} y={y + 24} width={bounds.width + 12} height={bounds.height + 12} fill="none" stroke="#7c3aed" strokeWidth={1 / viewport.zoom} strokeDasharray="5 5" />}
        </g>;
      })}
    </g>
  </svg>;
}
