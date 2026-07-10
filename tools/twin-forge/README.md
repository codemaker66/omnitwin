# twin-forge

Offline pipeline for **Venviewer Twin** bundles (`twin/0`). Converts a
Matterport/Leica E57 capture's derived assets into the bundle the twin viewer
streams: WebP tiles at the mode's LOD ladder (equirect: 512 preview, 4096
base, 8192 zoom tier), a schema-validated manifest, a K-nearest-neighbour nav
graph, and SHA-256 content hashes (D-014 bundle shape).

Two imagery modes:

- **equirect** (current, 2026-07-04): one seamless WORLD-frame
  equirectangular pano per node from `e57-scripts/extract_equirect.py`
  (run against the E57 workspace). No per-face table, no cube seams — the
  scan_050 rotated-wall failure class is structurally impossible.
- **cube-faces** (legacy): six face JPGs per node. Kept so older bundles
  keep forging and rendering.

Spec: `docs/superpowers/specs/2026-07-02-twin-program-design.md`
Plan: `docs/superpowers/plans/2026-07-02-twin-phase1-walk.md`

## Inputs

| Input | Shape |
| --- | --- |
| `--equirects <dir>` | `scan_NNN.jpg` (4096×2048 base) **and** `scan_NNN_8192.jpg` (8192×4096 supersampled zoom source), both from `extract_equirect_v2.py`. Mutually exclusive with `--cubemaps`; every declared pair must exist |
| `--cubemaps <dir>` | `scan_NNN_{front,back,left,right,up,down}.jpg` (square faces; legacy mode) |
| `--poses <file>` | JSON `{ "<index>": { rotation: [w,x,y,z], translation: [x,y,z] } }` — E57 frame, Z-up, metres |
| `--overrides <file>` | `{ "add": [["scan_a","scan_b"], …], "remove": [...] }` — reviewed, hand-edited nav corrections (doorways and the only permitted cross-floor/stair links). Committed per venue under `nav-overrides/` |
| `--mesh <file>` | Source dollhouse GLB. Indexed triangles are oriented toward the nearest E57 capture position before compression so exterior viewpoints retain the interior face; its optimized output must be no larger than the hard 8 MiB publishing budget |

## Verified-stage reconstruction inputs

Do not run the E57 helper scripts against the mutable historical `F:\E57`
workspace. `extract_e57_poses.py` reads the immutable capture stage, can re-hash
the full E57, and writes a new candidate-only evidence pack outside that stage:

```powershell
python -B tools/twin-forge/e57-scripts/extract_e57_poses.py `
  --stage "F:\VenviewerCaptureStaging\trades-hall-2026-07-10" `
  --out "F:\VenviewerReconstructionWork\trades-hall-2026-07-10\staged-e57-poses" `
  --verify-source-hash `
  --compare-manifest "packages\web\public\twin\trades-hall\manifest.json"
```

`extract_equirect_v2.py` no longer has source or output defaults. It requires
`--stage`, a disjoint `--out`, and a `venviewer.lidar-truth-panos.v1` manifest
whose provenance status is exactly `regenerated_from_staged_e57`. The excluded
historical `F:\E57\panoramas` and old basis reports cannot silently become
truth. A deterministic staged-E57 lidar-pano generator and its manifest are a
required gate before another equirect render.

The staged MatterPak OBJ may be converted only as an internal reference/fallback
candidate. This verifies every referenced source hash, preserves and
round-trips bounds, and rejects a non-byte-deterministic Blender export:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" `
  --background --factory-startup `
  --python "tools\twin-forge\e57-scripts\build_matterpak_glb_candidate.py" -- `
  --stage "F:\VenviewerCaptureStaging\trades-hall-2026-07-10" `
  --out "F:\VenviewerReconstructionWork\trades-hall-2026-07-10\matterpak-glb-reference"
```

This candidate remains `matterpak_original`, unsigned, unreviewed, and outside
Twin Forge publication. It is not the D-024 deterministic E57 room shell and
does not satisfy a TransformArtifactV0 or T-091 gate.

## Run (Trades Hall, equirect)

```powershell
pnpm --filter @omnitwin/twin-forge forge `
  --equirects "F:\VenviewerReconstructionWork\trades-hall-2026-07-10\equirect" `
  --poses "F:\VenviewerReconstructionWork\trades-hall-2026-07-10\staged-e57-poses\poses.json" `
  --out "C:\Users\blake\omnitwin2\packages\web\public\twin\trades-hall" `
  --venue trades-hall --name "Trades Hall Glasgow" `
  --overrides "C:\Users\blake\omnitwin2\tools\twin-forge\nav-overrides\trades-hall.json" `
  --mesh "F:\downloads (some very important)\mp_matterpak_TH_T9pXgB4ygNf\trades-hall-web.glb"
```

