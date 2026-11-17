export type Resource = 'water' | 'energy';
export type ObjectState = 'normal' | 'maintenance' | 'incident' | 'unknown';
export interface InfrastructureObject {
  id: string; name: string; kind: 'station' | 'consumer'; resources: Resource[];
  states: Partial<Record<Resource, ObjectState>>; district: string; address: string; description: string;
}
export interface Dependency { id: string; source: string; target: string; resource: Resource }
export interface GraphData { revision: string; demo: boolean; objects: InfrastructureObject[]; dependencies: Dependency[] }
export interface Point { x: number; y: number }
export interface Group { id: string; name: string; members: string[]; collapsed?: boolean }
export interface Annotation { id: string; kind: 'text' | 'line' | 'freehand' | 'rectangle'; text: string; position: Point; end?: Point; points?: Point[]; color?: string; width?: number; erasures?: { x: number; y: number; radius: number }[] }
export interface Preferences {
  positions: Record<string, Point>; routes: Record<string, Point[]>; groups: Group[];
  annotations: Annotation[]; hidden: string[];
  filters: { resource: Resource | ''; state: ObjectState | ''; district: string; incidentsOnly: boolean };
  routeStyle?: 'rounded' | 'polyline'; manualRouteIds?: string[];
  viewport?: { x: number; y: number; zoom: number };
}
export const resourceNames = { water: 'Вода', energy: 'Электроэнергия' };
export const stateNames = { normal: 'Норма', maintenance: 'Техработы', incident: 'Авария', unknown: 'Нет данных' };
export const stateIcons = { normal: '✓', maintenance: '◆', incident: '!', unknown: '?' };
export function objectState(item: InfrastructureObject, resource: Resource | '' = ''): ObjectState {
  const states = resource ? [item.states[resource]] : item.resources.map(r => item.states[r]);
  return states.includes('incident') ? 'incident' : states.includes('maintenance') ? 'maintenance' : states.length && states.every(state => state === 'normal') ? 'normal' : 'unknown';
}
export function descendants(id: string, edges: Dependency[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  const found = new Set<string>([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]) ?? []) {
    if (!found.has(next)) { found.add(next); queue.push(next); }
  }
  return found;
}
export function visibleObjects(data: GraphData, prefs: Preferences) {
  const { resource, state, district, incidentsOnly } = prefs.filters;
  const hidden = new Set(prefs.hidden);
  return data.objects.filter(item => !hidden.has(item.id) && (!resource || item.resources.includes(resource)) &&
    (!state || objectState(item, resource) === state) && (!district || prefs.groups.some(group => group.id === district && group.members.includes(item.id))) &&
    (!incidentsOnly || (resource ? item.states[resource] === 'incident' : Object.values(item.states).includes('incident'))));
}

export function newMapId(prefix: string): string {
  // getRandomValues also works on HTTP intranet origins where randomUUID is unavailable.
  return prefix + '-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
}

// Индекс считается по исходной топологии, независимо от фильтров и районов.
// Общие потомки учитываются один раз; сама вершина в число зависимых не входит.
export function dependencyIndices(data: GraphData): Record<string, { count: number; index: number }> {
  const counts = data.objects.map(item => [item.id, descendants(item.id, data.dependencies).size - 1] as const);
  const maximum = Math.max(0, ...counts.map(([, count]) => count));
  return Object.fromEntries(counts.map(([id, count]) => [id, { count,
    index: count === 0 ? 0 : count === maximum ? 10 : Math.max(1, Math.min(9, Math.round(count / maximum * 10))) }]));
}
// Районы — исключительно пользовательское оформление. Один объект входит в один
// район; создание нового переносит выбранные объекты из прежних районов.
export function assignGroup(groups: Group[], group: Group): Group[] {
  const members = new Set(group.members);
  return [...groups.map(old => ({ ...old, members: old.members.filter(id => !members.has(id)) })).filter(old => old.members.length), group];
}
// Это только проекция отображения: исходные зависимости и их ID не изменяются.
// Внутренние связи свёрнутого района скрыты, внешние сохраняются по отдельности.
export function projectedDependencies(dependencies: Dependency[], groups: Group[], visible: Set<string>) {
  const owner = new Map<string, string>();
  for (const group of groups) if (group.collapsed) for (const id of group.members) owner.set(id, group.id);
  return dependencies.filter(edge => visible.has(edge.source) && visible.has(edge.target)).flatMap(edge => {
    const source = owner.get(edge.source) ?? edge.source, target = owner.get(edge.target) ?? edge.target;
    return source === target ? [] : [{ ...edge, source, target, projected: source !== edge.source || target !== edge.target }];
  });
}
