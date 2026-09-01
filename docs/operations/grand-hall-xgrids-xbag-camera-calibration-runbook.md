# Grand Hall XGRIDS XBAG camera-calibration recovery

## Status and authority boundary

This T-566 lane reads and verifies six plaintext factory-configuration records
from the header of the exact raw Grand Hall XGRIDS XBAG. It binds all six by
exact profile facts and hashes, retains only the three calibration plaintexts
needed to rederive recorded facts, and validates that camera and cross-sensor
subset without modifying the source.

The output is an `authority: none` evidence receipt. It does **not** establish
camera-name mapping, transform direction, pose/quaternion semantics, metric
registration to MatterPak/E57, Grand Hall membership, training eligibility,
reconstruction authority, runtime admission, staging, deployment, publication,
or production trust.

The real create-only write and separate exact live-source regeneration check
both succeeded on 2026-09-01. The canonical receipt is
`grand-hall-xgrids-xbag-camera-calibration-authority-none-v1.json`; its
domain-separated receipt digest is
`sha256:818ccedc233e54f274e92a8abe5b602f157b55e41fb417762be046786a82cf50`
and its repository file SHA-256 is
`d71616b504acca947c25f2e79c25a38f8f367f45b17f36a39975360d14cc51b1`.

## Exact source and preconditions

Run from the repository root in the dedicated Grand Hall exact-runtime
worktree. The tool accepts only an absolute direct local source root and an
absolute direct local receipt path.

The expected source is:

```text
F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837
```

The existing `GRAND_HALL_XGRIDS_SOURCE_POLICY_V1` preflight is rerun before
calibration recovery. It re-verifies the complete allowlisted source tree and
binds the exact XBAG:

- locator: `XGRIDS_CAPTURE_ROOT/2026-05-31-101837.xbin`
- byte length: `41,095,196,672`
- SHA-256:
  `sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0`
- leading signature: `XBAG` (`58424147` hexadecimal)

The output parent must already exist as one direct, canonical directory. Write
mode is create-only and refuses an existing output. It canonically requires the
output to remain outside the raw XGRIDS source tree before source verification
or output creation begins. The parent's filesystem identity is captured before
the full source hash and revalidated after the source build. After `wx+` creates
the output, its descriptor, path identity, canonical parent, zero-byte size, and
raw-source disjointness are all bound before the first receipt byte is written;
the parent, descriptor, path, canonical parent, and disjointness are checked
again after the write. This closes the long-hash parent junction/replacement
race and preserves `sourceWrites: none`. Check mode requires the existing
receipt and does not replace it.

## Plaintext calibration block

The source verifier computes the complete XBAG SHA-256 through one open
descriptor and captures the first 16 KiB during that same descriptor-bound
pass. Calibration parsing uses that digest-bound capture; it does not close the
verified file and reopen its header. At absolute zero-based byte offset `4,563`,
a little-endian uint32 declares a `6,697`-byte configuration block. The block
occupies `[4,567, 11,264)`.

The block is parsed as repeated protobuf wire records. Each record must contain
exactly metadata, filename, and payload length-delimited fields. Production
parsing follows those wire lengths; it does not recover payloads by blindly
slicing the fixture offsets. The following absolute, zero-based, half-open
payload ranges and exact hashes are fail-closed profile assertions:

Each metadata field-2 varint is decoded with protobuf ZigZag semantics and must
equal the exact positive microsecond timestamp in the profile:

| Record | Record offset | Timestamp (microseconds) | Exact payload range | Bytes | Payload SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| `camera.yaml` | 4,567 | 1,780,219,117,551,538 | `[4,597, 7,162)` | 2,565 | `sha256:f5d9a485b4a38ac87e1c61c2e912f2e17e567e090af731c3bd2347c8f976f744` |
| `extrinsic_camera_lidar.yaml` | 7,162 | 1,780,219,117,553,252 | `[7,208, 7,528)` | 320 | `sha256:2902d2c132b5f79769d5232cf18f1c59ec2884af1d76f0750a498a0bf71d1e95` |
| `extrinsic_imu_lidar.yaml` | 7,528 | 1,780,219,117,554,730 | `[7,571, 7,773)` | 202 | `sha256:0630cc18e60bb7c52f6f87f3ccfac1a502363a3dacd7f8b0a4253f1a927ce510` |
| `extrinsic_rtk.yaml` | 7,773 | 1,780,219,117,556,046 | `[7,810, 7,962)` | 152 | `sha256:946920e1c684cffb4ec25a0479bcd244926663e6a5bef2f3307b2730697f0303` |
| `imu.yaml` | 7,962 | 1,780,219,117,556,244 | `[7,989, 8,263)` | 274 | `sha256:48fd7beebb760206f3481afa251f811d8484029f0ab58cae4d681d81a1eca6e2` |
| `lidar_param.yaml` | 8,263 | 1,780,219,117,557,559 | `[8,298, 11,264)` | 2,966 | `sha256:33a24da5b92632b44f36a4c633bed186693f5f666d163dafa166f3bb62dad2ee` |

