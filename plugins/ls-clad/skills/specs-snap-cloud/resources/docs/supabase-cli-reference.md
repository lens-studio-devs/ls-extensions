<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Supabase CLI Reference — Snap Cloud

Complete command reference for Snap Cloud (Supabase) CLI operations. Always use `--profile snap` on the first command per session; the CLI caches the profile after that.

---

## Global Flags

These flags work with every command:

| Flag | Description |
|------|-------------|
| `--profile snap` | Use the Snap Cloud authentication profile |
| `--output <env\|pretty\|json\|toml\|yaml>` | Output format for commands that return data |
| `--project-ref <ref>` | Target a specific remote project |
| `--workdir <path>` | Path to Supabase project directory |
| `--experimental` | Enable experimental features (required for some storage commands) |
| `--yes` | Answer yes to all prompts (useful for CI) |
| `--debug` | Output debug logs to stderr |
| `--no-browser` | Skip opening browser (useful in headless/SSH environments) |

---

## Authentication

### `supabase login`

Authenticate the CLI against Snap Cloud. Opens a browser tab for OAuth.

```bash
supabase --profile snap login

# Headless / SSH environment (copy-paste token)
supabase --profile snap login --no-browser

# Use a pre-existing token (CI)
supabase --profile snap login --token sbp_**************************
```

> Token is stored in native credentials storage, or `~/.supabase/access-token` if unavailable.
> For CI pipelines, skip login by setting `SUPABASE_ACCESS_TOKEN` environment variable.

---

## Project Management

### `supabase projects list`

List all projects accessible to the logged-in account.

```bash
supabase --profile snap projects list
# Output: table with ID, NAME, REGION, CREATED_AT columns
# The ID column is the project-ref used in all other commands
```

### `supabase projects create`

Create a new project.

```bash
supabase --profile snap projects create \
  --name "MyLens" \
  --region us-east-1 \
  --db-password "$(openssl rand -base64 20)" \
  --output json

# Capture the project ref
PROJECT_REF=$(supabase --profile snap projects create \
  --name "MyLens" --region us-east-1 \
  --db-password "$(openssl rand -base64 20)" \
  --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
```

Available regions: `us-east-1`, `us-west-1`, `eu-west-1`, `ap-southeast-1`, `ap-northeast-1`, etc.

### `supabase projects api-keys`

Retrieve the API keys for a project. The `anon` key is the public token used in `.supabaseProject` files.

```bash
supabase --profile snap projects api-keys --project-ref "$PROJECT_REF"
# Default: pretty table with NAME and API_KEY columns

# JSON output for scripting:
supabase --profile snap projects api-keys --project-ref "$PROJECT_REF" --output json
# [{"name":"anon","api_key":"eyJ..."},{"name":"service_role","api_key":"eyJ..."}]

# Extract anon key:
ANON_KEY=$(supabase --profile snap projects api-keys \
  --project-ref "$PROJECT_REF" --output json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(k['api_key'] for k in d if k['name']=='anon'))")
```

### `supabase projects delete`

```bash
supabase projects delete "$PROJECT_REF"
```

---

## Organization Management

### `supabase orgs list`
```bash
supabase --profile snap orgs list
```

### `supabase orgs create`
```bash
supabase --profile snap orgs create
```

---

## Local Development Stack

### `supabase init`

Initialize Supabase local config in the current directory. Creates `supabase/config.toml`.

```bash
supabase init
# or force-overwrite an existing config:
supabase init --force
```

### `supabase link`

Link the local directory to a remote hosted project. Required before `db push`, `db pull`, `db dump`.

```bash
supabase link --project-ref "$PROJECT_REF"
# With database password (avoids interactive prompt):
supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"
```

### `supabase start`

Start the full local development stack (Postgres, PostgREST, GoTrue, Realtime, Storage, Edge Runtime, Studio).

```bash
supabase start
# Exclude services you don't need (faster startup):
supabase start -x studio,imgproxy
```

Requires Docker Desktop or a running Docker daemon. Recommended: ≥7 GB RAM for all services.

### `supabase stop`

Stop the local stack. Data is preserved by default.

```bash
supabase stop
# Wipe all local data:
supabase stop --no-backup
# Stop all Supabase instances across all local projects:
supabase stop --all
```

### `supabase status`

