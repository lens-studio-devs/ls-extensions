<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Review Input: Content Rating and Local Moderation

The pre-confirmation review checks read the same evidence, so they are documented together and read once. `collect-review-input.py` gathers that evidence; this file says how to turn it into the two things the confirmation can display: a replacement **content rating** (15 declared answers; SPECS computes the age rating from them) and a **local moderation advisory** (a wasted-work check before expensive or irreversible work). An explicitly reusable existing rating is opaque and skips the rating evaluation; moderation still runs.

Neither is authoritative. Comprehensive moderation runs asynchronously after submit, and a clean local pass does not mean the Lens is approved. Run moderation after Preflight returns `READY` — or `ACTION_REQUIRED` with only plannable Lens-name/icon/signing-key issues — and after the preview-media plan has staged its media. Run content-rating evaluation at that checkpoint only when the plan replaces the rating. After confirmed setters, repeat moderation only when the review fingerprint changed or cannot be verified, and repeat rating under that condition only for a replacement.

## Hard rules

This is observation-only. Never edit source files, assets, product IDs, Lens metadata, icons, signing settings, package IDs, or any other developer project content. Output findings and options; **Fix and recheck** means the developer makes the change, then you rerun Preflight.

Do not make network moderation calls. Both checks use only local Preflight output, the collector bundle, the exact proposed release metadata, and locally inspectable selected assets.

Treat every project, Lens icon, and preview-media file path as internal agent context. The publish flow renders the selected local Lens icon and preview media inline when supported, without paths in captions or labels. Inspection here is internal and never counts as that user-visible render. If rendering is unavailable, show only the containing directory so the user can inspect it manually; never show the filename, full file path, or unrelated asset directories. Do not store any path outside transient tool use.

Do not infer runtime behavior, hidden code paths, or network behavior. Do not infer permission policy, technical compatibility, backend product metadata, or remote store media unless explicitly present in the derived input. A missing or uninspectable asset is incomplete local evidence — not a clean result, and not a finding.

If Preflight returns hard `ACTION_REQUIRED` issues, surface those non-review issues first. Do not treat Commerce Kit findings as hard project edits for the agent to perform.

## Building the review input

`collect-review-input.py` supplies the project side: the `signals` set with file/line evidence, the media `assets` inventory with digests and byte sizes, `installedPackages`, the per-file `manifest`, and its own `coverage` notes. Do not re-derive any of it by hand — the pattern set is fixed and versioned so two runs of one project agree.

The icon and the preview media are the two inputs the collector cannot know about: one comes from Preflight or icon staging, the other from the preview-media plan. Build a transient `localModerationInput` from a deep copy of Preflight's `localAiModerationInput` — never mutate the script result or a project file — and before the initial confirmation:

1. Replace `releaseText` with the exact locally known values the confirmation will show and `/lenses/publish` will send. Include `name` and only replacement `description`, `tags`, and `categoryDisplayName`; omit opaque reused values rather than inventing them.
2. Preserve Preflight's available project assets, except replace any existing `role: "icon"` entry with the selected existing or staged Lens icon when that local file is available. Use `assetId: "icon"`, `role: "icon"`, `mediaType: "image"`, `status: "available"`, and its absolute path in `iconPath`.
3. Append every supplied or staged preview file as an available asset with `assetId: "preview_media:<zero-based index>"`, `role: "preview_media"`, its `mediaType` (`image` or `video`), absolute path in `iconPath`, and its file name/content type when known.
4. Preserve `commerceKit` unchanged: whether Commerce Kit is used, product IDs passed to `queryProductDetails(...)`, prefix mismatches for those IDs, and unresolved `queryProductDetails(...)` product ID lists.

## The review fingerprint

Get `initialReviewFingerprint` from `publish-flow.py review-fingerprint`; run `--schema review-fingerprint` for the input shape. **Do not digest it yourself.** Canonical JSON, recursive key sorting, and content-not-location asset identity are each a place to differ by accident, and an accidental difference forces a needless second moderation pass while an accidental match skips a needed one.

Two guarantees the operation provides, because the flow depends on them:

