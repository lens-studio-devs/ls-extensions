<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Local Moderation Preflight

Run this advisory checkpoint before the consolidated confirmation, after `scripts/preflight.ts` returns `READY` or returns `ACTION_REQUIRED` with `localAiModerationInput` and only plannable missing Lens-name/icon/signing-key issues. Prepare the proposed metadata and stage the selected icon/preview media first. Run the checkpoint again after confirmed setters and before Package.

This is a wasted-work check before expensive or irreversible publish work. It is not the authoritative moderation gate: comprehensive moderation still runs asynchronously after submit, and a clean local moderation preflight does not mean the Lens is approved.

## Hard Rules

This checkpoint is observation-only. Never edit source files, assets, product IDs, Lens metadata, icons, signing settings, package IDs, or any other developer project content. Output findings and options; **Fix and recheck** means the developer makes the change, then you rerun Preflight.

Do not make network moderation calls. This checkpoint uses only local Preflight output, the exact proposed release metadata, and locally inspectable selected assets.

Treat every project, Lens icon, and preview-media file path as internal agent context. The publish flow renders the selected local Lens icon and preview media inline when supported, without paths in captions or labels. Moderation inspection is internal and never counts as that user-visible render. If rendering is unavailable, show only the selected icon/preview asset's containing directory so the user can inspect it manually; never show the filename, full file path, or unrelated moderation asset directories. Do not store any path outside transient tool use.

## Inputs

Build a transient `localModerationInput` from a deep copy of the `localAiModerationInput` returned by `preflight.ts`; never mutate the script result or a project file. Before the initial confirmation:

1. Replace `releaseText` with the exact proposed `name`, `description`, `tags`, and `categoryDisplayName` that the confirmation will show and `/lenses/publish` will use.
2. Preserve Preflight's available project assets, except replace any existing `role: "icon"` entry with the selected existing or staged Lens icon when that local file is available. Use `assetId: "icon"`, `role: "icon"`, `mediaType: "image"`, `status: "available"`, and its absolute path in `iconPath`.
3. Append every supplied or staged preview file as an available asset with `assetId: "preview_media:<zero-based index>"`, `role: "preview_media"`, its `mediaType` (`image` or `video`), absolute path in `iconPath`, and its file name/content type when known.
4. Preserve `commerceKit` unchanged: whether Commerce Kit is used, product IDs passed to `queryProductDetails(...)`, prefix mismatches for those IDs, and unresolved `queryProductDetails(...)` product ID lists.

After confirmed project setters, rerun Preflight and rebuild this same derived input from the new result plus the unchanged final metadata and confirmed preview files. This rebuilt input is the post-confirmation delta check.

If Preflight returns hard `ACTION_REQUIRED` issues, surface those non-moderation issues first. Do not treat Commerce Kit findings as hard project edits for the agent to perform.

Do not infer runtime behavior, hidden code paths, or network behavior. Do not infer permission policy, technical compatibility, backend product metadata, or remote store media unless explicitly present in the derived input. A missing or uninspectable asset is incomplete local evidence, not a clean result or a moderation finding.

## Metadata Moderation

Inspect the exact derived `releaseText.name`, `description`, `tags`, and `categoryDisplayName` together. Apply the policy below to visible claims, URLs/promotions, slurs/harassment, sexual or violent language, drug promotion, self-harm content, minor-safety concerns, and misleading or unsafe promises. Category mismatch alone is not a moderation violation; report it only when the selected category text combines with the other metadata to create a clear policy concern.

## Asset Moderation

Inspect every available selected/project media asset when the runtime can inspect that local media:

- `role: "icon"`: selected existing or staged Lens icon.
- `role: "preview_media"`: every supplied or staged preview image/video selected for this publish plan.
- `role: "product_catalog_icon"`: local product catalog icon assets from `productCatalog` entries.
- `role: "project_image_asset"`: local image files under the project's `Assets/` directory.

