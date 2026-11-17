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
