#!/usr/bin/env python3

# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Assemble the exact `publish-flow.py freeze-plan` input from the results already in hand.

`freeze-plan` needs a large object: package identity, release text, the raw category list, the
full content-rating assessment, and every preview asset with a base64 SHA-256 and byte size.
Almost all of it already exists in the `preflight.ts`, `discover.ts` and `collect-review-input.py`
results — only the semantic proposals are the model's to make.

A measured full publish (§1b of the redesign plan) spent about five round trips here: the agent
wrote its own throwaway helper to compute the checksums and build the object, ran it, edited it,
and ran it again. This script exists to delete that detour, and to make the step reproducible
rather than improvised in a different shape each run.

Input, one JSON object via `--json <file>`, or on stdin:

    {
      "preflight":  <the complete preflight.ts result>,
      "discover":   <the complete discover.ts result>,
      "collector":  <the complete collect-review-input.py result>,   // optional
      "proposals": {
        "lensName":            "...",   // optional; preflight's value wins unless it is a placeholder
        "releaseDescription":  "...",                                  // omit to reuse existing
        "releaseTags":         ["#Active"],                             // omit to reuse existing
        "orgId":               "organization-id",                      // optional; never invent
        "orgDisplayName":      "Organization name",                    // optional; backend-provided
        "semanticVersion":     "1.2.0",                                // optional; user-supplied
        "targetChannel":       "internal",                             // optional; defaults to production
        "lensIconPlan":        {"action": "generate_and_assign", "path": "/tmp/lens-icon.png"},
        "signingKeyPlan":      {"action": "generate_and_assign", "path": "/project/specs_signing_key.pem"},
        "selectedCategoryId":  "games",                                // omit to reuse existing
        "contentRatingAssessment": { ... },                             // omit to reuse existing
        "previewMedia": [{"path": "...", "source": "user_image", "type": "image"}],
        "previewMediaPlan":    "user_image"                          // optional; inferred otherwise
      },
      "previewStagingDir": "/session/preview/user-media/<token>"       // session-owned; required for user images
    }

Output: the freeze-plan input under `freezePlanInput`, ready to pipe straight into
`publish-flow.py freeze-plan --json -`. Checksums and byte sizes are computed here, so the
caller never shells out for them. User-supplied media is held to the Developer Portal's rules:
each image is center-cropped to a 1080×1440 PNG in `previewStagingDir` (a smaller source is
rejected), and each video must already be 3:4, at least 1080×1440, and 15–30 seconds long.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import queue
import select
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

CHUNK = 1024 * 1024
_flow_spec = importlib.util.spec_from_file_location("specs_publish_flow", Path(__file__).with_name("publish-flow.py"))
FLOW = importlib.util.module_from_spec(_flow_spec)
_flow_spec.loader.exec_module(FLOW)
_stager_spec = importlib.util.spec_from_file_location(
    "specs_preview_stager", Path(__file__).resolve().parents[1] / "preview" / "stage-preview-screenshot.py"
)
STAGER = importlib.util.module_from_spec(_stager_spec)
_stager_spec.loader.exec_module(STAGER)
VIDEO_DURATION_SECONDS = FLOW._MEDIA_SCHEMA["$defs"]["videoDurationSeconds"]
# publish-flow.py owns the upload extensions; the declared upload type comes from them.
IMAGE_SUFFIXES = set(FLOW.upload_suffixes("image"))
VIDEO_SUFFIXES = set(FLOW.upload_suffixes("video"))


def read_stdin_json(stdin_wait_seconds: float) -> Any:
    """Read piped JSON with a bounded wait on both POSIX and Windows."""
    if sys.platform != "win32":
        if select.select([sys.stdin], [], [], stdin_wait_seconds)[0] == []:
            raise ValueError(
                f"no input on stdin after {stdin_wait_seconds:g}s: pass --json <file> or pipe JSON on stdin"
            )
        return json.load(sys.stdin)

    results: queue.Queue[Any] = queue.Queue(maxsize=1)

    def load_in_background() -> None:
        try:
            results.put(json.load(sys.stdin))
        except Exception as error:
            results.put(error)

    threading.Thread(target=load_in_background, daemon=True).start()
    try:
        result = results.get(timeout=stdin_wait_seconds)
    except queue.Empty as error:
        raise ValueError(
            f"no input on stdin after {stdin_wait_seconds:g}s: pass --json <file> or pipe JSON on stdin"
        ) from error
    if isinstance(result, Exception):
        raise result
    return result


