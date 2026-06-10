#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""
Persistent Perfetto Trace Query Server
=======================================
Launch with:  python -u trace_server.py <trace_file> [--row-limit N]

The -u flag disables Python's stdout buffering. This is critical.
Without it, the pipe to your harness will deadlock.

Default row limit is 200. You almost certainly do not need more.
If you are hitting the limit, your query is too broad — narrow your
SELECT and WHERE before reaching for --row-limit. Must be a positive
integer; there is no unlimited mode.

Trace paths containing spaces or parentheses are copied to a temp file
before opening (same workaround as analyze_lens_trace.py); TraceProcessor
can be picky about those paths on some platforms.

Protocol
--------
- Reads one SQL query per line from stdin.
- Writes CSV results to stdout, terminated by END_OF_QUERY.
- Send "EXIT" (and newline) to shut down cleanly.

Parsing Contract (for the harness / agent)
------------------------------------------
Read stdout line-by-line. Accumulate lines until you hit a line
that is exactly "END_OF_QUERY". Everything before that delimiter
is the result of the query — either CSV text, "NO_RESULTS", or
an error prefixed with "SQL Error:".

Row Limit
---------
Results are capped at 200 rows. This is intentional. It forces you,
the LLM, to do a hierarchical scan on bottlenecks rather than dumping
entire tables and drowning your context window. Start at depth 0,
find the long poles, then drill deeper with narrower queries.
"""

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional, Tuple

try:
    import pandas as pd
except ImportError as e:
    print(f"Missing dependency: {e}", file=sys.stderr)
    print("Install with: pip install perfetto pandas", file=sys.stderr)
    sys.exit(1)

try:
    from perfetto.trace_processor import TraceProcessor
except ImportError:
    try:
        from perfetto.trace_processor.api import TraceProcessor  # type: ignore[no-redef]
    except ImportError as e:
        print(f"Missing dependency: {e}", file=sys.stderr)
        print("Install with: pip install perfetto pandas", file=sys.stderr)
        sys.exit(1)

DEFAULT_ROW_LIMIT = 200


def _query_result_to_dataframe(query_result):
    """
    Build a pandas DataFrame from a TraceProcessor query result.
    Wheel APIs have used slightly different method names; try known variants.
    """
    for name in ("as_pandas_dataframe", "as_pandas_data_frame"):
        fn = getattr(query_result, name, None)
        if callable(fn):
            return fn()
    raise TypeError(
        "Query result has no as_pandas_dataframe() (or legacy alias) — "
        "upgrade the perfetto Python package."
    )


def _prepare_trace_load_path(trace_file: str) -> Tuple[str, Optional[str]]:
    """
    Return (path_for_trace_processor, temp_path_or_none).
    Copies to a temp .pftrace when the path has spaces or parentheses.
    """
    resolved = Path(trace_file).expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"Trace file not found: {resolved}")

    path_str = str(resolved)
    needs_temp = " " in path_str or "(" in path_str or ")" in path_str
    if not needs_temp:
        return path_str, None

    fd, tmp = tempfile.mkstemp(suffix=".pftrace", prefix="trace_server_")
    os.close(fd)
    try:
        shutil.copy2(path_str, tmp)
    except Exception:
        if os.path.isfile(tmp):
            try:
                os.remove(tmp)
            except OSError as e:
                print(f"Warning: could not remove temp file {tmp}: {e}", file=sys.stderr)
        raise
    return tmp, tmp


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Persistent Perfetto trace query server.",
    )
    parser.add_argument("trace_file", help="Path to the .pftrace file")
    parser.add_argument(
        "--row-limit",
        type=int,
        default=DEFAULT_ROW_LIMIT,
        help=f"Max rows returned per query (default: {DEFAULT_ROW_LIMIT}). "
        f"Must be a positive integer. If you need more rows, narrow your query instead.",
    )
    args = parser.parse_args()

    if args.row_limit <= 0:
        parser.error("--row-limit must be a positive integer.")
    row_limit = args.row_limit

    try:
        load_path, temp_path = _prepare_trace_load_path(args.trace_file)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Could not prepare trace path: {e}", file=sys.stderr)
        sys.exit(1)

    display_path = Path(args.trace_file).expanduser().resolve()
    print(f"Loading trace: {display_path}", file=sys.stderr)

    tp = None
    try:
        tp = TraceProcessor(trace=load_path)
        print("Ready.", file=sys.stderr)
    except Exception as e:
        print(f"Fatal error loading trace: {e}", file=sys.stderr)
        if temp_path and os.path.isfile(temp_path):
            try:
                os.remove(temp_path)
            except OSError as e:
                print(f"Warning: could not remove temp file {temp_path}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        for line in sys.stdin:
            sql_query = line.strip()

            if not sql_query:
                continue
            if sql_query == "EXIT":
                break

            try:
                qr = tp.query(sql_query)
                df = _query_result_to_dataframe(qr)

                if df.empty:
                    print("NO_RESULTS")
                else:
                    total_rows = len(df)
                    truncated = row_limit and total_rows > row_limit
                    df_out = df.head(row_limit).copy()
                    # Sanitize string columns: embedded newlines in a cell would break
                    # the line-based END_OF_QUERY protocol.
                    # Note: astype(str) converts NaN/None to literal "nan"/"None" —
                    # acceptable for SQL debugging output. Only object-dtype columns
                    # are checked; Perfetto results are numeric-heavy so this covers
                    # the realistic cases.
                    for col in df_out.select_dtypes(include="object").columns:
                        df_out[col] = df_out[col].astype(str).str.replace(
                            r"\r?\n", " ", regex=True
                        )
                    output = df_out.to_csv(index=False)
                    print(output, end="")

                    if truncated:
                        print(
                            f"# TRUNCATED: showing {row_limit} of {total_rows} rows. "
                            f"Narrow your SELECT columns and WHERE clause."
                        )

            except Exception as e:
                error_msg = str(e).replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
                print(f"SQL Error: {error_msg}")

            print("END_OF_QUERY")
            sys.stdout.flush()
    finally:
        if tp is not None:
            try:
                tp.close()
            except Exception as e:
                print(f"Warning: tp.close() failed: {e}", file=sys.stderr)
        if temp_path and os.path.isfile(temp_path):
            try:
                os.remove(temp_path)
            except OSError as e:
                print(f"Warning: could not remove temp file {temp_path}: {e}", file=sys.stderr)

    print("Shutdown complete.", file=sys.stderr)


if __name__ == "__main__":
    main()
