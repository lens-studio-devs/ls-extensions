// ExecuteEditorCode async-function body. `args` is injected by Core-ChatTools.
const featureName = typeof args?.featureName === "string" ? args.featureName.trim() : "";

if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(featureName)) {
    return { error: "Invalid featureName" };
}

const model = pluginSystem.findInterface(Editor.Model.IModel);
const scene = model.project.scene;
const assetManager = model.project.assetManager;
const scriptName = featureName + "Controller";
const rootName = featureName + "ControllerRoot";

type AssetNode = Editor.Assets.Asset & { children?: Editor.Assets.Asset[] };
const findAsset = (assets: readonly Editor.Assets.Asset[]): Editor.Assets.Asset | undefined => {
    for (const asset of assets) {
        if (!asset) continue;
        if (asset.name === scriptName || String(asset.name).endsWith("/" + scriptName)) return asset;
        const nested = findAsset((asset as AssetNode).children ?? []);
        if (nested) return nested;
    }
    return undefined;
};

const foundAsset = findAsset(assetManager.assets);
if (!foundAsset) {
    return { error: "Controller asset not found", scriptName };
}
const scriptAsset = foundAsset as Editor.Assets.ScriptAsset;

const scriptId = scriptAsset.id != null ? String(scriptAsset.id) : "";
for (const sceneObject of scene.sceneObjects) {
    for (const component of sceneObject.components) {
        if (component.getTypeName() !== "ScriptComponent") continue;
        const attachedAsset = (component as Editor.Components.ScriptComponent).scriptAsset;
        if (!attachedAsset) continue;
        if (
            attachedAsset === scriptAsset ||
            (scriptId && String(attachedAsset.id) === scriptId) ||
            attachedAsset.name === scriptName
        ) {
            return {
                ok: true,
                alreadyPresent: true,
                hostId: sceneObject.id.toString(),
                hostName: sceneObject.name,
            };
        }
    }
}

let host = scene.sceneObjects.find((sceneObject) => sceneObject.name === rootName);
if (!host) host = scene.createSceneObject(rootName);

let scriptComponent = host.components.find((component) => {
    if (component.getTypeName() !== "ScriptComponent") return false;
    return !(component as Editor.Components.ScriptComponent).scriptAsset;
}) as Editor.Components.ScriptComponent | undefined;
if (!scriptComponent) scriptComponent = host.addComponent("ScriptComponent");
scriptComponent.scriptAsset = scriptAsset;

try {
    model.project.save();
} catch (_error) {
    // Saving is best-effort in this Editor API flow; the assignment above remains the mutation.
}

return { ok: true, created: true, hostId: host.id.toString(), hostName: host.name };