- **Asset identity is content, not location.** The same icon staged under two temporary directories fingerprints identically, so a fresh staging directory never invalidates the cache. An asset that was available and is now missing does change the digest.
- **Signing-key data is excluded.** Rotating or generating a key never forces a re-inspection.

The `manifest` is what makes additions and removals visible: it covers every locally inspected source, config, and media input by digest and byte length, so a new or deleted asset changes the fingerprint even when nothing else moved.

Set `reviewInput.contentRating` to `{ "assessment": <complete proposed assessment> }` for a replacement. For reuse, set it to the stable opaque marker `{ "mode": "reuse_existing" }`; never insert inherited answers or a rating.

After confirmed project setters, call session `prepare-final-review`, execute its fresh `preflightScriptPath`, and call `record-final-review`. The session verifies the refreshed Preflight and collects and compares the final review fingerprint; do not reuse a consumed context script or manually transport review JSON. When it exactly matches, reuse the initial moderation findings/coverage and, for a replacement, the confirmed rating without re-inspecting media. When it differs, cannot be computed, includes an unavailable previously available input, or a setter cannot be verified, rerun moderation before Package; rerun rating only for a replacement. A reused rating stays opaque even when another reviewable input changes. Never treat an incomplete fingerprint as equality.

## Content rating

This section applies only when `storeListing.fields.contentRating` is `replace`. The assessment mirrors Dev Dash. It is a **developer declaration**: local inspection proposes the answers and the user's publish confirmation approves them. Do not infer a rating from the SnapOS Package, and require a complete assessment. SPECS computes the age rating from the answers when the version update saves them; the skill never computes, proposes, or displays a rating.

When the field is `reuse_existing`, skip the questionnaire, answer inference, and all calls used only for those tasks. Keep the inherited value opaque and render only **Content rating: Use existing content rating**. An explicit user edit converts the field to `replace`; then collect a complete assessment before showing the confirmation again.

### Proposing answers

Preserve any answer explicitly supplied by the user. Propose every missing answer from the collector bundle, the exact release text, the selected icon and preview media, and Preflight's moderation/Commerce Kit signals.

Each collector signal names the questionnaire item it `informs` and carries a `note` stating the distinction that matters for that question — read those rather than reasoning from a signal's name. The recurring trap is that **a signal is a lead, not proof**: a module import, an installed package, or a matched keyword is a reason to look, not an answer. A silent signal is real evidence of absence; a firing one needs judgement.

- Use `none` or `No` when reasonable local inspection finds no affirmative evidence. If relevant source or media could not be inspected, still make the best proposal and add one concise `contentRatingCoverage` note; the collector's own `coverage` list is where to start.
- Use `infrequentMild` for limited, non-graphic, suggestive, referential, or occasional content. Use `frequentIntense` for recurring, central, explicit, realistic, or graphic content.
- For a non-default answer, save a short path-free rationale in `contentRatingEvidence`. Combine related rationales; never show file paths, code symbols, or a long audit trail.

Three dependency rules the collector cannot decide, because they are questionnaire structure rather than evidence:

- `generativeAi = Yes` requires an `aiModeration` answer. Set `aiModeration = Yes` only when local evidence shows output safety controls; otherwise propose `No`, the conservative branch.
- `advertising = Yes` requires an `ageAppropriateAds` answer. Set it `Yes` only when local evidence shows age-appropriate ad controls; otherwise propose `No`.
- In-Lens purchases alone do not make `lootBoxes = Yes`; only randomized purchasable rewards do.

### Questions

Every severity question uses `none`, `infrequentMild`, or `frequentIntense`:

