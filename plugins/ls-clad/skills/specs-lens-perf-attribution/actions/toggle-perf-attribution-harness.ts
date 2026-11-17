function invalidArgs(error: string) {
  return { status: "FAILED", reason: "invalid_args", error, retryable: false };
}

const errorMessage = (error: unknown): string => {
  const caught = error as { message?: unknown };
  return typeof caught?.message === "string" ? caught.message : String(error);
};

const input = args as any;
if (
  typeof input.harnessIdentifier !== "string" ||
  input.harnessIdentifier.trim().length === 0
) {
  return invalidArgs("harnessIdentifier must be a non-empty string");
}
if (typeof input.enabled !== "boolean") {
  return invalidArgs("enabled must be a boolean");
}

try {
  const harnessIdentifier = input.harnessIdentifier.trim();
  const model = pluginSystem.findInterface(Editor.Model.IModel);
  const scriptComponents: any[] = (model.project.scene as any).findComponents(
    Editor.Components.ScriptComponent.getTypeName()
  ) ?? [];

  for (const candidate of scriptComponents) {
    const script = candidate.scriptAsset;
    const identifiers = [
      script?.name,
      script?.fileMeta?.sourcePath?.toString?.(),
      script?.cacheFile?.toString?.(),
    ].filter((value) => typeof value === "string");
    if (!identifiers.some((value) => value === harnessIdentifier)) {
      continue;
    }

    candidate.enabledForProfiling = input.enabled;
    return {
      status: "OK",
      harnessIdentifier,
      enabled: input.enabled,
      sceneObject: candidate.sceneObject?.name,
    };
  }

  return {
    status: "FAILED",
    reason: "harness_not_found",
    error: `No ScriptComponent matched harnessIdentifier ${JSON.stringify(harnessIdentifier)}`,
    retryable: false,
  };
} catch (error) {
  return {
    status: "FAILED",
    reason: "execution_failed",
    error: errorMessage(error),
    retryable: false,
  };
}
