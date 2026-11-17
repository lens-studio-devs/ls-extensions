"""The capture runner's machine-owned output: the draft manifest and the MCP reply parser."""

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


contracts = load("contracts", "validate-contract.py")
driver = load("capture_driver", "capture_driver.py")
mcp_client = load("mcp_client", "mcp_client.py")


class DraftManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.shots = self.root / "capture_driver"
        self.shots.mkdir()

    def frame(self, name, color, size=(64, 48)):
        path = self.shots / name
        Image.new("RGB", size, color).save(path)
        return str(path)

    def timeline_result(self):
        return {
            "timeline_run": [
                {
                    "op": "shot",
                    "t_actual_s": 0.5,
                    "fps": 3.0,
                    "method": "M2",
                    "frames": [self.frame("tl00_start_00.png", "navy")],
                },
                {"op": "wait", "t_actual_s": 1.0, "fps": 3.0, "method": None, "frames": []},
                {
                    "op": "burst",
                    "t_actual_s": 2.0,
                    "fps": 4.0,
                    "method": "M1",
                    "frames": [
                        self.frame(f"tl02_motion_{k:02d}.png", c) for k, c in enumerate(("red", "green", "blue"))
                    ],
                },
            ]
        }

    def draft(self):
        path = driver.emit_manifest(self.timeline_result(), self.root / "eval_frames" / "run-1")
        return path, json.loads(path.read_text())

    def test_machine_fields_are_measured(self):
        path, manifest = self.draft()
        self.assertEqual(path.name, "capture_manifest.json")
        self.assertEqual(manifest["run_id"], "run-1")
        self.assertEqual(manifest["status"], "complete")
        arts = manifest["artifacts"]
        ids = ["tl00_start_00", "tl02_motion_00", "tl02_motion_01", "tl02_motion_02"]
        self.assertEqual([a["id"] for a in arts], ids)
        self.assertEqual([a["at_seconds"] for a in arts], [0.5, 2.0, 2.25, 2.5])
        self.assertEqual([a["role"] for a in arts], ["progression"] + ["motion_frame"] * 3)
        self.assertEqual({a["source"] for a in arts}, {"preview_panel"})
        self.assertIsNone(arts[0]["sample_interval_seconds"])
        self.assertEqual(arts[1]["sample_interval_seconds"], 0.25)
        for a in arts:
            copy = Path(a["path"])
            self.assertEqual(copy.parent, path.parent.resolve())
            self.assertEqual((a["width"], a["height"]), (64, 48))
            self.assertEqual(a["sha256"], contracts.digest(copy))
            self.assertEqual(a["bytes"], copy.stat().st_size)

    def test_recorded_frames_are_labelled_as_recording(self):
        result = {
            "timeline_run": [
                {
                    "op": "record",
                    "t_actual_s": 1.0,
                    "fps": 2.0,
                    "method": "M3",
                    "frames": [self.frame(f"tl00_footage_{k:02d}.png", c) for k, c in enumerate(("red", "blue"))],
                }
            ]
        }
        manifest = json.loads(driver.emit_manifest(result, self.root / "eval_frames" / "run-3").read_text())
        self.assertEqual({a["source"] for a in manifest["artifacts"]}, {"preview_recording"})
        self.assertEqual([a["at_seconds"] for a in manifest["artifacts"]], [1.0, 1.5])
        for a in manifest["artifacts"]:
            a.update(viewpoint="default user view", state="payoff animating")
        self.assertTrue(contracts.validate("capture-manifest", manifest)["ok"])

    def test_unfilled_draft_fails_until_judgment_fields_are_set(self):
        _, manifest = self.draft()
        result = contracts.validate("capture-manifest", manifest)
        self.assertFalse(result["ok"], result)
        for a in manifest["artifacts"]:
            a["viewpoint"] = "default user view"
            a["state"] = "payoff visible"
        manifest["artifacts"][0]["role"] = "primary"
        manifest["primary_artifact_ids"] = ["tl00_start_00"]
        result = contracts.validate("capture-manifest", manifest)
        self.assertTrue(result["ok"], result)

    def test_empty_timeline_is_unavailable_with_a_limitation(self):
        path = driver.emit_manifest({"timeline_run": []}, self.root / "eval_frames" / "run-2")
        manifest = json.loads(path.read_text())
        self.assertEqual(manifest["status"], "unavailable")
        self.assertEqual(manifest["artifacts"], [])
        self.assertTrue(manifest["limitations"])
        self.assertTrue(contracts.validate("capture-manifest", manifest)["ok"])


