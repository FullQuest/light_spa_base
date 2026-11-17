import test from 'node:test';
import assert from 'node:assert/strict';
import { descendants, objectState, visibleObjects } from '../src/modules/graph/types.ts';
import { createGraphStore, defaultPreferences, graphActions } from '../src/modules/graph/store.ts';
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
  prefs.filters.district = 'A';
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
