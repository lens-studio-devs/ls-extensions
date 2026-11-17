#!/usr/bin/env python3

"""Deterministic state and validation helpers for the Specs publish skill.

The agent still owns semantic proposals, visual review, MCP calls, and the user
confirmation. This helper owns exact normalization, fingerprints, guarded state
transitions, request bodies, and package-version comparisons.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

MAX_VERSION_COMPONENT = 2**32 - 1
_MEDIA_SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "schemas" / "preview-images.schema.json").read_text(encoding="utf-8")
)
MEDIA_BYTE_LIMITS = {kind: _MEDIA_SCHEMA["$defs"][f"{kind}Bytes"]["maximum"] for kind in ("image", "video")}
# Developer Portal store-listing preview counts, per locale.
PREVIEW_COUNT_LIMITS = {
    label: _MEDIA_SCHEMA["$defs"][key]
    for label, key in (
        ("Previews", "previewMediaCount"),
        ("Preview images", "previewImageCount"),
        ("Preview videos", "previewVideoCount"),
    )
}
# Developer Portal limits for the Lens name and the selectable store tags, in portal display order.
LENS_NAME_MAX_LENGTH = 30
MAX_RELEASE_TAGS = 5
CURATED_TAGS = (
    "Outdoors",
    "Active",
    "Offline Mode",
    "Beginner Lenses",
    "Educational",
    "Tabletop",
    "Productivity",
    "Wellness",
    "Holiday",
    "Travel",
    "Creative",
    "World-Based",
    "Watch",
    "Music",
    "Lifestyle",
    "Tools",
    "Developer Tool",
)
SEVERITY_VALUES = {"none", "infrequentMild", "frequentIntense"}
BOOLEAN_VALUES = {"No", "Yes"}
# SPECS computes the age rating from these answers when the release metadata is saved.
SEVERITY_QUESTIONS = (
    "cartoonFantasyViolence",
    "realisticViolence",
    "realisticGore",
    "horrorFear",
    "profanityCrudeHumor",
    "sexualContentNudity",
    "alcoholTobaccoDrugReferences",
    "medicalTreatmentInformation",
)
TOP_LEVEL_CAPABILITIES = (
    "unrestrictedWebAccess",
    "gamblingContests",
    "lootBoxes",
    "generativeAi",
    "messagingSocialNetworking",
    "advertising",
    "locationSharing",
)
STORE_LISTING_FIELDS = (
    "description",
    "tags",
    "category",
    "localizations",
    "contentRating",
    "previewMedia",
)
STORE_LISTING_SOURCES = {"draft", "production", "beta", "internal"}
TARGET_CHANNEL_LABELS = {"production": "Public", "beta": "Beta", "internal": "Internal"}
STORE_LISTING_NONE_REASONS = {"new_lens", "package_unavailable", "no_channel_release"}
MODERATION_CATEGORIES = {
    "adult_sexual",
    "graphic_violence",
    "hate_symbols_or_harassment",
    "drugs_or_illicit_substances",
    "self_harm",
    "minor_safety",
    "unsafe_or_deceptive_claims",
    "external_ads_or_promotions",
    "other",
}
RATING_SECTIONS = (
    (
        "Violence & Scary Themes",
        (
            ("cartoonFantasyViolence", "Cartoon or Fantasy Violence"),
            ("realisticViolence", "Realistic Violence"),
            ("realisticGore", "Realistic Gore"),
            ("horrorFear", "Horror or Fear Themes"),
        ),
    ),
    (
        "Mature Content & Substances",
        (
            ("profanityCrudeHumor", "Profanity or Crude Humor"),
            ("sexualContentNudity", "Sexual Content or Nudity"),
            ("alcoholTobaccoDrugReferences", "Alcohol, Tobacco, or Drug References"),
            ("medicalTreatmentInformation", "Medical or Treatment Information"),
        ),
    ),
    (
        "Interactive Safety",
        (
            ("unrestrictedWebAccess", "Unrestricted Web Access"),
            ("gamblingContests", "Gambling or Contests"),
            ("lootBoxes", "Randomized Purchasable Items"),
            ("generativeAi", "AI-Generated Content"),
            ("aiModeration", "AI Output Moderation"),
        ),
    ),
    (
        "Lens Capabilities",
        (
            ("messagingSocialNetworking", "Messaging or Social Networking"),
            ("advertising", "Advertising"),
            ("ageAppropriateAds", "Age-Appropriate Advertising"),
            ("locationSharing", "Location Sharing"),
        ),
    ),
)
SEVERITY_DISPLAY = {
    "none": "None",
    "infrequentMild": "Infrequent/Mild",
    "frequentIntense": "Frequent/Intense",
}
ALLOWED_REGISTRATION_RETRIES = {
    "backend_account_correction",
    "backend_category_correction",
    "backend_org_correction",
    "near_expiry_upload_url",
    "changed_spk_checksum",
    "corrected_package_build_version",
}


class FlowIssue(Exception):
    def __init__(
        self,
        reason: str,
        message: str,
        *,
        status: str = "ACTION_REQUIRED",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.status = status
        self.details = details or {}

    def result(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "stage": "publish_flow",
            "reason": self.reason,
            "message": self.message,
            **({"details": self.details} if self.details else {}),
        }


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def require_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FlowIssue("invalid_plan", f"{field} must be an object.")
    return value


def require_list(value: Any, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise FlowIssue("invalid_plan", f"{field} must be an array.")
    return value


def require_string(value: Any, field: str, *, minimum: int = 1) -> str:
    if not isinstance(value, str) or len(value.strip()) < minimum:
        raise FlowIssue("invalid_plan", f"{field} must be a non-empty string.")
    return value.strip()


def require_string_list(value: Any, field: str) -> list[str]:
    items = require_list(value, field)
    return [require_string(item, f"{field}[]") for item in items]


def markdown_text(value: Any, field: str) -> str:
    """Return safe one-line text for a Markdown value, never structure."""
    text = " ".join(require_string(value, field).split())
    for character in ("\\", "`", "*", "_", "[", "]", "<", ">"):
        text = text.replace(character, f"\\{character}")
    return text


def markdown_path(value: Any, field: str) -> str:
    path = require_string(value, field)
    if any(character in path for character in ("\n", "\r", "<", ">")):
        raise FlowIssue("confirmation_asset_invalid", f"{field} cannot be rendered safely.")
    return path


def markdown_code(value: Any, field: str) -> str:
    text = require_string(value, field)
    if any(character in text for character in ("\n", "\r")):
        raise FlowIssue("confirmation_presentation_invalid", f"{field} cannot contain a newline.")
    if "`" not in text:
        return f"`{text}`"
    longest_run = max(len(match.group(0)) for match in re.finditer(r"`+", text))
    fence = "`" * (longest_run + 1)
    return f"{fence} {text} {fence}"


def is_valid_package_id(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) <= 128
        and re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+", value) is not None
    )


def validate_package_id(value: Any) -> str:
    if not is_valid_package_id(value):
        raise FlowIssue(
            "invalid_package_id", "Package ID must use lowercase dot-separated segments and at most 128 characters."
        )
    return value


def package_id_needs_assignment(preflight: dict[str, Any], discover: dict[str, Any]) -> bool:
    """Bind a missing/invalid-ID proposal to observed state and a new available identity."""
    candidate = validate_package_id(discover.get("packageId"))
    current = preflight.get("packageId")
    if not isinstance(current, str):
        raise FlowIssue("package_identity_changed", "Preflight must report the current package ID.")
    current = current.strip()
    if is_valid_package_id(current):
        if candidate != current or discover.get("currentPackageId", current) != current:
            raise FlowIssue(
                "package_identity_changed", "Package ID changed between Preflight and discovery; rerun both."
            )
        return False
    if discover.get("currentPackageId") != current or discover.get("projectPath") != preflight.get("projectPath"):
        raise FlowIssue(
            "package_identity_changed",
            "Discovery must confirm the same project and original invalid or missing package ID.",
        )
    context = require_object(discover.get("publishContext"), "discover.publishContext")
    data = require_object(context.get("data"), "discover.publishContext.data")
    availability = require_object(data.get("availability"), "publishContext.availability")
    checks = require_object(availability.get("checks"), "availability.checks")
    check = require_object(checks.get("pkgId"), "availability.checks.pkgId")
    if check.get("value") != candidate or check.get("valid") is not True or check.get("reason") != "AVAILABLE":
        raise FlowIssue(
            "PKG_ID_UNAVAILABLE",
            "The proposed package ID is not available for a new Lens. Choose another ID and rerun discovery.",
        )
    return True


def parse_version(value: Any, field: str = "packageVersion") -> tuple[int, int, int]:
    text = require_string(value, field)
    parts = text.split(".")
    if len(parts) != 3 or any(not re.fullmatch(r"[0-9]+", part) for part in parts):
        raise FlowIssue("invalid_package_version", f"{field} must use major.minor.patch.")
    if any(len(part) > 1 and part.startswith("0") for part in parts):
        raise FlowIssue("invalid_package_version", f"{field} cannot contain leading zeroes.")
    parsed = tuple(int(part) for part in parts)
    if any(part > MAX_VERSION_COMPONENT for part in parsed):
        raise FlowIssue("invalid_package_version", f"{field} exceeds unsigned 32-bit components.")
    return parsed  # type: ignore[return-value]


def normalize_tags(values: Any) -> list[str]:
    tags = require_list(values, "releaseTags")
    curated = {tag.casefold(): tag for tag in CURATED_TAGS}
    normalized: list[str] = []
    for index, value in enumerate(tags):
        tag = curated.get(require_string(value, f"releaseTags[{index}]").lstrip("#").strip().casefold())
        if tag is None:
            raise FlowIssue(
                "invalid_plan",
                f"releaseTags[{index}] is not a Developer Portal tag; use one of: {', '.join(CURATED_TAGS)}.",
            )
        if f"#{tag}" not in normalized:
            normalized.append(f"#{tag}")
    if not 1 <= len(normalized) <= MAX_RELEASE_TAGS:
        raise FlowIssue("invalid_plan", f"releaseTags must contain 1 to {MAX_RELEASE_TAGS} unique tags.")
    return normalized


def validate_lens_name(value: Any) -> str:
    name = require_string(value, "lensName")
    if len(name.strip()) > LENS_NAME_MAX_LENGTH:
        raise FlowIssue(
            "lens_name_too_long",
            f"Lens names can have at most {LENS_NAME_MAX_LENGTH} characters; rename the Lens in Lens Studio.",
        )
    return name


def normalize_categories(values: Any) -> list[dict[str, Any]]:
    categories: list[dict[str, Any]] = []
    for value in require_list(values, "selectableCategories"):
        if not isinstance(value, dict):
            continue
        category_id = str(value.get("id") or "").strip()
        display_name = str(value.get("displayName") or "").strip()
        if not category_id or not display_name:
            continue
        if display_name.casefold() in {"featured", "favorites", "favourites"}:
            continue
        display_order = value.get("displayOrder")
        if not isinstance(display_order, (int, float)):
            display_order = sys.maxsize
        categories.append({"id": category_id, "displayName": display_name, "displayOrder": display_order})
    categories.sort(key=lambda item: (item["displayOrder"], item["displayName"].casefold(), item["id"]))
    return categories


def select_category(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    categories = normalize_categories(payload.get("selectableCategories"))
    selected_id = require_string(payload.get("selectedCategoryId"), "selectedCategoryId")
    selected = next((item for item in categories if item["id"] == selected_id), None)
    if selected is None:
        raise FlowIssue(
            "CATEGORY_INVALID",
            "The selected category is not in the current selectable category list.",
            details={"selectedCategoryId": selected_id, "categories": categories},
        )
    displayed = payload.get("selectedCategoryDisplayName")
    if displayed is not None and displayed != selected["displayName"]:
        raise FlowIssue(
            "CATEGORY_DISPLAY_NAME_MISMATCH",
            "The confirmation category label does not match the selected backend category.",
            details={
                "selectedCategoryId": selected_id,
                "confirmedDisplayName": displayed,
                "backendDisplayName": selected["displayName"],
            },
        )
    return selected, categories


def normalize_store_listing_reuse(value: Any) -> dict[str, Any]:
    summary = require_object(value, "storeListingReuse")
    status = summary.get("status")
    if status == "none":
        reason = summary.get("reason")
        if reason not in STORE_LISTING_NONE_REASONS:
            raise FlowIssue("invalid_publish_context", "storeListingReuse.reason is invalid.")
        return {"status": "none", "reason": reason}
    if status != "available" or summary.get("source") not in STORE_LISTING_SOURCES:
        raise FlowIssue("invalid_publish_context", "storeListingReuse has an invalid status or source.")
    fields = require_object(summary.get("fields"), "storeListingReuse.fields")
    normalized_fields: dict[str, str] = {}
    for field in (*STORE_LISTING_FIELDS, "tileAssets"):
        field_state = fields.get(field)
        if field_state not in {"existing", "missing"}:
            raise FlowIssue("invalid_publish_context", f"storeListingReuse.fields.{field} is invalid.")
        normalized_fields[field] = field_state
    return {
        "status": "available",
        "source": summary["source"],
        "fields": normalized_fields,
    }


def can_reuse(summary: dict[str, Any], field: str) -> bool:
    return summary.get("status") == "available" and summary["fields"].get(field) == "existing"


def validate_content_rating(value: Any) -> dict[str, str]:
    """Validate a complete assessment; SPECS derives the age rating from it on save."""
    assessment = require_object(value, "contentRatingAssessment")
    normalized: dict[str, str] = {}
    for field in SEVERITY_QUESTIONS:
        answer = assessment.get(field)
        if answer not in SEVERITY_VALUES:
            raise FlowIssue("content_rating_incomplete", f"{field} has an invalid or missing answer.")
        normalized[field] = answer
    for field in TOP_LEVEL_CAPABILITIES:
        answer = assessment.get(field)
        if answer not in BOOLEAN_VALUES:
            raise FlowIssue("content_rating_incomplete", f"{field} has an invalid or missing answer.")
        normalized[field] = answer
    if normalized["generativeAi"] == "Yes":
        ai_moderation = assessment.get("aiModeration")
        if ai_moderation not in BOOLEAN_VALUES:
            raise FlowIssue("content_rating_incomplete", "aiModeration is required when generativeAi is Yes.")
        normalized["aiModeration"] = ai_moderation
    elif "aiModeration" in assessment:
        raise FlowIssue("content_rating_invalid", "aiModeration must be omitted when generativeAi is No.")
    if normalized["advertising"] == "Yes":
        age_appropriate_ads = assessment.get("ageAppropriateAds")
        if age_appropriate_ads not in BOOLEAN_VALUES:
            raise FlowIssue(
                "content_rating_incomplete",
                "ageAppropriateAds is required when advertising is Yes.",
            )
        normalized["ageAppropriateAds"] = age_appropriate_ads
    elif "ageAppropriateAds" in assessment:
        raise FlowIssue(
            "content_rating_invalid",
            "ageAppropriateAds must be omitted when advertising is No.",
        )
    return normalized


def content_rating_assessment_for_api(assessment: dict[str, str]) -> dict[str, Any]:
    boolean_fields = [*TOP_LEVEL_CAPABILITIES]
    if "aiModeration" in assessment:
        boolean_fields.append("aiModeration")
    if "ageAppropriateAds" in assessment:
        boolean_fields.append("ageAppropriateAds")
    return {
        "severityAnswers": {field: assessment[field] for field in SEVERITY_QUESTIONS},
        "booleanAnswers": {field: assessment[field] == "Yes" for field in boolean_fields},
    }


def normalize_lens_icon_plan(value: Any) -> dict[str, Any]:
    if value is None:
        return {"action": "keep_existing"}
    plan = require_object(value, "lensIconPlan")
    action = plan.get("action")
    if action == "keep_existing" and set(plan) == {"action"}:
        return {"action": action}
    if action != "generate_and_assign" or set(plan) != {"action", "asset"}:
        raise FlowIssue(
            "project_setup_invalid",
            "lensIconPlan must keep the existing icon or bind one generated asset.",
        )
    asset = require_object(plan.get("asset"), "lensIconPlan.asset")
    if set(asset) != {"path", "checksum", "bytes"}:
        raise FlowIssue("project_setup_invalid", "lensIconPlan.asset has an invalid shape.")
    byte_count = asset.get("bytes")
    if not isinstance(byte_count, int) or isinstance(byte_count, bool) or byte_count <= 0:
        raise FlowIssue("project_setup_invalid", "lensIconPlan.asset.bytes is invalid.")
    return {
        "action": action,
        "asset": {
            "path": require_string(asset.get("path"), "lensIconPlan.asset.path"),
            "checksum": validate_checksum(asset.get("checksum"), "lensIconPlan.asset.checksum"),
            "bytes": byte_count,
        },
    }


def normalize_signing_key_plan(value: Any) -> dict[str, str]:
    if value is None:
        return {"action": "keep_existing"}
    plan = require_object(value, "signingKeyPlan")
    action = plan.get("action")
    if action == "keep_existing" and set(plan) == {"action"}:
        return {"action": action}
    if action not in {"assign_existing", "generate_and_assign"} or set(plan) != {"action", "path"}:
        raise FlowIssue(
            "project_setup_invalid",
            "signingKeyPlan must keep, assign, or generate one validated project key path.",
        )
    return {"action": action, "path": require_string(plan.get("path"), "signingKeyPlan.path")}


def is_valid_build_version(value: Any) -> bool:
    try:
        parse_version(value)
        return True
    except FlowIssue:
        return False


def normalize_build_version_plan(
    value: Any,
    *,
    project_path: str,
    package_version: str,
) -> dict[str, str]:
    if value is None:
        return {"action": "keep_existing"}
    plan = require_object(value, "buildVersionPlan")
    action = plan.get("action")
    if action == "keep_existing" and set(plan) == {"action"}:
        return {"action": action}
    expected_fields = {"action", "projectPath", "currentBuildVersion", "buildVersion"}
    if action != "assign" or set(plan) != expected_fields:
        raise FlowIssue(
            "project_setup_invalid",
            "buildVersionPlan must keep the existing version or bind one exact version update.",
        )
    bound_project = require_string(plan.get("projectPath"), "buildVersionPlan.projectPath")
    current = plan.get("currentBuildVersion")
    if not isinstance(current, str) or current != current.strip():
        raise FlowIssue("project_setup_invalid", "currentBuildVersion must be the observed version string.")
    target = require_string(plan.get("buildVersion"), "buildVersionPlan.buildVersion")
    current_version = parse_version(current) if is_valid_build_version(current) else None
    target_version = parse_version(target, "buildVersionPlan.buildVersion")
    if (
        bound_project != project_path
        or target != package_version
        or (current_version is not None and target_version <= current_version)
    ):
        raise FlowIssue(
            "project_setup_invalid",
            "buildVersionPlan must match the frozen project and increase a valid version or replace an invalid one.",
        )
    return {
        "action": action,
        "projectPath": bound_project,
        "currentBuildVersion": current,
        "buildVersion": target,
    }


def validate_checksum(value: Any, field: str) -> str:
    checksum = require_string(value, field)
    try:
        decoded = base64.b64decode(checksum, validate=True)
    except ValueError as error:
        raise FlowIssue("invalid_checksum", f"{field} must be base64 SHA-256.") from error
    if len(decoded) != 32:
        raise FlowIssue("invalid_checksum", f"{field} must decode to 32 bytes.")
    return checksum


TILE_TYPES = ("primary", "default", "square", "hero")
TILE_LABELS = {
    "primary": "Primary source image",
    "default": "Default — 504×672 (3:4)",
    "square": "Square — 504×504 (1:1)",
    "hero": "Hero — 1056×792 (4:3)",
}


def normalize_tile_assets(values: Any) -> list[dict[str, Any]]:
    assets = require_list(values, "tileAssets")
    result = []
    seen = set()
    for value in assets:
        asset = require_object(value, "tileAssets[]")
        role = asset.get("tileType")
        if not isinstance(role, str) or role not in TILE_TYPES or role in seen or asset.get("type") != "image":
            raise FlowIssue("invalid_tile_assets", "Tiles require unique named roles and image type.")
        seen.add(role)
        count = asset.get("bytes")
        if type(count) is not int or not 0 < count <= MEDIA_BYTE_LIMITS["image"]:
            raise FlowIssue("invalid_tile_assets", "Tile bytes must be within 15 MB.")
        result.append(
            {
                "tileType": role,
                "type": "image",
                "bytes": count,
                "path": require_string(asset.get("path"), "tileAssets[].path"),
                "source": require_string(asset.get("source"), "tileAssets[].source"),
                "checksum": validate_checksum(asset.get("checksum"), "tileAssets[].checksum"),
            }
        )
    return result


def normalize_tile_uploads(values: Any) -> list[dict[str, Any]]:
    result = []
    for value in require_list(values, "tileUploads"):
        item = require_object(value, "tileUploads[]")
        role = item.get("tileType")
        if not isinstance(role, str) or role not in TILE_TYPES or any(x["tileType"] == role for x in result):
            raise FlowIssue("invalid_tile_assets", "Tile uploads require unique named roles.")
        url = require_string(item.get("url"), "tileUploads[].url")
        if not (url.startswith("https://") or url.startswith("/v1/apps/content/download?")):
            raise FlowIssue("invalid_tile_assets", "Tile upload URL must be HTTPS or a content download path.")
        result.append({"tileType": role, "url": url})
    return result


def preview_count_issue(images: int, videos: int) -> str | None:
    """Describe the first Developer Portal preview-count rule a replacement set breaks."""
    for (label, limits), count in zip(PREVIEW_COUNT_LIMITS.items(), (images + videos, images, videos)):
        if not limits["minimum"] <= count <= limits["maximum"]:
            return f"{label}: {limits['minimum']} to {limits['maximum']} per store listing; got {count}."
    return None


def normalize_preview_assets(values: Any) -> list[dict[str, Any]]:
    assets = require_list(values, "previewMediaAssets")
    if assets:
        issue = preview_count_issue(
            sum(isinstance(item, dict) and item.get("type") == "image" for item in assets),
            sum(isinstance(item, dict) and item.get("type") == "video" for item in assets),
        )
        if issue:
            raise FlowIssue("preview_media_limit", issue)
    normalized: list[dict[str, Any]] = []
    for index, value in enumerate(assets):
        asset = require_object(value, f"previewMediaAssets[{index}]")
        media_type = asset.get("type")
        if media_type not in {"image", "video"}:
            raise FlowIssue("invalid_preview_media", f"previewMediaAssets[{index}].type is invalid.")
        byte_count = asset.get("bytes")
        if not isinstance(byte_count, int) or byte_count < 0 or byte_count > MEDIA_BYTE_LIMITS[media_type]:
            raise FlowIssue(
                "invalid_preview_media",
                f"previewMediaAssets[{index}].bytes must be within "
                f"{MEDIA_BYTE_LIMITS[media_type] // (1024 * 1024)} MB for {media_type}.",
            )
        normalized.append(
            {
                **asset,
                "path": require_string(asset.get("path"), f"previewMediaAssets[{index}].path"),
                "source": require_string(asset.get("source"), f"previewMediaAssets[{index}].source"),
                "type": media_type,
                "checksum": validate_checksum(asset.get("checksum"), f"previewMediaAssets[{index}].checksum"),
                "bytes": byte_count,
                "previewIndex": index,
            }
        )
    return normalized


def plan_fingerprint(plan: dict[str, Any]) -> str:
    fingerprint_input = copy.deepcopy(plan)
    fingerprint_input.pop("publishPlanConfirmed", None)
    return fingerprint(fingerprint_input)


def validate_target_channel(value: Any) -> str:
    if not isinstance(value, str) or value not in TARGET_CHANNEL_LABELS:
        raise FlowIssue("target_channel_invalid", "targetChannel must be production, beta, or internal.")
    return value


def normalize_legal_context(value: Any) -> dict[str, Any]:
    context = require_object(value, "legalDocuments")
    if type(context.get("requiredForPublicChannels")) is not bool:
        raise FlowIssue(
            "legal_organization_required",
            "Select an organization and rerun publish-context to resolve legal requirements.",
        )
    require_string(context.get("tenantId"), "legalDocuments.tenantId")
    documents = require_object(context.get("documents"), "legalDocuments.documents")
    if set(documents) != set(LEGAL_DOCUMENT_TYPES):
        raise FlowIssue("legal_documents_unavailable", "Publish context must describe both legal documents.")
    for kind, document in documents.items():
        item = require_object(document, f"legalDocuments.documents.{kind}")
        if item.get("status") not in {"missing", "ready", "pending", "failed"}:
            raise FlowIssue("legal_documents_unavailable", "Unknown legal document readiness.")
        if item["status"] != "missing":
            require_string(item.get("revisionId"), "legal document revisionId")
        if item["status"] == "ready":
            require_string(item.get("publicUrl"), "legal document publicUrl")
    return copy.deepcopy(context)


def normalize_legal_inputs(value: Any) -> dict[str, Any]:
    from urllib.parse import urlsplit

    inputs = require_object(value, "legalDocumentInputs")
    if set(inputs) - set(LEGAL_DOCUMENT_TYPES):
        raise FlowIssue("legal_document_input_invalid", "Only Privacy Policy and Terms of Service are supported.")
    result = {}
    for kind, source in inputs.items():
        source = require_object(source, f"legalDocumentInputs.{kind}")
        if set(source) not in ({"url"}, {"text"}):
            raise FlowIssue("legal_document_input_invalid", "Provide exactly one HTTPS URL or plain text per document.")
        field = next(iter(source))
        value = source[field]
        if not isinstance(value, str) or not value.strip():
            raise FlowIssue("legal_document_input_invalid", "Legal documents cannot be blank.")
        if field == "url":
            value = value.strip()
            try:
                url = urlsplit(value)
                valid = url.scheme == "https" and "." in (url.hostname or "") and not url.username and not url.password
            except ValueError:
                valid = False
            if not valid or len(value) > 2048:
                raise FlowIssue(
                    "legal_document_input_invalid",
                    "Provide an HTTPS URL without credentials (at most 2048 characters).",
                )
        elif len(value.encode("utf-16-le")) // 2 > 32000:
            raise FlowIssue("legal_document_input_invalid", "Legal text must be at most 32000 characters.")
        result[kind] = {field: value}
    return result


def legal_confirmation_blockers(plan: dict[str, Any]) -> list[str]:
    context = plan.get("legalDocuments")
    if context is None:  # Recovery of plans frozen by older skill versions; Finalize still checks.
        return []
    context = normalize_legal_context(context)
    required = context["requiredForPublicChannels"] and plan.get("targetChannel", "production") != "internal"
    inputs = normalize_legal_inputs(plan.get("legalDocumentInputs", {}))
    return [
        kind
        for kind, doc in context["documents"].items()
        if doc["status"] == "failed" or (required and doc["status"] == "missing" and kind not in inputs)
    ]


def freeze_plan(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("stage") == "assemble_plan" and payload.get("status") in {"ACTION_REQUIRED", "FAILED"}:
        return payload
    # Accept either the bare plan input or `assemble-plan.py`'s whole result. The documented
    # pipeline pipes that script's stdout straight in, and a measured run lost two trips to the
    # wrapper being rejected — a failed attempt plus a --schema probe. The shape is unambiguous:
    # a payload carrying `freezePlanInput` is the wrapper.
    if isinstance(payload.get("freezePlanInput"), dict):
        payload = payload["freezePlanInput"]
    if "legalDocuments" in payload:
        payload = copy.deepcopy(payload)
        context = normalize_legal_context(payload["legalDocuments"])
        inputs = normalize_legal_inputs(payload.get("legalDocumentInputs", {}))
        if payload.get("orgId", context["tenantId"]) != context["tenantId"]:
            raise FlowIssue("legal_organization_changed", "Rerun discovery for the selected organization.")
        if any(context["documents"][kind]["status"] != "missing" for kind in inputs):
            raise FlowIssue(
                "legal_document_already_saved",
                "Reuse saved documents. Edit existing documents in Lens Settings, then refresh context.",
            )
        payload.update(legalDocuments=context, legalDocumentInputs=inputs, orgId=context["tenantId"])
    elif payload.get("legalDocumentInputs"):
        raise FlowIssue("legal_documents_unavailable", "Refresh publish-context before supplying legal documents.")
    store_listing_reuse = normalize_store_listing_reuse(payload.get("storeListingReuse"))
    categories = normalize_categories(payload.get("selectableCategories", []))

    replacing_description = "releaseDescription" in payload
    if not replacing_description and not can_reuse(store_listing_reuse, "description"):
        raise FlowIssue("description_required", "A description is required because no existing value can be reused.")
    description = (
        require_string(payload.get("releaseDescription"), "releaseDescription", minimum=10)
        if replacing_description
        else None
    )

    replacing_tags = "releaseTags" in payload
    if not replacing_tags and not can_reuse(store_listing_reuse, "tags"):
        raise FlowIssue("tags_required", "Tags are required because no existing value can be reused.")
    tags = normalize_tags(payload.get("releaseTags")) if replacing_tags else None

    replacing_category = "selectedCategoryId" in payload
    if replacing_category:
        category, categories = select_category(payload)
    elif can_reuse(store_listing_reuse, "category"):
        category = None
    else:
        raise FlowIssue("CATEGORY_REQUIRED", "A category is required because no existing value can be reused.")

    if "targetAgeRating" in payload:
        raise FlowIssue(
            "target_age_rating_not_accepted",
            "Omit targetAgeRating; SPECS computes the age rating from contentRatingAssessment.",
        )
    replacing_rating = "contentRatingAssessment" in payload
    if replacing_rating:
        assessment = validate_content_rating(payload.get("contentRatingAssessment"))
    elif can_reuse(store_listing_reuse, "contentRating"):
        assessment = None
    else:
        raise FlowIssue(
            "assessment_required",
            "A content-rating assessment is required because no existing value can be reused.",
        )

    preview_assets = normalize_preview_assets(payload.get("previewMediaAssets", []))
    replacing_preview = bool(preview_assets)
    if not replacing_preview and not can_reuse(store_listing_reuse, "previewMedia"):
        raise FlowIssue("preview_required", "Preview media is required because no existing value can be reused.")
    preview_plan = require_string(payload.get("previewMediaPlan"), "previewMediaPlan")
    if replacing_preview and preview_plan == "preserve_existing":
        raise FlowIssue("invalid_preview_media", "A replacement preview set cannot use preserve_existing.")
    if not replacing_preview and preview_plan != "preserve_existing":
        raise FlowIssue("invalid_preview_media", "Existing preview media must use preserve_existing.")

    project_path = require_string(payload.get("projectPath"), "projectPath")
    package_version = require_string(payload.get("packageVersion"), "packageVersion")
    parse_version(package_version)
    optional_submission = {
        field: require_string(payload.get(field), field)
        for field in ("orgId", "orgDisplayName", "semanticVersion")
        if field in payload
    }
    if "orgDisplayName" in optional_submission and "orgId" not in optional_submission:
        raise FlowIssue("submission_value_invalid", "orgDisplayName requires orgId.")
    lens_name_needs_assignment = payload.get("lensNameNeedsAssignment", False)
    if not isinstance(lens_name_needs_assignment, bool):
        raise FlowIssue("project_setup_invalid", "lensNameNeedsAssignment must be a boolean.")
    package_id_assignment = payload.get("packageIdNeedsAssignment", False)
    if not isinstance(package_id_assignment, bool):
        raise FlowIssue("project_setup_invalid", "packageIdNeedsAssignment must be a boolean.")
    package_id_before_assignment = payload.get("packageIdBeforeAssignment", "")
    if not isinstance(package_id_before_assignment, str) or (
        package_id_assignment and is_valid_package_id(package_id_before_assignment.strip())
    ):
        raise FlowIssue(
            "project_setup_invalid", "Package ID assignment may replace only an observed missing or invalid ID."
        )
    lens_icon_plan = normalize_lens_icon_plan(payload.get("lensIconPlan"))
    signing_key_plan = normalize_signing_key_plan(payload.get("signingKeyPlan"))
    build_version_plan = normalize_build_version_plan(
        payload.get("buildVersionPlan"),
        project_path=project_path,
        package_version=package_version,
    )
    plan = copy.deepcopy(payload)
    plan["tileAssetsState"] = "existing" if can_reuse(store_listing_reuse, "tileAssets") else "missing"
    for field in (
        "selectableCategories",
        "selectedCategoryId",
        "selectedCategoryDisplayName",
        "storeListingReuse",
    ):
        plan.pop(field, None)
    listing_fields = {
        "description": "replace" if replacing_description else "reuse_existing",
        "tags": "replace" if replacing_tags else "reuse_existing",
        "category": "replace" if replacing_category else "reuse_existing",
        "localizations": ("reuse_existing" if can_reuse(store_listing_reuse, "localizations") else "missing"),
        "contentRating": "replace" if replacing_rating else "reuse_existing",
        "previewMedia": "replace" if replacing_preview else "reuse_existing",
    }
    plan.update(
        {
            "projectPath": project_path,
            "packageId": validate_package_id(payload.get("packageId")),
            "packageVersion": package_version,
            "lensName": validate_lens_name(payload.get("lensName")),
            "targetChannel": validate_target_channel(payload.get("targetChannel", "production")),
            "storeListing": {
                **({"source": store_listing_reuse["source"]} if store_listing_reuse["status"] == "available" else {}),
                "fields": listing_fields,
            },
            "previewMediaPlan": preview_plan,
            "previewMediaAssets": preview_assets,
            "tileAssets": normalize_tile_assets(payload.get("tileAssets", [])),
            "publishPlanConfirmed": False,
            "lensNameNeedsAssignment": lens_name_needs_assignment,
            "packageIdNeedsAssignment": package_id_assignment,
            "packageIdBeforeAssignment": package_id_before_assignment,
            "lensIconPlan": lens_icon_plan,
            "signingKeyPlan": signing_key_plan,
            "buildVersionPlan": build_version_plan,
            **({"releaseDescription": description} if description is not None else {}),
            **({"releaseTags": tags} if tags is not None else {}),
            **(
                {"category": {"id": category["id"], "displayName": category["displayName"]}}
                if category is not None
                else {}
            ),
            **({"contentRatingAssessment": assessment} if assessment is not None else {}),
            **optional_submission,
        }
    )
    return {
        "status": "PLAN_FROZEN",
        "stage": "publish_flow",
        "plan": plan,
        "planFingerprint": plan_fingerprint(plan),
        "selectableCategories": categories,
    }


def confirm_plan(payload: dict[str, Any]) -> dict[str, Any]:
    # Accept the complete PLAN_FROZEN result unchanged. This lets orchestration
    # persist one opaque value across the user-confirmation boundary instead of
    # rebuilding an input object from selected fields.
    plan = copy.deepcopy(require_object(payload.get("plan"), "plan"))
    expected = require_string(payload.get("planFingerprint"), "planFingerprint")
    actual = plan_fingerprint(plan)
    if actual != expected:
        raise FlowIssue(
            "publish_plan_changed",
            "The publish plan changed after it was frozen; rebuild the confirmation.",
            details={"expectedFingerprint": expected, "actualFingerprint": actual},
        )
    blockers = legal_confirmation_blockers(plan)
    if blockers:
        raise FlowIssue(
            "legal_documents_required",
            (
                "Provide the missing legal document links or text, or resolve failed "
                "hosting in Lens Settings, then review the updated confirmation."
            ),
            details={"documents": blockers},
        )
    plan["publishPlanConfirmed"] = True
    return {
        "status": "PLAN_CONFIRMED",
        "stage": "publish_flow",
        "confirmedPlan": plan,
        "planToken": actual,
    }


def verify_plan(payload: dict[str, Any]) -> dict[str, Any]:
    # Accept the complete PLAN_CONFIRMED result unchanged for the same reason as
    # confirm_plan: no model-authored reshaping is needed between phases.
    if payload.get("status") == "PLAN_CONFIRMED":
        plan = require_object(payload.get("confirmedPlan"), "confirmedPlan")
    else:
        plan = require_object(payload.get("plan"), "plan")
    token = require_string(payload.get("planToken"), "planToken")
    if plan.get("publishPlanConfirmed") is not True:
        raise FlowIssue("publish_plan_unconfirmed", "The frozen publish plan has not been confirmed.")
    actual = plan_fingerprint(plan)
    if actual != token:
        raise FlowIssue(
            "publish_plan_changed",
            "The confirmed publish plan changed; return to the consolidated confirmation.",
            details={"planToken": token, "actualFingerprint": actual},
        )
    return {"status": "PLAN_VERIFIED", "stage": "publish_flow", "planToken": token}


def local_file_identity(value: Any, field: str) -> tuple[str, int, str]:
    path_text = markdown_path(value, field)
    path = Path(path_text)
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
    except OSError as error:
        raise FlowIssue(
            "confirmation_asset_invalid",
            f"{field} is unavailable for the publish confirmation: {error}.",
        ) from error
    return base64.b64encode(digest.digest()).decode("ascii"), size, path_text


def rating_confirmation_lines(
    assessment: dict[str, str],
    evidence: list[str],
    coverage: list[str],
) -> list[str]:
    lines = ["### Content rating"]
    for section, questions in RATING_SECTIONS:
        rendered_questions: list[str] = []
        for field, label in questions:
            if field not in assessment:
                continue
            answer = assessment[field]
            display = SEVERITY_DISPLAY.get(answer, answer)
            rendered_questions.append(f"- {label}: **{display}**")
        if rendered_questions:
            lines.extend(["", f"**{section}**", "", *rendered_questions])
    if evidence:
        lines.extend(["", f"- **Content-rating rationale:** {'; '.join(evidence)}"])
    if coverage:
        lines.extend(["", f"- **Content-rating coverage:** {'; '.join(coverage)}"])
    return lines


def render_confirmation(payload: dict[str, Any]) -> dict[str, Any]:
    """Render the exact frozen plan and its locally verified presentation as one question."""
    frozen = require_object(payload.get("frozen"), "frozen")
    if frozen.get("status") != "PLAN_FROZEN" or frozen.get("stage") != "publish_flow":
        raise FlowIssue("confirmation_plan_invalid", "render-confirmation requires the complete PLAN_FROZEN result.")
    plan = require_object(frozen.get("plan"), "frozen.plan")
    expected_fingerprint = require_string(frozen.get("planFingerprint"), "frozen.planFingerprint")
    actual_fingerprint = plan_fingerprint(plan)
    if actual_fingerprint != expected_fingerprint:
        raise FlowIssue(
            "publish_plan_changed",
            "The frozen publish plan changed before confirmation rendering.",
        )

    presentation = require_object(payload.get("presentation"), "presentation")
    inline_supported = presentation.get("inlineRenderingSupported")
    if not isinstance(inline_supported, bool):
        raise FlowIssue(
            "confirmation_presentation_invalid",
            "presentation.inlineRenderingSupported must be a boolean.",
        )
    evidence = [
        markdown_text(item, "presentation.contentRatingEvidence[]")
        for item in require_string_list(
            presentation.get("contentRatingEvidence", []), "presentation.contentRatingEvidence"
        )
    ]
    rating_coverage = [
        markdown_text(item, "presentation.contentRatingCoverage[]")
        for item in require_string_list(
            presentation.get("contentRatingCoverage", []), "presentation.contentRatingCoverage"
        )
    ]
    moderation_coverage = [
        markdown_text(item, "presentation.moderationCoverage[]")
        for item in require_string_list(presentation.get("moderationCoverage", []), "presentation.moderationCoverage")
    ]
    findings_value = require_list(presentation.get("moderationFindings", []), "presentation.moderationFindings")
    findings: list[dict[str, str]] = []
    for index, value in enumerate(findings_value):
        finding = require_object(value, f"presentation.moderationFindings[{index}]")
        if set(finding) != {"category", "subject", "rationale"} or finding.get("category") not in MODERATION_CATEGORIES:
            raise FlowIssue(
                "confirmation_presentation_invalid",
                f"presentation.moderationFindings[{index}] is malformed.",
            )
        findings.append(
            {
                "category": finding["category"],
                "subject": markdown_text(finding.get("subject"), f"presentation.moderationFindings[{index}].subject"),
                "rationale": markdown_text(
                    finding.get("rationale"),
                    f"presentation.moderationFindings[{index}].rationale",
                ),
            }
        )

    lens_icon_plan = normalize_lens_icon_plan(plan.get("lensIconPlan"))
    lens_icon_path_value = presentation.get("lensIconPath")
    if lens_icon_plan["action"] == "generate_and_assign":
        expected_asset = lens_icon_plan["asset"]
        if lens_icon_path_value is not None and lens_icon_path_value != expected_asset["path"]:
            raise FlowIssue(
                "confirmation_asset_mismatch",
                "The Lens icon selected for presentation does not match the frozen generated icon.",
            )
        checksum, byte_count, lens_icon_path = local_file_identity(
            expected_asset["path"], "frozen.plan.lensIconPlan.asset.path"
        )
        if checksum != expected_asset["checksum"] or byte_count != expected_asset["bytes"]:
            raise FlowIssue(
                "confirmation_asset_mismatch",
                "The generated Lens icon changed after the plan was frozen.",
            )
    elif lens_icon_path_value is not None:
        _, _, lens_icon_path = local_file_identity(lens_icon_path_value, "presentation.lensIconPath")
    else:
        lens_icon_path = None

    attachments: list[dict[str, str]] = []
    if lens_icon_path:
        attachments.append({"role": "lens_icon", "label": "Lens icon", "path": lens_icon_path, "type": "image"})
    preview_assets = require_list(plan.get("previewMediaAssets"), "frozen.plan.previewMediaAssets")
    for index, value in enumerate(preview_assets):
        asset = require_object(value, f"frozen.plan.previewMediaAssets[{index}]")
        checksum, byte_count, path = local_file_identity(
            asset.get("path"),
            f"frozen.plan.previewMediaAssets[{index}].path",
        )
        if checksum != asset.get("checksum") or byte_count != asset.get("bytes"):
            raise FlowIssue(
                "confirmation_asset_mismatch",
                f"Preview media {index + 1} changed after the plan was frozen.",
            )
        attachments.append(
            {
                "role": "preview_media",
                "label": f"Preview media {index + 1}",
                "path": path,
                "type": require_string(asset.get("type"), f"frozen.plan.previewMediaAssets[{index}].type"),
            }
        )

    tile_assets = normalize_tile_assets(plan.get("tileAssets", []))
    for asset in tile_assets:
        checksum, count, path = local_file_identity(asset["path"], "tileAssets[].path")
        if checksum != asset["checksum"] or count != asset["bytes"]:
            raise FlowIssue("confirmation_asset_mismatch", "A store tile changed after the plan was frozen.")
        attachments.append(
            {"role": "store_tile", "label": TILE_LABELS[asset["tileType"]], "path": path, "type": "image"}
        )
    existing_tiles = plan.get("tileAssetsState") == "existing"

    preview_lines: list[str] = []
    if inline_supported and attachments:
        preview_lines.append("### Publish asset previews")
        icon_attachments = [item for item in attachments if item["role"] == "lens_icon"]
        media_attachments = [item for item in attachments if item["role"] == "preview_media"]
        preview_lines.extend(["", "**Lens icon**", ""])
        if icon_attachments:
            item = icon_attachments[0]
            preview_lines.append(f"![Lens icon](<{item['path']}>)")
        else:
            preview_lines.append("Use existing Lens icon.")
        tile_attachments = [item for item in attachments if item["role"] == "store_tile"]
        preview_lines.extend(["", "**Store tiles**", "", "Images used while browsing Lens Explorer and Discover", ""])
        for item in tile_attachments:
            preview_lines.extend([f"**{item['label']}**", "", f"![{item['label']}](<{item['path']}>)", ""])
        if not tile_attachments:
            preview_lines.append(
                "Reuse existing store tiles." if existing_tiles else "No store tiles available to preview."
            )
        preview_lines.extend(
            ["", "**Preview assets**", "", "Screenshots and videos shown on the lens details page", ""]
        )
        if media_attachments:
            preview_lines.extend(f"![{item['label']}](<{item['path']}>)" for item in media_attachments)
        else:
            preview_lines.append("Reuse existing preview assets.")

    store_listing = require_object(plan.get("storeListing"), "frozen.plan.storeListing")
    fields = require_object(store_listing.get("fields"), "frozen.plan.storeListing.fields")
    description = (
        markdown_text(plan.get("releaseDescription"), "frozen.plan.releaseDescription")
        if fields.get("description") == "replace"
        else "Use existing description"
    )
    tags = (
        ", ".join(
            markdown_text(tag, "frozen.plan.releaseTags[]")
            for tag in require_string_list(plan.get("releaseTags"), "frozen.plan.releaseTags")
        )
        if fields.get("tags") == "replace"
        else "Use existing tags"
    )
    category = (
        markdown_text(
            require_object(plan.get("category"), "frozen.plan.category").get("displayName"),
            "frozen.plan.category.displayName",
        )
        if fields.get("category") == "replace"
        else "Use existing category"
    )
    if not preview_assets:
        preview_label = "Use existing preview media"
    elif all(asset.get("source") == "auto_image" for asset in preview_assets):
        preview_label = "Use these Lens Studio Preview screenshots"
    elif all(asset.get("source") in {"auto_video", "auto_image"} for asset in preview_assets):
        preview_label = (
            "Use this staged auto-generated preview video (simulated Lens Studio preview footage) "
            "and these Lens Studio Preview screenshots"
        )
    else:
        preview_label = "Use supplied preview media"

    build_version_plan = normalize_build_version_plan(
        plan.get("buildVersionPlan"),
        project_path=require_string(plan.get("projectPath"), "frozen.plan.projectPath"),
        package_version=require_string(plan.get("packageVersion"), "frozen.plan.packageVersion"),
    )
    package_version_label = markdown_text(plan.get("packageVersion"), "frozen.plan.packageVersion")
    if build_version_plan["action"] == "assign":
        current_version_label = markdown_text(
            build_version_plan.get("currentBuildVersion") or "missing",
            "frozen.plan.buildVersionPlan.currentBuildVersion",
        )
        package_version_label += f" (update from {current_version_label} after confirmation)"

    package_id_label = markdown_text(plan.get("packageId"), "frozen.plan.packageId")
    if plan.get("packageIdNeedsAssignment") is True:
        previous_id = plan.get("packageIdBeforeAssignment", "")
        if previous_id:
            previous_label = markdown_text(previous_id, "frozen.plan.packageIdBeforeAssignment")
            package_id_label += f" (replace invalid ID {previous_label} after confirmation)"
        else:
            package_id_label += " (assign to this project after confirmation)"

    lines = [
        "## Ready to publish",
        "",
        "### Lens details",
        "",
        f"- Lens name: **{markdown_text(plan.get('lensName'), 'frozen.plan.lensName')}**",
        f"- Package ID: **{package_id_label}**",
        f"- Package build version: **{package_version_label}**",
        f"- Description: **{description}**",
        f"- Tags: **{tags}**",
        f"- Category: **{category}**",
    ]
    if "orgDisplayName" in plan:
        lines.append(f"- Organization: **{markdown_text(plan.get('orgDisplayName'), 'frozen.plan.orgDisplayName')}**")
    lines.extend(
        [
            "",
            "### Assets and submission",
            "",
            "- Lens icon: **"
            + (
                "Auto-generate and assign a new Lens icon (no custom Lens icon is currently set)"
                if lens_icon_plan["action"] == "generate_and_assign"
                else "Use existing Lens icon"
            )
            + "**",
        ]
    )
    if not inline_supported and lens_icon_path:
        icon_directory = markdown_code(str(Path(lens_icon_path).parent), "lens icon directory")
        lines.append(f"- Lens icon preview directory: {icon_directory}")
    lines.append(
        "- Store tiles: **"
        + (
            "Use the displayed primary image and crops"
            if tile_assets
            else "Reuse existing store tiles"
            if existing_tiles
            else "No store tiles"
        )
        + "**"
    )
    if not inline_supported:
        for item in attachments:
            if item["role"] == "store_tile":
                lines.append(f"- {item['label']}: <{item['path']}>")
    lines.append(f"- Preview assets: **{preview_label}**")
    if not inline_supported and preview_assets:
        directories = list(
            dict.fromkeys(str(Path(item["path"]).parent) for item in attachments if item["role"] == "preview_media")
        )
        lines.append(
            "- Preview media directory: "
            + ", ".join(markdown_code(directory, "preview media directory") for directory in directories)
        )
    signing_key_plan = normalize_signing_key_plan(plan.get("signingKeyPlan"))
    if signing_key_plan["action"] == "generate_and_assign":
        key_path = markdown_code(signing_key_plan["path"], "frozen.plan.signingKeyPlan.path")
        lines.append(
            "- Signing key: **Auto-generate and assign a new project signing key at** "
            f"{key_path} **(no key exists at this path)**"
        )
    target_channel = validate_target_channel(plan.get("targetChannel", "production"))
    lines.append(f"- Target channel: **{TARGET_CHANNEL_LABELS[target_channel]}**")
    if target_channel == "production":
        lines.append("- Action: **Submit this release for review**")
    else:
        lines.append(f"- Action: **Submit this release to the {TARGET_CHANNEL_LABELS[target_channel]} channel**")

    assessment_value = plan.get("contentRatingAssessment")
    if assessment_value is None:
        lines.extend(["", "- Content rating: **Use existing content rating**"])
    else:
        assessment = validate_content_rating(assessment_value)
        lines.extend(["", *rating_confirmation_lines(assessment, evidence, rating_coverage)])

    if findings or moderation_coverage:
        lines.extend(["", "### Review advisory", ""])
        for finding in findings:
            lines.append(
                f"- Moderation advisory: **{finding['category']}** — {finding['subject']}: {finding['rationale']}"
            )
        lines.extend(f"- Moderation coverage: {item}" for item in moderation_coverage)

    legal_context = plan.get("legalDocuments")
    legal_blockers = legal_confirmation_blockers(plan)
    if legal_context is not None:
        legal_context = normalize_legal_context(legal_context)
        inputs = normalize_legal_inputs(plan.get("legalDocumentInputs", {}))
        required = legal_context["requiredForPublicChannels"] and target_channel != "internal"
        if (
            target_channel == "internal"
            or required
            or inputs
            or any(d["status"] in {"pending", "failed"} for d in legal_context["documents"].values())
        ):
            lines.extend(["", "### Lens legal documents", ""])
            if target_channel == "internal":
                lines.append("- Requirement: **Not required for Internal.**")
            for kind, label in (("privacyPolicy", "Privacy Policy"), ("termsOfService", "Terms of Service")):
                doc = legal_context["documents"][kind]
                source = inputs.get(kind)
                if source:
                    if "url" in source:
                        detail = "Save supplied link: " + markdown_text(source["url"], "legal URL")
                    else:
                        text = source["text"]
                        detail = f"Save supplied text ({len(text)} characters): " + markdown_text(
                            text.strip()[:160], "legal text preview"
                        )
                    lines.append(f"- {label}: **{detail}**")
                elif doc["status"] == "missing" and required:
                    lines.append(f"- {label}: **Required — provide an HTTPS link or paste your plain text.**")
                elif doc["status"] != "missing":
                    lines.append(
                        f"- {label}: **"
                        + {
                            "ready": "Reuse existing Lens document",
                            "pending": "Hosting in progress; submission will wait",
                            "failed": "Hosting failed; resolve in Lens Settings",
                        }[doc["status"]]
                        + "**"
                    )
            if inputs:
                lines.append(
                    (
                        "Confirming authorizes saving these supplied documents for this "
                        "Lens across all versions and channels. Text hosting must finish before submission."
                    )
                )
            if legal_blockers:
                lines.append(
                    (
                        "Choose Edit and provide the missing links or text; the updated "
                        "plan must be confirmed before publishing."
                    )
                )

    options = [
        {
            "id": "confirm",
            "label": "1. Confirm and submit anyway" if findings else "1. Confirm and submit",
        },
        {"id": "edit", "label": "2. Edit"},
        {"id": "cancel", "label": "3. Cancel"},
    ]
    if legal_blockers:
        options = [option for option in options if option["id"] != "confirm"]
        options[0]["label"] = "1. Add legal documents / Edit"
        options[1]["label"] = "2. Cancel"
    confirmation = {
        "planFingerprint": expected_fingerprint,
        "previewMessageMarkdown": "\n".join(preview_lines),
        "confirmationMarkdown": "\n".join(lines),
        "options": options,
        "attachments": attachments if inline_supported else [],
        "retainedPaths": [item["path"] for item in attachments if not item["path"].startswith("https://")],
    }
    return {
        "status": "CONFIRMATION_READY",
        "stage": "publish_flow",
        "confirmation": {
            **confirmation,
            "confirmationToken": fingerprint(confirmation),
        },
    }


def package_authorize(payload: dict[str, Any]) -> dict[str, Any]:
    """Bind Package to both the confirmed plan and a successful version-policy check."""
    confirmed = require_object(payload.get("confirmed"), "confirmed")
    version_policy = require_object(payload.get("versionPolicy"), "versionPolicy")
    verified = verify_plan(confirmed)
    if version_policy.get("status") != "VERSION_POLICY_OK" or version_policy.get("stage") != "package_version_precheck":
        raise FlowIssue(
            "package_version_policy_unavailable",
            "Package requires a complete successful version-policy result.",
        )
    policy_token = version_policy.get("versionPolicyToken")
    policy_facts = copy.deepcopy(version_policy)
    policy_facts.pop("versionPolicyToken", None)
    if not isinstance(policy_token, str) or policy_token != fingerprint(policy_facts):
        raise FlowIssue(
            "package_version_policy_changed",
            "The successful version-policy result changed before Package.",
        )

    plan = require_object(confirmed.get("confirmedPlan"), "confirmed.confirmedPlan")
    package_id = require_string(plan.get("packageId"), "confirmed.confirmedPlan.packageId")
    package_version = require_string(plan.get("packageVersion"), "confirmed.confirmedPlan.packageVersion")
    lens_name = require_string(plan.get("lensName"), "confirmed.confirmedPlan.lensName")
    project_path = require_string(plan.get("projectPath"), "confirmed.confirmedPlan.projectPath")
    if version_policy.get("packageId") != package_id or version_policy.get("packageVersion") != package_version:
        raise FlowIssue(
            "package_authorization_mismatch",
            "The version-policy result does not match the confirmed package identity.",
            details={"packageId": package_id, "packageVersion": package_version},
        )

    authorization = {
        "planToken": verified["planToken"],
        "packageId": package_id,
        "packageVersion": package_version,
        "lensName": lens_name,
        "projectPath": project_path,
        "buildVersionMutation": normalize_build_version_plan(
            plan.get("buildVersionPlan"),
            project_path=project_path,
            package_version=package_version,
        ),
    }
    return {
        "status": "PACKAGE_AUTHORIZED",
        "stage": "publish_flow",
        "packageAuthorization": {
            **authorization,
            "authorizationToken": fingerprint(authorization),
        },
    }


def registration_begin(payload: dict[str, Any]) -> dict[str, Any]:
    existing = payload.get("existingState")
    ordinal = payload.get("attemptOrdinal")
    retry_reason = require_string(payload.get("retryReason"), "retryReason")
    request = require_object(payload.get("request"), "request")
    if not isinstance(ordinal, int) or ordinal < 1:
        raise FlowIssue("registration_state_invalid", "attemptOrdinal must be a positive integer.")
    if existing is None:
        if ordinal != 1 or retry_reason != "initial":
            raise FlowIssue(
                "registration_retry_invalid", "The first registration must be ordinal 1 with reason initial."
            )
    else:
        existing_state = require_object(existing, "existingState")
        if existing_state.get("state") not in {"started", "succeeded"}:
            raise FlowIssue("registration_state_invalid", "The existing registration state is malformed.")
        if retry_reason not in ALLOWED_REGISTRATION_RETRIES:
            raise FlowIssue(
                "registration_retry_invalid",
                "A consumed registration attempt may only use an explicit allowed retry reason.",
                details={"allowedRetryReasons": sorted(ALLOWED_REGISTRATION_RETRIES)},
            )
        if ordinal <= int(existing_state.get("attemptOrdinal", 0)):
            raise FlowIssue("registration_retry_invalid", "A retry must increment attemptOrdinal.")
    request_fingerprint = fingerprint(request)
    state = {
        "state": "started",
        "fingerprint": request_fingerprint,
        "attemptOrdinal": ordinal,
        "retryReason": retry_reason,
    }
    return {"status": "REGISTRATION_STARTED", "stage": "publish_flow", "registrationState": state}


def registration_authorize(payload: dict[str, Any]) -> dict[str, Any]:
    """Build and guard the exact registration request from opaque confirmed state."""
    confirmed = require_object(payload.get("confirmed"), "confirmed")
    verify_plan(confirmed)
    plan = require_object(confirmed.get("confirmedPlan"), "confirmed.confirmedPlan")

    package_result = require_object(payload.get("packageAuthorization"), "packageAuthorization")
    if package_result.get("status") != "PACKAGE_AUTHORIZED" or package_result.get("stage") != "publish_flow":
        raise FlowIssue(
            "package_authorization_invalid",
            "Registration requires the complete Package authorization result.",
        )
    package_authorization = require_object(
        package_result.get("packageAuthorization"),
        "packageAuthorization.packageAuthorization",
    )
    if set(package_authorization) != {
        "planToken",
        "projectPath",
        "packageId",
        "packageVersion",
        "lensName",
        "buildVersionMutation",
        "authorizationToken",
    }:
        raise FlowIssue("package_authorization_invalid", "The Package authorization shape is invalid.")
    authorization_identity = {
        "planToken": require_string(package_authorization.get("planToken"), "packageAuthorization.planToken"),
        "projectPath": require_string(package_authorization.get("projectPath"), "packageAuthorization.projectPath"),
        "packageId": require_string(package_authorization.get("packageId"), "packageAuthorization.packageId"),
        "packageVersion": require_string(
            package_authorization.get("packageVersion"),
            "packageAuthorization.packageVersion",
        ),
        "lensName": require_string(package_authorization.get("lensName"), "packageAuthorization.lensName"),
        "buildVersionMutation": normalize_build_version_plan(
            package_authorization.get("buildVersionMutation"),
            project_path=require_string(
                package_authorization.get("projectPath"),
                "packageAuthorization.projectPath",
            ),
            package_version=require_string(
                package_authorization.get("packageVersion"),
                "packageAuthorization.packageVersion",
            ),
        ),
    }
    if package_authorization.get("authorizationToken") != fingerprint(authorization_identity):
        raise FlowIssue(
            "package_authorization_invalid",
            "The Package authorization changed before registration.",
        )
    expected_identity = {
        "planToken": confirmed.get("planToken"),
        "projectPath": plan.get("projectPath"),
        "packageId": plan.get("packageId"),
        "packageVersion": plan.get("packageVersion"),
        "lensName": plan.get("lensName"),
        "buildVersionMutation": normalize_build_version_plan(
            plan.get("buildVersionPlan"),
            project_path=require_string(plan.get("projectPath"), "confirmed.confirmedPlan.projectPath"),
            package_version=require_string(plan.get("packageVersion"), "confirmed.confirmedPlan.packageVersion"),
        ),
    }
    if authorization_identity != expected_identity:
        raise FlowIssue(
            "package_authorization_mismatch",
            "The Package authorization does not match the confirmed plan.",
        )

    spk_path = require_string(payload.get("spkPath"), "spkPath")
    spk_checksum = validate_checksum(payload.get("spkChecksum"), "spkChecksum")
    body: dict[str, Any] = {
        "pkgId": require_string(plan.get("packageId"), "confirmed.confirmedPlan.packageId"),
        "name": require_string(plan.get("lensName"), "confirmed.confirmedPlan.lensName"),
        "spkChecksum": spk_checksum,
    }
    if "releaseDescription" in plan:
        body["description"] = plan["releaseDescription"]
    if "releaseTags" in plan:
        body["tags"] = plan["releaseTags"]
    category = plan.get("category")
    if isinstance(category, dict):
        body["categoryId"] = require_string(category.get("id"), "confirmed.confirmedPlan.category.id")
    for optional in ("orgId", "semanticVersion"):
        if optional in plan:
            body[optional] = require_string(plan.get(optional), f"confirmed.confirmedPlan.{optional}")

    tenant_id = body.get("orgId", "")
    request = {
        "method": "POST",
        "path": "/lenses/publish",
        "tenantId": tenant_id,
        "body": body,
    }
    started = registration_begin(
        {
            "existingState": payload.get("existingState"),
            "attemptOrdinal": payload.get("attemptOrdinal"),
            "retryReason": payload.get("retryReason"),
            "request": request,
        }
    )
    authorization = {
        "request": request,
        "registrationState": started["registrationState"],
        "planToken": confirmed["planToken"],
        "packageAuthorizationToken": package_authorization["authorizationToken"],
        "spkPath": spk_path,
        "spkChecksum": spk_checksum,
        "previewAssets": copy.deepcopy(plan.get("previewMediaAssets", [])),
        "tileAssets": normalize_tile_assets(plan.get("tileAssets", [])),
    }
    return {
        "status": "REGISTRATION_AUTHORIZED",
        "stage": "publish_flow",
        "registrationAuthorization": {
            **authorization,
            "authorizationToken": fingerprint(authorization),
        },
    }


def registration_succeed(payload: dict[str, Any]) -> dict[str, Any]:
    state_value = payload.get("registrationState")
    if state_value is None and isinstance(payload.get("started"), dict):
        state_value = payload["started"].get("registrationState")
    state = copy.deepcopy(require_object(state_value, "registrationState"))
    result = require_object(payload.get("result"), "result")
    if state.get("state") != "started":
        raise FlowIssue("registration_state_invalid", "Only a started registration can succeed.")
    if result.get("status") != "AUTHORIZED_POST_OK":
        raise FlowIssue(
            "registration_result_invalid",
            "A registration attempt may succeed only after AUTHORIZED_POST_OK.",
        )
    data = require_object(result.get("data"), "result.data")
    for field in ("lensId", "releaseId"):
        require_string(data.get(field), f"result.data.{field}")
    state.update({"state": "succeeded", "result": result})
    return {
        "status": "REGISTRATION_SUCCEEDED",
        "stage": "publish_flow",
        "registrationState": state,
    }


def finalize_authorize(payload: dict[str, Any]) -> dict[str, Any]:
    """Bind Finalize configuration to the confirmed plan and actual registration result."""
    confirmed = require_object(payload.get("confirmed"), "confirmed")
    verify_plan(confirmed)
    plan = require_object(confirmed.get("confirmedPlan"), "confirmed.confirmedPlan")

    registration_result = require_object(
        payload.get("registrationAuthorization"),
        "registrationAuthorization",
    )
    if (
        registration_result.get("status") != "REGISTRATION_AUTHORIZED"
        or registration_result.get("stage") != "publish_flow"
    ):
        raise FlowIssue(
            "registration_authorization_invalid",
            "Finalize requires the complete registration authorization result.",
        )
    registration_authorization = require_object(
        registration_result.get("registrationAuthorization"),
        "registrationAuthorization.registrationAuthorization",
    )
    expected_registration_fields = {
        "request",
        "registrationState",
        "planToken",
        "packageAuthorizationToken",
        "spkPath",
        "spkChecksum",
        "previewAssets",
        "tileAssets",
        "authorizationToken",
    }
    if set(registration_authorization) != expected_registration_fields:
        raise FlowIssue(
            "registration_authorization_invalid",
            "The registration authorization shape is invalid.",
        )
    authorization_facts = copy.deepcopy(registration_authorization)
    registration_token = authorization_facts.pop("authorizationToken", None)
    if not isinstance(registration_token, str) or registration_token != fingerprint(authorization_facts):
        raise FlowIssue(
            "registration_authorization_invalid",
            "The registration authorization changed before Finalize.",
        )
    if registration_authorization.get("planToken") != confirmed.get("planToken"):
        raise FlowIssue(
            "registration_authorization_mismatch",
            "The registration authorization does not match the confirmed plan.",
        )
    for token_name in ("planToken", "packageAuthorizationToken"):
        token = registration_authorization.get(token_name)
        if (
            not isinstance(token, str)
            or len(token) != 64
            or any(character not in "0123456789abcdef" for character in token)
        ):
            raise FlowIssue(
                "registration_authorization_invalid",
                f"The registration authorization {token_name} is malformed.",
            )

    registered = require_object(payload.get("registered"), "registered")
    if registered.get("status") != "REGISTERED_AND_UPLOADED" or registered.get("stage") != "register":
        raise FlowIssue(
            "registration_result_invalid",
            "Finalize requires the complete REGISTERED_AND_UPLOADED result.",
        )
    expected_tokens = {
        "planToken": registration_authorization.get("planToken"),
        "packageAuthorizationToken": registration_authorization.get("packageAuthorizationToken"),
        "registrationAuthorizationToken": registration_token,
    }
    if any(registered.get(name) != token for name, token in expected_tokens.items()):
        raise FlowIssue(
            "registration_result_mismatch",
            "The registration result does not match its deterministic authorization.",
        )

    confirmed_assets = require_list(plan.get("previewMediaAssets"), "confirmed.confirmedPlan.previewMediaAssets")
    preview_uploads = require_list(registered.get("previewUploads"), "registered.previewUploads")
    expected_previews: dict[int, str] = {}
    for asset in confirmed_assets:
        item = require_object(asset, "confirmed.confirmedPlan.previewMediaAssets[]")
        index = item.get("previewIndex")
        media_type = item.get("type")
        if not isinstance(index, int) or media_type not in {"image", "video"} or index in expected_previews:
            raise FlowIssue("invalid_preview_media", "Confirmed preview assets are malformed.")
        expected_previews[index] = media_type
    actual_previews: dict[int, str] = {}
    for upload in preview_uploads:
        item = require_object(upload, "registered.previewUploads[]")
        index = item.get("previewIndex")
        media_type = item.get("type")
        require_string(item.get("url"), "registered.previewUploads[].url")
        if not isinstance(index, int) or media_type not in {"image", "video"} or index in actual_previews:
            raise FlowIssue("registration_result_invalid", "Registered preview uploads are malformed.")
        actual_previews[index] = media_type
    if actual_previews != expected_previews:
        raise FlowIssue(
            "registration_result_mismatch",
            "Registered preview uploads do not match the confirmed replacement set.",
        )

    tile_uploads = normalize_tile_uploads(registered.get("tileUploads", []))
    expected_tiles = normalize_tile_assets(plan.get("tileAssets", []))
    if {a["tileType"] for a in tile_uploads} != {a["tileType"] for a in expected_tiles}:
        raise FlowIssue("registration_result_mismatch", "Uploaded store tiles do not match the confirmed set.")

    assessment = plan.get("contentRatingAssessment")
    normalized_assessment = validate_content_rating(assessment) if assessment is not None else {}

    authorization = {
        "lensId": require_string(registered.get("lensId"), "registered.lensId"),
        "releaseId": require_string(registered.get("releaseId"), "registered.releaseId"),
        "tenantId": (require_string(plan.get("orgId"), "confirmed.confirmedPlan.orgId") if "orgId" in plan else ""),
        "submitStatePath": require_string(payload.get("submitStatePath"), "submitStatePath"),
        "targetChannel": validate_target_channel(plan.get("targetChannel", "production")),
        "contentRatingAssessment": normalized_assessment,
        "previewUploads": copy.deepcopy(preview_uploads),
        "tileUploads": tile_uploads,
        "legalDocumentInputs": normalize_legal_inputs(plan.get("legalDocumentInputs", {})),
        **expected_tokens,
    }
    return {
        "status": "FINALIZE_AUTHORIZED",
        "stage": "publish_flow",
        "finalizeAuthorization": {
            **authorization,
            "authorizationToken": fingerprint(authorization),
        },
    }


LEGAL_DOCUMENT_TYPES = ("privacyPolicy", "termsOfService")
LEGAL_DOCUMENT_RETRY = "legal_documents_corrected"


def legal_documents_check(payload: dict[str, Any]) -> dict[str, Any]:
    """Check Lens-level sources, not release fields or legacy tenant classifications."""
    channel = validate_target_channel(payload.get("targetChannel"))
    response = require_object(payload.get("response"), "response")
    unavailable = {
        "status": "ACTION_REQUIRED",
        "stage": "finalize",
        "reason": "legal_documents_unavailable",
        "message": "Could not verify Lens legal documents. Check access to Lens Settings and retry Finalize.",
    }
    data = response.get("data")
    if response.get("httpStatus") != 200 or not isinstance(data, dict):
        return {**unavailable, "httpStatus": response.get("httpStatus")}
    if not isinstance(data.get("legalDocumentsRequired"), bool):
        return unavailable
    documents = data.get("documents", {})
    active = data.get("activeDocuments", {})
    if not isinstance(documents, dict) or not isinstance(active, dict):
        return unavailable
    required = channel != "internal" and data["legalDocumentsRequired"]
    missing = [kind for kind in LEGAL_DOCUMENT_TYPES if kind not in documents] if required else []
    pending, failed = [], []
    for kind, document in documents.items():
        if not isinstance(document, dict) or document.get("documentType") != kind:
            return unavailable
        revision = document.get("revisionId")
        source = document.get("source")
        if not isinstance(revision, str) or not revision or not isinstance(source, dict):
            return unavailable
        if set(source) not in ({"url"}, {"text"}):
            return unavailable
        value = next(iter(source.values()))
        if not isinstance(value, str) or not value.strip():
            return unavailable
        if "text" in source:
            if document.get("hostingStatus") == "failed":
                failed.append(kind)
                continue
            if document.get("hostingStatus") == "pending":
                pending.append(kind)
                continue
            if document.get("hostingStatus") != "ready":
                return unavailable
        url = document.get("publicUrl")
        if not isinstance(url, str) or not url.startswith("https://"):
            return unavailable
        current = active.get(kind, {})
        if not isinstance(current, dict):
            return unavailable
        # A ready revision may be read just after the older active snapshot.
        if current.get("revisionId") != revision or current.get("publicUrl") != url:
            pending.append(kind)
    details = {"missingDocuments": missing, "pendingDocuments": pending, "failedDocuments": failed}
    if missing or failed:
        return {
            "status": "ACTION_REQUIRED",
            "stage": "finalize",
            "reason": "legal_documents_required",
            "message": "Open Lens Settings → Legal documents. Add the missing Privacy Policy / Terms of Service "
            "or fix failed text hosting, then retry Finalize with this session.",
            "details": details,
        }
    if pending:
        return {
            "status": "LEGAL_DOCUMENTS_PENDING",
            "stage": "finalize",
            "reason": "legal_documents_pending",
            "message": "Saved legal documents are still being hosted or activated.",
            "retryAfterSeconds": 3,
            "details": details,
        }
    return {"status": "LEGAL_DOCUMENTS_READY", "stage": "finalize"}


def legal_documents_updates(payload: dict[str, Any]) -> dict[str, Any]:
    inputs = normalize_legal_inputs(payload.get("legalDocumentInputs", {}))
    response = require_object(payload.get("response"), "response")
    data = response.get("data")
    if (
        response.get("httpStatus") != 200
        or not isinstance(data, dict)
        or type(data.get("legalDocumentsRequired")) is not bool
    ):
        raise FlowIssue("legal_documents_unavailable", "Could not read current Lens documents before saving.")
    documents = require_object(data.get("documents", {}), "response.documents")
    updates = []
    for kind, source in inputs.items():
        current = documents.get(kind)
        if current is not None:
            current = require_object(current, "saved legal document")
            if current.get("source") == source:
                continue  # An earlier save may have succeeded even if its response was lost.
            raise FlowIssue(
                "legal_document_changed",
                (
                    "A Lens document was saved after confirmation. Review Lens Settings; "
                    "no existing document was overwritten."
                ),
            )
        updates.append({"documentType": kind, "expectedRevisionId": "", "source": source})
    return {"status": "LEGAL_DOCUMENT_UPDATES_READY", "updates": updates}


def submit_reject_legal_documents(payload: dict[str, Any]) -> dict[str, Any]:
    """Only a recognized backend rejection proves this submit did not land."""
    response = require_object(payload.get("response"), "response")
    data = response.get("data")
    message = data.get("message") if isinstance(data, dict) else None
    # Match the backend's exact wording; translate the Settings label only for display below.
    expected = (
        "[failed_precondition] Privacy Policy and Terms of Service must both be saved and ready. "
        "Add missing documents in App Settings."
    )
    pending = (
        r"\[failed_precondition\] Legal document [A-Za-z][A-Za-z0-9]* is missing or not ready\. "
        r"Check App Settings and wait for text hosting to finish\."
    )
    if (
        response.get("httpStatus") != 400
        or not isinstance(data, dict)
        or data.get("code") != "GRPC_ERROR"
        or not isinstance(message, str)
        or not (message == expected or re.fullmatch(pending, message))
    ):
        return {"status": "NOT_LEGAL_DOCUMENT_REJECTION", "stage": "finalize"}
    state = copy.deepcopy(require_object(payload.get("submitState"), "submitState"))
    if state.get("state") != "started":
        raise FlowIssue("submit_state_invalid", "Only a started submit can be rejected.")
    state["nextRetryReason"] = LEGAL_DOCUMENT_RETRY
    return {
        "status": "ACTION_REQUIRED",
        "stage": "finalize",
        "reason": "legal_documents_required",
        "message": message.replace("App Settings", "Lens Settings")
        + " Retry Finalize after correcting the Lens documents; keep the existing release.",
        "submitState": state,
    }


ALLOWED_SUBMIT_RETRIES = {
    # A submitted release stops being readable at /apps/{lensId}/versions/{releaseId} — it
    # returns 404 "Version not found" (observed 2026-07-29). A retry is safe only when the
    # release provably was not submitted: either the POST did not land, or the backend explicitly
    # returned the non-terminal `validating` status.
    "submit_transport_failed",
    LEGAL_DOCUMENT_RETRY,
    "submit_returned_retryable_status",
}


def submit_begin(payload: dict[str, Any]) -> dict[str, Any]:
    """Open the at-most-once submit transition. Mirrors registration_begin deliberately."""
    existing = payload.get("existingState")
    ordinal = payload.get("attemptOrdinal")
    retry_reason = require_string(payload.get("retryReason"), "retryReason")
    request = require_object(payload.get("request"), "request")
    lens_id = require_string(payload.get("lensId"), "lensId")
    release_id = require_string(payload.get("releaseId"), "releaseId")
    target_channel = validate_target_channel(
        require_object(request.get("body"), "request.body").get("targetChannel", "production")
    )
    if not isinstance(ordinal, int) or ordinal < 1:
        raise FlowIssue("submit_state_invalid", "attemptOrdinal must be a positive integer.")
    if existing is None:
        if ordinal != 1 or retry_reason != "initial":
            raise FlowIssue("submit_retry_invalid", "The first submit must be ordinal 1 with reason initial.")
    else:
        existing_state = require_object(existing, "existingState")
        if existing_state.get("state") == "succeeded":
            raise FlowIssue(
                "already_submitted",
                "This release was already submitted; a submitted release cannot be re-submitted.",
                details={"lensId": existing_state.get("lensId"), "releaseId": existing_state.get("releaseId")},
            )
        if existing_state.get("state") != "started":
            raise FlowIssue("submit_state_invalid", "The existing submit state is malformed.")
        if existing_state.get("lensId") != lens_id or existing_state.get("releaseId") != release_id:
            raise FlowIssue("submit_state_invalid", "The existing submit state belongs to a different release.")
        if existing_state.get("targetChannel", "production") != target_channel:
            raise FlowIssue("submit_state_invalid", "The target channel cannot change during a submit retry.")
        if retry_reason not in ALLOWED_SUBMIT_RETRIES:
            raise FlowIssue(
                "submit_retry_invalid",
                "A consumed submit attempt may only be retried when the release provably was not submitted.",
                details={"allowedRetryReasons": sorted(ALLOWED_SUBMIT_RETRIES)},
            )
        expected_retry_reason = existing_state.get("nextRetryReason")
        if retry_reason == LEGAL_DOCUMENT_RETRY and expected_retry_reason != LEGAL_DOCUMENT_RETRY:
            raise FlowIssue("submit_retry_invalid", "A legal-document retry needs a persisted backend rejection.")
        if isinstance(expected_retry_reason, str) and retry_reason != expected_retry_reason:
            raise FlowIssue(
                "submit_retry_invalid",
                f"This submit attempt must be retried with reason {expected_retry_reason!r}.",
                details={"expectedRetryReason": expected_retry_reason},
            )
        if ordinal <= int(existing_state.get("attemptOrdinal", 0)):
            raise FlowIssue("submit_retry_invalid", "A retry must increment attemptOrdinal.")
    return {
        "status": "SUBMIT_STARTED",
        "stage": "publish_flow",
        "submitState": {
            "state": "started",
            "fingerprint": fingerprint(request),
            "attemptOrdinal": ordinal,
            "retryReason": retry_reason,
            "lensId": lens_id,
            "releaseId": release_id,
            "targetChannel": target_channel,
        },
    }


def submit_succeed(payload: dict[str, Any]) -> dict[str, Any]:
    state = copy.deepcopy(require_object(payload.get("submitState"), "submitState"))
    result = require_object(payload.get("result"), "result")
    if state.get("state") != "started":
        raise FlowIssue("submit_state_invalid", "Only a started submit can succeed.")
    data = require_object(result.get("data"), "result.data")
    target_channel = validate_target_channel(state.get("targetChannel", "production"))
    # Older production responses omitted the channel. Non-production submissions must
    # echo it so a backend that ignores targetChannel cannot be reported as success.
    if data.get("targetChannel", "production") != target_channel:
        raise FlowIssue("submit_result_invalid", "The submit response does not match the confirmed target channel.")
    status = require_string(data.get("status"), "result.data.status")
    if status not in {"submitted", "validating"}:
        raise FlowIssue(
            "submit_result_invalid",
            f"A submit may succeed only on a submitted or validating status, not {status!r}.",
        )
    if status == "validating":
        state.update({"result": result, "nextRetryReason": "submit_returned_retryable_status"})
        return {
            "status": "SUBMIT_PENDING",
            "stage": "publish_flow",
            "submitState": state,
            "backendStatus": status,
        }
    state.update({"state": "succeeded", "result": result})
    return {"status": "SUBMIT_SUCCEEDED", "stage": "publish_flow", "submitState": state, "backendStatus": status}


def next_versions(version: tuple[int, int, int]) -> dict[str, str]:
    major, minor, patch = version
    suggestions: dict[str, str] = {}
    if patch < MAX_VERSION_COMPONENT:
        suggestions["patch"] = f"{major}.{minor}.{patch + 1}"
    if minor < MAX_VERSION_COMPONENT:
        suggestions["minor"] = f"{major}.{minor + 1}.0"
    if major < MAX_VERSION_COMPONENT:
        suggestions["major"] = f"{major + 1}.0.0"
    return suggestions


def immediate_next_version(version: tuple[int, int, int]) -> tuple[int, int, int] | None:
    major, minor, patch = version
    if patch < MAX_VERSION_COMPONENT:
        return major, minor, patch + 1
    if minor < MAX_VERSION_COMPONENT:
        return major, minor + 1, 0
    if major < MAX_VERSION_COMPONENT:
        return major + 1, 0, 0
    return None


def availability_version_guard(
    payload: dict[str, Any],
    package_text: str,
) -> dict[str, Any]:
    response = require_object(payload.get("availabilityResponse"), "availabilityResponse")
    if "canSubmit" not in response or "checks" not in response:
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability API did not return package build-version checks.",
        )
    can_submit = response.get("canSubmit")
    if not isinstance(can_submit, bool):
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response has an invalid canSubmit value.",
        )
    checks = require_object(response.get("checks"), "availabilityResponse.checks")
    package_check = require_object(checks.get("pkgId"), "availabilityResponse.checks.pkgId")
    version_check = require_object(
        checks.get("pkgBuildVersion"),
        "availabilityResponse.checks.pkgBuildVersion",
    )
    package_id = require_string(payload.get("packageId"), "packageId")
    if package_check.get("value") != package_id or version_check.get("value") != package_text:
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response does not match the requested package identity.",
            details={
                "expectedPackageId": package_id,
                "expectedPackageVersion": package_text,
            },
        )
    package_valid = package_check.get("valid")
    version_valid = version_check.get("valid")
    package_reason = package_check.get("reason")
    version_reason = version_check.get("reason")
    if not isinstance(package_valid, bool) or not isinstance(version_valid, bool):
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response has invalid check results.",
        )
    if package_valid and package_reason not in {"AVAILABLE", "EXISTS"}:
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response has an inconsistent package check.",
        )
    if not package_valid:
        raise FlowIssue(
            "PKG_ID_UNAVAILABLE",
            require_string(package_check.get("detail"), "availabilityResponse.checks.pkgId.detail"),
            details={
                "packageId": package_id,
                "packageReason": package_reason,
            },
        )
    details_value = version_check.get("details", {})
    details = require_object(details_value, "availabilityResponse.checks.pkgBuildVersion.details")
    latest_text = details.get("latestPkgBuildVersion")
    next_text = details.get("nextAvailablePkgBuildVersion")
    latest_version = None
    next_version = None
    if latest_text is not None:
        latest_version = parse_version(latest_text, "latestPkgBuildVersion")
    if next_text is not None:
        next_version = parse_version(next_text, "nextAvailablePkgBuildVersion")
    if next_version is not None and latest_version is None:
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response includes a successor without a latest released version.",
        )
    if (
        latest_version is not None
        and next_version is not None
        and next_version != immediate_next_version(latest_version)
    ):
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response has inconsistent released-version facts.",
        )
    if can_submit:
        if not version_valid or version_reason not in {"NO_PRIOR_VERSION", "INCREMENTED"}:
            raise FlowIssue(
                "package_version_policy_unavailable",
                "The availability response has an inconsistent successful version check.",
            )
        if version_reason == "NO_PRIOR_VERSION" and latest_text is not None:
            raise FlowIssue(
                "package_version_policy_unavailable",
                "A no-prior-version response unexpectedly includes a released version.",
            )
        if version_reason == "INCREMENTED":
            if latest_version is None or parse_version(package_text) <= latest_version:
                raise FlowIssue(
                    "package_version_policy_unavailable",
                    "The availability response has inconsistent incremented-version facts.",
                )
        result = {
            "status": "VERSION_POLICY_OK",
            "stage": "package_version_precheck",
            "packageId": package_id,
            "packageVersion": package_text,
            "coverage": "availability_api",
            "versionReason": version_reason,
            **({"publishedBuildVersionFloor": latest_text} if latest_text is not None else {}),
            **({"nextAvailablePkgBuildVersion": next_text} if next_text is not None else {}),
        }
        return {**result, "versionPolicyToken": fingerprint(result)}
    if version_valid:
        raise FlowIssue(
            "package_version_policy_unavailable",
            "The availability response rejects submission despite a valid version check.",
        )
    if version_reason == "NOT_INCREMENTED":
        if latest_text is None:
            raise FlowIssue(
                "package_version_policy_unavailable",
                "The non-incremented response omits the latest released version.",
            )
        candidate_version = parse_version(package_text)
        if latest_version is None or candidate_version > latest_version:
            raise FlowIssue(
                "package_version_policy_unavailable",
                "The availability response rejects a build version that is already above its released-version floor.",
            )
        if next_version is not None and next_version <= candidate_version:
            raise FlowIssue(
                "package_version_policy_unavailable",
                "The availability response suggests a build version that does not increase the current value.",
            )
        raise FlowIssue(
            "SPK_BUILD_VERSION_NOT_INCREMENTED",
            require_string(
                version_check.get("detail"),
                "availabilityResponse.checks.pkgBuildVersion.detail",
            ),
            details={
                "packageVersion": package_text,
                "publishedBuildVersionFloor": latest_text,
                "suggestions": (
                    {"nextAvailable": next_text} if next_text is not None else next_versions(latest_version)
                ),
            },
        )
    if version_reason == "INVALID_FORMAT":
        raise FlowIssue(
            "invalid_package_version",
            require_string(
                version_check.get("detail"),
                "availabilityResponse.checks.pkgBuildVersion.detail",
            ),
        )
    raise FlowIssue(
        "package_version_policy_unavailable",
        "The availability API did not complete the package build-version check.",
        details={"versionReason": version_reason},
    )


def version_guard(payload: dict[str, Any]) -> dict[str, Any]:
    package_text = require_string(payload.get("packageVersion"), "packageVersion")
    parse_version(package_text)
    return availability_version_guard(payload, package_text)


def rebuild_upload_manifest(payload: dict[str, Any]) -> dict[str, Any]:
    """Rebuild the upload manifest from a stored REGISTRATION_SUCCEEDED state.

    The manifest carries presigned URLs, so it is never written to a file and is piped straight from
    `register.ts` into `upload-all.py`. That makes it easy to lose: a real run split register and
    upload across scopes, dropped the value, and stopped — reading the at-most-once registration rule
    as a reason it could not continue.

    It does not have to stop. The backend's registration response is retained inside the state the
    skill already requires storing, so the SnapOS Package target is recoverable from it verbatim. The
    preview targets are not a create — repeating `/apps/upload` only mints another signed URL — so the
    caller re-mints those and passes them in. Nothing here re-POSTs `/lenses/publish`, so no second
    release can be created.

    Input keys:
      `registrationState` (or the complete REGISTRATION_SUCCEEDED result), `spkPath`, `spkChecksum`,
      and optional `previewTargets` = [{previewIndex, type, path, checksum, url, headers}].
    """
    state_value = payload.get("registrationState")
    if state_value is None and isinstance(payload.get("result"), dict):
        state_value = payload["result"].get("registrationState")
    state = require_object(state_value, "registrationState")
    if state.get("state") != "succeeded":
        raise FlowIssue(
            "registration_state_invalid",
            "Only a succeeded registration carries upload targets; a started state has none.",
        )
    data = require_object(require_object(state.get("result"), "registrationState.result").get("data"), "result.data")
    lens_id = require_string(data.get("lensId"), "result.data.lensId")
    release_id = require_string(data.get("releaseId"), "result.data.releaseId")
    spk_target = require_object(
        (data.get("uploads") or {}).get("spk"),
        "result.data.uploads.spk",
    )
    spk_url = require_string(spk_target.get("url"), "result.data.uploads.spk.url")

    uploads: list[dict[str, Any]] = [
        {
            "label": "spk",
            "filePath": require_string(payload.get("spkPath"), "spkPath"),
            "url": spk_url,
            "headers": spk_target.get("headers") or {},
            "checksum": validate_checksum(payload.get("spkChecksum"), "spkChecksum"),
        }
    ]

    seen_indexes: set[int] = set()
    # Optional, but a present non-list must be refused before it reaches enumerate(). An int or bool
    # raises TypeError, which escapes FlowIssue handling and breaks this script's one-JSON-object
    # contract; a string or dict quietly iterates characters or keys and then complains about
    # "previewTargets[0]", pointing at the wrong thing entirely.
    raw_targets = payload.get("previewTargets")
    preview_targets = [] if raw_targets is None else require_list(raw_targets, "previewTargets")
    for position, entry_value in enumerate(preview_targets):
        entry = require_object(entry_value, f"previewTargets[{position}]")
        preview_index = entry.get("previewIndex")
        if not isinstance(preview_index, int) or preview_index < 0:
            raise FlowIssue(
                "invalid_preview_media", f"previewTargets[{position}].previewIndex must be a non-negative integer."
            )
        if preview_index in seen_indexes:
            raise FlowIssue("invalid_preview_media", f"previewIndex {preview_index} appears twice.")
        seen_indexes.add(preview_index)
        uploads.append(
            {
                "label": f"preview:{preview_index}",
                "filePath": require_string(entry.get("path"), f"previewTargets[{position}].path"),
                "url": require_string(entry.get("url"), f"previewTargets[{position}].url"),
                "headers": entry.get("headers") or {},
                "checksum": validate_checksum(entry.get("checksum"), f"previewTargets[{position}].checksum"),
            }
        )

    return {
        "status": "UPLOAD_MANIFEST_READY",
        "stage": "publish_flow",
        "lensId": lens_id,
        "releaseId": release_id,
        # The caller applies the same near-expiry rule as after a fresh registration; this operation
        # deliberately does not read the clock, so its result stays reproducible.
        "uploadExpiresAt": spk_target.get("expiresAt"),
        "previewCount": len(seen_indexes),
        "uploadManifest": {"uploads": uploads},
    }


# SPECS signs the declared type into the presigned PUT, so S3 rejects any other Content-Type.
UPLOAD_MIME_TYPES = {
    ".png": ("image", "image/png"),
    ".jpg": ("image", "image/jpeg"),
    ".jpeg": ("image", "image/jpeg"),
    ".webp": ("image", "image/webp"),
    ".mp4": ("video", "video/mp4"),
    ".mov": ("video", "video/quicktime"),
    ".webm": ("video", "video/webm"),
}


def upload_suffixes(media: str) -> tuple[str, ...]:
    """Extensions SPECS accepts for an image or video upload."""
    return tuple(suffix for suffix, (kind, _) in UPLOAD_MIME_TYPES.items() if kind == media)


def upload_mime_type(path_value: Any, file_type: str, *, reason: str = "invalid_preview_media") -> str:
    path = require_string(path_value, "path")
    suffix = Path(path).suffix.lower()
    media, mime_type = UPLOAD_MIME_TYPES.get(suffix, (None, None))
    if media is None:
        allowed = ", ".join(upload_suffixes(file_type)) or ", ".join(UPLOAD_MIME_TYPES)
        found = repr(suffix) if suffix else "no extension"
        raise FlowIssue(reason, f"path must end in one of {allowed}, not {found}.")
    if media != file_type:
        raise FlowIssue(reason, f"path ends in {suffix}, which is {media}, but fileType is {file_type}.")
    return mime_type


def preview_upload_body(payload: dict[str, Any]) -> dict[str, Any]:
    file_type = payload.get("fileType")
    if file_type in (None, ""):
        # Distinguish absent from wrong. A confirmed plan carries this as `type`, and passing the plan
        # through unchanged used to yield an empty string here, whose only symptom was a generic "must
        # be image or video" — pointing at the value rather than at the missing key.
        raise FlowIssue(
            "invalid_preview_media",
            "fileType is missing. Set it to image or video; a confirmed plan carries it as `type`.",
        )
    if file_type not in {"image", "video"}:
        raise FlowIssue("invalid_preview_media", f"fileType must be image or video, not {file_type!r}.")
    preview_index = payload.get("previewIndex")
    if not isinstance(preview_index, int) or preview_index < 0:
        raise FlowIssue("invalid_preview_media", "previewIndex must be a non-negative integer.")
    body = {
        "appId": require_string(payload.get("appId"), "appId"),
        "versionId": require_string(payload.get("versionId"), "versionId"),
        "contentType": "prv",
        "expireIn": 3600,
        "checksum": validate_checksum(payload.get("checksum"), "checksum"),
        "checksumAlgo": "SHA256",
        "previewIndex": preview_index,
        "fileType": file_type,
        "mimeType": upload_mime_type(payload.get("path"), file_type),
    }
    # Return the uniform request envelope. The flat requestMethod/requestPath/body keys
    # stay for compatibility with callers written against the older shape.
    return {
        "status": "REQUEST_READY",
        "stage": "publish_flow",
        "request": {
            "method": "POST",
            "path": "/apps/upload",
            "body": body,
        },
        "requestMethod": "POST",
        "requestPath": "/apps/upload",
        "body": body,
    }


def tile_upload_body(payload: dict[str, Any]) -> dict[str, Any]:
    role = payload.get("tileType")
    if not isinstance(role, str) or role not in TILE_TYPES or payload.get("fileType") != "image":
        raise FlowIssue("invalid_tile_assets", "Tile upload requires a named tileType and image fileType.")
    upload_mime_type(payload.get("path"), "image", reason="invalid_tile_assets")
    result = preview_upload_body({**payload, "previewIndex": 0})
    body = result["request"]["body"]
    body.pop("previewIndex")
    body.update({"contentType": "til", "tileType": role})
    return result


def merge_version_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = copy.deepcopy(require_object(payload.get("existingMetadata"), "existingMetadata"))
    if "targetAgeRating" in payload:
        raise FlowIssue(
            "target_age_rating_not_accepted",
            "Omit targetAgeRating; SPECS computes the age rating from contentRatingAssessment.",
        )
    rating_assessment = payload.get("contentRatingAssessment")
    replacing_rating = rating_assessment not in (None, {})
    if replacing_rating:
        normalized_assessment = validate_content_rating(rating_assessment)
    uploads = require_list(payload.get("previewUploads", []), "previewUploads")
    replacing_preview = bool(uploads)
    tile_uploads = normalize_tile_uploads(payload.get("tileUploads", []))
    if not replacing_rating and not replacing_preview and not tile_uploads:
        raise FlowIssue("no_metadata_updates", "At least one content-rating or preview update is required.")

    body: dict[str, Any] = {}
    if replacing_rating:
        body["reviewMetadata"] = {
            "contentRatingAssessment": content_rating_assessment_for_api(normalized_assessment),
        }
    if not replacing_preview and not tile_uploads:
        return {"status": "VERSION_UPDATE_READY", "stage": "publish_flow", "body": body}

    default = metadata.setdefault("default", {})
    if not isinstance(default, dict):
        raise FlowIssue("metadata_invalid", "existingMetadata.default must be an object.")
    if not isinstance(default.get("previewAssets", {}), dict):
        raise FlowIssue("metadata_invalid", "existingMetadata.default.previewAssets must be an object.")
    preview_assets: dict[str, dict[str, str]] = {}
    for value in uploads:
        upload = require_object(value, "previewUploads[]")
        # Neither of these two fields is returned by upload-all.py, so omission is the likely
        # mistake rather than a wrong value: previewIndex is encoded in its `label` ("preview:0")
        # and `type` is not carried at all. Say where each one comes from, or the caller reads a
        # complaint about a value it never supplied — the same trap that made an absent fileType
        # look like an invalid one upstream.
        index = upload.get("previewIndex")
        if index is None:
            raise FlowIssue(
                "invalid_preview_media",
                "previewUploads[].previewIndex is missing. upload-all.py encodes it in each "
                'result\'s label as "preview:<index>".',
            )
        if not isinstance(index, int) or index < 0:
            raise FlowIssue("invalid_preview_media", f"previewIndex must be a non-negative integer, not {index!r}.")
        media_type = upload.get("type")
        if media_type in (None, ""):
            raise FlowIssue(
                "invalid_preview_media",
                "previewUploads[].type is missing. upload-all.py does not return it; take it from "
                "the confirmed plan's matching previewMediaAssets entry.",
            )
        if media_type not in {"image", "video"}:
            raise FlowIssue("invalid_preview_media", f"Preview upload type must be image or video, not {media_type!r}.")
        if str(index) in preview_assets:
            raise FlowIssue("invalid_preview_media", "Preview upload indexes must be unique.")
        preview_assets[str(index)] = {
            "url": require_string(upload.get("url"), "previewUploads[].url"),
            "type": media_type,
        }
    if sorted(int(index) for index in preview_assets) != list(range(len(preview_assets))):
        raise FlowIssue(
            "invalid_preview_media",
            "Preview upload indexes must be contiguous and start at zero.",
        )
    if replacing_preview:
        default["previewAssets"] = preview_assets
    if tile_uploads:
        tiles = default.setdefault("tileAssets", {})
        if not isinstance(tiles, dict):
            raise FlowIssue("metadata_invalid", "existing tileAssets must be an object.")
        for upload in tile_uploads:
            tiles[upload["tileType"]] = {"urlMap": {"png": upload["url"]}}
    body["metadata"] = metadata
    return {"status": "VERSION_UPDATE_READY", "stage": "publish_flow", "body": body}


def review_fingerprint(payload: dict[str, Any]) -> dict[str, Any]:
    """Digest the review input so a post-confirmation re-inspection can be skipped safely.

    The rule used to be a prose paragraph the agent reimplemented each run: canonical
    JSON, recursively sorted keys, assets sorted by role then id, paths and file names
    replaced by digest plus byte length. Every one of those is a place to differ by
    accident, and a fingerprint that differs by accident silently forces a second
    moderation pass — or, worse, one that matches by accident skips a needed one.
    """
    review_input = require_object(payload.get("reviewInput"), "reviewInput")

    release_text = require_object(review_input.get("releaseText"), "reviewInput.releaseText")
    assets = require_list(review_input.get("assets", []), "reviewInput.assets")
    manifest = require_list(review_input.get("manifest", []), "reviewInput.manifest")

    normalized_assets = []
    for index, entry in enumerate(assets):
        asset = require_object(entry, f"reviewInput.assets[{index}]")
        status = asset.get("status", "available")
        # Identity is content, never location: the same icon staged at two paths must
        # produce one fingerprint, or every temporary directory invalidates the cache.
        identity: dict[str, Any] = {
            "assetId": require_string(asset.get("assetId"), f"reviewInput.assets[{index}].assetId"),
            "role": require_string(asset.get("role"), f"reviewInput.assets[{index}].role"),
            "mediaType": asset.get("mediaType"),
            "contentType": asset.get("contentType"),
            "status": status,
        }
        if status == "available":
            identity["sha256"] = require_string(asset.get("sha256"), f"reviewInput.assets[{index}].sha256")
            identity["bytes"] = asset.get("bytes")
            if not isinstance(identity["bytes"], int):
                raise FlowIssue(
                    "invalid_review_input",
                    f"reviewInput.assets[{index}].bytes must be an integer for an available asset.",
                )
        else:
            identity["unavailable"] = True
        normalized_assets.append(identity)

    normalized_manifest = []
    for index, entry in enumerate(manifest):
        item = require_object(entry, f"reviewInput.manifest[{index}]")
        normalized_manifest.append(
            {
                "id": require_string(item.get("id"), f"reviewInput.manifest[{index}].id"),
                "role": item.get("role"),
                "type": item.get("type"),
                "sha256": require_string(item.get("sha256"), f"reviewInput.manifest[{index}].sha256"),
                "bytes": item.get("bytes"),
            }
        )

    digest_input = {
        # Signing-key data is deliberately absent: rotating a key changes nothing a
        # reviewer would see, so it must not force a re-inspection.
        "collectorVersion": review_input.get("collectorVersion"),
        "releaseText": release_text,
        "commerceKit": review_input.get("commerceKit", {}),
        "contentRating": review_input.get("contentRating", {}),
        "moderationCoverage": review_input.get("moderationCoverage", []),
        "signals": review_input.get("signals", {}),
        "assets": sorted(normalized_assets, key=lambda item: (item["role"], item["assetId"])),
        "manifest": sorted(normalized_manifest, key=lambda item: item["id"]),
    }

    return {
        "status": "REVIEW_FINGERPRINT_READY",
        "stage": "review_input",
        "reviewFingerprint": fingerprint(digest_input),
        "assetCount": len(normalized_assets),
        "manifestCount": len(normalized_manifest),
    }


OPERATIONS = {
    "legal-documents-updates": legal_documents_updates,
    "legal-documents-check": legal_documents_check,
    "submit-reject-legal-documents": submit_reject_legal_documents,
    "review-fingerprint": review_fingerprint,
    "submit-begin": submit_begin,
    "submit-succeed": submit_succeed,
    "freeze-plan": freeze_plan,
    "render-confirmation": render_confirmation,
    "confirm-plan": confirm_plan,
    "verify-plan": verify_plan,
    "package-authorize": package_authorize,
    "registration-begin": registration_begin,
    "registration-authorize": registration_authorize,
    "registration-succeed": registration_succeed,
    "finalize-authorize": finalize_authorize,
    "rebuild-upload-manifest": rebuild_upload_manifest,
    "version-guard": version_guard,
    "preview-upload-body": preview_upload_body,
    "tile-upload-body": tile_upload_body,
    "merge-version-metadata": merge_version_metadata,
}

# Input and result shapes, declared next to the validators that enforce them.
# This used to be a 3.9 KB table in SKILL.md, which cost every run the context and
# could drift from the code silently; a cold run once burned three turns on --help,
# rg, and reading this file to recover a single key name.
CHECKSUM_NOTE = (
    "Every checksum is base64 SHA-256, not hex; a hex digest fails validation. "
    "Compute it with: openssl dgst -sha256 -binary FILE | base64"
)
ENVELOPE_NOTE = "Read request.method, request.path and request.body — never a top-level requestPath."
MIME_TYPE_NOTE = (
    "path is the file to upload; its extension sets body.mimeType. Send the returned requiredHeaders on the PUT."
)
OPAQUE_NOTE = (
    "Opaque pipeline: pass the previous stage's complete result through unchanged. "
    "Do not extract fields into a new object or rebuild it in model-authored code."
)

SCHEMAS: dict[str, dict[str, Any]] = {
    "legal-documents-updates": {
        "summary": "Derive missing document writes; preserve concurrent edits and identical retries.",
        "required": ["legalDocumentInputs", "response.httpStatus", "response.data"],
        "result": ["updates (CAS writes for missing documents only)"],
    },
    "legal-documents-check": {
        "summary": "Validate Lens legal-document readiness for the confirmed channel.",
        "required": ["targetChannel", "response = {httpStatus, data}"],
        "optional": [],
        "result": ["status", "reason", "details", "retryAfterSeconds"],
    },
    "submit-reject-legal-documents": {
        "summary": "Bind a retry only to a recognized legal-document rejection from submit.",
        "required": ["submitState", "response = {httpStatus, data}"],
        "optional": [],
        "result": ["status", "submitState"],
    },
    "freeze-plan": {
        "summary": "Normalize replacements and bind opaque existing-field reuse into one publish plan.",
        "required": [
            "projectPath",
            "packageId",
            "packageVersion",
            "lensName",
            "storeListingReuse (the exact publish-context summary)",
            "legalDocuments (the exact publish-context legal summary; required for new sessions)",
            "previewMediaPlan",
            "previewMediaAssets[] = {source, path, type, checksum, bytes}",
            "tileAssets[] = {tileType, source, path, type: image, checksum, bytes}",
        ],
        "optional": [
            "releaseDescription (required only when not reused)",
            "releaseTags (required only when not reused)",
            "selectableCategories + selectedCategoryId + selectedCategoryDisplayName (required only when not reused)",
            "contentRatingAssessment (required only when not reused; SPECS computes the age rating)",
            "orgId + orgDisplayName (only when selected; display name must come from the backend)",
            "semanticVersion (only when explicitly supplied)",
            "legalDocumentInputs (user-supplied privacyPolicy/termsOfService, each exactly {url} or {text})",
            "targetChannel (production, beta, or internal; defaults to production)",
            "packageIdNeedsAssignment + lensNameNeedsAssignment + lensIconPlan + signingKeyPlan + buildVersionPlan "
            "(project setup actions)",
        ],
        "result": ["plan", "planFingerprint", "selectableCategories"],
        "notes": [CHECKSUM_NOTE, "plan.category.displayName is the only category text allowed downstream."],
    },
    "render-confirmation": {
        "summary": "Validate approval assets and render the exact frozen publish question.",
        "required": [
            "frozen (the complete PLAN_FROZEN result, unchanged)",
            "presentation.inlineRenderingSupported (boolean)",
        ],
        "optional": [
            "presentation.lensIconPath (existing icon only; generated icon comes from the plan)",
            "presentation.contentRatingEvidence[]",
            "presentation.contentRatingCoverage[]",
            "presentation.moderationFindings[] = {category, subject, rationale}",
            "presentation.moderationCoverage[]",
        ],
        "result": [
            "confirmation.previewMessageMarkdown",
            "confirmation.confirmationMarkdown",
            "confirmation.options",
            "confirmation.attachments",
            "confirmation.retainedPaths",
            "confirmation.confirmationToken",
        ],
        "notes": [
            OPAQUE_NOTE,
            "Emit previewMessageMarkdown immediately before asking confirmationMarkdown with the returned options.",
            "If inline rendering fails, rerun once with inlineRenderingSupported=false for directory fallbacks.",
        ],
    },
    "confirm-plan": {
        "summary": "Convert the frozen plan the user approved into a confirmed plan.",
        "required": ["the complete PLAN_FROZEN result, unchanged"],
        "optional": [],
        "result": ["confirmedPlan", "planToken"],
        "notes": [OPAQUE_NOTE],
    },
    "verify-plan": {
        "summary": "Fail closed if any confirmed value changed before Package.",
        "required": ["the complete PLAN_CONFIRMED result, unchanged"],
        "optional": [],
        "result": ["planToken"],
        "notes": [OPAQUE_NOTE],
    },
    "package-authorize": {
        "summary": "Authorize Package only when the confirmed plan and version policy agree.",
        "required": [
            "confirmed (the complete PLAN_CONFIRMED result, unchanged)",
            "versionPolicy (the complete VERSION_POLICY_OK result, unchanged)",
        ],
        "optional": [],
        "result": ["packageAuthorization", "packageAuthorization.authorizationToken"],
        "notes": [OPAQUE_NOTE, "Package identity and Lens name are bound into the authorization token."],
    },
    "registration-begin": {
        "summary": "Guard and open the at-most-once registration transition.",
        "required": [
            "request = {method, path, tenantId, body}",
            "attemptOrdinal (integer >= 1)",
            "retryReason",
        ],
        "optional": ["existingState (required on a retry, forbidden on the first attempt)"],
        "result": ["registrationState"],
        "notes": [],  # filled below from the validator's own vocabulary
    },
    "registration-authorize": {
        "summary": "Build, bind, and open the exact release-registration request.",
        "required": [
            "confirmed (the complete PLAN_CONFIRMED result, unchanged)",
            "packageAuthorization (the complete PACKAGE_AUTHORIZED result, unchanged)",
            "spkPath",
            "spkChecksum",
            "attemptOrdinal (integer >= 1)",
            "retryReason",
        ],
        "optional": ["existingState (required on a retry, forbidden on the first attempt)"],
        "result": ["registrationAuthorization", "registrationAuthorization.authorizationToken"],
        "notes": [CHECKSUM_NOTE, OPAQUE_NOTE, "Includes the guarded REGISTRATION_STARTED state."],
    },
    "rebuild-upload-manifest": {
        "summary": "Rebuild the upload manifest from a stored succeeded registration, without re-registering.",
        "required": ["registrationState", "spkPath", "spkChecksum"],
        "optional": ["previewTargets"],
        "result": ["uploadManifest", "uploadExpiresAt", "lensId", "releaseId", "previewCount"],
        "notes": [
            "Use this when the manifest from register.ts is no longer in hand. It carries presigned "
            "URLs, so it is never written to disk; the backend response retained in registrationState "
            "is what makes the SnapOS Package target recoverable.",
            "previewTargets are re-minted by repeating /apps/upload, which is not a create. Never "
            "re-POST /lenses/publish to recover a lost manifest.",
            "Reads no clock: apply the same near-expiry rule to uploadExpiresAt as after a fresh registration.",
            "Set each previewTargets[].headers to the re-minted requiredHeaders unchanged; S3 rejects a PUT "
            "without its signed Content-Type.",
        ],
    },
    "registration-succeed": {
        "summary": "Close the registration transition with the backend result.",
        "required": ["registrationState", "result"],
        "optional": [],
        "result": ["registrationState"],
        "notes": ["Both a started and a succeeded state count as a consumed attempt."],
    },
    "finalize-authorize": {
        "summary": "Bind Finalize metadata and release identity to confirmed registration state.",
        "required": [
            "confirmed (the complete PLAN_CONFIRMED result, unchanged)",
            "registrationAuthorization (the complete REGISTRATION_AUTHORIZED result, unchanged)",
            "registered (the complete REGISTERED_AND_UPLOADED result, unchanged)",
            "submitStatePath",
        ],
        "optional": [],
        "result": ["finalizeAuthorization", "finalizeAuthorization.authorizationToken"],
        "notes": [
            OPAQUE_NOTE,
            "Reused rating and preview fields become empty Finalize replacements.",
            "targetChannel is derived from the confirmed plan and bound into Finalize authorization.",
        ],
    },
    "version-guard": {
        "summary": "Validate the package id and build version against the availability response.",
        "required": [
            "packageId",
            "packageVersion",
            "availabilityResponse (the exact data object, not the whole response)",
        ],
        "optional": [],
        "result": [
            "publishedBuildVersionFloor",
            "nextAvailablePkgBuildVersion",
            "coverage",
            "versionReason",
        ],
        "notes": ["Never compare package-version strings or tuples in model-authored code."],
    },
    "tile-upload-body": {
        "summary": "Build an image upload for a named store tile, separate from preview indexes.",
        "required": [
            "appId",
            "versionId",
            "checksum",
            "tileType (primary/default/square/hero)",
            "fileType (image)",
            f"path ({'/'.join(upload_suffixes('image'))})",
        ],
        "optional": [],
        "result": ["request", "body"],
        "notes": ["contentType is til; expireIn is 3600; checksum is base64 SHA-256.", MIME_TYPE_NOTE],
    },
    "preview-upload-body": {
        "summary": "Build the /apps/upload registration body for one preview asset.",
        "required": [
            "appId",
            "versionId",
            "checksum",
            "previewIndex",
            "fileType",
            f"path ({'/'.join(UPLOAD_MIME_TYPES)})",
        ],
        "optional": [],
        "result": ["request", "requestPath (legacy flat alias)", "body (legacy flat alias)"],
        "notes": [ENVELOPE_NOTE, CHECKSUM_NOTE, "The body always carries expireIn: 3600.", MIME_TYPE_NOTE],
    },
    "review-fingerprint": {
        "summary": "Digest the review input so an unchanged project skips a second moderation pass.",
        "required": [
            "reviewInput.releaseText",
            "reviewInput.assets[] = {assetId, role, sha256, bytes, status}",
            "reviewInput.manifest[] = {id, sha256} (from collect-review-input.py)",
        ],
        "optional": [
            "reviewInput.collectorVersion",
            "reviewInput.commerceKit",
            "reviewInput.contentRating",
            "reviewInput.moderationCoverage",
            "reviewInput.signals",
        ],
        "result": ["reviewFingerprint", "assetCount", "manifestCount"],
        "notes": [
            "Asset identity is content, not location: sha256 plus bytes, never the path.",
            "Signing-key data is excluded, so rotating a key never forces a re-inspection.",
            "Compute it before the confirmation and again after any setter ran; equal digests "
            "mean reuse the confirmed findings and rating without re-inspecting media.",
        ],
    },
    "submit-begin": {
        "summary": "Open the at-most-once submit transition for one release.",
        "required": [
            "request = {method, path, tenantId, body}",
            "lensId",
            "releaseId",
            "attemptOrdinal (integer >= 1)",
            "retryReason",
        ],
        "optional": ["existingState (required on a retry, forbidden on the first attempt)"],
        "result": ["submitState"],
        "notes": [],  # filled below from the validator's own vocabulary
    },
    "submit-succeed": {
        "summary": "Close a submitted transition or retain a validating transition for retry.",
        "required": ["submitState", "result"],
        "optional": [],
        "result": ["submitState", "backendStatus"],
        "notes": [
            "The submitted status closes the transition as succeeded.",
            "The validating status returns SUBMIT_PENDING and binds the next retry reason.",
        ],
    },
    "merge-version-metadata": {
        "summary": "Apply only confirmed preview or rating replacements; leave reused fields untouched.",
        "required": ["existingMetadata"],
        "optional": [
            "contentRatingAssessment (a rating replacement; SPECS computes the age rating on save)",
            "previewUploads[] = {previewIndex, url, type}",
            "tileUploads[] = {tileType, url}",
        ],
        "result": ["body"],
        "notes": [
            "When previewUploads is present, previewAssets is replaced rather than appended.",
            "Omit contentRatingAssessment to preserve the existing rating.",
            "The flat confirmed assessment is validated and converted to the API answer maps.",
            "Omit previewUploads to preserve the existing preview media.",
            "Every other metadata field is preserved untouched.",
        ],
    },
}

# Derived from the validator itself, so the documented vocabulary cannot drift from
# the accepted one. A plausible-looking "initial_attempt" fails closed.
SCHEMAS["submit-begin"]["notes"] = [
    'retryReason must be exactly "initial" on attemptOrdinal 1.',
    "A submitted release returns 404 on a version read, so a consumed attempt can never be "
    "resolved by asking the backend. Retry only when the release provably was not submitted: "
    + ", ".join(sorted(ALLOWED_SUBMIT_RETRIES))
    + ".",
]

SCHEMAS["registration-begin"]["notes"] = [
    'retryReason must be exactly "initial" on attemptOrdinal 1.',
    "A retry must increment attemptOrdinal, pass existingState, and use one of: "
    + ", ".join(sorted(ALLOWED_REGISTRATION_RETRIES))
    + ".",
]

SCHEMAS["registration-authorize"]["notes"].extend(SCHEMAS["registration-begin"]["notes"])


def schema_result(operation: str) -> dict[str, Any]:
    if operation == "all":
        return {
            "status": "SCHEMA_READY",
            "stage": "publish_flow",
            "operations": {name: dict(SCHEMAS[name]) for name in sorted(SCHEMAS)},
        }
    return {
        "status": "SCHEMA_READY",
        "stage": "publish_flow",
        "operation": operation,
        **SCHEMAS[operation],
    }


def load_payload(path: str) -> dict[str, Any]:
    if path == "-":
        value = json.load(sys.stdin)
    else:
        with Path(path).open() as source:
            value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError("input JSON must be an object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", nargs="?", choices=sorted(OPERATIONS))
    parser.add_argument("--json", default="-", help="Input JSON path, or - for stdin.")
    parser.add_argument(
        "--schema",
        nargs="?",
        const="",
        metavar="OPERATION",
        choices=sorted(OPERATIONS) + ["all", ""],
        help="Print the input and result shape for OPERATION (or 'all') and exit.",
    )
    args = parser.parse_args()

    requested_schema = args.schema if args.schema else (args.operation if args.schema == "" else None)
    if requested_schema:
        print(canonical_json(schema_result(requested_schema)))
        return 0
    if args.operation is None:
        parser.error("an operation is required unless --schema is used")

    # A refusal has to be self-correcting. A measured run had `registration-begin` reject a
    # request for a missing `retryReason`, then spend two more calls rediscovering the rest of
    # the shape — with `--schema` sitting right there. Attaching the schema to the refusal means
    # one failed call carries everything needed to fix it.
    def with_schema(payload: dict[str, Any]) -> dict[str, Any]:
        schema = SCHEMAS.get(args.operation)
        if schema is not None and "schema" not in payload:
            payload = {**payload, "schema": {"operation": args.operation, **schema}}
        return payload

    try:
        result = OPERATIONS[args.operation](load_payload(args.json))
    except FlowIssue as error:
        result = with_schema(error.result())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        result = with_schema(
            {
                "status": "FAILED",
                "stage": "publish_flow",
                "reason": "input_unreadable",
                "message": str(error),
            }
        )
        print(canonical_json(result))
        return 2
    print(canonical_json(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
