---
name: specs-snap-cloud
description: Connect Specs Lenses to a cloud backend using Snap Cloud (powered by Supabase). Use for persistent data, global leaderboards, multiplayer/realtime sync, media capture and upload, user-generated content, serverless edge functions, or cloud storage. Triggers — 'save to cloud', 'global leaderboard', 'supabase', 'snap cloud', 'multiplayer', 'realtime sync', 'upload to storage', 'persistent scores', 'cloud backend', 'edge function', 'deploy function'.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Snap Cloud — Backend for Specs

**Status:** Alpha — [Apply for access](https://snap-ar.com/SnapCloudApplication)
**Requirements:** Lens Studio v5.7+. Install the **SnapCloud / SupabaseClient** package (runtime) from Asset Library. **v5.15.21+:** the Supabase Plugin is bundled automatically — no separate plugin install. On older versions, verify the plugin via **Window → Supabase**. For local development and edge-function deployment, install the Supabase CLI (`brew install supabase/tap/supabase`).

**Full reference docs:** `resources/docs/` — getting-started, databases, realtime, storage, edge-functions, CLI, usage_limits, examples/, **supabase-cli-reference** (complete command index)
**Complete example scripts:** `resources/scripts/` — 19 scripts covering all patterns (including `setup-credentials.sh` for agent auth)

---

## MCP Server Integration (optional)

Snap Cloud provides an MCP server that lets AI assistants interact with and query your Supabase projects on your behalf. Set it up by following the [Snap Cloud MCP guide](https://cloud.snap.com/docs/guides/ai-tools/mcp).

**Detection:** check whether your runtime exposes the Supabase MCP server's `list_tables` tool — resolve it by its bare name. If present, MCP is connected. If not, fall back to the CLI steps in each section. Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

**Rules:**
- Use MCP tools for **read-only operations only**. Writes (migrations, deployments, SQL mutations) always require explicit user confirmation first. Before proceeding, warn the user: **"This will modify your Supabase project directly. If this is a production project, changes cannot be easily undone and may affect live users. Please confirm this is a development/test project before continuing."** Only proceed if the user explicitly acknowledges this.
- The Supabase MCP server's `execute_sql` tool is **NOT** inherently read-only — it will execute any SQL. Use it for SELECT queries only; never pass mutations without explicit user confirmation.
- **After any schema change** (via `db push`, Dashboard SQL Editor, or any other method): verify the migration landed and the expected tables are present. Report results to the user.
- **After any edge function change** (via `functions deploy`, Dashboard, or any other method): verify the function appears and its status is active. Report results to the user.
- **If logs show CRUD or edge function errors:** check whether the user is signed in first (most common cause of `401`/`403` and silent write failures), then use MCP to inspect the affected table's schema/RLS or the function's current state.

---

## Setup

### 1. Install packages

**Lens Studio v5.15.21+** — one package only:
- **SnapCloud / SupabaseClient** (supabase-js runtime) — install from Asset Library. The Supabase Plugin is bundled automatically; no separate plugin install or Window → Supabase verification needed.

**Lens Studio v5.7–v5.15.20** — two separate installs required:
- **SupabaseClient** (supabase-js runtime) — install from Asset Library.
- **Supabase Plugin** (editor/project management) — does **not** appear in the installed packages list. Verify via **Window → Supabase** in the menu bar.

> When building a Lens, always pull the latest SnapCloud/SupabaseClient package to get current features and bug fixes.

### 2. Create a Supabase Project

**For AI agents / terminal-only workflows** — skip the editor UI entirely. Use the CLI path in [Agent-Driven Setup](#agent-driven-setup-zero-editor-friction) below. The only required human step is a one-time browser login.

**For manual / human-driven setup** — `Window → Supabase` → Login → Create/select project → **Import Credentials** → creates a `SupabaseProject` asset.

### 3. Initialize the client

> **Agent-generated scripts:** prefer `requireAsset` over `@input` for all asset references. This keeps everything on the Lens runtime — no inspector wiring, no human intervention needed. `@input` is valid for human-authored scripts but defeats the purpose of fully autonomous generation.

```typescript
import { createClient, SupabaseClient } from 'SupabaseClient.lspkg/supabase-snapcloud'

@component
export class MyComponent extends BaseScriptComponent {
  // No @input — load the .supabaseProject asset programmatically via requireAsset.
  // Path is relative to this script file; adjust if your script is in a subdirectory.
  private supabaseProject: SupabaseProject =
    requireAsset('../SupabaseProject_<project-ref>.supabaseProject') as SupabaseProject

  private client: SupabaseClient
  private uid: string

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init())
    this.createEvent('OnDestroyEvent').bind(() => this.client?.removeAllChannels())
  }

  private async init(): Promise<void> {
    this.client = createClient(
      this.supabaseProject.url,
      this.supabaseProject.publicToken,
      { realtime: { heartbeatIntervalMs: 2500 } }  // required alpha workaround
    )
    await this.signIn()
  }

  private async signIn(): Promise<void> {
    const { data, error } = await this.client.auth.signInWithIdToken({
      provider: 'snapchat',
      token: ''  // empty — Snapchat handles auth automatically
    })
    if (!error) {
      this.uid = JSON.stringify(data.user.id).replace(/^"(.*)"$/, '$1')
      print('[SnapCloud] Signed in: ' + this.uid)
      return
    }
    // Fallback for Lens Studio preview: signInAnonymously() gives a real uid so RLS still applies
    // and rows land in the DB from any environment.
    // Enable via Supabase Dashboard → Authentication → Providers → Anonymous.
    // NOTE: supabase config push is blocked on Snap Cloud's org type — dashboard only.
    const { data: anonData, error: anonError } = await this.client.auth.signInAnonymously()
    if (anonError) { print('[SnapCloud] Auth failed: ' + JSON.stringify(anonError)); return }
    this.uid = JSON.stringify(anonData.user.id).replace(/^"(.*)"$/, '$1')
    print('[SnapCloud] Signed in anonymously (preview): ' + this.uid)
  }
}
```

> **Auth retry:** If `signInWithIdToken` returns `AuthRetryableFetchError`, the OIDC token isn't ready at startup — wait ~1 s and retry up to 3×. See `resources/scripts/ImageCaptureUploader.ts` for the `signInWithRetry` helper.

> **Preview limitation:** `signInWithIdToken` always fails in Lens Studio preview — see the anonymous-fallback comments in `signIn()` above (enable Anonymous via Dashboard only; `config push` is blocked on Snap Cloud's org type).

### Shared config (`SnapCloudRequirements`)

For scenes with multiple Snap Cloud scripts, use one `SnapCloudRequirements` component as a shared config. It exposes `isConfigured()`, `getSupabaseProject()`, `getRestApiUrl()`, `getStorageApiUrl()`, `getFunctionsApiUrl()`, and `getSupabaseHeaders()`. See `resources/scripts/SnapCloudRequirements.ts`.

```typescript
import { SnapCloudRequirements } from './SnapCloudExamples.lspkg/SnapCloudRequirements'

// No @input — find the SnapCloudRequirements component on the same SceneObject:
private snapCloudRequirements: SnapCloudRequirements =
  this.getSceneObject().getComponent(SnapCloudRequirements.getTypeName()) as unknown as SnapCloudRequirements

// In init():
if (!this.snapCloudRequirements.isConfigured()) return
const project = this.snapCloudRequirements.getSupabaseProject()
this.client = createClient(project.url, project.publicToken, { realtime: { heartbeatIntervalMs: 2500 } })
```

---

## Agent-Driven Setup (Zero Editor Friction)

**Use this path when an AI agent is building the Lens.** It skips the Lens Studio editor plugin entirely. The only human step is a one-time browser login — every other action runs from the terminal.

The `.supabaseProject` asset is plain YAML. The agent generates it from CLI output — no drag-and-drop, no editor UI.

### Step 1 — Install CLI (prerequisite for all agent tasks)

The Supabase CLI is required for ALL programmatic Snap Cloud operations. Check and install before proceeding.

```bash
# macOS — check then install
if ! command -v supabase &>/dev/null; then
  brew install supabase/tap/supabase
else
  brew upgrade supabase   # keep current
fi

# Windows (run in PowerShell)
# scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
# scoop install supabase

# Verify
supabase --version
```

### Step 2 — Authenticate (browser login, one-time per machine)

```bash
supabase --profile snap login
```

The terminal prompts you to press **Enter** to open the browser (or use the printed URL if the browser does not open automatically). Complete the OAuth flow in the browser. **This is the only manual step** — it requires interactive terminal input and cannot be automated. The CLI caches the session; subsequent commands in the same session omit `--profile snap`.

### Step 3 — Get project credentials

```bash
# List existing projects to find the project ref
supabase --profile snap projects list

# Project selection strategy:
# - If only one project exists, use it.
# - If multiple projects exist, prefer the one whose name matches the lens/feature being built.
# - If ambiguous, ask the user which project to use — do NOT silently pick one.

# Set the project ref (e.g. "xcuslfeoetnflddtndmx")
PROJECT_REF="your-project-ref"

# Extract the anon (public) key
ANON_KEY=$(supabase --profile snap projects api-keys \
  --project-ref "$PROJECT_REF" --output json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(k['api_key'] for k in d if k['name']=='anon'))")

PROJECT_URL="https://${PROJECT_REF}.snapcloud.dev"
```

> **Create a new project** if none exists:
> ```bash
> PROJECT_REF=$(supabase --profile snap projects create \
>   --name "MyLens" --region us-east-1 \
>   --db-password "$(openssl rand -base64 20)" \
>   --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
> ```

### Step 4 — Generate the `.supabaseProject` asset file

No editor needed: the `.supabaseProject` file is plain YAML. Dropped into `Assets/`, Lens Studio auto-registers it as a typed `SupabaseProject` asset that `requireAsset` resolves at runtime — the typed asset (not a raw URL string) is required for authenticated calls.

```bash
# Generate a UUID for the asset tag
UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
# macOS alternative: UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')

cat > "Assets/SupabaseProject_${PROJECT_REF}.supabaseProject" << EOF
- !<SupabaseProject/${UUID}>
  PackagePath: ""
  ProjectId: ${PROJECT_REF}
  ProjectName: MyLens
  ProjectUrl: "${PROJECT_URL}"
  PublicToken: ${ANON_KEY}
EOF
```

Reference this file in any Snap Cloud script using `requireAsset('../SupabaseProject_${PROJECT_REF}.supabaseProject') as SupabaseProject` — no inspector wiring, no human interaction needed.

> **Scene wiring via MCP:** see `resources/docs/scene-graphql-wiring.md` for the argument names, `setProperty` vs `setComponentProperty`, and `primaryAsset` vs `scriptAsset` caveats.

### Step 5 — Create database tables via CLI migrations

Skip the Dashboard SQL Editor. Write migrations locally and push:

```bash
# Initialize Supabase local config (once per lens project)
supabase --profile snap init

# Link to the remote project
supabase link --project-ref "$PROJECT_REF"

# Write a migration (replace xyz_data and columns with your schema)
TIMESTAMP=$(date +%Y%m%d%H%M%S)
mkdir -p supabase/migrations
cat > "supabase/migrations/${TIMESTAMP}_create_xyz_table.sql" << 'SQLEOF'
CREATE TABLE xyz_data (
  id         uuid             DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid             REFERENCES auth.users(id),
  x          double precision NOT NULL,
  y          double precision NOT NULL,
  z          double precision NOT NULL,
  created_at timestamptz      DEFAULT now() NOT NULL
);
ALTER TABLE xyz_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own" ON xyz_data
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
SQLEOF

# Push to remote
supabase db push --project-ref "$PROJECT_REF"
```

### Step 6 — Enable Realtime on a table

> Add to the realtime publication so `postgres_changes` events fire — include in the migration:

```sql
-- Append inside the same migration file as CREATE TABLE, or create a new one
ALTER PUBLICATION supabase_realtime ADD TABLE xyz_data;
```

### Step 7 — Create and deploy an Edge Function

```bash
# Scaffold a new function — creates supabase/functions/my-function/index.ts
supabase functions new my-function

# Edit supabase/functions/my-function/index.ts ...

# Test locally (all functions served at http://127.0.0.1:54321/functions/v1/)
supabase start
supabase functions serve

# Deploy to remote
supabase functions deploy my-function --project-ref "$PROJECT_REF"

# Verify
supabase functions list --project-ref "$PROJECT_REF"
```

Edge function boilerplate (Deno runtime — uses `jsr:` imports, not npm):
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const { input } = await req.json()
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  // ... server-side logic ...
  return new Response(JSON.stringify({ result: 'done' }), {
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' }
  })
})
```

### Step 8 — Manage Edge Function secrets

Secrets are injected as environment variables. Never hardcode them in function code.

```bash
# Set one or more secrets
supabase secrets set MY_API_KEY=abc123 ANOTHER_KEY=xyz --project-ref "$PROJECT_REF"

# Load from .env file
supabase secrets set --env-file ./supabase/.env --project-ref "$PROJECT_REF"

# List (names only — values are hidden)
supabase secrets list --project-ref "$PROJECT_REF"

# Remove
supabase secrets unset MY_API_KEY --project-ref "$PROJECT_REF"
```

In the function, access via `Deno.env.get('MY_API_KEY')`.

### Step 9 — Create a Storage bucket

Storage buckets are created via SQL migration — no dashboard click needed:

```sql
-- Add to a migration file
INSERT INTO storage.buckets (id, name, public)
  VALUES ('my-bucket', 'my-bucket', true)
  ON CONFLICT DO NOTHING;

-- RLS policies on storage objects
CREATE POLICY "public read"  ON storage.objects FOR SELECT USING (bucket_id = 'my-bucket');
CREATE POLICY "auth upload"  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'my-bucket' AND auth.role() = 'authenticated');
CREATE POLICY "own delete"   ON storage.objects FOR DELETE
  USING (bucket_id = 'my-bucket' AND auth.uid()::text = (storage.foldername(name))[1]);
```

Seed files via CLI after pushing the migration:
```bash
supabase storage cp ./local-asset.jpg ss:///my-bucket/images/asset.jpg --experimental --linked
supabase storage ls ss:///my-bucket/ --experimental --linked
```

### Step 10 — Generate TypeScript types from schema

After pushing migrations, generate a typed interface for all tables. This enables strongly-typed DB access in Lens scripts and lets the agent know the exact schema shape:

```bash
supabase gen types typescript \
  --project-id "$PROJECT_REF" \
  --schema public \
  > Assets/DatabaseTypes.ts
```

Reference in Lens scripts:
```typescript
import { Database } from './DatabaseTypes'
type XYZRow    = Database['public']['Tables']['xyz_data']['Row']
type XYZInsert = Database['public']['Tables']['xyz_data']['Insert']
```

### Quick CLI reference

For full command flags and options, see `resources/docs/supabase-cli-reference.md`. Most-used commands:

| Task | Command |
|------|---------|
| New migration file | `supabase migration new <name>` |
| Migration status | `supabase migration list --linked` |
| Run SQL directly | `supabase db query "SELECT 1" --linked` |
| Diff local vs remote | `supabase db diff --linked` |
| Start local dev stack | `supabase start` |
| Local keys + URLs | `supabase status` |
| Reset local DB | `supabase db reset` |
| Pull remote schema | `supabase db pull` |
| Squash migrations | `supabase migration squash --linked` |
| Inspect table stats | `supabase inspect db table-stats --linked` |

### Full credentials automation

See `resources/scripts/setup-credentials.sh` — runs steps 1-4 and drops a ready-to-use `.supabaseProject` into `Assets/`. Pass `--project-ref` to skip the interactive project picker.

---

## Local Development (Testing Against a Local Stack)

Run the full Supabase stack on your machine for fast iteration — no cloud costs, no network latency, works offline. Use this for all development and only push to remote when features are stable.

### Start the local stack

```bash
# Create a new local project directory (one-time per lens project)
mkdir my-lens-local && cd my-lens-local
supabase --profile snap init        # creates supabase/config.toml

supabase --profile snap start       # starts local Supabase (Docker required)
# Local API:     http://127.0.0.1:54321
# Local Studio:  http://127.0.0.1:54323
# Local DB:      postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

### Get local credentials

```bash
supabase status                     # prints API URL, anon key, service role key
```

Extract the anon key automatically:
```bash
LOCAL_ANON_KEY=$(supabase status --output json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['ANON_KEY'])")
# If --output json is not available on your CLI version:
LOCAL_ANON_KEY=$(supabase status | awk '/anon key/{print $NF}')
```

### Generate a local `.supabaseProject` asset

The local asset uses `http://127.0.0.1:54321` as the URL and the local anon key. The `ProjectId` is always `local_deployed_project` for local stacks.

```bash
UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
cat > "Assets/Supabase Project Local.supabaseProject" << EOF
- !<SupabaseProject/${UUID}>
  PackagePath: ""
  ProjectId: local_deployed_project
  ProjectName: ""
  ProjectUrl: "http://127.0.0.1:54321"
  PublicToken: ${LOCAL_ANON_KEY}
EOF
```

Reference this asset in your script via `requireAsset('../Supabase Project Local.supabaseProject') as SupabaseProject` — no inspector wiring needed.

> **Format difference:** Local `PublicToken` may be `sb_publishable_...` format (not a JWT). Both formats are accepted by `createClient`.

### Mirror schema and data from an existing remote project

```bash
# One-time login + link (if not already done)
supabase --profile snap login
supabase link --project-ref "$PROJECT_REF"

# Pull remote schema as a migration
supabase db pull --linked

# Dump remote data as seed file
supabase db dump -f supabase/seed.sql --data-only

# (Optional) Copy storage files from remote
mkdir -p ./supabase/storages
supabase storage cp -r ss:/// ./supabase/storages/ --experimental

# Configure seed.sql and storage in config.toml, then reset local DB
supabase stop
supabase start
supabase db reset                   # applies migrations + seed.sql
```

### Storage buckets in local config.toml

Define local storage buckets in `supabase/config.toml`. Buckets reference local folders populated by `supabase storage cp`:

```toml
[storage.buckets.my-test-bucket]
public = true
objects_path = "./storages/my-test-bucket"

[storage.buckets.remote-assets]
public = false
objects_path = "./storages/remote-assets"
```

Run `supabase stop && supabase start` after editing `config.toml`.

### Serve edge functions locally

```bash
# Download functions from remote (one-time)
supabase functions download hello-world
supabase functions download edge-insert

# Serve all functions locally (hot-reload on save)
supabase functions serve
# Functions available at: http://127.0.0.1:54321/functions/v1/<function-name>
```

The local Supabase URL is injected automatically as `SUPABASE_URL` inside edge functions — no code changes needed between local and remote.

### Push local changes back to remote

When your Lens is ready for production:

```bash
# Link to the target remote project (may differ from dev project)
supabase link --project-ref "$TARGET_PROJECT_REF"

# Push schema + seed data
supabase db push --include-seed

# Sync storage files
supabase storage cp -r ./supabase/storages/my-bucket ss:///my-bucket --experimental

# Deploy edge functions
supabase functions deploy hello-world --project-ref "$TARGET_PROJECT_REF"
supabase functions deploy edge-insert --project-ref "$TARGET_PROJECT_REF"
```

### Stop the local stack

```bash
supabase stop                       # stops containers, preserves data
supabase stop --all --no-backup     # stops all running Supabase projects (use before a fresh start)
```

---

## Database (Tables)

Standard Supabase JS query builder. Always sign in first.

```typescript
// SELECT
const { data, error } = await this.client
  .from('my_table').select('id, message').eq('user_id', this.uid).order('created_at', { ascending: false }).limit(10)

// INSERT
const { data, error } = await this.client
  .from('my_table').insert({ message: 'Hello', user_id: this.uid }).select()

// UPDATE
const { data, error } = await this.client
  .from('my_table').update({ message: 'Updated' }).eq('id', rowId).select()

// DELETE
const { error } = await this.client
  .from('my_table').delete().eq('id', rowId)

// UPSERT — insert or update, ideal for user preferences (no check needed)
await this.client.from('user_preferences').upsert(
  { user_id: this.uid, preferences: JSON.stringify(prefs), updated_at: new Date().toISOString() },
  { onConflict: 'user_id' }
)

// RPC — call a PostgreSQL stored procedure
const { data, error } = await this.client.rpc('my_function', { p_param: value })
```

> **RLS:** Tables have Row Level Security enabled by default. Add policies in the Snap Cloud Dashboard → Table Editor → RLS so users can only read/write their own rows. See `resources/docs/databases.mdx` and `resources/scripts/TableConnector.ts`.

---

## Realtime

Two modes: **Broadcast** (custom low-latency events) and **Postgres Changes** (DB change events).

```typescript
import { RealtimeChannel } from 'SupabaseClient.lspkg/supabase-snapcloud'

private channel: RealtimeChannel

// --- Broadcast (multiplayer, cursor sync, live notifications) ---
this.channel = this.client.channel('my-channel', {
  config: { broadcast: { self: false } }
})
this.channel
  .on('broadcast', { event: 'position-update' }, (msg) => {
    const { x, y, userId } = msg.payload
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') print('[RT] Connected')
    else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') print('[RT] Closed: ' + status)
  })

// Send a broadcast
this.channel.send({
  type: 'broadcast',
  event: 'position-update',
  payload: { x, y, userId: this.uid, timestamp: Date.now() }
})

// --- Postgres Changes (subscribe to INSERT/UPDATE/DELETE on a DB table) ---
// Prerequisite: enable "Broadcast changes on this table" in Table Editor
this.client.channel('db-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'my_table' }, (payload) => {
    print('Change: ' + payload.eventType)   // 'INSERT' | 'UPDATE' | 'DELETE'
    print('New data: ' + JSON.stringify(payload.new))
    print('Old data: ' + JSON.stringify(payload.old))
  })
  .subscribe()

// Cleanup on destroy
this.client.removeAllChannels()
```

> **Limits:** 200 peak concurrent connections, 250 KB max message size, 2M messages/month.
> See `resources/docs/realtime.mdx` and `resources/scripts/RealtimeCursor.ts` for the bidirectional cursor sync example.

---

## Storage

Download and upload any file type from Supabase Storage buckets.

```typescript
const remoteMediaModule = require('LensStudio:RemoteMediaModule') as RemoteMediaModule
const internetModule = require('LensStudio:InternetModule') as InternetModule

// --- Download image (blob → texture) ---
const { data: blob, error } = await this.client.storage.from('my-bucket').download('images/photo.jpg')
if (!error) {
  const resource = DynamicResource.createWithBuffer(await blob.bytes())
  remoteMediaModule.loadResourceAsImageTexture(resource, (texture) => {
    imageComponent.mainPass.baseTex = texture
  }, (err) => print('Image error: ' + err))
}

// --- Download 3D model (public URL → GLTF) ---
const { data: urlData } = this.client.storage.from('my-bucket').getPublicUrl('models/rabbit.glb')
const resource = internetModule.makeResourceFromUrl(urlData.publicUrl)
const settings = GltfSettings.create()
settings.convertMetersToCentimeters = true
remoteMediaModule.loadResourceAsGltfAsset(resource,
  (gltf) => {
    gltf.tryInstantiateAsync(this.sceneObject, material,
      (obj) => { obj.setParent(parentObj); obj.getTransform().setLocalPosition(vec3.zero()) },
      (err) => print('Instantiate error: ' + err),
      (_progress) => {},
      settings
    )
  }, (err) => print('GLTF error: ' + err)
)

// --- Download audio ---
const { data: audioUrl } = this.client.storage.from('my-bucket').getPublicUrl('audio/track.mp3')
const audioResource = internetModule.makeResourceFromUrl(audioUrl.publicUrl)
remoteMediaModule.loadResourceAsAudioTrackAsset(audioResource,
  (audioAsset) => {
    const comp = obj.getComponent('Component.AudioComponent') ||
                 obj.createComponent('Component.AudioComponent')
    comp.audioTrack = audioAsset
    comp.volume = 0.8
    comp.play(1)
  }, (err) => print('Audio error: ' + err)
)

// --- Upload bytes ---
const { data, error } = await this.client.storage.from('my-bucket')
  .upload(`captures/${this.uid}_${Date.now()}.jpg`, uint8ArrayBytes, {
    contentType: 'image/jpeg', upsert: true
  })

// --- List files ---
const { data: files } = await this.client.storage.from('my-bucket').list('images/', { limit: 20 })

// --- Delete files ---
await this.client.storage.from('my-bucket').remove(['images/old-photo.jpg'])
```

> **Folder convention:** organize as `images/`, `models/`, `audio/`. Prefix with user ID (e.g. `captures/<uid>_<timestamp>.jpg`) to scope per-user and match RLS policies.
> **Limits:** 1 GB total storage, 50 MB max file size.
> **Bucket setup:** Dashboard → Storage → New Bucket → toggle Public → add SELECT policy for authenticated users.
> See `resources/docs/storage.mdx` and `resources/scripts/StorageLoader.ts`.

---

## Edge Functions

Serverless TypeScript/Deno functions deployed at the edge. Deploy via CLI (`supabase --profile snap functions deploy`) or Dashboard → Edge Functions → Via Editor.

For the Deno function body (`Deno.serve` boilerplate, injected `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), see Step 7 above and `resources/docs/edge-functions.mdx`. The Lens-side call:

**Calling from Specs:**
```typescript
// Via Supabase client (recommended)
const { data, error } = await this.client.functions.invoke('my-function', {
  body: { input: 'data' }
})

// Via fetch (for raw HTTP control)
const { data: session } = await this.client.auth.getSession()
const token = session?.session?.access_token ?? this.supabaseProject.publicToken
const response = await internetModule.fetch(
  this.snapCloudRequirements.getFunctionsApiUrl() + 'my-function',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'apikey': this.supabaseProject.publicToken
    },
    body: JSON.stringify({ input: 'data' })
  }
)
const result = await response.json()
```

> **Deno:** use `jsr:@supabase/supabase-js@2` (not npm). Use `SUPABASE_SERVICE_ROLE_KEY` server-side, never in Lens code. Pass Storage URLs not bytes to avoid request size limits.
> Camera/microphone are NOT available inside edge functions.
> See `resources/docs/edge-functions.mdx` and `resources/scripts/EdgeFunctionImgProcessing.ts`.

---

## Media Capture and Upload

Capture camera stills, video frames, and microphone audio from Specs and upload to Storage.

### Image Capture

```typescript
const cameraModule: CameraModule = require('LensStudio:CameraModule')

