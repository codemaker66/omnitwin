# Set-down acoustics: the offline ray tracer (T-677)

The planner's set-down sound rings with each room's echo. That echo comes from Eyring's formula with air absorption, multiplied per band by a calibration (`packages/web/src/lib/set-down/room-acoustics.ts`, `rooms.ts`). This folder holds the independent check on that model: a ray tracer of each Trades Hall room.

The tracer proves itself on textbook cases first. Then it traces each room empty, half dressed and fully dressed. The calibration factors in `rooms.ts` are fitted to its empty traces, and `calibration.test.ts` holds the model to all three dressings.

| File | What it is |
|---|---|
| `raytrace.py` | The tracer (numpy only), with its self-test. |
| `rooms.json` | The rooms as the model has them, exported from `rooms.ts` and `room-acoustics.ts`. |
| `results.json` | The tracer's T20 per band for each room and dressing, its fits' r², and a second seed. |

## Running it

From `packages/web`, under the PC's hold:

```
bash D:/claude/gpu-queue/heavy-hold.sh "<session> export rooms" env EXPORT=1 pnpm exec vitest run src/lib/set-down/__tests__/export-rooms.test.ts
```

The exporter (`src/lib/set-down/__tests__/export-rooms.test.ts`) is skipped unless `EXPORT=1`. It lives under `src/` because packages/web's vitest only includes `src/**`. When it runs, it writes `rooms.json` here.

Then, from this folder, with `python` (not `python -I`, because numpy is in the user site-packages):

```
bash D:/claude/furniture-rebuild-20261026/tools/wait-memory.sh 2048 1024 1
python raytrace.py --selftest
python -u raytrace.py rooms.json results.json --pause-while D:/claude/planner-polish-20261018/quiet
```

- Every run does the self-test first and stops if any check fails.
- `--pause-while` holds the trace between batches while a GPU gate's quiet flag exists.
- The tracer works in batches of 50,000 rays. Measured on this PC: a peak working set of 63 MB and a peak commit of 84 MB.
  - The low commit comes from holding numpy's OpenBLAS to one thread, which the tracer does before importing numpy.
  - Unpinned, OpenBLAS reserved about 0.5 GB of commit at import for its 16 threads.
  - The traces are identical either way: two of results.json's traces were rerun pinned and matched it bit for bit.
- The full run takes about 40 minutes of tracing on this PC, most of it in the galleries (about 3.5 minutes a trace at 2,000,000 rays).
- results.json is written only if every check passes: the self-test, the dome check, the seed agreement, and a T20 fit in every band.

## What it traces

### The rooms as prisms

Each room is a prism of its plan rectangle. Its height is the model's volume (less the Grand Hall's dome) over the floor's area, so the prism keeps the model's volume exactly.

| Room | Prism (length x width x height) | Rule |
|---|---|---|
| Grand Hall | 21.135 x 10.590 x 6.700 m, plus the dome | its plan |
| Saloon | 11.800 x 7.100 x 5.700 m | its plan |
| Robert Adam Room | 22.849 x 6.127 x 2.626 m | two-part room |
| Reception Room | 14.138 x 7.073 x 2.800 m | two-part room |
| North and South Galleries | 11.500 x 4.100 x 2.800 m | its plan |

**The two-part rooms.**

- The Reception Room's traced L becomes a rectangle of equal area (100 m²) that also keeps the L's perimeter, so its wall area stays the model's.
- The Robert Adam Room's two sections (11.2 x 7.6 x 2.9 m open to 9.8 x 5.6 x 2.2 m) are treated the same way. `ROOM_PLANS` holds only the main part of each of these rooms, and a prism of that part alone would lose about a quarter of the Robert Adam Room's surface.
- So the rectangle has the floor's area (140 m²) and the walls' perimeter.
- In both rooms, volume, floor, ceiling and wall areas are the model's.
- What is lost is each room's real outline: the arm of the L, and the step between the Adam Room's two ceilings.

**The Grand Hall's dome** is a spherical cap over the ceiling's opening (ruling R28), in place of the plan's older cylinder and hemisphere:

