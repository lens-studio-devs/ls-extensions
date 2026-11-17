<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Editor Setup Action

The one-time, idempotent Requirements bootstrap is the pinned path-backed action at:

`../actions/bootstrap-requirements.ts`

Run it through `ExecuteEditorCode` with the action's absolute path and no `args`. It reuses an existing `RemoteServiceGatewayCredentials` component (a `Requirements` hierarchy or the `RemoteServiceGateway__PLACE_IN_SCENE` prefab) and an existing `Websocket requirements` object, otherwise creates only missing Requirements objects and matching RSG ScriptComponents; a newly created `Websocket requirements` starts disabled. The receipt names the credentials and websocket objects for the wiring action. The action intentionally replaces the old copy-and-paste body in this reference.
