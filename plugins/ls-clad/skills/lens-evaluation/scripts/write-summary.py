#!/usr/bin/env python3
"""Write and validate the lens-evaluation summary envelope (``skill-output``) in one step.

The orchestrator never writes ``evaluation_summary.json`` by hand. It saves the judges' validated
``judge-output`` objects to one JSON file, then runs this script, which builds the envelope, computes
``panel_score`` / ``panel_judge_count`` itself, validates the result against ``skill-output`` and only
then writes it. An invalid envelope is reported and NOT written (an earlier file at the output path is
removed), so downstream readers find a schema-valid file or none.

  write-summary.py --lens-folder DIR --level LEVEL --status STATUS --summary-file SUMMARY.md \\
      --judges JUDGES.json [--unavailable PERSONA ...] [--limitation TEXT ...] \\
      [--evaluation-result PATH] [--improvements PATH] [--out PATH]

JUDGES.json: an object ``{"<persona>": <judge-output>, ...}`` or a list of ``{"persona", "result"}``.
Default output: ``<lens folder>/evaluation_summary.json``. Prints one JSON line
``{"ok", "path", "validated", "panel_score", "panel_judge_count", "errors"}``; exit 1 when invalid.
Runs under ``uv run --with jsonschema`` or a plain ``python3``; without jsonschema the summary is written as
``partial`` with a limitation saying the schema check was skipped (``validated: false``).
"""

import argparse
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("contracts", HERE / "validate-contract.py")
contracts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(contracts)


def judge_results(raw) -> list[dict]:
    if isinstance(raw, dict):
        return [{"persona": persona, "result": result} for persona, result in raw.items()]
    if isinstance(raw, list):
        return raw
    raise ValueError("judges file must be an object {persona: judge-output} or a list of {persona, result}")


def panel(results: list[dict]) -> tuple[float | None, int]:
    scores = []
    for item in results:
        score = ((item.get("result") or {}).get("scores") or {}).get("global_score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            scores.append(score)
    return (round(sum(scores) / len(scores), 2) if scores else None), len(scores)


def build(args) -> dict:
    results = judge_results(contracts.read_json(args.judges)) if args.judges else []
    score, count = panel(results)
    return {
        "schema_version": 1,
        "level": args.level,
        "status": args.status,
        "summary": Path(args.summary_file).read_text(encoding="utf-8").strip(),
        "evaluation_result_path": str(Path(args.evaluation_result).resolve()) if args.evaluation_result else None,
        "improvements_path": str(Path(args.improvements).resolve()) if args.improvements else None,
        "judge_results": results,
        "unavailable_judges": list(dict.fromkeys(args.unavailable)),
        "panel_score": score,
        "panel_judge_count": count,
        "limitations": [t for t in args.limitation if t.strip()],
    }


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".evaluation_summary.", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)  # never leave a half-written temp file behind
        raise


REQUIRED = (
    "schema_version",
    "level",
    "status",
    "summary",
    "evaluation_result_path",
    "improvements_path",
    "judge_results",
    "unavailable_judges",
    "panel_score",
    "panel_judge_count",
    "limitations",
)


def basic_problems(data: dict) -> list[str]:
    """Structural checks used when jsonschema is not installed (the envelope is built here, so this is a guard)."""
    errors = [f"missing {k}" for k in REQUIRED if k not in data]
    if not data.get("summary"):
        errors.append("summary is empty")
    for item in data.get("judge_results") or []:
        if not isinstance(item, dict) or not isinstance(item.get("result"), dict) or "persona" not in item:
            errors.append("judge_results entries need persona and result")
            break
    score = data.get("panel_score")
    if score is not None and not 1 <= score <= 10:
        errors.append(f"panel_score {score} is outside 1-10")
    return errors


def remove_quietly(path: Path) -> None:
    """Best-effort removal of an earlier summary; a failure here must not break the one-line JSON report."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def jsonschema_available() -> bool:
    return importlib.util.find_spec("jsonschema") is not None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lens-folder", required=True, type=Path)
    ap.add_argument("--level", required=True)
    ap.add_argument("--status", required=True)
    ap.add_argument("--summary-file", required=True, type=Path, help="the user-facing summary text (markdown)")
    ap.add_argument("--judges", type=Path, help="JSON with the judges' validated judge-output objects")
    ap.add_argument("--unavailable", action="append", default=[], help="persona that returned no usable output")
    ap.add_argument("--limitation", action="append", default=[])
    ap.add_argument("--evaluation-result", help="path of evaluation_result.json")
    ap.add_argument("--improvements", help="path of evaluation_improvements.md")
    ap.add_argument("--out", type=Path, help="default: <lens folder>/evaluation_summary.json")
    args = ap.parse_args(argv)
    out = args.out or args.lens_folder / "evaluation_summary.json"
    report = {"ok": False, "path": None, "validated": False, "panel_score": None, "panel_judge_count": 0, "errors": []}
    try:
        data = build(args)
        report.update(panel_score=data["panel_score"], panel_judge_count=data["panel_judge_count"])
        if jsonschema_available():
            result = contracts.validate("skill-output", data)
            errors, report["validated"] = result["errors"], True
        else:
            # Fallback (no jsonschema, e.g. no uv and a bare python3): keep the envelope the script built, mark it
            # partial and say the schema check was skipped, so the score is recorded and readers can tell.
            if data["status"] == "complete":
                data["status"] = "partial"
            data["limitations"].append("Schema validation skipped: jsonschema is not installed.")
            errors = basic_problems(data)
        report["errors"] = errors
        if not errors:
            write_atomic(out, data)
            report.update(ok=True, path=str(out.resolve()))
        else:
            remove_quietly(out)  # never leave a stale summary from an earlier run behind
    except Exception as exc:  # noqa: BLE001 -- the contract is one JSON line on stdout, whatever went wrong
        remove_quietly(out)
        report["errors"] = [f"{type(exc).__name__}: {exc}"]
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
