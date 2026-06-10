<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Editor Setup Script

One-time bootstrap snippet. Use `ExecuteEditorCode` to build the `Requirements` infrastructure in one shot. Run this once after installing the RSG package — it is idempotent (skips objects/components that already exist), but a typical project bootstraps the hierarchy once and never re-runs it.

- **Inputs:** none (reads the installed RSG package assets via `assetManager.assets`).
- **Outputs:** a `Requirements` root SceneObject containing `RemoteServiceGatewayCredentials [EDIT ME]` (with the `RemoteServiceGatewayCredentials` ScriptComponent) → `Websocket requirements` (disabled) → `MicrophoneRecorder` + `DynamicAudioOutput` ScriptComponents.
- Follows the ExecuteEditorCode authoring rules in the Scene Hierarchy section of SKILL.md (no import/export, no Buffer, IIFE-wrap helpers, pass strings).

```typescript
// ExecuteEditorCode — creates Requirements hierarchy with RSG components
const model = pluginSystem.findInterface(Editor.Model.IModel) as any
const scene = model.project.scene as any         // Scene type is Editor.Assets.Scene; get the instance from model.project.scene
const assetManager = model.project.assetManager as any  // AssetManager type is Editor.Model.AssetManager; get the instance from model.project.assetManager

// Find RSG component types from installed package assets
const allAssets: any[] = assetManager.assets

// Helper: create named child object
function makeChild(parent: any, name: string): any {
  const obj = scene.createSceneObject(name)
  obj.setParent(parent)
  return obj
}

// Find root-level objects
const roots: any[] = scene.rootSceneObjects
const findRoot = (name: string) => roots.find((o: any) => o.name === name)

// Create Requirements group if not present
let requirements = findRoot("Requirements")
if (!requirements) {
  requirements = scene.createSceneObject("Requirements")
}

// Create RSG Credentials object
let credObj = null
for (let i = 0; i < requirements.getChildrenCount(); i++) {
  if (requirements.getChild(i).name === "RemoteServiceGatewayCredentials [EDIT ME]") {
    credObj = requirements.getChild(i)
    break
  }
}
if (!credObj) {
  credObj = makeChild(requirements, "RemoteServiceGatewayCredentials [EDIT ME]")
}

// Add RemoteServiceGatewayCredentials component
const credAsset = allAssets.find((a: any) => a.name === "RemoteServiceGatewayCredentials")
if (credAsset) {
  const existing = credObj.getComponent("ScriptComponent")
  if (!existing) {
    const comp = credObj.addComponent("ScriptComponent") as any
    comp.scriptAsset = credAsset
  }
}

// Create Websocket requirements child (disabled)
const wsObj = makeChild(credObj, "Websocket requirements")
wsObj.enabled = false

// Add MicrophoneRecorder component
const micObj = makeChild(wsObj, "MicrophoneRecorder")
const micAsset = allAssets.find((a: any) => a.name === "MicrophoneRecorder")
if (micAsset) {
  const comp = micObj.addComponent("ScriptComponent") as any
  comp.scriptAsset = micAsset
}

// Add DynamicAudioOutput component
const daoObj = makeChild(wsObj, "DynamicAudioOutput")
const daoAsset = allAssets.find((a: any) => a.name === "DynamicAudioOutput")
if (daoAsset) {
  const comp = daoObj.addComponent("ScriptComponent") as any
  comp.scriptAsset = daoAsset
}

return `Requirements hierarchy created. Set your API token on 'RemoteServiceGatewayCredentials [EDIT ME]'.`
```
