"""Standalone brigade formation and precedence-constrained scheduling."""

from .models import Brigade, ConflictMatrix, Employee, Incident, Problem, Solution
from .solver import evaluate, optimize

__all__ = [
    "Brigade", "ConflictMatrix", "Employee", "Incident", "Problem", "Solution",
    "evaluate", "optimize",
]
