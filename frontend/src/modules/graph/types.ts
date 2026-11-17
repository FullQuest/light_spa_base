export type Resource = 'water' | 'energy';
export type ObjectState = 'normal' | 'maintenance' | 'incident' | 'unknown';
export interface InfrastructureObject {
  id: string; name: string; kind: 'station' | 'consumer'; resources: Resource[];
  states: Partial<Record<Resource, ObjectState>>; district: string; address: string; description: string;
}
export interface Dependency { id: string; source: string; target: string; resource: Resource }
export interface GraphData { revision: string; demo: boolean; objects: InfrastructureObject[]; dependencies: Dependency[] }
export interface Point { x: number; y: number }
export interface Group { id: string; name: string; members: string[] }
export interface Annotation { id: string; kind: 'text' | 'line'; text: string; position: Point; end?: Point }
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
    (!state || objectState(item, resource) === state) && (!district || item.district === district) &&
    (!incidentsOnly || (resource ? item.states[resource] === 'incident' : Object.values(item.states).includes('incident'))));
}

export function newMapId(prefix: string): string {
  // getRandomValues also works on HTTP intranet origins where randomUUID is unavailable.
  return prefix + '-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
}
