import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, useReactFlow } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react';
import type { InfrastructureObject, ObjectState, Point, Resource } from './types';
import { roundedPath } from './routes';
import { objectState, resourceNames, stateIcons, stateNames } from './types';
export type ObjectNodeData = { item: InfrastructureObject; resource: Resource | ''; highlighted: boolean; index: number; dependentCount: number; districtName?: string };
export type MapNode = Node<ObjectNodeData, 'object'>;
export const ObjectNode = memo(function ObjectNode({ data }: NodeProps<MapNode>) {
  const state = objectState(data.item, data.resource);
  return <div className={`infrastructure-node ${data.item.kind} ${state} ${data.highlighted ? 'highlighted' : ''}`}>
    <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
    <div className="object-meta"><span>{data.item.kind === 'station' ? '◈ Станция' : '▦ Потребитель'}</span><span>{data.districtName ?? 'Без района'}</span></div>
    <strong>{data.item.name}</strong>
    <div className="resource-badges">{data.item.resources.map(r => <span className={`resource-badge ${r}`} key={r}>{r === 'water' ? '●' : 'ϟ'} {resourceNames[r]}</span>)}</div>
    <div className="object-bottom"><span className={`object-state ${state}`}>{stateIcons[state]} {stateNames[state]}</span><span className="dependency-index" title={`Зависимых объектов: ${data.dependentCount}`} aria-label={`Индекс ${data.index}, зависимых ${data.dependentCount}`}>Индекс {data.index}</span></div>
    <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
  </div>;
});
export type RoutedEdgeData = { points: Point[]; routeStyle: 'rounded' | 'polyline'; editing: boolean; resource: Resource;
  update: (id: string, points: Point[]) => void };
export type MapEdge = Edge<RoutedEdgeData, 'routed'>;
export function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, style, selected }: EdgeProps<MapEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<{ index: number; point: Point } | null>(null);
  const points = data?.points ?? [];
  const shown = points.map((point, index) => drag?.index === index ? drag.point : point);
  const all = [{ x: sourceX, y: sourceY }, ...shown, { x: targetX, y: targetY }];
  const path = data?.routeStyle === 'rounded' ? roundedPath(all) : all.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 3 : 2.2 }} />
    <path className="resource-flow" opacity={style?.opacity} d={path} fill="none" stroke={style?.stroke ?? '#0284c7'} strokeWidth="3" strokeDasharray="3 22" pointerEvents="none" />
    <EdgeLabelRenderer><span className={`edge-resource-label ${data?.resource}`} style={{ transform: `translate(-50%, -50%) translate(${all[Math.floor((all.length - 1) / 2)].x + (all[Math.ceil((all.length - 1) / 2)].x - all[Math.floor((all.length - 1) / 2)].x) / 2}px,${all[Math.floor((all.length - 1) / 2)].y + (all[Math.ceil((all.length - 1) / 2)].y - all[Math.floor((all.length - 1) / 2)].y) / 2}px)`, opacity: style?.opacity }}>
      {data?.resource && resourceNames[data.resource]} →
    </span></EdgeLabelRenderer>
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
// Пометки рисуются отдельным SVG-слоем. Узлы-прокси нужны только мини-карте.
export function AnnotationProxy() { return null; }
// Точки подключения существуют и у развёрнутого района: React Flow должен
// зарегистрировать их до одновременного переключения узлов и проекции рёбер.
export function GroupNode({ data }: NodeProps<Node<{ label: string; collapsed: boolean; highlighted: boolean; resources: Resource[]; state: ObjectState; toggle: () => void }>>) {
  return <div className={data.collapsed ? `collapsed-district ${data.highlighted ? 'highlighted' : ''}` : 'map-group-label'}>
    <Handle type="target" position={Position.Left} id="in" isConnectable={false} style={{ opacity: data.collapsed ? 1 : 0 }} />
    <div className="district-heading"><strong>{data.label}</strong>
    <button className="nodrag nopan" aria-label={`${data.collapsed ? 'Развернуть' : 'Свернуть'} район ${data.label}`} onClick={e => { e.stopPropagation(); data.toggle(); }}>{data.collapsed ? 'Развернуть' : 'Свернуть'}</button></div>
    {data.collapsed && <><div className="resource-badges">{data.resources.map(resource => <span key={resource} className={`resource-badge ${resource}`}>{resourceNames[resource]}</span>)}</div><span className={`object-state ${data.state}`}>{stateIcons[data.state]} {stateNames[data.state]}</span></>}
    <Handle type="source" position={Position.Right} id="out" isConnectable={false} style={{ opacity: data.collapsed ? 1 : 0 }} />
  </div>;
}