def read_json_input(explicit_path: str | None, *, stdin_wait_seconds: float = 5.0) -> Any:
    """Read the input JSON from a path, or from stdin.

    Blocking forever on an unfed stdin is not an acceptable failure mode: a real run called this
    with `--json <file>` — the convention every sibling helper uses — against a stdin-only
    version, and the process hung for minutes with no output. A bounded wait turns that into a
    diagnosis.
    """
    if explicit_path and explicit_path != "-":
        with Path(explicit_path).open(encoding="utf-8") as source:
            return json.load(source)
    if sys.stdin.isatty():
        raise ValueError("no input: pass --json <file> or pipe JSON on stdin")
    return read_stdin_json(stdin_wait_seconds)


def fail(reason: str, message: str) -> int:
    print(
        json.dumps({"status": "FAILED", "stage": "assemble_plan", "reason": reason, "message": message}, sort_keys=True)
    )
    return 2


def action_required(reason: str, message: str) -> int:
    print(
        json.dumps(
            {"status": "ACTION_REQUIRED", "stage": "assemble_plan", "reason": reason, "message": message},
            sort_keys=True,
        )
    )
    return 1


def base64_sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
            total += len(chunk)
    return base64.b64encode(digest.digest()).decode("ascii"), total


def probe_video(path: Path) -> tuple[int, int, float]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or "ffprobe could not read the video")
    value = json.loads(completed.stdout)
    stream = value["streams"][0]
    return int(stream["width"]), int(stream["height"]), float(value["format"]["duration"])


def user_video_issue(path: Path) -> str | None:
    """Apply the Developer Portal's preview-video shape and duration checks."""
    try:
        width, height, duration = probe_video(path)
    except (KeyError, IndexError, TypeError, ValueError) as error:
        return f"could not read preview video {path.name}: {error}"
    if width * 4 != height * 3 or width < STAGER.TARGET_WIDTH or height < STAGER.TARGET_HEIGHT:
        return (
            f"preview video {path.name} is {width}×{height}; videos must be 3:4 and at least "
            f"{STAGER.TARGET_WIDTH}×{STAGER.TARGET_HEIGHT}"
        )
    if not VIDEO_DURATION_SECONDS["minimum"] <= duration <= VIDEO_DURATION_SECONDS["maximum"]:
        return (
            f"preview video {path.name} is {duration:.1f}s; videos must be "
            f"{VIDEO_DURATION_SECONDS['minimum']}–{VIDEO_DURATION_SECONDS['maximum']} seconds"
        )
    return None


def stage_user_image(path: Path, output: Path) -> Path:
    """Center-crop a user image to the store's 1080×1440 PNG, as the Developer Portal does."""
    stream = STAGER.probe(path)
    width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
    if width < STAGER.TARGET_WIDTH or height < STAGER.TARGET_HEIGHT:
        raise ValueError(
            f"preview image {path.name} is {width}×{height}; images must be at least "
            f"{STAGER.TARGET_WIDTH}×{STAGER.TARGET_HEIGHT} so the 3:4 crop is not upscaled"
        )
    return Path(STAGER.stage(path.resolve(), output)["path"])


def media_type_for(path: Path, declared: str | None) -> str | None:
    if declared in {"image", "video"}:
        return declared
    suffix = path.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        return "image"
    if suffix in VIDEO_SUFFIXES:
        return "video"
    return None


def is_placeholder_lens_name(value: str) -> bool:
    return not value.strip() or value.strip().casefold() == "untitled"


def get_store_listing_reuse(discover: dict[str, Any]) -> dict[str, Any]:
    direct = discover.get("storeListingReuse")
    if isinstance(direct, dict):
        return direct
    publish_context = discover.get("publishContext")
    if isinstance(publish_context, dict) and isinstance(publish_context.get("data"), dict):
        nested = publish_context["data"].get("storeListingReuse")
        if isinstance(nested, dict):
            return nested
    return {}


