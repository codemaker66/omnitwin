# Set-down acoustics: the offline ray tracer (T-700)

The planner's set-down sound rings with each room's echo. That echo comes from Eyring's formula with air absorption, multiplied per band by a calibration (`packages/web/src/lib/set-down/room-acoustics.ts`, `rooms.ts`). This folder holds the independent check on that model: a ray tracer.

**What it checks, and what it does not** (ruling R50). Each room is traced as a box with the model's volume and surface areas (the Grand Hall with a spherical cap of the scanned dome's volume), with the model's own absorption. So the check tests Eyring's diffuse-field assumption: how far a room of that volume, those areas and that absorption departs from the formula. It does not test the absorption data, and it does not test the rooms' real outlines. The data are checked separately, against measured rooms ([Plausibility](#plausibility-against-measured-rooms-ruling-r51)).

The tracer proves itself on textbook cases first. Then it traces each room empty, half laid and fully laid for the reference dinner. The calibration factors in `rooms.ts` are **fitted on empty**, so the model meets the tracer there by construction. `calibration.test.ts` holds it **within 15 % half and fully laid**, and holds its change with fullness within 15 % of the tracer's.

| File | What it is |
|---|---|
| `raytrace.py` | The tracer (numpy only), with its self-test. |
| `rooms.json` | The rooms as the model has them, exported from `rooms.ts` and `room-acoustics.ts`. |
| `results.json` | The tracer's T20 per band for each room and dressing, its fits' r², a second seed, and a record of the run (`trace`: the sha256 of the rooms.json it read and of the raytrace.py that ran, its batch size and numpy). |

## Running it

1. **Export the rooms.** From `packages/web`:

   ```
   EXPORT=1 pnpm exec vitest run src/lib/set-down/__tests__/export-rooms.test.ts
   ```

   The exporter (`src/lib/set-down/__tests__/export-rooms.test.ts`, building on `tracer-export.ts`) writes `rooms.json` here only when `EXPORT=1`. It lives under `src/` because packages/web's vitest only includes `src/**`.

2. **Trace.** From this folder, with `python`. Use plain `python`, not `python -I`, wherever numpy is a user site-package.

   ```
   python raytrace.py --selftest
   python -u raytrace.py rooms.json results.json
   ```

   Heavy CPU results are double-run on the build PC, where silent corruption has happened before: trace twice, into two files, and keep the result only if the two are byte-identical. The seeds are fixed, so a sound computation repeats itself to the bit.

3. **Fit.** Write the factors the run prints (`calibration (tracer empty / Eyring empty)`) into `TRACER_CALIBRATION` in `rooms.ts`.

4. **Check.** From `packages/web`:

   ```
   pnpm exec vitest run src/lib/set-down
   ```

**On the Trades Hall build PC only**, which is short of memory and shared with GPU gates:

- Wrap step 1 and step 4 as `bash D:/claude/gpu-queue/heavy-hold.sh "<session> <what>" <command>`.
- Before step 2, wait for memory with `bash D:/claude/furniture-rebuild-20261026/tools/wait-memory.sh 2048 1024 1`.
- Add `--pause-while D:/claude/planner-polish-20261018/quiet` to the trace, so that it waits between batches while a gate runs.

None of these exist elsewhere, and none is needed elsewhere.

- Every run does the self-test first and stops if any check fails. It reads the 8 kHz air attenuation from rooms.json (by default the one beside raytrace.py).
- The tracer works in batches of 50,000 rays. Measured on the build PC: a peak working set of 63 MB and a peak commit of 84 MB.
  - The low commit comes from holding numpy's OpenBLAS to one thread, which the tracer does before importing numpy.
  - Unpinned, OpenBLAS reserved about 0.5 GB of commit at import for its 16 threads.
  - The traces are identical either way. Two of results.json's traces were rerun pinned and matched it bit for bit, and so did a small trace run twice (log: `D:/claude/furniture-sound-20261027/task7/bit-for-bit.txt`).
- The full run takes about 40 minutes of tracing on that PC, most of it in the galleries (about 3.5 minutes a trace at 2,000,000 rays).
- results.json is written only if every check passes: the self-test, the dome check, the seed agreement, and a T20 fit in every band.

## Provenance: which rooms, and which tracer, a trace is of (rulings R38 and R50)

The chain from the model to the factors is checked at every link, so a stale file fails a test instead of passing quietly.

- **The export.** `export-rooms.test.ts` always compares the committed rooms.json, value for value, with the export the model gives now. A changed room fails it until rooms.json is re-exported.
- **The trace.** results.json's `trace.roomsSha256` is the sha256 of the rooms.json the tracer read, and `trace.raytraceSha256` that of the raytrace.py that ran. Both are hashed with CRLF line ends read as LF, so a Windows checkout and a Linux one hash alike, and both are taken before tracing starts. `calibration.test.ts` checks each against the committed file. A re-export without a retrace fails it, and so does any edit to raytrace.py, its comments included, until the rooms are retraced.
- **The fit.** `room-acoustics.test.ts` checks that the factors in `rooms.ts` equal the fit from results.json.

The 28 October trace ran before the tracer recorded its metadata, and a one-off `--stamp` step (c75a1076) added its rooms.json hash afterwards. The 13 November retrace records everything itself, so the step and its code are gone.

## What it traces

### The rooms as boxes

Each room is a box (a prism of a rectangle). Its height is the model's volume (less the Grand Hall's dome) over the floor's area, so the box keeps the model's volume exactly, and its floor, ceiling and wall areas are the model's too. Its outline is not the room's.

| Room | Prism (length x width x height) | Rule |
|---|---|---|
| Grand Hall | 21.135 x 10.590 x 6.700 m, plus the dome | its plan |
| Saloon | 11.800 x 7.100 x 5.600 m | its plan |
| Robert Adam Room | 22.927 x 6.106 x 2.705 m | two-part room |
| Reception Room | 14.138 x 7.073 x 2.890 m | two-part room |
| North and South Galleries | 11.500 x 4.100 x 2.800 m | its plan |

