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

Paths below are relative to `packages/web/src/` unless they start with `tools/`, `docs/` or `packages/`. The worktree is `E:/claude/furniture-sound`, on branch `claude/furniture-sound-t677`.

## Global Constraints

- **Web Audio only in the registry.** Only `lib/sound-registry.ts` may contain the patterns `AudioContext`, `webkitAudioContext`, `createOscillator`, `createBufferSource`, `HTMLAudioElement`, `new Audio(` and `<audio` (`lib/__tests__/sound-registry.test.ts` scans `src/`).
- **Strict TypeScript.** No `any`, no new runtime dependency, and `.js` suffixes on relative imports, as the repo does.
- **Bands.** Octave bands are 125, 250, 500, 1000, 2000, 4000 and 8000 Hz. Wherever a material has no 8 kHz value, use its 4 kHz value.
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
  | Rendering one set-down | In a Worker, started as the drop starts, its Float32 channels transferred back; never on the main thread. Contact comes 50 ms later for a carried heavy piece, 67–69 ms for light and table pieces, 83 ms for a drop-in. With the Grand Hall's 18 reflections a render took 7.5–23.9 ms (medians) on the build desktop in the #416 review, so about 23–120 ms on a phone at 3–5x (EST). Heavy pieces fall back to variants rendered ahead on idle. Spec section 9; R48, amending the plan's first "≤ 2 ms" |
  | The touchdown watcher | allocation-free, ≤ 0.05 ms at 180 settling pieces |
  | Recomputing reverberation times | ≤ 0.5 ms |
  | The tail | idle slices of ≤ 4 ms each, ≤ 150 ms in total; 1.2 x the longest band's reverberation time in seconds at any rate, its memory per rate stated in `tail.ts` (R46; the plan's first cap was 2 MB) |
  | Voices at once | ≤ 8 |
  | Engine and data | ≤ 25 KB gzipped, lazy with the planner |
- **This PC is short of memory** (system commit at 92–97 %). Run Vitest on single files (`pnpm --filter @omnitwin/web exec vitest run <file>`). CI runs the full suites. Check free memory before the ray tracer and any browser run (`D:/claude/furniture-rebuild-20261026/tools/wait-memory.sh`).
- **No edits** to `components/meshes/crafted/*` or `crafted-furniture.test.ts`: four T-675 PRs are open on them.
- **Commits.** Commit with explicit pathspecs. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit in `C:/Users/blake/omnitwin2`.

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

These values are as planned, for 125 Hz to 4 kHz; 8 kHz repeats 4 kHz except for air. Each row carries a comment naming its primary source and label (LAB, FIELD, TEXTBOOK or EST). Ruling R49 (13 Nov) replaced `plaster-lath` with James's "plaster on lath, deep air space", 0.20 / 0.15 / 0.10 / 0.05 / 0.05 / 0.05 (TEXTBOOK), as the planned row sat below both rows it cited; `acoustic-data.ts` holds the shipped values.

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
  - the tail for rt = [1.8, 2.2, 2.6, 2.9, 2.7, 2.0, 1.2] measures within ±10 % per band of its target, using `schroederT20` on `octaveBandpass(left, band)`, for 250 Hz to 4 kHz;
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
- Produces: `D:/claude/furniture-sound-20261027/listening/index.html`, a single self-contained file, published as a private claude.ai page.

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
- [ ] **Step 3:** Build with `node tools/set-down-listening/build.mjs D:/claude/furniture-sound-20261027/listening/index.html`, then run `wait-memory.sh 8704 6656 2`. When memory allows, run `node tools/set-down-listening/page.check.mjs D:/claude/furniture-sound-20261027/listening/index.html`. Expected: PASS. If memory doesn't allow, say the check is not run, and why.
- [ ] **Step 4:** Publish with `Artifact` (icon "sound", with a one-sentence description). Send Blake the link.
- [ ] **Step 5:** Commit `tools/set-down-listening/*` with the message "A listening page for the set-downs, built from the engine itself (T-700)". Push, and open PR "Furniture set-down sound, 2 of 3: the listening page (T-700)".
- [ ] **Step 6, the ear test:** after Blake has listened (on laptop speakers, earbuds and his phone), ask him with `AskUserQuestion`:
  - "How do the set-downs sound?" Options: "Ship them (Recommended)"; "Change some"; "Start again".
  - "Is the echo right?" Options: "Yes (Recommended)"; "Too much"; "Too little".
