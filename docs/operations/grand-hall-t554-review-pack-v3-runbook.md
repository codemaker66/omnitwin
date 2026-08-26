# Grand Hall T-554 v3 exact human-review preparation runbook

> **HUMAN-PENDING — AUTHORITY NONE.** This pack is a source-bound review
> surface, not an accepted crop. Do not use it for training, reconstruction,
> runtime admission, staging, publication, or production trust. Do not infer a
> human decision from an agent observation, sweep number, camera hypothesis,
> MatterPak room label, or cleanup-marker name.

Date: 2026-08-26
Task: T-554
Status: exact v3 human-pending pack generated and independently checked; native-resolution human review has not begun

## What v3 binds

The v3 pack replaces the superseded v2 decision surface for future human
review. It binds all 148 exact 8192x4096 panorama identities, the immutable
T-554 predecessor, the exact T-561 observation pack and live source
regeneration, the T-551 room-9 boundary evidence, and the additive v2 cleanup
inventory with its independent exact regeneration. It contains:

- 148 unresolved human decision rows: 74 positive agent observations and 74
  negative agent observations;
- the explicit absence of numeric sweep 093 from the exact 148-file inventory;
- all eight exact-source interface candidates;
- both cleanup inspection classes, with no cleanup authority;
- an empty, unreviewed closed-volume template;
- no masks, human acceptance, training authority, reconstruction authority,
  runtime authority, generated-content authority, or public-evidence authority.

The agent observations are navigation aids only. A later human may overturn
either observation class.

## Generate the exact pending pack

Run from the repository root in PowerShell. The output directory must not
already exist because publication is no-replace and the receipt is written
last.

```powershell
$repo = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$v1 = Join-Path $repo 'docs\operations\grand-hall-t554-review-pack'
$panoramas = 'F:\downloads (some very important)\TH Panoramic'
$t554PanoramaPack = Join-Path $v1 'panoramas'
$observations = Join-Path $repo 'docs\operations\grand-hall-t561-panorama-visual-observations-input-authority-none.json'
$t561 = 'D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1'
$cleanupStage = 'F:\VenviewerCaptureStaging\trades-hall-2026-07-10'
$cleanupBoundary = Join-Path $repo 'docs\operations\grand-hall-room9-source-boundary-evidence-v1.json'
$cleanupPack = 'D:\venviewer-evidence\grand-hall-t554-cleanup-marker-evidence-v2'
$output = 'D:\venviewer-evidence\grand-hall-t554-review-pack-v3-human-pending-v1'

pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-review-pack-v3 -- --t554-v1-root $v1 --panorama-root $panoramas --t554-panorama-pack $t554PanoramaPack --t561-observations $observations --t561-pack $t561 --cleanup-stage $cleanupStage --cleanup-boundary-evidence $cleanupBoundary --cleanup-pack $cleanupPack --output $output
```

The real no-replace, receipt-last build produced exactly four flat JSON files:

- `closed-selection-volume-review-template-v3.json` — 673 bytes; file SHA-256
  `cdb4eed8b02e368979d91c08cd8fe8e21626c3aae5990add6f87382f6d976cfd`;
- `human-decisions-v3.json` — 130,068 bytes; file SHA-256
  `5de44997116549f532b721b0b640cff9fa72c1bc6d6c7281d23dc77088ba2d3e`;
- `review-pack-v3.json` — 130,706 bytes; file SHA-256
  `9c7b18186c1065a5216eff64e9c27343d81105f1f4adbfd705ee4612782281dd`;
- `publication-receipt-v3.json` — 3,590 bytes; file SHA-256
  `fa03a33401b6589e3e2d6fa2d1e393cdbf0573776de5666f0c0c422d0763dfe5`.

Semantic digests:

- review pack:
  `sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530`;
- pending human decisions:
  `sha256:f49a6a835c179cfc37f6dc5977800ef15bef39ab3920651e8845ab7d22940c93`;
- pending closed-volume review:
  `sha256:0fc3184050f79c5e09abad64344080b7fd6e9b4991752a4601cce6dbaa5f32e5`;
- publication receipt:
  `sha256:67800d907aebb1643ea8ee2dda580d76ca5849b400a46e52aef127339ee42b17`.

The exact small terminal receipt is preserved at
[`grand-hall-t554-review-pack-v3-human-pending-v1.json`](./grand-hall-t554-review-pack-v3-human-pending-v1.json).
Its repository copy and the generated receipt have identical serialized-file
SHA-256 `fa03a33401b6589e3e2d6fa2d1e393cdbf0573776de5666f0c0c422d0763dfe5`.

## Independent exact-regeneration check

Use the same variables and existing output, adding `--check`:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-review-pack-v3 -- --t554-v1-root $v1 --panorama-root $panoramas --t554-panorama-pack $t554PanoramaPack --t561-observations $observations --t561-pack $t561 --cleanup-stage $cleanupStage --cleanup-boundary-evidence $cleanupBoundary --cleanup-pack $cleanupPack --output $output --check
```

The real check reran both exact source-backed dependencies, returned
`checked_exact_regeneration`, reproduced all semantic digests, and reported
`exactRegenerationVerified=true`. Independent before/after comparisons found
the same four file lengths, modification times, and SHA-256 values, confirming
that check mode performed no output writes.

## Next safe step

Build and security-test the privileged localhost native-resolution review
workbench. It must open each source once through a server-owned descriptor,
derive hash/stat/decode and coverage evidence itself, derive mask facts from
exact bytes, use append-only server-timestamped review events, and publish a
strict no-extra byte inventory. The browser must never be trusted to assert
that native inspection, coverage, focus, visibility, scale, hashing, decoding,
or mask validation happened.

Even a complete native review export remains `human_pending` until a separate
accepted-chain byte verifier parses and cross-binds all 148 concrete receipts,
the exact v3 pack, every included mask, all interface and cleanup decisions,
the closed selection volume, and the final human attestation. No acceptance
command exists in this runbook.

No generative repair, invented window or doorway, dark central floor,
neighbouring room, facade, synthetic fill, or inferred architectural surface is
permitted anywhere in this sequence.