**The two-part rooms.**

- The Reception Room's traced L becomes a rectangle of equal area (100 m²) that also keeps the L's perimeter, so its wall area stays the model's.
- The Robert Adam Room's two sections (11.2 x 7.6 m under a 3.03 m mean ceiling, open to 9.8 x 5.6 x 2.2 m) are treated the same way. `ROOM_PLANS` holds only the main part of each of these rooms, and a prism of that part alone would lose about a quarter of the Robert Adam Room's surface.
- So the rectangle has the floor's area (140 m²) and the walls' perimeter.
- In both rooms, volume, floor, ceiling and wall areas are the model's.
- What is lost is each room's real outline: the arm of the L, and the step between the Adam Room's two ceilings.

**The Grand Hall's dome** is a spherical cap over the ceiling's opening (ruling R28), in place of the plan's older cylinder and hemisphere:

- Its base radius is √(opening ÷ π) = 3.3200 m, in the ceiling plane over the hall's centre.
- Its height, 2.4495 m, is solved so that the cap's volume (πh/6)(3a² + h²) equals the scanned dome's 50.105 m³. The sphere's radius is then 3.4747 m.
- **Dome check:** the cap's area π(a² + h²) is 53.477 m² against the scanned inner surface's 54.435 m², **−1.76 %** (limit 3 %).
- The ceiling plane is open inside the base circle. A ray reaching it there goes on into the cap and comes back down through the same opening.

### Materials

- **The floor, the ceiling plane and the dome** each take their own material's α. The dome is the surface `rooms.ts` marks `dome: true`; since 13 November it takes the plaster-on-lath row like the coffered ceiling round it (EST: no source gives its construction; ruling R49).
- **The walls are one mixture.** Every wall and opening material (panelling, plaster, glazing, doors, and the hung curtains, sheers and drapes) is spread over all four walls, by area share.
  - The mixture is the walls' total absorption divided by the prism's wall area.
  - The model counts hung fabric on top of the wall it hangs in front of, so this keeps the model's absorption exactly.
  - It is an acknowledged simplification: a curtain's absorption is spread round the room, not concentrated at its window.
- **Contents.** For the half and full dressings, the contents' absorption area is added to the floor: α_floor = (A_floor + A_contents) ÷ S_floor, capped at 0.99.
  - The contents are `contentsAbsorption` of `referenceDinner(slug)` (dressed) and of its first ceil(n/2) items (half, the listening page's 50 %).
  - Furniture is therefore floor absorption, never an obstacle in a ray's path.
- **Air.** Air loss is exp(−m·d) along each path, with m from `AIR_ATTENUATION_PER_M`: the intensity coefficient that Eyring's 4mV term uses.

### Scattering

Reflection is hybrid: with probability s it is Lambertian (cosine-weighted about the normal), otherwise specular.

- s is 0.2 for every surface.
- The exception is the half- and fully-dressed floor, which takes **0.7 (EST)**. A floor laid with tables and chairs scatters like a seating zone, and 0.6–0.7 is the usual practice for audience areas, as in the ODEON manual. No measurement of a laid banquet floor was found.
- The coefficients do not vary with frequency. So each ray carries one energy per octave band along a single path, and each band still has its full count of rays.

## How it traces

- **Source.** Rays leave isotropically from a source at 0.3 of the width, 1.2 m up, 0.25 of the length.
- **Ray counts (ruling R31).**
  - 200,000 rays a band in the four big rooms.
  - 2,000,000 in the galleries, whose late decay rests on a few near-horizontal rays that miss the carpet for a long time. At 20,000 rays the galleries' T20 varied by up to 11 % from seed to seed.
  - The North and South Galleries are the same room in every exported figure. They are traced once and share the result, which results.json marks with `"sameRoomAs": "north-gallery"`.
- **Losses.** Each hit multiplies a ray's energy by (1 − α). A band stops at −70 dB of its start (air included); a ray stops when every band has, or at 6 s.
- **Receiver.** A sphere of radius 0.6 m at the room's centre, 1.2 m up.
  - Each pass leaves energy x chord ÷ sphere volume in the 1 ms bin of its arrival time, up to 6 s.
  - Every step also checks that no ray has left the room.
- **Decay.** Each band's histogram is Schroeder-integrated. T20 is the least-squares line through the −5 to −25 dB part of the curve, and its r² is recorded.
- **The double run** (the silent-corruption rule).
  - Every room is traced with seed 1 (empty, half, dressed), then empty and dressed again with seed 2.
  - Every band from 250 Hz to 8 kHz must agree within 3 %.
  - A disagreeing dressing is rerun once with both seeds, and each rerun is compared with its first run. The seeds are fixed, so a sound computation repeats itself to the bit.
  - A rerun that differs is reported as silent corruption. An identical rerun means the disagreement is the trace's own spread.
  - Either way the disagreement stands: the run fails and nothing is written.

## Self-test

`python raytrace.py --selftest` exits non-zero on any failure. Figures from the 13 November run that wrote results.json, the same to every printed digit as the 28 October self-test's (both of that day's runs printed them alike):

1. **Uniform diffuse cube** (10 m, α 0.2 on every face, s 1, no air, 20,000 rays).
   - T20 1.2489 s against Eyring's 0.161V ÷ (−S ln(1 − α)) = 1.2025 s: **+3.86 %** (limit 5 %). r² 0.99927 (limit 0.99).
   - Against Kuttruff's Eyring, corrected for the spread of free paths, 0.161V ÷ (−S ln(1 − α)(1 + γ² ln(1 − α) ÷ 2)) = 1.2506 s: **−0.14 %** (limit 2 %, ruling R40).
   - γ² = 0.3449 is the cube's own, sampled independently of the tracer from 1,000,000 Lambertian chords. Their mean, 0.6666 of an edge, matches 4V/S.