- [ ] **Step 7:** Feed changes back through Task 5's and Task 6's EST values and tests. Republish with the same file path, and ask again. Repeat until "Ship them".
- [ ] **Step 8:** Read the device timings with `ArtifactData` (action `list`). Record them in `tools/set-down-listening/README.md` as measured on Blake's phone, with the phone model and the date from the stored record.

## PR 3: the wiring

### Task 10: Find the support under each foot

**Files:**
- Modify: `lib/placement.ts` (around `computeSurfaceHeight`, lines 285–332)
- Test: `lib/__tests__/placement-support.test.ts`

**Interfaces:**
- Produces: `findSupportingItem(x: number, z: number, candidate: CatalogueItem, placedItems: readonly PlacedItem[], excludeIds: ReadonlySet<string>): PlacedItem | null`. It returns the item whose top `computeSurfaceHeight` uses, or null for the floor. `computeSurfaceHeight` becomes a call to it, returning the same numbers.

- [ ] **Step 1: Write the failing tests:**
  - a chair over a `staging-deck-6x4` returns the deck;
  - the same point with the deck in `excludeIds` returns null;
  - a laptop over a round returns the round, but a chair over a round returns null (`canRestOnFurnitureSurface`);
  - for 200 seeded points over a mixed layout, `computeSurfaceHeight` equals the found item's top, or 0, every time;
  - a foot past the deck's edge, at the deck's half-width plus 1 cm, returns null.
