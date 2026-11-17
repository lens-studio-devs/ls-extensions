// Path-backed ExecuteEditorCode action. This static bootstrap intentionally takes no args.
const model = pluginSystem.findInterface(Editor.Model.IModel)
const scene = model.project.scene
const assetManager = model.project.assetManager

const requiredAssets = [
  "RemoteServiceGatewayCredentials",
  "MicrophoneRecorder",
  "DynamicAudioOutput",
]
const assetsByName = new Map<string, Editor.Assets.Asset>()
for (const asset of assetManager.assets) {
  if (requiredAssets.includes(asset.name)) {
    assetsByName.set(asset.name, asset)
  }
}
const missingAssets = requiredAssets.filter((name) => !assetsByName.has(name))
if (missingAssets.length > 0) {
  return {
    status: "ACTION_REQUIRED",
    reason: "Required Remote Service Gateway assets are unavailable",
    missingAssets,
  }
}

const childrenNamed = (
  parent: Editor.Model.SceneObject,
  name: string,
): Editor.Model.SceneObject | null => {
  for (let index = 0; index < parent.getChildrenCount(); index += 1) {
    const child = parent.getChildAt(index)
    if (child.name === name) return child
  }
  return null
}

const findRequirements = (): Editor.Model.SceneObject | null => {
  let firstNamedRequirements: Editor.Model.SceneObject | null = null
  let validRequirements: Editor.Model.SceneObject | null = null
  const visit = (sceneObject: Editor.Model.SceneObject): void => {
    if (sceneObject.name === "Requirements") {
      firstNamedRequirements ??= sceneObject
      const credentials = childrenNamed(sceneObject, "RemoteServiceGatewayCredentials [EDIT ME]")
      if (credentials && childrenNamed(credentials, "Websocket requirements")) {
        validRequirements ??= sceneObject
      }
    }
    for (let index = 0; index < sceneObject.getChildrenCount(); index += 1) {
      visit(sceneObject.getChildAt(index))
    }
  }
  for (const root of scene.rootSceneObjects) {
    visit(root)
  }
  return validRequirements ?? firstNamedRequirements
}

let created = false
const ensureChild = (parent: Editor.Model.SceneObject, name: string): Editor.Model.SceneObject => {
  const existing = childrenNamed(parent, name)
  if (existing) return existing
  const child = scene.createSceneObject(name)
  child.setParent(parent)
  created = true
  return child
}

const hasScriptAsset = (
  sceneObject: Editor.Model.SceneObject,
  asset: Editor.Assets.Asset,
): boolean =>
  (sceneObject.components ?? []).some((component) =>
    component.getTypeName() === "ScriptComponent" &&
    // Compare ids: the editor returns a new wrapper object on every property access.
    String((component as Editor.Components.ScriptComponent).scriptAsset?.id) === String(asset.id),
  )

const ensureScriptAsset = (sceneObject: Editor.Model.SceneObject, assetName: string): void => {
  const asset = assetsByName.get(assetName)
  if (!asset) throw new Error(`Required script asset ${assetName} was not indexed`)
  if (hasScriptAsset(sceneObject, asset)) return
  const component = sceneObject.addComponent("ScriptComponent")
  component.scriptAsset = asset as Editor.Assets.ScriptAsset
  created = true
}

// Reuse an existing credentials component anywhere in the scene (e.g. the RSG
// RemoteServiceGateway__PLACE_IN_SCENE prefab, which has no Requirements parent) so the
// scene never carries two RemoteServiceGatewayCredentials components.
const findAll = (predicate: (sceneObject: Editor.Model.SceneObject) => boolean): Editor.Model.SceneObject[] => {
  const found: Editor.Model.SceneObject[] = []
  const visit = (sceneObject: Editor.Model.SceneObject): void => {
    if (predicate(sceneObject)) found.push(sceneObject)
    for (let index = 0; index < sceneObject.getChildrenCount(); index += 1) {
      visit(sceneObject.getChildAt(index))
    }
  }
  for (const root of scene.rootSceneObjects) {
    visit(root)
  }
  return found
}

const credentialsAsset = assetsByName.get("RemoteServiceGatewayCredentials") as Editor.Assets.Asset
const requirements = findRequirements()
const nestedCredentials = requirements
  ? childrenNamed(requirements, "RemoteServiceGatewayCredentials [EDIT ME]")
  : null
const existingCredentials =
  nestedCredentials && hasScriptAsset(nestedCredentials, credentialsAsset)
    ? nestedCredentials
    : (findAll((sceneObject) => hasScriptAsset(sceneObject, credentialsAsset))[0] ?? null)

let credentials: Editor.Model.SceneObject
if (existingCredentials) {
  credentials = existingCredentials
} else {
  let parent = requirements
  if (!parent) {
    parent = scene.createSceneObject("Requirements")
    created = true
  }
  credentials = ensureChild(parent, "RemoteServiceGatewayCredentials [EDIT ME]")
  ensureScriptAsset(credentials, "RemoteServiceGatewayCredentials")
}

// A newly created Websocket requirements object starts disabled (the assistant enables it);
// an existing one keeps its state.
const existingWebsocketRequirements =
  childrenNamed(credentials, "Websocket requirements") ??
  findAll((sceneObject) => sceneObject.name === "Websocket requirements")[0] ??
  null
const websocketRequirements =
  existingWebsocketRequirements ?? ensureChild(credentials, "Websocket requirements")
if (!existingWebsocketRequirements) websocketRequirements.enabled = false

const microphone = ensureChild(websocketRequirements, "MicrophoneRecorder")
ensureScriptAsset(microphone, "MicrophoneRecorder")

const dynamicAudioOutput = ensureChild(websocketRequirements, "DynamicAudioOutput")
ensureScriptAsset(dynamicAudioOutput, "DynamicAudioOutput")

return {
  status: "REQUIREMENTS_READY",
  created,
  credentialsObjectName: credentials.name,
  websocketRequirementsObjectName: websocketRequirements.name,
  websocketRequirementsEnabled: websocketRequirements.enabled,
}
