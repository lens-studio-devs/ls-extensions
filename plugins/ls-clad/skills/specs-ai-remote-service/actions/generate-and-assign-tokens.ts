// Path-backed ExecuteEditorCode action. Tokens are acquired and retained only in this execution.
const actionRequired = (reason: string) => ({
  status: "ACTION_REQUIRED",
  reason,
  instruction: "Use Window > Remote Service Gateway Token > Generate for all providers, then assign the tokens in RemoteServiceGatewayCredentials and save the project.",
  automaticReadbackWiringAvailable: false,
  note: "Plugin secure storage is sandboxed, so ExecuteEditorCode cannot automatically read back or wire tokens generated in the plugin UI without a separately verified bridge.",
})

// Token minting is an authorized request, so a signed-out session cannot succeed. Report it
// with a stable reason before touching the scene, so callers can skip and continue.
let isAuthorized = false
try {
  isAuthorized = pluginSystem.findInterface(Editor.IAuthorization)?.isAuthorized === true
} catch {}
if (!isAuthorized) {
  return {
    status: "ACTION_REQUIRED",
    reason: "not_signed_in",
    instruction: "Sign in to Lens Studio from the profile menu, then re-run token generation and save the project.",
  }
}

const model = pluginSystem.findInterface(Editor.Model.IModel)
const scene = model.project.scene
type CredentialsComponent = Editor.Components.ScriptComponent & {
  type?: string
  snapToken: string
  openAIToken: string
  googleToken: string
}

const findCredentialsComponent = (): CredentialsComponent | null => {
  const visit = (sceneObject: Editor.Model.SceneObject): CredentialsComponent | null => {
    for (const component of sceneObject.components ?? []) {
      if (component.getTypeName() !== "ScriptComponent") continue
      const candidate = component as CredentialsComponent
      if (candidate.type?.includes?.("RemoteServiceGatewayCredentials") || candidate.scriptAsset?.name === "RemoteServiceGatewayCredentials") {
        return candidate
      }
    }
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

const credentials = findCredentialsComponent()
if (!credentials) {
  return actionRequired("RemoteServiceGatewayCredentials component not found in the scene")
}

try {
  const Network = await import("LensStudio:Network")
  const generateToken = async (provider: "SNAP" | "OPENAI" | "GOOGLE"): Promise<string> => {
    const response = await new Promise<any>((resolve) => {
      const request = new Network.HttpRequest()
      request.url = `https://gcp.api.snapchat.com/smart-gate/v2/token/${provider}`
      request.method = Network.HttpRequest.Method.Post
      Network.performAuthorizedHttpRequest(request, resolve)
    })
    const statusCode = response?.statusCode ?? 0
    if (!response || statusCode !== 200) {
      throw new Error(`Token request for ${provider} failed with HTTP ${statusCode}`)
    }
    const token = JSON.parse(response.body.toString()).token
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(`Token response for ${provider} was invalid`)
    }
    return token
  }

  const [snapToken, openAIToken, googleToken] = await Promise.all([
    generateToken("SNAP"),
    generateToken("OPENAI"),
    generateToken("GOOGLE"),
  ])

  credentials.snapToken = snapToken
  credentials.openAIToken = openAIToken
  credentials.googleToken = googleToken

  return {
    status: "TOKENS_ASSIGNED",
    assignedProviders: ["SNAP", "OPENAI", "GOOGLE"],
    saveRequired: true,
  }
} catch {
  return actionRequired("ExecuteEditorCode could not generate and assign all Remote Service Gateway tokens")
}
