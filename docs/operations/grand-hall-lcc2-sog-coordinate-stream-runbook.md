# Grand Hall LCC2 SOG coordinate-stream runbook

## Status and authority boundary

This is a bounded T-557/T-558 groundwork tool for decoding the already frozen,
processed BIG SOG frontier. It emits exact quantized position codes and their
public-SOG-v2 decoded source coordinate values. It grants **no** room,
coordinate-frame, metre, transform, mask, training, reconstruction, runtime,
staging, deployment, publication, architectural, or production authority.

The tool has now been run against the exact real 6,019,684-Gaussian source.
The retained local artifact is
`D:\venviewer-evidence\grand-hall-big-sog-coordinate-stream-v1`. A separate
zero-write regeneration/check pass succeeded both before and after the
post-publication path-normalization fix described below. This establishes an
exact, reproducible source-coordinate stream only. T-554, T-555, T-557, and
T-558 remain blocked at their existing human and source-faithful gates.

## Exact source and order binding

The completed real run is bound to:

```text
C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2
```

The existing authority-none ordered inventory establishes:

- 11 highest-detail SOG members;
- 6,019,684 Gaussians;
- ascending LCC2 frontier file-index order;
- row-major, top-left SOG pixel order through `meta.count - 1`;
- ordinal-inventory digest
  `sha256:e8d7c8d94b246bfb1e047088af31e4fcb74c34c65ed67c16435995a4f46ab46d`;
- ordered-inventory receipt
  `sha256:247cdad37b50821a9b06c59a139e3e6897c8b8c318c9c78de15b3c26187b30e3`.

The operator CLI exposes only the named source profile
`grand-hall-big-sog-v1`; it does not accept operator-supplied counts or hashes.
The library requires an explicit bounded profile so synthetic fixtures remain
testable without weakening the real command. Before it opens a declared SOG
member or creates a body, a manifest-only planning pass rejects more than
8,000,000 selected Gaussians or more than 64 selected members and requires the
plan's exact `6,019,684 / 11` counts to match the named profile. The coordinate
worker then re-inspects the ordered inventory after streaming and, before
publication, requires both frozen digests above. It fails closed if the
frontier, a member identity, a decoded plane, an ordinal, or a
quantized-position digest differs.

## Exact decoder contract

For each axis and ordinal, the emitted quantized body stores one uint16 little
endian value, ordered `x,y,z`:

```text
q = (upper << 8) | lower
u = q / 65535
scale = (max - min) || 1
n = min + scale * u
p = n < 0 ? -(Math.exp(Math.abs(n)) - 1) : Math.exp(Math.abs(n)) - 1
```

`min` and `max` are the member's `meta.means.mins/maxs` log-domain values.
The `|| 1` fallback and `< 0` branch are intentional: they match the reference
iterator's degenerate-range and negative-zero behavior. `Math.exp` is used,
not `Math.expm1`. Each decoded `p` is written as IEEE-754 float64 little
endian, ordered `x,y,z`.

