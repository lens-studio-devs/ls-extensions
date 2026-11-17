#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Check for and install SpecsNDK releases listed in the public SpecsNDK version manifest.

The manifest (MANIFEST_URL) only describes the release; archives download from the
per-platform URLs it lists.

Stdlib only; no authentication. Every command prints one JSON object on stdout
(progress goes to stderr) and exits 0 on success, 1 on failure.

    specsndk.py check   [--root DIR] [--manifest-url URL]
    specsndk.py install [--root DIR] [--manifest-url URL] [--no-backup]

Manifest input and every result are defined in specsndk.schema.json
($defs manifest, checkResult, installResult, errorResult) and validated at runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

MANIFEST_URL = "https://raw.githubusercontent.com/specs-devs/ndk/refs/heads/main/specsndk-latest.json"
SUPPORTED_SCHEMA_VERSION = 1
DEFAULT_VERSION_FILE = "source.properties"
DEFAULT_VERSION_KEY = "Pkg.Revision"
TIMEOUT_MANIFEST = 30
TIMEOUT_DOWNLOAD = 3600
CHUNK_BYTES = 1024 * 1024


class SpecsNdkError(Exception):
    pass


def default_root() -> Path:
    env = os.environ.get("SPECSNDK_ROOT")
    return Path(env).expanduser() if env else Path.home() / "Dev" / "SpecsNDK"


def host_platform() -> str:
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform in ("win32", "cygwin"):
        return "windows"
    raise SpecsNdkError(f"SpecsNDK is distributed for macOS and Windows only (host: {sys.platform})")


