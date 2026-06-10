#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
# Optional output directory for the built .so.
OUTPUT_SO_DIR="{{OUTPUT_SO_DIR_DEFAULT}}"

# Optional override; default is ~/Dev/SpecsNDK ($HOME expands when this script runs).
SPECSNDK_ROOT_ARG="${1:-{{SPECSNDK_ROOT_DEFAULT_SHELL}}}"

cmake -S "${SCRIPT_DIR}" -B "${BUILD_DIR}" \
  -DSPECSNDK_ROOT="${SPECSNDK_ROOT_ARG}" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}"

if [[ -n "${OUTPUT_SO_DIR:-}" ]]; then
  mkdir -p "${OUTPUT_SO_DIR}"
  cp "${BUILD_DIR}/lib{{MODULE_NAME}}.so" "${OUTPUT_SO_DIR}/"
  echo "Copied lib{{MODULE_NAME}}.so to ${OUTPUT_SO_DIR}"
fi

echo "Built {{MODULE_NAME}} successfully."
