// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · PREFLIGHT (Editor API)
// Run AS-IS via ExecuteEditorCode — zero config. Pass this file's path as `path`; do NOT read it.
//
// Confirms the project is submittable WITHOUT exporting: Lens Studio auth, the open
// project, submission metadata (packageId + lensName), and a production signing key.
// Also returns `localAiModerationInput`, a small advisory input bundle for the
// orchestrating agent's local AI preflight review. The agent may inspect the lens name
// and local Lens icon before the expensive export; the backend queue remains the
// authoritative moderation gate.
// Returns one JSON object the /specs-publish skill branches on.
//
// Result shapes (READY/ACTION_REQUIRED may ALSO carry `localAiModerationInput`,
// advisory agent-only context that must never be treated as approval):
//   { status: "READY", projectPath, packageId, lensName, hasProductionKey: true, localAiModerationInput }
//   { status: "ACTION_REQUIRED", reason, message, issues: [{reason, message}, ...], localAiModerationInput, ... }
//     `reason` + `message` mirror the FIRST issue for back-compat; `issues` lists ALL
//     local-fix items found in a single pass so the agent can prompt for everything at
//     once instead of one-at-a-time. Auth/project-state failures still return immediately.
//   { status: "FAILED", reason, message, stack? }

const FileSystem = await import("LensStudio:FileSystem");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function stripYamlScalarQuotes(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']/, "").replace(/["']$/, "");
}
function readProjectScalar(text: string, key: string): string {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*([^\\r\\n]*)`));
  return stripYamlScalarQuotes(match?.[1]);
}
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function isDefaultLensName(value: string): boolean {
  return value.trim().toLowerCase() === "untitled";
}
function actionRequired(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "ACTION_REQUIRED", stage: "preflight", reason, message, ...extra };
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "preflight", reason, message, ...extra };
}

type LocalAiModerationAsset = {
  assetId: string;
  role: string;
  mediaType: string;
  status: "available" | "skipped";
  iconPath?: string;
  contentType?: string;
  fileName?: string;
  skipReason?: string;
};

type CommerceKitIndicator = {
  sourcePath: string;
  kind: string;
};

type CommerceKitProductIdSource = {
  sourcePath: string;
  sourceKind: string;
  productIds: string[];
  unresolvedExpression?: string;
};

type CommerceKitInvalidProductId = {
  productId: string;
  expectedPrefix: string;
  sourcePath: string;
  sourceKind: string;
};

type CommerceKitPreflightInput = {
  used: boolean;
  indicators: CommerceKitIndicator[];
  productIdSources: CommerceKitProductIdSource[];
  invalidProductIds: CommerceKitInvalidProductId[];
  unresolvedProductIdSources: CommerceKitProductIdSource[];
};

type LocalAiModerationInput = {
  policyVersion: string;
  releaseText: {
    name: string;
    description: string;
    tags: string[];
  };
  packageId: string;
  assets: LocalAiModerationAsset[];
  commerceKit: CommerceKitPreflightInput;
};

type ProjectTextFile = {
  path: Editor.Path;
  text: string;
};

type TextRange = {
  start: number;
  end: number;
};

function imageContentType(imagePath: Editor.Path): string {
  const path = imagePath.toString().toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (path.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function multipartFileName(imagePath: Editor.Path, fallback = "image"): string {
  const fileName = imagePath.fileName.toString().replace(/[\r\n"]/g, "_").trim();
  return fileName || fallback;
}

function localImageAsset(assetId: string, role: string, imagePath: Editor.Path, fallbackFileName: string): LocalAiModerationAsset {
  if (!FileSystem.exists(imagePath) || !FileSystem.isFile(imagePath)) {
    return {
      assetId,
      role,
      mediaType: "image",
      status: "skipped",
      skipReason: "local_image_path_unavailable",
    };
  }

  return {
    assetId,
    role,
    mediaType: "image",
    status: "available",
    iconPath: imagePath.toString(),
    contentType: imageContentType(imagePath),
    fileName: multipartFileName(imagePath, fallbackFileName),
  };
}

function lensIconAssetForLocalAi(project: any): LocalAiModerationAsset {
  if (!project.metaInfo.isIconSet) {
    return {
      assetId: "icon",
      role: "icon",
      mediaType: "image",
      status: "skipped",
      skipReason: "lens_icon_not_set",
    };
  }

  const iconPath = project.metaInfo.iconPath;
  if (!iconPath || !FileSystem.exists(iconPath) || !FileSystem.isFile(iconPath)) {
    return {
      assetId: "icon",
      role: "icon",
      mediaType: "image",
      status: "skipped",
      skipReason: "lens_icon_path_unavailable",
    };
  }

  return {
    assetId: "icon",
    role: "icon",
    mediaType: "image",
    status: "available",
    iconPath: iconPath.toString(),
    contentType: imageContentType(iconPath),
    fileName: multipartFileName(iconPath, "lens-icon"),
  };
}

function isTextAsset(path: Editor.Path): boolean {
  const name = path.fileName.toString().toLowerCase();
  const extension = path.extension.toLowerCase();
  if (name.endsWith(".d.ts") || name.endsWith(".map") || name.endsWith(".meta")) {
    return false;
  }
  return ["ts", "tsx", "js", "jsx", "scene", "prefab", "json", "yaml", "yml"].includes(extension);
}

function isLocalImageReference(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")) {
    return false;
  }
  return /\.(png|jpe?g|webp)(?:[?#].*)?$/.test(lower);
}

function isImageAsset(path: Editor.Path): boolean {
  return ["png", "jpg", "jpeg", "webp"].includes(path.extension.toLowerCase());
}

function stripInlineComment(value: string): string {
  return value.replace(/\s+(#|\/\/).*$/, "").trim();
}

function stripScalarQuotes(value: string): string {
  return stripInlineComment(value).replace(/^["'`]/, "").replace(/["'`]$/, "").trim();
}

function readTextFiles(project: any, relativeDir: string): ProjectTextFile[] {
  const root = project.projectDirectory.appended(new Editor.Path(relativeDir));
  if (!FileSystem.exists(root) || !FileSystem.isDirectory(root)) {
    return [];
  }

  return FileSystem.readDir(root, { recursive: true })
    .map((entry: Editor.Path) => root.appended(entry))
    .filter((path: Editor.Path) => FileSystem.exists(path) && FileSystem.isFile(path) && isTextAsset(path))
    .map((path: Editor.Path) => ({ path, text: FileSystem.readFile(path) }));
}

function isJavaScriptLineTerminator(char: string): boolean {
  return char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029";
}

function previousNonWhitespaceIndex(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(text[i])) {
      return i;
    }
  }
  return -1;
}

