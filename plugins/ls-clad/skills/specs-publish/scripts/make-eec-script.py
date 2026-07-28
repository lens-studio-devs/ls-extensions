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

    make-eec-script.py TARGET.ts --set NAME=VALUE [...] [--json NAME=FILE ...]

--set takes a raw string: pass it exactly as intended, no escaping. --json reads
an object const (BODY, EXTRA_HEADERS) from a JSON file — write that file with
your editor tool and free text never touches the shell.

Only the value is replaced, so each declaration's type annotation and trailing
comment survive as written. That is load-bearing: text-to-3d-request.ts compares
METHOD === "GET", which only compiles while METHOD is declared ": string".
"""

import argparse
import json
import os
import re
import sys
import tempfile

# const NAME[: Type] = value;   [// trailing comment]
DECL = re.compile(r"(?P<head>const\s+(?P<name>\w+)\b[^=]*?)\s*=\s*.*?;(?P<comment>\s*//.*)?$")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", help="pinned .ts script with a CONFIG block")
    ap.add_argument("--set", action="append", default=[], metavar="NAME=VALUE", help="string const, raw value")
    ap.add_argument("--json", action="append", default=[], metavar="NAME=FILE", help="object const, JSON from FILE")
    args = ap.parse_args()

    values = {}
    for raw in args.set:
        name, _, value = raw.partition("=")
        values[name] = json.dumps(value)
    for raw in args.json:
        name, _, path = raw.partition("=")
        try:
            with open(path, encoding="utf-8") as fh:
                values[name] = json.dumps(json.load(fh))
        except (OSError, json.JSONDecodeError) as e:
            sys.exit(f"make-eec-script: --json {name}: {path}: {e}")

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

    fd, path = tempfile.mkstemp(prefix=os.path.basename(args.target).removesuffix(".ts") + ".", suffix=".configured.ts")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    print(path)


if __name__ == "__main__":
    main()