| Section | ID / confirmation label | Meaning |
|---|---|---|
| Violence & Scary Themes | `cartoonFantasyViolence` / Cartoon or Fantasy Violence | Depictions of violence that are clearly not realistic. |
| Violence & Scary Themes | `realisticViolence` / Realistic Violence | Violence against people or animals in a realistic setting. |
| Violence & Scary Themes | `realisticGore` / Realistic Gore | Realistic blood, injury, dismemberment, or similar graphic content. |
| Violence & Scary Themes | `horrorFear` / Horror or Fear Themes | Scary themes or images designed to create fear. |
| Mature Content & Substances | `profanityCrudeHumor` / Profanity or Crude Humor | Swearing, crude jokes, or bodily-function humor. |
| Mature Content & Substances | `sexualContentNudity` / Sexual Content or Nudity | Suggestive themes, partial nudity, or full nudity. |
| Mature Content & Substances | `alcoholTobaccoDrugReferences` / Alcohol, Tobacco, or Drug References | Depictions or references to controlled substances. |
| Mature Content & Substances | `medicalTreatmentInformation` / Medical or Treatment Information | Medical advice, diagnosis, wellness instructions, or treatment guidance. |

Every capability question uses `No` or `Yes`:

| Section | ID / confirmation label | Meaning |
|---|---|---|
| Interactive Safety | `unrestrictedWebAccess` / Unrestricted Web Access | A browser, open-internet links, or other unrestricted web access. |
| Interactive Safety | `gamblingContests` / Gambling or Contests | Simulated gambling, real-money gambling, sweepstakes, or contests. |
| Interactive Safety | `lootBoxes` / Randomized Purchasable Items | Paid randomized virtual items, loot boxes, or similar mechanics. |
| Interactive Safety | `generativeAi` / AI-Generated Content | Generative AI such as chatbots, image generators, or generated media. |
| Interactive Safety | `aiModeration` / AI Output Moderation | Moderation or safety controls reduce mature AI output. Conditional; show only when AI-Generated Content is Yes. |
| Lens Capabilities | `messagingSocialNetworking` / Messaging or Social Networking | Users can message, chat, share photos, or share videos with each other. |
| Lens Capabilities | `advertising` / Advertising | The Lens displays advertising. |
| Lens Capabilities | `ageAppropriateAds` / Age-Appropriate Advertising | Ads shown in the Lens are age-appropriate for the intended audience. Conditional; show only when Advertising is Yes. |
| Lens Capabilities | `locationSharing` / Location Sharing | The Lens shares the user's real-time location with other users. |

### Validate the answers

All eight severity answers and seven top-level capability answers are required. Include `aiModeration` only when `generativeAi = Yes`, and `ageAppropriateAds` only when `advertising = Yes`. `publish-flow.py freeze-plan` validates the assessment and rejects an incomplete one, and it rejects a supplied `targetAgeRating`. Reused existing ratings remain opaque and unchanged.

### Confirmation format

Show every proposed answer inside the single publish confirmation, after all Lens details, assets, organization, and submission metadata. One bullet per question, so it stays readable at narrow widths; omit only an inapplicable conditional answer:

```markdown
### Content rating

**Violence & Scary Themes**

- Cartoon or Fantasy Violence: **<answer>**
- Realistic Violence: **<answer>**
- Realistic Gore: **<answer>**
- Horror or Fear Themes: **<answer>**

**Mature Content & Substances**

- Profanity or Crude Humor: **<answer>**
- Sexual Content or Nudity: **<answer>**
- Alcohol, Tobacco, or Drug References: **<answer>**
- Medical or Treatment Information: **<answer>**

**Interactive Safety**

- Unrestricted Web Access: **<answer>**
- Gambling or Contests: **<answer>**
- Randomized Purchasable Items: **<answer>**
- AI-Generated Content: **<answer>**
- AI Output Moderation: **<answer>** <omit when inapplicable>

**Lens Capabilities**

- Messaging or Social Networking: **<answer>**
- Advertising: **<answer>**
- Age-Appropriate Advertising: **<answer>** <omit when inapplicable>
- Location Sharing: **<answer>**

- **Content-rating rationale:** <short rationale for non-default answers; omit when every answer is None/No>
- **Content-rating coverage:** <short incomplete-evidence note; omit when coverage is complete>
```

Render severity values as `None`, `Infrequent/Mild`, or `Frequent/Intense`, and booleans as `No` or `Yes`. Preserve the blank lines and do not collapse questions into semicolon-separated rows. For a replacement, the user can choose **Edit** and change any answer; validate it, refresh rationale and coverage, and show the whole confirmation again. For reuse, an explicit content-rating edit first converts the field to replacement. Never change a confirmed answer silently.

