# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import os
import sys
from pathlib import Path

from .json_io import Envelope, emit_stderr, emit_stdout


def run_install_link() -> int:
    if sys.platform == "win32":
        emit_stdout(Envelope.error("install-link is POSIX-only; on Windows invoke the wrapper by absolute path."))
        return 1

    # tools/lsdbg/install_link.py → tools/lsdbg → tools → <skill-dir>
    skill_dir = Path(__file__).resolve().parent.parent.parent
    source = skill_dir / "scripts" / "lsdbg"
    if not source.exists():
        emit_stdout(Envelope.error(f"wrapper not found at expected location: {source}"))
        return 1

    target_dir = Path.home() / ".local" / "bin"
    target = target_dir / "lsdbg"

    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        emit_stdout(Envelope.error(f"could not create {target_dir}: {e}"))
        return 1

    action: str
    if target.is_symlink():
        try:
            current = os.readlink(target)
        except OSError as e:
            emit_stdout(Envelope.error(f"could not read existing symlink {target}: {e}"))
            return 1
        # Resolve relative symlink targets the same way the OS would so
        # the comparison doesn't false-negative on a relative existing link.
        current_abs = (target.parent / current).resolve() if not os.path.isabs(current) else Path(current).resolve()
        if current_abs == source.resolve():
            action = "unchanged"
        else:
            try:
                target.unlink()
                target.symlink_to(source)
            except OSError as e:
                emit_stdout(Envelope.error(f"could not replace symlink {target}: {e}"))
                return 1
            action = "updated"
    elif target.exists():
        emit_stdout(
            Envelope.error(
                f"{target} exists and is not a symlink; refusing to overwrite. Move it aside or remove it and re-run."
            )
        )
        return 1
    else:
        try:
            target.symlink_to(source)
        except OSError as e:
            emit_stdout(Envelope.error(f"could not create symlink {target}: {e}"))
            return 1
        action = "created"

    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    on_path = any(Path(p) == target_dir for p in path_entries if p)

    emit_stdout(
        Envelope.success(
            {
                "linked": str(target),
                "target": str(source),
                "on_path": on_path,
                "action": action,
            }
        )
    )
    if not on_path:
        emit_stderr(
            f"note: {target_dir} is not on PATH. Add it to your shell rc "
            '(e.g. `export PATH="$HOME/.local/bin:$PATH"`) before invoking bare `lsdbg`.'
        )
    return 0