def parse_version(text: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", text)
    if not parts:
        raise SpecsNdkError(f"unparseable version: {text!r}")
    return tuple(int(p) for p in parts)


def compare_versions(a: str, b: str) -> int:
    pa, pb = parse_version(a), parse_version(b)
    width = max(len(pa), len(pb))
    pa += (0,) * (width - len(pa))
    pb += (0,) * (width - len(pb))
    return (pa > pb) - (pa < pb)


SCHEMA = json.loads(Path(__file__).with_name("specsndk.schema.json").read_text(encoding="utf-8"))
_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def _check(schema: dict, value: object, where: str) -> None:
    """Closed-vocabulary JSON Schema subset; unknown keywords fail so the schema stays the owner."""
    unknown = set(schema) - {
        "$ref",
        "anyOf",
        "type",
        "const",
        "enum",
        "pattern",
        "minimum",
        "minLength",
        "required",
        "properties",
        "additionalProperties",
        "description",
    }
    if unknown:
        raise SpecsNdkError(f"schema: unsupported keywords {sorted(unknown)} at {where}")
    if "$ref" in schema:
        _check(SCHEMA["$defs"][schema["$ref"].removeprefix("#/$defs/")], value, where)
        return
    if "anyOf" in schema:
        errors = []
        for branch in schema["anyOf"]:
            try:
                _check(branch, value, where)
                break
            except SpecsNdkError as exc:
                errors.append(str(exc))
        else:
            raise SpecsNdkError("; ".join(errors))
    kind = schema.get("type")
    if kind == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif kind is not None:
        ok = isinstance(value, _TYPES[kind]) and not (kind != "boolean" and isinstance(value, bool))
    else:
        ok = True
    if not ok:
        raise SpecsNdkError(f"{where}: expected {kind}")
    if "const" in schema and value != schema["const"]:
        raise SpecsNdkError(f"{where}: expected {schema['const']!r}, got {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise SpecsNdkError(f"{where}: {value!r} not in {schema['enum']}")
    if "pattern" in schema and not re.search(schema["pattern"], value):
        raise SpecsNdkError(f"{where}: {value!r} does not match {schema['pattern']}")
    if "minimum" in schema and value < schema["minimum"]:
        raise SpecsNdkError(f"{where}: below minimum {schema['minimum']}")
    if "minLength" in schema and len(value) < schema["minLength"]:
        raise SpecsNdkError(f"{where}: shorter than {schema['minLength']}")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                raise SpecsNdkError(f"{where}.{key}: missing")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                _check(props[key], item, f"{where}.{key}")
            elif schema.get("additionalProperties") is False:
                raise SpecsNdkError(f"{where}.{key}: unexpected field")


def validate(name: str, value: object) -> object:
    """Validate value against $defs/<name> in specsndk.schema.json and return it unchanged."""
    _check(SCHEMA["$defs"][name], value, name)
    return value


def validate_manifest(data: object, platform: str) -> dict:
    """Return the fields this tool uses; raise SpecsNdkError on any schema violation."""
    try:
        validate("manifest", data)
    except SpecsNdkError as exc:
        raise SpecsNdkError(f"invalid manifest: {exc}") from exc
    latest = data["latest"]
    entry = latest["downloads"].get(platform)
    if entry is None:
        raise SpecsNdkError(f"manifest: no download for platform {platform!r}")
    sources = data.get("versionSources") or {"file": DEFAULT_VERSION_FILE, "key": DEFAULT_VERSION_KEY}
    return {
        "version": latest["version"],
        "releaseDate": latest.get("releaseDate"),
        "minOsVersion": latest.get("minOsVersion"),
        "url": entry["url"],
        "sizeBytes": entry["sizeBytes"],
        "filename": entry.get("filename"),
        "versionFile": sources["file"],
        "versionKey": sources["key"],
    }


def fetch_manifest(url: str, platform: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_MANIFEST) as resp:
            raw = resp.read()
    except (urllib.error.URLError, OSError) as exc:
        raise SpecsNdkError(f"could not fetch manifest {url}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SpecsNdkError(f"manifest is not valid JSON: {exc}") from exc
    return validate_manifest(data, platform)


def read_installed_version(root: Path, version_file: str, version_key: str) -> str | None:
    path = root / version_file
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() == version_key and value.strip():
            return value.strip()
    return None


def is_populated(root: Path) -> bool:
    return root.is_dir() and any(root.iterdir())


def require_dir_or_absent(root: Path) -> None:
    """The SDK root must be a directory or not exist; never delete a user's file there."""
    if root.exists() and not root.is_dir():
        raise SpecsNdkError(f"SDK root {root} exists but is not a directory; move it or pass --root")


def cmake_status() -> dict:
    exe = shutil.which("cmake")
    if not exe:
        return {"found": False, "version": None}
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return {"found": False, "version": None}
    match = re.search(r"cmake version (\S+)", out)
    return {"found": True, "version": match.group(1) if match else None}


def check(root: Path, manifest_url: str) -> dict:
    platform = host_platform()
    manifest = None
    manifest_error = None
    try:
        manifest = fetch_manifest(manifest_url, platform)
    except SpecsNdkError as exc:
        manifest_error = str(exc)

    require_dir_or_absent(root)
    version_file = manifest["versionFile"] if manifest else DEFAULT_VERSION_FILE
    version_key = manifest["versionKey"] if manifest else DEFAULT_VERSION_KEY
    populated = is_populated(root)
    installed = read_installed_version(root, version_file, version_key) if populated else None

    if not populated:
        if manifest is None:
            raise SpecsNdkError(f"SpecsNDK is not installed at {root} and {manifest_error}")
        status = "missing"
    elif manifest is None:
        status = "unknown"
    elif installed is None or not re.fullmatch(r"\d+(\.\d+)*", installed):
        status = "unversioned"
    else:
        cmp = compare_versions(installed, manifest["version"])
        status = "outdated" if cmp < 0 else "current" if cmp == 0 else "newer"

    return {
        "ok": True,
        "status": status,
        "root": str(root),
        "platform": platform,
        "installedVersion": installed,
        "latestVersion": manifest["version"] if manifest else None,
        "releaseDate": manifest["releaseDate"] if manifest else None,
        "minOsVersion": manifest["minOsVersion"] if manifest else None,
        "downloadBytes": manifest["sizeBytes"] if manifest else None,
        "cmake": cmake_status(),
        "manifestError": manifest_error,
    }


def download(url: str, dest: Path, expected_size: int) -> None:
    received = 0
    next_report = 0
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_DOWNLOAD) as resp, open(dest, "wb") as out:
            while True:
                chunk = resp.read(CHUNK_BYTES)
                if not chunk:
                    break
                out.write(chunk)
                received += len(chunk)
                if expected_size and received >= next_report:
                    print(f"downloaded {received * 100 // expected_size}% ({received} bytes)", file=sys.stderr)
                    next_report += expected_size // 10 or 1
    except (urllib.error.URLError, OSError) as exc:
        raise SpecsNdkError(f"download failed: {exc}") from exc
    if received != expected_size:
        raise SpecsNdkError(f"download size mismatch: got {received} bytes, manifest says {expected_size}")


def _within(path: str, root: str) -> bool:
    return os.path.commonpath([path, root]) == root


def extract(archive: Path, dest: Path) -> None:
    """Extract archive into dest without ever writing outside dest.

    The SDK sysroot legitimately contains symlinks to absolute host paths (for example
    etc/ld.so.cache -> /etc/ld.so.cache), which tarfile's "data" filter rejects. So
    instead of that filter, members are extracted one at a time and checked against
    the real filesystem as it is built:
    - files and directories must resolve inside dest after following any symlink
      already extracted, so a link can never redirect a later write outside dest;
    - symlinks are created as-is, but only at a location inside dest;
    - hard links must point inside dest; any other member type is rejected;
    - setuid/setgid/sticky bits and group/other write bits are dropped;
    - directories always get owner rwx: unlike extractall(), per-member extract() applies
      modes immediately, so a read-only directory would block its own contents (and later
      make the SDK or its backup undeletable).
    """
    root = os.path.realpath(dest)
    trusted = {"filter": "fully_trusted"} if hasattr(tarfile, "fully_trusted_filter") else {}
    try:
        with tarfile.open(archive, "r:*") as tar:
            for member in tar:
                name = member.name
                if os.path.isabs(name) or os.path.splitdrive(name)[0]:
                    raise SpecsNdkError(f"archive member has an absolute path: {name}")
                path = os.path.join(root, name)
                if member.issym():
                    where = os.path.join(os.path.realpath(os.path.dirname(path)), os.path.basename(path))
                elif member.isfile() or member.isdir() or member.islnk():
                    where = os.path.realpath(path)
                else:
                    raise SpecsNdkError(f"archive member has unsupported type: {name}")
                if not _within(where, root):
                    raise SpecsNdkError(f"archive member escapes destination: {name}")
                if member.islnk() and not _within(os.path.realpath(os.path.join(root, member.linkname)), root):
                    raise SpecsNdkError(f"archive hard link escapes destination: {name} -> {member.linkname}")
                member.mode &= 0o755
                if member.isdir():
                    member.mode |= 0o700
                tar.extract(member, root, set_attrs=not member.issym(), **trusted)
    except (tarfile.TarError, OSError) as exc:
        raise SpecsNdkError(f"extract failed: {exc}") from exc


def clear_download_flags(root: Path, platform: str) -> None:
    if platform == "darwin" and shutil.which("xattr"):
        subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(root)], capture_output=True)


