from datetime import datetime, timedelta, timezone
import logging
from threading import Thread

from sqlmodel import Session, select

from algorithm.models import EMBEDDED_EMPLOYEE_IDS, Solution
from algorithm.solver import evaluate, evaluation_report
from core.db import engine
from modules.infra_loader.loader import _consistent_cache
from . import algorithm_adapter
from .data import PlanningInput, prepare, validated_problem
from .models import FormationJob, PlanningData

logger = logging.getLogger(__name__)


def public_job(job: FormationJob) -> dict:
    return {"id": job.id, "status": job.status, "progress": job.progress,
            "stage": job.stage, "error": job.error, "result": job.result}


def current(session: Session, user_id: int) -> FormationJob | None:
    return session.exec(select(FormationJob).where(FormationJob.user_id == user_id)
                        .order_by(FormationJob.created_at.desc(), FormationJob.id.desc())).first()


def last_result(session: Session, user_id: int) -> dict | None:
    job = session.exec(select(FormationJob).where(FormationJob.user_id == user_id,
                                                 FormationJob.status == "completed")
                       .order_by(FormationJob.created_at.desc(), FormationJob.id.desc())).first()
    return job.result if job else None


@_consistent_cache
def start(session: Session, user_id: int) -> FormationJob:
    running = session.exec(select(FormationJob).where(FormationJob.status == "running")).first()
    if running:
        if running.user_id == user_id:
            return running  # Idempotent start / reconnect after a lost HTTP response.
        raise RuntimeError("Уже выполняется другой расчёт. Попробуйте позже.")
    snapshot = prepare(session)
    job = FormationJob(user_id=user_id, data_revision=snapshot.revision, created_at=datetime.now(timezone.utc))
    session.add(job)
    session.commit()
    session.refresh(job)
    Thread(target=run_job, args=(job.id, snapshot, session.get_bind()), daemon=True, name="brigade-planner").start()
    return job


@_consistent_cache
def update(job_id: str, revision: str, db_engine, **values) -> bool:
    with Session(db_engine) as session:
        job, state = session.get(FormationJob, job_id), session.get(PlanningData, 1)
        if job is None or state is None or state.revision != revision:
            return False  # Deleted/replaced data: never publish the old result.
        for key, value in values.items():
            setattr(job, key, value)
        session.add(job)
        session.commit()
        return True


def build_result(snapshot: PlanningInput, job_id: str, m2: dict | None) -> dict:
    conflict_model = "zero"
    if m2 is None:
        brigades, incidents = [], []
    else:
        problem = validated_problem(snapshot)
        if {employee.tabel for employee in problem.employees} == set(EMBEDDED_EMPLOYEE_IDS):
            conflict_model = "embedded"
        solution = Solution.from_dict(m2)
        # Re-evaluate the output. Never trust schedule/IDs from an arbitrary solver.
        report = evaluation_report(problem, solution, evaluate(problem, solution))
        brigades = [{"brigadeId": row.brigade_id, "employeeIds": list(row.employees)} for row in solution.brigades]
        incidents = [{"eventId": row["event_id"], "objectId": row["object_id"],
                      "objectName": snapshot.objects[row["object_id"]], "resourceType": row["resource"],
                      "occurredAt": row["occurred_at"],
                      "startAt": (snapshot.origin + timedelta(seconds=row["start_seconds"])).isoformat(),
                      "finishAt": (snapshot.origin + timedelta(seconds=row["finish_seconds"])).isoformat(),
                      "baseDurationSeconds": row["base_duration_seconds"], "actualDurationSeconds": row["duration_seconds"],
                      "brigadeId": row["brigade_id"], "sequence": row["sequence"]} for row in report["schedule"]]
    return {"id": job_id, "generatedAt": datetime.now(timezone.utc).isoformat(),
            "dataRevision": snapshot.revision, "employees": snapshot.employees,
            "brigades": brigades, "incidents": incidents, "conflictModel": conflict_model}


def run_job(job_id: str, snapshot: PlanningInput, db_engine=engine) -> None:
    try:
        if not update(job_id, snapshot.revision, db_engine, progress=None, stage="Расчёт составов и расписания"):
            return
        m2 = algorithm_adapter.solve(snapshot.problem)[0] if snapshot.problem["incidents"] else None
        result = build_result(snapshot, job_id, m2)
        update(job_id, snapshot.revision, db_engine, status="completed", progress=100,
               stage="Расписание готово", result=result)
    except Exception as error:
        logger.exception("Brigade formation failed")
        message = str(error) if isinstance(error, algorithm_adapter.AlgorithmError) else "Не удалось сформировать бригады. Проверьте исходные данные и повторите расчёт."
        update(job_id, snapshot.revision, db_engine, status="failed", progress=100,
               stage="Расчёт не выполнен", error=message)


def recover_interrupted(session: Session) -> None:
    for job in session.exec(select(FormationJob).where(FormationJob.status == "running")):
        job.status, job.progress, job.stage = "failed", 100, "Расчёт прерван"
        job.error = "Сервер был перезапущен. Запустите формирование заново."
        session.add(job)
    session.commit()
