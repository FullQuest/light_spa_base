import test from 'node:test';
import assert from 'node:assert/strict';
import { descendants, influenceZone, objectState, visibleObjects } from '../src/modules/graph/types.ts';
import { createGraphStore, defaultPreferences, graphActions, restorePreferences } from '../src/modules/graph/store.ts';
const objects = [
  { id: 'a', resources: ['water','energy'], states: { water: 'normal', energy: 'incident' }, district: 'A' },
  { id: 'b', resources: ['water'], states: { water: 'maintenance' }, district: 'B' },
  { id: 'c', resources: ['energy'], states: { energy: 'normal' }, district: 'A' },
];
const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
test('selection follows outgoing transitive dependencies, including hidden intermediates', () => {
  assert.deepEqual([...descendants('a', edges)], ['a', 'b', 'c']);
  assert.deepEqual([...descendants('c', edges)], ['c']);
  assert.deepEqual([...descendants('a', [...edges, { source: 'c', target: 'a' }])], ['a', 'b', 'c']);
});
test('per-resource state and incident filters do not mix resources', () => {
  const prefs = defaultPreferences();
  assert.equal(objectState(objects[0]), 'incident');
  assert.equal(objectState(objects[0], 'water'), 'normal');
  prefs.filters.incidentsOnly = true;
  assert.deepEqual(visibleObjects({ objects }, prefs).map(o => o.id), ['a']);
  prefs.filters.resource = 'water';
  assert.equal(visibleObjects({ objects }, prefs).length, 0);
});
test('filters intersect with manual hiding and district', () => {
  const prefs = defaultPreferences();
  prefs.groups = [{ id: 'user-district', name: 'Мой район', members: ['a', 'c'] }];
  prefs.filters.district = 'user-district';
  prefs.hidden = ['c'];
  assert.deepEqual(visibleObjects({ objects }, prefs).map(o => o.id), ['a']);
  prefs.filters.state = 'normal';
  assert.equal(visibleObjects({ objects }, prefs).length, 0);
});
test('undo and redo restore positions, routes and annotations together', () => {
  const store = createGraphStore(defaultPreferences());
  store.dispatch(graphActions.edit({ positions: { a: { x: 10, y: 20 } }, routes: { e: [{ x: 25, y: 30 }] },
    annotations: [{ id: 'note', kind: 'text', text: 'Пометка', position: { x: 5, y: 5 } }] }));
  const saved = store.getState().present;
  store.dispatch(graphActions.undo());
  assert.deepEqual(store.getState().present, defaultPreferences());
  store.dispatch(graphActions.redo());
  assert.deepEqual(store.getState().present, saved);
  store.dispatch(graphActions.undo());
  store.dispatch(graphActions.edit({ hidden: ['a'] }));
  assert.equal(store.getState().future.length, 0);
});
test('viewport movements do not fill undo history and user stores are isolated', () => {
  const first = createGraphStore(defaultPreferences()), second = createGraphStore(defaultPreferences());
  first.dispatch(graphActions.viewport({ x: 12, y: 24, zoom: 1.5 }));
  assert.equal(first.getState().past.length, 0);
  first.dispatch(graphActions.edit({ hidden: ['a'] }));
  assert.deepEqual(second.getState().present.hidden, []);
});