- [ ] **Step 2: Run** `vitest run src/lib/__tests__/placement-support.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run that file and `vitest run src/stores/__tests__/placement-store.test.ts`. Expected: PASS, with the existing behaviour unchanged.
- [ ] **Step 4: Commit** with the message "Name the piece a placement stands on, not just its height (T-700)".

### Task 11: Touchdown and release seams

**Files:**
- Modify:
  - `lib/furniture-motion.ts`: in `stepFurnitureSettles`, at the `if (motion.lift.value < LANDED)` block (lines 278–289), before the velocity is zeroed;
  - `components/SelectionSystem.tsx`: `settleDrop`, lines 410–441.
- Test: `lib/__tests__/furniture-motion-touchdown.test.ts`

**Interfaces:**
- Produces:
  - `type FurnitureTouchdownListener = (id: string, speed: number) => void`;
  - `subscribeFurnitureTouchdown(listener: FurnitureTouchdownListener): () => void`, called with the absolute value of `lift.velocity` at the contact frame;
  - `announceFurnitureReleased(ids: Iterable<string>): void`;
  - `subscribeFurnitureReleased(listener: (ids: readonly string[]) => void): () => void`.

`settleDrop` calls `announceFurnitureReleased(lastMovingIds.current)` for a move gesture whenever ids moved, under reduced motion too, before clearing `lastMovingIds`.

- [ ] **Step 1: Write the failing tests:**
  - after `dropInFurniture("a", 0.14)`, stepping `stepFurnitureSettles(1/60)` until it lands calls the listener exactly once with id "a" and a speed > 0.3 m/s, on the frame `dropping` turns false;
  - two pieces at different heights land on different frames;
  - `clearAllFurnitureSettles()` before landing means no call;
  - with 180 pieces dropping and one listener, the median step over 30 frames is under 0.5 ms. This is a guard: the listener receives primitives only, and the review checks that no array or object is made per frame on that path;
  - `announceFurnitureReleased` notifies once with every id.
- [ ] **Step 2: Run** `vitest run src/lib/__tests__/furniture-motion-touchdown.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call the listeners with primitives inside the loop; never build an array per frame.
- [ ] **Step 4: Run** it and the existing `vitest run src/lib/__tests__/furniture-motion.test.ts src/components/__tests__/SelectionSystem*.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Tell listeners the frame a piece touches down, and when a move is let go (T-700)".

### Gate before Tasks 12–14: the phone timings (ruling R48)

Tasks 12, 13 and 14 do not start until part 2's listening page has timed renders on real phones (it keeps each render's time on the device that ran it):
- the median and worst render times, with the Grand Hall's 18 early reflections, for a light piece (a Chiavari), a table (a 6 ft round) and a heavy piece (a staging deck), on the phones Blake uses for the ear test;
- set against the time from a drop's start to its contact: 50 ms for a carried heavy piece, 67–69 ms for light and table pieces, 83 ms for a drop-in.

Render-at-drop in a Worker is confirmed only if light and table pieces render inside their time to contact on those phones. Heavy pieces keep the render-ahead fallback whatever the timings. If light pieces miss as well, the design goes back for a ruling before Task 12 starts.

### Task 12: Timing, cascade and listener (pure)

**Files:**
- Create: `lib/set-down/timing.ts`, `lib/set-down/cascade.ts`, `lib/set-down/listener.ts`
- Test: `lib/set-down/__tests__/wiring-pure.test.ts`

**Interfaces:**
- Consumes: `Vec3` (Task 4) and `BodyFamily` (Task 5).
- Produces:
  - `interface AudioClock { readonly currentTime: number; readonly outputLatency: number }`;
  - `setDownStartTime(clock: AudioClock, presentDelaySeconds: number): number`, which is `currentTime + max(0, presentDelay − outputLatency)`;
  - `interface CascadeVoice { readonly id: string; readonly offsetSeconds: number; readonly levelDb: number }`;
  - `planCascade(items: readonly { readonly id: string; readonly family: BodyFamily }[], seed: number): readonly CascadeVoice[]`;
  - `interface Ear { readonly position: Vec3; readonly right: Vec3 }`;
  - `earFor(camera: { readonly position: Vec3; readonly right: Vec3 }, landing: Vec3, walking: boolean): Ear`;
  - `directPath(ear: Ear, source: Vec3): { readonly gain: number; readonly azimuthRad: number; readonly distanceM: number }`, with gain = min(1, 2 / distance).

**The cascade:**
- 1–3 items give one voice each at offset 0, with levels 0, −1 and −2 dB.
- 4 or more give min(8, n) voices: every table family first, then chairs.
- Offsets are seeded, 0.085–0.11 s apart (at most three in any 250 ms window, the policy's burst rule), so 8 voices span about 0.6–0.8 s.
- Level falls 1 dB per voice.

**The ear:** at `clamp(distance(camera, landing), 2, 6)` metres from the landing, on the camera's line. In Walk it is the camera itself.

**No look-ahead yet.** The spec allows a one-frame look-ahead for devices whose output latency is too high. It waits for the device day's measurement (Task 17): if a phone hears set-downs more than 20 ms after the contact frame, it becomes a follow-up task. Until then nothing predicts, so nothing can be heard early.

- [ ] **Step 1: Write the failing tests:**
  - the start time is never before `currentTime`;
  - with outputLatency 0.005 and a present delay of 0.016, it starts at +0.011, so it is heard at 0.016;
  - with outputLatency 0.06 it starts now (heard 44 ms after the present, the honest floor without look-ahead);
  - a cascade of 180 items gives 8 voices, tables first, every 250 ms window holding ≤ 3, all offsets ≤ 0.9 s, and levels strictly falling;
  - 2 items give 2 voices at offset 0;
  - a camera 20 m away puts the ear 6 m from the landing, and one 1 m away puts it 2 m from the landing;
  - in Walk the ear is the camera;
  - a source to the ear's right has an azimuth > 0;
  - the direct gain at 6 m is 1/3.
- [ ] **Step 2: Run** `vitest run src/lib/set-down/__tests__/wiring-pure.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with the message "Time each set-down to the frame, shape Lay out's cascade and place the ear (T-700)".

