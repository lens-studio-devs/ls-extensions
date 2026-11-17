// Path-backed ExecuteEditorCode action: removes one packed package file from the project's
// Packages root (for example a legacy SpectaclesUIKit.lspkg before installing its 4.0
// replacement). Args: { packageFile: "<Name>.lspkg" }.
function invalidArgs(error: string) {
    return { error: `invalid args: ${error}` };
}

const input = args as any;
if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return invalidArgs("args must be a JSON object");
}
if (
    typeof input.packageFile !== "string" ||
    !/^[^/\\]+\.lspkg$/.test(input.packageFile.trim())
) {
    return invalidArgs("packageFile must be a file name ending in .lspkg, with no directory");
}

const packageFile = input.packageFile.trim();
const model = pluginSystem.findInterface(Editor.Model.IModel);
model.project.assetManager.remove(
    new Editor.Model.SourcePath(new Editor.Path(packageFile), Editor.Model.SourceRootDirectory.Packages)
);

return { removed: packageFile };
