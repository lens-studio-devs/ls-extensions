<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: Leaderboard

**When this applies:** any match for `LeaderboardModule`, `leaderboardModule`,
`Leaderboard.UsersType`, or `Leaderboard.OrderingType` in the project scan.

Replace the deprecated native `LeaderboardModule` / `LeaderboardCore` component (backed by
Snapchat's leaderboard service) with a SnapCloud-backed global leaderboard using Supabase RPCs
(`submit_score`, `get_top_scores`).

## Detection Patterns

- `LeaderboardModule`
- `leaderboardModule`
- `Leaderboard.UsersType`
- `Leaderboard.OrderingType`

## Feature Parity Notes

These native leaderboard features have no direct equivalent in the SnapCloud implementation:

| Feature | Status |
|---|---|
| `Leaderboard.UsersType.Friends` — friends-only leaderboard | **Not supported.** SnapCloud leaderboard is global. Remove the filter or inform the user. |
| `ScoreResetIntervalOption.Week/Month/etc.` — automatic score resets | **Not supported.** No built-in reset. Use separate leaderboard names per time window if needed (e.g. `"myLeaderboard_week42"`). |
| `leaderboardRecordsWrapper.currentUserRecord` — caller's own record | **No direct equivalent.** The caller's entry will appear in the top-N results if they have a score; find it by matching `displayname`. |
| `Leaderboard.UsersType.None` | Remove — not applicable. |

## API Mapping

| Old (LeaderboardCore / LeaderboardModule) | New (GlobalLeaderboard / SupabaseLeaderboardService) |
|---|---|
| `@input Component.ScriptComponent LeaderboardCore` | Add `GlobalLeaderboard` and `SupabaseLeaderboardService` scene components |
| `initializeWithOptions({...})` | Remove. Config lives in `@input` fields on `GlobalLeaderboard` (`ascending`, `itemsCount`) and in the Supabase backend. |
| `onLeaderboardRecordsUpdated.add(cb)` | Call `await globalLeaderboard.refresh()` after score submit; wire UI via `LeaderboardRowInstantiator.render(entries)` |
| `submitScore(score)` | `await globalLeaderboard.submitScore(score, displayName)` — async, display name required |
| `leaderboardRecordsWrapper.userRecords` | `getTopScores()` rows → `[{ rank, displayname, score }]` |
| `leaderboardRecordsWrapper.currentUserRecord` | Not available — search `userRecords` by `displayname` |
| `Leaderboard.OrderingType.Descending` | `ascending: false` on `GlobalLeaderboard` |
| `Leaderboard.OrderingType.Ascending` | `ascending: true` on `GlobalLeaderboard` |
| `userLimit: 10` | `itemsCount: 10` on `GlobalLeaderboard` |
| `leaderboardModule.getLeaderboard(opts, cb, failCb)` | `SupabaseLeaderboardService.getTopScores(limit, sortMode)` |
| `leaderboard.getLeaderboardInfo(opts, cb, failCb)` | `await supabaseService.getTopScores(limit, sortMode)` |
| `leaderboard.submitScore(score, cb, failCb)` | `await supabaseService.submitScore(score, displayName, sortMode)` |

## Prerequisites

> **Agent note:** The new leaderboard backend is powered by SnapCloud (Supabase). Before proceeding, also read `../../specs-snap-cloud/SKILL.md` — its **Setup** section covers package installation, Supabase project creation, and credential import in detail. Use it to guide the user through any step they haven't completed yet.

Before migrating script code:

1. **Install the SnapCloud / SupabaseClient package** from Asset Library (or confirm it is already installed).
   - Lens Studio v5.15.21+: one package (`SnapCloud / SupabaseClient`).
   - Older versions: install `SupabaseClient` + enable the Supabase Plugin via **Window → Supabase**.

2. **Create a SupabaseProject asset**: `Window → Supabase → Import Credentials` (or generate via CLI — see the `specs-snap-cloud` skill).

3. **Run the database setup SQL** (once per Supabase project) — see the next section.

## Database Setup

> **Agent note:** Users do not have direct access to this reference file. When you reach this step, **copy and display the full SQL block below to the user** with clear instructions to run it in their Snap Cloud Dashboard → SQL Editor. Do not assume they have already seen or run it.

Run the following SQL in your **Snap Cloud Dashboard → SQL Editor** (or via `supabase db push` with a migration file):

```sql
-- Leaderboard table
CREATE TABLE leaderboard (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) UNIQUE,
  displayname text NOT NULL,
  score numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own score"
  ON leaderboard FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own score"
  ON leaderboard FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Anyone can read the leaderboard"
  ON leaderboard FOR SELECT USING (true);

-- submit_score: upserts the player's personal best
CREATE OR REPLACE FUNCTION submit_score(
  p_score numeric,
  p_displayname text,
  p_sort_mode text DEFAULT 'desc'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing_score numeric;
BEGIN
  SELECT score INTO existing_score FROM leaderboard WHERE user_id = auth.uid();

  IF existing_score IS NULL THEN
    INSERT INTO leaderboard (user_id, displayname, score)
    VALUES (auth.uid(), p_displayname, p_score);
  ELSIF (p_sort_mode = 'desc' AND p_score > existing_score)
     OR (p_sort_mode = 'asc'  AND p_score < existing_score) THEN
    UPDATE leaderboard SET score = p_score, displayname = p_displayname
    WHERE user_id = auth.uid();
  END IF;
END;
$$;

-- get_top_scores: returns top N rows
CREATE OR REPLACE FUNCTION get_top_scores(
  p_limit integer DEFAULT 10,
  p_sort_mode text DEFAULT 'desc'
)
RETURNS TABLE(displayname text, score numeric) LANGUAGE plpgsql AS $$
BEGIN
  IF p_sort_mode = 'asc' THEN
    RETURN QUERY SELECT l.displayname, l.score FROM leaderboard l ORDER BY l.score ASC LIMIT p_limit;
  ELSE
    RETURN QUERY SELECT l.displayname, l.score FROM leaderboard l ORDER BY l.score DESC LIMIT p_limit;
  END IF;
END;
$$;
```

## Script Migration Steps

### Step 1: Add required scripts to Assets/Scripts/

These four scripts are available as reference implementations at `../../specs-snap-cloud/resources/scripts/`. Copy them into your project's `Assets/Scripts/`, or install them from the Asset Library → **SnapCloudExamples** (`Example6-GlobalLeaderboard/Scripts/`):

- `SupabaseLeaderboardService.ts`
- `GlobalLeaderboard.ts`
- `LeaderboardRowInstantiator.ts` *(optional — only needed if you render a UI row list)*
- `LeaderboardRowItem.ts` *(optional — only needed with `LeaderboardRowInstantiator`)*

> **GridLayout row positioning (custom row instantiation only):** Do not call `GridLayout.initialize()`/`layout()` on dynamically created rows — use manual Y offsets instead (`GridContentCreator` already does this).

> **ScrollWindow viewport sizing (custom row instantiation only):** Ensure `itemsCount * (itemHeight + rowGap) < ScrollWindow._windowSize.y` or rows will be clipped. For a standard 32 cm ScrollWindow with 10 rows, use `itemHeight = 3.0` and `rowGap = 0.2`.

### Step 2: Remove LeaderboardModule / LeaderboardCore input declarations

```ts
// OLD — remove this decorator and property
@input
leaderboardCore: Component.ScriptComponent;
```

Also remove any `@input Asset.LeaderboardModule leaderboardModule` declarations.

### Step 3: Remove `initializeWithOptions()`

Delete the entire `initializeWithOptions(...)` call. The equivalent config is set via `@input` properties on `GlobalLeaderboard` in the Lens Studio Inspector:

| Old `initializeWithOptions` field | New `GlobalLeaderboard` @input |
|---|---|
| `name` | Stored in Supabase (the table name is fixed as `leaderboard`) |
| `scoreOrdering: Descending` | `ascending: false` |
| `scoreOrdering: Ascending` | `ascending: true` |
| `userLimit: N` | `itemsCount: N` |
| `scoreResetInterval` | No equivalent |
| `userType` | No equivalent |
| `useTimer`, `leaderboardStartDate` | No equivalent |

### Step 4: Replace the event handler

**JavaScript — before:**
```js
script.LeaderboardCore.onLeaderboardRecordsUpdated.add(
    (leaderboardRecordsWrapper) => {
        print(leaderboardRecordsWrapper.userRecords);
        print(leaderboardRecordsWrapper.currentUserRecord);
    }
);
```

**JavaScript — after (inline usage without UI rows):**
```js
// No event listener needed.
// Call globalLeaderboard.refresh() to re-fetch and display the list.
// Wire globalLeaderboard via scene — see Scene Setup below.
```

**TypeScript — after (with LeaderboardRowInstantiator):**
```ts
// Refresh is called automatically on start by GlobalLeaderboard.
// Call it manually after a score submit:
await this.globalLeaderboard.refresh();
// GlobalLeaderboard passes entries to LeaderboardRowInstantiator.render() internally.
```

### Step 5: Replace `submitScore(score)` with async `submitScore(score, displayName)`

The new API is async and requires a display name. Fetch it from `userContextSystem` before submitting.

**JavaScript — before:**
```js
const tap = script.createEvent('TapEvent');
tap.bind(() => {
    script.LeaderboardCore.submitScore(Math.ceil(Math.random() * 100));
});
```

**JavaScript — after:**
```js
// Wire globalLeaderboard via scene input (see Scene Setup).
// //@input Component.ScriptComponent GlobalLeaderboard

function getDisplayName(fallback) {
    return new Promise(function(resolve) {
        if (!global.userContextSystem || typeof global.userContextSystem.requestDisplayName !== 'function') {
            resolve(fallback || 'Player');
            return;
        }
        global.userContextSystem.requestDisplayName(function(name) {
            resolve((name && name.trim()) || fallback || 'Player');
        });
    });
}

const tap = script.createEvent('TapEvent');
tap.bind(function() {
    const score = Math.ceil(Math.random() * 100);
    getDisplayName('Player').then(function(displayName) {
        return script.GlobalLeaderboard.submitScore(score, displayName);
    }).catch(function(err) {
        print('Leaderboard submit error: ' + err);
    });
});
```

**TypeScript — after (inside a @component class):**
```ts
@input
globalLeaderboard: GlobalLeaderboard;

private async submitAndRefresh(score: number): Promise<void> {
    const displayName = await this.getDisplayName();
    await this.globalLeaderboard.submitScore(score, displayName);
    // GlobalLeaderboard.submitScore() calls refresh() internally —
    // no explicit refresh() call needed here.
}

private getDisplayName(): Promise<string> {
    const fallback = 'Player';
    if (!global.userContextSystem || typeof global.userContextSystem.requestDisplayName !== 'function') {
        return Promise.resolve(fallback);
    }
    return new Promise((resolve) => {
        global.userContextSystem.requestDisplayName((name: string) => {
            resolve((name && name.trim()) || fallback);
        });
    });
}
```

## Scene Setup

Add the following scene objects to your scene hierarchy (or add components to an existing object):

```
YourScene
└── Leaderboard                          ← new SceneObject
    ├── ScriptComponent: SupabaseLeaderboardService
    │       @input supabaseProject  →  <your .supabaseProject asset>
    └── ScriptComponent: GlobalLeaderboard
            @input supabaseService  →  SupabaseLeaderboardService component above
            @input rowInstantiator  →  LeaderboardRowInstantiator component (if using UI rows)
            @input ascending        →  false  (highest score first) or true (lowest score first)
            @input itemsCount       →  10     (number of rows to fetch)
```

If you are rendering a scrollable row list, add under the same object (or a child):

```
    └── ScriptComponent: LeaderboardRowInstantiator
            @input itemPrefab       →  your row prefab (has LeaderboardRowItem script)
            @input globalLeaderboard → GlobalLeaderboard component above
            @input startPosition    →  first row local position (e.g. 0, 0, 0)
            @input step             →  position offset per row (e.g. 0, -4, 0)
```

Each row prefab needs a `LeaderboardRowItem` script with:
- `@input rankText` → SceneObject with Text component for `#1`, `#2`, …
- `@input displaynameText` → SceneObject with Text component for the player name
- `@input scoreText` → SceneObject with Text component for the score value

## Complete Minimal Example

The test project `useLeaderboarCore.js` used only `submitScore` and the update event. Here is the equivalent TS component:

```ts
@component
export class LeaderboardController extends BaseScriptComponent {
    @input
    globalLeaderboard: GlobalLeaderboard;

    onAwake(): void {
        // GlobalLeaderboard fetches and renders on start automatically.
        // Wire a tap/button to call submitAndRefresh().
        const tap = this.createEvent('TapEvent');
        tap.bind(() => {
            const score = Math.ceil(Math.random() * 100);
            this.submitAndRefresh(score).catch((err) => {
                print('Leaderboard error: ' + err);
            });
        });
    }

    private async submitAndRefresh(score: number): Promise<void> {
        const displayName = await this.getDisplayName();
        await this.globalLeaderboard.submitScore(score, displayName);
        // submitScore() automatically calls refresh() — no extra call needed.
    }

    private getDisplayName(): Promise<string> {
        const fallback = 'Player';
        if (!global.userContextSystem || typeof global.userContextSystem.requestDisplayName !== 'function') {
            return Promise.resolve(fallback);
        }
        return new Promise((resolve) => {
            global.userContextSystem.requestDisplayName((name: string) => {
                resolve((name && name.trim()) || fallback);
            });
        });
    }
}
```
