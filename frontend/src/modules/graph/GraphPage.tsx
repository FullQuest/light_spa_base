import { useCallback, useMemo, useRef, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { Background, ControlButton, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Node, NodeChangeset, NodeMouseHandler, OnNodeDrag } from '@xyflow/react';
import { useAuth } from '../../auth/auth';
import { defaultPreferences, graphActions } from './store';
import type { GraphState, GraphStore } from './store';
import { assignGroup, dependencyIndices, influenceZone, projectedDependencies, descendants, newMapId, objectState, resourceNames, stateNames, visibleObjects } from './types';
import type { InfrastructureObject, ObjectState, Point, Resource } from './types';
import { useLiveGraph } from './useLiveGraph';
import type { CurrentEvent, LiveGraph } from './snapshot';
import { moveRoutes } from './routes';
import { IncidentClock, IncidentDuration } from './IncidentClock';
import { incidentImpact } from './incidents';
import { EventsPanel } from './EventsPanel';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { ObjectNode, AnnotationProxy, GroupNode, RoutedEdge } from './GraphElements';
import type { MapEdge } from './GraphElements';
import '@xyflow/react/dist/style.css';
import './graph.css';
import { DispatcherLayer } from './DispatcherLayer';
import { annotationBounds } from './drawing';
import type { DrawingTool } from './drawing';

const nodeTypes = { object: ObjectNode, annotation: AnnotationProxy, group: GroupNode };
const edgeTypes = { routed: RoutedEdge };

export function GraphPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [attempt, setAttempt] = useState(0);
  const { loaded, error, refreshError, storageWarning, receivedAt } = useLiveGraph(userId, attempt);
  if (error) return <section><p role="alert">{error}</p><button onClick={() => setAttempt(a => a + 1)}>Повторить</button></section>;
  if (!loaded) return <section><p role="status">Загрузка объектов и расчёт схемы…</p></section>;
  return <Provider store={loaded.store}><ReactFlowProvider><IncidentClock><GraphCanvas data={loaded.data} storageWarning={storageWarning} refreshError={refreshError} receivedAt={receivedAt} /></IncidentClock></ReactFlowProvider></Provider>;
}

