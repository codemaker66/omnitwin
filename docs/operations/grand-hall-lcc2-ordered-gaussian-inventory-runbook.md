# Grand Hall LCC2 ordered Gaussian inventory runbook

## Status and authority boundary

This runbook freezes a read-only ordinal domain for the highest-detail SOG
members in one exact XGRIDS LCC2 package. It grants **no** room-membership,
coordinate-frame, transform, mask, reconstruction, runtime, staging,
publication, architectural, or production authority.

The worker does not dequantize coordinates. It does not decide which Gaussian
belongs to the Grand Hall. It does not crop, repair, fill, generate, transform,
copy, upload, or rewrite source data. Its only downstream purpose is to give a
future reviewed membership bitset an exact record order to address.

## Bound diagnostic source

The locally reviewed canonical package is:

```text
C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2
```

The source is a processed BIG diagnostic, not retained LCC Creator Data or
NVIDIA nCore Data. Its existence does not satisfy T-555's source-faithful
reconstruction gate.

## Exact ordering contract

The worker uses the LCC2 highest-detail frontier in strictly ascending manifest
file-index order. Within each selected SOG member it uses SOG v2 pixel order:
row-major, top-left origin, ordinals `0..meta.count-1`. Pixels after
`meta.count` are ignored.

For every included ordinal it hashes:

- quantized position bytes as
  `x_low,x_high,y_low,y_high,z_low,z_high`;
- one 17-byte packed property record when higher-order SH is absent; or
- one 19-byte packed property record when the two-byte higher-order SH palette
  label is present.

Every SOG property plane must use a simple lossless VP8L WebP codec, decode to
the exact expected byte grid, use a valid quaternion mode, and, when present,
use an in-range SH palette label. Metadata rejects duplicate and prohibited
JSON keys. Each selected SOG is read into a bounded immutable snapshot and
must match its frontier SHA-256 before parsing or decoding.

The implementation follows the public
[PlayCanvas SOG v2 format specification](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/).

## Run

From the exact worktree root:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli exec tsx src/lcc2-ordered-gaussian-inventory-entry.ts --manifest "C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2"
```

The command writes JSON only to standard output. The environment container is
validated and hashed by the frontier worker but is excluded from the ordinal
inventory. No environment override exists in this command.

## Frozen real receipt

The complete local evidence receipt is:

```text
docs/evidence/grand-hall-lineage/2026-08-28/grand-hall-big-sog-ordered-gaussian-inventory-v1.json
```

Verified real facts:

- source frontier receipt:
  `sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352`;
- 11 selected highest-detail SOG members;
- 6,019,684 contiguous global Gaussian ordinals;
- global ordinal inventory:
  `sha256:e8d7c8d94b246bfb1e047088af31e4fcb74c34c65ed67c16435995a4f46ab46d`;
- receipt:
  `sha256:247cdad37b50821a9b06c59a139e3e6897c8b8c318c9c78de15b3c26187b30e3`;
- authority: `none`;
- room membership: not established;
- coordinate frame and transform: not established;
- mask: not produced;
- generated content added by this inspection: false.

## Machine gates

Run the focused gates before accepting a regenerated receipt:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli typecheck
pnpm --filter @omnitwin/reconstruction-foundry-cli exec eslint src/lcc2-container-validation.ts src/lcc2-frontier.ts src/lcc2-ordered-gaussian-inventory.ts src/lcc2-ordered-gaussian-inventory-cli.ts src/lcc2-ordered-gaussian-inventory-entry.ts src/__tests__/lcc2-ordered-gaussian-inventory.test.ts
pnpm --filter @omnitwin/reconstruction-foundry-cli test -- src/__tests__/lcc2-frontier.test.ts src/__tests__/lcc2-ordered-gaussian-inventory.test.ts
```

The tests cover hand-computed record hashes, ignored trailing pixels, optional
higher-order SH, lossy planes, quaternion and SH-label corruption, duplicate
metadata keys, hard links, oversized decoded grids, source mutation,
determinism, digest sensitivity, global interval continuity, and receipt
self-digest recomputation.

## Next authorized use

Keep this receipt authority-free. After T-554 supplies qualified human room
scope and T-557 supplies a reviewed cross-frame registration, a separate tool
may produce a bit-exact membership mask whose bit `i` refers to global ordinal
`i` in this receipt. That later mask must bind this exact ordinal-inventory
digest and must not infer or generate unobserved architecture.