### Task 13: The registry plays set-downs through the room

**Files:**
- Modify: `lib/sound-registry.ts`, `lib/planner-sound-recipes.ts`, `components/planner-chrome/SoundControl.tsx`
- Test: `lib/__tests__/planner-sound.test.ts` (update) and `lib/__tests__/planner-set-down-sound.test.ts` (new, using the `FakeContext` pattern of `planner-sound.test.ts`, extended with `createConvolver`, a two-channel `createBuffer` and `outputLatency`)

**Interfaces:**
- Consumes: `SetDownRender` and `Stereo` (Tasks 4 and 6); `AudioClock` (Task 12).
- Produces:
  - the registry id `"planner-set-down"` (label "Planner: a piece set down as itself, on its surface, in its room", `device-toggle`, `PLANNER_SOUND_STORAGE_KEY`);
  - `interface ScheduledSetDown { readonly render: SetDownRender; readonly startAt: number; readonly roomSend: number }`;
  - `playSetDowns(batch: readonly ScheduledSetDown[]): boolean`. The batch is one policy decision, recorded as `min(batch.length, 8)` plays.
  - `setPlannerRoomTail(tail: Stereo, key: string): void`, a new ConvolverNode with `normalize = false`, cross-faded from the old one over 0.1 s, with the old one disconnected after 0.15 s;
  - `plannerAudioClock(): AudioClock | null`;
  - `PLANNER_SOUND_DEFAULT_MODE = "quiet"`;
  - `usePlannerSoundShortcut(onToggled?: (mode: PlannerSoundMode) => void): void` in `SoundControl.tsx`.

**Changes:**
- **Retired:** the `planner-set-table`, `planner-set-chair` and `planner-brush` recipes and ids, and their registry entries, with spec 9's brush role taken by `planCascade`.
- **Policy:** `PlannerSoundPolicy.decide` takes its set and gap from a `ruleFor(id)` that also covers `"planner-set-down"`: set `"quiet"`, gap 45 ms.
- **Arming** sets `navigator.audioSession.type = "ambient"` where it exists, typed through a narrow local interface (no `any`).
- **Resuming:** a set-down that arrives while the context is suspended resumes it, and schedules against `currentTime` after the resume promise settles.
- **The recorder tap:** with `?soundtap=1` in the URL, the registry keeps `window.__venSoundTap = { log: Array<{ at: number; slug: string; surface: string; rtMid: number }>, record(seconds: number): Promise<Blob> }`. It uses a MediaStreamAudioDestinationNode and a MediaRecorder on the master, and is created only on that flag. The type declaration lives in the registry.
- **`SOUND_MODE_LINES.quiet`** becomes "Pieces set down in the room, refusals, the evening, Present and Send."

- [ ] **Step 0:** Run `grep -rn "planner-set-table\|planner-set-chair\|planner-brush" packages/web/src`. Today it finds only `planner-sound-recipes.ts`, `sound-registry.ts` and `planner-sound.test.ts`. Every hit is changed in this task.
- [ ] **Step 1: Update `planner-sound.test.ts`:**
  - the default is `"quiet"`;
  - the set-table and set-chair recipe tests and the brush cascade test are removed;
  - the hero rule becomes: each of horizon, Send, Present and act peaks ≤ `SET_DOWN_TOUCH_DB + 6`.
