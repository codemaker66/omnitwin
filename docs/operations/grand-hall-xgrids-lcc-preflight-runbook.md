# Grand Hall XGRIDS/LCC estimator preflight

Status: local read-only operator gate
Scope: Trades Hall / Grand Hall / raw PortalCam capture dated 2026-05-31
Authority: none; diagnostic preflight only

## What this command does

The command proves that the exact raw XGRIDS project is still present and
unchanged, observes the Windows machine, and reports whether the operator may
proceed to LCC Studio's own resource-estimator step.

It does **not** start LCC Studio, reconstruction, training, upload, staging,
publication, or deployment. Even an eligible receipt says all of those actions
remain unauthorized. It never writes to the supplied capture root.

The only successful decision is:

`eligible_for_lcc_estimator_only`

That means “open the vendor resource estimator next,” not “start
reconstruction.”

## Before running

Prepare three existing absolute local paths:

1. The original capture root. For the current owner workstation this is
   `F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837`.
2. A dedicated, empty scratch directory on one healthy local NVMe volume. Do
   not put any file in it before preflight.
3. The LCC Studio installation root containing `LccStudio.exe` and
   `build/version.json`.

The scratch policy is intentionally conservative:

- Windows x64;
- at least 128 GiB installed RAM;
- exactly one NVIDIA GPU;
- compute capability greater than 7.5;
- at least 24,000 MiB reported VRAM;
- driver 581.90 or newer;
- one healthy online NVMe-backed fixed volume;
- NTFS or ReFS;
- at least 500 GiB free;
- empty directory with a non-mutating write-access check.

No scratch write benchmark is performed.

Current-machine diagnostic (2026-08-25): **no currently available local
volume meets the scratch gate**. In particular, `D:` is HDD-backed and must
not be used as though it were the required NVMe scratch. This is a blocker,
not permission to weaken the gate.

## Run it

