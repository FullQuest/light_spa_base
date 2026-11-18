import test from 'node:test';
import assert from 'node:assert/strict';
import { workerColumns, filterWorkers } from '../src/modules/workforce/model.ts';
import { experienceYears } from '../src/modules/workforce/types.ts';
import { duration, timelineLayout, scheduleIssues, scheduleSpanSeconds, exportM2 } from '../src/modules/brigades/schedule.ts';

const employees = [
  { tabel: 10, last_name: 'Фёдоров', first_name: 'Антон', middle_name: '', start_date_experience: '2020-11-19', qualifications: [{ id_qualification: 101, id_employee: 10, resource_type: 'water', proff: 0.1 }] },
  { tabel: 2, last_name: 'Иванов', first_name: 'Борис', middle_name: 'Петрович', start_date_experience: '2001-01-01', qualifications: [{ id_qualification: 102, id_employee: 2, resource_type: 'energy', proff: 10 }] },
  { tabel: 30, last_name: 'Антонов', first_name: 'Игорь', middle_name: 'Ильич', start_date_experience: '2010-01-01', qualifications: [{ id_qualification: 103, id_employee: 30, resource_type: 'water', proff: 7.5 }] },
];
const columns = workerColumns(employees);
const ids = (filters = {}, search = '', sort = { key: 'tabel', direction: 'asc' }) => filterWorkers(employees, columns, filters, search, sort).map(e => e.tabel);
const origin = Date.parse('2026-11-18T08:00:00+03:00');
const incident = (eventId, brigadeId, from, to, extra = {}) => ({ eventId, brigadeId, sequence: eventId, objectId: 1, objectName: 'Объект', resourceType: 'water', occurredAt: new Date(origin - 1000).toISOString(), startAt: new Date(origin + from * 1000).toISOString(), finishAt: new Date(origin + to * 1000).toISOString(), baseDurationSeconds: 100, actualDurationSeconds: to - from, ...extra });
const result = incidents => ({ id: 'test', generatedAt: new Date(origin).toISOString(), dataRevision: 'v1', employees: employees.slice(0, 2), brigades: [{ brigadeId: 1, employeeIds: [10, 2] }], incidents });