- [ ] **Step 2: Write `planner-set-down-sound.test.ts`:**
  - nothing plays before arming or when Off;
  - a batch of 3 starts 3 two-channel sources at their `startAt`, each connected to the dry bus and to the room send;
  - a second batch 30 ms later is refused (gap);
  - with the context suspended, a batch resumes it and still starts (Review Focus 1);
  - `setPlannerRoomTail` makes a second convolver whose gain ramps from 0 to 1 over 0.1 s while the first ramps to 0;
  - `plannerAudioClock()` reports `outputLatency`, falling back to `baseLatency`, or 0;
  - arming sets `navigator.audioSession.type` to "ambient" when present;
  - with `?soundtap=1`, `window.__venSoundTap.log` gains an entry per played set-down, and without the flag `__venSoundTap` is undefined.
- [ ] **Step 3: Run** `vitest run src/lib/__tests__/planner-set-down-sound.test.ts src/lib/__tests__/planner-sound.test.ts src/lib/__tests__/sound-registry.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** in `sound-registry.ts`, `planner-sound-recipes.ts` and `SoundControl.tsx`.
- [ ] **Step 5: Run** the three files. Expected: PASS, including the source scan.
- [ ] **Step 6: Commit** with the message "Play set-downs through each room's own tail, on by default at Quiet (T-700, D1)".

### Task 14: The engine in the scene

**Files:**
- Create: `components/editor/SetDownSound.tsx`, `components/editor/PlannerSoundReceipt.tsx`
- Modify: `components/editor/PlannerScene.tsx` (mount `<SetDownSound />` beside `<FurnitureMotion />` at line 698, and `<PlannerSoundReceipt />` in the DOM wrapper around the `<Canvas>` at line 606)
- Test: `components/editor/__tests__/SetDownSound.test.tsx`

**Interfaces:**
- Consumes:
  - `subscribeFurniturePlaced` (the placement store);
  - `subscribeFurnitureTouchdown` and `subscribeFurnitureReleased` (Task 11);
  - `findSupportingItem` (Task 10);
  - Tasks 3–6 and 12;
  - `playSetDowns`, `setPlannerRoomTail`, `plannerAudioClock`, `usePlannerSoundArming` and `usePlannerSoundShortcut` (Task 13);
  - `useThree` for the camera and the frame clock; `useEditorStore` for `space`; `prefersReducedMotion`.
- Produces: `SetDownSound(): null` and `PlannerSoundReceipt(): ReactElement | null`.

**Behaviour:**
- **Announced ids** wait for their touchdowns. Under reduced motion, or after a 400 ms timeout, they play at once.
- **Touchdowns** in the same frame form one batch. A batch of 4 or more uses `planCascade`.
- **Released ids** play `kind: "settle"`.
- **Rendering is in a Worker, never in `SetDownSound`** (ruling R48; spec section 9). As each drop starts (an announced placement, or a carried piece let go), `SetDownSound` posts the render's input to a set-down Worker, which runs `renderSetDown` and transfers the Float32 channels back. Nothing renders on the main thread.
  - At the contact frame the exact render plays if it is ready, or if it arrives within the 20 ms heard window after contact.
  - Otherwise a variant rendered ahead plays. When a heavy piece (stage, AV, lighting) is picked up, the Worker renders on idle its variants for the surfaces under it: a few seeds per piece, surface and room state, cached and dropped when the room state's key changes.
  - Under reduced motion there is no drop to render during: the render is posted at the announcement, and this task settles whether the sound waits for it or plays a cached variant at once.
- **Each voice's input**, gathered on the main thread and posted to the Worker:
  - `bodyFor(slug, item.scale)`;
  - each foot's world position (rotate by `rotationY`, add `x`, `z`) → `findSupportingItem` → `surfaceKindForSupport`;
  - `earFor` from the camera, with `walking` from `useEditorStore` walk mode;
  - `earlyReflections` against `resolveRoomGeometry(space)`, the room as drawn;
  - `startAt` = `setDownStartTime(plannerAudioClock(), presentDelay)` at the contact frame, where `presentDelay` is one frame interval (`state.clock`'s last delta, capped at 1/30 s).
- **The Worker's cost** is measured in this task (render times and garbage collection, on the desktop and a phone). Scratch buffers are reused only if the measurement shows a cost.
- **The room tail:**
  - on placement-store changes, debounced 250 ms: compute `roomState(roomAcousticsFor(space), placedItems)`;
  - when its `key` changes, drive `tailSlices` with `requestIdleCallback` (or `setTimeout(…, 0)` where missing), one slice per callback, then call `setPlannerRoomTail`;
  - the room send for each voice is `reverberantGain × directPath(…).gain` relative to the direct sound;
  - on space change, compute the tail at once; on unmount, cancel every pending slice and subscription.
- **The receipt:** Shift M (through `usePlannerSoundShortcut(onToggled)`) shows "Sound off · Shift M" or "Sound on · Shift M" for 2.4 s, in a `role="status"` `aria-live="polite"` capsule styled like `LayoutLiveLayer`'s `layout-live-capsule`. It has no animation under reduced motion.

- [ ] **Step 1: Write the failing tests** in `SetDownSound.test.tsx`. Mount `SetDownSound` beside `FurnitureMotion` with `mountInStubRoot` (`components/__tests__/stub-r3f-root.tsx`), stepping frames with `advance` from `@react-three/fiber`, as `FurnitureMotion.instanced.test.tsx` does. Use registry stand-ins via `vi.mock("../../../lib/sound-registry.js")`, and check:
  - `loadConfiguration` and undo (store writes without an announce) play nothing;
  - a remote overlay write plays nothing;
  - a catalogue placement posts its render to the Worker as its drop starts and plays one set-down after its touchdown frame, and nothing calls `renderSetDown` on the main thread;
  - a render that is not back within 20 ms of contact plays a variant rendered ahead, never late;
  - under reduced motion it plays at once;
  - Lay out with 80 chairs and 10 tables calls `playSetDowns` once with ≤ 8 voices (Review Focus 2: ten placements in one second give ≤ 8 admitted plays and no queue growth);
  - a chair over a deck renders with a `stage-deck` surface;
  - switching `space` from grand-hall to saloon makes the next tail the Saloon's and cancels the pending Grand Hall slices (Review Focus 3);
  - unmounting leaves no subscription: the listener counts return to their values before mount;
  - Shift M shows the receipt with role status.
- [ ] **Step 2: Run** `vitest run src/components/editor/__tests__/SetDownSound.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `SetDownSound.tsx` and `PlannerSoundReceipt.tsx`, and mount them in `PlannerScene.tsx`.
- [ ] **Step 4: Run** it and `vitest run src/components/editor/__tests__/PlannerScene*.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Set every piece down in its room, as it lands (T-700)".

### Task 15: Sound in the menus, and no button on screen

**Files:**
- Modify:
  - `components/editor/cockpit/CockpitTopBar.tsx`: lines 170–200, the Layers popover;
  - `components/editor/VerticalToolbox.tsx`: lines 1388–1414, the mobile More sheet;
  - `components/planner-chrome/SlateMenu.tsx`: after the last section.
- Test: the existing tests of those three, updated, plus `components/editor/__tests__/sound-menus.test.tsx` (new)

**Interfaces:**
- Consumes: `SoundSettings` (`components/planner-chrome/SoundControl.tsx`).

**Changes:**
- **The top bar:**
  - the Layers button's `aria-label` and the menu's `aria-label` become "View and sound";
  - the head "Planning overlays" stays over the overlays;
  - a new head "Sound" sits over `<SoundSettings />`, below the overlay note.
- **The More sheet:** a "Sound" title (`mobileSheetTitleStyle`) plus `<SoundSettings />` after Tools.
- **The slate menu:** a `pc-slate-menu__section` with `role="group"`, `aria-label="Sound"`, a `pc-caps` head "Sound", and `<SoundSettings />`.
- **Nothing else.** No speaker is mounted anywhere outside the `/dev/planner-chrome` fixture.

- [ ] **Step 1: Write the failing tests** in `sound-menus.test.tsx`:
  - opening the top bar's menu shows a "Sound" heading and the Off, Quiet and Full radios, with Quiet checked by default;
  - choosing Off writes `venviewer.planner-sound` = "off";
  - the More sheet and the slate menu each show the same control;
  - no element in the rendered planner, `App`, has an accessible name matching /^Sound: /, the speaker's own label.
- [ ] **Step 2: Run** `vitest run src/components/editor/__tests__/sound-menus.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the three menu changes, and update the existing tests that assert the "Planning overlays" accessible name.
- [ ] **Step 4: Run** it and the three components' existing test files. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Keep Sound in the planner's menus, never as a button on screen (T-700)".