class MethodGateTests(unittest.TestCase):
    """Linux workaround: recordVideo (M3) takes the MCP server down on Linux, so it never runs there."""

    def test_linux_never_uses_m3(self):
        self.assertEqual(driver.method_gate(["M3", "M2", "M1"], "Linux"), ["M2", "M1"])
        self.assertEqual(driver.method_gate(None, "Linux"), ["M2", "M1"])
        self.assertEqual(driver.method_gate(["M3"], "Linux"), ["M2", "M1"])
        self.assertEqual(driver.method_gate(None, "Linux", "M3"), ["M2", "M1"])

    def test_macos_keeps_the_full_chain_and_reentry(self):
        self.assertEqual(driver.method_gate(None, "Darwin"), ["M3", "M2", "M1"])
        self.assertEqual(driver.method_gate(["M2", "M3", "M1"], "Darwin"), ["M2", "M3", "M1"])
        self.assertEqual(driver.method_gate(None, "Darwin", "M2"), ["M2", "M1"])
        self.assertEqual(driver.method_gate(["M9", "M1"], "Darwin"), ["M1"])
        self.assertEqual(driver.method_gate(["M9"], "Darwin"), ["M2", "M1"])

    def test_record_action_is_checked_in(self):
        self.assertTrue(driver.RECORD_ACTION.is_file(), driver.RECORD_ACTION)
        self.assertNotIn("refresh(", driver.RECORD_ACTION.read_text().split("const input")[1])


