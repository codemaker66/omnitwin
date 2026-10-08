# The relight package (venviewer.relight.v1)

Built offline by `tools/relight` (plan R1a) and read by the browser (plan R1b). One package per served splat model,
immutable once published: `splats/<venue>/<room>/relight/v<N>/`. Spec: `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md`.

Revised 7 October (consolidated): the sky bodies' bounce is the factored basis R1a Task 4 committed (the Sun and the
Moon; it replaces the sunlit-area table, β and `skyFlux`); the capture light is R1a Task 4b's house-light refit, with a
colour per lamp group; records carry R1c's class 7 and toggles; package v2 adds R1c's `skins` and `visibility`; every
file is built from an exact, hash-checked artifact. Revised 8 October (seam review): the flags byte's toggles for
classes 3 and 6, the display's floor area, `createdAt` from the build commit, `evidence.wallFaceRate`, the evidence
keys R1a's `check` adds, and the `artifacts` keys.

## Files

| Path | Content |
|---|---|
| `manifest.json` | Everything below, plus a SHA-256 for every other file |
| `tiles/<tile stem>.relight.gz` | gzip of `count × 12` bytes, one record per splat in the tile's own order |
| `probes.bin.gz` | gzip of float16 little-endian `[probe][source 0..8][channel r,g,b][face +x,−x,+y,−y,+z,−z]` |
| `probe-valid.bin.gz` | gzip of one byte per probe: 1 valid, 0 invalid (outside the hall) |
| `windows/<id>.alpha.gz` | gzip of the window's occupancy volume: `nx × ny × nz` bytes, `round(α × 255)`, x-major C order (byte `(i·ny + j)·nz + k` is cell (i, j, k)); the frame says where it sits (below) |
| `sky/basis.bin.gz` | gzip of float16 little-endian `[k 0..K−1][probe of the basis grid][channel r,g,b][face +x,−x,+y,−y,+z,−z]`: the K unit-field basis volumes on the 1 m grid (`sky.grid`), each scaled to its largest absolute value |
| `sky/basis-valid.bin.gz` | gzip of one byte per basis-grid probe: 1 valid, 0 invalid |
| `sky/coefficients.bin.gz` | gzip of float32 little-endian `[row][column][window W1..W5][k]`: each direction node's coefficients of R_w (already multiplied by each volume's scale); every node a real direction's lookup reads is filled |
| `sky/patch-rays.bin.gz` | gzip of float32 little-endian `[ray][x, y, z]`: the room patches' 16 sub-sample ray origins, sub-sample-major (row `count·k + p`, `k = 4a + b`) |
| `sky/patch-normals.bin.gz` | gzip of float32 little-endian `[patch][x, y, z]` |
| `sky/patch-areas.bin.gz` | gzip of float32 little-endian `[patch]`, m² |
| `floor/light-0.png` … `light-2.png` | RGBA8 log-coded direct light of the nine sources on the floor grid (0: W1–W4, 1: W5, cove, ch_end, ch_centre, 2: dome, unused ×3) |
| `skins/<id>.light.gz` | Package v2 (R1c): one skin's light texels as 12-byte records (R1a's layout, row-major, the skins' own ranges `skins.encoding`), gzip |

The package folder holds exactly these files: the build reads each work artifact by its exact name and only when its
SHA-256 equals the one its evidence JSON records (R1a Tasks 4c and 5), and the folder is checked against `files` before
it is published (R1a Task 7).

## Record (12 bytes per splat)

