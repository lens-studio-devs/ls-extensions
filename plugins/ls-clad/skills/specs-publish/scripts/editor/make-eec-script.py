#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Fill a pinned ExecuteEditorCode script's CONFIG consts; print a temp file path.

Substituting these by hand is unsafe. A value containing a double quote makes
invalid TypeScript, and a Windows path like C:\\Users\\me\\P.esproj compiles fine
while silently becoming C:UsersmeP.esproj, because \\U and \\m are not the escapes
you meant. Everything here goes through json.dumps instead.

Each run writes a fresh temp file. Concurrent callers need that — build-mesh fans
out up to 4 SPECS jobs, and a shared path lets one job's config overwrite
another's between the write and the ExecuteEditorCode read.

    make-eec-script.py TARGET.ts --set NAME=VALUE [...]
        [--json NAME=FILE ...] [--json-uri NAME=PERCENT_ENCODED_JSON ...]
    make-eec-script.py --cleanup CONFIGURED_PATH

--set takes a raw string: pass it exactly as intended, no escaping. --json reads
an object const (BODY, EXTRA_HEADERS) from a JSON file. --json-uri accepts a
percent-encoded JSON value so a retained orchestration scope can safely pass an
in-memory object without a temporary file.

Only the value is replaced, so each declaration's type annotation and trailing
comment survive as written. That is load-bearing: text-to-3d-request.ts compares
METHOD === "GET", which only compiles while METHOD is declared ": string".

