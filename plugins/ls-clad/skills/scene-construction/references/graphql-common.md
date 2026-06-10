<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Shared GraphQL Patterns (scene-graphql + asset-graphql)

Patterns common to both the `scene-graphql` and `asset-graphql` MCP tools. The consuming reference files point here for the shared rules; only surface-specific examples, error-table rows, and cheatsheet queries live in those files.

## Enum-arg casing (shared preamble)

GraphQL enum arguments are passed **without quotes**, in the casing declared by their enum:

- `ValueType` uses **UPPERCASE**: `valueType: NUMBER` / `VEC3` / `ENUM` / `LAYER_SET_MASK` (not `"NUMBER"`, not `Number`).

Wrong casing fails with `"Enum value 'X' does not exist in 'EnumName'"`. Wrapping in quotes fails with `"String cannot represent enum"`. Introspect any enum with `{ __type(name: "EnumName") { enumValues { name } } }` when unsure.

(Each surface adds its own surface-specific enum bullet — see the leading gotcha in scene-graphql.md / asset-graphql.md.)

## §1. Editor API ≠ GraphQL surface

> The `Editor.*` namespace does NOT exist inside these GraphQL tools. They accept a GraphQL query string, not JavaScript. If you need `Editor.*` access (e.g. `Editor.Model.Project`, `Editor.Assets.*`, `Editor.Components.*`), use `ExecuteEditorCode` instead. A GraphQL query that references `Editor.X` will fail to compile with `"Editor.X doesn't exist on typeof Editor"`.

## §2. Composite fields require subselections (but `properties` is JSON)

Every GraphQL field has a type. Scalar types (`String`, `Int`, `Boolean`, `ID`, `Float`, `JSON`) are leaves — request by name. Composite types (e.g. `Component`, `SceneObject`, `Transform`, `Asset`, `Preset`) are objects — wrap them in `{ ... }` listing the inner fields you want, or the query fails with `"must have a selection of subfields"`. The server-side `errorHints.enrichErrors` appends an inline hint to that error when it fires.

**`properties` is the exception — it's a JSON scalar, query it WITHOUT subfields.** Adding a subselection here fails.

**Mutation results are flat — no nested entity field.** A mutation returns the fields directly on the result type, not under a wrapper (e.g. `createSceneObject(...) { id name }`, NOT `{ sceneObject { id name } }`).

`path` is returned by creation mutations and asset queries, but not by plain `MutationResult` types — don't request it from `setProperty`, `setName`, etc.

When unsure what's inside a composite type, introspect first:

```graphql
{ __type(name: "SomeType") { fields { name type { name kind } } } }
```

(See each surface's §2 for the surface-specific composite-type names and example queries.)

## §3. Don't guess field names — introspect

If you don't know whether a field exists, don't guess. Run a one-line introspection query first:

```graphql
{ __schema { queryType { fields { name } } } }                       # top-level queries
{ __schema { mutationType { fields { name } } } }                    # top-level mutations
{ __type(name: "SomeType") { fields { name type { name kind } } } }  # fields on a specific type
```

Introspection is cheap (one round-trip) and prevents wasted retries on hallucinated names.

## §6. Batching independent mutations

Multiple independent mutations can go in one query — fire them as GraphQL aliases:

```graphql
mutation {
  a: someMutation(...) { success message }
  b: anotherMutation(...) { success message }
}
```

Only request fields the result type actually has — a missing field on one mutation fails the entire batch. When in doubt, introspect: `{ __type(name: "<MutationResultType>") { fields { name } } }`.

## Result-shape compatibility (shared advisory)

Some benchmark runs hit older Lens Studio MCP schemas where preset-create result types did not expose `success`. Prefer the example return fields in each reference for create-from-preset calls. If a query fails on a return field, do not keep retrying the same shape — introspect the result type and remove unavailable fields. (Each surface lists its own result-type names to introspect.)