| Bytes | Meaning |
|---|---|
| 0–8 | Direct light of W1, W2, W3, W4, W5, cove, ch_end, ch_centre, dome: log code, 0 = zero, 1..255 = `2^(lo + (code − 1)(hi − lo)/254)` with the source's `lo`, `hi` from `encoding.sources` |
| 9–10 | Surface normal in the model frame, octahedral: `u = byte9/255·2 − 1`, `v = byte10/255·2 − 1` |
| 11 | Flags: bits 0–2 class (0 interior, 1 embrasure, 2 hidden, 3 chandelier bulb, 4 dome lamp, 5 cove strip, 6 chandelier fixture, 7 covered by a skin); bit 3 isotropic receiver; bit 4 reachable by a sky body (R1a `windows.sun_reach`: some real sun or moon can light the splat through some window; analytic and conservative, occupancy ignored; the band covers the Moon's declination to 28.75° and parallax to 1.03°); for classes 3 and 6, bit 5 chandelier group centre (else end); for class 7, bits 5–7 its wall group (0 door wall, 1 window wall, 2 end_xmin, 3 end_xmax, 4 ceiling; 7 reserved); for every class but 7, bits 6–7 its toggle (0 none, 1 loose clutter, 2 AV cabinet; bit 5 stays the chandelier group for classes 3 and 6). A class-7 flags byte is never 0xff. |

## Manifest (fields)

- `schema`: `"venviewer.relight.v1"`; `room`; `createdAt`; `tool` (the repo commit that built it, `git rev-parse HEAD`). `createdAt` is that commit's committer time (`git log -1 --format=%cI`), never the wall clock, so a rebuild at the same commit is byte-identical.
- `model`: `{ frame: "e57", tileToModel: 4×4 row-major }`.
- `site`: `{ latitude, longitude, north: [x,y,z], east: [x,y,z], up: [0,0,1] }` in the model frame.
- `sources`: the nine names in record order.
- `encoding`: `{ record: 12, sources: [[lo, hi] × 9], floor: [[lo, hi] × 9], multiplier: { lo: -4, hi: 3 } }`.
- `capture`: `{ weights: [9], colours: [[r,g,b] × 9], daylightColour: [r,g,b], skyBandWeights: [0.15, 0.66, 1.0, 1.21], gamma: 1 }`. From R1a Task 4b's refit: `ch_centre / ch_end` is the chandeliers' lamp-count ratio (one per-bulb intensity for every chandelier lamp), and the cove, the chandeliers (`ch_end`, `ch_centre`) and the dome each have their own colour.
- `lamps`: `{ groups: { cove, ch_end, ch_centre, dome }, measuredRatio: [r,g,b], refit: { perBulbIntensity, lampRatio, bulbTableSha256 } }`. Each group is `{ source, colour: [r,g,b], type }`: `source` the record index (5, 6, 7, 8); `colour` the group's lamp/daylight colour at full level, `capture.colours[source] / capture.daylightColour` per channel (a package value per group, never a constant: the 2,700–2,800 K figure is not established); `type` the installer's record (`"led-tape"`, `"candle-unconfirmed"`, `"led-spot"`), information only. `measuredRatio` is the capture's measured lamp/daylight ratio (`lamp_daylight_ratio.json`). How a group's colour changes as it dims is a setting of the browser (R1b's `RelightSetting.lampTints`; R1d's warm-down), never a package value.
- `sun`: `{ fresnel: [101 values for |cos| 0.00..1.00] }` (the glass transmission, for both sky bodies).
- `sky`: the sky bodies' bounce (R1a Task 4 as built; section "The sky bodies' bounce" below): `{ k, bodies: ["sun", "moon"], grid: { origin: [x,y,z], spacing, shape: [nx, ny, nz] }, basis, valid, table: { azimuth0, elevation0, step, size: [columns, rows], file }, patches: { count, subsamples: 16, rays, normals, areas }, floorMean: [[r,g,b] × k] }`. `k` is read from the data (30 on 7 October), never assumed; `basis`, `valid`, `table.file`, `patches.rays`, `normals` and `areas` name the `sky/` files; the grid is the 1 m grid `(22, 11, 7)` whose origin is the probes' origin (its probes are the even probes of the 0.5 m grid); the table's nodes are whole degrees (`azimuth0` 24, `elevation0` −2, `step` 4, 79 × 18 on 7 October).
- `windows`: per window, in order W1..W5, `{ id, frame: [21 numbers], volume: "windows/<id>.alpha.gz", horizon: [360 elevations in degrees, by compass azimuth 0..359] }`. The frame is R1a `windows.FRAME_FIELDS` (below). Every window's `x_bearing` matches `site.north` (`north = (cos x_bearing, sin x_bearing, 0)`).
- `probes`: `{ origin: [x,y,z], spacing: number, shape: [nx, ny, nz], file, validFile }` (axis-aligned in the model frame).
- `floor`: `{ skin: "floor-skin/v2", texelToModel: 4×4 row-major, texel: 0.05, size: [w, h], files: [3] }`.
- `tiles`: `[{ tile, tileSha256, level, count, file, sha256, bytes }]` for every served tile.
- `presetsFromProof`: the three proof scenarios' settings (night, sunny morning 31 May 09:00 BST, overcast noon), as `05_relight.SCENARIOS` defines them.
- `evidence`: `{ capturedIdentity, proofRegression, transfer, determinism, sunCheck, skyBounce, skyBounceCheck, wallFaceRate, refit, artifacts, build }`. The build writes `sunCheck`, `skyBounce`, `refit`, `artifacts` and `build`; R1a's `check` adds the other six to the package it checks, the only keys it writes there. `skyBounce` is the bake's gate (K, its rule, the selection, check and strict draws' worst bright directions); `skyBounceCheck` the package's check 5; `wallFaceRate` `{ splats, marched, wallFace }`, how many of the marched sky-body rays of 200,000 seeded splats have a first sample that float32 rounding alone could put in the other cell at a window's wall face (R1b caps the GPU's rounding excuses at twice `wallFace / marched`); `refit` the house-light refit's acceptance; `artifacts` `{ name: sha256 }` of every work artifact the build read, each key the artifact's path relative to the bake's work folder with `/` separators (`probes-coarse.npz`, `skin-light/index.json`, …); `build` the options it was built with.
- `files`: `{ <path>: { sha256, bytes } }` for every file except the manifest.
- `skins` (package v2, optional; R1c): `{ package, manifestSha256, encoding, groups, entries }`.
  - `package`: the skin package's folder beside the tiles (`"skins/v1"`); `manifestSha256` pins its manifest.
  - `encoding`: the skins' log ranges per source.
  - `groups`: `["door", "window", "end_xmin", "end_xmax", "ceiling"]`, the record wall groups 0–4.
  - `entries[]`: `{ id, group, size: [w, h], texelToModel (16, row-major: (column, row, 0, 1) ↦ the light texel's centre,
    2 cm in front of its bay), normal, file, sha256, bytes, sun: { size, texelToModel } | null }`. `sun` is the skin's 2 cm
    sun grid, 5 mm in front of its bay, named only when some of its texels can be reached by the sun or the moon
    (`windows.sun_reach`).
- `visibility` (package v2, optional; R1c): `{ toggles: { clutter: 1, cabinet: 2 }, defaultHidden }`, the toggles'
  record values and those hidden by default as bits `1 << (toggle − 1)` (1: the loose clutter hidden, the cabinet shown).

## Window volumes and the sun

Each window keeps the part of the embrasure occupancy (3 cm cells) that a sun ray through it can sample. The runtime
marches a sky body's ray through it exactly as R1a's `windows.sun_visibility` does (the twin of the proof's
`lt.trace_to_windows`, `lt.march`, `lt.horizon_deg` and `lt.sun_direct`; normative text: the R1a plan's section "The
multiplier" and its Task 3 "As built (3 October)" note). The Moon's ray is marched exactly as the Sun's, with its own
direction, gates and glass.

**The frame** (`windows[].frame`, float64 values in this order):

| Index | Field | Meaning |
|---|---|---|
| 0–2 | `origin_x`, `origin_y`, `origin_z` | Model-frame corner of cell (0, 0, 0): `grid_lo + offset × res` |
| 3 | `res` | Cell size in metres (0.03), the same for every window |
| 4–6 | `nx`, `ny`, `nz` | The volume's shape (whole numbers); the volume file holds `nx·ny·nz` bytes |
| 7–8 | `x0`, `x1` | The outline's sides (model x) |
| 9 | `depth` | The glass plane is `y = y0 − depth` |
| 10–11 | `sill`, `top` | The outline's bottom and top (model z; the apex for an arch) |
| 12 | `arch` | 1: a semicircular head of radius `(x1 − x0)/2`; 0: a rectangle |
| 13 | `y0` | The wall's inner face (model y); the room is `y > y0` |
| 14 | `x_bearing` | Compass bearing (degrees) of the model's +x axis |
| 15–17 | `offset_x`, `offset_y`, `offset_z` | This volume's cell (0, 0, 0) in the occupancy grid (whole numbers) |
| 18–20 | `grid_lo_x`, `grid_lo_y`, `grid_lo_z` | The occupancy grid's corner (float32 values), the same for every window (all five are cut from one grid); cells are counted from it |

**Constants:** step 0.015 m; cap 2.2 m; the march ends 0.07 m beyond the glass; it stops once the optical depth
reaches 6; a room ray enters inside the outline grown by −0.05 m; every ray leaves through the glass inside the
outline grown by −0.03 m; a point in the embrasure belongs to a window within 0.25 m of its sides and skips its
own first 0.045 m; the body must satisfy `σy < −0.001`; alpha is clamped at 0.995.

**A sky body's visibility V at a point P** (σ the unit vector toward the Sun or the Moon; P, σ and every operation below
in float32, in this order; a constant such as `y0 − depth − 0.07` is computed in float64 and rounded once):

1. The windows are tried in order W1..W5. The first that claims the ray owns it, even when it leaves it dark.
   A room point (`P.y > y0`): `tq = (y0 − P.y)/σy`, `Q = P + σ·tq`; claimed when Q's x and z are inside the
   outline grown by −0.05 m; the march starts at `t = 0`. A point in the embrasure (`P.y ≤ y0`): `Q = P`;
   claimed when `x0 − 0.25 < P.x < x1 + 0.25`; the march starts at `t = 0.045`.
2. The owner's horizon gate (below) must be open, else V = 0.
3. `L = max(0, (Q.y − (y0 − depth − 0.07))/(−σy))`; V = 0 if `L > 2.2`. (The cap includes the 7 cm beyond the
   glass: it is the distance from the wall-face crossing Q to the march's end plane, `windows.py:174,177`.)
4. `tg = (P.y − (y0 − depth))/(−σy)`, `G = P + σ·tg`; V = 0 unless G's x and z are inside the outline grown
   by −0.03 m.
5. March: `τ = 0`; while `t < L` and `τ < 6`: the sample `Q + σ·t` falls in cell
   `floor((sample − grid_lo)/res) − offset` per axis; inside the volume, `τ += D[alpha]`; outside, nothing;
   then `t += 0.015`. `D[q] = float32(−ln(1 − min(q/255, 0.995))) × float32(0.015/res)` (0.5 for 3 cm cells).
6. `V = exp(−τ) × F`, with F the glass transmission (below) rounded to float32.

**The outline test** at (x, z), grown by g: with `x0' = x0 − g`, `x1' = x1 + g`, `z0' = sill − g`,
`z1' = top + g`, inside when `x0' < x < x1'` and `z0' < z < z1'`; an arch also needs `z ≤ zs` or
`(x − xc)² + (z − zs)² < r²`, where `r = (x1' − x0')/2`, `xc = (x0' + x1')/2` and `zs = z1' − r`.

**The horizon gate** of window w: from the float32 direction, in float64, the compass azimuth
`az = (x_bearing − degrees(atan2(σy, σx))) mod 360` (a floored modulo) and the elevation
`el = degrees(asin(σz))`; with `i = min(floor(az), 359)` and `f = az − i`,
`h = horizon[i]·(1 − f) + horizon[min(i + 1, 359)]·f`. The gate is open while `el > h`. (The proof's profile is
linear between whole degrees, so this reproduces `lt.horizon_deg`.)

**The glass transmission:** `c = 100·min(|σy|, 1)` formed in float64 from the float32 `σy` widened,
`i = min(floor(c), 99)`, `f = c − i`, `F = fresnel[i]·(1 − f) + fresnel[i + 1]·f` computed in float64 from the widened
float32 table entries, then rounded to float32 (`windows.py:238-243, 290`).

## The sky bodies' bounce

R1a Task 4 as built (`tools/relight/relight/sunbounce.py`; the Task 4 report's "Data layout and the browser's contract,
factored model", K 30 on 7 October). For each window w and sky body direction σ, the bounce of a white unit light is
`B_w(σ) = P_w(σ) × R_w(σ)`. `P_w` is the power the room's patches receive through window w; it switches on and off
within a few degrees of direction, so it is computed exactly at every light change and never interpolated. `R_w` is the
window's bounce per unit power; it varies smoothly, and the K basis volumes and the 4° coefficient table carry it. The
Sun and the Moon use the same table and basis (the bounce is per unit irradiance; only the direction matters).

**P_w(σ)** (`sunbounce.window_power`, built on `windows.sun_visibility_by_window`), in m² per unit irradiance on a plane
facing the body, the glass transmission and the horizon gate included:

1. σ is the unit vector toward the body, model frame, rounded to float32. If `σy ≥ −0.001` every `P_w` is 0.
2. March each of the `16 × count` rays (origin from `sky/patch-rays`, direction σ) as a sky body's ray above (steps 1,
   3, 4 and 5, float32, the proof's order of operations): the first window in order W1..W5 that claims the ray takes it,
   and a claimed ray is never offered to a later window, whether or not it survives. A surviving ray keeps
   `T = exp(−τ)`; every other ray has `T = 0`.
3. Multiply T by the glass transmission F (above): F is rounded to float32 and the product is a float32 product.
4. `lit_{w,p} = (T_{w,p} + T_{w,count+p} + … + T_{w,15·count+p}) / 16`, accumulated in float32 in that order.
5. `P_w = Σ_p area_p × lit_{w,p} × max(N_p · σ, 0)`, in float64 (the float32 values widened).
6. Horizon gate: `P_w = 0` while the body is at or below window w's horizon (the gate above).

Cost: 56,448 rays per light change through the same march the browser runs per splat.

**The coefficients** (`sunbounce.coefficients`): with `(az, el)` the body's compass azimuth and elevation (the gate's
formulas, from the float32 direction), `x = (az − azimuth0)/step` and `y = (el − elevation0)/step`, clamped to
`[0, columns − 1]` and `[0, rows − 1]`; `i = min(floor(x), columns − 2)`, `j = min(floor(y), rows − 2)`, `fx = x − i`,
`fy = y − j`; the corners in the order (j, i), (j, i + 1), (j + 1, i), (j + 1, i + 1) with weights `(1 − fx)(1 − fy)`,
`fx(1 − fy)`, `(1 − fx)fy`, `fx·fy` (`windows.sun_corners`). Then, in float64, `c_k = Σ` over the corners in that order,
then over the windows W1..W5 with `P_w > 0` in order, of `(weight × P_w) × coefficients[j][i][w][k]` (the float32
coefficients widened). No horizon gate touches the table: `P_w` holds it.

**The bounce at the probes.** On the basis grid, `S1[q] = Σ_body bodyRGB ⊙ Σ_k c_k(σ_body) × basis[k][q]` (float16
widened), per channel and face. Each probe of the 0.5 m volume reads `S1` trilinearly
(`sunbounce.trilinear_matrix`): `f = (probe − grid.origin)/grid.spacing`, `i0 = clip(floor(f), 0, shape − 2)`,
`t = clip(f − i0, 0, 1)` per axis; the eight corners `(i0 + d)`, `d ∈ {0, 1}³` in x, y, z order, index
`(ix·ny + iy)·nz + iz`, weight the product of `t` or `1 − t` per axis times the corner's validity; the weights
renormalised by their sum when it exceeds 1e-6, else none. The result joins the scenario probe volume exactly as the
nine sources' bounce does (the browser folds it in; R1b Task 10), so a splat, the floor and a skin evaluate it with the
same trilinear lookup over the 0.5 m probes and the same ambient-cube evaluation as the nine sources' bounce.

**The display.** The direct power reaching the room's surfaces is `Σ_w P_w(σ)`; the display's direct term is
`Σ_w P_w × bodyRGB / floor area`, where the floor area is the floor light maps' extent, `floor.size[0] × floor.size[1] ×
floor.texel²` (424 × 212 × 0.05² = 224.72 m² for the Grand Hall; R1b's `floorArea`). The floor's mean bounce is `Σ_k c_k floorMean[k] ⊙ bodyRGB`. At K 30 the floor-mean
bounce has median 9.3% (selection) and 10.0% (check) relative error, larger on faint directions.

**Known limit** (accepted 4 October): the proof's patch sampling (16 sub-sample rays per 0.5 m patch, a 12.5 cm pitch)
aliases at oblique suns (azimuth about 155° and beyond); `P_w` and the reference bounce carry that sampling, while the
3 cm area march `windows.sunlit_area` is the finer physical estimate, kept as the reference to revisit.

## The multiplier

Normative text: `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`, section "The multiplier".
Executable definition: `tools/relight/relight/reference.py`. The browser packs it per splat as a 32-bit word:
bits 0–7, 8–15 and 16–23 are the log codes of R, G and B over `[2^-4, 2^3]` (0 = zero); bits 24–31 are alpha.