def reuses_field(summary: dict[str, Any], field: str) -> bool:
    return (
        summary.get("status") == "available"
        and isinstance(summary.get("fields"), dict)
        and summary["fields"].get(field) == "existing"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", default="-", help="Input JSON path, or - for stdin.")
    args = parser.parse_args()
    try:
        payload = read_json_input(args.json)
    except (ValueError, OSError) as error:
        return fail("input_unreadable", f"input must be one JSON object: {error}")
    if not isinstance(payload, dict):
        return fail("input_unreadable", "stdin must be a JSON object")

    preflight = payload.get("preflight") or {}
    discover = payload.get("discover") or {}
    proposals = payload.get("proposals") or {}
    if not isinstance(preflight, dict) or not isinstance(discover, dict) or not isinstance(proposals, dict):
        return fail("input_unreadable", "preflight, discover and proposals must each be an object")

    # Identity comes from the scripts, never from the model: a retyped packageVersion is exactly
    # the kind of error the availability guard then reports against the wrong value.
    package_id = str(discover.get("packageId") or preflight.get("packageId") or "")
    package_version = str(discover.get("packageVersion") or preflight.get("packageVersion") or "")
    project_path = str(preflight.get("projectPath") or "")
    if not package_id or not package_version or not project_path:
        return fail(
            "missing_identity",
            "projectPath, packageId, and packageVersion must come from preflight or discover",
        )
    try:
        package_id_assignment = FLOW.package_id_needs_assignment(preflight, discover)
    except FLOW.FlowIssue as error:
        return action_required(error.reason, error.message)

    # Preflight's Lens name wins unless it is Lens Studio's placeholder, in which case the
    # proposal is the one being confirmed.
    preflight_name = str(preflight.get("lensName") or "")
    proposed_name = str(proposals.get("lensName") or "")
    if preflight_name and not is_placeholder_lens_name(preflight_name):
        lens_name = preflight_name
    elif proposed_name and not is_placeholder_lens_name(proposed_name):
        lens_name = proposed_name
    else:
        return action_required(
            "lens_name_required",
            "The project has no usable Lens name and no non-placeholder proposal was supplied.",
        )
    try:
        FLOW.validate_lens_name(lens_name)
    except FLOW.FlowIssue as error:
        return action_required(error.reason, error.message)
    lens_name_needs_assignment = is_placeholder_lens_name(preflight_name)

    issue_values = preflight.get("issues", [])
    if not isinstance(issue_values, list):
        return fail("input_unreadable", "preflight.issues must be an array when supplied")
    issue_reasons = {
        issue.get("reason")
        for issue in issue_values
        if isinstance(issue, dict) and isinstance(issue.get("reason"), str)
    }

    lens_icon_proposal = proposals.get("lensIconPlan")
    if "no_lens_icon" in issue_reasons:
        if not isinstance(lens_icon_proposal, dict) or lens_icon_proposal.get("action") != "generate_and_assign":
            return action_required(
                "lens_icon_plan_required",
                "proposals.lensIconPlan must bind the staged generated icon before confirmation",
            )
        icon_path = Path(str(lens_icon_proposal.get("path") or "")).expanduser()
        if not icon_path.is_absolute() or not icon_path.is_file():
            return action_required("lens_icon_plan_invalid", "the staged generated Lens icon is unavailable")
        try:
            icon_checksum, icon_bytes = base64_sha256(icon_path)
        except OSError as error:
            return action_required("lens_icon_plan_invalid", f"could not read the staged Lens icon: {error}")
        lens_icon_plan = {
            "action": "generate_and_assign",
            "asset": {"path": str(icon_path), "checksum": icon_checksum, "bytes": icon_bytes},
        }
    elif lens_icon_proposal not in (None, {"action": "keep_existing"}):
        return action_required(
            "lens_icon_plan_invalid",
            "an existing project Lens icon must be preserved",
        )
    else:
        lens_icon_plan = {"action": "keep_existing"}

    signing_key_proposal = proposals.get("signingKeyPlan")
    if "no_prod_signing_key" in issue_reasons:
        if not isinstance(signing_key_proposal, dict) or signing_key_proposal.get("action") not in {
            "assign_existing",
            "generate_and_assign",
        }:
            return action_required(
                "signing_key_plan_required",
                "proposals.signingKeyPlan must bind the validated project-key action before confirmation",
            )
        signing_key_path = Path(str(signing_key_proposal.get("path") or "")).expanduser()
        if not signing_key_path.is_absolute():
            return action_required("signing_key_plan_invalid", "the signing-key plan path must be absolute")
        if signing_key_proposal["action"] == "assign_existing" and not signing_key_path.is_file():
            return action_required("signing_key_plan_invalid", "the validated existing signing key is unavailable")
        if signing_key_proposal["action"] == "generate_and_assign" and signing_key_path.exists():
            return action_required(
                "signing_key_plan_changed",
                "the planned signing-key path now exists; validate and freeze it as assign_existing",
            )
        signing_key_plan = {"action": signing_key_proposal["action"], "path": str(signing_key_path)}
    elif signing_key_proposal not in (None, {"action": "keep_existing"}):
        return action_required(
            "signing_key_plan_invalid",
            "an existing assigned production signing key must be preserved",
        )
    else:
        signing_key_plan = {"action": "keep_existing"}

    store_listing_reuse = get_store_listing_reuse(discover)
    if not store_listing_reuse:
        return fail("missing_publish_context", "discover.storeListingReuse must come from GET /lenses/publish-context")

    categories = discover.get("categories")
    if not isinstance(categories, list):
        return fail("missing_categories", "discover.categories must be the raw GET /categories array")
    selected_id = str(proposals.get("selectedCategoryId") or "")
    replacing_category = bool(selected_id)
    if not replacing_category and not reuses_field(store_listing_reuse, "category"):
        return action_required("category_required", "proposals.selectedCategoryId is required")
    match = next((c for c in categories if isinstance(c, dict) and c.get("id") == selected_id), None)
    if replacing_category and match is None:
        return action_required(
            "category_unknown",
            f"{selected_id!r} is not in the category list discover returned; pick one of those instead.",
        )

    replacing_description = "releaseDescription" in proposals
    description = str(proposals.get("releaseDescription") or "")
    if replacing_description and len(description.strip()) < 10:
        return action_required("description_required", "proposals.releaseDescription must be at least 10 characters")
    if not replacing_description and not reuses_field(store_listing_reuse, "description"):
        return action_required(
            "description_required",
            "proposals.releaseDescription is required because no existing description can be reused",
        )

    target_channel = proposals.get("targetChannel", "production")
    if not isinstance(target_channel, str) or target_channel not in ("production", "beta", "internal"):
        return action_required("target_channel_invalid", "targetChannel must be production, beta, or internal.")
    optional_submission: dict[str, str] = {"targetChannel": target_channel}
    for field in ("orgId", "orgDisplayName", "semanticVersion"):
        if field not in proposals:
            continue
        value = proposals.get(field)
        if not isinstance(value, str) or not value.strip():
            return action_required(
                "submission_value_invalid",
                f"proposals.{field} must be a non-empty string when supplied",
            )
        optional_submission[field] = value.strip()
    if "orgDisplayName" in optional_submission and "orgId" not in optional_submission:
        return action_required(
            "submission_value_invalid",
            "proposals.orgDisplayName requires proposals.orgId",
        )

    replacing_tags = "releaseTags" in proposals
    if not replacing_tags and not reuses_field(store_listing_reuse, "tags"):
        return action_required(
            "tags_required",
            "proposals.releaseTags is required because no existing tags can be reused",
        )

    replacing_rating = "contentRatingAssessment" in proposals
    assessment = proposals.get("contentRatingAssessment")
    if replacing_rating and (not isinstance(assessment, dict) or not assessment):
        return action_required(
            "assessment_required",
            "proposals.contentRatingAssessment is required; freeze-plan validates it and computes the rating.",
        )
    if not replacing_rating and not reuses_field(store_listing_reuse, "contentRating"):
        return action_required(
            "assessment_required",
            "proposals.contentRatingAssessment is required because no existing content rating can be reused.",
        )

    # Preview media: the caller names the files, this computes their identity.
    assets: list[dict[str, Any]] = []
    entries = proposals.get("previewMedia") or []
    staging_value = payload.get("previewStagingDir")
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or not entry.get("path"):
            return fail("bad_preview_entry", f"proposals.previewMedia[{index}] needs a path")
        path = Path(str(entry["path"])).expanduser()
        if not path.is_file():
            return action_required("preview_missing", f"preview media not found: {path.name}")
        media_type = media_type_for(path, entry.get("type"))
        if media_type is None:
            return action_required(
                "preview_type_unknown",
                f"cannot tell whether {path.name} is an image or a video; set type explicitly. "
                f"Videos must end in one of {', '.join(sorted(VIDEO_SUFFIXES))}.",
            )
        # User videos upload unchanged, and the upload declares its type from the extension.
        if media_type == "video" and path.suffix.lower() not in VIDEO_SUFFIXES:
            return action_required(
                "preview_video_format",
                f"{path.name} must end in one of {', '.join(sorted(VIDEO_SUFFIXES))} to use as a preview video.",
            )
        # Session-owned automatic media was already produced in the store shape.
        if not str(entry.get("source") or "").startswith("auto_"):
            if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
                return action_required("ffmpeg_missing", "ffmpeg and ffprobe are required to check preview media.")
            if media_type == "video":
                issue = user_video_issue(path)
                if issue:
                    return action_required("preview_video_invalid", issue)
            else:
                if not isinstance(staging_value, str) or not Path(staging_value).is_absolute():
                    return fail("preview_staging_unavailable", "previewStagingDir must be an absolute path")
                try:
                    path = stage_user_image(path, Path(staging_value) / f"preview-image-{index + 1}.png")
                except (OSError, ValueError) as error:
                    return action_required("preview_image_invalid", str(error))
        try:
            checksum, size = base64_sha256(path)
        except OSError as error:
            return action_required("preview_unreadable", f"could not read preview media {path.name}: {error}")
        assets.append(
            {
                "source": str(entry.get("source") or ("user_video" if media_type == "video" else "user_image")),
                "path": str(path),
                "type": media_type,
                "checksum": checksum,
                "bytes": size,
            }
        )

    images = sum(1 for a in assets if a["type"] == "image")
    videos = sum(1 for a in assets if a["type"] == "video")
    count_issue = FLOW.preview_count_issue(images, videos) if assets else None
    if count_issue:
        return action_required("preview_count_invalid", count_issue)
    oversized = [a["path"] for a in assets if a["bytes"] > FLOW.MEDIA_BYTE_LIMITS[a["type"]]]
    if oversized:
        return action_required(
            "preview_too_large",
            f"{len(oversized)} preview file(s) exceed the per-file limit (images: 15 MB; videos: 100 MB)",
        )

    replacing_preview = bool(assets)
    if not replacing_preview and not reuses_field(store_listing_reuse, "previewMedia"):
        return action_required(
            "preview_required",
            "Preview media must be supplied or generated because no existing preview media can be reused.",
        )

    context = discover.get("publishContext", {}).get("data", {}).get("legalDocuments")
    if not isinstance(context, dict):
        return action_required(
            "legal_documents_unavailable", "Update the publish service and rerun discovery for legal readiness."
        )
    plan_input = {
        "legalDocuments": context,
        "legalDocumentInputs": proposals.get("legalDocumentInputs", {}),
        "projectPath": project_path,
        "packageId": package_id,
        "packageVersion": package_version,
        "lensName": lens_name,
        "storeListingReuse": store_listing_reuse,
        "selectableCategories": categories,
        "previewMediaPlan": str(
            proposals.get("previewMediaPlan") or (assets[0]["source"] if assets else "preserve_existing")
        ),
        "previewMediaAssets": assets,
        "lensNameNeedsAssignment": lens_name_needs_assignment,
        "packageIdNeedsAssignment": package_id_assignment,
        "packageIdBeforeAssignment": preflight["packageId"].strip() if package_id_assignment else "",
        "lensIconPlan": lens_icon_plan,
        "signingKeyPlan": signing_key_plan,
        **({"releaseDescription": description} if replacing_description else {}),
        **({"releaseTags": proposals.get("releaseTags") or []} if replacing_tags else {}),
        **(
            {
                "selectedCategoryId": selected_id,
                "selectedCategoryDisplayName": match.get("displayName"),
            }
            if replacing_category and match is not None
            else {}
        ),
        **({"contentRatingAssessment": assessment} if replacing_rating else {}),
        **optional_submission,
    }

    print(
        json.dumps(
            {
                "status": "PLAN_INPUT_READY",
                "stage": "assemble_plan",
                "freezePlanInput": plan_input,
                # Surfaced so the caller can show the confirmation without re-deriving anything.
                "lensNameSource": "preflight" if lens_name == preflight_name else "proposal",
                "categoryDisplayName": match.get("displayName") if match is not None else None,
                "previewMediaCount": len(assets),
                "collectorVersion": (payload.get("collector") or {}).get("collectorVersion"),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
