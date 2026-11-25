# Furniture set-down sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every piece of planner furniture makes its own physically modelled sound when it lands. The sound changes with the surface under it, and with the room's real echo, which shortens as the room fills.

**Architecture:**
- **Pure arithmetic modules** in `packages/web/src/lib/set-down/` do all the computation:
  - the room acoustics: Eyring reverberation times, early reflections from image sources, the late tail;
  - the pieces and surfaces;
  - the modal set-down renderer;
  - the measurement tools.

  These are tested in Node.
- **`lib/sound-registry.ts`** stays the only file that touches Web Audio. It gains a set-down id, a batch player and a room bus fed by a ConvolverNode.
- **A small R3F component** inside `PlannerScene`'s canvas listens for touchdowns, placements and releases, and feeds the registry.
- **The listening page** is a claude.ai page bundled from the same pure modules.

**Tech Stack:** TypeScript strict, React 18 with React Three Fiber, the Web Audio API, Vitest (happy-dom), Python 3 with numpy (the offline ray tracer only), and esbuild (bundled with Vite) for the listening page.

**Spec:** `docs/superpowers/specs/2026-10-27-furniture-set-down-sound-design.md` (approved by Blake on 27 Oct 2026). The data's primary sources are cited row by row in `lib/set-down/acoustic-data.ts`, `rooms.ts`, `surfaces.ts` and `modes.ts`; the values tabled below are as planned, and the code holds the values that shipped.

**Task number.** This is T-700, renumbered on 13 Nov 2026 (the repository's T-677 is the foundry's shared-lock migration). Commits made before then say T-677; the branch names keep `t677`. The #416 review's rulings R46–R53 (`docs/sessions/2026-11-13.md`) amend this plan where noted.

Paths below are relative to `packages/web/src/` unless they start with `tools/`, `docs/` or `packages/`. The branch is `claude/furniture-sound-t677`.

## Global Constraints

