function invalidArgs(error: string) {
    return { error: `invalid args: ${error}` };
}

const input = args as any;
if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return invalidArgs("args must be a JSON object");
}

const hasPackageNames = input.packageNames !== undefined;
if (
    hasPackageNames &&
    (!Array.isArray(input.packageNames) ||
        input.packageNames.length === 0 ||
        input.packageNames.some((name: unknown) => typeof name !== "string" || name.trim().length === 0))
) {
    return invalidArgs("packageNames must be a non-empty array of non-empty strings when provided");
}
if (input.updateAll !== undefined && typeof input.updateAll !== "boolean") {
    return invalidArgs("updateAll must be a boolean when provided");
}
if ((hasPackageNames && input.updateAll === true) || (!hasPackageNames && input.updateAll !== true)) {
    return invalidArgs("provide packageNames or set updateAll to true, but not both");
}

const selectedNames = new Set<string>(
    (input.packageNames ?? []).map((name: string) => name.trim())
);
const registry = pluginSystem.findInterface(
    Editor.IPackageRegistry.interfaceId
) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel);

// Snapshot live descriptors before pullUpdate mutates the project's asset collection.
const descriptors: Editor.Assets.NativePackageDescriptor[] = [];
for (const asset of model.project.assetManager.assets) {
    if (asset.getTypeName() === "NativePackageDescriptor") {
        descriptors.push(asset as Editor.Assets.NativePackageDescriptor);
    }
}

// Pre-4.0 Specs package names (see specs-package-renames). Pulling an update on one of these
// swaps in the renamed 4.0 package under the legacy file name and crashes Lens Studio, so the
// action never updates them; moving to 4.0 is the manual migration in specs-package-renames.
const LEGACY_SPECS_PACKAGES = [
    "spectaclesinteractionkit",
    "spectaclesuikit",
    "spectaclessynckit",
    "spectaclesinteractionkitexamples",
    "spectacles3dhandhints",
    "specs3dhandhints",
    "spectaclesnavigationkit",
    "specsnavigationkit",
    "spectaclesshaderlibrary",
    "specsshaderlibrary",
];
const packageKey = (name: string): string =>
    String(name || "")
        .toLowerCase()
        .replace(/\.lspkg$/, "")
        .replace(/\s+\d+$/, "")
        .replace(/[^a-z0-9]/g, "");

const updated: string[] = [];
const unavailable: string[] = [];
const blockedLegacy: string[] = [];
for (const descriptor of descriptors) {
    if (input.updateAll !== true && !selectedNames.has(descriptor.packageName)) {
        continue;
    }
    if (LEGACY_SPECS_PACKAGES.indexOf(packageKey(descriptor.packageName)) >= 0) {
        blockedLegacy.push(descriptor.packageName);
        continue;
    }
    if (!registry.canPullUpdate(descriptor)) {
        unavailable.push(descriptor.packageName);
        continue;
    }

    // Returns before Lens Studio finishes applying an Asset Library update; the caller re-lists.
    registry.pullUpdate(descriptor);
    updated.push(descriptor.packageName);
}

return { updated, unavailable, blockedLegacy };