All six payloads must be strict, non-empty, BOM-free, NUL-free, LF-only UTF-8.
For every record, the receipt preserves the exact filename, record offset,
wire-message length, ZigZag-decoded microsecond timestamp, payload range, byte
length, hash, and final-newline state. It retains plaintext only for
`camera.yaml`, `extrinsic_camera_lidar.yaml`, and
`extrinsic_imu_lidar.yaml`, because those bytes are required to rederive the
recorded calibration facts. The receipt stores `null`, not plaintext, for
`extrinsic_rtk.yaml`, `imu.yaml`, and `lidar_param.yaml`; those three remain
bound by their exact profile facts and hashes.

## Calibrated contents recovered

`camera.yaml` declares factory calibration version `V3.1.1`,
`calibrated: true`, four 4000 x 3000 cameras, four row-major 4 x 4
`camera_pose` matrices, and these source-order values:

| Camera ID | Model | Intrinsic four values in unresolved source order | Distortion in unresolved source order |
| --- | --- | --- | --- |
| `camera_0` | `kb4` | `[791.5354272942999, 791.3903141874899, 2006.660493306206, 1505.622160360652]` | `[0.0832349818488848, -0.001647448455028685, -0.01617600564349106, 0.003906064169159346]` |
| `camera_1` | `kb4` | `[793.3213047937273, 793.845115961021, 1995.639178232216, 1501.23534364115]` | `[0.09680203799792163, -0.02776613617577963, 0.007163102804534311, -0.002809399473577998]` |
| `camera_2` | `pinhole` | `[1928.713249193157, 1931.912834553417, 1941.865358868595, 1727.771399760032]` | `[-0.01367884694597883, -0.05614740582278507, -0.0001007910583584733, 0.0002434916629774321]` |
| `camera_3` | `pinhole` | `[1928.593853074948, 1931.545857317827, 1942.187657607921, 1725.510798644969]` | `[-0.02090822986117007, -0.0454533009039734, 0.0003269090952008118, 0.0009556824908978652]` |

The exact source-order `camera_pose` matrices are:

```text
camera_0
[ 1,  0,  0,  0,
  0,  1,  0,  0,
  0,  0,  1,  0,
  0,  0,  0,  1 ]

camera_1
[ -0.9996269125260729, -0.003370415876862033,  0.02710490823463626,  0.001118970997283801,
  -0.00327098949207115,  0.9999877618511736,    0.003711707911921388, 0.0002057520118776412,
  -0.0271170865200121,   0.003621663250173475, -0.9996257035380637,  -0.09235574841435108,
   0,                    0,                     0,                    1 ]

camera_2
[  0.008297801653838806, -0.001160476302446858, 0.999964899275202,    0.03052636594551077,
   0.01146795870958081,   0.9999336733534278,   0.001065277877224241, 0.004574532718363215,
  -0.9998998111864752,    0.01145871671138662,  0.00831055958280125, -0.03104768410194399,
   0,                     0,                    0,                    1 ]

camera_3
[  0.009296758013472975, -0.002577997669893715, 0.9999534610262881,   0.03071752484364806,
  -0.005728859847827634,  0.9999801279395486,   0.002631328722804653, 0.004774189868008573,
  -0.9999403734499785,   -0.005753056058959696, 0.009281804280397037,-0.06077510251773881,
   0,                     0,                    0,                    1 ]
```

The `extrinsic_camera_lidar.yaml` and `extrinsic_imu_lidar.yaml` records also
declare `V3.1.1`, `calibrated: true`, and the following exact row-major
matrices:

```text
camera_lidar
[ -0.00217090698638494,  0.0154371859711254,    0.9998784828428651,   -0.0104,
  -0.9999635755024366,   0.00821990676321996,  -0.002297999387910693,-0.04,
  -0.008254382547430786,-0.9998470515144289,    0.01541877902636306, -0.0464,
   0,                    0,                     0,                    1 ]

imu_lidar
[ -0.008448773, -0.9999462, -0.006001541,  0.00425,
  -0.9999173,    0.008506507,-0.009640303,  0.00418,
   0.009690838,  0.005919596,-0.9999354,   -0.00446,
   0,            0,           0,            1 ]
```

The tool verifies that all six matrices above are finite, homogeneous, and
numerically proper rigid transforms. That numerical check does not determine
what direction any matrix maps.

The other three exact plaintext records are verified during live-source
generation but are not copied into the receipt or promoted beyond their source
labels:

- `extrinsic_rtk.yaml` records default RTK/bracket values;
- `imu.yaml` records factory accelerometer and gyroscope calibration arrays;
- `lidar_param.yaml` records compatible LiDAR configuration parameters.

The PortalCam project metadata separately lists device camera names in source
order as `left_main`, `left_seco`, `right_main`, and `right_seco`. Nothing in
this recovery proves which name corresponds to `camera_0` through `camera_3`.