From the repository root in PowerShell:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-lcc-preflight -- --source "F:\gaussian splat -- xgrids\model\The_Grand_Hall_2026-05-31-101837" --scratch "<NVME_DRIVE>:\trades-hall-grand-hall-lcc-scratch" --lcc-install "F:\LccStudio"
```

Replace `<NVME_DRIVE>` only after a suitable healthy local NVMe volume is
installed and the directory exists and is empty. The placeholder is not a
current-machine drive recommendation.

The source contains a 41.1 GB XBIN. The command reads and hashes every byte, so
allow time for the full pass. It prints JSON only after the complete 12-file
tree has been verified and rechecked for in-flight changes.

Exit codes:

- `0`: eligible for the LCC estimator only;
- entrypoint `2`: a valid blocked receipt was printed; read
  `decision.blockers`;
- `1`: the source or invocation failed integrity checks, so no receipt was
  issued.

On the current Windows pnpm version, the package-script wrapper normalizes a
child exit `2` to wrapper exit `1`. Distinguish the cases without ambiguity:
a blocked run prints a complete JSON receipt whose `decision.status` is
`"blocked"`; an integrity/invocation failure prints no receipt and writes the
fixed safe failure text to stderr. The tested CLI function itself returns `2`
for the former. Do not relabel a missing-receipt failure as a valid block.

The CLI deliberately has no `--out`, expected-hash override, readiness
override, launch, upload, or publish option. If the operator privately retains
a receipt, redirect stdout to a path outside every supplied source root and
keep it with the same access controls as the project evidence.

Fatal invocation and integrity errors are value-free: stderr never reflects
supplied argv, filesystem paths, subprocess output, exception messages, or
exception causes. The NVIDIA and PowerShell probes receive a fixed minimal
Windows environment plus the scratch locator required by the fixed script;
they do not inherit operator API keys, tokens, proxy credentials, or the user
profile environment.

## Exact source binding

The allowlist is exactly 4 directories and 12 files, totaling
41,296,996,984 bytes. Missing files, extra files, linked files, hard links,
unsafe paths, byte-length changes, digest changes, and tree changes during the
pass all fail closed.

Canonical inventory digest:
`sha256:6e6fe18c4944cb5a0e68a69c3bc9dbb808835be6293465f50652d47e8df68236`.

| Relative file | Bytes | SHA-256 |
|---|---:|---|
| `2026-05-31-101837.xbin` | 41,095,196,672 | `42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0` |
| `project_data/control_points.csv` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `project_data/gnss.csv` | 6,077,731 | `ba1baa1b9c1720f7785b84ecebeec0b1d620287672d6bb97ed6bdb43fb54d476` |
| `project_data/log/data.ulg` | 56,123,435 | `ad5a5d1a110fe4adefa1cbca4da1c84e4db40aa94cfa2b854df368621b4bce8c` |
| `project_data/log/lixel.zip` | 120,042,466 | `61b8acbb600e19176ef00a1d90a48d10e565922feb5beddd8741de135df29949` |
| `project_data/log/project.json` | 2,415 | `3fab1721433beb64e5a34c1916e60730195083dd0887f12db0a0f6b69035bc77` |
| `project_data/model/hierarchy.bin` | 17,820 | `bb11d48785f32db8f1b5eb56cb5b893aa2391cd04cad626f48dd6bb7abb25df5` |
| `project_data/model/log.txt` | 18,917 | `73e81b01af59410cda9d1ea21c58649bc76ca4af5967303791c434016b77d579` |
| `project_data/model/metadata.json` | 1,301 | `4c47093ab55432aa13194212bc6cc911a993bb7752e7f294e68ef86cf8a71252` |
| `project_data/model/octree.bin` | 15,606,514 | `bc7fe85d445cbf75b6734952b48be4b9bd01bac6a0641e0cf07b5ba766e603ca` |
| `project_data/poses.csv` | 3,659,287 | `b86bc45d15b8b5a84d61160afe3e16e7659e195557a2b8c6567039bb74d83127` |
| `project_data/preview_photo.jpg` | 250,426 | `8c28a341d540be467953f40c4029daad71e86983f2609e537aaf5168200de984` |

The XBIN must also begin with the exact `XBAG` signature.

## Capture facts checked from the same hashed bytes

The hash-bound `project.json` must report PortalCam, LCC scan mode, the exact
four-camera list, the recorded capture timestamp, and the recorded 4,402-second
vendor scan-time field. Serial numbers, account identifiers, activation data,
and device IP addresses are never copied into the receipt.

The hash-bound `poses.csv` must contain exactly 42,850 strict eight-column
rows with increasing timestamps. Timestamp arithmetic uses integer
microseconds rather than floating subtraction:

- first: `1780219119879549` µs;
- last: `1780223405502131` µs;
- span: `4285622582` µs (`4285.622582` seconds).

The vendor's 4,402-second project field and the 4,285.622582-second pose span
are recorded separately. The tool does not pretend they measure the same
interval.

## Why the current LCC installation remains human-review gated

The tool hashes `LccStudio.exe` and `build/version.json`. The currently
observed internal version is `0.15.0.7`. That internal version cannot honestly
be mapped to the public LCC Studio 2.3 documentation label without reviewed
vendor/About-screen evidence. The receipt therefore leaves
`releaseCompatibilityReview` at `required_not_recorded` and blocks estimator
eligibility rather than guessing.

The receipt also carries explicit later evidence placeholders for:

- Creator Data enabled;
- NVIDIA nCore Data selected;
- Point Cloud Preview accepted by a human reviewer;
- LCC's resource estimator accepted;
- Intelligent Space Recognition disabled, so no inferred doors, windows, or
  floor-plan content enters this exact pipeline;
- the complete reconstruction configuration reviewed.

Those are later reconstruction gates. They are not silently upgraded by this
machine probe.

## Interpreting a blocked receipt

Follow `decision.blockers` literally. Do not suppress or edit blocker codes.
The common current blockers are expected to include insufficient RAM, an
unqualified scratch drive, and missing reviewed LCC 2.3-or-newer evidence.

Never use a receipt to claim Grand Hall training, runtime, structural,
collision, export, staging, or public authority. T-554's human-reviewed scope,
selection volume, interfaces, and panorama masks plus T-557's reviewed
registration and exact XGRIDS-output mask remain separate gates.

## Superseded 2026-08-25 diagnostic

Do **not** use receipt
`sha256:2b5c36cb24117325349487ecd8fec801ba927b78a29a097e933cfa3b2924eaf9`
as current readiness evidence. Its source section completed the full immutable
12-file verification, but its machine section contains two false unavailable
observations from an earlier collector revision: the minimal probe environment
omitted the derived Windows `ProgramFiles` locator required by NVML, and the
LCC version parser did not account for the installation's single UTF-8 BOM.

The corrected source-free collector probe observes one RTX 4090 (24,564 MiB,
driver 596.49, compute capability 8.9) and the hash-bound LCC installation
(internal version `0.15.0.7`). The corrected machine evaluator remains blocked
only by:

- `RAM_128_GIB_REQUIRED`;
- `SCRATCH_500_GIB_FREE_REQUIRED`;
- `SCRATCH_EMPTY_DIRECTORY_REQUIRED`;
- `LCC_2_3_OR_NEWER_REVIEW_REQUIRED`.

## Corrected combined receipt — 2026-08-25

A later isolated run did re-read the complete 41.3 GB source after the
collector fixes and produced one valid combined blocked receipt:

`sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a`

It confirms the canonical inventory digest above, the observed RTX 4090, the
hash-bound LCC installation, and exactly these blockers:

- `RAM_128_GIB_REQUIRED`;
- `SCRATCH_500_GIB_FREE_REQUIRED`;
- `SCRATCH_EMPTY_DIRECTORY_REQUIRED`;
- `LCC_2_3_OR_NEWER_REVIEW_REQUIRED`.

The observed scratch locator was a non-empty healthy NTFS/NVMe directory with
only 11,938,496,512 bytes free. It was used only for a non-mutating eligibility
probe; it is not a scratch-drive recommendation. The receipt records no source
writes, network access, LCC launch, reconstruction process, training/runtime
authority, staging authority, or publication authority.