Paths must be **absolute** (the CLI runs with the package as cwd). Each run is a
fresh, isolated build: all source files are preflighted before conversion, the
complete bundle is built in a sibling staging directory, and only an exact,
hash-verified bundle is promoted. Re-forging an existing target replaces it by
directory rename; an input, conversion, budget, or integrity failure leaves the
previous published bundle untouched and exits non-zero.
The 149-node Trades Hall pose set classifies as 65 lower-ground scans (floor
`-1`) and 84 ground-floor scans (floor `0`), producing 349 automatic edges and
zero cross-floor edges. A complete equirect build contains 447 tiles (3
LODs/node), manifest `imagery: "equirect"`, and lods `[512, 4096, 8192]`.
(The 2026-07-02 cube reference run was 1,788 tiles / 136 MB.)

The output directory is **gitignored** (`packages/web/public/twin/`) — bundles
are data, not source. The dev server serves it at `/twin/<venue>/…`, which is
the viewer's default asset base.

When only pose-derived floors/navigation or reviewed overrides change, refresh
the complete existing bundle without recompressing imagery. This still copies
to staging, recomputes every SHA-256, verifies the exact file set and mesh byte
count, then uses the same atomic promotion path:

```powershell
pnpm --filter @omnitwin/twin-forge forge --refresh-manifest `
  --poses "F:\VenviewerReconstructionWork\trades-hall-2026-07-10\staged-e57-poses\poses.json" `
  --out "C:\Users\blake\omnitwin2\packages\web\public\twin\trades-hall" `
  --overrides "C:\Users\blake\omnitwin2\tools\twin-forge\nav-overrides\trades-hall.json"
```

When the verified imagery is unchanged but the MatterPak fallback mesh needs a
presentation repair, rebuild only that mesh through the same isolated staging,
hash verification, byte-budget, and atomic promotion path:

```powershell
pnpm --filter @omnitwin/twin-forge forge --refresh-mesh `
  --poses "F:\VenviewerReconstructionWork\trades-hall-2026-07-10\staged-e57-poses\poses.json" `
  --out "C:\Users\blake\omnitwin2\packages\web\public\twin\trades-hall" `
  --overrides "C:\Users\blake\omnitwin2\tools\twin-forge\nav-overrides\trades-hall.json" `
  --mesh "F:\downloads (some very important)\mp_matterpak_TH_T9pXgB4ygNf\trades-hall-web.glb"
```

`--refresh-mesh` preserves the existing tile bytes, re-derives navigation from
the supplied canonical poses, regenerates `mesh/dollhouse.glb`, and recomputes
all `contentHashes`. The MatterPak output remains a presentation/reference
fallback under D-024; this repair does not make it an E57-derived room shell or
close T-091/T-118.

## Publishing to production (Cloudflare R2)

Decision of record: R2 (zero egress). One-time setup Blake does in the
Cloudflare dashboard: create bucket `venviewer-twin`, attach the public custom
domain `twin.venviewer.com`, create an R2 API token (Object Read & Write,
scoped to the bucket).

Then, per venue publish (rclone shown; any S3-compatible tool works):

```powershell
# ~/.config/rclone/rclone.conf → [r2] type=s3, provider=Cloudflare,
#   access_key_id/secret_access_key from the R2 token,
#   endpoint=https://<account-id>.r2.cloudflarestorage.com
rclone copy "C:\Users\blake\omnitwin2\packages\web\public\twin" r2:venviewer-twin --progress
```

Finally set the Vercel production env `VITE_TWIN_ASSET_BASE=https://twin.venviewer.com`
and redeploy. Until then, production's `/venues/<venue>/twin` renders the
graceful "twin is being prepared" state by design.

## Guarantees & gotchas

- The manifest is `TwinManifestSchema`-validated at build time; the viewer
  re-validates at load (`safeParse` — a bad bundle degrades to an error state,
  never a crash).
- Poses stay in the **E57 capture frame**; all basis conversion lives in
  `packages/web/src/twin/twin-basis.ts` (see its pinned tests before touching
  anything coordinate-shaped — and read `F:\…\E57\CLAUDE.md` §4).
- The nav graph is geometry-only (same-floor KNN, ≤8 m). Lower-ground scans
  retain negative floor indices; the forge never creates a cross-floor edge.
  Doorway/stairwell links require an explicit reviewed `add` in the per-venue
  overrides file. Unknown, self-referential, or contradictory overrides fail.
- `contentHashes` covers exactly every non-manifest bundle file. Missing files,
  unexpected files, digest mismatches, and a mesh byte-count mismatch all block
  promotion. Formal signing joins the existing
  AssetVersion registration flow in a later phase (D-014).
- Existing non-empty output directories are replaceable only when they contain
  a schema-valid twin manifest for the same venue and no files outside that
  manifest's namespace. Missing bundle files are repairable; unexpected files
  block replacement. This prevents a typo in `--out` from recursively deleting
  unrelated operator data.