function GraphCanvas({ data, storageWarning, refreshError, receivedAt }: { data: LiveGraph; storageWarning: string; refreshError: string; receivedAt: string | null }) {
  const dispatch = useDispatch<GraphStore['dispatch']>();
  const prefs = useSelector((state: GraphState) => state.present);
  const canUndo = useSelector((state: GraphState) => state.past.length > 0);
  const canRedo = useSelector((state: GraphState) => state.future.length > 0);
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const measureNodes = useCallback((changes: NodeChangeset) => {
    const dimensions = changes.getByType('dimensions');
    if (!dimensions.length) return;
    setMeasurements(previous => {
      const next = { ...previous }; let changed = false;
      for (const change of dimensions) if (change.dimensions && (previous[change.id]?.width !== change.dimensions.width || previous[change.id]?.height !== change.dimensions.height)) {
        next[change.id] = change.dimensions; changed = true;
      }
      return changed ? next : previous;
    });
  }, []);
  const [mode, setMode] = useState<'view' | 'graph' | 'dispatcher'>('view');
  const editing = mode === 'graph';
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('select');
  const [drawingColor, setDrawingColor] = useState('#875dc7');
  const [drawingWidth, setDrawingWidth] = useState(4);
  const [eraserSize, setEraserSize] = useState(24);
  const [manualSelected, setSelected] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [hoveredObject, setHoveredObject] = useState<string | null>(null);
  const [eventResource, setEventResource] = useState<Resource | null>(null);
  const [replaceManualRoutes, setReplaceManualRoutes] = useState(false);
  const [selectionMode, setSelectionMode] = useState('');
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [dragPositions, setDragPositions] = useState<Record<string, Point>>({});
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [noteText, setNoteText] = useState('');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'water' | 'energy'>('all');
  // Обновление топологии пересчитывает выделение, не сбрасывая выбор пользователя.
  const selected = useMemo(() => {
    const object = data.objects.find(item => item.id === focused);
    if (object && selectionMode.startsWith('Район:')) return prefs.groups.find(group => group.members.includes(object.id))?.members ?? [object.id];
    if (object && (selectionMode === 'Объект и все зависимые' || selectionMode.startsWith('Событие:'))) {
      const resource = eventResource ?? (selectionFilter === 'all' ? null : selectionFilter);
      return [...descendants(object.id, resource ? data.dependencies.filter(edge => edge.resource === resource) : data.dependencies)];
    }
    return manualSelected.filter(id => data.objects.some(item => item.id === id));
  }, [data, prefs.groups, focused, manualSelected, selectionMode, eventResource, selectionFilter]);
  const visible = useMemo(() => visibleObjects(data, prefs), [data, prefs]);
  const visibleIds = useMemo(() => new Set(visible.map(item => item.id)), [visible]);
  const highlighted = useMemo(() => new Set(selected), [selected]);
  const position = useCallback((id: string) => dragPositions[id] ?? prefs.positions[id] ?? { x: 0, y: 0 }, [dragPositions, prefs.positions]);
  const routeUpdate = useCallback((id: string, points: Point[]) => {
    dispatch(graphActions.edit({ routes: { ...prefs.routes, [id]: points }, manualRouteIds: [...new Set([...(prefs.manualRouteIds ?? []), id])] }));
  }, [dispatch, prefs.routes, prefs.manualRouteIds]);
  const indices = useMemo(() => dependencyIndices(data), [data]);
  const districtFor = useMemo(() => new Map(prefs.groups.flatMap(group => group.members.map(id => [id, group] as const))), [prefs.groups]);
  const collapsedIds = useMemo(() => new Set(prefs.groups.filter(group => group.collapsed).flatMap(group => group.members)), [prefs.groups]);
  const impact = useMemo(() => incidentImpact(data, data.currentEvents), [data]);
  const activeSources = useMemo(() => data.objects.flatMap(item => item.resources.filter(resource => item.states[resource] === 'incident').map(resource => ({ id: item.id, resource }))), [data]);
  const activeZone = useMemo(() => influenceZone(activeSources, data.dependencies), [activeSources, data.dependencies]);
  const hoveredSources = useMemo(() => {
    if (!hoveredObject) return [];
    const group = prefs.groups.find(item => item.id === hoveredObject);
    const members = group ? group.members : [hoveredObject];
    return data.objects.filter(item => members.includes(item.id)).flatMap(item => item.resources.map(resource => ({ id: item.id, resource })));
  }, [hoveredObject, prefs.groups, data.objects]);
  const hoveredZone = useMemo(() => influenceZone(hoveredSources, data.dependencies), [hoveredSources, data.dependencies]);
  const influenceKind = useCallback((id: string) => activeZone.nodes.has(id) ? 'active' as const : hoveredZone.nodes.has(id) ? 'hover' as const : null, [activeZone, hoveredZone]);
  const toggleGroup = useCallback((id: string) => dispatch(graphActions.edit({ groups: prefs.groups.map(group => group.id === id ? { ...group, collapsed: !group.collapsed } : group) })), [dispatch, prefs.groups]);
  const nodes = useMemo<Node[]>(() => {
    const groups: Node[] = prefs.groups.flatMap(group => {
      const members = group.members.filter(id => visibleIds.has(id));
      if (!members.length) return [];
      const points = members.map(position);
      const objects = visible.filter(item => members.includes(item.id));
      const resources = [...new Set(objects.flatMap(item => item.resources))];
      const states = objects.map(item => objectState(item, prefs.filters.resource));
      const state = states.includes('incident') ? 'incident' : states.includes('maintenance') ? 'maintenance' : states.includes('unknown') ? 'unknown' : 'normal';
      const resourceStates = Object.fromEntries(resources.map(resource => {
        const values = objects.filter(item => item.resources.includes(resource)).map(item => item.states[resource] ?? 'unknown');
        return [resource, values.includes('incident') ? 'incident' : values.includes('maintenance') ? 'maintenance' : values.includes('unknown') ? 'unknown' : 'normal'];
      })) as Partial<Record<Resource, ObjectState>>;
      const x = Math.min(...points.map(p => p.x)) - 24, y = Math.min(...points.map(p => p.y)) - 40;
      return [{ id: group.id, type: 'group', position: { x, y },
        data: { label: `${group.name} · ${members.length}`, collapsed: !!group.collapsed, resources, resourceStates, state, highlighted: members.some(id => highlighted.has(id)), influence: members.map(influenceKind).includes('active') ? 'active' as const : members.map(influenceKind).includes('hover') ? 'hover' as const : null, onHover: setHoveredObject, toggle: () => toggleGroup(group.id) },
        style: { width: group.collapsed ? NODE_WIDTH : Math.max(...points.map(p => p.x)) + NODE_WIDTH + 24 - x,
          height: group.collapsed ? NODE_HEIGHT : Math.max(...points.map(p => p.y)) + NODE_HEIGHT + 24 - y },
        draggable: editing, dragHandle: group.collapsed ? '.collapsed-district' : '.map-group-label', selectable: false,
        zIndex: group.collapsed ? 0 : -1, className: group.collapsed ? 'district-proxy' : 'infrastructure-group' }];
    });
    return [...groups, ...visible.filter(item => !collapsedIds.has(item.id)).map(item => ({ id: item.id, type: 'object', position: position(item.id),
      data: { item, incidents: impact.byObject[item.id], affectedCount: impact.counts[item.id], resource: prefs.filters.resource, highlighted: highlighted.has(item.id), influence: influenceKind(item.id), onHover: setHoveredObject, index: indices[item.id].index, dependentCount: indices[item.id].count, districtName: districtFor.get(item.id)?.name },
      width: NODE_WIDTH, height: NODE_HEIGHT, draggable: editing, selectable: false,
      className: highlighted.has(item.id) ? 'graph-selected' : '',
    })), ...prefs.annotations.map(annotation => {
      const bounds = annotationBounds(annotation);
      return { id: annotation.id, type: 'annotation', position: { x: bounds.x, y: bounds.y }, data: {},
        width: bounds.width, height: bounds.height, style: { width: bounds.width, height: bounds.height, pointerEvents: 'none' as const },
        draggable: false, selectable: false, className: 'annotation-proxy' };
    })].map(node => ({ ...node, measured: measurements[node.id] }));
  }, [measurements, prefs, visible, visibleIds, position, highlighted, editing, indices, districtFor, collapsedIds, toggleGroup, influenceKind, impact]);
  const edges = useMemo<MapEdge[]>(() => projectedDependencies(data.dependencies, prefs.groups, visibleIds).filter(edge =>
    !prefs.filters.resource || edge.resource === prefs.filters.resource).map((edge, _index, shown) => {
    const peers = shown.filter(other => other.source === edge.source && other.target === edge.target);
    const parallel = peers.length > 1 && edge.projected;
    const source = nodes.find(node => node.id === edge.source)!, target = nodes.find(node => node.id === edge.target)!;
    const offset = parallel ? (peers.findIndex(other => other.id === edge.id) - (peers.length - 1) / 2) * 36 : 0;
    const points = edge.projected ? (parallel ? [{ x: (source.position.x + NODE_WIDTH + target.position.x) / 2, y: (source.position.y + target.position.y + NODE_HEIGHT) / 2 + offset }] : []) : prefs.routes[edge.id] ?? [];
    const original = data.dependencies.find(other => other.id === edge.id)!;
    return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: 'out', targetHandle: 'in', type: 'routed',
      selected: selectedEdge === edge.id, reconnectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24, color: edge.resource === 'water' ? '#0284c7' : '#b77908' },
      style: { stroke: edge.resource === 'water' ? '#0284c7' : '#b77908',
        opacity: selected.length && !(highlighted.has(original.source) && highlighted.has(original.target)) ? 0.2 : 0.9 },
      data: { points, resource: edge.resource, routeStyle: prefs.routeStyle ?? 'rounded', editing: editing && !edge.projected,
        influence: activeZone.edges.has(original.id) ? 'active' as const : hoveredZone.edges.has(original.id) ? 'hover' as const : null,
        update: routeUpdate },
    };
  }), [data, visibleIds, prefs, selectedEdge, selected, highlighted, editing, routeUpdate, nodes, activeZone, hoveredZone]);
  const focusedObject = data.objects.find(item => item.id === focused);
  const matches = query.trim() ? data.objects.filter(item => `${item.name} ${item.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 20) : [];
  const setFilter = (patch: Partial<typeof prefs.filters>) => dispatch(graphActions.edit({ filters: { ...prefs.filters, ...patch } }));
  const clickNode: NodeMouseHandler = (event, node) => {
    if (node.type === 'group') { const group = prefs.groups.find(group => group.id === node.id); if (group) { setSelected(group.members); setFocused(null); setSelectionMode('Ручное выделение'); } return; }
    const item = data.objects.find(item => item.id === node.id);
    if (!item) return;
    setFocused(item.id); setEventResource(null); setSelectedEdge(null); setSelectedAnnotation(null);
    if (event.ctrlKey || event.metaKey) {
      const group = districtFor.get(item.id);
      setSelected(group?.members ?? [item.id]); setSelectionMode(`Район: ${group?.name ?? 'Без района'}`);
    } else if (event.shiftKey) {
      setSelected(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id]); setSelectionMode('Ручное выделение');
    } else {
      const links = selectionFilter === 'all' ? data.dependencies : data.dependencies.filter(edge => edge.resource === selectionFilter);
      setSelected([...descendants(item.id, links)]); setSelectionMode('Объект и все зависимые');
    }
  };
  const autoLayout = async () => {
    if (!window.confirm('Заново расположить все объекты и маршруты? Группы и пометки сохранятся. Действие можно отменить.')) return;
    setLayoutBusy(true);
    try {
      const layout = await layoutGraph(data);
      const manual = new Set(prefs.manualRouteIds ?? []);
      const carried = moveRoutes(prefs.routes, data.dependencies, prefs.positions, layout.positions);
      const routes = replaceManualRoutes ? layout.routes : { ...layout.routes, ...Object.fromEntries(Object.entries(carried).filter(([id]) => manual.has(id))) };
      dispatch(graphActions.edit({ ...layout, routes, manualRouteIds: replaceManualRoutes ? [] : prefs.manualRouteIds })); setNotice('Автораскладка применена'); setTimeout(() => void flow.fitView({ padding: 0.15 }), 60); }
    catch { setNotice('Не удалось рассчитать расположение. Ваши настройки сохранены.'); }
    finally { setLayoutBusy(false); }
  };
  const focusSearch = (item: InfrastructureObject) => {
    if (!visibleIds.has(item.id) || collapsedIds.has(item.id)) {
      dispatch(graphActions.edit({ hidden: prefs.hidden.filter(id => id !== item.id), filters: defaultPreferences().filters, groups: prefs.groups.map(group => group.members.includes(item.id) ? { ...group, collapsed: false } : group) }));
      setNotice('Фильтры сброшены, найденный объект показан');
    }
    const p = position(item.id);
    void flow.setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2, { zoom: 1, duration: 350 });
    setFocused(item.id); setEventResource(null); setSelected([item.id]); setSelectionMode('Результат поиска'); setQuery('');
  };
  const dragStop: OnNodeDrag = (_event, node) => {
    if (node.type === 'group') {
      const group = prefs.groups.find(group => group.id === node.id);
      if (group) dispatch(graphActions.edit({ positions: { ...prefs.positions, ...dragPositions },
        routes: moveRoutes(prefs.routes, data.dependencies, prefs.positions, dragPositions) }));
    } else dispatch(graphActions.edit({ positions: { ...prefs.positions, [node.id]: node.position },
      routes: moveRoutes(prefs.routes, data.dependencies, prefs.positions, { [node.id]: node.position }) }));
    setDragPositions({});
  };
  const addPoint = (edgeId: string, point: Point) => {
    const edge = data.dependencies.find(edge => edge.id === edgeId)!;
    const start = position(edge.source), end = position(edge.target);
    const points = prefs.routes[edgeId] ?? [];
    const path = [{ x: start.x + NODE_WIDTH, y: start.y + NODE_HEIGHT / 2 }, ...points, { x: end.x, y: end.y + NODE_HEIGHT / 2 }];
    let best = 0, distance = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
      if (d < distance) { best = i; distance = d; }
    }
    routeUpdate(edgeId, [...points.slice(0, best), point, ...points.slice(best)]);
  };
  const selectEvent = (event: CurrentEvent) => {
    const item = data.objects.find(item => item.id === event.objectId);
    if (!item) return;
    if (!visibleIds.has(item.id) || collapsedIds.has(item.id)) {
      dispatch(graphActions.edit({ hidden: prefs.hidden.filter(id => id !== item.id), filters: defaultPreferences().filters, groups: prefs.groups.map(group => group.members.includes(item.id) ? { ...group, collapsed: false } : group) }));
      setNotice('Фильтры сброшены, объект выбранного события показан');
    }
    setFocused(item.id); setEventResource(event.resource); setSelectedEdge(null); setSelectedAnnotation(null);
    setSelected([...descendants(item.id, data.dependencies.filter(edge => edge.resource === event.resource))]);
    setSelectionMode(`Событие: ${resourceNames[event.resource]} · объект и зависимые`);
    const p = position(item.id);
    void flow.setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2, { zoom: 1, duration: 300 });
  };
  return <section className="graph-page">
    <div className="graph-heading">
      <div className="graph-modes" role="group" aria-label="Режим работы">{([['view', 'Просмотр'], ['graph', 'Редактирование графа'], ['dispatcher', 'Инструменты диспетчера']] as const).map(([value, title]) =>
        <button key={value} aria-pressed={mode === value} className={mode === value ? 'btn-primary' : ''} onClick={() => { setMode(value); setSelectedAnnotation(null); setSelectedEdge(null); }}>{title}</button>)}</div>
      <div className="graph-summary"><strong>{visible.length} / {data.objects.length}</strong><span>объектов · {edges.length} связей</span></div>
    </div>
    <div className="graph-sync" role="status">
      <span>{data.legacyDemo ? 'Демонстрационные события · подключение БД ещё не выполнено' : data.sourceStatus === 'online' ? 'Источник доступен' : 'Источник недоступен · последний сохранённый снимок'}</span>
      <span>Снимок: {new Date(data.asOf).toLocaleString('ru-RU')} · Синхронизация: {data.syncedAt ? new Date(data.syncedAt).toLocaleString('ru-RU') : 'нет данных'}</span>
      <small>Опрос каждые 5 с · Получен: {receivedAt ? new Date(receivedAt).toLocaleTimeString('ru-RU') : '—'}</small>
    </div>
    {refreshError && <p role="alert">{refreshError}</p>}
    {storageWarning && <p role="alert">{storageWarning}</p>}
    <div className="graph-toolbar">
      <label>Ресурс<select aria-label="Ресурс" value={prefs.filters.resource} onChange={e => setFilter({ resource: e.target.value as Resource | '' })}><option value="">Все ресурсы</option>{Object.entries(resourceNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>Состояние<select aria-label="Состояние объекта" value={prefs.filters.state} onChange={e => setFilter({ state: e.target.value as ObjectState | '' })}><option value="">Все состояния</option>{Object.entries(stateNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>Район<select aria-label="Район" value={prefs.filters.district} onChange={e => setFilter({ district: e.target.value })}><option value="">Все районы</option>{prefs.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="graph-check"><input type="checkbox" checked={prefs.filters.incidentsOnly} onChange={e => setFilter({ incidentsOnly: e.target.checked })} />Только с авариями</label>
      <button onClick={() => dispatch(graphActions.edit({ filters: defaultPreferences().filters, hidden: [] }))}>Сбросить фильтры / показать все</button>
      <div className="graph-search"><label>Найти объект<input type="search" aria-label="Найти объект" placeholder="Название или адрес…" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {query && <div className="graph-search-results">{matches.length ? matches.map(item => <button key={item.id} onClick={() => focusSearch(item)}><strong>{item.name}</strong><small>{item.address}{!visibleIds.has(item.id) ? ' · скрыт' : ''}</small></button>) : <p>Ничего не найдено</p>}</div>}</div>
    </div>
    <div className="graph-workspace"><aside className="graph-sidebar">
      <div className="graph-panel"><h2>Управление</h2><p>Щелчок — все зависимые объекты. Ctrl / ⌘ + щелчок — район. Shift + щелчок — добавить или убрать объект.</p>
        <label>Зависимости<select aria-label="Ресурс зависимостей" value={selectionFilter} onChange={e => setSelectionFilter(e.target.value as typeof selectionFilter)}><option value="all">Все ресурсы</option><option value="water">Вода</option><option value="energy">Электроэнергия</option></select></label>
        <button onClick={() => void flow.fitView({ padding: 0.12, duration: 300 })}>Вписать схему</button>
        <div className="graph-button-row"><button disabled={!canUndo} onClick={() => dispatch(graphActions.undo())}>Отменить</button><button disabled={!canRedo} onClick={() => dispatch(graphActions.redo())}>Повторить</button></div>
      </div>
      <div className="graph-panel"><h2>Выделение · {selected.length}</h2><p>{selectionMode || 'Выберите объект на схеме'}</p><small>{selected.filter(id => visibleIds.has(id)).length} видимых · зависимости считаются по полному графу</small>
        <button disabled={!selected.length} onClick={() => { dispatch(graphActions.edit({ hidden: [...new Set([...prefs.hidden, ...selected])] })); setSelected([]); setFocused(null); setEventResource(null); setSelectionMode(''); }}>Скрыть выделенное</button>
        <button disabled={!selected.length} onClick={() => { setSelected([]); setFocused(null); setEventResource(null); }}>Снять выделение</button>
      </div>
      {editing && <div className="graph-panel"><h2>Редактор схемы</h2><p>Перетаскивайте объекты. Выберите стрелку; двойной щелчок по ней добавляет точку маршрута. Точки можно перемещать и удалять двойным щелчком.</p>
        <button disabled={layoutBusy} onClick={() => void autoLayout()}>{layoutBusy ? 'Расчёт…' : 'Автораскладка'}</button>
        <label>Вид связей<select aria-label="Вид связей" value={prefs.routeStyle ?? 'rounded'} onChange={e => dispatch(graphActions.edit({ routeStyle: e.target.value as 'rounded' | 'polyline' }))}><option value="rounded">Плавные изгибы</option><option value="polyline">Ломаные линии</option></select></label>
        <label className="graph-check"><input type="checkbox" checked={replaceManualRoutes} onChange={e => setReplaceManualRoutes(e.target.checked)} />Заменить ручные маршруты при автораскладке</label>
        <button disabled={!selectedEdge || !edges.find(edge => edge.id === selectedEdge)?.data?.editing} onClick={() => { if (selectedEdge) routeUpdate(selectedEdge, []); }}>Выпрямить выбранную связь</button>
        <label>Название района<input value={groupName} maxLength={100} onChange={e => setGroupName(e.target.value)} placeholder="Например, Северный узел" /></label>
        <button disabled={!selected.length || !groupName.trim()} onClick={() => {
          dispatch(graphActions.edit({ groups: assignGroup(prefs.groups, { id: newMapId('group'), name: groupName.trim(), members: selected }) })); setGroupName('');
        }}>Создать район из выделенного</button>
      </div>}
      <div className="graph-panel"><h2>Районы · {prefs.groups.length}</h2>
        {!prefs.groups.length && <p>Создавайте районы из выделенных объектов в режиме редактирования графа.</p>}
        {prefs.groups.map(group => <div className="graph-group-entry" key={group.id}><span>{group.name} ({group.members.length})</span>
          <button aria-label={`${group.collapsed ? 'Развернуть' : 'Свернуть'} район ${group.name}`} onClick={() => toggleGroup(group.id)}>{group.collapsed ? '▣' : '⊟'}</button>
          {editing && <button aria-label={`Разгруппировать ${group.name}`} onClick={() => dispatch(graphActions.edit({ groups: prefs.groups.filter(g => g.id !== group.id), filters: { ...prefs.filters, district: prefs.filters.district === group.id ? '' : prefs.filters.district } }))}>×</button>}</div>)}
      </div>
      {mode === 'dispatcher' && <div className="graph-panel dispatcher-tools"><h2>Инструменты диспетчера</h2>
        <p>Пометки полупрозрачны. Выберите инструмент и рисуйте на карте. Инструмент перемещения позволяет сдвигать карту без выхода из режима.</p>
        <div className="drawing-tools">{([['pan', 'Перемещение карты'], ['select', 'Выбор / перемещение'], ['freehand', 'Произвольная кривая'], ['line', 'Прямая'], ['rectangle', 'Прямоугольник'], ['text', 'Подпись'], ['erase', 'Ластик: целая пометка'], ['erase-part', 'Ластик: часть пометки']] as const).map(([value, title]) =>
          <button key={value} aria-pressed={drawingTool === value} onClick={() => setDrawingTool(value)}>{title}</button>)}</div>
        <label>Цвет пометки<input type="color" aria-label="Цвет пометки" value={drawingColor} onChange={e => setDrawingColor(e.target.value)} /></label>
        <label>Толщина линии: {drawingWidth}<input type="range" aria-label="Толщина линии" min="1" max="20" value={drawingWidth} onChange={e => setDrawingWidth(Number(e.target.value))} /></label>
        <label>Размер ластика: {eraserSize}<input type="range" aria-label="Размер ластика" min="8" max="100" value={eraserSize} onChange={e => setEraserSize(Number(e.target.value))} /></label>
        <label>Подпись<textarea aria-label="Текст подписи" value={noteText} maxLength={500} onChange={e => setNoteText(e.target.value)} placeholder="Текст пометки" /></label>
        <button disabled={!selectedAnnotation} onClick={() => dispatch(graphActions.edit({ annotations: prefs.annotations.map(a => a.id === selectedAnnotation ? { ...a, color: drawingColor, width: drawingWidth, ...(a.kind === 'text' ? { text: noteText.trim() || a.text } : {}) } : a) }))}>Применить к выбранной пометке</button>
        <button disabled={!selectedAnnotation} onClick={() => { dispatch(graphActions.edit({ annotations: prefs.annotations.filter(a => a.id !== selectedAnnotation) })); setSelectedAnnotation(null); }}>Удалить пометку</button>
      </div>}
      {focusedObject && <div className="graph-panel object-details"><h2>{focusedObject.name}</h2><p>{focusedObject.address}</p><p>{focusedObject.description}</p>
        {focusedObject.resources.map(resource => {
          const entry = impact.byObject[focusedObject.id]?.[resource];
          return <div key={resource}><strong>{resourceNames[resource]}</strong><span className={`object-state ${entry?.own ? 'incident' : entry ? 'affected' : focusedObject.states[resource]}`}>{entry?.own ? 'Авария' : entry ? 'Под влиянием аварии' : stateNames[focusedObject.states[resource] ?? 'unknown']}</span>
            {entry && <><IncidentDuration since={entry.since} /><small>Источники: {entry.origins.map(event => data.objects.find(item => item.id === event.objectId)?.name ?? event.objectId).join(', ')}</small></>}
          </div>;
        })}
        <small>Индекс: {indices[focusedObject.id].index} / 10 · Всего зависимых: {indices[focusedObject.id].count}</small><small>ID: {focusedObject.id}</small><small>Прямых зависимых: {data.dependencies.filter(e => e.source === focusedObject.id).length}</small>
        <a className="archive-object-link" href={`/events/archive?objectId=${encodeURIComponent(focusedObject.id)}`} target="_blank" rel="noreferrer">Все события объекта ↗</a>
      </div>}
    </aside><div className="graph-canvas" ref={canvas} data-testid="graph-canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        defaultViewport={prefs.viewport} fitView={!prefs.viewport} minZoom={0.08} maxZoom={2.5}
        nodesConnectable={false} edgesReconnectable={false} nodesDraggable={editing}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} selectionOnDrag={false}
        panOnDrag={mode !== 'dispatcher' || drawingTool === 'pan'} panOnScroll zoomOnDoubleClick={false}
        onNodesChange={measureNodes} onNodeClick={clickNode} onNodeDrag={(_e, node) => {
          const group = prefs.groups.find(group => group.id === node.id);
          if (group) {
            const shown = group.members.filter(id => visibleIds.has(id));
            const origin = { x: Math.min(...shown.map(id => prefs.positions[id].x)) - 24,
              y: Math.min(...shown.map(id => prefs.positions[id].y)) - 40 };
            const delta = { x: node.position.x - origin.x, y: node.position.y - origin.y };
            setDragPositions(Object.fromEntries(group.members.filter(id => prefs.positions[id]).map(id => [id,
              { x: prefs.positions[id].x + delta.x, y: prefs.positions[id].y + delta.y }])));
          } else setDragPositions({ [node.id]: node.position });
        }} onNodeDragStop={dragStop}
        onMoveEnd={(_e, viewport) => dispatch(graphActions.viewport(viewport))}
        onEdgeClick={(_e, edge) => { setSelectedEdge(edge.id); setSelectedAnnotation(null); }}
        onEdgeDoubleClick={(event, edge) => { if (editing && !collapsedIds.has(data.dependencies.find(e => e.id === edge.id)!.source) && !collapsedIds.has(data.dependencies.find(e => e.id === edge.id)!.target)) { setSelectedEdge(edge.id); addPoint(edge.id, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); } }}
        onPaneClick={() => { setSelectedEdge(null); setSelectedAnnotation(null); }}>
        <DispatcherLayer annotations={prefs.annotations} active={mode === 'dispatcher'} tool={drawingTool} color={drawingColor} width={drawingWidth} eraserSize={eraserSize} text={noteText}
          selected={selectedAnnotation} onSelect={id => { setSelectedAnnotation(id); const note = prefs.annotations.find(a => a.id === id); if (note?.kind === 'text') setNoteText(note.text); }}
          onChange={annotations => dispatch(graphActions.edit({ annotations }))} />
        <Background gap={24} color="#bdc9d9" /><MiniMap ariaLabel="Мини-карта объектов" pannable zoomable nodeColor={node => {
          const item = data.objects.find(item => item.id === node.id);
          return node.type === 'annotation' ? '#b49ad8' : item && item.resources.some(r => (!prefs.filters.resource || r === prefs.filters.resource) && impact.byObject[item.id]?.[r] && !impact.byObject[item.id]?.[r]?.own) && objectState(item, prefs.filters.resource) !== 'incident' ? '#ea580c' : item ? ({ normal: '#159777', maintenance: '#d99116', incident: '#db4555', unknown: '#94a3b8' })[objectState(item, prefs.filters.resource)] : '#cbd5e1';
        }} /><Controls showInteractive={false} showZoom={false} showFitView={false} aria-label="Масштаб карты">
          <ControlButton title="Приблизить" aria-label="Приблизить" onClick={() => void flow.zoomIn()}>+</ControlButton>
          <ControlButton title="Отдалить" aria-label="Отдалить" onClick={() => void flow.zoomOut()}>−</ControlButton>
          <ControlButton title="Вписать всю схему" aria-label="Вписать всю схему" onClick={() => void flow.fitView({ padding: 0.12 })}>⛶</ControlButton>
        </Controls>
      </ReactFlow>
      {!visible.length && <div className="graph-empty">Нет объектов по выбранным условиям. Измените фильтры или покажите скрытые объекты.</div>}
      <div className="graph-legend"><span>✓ Норма</span><span>◆ Ремонтные работы</span><span>! Авария</span><span className="affected-legend">↳ Под влиянием аварии</span><span>? Нет данных</span><span className="water">━ Вода</span><span className="energy">━ Электроэнергия</span></div>
    </div><EventsPanel data={data} focused={focusedObject?.id ?? null} resource={eventResource}
      visibleIds={visibleIds} districtNames={new Map([...districtFor].map(([id, group]) => [id, group.name]))} onSelect={selectEvent} /></div>
    <div className="graph-footer">{notice && <span role="status">{notice}</span>}<a href="/licenses/graph.txt" target="_blank" rel="noreferrer">Лицензии</a></div>
  </section>;
}