- **Web Audio only in the registry.** Only `lib/sound-registry.ts` may contain the patterns `AudioContext`, `webkitAudioContext`, `createOscillator`, `createBufferSource`, `HTMLAudioElement`, `new Audio(` and `<audio` (`lib/__tests__/sound-registry.test.ts` scans `src/`).
- **Strict TypeScript.** No `any`, no new runtime dependency, and `.js` suffixes on relative imports, as the repo does.
- **Bands.** Octave bands are 125, 250, 500, 1000, 2000, 4000 and 8000 Hz. Wherever a material has no 8 kHz value, use its 4 kHz value, or 4 kHz + 0.01 (EST) where the row rises with frequency (ruling R65).
- **Sample rate.** 48000 Hz unless the context says otherwise. Every render is seeded and deterministic, using `seededRandom` from `lib/planner-sound-render.ts`.
- **Timing.** A set-down is heard no earlier than the contact frame is shown, and within 20 ms of it where the device's output latency allows.
- **Levels:**
  - set-downs stay within an 8 dB window of momentary K-weighted loudness (BS.1770 momentary maximum, 400 ms window; R45) across the catalogue;
  - the common pieces (chairs, rounds, trestles, poseurs) stay within 4 dB of each other;
  - set-down peaks sit between −32 and −6 dBFS on the pre-pan mono source before the master (R42; the plan's first figure was −16);
  - two plays of the same piece on the same surface differ by no more than 3 dB;
  - energy above 14 kHz is under 0.5 % of the total;
  - the horizon, Send, Present and act sounds stay at most 6 dB above the common set-downs.
- **Silence.** Nothing plays on load, undo, redo, a remote co-editor's change, an autosave, a preview ghost, in a hidden tab, or before the first gesture. Reduced motion silences nothing.
- **Default and controls.** The default mode is `"quiet"` (D1, Blake, 27 Oct). No sound or mute button is ever on screen. The setting lives in menus, and Shift M mutes.
- **Budgets on a mid-range phone:**

  | Work | Budget |
  |---|---|
  | Rendering one set-down | In a Worker, started as the drop starts, its Float32 channels transferred back; never on the main thread. Contact comes 50 ms later for a carried heavy piece, 67 ms at 60 fps (69 ms continuous) for light and table pieces, 83 ms for a drop-in; other display rates move these (75–165 Hz: heavy pieces 49–55 ms, drop-ins 80–89 ms). With the Grand Hall's 18 reflections a render took 7.5–23.9 ms (medians) on the build desktop in the #416 review, so about 23–120 ms on a phone at 3–5x (EST). Heavy pieces fall back to variants rendered ahead on idle. Spec section 9; R48, amending the plan's first "≤ 2 ms" |
  | The touchdown watcher | allocation-free, ≤ 0.05 ms at 180 settling pieces |
  | Recomputing reverberation times | ≤ 0.5 ms |
  | The tail | idle slices of ≤ 4 ms each, ≤ 150 ms in total; 1.2 x the longest band's reverberation time in seconds at any rate, its memory per rate stated in `tail.ts` (R46; the plan's first cap was 2 MB) |
  | Voices at once | ≤ 8 |
  | Engine and data | ≤ 33 KB gzipped for the Worker's and the driver's chunks together, lazy with the planner (R101, R103, R106; the first figure was 25 KB, before the engine's rulings through R102 were built; R103's 32 KB held until fix round 2's fixes measured 33,287 B on 25 Nov 2026) |
- **This PC is short of memory** (system commit at 92–97 %). Run Vitest on single files (`pnpm --filter @omnitwin/web exec vitest run <file>`). CI runs the full suites. Check free memory before the ray tracer and any browser run (the house's `wait-memory.sh`, kept outside the repo).
- **No edits** to `components/meshes/crafted/*` or `crafted-furniture.test.ts`: four T-675 PRs are open on them.
- **Commits.** Commit with explicit pathspecs. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit in the shared checkout that other sessions work in.

## Review Focus

1. **The context was suspended by the 20 s silence rule, and a piece lands.** The first set-down after a pause must still play, resuming the context and scheduling against the resumed clock. It is never lost. Test in Task 13.
2. **Rapid repeated placements** (Shift-click keeps placing, about ten a second). Each landing is admitted or refused by the policy, never stacked. There is no burst of more than 8 a second, and the frame time does not grow. Test in Task 14.
3. **The room changes while a tail is ringing.** The next set-down uses the new room's tail, the old tail fades, and the touchdown listeners do not leak across scenes. Test in Task 14.
4. **A piece with no crafted body** (an imported GLB, a proxy box) or a scaled piece (`PlacedItem.scale` ≠ 1). It gets its family fallback, with feet, mass and modes scaled. It is never silent, never NaN, and never throws. Tests in Tasks 5 and 6.
5. **The support under a foot is removed** (a deck deleted under a chair), **or a foot overhangs a support's edge.** Each foot finds its own support at the moment it lands, and the room's contents update. Test in Task 10.

---

## PR 1: the engine (nothing wired)

### Task 1: Bands and measurement tools

**Files:**
- Create: `lib/set-down/bands.ts`, `lib/set-down/analysis.ts`
- Modify: `lib/planner-sound-render.ts` (export the existing radix-2 `fft`; nothing else changes)
- Test: `lib/set-down/__tests__/analysis.test.ts`

**Interfaces:**
- Produces:
  - `OCTAVE_BANDS_HZ: readonly [125, 250, 500, 1000, 2000, 4000, 8000]`;
  - `type BandValues = readonly [number, number, number, number, number, number, number]`;
  - `bandMap(values: BandValues, f: (v: number, i: number) => number): BandValues`;
  - `octaveBandpass(samples: Float32Array, centreHz: number, sampleRate: number): Float32Array`, made of two cascaded RBJ band-pass biquads at Q = 1.414 from `biquadCoefficients`;
  - `schroederT20(samples: Float32Array, sampleRate: number): number`, in seconds, fitting −5 to −25 dB of the backward-integrated energy and extrapolating to 60 dB;
  - `bandEnergy(samples: Float32Array, sampleRate: number, loHz: number, hiHz: number): number`;
  - `spectralCentroidHz(samples: Float32Array, sampleRate: number): number`;
  - `onsetTimesMs(samples: Float32Array, sampleRate: number): readonly number[]`, with a 1 ms envelope and a jump of +12 dB over the preceding 3 ms;
  - `kWeightedLoudness(left: Float32Array, right: Float32Array, sampleRate: number): number`, the ITU-R BS.1770 K-weighting with its two stages, as mean-square dB over the samples above −70 dB.

- [ ] **Step 1: Write the failing tests** in `analysis.test.ts`:
  - `schroederT20` of seeded white noise × exp(−6.91·t/1.5) gives 1.5 s within 3 %;
  - `octaveBandpass` at 1 kHz keeps over 90 % of a 1 kHz sine's energy and under 3 % of a 125 Hz sine's;
  - `spectralCentroidHz` of a 2 kHz sine is 2000 ± 40;
  - `onsetTimesMs` of two clicks 20 ms apart is [~0, ~20] ± 1;
  - `kWeightedLoudness` of a 1 kHz sine at −20 dBFS in both channels is −20 ± 1.0 dB, and the same sine at 100 Hz reads at least 0.5 dB lower.
- [ ] **Step 2: Run** `pnpm --filter @omnitwin/web exec vitest run src/lib/set-down/__tests__/analysis.test.ts`. Expected: FAIL (the modules are missing).
- [ ] **Step 3: Implement** `bands.ts` and `analysis.ts`, reusing `biquadCoefficients`, `applyFilter`, `seededRandom` and the now-exported `fft` from `planner-sound-render.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `vitest run src/lib/__tests__/planner-sound.test.ts`. Expected: PASS, unchanged.
- [ ] **Step 5: Commit** `lib/set-down/bands.ts lib/set-down/analysis.ts lib/set-down/__tests__/analysis.test.ts lib/planner-sound-render.ts` with the message "Measure sounds per octave band for the set-down engine (T-677)".

### Task 2: Acoustic data (absorption by material and object, air)

**Files:**
- Create: `lib/set-down/acoustic-data.ts`
- Test: `lib/set-down/__tests__/acoustic-data.test.ts`

**Interfaces:**
- Consumes: `BandValues` (Task 1).
- Produces:
  - `type SurfaceMaterialId`;
  - `SURFACE_ABSORPTION: Readonly<Record<SurfaceMaterialId, BandValues>>`;
  - `AIR_ATTENUATION_PER_M: BandValues`;
  - `type AbsorberKind = "chair-hard" | "chair-cushioned" | "chair-upholstered" | "table-bare" | "round-clothed" | "trestle-clothed" | "poseur-covered" | "fabric-face" | "none"`;
  - `OBJECT_ABSORPTION: Readonly<Record<Exclude<AbsorberKind, "fabric-face" | "none">, BandValues>>`;
  - `FABRIC_FACE_PER_M2: BandValues`.

These values are as planned, for 125 Hz to 4 kHz; 8 kHz repeats 4 kHz, or 4 kHz + 0.01 (EST) where the row rises (ruling R65), except for air. Each row carries a comment naming its primary source and label (LAB, FIELD, TEXTBOOK or EST). Ruling R49 (13 Nov) replaced `plaster-lath` with James's "plaster on lath, deep air space", 0.20 / 0.15 / 0.10 / 0.05 / 0.05 / 0.05 (TEXTBOOK), as the planned row sat below both rows it cited; `acoustic-data.ts` holds the shipped values.

| Id | α at 125 / 250 / 500 / 1k / 2k / 4k Hz |
|---|---|
| `oak-boards-joists` | 0.15 / 0.11 / 0.10 / 0.07 / 0.06 / 0.07 |
| `parquet-timber-subfloor` | 0.14 / 0.11 / 0.09 / 0.08 / 0.06 / 0.07 |
| `timber-on-slab` | 0.04 / 0.04 / 0.07 / 0.06 / 0.06 / 0.07 |
| `carpet-on-underlay` | 0.08 / 0.12 / 0.35 / 0.55 / 0.70 / 0.72 |
| `plaster-masonry` | 0.02 / 0.02 / 0.03 / 0.04 / 0.05 / 0.05 |
| `plaster-lath` | 0.15 / 0.12 / 0.08 / 0.05 / 0.04 / 0.04 |
| `plasterboard-studs` | 0.29 / 0.10 / 0.05 / 0.04 / 0.07 / 0.09 |
| `hardwood-panelling` | 0.28 / 0.22 / 0.12 / 0.09 / 0.08 / 0.08 |
| `sash-glazing` | 0.25 / 0.15 / 0.08 / 0.05 / 0.04 / 0.03 |
| `leaded-glass` | 0.20 / 0.15 / 0.10 / 0.07 / 0.05 / 0.05 |
| `velour-drape` | 0.08 / 0.35 / 0.80 / 0.98 / 0.95 / 0.90 |
| `sheer-curtain` | 0.02 / 0.04 / 0.10 / 0.25 / 0.40 / 0.50 |
| `marble` | 0.01 / 0.01 / 0.01 / 0.01 / 0.02 / 0.02 |
| `timber-door` | 0.14 / 0.10 / 0.06 / 0.08 / 0.10 / 0.10 |

Air attenuation per metre, at 125 Hz to 8 kHz: 1.0e-4 / 3.0e-4 / 6.3e-4 / 1.07e-3 / 2.28e-3 / 6.83e-3 / 2.42e-2.

Objects, in m² per piece at 125 Hz to 4 kHz:

| Object | m² at 125 / 250 / 500 / 1k / 2k / 4k Hz |
|---|---|
| `chair-hard` | 0.03 / 0.03 / 0.04 / 0.05 / 0.06 / 0.06 |
| `chair-cushioned` | 0.04 / 0.05 / 0.09 / 0.13 / 0.15 / 0.15 |
| `chair-upholstered` | 0.08 / 0.10 / 0.17 / 0.24 / 0.27 / 0.27 |
| `table-bare` | 0.10 in every band |
| `round-clothed` | 0.10 / 0.20 / 0.40 / 0.50 / 0.60 / 0.60 (EST ±50 %) |
| `trestle-clothed` | 0.06 / 0.12 / 0.25 / 0.30 / 0.35 / 0.35 |
| `poseur-covered` | 0.03 / 0.06 / 0.12 / 0.15 / 0.18 / 0.18 (EST, half the trestle) |

`FABRIC_FACE_PER_M2` equals the `velour-drape` row.

- [ ] **Step 1: Write the failing tests:**
  - every α is in [0, 1];
  - every row has 7 bands;
  - `OBJECT_ABSORPTION["chair-upholstered"][3]` is 0.24;
  - `AIR_ATTENUATION_PER_M[6]` is 0.0242;
  - every object row is non-decreasing from 125 Hz to 1 kHz (soft materials absorb more at mid band);
  - every `SurfaceMaterialId` has a source comment. Check this by reading the file text with `readFileSync`, asserting the id is followed by `// ` within the row.
- [ ] **Step 2: Run** `vitest run src/lib/set-down/__tests__/acoustic-data.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `acoustic-data.ts`** with exactly these values.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Hold the published absorption of Trades Hall's surfaces and furniture (T-677)".

### Task 3: Rooms and reverberation times

**Files:**
- Create: `lib/set-down/rooms.ts`, `lib/set-down/room-acoustics.ts`
- Test: `lib/set-down/__tests__/room-acoustics.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's tables;
  - `PlacedItem` and `getCatalogueItem` (`lib/placement.ts`, `lib/catalogue.ts`);
  - `Space` (`@omnitwin/types`).
- Produces:
  - `type RoomSlug = "grand-hall" | "saloon" | "robert-adam-room" | "reception-room" | "north-gallery" | "south-gallery"`;
  - `interface RoomSurface { readonly material: SurfaceMaterialId; readonly areaM2: number; readonly role: "floor" | "wall" | "ceiling" | "opening" }`;
  - `interface RoomAcoustics { readonly slug: string; readonly volumeM3: number; readonly surfaces: readonly RoomSurface[]; readonly calibration: BandValues; readonly source: string }`;
  - `ROOM_ACOUSTICS: Readonly<Record<RoomSlug, RoomAcoustics>>`;
  - `roomAcousticsFor(space: Pick<Space, "slug" | "widthM" | "lengthM" | "heightM"> | null): RoomAcoustics`. An unknown slug, or a null space, gets a default room from the space's dimensions (a 10 × 8 × 4 m box when null): `timber-on-slab` floor, `plaster-masonry` walls and ceiling, calibration all 1.
  - `interface Absorber { readonly kind: AbsorberKind; readonly fabricM2: number; readonly x: number; readonly z: number }`;
  - `absorberFor(item: PlacedItem): Absorber`;
  - `contentsAbsorption(absorbers: readonly Absorber[]): BandValues`;
  - `reverberationTimes(room: RoomAcoustics, contents: BandValues): BandValues`;
  - `reverberantGain(room: RoomAcoustics, contents: BandValues): number`;
  - `interface RoomState { readonly rt: BandValues; readonly reverberantGain: number; readonly key: string }`;
  - `roomState(room: RoomAcoustics, items: readonly PlacedItem[]): RoomState`;
  - `referenceDinner(slug: RoomSlug): readonly PlacedItem[]`. This is the dressed reference that Task 7's tracer and Task 9's page share. It holds the room's published dinner capacity (`types/src/trades-hall-venue-truth.ts`) in `chiavari-chair` items, plus ceil(capacity ÷ 10) `round-table-6ft-white` items, all on a regular grid inside the room. The Grand Hall's figure is 180 chairs and 18 rounds.

**Rooms** (`rooms.ts`). Compute each area from the named source in code, with a comment, so a later survey edits one place. As planned; ruling R49 (13 Nov) amended it: the Robert Adam Room's ceilings and the Grand Hall's dome are `plaster-lath`, the dado band subtracts only each opening's extent within it, survey figures are labelled measured or EST, and the Saloon, Robert Adam and Reception heights are the survey mesh's area means (5.60, 3.03 and 2.89 m). The galleries' walls and ceiling became `plasterboard-studs` by R13.

- **Grand Hall** (`components/grand-hall/hall-spec.ts`):
  - 21.135 × 10.59 m, coffered ceiling at 6.7 m;
  - a dome of radius 3.5 m with a 1.5 m drum (EST, from `data/room-geometries.ts`), giving a volume of about 1,647 m³;
  - floor `oak-boards-joists`;
  - ceiling `plaster-lath`, minus the dome's opening; dome `plaster-masonry`;
  - glazing: the five windows' clear openings from `HALL_OPENINGS`, as `sash-glazing`;
  - doors from `HALL_DOORS`, as `timber-door`;
  - dado: the perimeter less the openings, × 1.2 m, as `hardwood-panelling`;
  - the remaining wall: half `hardwood-panelling`, half `plaster-masonry`;
  - curtains: 2 × 0.9 m × the window's clear height × 5 windows, as `velour-drape` (EST).
- **Saloon:** 11.8 × 7.1 m, ceiling 5.7 m.
  - Floor `parquet-timber-subfloor`. Ceiling `plaster-lath`.
  - Walls: 70 % `hardwood-panelling`, 30 % `plaster-masonry`.
  - Three windows of 2.0 × 3.5 m, as `leaded-glass`. Marble 2 m². One door of 1.6 × 2.6 m.
- **Robert Adam Room:** a lower section of 11.2 × 7.6 × 2.9 m and an upper section of 9.8 × 5.6 × 2.2 m, open to each other.
  - Floor `oak-boards-joists`. Walls and ceilings `plaster-masonry`.
  - Three windows of 1.6 × 2.0 m. A velour curtain of 2 × 2.2 m at the arch. Two doors.
- **Reception Room:** an L of 100 m² with a mean ceiling of 2.8 m.
  - Floor `timber-on-slab`. Walls and the coved ceiling `plasterboard-studs`.
  - Four windows of 1.2 × 2.4 m, each with a sheer curtain of 2.4 × 2.4 m and drapes of 2 × 1.2 × 2.6 m in velour. Two glazed doors.
- **North and South Galleries:** 11.5 × 4.1 × 2.8 m each.
  - Floor `carpet-on-underlay`. Walls and ceiling `plaster-masonry`.
  - Two sash windows of 1.0 × 1.6 m, plus a three-light front window of 2.0 × 1.6 m. One door.

`calibration` starts at all 1. Task 7 fits it.

**Contents** (`absorberFor`):
- **Chairs:**
  - `chiavari-chair` → `chair-cushioned`;
  - `burgess-turini-18-3`, `checked-banquet-chair`, `gallery-chair-red-gold`, `pink-chair` and `banquet-chair` → `chair-upholstered`;
  - `highchair-*` → `chair-hard`.
- **Tables:**
  - `round-*` and `cake-cutting-table` → `round-clothed` if `item.clothed` or the slug ends in `-white` or `-black`, otherwise `table-bare`;
  - `trestle-*`, `ceremony-table`, `*-cafe-table-*`, `bar-counter` and `servery-unit` → `trestle-clothed` or `table-bare`, by the same rule;
  - `poseur-table-white` and `poseur-table-black` → `poseur-covered`; `poseur-table` → `table-bare`.
- **Staging:** `staging-deck-6x4` and `staging-deck-6x3` → `fabric-face`, with `fabricM2` = perimeter × height × 0.6.
- **Divider:** `room-divider` → `fabric-face`, with `fabricM2` = width × height × 2 × 0.5.
- **Everything else** (platforms, the dance floor, AV) → `none`.
- **Unknown slugs** go by catalogue category: chair → `chair-hard`, table → `table-bare`, anything else → `none`.

**Reverberation:**
- `contentsAbsorption` sums the absorbers. Where chairs stand denser than one per 0.5 m², it caps their sum at (the occupied area on a 0.5 m grid, plus a 0.5 m edge strip) × [0.35, 0.45, 0.57, 0.61, 0.59, 0.55, 0.55] (EST).
- `reverberationTimes` is Eyring with air, multiplied per band by `calibration`:

  `T = 0.161·V / (−S·ln(1 − min(0.99, (ΣSα + A_contents) / S)) + 4mV)`
- `reverberantGain` = √(4 / R) / √(4 / R_ref), where R = A / (1 − ᾱ) at 1 kHz, and R_ref is the empty Grand Hall's value. So the empty Grand Hall is 1, and fuller or smaller-tail rooms are less than 1.
- `key` is the seven times rounded to 0.02 s and joined.

- [ ] **Step 1: Write the failing tests:**
  - the empty Grand Hall as defined, with its EST curtains, is between 2.0 and 2.6 s at 1 kHz;
  - a copy without its curtain surface is between 3.4 and 4.1 s, matching `grand_hall_estimate.py`'s 3.97 s with no curtains;
  - 180 `chiavari-chair` plus 18 `round-table-6ft-white` items shortens the mid band (the mean of 500 Hz and 1 kHz) by 15–32 %;
  - 180 `banquet-chair` plus 18 clothed rounds shortens it by 25–42 %;
  - adding any one item never lengthens any band;
  - 40 `dancefloor-panel` items change every band by under 1 %;
  - the galleries' empty mid band is under 1.0 s, and under a third of the Grand Hall's;
  - a null space gives a finite default room;
  - `reverberantGain` of the empty Grand Hall is 1 ± 1e-9 and falls as contents grow;
  - a scaled piece (`scale: 2`) adds absorption without NaN;
  - an unknown slug (`"imported-thing"`) in category `"other"` gives `none`.
- [ ] **Step 2: Run** `vitest run src/lib/set-down/__tests__/room-acoustics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `rooms.ts` and `room-acoustics.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. If the curtain range misses, adjust only the EST curtain area, note it in the comment, and say so in the commit message.
- [ ] **Step 5: Commit** with the message "Work out each Trades Hall room's echo from its survey and its contents (T-677)".

### Task 4: The late tail and the early reflections

**Files:**
- Create: `lib/set-down/tail.ts`, `lib/set-down/reflections.ts`
- Test: `lib/set-down/__tests__/tail.test.ts`, `lib/set-down/__tests__/reflections.test.ts`

**Interfaces:**
- Consumes: `BandValues`, `octaveBandpass` and `schroederT20` (Task 1); `SURFACE_ABSORPTION` (Task 2); `RoomGeometry` (`data/room-geometries.ts`).
- Produces:
  - `interface Stereo { readonly left: Float32Array; readonly right: Float32Array; readonly sampleRate: number }`;
  - `renderRoomTail(rt: BandValues, options: { readonly sampleRate: number; readonly seed: number; readonly onsetSeconds: number }): Stereo`;
  - `tailSlices(rt: BandValues, options: { sampleRate: number; seed: number; onsetSeconds: number }): Iterator<number, Stereo>`. It yields once per band and returns the finished tail, so it can be driven in idle slices.
  - `tailOnsetSeconds(room: RoomAcoustics): number`, the mean free path (4V/S) ÷ 343, clamped to 0.012–0.08 s;
  - `type Vec3 = { readonly x: number; readonly y: number; readonly z: number }`;
  - `interface Reflection { readonly delaySeconds: number; readonly gain: BandValues; readonly azimuthRad: number; readonly order: 1 | 2 }`, where the delay is relative to the direct sound and the gain is relative to the direct path's amplitude;
  - `interface ReflectionRoom { readonly geometry: RoomGeometry; readonly wall: SurfaceMaterialId; readonly floor: SurfaceMaterialId; readonly ceiling: SurfaceMaterialId }`;
  - `earlyReflections(room: ReflectionRoom, source: Vec3, ear: { readonly position: Vec3; readonly right: Vec3 }): readonly Reflection[]`;
  - `reflectionRoomFor(acoustics: RoomAcoustics, geometry: RoomGeometry): ReflectionRoom`, which takes the largest-area material of each role (wall, floor, ceiling) from `acoustics.surfaces`.

**How they work:**
- **The tail.** Each band is seeded noise passed through `octaveBandpass`, shaped by exp(−6.91·t/T_band), and starting with a 10 ms cosine fade-in at `onsetSeconds`. The two channels use independent seeds. The whole tail is scaled to unit energy in each channel; the send gain sets the level.
- **The reflections.**
  - First order covers each wall edge of the polygon: mirror the source across the edge's line, keep the image only when the reflection point lies inside the segment, and walk the edges in order. It also covers the floor (y = 0) and the ceiling (y = `ceilingHeight`).
  - Second order applies only when the polygon has 4 edges and is a rectangle: floor and ceiling with each wall, and opposite wall pairs.
  - Gain is the path ratio (direct length ÷ path length) × √(1 − α) per band for each bounce, times air loss over the extra path.
  - Azimuth is atan2 of the image direction projected on `ear.right`, measured against the direct direction.

- [ ] **Step 1: Write the failing tail tests** in `tail.test.ts`:
  - the tail for rt = [1.8, 2.2, 2.6, 2.9, 2.7, 2.0, 1.2] measures, as the tests hold it, with each reading within 4 σ_D of the scatter ISO 3382-2 expects, and each band's mean within 5 % of its target (10 % at 125 Hz), using `schroederT20` on `octaveBandpass(left, band)`, for 250 Hz to 4 kHz;
  - the left and right channels correlate below 0.2;
  - each channel has unit energy (± 1e-3);
  - the tail is silent before `onsetSeconds`;
  - the tail's length is ≤ 1.2 × the longest time + `onsetSeconds`, and its memory is ≤ 2 MB at 48 kHz;
  - `tailSlices` yields 7 times and returns a tail identical to `renderRoomTail`'s for the same seed.
- [ ] **Step 2: Write the failing reflection tests** in `reflections.test.ts`. In a 10 × 6 × 3 m rectangle with the source at (1, 0, 0) and the ear at (−1, 1.5, 0):
  - the floor reflection's delay equals (√((−1−1)² + (1.5+0)² + 0²) image path − direct) ÷ 343 within 1e-6;
  - there are 6 first-order and 12 second-order reflections;
  - every gain is below 1;
  - for an L-shaped polygon, no first-order reflection lies outside its segment, checked as: count ≤ the number of edges + 2, and every reflection point lies on its edge;
  - a carpet floor's gain at 4 kHz is below an oak floor's.
- [ ] **Step 3: Run both** with `vitest run src/lib/set-down/__tests__/tail.test.ts src/lib/set-down/__tests__/reflections.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `tail.ts` and `reflections.ts`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** with the message "Synthesise each room's tail and its first reflections (T-677)".

### Task 5: Surfaces and bodies

**Files:**
- Create: `lib/set-down/surfaces.ts`, `lib/set-down/bodies.ts`
- Test: `lib/set-down/__tests__/surfaces.test.ts`, `lib/set-down/__tests__/set-down-feet.test.ts`

**Interfaces:**
- Consumes:
  - `CraftedFurnitureSlug` and `CRAFTED_FURNITURE_SLUGS` (`components/meshes/crafted/crafted-slugs.ts`);
  - `createCraftedFurniture` (`components/meshes/crafted/crafted-registry.ts`, in the test only);
  - `getCatalogueItemBySlug` (`lib/catalogue.ts`);
  - `RoomSlug` (Task 3).
- Produces:
  - `type SurfaceKind = "oak-boards-joists" | "oak-parquet" | "timber-on-slab" | "carpet" | "stage-deck" | "dance-floor" | "table-top"`;
  - `interface ModeBank { readonly lowHz: number; readonly highHz: number; readonly count: number; readonly eta: number; readonly gainDb: number }`;
  - `interface SurfaceResponse { readonly kind: SurfaceKind; readonly hardness: number; readonly boards: ModeBank | null; readonly thump: { readonly hz: number; readonly zeta: number } | null; readonly cavity: ModeBank | null; readonly highCutHz: number }`;
  - `SURFACES: Readonly<Record<SurfaceKind, SurfaceResponse>>`;
  - `floorKindForRoom(slug: string | null): SurfaceKind`;
  - `surfaceKindForSupport(supportSlug: string | null, roomSlug: string | null): SurfaceKind`;
  - `type FootCap = "glide" | "rubber" | "felt" | "steel" | "castor" | "panel-edge"`;
  - `interface Foot { readonly x: number; readonly z: number; readonly cap: FootCap }`;
  - `type PartKind = "beech-frame" | "steel-tube-frame" | "aluminium-frame" | "ply-top" | "mdf-top" | "phenolic-deck" | "cast-base" | "cabinet-carcass" | "av-plastic" | "av-glass" | "upholstery"`;
  - `interface BodyPart { readonly kind: PartKind; readonly lengthM: number; readonly thicknessM: number; readonly share: number }`, where `share` is the part's share of radiated energy and the shares sum to 1;
  - `type BodyFamily = "chair" | "round-table" | "rect-table" | "poseur" | "stage" | "dance-floor" | "lectern" | "av-stand" | "av-small" | "cabinet" | "divider" | "highchair"`;
  - `interface SetDownBody { readonly slug: string; readonly family: BodyFamily; readonly massKg: number; readonly feet: readonly Foot[]; readonly parts: readonly BodyPart[]; readonly legRattle: boolean; readonly seatPuff: boolean; readonly castorRoll: boolean }`;
  - `SET_DOWN_BODIES: Readonly<Record<CraftedFurnitureSlug, SetDownBody>>`;
  - `bodyFor(slug: string, scale?: number): SetDownBody`. It scales the feet by `scale`, the mass by scale³ and lengths by `scale`. A slug that is not crafted uses its catalogue category, `tableShape` and size to pick a family template.

**Surfaces** (`surfaces.ts`), with values as planned; their primary sources are cited in `surfaces.ts` and `modes.ts`. R47 (13 Nov) set `timber-on-slab`'s hardness to 1 (every use clamps at 1) and its contact modulus to the timber face's:

| Kind | Hardness | Modes and cut-off |
|---|---|---|
| `oak-boards-joists` | 1.0 | boards 150–300 Hz, 24 modes, η 0.07; thump 14 Hz at ζ 0.03; highCut 16 kHz |
| `oak-parquet` | 1.0 | boards 220–480 Hz, 20 modes, η 0.09; thump 16 Hz at ζ 0.04 |
| `timber-on-slab` | 1.1 | boards 400–900 Hz, 12 modes, η 0.12; no thump |
| `carpet` | 0.05 | boards as the room's sub-floor at −18 dB; highCut 2.5 kHz |
| `stage-deck` | 0.9 | cavity 90–160 Hz, 10 modes, η 0.05; deck 200–600 Hz, 18 modes, η 0.06 |
| `dance-floor` | 1.0 | boards 300–700 Hz, 14 modes, η 0.08; the room floor beneath at −10 dB |
| `table-top` | 0.8 | 120–900 Hz, 30 modes, η 0.04 |

**Floors by room:** `grand-hall` → oak boards, `saloon` → parquet, `robert-adam-room` → oak boards, `reception-room` → timber on slab, the galleries → carpet. Null or unknown → timber on slab.

**Supports:** `staging-deck-*` and `platform*` → `stage-deck`; `dancefloor-panel` → `dance-floor`; category `table` → `table-top`.

**Bodies** (`bodies.ts`): one entry per crafted slug.
- **Feet** are in metres in the piece's frame, at catalogue size, and must match the crafted contact shade (the test enforces it).
- **Masses** (EST, kg):

  | Pieces | Mass |
  |---|---|
  | Chiavari | 4 |
  | Banquet chairs, and the pink Turini | 6 |
  | Gallery chair | 6.5 |
  | Highchairs | 5 |
  | 6 ft rounds | 30 |
  | Cake-cutting table | 18 |
  | 4 ft and 6 ft trestles | 14 and 20 |
  | Ceremony table | 24 |
  | Café tables | 10 |
  | Poseur tables | 13 |
  | Bar counter | 70 |
  | Servery unit | 55 |
  | Platform, narrow platform | 35, 25 |
  | Staging decks, 6×4 and 6×3 | 45 and 38 |
  | Dance-floor panel | 15 |
  | Lectern | 25 |
  | Projector screen | 12 |
  | Television | 32 |
  | Mic stand | 3 |
  | Projector | 3.5 |
  | Laptop | 1.8 |
  | Microphones | 0.3 |
  | Room divider | 22 |
- **Caps** follow the factory's foot material: `glide` for chairs (`crafted-chairs.ts:177`, `crafted-chiavari.ts`), `rubber` for AV, `castor` for the television, servery unit and divider.
- **Parts:**
  - Chiavari: `beech-frame` (0.45 m, 0.025 m, share 0.7) and `upholstery` (0.3);
  - banquet chairs: `steel-tube-frame` (0.45, 0.025, 0.6) and `upholstery` (0.4);
  - rounds: `mdf-top` (1.83, 0.025, 0.7) and `steel-tube-frame` (0.7, 0.025, 0.3), with `legRattle: true`.

  Write the rest in the same way, from each factory's materials.

- [ ] **Step 1: Write the failing surface tests** in `surfaces.test.ts`:
  - every room slug maps to the floor in the spec's table;
  - `surfaceKindForSupport("staging-deck-6x4", "grand-hall")` is `"stage-deck"`;
  - `surfaceKindForSupport(null, "saloon")` is `"oak-parquet"`;
  - `surfaceKindForSupport("round-table-6ft", null)` is `"table-top"`;
  - carpet's `highCutHz` is under 3000.
- [ ] **Step 2: Write the failing body tests** in `set-down-feet.test.ts`:
  - every `CRAFTED_FURNITURE_SLUGS` entry has a body;
  - every body's feet match the crafted model's contact spots. Build each slug with `createCraftedFurniture({ slug, width, depth, height })` at its catalogue size, read every mesh named `*:contact` as quads of four vertices, as `crafted-furniture.test.ts`'s `contactSpotsOf` does (reimplement it in the test; do not import that file), and require the same count, each foot within 1.5 cm of a spot;
  - every part's shares sum to 1 ± 1e-9;
  - `bodyFor("chiavari-chair", 2)` has twice the foot spread and 8 × the mass;
  - `bodyFor("imported-thing")` returns a body with at least one foot;
  - every mass lies in 0.2–100 kg.
- [ ] **Step 3: Run** `vitest run src/lib/set-down/__tests__/surfaces.test.ts src/lib/set-down/__tests__/set-down-feet.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `surfaces.ts` and `bodies.ts`. Read each factory's foot arrays (`crafted-chairs.ts:273`, `crafted-chiavari.ts:291`, `crafted-av.ts:120,153,224,241,256`, `crafted-cabinets.ts:240,298`, `crafted-extras.ts:105`, `crafted-tables.ts`, `crafted-staging.ts`) to write the feet. Do not edit those files.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** with the message "Describe every piece's feet, parts and mass, and every surface it can land on (T-677)".

### Task 6: The modal set-down renderer

**Files:**
- Create: `lib/set-down/modes.ts`, `lib/set-down/render.ts`
- Test: `lib/set-down/__tests__/render.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4 (`Stereo`, `Reflection`) and 5.
- Produces:
  - `interface Mode { readonly hz: number; readonly t60: number; readonly gain: number }`;
  - `LOSS: Readonly<Record<PartKind, { readonly eta: number; readonly viscous: number }>>`, where η(f) = eta × (1 + viscous·f/1000) and T60 = 2.2 / (f·η(f));
  - `partModes(part: BodyPart, random: () => number): readonly Mode[]`;
  - `surfaceModes(surface: SurfaceResponse, random: () => number): readonly Mode[]`;
  - `contactSeconds(cap: FootCap, surface: SurfaceResponse, massPerFootKg: number, speed: number): number`;
  - `interface SetDownInput { readonly body: SetDownBody; readonly surfaces: readonly SurfaceResponse[] /* one per foot */; readonly speed: number; readonly kind: "drop" | "settle"; readonly clothed: boolean; readonly direct: { readonly gain: number; readonly azimuthRad: number }; readonly reflections: readonly Reflection[]; readonly seed: number; readonly sampleRate: number }`;
  - `interface SetDownRender extends Stereo { readonly peakDb: number }`;
  - `renderSetDown(input: SetDownInput): SetDownRender`;
  - `SET_DOWN_TOUCH_DB`, the anchor peak of a Chiavari dropped on the oak at 1 m/s. It equals `PLANNER_TOUCH_DB`, which this task exports from `lib/planner-sound-recipes.ts` as −22, the mean of the two set-down peaks being retired. A palette rebalance then moves the set-downs with it.

Values as planned; their primary sources are cited in `modes.ts`:

**As-built loss factors:**

| Part | eta | viscous |
|---|---|---|
| beech-frame | 0.03 | 0.6 |
| ply-top | 0.035 | 0.5 |
| mdf-top | 0.04 | 0.5 |
| steel-tube-frame | 0.006 | 0.1 |
| aluminium-frame | 0.005 | 0.1 |
| phenolic-deck | 0.03 | 0.4 |
| cast-base | 0.012 | 0.2 |
| cabinet-carcass | 0.035 | 0.5 |
| av-plastic | 0.05 | 0.8 |
| av-glass | 0.004 | 0.1 |
| upholstery | 0.25 | 1.0 |

**Contact time:**
- Hard caps on hard surfaces: t = 2.87·(m² / (R·E*²·v))^(1/5). Use R = 0.01 m; E* = 1.5 GPa for oak and parquet, and 3 GPa for a nylon glide. The plan had 11 GPa for slab timber; R47 (13 Nov) made it the timber face's 1.5 GPa, since a 1.8 mm contact's stress lies within about 5 mm of a 20 mm board and the slab cannot enter it.
- Rubber: π√(m/k) with k = 1.1 MN/m. Felt: 12 ms.
- Carpet: 45 ms, plus a second hard pulse at 30–40 ms at −14 dB.
- Hard contacts on hard surfaces add 2–5 micro-collisions within 15 ms, falling 6–12 dB each.

**Shape and variation:**
- Feet land over 5–35 ms for chairs and 3–15 ms for anything over 15 kg, in a seeded order.
- Speed varies ±15 %, mode frequencies ±1.5 % and gains ±2 dB.
- `kind: "settle"` uses 0.25 × the speed and no micro-collisions.

**Extras:**
- a leg rattle: 2–4 short noise ticks at 1.2–3 kHz within 60 ms, at −18 dB;
- a seat puff: brown noise, 40 ms, low-passed at 600 Hz, at −24 dB;
- a cloth hem: pink noise, 90 ms, band-passed at 2–6 kHz, at −30 dB, when `clothed`;
- castors: a 2-pulse roll-bump 25 ms apart, rubber contact.

**Level:** set the peak to `SET_DOWN_TOUCH_DB + 3·log10(mass/4) + 10·log10(speed/1)`, clamped to [−32, −16] dBFS.

**Space:** the direct sound is panned equal-power from `azimuthRad` at `direct.gain`. Each reflection is added at its delay as a one-pole low-passed copy at its 1 kHz gain, with the 4 kHz/1 kHz gain ratio setting the pole.

**Ceiling:** a final first-order shelf at −3 dB above 4 kHz, then a 12-pole low-pass at 14 kHz (cascaded RBJ biquads).

- [ ] **Step 1: Write the failing tests** in `render.test.ts`:
  - every crafted slug on every surface it can stand on renders, with no NaN, no |sample| ≥ 1, a peak in [−32, −16] dBFS, and the same samples for the same seed;
  - carpet's spectral centroid is < 0.5 × oak boards' for `chiavari-chair`, and its Schroeder T20 of the body is shorter;
  - `chiavari-chair` on `stage-deck` has a 60–200 Hz energy share (`bandEnergy`) > 1.5 × its share on `oak-boards-joists`;
  - `reception-room` (`timber-on-slab`) has a 60–200 Hz share < 0.7 × `grand-hall`'s for the same chair;
  - `onsetTimesMs` of `chiavari-chair` on oak shows 2–4 onsets spanning 5–35 ms;
  - the decay of the `mic-stand` (steel), measured as T20 of a 1 kHz band, is > 2 × that of `chiavari-chair` (wood);
  - K-weighted loudness across all slugs on `oak-boards-joists` spans ≤ 8 dB, and across the common pieces (`chiavari-chair`, `banquet-chair`, `round-table-6ft-white`, `trestle-6ft`, `poseur-table`) ≤ 4 dB;
  - energy above 14 kHz is < 0.5 %;
  - 20 seeds of the same piece and surface stay within 3 dB of each other in K-weighted loudness;
  - `bodyFor("imported-thing", 1.7)` renders finite;
  - the median of 10 renders of one set-down is under 15 ms (a guard for a loaded test machine; the device figures come in Task 9).
- [ ] **Step 2: Run** `vitest run src/lib/set-down/__tests__/render.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `modes.ts` and `render.ts`. Each mode is a 2-pole resonator driven by the foot's force pulse (a 1 − cos window over the contact time). A dense bank (`ModeBank.count` modes spread log-uniformly over [lowHz, highHz], seeded) is cheaper as resonators than as sines.
- [ ] **Step 4: Run.** Expected: PASS. If a feature test misses, tune only the pinned EST values (masses, part lengths, shares), never the thresholds, and record what changed in the commit.
- [ ] **Step 5: Commit** with the message "Render each piece landing on its surface, from its own modes (T-677)".

### Task 7: The offline ray tracer and the calibration

**Files:**
- Create: `tools/set-down-acoustics/raytrace.py`, `tools/set-down-acoustics/rooms.json` (exported from `rooms.ts` by `tools/set-down-acoustics/export-rooms.test.ts`, a Vitest file that writes the JSON when `EXPORT=1`), `tools/set-down-acoustics/results.json`, `tools/set-down-acoustics/README.md`
- Modify: `lib/set-down/rooms.ts` (`calibration` values)
- Test: `lib/set-down/__tests__/calibration.test.ts`

**Interfaces:**
- Consumes: `ROOM_ACOUSTICS`, `reverberationTimes` and `contentsAbsorption` (Task 3).
- Produces: `results.json`, shaped as `{ "<slug>": { "empty": [7 seconds], "dressed": [7 seconds], "rays": 20000, "seed": 1 } }`; and calibration factors in `rooms.ts`.

**The ray tracer** (`raytrace.py`, numpy only). As built (rulings R28, R33 and R50), each room is traced as a box with the model's volume and surface areas, the Grand Hall with a spherical cap of the scanned dome's volume; the two-part rooms become the rectangle with their floor's area and their walls' perimeter. So the trace tests Eyring's diffuse-field assumption, not the absorption data or the rooms' outlines. The geometry as first planned:
- **Geometry:**
  - each room is a prism of its floor polygon and height;
  - the Grand Hall adds a dome: a cylinder of radius 3.5 m and height 1.5 m with a hemisphere cap, over the centre;
  - each surface's material comes from `rooms.json`. Wall materials are spread by area share as a per-wall mixture, an acknowledged simplification written in the README.
- **Tracing:**
  - 20,000 rays per band from a source at (0.3 W, 1.2 m, 0.25 L);
  - specular reflection with scattering coefficient 0.2 (Lambert);
  - energy × (1 − α) per hit, plus air loss;
  - a receiver sphere of radius 0.6 m at the centre, 1.2 m up;
  - histogram arrivals in 1 ms bins up to 6 s, Schroeder-integrate, and report T20.
- **Contents:** the dressed case adds the absorption of `referenceDinner(slug)` (Task 3) to the floor, exported with the rooms.
- **Memory:** check memory with `wait-memory.sh 2048 1024 1` first. The run should stay under 300 MB.

**Calibration:** for each room and band, calibration = tracer empty ÷ Eyring empty, clamped to 0.7–1.3. Bands where the tracer's T20 fit has r² < 0.95 keep 1.

- [ ] **Step 1: Write the failing test** in `calibration.test.ts`. It reads `tools/set-down-acoustics/results.json` and checks, for 250 Hz to 4 kHz, every room, empty and dressed:
  - |model − tracer| / tracer ≤ 0.15;
  - the Grand Hall's empty mid band lies in 2.0–3.8 s, a plausibility band from the first estimate (2.14 s with the curtains drawn, about 3.5 s with them open) and La Redoute's measured 3.2 s, or the hall is on the test's explicit list of range exceptions (R50: a named constant, as `GALLERY_NON_DIFFUSE` is, never a README heading).
  - As built and amended (R40, R50, R51): fitted on empty, then within 15 % half and fully laid from 250 Hz to 8 kHz, with the change with fullness within 15 % too; results.json records the sha256 of the rooms.json and the raytrace.py it came from, and a test checks both; every room has a plausibility row in the README.
- [ ] **Step 2: Run** `vitest run src/lib/set-down/__tests__/calibration.test.ts`. Expected: FAIL (`results.json` is missing).
- [ ] **Step 3: Export the rooms** with `EXPORT=1 pnpm --filter @omnitwin/web exec vitest run ../../tools/set-down-acoustics/export-rooms.test.ts`, then run `python tools/set-down-acoustics/raytrace.py tools/set-down-acoustics/rooms.json tools/set-down-acoustics/results.json`. Expected: it prints each room's empty and dressed T20 per band. Run it twice with seeds 1 and 2 and keep the run only if the two agree within 3 % (the silent-corruption rule).
- [ ] **Step 4: Fit `calibration`** in `rooms.ts` and run the test. Expected: PASS.
- [ ] **Step 5: Commit** `tools/set-down-acoustics/* lib/set-down/rooms.ts lib/set-down/__tests__/calibration.test.ts` with the message "Check each room's echo against a ray-traced model of its real shape (T-677)". (That subject, on f8e30804, overstates the trace: it is of boxes with each room's volume and areas, as its body says. R50; the PR body corrects it.)

### Task 8: Open PR 1

- [ ] **Step 1:** Run `pnpm --filter @omnitwin/web exec vitest run src/lib/set-down` and `pnpm --filter @omnitwin/web exec tsc --noEmit` (delete `packages/web/tsconfig.tsbuildinfo` first). Run lint with `pnpm --filter @omnitwin/web exec eslint src/lib/set-down`. Expected: all clean.
- [ ] **Step 2:** Push the branch. Open PR "Furniture set-down sound, 1 of 3: the engine (T-677)" against master, and bind it with `ccd_pr`. The body follows the repo's template and says that nothing is wired, the evidence (test names and figures), and that PR 2 is the listening page.
- [ ] **Step 3:** Tell the planner lead (my report) that PR 1 is ready for the merge queue, and that the chrome builder must hear the three changes listed in the spec's Ownership section before PR 3.

## PR 2: the listening page and Blake's ear test

### Task 9: The listening page

**Files:**
- Create: `tools/set-down-listening/page.ts`, `tools/set-down-listening/page.html`, `tools/set-down-listening/build.mjs`, `tools/set-down-listening/README.md`
- Test: `tools/set-down-listening/page.check.mjs`, a Playwright check against the built file once memory allows

**Interfaces:**
- Consumes: every `lib/set-down/*` module from PR 1.
- Produces: `tools/set-down-listening/out/index.html` (ignored by Git; `--out <folder>` builds elsewhere), a single self-contained file, published as a private claude.ai page.

**What the page does:**
- **Controls:** a room (six), what it lands on (the room's floor, a stage deck, the dance floor, a table top for AV), a piece (all 44, by family), dressing (empty ↔ `referenceDinner(room)`, a slider from 0 to 100 % that takes that share of its items), a distance (2–6 m), "Set it down", "Move it" (a settle), and "Lay out a dinner" (a cascade of 8 from the reference layout).
- **Readouts:** each band's reverberation time, and each render's milliseconds on this device.
- **Audio:** the page's own minimal Web Audio graph mirrors the registry's: a stereo source to a dry gain, a send to a ConvolverNode with `renderRoomTail`, a master at 0.6, and a limiter at −12 dB, ratio 12, attack 3 ms, release 120 ms, with a −6.6 dB trim.
- **Device figures:** these are kept with the page's database capability, keyed by device and slug.

**Before writing the page:**
1. Call `Artifact` with action `quickstart` and intent `other`.
2. Load the `artifact-design` and `artifact-capabilities` skills.
3. Follow their contract: title "Set-down sound", colour tokens with dark mode, phone width with a 16 px gutter.

- [ ] **Step 1:** Write `page.check.mjs`. It opens the built page in Chromium and checks:
  - every control renders;
  - "Set it down" starts the audio without errors in the console;
  - the reverberation readout for the Grand Hall shows a lower mid band at 100 % dressing than at 0 %.
- [ ] **Step 2:** Write `page.ts`, `page.html` and `build.mjs`. `build.mjs` uses esbuild, resolved from Vite's own dependency with `createRequire`, to bundle `page.ts` as an IIFE and inline it into `page.html`.
- [ ] **Step 3:** Build with `node tools/set-down-listening/build.mjs`, then wait until the machine has memory to spare. When it does, run `node tools/set-down-listening/page.check.mjs`. Expected: PASS. If memory doesn't allow, say the check is not run, and why.
- [ ] **Step 4:** Publish with `Artifact` (icon "sound", with a one-sentence description). Send Blake the link.
- [ ] **Step 5:** Commit `tools/set-down-listening/*` with the message "A listening page for the set-downs, built from the engine itself (T-700)". Push, and open PR "Furniture set-down sound, 2 of 3: the listening page (T-700)".
- [ ] **Step 6, the ear test:** after Blake has listened (on laptop speakers, earbuds and his phone), ask him with `AskUserQuestion`:
  - "How do the set-downs sound?" Options: "Ship them (Recommended)"; "Change some"; "Start again".
  - "Is the echo right?" Options: "Yes (Recommended)"; "Too much"; "Too little".
- [ ] **Step 7:** Feed changes back through Task 5's and Task 6's EST values and tests. Republish with the same file path, and ask again. Repeat until "Ship them".
- [ ] **Step 8:** Read the device timings with `ArtifactData` (action `list`). Record them in `tools/set-down-listening/README.md` as measured on Blake's phone, with the phone model and the date from the stored record.

## PR 3: the wiring

**Re-planned on 14 November 2026** against master `7c3461e7` (the October text assumed seams that #288 replaced, and a desktop menu that was unmounted on 6 September). The re-plan's ten questions were ruled as R75–R84 (Qn is ruling R(74 + n)):

- **R75 (Q1).** The cascade keeps the approved listening page's selection, its 85–110 ms spacing and its −1 dB step. Each voice plays at its own piece's touchdown, never before. The page's cascade stays byte-identical. There is no "patter" yet.
- **R76 (Q2).** A drop-in renders `kind: "drop"` at speed 1, the approved "Set it down". A let-go or a resting hand's set-down renders `kind: "settle"` at `clamp(0.5 + handSpeed / 3, 0.5, 1)`.
- **R77 (Q3).** A space outside `RoomSlug` clamps each band's time, `reverberantGain` and the send to the six surveyed rooms' empty, calibrated range. No finish is invented.
- **R78 (Q4).** A small `SetDownSound` shell is always mounted. The driver loads at the planner's first idle when the mode is not Off, and at arming at the latest, and the Worker starts at arming. A bundle test keeps the engine out of the planner's static graph. A landing whose driver hasn't loaded by contact is dropped and counted.
- **R79 (Q5).** The gate below holds only Tasks 14a and 14b. Tasks 10, 11, 12, 13 and 15 do not wait for it.
- **R80 (Q6).** A light piece's late exact render plays if it can start within 45 ms of contact, and is silent after that. The tap logs both cases. Impact sounds lagging their visual by a few tens of milliseconds are perceived as one event, and ITU-R BT.1359 puts the detection threshold for late audio at about 125 ms. The 20 ms window stays as a heavy piece's choice between the exact render and a variant.
- **R81 (Q7).** `item.clothed` is passed, so a clothed table's hem is heard. Task 16's evidence carries an A/B pair for Blake.
- **R82 (Q8).** Arming makes `planner-refuse` audible, because Quiet includes refusals. The PR body says so.
- **R83 (Q9).** A browser without module Workers plays no set-downs, because the main thread never renders them (R48).
- **R84 (Q10).** Under reduced motion the render is posted at the in-place announcement, and it plays when it returns.

Rulings made on 18 November that bind part 3:
- **R94.** Task 14a was built before the phone timings, because its Worker serves every outcome of them.
- **R95.** There is no idle-slice tail on the main thread. With no module Workers there are no set-downs (R83), so such a tail would have no listener.
- **R97.** The Robert Adam Room's arch is bare (#449). Blake re-listened on 18 November and judged it right (Task 16, Step 0).
- **R99.** The Worker posts a ready message when it starts.
  - Each job's 10 s watch starts only at ready, with a 30 s limit on the load.
  - Every watch pauses while the page is hidden.
- **R100.** A per-device adaptive render policy (Task 14b) replaces the phone-timings gate on Task 14b. The release lead accepted it on four conditions.
  - It supersedes, for 14b, the gate that answered #416's review item T1 (R48, R79).
  - Blake's phone timings become Task 16's evidence (Step 0b).
- **Exposure.** Under D1, Quiet is sound on, so a shipped part 3 reaches every visitor. Part 3's release is therefore held until Task 16's real-phone evidence (R100, condition 4).

### 1. The seams: what the plan assumed, what master has, what changes

| # | Plan assumption (Oct) | Today's master (7c3461e7) | What changes in the plan |
|---|---|---|---|
| 1 | `placement.ts` `computeSurfaceHeight`, lines 285–332 | `lib/placement.ts:296–332` (doc :281–295). Same rule. It returns 0 at once for a table-dressing applicator (:303) and skips non-scene placements (:308). Coordinates are render space (`RENDER_SCALE` 1.0, `constants/scale.ts:33`). `scaledFurnitureHeight` is private (:79). | Task 10 stands; its anchors move. Tests build positions with `toRenderSpace`. |
| 2 | `canRestOnFurnitureSurface` in `placement.ts` | Moved to `lib/furniture-semantics.ts:42–48`, imported at `placement.ts:7–10`. A stage supports anything; a table supports only projector, laptop and microphone (:13–22). | Task 10 consumes it there. No edit. |
| 3 | `stepFurnitureSettles`, "the `lift < LANDED` block, lines 278–289" | Gone with #288. `touchDown(motion)` is private at `lib/furniture-motion.ts:401–412` and is called at :460 inside `stepFurnitureSettles` (:426–470). It has no id and no listener. | Task 11 hooks the call site at :460, not `touchDown` itself (it has no id). |
| 4 | `subscribeFurnitureTouchdown`, `announceFurnitureReleased`, `subscribeFurnitureReleased` | None exist. `subscribeFurnitureSettleFrames` (:484) gives each frame's live ids for the instancing layer, not contacts. | Task 11 adds one seam, `subscribeFurnitureLandings`, with four callbacks. The "released" seam is dropped (R25). |
| 5 | How a piece came down was not modelled | #288 has three ways down, but records only `dropIn` (:65): a drop-in (`dropInFurniture` :249–258); a let-go (`releaseFurniture` :223–242, which zeroes `carrySpeed` at :231); and a resting hand's set-down (`HOLD_STILL` branch :444–448). | Task 11 adds `landing` and a stashed `handSpeed` to the channel (R25). |
| 6 | Timing from the spec | `CARRY_LIFT` :77 (0.03 / 0.03 / 0.015 m), `HOLD_STILL` :79 (0.4 s), `DROP_HEIGHT` :86 (0.05 m), `SET_DOWN_AIM` :89 (−0.03 m), spring 420 / 28 (`springs.ts:60`) stepped at ≤ 1/240 s (`springs.ts:95`). Stepping it at 60 fps: contact on frame 5 (83.3 ms) at 0.654 m/s for a drop-in, frame 4 (66.7 ms) at 0.558 m/s for a carried light piece, frame 3 (50.0 ms) at 0.434 m/s for a carried heavy one (computed here; Task 11's tests pin them). | These feed Task 11's tests and Task 12's speed rule. |
| 7 | Cascade offsets invented by `planCascade` | `landingDelays` (:282–313): a set's table first, then its chairs 12 ms apart (`SET_STAGGER` :273); a Lay out ripples out over 0.24 s (`RIPPLE` :271). It is applied by `FurnitureMotion.tsx:93–94`. | Task 12's cascade never schedules a voice before its own piece lands (R27). Q1. |
| 8 | Reduced motion plays "at once" | `FurnitureMotion.tsx:86` returns before any drop-in. `SelectionSystem.tsx:446`, :469, :479 and :547 skip carry, settle and release. So under reduced motion nothing touches down. | Task 11 adds an in-place announcement in both places. |
| 9 | `SelectionSystem.tsx` `settleDrop`, lines 410–441, as the move's sound seam | `settleDrop` is at :454–489 (release at :479–482). It is called at :683 (touch) and :1244 (mouse); `returnLiftedPiece` is at :539–551. The store moves pieces live during a drag (:442). | Not a sound seam any more (R25), except to announce in-place landings under reduced motion. |
| 10 | `subscribeFurniturePlaced` | `stores/placement-store.ts:222` (`announcePlaced` :227), called by ten actions (:388 … :977). Remote edits go to the live overlay (`lib/layout-live/live-document.ts:164`) and are never announced. Cloth applicators are never placed (:351). | Unchanged; SetDownSound does not subscribe directly. Task 5's deferred minor (applicators knock) is already met on master; Task 14b keeps a guard test. |
| 11 | `<FurnitureMotion />` at `PlannerScene.tsx:698`; the Canvas wrapper at :606 | `<FurnitureMotion />` at `components/editor/PlannerScene.tsx:721`, inside the `!timelinePreviewActive` fragment :713–725. The canvas host is :619–627, `</Canvas>` :760, `frameloop="demand"` :633. Every chrome mounts it: v2 through `planner-chrome/RoomStage.tsx:21`, and the HUD (#428) also. | Task 14b mounts after :721 and after :760. |
| 12 | Walk mode from `useEditorStore` | `useCockpitStore((s) => s.walkMode)` (`PlannerScene.tsx:346`) | Task 14b reads the cockpit store. |
| 13 | Rooms by slug; the drawn room by `resolveRoomGeometry(space)` | Space slugs equal `RoomSlug`: `packages/api/src/db/seed.ts:83–88` and `packages/types/src/trades-hall-venue-truth.ts:55–62`, matching `isRoomSlug` (`lib/set-down/rooms.ts:456` @a77396cb). `resolveRoomGeometry` (`data/room-geometries.ts:235`) returns the four drawn rooms by name (:183–212) and the galleries from the database outline (seeded 8 × 4 × 3 m). The outline is true (x, z) (#423's analysis). | The reflections use the drawn room as the spec says. Before a space is loaded (null), no sound plays. An unsurveyed slug (R71) is Q3. |
| 14 | The registry: a default to change, a room bus to add | `lib/sound-registry.ts`. `PLANNER_SOUND_DEFAULT_MODE = "off"` (:610). Limiter at :621; `PLANNER_LIMITER_WARMUP_SECONDS` is unexported (:639). The policy (:712–737) reads `PLANNER_SOUND_RECIPES[id]`. The graph (:764–794) is mono, with a fixed "hall" convolver for the rare moments; there is no stereo path, room bus, `audioSession` or tap. The brush cascade is in `playPlannerSound` (:913–952). The arming hook (:856) is mounted only by `SoundControl`, so nothing in the shipped planner arms, and the planner is silent today. The one caller is `lib/place-in-hand.ts:258` (`planner-refuse`). | Task 13 as planned, plus R57, R58, R62, R63, R26 and batch admission. The default flip collides with #357 (section 3). |
| 15 | `SoundControl.tsx`: `usePlannerSoundShortcut(onToggled?)`, `SoundSettings` | `usePlannerSoundShortcut()` takes no argument (:74). `SoundSettings` (:85) is a Segmented radiogroup with pc-* classes. `SOUND_MODE_LINES` is at :47. The speaker is mounted only at `pages/PlannerChromeFixturePage.tsx:109`. | Task 13 adds `onToggled`. |
| 16 | Shift M | `shiftedLetter("m")` (SoundControl :67–70). Measure is `letter("m")`, which has `shift: false` (`lib/planner-keymap.ts:667`, `planner-keys.ts:79–88`). | No clash. Mounted for every chrome from PlannerScene (Task 14b). |
| 17 | `CockpitTopBar.tsx` lines 170–200, the Layers popover, for wide desktops | `CockpitTopBar` has been mounted nowhere since 172bf4a3 (6 Sep, before the plan); only its test renders it. Its "Planning overlays" became "Scene overlays" in `cockpit/ReferenceSceneSettings.tsx:20–58`, inside the desktop More menu (`VerticalToolbox.tsx:1965–1967` button, :2047 mount; `PlannerCockpit.tsx:80` passes `compactDesktop`). | Task 15's desktop row goes in `ReferenceSceneSettings`. CockpitTopBar is not touched. |
| 18 | `VerticalToolbox.tsx` lines 1388–1414, the mobile More sheet | :1406–1438 ("Tools" grid ends :1437; `mobileSheetTitleStyle` :1249) | Anchors only. |
| 19 | `SlateMenu.tsx`: "after the last section" | The last section is the list at `planner-chrome/SlateMenu.tsx:182–211`; the Popover closes at :212. | Anchors only. |
| 20 | (none) | #428 (not on master) adds a third chrome, `?chrome=hud`. Its `planner-hud/HudSheets.tsx` ToolsSheet says the sound setting "follow[s] once that engine can be fetched on its own". | Task 15 adds the row there if #428 has landed. Q4. |
| 21 | A Worker "bundled in this Vite app" | No sound Worker. The house pattern is `components/meshes/crafted/crafted-textures.ts:66–151`: a module-worker probe (:71–80), `FIRST_ANSWER_MS` (:64), `new Worker(new URL(…, import.meta.url), { type: "module" })` (:110), and an in-place fallback. Its worker is `crafted-texture.worker.ts:18–37`. `vite.config.ts:129` sets `worker: { format: "es" }`; the dev warm-up list is at :112–127. | Task 14a follows that pattern. |
| 22 | The engine's room state | `roomConstant` :264, `reverberantGain` :286, `roomState` :292, the default box :308–345 (all @a77396cb, `lib/set-down/room-acoustics.ts`). | Task 12 adds `roomSend` and R71's clamp. |
| 23 | The page's stand-ins | @cdf0734d `tools/set-down-listening/page.ts`: `EAR_HEIGHT_M` :110, `REFERENCE_DISTANCE_M` :114, `REVERB_SEND` :130, the cross-fade :136–137, `LIMITER_WARMUP_S` :144, the start rule in `playVoices` :290–329, `directPath` :489, the cascade :516–541, the ear :548–576 | They move into the engine (Task 12) and the registry (Task 13), and the page imports them. |

### 2. Already done by #288 and later work: no task rebuilds these

- **The contact frame.** `touchDown()` (:401) stops the lift at the support at speed; contact is the frame where `lift <= 0` (:460). (#288, merged 29 Oct.)
- **The landing order.** `landingDelays()` (:282) and its use in FurnitureMotion (:85–95). A cascade reads these delays and never invents its own landing times.
- **The hand.** Carry, lift into the hand, the resting-hand set-down and let-go, with mass classes (`massForCategory` :99, resolver installed at `FurnitureMotion.tsx:77–80`).
- **Bringing the branch up to #288** (R25's precondition). #416's branch merged master 7c3461e7 at d573c30f.
- **Cloth applicators stay silent.** They never become PlacedItems (`placement-store.ts:351`) and are ignored by the surface search (:303).
- **The speaker is never on screen** in the shipped planner. It is mounted only on the fixture page; the spec's "never mount it in the utilities" is already true.
- **The palette's settings store.** Device keys `venviewer.planner-sound` and `venviewer.planner-sound-level` (:51–52) and `SoundSettings`. No production device has a stored choice, because nothing mounted the speaker, so the D1 default reaches everyone.

### 3. Collisions with open pull requests

The scan (`gh pr view <n> --json files`) covered all 44 open PRs against the seam files.

| PR | State | Files it shares with the wiring | Tasks hit | How to sequence |
|---|---|---|---|---|
| **#357** v2 catch-up (T-671/T-680) | open, mergeable | It sets `sound-registry.ts:584–612` to `"quiet"` (D1) with new comment text; changes `planner-sound.test.ts:91–96` and :232–237 (an "off" test that plays `planner-set-table`) and `sound-control.test.tsx` (default-dependent cases); adds the `PlannerScene` `inCanvas` prop (:272–282) and `{inCanvas}` after :722. | 13, 14b | Best: #357 lands first, and Task 13 drops its default edit. Otherwise Task 13 copies #357's D1 hunks verbatim (identical changes merge cleanly) and rebases the retirement edit to the off test once #357 lands; that conflict is mechanical. 14b inserts after :721, so one unchanged line (:722) separates it from #357's insertion, and both apply cleanly. |
| #178, #182, #192, #200 | superseded | #178: registry D1 and planner-sound test. #200: PlannerScene and SelectionSystem. #192: placement.ts. | — | #357's body says it replaces them. Ignore them; their owner closes them once #357 lands. |
| **#428** the HUD (T-723) | open, not draft | `SelectionSystem.tsx` :885 and :1296 (ours: :446–551); `PlannerScene.tsx` :98–105, :324–333, :507–528, :662, :726, :753 (ours: the import near :50, :721, :760); `planner-chrome-flag.ts` (adds `hud`); a bundle test that keeps the HUD's modules off every other planner; a ToolsSheet that reserves Sound | 11, 14b, 15 | No overlapping hunks; either order merges cleanly. If #428 lands first, Task 15 adds the Sound row to its ToolsSheet. Otherwise Task 15's PR body hands the row to T-723's owner. Q4 decides whether the engine "can be fetched on its own", which the HUD asked for. |
| #411 planner bounds | open, conflicting | `placement.ts` :1–5, :107–118, :233–260, :484–540 and `placement-store.ts` | 10 | Task 10 touches :281–332 only, so they are independent. Re-anchor if #411 lands first. |
| #418 | mergeable | `VerticalToolbox.tsx` :1667 and :2041–2049 (beside the `ReferenceSceneSettings` mount) | 15 | Task 15 edits `ReferenceSceneSettings.tsx` itself, not :2047, so there is no overlap. |
| #417, #347 | mergeable | `VerticalToolbox.tsx` ToolBtn :800–1141 | 15 | No overlap with the More sheet (:1406–1438). |
| #388 | mergeable | `VerticalToolbox.tsx` :1538 and :1997; `placement-store.ts`; `planner-keymap.ts` | 15 | No overlap; the wiring only subscribes to the store. |
| #243 | draft, conflicting, held | SelectionSystem, placement.ts, planner-keys and keymap, placement-store, VerticalToolbox :2241 | 10, 11 | Held. Whoever revives it rebases. |
| **#416** the engine | delta review | the engine, `planner-sound.test.ts`, recipes, renderer | all | PR 3 starts from master once #416 has merged. |
| **PR 2** the listening page | branch at cdf0734d, not merged | `tools/set-down-listening/page.ts` | 12, 13 | Tasks 12 and 13 edit page.ts. If PR 2 has not merged when PR 3 starts, PR 3's branch starts from the page branch merged with master. |
| #431 surveyed rooms, web (T-662) | draft | a dev page only | — | No collision now. When T-662 draws the galleries from the survey, the reflections follow with no change here (spec section 4). |

### 5. The gate before Tasks 14a and 14b (rulings R48 and R79)

**Superseded on 18 November 2026:** by R94 for Task 14a, and by R100 for Task 14b. The text below is kept as the gate that was planned. Blake's phone timings are now Task 16's evidence.

Tasks 14a and 14b, the render at the drop, do not start until the listening page has timed renders on real phones (ruling R79). Tasks 12 and 13 do not wait. The page keeps each render's time on the device that ran it. The gate needs:
- the median and worst render times, with the Grand Hall's 18 early reflections, for a Chiavari, a 6 ft round and a staging deck, on the phones Blake uses;
- each set against its time to contact: 50 ms for a carried heavy piece (frame 3), 66.7 ms for light and table pieces (frame 4) and 83.3 ms for a drop-in (frame 5) at 60 fps. Other display rates move the landings: at 75–165 Hz heavy pieces land at 49–56 ms, light and table pieces at 67–69 ms and drop-ins at 80–89 ms, and at 30 fps carried pieces land at 67 ms and drop-ins at 100 ms (frame by frame on master's spring).

Render-at-drop is confirmed only if light and table pieces render inside their time to contact. Heavy pieces keep the render-ahead fallback whatever the timings. If light pieces miss as well, the design comes back for a ruling (R80 names the fallback). Tasks 10, 11, 12, 13 and 15 do not depend on the gate.



### Task 10: Find the support under each foot

**Files:**
- Modify: `lib/placement.ts`. Add `findSupportingItem` directly above `computeSurfaceHeight` (:281–332). Both share one private `supportUnder()` that returns `{ placed, top } | null`, reusing `computeRotatedFootprint` (:63) and `scaledFurnitureHeight` (:79).
- Test: create `lib/__tests__/placement-support.test.ts`.

**Interfaces:**
- Consumes `canRestOnFurnitureSurface` (`lib/furniture-semantics.ts:42`), `isSceneFurniturePlacement` and `isTableDressingApplicatorSlug` (`lib/table-dressing.ts`).
- Produces `findSupportingItem(x: number, z: number, candidate: CatalogueItem, placedItems: readonly PlacedItem[], excludeIds: ReadonlySet<string>): PlacedItem | null`:
  - x and z are in render space;
  - it returns the highest compatible support whose rotated, scaled footprint contains the point, or null for the floor;
  - it returns null at once for an applicator candidate;
  - it skips non-scene placements and unknown catalogue ids;
  - on a tie it keeps the first in `placedItems` order, as today's strict `>` does (:321).
- `computeSurfaceHeight` returns `supportUnder(...)?.top ?? 0`, the same numbers as before.

- [ ] **Step 1: Write the failing tests** in `placement-support.test.ts`:
  - a `chiavari-chair` at a `staging-deck-6x4`'s centre returns the deck;
  - the same with the deck in `excludeIds` returns null;
  - a `laptop` over `round-table-6ft` returns the round, and a `chiavari-chair` over it returns null;
  - a deck stacked on a deck returns the upper one;
  - two equal-height decks overlapping return the first in order;
  - a deck at `rotationY = π/2`: a point inside the turned footprint and outside the unturned one returns the deck;
  - a deck at `scale: 1.5`: a point between the unscaled and scaled half-widths returns the deck;
  - a foot at the deck's half-width + 0.01 m returns null, and at − 0.01 m the deck;
  - a `white-table-cloth` candidate returns null;
  - a placed item with an unknown `catalogueItemId` is skipped;
  - for 200 points from `seededRandom(1)` over a mixed layout (two decks, a stacked deck, a round, a `dancefloor-panel`, chairs), `computeSurfaceHeight` equals the found item's top, or 0, exactly (`toBe`), for `chiavari-chair`, `laptop` and `mic-stand` candidates.
- [ ] **Step 2: Run** `$HOLD "… task 10" bash -c 'cd packages/web && pnpm exec vitest run src/lib/__tests__/placement-support.test.ts'`. Expected: FAIL (`findSupportingItem` is missing).
- [ ] **Step 3: Implement**, then run that file with `src/lib/__tests__/placement.test.ts src/stores/__tests__/placement-store.test.ts`. Expected: PASS, with existing behaviour unchanged.
- [ ] **Step 4: Commit** `lib/placement.ts lib/__tests__/placement-support.test.ts` with the message "Name the piece a placement stands on, not just its height (T-700)".

### Task 11: Landing seams in the motion

Already on master: the contact frame, `landingDelays`, the carry and let-go, and mass classes (section 2). This task adds only the seam.

**Files:**
- Modify `lib/furniture-motion.ts`:
  - `MotionChannel` (:42–70) gains `landing: FurnitureLanding` and `handSpeed: number`, with defaults in `channel()` (:120–143);
  - `carryFurniture` (:161–178) calls `pickedUp(id, mass === "heavy")` when the piece was not in hand (`liftTarget === 0` before the call). That includes a piece caught mid-drop, which also tells the listener its drop will not land;
  - `releaseFurniture` (:223–242) copies `carrySpeed` into `handSpeed` before :231, sets `landing = "let-go"`, and calls `dropStarted` only when `lift > 0`. A piece a resting hand already set down plays nothing (R25);
  - `dropInFurniture` (:249–258) sets `landing = "drop-in"` and calls `dropStarted(id, "drop-in", 0, delaySeconds)`;
  - the `HOLD_STILL` branch (:444–448) sets `landing = "set-down"` and `handSpeed = carrySpeed`, and calls `dropStarted(id, "set-down", handSpeed, 0)`;
  - the call site at :460 reads `Math.abs(lift.velocity)`, calls `touchDown(motion)`, then calls `touchedDown(id, landing, speed, handSpeed)`;
  - new exports (below). The listeners are kept in an array replaced on subscribe and unsubscribe and iterated by index, so the frame path allocates nothing. (`stepFurnitureSettles` already allocates its `live` array at :432; that is not this seam's.)
- Modify `components/editor/FurnitureMotion.tsx:86`: under reduced motion, call `announceFurnitureLandedInPlace(ids, "drop-in", 0)` before returning.
- Modify `components/SelectionSystem.tsx`:
  - `moveDragTo` (:446–449) measures the carry under reduced motion too; `carryFurniture` still runs only without it;
  - `settleDrop` (:479–482) and `returnLiftedPiece` (:547), under reduced motion, call `announceFurnitureLandedInPlace(lastMovingIds.current, "let-go", handSpeed)`, where handSpeed is the measured carry's `hypot(vx, vz)`, or 0.
- Test: create `lib/__tests__/furniture-motion-landings.test.ts`, `components/__tests__/SelectionSystem.landings.test.tsx` (set up as `SelectionSystem.motion.test.tsx`) and `components/editor/__tests__/FurnitureMotion.landings.test.tsx` (`mountInStubRoot` and `advance`, as `FurnitureMotion.instanced.test.tsx:1–47`).

**Interfaces:**
```ts
export type FurnitureLanding = "drop-in" | "let-go" | "set-down";
export interface FurnitureLandingListener {
  /** A hand took the piece (or caught it mid-drop); heavy = stage, AV, lighting. */
  pickedUp(id: string, heavy: boolean): void;
  /** It starts down: a drop-in after `delaySeconds`, a let-go or a resting hand's set-down at once. */
  dropStarted(id: string, landing: FurnitureLanding, handSpeed: number, delaySeconds: number): void;
  /** The frame it reaches its support, at |lift.velocity| m/s. */
  touchedDown(id: string, landing: FurnitureLanding, contactSpeed: number, handSpeed: number): void;
  /** Reduced motion: it is down with no motion and no contact frame. */
  landedInPlace(id: string, landing: FurnitureLanding, handSpeed: number): void;
}
export function subscribeFurnitureLandings(listener: FurnitureLandingListener): () => void;
export function announceFurnitureLandedInPlace(ids: Iterable<string>, landing: FurnitureLanding, handSpeed: number): void;
export function furnitureLandingListenerCount(): number;
```

- [ ] **Step 1: Write the failing tests** in `furniture-motion-landings.test.ts`, stepping at 1/60:
  - `dropInFurniture("a")` calls `dropStarted("a", "drop-in", 0, 0)` at once, and `touchedDown` exactly once on step 5, where the pose's lift first reads 0, at 0.654 ± 0.01 m/s;
  - drop-ins with delays 0 and 0.1 s touch down 6 steps apart;
  - a light carry at 1.2 m/s then `releaseFurniture` gives `pickedUp(id, false)` once, `dropStarted("let-go", 1.2, 0)`, then `touchedDown` on step 4 at 0.558 ± 0.01 with handSpeed 1.2;
  - with the resolver returning `"heavy"`: `pickedUp(id, true)`, and touchdown on step 3 at 0.434 ± 0.01;
  - a hand at rest past `HOLD_STILL` gives `dropStarted("set-down", h < 0.05)` and its `touchedDown`; a later `releaseFurniture` calls neither;
  - `clearAllFurnitureSettles()` before contact means no `touchedDown`;
  - a piece caught mid-drop by `carryFurniture` gives `pickedUp`, and no `touchedDown` until it is released;
  - `announceFurnitureLandedInPlace(["a", "b"], "let-go", 0.8)` calls `landedInPlace` twice and nothing else;
  - unsubscribing returns `furnitureLandingListenerCount()` to its value before;
  - 180 pieces dropping with one counting listener: the median step over 30 frames is under 0.5 ms (a guard; review checks that no object or array is made on the seam's path).

  In `FurnitureMotion.landings.test.tsx`: under reduced motion (`matchMedia` stub), `placeItem` gives `landedInPlace(id, "drop-in", 0)` and no `dropStarted`; without it, `dropStarted("drop-in")`.

  In `SelectionSystem.landings.test.tsx`: under reduced motion, a mouse drag and release of a chair gives one `landedInPlace(id, "let-go", h > 0)`; without it, a `dropStarted("let-go")` and no `landedInPlace`.
- [ ] **Step 2: Run** those three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them with `src/lib/__tests__/furniture-motion.test.ts src/components/__tests__/SelectionSystem.motion.test.tsx src/components/__tests__/SelectionSystem.touch.test.tsx src/components/editor/__tests__/FurnitureMotion.instanced.test.tsx src/components/editor/__tests__/FurnitureMotion.doors.test.tsx`. Expected: PASS, with the existing motion unchanged.
- [ ] **Step 5: Commit** with the message "Tell listeners when a piece starts down and the frame it lands, and how it came down (T-700)".

### Task 12: The driver's arithmetic, in the engine

This moves the page's stand-ins (R57, R58, R61) and folds in R18, R19, R26, R27 (Q1, ruling R75), R37 and R71 (Q3, ruling R77).

**Files:**
- Create in `lib/set-down/`: `timing.ts`, `cascade.ts`, `listener.ts`, `fatigue.ts`, `voice.ts`.
- Modify `lib/set-down/room-acoustics.ts` (@a77396cb :264–345): add `roomSend`; add `send` to `RoomState` (:50); apply R71's clamp in `roomState` for a non-surveyed slug.
- Modify `tools/set-down-listening/page.ts` (@cdf0734d): delete the stand-ins at :110–130, :489 and :510–541, and the ear arithmetic at :548–576, importing them from the engine instead. Keep `RIGHT`, the slider and the room-end viewer, which are the page's own.
- Test: create `lib/set-down/__tests__/wiring-pure.test.ts`; add cases to `lib/set-down/__tests__/room-acoustics.test.ts`.

**Interfaces:**
- `timing.ts`:
  - `interface AudioClock { readonly currentTime: number; readonly outputLatency: number; readonly sampleRate: number }`;
  - `HEARD_WINDOW_S = 0.045`: a late exact render still plays if it can start within 45 ms of its contact frame (ruling R80);
  - `presentDelayFor(frameDeltaSeconds: number): number` clamps to [1/240, 1/30];
  - `setDownStartTime(clock: AudioClock, presentDelaySeconds: number, onsetSeconds: number): number` returns `currentTime + max(0, presentDelay − outputLatency − onsetSeconds)`. It lands R37's `onsetSeconds` (carpet's bottoming thud) on the frame. The heard onset is never before the frame.
- `cascade.ts` (the page's :516–541 moved, plus Q1):
  - constants `CASCADE_VOICES = 8`, `CASCADE_GAP_S = 0.085`, `CASCADE_GAP_SPREAD_S = 0.025`, `CASCADE_STEP_DB = -1`;
  - `interface CascadePiece { readonly id: string; readonly family: BodyFamily; readonly landsAfterSeconds: number }`;
  - `interface CascadeVoice { readonly id: string; readonly offsetSeconds: number; readonly levelDb: number }`;
  - `planCascade(pieces: readonly CascadePiece[], seed: number): readonly CascadeVoice[]`:
    - 1–3 pieces each get a voice at their own `landsAfterSeconds`, at 0, −1 and −2 dB;
    - 4 or more take the page's selection: one piece of each non-chair family in input order, then chairs at `floor((k + 0.5)·n / count)`, up to 8;
    - the selection is stably ordered by `landsAfterSeconds`;
    - `offset₀ = landsAfter₀` and `offsetₖ = max(landsAfterₖ, offsetₖ₋₁ + GAP + SPREAD·random())`, with `seededRandom(seed)` drawn once per voice after the first, as the page draws it;
    - the level falls 1 dB per voice.
- `listener.ts` (R61, R18, R19):
  - `EAR_HEIGHT_M = 1.6`, `REFERENCE_DISTANCE_M = 2`, `EAR_REACH_M = { min: 2, max: 6 }`;
  - `interface Ear { readonly position: Vec3; readonly right: Vec3 }`;
  - `earFor(camera: { readonly position: Vec3; readonly right: Vec3 }, landing: Vec3, walking: boolean, reach = EAR_REACH_M): Ear`:
    - `reach = clamp(|camera − landing|, reach.min, reach.max)`;
    - the ear stands on the landing's horizontal line toward the camera at `sqrt(max(0, reach² − (1.6 − landing.y)²))`, with y = 1.6;
    - its right is the camera's right made horizontal and normalised, or +z if degenerate;
    - when walking it is `(camera.x, 1.6, camera.z)`;
  - `clampEarToRoom(ear: Ear, geometry: RoomGeometry | null): Ear` puts the ear inside the polygon (the nearest point inset 0.3 m) with `0.3 ≤ y ≤ ceiling − 0.3`, or `ceiling / 2` when the ceiling is under 0.6 m. The ear is left as it is when the geometry is null;
  - `directPath(ear: Ear, source: Vec3): { readonly gain: number; readonly azimuthRad: number; readonly distanceM: number }` gives gain `min(1, 2 / max(d, 1e-6))` and `lateralAzimuth(source − ear, ear.right)` (R18).
- `fatigue.ts` (R26): `class SetDownFatigue { levelDb(nowMs: number): number; record(nowMs: number, count: number): void }`, with a 5-minute window:
  - nothing changes up to 20 plays in the window;
  - after that the level falls linearly to −3 dB at 30 plays;
  - it recovers as the window empties;
  - two consecutive readings differ by no more than 1 dB.
- `voice.ts` (the main-thread gather, pure):
  - `footPositions(item: PlacedItem, body: SetDownBody): readonly { readonly x: number; readonly z: number }[]` rotates as three.js does about +y (`x' = x cos θ + z sin θ`, `z' = −x sin θ + z cos θ`), then translates, in render space;
  - `landingRender(landing: FurnitureLanding, handSpeed: number): { readonly kind: "drop" | "settle"; readonly speed: number }` and `settleSpeedFor(handSpeed)` (Q2, ruling R76);
  - `voiceInput(args: { item; placedItems; roomSlug; geometry: RoomGeometry | null; acoustics: RoomAcoustics; ear: Ear; landing: FurnitureLanding; handSpeed: number; seed: number; sampleRate: number }): { readonly input: SetDownInput; readonly directGain: number; readonly surfacesKey: string; readonly slug: string }`:
    - the slug is `getCatalogueItem(item.catalogueItemId)?.slug ?? item.catalogueItemId`, as the page does;
    - the body is `bodyFor(slug, item.scale)`;
    - each foot goes through `findSupportingItem` (excluding the item itself), then `surfaceKindForSupport`, then `surfaceResponse`;
    - the source is `(toRealWorld(x), item.y, toRealWorld(z))`;
    - the reflections are `earlyReflections(reflectionRoomFor(acoustics, geometry), source, clampEarToRoom(ear, geometry))`, or none when the geometry is null;
    - `direct = { gain: 1, azimuthRad }`, a unit-gain render (R57), with `directGain = directPath(...).gain` returned for the dry GainNode;
    - `clothed` is `item.clothed` (Q7, ruling R81).
- `room-acoustics.ts`:
  - `roomSend(room: RoomAcoustics, contents: BandValues): number` is `sqrt(32π / roomConstant(room, contents))`. It is R58's `REVERB_SEND × reverberantGain` with R_ref cancelled: EST, from Q = 2 on the floor and r_ref = 2 m. The send carries the whole render, early reflections included (R64), which Blake heard as right;
  - `RoomState` gains `send`;
  - R71 (Q3, ruling R77): for `!isRoomSlug(room.slug)`, the times are clamped per band into [min, max] of the six rooms' empty times, and `reverberantGain` and `send` into the six rooms' empty range.

- [ ] **Step 1: Write the failing tests** in `wiring-pure.test.ts`:
  - **Timing:**
    - the start is never before `currentTime`;
    - with `outputLatency` 0.005, a present delay of 0.016 and onset 0, it starts at +0.011;
    - with onset 0.004 it starts at +0.007, so the onset is heard at the frame;
    - with `outputLatency` 0.06 it starts now;
    - `presentDelayFor(0.5)` is 1/30, and `presentDelayFor(0)` is 1/240.
  - **The cascade:**
    - over the six rooms' `referenceDinner` and seeds 1–20, with every `landsAfterSeconds` 0, `planCascade` returns exactly the ids, offsets and levels of the page's stand-in at cdf0734d (held in the test as a reference implementation, as `planner-sound.test.ts` holds `uncachedFft`);
    - with real delays from `landingDelays` for 180 chairs and 18 rounds: 8 voices, no voice before its own piece's landing, at most 3 in any 250 ms, and levels strictly falling;
    - 2 pieces give 2 voices at their own landings.
  - **The ear:**
    - a camera 20 m away puts the ear 6 m from the landing, and one 1 m away puts it 2 m from the landing, both at y = 1.6;
    - when walking, the ear is the camera at 1.6 m;
    - the page's `playPiece` and `playCascade` ears at cdf0734d are reproduced to 1e-12;
    - an ear above the Robert Adam Room's drawn 2.18 m ceiling clamps to ≤ 1.88 m, and one outside the Reception Room's L clamps inside it;
    - a source to the ear's right has azimuth > 0;
    - the direct gain at 6 m is 1/3.
  - **Fatigue:** plays 1–20 read 0 dB; the 25th reads −1.5 ± 0.01; 30 and beyond reach −3, never lower; a jump never exceeds 1 dB between readings; after 5 quiet minutes it climbs back to 0 in steps of ≤ 1 dB.
  - **The voice:**
    - a foot at (+0.5, 0) under `rotationY = π/2` lands at (0, −0.5) plus the item's position;
    - a chair over a deck gets four `stage-deck` surfaces, and one straddling the deck's edge gets mixed surfaces;
    - `voiceInput` for an unknown slug at `scale: 1.7` is finite;
    - `direct.gain` is 1 and `directGain` is `min(1, 2/d)`;
    - with `geometry` null there are no reflections;
    - a drop-in renders `{ "drop", 1 }`, and a let-go at 0 and 3 m/s renders `{ "settle", 0.5 }` and `{ "settle", 1 }`.

  In `room-acoustics.test.ts`:
  - `roomSend` is 0.9793057 ± 1e-6 for the empty Grand Hall and 0.8288978 ± 1e-6 dressed with `referenceDinner("grand-hall")` (the page's probe, ledger 14 Nov 17:10);
  - `roomState(...).send` equals `roomSend`;
  - the null-space box reads every band inside the surveyed envelope, no longer 6.52 s;
  - the six surveyed rooms' `rt` are unchanged by R71.
- [ ] **Step 2: Run** `src/lib/set-down/__tests__/wiring-pure.test.ts src/lib/set-down/__tests__/room-acoustics.test.ts src/lib/set-down/__tests__/calibration.test.ts`. Expected: FAIL in the new cases only.
- [ ] **Step 3: Implement** the five modules and the room-acoustics change. Run. Expected: PASS.
- [ ] **Step 4: Commit** the engine with the message "Time each set-down to its frame, shape the cascade and place the ear, in the engine (T-700)".
- [ ] **Step 5: Update the page** to import `EAR_HEIGHT_M`, `REFERENCE_DISTANCE_M`, `earFor`, `directPath`, `planCascade` and `RoomState.send`.
  - Build with `node tools/set-down-listening/build.mjs <listening>/index.html`, where `<listening>` is a local folder outside the repo.
  - Run `node tools/set-down-listening/page.check.mjs <listening>/index.html` under the house's browser hold, a script kept outside the repo. Expected: 80/80 PASS, and the send probe still prints 0.9793057 / 0.8288978.
  - Commit `tools/set-down-listening/page.ts` with the message "The listening page takes its ear, cascade and send from the engine (T-700)". Republish only if the bundle changed in behaviour (it should not).

### Task 13: The registry plays set-downs through the room

This folds in R57, R58, R62, R63 and R26, and covers D1, the policy, the wake, the audio session and the tap.

**Files:**
- Modify `lib/sound-registry.ts`:
  - `SOUND_REGISTRY` (:61–62, :73): retire the three ids and add `"planner-set-down"`;
  - the header comment (:584–605): take #357's hunk verbatim, then add the set-down sentences;
  - `PLANNER_SOUND_DEFAULT_MODE` (:610) becomes `"quiet"`, the same line as #357 and #178;
  - export `PLANNER_LIMITER_WARMUP_SECONDS` (:639);
  - delete the cascade constants (:640–642);
  - `PlannerSoundPolicy.decide` (:716) takes its set and gap from `ruleFor(id)`;
  - `PlannerGraph` (:740) and `buildPlannerGraph` (:764) gain the room bus (`room: GainNode`) and the current `wet`;
  - `armPlannerSound` (:843) sets the audio session and notifies listeners that the context is armed;
  - `playPlannerSound` (:913–952) loses the brush cascade;
  - add the set-down path below it, and extend `__resetPlannerSoundForTests` (:979).
- Modify `lib/planner-sound-recipes.ts`: `PLANNER_SOUND_IDS` (:17–31) and the recipes of `planner-set-table`, `planner-set-chair` and `planner-brush` are retired. `PLANNER_TOUCH_DB` (#416) is kept (R3, R4).
- Modify `components/planner-chrome/SoundControl.tsx`: `SOUND_MODE_LINES.quiet` (:49) becomes "Pieces set down in the room, refusals, the evening, Present and Send."; `usePlannerSoundShortcut(onToggled?)` (:74).
- Modify `tools/set-down-listening/page.ts` (@cdf0734d :136–144): import the warm-up and cross-fade constants from the registry.
- Test: update `lib/__tests__/planner-sound.test.ts` and `components/planner-chrome/__tests__/sound-control.test.tsx` (its default-dependent cases, as #357 does); create `lib/__tests__/planner-set-down-sound.test.ts`. Its `FakeContext` follows `planner-sound.test.ts` and adds `createConvolver`, a two-channel `createBuffer`, recorded `AudioParam` ramps, `outputLatency` and `baseLatency`, `sampleRate`, and `resume`/`suspend` promises.

**Interfaces:**
```ts
export const PLANNER_LIMITER_WARMUP_SECONDS = 0.25;      // R63, now exported
export const PLANNER_ROOM_CROSSFADE_SECONDS = 0.1;       // R62
export const PLANNER_ROOM_RELEASE_SECONDS = 0.15;        // R62
export interface SetDownVoice {
  readonly render: Stereo & { readonly onsetSeconds: number };   // a unit-gain SetDownRender (R57)
  readonly startAt: number;     // context seconds (setDownStartTime); held to ≥ the warm-up (R63)
  readonly levelDb: number;     // the cascade's step; the registry adds SetDownFatigue (R26)
  readonly directGain: number;  // directPath's gain, on the dry GainNode only (R57, R11)
  readonly send: number;        // RoomState.send, unscaled by distance (R58)
  readonly tap?: { readonly slug: string; readonly surface: string; readonly rtMid: number; readonly contactMs: number };
}
export interface SetDownBatch { play(voice: SetDownVoice): boolean }   // valid 1.5 s; false once Off or hidden
export function beginSetDownBatch(count: number): SetDownBatch | null; // one policy decision, recorded as min(count, 8) plays
export function setPlannerRoomTail(tail: Stereo, key: string): boolean; // false if not armed or tail.sampleRate ≠ the context's
export function plannerAudioClock(): AudioClock | null;                // outputLatency, else baseLatency, else 0
export function wakePlannerSound(): void;                              // resume if suspended; restart the 20 s timer; plays nothing
export function subscribePlannerSoundArmed(listener: (sampleRate: number) => void): () => void;
export function usePlannerSoundShortcut(onToggled?: (mode: PlannerSoundMode) => void): void; // SoundControl.tsx
```

**The graph:**
- Each voice is a two-channel `AudioBufferSource`, then a level gain (`levelDb` plus fatigue).
- The level gain feeds a dry gain (`directGain`) into the master, and a send gain (`send`) into the room bus.
- The room bus feeds the current convolver (`normalize = false`), then its fade, then the master before the limiter.
- A new tail fades in over 0.1 s while the old one fades out. The old one is disconnected after 0.15 s.
- The palette's own hall convolver is unchanged.

**Resuming.** A play while the context is suspended waits for `resume()` to settle and schedules against the resumed clock (Review Focus 1). `wakePlannerSound` at drop start (Task 14b) normally has it running by contact.

**Arming** sets `navigator.audioSession.type = "ambient"` where it exists, typed through a narrow local interface.

**The tap.** With `?soundtap=1` the registry keeps `window.__venSoundTap = { log, record(seconds): Promise<Blob> }`, using a `MediaStreamAudioDestinationNode` on the master and a `MediaRecorder`. The type is declared in the registry and the tap is created only on that flag.

- [ ] **Step 0:** Run `git grep -n "planner-set-table\|planner-set-chair\|planner-brush" -- packages`. At master the hits are only `planner-sound-recipes.ts`, `sound-registry.ts` and `planner-sound.test.ts`. Every hit changes in this task.
- [ ] **Step 1: Update `planner-sound.test.ts`:**
  - the default is `"quiet"` (#357's edit);
  - the set-table, set-chair and brush cascade tests go;
  - the "off" test plays `planner-refuse`;
  - the hero rule becomes: each of horizon, Send, Present and act peaks ≤ `SET_DOWN_TOUCH_DB + 6`.

  Update `sound-control.test.tsx`'s default-dependent cases as #357 does.
- [ ] **Step 2: Write `planner-set-down-sound.test.ts`:**
  - before arming, or when Off, `beginSetDownBatch` is null;
  - a batch of 3 starts three two-channel sources at their `startAt`, each ≥ 0.25. Each runs level → dry (gain = directGain) → master, and level → send (gain = send) → room bus. The send gain never equals `send × directGain` unless directGain is 1;
  - a second batch 30 ms later is refused (gap 45 ms);
  - after a batch of 8, a single play within the second is refused ("too-many");
  - with the tab hidden the batch is refused;
  - Off mid-batch makes `play` return false;
  - suspended: `wakePlannerSound` resumes once and restarts the 20 s timer, and a play while suspended starts after the resume settles, never before the resumed `currentTime`;
  - `setPlannerRoomTail`:
    - makes a second convolver with `normalize === false`;
    - its fade ramps 0 → 1 over 0.1 s while the first ramps to 0, and the first is disconnected at 0.15 s (fake timers);
    - a tail at 44.1 kHz on a 48 kHz context returns false and keeps the old one;
  - `plannerAudioClock()` is null before arming and reports `outputLatency`, falling back to `baseLatency`, or 0, plus `sampleRate`;
  - `subscribePlannerSoundArmed` hears the context's rate once;
  - arming sets `navigator.audioSession.type` to "ambient" when present, and does nothing when absent;
  - after 30 set-down plays in 5 minutes, the 31st voice's level gain is under −2.9 dB, and no two consecutive voices differ by more than 1 dB;
  - with `?soundtap=1`, `__venSoundTap.log` gains one entry per played voice; without the flag `__venSoundTap` is undefined.
- [ ] **Step 3: Run** `src/lib/__tests__/planner-set-down-sound.test.ts src/lib/__tests__/planner-sound.test.ts src/lib/__tests__/sound-registry.test.ts src/components/planner-chrome/__tests__/sound-control.test.tsx`. Expected: FAIL in the new cases.
- [ ] **Step 4: Implement**, then rebuild the page and run its check, as in Task 12 Step 5.
- [ ] **Step 5: Run** the four files. Expected: PASS, including the registry's source scan (`sound-registry.test.ts:116`).
- [ ] **Step 6: Commit** with the message "Play set-downs through each room's own tail, on by default at Quiet (D1, T-700)". If #357 has landed, drop the default hunks and say so in the body.

### Gate (section 5): Tasks 14a and 14b wait for the phone timings (ruling R79)

### Task 14a: The set-down Worker and its client

This implements R48 (render at the drop in a Worker; heavy pieces rendered ahead) and R15 (the tail in the Worker, idle slices as the fallback).

**Files:**
- Create in `lib/set-down/`:
  - `worker-protocol.ts`: the job and answer types, and `isSetDownJob`, a runtime guard;
  - `worker-jobs.ts`: the pure handler `runSetDownJob(job): { answer; transfer: ArrayBuffer[] }`;
  - `set-down.worker.ts`: a thin `onmessage`, as `crafted-texture.worker.ts:18–37`;
  - `renderer.ts`: the main-thread client, as `crafted-textures.ts:66–151`.
- Modify `vite.config.ts:112–127`: add the worker to the dev warm-up list.
- Test: create `lib/set-down/__tests__/worker-jobs.test.ts` and `lib/set-down/__tests__/renderer.test.ts` (a fake Worker; happy-dom has none).

**Interfaces:**
```ts
type SetDownJob =
  | { readonly kind: "render"; readonly id: number; readonly key: string; readonly input: SetDownInput }
  | { readonly kind: "tail"; readonly id: number; readonly key: string; readonly rt: BandValues;
      readonly sampleRate: number; readonly seed: number; readonly onsetSeconds: number };
type SetDownAnswer =
  | { readonly kind: "render"; readonly id: number; readonly ok: true; readonly left: ArrayBuffer; readonly right: ArrayBuffer;
      readonly sampleRate: number; readonly peakDb: number; readonly onsetSeconds: number; readonly limitDb: number; readonly workMs: number }
  | { readonly kind: "tail"; readonly id: number; readonly ok: true; readonly left: ArrayBuffer; readonly right: ArrayBuffer;
      readonly sampleRate: number; readonly workMs: number }
  | { readonly kind: "render" | "tail"; readonly id: number; readonly ok: false; readonly error: string };
export interface SetDownRenderer {
  render(input: SetDownInput, priority: "exact" | "ahead", key: string): Promise<SetDownRender & { readonly workMs: number }>;
  tail(rt: BandValues, options: { sampleRate: number; seed: number; onsetSeconds: number }, key: string): Promise<Stereo>; // latest wins
  cancel(matches: (key: string) => boolean): void;   // drops queued jobs, never the running one
  dispose(): void;
}
export function createSetDownRenderer(options?: { readonly createWorker?: () => WorkerLike }): SetDownRenderer | null;
```

**Behaviour:**
- One job runs at a time. Exact renders go before queued "ahead" renders and tails, so an exact job never waits behind more than the job already running.
- `createSetDownRenderer` returns null where module Workers are refused (Q9, ruling R83). With no answer within 10 s, or on a Worker error, every pending promise rejects and the renderer reports itself broken.
- The tail's fallback, where no Worker runs, is `tailSlices` on idle callbacks, taking steps while `deadline.timeRemaining() > 1` (the Task 4 deferred note; R72's setup step).
- Each answer carries the Worker's `workMs` for Task 16 and the device day.

- [ ] **Step 1: Write the failing tests:**
  - `worker-jobs.test.ts`:
    - a render job for a Chiavari on the Grand Hall's oak, with its 18 reflections, seed 7 at 48 kHz, returns channels bytewise equal to `renderSetDown(input)`, and both buffers are in `transfer`;
    - a tail job equals `renderRoomTail` bytewise;
    - an unknown kind, or a NaN `sampleRate`, answers `ok: false` without throwing.
  - `renderer.test.ts`:
    - an exact job is posted before queued ahead jobs, with at most one in flight;
    - `cancel` drops queued jobs but not the running one;
    - a newer tail replaces a queued older one;
    - answers resolve their own promises as `Float32Array` views with no copy;
    - an `onerror` rejects everything, and later calls reject at once;
    - a throwing `createWorker` returns null;
    - no answer within 10 s (fake timers) breaks it.
- [ ] **Step 2: Run** both. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS, and the registry's scan still passes (no Web Audio names in these files).
- [ ] **Step 5: Commit** with the message "Render set-downs and room tails in a Worker, exact renders first (T-700)".

### Task 14b: The engine in the scene

**Files:**
- Create:
  - `components/editor/SetDownSound.tsx`, an R3F shell (`useFrame` for the frame delta, `useThree` for the camera);
  - `components/editor/set-down-driver.ts`, the driver, `import()`ed per Q4;
  - `components/editor/PlannerSoundReceipt.tsx` (DOM).
- Modify `components/editor/PlannerScene.tsx`:
  - add the imports beside :50;
  - add `<SetDownSound />` straight after `<FurnitureMotion />` at :721, so its frame runs after the motion's;
  - add `<PlannerSoundReceipt />` after `</Canvas>` at :760.
- Test: create `components/editor/__tests__/SetDownSound.test.tsx` and `components/editor/__tests__/PlannerSoundReceipt.test.tsx`; add a block to `__tests__/bundle-splitting.test.ts` if Q4 is ruled lazy.

**Interfaces:**
- Consumes:
  - `subscribeFurnitureLandings` and `furnitureLandingListenerCount` (Task 11);
  - Task 12's modules;
  - `beginSetDownBatch`, `setPlannerRoomTail`, `plannerAudioClock`, `wakePlannerSound` and `subscribePlannerSoundArmed` (Task 13);
  - `createSetDownRenderer` (Task 14a);
  - `useEditorStore` (`space`), `useCockpitStore` (`walkMode`), `usePlacementStore`, `resolveRoomGeometry`, `roomAcousticsFor` and `roomState`.
- Produces `SetDownSound(): null` and `PlannerSoundReceipt(): ReactElement | null`. The receipt mounts `usePlannerSoundArming()` and `usePlannerSoundShortcut(onToggled)` for every chrome.

**Behaviour:**
- **Batches.** `dropStarted` (or `landedInPlace`) calls made in one task are flushed by `queueMicrotask` as one batch. A placement's ids, or a release's, arrive synchronously.
  - Up to 3 pieces are all voiced.
  - 4 or more go through `planCascade`, with `landsAfterSeconds = delaySeconds − the batch's least`.
- **At drop start, for each voice:**
  - `landingRender`;
  - `earFor(camera, source, walkMode)`;
  - `voiceInput`;
  - `renderer.render(input, "exact", key)`;
  - `wakePlannerSound()`.
- **At each voiced id's `touchedDown`:**
  - The batch's first contact calls `beginSetDownBatch(voiceCount)`.
  - `startAt = setDownStartTime(clock, presentDelayFor(lastDelta), onsetSeconds) + max(0, offset − elapsed since the batch's first contact)`.
  - The render played is the first of:
    1. the exact render, if it is ready;
    2. a heavy piece's cached variant for (slug, scale, surfacesKey, room key, rate);
    3. the exact render, if it arrives within `HEARD_WINDOW_S`.
  - Otherwise the voice is skipped and logged as a miss (Q6, ruling R80).
  - **Fix round 2 (25 Nov):**
    - A cascade voice is due at its own slot, its contact plus its cascade wait. Its render is on time if ready by the slot, late within 45 ms after it, and a miss past that, both for what plays and for the policy. A voice answered after its contact but by its slot starts exactly as an on-time voice (R105).
    - Variants come from any class rendering ahead (R100). Each plays as rendered only near where it was rendered; otherwise a copy moved to the landing plays (R104, in the known limits).
    - A contact reads only the supports and the direct sound, not the whole render input (whole-branch Minor 3).
    - A landing the registry refuses is logged on the tap as "refused" (Minor 2).
- **Supports at contact.** They are re-read at contact for voiced ids. A changed `surfacesKey` takes a matching variant if there is one, or otherwise the drop-start render, logged as stale (Review Focus 5).
- **Reduced motion.** A `landedInPlace` voice plays when its render answers, at `currentTime` (Q10, ruling R84).
- **`pickedUp(id, true)`.** The Worker renders "ahead" variants: seeds 1–3, for the surfaces under the piece now and for the room's floor. They are asked again when the carried piece has moved more than 1 m or its supports change, checked at most every 250 ms. The cache is dropped when the room key changes.
- **The room.**
  - Placement-store changes, debounced 250 ms, give `roomState(roomAcousticsFor(space), placedItems)`.
  - A new key, or a new context rate from `subscribePlannerSoundArmed`, sends a tail job to the Worker (latest wins), then `setPlannerRoomTail`.
  - A space change computes at once and cancels pending jobs.
  - A voice's `send` is `RoomState.send` (R58), never scaled by distance (R11).
- **Unmount** unsubscribes everything, cancels the debounce and the idle slices, and disposes the renderer.
- **Never on the main thread.** Nothing in this component or the driver calls `renderSetDown` or `renderRoomTail`.
- **The adaptive render policy (ruling R100, which replaces the phone-timings gate).** Per class (light, table, heavy), the driver keeps two records:
  - the live `workMs` of the Worker's answers;
  - at each contact, whether the voice was on time, late within R80's 45 ms, or a miss.

  Fix round 2 (25 Nov) changed two things:
  - The `workMs` record is gone: no decision read it, and the tap logs each voice's `workMs` (whole-branch Minor 5).
  - A voice whose render was asked for before the Worker said it was ready is not judged. Its wait includes the Worker's one-off start-up (Minor 1).
- **Render-ahead.** In render-ahead mode a class's pieces are rendered ahead:
  - at pickup, for carried pieces, as heavy pieces already are;
  - while the placement ghost shows, for new pieces.

  The exact render is still requested at drop start, and plays if it arrives in time.
- **A fast first switch (condition 1).**
  - A class that misses 2 of its first 5 contacts switches to render-ahead at once. After that, a rolling window decides.
  - The device's mode per class is kept in localStorage: the class and its mode only, nothing personal, with every read and write in try/catch. The next visit starts in the right mode.
  - A cold start on a slow fake renderer is tested.
- **A bounded cost (condition 2).**
  - At most one render ahead is in flight per class.
  - It is cancelled when the piece is put back, or when the ghost leaves without a placement.
  - Moving the ghost does not render again unless the render depends on position, that is, on the surfaces under it.
  - CPU and battery: render-ahead adds at most one Worker render per gesture per class, off the main thread. On the build desktop a render took 7.5–23.9 ms (medians, with the Grand Hall's 18 reflections), and a phone is about 3–5 times slower. The cost is bounded by gestures, not by frames.
- **Stable in both directions (condition 3).**
  - Hysteresis: a class switches back to exact renders only after 10 on-time contacts in a row, each render's `workMs` well inside its window. A device near the threshold therefore does not flap.
  - Tests drive the switch on and off through a fake renderer's `workMs`.

**The receipt.**
- Shift M shows "Sound off · Shift M" or "Sound on · Shift M" for 2.4 s.
- It is a `role="status"` `aria-live="polite"` capsule with the `layout-live-capsule` class (`LayoutLiveLayer.css:60`).
- It has no animation under reduced motion.

- [ ] **Step 1: Write the failing tests** in `SetDownSound.test.tsx`. Mount it beside `FurnitureMotion` with `mountInStubRoot`, step with `advance`, mock the registry with `vi.mock("../../../lib/sound-registry.js")`, and inject a fake renderer through a test seam:
  - `loadConfiguration`, undo and a plain `setState` post nothing and play nothing;
  - a `placeItem` posts one exact render at the announcement and plays one voice on its contact frame (frame 5);
  - `renderSetDown` is never called on the main thread (a module spy);
  - `startAt` at contact equals `setDownStartTime` for `outputLatency` 0.005 and 0.06;
  - a render answered 10 ms after contact plays at once, and one answered 30 ms after plays nothing for a chair; for a staging deck with a variant cached since pickup, the variant plays;
  - under reduced motion, `placeItem` plays nothing until the render answers, then one voice;
  - a drag and release of a chair plays a "settle" render at its contact (frame 4), and a release after a resting-hand set-down plays nothing more;
  - Lay out (`autoArrangeBanquet`) with 80 chairs and 8 rounds posts ≤ 8 renders and makes one `beginSetDownBatch(n ≤ 8)`, with no voice before its piece's contact and ≤ 3 in any 250 ms;
  - ten `placeItem` calls within a second give ≤ 8 admitted plays and a queue that never exceeds 8 (Review Focus 2);
  - a chair placed over a deck renders with `stage-deck` surfaces;
  - switching `space` from grand-hall to saloon makes the next tail job the Saloon's and cancels the Grand Hall's (Review Focus 3);
  - an added round changes the key after 250 ms and calls `setPlannerRoomTail` once;
  - an imported piece (unknown id, `scale: 1.7`) renders finite and plays (Review Focus 4);
  - unmounting returns `furnitureLandingListenerCount()` and the store's listener count to their values before mount, and disposes the renderer.

  In `PlannerSoundReceipt.test.tsx`:
  - Shift M shows a status "Sound off · Shift M" that is gone after 2.4 s, then "Sound on · Shift M";
  - there is no animation class under reduced motion;
  - the first `pointerdown` arms.
- [ ] **Step 2: Run** both, plus `src/components/editor/__tests__/PlannerScene.test.tsx src/components/editor/__tests__/FurnitureMotion.instanced.test.tsx`. Expected: FAIL in the new files.
- [ ] **Step 3: Implement**, and mount in `PlannerScene.tsx`. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5:** Measure on the desktop: each voice's `workMs` and the main thread's frame time over 20 placements, from a quick browser run with `?soundtap=1`. Measure the Worker's garbage collection from a Chrome performance trace of 20 placements. Reuse scratch buffers only if the trace shows a cost (R48). Record the figures for the PR body.
- [ ] **Step 6: Commit** with the message "Set every piece down in its room, as it lands (T-700)".

### Task 15: Sound in the menus, and no button on screen

This task does not wait on the gate.

**Files:**
- Modify:
  - `components/editor/cockpit/ReferenceSceneSettings.tsx` (:20–58): a `<details>` titled "Sound" holding `<SoundSettings />`, outside the preview lock at :28, because sound is a device setting. This is today's wide-desktop menu; CockpitTopBar is not mounted (row 17);
  - `components/editor/VerticalToolbox.tsx`: in the mobile More sheet, after the Tools grid (:1437), a "Sound" title (`mobileSheetTitleStyle`, :1249) and `<SoundSettings />`;
  - `components/planner-chrome/SlateMenu.tsx`, after :211: a `pc-slate-menu__section` with `role="group"`, `aria-label="Sound"`, a `pc-slate-menu__head` "Sound" and `<SoundSettings />`;
  - if #428 has landed: `components/planner-hud/HudSheets.tsx` ToolsSheet, the row its comment reserves.
  - **25 Nov:** #428 has landed, so the HUD's More tools sheet now holds the Sound row. Fix round 2's second implementer built it, with tests in `planner-hud/__tests__/hud-sound.test.tsx`.
- Test: update `cockpit/__tests__/ReferenceSceneSettings.test.tsx`, `editor/__tests__/MobilePlannerChrome.test.tsx` and `planner-chrome/__tests__/slate-menu.test.tsx`; create `components/editor/__tests__/sound-menus.test.tsx`.

**Interfaces:** consumes `SoundSettings` (`SoundControl.tsx:85`). Nothing else is mounted. The speaker stays on the fixture page alone.

- [ ] **Step 1: Write the failing tests** in `sound-menus.test.tsx`:
  - in the desktop More menu (`compactDesktop`), opening "More planner tools" and then "Sound" shows the radiogroup "Sound" with Off, Quiet and Full, Quiet checked by default;
  - choosing Off writes `venviewer.planner-sound` = "off";
  - the mobile More sheet and the slate menu each show the same control;
  - rendering `PlannerCockpit` (v1, desktop and phone) and `PlannerChromeV2` gives no element whose accessible name matches `/^Sound: /`.
- [ ] **Step 2: Run** it. Expected: FAIL. **Step 3: Implement**, and update the three existing tests. **Step 4: Run** it with the three existing files. Expected: PASS.
- [ ] **Step 5:** Note for Task 16: `SoundSettings` carries v2's pc-* styles into v1's menus, so check its look in the screenshots and adjust only the row's container if it clashes.
- [ ] **Step 6: Commit** with the message "Keep Sound in the planner's menus, never as a button on screen (T-700)".

### Task 16: Browser evidence, then open PR 3

- [x] **Step 0 (ruling R97): Blake re-listens to the Robert Adam Room before PR 3 opens.** His ear test of 14 November does not cover it. **Done on 18 November:** he played it on a page built with #449's model and judged it right.
  - #449 gave the room its measured outline and took away the curtain at the arch, which the scan shows bare.
  - Its echo is now 11–14 % longer at 1 kHz, above the ~5 % just-noticeable difference.
  - Build the listening page with #449's model, put it where he can open it, and ask him how the room sounds. Record his answer in the PR body.
- [ ] **Step 0b (ruling R100, condition 4): real-phone evidence before part 3 ships.** On at least one real low-end phone (Blake's, when it comes, or another real device), with `?soundtap=1`, show four things:
  - the adaptive switch engages for the slow class;
  - after warm-up (each class's first 5 contacts), misses are under 5 % of contacts, over at least 40 contacts;
  - nothing plays later than R80's 45 ms window;
  - the sound's lazy load (R103): in a remote-debugging trace from opening the planner to the first set-down, no main-thread task over 50 ms comes from loading the driver's chunk, and the time from arming to the Worker's ready message is recorded.

  This holds part 3's release, not 14b's build.

  The tap gives what these need (fix round 2, 25 Nov):
  - each voice's render onset and the output's latency, for R80's window;
  - each landing the registry refused, logged as drop "refused", apart from landings that never came;
  - voices whose render was asked for before the Worker was ready, which the policy does not judge, so read the misses after warm-up.
- [ ] **Step 1:** Write `sound-live.mjs`, a script kept outside the repo, from the furniture rebuild's batch 4 live script (also kept outside the repo).
  - **Its safety:** every non-GET request is aborted, and the guest draft (POST `/public/configurations`) and its reads are answered locally.
  - **The browser:** Playwright with `channel: "chrome"`, headed. The browser pane draws no frames off screen, and the planner's demand loop needs frames for touchdowns.
  - It opens `<base>/plan/<stub>?soundtap=1` and clicks once to arm. Through the real UI it then:
    1. places a Chiavari (the toolbox's Add, the catalogue, the floor);
    2. places a 6 ft round with its chairs (ChairCountDialog);
    3. presses "Lay out" (`PlannerCommandDeck.tsx:406`);
    4. drags and releases a chair;
    5. places one piece under `emulateMedia({ reducedMotion: "reduce" })`.
  - After each step it reads `__venSoundTap.log` and records 4 s around the first placement.
  - It writes the WAV and a JSON report to `<evidence>/<phase>/`, where `<evidence>` is a local folder outside the repo.
  - It takes screenshots of the receipt and the three menus: the desktop More menu, the mobile More sheet at 375 × 812, and the `?chrome=v2` slate menu.
  - For Q7 it renders a clothed and a bare round as WAVs for Blake.
- [ ] **Step 2:** Run the house's memory wait, a script kept outside the repo, as `wait-memory.sh 8704 6656 4`. When it allows:
  - start the worktree's Vite dev server on port 5262 through `preview_start` (the launch entry), then close its pane tab;
  - run `node sound-live.mjs http://localhost:5262 local` under the house's browser hold, a script kept outside the repo.

  Expected:
  - the log shows 1 entry; then the set's voices (≤ 3 within 250 ms, each at or after its contact); then ≤ 8 for Lay out, with `rtMid` falling after each;
  - for every entry, `startAt + onset + outputLatency − contactMs` lies in [0, 20 ms] where the latency allows for an on-time voice, and in (20, 45] ms for a voice the tap logs as late (ruling R80);
  - the WAV's onsets, peak and T20, read by a small Node script importing `analysis.ts`, match the engine's own renders within 2 dB and 10 %;
  - the reduced-motion entry plays after its render, with no contact.
- [ ] **Step 3:** Run all of these through `$HOLD`:
  - the set-down folder, and `src/lib/__tests__/{planner-sound,planner-set-down-sound,sound-registry,furniture-motion,furniture-motion-landings,placement-support}.test.ts`, plus the component tests named in Tasks 11, 14b and 15;
  - `tsc --noEmit` (delete `packages/web/tsconfig.tsbuildinfo` first);
  - eslint over the changed files;
  - `pnpm --filter @omnitwin/web build`, then the gzip sizes of the set-down chunks (main and Worker), together against the 33 KB budget (R106).

  Expected: clean, and the sizes reported.
- [ ] **Step 4:** Push. Open "Furniture set-down sound, 3 of 3: in the planner, on at Quiet (T-700)". The body gives:
  - the evidence;
  - the gate's phone timings (or, under Q5, which tasks waited);
  - Blake's ear test of 14 Nov, in which he judged the set-downs right and none of them off, so no `?setdowns=1` flag is needed;
  - the rulings on Q1–Q10;
  - the refusal sound going live (Q8, ruling R82);
  - what is not yet measured on a phone (the device day, Task 17).

---

### Known limits carried into PR 3

- **The first set-down after arming** waits for the limiter's 0.25 s warm-up (R63). A click that arms and places at once may hear its first set-down up to about 0.1 s late. Later plays are on time.
- **The Worker's start-up.** The Worker starts at arming and loads and evaluates its module. A first gesture that is itself a placement (the Lay out button, or a first drag) may find its renders late and its voices dropped.
  - The policy does not judge those contacts: their renders were asked for before the Worker said it was ready. So a one-off start-up never switches a class to render-ahead on the device.
  - Task 16 Step 0b records the time from arming to the ready message.
- **The tail** is made at arming, at the context's rate. On a slow phone the very first set-down may play before its tail is in, and so dry.
  - Every change of room takes the old room's tail off the bus at once, faded over the 0.1 s cross-fade if it rings. So a set-down in the new room is dry until the new tail answers, never sent into the old room. The same holds when sound comes back on in a room changed while it was off.
  - This is to be measured on the device day.
- **A cascade voice's window.** Each voice of a cascade is due at its own slot, up to about 0.7 s after its piece lands. Its render is on time if ready by the slot, and may arrive up to 45 ms after it (R105). The policy judges it the same way, so the cascade's own spacing is never read as a slow device.
- **Variants rendered ahead.** Heavy pieces render ahead at pickup (R48). Light and table pieces render ahead too once their class has switched (R100), at pickup and from the placement ghost. A variant is refreshed every metre and whenever the surfaces under it change.
  - A variant's key leaves position out, so the next piece of its kind may land anywhere.
  - A kept variant plays as rendered only when its direct sound came from within 0.2 rad (measured round the ear) and 1.5 dB of the landing's, as heard at contact.
  - Otherwise a copy moved to the landing plays (R104): un-panned on the engine's own equal-power law, panned to the landing's angle, at the landing's dry gain. Its early reflections stay those of where it was rendered. The exact render is never moved.
  - Variants are a fallback by design.


## PR 4: live, checked and written down

### Task 17: Deploy, check live, write it down

**Files:**
- Create: `docs/engineering/furniture-sound.md`, the engineering note: how the engine works, the data sources, how to add a piece or a room, and how to recalibrate.
- Modify:
  - `docs/state/tasks.md`: update the T-700 row (added with PR 1 on 13 Nov 2026) to its shipped state;
  - `docs/sessions/2026-10-27.md` (or the day it ships): decisions, PRs, evidence and limits;
  - `docs/engineering/README.md`: link the note.

- [ ] **Step 1:** Write the three documents. Check the links (`node tools/check-doc-links.mjs` if it exists, otherwise `grep -o "](.*)"` and test each path).
- [ ] **Step 2:** Commit them on PR 3's branch before it merges, or as a docs PR if PR 3 has merged, with the message "Record the furniture set-down sound in the engineering notes and the day's log (T-700)".
- [ ] **Step 3:** After PR 3 merges and Vercel's production deployment for its SHA is READY (`gh api repos/codemaker66/omnitwin/deployments?sha=<sha>`):
  - run `node sound-live.mjs https://venviewer.com prod-grand-hall` (Task 16's script, kept outside the repo), then again with the Saloon's stub (`prod-saloon`). Production is read-only for agents, and the script's aborts keep it so;
  - check the production chunk carries the engine: the served JavaScript contains `planner-set-down`;
  - on a device day after part 3, run the same flow on a phone, checking the budgets, the iPhone silent switch, and sound with sight at touchdown.
- [ ] **Step 4:** Report the evidence to Blake and the planner lead. State each item as tested, measured, deployed or accepted, and name anything not measured on a device.
