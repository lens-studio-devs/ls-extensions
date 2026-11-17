"""Dependency-free validator for the closed JSON Schema vocabulary used by preview images.

Schemas are the contract owner. Unsupported keywords and non-local references fail
closed; this module is deliberately not a general-purpose JSON Schema implementation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).with_name("preview-images.schema.json")
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
KEYWORDS = {
    "$ref",
    "type",
    "const",
    "enum",
    "anyOf",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "minimum",
    "maximum",
    "description",
}


def validate(name: str, value: Any) -> Any:
    """Validate a named boundary and return its unchanged value."""
    _validate(SCHEMA["$defs"][name], value, name)
    return value


def _validate(schema: dict[str, Any], value: Any, location: str) -> None:
    unknown = set(schema) - KEYWORDS
    if unknown:
        raise ValueError(f"Unsupported schema keywords: {sorted(unknown)}")
    if "$ref" in schema:
        reference = schema["$ref"]
        if not reference.startswith("#/$defs/") or set(schema) != {"$ref"}:
            raise ValueError("Only standalone local definition references are supported")
        _validate(SCHEMA["$defs"][reference.removeprefix("#/$defs/")], value, location)
        return
    if "anyOf" in schema:
        for branch in schema["anyOf"]:
            try:
                _validate(branch, value, location)
                break
            except ValueError:
                pass
        else:
            raise ValueError(f"{location} does not match a supported response")
    expected = schema.get("type")
    matches = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": type(value) is int,
        "boolean": type(value) is bool,
        "null": value is None,
    }
    if expected is not None and (expected not in matches or not matches[expected]):
        raise ValueError(f"{location} must be {expected}")
    if "const" in schema and (value != schema["const"] or type(value) is not type(schema["const"])):
        raise ValueError(f"{location} has an unexpected value")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{location} is not an allowed value")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        if set(schema.get("required", [])) - set(value):
            raise ValueError(f"{location} is missing required fields")
        if schema.get("additionalProperties") is False and set(value) - set(properties):
            raise ValueError(f"{location} contains unknown fields")
        for key, item in value.items():
            if key in properties:
                _validate(properties[key], item, f"{location}.{key}")
    if isinstance(value, list):
        if not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", len(value)):
            raise ValueError(f"{location} has the wrong item count")
        if "items" in schema:
            for index, item in enumerate(value):
                _validate(schema["items"], item, f"{location}[{index}]")
    if isinstance(value, str) and len(value) < schema.get("minLength", 0):
        raise ValueError(f"{location} is too short")
    if type(value) is int:
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            raise ValueError(f"{location} is out of range")


def check_schema(schema: dict[str, Any]) -> None:
    """Reject unsupported vocabulary even in an unselected anyOf branch."""
    if set(schema) - KEYWORDS:
        raise ValueError(f"Unsupported schema keywords: {sorted(set(schema) - KEYWORDS)}")
    if "$ref" in schema:
        name = schema["$ref"].removeprefix("#/$defs/")
        if schema["$ref"] != "#/$defs/" + name or name not in SCHEMA["$defs"] or len(schema) != 1:
            raise ValueError("Invalid local definition reference")
    for child in schema.get("properties", {}).values():
        check_schema(child)
    for child in schema.get("anyOf", []):
        check_schema(child)
    if "items" in schema:
        check_schema(schema["items"])


for _definition in SCHEMA["$defs"].values():
    check_schema(_definition)
