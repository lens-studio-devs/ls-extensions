# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema>=4.23,<5", "Pillow>=11,<13"]
# ///
"""Read-only boundary validation for Lens evaluation JSON and retained evidence.

Run with uv run --script validate-contract.py --kind <boundary> --input <json>.
Success/error is always {ok, kind, errors}; no project or evidence files are changed.
"""

import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

KINDS = (
    "skill-input",
    "evaluator-input",
    "capture-plan",
    "capture-manifest",
    "leaf-cleanup",
    "evaluator-output",
    "judge-input",
    "judge-output",
    "skill-output",
)
SCHEMA = Path(__file__).resolve().parents[1] / "schemas" / "contracts.schema.json"
HEADINGS = (
    "## Lens description and current state",
    "## Expectations vs. realizations",
    "## Major Issues — Evaluator Must-Fix",
)


MAX_JUDGE_PX = 640  # capture_driver.py normalises every frame to this longest edge


def read_json(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def invalid_number(value):
        raise ValueError(f"Non-finite JSON number: {value}")

    return json.loads(Path(path).read_text(), object_pairs_hook=unique_keys, parse_constant=invalid_number)


def finite_numbers(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Non-finite JSON number")
    if isinstance(value, dict):
        for child in value.values():
            finite_numbers(child)
    if isinstance(value, list):
        for child in value:
            finite_numbers(child)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inside(path, root):
    return path.resolve().is_relative_to(root.resolve())


# capture_driver.py defaults: burst frames 10, fps 3, record_ms 5000 (a recording is sampled at fps).
DRIVER_FRAMES, DRIVER_FPS, DRIVER_RECORD_MS = 10, 3, 5000


def requested_frames(step, plan):
    """Frames a timeline op makes the driver capture, using the driver's own defaults."""
    op = step["op"]
    if op == "shot":
        return 1
    if op == "burst":
        return step.get("frames", plan.get("frames", DRIVER_FRAMES))
    if op == "record":
        ms = step.get("ms", plan.get("record_ms", DRIVER_RECORD_MS))
        fps = step.get("fps", plan.get("fps", DRIVER_FPS))
        return max(2, int(ms / 1000 * fps))  # same rounding as capture_driver.py
    return 0


def check_plan(plan, errors):
    timeline = plan["timeline"]
    times = [step["t"] for step in timeline]
    if times != sorted(times):
        errors.append("Capture plan timeline must be chronological")
    if plan["validation_state"] != "validated" and not plan["limitations"]:
        errors.append("Unverified/blocked capture plan needs a limitation")
    if plan["level"] == "medium":
        frames = sum(requested_frames(step, plan) for step in timeline)
        if frames > 1:
            errors.append("Medium capture plan allows one overview capture")
        if any(step["op"] == "move_camera" for step in timeline):
            errors.append("Medium capture plan cannot move the camera")


def check_manifest(manifest, errors):
    from PIL import Image

    artifacts = manifest["artifacts"]
    root = Path(manifest["frames_dir"]) if manifest["frames_dir"] else None
    if artifacts and (root is None or not root.is_dir()):
        errors.append("Retained captures require an existing frames_dir")
        return
    if manifest["status"] == "unavailable" and artifacts:
        errors.append("Unavailable capture manifest must not claim retained artifacts")
    if manifest["status"] == "complete" and not artifacts:
        errors.append("Complete capture manifest needs retained artifacts")
    if manifest["status"] != "complete" and not manifest["limitations"]:
        errors.append("Incomplete capture manifest needs a limitation")
    by_id = {artifact["id"]: artifact for artifact in artifacts}
    if len(by_id) != len(artifacts):
        errors.append("Capture artifact IDs must be unique")
    paths = [str(Path(a["path"]).resolve()) for a in artifacts]
    if len(paths) != len(set(paths)):
        errors.append("Capture artifact paths must be unique")
    primary_ids = {a["id"] for a in artifacts if a["role"] == "primary"}
    if set(manifest["primary_artifact_ids"]) != primary_ids:
        errors.append("primary_artifact_ids must identify exactly the primary captures")
    for artifact in artifacts:
        label = artifact["id"]
        path = Path(artifact["path"])
        if not inside(path, root):
            errors.append(f"{label}: capture path escapes current frames_dir")
            continue
        if not path.is_file():
            errors.append(f"{label}: retained capture file is missing")
            continue
        if path.stat().st_size != artifact["bytes"] or digest(path) != artifact["sha256"]:
            errors.append(f"{label}: retained capture size/hash mismatch")
        for parent in artifact["derived_from"]:
            if parent not in by_id or parent == label:
                errors.append(f"{label}: invalid source artifact {parent}")
        if artifact["role"] == "motion_gif":
            parents = [by_id[parent] for parent in artifact["derived_from"] if parent in by_id]
            if any(parent["role"] != "motion_frame" for parent in parents):
                errors.append(f"{label}: motion GIF sources must be motion frames")
            times = [parent["at_seconds"] for parent in parents]
            if times != sorted(times) or len(times) != len(set(times)):
                errors.append(f"{label}: motion GIF source frames must have increasing timestamps")
        try:
            if artifact["media_type"].startswith("image/"):
                with Image.open(path) as im:
                    dimensions = im.size
                    media_type = Image.MIME.get(im.format)
                    im.verify()
                if media_type != artifact["media_type"]:
                    errors.append(f"{label}: image MIME type mismatch")
                if max(dimensions) > MAX_JUDGE_PX:
                    errors.append(f"{label}: judge image exceeds {MAX_JUDGE_PX}px")
            else:
                probe = subprocess.run(
                    [
                        "ffprobe",
                        "-v",
                        "error",
                        "-select_streams",
                        "v:0",
                        "-show_entries",
                        "stream=width,height:format=format_name",
                        "-of",
                        "json",
                        str(path),
                    ],
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=15,
                )
                info = json.loads(probe.stdout)
                stream = info["streams"][0]
                dimensions = (stream["width"], stream["height"])
                if "mp4" not in info["format"]["format_name"].split(","):
                    errors.append(f"{label}: recording is not MP4")
            if dimensions != (artifact["width"], artifact["height"]):
                errors.append(f"{label}: declared dimensions do not match file")
        except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as exc:
            errors.append(f"{label}: cannot inspect media: {exc}")


def check_cleanup(cleanup, errors, final=False):
    changes = cleanup["changes"]
    ids = [change["id"] for change in changes]
    if len(ids) != len(set(ids)):
        errors.append("Cleanup change IDs must be unique")
    if cleanup["status"] == "not_needed" and changes:
        errors.append("not_needed cleanup cannot have project changes")
    pending = any(change["disposition"] == "pending" for change in changes)
    retained = any(change["disposition"].startswith("retained_") for change in changes)
    if cleanup["status"] == "complete" and (pending or retained):
        errors.append("Complete cleanup cannot contain pending or retained project changes")
    if final and (pending or cleanup["status"] == "pending"):
        errors.append("Final handoff requires terminal cleanup dispositions")
    if cleanup["status"] in ("partial", "blocked") and not cleanup["limitations"]:
        errors.append("Incomplete cleanup needs a limitation")
    for change in changes:
        if change["kind"] == "file":
            if not change["evaluation_sha256"]:
                errors.append(f"{change['id']}: file cleanup needs evaluation hash")
            if change["existed_before"] and (not change["before_sha256"] or not change["backup_path"]):
                errors.append(f"{change['id']}: modified pre-existing file needs backup and original hash")
            if change["backup_path"]:
                backup = Path(change["backup_path"])
                if not backup.is_file() or digest(backup) != change["before_sha256"]:
                    errors.append(f"{change['id']}: original backup is missing or changed")
            target = Path(change["target"])
            if change["disposition"] == "removed" and (target.exists() or target.is_symlink()):
                errors.append(f"{change['id']}: file claimed removed still exists")
            if change["disposition"] == "restored":
                if not target.is_file() or digest(target) != change["before_sha256"]:
                    errors.append(f"{change['id']}: file claimed restored does not match original")


def check_semantics(kind, data, errors):
    if kind == "skill-output":
        personas = [item["persona"] for item in data["judge_results"]]
        if len(personas) != len(set(personas)) or set(personas) & set(data["unavailable_judges"]):
            errors.append("Judge personas must be unique and cannot also be unavailable")
        scores = [item["result"]["scores"]["global_score"] for item in data["judge_results"]]
        scores = [score for score in scores if score is not None]
        expected = round(sum(scores) / len(scores), 2) if scores else None
        if data["panel_score"] != expected or data["panel_judge_count"] != len(scores):
            errors.append("Panel score/count must match assessed judge global scores (mean rounded to 2 decimals)")
        allowed = (
            {"critic", "scientist"}
            if data["level"] == "medium"
            else {"critic", "optimist", "pedant", "free_spirit", "scientist"}
        )
        represented = set(personas) | set(data["unavailable_judges"])
        if data["level"] in ("fast", "discovery"):
            if represented:
                errors.append("Fast/discovery cannot have a judge panel")
        elif represented - allowed:
            errors.append("Judge personas exceed the selected level")
        elif data["status"] == "complete" and (set(personas) != allowed or data["unavailable_judges"]):
            errors.append("Complete full evaluation needs every judge for its level")
        if data["status"] != "complete" and not data["limitations"]:
            errors.append("Partial/blocked skill output needs a limitation")
        for field in ("evaluation_result_path", "improvements_path"):
            if data[field] and not Path(data[field]).is_file():
                errors.append(f"{field}: declared output file is missing")
        if data["evaluation_result_path"] and Path(data["evaluation_result_path"]).is_file():
            evaluator = read_json(data["evaluation_result_path"])
            result = validate("evaluator-output", evaluator)
            errors.extend(f"evaluation_result: {error}" for error in result["errors"])
            if result["ok"]:
                if evaluator["level"] != data["level"]:
                    errors.append("Skill/evaluator levels differ")
                if data["status"] == "complete" and evaluator["status"] != "complete":
                    errors.append("Skill cannot claim complete when evaluator is incomplete")
        if data["level"] != "fast" and data["status"] == "complete" and not data["evaluation_result_path"]:
            errors.append("Complete evaluation/discovery needs a saved evaluator result")
        return
    if kind == "capture-plan":
        check_plan(data, errors)
    if kind == "capture-manifest":
        check_manifest(data, errors)
    if kind == "leaf-cleanup":
        check_cleanup(data, errors)
    if kind in ("evaluator-output", "judge-input"):
        manifest = data["capture_manifest"]
        check_manifest(manifest, errors)
        if kind == "judge-input":
            if data["frames_dir"] != manifest["frames_dir"]:
                errors.append("Judge frames_dir must match the manifest")
            headings = [line for line in data["internal_report"].splitlines() if line.startswith("## ")]
            if headings != list(HEADINGS):
                errors.append("Judge input requires the three-section evaluator report")
            return
        cleanup = data["leaf_cleanup"]
        check_cleanup(cleanup, errors, final=True)
        if data["run_id"] != manifest["run_id"] or data["run_id"] != cleanup["run_id"]:
            errors.append("Output, captures, and cleanup must belong to the same run")
        leaf_ids = {a["id"] for a in manifest["artifacts"] if a["source"] == "leaf_preview"}
        if set(cleanup["retained_artifact_ids"]) != leaf_ids:
            errors.append("Cleanup must retain and index every LEAF capture in the manifest")
        if data["capture_plan"]:
            check_plan(data["capture_plan"], errors)
            if data["capture_plan"]["level"] != data["level"]:
                errors.append("Capture plan level differs from evaluation level")
        if data["status"] != "complete" and not data["limitations"]:
            errors.append("Partial/blocked evaluation needs a limitation")
        if cleanup["status"] in ("partial", "blocked") and data["status"] == "complete":
            errors.append("Incomplete cleanup requires partial/blocked evaluation status")
        if data["report_path"]:
            report = Path(data["report_path"])
            if not report.is_file() or report.read_text() != data["internal_report"]:
                errors.append("Inline report must exactly match the retained report file")
        elif data["status"] == "complete":
            errors.append("Complete evaluation requires a saved report")
        headings = [line for line in data["internal_report"].splitlines() if line.startswith("## ")]
        expected = ["## Capture Plan"] if data["level"] == "discovery" else list(HEADINGS)
        if headings != expected:
            errors.append("Report headings do not match the declared report contract")
        if data["level"] == "discovery":
            if cleanup["status"] != "not_needed" or leaf_ids:
                errors.append("Discovery cannot include LEAF changes or captures")
            if data["status"] == "complete" and data["capture_plan"] is None:
                errors.append("Complete discovery requires a structured capture plan")
        if data["level"] == "medium":
            requested = [a for a in manifest["artifacts"] if a["capture_origin"] == "requested"]
            if len(requested) > 1 or any(a["media_type"] not in ("image/png", "image/jpeg") for a in requested):
                errors.append("Medium evaluation allows one overview still, no video/GIF")
            if cleanup["status"] != "not_needed" or leaf_ids:
                errors.append("Medium evaluation runs no LEAF")


def validate(kind, data):
    from jsonschema import Draft202012Validator

    schema = read_json(SCHEMA)
    Draft202012Validator.check_schema(schema)
    boundary = {"$ref": f"#/$defs/{kind}", "$defs": schema["$defs"]}
    errors = [f"{error.json_path}: {error.message}" for error in Draft202012Validator(boundary).iter_errors(data)]
    if not errors:
        finite_numbers(data)
        check_semantics(kind, data, errors)
    return {"ok": not errors, "kind": kind, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", required=True, choices=KINDS)
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = validate(args.kind, read_json(args.input))
    except (ImportError, OSError, ValueError) as exc:
        result = {"ok": False, "kind": args.kind, "errors": [str(exc)]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
