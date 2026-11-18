"""The only place where the application invokes the brigade algorithm."""
import json
import logging
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from algorithm.input import ROOT
from algorithm.solver import DEFAULT_TIME_LIMIT_SECONDS

logger = logging.getLogger(__name__)


class AlgorithmError(ValueError):
    pass


def solve(problem: dict) -> tuple[dict, dict]:
    """ALGORITHM INTEGRATION POINT — replace this function to plug in a solver.

    Input: normalized employees, incidents and precedences (see README).
    Output: strict M2 JSON and a report with schedule offsets in seconds.
    No database, HTTP or frontend dependencies belong in the algorithm.
    Calls the hybrid solver with the shared 30-second budget and embedded matrix.
    """
    with TemporaryDirectory(prefix="brigades-") as directory:
        work = Path(directory)
        source, output, report = (work / name for name in ("input.json", "m2.json", "report.json"))
        source.write_text(json.dumps(problem, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        # A process isolates CPU work and provides a hard wall-clock timeout.
        try:
            completed = subprocess.run(
                [sys.executable, "-m", "algorithm", "--input", str(source),
                 "--output", str(output), "--report", str(report),
                 "--seed", "0", "--time-limit", str(DEFAULT_TIME_LIMIT_SECONDS)],
                cwd=ROOT, capture_output=True, text=True, timeout=DEFAULT_TIME_LIMIT_SECONDS + 15,
            )
        except subprocess.TimeoutExpired as error:
            raise AlgorithmError("Расчёт превысил допустимое время. Попробуйте снова.") from error
        if completed.returncode:
            logger.error("Algorithm process exited with %s: %s", completed.returncode, completed.stderr.strip())
            raise AlgorithmError("Не удалось построить допустимое расписание. Проверьте квалификации, базовые времена и зависимости.")
        return json.loads(output.read_text(encoding="utf-8")), json.loads(report.read_text(encoding="utf-8"))
