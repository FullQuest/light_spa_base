#!/usr/bin/env python3
"""Пакетная генерация M2-решений со случайной матрицей конфликтности.

Запуск без аргументов:
    python3 matrix_search.py                      # с хоста, из корня проекта
    docker compose exec -T api python matrix_search.py   # если файл виден в /api

Каждая итерация:
  1. строит случайную симметричную матрицу K (диагональ 0, значения 0..0.9),
     как в test_on_platform/main.py;
  2. вызывает algorithm.solver.optimize() с этой матрицей (200k итераций / 150 с);
  3. сохраняет пару файлов с одинаковым номером:
     matrix_search/brigades_0001.json  <-> matrix_search/matrix_0001.txt

matrix_NNNN.txt содержит ровно `matrix = ((...), (...))` — кортеж кортежей.
Порядок строк/столбцов — табельные номера рабочих по возрастанию
(тот же порядок, что и в problem.employees); он печатается при старте.

Источник задачи: корневой backup.sql, а если его нет (например, внутри
контейнера API) — согласованный снимок локальной копии внешней БД,
которую синхронизирует infra_loader. Внешняя БД не изменяется.

Повторный запуск продолжает нумерацию и не перезаписывает готовые пары.
Остановка: Ctrl+C или лимит MAX_RUNS.
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
import time
from pathlib import Path

# --- Параметры поиска: правятся здесь, аргументов командной строки нет. -------
MAX_RUNS = 9999              # жёсткий предел числа вызовов
SEARCH_ITERATIONS = 200_000  # бюджет итераций отжига на одну задачу
TIME_LIMIT_SECONDS = 150.0   # бюджет времени на одну задачу (как в production)
BASE_SEED = 0                # seed итерации N = BASE_SEED + N (воспроизводимо)
OUTPUT_DIR_NAME = "matrix_search"

HERE = Path(__file__).resolve().parent


def add_import_roots() -> None:
    """Пакет algorithm и модули API доступны и с хоста, и внутри контейнера."""
    for root in (HERE, HERE / "api", Path("/api"), Path.cwd()):
        if ((root / "algorithm").is_dir() or (root / "modules").is_dir()) and str(root) not in sys.path:
            sys.path.insert(0, str(root))


def load_problem():
    from algorithm.input import load_backup, problem_from_dict

    for path in (HERE / "backup.sql", Path.cwd() / "backup.sql", Path("/api/backup.sql")):
        if path.is_file():
            return load_backup(path), f"дамп {path}"

    # Дампа нет — берём тот же вход, что и приложение при формировании бригад.
    from sqlmodel import Session
    from core.db import engine
    from modules.planning.data import prepare

    with Session(engine) as session:
        snapshot = prepare(session)
    if not snapshot.problem["incidents"]:
        raise ValueError("В локальной БД нет активных аварий: формировать нечего. "
                         "Загрузите данные на странице «Данные графа».")
    return problem_from_dict(snapshot.problem), "локальная БД приложения (снимок infra_loader)"


def random_conflicts(employee_ids: tuple[int, ...], rng: random.Random):
    """Случайная симметричная матрица K с нулевой диагональю, значения 0..0.9."""
    from algorithm.models import ConflictMatrix
    size = len(employee_ids)
    values = [[0.0] * size for _ in range(size)]
    for i in range(size):
        for j in range(i + 1, size):
            value = rng.choice((0, 0, 0, 0, 0, 0.9))
            values[i][j] = values[j][i] = value
    return ConflictMatrix(employee_ids, tuple(tuple(row) for row in values))


def next_index(directory: Path) -> int:
    used = [int(path.stem.rsplit("_", 1)[-1])
            for pattern in ("brigades_*.json", "matrix_*.txt")
            for path in directory.glob(pattern)
            if path.stem.rsplit("_", 1)[-1].isdigit()]
    return max(used, default=0) + 1


def save_pair(directory: Path, index: int, solution_dict: dict, conflicts) -> tuple[Path, Path]:
    json_path = directory / f"brigades_{index:04d}.json"
    matrix_path = directory / f"matrix_{index:04d}.txt"
    json_tmp = json_path.with_name(json_path.name + ".tmp")
    matrix_tmp = matrix_path.with_name(matrix_path.name + ".tmp")
    json_tmp.write_text(json.dumps(solution_dict, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    matrix_tmp.write_text(f"matrix = {conflicts.values}\n", encoding="utf-8")
    # Оба файла публикуются только после успешной записи: незаконченных пар нет.
    json_tmp.replace(json_path)
    matrix_tmp.replace(matrix_path)
    return json_path, matrix_path


def main() -> int:
    add_import_roots()
    directory = HERE / OUTPUT_DIR_NAME
    try:
        from algorithm.models import ConflictMatrix
        from algorithm.solver import optimize

        problem, source = load_problem()
        # Problem — dataclass, доступ только через атрибуты.
        employee_ids = tuple(employee.tabel for employee in problem.employees)
        directory.mkdir(parents=True, exist_ok=True)
        start = next_index(directory)
        if start > MAX_RUNS:
            print(f"Достигнут лимит {MAX_RUNS}: в {directory} уже есть все пары.", flush=True)
            return 0

        print(f"Источник: {source}", flush=True)
        print(f"Рабочих: {len(employee_ids)}, активных инцидентов: {len(problem.incidents)}, "
              f"предшествований: {len(problem.precedences)}", flush=True)
        print(f"Порядок строк матрицы (табельные номера): {employee_ids}", flush=True)
        print(f"Итерации {start}..{MAX_RUNS}, полный прогон алгоритма "
              f"({SEARCH_ITERATIONS} итераций / {TIME_LIMIT_SECONDS} с). "
              f"Каталог: {directory}", flush=True)

        completed = 0
        for index in range(start, MAX_RUNS + 1):
            seed = BASE_SEED + index
            conflicts = random_conflicts(employee_ids, random.Random(seed))
            began = time.monotonic()
            result = optimize(problem, conflicts, seed=seed,
                              iterations=SEARCH_ITERATIONS,
                              time_limit_seconds=TIME_LIMIT_SECONDS)
            solution_dict = result.solution.to_dict()
            json_path, matrix_path = save_pair(directory, index, solution_dict, conflicts)
            completed += 1
            print(f"{index:04d}/{MAX_RUNS}: бригад {len(solution_dict['brigades'])}, "
                  f"Cmax={result.evaluation.makespan_seconds:.3f} с, "
                  f"поиск {time.monotonic() - began:.2f} с -> "
                  f"{json_path.name} + {matrix_path.name}", flush=True)

        print(f"Готово: создано пар {completed}. Каталог: {directory}", flush=True)
        return 0
    except KeyboardInterrupt:
        print("\nОстановлено пользователем. Готовые пары файлов сохранены.", file=sys.stderr, flush=True)
        return 130
    except (ValueError, KeyError, TypeError, OSError, ImportError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