Show local stack URLs and keys. Use `-o env` to export as shell variables.

```bash
supabase status
# Output example:
#   API URL: http://127.0.0.1:54321
#   DB URL:  postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   anon key: eyJ...
#   service_role key: eyJ...

# Export as env variables:
supabase status -o env
eval "$(supabase status -o env)"   # load into current shell
```

---

## Database — Migrations

### `supabase migration new`

Create a timestamped migration file (preferred over manual `date` + `touch`).

```bash
supabase migration new create_xyz_table
# Creates: supabase/migrations/20241130120000_create_xyz_table.sql
# Edit the file, then push
```

### `supabase migration list`

Compare local migration files vs. remote migration history.

```bash
supabase migration list --linked
# Shows LOCAL | REMOTE | TIME columns
# Gaps indicate unapplied or orphaned migrations
```

### `supabase migration repair`

Fix out-of-sync migration history (mark a migration as applied or reverted).

```bash
# Mark as applied (insert into remote history without running it)
supabase migration repair 20230103054303 --status applied --linked

# Mark as reverted (remove from remote history)
supabase migration repair 20230103054303 --status reverted --linked
```

### `supabase migration squash`

Collapse all local migrations into a single file (useful for cleaning up dev history).

```bash
supabase migration squash --linked
# Note: data manipulation statements (INSERT/UPDATE/DELETE) are dropped — add them back manually
```

### `supabase migration up`

Apply pending local migrations to the remote database.

```bash
supabase migration up --linked
```

### `supabase migration down`

Roll back applied migrations.

```bash
supabase migration down --linked
supabase migration down --last 1 --linked   # roll back most recent
```

---

## Database — Schema Operations

### `supabase db push`

Apply all pending local migrations to the remote project.

```bash
supabase db push
supabase db push --project-ref "$PROJECT_REF"  # explicit project
supabase db push --dry-run                      # preview without applying
supabase db push --include-seed                 # also run supabase/seed.sql
```

### `supabase db pull`

Pull the remote schema as a new local migration file.

```bash
supabase db pull
# Creates a migration file capturing the remote schema
# Asks if you want to update the remote migration history table
```

### `supabase db diff`

Show schema differences between local and remote without creating a migration.

```bash
supabase db diff --linked
supabase db diff --linked -f my_changes        # save diff to new migration file
supabase db diff --linked --schema public,extensions
```

### `supabase db reset`

Rebuild the local database from scratch by re-applying all migrations + seed.

```bash
supabase db reset               # local
supabase db reset --linked      # remote (drops all user-created entities and re-applies)
supabase db reset --no-seed     # skip seed.sql
```

### `supabase db dump`

Export schema or data from the remote database as SQL.

```bash
supabase db dump -f supabase/schema.sql           # schema only (default)
supabase db dump -f supabase/data.sql --data-only # data only
supabase db dump -f supabase/roles.sql --role-only # roles only
supabase db dump --linked --schema public          # specific schema
```

### `supabase db query`

Run a SQL statement directly against the database.

```bash
supabase db query "SELECT count(*) FROM xyz_data" --linked
supabase db query "INSERT INTO xyz_data (user_id, x, y, z) VALUES (...)" --linked
```

### `supabase db lint`

Check for SQL schema errors using plpgsql_check.

```bash
supabase db lint --linked
supabase db lint --linked --level error   # only show errors (not warnings)
supabase db lint --linked --fail-on error # exit non-zero if errors found (CI)
```

---

## Edge Functions

### `supabase functions new`

Scaffold a new edge function with boilerplate Deno TypeScript code.

```bash
supabase functions new my-function
# Creates: supabase/functions/my-function/index.ts
```

Boilerplate generated:
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