## Write the create-only receipt

Run from
`C:\Users\blake\omnitwin2-grand-hall-exact-runtime`. The target below must not
already exist:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-xgrids-xbag-camera-calibration -- `
  --raw-root "F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837" `
  --out "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-xgrids-xbag-camera-calibration-authority-none-v1.json"
```

A successful write reports `written_no_replace`. It creates the receipt with
private mode, syncs it, verifies the bytes through the same `wx+` descriptor,
and requires the path to retain that descriptor's identity. It also requires
the exact bytes and domain-separated self-digest to match.

After create-only opening succeeds, the tool deliberately never auto-deletes
the output, including on a later write or verification failure. This avoids a
path-replacement cleanup race. A failed output must be inspected and removed
manually only after its identity is understood; the next create-only run will
otherwise refuse it.

The self-digest proves receipt integrity only. It does not authenticate a
detached receipt to the live source by itself.

## Check exact regeneration

Run the separate zero-replacement check against the same exact live source:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-xgrids-xbag-camera-calibration -- `
  --check `
  --raw-root "F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837" `
  --out "C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-xgrids-xbag-camera-calibration-authority-none-v1.json"
```

A successful check reports `checked_exact_regeneration`. It stable-reads and
validates the existing canonical receipt, rebuilds it from the exact live
source, and byte-compares the complete regeneration. That live-source check,
not the self-digest alone, authenticates the receipt to the exact current source
bytes. A changed source, range, wire record, filename, timestamp, payload,
calibration value, source inventory, receipt byte, or self-digest fails closed.

Neither mode writes to the source or makes an application network request.

## Evidence and unresolved semantics

This lane establishes only that the exact source carries these factory-labelled
calibration bytes and that the accepted numeric subset is internally valid. It
does not establish:

- the mapping from `camera_0` through `camera_3` to `left_main`, `left_seco`,
  `right_main`, and `right_seco`;
- whether a `camera_pose` maps camera-to-body, body-to-camera, or another
  source-defined frame pair;
- whether `camera_lidar` and `imu_lidar` map in the labelled or inverse
  direction, so no body-to-camera composition is accepted;
- the semantics or ordering of the four source `intrinsic` values, including
  whether they mean `[fx, fy, cx, cy]`;
- distortion coefficient semantics beyond the preserved source order;
- the order, direction, axes, handedness, or frame semantics of quaternion
  tuples in `project_data/poses.csv`; T-563's `wxyz` result remains only the
  uniquely best tested component-order candidate;
- recovery of an optical frame payload or a synchronized LiDAR sample;
- any XGRIDS-to-MatterPak/E57 transform, metric authority, or Grand Hall room
  boundary; or
- permission to use the result for training, reconstruction, provider input,
  runtime, staging, publication, deployment, or production trust.

## No ZIP cracking

Do not crack, brute-force, decrypt, or otherwise attack
`XGRIDS_CAPTURE_ROOT/project_data/log/lixel.zip`. T-566 does not read that ZIP.
The required factory calibration already exists as exact plaintext in the
source-bound XBAG header, so password recovery is neither necessary nor in
scope.

## Next bounded optical/LiDAR reprojection

The next safe experiment is one tiny, authority-none, read-only synchronized
sample, not a full decoder or reconstruction:

1. Extend the format-aware XBAG reader only far enough to identify and recover
   one bounded timestamp window containing candidate optical payloads and the
   nearest LiDAR packet or scan.
2. Preserve exact source offsets, wire lengths, timestamps, raw-byte hashes,
   decoded-image hashes, and LiDAR-point hashes in a create-only receipt. Fail
   closed if synchronization or decoding is ambiguous.
3. Test the finite camera-ID-to-device-name assignments and both declared and
   inverse transform-direction hypotheses. Use only explicitly implemented
   source camera models and intrinsic/distortion hypotheses; do not silently
   pick a convention.
4. Project the tiny LiDAR sample into each recovered image, retain numerical
   residuals and visible overlays, and separate fit evidence from held-out
   checks.
5. Require qualified human review and select no mapping or direction when the
   evidence is ambiguous.

Even a clear tiny-sample result can only nominate a camera mapping and transform
direction for a later independently reviewed lane. It cannot accept room scope,
an XGRIDS-to-E57 registration, reconstruction input, runtime admission, or
production trust.

## Focused implementation gates

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli exec vitest run src/__tests__/grand-hall-xgrids-xbag-camera-calibration.test.ts
pnpm --filter @omnitwin/reconstruction-foundry-cli typecheck
pnpm --filter @omnitwin/reconstruction-foundry-cli exec eslint src/grand-hall-xgrids-xbag-camera-calibration.ts src/grand-hall-xgrids-xbag-camera-calibration-entry.ts src/__tests__/grand-hall-xgrids-xbag-camera-calibration.test.ts
pnpm --filter @omnitwin/reconstruction-foundry-cli build
git diff --check
```