- Its base radius is √(opening ÷ π) = 3.3200 m, in the ceiling plane over the hall's centre.
- Its height, 2.4495 m, is solved so that the cap's volume (πh/6)(3a² + h²) equals the scanned dome's 50.105 m³. The sphere's radius is then 3.4747 m.
- **Dome check:** the cap's area π(a² + h²) is 53.477 m² against the scanned inner surface's 54.435 m², **−1.76 %** (limit 3 %).
- The ceiling plane is open inside the base circle. A ray reaching it there goes on into the cap and comes back down through the same opening.

### Materials

- **The floor, the ceiling plane and the dome** each take their own material's α.
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
  - Every band from 250 Hz to 4 kHz must agree within 3 %.
  - A disagreeing dressing is rerun once with both seeds. If it still disagrees, the run fails and nothing is written.

## Self-test

`python raytrace.py --selftest` exits non-zero on any failure. The figures from the run that wrote results.json:

1. **Uniform diffuse cube** (10 m, α 0.2 on every face, s 1, no air, 20,000 rays). T20 1.2489 s against Eyring's 0.161V ÷ (−S ln(1 − α)) = 1.2025 s, **+3.86 %** (limit 5 %). r² 0.99927 (limit 0.99).
2. **Air only** (10 m cube, α 0, s 0.2, m = 0.0242 1/m, the 8 kHz value, 20,000 rays). T20 1.6586 s against 13.82 ÷ (c·m) = 1.6649 s, **−0.38 %** (limit 3 %). r² 0.99992.
3. **No loss at all** (10 m cube, α 0, no air, s 0.2, 400,000 rays). Every one of the 59 windows of 100 ms from 50 ms to 6 s is within **2.36 %** of their mean (limit 5 %). The mean is −0.07 % from the uniform-field value N·c·Δt ÷ V (limit 2 %).
4. **The Grand Hall's box and dome, no loss** (400,000 rays). Windows within **2.46 %** (limit 5 %). The mean is −0.01 % from N·c·Δt ÷ V, with V including the cap. The share of path inside the dome is 3.220 % against the dome's 3.233 % of the volume (−0.40 %, limit 2 %). No ray left the room.

Checks 3 and 4 use 400,000 rays. At 20,000, a 0.6 m receiver in a 1,000 m³ cube collects only about 780 passes per 100 ms window, a ±3.8 % (1σ) spread, so the 5 % bound would fail by chance. Check 4 is an addition: checks 1–3 never pass through the dome. Check 1's +3.9 % is about the size of Kuttruff's free-path-variance correction to Eyring for a cube (about +4.5 %).

## Calibration

For each room and band: calibration = tracer empty T20 ÷ Eyring empty (uncalibrated).

- The factor is clamped to 0.7–1.3 and rounded half up to 3 decimals.
- A band whose empty fit has r² < 0.95 keeps 1. None did.
- The factors are in `rooms.ts` (`TRACER_CALIBRATION`).
- `room-acoustics.test.ts` checks that they equal the fit from results.json.
- `calibration.test.ts` holds the calibrated model within 15 % of the tracer, empty, half and fully dressed, from 250 Hz to 4 kHz, except the galleries' non-diffuse bands below.

R29's second, dressed factor was not needed. With the empty calibration alone, the four big rooms' half and dressed states stay within a few percent of the tracer (tables below). R29 does not apply to the galleries (ruling R32).

T20 per octave band in seconds, from seed 1. "Model" is the planner's figure: uncalibrated Eyring times the calibration. Seed 2's empty and dressed traces sit under each table.

### Grand Hall