def unique_sibling(root: Path, suffix: str) -> Path:
    candidate = root.with_name(f"{root.name}{suffix}")
    n = 2
    while candidate.exists():
        candidate = root.with_name(f"{root.name}{suffix}-{n}")
        n += 1
    return candidate


def install(root: Path, manifest_url: str, keep_backup: bool) -> dict:
    platform = host_platform()
    manifest = fetch_manifest(manifest_url, platform)
    root = root.expanduser().absolute()
    require_dir_or_absent(root)
    root.parent.mkdir(parents=True, exist_ok=True)

    previous = None
    if is_populated(root):
        previous = read_installed_version(root, manifest["versionFile"], manifest["versionKey"])

    # Stage next to root so the final swap is a same-filesystem rename.
    staging = Path(tempfile.mkdtemp(prefix=f".{root.name}-staging-", dir=root.parent))
    archive = staging.with_name(staging.name + ".tar")
    backup = None
    try:
        print(f"downloading SpecsNDK {manifest['version']} ({manifest['sizeBytes']} bytes)", file=sys.stderr)
        download(manifest["url"], archive, manifest["sizeBytes"])
        print("extracting", file=sys.stderr)
        extract(archive, staging)
        staged_version = read_installed_version(staging, manifest["versionFile"], manifest["versionKey"])
        if staged_version is None or compare_versions(staged_version, manifest["version"]) != 0:
            raise SpecsNdkError(
                f"archive reports version {staged_version!r}, manifest says {manifest['version']!r}; not installing"
            )

        if root.exists():
            if is_populated(root):
                backup = unique_sibling(root, f".backup-{previous or 'unversioned'}")
                root.rename(backup)
            else:
                root.rmdir()
        staging.rename(root)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if backup is not None and not root.exists():
            backup.rename(root)
        raise
    finally:
        archive.unlink(missing_ok=True)

    clear_download_flags(root, platform)
    if backup is not None and not keep_backup:
        shutil.rmtree(backup, ignore_errors=True)
        backup = None

    return {
        "ok": True,
        "root": str(root),
        "installedVersion": manifest["version"],
        "previousVersion": previous,
        "backupPath": str(backup) if backup else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check for and install SpecsNDK releases")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("check", "install"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, default=None, help="SDK root (default: $SPECSNDK_ROOT or ~/Dev/SpecsNDK)")
        p.add_argument("--manifest-url", default=MANIFEST_URL)
        if name == "install":
            p.add_argument("--no-backup", action="store_true", help="Delete the previous SDK after a successful update")
    args = parser.parse_args(argv)
    root = (args.root or default_root()).expanduser()

    try:
        if args.command == "check":
            result = check(root, args.manifest_url)
        else:
            result = install(root, args.manifest_url, keep_backup=not args.no_backup)
        validate("checkResult" if args.command == "check" else "installResult", result)
    except (SpecsNdkError, OSError) as exc:
        # OSError: unexpected filesystem failures (permissions, disk full) still yield one JSON result.
        print(json.dumps(validate("errorResult", {"ok": False, "error": str(exc) or type(exc).__name__})))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
