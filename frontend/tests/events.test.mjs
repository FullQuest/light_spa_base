import test from 'node:test';
import assert from 'node:assert/strict';
import { filterArchive, normalizeArchive } from '../src/modules/events/archive.ts';

const fixture = () => ({ events: [
  { id: '10', objectId: 'node-a', objectName: 'Узел А', resource: 'water', occurredAt: '2026-03-04T10:00:00Z', status: 'incident', statusName: 'Аварийное отключение', description: 'Разрыв трубы' },
  { id: '11', objectId: 'node-a', objectName: 'Узел А', resource: 'energy', occurredAt: '2026-03-05T10:00:00Z', status: 'maintenance', statusName: 'Плановые работы', description: '' },
  { id: '9', objectId: 'node-b', objectName: 'Узел Б', resource: 'water', occurredAt: '2026-03-04T10:00:00Z', status: 'normal', statusName: 'Восстановление', description: 'Подача восстановлена' },
] });

test('archive requires string event IDs, timezone timestamps, valid fields and unique IDs', () => {
  assert.deepEqual(normalizeArchive(fixture()).map(event => event.id), ['11', '10', '9']);
  assert.throws(() => normalizeArchive({ events: [{ ...fixture().events[0], id: 10 }] }), /некорректн/iu);
  assert.throws(() => normalizeArchive({ events: [fixture().events[0], fixture().events[0]] }), /повторяющ/iu);
  assert.throws(() => normalizeArchive({ events: [{ ...fixture().events[0], occurredAt: '2026-03-04T10:00:00' }] }));
  assert.throws(() => normalizeArchive({ events: [{ ...fixture().events[0], resource: 'gas' }] }));
});

test('archive filters combine object, event type, resource, local calendar dates and free text', () => {
  const events = normalizeArchive(fixture());
  assert.deepEqual(filterArchive(events, { objectId: 'node-a', statusName: '', resource: '', from: '', to: '', search: '' }).map(e => e.id), ['11','10']);
  assert.deepEqual(filterArchive(events, { objectId: '', statusName: 'Восстановление', resource: 'water', from: '2026-03-04', to: '2026-03-04', search: '' }).map(e => e.id), ['9']);
  assert.deepEqual(filterArchive(events, { objectId: '', statusName: '', resource: '', from: '', to: '', search: 'трубы' }).map(e => e.id), ['10']);
  assert.deepEqual(filterArchive(events, { objectId: '', statusName: '', resource: '', from: '2026-03-05', to: '2026-03-03', search: '' }), []);
});

import { historicalSnapshot, timelinePoints } from '../src/modules/graph/timeline.ts';
const history = [
  { id: '1', objectId: 'a', resource: 'water', status: 'normal', occurredAt: '2026-01-01T00:00:00Z' },
  { id: '2', objectId: 'a', resource: 'energy', status: 'maintenance', occurredAt: '2026-01-01T00:00:00Z' },
  { id: '9', objectId: 'a', resource: 'water', status: 'normal', occurredAt: '2026-01-01T00:01:00Z' },
  { id: '10', objectId: 'a', resource: 'water', status: 'incident', occurredAt: '2026-01-01T03:01:00+03:00' },
  { id: '11', objectId: 'a', resource: 'water', status: 'normal', occurredAt: '2026-01-03T00:00:00Z' },
];
const topology = { objects: [{ id: 'a', resources: ['water', 'energy'], states: { water: 'normal' } }], dependencies: [{ id: 'edge' }], topologyRevision: 'current' };
test('timeline uses unique actual timestamps, sorted chronologically with inclusive bounds', () => {
  assert.deepEqual(timelinePoints(history), ['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-03T00:00:00.000Z']);
  assert.deepEqual(timelinePoints(history, '2026-01-01T00:01:00Z', '2026-01-01T00:01:00Z'), ['2026-01-01T00:01:00.000Z']);
  assert.deepEqual(timelinePoints(history, '2026-01-04', '2026-01-05'), []);
  assert.deepEqual(timelinePoints([], '', ''), []);
  assert.deepEqual(timelinePoints(history, '2026-01-04', '2026-01-01'), []);
});
test('historical states include pre-period events and resolve equal timestamps by numeric ID', () => {
  const data = historicalSnapshot(topology, history, '2026-01-02T00:00:00Z');
  assert.deepEqual(data.objects[0].states, { water: 'incident', energy: 'maintenance' });
  assert.equal(data.currentEvents.find(event => event.resource === 'water').id, '10');
  assert.equal(data.dependencies, topology.dependencies);
  assert.equal(data.topologyRevision, 'current');
  assert.deepEqual(topology.objects[0].states, { water: 'normal' });
  assert.deepEqual(historicalSnapshot(topology, history, '2025-12-31T00:00:00Z').objects[0].states, {});
  assert.equal(historicalSnapshot(topology, history, '2026-01-03T00:00:00Z').objects[0].states.water, 'normal');
});
test('events for removed objects or resources do not become current graph events', () => {
  const data = historicalSnapshot(topology, [...history, { ...history[0], id: '99', objectId: 'removed' },
    { ...history[0], id: '100', resource: 'removed' }], '2026-01-03T00:00:00Z');
  assert.equal(data.currentEvents.length, 2);
});
