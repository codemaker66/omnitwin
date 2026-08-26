# Grand Hall T-554 cleanup-marker evidence v2 runbook

> **STOP — v1 is superseded for audit only.** Preserve the v1 local pack and
> repository receipt byte-for-byte, but do not use their claim that the literal
> Mirror groups were localized outside the selected room. A different source
> room key and separate vertex indices do not establish physical exclusion from
> the Grand Hall or prove a visible marker effect.

Date: 2026-08-26
Task: T-554 cleanup-marker source inventory
Status: additive authority-none v2 pack generated and exact-regeneration checked

## Scope and limits

The v2 pack binds the exact reviewed capture-stage manifest, MatterPak OBJ, MTL,
README, and room-9 source-boundary evidence. It enumerates all five literal
`mirror*` OBJ groups and pins their face ordinals, face records, vertex indices,
materials, and bounds. It does not claim that those groups are physically
outside the Grand Hall, that a marker effect is visible, or that cleanup should
occur. Window metadata remains inconclusive. Human native-source review, every
cleanup decision, and any face removal remain pending and unauthorized.

## Generate the additive v2 pack

Run from the repository root in PowerShell. The v2 output must be absent. Never
point this command at the immutable v1 directory.

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-cleanup-marker-evidence-v2 -- --stage 'F:\VenviewerCaptureStaging\trades-hall-2026-07-10' --source-boundary-evidence 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-room9-source-boundary-evidence-v1.json' --output 'D:\venviewer-evidence\grand-hall-t554-cleanup-marker-evidence-v2'
```

The real no-replace, receipt-last build produced exactly two flat files:

- `cleanup-marker-evidence-v2.json` — 14,432 bytes; file SHA-256
  `fdd884eda9aa6cbd423cb1e6051ec70df2c9291aebd0d65d165886f8c0725777`;
- `publication-receipt-v2.json` — 1,571 bytes; file SHA-256
  `ef3a90633e91801c77304190d067b025ef93b44ea1c3d1c1f90a045ecb0dadaa`.

Evidence semantic SHA-256:
`sha256:f3caf357bc50c67b235c0fa27b310ee4c4591f9718f1e0072ed4fa4b40af1424`.
Cleanup-target inventory SHA-256:
`sha256:ae65274bbf649b35f4c0e559858c61d85fcb3b80e80028530990073a666b1518`.
Receipt semantic SHA-256:
`sha256:394473d6a989b520de601fdb9c3e7a779e2476df02fd681f1933f648fac135c3`.
The exact small receipt is preserved in
[`grand-hall-t554-cleanup-marker-evidence-v2.json`](./grand-hall-t554-cleanup-marker-evidence-v2.json).

## Exact zero-write check

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-cleanup-marker-evidence-v2 -- --check --stage 'F:\VenviewerCaptureStaging\trades-hall-2026-07-10' --source-boundary-evidence 'C:\Users\blake\omnitwin2-grand-hall-exact-runtime\docs\operations\grand-hall-room9-source-boundary-evidence-v1.json' --output 'D:\venviewer-evidence\grand-hall-t554-cleanup-marker-evidence-v2'
```

The real check returned `checked_exact_regeneration` with
`exactRegenerationVerified=true`. Independent before/after length, modification
time, and file-hash inventories were identical, confirming zero writes.
