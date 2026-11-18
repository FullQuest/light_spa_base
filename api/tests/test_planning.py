"""Planning lifecycle on an isolated SQLite database; no production data writes."""
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sqlmodel import Session, SQLModel, create_engine, select

from modules.infra_loader import loader
from modules.infra_loader.models import Qualification
from modules.planning import algorithm_adapter, data, service
from modules.planning.models import FormationJob, PlanningData
from test_auth import ApiTestCase


def fixture():
    return {
        "statuses": [{"id_status": 1, "name": "Активная авария"}, {"id_status": 2, "name": "Норма"}],
        "edifices": [dict(id_edifice=i, name=f"Объект {i}", resource_type=["water"], district="", street="", house_number="") for i in (1, 2, 3)],
        "dependencies": [dict(resource_type="water", id_edifice_source=a, id_edifice_dependent=b) for a,b in ((1,2),(2,3))],
        "events": [dict(id_event=i, id_status=1, id_edifice=i, resource_type="water", occurred_at=datetime(2026,1,1)) for i in (1,3)],
        "time_resolves": [dict(id_time=i, id_edifice=i, resource_type="water", avg_resolution_time=timedelta(seconds=100)) for i in (1,3)],
        "employees": [dict(tabel=i, first_name=None, last_name=f"Рабочий {i}", middle_name=None, start_date_experience=None) for i in (1,2)],
        "qualifications": [dict(id_qualification=i, id_employee=i, resource_type="water", proff=5.0) for i in (1,2)],
    }


M2 = {"brigades": [{"brigade_id": 1, "employees": [1,2], "event_order": [1,3]}]}


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.temp.name}/test.db", connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)
        loader._replace_local(self.session, fixture())

    def start(self):
        with patch.object(service, "Thread"):
            return service.start(self.session, 1)

    def test_roster_nulls_and_transitive_dependency_input(self):
        snapshot = data.prepare(self.session)
        self.assertEqual(snapshot.problem["precedences"], ((1,3),))
        self.assertEqual(snapshot.problem["incidents"][0]["base_duration_seconds"], 100)
        self.assertEqual(snapshot.employees[0]["qualifications"][0]["proff"], 5)
        self.assertIsNone(snapshot.employees[0]["start_date_experience"])

    def test_real_algorithm_adapter_runs_from_installed_package_root(self):
        # Two employees / two events have one feasible partition; the solver is quick.
        from algorithm.models import Solution
        from algorithm.solver import evaluate
        snapshot = data.prepare(self.session)
        m2, report = algorithm_adapter.solve(snapshot.problem)
        self.assertEqual(evaluate(data.validated_problem(snapshot), Solution.from_dict(m2)).makespan_seconds, 100)
        self.assertEqual(report["incident_count"],2)

    def test_completion_validates_m2_and_saves_real_intervals(self):
        snapshot = data.prepare(self.session)
        job = self.start()
        with patch.object(algorithm_adapter, "solve", return_value=(M2, {})):
            service.run_job(job.id, snapshot, self.engine)
        self.session.expire_all()
        result = service.last_result(self.session, 1)
        self.assertEqual(len(result["incidents"]), 2)
        a,b = result["incidents"]
        self.assertEqual(a["actualDurationSeconds"], 50)
        self.assertEqual(a["finishAt"], b["startAt"])
        self.assertGreaterEqual(datetime.fromisoformat(a["startAt"]), datetime.fromisoformat(a["occurredAt"]))
        self.assertIsNone(service.last_result(self.session, 2))

    def test_same_data_keeps_result_changed_data_invalidates_it(self):
        job = self.start()
        revision = self.session.get(PlanningData,1).revision
        loader._replace_local(self.session, fixture())
        self.assertEqual(self.session.get(PlanningData,1).revision, revision)
        self.assertIsNotNone(self.session.get(FormationJob,job.id))
        changed = deepcopy(fixture())
        changed["qualifications"][0]["proff"] = 6.0
        loader._replace_local(self.session, changed)
        self.session.expire_all()
        self.assertNotEqual(self.session.get(PlanningData,1).revision, revision)
        self.assertIsNone(self.session.get(FormationJob,job.id))

    def test_delete_during_calculation_cannot_resurrect_result(self):
        snapshot, job = data.prepare(self.session), self.start()
        def clear(_):
            loader.delete_all(self.session)
            return M2, {}
        with patch.object(algorithm_adapter, "solve", side_effect=clear):
            service.run_job(job.id, snapshot, self.engine)
        self.assertEqual(list(self.session.exec(select(FormationJob))), [])
        self.assertEqual(data.employees(self.session), [])

    def test_error_keeps_previous_success_and_invalid_solver_output_is_rejected(self):
        first = self.start()
        service.update(first.id, first.data_revision, self.engine, status="completed", result={"id":"saved"})
        self.session.expire_all()
        job, snapshot = self.start(), data.prepare(self.session)
        with patch.object(algorithm_adapter, "solve", return_value=({"brigades": []}, {})):
            service.run_job(job.id, snapshot, self.engine)
        self.session.expire_all()
        self.assertEqual(service.current(self.session,1).status, "failed")
        self.assertEqual(service.last_result(self.session,1), {"id":"saved"})

    def test_no_incidents_does_not_call_algorithm(self):
        changed = fixture(); changed["events"] = []
        loader._replace_local(self.session, changed)
        job, snapshot = self.start(), data.prepare(self.session)
        with patch.object(algorithm_adapter,"solve") as solve:
            service.run_job(job.id,snapshot,self.engine)
        self.session.expire_all()
        self.assertEqual(service.last_result(self.session,1)["incidents"], [])
        solve.assert_not_called()

    def test_invalid_import_does_not_erase_qualifications_or_jobs(self):
        job = self.start()
        changed = fixture(); changed["qualifications"][0]["id_employee"] = 404
        with self.assertRaises(ValueError):
            loader._replace_local(self.session, changed)
        self.assertEqual(len(list(self.session.exec(select(Qualification)))),2)
        self.assertIsNotNone(self.session.get(FormationJob,job.id))

    def test_double_start_and_restart_recovery(self):
        job = self.start()
        self.assertEqual(self.start().id, job.id)
        with self.assertRaises(RuntimeError):
            service.start(self.session, 2)
        service.recover_interrupted(self.session)
        self.assertEqual(service.current(self.session,1).status,"failed")


class PlanningAccessTests(ApiTestCase):
    def test_planning_requires_login_and_regular_users_can_read(self):
        for path in ("/api/workforce/employees", "/api/brigades/result", "/api/brigades/jobs/current", "/api/brigades/jobs/missing"):
            self.assertEqual(self.request(path)[0],401)
        self.assertEqual(self.request('/api/brigades/jobs',method='POST')[0],401)
        self.register('planner@example.test')
        token = self.login('planner@example.test')[1]['access_token']
        self.assertEqual(self.request('/api/brigades/result',token=token)[:2],(200,None))
        self.assertEqual(self.request('/api/brigades/jobs/missing',token=token)[0],404)
