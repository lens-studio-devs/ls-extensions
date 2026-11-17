// Path-backed ExecuteEditorCode action. All runtime identifiers are names, never native objects.
const requiredString = (_name: string, value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null

const optionalString = (name: string, value: unknown): string | null | undefined => {
  if (value === undefined) return undefined
  return requiredString(name, value)
}

const credentialsObjectName = requiredString(
  "credentialsObjectName",
  args.credentialsObjectName ?? "RemoteServiceGatewayCredentials [EDIT ME]",
)
const websocketRequirementsObjectName = requiredString(
  "websocketRequirementsObjectName",
  args.websocketRequirementsObjectName ?? "Websocket requirements",
)
const microphoneObjectName = requiredString("microphoneObjectName", args.microphoneObjectName ?? "MicrophoneRecorder")
const dynamicAudioOutputObjectName = requiredString(
  "dynamicAudioOutputObjectName",
  args.dynamicAudioOutputObjectName ?? "DynamicAudioOutput",
)
const geminiAssistantObjectName = optionalString("geminiAssistantObjectName", args.geminiAssistantObjectName)
const openAIAssistantObjectName = optionalString("openAIAssistantObjectName", args.openAIAssistantObjectName)
const uiBridgeObjectName = optionalString("uiBridgeObjectName", args.uiBridgeObjectName)

const validatedNames: Array<[string, string | null | undefined]> = [
  ["credentialsObjectName", credentialsObjectName],
  ["websocketRequirementsObjectName", websocketRequirementsObjectName],
  ["microphoneObjectName", microphoneObjectName],
  ["dynamicAudioOutputObjectName", dynamicAudioOutputObjectName],
  ["geminiAssistantObjectName", geminiAssistantObjectName],
  ["openAIAssistantObjectName", openAIAssistantObjectName],
  ["uiBridgeObjectName", uiBridgeObjectName],
]
for (const [name, value] of validatedNames) {
  if (value === null) return { error: `Invalid ${name}` }
}

if (!geminiAssistantObjectName && !openAIAssistantObjectName && !uiBridgeObjectName) {
  return { error: "At least one assistant or UI bridge object name is required" }
}

if (uiBridgeObjectName && (!geminiAssistantObjectName || !openAIAssistantObjectName)) {
  return {
    error: "Both geminiAssistantObjectName and openAIAssistantObjectName are required when uiBridgeObjectName is supplied",
  }
}

const model = pluginSystem.findInterface(Editor.Model.IModel)
const scene = model.project.scene

const findByName = (name: string): Editor.Model.SceneObject | null => {
  const visit = (sceneObject: Editor.Model.SceneObject): Editor.Model.SceneObject | null => {
    if (sceneObject.name === name) return sceneObject
    for (let index = 0; index < sceneObject.getChildrenCount(); index += 1) {
      const found = visit(sceneObject.getChildAt(index))
      if (found) return found
    }
    return null
  }
  for (const root of scene.rootSceneObjects) {
    const found = visit(root)
    if (found) return found
  }
  return null
}

type ConfigurableScriptComponent = Editor.Components.ScriptComponent & {
  setInputValue(name: string, value: unknown): void
}
const scriptComponent = (
  sceneObject: Editor.Model.SceneObject | null,
): ConfigurableScriptComponent | null => {
  const component = (sceneObject?.components ?? []).find(
    (candidate) => candidate.getTypeName() === "ScriptComponent",
  )
  return component ? component as ConfigurableScriptComponent : null
}

if (
  credentialsObjectName === null ||
  websocketRequirementsObjectName === null ||
  microphoneObjectName === null ||
  dynamicAudioOutputObjectName === null
) {
  return { error: "Required Remote Service Gateway object names are invalid" }
}

const credentials = findByName(credentialsObjectName)
const websocketRequirements = findByName(websocketRequirementsObjectName)
const microphone = scriptComponent(findByName(microphoneObjectName))
const dynamicAudioOutput = scriptComponent(findByName(dynamicAudioOutputObjectName))
if (!credentials || !websocketRequirements || !microphone || !dynamicAudioOutput) {
  return { error: "Required Remote Service Gateway objects or components were not found" }
}

const assistants: Array<[string, string | null | undefined]> = [
  ["Gemini", geminiAssistantObjectName],
  ["OpenAI", openAIAssistantObjectName],
]
const resolvedAssistants: Array<[string, ConfigurableScriptComponent]> = []
for (const [kind, objectName] of assistants) {
  if (!objectName) continue
  const component = scriptComponent(findByName(objectName))
  if (!component) return { error: `${kind} assistant ScriptComponent was not found` }
  resolvedAssistants.push([objectName, component])
}

let uiBridge: ConfigurableScriptComponent | null = null
if (uiBridgeObjectName) {
  uiBridge = scriptComponent(findByName(uiBridgeObjectName))
  if (!uiBridge) return { error: "AI assistant UI bridge ScriptComponent was not found" }
}

for (const [, assistant] of resolvedAssistants) {
  assistant.setInputValue("websocketRequirementsObj", websocketRequirements)
  assistant.setInputValue("microphoneRecorder", microphone)
  assistant.setInputValue("dynamicAudioOutput", dynamicAudioOutput)
}

let wiredUIBridge = false
if (uiBridge) {
  const gemini = resolvedAssistants.find(([name]) => name === geminiAssistantObjectName)?.[1]
  const openAI = resolvedAssistants.find(([name]) => name === openAIAssistantObjectName)?.[1]
  if (gemini) {
    uiBridge.setInputValue("geminiAssistant", gemini)
    wiredUIBridge = true
  }
  if (openAI) {
    uiBridge.setInputValue("openAIAssistant", openAI)
    wiredUIBridge = true
  }
}

return {
  status: "RSG_INPUTS_WIRED",
  credentialsObjectName,
  websocketRequirementsObjectName,
  wiredAssistants: resolvedAssistants.map(([name]) => name),
  wiredUIBridge,
}
