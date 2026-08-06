# Authoritative LCC2 highest-detail frontier evidence — 2026-07-14

## Plain-language result

The `.lcc2` files are readable JSON manifests, not opaque binary containers.
Their node tree directly identifies which splat-file index and Gaussian-index
range records every spatial node at every level. We can therefore select a complete
highest-detail frontier from the manifest itself. We do not need to guess from
underscore counts in filenames.

The new read-only worker passed unchanged against both local exports:

| Room | Manifest levels | Highest-detail nodes | Selected files | Selected Gaussians | Selected bytes | Environment |
|---|---:|---:|---:|---:|---:|---|
| Reception Room Quality | 3 | 30 | 4 | 2,002,009 | 35,735,101 | explicitly excluded |
| Grand Hall Bright Walls | 5 | 31 | 9 | 4,984,397 | 61,668,963 | explicitly excluded |

Each run was repeated from the unchanged source. The repeated receipt hashes
were byte-identical:

- Reception receipt: `sha256:481589c36b3bf37bffea694edf72876b09c3470545eb097cf524ea808fc0f149`
- Grand Hall receipt: `sha256:df8d8f86ccd67856dd53c0bb087265efec44480bda2e1e78234fcd84ff7b26df`

The same worker also passed the separate Reception Mobile `.spz` export: 3
levels, 18 leaf nodes, 4 selected files, 1,978,258 Gaussians, and 30,010,681
bytes. Its explicit-environment-exclusion receipt is
`sha256:c897dd55fd8efc5397a76d96572a654058defd232f10767b1827fe684e7b6357`.

These hashes supersede the earlier pre-hardening receipt hashes. The receipt
now includes the size and SHA-256 of every validated ancestor alternative, not
only the selected leaves and environment, so its proof is bound to all source
containers it claims to have checked.

## What the vendor manifest says

The observed files use LCC2 version `0.0.3`. Relevant fields are:

- `root.splatFiles`: the authoritative ordered splat-file table;
- each non-root node's `data.3dgs.name`: an index into that table;
- each non-root node's `data.3dgs.start` and `count`: its contiguous range in that file;
- `child` and `childNum`: the spatial hierarchy;
- `totalLevels`: the highest leaf depth;
- `lodSplats`: published Gaussian totals, highest detail first;
- `root.data.env.name`: the separate environment-file index; and
- `env.splatsCount`: the environment Gaussian count.

The compiler proves all leaves end at `totalLevels`, every non-environment file
is referenced, each file belongs to exactly one depth, every file's node ranges
are contiguous and non-overlapping, and every manifest-declared level total
equals the corresponding published `lodSplats` value. Before a receipt is
issued, the worker also validates every SOG ZIP or legacy gzip SPZ container and
requires its embedded per-file Gaussian count to equal the manifest's aggregate
node-range count. For SOG v2 it enforces the required ordered image slots,
finite ranges and codebooks, fully decodes every WebP, checks shared image
dimensions and pixel capacity, and validates optional spherical-harmonic
centroid and label shapes. Parent and child representations are then recorded
as alternatives, never added together, and every validated file is digest-bound
into the receipt.

## Exact local evidence

### Reception Room Quality

- Manifest: `C:\Users\blake\AppData\Local\LccStudio\DATA\1900549066649638\output\render2\Reception Room.lcc2`
- Manifest SHA-256: `f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e`
- Explicitly excluded environment SHA-256: `1b6927a6d883634d93cc59294c77f2acc02b55da1092bdd6bd637765e8b3f7f8`

| Selected member | Gaussians | Bytes | SHA-256 |
|---|---:|---:|---|
| `data/3dgs/0_15_0_0.sog` | 602,409 | 10,279,160 | `111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368` |
| `data/3dgs/0_1_0_5.sog` | 577,816 | 10,047,085 | `559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1` |
| `data/3dgs/0_6_0_0.sog` | 599,740 | 10,368,228 | `182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238` |
| `data/3dgs/0_7_0_0.sog` | 222,044 | 5,040,628 | `3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf` |

### Grand Hall Bright Walls

- Manifest: `C:\Users\blake\AppData\Local\LccStudio\DATA\19005490661146372\output\render2\GH_Bright_Walls.lcc2`
- Manifest SHA-256: `3c29b115bfd5da44ef60c13ae6d5972b50caa30c12e9a8137e1c55eb5ef7c811`
- Explicitly excluded environment SHA-256: `803c1c3d51f84f74ca17fd461276ea4ddad4e40302717d1c8383f1b3fbc5cf21`