### Task 16: Browser evidence, then open PR 3

- [ ] **Step 1:** Write `D:/claude/furniture-sound-20261027/live/sound-live.mjs` (outside the repo), adapted from `D:/claude/furniture-rebuild-20261026/live/batch4-live.mjs`. It keeps that script's safety:
  - every non-GET request is aborted;
  - the guest draft (POST `/public/configurations`) and its reads are answered locally, so nothing is written anywhere.

  It takes a base URL, opens `<base>/plan/<stub>?soundtap=1` in Chromium, clicks once to arm the sound, then places pieces through the real UI, driving the catalogue and the floor as `packages/web/e2e/editor.spec.ts` and `editor-interactions.spec.ts` do:
  1. a Chiavari;
  2. a 6 ft round with its chairs;
  3. Lay out to 80.

  It reads `__venSoundTap.log` after each step, records 4 s around the first placement with `__venSoundTap.record(4)`, writes the WAV and a JSON report under `D:/claude/furniture-sound-20261027/evidence/<phase>/`, and takes screenshots of the three menus.
- [ ] **Step 2:** Run `wait-memory.sh 8704 6656 4`. When it allows, start the worktree's Vite dev server: add an entry for E:/claude/furniture-sound on port 5262 to the app's launch registry (the release-path memory's "Dev servers for worktrees") and use `preview_start`, then close its pane tab. Run `node sound-live.mjs http://localhost:5262 local`.

  Expected:
  - the log shows 1 entry, then the group's batch, then ≤ 8 entries for Lay out, with `rtMid` falling after each;
  - the WAV's onsets, peak and T20, checked by a small Node script importing `analysis.ts`'s functions, match the engine's own renders within 2 dB and 10 %.
- [ ] **Step 3:** Run `pnpm --filter @omnitwin/web exec vitest run src/lib/set-down src/lib/__tests__ src/components/editor/__tests__/SetDownSound.test.tsx src/components/editor/__tests__/sound-menus.test.tsx`, then typecheck and lint. Expected: clean.
- [ ] **Step 4:** Push. Open PR "Furniture set-down sound, 3 of 3: in the planner, on at Quiet (T-700)". The body gives the evidence and Blake's ear-test result. If the ear test has not said "Ship them", the PR holds set-downs behind `?setdowns=1` until he does, following his flags rule.

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
  - run `node D:/claude/furniture-sound-20261027/live/sound-live.mjs https://venviewer.com prod-grand-hall`, then again with the Saloon's stub (`prod-saloon`). Production is read-only for agents, and the script's aborts keep it so;
  - check the production chunk carries the engine: the served JavaScript contains `planner-set-down`;
  - on the device day (Wednesday 28), run the same flow on a phone, checking the budgets, the iPhone silent switch, and sound with sight at touchdown.
- [ ] **Step 4:** Report the evidence to Blake and the planner lead. State each item as tested, measured, deployed or accepted, and name anything not measured on a device.
