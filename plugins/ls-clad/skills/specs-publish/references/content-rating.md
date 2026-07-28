<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Content Rating Assessment

## Contents

- Evidence and proposal rules
- Questions and rating candidates
- Compute the age rating
- Confirmation format
- Persist only the confirmed rating

Use this reference while preparing the single publish confirmation and again before persisting the confirmed rating. The assessment mirrors Dev Dash. It is a developer declaration: local inspection proposes the answers, and the user's final publish confirmation approves them. Do not infer a rating directly from the SnapOS Package and do not silently default the persisted rating to `4+`.

## Evidence and proposal rules

Preserve any answer explicitly supplied by the user. Propose every missing answer from the exact release text, selected icon and preview media, locally inspectable project assets, scripts/configuration/packages, and Preflight moderation/Commerce Kit signals.

- Inspect actual behavior and content, not identifiers alone. A module import is a lead, not proof that a user-facing capability is enabled.
- Use `none` or `No` when reasonable local inspection finds no affirmative evidence. If relevant source or media cannot be inspected, still make the best proposal but add one concise `contentRatingCoverage` note so the user knows which proposed answers need special attention.
- Use `infrequentMild` for limited, non-graphic, suggestive, referential, or occasional content. Use `frequentIntense` for recurring, central, explicit, realistic, or graphic content.
- For a non-default answer, save a short path-free rationale in `contentRatingEvidence`. Combine related rationales; do not show file paths, code symbols, or a long audit trail in the confirmation.
- `generativeAi = Yes` requires `aiModeration`. Set `aiModeration = Yes` only when local evidence shows output safety controls; otherwise propose `No`, which is the conservative rating branch.
- `advertising = Yes` requires `ageAppropriateAds`. Set `ageAppropriateAds = Yes` only when local evidence shows age-appropriate ad controls; otherwise propose `No`.
- In-Lens purchases alone do not change the age rating. Randomized purchasable rewards are `lootBoxes = Yes`; ordinary deterministic purchases are not.
- Location access alone is not location sharing. Set `locationSharing = Yes` only when the Lens shares a user's real-time location with other users.
- Networking alone is not unrestricted web access, advertising, messaging, or generative AI. Set each capability only when its user-facing behavior is present.

## Questions and rating candidates

Every severity question uses `none`, `infrequentMild`, or `frequentIntense`:

| Section | ID / confirmation label | Meaning | Infrequent/Mild | Frequent/Intense |
|---|---|---|---:|---:|
| Violence & Scary Themes | `cartoonFantasyViolence` / Cartoon or Fantasy Violence | Depictions of violence that are clearly not realistic. | 9+ | 13+ |
| Violence & Scary Themes | `realisticViolence` / Realistic Violence | Violence against people or animals in a realistic setting. | 13+ | 16+ |
| Violence & Scary Themes | `realisticGore` / Realistic Gore | Realistic blood, injury, dismemberment, or similar graphic content. | 16+ | 18+ |
| Violence & Scary Themes | `horrorFear` / Horror or Fear Themes | Scary themes or images designed to create fear. | 9+ | 13+ |
| Mature Content & Substances | `profanityCrudeHumor` / Profanity or Crude Humor | Swearing, crude jokes, or bodily-function humor. | 9+ | 13+ |
| Mature Content & Substances | `sexualContentNudity` / Sexual Content or Nudity | Suggestive themes, partial nudity, or full nudity. | 13+ | 16+ |
| Mature Content & Substances | `alcoholTobaccoDrugReferences` / Alcohol, Tobacco, or Drug References | Depictions or references to controlled substances. | 16+ | 18+ |
| Mature Content & Substances | `medicalTreatmentInformation` / Medical or Treatment Information | Medical advice, diagnosis, wellness instructions, or treatment guidance. | 13+ | 16+ |

`none` contributes `4+`.

Every capability question uses `No` or `Yes`:

| Section | ID / confirmation label | Meaning | Rating when Yes |
|---|---|---|---:|
| Interactive Safety | `unrestrictedWebAccess` / Unrestricted Web Access | A browser, open-internet links, or other unrestricted web access. | 18+ |
| Interactive Safety | `gamblingContests` / Gambling or Contests | Simulated gambling, real-money gambling, sweepstakes, or contests. | 18+ |
| Interactive Safety | `lootBoxes` / Randomized Purchasable Items | Paid randomized virtual items, loot boxes, or similar mechanics. | 18+ |
| Interactive Safety | `generativeAi` / AI-Generated Content | Generative AI such as chatbots, image generators, or generated media. | 13+ if moderated; otherwise 16+ |
| Interactive Safety | `aiModeration` / AI Output Moderation | Moderation or safety controls reduce mature AI output. Conditional; show only when AI-Generated Content is Yes. | — |
| App Capabilities | `messagingSocialNetworking` / Messaging or Social Networking | Users can message, chat, share photos, or share videos with each other. | 13+ |
| App Capabilities | `advertising` / Advertising | The Lens displays advertising. | 9+ if age-appropriate; otherwise 13+ |
| App Capabilities | `ageAppropriateAds` / Age-Appropriate Advertising | Ads shown in the Lens are age-appropriate for the intended audience. Conditional; show only when Advertising is Yes. | — |
| App Capabilities | `locationSharing` / Location Sharing | The Lens shares the user's real-time location with other users. | 16+ |

## Compute the age rating

Start at `4+`. Convert every answer to its candidate using the tables above and select the highest candidate in this order:

```text
4+ < 9+ < 13+ < 16+ < 18+
```

All eight severity answers and seven top-level capability answers are required. Include `aiModeration` only when `generativeAi = Yes`, and `ageAppropriateAds` only when `advertising = Yes`. Refuse to persist an incomplete assessment or any rating outside the five values above.

## Confirmation format

Show every proposed answer inside the existing single publish confirmation, after all Lens details, assets, organization, and submission metadata. Use one bullet per question so the confirmation stays readable at narrow widths; omit only an inapplicable conditional answer:

```markdown
### Content rating — <targetAgeRating>

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

**App Capabilities**

- Messaging or Social Networking: **<answer>**
- Advertising: **<answer>**
- Age-Appropriate Advertising: **<answer>** <omit when inapplicable>
- Location Sharing: **<answer>**

- **Content-rating rationale:** <short rationale for non-default answers; omit when every answer is None/No>
- **Content-rating coverage:** <short incomplete-evidence note; omit when coverage is complete>
```

Render severity values as `None`, `Infrequent/Mild`, or `Frequent/Intense`, and booleans as `No` or `Yes`. Preserve the blank lines and do not collapse questions into semicolon-separated rows. The user can choose **Edit** and change any answer; validate it, recompute `targetAgeRating`, refresh rationale/coverage, and show the whole confirmation again. Never change a confirmed answer or rating silently.

## Persist only the confirmed rating

The individual answers are confirmation inputs and are not server metadata. After registration and media updates, but before submit, persist the confirmed derived value with a partial version update:

```ts
const REQUEST_METHOD = "PUT";
const REQUEST_PATH = `/apps/${lensId}/versions/${releaseId}`;
const BODY = {
  reviewMetadata: {
    targetAgeRating: "<targetAgeRating>",
  },
};
const TENANT_ID = "<orgId or ''>";
```

This partial `reviewMetadata` update preserves omitted privacy-policy and declared-permission fields. Require `AUTHORIZED_POST_OK`; on any other status, do not submit the release.