200,000 rays a band. Calibration: 1.041, 1.030, 1.020, 1.009, 1.007, 1.008, 1.006.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 1.639 | 1.961 | 2.314 | 2.559 | 2.518 | 1.960 | 1.044 |
| | model (s) | 1.638 | 1.960 | 2.314 | 2.557 | 2.519 | 1.961 | 1.043 |
| | model / tracer | -0.0 % | -0.0 % | +0.0 % | -0.0 % | +0.0 % | +0.0 % | -0.0 % |
| | Eyring, uncalibrated (s) | 1.574 | 1.903 | 2.269 | 2.535 | 2.501 | 1.945 | 1.037 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 1.582 | 1.857 | 2.078 | 2.178 | 2.095 | 1.685 | 0.956 |
| | model (s) | 1.585 | 1.857 | 2.066 | 2.161 | 2.081 | 1.685 | 0.959 |
| | model / tracer | +0.2 % | +0.0 % | -0.6 % | -0.8 % | -0.7 % | -0.0 % | +0.4 % |
| | Eyring, uncalibrated (s) | 1.522 | 1.803 | 2.026 | 2.142 | 2.067 | 1.672 | 0.954 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 1.534 | 1.768 | 1.883 | 1.889 | 1.785 | 1.482 | 0.890 |
| | model (s) | 1.534 | 1.764 | 1.863 | 1.866 | 1.767 | 1.473 | 0.886 |
| | model / tracer | -0.0 % | -0.3 % | -1.1 % | -1.2 % | -1.0 % | -0.6 % | -0.4 % |
| | Eyring, uncalibrated (s) | 1.474 | 1.713 | 1.827 | 1.849 | 1.755 | 1.461 | 0.881 |
| | r² | 1.0000 | 1.0000 | 0.9999 | 0.9999 | 1.0000 | 1.0000 | 1.0000 |
| empty, seed 2 | T20 (s) | 1.632 | 1.951 | 2.306 | 2.554 | 2.514 | 1.952 | 1.043 |
| | seed 2 / seed 1 | 0.40 % | 0.50 % | 0.32 % | 0.20 % | 0.14 % | 0.40 % | 0.11 % |
| dressed, seed 2 | T20 (s) | 1.541 | 1.779 | 1.893 | 1.899 | 1.796 | 1.482 | 0.886 |
| | seed 2 / seed 1 | 0.44 % | 0.60 % | 0.54 % | 0.52 % | 0.60 % | 0.04 % | 0.46 % |


### Saloon

200,000 rays a band. Calibration: 1.031, 1.023, 1.019, 1.012, 1.008, 1.008, 1.004.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 1.071 | 1.366 | 2.120 | 2.606 | 2.734 | 2.043 | 1.063 |
| | model (s) | 1.071 | 1.366 | 2.121 | 2.605 | 2.734 | 2.043 | 1.063 |
| | model / tracer | +0.0 % | -0.0 % | +0.0 % | -0.0 % | +0.0 % | +0.0 % | +0.0 % |
| | Eyring, uncalibrated (s) | 1.039 | 1.335 | 2.081 | 2.574 | 2.713 | 2.027 | 1.059 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 1.045 | 1.311 | 1.900 | 2.181 | 2.210 | 1.733 | 0.975 |
| | model (s) | 1.045 | 1.310 | 1.899 | 2.178 | 2.207 | 1.733 | 0.972 |
| | model / tracer | +0.0 % | -0.1 % | -0.0 % | -0.1 % | -0.1 % | +0.0 % | -0.4 % |
| | Eyring, uncalibrated (s) | 1.014 | 1.280 | 1.864 | 2.153 | 2.190 | 1.720 | 0.968 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 1.024 | 1.268 | 1.729 | 1.880 | 1.857 | 1.513 | 0.901 |
| | model (s) | 1.021 | 1.258 | 1.718 | 1.868 | 1.845 | 1.501 | 0.894 |
| | model / tracer | -0.3 % | -0.8 % | -0.7 % | -0.7 % | -0.7 % | -0.8 % | -0.8 % |
| | Eyring, uncalibrated (s) | 0.990 | 1.230 | 1.686 | 1.846 | 1.831 | 1.490 | 0.890 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| empty, seed 2 | T20 (s) | 1.070 | 1.367 | 2.116 | 2.604 | 2.733 | 2.040 | 1.062 |
| | seed 2 / seed 1 | 0.10 % | 0.07 % | 0.21 % | 0.07 % | 0.03 % | 0.14 % | 0.07 % |
| dressed, seed 2 | T20 (s) | 1.024 | 1.263 | 1.725 | 1.878 | 1.855 | 1.508 | 0.900 |
| | seed 2 / seed 1 | 0.06 % | 0.42 % | 0.25 % | 0.12 % | 0.15 % | 0.30 % | 0.06 % |


