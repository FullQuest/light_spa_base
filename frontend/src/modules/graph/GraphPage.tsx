import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { Background, ControlButton, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Node, NodeMouseHandler, OnNodeDrag } from '@xyflow/react';
import { useAuth } from '../../auth/auth';
import { authRequest } from '../../auth/api';
import { createGraphStore, defaultPreferences, graphActions, loadPreferences, savePreferences } from './store';
import type { GraphState, GraphStore } from './store';
import { descendants, newMapId, objectState, resourceNames, stateNames, visibleObjects } from './types';
import type { Annotation, GraphData, InfrastructureObject, ObjectState, Point, Resource } from './types';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { ObjectNode, AnnotationNode, GroupNode, RoutedEdge } from './GraphElements';
import type { MapEdge } from './GraphElements';
import '@xyflow/react/dist/style.css';
import './graph.css';

const nodeTypes = { object: ObjectNode, annotation: AnnotationNode, group: GroupNode };
const edgeTypes = { routed: RoutedEdge };

export function GraphPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [loaded, setLoaded] = useState<{ data: GraphData; store: GraphStore; key: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [storageWarning, setStorageWarning] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await authRequest<GraphData>('/graph');
        const key = `user-${userId}`;
        const preferences = await loadPreferences(key).catch(() => {
          if (active) setStorageWarning('Хранилище браузера недоступно. Изменения сохраняются только до закрытия страницы.');
          return defaultPreferences();
        });
        const missing = data.objects.some(item => !preferences.positions[item.id]);
        if (missing) {
          const layout = await layoutGraph(data);
          preferences.positions = { ...layout.positions, ...preferences.positions };
          preferences.routes = { ...layout.routes, ...preferences.routes };
        }
        if (active) { setLoaded({ data, key, store: createGraphStore(preferences) }); setError(''); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message || 'Не удалось загрузить граф' : 'Не удалось загрузить граф'); }
    }
    void load();
    return () => { active = false; };
  }, [userId, attempt]);
  useEffect(() => {
    if (!loaded) return;
    let timer: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void savePreferences(loaded.key, loaded.store.getState().present).catch(() =>
        setStorageWarning('Не удалось сохранить настройки в браузере. Проверьте свободное место и разрешения хранилища.')); }, 250);
    };
    save();
    const unsubscribe = loaded.store.subscribe(save);
    return () => { clearTimeout(timer); unsubscribe(); void savePreferences(loaded.key, loaded.store.getState().present).catch(() => {}); };
  }, [loaded]);
  if (error) return <section><h1>Граф объектов</h1><p role="alert">{error}</p><button onClick={() => setAttempt(a => a + 1)}>Повторить</button></section>;
  if (!loaded) return <section><h1>Граф объектов</h1><p role="status">Загрузка объектов и расчёт схемы…</p></section>;
  return <Provider store={loaded.store}><ReactFlowProvider><GraphCanvas data={loaded.data} storageWarning={storageWarning} /></ReactFlowProvider></Provider>;
}