Deno.serve(async (req) => {
  const { name } = await req.json()
  return new Response(
    JSON.stringify({ message: `Hello ${name}!` }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
```

### `supabase functions serve`

Serve all functions locally for development/testing.

```bash
supabase functions serve
# All functions available at: http://127.0.0.1:54321/functions/v1/<name>

# With environment variables:
supabase functions serve --env-file ./supabase/.env

# Disable JWT verification (dev only):
supabase functions serve --no-verify-jwt

# Debug with inspector (Chrome DevTools / VS Code):
supabase functions serve --inspect-mode brk
```

### `supabase functions deploy`

Deploy a function to the remote project.

```bash
supabase functions deploy my-function --project-ref "$PROJECT_REF"
# Deploy all functions:
supabase functions deploy --project-ref "$PROJECT_REF"
# Remove functions that exist remotely but not locally:
supabase functions deploy --project-ref "$PROJECT_REF" --prune
# Bundle server-side (no Docker required):
supabase functions deploy my-function --use-api --project-ref "$PROJECT_REF"
```

### `supabase functions list`

List all deployed functions.

```bash
supabase functions list --project-ref "$PROJECT_REF"
```

### `supabase functions download`

Download function source code from the remote project.

```bash
supabase functions download my-function --project-ref "$PROJECT_REF"
# Download all functions:
supabase functions download --project-ref "$PROJECT_REF"
```

### `supabase functions delete`

Delete a deployed function. Does NOT remove local files.

```bash
supabase functions delete my-function --project-ref "$PROJECT_REF"
```

---

## Secrets (Edge Function Environment Variables)

### `supabase secrets set`

```bash
# Set individual secrets
supabase secrets set MY_API_KEY=abc123 --project-ref "$PROJECT_REF"
supabase secrets set KEY1=val1 KEY2=val2 --project-ref "$PROJECT_REF"

# Load from .env file
supabase secrets set --env-file ./supabase/.env --project-ref "$PROJECT_REF"
```

Access in functions via `Deno.env.get('MY_API_KEY')`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are always injected automatically.

### `supabase secrets list`

```bash
supabase secrets list --project-ref "$PROJECT_REF"
# Lists key names only — values are hidden
```

### `supabase secrets unset`

```bash
supabase secrets unset MY_API_KEY --project-ref "$PROJECT_REF"
supabase secrets unset KEY1 KEY2 --project-ref "$PROJECT_REF"
```

---

## Storage

All storage commands require `--experimental` flag. Paths use `ss:///` prefix (Snap Storage protocol).

### `supabase storage ls`

```bash
supabase storage ls ss:/// --experimental --linked          # list all buckets
supabase storage ls ss:///my-bucket/ --experimental --linked # list bucket contents
supabase storage ls ss:///my-bucket/ -r --experimental --linked  # recursive
```

### `supabase storage cp`

Copy files to/from storage.

```bash
# Upload local file to storage
supabase storage cp ./image.jpg ss:///my-bucket/images/image.jpg --experimental --linked

# Download from storage to local
supabase storage cp ss:///my-bucket/images/image.jpg ./image.jpg --experimental --linked

# Upload directory recursively
supabase storage cp -r ./local-assets/ ss:///my-bucket/ --experimental --linked

# With custom headers
supabase storage cp ./file.jpg ss:///bucket/file.jpg \
  --content-type image/jpeg \
  --cache-control "max-age=3600" \
  --experimental --linked
```

### `supabase storage mv`

Move or rename files in storage.

```bash
supabase storage mv ss:///my-bucket/old.jpg ss:///my-bucket/new.jpg --experimental --linked
supabase storage mv -r ss:///old-bucket/ ss:///new-bucket/ --experimental --linked
```

### `supabase storage rm`

Delete files from storage.

```bash
supabase storage rm ss:///my-bucket/images/old.jpg --experimental --linked
supabase storage rm -r ss:///my-bucket/temp/ --experimental --linked
```

---

## Type Generation

### `supabase gen types`

Generate TypeScript type definitions from the database schema. Essential for type-safe Lens scripts.

```bash
# From remote project
supabase gen types typescript --project-id "$PROJECT_REF" > Assets/DatabaseTypes.ts

# From local dev stack
supabase gen types typescript --local > Assets/DatabaseTypes.ts

# Specific schemas
supabase gen types typescript --project-id "$PROJECT_REF" --schema public,extensions

# Other languages
supabase gen types go     --project-id "$PROJECT_REF" > types.go
supabase gen types swift  --project-id "$PROJECT_REF" > Types.swift
```

Usage in Lens TypeScript:
```typescript
import { Database } from './DatabaseTypes'
type MyTable   = Database['public']['Tables']['my_table']['Row']
type MyInsert  = Database['public']['Tables']['my_table']['Insert']
type MyUpdate  = Database['public']['Tables']['my_table']['Update']
```

---

## Database Inspection

These commands connect to a live database and are useful for debugging performance issues.

```bash
# Long-running queries (> 5 min)
supabase inspect db long-running-queries --linked

# Lock contention
supabase inspect db locks --linked
supabase inspect db blocking --linked

# Table/index statistics
supabase inspect db table-stats --linked
supabase inspect db index-stats --linked

# Bloat (dead tuples, wasted space)
supabase inspect db bloat --linked

# Most expensive queries by total time
supabase inspect db outliers --linked

# Most frequently called queries
supabase inspect db calls --linked

# Read/write traffic profile per table
supabase inspect db traffic-profile --linked

# Vacuum health
supabase inspect db vacuum-stats --linked

# Replication slots
supabase inspect db replication-slots --linked

# Save full inspection report to CSV files
supabase inspect report --output-dir ./inspection --linked
```

---

## Configuration

### `supabase config push`

Push local `supabase/config.toml` settings to the remote project.

```bash
supabase config push --project-ref "$PROJECT_REF"
```

---

## Branches (Preview Environments)

Branches create isolated preview databases for feature development.

```bash
# Create a branch
supabase branches create my-feature --project-ref "$PROJECT_REF"

# List branches
supabase branches list --project-ref "$PROJECT_REF"

# Get branch details
supabase branches get my-feature --project-ref "$PROJECT_REF"

# Delete branch
supabase branches delete my-feature --project-ref "$PROJECT_REF"

# Clone production data into branch
supabase branches create my-feature --with-data --project-ref "$PROJECT_REF"
```

---

## Seed Data

### `supabase seed buckets`

Seed storage buckets from local config.

```bash
supabase seed buckets --linked
supabase seed buckets --local
```

---

## Snippets

Manage saved SQL snippets from the Snap Cloud dashboard.

```bash
supabase snippets list --project-ref "$PROJECT_REF"
supabase snippets download <snippet-id> --project-ref "$PROJECT_REF"
```

---

## Typical Agent Workflows

### New Lens from scratch

```bash
# 1. Auth + credentials
supabase --profile snap login
supabase --profile snap projects list
PROJECT_REF="your-ref"
ANON_KEY=$(supabase --profile snap projects api-keys --project-ref "$PROJECT_REF" --output json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(k['api_key'] for k in d if k['name']=='anon'))")

# 2. Generate .supabaseProject asset
UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
cat > "Assets/SnapCloud_${PROJECT_REF}.supabaseProject" << EOF
- !<SupabaseProject/${UUID}>
  PackagePath: ""
  ProjectId: ${PROJECT_REF}
  ProjectName: MyLens
  ProjectUrl: "https://${PROJECT_REF}.snapcloud.dev"
  PublicToken: ${ANON_KEY}
EOF

# 3. Init local supabase config + link
supabase init
supabase link --project-ref "$PROJECT_REF"

# 4. Create table migration
supabase migration new create_xyz_table
# edit supabase/migrations/<timestamp>_create_xyz_table.sql ...
supabase db push

# 5. Enable realtime (in the migration SQL)
# ALTER PUBLICATION supabase_realtime ADD TABLE xyz_data;

# 6. Create edge function
supabase functions new process-data
# edit supabase/functions/process-data/index.ts ...
supabase secrets set EXTERNAL_API=key123 --project-ref "$PROJECT_REF"
supabase functions deploy process-data --project-ref "$PROJECT_REF"

# 7. Create storage bucket (via migration SQL)
supabase migration new create_storage_bucket
# INSERT INTO storage.buckets (id, name, public) VALUES ('assets', 'assets', true) ...
supabase db push

# 8. Generate TypeScript types
supabase gen types typescript --project-id "$PROJECT_REF" > Assets/DatabaseTypes.ts
```

### Pull existing project to local dev

```bash
supabase --profile snap login
PROJECT_REF="existing-ref"
supabase init
supabase link --project-ref "$PROJECT_REF"
supabase db pull                                          # get remote schema
supabase db dump -f supabase/seed.sql --data-only        # get data
supabase storage cp -r ss:/// ./supabase/storages/ --experimental --linked  # get storage files
supabase functions download --project-ref "$PROJECT_REF"  # get all functions
cp supabase/config.toml supabase/config.toml.backup
supabase start
supabase db reset
```
