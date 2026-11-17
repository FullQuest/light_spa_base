import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { Dependency, GraphData } from './types';
export const NODE_WIDTH = 218;
export const NODE_HEIGHT = 156;
export interface ConnectionPort { id: string; side: 'in' | 'out'; y: number }
export function handleId(edgeId: string, side: 'in' | 'out') { return `${side}-${edgeId}`; }

// Одинаковые координаты портов используются ELK и React Flow. Ресурсы и
// фильтры не меняют порядок: скрытие связи не сдвигает остальные подключения.
export function connectionPorts(edges: Dependency[]): Record<string, ConnectionPort[]> {
  const sides = new Map<string, { in: Dependency[]; out: Dependency[] }>();
  for (const edge of edges) {
    if (!sides.has(edge.source)) sides.set(edge.source, { in: [], out: [] });
    if (!sides.has(edge.target)) sides.set(edge.target, { in: [], out: [] });
    sides.get(edge.source)!.out.push(edge); sides.get(edge.target)!.in.push(edge);
  }
  return Object.fromEntries([...sides].map(([id, directions]) => [id, (['in', 'out'] as const).flatMap(side => {
    const ordered = [...directions[side]].sort((a, b) =>
      (side === 'in' ? a.source : a.target).localeCompare(side === 'in' ? b.source : b.target, 'en', { numeric: true }) ||
      a.resource.localeCompare(b.resource) || a.id.localeCompare(b.id));
    return ordered.map((edge, index) => ({ id: handleId(edge.id, side), side, y: NODE_HEIGHT * (index + 1) / (ordered.length + 1) }));
  })]));
}
export function layoutModel(data: GraphData): ElkNode {
  const ports = connectionPorts(data.dependencies);
  return { id: 'root', layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': '80', 'elk.spacing.edgeNode': '28', 'elk.spacing.edgeEdge': '22',
    'elk.layered.spacing.nodeNodeBetweenLayers': '180',
    'elk.layered.spacing.edgeNodeBetweenLayers': '28', 'elk.layered.spacing.edgeEdgeBetweenLayers': '22',
    'elk.layered.mergeEdges': 'false', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  }, children: data.objects.map(item => ({ id: item.id, width: NODE_WIDTH, height: NODE_HEIGHT,
    ports: (ports[item.id] ?? []).map(port => ({ id: JSON.stringify([item.id, port.id]), width: 0, height: 0,
      x: port.side === 'in' ? 0 : NODE_WIDTH, y: port.y,
      layoutOptions: { 'elk.port.side': port.side === 'in' ? 'WEST' : 'EAST' } })),
    layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
  })), edges: data.dependencies.map(edge => ({ id: edge.id,
    sources: [JSON.stringify([edge.source, handleId(edge.id, 'out')])],
    targets: [JSON.stringify([edge.target, handleId(edge.id, 'in')])] })) };
}