### Robert Adam Room

200,000 rays a band. Calibration: 1.117, 1.076, 1.070, 1.050, 1.044, 1.041, 1.031.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 2.087 | 2.462 | 2.197 | 2.170 | 1.944 | 1.555 | 0.877 |
| | model (s) | 2.088 | 2.462 | 2.198 | 2.171 | 1.945 | 1.555 | 0.877 |
| | model / tracer | +0.0 % | -0.0 % | +0.0 % | +0.0 % | +0.0 % | -0.0 % | -0.0 % |
| | Eyring, uncalibrated (s) | 1.869 | 2.288 | 2.054 | 2.068 | 1.863 | 1.494 | 0.850 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 1.916 | 2.221 | 1.901 | 1.811 | 1.616 | 1.333 | 0.798 |
| | model (s) | 1.987 | 2.267 | 1.919 | 1.806 | 1.603 | 1.328 | 0.798 |
| | model / tracer | +3.7 % | +2.1 % | +1.0 % | -0.3 % | -0.8 % | -0.4 % | +0.0 % |
| | Eyring, uncalibrated (s) | 1.779 | 2.106 | 1.794 | 1.720 | 1.536 | 1.275 | 0.774 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 1.832 | 2.060 | 1.708 | 1.576 | 1.398 | 1.182 | 0.745 |
| | model (s) | 1.894 | 2.099 | 1.702 | 1.543 | 1.360 | 1.156 | 0.731 |
| | model / tracer | +3.4 % | +1.9 % | -0.4 % | -2.1 % | -2.7 % | -2.2 % | -1.9 % |
| | Eyring, uncalibrated (s) | 1.696 | 1.951 | 1.591 | 1.470 | 1.303 | 1.110 | 0.709 |
| | r² | 0.9999 | 1.0000 | 0.9999 | 0.9999 | 1.0000 | 1.0000 | 1.0000 |
| empty, seed 2 | T20 (s) | 2.086 | 2.452 | 2.195 | 2.168 | 1.945 | 1.558 | 0.874 |
| | seed 2 / seed 1 | 0.08 % | 0.41 % | 0.11 % | 0.09 % | 0.04 % | 0.14 % | 0.30 % |
| dressed, seed 2 | T20 (s) | 1.842 | 2.072 | 1.714 | 1.578 | 1.400 | 1.186 | 0.740 |
| | seed 2 / seed 1 | 0.57 % | 0.58 % | 0.35 % | 0.16 % | 0.13 % | 0.31 % | 0.72 % |


### Reception Room