The contract is pinned to the public
[PlayCanvas SOG v2 specification](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/),
the public [SOG v2 proposal](https://github.com/playcanvas/splat-transform/issues/38),
and the independently inspected reference implementation
`@playcanvas/splat-transform@3.3.3` at commit
`d092ae94e6e1d5161990ce5ca960f659ea9faf5f`. The bound reference source is
`src/lib/readers/read-sog.ts`, SHA-256
`a5f721d5337add7eeec0f947c66c12ae36c257504863076bfc72cc191630570c`.
The PlayCanvas package is not a project dependency. Its `readSogSourceV2` path stores decoded
JavaScript-number results into a `Float32Array`; this tool deliberately writes
the same pre-float32 JavaScript-number calculation as float64. The values are
formula-compatible but the two bodies are not claimed to be byte-identical.
The receipt also binds the emitting Node version, V8 version, platform,
architecture, host byte order, and explicit little-endian output rule. Because
the last bit of `Math.exp` is not promised identical across JavaScript math
runtimes, exact check/regeneration intentionally fails closed when that bound
runtime changes; use the original bound runtime to reproduce exact f64 bytes.

## Create-only output

The evidence target is deliberately outside the repository and source
package:

```text
D:\venviewer-evidence\grand-hall-big-sog-coordinate-stream-v1
```

`write` requires that exact target not exist. It creates a private sibling
staging directory, writes and syncs the two bodies, reopens and hashes them,
writes the compact receipt last, verifies the complete three-file inventory,
and uses Windows no-replace directory publication. It never overwrites an
existing target. The direct parent `D:\venviewer-evidence` must already be a
real, canonical directory; the tool does not create or replace its parent.

The three members are:

```text
positions-u16le-xyz.bin
positions-f64le-xyz.bin
coordinate-stream-receipt.json
```

For the frozen real count, the expected body lengths are exact:

- quantized uint16-le XYZ: 36,118,104 bytes;
- decoded float64-le XYZ: 144,472,416 bytes.

The compact receipt binds the expected named source profile, the 8,000,000 / 64
adapter ceilings, both global bodies, every member interval/body
slice/digest/log-domain bound, and the final ordered-inventory receipt. During
that same stream pass it records per-member and global per-axis uint16 min/max,
pre-fround float64 min/max, `Math.fround` reference-float32 min/max, and finite
and non-finite counts. Any non-finite float64 or float32 projection fails
closed, so every successful receipt records zero non-finite counts. All
authority and downstream-action flags remain false.

## Completed real write and retained artifact

The real local command was:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli lcc2-sog-coordinate-stream -- write --profile grand-hall-big-sog-v1 --manifest "C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2" --output "D:\venviewer-evidence\grand-hall-big-sog-coordinate-stream-v1"
```

If the command stops before publication, it removes only the private staging
directory whose filesystem identity it still owns. It never recursively
removes an unknown or replaced path.

The first invocation completed its create-only rename and therefore published
the exact three-file target, but then returned
`LCC2_COORDINATE_OUTPUT_UNSAFE` while reopening
`positions-u16le-xyz.bin`. That was a post-publication false negative in the
member-containment guard: it compared equivalent Windows path spellings as
raw strings. The output was preserved exactly as published; it was not deleted,
replaced, or rebuilt. The implementation now normalizes the output target once,
uses one canonical comparison domain for containment, and rejects Windows
file/device-namespace input aliases before any source or output is opened. One
focused regression publishes through an equivalent trailing-separator spelling
and completes both post-publication verification and a later check; another
proves that a `\\?\` alias cannot place output inside the source tree.

The retained artifact has these exact identities:

- quantized body: 36,118,104 bytes,
  `sha256:c779e391a647bc6e22966be16b7d8788284dda78743fb6ef5dcd6d38e1595523`;
- pre-fround float64 body: 144,472,416 bytes,
  `sha256:bed066d3f4cb67bfe28d9350eac02711e1ee922c95f187cc82796f76cb98ace4`;
- receipt file: 20,379 bytes,
  `sha256:a60ae141bb26b1908a7754e22322c53f137075041c1e33e0f8ed6a422bd81f9b`;
- receipt semantic digest:
  `sha256:7204a1d3ecf6363bd53e95cf599e1a7fd5e52d1fcc9478f377893be2ccabd4df`.

The global pre-fround float64 bounds are
`[-12.698788859981757, -19.860288515188607, -2.843126764451671]` through
`[3.217487206297002, 2.6898880292116765, 7.489986459074217]`. The global
`Math.fround` projection bounds are
`[-12.6987886428833, -19.860288619995117, -2.8431267738342285]` through
`[3.217487096786499, 2.6898880004882812, 7.489986419677734]`. Every axis has
exactly 6,019,684 finite values and zero non-finite values.

## Zero-write check

The following zero-write command was run successfully after publication and
again after the path fix:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli lcc2-sog-coordinate-stream -- check --profile grand-hall-big-sog-v1 --manifest "C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2" --output "D:\venviewer-evidence\grand-hall-big-sog-coordinate-stream-v1"
```

`check` creates no file or scratch directory. It opens the two existing bodies,
regenerates each source chunk in memory, compares bytes at the exact offset,
re-hashes the open handles, regenerates the canonical receipt, and rechecks
file and directory identities before returning success.

## Optional independent reference comparison

Keep this independent of the production tool and do not add PlayCanvas as a
workspace dependency. A separately obtained
`@playcanvas/splat-transform@3.3.3`
(`d092ae94e6e1d5161990ce5ca960f659ea9faf5f`) summary for the first selected
member, `data/3dgs/0_0_0_1_0_1.sog`, is the post-build oracle:

- Gaussian count: 556,880;
- rounded position minimum: `[-4.511324, -8.176147, -2.588207]`;
- rounded position maximum: `[1.564658, -1.077435, 7.445688]`;
- position NaN counts: `[0, 0, 0]`;
- position infinity counts: `[0, 0, 0]`.

The read-only comparison streamed the
first member slice from `positions-f64le-xyz.bin`, applied `Math.fround` to each
coordinate to reproduce the reference reader's `Float32Array` storage, then
recomputed per-axis min/max and non-finite counts. The observed float32-aware
minimum was `[-4.511323928833008, -8.176146507263184, -2.5882070064544678]`
and maximum was
`[1.5646579265594482, -1.0774352550506592, 7.445688247680664]`, with 556,880
finite values and zero non-finite values per axis. They equal the first-member
receipt statistics and round to the independently obtained six-decimal oracle
above. Do not compare reference float32
bytes with the deliberately pre-fround float64 body. This is an independent
decoder check, not coordinate-frame, metric, room, transform, or acceptance
evidence. The producer receipt correctly retains
`independentReferenceComparisonPerformed: false` because this comparison was
external to artifact production.

## Machine gates

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli typecheck
pnpm --filter @omnitwin/reconstruction-foundry-cli exec eslint src/lcc2-frontier.ts src/lcc2-container-validation.ts src/lcc2-sog-coordinate-stream.ts src/lcc2-sog-coordinate-stream-cli.ts src/lcc2-sog-coordinate-stream-entry.ts src/lcc2-ordered-gaussian-inventory.ts src/__tests__/lcc2-ordered-gaussian-inventory.test.ts
pnpm --filter @omnitwin/reconstruction-foundry-cli test -- src/__tests__/lcc2-frontier.test.ts src/__tests__/lcc2-ordered-gaussian-inventory.test.ts
pnpm --filter @omnitwin/reconstruction-foundry-cli build
```

Focused verification passes 2 files / 54 tests, strict typecheck, affected
ESLint, and the package build. Tests cover exact endpoints, midpoint, negative values, positive zero,
degenerate ranges, global/member order, body encodings, manifest-only total and
member ceilings, wrong count/digest source profiles, the CLI's named-profile
restriction, true zero-write check, create-only refusal, byte drift, source
drift, a racing publication target, output-directory replacement, non-finite
recovery, equivalent Windows output spelling, device-namespace alias rejection,
and unchanged legacy
ordered-inventory digests.

## Next valid use

These bodies may later supply stable source-coordinate observations to a
separately reviewed registration workflow. They must not be interpreted as
metres, MatterPak/E57 coordinates, Grand Hall membership, or a usable crop.
Only a human-reviewed T-557 transform and exact output-inventory bitset can
carry that later meaning, and T-558 must still byte-verify all accepted real
artifacts before any trust root changes from `null`.
