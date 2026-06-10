#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import re
import shutil
import stat
from pathlib import Path

VALID_MODULE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TOKEN_MODULE_NAME = "{{MODULE_NAME}}"
TOKEN_FEATURE_NAME = "{{FEATURE_NAME}}"
TOKEN_SPECSNDK_ROOT_DEFAULT_CMAKE = "{{SPECSNDK_ROOT_DEFAULT_CMAKE}}"
TOKEN_SPECSNDK_ROOT_DEFAULT_SHELL = "{{SPECSNDK_ROOT_DEFAULT_SHELL}}"
TOKEN_OUTPUT_SO_DIR_DEFAULT = "{{OUTPUT_SO_DIR_DEFAULT}}"
TOKEN_DEFAULT_EXPORTS_BLURB = "{{DEFAULT_EXPORTS_BLURB}}"

# Removed from generated sources when --with-rgba-frame is not passed (see resources/NativeModule/*.tpl).
CPP_RGBA_STRIP_ORDER: list[tuple[str, str]] = [
    ("// SPECSNDK_RGBA_REGISTER_BEGIN\n", "// SPECSNDK_RGBA_REGISTER_END\n"),
    ("// SPECSNDK_RGBA_IMPL_BEGIN\n", "// SPECSNDK_RGBA_IMPL_END\n"),
]
TS_NATIVE_RGBA_STRIP_ORDER: list[tuple[str, str]] = [
    ("// SPECSNDK_RGBA_EXPORT_BEGIN\n", "// SPECSNDK_RGBA_EXPORT_END\n"),
    ("// SPECSNDK_RGBA_TYPES_BEGIN\n", "// SPECSNDK_RGBA_TYPES_END\n"),
]
CONTROLLER_RGBA_STRIP_ORDER: list[tuple[str, str]] = [
    ("// SPECSNDK_RGBA_TEX_BEGIN\n", "// SPECSNDK_RGBA_TEX_END\n"),
    ("// SPECSNDK_RGBA_ONUPDATE_BEGIN\n", "// SPECSNDK_RGBA_ONUPDATE_END\n"),
    ("// SPECSNDK_RGBA_ONAWAKE_BEGIN\n", "// SPECSNDK_RGBA_ONAWAKE_END\n"),
    ("// SPECSNDK_RGBA_FIELDS_BEGIN\n", "// SPECSNDK_RGBA_FIELDS_END\n"),
]
PING_ONAWAKE_STRIP_ORDER: list[tuple[str, str]] = [
    ("// SPECSNDK_PING_ONAWAKE_BEGIN\n", "// SPECSNDK_PING_ONAWAKE_END\n"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scaffold a SpecsNDK native module from template.")
    parser.add_argument("--name", required=True, help="Module name (PascalCase or valid C/C++ identifier).")
    parser.add_argument(
        "--out",
        default="sandbox/generated",
        help="Output parent directory (absolute or relative to repository root). Default: sandbox/generated",
    )
    parser.add_argument(
        "--specsndk-root-default",
        default="auto",
        help=(
            "Default SPECSNDK_ROOT written into generated files. "
            "Use 'auto' for ~/Dev/SpecsNDK ($HOME/Dev/SpecsNDK and $ENV{HOME}/Dev/SpecsNDK in CMake)."
        ),
    )
    parser.add_argument(
        "--force", action="store_true", help="Overwrite existing module directory if it already exists."
    )
    parser.add_argument(
        "--with-rgba-frame",
        action="store_true",
        help=(
            "Scaffold getFrameRGBA in C++/TS, copy resources/LensStudio/FlippedImage.lspkg into the project's "
            "Assets/Prefabs/, controller preview (requireAsset + instantiate under camera), and README notes. "
            "Without this flag, only ping() is exported (see SKILL.md)."
        ),
    )
    return parser.parse_args()


def skill_root() -> Path:
    """specs-ndk skill directory (parent of tools/ and resources/)."""
    return Path(__file__).resolve().parent.parent


RESOURCES_NATIVE_MODULE_SUBDIR = "NativeModule"
RESOURCES_LENS_STUDIO_SUBDIR = "LensStudio"


def templates_dir() -> Path:
    """Skill `resources/` root (`NativeModule/` = C++ tpls, `LensStudio/` = TS tpls + `FlippedImage.lspkg` for RGBA)."""

    return skill_root() / "resources"


def resolve_output_parent(out_arg: str) -> Path:
    """Absolute path for the module folder; relative paths are resolved from cwd."""
    out_path = Path(out_arg)
    if out_path.is_absolute():
        return out_path.resolve()
    return (Path.cwd() / out_path).resolve()


def validate_module_name(name: str) -> None:
    if not VALID_MODULE_RE.match(name):
        raise ValueError(
            f"Invalid module name '{name}'. Use a valid identifier like CLADNativeModule or ExampleModule."
        )


def feature_name_from_module(module_name: str) -> str:
    """Strip trailing 'Module' for Lens script / class names (e.g. AudioPitchShiftModule -> AudioPitchShift)."""
    suffix = "Module"
    if module_name.endswith(suffix) and len(module_name) > len(suffix):
        return module_name[: -len(suffix)]
    return module_name


def specsndk_root_pair(specsndk_root_default: str) -> tuple[str, str]:
    """Return (cmake_literal, shell_literal) for SPECSNDK_ROOT defaults."""
    if specsndk_root_default == "auto":
        return ("$ENV{HOME}/Dev/SpecsNDK", "$HOME/Dev/SpecsNDK")
    return (specsndk_root_default, specsndk_root_default)


def render_template(
    raw: str,
    module_name: str,
    specsndk_root_cmake: str,
    specsndk_root_shell: str,
    output_so_dir_default: str,
    feature_name: str | None = None,
    default_exports_blurb: str | None = None,
) -> str:
    out = (
        raw.replace(TOKEN_MODULE_NAME, module_name)
        .replace(TOKEN_SPECSNDK_ROOT_DEFAULT_CMAKE, specsndk_root_cmake)
        .replace(TOKEN_SPECSNDK_ROOT_DEFAULT_SHELL, specsndk_root_shell)
        .replace(TOKEN_OUTPUT_SO_DIR_DEFAULT, output_so_dir_default)
    )
    if feature_name is not None:
        out = out.replace(TOKEN_FEATURE_NAME, feature_name)

    if default_exports_blurb is not None:
        out = out.replace(TOKEN_DEFAULT_EXPORTS_BLURB, default_exports_blurb)
    return out


def strip_marked_regions(text: str, begin_marker: str, end_marker: str) -> str:
    """Remove begin_marker through end_marker (inclusive), including one trailing newline after end if present."""
    i = text.find(begin_marker)
    if i == -1:
        return text
    j = text.find(end_marker, i)
    if j == -1:
        return text
    k = j + len(end_marker)
    if k < len(text) and text[k] == "\n":
        k += 1
    return text[:i] + text[k:]


def strip_rgba_optional_sections(text: str, ordered_pairs: list[tuple[str, str]]) -> str:
    for begin, end in ordered_pairs:
        while begin in text and end in text:
            new_text = strip_marked_regions(text, begin, end)
            if new_text == text:
                break
            text = new_text
    return text


def remove_scaffold_marker_comment_lines(text: str) -> str:
    """Drop SPECSNDK_* marker lines left after optional strips."""
    return re.sub(
        r"^[ \t]*// SPECSNDK_(RGBA_[A-Z0-9_]+|PING_ONAWAKE)_(BEGIN|END)[ \t]*\r?\n",
        "",
        text,
        flags=re.MULTILINE,
    )


def copy_rgba_preview_assets(output_parent: Path, template_dir: Path, force: bool) -> None:
    """Copy resources/LensStudio/FlippedImage.lspkg into <project>/Assets/Prefabs/ (does not create Assets/)."""
    src = template_dir / RESOURCES_LENS_STUDIO_SUBDIR / "FlippedImage.lspkg"
    assets_dir = output_parent / "Assets"
    if not assets_dir.is_dir():
        print(
            f"Warning: {assets_dir} does not exist — pass --out as the Lens Studio project root "
            f"(folder that already contains Assets/). Skipping FlippedImage.lspkg copy."
        )
        return
    if not src.exists():
        print(f"Warning: missing bundled preview package: {src}")
        return
    prefabs_dir = assets_dir / "Prefabs"
    prefabs_dir.mkdir(exist_ok=True)
    dest = prefabs_dir / "FlippedImage.lspkg"
    if dest.exists() and not force:
        print(f"Skipping (exists): {dest}")
        return
    try:
        if dest.exists() and force:
            if dest.is_dir():
                shutil.rmtree(dest)
            else:
                dest.unlink()
        if src.is_dir():
            shutil.copytree(src, dest)
        else:
            shutil.copy2(src, dest)
        print(f"Wrote: {dest}")
    except OSError as err:
        print(f"Warning: could not copy {src} -> {dest}: {err}")


def default_exports_readme_blurb(with_rgba_frame: bool) -> str:
    if with_rgba_frame:
        return (
            "Default exports: `ping()`, `getFrameRGBA()` → "
            "`{ buffer: ArrayBuffer, width: number, height: number }` "
            "(animated RGBA8 frame; default 256×256, set in C++). "
            "Copies **`resources/LensStudio/FlippedImage.lspkg`** into **`Assets/Prefabs/`** (RGBA preview package)."
        )
    return (
        "Default exports: `ping()` only. Pass `--with-rgba-frame` to `scaffold.py` to also "
        "scaffold `getFrameRGBA()`, preview assets under **`Assets/`**, "
        "and the runtime preview path (see **SKILL.md**)."
    )


def scaffold_module(
    module_name: str, output_parent: Path, specsndk_root_default: str, force: bool, with_rgba_frame: bool
) -> Path:

    template_dir = templates_dir()
    if not template_dir.exists():
        raise FileNotFoundError(f"Missing template directory: {template_dir}")

    output_parent.mkdir(parents=True, exist_ok=True)
    module_dir = output_parent / module_name
    if module_dir.exists():
        if not force:
            raise FileExistsError(f"Module path already exists: {module_dir}. Re-run with --force to overwrite.")
    else:
        module_dir.mkdir(parents=True, exist_ok=True)

    specsndk_cmake, specsndk_shell = specsndk_root_pair(specsndk_root_default)

    # Module folder is expected beside Assets/ at the Lens Studio project root.
    output_so_dir_default = str((module_dir.parent / "Assets" / "NativeModules").resolve())

    nm = RESOURCES_NATIVE_MODULE_SUBDIR
    file_map = {
        f"{nm}/CMakeLists.txt.tpl": "CMakeLists.txt",
        f"{nm}/Module.cpp.tpl": f"{module_name}.cpp",
        f"{nm}/Module.hpp.tpl": f"{module_name}.hpp",
        f"{nm}/HostFunctionWrapper.hpp.tpl": "HostFunctionWrapper.hpp",
        f"{nm}/build.sh.tpl": "build.sh",
        "README.md.tpl": "README.md",
    }

    for template_name, output_name in file_map.items():
        template_path = template_dir / template_name
        output_path = module_dir / output_name
        rendered = render_template(
            template_path.read_text(encoding="utf-8"),
            module_name=module_name,
            specsndk_root_cmake=specsndk_cmake,
            specsndk_root_shell=specsndk_shell,
            output_so_dir_default=output_so_dir_default,
            default_exports_blurb=default_exports_readme_blurb(with_rgba_frame) if output_name == "README.md" else None,
        )
        if output_name == f"{module_name}.cpp":
            if not with_rgba_frame:
                rendered = strip_rgba_optional_sections(rendered, CPP_RGBA_STRIP_ORDER)
            rendered = remove_scaffold_marker_comment_lines(rendered)

        output_path.write_text(rendered, encoding="utf-8")
        if output_name == "build.sh":
            output_path.chmod(output_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    feature_name = feature_name_from_module(module_name)
    scripts_dir = output_parent / "Assets" / "Scripts"

    ls = RESOURCES_LENS_STUDIO_SUBDIR
    native_sidecar_tpl = template_dir / ls / "NativeModuleDecorator.ts.tpl"
    native_sidecar_out = scripts_dir / f"{feature_name}NativeModule.ts"
    controller_tpl = template_dir / ls / "Controller.ts.tpl"

    controller_out = scripts_dir / f"{feature_name}Controller.ts"

    if native_sidecar_tpl.exists():
        if native_sidecar_out.exists() and not force:
            print(f"Skipping native module TS (already exists): {native_sidecar_out}")
        else:
            scripts_dir.mkdir(parents=True, exist_ok=True)
            native_body = render_template(
                native_sidecar_tpl.read_text(encoding="utf-8"),
                module_name=module_name,
                specsndk_root_cmake=specsndk_cmake,
                specsndk_root_shell=specsndk_shell,
                output_so_dir_default=output_so_dir_default,
                feature_name=feature_name,
            )

            if not with_rgba_frame:
                native_body = strip_rgba_optional_sections(native_body, TS_NATIVE_RGBA_STRIP_ORDER)
            native_body = remove_scaffold_marker_comment_lines(native_body)

            native_sidecar_out.write_text(native_body, encoding="utf-8")
            print(f"Wrote native module TS: {native_sidecar_out}")

    if controller_tpl.exists():
        if controller_out.exists() and not force:
            print(f"Skipping controller (already exists): {controller_out}")
        else:
            scripts_dir.mkdir(parents=True, exist_ok=True)
            body = render_template(
                controller_tpl.read_text(encoding="utf-8"),
                module_name=module_name,
                specsndk_root_cmake=specsndk_cmake,
                specsndk_root_shell=specsndk_shell,
                output_so_dir_default=output_so_dir_default,
                feature_name=feature_name,
            )

            if not with_rgba_frame:
                body = strip_rgba_optional_sections(body, CONTROLLER_RGBA_STRIP_ORDER)
            else:
                body = strip_rgba_optional_sections(body, PING_ONAWAKE_STRIP_ORDER)
            body = remove_scaffold_marker_comment_lines(body)
            controller_out.write_text(body, encoding="utf-8")
            print(f"Wrote controller: {controller_out}")

    if with_rgba_frame:
        copy_rgba_preview_assets(output_parent, template_dir, force)

    return module_dir


def main() -> int:
    args = parse_args()
    validate_module_name(args.name)
    output_parent = resolve_output_parent(args.out)
    module_dir = scaffold_module(
        module_name=args.name,
        output_parent=output_parent,
        specsndk_root_default=args.specsndk_root_default,
        force=args.force,
        with_rgba_frame=args.with_rgba_frame,
    )
    print(f"Scaffolded module at: {module_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