import { latestEvents, normalizeSnapshot, topologyKey } from '../src/modules/graph/snapshot.ts';
import { moveRoutes, roundedPath } from '../src/modules/graph/routes.ts';
const snapshot = () => ({
  topologyRevision: 't1', eventRevision: 'v1', asOf: '2026-11-17T12:00:00Z', syncedAt: '2026-11-17T11:59:59Z', sourceStatus: 'online', demo: false,
  objects: objects.map(o => ({ ...o, name: o.id, kind: 'station', address: '', description: '' })), dependencies: [{ id: 'ab', source: 'a', target: 'b', resource: 'water' }],
  currentEvents: [
    { id: '2', objectId: 'a', resource: 'water', occurredAt: '2026-11-17T11:00:00Z', status: 'incident', statusName: 'Авария' },
    { id: '3', objectId: 'a', resource: 'energy', occurredAt: '2026-11-17T10:00:00Z', status: 'maintenance', statusName: 'Работы' },
    { id: '10', objectId: 'a', resource: 'water', occurredAt: '2026-11-17T11:00:00Z', status: 'normal', statusName: 'Норма' },
    { id: '11', objectId: 'a', resource: 'water', occurredAt: '2026-11-17T13:00:00Z', status: 'incident', statusName: 'Будущее' },
  ],
});
test('latest event per object AND resource, numeric ID tie-break, no future events', () => {
  const raw = snapshot();
  assert.deepEqual(latestEvents(raw.currentEvents, raw.asOf).map(e => e.id), ['10', '3']);
});
test('states come from events, not stale states on objects; missing events are unknown', () => {
  const data = normalizeSnapshot(snapshot());
  assert.deepEqual(data.objects[0].states, { water: 'normal', energy: 'maintenance' });
  assert.equal(objectState(data.objects[1]), 'unknown');
  assert.equal(objectState({ resources: ['water', 'energy'], states: { water: 'normal' } }), 'unknown');
  assert.equal(data.currentEvents.length, 2);
  assert.equal(data.legacyDemo, false);
  const raw = snapshot(); raw.currentEvents = [];
  assert.equal(objectState(normalizeSnapshot(raw).objects[0]), 'unknown');
});
test('malformed updates fail rather than silently replace a valid snapshot', () => {
  const raw = snapshot();
  assert.throws(() => normalizeSnapshot({ ...raw, currentEvents: undefined }));
  assert.throws(() => normalizeSnapshot({ ...raw, asOf: 'invalid' }));
  assert.throws(() => normalizeSnapshot({ ...raw, dependencies: [{ id: 'bad', source: 'a', target: 'missing', resource: 'water' }] }));
  assert.throws(() => normalizeSnapshot({ ...raw, currentEvents: [{ ...raw.currentEvents[0], status: 'unknown' }] }));
});
test('event-only revisions do not change topology identity', () => {
  const raw = snapshot();
  assert.equal(topologyKey(raw), topologyKey({ ...raw, eventRevision: 'v2', currentEvents: [], objects: [...raw.objects].reverse() }));
  assert.notEqual(topologyKey(raw), topologyKey({ ...raw, dependencies: [] }));
});
test('topology reconciliation does not resurrect deleted data on undo', () => {
  const store = createGraphStore(defaultPreferences());
  store.dispatch(graphActions.edit({ positions: { deleted: { x: 10, y: 20 } } }));
  store.dispatch(graphActions.reconcile({ positions: {} }));
  store.dispatch(graphActions.undo());
  assert.deepEqual(store.getState().present.positions, {});
});
test('moving one or both ends carries route bends without changing topology', () => {
  const edge = [{ id: 'ab', source: 'a', target: 'b' }];
  const points = { ab: [{ x: 50, y: 50 }] };
  const before = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
  assert.deepEqual(moveRoutes(points, edge, before, { a: { x: 20, y: 40 } }).ab, [{ x: 60, y: 70 }]);
  assert.deepEqual(moveRoutes(points, edge, before, { a: { x: 20, y: 40 }, b: { x: 120, y: 40 } }).ab, [{ x: 70, y: 90 }]);
  assert.deepEqual(points.ab, [{ x: 50, y: 50 }]);
});
test('rounded routes contain curves and handle zero-length segments', () => {
  assert.match(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 60 }]), / Q /);
  assert.doesNotMatch(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 60 }]), /NaN/);
});
test('cyclic or timezone-ambiguous snapshots cannot replace the map', () => {
  const raw = snapshot();
  assert.throws(() => normalizeSnapshot({ ...raw, dependencies: [...raw.dependencies, { id: 'ba', source: 'b', target: 'a', resource: 'water' }] }), /циклический/);
  assert.throws(() => normalizeSnapshot({ ...raw, currentEvents: [{ ...raw.currentEvents[0], occurredAt: '2026-11-17T12:00:00' }] }));
});

