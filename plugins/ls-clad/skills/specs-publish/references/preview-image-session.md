<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Session-owned preview image preparation

The default image path needs two files to meet Dev Dash's details-page minimum. The earlier implementation left capture ordering, path construction, and result checks to the model. This change moves those mechanics into the existing publish session; visual suitability and user confirmation remain model/user decisions.

## Boundary and state ownership

`prepare-preview-images` requires a staged publish context and allocates a private capture directory. The optional schema-validated `imageCount` (`--image-count`) defaults to two. One is allowed only after the session retains the automatic recording or its image fallback, preserving the minimum of two total previews. The count is bound before capture. It returns a reset request and the first file-mode screenshot request. `record-preview-images` validates the untouched direct ChatTool/MCP result, binds its path to the outstanding request, and issues another request only until the bound count is reached. It rejects missing files, wrong panels, replayed paths, inline media, and calls outside the capture/staging states.

Once all requested receipts are persisted, the session invokes the existing screenshot stager, validates its response, retains the PNGs with the recording, when present, under a shared expiration manifest, and returns inspection paths. Session `prepare` supplies the recording first and the requested screenshots next to the existing review/freeze/confirmation pipeline. The existing registration and Finalize authorization contracts are unchanged. The stager's single-image interface remains available for the video fallback.

[preview-images.schema.json](../scripts/schemas/preview-images.schema.json) owns the new input/output contracts and image dimensions. [preview_contract.py](../scripts/schemas/preview_contract.py) validates its closed JSON Schema vocabulary without adding a host dependency; unsupported keywords/references fail closed. File identity and correspondence with the pending request are additional runtime checks. Schemas cover single/pair/error staging results, capture receipts, session requests/results, and the retained media manifest.

## Failure and lifecycle behavior

A preparation replay cannot allocate or reissue captures. A failed receipt does not advance to another capture. A normalization failure retains accepted receipts and raw sources, allowing a handle-only staging retry. Explicit user-supplied manual paths are accepted only after a capture/staging failure. No recovery operation performs a capture itself.

Only a fully staged selection is retained. Manual recovery must supply exactly the bound screenshot count. Retention rollback preserves any existing recording and its original manifest. Successful retention removes session-owned raw files and intermediates. Cancellation removes the retained media; successful completion preserves the selection for the existing artifact retention period. A visual rejection after staging uses cancellation and explicit replacement media, preserving the existing confirmation boundary.

## Validation

The optional input preserves existing two-screenshot calls and sessions; stored sessions without a count use two. No plugin, Lens Studio, or package version changes are required.

Tests exercise one-image/video ordering and authorization, shared retention after completion, count validation, staging retries and rollback, and real PNG staging through the session into confirmation and registration indices 0/1, bad and replayed receipts, missing files, schema rejection, staging retries, manual recovery, and cancellation/completion retention. Schema tests cover cardinality, dimensions, types, required/unknown fields, error responses, and unsupported validator vocabulary. The transcript audit recognizes the session-owned pair while rejecting additional captures.
