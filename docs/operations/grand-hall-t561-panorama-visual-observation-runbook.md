# Grand Hall T-561 all-source panorama visual-observation runbook

Date: 2026-08-26
Task: T-561
Status: authority-none source observation pack generated and exact-check passed; native-grid human review remains pending

## Purpose and hard boundary

This workflow binds all 148 supplied panorama JPEG identities to the agent's
display-resolution visual observations. It exists because the preserved T-554
v1 50/98 split omitted 24 source files in which Grand Hall pixels were later
observed.

The source JPEGs are 8192x4096. The Codex image surface displayed them at
2048x1024 and may have resampled them. This workflow therefore records
`nativeResolutionHumanReviewCompleted=false`. Its rectangles are conservative
attention aids, never masks. Every record remains human-pending and has
`authority: none`; none may be used for training, reconstruction, runtime,
staging, publication, or production trust.

No API key, cloud provider, generative model, upload, deployment, or source
mutation is used by this workflow.

Frozen local implementation and reviewed-run commit:
`ff4910064c296cae75958aeb9fb05aa820b90635`. The real zero-write check was
rerun from that exact commit and passed.

## Bound inputs

- Exact supplied panorama root:
  `F:\downloads (some very important)\TH Panoramic`
- Immutable T-554 panorama evidence:
  `docs/operations/grand-hall-t554-review-pack/panoramas`
- Sealed observation input:
  `docs/operations/grand-hall-t561-panorama-visual-observations-input-authority-none.json`
- Panorama inventory self-digest:
  `sha256:949f4cbf365f33d47c5e75f46b881aff857695fbbb70879e27c4f23f4b2af176`
- T-554 panorama manifest digest:
  `sha256:2c8b44ef2cd840fddc3f0a49e82b73fff37b33f1d546126ed941029c1cb52b86`
- Observation-input serialized-file SHA-256:
  `9b196214bab065ce353019797f81134ec782bf71cf9d9b203851911ae774f297`
- Observation-set self-digest:
  `sha256:d235821e4251f2e849f99f387950803a1095102c7a11f3c4052fd42a647bbdb2`

The exact inventory contains sweep numbers 001-092 and 094-149. Sweep 093 is
absent. The anomalous source names for 099, 145, 148, and 149 remain bound to
their exact bytes rather than normalized or renamed.

## Author the sealed observation input

Run from the repository root in PowerShell. The output must not already exist:

```powershell
$repo = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$panoramas = 'F:\downloads (some very important)\TH Panoramic'
$observations = Join-Path $repo 'docs\operations\grand-hall-t561-panorama-visual-observations-input-authority-none.json'

pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t561-author-observation-input -- --panorama-root $panoramas --output $observations
```

The completed real run reported 148 present sources, 74 with Grand Hall pixels
observed, 74 with no Grand Hall pixels observed, zero agent uncertainty flags,
and authority `none`.

## Generate the disjoint local evidence pack

The real output root was intentionally outside both the source and repository:

```powershell
$repo = 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime'
$panoramas = 'F:\downloads (some very important)\TH Panoramic'
$t554PanoramaPack = Join-Path $repo 'docs\operations\grand-hall-t554-review-pack\panoramas'
$observations = Join-Path $repo 'docs\operations\grand-hall-t561-panorama-visual-observations-input-authority-none.json'
$output = 'D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1'

pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t561-panorama-visual-observation -- --panorama-root $panoramas --t554-panorama-pack $t554PanoramaPack --observations $observations --output $output
```

The no-replace, receipt-last build produced 72 files and 307,663,539 bytes:
70 review-only PNG aids, one observation manifest, and one publication receipt.
Its result was:

- source records: 148;
- review aids: 70;
- output files: 72;
- manifest self-digest:
  `sha256:87aa9cdb7a0a731832928586a4106806ae175ec17e559dd530bfe66d32934c83`;
- manifest serialized-file SHA-256:
  `6234491aeb52c39dbd230cb4268c62637c16fd35d664ece129f536e85d75eb1f`;
- receipt self-digest:
  `sha256:63f606bbe2a1e39fcf4c0f291c08571e4663e819da82cbbdd7ed845cc993b03c`;
- receipt serialized-file SHA-256:
  `bebdfc93eee8b6a99c7d9a67b5c3f3c8661e2cbc4df86712b7df86ba8e7260ed`.

The self-digests cover each schema's canonical material and intentionally
differ from the hash of the final serialized file that contains the self-digest.

## Exact zero-write check

Run the same command with `--check` against the completed output:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t561-panorama-visual-observation -- --panorama-root $panoramas --t554-panorama-pack $t554PanoramaPack --observations $observations --output $output --check
```

The independent real check returned `checked_exact_regeneration` with the same
148 records, 70 review aids, 72 files, manifest and receipt self-digests, plus
`exactRegenerationVerified=true`. It reconstructs the expected bytes and
rejects a changed source, input, manifest, review aid, receipt, missing file,
extra file, alias, symlink, unsafe path, decode failure, or source drift.

## Human next step

Do not convert these observations into `INCLUDE` or `EXCLUDE` automatically.
The next authorized reviewer must inspect every exact 8192x4096 JPEG, decide
all 148 source dispositions, and draw/review an exact binary native-grid mask
for every included source. The separately versioned T-554 v2 review surface
must also resolve MatterPak room 9, `Window`, `Mirror`, all eight interfaces,
and the closed selection volume before any source becomes reconstruction input.

The separately versioned unified human-pending successor is now generated and
exact-check verified. Continue with
[`grand-hall-t554-review-pack-v2-runbook.md`](./grand-hall-t554-review-pack-v2-runbook.md);
do not return to the preserved v1 acceptance path.