async captureAndUpload(): Promise<void> {
  const imageRequest = CameraModule.createImageRequest()
  ;(imageRequest as any).cameraId = CameraModule.CameraId.Default_Color
  const imageFrame = await cameraModule.requestImage(imageRequest)

  Base64.encodeJpeg(imageFrame.texture, 0.85, async (b64) => {
    const bin = Base64.decode(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    const { data, error } = await this.client.storage.from('my-bucket')
      .upload(`captures/${this.uid}_${Date.now()}.jpg`, bytes, {
        contentType: 'image/jpeg', upsert: true
      })
    if (!error) print('Uploaded: ' + data.path)
  })
}
```

> **Composite texture (AR + camera):** assign a Render Target texture and wait 2+ frames after enabling before encoding — render targets may not have pixel data on the first frame.

### Video Capture (record-then-upload)

Store JPEG frames as `Uint8Array` in memory during recording using `CameraTextureProvider.onNewFrame`, then batch-upload after recording stops. This avoids I/O contention and frame drops during recording. See `resources/scripts/VideoCaptureUploader.ts`.

### Audio Capture

Access the microphone via `MicrophoneAudioProvider`, collect PCM `Float32Array` frames on `UpdateEvent`, convert to WAV (16-bit PCM with RIFF header) after recording stops, then upload. Use 16 kHz for voice. See `resources/scripts/AudioCaptureUploader.ts` for the WAV encoding helper.

### Live Video/Audio Streaming via Realtime

Broadcast JPEG frames over a Supabase Realtime channel to a web viewer. Keep `streamQuality ≤ 15` and `resolutionScale ≤ 0.3` to stay under the 250 KB Realtime message limit.

```typescript
// Encode and broadcast a frame
Base64.encodeTextureAsync(texture, (base64) => {
  this.realtimeChannel.send({
    type: 'broadcast',
    event: 'video-frame',
    payload: { sessionId: this.sessionId, frameNumber: this.frameCount++, frameData: base64 + '|||FRAME_END|||' }
  })
}, (err) => print(err), CompressionQuality.LowQuality, EncodingType.Jpg)
```

> See `resources/scripts/VideoStreamingController.ts`, `AudioStreamingController.ts`, and `CompositeStreamingController.ts` for full implementations including web viewer HTML. Also see `resources/docs/examples/media.mdx`.

---

## Global Leaderboard (RPC Pattern)

Use PostgreSQL RPC functions for server-enforced leaderboard logic: one row per user, personal best only.

**SQL to run in Dashboard → SQL Editor:**

```sql
CREATE TABLE leaderboard (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) UNIQUE,
  displayname text NOT NULL,
  score numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read"  ON leaderboard FOR SELECT USING (true);
CREATE POLICY "own insert"   ON leaderboard FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update"   ON leaderboard FOR UPDATE USING (auth.uid() = user_id);

-- Upsert personal best (SECURITY DEFINER so auth.uid() is trusted)
CREATE OR REPLACE FUNCTION submit_score(p_score numeric, p_displayname text, p_sort_mode text DEFAULT 'desc')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE existing_score numeric;
BEGIN
  SELECT score INTO existing_score FROM leaderboard WHERE user_id = auth.uid();
  IF existing_score IS NULL THEN
    INSERT INTO leaderboard (user_id, displayname, score) VALUES (auth.uid(), p_displayname, p_score);
  ELSIF (p_sort_mode = 'desc' AND p_score > existing_score)
     OR (p_sort_mode = 'asc'  AND p_score < existing_score) THEN
    UPDATE leaderboard SET score = p_score, displayname = p_displayname WHERE user_id = auth.uid();
  END IF;
END; $$;

-- Top N scores — no auth required (public read policy)
CREATE OR REPLACE FUNCTION get_top_scores(p_limit integer DEFAULT 10, p_sort_mode text DEFAULT 'desc')
RETURNS TABLE(displayname text, score numeric) LANGUAGE plpgsql AS $$
BEGIN
  IF p_sort_mode = 'asc' THEN
    RETURN QUERY SELECT l.displayname, l.score FROM leaderboard l ORDER BY l.score ASC LIMIT p_limit;
  ELSE
    RETURN QUERY SELECT l.displayname, l.score FROM leaderboard l ORDER BY l.score DESC LIMIT p_limit;
  END IF;
END; $$;
```

**Lens code:**
```typescript
// Submit score (requires sign-in)
await this.client.rpc('submit_score', { p_score: score, p_displayname: name, p_sort_mode: 'desc' })

// Fetch top scores (no auth needed — public read RLS policy)
const { data: rows } = await this.client.rpc('get_top_scores', { p_limit: 10, p_sort_mode: 'desc' })
// rows: [{ displayname: string, score: number }, ...]
```

> `SECURITY DEFINER` lets the function use `auth.uid()` safely without exposing raw UPDATE to users. Pass `'asc'` for time-trial games (lower = better).
> See `resources/scripts/SupabaseLeaderboardService.ts` and `GlobalLeaderboard.ts` for lazy auth + UI integration. Also `resources/docs/examples/leaderboard.mdx`.

---

## Usage Limits (Alpha)

| Resource | Limit |
|----------|-------|
| Projects | 2 |
| MAU | 50,000 |
| Database size | 500 MB per project |
| Database egress | 5 GB |
| Edge Function invocations | 500,000 |
| Storage total | 1 GB |
| Storage max file size | **50 MB** |
| Realtime peak connections | **200** |
| Realtime max message size | **250 KB** |
| Realtime messages/month | 2 million |

To increase limits, send a support request from the Snap Cloud Dashboard. See `resources/docs/usage_limits.mdx`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AuthRetryableFetchError` on startup | OIDC token not ready | Retry `signInWithIdToken` after 1 s delay, up to 3× |
| Realtime channel times out | Missing `heartbeatIntervalMs` | Always pass `{ realtime: { heartbeatIntervalMs: 2500 } }` to `createClient` |
| DB query returns empty or 401 | RLS policy missing | Add INSERT/SELECT policies in Dashboard → Table Editor → RLS |
| Storage download fails (401/403) | Bucket policy missing | Make bucket public OR add authenticated-user SELECT policy |
| Realtime messages silently dropped | Message exceeds 250 KB | Reduce `streamQuality ≤ 15` and `resolutionScale ≤ 0.3` for video streaming |
| Edge function returns 401 | Missing auth header | Pass `Authorization: Bearer <access_token>` and `apikey` header |
| 3D model not visible after load | Scale or orientation wrong | Enable `GltfSettings.convertMetersToCentimeters = true`; adjust local scale/rotation |
| Audio sounds pitch-shifted | Wrong sample rate in WAV header | Read `micControl.sampleRate` after setting it; use that value in WAV header |
| `postgres_changes` not firing | Realtime not enabled on table | In Table Editor, enable "Broadcast changes on this table" |
| Supabase Plugin not found in installed packages | LS < v5.15.21: plugin uses a separate registry | v5.15.21+: plugin is bundled with SnapCloud package — no separate install. On older versions, check **Window → Supabase**; if the menu exists, it is installed |

---

## Examples Reference

| Script | What it covers |
|--------|----------------|
| `setup-credentials.sh` | **Agent setup** — CLI login, credential extraction, `.supabaseProject` file generation |
| `BasicAuth.ts` | Auth + session, OIDC flow |
| `TableConnector.ts` | Full CRUD + upsert + preferences + event log |
| `RealtimeCursor.ts` | Bidirectional cursor sync (Specs ↔ web), 10 Hz broadcast |
| `StorageLoader.ts` | Download model, image, audio in parallel |
| `EdgeFunctionImgProcessing.ts` | Server-side image processing via edge function |
| `ImageCaptureUploader.ts` | Camera still → JPEG → Storage (with auth retry) |
| `VideoCaptureUploader.ts` | Record frames → batch upload session |
| `AudioCaptureUploader.ts` | PCM recording → WAV encoding → Storage |
| `VideoStreamingController.ts` | Live video broadcast via Realtime |
| `AudioStreamingController.ts` | Live audio (WAV chunks) via Realtime |
| `CompositeStreamingController.ts` | Synchronized video + audio streaming with shared sessionId |
| `SupabaseLeaderboardService.ts` | Lazy auth + RPC calls (submit_score, get_top_scores) |
| `GlobalLeaderboard.ts` | Leaderboard controller with ascending/descending sort |
| `LeaderboardRowInstantiator.ts` | Spawns prefab rows for SIK ScrollWindow |
| `SnapCloudRequirements.ts` | Centralized credentials + API URL helpers |

---

## Key Constraints

```typescript
// ALWAYS include heartbeatIntervalMs: 2500 (required alpha workaround)
const options = { realtime: { heartbeatIntervalMs: 2500 } }

// ALWAYS sign in before any database / storage / edge function call
// Error shape: { message: string, code?: string, details?: string, hint?: string }
// ALWAYS call client.removeAllChannels() in onDestroy()
// Camera/microphone NOT available inside edge functions
// Alpha: APIs may change. Apply at snap-ar.com/SnapCloudApplication
```
