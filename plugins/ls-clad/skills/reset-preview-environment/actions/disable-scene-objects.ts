const input = args as any;
if (!Array.isArray(input.objectNames) || !input.objectNames.every((name: unknown) => typeof name === "string" && name.trim().length > 0)) {
  return { ok: false, reason: "invalid_args", error: "objectNames must be an array of non-empty strings" };
}

try {
  const model = pluginSystem.findInterface(Editor.Model.IModel);
  const scene = model.project.scene;
  const disabled: string[] = [];
  for (const name of input.objectNames.map((value: string) => value.trim())) {
    const object = scene.sceneObjects.find((candidate) => candidate.name === name);
    if (object) {
      object.enabled = false;
      disabled.push(name);
    }
  }
  return { ok: true, disabled };
} catch (error) {
  const caught = error as { message?: unknown; stack?: unknown };
  return {
    ok: false,
    error: typeof caught?.message === "string" ? caught.message : String(error),
    stack: typeof caught?.stack === "string" ? caught.stack : "",
  };
}