import { dependencyIndices, assignGroup, projectedDependencies } from '../src/modules/graph/types.ts';
import { annotationBounds, annotationHit, eraseAnnotations } from '../src/modules/graph/drawing.ts';
test('indices count unique transitive dependents across resources, independent of presentation', () => {
  const data = { objects: ['a','b','c','d','e'].map(id => ({ id })), dependencies: [
    { source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'b', target: 'd' }, { source: 'c', target: 'd' }, { source: 'a', target: 'b' } ] };
  assert.deepEqual(dependencyIndices(data), { a: { count: 3, index: 10 }, b: { count: 1, index: 3 }, c: { count: 1, index: 3 }, d: { count: 0, index: 0 }, e: { count: 0, index: 0 } });
  assert.equal(dependencyIndices({ objects: [{ id: 'leaf' }], dependencies: [] }).leaf.index, 0);
  const many = { objects: Array.from({ length: 102 }, (_, i) => ({ id: String(i) })), dependencies: Array.from({ length: 101 }, (_, i) => ({ source: String(i), target: String(i + 1) })) };
  assert.equal(dependencyIndices(many)['1'].index, 9);
  assert.equal(dependencyIndices(many)['100'].index, 1);
});
test('district membership is exclusive and independent of addresses', () => {
  const groups = [{ id: 'g1', name: 'Первый', members: ['a', 'b'] }, { id: 'g2', name: 'Второй', members: ['c'] }];
  const result = assignGroup(groups, { id: 'g3', name: 'Новый', members: ['b', 'c'] });
  assert.deepEqual(result.map(g => g.members), [['a'], ['b', 'c']]);
  assert.deepEqual(groups[0].members, ['a', 'b']);
  const prefs = defaultPreferences(); prefs.groups = result; prefs.filters.district = 'g3';
  assert.deepEqual(visibleObjects({ objects }, prefs).map(o => o.id), ['b', 'c']);
});
test('collapsed districts project boundaries without changing logical edges or losing resources', () => {
  const dependencies = [{ id: 'ab', source: 'a', target: 'b', resource: 'water' }, { id: 'bc', source: 'b', target: 'c', resource: 'water' }, { id: 'ac', source: 'a', target: 'c', resource: 'energy' }, { id: 'cd', source: 'c', target: 'd', resource: 'water' }];
  const groups = [{ id: 'g', members: ['a', 'b'], collapsed: true }, { id: 'h', members: ['c'], collapsed: true }];
  const original = structuredClone(dependencies);
  const projected = projectedDependencies(dependencies, groups, new Set(['a','b','c','d']));
  assert.deepEqual(projected.map(e => [e.id, e.source, e.target, e.resource]), [['bc','g','h','water'], ['ac','g','h','energy'], ['cd','h','d','water']]);
  assert.deepEqual(dependencies, original);
  assert.deepEqual([...descendants('a', dependencies)], ['a','b','c','d']);
  assert.deepEqual(projectedDependencies(dependencies, [], new Set(['a','b'])).map(e => e.id), ['ab']);
});
test('partial eraser leaves masked strokes, whole eraser removes only hit annotations', () => {
  const annotations = [{ id: 'line', kind: 'line', text: '', position: { x: 100, y: 200 }, end: { x: 200, y: 0 }, width: 4 }, { id: 'far', kind: 'rectangle', text: '', position: { x: 500, y: 500 }, end: { x: -100, y: -100 } }];
  const partial = eraseAnnotations(annotations, { x: 140, y: 200 }, { x: 260, y: 200 }, 10, false);
  assert.equal(partial.length, 2); assert.ok(partial[0].erasures.length > 10);
  assert.equal(annotationHit(partial[0], { x: 200, y: 200 }, 0), false);
  assert.equal(annotationHit(partial[0], { x: 110, y: 200 }, 0), true);
  assert.equal(annotations[0].erasures, undefined);
  assert.deepEqual(eraseAnnotations(annotations, { x: 200, y: 150 }, { x: 200, y: 250 }, 10, true).map(a => a.id), ['far']);
  assert.deepEqual(annotationBounds(annotations[1]), { x: 400, y: 400, width: 100, height: 100 });
});