test('workers: numeric ID sorting, both directions, immutable source and missing qualifications last', () => {
  assert.deepEqual(ids(), [2, 10, 30]);
  assert.deepEqual(ids({}, '', { key: 'water_proff', direction: 'desc' }), [30, 10, 2]);
  assert.deepEqual(ids({}, '', { key: 'water_proff', direction: 'asc' }), [10, 30, 2]);
  assert.deepEqual(employees.map(e => e.tabel), [10, 2, 30]);
});
test('workers: combine all field types, exact range boundaries and absent qualifications', () => {
  assert.deepEqual(ids({ tabel: { min: '10', max: '30' }, water_proff: { min: '0.1', max: '7.5' }, start_date_experience: { min: '2010-01-01' } }), [10, 30]);
  assert.deepEqual(ids({ water_proff: { missing: true } }), [2]);
  assert.deepEqual(ids({ water_id: { min: '103', max: '103' } }), [30]);
  assert.deepEqual(ids({ tabel: { min: '50', max: '1' } }), []);
  assert.deepEqual(ids({ middle_name: { text: 'ПЕТРОВ' } }), [2]);
  assert.deepEqual(ids({}, 'федоров'), [10]);
  assert.deepEqual(ids({}, 'электроэнергия'), [2]);
  assert.deepEqual(ids({}, '[.*]'), []);
});
test('workers: seniority uses full calendar years, including birthday boundary and invalid/future dates', () => {
  assert.equal(experienceYears('2020-11-19', '2026-11-18'), 5);
  assert.equal(experienceYears('2020-11-18', '2026-11-18'), 6);
  assert.equal(experienceYears('2027-01-01', '2026-11-18'), null);
  assert.equal(experienceYears('invalid', '2026-11-18'), null);
  assert.equal(experienceYears('2020-02-30', '2026-11-18'), null);
  assert.equal(filterWorkers([], workerColumns([]), {}, '', { key: 'tabel', direction: 'asc' }).length, 0);
});
test('schedule: M2 export has only the specified fields and uses sequence instead of input order', () => {
  const plan = result([incident(504, 1, 30, 40, { sequence: 2 }), incident(501, 1, 0, 10, { sequence: 1 })]);
  assert.deepEqual(exportM2(plan), { brigades: [{ brigade_id: 1, employees: [10, 2], event_order: [501, 504] }] });
  assert.equal(plan.incidents[0].eventId, 504);
  assert.deepEqual(scheduleIssues(plan), []);
});
test('timeline: sequential work, idle gaps and parallel crews use a shared time scale', () => {
  const plan = result([incident(1, 1, 0, 10), incident(2, 1, 20, 30), incident(3, 2, 5, 30)]);
  plan.brigades.push({ brigadeId: 2, employeeIds: [] }, { brigadeId: 3, employeeIds: [] });
  const layout = timelineLayout(plan);
  assert.equal(layout.end - layout.start, 30000);
  assert.equal(layout.lanes[0].tracks, 1);
  assert.equal(layout.lanes[0].busySeconds, 20);
  assert.equal(layout.lanes[0].waitSeconds, 10);
  assert.equal(layout.lanes[1].busySeconds, 25);
  assert.equal(layout.lanes[2].waitSeconds, 30);
});
test('timeline: overlaps get separate tracks and union occupancy is not double counted', () => {
  const plan = result([incident(1, 1, 0, 10), incident(2, 1, 5, 20), incident(3, 1, 20, 30)]);
  const lane = timelineLayout(plan).lanes[0];
  assert.equal(lane.tracks, 2);
  assert.equal(lane.busySeconds, 30);
  assert.equal(lane.waitSeconds, 0);
  assert.ok(scheduleIssues(plan).some(issue => issue.includes('пересекаются')));
});
test('timeline: empty, zero-duration, invalid and multi-day intervals stay finite', () => {
  for (const incidents of [[], [incident(1, 1, 0, 0)], [incident(1, 1, 0, 0.001)], [incident(1, 1, 0, 864000)], [incident(1, 1, 10, 0)], [incident(1, 1, 0, 10, { startAt: 'bad' })]]) {
    const layout = timelineLayout(result(incidents));
    assert.ok(Number.isFinite(layout.start)); assert.ok(Number.isFinite(layout.end)); assert.ok(layout.end > layout.start);
    for (const lane of layout.lanes) { assert.ok(lane.busySeconds >= 0); assert.ok(lane.waitSeconds >= 0); }
  }
  assert.ok(scheduleIssues(result([incident(1, 1, 10, 0)])).some(issue => issue.includes('некорректный интервал')));
  assert.equal(duration(NaN), '—'); assert.equal(duration(-1), '—'); assert.equal(duration(0), '0 с'); assert.equal(duration(.01), '< 1 с'); assert.equal(duration(90061), '1 д 1 ч 1 мин 1 с');
  assert.equal(scheduleSpanSeconds([incident(1, 1, 0, 0)]), 0);
  assert.equal(scheduleSpanSeconds([]), null);
});
test('schedule: duplicate events, unknown brigades and workers do not silently pass validation', () => {
  const plan = result([incident(1, 1, 0, 10), incident(1, 9, 20, 30)]);
  plan.brigades.push({ brigadeId: 2, employeeIds: [10, 404] });
  const issues = scheduleIssues(plan).join(' ');
  assert.match(issues, /назначено несколько раз/); assert.match(issues, /неизвестная бригада/); assert.match(issues, /включён в состав несколько раз/); assert.match(issues, /Нет сведений/);
});
test('timeline: 10,000 records and long names do not overflow call stack or create non-finite geometry', () => {
  const plan = result(Array.from({ length: 10000 }, (_, i) => incident(i + 1, 1, i * 2, i * 2 + 1, { objectName: 'Объект '.repeat(100) })));
  const layout = timelineLayout(plan);
  assert.equal(layout.lanes[0].items.length, 10000); assert.equal(layout.lanes[0].tracks, 1); assert.equal(layout.lanes[0].busySeconds, 10000);
});
