#!/usr/bin/env python3

# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Own the confirmation-through-Finalize state transitions for a Specs publish.

The model supplies semantic proposals and presentation evidence once. This helper
assembles and freezes the plan, executes the review fingerprint and renderer, and
stores the complete values behind an opaque handle. Confirmation must present the
renderer token, so a reconstructed or stale question cannot authorize Package.
Package, Register, and Finalize results then advance that same token-bound state.

The initial render always uses inline media. ``fallback`` is the only operation
that can switch to directory-only presentation, and it requires the current token
plus a concrete rendering failure reason.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parents[1]
ASSEMBLE_PLAN = HERE / "assemble-plan.py"
PUBLISH_FLOW = HERE / "publish-flow.py"
MAKE_EEC = SKILL_DIR / "scripts" / "editor" / "make-eec-script.py"
PREFLIGHT_SCRIPT = SKILL_DIR / "scripts" / "editor" / "preflight.ts"
DISCOVER_SCRIPT = SKILL_DIR / "scripts" / "editor" / "discover.ts"
PACKAGE_SCRIPT = SKILL_DIR / "scripts" / "editor" / "package.ts"
REGISTER_SCRIPT = SKILL_DIR / "scripts" / "editor" / "register.ts"
FINALIZE_SCRIPT = SKILL_DIR / "scripts" / "editor" / "finalize.ts"
RECORD_PREVIEW_SCRIPT = SKILL_DIR / "scripts" / "editor" / "record-preview-video.ts"
NORMALIZE_PREVIEW = SKILL_DIR / "scripts" / "preview" / "normalize-preview-video.py"
STAGE_SCREENSHOT = SKILL_DIR / "scripts" / "preview" / "stage-preview-screenshot.py"
PREVIEW_FLOW = SKILL_DIR / "scripts" / "preview" / "preview-media-flow.py"
PREVIEW_RECORDER = SKILL_DIR / "scripts" / "preview" / "record-preview-video.sh"
COLLECT_REVIEW_INPUT = HERE / "collect-review-input.py"
BUILD_PROMOTIONAL = SKILL_DIR / "scripts" / "promotional" / "build-promotional-video.py"

HANDLE_PATTERN = re.compile(r"spub1_[A-Za-z0-9_-]{32}")
PROTOCOL_VERSION = 1
PREVIEW_ARTIFACT_TTL_SECONDS = 30 * 24 * 60 * 60
PREVIEW_ARTIFACT_MANIFEST = "artifact.json"
PROPOSAL_FIELDS = {
    "buildVersion",
    "lensName",
    "releaseDescription",
    "releaseTags",
    "orgId",
    "orgDisplayName",
    "semanticVersion",
    "targetChannel",
    "lensIconPlan",
    "signingKeyPlan",
    "selectedCategoryId",
    "contentRatingAssessment",
    "previewMedia",
    "previewMediaPlan",
    "tileSourcePath",
    "legalDocumentInputs",
}
PLANNABLE_PREFLIGHT_ISSUES = {
    "invalid_package_version",
    "missing_submission_metadata",
    "no_lens_icon",
    "no_prod_signing_key",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def load_flow_module() -> Any:
    spec = importlib.util.spec_from_file_location("specs_publish_flow", PUBLISH_FLOW)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load publish-flow.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FLOW = load_flow_module()
_tile_spec = importlib.util.spec_from_file_location("specs_publish_tiles", HERE / "tile-assets.py")
_preview_spec = importlib.util.spec_from_file_location(
    "preview_contract", SKILL_DIR / "scripts" / "schemas" / "preview_contract.py"
)
PREVIEW_CONTRACT = importlib.util.module_from_spec(_preview_spec)
_preview_spec.loader.exec_module(PREVIEW_CONTRACT)
TILES = importlib.util.module_from_spec(_tile_spec)
_tile_spec.loader.exec_module(TILES)


class SessionIssue(Exception):
    def __init__(self, reason: str, message: str, *, status: str = "FAILED") -> None:
        super().__init__(message)
        self.result = {
            "status": status,
            "stage": "publish_session",
            "reason": reason,
            "message": message,
        }


def require_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SessionIssue("session_input_invalid", f"{field} must be an object.")
    return value


def require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SessionIssue("session_input_invalid", f"{field} must be a non-empty string.")
    return value


def editor_operation_result(value: Any, expected_stage: str) -> dict[str, Any]:
    """Normalize direct, ExecuteEditorCode, and MCP-wrapped operation results."""

    normalized = _editor_operation_result(value, expected_stage, depth=0)
    if normalized is None:
        raise SessionIssue(
            "editor_result_invalid",
            f"The Editor result does not contain a {expected_stage!r} operation result. "
            "Pass the operation returnValue or the untouched ExecuteEditorCode/MCP result.",
            status="ACTION_REQUIRED",
        )
    return normalized


def publish_context_availability(discover: dict[str, Any]) -> dict[str, Any]:
    """Return the availability object embedded in GET /lenses/publish-context."""

    publish_context = discover.get("publishContext")
    if isinstance(publish_context, dict):
        data = publish_context.get("data")
        if isinstance(data, dict) and isinstance(data.get("availability"), dict):
            return data["availability"]
    availability = discover.get("availability")
    if isinstance(availability, dict) and isinstance(availability.get("data"), dict):
        return availability["data"]
    raise SessionIssue(
        "publish_context_availability_missing",
        "discover did not return availability from GET /lenses/publish-context.",
        status="ACTION_REQUIRED",
    )


def publish_context_store_listing_reuse(discover: dict[str, Any]) -> dict[str, Any]:
    """Return the exact reuse summary, tolerating duplicate-reference MCP serializers."""

    direct = discover.get("storeListingReuse")
    if isinstance(direct, dict):
        return direct
    publish_context = discover.get("publishContext")
    if isinstance(publish_context, dict):
        data = publish_context.get("data")
        if isinstance(data, dict) and isinstance(data.get("storeListingReuse"), dict):
            return data["storeListingReuse"]
    raise SessionIssue(
        "publish_context_reuse_missing",
        "discover did not return store-listing reuse from GET /lenses/publish-context.",
        status="ACTION_REQUIRED",
    )


def preflight_can_prepare(preflight: dict[str, Any]) -> bool:
    if preflight.get("status") == "READY":
        return True
    if preflight.get("status") != "ACTION_REQUIRED":
        return False
    issues = preflight.get("issues")
    if not isinstance(issues, list) or not issues:
        return False
    reasons = {
        issue.get("reason") for issue in issues if isinstance(issue, dict) and isinstance(issue.get("reason"), str)
    }
    if len(reasons) != len(issues) or not reasons.issubset(PLANNABLE_PREFLIGHT_ISSUES):
        return False
    # Missing/invalid IDs and missing names are confirmation-time setup. Discovery
    # checks proposal availability and that the original project identity is unchanged.
    return True


def review_input_for_plan(
    review_input: dict[str, Any],
    preflight: dict[str, Any],
    plan: dict[str, Any],
) -> dict[str, Any]:
    """Project collector evidence onto the exact confirmed post-setter review surface."""

    projected = copy.deepcopy(review_input)
    moderation_input = preflight.get("localAiModerationInput")
    initial_text = moderation_input.get("releaseText") if isinstance(moderation_input, dict) else None
    if not isinstance(initial_text, dict):
        initial_text = {"name": preflight.get("lensName", ""), "description": "", "tags": []}
    projected["releaseText"] = {
        "name": plan.get("lensName", initial_text.get("name", "")),
        "description": plan.get("releaseDescription", initial_text.get("description", "")),
        "tags": copy.deepcopy(plan.get("releaseTags", initial_text.get("tags", []))),
    }
    if isinstance(plan.get("contentRatingAssessment"), dict):
        projected["contentRating"] = {
            "assessment": FLOW.validate_content_rating(plan["contentRatingAssessment"]),
        }

    icon_plan = plan.get("lensIconPlan")
    if isinstance(icon_plan, dict) and icon_plan.get("action") == "generate_and_assign":
        asset = require_object(icon_plan.get("asset"), "plan.lensIconPlan.asset")
        assets = copy.deepcopy(projected.get("assets", []))
        if not isinstance(assets, list):
            raise SessionIssue("session_input_invalid", "reviewInput.assets must be an array.")
        assets = [
            value for value in assets if not isinstance(value, dict) or value.get("assetId") != "confirmed_lens_icon"
        ]
        assets.append(
            {
                "assetId": "confirmed_lens_icon",
                "role": "lens_icon",
                "mediaType": "image",
                "status": "available",
                "sha256": require_string(asset.get("checksum"), "plan.lensIconPlan.asset.checksum"),
                "bytes": asset.get("bytes"),
            }
        )
        projected["assets"] = assets

    projected.setdefault("assets", []).extend(
        {
            "assetId": "store_tile_" + asset["tileType"],
            "role": "store_tile",
            "mediaType": "image",
            "status": "available",
            "sha256": asset["checksum"],
            "bytes": asset["bytes"],
        }
        for asset in plan.get("tileAssets", [])
    )

    review_visible_setup = (
        plan.get("packageIdNeedsAssignment") is True
        or plan.get("lensNameNeedsAssignment") is True
        or (isinstance(icon_plan, dict) and icon_plan.get("action") != "keep_existing")
    )
    if review_visible_setup:
        project_path = preflight.get("projectPath")
        project_name = Path(project_path).name if isinstance(project_path, str) else ""
        manifest = projected.get("manifest", [])
        if not isinstance(manifest, list):
            raise SessionIssue("session_input_invalid", "reviewInput.manifest must be an array.")
        # The confirmed setters necessarily rewrite the .esproj. Normalize only that
        # expected metadata file; every source and asset digest remains fail-closed.
        projected["manifest"] = [
            value
            for value in manifest
            if not (isinstance(value, dict) and isinstance(value.get("id"), str) and value["id"] == project_name)
        ]
    return projected


def bind_lens_icon_presentation(presentation: dict[str, Any], preflight: dict[str, Any], plan: dict[str, Any]) -> None:
    supplied = presentation.pop("lensIconPath", None)
    icon_plan = require_object(plan.get("lensIconPlan"), "plan.lensIconPlan")
    if icon_plan.get("action") == "generate_and_assign":
        expected = require_string(
            require_object(icon_plan.get("asset"), "plan.lensIconPlan.asset").get("path"),
            "plan.lensIconPlan.asset.path",
        )
    else:
        value = preflight.get("lensIconPath")
        expected = value if isinstance(value, str) and value else None
    if supplied is not None and supplied != expected:
        raise SessionIssue(
            "confirmation_asset_mismatch",
            "presentation.lensIconPath does not match the Lens icon retained from Preflight and the frozen plan.",
        )
    if expected is not None:
        presentation["lensIconPath"] = expected


def normalize_proposals(value: Any) -> dict[str, Any]:
    """Validate semantic proposal keys and accept the old plan-shaped media alias."""

    proposals = copy.deepcopy(require_object(value, "proposals"))
    if "previewMediaAssets" in proposals:
        if "previewMedia" in proposals:
            raise SessionIssue(
                "proposal_fields_invalid",
                "Use proposals.previewMedia only; do not supply both previewMedia and previewMediaAssets.",
                status="ACTION_REQUIRED",
            )
        proposals["previewMedia"] = proposals.pop("previewMediaAssets")
    unknown = sorted(set(proposals) - PROPOSAL_FIELDS)
    if unknown:
        raise SessionIssue(
            "proposal_fields_invalid",
            "Unknown proposal field(s): "
            + ", ".join(unknown)
            + ". Allowed fields: "
            + ", ".join(sorted(PROPOSAL_FIELDS))
            + ".",
            status="ACTION_REQUIRED",
        )
    if "targetChannel" in proposals:
        try:
            FLOW.validate_target_channel(proposals["targetChannel"])
        except FLOW.FlowIssue as error:
            raise SessionIssue(error.reason, error.message, status="ACTION_REQUIRED") from error
    return proposals


def _editor_operation_result(value: Any, expected_stage: str, *, depth: int) -> dict[str, Any] | None:
    if depth > 5:
        return None
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return None
        return _editor_operation_result(decoded, expected_stage, depth=depth + 1)
    if not isinstance(value, dict):
        return None

    if value.get("stage") == expected_stage and isinstance(value.get("status"), str):
        return value

    for key in ("returnValue", "structuredContent", "result"):
        candidate = value.get(key)
        if candidate is not None:
            normalized = _editor_operation_result(candidate, expected_stage, depth=depth + 1)
            if normalized is not None:
                return normalized

    content = value.get("content")
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                continue
            normalized = _editor_operation_result(block.get("text"), expected_stage, depth=depth + 1)
            if normalized is not None:
                return normalized

    status = value.get("status")
    if value.get("isError") is True or (
        isinstance(status, str) and status.startswith("Execution ") and status != "Execution Succeeded"
    ):
        return value
    return None


def contains_successful_editor_wrapper(value: Any, *, depth: int = 0) -> bool:
    """Recognize an untouched ExecuteEditorCode result, including its MCP text wrapper."""

    if depth > 5:
        return False
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return False
        return contains_successful_editor_wrapper(value, depth=depth + 1)
    if not isinstance(value, dict):
        return False
    if value.get("status") == "Execution Succeeded" and "returnValue" in value:
        return True
    content = value.get("content")
    if isinstance(content, list):
        return any(
            isinstance(block, dict)
            and block.get("type") == "text"
            and contains_successful_editor_wrapper(block.get("text"), depth=depth + 1)
            for block in content
        )
    for key in ("structuredContent", "result"):
        if key in value and contains_successful_editor_wrapper(value[key], depth=depth + 1):
            return True
    return False


def session_root() -> Path:
    override = os.environ.get("SPECS_PUBLISH_SESSION_DIR")
    root = Path(override).resolve() if override else Path(tempfile.gettempdir()).resolve() / "specs-publish-sessions"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    return root


def state_path(handle: str) -> Path:
    if HANDLE_PATTERN.fullmatch(handle) is None:
        raise SessionIssue("publish_session_handle_invalid", "The publish-session handle is malformed.")
    return session_root() / f"{handle}.json"


def result_path(handle: str, stage: str) -> Path:
    if stage not in {"preflight", "discover", "build_version", "preview_video", "package", "register", "finalize"}:
        raise SessionIssue("publish_session_result_stage_invalid", f"Unsupported result stage: {stage}.")
    state_path(handle)
    return session_root() / f"{handle}.{stage}-result.json"


def owned_submit_state_path(handle: str) -> Path:
    state_path(handle)
    return session_root() / f"{handle}.submit-state.json"


def owned_preview_dir(handle: str) -> Path:
    state_path(handle)
    return session_root() / f"{handle}.preview"


def artifact_root() -> Path:
    override = os.environ.get("SPECS_PUBLISH_ARTIFACT_DIR")
    root = Path(override).expanduser() if override else Path(tempfile.gettempdir()) / "specs-publish-artifacts"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    return root


def owned_preview_artifact_dir(handle: str) -> Path:
    if HANDLE_PATTERN.fullmatch(handle) is None:
        raise SessionIssue("publish_session_handle_invalid", "The publish-session handle is malformed.")
    return artifact_root() / handle


def preview_artifact_expiration(created_at: int) -> int:
    return created_at + PREVIEW_ARTIFACT_TTL_SECONDS


def prune_expired_preview_artifacts(*, now: int | None = None) -> int:
    """Remove expired final previews from the dedicated owned artifact root."""

    current_time = int(time.time()) if now is None else now
    removed = 0
    try:
        candidates = list(artifact_root().iterdir())
    except OSError:
        return removed
    for candidate in candidates:
        if candidate.is_symlink() or not candidate.is_dir() or HANDLE_PATTERN.fullmatch(candidate.name) is None:
            continue
        manifest = candidate / PREVIEW_ARTIFACT_MANIFEST
        try:
            metadata = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            try:
                expires_at = int(candidate.stat().st_mtime) + PREVIEW_ARTIFACT_TTL_SECONDS
            except OSError:
                continue
        else:
            expires_value = metadata.get("expiresAtEpochSeconds") if isinstance(metadata, dict) else None
            if not isinstance(expires_value, int):
                try:
                    expires_at = int(candidate.stat().st_mtime) + PREVIEW_ARTIFACT_TTL_SECONDS
                except OSError:
                    continue
            else:
                expires_at = expires_value
        if expires_at > current_time:
            continue
        shutil.rmtree(candidate, ignore_errors=True)
        if not candidate.exists():
            removed += 1
    return removed


def retain_preview_artifact(handle: str, source: Path, media_type: str) -> dict[str, Any]:
    """Copy one final generated preview outside session cleanup for historical rendering."""

    artifact_dir = owned_preview_artifact_dir(handle)
    if artifact_dir.exists():
        raise SessionIssue("preview_artifact_exists", "This publish session already retained final preview media.")
    artifact_dir.mkdir(mode=0o700)
    filename = "preview-video.mp4" if media_type == "video" else "preview-image.png"
    target = artifact_dir / filename
    temporary = artifact_dir / f".{filename}.{secrets.token_hex(8)}.tmp"
    try:
        shutil.copyfile(source, temporary)
        temporary.chmod(0o600)
        os.replace(temporary, target)
        created_at = int(time.time())
        expires_at = preview_artifact_expiration(created_at)
        manifest = {
            "createdAtEpochSeconds": created_at,
            "expiresAtEpochSeconds": expires_at,
            "mediaType": media_type,
            "path": str(target),
        }
        manifest_path = artifact_dir / PREVIEW_ARTIFACT_MANIFEST
        manifest_path.write_text(canonical_json(manifest) + "\n", encoding="utf-8")
        manifest_path.chmod(0o600)
    except Exception:
        shutil.rmtree(artifact_dir, ignore_errors=True)
        raise
    return manifest


def owned_review_input_path(handle: str) -> Path:
    state_path(handle)
    return session_root() / f"{handle}.review-input.json"


def owned_user_media_dir(handle: str, entries: Any) -> Path:
    """Name the crop directory after the supplied media, so an unchanged edit keeps its crops."""
    digest = hashlib.sha256(canonical_json(entries or []).encode("utf-8"))
    for entry in entries if isinstance(entries, list) else []:
        path = Path(str(entry.get("path") or "")).expanduser() if isinstance(entry, dict) else None
        if path is not None and path.is_file():
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
    return owned_preview_dir(handle) / "user-media" / digest.hexdigest()[:16]


def cleanup_owned_preview(handle: str, state: dict[str, Any]) -> None:
    value = state.get("previewDir")
    if not isinstance(value, str):
        return
    candidate = Path(value).resolve()
    expected = owned_preview_dir(handle).resolve()
    if candidate != expected or candidate.parent != session_root().resolve():
        raise SessionIssue("preview_cleanup_path_invalid", "The retained preview directory is not session-owned.")
    shutil.rmtree(candidate, ignore_errors=True)
    state.pop("previewDir", None)
    state.pop("previewConfigPath", None)
    state.pop("previewResult", None)
    state.pop("previewImages", None)
    state.pop("previewImageCaptures", None)


def cleanup_owned_preview_artifact(handle: str, state: dict[str, Any]) -> None:
    value = state.get("previewArtifact")
    if not isinstance(value, dict) or not isinstance(value.get("path"), str):
        return
    candidate = Path(value["path"]).resolve()
    expected_dir = owned_preview_artifact_dir(handle).resolve()
    if candidate.parent != expected_dir or expected_dir.parent != artifact_root().resolve():
        raise SessionIssue(
            "preview_artifact_cleanup_path_invalid",
            "The retained preview artifact is not session-owned.",
        )
    shutil.rmtree(expected_dir, ignore_errors=True)
    state.pop("previewArtifact", None)


def state_facts(state: dict[str, Any]) -> dict[str, Any]:
    facts = copy.deepcopy(state)
    facts.pop("stateToken", None)
    return facts


def write_state(handle: str, state: dict[str, Any]) -> None:
    path = state_path(handle)
    stored = {**state_facts(state), "stateToken": fingerprint(state_facts(state))}
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(canonical_json(stored))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def load_state(handle: str, *, expected_stage: str | None = None) -> dict[str, Any]:
    path = state_path(handle)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SessionIssue("publish_session_not_found", "The publish session no longer exists.") from error
    except (OSError, json.JSONDecodeError) as error:
        raise SessionIssue("publish_session_unreadable", f"The publish session cannot be read: {error}.") from error
    if not isinstance(state, dict) or state.get("protocolVersion") != PROTOCOL_VERSION:
        raise SessionIssue("publish_session_invalid", "The publish session has an unsupported shape.")
    supplied_token = state.get("stateToken")
    if not isinstance(supplied_token, str) or supplied_token != fingerprint(state_facts(state)):
        raise SessionIssue("publish_session_changed", "The publish session changed outside this helper.")
    if expected_stage is not None and state.get("sessionStage") != expected_stage:
        raise SessionIssue(
            "publish_session_stage_invalid",
            f"The publish session is {state.get('sessionStage')!r}, not {expected_stage!r}.",
        )
    return state


def run_json_script(script: Path, payload: dict[str, Any]) -> dict[str, Any]:
    completed = subprocess.run(
        [sys.executable, str(script), "--json", "-"],
        input=canonical_json(payload),
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}"
        raise SessionIssue("session_helper_failed", f"{script.name} returned invalid output: {detail}") from error
    if not isinstance(result, dict):
        raise SessionIssue("session_helper_failed", f"{script.name} did not return one JSON object.")
    return result


def run_json_command(arguments: list[str]) -> dict[str, Any]:
    completed = subprocess.run(arguments, check=False, capture_output=True, text=True)
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}"
        raise SessionIssue(
            "session_helper_failed", f"{Path(arguments[1]).name} returned invalid output: {detail}"
        ) from error
    if not isinstance(result, dict) or not isinstance(result.get("status"), str):
        raise SessionIssue("session_helper_failed", f"{Path(arguments[1]).name} returned an invalid result.")
    return result


