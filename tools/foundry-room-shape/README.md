# Foundry Room-Shape Proposer

Local, authority-none geometry proposer for a cached oriented point cloud. It
enumerates and refits room-boundary planes, measures only complete opposing
surface pairs, and can refuse when the capture does not support an honest
four-wall result.

It does **not** approve a room envelope, compare against advertised dimensions,
crop a cloud or produce a mesh. The current output is not directly importable
as the Potree-specific `omnitwin.foundry.room-envelope-review.v0` artifact; a
human-review adapter is still required.

## Input contract

- little-endian binary PLY;
- exactly one vertex element;
- six `double` properties in order: `x y z nx ny nz`;
- text file with one `x y z` scanner origin per row; and
- optional SHA-256 binding to the upstream ingest manifest file.

Inputs are read-only. No network is used.

## Measure and freeze

```powershell
py -3.12 tools/foundry-room-shape/measure_room_shape_cli.py `
  --cloud C:\path\cloud.ply `
  --origins C:\path\origins.txt `
  --label "capture-scope-label" `
  --manifest-sha256 <64-lowercase-hex> `
  --out-dir C:\path\output `
  --name room-shape-proposal `
  --diagnostics
```

Outputs:

- deterministic proposal JSON (no wall clock);
- run receipt binding the proposal file, input identities, parameters and
  optional diagnostic;
- optional deterministic top-view SVG.

## Verify

```powershell
py -3.12 tools/foundry-room-shape/verify_room_shape_run.py `
  C:\path\output\room-shape-proposal-receipt.json `
  --cloud C:\path\cloud.ply `
  --origins C:\path\origins.txt
```

Passing byte integrity returns `PASS_ROOM_SHAPE_RUN_INTEGRITY`. That statement
does not endorse the geometry; inspect `state`, `refusals`, `limitations` and
the human-review status.

## Compare only after a complete measurement

```powershell
py -3.12 tools/foundry-room-shape/compare_room_shape_to_published.py `
  C:\path\output\room-shape-proposal.json `
  --room grand_hall
```

The comparison independently verifies the proposal digest. If the proposal is
`unmeasurable`, it makes no dimensional comparison.

## Tests

```powershell
py -3.12 -m unittest discover `
  -s tools/foundry-room-shape/tests `
  -p "test_*.py" -v
```

The 2026-08-04 V1 baseline is 40/40 focused tests. Real Grand Hall evidence and
the exact refusal are recorded in
`docs/reports/grand-hall-room-shape-proposer-v1-2026-08-04.md`.