class TimelineFallbackTests(unittest.TestCase):
    """run_timeline honours the method order and falls back on failed, frozen or 1-frame captures."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.calls = []
        self.plan = {}  # method -> frame count it returns

    def fake(self, method):
        def run(m, out, a, *rest):
            self.calls.append(method)
            n = self.plan.get(method, 3)
            frames = []
            for k in range(n):
                f = out / f"{method.lower()}_fake_{k:02d}.png"
                Image.new("RGB", (8, 8), (40 * k, 10, 200)).save(f)
                frames.append(str(f))
            return {"method": method, "ok": n > 0, "mechanical_error": None if n else "no frames", "frames": frames}

        return run

    def run_ops(self, ops, order):
        patches = {"do_m3": self.fake("M3"), "do_m2": self.fake("M2"), "do_m1": self.fake("M1")}
        saved = {k: getattr(driver, k) for k in patches}
        for k, v in patches.items():
            setattr(driver, k, v)
        try:
            a = type("A", (), {"frames": 3, "fps": 3.0, "record_ms": 1000, "max": 640})()
            result = {"attempted": []}
            poses = [{"x": 0, "y": 0, "z": 0}]
            driver.run_timeline(None, self.out, a, ops, None, None, None, poses, result, order)
            return result
        finally:
            for k, v in saved.items():
                setattr(driver, k, v)

    def test_record_skips_m3_when_not_in_order(self):
        result = self.run_ops([{"t": 0, "op": "record", "label": "footage", "ms": 1000}], ["M2", "M1"])
        self.assertEqual(self.calls, ["M2"])
        self.assertEqual(result["timeline_run"][0]["method"], "M2")

    def test_one_frame_recording_degrades_to_a_burst(self):
        self.plan = {"M3": 1}
        result = self.run_ops([{"t": 0, "op": "record", "label": "footage", "ms": 1000}], ["M3", "M2", "M1"])
        self.assertEqual(self.calls, ["M3", "M2"])
        self.assertTrue(result["timeline_run"][0]["ok"])

    def test_one_frame_burst_falls_back_to_m1(self):
        self.plan = {"M2": 1}
        result = self.run_ops([{"t": 0, "op": "burst", "label": "motion", "frames": 3}], ["M2", "M1"])
        self.assertEqual(self.calls, ["M2", "M1"])
        self.assertEqual(result["timeline_run"][0]["method"], "M1")

    def test_start_method_m1_skips_m2(self):
        self.run_ops([{"t": 0, "op": "burst", "label": "motion", "frames": 3}], ["M1"])
        self.assertEqual(self.calls, ["M1"])

    def test_methods_outside_the_order_never_run(self):
        result = self.run_ops([{"t": 0, "op": "shot", "label": "start"}], ["M3"])
        self.assertEqual(self.calls, [])
        step = result["timeline_run"][0]
        self.assertFalse(step["ok"])
        self.assertIn("no method in ['M3'] can capture a shot", step["error"])

    def test_single_shot_is_not_degenerate(self):
        self.plan = {"M2": 1}
        result = self.run_ops([{"t": 0, "op": "shot", "label": "start"}], ["M2", "M1"])
        self.assertEqual(self.calls, ["M2"])
        self.assertTrue(result["timeline_run"][0]["ok"])


class ParseResponseTests(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(mcp_client.parse_response('{"jsonrpc":"2.0","id":3,"result":{"x":1}}', 3)["result"], {"x": 1})

    def test_sse_picks_the_reply_not_the_last_line(self):
        raw = "\n".join(
            [
                'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
                'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
                'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
                "data: not json",
            ]
        )
        self.assertEqual(mcp_client.parse_response(raw, 7), {"jsonrpc": "2.0", "id": 7, "result": {"ok": True}})

    def test_sse_prefers_the_matching_id(self):
        raw = 'data: {"id":1,"result":"old"}\ndata: {"id":2,"result":"mine"}\ndata: {"id":9,"result":"other"}'
        self.assertEqual(mcp_client.parse_response(raw, 2)["result"], "mine")

    def test_error_reply_is_kept(self):
        reply = mcp_client.parse_response('{"id":4,"error":{"code":-32601,"message":"no such tool"}}', 4)
        self.assertEqual(reply["error"]["code"], -32601)

    def test_non_rpc_bodies_become_errors(self):
        for raw in ("<html>login</html>", '{"id": 1, "resu', "", 'data: {"method":"notifications/progress"}'):
            reply = mcp_client.parse_response(raw, 1)
            self.assertNotIn("result", reply, raw)
            self.assertEqual(reply["error"]["code"], -32700, raw)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg + ffprobe")
class VideoArtifactTests(unittest.TestCase):
    def test_mp4_dimensions_and_container_are_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            frames = Path(temp)
            clip = frames / "clip.mp4"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x48:d=1"]
                + ["-pix_fmt", "yuv420p", str(clip)],
                check=True,
            )
            art = {
                "id": "clip",
                "path": str(clip),
                "media_type": "video/mp4",
                "source": "leaf_preview",
                "role": "supplemental",
                "phase": "C",
                "scenario_id": "primary-loop",
                "at_seconds": 1,
                "viewpoint": "default",
                "state": "loop running",
                "width": 64,
                "height": 48,
                "sha256": contracts.digest(clip),
                "bytes": clip.stat().st_size,
                "derived_from": [],
                "sample_interval_seconds": None,
                "playback_fps": None,
                "limitations": [],
                "capture_origin": "automatic",
            }
            manifest = {
                "schema_version": 1,
                "run_id": "run-1",
                "frames_dir": str(frames),
                "status": "complete",
                "artifacts": [art],
                "primary_artifact_ids": [],
                "limitations": [],
            }
            self.assertTrue(contracts.validate("capture-manifest", manifest)["ok"])
            art["width"] = 65
            result = contracts.validate("capture-manifest", manifest)
            self.assertIn("dimensions", "\n".join(result["errors"]))
            gif = frames / "clip.gif"
            Image.new("RGB", (64, 48), "red").save(gif)
            art.update(path=str(gif), width=64, sha256=contracts.digest(gif), bytes=gif.stat().st_size)
            result = contracts.validate("capture-manifest", manifest)
            self.assertIn("not MP4", "\n".join(result["errors"]))


class PrimaryPanelRoutingTests(unittest.TestCase):
    """M3 records the primary visible panel, so every preview-tool call targets it."""

    def test_picks_the_index_0_panel(self):
        previews = [
            {"index": None, "title": "Headless Preview"},
            {"index": 1, "title": "Preview 2"},
            {"index": 0, "title": "Preview 1"},
        ]
        reply = json.dumps({"success": True, "data": {"previews": previews}})
        self.assertEqual(driver.primary_panel_title(reply), "Preview 1")

    def test_no_visible_panel(self):
        reply = json.dumps({"success": True, "data": {"previews": [{"index": None, "title": "Headless Preview"}]}})
        self.assertIsNone(driver.primary_panel_title(reply))
        self.assertIsNone(driver.primary_panel_title("not json"))

    def test_preview_tools_get_the_panel_name(self):
        sent = []
        m = mcp_client.MCP.__new__(mcp_client.MCP)
        m.log, m.preview_name = [], "Preview 1"
        m._rpc = lambda method, params, timeout=0: sent.append(params) or {"result": {"content": []}}
        m.call("CapturePanelScreenshotTool", {"pluginId": "Snap.Plugin.Gui.PreviewPanel"})
        m.call("PreviewInteractTool", {"action": "Pinch", "previewName": "Preview 2"})
        m.call("ExecuteEditorCode", {"path": "/a.ts"})
        self.assertEqual(sent[0]["arguments"]["previewName"], "Preview 1")
        self.assertEqual(sent[1]["arguments"]["previewName"], "Preview 2")
        self.assertNotIn("previewName", sent[2]["arguments"])


if __name__ == "__main__":
    unittest.main()