def collect_review_for_session(handle: str, preflight: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    review_path = owned_review_input_path(handle)
    project_path = require_string(preflight.get("projectPath"), "preflight.projectPath")
    result = run_json_command(
        [
            sys.executable,
            str(COLLECT_REVIEW_INPUT),
            "--project",
            project_path,
            "--output",
            str(review_path),
        ]
    )
    if result.get("status") != "REVIEW_INPUT_STORED":
        raise SessionIssue(
            str(result.get("reason") or "review_input_collection_failed"),
            str(result.get("message") or "Review input collection failed."),
        )
    return review_path, require_object(result.get("reviewSummary"), "reviewSummary")


def run_flow(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return FLOW.OPERATIONS[operation](payload)
    except FLOW.FlowIssue as error:
        raise SessionIssue(error.reason, error.message, status=error.status) from error


def run_flow_result(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Return corrective flow outcomes as data when the session owns their recovery path."""

    try:
        return FLOW.OPERATIONS[operation](payload)
    except FLOW.FlowIssue as error:
        return error.result()


def validate_version_policy(frozen: dict[str, Any], version_policy: dict[str, Any]) -> None:
    if version_policy.get("status") != "VERSION_POLICY_OK" or version_policy.get("stage") != "package_version_precheck":
        raise SessionIssue(
            "package_version_policy_unavailable",
            "prepare requires the complete successful version-policy result.",
            status="ACTION_REQUIRED",
        )
    facts = copy.deepcopy(version_policy)
    token = facts.pop("versionPolicyToken", None)
    if not isinstance(token, str) or token != fingerprint(facts):
        raise SessionIssue("package_version_policy_changed", "The version-policy result is incomplete or changed.")
    plan = require_object(frozen.get("plan"), "frozen.plan")
    if version_policy.get("packageId") != plan.get("packageId") or version_policy.get("packageVersion") != plan.get(
        "packageVersion"
    ):
        raise SessionIssue(
            "package_authorization_mismatch",
            "The version-policy result does not match the prepared package identity.",
        )


def planned_build_version_policy(
    version_policy: dict[str, Any],
    *,
    package_id: str,
    package_version: str,
) -> dict[str, Any]:
    """Bind a backend suggestion for planning and token-bound Package mutation."""

    details = version_policy.get("details")
    published_floor = (
        details.get("publishedBuildVersionFloor")
        if isinstance(details, dict)
        else version_policy.get("publishedBuildVersionFloor")
    )
    result = {
        "status": "VERSION_POLICY_OK",
        "stage": "package_version_precheck",
        "packageId": package_id,
        "packageVersion": package_version,
        "coverage": "availability_api_pending_confirmed_update",
        "versionReason": (
            "VALIDATED_REPLACEMENT"
            if version_policy.get("status") == "VERSION_POLICY_OK"
            else "BACKEND_SUGGESTED_DEFAULT"
        ),
        "nextAvailablePkgBuildVersion": package_version,
        **({"publishedBuildVersionFloor": published_floor} if isinstance(published_floor, str) else {}),
    }
    return {**result, "versionPolicyToken": fingerprint(result)}


def edited_build_version_plan(
    plan_value: Any,
    version_policy: dict[str, Any],
    requested_value: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Bind a user edit above both the current version and the backend's available minimum."""

    if not isinstance(plan_value, dict) or plan_value.get("action") != "assign":
        raise SessionIssue(
            "build_version_edit_unavailable",
            "Build Version can be edited here only when the session defaulted a backend suggestion.",
            status="ACTION_REQUIRED",
        )
    plan = copy.deepcopy(plan_value)
    current = plan.get("currentBuildVersion")
    if not isinstance(current, str):
        raise SessionIssue("project_setup_invalid", "currentBuildVersion must be an observed string.")
    minimum = require_string(
        version_policy.get("nextAvailablePkgBuildVersion"),
        "session.versionPolicy.nextAvailablePkgBuildVersion",
    )
    try:
        requested_version = FLOW.parse_version(requested_value, "proposals.buildVersion")
        current_version = FLOW.parse_version(current) if FLOW.is_valid_build_version(current) else None
        minimum_version = FLOW.parse_version(minimum, "session.versionPolicy.nextAvailablePkgBuildVersion")
    except FLOW.FlowIssue as error:
        raise SessionIssue(error.reason, error.message, status="ACTION_REQUIRED") from error
    requested = require_string(requested_value, "proposals.buildVersion")
    if current_version is not None and requested_version <= current_version:
        raise SessionIssue(
            "build_version_not_higher",
            f"Build Version must be greater than the current value {current}.",
            status="ACTION_REQUIRED",
        )
    if requested_version < minimum_version:
        raise SessionIssue(
            "build_version_below_available_minimum",
            f"Build Version must be {minimum} or higher according to the availability check.",
            status="ACTION_REQUIRED",
        )

    plan["buildVersion"] = requested
    policy_facts = copy.deepcopy(version_policy)
    policy_facts.pop("versionPolicyToken", None)
    if policy_facts.get("coverage") != "availability_api_pending_confirmed_update":
        raise SessionIssue(
            "build_version_edit_unavailable",
            "The retained availability policy cannot authorize a Build Version edit.",
            status="ACTION_REQUIRED",
        )
    policy_facts["packageVersion"] = requested
    policy_facts["versionReason"] = (
        "BACKEND_SUGGESTED_DEFAULT" if requested == minimum else "USER_SELECTED_HIGHER_BUILD_VERSION"
    )
    return plan, {**policy_facts, "versionPolicyToken": fingerprint(policy_facts)}


def configured_editor_script(
    target: Path,
    option: str,
    authorization: dict[str, Any],
    persisted_result_path: Path,
) -> str:
    # Legal text can exceed platform command-line limits after percent encoding.
    via_stdin = option == "--finalize-authorization-uri"
    encoded = "-" if via_stdin else quote(canonical_json(authorization), safe="")
    persisted_result_path.unlink(missing_ok=True)
    completed = subprocess.run(
        [
            sys.executable,
            str(MAKE_EEC),
            str(target),
            option,
            encoded,
            "--set",
            f"RESULT_PATH={persisted_result_path}",
        ],
        input=canonical_json(authorization) if via_stdin else None,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise SessionIssue(
            "configured_script_generation_failed",
            completed.stderr.strip() or completed.stdout.strip() or "Package script generation failed.",
        )
    configured_path = completed.stdout.strip()
    if not configured_path or not Path(configured_path).is_file():
        raise SessionIssue("configured_script_generation_failed", f"{target.name} generation returned no file.")
    return configured_path


def configured_context_script(
    target: Path,
    persisted_result_path: Path,
    *,
    settings: dict[str, str] | None = None,
) -> str:
    """Generate a context script that persists its exact Editor result for the session."""

    persisted_result_path.unlink(missing_ok=True)
    command = [sys.executable, str(MAKE_EEC), str(target)]
    for key, value in {"RESULT_PATH": str(persisted_result_path), **(settings or {})}.items():
        command.extend(["--set", f"{key}={value}"])
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise SessionIssue(
            "configured_script_generation_failed",
            completed.stderr.strip() or completed.stdout.strip() or f"{target.name} generation failed.",
        )
    configured_path = completed.stdout.strip()
    if not configured_path or not Path(configured_path).is_file():
        raise SessionIssue("configured_script_generation_failed", f"{target.name} generation returned no file.")
    return configured_path


def cleanup_configured(path: str) -> None:
    subprocess.run(
        [sys.executable, str(MAKE_EEC), "--cleanup", path],
        check=False,
        capture_output=True,
        text=True,
    )


def editor_result_from_session(
    payload: dict[str, Any],
    state: dict[str, Any],
    expected_stage: str,
) -> dict[str, Any]:
    supplied = payload.get("result")
    paths = state.get("resultPaths", {})
    path_value = paths.get(expected_stage) if isinstance(paths, dict) else None
    if not isinstance(path_value, str):
        raise SessionIssue(
            "editor_result_path_missing",
            f"The session has no persisted {expected_stage} result path.",
            status="ACTION_REQUIRED",
        )
    persisted_path = Path(path_value)
    if supplied is not None and persisted_path.is_file():
        # A session-persisted result always wins. Recovery input must never override
        # response facts written by the configured Editor script.
        supplied = None
    if supplied is not None:
        if not contains_successful_editor_wrapper(supplied):
            raise SessionIssue(
                "editor_recovery_wrapper_required",
                "Recovery accepts only the untouched successful ExecuteEditorCode/MCP result, "
                "not a reconstructed operation object.",
                status="ACTION_REQUIRED",
            )
        return editor_operation_result(supplied, expected_stage)
    try:
        persisted = json.loads(persisted_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        recovery = (
            f"Rerun only the configured {expected_stage} script, then "
            + ("record-final-review again." if state.get("finalReviewScriptPath") else "stage-context again.")
            if expected_stage in {"preflight", "discover"}
            else f"Retry only record-{expected_stage} with the untouched ExecuteEditorCode result; "
            "do not rerun the Editor script."
        )
        raise SessionIssue(
            "editor_result_not_persisted",
            f"The {expected_stage} script did not persist its result. {recovery}",
            status="ACTION_REQUIRED",
        ) from error
    except (OSError, json.JSONDecodeError) as error:
        raise SessionIssue(
            "editor_result_unreadable",
            f"The persisted {expected_stage} result is unreadable ({error}). Retry only the record step "
            "with the untouched ExecuteEditorCode result; do not rerun the Editor script.",
            status="ACTION_REQUIRED",
        ) from error
    return editor_operation_result(persisted, expected_stage)


def consume_result_path(state: dict[str, Any], stage: str) -> None:
    paths = state.get("resultPaths", {})
    if not isinstance(paths, dict):
        return
    path_value = paths.pop(stage, None)
    if isinstance(path_value, str):
        Path(path_value).unlink(missing_ok=True)


def begin_context(payload: dict[str, Any]) -> dict[str, Any]:
    """Create one session-owned Preflight/discovery capture without transporting Editor JSON."""

    prune_expired_preview_artifacts()
    force_category_fetch = payload.get("forceCategoryFetch", False)
    if not isinstance(force_category_fetch, bool):
        raise SessionIssue("session_input_invalid", "forceCategoryFetch must be true or false.")
    tenant_id_value = payload.get("tenantId")
    tenant_id = require_string(tenant_id_value, "tenantId") if tenant_id_value is not None else ""
    proposed_package_id = ""
    if "packageId" in payload:
        try:
            proposed_package_id = FLOW.validate_package_id(payload["packageId"])
        except FLOW.FlowIssue as error:
            raise SessionIssue(error.reason, error.message, status="ACTION_REQUIRED") from error
    project_value = payload.get("projectPath")
    requested_project_path = ""
    if project_value is not None:
        supplied_project = Path(require_string(project_value, "projectPath")).expanduser()
        try:
            supplied_project = supplied_project.resolve(strict=True)
        except OSError as error:
            raise SessionIssue("project_path_invalid", f"The requested project cannot be resolved: {error}.") from error
        if not supplied_project.is_file() or supplied_project.suffix != ".esproj":
            raise SessionIssue("project_path_invalid", "projectPath must name an existing .esproj file.")
        requested_project_path = str(supplied_project)
    handle = f"spub1_{secrets.token_urlsafe(24)}"
    preflight_result_path = result_path(handle, "preflight")
    discover_result_path = result_path(handle, "discover")
    configured_paths: list[str] = []
    try:
        preflight_path = configured_context_script(PREFLIGHT_SCRIPT, preflight_result_path)
        configured_paths.append(preflight_path)
        discover_path = configured_context_script(
            DISCOVER_SCRIPT,
            discover_result_path,
            settings={
                "TENANT_ID": tenant_id,
                "FORCE_CATEGORY_FETCH": "true" if force_category_fetch else "",
                "PACKAGE_ID_NONCE": secrets.token_hex(8),
                "PROPOSED_PACKAGE_ID": proposed_package_id,
            },
        )
        configured_paths.append(discover_path)
    except Exception:
        for configured_path in configured_paths:
            cleanup_configured(configured_path)
        preflight_result_path.unlink(missing_ok=True)
        discover_result_path.unlink(missing_ok=True)
        raise
    write_state(
        handle,
        {
            "protocolVersion": PROTOCOL_VERSION,
            "sessionStage": "context_scripts_ready",
            "configuredPaths": configured_paths,
            "resultPaths": {
                "preflight": str(preflight_result_path),
                "discover": str(discover_result_path),
            },
            "requestedProjectPath": requested_project_path,
            "contextSettings": {
                "tenantId": tenant_id,
                "forceCategoryFetch": force_category_fetch,
            },
        },
    )
    return {
        "status": "CONTEXT_SCRIPTS_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "preflightScriptPath": preflight_path,
        "discoverScriptPath": discover_path,
        **({"requestedProjectPath": requested_project_path} if requested_project_path else {}),
    }


def stage_context(payload: dict[str, Any]) -> dict[str, Any]:
    """Retain persisted Editor discovery results and validate publish-context once."""

    handle_value = payload.get("stateHandle")
    retained_state: dict[str, Any] | None = None
    if handle_value is not None:
        handle = require_string(handle_value, "stateHandle")
        retained_state = load_state(handle, expected_stage="context_scripts_ready")
        preflight = editor_result_from_session(payload, retained_state, "preflight")
        discover = editor_result_from_session(payload, retained_state, "discover")
    else:
        # Compatibility/recovery interface for runtimes that already hold exact results.
        preflight = editor_operation_result(payload.get("preflightResult"), "preflight")
        discover = editor_operation_result(payload.get("discoverResult"), "discover")
    if (
        retained_state is not None
        and retained_state.get("requestedProjectPath")
        and isinstance(preflight.get("projectPath"), str)
        and preflight["projectPath"].strip()
    ):
        requested = Path(require_string(retained_state.get("requestedProjectPath"), "requestedProjectPath")).resolve()
        actual = Path(require_string(preflight.get("projectPath"), "preflight.projectPath")).resolve()
        if actual != requested:
            return {
                "status": "ACTION_REQUIRED",
                "stage": "publish_session",
                "reason": "wrong_project_open",
                "message": (
                    "Lens Studio has a different project open. Open the requested project, then rerun only the "
                    "returned Preflight and discovery scripts."
                ),
                "stateHandle": handle,
            }
    if not preflight_can_prepare(preflight):
        return preflight
    if discover.get("status") != "DISCOVERED":
        return discover
    try:
        package_id_assignment = FLOW.package_id_needs_assignment(preflight, discover)
        legal_documents = FLOW.normalize_legal_context(
            discover.get("publishContext", {}).get("data", {}).get("legalDocuments")
        )
    except FLOW.FlowIssue as error:
        raise SessionIssue(error.reason, error.message, status=error.status) from error
    observed_version = preflight.get("packageVersion")
    if not isinstance(observed_version, str):
        raise SessionIssue("package_identity_changed", "Preflight must report the observed Build Version.")
    observed_version = observed_version.strip()
    repair_version = not FLOW.is_valid_build_version(observed_version)
    if (
        discover.get("currentPackageVersion", observed_version) != observed_version
        or (not repair_version and discover.get("packageVersion") != observed_version)
        or (
            repair_version
            and (
                discover.get("currentPackageVersion") != observed_version
                or discover.get("packageVersion") != "1.0.0"
                or discover.get("projectPath") != preflight.get("projectPath")
            )
        )
    ):
        raise SessionIssue("package_identity_changed", "Build Version changed between Preflight and discovery.")
    availability = publish_context_availability(discover)
    store_listing_reuse = publish_context_store_listing_reuse(discover)
    discover = {
        **discover,
        "availability": {"data": copy.deepcopy(availability)},
        "storeListingReuse": copy.deepcopy(store_listing_reuse),
    }
    version_policy = run_flow_result(
        "version-guard",
        {
            "packageId": discover.get("packageId"),
            "packageVersion": discover.get("packageVersion"),
            "availabilityResponse": availability,
        },
    )
    if version_policy.get("status") != "VERSION_POLICY_OK":
        suggestions = (version_policy.get("details") or {}).get("suggestions")
        next_available = suggestions.get("nextAvailable") if isinstance(suggestions, dict) else None
        if (
            retained_state is not None
            and version_policy.get("reason") == "SPK_BUILD_VERSION_NOT_INCREMENTED"
            and isinstance(next_available, str)
            and next_available.strip()
        ):
            # The backend suggestion has passed version-guard's strict parser. Default the
            # publish plan to that exact value, but do not persist it until the consolidated
            # publish confirmation authorizes the deterministic Package execution.
            current_build_version = observed_version
            project_path = require_string(preflight.get("projectPath"), "preflight.projectPath")
            package_id = require_string(discover.get("packageId"), "discover.packageId")
            build_version_plan = {
                "action": "assign",
                "projectPath": project_path,
                "currentBuildVersion": current_build_version,
                "buildVersion": next_available,
            }
            planning_preflight = {**preflight, "packageVersion": next_available}
            planning_discover = {**discover, "packageVersion": next_available}
            pending_version_policy = planned_build_version_policy(
                version_policy,
                package_id=package_id,
                package_version=next_available,
            )
            review_input_path, review_summary = collect_review_for_session(handle, preflight)
            write_state(
                handle,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "sessionStage": "context_ready",
                    "configuredPaths": [],
                    "resultPaths": {},
                    "preflight": planning_preflight,
                    "discover": planning_discover,
                    "versionPolicy": pending_version_policy,
                    "reviewInputPath": str(review_input_path),
                    "buildVersionPlan": build_version_plan,
                    "contextSettings": copy.deepcopy(retained_state.get("contextSettings", {})),
                    "requestedProjectPath": retained_state.get("requestedProjectPath", ""),
                },
            )
            for configured_path in retained_state.get("configuredPaths", []):
                if isinstance(configured_path, str):
                    cleanup_configured(configured_path)
            consume_result_path(retained_state, "preflight")
            consume_result_path(retained_state, "discover")
            return {
                "status": "PUBLISH_CONTEXT_STAGED",
                "stage": "publish_session",
                "stateHandle": handle,
                "lensName": preflight.get("lensName"),
                "packageId": package_id,
                "packageIdNeedsAssignment": package_id_assignment,
                "packageVersion": next_available,
                "buildVersionPlan": copy.deepcopy(build_version_plan),
                "storeListingReuse": copy.deepcopy(store_listing_reuse),
                "legalDocuments": copy.deepcopy(legal_documents),
                "selectableCategories": copy.deepcopy(discover.get("selectableCategories", [])),
                "reviewSummary": review_summary,
                "versionPolicy": {
                    "coverage": pending_version_policy["coverage"],
                    "nextAvailablePkgBuildVersion": next_available,
                    "versionReason": pending_version_policy["versionReason"],
                    **(
                        {"publishedBuildVersionFloor": pending_version_policy["publishedBuildVersionFloor"]}
                        if "publishedBuildVersionFloor" in pending_version_policy
                        else {}
                    ),
                },
            }
        return {
            **version_policy,
            **({"stateHandle": handle} if retained_state is not None else {}),
        }
    build_version_plan = None
    if repair_version:
        build_version_plan = {
            "action": "assign",
            "projectPath": preflight["projectPath"],
            "currentBuildVersion": observed_version,
            "buildVersion": discover["packageVersion"],
        }
        version_policy = planned_build_version_policy(
            version_policy,
            package_id=discover["packageId"],
            package_version=discover["packageVersion"],
        )
        preflight = {**preflight, "packageVersion": discover["packageVersion"]}
    if retained_state is None:
        handle = f"spub1_{secrets.token_urlsafe(24)}"
    review_input_path, review_summary = collect_review_for_session(handle, preflight)
    if retained_state is not None:
        for configured_path in retained_state.get("configuredPaths", []):
            if isinstance(configured_path, str):
                cleanup_configured(configured_path)
        consume_result_path(retained_state, "preflight")
        consume_result_path(retained_state, "discover")
    write_state(
        handle,
        {
            "protocolVersion": PROTOCOL_VERSION,
            "sessionStage": "context_ready",
            "preflight": preflight,
            "discover": discover,
            "versionPolicy": version_policy,
            **({"buildVersionPlan": build_version_plan} if build_version_plan else {}),
            "configuredPaths": [],
            "resultPaths": {},
            "reviewInputPath": str(review_input_path),
        },
    )
    return {
        "status": "PUBLISH_CONTEXT_STAGED",
        "stage": "publish_session",
        "stateHandle": handle,
        "lensName": preflight.get("lensName"),
        "packageId": discover.get("packageId"),
        "packageIdNeedsAssignment": package_id_assignment,
        "packageVersion": discover.get("packageVersion"),
        **({"buildVersionPlan": build_version_plan} if build_version_plan else {}),
        "storeListingReuse": copy.deepcopy(store_listing_reuse),
        "legalDocuments": copy.deepcopy(legal_documents),
        "selectableCategories": copy.deepcopy(discover.get("selectableCategories", [])),
        "reviewSummary": review_summary,
        "versionPolicy": {
            key: copy.deepcopy(version_policy.get(key))
            for key in (
                "coverage",
                "publishedBuildVersionFloor",
                "nextAvailablePkgBuildVersion",
                "versionReason",
            )
            if key in version_policy
        },
    }


def image_operation(input_schema: str) -> Callable:
    """Validate each new public session boundary, including error responses."""

    def decorate(operation: Callable) -> Callable:
        def checked(payload: dict[str, Any]) -> dict[str, Any]:
            try:
                PREVIEW_CONTRACT.validate(input_schema, payload)
                result = operation(payload)
            except SessionIssue as error:
                result = error.result
            except (ValueError, OSError) as error:
                result = SessionIssue("preview_images_invalid", str(error), status="ACTION_REQUIRED").result
            return PREVIEW_CONTRACT.validate("sessionResult", result)

        return checked

    return decorate


def preview_image_request(handle: str, index: int) -> dict[str, Any]:
    return {
        "status": "PREVIEW_IMAGE_CAPTURE_REQUIRED",
        "stage": "publish_session",
        "stateHandle": handle,
        "previewIndex": index,
        "screenshotRequest": {
            "tool": "CapturePanelScreenshotTool",
            "arguments": {
                "pluginId": "Snap.Plugin.Gui.PreviewPanel",
                "outputPath": str(owned_preview_dir(handle) / f"preview-source-{index + 1}.png"),
                "maxDimension": 1920,
            },
        },
    }


@image_operation("prepareInput")
def prepare_preview_images(payload: dict[str, Any]) -> dict[str, Any]:
    handle = payload["stateHandle"]
    state = load_state(handle)
    preview_result = state.get("previewResult")
    after_video = (
        state.get("sessionStage") == "preview_ready"
        and isinstance(preview_result, dict)
        and not isinstance(state.get("previewImages"), list)
    )
    if state.get("sessionStage") != "context_ready" and not after_video:
        raise SessionIssue(
            "publish_session_stage_invalid",
            f"The publish session is {state.get('sessionStage')!r}, not 'context_ready' or a finished auto video.",
        )
    image_count = payload.get("imageCount", 2)
    if image_count == 1 and not after_video:
        raise SessionIssue(
            "preview_images_required",
            "One screenshot requires a retained recording or its image fallback; image-only previews need two.",
            status="ACTION_REQUIRED",
        )
    if after_video:
        # The retained recording lives in the artifact directory; drop only its capture intermediates.
        cleanup_owned_preview(handle, state)
        state["previewResult"] = preview_result
    preview_dir = owned_preview_dir(handle)
    if preview_dir.exists():
        raise SessionIssue("preview_session_exists", "This session already has preview staging.")
    preview_dir.mkdir(mode=0o700)
    state.update(
        {
            "sessionStage": "preview_images_capturing",
            "previewDir": str(preview_dir),
            "previewImageCaptures": [],
            "previewImageCount": image_count,
        }
    )
    try:
        write_state(handle, state)
    except Exception:
        shutil.rmtree(preview_dir, ignore_errors=True)
        raise
    result = preview_image_request(handle, 0)
    result["resetRequest"] = {"tool": "PreviewPanelTool", "arguments": {"action": "refresh"}}
    return result


def screenshot_result(value: Any, depth: int = 0) -> dict[str, Any]:
    """Accept direct ChatTool data and common MCP envelopes without copying image bytes."""
    if depth > 5:
        raise ValueError("Screenshot result nesting is too deep")
    if isinstance(value, str):
        return screenshot_result(json.loads(value), depth + 1)
    if not isinstance(value, dict) or value.get("isError") or value.get("error"):
        raise ValueError("Screenshot capture failed; supply saved Preview images or cancel")
    if "path" in value:
        return PREVIEW_CONTRACT.validate("captureResult", value)
    for key in ("structuredContent", "data", "result"):
        if key in value and value[key] is not None:
            return screenshot_result(value[key], depth + 1)
    content = value.get("content")
    if isinstance(content, list) and len(content) == 1 and isinstance(content[0], dict):
        if content[0].get("type") == "text":
            return screenshot_result(content[0].get("text"), depth + 1)
    raise ValueError("Expected one file-backed Preview screenshot result; inline images are unsupported")


def retain_preview_images(
    handle: str, images: list[dict[str, Any]], recording: dict[str, Any] | None = None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Retain the requested images and any recording with one expiry manifest and rollback."""
    artifact_dir = owned_preview_artifact_dir(handle)
    if recording is None:
        if artifact_dir.exists():
            raise SessionIssue("preview_artifact_exists", "This session already retained preview media.")
        artifact_dir.mkdir(mode=0o700)
    elif Path(require_string(recording.get("path"), "session.previewArtifact.path")).parent != artifact_dir:
        raise SessionIssue("preview_artifact_path_invalid", "The retained recording is not session-owned.")
    retained = []
    try:
        for index, image in enumerate(images):
            target = artifact_dir / f"preview-image-{index + 1}.png"
            if recording is not None and target.exists():
                raise SessionIssue("preview_artifact_exists", "This session already retained preview images.")
            shutil.copyfile(image["path"], target)
            target.chmod(0o600)
            retained.append({**image, "path": str(target)})
        created = int(time.time())
        paths = [image["path"] for image in retained]
        manifest = PREVIEW_CONTRACT.validate(
            "manifest",
            {
                "createdAtEpochSeconds": created,
                "expiresAtEpochSeconds": preview_artifact_expiration(created),
                "mediaType": "image" if recording is None else recording["mediaType"],
                "path": paths[0] if recording is None else recording["path"],
                "paths": paths if recording is None else [recording["path"], *paths],
            },
        )
        manifest_path = artifact_dir / PREVIEW_ARTIFACT_MANIFEST
        manifest_path.write_text(canonical_json(manifest) + "\n", encoding="utf-8")
        manifest_path.chmod(0o600)
    except Exception:
        release_preview_images(handle, retained, recording)
        raise
    return retained, manifest


def release_preview_images(handle: str, retained: list[dict[str, Any]], recording: dict[str, Any] | None) -> None:
    """Undo image retention, keeping a retained auto-video recording and its manifest."""
    artifact_dir = owned_preview_artifact_dir(handle)
    if recording is None:
        shutil.rmtree(artifact_dir, ignore_errors=True)
        return
    for image in retained:
        Path(image["path"]).unlink(missing_ok=True)
    manifest_path = artifact_dir / PREVIEW_ARTIFACT_MANIFEST
    manifest_path.write_text(canonical_json(recording) + "\n", encoding="utf-8")
    manifest_path.chmod(0o600)


@image_operation("recordInput")
def record_preview_images(payload: dict[str, Any]) -> dict[str, Any]:
    handle = payload["stateHandle"]
    state = load_state(handle)
    if (
        state.get("sessionStage") == "preview_ready"
        and isinstance(state.get("previewImages"), list)
        and set(payload) == {"stateHandle"}
    ):
        return {
            "status": "PUBLISH_PREVIEW_IMAGES_READY",
            "stage": "publish_session",
            "stateHandle": handle,
            "images": state["previewImages"],
        }
    if state.get("sessionStage") not in {"preview_images_capturing", "preview_images_staging"}:
        raise SessionIssue("publish_session_stage_invalid", "The session is not awaiting Preview images.")
    captures = state["previewImageCaptures"]
    image_count = PREVIEW_CONTRACT.validate("captureImageCount", state.get("previewImageCount", 2))
    sources = [owned_preview_dir(handle) / f"preview-source-{index + 1}.png" for index in range(image_count)]
    manual_paths = payload.get("manualPaths")
    if manual_paths is not None and (not state.get("previewImageFailure") or "result" in payload):
        raise SessionIssue(
            "preview_images_invalid", "Manual paths are recovery only; omit a capture result", status="ACTION_REQUIRED"
        )
    try:
        if manual_paths is not None:
            paths = [Path(path) for path in manual_paths]
            if any(not path.is_absolute() or not path.is_file() for path in paths):
                raise ValueError("Manual paths must be existing absolute Preview screenshot files")
            if len(paths) != image_count or len({path.resolve() for path in paths}) != image_count:
                raise ValueError(f"Supply exactly {image_count} separate manual screenshots for this session")
            if any(path.resolve() in sources for path in paths):
                raise ValueError("Manual screenshots must be outside session capture paths")
            for path, target in zip(paths, sources):
                shutil.copyfile(path, target)
            state["sessionStage"] = "preview_images_staging"
        elif state["sessionStage"] == "preview_images_capturing":
            result = screenshot_result(payload.get("result"))
            expected = sources[len(captures)]
            if (
                not Path(result["path"]).is_absolute()
                or Path(result["path"]).resolve() != expected.resolve()
                or expected.is_symlink()
                or not expected.is_file()
            ):
                raise ValueError("Screenshot result must name the requested session-owned file")
            captures.append({key: result[key] for key in ("path", "pluginId", "width", "height")})
            state.pop("previewImageFailure", None)
            if len(captures) < image_count:
                write_state(handle, state)
                return preview_image_request(handle, len(captures))
            state["sessionStage"] = "preview_images_staging"
        elif "result" in payload:
            raise ValueError("All requested capture receipts are retained; retry staging with only stateHandle")
        # Persist accepted receipts before staging, so a failed normalizer never reissues a capture.
        write_state(handle, state)
        staged = run_json_command(
            [
                sys.executable,
                str(STAGE_SCREENSHOT),
                "--input",
                str(sources[0]),
                *(["--second-input", str(sources[1])] if image_count == 2 else []),
                "--output",
                str(owned_preview_dir(handle) / "preview-image.png"),
            ]
        )
        PREVIEW_CONTRACT.validate("stageResult", staged)
        expected_status = "SCREENSHOT_READY" if image_count == 1 else "SCREENSHOTS_READY"
        if staged["status"] != expected_status:
            raise ValueError(staged.get("message", "The requested screenshots were not staged"))
        images = (
            [{key: value for key, value in staged.items() if key != "status"}] if image_count == 1 else staged["images"]
        )
        expected_outputs = [
            owned_preview_dir(handle) / name for name in ("preview-image.png", "preview-image-2.png")[:image_count]
        ]
        if [image["path"] for image in images] != [str(path) for path in expected_outputs]:
            raise ValueError("Staged image paths do not match the session outputs")
        recording = state.get("previewArtifact") if isinstance(state.get("previewResult"), dict) else None
        retained, manifest = retain_preview_images(handle, images, recording)
        state.update({"sessionStage": "preview_ready", "previewImages": retained, "previewArtifact": manifest})
        try:
            write_state(handle, state)
        except Exception:
            release_preview_images(handle, retained, recording)
            if recording is None:
                state.pop("previewArtifact", None)
            else:
                state["previewArtifact"] = recording
            state.pop("previewImages", None)
            state["sessionStage"] = "preview_images_staging"
            raise
    except (ValueError, OSError, SessionIssue) as error:
        state["previewImageFailure"] = True
        write_state(handle, state)
        message = error.result["message"] if isinstance(error, SessionIssue) else str(error)
        raise SessionIssue("preview_images_invalid", message, status="ACTION_REQUIRED") from error
    # Only session-owned sources/intermediates are removed after durable retention.
    for path in [*sources, *expected_outputs]:
        path.unlink(missing_ok=True)
    return {
        "status": "PUBLISH_PREVIEW_IMAGES_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "images": retained,
    }


def preview_config_path(state: dict[str, Any]) -> Path:
    return Path(require_string(state.get("previewConfigPath"), "session.previewConfigPath"))


def preview_outcome(handle: str, state: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    status = result.get("status")
    if status == "INSPECTION_READY":
        state.update({"sessionStage": "preview_decision_required", "previewInspection": copy.deepcopy(result)})
        write_state(handle, state)
        return {**copy.deepcopy(result), "stage": "publish_session", "stateHandle": handle}
    if status == "CAPTURE_SCREENSHOT":
        preview_dir = owned_preview_dir(handle)
        screenshot_input = preview_dir / "preview-source.jpg"
        state.update(
            {
                "sessionStage": "preview_screenshot_required",
                "previewFallback": copy.deepcopy(result),
            }
        )
        write_state(handle, state)
        return {
            "status": "PREVIEW_SCREENSHOT_REQUIRED",
            "stage": "publish_session",
            "stateHandle": handle,
            "reason": result.get("reason"),
            "screenshotInputPath": str(screenshot_input),
            "screenshotRequest": {
                "tool": "CapturePanelScreenshotTool",
                "arguments": {
                    "pluginId": "Snap.Plugin.Gui.PreviewPanel",
                    "outputPath": str(screenshot_input),
                    "maxDimension": 1920,
                },
            },
        }
    if status not in {"VIDEO_READY", "AUTO_IMAGE_READY"}:
        cleanup_owned_preview(handle, state)
        state["sessionStage"] = "context_ready"
        write_state(handle, state)
        return {**copy.deepcopy(result), "stateHandle": handle}

    path_value = require_string(result.get("path"), "preview result path")
    path = Path(path_value).resolve()
    preview_dir = owned_preview_dir(handle).resolve()
    if path.parent != preview_dir or not path.is_file():
        raise SessionIssue("preview_result_path_invalid", "The final preview media is not session-owned.")
    media_type = "video" if status == "VIDEO_READY" else "image"
    source = "auto_video" if media_type == "video" else "auto_image"
    artifact = retain_preview_artifact(handle, path, media_type)
    retained = {
        **copy.deepcopy(result),
        "path": artifact["path"],
        "type": media_type,
        "source": source,
    }
    state.update(
        {
            "sessionStage": "preview_ready",
            "previewResult": retained,
            "previewArtifact": artifact,
        }
    )
    state.pop("previewInspection", None)
    state.pop("previewFallback", None)
    try:
        write_state(handle, state)
    except Exception:
        cleanup_owned_preview_artifact(handle, state)
        raise
    return {
        "status": "PUBLISH_PREVIEW_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "media": {
            key: retained[key]
            for key in ("type", "source", "width", "height", "durationSeconds", "bytes")
            if key in retained
        },
    }


def prepare_preview_video(payload: dict[str, Any]) -> dict[str, Any]:
    """Create session-owned native-preview capture inputs and one persisted Editor script."""

    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="context_ready")
    preflight = require_object(state.get("preflight"), "session.preflight")
    project_path = require_string(preflight.get("projectPath"), "session.preflight.projectPath")
    preview_dir = owned_preview_dir(handle)
    if preview_dir.exists():
        raise SessionIssue("preview_session_exists", "This publish session already has preview staging.")
    preview_dir.mkdir(mode=0o700)
    config_path = preview_dir / "preview-media-config.json"
    config_path.write_text(
        canonical_json({"recorderScript": str(PREVIEW_RECORDER), "outputDir": str(preview_dir)}) + "\n",
        encoding="utf-8",
    )
    persisted_result_path = result_path(handle, "preview_video")
    try:
        configured_path = configured_context_script(
            RECORD_PREVIEW_SCRIPT,
            persisted_result_path,
            settings={
                "OUTPUT_PATH": str(preview_dir / "preview-native.mp4"),
                "EXPECTED_PROJECT_PATH": project_path,
            },
        )
        state.update(
            {
                "sessionStage": "preview_authorized",
                "previewDir": str(preview_dir),
                "previewConfigPath": str(config_path),
                "configuredPaths": [*state.get("configuredPaths", []), configured_path],
                "resultPaths": {**state.get("resultPaths", {}), "preview_video": str(persisted_result_path)},
            }
        )
        write_state(handle, state)
    except Exception:
        shutil.rmtree(preview_dir, ignore_errors=True)
        raise
    return {
        "status": "PREVIEW_SCRIPT_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "previewScriptPath": configured_path,
    }


def record_preview_video(payload: dict[str, Any]) -> dict[str, Any]:
    """Consume the persisted native capture, normalize it, and request only the visual decision."""

    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="preview_authorized")
    configured = state.get("configuredPaths", [])
    if not isinstance(configured, list) or not configured:
        raise SessionIssue("preview_script_missing", "The session has no configured Preview script.")
    result = editor_result_from_session(payload, state, "preview_video")
    config_path = preview_config_path(state)
    preview_dir = owned_preview_dir(handle)

    if result.get("status") == "EDITOR_RECORDING_UNAVAILABLE":
        capture = run_json_command([sys.executable, str(PREVIEW_FLOW), "capture-command", "--config", str(config_path)])
        consume_configured_path(state, configured[-1])
        consume_result_path(state, "preview_video")
        if capture.get("status") != "CAPTURE_COMMAND_READY":
            return preview_outcome(handle, state, capture)
        compatibility_result = session_root() / f"{handle}.preview-compat-result.json"
        compatibility_result.unlink(missing_ok=True)
        command = require_string(capture.get("command"), "capture.command")
        state.update(
            {
                "sessionStage": "preview_compatibility_authorized",
                "previewCompatibilityResultPath": str(compatibility_result),
            }
        )
        write_state(handle, state)
        return {
            "status": "PREVIEW_COMPATIBILITY_READY",
            "stage": "publish_session",
            "stateHandle": handle,
            "command": f"{command} > {shlex.quote(str(compatibility_result))}",
        }
    if result.get("status") != "EDITOR_VIDEO_READY":
        consume_configured_path(state, configured[-1])
        consume_result_path(state, "preview_video")
        return preview_outcome(handle, state, result)

    subprocess.run(
        [
            sys.executable,
            str(NORMALIZE_PREVIEW),
            "--input",
            str(preview_dir / "preview-native.mp4"),
            "--output",
            str(preview_dir / "preview-video.mp4"),
            "--log",
            str(preview_dir / "recorder-result.json"),
            "--duration-seconds",
            "20",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    inspected = run_json_command([sys.executable, str(PREVIEW_FLOW), "inspect", "--config", str(config_path)])
    consume_configured_path(state, configured[-1])
    consume_result_path(state, "preview_video")
    return preview_outcome(handle, state, inspected)


def record_preview_compatibility(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="preview_compatibility_authorized")
    path = Path(require_string(state.get("previewCompatibilityResultPath"), "previewCompatibilityResultPath"))
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        if payload.get("reason") != "worker_timeout":
            raise SessionIssue(
                "preview_compatibility_result_unreadable", str(error), status="ACTION_REQUIRED"
            ) from error
        result = run_json_command(
            [
                sys.executable,
                str(PREVIEW_FLOW),
                "inspect",
                "--recovery",
                "--config",
                str(preview_config_path(state)),
            ]
        )
    path.unlink(missing_ok=True)
    state.pop("previewCompatibilityResultPath", None)
    return preview_outcome(handle, state, require_object(result, "preview compatibility result"))


def decide_preview_video(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="preview_decision_required")
    decision = require_string(payload.get("decision"), "decision")
    if decision not in {"video", "image", "screenshot"}:
        raise SessionIssue("preview_decision_invalid", "decision must be video, image, or screenshot.")
    arguments = [
        sys.executable,
        str(PREVIEW_FLOW),
        "decide",
        "--config",
        str(preview_config_path(state)),
        "--decision",
        decision,
    ]
    frame = payload.get("frame")
    if frame is not None:
        arguments.extend(["--frame", require_string(frame, "frame")])
    result = run_json_command(arguments)
    return preview_outcome(handle, state, result)


def stage_preview_screenshot(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="preview_screenshot_required")
    screenshot = owned_preview_dir(handle) / "preview-source.jpg"
    if not screenshot.is_file():
        raise SessionIssue(
            "preview_screenshot_missing",
            "Run the returned CapturePanelScreenshotTool screenshotRequest, then retry this operation.",
            status="ACTION_REQUIRED",
        )
    result = run_json_command(
        [
            sys.executable,
            str(PREVIEW_FLOW),
            "screenshot",
            "--config",
            str(preview_config_path(state)),
            "--input",
            str(screenshot),
        ]
    )
    return preview_outcome(handle, state, result)


def prepare(payload: dict[str, Any]) -> dict[str, Any]:
    # The healthy interface advances the context handle and supplies only compact
    # semantic proposals. Session-owned preview media and review input are joined
    # here so the model never reconstructs paths or collector output.
    assembly_value = payload.get("assembly")
    handle_value = payload.get("stateHandle")
    retained_state: dict[str, Any] | None = None
    build_version_plan: dict[str, Any] | None = None
    if handle_value is not None:
        handle = require_string(handle_value, "stateHandle")
        retained_state = load_state(handle)
        if retained_state.get("sessionStage") not in {"context_ready", "preview_ready", "edit_requested"}:
            raise SessionIssue(
                "publish_session_stage_invalid",
                f"The publish session is {retained_state.get('sessionStage')!r}, not ready to prepare.",
            )
        preflight = require_object(retained_state.get("preflight"), "session.preflight")
        discover = require_object(retained_state.get("discover"), "session.discover")
        version_policy = require_object(retained_state.get("versionPolicy"), "session.versionPolicy")
        if isinstance(retained_state.get("buildVersionPlan"), dict):
            build_version_plan = copy.deepcopy(retained_state["buildVersionPlan"])

    review_input_value = payload.get("reviewInput")
    if review_input_value is None:
        supplied_review_path = payload.get("reviewInputPath")
        if supplied_review_path is not None:
            review_input_path = Path(require_string(supplied_review_path, "reviewInputPath"))
        elif retained_state is not None and isinstance(retained_state.get("reviewInputPath"), str):
            review_input_path = Path(retained_state["reviewInputPath"])
        elif retained_state is not None:
            review_input_path, _ = collect_review_for_session(handle, preflight)
            retained_state["reviewInputPath"] = str(review_input_path)
        else:
            review_input_path = Path(require_string(supplied_review_path, "reviewInputPath"))
        try:
            review_input_value = json.loads(review_input_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise SessionIssue("review_input_unreadable", f"Could not read reviewInputPath: {error}.") from error
    review_input = require_object(review_input_value, "reviewInput")

    if handle_value is not None:
        changes = normalize_proposals(payload.get("proposals", {}))
        proposals = {
            **normalize_proposals(retained_state.get("proposals", {})),
            **changes,
        }
        if changes.get("legalDocumentInputs"):
            proposals["legalDocumentInputs"] = {
                **require_object(
                    retained_state.get("proposals", {}).get("legalDocumentInputs", {}), "saved legal inputs"
                ),
                **require_object(changes["legalDocumentInputs"], "legalDocumentInputs"),
            }
        # An edit to another field must preserve the channel already shown to the user.
        previous_plan = retained_state.get("frozen", {}).get("plan", {})
        if "legalDocumentInputs" not in proposals and "legalDocumentInputs" in previous_plan:
            proposals["legalDocumentInputs"] = previous_plan["legalDocumentInputs"]
        if "targetChannel" not in proposals and "targetChannel" in previous_plan:
            proposals["targetChannel"] = FLOW.validate_target_channel(previous_plan["targetChannel"])
        if "tileSourcePath" not in proposals and retained_state.get("tileSourcePath") is not None:
            proposals["tileSourcePath"] = require_string(retained_state["tileSourcePath"], "session.tileSourcePath")
        requested_build_version = proposals.pop("buildVersion", None)
        if requested_build_version is not None:
            build_version_plan, version_policy = edited_build_version_plan(
                build_version_plan,
                version_policy,
                requested_build_version,
            )
        preview_result = retained_state.get("previewResult")
        preview_images = retained_state.get("previewImages")
        if isinstance(preview_result, dict) and not isinstance(preview_images, list):
            raise SessionIssue(
                "preview_images_required",
                "Auto video needs Preview screenshots: call prepare-preview-images "
                "(use --image-count 1 when one screenshot was requested), then prepare.",
                status="ACTION_REQUIRED",
            )
        if isinstance(preview_images, list):
            if "previewMedia" in proposals or "previewMediaPlan" in proposals:
                raise SessionIssue(
                    "proposal_fields_invalid",
                    "Session-owned preview media is already staged; omit previewMedia and previewMediaPlan.",
                    status="ACTION_REQUIRED",
                )
            proposals["previewMediaPlan"] = "auto_image"
            proposals["previewMedia"] = [
                {"path": image["path"], "source": "auto_image", "type": "image"} for image in preview_images
            ]
            if isinstance(preview_result, dict):
                # The recording (or its image fallback) leads, followed by the requested screenshots.
                source = require_string(preview_result.get("source"), "session.previewResult.source")
                proposals["previewMediaPlan"] = source
                proposals["previewMedia"].insert(
                    0,
                    {
                        "path": require_string(preview_result.get("path"), "session.previewResult.path"),
                        "source": source,
                        "type": require_string(preview_result.get("type"), "session.previewResult.type"),
                    },
                )
        assembly = {
            "preflight": preflight,
            "discover": discover,
            "collector": review_input,
            "proposals": proposals,
        }
    elif assembly_value is None:
        preflight = editor_operation_result(payload.get("preflightResult"), "preflight")
        if not preflight_can_prepare(preflight):
            return preflight
        discover = editor_operation_result(payload.get("discoverResult"), "discover")
        if discover.get("status") != "DISCOVERED":
            return discover
        proposals = normalize_proposals(payload.get("proposals", {}))
        if proposals.pop("buildVersion", None) is not None:
            raise SessionIssue(
                "build_version_edit_unavailable",
                "Build Version edits require a retained context session with a backend default.",
                status="ACTION_REQUIRED",
            )
        assembly = {
            "preflight": preflight,
            "discover": discover,
            "collector": review_input,
            "proposals": proposals,
        }
        version_policy = run_flow_result(
            "version-guard",
            {
                "packageId": discover.get("packageId"),
                "packageVersion": discover.get("packageVersion"),
                "availabilityResponse": publish_context_availability(discover),
            },
        )
        if version_policy.get("status") != "VERSION_POLICY_OK":
            return version_policy
    else:
        # Retain the legacy object interface for recovery and existing callers.
        assembly = require_object(assembly_value, "assembly")
        overrides = normalize_proposals(payload.get("proposals", {}))
        if "targetChannel" in overrides:
            legacy_proposals = require_object(assembly.get("proposals", {}), "assembly.proposals")
            if "targetChannel" in legacy_proposals:
                raise SessionIssue(
                    "proposal_fields_invalid",
                    "Supply targetChannel in either assembly.proposals or the prepare arguments, not both.",
                    status="ACTION_REQUIRED",
                )
            assembly = {**assembly, "proposals": {**legacy_proposals, "targetChannel": overrides["targetChannel"]}}
        if "collector" not in assembly:
            assembly = {**assembly, "collector": review_input}
        preflight = require_object(assembly.get("preflight"), "assembly.preflight")
        discover = require_object(assembly.get("discover"), "assembly.discover")
        version_policy = require_object(payload.get("versionPolicy"), "versionPolicy")
    presentation_changes = copy.deepcopy(require_object(payload.get("presentation", {}), "presentation"))
    if "inlineRenderingSupported" in presentation_changes:
        raise SessionIssue(
            "confirmation_presentation_invalid",
            "prepare owns inline rendering; omit presentation.inlineRenderingSupported.",
        )

    prior_presentation = copy.deepcopy(retained_state.get("presentation", {})) if retained_state else {}
    # Rebind derived presentation fields to the current plan, especially after an icon edit.
    prior_presentation.pop("lensIconPath", None)
    prior_presentation.pop("inlineRenderingSupported", None)
    presentation = {**prior_presentation, **presentation_changes}
    if handle_value is None:
        handle = f"spub1_{secrets.token_urlsafe(24)}"
    user_media_dir = owned_user_media_dir(handle, assembly.get("proposals", {}).get("previewMedia"))
    assembled = run_json_script(ASSEMBLE_PLAN, {**assembly, "previewStagingDir": str(user_media_dir)})
    if assembled.get("status") != "PLAN_INPUT_READY":
        shutil.rmtree(user_media_dir, ignore_errors=True)
        return assembled
    freeze_input = copy.deepcopy(require_object(assembled.get("freezePlanInput"), "freezePlanInput"))
    try:
        tile_reuse = FLOW.normalize_store_listing_reuse(freeze_input.get("storeListingReuse"))
    except FLOW.FlowIssue as error:
        raise SessionIssue(error.reason, error.message, status="ACTION_REQUIRED") from error
    tile_dir = owned_preview_artifact_dir(handle) / "tiles" / secrets.token_hex(8)
    try:
        tile_plan = TILES.prepare(
            {
                "tileAssetsState": "existing" if FLOW.can_reuse(tile_reuse, "tileAssets") else "missing",
                "previewMediaAssets": freeze_input.get("previewMediaAssets", []),
                "sourcePath": assembly.get("proposals", {}).get("tileSourcePath"),
                "outputDir": str(tile_dir),
            }
        )
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        shutil.rmtree(tile_dir, ignore_errors=True)
        shutil.rmtree(user_media_dir, ignore_errors=True)
        return {
            "status": "ACTION_REQUIRED",
            "stage": "publish_session",
            "reason": "tile_preparation_failed",
            "message": str(error),
        }
    freeze_input["tileAssets"] = tile_plan["tileAssets"]
    if tile_plan["tileAssets"]:
        artifact_dir = owned_preview_artifact_dir(handle)
        manifest_path = artifact_dir / PREVIEW_ARTIFACT_MANIFEST
        if not manifest_path.exists():
            manifest_path.write_text(
                canonical_json({"expiresAtEpochSeconds": preview_artifact_expiration(int(time.time()))})
            )
    if build_version_plan is not None:
        freeze_input["packageVersion"] = require_string(
            build_version_plan.get("buildVersion"),
            "session.buildVersionPlan.buildVersion",
        )
        freeze_input["buildVersionPlan"] = build_version_plan
    review_input = review_input_for_plan(review_input, preflight, freeze_input)
    review = run_flow("review-fingerprint", {"reviewInput": review_input})
    freeze_input["initialReviewFingerprint"] = review["reviewFingerprint"]
    frozen = run_flow("freeze-plan", freeze_input)
    if frozen.get("status") != "PLAN_FROZEN":
        shutil.rmtree(user_media_dir, ignore_errors=True)
        return frozen
    validate_version_policy(frozen, version_policy)

    presentation["inlineRenderingSupported"] = True
    bind_lens_icon_presentation(presentation, preflight, require_object(frozen.get("plan"), "frozen.plan"))
    rendered = run_flow("render-confirmation", {"frozen": frozen, "presentation": presentation})
    confirmation = require_object(rendered.get("confirmation"), "confirmation")
    if retained_state is None:
        state = {
            "protocolVersion": PROTOCOL_VERSION,
            "configuredPaths": [],
            "resultPaths": {},
        }
    else:
        state = retained_state
    # Keep semantic proposals for partial edits. Session-owned preview media is
    # reattached above and must not be mistaken for a user replacement on retry.
    retained_proposals = normalize_proposals(assembly.get("proposals", {}))
    if isinstance(state.get("previewResult"), dict) or isinstance(state.get("previewImages"), list):
        retained_proposals.pop("previewMedia", None)
        retained_proposals.pop("previewMediaPlan", None)
    state.update(
        {
            "proposals": retained_proposals,
            "sessionStage": "confirmation_ready",
            "frozen": frozen,
            "review": review,
            "versionPolicy": version_policy,
            "preflight": copy.deepcopy(preflight),
            "discover": copy.deepcopy(discover),
            "presentation": presentation,
            "confirmation": confirmation,
        }
    )
    if tile_plan["tileAssets"]:
        # Preserve the uncropped screenshot for edits; primary is now a square crop.
        source_path = Path(require_string(tile_plan.get("sourcePath"), "tilePlan.sourcePath"))
        retained_source = owned_preview_dir(handle) / "tile-source.png"
        retained_source.parent.mkdir(parents=True, exist_ok=True)
        if source_path.resolve() != retained_source.resolve():
            shutil.copyfile(source_path, retained_source)
        state["tileSourcePath"] = str(retained_source)
        state["proposals"]["tileSourcePath"] = str(retained_source)
        state["previewDir"] = str(retained_source.parent)
    if user_media_dir.exists():
        for stale in user_media_dir.parent.iterdir():
            if stale != user_media_dir:
                shutil.rmtree(stale, ignore_errors=True)
        state["previewDir"] = str(owned_preview_dir(handle))
    if build_version_plan is not None:
        state["buildVersionPlan"] = copy.deepcopy(build_version_plan)
    write_state(handle, state)
    return {
        "status": "PUBLISH_SESSION_PREPARED",
        "stage": "publish_session",
        "stateHandle": handle,
        "reviewFingerprint": review["reviewFingerprint"],
        "confirmation": confirmation,
    }


def fallback(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    token = require_string(payload.get("confirmationToken"), "confirmationToken")
    reason = require_string(payload.get("reason"), "reason")
    state = load_state(handle, expected_stage="confirmation_ready")
    if token != state["confirmation"].get("confirmationToken"):
        raise SessionIssue("confirmation_token_mismatch", "The fallback does not match the current confirmation.")
    presentation = copy.deepcopy(state["presentation"])
    presentation["inlineRenderingSupported"] = False
    rendered = run_flow("render-confirmation", {"frozen": state["frozen"], "presentation": presentation})
    confirmation = require_object(rendered.get("confirmation"), "confirmation")
    state.update(
        {
            "presentation": presentation,
            "confirmation": confirmation,
            "fallbackReason": reason,
        }
    )
    write_state(handle, state)
    return {
        "status": "PUBLISH_SESSION_FALLBACK_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "confirmation": confirmation,
    }


def project_setup_actions(confirmed: dict[str, Any]) -> dict[str, Any]:
    plan = require_object(confirmed.get("confirmedPlan"), "confirmedPlan")
    return {
        "packageId": (
            {
                "action": "assign",
                "scriptPath": str(SKILL_DIR / "scripts" / "editor" / "set-package-id.ts"),
                "args": {
                    "projectPath": plan["projectPath"],
                    "packageId": plan["packageId"],
                    "expectedCurrentPackageId": plan["packageIdBeforeAssignment"],
                },
            }
            if plan.get("packageIdNeedsAssignment") is True
            else {"action": "keep_existing"}
        ),
        "lensName": (
            {"action": "assign", "value": plan.get("lensName")}
            if plan.get("lensNameNeedsAssignment") is True
            else {"action": "keep_existing"}
        ),
        "lensIcon": copy.deepcopy(plan.get("lensIconPlan", {"action": "keep_existing"})),
        "signingKey": copy.deepcopy(plan.get("signingKeyPlan", {"action": "keep_existing"})),
        "buildVersion": copy.deepcopy(plan.get("buildVersionPlan", {"action": "keep_existing"})),
    }


def requires_final_review(actions: dict[str, Any]) -> bool:
    return any(
        actions.get(key, {}).get("action", "keep_existing") != "keep_existing"
        for key in ("packageId", "lensName", "lensIcon")
    )


def confirm(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    token = require_string(payload.get("confirmationToken"), "confirmationToken")
    selection = require_string(payload.get("selectionId"), "selectionId")
    if selection not in {"confirm", "edit", "cancel"}:
        raise SessionIssue("confirmation_selection_invalid", "selectionId must be confirm, edit, or cancel.")
    state = load_state(handle, expected_stage="confirmation_ready")
    if token != state["confirmation"].get("confirmationToken"):
        raise SessionIssue("confirmation_token_mismatch", "The selection does not match the current confirmation.")
    if selection != "confirm":
        state["sessionStage"] = "edit_requested" if selection == "edit" else "cancelled"
        write_state(handle, state)
        return {
            "status": "PUBLISH_EDIT_REQUESTED" if selection == "edit" else "PUBLISH_CANCELLED",
            "stage": "publish_session",
            "stateHandle": handle,
        }

    confirmed = run_flow("confirm-plan", state["frozen"])
    actions = project_setup_actions(confirmed)
    state.update(
        {
            "sessionStage": "confirmed",
            "confirmed": confirmed,
            "projectSetupActions": actions,
        }
    )
    write_state(handle, state)
    return {
        "status": "PUBLISH_SESSION_CONFIRMED",
        "stage": "publish_session",
        "stateHandle": handle,
        "projectSetupActions": actions,
        "finalReviewRequired": requires_final_review(actions),
    }


def validate_final_review(state: dict[str, Any], value: Any) -> dict[str, Any]:
    final_review_input = review_input_for_plan(
        require_object(value, "finalReviewInput"),
        require_object(state.get("preflight"), "session.preflight"),
        require_object(state["confirmed"].get("confirmedPlan"), "confirmed.confirmedPlan"),
    )
    final_review = run_flow("review-fingerprint", {"reviewInput": final_review_input})
    if final_review.get("reviewFingerprint") != state["review"].get("reviewFingerprint"):
        raise SessionIssue(
            "review_changed_after_confirmation",
            "The review-visible project input changed after confirmation; rerun review and rebuild the confirmation.",
            status="ACTION_REQUIRED",
        )
    return final_review


def prepare_final_review(payload: dict[str, Any]) -> dict[str, Any]:
    """Own a fresh post-setter Preflight; never reuse the consumed discovery script."""
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="confirmed")
    existing = state.get("finalReviewScriptPath")
    if isinstance(existing, str) and Path(existing).is_file():
        return {
            "status": "FINAL_REVIEW_SCRIPT_READY",
            "stage": "publish_session",
            "stateHandle": handle,
            "preflightScriptPath": existing,
        }
    if isinstance(existing, str):
        consume_configured_path(state, existing)
    consume_result_path(state, "preflight")
    persisted_path = result_path(handle, "preflight")
    script_path = configured_context_script(PREFLIGHT_SCRIPT, persisted_path)
    state.pop("postSetupPreflight", None)
    state.pop("finalReview", None)
    state.update(
        {
            "finalReviewScriptPath": script_path,
            "configuredPaths": [*state.get("configuredPaths", []), script_path],
            "resultPaths": {**state.get("resultPaths", {}), "preflight": str(persisted_path)},
        }
    )
    try:
        write_state(handle, state)
    except Exception:
        cleanup_configured(script_path)
        raise
    return {
        "status": "FINAL_REVIEW_SCRIPT_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "preflightScriptPath": script_path,
    }


def record_final_review(payload: dict[str, Any]) -> dict[str, Any]:
    """Consume fresh Preflight and collect/validate final review without model-transported JSON."""
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="confirmed")
    if "postSetupPreflight" in state and "finalReviewScriptPath" not in state:
        return {"status": "FINAL_REVIEW_RECORDED", "stage": "publish_session", "stateHandle": handle}
    script_path = require_string(state.get("finalReviewScriptPath"), "finalReviewScriptPath")
    preflight = editor_result_from_session(payload, state, "preflight")
    plan = require_object(state["confirmed"].get("confirmedPlan"), "confirmedPlan")
    if preflight.get("status") != "READY" and not preflight.get("projectPath"):
        return preflight
    if (
        Path(require_string(preflight.get("projectPath"), "preflight.projectPath")).resolve()
        != Path(plan["projectPath"]).resolve()
    ):
        raise SessionIssue(
            "wrong_project_open", "Open the confirmed project and rerun the fresh Preflight.", status="ACTION_REQUIRED"
        )
    version_plan = require_object(plan.get("buildVersionPlan", {}), "confirmedPlan.buildVersionPlan")
    current_version = preflight.get("packageVersion")
    pending_version_repair = (
        version_plan.get("action") == "assign"
        and current_version == version_plan.get("currentBuildVersion")
        and isinstance(current_version, str)
        and not FLOW.is_valid_build_version(current_version)
        and preflight.get("status") == "ACTION_REQUIRED"
        and isinstance(preflight.get("issues"), list)
        and bool(preflight["issues"])
        and all(
            isinstance(issue, dict) and issue.get("reason") == "invalid_package_version"
            for issue in preflight["issues"]
        )
    )
    if preflight.get("status") != "READY" and not pending_version_repair:
        return preflight
    if not isinstance(current_version, str):
        raise SessionIssue("session_input_invalid", "Preflight packageVersion must be a string.")
    permitted_versions = {plan["packageVersion"]}
    if version_plan.get("action") == "assign":
        permitted_versions.add(version_plan["currentBuildVersion"])
    if (
        preflight.get("packageId") != plan["packageId"]
        or preflight.get("lensName") != plan["lensName"]
        or current_version not in permitted_versions
    ):
        raise SessionIssue(
            "package_identity_changed",
            "Post-setup Preflight does not match the confirmed identity.",
            status="ACTION_REQUIRED",
        )
    moderation = require_object(preflight.get("localAiModerationInput"), "preflight.localAiModerationInput")
    commerce = require_object(moderation.get("commerceKit", {}), "preflight.commerceKit")
    invalid_ids = commerce.get("invalidProductIds", [])
    if not isinstance(invalid_ids, list):
        raise SessionIssue("session_input_invalid", "Commerce Kit invalidProductIds must be an array.")
    if invalid_ids:
        raise SessionIssue(
            "commerce_package_prefix_mismatch",
            "Commerce Kit product IDs must use the confirmed package ID prefix before export.",
            status="ACTION_REQUIRED",
        )
    final_review = state["review"]
    if requires_final_review(state["projectSetupActions"]):
        review_path, _ = collect_review_for_session(handle, preflight)
        final_review = validate_final_review(state, json.loads(review_path.read_text(encoding="utf-8")))
    state.update({"postSetupPreflight": preflight, "finalReview": final_review})
    consume_configured_path(state, script_path)
    consume_result_path(state, "preflight")
    state.pop("finalReviewScriptPath", None)
    write_state(handle, state)
    return {"status": "FINAL_REVIEW_RECORDED", "stage": "publish_session", "stateHandle": handle}


def authorize_package(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="confirmed")
    actions = require_object(state.get("projectSetupActions"), "projectSetupActions")
    if requires_final_review(actions) and "postSetupPreflight" not in state:
        raise SessionIssue(
            "final_review_required",
            "Run prepare-final-review, execute its fresh preflightScriptPath, then record-final-review before Package.",
            status="ACTION_REQUIRED",
        )
    final_review = state.get("finalReview", state["review"])
    if payload.get("finalReviewInput") is not None:
        final_review = validate_final_review(state, payload["finalReviewInput"])

    authorized = run_flow(
        "package-authorize",
        {"confirmed": state["confirmed"], "versionPolicy": state["versionPolicy"]},
    )
    persisted_result_path = result_path(handle, "package")
    configured_path = configured_editor_script(
        PACKAGE_SCRIPT,
        "--package-authorization-uri",
        authorized,
        persisted_result_path,
    )
    try:
        state.update(
            {
                "sessionStage": "package_authorized",
                "finalReview": final_review,
                "packageAuthorization": authorized,
                "configuredPaths": [*state["configuredPaths"], configured_path],
                "resultPaths": {**state.get("resultPaths", {}), "package": str(persisted_result_path)},
            }
        )
        write_state(handle, state)
    except Exception:
        cleanup_configured(configured_path)
        raise
    return {
        "status": "PACKAGE_SCRIPT_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "packageScriptPath": configured_path,
    }


def consume_configured_path(state: dict[str, Any], path: str) -> None:
    cleanup_configured(path)
    state["configuredPaths"] = [item for item in state.get("configuredPaths", []) if item != path]


def record_package(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="package_authorized")
    configured = state.get("configuredPaths", [])
    if not isinstance(configured, list) or not configured:
        raise SessionIssue("package_script_missing", "The session has no configured Package script.")
    result = editor_result_from_session(payload, state, "package")
    consume_configured_path(state, configured[-1])
    consume_result_path(state, "package")
    if result.get("status") != "EXPORTED" or result.get("stage") != "package":
        state.update({"sessionStage": "confirmed", "lastPackageResult": result})
        write_state(handle, state)
        return result
    authorization = state["packageAuthorization"]["packageAuthorization"]
    if result.get("planToken") != authorization.get("planToken") or result.get(
        "packageAuthorizationToken"
    ) != authorization.get("authorizationToken"):
        raise SessionIssue("package_result_mismatch", "The Package result does not match this publish session.")
    state.update({"sessionStage": "package_recorded", "packageResult": result})
    write_state(handle, state)
    return {
        "status": "PACKAGE_RECORDED",
        "stage": "publish_session",
        "stateHandle": handle,
    }


def authorize_registration(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="package_recorded")
    package_result = require_object(state.get("packageResult"), "packageResult")
    previous_result = state.get("lastRegistrationResult")
    if isinstance(previous_result, dict):
        existing_state = previous_result.get("registrationState")
        if not isinstance(existing_state, dict):
            prior_authorization = require_object(state.get("registrationAuthorization"), "registrationAuthorization")
            authorization = require_object(
                prior_authorization.get("registrationAuthorization"),
                "registrationAuthorization.registrationAuthorization",
            )
            existing_state = authorization.get("registrationState")
        if not isinstance(existing_state, dict):
            raise SessionIssue(
                "registration_retry_state_missing",
                "Neither the previous Register result nor its retained authorization has reusable registrationState.",
                status="ACTION_REQUIRED",
            )
        attempt_ordinal = state.get("registrationAttemptOrdinal", 1) + 1
        retry_reason = require_string(payload.get("retryReason"), "retryReason")
    else:
        existing_state = None
        attempt_ordinal = 1
        retry_reason = "initial"
    authorized = run_flow(
        "registration-authorize",
        {
            "confirmed": state["confirmed"],
            "packageAuthorization": state["packageAuthorization"],
            "spkPath": package_result.get("packagePath"),
            "spkChecksum": package_result.get("checksum"),
            "existingState": existing_state,
            "attemptOrdinal": attempt_ordinal,
            "retryReason": retry_reason,
        },
    )
    persisted_result_path = result_path(handle, "register")
    configured_path = configured_editor_script(
        REGISTER_SCRIPT,
        "--registration-authorization-uri",
        authorized,
        persisted_result_path,
    )
    try:
        state.update(
            {
                "sessionStage": "registration_authorized",
                "registrationAuthorization": authorized,
                "registrationAttemptOrdinal": attempt_ordinal,
                "configuredPaths": [*state["configuredPaths"], configured_path],
                "resultPaths": {**state.get("resultPaths", {}), "register": str(persisted_result_path)},
            }
        )
        write_state(handle, state)
    except Exception:
        cleanup_configured(configured_path)
        raise
    return {
        "status": "REGISTER_SCRIPT_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "registerScriptPath": configured_path,
    }


def record_registration(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="registration_authorized")
    configured = state.get("configuredPaths", [])
    if not isinstance(configured, list) or not configured:
        raise SessionIssue("register_script_missing", "The session has no configured Register script.")
    result = editor_result_from_session(payload, state, "register")
    consume_configured_path(state, configured[-1])
    consume_result_path(state, "register")
    if result.get("status") != "REGISTERED_AND_UPLOADED" or result.get("stage") != "register":
        state.update({"sessionStage": "package_recorded", "lastRegistrationResult": result})
        write_state(handle, state)
        return result
    registration = state["registrationAuthorization"]["registrationAuthorization"]
    if (
        result.get("planToken") != registration.get("planToken")
        or result.get("packageAuthorizationToken") != registration.get("packageAuthorizationToken")
        or result.get("registrationAuthorizationToken") != registration.get("authorizationToken")
    ):
        raise SessionIssue("registration_result_mismatch", "The Register result does not match this publish session.")
    state.update({"sessionStage": "registered", "registered": result})
    write_state(handle, state)
    return {
        "status": "REGISTRATION_RECORDED",
        "stage": "publish_session",
        "stateHandle": handle,
    }


def authorize_finalize(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="registered")
    requested_path = payload.get("submitStatePath")
    retained_path = state.get("submitStatePath")
    if requested_path is not None:
        submit_state_path = require_string(requested_path, "submitStatePath")
        if isinstance(retained_path, str) and retained_path != submit_state_path:
            raise SessionIssue(
                "submit_state_path_changed",
                "The submit-state path is already bound to this session; retry without changing it.",
                status="ACTION_REQUIRED",
            )
        submit_state_owned = state.get("submitStateOwned") is True if retained_path == submit_state_path else False
    elif isinstance(retained_path, str):
        submit_state_path = retained_path
        submit_state_owned = state.get("submitStateOwned") is True
    else:
        submit_state_path = str(owned_submit_state_path(handle))
        submit_state_owned = True
    authorized = run_flow(
        "finalize-authorize",
        {
            "confirmed": state["confirmed"],
            "registrationAuthorization": state["registrationAuthorization"],
            "registered": state["registered"],
            "submitStatePath": submit_state_path,
        },
    )
    persisted_result_path = result_path(handle, "finalize")
    configured_path = configured_editor_script(
        FINALIZE_SCRIPT,
        "--finalize-authorization-uri",
        authorized,
        persisted_result_path,
    )
    try:
        state.update(
            {
                "sessionStage": "finalize_authorized",
                "finalizeAuthorization": authorized,
                "submitStatePath": submit_state_path,
                "submitStateOwned": submit_state_owned,
                "configuredPaths": [*state["configuredPaths"], configured_path],
                "resultPaths": {**state.get("resultPaths", {}), "finalize": str(persisted_result_path)},
            }
        )
        write_state(handle, state)
    except Exception:
        cleanup_configured(configured_path)
        raise
    return {
        "status": "FINALIZE_SCRIPT_READY",
        "stage": "publish_session",
        "stateHandle": handle,
        "finalizeScriptPath": configured_path,
    }


def record_finalize(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="finalize_authorized")
    configured = state.get("configuredPaths", [])
    if not isinstance(configured, list) or not configured:
        raise SessionIssue("finalize_script_missing", "The session has no configured Finalize script.")
    result = editor_result_from_session(payload, state, "finalize")
    consume_configured_path(state, configured[-1])
    consume_result_path(state, "finalize")
    if result.get("status") in {"SUBMITTED", "ALREADY_SUBMITTED", "SUBMIT_PENDING", "LEGAL_DOCUMENTS_PENDING"}:
        expected_token = state["finalizeAuthorization"]["finalizeAuthorization"].get("authorizationToken")
        if result.get("finalizeAuthorizationToken") != expected_token:
            raise SessionIssue("finalize_result_mismatch", "The Finalize result does not match this publish session.")
        target_channel = state["finalizeAuthorization"]["finalizeAuthorization"]["targetChannel"]
        if result.get("targetChannel", "production") != target_channel:
            raise SessionIssue("finalize_result_mismatch", "The Finalize result targets a different channel.")
    if result.get("status") == "LEGAL_DOCUMENTS_PENDING":
        checks = int(state.get("legalDocumentPendingChecks", 0)) + 1
        state["legalDocumentPendingChecks"] = checks
        if checks >= 10:
            result = {
                **result,
                "status": "ACTION_REQUIRED",
                "reason": "legal_documents_pending",
                "message": "Legal document hosting is still pending. Check Lens Settings → Legal documents, "
                "then retry Finalize when hosting is ready.",
            }
            result.pop("retryAfterSeconds", None)
    else:
        state["legalDocumentPendingChecks"] = 0
    state.update(
        {
            "sessionStage": "submitted" if result.get("status") in {"SUBMITTED", "ALREADY_SUBMITTED"} else "registered",
            "finalizeResult": result,
        }
    )
    write_state(handle, state)
    if result.get("status") not in {"SUBMITTED", "ALREADY_SUBMITTED"}:
        return result
    package_result = require_object(state.get("packageResult"), "packageResult")
    if package_result.get("generatedPackage") is True:
        package_path = package_result.get("packagePath")
        cleanup_path = package_result.get("cleanupPath")
        if isinstance(package_path, str) and cleanup_path == package_path:
            generated = Path(package_path)
            try:
                generated.unlink()
            except FileNotFoundError:
                pass
            try:
                generated.parent.rmdir()
            except OSError:
                pass
    return {
        "status": "PUBLISH_SESSION_SUBMITTED",
        "stage": "publish_session",
        "stateHandle": handle,
        "lensName": state["confirmed"]["confirmedPlan"].get("lensName"),
        "packageId": state["confirmed"]["confirmedPlan"].get("packageId"),
        "targetChannel": state["confirmed"]["confirmedPlan"].get("targetChannel", "production"),
        "portalUrl": result.get("portalUrl") or state["registered"].get("portalUrl"),
        "releaseVersion": result.get("releaseVersion") or state["registered"].get("releaseVersion"),
    }


def build_promotional(payload: dict[str, Any]) -> dict[str, Any]:
    """Build the optional post-submit deliverable once from retained confirmed state."""

    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle, expected_stage="submitted")
    retained = state.get("promotionalVideoResult")
    if isinstance(retained, dict):
        cleanup_owned_preview(handle, state)
        write_state(handle, state)
        return copy.deepcopy(retained)
    plan = require_object(state["confirmed"].get("confirmedPlan"), "confirmed.confirmedPlan")
    preview_videos = [
        asset
        for asset in plan.get("previewMediaAssets", [])
        if isinstance(asset, dict) and asset.get("type") == "video" and isinstance(asset.get("path"), str)
    ]
    if not preview_videos:
        result = {
            "status": "PROMOTIONAL_VIDEO_SKIPPED",
            "stage": "promotional_video",
            "reason": "no_local_preview_video",
        }
    else:
        preflight = state.get("preflight")
        project_path = preflight.get("projectPath") if isinstance(preflight, dict) else None
        icon_path = None
        presentation = state.get("presentation")
        if isinstance(presentation, dict) and isinstance(presentation.get("lensIconPath"), str):
            icon_path = presentation["lensIconPath"]
        icon_plan = plan.get("lensIconPlan")
        if icon_path is None and isinstance(icon_plan, dict):
            icon_asset = icon_plan.get("asset")
            if isinstance(icon_asset, dict) and isinstance(icon_asset.get("path"), str):
                icon_path = icon_asset["path"]
        command = [
            sys.executable,
            str(BUILD_PROMOTIONAL),
            "--preview-video",
            preview_videos[0]["path"],
            "--lens-name",
            require_string(plan.get("lensName"), "confirmed.confirmedPlan.lensName"),
        ]
        if isinstance(project_path, str) and project_path:
            command.extend(["--project", project_path])
        description = plan.get("releaseDescription")
        if isinstance(description, str) and description:
            command.extend(["--lens-description", description])
        if icon_path:
            command.extend(["--icon", icon_path])
        music_path = payload.get("musicPath")
        if music_path is not None:
            command.extend(["--music", require_string(music_path, "musicPath")])
        try:
            completed = subprocess.run(command, check=False, capture_output=True, text=True)
        except OSError as error:
            result = {
                "status": "FAILED",
                "stage": "promotional_video",
                "reason": "promotional_helper_unavailable",
                "message": str(error),
            }
        else:
            try:
                result = json.loads(completed.stdout)
            except json.JSONDecodeError:
                result = {
                    "status": "FAILED",
                    "stage": "promotional_video",
                    "reason": "promotional_helper_invalid",
                    "message": completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}",
                }
        if not isinstance(result, dict):
            result = {
                "status": "FAILED",
                "stage": "promotional_video",
                "reason": "promotional_helper_invalid",
                "message": "The promotional helper did not return one JSON object.",
            }
    if result.get("status") in {"PROMOTIONAL_VIDEO_READY", "PROMOTIONAL_VIDEO_SKIPPED"}:
        state["promotionalVideoResult"] = copy.deepcopy(result)
    else:
        # Failures and corrective outcomes are retryable after the environment or
        # input is fixed. Only terminal success/skip outcomes are idempotently cached.
        state.pop("promotionalVideoResult", None)
    cleanup_owned_preview(handle, state)
    write_state(handle, state)
    return result


def complete(payload: dict[str, Any]) -> dict[str, Any]:
    """Build the optional deliverable, preserve final preview media, and clean session state."""

    handle = require_string(payload.get("stateHandle"), "stateHandle")
    promotional = build_promotional(payload)
    state = load_state(handle, expected_stage="submitted")
    plan = require_object(state["confirmed"].get("confirmedPlan"), "confirmed.confirmedPlan")
    finalize_result = require_object(state.get("finalizeResult"), "finalizeResult")
    registered = require_object(state.get("registered"), "registered")
    preview_artifact = state.get("previewArtifact")
    result = {
        "status": "PUBLISH_SESSION_COMPLETED",
        "stage": "publish_session",
        "lensName": plan.get("lensName"),
        "packageId": plan.get("packageId"),
        "targetChannel": plan.get("targetChannel", "production"),
        "portalUrl": finalize_result.get("portalUrl") or registered.get("portalUrl"),
        "releaseVersion": finalize_result.get("releaseVersion") or registered.get("releaseVersion"),
        "promotionalVideo": copy.deepcopy(promotional),
        **({"previewArtifact": copy.deepcopy(preview_artifact)} if isinstance(preview_artifact, dict) else {}),
    }
    cleanup_session(handle, state, preserve_preview_artifact=True)
    return result


def cleanup_session(handle: str, state: dict[str, Any], *, preserve_preview_artifact: bool) -> None:
    configured = state.get("configuredPaths", [])
    if isinstance(configured, list):
        for path in configured:
            if isinstance(path, str):
                cleanup_configured(path)
    persisted_results = state.get("resultPaths", {})
    if isinstance(persisted_results, dict):
        for path in persisted_results.values():
            if isinstance(path, str):
                Path(path).unlink(missing_ok=True)
    submit_state = state.get("submitStatePath")
    if state.get("submitStateOwned") is True and isinstance(submit_state, str):
        Path(submit_state).unlink(missing_ok=True)
    for key in ("reviewInputPath", "previewCompatibilityResultPath"):
        path = state.get(key)
        if isinstance(path, str):
            Path(path).unlink(missing_ok=True)
    cleanup_owned_preview(handle, state)
    if not preserve_preview_artifact:
        cleanup_owned_preview_artifact(handle, state)
        shutil.rmtree(owned_preview_artifact_dir(handle), ignore_errors=True)
    state_path(handle).unlink(missing_ok=True)


def cleanup(payload: dict[str, Any]) -> dict[str, Any]:
    handle = require_string(payload.get("stateHandle"), "stateHandle")
    state = load_state(handle)
    cleanup_session(handle, state, preserve_preview_artifact=False)
    return {"status": "PUBLISH_SESSION_CLEANED", "stage": "publish_session"}


OPERATIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "begin-context": begin_context,
    "stage-context": stage_context,
    "prepare-preview-images": prepare_preview_images,
    "record-preview-images": record_preview_images,
    "prepare-preview-video": prepare_preview_video,
    "record-preview-video": record_preview_video,
    "record-preview-compatibility": record_preview_compatibility,
    "decide-preview-video": decide_preview_video,
    "stage-preview-screenshot": stage_preview_screenshot,
    "prepare": prepare,
    "fallback": fallback,
    "confirm": confirm,
    "prepare-final-review": prepare_final_review,
    "record-final-review": record_final_review,
    "authorize-package": authorize_package,
    "record-package": record_package,
    "authorize-registration": authorize_registration,
    "record-registration": record_registration,
    "authorize-finalize": authorize_finalize,
    "record-finalize": record_finalize,
    "build-promotional": build_promotional,
    "complete": complete,
    "cleanup": cleanup,
}

SCHEMAS = {
    "begin-context": {
        "summary": "Create configured Preflight/discovery scripts that persist exact results into one session.",
        "required": [],
        "optional": [
            "projectPath = resolved .esproj path; stage-context verifies Lens Studio opened the same project",
            "tenantId = selected organization ID for an ORG_AMBIGUOUS retry",
            "forceCategoryFetch = true only for an explicit category replacement",
            "packageId = explicit missing/invalid-ID proposal; otherwise discovery generates one without saving",
        ],
        "result": ["stateHandle", "preflightScriptPath", "discoverScriptPath"],
    },
    "stage-context": {
        "summary": (
            "Read persisted Editor results, validate publish context/version policy, retain review input, and default "
            "a rejected Build Version to the backend suggestion in the consolidated publish plan."
        ),
        "required": ["stateHandle (from CONTEXT_SCRIPTS_READY)"],
        "optional": ["recovery compatibility: preflightResult + discoverResult instead of stateHandle"],
        "result": [
            "stateHandle",
            "listing reuse summary + review summary + version-policy summary",
            "buildVersionPlan when the consolidated plan defaults to the backend suggestion",
            "packageId + packageIdNeedsAssignment (availability-checked proposal for a missing or invalid ID)",
        ],
    },
    "prepare-preview-images": {
        "summary": "Own reset/capture sequencing and staging paths for the requested preview images.",
        "required": ["stateHandle"],
        "optional": ["imageCount = 1|2 (default 2); 1 requires a retained auto-video outcome"],
        "result": ["PREVIEW_IMAGE_CAPTURE_REQUIRED with resetRequest and the first screenshotRequest"],
        "schema": "scripts/schemas/preview-images.schema.json#/$defs/prepareInput",
    },
    "record-preview-images": {
        "summary": "Validate the capture result, issue the next request or stage and retain the requested images.",
        "required": ["stateHandle"],
        "optional": [
            "result = untouched capture result; omit for staging-only retries",
            "manualPaths = user-supplied recovery screenshots matching the requested imageCount",
        ],
        "result": ["next screenshotRequest or PUBLISH_PREVIEW_IMAGES_READY with all inspection paths"],
        "schema": "scripts/schemas/preview-images.schema.json#/$defs/recordInput",
    },
    "prepare-preview-video": {
        "summary": "Create session-owned Preview staging and one configured native recorder script.",
        "required": ["stateHandle (from PUBLISH_CONTEXT_STAGED)"],
        "optional": [],
        "result": ["stateHandle", "previewScriptPath"],
    },
    "record-preview-video": {
        "summary": "Consume the persisted native recording, normalize/inspect it, and retain the outcome.",
        "required": ["stateHandle"],
        "optional": ["result (recovery only: untouched ExecuteEditorCode/MCP result)"],
        "result": ["final media facts, two decision frame paths, compatibility command, or screenshotRequest"],
    },
    "record-preview-compatibility": {
        "summary": "Consume the session-configured toolbar compatibility capture result.",
        "required": ["stateHandle"],
        "optional": ["reason = worker_timeout after the bounded compatibility-worker deadline"],
        "result": ["final media facts, two decision frame paths, or screenshotRequest"],
    },
    "decide-preview-video": {
        "summary": "Apply the one parent two-frame decision and retain final media behind the session handle.",
        "required": ["stateHandle", "decision = video|image|screenshot"],
        "optional": ["frame = midpoint|near_end for image"],
        "result": ["retained final media facts or screenshotRequest"],
    },
    "stage-preview-screenshot": {
        "summary": "Normalize the screenshot written by the returned CapturePanelScreenshotTool screenshotRequest.",
        "required": ["stateHandle"],
        "optional": [],
        "result": ["retained final image facts"],
    },
    "prepare": {
        "summary": "Join retained context/review/preview, assemble/freeze/review/render once, and retain state.",
        "required": [
            "stateHandle (from PUBLISH_CONTEXT_STAGED)",
            "proposals (only the exact fields listed in notes; may be empty for full reuse)",
        ],
        "optional": [
            "reviewInput or reviewInputPath (recovery only; normally collected into session state)",
            "presentation contentRatingEvidence/contentRatingCoverage/moderationFindings/"
            "moderationCoverage/lensIconPath",
            "legacy recovery: assembly + versionPolicy",
        ],
        "result": ["stateHandle", "reviewFingerprint", "confirmation (emit unchanged)"],
        "notes": [
            "Allowed proposal fields: " + ", ".join(sorted(PROPOSAL_FIELDS)) + ".",
            "previewMediaAssets is accepted as a compatibility alias for previewMedia.",
            "CLI media path: --review-input-path PATH --preview-media-plan PLAN --preview-media PATH.",
            "CLI Build Version edit: --build-version VERSION (must be at least the backend minimum).",
            "Target channel: proposals.targetChannel or --target-channel production|beta|internal; default production.",
            "An omitted targetChannel during an edit preserves the previously prepared channel.",
            (
                "legalDocumentInputs maps privacyPolicy/termsOfService to exactly {url} "
                "or {text}; only user-supplied missing Lens documents may be added. "
                "Omission during edit preserves prior inputs; {} clears planned additions."
            ),
            "Initial inline rendering is mandatory; do not supply inlineRenderingSupported.",
        ],
    },
    "fallback": {
        "summary": "Rerender the current confirmation without inline attachments after an actual render failure.",
        "required": ["stateHandle", "confirmationToken", "reason"],
        "optional": [],
        "result": ["stateHandle", "replacement confirmation (emit unchanged)"],
    },
    "confirm": {
        "summary": "Bind a selection to the consolidated confirmation and retain the confirmed project actions.",
        "required": ["stateHandle", "confirmationToken", "selectionId = confirm|edit|cancel"],
        "optional": [],
        "result": ["stateHandle", "projectSetupActions and finalReviewRequired (confirm only)"],
    },
    "prepare-final-review": {
        "summary": "Generate a fresh session-owned post-setter Preflight with a persisted result.",
        "required": ["stateHandle"],
        "optional": [],
        "result": ["stateHandle", "preflightScriptPath"],
    },
    "record-final-review": {
        "summary": "Validate fresh Preflight, collect and compare final review, then clean its script and result.",
        "required": ["stateHandle"],
        "optional": ["result (recovery only: untouched ExecuteEditorCode/MCP result)"],
        "result": ["stateHandle"],
    },
    "authorize-package": {
        "summary": "Verify the final review fingerprint, authorize Package, and generate configured package.ts.",
        "required": ["stateHandle"],
        "optional": [
            "finalReviewInput (legacy additional review check; does not replace the post-setter Preflight flow)"
        ],
        "result": ["stateHandle", "packageScriptPath"],
    },
    "record-package": {
        "summary": "Retain the Package script's persisted result, then clean its configured script.",
        "required": ["stateHandle"],
        "optional": ["result (recovery only: untouched ExecuteEditorCode/MCP result)"],
        "result": ["stateHandle"],
    },
    "authorize-registration": {
        "summary": "Authorize registration from retained state and generate configured register.ts.",
        "required": ["stateHandle"],
        "optional": ["retryReason (required only after a retained non-terminal Register result)"],
        "result": ["stateHandle", "registerScriptPath"],
    },
    "record-registration": {
        "summary": "Retain the Register script's persisted result, then clean its configured script.",
        "required": ["stateHandle"],
        "optional": ["result (recovery only: untouched ExecuteEditorCode/MCP result)"],
        "result": ["stateHandle"],
    },
    "authorize-finalize": {
        "summary": "Authorize Finalize from retained state and generate configured finalize.ts.",
        "required": ["stateHandle"],
        "optional": ["submitStatePath (recovery override only; normally session-owned)"],
        "result": ["stateHandle", "finalizeScriptPath"],
    },
    "record-finalize": {
        "summary": "Retain the Finalize script's persisted result and return final user-facing facts.",
        "required": ["stateHandle"],
        "optional": ["result (recovery only: untouched ExecuteEditorCode/MCP result)"],
        "result": ["lensName", "packageId", "targetChannel", "portalUrl", "releaseVersion"],
    },
    "build-promotional": {
        "summary": "Build or skip the optional post-submit promotional video exactly once from retained state.",
        "required": ["stateHandle"],
        "optional": ["musicPath (only when supplied in the original request)"],
        "result": ["promotional-video status and final artifact facts"],
    },
    "complete": {
        "summary": (
            "Build or skip the promotional video, preserve the final preview temporarily, clean intermediates, "
            "and return final facts."
        ),
        "required": ["stateHandle"],
        "optional": ["musicPath (only when supplied in the original request)"],
        "result": ["submission facts", "promotionalVideo", "previewArtifact when auto-generated media was used"],
    },
    "cleanup": {
        "summary": "Delete the opaque session, preview/review intermediates, and every configured script it owns.",
        "required": ["stateHandle"],
        "optional": [],
        "result": [],
    },
}


def load_payload(path: str | None) -> dict[str, Any]:
    if path is None:
        return {}
    if path == "-":
        value = json.load(sys.stdin)
    else:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    return require_object(value, "input")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", nargs="?", choices=sorted(OPERATIONS))
    parser.add_argument("--json", help="Input JSON path, or - for stdin.")
    parser.add_argument("--state-handle")
    parser.add_argument("--project")
    parser.add_argument("--tenant-id")
    parser.add_argument("--package-id")
    parser.add_argument("--force-category-fetch", action="store_true")
    parser.add_argument("--confirmation-token")
    parser.add_argument("--selection-id", choices=["confirm", "edit", "cancel"])
    parser.add_argument("--submit-state-path")
    parser.add_argument("--music-path")
    parser.add_argument("--retry-reason")
    parser.add_argument("--reason")
    parser.add_argument("--decision", choices=["video", "image", "screenshot"])
    parser.add_argument("--frame", choices=["midpoint", "near_end"])
    parser.add_argument(
        "--image-count", type=int, help="prepare-preview-images: requested screenshot count (default 2)."
    )
    parser.add_argument("--review-input-path")
    parser.add_argument("--build-version")
    parser.add_argument("--target-channel", choices=sorted(FLOW.TARGET_CHANNEL_LABELS))
    parser.add_argument(
        "--preview-media-plan",
        choices=["preserve_existing", "auto_image", "auto_video", "user_image", "user_video"],
    )
    parser.add_argument("--preview-media", action="append", default=[])
    parser.add_argument("--result-json", help="Recovery only: exact Editor result JSON path, or - for stdin.")
    parser.add_argument("--schema", nargs="?", const="", choices=[*sorted(OPERATIONS), "all", ""])
    args = parser.parse_args()
    requested_schema = args.schema if args.schema else (args.operation if args.schema == "" else None)
    if requested_schema:
        result = (
            {"status": "SCHEMA_READY", "stage": "publish_session", "operations": SCHEMAS}
            if requested_schema == "all"
            else {
                "status": "SCHEMA_READY",
                "stage": "publish_session",
                "operation": requested_schema,
                **SCHEMAS[requested_schema],
            }
        )
        print(canonical_json(result))
        return 0
    if args.operation is None:
        parser.error("an operation is required unless --schema is used")
    try:
        payload = load_payload(args.json)
        if args.package_id is not None and args.operation != "begin-context":
            raise SessionIssue(
                "session_input_invalid", "Use --package-id only with begin-context, then recheck discovery."
            )
        if args.image_count is not None and args.operation != "prepare-preview-images":
            raise SessionIssue("session_input_invalid", "Use --image-count only with prepare-preview-images.")
        direct_values = {
            "stateHandle": args.state_handle,
            "projectPath": args.project,
            "tenantId": args.tenant_id,
            "packageId": args.package_id,
            "forceCategoryFetch": True if args.force_category_fetch else None,
            "confirmationToken": args.confirmation_token,
            "selectionId": args.selection_id,
            "submitStatePath": args.submit_state_path,
            "musicPath": args.music_path,
            "retryReason": args.retry_reason,
            "reason": args.reason,
            "decision": args.decision,
            "frame": args.frame,
            "imageCount": args.image_count,
            "reviewInputPath": args.review_input_path,
        }
        payload.update({key: value for key, value in direct_values.items() if value is not None})
        if (
            args.preview_media
            or args.preview_media_plan is not None
            or args.build_version is not None
            or args.target_channel is not None
        ):
            proposals = normalize_proposals(payload.get("proposals", {}))
            if args.preview_media and "previewMedia" in proposals:
                raise SessionIssue(
                    "proposal_fields_invalid",
                    "Use either --preview-media or proposals.previewMedia, not both.",
                    status="ACTION_REQUIRED",
                )
            if args.preview_media:
                source = args.preview_media_plan or "user_image"
                proposals["previewMedia"] = [{"path": path, "source": source} for path in args.preview_media]
            if args.preview_media_plan is not None:
                proposals["previewMediaPlan"] = args.preview_media_plan
            if args.build_version is not None:
                if "buildVersion" in proposals:
                    raise SessionIssue(
                        "proposal_fields_invalid",
                        "Use either --build-version or proposals.buildVersion, not both.",
                        status="ACTION_REQUIRED",
                    )
                proposals["buildVersion"] = args.build_version
            if args.target_channel is not None:
                if args.operation != "prepare" or "targetChannel" in proposals:
                    raise SessionIssue(
                        "proposal_fields_invalid",
                        "Use --target-channel only with prepare and without proposals.targetChannel.",
                        status="ACTION_REQUIRED",
                    )
                proposals["targetChannel"] = args.target_channel
            payload["proposals"] = proposals
        if args.result_json is not None:
            payload["result"] = load_payload(args.result_json)
        result = OPERATIONS[args.operation](payload)
    except SessionIssue as error:
        result = error.result
    except (OSError, ValueError, json.JSONDecodeError) as error:
        result = {
            "status": "FAILED",
            "stage": "publish_session",
            "reason": "input_unreadable",
            "message": str(error),
        }
    print(canonical_json(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
