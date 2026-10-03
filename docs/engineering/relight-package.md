# The relight package (venviewer.relight.v1)

Built offline by `tools/relight` (plan R1a) and read by the browser (plan R1b). One package per served splat model,
immutable once published: `splats/<venue>/<room>/relight/v<N>/`. Spec: `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md`.

## Files

| Path | Content |
|---|---|
| `manifest.json` | Everything below, plus a SHA-256 for every other file |
| `tiles/<tile stem>.relight.gz` | gzip of `count × 12` bytes, one record per splat in the tile's own order |
| `probes.bin.gz` | gzip of float16 little-endian `[probe][source 0..8][channel r,g,b][face +x,−x,+y,−y,+z,−z]` |
| `probe-valid.bin.gz` | gzip of one byte per probe: 1 valid, 0 invalid (outside the hall) |
| `windows/<id>.alpha.gz` | gzip of the window's occupancy volume: `nx × ny × nz` bytes, `round(α × 255)`, x-major C order (byte `(i·ny + j)·nz + k` is cell (i, j, k)); the frame says where it sits (below) |
| `windows/sun-area.bin.gz` | gzip of float32 little-endian `[window W1..W5][row 0..rows−1][column 0..columns−1]`: each window's sunlit glass area in m² (the glass lit through the embrasure, times the cosine to the wall normal) for a sun at compass azimuth `azimuth0 + column` and elevation `elevation0 + row`, whole degrees; 0 at nodes no real sun's lookup reads |
| `floor/light-0.png` … `light-2.png` | RGBA8 log-coded direct light of the nine sources on the floor grid (0: W1–W4, 1: W5, cove, ch_end, ch_centre, 2: dome, unused ×3) |

## Record (12 bytes per splat)

| Bytes | Meaning |
|---|---|
| 0–8 | Direct light of W1, W2, W3, W4, W5, cove, ch_end, ch_centre, dome: log code, 0 = zero, 1..255 = `2^(lo + (code − 1)(hi − lo)/254)` with the source's `lo`, `hi` from `encoding.sources` |
| 9–10 | Surface normal in the model frame, octahedral: `u = byte9/255·2 − 1`, `v = byte10/255·2 − 1` |
| 11 | Flags: bits 0–2 class (0 interior, 1 embrasure, 2 hidden, 3 chandelier bulb, 4 dome lamp, 5 cove strip, 6 chandelier fixture); bit 3 isotropic receiver; bit 4 reachable by the sun (R1a `windows.sun_reach`: some real sun can light the splat through some window; analytic and conservative, occupancy ignored); bit 5 chandelier group centre (else end) |

## Manifest (fields)

- `schema`: `"venviewer.relight.v1"`; `room`; `createdAt`; `tool` (the repo commit that built it).
- `model`: `{ frame: "e57", tileToModel: 4×4 row-major }`.
- `site`: `{ latitude, longitude, north: [x,y,z], east: [x,y,z], up: [0,0,1] }` in the model frame.
- `sources`: the nine names in record order.
- `encoding`: `{ record: 12, sources: [[lo, hi] × 9], floor: [[lo, hi] × 9], multiplier: { lo: -4, hi: 3 } }`.
- `capture`: `{ weights: [9], colours: [[r,g,b] × 9], daylightColour: [r,g,b], skyBandWeights: [0.15, 0.66, 1.0, 1.21], gamma: 1 }`.
- `lamps`: `{ measuredColour: [r,g,b], cct: number, groups: { cove: 5, ch_end: 6, ch_centre: 7, dome: 8 } }` (the source index of each lamp group).
- `sun`: `{ bounce: { beta: number, skyFlux: [5] }, fresnel: [101 values for |cos| 0.00..1.00], area: { file: "windows/sun-area.bin.gz", azimuth0, elevation0, size: [columns, rows] } }`. `azimuth0` and `elevation0` are whole degrees; the grid is the reach test's sun band at the site's latitude (R1a `windows.sun_area_nodes`), so every real sun's four corner nodes are inside it.
- `windows`: per window, in order W1..W5, `{ id, frame: [21 numbers], volume: "windows/<id>.alpha.gz", horizon: [360 elevations in degrees, by compass azimuth 0..359] }`. The frame is R1a `windows.FRAME_FIELDS` (below). Every window's `x_bearing` matches `site.north` (`north = (cos x_bearing, sin x_bearing, 0)`).
- `probes`: `{ origin: [x,y,z], spacing: number, shape: [nx, ny, nz], file, validFile }` (axis-aligned in the model frame).
- `floor`: `{ skin: "floor-skin/v2", texelToModel: 4×4 row-major, texel: 0.05, size: [w, h], files: [3] }`.
- `tiles`: `[{ tile, tileSha256, level, count, file, sha256, bytes }]` for every served tile.
- `presetsFromProof`: the three proof scenarios' settings (night, sunny morning 31 May 09:00 BST, overcast noon), as `05_relight.SCENARIOS` defines them.
- `evidence`: `{ capturedIdentity, proofRegression, transfer, determinism, sunCheck, sunBounce, sunArea }`.
- `files`: `{ <path>: { sha256, bytes } }` for every file except the manifest.

