<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Manifest (`nodes.json`) — reference

The manifest lists every template's authoritative port set, types, dimensions, per-port defaults, plus the `schemaDefaults` table (which sibling/port fields are stripped at default).

For paths and `SystemID`, see [`../SKILL.md` §6](../SKILL.md).

## Looking up a template

To recover any template's authoritative port set without reading the whole manifest, query by `templateID`:

```bash
# Replace the value after --arg id with the templateID you want to inspect.
jq --arg id node_util_custom_container_output_pixel \
  '.nodes[] | select(.templateID == $id) | .versions[-1] | {inputs, outputs, properties}' \
  "<LS_INSTALL>/Contents/Plugins/Es_VFXGraph.bundle/GraphResources/documentation/nodes.json"
```

This returns the YAML-relevant defaults: every port's `portID`, `classType`, `defaults`, and for COMBOs the `itemList`/`defaultIndex`.

## Structure

```
{
  "nodes": [
    {
      "templateID": "nodes_math_multiply",
      "title": "Multiply",
      "versions": [
        {
          "inputs": [
            { "portID": "Input0", "classType": "FLOAT", "dimension": 4, "defaultType": "xyzw",
              "defaults": [1.0, 1.0, 1.0, 1.0] },
            ...
          ],
          "outputs": [
            { "portID": "Output", "classType": "FLOAT", "dimension": 4, "defaultType": "xyzw" }
          ],
          "properties": [
            { "portID": "Inputs", "classType": "COMBO",
              "itemList": ["2", "3", "4", "5", "6"], "defaultIndex": 0 },
            { "portID": "EnableMax", "classType": "BOOL", "defaults": [false] },
            { "portID": "Title", "classType": "STRING", "defaults": ["Custom Code"] },
            ...
          ],
          "version": "1.0"
        }
      ]
    },
    ...
  ],
  "schemaDefaults": {
    "1": { "IOType": 0, "CheckValue": true, "EnablePreview": true, ... }
  },
  "timestamp": "..."
}
```

## Building a port from manifest data

For each port entry:
- `portID` → port map key in YAML
- `classType` → `ClassType1` in YAML — see [`../SKILL.md` §1](../SKILL.md) ("`ClassType1` is omitted for inferable classes") for which values to write vs. omit.
- `dimension` → length of the `Variable` flow array (1 = scalar)
- `defaults` → the value to write under `Variable:` (or `String:` for STRING/TEXT)
  - FLOAT/INT/BOOL: scalar if `dimension == 1`, flow array otherwise (`Variable: 1.0` or `Variable: [1.0, 1.0, 1.0, 1.0]`)
  - STRING/TEXT: `String: <defaults[0]>`
  - Outputs typically have no `defaults` field — they don't need a starter value
- `itemList` + `defaultIndex` (COMBO only) → `ItemList:` joined with ` : ` and `ItemIndex:` set to `defaultIndex`
  - Example: `"itemList": ["Vertex", "Pixel"], "defaultIndex": 1` → `ItemList: "Vertex : Pixel"` + `ItemIndex: 1`
- `defaultType` is a UI hint (`"xyzw"`, `"rgba"`, `"x"`, `"combo box"`, etc.) — informational only, the YAML form is the same.

When authoring, only write a port if you're setting it to something **other than its manifest default**. Defaults written explicitly are stripped on save.

## `schemaDefaults`

The top-level `schemaDefaults["1"]` (keyed by `SchemaVersion`) lists every node-/port-/document-level field that is stripped at default. The two authoring-critical defaults are `CheckValue: true` and `IOType: 0` — rules and rationale in [`../SKILL.md` §1](../SKILL.md).

Most other entries are obvious (`Selected: false`, `EnablePreview: true`, `CommentSizeX: 100`, etc.) — agents won't touch them. Treat the block as the source of truth if you ever need to know whether a missing field has a non-zero/non-false default.

## Lookup (grep fallback)

```bash
grep -n '"templateID": "nodes_math_multiply"' .../nodes.json
# then Read ~80 lines from the match offset
```
