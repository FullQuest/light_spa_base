import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, useReactFlow } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react';
import type { Annotation, InfrastructureObject, Point, Resource } from './types';
import { objectState, resourceNames, stateIcons, stateNames } from './types';
export type ObjectNodeData = { item: InfrastructureObject; resource: Resource | ''; highlighted: boolean };
export type MapNode = Node<ObjectNodeData, 'object'>;
export const ObjectNode = memo(function ObjectNode({ data }: NodeProps<MapNode>) {
  const state = objectState(data.item, data.resource);
  return <div className={`infrastructure-node ${data.item.kind} ${state} ${data.highlighted ? 'highlighted' : ''}`}>
    <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
    <div className="object-meta"><span>{data.item.kind === 'station' ? '◈ Станция' : '▦ Потребитель'}</span><span>{data.item.district}</span></div>
    <strong>{data.item.name}</strong>
    <small>{data.item.resources.map(r => resourceNames[r]).join(' · ')}</small>
    <span className={`object-state ${state}`}>{stateIcons[state]} {stateNames[state]}</span>
    <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
  </div>;
});
export type RoutedEdgeData = { points: Point[]; editing: boolean; resource: Resource;
  update: (id: string, points: Point[]) => void };
export type MapEdge = Edge<RoutedEdgeData, 'routed'>;
export function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, style, selected }: EdgeProps<MapEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<{ index: number; point: Point } | null>(null);
  const points = data?.points ?? [];
  const shown = points.map((point, index) => drag?.index === index ? drag.point : point);
  const all = [{ x: sourceX, y: sourceY }, ...shown, { x: targetX, y: targetY }];
  const path = all.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 3 : 1.8 }} />
    {data?.editing && selected && <EdgeLabelRenderer>
      {shown.map((point, index) => <button key={index} className="route-handle nodrag nopan" aria-label={`Точка маршрута ${index + 1}`}
        title="Перетащите точку. Двойной щелчок — удалить."
        style={{ transform: `translate(-50%, -50%) translate(${point.x}px,${point.y}px)` }}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDrag({ index, point }); }}
        onPointerMove={e => { if (drag?.index === index) setDrag({ index, point: screenToFlowPosition({ x: e.clientX, y: e.clientY }) }); }}
        onPointerUp={e => { if (drag?.index === index) {
          const next = points.map((p, i) => i === index ? screenToFlowPosition({ x: e.clientX, y: e.clientY }) : p);
          data.update(id, next); setDrag(null);
        } }} onPointerCancel={() => setDrag(null)}
        onDoubleClick={e => { e.stopPropagation(); data.update(id, points.filter((_, i) => i !== index)); }} />)}
    </EdgeLabelRenderer>}
  </>;
}
export type AnnotationData = { annotation: Annotation; editing: boolean; updateEnd: (id: string, point: Point) => void };
export function AnnotationNode({ data }: NodeProps<Node<AnnotationData>>) {
  const { annotation, editing, updateEnd } = data;
  const { screenToFlowPosition } = useReactFlow();
  const [end, setEnd] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const delta = end ?? annotation.end ?? { x: 180, y: 0 };
  if (annotation.kind === 'text') return <div className="map-note">{annotation.text}</div>;
  return <div className="map-line" style={{ width: Math.max(24, Math.abs(delta.x)), height: Math.max(24, Math.abs(delta.y)) }}>
    <svg style={{ overflow: 'visible' }} width="1" height="1"><line x1="0" y1="0" x2={delta.x} y2={delta.y} stroke="currentColor" strokeWidth="3" /></svg>
    {editing && <><span className="line-origin" title="Переместить линию">●</span><button className="line-end nodrag nopan" aria-label="Конец линии"
      style={{ left: delta.x, top: delta.y }} onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
      onPointerMove={e => { if (dragging) { const p = screenToFlowPosition({ x: e.clientX, y: e.clientY }); setEnd({ x: p.x - annotation.position.x, y: p.y - annotation.position.y }); } }}
      onPointerUp={e => { const p = screenToFlowPosition({ x: e.clientX, y: e.clientY }); updateEnd(annotation.id, { x: p.x - annotation.position.x, y: p.y - annotation.position.y }); setDragging(false); setEnd(null); }}
      onPointerCancel={() => { setDragging(false); setEnd(null); }} /></>}
  </div>;
}
export function GroupNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="map-group-label">{data.label}</div>;
}