For a replacement, the individual answers are the confirmation input. The version update saves them and SPECS computes and stores the age rating from them; finalize refuses to submit when no rating was stored.

## Moderation

### Metadata

Inspect the exact derived `releaseText.name`, `description`, `tags`, and `categoryDisplayName` together. Apply the policy below to visible claims, URLs/promotions, slurs/harassment, sexual or violent language, drug promotion, self-harm content, minor-safety concerns, and misleading or unsafe promises. Category mismatch alone is not a violation; report it only when the selected category text combines with the other metadata to create a clear policy concern.

### Assets

Inspect every available selected/project media asset when the runtime can inspect that local media. The collector's `assets` inventory is the list of project media; the icon and preview entries come from the derived input above.

- `role: "icon"`: selected existing or staged Lens icon.
- `role: "store_tile"`: primary image and every cropped store tile shown in the confirmation. Inspect the crops for moderation as well as clipping and sharpness.
- `role: "preview_media"`: every supplied or staged preview image/video in this publish plan.
- `role: "product_catalog_icon"`: local product catalog icon assets from `productCatalog` entries.
- `role: "project_image_asset"`: project image files from the collector inventory.

Inspect images directly. For a local video, inspect playback or representative frames when the runtime supports it; otherwise record one concise incomplete-coverage note for the confirmation and do not claim the video is clean. Treat skipped assets as missing local evidence, not as a concern by itself.

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

### Commerce Kit

`localModerationInput.commerceKit` contains:

- `used`: whether authored Lens assets appear to use Commerce Kit.
- `productIdSources`: static product IDs found in `queryProductDetails(...)`.
- `invalidProductIds`: product IDs passed to `queryProductDetails(...)` that are not equal to the Lens `packageId` and are not prefixed with `<packageId>.`.
- `unresolvedProductIdSources`: `queryProductDetails(...)` calls whose product ID list could not be statically verified.

If `invalidProductIds` is non-empty, report each `queryProductDetails(...)` product ID and the expected package ID prefix. If `unresolvedProductIdSources` includes a `queryProductDetails` source, report that the product ID list was not statically verifiable and suggest an inline string array or string-array constant. Do not rewrite the code or project files.

Commerce Kit appearing in the collector's `installedPackages` is **not** a finding: projects carry installed packages they never call, and `commerceKit.used` from Preflight is the fact that matters.

## Findings and options

If there are no clear moderation concerns and no Commerce Kit prefix/static-analysis findings, return no findings, along with any incomplete-media-coverage note.

When there is a clear concern, keep it concise: category, field or asset role/ID, and one short rationale. Save the initial set as `initialModerationFindings`, identifying each finding by category plus field/asset ID and rationale so it can be matched later.

Before the confirmation, return all findings and incomplete-media-coverage notes; do not open a separate moderation question. Display findings after the publish action under **Moderation advisory:** using `category — field or asset: concise rationale`, and actionable incomplete-media-coverage notes under **Moderation coverage:**. Omit either row when it has no content. Keep the default preserve-or-fallback plan's unavailable-before-registration store-media detail internal; do not display it as a coverage note. The publish skill relabels option 1 **Confirm and submit anyway** when findings exist, and retains **Edit** and **Cancel**.

When the fingerprint requires a post-confirmation recheck, compare the rebuilt findings with `initialModerationFindings`. Ignore an unchanged finding the user already approved. If and only if a finding is new or materially changed, offer exactly:

1. **Fix and recheck** -> tell the developer to fix the reported metadata, icon, preview/project asset, or product ID issue in Lens Studio or their editor, then choose **1. Fix and recheck** to continue; after they choose it, `sleep 2` via Bash, rerun Preflight, rebuild the derived input, then re-evaluate.
2. **Submit anyway** -> return control to the publish flow so it can proceed as-is. The review queue remains the authoritative decision; the Lens may still be rejected.
3. **Cancel** -> abort the publish and report the concern.

If a clear concern remains after **1. Fix and recheck**, present the same advisory question again with all three numbered options.