Configured files use /tmp on Unix-like hosts so runtimes can execute and clean
them without a separate filesystem approval. Use --cleanup after ExecuteEditorCode;
it only accepts configured files in this helper's configured temp directory.
"""

import argparse
import base64
import binascii
import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile
from urllib.parse import unquote

# const NAME[: Type] = value;   [// trailing comment]
DECL = re.compile(r"(?P<head>const\s+(?P<name>\w+)\b[^=]*?)\s*=\s*.*?;(?P<comment>\s*//.*)?$")
CONFIGURED_NAME = re.compile(r"[A-Za-z0-9_.-]+\.[A-Za-z0-9_]{8}\.configured\.ts")


def configured_temp_dir() -> str:
    override = os.environ.get("EEC_CONFIG_TEMP_DIR")
    if override:
        return os.path.abspath(override)
    if os.name != "nt" and os.path.isdir("/tmp"):
        return "/tmp"
    return os.path.abspath(tempfile.gettempdir())


def cleanup_configured(path: str) -> None:
    absolute = os.path.abspath(path)
    if (
        os.path.dirname(absolute) != configured_temp_dir()
        or CONFIGURED_NAME.fullmatch(os.path.basename(absolute)) is None
    ):
        sys.exit("make-eec-script: --cleanup refuses a path outside the configured temp directory")
    try:
        os.unlink(absolute)
    except FileNotFoundError:
        pass
    except OSError as error:
        sys.exit(f"make-eec-script: --cleanup: {absolute}: {error}")
    print('{"status":"CONFIG_CLEANED"}')


def validate_tiles(target, values, uploads=False):
    helper = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(target))), "publish", "publish-flow.py")
    spec = importlib.util.spec_from_file_location("tile_flow", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        return (module.normalize_tile_uploads if uploads else module.normalize_tile_assets)(values)
    except module.FlowIssue as error:
        sys.exit(f"make-eec-script: invalid tile configuration: {error}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", help="pinned .ts script with a CONFIG block")
    ap.add_argument("--cleanup", metavar="CONFIGURED_PATH", help="delete one generated configured script")
    ap.add_argument("--set", action="append", default=[], metavar="NAME=VALUE", help="string const, raw value")
    ap.add_argument("--json", action="append", default=[], metavar="NAME=FILE", help="object const, JSON from FILE")
    ap.add_argument(
        "--json-uri",
        action="append",
        default=[],
        metavar="NAME=PERCENT_ENCODED_JSON",
        help="object const, percent-encoded inline JSON",
    )
    ap.add_argument(
        "--confirmed-plan-uri",
        help="percent-encoded complete PLAN_CONFIRMED result; derives CONFIRMED_PLAN_TOKEN",
    )
    ap.add_argument(
        "--package-authorization-uri",
        help="percent-encoded complete PACKAGE_AUTHORIZED result; configures package.ts",
    )
    ap.add_argument(
        "--registration-authorization-uri",
        help="percent-encoded complete REGISTRATION_AUTHORIZED result; configures register.ts",
    )
    ap.add_argument(
        "--finalize-authorization-uri",
        help="percent-encoded complete FINALIZE_AUTHORIZED result, or - for JSON on stdin; configures finalize.ts",
    )
    args = ap.parse_args()
    if args.cleanup:
        if (
            args.target
            or args.set
            or args.json
            or args.json_uri
            or args.confirmed_plan_uri
            or args.package_authorization_uri
            or args.registration_authorization_uri
            or args.finalize_authorization_uri
        ):
            sys.exit("make-eec-script: --cleanup cannot be combined with generation arguments")
        cleanup_configured(args.cleanup)
        return
    if not args.target:
        ap.error("TARGET.ts is required unless --cleanup is used")

    values = {}
    parsed_values = {}
    package_authorization_supplied = False
    registration_authorization_supplied = False
    finalize_authorization_supplied = False
    for raw in args.set:
        name, _, value = raw.partition("=")
        values[name] = json.dumps(value)
        parsed_values[name] = value
    for raw in args.json:
        name, _, path = raw.partition("=")
        try:
            with open(path, encoding="utf-8") as fh:
                parsed = json.load(fh)
                values[name] = json.dumps(parsed)
                parsed_values[name] = parsed
        except (OSError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --json {name}: {path}: {e}")
    for raw in args.json_uri:
        name, separator, encoded = raw.partition("=")
        if not separator or not name:
            sys.exit("make-eec-script: --json-uri must use NAME=PERCENT_ENCODED_JSON")
        try:
            parsed = json.loads(unquote(encoded))
            values[name] = json.dumps(parsed)
            parsed_values[name] = parsed
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --json-uri {name}: invalid encoded JSON: {e}")
    if args.confirmed_plan_uri:
        try:
            confirmed = json.loads(unquote(args.confirmed_plan_uri))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --confirmed-plan-uri: invalid encoded JSON: {e}")
        if not isinstance(confirmed, dict) or confirmed.get("status") != "PLAN_CONFIRMED":
            sys.exit("make-eec-script: --confirmed-plan-uri requires a complete PLAN_CONFIRMED result")
        plan = confirmed.get("confirmedPlan")
        token = confirmed.get("planToken")
        if not isinstance(plan, dict) or plan.get("publishPlanConfirmed") is not True:
            sys.exit("make-eec-script: confirmed plan is malformed or unconfirmed")
        fingerprint_input = copy.deepcopy(plan)
        fingerprint_input.pop("publishPlanConfirmed", None)
        actual_token = hashlib.sha256(
            json.dumps(
                fingerprint_input,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if not isinstance(token, str) or token != actual_token:
            sys.exit("make-eec-script: confirmed plan token does not match the confirmed plan")
        values["CONFIRMED_PLAN_TOKEN"] = json.dumps(token)
        parsed_values["CONFIRMED_PLAN_TOKEN"] = token
        parsed_values["CONFIRMED_PLAN"] = plan
    if args.package_authorization_uri:
        try:
            authorized = json.loads(unquote(args.package_authorization_uri))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --package-authorization-uri: invalid encoded JSON: {e}")
        if (
            not isinstance(authorized, dict)
            or authorized.get("status") != "PACKAGE_AUTHORIZED"
            or authorized.get("stage") != "publish_flow"
        ):
            sys.exit("make-eec-script: --package-authorization-uri requires a complete PACKAGE_AUTHORIZED result")
        authorization = authorized.get("packageAuthorization")
        if not isinstance(authorization, dict):
            sys.exit("make-eec-script: package authorization is malformed")
        if set(authorization) != {
            "planToken",
            "packageId",
            "packageVersion",
            "lensName",
            "projectPath",
            "buildVersionMutation",
            "authorizationToken",
        }:
            sys.exit("make-eec-script: package authorization has unexpected or missing fields")
        identity = {
            "planToken": authorization.get("planToken"),
            "packageId": authorization.get("packageId"),
            "packageVersion": authorization.get("packageVersion"),
            "lensName": authorization.get("lensName"),
            "projectPath": authorization.get("projectPath"),
            "buildVersionMutation": authorization.get("buildVersionMutation"),
        }
        if any(
            not isinstance(value, str) or not value.strip()
            for key, value in identity.items()
            if key != "buildVersionMutation"
        ) or not isinstance(identity["buildVersionMutation"], dict):
            sys.exit("make-eec-script: package authorization identity is incomplete")
        actual_token = hashlib.sha256(
            json.dumps(identity, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        if authorization.get("authorizationToken") != actual_token:
            sys.exit("make-eec-script: package authorization token does not match its identity")
        values["PACKAGE_AUTHORIZATION"] = json.dumps(authorization)
        parsed_values["PACKAGE_AUTHORIZATION"] = authorization
        package_authorization_supplied = True
    if args.registration_authorization_uri:
        try:
            authorized = json.loads(unquote(args.registration_authorization_uri))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --registration-authorization-uri: invalid encoded JSON: {e}")
        if (
            not isinstance(authorized, dict)
            or authorized.get("status") != "REGISTRATION_AUTHORIZED"
            or authorized.get("stage") != "publish_flow"
        ):
            sys.exit(
                "make-eec-script: --registration-authorization-uri requires a complete REGISTRATION_AUTHORIZED result"
            )
        authorization = authorized.get("registrationAuthorization")
        expected_fields = {
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
        if not isinstance(authorization, dict) or set(authorization) != expected_fields:
            sys.exit("make-eec-script: registration authorization has unexpected or missing fields")
        authorization_facts = copy.deepcopy(authorization)
        authorization_token = authorization_facts.pop("authorizationToken", None)
        actual_token = hashlib.sha256(
            json.dumps(
                authorization_facts,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if authorization_token != actual_token:
            sys.exit("make-eec-script: registration authorization token does not match its fields")
        request = authorization.get("request")
        state = authorization.get("registrationState")
        if not isinstance(request, dict) or set(request) != {"method", "path", "tenantId", "body"}:
            sys.exit("make-eec-script: registration authorization request is malformed")
        if (
            request.get("method") != "POST"
            or request.get("path") != "/lenses/publish"
            or not isinstance(request.get("tenantId"), str)
            or not isinstance(request.get("body"), dict)
        ):
            sys.exit("make-eec-script: registration authorization request is invalid")
        request_fingerprint = hashlib.sha256(
            json.dumps(request, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        if (
            not isinstance(state, dict)
            or state.get("state") != "started"
            or state.get("fingerprint") != request_fingerprint
            or not isinstance(state.get("attemptOrdinal"), int)
            or state["attemptOrdinal"] < 1
        ):
            sys.exit("make-eec-script: registration authorization state does not match its request")
        for token_name in ("planToken", "packageAuthorizationToken"):
            token = authorization.get(token_name)
            if not isinstance(token, str) or re.fullmatch(r"[0-9a-f]{64}", token) is None:
                sys.exit(f"make-eec-script: registration authorization {token_name} is malformed")
        spk_path = authorization.get("spkPath")
        spk_checksum = authorization.get("spkChecksum")
        try:
            decoded_checksum = base64.b64decode(spk_checksum, validate=True) if isinstance(spk_checksum, str) else b""
        except (binascii.Error, ValueError):
            decoded_checksum = b""
        if not isinstance(spk_path, str) or not spk_path or len(decoded_checksum) != 32:
            sys.exit("make-eec-script: registration authorization package fields are malformed")
        preview_assets = authorization.get("previewAssets")
        if not isinstance(preview_assets, list):
            sys.exit("make-eec-script: registration authorization previewAssets must be an array")

        scripts_dir = os.path.dirname(os.path.dirname(os.path.abspath(args.target)))
        helper_path = os.path.join(scripts_dir, "publish", "publish-flow.py")
        upload_helper_path = os.path.join(scripts_dir, "publish", "upload-all.py")
        if not os.path.isfile(helper_path) or not os.path.isfile(upload_helper_path):
            sys.exit("make-eec-script: could not resolve Register helper scripts from the target path")
        configured_values = {
            "REQUEST_PATH": request["path"],
            "REQUEST_METHOD": request["method"],
            "TENANT_ID": request["tenantId"],
            "BODY": request["body"],
            "REGISTRATION_STARTED": state,
            "CONFIRMED_PLAN_TOKEN": authorization["planToken"],
            "PACKAGE_AUTHORIZATION_TOKEN": authorization["packageAuthorizationToken"],
            "REGISTRATION_AUTHORIZATION_TOKEN": authorization["authorizationToken"],
            "HELPER_PATH": helper_path,
            "UPLOAD_HELPER_PATH": upload_helper_path,
            "SPK_PATH": spk_path,
            "SPK_CHECKSUM": spk_checksum,
            "PREVIEW_ASSETS": preview_assets,
            "TILE_ASSETS": validate_tiles(args.target, authorization["tileAssets"]),
        }
        for name, value in configured_values.items():
            values[name] = json.dumps(value)
            parsed_values[name] = value
        registration_authorization_supplied = True
    if args.finalize_authorization_uri:
        try:
            authorized = (
                json.load(sys.stdin)
                if args.finalize_authorization_uri == "-"
                else json.loads(unquote(args.finalize_authorization_uri))
            )
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --finalize-authorization-uri: invalid encoded JSON: {e}")
        if (
            not isinstance(authorized, dict)
            or authorized.get("status") != "FINALIZE_AUTHORIZED"
            or authorized.get("stage") != "publish_flow"
        ):
            sys.exit("make-eec-script: --finalize-authorization-uri requires a complete FINALIZE_AUTHORIZED result")
        authorization = authorized.get("finalizeAuthorization")
        expected_fields = {
            "lensId",
            "releaseId",
            "tenantId",
            "submitStatePath",
            "targetChannel",
            "contentRatingAssessment",
            "previewUploads",
            "tileUploads",
            "legalDocumentInputs",
            "planToken",
            "packageAuthorizationToken",
            "registrationAuthorizationToken",
            "authorizationToken",
        }
        if not isinstance(authorization, dict) or set(authorization) != expected_fields:
            sys.exit("make-eec-script: Finalize authorization has unexpected or missing fields")
        authorization_facts = copy.deepcopy(authorization)
        authorization_token = authorization_facts.pop("authorizationToken", None)
        actual_token = hashlib.sha256(
            json.dumps(
                authorization_facts,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if authorization_token != actual_token:
            sys.exit("make-eec-script: Finalize authorization token does not match its fields")
        for field in ("lensId", "releaseId", "submitStatePath"):
            if not isinstance(authorization.get(field), str) or not authorization[field].strip():
                sys.exit(f"make-eec-script: Finalize authorization {field} is malformed")
        if not isinstance(authorization.get("tenantId"), str):
            sys.exit("make-eec-script: Finalize authorization tenantId is malformed")
        if authorization.get("targetChannel") not in ("production", "beta", "internal"):
            sys.exit("make-eec-script: Finalize authorization targetChannel is malformed")
        for token_name in ("planToken", "packageAuthorizationToken", "registrationAuthorizationToken"):
            token = authorization.get(token_name)
            if not isinstance(token, str) or re.fullmatch(r"[0-9a-f]{64}", token) is None:
                sys.exit(f"make-eec-script: Finalize authorization {token_name} is malformed")
        assessment = authorization.get("contentRatingAssessment")
        preview_uploads = authorization.get("previewUploads")
        if not isinstance(assessment, dict):
            sys.exit("make-eec-script: Finalize authorization contentRatingAssessment is malformed")
        if not isinstance(preview_uploads, list):
            sys.exit("make-eec-script: Finalize authorization previewUploads must be an array")

        scripts_dir = os.path.dirname(os.path.dirname(os.path.abspath(args.target)))
        helper_path = os.path.join(scripts_dir, "publish", "publish-flow.py")
        if not os.path.isfile(helper_path):
            sys.exit("make-eec-script: could not resolve the Finalize helper from the target path")
        configured_values = {
            "LENS_ID": authorization["lensId"],
            "RELEASE_ID": authorization["releaseId"],
            "TENANT_ID": authorization["tenantId"],
            "HELPER_PATH": helper_path,
            "SUBMIT_STATE_PATH": authorization["submitStatePath"],
            "TARGET_CHANNEL": authorization["targetChannel"],
            "LEGAL_DOCUMENT_INPUTS": authorization["legalDocumentInputs"],
            "PREVIEW_UPLOADS": preview_uploads,
            "TILE_UPLOADS": validate_tiles(args.target, authorization["tileUploads"], uploads=True),
            "CONTENT_RATING_ASSESSMENT": assessment,
            "CONFIRMED_PLAN_TOKEN": authorization["planToken"],
            "PACKAGE_AUTHORIZATION_TOKEN": authorization["packageAuthorizationToken"],
            "REGISTRATION_AUTHORIZATION_TOKEN": authorization["registrationAuthorizationToken"],
            "FINALIZE_AUTHORIZATION_TOKEN": authorization["authorizationToken"],
        }
        for name, value in configured_values.items():
            values[name] = json.dumps(value)
            parsed_values[name] = value
        finalize_authorization_supplied = True

    target_name = os.path.basename(args.target)
    authorization_safe_sets = all(raw.partition("=")[0] == "RESULT_PATH" for raw in args.set)
    if target_name in {"package.ts", "register.ts", "finalize.ts"} and (
        not authorization_safe_sets or args.json or args.json_uri or args.confirmed_plan_uri
    ):
        sys.exit(f"make-eec-script: {target_name} authorization cannot be combined with generic CONFIG arguments")
    configured_result_path = parsed_values.get("RESULT_PATH")
    if configured_result_path is not None and (
        not isinstance(configured_result_path, str) or not os.path.isabs(configured_result_path)
    ):
        sys.exit("make-eec-script: RESULT_PATH must be an absolute path")
    if configured_result_path is not None:
        session_directory = os.path.realpath(
            os.environ.get("SPECS_PUBLISH_SESSION_DIR") or os.path.join(tempfile.gettempdir(), "specs-publish-sessions")
        )
        if os.path.dirname(os.path.realpath(configured_result_path)) != session_directory:
            sys.exit("make-eec-script: RESULT_PATH must belong to the publish-session directory")
    if target_name == "package.ts" and not package_authorization_supplied:
        sys.exit(
            "make-eec-script: package.ts requires --package-authorization-uri <complete PACKAGE_AUTHORIZED result>"
        )
    if target_name == "register.ts" and not registration_authorization_supplied:
        sys.exit(
            "make-eec-script: register.ts requires "
            "--registration-authorization-uri <complete REGISTRATION_AUTHORIZED result>"
        )
    if target_name == "finalize.ts" and not finalize_authorization_supplied:
        sys.exit(
            "make-eec-script: finalize.ts requires --finalize-authorization-uri <complete FINALIZE_AUTHORIZED result>"
        )
    request_path = parsed_values.get("REQUEST_PATH")
    # register.ts hardcodes the same path and carries the same CONFIG names, so the
    # at-most-once net must cover it too or folding the phase would quietly drop the guard.
    if request_path == "/lenses/publish" and target_name == "authorized-request.ts":
        started = parsed_values.get("REGISTRATION_STARTED")
        plan_token = parsed_values.get("CONFIRMED_PLAN_TOKEN")
        if not isinstance(started, dict) or started.get("state") != "started":
            sys.exit(
                "make-eec-script: /lenses/publish requires "
                "--json-uri REGISTRATION_STARTED=<REGISTRATION_STARTED registrationState>"
            )
        fingerprint = started.get("fingerprint")
        ordinal = started.get("attemptOrdinal")
        if (
            not isinstance(fingerprint, str)
            or re.fullmatch(r"[0-9a-f]{64}", fingerprint) is None
            or not isinstance(ordinal, int)
            or ordinal < 1
        ):
            sys.exit("make-eec-script: REGISTRATION_STARTED is malformed")
        configured_request = {
            "method": parsed_values.get("REQUEST_METHOD"),
            "path": request_path,
            "tenantId": parsed_values.get("TENANT_ID", ""),
            "body": parsed_values.get("BODY"),
        }
        configured_fingerprint = hashlib.sha256(
            json.dumps(
                configured_request,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if configured_fingerprint != fingerprint:
            sys.exit(
                "make-eec-script: REGISTRATION_STARTED fingerprint does not match the configured registration request"
            )
        if not isinstance(plan_token, str) or re.fullmatch(r"[0-9a-f]{64}", plan_token) is None:
            sys.exit("make-eec-script: /lenses/publish requires --confirmed-plan-uri <complete PLAN_CONFIRMED result>")
        confirmed_plan = parsed_values.get("CONFIRMED_PLAN")
        body = configured_request["body"]
        if not isinstance(confirmed_plan, dict) or not isinstance(body, dict):
            sys.exit("make-eec-script: registration requires object plan and BODY values")
        expected_body = {
            "pkgId": confirmed_plan.get("packageId"),
            "name": confirmed_plan.get("lensName"),
        }
        if "releaseDescription" in confirmed_plan:
            expected_body["description"] = confirmed_plan["releaseDescription"]
        if "releaseTags" in confirmed_plan:
            expected_body["tags"] = confirmed_plan["releaseTags"]
        category = confirmed_plan.get("category")
        if isinstance(category, dict):
            expected_body["categoryId"] = category.get("id")
        for optional in ("orgId", "semanticVersion"):
            if optional in confirmed_plan:
                expected_body[optional] = confirmed_plan[optional]
        allowed_body_fields = {*expected_body, "spkChecksum"}
        unexpected_fields = sorted(set(body) - allowed_body_fields)
        mismatched_fields = [field for field, expected in expected_body.items() if body.get(field) != expected]
        plan_org_id = confirmed_plan.get("orgId", "")
        if configured_request["tenantId"] != plan_org_id:
            mismatched_fields.append("TENANT_ID")
        checksum = body.get("spkChecksum")
        try:
            decoded_checksum = base64.b64decode(checksum, validate=True) if isinstance(checksum, str) else b""
        except (binascii.Error, ValueError):
            decoded_checksum = b""
        if len(decoded_checksum) != 32:
            mismatched_fields.append("spkChecksum")
        mismatched_fields.extend(unexpected_fields)
        if mismatched_fields:
            sys.exit(
                "make-eec-script: registration request does not match confirmed plan fields: "
                + ", ".join(mismatched_fields)
            )

    seen = {}
    out = []
    with open(args.target, encoding="utf-8") as fh:
        for line in fh.read().splitlines():
            m = DECL.match(line)
            if m and m.group("name") in values:
                name = m.group("name")
                seen[name] = seen.get(name, 0) + 1
                out.append(f"{m.group('head')} = {values[name]};{m.group('comment') or ''}")
            else:
                out.append(line)

    # Catches a misspelled --set (which would otherwise leave the placeholder in
    # place and run with an empty value) and any unexpected duplicate.
    wrong = {n: seen.get(n, 0) for n in values if seen.get(n, 0) != 1}
    if wrong:
        sys.exit(
            f"make-eec-script: {os.path.basename(args.target)}: expected exactly one declaration of each of "
            + ", ".join(f"{n} (found {c})" for n, c in sorted(wrong.items()))
        )

    fd, path = tempfile.mkstemp(
        prefix=os.path.basename(args.target).removesuffix(".ts") + ".",
        suffix=".configured.ts",
        dir=configured_temp_dir(),
    )
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    print(path)


if __name__ == "__main__":
    main()
