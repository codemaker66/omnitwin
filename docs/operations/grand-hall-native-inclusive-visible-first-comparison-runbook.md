# Grand Hall native-inclusive visible-first comparison

Date: 2026-09-01

Task: T-562

Authority: **none**

## Purpose

This lane deterministically compares the reviewed browser SOG/SPZ evidence with
the successful XGRIDS native LCC v14 capture at the shared inspection profile
`source-pose-19890-interior-v1`. PLY remains structural-only and is excluded
from radiance metrics.

The result is representation-disagreement evidence at one camera. It cannot
select a fidelity or beauty winner because none of the three rendered lanes is
independent ground truth for that inspection camera.

## Frozen inputs

- Browser hardware-v3 bake-off receipt SHA-256:
  `22b412f07a9eaa84655fafbdaae09f31f694c6b8f0d1eafc11c2665cab2c587f`
- Browser symmetric-comparison receipt SHA-256:
  `b82b428b309368cf9a9ab129a683e2296bc9edd6b677ba5eba64e2925c2e1776`
- Native v14 receipt SHA-256:
  `a97006c8facd90b8e4e8d4914acc72ea63ffbb967754ac9aaca4132c99369f90`
- Native operator receipt SHA-256:
  `a37fa98ee31abbd14a96a91462e571c2aed2b4b6e8b51d4918cda39efe7e314e`
- Camera profile SHA-256:
  `9eca9b6582b7301ec1c059b1a5be699e5a4983773afecb2beea46c2668305922`

The verifier independently reopens and validates the full browser bundle, the
exact 60-file / 214,350,601-byte native source package, the 890-file locked
vendor runtime closure, build/module/plugin/operator hashes, all three native
attempts, feature-toggle restoration, terminal log profile, and every raster
encoding relationship. The later exact native-rejection note beside the frozen
browser evidence is accepted only by its exact name and identity and is not
included in the reviewed five-file browser bundle.

## Create once

Run from `tools/reconstruction-foundry`. The output directory must not exist.
The command uses exclusive, identity-pinned staging and a no-replace directory
publication.

```powershell
pnpm exec tsx src/grand-hall-native-inclusive-visible-first-comparison-entry.ts write `
  --browser-receipt "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\evidence\grand-hall-lineage\2026-08-31-visible-first-hardware-v3\visible-first-browser-bakeoff-receipt.json" `
  --native-operator-directory "C:\Users\blake\AppData\Local\Venviewer\native-captures\grand-hall-gh1-lcc2-20260831T210928Z-61dd133e" `
  --output "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\evidence\grand-hall-lineage\2026-08-31-native-inclusive-visible-first-v1"
```

Never delete or replace an existing evidence directory merely to rerun this
command. Use check mode for the preserved result.

## Check exact regeneration

```powershell
pnpm exec tsx src/grand-hall-native-inclusive-visible-first-comparison-entry.ts check `
  --browser-receipt "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\evidence\grand-hall-lineage\2026-08-31-visible-first-hardware-v3\visible-first-browser-bakeoff-receipt.json" `
  --native-operator-directory "C:\Users\blake\AppData\Local\Venviewer\native-captures\grand-hall-gh1-lcc2-20260831T210928Z-61dd133e" `
  --output "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\evidence\grand-hall-lineage\2026-08-31-native-inclusive-visible-first-v1"
```

Successful check output reports schema
`venviewer.grand-hall.native-inclusive-visible-first-comparison.v1` and
authority `none`.

## Preserved output

The exact output directory is
`docs/evidence/grand-hall-lineage/2026-08-31-native-inclusive-visible-first-v1`.

| File | SHA-256 |
| --- | --- |
| `native-inclusive-comparison-receipt.json` | `68889dd7d73b6c3e7525501f9f0984507c83223bc0dc81d6bf93084b8b4a96f4` |
| `sog-spz-native-side-by-side.png` | `bc05456cc3190185854844af79cd2e378034addfc5c86e75d220d8d533dbbdd9` |
| `sog-spz-absolute-rgb-difference-x8.png` | `68e65209e737748f0fa5ac608d018ddfaefd01ef34745510dfaf0078916a9a7d` |
| `sog-native-absolute-rgb-difference-x8.png` | `1179f80aeea0fb8eabce91362b2efe0d3082d5fb497bc942e8969d1adc010b90` |
| `spz-native-absolute-rgb-difference-x8.png` | `b4abcb198ff207a83c198004d164c15465f3c61f245dbae280cde5b1edad945f` |

The difference images use exactly
`min(255, abs(rgb8A - rgb8B) * 8)` per channel.

## Focused verification

```powershell
pnpm exec vitest run src/__tests__/grand-hall-native-inclusive-visible-first-comparison.test.ts
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

The focused suite includes real frozen-evidence regeneration plus malformed
PNG, CRC/tag, source-inventory, path, no-overwrite, publication-race and
check-race attacks.

## Completion boundary

This lane proves a clean, aligned native diagnostic and deterministic
representation comparison for one fixed view. It does not establish a
captured master, human architectural acceptance, room boundary, difficult
oblique, metric transform, novel-view fidelity, training eligibility, runtime
admission, staging, deployment, publication, or production trust. Winner
remains `null`.
