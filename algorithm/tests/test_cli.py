import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from algorithm.input import ROOT


class CLITests(unittest.TestCase):
    def test_exports_strict_m2_and_evaluates_it_without_application(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            output, report = Path(folder) / "m2.json", Path(folder) / "report.json"
            command = [sys.executable, "-m", "algorithm", "--input", "algorithm/examples/demo.json"]
            completed = subprocess.run(command + ["--iterations", "2000", "--output", str(output),
                                                  "--report", str(report)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            m2, details = json.loads(output.read_text()), json.loads(report.read_text())
            self.assertEqual(set(m2), {"brigades"})
            self.assertEqual(details["conflict_model"], "zero_fallback")
            self.assertFalse(details["optimality_proven"])
            checked = subprocess.run(command + ["--evaluate", str(output)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertEqual(json.loads(checked.stdout)["makespan_seconds"], details["makespan_seconds"])

    def test_refuses_to_overwrite_its_input(self):
        path = ROOT / "algorithm/examples/demo.json"
        original = path.read_bytes()
        completed = subprocess.run([sys.executable, "-m", "algorithm", "--input", str(path),
                                    "--output", str(path)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 2)
        self.assertIn("must not overwrite", completed.stderr)
        self.assertEqual(original, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