function canStartJavaScriptRegexLiteral(text: string, slashIndex: number): boolean {
  const previousIndex = previousNonWhitespaceIndex(text, slashIndex);
  if (previousIndex < 0) {
    return true;
  }

  const previousChar = text[previousIndex];
  if ("([{=,:;!&|?+-*~^<>%".includes(previousChar)) {
    return true;
  }

  const previousText = text.slice(Math.max(0, previousIndex - 16), previousIndex + 1);
  return /\b(?:return|throw|case|delete|void|typeof|yield|await|else|do)$/.test(previousText);
}

function skipJavaScriptRegexLiteral(text: string, slashIndex: number): number {
  if (text[slashIndex] !== "/" || text[slashIndex + 1] === "/" || text[slashIndex + 1] === "*") {
    return slashIndex;
  }
  if (!canStartJavaScriptRegexLiteral(text, slashIndex)) {
    return slashIndex;
  }

  let escaped = false;
  let inCharacterClass = false;
  for (let i = slashIndex + 1; i < text.length; i++) {
    const char = text[i];
    if (isJavaScriptLineTerminator(char)) {
      return slashIndex;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (char === "/" && !inCharacterClass) {
      let end = i;
      while (/[A-Za-z]/.test(text[end + 1] ?? "")) {
        end += 1;
      }
      return end;
    }
  }
  return slashIndex;
}

function javaScriptCommentRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    const regexEndIndex = skipJavaScriptRegexLiteral(text, i);
    if (regexEndIndex > i) {
      i = regexEndIndex;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < text.length && !isJavaScriptLineTerminator(text[i])) {
        i += 1;
      }
      ranges.push({ start, end: i });
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      ranges.push({ start, end: i < text.length - 1 ? i + 2 : text.length });
      if (i < text.length - 1) {
        i += 1;
      }
    }
  }
  return ranges;
}

