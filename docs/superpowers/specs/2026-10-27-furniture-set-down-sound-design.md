# Furniture set-down sound: each piece, its surface, its room (T-677)

27 October 2026. Asked for by Blake, decided with him in chat the same day. Builds on the planner's sound palette (T-671 slice 3, `lib/sound-registry.ts`, `lib/planner-sound-recipes.ts`, `lib/planner-sound-render.ts`) and the crafted furniture (T-675).

## Intent

Blake: "I need the furniture to look amazing, and have their own sound efffects when they are placed on the floor. the sound effects changed based on what surface it is placed and how full the room is (realistic echo)".

Today the planner has one soft, generic knock for a table and one for a chair. Both are designed tones played dry, they are off by default, and nothing in the app calls them yet. This design replaces those two set-downs with the real thing:
- each piece sounds like itself landing;
- the sound changes with what the piece lands on;
- the sound changes with the room it is in, and the room's echo shortens as the room fills.

Why it matters. The planner shows Trades Hall as it is: measured rooms, the real sky, the venue's own furniture. Sound is the other half of a room's presence. An empty Grand Hall that rings for two to three seconds when the first chair goes down tells you its size before you look up, and that is the vastness the product brief asks for (Burke's sublime, with clear agency). As tables, cloths and chairs go in, the room closes in, as it does on a setup day. Staff should hear "that's a Chiavari on the oak" and "that's a deck going down" without looking.

"Look amazing" is the T-675 furniture rebuild already under way, and it is not part of this design.

## Decisions already made (Blake, 27 October 2026)

| Question | Answer |
|---|---|
| How sounds are made | **Modelled per piece**: synthesised in code from each piece's size, materials and feet, the surface under it and the room around it. No recordings and no downloads. Blake judges it by ear on a listening page before it goes into the planner. |
| What makes the echo shorter | **What has been placed**: chairs, tables, cloths, stages and drapes add absorption as they go down. Guests are not counted. |
| The real echo | "model now, work it out yourself and do it yourself": compute each room's acoustics from our own survey data. Nobody records at the venue. |
| Moves | A piece moved and dropped again also sounds ("Nothing, carry on" to the playback that said so). |
| Default (decision D1 of the 20 Oct chrome design) | **On, at Quiet**, armed by the first click or key. This reverses goal 01's opt-in rule for the planner. |
| The control | "a mute button always on screen is not aesthetically pleasing": no speaker button on screen. The setting (Off · Quiet · Full and a level) lives in a menu, and Shift M mutes. |
| When it ships | Blake's standing rule of 25 Oct ("i want you to complete everything now"): each piece ships live once it passes its gates, before or after the release-candidate cut on Thu 29 Oct at 18:00. Anything after the cut gets a delta review before Saturday's tag. Flags are used only for pieces not yet safe, never to drop scope. If his ear test has not approved the set-downs by the time the wiring is ready, the wiring ships with set-downs held behind a flag, and they switch on once he approves. |

## Goals

1. Every placeable piece has its own set-down. All 44 crafted slugs (`crafted-slugs.ts`) are covered, and so is any other catalogue item that can be placed, through a family fallback.
2. The sound depends on the support at each foot:
   - the room's real floor;
   - a stage, platform or dance-floor panel;
   - for the AV pieces that can stand on a table (`TABLE_MOUNTABLE_AV_SLUGS`), the table top.
3. Each room's echo is computed from its measured shape and real surfaces. It depends on what is in the room now (pieces and their dressing), and it updates as pieces are placed, moved, removed or re-dressed.
4. A set-down is heard where the piece lands: left or right relative to the view, and nearer or further.
5. The sound lands with the visual touchdown: heard 0–20 ms after the contact frame is shown, and never before it (section 1).
6. Large placements (Lay out, a table group with its chairs, the chair brush, a multi-piece drop) sound like a room being set, never like 180 simultaneous knocks.
7. It stays light on a phone: no frame drops at 180 seats, and audio work stays within the budgets below.

## Non-goals

- Sounds for dragging, sliding, hovering, selecting, rotating, deleting, undo or redo, loading a layout, or another person's edits. These stay silent, as spec 9 of the chrome design already says. The palette's `planner-lift` (Full set only) is unchanged.
- Guests, crowd noise, music or room tone in the planner.
- Changes to the palette's other sounds (refusal, cue, horizon, Send, Present, act, snap, measure, hour). They keep spec 9's recipes and rules.
- Recorded audio files of any kind.
- The flag-gated Grand Assembly arrival (`?assembly=accio`). It settles "without a sound" by its own design, and stays that way (my call).
- Haptics. Spec 10 and decision D3 stay with the T-671 lane. A set-down's haptic pulse may later read the piece's mass from this design's data.

## Anti-goals: what makes this a failure even if it technically works

- It sounds gamey, cartoonish or like a UI beep: the same knock pitched up and down, or anything a member of staff would not recognise as that object.
- It tires or startles: harsh highs, a deck far louder than a chair, a machine-gun of identical hits, or a tail that blurs the next action.
- It is heard when nobody acted: on load, on undo, from a co-editor, or in a hidden tab.
- A speaker or mute button sits on screen.
- It costs frames on a phone, or audio work causes jank while pieces drop.
- The echo is a preset with no relation to the room. An "empty Grand Hall" and an "empty gallery" must differ the way the real rooms do.

## Constraints

- **The registry is the one place that makes sound.** `sound-registry.test.ts` scans the source for Web Audio and audio elements. The set-down engine registers its id or ids there, plays through the existing graph (master, limiter at −12 dB ratio 12, makeup trim, 20 s silence suspend) and follows `PlannerSoundPolicy`: the 45 ms gap, eight a second, and a burst of three within 250 ms.
- **What is measured is what plays.** The pure renderers produce the samples, and the registry plays exactly those samples. This is the palette's existing pattern ("One recipe, two renderers").
- **Superseded rules.** Blake's new direction supersedes these spec 9 rules, for set-downs only:
  - "nothing above 5 kHz" and the 6 kHz bus: a realistic contact needs some air;
  - "touch sounds dry": set-downs now go through the room;
  - the tonal rules on fundamentals (150 Hz–1.3 kHz) and the 6 dB touch window: a deck's boom is physics, and it must be louder than a lapel mic.

  Every other spec 9 rule stands, and all of them stand for every other sound. The replacement rules for set-downs are under Mix below.
- **Reduced motion silences no sound.** With reduced motion there is no drop animation (`FurnitureMotion.tsx:70`), so the set-down plays at the moment of placement instead.
- **Strict TypeScript**, no `any`, the existing stack only, no new runtime dependency.
- **Phone first.** The planner targets 180 seats smooth on a phone (T-675).
- **iPhone.** Where Safari has `navigator.audioSession`, the type is "ambient", so the silent switch silences the planner and the user's music is not interrupted (spec 9 already promises this).
- **Ownership** (my call on the sequencing).
  - **The palette files** (`sound-registry.ts`, the recipes and the renderer) belong to the T-671 lane. Sound for furniture is this lane's work by Blake's request, so this work edits them directly, additively and without forking them.
  - **The chrome builder (T-671 slices 7–21)** is told through the planner lead before PR 1 merges, and agrees before PR 3 changes the default, the menus and the Shift M mounting. Three things change for it: D1 is answered, no speaker goes in the utilities, and set-downs are owned here.
  - **`furniture-motion.ts`, `placement.ts` and `SelectionSystem.tsx`** are shared planner code, so changes there are small and additive.
  - **The crafted factories** are not edited (section 2).
- **This PC's memory.** System commit has sat at 92–97 % for a day, and the GPU gates have been refused for memory. Local checks run as focused test files, with CI running the full suites. Heavy offline work (the ray tracer) checks free memory before it starts.

## The design

### 1. When a set-down plays

| Moment | Source in the code | Sound |
|---|---|---|
| A piece placed from the catalogue, a table group, the chair brush, Lay out, seat-shortfall fill | `placement-store.ts` `announcePlaced` → `subscribeFurniturePlaced` (only a person's own placements are announced) | Each announced piece's set-down at its touchdown (below) |
| A piece moved and released | `SelectionSystem.tsx` `settleDrop` → `releaseFurniture` | A softer set-down at release. A moved piece slides and leans rather than lifting, and on release it squashes and rocks upright, so its sound is its weight settling onto its feet, a low-speed contact, not a fall |
| Undo, redo, loading a layout, a remote co-editor's change, an autosave | Not announced | Silent |
| Preview ghosts (Lay out preview, the placement ghost) | Never placed | Silent |

**Touchdown.** `lib/furniture-motion.ts` `stepFurnitureSettles` ends a drop on the first frame where `lift < LANDED`. That frame is the contact. It needs a small listener seam, with no allocation per frame, so the sound engine knows which ids touched down on which frame.

**The timing requirement, measured where it is heard.** The reference is the moment the contact frame (the first frame drawn with the piece on its support) reaches the screen. The set-down must be heard no earlier than that, and no more than 20 ms after it wherever the device's audio output latency allows. "Heard" means the scheduled start plus `AudioContext.outputLatency`, or `baseLatency` where that is missing.

How the engine meets it:
- At the contact frame, it schedules the start at `currentTime + max(0, presentDelay − outputLatency)`. `presentDelay` is the time until that frame is displayed, about one frame interval from the frame's own timestamp.
- Where the output latency alone exceeds `presentDelay` plus 20 ms (some Android devices run at 40 ms or more), it may look one frame ahead. It predicts the contact frame and schedules for that frame's display. If the frame arrives late, it drops the prediction and reschedules, which is possible because a source that has not started can be discarded. A prediction must never make the sound heard before the contact frame is shown.
- With reduced motion, or if the frame loop is not running, the set-down plays when the placement is announced.

The test (proof 5) checks this arithmetic on fake clocks with a range of latencies.

**Which feet land first.** A chair is rarely set down perfectly level, so its feet meet the floor over 5–35 ms: one or two first, then the rest. The order and spread are random within the piece's family, and heavy pieces land tighter. The visual drop is unchanged. The spread is short enough to read as one set-down.

### 2. The piece: what each one is made of

Each placeable slug gets a physical description, which I'll call its **body**:
- **Mass.** This is estimated per slug from its materials and catalogue size, since the data has no mass today. Examples: Chiavari about 4 kg, a banquet chair about 6 kg, a 6 ft round about 30 kg, a 6×4 staging deck about 45 kg, a mic stand about 3 kg.
- **Feet.** Positions in metres in the piece's frame, and what each foot is:
  - a nylon glide (Chiavari and banquet chairs, material `glide`);
  - a rubber foot (AV stands);
  - a castor (television, servery unit, room divider);
  - a steel foot or a felt pad.

  The positions live in the set-down data, one entry per slug, and a test holds them to each factory's baked contact geometry (the `contact` part that `contactSpots` makes), at the catalogue size. The shade and the sound therefore cannot drift apart, and the engine edits no factory file. Four T-675 PRs are open on those files (#238, #257, #248, #259), and the poseur's `poseurFeet` export exists only on #259. Once #259 is on master, the poseur's entry reads `poseurFeet` directly (my call).
- **Resonant parts**, each a small set of modes with frequencies, decays and gains:
  - a gilt beech frame, which is short-lived;
  - a steel tube frame, which rings briefly;
  - a plywood or MDF top on folding steel legs, which gives a low thump and a leg rattle;
  - a phenolic deck on an aluminium frame, which is hollow and clanky;
  - a cast or steel base, which rings;
  - a cabinet carcass;
  - glass or plastic on the AV pieces.

  Frequencies scale with the part's real dimensions and material. Decay follows the material's loss factor: wood dies fast, steel and aluminium ring longer, and upholstery damps.
- **Small extras where they are real:**
  - the rattle of folding legs;
  - a soft puff from an upholstered seat;
  - the brush of a floor-length cloth's hem as a clothed table lands, using `clothed` on the placed item (my call);
  - castors that bump and settle rather than click.

Pieces without a crafted body use a family fallback by catalogue category and shape (chair, round table, rectangular table, stage, AV, cabinet). They are never silent and never generic beyond their family.

**Synthesis (modal).** Each foot's contact is a short force pulse, with a length from Hertz contact at the foot (research file, section 4.2; calculated, then tuned by ear):
- about 1–3 ms for a metal or nylon glide on timber;
- about 3 ms for a rubber foot;
- 9–18 ms for felt;
- about 40–55 ms on carpet, plus a short hard second pulse as the foot bottoms out onto the floor beneath.

Hard contacts also carry a short burst of micro-collisions within about 15 ms. That burst gives a glide on oak its click (FoleyAutomatic, van den Doel, Kry and Pai 2001).

The pulse drives the piece's modes and the surface's modes (section 3), plus any noise extras. A tabletop is a dense, damped plate, about 90 modes below 1 kHz for a 6 ft round, so it is modelled as a dense modal set rather than a handful of tones.

Material is heard mostly in how decay varies with frequency (Klatzky, Pai and Krotkov 2000). Each material's damping therefore rises with frequency, and viscoelastic materials have a further term that makes their high modes die faster. The as-built loss factors (glued joints, welds, feet) are used, not the intrinsic ones.

The result is rendered in plain arithmetic, as the palette is. Each play varies within the real spread:
- the foot order and timing;
- impact speed ±15 %;
- mode frequencies about ±1.5 %;
- mode gains about ±2 dB.

No two set-downs are identical, and every one is still that piece.

### 3. The surface: what it lands on

At each foot, the support is either the room's floor or the placed piece under it. Today `computeSurfaceHeight` (`lib/placement.ts`) returns only a height, so a companion that returns the supporting piece is needed. It uses the same rules (`canRestOnFurnitureSurface`).

**Floors, by room** (from the 17–18 October survey, `D:/claude/rooms-survey-20261017/research/research-room-facts.md`, and `hall-floor.ts`):

| Room (space slug) | Floor | What it adds |
|---|---|---|
| `grand-hall` | Oak strip boards, first floor, on joists | A bright click and a board knock at 150–300 Hz |
| `saloon` | Oak herringbone parquet, first floor | A tighter, drier knock than strip boards |
| `robert-adam-room` | Mid-brown oak strips, ground floor (two levels) | Like the hall's boards, smaller and less boomy |
| `reception-room` | Glossy dark timber, probably on a concrete slab | A hard click with almost no low body |
| `north-gallery`, `south-gallery` | Blue-grey carpet, attic | A soft, short, muffled set-down |

**How a suspended floor sounds** (research file, section 4.3). It has two parts:
- one or two heavily damped modes at 8–20 Hz: a thump that earbuds carry and laptop speakers do not;
- a dense set of board and plate modes at 100–500 Hz, with a loss factor of about 0.05–0.1, which gives the knock. Oak boards between joists sit at about 150–300 Hz.

A slab under timber has only the second part, higher and drier. Carpet damps both.

**Placed surfaces:**
- a staging deck or platform: a phenolic deck on a frame, hollow, with a boom underneath and a clank from the frame;
- a dance-floor panel: a hard panel laid on the floor, giving a sharp click and a slight hollowness;
- a table top, for AV items: a light knock through the top and its legs.

An unknown or future room gets a sensible default: a timber floor and plastered walls from the space's own dimensions. It is never silent.

### 4. The room: its echo, worked out from our own survey

Blake asked for this to be modelled now, and for me to work it out myself, so the model is built from our survey data and checked against an independent geometric simulation.

**Which shape the echo uses** (my call). The planner still draws some rooms from published or placeholder figures. The surveyed shapes are on the unmerged T-662 branch (`claude/surveyed-rooms`):
- the Reception Room is drawn as a 13.4 × 11.2 m rectangle, but is really an L of about 100 m²;
- the galleries are drawn as 8 × 4 × 3 m, but are really 11.5 × 4.1 × 2.8 m;
- the Robert Adam Room is drawn as its upper section only, but is one room on two levels.

So the two parts of the model take different sources:
- **The reverberation** (time per band, and level) comes from the **surveyed** room: its real volume and surfaces, because that is the room's sound. For the Robert Adam Room that means both sections, which are open to each other.
- **The early reflections** come from the room **as the planner draws it**, because a piece's distance to a wall only means something against the walls on screen.

When T-662 lands, the drawn room becomes the surveyed room and the two agree without any change here. Nothing waits for T-662.

**Per-room acoustic data**, keyed by space slug and kept with its sources:
- **Shape.**
  - The Grand Hall comes from `hall-spec.ts`: 21.135 × 10.59 m, coffered ceiling at 6.7 m, the dome, the openings, the mahogany dado and the elevations.
  - The other rooms come from `data/room-geometries.ts` and the measured survey facts: the Saloon is 11.8 × 6.8–7.4 m with a 5.5–5.9 m ceiling; the Reception Room is an L-shape of about 100 m² with a 2.4–3.1 m ceiling; the galleries are 11.5 × 4.1 × 2.8 m.
- **Surfaces, as areas by material:**
  - **Grand Hall:** oak boards; a mahogany dado; panelled and plastered walls; the lettered frieze; five tall windows of glass with curtains; a coffered plaster ceiling and the dome; doors.
  - **Saloon:** a Spanish mahogany panelled room; a coffered plaster ceiling; three stained-glass windows; a marble chimneypiece.
  - **Robert Adam Room:** white plaster walls; plaster medallion ceiling bays.
  - **Reception Room:** grey walls; a coved ceiling; windows with sheer curtains and heavy drapes.
  - **Galleries:** plaster walls; carpet; sash windows.
- **Absorption coefficients** per octave band (125 Hz–4 kHz, and 8 kHz where known), plus air absorption. These come from published measurements, with citations, collected in `D:/claude/furniture-sound-20261027/research/acoustic-data.md`.

**Contents.** Each placed piece adds an equivalent absorption area per band, by what it is and how it is dressed:
- a bare beech Chiavari with an ivory pad adds little;
- an upholstered banquet chair adds more;
- a table with a floor-length cloth adds much more than a bare one;
- a stage deck with its pleated skirt adds a good deal;
- a fabric room divider adds a lot;
- a dance-floor panel adds nothing, or slightly less than the floor it covers.

The source is the same research file.

**Three parts of the echo, all from the same data:**
- **Reverberation time per band.** Eyring's formula is the baseline, plus air absorption, which matters in a room this size (about 45 m² of absorption at 4 kHz, and dominant at 8 kHz). It is recomputed whenever the contents change, which is cheap enough to do on every change.

  A first estimate with the research figures (`D:/claude/furniture-sound-20261027/analysis/grand_hall_estimate.py`, before the real areas):
  - **Empty Grand Hall:** 2.3–3.6 s mid-band. The range depends on how much curtain fabric the five windows carry, so the real fabric area must come from the survey's window relief.
  - **Comparison:** La Redoute in Bad Godesberg (1790–92, 1,450 m³) measures 3.2–3.5 s empty.
  - **Dressed for dinner with furniture only:** about 22–30 % shorter with 180 cushioned Chiavaris and 18 clothed rounds, and 30–40 % shorter with padded banquet chairs. That is far above the roughly 5 % a listener notices.
  - **Hard, bare pieces** barely change it. A hard chair absorbs only 0.02–0.04 m² in laboratory tests (ISO 354), which is the realistic answer: cloths and upholstery do the work.
  - **Guests** would deaden the room much further, to about 1.1–1.3 s, but they are not counted (Blake's decision).

  Dense rows of seats use Beranek's area method with a cap (block area plus a 0.5 m edge) rather than adding chairs one by one.
- **Early reflections.** These are image sources from the source (the landing point) and the listener (below) off the room's walls, floor and ceiling. First order is required, and second order is used where it is affordable. Each reflection's delay, level and colour come from the surface it bounces off. This is what makes the hall sound 21 m long and the gallery 4 m wide. They are rendered into each set-down, so they move with the piece.
- **The late tail.** This is a stereo impulse response synthesised per room state: decorrelated noise decaying per band at that band's reverberation time, with an onset suited to the room's size. It plays through a ConvolverNode on a room bus. When the contents change, a new response is made off the frame and cross-faded in over about 100 ms, with any burst of changes coalesced. Its send level follows diffuse-field theory: the reverberant level depends on the room's total absorption, and the direct level on distance. An empty room is both longer and louder in the tail, and a full one is shorter and quieter. Neither is a preset.

**Calibration and the independent check** (my call on the method). A small offline geometric simulation runs on the real room shapes and their per-material absorption: a Python ray tracer, run once and kept as a script, plus the data it outputs. For each room, empty and dressed for a reference layout, it gives the reverberation time per band. The browser model's per-room correction factors are fitted to it, and both results are compared against published reverberation times of comparable historic rooms in the research file. The data file records where every number came from.

### 5. Where the listener is

In Room and Plan views the camera can be 5–25 m away. A listener at the camera would hear every set-down as distant reverberation. The listener's ear therefore sits between the camera and the landing point:
- its distance is clamped to about 2–6 m from the landing point;
- it keeps the camera's facing, so panning follows the view;
- in Walk it is the camera itself, at eye height.

This is my call, and Blake's ear test settles the clamp. Panning is equal-power stereo from the arrival direction, cheaper and steadier on phones than HRTF; this is also my call. Distance sets the direct level and the balance between direct sound and reverberation.

### 6. Many pieces at once

Lay out and the other bulk placements announce all their ids at once, and their drops land within about 100 ms of each other. Played literally, that would be a crash. The engine plays a short cascade instead:
- up to about six to eight set-downs of the pieces actually placed, tables before chairs;
- spread over about 0.3–0.6 s, each a little softer than the last;
- each from a real placed piece's position, so the cascade sweeps across the room as the layout does;
- all through the room, whose echo updates once the burst is in.

The policy's limits (eight a second, collapse at four within 250 ms) still bound it. The exact shape of the cascade is my call, settled by ear.

### 7. Mix and levels

- Set-downs play in **Quiet and Full**.
- **Loudness follows mass and impact speed, compressed.** A deck is louder than a chair, which is louder than a lapel mic. Across the catalogue, K-weighted loudness stays within about an 8 dB window, and peaks stay between about −32 and −16 dBFS before the master (my call, settled by ear).
- **Which of spec 9's rules bind set-downs** (my call; Blake's ear test is the judge). Realism supersedes the palette's tonal rules for set-downs only:
  - the "fundamentals 150 Hz–1.3 kHz" band does not apply: a board knock, a deck's boom and a floor's sub-audible thump are physics, not tones;
  - the "touch sounds within 6 dB of each other" rule does not apply either: a deck must be louder than a lapel mic.

  These rules replace them:
  - set-downs stay within an 8 dB K-weighted loudness window across the catalogue;
  - the common pieces (chairs, rounds, trestles, poseurs) stay within 4 dB of each other;
  - the rare moments (horizon, Send, Present, act) stay at most 6 dB above the common set-downs.

  Set-down levels are anchored to the palette's touch level, so if the T-671 lane rebalances the palette (its "balanced alternative"), the set-downs move with it. The existing peak test on `planner-set-table` and `planner-set-chair` gives way to the set-down tests, and its hero rule is re-anchored on the common set-downs. Every other spec 9 rule stands for every other sound.
- **Rules for set-downs, replacing "nothing above 5 kHz":**
  - energy may reach about 12 kHz;
  - a gentle shelf tames the 3–6 kHz presence region;
  - nothing above 14 kHz;
  - no level jump of more than 3 dB between two plays of the same piece on the same surface.
- **The room bus** is a ConvolverNode with its own send per set-down and a short cross-fade on updates. It joins the master before the limiter, so the limiter and trim cover it.

### 8. The setting: no button on screen

- `PLANNER_SOUND_DEFAULT_MODE` becomes `"quiet"` (decision D1). The context is armed on the first deliberate gesture (`usePlannerSoundArming`), mounted for both chromes.
- **v1, the default chrome today, touch and narrow screens:** a "Sound" row in the planner's More sheet (`VerticalToolbox.tsx`, `mobile-more-sheet`) opens the existing `SoundSettings` body: Off · Quiet · Full and the level. These are kept on this device, as now.
- **v1 on a wide desktop**, where the More sheet does not render: the top bar's one existing menu (`CockpitTopBar.tsx`, the Layers button's "Planning overlays" popover) gains a "Sound" section under the overlays. Its button's accessible name becomes "View and sound". This adds a section to a menu that already exists, not a new control (my call).
- **v2 (`?chrome=v2`):** a "Sound" row goes in the slate's ▾ menu (`SlateMenu.tsx`), opening the same body. On master the speaker (`SoundControl`) is mounted only on the `/dev/planner-chrome` fixture, so the change for the chrome builder is never to mount it in the utilities zone, which spec 9's utilities row had planned. The T-671 lane is told, and agrees the change in its files before PR 3.
- **Shift M** mutes and unmutes in both chromes through the one keyboard owner (`lib/planner-keys.ts` and `planner-keymap.ts`). A short receipt ("Sound off · Shift M") is shown, so a mute is never invisible.
- Nothing plays on load, in a hidden tab, or before the first gesture.

### 9. Performance budgets (mid-range phone, Pixel 6a or iPhone 12 class)

| Work | Budget |
|---|---|
| Rendering one set-down (modes, extras, early reflections), main thread | ≤ 2 ms; otherwise render ahead on idle into a few variants per piece and surface |
| Touchdown watcher inside the furniture frame loop | No allocation per frame; ≤ 0.05 ms at 180 settling pieces |
| Recomputing reverberation times on a content change | ≤ 0.5 ms |
| Synthesising the late tail | Off the frame (a worker, or idle chunks of ≤ 4 ms each); ≤ 150 ms in total; ≤ 2 MB per response |
| Voices at once | ≤ 8 (the policy) |
| Bundle | Lazy-loaded with the planner; no recorded audio; under 25 KB gzipped for the engine and data |

## Proof

1. **Unit tests** in Vitest, on the pure renderers, in Node:
   - every slug on every surface renders deterministically from a seed, with no NaN, no clipping, peaks in band and lengths in band;
   - surfaces differ the way they should: carpet's spectral centroid is lower and its decay shorter than oak's; a deck has more 60–200 Hz energy than the floor; the Reception's slab has less low body than the Grand Hall's boards;
   - a four-footed piece shows its separate contacts within 5–35 ms;
   - metal parts decay more slowly than wood.
2. **Room model tests:**
   - Eyring times match a worked calculation;
   - every added piece shortens the time and none lengthens it, while a dance-floor panel changes it by under 1 %;
   - the synthesised tail's measured time per band (Schroeder backward integration, T20) is within ±10 % of its target;
   - the tail level follows the diffuse-field relation.
3. **The independent check:**
   - the browser model is within ±15 % of the offline ray tracer from 250 Hz to 4 kHz, for each room empty and dressed;
   - both sit inside the published range for comparable rooms, or the difference is explained in the data file.
4. **Policy tests:**
   - silent on load, undo, redo and a remote change;
   - sounding under reduced motion;
   - silent in a hidden tab;
   - Lay out's cascade stays within its bounds;
   - the default is Quiet;
   - the menu rows and Shift M work in both chromes;
   - the registry scan still passes.
5. **Timing test** against the spring, on fake clocks across a range of output latencies:
   - the set-down is heard no earlier than the contact frame is shown;
   - it is heard within 20 ms of it wherever the latency allows;
   - a missed prediction never makes it early.
6. **In a real browser** (Chromium): offline renders through the real graph, saved as WAV and analysed. Then a live placement in the planner, captured from the master with a recorder tap, proving the sound plays at touchdown and that the tail changes after pieces are added.
7. **Blake's ear test, before set-downs are switched on in production.** A private listening page he can open on his phone (a claude.ai page built from the same engine code) plays any piece on any surface in any room, with a slider from empty to dressed, plus WAV renders. Changes he asks for go back through the tests.

   The same page times each render on the device it runs on and keeps the figures, so his phone gives the first real-device numbers for the budgets.
8. **On real phones** (the device day with the planner lead, Wednesday 28 October, using the devices Blake provides):
   - the budgets in section 9, measured;
   - the iPhone silent switch silencing the planner;
   - sound and sight together at touchdown.

   Anything not measured on a device is reported as estimated.
9. **After deploy** (the delivery contract): the same capture on production, in the Grand Hall and one other room, on desktop and phone. Production has no dev hooks, so the capture uses its own route: a recorder tap the engine exposes only when a query flag is set (my call).

## Delivery order

Each of these is its own PR, merged through Session orchestration:
1. The engine: room acoustics with its data and sources, the bodies and surfaces, the renderers, the offline check, and the tests. Nothing is wired yet.
2. The listening page, and Blake's ear test. Iterate until he is happy.
3. The wiring: the touchdown seam, the support lookup, the policy and cascade, the room bus, the listener, D1 set to Quiet, the menu rows and Shift M in both chromes.
4. Deploy, check live and write the session log.

## Left to the builder

- The module layout. Pure renderers sit beside `planner-sound-render.ts`, and only `sound-registry.ts` touches Web Audio.
- The registry id or ids for set-downs and how the variation is passed.
- Exact numbers: masses, modes, contact times, absorption values (from the research file, cited) and the cascade's shape.
- How the feet test reads each factory's contact geometry.
- Worker or idle chunks for the tail.
- The ray tracer's details.
- Receipt wording, within the house's copy rules.

## My calls, for Blake to check

- The reverberation comes from the surveyed rooms; the early reflections come from the rooms as drawn, until T-662 makes them one.
- Spec 9's tonal rules give way for set-downs only: an 8 dB window across the catalogue, 4 dB among the common pieces, and the rare moments at most 6 dB above.
- On a wide desktop in today's chrome, Sound sits in the top bar's existing menu, renamed "View and sound", because that chrome has no other menu there.
- Feet are kept in the set-down data and tested against the factories' contact shade, so no factory file is edited while four T-675 PRs are open on them.
- "On time" means heard no earlier than the contact frame is shown, and within 20 ms of it where the device allows.
- A moved piece's set-down is softer than a new one's, because it settles its weight rather than falling.
- A clothed table's hem brushes the floor as it lands.
- The listener sits 2–6 m from the landing point rather than at the camera.
- Panning is equal-power stereo, not HRTF.
- Lay out plays a cascade of six to eight real set-downs rather than one per piece.
- Set-downs may reach 12 kHz, against the palette's 5 kHz rule.
- Grand Assembly stays silent.
- The echo's model is checked against my own geometric simulation rather than a measurement at the venue.