test('old address filters and overlapping groups migrate without hiding the whole graph', () => {
  const old = { groups: [{ id: 'old', name: 'Старый', members: ['a','b'] }, { id: 'new', name: 'Новый', members: ['b','c'], collapsed: true }], filters: { district: 'Адресный район' } };
  const prefs = restorePreferences(old);
  assert.equal(prefs.filters.district, '');
  assert.deepEqual(prefs.groups.map(g => g.members), [['a'],['b','c']]);
  assert.equal(prefs.groups[1].collapsed, true);
  assert.equal(prefs.filters.incidentsOnly, false);
  assert.equal(old.filters.district, 'Адресный район');
});
test('influence follows only outgoing edges of the incident resource, transitively', () => {
  const dependencies = [
    { id: 'ab-water', source: 'a', target: 'b', resource: 'water' },
    { id: 'ac-energy', source: 'a', target: 'c', resource: 'energy' },
    { id: 'bc-water', source: 'b', target: 'c', resource: 'water' },
    { id: 'cd-energy', source: 'c', target: 'd', resource: 'energy' },
    { id: 'xa-energy', source: 'x', target: 'a', resource: 'energy' },
  ];
  assert.deepEqual([...influenceZone([{ id: 'a', resource: 'water' }], dependencies).nodes].sort(), ['a','b','c']);
  assert.deepEqual([...influenceZone([{ id: 'a', resource: 'water' }], dependencies).edges].sort(), ['ab-water','bc-water']);
  assert.deepEqual([...influenceZone([{ id: 'a', resource: 'energy' }], dependencies).nodes].sort(), ['a','c','d']);
  assert.deepEqual([...influenceZone([{ id: 'a', resource: 'water' }, { id: 'a', resource: 'energy' }], dependencies).edges].sort(), ['ab-water','ac-energy','bc-water','cd-energy']);
  assert.equal(influenceZone([{ id: 'a', resource: 'energy' }], dependencies).edges.has('xa-energy'), false);
});
test('active incidents seed independent resource influence zones', () => {
  const graph = { objects: [
    { id: 'a', resources: ['water','energy'], states: { water: 'incident', energy: 'normal' } },
    { id: 'b', resources: ['water','energy'], states: { water: 'normal', energy: 'incident' } },
    { id: 'c', resources: ['water','energy'], states: { water: 'normal', energy: 'normal' } },
  ], dependencies: [
    { id: 'ab-w', source: 'a', target: 'b', resource: 'water' },
    { id: 'ac-e', source: 'a', target: 'c', resource: 'energy' },
    { id: 'bc-e', source: 'b', target: 'c', resource: 'energy' },
  ] };
  const zone = influenceZone(graph.objects.flatMap(item => item.resources.filter(r => item.states[r] === 'incident').map(resource => ({ id: item.id, resource }))), graph.dependencies);
  assert.deepEqual([...zone.nodes].sort(), ['a','b','c']);
  assert.deepEqual([...zone.edges].sort(), ['ab-w','bc-e']);
  assert.equal(objectState(graph.objects[0], 'water'), 'incident');
  assert.equal(objectState(graph.objects[0], 'energy'), 'normal');
});

