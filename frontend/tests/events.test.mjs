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
