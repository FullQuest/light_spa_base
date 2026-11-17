import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, useReactFlow } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react';
import type { InfrastructureObject, ObjectState, Point, Resource } from './types';
import type { ResourceIncident } from './incidents';
import { IncidentDuration } from './IncidentClock';
import { roundedPath } from './routes';
import { objectState, resourceNames, stateIcons, stateNames } from './types';
export type ObjectNodeData = { item: InfrastructureObject; resource: Resource | ''; highlighted: boolean; influence?: 'active' | 'hover' | null; index: number; dependentCount: number; districtName?: string; incidents?: Partial<Record<Resource, ResourceIncident>>; affectedCount?: number; onHover?: (id: string | null) => void };
export type MapNode = Node<ObjectNodeData, 'object'>;
export const ObjectNode = memo(function ObjectNode({ id, data }: NodeProps<MapNode>) {
  const state = objectState(data.item, data.resource);
  const relevantImpact = data.item.resources.filter(r => !data.resource || data.resource === r).some(r => data.incidents?.[r]);
  const ownIncident = data.item.resources.filter(r => !data.resource || data.resource === r).some(r => data.incidents?.[r]?.own);
  return <div className={`infrastructure-node ${data.item.kind} ${state} ${data.highlighted ? 'highlighted' : ''} ${data.influence ? `influence-${data.influence}` : ''} ${Object.values(data.incidents ?? {}).some(entry => entry.own) ? 'incident-source' : Object.keys(data.incidents ?? {}).length ? 'incident-affected' : ''}`}
    onMouseEnter={() => data.onHover?.(id)} onMouseLeave={() => data.onHover?.(null)}>
    <Handle type="target" position={Position.Left} id="in" isConnectable={false} />
    <div className="object-meta"><span>{data.item.kind === 'station' ? '◈ Станция' : '▦ Потребитель'}</span><span>{data.districtName ?? 'Без района'}</span></div>
    <strong>{data.item.name}</strong>
    <div className="resource-statuses">{data.item.resources.map(r => {
      const impact = data.incidents?.[r], own = data.item.states[r] ?? 'unknown';
      const kind = impact?.own ? 'incident' : impact ? 'affected' : own;
      const label = kind === 'affected' ? 'Под влиянием аварии' : stateNames[own];
      return <div key={r} className={`resource-status ${r} ${kind}`} data-resource={r} data-status={kind}>
        <span className={`resource-badge ${r}`}>{r === 'water' ? '●' : 'ϟ'} {resourceNames[r]}</span>
        <span className="resource-condition">{kind === 'affected' ? '↳' : stateIcons[own]} {label}</span>
        {impact && <IncidentDuration since={impact.since} />}
      </div>;
    })}</div>
    {Object.values(data.incidents ?? {}).some(entry => entry.own) && <div className="incident-tooltip" role="tooltip">Под влиянием аварии: {data.affectedCount ?? 0} {dependentNoun(data.affectedCount ?? 0)} (прямые и косвенные).</div>}
    <div className="object-bottom"><span className={`object-state ${ownIncident ? 'incident' : relevantImpact ? 'affected' : state}`}>{ownIncident ? '! Авария' : relevantImpact ? '↳ Под влиянием' : `${stateIcons[state]} ${stateNames[state]}`}</span><span className="dependency-index" title={`Зависимых объектов: ${data.dependentCount}`} aria-label={`Индекс ${data.index}, зависимых ${data.dependentCount}`}>Индекс {data.index}</span></div>
    <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
  </div>;
});
function dependentNoun(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'зависимых объектов';
  const last = count % 10;
  return last === 1 ? 'зависимый объект' : last >= 2 && last <= 4 ? 'зависимых объекта' : 'зависимых объектов';
}
export type RoutedEdgeData = { points: Point[]; routeStyle: 'rounded' | 'polyline'; editing: boolean; resource: Resource;
  update: (id: string, points: Point[]) => void; influence?: 'active' | 'hover' | null };
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
    {data?.influence && <><defs><marker id={`influence-arrow-${id}`} markerWidth="10" markerHeight="10" refX="9" refY="0" orient="auto" markerUnits="strokeWidth"><path d="M0,-5L10,0L0,5Z" fill="#e11d48" /></marker></defs>
      <path className={`influence-edge ${data.influence}`} d={path} fill="none" stroke="#e11d48"
        strokeWidth={data.influence === 'active' ? 5 : 3.5} strokeDasharray={data.influence === 'active' ? '9 5' : '5 6'}
        strokeLinecap="round" markerEnd={`url(#influence-arrow-${id})`} pointerEvents="none" /></>}
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
export function GroupNode({ id, data }: NodeProps<Node<{ label: string; collapsed: boolean; highlighted: boolean; influence?: 'active' | 'hover' | null; resources: Resource[]; resourceStates: Partial<Record<Resource, ObjectState>>; state: ObjectState; toggle: () => void; onHover?: (id: string | null) => void }>>) {
  return <div onMouseEnter={() => data.onHover?.(id)} onMouseLeave={() => data.onHover?.(null)} className={`${data.collapsed ? `collapsed-district ${data.highlighted ? 'highlighted' : ''}` : 'map-group-label'} ${data.influence ? `influence-${data.influence}` : ''}`}>
    <Handle type="target" position={Position.Left} id="in" isConnectable={false} style={{ opacity: data.collapsed ? 1 : 0 }} />
    <div className="district-heading"><strong>{data.label}</strong>
    <button className="nodrag nopan" aria-label={`${data.collapsed ? 'Развернуть' : 'Свернуть'} район ${data.label}`} onClick={e => { e.stopPropagation(); data.toggle(); }}>{data.collapsed ? 'Развернуть' : 'Свернуть'}</button></div>
    {data.collapsed && <><div className="resource-badges">{data.resources.map(resource => <span key={resource} className={`resource-badge ${resource}`}>
      {resourceNames[resource]} · {stateNames[data.resourceStates[resource] ?? 'unknown']}</span>)}</div><span className={`object-state ${data.state}`}>{stateIcons[data.state]} {stateNames[data.state]}</span></>}
    <Handle type="source" position={Position.Right} id="out" isConnectable={false} style={{ opacity: data.collapsed ? 1 : 0 }} />
  </div>;
}
