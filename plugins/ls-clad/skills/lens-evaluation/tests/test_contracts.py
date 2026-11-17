"""Exercise handoff validation with real media and isolated project files."""

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate-contract.py"
spec = importlib.util.spec_from_file_location("contracts", SCRIPT)
contracts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contracts)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.frames = self.root / "eval_frames" / "run-1"
        self.frames.mkdir(parents=True)
        self.report = "# Lens Under Evaluation\nPrompt.\n\n" + "\n\n".join(contracts.HEADINGS) + "\n"
        self.report_path = self.root / "internal_report.md"
        self.report_path.write_text(self.report)
        self.manifest = {
            "schema_version": 1,
            "run_id": "run-1",
            "frames_dir": str(self.frames),
            "status": "complete",
            "artifacts": [self.artifact("preview", "primary")],
            "primary_artifact_ids": ["preview"],
            "limitations": [],
        }
        self.cleanup = {
            "schema_version": 1,
            "run_id": "run-1",
            "status": "not_needed",
            "changes": [],
            "retained_artifact_ids": [],
            "limitations": [],
        }
        self.output = {
            "schema_version": 1,
            "run_id": "run-1",
            "level": "high",
            "status": "complete",
            "report_path": str(self.report_path),
            "internal_report": self.report,
            "capture_plan": None,
            "capture_manifest": self.manifest,
            "leaf_cleanup": self.cleanup,
            "limitations": [],
        }

    def artifact(self, name, role="supplemental", leaf=False):
        path = self.frames / f"{name}.png"
        Image.new("RGB", (64, 48), "navy").save(path)
        return {
            "id": name,
            "path": str(path),
            "media_type": "image/png",
            "source": "leaf_preview" if leaf else "preview_panel",
            "role": role,
            "phase": "C" if leaf else "B2",
            "scenario_id": "primary-loop" if leaf else None,
            "at_seconds": 1,
            "viewpoint": "default",
            "state": "main activity visible",
            "width": 64,
            "height": 48,
            "sha256": contracts.digest(path),
            "bytes": path.stat().st_size,
            "derived_from": [],
            "sample_interval_seconds": None,
            "playback_fps": None,
            "limitations": [],
            "capture_origin": "automatic" if leaf else "requested",
        }

    def result(self, kind, data):
        return contracts.validate(kind, data)

    def assert_invalid(self, kind, data, text):
        result = self.result(kind, data)
        self.assertFalse(result["ok"], result)
        self.assertIn(text, "\n".join(result["errors"]))

    def test_full_preview_handoff(self):
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])
        judge = {
            "internal_report": self.report,
            "personality": "critic",
            "evaluation_status": "complete",
            "frames_dir": str(self.frames),
            "capture_manifest": self.manifest,
        }
        self.assertTrue(self.result("judge-input", judge)["ok"])
        judge["frames_dir"] = str(self.root)
        self.assert_invalid("judge-input", judge, "must match")

    def test_capture_deleted_after_cleanup_is_rejected(self):
        leaf = self.artifact("leaf", leaf=True)
        self.manifest["artifacts"].append(leaf)
        self.cleanup["retained_artifact_ids"] = ["leaf"]
        Path(leaf["path"]).unlink()
        self.assert_invalid("evaluator-output", self.output, "missing")

    def test_modified_capture_is_rejected(self):
        path = Path(self.manifest["artifacts"][0]["path"])
        Image.new("RGB", (64, 48), "red").save(path)
        self.assert_invalid("capture-manifest", self.manifest, "hash mismatch")

    def test_wrong_dimensions_and_large_image_are_rejected(self):
        a = self.manifest["artifacts"][0]
        a["width"] = 65
        self.assert_invalid("capture-manifest", self.manifest, "dimensions")
        path = Path(a["path"])
        Image.new("RGB", (641, 48), "red").save(path)
        a.update(width=641, sha256=contracts.digest(path), bytes=path.stat().st_size)
        self.assert_invalid("capture-manifest", self.manifest, "640px")

    def test_missing_and_duplicate_artifact_ids(self):
        self.manifest["primary_artifact_ids"] = ["unknown"]
        self.assert_invalid("capture-manifest", self.manifest, "primary_artifact_ids")
        self.manifest["artifacts"].append(copy.deepcopy(self.manifest["artifacts"][0]))
        self.assert_invalid("capture-manifest", self.manifest, "IDs must be unique")

    def test_symlink_cannot_escape_evidence_directory(self):
        a = self.manifest["artifacts"][0]
        original = Path(a["path"])
        outside = self.root / "outside.png"
        original.rename(outside)
        original.symlink_to(outside)
        self.assert_invalid("capture-manifest", self.manifest, "escapes")

    def test_automatic_leaf_captures_survive_completed_cleanup(self):
        for i in range(4):
            a = self.artifact(f"leaf-{i}", leaf=True)
            self.manifest["artifacts"].append(a)
            self.cleanup["retained_artifact_ids"].append(a["id"])
        self.cleanup["status"] = "complete"
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])
        self.assertTrue(all(Path(a["path"]).is_file() for a in self.manifest["artifacts"]))
        self.cleanup["retained_artifact_ids"].pop()
        self.assert_invalid("evaluator-output", self.output, "every LEAF capture")

    def test_medium_is_one_overview_still_and_no_leaf(self):
        self.output["level"] = "medium"
        for i in range(2):
            self.manifest["artifacts"].append(self.artifact(f"requested-{i}"))
        self.assert_invalid("evaluator-output", self.output, "one overview still")
        self.manifest["artifacts"] = [a for a in self.manifest["artifacts"] if not a["id"].startswith("requested-")]
        leaf = self.artifact("leaf", leaf=True)
        self.manifest["artifacts"].append(leaf)
        self.cleanup["retained_artifact_ids"] = ["leaf"]
        self.assert_invalid("evaluator-output", self.output, "runs no LEAF")

    def test_pending_cleanup_and_mixed_runs_rejected(self):
        self.cleanup["status"] = "pending"
        self.assert_invalid("evaluator-output", self.output, "terminal")
        self.cleanup["run_id"] = "different-run"
        self.assert_invalid("evaluator-output", self.output, "same run")

    def test_preexisting_files_cannot_be_marked_removed(self):
        self.cleanup["changes"] = [
            {
                "id": "existing-index",
                "kind": "file",
                "target": str(self.root / "LeafIndex.ts"),
                "existed_before": True,
                "before_state": "original",
                "evaluation_state": "instrumented",
                "backup_path": None,
                "before_sha256": None,
                "evaluation_sha256": "a" * 64,
                "disposition": "removed",
                "reason": "test-owned",
            }
        ]
        self.cleanup["status"] = "complete"
        self.assert_invalid("leaf-cleanup", self.cleanup, "removed")

    def test_restoration_requires_matching_original_file(self):
        target = self.root / "LeafIndex.ts"
        backup = self.root / "LeafIndex.backup"
        backup.write_text("original user scenarios")
        target.write_text("concurrent user edit")
        self.cleanup["changes"] = [
            {
                "id": "existing-index",
                "kind": "file",
                "target": str(target),
                "existed_before": True,
                "before_state": "original",
                "evaluation_state": "evaluation scenarios",
                "backup_path": str(backup),
                "before_sha256": contracts.digest(backup),
                "evaluation_sha256": "a" * 64,
                "disposition": "restored",
                "reason": "restored backup",
            }
        ]
        self.cleanup["status"] = "complete"
        self.assert_invalid("leaf-cleanup", self.cleanup, "does not match original")
        self.assertEqual(target.read_text(), "concurrent user edit")
        self.cleanup["changes"][0]["disposition"] = "retained_conflict"
        self.cleanup.update(status="partial", limitations=["Concurrent edit preserved"])
        self.output.update(status="partial", limitations=["Cleanup conflict"])
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])

    def test_saved_report_must_match_inline_text(self):
        self.output["internal_report"] += "changed"
        self.assert_invalid("evaluator-output", self.output, "exactly match")

    def test_unknown_inputs_rejected_and_prompt_required(self):
        self.assert_invalid("evaluator-input", {"level": "medium"}, "description")
        self.assert_invalid("skill-input", {"level": "medium"}, "description")
        self.assert_invalid("evaluator-input", {"level": "medium", "description": "fish", "code": "x"}, "Additional")

    def test_nullable_scores_require_explanations(self):
        names = [
            "alignment_of_prompt_to_result",
            "interaction_fidelity",
            "spatial_usage",
            "asset_quality",
            "visual_quality",
            "cognitive_load",
            "overall_quality",
            "expected_engagement",
            "global_score",
        ]
        data = {
            "scores": dict.fromkeys(names, 7),
            "comments": {},
            "global_score_rationale": "Holistic",
            "bottom_line": "A readable little aquarium.",
            "improvements": [],
        }
        self.assertTrue(self.result("judge-output", data)["ok"])
        data["scores"]["visual_quality"] = None
        self.assert_invalid("judge-output", data, "visual_quality")
        data["comments"]["visual_quality"] = "Capture unavailable."
        self.assertTrue(self.result("judge-output", data)["ok"])
        data["scores"]["asset_quality"] = True
        self.assert_invalid("judge-output", data, "integer")

    def test_discovery_is_plan_only_and_cannot_include_leaf(self):
        self.output.update(
            level="discovery",
            internal_report="## Capture Plan\nUnavailable.\n",
            status="blocked",
            limitations=["MCP unreachable"],
        )
        self.report_path.write_text(self.output["internal_report"])
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])
        a = self.artifact("leaf", leaf=True)
        self.manifest["artifacts"].append(a)
        self.cleanup["retained_artifact_ids"] = ["leaf"]
        self.assert_invalid("evaluator-output", self.output, "Discovery")

    def test_capture_plan_timeline_and_level_limits(self):
        plan = {
            "schema_version": 1,
            "level": "high",
            "validation_state": "unverified",
            "lens": "demo",
            "subject": "Root",
            "timeline": [{"t": 3000, "op": "shot", "label": "end"}, {"t": 1000, "op": "shot", "label": "start"}],
            "notes": "payoff reached by tapping Start",
            "limitations": ["not run"],
        }
        self.assert_invalid("capture-plan", plan, "chronological")
        plan["timeline"].reverse()
        self.assertTrue(self.result("capture-plan", plan)["ok"])
        # medium: exactly one overview capture, no camera moves
        plan["level"] = "medium"
        self.assert_invalid("capture-plan", plan, "one overview capture")
        plan["timeline"] = [{"t": 1000, "op": "shot", "label": "overview"}]
        self.assertTrue(self.result("capture-plan", plan)["ok"])
        for step in (
            {"t": 2000, "op": "burst", "label": "motion"},  # driver default: 10 frames
            {"t": 2000, "op": "record", "label": "footage"},  # 5 s at 3 fps
        ):
            self.assert_invalid("capture-plan", {**plan, "timeline": plan["timeline"] + [step]}, "one overview capture")
        moved = {**plan, "timeline": [{"t": 0, "op": "move_camera", "commands": []}] + plan["timeline"]}
        self.assert_invalid("capture-plan", moved, "cannot move the camera")
        plan["validation_state"], plan["limitations"] = "blocked", []
        self.assert_invalid("capture-plan", plan, "needs a limitation")

    def test_strict_json_rejects_duplicates_and_nonfinite(self):
        path = self.root / "bad.json"
        for text in ('{"level":"medium","level":"fast"}', '{"at_seconds":NaN}'):
            path.write_text(text)
            with self.assertRaises(ValueError):
                contracts.read_json(path)
        path.write_text(json.dumps({"at_seconds": 1}))
        self.assertEqual(contracts.read_json(path), {"at_seconds": 1})

    def test_motion_gif_keeps_ordered_sources(self):
        parents = [self.artifact("motion-0", "motion_frame"), self.artifact("motion-1", "motion_frame")]
        parents[1]["at_seconds"] = 2
        gif = self.artifact("motion", "motion_gif")
        path = Path(gif["path"]).with_suffix(".gif")
        frames = [Image.new("RGB", (64, 48), color) for color in ("red", "blue")]
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=1000, loop=0)
        gif.update(
            path=str(path),
            media_type="image/gif",
            sha256=contracts.digest(path),
            bytes=path.stat().st_size,
            derived_from=[p["id"] for p in parents],
            sample_interval_seconds=1,
            playback_fps=1,
        )
        self.manifest["artifacts"].extend(parents + [gif])
        self.output["level"] = "high"
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])
        gif["derived_from"].reverse()
        self.assert_invalid("evaluator-output", self.output, "increasing timestamps")

    def test_unknown_automatic_capture_time_requires_explanation(self):
        leaf = self.artifact("leaf-unknown-time", leaf=True)
        leaf["at_seconds"] = None
        self.manifest["artifacts"].append(leaf)
        self.assert_invalid("capture-manifest", self.manifest, "limitations")
        leaf["limitations"] = ["LEAF did not provide a reliable capture timestamp"]
        self.assertTrue(self.result("capture-manifest", self.manifest)["ok"])

    def test_partial_and_blocked_handoffs_without_captures(self):
        self.manifest.update(
            status="unavailable",
            artifacts=[],
            primary_artifact_ids=[],
            frames_dir=None,
            limitations=["Capture tool unavailable"],
        )
        self.output.update(status="partial", limitations=["Visuals unverified"])
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])
        self.output.update(status="blocked", report_path=None)
        self.assertTrue(self.result("evaluator-output", self.output)["ok"])

    def test_summary_counts_only_assessed_scores(self):
        schema = contracts.read_json(contracts.SCHEMA)
        metrics = schema["$defs"]["judge-output"]["properties"]["scores"]["properties"]
        judge = {
            "scores": dict.fromkeys(metrics, 8),
            "comments": {},
            "global_score_rationale": "Holistic",
            "bottom_line": "Visible payoff",
            "improvements": [],
        }
        data = {
            "schema_version": 1,
            "level": "medium",
            "status": "partial",
            "summary": "Partial review",
            "evaluation_result_path": None,
            "improvements_path": None,
            "judge_results": [{"persona": "critic", "result": judge}],
            "unavailable_judges": ["scientist"],
            "panel_score": 8,
            "panel_judge_count": 1,
            "limitations": ["Scientist unavailable"],
        }
        self.assertTrue(self.result("skill-output", data)["ok"])
        data["panel_judge_count"] = 2
        self.assert_invalid("skill-output", data, "score/count")
        data["panel_judge_count"] = 0
        data["panel_score"] = None
        judge["scores"]["global_score"] = None
        self.assertTrue(self.result("skill-output", data)["ok"])
        data["level"] = "discovery"
        self.assert_invalid("skill-output", data, "cannot have a judge panel")


if __name__ == "__main__":
    unittest.main()