| Selected member | Gaussians | Bytes | SHA-256 |
|---|---:|---:|---|
| `data/3dgs/0_0_0_0_1_1.sog` | 587,255 | 7,239,051 | `e3014a80dcd2c101f99c572021af91840f1606ebe53177c4a9831df2bbd4e746` |
| `data/3dgs/0_1_0_1_0_1.sog` | 565,402 | 7,012,028 | `d1b470c05d52486f98c8ef73a94b7adc06c9d92f8447298385db4ccd5917a781` |
| `data/3dgs/0_2_0_1_0_0.sog` | 517,420 | 6,381,296 | `0e963c34959abbe9ecf58ac2b32b980ec75a1cf962d3620782c294b272445894` |
| `data/3dgs/0_3_0_0_0_1.sog` | 583,465 | 7,033,566 | `622ba6b17dbdd9e4add9e6b2e9a787d2638068dd909c262b7d5ca031c20e0b0e` |
| `data/3dgs/0_4_0_0_0_0.sog` | 504,454 | 6,091,495 | `0c3e6b54150ddc760371a76c7ca09a3e3e093ba2bb9c6be1bcff9973c1d0cd11` |
| `data/3dgs/0_4_0_1_0_1.sog` | 537,503 | 6,701,787 | `97e75169a77cbd6c81e5aada19a9566312cfe77d5dcf2d8a40f54df6aff3ee2e` |
| `data/3dgs/0_5_0_1_0_1.sog` | 557,128 | 7,018,046 | `50f9b6876e4540d1d23deef4fbb2a890d8b056c0b2cc6e18146e73847a7363eb` |
| `data/3dgs/0_6_0_1_0_1.sog` | 634,881 | 7,827,959 | `a86500ceabd839ab6146bc99bb5d69a4036177cbbc7e7f59038715c22ae8db4f` |
| `data/3dgs/0_7_0_0_0_0.sog` | 496,889 | 6,363,735 | `30e3e9f5c303d26c9b674163146858dbaa0f4fbd1bec5f429a2363156c6bed07` |

## Reproduce the check

From the repository root, replace the path as needed and run:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli lcc2-frontier -- --manifest "C:\absolute\path\to\scene.lcc2" --environment exclude
```

Use `--environment include` only when the environment is an intentional member
of the visual experiment. The command emits JSON to standard output. It reads
the manifest and local files but makes no source write and no network request.

## Safety and determinism checks

The worker rejects:

- a relative, remote, device, missing, non-regular, symbolic-link, junction, or hard-linked path;
- a file that changes before, during, or after hashing;
- malformed UTF-8, duplicate JSON keys, prohibited prototype keys, or excessive nesting;
- an unsupported LCC2 version or splat format;
- a malformed SOG/SPZ container, an unloadable or undersized SOG WebP image, or
  an embedded per-file Gaussian count mismatch;
- missing, duplicate, unsafe, case-colliding, or unreferenced splat paths;
- an environment file without an explicit include/exclude decision;
- a malformed tree, early leaf, mixed-depth file, invalid file range, or published LOD count mismatch; and
- a parent-plus-child composition disguised as one frontier.

Automated verification completed with 145 tests passing across the local tool,
including 34 focused LCC2 worker and CLI-contract tests. Type-check, lint, and
build also passed.

## What this does not prove

This receipt proves hierarchy composition, supported container integrity,
embedded Gaussian-count agreement, and local byte identity. It does not
prove that the capture is visually sharp, physically accurate, rights-cleared,
registered to the venue coordinate system, correctly exposed, or faster in the
browser. Those claims still require fixed-camera and moving-camera visual QA,
performance measurements, provenance review, and human approval. Computer
vision can help find ghost edges and blur, but it cannot recover room detail
that the source capture never recorded.

Container validation is intentionally fail-closed around formats observed in
the local exports: ZIP32 SOG v2 archives with stored WebP payloads, and legacy
gzip SPZ versions 1 through 3. ZIP64, unusual SOG payload layouts, current SPZ
v4/Zstandard files, and SPZ streams that expand beyond 64 GiB are rejected as
unsupported rather than guessed. Adding one of those formats requires a new
bounded parser and fixtures before the receipt can claim validation.