import { incidentImpact, formatDuration } from '../src/modules/graph/incidents.ts';
test('resource impact retains source time, distinguishes own incidents and releases recovered sources', () => {
  const data = { objects: ['a','b','c','d'].map(id => ({ id, resources: ['water','energy'] })), dependencies: [
    { id: 'ab', source: 'a', target: 'b', resource: 'water' },
    { id: 'bc', source: 'b', target: 'c', resource: 'water' },
    { id: 'bd', source: 'b', target: 'd', resource: 'energy' },
  ] };
  const early = { id: '1', objectId: 'a', resource: 'water', status: 'incident', occurredAt: '2026-11-17T10:00:00Z' };
  const later = { id: '2', objectId: 'b', resource: 'water', status: 'incident', occurredAt: '2026-11-17T11:00:00Z' };
  const result = incidentImpact(data, [early, later]);
  assert.equal(result.byObject.a.water.own.id, '1');
  assert.equal(result.byObject.c.water.own, undefined);
  assert.equal(result.byObject.c.water.since, early.occurredAt);
  assert.equal(result.byObject.c.water.origins.length, 2);
  assert.equal(result.byObject.b.water.since, later.occurredAt, 'own incident uses its own start time');
  assert.equal(result.byObject.d, undefined);
  assert.equal(result.byObject.b.energy, undefined);
  assert.deepEqual(result.counts, { a: 2, b: 1 });
  const recovered = incidentImpact(data, [{ ...early, status: 'normal' }, later]);
  assert.equal(recovered.byObject.a, undefined);
  assert.equal(recovered.byObject.c.water.since, later.occurredAt);
  assert.deepEqual(incidentImpact(data, []).byObject, {});
  assert.equal(data.objects[0].states, undefined);
});
test('duration handles days, minute rollover, future timestamps and invalid dates', () => {
  const since = '2026-11-17T10:00:00Z', start = Date.parse(since);
  assert.equal(formatDuration(since, start + 90061000), '1 д 1 ч 1 мин 1 с');
  assert.equal(formatDuration(since, start + 60000), '1 мин 0 с');
  assert.equal(formatDuration(since, start - 1000), '0 с');
  assert.equal(formatDuration('bad', start), '—');
});

import ELK from 'elkjs/lib/elk.bundled.js';
import { connectionPorts, handleId, layoutModel, NODE_HEIGHT } from '../src/modules/graph/layoutModel.ts';
const routingFixture = {
  objects: ['a','b','c','d'].map(id => ({ id })),
  dependencies: [
    { id: 'ab-water', source: 'a', target: 'b', resource: 'water' },
    { id: 'ab-energy', source: 'a', target: 'b', resource: 'energy' },
    { id: 'ac', source: 'a', target: 'c', resource: 'water' },
    { id: 'bd', source: 'b', target: 'd', resource: 'water' },
    { id: 'cd', source: 'c', target: 'd', resource: 'water' },
  ],
};
test('each dependency has a distinct stable port on each end, shared by layout and rendering', () => {
  const ports = connectionPorts(routingFixture.dependencies);
  assert.deepEqual(connectionPorts([...routingFixture.dependencies].reverse()), ports);
  for (const edge of routingFixture.dependencies) {
    assert.ok(ports[edge.source].some(port => port.id === handleId(edge.id, 'out')));
    assert.ok(ports[edge.target].some(port => port.id === handleId(edge.id, 'in')));
  }
  for (const list of Object.values(ports)) for (const side of ['in', 'out']) {
    const offsets = list.filter(port => port.side === side).map(port => port.y);
    assert.equal(new Set(offsets).size, offsets.length);
    assert.ok(offsets.every(y => y > 0 && y < NODE_HEIGHT));
  }
});
test('orthogonal layout separates parallel resources and branch routes without shared segments', async () => {
  const result = await new ELK().layout(layoutModel(routingFixture));
  const segments = [];
  for (const edge of result.edges) {
    const section = edge.sections[0];
    const sourceNode = result.children.find(node => node.id === routingFixture.dependencies.find(e => e.id === edge.id).source);
    const sourcePort = sourceNode.ports.find(port => port.id === edge.sources[0]);
    assert.equal(section.startPoint.x, sourceNode.x + sourcePort.x);
    assert.equal(section.startPoint.y, sourceNode.y + sourcePort.y);
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      assert.ok(a.x === b.x || a.y === b.y, 'layout should remain orthogonal');
      segments.push({ id: edge.id, a, b });
    }
  }
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if (a.id === b.id) continue;
    for (const [fixed, along] of [['x','y'],['y','x']]) {
      const collinear = a.a[fixed] === a.b[fixed] && b.a[fixed] === b.b[fixed] && a.a[fixed] === b.a[fixed];
      if (!collinear) continue;
      const overlap = Math.min(Math.max(a.a[along],a.b[along]),Math.max(b.a[along],b.b[along])) -
        Math.max(Math.min(a.a[along],a.b[along]),Math.min(b.a[along],b.b[along]));
      assert.ok(overlap <= 0, `edges ${a.id} and ${b.id} overlap by ${overlap}`);
    }
  }
});
