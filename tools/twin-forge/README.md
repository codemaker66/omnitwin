# twin-forge

Offline pipeline for **Venviewer Twin** bundles (`twin/0`). Converts a
Matterport/Leica E57 capture's derived assets into the bundle the twin viewer
streams: WebP tiles at two LODs, a schema-validated manifest, a K-nearest-
neighbour nav graph, and SHA-256 content hashes (D-014 bundle shape).

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
| `--equirects <dir>` | `scan_NNN.jpg` (2048×1024 world-frame equirects from `extract_equirect.py`). Presence selects equirect mode and REPLACES `--cubemaps` |
| `--cubemaps <dir>` | `scan_NNN_{front,back,left,right,up,down}.jpg` (square faces; legacy mode) |
| `--poses <file>` | JSON `{ "<index>": { rotation: [w,x,y,z], translation: [x,y,z] } }` — E57 frame, Z-up, metres |
| `--overrides <file>` | `{ "add": [["scan_a","scan_b"], …], "remove": [...] }` — hand-edited nav corrections (doorways, stairwells). Committed per venue under `nav-overrides/` |

## Run (Trades Hall, equirect)

```powershell
pnpm --filter @omnitwin/twin-forge forge `
  --equirects "F:\E57\equirect" `
  --poses "F:\E57\poses.json" `
  --out "C:\Users\blake\omnitwin2\packages\web\public\twin\trades-hall" `
  --venue trades-hall --name "Trades Hall Glasgow" `
  --overrides "C:\Users\blake\omnitwin2\tools\twin-forge\nav-overrides\trades-hall.json" `
  --mesh "F:\downloads (some very important)\mp_matterpak_TH_T9pXgB4ygNf\trades-hall-web.glb"
```

Paths must be **absolute** (the CLI runs with the package as cwd). Idempotent:
existing tiles are skipped, so re-runs after adding scans only pay for new work.
2026-07-04 equirect reference run: 149 nodes, 357 edges, 298 tiles, 43 MB,
0 missing, manifest `imagery: "equirect"`, lods `[512, 2048]`.
(2026-07-02 cube reference run was 1,788 tiles / 136 MB.)

The output directory is **gitignored** (`packages/web/public/twin/`) — bundles
are data, not source. The dev server serves it at `/twin/<venue>/…`, which is
the viewer's default asset base.

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
- The nav graph is geometry-only (same-floor KNN, ≤8 m). Doorway/stairwell
  sense lives in the per-venue overrides file — edit it, re-run the forge
  (cheap: tiles all skip), reload.
- `contentHashes` covers every bundle file; formal signing joins the existing
  AssetVersion registration flow in a later phase (D-014).
