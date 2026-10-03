# R1 polished — surface skins and cinematic light (T-639, 3 October direction)

Status: design approved by Blake on 3 October 2026 through the question form. It amends slice R1 of
[The Restored Hall](2026-09-29-the-restored-hall-design.md), which stays the parent design: its principles, light model,
relight package, window volumes (amendment of 3 October) and failure rules all hold. Evidence:
`D:/claude/real-hall/renovation/surfaces/{findings.md,inventory.md,coverage.json,elevations/}` (the surface inventory),
R1a Task 3's window-volume report and R1a Task 4's sun-bounce measurements (SDD workspace of the R1a plan).

## 1. Why, and what Blake decided

Blake judged the relight proof's night image unacceptable for a platform the world's finest venues will show their
clients: smudged windows, the old blurry floor, damaged and blurry walls, a blurry portrait, blurry and blown-out
chandelier lights. The relight work already removes two of these (the glass becomes a sky panel; the floor is the
restored 2 mm floor). The others live in the splats themselves. His decisions on 3 October:

- **Everything polished before he sees a preview.** The first relit preview waits until the light, the restored floor,
  clean glass, crisp lamps and sharp restored flat surfaces are all in.
- **Surface skins.** Large flat surfaces are drawn like the floor: sharp, restored textures lit by the same light.
  Splats stay only where the room is truly 3D.
- **Real sheen.** Gilding, varnished wood and the lacquered floor glint as they do in the hall.
- **No more site days.** The frieze band that the uplights clip in every photograph is recovered from the data we have,
  with every reconstructed texel labelled.
- **Clutter is toggleable.** Loose cables, loudspeakers and stray items can be shown or hidden; the AV cabinet, which has
  never moved, is shown by default and can be hidden. Exit signs and fire extinguishers stay (real, required fixtures).
- **Cinematic light, with sun shafts.** The light changes gradually and live like real life, with real shadows; moving
  the clock speeds it up in a refined, smooth way. Hollywood and AAA cinematic polish; nothing janky or amateur.

## 2. What the inventory established (measured)

- Below about 5.4 m almost every large surface fits a base surface plus a single-valued height field: plaster fields,
  the frieze (a painted mural on flat plaster, ±2.4 cm over 21 m, not a carved relief), the fascia lettering, the
  honours boards' lettering and blank panels (±1.5 cm), the wainscot (relief ≤ 5 cm), the timber upper band, the
  portrait canvases (each on its own plane: the frames lean 5–22 cm off the wall), closed doors, the clock face and the
  coffered ceiling (3 cm relief).
- Truly 3D, kept as splats or simple geometry: board crests and balusters, carved gilt frames, doorcase pediments, the
  marble chimneypiece, window arches, reveals and curtains, window-wall pilasters, the five chandeliers, the dome
  (curved), radiator casings and the bench.
- The walls are not planes: they bow 4–5 cm along their length, both end walls step back 3–6 cm above the picture rail,
  and the ceiling is 6 cm lower at the fireplace end.
- Realistic texel sizes (effective, measured): 1.5–2 mm on the lower walls, boards and portraits (about 1 mm on the board
  lettering), 2–3 mm on the frieze, about 3 mm on the ceiling, 4–5 mm on the cornice, upper band and dome.
- Sources: the E57's 4096 px cube faces are the sharpest low down; the XGRIDS frames are 2.2–2.4× softer than nominal
  (H.264 and motion) and win only high up (the 4 m pole passes, for the frieze); the 8K panoramas are a good second
  source; the E57 zenith faces are a blurred fill within 10.5° of vertical and are excluded. 47 E57 stations stand in
  the hall.
- Registration: the E57 sweeps disagree by up to 12–23 mm along wall and ceiling normals, so a joint pose solve like
  the floor's (7.5 → 1.1 mm) comes first.
