function invalidArgs(error: string) {
    return { error: `invalid args: ${error}` };
}

const input = args as any;
if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return invalidArgs("args must be a JSON object");
}
if (
    input.packageNames !== undefined &&
    (!Array.isArray(input.packageNames) ||
        input.packageNames.length === 0 ||
        input.packageNames.some((name: unknown) => typeof name !== "string" || name.trim().length === 0))
) {
    return invalidArgs("packageNames must be a non-empty array of non-empty strings when provided");
}

const selectedNames = new Set<string>(
    (input.packageNames ?? []).map((name: string) => name.trim())
);
const registry = pluginSystem.findInterface(
    Editor.IPackageRegistry.interfaceId
) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel);
const packages: Array<{ name: string; id: string; version: string; canPullUpdate: boolean }> = [];

for (const asset of model.project.assetManager.assets) {
    if (asset.getTypeName() !== "NativePackageDescriptor") {
        continue;
    }

    const descriptor = asset as Editor.Assets.NativePackageDescriptor;
    if (selectedNames.size > 0 && !selectedNames.has(descriptor.packageName)) {
        continue;
    }

    packages.push({
        name: descriptor.packageName,
        // Stable across updates; a package's name can change when it is updated.
        id: descriptor.componentId ? descriptor.componentId.toString() : "(none)",
        version: descriptor.version
            ? `${descriptor.version.major}.${descriptor.version.minor}.${descriptor.version.patch}`
            : "(none)",
        canPullUpdate: registry.canPullUpdate(descriptor),
    });
}

return packages;
