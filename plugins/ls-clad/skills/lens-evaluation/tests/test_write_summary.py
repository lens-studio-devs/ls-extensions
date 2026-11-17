"""write-summary.py builds, validates and only then writes evaluation_summary.json."""

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


contracts = load("contracts", "validate-contract.py")
writer = load("write_summary", "write-summary.py")
METRICS = list(contracts.read_json(contracts.SCHEMA)["$defs"]["judge-output"]["properties"]["scores"]["properties"])


def judge(score):
    scores = dict.fromkeys(METRICS, 7)
    scores["global_score"] = score
    return {
        "scores": scores,
        "comments": {},
        "global_score_rationale": "Holistic",
        "bottom_line": "A readable little aquarium.",
        "improvements": [],
    }


class WriteSummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.lens = Path(self.temp.name)
        (self.lens / "summary.md").write_text("## Review\nWorks.\n")
        self.out = self.lens / "evaluation_summary.json"

    def run_writer(self, judges, *extra, level="medium", status="partial"):
        path = self.lens / "judges.json"
        path.write_text(json.dumps(judges))
        argv = [
            "--lens-folder",
            str(self.lens),
            "--level",
            level,
            "--status",
            status,
            "--summary-file",
            str(self.lens / "summary.md"),
            "--judges",
            str(path),
            *(["--limitation", "Evaluator result not validated"] if status == "partial" else []),
            *extra,
        ]
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = writer.main(argv)
        return rc, json.loads(buf.getvalue())

    def test_valid_panel_is_written_with_the_computed_score(self):
        rc, report = self.run_writer({"critic": judge(6), "scientist": judge(9)})
        self.assertEqual(rc, 0, report)
        self.assertEqual((report["panel_score"], report["panel_judge_count"]), (7.5, 2))
        data = json.loads(self.out.read_text())
        self.assertEqual(data["panel_score"], 7.5)
        self.assertEqual([j["persona"] for j in data["judge_results"]], ["critic", "scientist"])
        self.assertTrue(contracts.validate("skill-output", data)["ok"])

    def test_unassessed_scores_are_left_out_of_the_mean(self):
        rc, report = self.run_writer({"critic": judge(None), "scientist": judge(8)})
        self.assertEqual(rc, 0, report)
        self.assertEqual((report["panel_score"], report["panel_judge_count"]), (8, 1))

    def test_list_form_and_unavailable_judges(self):
        rc, report = self.run_writer(
            [{"persona": "critic", "result": judge(5)}],
            "--unavailable",
            "scientist",
            "--limitation",
            "Scientist timed out",
        )
        self.assertEqual(rc, 0, report)
        data = json.loads(self.out.read_text())
        self.assertEqual(data["unavailable_judges"], ["scientist"])
        self.assertEqual(data["limitations"], ["Evaluator result not validated", "Scientist timed out"])

    def test_complete_run_needs_a_saved_evaluator_result(self):
        rc, report = self.run_writer({"critic": judge(6), "scientist": judge(9)}, status="complete")
        self.assertEqual(rc, 1)
        self.assertIn("needs a saved evaluator result", "\n".join(report["errors"]))
        self.assertFalse(self.out.exists())

    def test_invalid_envelope_is_not_written_and_a_stale_file_is_removed(self):
        self.out.write_text('{"stale": true}')
        rc, report = self.run_writer({"critic": judge(11)})  # out of range
        self.assertEqual(rc, 1)
        self.assertFalse(report["ok"])
        self.assertTrue(report["errors"])
        self.assertFalse(self.out.exists())

    def test_unreadable_judges_file_is_an_error(self):
        (self.lens / "judges.json").write_text("not json")
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = writer.main(
                [
                    "--lens-folder",
                    str(self.lens),
                    "--level",
                    "medium",
                    "--status",
                    "complete",
                    "--summary-file",
                    str(self.lens / "summary.md"),
                    "--judges",
                    str(self.lens / "judges.json"),
                ]
            )
        self.assertEqual(rc, 1)
        self.assertFalse(self.out.exists())

    def test_without_jsonschema_the_summary_is_written_as_partial(self):
        saved = writer.jsonschema_available
        writer.jsonschema_available = lambda: False
        try:
            rc, report = self.run_writer({"critic": judge(6), "scientist": judge(9)}, status="complete")
        finally:
            writer.jsonschema_available = saved
        self.assertEqual(rc, 0, report)
        self.assertFalse(report["validated"])
        data = json.loads(self.out.read_text())
        self.assertEqual(data["status"], "partial")
        self.assertIn("Schema validation skipped: jsonschema is not installed.", data["limitations"])
        self.assertEqual(data["panel_score"], 7.5)

    def test_a_failed_write_leaves_no_temp_file(self):
        saved = writer.json.dump
        writer.json.dump = lambda *a, **k: (_ for _ in ()).throw(OSError("disk full"))
        try:
            rc, report = self.run_writer({"critic": judge(6), "scientist": judge(9)})
        finally:
            writer.json.dump = saved
        self.assertEqual(rc, 1)
        self.assertIn("disk full", report["errors"][0])
        self.assertEqual([p.name for p in self.lens.glob(".evaluation_summary.*")], [])
        self.assertFalse(self.out.exists())

    def test_any_error_still_prints_one_json_line(self):
        saved = writer.build
        writer.build = lambda args: (_ for _ in ()).throw(TypeError("unexpected"))
        try:
            rc, report = self.run_writer({"critic": judge(6)})
        finally:
            writer.build = saved
        self.assertEqual(rc, 1)
        self.assertFalse(report["ok"])
        self.assertIn("TypeError: unexpected", report["errors"][0])

    def test_cleanup_failure_still_prints_one_json_line(self):
        saved_build, saved_unlink = writer.build, Path.unlink
        writer.build = lambda args: (_ for _ in ()).throw(TypeError("unexpected"))

        def unlink(self, missing_ok=False):
            raise PermissionError("read-only")

        Path.unlink = unlink
        try:
            rc, report = self.run_writer({"critic": judge(6)})
        finally:
            writer.build, Path.unlink = saved_build, saved_unlink
        self.assertEqual(rc, 1)
        self.assertIn("TypeError: unexpected", report["errors"][0])


if __name__ == "__main__":
    unittest.main()
