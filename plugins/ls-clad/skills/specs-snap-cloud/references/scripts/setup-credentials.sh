#!/usr/bin/env bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# setup-credentials.sh
# Generates a .supabaseProject asset for a Snap Cloud project without touching Lens Studio.
# The only human step: a browser login on first run.
#
# Usage:
#   ./setup-credentials.sh [--project-ref <ref>] [--out <path>] [--name <name>]
#
# Options:
#   --project-ref   Snap Cloud project ref (e.g. xcuslfeoetnflddtndmx). If omitted, lists
#                   available projects and prompts for selection.
#   --out           Output path for the .supabaseProject file.
#                   Default: Assets/SnapCloud_<ref>.supabaseProject
#   --name          Human-readable project name embedded in the asset. Default: MyLens
#
# Examples:
#   ./setup-credentials.sh --project-ref xcuslfeoetnflddtndmx
#   ./setup-credentials.sh --project-ref xcuslfeoetnflddtndmx --out Assets/MyProject.supabaseProject --name "Edge Test"

set -euo pipefail

PROJECT_REF=""
OUT_PATH=""
PROJECT_NAME="MyLens"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --project-ref) PROJECT_REF="$2"; shift 2 ;;
    --out)         OUT_PATH="$2";    shift 2 ;;
    --name)        PROJECT_NAME="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Step 1: Ensure supabase CLI is installed ──────────────────────────────────
if ! command -v supabase &>/dev/null; then
  echo "[snap-cloud] supabase CLI not found. Installing via Homebrew..."
  if command -v brew &>/dev/null; then
    brew install supabase/tap/supabase
  else
    echo "[snap-cloud] ERROR: Homebrew not available. Install supabase CLI manually:"
    echo "  https://supabase.com/docs/guides/cli/getting-started"
    exit 1
  fi
fi

# ── Step 2: Authenticate (browser login, one-time per machine) ────────────────
# supabase login is a no-op if already authenticated
echo "[snap-cloud] Authenticating with Snap Cloud (browser will open if not already logged in)..."
supabase --profile snap login

# ── Step 3: Pick a project ───────────────────────────────────────────────────
if [[ -z "$PROJECT_REF" ]]; then
  echo ""
  echo "[snap-cloud] Available projects:"
  supabase --profile snap projects list
  echo ""
  read -rp "Enter project ref from the list above: " PROJECT_REF
fi

if [[ -z "$PROJECT_REF" ]]; then
  echo "[snap-cloud] ERROR: No project ref provided."
  exit 1
fi

# ── Step 4: Extract the anon (public) key ────────────────────────────────────
echo "[snap-cloud] Fetching API keys for project: $PROJECT_REF ..."

ANON_KEY=$(supabase --profile snap projects api-keys \
  --project-ref "$PROJECT_REF" --output json \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
match = next((k['api_key'] for k in data if k['name'] == 'anon'), None)
if not match:
    raise SystemExit('anon key not found in project api-keys response')
print(match)
")

PROJECT_URL="https://${PROJECT_REF}.snapcloud.dev"

# ── Step 5: Generate UUID for the asset tag ───────────────────────────────────
if command -v python3 &>/dev/null; then
  UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
elif command -v uuidgen &>/dev/null; then
  UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
else
  echo "[snap-cloud] ERROR: Need python3 or uuidgen to generate a UUID."
  exit 1
fi

# ── Step 6: Write the .supabaseProject asset file ─────────────────────────────
if [[ -z "$OUT_PATH" ]]; then
  mkdir -p Assets
  OUT_PATH="Assets/SnapCloud_${PROJECT_REF}.supabaseProject"
fi

# Ensure parent directory exists
mkdir -p "$(dirname "$OUT_PATH")"

cat > "$OUT_PATH" << EOF
- !<SupabaseProject/${UUID}>
  PackagePath: ""
  ProjectId: ${PROJECT_REF}
  ProjectName: ${PROJECT_NAME}
  ProjectUrl: "${PROJECT_URL}"
  PublicToken: ${ANON_KEY}
EOF

echo ""
echo "[snap-cloud] ✓ Credentials file written to: $OUT_PATH"
echo "  ProjectId:   $PROJECT_REF"
echo "  ProjectUrl:  $PROJECT_URL"
echo "  PublicToken: ${ANON_KEY:0:20}..."
echo ""
echo "Next: load this file in your Lens script via requireAsset('../$(basename "$OUT_PATH")') as SupabaseProject"