- Restoration is mostly baked light and glare: the uplights clip the frieze's bottom 10–15 cm in every view; window
  reflections and streaky sheen sit on the varnished boards; physical damage at 5 mm is minor (wainscot scuffs, one
  frieze stain, cables, sockets).

## 3. Surface skins

### 3.1 What a skin is

A skin is one surface region drawn as:

- a **base surface**: a plane per wall bay (the walls bow, so one plane per wall would not fit) or per canvas, the
  ceiling's plane, and later surfaces of revolution (the dome is out of R1's skins);
- a **height field** over it at 5 mm, from the LiDAR (relief and the walls' bow), drawn as displaced geometry;
- a **base colour** texture at the region's realistic texel size, restored and lighting-neutral;
- **material maps**: roughness, a metal mask (gilding), and a provenance map (observed, recovered, reconstructed);
- **light maps**: the nine sources' direct light per texel, as the floor has.

The floor skin (v2, restored albedo) is the first skin; R1c makes the rest follow the same contract.

### 3.2 Building the skins (offline, `tools/skins/`)

1. **Pose solve** of the E57 faces, the 8K panoramas and steady XGRIDS frames against the walls and ceiling, anchored to
   the LiDAR, to millimetre consistency.
2. **Geometry**: per-bay base planes and 5 mm height fields from the LiDAR; region masks for each skin and for the 3D
   elements that stay splats.
3. **Mosaic**: per texel, the best source by measured effective sharpness and obliquity, zenith faces excluded,
   occluders (furniture, people) masked, multi-view blending without ghosting.
4. **Restoration**:
   - de-light by the relight model itself: each observation divided by the captured light modelled at that point
     (principled, not statistical);
   - glare and window reflections removed across views (a specular highlight moves between views; the surface does not);
   - healing per material (plaster, wood grain, lettering, canvas), as the floor's along-grain healing;
   - the frieze band recovered by the recipe the frieze research proves (§3.3);
   - clutter: each toggleable object gets a mask; the skin keeps both the object and a clean version beneath it.
5. **Materials**: roughness and gilding masks from multi-view specular behaviour plus region labels.
6. **Light maps** per skin, by the R1a bake, on the skin's own texels with the height field's normals.
7. **Splat hiding**: splats inside a skin's relief envelope get a new hidden class in the relight records, so a skin
   never fights a splat; splats of toggleable objects get a toggle class.

### 3.3 The frieze band

The recovery recipe comes from a dedicated research investigation (in progress at the time of writing,
`D:/claude/real-hall/renovation/frieze/`) that tests, on held-out stretches of well-exposed mural: multi-view fusion of
unclipped observations across exposures and both 31 May captures, per-channel highlight reconstruction, a physical
model of the uplights' glare, structure-guided inpainting from the mural itself, and a constrained generative model as
the last resort. Every texel carries its provenance class; reconstructed texels are labelled in the provenance view and
in the package's provenance record. External photographs are used only after Blake clears their rights.

## 4. Cinematic light

### 4.1 Time

- **Live by default:** the hall shows the real hour; the light moves continuously (the sun creeps across the floor, the
  sky warms and dims). Weather joins in R2.
- **Moving the clock:** the displayed time follows the chosen time through a critically damped spring, so the light
  sweeps through the hours as a smooth time-lapse and never jumps. Lamps fade with an incandescent warm-up (colour
  shifts warm as they dim), never switch.

### 4.2 Shadows

- Sun through the windows: the window-volume march (exact mullions, curtains and blinds; parent amendment of 3 October).
- Interior occluders (chandeliers, pilasters, later furniture): a sun shadow map from a simplified occluder model,
  with soft (percentage-closer) edges, recomputed as the sun moves.
- Lamps: shadows baked into each source's light, as today.
- Bounce light from the sun: the exact sun-bounce basis (R1a Task 4: radiosity is linear, so the exact bounce for a grid
  of sun directions is compressed into basis volumes mixed per sun position).

### 4.3 Camera and lamps

- Eye adaptation: exposure adapts over one to two seconds to the scene's light, anchored to the calibrated presets.
- Lamp bulbs become crisp emissive bulbs at their measured positions (from the capture's bulb splats), with a
  restrained, energy-conserving bloom; the bulb splats are no longer boosted.
- Colour: the night is calibrated to the hall's own night photographs; the photo check gains a colour-accuracy measure.
  No heavy grade: at the captured light the hall looks exactly as captured.

### 4.4 Sheen, reflections and sun shafts

- Sheen: physically based specular (GGX) on skins from the lamps, the windows (area light from the sky) and the sun
  (through the windows), using the material maps; desktop draws it fully, phones a lighter version (R4).
- Reflections: soft reflections of the relit hall in the lacquered floor and varnished wood, from reflection probes
  rendered from the relit scene and refreshed as the light changes.
- Sun shafts: soft volumetric sunbeams through the windows with faint dust, occluded by the window volumes and the shadow
  map, subtle by design.

### 4.5 Performance

On the build PC's RTX 4090: 60 fps while scrubbing the clock and while walking (p99 frame ≤ 16.7 ms), no dropped frames
during light motion, no main-thread task over 50 ms while loading. The per-splat multiplier pass and the skins' sun pass
run every frame while the light moves (amortised across frames if needed), and not at all while it is still.

## 5. Slices and plans

R1 is delivered as four plans, executed in order, with one preview at the end:

1. **R1a, the light bake** (executing): the light model, window volumes, probes, the sun-bounce basis, floor light,
   records, package, checks and test vectors.
2. **R1b, the relit browser** (planned, to be amended): the package in the browser, the multiplier pass, the restored
   floor drawn lit, sky panels.
3. **R1c, surface skins** (to plan): §3, including the frieze recovery, the clutter masks and the skins' rendering and
   lighting.
4. **R1d, cinematic light** (to plan): §4 and the clutter toggle.

The new splat-training track (decided 3 October: one hall dataset, LiDAR-anchored training, fair held-out tests) starts
after R1a's CPU-heavy steps and feeds the 3D splat parts later; R1 does not wait for it.

## 6. Verification

- Night colour and contrast against the hall's night photographs (the parent spec's correlation thresholds plus a
  colour-accuracy measure); never worse than the hall as captured.
- Skin sharpness against today's splats on fixed crops (Laplacian variance and detail share, as the floor study).
- A provenance view: observed, recovered and reconstructed texels shown in distinct colours, for Blake's review.
- At the captured light, the hall matches the captured hall (within 1/20 of a stop where splats remain).
- 60 fps while scrubbing and walking on the build PC; no loading task over 50 ms.
- The look: Blake judges the preview.

## 7. Failure behaviour

- A missing or invalid skin falls back to that surface's splats; a missing relight package falls back to the hall as
  captured (parent spec).
- Missing bulb positions fall back to the bulb splats, unboosted.
- Phones and the WebGL fallback keep the captured hall until R4.
- The clutter toggle never leaves a hole: hidden objects reveal the skin's clean version.

## 8. Risks

- **The frieze band:** recovery quality depends on what survives in the data; reconstruction is labelled and judged.
- **Seams** where skins meet 3D splats (frames, crests, pediments): halos or gaps at the edges; mitigated by the relief
  envelope, feathered masks and the photo checks.
- **Registration** across three sensors: ghosting if the pose solve misses millimetres.
- **Per-frame passes** while the light moves: the 60 fps budget may force amortisation.
- **The build PC** corrupts some heavy computations and crashes under load: double runs and majority votes for every
  data product, one heavy job at a time, quiet windows for the benchmark session.
- **Scope and time:** four plans before the first preview; Blake accepted a later preview for a polished first look.

## 9. Not in R1

Live weather and the planner's event dates (R2), the dome as a skin, retrained splats, phones (R4), furniture (I3).
