# Grand Hall T-554 v2 unified human-review runbook

Date: 2026-08-26
Task: T-554 successor preparation under T-561
Status: exact human-pending pack generated and checked; no human decision or mask exists yet

## What this pack fixes

The immutable T-554 v1 review pack split the supplied panoramas into 50
candidates and 98 other files. T-561 found Grand Hall pixels in 24 files outside
that candidate set, so the v1 acceptance path is permanently stopped.

The v2 pack presents one ordered decision surface containing all 148 exact
source identities. It carries the T-561 74/74 agent observations only as
authority-none review hints. Every human decision is blank (`UNSURE`), the
closed selection volume is empty and pending, no mask or geometry is authored,
and `nativeResolutionHumanReviewCompleted=false`.

Frozen local implementation and reviewed-run commit:
`ff4910064c296cae75958aeb9fb05aa820b90635`. The real v2 zero-write check was
rerun from that exact commit and passed.

## Bound inputs

- immutable predecessor review root:
  `docs/operations/grand-hall-t554-review-pack`;
- sealed T-561 observation input:
  `docs/operations/grand-hall-t561-panorama-visual-observations-input-authority-none.json`;
- checked T-561 local evidence pack:
  `D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1`.

The successor binds the predecessor artifact and file digests, the T-561 input
file and observation-set digests, and both the semantic and serialized-file
digests of the T-561 manifest and publication receipt.

## Generate

Run from the repository root in PowerShell. The output must be absent:

```powershell
$repo = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$v1 = Join-Path $repo 'docs\operations\grand-hall-t554-review-pack'
$observations = Join-Path $repo 'docs\operations\grand-hall-t561-panorama-visual-observations-input-authority-none.json'
$t561 = 'D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1'
$output = 'D:\venviewer-evidence\grand-hall-t554-review-pack-v2-human-pending-v1'

pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-review-pack-v2 -- --t554-v1-root $v1 --t561-observations $observations --t561-pack $t561 --output $output
```

The no-replace, receipt-last real build produced exactly four flat JSON files:

- `review-pack-v2.json` — 130,485 bytes; file SHA-256
  `24c362e6a44c614d5b204ca188d50ed22263553a5272616f7185fc8c3f566a3c`;
- `human-decisions-v2.json` — 114,908 bytes; file SHA-256
  `70b9078cdfdeb13257650a95b8b7bca72f49159d88172e3aadae6df63f20385f`;
- `closed-selection-volume-review-template.json` — 673 bytes; file
  SHA-256
  `bf1422419b3be0b81216b5ddbe21821e68341e3cfd1e7b1e1c5d6453c7469a40`;
- `publication-receipt-v2.json` — 2,542 bytes; file SHA-256
  `9439b2540a3c726184341ddec28b012c769b45d8d4ea401e1abebe1abd7f6f6a`.

The review-pack semantic digest is
`sha256:6a1c83a7784e39876d12f83294699fd9ad32ae85372f9b2a622b26cfce5e2037`.
The publication-receipt semantic digest is
`sha256:d6b5e4da5d5bffb4207fd15524295c24055612106d38c45a659b754e38a38845`.
An exact copy of the small terminal receipt is preserved at
[`grand-hall-t554-review-pack-v2-human-pending-v1.json`](./grand-hall-t554-review-pack-v2-human-pending-v1.json).

## Zero-write exact check

Use the same variables and add `--check`:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-review-pack-v2 -- --t554-v1-root $v1 --t561-observations $observations --t561-pack $t561 --output $output --check
```

The real check returned `checked_t554_v2_exact_zero_write`, the same semantic
digests, and `exactRegenerationVerified=true`. It rejects a missing, extra,
changed, aliased, hard-linked, symlinked, non-flat, self-inconsistent, or
pre-populated-decision artifact.

## Baby-step human review sequence

Nothing in this pack is accepted yet. A qualified venue reviewer must do these
steps in order:

1. Open `review-pack-v2.json` and the exact source JPEG named in each row.
2. Inspect every source at its native 8192x4096 grid, even if the agent recorded
   no Grand Hall pixels.
3. For each of the 148 rows, choose `INCLUDE`, `EXCLUDE`, or leave `UNSURE`.
   Do not infer the answer from sweep number, camera location, or the agent hint.
4. For every included source, draw an 8192x4096 grayscale binary mask: 255 only
   for Grand Hall pixels and 0 for portals, neighbouring rooms, facade, capture
   artifacts, and all uncertain pixels. Review the exact saved mask bytes.
5. Separately accept or reject MatterPak room 9 as the intended Grand Hall.
6. Separately inspect and resolve the source-bound `Window` and `Mirror` cleanup
   classes; these decisions grant no architectural authority.
7. Resolve all eight interface candidates from their exact source evidence.
8. Author and inspect the separate invisible closed selection volume. It must
   be non-empty, non-convex where the room requires it, manifold, and used only
   for selection—not rendered or exported as architecture.
9. Leave the final result pending if any row, mask, interface, cleanup item,
   room decision, or volume decision remains uncertain.
10. Only after all evidence is complete, run the future accepted-chain byte
    verifier. Do not use this human-pending generator as an acceptance command.

No generative repair, inferred window or doorway, facade asset, neighbouring
room, or synthetic fill is permitted in this review sequence.
