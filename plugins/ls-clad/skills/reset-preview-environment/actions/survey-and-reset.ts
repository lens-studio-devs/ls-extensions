const input = args as any;
if (!Array.isArray(input.cameraNames) || input.cameraNames.length === 0 || !input.cameraNames.every((name: unknown) => typeof name === "string" && name.trim().length > 0)) {
  return { ok: false, reason: "invalid_args", error: "cameraNames must be a non-empty array of non-empty strings" };
}

try {
  const model = pluginSystem.findInterface(Editor.Model.IModel);
  const scene = model.project.scene;
  const cameraNames = input.cameraNames.map((name: string) => name.trim());
  const results: string[] = [];
  const camera = scene.sceneObjects.find((object) => cameraNames.includes(object.name));
  if (camera) {
    camera.localTransform.position = new vec3(0, 0, 0);
    camera.localTransform.rotation = new vec3(0, 0, 0);
    results.push(`Reset camera: ${camera.name}`);
  } else {
    results.push(`Warning: No camera found matching ${cameraNames.join(", ")}`);
  }
  const rootObjects = scene.rootSceneObjects.map((object) => ({
    name: object.name,
    id: object.id.toString(),
    enabled: object.enabled,
  }));
  return { ok: true, camera: results, rootObjects };
} catch (error) {
  const caught = error as { message?: unknown; stack?: unknown };
  return {
    ok: false,
    error: typeof caught?.message === "string" ? caught.message : String(error),
    stack: typeof caught?.stack === "string" ? caught.stack : "",
  };
}