function GraphCanvas({ data, storageWarning }: { data: GraphData; storageWarning: string }) {
  const dispatch = useDispatch<GraphStore['dispatch']>();
  const prefs = useSelector((state: GraphState) => state.present);
  const canUndo = useSelector((state: GraphState) => state.past.length > 0);
  const canRedo = useSelector((state: GraphState) => state.future.length > 0);
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState('');
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [dragPositions, setDragPositions] = useState<Record<string, Point>>({});
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [noteText, setNoteText] = useState('');
  const [placement, setPlacement] = useState<'text' | 'line' | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'water' | 'energy'>('all');
  const visible = useMemo(() => visibleObjects(data, prefs), [data, prefs]);
  const visibleIds = useMemo(() => new Set(visible.map(item => item.id)), [visible]);
  const highlighted = useMemo(() => new Set(selected), [selected]);
  const position = useCallback((id: string) => dragPositions[id] ?? prefs.positions[id] ?? { x: 0, y: 0 }, [dragPositions, prefs.positions]);
  const routeUpdate = useCallback((id: string, points: Point[]) => {
    dispatch(graphActions.edit({ routes: { ...prefs.routes, [id]: points } }));
  }, [dispatch, prefs.routes]);
  const endUpdate = useCallback((id: string, end: Point) => {
    dispatch(graphActions.edit({ annotations: prefs.annotations.map(a => a.id === id ? { ...a, end } : a) }));
  }, [dispatch, prefs.annotations]);
  const nodes = useMemo<Node[]>(() => {
    const groups: Node[] = prefs.groups.flatMap(group => {
      const members = group.members.filter(id => visibleIds.has(id));
      if (!members.length) return [];
      const points = members.map(position);
      const x = Math.min(...points.map(p => p.x)) - 24, y = Math.min(...points.map(p => p.y)) - 40;
      return [{ id: group.id, type: 'group', position: { x, y }, data: { label: `${group.name} · ${members.length}` },
        style: { width: Math.max(...points.map(p => p.x)) + NODE_WIDTH + 24 - x,
          height: Math.max(...points.map(p => p.y)) + NODE_HEIGHT + 24 - y },
        draggable: editing && !placement, dragHandle: '.map-group-label', selectable: false, zIndex: -1, className: 'infrastructure-group' }];
    });
    return [...groups, ...visible.map(item => ({ id: item.id, type: 'object', position: position(item.id),
      data: { item, resource: prefs.filters.resource, highlighted: highlighted.has(item.id) },
      width: NODE_WIDTH, height: NODE_HEIGHT, draggable: editing && !placement, selectable: false,
      className: highlighted.has(item.id) ? 'graph-selected' : '',
    })), ...prefs.annotations.map(annotation => ({ id: annotation.id, type: 'annotation', position: dragPositions[annotation.id] ?? annotation.position,
      data: { annotation, editing, updateEnd: endUpdate }, draggable: editing && !placement, selectable: false,
      zIndex: 10, className: selectedAnnotation === annotation.id ? 'annotation-selected' : '',
    }))];
  }, [prefs, visible, visibleIds, position, highlighted, editing, placement, endUpdate, selectedAnnotation, dragPositions]);
  const edges = useMemo<MapEdge[]>(() => data.dependencies.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target) &&
    (!prefs.filters.resource || edge.resource === prefs.filters.resource)).map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: 'out', targetHandle: 'in', type: 'routed',
    selected: selectedEdge === edge.id, reconnectable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.resource === 'water' ? '#0284c7' : '#b77908' },
    style: { stroke: edge.resource === 'water' ? '#0284c7' : '#b77908',
      opacity: selected.length && !(highlighted.has(edge.source) && highlighted.has(edge.target)) ? 0.2 : 0.9 },
    data: { points: prefs.routes[edge.id] ?? [], resource: edge.resource, editing, update: routeUpdate },
  })), [data, visibleIds, prefs, selectedEdge, selected, highlighted, editing, routeUpdate]);
  const focusedObject = data.objects.find(item => item.id === focused);
  const matches = query.trim() ? data.objects.filter(item => `${item.name} ${item.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 20) : [];
  const setFilter = (patch: Partial<typeof prefs.filters>) => dispatch(graphActions.edit({ filters: { ...prefs.filters, ...patch } }));
  const clickNode: NodeMouseHandler = (event, node) => {
    if (node.type === 'annotation') { setSelectedAnnotation(node.id); setSelectedEdge(null); const a = prefs.annotations.find(a => a.id === node.id); if (a?.kind === 'text') setNoteText(a.text); return; }
    const item = data.objects.find(item => item.id === node.id);
    if (!item) return;
    setFocused(item.id); setSelectedEdge(null); setSelectedAnnotation(null);
    if (event.ctrlKey || event.metaKey) {
      setSelected(data.objects.filter(other => other.district === item.district).map(other => other.id)); setSelectionMode(`Район: ${item.district}`);
    } else if (event.shiftKey) {
      setSelected(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id]); setSelectionMode('Ручное выделение');
    } else {
      const links = selectionFilter === 'all' ? data.dependencies : data.dependencies.filter(edge => edge.resource === selectionFilter);
      setSelected([...descendants(item.id, links)]); setSelectionMode('Объект и все зависимые');
    }
  };
  const autoLayout = async () => {
    if (!window.confirm('Заново расположить все объекты и маршруты? Группы и пометки сохранятся. Действие можно отменить.')) return;
    setLayoutBusy(true);
    try { dispatch(graphActions.edit(await layoutGraph(data))); setNotice('Автораскладка применена'); setTimeout(() => void flow.fitView({ padding: 0.15 }), 60); }
    catch { setNotice('Не удалось рассчитать расположение. Ваши настройки сохранены.'); }
    finally { setLayoutBusy(false); }
  };
  const focusSearch = (item: InfrastructureObject) => {
    if (!visibleIds.has(item.id)) {
      dispatch(graphActions.edit({ hidden: prefs.hidden.filter(id => id !== item.id), filters: defaultPreferences().filters }));
      setNotice('Фильтры сброшены, найденный объект показан');
    }
    const p = position(item.id);
    void flow.setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2, { zoom: 1, duration: 350 });
    setFocused(item.id); setSelected([item.id]); setSelectionMode('Результат поиска'); setQuery('');
  };
  const dragStop: OnNodeDrag = (_event, node) => {
    if (node.type === 'group') {
      const group = prefs.groups.find(group => group.id === node.id);
      const id = group?.members.find(id => dragPositions[id] && prefs.positions[id]);
      const routes = { ...prefs.routes };
      if (id && group) {
        const dx = dragPositions[id].x - prefs.positions[id].x, dy = dragPositions[id].y - prefs.positions[id].y;
        for (const edge of data.dependencies) if (group.members.includes(edge.source) && group.members.includes(edge.target)) {
          routes[edge.id] = (routes[edge.id] ?? []).map(point => ({ x: point.x + dx, y: point.y + dy }));
        }
      }
      dispatch(graphActions.edit({ positions: { ...prefs.positions, ...dragPositions }, routes }));
    }
    else if (node.type === 'annotation') dispatch(graphActions.edit({ annotations: prefs.annotations.map(a => a.id === node.id ? { ...a, position: node.position } : a) }));
    else dispatch(graphActions.edit({ positions: { ...prefs.positions, [node.id]: node.position } }));
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
  return <section className="graph-page">
    <div className="graph-heading"><div><p className="graph-eyebrow">ИНФРАСТРУКТУРА · ДЕМО</p><h1>Граф объектов</h1></div>
      <div className="graph-summary"><strong>{visible.length} / {data.objects.length}</strong><span>объектов · {edges.length} связей</span></div>
      <button className={editing ? 'btn-primary' : ''} aria-pressed={editing} onClick={() => { setEditing(!editing); setPlacement(null); }}> {editing ? 'Завершить редактирование' : 'Редактировать схему'}</button></div>
    {storageWarning && <p role="alert">{storageWarning}</p>}
    <div className="graph-toolbar">
      <label>Ресурс<select aria-label="Ресурс" value={prefs.filters.resource} onChange={e => setFilter({ resource: e.target.value as Resource | '' })}><option value="">Все ресурсы</option>{Object.entries(resourceNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>Состояние<select aria-label="Состояние объекта" value={prefs.filters.state} onChange={e => setFilter({ state: e.target.value as ObjectState | '' })}><option value="">Все состояния</option>{Object.entries(stateNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>Район<select aria-label="Район" value={prefs.filters.district} onChange={e => setFilter({ district: e.target.value })}><option value="">Все районы</option>{[...new Set(data.objects.map(item => item.district))].map(d => <option key={d}>{d}</option>)}</select></label>
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
        <button disabled={!selected.length} onClick={() => { dispatch(graphActions.edit({ hidden: [...new Set([...prefs.hidden, ...selected])] })); setSelected([]); }}>Скрыть выделенное</button>
        <button disabled={!selected.length} onClick={() => { setSelected([]); setFocused(null); }}>Снять выделение</button>
      </div>
      {editing && <div className="graph-panel"><h2>Редактор схемы</h2><p>Перетаскивайте объекты. Выберите стрелку; двойной щелчок по ней добавляет точку маршрута. Точки можно перемещать и удалять двойным щелчком.</p>
        <button disabled={layoutBusy} onClick={() => void autoLayout()}>{layoutBusy ? 'Расчёт…' : 'Автораскладка'}</button>
        <button disabled={!selectedEdge} onClick={() => { if (selectedEdge) routeUpdate(selectedEdge, []); }}>Выпрямить выбранную связь</button>
        <label>Название группы<input value={groupName} maxLength={100} onChange={e => setGroupName(e.target.value)} placeholder="Например, насосный узел" /></label>
        <button disabled={!selected.length || !groupName.trim()} onClick={() => {
          dispatch(graphActions.edit({ groups: [...prefs.groups, { id: newMapId('group'), name: groupName.trim(), members: selected }] })); setGroupName('');
        }}>Сгруппировать выделенное</button>
        {prefs.groups.map(group => <div className="graph-group-entry" key={group.id}><span>{group.name} ({group.members.length})</span><button aria-label={`Разгруппировать ${group.name}`} onClick={() => dispatch(graphActions.edit({ groups: prefs.groups.filter(g => g.id !== group.id) }))}>×</button></div>)}
        <label>Подпись<textarea aria-label="Текст подписи" value={noteText} maxLength={500} onChange={e => setNoteText(e.target.value)} placeholder="Текст пометки" /></label>
        <button disabled={!noteText.trim()} aria-pressed={placement === 'text'} onClick={() => setPlacement(placement === 'text' ? null : 'text')}>Разместить подпись</button>
        <button aria-pressed={placement === 'line'} onClick={() => setPlacement(placement === 'line' ? null : 'line')}>Нарисовать линию</button>
        {placement && <><p role="status">Щёлкните по свободному месту карты. {placement === 'line' ? 'Затем перетащите конец линии.' : ''}</p><button onClick={() => setPlacement(null)}>Отмена размещения</button></>}
        <button disabled={!selectedAnnotation || !noteText.trim() || prefs.annotations.find(a => a.id === selectedAnnotation)?.kind !== 'text'} onClick={() => dispatch(graphActions.edit({ annotations: prefs.annotations.map(a => a.id === selectedAnnotation ? { ...a, text: noteText.trim() } : a) }))}>Обновить выбранную подпись</button>
        <button disabled={!selectedAnnotation} onClick={() => { dispatch(graphActions.edit({ annotations: prefs.annotations.filter(a => a.id !== selectedAnnotation) })); setSelectedAnnotation(null); }}>Удалить пометку</button>
      </div>}
      {focusedObject && <div className="graph-panel object-details"><h2>{focusedObject.name}</h2><p>{focusedObject.address}</p><p>{focusedObject.description}</p>
        {focusedObject.resources.map(resource => <div key={resource}><strong>{resourceNames[resource]}</strong><span className={`object-state ${focusedObject.states[resource]}`}>{stateNames[focusedObject.states[resource] ?? 'normal']}</span></div>)}
        <small>ID: {focusedObject.id}</small><small>Прямых зависимых: {data.dependencies.filter(e => e.source === focusedObject.id).length}</small>
      </div>}
    </aside><div className={`graph-canvas ${placement ? 'placing' : ''}`} ref={canvas} data-testid="graph-canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        defaultViewport={prefs.viewport} fitView={!prefs.viewport} minZoom={0.08} maxZoom={2.5}
        nodesConnectable={false} edgesReconnectable={false} nodesDraggable={editing && !placement}
        deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} selectionOnDrag={false}
        panOnDrag={!placement} panOnScroll zoomOnDoubleClick={false}
        onNodeClick={clickNode} onNodeDrag={(_e, node) => {
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
        onEdgeDoubleClick={(event, edge) => { if (editing) { setSelectedEdge(edge.id); addPoint(edge.id, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); } }}
        onPaneClick={event => {
          if (editing && placement) {
            const annotation: Annotation = { id: newMapId('annotation'), kind: placement, text: noteText.trim(),
              position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), ...(placement === 'line' ? { end: { x: 180, y: 0 } } : {}) };
            dispatch(graphActions.edit({ annotations: [...prefs.annotations, annotation] })); setPlacement(null); setSelectedAnnotation(annotation.id);
          } else { setSelectedEdge(null); setSelectedAnnotation(null); }
        }}>
        <Background gap={24} color="#bdc9d9" /><MiniMap ariaLabel="Мини-карта объектов" pannable zoomable nodeColor={node => {
          const item = data.objects.find(item => item.id === node.id);
          return item ? ({ normal: '#159777', maintenance: '#d99116', incident: '#db4555' })[objectState(item, prefs.filters.resource)] : '#cbd5e1';
        }} /><Controls showInteractive={false} showZoom={false} showFitView={false} aria-label="Масштаб карты">
          <ControlButton title="Приблизить" aria-label="Приблизить" onClick={() => void flow.zoomIn()}>+</ControlButton>
          <ControlButton title="Отдалить" aria-label="Отдалить" onClick={() => void flow.zoomOut()}>−</ControlButton>
          <ControlButton title="Вписать всю схему" aria-label="Вписать всю схему" onClick={() => void flow.fitView({ padding: 0.12 })}>⛶</ControlButton>
        </Controls>
      </ReactFlow>
      {!visible.length && <div className="graph-empty">Нет объектов по выбранным условиям. Измените фильтры или покажите скрытые объекты.</div>}
      <div className="graph-legend"><span>✓ Норма</span><span>◆ Техработы</span><span>! Авария</span><span className="water">━ Вода</span><span className="energy">━ Электроэнергия</span></div>
    </div></div>
    <div className="graph-footer"><span>{editing ? 'Редактирование расположения и пометок' : 'Просмотр · схема защищена от изменений'}</span><span>{notice || 'Настройки сохраняются в этом браузере для вашего аккаунта'}</span><a href="/licenses/graph.txt" target="_blank" rel="noreferrer">Лицензии</a></div>
  </section>;
}