200,000 rays a band. Calibration: 1.040, 1.007, 0.996, 0.990, 0.987, 0.987, 0.983.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 0.611 | 1.170 | 1.022 | 0.903 | 0.735 | 0.613 | 0.470 |
| | model (s) | 0.611 | 1.170 | 1.021 | 0.903 | 0.735 | 0.613 | 0.469 |
| | model / tracer | +0.0 % | -0.0 % | -0.0 % | +0.0 % | +0.0 % | +0.0 % | -0.0 % |
| | Eyring, uncalibrated (s) | 0.588 | 1.161 | 1.025 | 0.913 | 0.744 | 0.621 | 0.478 |
| | r² | 0.9998 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| half | tracer T20 (s) | 0.592 | 1.111 | 0.936 | 0.805 | 0.658 | 0.559 | 0.442 |
| | model (s) | 0.597 | 1.103 | 0.928 | 0.802 | 0.654 | 0.555 | 0.434 |
| | model / tracer | +0.8 % | -0.7 % | -0.8 % | -0.3 % | -0.5 % | -0.7 % | -1.7 % |
| | Eyring, uncalibrated (s) | 0.574 | 1.095 | 0.932 | 0.811 | 0.663 | 0.562 | 0.442 |
| | r² | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| dressed | tracer T20 (s) | 0.582 | 1.058 | 0.861 | 0.726 | 0.597 | 0.515 | 0.412 |
| | model (s) | 0.583 | 1.043 | 0.850 | 0.721 | 0.588 | 0.506 | 0.403 |
| | model / tracer | +0.3 % | -1.4 % | -1.3 % | -0.7 % | -1.5 % | -1.8 % | -2.0 % |
| | Eyring, uncalibrated (s) | 0.561 | 1.036 | 0.853 | 0.728 | 0.596 | 0.513 | 0.410 |
| | r² | 0.9999 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.9999 |
| empty, seed 2 | T20 (s) | 0.608 | 1.171 | 1.022 | 0.903 | 0.732 | 0.610 | 0.470 |
| | seed 2 / seed 1 | 0.46 % | 0.15 % | 0.00 % | 0.02 % | 0.33 % | 0.47 % | 0.06 % |
| dressed, seed 2 | T20 (s) | 0.584 | 1.057 | 0.864 | 0.728 | 0.600 | 0.519 | 0.413 |
| | seed 2 / seed 1 | 0.46 % | 0.04 % | 0.34 % | 0.39 % | 0.52 % | 0.72 % | 0.41 % |


### North and South Galleries (one trace, results.json's `sameRoomAs`)

2,000,000 rays a band. Calibration: 1.097, 1.068, 1.198, 1.300, 1.300, 1.300, 1.300.

| Dressing | | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|---|
| empty | tracer T20 (s) | 0.489 | 1.097 | 1.000 | 0.840 | 0.674 | 0.575 | 0.427 |
| | model (s) | 0.489 | 1.096 | 1.000 | 0.785 | 0.559 | 0.491 | 0.412 |
| | model / tracer | +0.0 % | -0.0 % | +0.0 % | -6.5 % | -17.0 % | -14.6 % | -3.6 % |
| | Eyring, uncalibrated (s) | 0.446 | 1.026 | 0.835 | 0.604 | 0.430 | 0.378 | 0.317 |
| | r² | 0.9998 | 1.0000 | 0.9999 | 0.9994 | 0.9981 | 0.9982 | 0.9989 |
| half | tracer T20 (s) | 0.468 | 1.010 | 0.873 | 0.751 | 0.626 | 0.537 | 0.402 |
| | model (s) | 0.476 | 1.019 | 0.895 | 0.697 | 0.502 | 0.446 | 0.379 |
| | model / tracer | +1.7 % | +0.9 % | +2.5 % | -7.2 % | -19.8 % | -16.9 % | -5.7 % |
| | Eyring, uncalibrated (s) | 0.434 | 0.954 | 0.747 | 0.536 | 0.387 | 0.343 | 0.292 |
| | r² | 0.9999 | 1.0000 | 0.9999 | 0.9987 | 0.9970 | 0.9974 | 0.9987 |
| dressed | tracer T20 (s) | 0.459 | 0.952 | 0.820 | 0.726 | 0.614 | 0.529 | 0.401 |
| | model (s) | 0.464 | 0.951 | 0.808 | 0.626 | 0.455 | 0.407 | 0.351 |
| | model / tracer | +1.1 % | -0.1 % | -1.5 % | -13.8 % | -25.9 % | -23.0 % | -12.5 % |
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
- It also asserts that the list is exactly the gallery bands whose tracer ÷ Eyring exceeds 1.3.
- Every other room, band and dressing keeps the 15 % bound.
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
- **28 Oct 2026, from 15:35.** The run that wrote results.json, at the ray counts above: the self-test passed; the four big rooms at 200,000 rays agree between seeds within 0.72 %; the North Gallery at 2,000,000 rays agrees within 1.81 % (2 kHz, dressed); the South Gallery shares its trace. The run took 72 minutes on the clock, about half of it paused for GPU gates; a gallery trace takes about 3.5 minutes of tracing.