2. **Air only** (10 m cube, α 0, s 0.2, m = 0.0242 1/m, rooms.json's 8 kHz value, 20,000 rays). T20 1.6586 s against 13.82 ÷ (c·m) = 1.6649 s: **−0.38 %** (limit 3 %). r² 0.99992.
3. **No loss at all** (10 m cube, α 0, no air, s 0.2, 400,000 rays). Every one of the 59 windows of 100 ms from 50 ms to 6 s is within **2.36 %** of their mean (limit 5 %). The mean is −0.07 % from the uniform-field value N·c·Δt ÷ V (limit 2 %).
4. **The Grand Hall's box and dome, no loss** (400,000 rays).
   - Windows within **2.46 %** (limit 5 %). The mean is −0.01 % from N·c·Δt ÷ V, with V including the cap.
   - The share of path inside the dome is 3.220 % against the dome's 3.233 % of the volume (−0.40 %, limit 2 %).
   - No ray left the room.
5. **Checks 1 and 2 in one two-band trace**, as the rooms run (s 1, 20,000 rays).
   - Band A (α 0.2, no air): T20 1.2489 s, +3.86 % from Eyring and −0.14 % from Kuttruff.
   - Band B (α 0, 8 kHz air): T20 1.6700 s, **+0.31 %** from 13.82 ÷ (c·m).
   - One path carrying both bands reproduces each band's own answer.
6. **Symmetry** (10 m cube, source and receiver at mid-height, α 0.5 on one face only, s 0.2, 400,000 rays).
   - Absorbing floor: T20 3.1460 s. Absorbing ceiling: 3.1796 s. They are **1.07 % apart** (limit 3 %).
   - The received energy is 1.13 % apart (limit 4 %).
   - The two are mirror images, so any difference beyond noise would be a fault in the floor's or the ceiling's handling.

Checks 3, 4 and 6 use 400,000 rays. At 20,000, a 0.6 m receiver in a 1,000 m³ cube collects only about 780 passes per 100 ms window, a ±3.8 % (1σ) spread, so the 5 % bound would fail by chance. Checks 4 to 6 are additions: check 4 because checks 1–3 never pass through the dome; checks 5 and 6, and check 1's Kuttruff bound, by ruling R40.

## Calibration

For each room and band: calibration = tracer empty T20 ÷ Eyring empty (uncalibrated).

- The factor is clamped to 0.7–1.3 and rounded half up to 3 decimals.
- A band whose empty fit has r² < 0.95 keeps 1. None did.
- **125 Hz keeps 1 wherever the room's Schroeder frequency is above that octave's lower edge** (ruling R39).
  - The Schroeder frequency is 2000·√(T ÷ V), with T the empty trace's 125 Hz time. The octave's lower edge is 125 ÷ √2 = 88.4 Hz.
  - Below the Schroeder frequency a room's response is a set of separate modes, and rays say nothing about it.
  - Only the Grand Hall is big enough to keep its 125 Hz fit:

    | Room | Schroeder frequency (13 Nov trace) |
    |---|---|
    | Grand Hall | 61.2 Hz |
    | Saloon | 92.4 Hz |
    | Reception Room | 92.5 Hz |
    | North and South Galleries | 121.7 Hz |
    | Robert Adam Room | 124.5 Hz |

  - `fittedCalibration` (`tracer-results.ts`) and `calibration_factor` (`raytrace.py`) apply the same rule, and `calibration.test.ts` tests it.
  - In the tables below, the model's 125 Hz in those rooms is therefore Eyring's own figure: 3.6–8.8 % under the tracer, and 30 % under it in the Robert Adam Room, whose box is far from diffuse at 125 Hz (absorbing floor and ceiling between hard walls). The test does not hold that band.
- The factors are in `rooms.ts` (`TRACER_CALIBRATION`). `room-acoustics.test.ts` checks that they equal the fit from results.json.
- **Fitted on empty; within 15 % half and fully laid.** Because each factor is tracer empty ÷ Eyring empty, the empty model meets the tracer by construction: to the factor's rounding, under 0.1 %, wherever the clamp does not bind. `calibration.test.ts` says so in a test of its own. The real checks, 250 Hz to 8 kHz, are:
  - the model within 15 % of the tracer half and fully laid in every band, except the galleries' non-diffuse bands below;
  - its change with fullness, the model's half or dressed ÷ empty against the tracer's, within 15 % in every room and band, the galleries' included.

R29's second, dressed factor was not needed. With the empty calibration alone, the four big rooms' half and dressed states stay within 5.1 % of the tracer from 250 Hz to 8 kHz: the Robert Adam Room half laid at 250 Hz, every other within 1.9 % (tables below). R29 does not apply to the galleries (ruling R32).

T20 per octave band in seconds, from seed 1. "Model" is the planner's figure: uncalibrated Eyring times the calibration. Seed 2's empty and dressed traces sit under each table.

### Grand Hall

200,000 rays a band. Calibration: 1.067, 1.038, 1.023, 1.009, 1.008, 1.007, 1.006.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 1.453 | 1.760 | 2.144 | 2.536 | 2.465 | 1.924 | 1.036 |
| | model (s) | 1.453 | 1.761 | 2.144 | 2.535 | 2.466 | 1.925 | 1.036 |
| | model / tracer | -0.0 % | +0.0 % | +0.0 % | -0.0 % | +0.0 % | +0.0 % | +0.0 % |
| | Eyring, uncalibrated (s) | 1.361 | 1.697 | 2.096 | 2.512 | 2.446 | 1.912 | 1.030 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 1.402 | 1.673 | 1.941 | 2.154 | 2.055 | 1.661 | 0.955 |
| | model (s) | 1.410 | 1.677 | 1.928 | 2.144 | 2.044 | 1.658 | 0.953 |
| | model / tracer | +0.6 % | +0.2 % | -0.7 % | -0.4 % | -0.5 % | -0.2 % | -0.1 % |
| | Eyring, uncalibrated (s) | 1.322 | 1.615 | 1.885 | 2.125 | 2.028 | 1.646 | 0.948 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 1.371 | 1.608 | 1.782 | 1.882 | 1.766 | 1.466 | 0.885 |
| | model (s) | 1.370 | 1.599 | 1.749 | 1.853 | 1.740 | 1.452 | 0.881 |
| | model / tracer | -0.1 % | -0.5 % | -1.8 % | -1.5 % | -1.5 % | -1.0 % | -0.5 % |
| | Eyring, uncalibrated (s) | 1.284 | 1.541 | 1.710 | 1.837 | 1.726 | 1.442 | 0.876 |
| | r² | 0.9999 | 1.0000 | 1.0000 | 0.9999 | 1.0000 | 1.0000 | 0.9999 |
| empty, seed 2 | T20 (s) | 1.455 | 1.768 | 2.149 | 2.528 | 2.459 | 1.928 | 1.040 |
| | seed 2 / seed 1 | 0.12 % | 0.41 % | 0.23 % | 0.28 % | 0.26 % | 0.17 % | 0.32 % |
| dressed, seed 2 | T20 (s) | 1.369 | 1.613 | 1.782 | 1.879 | 1.766 | 1.471 | 0.876 |
| | seed 2 / seed 1 | 0.18 % | 0.27 % | 0.02 % | 0.16 % | 0.02 % | 0.32 % | 1.04 % |


### Saloon

200,000 rays a band. Calibration: 1.000, 1.024, 1.019, 1.012, 1.010, 1.006, 1.006.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 1.002 | 1.292 | 2.005 | 2.589 | 2.641 | 1.984 | 1.049 |
| | model (s) | 0.965 | 1.292 | 2.005 | 2.588 | 2.641 | 1.983 | 1.049 |
| | model / tracer | -3.7 % | +0.0 % | -0.0 % | -0.0 % | +0.0 % | -0.0 % | -0.0 % |
| | Eyring, uncalibrated (s) | 0.965 | 1.262 | 1.967 | 2.557 | 2.615 | 1.971 | 1.043 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 0.978 | 1.249 | 1.815 | 2.170 | 2.150 | 1.697 | 0.960 |
| | model (s) | 0.943 | 1.241 | 1.802 | 2.160 | 2.139 | 1.684 | 0.959 |
| | model / tracer | -3.5 % | -0.6 % | -0.8 % | -0.4 % | -0.5 % | -0.8 % | -0.1 % |
| | Eyring, uncalibrated (s) | 0.943 | 1.212 | 1.768 | 2.135 | 2.118 | 1.674 | 0.953 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 0.958 | 1.205 | 1.655 | 1.863 | 1.808 | 1.478 | 0.885 |
| | model (s) | 0.922 | 1.194 | 1.634 | 1.850 | 1.792 | 1.460 | 0.882 |
| | model / tracer | -3.8 % | -0.9 % | -1.3 % | -0.7 % | -0.9 % | -1.2 % | -0.4 % |
| | Eyring, uncalibrated (s) | 0.922 | 1.166 | 1.604 | 1.828 | 1.774 | 1.452 | 0.876 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| empty, seed 2 | T20 (s) | 1.001 | 1.295 | 2.011 | 2.587 | 2.638 | 1.988 | 1.049 |
| | seed 2 / seed 1 | 0.06 % | 0.26 % | 0.26 % | 0.06 % | 0.11 % | 0.23 % | 0.07 % |
| dressed, seed 2 | T20 (s) | 0.955 | 1.201 | 1.664 | 1.875 | 1.819 | 1.483 | 0.883 |
| | seed 2 / seed 1 | 0.40 % | 0.31 % | 0.53 % | 0.64 % | 0.62 % | 0.31 % | 0.23 % |


### Robert Adam Room

200,000 rays a band. Calibration: 1.000, 1.261, 1.156, 1.062, 1.049, 1.042, 1.026.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 1.466 | 1.683 | 1.782 | 2.132 | 1.990 | 1.582 | 0.900 |
| | model (s) | 1.021 | 1.683 | 1.782 | 2.133 | 1.991 | 1.582 | 0.900 |
| | model / tracer | -30.4 % | -0.0 % | -0.0 % | +0.0 % | +0.0 % | -0.0 % | +0.0 % |
| | Eyring, uncalibrated (s) | 1.021 | 1.334 | 1.541 | 2.008 | 1.898 | 1.518 | 0.878 |
| | r² | 0.9995 | 0.9998 | 0.9999 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 1.323 | 1.523 | 1.574 | 1.789 | 1.652 | 1.360 | 0.822 |
| | model (s) | 0.993 | 1.601 | 1.608 | 1.790 | 1.644 | 1.353 | 0.820 |
| | model / tracer | -25.0 % | +5.1 % | +2.1 % | +0.1 % | -0.5 % | -0.5 % | -0.2 % |
| | Eyring, uncalibrated (s) | 0.993 | 1.269 | 1.391 | 1.686 | 1.568 | 1.298 | 0.799 |
| | r² | 0.9993 | 0.9998 | 0.9999 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 1.296 | 1.475 | 1.468 | 1.578 | 1.440 | 1.210 | 0.761 |
| | model (s) | 0.966 | 1.526 | 1.464 | 1.540 | 1.397 | 1.179 | 0.751 |
| | model / tracer | -25.5 % | +3.5 % | -0.3 % | -2.4 % | -3.0 % | -2.5 % | -1.3 % |
| | Eyring, uncalibrated (s) | 0.966 | 1.210 | 1.266 | 1.450 | 1.332 | 1.132 | 0.732 |
| | r² | 0.9992 | 0.9996 | 0.9998 | 0.9999 | 0.9999 | 1.0000 | 1.0000 |
| empty, seed 2 | T20 (s) | 1.482 | 1.694 | 1.787 | 2.129 | 1.988 | 1.582 | 0.895 |
| | seed 2 / seed 1 | 1.05 % | 0.64 % | 0.27 % | 0.17 % | 0.12 % | 0.01 % | 0.59 % |
| dressed, seed 2 | T20 (s) | 1.323 | 1.493 | 1.482 | 1.587 | 1.448 | 1.215 | 0.762 |
| | seed 2 / seed 1 | 2.07 % | 1.22 % | 0.93 % | 0.54 % | 0.58 % | 0.45 % | 0.16 % |


### Reception Room

200,000 rays a band. Calibration: 1.000, 1.009, 1.000, 0.992, 0.991, 0.989, 0.987.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 0.619 | 1.197 | 1.053 | 0.931 | 0.757 | 0.629 | 0.480 |
| | model (s) | 0.597 | 1.197 | 1.053 | 0.931 | 0.757 | 0.629 | 0.480 |
| | model / tracer | -3.5 % | -0.0 % | +0.0 % | -0.0 % | +0.0 % | +0.0 % | +0.0 % |
| | Eyring, uncalibrated (s) | 0.597 | 1.186 | 1.053 | 0.938 | 0.764 | 0.636 | 0.486 |
| | r² | 0.9998 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 0.595 | 1.133 | 0.960 | 0.828 | 0.674 | 0.571 | 0.447 |
| | model (s) | 0.583 | 1.129 | 0.958 | 0.827 | 0.675 | 0.570 | 0.445 |
| | model / tracer | -2.0 % | -0.4 % | -0.2 % | -0.1 % | +0.1 % | -0.1 % | -0.6 % |
| | Eyring, uncalibrated (s) | 0.583 | 1.119 | 0.958 | 0.834 | 0.681 | 0.576 | 0.450 |
| | r² | 0.9999 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 0.584 | 1.078 | 0.883 | 0.746 | 0.612 | 0.525 | 0.419 |
| | model (s) | 0.570 | 1.069 | 0.877 | 0.743 | 0.607 | 0.520 | 0.413 |
| | model / tracer | -2.5 % | -0.8 % | -0.6 % | -0.3 % | -0.8 % | -0.9 % | -1.3 % |
| | Eyring, uncalibrated (s) | 0.570 | 1.059 | 0.877 | 0.749 | 0.613 | 0.526 | 0.419 |
| | r² | 0.9999 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| empty, seed 2 | T20 (s) | 0.615 | 1.194 | 1.050 | 0.929 | 0.754 | 0.627 | 0.481 |
| | seed 2 / seed 1 | 0.57 % | 0.28 % | 0.28 % | 0.26 % | 0.41 % | 0.29 % | 0.17 % |
| dressed, seed 2 | T20 (s) | 0.587 | 1.075 | 0.881 | 0.747 | 0.614 | 0.528 | 0.422 |
| | seed 2 / seed 1 | 0.50 % | 0.27 % | 0.15 % | 0.19 % | 0.38 % | 0.65 % | 0.69 % |


### North and South Galleries (one trace, results.json's `sameRoomAs`)

2,000,000 rays a band. Calibration: 1.000, 1.068, 1.198, 1.300, 1.300, 1.300, 1.300.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 0.489 | 1.097 | 1.000 | 0.840 | 0.674 | 0.575 | 0.427 |
| | model (s) | 0.446 | 1.096 | 1.000 | 0.785 | 0.559 | 0.491 | 0.412 |
| | model / tracer | -8.8 % | -0.0 % | +0.0 % | -6.5 % | -17.0 % | -14.6 % | -3.6 % |
| | Eyring, uncalibrated (s) | 0.446 | 1.026 | 0.835 | 0.604 | 0.430 | 0.378 | 0.317 |
| | r² | 0.9998 | 1.0000 | 0.9999 | 0.9994 | 0.9981 | 0.9982 | 0.9989 |
| half | tracer T20 (s) | 0.468 | 1.010 | 0.873 | 0.751 | 0.626 | 0.537 | 0.402 |
| | model (s) | 0.434 | 1.019 | 0.895 | 0.697 | 0.502 | 0.446 | 0.379 |
| | model / tracer | -7.3 % | +0.9 % | +2.5 % | -7.2 % | -19.8 % | -16.9 % | -5.7 % |
| | Eyring, uncalibrated (s) | 0.434 | 0.954 | 0.747 | 0.536 | 0.387 | 0.343 | 0.292 |
| | r² | 0.9999 | 1.0000 | 0.9999 | 0.9987 | 0.9970 | 0.9974 | 0.9987 |
| dressed | tracer T20 (s) | 0.459 | 0.952 | 0.820 | 0.726 | 0.614 | 0.529 | 0.401 |
| | model (s) | 0.423 | 0.951 | 0.808 | 0.626 | 0.455 | 0.407 | 0.351 |
| | model / tracer | -7.9 % | -0.1 % | -1.5 % | -13.8 % | -25.9 % | -23.0 % | -12.5 % |
| | Eyring, uncalibrated (s) | 0.423 | 0.890 | 0.674 | 0.482 | 0.350 | 0.313 | 0.270 |
| | r² | 0.9999 | 1.0000 | 0.9995 | 0.9976 | 0.9972 | 0.9976 | 0.9982 |
| empty, seed 2 | T20 (s) | 0.489 | 1.095 | 1.001 | 0.843 | 0.668 | 0.571 | 0.426 |
| | seed 2 / seed 1 | 0.08 % | 0.10 % | 0.12 % | 0.41 % | 0.91 % | 0.77 % | 0.23 % |
| dressed, seed 2 | T20 (s) | 0.460 | 0.952 | 0.819 | 0.728 | 0.625 | 0.536 | 0.400 |
| | seed 2 / seed 1 | 0.17 % | 0.02 % | 0.10 % | 0.25 % | 1.81 % | 1.44 % | 0.27 % |

## Difference explained: the galleries (GALLERY_NON_DIFFUSE)

In the North and South Galleries at 1, 2 and 4 kHz, the tracer reads far longer than Eyring.

| tracer ÷ uncalibrated Eyring | 1 kHz | 2 kHz | 4 kHz |
|---|---|---|---|
| empty | 1.391 | 1.567 | 1.522 |
| half | 1.400 | 1.621 | 1.565 |
| dressed | 1.509 | 1.753 | 1.688 |

The calibration stops at its 1.3 clamp, so in those bands the planner's model sits between Eyring and the tracer. Empty, it gives 0.785, 0.559 and 0.491 s against the tracer's 0.840, 0.674 and 0.575 s (−6.5, −17.0 and −14.6 %). Dressed, it gives 0.626, 0.455 and 0.407 s against 0.726, 0.614 and 0.529 s (−13.8, −25.9 and −23.0 %).

**The exception (ruling R32).** These nine bands (three bands in each of three dressings, in both galleries) are the named exception `GALLERY_NON_DIFFUSE` in `packages/web/src/lib/set-down/__tests__/calibration.test.ts`.

- There the test asserts that uncalibrated Eyring ≤ model ≤ tracer, instead of the 15 % bound.
- It also asserts that the list is exactly the gallery bands, 250 Hz to 4 kHz, whose tracer ÷ Eyring exceeds 1.3.
- **8 kHz is not in the exception** (ruling R40).
  - There the ratio is past 1.3 too (1.349 empty, 1.379 half, 1.485 dressed).
  - But air absorption carries that band, and the model stays within 15 % of the tracer (−3.6, −5.7 and −12.5 %).
  - So it keeps the 15 % bound.
- Every other room, band and dressing keeps the 15 % bound.
- The galleries' change with fullness is held within 15 % like every room's. The worst case is 10.6 % (dressed, 2 kHz): there the model shortens the echo with the dinner a little more than the tracer does (x0.814 against x0.911).
- R29's dressed factor is not applied to the galleries.

**Why the tracer reads so long.**

- Nearly all the galleries' absorption is the carpet: α 0.55–0.72 at 1–4 kHz, and up to 0.90 laid for dinner.
- It lies under hard plasterboard walls and ceiling (α 0.04–0.09), in a long, low room with parallel walls.
- Near-horizontal rays bounce between the walls and rarely reach the floor. The decay stops being a single exponential (r² drops to 0.997), and Eyring's assumption of a diffuse field fails.
- This is the textbook case. Fitzroy's formula for uneven absorption predicts about 0.91 s at 2 kHz for the empty gallery, against Eyring's 0.43 s and the tracer's 0.67 s.
- The tracer's figures are converged: 2,000,000 rays a band, and the two seeds agree within 1.81 %.

**Why the model does not follow the tracer all the way.** The tracer's prism is the galleries' worst case.

- The galleries are the 2003 attic fit-out, and the survey gives no section. A real attic's sloped ceiling, dormers and reveals would break up the horizontal flutter that a flat-ceilinged prism keeps alive.
- The tracer also treats furniture as floor absorption, never as an obstacle in a grazing ray's path.
- So in these bands the tracer's figure is an upper bound, not a measurement.
- The model stays at 1.3 times Eyring, inside the range the tracer allows.
- A measured T20 in a gallery (a balloon burst or a sweep, ISO 3382-1) would settle it.

## Plausibility against measured rooms (ruling R51)

No reverberation time has been measured in any Trades Hall room. So each room is set beside the nearest measured room found, in the state that room was measured in, with the model in the matching state where there is one. The rows whose states match are tested in `calibration.test.ts`. Where they cannot be matched, the gap is recorded in numbers. What stays uncertain is named for Blake's ear test at the end.

"Mid" is the mean of 500 Hz, 1 kHz and 2 kHz, as these papers report a room. The model's figures are the calibrated ones of the 13 November trace.

| Room | Comparator: source and state | The model, matching state | Tolerance | Verdict |
|---|---|---|---|---|
| Grand Hall, 1,550 m³ | **La Redoute, Bad Godesberg** (1790–92): 1,450 m³, 17.3 × 11.6 × 7.2 m, a polished stone floor, plastered masonry walls, a gypsum plaster ceiling. **Empty and unseated**: T30 3.5 / 3.2 / 2.9 s at 500 Hz / 1 kHz / 2 kHz, mid 3.2 s (Lorenz-Kierakiewitz, DAGA 2020, Table 1). | Empty: mid 2.38 s. | Below 3.2 s, because the hall's oak boards on joists, mahogany dado, half-panelled walls and velour curtains all absorb more than stone and plaster. Also inside the 2.0–3.8 s plausibility band on (500 Hz + 1 kHz) ÷ 2. **Tested.** | Holds. |
| | **Sanssouci, the marble hall** (1747): 1,150 m³, oval, Carrara marble and a stucco dome. **Two people present**: T30 mid 2.4 s (Lorenz-Kierakiewitz, DAS-DAGA 2025, Tables 1 and 2). | Empty: mid 2.38 s. | Not tested: harder finishes, a smaller room and a different state. | Consistent: a smaller, harder room measures about the hall's model. |
| Saloon, 469 m³ | **Schloss Benrath, the western and eastern Gartensaal** (mid-18th century): parquet floors and wood-panelled walls, preserved in almost their original state. **Unoccupied**: T30 2.4 and 2.5 s (Graef, Lorenz-Kierakiewitz, Pfändner and Wagner, DAGA 2018, Table 1). The table calls these the 125 Hz–4 kHz mean, but its Fig. 4 gives them as the 500 Hz–2 kHz mean (about 2.37 and 2.53 s, read off the figure), and its low bands fall to about 2.1 s at 250 Hz and 1.5 s at 125 Hz. The volume is not stated: its 1 kHz G (+22.9 and +23.2 dB by theory) and T30 put it near 400 m³ by the diffuse-field relation G = 10 lg(100/r² + 31200 T/V) at r = 10 m (inferred). | Empty: mid 2.41 s; 0.97 s at 125 Hz and 1.29 s at 250 Hz. The states match on occupancy only: the paper does not state what furniture the halls held. | Within 20 % of 2.45 s: about 5 % derived for the volumes ((469 ÷ 400)^(1/3) = 1.05, T growing as V^(1/3) in rooms of one shape and finish), plus 15 % allowed for finishes and furnishing that neither the paper nor the survey pins down. The model's first-trace figure (2.49 s) was known when this was set. **Tested.** | Holds in the mid band (2.41 s against 2.45 s, −1.6 %). Below 500 Hz the model is drier than Benrath's halls (1.29 against about 2.1 s at 250 Hz): named for the ear test. |
| | **Sanssouci, the concert room** (1747): 515 m³, 10.1 × 8.2 × 6.12 m, panelled, with mirrors, paintings in the walls, gilding, a chandelier, its original furnishings and a 2.2 m sisal runner. **Two people present**: T30 mid 1.25 s, EDT 1.3 s (DAS-DAGA 2025, Tables 1 and 2). | Empty: mid 2.41 s; laid for 60: 1.76 s. | The states cannot be matched: a furnished room with two people against an unpeopled one. Not tested; the gap is below. | A gap of 25.1 m² of absorption, explained below by furnishings the Saloon's model has no source for. |
| Robert Adam Room, 379 m³ | **The Franz-Marc-Raum, Kloster Benediktbeuern**: about 220 m³ (about 9.8 × 5.9 × 3.8 m), a wooden parquet floor, a stucco ceiling and smooth walls, with no significant sound-absorbing surfaces. **Set with chairs** for meetings (its photograph); occupancy not stated. T between about 1.5 and 1.9 s, rising towards low frequencies; no metric or standard stated (Späh, Zhou, Zhang and Neumann, DAGA 2023; translated). | Empty: mid 1.97 s; laid for 60: 1.47 s. | Not tested: the state, the metric and the bands are not given. | Consistent in order: a hard plastered room with a timber floor of about this size rings 1.5–2 s. The model's low bands now fall, where the comparator's rise. |
| Reception Room, 289 m³ | **Sanssouci, the audience room**: 315 m³, 10.1 × 5.4 × 6.16 m, upholstered textile wall coverings. **Two people present**: T30 mid 0.75 s (DAS-DAGA 2025, Tables 1 and 2). | Empty: mid 0.91 s; laid for 60: 0.74 s. | Not tested: textile walls against plasterboard, and a furnished room. | Consistent: the model is longer, as plasterboard walls absorb less than textile coverings. |
| North and South Galleries, 132 m³ each | **None found.** No measured, small, carpeted meeting room was found in the search below. | Empty: mid 0.78 s; laid for 40: 0.63 s. | — | Open. Their upper bands rest on the clamp (above); named for the ear test. |

### The Saloon against Sanssouci's concert room: the gap in numbers

Sanssouci's 1.25 s, by Eyring with air over 500 Hz–2 kHz, means a mean absorption coefficient of 0.151 over its 389.6 m² of surface: 58.7 m² of absorption. For the Saloon to ring 1.25 s, in its own 469.2 m³ and 379.2 m², it would need 53.7 m². The model has 28.6 m² empty and 39.0 m² laid for 60. The gap is 25.1 m² empty and 14.7 m² laid.

What could account for it:
- **Two people** add about 1 m² at those bands (the model's seated-adult row), and the sisal runner about as much again, by the paper's own estimate ("comparable to one to two persons extra").
- **Furnishings**: Sanssouci keeps its original furnishings. 25.1 m² is about 28 m² of heavy velour, or about 111 upholstered chairs (the model's row for one). The Saloon's survey records a chandelier, a needlework firescreen and backlit stained glass, and mentions no curtains or upholstery.
- **Panelling and paintings**: Rococo boiserie and canvas set in the walls can absorb more at mid frequencies than thick mahogany panels on battens. The model's panelling row (0.12 / 0.09 / 0.08) would need roughly doubling over the Saloon's 129 m² of panelling to close half the gap. No measurement supports either.

So the gap is Sanssouci's furnishings and fittings, as far as the data go: the unoccupied, panelled, parquet-floored Benrath halls of about the Saloon's size measure 2.4–2.5 s, as the model does.

### What stays uncertain, for Blake's ear test

- **The Saloon below 500 Hz.** The model gives 0.97 s at 125 Hz and 1.29 s at 250 Hz, against about 1.5 and 2.1 s read off Benrath's figure. If the empty Saloon's low echo sounds thin, the panelling row's 0.28 / 0.22 at 125 / 250 Hz (just under every cited row at 125 Hz) is the lever.
- **The empty Saloon's mid ring of about 2.4 s.** Benrath supports it; Sanssouci, furnished, is half of it. If the room sounds too live, the missing absorbers are furnishings the survey did not record.
- **The Robert Adam Room's low-mid ring (250 and 500 Hz).** The tracer reads its box 1.261 and 1.156 times Eyring there, so the factors lengthen those bands by 26 % and 16 %. They are kept (ruling R59), because an estimate independent of the tracer finds the same effect:
  - **Why.** The room's absorption sits on its floor and ceiling (mean α 0.130 at 250 Hz and 0.100 at 500 Hz) between hard plaster walls (0.041 and 0.056). That uneven spread is what Eyring's formula leaves out.
  - **The check.** Fitzroy's formula (1959) for absorption spread unevenly between the three pairs of opposite surfaces, applied to rooms.json's surfaces: floor and ceiling as one pair, and the walls' area and absorption split between the box's sides and ends as 2Lh : 2Wh. It gives Fitzroy ÷ Eyring = **1.365 at 250 Hz and 1.086 at 500 Hz**, with air left out of both. Against rooms.json's Eyring with air, as the ruling first worked it, it gives 1.379 and 1.113.
  - **How the tracer compares.** Fitzroy is the classic upper estimate for this case. The tracer sits below it at 250 Hz and 6 % above it at 500 Hz, where the 22.9 m box's length may add a little: the real room is two sections about 11 m across, with piers and a curved wall.
  - **The other rooms.** At 250 Hz Fitzroy ÷ Eyring is 1.00–1.12 there, as their walls absorb as much as their floors and ceilings or more, and their fitted 250 Hz factors are 1.009–1.068.
  - **What to listen for.** If the Robert Adam Room's low-mid ring sounds too long or too boomy, these two factors are the lever.
- **The galleries' 1–4 kHz**, held at the clamp (above).
- **The Grand Hall's curtains** (31 m² of velour, EST) carry a third of its 1 kHz absorption.

### The literature search (13 November)

A bounded search (well under the hour allowed) of DAGA, Institute of Acoustics, Forum Acusticum and journal papers, for a measured, panelled room of 300–800 m³, unfurnished or event-dressed, beyond those above. Every figure used here was read in the paper itself.
- **Found:** Schloss Benrath's Gartensäle (DAGA 2018), now the Saloon's tested comparator, and the Franz-Marc-Raum (DAGA 2023), the Robert Adam Room's.
- **Read and rejected:**
  - the Forum Heimat at Benediktbeuern, 834 m³, vaulted and hard;
  - the large Sitzungssaal at Schloss Deichmannsaue, about 1,084 m³, with its figures only in a plot;
  - the rooms of the Caserta royal palace, 4,700 m³ and more;
  - a Renaissance hall of 5,000 m³;
  - a university meeting room of 1,380 m³, whose figures are calculated.
- **Not retrievable:** Templeton's "Acoustics of Ceremonial Halls" (IOA Proceedings 22, 2000) and Vondrášek's surveys of Czech music rooms.
- **Still none found** for the Holywell Music Room, the Bath and Edinburgh Assembly Rooms, a livery hall or a council chamber, nor for a small carpeted meeting room.

## What the tracer does not model

- **The rooms' real outlines:** the prisms above, the Reception Room's L, and the Robert Adam Room's two ceilings.
- **Where each wall material sits:** the walls are one mixture.
- **Furniture as obstacles:** contents are floor absorption.
- **Ornament:** the coffers, cornices and window reveals are not drawn. Their scattering is folded into s = 0.2.
- **Wave effects:** diffraction, edge scattering and low-frequency modes are absent, so 125 Hz is the least trustworthy band. The test does not check it.
- **Positions:** one source and one receiver position per room.

## Run log

- **28 Oct 2026, 15:00.**
  - The first full run (20,000 rays) failed the seed rule in the Grand Hall and Robert Adam Room dressed (3.33 %, 3.16 %) and in the galleries (4.4 % empty, 15.4 % dressed). Nothing was written.
  - That run was started as a GPU gate's quiet flag reappeared. The command printed the flag but did not wait for it, so about 3.7 minutes of one CPU core ran during that gate. This was my lapse.
  - Every later run waited for the flag, and the tracer now pauses for it itself (`--pause-while`).
- **28 Oct 2026, from 15:35.** The run that wrote results.json, at the ray counts above.
  - The self-test passed.
  - The four big rooms at 200,000 rays agree between seeds within 0.72 %. The North Gallery at 2,000,000 rays agrees within 1.81 % (2 kHz, dressed). The South Gallery shares its trace.
  - The run took 72 minutes on the clock, about half of it paused for GPU gates. A gallery trace takes about 3.5 minutes of tracing.
- **28 Oct 2026, evening (the review's fix round, rulings R38–R40).** No retrace.
  - results.json was stamped with its record (`--stamp f8e30804`).
  - The 125 Hz factors in the five small rooms went to 1 (R39).
  - 8 kHz and the change with fullness joined the tests.
  - The self-test gained checks 5 and 6 and Kuttruff's bound on check 1, and passed.
  - Two committed traces were rerun and matched to the bit (`bit-for-bit.txt`).

- **13 Nov 2026 (the #416 review's fix round, rulings R49 and R50).** A full retrace after R49's changes to the rooms, with the same rays and seeds.
  - **What changed in the rooms.**
    - The Robert Adam Room's two ceilings and the Grand Hall's dome became plaster on lath, and that row became James's "plaster on lath, deep air space".
    - The Grand Hall's dado lost only each opening's part of its band, about 10 m² more panelling.
    - The Saloon's, the Robert Adam Room's lower section's and the Reception Room's heights became the survey mesh's area means: 5.60, 3.03 and 2.89 m, from 5.7, 2.9 and 2.8 m.
  - **The self-test passed**, the same to every printed digit as on 28 October.
  - **The double run.** Two processes traced the committed rooms.json at once. Their results.json were byte-identical (sha256 f170af08…04afa8), and their logs agreed line for line apart from the timings and the output file's name.
  - **The galleries' export did not change**, and their traces repeated 28 October's exactly.
  - **Timing.** 37 minutes of tracing (2,226 s), with no pause for a gate.
  - **What moved**, empty, calibrated, (500 Hz + 1 kHz) ÷ 2, before and after:

    | Room | Mid band | 250 Hz |
    |---|---|---|
    | Grand Hall | 2.44 to 2.34 s | 1.96 to 1.76 s |
    | Saloon | 2.36 to 2.30 s | 1.37 to 1.29 s |
    | Robert Adam Room | 2.18 to 1.96 s | 2.46 to 1.68 s |
    | Reception Room | 0.96 to 0.99 s | 1.17 to 1.20 s |
    | North and South Galleries | 0.89 s, unchanged | 1.10 s, unchanged |

  - **The provenance check.** trace{} now records raytrace.py's sha256 beside rooms.json's, and `--stamp` is gone.
