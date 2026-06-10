<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Resolving `<LS_INSTALL>`

Run this snippet via the `ExecuteEditorCode` MCP tool to get the Lens Studio install path:

```ts
async function getLensStudioInstallPath(): Promise<string | null> {
  // `new Function` indirection is required: static `import "LensStudio:..."` fails TS check, and `import.meta` is unavailable in the ExecuteEditorCode sandbox.
  const dynImport = new Function("u", "return import(u)");
  const mod: any = await dynImport("LensStudio:AssetUtils.js");
  try {
    mod.findAsset(null, null); // forced throw — its stack trace contains the on-disk path
  } catch (e: any) {
    // macOS: ".../Lens Studio.app/Contents/JsPlugins/Builtin/AssetUtils.js" (path may contain parens, e.g. "Lens Studio (1).app" after a duplicate-install rename)
    const macMatch = String(e.stack ?? "").match(/\/[^\n]+?\.app(?=\/Contents\/)/);
    if (macMatch) return macMatch[0];
    // Windows: "<install>\JsPlugins\Builtin\AssetUtils.js" (default 32-bit install is "C:\Program Files (x86)\...", so the path commonly contains parens) — untested; verify on Windows.
    const winMatch = String(e.stack ?? "").match(/([A-Za-z]:[^\n]+?)\\JsPlugins\\/);
    if (winMatch) return winMatch[1];
  }
  return null;
}
return await getLensStudioInstallPath();
```

On macOS the result is the `.app` bundle root (e.g. `/Applications/Lens Studio.app`). On Windows it is the install directory root. Subpaths below assume macOS layout — on Windows, swap `/` for `\` and verify the equivalent location.