## Window volumes and the sun

Each window keeps the part of the embrasure occupancy (3 cm cells) that a sun ray through it can sample. The runtime
marches the sun's ray through it exactly as R1a's `windows.sun_visibility` does (the twin of the proof's
`lt.trace_to_windows`, `lt.march`, `lt.horizon_deg` and `lt.sun_direct`; normative text: the R1a plan's section "The
multiplier" and its Task 3 "As built (3 October)" note).

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
own first 0.045 m; the sun must satisfy `σy < −0.001`; alpha is clamped at 0.995.

**The sun's visibility V at a point P** (σ the unit vector toward the sun; P, σ and every operation below in
float32, in this order; a constant such as `y0 − depth − 0.07` is computed in float64 and rounded once):

1. The windows are tried in order W1..W5. The first that claims the ray owns it, even when it leaves it dark.
   A room point (`P.y > y0`): `tq = (y0 − P.y)/σy`, `Q = P + σ·tq`; claimed when Q's x and z are inside the
   outline grown by −0.05 m; the march starts at `t = 0`. A point in the embrasure (`P.y ≤ y0`): `Q = P`;
   claimed when `x0 − 0.25 < P.x < x1 + 0.25`; the march starts at `t = 0.045`.
2. The owner's horizon gate (below) must be open, else V = 0.
3. `L = max(0, (Q.y − (y0 − depth − 0.07))/(−σy))`; V = 0 if `L > 2.2`.
4. `tg = (P.y − (y0 − depth))/(−σy)`, `G = P + σ·tg`; V = 0 unless G's x and z are inside the outline grown
   by −0.03 m.
5. March: `τ = 0`; while `t < L` and `τ < 6`: the sample `Q + σ·t` falls in cell
   `floor((sample − grid_lo)/res) − offset` per axis; inside the volume, `τ += D[alpha]`; outside, nothing;
   then `t += 0.015`. `D[q] = float32(−ln(1 − min(q/255, 0.995))) × float32(0.015/res)` (0.5 for 3 cm cells).
6. `V = exp(−τ) × F`, with F the glass transmission (below) rounded to float32.

**The outline test** at (x, z), grown by g: with `x0' = x0 − g`, `x1' = x1 + g`, `z0' = sill − g`,
`z1' = top + g`, inside when `x0' < x < x1'` and `z0' < z < z1'`; an arch also needs `z ≤ zs` or
`(x − xc)² + (z − zs)² < r²`, where `r = (x1' − x0')/2`, `xc = (x0' + x1')/2` and `zs = z1' − r`.

**The horizon gate** of window w: from the float32 sun, in float64, the compass azimuth
`az = (x_bearing − degrees(atan2(σy, σx))) mod 360` (a floored modulo) and the elevation
`el = degrees(asin(σz))`; with `i = min(floor(az), 359)` and `f = az − i`,
`h = horizon[i]·(1 − f) + horizon[min(i + 1, 359)]·f`. The gate is open while `el > h`. (The proof's profile is
linear between whole degrees, so this reproduces `lt.horizon_deg`.)

**The glass transmission:** `c = 100·min(|σy|, 1)`, `i = min(floor(c), 99)`, `f = c − i`,
`F = fresnel[i]·(1 − f) + fresnel[i + 1]·f`.

**The sunlit glass area** of window w (for the sun's bounce): 0 unless `σy < −0.001` and the gate is open;
otherwise the area table bilinearly interpolated at the same `az` and `el`: `x = az − azimuth0` and
`y = el − elevation0`, each clamped to `[0, columns − 1]` and `[0, rows − 1]`; `i = min(floor(x), columns − 2)`,
`j = min(floor(y), rows − 2)`, `fx = x − i`, `fy = y − j`;
`v0 = A[j][i](1 − fx) + A[j][i + 1]fx`, `v1 = A[j + 1][i](1 − fx) + A[j + 1][i + 1]fx`, area `v0(1 − fy) + v1·fy`.

## The multiplier

Normative text: `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`, section "The multiplier".
Executable definition: `tools/relight/relight/reference.py`. The browser packs it per splat as a 32-bit word:
bits 0–7, 8–15 and 16–23 are the log codes of R, G and B over `[2^-4, 2^3]` (0 = zero); bits 24–31 are alpha.