Inspect images directly. For a local video, inspect playback or representative frames when the runtime supports it; otherwise record one concise incomplete-coverage note for the consolidated confirmation and do not claim the video is clean. Treat skipped assets as missing local evidence, not as a moderation concern by itself.

Apply this generic moderation policy, copied from the Specs AI review policy:

| Category | Description |
|----------|-------------|
| `adult_sexual` | Sexual, explicit, or nudity-related visible content. |
| `graphic_violence` | Graphic injury, gore, or violent imagery. |
| `hate_symbols_or_harassment` | Hate symbols, slurs, or abusive visible text or imagery. |
| `drugs_or_illicit_substances` | Drug paraphernalia, illicit substances, or promotion of use. |
| `self_harm` | Self-harm, suicide, or encouragement of self-injury. |
| `minor_safety` | Sexualized minors, unsafe situations involving minors, or grooming concerns. |
| `unsafe_or_deceptive_claims` | Misleading user-facing claims, scams, or unsafe promises visible in metadata. |
| `external_ads_or_promotions` | Visible URLs, ad-feed links, or promotions for third-party products, services, or creators in release text or attached media. |
| `other` | Visible safety concerns that do not fit another category. |

Severity guidance:

- `low`: Minor concern or weak signal; usually still suitable for human confirmation.
- `medium`: Meaningful concern that should typically route to human review.
- `high`: Clear serious concern that should never auto-approve.

## Commerce Kit Checks

`localModerationInput.commerceKit` contains:

- `used`: whether authored Lens assets appear to use Commerce Kit.
- `productIdSources`: static product IDs found in `queryProductDetails(...)`.
- `invalidProductIds`: product IDs passed to `queryProductDetails(...)` that are not equal to the Lens `packageId` and are not prefixed with `<packageId>.`.
- `unresolvedProductIdSources`: `queryProductDetails(...)` calls whose product ID list could not be statically verified.

If `invalidProductIds` is non-empty, report each `queryProductDetails(...)` product ID and the expected package ID prefix. If `unresolvedProductIdSources` includes a `queryProductDetails` source, report that the product ID list was not statically verifiable and suggest an inline string array or string-array constant. Do not rewrite the code or project files.

## Findings And Options

If there are no clear local moderation concerns and no Commerce Kit prefix/static-analysis findings, return no findings to `specs-publish` along with any incomplete-media-coverage note.

When local moderation finds a clear concern, keep it concise: category, field or asset role/ID, and one short rationale. Save the initial set as `initialModerationFindings`, using category plus field/asset ID and rationale to identify the same finding later.

Before the consolidated confirmation, return all findings and incomplete-media-coverage notes to `specs-publish`; do not open a separate moderation question. Display findings after the publish action under **Moderation advisory:** using `category — field or asset: concise rationale`, and display actionable incomplete-media-coverage notes under **Moderation coverage:**. Omit either row when it has no content. Keep the default preserve-or-fallback plan's unavailable-before-registration store-media detail internal; do not display it as a coverage note. The publish skill relabels option 1 **Confirm and submit anyway** when findings exist and retains **Edit** and **Cancel**.

For the post-confirmation delta check, compare the rebuilt findings with `initialModerationFindings`. Ignore an unchanged finding that the user already approved. If and only if a finding is new or materially changed, offer exactly:

1. **Fix and recheck** -> tell the developer to fix the reported metadata, icon, preview/project asset, or product ID issue in Lens Studio or their editor, then choose **1. Fix and recheck** to continue; after they choose it, `sleep 2` via Bash, rerun Preflight, rebuild the derived input, then re-evaluate.
2. **Submit anyway** -> return control to `specs-publish` so it can proceed to Package as-is. The queue remains the authoritative decision; the Lens may still be rejected during review.
3. **Cancel** -> abort the publish and report the local moderation concern.

If a clear concern remains after **1. Fix and recheck**, present the same advisory question again with all three numbered options.