function isIndexInRanges(index: number, ranges: TextRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function includesOutsideComments(text: string, needle: string, commentRanges: TextRange[]): boolean {
  let index = text.indexOf(needle);
  while (index >= 0) {
    if (!isIndexInRanges(index, commentRanges)) {
      return true;
    }
    index = text.indexOf(needle, index + needle.length);
  }
  return false;
}

function hasMatchOutsideComments(text: string, regex: RegExp, commentRanges: TextRange[]): boolean {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (!isIndexInRanges(match.index, commentRanges)) {
      return true;
    }
  }
  return false;
}

function commerceIndicatorKinds(text: string): string[] {
  const commentRanges = javaScriptCommentRanges(text);
  const kinds: string[] = [];
  if (includesOutsideComments(text, "LensStudio:CommerceKitModule", commentRanges)) {
    kinds.push("commerce_module");
  }
  if (includesOutsideComments(text, "CommerceKit.lspkg", commentRanges) || includesOutsideComments(text, "CommerceKit", commentRanges)) {
    kinds.push("commerce_package");
  }
  if (hasMatchOutsideComments(text, /\bqueryProductDetails\s*\(/g, commentRanges)) {
    kinds.push("query_product_details");
  }
  if (hasMatchOutsideComments(text, /\blaunchPurchaseFlow\s*\(/g, commentRanges)) {
    kinds.push("purchase_flow");
  }
  if (
    hasMatchOutsideComments(text, /\bProductCatalog\b/g, commentRanges) ||
    hasMatchOutsideComments(text, /(?:^|\n)\s*productCatalog:\s*(?:\n|$)/g, commentRanges)
  ) {
    kinds.push("product_catalog");
  }
  return kinds;
}

function matchingCloseIndex(text: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    const regexEndIndex = skipJavaScriptRegexLiteral(text, i);
    if (regexEndIndex > i) {
      i = regexEndIndex;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && !isJavaScriptLineTerminator(text[i])) {
        i += 1;
      }
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      if (i < text.length - 1) {
        i += 1;
      }
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function stringLiterals(text: string): string[] {
  const values: string[] = [];
  const commentRanges = javaScriptCommentRanges(text);
  const literalRe = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = literalRe.exec(text)) !== null) {
    if (isIndexInRanges(match.index, commentRanges)) {
      continue;
    }
    if (match[1] === "`" && match[2].includes("${")) {
      continue;
    }
    values.push(match[2].replace(/\\(["'`\\])/g, "$1"));
  }
  return values;
}

function findAssignedArrayLiteral(text: string, identifier: string, commentRanges: TextRange[]): string | undefined {
  const assignmentRe = new RegExp(`(?:const|let|var)\\s+${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?::[^=]+)?=\\s*\\[`, "gm");
  let match: RegExpExecArray | null;
  while ((match = assignmentRe.exec(text)) !== null) {
    if (isIndexInRanges(match.index, commentRanges)) {
      continue;
    }
    const openIndex = match.index + match[0].lastIndexOf("[");
    const closeIndex = matchingCloseIndex(text, openIndex, "[", "]");
    if (closeIndex < 0) {
      return undefined;
    }
    return text.slice(openIndex, closeIndex + 1);
  }
  return undefined;
}

function productIdsFromObjectArray(arrayLiteral: string): string[] {
  const values: string[] = [];
  const commentRanges = javaScriptCommentRanges(arrayLiteral);
  const productIdRe = /\bproductId\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = productIdRe.exec(arrayLiteral)) !== null) {
    if (isIndexInRanges(match.index, commentRanges)) {
      continue;
    }
    if (match[1] === "`" && match[2].includes("${")) {
      continue;
    }
    values.push(match[2].replace(/\\(["'`\\])/g, "$1"));
  }
  return values;
}

function resolveProductIdsExpression(expression: string, text: string, commentRanges: TextRange[]): { productIds: string[]; unresolvedExpression?: string } {
  const trimmed = expression.trim();
  if (trimmed.startsWith("[")) {
    return { productIds: stringLiterals(trimmed) };
  }

  const identifierMatch = trimmed.match(/^[A-Za-z_$][\w$]*$/);
  if (identifierMatch) {
    const arrayLiteral = findAssignedArrayLiteral(text, trimmed, commentRanges);
    return arrayLiteral ? { productIds: stringLiterals(arrayLiteral) } : { productIds: [], unresolvedExpression: trimmed };
  }

  const mappedProductIds = trimmed.match(/^([A-Za-z_$][\w$]*)\.map\([^=]*=>\s*[^.]+\.productId\s*\)$/);
  if (mappedProductIds) {
    const arrayLiteral = findAssignedArrayLiteral(text, mappedProductIds[1], commentRanges);
    return arrayLiteral ? { productIds: productIdsFromObjectArray(arrayLiteral) } : { productIds: [], unresolvedExpression: trimmed };
  }

  return { productIds: [], unresolvedExpression: trimmed };
}

function queryProductDetailsSources(file: ProjectTextFile): CommerceKitProductIdSource[] {
  const sources: CommerceKitProductIdSource[] = [];
  const commentRanges = javaScriptCommentRanges(file.text);
  const callRe = /\bqueryProductDetails\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(file.text)) !== null) {
    if (isIndexInRanges(match.index, commentRanges)) {
      continue;
    }
    const openIndex = match.index + match[0].lastIndexOf("(");
    const closeIndex = matchingCloseIndex(file.text, openIndex, "(", ")");
    if (closeIndex < 0) {
      sources.push({
        sourcePath: file.path.toString(),
        sourceKind: "queryProductDetails",
        productIds: [],
        unresolvedExpression: "unterminated_call",
      });
      continue;
    }
    const expression = file.text.slice(openIndex + 1, closeIndex);
    if (!expression.trim()) {
      callRe.lastIndex = closeIndex + 1;
      continue;
    }
    const resolved = resolveProductIdsExpression(expression, file.text, commentRanges);
    sources.push({
      sourcePath: file.path.toString(),
      sourceKind: "queryProductDetails",
      productIds: resolved.productIds,
      ...(resolved.unresolvedExpression ? { unresolvedExpression: resolved.unresolvedExpression } : {}),
    });
    callRe.lastIndex = closeIndex + 1;
  }
  return sources;
}

function hasPackagePrefix(productId: string, packageId: string): boolean {
  return Boolean(packageId) && (productId === packageId || productId.startsWith(`${packageId}.`));
}

function resolveLocalAssetPath(project: any, sourcePath: Editor.Path, value: string): Editor.Path {
  const cleanValue = stripScalarQuotes(value);
  if (cleanValue.startsWith("/")) {
    return new Editor.Path(cleanValue);
  }
  if (cleanValue.startsWith("Assets/") || cleanValue.startsWith("Packages/")) {
    return project.projectDirectory.appended(new Editor.Path(cleanValue));
  }
  if (cleanValue.startsWith("./") || cleanValue.startsWith("../")) {
    return sourcePath.parent.appended(new Editor.Path(cleanValue));
  }
  return project.projectDirectory.appended(new Editor.Path(cleanValue));
}

function isCatalogComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("#") || trimmed.startsWith("//");
}

function catalogFieldValue(line: string, fieldName: string): string | undefined {
  const fieldRe = new RegExp(`^\\s*(?:-\\s*)?${fieldName}:\\s*(.*)$`);
  const match = fieldRe.exec(line);
  return match ? stripScalarQuotes(match[1]) : undefined;
}

function productCatalogIconAssets(project: any, file: ProjectTextFile): LocalAiModerationAsset[] {
  const assets: LocalAiModerationAsset[] = [];
  if (!file.text.includes("productCatalog:")) {
    return assets;
  }

  const lines = file.text.split(/\r?\n/);
  let inCatalog = false;
  let catalogIndent = 0;
  let itemIndent: number | undefined;
  let currentProductId = "";
  let currentIconUri = "";

  function flushProductIcon() {
    if (!currentProductId) {
      return;
    }
    if (!currentIconUri) {
      assets.push({
        assetId: `product_catalog:${currentProductId}`,
        role: "product_catalog_icon",
        mediaType: "image",
        status: "skipped",
        skipReason: "product_catalog_icon_uri_empty",
      });
      return;
    }
    if (!isLocalImageReference(currentIconUri)) {
      assets.push({
        assetId: `product_catalog:${currentProductId}`,
        role: "product_catalog_icon",
        mediaType: "image",
        status: "skipped",
        skipReason: "product_catalog_icon_uri_not_local_image",
      });
      return;
    }
    assets.push(
      localImageAsset(
        `product_catalog:${currentProductId}`,
        "product_catalog_icon",
        resolveLocalAssetPath(project, file.path, currentIconUri),
        "product-catalog-icon",
      ),
    );
  }

  for (const line of lines) {
    if (!line.trim() || isCatalogComment(line)) {
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const catalogMatch = line.match(/^(\s*)productCatalog:\s*$/);
    if (catalogMatch) {
      inCatalog = true;
      catalogIndent = catalogMatch[1].length;
      itemIndent = undefined;
      currentProductId = "";
      currentIconUri = "";
      continue;
    }
    if (inCatalog && indent <= catalogIndent) {
      flushProductIcon();
      currentProductId = "";
      currentIconUri = "";
      inCatalog = false;
      itemIndent = undefined;
    }
    if (!inCatalog) {
      continue;
    }

    const itemMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (itemMatch) {
      if (itemIndent !== undefined && indent > itemIndent) {
        continue;
      }
      flushProductIcon();
      itemIndent = itemMatch[1].length;
      currentIconUri = "";
      currentProductId = "";
    }

    const idValue = catalogFieldValue(line, "id");
    if (idValue !== undefined) {
      currentProductId = idValue;
    }
    const iconValue = catalogFieldValue(line, "iconUri");
    if (iconValue !== undefined) {
      currentIconUri = iconValue;
    }
  }
  if (inCatalog) {
    flushProductIcon();
  }

  return assets;
}

function projectImageAssets(project: any): LocalAiModerationAsset[] {
  const root = project.projectDirectory.appended(new Editor.Path("Assets"));
  if (!FileSystem.exists(root) || !FileSystem.isDirectory(root)) {
    return [];
  }

  return FileSystem.readDir(root, { recursive: true })
    .map((entry: Editor.Path) => root.appended(entry))
    .filter((path: Editor.Path) => FileSystem.exists(path) && FileSystem.isFile(path) && isImageAsset(path))
    .map((path: Editor.Path) =>
      localImageAsset(
        `project_asset:${path.relative(project.projectDirectory).toString()}`,
        "project_image_asset",
        path,
        "project-image-asset",
      ),
    );
}

function dedupeAssets(assets: LocalAiModerationAsset[]): LocalAiModerationAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = asset.iconPath ? `path:${asset.iconPath}` : `${asset.role}:${asset.assetId}:${asset.skipReason ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildLocalModerationAssets(project: any, files: ProjectTextFile[]): LocalAiModerationAsset[] {
  return dedupeAssets([
    lensIconAssetForLocalAi(project),
    ...files.flatMap((file) => productCatalogIconAssets(project, file)),
    ...projectImageAssets(project),
  ]);
}

function buildCommerceKitPreflightInput(files: ProjectTextFile[], packageId: string): CommerceKitPreflightInput {
  const commerceFiles = files
    .map((file) => ({ file, kinds: commerceIndicatorKinds(file.text) }))
    .filter((entry) => entry.kinds.length > 0);

  const productIdSources: CommerceKitProductIdSource[] = [];
  for (const entry of commerceFiles) {
    productIdSources.push(...queryProductDetailsSources(entry.file));
  }

  const invalidProductIds: CommerceKitInvalidProductId[] = [];
  for (const source of productIdSources) {
    if (source.sourceKind !== "queryProductDetails") {
      continue;
    }
    for (const productId of source.productIds) {
      if (!hasPackagePrefix(productId, packageId)) {
        invalidProductIds.push({
          productId,
          expectedPrefix: packageId,
          sourcePath: source.sourcePath,
          sourceKind: source.sourceKind,
        });
      }
    }
  }

  return {
    used: commerceFiles.length > 0,
    indicators: commerceFiles.flatMap((entry) => entry.kinds.map((kind) => ({ sourcePath: entry.file.path.toString(), kind }))),
    productIdSources,
    invalidProductIds,
    unresolvedProductIdSources: productIdSources.filter((source) => Boolean(source.unresolvedExpression)),
  };
}

// Agent-only, advisory local AI moderation input. This does NOT call a backend and does
// not decide approval; it only gives the orchestrating agent the local evidence it can
// inspect before export.
function buildLocalAiModerationInput(name: string, packageId: string, project: any): LocalAiModerationInput {
  const projectTextFiles = readTextFiles(project, "Assets");
  return {
    policyVersion: "generic-ai-review-2026-04-07",
    releaseText: { name, description: "", tags: [] },
    packageId,
    assets: buildLocalModerationAssets(project, projectTextFiles),
    commerceKit: buildCommerceKitPreflightInput(projectTextFiles, packageId),
  };
}

try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) {
    return actionRequired("no_auth_interface", "Lens Studio authorization is unavailable. Sign in to Lens Studio, then retry.");
  }
  if (!auth.isAuthorized) {
    return actionRequired("not_signed_in", "Sign in to Lens Studio from the profile menu, then retry.");
  }

  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const projectText = FileSystem.readFile(project.projectFile);
  const packageId = oneLine(readProjectScalar(projectText, "packageId"));
  const lensName = oneLine(stripYamlScalarQuotes(project.metaInfo.lensName) || readProjectScalar(projectText, "lensName"));

  // Collect ALL local-fix issues in one pass so the agent can prompt for everything at
  // once. Auth/project-state issues above still bail early because nothing else can run.
  const issues: { reason: string; message: string }[] = [];

  // The caller compares projectPath against the .esproj resolved in Discover; a mismatch
  // means the wrong project is open (ask the user to open the right one).
  const missingPackageId = !packageId;
  const missingLensName = !lensName || isDefaultLensName(lensName);
  if (missingPackageId || missingLensName) {
    const message =
      missingPackageId && missingLensName
        ? "The project needs a package ID and a non-default Lens name before it can be submitted."
        : missingPackageId
          ? "The project needs a package ID before it can be submitted."
          : "The project needs a non-default Lens name before it can be submitted.";
    issues.push({
      reason: "missing_submission_metadata",
      message,
    });
  }

  const signingKey = project.metaInfo.spkProductionKeyPath;
  if (!signingKey || signingKey.isEmpty || !FileSystem.exists(signingKey)) {
    issues.push({
      reason: "no_prod_signing_key",
      message: "This project needs a production signing key before export. Generate or add one (reusing an existing key is fine) in Project Settings > SPECS Settings.",
    });
  }

  // isIconSet is false when the project still has the default placeholder icon
  // (Qt resource path under :/Model/Icons/metainfo/...). Submission requires a real icon.
  if (!project.metaInfo.isIconSet) {
    issues.push({
      reason: "no_lens_icon",
      message: "This project needs a Lens icon before it can be submitted. The publish flow will generate and assign one automatically.",
    });
  }

  const localAiModerationInput = buildLocalAiModerationInput(lensName, packageId, project);

  if (issues.length > 0) {
    // `reason` + `message` mirror the first issue for back-compat with single-reason
    // branching; `issues` lists everything so the agent can present them together.
    return {
      status: "ACTION_REQUIRED",
      stage: "preflight",
      reason: issues[0].reason,
      message: issues[0].message,
      issues,
      localAiModerationInput,
      projectPath,
      packageId,
      lensName,
    };
  }

  return {
    status: "READY",
    stage: "preflight",
    projectPath,
    packageId,
    lensName,
    hasProductionKey: true,
    localAiModerationInput,
  };
} catch (error) {
  return failed("exception", errorToString(error), { stack: error instanceof Error ? error.stack : undefined });
}
