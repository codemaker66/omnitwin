# The Restored Hall — R1d "Cinematic light" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On development and preview builds, a desktop WebGPU visitor sees the relit Grand Hall live at the real hour by default, lit by the true Sun and the true Moon, sweeping through the hours as a smooth critically damped time-lapse when the clock moves (a crafted clock that shows both bodies' arcs and lets you drag either, or the hour), with lamps that fade and dim warm (Blake's artistic choice: the lamps are LED), eye adaptation with night vision, crisp frosted candle lamps at their triangulated positions in place of the chandeliers' captured glow with a restrained energy-conserving bloom, soft interior shadows from both bodies, the street opposite, the sky and the Moon's disc in the windows with the city's light at night, GGX sheen and soft reflections, faint dusty shafts and a clutter toggle, at 60 fps (p99 frame ≤ 16.7 ms) on the RTX 4090 while scrubbing, dragging and walking; anything missing falls back as the spec says, and venviewer.com keeps the founder hold.

**Architecture:** R1d extends R1b's relit browser and never builds a parallel one. The Moon joins the Sun in R1b's light setting and kernel through amendments A3–A5 (its true position, phase and light; the same window march, gates and bounce), so every R1d system treats "the sky bodies" alike. One `LightDirector` (created by R1b's provider, one per relight frame) steps the repo's single spring core (`lib/springs.ts`, `stepSpring`) for the displayed day and minutes, each lamp group's drive, a blend and the eye; while the light moves it applies a new `RelightApplication` to R1b's `RelightFrame` every animation frame (R1b's passes rerun through `NativeSplatScene.runRelight`, the active draw first), and while it is still it runs nothing. The kernel (R1b's `relight-kernel.ts` and `relight-draw.ts`) hides the chandeliers' captured glow where crisp lamps are drawn and gains an interior shadow per sky body and an amortising stride; an offline step in `tools/relight` places the bulbs from the triangulated emitter table and builds the simplified occluder model, the bulbs' intensities and the lamps' dimming into a small `venviewer.cinematic.v1` package beside the relight package. A registered frame composer renders the main canvas draw into an MRT target (colour, emission, expected depth) and adds the bloom and the shafts; the shadow maps, the night sky, the scotopic display, the GGX sheen and box-projected reflection probes plug into R1b's floor, sky panels and display and R1c's skin hooks; the clock is a time–altitude chart driven through the same springs. Spec: `docs/superpowers/specs/2026-10-03-r1-polished-design.md` §4 (and §6, §7, §8), parent `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md`; the amendments R1d needs in R1a and R1b: `docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md`.

**Tech Stack:** React 18.3 + @react-three/fiber 8.18, three 0.186 (WebGPURenderer, TSL, compute, MRT, pnpm patch), Zod 3.24, zustand 5.0, Vitest 4.1 + happy-dom 20, TypeScript 5.7, pnpm 9.15.4, Node 22, Playwright 1.59 (headed Chromium on the RTX 4090), Python 3.13 (`C:/Python313/python.exe`, numpy 2.4, scipy 1.17, Pillow 12, `unittest`) in `tools/relight`.

## Global Constraints

- Work only in the worktree `D:/claude/real-hall/repo`, branch `claude/real-hall`. Never edit `C:/Users/blake/omnitwin2` or another worktree.
- R1d starts only when R1a, R1b and R1c are merged into `claude/real-hall` with every amendment in `docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md` applied. Task 0 checks the anchors this plan edits and the R1c interface; a mismatch is reported to the controller, never designed around.
- Commit with explicit pathspecs only; inspect `git diff --cached --stat` before each commit; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Founder hold (19 September 2026, amended 28 September 2026): splats, the relit hall, the cinematic effects and the light control exist only where `gaussianSplatsAvailable()` is true (development and Vercel preview builds, never a venviewer.com host). No query, saved state or role may override it; `?light=`, `?relight=off`, `?cinematic=off`, `?skins=off` and `?floorskin=v1` are honoured only where it is true.
- TypeScript strict: no `any`, no `as unknown as`, `import type` for types, `noUncheckedIndexedAccess` respected, the repo's `strictTypeChecked` lint (`strict-boolean-expressions`, `no-unnecessary-condition`, `prefer-readonly`, `no-floating-promises`). No new `console` call in app code: fallbacks warn once through R1b's `warnRelightFallback(kind, message, cause?)` (`lib/relight/relight-warning.ts`). If TypeScript rejects a TSL type annotation in a plan code block, change the annotation only, never the node graph.
- Tests: `pnpm --filter @omnitwin/web exec vitest run <path relative to packages/web>`, one file per command, in the foreground. Python: from `tools/relight`, `C:/Python313/python.exe -m unittest tests.<module> -v`.
- All visible loading and working states use `packages/web/src/components/shared/Activity.tsx` (`.claude/conventions/loading-and-working-motion.md`); never attach an Activity indicator to the Three.js frame loop. The light control follows `.claude/conventions/product-experience.md`: quiet colour-change hovers, a small press-down, a visible focus ring, plain factual words, WCAG AA.
- The one spring core: every time-lapse, lamp fade, light blend and eye adaptation steps `stepSpring(state, target, dtSeconds, config)` from `packages/web/src/lib/springs.ts`; no other easing, tween or CSS animation drives light.
- Reduced motion (`prefers-reduced-motion: reduce`, `lib/reduced-motion.ts`): the sun never sweeps. A changed time or date cross-fades the light over the blend spring instead; lamps still fade (a change of brightness, not motion), exposure still adapts, and the dust stops drifting.
- Build-PC GPU rule: one GPU-heavy job at a time. Every browser render or benchmark holds `D:/claude/visual-firstprinciples-20260928/gpu.lock`, a JSON file `{"owner":"<name>","since":"<ISO time>"}` created exclusively (`wx`) and deleted afterwards; if another owner holds it (the T-644 performance session uses it), wait. Render on demand, never a spinning loop. Keep heavy work out of any quiet window the controller announces for the benchmark session.
- The build PC corrupts some heavy computations silently: every offline data product (Tasks 1, 2, 3 and 21) runs twice in separate processes, and the two outputs must be byte-identical (JSON compared parsed). On a mismatch a third run decides by majority; the evidence records every run.
- Outputs go to D: (`D:/claude/relight/grand-hall/…`; the staged packages under `D:/claude/splats/trades-hall/grand-hall/`). Inputs are read-only: `D:/claude/splats/**` (served in development through `SPLAT_STAGING_ROOT=D:\claude\splats`; previews read the public R2 bucket `https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats` directly), `D:/claude/real-hall/renovation/**`, `F:/**`.
- Spec numbers, verbatim (R1 polished §4.5, §6, §7): "60 fps while scrubbing the clock and while walking (p99 frame ≤ 16.7 ms), no dropped frames during light motion, no main-thread task over 50 ms while loading"; the per-splat multiplier pass and the skins' sun pass "run every frame while the light moves (amortised across frames if needed), and not at all while it is still"; eye adaptation "over one to two seconds to the scene's light, anchored to the calibrated presets"; the night photo check keeps "a correlation of at least 0.80 at station 45 and 0.85 at station 43", "never worse than the hall as captured", plus a colour-accuracy measure, also never worse than the hall as captured; "at the captured light, the hall matches the captured hall (within 1/20 of a stop where splats remain)"; "missing bulb positions fall back to the bulb splats, unboosted"; "the clutter toggle never leaves a hole"; "phones and the WebGL fallback keep the captured hall until R4".
- The Moon (the owner's requirement of 3 October, verbatim in substance): its true position from a cited ephemeris tested against published positions for Glasgow (amendment A3); "about 0.1–0.3 lux at full moon high in the sky, with a phase function including the opposition surge"; "physically slightly warmer than the sun"; a scotopic shift in the display "physically motivated and restrained"; it "goes through the same machinery as the sun: window-volume march, shadow map, bounce basis, shafts"; "when both bodies are up (a day moon), both count, within the 16.7 ms budget"; the night sky in the window panels shows "the moon's disc when it is in view, at its true phase, with the sky's brightness following the moon", keeping the hook for R2's real sky; the clock "shows the sun's and the moon's arcs for the chosen date, and lets you drag either body or the time directly", with "gentle detents at sunrise, golden hour, sunset and moonrise", "beautiful at rest and fully keyboard and screen-reader accessible", and "keeps 60 fps while dragging on the RTX 4090".
- Relighting stays WebGPU-only and desktop-class only, decided by R1b's one predicate `nativeRelightSupported`; every R1d effect exists only inside a relit session (the provider's frame is not null) and only with `?cinematic=off` absent.
- The display rule (R1b decision 3) holds: every relit surface ends in R1b's `displayNode(rgb, frame.uniforms.display, knee)`; R1d adds no tone curve. Light that R1d adds in the composer (bulb glow, shafts) is composed in linear light and passes through the same roll-off with the floor's knee, 0.8.
- The multiplier stays normative in the R1a plan's section "The multiplier" as amended (β = 1 for every preset; lamp tints). R1d's additions to the kernel (glow hiding, clutter groups, the interior sun shadow) are inactive when their data is absent, so R1a's test vectors keep passing unchanged.
- The shared patch: R1d does not edit `patches/three@0.186.0.patch`. T-640 was renamed T-644 (the performance loop); its patch is on master before R1d starts (Task 0 checks).

## Decisions this plan takes (with the evidence)

1. **The chandeliers' captured glow is hidden where crisp lamps are drawn; nothing is boosted.** Measured by the frontier splats study (`D:/claude/real-hall/frontier/splats/proposal.md` §0, §b1, 7 October): 83 chandelier bulbs are triangulated from clipped blobs in the E57 photographs to 3.0–3.8 mm (p50 ray residual; chandelier 0: 29, the centre chandelier 2: 54), the vendor splats register to them within 7–10 mm, and the chandeliers did not move between stations; the emitter class (class 3: inside a chandelier's volume and brighter than 0.30) is 48–59% of each chandelier's splats and is glow, the capture's bloom of the bulbs; the chandeliers are polished, cast and gilt brass scrollwork with frosted or opal candle lamps and no crystal prisms (inspected at 1.5 mm/px; the light study §b9 found the envelopes frosted, glowing evenly with no filament visible). The 3 October reading of class 3 as mostly crystals is withdrawn. So Task 1 places the crisp lamps at the triangulated positions, Task 11 draws each as a small frosted candle envelope of even luminance, and while they draw the kernel gives alpha 0 to every class-3 splat of a chandelier that has crisp lamps (Task 7: the record's class, and the nearest chandelier centre, since a record carries no chandelier id). A chandelier the table does not yet cover keeps its glow splats as captured, unboosted (spec §7: missing bulb positions fall back to the bulb splats). Nothing is boosted (β = 1, A1). The dome's class-4 "emitters" are its 14 gilt crests lit by LED pin spots (the contractor's record, light study §b9): lit surfaces, not lamps, so they get no crisp primitive, are neither hidden nor boosted and follow the dome group's level. Without the cinematic package nothing is hidden. A finer, photo-tuned halo flag (the splats study's §c5) is open: it would be a bake output read by the same hiding rule.
2. **The Moon is a second sky body through the Sun's machinery, with the bake's own ephemeris** (the owner's requirement of 3 October; one lunar ephemeris, the coordinator's direction of 7 October). Its position is R1a's `moon.py` (Meeus ch. 47 in full) ported line for line to TypeScript (amendment A3: the two agree to 7×10⁻¹⁴°, and both stand within 3.4″ of JPL Horizons over Glasgow in the cases tested; R1a's review found median 2″, worst 15″ over 2020–2038), its phase from the same NOAA Sun the hall uses, its illuminance by Krisciunas & Schaefer with a restrained opposition surge (about 0.3 lux at full Moon high), its colour about 4,100 K. The light setting and the kernel carry it beside the Sun (A4, A5): the same window march, gates and glass, its own floor grid, and the sky-body bounce basis (A6, A9). R1d adds its shadow map, its shafts and its disc in the windows. A Moon whose light is below 1/100,000 of the day's and the lamps' is not marched (it cannot move a displayed pixel by a tenth of a code), so a day Moon's light costs nothing while its disc still shows; Task 23 measures the frame budget with both bodies forced on, so a day Moon's light would fit if Blake wants it kept.
3. **Moonlight is visible only when the lamps are dimmer than it, and the city is always there at night.** Under lit chandeliers (the lamp-lit night is about 7 cd/m², tens of lux on the floor) a full Moon's 0.3 lux is lost, so the control has a lamps switch (automatic, on, off) beside the presets, and the "Moonlit night" preset (A7) has every lamp off. Live time's automatic lamps fade up while the Sun is below 7° (about an hour before sunset in Glasgow) and fade out above it. At night the street-lit facade across Glassford Street (about 1 cd/m², filling 55–83% of each window's view; the frontier light study, `D:/claude/real-hall/frontier/light/proposal.md` §b3) lights the hall through the windows at some 0.03–0.1 lux mid-hall, so a full Moon's patch on the floor is only 1–3× its surroundings: R1d adds that city light (Task 15's weights, Task 6's `cityLevel`). Weather joins in R2.
4. **The eye adapts to the rendered frame, measured on the GPU, around calibrated anchors, and sees as a dark-adapted eye does only where the light is truly dim.** Every third frame a compute pass reduces the composed frame to its log-average luminance (64 × 36 samples) and reads it back asynchronously (Task 13); the exposure is divided out, so it is the scene's luminance. The target display mixes three anchors by each one's share of the light (the sunny day, the lamp-lit night, the moonlit night: Task 21 measures each anchor's display and its reference view's luminance), each corrected by half the difference between its luminance and the frame's (an eye never adapts fully; R1b's `adaptDisplay` uses the same half) and 60% of the difference in the light's colour (read from the light, never the frame, so the night tint cannot feed back), within eightfold of the anchors; only the approach is a spring (toward brighter in about one second, toward darker in about two: adaptation, time-compressed, never physiological timing). The captured light is held at exactly the identity display. The baked floor mean (R1b's `adaptDisplay`) is only the fallback: before the anchors are calibrated, and in a relit session without the cinematic package (its error reached 39% at some suns). Absolute luminance comes from the capture's calibration, about 54 cd/m² per fit unit (the frontier study's k_abs from the capture day's weather, ±1 stop, §b4), which puts the captured hall at about 9 cd/m² and the lamp-lit night at about 7: just above the mesopic range. The scotopic shift (Task 16: Thompson, Shirley & Ferwerda 2002, scotopic luminance V = Y[1.33(1 + (Y + Z)/X) − 1.68] with a blue shift) is therefore driven only by absolute luminance: nothing at or above 5 cd/m² (so the approved night is neither greyed nor blue-shifted), rising to 60% by 0.005 cd/m² (CIE 191:2010's mesopic range) for dimmed lamps, the blue hour without lamps and moonlight.
5. **Reflection probes render the relit meshes, not the splats.** A splat draw is instancing-bound (T-640/T-644 measured it), so a cube face of the hall's splats costs about a whole frame, and the probes must refresh while the light moves. The probes draw the restored floor and the skins (R1c), which carry almost all of the hall's large reflected surfaces, in linear light; the bright emitters (the Sun, the Moon, the lamps, the windows) reflect analytically through the GGX sheen instead, so nothing is counted twice. The 3D ornament that stays splats is absent from the soft reflections by design; Blake judges the result.
6. **Bloom and shafts need the main draw in a render target.** Splats write no depth and are blended, so a glow or a shaft drawn over the canvas cannot be occluded correctly. A registered frame composer (Task 12) draws the main canvas render into three's MRT target (colour, emission and expected depth, the last two blended by every splat's alpha exactly as its colour is) inside R1b's existing canvas render scope, so every readiness and profiling hook still sees the main draw. Without a relit session the composer is never registered and the canvas draw is I1a's own. The bloom is a restrained, energy-conserving design glow (a small share of each bulb's light moved from its core into the halo, never added); it is not presented as the CIE disability glare function. The frontier study proposes fitting the pyramid's weights to that function (§b6, §c7); R1d takes the glow as one replaceable function of the emission (the composer's `glare` option, a `GlareNode`, Task 13) so the upgrade can land, with the formula and its parameters taken from the CIE text itself (CIE 135/1-6:1999), never from memory.
7. **Per-frame passes are kept affordable** by four measures, in this order: the floor's base light moves to the GPU (A2); while the light moves only the active draw's multiplier pass runs and the others rerun when they become active (Task 7); R1b's early-out remedy (non-reach and non-entering splats skip the march); and, only if Task 23's measurement needs it, the pass is amortised over two frames by interleaved halves (`passStride`, Task 7) whose last phases complete after the light settles, so every splat ends exactly at the final light.
8. **The clock is a time–altitude chart**, the astronomer's classic: the hours run left to right, the Sun's and the Moon's arcs for the chosen date rise and set across a horizon line with the twilight bands beneath it, and the displayed instant is a vertical line where both bodies stand. Dragging a body along its arc, or the line itself, moves the time through the spring core, with gentle detents at sunrise, the golden hours, sunset, moonrise and moonset; slider semantics keep it fully keyboard and screen-reader accessible.
9. **The windows show the street, not an open sky** (the frontier study, §b3). Only 17–45% of each window's view is sky (the capture-lighting audit's `D:/claude/splat-quality-20260923/capture-lighting-audit/out/view_sky_fraction.json`: W1 0.39, W2 0.27, W3 0.17, W4 0.39, W5 0.45); the rest is the facade across Glassford Street. Each window panel shows the facade below that window's measured horizon (R1a's per-window horizon tables, the same the Sun's gates use) and the sky above it, with the Moon's disc at its true phase only where the Moon stands above the facade's roofline. The facade is a Lambertian sandstone wall facing 284.3° (albedo 0.3, the study's assumption), lit by the sky, by the Sun once the Sun clears the hall's own roof as seen from the facade (the audit's `D:/claude/splat-quality-20260923/weather-daylight/opposite_facade.json` sunlit hours give that roofline: about 8° at azimuth 200° rising to about 14° at 292°), and at night by street lighting at about 1 cd/m² (assumed, §b3; the evening Matterport stations can measure it). The panel's mean is the light the room receives through that window (the package's window radiance times its weight), so what the windows show and what they admit agree. The view is an interface (`WindowViewModel`), so R2's real sky and the frontier's spectral sky-view replace R1d's clear-sky one without touching the panels.
10. **The frontier light study plugs in through interfaces, never as a dependency** (`D:/claude/real-hall/frontier/light/proposal.md` §c9, §e). R1d stays RGB. Its upgrade points: the luminance calibration (`LuminanceCalibration`, Task 5: the spectral package's k_abs replaces 54 cd/m²); the lamps' dimming colour (`dimmedTint`'s signature, Task 4: a spectral LED or tungsten model replaces the Planckian RGB tint); the window view (`WindowViewModel`, Task 15: the spectral sky-view and facade bands); the night-vision display stage (`nightVisionNode`, Task 16: a mesopic model with chromatic adaptation replaces the Thompson shift); and the glare function (`GlareNode`, Task 13). Its colour-accuracy method (spectral against RGB, CIEDE2000) reports beside R1d's in Task 21 when it exists.
11. **The lamps keep the bake's colour at full level and dim warm by the owner's choice, and R1d assumes no lamp weights.** The hall's lamps are LED (the contractor's record for the frieze tape and the dome's pin spots; the chandeliers' frosted candles almost certainly: light study §b9), and LEDs keep their colour as they dim. Blake chose a warm-down anyway (spec §4.1, commit 475acd2e, 7 October): an artistic choice, labelled so in the code and the docs. Each group's dimming is a package value (`lamps.groups[g].dimming`, Task 3): `warm`, the default, the tungsten laws used as a look (light d^3.4, colour temperature d^0.42 of full); `led`, the lamps' own (constant colour, the DALI logarithmic curve). At full level every group's light is exactly the bake's (the relight package's own weight and colour for that source), so the warm-down's starting temperature only shapes the dimming. It is a package value too (`lamps.warmDown.fullCct`): the colour temperature that the capture's measured lamp/daylight colour (1.623 : 1 : 0.467, R1a's `lamp_daylight_ratio.json`) implies against CIE daylight by McCamy's formula, about 3,700 K at D65 and 3,540–3,990 K for D60–D75 (the light study's spectral reading: 3,509–3,956 K). The earlier 2,750 K is withdrawn: it is not established. No lamp weight is assumed either: the centre chandelier was lit for the whole capture walk though R1a's fit gave it a weight of 1.4e-11 (splats study §b1), so the bake refits the house lights with constrained per-bulb intensities, an interface R1d consumes (the amendments file's "Interfaces from the bake"); every lamp quantity R1d draws (the crisp lamps' radiance, the lamps' sheen, the night gains) is per unit of the package's own weights, and Task 21 refuses to calibrate a lamp group the bake leaves dark.

## Contracts R1d relies on (checked by Task 0)

1. **R1a, R1b and R1c merged, with the amendments applied** (R1d's `docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md` A1–A11; R1c's `docs/superpowers/plans/2026-10-03-r1c-amendments-to-r1a-r1b.md`). From R1b as amended: `RelightFrame` (`apply`, `prepare`, `onApply`, `uniforms` with the Sun's and the Moon's, `inputs`, `model`, `floor`, `floorBase`, `floorSun`, `floorMoon`, `kernelFrame`, `meanLight`, `addPasses`, `setVisibility`), `skyBody`, `RelightApplication`, `createRelightDraw`, `NativeSplatScene.runRelight`, `relightSplat`, `prepareKernelFrame`, `settingForChoice`, `settingForSky`, `WeatherPreset`, `adaptDisplay`, `PRESET_DISPLAY`, `PRESET_DEFAULTS`, `MOONLIT_DISPLAY_KEY`, `LIGHT_PRESETS`, `useLightSettingStore`, `displayNode`, `HIGHLIGHT_KNEE`, `litFloorMaterial`, `skyPanelNode`, `RelightProvider`, `LightControl`, `window.__relight`, `relight-verify.mjs`, `browsercheck.py`; `moon.ts` (`moonPosition`, `MOON_ANGULAR_RADIUS`, `MOON_CCT`, `sunIlluminance`, `atmosphericTransmission`); `sun.ts` (`solarPosition`, `sunDirection`).
2. **R1c's interface** (the amendments file's section "The R1c interface R1d consumes", items 1–8).
3. **The staged packages and tables:** relight package v2 (R1c) at `D:/claude/splats/trades-hall/grand-hall/relight/v2/manifest.json`, floor skin v2, the skin package, R1a's work tables `D:/claude/relight/grand-hall/work/npy/{splats_pos,geom_cls,geom_chand_id}.npy` (finest level, e57 frame, product order), `<work>/floor-light.npz` and `<work>/lamp_daylight_ratio.json`; the emitter table of triangulated chandelier bulbs (the frontier splats study's `D:/claude/real-hall/frontier/splats/evidence/bulbs.json`, json frame; the config's `paths.emitters`, Task 1); and, once the bake has refitted the house lights, its per-bulb intensities (`<work>/bulb-intensities.json`; equal shares until then).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tools/relight/relight/bulbs.py` | Create | The crisp lamps from the triangulated emitter table, the chandeliers' centres; the night photographs' projection check |
| `tools/relight/relight/occluders.py` | Create | The simplified interior occluder model: chandelier and pilaster voxels to a triangle mesh |
| `tools/relight/relight/cinematic.py` | Create | Bulb intensities, the lamps' dimming and warm-down temperature, probe placements, the `venviewer.cinematic.v1` writer |
| `tools/relight/relight/nightcal.py` | Create | The night calibration fit and the colour-accuracy measure |
| `tools/relight/relight/__main__.py` | Modify | Commands `bulbs`, `occluders`, `cinematic`, `night-calibration`, `cinematic-check` |
| `tools/relight/config/grand-hall.json` | Modify | `paths.emitters`: the frontier study's bulb table |
| `tools/relight/relight/cinematiccheck.py` | Create | The browser checks of the cinematic light: identity, words, shadows, glow, photographs with CIEDE2000, lamps, fallbacks, loading, the frame budget |
| `tools/relight/tests/test_bulbs.py`, `test_occluders.py`, `test_cinematic.py`, `test_nightcal.py`, `test_cinematiccheck.py` | Create | Unit tests |
| `docs/engineering/cinematic-package.md` | Create | The `venviewer.cinematic.v1` contract |
| `packages/web/src/lib/relight/lamp-dimming.ts` | Create | Planckian colour, the artistic warm-down and the LED-true dimming curve |
| `packages/web/src/lib/relight/light-motion.ts` | Create | The displayed day and minutes, lamp drives, blend and eye, stepped with `stepSpring` |
| `packages/web/src/lib/relight/sky-instant.ts` | Create | The Sun and the Moon at a displayed instant (fractional minutes) |
| `packages/web/src/lib/relight/eye.ts` | Create | Anchored adaptation targets, the luminance calibration and the scotopic amount |
| `packages/web/src/lib/relight/light-director.ts` | Create | Each animation frame while the light moves: targets, springs, the application, the passes |
| `packages/web/src/lib/light-setting.ts`, `packages/web/src/stores/light-setting-store.ts` | Modify | Live time, the whole day, the lamps switch, `follow` |
| `packages/web/src/lib/relight/relight-kernel.ts`, `relight-draw.ts`, `relight-frame.ts` | Modify | Glow hiding, the bodies' shadow hook, the pass stride, `setDisplay` |
| `packages/web/src/lib/native-splat-scene.ts` | Modify | `runRelight({ activeOnly })`, stale draws rerun on activation |
| `packages/web/src/lib/relight/cinematic-package.ts` | Create | The cinematic manifest schema, URL, verified fetch and decode |
| `packages/web/src/lib/relight/sun-shadow.ts` | Create | The occluders' shadow maps for the Sun and the Moon: cameras, R32F targets, PCF node, CPU twin |
| `packages/web/src/lib/relight/bulbs.ts` | Create | The crisp frosted candle lamps: envelope geometry, radiance, glow share; the chandeliers handed to the kernel's glow hiding |
| `packages/web/src/lib/native-renderer.ts`, `packages/web/src/components/scene/NativeCanvas.tsx`, `packages/web/src/lib/native-current-view-capture.ts` | Modify | The frame composer hook |
| `packages/web/src/lib/relight/cinematic-composer.ts` | Create | MRT target, bloom, shafts, composite |
| `packages/web/src/lib/relight/sun-shafts.ts` | Create | The air's visibility volume for both bodies and the view-ray march with dust |
| `packages/web/src/lib/relight/window-view.ts`, `packages/web/src/lib/relight/sky-panels.ts` | Create/Modify | The Moon's disc at its phase and the moonlit sky in the window panels; the sky model hook for R2 |
| `packages/web/src/lib/relight/display.ts` | Modify | The scotopic shift; `DisplayUniforms.linear` for the probes |
| `packages/web/src/lib/relight/sheen.ts` | Create | GGX from the Sun, the Moon, the lamps and the windows, and the probes' specular |
| `packages/web/src/lib/relight/reflection-probes.ts` | Create | Cube probes of the relit meshes, refreshed while the light moves, box-projected reads |
| `packages/web/src/lib/relight/floor-material.ts` | Modify | The floor's interior shadow, sheen and reflections |
| `packages/web/src/lib/relight/sky-arcs.ts` | Create | The bodies' arcs for a date, their rise, set and golden-hour detents |
| `packages/web/src/components/rooms/SkyClock.tsx`, `SkyClock.css` | Create | The clock: the chart, its drag, detents, keys and words |
| `packages/web/src/components/scene/RelightCinematic.tsx`, `packages/web/src/components/scene/floor-hooks-context.ts` | Create | Mounts the shadows, bulbs, composer, shafts, window view and probes inside the provider, and provides the floor's hooks and the value of R1c's `SkinLightHooksContext` (R1c creates that context) |
| `packages/web/src/components/scene/RelightProvider.tsx` | Modify | Loads the cinematic package; the director replaces the per-choice apply |
| `packages/web/src/components/rooms/LightControl.tsx`, `LightControl.css` | Modify | The clock, the lamps switch, now, the clutter toggle |
| `packages/web/src/lib/relight/relight-debug.ts`, `packages/web/src/lib/relight/cinematic-parts.ts` | Modify/Create | The calibration controls and cinematic instruments on `window.__relight`; the session's parts for them |
| `packages/web/scripts/cinematic-calibrate.mjs`, `packages/web/scripts/cinematic-verify.mjs`, `packages/web/scripts/light-scrub-budget.mjs` | Create | The night calibration's renders and the eye's anchors; browser verification; the scrub, drag, walk, lamps and both-bodies frame budget |
| `packages/web/src/lib/splat-staging-plugin.ts` | Modify | Serves the cinematic package in development |
| Tests under each `__tests__/` | Create/Modify | Regression coverage per task |
| `docs/engineering/relight-package.md`, `docs/engineering/native-splats.md`, the day's session log, `docs/state/tasks.md` | Modify | Record the change |

## Task order

Offline first (Tasks 1–3, CPU only, double runs), then the light model (4–7), the browser integration (8–18), the clock (19–20), calibration and verification (21–23), and the one preview (24).

| # | Task |
|---|---|
| 0 | Baseline, prerequisites and the interfaces R1d consumes |
| 1 | The crisp lamps from the triangulated emitter table (offline) |
| 2 | The simplified interior occluder model (offline) |
| 3 | The cinematic package and its contract (offline) |
| 4 | Lamp dimming: the artistic warm-down and the LED-true curve |
| 5 | Light motion and the eye: the time-lapse, lamp fades, blend, and the eye's anchored targets |
| 6 | The light at a displayed instant: live time, the whole day, the lamps, both sky bodies |
| 7 | The kernel's new terms: glow hiding, the bodies' interior shadow hook, the pass stride, the active draw first |
| 8 | The cinematic package in the browser |
| 9 | The light director: every frame while the light moves, nothing while it is still |
| 10 | Shadow maps for the Sun and the Moon |
| 11 | Crisp frosted candle lamps |
| 12 | The frame composer hook in the native renderer |
| 13 | The cinematic composer: MRT and the energy-conserving bloom |
| 14 | Sun and Moon shafts with faint dust |
| 15 | The view through the windows: the facade opposite, the sky, the Moon's disc and the city's light |
| 16 | Night vision: the display's scotopic shift |
| 17 | GGX sheen from the Sun, the Moon, the lamps and the windows |
| 18 | Reflection probes |
| 19 | The sky's arcs and detents |
| 20 | The clock: a crafted control for the Sun, the Moon and the hour |
| 21 | Night calibration and the photo check's colour accuracy |
| 22 | DEV instruments for the cinematic light |
| 23 | Verify in the browser |
| 24 | Integrate, record and ship the preview |

---

### Task 0: Baseline, prerequisites and the interfaces R1d consumes

**Files:** none changed.

**Interfaces:**
- Consumes: the contracts above.
- Produces: `D:/claude/relight/grand-hall/evidence/r1d/base-commit.txt` (the commit R1d starts from) and `adapter-limits.json`; a task report listing every check below with its result.

- [ ] **Step 1: The branch, R1a–R1c and the amendments**

```bash
cd D:/claude/real-hall/repo && git status --short && git log --oneline -8
ls docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md docs/superpowers/plans/2026-10-03-r1c-amendments-to-r1a-r1b.md
ls D:/claude/splats/trades-hall/grand-hall/relight/v2/manifest.json D:/claude/splats/trades-hall/grand-hall/floor-skin/v2/floor-skin.json D:/claude/splats/trades-hall/grand-hall/skins/v1
ls D:/claude/relight/grand-hall/work/npy/splats_pos.npy D:/claude/relight/grand-hall/work/npy/splats_opa.npy D:/claude/relight/grand-hall/work/npy/geom_cls.npy D:/claude/relight/grand-hall/work/npy/geom_chand_id.npy D:/claude/relight/grand-hall/work/floor-light.npz D:/claude/relight/grand-hall/work/lamp_daylight_ratio.json
ls D:/claude/real-hall/frontier/splats/evidence/bulbs.json D:/claude/relight/grand-hall/work/bulb-intensities.json
```
Expected: a clean tree on `claude/real-hall`; both amendment files; the staged packages and R1a's tables exist. Anything missing: stop and report (R1d builds on R1a, R1b and R1c as merged). The last line names the two inputs from outside R1a–R1c (the amendments file's "Interfaces from the bake and the frontier studies"): the frontier study's bulb table must exist before Task 1 (report its absence; Task 1 stops on it), while the bake's refit (`bulb-intensities.json`) may still be absent (Task 3 then uses equal shares, and Task 21 refuses to calibrate a lamp group the bake leaves dark); report which of the two exist.

- [ ] **Step 2: The R1b and R1c names R1d edits or calls exist** (one `grep` per file; every pattern must print at least one line)

```bash
cd D:/claude/real-hall/repo/packages/web/src
grep -n "export class RelightFrame\|addPasses(\|setVisibility(\|prepare(renderer: WebGPURenderer)\|meanLight(light: ChoiceLight)\|floorBasePass\|export type RelightUniforms" lib/relight/relight-frame.ts
grep -n "export function relightSplat\|export function prepareKernelFrame\|export function capturedSetting\|readonly lampTints" lib/relight/relight-kernel.ts
grep -n "export function createRelightDraw\|const litBulb\|lampTints\|run: (renderer)" lib/relight/relight-draw.ts
grep -n "runRelight(\|activeRelightDraw()\|private activate(snapshot: Snapshot)" lib/native-splat-scene.ts
grep -n "export function settingForChoice\|export function settingForSky\|export type WeatherPreset\|export function adaptDisplay\|PRESET_EMITTER_BOOST\|export const PRESET_DISPLAY\|export const PRESET_DEFAULTS\|MOONLIT_DISPLAY_KEY\|unitsPerLux" lib/light-setting.ts
grep -n "export function moonPosition\|export const MOON_ANGULAR_RADIUS\|export const MOON_CCT\|export function sunIlluminance\|export function atmosphericTransmission" lib/moon.ts
grep -n "export function sunEcliptic\|export function solarPosition\|export function sunDirection" lib/sun.ts
grep -n "export function skyBody\|readonly floorMoon\|readonly floorBase\|moonDir: uniform\|readonly skyPower\|readonly bounceCoefficients" lib/relight/relight-frame.ts
grep -n "readonly moonDir\|readonly moonSun\|readonly moonOn" lib/relight/relight-kernel.ts
grep -n "export const SkinLightHooksContext" components/scene/skin-hooks-context.ts
grep -n "bodyVisibility\|export interface SkinSurface\|export interface SkinSheen\|setStride" lib/skins/skin-material.ts lib/skins/skin-frame.ts
grep -n "export function applicationForChoice" lib/relight/relight-apply.ts
grep -n "export function displayNode\|export interface DisplayUniforms" lib/relight/display.ts
grep -n "export function litFloorMaterial\|material.colorNode = Fn" lib/relight/floor-material.ts
grep -n "export function RelightProvider\|frame.onApply(() => { host.runRelight(); invalidate(); })\|requestAnimationFrame(apply)" components/scene/RelightProvider.tsx
grep -n "TOGGLE_SHIFT\|TOGGLE_CLUTTER\|TOGGLE_CABINET\|CLASS_SKIN" lib/relight/relight-codec.ts
grep -n "export function skinVisibility" lib/skins/skin-visibility.ts
grep -n "export interface SkinLightHooks\|sunShadow\|sheen" lib/skins/skin-material.ts
grep -n "hiddenToggles\|setToggleHidden" stores/light-setting-store.ts
grep -n "export function warnRelightFallback\|export function fetchVerified\|export function sha256Hex\|export async function inflate\|export function inflate" lib/relight/relight-warning.ts lib/relight/relight-assets.ts lib/relight/relight-png.ts
grep -n "export function stepSpring\|export function isSpringSettled" lib/springs.ts
```
Expected: every command prints at least one line. The amendments file's sections A1–A6 name these anchors; R1c's interface list (amendments file, section "R1c interface") names the last five. Any missing name: stop and report to the controller with the command's output. The plan's edits are anchored on these lines; nothing in R1d works around a missing one.

- [ ] **Step 3: R1a's emitter rule and the vectors as amended**

```bash
cd D:/claude/real-hall/repo && node -e "
const v=require('./packages/web/src/lib/relight/__fixtures__/relight-vectors.json');
console.log('emitterBoost', JSON.stringify(Object.fromEntries(Object.entries(v.settings).map(([k,s])=>[k,s.emitterBoost]))));
console.log('moon_test', v.settings.moon_test ? JSON.stringify(v.settings.moon_test.moonDir) : 'MISSING', 'suns', v.windowRays.suns.length);"
grep -n "lamp_tints\|moon_dir" tools/relight/relight/reference.py
grep -n "SKY_DECLINATION_MAX = 28.75\|SKY_PARALLAX_MAX = 1.03" tools/relight/relight/windows.py
grep -n "def window_power\|def coefficients\|def sun_bounce" tools/relight/relight/sunbounce.py
```
Expected: `emitterBoost {"captured":1,"night":1,"sunny_morning":1,"moon_test":1}`, `moon_test [x,y,z] suns 9`, `lamp_tints` and `moon_dir` lines (amendments A1, A5, A8), the sky band that covers the Moon (R1a Task 4, commit `a2a25c56`) and the factored bounce (`window_power`, `coefficients`, `sun_bounce`; amendment A9). Otherwise stop and report.

- [ ] **Step 4: Install, build shared types, record the base**

```bash
cd D:/claude/real-hall/repo && pnpm install --frozen-lockfile && pnpm --filter @omnitwin/types build
mkdir -p D:/claude/relight/grand-hall/evidence/r1d && git rev-parse HEAD > D:/claude/relight/grand-hall/evidence/r1d/base-commit.txt && cat D:/claude/relight/grand-hall/evidence/r1d/base-commit.txt
git fetch origin && git log --oneline -3 origin/master -- patches/three@0.186.0.patch && git merge-base --is-ancestor origin/master HEAD && echo "master merged" || echo "MASTER AHEAD"
```
Expected: exit 0; one hash; `master merged`. `MASTER AHEAD` means T-644 or other work landed on master after R1c: merge it first as R1b's Task 19 Step 1 describes (its conflict rules hold), then rerun Steps 2–4.

- [ ] **Step 5: Baseline the test files this plan extends** (one per command; each must pass)

```bash
cd D:/claude/real-hall/repo
for f in src/lib/__tests__/springs.test.ts src/lib/__tests__/light-setting.test.ts src/stores/__tests__/light-setting-store.test.ts src/lib/relight/__tests__/relight-kernel.test.ts src/lib/relight/__tests__/relight-draw.test.ts src/lib/relight/__tests__/relight-frame.test.ts src/lib/relight/__tests__/relight-apply.test.ts src/lib/relight/__tests__/display.test.ts src/lib/__tests__/native-splat-scene.test.ts src/components/scene/__tests__/RelightProvider.test.tsx src/components/rooms/__tests__/LightControl.test.tsx src/components/scene/__tests__/NativeCanvas.test.tsx src/lib/__tests__/native-current-view-capture.test.ts src/components/stage/__tests__/StageFloor.test.tsx src/lib/relight/__tests__/relight-debug.test.ts src/lib/__tests__/splat-staging-plugin.test.ts; do pnpm --filter @omnitwin/web exec vitest run "$f" || { echo "FAILED: $f"; break; }; done
cd tools/relight && C:/Python313/python.exe -m unittest tests.test_codec tests.test_browsercheck -v
```
Expected: every file passes. Record each file's test count in the task report: later tasks state counts as "the Task 0 count plus N". A failure means the base is broken: stop.

- [ ] **Step 6: The adapter's limits** (headed Chromium on the shared GPU: hold the lock; if the first command fails with `EEXIST`, wait for the holder and rerun)

```bash
cd D:/claude/real-hall/repo/packages/web && LOCK=D:/claude/visual-firstprinciples-20260928/gpu.lock && node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({owner:'cinematic adapter limits (T-639 R1d)',since:new Date().toISOString()}),{flag:'wx'})" "$LOCK" && { node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    const adapter = await page.evaluate(async () => {
      const found = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      return found ? { maxStorageBuffersPerShaderStage: found.limits.maxStorageBuffersPerShaderStage, maxColorAttachments: found.limits.maxColorAttachments, maxColorAttachmentBytesPerSample: found.limits.maxColorAttachmentBytesPerSample, maxUniformBufferBindingSize: found.limits.maxUniformBufferBindingSize, maxTextureDimension3D: found.limits.maxTextureDimension3D, features: [...found.features].filter((f) => f === 'float32-filterable' || f === 'timestamp-query') } : null;
    });
    console.log(JSON.stringify({ browser: browser.version(), adapter }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });" | tee D:/claude/relight/grand-hall/evidence/r1d/adapter-limits.json; node -e "require('fs').rmSync(process.argv[1])" "$LOCK"; }
```
Expected: one line of JSON. Task 13's MRT target uses three colour attachments of `rgba16float` (8 bytes each, 24 bytes per sample) and Task 7's glow hiding an 80-byte uniform array (5 × vec4), far inside any uniform binding: require `maxColorAttachments ≥ 3`, `maxColorAttachmentBytesPerSample ≥ 32` and `maxUniformBufferBindingSize ≥ 65536` (WebGPU's defaults are 8, 32 and 65,536). A lower value: stop and report.

---

### Task 1: The crisp lamps from the triangulated emitter table (offline)

**Files:**
- Create: `tools/relight/relight/bulbs.py`, `tools/relight/tests/test_bulbs.py`
- Modify: `tools/relight/relight/__main__.py` (append the `bulbs` command), `tools/relight/config/grand-hall.json` (add `paths.emitters`)
- Outputs (D:, never committed): `D:/claude/relight/grand-hall/work/bulbs.json`, `D:/claude/relight/grand-hall/evidence/r1d/bulbs.json`, `D:/claude/relight/grand-hall/verify/r1d/bulbs-run{1,2}.json`

**Interfaces:**
- Consumes: the emitter table at `cfg.paths["emitters"]`: the frontier splats study's bulb table (`D:/claude/real-hall/frontier/splats/evidence/bulbs.json`, schema `venviewer.frontier.bulbs.v1`, written by its `scripts/10_bulb_table.py` from `05_build_obs.py`'s triangulation): `frames.T_json_from_e57`, `bulbs[]` with `id` (`c<chandelier>_b<nn>`), `chandelier`, `position_json` (HallFrame metres, z up), `position_e57`, `faces_used`, `ray_residual_mm_p50`, and `not_yet_triangulated`; `canonical_frame.json`'s `T_json_from_e57` (`cfg.paths["canonicalFrame"]`); the proof's `work/views.json` and night photographs (`cfg.paths["proofWork"]`), `cfg.room["manifestTranslation"]`; R1a's `__main__.COMMANDS`.
- Produces (`bulbs.py`): `SCHEMA = "venviewer.relight-bulbs.v2"`, `TABLE_SCHEMA = "venviewer.frontier.bulbs.v1"`, `CHANDELIER_CENTRES` (5 × 3, e57, the proof's `CHANDELIERS`), `CHANDELIER_RADII = (0.75, 0.75, 1.0, 0.75, 0.75)`, `CHANDELIER_SPAN` (each volume's z below and above its centre), `CENTRE_CHANDELIER = 2`, `GROUPS = ("ch_end", "ch_centre")`, `MIN_VIEWS = 12`, `MAX_RAY_MM = 15.0`, `VOLUME_MARGIN = 0.1`, `FRAME_TOLERANCE = 1e-4`, `CONTROL_OFFSET = 1.0`, `NIGHT_VIEWS = ("mp43_night_end", "mp45_night_windows")`; `read_emitters(path, t_json_from_e57) -> dict` (`{ rows: [{ id, chandelier, json, e57, views, rayMm }], pending }`, the rows sorted by id; refuses another schema, a different frame transform, a duplicate or malformed id); `json_to_e57(points, t_json_from_e57)`; `bulb_group(chandelier) -> str`; `place_bulbs(rows, t_json_from_e57) -> (bulbs, problems)`; `chandelier_entries(bulbs) -> list[dict]`; `e57_to_room`, `project_view`, `photo_hits`, `control_points(bulbs_e57, chandeliers)`, `photo_check(bulbs_e57, chandeliers, views, photos, t_json_from_e57, manifest_translation)`.
- Produces (data): `<work>/bulbs.json` = `{ schema, frame: "e57", source, pending, chandeliers: [{ id, centre: [3], crisp, bulbs }], counts: { ch_end, ch_centre }, bulbs: [{ id, group, chandelier, position: [3], views, rayMm }] }`, read by Task 3.

Decision 1: the crisp lamps stand where the photographs put the bulbs, not where the capture's glow is. The emitter table is the frontier splats study's triangulation from clipped blobs in the E57 faces (83 bulbs in its first table, chandeliers 0 and 2, 3.0–3.8 mm p50 ray residual; it names the chandeliers still to triangulate, about a minute of CPU each, the study's §c5). Each bulb keeps the table's id (`c0_b00`; the bake's per-bulb refit reads the same table, so both name the same bulbs) and is taken to the e57 (model) frame with the canonical frame's rigid `T_json_from_e57` (json = T_JE @ e57, so e57 = R_JEᵀ (json − t)); the table's own transform must equal it, and its own `position_e57` must agree within 0.1 mm (it rounds to 10 µm), so a frame mismatch can never pass silently. Each bulb is checked: at least 12 views and a p50 ray residual within 15 mm (05's own acceptance is 12 views; its worst bulb today is 9.3 mm), and inside its chandelier's volume as the proof classes it (`02_geometry.py`: 0.75 m radius and 0.6 m below to 0.75 m above for an end chandelier, 1.0 m and 0.75 m to 1.45 m for the centre one; the test reads the proof's centres so the two never drift) with a 10 cm margin, because two triangulated bulbs stand 7 mm and 2 mm outside the radius on 7 October. A chandelier the table does not cover is listed as not crisp and keeps its glow splats (decision 1). The check projects every bulb into the hall's two night photographs (the proof's views, which `07_compare.py` aligned with `cmp/photo_*.png`) and counts the bulbs within ±3 pixels of a near-saturated photo pixel; control points, each bulb moved 1 m further from its chandelier's axis at the same height, show that the test discriminates (into empty air beside the fixture: points 0.3 m beside a bulb land in its neighbours' bloom and hit 75% as often at station 45, so they prove nothing). On the study's first table on 7 October the bulbs hit 24 of 24 and 21 of 21 in view, the controls 1 of 20 and 1 of 19. It proves the frame conversion end to end. Gate: at each station with covered bulbs in view, at least 70% of them hit, and the controls hit at most half as often; at least one station sees covered bulbs. A miss is reported with the numbers, never tuned away.

Verified (7 October): `D:/claude/real-hall/frontier/splats/scripts/10_bulb_table.py:1-9,30-40,95` (schema `venviewer.frontier.bulbs.v1`, `frames.T_json_from_e57`, written to `evidence/bulbs.json`) and its run-A copy `work/bulbs.runA.json` (83 bulbs; a bulb: `id` `c0_b00`, `chandelier`, `chandelier_role`, `position_json`, `position_e57`, `faces_used`, `ray_residual_mm_p50`, `ray_residual_mm_max`, `clipped_blob_area_mm2_median`, `clipped_blob_equiv_radius_mm_median`, `faces`; `not_yet_triangulated`: "chandeliers 1, 3, 4"), `05_build_obs.py:33-36` (`BULB_MIN_VIEWS = 12`, `BULB_MERGE_M = 0.05`), `common_obs.py:3` (json = HallFrame, e57 = the light model's frame, json = T_JE @ e57), `:51-61` (`json_to_e57(p, T) = (p − T[:3, 3]) @ T[:3, :3]`); `D:/claude/real-hall/frontier/splats/work/bulbs_c0.json` (29 bulbs, views 15–40, worst ray p50 9.31 mm) and `bulbs_c2.json` (54 bulbs, views ≥ 12, worst 7.68 mm): taken to e57 they lie within 0.757 m and 1.002 m of their chandelier's axis and −0.39 to +1.40 m of its centre's height (computed 7 October); `tools/relight/proof/02_geometry.py:21-22` (`CHANDELIERS`), `:84-88` (the volumes: radius 0.75, z −0.6..+0.75; the centre chandelier 1.0, −0.75..+1.45); `canonical_frame.json` (`T_json_from_e57`, rigid); `tools/relight/proof/common.py:30,45-63` (`json_to_room` = (x + t0, z + t1, −y + t2)); the proof's `work/views.json` (`name`, `pos`, `tgt`, `fov` 48) and `cmp/photo_mp43_night_end.png`, `photo_mp45_night_windows.png` (1920 × 1080 RGB); `tools/relight/relight/__main__.py:119` (`COMMANDS`), `:163-185` (`main` dispatches `COMMANDS[args.command](cfg, args)`); `tools/relight/relight/config.py:9,24-36` (`PATH_KEYS`; `load` keeps every path, so an extra key is allowed).

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_bulbs.py`:

```python
import ast
import json
import math
import os
import re
import tempfile
import unittest

import numpy as np

from relight import bulbs as B

# A quarter turn about z and a shift: json = T @ e57.
T_JE = np.array([[0.0, -1.0, 0.0, 0.5], [1.0, 0.0, 0.0, 0.25], [0.0, 0.0, 1.0, -2.0], [0.0, 0.0, 0.0, 1.0]])
PROOF_GEOMETRY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "proof", "02_geometry.py")


def to_json(points_e57) -> list[list[float]]:
    return (np.asarray(points_e57, np.float64) @ T_JE[:3, :3].T + T_JE[:3, 3]).tolist()


class Table(unittest.TestCase):
    def write(self, folder: str, data: dict) -> str:
        path = os.path.join(folder, "bulbs.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return path

    def table(self, bulbs: list[dict], transform=None) -> dict:
        frames = {"T_json_from_e57": (T_JE if transform is None else transform).tolist()}
        return {"schema": B.TABLE_SCHEMA, "frames": frames, "bulbs": bulbs, "not_yet_triangulated": "chandeliers 1, 3, 4"}

    def bulb(self, bulb_id: str, chandelier: int, e57) -> dict:
        return {"id": bulb_id, "chandelier": chandelier, "position_json": to_json([e57])[0], "position_e57": list(e57),
                "faces_used": 20, "ray_residual_mm_p50": 3.0}

    def test_reads_the_studys_table_sorted_by_id(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, self.table([self.bulb("c2_b00", 2, [8.9, -5.0, 5.0]), self.bulb("c0_b01", 0, [2.2, -7.6, 4.3]),
                                                  self.bulb("c0_b00", 0, [2.3, -7.7, 4.2])]))
            read = B.read_emitters(path, T_JE)
            self.assertEqual([r["id"] for r in read["rows"]], ["c0_b00", "c0_b01", "c2_b00"])
            self.assertEqual((read["rows"][0]["views"], read["rows"][0]["rayMm"]), (20, 3.0))
            np.testing.assert_allclose(read["rows"][2]["e57"], [8.9, -5.0, 5.0], atol=1e-12)
            self.assertEqual(read["pending"], "chandeliers 1, 3, 4")

    def test_refuses_another_schema_frame_or_a_malformed_or_repeated_id(self):
        good = self.bulb("c0_b00", 0, [2.3, -7.7, 4.2])
        shifted = T_JE.copy(); shifted[0, 3] += 0.01
        cases = [dict(self.table([good]), schema="venviewer.frontier.bulbs.v0"), self.table([good], transform=shifted),
                 self.table([dict(good, id="c1_b00")]), self.table([good, good]),
                 self.table([dict(good, position_e57=[2.3, -7.7, 4.3])])]
        with tempfile.TemporaryDirectory() as folder:
            for case in cases:
                with self.assertRaises(ValueError):
                    B.read_emitters(self.write(folder, case), T_JE)


class Placement(unittest.TestCase):
    def test_the_chandeliers_are_the_proofs(self):
        with open(PROOF_GEOMETRY, encoding="utf-8") as f:
            source = f.read()
        literal = re.search(r"CHANDELIERS = np\.array\((\[.*?\])\)", source, re.S).group(1)
        np.testing.assert_array_equal(np.array(ast.literal_eval(literal)), B.CHANDELIER_CENTRES)

    def test_json_to_e57_inverts_the_canonical_transform(self):
        e57 = np.array([[2.24, -7.66, 4.28], [8.9, -5.0, 5.5]])
        np.testing.assert_allclose(B.json_to_e57(to_json(e57), T_JE), e57, atol=1e-12)

    def test_places_each_bulb_in_its_chandelier_with_a_stable_id(self):
        centre = B.CHANDELIER_CENTRES[2]
        rows = [{"id": "c0_b04", "chandelier": 0, "json": to_json([B.CHANDELIER_CENTRES[0] + [0.0, 0.8, 0.0]])[0], "views": 30, "rayMm": 3.0},
                {"id": "c2_b00", "chandelier": 2, "json": to_json([centre + [0.5, 0.0, 1.0]])[0], "views": 30, "rayMm": 3.0}]
        bulbs, problems = B.place_bulbs(rows, T_JE)
        self.assertEqual([b["id"] for b in bulbs], ["c0_b04", "c2_b00"])
        self.assertEqual([b["group"] for b in bulbs], ["ch_end", "ch_centre"])
        np.testing.assert_allclose(bulbs[1]["position"], centre + [0.5, 0.0, 1.0], atol=1e-5)
        self.assertEqual(problems, [])

    def test_reports_a_bulb_outside_its_volume_or_poorly_seen(self):
        far = B.CHANDELIER_CENTRES[0] + [0.0, 0.9, 0.0]          # 0.15 m beyond the radius, 5 cm beyond the margin
        rows = [{"id": "c0_b00", "chandelier": 0, "json": to_json([far])[0], "views": 30, "rayMm": 3.0},
                {"id": "c1_b00", "chandelier": 1, "json": to_json([B.CHANDELIER_CENTRES[1]])[0], "views": 11, "rayMm": 3.0},
                {"id": "c3_b00", "chandelier": 3, "json": to_json([B.CHANDELIER_CENTRES[3]])[0], "views": 30, "rayMm": 15.5}]
        _bulbs, problems = B.place_bulbs(rows, T_JE)
        self.assertEqual([p["id"] for p in problems], ["c0_b00", "c1_b00", "c3_b00"])
        self.assertEqual([p["reason"] for p in problems], ["outside its chandelier", "too few views", "ray residual"])

    def test_lists_every_chandelier_and_which_have_crisp_lamps(self):
        bulbs, _ = B.place_bulbs([{"id": "c2_b00", "chandelier": 2, "json": to_json([B.CHANDELIER_CENTRES[2]])[0], "views": 30, "rayMm": 3.0}], T_JE)
        entries = B.chandelier_entries(bulbs)
        self.assertEqual([(e["id"], e["crisp"], e["bulbs"]) for e in entries], [(0, False, 0), (1, False, 0), (2, True, 1), (3, False, 0), (4, False, 0)])
        self.assertEqual(entries[2]["centre"], [8.9, -5.0, 4.82])


class Projection(unittest.TestCase):
    def test_e57_to_room_is_the_proofs_mapping(self):
        t = np.eye(4); t[:3, 3] = [0.5, 0.0, 0.0]
        np.testing.assert_allclose(B.e57_to_room(np.array([[1.0, 2.0, 3.0]]), t, [1.0, 2.0, 3.0]), [[2.5, 5.0, 1.0]])

    def test_a_point_ahead_lands_at_the_centre_and_one_behind_is_outside(self):
        view = {"pos": [0.0, 1.6, 0.0], "tgt": [0.0, 1.6, -10.0], "fov": 48}
        pixels, inside = B.project_view(np.array([[0.0, 1.6, -10.0], [0.0, 1.6, 10.0]]), view)
        np.testing.assert_allclose(pixels[0], [960.0, 540.0], atol=1e-9)
        self.assertEqual(inside.tolist(), [True, False])
        pixels, _ = B.project_view(np.array([[0.0, 2.6, -10.0]]), view)   # 1 m up at 10 m
        self.assertAlmostEqual(pixels[0][1], 540.0 * (1 - 1 / (10 * math.tan(math.radians(24)))), places=6)

    def test_a_hit_needs_a_near_saturated_pixel_close_by(self):
        photo = np.zeros((100, 200, 3)); photo[50, 100] = [0.95, 0.9, 0.7]
        result = B.photo_hits(np.array([[101.5, 51.2], [150.0, 20.0], [100.0, 50.0]]), np.array([True, True, False]), photo)
        self.assertEqual(result, {"visible": 2, "hits": 1})

    def test_control_points_lie_a_metre_further_out_from_the_axis(self):
        centre = B.CHANDELIER_CENTRES[2]
        bulbs = np.array([centre + [0.3, 0.0, 0.5], centre + [0.0, -0.4, -0.2], centre])
        control = B.control_points(bulbs, [2, 2, 2])
        np.testing.assert_allclose(control, [centre + [1.3, 0.0, 0.5], centre + [0.0, -1.4, -0.2], centre + [1.0, 0.0, 0.0]], atol=1e-12)

    def test_no_station_seeing_a_covered_bulb_is_a_failed_check(self):
        view = {"pos": [0.0, 1.6, 0.0], "tgt": [0.0, 1.6, -10.0], "fov": 48}
        photo = np.zeros((1080, 1920, 3))
        behind = np.array([[0.0, -5.0, 1.6]])     # identity frames: room (0, 1.6, 5), behind the camera
        check = B.photo_check(behind, [0], {name: view for name in B.NIGHT_VIEWS}, {name: photo for name in B.NIGHT_VIEWS}, np.eye(4), [0.0, 0.0, 0.0])
        self.assertEqual([s["inView"] for s in check["stations"].values()], [False, False])
        self.assertFalse(check["pass"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_bulbs -v`
Expected: FAIL — `ImportError: cannot import name 'bulbs' from 'relight'`.

- [ ] **Step 3: Implement** — create `tools/relight/relight/bulbs.py`:

```python
"""The crisp lamps from the triangulated emitter table (T-639 R1d, plan Task 1).

The chandeliers' candle lamps were triangulated from clipped blobs in the E57 photographs by the frontier splats study
(05_build_obs.py: robust ray midpoints, rematched twice, at least 12 views; 3.0-3.8 mm p50 ray residual) and tabled by
its 10_bulb_table.py (venviewer.frontier.bulbs.v1) in the json frame (HallFrame, metres, z up; json = T_JE @ e57). Each
bulb keeps the table's id, is taken to the e57 frame (the light model's and the relight package's model frame) and is
checked against its chandelier's volume as the proof classes it (02_geometry.py). A chandelier the table does not cover keeps its glow splats. The same
table gives the same JSON."""
from __future__ import annotations

import json
import math
import re

import numpy as np

SCHEMA = "venviewer.relight-bulbs.v2"
TABLE_SCHEMA = "venviewer.frontier.bulbs.v1"
#: 02_geometry.py's CHANDELIERS (e57), the centres its class 3 is measured around; test_bulbs checks the copy.
CHANDELIER_CENTRES = np.array([[2.24, -7.66, 4.28], [2.24, -2.42, 4.24], [8.90, -5.00, 4.82],
                               [15.50, -7.68, 4.28], [15.47, -2.33, 4.30]])
#: 02_geometry.py's volumes: radius, and z below and above the centre (the centre chandelier is larger).
CHANDELIER_RADII = (0.75, 0.75, 1.0, 0.75, 0.75)
CHANDELIER_SPAN = ((0.6, 0.75), (0.6, 0.75), (0.75, 1.45), (0.6, 0.75), (0.6, 0.75))
CENTRE_CHANDELIER = 2
GROUPS = ("ch_end", "ch_centre")
MIN_VIEWS = 12
MAX_RAY_MM = 15.0
VOLUME_MARGIN = 0.1
FRAME_TOLERANCE = 1e-4
NIGHT_VIEWS = ("mp43_night_end", "mp45_night_windows")
PHOTO_SATURATED = 0.9
PHOTO_WINDOW = 3
PHOTO_MAX_DISTANCE = 25.0
CONTROL_OFFSET = 1.0
GATE_HIT_SHARE = 0.7
GATE_CONTROL_RATIO = 0.5


def read_emitters(path: str, t_json_from_e57) -> dict:
    """The study's bulb table (venviewer.frontier.bulbs.v1): rows {id, chandelier, json, e57, views, rayMm} sorted by
    id, and the chandeliers it has yet to triangulate. Refused: another schema, a frame transform other than ours, an id
    that is malformed, repeated or names another chandelier, or a table e57 position that disagrees with ours."""
    with open(path, encoding="utf-8") as f:
        table = json.load(f)
    if table.get("schema") != TABLE_SCHEMA:
        raise ValueError(f"The bulb table's schema must be {TABLE_SCHEMA}, not {table.get('schema')!r}")
    ours = np.asarray(t_json_from_e57, np.float64)
    if not np.allclose(np.asarray(table["frames"]["T_json_from_e57"], np.float64), ours, rtol=0.0, atol=1e-12):
        raise ValueError("The bulb table's T_json_from_e57 differs from the canonical frame's")
    rows, seen = [], set()
    for bulb in table["bulbs"]:
        bulb_id, chandelier = str(bulb["id"]), int(bulb["chandelier"])
        if re.fullmatch(rf"c{chandelier}_b\d{{2,3}}", bulb_id) is None or not 0 <= chandelier < len(CHANDELIER_CENTRES):
            raise ValueError(f"Bulb id {bulb_id!r} does not name chandelier {chandelier}")
        if bulb_id in seen:
            raise ValueError(f"Bulb {bulb_id} appears twice in the table")
        seen.add(bulb_id)
        position = [float(v) for v in bulb["position_json"]]
        if len(position) != 3 or not all(math.isfinite(v) for v in position):
            raise ValueError(f"Bulb {bulb_id} has no finite position")
        e57 = json_to_e57([position], ours)[0]
        if np.max(np.abs(e57 - np.asarray(bulb["position_e57"], np.float64))) > FRAME_TOLERANCE:
            raise ValueError(f"Bulb {bulb_id}: the table's e57 position disagrees with the canonical transform")
        rows.append({"id": bulb_id, "chandelier": chandelier, "json": position, "e57": e57.tolist(),
                     "views": int(bulb["faces_used"]), "rayMm": float(bulb["ray_residual_mm_p50"])})
    rows.sort(key=lambda r: r["id"])
    return {"rows": rows, "pending": str(table.get("not_yet_triangulated", ""))}


def json_to_e57(points, t_json_from_e57) -> np.ndarray:
    """e57 = R^T (json - t) for the canonical frame's rigid json = T_JE @ e57."""
    t = np.asarray(t_json_from_e57, np.float64)
    return (np.asarray(points, np.float64).reshape(-1, 3) - t[:3, 3]) @ t[:3, :3]


def bulb_group(chandelier: int) -> str:
    return "ch_centre" if chandelier == CENTRE_CHANDELIER else "ch_end"


def place_bulbs(rows: list[dict], t_json_from_e57) -> tuple[list[dict], list[dict]]:
    """The bulbs in the e57 frame with their ids and groups, and every problem (a bulb outside its chandelier's
    volume with the margin, seen in fewer than MIN_VIEWS views, or with a p50 ray residual above MAX_RAY_MM)."""
    positions = json_to_e57([r["json"] for r in rows], t_json_from_e57) if rows else np.zeros((0, 3))
    bulbs, problems = [], []
    for row, position in zip(rows, positions):
        chandelier = row["chandelier"]
        bulb_id = row["id"]
        centre = CHANDELIER_CENTRES[chandelier]
        below, above = CHANDELIER_SPAN[chandelier]
        radial = math.hypot(position[0] - centre[0], position[1] - centre[1])
        rise = position[2] - centre[2]
        inside = radial <= CHANDELIER_RADII[chandelier] + VOLUME_MARGIN and -below - VOLUME_MARGIN <= rise <= above + VOLUME_MARGIN
        if not inside:
            problems.append({"id": bulb_id, "reason": "outside its chandelier", "radial": round(radial, 4), "rise": round(rise, 4)})
        elif row["views"] < MIN_VIEWS:
            problems.append({"id": bulb_id, "reason": "too few views", "views": row["views"]})
        elif row["rayMm"] > MAX_RAY_MM:
            problems.append({"id": bulb_id, "reason": "ray residual", "rayMm": row["rayMm"]})
        bulbs.append({"id": bulb_id, "group": bulb_group(chandelier), "chandelier": chandelier,
                      "position": [round(float(v), 5) for v in position], "views": row["views"], "rayMm": round(row["rayMm"], 2)})
    return bulbs, problems


def chandelier_entries(bulbs: list[dict]) -> list[dict]:
    """All five chandeliers: their proof centres (e57), whether crisp lamps are drawn for them and how many."""
    out = []
    for chandelier, centre in enumerate(CHANDELIER_CENTRES):
        count = sum(1 for b in bulbs if b["chandelier"] == chandelier)
        out.append({"id": chandelier, "centre": [float(v) for v in centre], "crisp": count > 0, "bulbs": count})
    return out


def e57_to_room(points, t_json_from_e57, manifest_translation) -> np.ndarray:
    """The proof's common.e57_to_room: json = T_JE @ e57, room = (x + t0, z + t1, -y + t2)."""
    p = np.asarray(points, np.float64).reshape(-1, 3)
    t_je = np.asarray(t_json_from_e57, np.float64)
    j = p @ t_je[:3, :3].T + t_je[:3, 3]
    t = np.asarray(manifest_translation, np.float64)
    return np.stack([j[:, 0] + t[0], j[:, 2] + t[1], -j[:, 1] + t[2]], -1)


def project_view(points_room, view: dict, width: int = 1920, height: int = 1080):
    """Pixels (column, row) of room-frame points in a proof view (pos, tgt, vertical fov in degrees, +y up: the
    three.js PerspectiveCamera of the browser renders), and whether each is in front, within PHOTO_MAX_DISTANCE and
    inside the frame."""
    pos = np.asarray(view["pos"], np.float64)
    forward = np.asarray(view["tgt"], np.float64) - pos
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 1.0, 0.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    d = np.asarray(points_room, np.float64).reshape(-1, 3) - pos
    x, y, z = d @ right, d @ up, d @ forward
    tan_half = math.tan(math.radians(float(view["fov"])) / 2)
    depth = np.maximum(z, 1e-9)
    column = (x / (depth * tan_half * width / height) + 1) * 0.5 * width
    row = (1 - y / (depth * tan_half)) * 0.5 * height
    inside = (z > 0.05) & (np.linalg.norm(d, axis=1) <= PHOTO_MAX_DISTANCE) & (column >= 0) & (column < width) & (row >= 0) & (row < height)
    return np.stack([column, row], -1), inside


def photo_hits(pixels, inside, photo_srgb, window: int = PHOTO_WINDOW, threshold: float = PHOTO_SATURATED) -> dict:
    """In-frame points within ±window pixels of a near-saturated photo pixel (brightest sRGB channel ≥ threshold)."""
    peak = np.asarray(photo_srgb, np.float64).max(-1)
    h, w = peak.shape
    hits = 0
    for (column, row), ok in zip(np.asarray(pixels), np.asarray(inside)):
        if not ok:
            continue
        c, r = int(column), int(row)
        patch = peak[max(r - window, 0):min(r + window + 1, h), max(c - window, 0):min(c + window + 1, w)]
        hits += int(patch.size > 0 and float(patch.max()) >= threshold)
    return {"visible": int(np.count_nonzero(inside)), "hits": hits}


def control_points(bulbs_e57, chandeliers) -> np.ndarray:
    """Per bulb, the point CONTROL_OFFSET m further from its chandelier's vertical axis at the same height (along +x
    for a bulb on the axis): empty air beside the fixture, clear of every bulb's bloom."""
    b = np.asarray(bulbs_e57, np.float64).reshape(-1, 3)
    out = b.copy()
    for k, chandelier in enumerate(chandeliers):
        centre = CHANDELIER_CENTRES[int(chandelier)]
        radial = b[k, :2] - centre[:2]
        length = float(np.hypot(radial[0], radial[1]))
        direction = radial / length if length > 1e-9 else np.array([1.0, 0.0])
        out[k, :2] = centre[:2] + direction * (length + CONTROL_OFFSET)
    return out


def photo_check(bulbs_e57, chandeliers, views: dict, photos: dict, t_json_from_e57, manifest_translation) -> dict:
    """Per night station: the bulbs' and the control points' hits. A station with covered bulbs in view passes when
    at least GATE_HIT_SHARE of them hit and the controls at most GATE_CONTROL_RATIO of that share; the check passes
    when every such station passes and at least one station sees covered bulbs."""
    b = np.asarray(bulbs_e57, np.float64).reshape(-1, 3)
    room_bulbs = e57_to_room(b, t_json_from_e57, manifest_translation)
    room_control = e57_to_room(control_points(b, chandeliers), t_json_from_e57, manifest_translation)
    stations = {}
    for name in NIGHT_VIEWS:
        photo = photos[name]
        bulb = photo_hits(*project_view(room_bulbs, views[name], photo.shape[1], photo.shape[0]), photo)
        ctrl = photo_hits(*project_view(room_control, views[name], photo.shape[1], photo.shape[0]), photo)
        share = bulb["hits"] / bulb["visible"] if bulb["visible"] else 0.0
        control = ctrl["hits"] / ctrl["visible"] if ctrl["visible"] else 0.0
        in_view = bulb["visible"] > 0
        stations[name] = {"bulbs": bulb, "control": ctrl, "share": round(share, 4), "controlShare": round(control, 4), "inView": in_view,
                          "pass": bool(in_view and share >= GATE_HIT_SHARE and control <= GATE_CONTROL_RATIO * share)}
    seen = [s for s in stations.values() if s["inView"]]
    return {"stations": stations, "pass": bool(seen) and all(s["pass"] for s in seen)}
```

- [ ] **Step 4: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_bulbs -v`
Expected: PASS, 12 tests.

- [ ] **Step 5: Point the config at the table and register the command** — in `tools/relight/config/grand-hall.json`, add to `paths`, after `"repo"`, the entry `"emitters": "D:/claude/real-hall/frontier/splats/evidence/bulbs.json"` (the study's table; its `10_bulb_table.py` writes it, and its run-A copy `work/bulbs.runA.json` existed on 7 October). If the table is absent, stop and report it to the controller: it is an input from the frontier study, not something this task makes. Then append to the end of `tools/relight/relight/__main__.py`:

```python
def cmd_bulbs(cfg, args) -> int:
    """<work>/bulbs.json: the crisp lamps at the emitter table's triangulated bulbs (R1d Task 1), and
    <evidence>/r1d/bulbs.json: the coverage, any misplaced bulb and the night photographs' projection check (exit 1 on
    a misplaced bulb, an empty table or a failed check)."""
    from PIL import Image
    from . import bulbs as B
    source = cfg.paths.get("emitters")
    if source is None or not os.path.exists(source):
        print(f"bulbs: no emitter table at paths.emitters ({source!r})", flush=True)
        return 1
    with open(cfg.paths["canonicalFrame"], encoding="utf-8") as f:
        t_je = np.asarray(json.load(f)["T_json_from_e57"], np.float64)
    table = B.read_emitters(source, t_je)
    bulbs, problems = B.place_bulbs(table["rows"], t_je)
    chandeliers = B.chandelier_entries(bulbs)
    counts = {g: sum(1 for b in bulbs if b["group"] == g) for g in B.GROUPS}
    out = {"schema": B.SCHEMA, "frame": "e57", "source": source, "pending": table["pending"], "chandeliers": chandeliers,
           "counts": counts, "bulbs": bulbs}
    tmp = os.path.join(cfg.paths["work"], "bulbs.json.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, sort_keys=True, allow_nan=False)
    os.replace(tmp, os.path.join(cfg.paths["work"], "bulbs.json"))
    with open(os.path.join(cfg.paths["proofWork"], "views.json"), encoding="utf-8") as f:
        views = {v["name"]: v for v in json.load(f)}
    photos = {}
    for name in B.NIGHT_VIEWS:
        with Image.open(os.path.join(cfg.paths["proofWork"], "cmp", f"photo_{name}.png")) as im:
            photos[name] = np.asarray(im.convert("RGB"), np.float64) / 255.0
    check = B.photo_check(np.array([b["position"] for b in bulbs]).reshape(-1, 3), [b["chandelier"] for b in bulbs], views, photos, t_je,
                          cfg.room["manifestTranslation"])
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    os.makedirs(evidence, exist_ok=True)
    report = {"counts": counts, "pending": table["pending"], "crisp": [c["id"] for c in chandeliers if c["crisp"]],
              "notCovered": [c["id"] for c in chandeliers if not c["crisp"]], "problems": problems, "photoCheck": check}
    with open(os.path.join(evidence, "bulbs.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1, sort_keys=True, allow_nan=False)
    ok = bool(bulbs) and not problems and check["pass"]
    print("bulbs", json.dumps(counts), "crisp", report["crisp"], "not covered", report["notCovered"], "problems", len(problems),
          "photo check", "pass" if check["pass"] else "FAIL",
          json.dumps({k: [v["share"], v["controlShare"], v["inView"]] for k, v in check["stations"].items()}), flush=True)
    return 0 if ok else 1


COMMANDS["bulbs"] = cmd_bulbs
```

- [ ] **Step 6: Run it twice and compare** (CPU only, seconds each, two separate processes)

```bash
cd D:/claude/real-hall/repo/tools/relight && mkdir -p D:/claude/relight/grand-hall/verify/r1d \
 && C:/Python313/python.exe -m relight bulbs --config config/grand-hall.json; cp D:/claude/relight/grand-hall/work/bulbs.json D:/claude/relight/grand-hall/verify/r1d/bulbs-run1.json \
 && C:/Python313/python.exe -m relight bulbs --config config/grand-hall.json; cp D:/claude/relight/grand-hall/work/bulbs.json D:/claude/relight/grand-hall/verify/r1d/bulbs-run2.json \
 && C:/Python313/python.exe -c "import json;a,b=(json.load(open(f'D:/claude/relight/grand-hall/verify/r1d/bulbs-run{i}.json')) for i in (1,2));print('identical' if a==b else 'DIFFER')"
```
Expected: each run prints the bulbs per group, the chandeliers with crisp lamps and those not covered (with the first table, `bulbs {"ch_end": 29, "ch_centre": 54} crisp [0, 2] not covered [1, 3, 4]`; more as the study triangulates them), `problems 0` and `photo check pass {…}`, then `identical`. `DIFFER`: run a third time and keep the majority (Global Constraints). A problem or `FAIL`: stop and report the bulbs and both stations' shares; the gates are not tuned to pass.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/bulbs.py tools/relight/tests/test_bulbs.py tools/relight/relight/__main__.py tools/relight/config/grand-hall.json && git diff --cached --stat && git commit -m "feat(relight): the crisp lamps at the triangulated chandelier bulbs, checked against the night photographs (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The simplified interior occluder model (offline)

**Files:**
- Create: `tools/relight/relight/occluders.py`, `tools/relight/tests/test_occluders.py`
- Modify: `tools/relight/relight/__main__.py` (append the `occluders` command)
- Outputs (D:): `D:/claude/relight/grand-hall/work/occluders.npz` (`triangles` (T, 3, 3) float32, e57 metres), `D:/claude/relight/grand-hall/evidence/r1d/occluders.json`, `D:/claude/relight/grand-hall/verify/r1d/occluders-run{1,2}.npz`

**Interfaces:**
- Consumes: R1a's tables (`splats_pos.npy`, `splats_opa.npy`, `geom_cls.npy`, `geom_chand_id.npy`), `cfg.room["hallE57"]` (`y0`, the window wall's inner face) and `cfg.room["windows"]` (`[x0, x1, depth, sill, top, kind]` per window).
- Produces: `OCCLUDER_VOXEL = 0.04`, `CLASS_CH_EMITTER = 3`, `OCCUPIED = 0.5`, `MAX_TRIANGLES = 1_500_000`, `PART_NAMES = ("chandeliers", "pilasters")`; `occluder_selection(pos, cls, chand_id, y0, windows) -> (chandeliers (N,) bool, pilasters (N,) bool)`; `occupancy(points, alpha, lo, voxel, dims) -> ndarray`; `solid_cells(occupancy) -> ndarray[bool]`; `face_triangles(solid, lo, voxel) -> (T, 3, 3) float32`; `build_occluders(pos, opa, cls, chand_id, y0, windows) -> (triangles, parts)`; the command `occluders`.

Spec §4.2 asks for a sun shadow map of the interior occluders "from a simplified occluder model". The chandeliers are every splat inside a chandelier's volume (`chand_id ≥ 0`, `02_geometry.py`) except its glow (class 3: the capture's bloom of the bulbs, 48–59% of each chandelier's splats, which the frontier splats study measured; decision 1), so the brass casts the shadow and the bloom does not fatten it; the frosted lamps themselves are small and translucent. The pilasters are the interior splats (class 0) on the window wall's room side, 0.10–0.75 m in from its inner face (clear of the embrasures, whose class-1 box ends 0.08 m in), 0.3–5.6 m up, and at least 5 cm outside every window's opening (the window volumes already hold what the sun crosses inside an opening). Each part is accumulated into 4 cm voxels as 1 − Π(1 − α), the proof's occupancy rule; a cell at or above 0.5 is solid; one binary closing joins the lacy chandeliers; and each solid cell's faces that touch an empty cell become two triangles. The browser draws the triangles into a depth map from the sun (Task 10).

Verified: `tools/relight/proof/02_geometry.py:86-92,129-140` (the chandelier volumes; the occupancy rule `1 − exp(Σ log(1 − α))` with α clamped at 0.995 and a 3³ neighbourhood); `tools/relight/config/grand-hall.json` (`hallE57.y0 = -10.329`; the five windows' `x0`, `x1`); `scipy.ndimage.binary_closing` (scipy 1.17).

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_occluders.py`:

```python
import unittest

import numpy as np

from relight import occluders as O


class Selection(unittest.TestCase):
    def test_chandeliers_and_the_window_walls_pilasters(self):
        y0 = -10.0
        pos = np.array([
            [2.0, -7.0, 4.3],      # inside a chandelier's volume: brass
            [2.1, -7.0, 4.3],      # inside it too, but glow (class 3): no shadow
            [2.0, -9.7, 2.0],      # room side between the windows: a pilaster
            [5.0, -9.7, 2.0],      # inside window (4.5, 6.0): left to the window volume
            [2.0, -9.95, 2.0],     # the wall face itself (within 10 cm)
            [2.0, -9.7, 6.0],      # above the pilasters' band
            [2.0, -9.7, 2.0],      # an embrasure splat (class 1)
        ])
        cls = np.array([0, 3, 0, 0, 0, 0, 1], np.uint8)
        chand = np.array([0, 0, -1, -1, -1, -1, -1], np.int8)
        chandeliers, pilasters = O.occluder_selection(pos, cls, chand, y0, [(4.5, 6.0)])
        self.assertEqual(chandeliers.tolist(), [True, False, False, False, False, False, False])
        self.assertEqual(pilasters.tolist(), [False, False, True, False, False, False, False])


class Voxels(unittest.TestCase):
    def test_occupancy_is_one_minus_the_product_of_transmittances(self):
        occ = O.occupancy(np.array([[0.01, 0.01, 0.01], [0.02, 0.02, 0.02], [0.05, 0.01, 0.01]]),
                          np.array([0.5, 0.5, 0.3]), np.zeros(3), 0.04, np.array([2, 1, 1]))
        np.testing.assert_allclose(occ.ravel(), [0.75, 0.3])

    def test_one_solid_cell_has_six_faces_of_two_triangles(self):
        solid = np.zeros((3, 3, 3), bool); solid[1, 1, 1] = True
        tris = O.face_triangles(solid, np.array([10.0, 20.0, 30.0]), 0.04)
        self.assertEqual(tris.shape, (12, 3, 3))
        self.assertEqual(tris.dtype, np.float32)
        np.testing.assert_allclose(tris.reshape(-1, 3).min(0), [10.04, 20.04, 30.04], atol=1e-5)
        np.testing.assert_allclose(tris.reshape(-1, 3).max(0), [10.08, 20.08, 30.08], atol=1e-5)

    def test_shared_faces_are_not_drawn(self):
        solid = np.zeros((4, 3, 3), bool); solid[1, 1, 1] = solid[2, 1, 1] = True
        self.assertEqual(O.face_triangles(solid, np.zeros(3), 0.04).shape[0], 20)

    def test_the_closing_joins_a_one_cell_gap(self):
        occ = np.zeros((7, 5, 5)); occ[1:3, 2, 2] = 1.0; occ[4:6, 2, 2] = 1.0
        self.assertTrue(O.solid_cells(occ)[3, 2, 2])

    def test_a_blob_of_splats_becomes_a_closed_shell(self):
        rng = np.random.default_rng(1)
        pts = rng.uniform(0.0, 0.2, size=(4000, 3))
        tris, parts = O.build_occluders(pts, np.full(4000, 0.6), np.zeros(4000, np.uint8), np.zeros(4000, np.int8), -10.0, [])
        self.assertGreater(parts["chandeliers"]["cells"], 0)
        self.assertEqual(parts["pilasters"]["triangles"], 0)
        self.assertEqual(len(tris), parts["chandeliers"]["triangles"])
        self.assertEqual(len(tris) % 2, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_occluders -v`
Expected: FAIL — `ImportError: cannot import name 'occluders' from 'relight'`.

- [ ] **Step 3: Implement** — create `tools/relight/relight/occluders.py`:

```python
"""The simplified interior occluder model (T-639 R1d, plan Task 2).

Spec §4.2: the interior occluders (the chandeliers and the window wall's pilasters; furniture later) cast the sun's
interior shadows from a simplified model drawn into a sun shadow map (R1d Task 10). Their splats (R1a's tables, e57
frame) are accumulated into OCCLUDER_VOXEL cells as 1 - prod(1 - alpha) (02_geometry.py's occupancy rule), a cell at
or above OCCUPIED is solid, one binary closing joins the lacy parts, and each solid cell's faces that touch an empty
cell become two triangles. Deterministic: the same tables give the same triangles."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import binary_closing

OCCLUDER_VOXEL = 0.04
CLASS_CH_EMITTER = 3          # 02_geometry.py: the chandelier emitter class, the capture's glow (R1d decision 1)
OCCUPIED = 0.5
ALPHA_MAX = 0.995
PILASTER_FROM = 0.10
PILASTER_DEPTH = 0.75
PILASTER_Z = (0.3, 5.6)
WINDOW_MARGIN = 0.05
MAX_TRIANGLES = 1_500_000
PART_NAMES = ("chandeliers", "pilasters")


def occluder_selection(pos, cls, chand_id, y0: float, windows) -> tuple[np.ndarray, np.ndarray]:
    """(chandeliers, pilasters): every splat inside a chandelier's volume but its glow (class 3, the capture's bloom);
    the interior splats of the window wall's room side, PILASTER_FROM..PILASTER_DEPTH m in from y0, within PILASTER_Z,
    outside every window's opening."""
    pos = np.asarray(pos, np.float64)
    cls = np.asarray(cls)
    chandeliers = (np.asarray(chand_id) >= 0) & (cls != CLASS_CH_EMITTER)
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    band = (cls == 0) & (y > y0 + PILASTER_FROM) & (y < y0 + PILASTER_DEPTH) & (z > PILASTER_Z[0]) & (z < PILASTER_Z[1])
    for x0, x1 in windows:
        band &= ~((x > x0 - WINDOW_MARGIN) & (x < x1 + WINDOW_MARGIN))
    return chandeliers, band & ~chandeliers


def occupancy(points, alpha, lo, voxel: float, dims) -> np.ndarray:
    """1 - prod(1 - alpha) per cell of a grid of `dims` cells from `lo` at `voxel` m; points outside are ignored."""
    dims = np.asarray(dims, np.int64)
    ijk = np.floor((np.asarray(points, np.float64) - np.asarray(lo, np.float64)) / voxel).astype(np.int64)
    ok = np.all((ijk >= 0) & (ijk < dims), axis=1)
    ijk = ijk[ok]
    a = np.clip(np.asarray(alpha, np.float64)[ok], 0.0, ALPHA_MAX)
    flat = (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2]
    log_t = np.bincount(flat, np.log1p(-a), int(np.prod(dims)))
    return (1.0 - np.exp(log_t)).reshape(tuple(int(d) for d in dims))


def solid_cells(occ) -> np.ndarray:
    """Cells at or above OCCUPIED, closed once with a 3 x 3 x 3 structure (padded so the border is not eroded)."""
    padded = np.pad(np.asarray(occ) >= OCCUPIED, 2)
    closed = binary_closing(padded, structure=np.ones((3, 3, 3), bool))
    return closed[2:-2, 2:-2, 2:-2]


def face_triangles(solid, lo, voxel: float) -> np.ndarray:
    """(T, 3, 3) float32: two triangles per solid cell face whose neighbour is empty (outside the grid is empty)."""
    s = np.pad(np.asarray(solid, bool), 1)
    lo = np.asarray(lo, np.float64)
    out = []
    for axis in range(3):
        u, v = [a for a in range(3) if a != axis]
        for sign in (-1, 1):
            exposed = (s & ~np.roll(s, -sign, axis=axis))[1:-1, 1:-1, 1:-1]
            cells = np.argwhere(exposed).astype(np.float64)
            if len(cells) == 0:
                continue
            base = cells.copy()
            base[:, axis] += 1.0 if sign > 0 else 0.0
            c1 = base.copy(); c1[:, u] += 1.0
            c2 = c1.copy(); c2[:, v] += 1.0
            c3 = base.copy(); c3[:, v] += 1.0
            quads = np.stack([base, c1, c2, base, c2, c3], 1).reshape(-1, 3, 3)
            out.append(lo + quads * voxel)
    return np.concatenate(out).astype(np.float32) if out else np.zeros((0, 3, 3), np.float32)


def build_occluders(pos, opa, cls, chand_id, y0: float, windows) -> tuple[np.ndarray, dict]:
    """The occluder triangles of every part, and per part its splat, solid-cell and triangle counts."""
    pos = np.asarray(pos, np.float64)
    opa = np.asarray(opa, np.float64)
    masks = dict(zip(PART_NAMES, occluder_selection(pos, cls, chand_id, y0, windows)))
    triangles, parts = [], {}
    for name in PART_NAMES:
        mask = masks[name]
        if not mask.any():
            parts[name] = {"splats": 0, "cells": 0, "triangles": 0}
            continue
        p = pos[mask]
        lo = p.min(0) - 2 * OCCLUDER_VOXEL
        dims = np.ceil((p.max(0) - lo) / OCCLUDER_VOXEL).astype(np.int64) + 3
        solid = solid_cells(occupancy(p, opa[mask], lo, OCCLUDER_VOXEL, dims))
        t = face_triangles(solid, lo, OCCLUDER_VOXEL)
        parts[name] = {"splats": int(mask.sum()), "cells": int(solid.sum()), "triangles": int(len(t))}
        triangles.append(t)
    tris = np.concatenate(triangles) if triangles else np.zeros((0, 3, 3), np.float32)
    if len(tris) > MAX_TRIANGLES:
        raise ValueError(f"{len(tris)} occluder triangles exceed {MAX_TRIANGLES}")
    return tris, parts
```

- [ ] **Step 4: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_occluders -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the command** — append to the end of `tools/relight/relight/__main__.py`:

```python
def cmd_occluders(cfg, args) -> int:
    """<work>/occluders.npz: the simplified interior occluder model (R1d Task 2), and <evidence>/r1d/occluders.json."""
    from . import occluders as O
    npy = os.path.join(cfg.paths["work"], "npy")

    def table(name: str):
        return np.load(os.path.join(npy, name), mmap_mode="r")

    windows = [(float(v[0]), float(v[1])) for v in cfg.room["windows"].values()]
    tris, parts = O.build_occluders(table("splats_pos.npy"), table("splats_opa.npy"), table("geom_cls.npy"),
                                    table("geom_chand_id.npy"), float(cfg.room["hallE57"]["y0"]), windows)
    path = os.path.join(cfg.paths["work"], "occluders.npz")
    with open(path + ".tmp", "wb") as f:
        np.savez(f, triangles=tris)
    os.replace(path + ".tmp", path)
    flat = tris.reshape(-1, 3)
    bounds = [flat.min(0).round(4).tolist(), flat.max(0).round(4).tolist()] if len(flat) else [[0, 0, 0], [0, 0, 0]]
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    os.makedirs(evidence, exist_ok=True)
    with open(os.path.join(evidence, "occluders.json"), "w", encoding="utf-8") as f:
        json.dump({"parts": parts, "triangles": int(len(tris)), "bounds": bounds, "voxel": O.OCCLUDER_VOXEL}, f, indent=1, sort_keys=True)
    print("occluders", json.dumps(parts), "bounds", json.dumps(bounds), flush=True)
    return 0


COMMANDS["occluders"] = cmd_occluders
```

- [ ] **Step 6: Run it twice and compare the arrays** (CPU only, minutes; two separate processes)

```bash
cd D:/claude/real-hall/repo/tools/relight \
 && C:/Python313/python.exe -m relight occluders --config config/grand-hall.json; cp D:/claude/relight/grand-hall/work/occluders.npz D:/claude/relight/grand-hall/verify/r1d/occluders-run1.npz \
 && C:/Python313/python.exe -m relight occluders --config config/grand-hall.json; cp D:/claude/relight/grand-hall/work/occluders.npz D:/claude/relight/grand-hall/verify/r1d/occluders-run2.npz \
 && C:/Python313/python.exe -c "import numpy as np;a,b=(np.load(f'D:/claude/relight/grand-hall/verify/r1d/occluders-run{i}.npz')['triangles'] for i in (1,2));print('identical' if a.dtype==b.dtype and a.shape==b.shape and a.tobytes()==b.tobytes() else 'DIFFER', a.shape)"
```
Expected: each run prints both parts with triangles and bounds within the hall box (x −1.823..19.307, y −10.329..0.301, z 0.02..6.78, within 0.1 m); then `identical (T, 3, 3)` with T at most 1,500,000. (`np.savez` stamps the zip's time, so the arrays are compared, not the files.) `DIFFER`: a third run and the majority. A part with no triangles: stop and report.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/occluders.py tools/relight/tests/test_occluders.py tools/relight/relight/__main__.py && git diff --cached --stat && git commit -m "feat(relight): the simplified interior occluder model for the sun's shadow map (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The cinematic package and its contract (offline)

**Files:**
- Create: `tools/relight/relight/cinematic.py`, `tools/relight/tests/test_cinematic.py`, `docs/engineering/cinematic-package.md`
- Modify: `tools/relight/relight/__main__.py` (append the `cinematic` command)
- Outputs (D:): the staged package `D:/claude/splats/trades-hall/grand-hall/cinematic/v1/` (`manifest.json`, `occluders.bin.gz`), `D:/claude/relight/grand-hall/verify/r1d/cinematic-run{1,2}/`

**Interfaces:**
- Consumes: Task 1's `<work>/bulbs.json` (v2: `bulbs[]` with `id`, `group`, `chandelier`, `position`; `chandeliers[]` with `id`, `centre`, `crisp`), Task 2's `<work>/occluders.npz`, R1a's `<work>/floor-light.npz` (`D` (h, w, 9) float32, the nine sources' direct light per unit weight; `texelToModel` 16 row-major) and `<work>/lamp_daylight_ratio.json` (`lamp_over_daylight_rgb`), relight package v2's `manifest.json` (R1c; `model.tileToModel`), `cfg.room["hallE57"]`, `cfg.room["slug"]`, `cfg.paths["out"]` (`…/relight/v1`), `cfg.paths["repo"]`, `cfg.room["windows"]`; when present, the bake's house-light refit `<work>/bulb-intensities.json` (the amendments file's "Interfaces from the bake"), and once Task 21 has run, `<work>/night-calibration.json` and `<work>/eye-anchors.json`.
- Produces (`cinematic.py`): `SCHEMA = "venviewer.cinematic.v1"`, `SOURCE_INDEX = {"ch_end": 6, "ch_centre": 7}`, `ENVELOPE = {"kind": "candle", "radius": 0.0175, "height": 0.07}`, `LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")`, `DEFAULT_DIMMING = "warm"`, `D65_CCT = 6504.0`, `DAYLIGHT_RANGE` (D60 and D75), `WINDOW_PROBE_DISTANCE = 2.0`, `EYE_ANCHORS = ("day", "lamps", "moon")`, `MAX_BULBS = 512`, `SHARES_SCHEMA = "venviewer.bulb-intensities.v1"`; `texel_of(point, texel_to_model, width, height) -> (column, row)`; `texel_point(column, row, texel_to_model) -> (3,)`; `bulb_shares(path, bulbs) -> {id: float}`; `bulb_intensities(direct, texel_to_model, bulbs, chandeliers, shares) -> {id: float}`; `projected_solid_angle(point, x0, x1, sill, top, y0, cells=48) -> float`; `window_radiance(direct, texel_to_model, windows, y0) -> list[float]`; `daylight_xy(cct) -> (x, y)`; `xy_to_linear_srgb(x, y) -> (3,)`; `mccamy_cct(rgb) -> float`; `warm_down(ratio_path) -> dict`; `lamp_groups() -> dict`; `probe_placements(hall) -> list[dict]`; `bulb_entries(bulbs, intensities) -> list[dict]`; `night_gains(path) -> dict`; `eye_anchors(path) -> dict | None`; `package_paths(cfg) -> (relight_manifest, out_dir)`; `write_package(out_dir, fields: dict, triangles) -> dict`; the command `cinematic`.
- Produces (data, the contract): `venviewer.cinematic.v1` as `docs/engineering/cinematic-package.md` defines it, read by Task 8.

A lamp's GGX sheen (Task 17) and a crisp lamp's brightness (Task 11) must agree with the light the lamp already throws on the floor, so each crisp bulb's intensity is solved from R1a's floor light, per unit of the group's own source weight (decision 11: no weight is assumed). Under each covered chandelier the group's baked direct light equals the group intensity times its geometry: the sum over the group's crisp bulbs of their shares times `cosθ / d²`, plus, for each of the group's chandeliers without crisp lamps yet, its bulbs at its centre (the group's mean bulbs per covered chandelier), since the bake's source holds every chandelier of the group and at 5 m or more a chandelier is a point to within a few per cent. The median over covered chandeliers is the group intensity; each bulb's is that times its share. The shares are the bake's per-bulb refit when it exists (relative intensities, normalised to a mean of 1 per group), else 1. Each window's sky radiance per unit source weight is solved the same way: 2 m into the room in front of the window, its baked direct light on the floor divided by the window's projected solid angle there (the light has already crossed the embrasure and the glass). The crisp lamp's envelope is a design value for Blake to judge: a frosted candle lamp 35 mm across and 70 mm tall above its holder (the common C35 candle; the venue's lamp product is asked for, light study §b9). The lamps' dimming (decision 11): every group `warm` (the owner's artistic warm-down), and the warm-down's starting temperature from the capture's measured lamp/daylight colour against CIE daylight by McCamy's formula (D65; D60 to D75 recorded as the range). Three reflection probes stand on the hall's long axis at eye height, each boxed by the hall. The night gains are 1 and the eye's anchors absent until Task 21 measures them. Everything is written deterministically: `createdAt` is the commit's time and the gzip carries no timestamp.

Verified (7 October): R1a's `floor-light.npz` layout (R1a Task 4 report, Addendum: `D` (h, w, 9), 424 × 212 texels at 0.05 m, columns toward −x, rows toward +y, row 0 on the window side; `texelToModel` row-major); `docs/engineering/relight-package.md` (sources W1..W5, cove, ch_end, ch_centre, dome: indices 5–8); `tools/relight/config/grand-hall.json` (`paths.out`, `paths.repo`, `room.slug`, `room.hallE57`); `D:/claude/relight/grand-hall/work/lamp_daylight_ratio.json` (`lamp_over_daylight_rgb` [1.623, 1.0, 0.467]; R1a's `__main__.py:93-99` copies it from the proof); the CIE daylight locus (CIE 15:2004, x_D for 4,000–7,000 K and 7,000–25,000 K, y_D = −3.000 x_D² + 2.870 x_D − 0.275) and McCamy's CCT (*Color Res. Appl.* 17(2):142–144, 1992: n = (x − 0.3320)/(0.1858 − y), CCT = 449n³ + 3525n² + 6823.3n + 5520.33): the measured ratio gives 3,700.1 K at D65 (6,504 K) and 3,537.4–3,984.7 K for D60–D75 (computed 7 October with this task's code; the light study's spectral reading, `D:/claude/real-hall/frontier/light/evidence/lamp_colours.json`: 3,509, 3,672, 3,956 K).

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_cinematic.py`:

```python
import gzip
import hashlib
import json
import os
import tempfile
import unittest

import numpy as np

from relight import cinematic as C

T2M = [0.05, 0, 0, 1.0, 0, 0.05, 0, 2.0, 0, 0, 0, 0.04, 0, 0, 0, 1]   # 5 cm texels from (1, 2), z 0.04


def chandeliers(uncovered=None) -> list[dict]:
    """Five chandeliers, 0 and 2 crisp; the rest add no light to the test texels unless `uncovered` places them."""
    out = [{"id": i, "centre": [100.0 + 10.0 * i, 100.0, -10.0], "crisp": i in (0, 2)} for i in range(5)]   # below the floor: no light
    for i, centre in (uncovered or {}).items():
        out[i] = {"id": i, "centre": centre, "crisp": False}
    return out


class Floor(unittest.TestCase):
    def test_texels_and_their_points_round_trip(self):
        self.assertEqual(C.texel_of([1.52, 2.49, 0.0], T2M, 100, 100), (10, 10))
        np.testing.assert_allclose(C.texel_point(10, 10, T2M), [1.5, 2.5, 0.04])
        self.assertEqual(C.texel_of([-5.0, 99.0, 0.0], T2M, 100, 100), (0, 99))

    def test_a_single_bulb_above_the_floor_gives_its_intensity_back(self):
        bulb = {"id": "c2_b00", "group": "ch_centre", "chandelier": 2, "position": [1.5, 2.5, 4.04]}
        direct = np.zeros((100, 100, 9))
        direct[10, 10, 7] = 7.0 / 16.0          # I = 7 at 4 m straight up: E = I / d²
        self.assertEqual(C.bulb_intensities(direct, T2M, [bulb], chandeliers(), {"c2_b00": 1.0}), {"c2_b00": 7.0})

    def test_the_bakes_shares_divide_a_group_between_its_bulbs(self):
        above = {"id": "c2_b00", "group": "ch_centre", "chandelier": 2, "position": [1.5, 2.5, 4.04]}
        aside = {"id": "c2_b01", "group": "ch_centre", "chandelier": 2, "position": [4.5, 2.5, 4.04]}
        direct = np.zeros((100, 100, 9))
        # Texel under the pair's mean (3.0, 2.5): each bulb is 1.5 m aside, d = sqrt(18.25).
        d = 18.25 ** 0.5
        direct[10, 40, 7] = 2.0 * (1.5 + 0.5) * 4.0 / d ** 3
        intensity = C.bulb_intensities(direct, T2M, [above, aside], chandeliers(), {"c2_b00": 1.5, "c2_b01": 0.5})
        self.assertAlmostEqual(intensity["c2_b00"], 3.0, places=9)
        self.assertAlmostEqual(intensity["c2_b01"], 1.0, places=9)

    def test_a_chandelier_without_crisp_lamps_still_counts_at_its_centre(self):
        bulb = {"id": "c0_b00", "group": "ch_end", "chandelier": 0, "position": [1.5, 2.5, 4.04]}
        direct = np.zeros((100, 100, 9))
        # Chandelier 1 (not crisp) at 3 m aside, same height: one bulb there (the group's mean per covered chandelier).
        direct[10, 10, 6] = 5.0 * (1.0 / 16.0 + 4.0 / 125.0)
        fixtures = chandeliers(uncovered={1: [4.5, 2.5, 4.04]})
        self.assertAlmostEqual(C.bulb_intensities(direct, T2M, [bulb], fixtures, {"c0_b00": 1.0})["c0_b00"], 5.0, places=9)

    def test_shares_are_one_without_the_refit_and_normalised_per_group_with_it(self):
        bulbs = [{"id": "c0_b00", "group": "ch_end"}, {"id": "c0_b01", "group": "ch_end"}, {"id": "c2_b00", "group": "ch_centre"}]
        self.assertEqual(C.bulb_shares(os.path.join(tempfile.gettempdir(), "no-such-bulb-intensities.json"), bulbs),
                         {"c0_b00": 1.0, "c0_b01": 1.0, "c2_b00": 1.0})
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "bulb-intensities.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"schema": C.SHARES_SCHEMA, "bulbs": {"c0_b00": 3.0, "c0_b01": 1.0, "c2_b00": 7.0}}, f)
            self.assertEqual(C.bulb_shares(path, bulbs), {"c0_b00": 1.5, "c0_b01": 0.5, "c2_b00": 1.0})
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"schema": C.SHARES_SCHEMA, "bulbs": {"c0_b00": 3.0, "c2_b00": 7.0}}, f)
            with self.assertRaises(ValueError):
                C.bulb_shares(path, bulbs)

    def test_a_small_window_far_away_subtends_its_area_times_both_cosines_over_d_squared(self):
        # a 10 cm window centred 1 m up at y0 = 0, seen from (0, 2, 0) facing +z: d = sqrt(5), cos_w = 2/d, cos_r = 1/d
        omega = C.projected_solid_angle(np.array([0.0, 2.0, 0.0]), -0.05, 0.05, 0.95, 1.05, 0.0)
        self.assertAlmostEqual(omega, 0.01 * 2.0 / 25.0, delta=0.01 * 0.0008)

    def test_a_windows_radiance_is_its_floor_light_over_its_projected_solid_angle(self):
        windows = {"W1": [0.75, 1.25, 0.5, 0.95, 1.05, "rect"]}
        point = C.texel_point(*C.texel_of([1.0, 2.0 + C.WINDOW_PROBE_DISTANCE, 0.0], T2M, 100, 100), T2M)
        omega = C.projected_solid_angle(point, 0.75, 1.25, 0.95, 1.05, 2.0)
        direct = np.zeros((100, 100, 9))
        column, row = C.texel_of([1.0, 2.0 + C.WINDOW_PROBE_DISTANCE, 0.0], T2M, 100, 100)
        direct[row, column, 0] = 3.0 * omega
        self.assertAlmostEqual(C.window_radiance(direct, T2M, windows, 2.0)[0], 3.0, places=9)


class Placement(unittest.TestCase):
    def test_three_probes_on_the_long_axis_at_eye_height(self):
        hall = {"x0": 0.0, "x1": 18.0, "y0": -10.0, "y1": 0.0, "floorZ": 0.0, "ceilingZ": 7.0}
        probes = C.probe_placements(hall)
        self.assertEqual([p["position"] for p in probes], [[3.0, -5.0, 1.6], [9.0, -5.0, 1.6], [15.0, -5.0, 1.6]])
        self.assertEqual(probes[0]["box"], [[0.0, -10.0, 0.0], [18.0, 0.0, 7.0]])

    def test_each_entry_carries_its_bulbs_intensity(self):
        entries = C.bulb_entries([{"id": "c0_b00", "group": "ch_end", "chandelier": 0, "position": [1.0, 2.0, 4.0], "views": 30, "rayMm": 3.0}],
                                 {"c0_b00": 7.123456789})
        self.assertEqual(entries, [{"id": "c0_b00", "group": "ch_end", "chandelier": 0, "position": [1.0, 2.0, 4.0], "intensity": 7.123457}])


class Lamps(unittest.TestCase):
    def test_mccamy_puts_srgb_white_at_d65(self):
        self.assertAlmostEqual(C.mccamy_cct(np.array([1.0, 1.0, 1.0])), 6504.0, delta=3.0)
        x, y = C.daylight_xy(C.D65_CCT)
        self.assertAlmostEqual(x, 0.3127, delta=2e-4)
        self.assertAlmostEqual(y, 0.3291, delta=2e-4)

    def test_the_warm_down_starts_at_the_measured_lamp_colour_temperature(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "lamp_daylight_ratio.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"lamp_over_daylight_rgb": [1.623, 1.0, 0.467]}, f)
            warm = C.warm_down(path)
        self.assertAlmostEqual(warm["fullCct"], 3700.1, delta=0.15)
        self.assertAlmostEqual(warm["range"][0], 3537.4, delta=0.15)
        self.assertAlmostEqual(warm["range"][1], 3984.7, delta=0.15)
        self.assertIn("McCamy", warm["provenance"])

    def test_every_group_dims_warm_by_default(self):
        self.assertEqual(C.lamp_groups(), {g: {"dimming": "warm"} for g in C.LAMP_GROUPS})


class Calibration(unittest.TestCase):
    def test_gains_are_one_until_the_night_calibration_exists(self):
        night = C.night_gains(os.path.join(tempfile.gettempdir(), "no-such-night-calibration.json"))
        self.assertEqual(night["calibrated"], False)
        self.assertEqual(night["gains"]["cove"], [1.0, 1.0, 1.0])

    def test_the_eyes_anchors_are_absent_until_measured_and_checked_when_present(self):
        self.assertIsNone(C.eye_anchors(os.path.join(tempfile.gettempdir(), "no-such-eye-anchors.json")))
        anchor = {"exposure": 0.8, "whiteBalance": [0.9, 1.0, 1.2], "logLuminance": -3.5, "logChroma": [0.2, -0.4]}
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "eye-anchors.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"anchors": {"day": anchor, "lamps": anchor, "moon": anchor}}, f)
            self.assertEqual(C.eye_anchors(path)["anchors"]["moon"]["logChroma"], [0.2, -0.4])
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"anchors": {"day": anchor, "lamps": dict(anchor, exposure=-1.0), "moon": anchor}}, f)
            with self.assertRaises(ValueError):
                C.eye_anchors(path)

    def test_a_calibration_with_a_bad_gain_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "night-calibration.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"gains": {"cove": [1, 1, 0], "ch_end": [1, 1, 1], "ch_centre": [1, 1, 1], "dome": [1, 1, 1]}}, f)
            with self.assertRaises(ValueError):
                C.night_gains(path)


class Writer(unittest.TestCase):
    def test_the_package_is_deterministic_and_checksummed(self):
        tris = np.arange(18, dtype=np.float32).reshape(2, 3, 3)
        fields = {"room": "grand-hall", "createdAt": "2026-10-03T21:40:00+01:00", "tool": "abc",
                  "tileToModel": [float(v) for v in np.eye(4).ravel()],
                  "relight": {"package": "relight/v2", "manifestSha256": "0" * 64}, "bulbs": [], "chandeliers": chandeliers(),
                  "windowRadiance": [1.0, 2.0, 3.0, 4.0, 5.0], "warmDown": {"fullCct": 3700.1, "range": [3537.4, 3984.7], "provenance": "test"},
                  "groups": C.lamp_groups(), "probes": [], "night": C.night_gains("missing.json"), "eye": None}
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            first, second = C.write_package(a, fields, tris), C.write_package(b, fields, tris)
            self.assertEqual(first, second)
            for name in ("manifest.json", "occluders.bin.gz"):
                with open(os.path.join(a, name), "rb") as fa, open(os.path.join(b, name), "rb") as fb:
                    self.assertEqual(fa.read(), fb.read())
            with open(os.path.join(a, "occluders.bin.gz"), "rb") as f:
                data = f.read()
            self.assertEqual(first["files"]["occluders.bin.gz"], {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
            self.assertEqual(np.frombuffer(gzip.decompress(data), "<f4").reshape(-1, 3, 3).tolist(), tris.tolist())
            self.assertEqual(first["schema"], C.SCHEMA)
            self.assertEqual(first["occluders"]["triangles"], 2)
            self.assertEqual(first["bulbs"]["envelope"], C.ENVELOPE)
            self.assertEqual(first["lamps"]["groups"]["dome"], {"dimming": "warm"})
            self.assertEqual([c["crisp"] for c in first["chandeliers"]], [True, False, True, False, False])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematic -v`
Expected: FAIL — `ImportError: cannot import name 'cinematic' from 'relight'`.

- [ ] **Step 3: Implement** — create `tools/relight/relight/cinematic.py`:

```python
"""The cinematic package (venviewer.cinematic.v1, T-639 R1d plan Task 3).

What R1d's browser reads beside the relight package: the crisp lamps at the triangulated bulbs (Task 1) with each
bulb's intensity per unit of its group's source weight (solved from R1a's floor light, so a lamp's crisp glass, its
specular and its diffuse light agree; no weight is assumed), the chandeliers whose glow the browser hides, the lamps'
dimming (warm by the owner's artistic choice, LED-true on a flag) and the warm-down's starting temperature (from the
measured lamp/daylight colour), the interior occluder model (Task 2), the reflection probes' placements, the night
calibration and the eye's anchors (Task 21). Contract: docs/engineering/cinematic-package.md. The same inputs and
commit give the same bytes."""
from __future__ import annotations

import gzip
import hashlib
import json
import os

import numpy as np

SCHEMA = "venviewer.cinematic.v1"
#: The crisp lamps' groups and their sources (codec.py SOURCES). The dome's "emitters" are crests lit by LED pin
#: spots, surfaces rather than lamps (light study §b9), so the dome has no crisp lamps.
SOURCE_INDEX = {"ch_end": 6, "ch_centre": 7}
#: The crisp lamp: a frosted candle lamp 35 mm across and 70 mm tall above its holder (a design value for Blake;
#: the venue's lamp product is asked for).
ENVELOPE = {"kind": "candle", "radius": 0.0175, "height": 0.07}
PROBE_HEIGHT = 1.6
PROBE_FRACTIONS = (1 / 6, 0.5, 5 / 6)
LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")
#: ARTISTIC (Blake, 7 October; spec §4.1): the hall's lamps are LED and keep their colour as they dim, but every
#: group dims warm by default. "led" is the lamps' own behaviour.
DEFAULT_DIMMING = "warm"
#: CIE D65 and, as the range, D60 and D75 (nominal 6,000 and 7,500 K on the 1968 scale: x 1.4388/1.438).
D65_CCT = 6504.0
DAYLIGHT_RANGE = (6000.0 * 1.4388 / 1.438, 7500.0 * 1.4388 / 1.438)
SRGB_TO_XYZ = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
OCCLUDER_FILE = "occluders.bin.gz"
WINDOW_PROBE_DISTANCE = 2.0
EYE_ANCHORS = ("day", "lamps", "moon")
#: At most this many crisp lamps (the browser's instanced draw and the schema's bound).
MAX_BULBS = 512
#: The bake's house-light refit: relative per-bulb intensities (the amendments file's "Interfaces from the bake").
SHARES_SCHEMA = "venviewer.bulb-intensities.v1"


def texel_of(point, texel_to_model, width: int, height: int) -> tuple[int, int]:
    """The light-map texel nearest a model point's x and y: the in-plane inverse of texelToModel, clamped."""
    t = np.asarray(texel_to_model, np.float64).reshape(4, 4)
    column, row = np.linalg.solve(t[:2, :2], np.asarray(point, np.float64)[:2] - t[:2, 3])
    return int(min(max(round(column), 0), width - 1)), int(min(max(round(row), 0), height - 1))


def texel_point(column: int, row: int, texel_to_model) -> np.ndarray:
    t = np.asarray(texel_to_model, np.float64).reshape(4, 4)
    return (t @ np.array([column, row, 0.0, 1.0]))[:3]


def bulb_shares(path: str, bulbs: list[dict]) -> dict:
    """Each crisp bulb's share of its group's intensity: the bake's refit (relative intensities, every crisp bulb named,
    positive and finite) normalised to a mean of 1 per group, or 1 for every bulb before the refit exists."""
    if not os.path.exists(path):
        return {b["id"]: 1.0 for b in bulbs}
    with open(path, encoding="utf-8") as f:
        refit = json.load(f)
    if refit.get("schema") != SHARES_SCHEMA:
        raise ValueError(f"The bake's bulb intensities must be {SHARES_SCHEMA}")
    relative = refit["bulbs"]
    out = {}
    for group in sorted({b["group"] for b in bulbs}):
        ids = [b["id"] for b in bulbs if b["group"] == group]
        values = []
        for bulb_id in ids:
            value = relative.get(bulb_id)
            if not isinstance(value, (int, float)) or not np.isfinite(value) or value <= 0:
                raise ValueError(f"The bake's refit gives bulb {bulb_id} no positive intensity: {value!r}")
            values.append(float(value))
        mean = sum(values) / len(values)
        out.update({bulb_id: value / mean for bulb_id, value in zip(ids, values)})
    return out


def bulb_intensities(direct, texel_to_model, bulbs, chandeliers, shares) -> dict:
    """Each crisp bulb's intensity per unit of its group's source weight (a bulb lights a surface with
    weights[k] x I_b x cos / d^2): I_b = I_g x share. Under each covered chandelier of a group,
    D[group] = I_g x (sum over the group's crisp bulbs of share x max(z_b - z_p, 0) / d_b^3 + for each of the group's
    chandeliers without crisp lamps, n x max(z_c - z_p, 0) / d_c^3 at its centre, n the group's mean crisp bulbs per
    covered chandelier); I_g is the median over the covered chandeliers."""
    d = np.asarray(direct, np.float64)
    height, width = d.shape[:2]
    out = {}

    def geometry(points: np.ndarray, weights: np.ndarray, at: np.ndarray) -> float:
        rel = points - at
        distance = np.maximum(np.linalg.norm(rel, axis=1), 1e-6)
        return float(np.sum(weights * np.maximum(rel[:, 2], 0.0) / distance ** 3))

    for group, source in SOURCE_INDEX.items():
        members = [b for b in bulbs if b["group"] == group]
        if not members:
            continue
        positions = np.array([b["position"] for b in members], np.float64)
        weights = np.array([shares[b["id"]] for b in members], np.float64)
        covered = sorted({b["chandelier"] for b in members})
        in_group = [c for c in chandeliers if ("ch_centre" if c["id"] == 2 else "ch_end") == group]
        absent = np.array([c["centre"] for c in in_group if not c["crisp"]], np.float64).reshape(-1, 3)
        per_fixture = len(members) / len(covered)
        estimates = []
        for fixture in covered:
            own = np.array([b["position"] for b in members if b["chandelier"] == fixture], np.float64)
            column, row = texel_of(own.mean(0), texel_to_model, width, height)
            at = texel_point(column, row, texel_to_model)
            g = geometry(positions, weights, at) + geometry(absent, np.full(len(absent), per_fixture), at)
            if g > 0 and d[row, column, source] > 0:
                estimates.append(float(d[row, column, source]) / g)
        if estimates:
            scale = float(np.median(estimates))
            out.update({b["id"]: scale * shares[b["id"]] for b in members})
    return out


def projected_solid_angle(point, x0: float, x1: float, sill: float, top: float, y0: float, cells: int = 48) -> float:
    """The projected solid angle (cos at the window x cos at an upward-facing receiver x dA / d^2) of the window
    rectangle x0..x1, sill..top in the wall face y = y0, seen from a point in the room (y > y0), by the midpoint rule."""
    p = np.asarray(point, np.float64)
    xs = x0 + (np.arange(cells) + 0.5) * (x1 - x0) / cells
    zs = sill + (np.arange(cells) + 0.5) * (top - sill) / cells
    X, Z = np.meshgrid(xs, zs)
    v = np.stack([X - p[0], np.full_like(X, y0 - p[1]), Z - p[2]], -1)
    d = np.linalg.norm(v, axis=-1)
    cos_window = (p[1] - y0) / d
    cos_receiver = np.maximum(v[..., 2], 0.0) / d
    area = (x1 - x0) * (top - sill) / (cells * cells)
    return float(np.sum(cos_window * cos_receiver * area / d ** 2))


def window_radiance(direct, texel_to_model, windows: dict, y0: float) -> list[float]:
    """Each window's sky radiance per unit source weight (W1..W5 in order): its baked direct light on the floor
    WINDOW_PROBE_DISTANCE m into the room in front of its centre, over its projected solid angle there."""
    d = np.asarray(direct, np.float64)
    height, width = d.shape[:2]
    out = []
    for source, (x0, x1, _depth, sill, top, _kind) in enumerate(windows.values()):
        column, row = texel_of([(x0 + x1) / 2, y0 + WINDOW_PROBE_DISTANCE, 0.0], texel_to_model, width, height)
        omega = projected_solid_angle(texel_point(column, row, texel_to_model), x0, x1, sill, top, y0)
        out.append(float(d[row, column, source]) / omega if omega > 0 else 0.0)
    return out


def daylight_xy(cct: float) -> tuple[float, float]:
    """The CIE daylight locus (CIE 15:2004) at a correlated colour temperature, 4,000-25,000 K."""
    t = float(cct)
    if t <= 7000.0:
        x = -4.6070e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    else:
        x = -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.237040
    return x, -3.000 * x * x + 2.870 * x - 0.275


def xy_to_linear_srgb(x: float, y: float) -> np.ndarray:
    """Linear sRGB of a chromaticity, green 1."""
    rgb = np.linalg.solve(SRGB_TO_XYZ, np.array([x / y, 1.0, (1.0 - x - y) / y]))
    return rgb / rgb[1]


def mccamy_cct(rgb) -> float:
    """McCamy's correlated colour temperature (Color Res. Appl. 17(2):142-144, 1992) of a linear sRGB colour."""
    X, Y, Z = SRGB_TO_XYZ @ np.asarray(rgb, np.float64)
    s = X + Y + Z
    n = (X / s - 0.3320) / (0.1858 - Y / s)
    return float(449.0 * n ** 3 + 3525.0 * n ** 2 + 6823.3 * n + 5520.33)


def warm_down(ratio_path: str) -> dict:
    """Where the artistic warm-down starts: the colour temperature of the capture's measured lamp/daylight colour
    (R1a's lamp_daylight_ratio.json) times CIE daylight at D65, with D60-D75 as its range (the daylight the ratio was
    measured against is not known better). It shapes the dimming only: at full level the bake's colour is kept."""
    with open(ratio_path, encoding="utf-8") as f:
        ratio = np.asarray(json.load(f)["lamp_over_daylight_rgb"], np.float64)
    at = lambda cct: mccamy_cct(ratio * xy_to_linear_srgb(*daylight_xy(cct)))  # noqa: E731
    low, high = sorted(at(t) for t in DAYLIGHT_RANGE)
    return {"fullCct": round(at(D65_CCT), 1), "range": [round(low, 1), round(high, 1)],
            "provenance": "McCamy CCT of R1a's measured lamp/daylight colour against CIE daylight D65 (range D60-D75)"}


def lamp_groups() -> dict:
    """Every lamp group's dimming: the owner's artistic warm-down by default (spec §4.1); "led" on request."""
    return {group: {"dimming": DEFAULT_DIMMING} for group in LAMP_GROUPS}


def eye_anchors(path: str) -> dict | None:
    """Task 21's measured eye anchors, or None when it has not run: per anchor (day, lamps, moon) the calibrated
    exposure and white balance, the reference view's log2 log-average luminance measured as the browser measures it,
    and the log2 chroma (r/g, b/g) of the anchor's light colour."""
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        anchors = json.load(f)["anchors"]
    out = {}
    for name in EYE_ANCHORS:
        a = anchors[name]
        values = [a["exposure"], *a["whiteBalance"], a["logLuminance"], *a["logChroma"]]
        if len(a["whiteBalance"]) != 3 or len(a["logChroma"]) != 2 or not all(np.isfinite(values)) or a["exposure"] <= 0 or min(a["whiteBalance"]) <= 0:
            raise ValueError(f"The eye anchor {name} is malformed: {a}")
        out[name] = {"exposure": float(a["exposure"]), "whiteBalance": [float(v) for v in a["whiteBalance"]],
                     "logLuminance": float(a["logLuminance"]), "logChroma": [float(v) for v in a["logChroma"]]}
    return {"anchors": out}


def probe_placements(hall: dict) -> list[dict]:
    x0, x1, y0, y1 = (float(hall[k]) for k in ("x0", "x1", "y0", "y1"))
    floor, ceiling = float(hall["floorZ"]), float(hall["ceilingZ"])
    box = [[x0, y0, floor], [x1, y1, ceiling]]
    return [{"position": [round(x0 + (x1 - x0) * f, 4), round((y0 + y1) / 2, 4), round(floor + PROBE_HEIGHT, 4)], "box": box}
            for f in PROBE_FRACTIONS]


def bulb_entries(bulbs, intensities) -> list[dict]:
    """The manifest's crisp lamps: id, group, chandelier, position (e57 = the model frame) and intensity (6 figures)."""
    return [{"id": b["id"], "group": b["group"], "chandelier": int(b["chandelier"]), "position": [float(v) for v in b["position"]],
             "intensity": round(float(intensities[b["id"]]), 6)} for b in bulbs]


def night_gains(path: str) -> dict:
    """Task 21's per-group night gains (RGB, positive and finite), or ones when it has not run."""
    if not os.path.exists(path):
        return {"calibrated": False, "gains": {g: [1.0, 1.0, 1.0] for g in LAMP_GROUPS}, "evidence": None}
    with open(path, encoding="utf-8") as f:
        calibration = json.load(f)
    gains = {g: [float(v) for v in calibration["gains"][g]] for g in LAMP_GROUPS}
    for group, gain in gains.items():
        if len(gain) != 3 or not all(np.isfinite(gain)) or min(gain) <= 0:
            raise ValueError(f"The night gain of {group} must be three positive numbers: {gain}")
    return {"calibrated": True, "gains": gains, "evidence": calibration.get("evidence")}


def package_paths(cfg) -> tuple[str, str]:
    """(relight package v2's manifest, the cinematic package's folder): beside R1a's relight/v1 in the same room."""
    relight_root = os.path.dirname(os.path.normpath(cfg.paths["out"]))
    return os.path.join(relight_root, "v2", "manifest.json"), os.path.join(os.path.dirname(relight_root), "cinematic", "v1")


def write_package(out_dir: str, fields: dict, triangles: np.ndarray) -> dict:
    """occluders.bin.gz (float32 little-endian triangles, gzip without a timestamp) and manifest.json."""
    os.makedirs(out_dir, exist_ok=True)
    tris = np.ascontiguousarray(np.asarray(triangles, "<f4"))
    data = gzip.compress(tris.tobytes(), compresslevel=9, mtime=0)
    with open(os.path.join(out_dir, OCCLUDER_FILE), "wb") as f:
        f.write(data)
    flat = tris.reshape(-1, 3)
    bounds = ([flat.min(0).astype(float).round(4).tolist(), flat.max(0).astype(float).round(4).tolist()]
              if len(flat) else [[0.0] * 3, [0.0] * 3])
    manifest = {
        "schema": SCHEMA, "room": fields["room"], "createdAt": fields["createdAt"], "tool": fields["tool"],
        "model": {"frame": "e57", "tileToModel": fields["tileToModel"]},
        "relight": fields["relight"],
        "bulbs": {"envelope": ENVELOPE, "entries": fields["bulbs"]},
        "chandeliers": [{"id": int(c["id"]), "centre": [float(v) for v in c["centre"]], "crisp": bool(c["crisp"])} for c in fields["chandeliers"]],
        "lamps": {"windowRadiance": fields["windowRadiance"], "warmDown": fields["warmDown"], "groups": fields["groups"], "night": fields["night"]},
        "occluders": {"file": OCCLUDER_FILE, "triangles": int(len(tris)), "bounds": bounds},
        "reflections": {"probes": fields["probes"]},
        "eye": fields["eye"],
        "files": {OCCLUDER_FILE: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}},
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=1, sort_keys=True, allow_nan=False)
    return manifest
```

- [ ] **Step 4: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematic -v`
Expected: PASS, 16 tests.

- [ ] **Step 5: Register the command** — append to the end of `tools/relight/relight/__main__.py`:

```python
def cmd_cinematic(cfg, args) -> int:
    """The cinematic package (R1d Task 3) beside relight package v2: the crisp lamps and their intensities, the
    chandeliers, the lamps' dimming and warm-down, the occluders, the reflection probes and the night gains; exit 1 if
    there is no crisp lamp, a lamp has no positive intensity, or there are more than MAX_BULBS."""
    import hashlib
    import subprocess
    from . import cinematic as C
    work = cfg.paths["work"]
    relight_manifest, out_dir = C.package_paths(cfg)
    with open(relight_manifest, "rb") as f:
        relight_bytes = f.read()
    relight = json.loads(relight_bytes)
    with open(os.path.join(work, "bulbs.json"), encoding="utf-8") as f:
        placed = json.load(f)
    bulbs, chandeliers = placed["bulbs"], placed["chandeliers"]
    with np.load(os.path.join(work, "floor-light.npz")) as z:
        direct, texel_to_model = z["D"], z["texelToModel"].ravel().tolist()
    with np.load(os.path.join(work, "occluders.npz")) as z:
        triangles = z["triangles"]
    shares = C.bulb_shares(os.path.join(work, "bulb-intensities.json"), bulbs)
    intensity = C.bulb_intensities(direct, texel_to_model, bulbs, chandeliers, shares)
    repo = cfg.paths["repo"]
    commit = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    created = subprocess.run(["git", "-C", repo, "log", "-1", "--format=%cI"], capture_output=True, text=True, check=True).stdout.strip()
    fields = {
        "room": cfg.room["slug"], "createdAt": created, "tool": commit,
        "tileToModel": [float(v) for v in relight["model"]["tileToModel"]],
        "relight": {"package": "relight/v2", "manifestSha256": hashlib.sha256(relight_bytes).hexdigest()},
        "bulbs": C.bulb_entries([b for b in bulbs if b["id"] in intensity], intensity), "chandeliers": chandeliers,
        "windowRadiance": C.window_radiance(direct, texel_to_model, cfg.room["windows"], float(cfg.room["hallE57"]["y0"])),
        "warmDown": C.warm_down(os.path.join(work, "lamp_daylight_ratio.json")), "groups": C.lamp_groups(),
        "probes": C.probe_placements(cfg.room["hallE57"]),
        "night": C.night_gains(os.path.join(work, "night-calibration.json")),
        "eye": C.eye_anchors(os.path.join(work, "eye-anchors.json")),
    }
    manifest = C.write_package(out_dir, fields, triangles)
    groups = {g: sum(1 for b in bulbs if b["group"] == g) for g in C.SOURCE_INDEX}
    entries = manifest["bulbs"]["entries"]
    ok = bool(entries) and len(entries) == len(bulbs) and all(e["intensity"] > 0 for e in entries) and len(entries) <= C.MAX_BULBS
    print("cinematic", out_dir, "bulbs", json.dumps(groups), "refit shares", os.path.exists(os.path.join(work, "bulb-intensities.json")),
          "intensity range", [min((e["intensity"] for e in entries), default=0.0), max((e["intensity"] for e in entries), default=0.0)],
          "warm-down", manifest["lamps"]["warmDown"]["fullCct"],
          "triangles", manifest["occluders"]["triangles"], "night calibrated", manifest["lamps"]["night"]["calibrated"], flush=True)
    return 0 if ok else 1


COMMANDS["cinematic"] = cmd_cinematic
```

- [ ] **Step 6: Write the contract** — create `docs/engineering/cinematic-package.md`:

```markdown
# The cinematic package (venviewer.cinematic.v1)

Built offline by `tools/relight` (`python -m relight cinematic`, plan R1d Task 3) beside the relight package it was
made with, and read by the browser (R1d Task 8). Immutable once published: `splats/<venue>/<room>/cinematic/v<N>/`.
Spec: `docs/superpowers/specs/2026-10-03-r1-polished-design.md` §4.

## Files

| Path | Content |
|---|---|
| `manifest.json` | Everything below, plus a SHA-256 and size for every other file |
| `occluders.bin.gz` | gzip (no timestamp) of float32 little-endian triangles `[triangle][vertex 0..2][x, y, z]` in the model frame |

## Manifest

- `schema`: `"venviewer.cinematic.v1"`; `room`; `createdAt` (the building commit's time); `tool` (that commit).
- `model`: `{ frame: "e57", tileToModel: 4×4 row-major }`, equal to the relight package's (the browser refuses a
  package whose matrix differs by more than 1e-9).
- `relight`: `{ package: "relight/v2", manifestSha256 }`: the relight manifest it was built against (recorded; the
  browser checks the model frame, not this hash, so a later relight package of the same frame still works).
- `bulbs`: `{ envelope: { kind: "candle", radius, height }, entries: [{ id, group: "ch_end" | "ch_centre",
  chandelier, position: [x, y, z], intensity }] }`: the crisp lamps at the chandelier bulbs that the frontier splats
  study triangulated from the photographs (ids are its table's, `c<chandelier>_b<nn>`). `envelope` is the frosted
  candle lamp drawn at each (a design value: 35 mm across, 70 mm tall). `intensity` is the bulb's intensity per unit
  of its group's source weight (a bulb lights a surface with `weights[k] × intensity × cosθ / d²`), solved from the
  baked floor light under each chandelier and divided between bulbs by the bake's per-bulb refit when it exists. At
  most 512 entries. The dome has none: its bright "emitters" are crests lit by LED pin spots.
- `chandeliers`: five `{ id, centre: [x, y, z], crisp }`. While the crisp lamps draw, the browser hides every glow
  splat (record class 3, the chandelier emitter class) whose nearest chandelier centre is `crisp`; a chandelier the
  table does not yet cover keeps its glow, unboosted.
- `lamps`: `{ windowRadiance, warmDown: { fullCct, range: [low, high], provenance }, groups: { cove, ch_end,
  ch_centre, dome: { dimming: "warm" | "led" } }, night: { calibrated, gains: { cove, ch_end, ch_centre, dome:
  [r, g, b] }, evidence } }`. `windowRadiance` (five numbers, W1..W5) is each window's sky radiance per unit source
  weight as the room sees it through the opening (the window's light is `weights[k] × windowRadiance[k]`), solved
  from the baked floor light 2 m in front of it. `dimming` is how a group fades: `warm`, the default, is an
  artistic choice (Blake, 7 October; the hall's lamps are LED and do not warm when dimmed): light d^3.4 and colour
  temperature d^0.42 of `warmDown.fullCct`; `led` is the lamps' own, constant colour on the DALI logarithmic curve.
  At full level every group's light is exactly the relight package's. `warmDown.fullCct` is the colour temperature
  of the capture's measured lamp/daylight colour against CIE daylight D65 (McCamy), `range` the same for D60–D75.
  `gains` multiply each lamp group's weight at night (1 until the night calibration has run).
- `eye`: `null`, or `{ anchors: { day, lamps, moon: { exposure, whiteBalance: [r, g, b], logLuminance, logChroma:
  [r/g, b/g] } } }`: each calibrated anchor's display, the reference view's log2 log-average luminance (before
  exposure) measured in the browser at that anchor as the eye measures every frame, and the log2 chroma of the
  anchor's light colour (R1d Task 21). The eye adapts to the rendered frame against these anchors; without them it
  falls back to the baked floor light.
- `occluders`: `{ file, triangles, bounds: [[min], [max]] }`: the chandeliers and the window wall's pilasters as 4 cm
  voxel shells (R1d Task 2), the casters of the sun's interior shadow map.
- `reflections`: `{ probes: [{ position: [x, y, z], box: [[min], [max]] }] }`: the reflection probes and the box each
  one is projected onto.
- `files`: `{ <path>: { sha256, bytes } }` for every file but the manifest.

A missing or invalid package switches off what it carries (the crisp lamps and the glow hiding, interior shadows,
the lamps' sheen, the reflection probes, the warm-down, the night gains) with one console warning; the hall stays
relit, the glow splats draw as captured and unboosted, and the lamps fade at constant colour (spec §7).
```

- [ ] **Step 7: Build it twice and compare** (CPU only, seconds; two separate processes)

```bash
cd D:/claude/real-hall/repo/tools/relight && P=D:/claude/splats/trades-hall/grand-hall/cinematic/v1 V=D:/claude/relight/grand-hall/verify/r1d \
 && C:/Python313/python.exe -m relight cinematic --config config/grand-hall.json && rm -rf $V/cinematic-run1 && cp -r $P $V/cinematic-run1 \
 && C:/Python313/python.exe -m relight cinematic --config config/grand-hall.json && rm -rf $V/cinematic-run2 && cp -r $P $V/cinematic-run2 \
 && diff -r $V/cinematic-run1 $V/cinematic-run2 && echo identical
```
Expected: each run prints the crisp lamps per group, whether the bake's refit shares were used, the intensity range (all positive; with the first bulb table and equal shares, on 7 October's floor light: 0.0348 per `ch_end` bulb and 0.0203 per `ch_centre` bulb), the warm-down's 3,700.1 K and the triangle count; then `identical`. No crisp lamp, or a lamp without positive intensity, exits 1: stop and report.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/cinematic.py tools/relight/tests/test_cinematic.py tools/relight/relight/__main__.py docs/engineering/cinematic-package.md && git diff --cached --stat && git commit -m "feat(relight): the cinematic package: crisp lamps, their intensities, the lamps' dimming, occluders, probes and night gains (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lamp dimming: the artistic warm-down and the LED-true curve

**Files:**
- Create: `packages/web/src/lib/relight/lamp-dimming.ts`
- Test: `packages/web/src/lib/relight/__tests__/lamp-dimming.test.ts`

**Interfaces:**
- Consumes: `LUMINANCE`, `Rgb` from `./relight-kernel.js` (R1b Task 4).
- Produces: `type LampDimming = "warm" | "led"`, `LAMP_DIMMINGS`; `WARM_LIGHT_EXPONENT = 3.4`, `WARM_CCT_EXPONENT = 0.42`, `LED_DECADES = 3`, `PLANCK_MIN_CCT = 1667`, `PLANCK_MAX_CCT = 25000`; `planckRgb(cct: number): Rgb` (linear sRGB, G = 1, negatives clamped to 0); `dimmedOutput(drive: number, dimming: LampDimming): number`; `warmCct(drive: number, fullCct: number): number`; `dimmedTint(drive: number, dimming: LampDimming, fullCct: number | null): Rgb` (exactly `[1, 1, 1]` at full drive, for `led`, and without a warm-down temperature; otherwise keeps the colour's luminance). No lamp temperature is a constant here: the warm-down's starting temperature is the cinematic package's (`lamps.warmDown.fullCct`, Task 3).

Decision 11 and spec §4.1 (amended 7 October, commit 475acd2e): lamps fade, never switch, and dim warm. A group's drive d (0 off, 1 full) comes from Task 5's spring. The hall's lamps are LED and keep their colour as they dim, so the warm-down is Blake's artistic choice and is labelled so in the code: it borrows a gas-filled tungsten lamp's look, d^3.4 of the light at d^0.42 of the colour temperature (the usual voltage laws for tungsten filament lamps; the light study's T = T₀ (Φ/Φ₀)^0.1235), so a fading group passes through amber like a candle. The LED-true curve keeps the colour and follows the DALI logarithmic dimming curve (IEC 62386-102: arc power levels 1–254 span 0.1% to 100% of the light evenly in log, X(n) = 10^((n − 1)/(253/3) − 1) %; with n = 1 + 253d this is 10^(3(d − 1)) of full light), the curve the hall's programmable dimming system would use if it is DALI (not known; a design value). Both give exactly the full light at d = 1 and none at d = 0, so every preset's lamps (all on or all off) are unchanged. The colour is the Planckian locus in CIE 1931 xy by Kang et al.'s cubic fit (*J. Korean Phys. Soc.* 41(6):865–871, 2002; valid 1,667–25,000 K), taken to linear sRGB exactly as R1b's `daylightRgb` takes the daylight locus (the same matrix, green 1). The tint is relative: the faded colour over the full colour, scaled so the colour's luminance is unchanged (brightness is `dimmedOutput` alone), so at full level every group keeps the bake's colour exactly whatever the starting temperature; the temperature only shapes how the colour warms. Below about 1,700 K the locus leaves the sRGB gamut and blue clamps to 0.

Reference values, computed with this task's code on 7 October (`node`, scratch script; 2,750 K is a test temperature, not the hall's): `planckRgb(2700) = [2.396114495, 1, 0.2396443072]`, `planckRgb(4000) = [1.531348647, 1, 0.5772511803]`, `planckRgb(2222) = [3.228367736, 1, 0.1001678783]` against `planckRgb(2221.999) = [3.228370194, 1, 0.1001675718]` (the fit's segments meet within 3e-6), `dimmedOutput(0.5, "warm") = 0.0947322854069`, `warmCct(0.5, 2750) = 2055.41771687`, `dimmedTint(0.5, "warm", 2750) = [1.295036608, 0.8166422786, 0.1561357948]` (the tinted colour's luminance 1.230377778, equal to the full colour's), `dimmedOutput(2/3, "led") = 0.1` and `dimmedOutput(1/3, "led") = 0.01` (to 12 places).

Verified (7 October): spec `docs/superpowers/specs/2026-10-03-r1-polished-design.md` §4.1 as amended by commit 475acd2e ("Lamps fade, never switch, with a warm-down as they dim… the warm dim is Blake's deliberate artistic choice… At full level each lamp group keeps its measured colour"); `D:/claude/real-hall/frontier/light/proposal.md` §b9 (the lamps are LED: the contractor's record, the frosted envelopes, the market) and §c4 (T = T₀ (Φ/Φ₀)^0.1235 for the incandescent law); R1b plan Task 4 lines 1639–1641 (`Rgb`, `LUMINANCE`, `LAMP_GROUPS` in `relight-kernel.ts`); R1b plan Task 8 lines 4017–4030 (`daylightRgb`: the XYZ → linear sRGB rows and the G = 1 normalisation this task repeats).

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/lamp-dimming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LAMP_DIMMINGS, PLANCK_MAX_CCT, PLANCK_MIN_CCT, dimmedOutput, dimmedTint, planckRgb, warmCct,
} from "../lamp-dimming.js";

/** A test temperature only: the hall's warm-down starts at the cinematic package's `lamps.warmDown.fullCct`. */
const FULL = 2750;
const luminance = (rgb: readonly number[]): number => 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
const close = (actual: readonly number[], expected: readonly number[], digits: number): void => {
  expected.forEach((value, c) => { expect(actual[c]).toBeCloseTo(value, digits); });
};

describe("lamp dimming (T-639 R1d)", () => {
  it("follows Kang's Planckian locus in linear sRGB with green 1", () => {
    close(planckRgb(2700), [2.396114495, 1, 0.2396443072], 8);
    close(planckRgb(4000), [1.531348647, 1, 0.5772511803], 8);
  });

  it("joins the fit's segments without a step at 2,222 K", () => {
    const below = planckRgb(2221.999), at = planckRgb(2222);
    at.forEach((value, c) => { expect(Math.abs(value - (below[c] ?? 0))).toBeLessThan(1e-5); });
  });

  it("clamps the temperature to the fit's range and blue to 0 below the gamut", () => {
    expect(planckRgb(1000)).toEqual(planckRgb(PLANCK_MIN_CCT));
    expect(planckRgb(40000)).toEqual(planckRgb(PLANCK_MAX_CCT));
    expect(planckRgb(PLANCK_MIN_CCT)[2]).toBe(0);
  });

  it("gives the warm-down d^3.4 of the light at d^0.42 of the temperature", () => {
    expect(LAMP_DIMMINGS).toEqual(["warm", "led"]);
    expect(dimmedOutput(0.5, "warm")).toBeCloseTo(0.0947322854069, 12);
    expect(warmCct(0.5, FULL)).toBeCloseTo(2055.41771687, 7);
    expect([warmCct(1, FULL), warmCct(0, FULL)]).toEqual([FULL, PLANCK_MIN_CCT]);
  });

  it("gives an LED group the DALI curve: 0.1% at the lowest level, a decade per third of the drive", () => {
    expect(dimmedOutput(2 / 3, "led")).toBeCloseTo(0.1, 12);
    expect(dimmedOutput(1 / 3, "led")).toBeCloseTo(0.01, 12);
    expect(dimmedOutput(1e-9, "led")).toBeCloseTo(0.001, 9);
    expect(dimmedOutput(0.3, "led")).toBeLessThan(dimmedOutput(0.31, "led"));
  });

  it("is exactly off at 0 and exactly the bake's light at full, whatever the curve", () => {
    for (const dimming of LAMP_DIMMINGS) {
      expect([dimmedOutput(0, dimming), dimmedOutput(1, dimming), dimmedOutput(2, dimming), dimmedOutput(-1, dimming), dimmedOutput(Number.NaN, dimming)])
        .toEqual([0, 1, 1, 0, 0]);
      expect(dimmedTint(1, dimming, FULL)).toEqual([1, 1, 1]);
    }
  });

  it("keeps an LED group's colour, and the colour without a warm-down temperature", () => {
    expect(dimmedTint(0.3, "led", FULL)).toEqual([1, 1, 1]);
    expect(dimmedTint(0.3, "warm", null)).toEqual([1, 1, 1]);
  });

  it("warms a fading group, keeping the colour's luminance (the artistic warm-down)", () => {
    const tint = dimmedTint(0.5, "warm", FULL);
    close(tint, [1.295036608, 0.8166422786, 0.1561357948], 8);
    const full = planckRgb(FULL);
    expect(luminance([tint[0] * full[0], tint[1] * full[1], tint[2] * full[2]])).toBeCloseTo(luminance(full), 12);
    const redness = [1, 0.8, 0.6, 0.4, 0.2].map((drive) => { const t = dimmedTint(drive, "warm", 3700); return t[0] / t[1]; });
    redness.slice(1).forEach((value, i) => { expect(value).toBeGreaterThan(redness[i] ?? Number.POSITIVE_INFINITY); });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/lamp-dimming.test.ts`
Expected: FAIL — cannot find module `../lamp-dimming.js`.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/relight/lamp-dimming.ts`:

```ts
import { LUMINANCE, type Rgb } from "./relight-kernel.js";

/**
 * How a lamp group fades (T-639 R1d, decision 11; spec §4.1 as amended 7 October).
 *
 * ARTISTIC CHOICE: the Grand Hall's lamps are LED (the frieze tape and the dome's pin spots by the contractor's
 * record, the chandeliers' frosted candle lamps almost certainly), and LEDs keep their colour as they dim. Blake chose
 * a warm-down anyway. "warm", the default, borrows a gas-filled tungsten lamp's look: d^3.4 of the light at d^0.42 of
 * the colour temperature for a drive d (the usual voltage laws for tungsten filament lamps), so a fading group passes
 * through amber like a candle. "led" is the lamps' own behaviour: constant colour on the DALI logarithmic dimming
 * curve (IEC 62386-102: 0.1% to 100% of the light, evenly spaced in log). At full drive both give exactly the bake's
 * light and colour. The colour is the Planckian locus by Kang et al.'s cubic fit (J. Korean Phys. Soc.
 * 41(6):865–871, 2002; 1,667–25,000 K) taken to linear sRGB as daylight.ts takes the daylight locus (green 1).
 */
export type LampDimming = "warm" | "led";
export const LAMP_DIMMINGS = ["warm", "led"] as const satisfies readonly LampDimming[];
export const WARM_LIGHT_EXPONENT = 3.4;
export const WARM_CCT_EXPONENT = 0.42;
/** The DALI curve spans three decades: 0.1% of full light at the lowest level. */
export const LED_DECADES = 3;
export const PLANCK_MIN_CCT = 1667;
export const PLANCK_MAX_CCT = 25000;

const clampDrive = (drive: number): number => Math.min(Math.max(Number.isFinite(drive) ? drive : 0, 0), 1);
const luminanceOf = (rgb: Rgb): number => rgb[0] * LUMINANCE[0] + rgb[1] * LUMINANCE[1] + rgb[2] * LUMINANCE[2];

function planckXy(cct: number): readonly [number, number] {
  const t = Math.min(Math.max(cct, PLANCK_MIN_CCT), PLANCK_MAX_CCT);
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.179910
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.240390;
  const y = t <= 2222
    ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** Linear sRGB (G = 1) of a black body at a colour temperature; channels below the gamut clamp to 0. */
export function planckRgb(cct: number): Rgb {
  const [x, y] = planckXy(cct);
  const X = x / y, Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.2040 + 1.0570 * Z;
  return [Math.max(r / g, 0), 1, Math.max(b / g, 0)];
}

/** The light a group gives at a drive (0 off, 1 full), relative to full: the warm-down's d^3.4 or the DALI curve. */
export function dimmedOutput(drive: number, dimming: LampDimming): number {
  const d = clampDrive(drive);
  if (dimming === "warm") return d ** WARM_LIGHT_EXPONENT;
  return d <= 0 ? 0 : 10 ** (LED_DECADES * (d - 1));
}

/** The warm-down's colour temperature at a drive (ARTISTIC: the tungsten law applied to LED lamps). */
export function warmCct(drive: number, fullCct: number): number {
  return Math.max(fullCct * clampDrive(drive) ** WARM_CCT_EXPONENT, PLANCK_MIN_CCT);
}

/**
 * A faded group's colour relative to its full-level colour, keeping that colour's luminance. Exactly [1, 1, 1] at full
 * drive, for an LED group, and without a warm-down temperature (no cinematic package).
 */
export function dimmedTint(drive: number, dimming: LampDimming, fullCct: number | null): Rgb {
  if (dimming === "led" || fullCct === null || clampDrive(drive) >= 1) return [1, 1, 1];
  const full = planckRgb(fullCct), now = planckRgb(warmCct(drive, fullCct));
  const scale = luminanceOf(full) / Math.max(luminanceOf(now), 1e-12);
  return [
    (now[0] / Math.max(full[0], 1e-6)) * scale,
    (now[1] / Math.max(full[1], 1e-6)) * scale,
    (now[2] / Math.max(full[2], 1e-6)) * scale,
  ];
}
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/lamp-dimming.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/lamp-dimming.ts packages/web/src/lib/relight/__tests__/lamp-dimming.test.ts && git diff --cached --stat && git commit -m "feat(relight): lamp dimming: the artistic warm-down by default and the LED-true DALI curve (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Light motion and the eye: the time-lapse, lamp fades, blend and the eye's anchored targets

**Files:**
- Create: `packages/web/src/lib/relight/light-motion.ts`, `packages/web/src/lib/relight/eye.ts`
- Test: `packages/web/src/lib/relight/__tests__/light-motion.test.ts`, `packages/web/src/lib/relight/__tests__/eye.test.ts`

**Interfaces:**
- Consumes: `stepSpring`, `isSpringSettled`, `SpringConfig`, `SpringState` from `../springs.js`; `LAMP_GROUPS`, `LampGroup`, `Rgb` from `./relight-kernel.js`.
- Produces (`light-motion.ts`): `MINUTES_PER_DAY = 1440`; `MAX_CROSS_DAY_SWEEP = 180`; `criticallyDamped(omega: number): SpringConfig`; `TIME_SPRING`, `LAMP_SPRING`, `BLEND_SPRING`, `EYE_BRIGHTER`, `EYE_DARKER`; `SETTLED` (`{ minutes: 0.01, lamp: 1e-3, blend: 1e-3, eye: 1e-3 }`); `type LampDrives = Readonly<Record<LampGroup, number>>`; `interface EyeTarget { readonly exposure: number; readonly whiteBalance: Rgb; readonly scotopic: number }`; `interface MotionInstant { readonly day: number; readonly minutes: number }`; `interface MotionTargets { readonly instant: MotionInstant; readonly lamps: LampDrives; readonly eye: EyeTarget }`; `interface MotionFrame { readonly instant: MotionInstant; readonly blend: { readonly from: MotionInstant; readonly amount: number } | null; readonly lamps: LampDrives; readonly eye: EyeTarget; readonly moving: boolean; readonly lightMoving: boolean }`; `class LightMotion` with `constructor(targets: MotionTargets)`, `step(dtSeconds: number, targets: MotionTargets, sweep: boolean): MotionFrame`, `snap(targets: MotionTargets): MotionFrame`, `crossFade(): void` (a cross-fade at the same instant: a change of weather or of the captured light), `retime(instant: MotionInstant): void` (the displayed instant set without motion: live time's own progress), `current(): MotionFrame`.
- Produces (`eye.ts`): `EYE_ANCHOR_NAMES = ["day", "lamps", "moon"]`, `type EyeAnchorName`; `interface EyeAnchor { readonly exposure: number; readonly whiteBalance: Rgb; readonly logLuminance: number; readonly logChroma: readonly [number, number] }`; `type EyeAnchors`; `type LightShares = Readonly<Record<EyeAnchorName, number>>`; `interface FrameMeasurement { readonly logLuminance: number; readonly at: number }`; `LUMINANCE_ADAPTATION = 0.5`, `CHROMA_ADAPTATION = 0.6`, `EYE_RANGE_STOPS = 3`, `PHOTOPIC_LUMINANCE = 5`, `SCOTOPIC_LUMINANCE = 0.005`, `SCOTOPIC_MAX = 0.6`, `IDENTITY_EYE`; `interface LuminanceCalibration { readonly cdPerUnit: number; readonly uncertaintyStops: number; readonly provenance: string }`, `CAPTURE_CALIBRATION` (54 cd/m² per unit, ±1 stop); `normaliseShares(shares: LightShares): LightShares`; `lightChroma(colour: Rgb): readonly [number, number]`; `adaptationLuminance(logLuminance: number, calibration: LuminanceCalibration): number`; `scotopicAmount(luminance: number): number`; `anchoredEye(anchors: EyeAnchors, shares: LightShares, chroma: readonly [number, number], measured: FrameMeasurement | null, calibration: LuminanceCalibration): EyeTarget`.

Everything that moves in R1d's light moves through the one spring core, critically damped (stiffness ω², damping 2ω: the fastest approach without overshoot, so the sun never swings back and a lamp never flashes past its level). Measured with `stepSpring` at 60 fps (7 October, scratch script): ω = 3 reaches 95% in 1.60 s (the time-lapse: a 540-minute sweep moves at most 10 minutes per frame and settles in 5.0 s to 0.01 minute); ω = 4 in 1.20 s and ω = 2.5 in 1.92 s (the eye toward a brighter and a darker scene: "over one to two seconds", spec §4.2); ω = 5 in 0.97 s (the blend); the lamps (ω = 3) are a quarter of the way up after 0.3 s. A spring that settles snaps to its target, so at rest the displayed light is exactly the chosen one (the captured light's display is exactly 1).

The displayed instant is a London day number and fractional minutes. A change of hour within the day sweeps the minutes spring (the time-lapse). Crossing midnight (live time, or "Now" a little after midnight) is the same sweep: the target is expressed against the displayed day (one day is 1,440 minutes) and the displayed day and minutes are re-based whenever the minutes leave 0..1440, so the sun moves on without a jump. Any other change of date, and any change of time under reduced motion, is a cross-fade instead: the instant jumps and a blend spring fades the old light out and the new one in (the director mixes the two lights, Task 9); a target that changes during a blend waits for it to finish, so the light never pops. A change of the light's kind at the same instant (another weather, or the captured light) is the same cross-fade (`crossFade`). Live time's own progress (a minute per minute) is not motion: the director sets it with `retime` and reapplies the light only when the Sun or the Moon has moved 0.02°, so a still, live hall runs no pass for seconds at a time. The eye's springs work in log2 (exposure, white balance's red and blue over green) and take the brighter or darker rate by the exposure's direction. `lightMoving` is true while anything but the eye moves: the director reapplies the light only then, and only moves the display while the eye alone adapts.

The eye's target (decision 4): each anchor (the sunny day, the lamp-lit night, the moonlit night; Task 21 measures them) carries its calibrated display, the log-average luminance of the reference view measured at it on the GPU (as Task 13 measures every frame) and its light's colour. The target mixes the anchors in log space by each one's share of the light; each anchor is corrected by half the difference between its luminance and the frame's (an eye never adapts fully; R1b's `adaptDisplay` uses the same half) and by 60% of the difference between its light's colour and the current light's (again R1b's rule), within eightfold of the anchors. Colour adaptation reads the light's colour, not the frame's, so the display's own scotopic tint (Task 16) can never feed back into the white balance. Before the first measurement the anchors' own luminance stands in; afterwards the latest measurement holds until the next (Task 9). The scotopic amount comes from the adaptation luminance in cd/m², through the capture's absolute calibration: the frontier light study derives k_abs ≈ 54 cd/m² per unit of the fit's light × albedo (a frame value) from the capture day's weather (Open-Meteo reanalysis for 31 May 2026, 09:00–10:00 UTC: DHI 161 W/m² with the fit's own band weights; about ±1 stop; `D:/claude/real-hall/frontier/light/proposal.md` §b4), so L = 54 × 2^λ cd/m². On that scale the captured hall's median is about 9 cd/m² and the lamp-lit night's about 7 cd/m², just above the mesopic range (CIE 191:2010: below about 5 cd/m²). The shift is therefore driven by absolute luminance and never by the preset: none at 5 cd/m² or above (so the approved night is neither greyed nor blue-shifted), rising log-linearly to 0.6 at 0.005 cd/m²; it reaches dimmed lamps, the blue hour without lamps and moonlight (the full Moon's floor is about 0.01 cd/m², §b3). When the spectral package's calibration exists (an upgrade, §c9 `calibration.kAbsCdPerUnit`) it replaces `CAPTURE_CALIBRATION` through the same interface. The 1–2 s adaptation is a deliberate compression for a clock that sweeps hours in seconds (dark adaptation takes minutes, §b5): the product calls it adaptation, time-compressed, never physiological timing.

Verified (7 October): `D:/claude/real-hall/frontier/light/proposal.md` §b4 (k_abs ≈ 54 cd/m² per fit unit; the captured hall 0.1704 × 54 ≈ 9 and the night 0.1281 × 54 ≈ 7 cd/m²), §b5, §c9; `packages/web/src/lib/springs.ts:12-22` (`SpringConfig { stiffness, damping }`, `SpringState { value, velocity }`), `:48-64` (`stepSpring(state, target, dtSeconds, config)`: semi-implicit Euler in 1/240 s substeps, `dtSeconds` clamped to 0.25 s at `:55`), `:67-75` (`isSpringSettled(state, target, epsilon = 0.001)`); R1b plan line 1641–1642 (`LAMP_GROUPS`, `LampGroup`); R1b plan lines 4244–4256 (`adaptDisplay`: exposure × √(reference/current) within eightfold, white balance × (ratio)^0.6, green 1). 

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/light-motion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BLEND_SPRING, LightMotion, MINUTES_PER_DAY, TIME_SPRING, criticallyDamped,
  type EyeTarget, type LampDrives, type MotionTargets,
} from "../light-motion.js";
import { stepSpring } from "../../springs.js";

const FRAME = 1 / 60;
const lamps = (drive: number): LampDrives => ({ cove: drive, ch_end: drive, ch_centre: drive, dome: drive });
const eye = (exposure: number): EyeTarget => ({ exposure, whiteBalance: [1, 1, 1], scotopic: 0 });
const targets = (day: number, minutes: number, drive = 0, exposure = 1): MotionTargets => ({ instant: { day, minutes }, lamps: lamps(drive), eye: eye(exposure) });
const run = (motion: LightMotion, seconds: number, next: MotionTargets, sweep = true) => {
  let frame = motion.current();
  for (let t = 0; t < seconds - 1e-9; t += FRAME) frame = motion.step(FRAME, next, sweep);
  return frame;
};

describe("light motion (T-639 R1d)", () => {
  it("damps critically and never overshoots", () => {
    expect(criticallyDamped(3)).toEqual({ stiffness: 9, damping: 6 });
    const state = { value: 0, velocity: 0 };
    let peak = 0;
    for (let t = 0; t < 6; t += FRAME) { stepSpring(state, 100, FRAME, TIME_SPRING); peak = Math.max(peak, state.value); }
    expect(peak).toBeLessThanOrEqual(100 + 1e-9);
    expect(BLEND_SPRING.damping).toBe(10);
  });

  it("sweeps the hour as a time-lapse and lands exactly", () => {
    const motion = new LightMotion(targets(20733, 540));
    const next = targets(20733, 1080);
    let previous = 540;
    for (let t = 0; t < 0.5; t += FRAME) {
      const frame = motion.step(FRAME, next, true);
      expect(frame.instant.minutes).toBeGreaterThan(previous);
      expect(frame.instant.minutes - previous).toBeLessThan(12);
      expect(frame.blend).toBeNull();
      previous = frame.instant.minutes;
    }
    expect(previous).toBeLessThan(1080);
    const rest = run(motion, 6, next);
    expect(rest.instant).toEqual({ day: 20733, minutes: 1080 });
    expect(rest.moving).toBe(false);
  });

  it("crosses midnight without a jump", () => {
    const motion = new LightMotion(targets(20733, 1439.5));
    let previous = { day: 20733, minutes: 1439.5 };
    for (let t = 0; t < 3; t += FRAME) {
      const frame = motion.step(FRAME, targets(20734, 0.2), true);
      const elapsed = (frame.instant.day - previous.day) * MINUTES_PER_DAY + frame.instant.minutes - previous.minutes;
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(1);
      expect(frame.instant.minutes).toBeGreaterThanOrEqual(0);
      expect(frame.instant.minutes).toBeLessThan(MINUTES_PER_DAY);
      previous = frame.instant;
    }
    expect(previous.day).toBe(20734);
    expect(run(motion, 6, targets(20734, 0.2)).instant).toEqual({ day: 20734, minutes: 0.2 });
  });

  it("cross-fades a change of date instead of sweeping through the nights", () => {
    const motion = new LightMotion(targets(20733, 540));
    const first = motion.step(FRAME, targets(20763, 540), true);
    expect(first.instant).toEqual({ day: 20763, minutes: 540 });
    expect(first.blend?.from).toEqual({ day: 20733, minutes: 540 });
    let amount = first.blend?.amount ?? 1;
    for (let t = 0; t < 0.5; t += FRAME) {
      const frame = motion.step(FRAME, targets(20763, 540), true);
      expect(frame.blend?.amount ?? 1).toBeGreaterThanOrEqual(amount);
      amount = frame.blend?.amount ?? 1;
    }
    const rest = run(motion, 4, targets(20763, 540));
    expect([rest.blend, rest.moving]).toEqual([null, false]);
  });

  it("cross-fades a change of hour under reduced motion", () => {
    const motion = new LightMotion(targets(20733, 540));
    const frame = motion.step(FRAME, targets(20733, 1080), false);
    expect(frame.instant).toEqual({ day: 20733, minutes: 1080 });
    expect(frame.blend?.from).toEqual({ day: 20733, minutes: 540 });
  });

  it("lets a blend finish before following a newer target", () => {
    const motion = new LightMotion(targets(20733, 540));
    motion.step(FRAME, targets(20733, 700), false);
    const mid = run(motion, 0.2, targets(20733, 900), false);
    expect(mid.instant.minutes).toBe(700);
    expect(mid.blend?.from.minutes).toBe(540);
    const rest = run(motion, 8, targets(20733, 900), false);
    expect([rest.instant.minutes, rest.blend]).toEqual([900, null]);
  });

  it("fades the lamps up through the spring, within 0..1, and lands exactly", () => {
    const motion = new LightMotion(targets(20733, 1200, 0));
    let previous = 0;
    for (let t = 0; t < 0.6; t += FRAME) {
      const frame = motion.step(FRAME, targets(20733, 1200, 1), true);
      expect(frame.lamps.dome).toBeGreaterThanOrEqual(previous);
      expect(frame.lamps.dome).toBeLessThanOrEqual(1);
      previous = frame.lamps.dome;
    }
    expect(previous).toBeGreaterThan(0.2);
    expect(previous).toBeLessThan(1);
    expect(run(motion, 5, targets(20733, 1200, 1)).lamps).toEqual(lamps(1));
  });

  it("adapts to a brighter scene faster than to a darker one", () => {
    const toBrighter = new LightMotion(targets(20733, 720, 0, 1));
    const toDarker = new LightMotion(targets(20733, 720, 0, 1));
    const brighter = run(toBrighter, 1, targets(20733, 720, 0, 0.25)).eye.exposure;
    const darker = run(toDarker, 1, targets(20733, 720, 0, 4)).eye.exposure;
    const progress = (value: number, goal: number): number => Math.log2(value) / Math.log2(goal);
    expect(progress(brighter, 0.25)).toBeGreaterThan(progress(darker, 4));
    expect(progress(brighter, 0.25)).toBeGreaterThan(0.85);
  });

  it("rests at exactly the identity display", () => {
    const motion = new LightMotion({ ...targets(20733, 720, 0, 2), eye: { exposure: 2, whiteBalance: [1.2, 1, 0.8], scotopic: 0.4 } });
    const rest = run(motion, 8, targets(20733, 720, 0, 1));
    expect(rest.eye).toEqual({ exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 });
    expect(rest.moving).toBe(false);
  });

  it("snaps to new targets without motion", () => {
    const motion = new LightMotion(targets(20733, 540));
    const frame = motion.snap(targets(20800, 60, 1, 3));
    expect([frame.instant, frame.blend, frame.lamps.cove, frame.eye.exposure, frame.moving]).toEqual([{ day: 20800, minutes: 60 }, null, 1, 3, false]);
  });

  it("cross-fades a change of weather at the same instant, and retimes live time without motion", () => {
    const motion = new LightMotion(targets(20733, 540));
    motion.crossFade();
    const frame = motion.step(FRAME, targets(20733, 540), true);
    expect(frame.blend?.from).toEqual({ day: 20733, minutes: 540 });
    expect([frame.instant.minutes, frame.lightMoving]).toEqual([540, true]);
    run(motion, 4, targets(20733, 540));
    motion.retime({ day: 20733, minutes: 540.4 });
    const still = motion.step(FRAME, targets(20733, 540.4), true);
    expect([still.instant.minutes, still.blend, still.moving, still.lightMoving]).toEqual([540.4, null, false, false]);
  });

  it("tells the eye's motion apart from the light's", () => {
    const motion = new LightMotion(targets(20733, 540, 0, 1));
    const frame = motion.step(FRAME, targets(20733, 540, 0, 4), true);
    expect([frame.moving, frame.lightMoving]).toEqual([true, false]);
  });
});
```

`packages/web/src/lib/relight/__tests__/eye.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CAPTURE_CALIBRATION, IDENTITY_EYE, SCOTOPIC_MAX, adaptationLuminance, anchoredEye, lightChroma, normaliseShares, scotopicAmount,
  type EyeAnchor, type EyeAnchors, type LightShares,
} from "../eye.js";

const CALIBRATION = CAPTURE_CALIBRATION;
const anchor = (exposure: number, logLuminance: number, whiteBalance: [number, number, number] = [1, 1, 1], logChroma: [number, number] = [0, 0]): EyeAnchor =>
  ({ exposure, whiteBalance, logLuminance, logChroma });
const ANCHORS: EyeAnchors = { day: anchor(0.6, -1), lamps: anchor(0.8, -3, [0.9, 1, 1.2], [1, -2]), moon: anchor(40, -14) };
const only = (name: keyof LightShares): LightShares => ({ day: 0, lamps: 0, moon: 0, [name]: 1 });
const measured = (logLuminance: number) => ({ logLuminance, at: 0 });

describe("the eye (T-639 R1d)", () => {
  it("is the identity until something moves it", () => {
    expect(IDENTITY_EYE).toEqual({ exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 });
  });

  it("converts the frame's log luminance to cd/m² by the capture's calibration", () => {
    expect(CAPTURE_CALIBRATION.cdPerUnit).toBe(54);
    expect(adaptationLuminance(Math.log2(10 / 54), CALIBRATION)).toBeCloseTo(10, 9);
    expect(adaptationLuminance(0, { ...CALIBRATION, cdPerUnit: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the captured hall and the lamp-lit night photopic: no shift (frontier light study §b4)", () => {
    expect(scotopicAmount(adaptationLuminance(Math.log2(0.1704), CALIBRATION))).toBe(0);
    expect(scotopicAmount(adaptationLuminance(Math.log2(0.1281), CALIBRATION))).toBe(0);
    expect(scotopicAmount(adaptationLuminance(Math.log2(0.01 / 54), CALIBRATION))).toBeGreaterThan(0.4);
  });

  it("shifts toward the rods only below 5 cd/m², at most 0.6, log-linearly", () => {
    expect([scotopicAmount(5), scotopicAmount(500), scotopicAmount(0.005), scotopicAmount(1e-6), scotopicAmount(0)])
      .toEqual([0, 0, SCOTOPIC_MAX, SCOTOPIC_MAX, SCOTOPIC_MAX]);
    expect(scotopicAmount(Math.sqrt(5 * 0.005))).toBeCloseTo(0.3, 12);
  });

  it("gives an anchor's own display at its own luminance and colour", () => {
    const target = anchoredEye(ANCHORS, only("lamps"), [1, -2], measured(-3), CALIBRATION);
    expect(target.exposure).toBeCloseTo(0.8, 12);
    [0.9, 1, 1.2].forEach((value, c) => { expect(target.whiteBalance[c]).toBeCloseTo(value, 12); });
  });

  it("follows half a change in the frame's luminance", () => {
    const target = anchoredEye(ANCHORS, only("day"), [0, 0], measured(-2), CALIBRATION);
    expect(target.exposure).toBeCloseTo(0.6 * Math.SQRT2, 12);
  });

  it("follows 60% of a change in the light's colour", () => {
    const target = anchoredEye(ANCHORS, only("day"), [1, 0], measured(-1), CALIBRATION);
    expect(target.whiteBalance[0]).toBeCloseTo(2 ** -0.6, 12);
    expect([target.whiteBalance[1], target.whiteBalance[2]]).toEqual([1, 1]);
  });

  it("mixes the anchors by share in log space", () => {
    const target = anchoredEye(ANCHORS, { day: 0.5, lamps: 0.5, moon: 0 }, [0.5, -1], measured(-2), CALIBRATION);
    expect(target.exposure).toBeCloseTo(Math.sqrt(0.6 * 0.8), 12);
  });

  it("stays within eightfold of the anchors", () => {
    expect(anchoredEye(ANCHORS, only("day"), [0, 0], measured(-21), CALIBRATION).exposure).toBeCloseTo(0.6 * 8, 12);
    expect(anchoredEye(ANCHORS, only("day"), [0, 0], measured(19), CALIBRATION).exposure).toBeCloseTo(0.6 / 8, 12);
  });

  it("uses the anchors' own luminance without a measurement, scotopic included", () => {
    const target = anchoredEye(ANCHORS, only("moon"), [0, 0], null, CALIBRATION);
    expect(target.exposure).toBeCloseTo(40, 12);
    expect(target.scotopic).toBeCloseTo(scotopicAmount(adaptationLuminance(-14, CALIBRATION)), 12);
    expect(target.scotopic).toBeGreaterThan(0);
  });

  it("reads the light's chroma and normalises shares, darkness counting as the moonlit night", () => {
    expect(lightChroma([2, 1, 0.5])).toEqual([1, -1]);
    expect(normaliseShares({ day: 2, lamps: 1, moon: 1 })).toEqual({ day: 0.5, lamps: 0.25, moon: 0.25 });
    expect(normaliseShares({ day: 0, lamps: 0, moon: 0 })).toEqual({ day: 0, lamps: 0, moon: 1 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/light-motion.test.ts`
Expected: FAIL — cannot find module `../light-motion.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/eye.test.ts`
Expected: FAIL — cannot find module `../eye.js`.

- [ ] **Step 3: Implement the motion** — create `packages/web/src/lib/relight/light-motion.ts`:

```ts
import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "../springs.js";
import { LAMP_GROUPS, type LampGroup, type Rgb } from "./relight-kernel.js";

/**
 * The light's motion (T-639 R1d, spec §4.1–4.2): the displayed hour as a critically damped time-lapse, each lamp
 * group's drive fading up and down, the cross-fade of a change of date (and of every change under reduced motion),
 * and the eye. Everything steps the one spring core; at rest every value is exactly its target.
 */
export const MINUTES_PER_DAY = 1440;
/** A change into the next or previous day sweeps only this far (live time across midnight); farther, it cross-fades. */
export const MAX_CROSS_DAY_SWEEP = 180;

export function criticallyDamped(omega: number): SpringConfig {
  return { stiffness: omega * omega, damping: 2 * omega };
}

/** The time-lapse: 95% of any change of hour in 1.6 s, no overshoot. */
export const TIME_SPRING = criticallyDamped(3);
/** A lamp group fading up or down (its colour follows lamp-dimming.ts: the artistic warm-down by default). */
export const LAMP_SPRING = criticallyDamped(3);
/** The cross-fade: 95% in about one second. */
export const BLEND_SPRING = criticallyDamped(5);
/** The eye toward a brighter scene (95% in 1.2 s) and toward a darker one (1.9 s): "over one to two seconds". */
export const EYE_BRIGHTER = criticallyDamped(4);
export const EYE_DARKER = criticallyDamped(2.5);
export const SETTLED = { minutes: 0.01, lamp: 1e-3, blend: 1e-3, eye: 1e-3 } as const;

export type LampDrives = Readonly<Record<LampGroup, number>>;
export interface EyeTarget {
  readonly exposure: number;
  readonly whiteBalance: Rgb;
  /** 0 photopic … SCOTOPIC_MAX (eye.ts): how far the display mixes toward the rods' response (Task 16). */
  readonly scotopic: number;
}
/** A London calendar day (days since 1970-01-01) and wall-clock minutes, fractional. */
export interface MotionInstant { readonly day: number; readonly minutes: number }
export interface MotionTargets { readonly instant: MotionInstant; readonly lamps: LampDrives; readonly eye: EyeTarget }
export interface MotionFrame {
  /** The instant shown; while a blend runs, the one being faded in. */
  readonly instant: MotionInstant;
  /** While a cross-fade runs: the instant being faded out and how far the new one is in (0 → 1). */
  readonly blend: { readonly from: MotionInstant; readonly amount: number } | null;
  readonly lamps: LampDrives;
  readonly eye: EyeTarget;
  /** Anything moves (the eye included). */
  readonly moving: boolean;
  /** The hour, a lamp or a blend moves: the light must be reapplied (the eye alone only changes the display). */
  readonly lightMoving: boolean;
}

interface EyeSprings { readonly exposure: SpringState; readonly red: SpringState; readonly blue: SpringState; readonly scotopic: SpringState }

const spring = (value: number): SpringState => ({ value, velocity: 0 });
const log2 = (value: number): number => Math.log2(Math.max(value, 1e-12));
const clampDrive = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Step toward a target; snap to it once settled. Returns true while it still moves. */
function advance(state: SpringState, target: number, dt: number, config: SpringConfig, epsilon: number): boolean {
  stepSpring(state, target, dt, config);
  if (!isSpringSettled(state, target, epsilon)) return true;
  state.value = target;
  state.velocity = 0;
  return false;
}

function eyeGoal(eye: EyeTarget): { readonly exposure: number; readonly red: number; readonly blue: number; readonly scotopic: number } {
  const green = Math.max(eye.whiteBalance[1], 1e-12);
  return { exposure: log2(eye.exposure), red: log2(eye.whiteBalance[0] / green), blue: log2(eye.whiteBalance[2] / green), scotopic: eye.scotopic };
}

export class LightMotion {
  private day: number;
  private readonly minutes: SpringState;
  private readonly lamps: Record<LampGroup, SpringState>;
  private readonly eye: EyeSprings;
  private blend: { readonly from: MotionInstant; readonly amount: SpringState } | null = null;
  private moving = false;
  private lightMoving = false;

  constructor(targets: MotionTargets) {
    this.day = targets.instant.day;
    this.minutes = spring(targets.instant.minutes);
    this.lamps = { cove: spring(0), ch_end: spring(0), ch_centre: spring(0), dome: spring(0) };
    const goal = eyeGoal(targets.eye);
    this.eye = { exposure: spring(goal.exposure), red: spring(goal.red), blue: spring(goal.blue), scotopic: spring(goal.scotopic) };
    this.snap(targets);
  }

  /** Jump to the targets at rest (the first frame, a new frame, a test). */
  snap(targets: MotionTargets): MotionFrame {
    this.day = targets.instant.day;
    this.minutes.value = targets.instant.minutes;
    this.minutes.velocity = 0;
    for (const group of LAMP_GROUPS) { this.lamps[group].value = clampDrive(targets.lamps[group]); this.lamps[group].velocity = 0; }
    const goal = eyeGoal(targets.eye);
    for (const key of ["exposure", "red", "blue", "scotopic"] as const) { this.eye[key].value = goal[key]; this.eye[key].velocity = 0; }
    this.blend = null;
    this.moving = false;
    this.lightMoving = false;
    return this.current();
  }

  /** Cross-fade to whatever the light becomes, at the same instant (a change of weather or of the captured light). */
  crossFade(): void {
    this.blend = { from: { day: this.day, minutes: this.minutes.value }, amount: spring(0) };
    this.lightMoving = true;
    this.moving = true;
  }

  /** Set the displayed instant without motion: live time's own progress. */
  retime(instant: MotionInstant): void {
    this.day = instant.day;
    this.minutes.value = instant.minutes;
    this.minutes.velocity = 0;
  }

  step(dtSeconds: number, targets: MotionTargets, sweep: boolean): MotionFrame {
    let lightMoving = false;
    if (this.blend !== null) {
      if (advance(this.blend.amount, 1, dtSeconds, BLEND_SPRING, SETTLED.blend)) lightMoving = true;
      else this.blend = null;
    }
    if (this.blend === null) lightMoving = this.stepTime(dtSeconds, targets.instant, sweep) || lightMoving;
    for (const group of LAMP_GROUPS) {
      if (advance(this.lamps[group], clampDrive(targets.lamps[group]), dtSeconds, LAMP_SPRING, SETTLED.lamp)) lightMoving = true;
    }
    let moving = lightMoving;
    const goal = eyeGoal(targets.eye);
    // Toward a brighter scene (a lower exposure) the eye is quicker than toward a darker one.
    const rate = goal.exposure < this.eye.exposure.value ? EYE_BRIGHTER : EYE_DARKER;
    for (const key of ["exposure", "red", "blue", "scotopic"] as const) {
      if (advance(this.eye[key], goal[key], dtSeconds, rate, SETTLED.eye)) moving = true;
    }
    this.moving = moving;
    this.lightMoving = lightMoving;
    return this.current();
  }

  current(): MotionFrame {
    const lamps: Record<LampGroup, number> = { cove: 0, ch_end: 0, ch_centre: 0, dome: 0 };
    for (const group of LAMP_GROUPS) lamps[group] = clampDrive(this.lamps[group].value);
    return {
      instant: { day: this.day, minutes: this.minutes.value },
      blend: this.blend === null ? null : { from: this.blend.from, amount: Math.min(Math.max(this.blend.amount.value, 0), 1) },
      lamps,
      eye: {
        exposure: 2 ** this.eye.exposure.value,
        whiteBalance: [2 ** this.eye.red.value, 1, 2 ** this.eye.blue.value],
        scotopic: Math.max(this.eye.scotopic.value, 0),
      },
      moving: this.moving,
      lightMoving: this.lightMoving,
    };
  }

  /** The hour: a sweep within the day or just across midnight, otherwise a cross-fade. Returns true while it moves. */
  private stepTime(dt: number, target: MotionInstant, sweep: boolean): boolean {
    const goal = target.minutes + (target.day - this.day) * MINUTES_PER_DAY;
    const sameDay = target.day === this.day;
    const nearDay = Math.abs(target.day - this.day) === 1 && Math.abs(goal - this.minutes.value) <= MAX_CROSS_DAY_SWEEP;
    if (sweep && (sameDay || nearDay)) {
      const moving = advance(this.minutes, goal, dt, TIME_SPRING, SETTLED.minutes);
      // Re-base so the minutes stay within the displayed day; the velocity carries on.
      while (this.minutes.value >= MINUTES_PER_DAY) { this.minutes.value -= MINUTES_PER_DAY; this.day += 1; }
      while (this.minutes.value < 0) { this.minutes.value += MINUTES_PER_DAY; this.day -= 1; }
      return moving;
    }
    if (sameDay && goal === this.minutes.value) return false;
    this.blend = { from: { day: this.day, minutes: this.minutes.value }, amount: spring(0) };
    this.day = target.day;
    this.minutes.value = target.minutes;
    this.minutes.velocity = 0;
    return true;
  }
}
```

- [ ] **Step 4: Implement the eye** — create `packages/web/src/lib/relight/eye.ts`:

```ts
import type { EyeTarget } from "./light-motion.js";
import type { Rgb } from "./relight-kernel.js";

/**
 * The eye (T-639 R1d decision 4; spec §4.2 "eye adaptation over one to two seconds to the scene's light, anchored
 * to the calibrated presets"). The target mixes three calibrated anchors by each one's share of the light, each
 * corrected by half the difference between its measured luminance and the rendered frame's (measured on the GPU,
 * Task 13) and by 60% of the difference between its light's colour and the current light's, within eightfold of
 * the anchors. Below 5 cd/m² it mixes toward the rods' response (Thompson, Shirley & Ferwerda 2002; the display
 * applies it, Task 16), at most 0.6 by 0.005 cd/m² (CIE 191:2010's mesopic range).
 */
export const EYE_ANCHOR_NAMES = ["day", "lamps", "moon"] as const;
export type EyeAnchorName = (typeof EYE_ANCHOR_NAMES)[number];
export interface EyeAnchor {
  readonly exposure: number;
  readonly whiteBalance: Rgb;
  /** log2 of the reference view's log-average luminance before exposure at this anchor, measured as Task 13 measures. */
  readonly logLuminance: number;
  /** log2 (r/g, b/g) of the anchor's light colour (`lightChroma` of the light's summed sources). */
  readonly logChroma: readonly [number, number];
}
export type EyeAnchors = Readonly<Record<EyeAnchorName, EyeAnchor>>;
/** Each anchor's share of the light (the day: the Sun and its sky; the lamps; the moon: the Moon and its sky). */
export type LightShares = Readonly<Record<EyeAnchorName, number>>;
export interface FrameMeasurement {
  /** log2 of the frame's log-average luminance before exposure. */
  readonly logLuminance: number;
  /** performance.now() when it was read back. */
  readonly at: number;
}

export const LUMINANCE_ADAPTATION = 0.5;
export const CHROMA_ADAPTATION = 0.6;
export const EYE_RANGE_STOPS = 3;
export const PHOTOPIC_LUMINANCE = 5;
export const SCOTOPIC_LUMINANCE = 0.005;
export const SCOTOPIC_MAX = 0.6;
export const IDENTITY_EYE: EyeTarget = { exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 };

/** Absolute luminance of a frame value (light × albedo in the fit's units): the spectral package's, when it exists, replaces it. */
export interface LuminanceCalibration {
  readonly cdPerUnit: number;
  readonly uncertaintyStops: number;
  readonly provenance: string;
}
/** k_abs from the capture day's weather (frontier light study, D:/claude/real-hall/frontier/light/proposal.md §b4). */
export const CAPTURE_CALIBRATION: LuminanceCalibration = {
  cdPerUnit: 54,
  uncertaintyStops: 1,
  provenance: "Open-Meteo reanalysis, 31 May 2026 09:00-10:00 UTC, DHI 161 W/m2, the fit's band weights (frontier light study b4)",
};

export function normaliseShares(shares: LightShares): LightShares {
  const total = Math.max(shares.day, 0) + Math.max(shares.lamps, 0) + Math.max(shares.moon, 0);
  if (!(total > 0)) return { day: 0, lamps: 0, moon: 1 };
  return { day: Math.max(shares.day, 0) / total, lamps: Math.max(shares.lamps, 0) / total, moon: Math.max(shares.moon, 0) / total };
}

export function lightChroma(colour: Rgb): readonly [number, number] {
  const green = Math.max(colour[1], 1e-12);
  return [Math.log2(Math.max(colour[0], 1e-12) / green), Math.log2(Math.max(colour[2], 1e-12) / green)];
}

/** cd/m² of a frame whose log-average value is 2^logLuminance (light × albedo in the fit's units); no calibration is photopic. */
export function adaptationLuminance(logLuminance: number, calibration: LuminanceCalibration): number {
  return calibration.cdPerUnit > 0 ? 2 ** logLuminance * calibration.cdPerUnit : Number.POSITIVE_INFINITY;
}

export function scotopicAmount(luminance: number): number {
  if (!(luminance > 0)) return SCOTOPIC_MAX;
  const t = (Math.log10(PHOTOPIC_LUMINANCE) - Math.log10(luminance)) / (Math.log10(PHOTOPIC_LUMINANCE) - Math.log10(SCOTOPIC_LUMINANCE));
  return SCOTOPIC_MAX * Math.min(Math.max(t, 0), 1);
}

export function anchoredEye(
  anchors: EyeAnchors, shares: LightShares, chroma: readonly [number, number], measured: FrameMeasurement | null, calibration: LuminanceCalibration,
): EyeTarget {
  const weights = normaliseShares(shares);
  let exposure = 0, base = 0, red = 0, blue = 0, reference = 0;
  for (const name of EYE_ANCHOR_NAMES) {
    const weight = weights[name], anchor = anchors[name];
    if (weight === 0) continue;
    const own = Math.log2(anchor.exposure);
    const frame = measured?.logLuminance ?? anchor.logLuminance;
    base += weight * own;
    reference += weight * anchor.logLuminance;
    exposure += weight * (own + LUMINANCE_ADAPTATION * (anchor.logLuminance - frame));
    const green = anchor.whiteBalance[1];
    red += weight * (Math.log2(anchor.whiteBalance[0] / green) + CHROMA_ADAPTATION * (anchor.logChroma[0] - chroma[0]));
    blue += weight * (Math.log2(anchor.whiteBalance[2] / green) + CHROMA_ADAPTATION * (anchor.logChroma[1] - chroma[1]));
  }
  const bounded = Math.min(Math.max(exposure, base - EYE_RANGE_STOPS), base + EYE_RANGE_STOPS);
  const luminance = adaptationLuminance(measured?.logLuminance ?? reference, calibration);
  return { exposure: 2 ** bounded, whiteBalance: [2 ** red, 1, 2 ** blue], scotopic: scotopicAmount(luminance) };
}
```

- [ ] **Step 5: Run them**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/light-motion.test.ts`
Expected: PASS, 12 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/eye.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/light-motion.ts packages/web/src/lib/relight/eye.ts packages/web/src/lib/relight/__tests__/light-motion.test.ts packages/web/src/lib/relight/__tests__/eye.test.ts && git diff --cached --stat && git commit -m "feat(relight): the light's springs and the eye's anchored targets (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The light at a displayed instant: live time, the whole day, the lamps, both sky bodies

**Files:**
- Modify: `packages/web/src/lib/light-setting.ts`, `packages/web/src/stores/light-setting-store.ts`, `packages/web/src/components/rooms/LightControl.tsx` (its `LABELS` only)
- Create: `packages/web/src/lib/relight/sky-instant.ts`
- Test: `packages/web/src/lib/__tests__/light-setting.test.ts`, `packages/web/src/stores/__tests__/light-setting-store.test.ts`, `packages/web/src/components/rooms/__tests__/LightControl.test.tsx` (modify); `packages/web/src/lib/relight/__tests__/sky-instant.test.ts` (create)

**Interfaces:**
- Consumes: R1b's `light-setting.ts` as amended by A1, A4 and A7 (`LIGHT_PRESETS`, `PRESET_DEFAULTS`, `PRESET_DISPLAY`, `PRESET_EMITTER_BOOST`, `WeatherPreset`, `LightInputs` with `unitsPerLux`, `ChoiceLight` with `moon`, `settingForChoice`, `settingForSky`, `londonOffsetHours`, `londonLocalToUtc`, `isIsoDate`, `clampMinutes`, `luminanceOf`); `moonPosition`, `MoonPosition`, `MOON_CCT` (A3); `solarPosition`, `sunDirection`, `SolarPosition` (R1b Task 6); Task 4 (`LampDimming`, `dimmedOutput`, `dimmedTint`); Task 5 (`LampDrives`, `MotionInstant`, `normaliseShares`, `LightShares`).
- Produces (`light-setting.ts`): `LIGHT_PRESETS = ["live", "captured", "night", "moonlit", "sunny", "overcast"]`; `WeatherPreset = Exclude<LightPresetId, "captured" | "live">`; `MIN_MINUTES = 0`, `MAX_MINUTES = 1439`; `type LampMode = "auto" | "on" | "off"`, `LAMP_MODES`; `PRESET_LAMPS`; `LAMPS_ON_ELEVATION = 7`; `MOON_NEGLIGIBLE = 1e-5`; `interface LampGroupLight { readonly dimming: LampDimming; readonly gain: Rgb }`, `interface LampLight { readonly warmFullCct: number | null; readonly groups: Readonly<Record<LampGroup, LampGroupLight>> }`, `STEADY_LAMPS` (every group LED-true with gain 1 and no warm-down temperature: the light without the cinematic package); `interface SkyLight extends ChoiceLight { sun; moon; shares: LightShares; colour: Rgb; moonSky: { level: number; colour: Rgb }; sheen: number }` (`sheen`: 1 for every computed sky; Task 9's captured light has 0); `weatherOf(preset: Exclude<LightPresetId, "captured">): WeatherPreset`; `lampsLitFor(sunElevation: number): boolean`; `lampTargets(mode: LampMode, sunElevation: number): LampDrives`; `interface SkyExtras { readonly city: readonly Rgb[] | null; readonly keepMoon: boolean }`, `NO_EXTRAS`; `cityLevel(sunElevation: number): number`; `lightForSky(inputs: LightInputs, weather: WeatherPreset, sun: SolarPosition, moon: MoonPosition, drives: LampDrives, lamps: LampLight, extras?: SkyExtras): SkyLight` (`extras.city`: each window's light from the street-lit facade and the skyglow at full night, Task 15; `extras.keepMoon` keeps a negligible Moon for Task 23's both-bodies budget); `settingForChoice` and `settingForSky` rebuilt on it (same results for every preset); `dayNumber(date: string): number`; `dateOfDay(day: number): string`; `londonClock(now: Date): MotionInstant`; `liveChoice(now: Date): LightChoice`.
- Produces (`sky-instant.ts`): `interface SkyAt { readonly utc: Date; readonly sun: SolarPosition; readonly moon: MoonPosition }`; `instantOf(at: MotionInstant): Date`; `skyAt(at: MotionInstant, latitude: number, longitude: number): SkyAt`.
- Produces (store): `follow: boolean`, `lamps: LampMode`, `setLamps(lamps: LampMode): void`, `followClock(): void`; the store starts live (`liveChoice(new Date())`, following, lamps automatic); `selectPreset` sets each preset's lamps and stops following (live follows); `setMinutes` and `setDate` stop following.

Live time is the default (spec §4.1): the hall at London's real hour, in clear weather until R2 brings the real weather, with automatic lamps. It is a preset (`live`, labelled "Live") whose weather is the clear morning's and whose display anchor is the sunny morning's (`PRESET_DEFAULTS.live` and `PRESET_DISPLAY.live` repeat the sunny preset's, so R1b's `applicationForChoice` carries it like any preset when the cinematic package is absent); the clock follows real time while `follow` is true, which "Now" (Task 20) restores in any weather. The clock spans the whole day (the Moon is mostly a night light), so the hour runs 00:00–23:59.

The lamps (decision 3) have three modes: automatic (lit while the Sun is below 7°, about an hour before sunset in Glasgow, where the low Sun descends some 6–8° an hour), on and off. Every preset keeps its own: the night lit; the moonlit night, sunny morning and overcast noon off; live automatic (every proof scenario's `house` is exactly 1 or 0, `05_relight.py:36–42`, so the switch's on and off reproduce them exactly). A lamp group's drive (0..1, Task 5's spring) sets its light as `w[k]c[k] ⊙ dimmedTint(d) × dimmedOutput(d) × gain` and its emitters' level as `dimmedOutput(d)` with `lampTints` (amendment A1), where the group's dimming is the cinematic package's (decision 11: `warm`, the artistic warm-down from `lamps.warmDown.fullCct`, by default; `led` on the per-group flag) and the gain is Task 21's night calibration (ones until then). Without the package every group fades LED-true at the bake's colour (no warm-down temperature is known). At drive 0 and 1 with gain 1 every curve gives exactly R1b's light, so every preset's setting, and so every test vector, is unchanged; the group's colour at full level is always the relight package's own.

Both bodies count whenever their light can show (decision 2): the Moon is dropped only when its light is below 1/100,000 of the day's and the lamps' together (in daylight, or under lit chandeliers), where it cannot move a displayed pixel by a tenth of a code; a day Moon's disc still shows in the windows (Task 15), and Task 23 measures the frame budget with both bodies forced on. In clear weather the Moon also lights its own sky: the clear sky's relation to its Sun (the Sun's strength is `sunRatio × sky × mean window weight`) taken backwards gives the moonlit sky's level, in the clear sky's colour relative to the Sun's applied to moonlight. It enters through the windows' weights; R1b's `skyLevel` stays the Sun's sky (so the proof's night is exactly reproduced), and the night sky panels read the moonlit sky from `moonSky` (Task 15). The eye's shares (Task 5) are each part's light: the day (the Sun and its sky), the lamps and the Moon (with its sky), with their summed colour for the eye's white balance.

The city lights the hall at night (the frontier light study, `D:/claude/real-hall/frontier/light/proposal.md` §b3): the facade across Glassford Street fills 55–83% of each window's view, lit by street lighting to about 1 cd/m², far brighter than the skyglow, so mid-hall receives some 0.03–0.1 lux from it and a full Moon's patch is only 1–3× its surroundings. `lightForSky` adds each window's city light (`extras.city`, built by Task 15 from the package's window radiance, each window's view of the facade and the calibration) scaled by `cityLevel`: street lighting comes up through dusk, none with the Sun above the horizon and all of it below −6°. It counts in the night's share for the eye. R1b's own settings (`settingForChoice`, `settingForSky`) pass no extras, so R1a's vectors and every R1b test are unchanged; only the cinematic light's director adds the city.

`skyAt` computes both bodies at the displayed instant itself: NOAA's Sun and the Meeus Moon (A3) take microseconds each, so the light is exact at every frame of a time-lapse.

Verified (7 October): R1b plan lines 4059–4096 (`LIGHT_PRESETS`, `type WeatherPreset`, `MIN_MINUTES`/`MAX_MINUTES`, `PRESET_DEFAULTS`, `PRESET_DISPLAY`, `PRESET_EMITTER_BOOST`, `defaultChoice`), 4102–4131 (`londonOffsetHours`, `isIsoDate`, `londonLocalToUtc`, `clampMinutes`, `formatMinutes`), 4146–4204 (`LightInputs`, `lightInputsFromParts`: `presets.night` is `{ weather: clear, house, lampLevel }`), 4236 (`const luminanceOf`), 4273–4296 (the store), 7665–7670 (`LABELS`), 7590–7614 (the control's tests), 3851–3953 (`light-setting.test.ts`: `expectSetting` compares weights, sky, `lampLevels`, `emitterBoost`, `sunDir`, `sunRgb` to 1e-6); R1b plan line 1643 (`type LampLevels`); amendment A1 (`PRESET_EMITTER_BOOST` with `moonlit`; `RelightSetting.lampTints`), A4 (amendments lines 577–731: `unitsPerLux` at 602–613, `ChoiceLight` at 616, `settingForChoice` at 627, `settingForSky` at 641), A7 (lines 927–951: `LIGHT_PRESETS` with `moonlit`, `PRESET_DEFAULTS.moonlit`, `MOONLIT_DISPLAY_KEY`); `tools/relight/relight/codec.py:11` (`SOURCES`: W1–W5, then `cove`, `ch_end`, `ch_centre`, `dome`, the order of `LAMP_GROUPS`); `tools/relight/proof/05_relight.py:36-42` (`house` 1.0 at night, 0.0 otherwise).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/sky-instant.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dayNumber, londonLocalToUtc } from "../../light-setting.js";
import { moonPosition } from "../../moon.js";
import { TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE, solarPosition } from "../../sun.js";
import { instantOf, skyAt } from "../sky-instant.js";

describe("the sky at a displayed instant (T-639 R1d)", () => {
  it("is London's wall clock, fractional minutes included", () => {
    expect(instantOf({ day: dayNumber("2026-05-31"), minutes: 540.5 }).toISOString()).toBe("2026-05-31T08:00:30.000Z");
    expect(instantOf({ day: dayNumber("2026-12-21"), minutes: 720 }).getTime()).toBe(londonLocalToUtc("2026-12-21", 720).getTime());
  });

  it("takes the first of October's repeated hour, as the light setting does", () => {
    expect(instantOf({ day: dayNumber("2026-10-25"), minutes: 90 }).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("puts both bodies where the ephemerides put them at that instant", () => {
    const at = { day: dayNumber("2026-09-26"), minutes: 1380.25 };
    const sky = skyAt(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    expect(sky.sun).toEqual(solarPosition(sky.utc, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE));
    expect(sky.moon).toEqual(moonPosition(sky.utc, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE));
  });

  it("finds the moonlit preset's full Moon high over Glasgow", () => {
    const sky = skyAt({ day: dayNumber("2026-09-26"), minutes: 1380 }, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    expect(sky.moon.elevation).toBeGreaterThan(25);
    expect(sky.moon.illuminatedFraction).toBeGreaterThan(0.99);
    expect(sky.sun.elevation).toBeLessThan(-18);
  });
});
```

In `packages/web/src/lib/__tests__/light-setting.test.ts`, replace the file's first `import { … } from "../light-setting.js";` statement (A4 and A7 left it as R1b wrote it) with:

```ts
import {
  LIGHT_PRESETS, PRESET_DEFAULTS, PRESET_DISPLAY, PRESET_LAMPS, STEADY_LAMPS, adaptDisplay, cityLevel, clampMinutes, dateOfDay, dayNumber,
  defaultChoice, formatMinutes, isIsoDate, lampTargets, lightForSky, lightInputsFromParts, lightPresetFromSearch, liveChoice,
  londonClock, londonLocalToUtc, relightEligible, relightOffBySearch, settingForChoice,
  type LampLight, type LightInputs,
} from "../light-setting.js";
import { dimmedOutput, dimmedTint } from "../relight/lamp-dimming.js";
import { moonPosition } from "../moon.js";
```

and replace `import { TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE } from "../sun.js";` with `import { TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE, solarPosition } from "../sun.js";`. Replace:

```ts
  it("keeps the hour between 06:00 and 22:00 and writes it as a clock", () => {
    expect([clampMinutes(100), clampMinutes(600.4), clampMinutes(2000)]).toEqual([360, 600, 1320]);
    expect([formatMinutes(360), formatMinutes(1305)]).toEqual(["06:00", "21:45"]);
  });
```

with:

```ts
  it("keeps the hour within the whole day and writes it as a clock (R1d)", () => {
    expect([clampMinutes(-5), clampMinutes(600.4), clampMinutes(2000)]).toEqual([0, 600, 1439]);
    expect([formatMinutes(360), formatMinutes(1305), formatMinutes(1439)]).toEqual(["06:00", "21:45", "23:59"]);
  });
```

and append inside the file's `describe`, before its closing `});`:

```ts
  it("starts the presets with live time and counts London's days and minutes (R1d)", () => {
    expect(LIGHT_PRESETS[0]).toBe("live");
    expect([dayNumber("1970-01-01"), dayNumber("2026-10-07")]).toEqual([0, 20733]);
    expect([dateOfDay(20733), dateOfDay(dayNumber("2024-02-29"))]).toEqual(["2026-10-07", "2024-02-29"]);
    expect(londonClock(new Date("2026-10-07T17:30:15Z"))).toEqual({ day: 20733, minutes: 1110.25 });
    expect(londonClock(new Date("2026-12-21T23:59:00Z"))).toEqual({ day: dayNumber("2026-12-21"), minutes: 1439 });
    expect(liveChoice(new Date("2026-10-07T17:30:15Z"))).toEqual({ preset: "live", date: "2026-10-07", minutes: 1110 });
  });

  it("lights the lamps automatically below a 7° Sun, and keeps every preset's own lamps (R1d)", () => {
    expect([lampTargets("auto", 6.9).dome, lampTargets("auto", 7).dome, lampTargets("on", 40).cove, lampTargets("off", -20).ch_end]).toEqual([1, 0, 1, 0]);
    expect(PRESET_LAMPS).toEqual({ live: "auto", captured: "on", night: "on", moonlit: "off", sunny: "off", overcast: "off" });
    expect([inputs().presets.night.house, inputs().presets.sunny.house, inputs().presets.overcast.house]).toEqual([1, 0, 0]);
  });

  it("dims a lamp warm by the owner's choice and keeps a full lamp exactly as the bake has it (R1d)", () => {
    const at = londonLocalToUtc(PRESET_DEFAULTS.night.date, PRESET_DEFAULTS.night.minutes);
    const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    const half = { cove: 0.5, ch_end: 0.5, ch_centre: 0.5, dome: 0.5 }, full = { cove: 1, ch_end: 1, ch_centre: 1, dome: 1 };
    const warmGroup = { dimming: "warm", gain: [1, 1, 1] } as const;
    const warm: LampLight = { warmFullCct: 3700, groups: { cove: warmGroup, ch_end: warmGroup, ch_centre: warmGroup, dome: warmGroup } };
    const dimmed = lightForSky(inputs(), "night", sun, moon, half, warm).setting;
    const tint = dimmedTint(0.5, "warm", 3700), captured = inputs().captureWeights[6] ?? [0, 0, 0];
    [0, 1, 2].forEach((c) => { relClose(dimmed.weights[6]?.[c] ?? Number.NaN, (captured[c] ?? 0) * (tint[c] ?? 0) * dimmedOutput(0.5, "warm")); });
    expect(dimmed.lampLevels.ch_end).toBeCloseTo(dimmedOutput(0.5, "warm"), 12);
    expect(dimmed.lampTints?.ch_end).toEqual(tint);
    expect(tint[2]).toBeLessThan(tint[0]);
    expect(lightForSky(inputs(), "night", sun, moon, full, warm).setting.weights[6]).toEqual(captured);
  });

  it("fades an LED group at the bake's colour, and every group so without the cinematic package (R1d)", () => {
    const at = londonLocalToUtc(PRESET_DEFAULTS.night.date, PRESET_DEFAULTS.night.minutes);
    const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    const half = { cove: 0.5, ch_end: 0.5, ch_centre: 0.5, dome: 0.5 };
    const steady = lightForSky(inputs(), "night", sun, moon, half, STEADY_LAMPS).setting;
    const captured = inputs().captureWeights[6] ?? [0, 0, 0];
    expect(steady.lampTints?.ch_end).toEqual([1, 1, 1]);
    expect(steady.lampLevels.ch_end).toBeCloseTo(dimmedOutput(0.5, "led"), 12);
    [0, 1, 2].forEach((c) => { relClose(steady.weights[6]?.[c] ?? Number.NaN, (captured[c] ?? 0) * dimmedOutput(0.5, "led")); });
    const warmGroup = { dimming: "warm", gain: [1, 1, 1] } as const, ledGroup = { dimming: "led", gain: [1, 1, 1] } as const;
    const mixed: LampLight = { warmFullCct: 3700, groups: { cove: ledGroup, ch_end: warmGroup, ch_centre: warmGroup, dome: warmGroup } };
    const setting = lightForSky(inputs(), "night", sun, moon, half, mixed).setting;
    expect(setting.lampTints?.cove).toEqual([1, 1, 1]);
    expect(setting.lampTints?.ch_end).toEqual(dimmedTint(0.5, "warm", 3700));
  });

  it("applies the night gains to the lamps' light only (R1d)", () => {
    const at = londonLocalToUtc(PRESET_DEFAULTS.night.date, PRESET_DEFAULTS.night.minutes);
    const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    const lamps: LampLight = { ...STEADY_LAMPS, groups: { ...STEADY_LAMPS.groups, ch_end: { dimming: "led", gain: [2, 1, 0.5] } } };
    const light = lightForSky(inputs(), "night", sun, moon, { cove: 1, ch_end: 1, ch_centre: 1, dome: 1 }, lamps).setting;
    const captured = inputs().captureWeights[6] ?? [0, 0, 0];
    expect(light.weights[6]).toEqual([captured[0] * 2, captured[1], captured[2] * 0.5]);
    expect(light.lampLevels.ch_end).toBe(1);
  });

  it("lights live time as the clear sky with automatic lamps (R1d)", () => {
    const morning = liveChoice(londonLocalToUtc(PRESET_DEFAULTS.sunny.date, PRESET_DEFAULTS.sunny.minutes));
    expect(settingForChoice(inputs(), morning).setting).toEqual(settingForChoice(inputs(), defaultChoice("sunny")).setting);
    const evening = liveChoice(londonLocalToUtc(PRESET_DEFAULTS.night.date, PRESET_DEFAULTS.night.minutes));
    expect(settingForChoice(inputs(), evening).setting).toEqual(settingForChoice(inputs(), defaultChoice("night")).setting);
  });

  it("drops a Moon too faint beside the day, and lights the moonlit night by the Moon and its sky (R1d)", () => {
    const day = settingForChoice(inputs(), { ...defaultChoice("sunny"), date: "2026-10-07", minutes: 600 });
    expect(day.moon?.elevation).toBeGreaterThan(0);
    expect([day.setting.moonDir, day.setting.moonRgb]).toEqual([null, [0, 0, 0]]);
    const at = londonLocalToUtc(PRESET_DEFAULTS.moonlit.date, PRESET_DEFAULTS.moonlit.minutes);
    const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    const night = lightForSky(inputs(), "moonlit", sun, moon, { cove: 0, ch_end: 0, ch_centre: 0, dome: 0 }, STEADY_LAMPS);
    expect(night.setting.skyLevel).toBe(0);
    expect(night.moonSky.level).toBeGreaterThan(0);
    relClose(night.moonSky.level * inputs().presets.moonlit.weather.sunRatio * inputs().meanWindowWeight, moon.illuminance * inputs().unitsPerLux);
    relClose(night.setting.weights[0]?.[1] ?? Number.NaN, (inputs().windowWeights[0] ?? 0) * night.moonSky.level * night.moonSky.colour[1]);
    expect(night.shares).toEqual({ day: 0, lamps: 0, moon: 1 });
  });

  it("shares the light among the eye's anchors (R1d)", () => {
    const shares = (name: "sunny" | "night") => {
      const at = londonLocalToUtc(PRESET_DEFAULTS[name].date, PRESET_DEFAULTS[name].minutes);
      const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
      return lightForSky(inputs(), name, sun, moon, lampTargets(PRESET_LAMPS[name], sun.elevation), STEADY_LAMPS).shares;
    };
    expect(shares("sunny").day).toBeGreaterThan(0.999);
    expect(shares("night").lamps).toBeGreaterThan(0.999);
  });

  it("adds the city's light through the windows at night, none by day, and only when asked (R1d)", () => {
    expect([cityLevel(5), cityLevel(0), cityLevel(-6), cityLevel(-20)]).toEqual([0, 0, 1, 1]);
    const city = Array.from({ length: 5 }, (_unused, k) => [0.001 * (k + 1), 0.001 * (k + 1), 0.0012 * (k + 1)] as const);
    const off = { cove: 0, ch_end: 0, ch_centre: 0, dome: 0 };
    const at = londonLocalToUtc(PRESET_DEFAULTS.moonlit.date, PRESET_DEFAULTS.moonlit.minutes);
    const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    const plain = lightForSky(inputs(), "moonlit", sun, moon, off, STEADY_LAMPS);
    const lit = lightForSky(inputs(), "moonlit", sun, moon, off, STEADY_LAMPS, { city, keepMoon: false });
    relClose((lit.setting.weights[2]?.[2] ?? 0) - (plain.setting.weights[2]?.[2] ?? 0), 0.0036);
    expect(lit.shares.moon).toBe(1);
    const morning = londonLocalToUtc(PRESET_DEFAULTS.sunny.date, PRESET_DEFAULTS.sunny.minutes);
    const day = solarPosition(morning, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), dayMoon = moonPosition(morning, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    expect(lightForSky(inputs(), "sunny", day, dayMoon, off, STEADY_LAMPS, { city, keepMoon: false }).setting)
      .toEqual(lightForSky(inputs(), "sunny", day, dayMoon, off, STEADY_LAMPS).setting);
  });
```

In `packages/web/src/stores/__tests__/light-setting-store.test.ts`, replace its first two import lines with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_DEFAULTS, isIsoDate } from "../../lib/light-setting.js";
```

and replace:

```ts
  it("starts at the captured light with relighting off", () => {
    expect(useLightSettingStore.getState().choice.preset).toBe("captured");
    expect(useLightSettingStore.getState().status).toBe("off");
  });

  it("opens a preset at its own date and hour", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    expect(useLightSettingStore.getState().choice).toEqual({ preset: "sunny", ...PRESET_DEFAULTS.sunny });
  });

  it("rounds and bounds the hour", () => {
    useLightSettingStore.getState().setMinutes(2000.7);
    expect(useLightSettingStore.getState().choice.minutes).toBe(1320);
  });
```

with:

```ts
  it("starts live at the real hour, following the clock, lamps automatic, relighting off (R1d)", () => {
    const state = useLightSettingStore.getState();
    expect([state.choice.preset, state.follow, state.lamps, state.status]).toEqual(["live", true, "auto", "off"]);
    expect(isIsoDate(state.choice.date)).toBe(true);
  });

  it("opens a preset at its own date and hour, with its own lamps, not following", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const state = useLightSettingStore.getState();
    expect(state.choice).toEqual({ preset: "sunny", ...PRESET_DEFAULTS.sunny });
    expect([state.follow, state.lamps]).toEqual([false, "off"]);
    useLightSettingStore.getState().selectPreset("night");
    expect(useLightSettingStore.getState().lamps).toBe("on");
  });

  it("rounds and bounds the hour within the whole day, and stops following", () => {
    useLightSettingStore.getState().setMinutes(2000.7);
    expect(useLightSettingStore.getState().choice.minutes).toBe(1439);
    expect(useLightSettingStore.getState().follow).toBe(false);
  });

  it("follows the clock again on Now: a captured choice becomes live, a weather keeps its own (R1d)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T17:30:15Z"));
      useLightSettingStore.getState().selectPreset("captured");
      useLightSettingStore.getState().followClock();
      expect(useLightSettingStore.getState().choice).toEqual({ preset: "live", date: "2026-10-07", minutes: 1110 });
      expect([useLightSettingStore.getState().follow, useLightSettingStore.getState().lamps]).toEqual([true, "auto"]);
      useLightSettingStore.getState().selectPreset("overcast");
      useLightSettingStore.getState().followClock();
      expect(useLightSettingStore.getState().choice).toEqual({ preset: "overcast", date: "2026-10-07", minutes: 1110 });
      expect(useLightSettingStore.getState().lamps).toBe("off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches the lamps (R1d)", () => {
    useLightSettingStore.getState().setLamps("on");
    expect(useLightSettingStore.getState().lamps).toBe("on");
  });
```

In `packages/web/src/components/rooms/__tests__/LightControl.test.tsx`, replace (the list as A7 left it):

```tsx
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["captured", "night", "moonlit", "sunny", "overcast"]);
    expect((screen.getByRole("radio", { name: "As captured" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Time") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(true);
```

with:

```tsx
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["live", "captured", "night", "moonlit", "sunny", "overcast"]);
    expect((screen.getByRole("radio", { name: "Live" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Time") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(false);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-instant.test.ts`
Expected: FAIL — cannot find module `../sky-instant.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/light-setting.test.ts`
Expected: FAIL — `lightForSky`, `dayNumber` and the other new names are not exported.

Run: `pnpm --filter @omnitwin/web exec vitest run src/stores/__tests__/light-setting-store.test.ts`
Expected: FAIL — the store starts at `captured` and has no `follow`.

- [ ] **Step 3: The light setting** — in `packages/web/src/lib/light-setting.ts`:

Replace the kernel import `import { LUMINANCE, capturedSetting, weightedColours, type RelightSetting, type Rgb } from "./relight/relight-kernel.js";` with:

```ts
import { LAMP_GROUPS, LUMINANCE, capturedSetting, smoothstep, weightedColours, type LampGroup, type LampLevels, type RelightSetting, type Rgb } from "./relight/relight-kernel.js";
import { dimmedOutput, dimmedTint, type LampDimming } from "./relight/lamp-dimming.js";
import { normaliseShares, type LightShares } from "./relight/eye.js";
import type { LampDrives } from "./relight/light-motion.js";
```

Replace (A7's) `export const LIGHT_PRESETS = ["captured", "night", "moonlit", "sunny", "overcast"] as const;` with `export const LIGHT_PRESETS = ["live", "captured", "night", "moonlit", "sunny", "overcast"] as const;`, (A4's) `export type WeatherPreset = Exclude<LightPresetId, "captured">;` with `export type WeatherPreset = Exclude<LightPresetId, "captured" | "live">;`, `export const MIN_MINUTES = 360;` with `export const MIN_MINUTES = 0;` and `export const MAX_MINUTES = 1320;` with `export const MAX_MINUTES = 1439;`. In `PRESET_DEFAULTS`, directly before `  captured: { date: "2026-09-29", minutes: 720 },` add:

```ts
  /** Live time's choice is liveChoice(now); this entry is its display anchor, the clear morning's (R1d). */
  live: { date: "2026-05-31", minutes: 540 },
```

in `PRESET_DISPLAY`, directly before `  captured: NEUTRAL_DISPLAY,` add `  live: { exposure: 0.629, whiteBalance: [1.1078, 1, 0.8304] },`; and replace (A1's) `PRESET_EMITTER_BOOST` line with:

```ts
export const PRESET_EMITTER_BOOST: Readonly<Record<LightPresetId, number>> = { live: 1, captured: 1, night: 1, moonlit: 1, sunny: 1, overcast: 1 };
```

Replace the two functions `settingForChoice` and `settingForSky` (both as amendment A4 wrote them) with:

```ts
export function settingForChoice(inputs: LightInputs, choice: LightChoice): ChoiceLight {
  if (choice.preset === "captured") {
    return { setting: capturedSetting(inputs), sun: null, moon: null };
  }
  const instant = londonLocalToUtc(choice.date, choice.minutes);
  const sun = solarPosition(instant, inputs.site.latitude, inputs.site.longitude);
  const moon = moonPosition(instant, inputs.site.latitude, inputs.site.longitude);
  return lightForSky(inputs, weatherOf(choice.preset), sun, moon, lampTargets(PRESET_LAMPS[choice.preset], sun.elevation), STEADY_LAMPS);
}

/** A weather preset's setting for given Sun and Moon positions (A4), its lamps steady at the preset's own (R1d). */
export function settingForSky(inputs: LightInputs, preset: WeatherPreset, sun: SolarPosition, moon: MoonPosition): ChoiceLight {
  return lightForSky(inputs, preset, sun, moon, lampTargets(PRESET_LAMPS[preset], sun.elevation), STEADY_LAMPS);
}

/** How the lamps are run (R1d decision 3): automatic follows the sky; on and off are the switch. */
export type LampMode = "auto" | "on" | "off";
export const LAMP_MODES = ["auto", "on", "off"] as const satisfies readonly LampMode[];
/** Each preset's lamps when it is chosen (every proof scenario's `house` is exactly 1 or 0). */
export const PRESET_LAMPS: Readonly<Record<LightPresetId, LampMode>> = { live: "auto", captured: "on", night: "on", moonlit: "off", sunny: "off", overcast: "off" };
/** Automatic lamps are lit while the Sun is below 7°: about an hour before sunset in Glasgow. */
export const LAMPS_ON_ELEVATION = 7;
/** A Moon fainter than this share of the day's and the lamps' light cannot move a displayed pixel by a tenth of a code. */
export const MOON_NEGLIGIBLE = 1e-5;

export interface LampGroupLight {
  /** How the group fades (lamp-dimming.ts): "warm", the owner's ARTISTIC warm-down, or "led", the lamps' own. */
  readonly dimming: LampDimming;
  /** The group's night gain (the cinematic package, Task 21); ones until calibrated. */
  readonly gain: Rgb;
}

export interface LampLight {
  /** Where the warm-down starts (the cinematic package's `lamps.warmDown.fullCct`); null without the package. */
  readonly warmFullCct: number | null;
  readonly groups: Readonly<Record<LampGroup, LampGroupLight>>;
}

const LED_GROUP: LampGroupLight = { dimming: "led", gain: [1, 1, 1] };
/** Without the cinematic package: no warm-down temperature is known, so every group fades at the bake's colour. */
export const STEADY_LAMPS: LampLight = { warmFullCct: null, groups: { cove: LED_GROUP, ch_end: LED_GROUP, ch_centre: LED_GROUP, dome: LED_GROUP } };

/** What the cinematic light adds to a sky's light (R1d). */
export interface SkyExtras {
  /** Each window's light from the street-lit facade and the skyglow at full night (fit units, W1..W5; Task 15), or null. */
  readonly city: readonly Rgb[] | null;
  /** Keep a Moon too faint to show (Task 23's both-bodies budget only). */
  readonly keepMoon: boolean;
}
export const NO_EXTRAS: SkyExtras = { city: null, keepMoon: false };

/** Street lighting through dusk: none with the Sun above the horizon, all of it from civil dusk (−6°) down. */
export function cityLevel(sunElevation: number): number {
  return 1 - smoothstep(-6, 0, sunElevation);
}

/** A sky's light (R1d): the setting with both bodies, the eye's shares, the sources' summed colour and the moonlit sky. */
export interface SkyLight extends ChoiceLight {
  readonly sun: SolarPosition;
  readonly moon: MoonPosition;
  readonly shares: LightShares;
  readonly colour: Rgb;
  /** The moonlit sky in clear weather, in the sky's units (as skyLevel) and colour; level 0 without the Moon. */
  readonly moonSky: { readonly level: number; readonly colour: Rgb };
  /**
   * How much of R1d's added sheen shows (Task 17): 1 for a computed sky, 0 at the captured light, whose splats and
   * floor already hold the capture's own reflections (spec §4.3: at the captured light the hall looks exactly as
   * captured); a cross-fade carries it between the two.
   */
  readonly sheen: number;
}

/** Live time is the clear weather until R2 brings the real weather. */
export function weatherOf(preset: Exclude<LightPresetId, "captured">): WeatherPreset {
  return preset === "live" ? "sunny" : preset;
}

export function lampsLitFor(sunElevation: number): boolean {
  return sunElevation < LAMPS_ON_ELEVATION;
}

export function lampTargets(mode: LampMode, sunElevation: number): LampDrives {
  const drive = mode === "on" || (mode === "auto" && lampsLitFor(sunElevation)) ? 1 : 0;
  return { cove: drive, ch_end: drive, ch_centre: drive, dome: drive };
}

const times = (rgb: Rgb, scale: number): Rgb => [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];

/**
 * The light of a weather's sky with the Sun and the Moon where they are and each lamp group at its drive (R1d):
 * R1b's sky and Sun exactly (A4), the lamps by their dimming (the artistic warm-down by default) and the night gains, the Moon and its sky in
 * clear weather unless negligible. At drive 1 with gain 1 every lamp weight is the capture's exactly.
 */
export function lightForSky(
  inputs: LightInputs, weather: WeatherPreset, sun: SolarPosition, moon: MoonPosition, drives: LampDrives, lamps: LampLight,
  extras: SkyExtras = NO_EXTRAS,
): SkyLight {
  const model = inputs.presets[weather].weather;
  const reference = skyFactor(model.referenceElevation);
  // The ratio first: exactly 1 at the weather's own hour, so the proof's sky level is reproduced exactly.
  const skyLevel = reference > 0 ? model.referenceSky * (skyFactor(sun.elevation) / reference) : 0;
  const skyShift = cctShift(model.skyCct), sunShift = cctShift(model.sunCct), moonShift = cctShift(MOON_CCT);
  const daylight = inputs.daylightColour;
  const skyColour: Rgb = [daylight[0] * skyShift[0], daylight[1] * skyShift[1], daylight[2] * skyShift[2]];
  const sunUp = model.sunRatio > 0 && sun.elevation > 0;
  const sunStrength = sunUp ? model.sunRatio * skyLevel * inputs.meanWindowWeight : 0;
  const sunRgb: Rgb = [sunStrength * (daylight[0] * sunShift[0]), sunStrength * (daylight[1] * sunShift[1]), sunStrength * (daylight[2] * sunShift[2])];

  const level = (group: LampGroup): number => dimmedOutput(drives[group], lamps.groups[group].dimming);
  const tintOf = (group: LampGroup): Rgb => dimmedTint(drives[group], lamps.groups[group].dimming, lamps.warmFullCct);
  const lampLevels: LampLevels = { cove: level("cove"), ch_end: level("ch_end"), ch_centre: level("ch_centre"), dome: level("dome") };
  const lampTints: Readonly<Record<LampGroup, Rgb>> = { cove: tintOf("cove"), ch_end: tintOf("ch_end"), ch_centre: tintOf("ch_centre"), dome: tintOf("dome") };
  const lampWeight = (captured: Rgb, group: LampGroup): Rgb => {
    const tint = lampTints[group], gain = lamps.groups[group].gain, output = lampLevels[group];
    return [captured[0] * tint[0] * output * gain[0], captured[1] * tint[1] * output * gain[1], captured[2] * tint[2] * output * gain[2]];
  };
  const groupOf = (k: number): LampGroup => {
    const group = LAMP_GROUPS[k - WINDOW_COUNT];
    if (group === undefined) throw new Error(`Source ${String(k)} is not a lamp group.`);
    return group;
  };
  const lampLight = inputs.captureWeights.reduce((sum, captured, k) => (k >= WINDOW_COUNT ? sum + luminanceOf(lampWeight(captured, groupOf(k))) : sum), 0);
  const dayLight = luminanceOf(sunRgb) + skyLevel * inputs.meanWindowWeight * luminanceOf(skyColour);

  // The Moon: direct only in clear weather, like the Sun; dropped where it cannot show.
  const moonColour: Rgb = [daylight[0] * moonShift[0], daylight[1] * moonShift[1], daylight[2] * moonShift[2]];
  const moonUp = model.sunRatio > 0 && moon.elevation > 0 && moon.illuminance > 0;
  const moonStrength = moonUp ? moon.illuminance * inputs.unitsPerLux : 0;
  const moonLight = moonStrength * luminanceOf(moonColour);
  const moonCounts = moonLight > 0 && (extras.keepMoon || moonLight >= MOON_NEGLIGIBLE * (dayLight + lampLight));
  const moonRgb: Rgb = moonCounts ? times(moonColour, moonStrength) : [0, 0, 0];
  // Its sky: the clear sky's relation to its Sun taken backwards, in the sky's colour relative to the Sun's.
  const moonSkyLevel = moonCounts ? moonStrength / (model.sunRatio * inputs.meanWindowWeight) : 0;
  const moonSkyColour: Rgb = [skyColour[0] * moonShift[0] / sunShift[0], skyColour[1] * moonShift[1] / sunShift[1], skyColour[2] * moonShift[2] / sunShift[2]];

  // The city through each window at night (Task 15's weights; none without the cinematic package).
  const city = cityLevel(sun.elevation);
  const cityOf = (k: number): Rgb => {
    const light = extras.city?.[k];
    return light === undefined || city === 0 ? [0, 0, 0] : times(light, city);
  };
  const weights = inputs.captureWeights.map((captured, k): Rgb => {
    if (k >= WINDOW_COUNT) return lampWeight(captured, groupOf(k));
    const weight = inputs.windowWeights[k] ?? 0;
    const street = cityOf(k);
    return [
      weight * skyLevel * skyColour[0] + weight * moonSkyLevel * moonSkyColour[0] + street[0],
      weight * skyLevel * skyColour[1] + weight * moonSkyLevel * moonSkyColour[1] + street[1],
      weight * skyLevel * skyColour[2] + weight * moonSkyLevel * moonSkyColour[2] + street[2],
    ];
  });
  const moonSkyLight = moonSkyLevel * inputs.meanWindowWeight * luminanceOf(moonSkyColour);
  const cityMean = Array.from({ length: WINDOW_COUNT }, (_unused, k) => cityOf(k))
    .reduce<Rgb>((sum, light) => [sum[0] + light[0] / WINDOW_COUNT, sum[1] + light[1] / WINDOW_COUNT, sum[2] + light[2] / WINDOW_COUNT], [0, 0, 0]);
  const cityLight = luminanceOf(cityMean);
  const lampColour = weights.slice(WINDOW_COUNT).reduce<Rgb>((sum, weight) => [sum[0] + weight[0], sum[1] + weight[1], sum[2] + weight[2]], [0, 0, 0]);
  const open = inputs.meanWindowWeight;
  const colourOf = (c: 0 | 1 | 2): number => sunRgb[c] + moonRgb[c] + open * (skyLevel * skyColour[c] + moonSkyLevel * moonSkyColour[c]) + cityMean[c] + lampColour[c];
  return {
    setting: {
      weights, skyLevel, skyColour, sunRgb, moonRgb, lampLevels, lampTints,
      // β is 1 in every preset (amendment A1).
      emitterBoost: 1,
      sunDir: sunUp ? sunDirection(sun, inputs.site) : null,
      moonDir: moonCounts ? sunDirection(moon, inputs.site) : null,
    },
    sun,
    moon,
    // The night's share holds the Moon, its sky and the city: the light of the moonlit-night anchor.
    shares: normaliseShares({ day: dayLight, lamps: lampLight, moon: moonLight + moonSkyLight + cityLight }),
    colour: [colourOf(0), colourOf(1), colourOf(2)],
    moonSky: { level: moonSkyLevel, colour: moonSkyColour },
    sheen: 1,
  };
}

const DAY_MS = 86_400_000;

/** A calendar date's day number (days since 1970-01-01). */
export function dayNumber(date: string): number {
  if (!isIsoDate(date)) throw new RangeError(`${date} is not a calendar date (YYYY-MM-DD).`);
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** London's calendar day and wall-clock minutes, fractional, at an instant. */
export function londonClock(now: Date): { readonly day: number; readonly minutes: number } {
  const local = now.getTime() + londonOffsetHours(now) * 3_600_000;
  const day = Math.floor(local / DAY_MS);
  return { day, minutes: (local - day * DAY_MS) / 60_000 };
}

/** Live time's choice: London's date and minute now. */
export function liveChoice(now: Date): LightChoice {
  const { day, minutes } = londonClock(now);
  return { preset: "live", date: dateOfDay(day), minutes: Math.floor(minutes) };
}
```

`luminanceOf` is R1b's module-level arrow (defined further down the file, before `adaptDisplay`); it is only called at run time, after the module has loaded. `MOON_CCT`, `moonPosition`, `MoonPosition`, `cctShift`, `skyFactor`, `solarPosition`, `sunDirection` and `WINDOW_COUNT` are already imported (R1b and A4).

- [ ] **Step 4: The sky at an instant** — create `packages/web/src/lib/relight/sky-instant.ts`:

```ts
import { dateOfDay, londonLocalToUtc } from "../light-setting.js";
import { moonPosition, type MoonPosition } from "../moon.js";
import { solarPosition, type SolarPosition } from "../sun.js";
import type { MotionInstant } from "./light-motion.js";

/** The Sun and the Moon at a displayed instant (T-639 R1d): computed for that instant, every frame of a time-lapse. */
export interface SkyAt {
  readonly utc: Date;
  readonly sun: SolarPosition;
  readonly moon: MoonPosition;
}

/** The instant of a London day and fractional wall-clock minute (in October's repeated hour, the first). */
export function instantOf(at: MotionInstant): Date {
  const whole = Math.floor(at.minutes);
  return new Date(londonLocalToUtc(dateOfDay(at.day), whole).getTime() + (at.minutes - whole) * 60_000);
}

export function skyAt(at: MotionInstant, latitude: number, longitude: number): SkyAt {
  const utc = instantOf(at);
  return { utc, sun: solarPosition(utc, latitude, longitude), moon: moonPosition(utc, latitude, longitude) };
}
```

- [ ] **Step 5: The store** — in `packages/web/src/stores/light-setting-store.ts`, replace `import { clampMinutes, defaultChoice, isIsoDate, type LightChoice, type LightPresetId } from "../lib/light-setting.js";` with:

```ts
import {
  PRESET_LAMPS, clampMinutes, defaultChoice, isIsoDate, liveChoice, type LampMode, type LightChoice, type LightPresetId,
} from "../lib/light-setting.js";
```

directly after `  readonly choice: LightChoice;` add:

```ts
  /** The clock follows London's real time (live time, or "Now" in another weather). */
  readonly follow: boolean;
  /** The lamps switch (R1d decision 3). */
  readonly lamps: LampMode;
```

directly after `  readonly setStatus: (status: RelightStatus) => void;` add:

```ts
  readonly setLamps: (lamps: LampMode) => void;
  /** "Now": the clock follows real time again; the captured light becomes live time. */
  readonly followClock: () => void;
```

and replace the five lines

```ts
  choice: defaultChoice(),
  status: "off",
  selectPreset: (preset) => { set({ choice: defaultChoice(preset) }); },
  setMinutes: (minutes) => { set((state) => ({ choice: { ...state.choice, minutes: clampMinutes(minutes) } })); },
  setDate: (date) => { if (isIsoDate(date)) set((state) => ({ choice: { ...state.choice, date } })); },
```

with:

```ts
  choice: liveChoice(new Date()),
  follow: true,
  lamps: "auto",
  status: "off",
  selectPreset: (preset) => {
    set(preset === "live"
      ? { choice: liveChoice(new Date()), follow: true, lamps: "auto" }
      : { choice: defaultChoice(preset), follow: false, lamps: PRESET_LAMPS[preset] });
  },
  setMinutes: (minutes) => { set((state) => ({ choice: { ...state.choice, minutes: clampMinutes(minutes) }, follow: false })); },
  setDate: (date) => { if (isIsoDate(date)) set((state) => ({ choice: { ...state.choice, date }, follow: false })); },
  setLamps: (lamps) => { set({ lamps }); },
  followClock: () => {
    set((state) => {
      const now = liveChoice(new Date());
      return state.choice.preset === "captured"
        ? { choice: now, follow: true, lamps: "auto" }
        : { choice: { ...now, preset: state.choice.preset }, follow: true };
    });
  },
```

(R1c's `hiddenToggles` and `setToggleHidden` are untouched.)

- [ ] **Step 6: The control's label** — in `packages/web/src/components/rooms/LightControl.tsx`, in `LABELS`, directly before `  captured: "As captured",` add `  live: "Live",`.

- [ ] **Step 7: Run the tests, and the R1b tests that read the store's default**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-instant.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/light-setting.test.ts`
Expected: PASS, the Task 0 count plus 9. The two vector tests (night and sunny morning) must pass unchanged: they prove that `lightForSky` reproduces R1b's settings; if one fails, report the field and the difference and stop (the vectors are R1a's construction, never adjusted).

Run: `pnpm --filter @omnitwin/web exec vitest run src/stores/__tests__/light-setting-store.test.ts`
Expected: PASS, the Task 0 count plus 2.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl.test.tsx`
Expected: PASS, the Task 0 count.

Then, one per command: `src/lib/relight/__tests__/relight-apply.test.ts`, `src/components/scene/__tests__/RelightProvider.test.tsx`, `src/lib/relight/__tests__/relight-debug.test.ts`, `src/components/rooms/__tests__/RoomSplatScene.test.tsx`. Where one fails because it assumed the store starts at the captured light, add `useLightSettingStore.getState().selectPreset("captured");` at the start of that file's `beforeEach` (after any reset to the initial state; import the store if the file does not) and rerun it; any other failure is a regression: stop and report it.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors. A `Record<LightPresetId, …>` elsewhere in the package without `live` is reported here: give it a `live` entry equal to its `sunny` entry.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/light-setting.ts src/lib/relight/sky-instant.ts src/stores/light-setting-store.ts src/components/rooms/LightControl.tsx`
Expected: no problems.

- [ ] **Step 9: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/light-setting.ts packages/web/src/lib/relight/sky-instant.ts packages/web/src/stores/light-setting-store.ts packages/web/src/components/rooms/LightControl.tsx packages/web/src/lib/relight/__tests__/sky-instant.test.ts packages/web/src/lib/__tests__/light-setting.test.ts packages/web/src/stores/__tests__/light-setting-store.test.ts packages/web/src/components/rooms/__tests__/LightControl.test.tsx && git status --short packages/web/src && git diff --cached --stat
```

If Step 7 or 8 changed other files (a test's `beforeEach`, another `Record`'s `live` entry), add each one by its path, inspect the staged diff, then:

```bash
cd D:/claude/real-hall/repo && git commit -m "feat(relight): live time, the whole day, the lamps switch and both sky bodies at any instant (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The kernel's new terms: glow hiding, the bodies' interior shadow hook, the pass stride, the active draw first

**Files:**
- Modify: `packages/web/src/lib/relight/relight-kernel.ts`, `packages/web/src/lib/relight/relight-frame.ts`, `packages/web/src/lib/relight/relight-draw.ts`, `packages/web/src/lib/native-splat-scene.ts`
- Test: `packages/web/src/lib/relight/__tests__/relight-kernel.test.ts`, `packages/web/src/lib/relight/__tests__/relight-frame.test.ts`, `packages/web/src/lib/relight/__tests__/relight-draw.test.ts`, `packages/web/src/lib/__tests__/native-splat-scene.test.ts`

**Interfaces:**
- Consumes: R1b's kernel, frame, draw and host as amended (A1, A2, A5, A9; R1c's A2 visibility: `relightSplat(model, frame, record, position, colour, visibility?)` and the pass's `alpha`); three's TSL `Loop`, `bool`, `float`, `If`, `uniform`, `uniformArray`.
- Produces (`relight-kernel.ts`): `CHANDELIER_COUNT = 5`; `interface GlowChandelier { readonly centre: Vec3; readonly crisp: boolean }`; `interface KernelCinematic { readonly glow: readonly GlowChandelier[]; readonly interiorShadow: ((position: Vec3, body: "sun" | "moon") => number) | null }`; `NO_CINEMATIC`; `glowHidden(glow: readonly GlowChandelier[], position: Vec3): boolean`; `relightSplat(…, visibility?, cinematic: KernelCinematic = NO_CINEMATIC)`.
- Produces (`relight-frame.ts`): `type InteriorShadowHook = (position: Node<"vec3">, body: "sun" | "moon") => Node<"float">`; `NO_INTERIOR_SHADOW`; uniforms `chandeliers` (vec4 × 5: x, y, z of the centre, 1 when crisp else 0), `passStride` and `passPhase` (uint); `RelightFrame.shadowHook: InteriorShadowHook | null` (a getter), `kernelCinematic: KernelCinematic`, `passStride: number`; methods `setGlow(glow: readonly GlowChandelier[]): void`, `setShadowHook(hook: InteriorShadowHook | null, cpu: KernelCinematic["interiorShadow"]): void`, `setPassStride(stride: number, phase: number): void`, `onPassStride(listener: (stride: number, phase: number) => void): () => void`, `setDisplay(display: DisplayParams): void`.
- Produces (`relight-draw.ts`): the pass reads splat `instanceIndex × passStride + passPhase`, dispatched as `ceil(count / passStride)` invocations; it multiplies each body's direct term by the frame's interior shadow hook and hides the glow splats of chandeliers with crisp lamps; a draw rebuilds its pass once when the frame's hook changes.
- Produces (`native-splat-scene.ts`): `runRelight(options?: { readonly activeOnly?: boolean }): void` (the frame's own passes, then the active draw only, marking the others stale; without the option, every cached draw); a stale draw reruns its pass when it is activated.

Decision 1's rule, in the kernel and its CPU twin: a splat of class 3 (the chandelier emitter class, which the frontier splats study measured as the capture's glow, 48–59% of each chandelier's splats) is drawn with alpha 0 when its nearest chandelier, by horizontal distance to the five centres, has crisp lamps, and only while the crisp lamps are drawn (Task 11 sets the chandeliers and clears them when it unmounts). A record carries the class but no chandelier id, and the chandeliers stand at least 5 m apart while each one's glow lies within 1 m of its axis, so the nearest centre is unambiguous. Nothing else is hidden: class 4 (the dome's crests, lit by LED pin spots) and every other splat keep R1b's rule with β = 1. The five centres are a uniform array (5 × 16 bytes): the multiplier pass already binds seven of WebGPU's default eight storage buffers per stage (R1b Task 11), so a storage buffer is not available, and only class-3 splats (about 195,000 of the hall's six million) enter the five-step loop.

The interior shadow (Task 10 provides it) multiplies each body's direct term after the window march: in the pass, in the floor's and the skins' materials (Tasks 10 and 17) and in the CPU twin, so the GPU and the DEV checks agree. It is built into each draw's pass, so a draw rebuilds its pass once when the hook is set or cleared (on its first run after the change), never per frame. A hook of 1 everywhere leaves every multiplier unchanged bit for bit (`visibility × 1 × cosine` is `visibility × cosine` in IEEE arithmetic), so R1a's vectors still pass.

The stride (decision 7): `passStride` s and `passPhase` p make the pass handle splats p, p + s, p + 2s, …, dispatched as `ceil(count / s)` invocations (three's `renderer.compute(node, count)`). The default is 1 and 0 (every splat); the director (Task 9) uses another stride only if Task 23's measurement needs it, and returns to 1 for one full pass when the light settles. R1c's skin passes follow through `onPassStride` (the R1c interface, item 3). `runRelight({ activeOnly: true })` is what the director calls while the light moves: the frame's own passes, then only the draw on screen; every other cached draw is marked stale and reruns its pass when it is next activated, so a draw is never shown at an old light.

`setDisplay` writes the display uniforms without reapplying the light: the eye changes every frame while it adapts, and moving it must not rerun a pass.

Verified (7 October): R1b plan lines 2041–2086 (`RelightKernelModel`, `RelightSetting`, `KernelFrame`, `SplatMultiplier { m, alpha }`), 2197–2257 (`relightSplat`: the sun block `const { visibility } = sunVisibility(model.windows, windowSun, position);` and its `for` line, `const luminance = dot(colour, LUMINANCE);`, the final `return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha: … }`), 1295–1345 (the kernel test's `syntheticModel`, `record`, `CENTRE`, `GREY`, `testWindow`, `RECT`), 1412–1425 (the gating test's open window and sun `[0, -0.8, 0.6]` that light `[1.5, 1, 1.5]`), 4870–4975 (`RelightFrame`: `private readonly listeners`, `apply`'s `for (const listener of this.listeners) listener();`, `u.display.exposure`/`whiteBalance`), 4604 (`Vector4` imported from `three`), 5062–5140 (the draw's tests: `geometry(count)`, `vi.spyOn(renderer, "compute")`), 5261–5395 (`createRelightDraw`: `const i = instanceIndex;`, `const pass = Fn(() => {`, `})().compute(count, [WORKGROUP]).setName("RelightMultiplier");`, `const luminance = dot(colour, vec3(...LUMINANCE)).toVar();`, the `wordsWrite.element(i).assign(…bitOr(alpha.shiftLeft(24)))` line, `run`'s `void renderer.compute(pass);`, `dispose`'s `pass.dispose();`), 5440–5590 (the host's relit tests: `setup(automaticSort, relightSupported)`, `state.compute`), 5740–5760 (`runRelight`); amendment A1 (`lampTints`), A5 (the moon blocks); `packages/web/src/lib/native-splat-scene.ts:36` (`interface Snapshot`), `:87` (`snapshots`), `:552-564` (`private activate(snapshot: Snapshot)`), `__tests__/native-splat-scene.test.ts:480-501` (motion and detail draws cached together, `state.runtime.frame(n)`); three 0.186: `src/nodes/core/UniformNode.js:241` (`uniform(value, type)`), `src/nodes/accessors/UniformArrayNode.js:375` (`uniformArray`), `src/nodes/utils/LoopNode.js:346,364` (`Loop`, `Break`; the object form's loop variable is `i`, as `@types/three` `src/nodes/utils/LoopNode.d.ts` types it), `src/nodes/tsl/TSLCore.js:1216` (`bool`), `src/nodes/math/MathNode.js:1035,1196` (`lengthSq`), `src/renderers/common/Renderer.js:2877` and `@types/three` `src/renderers/common/Renderer.d.ts:975-978` (`compute(computeNodes, dispatchSize?: number | number[] | IndirectStorageBufferAttribute)`), `src/renderers/webgpu/WebGPUBackend.js:1915-1945` (a number is an invocation count, divided into workgroups).

- [ ] **Step 1: Find the anchors** (each command must print at least one line; where R1c reformatted a line, apply the step to its equivalent and say so in the task report)

```bash
cd D:/claude/real-hall/repo/packages/web/src/lib && grep -n "visibility \* cosine \* channel(frame.setting.sunRgb, c)\|visibility \* cosine \* channel(frame.setting.moonRgb, c)\|  return { m: \[at(m, 0), at(m, 1), at(m, 2)\], alpha" relight/relight-kernel.ts
grep -n "    const i = instanceIndex;\|  const pass = Fn(() => {\|setName(\"RelightMultiplier\")\|e.addAssign(u.sunRgb.mul(visibility.mul(cosine)));\|e.addAssign(u.moonRgb.mul(visibility.mul(cosine)));\|bitOr(alpha.shiftLeft(24))\|void renderer.compute(pass);" relight/relight-draw.ts
grep -n "    lampTints: uniformArray<\"vec3\">(lampTints, \"vec3\"),\|  private readonly listeners = new Set<() => void>();\|  onApply(listener: () => void): () => void {" relight/relight-frame.ts
grep -n "  runRelight(): void {\|  private activate(snapshot: Snapshot): void {" native-splat-scene.ts
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/web/src/lib/relight/__tests__/relight-kernel.test.ts`, inside its last `describe`, before the closing `});` (add `CHANDELIER_COUNT`, `NO_CINEMATIC`, `glowHidden`, `type GlowChandelier` and `type KernelCinematic` to its import from `../relight-kernel.js`, and `CLASS_DOME_EMITTER` to its import from `../relight-codec.js`, where absent):

```ts
  it("hides a chandelier's glow splats while its crisp lamps draw, and nothing else (R1d)", () => {
    const model = syntheticModel();
    const frame = prepareKernelFrame(model, capturedSetting(model));
    const glowing: [number, number, number] = [0.6, 0.6, 0.6];
    const glow: GlowChandelier[] = [{ centre: [0.5, 0.5, 2], crisp: true }, { centre: [5, 0.5, 2], crisp: false }];
    const cinematic: KernelCinematic = { glow, interiorShadow: null };
    expect(relightSplat(model, frame, record(CLASS_CH_EMITTER), CENTRE, glowing, undefined, cinematic).alpha).toBe(0);
    expect(relightSplat(model, frame, record(CLASS_CH_EMITTER), [4.9, 0.5, 0.5], glowing, undefined, cinematic).alpha).toBe(1);
    expect(relightSplat(model, frame, record(CLASS_DOME_EMITTER), CENTRE, glowing, undefined, cinematic).alpha).toBe(1);
    expect(relightSplat(model, frame, record(0), CENTRE, glowing, undefined, cinematic).alpha).toBe(1);
    expect(relightSplat(model, frame, record(CLASS_CH_EMITTER), CENTRE, glowing).alpha).toBe(1);
    expect([glowHidden(glow, [2.7, 0, 0]), glowHidden(glow, [2.8, 0, 0]), glowHidden([], [0, 0, 0])]).toEqual([true, false, false]);
    expect(CHANDELIER_COUNT).toBe(5);
  });

  it("scales each body's direct light by the interior shadow, and changes nothing at 1 (R1d)", () => {
    const area: SunAreaTable = { azimuth0: 0, elevation0: -90, columns: 361, rows: 181, value: () => 2 };
    const sun: Vec3 = [0, -0.8, 0.6];
    const model = syntheticModel([testWindow(RECT, () => 0, 0)], area);
    const at = (setting: RelightSetting, shadow: number, bodies: string[]): number => {
      const cinematic: KernelCinematic = { glow: [], interiorShadow: (_p, body) => { bodies.push(body); return shadow; } };
      return relightSplat(model, prepareKernelFrame(model, setting), record(FLAG_SUN), [1.5, 1, 1.5], GREY, undefined, cinematic).m[0];
    };
    for (const body of ["sun", "moon"] as const) {
      const base = capturedSetting(model);
      const setting: RelightSetting = body === "sun" ? { ...base, sunDir: sun, sunRgb: [2, 2, 2] } : { ...base, moonDir: sun, moonRgb: [2, 2, 2] };
      const seen: string[] = [];
      const plain = relightSplat(model, prepareKernelFrame(model, setting), record(FLAG_SUN), [1.5, 1, 1.5], GREY, undefined, NO_CINEMATIC).m[0];
      expect(at(setting, 1, seen)).toBe(plain);
      const dark = at(setting, 0, seen), half = at(setting, 0.5, seen);
      expect(plain).toBeGreaterThan(dark);
      expect(half - dark).toBeCloseTo((plain - dark) / 2, 9);
      expect(new Set(seen)).toEqual(new Set([body]));
    }
  });
```

Append to `packages/web/src/lib/relight/__tests__/relight-frame.test.ts`, inside its `describe`, before the closing `});` (import `float` from `three/tsl`, `CHANDELIER_COUNT` from `../relight-kernel.js` and `type InteriorShadowHook` from `../relight-frame.js`):

```ts
  it("holds the chandeliers for the glow hiding and reruns the draws when they change (R1d)", () => {
    const frame = new RelightFrame(data);
    const listener = vi.fn();
    frame.onApply(listener);
    frame.setGlow([{ centre: [1, 2, 3], crisp: true }, { centre: [4, 5, 6], crisp: false }]);
    expect(frame.uniforms.values.chandeliers[0]?.toArray()).toEqual([1, 2, 3, 1]);
    expect(frame.uniforms.values.chandeliers[1]?.toArray()).toEqual([4, 5, 6, 0]);
    expect(frame.kernelCinematic.glow).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(1);
    const tooMany = Array.from({ length: CHANDELIER_COUNT + 1 }, () => ({ centre: [0, 0, 0] as const, crisp: false }));
    expect(() => { frame.setGlow(tooMany); }).toThrow(RangeError);
    frame.setGlow([]);
    expect(frame.uniforms.values.chandeliers.every((entry) => entry.w === 0)).toBe(true);
    expect(frame.kernelCinematic.glow).toEqual([]);
  });

  it("keeps the interior shadow hook and the pass stride, and tells the stride's listeners (R1d)", () => {
    const frame = new RelightFrame(data);
    const applied = vi.fn(), strided = vi.fn();
    frame.onApply(applied);
    frame.onPassStride(strided);
    const hook: InteriorShadowHook = () => float(0.5);
    const cpu = (): number => 0.5;
    frame.setShadowHook(hook, cpu);
    expect(frame.shadowHook).toBe(hook);
    expect(frame.kernelCinematic.interiorShadow).toBe(cpu);
    expect(applied).toHaveBeenCalledTimes(1);
    frame.setPassStride(2, 3);
    expect([frame.passStride, frame.uniforms.passStride.value, frame.uniforms.passPhase.value]).toEqual([2, 2, 1]);
    expect(strided).toHaveBeenLastCalledWith(2, 1);
    frame.setPassStride(0, 0);
    expect([frame.passStride, frame.uniforms.passPhase.value]).toEqual([1, 0]);
  });

  it("sets the display without reapplying the light (R1d)", () => {
    const frame = new RelightFrame(data);
    const listener = vi.fn();
    frame.onApply(listener);
    frame.setDisplay({ exposure: 2, whiteBalance: [1.1, 1, 0.9] });
    expect(frame.uniforms.display.exposure.value).toBe(2);
    expect(frame.uniforms.display.whiteBalance.value.toArray()).toEqual([1.1, 1, 0.9]);
    expect(listener).not.toHaveBeenCalled();
  });
```

Append to `packages/web/src/lib/relight/__tests__/relight-draw.test.ts`, inside its `describe`, before the closing `});` (import `float` from `three/tsl`):

```ts
  it("dispatches only its stride's share of the splats (R1d)", () => {
    const draw = createRelightDraw(frame, geometry(5), mergeRelightRecords([{ count: 5, records: null }]), new Matrix4());
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    draw.run(renderer);
    expect(compute.mock.calls.at(-1)?.[1]).toBe(5);
    frame.setPassStride(2, 1);
    draw.run(renderer);
    expect(compute.mock.calls.at(-1)?.[1]).toBe(3);
    draw.dispose();
  });

  it("rebuilds its pass once when the interior shadow hook changes (R1d)", () => {
    const draw = createRelightDraw(frame, geometry(3), mergeRelightRecords([{ count: 3, records: null }]), new Matrix4());
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    draw.run(renderer);
    const first = compute.mock.calls.at(-1)?.[0];
    draw.run(renderer);
    expect(compute.mock.calls.at(-1)?.[0]).toBe(first);
    frame.setShadowHook(() => float(1), () => 1);
    draw.run(renderer);
    const second = compute.mock.calls.at(-1)?.[0];
    expect(second).not.toBe(first);
    draw.run(renderer);
    expect(compute.mock.calls.at(-1)?.[0]).toBe(second);
    draw.dispose();
  });
```

Append to `packages/web/src/lib/__tests__/native-splat-scene.test.ts`, inside `describe("relit native draws (T-639 R1b)", …)`, before its closing `});`:

```ts
  it("reruns only the active draw while the light moves, and a stale draw when it is shown again (R1d)", async () => {
    const state = setup(true, true);
    let motion = false;
    state.add(1);
    state.add(2, () => (motion ? 1 : 0), "motion");
    state.add(5, () => (motion ? 0 : 1), "detail");
    state.runtime.setRelight({}, frame);
    await vi.advanceTimersByTimeAsync(100);
    motion = true; state.runtime.frame(1); await vi.advanceTimersByTimeAsync(100);
    motion = false; state.runtime.frame(2); await vi.advanceTimersByTimeAsync(100);
    // A draw's pass is one compute node; the frame's own passes are one call with an array.
    const passes = (): number => state.compute.mock.calls.filter(([node]) => !Array.isArray(node)).length;
    const start = passes();
    state.runtime.runRelight({ activeOnly: true });
    expect(passes()).toBe(start + 1);
    motion = true; state.runtime.frame(3);
    expect(passes()).toBe(start + 2);
    motion = false; state.runtime.frame(4);
    expect(passes()).toBe(start + 2);
    state.runtime.runRelight();
    expect(passes()).toBe(start + 4);
  });
```

- [ ] **Step 3: Run them to see them fail**

Run each, one per command (`pnpm --filter @omnitwin/web exec vitest run <path>`): `src/lib/relight/__tests__/relight-kernel.test.ts`, `src/lib/relight/__tests__/relight-frame.test.ts`, `src/lib/relight/__tests__/relight-draw.test.ts`, `src/lib/__tests__/native-splat-scene.test.ts`.
Expected: each FAILS on its new tests (`glowHidden`, `setGlow`, `setPassStride` and `runRelight({ activeOnly })` do not exist; the pass is dispatched without a count).

- [ ] **Step 4: The kernel** — in `packages/web/src/lib/relight/relight-kernel.ts`, directly after `export type LampLevels = Readonly<Record<LampGroup, number>>;` add:

```ts
/** R1d decision 1: the hall's five chandeliers, whose glow splats (class 3) are hidden while their crisp lamps draw. */
export const CHANDELIER_COUNT = 5;
export interface GlowChandelier {
  /** The chandelier's centre (the proof's), model frame. */
  readonly centre: Vec3;
  /** True while crisp lamps are drawn for it. */
  readonly crisp: boolean;
}
/** R1d's kernel terms (Task 7): the chandeliers' glow hiding, and the interior shadow's CPU twin per sky body (1 lit). */
export interface KernelCinematic {
  readonly glow: readonly GlowChandelier[];
  readonly interiorShadow: ((position: Vec3, body: "sun" | "moon") => number) | null;
}
export const NO_CINEMATIC: KernelCinematic = { glow: [], interiorShadow: null };

/** Whether the chandelier nearest a point (horizontally; a record carries no chandelier id) has crisp lamps. */
export function glowHidden(glow: readonly GlowChandelier[], position: Vec3): boolean {
  let nearest = Number.POSITIVE_INFINITY;
  let crisp = false;
  for (const chandelier of glow) {
    const dx = position[0] - chandelier.centre[0], dy = position[1] - chandelier.centre[1];
    const distance = dx * dx + dy * dy;
    if (distance < nearest) {
      nearest = distance;
      crisp = chandelier.crisp;
    }
  }
  return crisp;
}
```

Give `relightSplat` a last parameter: after R1c's `visibility` parameter add `, cinematic: KernelCinematic = NO_CINEMATIC` (the signature then ends `…, colour: Rgb, visibility…, cinematic: KernelCinematic = NO_CINEMATIC): SplatMultiplier {`, keeping R1c's own form of `visibility`). Replace the Sun's line

```ts
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + visibility * cosine * channel(frame.setting.sunRgb, c);
```

with:

```ts
    // R1d: the interior occluders' shadow (the CPU twin of Task 10's map); 1 keeps the product bit for bit.
    const shadow = cinematic.interiorShadow?.(position, "sun") ?? 1;
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + visibility * shadow * cosine * channel(frame.setting.sunRgb, c);
```

and the Moon's (A5's) line

```ts
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + visibility * cosine * channel(frame.setting.moonRgb, c);
```

with:

```ts
    const shadow = cinematic.interiorShadow?.(position, "moon") ?? 1;
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + visibility * shadow * cosine * channel(frame.setting.moonRgb, c);
```

Directly before the function's final line, the one that begins `  return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha`, add:

```ts
  // R1d decision 1: a chandelier's glow splat is hidden while that chandelier's crisp lamps are drawn.
  if (cls === CLASS_CH_EMITTER && glowHidden(cinematic.glow, position)) {
    return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha: 0 };
  }
```

- [ ] **Step 5: The frame** — in `packages/web/src/lib/relight/relight-frame.ts`, add `CHANDELIER_COUNT`, `NO_CINEMATIC`, `type GlowChandelier` and `type KernelCinematic` to the import from `./relight-kernel.js`. In `createRelightUniforms`, directly after A1's `const lampTints = [...]` line add:

```ts
  const chandeliers = Array.from({ length: CHANDELIER_COUNT }, () => new Vector4(0, 0, 0, 0));
```

add `chandeliers` to the `values` object (after A5's `moonOpen`), and directly after A1's `    lampTints: uniformArray<"vec3">(lampTints, "vec3"),` add:

```ts
    /** R1d Task 7: the chandeliers' centres (model frame) and w = 1 for each whose crisp lamps draw (its glow hidden). */
    chandeliers: uniformArray<"vec4">(chandeliers, "vec4"),
    /** R1d Task 7: the multiplier pass handles splats phase, phase + stride, … (1 and 0: every splat). */
    passStride: uniform(1, "uint"),
    passPhase: uniform(0, "uint"),
```

Directly after `export type RelightUniforms = ReturnType<typeof createRelightUniforms>;` and A5's `skyBody` that follows it, add:

```ts
/** R1d Task 7: each sky body's interior shadow at a model-frame point (1 lit, 0 shadowed), built into each pass. */
export type InteriorShadowHook = (position: Node<"vec3">, body: "sun" | "moon") => Node<"float">;
export const NO_INTERIOR_SHADOW: InteriorShadowHook = () => float(1);
```

In `class RelightFrame`, directly after `  private readonly listeners = new Set<() => void>();` add:

```ts
  /** R1d Task 7: the CPU twin's cinematic terms (the DEV checks pass them to relightSplat). */
  kernelCinematic: KernelCinematic = NO_CINEMATIC;
  /** R1d Task 7: the multiplier passes' stride (1: every splat). */
  passStride = 1;
  private shadowHookValue: InteriorShadowHook | null = null;
  private readonly strideListeners = new Set<(stride: number, phase: number) => void>();
```

and directly before `  onApply(listener: () => void): () => void {` add:

```ts
  /** The interior shadow every multiplier pass multiplies each body's direct light by (R1d Task 10), or null. */
  get shadowHook(): InteriorShadowHook | null {
    return this.shadowHookValue;
  }

  /** The chandeliers whose glow is hidden while their crisp lamps draw (R1d Task 11); [] when none draw. Every draw reruns its pass. */
  setGlow(glow: readonly GlowChandelier[]): void {
    if (glow.length > CHANDELIER_COUNT) throw new RangeError(`At most ${String(CHANDELIER_COUNT)} chandeliers, not ${String(glow.length)}.`);
    const slots = this.uniforms.values.chandeliers;
    slots.forEach((slot, index) => {
      const chandelier = glow[index];
      if (chandelier === undefined) slot.set(0, 0, 0, 0);
      else slot.set(chandelier.centre[0], chandelier.centre[1], chandelier.centre[2], chandelier.crisp ? 1 : 0);
    });
    this.kernelCinematic = { ...this.kernelCinematic, glow };
    for (const listener of this.listeners) listener();
  }

  /** The interior shadow hook and its CPU twin (R1d Task 10), or null. Every draw rebuilds its pass on its next run. */
  setShadowHook(hook: InteriorShadowHook | null, cpu: KernelCinematic["interiorShadow"]): void {
    this.shadowHookValue = hook;
    this.kernelCinematic = { ...this.kernelCinematic, interiorShadow: cpu };
    for (const listener of this.listeners) listener();
  }

  /** The passes handle splats phase, phase + stride, …; stride at least 1, phase within it (R1d decision 7). */
  setPassStride(stride: number, phase: number): void {
    const s = Math.max(1, Math.floor(Number.isFinite(stride) ? stride : 1));
    const p = ((Math.floor(Number.isFinite(phase) ? phase : 0) % s) + s) % s;
    this.passStride = s;
    this.uniforms.passStride.value = s;
    this.uniforms.passPhase.value = p;
    for (const listener of this.strideListeners) listener(s, p);
  }

  onPassStride(listener: (stride: number, phase: number) => void): () => void {
    this.strideListeners.add(listener);
    return () => { this.strideListeners.delete(listener); };
  }

  /** The eye's display, every frame while it adapts, without reapplying the light (R1d). */
  setDisplay(display: DisplayParams): void {
    this.uniforms.display.exposure.value = display.exposure;
    this.uniforms.display.whiteBalance.value.set(display.whiteBalance[0], display.whiteBalance[1], display.whiteBalance[2]);
  }
```

In `dispose`, directly after `    this.listeners.clear();` add `    this.strideListeners.clear();`.

- [ ] **Step 6: The pass** — in `packages/web/src/lib/relight/relight-draw.ts`, add `bool`, `float` and `Loop` to the `three/tsl` import and `type ComputeNode` to the `three/webgpu` import where absent; import `CHANDELIER_COUNT` from `./relight-kernel.js` and `CLASS_CH_EMITTER` from `./relight-codec.js` where absent; and add `NO_INTERIOR_SHADOW` and `type InteriorShadowHook` to the import from `./relight-frame.js`. Then:

Replace `  const pass = Fn(() => {` with `  const buildPass = (interior: InteriorShadowHook): ComputeNode => Fn(() => {`, and `  })().compute(count, [WORKGROUP]).setName("RelightMultiplier");` with:

```ts
  })().compute(count, [WORKGROUP]).setName("RelightMultiplier");
  // R1d: the pass carries the frame's interior shadow hook; it is rebuilt once when the hook changes.
  let builtFor = frame.shadowHook;
  let pass = buildPass(builtFor ?? NO_INTERIOR_SHADOW);
```

Replace `    const i = instanceIndex;` with:

```ts
    // R1d decision 7: splats phase, phase + stride, … (stride 1: every splat).
    const i = instanceIndex.mul(u.passStride).add(u.passPhase).toVar();
```

Replace the Sun's `      e.addAssign(u.sunRgb.mul(visibility.mul(cosine)));` with `      e.addAssign(u.sunRgb.mul(visibility.mul(interior(p, "sun")).mul(cosine)));` and the Moon's (A5's) `      e.addAssign(u.moonRgb.mul(visibility.mul(cosine)));` with `      e.addAssign(u.moonRgb.mul(visibility.mul(interior(p, "moon")).mul(cosine)));`.

Directly before the line that begins `    wordsWrite.element(i).assign(encodeMultiplier(m.x)` add:

```ts
    // R1d decision 1: a chandelier's glow splat (class 3) is hidden while that chandelier's crisp lamps draw; the
    // chandelier is the nearest centre, horizontally (a record carries no chandelier id).
    const hiddenGlow = bool(false).toVar();
    If(cls.equal(CLASS_CH_EMITTER), () => {
      const nearest = float(1e30).toVar();
      Loop({ start: uint(0), end: uint(CHANDELIER_COUNT), type: "uint", condition: "<" }, ({ i: index }) => {
        const chandelier = u.chandeliers.element(index);
        const distance = p.xy.sub(chandelier.xy).lengthSq();
        If(distance.lessThan(nearest), () => {
          nearest.assign(distance);
          hiddenGlow.assign(chandelier.w.greaterThan(0.5));
        });
      });
    });
```

and in that `wordsWrite` line replace `.bitOr(alpha.shiftLeft(24))` with `.bitOr(select(hiddenGlow, uint(0), alpha).shiftLeft(24))`. In `run`, replace `        void renderer.compute(pass);` with:

```ts
        if (frame.shadowHook !== builtFor) {
          // The cinematic light set or cleared the interior shadow: build the pass with it once.
          pass.dispose();
          builtFor = frame.shadowHook;
          pass = buildPass(builtFor ?? NO_INTERIOR_SHADOW);
        }
        void renderer.compute(pass, Math.ceil(count / frame.passStride));
```

(`dispose`'s `pass.dispose();` now disposes whichever pass is current.)

- [ ] **Step 7: The host** — in `packages/web/src/lib/native-splat-scene.ts`, directly after `  private readonly snapshots = new Map<string, Snapshot>();` add:

```ts
  /** R1d: relit draws whose pass missed a light change while another draw was on screen. */
  private readonly staleRelight = new WeakSet<Snapshot>();
```

replace R1b's `runRelight` with:

```ts
  /**
   * After RelightFrame.apply: the frame's own passes, then the relit draws. While the light moves (R1d, activeOnly)
   * only the draw on screen reruns; every other cached draw is marked stale and reruns when it is next shown.
   */
  runRelight(options: { readonly activeOnly?: boolean } = {}): void {
    const renderer = this.renderer;
    if (renderer === null) return;
    this.relightFrame?.prepare(renderer);
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.relight === null) continue;
      if (options.activeOnly === true && snapshot !== this.active) {
        this.staleRelight.add(snapshot);
        continue;
      }
      this.staleRelight.delete(snapshot);
      snapshot.relight.run(renderer);
    }
    this.invalidate();
  }
```

and in `private activate(snapshot: Snapshot): void {`, directly after its first line (`    if (snapshot.sortFailed) { snapshot.mesh.visible = false; return; }`) add:

```ts
    // R1d: a draw that missed a light change while hidden catches up before it is shown.
    if (this.staleRelight.delete(snapshot) && snapshot.relight !== null && this.renderer !== null) snapshot.relight.run(this.renderer);
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-kernel.test.ts`
Expected: PASS, the Task 0 count plus 2. Every vector test passes unchanged (the new terms are inactive by default).

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-frame.test.ts`
Expected: PASS, the Task 0 count plus 3.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-draw.test.ts`
Expected: PASS, the Task 0 count plus 2; R1b's test that counts `compute` calls still sees two, then three.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-splat-scene.test.ts`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-debug.test.ts`
Expected: PASS, the Task 0 count (its CPU checks call `relightSplat` without the new parameter until Task 22).

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/relight-kernel.ts src/lib/relight/relight-frame.ts src/lib/relight/relight-draw.ts src/lib/native-splat-scene.ts`
Expected: no problems.

- [ ] **Step 10: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/relight-kernel.ts packages/web/src/lib/relight/relight-frame.ts packages/web/src/lib/relight/relight-draw.ts packages/web/src/lib/native-splat-scene.ts packages/web/src/lib/relight/__tests__/relight-kernel.test.ts packages/web/src/lib/relight/__tests__/relight-frame.test.ts packages/web/src/lib/relight/__tests__/relight-draw.test.ts packages/web/src/lib/__tests__/native-splat-scene.test.ts && git diff --cached --stat && git commit -m "feat(relight): the chandeliers' glow hidden under crisp lamps, the interior shadow hook, the pass stride and the active draw first (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The cinematic package in the browser

**Files:**
- Create: `packages/web/src/lib/relight/cinematic-package.ts`
- Modify: `packages/web/src/lib/splat-staging-plugin.ts`
- Test: `packages/web/src/lib/relight/__tests__/cinematic-package.test.ts`, `packages/web/src/lib/relight/__tests__/cinematic-fixture.ts` (create), `packages/web/src/lib/__tests__/splat-staging-plugin.test.ts` (modify)

**Interfaces:**
- Consumes: Task 3's `venviewer.cinematic.v1` (`docs/engineering/cinematic-package.md`); R1b's `FetchLike` and `fetchVerified` (`relight-assets.ts`), `inflate` (`relight-png.ts`), `warnRelightFallback` (`relight-warning.ts`), `WINDOW_COUNT` and `Vec3` (`relight-codec.ts`); Task 7's `CHANDELIER_COUNT`, `GlowChandelier`; Task 4's `LAMP_DIMMINGS`, `PLANCK_MIN_CCT`, `PLANCK_MAX_CCT`; Task 5's `EyeAnchors`; Task 6's `LampLight`, `LampGroupLight`; `LAMP_GROUPS`, `LampGroup` (`relight-kernel.ts`).
- Produces: `CINEMATIC_SCHEMA = "venviewer.cinematic.v1"`, `CINEMATIC_PATH = "cinematic/v1"`, `MAX_OCCLUDER_TRIANGLES = 1_500_000`, `MAX_CRISP_BULBS = 512`; `CinematicManifestSchema`, `type CinematicManifest`; `type BulbGroup = "ch_end" | "ch_centre"`; `interface CinematicBulb { readonly id: string; readonly group: BulbGroup; readonly chandelier: number; readonly position: Vec3; readonly intensity: number }`; `interface BulbEnvelope { readonly kind: "candle"; readonly radius: number; readonly height: number }`; `interface CinematicProbe { readonly position: Vec3; readonly box: readonly [Vec3, Vec3] }`; `interface CinematicData { readonly manifestUrl: string; readonly manifest: CinematicManifest; readonly occluders: Float32Array; readonly bulbs: readonly CinematicBulb[]; readonly envelope: BulbEnvelope; readonly glow: readonly GlowChandelier[]; readonly windowRadiance: readonly number[]; readonly lamps: LampLight; readonly eyeAnchors: EyeAnchors | null; readonly probes: readonly CinematicProbe[] }`; `cinematicManifestUrl(relightBaseUrl: string, location?: string): string`; `cinematicOffBySearch(search: string, previewable: boolean): boolean`; `loadCinematicData(fetchFn: FetchLike, manifestUrl: string, relightTileToModel: readonly number[], signal?: AbortSignal): Promise<CinematicData>`; `loadCinematicPackage(manifestUrl: string, relightTileToModel: readonly number[], fetchFn?: FetchLike): Promise<CinematicData | null>` (cached per URL; any failure warns once with kind `cinematic` and resolves null); `resetCinematicPackages(): void` (tests).

The package sits beside the relight package it was built with (`<room>/cinematic/v1/` next to `<room>/relight/v2/`, Task 3's `package_paths`), so its URL is resolved from the relight package's own base URL and no room table is needed. It is small (a manifest and one gzip of triangles, about 1 MB for a few hundred thousand triangles), so it loads on the main thread: `fetch` and the gzip stream (`DecompressionStream` inside R1b's `inflate`) are asynchronous, and the only synchronous work is the manifest's schema and one pass over the floats to refuse a non-finite coordinate (a few milliseconds; Task 23's loading check covers it). Every field is validated at run time: the schema (at most 512 crisp lamps, each id naming its chandelier, the centre chandelier's lamps in `ch_centre` and the others' in `ch_end`, positive intensities; five chandeliers, every crisp one with lamps and every lamp's chandelier crisp; an envelope of at most 5 cm radius and 20 cm height; each group's dimming `warm` or `led` and a warm-down temperature on the Planckian fit's range; positive gains; five window radiances; anchors well-formed), the model frame (the relight package's `tileToModel` within 1e-9), the occluder file's size and SHA-256 (`fetchVerified`) and its decompressed length (36 bytes a triangle). Anything wrong switches the cinematic light off for the session with one warning, and the hall stays relit (spec §7): the glow splats draw as captured and unboosted, the lamps fade at the bake's colour (no warm-down temperature), and there are no crisp lamps, interior shadows, sheen of the lamps, reflections or night gains. `?cinematic=off` does the same on purpose, only where splats may run.

Verified (7 October): R1b plan lines 2742 (`type FetchLike = (url: string, init: { readonly signal?: AbortSignal }) => Promise<Response>`), 2779–2792 (`sha256Hex`, `fetchVerified(fetchFn, url, expected, signal?)`), 1141 (`inflate(bytes, format: "gzip" | "deflate", maxBytes)` in `relight-png.ts`), 757–766 (`warnRelightFallback(kind, message, cause?)`, `resetRelightWarnings`), 958–963 (`relightManifestUrl`: a package's URL is `<splat base>/<venue>/<room>/<path>/manifest.json`), 7120–7135 and 7505–7530 (the staging plugin's `PACKAGE_DIRECTORIES`, its extensions and its tests, `resolveStagedSplatPath`, `stagedContentType`, `ROOT`); this plan's Task 3 (`write_package`: the manifest's fields, `occluders.bin.gz`, `bulbs.envelope`, `chandeliers`, `lamps.warmDown` and `lamps.groups`, intensities rounded to 6 figures, `MAX_BULBS = 512`) and Task 7 (`CHANDELIER_COUNT = 5`, `GlowChandelier`); `packages/web/src/lib/splat-staging-plugin.ts:38` (`PACKAGE_EXTENSIONS`, `.json` and, after R1b, `.gz`).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/cinematic-package.test.ts`:

```ts
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CinematicManifestSchema, cinematicManifestUrl, cinematicOffBySearch, loadCinematicData, loadCinematicPackage,
  resetCinematicPackages,
} from "../cinematic-package.js";
import type { FetchLike } from "../relight-assets.js";
import { resetRelightWarnings } from "../relight-warning.js";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const BASE = "https://cdn.test/splats/trades-hall/grand-hall/cinematic/v1/";
const ANCHOR = { exposure: 0.8, whiteBalance: [0.9, 1, 1.2], logLuminance: -3, logChroma: [0.5, -1] };
const CENTRES = [[2.24, -7.66, 4.28], [2.24, -2.42, 4.24], [8.9, -5, 4.82], [15.5, -7.68, 4.28], [15.47, -2.33, 4.3]];
const WARM = { dimming: "warm" };
type Manifest = Record<string, unknown> & {
  bulbs: { entries: Record<string, unknown>[] }; chandeliers: { id: number; centre: number[]; crisp: boolean }[];
  lamps: { warmDown: { fullCct: number }; groups: Record<string, { dimming: string }>; night: { gains: Record<string, number[]> } };
  occluders: { triangles: number };
};

function build(edit: (manifest: Manifest) => void = () => undefined, triangles = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])) {
  const packed = new Uint8Array(gzipSync(Buffer.from(triangles.buffer, triangles.byteOffset, triangles.byteLength)));
  const manifest: Manifest = {
    schema: "venviewer.cinematic.v1", room: "grand-hall", createdAt: "2026-10-07T12:00:00+01:00", tool: "abc123",
    model: { frame: "e57", tileToModel: IDENTITY },
    relight: { package: "relight/v2", manifestSha256: "0".repeat(64) },
    bulbs: { envelope: { kind: "candle", radius: 0.0175, height: 0.07 }, entries: [{ id: "c0_b00", group: "ch_end", chandelier: 0, position: [1, 2, 3], intensity: 2 }] },
    chandeliers: CENTRES.map((centre, id) => ({ id, centre, crisp: id === 0 })),
    lamps: {
      windowRadiance: [1, 2, 3, 4, 5],
      warmDown: { fullCct: 3700.1, range: [3537.4, 3984.7], provenance: "test" },
      groups: { cove: WARM, ch_end: WARM, ch_centre: WARM, dome: { dimming: "led" } },
      night: { calibrated: false, gains: { cove: [1, 1, 1], ch_end: [1, 1, 1], ch_centre: [1, 1, 1], dome: [1, 1, 1] }, evidence: null },
    },
    occluders: { file: "occluders.bin.gz", triangles: triangles.length / 9, bounds: [[0, 0, 0], [1, 1, 0]] },
    reflections: { probes: [{ position: [3, -5, 1.6], box: [[0, -10, 0], [18, 0, 7]] }] },
    eye: null,
    files: { "occluders.bin.gz": { sha256: createHash("sha256").update(packed).digest("hex"), bytes: packed.length } },
  };
  edit(manifest);
  const files = new Map<string, Uint8Array>([
    [`${BASE}manifest.json`, new TextEncoder().encode(JSON.stringify(manifest))],
    [`${BASE}occluders.bin.gz`, packed],
  ]);
  const fetchFn: FetchLike = (url) => {
    const body = files.get(url);
    return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
  };
  return { manifest, files, fetchFn, url: `${BASE}manifest.json` };
}

afterEach(() => { resetCinematicPackages(); resetRelightWarnings(); vi.restoreAllMocks(); });

describe("the cinematic package in the browser (T-639 R1d)", () => {
  it("sits beside the relight package, and is switched off only where splats may run", () => {
    expect(cinematicManifestUrl("https://cdn.test/splats/trades-hall/grand-hall/relight/v2/"))
      .toBe("https://cdn.test/splats/trades-hall/grand-hall/cinematic/v1/manifest.json");
    expect(cinematicManifestUrl("/splats/trades-hall/grand-hall/relight/v2/", "http://localhost:5174/room/grand-hall"))
      .toBe("http://localhost:5174/splats/trades-hall/grand-hall/cinematic/v1/manifest.json");
    expect([cinematicOffBySearch("?cinematic=off", true), cinematicOffBySearch("?cinematic=off", false), cinematicOffBySearch("", true)]).toEqual([true, false, false]);
  });

  it("loads the crisp lamps, the chandeliers' glow, the lamps' dimming, the occluders, the probes and the eye's anchors", async () => {
    const pkg = build((manifest) => { manifest.eye = { anchors: { day: ANCHOR, lamps: ANCHOR, moon: ANCHOR } }; });
    const data = await loadCinematicData(pkg.fetchFn, pkg.url, IDENTITY);
    expect(Array.from(data.occluders)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(data.bulbs).toEqual([{ id: "c0_b00", group: "ch_end", chandelier: 0, position: [1, 2, 3], intensity: 2 }]);
    expect(data.envelope).toEqual({ kind: "candle", radius: 0.0175, height: 0.07 });
    expect(data.glow.map((chandelier) => chandelier.crisp)).toEqual([true, false, false, false, false]);
    expect(data.glow[2]?.centre).toEqual([8.9, -5, 4.82]);
    expect(data.windowRadiance).toEqual([1, 2, 3, 4, 5]);
    expect(data.lamps.warmFullCct).toBe(3700.1);
    expect(data.lamps.groups.ch_end).toEqual({ dimming: "warm", gain: [1, 1, 1] });
    expect(data.lamps.groups.dome.dimming).toBe("led");
    expect(data.eyeAnchors?.lamps.exposure).toBe(0.8);
    expect(data.probes).toHaveLength(1);
  });

  it("refuses a package built for another model frame", async () => {
    const pkg = build();
    const shifted = IDENTITY.map((value, index) => (index === 3 ? value + 1e-6 : value));
    await expect(loadCinematicData(pkg.fetchFn, pkg.url, shifted)).rejects.toThrow(/model frame/u);
  });

  it("refuses occluders that do not match their checksum or their triangle count", async () => {
    const tampered = build();
    const bytes = tampered.files.get(`${BASE}occluders.bin.gz`) ?? new Uint8Array();
    tampered.files.set(`${BASE}occluders.bin.gz`, Uint8Array.from(bytes, (value, index) => (index === bytes.length - 1 ? value ^ 1 : value)));
    await expect(loadCinematicData(tampered.fetchFn, tampered.url, IDENTITY)).rejects.toThrow(/SHA-256/u);
    const miscounted = build((manifest) => { manifest.occluders.triangles = 2; });
    await expect(loadCinematicData(miscounted.fetchFn, miscounted.url, IDENTITY)).rejects.toThrow();
  });

  it("refuses malformed manifests", () => {
    const parse = (edit: (manifest: Manifest) => void): boolean => CinematicManifestSchema.safeParse(build(edit).manifest).success;
    expect(parse(() => undefined)).toBe(true);
    const lamp = (index: number, chandelier = 0, group = "ch_end") => ({ id: `c${String(chandelier)}_b${String(index).padStart(3, "0")}`, group, chandelier, position: [0, 0, 0], intensity: 1 });
    expect(parse((manifest) => { manifest.bulbs.entries = Array.from({ length: 513 }, (_unused, index) => lamp(index)); })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [lamp(0, 0, "ch_centre")]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [{ ...lamp(0), id: "c1_b000" }]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [{ ...lamp(0), intensity: 0 }]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [lamp(0), lamp(0, 2, "ch_centre")]; })).toBe(false);
    expect(parse((manifest) => { manifest.chandeliers[3] = { id: 3, centre: [0, 0, 0], crisp: true }; })).toBe(false);
    expect(parse((manifest) => { manifest.chandeliers = manifest.chandeliers.slice(0, 4); })).toBe(false);
    expect(parse((manifest) => { manifest.lamps.groups.cove = { dimming: "incandescent" }; })).toBe(false);
    expect(parse((manifest) => { manifest.lamps.warmDown.fullCct = 900; })).toBe(false);
    expect(parse((manifest) => { manifest.lamps.night.gains.cove = [1, 0, 1]; })).toBe(false);
    expect(parse((manifest) => { manifest.files = {}; })).toBe(false);
    expect(parse((manifest) => { manifest.eye = { anchors: { day: ANCHOR, lamps: { ...ANCHOR, whiteBalance: [1, 1] }, moon: ANCHOR } }; })).toBe(false);
  });

  it("warns once and resolves null for any failure, caching each package by its URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const missing: FetchLike = () => Promise.resolve(new Response(null, { status: 404 }));
    const first = loadCinematicPackage(`${BASE}manifest.json`, IDENTITY, missing);
    expect(loadCinematicPackage(`${BASE}manifest.json`, IDENTITY, missing)).toBe(first);
    await expect(first).resolves.toBeNull();
    await expect(loadCinematicPackage("https://cdn.test/other/manifest.json", IDENTITY, missing)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
```

Create the shared test fixture `packages/web/src/lib/relight/__tests__/cinematic-fixture.ts` (Tasks 10–18 use it):

```ts
import { CinematicManifestSchema, type CinematicData, type CinematicManifest } from "../cinematic-package.js";
import type { Vec3 } from "../relight-codec.js";

/** The proof's chandelier centres (e57 = the model frame). */
export const FIXTURE_CENTRES: readonly Vec3[] = [[2.24, -7.66, 4.28], [2.24, -2.42, 4.24], [8.9, -5, 4.82], [15.5, -7.68, 4.28], [15.47, -2.33, 4.3]];

/** A valid cinematic manifest for tests (T-639 R1d). */
export function cinematicManifest(): CinematicManifest {
  return CinematicManifestSchema.parse({
    schema: "venviewer.cinematic.v1", room: "grand-hall", createdAt: "2026-10-07T12:00:00+01:00", tool: "abc123",
    model: { frame: "e57", tileToModel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    relight: { package: "relight/v2", manifestSha256: "0".repeat(64) },
    bulbs: { envelope: { kind: "candle", radius: 0.0175, height: 0.07 }, entries: [] },
    chandeliers: FIXTURE_CENTRES.map((centre, id) => ({ id, centre, crisp: false })),
    lamps: {
      windowRadiance: [1, 1, 1, 1, 1],
      warmDown: { fullCct: 3700.1, range: [3537.4, 3984.7], provenance: "test" },
      groups: { cove: { dimming: "warm" }, ch_end: { dimming: "warm" }, ch_centre: { dimming: "warm" }, dome: { dimming: "warm" } },
      night: { calibrated: false, gains: { cove: [1, 1, 1], ch_end: [1, 1, 1], ch_centre: [1, 1, 1], dome: [1, 1, 1] }, evidence: null },
    },
    occluders: { file: "occluders.bin.gz", triangles: 0, bounds: [[0, 0, 0], [0, 0, 0]] },
    reflections: { probes: [] },
    eye: null,
    files: { "occluders.bin.gz": { sha256: "0".repeat(64), bytes: 20 } },
  });
}

/** Cinematic data for tests: the Grand Hall's box, no crisp lamps, every group warm, gains of one, with the given changes. */
export function cinematicData(changes: Partial<CinematicData> = {}): CinematicData {
  return {
    manifestUrl: "https://cdn.test/splats/trades-hall/grand-hall/cinematic/v1/manifest.json",
    manifest: cinematicManifest(),
    occluders: new Float32Array(), bulbs: [],
    envelope: { kind: "candle", radius: 0.0175, height: 0.07 },
    glow: FIXTURE_CENTRES.map((centre) => ({ centre, crisp: false })),
    windowRadiance: [1, 1, 1, 1, 1],
    lamps: {
      warmFullCct: 3700.1,
      groups: {
        cove: { dimming: "warm", gain: [1, 1, 1] }, ch_end: { dimming: "warm", gain: [1, 1, 1] },
        ch_centre: { dimming: "warm", gain: [1, 1, 1] }, dome: { dimming: "warm", gain: [1, 1, 1] },
      },
    },
    eyeAnchors: null,
    probes: [{ position: [9, -5, 1.6], box: [[0, -10, 0], [18, 0, 7]] }],
    ...changes,
  };
}
```

In `packages/web/src/lib/__tests__/splat-staging-plugin.test.ts`, append inside the first `describe` block (beside R1b's relight test), before its closing `});`:

```ts
  it("serves a room's cinematic package files, and only inside a cinematic directory (T-639 R1d)", () => {
    for (const file of ["manifest.json", "occluders.bin.gz"]) {
      expect(resolveStagedSplatPath(ROOT, `/splats/trades-hall/grand-hall/cinematic/v1/${file}`))
        .toBe(join(ROOT, "trades-hall", "grand-hall", "cinematic", "v1", file));
    }
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/occluders.bin.gz")).toBeNull();
    expect(resolveStagedSplatPath(ROOT, "/splats/trades-hall/grand-hall/cinematic/../secret.json")).toBeNull();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/cinematic-package.test.ts`
Expected: FAIL — cannot find module `../cinematic-package.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-staging-plugin.test.ts`
Expected: FAIL — the new test (a cinematic path resolves to null).

- [ ] **Step 3: Implement** — create `packages/web/src/lib/relight/cinematic-package.ts`:

```ts
import { z } from "zod";
import type { LampGroupLight, LampLight } from "../light-setting.js";
import type { EyeAnchors } from "./eye.js";
import { LAMP_DIMMINGS, PLANCK_MAX_CCT, PLANCK_MIN_CCT } from "./lamp-dimming.js";
import { fetchVerified, type FetchLike } from "./relight-assets.js";
import { WINDOW_COUNT, type Vec3 } from "./relight-codec.js";
import { CHANDELIER_COUNT, type GlowChandelier, type LampGroup } from "./relight-kernel.js";
import { inflate } from "./relight-png.js";
import { warnRelightFallback } from "./relight-warning.js";

/**
 * The cinematic package in the browser (T-639 R1d; contract docs/engineering/cinematic-package.md): the crisp lamps
 * at the triangulated bulbs and their intensities, the chandeliers whose glow is hidden, the lamps' dimming (the
 * owner's artistic warm-down by default), window radiances and night gains, the interior occluders, the reflection
 * probes and the eye's anchors, validated at run time. Any failure switches the cinematic light off with one warning
 * (spec §7).
 */
export const CINEMATIC_SCHEMA = "venviewer.cinematic.v1";
export const CINEMATIC_PATH = "cinematic/v1";
export const MAX_OCCLUDER_TRIANGLES = 1_500_000;
export const MAX_CRISP_BULBS = 512;
const CENTRE_CHANDELIER = 2;
const TRIANGLE_BYTES = 36;
const MATRIX_TOLERANCE = 1e-9;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const finite = z.number().finite();
const positive = finite.positive();
const vec3 = z.tuple([finite, finite, finite]);
const gain = z.tuple([positive, positive, positive]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const anchor = z.object({ exposure: positive, whiteBalance: gain, logLuminance: finite, logChroma: z.tuple([finite, finite]) });
const bulb = z.object({
  id: z.string().regex(/^c[0-4]_b\d{2,3}$/u),
  group: z.enum(["ch_end", "ch_centre"]),
  chandelier: z.number().int().min(0).max(CHANDELIER_COUNT - 1),
  position: vec3,
  intensity: positive,
}).refine(
  (entry) => entry.id.startsWith(`c${String(entry.chandelier)}_`) && (entry.chandelier === CENTRE_CHANDELIER) === (entry.group === "ch_centre"),
  { message: "A lamp's id, chandelier and group must agree." },
);
const chandelier = z.object({ id: z.number().int().min(0).max(CHANDELIER_COUNT - 1), centre: vec3, crisp: z.boolean() });
const lampGroup = z.object({ dimming: z.enum(LAMP_DIMMINGS) });

export const CinematicManifestSchema = z.object({
  schema: z.literal(CINEMATIC_SCHEMA),
  room: z.string().min(1),
  createdAt: z.string().min(1),
  tool: z.string().min(1),
  model: z.object({ frame: z.literal("e57"), tileToModel: z.array(finite).length(16) }),
  relight: z.object({ package: z.string().min(1), manifestSha256: sha256 }),
  bulbs: z.object({
    envelope: z.object({ kind: z.literal("candle"), radius: positive.max(0.05), height: positive.max(0.2) }),
    entries: z.array(bulb).max(MAX_CRISP_BULBS),
  }),
  chandeliers: z.array(chandelier).length(CHANDELIER_COUNT)
    .refine((entries) => entries.every((entry, index) => entry.id === index), { message: "The chandeliers are 0 to 4, in order." }),
  lamps: z.object({
    windowRadiance: z.array(finite.nonnegative()).length(WINDOW_COUNT),
    warmDown: z.object({ fullCct: finite.min(PLANCK_MIN_CCT).max(PLANCK_MAX_CCT), range: z.tuple([finite, finite]), provenance: z.string() }),
    groups: z.object({ cove: lampGroup, ch_end: lampGroup, ch_centre: lampGroup, dome: lampGroup }),
    night: z.object({
      calibrated: z.boolean(),
      gains: z.object({ cove: gain, ch_end: gain, ch_centre: gain, dome: gain }),
      evidence: z.unknown(),
    }),
  }),
  occluders: z.object({ file: z.string().min(1), triangles: z.number().int().min(0).max(MAX_OCCLUDER_TRIANGLES), bounds: z.tuple([vec3, vec3]) }),
  reflections: z.object({ probes: z.array(z.object({ position: vec3, box: z.tuple([vec3, vec3]) })).max(8) }),
  eye: z.object({ anchors: z.object({ day: anchor, lamps: anchor, moon: anchor }) }).nullable(),
  files: z.record(z.string(), z.object({ sha256, bytes: z.number().int().positive() })),
}).superRefine((manifest, context) => {
  if (manifest.files[manifest.occluders.file] === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["occluders", "file"], message: "The occluders file has no checksum entry." });
  }
  const lit = new Set(manifest.bulbs.entries.map((entry) => entry.chandelier));
  manifest.chandeliers.forEach((entry, index) => {
    if (entry.crisp !== lit.has(entry.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["chandeliers", index], message: "A chandelier is crisp exactly when it has crisp lamps." });
    }
  });
});
export type CinematicManifest = z.infer<typeof CinematicManifestSchema>;

/** The crisp lamps' groups: the dome has none (its bright "emitters" are crests lit by LED pin spots). */
export type BulbGroup = "ch_end" | "ch_centre";
export interface CinematicBulb {
  /** The bulb table's id, `c<chandelier>_b<nn>` (the bake's refit uses the same). */
  readonly id: string;
  readonly group: BulbGroup;
  /** The chandelier it hangs from, 0–4 (2 is the centre chandelier). */
  readonly chandelier: number;
  /** Triangulated from the photographs (Task 1), model frame. */
  readonly position: Vec3;
  /** Per unit of its group's source weight: it lights a surface with weight × intensity × cosθ / d² (Task 3). */
  readonly intensity: number;
}
/** The crisp lamp drawn at each bulb: a frosted candle envelope (a design value). */
export interface BulbEnvelope {
  readonly kind: "candle";
  readonly radius: number;
  readonly height: number;
}
export interface CinematicProbe {
  readonly position: Vec3;
  readonly box: readonly [Vec3, Vec3];
}
export interface CinematicData {
  readonly manifestUrl: string;
  readonly manifest: CinematicManifest;
  /** [triangle][vertex 0..2][x, y, z], model frame. */
  readonly occluders: Float32Array;
  readonly bulbs: readonly CinematicBulb[];
  readonly envelope: BulbEnvelope;
  /** The five chandeliers for the kernel's glow hiding (Task 7): their centres and whether crisp lamps are drawn. */
  readonly glow: readonly GlowChandelier[];
  /** Each window's sky radiance per unit source weight, W1..W5. */
  readonly windowRadiance: readonly number[];
  readonly lamps: LampLight;
  readonly eyeAnchors: EyeAnchors | null;
  readonly probes: readonly CinematicProbe[];
}

/** The package beside a relight package (`<room>/relight/vN/` → `<room>/cinematic/v1/manifest.json`). */
export function cinematicManifestUrl(relightBaseUrl: string, location: string = globalThis.location.href): string {
  return new URL(`../../${CINEMATIC_PATH}/manifest.json`, new URL(relightBaseUrl, location)).href;
}

export function cinematicOffBySearch(search: string, previewable: boolean): boolean {
  return previewable && new URLSearchParams(search).get("cinematic") === "off";
}

export async function loadCinematicData(
  fetchFn: FetchLike, manifestUrl: string, relightTileToModel: readonly number[], signal?: AbortSignal,
): Promise<CinematicData> {
  if (!LITTLE_ENDIAN) throw new Error("The cinematic package's floats are little-endian and this platform is not.");
  const response = await fetchFn(manifestUrl, { signal });
  if (!response.ok) throw new Error(`${manifestUrl} could not be read (${String(response.status)}).`);
  const manifest = CinematicManifestSchema.parse(await response.json());
  const sameFrame = relightTileToModel.length === 16
    && manifest.model.tileToModel.every((value, index) => Math.abs(value - (relightTileToModel[index] ?? Number.NaN)) <= MATRIX_TOLERANCE);
  if (!sameFrame) throw new Error("The cinematic package was built for another model frame than the relight package's.");
  const entry = manifest.files[manifest.occluders.file];
  if (entry === undefined) throw new Error("The occluders file has no checksum entry.");
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  const packed = await fetchVerified(fetchFn, `${base}${manifest.occluders.file}`, entry, signal);
  const expected = manifest.occluders.triangles * TRIANGLE_BYTES;
  const raw = await inflate(packed, "gzip", expected);
  if (raw.byteLength !== expected) throw new Error(`The occluders hold ${String(raw.byteLength)} bytes, not ${String(expected)}.`);
  const occluders = raw.byteOffset % 4 === 0 ? new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) : new Float32Array(raw.slice().buffer);
  if (!occluders.every((value) => Number.isFinite(value))) throw new Error("The occluders hold a coordinate that is not finite.");
  const groupLight = (group: LampGroup): LampGroupLight => ({ dimming: manifest.lamps.groups[group].dimming, gain: manifest.lamps.night.gains[group] });
  return {
    manifestUrl,
    manifest,
    occluders,
    bulbs: manifest.bulbs.entries.map((entry): CinematicBulb => ({ ...entry })),
    envelope: manifest.bulbs.envelope,
    glow: manifest.chandeliers.map((entry): GlowChandelier => ({ centre: entry.centre, crisp: entry.crisp })),
    windowRadiance: manifest.lamps.windowRadiance,
    lamps: {
      warmFullCct: manifest.lamps.warmDown.fullCct,
      groups: { cove: groupLight("cove"), ch_end: groupLight("ch_end"), ch_centre: groupLight("ch_centre"), dome: groupLight("dome") },
    },
    eyeAnchors: manifest.eye?.anchors ?? null,
    probes: manifest.reflections.probes,
  };
}

const packages = new Map<string, Promise<CinematicData | null>>();
const browserFetch: FetchLike = (url, init) => fetch(url, init);

/** The session's cinematic package, cached per URL; null (with one warning) when it cannot be used. */
export function loadCinematicPackage(manifestUrl: string, relightTileToModel: readonly number[], fetchFn: FetchLike = browserFetch): Promise<CinematicData | null> {
  const cached = packages.get(manifestUrl);
  if (cached !== undefined) return cached;
  const pending = loadCinematicData(fetchFn, manifestUrl, relightTileToModel).catch((reason: unknown) => {
    warnRelightFallback("cinematic", "The cinematic light could not be used; the hall stays relit without it.", reason);
    return null;
  });
  packages.set(manifestUrl, pending);
  return pending;
}

/** Tests only. */
export function resetCinematicPackages(): void {
  packages.clear();
}
```

- [ ] **Step 4: Serve it in development** — in `packages/web/src/lib/splat-staging-plugin.ts`, add `"cinematic"` as the last entry of `PACKAGE_DIRECTORIES` (R1b's `["floor-skin", "relight"]` and R1c's additions). Its `.json` and `.gz` files are already among `PACKAGE_EXTENSIONS`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/cinematic-package.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-staging-plugin.test.ts`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/cinematic-package.ts src/lib/splat-staging-plugin.ts`
Expected: no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/cinematic-package.ts packages/web/src/lib/relight/__tests__/cinematic-package.test.ts packages/web/src/lib/relight/__tests__/cinematic-fixture.ts packages/web/src/lib/splat-staging-plugin.ts packages/web/src/lib/__tests__/splat-staging-plugin.test.ts && git diff --cached --stat && git commit -m "feat(relight): the cinematic package in the browser, validated, with one fallback warning (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The light director: every frame while the light moves, nothing while it is still

**Files:**
- Create: `packages/web/src/lib/relight/light-director.ts`
- Modify: `packages/web/src/components/scene/RelightProvider.tsx`
- Test: `packages/web/src/lib/relight/__tests__/light-director.test.ts` (create), `packages/web/src/components/scene/__tests__/RelightProvider.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`LightMotion`, `MINUTES_PER_DAY`, `MotionFrame`, `MotionInstant`, `MotionTargets`, `EyeTarget`, `LampDrives`; `anchoredEye`, `lightChroma`, `adaptationLuminance`, `scotopicAmount`, `CAPTURE_CALIBRATION`, `IDENTITY_EYE`, `EyeAnchors`, `FrameMeasurement`, `LuminanceCalibration`), Task 6 (`lightForSky`, `lampTargets`, `weatherOf`, `dayNumber`, `dateOfDay`, `londonClock`, `settingForChoice`, `SkyLight`, `SkyExtras`, `LampLight`, `STEADY_LAMPS`, the store's `follow` and `lamps`; `skyAt`), Task 7 (`RelightFrame.setDisplay`, `setPassStride`, `passStride`; `NativeSplatScene.runRelight({ activeOnly })`), Task 8 (`loadCinematicPackage`, `cinematicManifestUrl`, `cinematicOffBySearch`, `CinematicData`); R1b's `RelightFrame` (`apply`, `onApply`, `inputs`, `meanLight`, `current`), `applicationForChoice`, `capturedSetting`, `LUMINANCE`, `measureRelight`; `prefersReducedMotion` (`lib/reduced-motion.ts`); `gaussianSplatsAvailable` (`lib/splat-access.ts`).
- Produces (`light-director.ts`): `AMORTISE_STRIDE = 1`, `LIVE_RETIME_MINUTES = 1`, `BODY_STEP_DEGREES = 0.02`, `LIGHT_STEP_RELATIVE = 1e-3`, `LIVE_TICK_MS = 1000`, `FALLBACK_ALBEDO = 0.34`; `interface DirectorCinematic { readonly lamps: LampLight; readonly eyeAnchors: EyeAnchors | null; readonly city: readonly Rgb[] | null; readonly calibration: LuminanceCalibration }`; `interface DirectorOptions { readonly frame: RelightFrame; readonly invalidate: () => void; readonly clock?: () => number; readonly now?: () => number; readonly reducedMotion?: () => boolean; readonly requestFrame?: (callback: () => void) => number; readonly cancelFrame?: (handle: number) => void; readonly setTimer?: (callback: () => void, ms: number) => number; readonly clearTimer?: (handle: number) => void }`; `interface DisplayedLight { readonly instant: MotionInstant; readonly utc: Date; readonly sun: SolarPosition; readonly moon: MoonPosition; readonly light: SkyLight; readonly captured: boolean; readonly following: boolean; readonly lamps: LampDrives; readonly eye: EyeTarget; readonly moving: boolean; readonly lightMoving: boolean }`; `capturedLight(inputs: LightInputs, sun: SolarPosition, moon: MoonPosition): SkyLight`; `mixLights(from: SkyLight, to: SkyLight, amount: number): SkyLight`; `lightDelta(a: RelightSetting, b: RelightSetting): { readonly degrees: number; readonly relative: number }`; `class LightDirector` with `constructor(options: DirectorOptions)`, getters `moving` and `lightMoving`, `start(): void`, `stop(): void`, `setCinematic(cinematic: DirectorCinematic | null): void`, `setMeasurement(measurement: FrameMeasurement): void`, `setStride(stride: number): void`, `forceBothBodies(on: boolean): void`, `onLight(listener: (light: DisplayedLight) => void): () => void` (just before each apply), `onDisplayed(listener: (light: DisplayedLight) => void): () => void` (every tick), `current(): DisplayedLight | null`; `subscribeDisplayedLight(listener: (light: DisplayedLight | null) => void): () => void` and `currentDisplayedLight(): DisplayedLight | null` (the one session's displayed light, for the clock outside the canvas).
- Produces (provider): with the cinematic light on (not `?cinematic=off`), one `LightDirector` per relight frame replaces R1b's per-choice apply; the frame's apply listener runs `host.runRelight({ activeOnly: director.lightMoving })`; the cinematic package is loaded beside the relight package once the frame is on the host and handed to the director; the provider keeps `cinematic: { frame, director, data }` state for Task 10's `RelightCinematic`.

The director is the only writer of the light while a relit, cinematic session runs (decisions 2–4, 7). Each tick it reads the store, forms the targets (the displayed instant: London's real time while following, else the choice's day and minutes; each lamp group's drive by the switch, automatic lamps following the Sun the visitor sees; the eye), steps Task 5's springs, computes both bodies at the displayed instant (Task 6's `skyAt`) and the light (`lightForSky` with the cinematic package's night gains and the city's light, or the captured light), and mixes two lights while a cross-fade runs. A cross-fade passes through the kernel's two body slots: the old light's dominant body (the Sun when it is up, else the Moon) fades in the first slot while the new light's rises in the second, so the mix is the linear superposition of the two lights, which is exactly a cross-fade of the light (the other body is at most 1/100,000 of the light in either, decision 2). It applies the light to R1b's frame only when it has changed enough to show: a body moved 0.02° or any weight, colour or lamp level changed by 0.1% while the light moves, and the exact final light once it rests (and once more at full stride if the last moving applies were amortised). Applying reruns the passes through R1b's `onApply` listener, the active draw only while the light moves (Task 7). The display is written every tick with `setDisplay`, so an adapting eye never reruns a pass. A tick schedules the next animation frame only while something moves; a still, live hall ticks once a second (`LIVE_TICK_MS`) to advance the clock with `retime`, and reapplies only when the bodies have moved 0.02°, about every five seconds. Nothing runs while the light is still and the clock is not following.

The eye's target is Task 5's `anchoredEye` once the package's anchors exist, with the latest GPU measurement (Task 13), which holds until the next one: a still hall renders no frame and measures nothing, so the eye holds where it is rather than drifting. Without anchors (before Task 21) it falls back to R1b's display for the choice, `applicationForChoice` on the baked floor mean, recomputed only when the choice's minute changes, with its scotopic amount from that mean light times the floor's albedo (0.34, the oak, the frontier study's §b3). The captured light is the identity display, exactly.

The provider keeps R1b's path whole under `?cinematic=off` (where splats may run), so R1b's own checks can always run against R1b's behaviour.

Verified (7 October): R1b plan lines 7239–7378 (`RelightProvider`: `const apply = (): void => {…}`, `measureRelight("relight:apply", apply);`, `host.setRelight(owner, frame);`, `host.runRelight();`, `stop = [frame.onApply(() => { host.runRelight(); invalidate(); }), useLightSettingStore.subscribe(…)]`, `setLoaded({ from: wanted, frame: next });`, `settle(data);`), 6895–7000 (the provider's tests: `mountInStubRoot`, `settle`, `Probe`, `WEBGPU`, `IDENTITY`, the store reset), 4954–4962 (`RelightFrame.meanLight(light: ChoiceLight): Rgb`), 4870–4890 (`current`, `inputs`), amendment A4 (`applicationForChoice(inputs, choice, meanLight)`), R1b plan line 7429 (`gaussianSplatsAvailable()` decides previewable, `lib/splat-access.ts:30`); `packages/web/src/lib/reduced-motion.ts:4` (`prefersReducedMotion`); this plan's Tasks 5–8.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/light-director.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STEADY_LAMPS, defaultChoice, settingForChoice } from "../../light-setting.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { CAPTURE_CALIBRATION, type EyeAnchor } from "../eye.js";
import { LightDirector, capturedLight, currentDisplayedLight, lightDelta, mixLights } from "../light-director.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { capturedSetting } from "../relight-kernel.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
const initial = useLightSettingStore.getState();
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
beforeEach(() => {
  useLightSettingStore.setState(initial, true);
  useLightSettingStore.getState().selectPreset("captured");
});

function rig(reducedMotion = false) {
  const frame = new RelightFrame(data);
  const queue: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const clock = { time: 0, wall: Date.UTC(2026, 4, 31, 8, 0) };
  const applies: number[] = [];
  frame.onApply(() => { applies.push(clock.time); });
  const director = new LightDirector({
    frame, invalidate: () => undefined, now: () => clock.time, clock: () => clock.wall, reducedMotion: () => reducedMotion,
    requestFrame: (callback) => queue.push(callback), cancelFrame: () => undefined,
    setTimer: (callback) => timers.push(callback), clearTimer: () => undefined,
  });
  const frames = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      clock.time += 1000 / 60;
      clock.wall += 1000 / 60;
      for (const callback of queue.splice(0)) callback();
    }
  };
  const second = (): void => {
    clock.time += 1000;
    clock.wall += 1000;
    for (const callback of timers.splice(0)) callback();
  };
  return { frame, director, frames, second, applies, queue };
}

describe("the light director (T-639 R1d)", () => {
  it("applies the choice once at start, exactly as R1b would, and runs nothing while still", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const { frame, director, frames, applies, queue } = rig();
    director.start();
    expect(frame.current?.setting).toEqual(settingForChoice(frame.inputs, defaultChoice("sunny")).setting);
    expect(frame.current?.display.exposure).toBeCloseTo(0.629, 9);
    frames(1);
    expect([applies.length, queue.length]).toEqual([1, 0]);
    director.stop();
  });

  it("holds the captured light at exactly the identity display", () => {
    const { frame, director } = rig();
    director.start();
    expect(frame.current?.setting).toEqual(capturedSetting(frame.inputs));
    expect(frame.current?.display).toEqual({ exposure: 1, whiteBalance: [1, 1, 1] });
    director.stop();
  });

  it("sweeps to a new hour, applying every frame while the light moves, and rests exactly", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const { frame, director, frames, applies, queue } = rig();
    director.start();
    useLightSettingStore.getState().setMinutes(720);
    let elevation = director.current()?.sun.elevation ?? 0;
    for (let i = 0; i < 20; i += 1) {
      frames(1 / 60);
      const next = director.current()?.sun.elevation ?? 0;
      expect(next).toBeGreaterThan(elevation);
      elevation = next;
    }
    expect(applies.length).toBeGreaterThan(15);
    frames(8);
    expect(frame.current?.setting).toEqual(settingForChoice(frame.inputs, { ...defaultChoice("sunny"), minutes: 720 }).setting);
    expect(queue).toHaveLength(0);
    director.stop();
  });

  it("cross-fades under reduced motion through the two body slots, then rests on the new light", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const { frame, director, frames } = rig(true);
    director.start();
    const before = frame.current?.setting.sunDir;
    useLightSettingStore.getState().setMinutes(720);
    frames(2 / 60);
    const after = settingForChoice(frame.inputs, { ...defaultChoice("sunny"), minutes: 720 }).setting;
    expect(frame.current?.setting.sunDir).toEqual(before);
    expect(frame.current?.setting.moonDir).toEqual(after.sunDir);
    frames(5);
    expect(frame.current?.setting).toEqual(after);
    director.stop();
  });

  it("fades the lamps in through amber on the owner's warm-down when the switch turns on", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const { frame, director, frames } = rig();
    director.start();
    const warm = { dimming: "warm", gain: [1, 1, 1] } as const;
    director.setCinematic({
      lamps: { warmFullCct: 3700, groups: { cove: warm, ch_end: warm, ch_centre: warm, dome: warm } },
      eyeAnchors: null, city: null, calibration: CAPTURE_CALIBRATION,
    });
    useLightSettingStore.getState().setLamps("on");
    frames(0.3);
    const level = frame.current?.setting.lampLevels.ch_end ?? 0;
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(1);
    expect(frame.current?.setting.lampTints?.ch_end[2]).toBeLessThan(1);
    frames(6);
    expect([frame.current?.setting.lampLevels.ch_end, frame.current?.setting.lampTints?.ch_end]).toEqual([1, [1, 1, 1]]);
    director.stop();
  });

  it("follows live time without motion, reapplying only once the bodies have moved 0.02°", () => {
    useLightSettingStore.getState().selectPreset("live");
    const { director, second, applies, queue } = rig();
    director.start();
    for (let s = 0; s < 3; s += 1) second();
    expect([applies.length, queue.length]).toEqual([1, 0]);
    for (let s = 0; s < 10; s += 1) second();
    expect(applies.length).toBeGreaterThanOrEqual(2);
    expect(queue).toHaveLength(0);
    director.stop();
  });

  it("adapts the eye to a measured frame around its anchors without reapplying the light", () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const { frame, director, frames, applies } = rig();
    const anchor: EyeAnchor = { exposure: 0.6, whiteBalance: [1, 1, 1], logLuminance: -2, logChroma: [0, 0] };
    director.setCinematic({ lamps: STEADY_LAMPS, eyeAnchors: { day: anchor, lamps: anchor, moon: anchor }, city: null, calibration: CAPTURE_CALIBRATION });
    director.start();
    frames(4);
    const settled = applies.length;
    const exposure = frame.uniforms.display.exposure.value;
    director.setMeasurement({ logLuminance: -4, at: 4000 });
    frames(3);
    expect(frame.uniforms.display.exposure.value / exposure).toBeGreaterThan(1.5);
    expect(applies.length).toBe(settled);
    director.stop();
  });

  it("mixes two lights linearly, the old body fading in the first slot and the new rising in the second", () => {
    const frame = new RelightFrame(data);
    const day = settingForChoice(frame.inputs, defaultChoice("sunny"));
    const noon = settingForChoice(frame.inputs, { ...defaultChoice("sunny"), minutes: 720 });
    if (day.sun === null || noon.sun === null || day.moon === null || noon.moon === null) throw new Error("A sunny choice has both bodies.");
    const from = { ...day, sun: day.sun, moon: day.moon, shares: { day: 1, lamps: 0, moon: 0 }, colour: [1, 1, 1] as const, moonSky: { level: 0, colour: [1, 1, 1] as const }, sheen: 1 };
    const to = { ...noon, sun: noon.sun, moon: noon.moon, shares: { day: 1, lamps: 0, moon: 0 }, colour: [1, 1, 1] as const, moonSky: { level: 0, colour: [1, 1, 1] as const }, sheen: 1 };
    // The captured light carries no added sheen, and a cross-fade carries the sheen with it (spec §4.3).
    const captured = capturedLight(frame.inputs, day.sun, day.moon);
    expect([captured.sheen, mixLights(captured, to, 0.25).sheen, mixLights(from, captured, 0.25).sheen]).toEqual([0, 0.25, 0.75]);
    const half = mixLights(from, to, 0.5).setting;
    expect(half.sunDir).toEqual(day.setting.sunDir);
    expect(half.moonDir).toEqual(noon.setting.sunDir);
    half.sunRgb.forEach((value, c) => { expect(value).toBeCloseTo((day.setting.sunRgb[c] ?? 0) / 2, 12); });
    half.weights[0]?.forEach((value, c) => { expect(value).toBeCloseTo(((day.setting.weights[0]?.[c] ?? 0) + (noon.setting.weights[0]?.[c] ?? 0)) / 2, 12); });
    expect(lightDelta(day.setting, day.setting)).toEqual({ degrees: 0, relative: 0 });
    expect(lightDelta(day.setting, noon.setting).degrees).toBeGreaterThan(10);
  });

  it("publishes the displayed light for the clock outside the canvas", () => {
    const { director } = rig();
    director.start();
    expect(currentDisplayedLight()).toBe(director.current());
    director.stop();
    expect(currentDisplayedLight()).toBeNull();
  });
});
```

In `packages/web/src/components/scene/__tests__/RelightProvider.test.tsx`, replace the test `it("applies a new choice within an animation frame and reruns the host's passes", …)` (its whole block) with:

```tsx
  it("steps the light toward a new choice every animation frame, rerunning only the active draw while it moves (R1d)", async () => {
    const runRelight = vi.spyOn(NativeSplatScene.prototype, "runRelight");
    mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
    await settle();
    runRelight.mockClear();
    act(() => { useLightSettingStore.getState().selectPreset("night"); });
    await settle(120);
    expect(runRelight).toHaveBeenCalledWith({ activeOnly: true });
    const level = seen.at(-1)?.frame?.current?.setting.lampLevels.dome ?? 0;
    expect(level).toBeGreaterThan(0);
  });

  it("keeps R1b's per-choice apply with ?cinematic=off (R1d)", async () => {
    window.history.replaceState({}, "", "/?cinematic=off");
    try {
      const runRelight = vi.spyOn(NativeSplatScene.prototype, "runRelight");
      mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
      await settle();
      runRelight.mockClear();
      act(() => { useLightSettingStore.getState().selectPreset("night"); });
      await settle();
      expect(seen.at(-1)?.frame?.current?.display).toEqual(PRESET_DISPLAY.night);
      expect(runRelight).toHaveBeenCalledOnce();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/light-director.test.ts`
Expected: FAIL — cannot find module `../light-director.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider.test.tsx`
Expected: FAIL — the new director test (R1b's apply still runs; `runRelight` is called without options).

- [ ] **Step 3: The director** — create `packages/web/src/lib/relight/light-director.ts`:

```ts
import { useLightSettingStore, type LightSettingState } from "../../stores/light-setting-store.js";
import {
  dateOfDay, dayNumber, lampTargets, lightForSky, londonClock, settingForChoice, STEADY_LAMPS, weatherOf,
  type LampLight, type LightChoice, type LightInputs, type SkyExtras, type SkyLight,
} from "../light-setting.js";
import type { MoonPosition } from "../moon.js";
import { prefersReducedMotion } from "../reduced-motion.js";
import type { SolarPosition } from "../sun.js";
import {
  CAPTURE_CALIBRATION, IDENTITY_EYE, adaptationLuminance, anchoredEye, lightChroma, scotopicAmount,
  type EyeAnchors, type FrameMeasurement, type LuminanceCalibration,
} from "./eye.js";
import { LightMotion, MINUTES_PER_DAY, type EyeTarget, type LampDrives, type MotionFrame, type MotionInstant } from "./light-motion.js";
import { applicationForChoice } from "./relight-apply.js";
import type { Vec3 } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";
import { LAMP_GROUPS, LUMINANCE, capturedSetting, type LampGroup, type RelightSetting, type Rgb } from "./relight-kernel.js";
import { skyAt } from "./sky-instant.js";

/**
 * The light director (T-639 R1d, decisions 2–4 and 7): while a relit, cinematic session runs it is the only writer
 * of the light. Each animation frame while the light moves it steps the springs, puts both bodies where they stand
 * at the displayed instant, applies the light when it has changed enough to show (the active draw's passes rerun),
 * and writes the eye's display; a live, still hall ticks once a second; nothing runs while the light is still.
 */
export const AMORTISE_STRIDE = 1;
export const LIVE_RETIME_MINUTES = 1;
export const BODY_STEP_DEGREES = 0.02;
export const LIGHT_STEP_RELATIVE = 1e-3;
export const LIVE_TICK_MS = 1000;
/** The oak floor's albedo (frontier light study §b3): the fallback eye's luminance from the floor's mean light. */
export const FALLBACK_ALBEDO = 0.34;
const ALL_LAMPS_ON: LampDrives = { cove: 1, ch_end: 1, ch_centre: 1, dome: 1 };
const DEGREES = 180 / Math.PI;

export interface DirectorCinematic {
  readonly lamps: LampLight;
  readonly eyeAnchors: EyeAnchors | null;
  /** Each window's city light at full night (Task 15), or null. */
  readonly city: readonly Rgb[] | null;
  readonly calibration: LuminanceCalibration;
}

export interface DirectorOptions {
  readonly frame: RelightFrame;
  readonly invalidate: () => void;
  /** Wall-clock milliseconds (Date.now). */
  readonly clock?: () => number;
  /** Monotonic milliseconds (performance.now). */
  readonly now?: () => number;
  readonly reducedMotion?: () => boolean;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly setTimer?: (callback: () => void, ms: number) => number;
  readonly clearTimer?: (handle: number) => void;
}

export interface DisplayedLight {
  readonly instant: MotionInstant;
  readonly utc: Date;
  readonly sun: SolarPosition;
  readonly moon: MoonPosition;
  /** The light applied (two lights mixed while a cross-fade runs). */
  readonly light: SkyLight;
  readonly captured: boolean;
  readonly following: boolean;
  readonly lamps: LampDrives;
  readonly eye: EyeTarget;
  readonly moving: boolean;
  readonly lightMoving: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const times = (rgb: Rgb, scale: number): Rgb => [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];

/** The captured light as a sky light: R1b's captured setting, the bodies where they are, the day's anchor. */
export function capturedLight(inputs: LightInputs, sun: SolarPosition, moon: MoonPosition): SkyLight {
  return {
    setting: capturedSetting(inputs), sun, moon,
    shares: { day: 1, lamps: 0, moon: 0 }, colour: inputs.daylightColour, moonSky: { level: 0, colour: inputs.daylightColour },
    // The capture's own reflections are in its splats and floor: no added sheen at the captured light.
    sheen: 0,
  };
}

function dominantBody(setting: RelightSetting): { readonly dir: Vec3; readonly rgb: Rgb } | null {
  if (setting.sunDir !== null) return { dir: setting.sunDir, rgb: setting.sunRgb };
  if (setting.moonDir !== null) return { dir: setting.moonDir, rgb: setting.moonRgb };
  return null;
}

/**
 * Two lights cross-faded: every weight, the sky and the lamps linearly; the old light's dominant body fades in the
 * first body slot while the new one's rises in the second (the other body is negligible in both, decision 2).
 */
export function mixLights(from: SkyLight, to: SkyLight, amount: number): SkyLight {
  const t = Math.min(Math.max(amount, 0), 1);
  const a = from.setting, b = to.setting;
  const skyLevel = lerp(a.skyLevel, b.skyLevel, t);
  const mixSky = (c: 0 | 1 | 2): number => (a.skyLevel * a.skyColour[c] * (1 - t) + b.skyLevel * b.skyColour[c] * t) / skyLevel;
  const skyColour: Rgb = skyLevel > 0 ? [mixSky(0), mixSky(1), mixSky(2)] : b.skyColour;
  const fading = dominantBody(a), rising = dominantBody(b);
  const tint = (setting: RelightSetting, group: LampGroup): Rgb => setting.lampTints?.[group] ?? [1, 1, 1];
  const level = (group: LampGroup): number => lerp(a.lampLevels[group], b.lampLevels[group], t);
  const mixedTint = (group: LampGroup): Rgb => lerpRgb(tint(a, group), tint(b, group), t);
  return {
    setting: {
      weights: b.weights.map((weight, k) => lerpRgb(a.weights[k] ?? [0, 0, 0], weight, t)),
      skyLevel, skyColour,
      lampLevels: { cove: level("cove"), ch_end: level("ch_end"), ch_centre: level("ch_centre"), dome: level("dome") },
      lampTints: { cove: mixedTint("cove"), ch_end: mixedTint("ch_end"), ch_centre: mixedTint("ch_centre"), dome: mixedTint("dome") },
      emitterBoost: lerp(a.emitterBoost, b.emitterBoost, t),
      sunDir: fading?.dir ?? null,
      sunRgb: fading === null ? [0, 0, 0] : times(fading.rgb, 1 - t),
      moonDir: rising?.dir ?? null,
      moonRgb: rising === null ? [0, 0, 0] : times(rising.rgb, t),
    },
    sun: to.sun,
    moon: to.moon,
    shares: { day: lerp(from.shares.day, to.shares.day, t), lamps: lerp(from.shares.lamps, to.shares.lamps, t), moon: lerp(from.shares.moon, to.shares.moon, t) },
    colour: lerpRgb(from.colour, to.colour, t),
    moonSky: { level: lerp(from.moonSky.level, to.moonSky.level, t), colour: to.moonSky.colour },
    sheen: lerp(from.sheen, to.sheen, t),
  };
}

function angleBetween(a: Vec3 | null, b: Vec3 | null): number {
  if (a === null && b === null) return 0;
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.max(Math.hypot(...a) * Math.hypot(...b), 1e-12);
  return Math.acos(Math.min(1, Math.max(-1, dot))) * DEGREES;
}

/** How far two settings are apart: the larger body angle (degrees) and the largest relative change of any value. */
export function lightDelta(a: RelightSetting, b: RelightSetting): { readonly degrees: number; readonly relative: number } {
  let relative = 0;
  const compare = (x: number, y: number): void => {
    const scale = Math.max(Math.abs(x), Math.abs(y), 1e-12);
    relative = Math.max(relative, Math.abs(x - y) / scale);
  };
  const compareRgb = (x: Rgb, y: Rgb): void => { compare(x[0], y[0]); compare(x[1], y[1]); compare(x[2], y[2]); };
  a.weights.forEach((weight, k) => { compareRgb(weight, b.weights[k] ?? [0, 0, 0]); });
  compareRgb(a.sunRgb, b.sunRgb);
  compareRgb(a.moonRgb, b.moonRgb);
  compare(a.skyLevel, b.skyLevel);
  compareRgb(a.skyColour, b.skyColour);
  for (const group of LAMP_GROUPS) {
    compare(a.lampLevels[group], b.lampLevels[group]);
    compareRgb(a.lampTints?.[group] ?? [1, 1, 1], b.lampTints?.[group] ?? [1, 1, 1]);
  }
  return { degrees: Math.max(angleBetween(a.sunDir, b.sunDir), angleBetween(a.moonDir, b.moonDir)), relative };
}

let published: DisplayedLight | null = null;
let publisher: LightDirector | null = null;
const channel = new Set<(light: DisplayedLight | null) => void>();

/** The session's displayed light (the clock reads it outside the canvas). */
export function subscribeDisplayedLight(listener: (light: DisplayedLight | null) => void): () => void {
  channel.add(listener);
  return () => { channel.delete(listener); };
}

export function currentDisplayedLight(): DisplayedLight | null {
  return published;
}

function publish(owner: LightDirector, light: DisplayedLight | null): void {
  if (light === null && publisher !== owner) return;
  publisher = light === null ? null : owner;
  published = light;
  for (const listener of channel) listener(light);
}

export class LightDirector {
  private readonly frame: RelightFrame;
  private readonly invalidate: () => void;
  private readonly clock: () => number;
  private readonly now: () => number;
  private readonly reducedMotion: () => boolean;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly setTimer: (callback: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private motion: LightMotion | null = null;
  private kind: string | null = null;
  private cinematic: DirectorCinematic | null = null;
  private measurement: FrameMeasurement | null = null;
  private stride = AMORTISE_STRIDE;
  private phase = 0;
  private partial = false;
  private keepMoon = false;
  private fade: { readonly from: MotionInstant; readonly light: SkyLight } | null = null;
  private applied: RelightSetting | null = null;
  private shownEye: EyeTarget | null = null;
  private displayed: DisplayedLight | null = null;
  private last: number | null = null;
  private request: number | null = null;
  private timer: number | null = null;
  private fallback: { readonly key: string; readonly eye: EyeTarget } | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly lightListeners = new Set<(light: DisplayedLight) => void>();
  private readonly displayedListeners = new Set<(light: DisplayedLight) => void>();

  constructor(options: DirectorOptions) {
    this.frame = options.frame;
    this.invalidate = options.invalidate;
    this.clock = options.clock ?? (() => Date.now());
    this.now = options.now ?? (() => performance.now());
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion;
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(() => { callback(); }));
    this.cancelFrame = options.cancelFrame ?? ((handle) => { cancelAnimationFrame(handle); });
    this.setTimer = options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => { window.clearTimeout(handle); });
  }

  get moving(): boolean { return this.displayed?.moving ?? false; }
  get lightMoving(): boolean { return this.displayed?.lightMoving ?? false; }

  /** Subscribes to the store and applies the light at once (the provider times this as `relight:apply`). */
  start(): void {
    this.unsubscribe = useLightSettingStore.subscribe((current, previous) => {
      if (current.choice !== previous.choice || current.follow !== previous.follow || current.lamps !== previous.lamps) this.wake();
    });
    this.tick();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.request !== null) this.cancelFrame(this.request);
    if (this.timer !== null) this.clearTimer(this.timer);
    this.request = null;
    this.timer = null;
    this.lightListeners.clear();
    this.displayedListeners.clear();
    publish(this, null);
  }

  setCinematic(cinematic: DirectorCinematic | null): void {
    this.cinematic = cinematic;
    this.fallback = null;
    this.wake();
  }

  /** The GPU's log-average luminance of the latest frame, before exposure (Task 13). */
  setMeasurement(measurement: FrameMeasurement): void {
    this.measurement = measurement;
    const anchors = this.cinematic?.eyeAnchors;
    if (anchors !== undefined && anchors !== null) this.wake();
  }

  /** Amortise the passes over this many frames while the light moves (decision 7; 1 by default). */
  setStride(stride: number): void {
    this.stride = Math.max(1, Math.floor(stride));
  }

  /** DEV (Task 23): keep a Moon too faint to show, to measure both bodies' cost. */
  forceBothBodies(on: boolean): void {
    this.keepMoon = on;
    this.applied = null;
    this.wake();
  }

  onLight(listener: (light: DisplayedLight) => void): () => void {
    this.lightListeners.add(listener);
    return () => { this.lightListeners.delete(listener); };
  }

  onDisplayed(listener: (light: DisplayedLight) => void): () => void {
    this.displayedListeners.add(listener);
    return () => { this.displayedListeners.delete(listener); };
  }

  current(): DisplayedLight | null {
    return this.displayed;
  }

  private wake(): void {
    if (this.request !== null || this.unsubscribe === null) return;
    this.request = this.requestFrame(() => { this.request = null; this.tick(); });
  }

  private tick(): void {
    const nowMs = this.now();
    const dt = this.last === null ? 0 : Math.min(Math.max((nowMs - this.last) / 1000, 0), 0.25);
    this.last = nowMs;
    const state = useLightSettingStore.getState();
    const preset = state.choice.preset;
    const weather = preset === "captured" ? null : weatherOf(preset);
    const following = state.follow && weather !== null;
    const goal: MotionInstant = following ? londonClock(new Date(this.clock())) : { day: dayNumber(state.choice.date), minutes: state.choice.minutes };
    const site = this.frame.inputs.site;
    const sunElevation = this.displayed?.sun.elevation ?? skyAt(goal, site.latitude, site.longitude).sun.elevation;
    const lamps = weather === null ? ALL_LAMPS_ON : lampTargets(state.lamps, sunElevation);
    const targets = { instant: goal, lamps, eye: this.eyeTarget(weather === null, state, following) };
    let frame: MotionFrame;
    let retimed = false;
    const kind = weather ?? "captured";
    if (this.motion === null) {
      this.motion = new LightMotion(targets);
      frame = this.motion.current();
    } else {
      if (kind !== this.kind) this.motion.crossFade();
      else if (following) retimed = this.retimeLive(this.motion, goal);
      frame = this.motion.step(dt, targets, !this.reducedMotion());
    }
    this.kind = kind;

    const sky = skyAt(frame.instant, site.latitude, site.longitude);
    const extras: SkyExtras = { city: this.cinematic?.city ?? null, keepMoon: this.keepMoon };
    const to = weather === null
      ? capturedLight(this.frame.inputs, sky.sun, sky.moon)
      : lightForSky(this.frame.inputs, weather, sky.sun, sky.moon, frame.lamps, this.cinematic?.lamps ?? STEADY_LAMPS, extras);
    if (frame.blend === null) this.fade = null;
    else if (this.fade?.from !== frame.blend.from) this.fade = { from: frame.blend.from, light: this.displayed?.light ?? to };
    const light = this.fade === null || frame.blend === null ? to : mixLights(this.fade.light, to, frame.blend.amount);
    const displayed: DisplayedLight = {
      instant: frame.instant, utc: sky.utc, sun: sky.sun, moon: sky.moon, light, captured: weather === null, following,
      lamps: frame.lamps, eye: frame.eye, moving: frame.moving, lightMoving: frame.lightMoving,
    };
    this.displayed = displayed;

    let shown = false;
    // Live time's own progress is held to the same 0.02° step as motion; anything else at rest lands exactly.
    if (this.shouldApply(light.setting, frame.lightMoving || retimed)) {
      if (frame.lightMoving && this.stride > 1) {
        this.frame.setPassStride(this.stride, this.phase);
        this.phase = (this.phase + 1) % this.stride;
        this.partial = true;
      } else if (this.frame.passStride !== 1) {
        this.frame.setPassStride(1, 0);
      }
      if (!frame.lightMoving) this.partial = false;
      for (const listener of this.lightListeners) listener(displayed);
      this.applied = light.setting;
      this.frame.apply({ setting: light.setting, sun: weather === null ? null : sky.sun, display: { exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance } });
      shown = true;
    }
    if (this.shownEye === null || !sameEye(this.shownEye, frame.eye)) {
      this.frame.setDisplay({ exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance });
      this.shownEye = frame.eye;
      shown = true;
    }
    for (const listener of this.displayedListeners) listener(displayed);
    publish(this, displayed);
    if (shown) this.invalidate();
    if (frame.moving) this.wake();
    this.scheduleLive(following && !frame.moving);
  }

  /** Apply while moving (or retimed) when the change can show; at rest, the exact final light (and a full pass after a strided one). */
  private shouldApply(setting: RelightSetting, stepped: boolean): boolean {
    if (this.applied === null) return true;
    const delta = lightDelta(this.applied, setting);
    if (stepped) return delta.degrees >= BODY_STEP_DEGREES || delta.relative >= LIGHT_STEP_RELATIVE;
    return delta.degrees > 0 || delta.relative > 0 || this.partial;
  }

  /** Live time's own progress (a minute per minute) moves the displayed instant without a spring. */
  private retimeLive(motion: LightMotion, goal: MotionInstant): boolean {
    const shown = motion.current();
    if (shown.blend !== null || shown.lightMoving) return false;
    const ahead = (goal.day - shown.instant.day) * MINUTES_PER_DAY + goal.minutes - shown.instant.minutes;
    if (!(ahead >= 0 && ahead < LIVE_RETIME_MINUTES)) return false;
    motion.retime(goal);
    return true;
  }

  private scheduleLive(on: boolean): void {
    if (!on) {
      if (this.timer !== null) this.clearTimer(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer !== null) return;
    this.timer = this.setTimer(() => { this.timer = null; this.tick(); }, LIVE_TICK_MS);
  }

  private eyeTarget(captured: boolean, state: LightSettingState, following: boolean): EyeTarget {
    if (captured) return IDENTITY_EYE;
    const calibration = this.cinematic?.calibration ?? CAPTURE_CALIBRATION;
    const anchors = this.cinematic?.eyeAnchors ?? null;
    const light = this.displayed;
    if (anchors !== null && light !== null && !light.captured) {
      // The latest measurement holds until the next: a still hall renders no frame, measures nothing, and the eye holds.
      return anchoredEye(anchors, light.light.shares, lightChroma(light.light.colour), this.measurement, calibration);
    }
    return this.fallbackEye(state, following, calibration);
  }

  /** Without anchors: R1b's display for the choice (the baked floor mean), recomputed when its minute changes. */
  private fallbackEye(state: LightSettingState, following: boolean, calibration: LuminanceCalibration): EyeTarget {
    const now = londonClock(new Date(this.clock()));
    const choice: LightChoice = following ? { ...state.choice, date: dateOfDay(now.day), minutes: Math.floor(now.minutes) } : state.choice;
    const key = `${choice.preset}|${choice.date}|${String(choice.minutes)}`;
    if (this.fallback?.key === key) return this.fallback.eye;
    const meanLight = (light: Parameters<RelightFrame["meanLight"]>[0]): Rgb => this.frame.meanLight(light);
    const display = applicationForChoice(this.frame.inputs, choice, meanLight).display;
    const mean = meanLight(settingForChoice(this.frame.inputs, choice));
    const luminance = (mean[0] * LUMINANCE[0] + mean[1] * LUMINANCE[1] + mean[2] * LUMINANCE[2]) * FALLBACK_ALBEDO;
    const eye: EyeTarget = {
      exposure: display.exposure, whiteBalance: display.whiteBalance,
      scotopic: luminance > 0 ? scotopicAmount(adaptationLuminance(Math.log2(luminance), calibration)) : 0,
    };
    this.fallback = { key, eye };
    return eye;
  }
}

function sameEye(a: EyeTarget, b: EyeTarget): boolean {
  return a.exposure === b.exposure && a.scotopic === b.scotopic && a.whiteBalance.every((value, c) => value === b.whiteBalance[c]);
}
```

- [ ] **Step 4: The provider** — in `packages/web/src/components/scene/RelightProvider.tsx`, add the imports:

```ts
import { CAPTURE_CALIBRATION } from "../../lib/relight/eye.js";
import { cinematicManifestUrl, cinematicOffBySearch, loadCinematicPackage, type CinematicData } from "../../lib/relight/cinematic-package.js";
import { LightDirector } from "../../lib/relight/light-director.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";
```

directly after the line `const [loaded, setLoaded] = useState<…>(null);` add:

```ts
  // R1d: the cinematic light's director and package, for this frame only.
  const [cinematic, setCinematic] = useState<{ readonly frame: RelightFrame; readonly director: LightDirector; readonly data: CinematicData | null } | null>(null);
```

and replace the block

```ts
        const apply = (): void => {
          frame.apply(applicationForChoice(frame.inputs, useLightSettingStore.getState().choice, (light) => frame.meanLight(light)));
        };
        measureRelight("relight:apply", apply);
        host.setRelight(owner, frame);
        // The frame's own passes (the probe fold and the floor's sun) run now, so the floor has its sun before any draw.
        host.runRelight();
        stop = [
          frame.onApply(() => { host.runRelight(); invalidate(); }),
          useLightSettingStore.subscribe((current, previous) => {
            if (current.choice === previous.choice) return;
            cancelAnimationFrame(request);
            request = requestAnimationFrame(apply);
          }),
        ];
```

with:

```ts
        // R1d: with the cinematic light on, the director is the only writer of the light (decision 7);
        // ?cinematic=off keeps R1b's per-choice apply whole.
        const previewable = gaussianSplatsAvailable();
        const director = cinematicOffBySearch(window.location.search, previewable) ? null : new LightDirector({ frame, invalidate });
        const apply = (): void => {
          frame.apply(applicationForChoice(frame.inputs, useLightSettingStore.getState().choice, (light) => frame.meanLight(light)));
        };
        measureRelight("relight:apply", () => { if (director === null) apply(); else director.start(); });
        host.setRelight(owner, frame);
        // The frame's own passes (the probe fold and the floor's sun) run now, so the floor has its sun before any draw.
        host.runRelight();
        stop = director === null
          ? [
              frame.onApply(() => { host.runRelight(); invalidate(); }),
              useLightSettingStore.subscribe((current, previous) => {
                if (current.choice === previous.choice) return;
                cancelAnimationFrame(request);
                request = requestAnimationFrame(apply);
              }),
            ]
          : [
              // While the light moves, only the draw on screen reruns its pass (Task 7).
              frame.onApply(() => { host.runRelight({ activeOnly: director.lightMoving }); invalidate(); }),
              () => { director.stop(); },
            ];
        if (director !== null) {
          setCinematic({ frame, director, data: null });
          void loadCinematicPackage(cinematicManifestUrl(data.baseUrl), data.manifest.model.tileToModel).then((found) => {
            if (cancelled || found === null) return;
            director.setCinematic({ lamps: found.lamps, eyeAnchors: found.eyeAnchors, city: null, calibration: CAPTURE_CALIBRATION });
            setCinematic({ frame, director, data: found });
          });
        }
```

(`data` is the resolved package in that callback; `cancelled` is the effect's flag. Task 15 gives the director the city's light.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/light-director.test.ts`
Expected: PASS, 9 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider.test.tsx`
Expected: PASS, the Task 0 count plus 1 (one R1b test replaced, one added). Its other tests start at the captured light (Task 6 Step 7), whose display the director holds at exactly the identity.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: PASS, the Task 0 count.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/light-director.ts src/components/scene/RelightProvider.tsx`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/light-director.ts packages/web/src/lib/relight/__tests__/light-director.test.ts packages/web/src/components/scene/RelightProvider.tsx packages/web/src/components/scene/__tests__/RelightProvider.test.tsx && git diff --cached --stat && git commit -m "feat(relight): the light director: springs every frame while the light moves, nothing while it is still (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Shadow maps for the Sun and the Moon

**Files:**
- Create: `packages/web/src/lib/relight/sun-shadow.ts`, `packages/web/src/components/scene/RelightCinematic.tsx`, `packages/web/src/components/scene/floor-hooks-context.ts`
- Modify: `packages/web/src/lib/relight/floor-material.ts`, `packages/web/src/components/stage/StageFloor.tsx`, `packages/web/src/components/scene/RelightProvider.tsx`
- Test: `packages/web/src/lib/relight/__tests__/sun-shadow.test.ts`, `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx` (create)

**Interfaces:**
- Consumes: Task 8 (`CinematicData`: `occluders`, `probes[].box`), Task 7 (`InteriorShadowHook`, `NO_INTERIOR_SHADOW`, `RelightFrame.setShadowHook`, `KernelCinematic["interiorShadow"]`), Task 9 (`LightDirector.onLight`, `DisplayedLight`); R1b's `litFloorMaterial` as amended by A2 and A5 (its `model` and `lightUv` nodes and the two bodies' term), `StageFloor`'s lit-material memo, `RelightProvider`'s render; R1c's `SkinLightHooksContext`, `SkinLightHooks`, `SkinSurface`, `SkinSheen` (the R1c interface, item 4).
- Produces (`sun-shadow.ts`): `SHADOW_MAP_SIZE = 2048`, `SHADOW_PCF_SPACING = 0.02`, `SHADOW_BIAS = 0.02`, `SHADOW_REDRAW_DEGREES = 0.05`; `type SkyBodyName = "sun" | "moon"`; `type ShadowRenderer = Pick<WebGPURenderer, "getRenderTarget" | "setRenderTarget" | "getClearColor" | "getClearAlpha" | "setClearColor" | "clear" | "render">`; `interface LightView { readonly radius: number; readonly depthOrigin: number; readonly camera: OrthographicCamera; readonly viewProjection: Matrix4; readonly direction: Vec3 }`; `lightViewFor(direction: Vec3, box: readonly [Vec3, Vec3]): LightView`; `occludedFrom(triangles: Float32Array, origin: Vec3, direction: Vec3, minT: number): boolean`; `occluderGeometry(triangles: Float32Array): BufferGeometry`; `class SkyShadows` with `constructor(triangles: Float32Array, box: readonly [Vec3, Vec3])`, readonly `hook: InteriorShadowHook`, readonly `cpu: (position: Vec3, body: SkyBodyName) => number`, `update(renderer: ShadowRenderer, setting: RelightSetting): number` (the maps redrawn), `dispose(): void`.
- Produces (`floor-material.ts`): `interface FloorLightHooks { readonly interiorShadow: InteriorShadowHook | null; readonly sheen: ((surface: SkinSurface) => SkinSheen) | null }`, `NO_FLOOR_HOOKS`; `litFloorMaterial(map, frame, hooks?: FloorLightHooks)`.
- Produces (`floor-hooks-context.ts`): `FloorLightHooksContext` (default `NO_FLOOR_HOOKS`).
- Produces (`RelightCinematic.tsx`): `RelightCinematic({ frame, director, data, transform, children })`: with all three present and a WebGPU renderer, it builds `SkyShadows`, draws the maps before the frame first uses them, sets the frame's shadow hook, redraws on the director's `onLight`, and provides `FloorLightHooksContext` and R1c's `SkinLightHooksContext` (`sunShadow`) to its children; otherwise it renders the children alone. Later tasks mount their parts here.

Spec §4.2 asks for "a sun shadow map of interior occluders from a simplified occluder model", and the owner's requirement puts the Moon through the same machinery. Task 2's occluders (the chandeliers and the window wall's pilasters as 4 cm voxel shells) are drawn into one light-depth map per body slot. The map is orthographic, looking along −s from a sphere around the hall's box (from the package's probe boxes), 2,048 texels across about 24 m (about 1.2 cm a texel). Each texel holds the distance along the light from the camera to the nearest occluder (depth-tested, so no float blending is needed; 0 is the clear and means none); a point is shaded by an occluder nearer the light than itself by more than 2 cm. Sixteen taps 2 cm apart (±3 cm) soften the edge (PCF), which is about the penumbra of the Sun's 0.53° disc over the metre or so between a chandelier and what it shades. The maps are redrawn only when a body slot has turned 0.05° (a quarter of a texel at the far wall), so a still sky costs nothing and a sweep costs two small draws a frame. The R32F target is read with `textureLoad` (float32 textures are not filterable in core WebGPU), in the multiplier pass (a texture, so the pass stays within its eight storage buffers), the floor and the skins.

The CPU twin casts one ray per point toward the body (Möller–Trumbore over every triangle) and gives 1 or 0: a hard edge. The DEV checks (Task 22) compare it with the GPU only where the GPU's 16 taps agree (0 or 1), so the penumbra is never counted as a disagreement.

Verified (7 October): three 0.186 `src/nodes/accessors/TextureNode.js:1034` (`textureLoad = (...params) => texture(...params).setSampler(false)`), `src/nodes/accessors/Position.js:62` (`positionWorld`), `src/nodes/tsl/TSLCore.js:1219` (`ivec2`), `src/core/RenderTarget.js:54` (`constructor(width, height, options)`: `type`, `format`, `depthBuffer`, filters), `src/renderers/common/Renderer.js:1496` (`render`), `:2352` (`getClearColor(target)`), `:2364` (`setClearColor(color, alpha = 1)`), `:2376` (`getClearAlpha`), `:2460` (`clear`), `:2737` (`setRenderTarget`), `:2750` (`getRenderTarget`); R1b plan lines 6693–6708 (`litFloorMaterial`: `const model = u.tileToModel.mul(vec4(positionLocal, 1)).xyz.toVar();`, `lightUv`, the sun term), 6812–6821 (`StageFloor`'s memo: `return floor.tiles.map((tile) => litFloorMaterial(tile.map, relightFrame));`, deps `[floor, colourMode, relightFrame]`), 7371–7377 (the provider's render), 6895–6935 (`mountInStubRoot(element, width, height, renderer fields)`, `WEBGPU`, `IDENTITY`); amendment A5 (the floor's two bodies' term); the R1c interface items 4 (`SkinLightHooks.sunShadow(position, body)`, `SkinLightHooksContext` created by R1c) and 5.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/sun-shadow.test.ts`:

```ts
import { Color, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { RelightSetting } from "../relight-kernel.js";
import {
  SHADOW_BIAS, SkyShadows, lightViewFor, occludedFrom, occluderGeometry, type ShadowRenderer,
} from "../sun-shadow.js";

const BOX: readonly [readonly [number, number, number], readonly [number, number, number]] = [[0, -10, 0], [18, 0, 7]];
/** One 2 m square of two triangles at z = 3 over x, y ∈ [8, 10] × [−6, −4]. */
const PLATE = Float32Array.from([8, -6, 3, 10, -6, 3, 10, -4, 3, 8, -6, 3, 10, -4, 3, 8, -4, 3]);
const UP: readonly [number, number, number] = [0, 0, 1];

function setting(sunDir: readonly [number, number, number] | null, moonDir: readonly [number, number, number] | null = null): RelightSetting {
  return {
    weights: Array.from({ length: 9 }, () => [0, 0, 0] as const), skyLevel: 0, skyColour: [1, 1, 1],
    lampLevels: { cove: 0, ch_end: 0, ch_centre: 0, dome: 0 }, emitterBoost: 1,
    sunDir, sunRgb: [1, 1, 1], moonDir, moonRgb: [1, 1, 1],
  };
}

function fakeRenderer(log: string[]): ShadowRenderer {
  return {
    getRenderTarget: () => null,
    setRenderTarget: (target) => { log.push(target === null ? "canvas" : "map"); },
    getClearColor: (target: Color) => target,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    clear: () => { log.push("clear"); return undefined; },
    render: () => { log.push("render"); return undefined; },
  };
}

describe("the Sun's and the Moon's shadow maps (T-639 R1d)", () => {
  it("looks along the light at the hall's centre, from outside the hall, with depth growing away from the light", () => {
    const view = lightViewFor([0, -0.6, 0.8], BOX);
    const centre = new Vector3(9, -5, 3.5).applyMatrix4(view.viewProjection);
    expect(Math.abs(centre.x) + Math.abs(centre.y)).toBeLessThan(1e-9);
    expect(view.radius).toBeGreaterThan(Math.hypot(18, 10, 7) / 2);
    const depth = (p: readonly [number, number, number]): number => view.depthOrigin - (p[0] * view.direction[0] + p[1] * view.direction[1] + p[2] * view.direction[2]);
    expect(depth([9, -5, 7])).toBeLessThan(depth([9, -5, 0]));
    expect(depth([9, -5, 3.5])).toBeCloseTo(view.radius, 9);
  });

  it("finds an occluder between a point and the light, and none beside it or behind the bias", () => {
    expect(occludedFrom(PLATE, [9, -5, 1], UP, SHADOW_BIAS)).toBe(true);
    expect(occludedFrom(PLATE, [12, -5, 1], UP, SHADOW_BIAS)).toBe(false);
    expect(occludedFrom(PLATE, [9, -5, 2.99], UP, SHADOW_BIAS)).toBe(false);
    expect(occludedFrom(PLATE, [9, -5, 4], UP, SHADOW_BIAS)).toBe(false);
    expect(occludedFrom(PLATE, [7, -5, 1], [0.6, 0, 0.8], SHADOW_BIAS)).toBe(true);
  });

  it("builds the occluder mesh from the package's triangles", () => {
    const geometry = occluderGeometry(PLATE);
    expect(geometry.getAttribute("position").count).toBe(6);
    geometry.dispose();
  });

  it("redraws a body's map only when that body has turned 0.05°, and neither for a body that is down", () => {
    const shadows = new SkyShadows(PLATE, BOX);
    const log: string[] = [];
    const renderer = fakeRenderer(log);
    expect(shadows.update(renderer, setting(UP))).toBe(1);
    expect(log).toEqual(["map", "clear", "render", "canvas"]);
    const nudged: readonly [number, number, number] = [Math.sin(0.03 * Math.PI / 180), 0, Math.cos(0.03 * Math.PI / 180)];
    expect(shadows.update(renderer, setting(nudged))).toBe(0);
    const turned: readonly [number, number, number] = [Math.sin(0.06 * Math.PI / 180), 0, Math.cos(0.06 * Math.PI / 180)];
    expect(shadows.update(renderer, setting(turned, UP))).toBe(2);
    expect(shadows.update(renderer, setting(null, UP))).toBe(0);
    shadows.dispose();
  });

  it("gives the CPU twin of the drawn maps, lit for a body that is down", () => {
    const shadows = new SkyShadows(PLATE, BOX);
    shadows.update(fakeRenderer([]), setting(UP));
    expect([shadows.cpu([9, -5, 1], "sun"), shadows.cpu([12, -5, 1], "sun"), shadows.cpu([9, -5, 1], "moon")]).toEqual([0, 1, 1]);
    expect(typeof shadows.hook).toBe("function");
    shadows.dispose();
  });
});
```

Create `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx`:

```tsx
import { useContext } from "react";
import { act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CinematicData } from "../../../lib/relight/cinematic-package.js";
import { LightDirector } from "../../../lib/relight/light-director.js";
import { loadRelightModelData, type RelightModelData } from "../../../lib/relight/relight-assets.js";
import { RelightFrame } from "../../../lib/relight/relight-frame.js";
import { buildTestPackage } from "../../../lib/relight/__tests__/relight-test-package.js";
import { cinematicData } from "../../../lib/relight/__tests__/cinematic-fixture.js";
import type { RuntimeAssetViewTransform } from "../../../lib/runtime-package-resolution.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { FloorLightHooksContext } from "../floor-hooks-context.js";
import { RelightCinematic } from "../RelightCinematic.js";
import { SkinLightHooksContext } from "../skin-hooks-context.js";

const IDENTITY: RuntimeAssetViewTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" };
const PLATE = Float32Array.from([8, -6, 3, 10, -6, 3, 10, -4, 3, 8, -6, 3, 10, -4, 3, 8, -4, 3]);
let data: RelightModelData;
let mounted: StubRoot | null = null;
const seen: { floor: unknown; skin: unknown }[] = [];
function Probe(): null {
  seen.push({ floor: useContext(FloorLightHooksContext).interiorShadow, skin: useContext(SkinLightHooksContext).sunShadow });
  return null;
}
const renderer = () => ({
  isWebGPURenderer: true, render: vi.fn(), clear: vi.fn(), setRenderTarget: vi.fn(), getRenderTarget: () => null,
  getClearColor: <T,>(target: T): T => target, getClearAlpha: () => 1, setClearColor: vi.fn(),
});
const cinematic = (): CinematicData => cinematicData({ occluders: PLATE });

beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
afterEach(() => { mounted?.unmount(); mounted = null; seen.length = 0; vi.restoreAllMocks(); });

describe("the cinematic light's mount (T-639 R1d)", () => {
  it("draws the maps, sets the frame's interior shadow and hands it to the floor and the skins", async () => {
    const frame = new RelightFrame(data);
    const director = new LightDirector({ frame, invalidate: () => undefined });
    const setHook = vi.spyOn(frame, "setShadowHook");
    const gl = renderer();
    mounted = mountInStubRoot(<RelightCinematic frame={frame} director={director} data={cinematic()} transform={IDENTITY}><Probe /></RelightCinematic>, 1440, 900, gl);
    await act(async () => { await Promise.resolve(); });
    expect(setHook).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    expect(typeof seen.at(-1)?.floor).toBe("function");
    expect(seen.at(-1)?.skin).toBe(seen.at(-1)?.floor);
    mounted.unmount();
    mounted = null;
    expect(setHook).toHaveBeenLastCalledWith(null, null);
  });

  it("renders the children alone without the package", async () => {
    const frame = new RelightFrame(data);
    mounted = mountInStubRoot(<RelightCinematic frame={frame} director={null} data={null} transform={IDENTITY}><Probe /></RelightCinematic>, 1440, 900, renderer());
    await act(async () => { await Promise.resolve(); });
    expect(seen.at(-1)).toEqual({ floor: null, skin: null });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shadow.test.ts`
Expected: FAIL — cannot find module `../sun-shadow.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: FAIL — cannot find module `../RelightCinematic.js`.

- [ ] **Step 3: The maps** — create `packages/web/src/lib/relight/sun-shadow.ts`:

```ts
import { BufferAttribute, BufferGeometry, Color, DoubleSide, FloatType, Matrix4, Mesh, NearestFilter, OrthographicCamera, RedFormat, Scene, Vector3 } from "three";
import { MeshBasicNodeMaterial, RenderTarget, type Node, type UniformNode, type WebGPURenderer } from "three/webgpu";
import { clamp, dot, float, floor, ivec2, positionWorld, select, textureLoad, uniform, vec2, vec4 } from "three/tsl";
import type { Vec3 } from "./relight-codec.js";
import type { InteriorShadowHook } from "./relight-frame.js";
import type { RelightSetting } from "./relight-kernel.js";

/**
 * The interior occluders' shadow maps for the Sun and the Moon (T-639 R1d, spec §4.2): one orthographic light-depth
 * map per body slot, redrawn only when that body has turned, read with 16 taps by every relit surface (the kernel's
 * pass, the floor, the skins) through one hook, and a hard-edged CPU twin for the DEV checks.
 */
export const SHADOW_MAP_SIZE = 2048;
/** Metres between the 4 × 4 taps (±3 cm), about the Sun's penumbra over a metre. */
export const SHADOW_PCF_SPACING = 0.02;
/** An occluder must be this much nearer the light than the point to shade it. */
export const SHADOW_BIAS = 0.02;
/** A body's map is redrawn once it has turned this far (a quarter of a texel at the far wall). */
export const SHADOW_REDRAW_DEGREES = 0.05;
export type SkyBodyName = "sun" | "moon";
const BODIES: readonly SkyBodyName[] = ["sun", "moon"];
const DEGREES = 180 / Math.PI;
const EMPTY = new Color(0, 0, 0);

export type ShadowRenderer = Pick<WebGPURenderer, "getRenderTarget" | "setRenderTarget" | "getClearColor" | "getClearAlpha" | "setClearColor" | "clear" | "render">;

export interface LightView {
  /** The radius of the sphere the camera sits on, around the hall's box centre. */
  readonly radius: number;
  /** dot(camera position, direction): a point's depth along the light is depthOrigin − dot(point, direction). */
  readonly depthOrigin: number;
  readonly camera: OrthographicCamera;
  readonly viewProjection: Matrix4;
  /** The unit direction toward the body. */
  readonly direction: Vec3;
}

export function lightViewFor(direction: Vec3, box: readonly [Vec3, Vec3]): LightView {
  const [lo, hi] = box;
  const centre = new Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + 1;
  const s = new Vector3(direction[0], direction[1], direction[2]).normalize();
  const position = centre.clone().addScaledVector(s, radius);
  const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, 2 * radius);
  if (Math.abs(s.z) > 0.99) camera.up.set(0, 1, 0);
  else camera.up.set(0, 0, 1);
  camera.position.copy(position);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return {
    radius, depthOrigin: position.dot(s), camera,
    viewProjection: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    direction: [s.x, s.y, s.z],
  };
}

/** Möller–Trumbore: does the ray from origin toward direction meet any triangle farther than minT? */
export function occludedFrom(triangles: Float32Array, origin: Vec3, direction: Vec3, minT: number): boolean {
  const [ox, oy, oz] = origin, [dx, dy, dz] = direction;
  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    const ax = triangles[t] ?? 0, ay = triangles[t + 1] ?? 0, az = triangles[t + 2] ?? 0;
    const e1x = (triangles[t + 3] ?? 0) - ax, e1y = (triangles[t + 4] ?? 0) - ay, e1z = (triangles[t + 5] ?? 0) - az;
    const e2x = (triangles[t + 6] ?? 0) - ax, e2y = (triangles[t + 7] ?? 0) - ay, e2z = (triangles[t + 8] ?? 0) - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > minT) return true;
  }
  return false;
}

export function occluderGeometry(triangles: Float32Array): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(triangles, 3));
  return geometry;
}

interface BodyUniforms {
  readonly viewProjection: UniformNode<"mat4", Matrix4>;
  readonly direction: UniformNode<"vec3", Vector3>;
  readonly depthOrigin: UniformNode<"float", number>;
  readonly texelsPerMetre: UniformNode<"float", number>;
  readonly on: UniformNode<"float", number>;
}

const angleBetween = (a: Vec3, b: Vec3): number => {
  const cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.max(Math.hypot(...a) * Math.hypot(...b), 1e-12);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * DEGREES;
};

export class SkyShadows {
  readonly hook: InteriorShadowHook;
  readonly cpu: (position: Vec3, body: SkyBodyName) => number;
  private readonly triangles: Float32Array;
  private readonly box: readonly [Vec3, Vec3];
  private readonly scene = new Scene();
  private readonly geometry: BufferGeometry;
  private readonly mesh: Mesh;
  private readonly targets: Readonly<Record<SkyBodyName, RenderTarget>>;
  private readonly materials: Readonly<Record<SkyBodyName, MeshBasicNodeMaterial>>;
  private readonly uniforms: Readonly<Record<SkyBodyName, BodyUniforms>>;
  private readonly drawn: Record<SkyBodyName, Vec3 | null> = { sun: null, moon: null };

  constructor(triangles: Float32Array, box: readonly [Vec3, Vec3]) {
    this.triangles = triangles;
    this.box = box;
    this.geometry = occluderGeometry(triangles);
    const make = (): BodyUniforms => ({
      viewProjection: uniform(new Matrix4()), direction: uniform(new Vector3(0, 0, 1)),
      depthOrigin: uniform(0), texelsPerMetre: uniform(1), on: uniform(0),
    });
    this.uniforms = { sun: make(), moon: make() };
    const target = (): RenderTarget => new RenderTarget(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
      type: FloatType, format: RedFormat, depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
    });
    this.targets = { sun: target(), moon: target() };
    const depthMaterial = (body: SkyBodyName): MeshBasicNodeMaterial => {
      const u = this.uniforms[body];
      const material = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false, toneMapped: false });
      material.name = `relight-occluder-depth-${body}`;
      // The distance along the light from the camera; the depth test keeps the occluder nearest the light.
      material.colorNode = vec4(u.depthOrigin.sub(dot(positionWorld, u.direction)), 0, 0, 1);
      return material;
    };
    this.materials = { sun: depthMaterial("sun"), moon: depthMaterial("moon") };
    this.mesh = new Mesh(this.geometry, this.materials.sun);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.hook = (position, body) => this.shadowNode(position, body);
    this.cpu = (position, body) => {
      const direction = this.drawn[body];
      return direction === null ? 1 : occludedFrom(this.triangles, position, direction, SHADOW_BIAS) ? 0 : 1;
    };
  }

  /** Redraw each body's map that has turned 0.05° (or appeared); returns how many maps were drawn. */
  update(renderer: ShadowRenderer, setting: RelightSetting): number {
    let drawn = 0;
    for (const body of BODIES) {
      const direction = body === "sun" ? setting.sunDir : setting.moonDir;
      const u = this.uniforms[body];
      if (direction === null) {
        u.on.value = 0;
        this.drawn[body] = null;
        continue;
      }
      u.on.value = 1;
      const last = this.drawn[body];
      if (last !== null && angleBetween(last, direction) < SHADOW_REDRAW_DEGREES) continue;
      this.draw(renderer, body, direction);
      this.drawn[body] = direction;
      drawn += 1;
    }
    return drawn;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const body of BODIES) {
      this.targets[body].dispose();
      this.materials[body].dispose();
    }
  }

  private draw(renderer: ShadowRenderer, body: SkyBodyName, direction: Vec3): void {
    const view = lightViewFor(direction, this.box);
    const u = this.uniforms[body];
    u.viewProjection.value.copy(view.viewProjection);
    u.direction.value.set(view.direction[0], view.direction[1], view.direction[2]);
    u.depthOrigin.value = view.depthOrigin;
    u.texelsPerMetre.value = SHADOW_MAP_SIZE / (2 * view.radius);
    this.mesh.material = this.materials[body];
    const previous = renderer.getRenderTarget();
    const colour = renderer.getClearColor(new Color());
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.targets[body]);
    renderer.setClearColor(EMPTY, 1);
    void renderer.clear();
    void renderer.render(this.scene, view.camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(colour, alpha);
  }

  /** 16 taps of the body's map around the point's texel: the lit share; 1 when the body slot is empty. */
  private shadowNode(position: Node<"vec3">, body: SkyBodyName): Node<"float"> {
    const u = this.uniforms[body];
    const clip = u.viewProjection.mul(vec4(position, 1));
    // NDC to texels: x right, y down (row 0 at the top of a WebGPU render target).
    const texel = vec2(clip.x.mul(0.5).add(0.5), float(0.5).sub(clip.y.mul(0.5))).mul(SHADOW_MAP_SIZE).toVar();
    const depth = u.depthOrigin.sub(dot(position, u.direction)).toVar();
    const step = u.texelsPerMetre.mul(SHADOW_PCF_SPACING).toVar();
    let lit: Node<"float"> = float(0);
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        const at = clamp(floor(texel.add(vec2(i - 1.5, j - 1.5).mul(step))), vec2(0), vec2(SHADOW_MAP_SIZE - 1));
        const occluder = textureLoad(this.targets[body].texture, ivec2(at)).x;
        lit = lit.add(select(occluder.greaterThan(0).and(occluder.lessThan(depth.sub(SHADOW_BIAS))), float(0), float(1)));
      }
    }
    return select(u.on.greaterThan(0.5), lit.div(16), float(1));
  }
}
```

- [ ] **Step 4: The floor's hooks** — in `packages/web/src/lib/relight/floor-material.ts`, add the imports `import { NO_INTERIOR_SHADOW, type InteriorShadowHook } from "./relight-frame.js";` (merge with the existing import from `./relight-frame.js`) and `import type { SkinSheen, SkinSurface } from "../skins/skin-material.js";`, and directly above `export function litFloorMaterial` add:

```ts
/** R1d: the cinematic light's terms on the floor: the interior shadow (Task 10) and the sheen and reflections (Tasks 17–18). */
export interface FloorLightHooks {
  readonly interiorShadow: InteriorShadowHook | null;
  readonly sheen: ((surface: SkinSurface) => SkinSheen) | null;
}
export const NO_FLOOR_HOOKS: FloorLightHooks = { interiorShadow: null, sheen: null };
```

Replace `export function litFloorMaterial(map: Texture, frame: RelightFrame): MeshBasicNodeMaterial {` with `export function litFloorMaterial(map: Texture, frame: RelightFrame, hooks: FloorLightHooks = NO_FLOOR_HOOKS): MeshBasicNodeMaterial {` and A5's body term

```ts
    const sun = u.sunRgb.mul(floorSunNode(frame, lightUv).mul(max(u.sunDir.z, 0)).mul(u.sunOn))
      .add(u.moonRgb.mul(floorSunNode(frame, lightUv, "moon").mul(max(u.moonDir.z, 0)).mul(u.moonOn)));
```

with:

```ts
    // R1d: each body's direct light through the interior occluders' shadow (Task 10).
    const interior = hooks.interiorShadow ?? NO_INTERIOR_SHADOW;
    const sun = u.sunRgb.mul(floorSunNode(frame, lightUv).mul(max(u.sunDir.z, 0)).mul(u.sunOn).mul(interior(model, "sun")))
      .add(u.moonRgb.mul(floorSunNode(frame, lightUv, "moon").mul(max(u.moonDir.z, 0)).mul(u.moonOn).mul(interior(model, "moon"))));
```

Create `packages/web/src/components/scene/floor-hooks-context.ts`:

```ts
import { createContext } from "react";
import { NO_FLOOR_HOOKS, type FloorLightHooks } from "../../lib/relight/floor-material.js";

/** The cinematic light's hooks into the lit floor (T-639 R1d); RelightCinematic provides them. */
export const FloorLightHooksContext = createContext<FloorLightHooks>(NO_FLOOR_HOOKS);
```

In `packages/web/src/components/stage/StageFloor.tsx`, add `import { useContext } from "react";` (merged into the existing React import) and `import { FloorLightHooksContext } from "../scene/floor-hooks-context.js";`; directly after `  const relightFrame = relight.frame;` add `  const floorHooks = useContext(FloorLightHooksContext);`; replace `      return floor.tiles.map((tile) => litFloorMaterial(tile.map, relightFrame));` with `      return floor.tiles.map((tile) => litFloorMaterial(tile.map, relightFrame, floorHooks));` and `  }, [floor, colourMode, relightFrame]);` with `  }, [floor, colourMode, relightFrame, floorHooks]);`.

- [ ] **Step 5: The mount** — create `packages/web/src/components/scene/RelightCinematic.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import type { CinematicData } from "../../lib/relight/cinematic-package.js";
import { NO_FLOOR_HOOKS, type FloorLightHooks } from "../../lib/relight/floor-material.js";
import type { LightDirector } from "../../lib/relight/light-director.js";
import type { RelightFrame } from "../../lib/relight/relight-frame.js";
import type { WebGPURenderer } from "three/webgpu";
import { SkyShadows } from "../../lib/relight/sun-shadow.js";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import type { SkinLightHooks } from "../../lib/skins/skin-material.js";
import { FloorLightHooksContext } from "./floor-hooks-context.js";
import { SkinLightHooksContext } from "./skin-hooks-context.js";

export interface RelightCinematicProps {
  readonly frame: RelightFrame | null;
  readonly director: LightDirector | null;
  readonly data: CinematicData | null;
  /** The room's model-to-scene placement, for what this mounts into the scene (Tasks 11, 15). */
  readonly transform: RuntimeAssetViewTransform;
  readonly children?: ReactNode;
}

function isShadowRenderer(gl: unknown): gl is WebGPURenderer {
  return typeof gl === "object" && gl !== null && "isWebGPURenderer" in gl && gl.isWebGPURenderer === true;
}

/**
 * The cinematic light inside a relit session (T-639 R1d): the interior shadows of both bodies (this task), then the
 * bulbs, the composer, the shafts, the window view and the probes (Tasks 11–18). Without the package, or on WebGL2,
 * it renders its children alone, and the hall stays relit as R1b and R1c draw it.
 */
export function RelightCinematic({ frame, director, data, children }: RelightCinematicProps): ReactElement {
  const gl = useThree((state) => state.gl);
  const [shadows, setShadows] = useState<SkyShadows | null>(null);

  useEffect(() => {
    const box = data?.probes[0]?.box;
    if (frame === null || director === null || data === null || box === undefined || !isShadowRenderer(gl)) return;
    const created = new SkyShadows(data.occluders, box);
    // The maps exist before any pass reads them: draw them for the light already applied, then hand over the hook.
    if (frame.current !== null) created.update(gl, frame.current.setting);
    frame.setShadowHook(created.hook, created.cpu);
    const stop = director.onLight((light) => { created.update(gl, light.light.setting); });
    setShadows(created);
    return () => {
      stop();
      frame.setShadowHook(null, null);
      created.dispose();
      setShadows(null);
    };
  }, [frame, director, data, gl]);

  const floorHooks = useMemo<FloorLightHooks>(() => ({ ...NO_FLOOR_HOOKS, interiorShadow: shadows?.hook ?? null }), [shadows]);
  const skinHooks = useMemo<SkinLightHooks>(() => ({ sunShadow: shadows?.hook ?? null, sheen: null }), [shadows]);
  return (
    <SkinLightHooksContext.Provider value={skinHooks}>
      <FloorLightHooksContext.Provider value={floorHooks}>{children}</FloorLightHooksContext.Provider>
    </SkinLightHooksContext.Provider>
  );
}
```

In `packages/web/src/components/scene/RelightProvider.tsx`, add `import { RelightCinematic } from "./RelightCinematic.js";`, directly before the provider's `return (` add `  const live = cinematic !== null && cinematic.frame === frame ? cinematic : null;`, and wrap the provider's `{children}` (inside `<RelightContext.Provider value={state}>`) as:

```tsx
      <RelightCinematic frame={frame} director={live?.director ?? null} data={live?.data ?? null} transform={transform}>
        {children}
      </RelightCinematic>
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shadow.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 2 tests.

Then, one per command: `src/components/scene/__tests__/RelightProvider.test.tsx`, `src/components/stage/__tests__/StageFloor.test.tsx`, `src/lib/relight/__tests__/relight-draw.test.ts`. Expected: PASS, each at its count after Task 9 (the floor and the provider render as before without the package).

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/sun-shadow.ts src/lib/relight/floor-material.ts src/components/scene/RelightCinematic.tsx src/components/scene/floor-hooks-context.ts src/components/stage/StageFloor.tsx src/components/scene/RelightProvider.tsx`
Expected: no errors, no problems.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/sun-shadow.ts packages/web/src/lib/relight/__tests__/sun-shadow.test.ts packages/web/src/lib/relight/floor-material.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/floor-hooks-context.ts packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx packages/web/src/components/stage/StageFloor.tsx packages/web/src/components/scene/RelightProvider.tsx && git diff --cached --stat && git commit -m "feat(relight): shadow maps of the interior occluders for the Sun and the Moon (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Crisp frosted candle lamps

**Files:**
- Create: `packages/web/src/lib/relight/bulbs.ts`
- Modify: `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/bulbs.test.ts` (create), `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 8 (`CinematicData`: `bulbs` with per-bulb `intensity`, `envelope`, `glow`; `BulbGroup`, `BulbEnvelope`, `CinematicBulb`), Task 7 (`RelightFrame.setGlow`); R1b's `RelightFrame` (`uniforms.sourceWeights`, `uniforms.display`, `kernelFrame`, `model.probes`, `tileToModel`, `onApply`), `KernelFrame.scenarioCube`, `trilinearCorners`, `cubeEval`, `ProbeField`, `displayNode`, `HIGHLIGHT_KNEE`; three's `LatheGeometry`, `mrt`, `instancedBufferAttribute`.
- Produces (`bulbs.ts`): `BLOOM_SHARE = 0.04`, `BULB_GLASS_ALBEDO = 0.6`, `BULB_SOURCE = { ch_end: 6, ch_centre: 7 }`, `CANDLE_OUTLINE` (radius and height fractions), `LATHE_SEGMENTS = 24`; `envelopeArea(envelope: BulbEnvelope): number`; `envelopeCentroid(envelope: BulbEnvelope): number`; `candleGeometry(envelope: BulbEnvelope): BufferGeometry`; `bulbRadiancePerWeight(intensity: number, area: number): number`; `ambientAt(frame: Pick<KernelFrame, "scenarioCube">, field: ProbeField, position: Vec3): Rgb`; `class CrispBulbs` with `constructor(frame: RelightFrame, data: CinematicData)`, readonly `object: Group` (model frame), `update(frame: RelightFrame): void`, `ambient(group: BulbGroup): Rgb`, `dispose(): void`.
- Produces (mount): `RelightCinematic` draws the lamps at the room's placement, hands the chandeliers to the kernel's glow hiding while they are drawn (`setGlow(data.glow)`, and `[]` when they go) and refreshes their unlit glass after each apply.

The lamps' light already reaches every surface through the bake (the multiplier, the floor, the skins); the crisp lamps give the eye what the capture could not (decision 1): sharp, small, bright frosted glass where the capture's blown-out glow was. Each is a frosted candle envelope (a lathe of a candle-flame outline, 35 mm across and 70 mm tall from the package's `envelope`, a design value for Blake until the venue names its lamp) standing upright at its triangulated position, the centroid of its glowing surface on the point the photographs fix (the table's position is the centroid of the clipped core). Frosted or opal glass glows evenly, so the envelope has one radiance over its whole surface: a convex emitter of even radiance L sends π L S through its surface S, a point of intensity I sends 4π I, so `L = 4 I / S` (for a sphere this is R1b's `I / (π r²)`) with I the bulb's own intensity per unit of its group's weight (Task 3, solved from the floor's bake and divided by the bake's per-bulb refit when it exists). So the glass, the sheen of a lamp (Task 17), its glow and the floor all agree, and no lamp weight is assumed (decision 11): the group's source weight is the package's, times the fade, the dimming tint and the night gain (Task 6), so a lamp fading in on the warm-down passes through amber (the owner's artistic choice; an `led` group fades at constant colour). A small share of the light (`BLOOM_SHARE`, 4%, a design value) leaves the glass and is written to the composer's emission target (Task 13), which spreads it into the glow: energy is moved, never added. Unlit, the glass shows the light around it: its frosted albedo (0.6, a design value) times the isotropic light of the folded scenario probes at the group's centre, refreshed after each apply. The dome has no crisp lamps (its bright class-4 splats are crests lit by LED pin spots).

Verified (7 October): R1b plan lines 4689 (`sourceWeights: uniformArray<"vec3">(sourceWeights, "vec3")`), 2115 (`trilinearCorners`), 2139 (`cubeEval(cube, normal, iso)`), 2068–2086 (`KernelFrame.scenarioCube(index): Float64Array`), 7221–7236 (`RelightSkyPanels`: the model-to-tile matrix `frame.tileToModel.clone().invert()` inside a group at the room's `transform`); `tools/relight/relight/cinematic.py` (Task 3: `SOURCE_INDEX` 6 and 7, `ENVELOPE`); `D:/claude/real-hall/frontier/splats/scripts/10_bulb_table.py:1-9` (a position is the centroid of the bulb's clipped core); three 0.186 `src/geometries/LatheGeometry.js` (`LatheGeometry(points: Vector2[], segments, phiStart, phiLength)`, revolved about +y), `src/nodes/core/MRTNode.js:243` (`mrt`), `src/materials/nodes/NodeMaterial.js:564` (a material's `mrtNode` merges with the renderer's MRT), `src/nodes/accessors/BufferAttributeNode.js:428` (`instancedBufferAttribute`).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/bulbs.test.ts`:

```ts
import { Box3, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultChoice } from "../../light-setting.js";
import { applicationForChoice } from "../relight-apply.js";
import {
  BULB_GLASS_ALBEDO, CrispBulbs, ambientAt, bulbRadiancePerWeight, candleGeometry, envelopeArea, envelopeCentroid,
} from "../bulbs.js";
import type { BulbEnvelope, CinematicData } from "../cinematic-package.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import type { ProbeField } from "../relight-kernel.js";
import { FIXTURE_CENTRES, cinematicData } from "./cinematic-fixture.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
const ENVELOPE: BulbEnvelope = { kind: "candle", radius: 0.0175, height: 0.07 };
const cinematic = (): CinematicData => cinematicData({
  bulbs: [
    { id: "c0_b00", group: "ch_end", chandelier: 0, position: [1, 2, 3], intensity: 2 },
    { id: "c0_b01", group: "ch_end", chandelier: 0, position: [1.1, 2, 3], intensity: 3 },
    { id: "c2_b00", group: "ch_centre", chandelier: 2, position: [5, 5, 6], intensity: 4 },
  ],
  envelope: ENVELOPE,
  glow: FIXTURE_CENTRES.map((centre, id) => ({ centre, crisp: id === 0 || id === 2 })),
});

describe("crisp frosted candle lamps (T-639 R1d)", () => {
  it("glows evenly: a lamp's intensity over a quarter of its glowing surface", () => {
    expect(bulbRadiancePerWeight(2, 0.01)).toBeCloseTo(800, 9);
    const sphere = 4 * Math.PI * 0.02 * 0.02;
    expect(bulbRadiancePerWeight(2, sphere)).toBeCloseTo(2 / (Math.PI * 0.0004), 9);
  });

  it("measures the candle's glowing surface between a cone's and a cylinder's", () => {
    const area = envelopeArea(ENVELOPE);
    expect(area).toBeGreaterThan(Math.PI * 0.0175 * Math.hypot(0.0175, 0.07));
    expect(area).toBeLessThan(2 * Math.PI * 0.0175 * 0.07);
    const centroid = envelopeCentroid(ENVELOPE);
    expect(centroid).toBeGreaterThan(0.2 * 0.07);
    expect(centroid).toBeLessThan(0.5 * 0.07);
  });

  it("stands the candle upright along +z, centred on its glowing surface", () => {
    const geometry = candleGeometry(ENVELOPE);
    const box = new Box3().setFromBufferAttribute(geometry.getAttribute("position"));
    expect(box.max.z - box.min.z).toBeCloseTo(0.07, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(0.035, 4);
    expect(box.min.z).toBeCloseTo(-envelopeCentroid(ENVELOPE), 6);
    geometry.dispose();
  });

  it("reads the light around the glass as the probes' isotropic mean", () => {
    const field: ProbeField = { origin: [0, 0, 0], spacing: 1, shape: [2, 2, 2], valid: () => true, cube: () => new Float32Array(162) };
    const cube = Float64Array.from({ length: 18 }, (_unused, index) => (index < 6 ? 0.3 : index < 12 ? 0.6 : 0.9));
    expect(ambientAt({ scenarioCube: () => cube }, field, [0.5, 0.5, 0.5])).toEqual([0.3, 0.6, 0.9]);
  });

  it("draws one instanced mesh per group at the triangulated positions, unscaled", () => {
    const frame = new RelightFrame(data);
    const bulbs = new CrispBulbs(frame, cinematic());
    const meshes = bulbs.object.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
    expect(meshes.map((mesh) => [mesh.name, mesh.count])).toEqual([["relight-bulbs-ch_end", 2], ["relight-bulbs-ch_centre", 1]]);
    const matrix = new Matrix4();
    meshes[0]?.getMatrixAt(1, matrix);
    const position = new Vector3(), scale = new Vector3();
    matrix.decompose(position, new Quaternion(), scale);
    expect(position.toArray()).toEqual([1.1, 2, 3]);
    expect(scale.toArray()).toEqual([1, 1, 1]);
    bulbs.dispose();
  });

  it("lights the unlit glass by the probes after each apply", () => {
    const frame = new RelightFrame(data);
    frame.apply(applicationForChoice(frame.inputs, defaultChoice("sunny"), (light) => frame.meanLight(light)));
    const bulbs = new CrispBulbs(frame, cinematic());
    bulbs.update(frame);
    const kernel = frame.kernelFrame;
    if (kernel === null) throw new Error("The frame was applied.");
    const expected = ambientAt(kernel, frame.model.probes, [1.05, 2, 3]);
    expect(bulbs.ambient("ch_end")).toEqual([expected[0] * BULB_GLASS_ALBEDO, expected[1] * BULB_GLASS_ALBEDO, expected[2] * BULB_GLASS_ALBEDO]);
    bulbs.dispose();
  });
});
```

In `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx`, append inside its `describe`, before the closing `});` (import `FIXTURE_CENTRES` beside `cinematicData` from `../../../lib/relight/__tests__/cinematic-fixture.js`):

```tsx
  it("hides the chandeliers' glow while the crisp lamps are drawn, and only then (Task 11)", async () => {
    const frame = new RelightFrame(data);
    const director = new LightDirector({ frame, invalidate: () => undefined });
    const glow = vi.spyOn(frame, "setGlow");
    const centre = FIXTURE_CENTRES.map((position, id) => ({ centre: position, crisp: id === 2 }));
    const withLamps: CinematicData = { ...cinematic(), bulbs: [{ id: "c2_b00", group: "ch_centre", chandelier: 2, position: [8.9, -5, 5.5], intensity: 0.02 }], glow: centre };
    mounted = mountInStubRoot(<RelightCinematic frame={frame} director={director} data={withLamps} transform={IDENTITY}><Probe /></RelightCinematic>, 1440, 900, renderer());
    await act(async () => { await Promise.resolve(); });
    expect(glow).toHaveBeenCalledWith(centre);
    mounted.unmount();
    mounted = null;
    expect(glow).toHaveBeenLastCalledWith([]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/bulbs.test.ts`
Expected: FAIL — cannot find module `../bulbs.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: FAIL — the new test (the glow is never handed over).

- [ ] **Step 3: The lamps** — create `packages/web/src/lib/relight/bulbs.ts`:

```ts
import {
  DoubleSide, Group, InstancedBufferAttribute, InstancedMesh, LatheGeometry, Matrix4, Vector2, Vector3, type BufferGeometry,
} from "three";
import { MeshBasicNodeMaterial, type UniformNode } from "three/webgpu";
import { float, instancedBufferAttribute, mrt, uniform, vec4 } from "three/tsl";
import type { BulbEnvelope, BulbGroup, CinematicBulb, CinematicData } from "./cinematic-package.js";
import { HIGHLIGHT_KNEE, displayNode } from "./display.js";
import type { Vec3 } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";
import { cubeEval, trilinearCorners, type KernelFrame, type ProbeField, type Rgb } from "./relight-kernel.js";

/**
 * Crisp frosted candle lamps at the triangulated bulbs (T-639 R1d, decision 1): each glows evenly over its envelope
 * with the radiance its intensity gives, so its glass, sheen and glow agree with the light the bake already throws,
 * and gives a small share of it to the composer's glow; unlit, its frosted glass shows the light around it.
 */
export const BLOOM_SHARE = 0.04;
export const BULB_GLASS_ALBEDO = 0.6;
export const BULB_SOURCE: Readonly<Record<BulbGroup, number>> = { ch_end: 6, ch_centre: 7 };
const BULB_GROUPS: readonly BulbGroup[] = ["ch_end", "ch_centre"];
/** A frosted candle lamp's outline as (radius, height) fractions of the envelope's, base to tip; the holder hides the base. */
export const CANDLE_OUTLINE: readonly (readonly [number, number])[] = [
  [0.8, 0], [0.95, 0.08], [1, 0.2], [0.98, 0.35], [0.88, 0.5], [0.7, 0.65], [0.48, 0.8], [0.26, 0.91], [0.1, 0.98], [0, 1],
];
export const LATHE_SEGMENTS = 24;

const frusta = (envelope: BulbEnvelope): { readonly area: number; readonly height: number }[] =>
  CANDLE_OUTLINE.slice(1).map((point, k) => {
    const previous = CANDLE_OUTLINE[k] ?? point;
    const a = previous[0] * envelope.radius, b = point[0] * envelope.radius;
    const rise = (point[1] - previous[1]) * envelope.height;
    return { area: Math.PI * (a + b) * Math.hypot(b - a, rise), height: ((previous[1] + point[1]) / 2) * envelope.height };
  });

/** The envelope's glowing surface: its sides (the holder covers the base), the sum of the outline's frusta. */
export function envelopeArea(envelope: BulbEnvelope): number {
  return frusta(envelope).reduce((sum, frustum) => sum + frustum.area, 0);
}

/** The height of the glowing surface's centroid above the envelope's base. */
export function envelopeCentroid(envelope: BulbEnvelope): number {
  const parts = frusta(envelope);
  return parts.reduce((sum, frustum) => sum + frustum.area * frustum.height, 0) / envelopeArea(envelope);
}

/** The candle envelope, its axis along +z (the model frame's up), centred on its glowing surface's centroid. */
export function candleGeometry(envelope: BulbEnvelope): BufferGeometry {
  const outline = CANDLE_OUTLINE.map(([radius, height]) => new Vector2(radius * envelope.radius, height * envelope.height));
  const geometry = new LatheGeometry(outline, LATHE_SEGMENTS);
  geometry.translate(0, -envelopeCentroid(envelope), 0);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** An even emitter of radiance L sends π L S through its surface S; a point of intensity I sends 4π I: L = 4 I / S. */
export function bulbRadiancePerWeight(intensity: number, area: number): number {
  return (4 * intensity) / area;
}

/** The isotropic light at a point from the folded scenario probes (trilinear over valid probes). */
export function ambientAt(frame: Pick<KernelFrame, "scenarioCube">, field: ProbeField, position: Vec3): Rgb {
  const { indices, weights } = trilinearCorners(field, position);
  const cube = new Float64Array(18);
  indices.forEach((index, corner) => {
    const weight = weights[corner] ?? 0;
    if (weight === 0) return;
    const scenario = frame.scenarioCube(index);
    for (let value = 0; value < 18; value += 1) cube[value] = (cube[value] ?? 0) + weight * (scenario[value] ?? 0);
  });
  return cubeEval(cube, [0, 0, 1], true);
}

const centreOf = (bulbs: readonly CinematicBulb[]): Vec3 => {
  const sum = bulbs.reduce<[number, number, number]>((total, bulb) => [total[0] + bulb.position[0], total[1] + bulb.position[1], total[2] + bulb.position[2]], [0, 0, 0]);
  return [sum[0] / bulbs.length, sum[1] / bulbs.length, sum[2] / bulbs.length];
};

export class CrispBulbs {
  readonly object = new Group();
  private readonly geometry: BufferGeometry;
  private readonly materials: MeshBasicNodeMaterial[] = [];
  private readonly ambientUniforms = new Map<BulbGroup, UniformNode<"vec3", Vector3>>();
  private readonly centres = new Map<BulbGroup, Vec3>();

  constructor(frame: RelightFrame, data: CinematicData) {
    this.object.name = "relight-bulbs";
    this.geometry = candleGeometry(data.envelope);
    const perIntensity = 4 / envelopeArea(data.envelope);
    const u = frame.uniforms;
    for (const group of BULB_GROUPS) {
      const members = data.bulbs.filter((bulb) => bulb.group === group);
      if (members.length === 0) continue;
      const intensity = instancedBufferAttribute(new InstancedBufferAttribute(Float32Array.from(members, (bulb) => bulb.intensity), 1));
      const ambient = uniform(new Vector3());
      // L = w[k] × I_b × 4 / S. The weight carries the fade, the dimming tint (the owner's artistic warm-down unless
      // the group is LED) and the night gain (Task 6).
      const emitted = u.sourceWeights.element(BULB_SOURCE[group]).mul(intensity).mul(perIntensity);
      const material = new MeshBasicNodeMaterial({ fog: false, toneMapped: false, side: DoubleSide });
      material.name = `relight-bulb-${group}`;
      material.colorNode = vec4(displayNode(emitted.mul(1 - BLOOM_SHARE).add(ambient.mul(BULB_GLASS_ALBEDO)), u.display, float(HIGHLIGHT_KNEE)), 1);
      // The glow's share goes to the composer's emission target (Task 13); without the composer it is not drawn.
      material.mrtNode = mrt({ emission: vec4(emitted.mul(BLOOM_SHARE), 1) });
      const mesh = new InstancedMesh(this.geometry, material, members.length);
      mesh.name = `relight-bulbs-${group}`;
      const matrix = new Matrix4();
      members.forEach((bulb, index) => {
        matrix.makeTranslation(bulb.position[0], bulb.position[1], bulb.position[2]);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.object.add(mesh);
      this.materials.push(material);
      this.ambientUniforms.set(group, ambient);
      this.centres.set(group, centreOf(members));
    }
  }

  /** After each apply: the unlit glass's light, per group, from the folded scenario probes at the group's centre. */
  update(frame: RelightFrame): void {
    const kernel = frame.kernelFrame;
    if (kernel === null) return;
    for (const [group, ambient] of this.ambientUniforms) {
      const centre = this.centres.get(group);
      if (centre === undefined) continue;
      const light = ambientAt(kernel, frame.model.probes, centre);
      ambient.value.set(light[0], light[1], light[2]);
    }
  }

  /** The unlit glass's displayed colour factor (albedo × light) of a group, for tests and the DEV instruments. */
  ambient(group: BulbGroup): Rgb {
    const value = this.ambientUniforms.get(group)?.value;
    return value === undefined ? [0, 0, 0] : [value.x * BULB_GLASS_ALBEDO, value.y * BULB_GLASS_ALBEDO, value.z * BULB_GLASS_ALBEDO];
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.clear();
  }
}
```

(Each bulb's intensity is a per-instance attribute bound by `instancedBufferAttribute` itself, so the groups share one envelope geometry; the envelope is double-sided because the holder leaves its base open.)

- [ ] **Step 4: Mount them** — in `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { CrispBulbs } from "../../lib/relight/bulbs.js";` and `Matrix4` from `three`, rename the destructured `children` line to `export function RelightCinematic({ frame, director, data, transform, children }: RelightCinematicProps): ReactElement {`, and directly after the shadows' `useEffect` add:

```tsx
  const [bulbs, setBulbs] = useState<CrispBulbs | null>(null);
  useEffect(() => {
    if (frame === null || director === null || data === null || data.bulbs.length === 0) return;
    const created = new CrispBulbs(frame, data);
    created.update(frame);
    // Decision 1: the chandeliers' captured glow is hidden only while their crisp lamps are drawn.
    frame.setGlow(data.glow);
    const stop = frame.onApply(() => { created.update(frame); });
    setBulbs(created);
    return () => {
      stop();
      frame.setGlow([]);
      created.dispose();
      setBulbs(null);
    };
  }, [frame, director, data]);
  const modelToTile = useMemo(() => (frame === null ? new Matrix4() : frame.tileToModel.clone().invert()), [frame]);
```

and in its return, directly after the opening `<FloorLightHooksContext.Provider value={floorHooks}>`, add:

```tsx
        {bulbs !== null && (
          <group position={transform.position} rotation={transform.rotation} scale={transform.scale} name="relight-cinematic-model">
            <primitive object={bulbs.object} matrix={modelToTile} matrixAutoUpdate={false} />
          </group>
        )}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/bulbs.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 3 tests.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/bulbs.ts src/components/scene/RelightCinematic.tsx`
Expected: no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/bulbs.ts packages/web/src/lib/relight/__tests__/bulbs.test.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx && git diff --cached --stat && git commit -m "feat(relight): crisp frosted candle lamps at the triangulated bulbs, the chandeliers' captured glow hidden (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The frame composer hook in the native renderer

**Files:**
- Modify: `packages/web/src/lib/native-renderer.ts`, `packages/web/src/components/scene/NativeCanvas.tsx`, `packages/web/src/lib/native-current-view-capture.ts`
- Test: `packages/web/src/lib/__tests__/native-renderer-scope.test.ts`, `packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx`, `packages/web/src/lib/__tests__/native-current-view-capture.test.ts` (modify)

**Interfaces:**
- Consumes: `withNativeRenderScope`, `isNativeCanvasRender` (`native-renderer.ts`); the canvas's render wrapper (`NativeCanvas.tsx`); `captureNativeCurrentView`.
- Produces (`native-renderer.ts`): `interface NativeFrameComposer { compose(renderer: WebGPURenderer, scene: Object3D, camera: Camera, draw: () => void, output?: RenderTarget | null): void }`; `registerNativeFrameComposer(renderer: object, composer: NativeFrameComposer): () => void` (the release removes only that composer); `nativeFrameComposer(renderer: object): NativeFrameComposer | null`.
- Produces (canvas): a top-level canvas render (no target, not nested) is drawn through the registered composer inside the canvas render scope; offscreen, nested and compile draws never are. Produces (capture): a registered composer draws the capture into the capture's own target.

Decision 6: bloom and shafts need the main draw in a render target, and splats' readiness, profiling and GPU completion hooks must still see the main draw. The wrapper enters `withNativeRenderScope` first (the scope records "canvas" from the target at entry, `native-renderer.ts:24`) and only then hands the raw draw to the composer, which renders it into its MRT target and composites to the canvas. Inside the scope `isNativeCanvasRender` stays true, so `NativeSplatScene`'s `onAfterRender` and the GPU completion fence behave exactly as for a direct draw. The composite's own quad draw goes through the wrapped `render` as a nested call, which neither profiles nor opens a scope of its own. Without a registration (no relit, cinematic session), every draw is I1a's own. The capture draws through the composer too, so a PNG of the view (R1b's DEV capture, Task 23's photo check) shows what the visitor sees.

Verified (7 October): `packages/web/src/lib/native-renderer.ts:17-39` (`withNativeRenderScope`: `canvas: previous === undefined && renderer.getRenderTarget() === null`), `:68-72` (`isNativeCanvasRender`); `packages/web/src/components/scene/NativeCanvas.tsx:126-148` (`const draw = native.render.bind(native);`, `native.render = (...args) => {…}`, `renderDepth += 1;`, `withNativeRenderScope(native, args[0], args[1], () => { draw(...args); });`); `packages/web/src/lib/native-current-view-capture.ts:22-38` (the capture's `RenderTarget`, `renderer.setRenderTarget(target);`, `withNativeSplatCapture(scene, camera, () => { renderer.render(scene, camera); });`); `packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx:64-104` (the mocked renderer: `rawRender`, `render`, `renderTarget`, `getRenderTarget`), `:417-437` (the scope test); `packages/web/src/lib/__tests__/native-current-view-capture.test.ts:10-40` (`captureFixture`); `packages/web/src/lib/__tests__/native-renderer-scope.test.ts:1-3` (its imports).

- [ ] **Step 1: Write the failing tests**

In `packages/web/src/lib/__tests__/native-renderer-scope.test.ts`, replace `import { isNativeCanvasRender, withNativeRenderScope } from "../native-renderer.js";` with `import { isNativeCanvasRender, nativeFrameComposer, registerNativeFrameComposer, withNativeRenderScope } from "../native-renderer.js";` and append at the end of the file:

```ts
describe("the frame composer registration (T-639 R1d)", () => {
  it("returns the registered composer until its own release, and no other's release removes it", () => {
    const renderer = {};
    const first = { compose: () => undefined }, second = { compose: () => undefined };
    expect(nativeFrameComposer(renderer)).toBeNull();
    const releaseFirst = registerNativeFrameComposer(renderer, first);
    const releaseSecond = registerNativeFrameComposer(renderer, second);
    releaseFirst();
    expect(nativeFrameComposer(renderer)).toBe(second);
    releaseSecond();
    expect(nativeFrameComposer(renderer)).toBeNull();
  });
});
```

In `packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx`, replace `import { isNativeCanvasRender } from "../../../lib/native-renderer.js";` with `import { isNativeCanvasRender, registerNativeFrameComposer } from "../../../lib/native-renderer.js";` and append inside `describe("NativeCanvas", …)`, before its closing `});`:

```tsx
  it("draws a main frame through a registered composer inside the canvas scope, and never an offscreen one (R1d)", async () => {
    render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("No native renderer was created");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    const scene = new Scene(), camera = new PerspectiveCamera();
    const composed: boolean[] = [];
    const release = registerNativeFrameComposer(instance, {
      compose: (_renderer, composedScene, composedCamera, draw) => {
        composed.push(isNativeCanvasRender(instance, composedScene, composedCamera));
        draw();
      },
    });
    instance.render(scene, camera);
    expect(composed).toEqual([true]);
    expect(instance.rawRender).toHaveBeenLastCalledWith(scene, camera);
    const offscreen = new RenderTarget(1, 1);
    instance.renderTarget = offscreen;
    instance.render(scene, camera);
    instance.renderTarget = null;
    expect(composed).toEqual([true]);
    release();
    instance.render(scene, camera);
    expect(composed).toEqual([true]);
    offscreen.dispose();
  });
```

In `packages/web/src/lib/__tests__/native-current-view-capture.test.ts`, replace `import { registerNativeSceneRenderer } from "../native-renderer.js";` with `import { registerNativeFrameComposer, registerNativeSceneRenderer } from "../native-renderer.js";` and append inside its `describe`, before the closing `});`:

```ts
  it("draws the capture through a registered frame composer into the capture's own target (R1d)", async () => {
    const fixture = captureFixture();
    const outputs: unknown[] = [];
    const release = registerNativeFrameComposer(fixture.renderer, {
      compose: (_renderer, _scene, _camera, draw, output) => { outputs.push(output); draw(); },
    });
    try {
      await captureNativeCurrentView(fixture.scene, fixture.camera);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toBeInstanceOf(RenderTarget);
      expect(fixture.renderer.render).toHaveBeenCalledOnce();
    } finally {
      release();
      fixture.unregister();
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run each, one per command: `src/lib/__tests__/native-renderer-scope.test.ts`, `src/components/scene/__tests__/NativeCanvas.test.tsx`, `src/lib/__tests__/native-current-view-capture.test.ts`.
Expected: each FAILS (`registerNativeFrameComposer` is not exported).

- [ ] **Step 3: The registration** — append to `packages/web/src/lib/native-renderer.ts` (add `RenderTarget` to its `three` type import):

```ts
/**
 * A frame composer (T-639 R1d): draws the main canvas render (`draw`) into its own target and composes the result
 * to `output` (null: the canvas). The canvas wrapper calls it inside the canvas render scope.
 */
export interface NativeFrameComposer {
  compose(renderer: WebGPURenderer, scene: Object3D, camera: Camera, draw: () => void, output?: RenderTarget | null): void;
}
const frameComposers = new WeakMap<object, NativeFrameComposer>();

export function registerNativeFrameComposer(renderer: object, composer: NativeFrameComposer): () => void {
  frameComposers.set(renderer, composer);
  return () => {
    if (frameComposers.get(renderer) === composer) frameComposers.delete(renderer);
  };
}

export function nativeFrameComposer(renderer: object): NativeFrameComposer | null {
  return frameComposers.get(renderer) ?? null;
}
```

- [ ] **Step 4: The canvas** — in `packages/web/src/components/scene/NativeCanvas.tsx`, replace `import { registerNativeSceneRenderer, withNativeRenderScope } from "../../lib/native-renderer.js";` with `import { nativeFrameComposer, registerNativeSceneRenderer, withNativeRenderScope } from "../../lib/native-renderer.js";` and replace `        withNativeRenderScope(native, args[0], args[1], () => { draw(...args); });` with:

```ts
        // R1d: a top-level canvas draw goes through a registered frame composer, inside the canvas scope, so every
        // readiness and profiling hook still sees the main draw; offscreen and nested draws never do.
        const composer = !offscreen && renderDepth === 1 ? nativeFrameComposer(native) : null;
        withNativeRenderScope(native, args[0], args[1], () => {
          if (composer === null) draw(...args);
          else composer.compose(native, args[0], args[1], () => { draw(...args); });
        });
```

- [ ] **Step 5: The capture** — in `packages/web/src/lib/native-current-view-capture.ts`, replace `import { nativeRendererForScene } from "./native-renderer.js";` with `import { nativeFrameComposer, nativeRendererForScene } from "./native-renderer.js";` and `      withNativeSplatCapture(scene, camera, () => { renderer.render(scene, camera); });` with:

```ts
      const composer = nativeFrameComposer(renderer);
      withNativeSplatCapture(scene, camera, () => {
        // R1d: the capture is what the visitor sees, glow and shafts included.
        if (composer === null) renderer.render(scene, camera);
        else composer.compose(renderer, scene, camera, () => { renderer.render(scene, camera); }, target);
      });
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-renderer-scope.test.ts`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/NativeCanvas.test.tsx`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/native-current-view-capture.test.ts`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/native-renderer.ts src/components/scene/NativeCanvas.tsx src/lib/native-current-view-capture.ts`
Expected: no problems.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/native-renderer.ts packages/web/src/components/scene/NativeCanvas.tsx packages/web/src/lib/native-current-view-capture.ts packages/web/src/lib/__tests__/native-renderer-scope.test.ts packages/web/src/components/scene/__tests__/NativeCanvas.test.tsx packages/web/src/lib/__tests__/native-current-view-capture.test.ts && git diff --cached --stat && git commit -m "feat(native): a frame composer hook inside the canvas render scope (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The cinematic composer: MRT, the energy-conserving glow and the eye's GPU measurement

**Files:**
- Create: `packages/web/src/lib/relight/cinematic-composer.ts`
- Modify: `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/cinematic-composer.test.ts` (create), `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 12 (`NativeFrameComposer`, `registerNativeFrameComposer`), Task 11 (the bulbs' `emission` output), Task 9 (`LightDirector.setMeasurement`), Task 5 (`FrameMeasurement`); R1b's `RelightFrame.uniforms.display`, `displayNode`, `HIGHLIGHT_KNEE`, `LUMINANCE`; three's `mrt`, `output`, `positionView`, `BlendMode`, `QuadMesh`, `RenderTarget` (`count`), `Renderer.setMRT`/`getMRT`/`compute`/`getArrayBufferAsync`, `bloom` (`three/addons/tsl/display/BloomNode.js`).
- Produces: `MEASURE_COLUMNS = 64`, `MEASURE_ROWS = 36`, `MEASURE_EVERY = 3`, `EXPECTED_DEPTH_FAR = 1000`, `GLARE_STRENGTH = 1 / 3`, `GLARE_RADIUS = 0.35`; `type GlareNode = (emission: Node<"vec4">) => Node<"vec4">`; `designGlare: GlareNode`; `bloomWeightSum(radius: number): number`; `logAverage(samples: Float32Array): number`; `class CinematicComposer implements NativeFrameComposer` with `constructor(frame: RelightFrame, options?: { readonly glare?: GlareNode; readonly onMeasure?: (measurement: FrameMeasurement) => void; readonly now?: () => number })`, readonly `target: RenderTarget` (textures `output`, `emission`, `depth`), readonly `mrt: MRTNode`, `compose(renderer, scene, camera, draw, output?)`, `setAddition(node: Node<"vec3"> | null): void` (Task 14's shafts), `dispose(): void`.
- Produces (mount): `RelightCinematic` registers the composer on the canvas's renderer and feeds its measurements to the director.

The main draw goes into a three-attachment half-float target (decision 6): `output` (each material's displayed colour, blended as the material blends), `emission` (the bulbs' and the Moon's glow share; every other fragment writes zero with its own alpha, so a splat in front of a bulb dims its glow exactly as it dims its colour) and `depth` (linear view depth, blended by straight alpha, so behind splats it is their expected depth; cleared to 1,000 m). The last two attachments blend by straight alpha whatever the material's own premultiplication (`BlendMode(NormalBlending)` per attachment; three's default for an MRT name without a blend mode is none). The glow is three's bloom pyramid at strength 1/3: its five levels are normalised blurs weighted 1, 0.8, 0.6, 0.4, 0.2 at radius 0 and `mix(f, 1.2 − f, radius)` otherwise, which sums to 3 at every radius, so strength 1/3 spreads exactly the emitted share and adds no light (energy conserving; the high-pass threshold is 0 with a 10⁻⁶ edge, so even a dimmed bulb glows). It is a design glow, not a model of the eye's scatter: the glare is one function of the emission (`glare`), so the frontier study's fit to the CIE disability glare function can replace it (decision 6). The composite is `output + displayNode(glow + addition)`: the added light is shown with the same exposure, white balance and roll-off (knee 0.8) as every relit surface, and with nothing added it is the output exactly (the captured light's identity holds; the half-float target keeps 11 bits, far inside 1/20 of a stop).

The eye's measurement (decision 4): every third composed canvas frame a compute pass samples the `output` attachment on a 64 × 36 grid, divides each luminance by the exposure in force (so the measurement is the scene's light, before the eye) and writes log2 of it; one asynchronous read-back at a time returns the 2,304 values, and their mean (the log-average luminance, robust to the bulbs' highlights) goes to the director with its time. Captures measure nothing.

Verified (7 October): three 0.186 `src/renderers/common/Renderer.js:1298` (`setMRT`), `:1311` (`getMRT`), `:2097` (`getArrayBufferAsync`), `:2877` (`compute`); `src/nodes/core/MRTNode.js:60-81` (outputs; `blendModes` default `{ output: MaterialBlending }`), `:107` (`setBlendMode`), `:121-125` (`getBlendMode`: an unnamed output is `NoBlending`), `:135` (`setClearColor(name, color, alpha)`), `:202-226` (`setup` matches the target's textures by name), `:243` (`mrt`); `src/renderers/common/BlendMode.js:8` (`new BlendMode(blending = NormalBlending)`); `src/renderers/webgpu/utils/WebGPUPipelineUtils.js:140-170` (each attachment's own blend from the MRT); `src/core/RenderTarget.js:148` (`count`); `src/nodes/core/PropertyNode.js:332` (`output`); `src/renderers/common/QuadMesh.js:112-118` (`render(renderer)` renders through `renderer.render`); `examples/jsm/tsl/display/BloomNode.js:86,93,100,107` (`strength`, `radius`, `threshold`, `smoothWidth` uniforms), `:125` (half resolution), `:156` (5 mips), `:348-357` (`updateBefore` sizes to the drawing buffer), `:435-444` (factors 1, 0.8, 0.6, 0.4, 0.2 through `lerpBloomFactor`), `:579-597` (`lerpBloomFactor = mix(factor, 1.2 − factor, radius)`, `bloom` export); `package.json` `"./addons/*": "./examples/jsm/*"`; `@types/three/examples/jsm/tsl/display/BloomNode.d.ts`.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/cinematic-composer.test.ts`:

```ts
import { MaterialBlending, NormalBlending, PerspectiveCamera, RenderTarget, Scene, Vector2 } from "three";
import { WebGPURenderer, type MRTNode } from "three/webgpu";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CinematicComposer, GLARE_STRENGTH, MEASURE_COLUMNS, MEASURE_ROWS, bloomWeightSum, logAverage,
} from "../cinematic-composer.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});

function fake(log: string[], samples: Float32Array = new Float32Array(MEASURE_COLUMNS * MEASURE_ROWS)): WebGPURenderer {
  let target: RenderTarget | null = null;
  let mrt: MRTNode | null = null;
  const renderer: WebGPURenderer = Object.assign(new WebGPURenderer(), {
    getDrawingBufferSize: (size: Vector2) => size.set(320, 180),
    getRenderTarget: () => target,
    setRenderTarget: (next: RenderTarget | null) => { target = next; log.push(next === null ? "canvas" : next.textures.length === 3 ? "mrt" : "capture"); },
    getMRT: () => mrt,
    setMRT: (next: MRTNode | null) => { mrt = next; log.push(next === null ? "mrt off" : "mrt on"); return renderer; },
    render: () => { log.push("composite"); return undefined; },
    compute: () => { log.push("measure"); return undefined; },
    getArrayBufferAsync: () => Promise.resolve(samples.buffer),
  });
  return renderer;
}

describe("the cinematic composer (T-639 R1d)", () => {
  it("keeps the glow's energy: the pyramid's weights sum to 3 at any radius and the strength is a third", () => {
    for (const radius of [0, 0.35, 1]) expect(bloomWeightSum(radius)).toBeCloseTo(3, 12);
    expect(GLARE_STRENGTH * bloomWeightSum(0.35)).toBeCloseTo(1, 12);
    expect(logAverage(Float32Array.from([-1, -3]))).toBe(-2);
  });

  it("names its attachments and blends emission and depth by straight alpha, the output as the material does", () => {
    const composer = new CinematicComposer(new RelightFrame(data));
    expect(composer.target.textures.map((texture) => texture.name)).toEqual(["output", "emission", "depth"]);
    expect(composer.mrt.getBlendMode("output").blending).toBe(MaterialBlending);
    expect([composer.mrt.getBlendMode("emission").blending, composer.mrt.getBlendMode("depth").blending]).toEqual([NormalBlending, NormalBlending]);
    composer.dispose();
  });

  it("draws the main render into its MRT target and composes it to the canvas, restoring both", () => {
    const log: string[] = [];
    const composer = new CinematicComposer(new RelightFrame(data));
    composer.compose(fake(log), new Scene(), new PerspectiveCamera(), () => { log.push("draw"); });
    expect(log).toEqual(["mrt", "mrt on", "draw", "mrt off", "canvas", "composite", "canvas"]);
    expect([composer.target.width, composer.target.height]).toEqual([320, 180]);
    composer.dispose();
  });

  it("composes a capture into the capture's own target and measures nothing then", () => {
    const log: string[] = [];
    const onMeasure = vi.fn();
    const composer = new CinematicComposer(new RelightFrame(data), { onMeasure });
    const capture = new RenderTarget(64, 32);
    for (let frame = 0; frame < 6; frame += 1) composer.compose(fake(log), new Scene(), new PerspectiveCamera(), () => undefined, capture);
    expect(log.filter((entry) => entry === "capture")).toHaveLength(6);
    expect(log).not.toContain("measure");
    composer.dispose();
  });

  it("measures every third canvas frame, one read-back at a time, before the eye's exposure", async () => {
    const log: string[] = [];
    const samples = new Float32Array(MEASURE_COLUMNS * MEASURE_ROWS).fill(-3);
    const measured: number[] = [];
    const frame = new RelightFrame(data);
    const composer = new CinematicComposer(frame, { onMeasure: (measurement) => { measured.push(measurement.logLuminance); }, now: () => 42 });
    const renderer = fake(log, samples);
    for (let index = 0; index < 6; index += 1) composer.compose(renderer, new Scene(), new PerspectiveCamera(), () => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(log.filter((entry) => entry === "measure")).toHaveLength(1);
    expect(measured).toEqual([-3]);
    composer.dispose();
  });
});
```

(The renderer is a real `WebGPURenderer` with its methods replaced, as `native-current-view-capture.test.ts` builds one; nothing is drawn.)

In `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx`, add `import { useThree } from "@react-three/fiber";` and `import { nativeFrameComposer } from "../../../lib/native-renderer.js";`, and append inside its `describe`:

```tsx
  it("registers the cinematic composer on the canvas's renderer while mounted (Task 13)", async () => {
    const frame = new RelightFrame(data);
    const director = new LightDirector({ frame, invalidate: () => undefined });
    let gl: object | null = null;
    function Gl(): null {
      gl = useThree((state) => state.gl);
      return null;
    }
    mounted = mountInStubRoot(<RelightCinematic frame={frame} director={director} data={cinematic()} transform={IDENTITY}><Gl /></RelightCinematic>, 1440, 900, renderer());
    await act(async () => { await Promise.resolve(); });
    if (gl === null) throw new Error("The stub root has a renderer.");
    expect(nativeFrameComposer(gl)).not.toBeNull();
    mounted.unmount();
    mounted = null;
    expect(nativeFrameComposer(gl)).toBeNull();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/cinematic-composer.test.ts`
Expected: FAIL — cannot find module `../cinematic-composer.js`.

- [ ] **Step 3: The composer** — create `packages/web/src/lib/relight/cinematic-composer.ts`:

```ts
import { Color, HalfFloatType, NormalBlending, RenderTarget, Vector2, type Camera, type Object3D } from "three";
import { BlendMode, MeshBasicNodeMaterial, QuadMesh, StorageBufferAttribute, type ComputeNode, type MRTNode, type Node, type WebGPURenderer } from "three/webgpu";
import { Fn, If, Return, dot, float, instanceIndex, ivec2, log2, max, mrt, output, positionView, storage, texture, uint, uniform, vec3, vec4, textureLoad } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { NativeFrameComposer } from "../native-renderer.js";
import { HIGHLIGHT_KNEE, displayNode } from "./display.js";
import type { FrameMeasurement } from "./eye.js";
import type { RelightFrame } from "./relight-frame.js";
import { LUMINANCE } from "./relight-kernel.js";

/**
 * The cinematic composer (T-639 R1d, decisions 4 and 6): the main canvas draw goes into an MRT target (the displayed
 * colour, the glow's emission, the expected depth); the energy-conserving glow and the shafts are added through the
 * same display; and every third frame the GPU measures the frame's log-average luminance for the eye.
 */
export const MEASURE_COLUMNS = 64;
export const MEASURE_ROWS = 36;
export const MEASURE_EVERY = 3;
export const EXPECTED_DEPTH_FAR = 1000;
/** The bloom pyramid's weights sum to 3 at any radius, so a third spreads the emission without adding light. */
export const GLARE_STRENGTH = 1 / 3;
export const GLARE_RADIUS = 0.35;
const BLOOM_FACTORS = [1, 0.8, 0.6, 0.4, 0.2] as const;
const MEASURE_COUNT = MEASURE_COLUMNS * MEASURE_ROWS;

export type GlareNode = (emission: Node<"vec4">) => Node<"vec4">;

/** The sum of three's bloom weights at a radius (BloomNode's lerpBloomFactor). */
export function bloomWeightSum(radius: number): number {
  return BLOOM_FACTORS.reduce((sum, factor) => sum + factor + (1.2 - 2 * factor) * radius, 0);
}

/** R1d's design glow: three's pyramid at a third, no threshold. Replaceable by a fitted glare function (decision 6). */
export const designGlare: GlareNode = (emission) => {
  const node = bloom(emission, GLARE_STRENGTH, GLARE_RADIUS, 0);
  node.smoothWidth.value = 1e-6;
  return node;
};

/** The mean of log2 samples: log2 of the geometric mean luminance. */
export function logAverage(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value;
  return samples.length === 0 ? 0 : sum / samples.length;
}

export class CinematicComposer implements NativeFrameComposer {
  readonly target: RenderTarget;
  readonly mrt: MRTNode;
  private readonly frame: RelightFrame;
  private readonly onMeasure: ((measurement: FrameMeasurement) => void) | null;
  private readonly now: () => number;
  private readonly quad: QuadMesh;
  private readonly material: MeshBasicNodeMaterial;
  private additionNode: Node<"vec3"> | null = null;
  private readonly glare: GlareNode;
  private readonly samples = new StorageBufferAttribute(new Float32Array(MEASURE_COUNT), 1);
  private readonly measureSize = uniform(new Vector2(1, 1));
  private readonly measureExposure = uniform(1);
  private readonly measure: ComputeNode;
  private readonly size = new Vector2();
  private frames = 0;
  private reading = false;

  constructor(frame: RelightFrame, options: { readonly glare?: GlareNode; readonly onMeasure?: (measurement: FrameMeasurement) => void; readonly now?: () => number } = {}) {
    this.frame = frame;
    this.onMeasure = options.onMeasure ?? null;
    this.now = options.now ?? (() => performance.now());
    this.glare = options.glare ?? designGlare;
    this.target = new RenderTarget(1, 1, { type: HalfFloatType, count: 3, depthBuffer: true });
    ["output", "emission", "depth"].forEach((name, index) => { const attachment = this.target.textures[index]; if (attachment !== undefined) attachment.name = name; });
    // Every fragment writes no glow with its own alpha, and its linear view depth; both blend by straight alpha.
    this.mrt = mrt({ output, emission: vec4(0, 0, 0, output.a), depth: vec4(positionView.z.negate(), 0, 0, output.a) });
    this.mrt.setBlendMode("emission", new BlendMode(NormalBlending));
    this.mrt.setBlendMode("depth", new BlendMode(NormalBlending));
    this.mrt.setClearColor("depth", new Color(EXPECTED_DEPTH_FAR, 0, 0), 0);
    this.material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.material.name = "relight-cinematic-composite";
    this.material.colorNode = this.compositeNode();
    this.quad = new QuadMesh(this.material);
    const write = storage(this.samples, "float", MEASURE_COUNT);
    const frameTexture = this.target.textures[0];
    this.measure = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(uint(MEASURE_COUNT)), () => { Return(); });
      const x = float(i.mod(MEASURE_COLUMNS)).add(0.5).div(MEASURE_COLUMNS).mul(this.measureSize.x);
      const y = float(i.div(MEASURE_COLUMNS)).add(0.5).div(MEASURE_ROWS).mul(this.measureSize.y);
      const rgb = textureLoad(frameTexture, ivec2(x, y)).rgb;
      // The scene's light, before the eye: the displayed luminance over the exposure in force.
      write.element(i).assign(log2(max(dot(rgb, vec3(...LUMINANCE)).div(this.measureExposure), 1e-6)));
    })().compute(MEASURE_COUNT, [64]).setName("RelightEyeMeasure");
  }

  /** Light to add before the display (Task 14's shafts), in the relit surfaces' units; null for none. */
  setAddition(node: Node<"vec3"> | null): void {
    this.additionNode = node;
    this.material.colorNode = this.compositeNode();
    this.material.needsUpdate = true;
  }

  compose(renderer: WebGPURenderer, _scene: Object3D, _camera: Camera, draw: () => void, outputTarget: RenderTarget | null = null): void {
    const size = outputTarget === null ? renderer.getDrawingBufferSize(this.size) : this.size.set(outputTarget.width, outputTarget.height);
    if (this.target.width !== size.x || this.target.height !== size.y) this.target.setSize(size.x, size.y);
    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT();
    renderer.setRenderTarget(this.target);
    renderer.setMRT(this.mrt);
    try {
      draw();
    } finally {
      renderer.setMRT(previousMrt);
    }
    renderer.setRenderTarget(outputTarget ?? previousTarget);
    this.quad.render(renderer);
    renderer.setRenderTarget(previousTarget);
    if (outputTarget !== null) return;
    this.frames += 1;
    if (this.onMeasure !== null && this.frames % MEASURE_EVERY === 0 && !this.reading) this.measureFrame(renderer, size);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.measure.dispose();
    this.samples.dispose();
  }

  private compositeNode(): Node<"vec4"> {
    const colour = texture(this.target.textures[0]);
    const glow = this.glare(texture(this.target.textures[1])).rgb;
    const added = this.additionNode === null ? glow : glow.add(this.additionNode);
    // Added light goes through the same display (exposure, white balance, roll-off from 0.8); nothing added is the output exactly.
    return vec4(colour.rgb.add(displayNode(added, this.frame.uniforms.display, float(HIGHLIGHT_KNEE))), 1);
  }

  private measureFrame(renderer: WebGPURenderer, size: Vector2): void {
    this.measureSize.value.set(size.x, size.y);
    this.measureExposure.value = this.frame.uniforms.display.exposure.value;
    void renderer.compute(this.measure);
    this.reading = true;
    void renderer.getArrayBufferAsync(this.samples).then((buffer) => {
      this.reading = false;
      this.onMeasure?.({ logLuminance: logAverage(new Float32Array(buffer)), at: this.now() });
    }, () => { this.reading = false; });
  }
}
```

- [ ] **Step 4: Mount it** — in `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { CinematicComposer } from "../../lib/relight/cinematic-composer.js";` and `import { registerNativeFrameComposer } from "../../lib/native-renderer.js";`, and directly after the bulbs' effect add:

```tsx
  const [composer, setComposer] = useState<CinematicComposer | null>(null);
  useEffect(() => {
    if (frame === null || director === null || data === null || !isShadowRenderer(gl)) return;
    const created = new CinematicComposer(frame, { onMeasure: (measurement) => { director.setMeasurement(measurement); } });
    const release = registerNativeFrameComposer(gl, created);
    setComposer(created);
    return () => {
      release();
      created.dispose();
      setComposer(null);
    };
  }, [frame, director, data, gl]);
```

(`composer` is read by Task 14's shafts.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/cinematic-composer.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/cinematic-composer.ts src/components/scene/RelightCinematic.tsx`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/cinematic-composer.ts packages/web/src/lib/relight/__tests__/cinematic-composer.test.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx && git diff --cached --stat && git commit -m "feat(relight): the cinematic composer: MRT, an energy-conserving glow and the eye's GPU measurement (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Sun and Moon shafts with faint dust

**Files:**
- Create: `packages/web/src/lib/relight/sun-shafts.ts`
- Modify: `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/sun-shafts.test.ts` (create)

**Interfaces:**
- Consumes: Task 13 (`CinematicComposer.target` `depth` attachment, `setAddition`), Task 10 (`SkyShadows.hook`), Task 7/A5 (`sunVisibilityNode`, `skyBody`, `windowVolumeRead`, the frame's `sunRgb`/`moonRgb`/`sunOn`/`moonOn`/`sunDir`/`moonDir` uniforms); three's `Storage3DTexture`, `textureStore`, `texture3D`, `mx_noise_float`; `prefersReducedMotion`.
- Produces: `AIR_VOXEL = 0.2`, `SHAFT_STEPS = 32`, `AIR_SCATTERING = 0.012`, `SHAFT_ANISOTROPY = 0.6`, `DUST_CONTRAST = 0.35`, `DUST_FREQUENCY = 1.6`, `DUST_DRIFT = 0.03`; `airVolumeShape(box: readonly [Vec3, Vec3], voxel: number): readonly [number, number, number]`; `henyeyGreenstein(cosine: number, g: number): number`; `interleavedGradientNoise(x: number, y: number): number`; `class SunShafts` with `constructor(frame: RelightFrame, box: readonly [Vec3, Vec3], interior: InteriorShadowHook, sceneToModel: Matrix4)`, `fillAir(renderer: Pick<WebGPURenderer, "compute">): void` (after each apply), `node(depth: Node<"float">): Node<"vec3">` (the in-scattered light for the composite), `setCamera(camera: Camera): void`, `tick(seconds: number, reducedMotion: boolean): void`, readonly `active: boolean`, `dispose(): void`.

Shafts are the light the air scatters toward the eye from the Sun's and the Moon's beams through the windows (spec §4.2, "sun shafts with faint dust"; the owner's requirement puts the Moon through them too). The air's visibility of each body is computed once per light change into a 20 cm volume over the hall (about 90 × 50 × 35 cells in the Grand Hall; rgba16float, red the Sun, green the Moon), each cell marching the same window volumes, gates and glass as the splats and multiplying by the interior shadow (Tasks 7, 10), so a shaft is exactly where the floor's sunlit patch and the chandeliers' shadows say it is. Each pixel's view ray is then marched to the frame's expected depth (the composer's `depth` attachment, so a splat wall stops it) in 32 steps with interleaved gradient noise (Jimenez 2014) jittering the start, reading the volume trilinearly. The in-scattered light is `π Σ body RGB × V × σ_s × p_HG(cos θ) × Δt` in the relit surfaces' units (a matte surface's displayed value is π times its radiance), with single scattering, σ_s = 0.012 m⁻¹ (faint: about 6% of a metre-long beam's light, a design value) and a Henyey–Greenstein phase with g = 0.6 (forward scattering, so shafts read strongest looking toward the windows). Dust is a slow 3D noise modulating σ_s by ±35% at about 60 cm features, drifting 3 cm a second; under reduced motion it stands still. With no body in, nothing is marched.

Verified (7 October): three 0.186 `src/textures/Storage3DTexture.js` (`new Storage3DTexture(width, height, depth)`), `src/nodes/accessors/StorageTextureNode.js:313` (`textureStore(value, uvNode, storeNode)`), `src/nodes/accessors/Texture3DNode.js:171` (`texture3D`), `src/nodes/materialx/MaterialXNodes.js:66` (`mx_noise_float`), `src/nodes/display/ScreenNode.js:198` (`screenUV`); amendment A5 (`sunVisibilityNode(u, volumes, p, body)`, `skyBody`); R1b plan Task 10 (`windowVolumeRead(frame.windowVolumes)`, one binding per pass), Task 15 (`RelightSkyPanels`: the model-to-scene placement).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/sun-shafts.test.ts`:

```ts
import { Matrix4 } from "three";
import { float } from "three/tsl";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { SunShafts, airVolumeShape, henyeyGreenstein, interleavedGradientNoise } from "../sun-shafts.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});

describe("Sun and Moon shafts (T-639 R1d)", () => {
  it("covers the hall in 20 cm cells", () => {
    expect(airVolumeShape([[0, -10, 0], [18, 0, 7]], 0.2)).toEqual([90, 50, 35]);
  });

  it("scatters by a normalised Henyey–Greenstein phase, forward for g > 0", () => {
    let total = 0;
    const steps = 20000;
    for (let i = 0; i < steps; i += 1) {
      const cosine = -1 + (2 * (i + 0.5)) / steps;
      total += henyeyGreenstein(cosine, 0.6) * 2 * Math.PI * (2 / steps);
    }
    expect(total).toBeCloseTo(1, 4);
    expect(henyeyGreenstein(1, 0.6)).toBeGreaterThan(henyeyGreenstein(-1, 0.6));
    expect(henyeyGreenstein(0.3, 0)).toBeCloseTo(1 / (4 * Math.PI), 12);
  });

  it("jitters by interleaved gradient noise in [0, 1)", () => {
    const values = [[0, 0], [1, 0], [17, 33], [1279, 719]].map(([x, y]) => interleavedGradientNoise(x ?? 0, y ?? 0));
    for (const value of values) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); }
    expect(new Set(values).size).toBe(values.length);
  });

  it("marches nothing while neither body is in, and fills the air once per light change while one is", () => {
    const frame = new RelightFrame(data);
    const shafts = new SunShafts(frame, [[0, -10, 0], [18, 0, 7]], () => float(1), new Matrix4());
    const calls: unknown[] = [];
    frame.uniforms.sunOn.value = 0;
    frame.uniforms.moonOn.value = 0;
    shafts.fillAir({ compute: (node) => { calls.push(node); return undefined; } });
    expect([shafts.active, calls.length]).toEqual([false, 0]);
    frame.uniforms.sunOn.value = 1;
    shafts.fillAir({ compute: (node) => { calls.push(node); return undefined; } });
    expect([shafts.active, calls.length]).toEqual([true, 1]);
    shafts.dispose();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shafts.test.ts`
Expected: FAIL — cannot find module `../sun-shafts.js`.

- [ ] **Step 3: The shafts** — create `packages/web/src/lib/relight/sun-shafts.ts`:

```ts
import { Matrix4, Vector2, Vector3, type Camera } from "three";
import { Storage3DTexture, type ComputeNode, type Node, type WebGPURenderer } from "three/webgpu";
import {
  Fn, If, Loop, Return, dot, exp, float, fract, instanceIndex, ivec3, max, mx_noise_float, normalize, pow, screenUV, select,
  texture3D, textureStore, uint, uniform, vec2, vec3, vec4,
} from "three/tsl";
import type { Vec3 } from "./relight-codec.js";
import { skyBody, sunVisibilityNode, windowVolumeRead, type InteriorShadowHook, type RelightFrame } from "./relight-frame.js";

/**
 * Sun and Moon shafts with faint dust (T-639 R1d, spec §4.2): the air's visibility of each body, once per light
 * change, in a 20 cm volume over the hall (the windows' march × the interior shadow), and a 32-step view-ray march to
 * the frame's expected depth, single scattering with a Henyey–Greenstein phase.
 */
export const AIR_VOXEL = 0.2;
export const SHAFT_STEPS = 32;
/** Scattering of the hall's air per metre (faint: a design value). */
export const AIR_SCATTERING = 0.012;
export const SHAFT_ANISOTROPY = 0.6;
export const DUST_CONTRAST = 0.35;
/** Dust features per metre (about 60 cm across). */
export const DUST_FREQUENCY = 1.6;
/** Metres per second the dust drifts (still under reduced motion). */
export const DUST_DRIFT = 0.03;

export function airVolumeShape(box: readonly [Vec3, Vec3], voxel: number): readonly [number, number, number] {
  const [lo, hi] = box;
  return [Math.ceil((hi[0] - lo[0]) / voxel - 1e-9), Math.ceil((hi[1] - lo[1]) / voxel - 1e-9), Math.ceil((hi[2] - lo[2]) / voxel - 1e-9)];
}

/** The Henyey–Greenstein phase function, normalised over the sphere. */
export function henyeyGreenstein(cosine: number, g: number): number {
  const denominator = 1 + g * g - 2 * g * cosine;
  return (1 - g * g) / (4 * Math.PI * denominator ** 1.5);
}

/** Jimenez (2014), "Next Generation Post Processing in Call of Duty: Advanced Warfare". */
export function interleavedGradientNoise(x: number, y: number): number {
  const inner = 0.06711056 * x + 0.00583715 * y;
  const value = 52.9829189 * (inner - Math.floor(inner));
  return value - Math.floor(value);
}

export class SunShafts {
  private readonly frame: RelightFrame;
  private readonly air: Storage3DTexture;
  private readonly fill: ComputeNode;
  private readonly lo = uniform(new Vector3());
  private readonly extent = uniform(new Vector3());
  private readonly inverseProjection = uniform(new Matrix4());
  private readonly cameraWorld = uniform(new Matrix4());
  private readonly sceneToModel = uniform(new Matrix4());
  private readonly time = uniform(0);
  private readonly resolution = uniform(new Vector2(1, 1));
  private activeValue = false;

  constructor(frame: RelightFrame, box: readonly [Vec3, Vec3], interior: InteriorShadowHook, sceneToModel: Matrix4) {
    this.frame = frame;
    const [nx, ny, nz] = airVolumeShape(box, AIR_VOXEL);
    this.air = new Storage3DTexture(nx, ny, nz);
    this.lo.value.set(box[0][0], box[0][1], box[0][2]);
    this.extent.value.set(nx * AIR_VOXEL, ny * AIR_VOXEL, nz * AIR_VOXEL);
    this.sceneToModel.value.copy(sceneToModel);
    const u = frame.uniforms;
    const volumes = windowVolumeRead(frame.windowVolumes);
    const count = nx * ny * nz;
    this.fill = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(uint(count)), () => { Return(); });
      const x = i.mod(nx), y = i.div(nx).mod(ny), z = i.div(nx * ny);
      const p = this.lo.add(vec3(float(x), float(y), float(z)).add(0.5).mul(AIR_VOXEL)).toVar();
      const sun = select(u.sunOn.greaterThan(0.5), sunVisibilityNode(u, volumes, p).mul(interior(p, "sun")), float(0));
      const moon = select(u.moonOn.greaterThan(0.5), sunVisibilityNode(u, volumes, p, skyBody(u, "moon")).mul(interior(p, "moon")), float(0));
      textureStore(this.air, ivec3(x, y, z), vec4(sun, moon, 0, 1));
    })().compute(count, [64]).setName("RelightAirVisibility");
  }

  get active(): boolean {
    return this.activeValue;
  }

  /** After each apply: the air's view of each body, or nothing while neither is in. */
  fillAir(renderer: Pick<WebGPURenderer, "compute">): void {
    const u = this.frame.uniforms;
    this.activeValue = u.sunOn.value > 0.5 || u.moonOn.value > 0.5;
    if (this.activeValue) void renderer.compute(this.fill);
  }

  setCamera(camera: Camera, width: number, height: number): void {
    this.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.cameraWorld.value.copy(camera.matrixWorld);
    this.resolution.value.set(width, height);
  }

  tick(seconds: number, reducedMotion: boolean): void {
    if (!reducedMotion) this.time.value += seconds;
  }

  /** The in-scattered light along the pixel's view ray to the expected depth (linear view depth). */
  node(depth: Node<"float">): Node<"vec3"> {
    const u = this.frame.uniforms;
    return Fn(() => {
      const ndc = vec2(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y.mul(2)));
      const view = this.inverseProjection.mul(vec4(ndc, 1, 1));
      const viewDir = normalize(view.xyz.div(view.w)).toVar();
      // Distance along the ray to the expected view depth.
      const length = depth.div(max(viewDir.z.negate(), 1e-4)).toVar();
      const origin = this.sceneToModel.mul(this.cameraWorld.mul(vec4(0, 0, 0, 1))).xyz.toVar();
      const direction = normalize(this.sceneToModel.mul(this.cameraWorld.mul(vec4(viewDir, 0))).xyz).toVar();
      const pixel = screenUV.mul(this.resolution);
      const jitter = fract(fract(pixel.x.mul(0.06711056).add(pixel.y.mul(0.00583715))).mul(52.9829189));
      const step = length.div(SHAFT_STEPS).toVar();
      const g = SHAFT_ANISOTROPY;
      const phase = (cosine: Node<"float">): Node<"float"> =>
        float((1 - g * g) / (4 * Math.PI)).div(pow(float(1 + g * g).sub(cosine.mul(2 * g)), 1.5));
      const sunPhase = phase(dot(direction.negate(), u.sunDir)), moonPhase = phase(dot(direction.negate(), u.moonDir));
      const light = vec3(0).toVar();
      Loop(SHAFT_STEPS, ({ i }) => {
        const t = float(i).add(jitter).mul(step);
        const p = origin.add(direction.mul(t));
        const visibility = texture3D(this.air, p.sub(this.lo).div(this.extent)).rg;
        const dust = float(1).add(mx_noise_float(p.mul(DUST_FREQUENCY).add(vec3(this.time.mul(DUST_DRIFT), 0, this.time.mul(DUST_DRIFT * 0.4)))).mul(DUST_CONTRAST));
        const scattering = float(AIR_SCATTERING).mul(dust).mul(exp(t.mul(-AIR_SCATTERING)));
        light.addAssign(u.sunRgb.mul(visibility.x.mul(sunPhase)).add(u.moonRgb.mul(visibility.y.mul(moonPhase))).mul(scattering.mul(step)));
      });
      return light.mul(Math.PI);
    })();
  }

  dispose(): void {
    this.air.dispose();
    this.fill.dispose();
  }
}
```

(`direction.negate()` is toward the eye, so `dot(−direction, body)` is the cosine of the scattering angle between the body's light and the ray toward the eye. Outside the hall's box the volume clamps to its edge, where the air holds the edge cells' visibility.)

- [ ] **Step 4: Mount them** — in `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { SunShafts } from "../../lib/relight/sun-shafts.js";`, `import { prefersReducedMotion } from "../../lib/reduced-motion.js";`, `import { texture } from "three/tsl";`, and `useFrame` from `@react-three/fiber`; directly after the composer's effect add:

```tsx
  // The room's placement: scene → tile (the group's inverse) → model (tileToModel). Tasks 17 and 18 use it too.
  const sceneToModel = useMemo(() => {
    if (frame === null) return new Matrix4();
    const placement = new Matrix4().compose(
      new Vector3(...transform.position), new Quaternion().setFromEuler(new Euler(...transform.rotation)), new Vector3(transform.scale, transform.scale, transform.scale),
    );
    return frame.tileToModel.clone().multiply(placement.invert());
  }, [frame, transform]);
  const [shafts, setShafts] = useState<SunShafts | null>(null);
  useEffect(() => {
    const box = data?.probes[0]?.box;
    if (frame === null || composer === null || shadows === null || box === undefined || !isShadowRenderer(gl)) return;
    const created = new SunShafts(frame, box, shadows.hook, sceneToModel);
    created.fillAir(gl);
    const stop = frame.onApply(() => { created.fillAir(gl); });
    composer.setAddition(created.node(texture(composer.target.textures[2] ?? composer.target.texture).x));
    setShafts(created);
    return () => {
      stop();
      composer.setAddition(null);
      created.dispose();
      setShafts(null);
    };
  }, [frame, composer, shadows, data, gl, sceneToModel]);
  useFrame((state, delta) => {
    if (shafts === null) return;
    shafts.setCamera(state.camera, state.size.width * state.viewport.dpr, state.size.height * state.viewport.dpr);
    shafts.tick(delta, prefersReducedMotion());
  });
```

(`Euler`, `Quaternion`, `Vector3` join `Matrix4` in the `three` import.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shafts.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 4 tests (the stub renderer's `compute` is a mock; add `compute: vi.fn()` to the test's `renderer()` fields if R1b's stub root lacks it).

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/sun-shafts.ts src/components/scene/RelightCinematic.tsx`
Expected: no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/sun-shafts.ts packages/web/src/lib/relight/__tests__/sun-shafts.test.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx && git diff --cached --stat && git commit -m "feat(relight): Sun and Moon shafts with faint dust, stopped by the frame's expected depth (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The view through the windows: the facade opposite, the sky, the Moon's disc and the city's light

**Files:**
- Create: `packages/web/src/lib/relight/window-view.ts`, `packages/web/src/components/scene/RelightWindowView.tsx`
- Modify: `packages/web/src/lib/relight/sky-panels.ts` (a window index per vertex), `packages/web/src/components/scene/RelightCinematic.tsx`, `packages/web/src/components/scene/RelightProvider.tsx`
- Test: `packages/web/src/lib/relight/__tests__/window-view.test.ts` (create), `packages/web/src/lib/relight/__tests__/sky-panels.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`LuminanceCalibration`, `CAPTURE_CALIBRATION`), Task 6 (`SkyLight`, `cityLevel`), Task 8 (`CinematicData.windowRadiance`), Task 9 (`DisplayedLight`, `LightDirector.onDisplayed`, `DirectorCinematic.city`), Task 11 (`BLOOM_SHARE`), Task 13 (the emission target); amendment A3 (`MOON_ANGULAR_RADIUS`, `MOON_CCT`, `MoonPosition`); R1b's `WindowModel` (`frame.x0`, `x1`, `sill`, `top`, `y0`, `xBearing`, `horizon`), `sunAzimuthElevation`, `horizonAt`, `sunDirection`, `cctShift`, `skyPanelWindows`, `skyPanelGeometry`, `displayNode`, `HIGHLIGHT_KNEE`, `LUMINANCE`; three's `attribute`, `positionLocal`, `textureLoad`, `DataTexture`.
- Produces (`window-view.ts`): `FACADE_AZIMUTH = 284.3`, `FACADE_ALBEDO = 0.3`, `FACADE_SKY_VIEW = 0.35`, `FACADE_ROOFLINE` (`[[200, 8.2], [255, 10.35], [292, 13.7]]`), `CITY_FACADE_LUMINANCE = 1`, `SKYGLOW_LUMINANCE = 0.006`, `CITY_CCT = 4000`, `VIEW_POINT_DISTANCE = 2`, `VIEW_POINT_HEIGHT = 1.6`, `EARTHSHINE = 3e-4`; `facadeRoofline(azimuth: number): number`; `facadeSunCosine(position: SolarPosition): number` (0 unless the body lights the facade); `windowSkyFraction(window: WindowModel, cells?: number): number`; `cityColour(daylight: Rgb): Rgb` (luminance 1); `cityWindowWeights(windows: readonly WindowModel[], windowRadiance: readonly number[], skyFractions: readonly number[], calibration: LuminanceCalibration, daylight: Rgb): Rgb[]`; `moonDiscRadiance(moon: MoonPosition, calibration: LuminanceCalibration): number` (frame units); `interface WindowView { readonly sky: readonly Rgb[]; readonly facade: readonly Rgb[]; readonly moonDisc: Rgb; readonly moonDir: Vec3; readonly sunDir: Vec3; readonly moonUp: boolean }`; `interface WindowViewModel { view(light: SkyLight, captured: boolean): WindowView }` (the R2 and frontier hook); `class ClearSkyWindowView implements WindowViewModel` with `constructor(inputs: LightInputs, windows: readonly WindowModel[], windowRadiance: readonly number[], calibration: LuminanceCalibration)`, readonly `skyFractions: readonly number[]`; `class WindowViewPanels` with `constructor(frame: RelightFrame)`, readonly `material`, readonly `geometry`, `show(view: WindowView): void`, `setCamera(modelPosition: Vector3): void`, `dispose(): void`.
- Produces (mount): `RelightWindowView({ frame, director, data, transform })` replaces R1b's sky panels while the cinematic package is in use (the provider draws R1b's panels otherwise); the provider gives the director the city's light (`cityWindowWeights`).

Decision 9. Each window shows what stands beyond it: below that window's measured horizon (R1a's per-window table, the same that gates the Sun) the facade across Glassford Street, above it the sky, and the Moon's disc only where the Moon stands above the facade's roofline. The panel's values come from the light the room actually receives through that window, so the view and the light agree: the window's mean radiance is its weight times the package's window radiance (Task 3; a matte surface's displayed value is π times its radiance), split between the sky and the facade by the window's sky fraction (the share of its view above the horizon, from 2 m inside at eye height, by projected solid angle; the capture-lighting audit measured 0.17–0.45) and a facade model: a Lambertian sandstone wall facing 284.3° (albedo 0.3), lit by its share of the sky (0.35 of it: half the dome, less the hall; a design value), by the Sun or the Moon once either clears the hall's roof as seen from the facade (the audit's sunlit hours give the roofline, about 8° at azimuth 200° to 14° at 292°), and by street lighting at night (about 1 cd/m², the frontier study's §b3 assumption; the evening Matterport stations can measure it). If a model term would exceed the window's measured light, the sky takes none and the facade keeps the window's mean. The city's light also enters the room (Task 6's `extras.city`): each window's mean at full night is the facade's street light over the facade's share of the view plus the skyglow (6 mcd/m²) over the sky's, in the frame's units through the calibration, coloured as a 4,000 K LED; it fades in through dusk with `cityLevel`.

The Moon's disc is drawn at its true angular radius and phase: on the visible hemisphere, a point is lit where its normal faces the Sun (the Sun's direction from the Moon is the Sun's from the Earth to 0.15°), softened over ±0.03 and lifted by a faint earthshine (3 × 10⁻⁴ of full). Its radiance is the Moon's illuminance over its solid angle (about 4,000 cd/m² at full), through the calibration; the bloom's share of it goes to the emission target, so the Moon glows in the night exactly as the bulbs do. The sky's own values are flat in colour with a gentle brightening toward its horizon. All of it is behind one interface (`WindowViewModel`): R2's sky from the weather and the frontier study's spectral sky-view and facade bands replace `ClearSkyWindowView` without touching the panels.

Verified (7 October): R1b plan lines 1702–1722 (`WindowFrame`: `x0`, `x1`, `depth`, `sill`, `top`, `y0`, `xBearing`; the room is y > y0), 1777–1793 (`WindowModel.horizon`, 360 entries), 1826–1838 (`sunAzimuthElevation(dir, xBearing)`, `horizonAt`), 7160–7205 (`skyPanelWindows`, `skyPanelGeometry`: four vertices per window, `uv.y` 0 at the sill), 7221–7236 (`RelightSkyPanels` placement), 7371–7377 (the provider's `RelightSkyPanels`), 4032 (`cctShift`); `D:/claude/splat-quality-20260923/capture-lighting-audit/out/view_sky_fraction.json` (W1 0.39, W2 0.27, W3 0.174, W4 0.393, W5 0.447); `D:/claude/splat-quality-20260923/weather-daylight/opposite_facade.json` (the facade's sunlit hours: 21 March 13:30–17:10, 21 June 14:10–20:00, 21 September 14:20–18:00, 21 December 13:40–13:50) and the Sun's positions at those ends by the proof's NOAA algorithm (azimuth 199.7°/32.9° and 254.7°/10.6° in March; 291.7°/13.7° at the June end; 199.6°/8.7° to 201.9°/8.2° in December); `D:/claude/real-hall/frontier/light/proposal.md` §b3 (the facade fills 55–83% of each view; street-lit facade about 1 cd/m²; skyglow 6 mcd/m²), §f (LED about 4,000 K); three 0.186 `src/nodes/core/AttributeNode.js` (`attribute(name, type)`), `src/nodes/accessors/Position.js` (`positionLocal`), `src/nodes/accessors/TextureNode.js:1034` (`textureLoad`).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/window-view.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { PRESET_DEFAULTS, STEADY_LAMPS, lampTargets, lightForSky, londonLocalToUtc } from "../../light-setting.js";
import { MOON_ANGULAR_RADIUS, moonPosition } from "../../moon.js";
import { solarPosition } from "../../sun.js";
import { CAPTURE_CALIBRATION } from "../eye.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { capturedLight } from "../light-director.js";
import {
  CITY_FACADE_LUMINANCE, ClearSkyWindowView, FACADE_ALBEDO, SKYGLOW_LUMINANCE, cityColour, cityWindowWeights, facadeRoofline,
  facadeSunCosine, moonDiscRadiance, windowSkyFraction,
} from "../window-view.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
const luminance = (rgb: readonly number[]): number => 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);

describe("the view through the windows (T-639 R1d)", () => {
  it("knows when the Sun clears the hall's roof as seen from the facade", () => {
    expect([facadeRoofline(150), facadeRoofline(200), facadeRoofline(227.5), facadeRoofline(292), facadeRoofline(320)]).toEqual([8.2, 8.2, 9.275, 13.7, 13.7]);
    expect(facadeSunCosine({ azimuth: 250, elevation: 20 })).toBeGreaterThan(0);
    expect(facadeSunCosine({ azimuth: 250, elevation: 8 })).toBe(0);
    expect(facadeSunCosine({ azimuth: 100, elevation: 40 })).toBe(0);
  });

  it("measures each window's sky by its horizon: all of it under an open sky, none behind a wall", () => {
    const frame = new RelightFrame(data);
    const first = frame.model.windows[0];
    if (first === undefined) throw new Error("The test package has a window.");
    expect(windowSkyFraction({ ...first, horizon: Array.from({ length: 360 }, () => -90) })).toBeCloseTo(1, 12);
    expect(windowSkyFraction({ ...first, horizon: Array.from({ length: 360 }, () => 90) })).toBe(0);
    const low = windowSkyFraction({ ...first, horizon: Array.from({ length: 360 }, () => 10) });
    const high = windowSkyFraction({ ...first, horizon: Array.from({ length: 360 }, () => 30) });
    expect(low).toBeGreaterThan(high);
  });

  it("brings the street-lit facade and the skyglow into the room at night, as a 4,000 K light", () => {
    const frame = new RelightFrame(data);
    const radiance = [1, 2, 3, 4, 5], fractions = [0.4, 0.3, 0.2, 0.4, 0.45];
    const weights = cityWindowWeights(frame.model.windows, radiance, fractions, CAPTURE_CALIBRATION, frame.inputs.daylightColour);
    const colour = cityColour(frame.inputs.daylightColour);
    expect(luminance(colour)).toBeCloseTo(1, 12);
    const expected = ((1 - 0.3) * CITY_FACADE_LUMINANCE + 0.3 * SKYGLOW_LUMINANCE) / CAPTURE_CALIBRATION.cdPerUnit / (Math.PI * 2);
    expect(luminance(weights[1] ?? [0, 0, 0])).toBeCloseTo(expected, 12);
  });

  it("shines the Moon's disc with its illuminance over its solid angle", () => {
    const omega = Math.PI * (MOON_ANGULAR_RADIUS * Math.PI / 180) ** 2;
    const moon = { azimuth: 139, elevation: 32, distanceKm: 384400, phaseAngle: 0, illuminatedFraction: 1, illuminance: 0.25 };
    expect(moonDiscRadiance(moon, CAPTURE_CALIBRATION)).toBeCloseTo(0.25 / omega / 54, 9);
  });

  it("splits each window's light between the sky and the facade so the view's mean is the light it admits", () => {
    const frame = new RelightFrame(data);
    const radiance = [1, 1, 1, 1, 1];
    const view = new ClearSkyWindowView(frame.inputs, frame.model.windows, radiance, CAPTURE_CALIBRATION);
    const at = londonLocalToUtc(PRESET_DEFAULTS.sunny.date, PRESET_DEFAULTS.sunny.minutes);
    const sun = solarPosition(at, frame.inputs.site.latitude, frame.inputs.site.longitude);
    const moon = moonPosition(at, frame.inputs.site.latitude, frame.inputs.site.longitude);
    const light = lightForSky(frame.inputs, "sunny", sun, moon, lampTargets("off", sun.elevation), STEADY_LAMPS);
    const shown = view.view(light, false);
    frame.model.windows.forEach((_window, k) => {
      const f = view.skyFractions[k] ?? 0;
      const admitted = luminance(light.setting.weights[k] ?? [0, 0, 0]) * Math.PI;
      expect(f * luminance(shown.sky[k] ?? [0, 0, 0]) + (1 - f) * luminance(shown.facade[k] ?? [0, 0, 0])).toBeCloseTo(admitted, 9);
      expect(luminance(shown.facade[k] ?? [0, 0, 0])).toBeGreaterThan(0);
    });
    const captured = view.view(capturedLight(frame.inputs, light.sun, light.moon), true);
    expect(captured.moonUp).toBe(false);
    expect(FACADE_ALBEDO).toBe(0.3);
  });
});
```

In `packages/web/src/lib/relight/__tests__/sky-panels.test.ts`, append inside its `describe`:

```ts
  it("numbers each window's vertices for the window view (R1d)", () => {
    const geometry = skyPanelGeometry([
      { x0: 0, x1: 1, sill: 0, top: 1, glassY: -0.5 },
      { x0: 2, x1: 3, sill: 0, top: 1, glassY: -0.5 },
    ]);
    expect(Array.from(geometry.getAttribute("windowIndex").array)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    geometry.dispose();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/window-view.test.ts`
Expected: FAIL — cannot find module `../window-view.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-panels.test.ts`
Expected: FAIL — the new test (no `windowIndex` attribute).

- [ ] **Step 3: The window index** — in `packages/web/src/lib/relight/sky-panels.ts`, in `skyPanelGeometry`, replace `  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];` with `  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], windowIndices: number[] = [];`, directly after `      uvs.push((x - window.x0) / (window.x1 - window.x0), (z - window.sill) / (window.top - window.sill));` add `      windowIndices.push(index);`, and directly after `  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));` add `  geometry.setAttribute("windowIndex", new BufferAttribute(new Float32Array(windowIndices), 1));`.

- [ ] **Step 4: The view** — create `packages/web/src/lib/relight/window-view.ts`:

```ts
import { DataTexture, DoubleSide, FloatType, NearestFilter, RedFormat, Vector3 } from "three";
import { MeshBasicNodeMaterial, type BufferGeometry, type UniformNode } from "three/webgpu";
import {
  asin, atan, attribute, clamp, cross, dot, float, floor, int, ivec2, max, min, mix, mod, mrt, normalize, positionLocal, select,
  smoothstep, sqrt, textureLoad, uniform, uniformArray, vec3, vec4,
} from "three/tsl";
import { cityLevel, type LightInputs, type SkyLight } from "../light-setting.js";
import { MOON_ANGULAR_RADIUS, MOON_CCT, type MoonPosition } from "../moon.js";
import { sunDirection, type SolarPosition } from "../sun.js";
import { BLOOM_SHARE } from "./bulbs.js";
import { cctShift } from "./daylight.js";
import { HIGHLIGHT_KNEE, displayNode } from "./display.js";
import type { LuminanceCalibration } from "./eye.js";
import type { Vec3 } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";
import { LUMINANCE, horizonAt, sunAzimuthElevation, type Rgb, type WindowModel } from "./relight-kernel.js";
import { skyPanelGeometry, skyPanelWindows } from "./sky-panels.js";

/**
 * What the windows show (T-639 R1d, decision 9): the facade across Glassford Street below each window's measured
 * horizon, the sky above it, the Moon's disc at its phase where it stands above the facade, all scaled to the light
 * the room receives through that window; and the city's light that enters at night.
 */
export const FACADE_AZIMUTH = 284.3;
export const FACADE_ALBEDO = 0.3;
/** The facade's share of the sky's light: half the dome, less the hall (a design value). */
export const FACADE_SKY_VIEW = 0.35;
/** [compass azimuth, elevation]: the Sun must stand above this to light the facade over the hall's roof. */
export const FACADE_ROOFLINE: readonly (readonly [number, number])[] = [[200, 8.2], [255, 10.35], [292, 13.7]];
/** The street-lit facade at night, cd/m² (assumed; the evening stations can measure it). */
export const CITY_FACADE_LUMINANCE = 1;
export const SKYGLOW_LUMINANCE = 0.006;
export const CITY_CCT = 4000;
export const VIEW_POINT_DISTANCE = 2;
export const VIEW_POINT_HEIGHT = 1.6;
export const EARTHSHINE = 3e-4;
const RAD = Math.PI / 180;
const WINDOWS = 5;

const luminanceOf = (rgb: Rgb): number => rgb[0] * LUMINANCE[0] + rgb[1] * LUMINANCE[1] + rgb[2] * LUMINANCE[2];
const times = (rgb: Rgb, scale: number): Rgb => [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];
const plus = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export function facadeRoofline(azimuth: number): number {
  const first = FACADE_ROOFLINE[0], last = FACADE_ROOFLINE[FACADE_ROOFLINE.length - 1];
  if (first === undefined || last === undefined) return 90;
  if (azimuth <= first[0]) return first[1];
  if (azimuth >= last[0]) return last[1];
  for (let i = 1; i < FACADE_ROOFLINE.length; i += 1) {
    const [a1, e1] = FACADE_ROOFLINE[i] ?? last, [a0, e0] = FACADE_ROOFLINE[i - 1] ?? first;
    if (azimuth <= a1) return e0 + (e1 - e0) * (azimuth - a0) / (a1 - a0);
  }
  return last[1];
}

/** The cosine of a body's light on the facade, 0 unless it is in front of the facade and above the hall's roof. */
export function facadeSunCosine(position: SolarPosition): number {
  const facing = Math.cos(position.elevation * RAD) * Math.cos((position.azimuth - FACADE_AZIMUTH) * RAD);
  return facing > 0 && position.elevation > facadeRoofline(position.azimuth) ? facing : 0;
}

/** The share of a window's view above its horizon from 2 m inside at eye height, by projected solid angle. */
export function windowSkyFraction(window: WindowModel, cells = 32): number {
  const { x0, x1, sill, top, y0, xBearing } = window.frame;
  const eye: Vec3 = [(x0 + x1) / 2, y0 + VIEW_POINT_DISTANCE, sill + VIEW_POINT_HEIGHT];
  let sky = 0, total = 0;
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      const x = x0 + (i + 0.5) * (x1 - x0) / cells, z = sill + (j + 0.5) * (top - sill) / cells;
      const d: Vec3 = [x - eye[0], y0 - eye[1], z - eye[2]];
      const length = Math.hypot(...d);
      const weight = (eye[1] - y0) / length / (length * length);
      const { azimuth, elevation } = sunAzimuthElevation([d[0] / length, d[1] / length, d[2] / length], xBearing);
      total += weight;
      if (elevation > horizonAt(window.horizon, azimuth)) sky += weight;
    }
  }
  return total > 0 ? sky / total : 0;
}

/** A 4,000 K LED's colour in the frame's terms, luminance 1. */
export function cityColour(daylight: Rgb): Rgb {
  const shift = cctShift(CITY_CCT);
  const colour: Rgb = [daylight[0] * shift[0], daylight[1] * shift[1], daylight[2] * shift[2]];
  return times(colour, 1 / Math.max(luminanceOf(colour), 1e-12));
}

/**
 * Each window's light at full night from the street-lit facade (over its share of the view) and the skyglow (over the
 * sky's): a mean displayed value P (cd/m² over cd per unit) is π × weight × window radiance, so weight = P / (π R).
 */
export function cityWindowWeights(
  windows: readonly WindowModel[], windowRadiance: readonly number[], skyFractions: readonly number[], calibration: LuminanceCalibration, daylight: Rgb,
): Rgb[] {
  const colour = cityColour(daylight);
  return windows.map((_window, k) => {
    const f = skyFractions[k] ?? 0, radiance = windowRadiance[k] ?? 0;
    if (!(radiance > 0) || !(calibration.cdPerUnit > 0)) return [0, 0, 0];
    const mean = ((1 - f) * CITY_FACADE_LUMINANCE + f * SKYGLOW_LUMINANCE) / calibration.cdPerUnit;
    return times(colour, mean / (Math.PI * radiance));
  });
}

/** The Moon's disc in the frame's units: its illuminance over its solid angle, through the calibration. */
export function moonDiscRadiance(moon: MoonPosition, calibration: LuminanceCalibration): number {
  const omega = Math.PI * (MOON_ANGULAR_RADIUS * RAD) ** 2;
  return calibration.cdPerUnit > 0 ? moon.illuminance / omega / calibration.cdPerUnit : 0;
}

export interface WindowView {
  /** Per window W1..W5, the sky's and the facade's displayed values (before exposure). */
  readonly sky: readonly Rgb[];
  readonly facade: readonly Rgb[];
  readonly moonDisc: Rgb;
  /** Toward the Moon and the Sun, model frame. */
  readonly moonDir: Vec3;
  readonly sunDir: Vec3;
  readonly moonUp: boolean;
}

/** The R2 and frontier hook: what each window shows for a light. */
export interface WindowViewModel {
  view(light: SkyLight, captured: boolean): WindowView;
}

export class ClearSkyWindowView implements WindowViewModel {
  readonly skyFractions: readonly number[];
  private readonly inputs: LightInputs;
  private readonly windowRadiance: readonly number[];
  private readonly calibration: LuminanceCalibration;
  private readonly moonColour: Rgb;
  private readonly cityLight: readonly Rgb[];

  constructor(inputs: LightInputs, windows: readonly WindowModel[], windowRadiance: readonly number[], calibration: LuminanceCalibration) {
    this.inputs = inputs;
    this.windowRadiance = windowRadiance;
    this.calibration = calibration;
    this.skyFractions = windows.map((window) => windowSkyFraction(window));
    const shift = cctShift(MOON_CCT), daylight = inputs.daylightColour;
    const colour: Rgb = [daylight[0] * shift[0], daylight[1] * shift[1], daylight[2] * shift[2]];
    this.moonColour = times(colour, 1 / Math.max(luminanceOf(colour), 1e-12));
    const street = cityColour(daylight);
    this.cityLight = windows.map(() => times(street, CITY_FACADE_LUMINANCE / Math.max(calibration.cdPerUnit, 1e-12)));
  }

  view(light: SkyLight, captured: boolean): WindowView {
    const { setting, sun, moon } = light;
    const sunOnFacade = times(setting.sunRgb, captured ? 0 : facadeSunCosine(sun));
    const moonOnFacade = times(setting.moonRgb, captured ? 0 : facadeSunCosine(moon));
    const city = captured ? 0 : cityLevel(sun.elevation);
    const sky: Rgb[] = [], facade: Rgb[] = [];
    for (let k = 0; k < WINDOWS; k += 1) {
      const f = this.skyFractions[k] ?? 0;
      const mean = times(setting.weights[k] ?? [0, 0, 0], Math.PI * (this.windowRadiance[k] ?? 0));
      const direct = plus(times(plus(sunOnFacade, moonOnFacade), FACADE_ALBEDO), times(this.cityLight[k] ?? [0, 0, 0], city));
      const skyOf = (c: 0 | 1 | 2): number => Math.max(mean[c] - (1 - f) * direct[c], 0) / Math.max(f + (1 - f) * FACADE_ALBEDO * FACADE_SKY_VIEW, 1e-12);
      const skyValue: Rgb = [skyOf(0), skyOf(1), skyOf(2)];
      const model = plus(times(skyValue, FACADE_ALBEDO * FACADE_SKY_VIEW), direct);
      // When the model's own light exceeds what the window admits, the sky takes none and the facade the window's mean.
      const facadeValue: Rgb = f * luminanceOf(skyValue) + (1 - f) * luminanceOf(model) > luminanceOf(mean) * (1 + 1e-9) && f < 1
        ? times(mean, 1 / (1 - f)) : model;
      sky.push(skyValue);
      facade.push(facadeValue);
    }
    const site = this.inputs.site;
    const moonUp = !captured && moon.elevation > 0;
    return {
      sky, facade,
      moonDisc: times(this.moonColour, moonUp ? moonDiscRadiance(moon, this.calibration) : 0),
      moonDir: sunDirection(moon, site), sunDir: sunDirection(sun, site), moonUp,
    };
  }
}

/** The window panels drawing a WindowView: the facade below each window's horizon, the sky and the Moon above it. */
export class WindowViewPanels {
  readonly geometry: BufferGeometry;
  readonly material: MeshBasicNodeMaterial;
  private readonly horizons: DataTexture;
  private readonly sky: Vector3[];
  private readonly facade: Vector3[];
  private readonly moonDisc = uniform(new Vector3());
  private readonly moonDir = uniform(new Vector3(0, 0, 1));
  private readonly sunDir = uniform(new Vector3(0, 0, 1));
  private readonly moonUp = uniform(0);
  private readonly camera = uniform(new Vector3());

  constructor(frame: RelightFrame) {
    const windows = frame.model.windows;
    this.geometry = skyPanelGeometry(skyPanelWindows(windows));
    const table = new Float32Array(360 * WINDOWS);
    windows.forEach((window, k) => { window.horizon.forEach((value, azimuth) => { table[k * 360 + azimuth] = value; }); });
    this.horizons = new DataTexture(table, 360, WINDOWS, RedFormat, FloatType);
    this.horizons.minFilter = NearestFilter;
    this.horizons.magFilter = NearestFilter;
    this.horizons.needsUpdate = true;
    this.sky = Array.from({ length: WINDOWS }, () => new Vector3());
    this.facade = Array.from({ length: WINDOWS }, () => new Vector3());
    const skyValues = uniformArray<"vec3">(this.sky, "vec3"), facadeValues = uniformArray<"vec3">(this.facade, "vec3");
    const xBearing = windows[0]?.frame.xBearing ?? 0;
    const k = int(attribute("windowIndex", "float"));
    const direction = normalize(positionLocal.sub(this.camera));
    // The kernel's convention: azimuth = xBearing − atan2(dy, dx), elevation = asin(dz), model frame z up.
    const elevation = asin(clamp(direction.z, -1, 1)).mul(1 / RAD);
    const azimuth = mod(float(xBearing).sub(atan(direction.y, direction.x).mul(1 / RAD)).add(720), 360);
    const i0 = min(floor(azimuth), 359), fraction = azimuth.sub(i0);
    const horizonAt0 = textureLoad(this.horizons, ivec2(int(i0), k)).x;
    const horizonAt1 = textureLoad(this.horizons, ivec2(int(min(i0.add(1), 359)), k)).x;
    const horizon = mix(horizonAt0, horizonAt1, fraction);
    const above = elevation.greaterThan(horizon);
    const skyValue = skyValues.element(k).mul(float(1.1).sub(smoothstep(horizon, horizon.add(40), elevation).mul(0.2)));
    // The Moon's disc: the visible hemisphere's normal faces the Sun where it is lit.
    const radius = MOON_ANGULAR_RADIUS * RAD;
    const cosine = dot(direction, this.moonDir);
    const offset = direction.sub(this.moonDir.mul(cosine));
    const e1 = normalize(cross(this.moonDir, vec3(0, 0, 1)));
    const e2 = cross(e1, this.moonDir);
    const u = dot(offset, e1).div(radius), w = dot(offset, e2).div(radius);
    const rho2 = u.mul(u).add(w.mul(w));
    const normal = e1.mul(u).add(e2.mul(w)).sub(this.moonDir.mul(sqrt(max(float(1).sub(rho2), 0))));
    const lit = smoothstep(-0.03, 0.03, dot(normal, this.sunDir)).add(EARTHSHINE);
    const onDisc = this.moonUp.greaterThan(0.5).and(above).and(rho2.lessThan(1)).and(cosine.greaterThan(0));
    const disc = this.moonDisc.mul(lit);
    const base = select(above, skyValue, facadeValues.element(k));
    this.material = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false, toneMapped: false });
    this.material.name = "relight-window-view";
    this.material.colorNode = vec4(displayNode(select(onDisc, disc.mul(1 - BLOOM_SHARE), base), frame.uniforms.display, float(HIGHLIGHT_KNEE)), 1);
    this.material.mrtNode = mrt({ emission: vec4(select(onDisc, disc.mul(BLOOM_SHARE), vec3(0)), 1) });
  }

  show(view: WindowView): void {
    view.sky.forEach((value, k) => { this.sky[k]?.set(value[0], value[1], value[2]); });
    view.facade.forEach((value, k) => { this.facade[k]?.set(value[0], value[1], value[2]); });
    this.moonDisc.value.set(view.moonDisc[0], view.moonDisc[1], view.moonDisc[2]);
    this.moonDir.value.set(view.moonDir[0], view.moonDir[1], view.moonDir[2]);
    this.sunDir.value.set(view.sunDir[0], view.sunDir[1], view.sunDir[2]);
    this.moonUp.value = view.moonUp ? 1 : 0;
  }

  /** The eye's position in the model frame, every frame. */
  setCamera(modelPosition: Vector3): void {
    this.camera.value.copy(modelPosition);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.horizons.dispose();
  }
}
```

- [ ] **Step 5: The mount** — create `packages/web/src/components/scene/RelightWindowView.tsx`:

```tsx
import { useEffect, useMemo, type ReactElement } from "react";
import { useFrame } from "@react-three/fiber";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { CinematicData } from "../../lib/relight/cinematic-package.js";
import { CAPTURE_CALIBRATION } from "../../lib/relight/eye.js";
import type { LightDirector } from "../../lib/relight/light-director.js";
import type { RelightFrame } from "../../lib/relight/relight-frame.js";
import { ClearSkyWindowView, WindowViewPanels, type WindowViewModel } from "../../lib/relight/window-view.js";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";

/** The windows' view (T-639 R1d, decision 9), in place of R1b's sky panels while the cinematic light is in use. */
export function RelightWindowView({ frame, director, data, transform, model }: {
  readonly frame: RelightFrame;
  readonly director: LightDirector;
  readonly data: CinematicData;
  readonly transform: RuntimeAssetViewTransform;
  /** The view model: R1d's clear sky by default; R2 and the frontier study supply theirs. */
  readonly model?: WindowViewModel;
}): ReactElement {
  const panels = useMemo(() => new WindowViewPanels(frame), [frame]);
  const view = useMemo(
    () => model ?? new ClearSkyWindowView(frame.inputs, frame.model.windows, data.windowRadiance, CAPTURE_CALIBRATION),
    [model, frame, data],
  );
  const modelToTile = useMemo(() => frame.tileToModel.clone().invert(), [frame]);
  const sceneToModel = useMemo(() => {
    const placement = new Matrix4().compose(
      new Vector3(...transform.position), new Quaternion().setFromEuler(new Euler(...transform.rotation)), new Vector3(transform.scale, transform.scale, transform.scale),
    );
    return frame.tileToModel.clone().multiply(placement.invert());
  }, [frame, transform]);
  useEffect(() => {
    const shown = director.current();
    if (shown !== null) panels.show(view.view(shown.light, shown.captured));
    const stop = director.onDisplayed((light) => { panels.show(view.view(light.light, light.captured)); });
    return () => { stop(); };
  }, [director, panels, view]);
  useEffect(() => () => { panels.dispose(); }, [panels]);
  const eye = useMemo(() => new Vector3(), []);
  useFrame((state) => { panels.setCamera(eye.copy(state.camera.position).applyMatrix4(sceneToModel)); });
  return (
    <group position={transform.position} rotation={transform.rotation} scale={transform.scale} name="relight-window-view">
      <mesh geometry={panels.geometry} material={panels.material} matrix={modelToTile} matrixAutoUpdate={false} name="relight-sky-panel" raycast={() => undefined} />
    </group>
  );
}
```

In `packages/web/src/components/scene/RelightCinematic.tsx`, import `RelightWindowView` and, directly after the bulbs' group in the return, add:

```tsx
        {frame !== null && director !== null && data !== null && (
          <RelightWindowView frame={frame} director={director} data={data} transform={transform} />
        )}
```

In `packages/web/src/components/scene/RelightProvider.tsx`, replace `      {frame !== null && <RelightSkyPanels frame={frame} transform={transform} />}` with `      {frame !== null && live?.data == null && <RelightSkyPanels frame={frame} transform={transform} />}` (the window view replaces R1b's panels once the package is in use), add the imports `import { cityWindowWeights, windowSkyFraction } from "../../lib/relight/window-view.js";`, and replace Task 9's line

```ts
            director.setCinematic({ lamps: found.lamps, eyeAnchors: found.eyeAnchors, city: null, calibration: CAPTURE_CALIBRATION });
```

with:

```ts
            // The city's light through the windows at night (decision 3), built from what each window sees.
            const fractions = frame.model.windows.map((window) => windowSkyFraction(window));
            const city = cityWindowWeights(frame.model.windows, found.windowRadiance, fractions, CAPTURE_CALIBRATION, frame.inputs.daylightColour);
            director.setCinematic({ lamps: found.lamps, eyeAnchors: found.eyeAnchors, city, calibration: CAPTURE_CALIBRATION });
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/window-view.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-panels.test.ts`
Expected: PASS, the Task 0 count plus 1.

Then, one per command: `src/components/scene/__tests__/RelightCinematic.test.tsx`, `src/components/scene/__tests__/RelightProvider.test.tsx`. Expected: PASS at their counts after Task 14 (the provider's panel test runs without the cinematic package and still finds R1b's one panel mesh, named `relight-sky-panel`).

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/window-view.ts src/lib/relight/sky-panels.ts src/components/scene/RelightWindowView.tsx src/components/scene/RelightCinematic.tsx src/components/scene/RelightProvider.tsx`
Expected: no errors, no problems.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/window-view.ts packages/web/src/lib/relight/__tests__/window-view.test.ts packages/web/src/lib/relight/sky-panels.ts packages/web/src/lib/relight/__tests__/sky-panels.test.ts packages/web/src/components/scene/RelightWindowView.tsx packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/RelightProvider.tsx && git diff --cached --stat && git commit -m "feat(relight): the windows show the street, the sky and the Moon at its phase; the city lights the night (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Night vision: the display's scotopic shift

**Files:**
- Modify: `packages/web/src/lib/relight/display.ts`, `packages/web/src/lib/relight/relight-frame.ts`, `packages/web/src/lib/relight/light-director.ts`
- Test: `packages/web/src/lib/relight/__tests__/display.test.ts`, `packages/web/src/lib/relight/__tests__/relight-frame.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`EyeTarget.scotopic`), Task 7 (`RelightFrame.setDisplay`), Task 9 (the director's apply and display writes); R1b's `display.ts` (`DisplayParams`, `DisplayUniforms`, `displayColour`, `displayNode`) and the frame's `display` uniforms.
- Produces (`display.ts`): `DisplayParams.scotopic?: number`; `DisplayUniforms.scotopic?: UniformNode<"float", number>` and `DisplayUniforms.linear?: UniformNode<"float", number>` (Task 18's probes); `NIGHT_TINT: Rgb` (luminance 1); `scotopicLuminance(rgb: Rgb): number`; `SCOTOPIC_WHITE`; `nightVision(rgb: Rgb, amount: number): Rgb` (CPU) and `nightVisionNode(rgb: Node<"vec3">, amount: Node<"float">): Node<"vec3">` (TSL; the frontier study's upgrade point); `displayColour` and `displayNode` apply it first when the amount is present.
- Produces (frame): the display uniforms gain `scotopic` (0) and `linear` (0); `apply` and `setDisplay` write `scotopic` (0 when absent).

Decision 4: the shift follows the absolute luminance the eye adapts to (Task 5's `scotopicAmount`, through the capture's calibration), never the preset, so the captured light and the lamp-lit night (about 9 and 7 cd/m²) are untouched and only dimmed lamps, the blue hour without lamps and moonlight go toward the rods. The stage is Thompson, Shirley & Ferwerda's (2002, *A spatial post-processing algorithm for images of night scenes*, *Journal of Graphics Tools* 7(1):1–12): the scotopic luminance V = Y[1.33(1 + (Y + Z)/X) − 1.68] from the linear colour's CIE XYZ (sRGB primaries, D65), shown in their bluish night colour (CIE xy 0.25, 0.25, at luminance 1), mixed in by the amount. V is normalised by its value for the display's white (about 2.57), so a neutral grey keeps its luminance and a warm surface darkens toward the rods as it should (the Purkinje shift: incandescent light's scotopic-to-photopic ratio is about 1.4 against daylight's 2.5). It is applied to the linear light before exposure, in the one display every relit surface and the composer's added light pass through, so it is consistent everywhere; at amount 0 it is the identity exactly (`mix(c, ·, 0)` is `c`). The frontier study's mesopic model (Wanat & Mantiuk's rod gains with CAT16 chromatic adaptation, its §c7) replaces `nightVisionNode` with the same inputs.

Verified (7 October): R1b plan lines 3516–3580 (`display.ts`: `import { float, max, min, mix, select, vec3 } from "three/tsl";`, `DisplayParams`, `displayColour`, `DisplayUniforms { exposure, whiteBalance }`, `displayNode(rgb, display, knee)` beginning `const c = rgb.mul(display.exposure).mul(display.whiteBalance);`), 4705 (`display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)) } satisfies DisplayUniforms,`), 4925–4926 (`apply` writes `u.display.exposure` and `u.display.whiteBalance`), 3342–3360 (the display tests); this plan's Task 7 (`setDisplay`), Task 9 (`frame.apply({ … display: { exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance } })`, `this.frame.setDisplay({ exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance })`).

- [ ] **Step 1: Write the failing tests** — append to `packages/web/src/lib/relight/__tests__/display.test.ts`, inside its `describe` (add `NIGHT_TINT`, `SCOTOPIC_WHITE`, `nightVision` and `scotopicLuminance` to its import from `../display.js`, and `import { planckRgb } from "../lamp-dimming.js";`):

```ts
  it("leaves the colour exactly as it is without the shift (R1d)", () => {
    expect(nightVision([0.4, 0.3, 0.2], 0)).toEqual([0.4, 0.3, 0.2]);
    expect(displayColour([0.4, 0.3, 0.2], { exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 })).toEqual([0.4, 0.3, 0.2]);
  });

  it("shows a grey at its own luminance in the night's colour, and darkens warm light toward the rods (R1d)", () => {
    const luminance = (rgb: readonly number[]): number => 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    expect(luminance(NIGHT_TINT)).toBeCloseTo(1, 12);
    expect(SCOTOPIC_WHITE).toBeCloseTo(2.573, 3);
    const grey = nightVision([0.5, 0.5, 0.5], 1);
    expect(luminance(grey)).toBeCloseTo(0.5, 9);
    expect(grey[2]).toBeGreaterThan(grey[0]);
    const lamp = planckRgb(2750);
    const warm = nightVision([lamp[0] / luminance(lamp), 1 / luminance(lamp), lamp[2] / luminance(lamp)], 1);
    expect(luminance(warm)).toBeLessThan(0.7);
    expect(scotopicLuminance([1, 1, 1])).toBe(SCOTOPIC_WHITE);
  });

  it("mixes in by the amount before exposure (R1d)", () => {
    const half = displayColour([0.5, 0.5, 0.5], { exposure: 2, whiteBalance: [1, 1, 1], scotopic: 0.5 });
    const expected = nightVision([0.5, 0.5, 0.5], 0.5).map((value) => value * 2);
    half.forEach((value, c) => { expect(value).toBeCloseTo(expected[c] ?? Number.NaN, 12); });
  });
```

Append to `packages/web/src/lib/relight/__tests__/relight-frame.test.ts`, inside its `describe`:

```ts
  it("carries the eye's scotopic amount, 0 unless given, and a linear switch for the probes (R1d)", () => {
    const frame = new RelightFrame(data);
    expect([frame.uniforms.display.scotopic.value, frame.uniforms.display.linear.value]).toEqual([0, 0]);
    frame.setDisplay({ exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0.4 });
    expect(frame.uniforms.display.scotopic.value).toBe(0.4);
    frame.setDisplay({ exposure: 1, whiteBalance: [1, 1, 1] });
    expect(frame.uniforms.display.scotopic.value).toBe(0);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/display.test.ts`
Expected: FAIL — `nightVision` is not exported.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-frame.test.ts`
Expected: FAIL — `display.scotopic` is undefined.

- [ ] **Step 3: The display** — in `packages/web/src/lib/relight/display.ts`, replace `import { float, max, min, mix, select, vec3 } from "three/tsl";` with `import { dot, float, max, min, mix, select, vec3 } from "three/tsl";`, replace the `DisplayParams` interface with:

```ts
export interface DisplayParams {
  readonly exposure: number;
  readonly whiteBalance: Rgb;
  /** R1d: how far toward the rods' response (0 none … 0.6), applied before exposure; absent means 0. */
  readonly scotopic?: number;
}
```

and replace `export interface DisplayUniforms {` and its two members with:

```ts
export interface DisplayUniforms {
  readonly exposure: UniformNode<"float", number>;
  readonly whiteBalance: UniformNode<"vec3", Vector3>;
  /** R1d: the eye's scotopic amount (Task 16). */
  readonly scotopic?: UniformNode<"float", number>;
  /** R1d: 1 draws linear light with no display at all (Task 18's reflection probes). */
  readonly linear?: UniformNode<"float", number>;
}
```

Directly above `export function displayColour` add:

```ts
/** Thompson, Shirley & Ferwerda (2002): the night's bluish colour, CIE xy (0.25, 0.25), in linear sRGB at luminance 1. */
export const NIGHT_TINT: Rgb = ((): Rgb => {
  const X = 1, Y = 1, Z = 2;
  const rgb: Rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [rgb[0] / luminance, rgb[1] / luminance, rgb[2] / luminance];
})();

/** Thompson et al.'s scotopic luminance V = Y[1.33(1 + (Y + Z)/X) − 1.68] of a linear sRGB colour. */
export function scotopicLuminance(rgb: Rgb): number {
  const X = 0.4124 * rgb[0] + 0.3576 * rgb[1] + 0.1805 * rgb[2];
  const Y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const Z = 0.0193 * rgb[0] + 0.1192 * rgb[1] + 0.9505 * rgb[2];
  return Y * (1.33 * (1 + (Y + Z) / Math.max(X, 1e-6)) - 1.68);
}

/** V of the display's white: a grey keeps its luminance under the shift. */
export const SCOTOPIC_WHITE = scotopicLuminance([1, 1, 1]);

/** The night-vision stage (R1d, decision 4): mix toward V in the night's colour; the identity at 0. */
export function nightVision(rgb: Rgb, amount: number): Rgb {
  if (amount === 0) return rgb;
  const v = Math.max(scotopicLuminance(rgb), 0) / SCOTOPIC_WHITE;
  return [rgb[0] + (NIGHT_TINT[0] * v - rgb[0]) * amount, rgb[1] + (NIGHT_TINT[1] * v - rgb[1]) * amount, rgb[2] + (NIGHT_TINT[2] * v - rgb[2]) * amount];
}

/** nightVision in TSL: the one stage the frontier study's mesopic model replaces. */
export function nightVisionNode(rgb: Node<"vec3">, amount: Node<"float">): Node<"vec3"> {
  const X = dot(rgb, vec3(0.4124, 0.3576, 0.1805)), Y = dot(rgb, vec3(0.2126, 0.7152, 0.0722)), Z = dot(rgb, vec3(0.0193, 0.1192, 0.9505));
  const v = max(Y.mul(float(1.33).mul(float(1).add(Y.add(Z).div(max(X, 1e-6)))).sub(1.68)), 0).div(SCOTOPIC_WHITE);
  return mix(rgb, vec3(...NIGHT_TINT).mul(v), amount);
}
```

In `displayColour`, replace its first line `  const c: Rgb = [rgb[0] * params.exposure * params.whiteBalance[0], rgb[1] * params.exposure * params.whiteBalance[1], rgb[2] * params.exposure * params.whiteBalance[2]];` with:

```ts
  const seen = nightVision(rgb, params.scotopic ?? 0);
  const c: Rgb = [seen[0] * params.exposure * params.whiteBalance[0], seen[1] * params.exposure * params.whiteBalance[1], seen[2] * params.exposure * params.whiteBalance[2]];
```

In `displayNode`, replace `  const c = rgb.mul(display.exposure).mul(display.whiteBalance);` with:

```ts
  const seen = display.scotopic === undefined ? rgb : nightVisionNode(rgb, display.scotopic);
  const c = seen.mul(display.exposure).mul(display.whiteBalance);
```

and its final `  return select(peak.greaterThan(knee), rolled, c);` with:

```ts
  const shown = select(peak.greaterThan(knee), rolled, c);
  // R1d: the reflection probes record linear light, before any display (Task 18).
  return display.linear === undefined ? shown : select(display.linear.greaterThan(0.5), rgb, shown);
```

- [ ] **Step 4: The frame and the director** — in `packages/web/src/lib/relight/relight-frame.ts`, replace `    display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)) } satisfies DisplayUniforms,` with `    display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)), scotopic: uniform(0), linear: uniform(0) },`; in `apply`, directly after `    u.display.whiteBalance.value.set(display.whiteBalance[0], display.whiteBalance[1], display.whiteBalance[2]);` add `    u.display.scotopic.value = display.scotopic ?? 0;`; and in Task 7's `setDisplay`, add as its last line `    this.uniforms.display.scotopic.value = display.scotopic ?? 0;`.

In `packages/web/src/lib/relight/light-director.ts`, replace `      this.frame.apply({ setting: light.setting, sun: weather === null ? null : sky.sun, display: { exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance } });` with `      this.frame.apply({ setting: light.setting, sun: weather === null ? null : sky.sun, display: frame.eye });` and `      this.frame.setDisplay({ exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance });` with `      this.frame.setDisplay(frame.eye);` (an `EyeTarget` is a `DisplayParams` with its scotopic amount).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/display.test.ts`
Expected: PASS, the Task 0 count plus 3 (R1b's own display tests unchanged).

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-frame.test.ts`
Expected: PASS, the count after Task 7 plus 1.

Then, one per command: `src/lib/relight/__tests__/light-director.test.ts`, `src/lib/relight/__tests__/relight-draw.test.ts`, `src/components/scene/__tests__/RelightProvider.test.tsx`. Expected: PASS at their counts (the captured light's display is `{ exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 }`; where an R1b test compares `frame.current.display` with `toEqual(PRESET_DISPLAY.captured)`, the director path now includes `scotopic: 0`: change that expectation to `toMatchObject(PRESET_DISPLAY.captured)`).

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/display.ts src/lib/relight/relight-frame.ts src/lib/relight/light-director.ts`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/display.ts packages/web/src/lib/relight/relight-frame.ts packages/web/src/lib/relight/light-director.ts packages/web/src/lib/relight/__tests__/display.test.ts packages/web/src/lib/relight/__tests__/relight-frame.test.ts && git status --short packages/web/src && git diff --cached --stat
```

If Step 5 changed an R1b test's expectation, add that file by its path; then:

```bash
cd D:/claude/real-hall/repo && git commit -m "feat(relight): night vision from absolute luminance, the identity in the photopic hall (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: GGX sheen from the Sun, the Moon, the lamps and the windows

**Files:**
- Create: `packages/web/src/lib/relight/sheen.ts`
- Modify: `packages/web/src/lib/relight/floor-material.ts`, `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/sheen.test.ts` (create)

**Interfaces:**
- Consumes: R1c's `SkinSurface` (`position`, `normal`, `albedo`, `roughness`, `metal`, `bodyVisibility(body)`) and `SkinSheen` (`diffuseScale`, `specular`); Task 10 (`FloorLightHooks.sheen`, `InteriorShadowHook`), Task 8 (`CinematicData`: `bulbs` with per-bulb `intensity`, `envelope`, `glow`, `windowRadiance`), Task 11 (`BULB_SOURCE`); R1b's frame uniforms (`sunDir`, `sunRgb`, `sunOn`, `moonDir`, `moonRgb`, `moonOn`, `sourceWeights`), the floor material's `model`, `lightUv`, `floorSunNode`.
- Produces: `MIN_ROUGHNESS = 0.05`, `FLOOR_ROUGHNESS = 0.3`, `DIELECTRIC_F0 = 0.04`, `METAL_DIFFUSE_SCALE = 0.5`, `MAX_LAMP_LIGHTS = 8`, `UNCOVERED_LAMP_RADIUS = 0.75`; `ggxDistribution(nDotH: number, alpha: number): number`; `smithCorrelatedVisibility(nDotL: number, nDotV: number, alpha: number): number`; `fresnelSchlick(f0: number, vDotH: number): number`; `envBrdfApprox(f0: number, roughness: number, nDotV: number): number` (Karis 2014); `interface LampLight3 { readonly position: Vec3; readonly radius: number; readonly source: number; readonly intensity: number }` (one per chandelier); `lampLightsOf(data: CinematicData): LampLight3[]`; `type ReflectionHook = (position: Node<"vec3">, direction: Node<"vec3">, roughness: Node<"float">) => Node<"vec3">`; `class CinematicSheen` with `constructor(frame: RelightFrame, data: CinematicData, interior: InteriorShadowHook | null)`, readonly `hook: (surface: SkinSurface) => SkinSheen`, `setCamera(modelPosition: Vector3): void`, `setWeight(weight: number): void` (the displayed light's `sheen`: 0 at the captured light), `setReflections(hook: ReflectionHook | null): void` (Task 18).
- Produces (floor): `litFloorMaterial` with `hooks.sheen` set adds the floor's sheen (roughness 0.3, dielectric) and scales its base light by `diffuseScale`.

Spec §4.2 asks for "GGX sheen using R1c's maps". The specular is Cook–Torrance with the GGX distribution, the height-correlated Smith visibility and Schlick's Fresnel (F0 = mix(0.04, albedo, metal); roughness from R1c's map, α = roughness², floored at 0.05 so the Sun's 0.53° disc never becomes a single texel's flash), in the relit surfaces' units (a matte surface shows π times its radiance, so a specular term is π × BRDF × E × cos). Its lights:
- **The Sun and the Moon**, the kernel's two body slots: each body's light gated exactly as the surface's diffuse light is (R1c's `bodyVisibility`, the window march at the pixel; the floor's own sun or moon grid) and by the interior shadow (Task 10).
- **The lamps**, one sphere light per chandelier: for a chandelier with crisp lamps its centre and radius span them and its intensity is the sum of theirs (Task 3's per-bulb intensities, times the group's source weight, so it carries the fade, the dimming tint and the night gain); for a chandelier the bulb table does not cover yet, a 0.75 m sphere (its volume's radius) at the proof's centre with its group's mean lamps, as Task 3 counts it on the floor. The dome has none: its light comes from 14 crests lit by LED pin spots, a broad source whose specular R1d leaves out. A sphere light by Karis's representative point (*Real Shading in Unreal Engine 4*, 2013): the point on the sphere nearest the reflected ray, with the energy-conserving widening α' = clamp(α + R / (2d)) and normalisation (α/α')².
- **The windows**, one rectangle each, their radiance the window's weight times the package's window radiance: also by representative point (the reflected ray's crossing of the window plane, clamped to the opening) with the same widening by the window's half-size over its distance.
- **The probes** (Task 18): their prefiltered radiance along the reflected ray times Karis's analytic environment BRDF (*Physically Based Shading on Mobile*, 2014).
At the captured light the sheen is weighted to nothing (the displayed light's `sheen`, Task 9: 0 for the captured light, 1 for a computed sky, carried by the cross-fade): the capture's splats and floor already hold its own reflections, and spec §4.3 wants the hall exactly as captured there; the weight multiplies the specular and the gilding's diffuse share alike, so at 0 every surface is exactly R1b's and R1c's. Gilding keeps half of its diffuse light (`diffuseScale` 1 − 0.5 × metal × weight): its captured albedo already holds part of what it reflected under the capture's diffuse light, and the probes now carry that share as reflection (a design value for Blake). The floor uses the same sheen with roughness 0.3, a waxed oak floor (a design value; R1c's floor maps take over when they exist).

Verified (7 October): the R1c interface item 4 (`SkinSurface`, `SkinSheen`, `SkinLightHooks.sheen`; the skin material adds `sheen.specular` and scales its base light by `sheen.diffuseScale`); R1b plan lines 6693–6704 (`litFloorMaterial`: `albedo`, `model`, `lightUv`, `base`, the bodies' term) as amended by A2 and A5 and Task 10; this plan's Task 3 (`lamp_intensities`: a bulb lights a surface with weights[k] × intensity × cosθ / d²; `window_radiance`), Task 11 (`BULB_SOURCE`).

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/sheen.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIXTURE_CENTRES, cinematicData } from "./cinematic-fixture.js";
import {
  MIN_ROUGHNESS, envBrdfApprox, fresnelSchlick, ggxDistribution, lampLightsOf, smithCorrelatedVisibility,
} from "../sheen.js";

describe("GGX sheen (T-639 R1d)", () => {
  it("normalises the GGX distribution over the hemisphere's projected area", () => {
    for (const alpha of [0.1, 0.3, 0.7]) {
      let total = 0;
      const steps = 20000;
      for (let i = 0; i < steps; i += 1) {
        const theta = (i + 0.5) * (Math.PI / 2) / steps;
        total += ggxDistribution(Math.cos(theta), alpha) * Math.cos(theta) * Math.sin(theta) * 2 * Math.PI * (Math.PI / 2) / steps;
      }
      expect(total).toBeCloseTo(1, 3);
    }
  });

  it("gives Schlick's Fresnel and the correlated Smith visibility their limits", () => {
    expect(fresnelSchlick(0.04, 1)).toBeCloseTo(0.04, 12);
    expect(fresnelSchlick(0.04, 0)).toBeCloseTo(1, 12);
    expect(smithCorrelatedVisibility(1, 1, MIN_ROUGHNESS)).toBeCloseTo(0.25, 9);
  });

  it("follows Karis's analytic environment BRDF: a smooth dielectric at normal incidence reflects about its F0", () => {
    expect(envBrdfApprox(0.04, 0, 1)).toBeCloseTo(0.0456, 3);
    expect(envBrdfApprox(1, 0.2, 0.9)).toBeGreaterThan(0.85);
    expect(envBrdfApprox(0.04, 0.9, 0.2)).toBeLessThan(envBrdfApprox(0.04, 0.1, 0.2));
  });

  it("makes one sphere light per chandelier: its lamps' span and summed intensity, or its group's mean before triangulation", () => {
    const data = cinematicData({
      bulbs: [
        { id: "c0_b00", group: "ch_end", chandelier: 0, position: [1, 0, 3], intensity: 2 },
        { id: "c0_b01", group: "ch_end", chandelier: 0, position: [3, 0, 3], intensity: 3 },
        { id: "c2_b00", group: "ch_centre", chandelier: 2, position: [9, -5, 5], intensity: 4 },
      ],
      envelope: { kind: "candle", radius: 0.0175, height: 0.07 },
      glow: FIXTURE_CENTRES.map((centre, id) => ({ centre, crisp: id === 0 || id === 2 })),
    });
    expect(lampLightsOf(data)).toEqual([
      { position: [2, 0, 3], radius: 1.0175, source: 6, intensity: 5 },
      { position: [9, -5, 5], radius: 0.0175, source: 7, intensity: 4 },
      { position: FIXTURE_CENTRES[1], radius: 0.75, source: 6, intensity: 5 },
      { position: FIXTURE_CENTRES[3], radius: 0.75, source: 6, intensity: 5 },
      { position: FIXTURE_CENTRES[4], radius: 0.75, source: 6, intensity: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sheen.test.ts`
Expected: FAIL — cannot find module `../sheen.js`.

- [ ] **Step 3: The sheen** — create `packages/web/src/lib/relight/sheen.ts`:

```ts
import { Vector3, Vector4 } from "three";
import type { Node } from "three/webgpu";
import { Loop, clamp, dot, exp2, float, length, max, min, mix, normalize, reflect, select, uniform, uniformArray, vec2, vec3 } from "three/tsl";
import type { SkinSheen, SkinSurface } from "../skins/skin-material.js";
import { BULB_SOURCE } from "./bulbs.js";
import type { CinematicBulb, CinematicData } from "./cinematic-package.js";
import type { Vec3 } from "./relight-codec.js";
import type { InteriorShadowHook, RelightFrame } from "./relight-frame.js";

/**
 * GGX sheen (T-639 R1d, spec §4.2) on R1c's maps and the floor: Cook–Torrance with the GGX distribution, the
 * height-correlated Smith visibility and Schlick's Fresnel, from the two sky bodies, the lamps as sphere lights and
 * the windows as rectangles (Karis 2013's representative points), plus the probes' reflections (Karis 2014's
 * analytic environment BRDF). In the relit surfaces' units: π × BRDF × E × cos.
 */
export const MIN_ROUGHNESS = 0.05;
export const FLOOR_ROUGHNESS = 0.3;
export const DIELECTRIC_F0 = 0.04;
export const METAL_DIFFUSE_SCALE = 0.5;
export const MAX_LAMP_LIGHTS = 8;
/** A chandelier the bulb table does not cover yet shines as a sphere of its volume's radius (02_geometry.py). */
export const UNCOVERED_LAMP_RADIUS = 0.75;
const WINDOWS = 5;

export function ggxDistribution(nDotH: number, alpha: number): number {
  const a2 = alpha * alpha, d = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

export function smithCorrelatedVisibility(nDotL: number, nDotV: number, alpha: number): number {
  const a2 = alpha * alpha;
  const lambdaV = nDotL * Math.sqrt(nDotV * nDotV * (1 - a2) + a2);
  const lambdaL = nDotV * Math.sqrt(nDotL * nDotL * (1 - a2) + a2);
  return 0.5 / (lambdaV + lambdaL);
}

export function fresnelSchlick(f0: number, vDotH: number): number {
  return f0 + (1 - f0) * (1 - vDotH) ** 5;
}

/** Karis (2014), "Physically Based Shading on Mobile": the split-sum environment BRDF, analytically. */
export function envBrdfApprox(f0: number, roughness: number, nDotV: number): number {
  const r = [roughness * -1 + 1, roughness * -0.0275 + 0.0425, roughness * -0.572 + 1.04, roughness * 0.022 - 0.04] as const;
  const a004 = Math.min(r[0] * r[0], 2 ** (-9.28 * nDotV)) * r[0] + r[1];
  return f0 * (a004 * -1.04 + r[2]) + (a004 * 1.04 + r[3]);
}

export interface LampLight3 {
  readonly position: Vec3;
  readonly radius: number;
  /** The relight source whose weight scales it (6 ch_end, 7 ch_centre, 8 dome). */
  readonly source: number;
  /** Its bulbs' summed intensity per unit source weight. */
  readonly intensity: number;
}

/**
 * One sphere light per chandelier. With crisp lamps: centre and radius span them (plus the envelope's radius), the
 * intensity is theirs summed. Not yet triangulated: a sphere of the volume's radius at the proof's centre with its
 * group's mean lamps per covered chandelier, as Task 3 counts it on the floor. The dome has none.
 */
export function lampLightsOf(data: CinematicData): LampLight3[] {
  const byChandelier = new Map<number, CinematicBulb[]>();
  for (const bulb of data.bulbs) byChandelier.set(bulb.chandelier, [...(byChandelier.get(bulb.chandelier) ?? []), bulb]);
  const lights: LampLight3[] = [];
  for (const [, bulbs] of [...byChandelier.entries()].sort(([a], [b]) => a - b)) {
    const n = bulbs.length;
    const mean = (axis: 0 | 1 | 2): number => bulbs.reduce((sum, bulb) => sum + bulb.position[axis], 0) / n;
    const centre: Vec3 = [mean(0), mean(1), mean(2)];
    const spread = Math.max(...bulbs.map((bulb) => Math.hypot(bulb.position[0] - centre[0], bulb.position[1] - centre[1], bulb.position[2] - centre[2])));
    const group = bulbs[0]?.group ?? "ch_end";
    lights.push({ position: centre, radius: spread + data.envelope.radius, source: BULB_SOURCE[group], intensity: bulbs.reduce((sum, bulb) => sum + bulb.intensity, 0) });
  }
  data.glow.forEach((chandelier, id) => {
    if (chandelier.crisp) return;
    const group = id === 2 ? "ch_centre" : "ch_end";
    const lamps = data.bulbs.filter((bulb) => bulb.group === group);
    const covered = new Set(lamps.map((bulb) => bulb.chandelier)).size;
    if (lamps.length === 0 || covered === 0) return;
    const meanIntensity = lamps.reduce((sum, bulb) => sum + bulb.intensity, 0) / lamps.length;
    lights.push({ position: chandelier.centre, radius: UNCOVERED_LAMP_RADIUS, source: BULB_SOURCE[group], intensity: (lamps.length / covered) * meanIntensity });
  });
  return lights.slice(0, MAX_LAMP_LIGHTS);
}

export type ReflectionHook = (position: Node<"vec3">, direction: Node<"vec3">, roughness: Node<"float">) => Node<"vec3">;

export class CinematicSheen {
  readonly hook: (surface: SkinSurface) => SkinSheen;
  private readonly camera = uniform(new Vector3());
  /** The displayed light's sheen (Task 9): 0 at the captured light, 1 for a computed sky. */
  private readonly weight = uniform(1);
  private reflections: ReflectionHook | null = null;

  constructor(frame: RelightFrame, data: CinematicData, interior: InteriorShadowHook | null) {
    const u = frame.uniforms;
    const lamps = lampLightsOf(data);
    const lampValues = Array.from({ length: MAX_LAMP_LIGHTS }, (_unused, index) => {
      const lamp = lamps[index];
      return lamp === undefined ? new Vector4(0, 0, 0, 0) : new Vector4(lamp.position[0], lamp.position[1], lamp.position[2], lamp.radius);
    });
    const lampPositions = uniformArray<"vec4">(lampValues, "vec4");
    const windows = frame.model.windows.slice(0, WINDOWS).map((window) => window.frame);
    const shadow = interior ?? ((): Node<"float"> => float(1));
    // Each fixture's intensity: its source's weight (dimmer, tint, night gain) times its bulbs' summed intensity.
    const lampIntensity = (index: Node<"int">): Node<"vec3"> => lamps
      .map((lamp, k) => select(index.equal(k), u.sourceWeights.element(lamp.source).mul(lamp.intensity), vec3(0)))
      .reduce((sum, term) => sum.add(term), vec3(0));
    this.hook = (surface) => {
      const p = surface.position, n = normalize(surface.normal);
      const v = normalize(this.camera.sub(p));
      const nDotV = max(dot(n, v), 1e-4);
      const roughness = max(surface.roughness, MIN_ROUGHNESS);
      const alpha = roughness.mul(roughness);
      const f0 = mix(vec3(DIELECTRIC_F0), surface.albedo, surface.metal);
      const r = reflect(v.negate(), n);
      const brdf = (l: Node<"vec3">, a: Node<"float">): Node<"vec3"> => {
        const h = normalize(l.add(v));
        const nDotL = max(dot(n, l), 0), nDotH = max(dot(n, h), 0), vDotH = max(dot(v, h), 0);
        const a2 = a.mul(a);
        const d = nDotH.mul(nDotH).mul(a2.sub(1)).add(1);
        const distribution = a2.div(d.mul(d).mul(Math.PI));
        const lambdaV = nDotL.mul(nDotV.mul(nDotV).mul(float(1).sub(a2)).add(a2).sqrt());
        const lambdaL = nDotV.mul(nDotL.mul(nDotL).mul(float(1).sub(a2)).add(a2).sqrt());
        const visibility = float(0.5).div(max(lambdaV.add(lambdaL), 1e-6));
        const fresnel = f0.add(vec3(1).sub(f0).mul(float(1).sub(vDotH).pow(5)));
        // π × BRDF × cos: the relit units of a matte surface (π × radiance).
        return fresnel.mul(distribution.mul(visibility).mul(nDotL).mul(Math.PI));
      };
      const sky = (body: "sun" | "moon"): Node<"vec3"> => {
        const dir = body === "sun" ? u.sunDir : u.moonDir, rgb = body === "sun" ? u.sunRgb : u.moonRgb, on = body === "sun" ? u.sunOn : u.moonOn;
        return brdf(dir, alpha).mul(rgb).mul(surface.bodyVisibility(body).mul(shadow(p, body)).mul(on));
      };
      const specular = sky("sun").add(sky("moon")).toVar();
      // The lamps, one sphere light per fixture: Karis's representative point and energy-conserving widening.
      Loop(lamps.length, ({ i }) => {
        const lamp = lampPositions.element(i);
        const toCentre = lamp.xyz.sub(p);
        const distance = max(length(toCentre), 1e-3);
        const centreToRay = dot(toCentre, r).mul(r).sub(toCentre);
        const closest = toCentre.add(centreToRay.mul(clamp(lamp.w.div(max(length(centreToRay), 1e-6)), 0, 1)));
        const widened = clamp(alpha.add(lamp.w.div(distance.mul(2))), 0, 1);
        const normalisation = alpha.div(widened).pow(2);
        specular.addAssign(brdf(normalize(closest), widened).mul(normalisation).div(distance.mul(distance)).mul(lampIntensity(i)));
      });
      // The windows: rectangles in the wall face y = y0, their radiance weights[k] × windowRadiance[k].
      windows.forEach((window, k) => {
        const t = float(window.y0).sub(p.y).div(select(r.y.lessThan(-1e-4), r.y, float(-1e-4)));
        const hit = p.add(r.mul(max(t, 0)));
        const point = vec3(clamp(hit.x, window.x0, window.x1), float(window.y0), clamp(hit.z, window.sill, window.top));
        const toPoint = point.sub(p), distance = max(length(toPoint), 1e-3);
        const halfSize = float(Math.hypot(window.x1 - window.x0, window.top - window.sill) / 2);
        const widened = clamp(alpha.add(halfSize.div(distance.mul(2))), 0, 1);
        const area = (window.x1 - window.x0) * (window.top - window.sill);
        const solidAngle = float(area).mul(max(normalize(toPoint).y.negate(), 0)).div(distance.mul(distance));
        const radiance = u.sourceWeights.element(k).mul(data.windowRadiance[k] ?? 0);
        specular.addAssign(brdf(normalize(toPoint), widened).mul(alpha.div(widened).pow(2)).mul(radiance).mul(solidAngle));
      });
      const reflected = this.reflections === null ? vec3(0) : this.reflections(p, r, roughness);
      const environment = envBrdfNode(f0, roughness, nDotV);
      return {
        diffuseScale: float(1).sub(surface.metal.mul(METAL_DIFFUSE_SCALE).mul(this.weight)),
        specular: specular.add(reflected.mul(environment)).mul(this.weight),
      };
    };
  }

  setCamera(modelPosition: Vector3): void {
    this.camera.value.copy(modelPosition);
  }

  /** How much sheen shows: the displayed light's `sheen` (0 at the captured light, the hall exactly as captured). */
  setWeight(weight: number): void {
    this.weight.value = Math.min(Math.max(Number.isFinite(weight) ? weight : 0, 0), 1);
  }

  /** The probes' reflection (Task 18), or null. Hooks built after this call read it. */
  setReflections(hook: ReflectionHook | null): void {
    this.reflections = hook;
  }
}

/** envBrdfApprox in TSL, per channel of F0. */
function envBrdfNode(f0: Node<"vec3">, roughness: Node<"float">, nDotV: Node<"float">): Node<"vec3"> {
  const r = vec3(roughness.mul(-1).add(1), roughness.mul(-0.0275).add(0.0425), roughness.mul(-0.572).add(1.04));
  const r3 = roughness.mul(0.022).sub(0.04);
  const a004 = min(r.x.mul(r.x), exp2(nDotV.mul(-9.28))).mul(r.x).add(r.y);
  const ab = vec2(a004.mul(-1.04).add(r.z), a004.mul(1.04).add(r3));
  return f0.mul(ab.x).add(ab.y);
}
```

- [ ] **Step 4: The floor** — in `packages/web/src/lib/relight/floor-material.ts`, import `FLOOR_ROUGHNESS` from `./sheen.js`, and replace Task 10's return line `    return vec4(displayNode(albedo.rgb.mul(base.add(sun)), u.display, float(HIGHLIGHT_KNEE)), albedo.a);` (R1b's, unchanged by Task 10) with:

```ts
    // R1d: the floor's sheen and reflections (waxed oak), gated by its own sun and moon grids.
    if (hooks.sheen === null) return vec4(displayNode(albedo.rgb.mul(base.add(sun)), u.display, float(HIGHLIGHT_KNEE)), albedo.a);
    const sheen = hooks.sheen({
      position: model, normal: vec3(0, 0, 1), albedo: albedo.rgb, roughness: float(FLOOR_ROUGHNESS), metal: float(0),
      bodyVisibility: (body) => floorSunNode(frame, lightUv, body),
    });
    return vec4(displayNode(albedo.rgb.mul(base.mul(sheen.diffuseScale).add(sun)).add(sheen.specular), u.display, float(HIGHLIGHT_KNEE)), albedo.a);
```

- [ ] **Step 5: Mount it** — in `packages/web/src/components/scene/RelightCinematic.tsx`, import `CinematicSheen`, and directly after the shafts' effect add:

```tsx
  const [sheen, setSheen] = useState<CinematicSheen | null>(null);
  useEffect(() => {
    if (frame === null || data === null) return;
    setSheen(new CinematicSheen(frame, data, shadows?.hook ?? null));
    return () => { setSheen(null); };
  }, [frame, data, shadows]);
  useFrame((state) => { if (sheen !== null) sheen.setCamera(eyeModel.copy(state.camera.position).applyMatrix4(sceneToModel)); });
  useEffect(() => {
    if (sheen === null || director === null) return;
    // No added sheen at the captured light; the cross-fade carries it in and out (Task 9's SkyLight.sheen).
    const shown = director.current();
    if (shown !== null) sheen.setWeight(shown.light.sheen);
    return director.onDisplayed((light) => { sheen.setWeight(light.light.sheen); });
  }, [sheen, director]);
```

with `const eyeModel = useMemo(() => new Vector3(), []);` (`sceneToModel` is Task 14's memo). Replace the two hook memos with:

```tsx
  const floorHooks = useMemo<FloorLightHooks>(() => ({ interiorShadow: shadows?.hook ?? null, sheen: sheen?.hook ?? null }), [shadows, sheen]);
  const skinHooks = useMemo<SkinLightHooks>(() => ({ sunShadow: shadows?.hook ?? null, sheen: sheen?.hook ?? null }), [shadows, sheen]);
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sheen.test.ts`
Expected: PASS, 4 tests.

Then, one per command: `src/components/scene/__tests__/RelightCinematic.test.tsx`, `src/components/stage/__tests__/StageFloor.test.tsx`. Expected: PASS at their counts.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/sheen.ts src/lib/relight/floor-material.ts src/components/scene/RelightCinematic.tsx`
Expected: no errors, no problems.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/sheen.ts packages/web/src/lib/relight/__tests__/sheen.test.ts packages/web/src/lib/relight/floor-material.ts packages/web/src/components/scene/RelightCinematic.tsx && git diff --cached --stat && git commit -m "feat(relight): GGX sheen from the Sun, the Moon, the lamps and the windows on the skins and the floor (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Reflection probes

**Files:**
- Create: `packages/web/src/lib/relight/reflection-probes.ts`
- Modify: `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/reflection-probes.test.ts` (create)

**Interfaces:**
- Consumes: Task 8 (`CinematicData.probes`), Task 16 (`DisplayUniforms.linear`), Task 17 (`ReflectionHook`, `CinematicSheen.setReflections`), Task 9 (`LightDirector.onLight`); R1c item 5 (skin materials named `relight-skin`); R1b's floor material name `stage-floor-lit`; three's `CubeCamera`, `CubeRenderTarget`, `cubeTexture`.
- Produces: `PROBE_SIZE = 128`, `PROBE_LAYER = 5`, `REFLECTED_MATERIALS = ["stage-floor-lit", "relight-skin"]`; `boxProjectedDirection(point: Vec3, direction: Vec3, centre: Vec3, box: readonly [Vec3, Vec3]): Vec3`; `probeWeights(x: number, probes: readonly CinematicProbe[]): number[]` (the two nearest along the hall's axis, summing to 1); `markReflected(scene: Object3D): number` (layer 5 on the floor's and the skins' meshes; the count); `class ReflectionProbes` with `constructor(frame: RelightFrame, probes: readonly CinematicProbe[], modelToScene: Matrix4)`, readonly `hook: ReflectionHook`, `invalidate(): void`, `step(renderer: WebGPURenderer, scene: Scene): boolean` (one cube face; true while a refresh is under way), `dispose(): void`.

Decision 5. Three cube probes (128 texels a face, half float) stand on the hall's long axis at eye height (Task 3), each boxed by the hall. They capture only the relit meshes, the restored floor and R1c's skins (layer 5: a splat draw costs about a frame and cannot be redrawn per face while the light moves), in linear light (the display's `linear` switch is on only while a probe draws). A change of light starts a refresh that draws one face a frame (18 frames for the three probes, under a third of a second at 60 fps); the probes are double-buffered, so a material never samples the cube being drawn, and each probe's new cube replaces its old one when its sixth face is done (that face generates the mip chain, as `CubeCamera.update` does). A surface reads the two nearest probes along the hall's axis, each box-projected (the reflected ray's exit from the probe's box, seen from the probe's centre), at the mip level of its roughness. The bright emitters (the Sun, the Moon, the lamps, the windows) are not in the probes; they reflect analytically through the sheen (Task 17), so nothing is counted twice. The 3D ornament that stays splats is missing from the soft reflections by design.

Verified (7 October): three 0.186 `src/nodes/accessors/TextureNode.js:198-217` (a node's `value` reads its `referenceNode`'s) and `:696-704` (`sample` clones with `referenceNode = this.getBase()`), `src/cameras/CubeCamera.js:77-97` (the six face cameras take the CubeCamera's layers), `:178-255` (`update`: per face `renderer.setRenderTarget(renderTarget, face, activeMipmapLevel)` and `render(scene, camera)`, mipmaps generated with the last face), `src/nodes/accessors/CubeTextureNode.js:184` (`cubeTexture(value, uvNode, levelNode)`), `src/renderers/common/CubeRenderTarget.js` (`new CubeRenderTarget(size, options)`); the R1c interface item 5; R1b plan line 6696 (`material.name = "stage-floor-lit"`).

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/reflection-probes.test.ts`:

```ts
import { Matrix4, Mesh, MeshBasicMaterial, Scene } from "three";
import { WebGPURenderer } from "three/webgpu";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { PROBE_LAYER, ReflectionProbes, boxProjectedDirection, markReflected, probeWeights } from "../reflection-probes.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
const BOX = [[0, -10, 0], [18, 0, 7]] as const;
const PROBES = [3, 9, 15].map((x) => ({ position: [x, -5, 1.6] as const, box: BOX }));

describe("reflection probes (T-639 R1d)", () => {
  it("projects a reflected ray onto the probe's box", () => {
    expect(boxProjectedDirection([9, -5, 1.6], [1, 0, 0], [9, -5, 1.6], BOX)).toEqual([1, 0, 0]);
    const near = boxProjectedDirection([17, -5, 1.6], [0, 1, 0], [9, -5, 1.6], BOX);
    // the ray leaves the box at (17, 0, 1.6): seen from the centre, toward (8, 5, 0)
    expect(near[0] / near[1]).toBeCloseTo(8 / 5, 9);
  });

  it("reads the two nearest probes along the hall, weights summing to 1", () => {
    expect(probeWeights(9, PROBES)).toEqual([0, 1, 0]);
    const between = probeWeights(12, PROBES);
    expect(between[0]).toBe(0);
    expect((between[1] ?? 0) + (between[2] ?? 0)).toBeCloseTo(1, 12);
    expect(probeWeights(-4, PROBES)).toEqual([1, 0, 0]);
  });

  it("puts only the floor and the skins on the probes' layer", () => {
    const scene = new Scene();
    const named = (name: string): Mesh => { const material = new MeshBasicMaterial(); material.name = name; const mesh = new Mesh(undefined, material); scene.add(mesh); return mesh; };
    const floor = named("stage-floor-lit"), skin = named("relight-skin"), other = named("relight-bulb-ch_centre");
    expect(markReflected(scene)).toBe(2);
    expect([floor.layers.isEnabled(PROBE_LAYER), skin.layers.isEnabled(PROBE_LAYER), other.layers.isEnabled(PROBE_LAYER)]).toEqual([true, true, false]);
    expect(floor.layers.isEnabled(0)).toBe(true);
  });

  it("draws one face a frame after a change of light, 18 in all, with the display linear only while drawing", () => {
    const frame = new RelightFrame(data);
    const probes = new ReflectionProbes(frame, PROBES, new Matrix4());
    const linear: number[] = [];
    const renderer = Object.assign(new WebGPURenderer(), {
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      setRenderTarget: () => undefined,
      render: () => { linear.push(frame.uniforms.display.linear.value); return undefined; },
    });
    const scene = new Scene();
    expect(probes.step(renderer, scene)).toBe(false);
    probes.invalidate();
    let frames = 0;
    while (probes.step(renderer, scene)) frames += 1;
    expect([frames + 1, linear.length]).toEqual([18, 18]);
    expect(new Set(linear)).toEqual(new Set([1]));
    expect(frame.uniforms.display.linear.value).toBe(0);
    probes.dispose();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/reflection-probes.test.ts`
Expected: FAIL — cannot find module `../reflection-probes.js`.

- [ ] **Step 3: The probes** — create `packages/web/src/lib/relight/reflection-probes.ts`:

```ts
import { CubeCamera, HalfFloatType, LinearMipmapLinearFilter, Mesh, PerspectiveCamera, Vector3, type Matrix4, type Object3D, type Scene } from "three";
import { CubeRenderTarget, type Node, type WebGPURenderer } from "three/webgpu";
import { clamp, cubeTexture, float, max, min, uniform, vec3, vec4 } from "three/tsl";
import type { CinematicProbe } from "./cinematic-package.js";
import type { Vec3 } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";
import type { ReflectionHook } from "./sheen.js";

/**
 * Reflection probes of the relit meshes (T-639 R1d, decision 5): three double-buffered cubes on the hall's axis,
 * refreshed one face a frame after each change of light, read box-projected at the roughness's mip.
 */
export const PROBE_SIZE = 128;
export const PROBE_LAYER = 5;
export const REFLECTED_MATERIALS = ["stage-floor-lit", "relight-skin"] as const;
const MAX_MIP = Math.log2(PROBE_SIZE);

/** The reflected ray's exit from the box, as seen from the probe's centre (parallax-corrected cube lookup). */
export function boxProjectedDirection(point: Vec3, direction: Vec3, centre: Vec3, box: readonly [Vec3, Vec3]): Vec3 {
  let t = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = direction[axis] ?? 0;
    if (d === 0) continue;
    const bound = d > 0 ? box[1][axis] ?? 0 : box[0][axis] ?? 0;
    t = Math.min(t, (bound - (point[axis] ?? 0)) / d);
  }
  const hit: Vec3 = [point[0] + direction[0] * t, point[1] + direction[1] * t, point[2] + direction[2] * t];
  const out: Vec3 = [hit[0] - centre[0], hit[1] - centre[1], hit[2] - centre[2]];
  const length = Math.hypot(...out);
  return length > 0 ? [out[0] / length, out[1] / length, out[2] / length] : direction;
}

/** The two probes nearest along the hall's long axis (x), linearly; the end probe alone beyond the ends. */
export function probeWeights(x: number, probes: readonly CinematicProbe[]): number[] {
  const weights = probes.map(() => 0);
  const xs = probes.map((probe) => probe.position[0]);
  if (xs.length === 0) return weights;
  if (x <= (xs[0] ?? 0)) { weights[0] = 1; return weights; }
  for (let i = 1; i < xs.length; i += 1) {
    const x0 = xs[i - 1] ?? 0, x1 = xs[i] ?? 0;
    if (x <= x1) {
      const f = (x - x0) / (x1 - x0);
      weights[i - 1] = 1 - f;
      weights[i] = f;
      return weights;
    }
  }
  weights[xs.length - 1] = 1;
  return weights;
}

export function markReflected(scene: Object3D): number {
  let count = 0;
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials: unknown[] = Array.isArray(object.material) ? object.material : [object.material];
    const reflected = materials.some((material) => typeof material === "object" && material !== null && "name" in material
      && REFLECTED_MATERIALS.some((name) => name === material.name));
    if (reflected) { object.layers.enable(PROBE_LAYER); count += 1; }
  });
  return count;
}

interface Probe {
  readonly camera: CubeCamera;
  /** [read, write]: materials sample the first while the second is drawn. */
  targets: [CubeRenderTarget, CubeRenderTarget];
  readonly node: ReturnType<typeof cubeTexture>;
  readonly centre: Vec3;
  readonly box: readonly [Vec3, Vec3];
}

export class ReflectionProbes {
  readonly hook: ReflectionHook;
  private readonly frame: RelightFrame;
  private readonly probes: Probe[];
  private pending = 0;

  constructor(frame: RelightFrame, probes: readonly CinematicProbe[], modelToScene: Matrix4) {
    this.frame = frame;
    const target = (): CubeRenderTarget => new CubeRenderTarget(PROBE_SIZE, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    this.probes = probes.map((probe) => {
      const targets: [CubeRenderTarget, CubeRenderTarget] = [target(), target()];
      const camera = new CubeCamera(0.05, 100, targets[1]);
      camera.layers.set(PROBE_LAYER);
      camera.position.copy(new Vector3(...probe.position).applyMatrix4(modelToScene));
      camera.updateMatrixWorld(true);
      return { camera, targets, node: cubeTexture(targets[0].texture), centre: probe.position, box: probe.box };
    });
    const rotation = uniform(modelToScene.clone());
    this.hook = (position, direction, roughness) => {
      const level = clamp(roughness.mul(MAX_MIP), 0, MAX_MIP);
      let sum: Node<"vec3"> = vec3(0);
      // The two nearest along x, as probeWeights does, in TSL.
      this.probes.forEach((probe, index) => {
        const previous = this.probes[index - 1]?.centre[0], next = this.probes[index + 1]?.centre[0];
        const x = position.x, here = probe.centre[0];
        const rising = previous === undefined ? float(1) : clamp(x.sub(previous).div(here - previous), 0, 1);
        const falling = next === undefined ? float(1) : clamp(float(next).sub(x).div(next - here), 0, 1);
        const weight = min(rising, falling);
        // Box projection in the model frame, then into the scene's frame for the cube lookup.
        const lo = vec3(...probe.box[0]), hi = vec3(...probe.box[1]);
        const toHi = hi.sub(position).div(direction), toLo = lo.sub(position).div(direction);
        const exits = max(toHi, toLo);
        const t = min(exits.x, min(exits.y, exits.z));
        const local = position.add(direction.mul(t)).sub(vec3(...probe.centre));
        const lookup = rotation.mul(vec4(local, 0)).xyz;
        sum = sum.add(probe.node.sample(lookup).level(level).rgb.mul(weight));
      });
      return sum;
    };
  }

  /** A change of light: redraw every probe, one face a frame. */
  invalidate(): void {
    this.pending = this.probes.length * 6;
  }

  /** Draw the next face; returns true while faces remain. The display is linear only while a face draws. */
  step(renderer: WebGPURenderer, scene: Scene): boolean {
    if (this.pending === 0) return false;
    const done = this.probes.length * 6 - this.pending;
    const probe = this.probes[Math.floor(done / 6)];
    const face = done % 6;
    if (probe === undefined) { this.pending = 0; return false; }
    const write = probe.targets[1];
    const faceCamera = probe.camera.children[face];
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace(), previousMip = renderer.getActiveMipmapLevel();
    const linear = this.frame.uniforms.display.linear;
    write.texture.generateMipmaps = face === 5;
    linear.value = 1;
    try {
      renderer.setRenderTarget(write, face);
      if (faceCamera instanceof PerspectiveCamera) void renderer.render(scene, faceCamera);
    } finally {
      linear.value = 0;
      renderer.setRenderTarget(previous, previousFace, previousMip);
    }
    if (face === 5) {
      // The probe is complete: materials read it from now on, and the next refresh draws into the old one.
      probe.targets = [write, probe.targets[0]];
      probe.node.value = write.texture;
      probe.camera.renderTarget = probe.targets[1];
    }
    this.pending -= 1;
    return this.pending > 0;
  }

  dispose(): void {
    for (const probe of this.probes) for (const target of probe.targets) target.dispose();
  }
}
```

(A sampled cube node reads its base node's value, so swapping `probe.node.value` moves every material's reads to the new cube.)

- [ ] **Step 4: Mount them** — in `packages/web/src/components/scene/RelightCinematic.tsx`, import `ReflectionProbes` and `markReflected`, and directly after the sheen's effect add:

```tsx
  const scene = useThree((state) => state.scene);
  const [probes, setProbes] = useState<ReflectionProbes | null>(null);
  useEffect(() => {
    if (frame === null || director === null || data === null || sheen === null || data.probes.length === 0 || !isShadowRenderer(gl)) return;
    const created = new ReflectionProbes(frame, data.probes, sceneToModel.clone().invert());
    sheen.setReflections(created.hook);
    created.invalidate();
    const stop = director.onLight(() => { created.invalidate(); });
    setProbes(created);
    return () => {
      stop();
      sheen.setReflections(null);
      created.dispose();
      setProbes(null);
    };
  }, [frame, director, data, sheen, sceneToModel, gl]);
  useFrame(({ gl: renderer, invalidate }) => {
    if (probes === null || !isShadowRenderer(renderer)) return;
    markReflected(scene);
    if (probes.step(renderer, scene)) invalidate();
  });
```

The probes' hook must be in place before the floor's and the skins' materials are built from the sheen, so replace Task 17's two hook memos with:

```tsx
  const floorHooks = useMemo<FloorLightHooks>(() => ({ interiorShadow: shadows?.hook ?? null, sheen: sheen?.hook ?? null }), [shadows, sheen, probes]);
  const skinHooks = useMemo<SkinLightHooks>(() => ({ sunShadow: shadows?.hook ?? null, sheen: sheen?.hook ?? null }), [shadows, sheen, probes]);
```

(a new `probes` gives the floor and the skins new hook objects, so they rebuild their materials with the reflections).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/reflection-probes.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS at its count.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/reflection-probes.ts src/components/scene/RelightCinematic.tsx`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/reflection-probes.ts packages/web/src/lib/relight/__tests__/reflection-probes.test.ts packages/web/src/components/scene/RelightCinematic.tsx && git diff --cached --stat && git commit -m "feat(relight): box-projected reflection probes of the relit floor and skins, one face a frame (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: The sky's arcs and detents

**Files:**
- Create: `packages/web/src/lib/relight/sky-arcs.ts`
- Test: `packages/web/src/lib/relight/__tests__/sky-arcs.test.ts`

**Interfaces:**
- Consumes: Task 6 (`dayNumber`, `skyAt`, `instantOf`), R1b's `solarPosition`, A3's `moonPosition`.
- Produces: `ARC_STEP_MINUTES = 5`, `SUNRISE_ELEVATION = -0.833`, `GOLDEN_ELEVATION = 6`, `DETENT_MINUTES = 8`, `DETENT_PULL = 0.6`; `interface ArcPoint { readonly minutes: number; readonly elevation: number; readonly azimuth: number }`; `interface SkyArcs { readonly date: string; readonly sun: readonly ArcPoint[]; readonly moon: readonly ArcPoint[] }`; `skyArcs(date: string, latitude: number, longitude: number): SkyArcs`; `type DetentKind = "sunrise" | "golden-morning" | "golden-evening" | "sunset" | "moonrise" | "moonset"`; `interface Detent { readonly kind: DetentKind; readonly minutes: number }`; `skyDetents(date: string, latitude: number, longitude: number): Detent[]` (sorted); `detentPull(minutes: number, detents: readonly Detent[]): number`; `snapToDetent(minutes: number, detents: readonly Detent[]): number`.

The clock (Task 20) draws the Sun's and the Moon's arcs for the chosen date as a time–altitude chart (decision 8): every five minutes of London's wall clock, both bodies' elevations (and azimuths, for the words). The detents are the moments the owner named: sunrise and sunset (the Sun's upper limb on a refracted horizon, −0.833°, NOAA's convention, so they match the published times), the golden hours' edges (the Sun crossing 6°: the morning's golden hour ends, the evening's begins), and moonrise and moonset (the Moon's centre crossing 0°, refracted, the Moon's apparent centre as the clock draws it). Each crossing is found on the five-minute grid and refined by bisection to under a second. A detent is gentle: while dragging within 8 minutes of one, the target is pulled 60% of the way toward it, falling off smoothly to nothing at the edge; on release within 8 minutes, it settles there (through the time spring, so the arrival is a glide). A day can lack some (the Moon may not rise; at midsummer the golden hours do happen, but not every crossing exists at every latitude): only those that exist are returned.

Verified (7 October): Task 6's `instantOf` (London wall minutes, October's first repeated hour) and the NOAA Sun (R1b plan lines 3236–3298); the Glasgow times computed with the proof's NOAA algorithm on 7 October (scratch run): 21 June 2026 sunrise 271.22 min (04:31 BST) and sunset 1326.41 min (22:06 BST), Sun at 6° at 334.04 and 1263.60 min; 21 December 2026 sunrise 525.67 (08:46 GMT) and sunset 944.48 (15:44 GMT), against NOAA's published 04:31/22:06 and 08:46/15:44 for Glasgow.

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/sky-arcs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TRADES_HALL_LATITUDE as LAT, TRADES_HALL_LONGITUDE as LON } from "../../sun.js";
import { DETENT_MINUTES, detentPull, skyArcs, skyDetents, snapToDetent } from "../sky-arcs.js";

const at = (detents: ReturnType<typeof skyDetents>, kind: string): number => detents.find((detent) => detent.kind === kind)?.minutes ?? Number.NaN;

describe("the sky's arcs and detents (T-639 R1d)", () => {
  it("draws both bodies every five minutes of the London day", () => {
    const arcs = skyArcs("2026-06-21", LAT, LON);
    expect([arcs.sun.length, arcs.moon.length]).toEqual([289, 289]);
    expect([arcs.sun[0]?.minutes, arcs.sun.at(-1)?.minutes]).toEqual([0, 1440]);
    expect(Math.max(...arcs.sun.map((point) => point.elevation))).toBeCloseTo(57.6, 0);
  });

  it("finds midsummer's and midwinter's sunrise and sunset to the published minute", () => {
    const summer = skyDetents("2026-06-21", LAT, LON);
    expect(Math.abs(at(summer, "sunrise") - 271.22)).toBeLessThan(0.1);
    expect(Math.abs(at(summer, "sunset") - 1326.41)).toBeLessThan(0.1);
    expect(Math.abs(at(summer, "golden-morning") - 334.04)).toBeLessThan(0.1);
    expect(Math.abs(at(summer, "golden-evening") - 1263.6)).toBeLessThan(0.1);
    const winter = skyDetents("2026-12-21", LAT, LON);
    expect(Math.abs(at(winter, "sunrise") - 525.67)).toBeLessThan(0.1);
    expect(Math.abs(at(winter, "sunset") - 944.48)).toBeLessThan(0.1);
    expect(summer.map((detent) => detent.minutes)).toEqual([...summer.map((detent) => detent.minutes)].sort((a, b) => a - b));
  });

  it("finds the Moon's rising and setting when it has them", () => {
    const detents = skyDetents("2026-09-26", LAT, LON);
    const rise = at(detents, "moonrise");
    expect(rise).toBeGreaterThan(17 * 60);
    expect(rise).toBeLessThan(21 * 60);
  });

  it("pulls gently within eight minutes and settles there on release", () => {
    const detents = [{ kind: "sunset" as const, minutes: 1000 }];
    expect(detentPull(1000 - DETENT_MINUTES - 1, detents)).toBe(1000 - DETENT_MINUTES - 1);
    const pulled = detentPull(996, detents);
    expect(pulled).toBeGreaterThan(996);
    expect(pulled).toBeLessThan(1000);
    expect(detentPull(1000, detents)).toBe(1000);
    expect([snapToDetent(994, detents), snapToDetent(1009, detents)]).toEqual([1000, 1009]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-arcs.test.ts`
Expected: FAIL — cannot find module `../sky-arcs.js`.

- [ ] **Step 3: Implement** — create `packages/web/src/lib/relight/sky-arcs.ts`:

```ts
import { dayNumber } from "../light-setting.js";
import { skyAt } from "./sky-instant.js";

/**
 * The Sun's and the Moon's arcs for a date and the clock's detents (T-639 R1d, decision 8): sunrise, the golden
 * hours' edges, sunset, moonrise and moonset, refined by bisection; a gentle pull while dragging and a settle on release.
 */
export const ARC_STEP_MINUTES = 5;
export const SUNRISE_ELEVATION = -0.833;
export const GOLDEN_ELEVATION = 6;
export const DETENT_MINUTES = 8;
export const DETENT_PULL = 0.6;

export interface ArcPoint { readonly minutes: number; readonly elevation: number; readonly azimuth: number }
export interface SkyArcs { readonly date: string; readonly sun: readonly ArcPoint[]; readonly moon: readonly ArcPoint[] }
export type DetentKind = "sunrise" | "golden-morning" | "golden-evening" | "sunset" | "moonrise" | "moonset";
export interface Detent { readonly kind: DetentKind; readonly minutes: number }

type Body = "sun" | "moon";

function elevationAt(day: number, minutes: number, latitude: number, longitude: number, body: Body): number {
  const sky = skyAt({ day, minutes }, latitude, longitude);
  return body === "sun" ? sky.sun.elevation : sky.moon.elevation;
}

export function skyArcs(date: string, latitude: number, longitude: number): SkyArcs {
  const day = dayNumber(date);
  const sun: ArcPoint[] = [], moon: ArcPoint[] = [];
  for (let minutes = 0; minutes <= 1440; minutes += ARC_STEP_MINUTES) {
    const sky = skyAt({ day, minutes }, latitude, longitude);
    sun.push({ minutes, elevation: sky.sun.elevation, azimuth: sky.sun.azimuth });
    moon.push({ minutes, elevation: sky.moon.elevation, azimuth: sky.moon.azimuth });
  }
  return { date, sun, moon };
}

/** Each crossing of a threshold on the grid, refined by bisection to under a second; rising or setting. */
function crossings(
  day: number, latitude: number, longitude: number, body: Body, threshold: number, arc: readonly ArcPoint[],
): { readonly minutes: number; readonly rising: boolean }[] {
  const found: { minutes: number; rising: boolean }[] = [];
  for (let i = 1; i < arc.length; i += 1) {
    const a = arc[i - 1], b = arc[i];
    if (a === undefined || b === undefined) continue;
    if ((a.elevation - threshold) * (b.elevation - threshold) > 0 || a.elevation === b.elevation) continue;
    let lo = a.minutes, hi = b.minutes;
    const rising = b.elevation > a.elevation;
    for (let k = 0; k < 20; k += 1) {
      const mid = (lo + hi) / 2;
      const above = elevationAt(day, mid, latitude, longitude, body) > threshold;
      if (above === rising) hi = mid; else lo = mid;
    }
    found.push({ minutes: (lo + hi) / 2, rising });
  }
  return found;
}

export function skyDetents(date: string, latitude: number, longitude: number): Detent[] {
  const day = dayNumber(date);
  const arcs = skyArcs(date, latitude, longitude);
  const detents: Detent[] = [];
  for (const crossing of crossings(day, latitude, longitude, "sun", SUNRISE_ELEVATION, arcs.sun)) {
    detents.push({ kind: crossing.rising ? "sunrise" : "sunset", minutes: crossing.minutes });
  }
  for (const crossing of crossings(day, latitude, longitude, "sun", GOLDEN_ELEVATION, arcs.sun)) {
    detents.push({ kind: crossing.rising ? "golden-morning" : "golden-evening", minutes: crossing.minutes });
  }
  for (const crossing of crossings(day, latitude, longitude, "moon", 0, arcs.moon)) {
    detents.push({ kind: crossing.rising ? "moonrise" : "moonset", minutes: crossing.minutes });
  }
  return detents.sort((a, b) => a.minutes - b.minutes);
}

/** While dragging: within 8 minutes of a detent, pulled 60% of the way to it, falling off smoothly to nothing. */
export function detentPull(minutes: number, detents: readonly Detent[]): number {
  let nearest: Detent | null = null;
  for (const detent of detents) {
    if (nearest === null || Math.abs(detent.minutes - minutes) < Math.abs(nearest.minutes - minutes)) nearest = detent;
  }
  if (nearest === null) return minutes;
  const distance = Math.abs(nearest.minutes - minutes);
  if (distance >= DETENT_MINUTES) return minutes;
  const falloff = (1 - distance / DETENT_MINUTES) ** 2;
  return minutes + (nearest.minutes - minutes) * DETENT_PULL * falloff;
}

/** On release: settle on a detent within 8 minutes. */
export function snapToDetent(minutes: number, detents: readonly Detent[]): number {
  for (const detent of detents) if (Math.abs(detent.minutes - minutes) < DETENT_MINUTES) return detent.minutes;
  return minutes;
}
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-arcs.test.ts`
Expected: PASS, 4 tests. The arcs cost 289 × 2 ephemerides (a few milliseconds) once per date.

- [ ] **Step 5: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/sky-arcs.ts packages/web/src/lib/relight/__tests__/sky-arcs.test.ts && git diff --cached --stat && git commit -m "feat(relight): the Sun's and the Moon's arcs for a date, with gentle detents (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: The clock: a crafted control for the Sun, the Moon and the hour

**Files:**
- Create: `packages/web/src/components/rooms/SkyClock.tsx`, `packages/web/src/components/rooms/SkyClock.css`
- Modify: `packages/web/src/components/rooms/LightControl.tsx`, `packages/web/src/components/rooms/LightControl.css`
- Test: `packages/web/src/components/rooms/__tests__/SkyClock.test.tsx` (create), `packages/web/src/components/rooms/__tests__/LightControl.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 19 (`skyArcs`, `skyDetents`, `detentPull`, `snapToDetent`, `SkyArcs`, `Detent`), Task 9 (`subscribeDisplayedLight`, `currentDisplayedLight`, `DisplayedLight`), Task 6 (the store's `follow`, `lamps`, `setLamps`, `followClock`; `LAMP_MODES`, `dateOfDay`, `formatMinutes`, `clampMinutes`); R1c item 7 (the store's `hiddenToggles`, `setToggleHidden`); R1b's `TRADES_HALL_LATITUDE`/`LONGITUDE`, `ActivityStatus`, the walk's palette variables (`--stone`, `--stone-dim`, `--brass`).
- Produces (`SkyClock.tsx`): `CLOCK_WIDTH = 288`, `CLOCK_HEIGHT = 112`, `ELEVATION_TOP = 60`, `ELEVATION_BOTTOM = -20`, `KEY_STEP_MINUTES = 5`, `KEY_PAGE_MINUTES = 60`; `type ClockReading = Pick<DisplayedLight, "instant" | "sun" | "moon" | "following">`; `clockX(minutes: number): number`; `clockY(elevation: number): number`; `arcPath(points: SkyArcs["sun"]): string`; `minutesFromPointer(clientX: number, rect: Pick<DOMRect, "left" | "width">): number`; `compassWord(azimuth: number): string`; `clockWords(minutes: number, reading: ClockReading | null): string`; `SkyClock({ subscribe }: { subscribe?: (listener: (reading: ClockReading | null) => void) => () => void }): ReactElement`.
- Produces (`LightControl`): the presets; the clock (in place of R1b's hour slider); the date and a "Now" button (pressed while following); the lamps' three modes; and two switches for what can be hidden ("Loose cables and stray items", "AV cabinet"; R1c's toggles).

Spec §4.5 and decision 8. The clock is an astronomer's time–altitude chart: the day runs left to right (00:00 to 24:00), the Sun's arc and the Moon's (dashed) rise and set across a horizon line, with the twilight bands beneath it (civil, nautical, astronomical: −6°, −12°, −18°); a fine vertical line stands at the displayed instant, with the Sun and the Moon (drawn at its phase) where they are at that moment. Dragging anywhere on the chart, a body or the line, moves the hour: the pointer's time, pulled gently toward a detent within 8 minutes (Task 19), goes to the store, and the director's time spring carries the light there (the line and the bodies follow the light as it is shown, not the finger, so the glide is felt). Releasing within 8 minutes of sunrise, a golden hour's edge, sunset, moonrise or moonset settles there. The chart is one slider for assistive technology: its value is the hour (0–1439), its words say the time and where each body stands ("18:30. The Sun is 12° up in the west. The Moon is below the horizon."), and the keys move it (arrows five minutes, with Shift or Page Up/Down an hour, Home and End the day's ends, N for now). Its ticks, labels and colours follow the walk's palette and the product experience brief: quiet colour-change hovers, a small press, a visible brass focus ring, plain words. Under reduced motion nothing in the clock animates; the light cross-fades (Task 5). The displayed instant arrives at up to 60 updates a second through the director's channel and is written straight to the SVG's attributes (no React render per frame), so dragging stays at 60 fps.

Verified (7 October): R1b plan lines 7656–7760 (`LightControl.tsx` and `.css`: `useId`, `LABELS`, the radio group, the Time and Date rows, `ActivityStatus`, the palette variables), 7590–7614 (its tests) as Task 6 changed them; R1c's interface item 7 (`hiddenToggles`, `setToggleHidden(toggle: 1 | 2, hidden: boolean)`; the clutter hidden and the cabinet shown by default); `.claude/conventions/product-experience.md` and `.claude/conventions/loading-and-working-motion.md` (read by Task 0's prerequisites); this plan's Tasks 6, 9 and 19.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/components/rooms/__tests__/SkyClock.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dayNumber } from "../../../lib/light-setting.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { SkyClock, arcPath, clockWords, clockX, clockY, minutesFromPointer, type ClockReading } from "../SkyClock.js";

const initial = useLightSettingStore.getState();
beforeEach(() => {
  useLightSettingStore.setState(initial, true);
  useLightSettingStore.getState().selectPreset("sunny");
});
afterEach(() => { cleanup(); });

const reading = (minutes: number): ClockReading => ({
  instant: { day: dayNumber("2026-05-31"), minutes }, following: false,
  sun: { azimuth: 250, elevation: 12 }, moon: { azimuth: 90, elevation: -5, distanceKm: 384400, phaseAngle: 30, illuminatedFraction: 0.93, illuminance: 0 },
});

describe("the sky clock (T-639 R1d)", () => {
  it("maps the day across and the sky up, and draws an arc as a path", () => {
    expect([clockX(0), clockX(720), clockX(1440)]).toEqual([0, 144, 288]);
    expect([clockY(60), clockY(-20), clockY(0)]).toEqual([0, 112, 84]);
    expect(arcPath([{ minutes: 0, elevation: -20, azimuth: 0 }, { minutes: 720, elevation: 60, azimuth: 180 }])).toBe("M0.0 112.0 L144.0 0.0");
    expect(minutesFromPointer(150, { left: 6, width: 288 })).toBe(720);
  });

  it("speaks the hour and where each body stands", () => {
    expect(clockWords(1110, reading(1110))).toBe("18:30. The Sun is 12° up in the west-south-west. The Moon is below the horizon.");
  });

  it("is one slider for the hour, moved by the keys through the store", () => {
    render(<SkyClock subscribe={() => () => undefined} />);
    const slider = screen.getByRole("slider", { name: "Time" });
    expect(slider.getAttribute("aria-valuenow")).toBe("540");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(useLightSettingStore.getState().choice.minutes).toBe(545);
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(useLightSettingStore.getState().choice.minutes).toBe(605);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(useLightSettingStore.getState().choice.minutes).toBe(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(useLightSettingStore.getState().choice.minutes).toBe(1439);
    fireEvent.keyDown(slider, { key: "n" });
    expect(useLightSettingStore.getState().follow).toBe(true);
  });

  it("follows a drag and settles on a detent at release", () => {
    render(<SkyClock subscribe={() => () => undefined} />);
    const slider = screen.getByRole("slider", { name: "Time" });
    slider.getBoundingClientRect = () => ({ left: 0, width: 288, top: 0, height: 112, right: 288, bottom: 112, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 120, pointerId: 1 });
    expect(useLightSettingStore.getState().choice.minutes).toBe(600);
    // 31 May 2026's sunset is at 21:49 BST (1309.22 min; moonrise is 22:05): released 4 minutes away, it settles there.
    const x = (1313 / 1440) * 288;
    fireEvent.pointerMove(slider, { clientX: x, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: x, pointerId: 1 });
    const settled = useLightSettingStore.getState().choice.minutes;
    expect(settled).toBe(1309);
  });

  it("moves its line with the light as it is shown, without rendering again", () => {
    let push: (value: ClockReading | null) => void = () => undefined;
    render(<SkyClock subscribe={(listener) => { push = listener; return () => undefined; }} />);
    act(() => { push(reading(720)); });
    expect(screen.getByTestId("sky-clock-now").getAttribute("x1")).toBe("144.0");
  });

  it("rests, dimmed, for the captured light", () => {
    useLightSettingStore.getState().selectPreset("captured");
    render(<SkyClock subscribe={() => () => undefined} />);
    expect(screen.getByRole("slider", { name: "Time" }).getAttribute("aria-disabled")).toBe("true");
  });
});
```

In `packages/web/src/components/rooms/__tests__/LightControl.test.tsx`, replace (as Task 6 left them):

```tsx
    expect((screen.getByLabelText("Time") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(false);
```

with:

```tsx
    expect(screen.getByRole("slider", { name: "Time" }).getAttribute("aria-disabled")).toBe("false");
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Now" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("radio", { name: /Automatic|On|Off/u }).map((radio) => radio.getAttribute("value"))).toEqual(["auto", "on", "off"]);
```

replace R1b's

```tsx
    expect(screen.getByText("09:00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "600" } });
```

with:

```tsx
    const slider = screen.getByRole("slider", { name: "Time" });
    expect(slider.getAttribute("aria-valuetext")?.startsWith("09:00")).toBe(true);
    for (let step = 0; step < 12; step += 1) fireEvent.keyDown(slider, { key: "ArrowRight" });
```

and R1b's `    expect(screen.getByText("10:00")).toBeTruthy();` with `    expect(slider.getAttribute("aria-valuetext")?.startsWith("10:00")).toBe(true);`; and append inside its `describe`:

```tsx
  it("switches the lamps and what can be hidden (R1d)", () => {
    act(() => { useLightSettingStore.getState().setStatus("ready"); });
    render(<LightControl />);
    fireEvent.click(screen.getByRole("radio", { name: "On" }));
    expect(useLightSettingStore.getState().lamps).toBe("on");
    const loose = screen.getByRole("checkbox", { name: "Loose cables and stray items" }) as HTMLInputElement;
    const cabinet = screen.getByRole("checkbox", { name: "AV cabinet" }) as HTMLInputElement;
    expect([loose.checked, cabinet.checked]).toEqual([false, true]);
    fireEvent.click(loose);
    expect(useLightSettingStore.getState().hiddenToggles & 1).toBe(0);
    fireEvent.click(cabinet);
    expect(useLightSettingStore.getState().hiddenToggles & 2).toBe(2);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/SkyClock.test.tsx`
Expected: FAIL — cannot find module `../SkyClock.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl.test.tsx`
Expected: FAIL — no slider named "Time" and no "Now" button.

- [ ] **Step 3: The clock** — create `packages/web/src/components/rooms/SkyClock.tsx`:

```tsx
import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { dateOfDay, formatMinutes } from "../../lib/light-setting.js";
import { currentDisplayedLight, subscribeDisplayedLight, type DisplayedLight } from "../../lib/relight/light-director.js";
import { detentPull, skyArcs, skyDetents, snapToDetent, type SkyArcs } from "../../lib/relight/sky-arcs.js";
import { TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE } from "../../lib/sun.js";
import { useLightSettingStore } from "../../stores/light-setting-store.js";
import "./SkyClock.css";

/**
 * The sky clock (T-639 R1d, spec §4.5, decision 8): a time–altitude chart of the Sun's and the Moon's arcs for the
 * day, with the displayed instant as a line where both bodies stand. Dragging anywhere moves the hour (with gentle
 * detents at sunrise, the golden hours, sunset, moonrise and moonset); it is one slider for the keyboard and for
 * screen readers. The line follows the light as it is shown, written straight to the SVG at up to 60 updates a second.
 */
export const CLOCK_WIDTH = 288;
export const CLOCK_HEIGHT = 112;
export const ELEVATION_TOP = 60;
export const ELEVATION_BOTTOM = -20;
export const KEY_STEP_MINUTES = 5;
export const KEY_PAGE_MINUTES = 60;
const LAST_MINUTE = 1439;

export type ClockReading = Pick<DisplayedLight, "instant" | "sun" | "moon" | "following">;

export function clockX(minutes: number): number {
  return (Math.min(Math.max(minutes, 0), 1440) / 1440) * CLOCK_WIDTH;
}

export function clockY(elevation: number): number {
  const clamped = Math.min(Math.max(elevation, ELEVATION_BOTTOM), ELEVATION_TOP);
  return ((ELEVATION_TOP - clamped) / (ELEVATION_TOP - ELEVATION_BOTTOM)) * CLOCK_HEIGHT;
}

export function arcPath(points: SkyArcs["sun"]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${clockX(point.minutes).toFixed(1)} ${clockY(point.elevation).toFixed(1)}`).join(" ");
}

export function minutesFromPointer(clientX: number, rect: Pick<DOMRect, "left" | "width">): number {
  return Math.min(Math.max(((clientX - rect.left) / Math.max(rect.width, 1)) * 1440, 0), LAST_MINUTE);
}

const COMPASS = ["north", "north-north-east", "north-east", "east-north-east", "east", "east-south-east", "south-east", "south-south-east",
  "south", "south-south-west", "south-west", "west-south-west", "west", "west-north-west", "north-west", "north-north-west"] as const;

export function compassWord(azimuth: number): string {
  return COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16] ?? "north";
}

export function clockWords(minutes: number, reading: ClockReading | null): string {
  const time = formatMinutes(minutes);
  if (reading === null) return `${time}.`;
  const body = (name: string, elevation: number, azimuth: number): string =>
    elevation > 0 ? `The ${name} is ${String(Math.round(elevation))}° up in the ${compassWord(azimuth)}.` : `The ${name} is below the horizon.`;
  return `${time}. ${body("Sun", reading.sun.elevation, reading.sun.azimuth)} ${body("Moon", reading.moon.elevation, reading.moon.azimuth)}`;
}

/** The Moon's marker at its phase: the lit part as one path (a half disc and a terminator half-ellipse). */
function moonPhasePath(cx: number, cy: number, radius: number, fraction: number): string {
  const rx = radius * Math.abs(2 * fraction - 1);
  const sweep = fraction > 0.5 ? 1 : 0;
  return `M${cx.toFixed(1)} ${(cy - radius).toFixed(1)} A${radius} ${radius} 0 0 1 ${cx.toFixed(1)} ${(cy + radius).toFixed(1)} A${rx.toFixed(2)} ${radius} 0 0 ${String(sweep)} ${cx.toFixed(1)} ${(cy - radius).toFixed(1)}Z`;
}

export function SkyClock({ subscribe = subscribeDisplayedLight }: {
  readonly subscribe?: (listener: (reading: ClockReading | null) => void) => () => void;
}): ReactElement {
  const choice = useLightSettingStore((state) => state.choice);
  const setMinutes = useLightSettingStore((state) => state.setMinutes);
  const followClock = useLightSettingStore((state) => state.followClock);
  const following = useLightSettingStore((state) => state.follow);
  const captured = choice.preset === "captured";
  // While following, the chart is the displayed day's (live time crosses midnight); otherwise the chosen date's.
  const live = currentDisplayedLight();
  const day = following && live !== null ? dateOfDay(live.instant.day) : choice.date;
  const arcs = useMemo(() => skyArcs(day, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), [day]);
  const detents = useMemo(() => skyDetents(day, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), [day]);
  const line = useRef<SVGLineElement>(null);
  const sun = useRef<SVGCircleElement>(null);
  const moon = useRef<SVGPathElement>(null);
  const slider = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  useEffect(() => subscribe((reading) => {
    if (reading === null) return;
    const x = clockX(reading.instant.minutes);
    line.current?.setAttribute("x1", x.toFixed(1));
    line.current?.setAttribute("x2", x.toFixed(1));
    sun.current?.setAttribute("cx", x.toFixed(1));
    sun.current?.setAttribute("cy", clockY(reading.sun.elevation).toFixed(1));
    moon.current?.setAttribute("d", moonPhasePath(x, clockY(reading.moon.elevation), 5, reading.moon.illuminatedFraction));
    slider.current?.setAttribute("aria-valuetext", clockWords(reading.instant.minutes, reading));
  }), [subscribe]);

  const move = (minutes: number): void => { setMinutes(Math.round(minutes)); };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (captured) return;
    const step = event.shiftKey ? KEY_PAGE_MINUTES : KEY_STEP_MINUTES;
    const now = choice.minutes;
    const next: Record<string, number | undefined> = {
      ArrowRight: now + step, ArrowUp: now + step, ArrowLeft: now - step, ArrowDown: now - step,
      PageUp: now + KEY_PAGE_MINUTES, PageDown: now - KEY_PAGE_MINUTES, Home: 0, End: LAST_MINUTE,
    };
    if (event.key === "n" || event.key === "N") { event.preventDefault(); followClock(); return; }
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(Math.min(Math.max(target, 0), LAST_MINUTE));
  };
  const pointerMinutes = (event: PointerEvent<SVGSVGElement>): number => minutesFromPointer(event.clientX, event.currentTarget.getBoundingClientRect());
  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (captured) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    move(detentPull(pointerMinutes(event), detents));
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (dragging.current) move(detentPull(pointerMinutes(event), detents));
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    move(snapToDetent(pointerMinutes(event), detents));
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const shown = currentDisplayedLight();
  const nowX = clockX(shown?.instant.minutes ?? choice.minutes);
  return (
    <svg
      ref={slider} className="sky-clock" data-captured={captured} viewBox={`0 0 ${String(CLOCK_WIDTH)} ${String(CLOCK_HEIGHT)}`}
      role="slider" aria-label="Time" tabIndex={captured ? -1 : 0} aria-disabled={captured}
      aria-valuemin={0} aria-valuemax={LAST_MINUTE} aria-valuenow={choice.minutes} aria-valuetext={clockWords(choice.minutes, shown)}
      onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    >
      {[-6, -12, -18].map((band) => (
        <rect key={band} className="sky-clock__twilight" x={0} y={clockY(0)} width={CLOCK_WIDTH} height={clockY(band) - clockY(0)} />
      ))}
      <line className="sky-clock__horizon" x1={0} x2={CLOCK_WIDTH} y1={clockY(0)} y2={clockY(0)} />
      {[0, 360, 720, 1080].map((minutes) => (
        <text key={minutes} className="sky-clock__hour" x={clockX(minutes) + 2} y={CLOCK_HEIGHT - 3}>{formatMinutes(minutes).slice(0, 2)}</text>
      ))}
      {detents.map((detent) => (
        <line key={`${detent.kind}-${String(detent.minutes)}`} className={`sky-clock__detent sky-clock__detent--${detent.kind}`}
          x1={clockX(detent.minutes)} x2={clockX(detent.minutes)} y1={clockY(0) - 3} y2={clockY(0) + 3} />
      ))}
      <path className="sky-clock__arc sky-clock__arc--moon" d={arcPath(arcs.moon)} />
      <path className="sky-clock__arc sky-clock__arc--sun" d={arcPath(arcs.sun)} />
      <line ref={line} data-testid="sky-clock-now" className="sky-clock__now" x1={nowX.toFixed(1)} x2={nowX.toFixed(1)} y1={0} y2={CLOCK_HEIGHT} />
      <path ref={moon} className="sky-clock__moon" d={moonPhasePath(nowX, clockY(shown?.moon.elevation ?? ELEVATION_BOTTOM), 5, shown?.moon.illuminatedFraction ?? 0.5)} />
      <circle ref={sun} className="sky-clock__sun" cx={nowX.toFixed(1)} cy={clockY(shown?.sun.elevation ?? ELEVATION_BOTTOM).toFixed(1)} r={5} />
    </svg>
  );
}
```

Create `packages/web/src/components/rooms/SkyClock.css`:

```css
/* The sky clock (T-639 R1d): a time–altitude chart in the walk's palette, brass for the Sun, stone for the Moon. */

.sky-clock {
  display: block;
  width: 100%;
  height: auto;
  margin: 0.35rem 0 0.25rem;
  border-radius: 0.45rem;
  background: rgba(242, 236, 223, 0.03);
  cursor: grab;
  touch-action: none;
  transition: background-color 160ms ease;
}
.sky-clock:hover { background: rgba(242, 236, 223, 0.06); }
.sky-clock:active { cursor: grabbing; }
.sky-clock:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.sky-clock[data-captured="true"] { cursor: default; opacity: 0.45; }

.sky-clock__twilight { fill: rgba(30, 40, 70, 0.22); }
.sky-clock__horizon { stroke: var(--stone-dim); stroke-width: 0.75; }
.sky-clock__hour { fill: var(--stone-dim); font-size: 7px; font-variant-numeric: tabular-nums; }
.sky-clock__detent { stroke: var(--stone-dim); stroke-width: 0.75; }
.sky-clock__detent--sunrise, .sky-clock__detent--sunset { stroke: var(--brass); }
.sky-clock__arc { fill: none; stroke-width: 1.25; stroke-linecap: round; }
.sky-clock__arc--sun { stroke: var(--brass); }
.sky-clock__arc--moon { stroke: var(--stone); stroke-dasharray: 2 2.5; opacity: 0.8; }
.sky-clock__now { stroke: var(--stone); stroke-width: 0.75; opacity: 0.7; }
.sky-clock__sun { fill: var(--brass); }
.sky-clock__moon { fill: var(--stone); }

@media (prefers-reduced-motion: reduce) {
  .sky-clock { transition: none; }
}
```

- [ ] **Step 4: The control** — in `packages/web/src/components/rooms/LightControl.tsx`, replace the imports with:

```tsx
import { useId, type ReactElement } from "react";
import { ActivityStatus } from "../shared/Activity.js";
import { LAMP_MODES, LIGHT_PRESETS, type LampMode, type LightPresetId } from "../../lib/light-setting.js";
import { useLightSettingStore } from "../../stores/light-setting-store.js";
import { SkyClock } from "./SkyClock.js";
import "./LightControl.css";

const LAMP_LABELS: Readonly<Record<LampMode, string>> = { auto: "Automatic", on: "On", off: "Off" };
```

keep `LABELS` (with Task 6's `live`), and replace the function's body from `  const choice = useLightSettingStore((state) => state.choice);` to its end with:

```tsx
  const choice = useLightSettingStore((state) => state.choice);
  const status = useLightSettingStore((state) => state.status);
  const follow = useLightSettingStore((state) => state.follow);
  const lamps = useLightSettingStore((state) => state.lamps);
  const hidden = useLightSettingStore((state) => state.hiddenToggles);
  const selectPreset = useLightSettingStore((state) => state.selectPreset);
  const setDate = useLightSettingStore((state) => state.setDate);
  const setLamps = useLightSettingStore((state) => state.setLamps);
  const followClock = useLightSettingStore((state) => state.followClock);
  const setToggleHidden = useLightSettingStore((state) => state.setToggleHidden);
  const group = useId(), lampGroup = useId(), dateId = useId();
  if (status === "off") return null;
  const timed = choice.preset !== "captured";
  return (
    <section className="light-control" aria-label="Light">
      <fieldset className="light-control__presets">
        <legend className="light-control__legend">Light</legend>
        {LIGHT_PRESETS.map((preset) => (
          <label key={preset} className="light-control__preset">
            <input type="radio" name={group} value={preset} checked={choice.preset === preset} onChange={() => { selectPreset(preset); }} />
            <span>{LABELS[preset]}</span>
          </label>
        ))}
      </fieldset>
      <SkyClock />
      <div className="light-control__row">
        <label className="light-control__label" htmlFor={dateId}>Date</label>
        <input id={dateId} type="date" value={choice.date} disabled={!timed} onChange={(event) => { setDate(event.currentTarget.value); }} />
        <button type="button" className="light-control__now" aria-pressed={follow} onClick={followClock}>Now</button>
      </div>
      <fieldset className="light-control__lamps" disabled={!timed}>
        <legend className="light-control__legend">Lamps</legend>
        {LAMP_MODES.map((mode) => (
          <label key={mode} className="light-control__preset">
            <input type="radio" name={lampGroup} value={mode} checked={lamps === mode} onChange={() => { setLamps(mode); }} />
            <span>{LAMP_LABELS[mode]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="light-control__toggles">
        <legend className="light-control__legend">In the room</legend>
        <label className="light-control__preset">
          <input type="checkbox" checked={(hidden & 1) === 0} onChange={(event) => { setToggleHidden(1, !event.currentTarget.checked); }} />
          <span>Loose cables and stray items</span>
        </label>
        <label className="light-control__preset">
          <input type="checkbox" checked={(hidden & 2) === 0} onChange={(event) => { setToggleHidden(2, !event.currentTarget.checked); }} />
          <span>AV cabinet</span>
        </label>
      </fieldset>
      {status === "loading" && <ActivityStatus className="light-control__status">Preparing the light…</ActivityStatus>}
    </section>
  );
```

and append to `packages/web/src/components/rooms/LightControl.css`:

```css
/* R1d: the lamps, the switches and Now, in the same quiet rows. */
.light-control__lamps, .light-control__toggles { display: grid; gap: 0.2rem; margin: 0.4rem 0 0; padding: 0; border: 0; }
.light-control__lamps:disabled { opacity: 0.45; }
.light-control__now {
  margin-left: auto;
  padding: 0.2rem 0.55rem;
  border: 1px solid rgba(242, 236, 223, 0.2);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--stone);
  font: inherit;
  cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease, transform 80ms ease;
}
.light-control__now:hover { background: rgba(242, 236, 223, 0.06); }
.light-control__now:active { transform: translateY(1px); }
.light-control__now[aria-pressed="true"] { color: var(--brass); border-color: var(--brass); }
.light-control__now:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .light-control__now { transition: none; } }
```

The light setting's `MIN_MINUTES`, `MAX_MINUTES` and `formatMinutes` imports leave `LightControl.tsx` (the clock uses `formatMinutes`).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/SkyClock.test.tsx`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl.test.tsx`
Expected: PASS, the count after Task 6 plus 1.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: PASS at its count (the control is still a region named "Light").

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/components/rooms/SkyClock.tsx src/components/rooms/LightControl.tsx`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/components/rooms/SkyClock.tsx packages/web/src/components/rooms/SkyClock.css packages/web/src/components/rooms/__tests__/SkyClock.test.tsx packages/web/src/components/rooms/LightControl.tsx packages/web/src/components/rooms/LightControl.css packages/web/src/components/rooms/__tests__/LightControl.test.tsx && git diff --cached --stat && git commit -m "feat(rooms): the sky clock: the Sun's and the Moon's arcs, dragged, with detents, one accessible slider (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Night calibration, the colour-accuracy measure and the eye's anchors

**Files:**
- Create: `tools/relight/relight/nightcal.py`, `tools/relight/tests/test_nightcal.py`, `packages/web/scripts/cinematic-calibrate.mjs`
- Modify: `tools/relight/relight/__main__.py` (register `night-calibration`), `packages/web/src/lib/relight/light-director.ts` (eye hold, lamp solo, the latest measurement, the calibration in use, the session's director), `packages/web/src/lib/relight/relight-debug.ts` (the calibration controls)
- Test: `tools/relight/tests/test_nightcal.py` (create), `packages/web/src/lib/relight/__tests__/light-director.test.ts`, `packages/web/src/lib/relight/__tests__/relight-debug.test.ts` (modify)
- Outputs (D:): `D:/claude/relight/grand-hall/renders/R1d_night_{all,rest,cove,ch_end,ch_centre,dome}/<station>@2x.png` and `renders/R1d_captured/<station>@2x.png`, `D:/claude/relight/grand-hall/evidence/r1d/night-basis-held.json`, `D:/claude/relight/grand-hall/work/eye-anchors.json` (only when its gate passes) and `evidence/r1d/eye-anchors.json`, `D:/claude/relight/grand-hall/work/night-calibration.json` (only when accepted) and `evidence/r1d/night-calibration.json`, `D:/claude/relight/grand-hall/verify/r1d/night-calibration-run{1,2}.json`; then the cinematic package rebuilt (Task 3's command, twice).

**Interfaces:**
- Consumes: Task 3 (`cinematic.night_gains`, `cinematic.eye_anchors`, the `cinematic` command), Task 9 (`LightDirector`, its `tick`, `publisher`, `wake`), Task 13 (the measurement), Tasks 5–6 (`EyeTarget`, `FrameMeasurement`, `LuminanceCalibration`, `CAPTURE_CALIBRATION`, `adaptationLuminance`, `scotopicAmount`, `lightChroma`, `LampDrives`, `lampTargets`); R1b's `window.__roomViewCapture`, `window.__roomWalk`, `window.__relight` (`select`, `state`), `applicationForChoice`, `defaultChoice`, `relight-verify.mjs`'s lock and capture helpers, `browsercheck.py` (`NIGHT_STATIONS`, `prepare`) and the proof's `07_compare` (`photo`, `render`, `valid_mask`, `cells`, `metrics`).
- Produces (`nightcal.py`): `GAIN_RANGE = (0.25, 4.0)`, `RIDGE = 0.1`, `CELL_FRACTION = 0.7`, `KNEE_SRGB = 0.9`, `ADDITIVITY = 0.02`, `GROUP_MIN_SHARE = 0.01`, `LAMP_GROUPS`, `BASIS = ("rest", …LAMP_GROUPS)`, `JOB_PREFIX = "R1d_night_"`, `CAPTURED_JOB = "R1d_captured"`, `HELD_FILE`; `linear_to_lab(rgb)` (D65), `ciede2000(lab1, lab2)` (Sharma, Wu & Dalal 2005); `to_render_light(photo, render) -> (cells, a, b)`; `fit_gains(photo, rest, basis, ridge=RIDGE)`; `normalise_gains(gains, basis)`; `colour_accuracy(photo, render) -> {median, p90}`; `dark_groups(basis) -> list[str]`; `additivity(cells) -> float`; `accepted(stations) -> bool`; `station_cells(cmp, view, exposure) -> dict`; `measure(cmp, photo, model) -> dict`; `run(cfg, args) -> int` (the command `night-calibration`).
- Produces (director): `LightDirector.holdEye(display: EyeTarget | null): void`, `soloLamps(group: LampGroup | "none" | null): void`, `latestMeasurement(): FrameMeasurement | null`, getter `calibration: LuminanceCalibration`; `currentDirector(): LightDirector | null` (the director that last displayed a light; null once it stops).
- Produces (DEV, `relight-debug.ts`): `interface CinematicControls { holdEye(display: EyeTarget | null): void; soloLamps(group: LampGroup | "none" | null): void; still(): boolean; measurement(): FrameMeasurement | null; adaptation(): { readonly luminance: number; readonly scotopic: number } | null; lightChroma(): readonly [number, number] | null; presetDisplay(preset: LightPresetId): DisplayParams }`; `cinematicControls(director: LightDirector | null, frame: RelightFrame): CinematicControls | null`; `RelightDebug.cinematic: CinematicControls | null` on `window.__relight` (null under `?cinematic=off`; Task 22 extends `CinematicControls`).

Spec §4.3 asks for "night colour calibration" and a photo check that gains "a colour-accuracy measure", both "never worse than the hall as captured". The night photographs of Matterport stations 43 and 45 (the proof's `cmp/photo_*`, the same R1b's photo check uses) were taken with every lamp lit. The browser renders each station with the eye held at the night's own exposure, neutral white balance and no night vision: every lamp lit, none (the rest: the street, the skyglow and any Moon through the windows), each lamp group alone at full drive (so the dimming curve, warm or LED, plays no part), and the captured light, all at R1b's 2× size into the renders folder R1b's checks read. Two things about the photographs are unknown, and the calibration is built so that neither can leak into the lamps:
- **The tone curve.** The proof's own comparison (07_compare: its masks, its 48 × 27 cells, its log-luminance r) fits the photograph's cell log luminance against the render's as a line; its slope is the tone curve's contrast. The photograph is brought into the render's light by inverting that power law per channel.
- **The camera's exposure and white balance.** The gains are fitted per channel by relative least squares (log-like, so the cells beside the bulbs do not outweigh the room), with a ridge toward 1 scaled by the normal matrix's own size, then normalised per channel so each channel's total lamp light is unchanged. A global exposure or tint therefore cancels exactly (a test proves it): the gains only move light and colour between the groups (the frieze tape against the chandeliers against the dome's crests), and each group's absolute colour stays the bake's, which is a package value (decision 11).
Each solo render holds the rest too, so a group's own light is its render less the rest; the four groups and the rest must add up to the all-lamps render within 2% (median cell luminance), proving the renders are linear light (cells past the display's knee are left out). The measure is CIEDE2000 between cells (Sharma, Wu & Dalal 2005, tested on seven of their published pairs in both orders), after the camera's white balance is removed by a per-channel von Kries gain and both images are scaled so the render's 95th-percentile cell is white, reported as median and 90th percentile beside r, for the hall as captured, the uncalibrated night and the calibrated night. The gains are kept only if at both stations the calibrated night is no worse than the captured hall, than the uncalibrated night and than R1b's threshold (0.85 at station 43, 0.80 at 45) by r, and no worse than either by median ΔE00. Decision 11's rule is enforced here: a lamp group below 1% of the lamps' light in the renders is dark in the bake (R1a's fit gave the lit centre chandelier 1.4e-11), and the calibration is refused, naming it, until the bake refits; gains never paper over a lost lamp. A refusal leaves the gains at 1 and writes only the evidence.

The eye's anchors are measured at the walk's own starting view: for the sunny morning, the lamp-lit night and the moonlit night, the eye is held at that preset's calibrated display (R1b's `applicationForChoice` at the preset's own hour; the moonlit key, A7) and the composer's measurement (Task 13, the frame's light before the eye) and the light's chroma are recorded. The frontier study's gate is checked here: the lamp-lit night's adaptation luminance (2^λ × 54 cd/m², the calibration in use) must give no night vision at all (at or above 5 cd/m²), and the moonlit night's must be dimmer and give some. A miss is reported with the numbers (the calibration's ±1 stop is the likely cause), never tuned away, and the anchors are not written for the package; the eye then keeps its fallback.

Verified (7 October): R1b plan lines 7853 (`RoomViewCaptureRequest { position, target, fov, width, height }`), 8423 and 8466 (`window.__roomViewCapture(request)` resolves a `NativeCurrentViewCapture` whose `dataUrl` the driver writes), 8054–8068 (`RelightDebug`: `state`, `select(preset, minutes?, date?)`), 7963–7980 (`relight-debug.ts`'s imports: `applicationForChoice`, `PRESET_DEFAULTS`, `type LightPresetId`, `type DisplayParams`, `type RelightFrame`), 8188–8207 (`installRelightDebug(frame, host, renderer)`, `select` resolving after the next apply and two frames), 8304 (`window.__relight = debug`), 4579 (`applicationForChoice(…, defaultChoice("night"), …).display` equals `PRESET_DISPLAY.night`), 8667 (`NIGHT_STATIONS = {"mp43_night_end": 0.85, "mp45_night_windows": 0.80}`), 8752–8767 (`photo_report`: `cmp.photo`, `cmp.render`, `cmp.valid_mask`, `cmp.cells`, `cmp.metrics`, cells with fraction > 0.7), 8826–8843 (`prepare(cfg)`; `importlib.import_module("07_compare")` once `python -m relight` has made the proof importable), 8866–8872 (`from . import browsercheck  # noqa: E402` directly after `COMMANDS: dict = {}`), 8902–8975 (`relight-verify.mjs`: `BASE_URL` 5192, `ROOT`, `VIEWS`, `WIDTH`/`HEIGHT`/`SCALE` 1920 × 1080 × 2, `takeLock` with its hour limit, `releaseLock`, `captureViews` writing `<ROOT>/renders/<job>/<view>@2x.png`), 9003–9005 (headed Chromium and its background flags); `tools/relight/proof/07_compare.py:30-35` (`render`: the `@2x` render box-averaged to 1× by `one_x`), `:37-42` (`photo`), `:45-50` (`valid_mask`: the A_mask render's red and green below 0.05, each sRGB's max in (0.03, 0.98)), `:53-57` (`cells`, 48 × 27, with each cell's valid fraction), `:60-69` (`metrics`: r of the cells' log2 luminance; `np.polyfit(lm, lp, 1)`, the tone curve's slope); `D:/claude/real-hall/renovation/relight/renders/A_mask/mp43_night_end.png` and `work/cmp/photo_mp43_night_end.png` (1920 × 1080; R1b's `prepare` copies both); this plan's Task 3 (`night_gains`: calibrated whenever the file exists; `eye_anchors` reads `{ anchors: { day, lamps, moon: { exposure, whiteBalance, logLuminance, logChroma } } }`), Task 5 (`LightMotion.current`: the eye in log2, so exposures 2 and 4 are exact), Task 9 (`publisher`, `publish`, `private measurement`, `private wake()`, the `tick` lines replaced below), Task 13 (the measurement: the output's luminance over the exposure in force, every third frame). The calibration code and its tests below were run on 7 October (`C:/Python313/python.exe`, a scratch copy with a stand-in `browsercheck`): the 10 tests pass, CIEDE2000 reproduces Sharma's pairs to four decimals both ways, and a synthetic night (a power-law tone curve of slope 0.8, a camera tint [1.1, 1, 0.85], 8-bit renders) recovered the slope as 0.802, added up within 0.3% and lowered the median ΔE00 from 1.02 to 0.57.

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_nightcal.py`:

```python
import unittest

import numpy as np

from relight import nightcal as N

# Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula: implementation notes, supplementary test data
# and mathematical observations", Table 1: pairs 1, 2, 3, 7, 17, 25 and 34.
SHARMA = [
    ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
    ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
    ((50.0, 2.8361, -74.0200), (50.0, 0.0, -82.7485), 3.4412),
    ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
    ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
    ((50.0, 2.5, 0.0), (50.0, 3.2592, 0.3350), 1.0000),
    ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
]


class Colour(unittest.TestCase):
    def test_ciede2000_matches_sharmas_published_pairs_both_ways(self):
        for lab1, lab2, expected in SHARMA:
            self.assertAlmostEqual(float(N.ciede2000(np.array(lab1), np.array(lab2))), expected, places=4)
            self.assertAlmostEqual(float(N.ciede2000(np.array(lab2), np.array(lab1))), expected, places=4)

    def test_white_is_lightness_100_and_neutral(self):
        np.testing.assert_allclose(N.linear_to_lab(np.array([1.0, 1.0, 1.0])), [100.0, 0.0, 0.0], atol=1e-9)
        np.testing.assert_allclose(N.linear_to_lab(np.array([0.18, 0.18, 0.18]))[1:], [0.0, 0.0], atol=1e-9)

    def test_colour_accuracy_ignores_the_cameras_white_balance_and_exposure(self):
        render = np.random.default_rng(3).uniform(0.01, 0.5, (300, 3))
        self.assertEqual(N.colour_accuracy(render, render), {"median": 0.0, "p90": 0.0})
        tinted = N.colour_accuracy(render * np.array([1.3, 1.0, 0.7]) * 2.0, render)
        self.assertLess(max(tinted.values()), 1e-9)
        shifted = render.copy(); shifted[:, 2] *= np.linspace(0.5, 1.5, 300)
        self.assertGreater(N.colour_accuracy(shifted, render)["median"], 1.0)


class ToneCurve(unittest.TestCase):
    def test_inverts_a_power_law_tone_curve(self):
        grey = np.repeat(np.random.default_rng(5).uniform(0.01, 0.6, (200, 1)), 3, 1)
        mapped, a, b = N.to_render_light((0.5 * grey) ** 0.8, grey)
        self.assertAlmostEqual(b, 0.8, places=9)
        self.assertAlmostEqual(a, -0.8, places=9)
        np.testing.assert_allclose(mapped, grey, rtol=1e-9)


class Gains(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(7)
        self.basis = {g: rng.uniform(0.01, 0.2, (200, 3)) for g in N.LAMP_GROUPS}
        self.rest = rng.uniform(0.0, 0.01, (200, 3))
        self.truth = {"cove": [1.2, 1.0, 0.8], "ch_end": [0.9, 1.0, 1.1], "ch_centre": [1.0, 1.0, 1.0], "dome": [1.1, 0.95, 0.9]}
        self.photo = self.rest + sum(np.asarray(self.truth[g]) * self.basis[g] for g in N.LAMP_GROUPS)

    def test_recovers_the_gains_of_a_noiseless_night(self):
        gains = N.fit_gains(self.photo, self.rest, self.basis, ridge=1e-12)
        for g in N.LAMP_GROUPS:
            np.testing.assert_allclose(gains[g], self.truth[g], atol=1e-6)

    def test_the_ridge_pulls_toward_one_and_the_range_holds(self):
        def spread(gains, channel):
            return sum((gains[g][channel] - 1.0) ** 2 for g in N.LAMP_GROUPS)

        loose = N.fit_gains(self.photo, self.rest, self.basis, ridge=1e-12)
        middle = N.fit_gains(self.photo, self.rest, self.basis, ridge=1.0)
        tight = N.fit_gains(self.photo, self.rest, self.basis, ridge=100.0)
        for channel in range(3):
            self.assertLessEqual(spread(middle, channel), spread(loose, channel) + 1e-12)
            self.assertLessEqual(spread(tight, channel), spread(middle, channel) + 1e-12)
            self.assertLess(spread(tight, channel), 1e-3)
        clamped = N.fit_gains(self.photo * 100.0, self.rest, self.basis, ridge=1e-12)
        self.assertTrue(all(N.GAIN_RANGE[0] <= v <= N.GAIN_RANGE[1] for g in N.LAMP_GROUPS for v in clamped[g]))

    def test_normalising_removes_a_cameras_exposure_and_white_balance(self):
        tint = [2.0 * 1.2, 2.0, 2.0 * 0.8]
        for gain in N.normalise_gains({g: tint for g in N.LAMP_GROUPS}, self.basis).values():
            np.testing.assert_allclose(gain, [1.0, 1.0, 1.0], rtol=1e-12)
        gains = N.normalise_gains(self.truth, self.basis)
        light = sum(self.basis[g].sum(0) for g in N.LAMP_GROUPS)
        np.testing.assert_allclose(sum(np.asarray(gains[g]) * self.basis[g].sum(0) for g in N.LAMP_GROUPS), light, rtol=1e-12)

    def test_a_group_the_bake_leaves_dark_is_named(self):
        self.assertEqual(N.dark_groups(self.basis), [])
        dim = dict(self.basis, ch_centre=self.basis["ch_centre"] * 1e-4)
        self.assertEqual(N.dark_groups(dim), ["ch_centre"])

    def test_the_basis_must_add_up(self):
        cells = {"rest": self.rest, **self.basis, "all": self.rest + sum(self.basis[g] for g in N.LAMP_GROUPS)}
        self.assertLess(N.additivity(cells), 1e-12)
        self.assertGreater(N.additivity({**cells, "all": cells["all"] * 1.1}), N.ADDITIVITY)


class Verdict(unittest.TestCase):
    def station(self, r_after, median_after, add=0.0):
        return {"threshold": 0.80, "additivity": add, "captured": {"r": 0.82, "median": 6.0}, "before": {"r": 0.86, "median": 5.0},
                "after": {"r": r_after, "median": median_after}}

    def test_keeps_gains_only_when_no_station_is_worse(self):
        self.assertTrue(N.accepted({"a": self.station(0.87, 4.0), "b": self.station(0.86, 5.0)}))
        self.assertFalse(N.accepted({"a": self.station(0.87, 4.0), "b": self.station(0.85, 4.0)}))
        self.assertFalse(N.accepted({"a": self.station(0.87, 5.5)}))
        self.assertFalse(N.accepted({"a": self.station(0.87, 4.0, add=0.05)}))
        self.assertFalse(N.accepted({}))


if __name__ == "__main__":
    unittest.main()
```

In `packages/web/src/lib/relight/__tests__/light-director.test.ts`, add `currentDirector` to its import from `../light-director.js` and append inside its `describe`:

```ts
  it("holds the eye where the calibration asks, lights one group alone, and names the session's director (Task 21)", () => {
    useLightSettingStore.getState().selectPreset("night");
    const { frame, director, frames } = rig();
    director.start();
    expect(currentDirector()).toBe(director);
    director.holdEye({ exposure: 2, whiteBalance: [1, 1, 1], scotopic: 0 });
    frames(8);
    expect(frame.current?.display).toEqual({ exposure: 2, whiteBalance: [1, 1, 1], scotopic: 0 });
    director.soloLamps("dome");
    frames(6);
    expect([frame.current?.setting.lampLevels.dome, frame.current?.setting.lampLevels.cove]).toEqual([1, 0]);
    director.soloLamps(null);
    director.holdEye(null);
    frames(6);
    expect(frame.current?.setting.lampLevels.cove).toBe(1);
    expect(director.latestMeasurement()).toBeNull();
    director.setMeasurement({ logLuminance: -2, at: 5 });
    expect(director.latestMeasurement()).toEqual({ logLuminance: -2, at: 5 });
    expect(director.calibration).toBe(CAPTURE_CALIBRATION);
    director.stop();
    expect(currentDirector()).toBeNull();
  });
```

In `packages/web/src/lib/relight/__tests__/relight-debug.test.ts`, add `cinematicControls` to its import from `../relight-debug.js`, add the imports

```ts
import { PRESET_DISPLAY } from "../../light-setting.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { LightDirector } from "../light-director.js";
import { loadRelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { buildTestPackage } from "./relight-test-package.js";
```

and append inside its `describe`:

```ts
  it("offers the calibration controls only with a director, and drives the director through them (R1d)", async () => {
    const pkg = buildTestPackage();
    const frame = new RelightFrame(await loadRelightModelData(pkg.fetch, pkg.manifestUrl));
    expect(cinematicControls(null, frame)).toBeNull();
    useLightSettingStore.getState().selectPreset("night");
    const queue: (() => void)[] = [];
    let time = 0;
    const director = new LightDirector({
      frame, invalidate: () => undefined, now: () => time, clock: () => Date.UTC(2026, 4, 31, 22, 0), reducedMotion: () => false,
      requestFrame: (callback) => queue.push(callback), cancelFrame: () => undefined, setTimer: () => 0, clearTimer: () => undefined,
    });
    const controls = cinematicControls(director, frame);
    director.start();
    controls?.soloLamps("none");
    controls?.holdEye({ exposure: 4, whiteBalance: [1, 1, 1], scotopic: 0 });
    for (let step = 0; step < 900 && controls?.still() !== true; step += 1) {
      time += 1000 / 60;
      for (const callback of queue.splice(0)) callback();
    }
    expect(controls?.still()).toBe(true);
    expect(frame.current?.display).toEqual({ exposure: 4, whiteBalance: [1, 1, 1], scotopic: 0 });
    expect(frame.current?.setting.lampLevels.dome).toBe(0);
    expect(controls?.presetDisplay("night")).toEqual(PRESET_DISPLAY.night);
    expect([controls?.measurement(), controls?.adaptation()]).toEqual([null, null]);
    director.setMeasurement({ logLuminance: Math.log2(10 / 54), at: 1 });
    expect(controls?.adaptation()?.luminance).toBeCloseTo(10, 9);
    expect(controls?.adaptation()?.scotopic).toBe(0);
    director.stop();
    useLightSettingStore.getState().selectPreset("captured");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_nightcal -v`
Expected: FAIL — `ImportError: cannot import name 'nightcal' from 'relight'`.

Run, one per command (`pnpm --filter @omnitwin/web exec vitest run <path>`): `src/lib/relight/__tests__/light-director.test.ts`, `src/lib/relight/__tests__/relight-debug.test.ts`.
Expected: each FAILS on its new test (`currentDirector` and `cinematicControls` do not exist).

- [ ] **Step 3: The calibration** — create `tools/relight/relight/nightcal.py`:

```python
"""The night calibration and the colour-accuracy measure (T-639 R1d plan Task 21).

The night photographs of Matterport stations 43 and 45 were taken with every lamp lit. cinematic-calibrate.mjs
renders each station with the eye held at the night's exposure, neutral white balance and no night vision: every
lamp lit, none (the rest: the street, the skyglow and any Moon through the windows), each lamp group alone, and the
captured light. Each group gets one RGB gain from them. The photographs' tone curve and white balance are unknown:
- the comparison is the proof's own (07_compare: its masks, its 48 x 27 cells, its r), exactly as R1b's photo check;
- the photograph is brought into the render's light by inverting the power law that best maps the render's cell
  log luminance onto the photograph's (07_compare's affine fit in log2, whose slope is the tone curve's contrast);
- the gains are fitted per channel by relative least squares (log-like, so the cells beside the bulbs do not
  outweigh the room) with a ridge toward 1, then normalised per channel so each channel's total lamp light is
  unchanged: the camera's exposure and white balance cannot enter, and the gains only move light and colour between
  the groups. The lamps' overall colour stays the bake's: a package value, the relight package's per-source colour.
The measure is CIEDE2000 (Sharma, Wu & Dalal 2005) between cells, after the camera's white balance is removed (a
per-channel von Kries gain) and both are scaled so the render's 95th-percentile cell luminance is white. The gains
are kept only if every station is no worse than the hall as captured and than the uncalibrated night, by r and by
median CIEDE2000, the basis renders add up to the all-lamps render (they are linear light), and no lamp group is
dark in the bake (a group the capture fit lost, such as the centre chandelier before the bake's refit).

The verdicts take arrays, so the unit tests need no D: inputs; run() reads the renders through 07_compare."""
from __future__ import annotations

import importlib
import json
import os

import numpy as np

from . import browsercheck

GAIN_RANGE = (0.25, 4.0)
RIDGE = 0.1
CELL_FRACTION = 0.7
# A held render is linear light only below the display's roll-off (knee 0.8 linear = sRGB 0.906).
KNEE_SRGB = 0.9
# The basis renders must add up to the all-lamps render within this median relative error of cell luminance.
ADDITIVITY = 0.02
# A lamp group below this share of the lamps' light in the renders is dark in the bake (R1a's fit gave the lit centre
# chandelier a weight of 1.4e-11): the calibration is refused until the bake refits, never papered over by gains.
GROUP_MIN_SHARE = 0.01
LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")
BASIS = ("rest",) + LAMP_GROUPS
JOB_PREFIX = "R1d_night_"
CAPTURED_JOB = "R1d_captured"
HELD_FILE = "night-basis-held.json"
LUMINANCE = np.array([0.2126, 0.7152, 0.0722])
SRGB_TO_XYZ = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
WHITE_D65 = SRGB_TO_XYZ @ np.ones(3)


def linear_to_lab(rgb):
    """CIE L*a*b* (D65) of linear sRGB, with linear white [1, 1, 1] at L* 100."""
    xyz = np.asarray(rgb, np.float64) @ SRGB_TO_XYZ.T / WHITE_D65
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def ciede2000(lab1, lab2):
    """CIEDE2000 colour difference (Sharma, Wu & Dalal 2005, kL = kC = kH = 1), elementwise over the last axis."""
    L1, a1, b1 = np.moveaxis(np.asarray(lab1, np.float64), -1, 0)
    L2, a2, b2 = np.moveaxis(np.asarray(lab2, np.float64), -1, 0)
    Cb = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25.0 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.where((a1p == 0) & (b1 == 0), 0.0, np.degrees(np.arctan2(b1, a1p)) % 360)
    h2p = np.where((a2p == 0) & (b2 == 0), 0.0, np.degrees(np.arctan2(b2, a2p)) % 360)
    chroma = C1p * C2p
    dL, dC = L2 - L1, C2p - C1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where(chroma == 0, 0.0, dh)
    dH = 2 * np.sqrt(chroma) * np.sin(np.radians(dh) / 2)
    Lb, Cbp, hs = (L1 + L2) / 2, (C1p + C2p) / 2, h1p + h2p
    hb = np.where(np.abs(h1p - h2p) > 180, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2), hs / 2)
    hb = np.where(chroma == 0, hs, hb)
    T = (1 - 0.17 * np.cos(np.radians(hb - 30)) + 0.24 * np.cos(np.radians(2 * hb))
         + 0.32 * np.cos(np.radians(3 * hb + 6)) - 0.20 * np.cos(np.radians(4 * hb - 63)))
    dtheta = 30 * np.exp(-(((hb - 275) / 25) ** 2))
    RC = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25.0 ** 7))
    SL = 1 + 0.015 * (Lb - 50) ** 2 / np.sqrt(20 + (Lb - 50) ** 2)
    SC, SH = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    RT = -np.sin(np.radians(2 * dtheta)) * RC
    return np.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))


def to_render_light(photo, render):
    """The photograph's cells in the render's light: 07_compare's fit lp = a + b lm of the cells' log2 luminance,
    inverted per channel (p -> 2^((log2 p - a) / b)). (N, 3) cells in; returns (cells, a, b)."""
    photo, render = np.asarray(photo, np.float64), np.asarray(render, np.float64)
    lp = np.log2(np.maximum(photo @ LUMINANCE, 1e-5))
    lm = np.log2(np.maximum(render @ LUMINANCE, 1e-5))
    b, a = np.polyfit(lm, lp, 1)
    return np.exp2((np.log2(np.maximum(photo, 1e-5)) - a) / b), float(a), float(b)


def fit_gains(photo, rest, basis, ridge=RIDGE):
    """Per channel: min sum_cells ((photo - rest - sum_g G_g B_g) / photo)^2 + ridge' |G - 1|^2, clamped to GAIN_RANGE.
    The residual is relative; ridge' = ridge x the normal matrix's mean diagonal, so the pull toward 1 has no units.
    (N, 3) cells in; returns {group: [r, g, b]}."""
    photo, rest = np.asarray(photo, np.float64), np.asarray(rest, np.float64)
    solved = np.zeros((len(LAMP_GROUPS), 3))
    for ch in range(3):
        weight = 1.0 / np.maximum(photo[:, ch], 1e-6)
        A = np.stack([np.asarray(basis[g], np.float64)[:, ch] for g in LAMP_GROUPS], 1) * weight[:, None]
        b = (photo[:, ch] - rest[:, ch]) * weight
        normal = A.T @ A
        strength = ridge * float(np.trace(normal)) / len(LAMP_GROUPS)
        x = np.linalg.solve(normal + strength * np.eye(len(LAMP_GROUPS)), A.T @ b + strength)
        solved[:, ch] = np.clip(x, *GAIN_RANGE)
    return {g: [float(v) for v in solved[i]] for i, g in enumerate(LAMP_GROUPS)}


def normalise_gains(gains, basis):
    """Per channel, scale every group's gain so that channel's total lamp light is unchanged (sum_g L_gc G_gc =
    sum_g L_gc over the cells): the camera's exposure and white balance cancel, and the gains only move light and
    colour between the groups. Clamped to GAIN_RANGE."""
    light = np.array([np.asarray(basis[g], np.float64).sum(0) for g in LAMP_GROUPS])
    G = np.array([gains[g] for g in LAMP_GROUPS], np.float64)
    scale = light.sum(0) / np.maximum((light * G).sum(0), 1e-30)
    out = np.clip(G * scale, *GAIN_RANGE)
    return {g: [float(v) for v in out[i]] for i, g in enumerate(LAMP_GROUPS)}


def colour_accuracy(photo, render):
    """CIEDE2000 between cells after the camera's white balance is removed (the per-channel gain that matches the
    photograph's median cell to the render's) and both are scaled so the render's 95th-percentile cell luminance is
    white (L* 100). (N, 3) cells, the photograph already in the render's light; returns the median and 90th percentile."""
    photo, render = np.asarray(photo, np.float64), np.asarray(render, np.float64)
    balanced = photo * (np.median(render, 0) / np.maximum(np.median(photo, 0), 1e-12))
    white = max(float(np.percentile(render @ LUMINANCE, 95)), 1e-12)
    de = ciede2000(linear_to_lab(balanced / white), linear_to_lab(render / white))
    return {"median": float(np.median(de)), "p90": float(np.percentile(de, 90))}


def dark_groups(basis) -> list[str]:
    """The lamp groups whose light in the renders is below GROUP_MIN_SHARE of all the lamps' light."""
    light = {g: float((np.asarray(basis[g], np.float64) @ LUMINANCE).sum()) for g in LAMP_GROUPS}
    total = sum(light.values())
    return [g for g in LAMP_GROUPS if total <= 0 or light[g] < GROUP_MIN_SHARE * total]


def additivity(cells) -> float:
    """The median relative difference of cell luminance between the rest plus every group alone and all lamps lit."""
    total = cells["rest"] + sum(cells[g] for g in LAMP_GROUPS)
    every = np.maximum(cells["all"] @ LUMINANCE, 1e-12)
    return float(np.median(np.abs(total @ LUMINANCE - every) / every))


def accepted(stations: dict) -> bool:
    """Kept only if, at every station, the basis adds up and the calibrated night is no worse than the hall as
    captured, than the uncalibrated night and than R1b's threshold by r, and no worse than either by median CIEDE2000."""
    return bool(stations) and all(
        s["additivity"] <= ADDITIVITY
        and s["after"]["r"] >= max(s["captured"]["r"], s["before"]["r"], s["threshold"])
        and s["after"]["median"] <= min(s["captured"]["median"], s["before"]["median"])
        for s in stations.values())


def station_cells(cmp, view: str, exposure: float) -> dict:
    """A station's valid cells, (N, 3) each: the photograph (as decoded), the captured light, all lamps, the rest, and
    each lamp group's own light (its solo render less the rest, which every render holds), in linear light over the
    held exposure. Valid: 07_compare's mask for the photograph and every render (no view out, no fixture, nothing
    clipped or black), no held render past the display's knee, and over 70% of the cell valid."""
    photo_lin, photo_s = cmp.photo(view)
    captured_lin, captured_s = cmp.render(CAPTURED_JOB, view)
    renders = {name: cmp.render(f"{JOB_PREFIX}{name}", view) for name in ("all",) + BASIS}
    ok_px = cmp.valid_mask(view, photo_s, captured_s, *(s for _, s in renders.values()))
    for _, srgb in renders.values():
        ok_px &= srgb.max(-1) < KNEE_SRGB
    photo_cells, fraction = cmp.cells(photo_lin, ok_px)
    ok = fraction > CELL_FRACTION
    out = {"photo": photo_cells[ok], "captured": cmp.cells(captured_lin, ok_px)[0][ok]}
    for name, (lin, _) in renders.items():
        out[name] = cmp.cells(lin / exposure, ok_px)[0][ok]
    for group in LAMP_GROUPS:
        out[group] = out[group] - out["rest"]
    return out


def measure(cmp, photo, model) -> dict:
    """07_compare's r of the cells and the colour accuracy, the photograph brought into this render's light."""
    return {"r": cmp.metrics(model, photo, np.ones(len(model), bool))["r"], **colour_accuracy(to_render_light(photo, model)[0], model)}


def run(cfg, _args) -> int:
    """<work>/night-calibration.json when accepted (removed otherwise, so the cinematic package stays uncalibrated),
    and <evidence>/r1d/night-calibration.json always. Exit 1 when the gains are refused."""
    browsercheck.prepare(cfg)
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    with open(os.path.join(evidence, HELD_FILE), encoding="utf-8") as f:
        exposure = float(json.load(f)["exposure"])
    # The proof's comparison, importable once `python -m relight` has made the proof importable (R1b Task 18).
    cmp = importlib.import_module("07_compare")
    cells = {view: station_cells(cmp, view, exposure) for view in browsercheck.NIGHT_STATIONS}
    photos = [to_render_light(c["photo"], c["all"])[0] for c in cells.values()]
    basis = {g: np.concatenate([c[g] for c in cells.values()]) for g in LAMP_GROUPS}
    fitted = fit_gains(np.concatenate(photos), np.concatenate([c["rest"] for c in cells.values()]), basis)
    gains = normalise_gains(fitted, basis)
    dark = dark_groups(basis)
    stations = {}
    for view, c in cells.items():
        after = c["rest"] + sum(np.asarray(gains[g]) * c[g] for g in LAMP_GROUPS)
        stations[view] = {"threshold": browsercheck.NIGHT_STATIONS[view], "cells": int(len(c["photo"])), "additivity": additivity(c),
                          "captured": measure(cmp, c["photo"], c["captured"]), "before": measure(cmp, c["photo"], c["all"]),
                          "after": measure(cmp, c["photo"], after)}
    ok = accepted(stations) and not dark
    record = {"gains": gains, "evidence": {"fitted": fitted, "accepted": ok, "dark": dark, "heldExposure": exposure, "stations": stations}}
    with open(os.path.join(evidence, "night-calibration.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=1, sort_keys=True, allow_nan=False)
    work_file = os.path.join(cfg.paths["work"], "night-calibration.json")
    if ok:
        with open(work_file, "w", encoding="utf-8", newline="\n") as f:
            json.dump(record, f, indent=1, sort_keys=True, allow_nan=False)
    elif os.path.exists(work_file):
        os.remove(work_file)
    print("night-calibration", "accepted" if ok else "REFUSED", "dark groups", dark, json.dumps(stations, sort_keys=True), flush=True)
    return 0 if ok else 1
```

In `tools/relight/relight/__main__.py`, directly after R1b's `from . import browsercheck  # noqa: E402 …` line add `from . import nightcal  # noqa: E402  (R1d: the night calibration and the colour-accuracy measure)`, and directly after R1b's `COMMANDS["browser-check"] = browsercheck.run` add `COMMANDS["night-calibration"] = nightcal.run`.

- [ ] **Step 4: The director's calibration controls** — in `packages/web/src/lib/relight/light-director.ts`, directly after `  private keepMoon = false;` add:

```ts
  /** DEV (Task 21): a display the eye is held at, and one lamp group lit alone ("none": every lamp off). */
  private heldEye: EyeTarget | null = null;
  private solo: LampGroup | "none" | null = null;
```

directly after the `forceBothBodies` method add:

```ts
  /** DEV (Task 21): hold the display at a known eye (night vision only if given); null releases it. */
  holdEye(display: EyeTarget | null): void {
    this.heldEye = display;
    this.wake();
  }

  /** DEV (Task 21): light one lamp group alone at full drive ("none": every lamp off); null restores the switch. */
  soloLamps(group: LampGroup | "none" | null): void {
    this.solo = group;
    this.wake();
  }

  /** The composer's latest measurement (Task 13), held until the next. */
  latestMeasurement(): FrameMeasurement | null {
    return this.measurement;
  }

  /** The luminance calibration in use: the cinematic package's, or the capture's. */
  get calibration(): LuminanceCalibration {
    return this.cinematic?.calibration ?? CAPTURE_CALIBRATION;
  }
```

directly after the function `currentDisplayedLight` add:

```ts
/** The director that last displayed a light, the session's; null once it stops (Task 21's DEV controls). */
export function currentDirector(): LightDirector | null {
  return publisher;
}
```

and in `tick`, replace `    const lamps = weather === null ? ALL_LAMPS_ON : lampTargets(state.lamps, sunElevation);` with:

```ts
    const switched = weather === null ? ALL_LAMPS_ON : lampTargets(state.lamps, sunElevation);
    const solo = this.solo;
    const lamps: LampDrives = solo === null ? switched : {
      cove: solo === "cove" ? 1 : 0, ch_end: solo === "ch_end" ? 1 : 0, ch_centre: solo === "ch_centre" ? 1 : 0, dome: solo === "dome" ? 1 : 0,
    };
```

and `    const targets = { instant: goal, lamps, eye: this.eyeTarget(weather === null, state, following) };` with `    const targets = { instant: goal, lamps, eye: this.heldEye ?? this.eyeTarget(weather === null, state, following) };`.

- [ ] **Step 5: The calibration controls on `window.__relight`** — in `packages/web/src/lib/relight/relight-debug.ts`, add `defaultChoice` to its import from `../light-setting.js`, and add:

```ts
import { adaptationLuminance, lightChroma, scotopicAmount, type FrameMeasurement } from "./eye.js";
import { currentDirector, type LightDirector } from "./light-director.js";
import type { EyeTarget } from "./light-motion.js";
import type { LampGroup } from "./relight-kernel.js";
```

Directly before `export interface RelightDebug {` add:

```ts
/** R1d (Task 21): the cinematic light's calibration controls, on `window.__relight.cinematic`. */
export interface CinematicControls {
  /** Hold the display at a known eye (night vision only if given); null releases it. */
  holdEye(display: EyeTarget | null): void;
  /** Light one lamp group alone at full drive ("none": every lamp off); null restores the switch. */
  soloLamps(group: LampGroup | "none" | null): void;
  /** True when the director has nothing left to move. */
  still(): boolean;
  /** The composer's latest measurement of the frame's light (Task 13); null before the first. */
  measurement(): FrameMeasurement | null;
  /** That measurement's adaptation luminance (cd/m², through the calibration in use) and its night-vision amount. */
  adaptation(): { readonly luminance: number; readonly scotopic: number } | null;
  /** The displayed light's chroma (log2 r/g, b/g), as the eye reads it. */
  lightChroma(): readonly [number, number] | null;
  /** A preset's calibrated display (R1b's applicationForChoice at the preset's own hour). */
  presetDisplay(preset: LightPresetId): DisplayParams;
}

export function cinematicControls(director: LightDirector | null, frame: RelightFrame): CinematicControls | null {
  if (director === null) return null;
  return {
    holdEye: (display) => { director.holdEye(display); },
    soloLamps: (group) => { director.soloLamps(group); },
    still: () => !director.moving,
    measurement: () => director.latestMeasurement(),
    adaptation: () => {
      const measured = director.latestMeasurement();
      if (measured === null) return null;
      const luminance = adaptationLuminance(measured.logLuminance, director.calibration);
      return { luminance, scotopic: scotopicAmount(luminance) };
    },
    lightChroma: () => {
      const shown = director.current();
      return shown === null ? null : lightChroma(shown.light.colour);
    },
    presetDisplay: (preset) => applicationForChoice(frame.inputs, defaultChoice(preset), (light) => frame.meanLight(light)).display,
  };
}
```

add to `interface RelightDebug`, after `gpuTime(runs: number): Promise<GpuTimeCheck>;`:

```ts
  /** R1d (Task 21): the cinematic light's calibration controls; null without the director (`?cinematic=off`). */
  readonly cinematic: CinematicControls | null;
```

and in `installRelightDebug`, in the object assigned to `const debug: RelightDebug`, directly after its `select,` member add:

```ts
    get cinematic() {
      return cinematicControls(currentDirector(), frame);
    },
```

- [ ] **Step 6: The calibration driver** — create `packages/web/scripts/cinematic-calibrate.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// R1d's night calibration renders and the eye's anchors (T-639, plan Task 21). Drives the REAL walk route on the
// REAL GPU (headed Chromium), holding the build PC's GPU lock throughout. At the two night stations, with the eye held
// at the night's exposure, neutral white balance and no night vision, it renders every lamp lit, none (the rest) and
// each lamp group alone at full drive, then the captured light, at 2x into <root>/renders/<job>/<view>@2x.png (read
// by `python -m relight night-calibration` through the proof's 07_compare). Then, at the walk's own view, it measures
// the frame as the eye does at each anchor's calibrated display, and checks the luminance gate.
//
//   node scripts/cinematic-calibrate.mjs        (the development server on 5192, as for relight-verify.mjs)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.CINEMATIC_BASE_URL ?? "http://127.0.0.1:5192";
const ROOT = process.env.CINEMATIC_ROOT ?? "D:/claude/relight/grand-hall";
const VIEWS = process.env.CINEMATIC_VIEWS ?? "D:/claude/real-hall/renovation/relight/work/views.json";
const LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock";
const OWNER = "cinematic-calibrate (T-639 R1d)";
const STATIONS = ["mp43_night_end", "mp45_night_windows"];
/** Each basis render and the lamps it lights (null: the switch, every lamp on at night). */
const SOLO = { all: null, rest: "none", cove: "cove", ch_end: "ch_end", ch_centre: "ch_centre", dome: "dome" };
const ANCHORS = [["day", "sunny"], ["lamps", "night"], ["moon", "moonlit"]];
const WIDTH = 1920, HEIGHT = 1080, SCALE = 2;
const LOAD_TIMEOUT_MS = 240_000;
const SETTLE_TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function takeLock() {
  for (let waited = 0; ; waited += 30_000) {
    try {
      const handle = await open(LOCK, "wx");
      await handle.writeFile(JSON.stringify({ owner: OWNER, since: new Date().toISOString() }));
      await handle.close();
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = await readFile(LOCK, "utf8").catch(() => "?");
      if (waited >= 3_600_000) throw new Error(`The GPU lock is still held after an hour: ${holder}`);
      console.log(`waiting for the GPU lock: ${holder}`);
      await sleep(30_000);
    }
  }
}

async function releaseLock() {
  const holder = await readFile(LOCK, "utf8").catch(() => "");
  if (holder.includes(OWNER)) await rm(LOCK, { force: true });
}

async function openWalk(browser) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/room/grand-hall?bare=1&light=night`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => window.__roomWalk?.complete === true && window.__relight?.state().relit === true && window.__relight.cinematic !== null,
    undefined, { timeout: LOAD_TIMEOUT_MS },
  );
  return page;
}

/** The director still, then one measurement of the frame taken after it settled. */
async function settle(page) {
  await page.waitForFunction(() => window.__relight?.cinematic?.still() === true, undefined, { timeout: SETTLE_TIMEOUT_MS });
  const since = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => (window.__relight?.cinematic?.measurement()?.at ?? -1) > t, since, { timeout: SETTLE_TIMEOUT_MS });
}

async function capture(page, view, job) {
  const folder = join(ROOT, "renders", job);
  await mkdir(folder, { recursive: true });
  const dataUrl = await page.evaluate(async (request) => (await window.__roomViewCapture(request)).dataUrl,
    { position: view.pos, target: view.tgt, fov: view.fov, width: WIDTH * SCALE, height: HEIGHT * SCALE });
  await writeFile(join(folder, `${view.name}@2x.png`), Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
}

async function main() {
  const views = JSON.parse(await readFile(VIEWS, "utf8"));
  const stations = STATIONS.map((name) => {
    const view = views.find((candidate) => candidate.name === name);
    if (view === undefined) throw new Error(`views.json has no ${name}`);
    return view;
  });
  // A rerun never leaves an earlier run's images (07_compare caches <view>.png beside each @2x).
  for (const job of [...Object.keys(SOLO).map((name) => `R1d_night_${name}`), "R1d_captured"]) {
    await rm(join(ROOT, "renders", job), { recursive: true, force: true });
  }
  await takeLock();
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"],
  });
  try {
    const page = await openWalk(browser);
    await page.evaluate(async () => { await window.__relight.select("night"); });
    const night = await page.evaluate(() => window.__relight.cinematic.presetDisplay("night"));
    const held = { exposure: night.exposure, whiteBalance: [1, 1, 1], scotopic: 0 };
    await page.evaluate((display) => { window.__relight.cinematic.holdEye(display); }, held);
    for (const [name, group] of Object.entries(SOLO)) {
      await page.evaluate((solo) => { window.__relight.cinematic.soloLamps(solo); }, group);
      await settle(page);
      for (const view of stations) await capture(page, view, `R1d_night_${name}`);
    }
    await page.evaluate(() => { window.__relight.cinematic.soloLamps(null); window.__relight.cinematic.holdEye(null); });
    await page.evaluate(async () => { await window.__relight.select("captured"); });
    await settle(page);
    for (const view of stations) await capture(page, view, "R1d_captured");
    await mkdir(join(ROOT, "evidence", "r1d"), { recursive: true });
    await writeFile(join(ROOT, "evidence", "r1d", "night-basis-held.json"), JSON.stringify({ exposure: held.exposure }, null, 1));

    // The eye's anchors: each preset at its own hour, the eye held at its calibrated display without night vision.
    const anchors = {}, adaptation = {};
    for (const [anchor, preset] of ANCHORS) {
      await page.evaluate(async (name) => { await window.__relight.select(name); }, preset);
      const display = await page.evaluate((name) => window.__relight.cinematic.presetDisplay(name), preset);
      await page.evaluate((shown) => { window.__relight.cinematic.holdEye({ exposure: shown.exposure, whiteBalance: shown.whiteBalance, scotopic: 0 }); }, display);
      await settle(page);
      const reading = await page.evaluate(() => ({
        measured: window.__relight.cinematic.measurement(), adapted: window.__relight.cinematic.adaptation(), chroma: window.__relight.cinematic.lightChroma(),
      }));
      if (reading.measured === null || reading.adapted === null || reading.chroma === null) throw new Error(`No measurement for the ${anchor} anchor.`);
      anchors[anchor] = { exposure: display.exposure, whiteBalance: display.whiteBalance, logLuminance: reading.measured.logLuminance, logChroma: reading.chroma };
      adaptation[anchor] = reading.adapted;
    }
    await page.evaluate(() => { window.__relight.cinematic.holdEye(null); });
    const gate = {
      lampLitNightPhotopic: adaptation.lamps.scotopic === 0,
      moonlitNightDimmer: adaptation.moon.luminance < adaptation.lamps.luminance && adaptation.moon.scotopic > 0,
    };
    const record = { anchors, adaptation, gate };
    await writeFile(join(ROOT, "evidence", "r1d", "eye-anchors.json"), JSON.stringify(record, null, 1));
    // Only anchors that pass the gate reach the package (Task 3 reads <work>/eye-anchors.json).
    if (gate.lampLitNightPhotopic && gate.moonlitNightDimmer) {
      await writeFile(join(ROOT, "work", "eye-anchors.json"), JSON.stringify(record, null, 1));
    } else {
      await rm(join(ROOT, "work", "eye-anchors.json"), { force: true });
      process.exitCode = 1;
    }
    console.log("anchors", JSON.stringify(anchors), "adaptation", JSON.stringify(adaptation), "gate", JSON.stringify(gate));
  } finally {
    await browser.close();
    await releaseLock();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 7: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_nightcal -v`
Expected: PASS, 10 tests.

Run, one per command: `src/lib/relight/__tests__/light-director.test.ts` (Expected: PASS, 10 tests), `src/lib/relight/__tests__/relight-debug.test.ts` (Expected: PASS, the Task 0 count plus 1).

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/light-director.ts src/lib/relight/relight-debug.ts scripts/cinematic-calibrate.mjs`
Expected: no problems.

- [ ] **Step 8: Calibrate** (the development server running as R1b's Task 18 runs it, at `http://127.0.0.1:5192`, with Tasks 1–20 built and the bake's house-light refit applied if it exists; headed Chromium on the shared GPU: the driver takes the lock)

```bash
cd D:/claude/real-hall/repo/packages/web && node scripts/cinematic-calibrate.mjs
cd D:/claude/real-hall/repo/tools/relight && V=D:/claude/relight/grand-hall/verify/r1d E=D:/claude/relight/grand-hall/evidence/r1d \
 && C:/Python313/python.exe -m relight night-calibration --config config/grand-hall.json; cp $E/night-calibration.json $V/night-calibration-run1.json \
 && C:/Python313/python.exe -m relight night-calibration --config config/grand-hall.json; cp $E/night-calibration.json $V/night-calibration-run2.json \
 && C:/Python313/python.exe -c "import json;a,b=(json.load(open(f'D:/claude/relight/grand-hall/verify/r1d/night-calibration-run{i}.json')) for i in (1,2));print('identical' if a==b else 'DIFFER')"
```

Expected: the driver prints the three anchors, their adaptation (the lamp-lit night at 5 cd/m² or more, with no night vision; the moonlit night dimmer, with some) and a passing gate; each calibration run prints `accepted`, no dark groups and both stations' r and ΔE00 (captured, before, after), then `identical`. `REFUSED` (exit 1) keeps the gains at 1: report both stations' numbers, the additivity and any dark group to the controller (a dark `ch_centre` means the bake's refit is still needed: the amendments file's "Interfaces from the bake", item 2). A failed eye gate (exit 1) leaves the package without anchors: report the measured cd/m². `DIFFER`: run a third time and keep the majority (Global Constraints).

- [ ] **Step 9: Rebuild the cinematic package with the calibration** (Task 3's Step 7, twice, compared)

```bash
cd D:/claude/real-hall/repo/tools/relight && P=D:/claude/splats/trades-hall/grand-hall/cinematic/v1 V=D:/claude/relight/grand-hall/verify/r1d \
 && C:/Python313/python.exe -m relight cinematic --config config/grand-hall.json && rm -rf $V/cinematic-cal-run1 && cp -r $P $V/cinematic-cal-run1 \
 && C:/Python313/python.exe -m relight cinematic --config config/grand-hall.json && rm -rf $V/cinematic-cal-run2 && cp -r $P $V/cinematic-cal-run2 \
 && diff -r $V/cinematic-cal-run1 $V/cinematic-cal-run2 && echo identical
```

Expected: both runs print `night calibrated True` when Step 8 accepted the gains (`False` after a refusal, which is reported, not hidden), then `identical`; the manifest's `eye` holds the three anchors when the eye gate passed.

- [ ] **Step 10: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/nightcal.py tools/relight/tests/test_nightcal.py tools/relight/relight/__main__.py packages/web/scripts/cinematic-calibrate.mjs packages/web/src/lib/relight/light-director.ts packages/web/src/lib/relight/relight-debug.ts packages/web/src/lib/relight/__tests__/light-director.test.ts packages/web/src/lib/relight/__tests__/relight-debug.test.ts && git diff --cached --stat && git commit -m "feat(relight): the night calibration against the night photographs, CIEDE2000, and the eye's measured anchors (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: DEV instruments for the cinematic light

**Files:**
- Create: `packages/web/src/lib/relight/cinematic-parts.ts`
- Modify: `packages/web/src/lib/relight/sun-shadow.ts` (`cpuTaps`), `packages/web/src/lib/relight/cinematic-composer.ts` (`glare` readable), `packages/web/src/lib/relight/relight-debug.ts` (the instruments; the word check's CPU twin with the cinematic terms), `packages/web/src/components/scene/RelightCinematic.tsx` (keeps the parts current)
- Test: `packages/web/src/lib/relight/__tests__/sun-shadow.test.ts`, `packages/web/src/lib/relight/__tests__/relight-debug.test.ts` (modify)

**Interfaces:**
- Consumes: Task 21's `CinematicControls`, `cinematicControls`, `currentDirector`; Task 10 (`SkyShadows`: `hook`, `cpu`, `lightViewFor`, `occludedFrom`, `SHADOW_PCF_SPACING`, `SHADOW_BIAS`, the private `drawn` and `box`), Task 13 (`CinematicComposer`, `GlareNode`), Task 11 (`CrispBulbs`), Task 8 (`CinematicData`), Task 7 (`RelightFrame.kernelCinematic`, `passStride`), Task 9 (`LightDirector.forceBothBodies`, `setStride`, `moving`, `lightMoving`, `current`); R1b's `relight-debug.ts` (`sample`, `wordTally`, `sunRaySensitive`, `readDisplay`'s readback pattern), `useLightSettingStore` (`selectPreset`, `setMinutes`); R1c's `RelightFrame.visibility` and `relightSplat`'s visibility argument (A2).
- Produces (`cinematic-parts.ts`): `interface CinematicParts { readonly data: CinematicData | null; readonly shadows: SkyShadows | null; readonly composer: CinematicComposer | null; readonly bulbs: CrispBulbs | null }`; `updateCinematicParts(change: Partial<CinematicParts>): void`; `currentCinematicParts(): CinematicParts`.
- Produces (`sun-shadow.ts`): `SkyShadows.cpuTaps(position: Vec3, body: SkyBodyName): number` (the 16 taps' lit share on the CPU).
- Produces (`cinematic-composer.ts`): `CinematicComposer.glare` (readonly, the glow function in use).
- Produces (`relight-debug.ts`): `interface CinematicState { packaged; crispLamps; crispChandeliers; dimming; moving; lightMoving; stride; bodies: { sun; moon }; sheen }`; `interface ShadowCheck { body; points; decided; disagreements }`; `interface BloomEnergyCheck { emitted; glowed; ratio }`; `GLARE_TEST_SIZE = 256`, `GLARE_TEST_BLOCK = 8`; `shadowCheckPoints(box, count): Vec3[]`; `tallyShadow(body, gpu, cpu): ShadowCheck`; `CinematicControls` gains `state(): CinematicState`, `shadowCheck(points: number): Promise<readonly ShadowCheck[]>`, `bloomEnergy(): Promise<BloomEnergyCheck | null>`, `forceBothBodies(on: boolean): void`, `setStride(stride: number): void`, `scrubTo(minutes: number): void`; `cinematicControls(director, frame, renderer?)`.

Task 23 judges the cinematic light by these instruments, so each one compares the GPU with an independent twin rather than with itself:
- **The words.** R1b's `sample` check now computes the CPU twin with the frame's cinematic terms (`frame.kernelCinematic`: the glow hiding and the interior shadow), so the GPU's words are judged against the light actually shown. The interior shadow's twin casts a ray over every occluder triangle (some 10⁵), so it is cast only for a splat that differs without it; a splat that still differs and lies in an interior shadow's penumbra (its 16 CPU taps disagree, the edge the GPU's taps soften) is excused like R1b's window-rounding cases. R1b's `fixture` check compares with R1a's vectors, which have no cinematic terms, so Task 23 runs it with `?cinematic=off`.
- **The shadows.** At a grid of points over the hall (the floor, 5 cm up, and eye height), the GPU's 16-tap shadow is read back through a compute pass running the very hook every surface uses, and compared with the CPU twin's single ray where the GPU's taps all agree (0 or 1; Task 10).
- **The glow.** The energy-conserving design glow is tested on the GPU with a known emission: an 8 × 8 block of 1 at the centre of a 256 × 256 half-float texture, run through the composer's own glare function into a float target and summed: the sum must equal the block's (the pyramid's weights sum to 3 at strength 1/3).
- **The light.** The state (the package, the crisp lamps and chandeliers, each group's dimming, motion, the stride, which bodies count, the sheen weight), the both-bodies switch, the stride and a scrub that sets the store's hour without waiting, for Task 23's frame budget.

The session's parts (the package, the shadow maps, the composer, the lamps) reach the instruments through a registry of types only (`cinematic-parts.ts`), kept current by `RelightCinematic`; nothing in it runs in production beyond holding four references.

Verified (7 October): R1b plan lines 7963–7980 (`relight-debug.ts`'s imports: `Vector3`, `type Matrix4`; `StorageBufferAttribute`, `type WebGPURenderer`; `Fn`, `float`, `storage`, `uniform`, `vec3`; `useLightSettingStore`; `relightSplat`, `type KernelFrame`, `type Rgb`; `multiplierCodeDistance`, `packMultiplierWord`), 8130–8168 (`wordTally`'s rule; `sunRaySensitive`; `readDisplay`: a `StorageBufferAttribute` written by a compute pass and read with `renderer.getArrayBufferAsync`), 8215–8228 (`sample`: the three lines this task replaces), 8209–8214 (`const debug: RelightDebug = { state, select, … }`); this plan's Task 10 (`SkyShadows`: `private readonly drawn`, `private readonly box`, `cpu`, `hook`; `lightViewFor` builds the camera with `lookAt`, so its world matrix's first two columns are the map's right and up; the taps at `(i − 1.5, j − 1.5) × SHADOW_PCF_SPACING`, j down the map), Task 13 (`private readonly glare: GlareNode`; `designGlare`; the emission target is `HalfFloatType`), Task 21 (`cinematicControls(director, frame)`, the `get cinematic()` member); three 0.186 `src/renderers/common/Renderer.js:3225` (`readRenderTargetPixelsAsync(renderTarget, x, y, width, height, textureIndex = 0, faceIndex = 0)`) and `:2097` (`getArrayBufferAsync`), `src/Three.Core.js:160` (`DataUtils`), `src/extras/DataUtils.js:150` (`toHalfFloat`), `src/textures/DataTexture.js`, `src/core/RenderTarget.js:54`, `QuadMesh` (as Task 13 uses it), `src/math/Matrix4.js:239` (`extractBasis(xAxis, yAxis, zAxis)`).

- [ ] **Step 1: Write the failing tests** — append to `packages/web/src/lib/relight/__tests__/sun-shadow.test.ts`, inside its `describe`:

```ts
  it("emulates the 16 taps on the CPU: lit, shadowed, and half at an occluder's edge (R1d Task 22)", () => {
    const shadows = new SkyShadows(PLATE, BOX);
    shadows.update(fakeRenderer([]), setting(UP));
    expect([
      shadows.cpuTaps([9, -5, 1], "sun"), shadows.cpuTaps([12, -5, 1], "sun"),
      shadows.cpuTaps([10, -5, 1], "sun"), shadows.cpuTaps([9, -5, 1], "moon"),
    ]).toEqual([0, 1, 0.5, 1]);
    shadows.dispose();
  });
```

In `packages/web/src/lib/relight/__tests__/relight-debug.test.ts`, add `shadowCheckPoints` and `tallyShadow` to its import from `../relight-debug.js`, add `import { updateCinematicParts } from "../cinematic-parts.js";` and `import { FIXTURE_CENTRES, cinematicData } from "./cinematic-fixture.js";`, and append inside its `describe`:

```ts
  it("lays the shadow check's points over the hall at the floor and at eye height (R1d)", () => {
    const points = shadowCheckPoints([[0, -10, 0], [18, 0, 7]], 8);
    expect(points).toHaveLength(8);
    expect(points[0]).toEqual([4.5, -7.5, 0.05]);
    expect(points[7]).toEqual([13.5, -2.5, 1.6]);
  });

  it("compares the shadows only where the GPU's taps all agree (R1d)", () => {
    expect(tallyShadow("sun", Float32Array.from([0, 1, 0.5, 1]), [0, 0, 1, 1])).toEqual({ body: "sun", points: 4, decided: 3, disagreements: 1 });
  });

  it("reports the cinematic light's state from the session's parts (R1d)", async () => {
    const pkg = buildTestPackage();
    const frame = new RelightFrame(await loadRelightModelData(pkg.fetch, pkg.manifestUrl));
    useLightSettingStore.getState().selectPreset("captured");
    const director = new LightDirector({
      frame, invalidate: () => undefined, now: () => 0, clock: () => Date.UTC(2026, 4, 31, 12, 0), reducedMotion: () => false,
      requestFrame: () => 0, cancelFrame: () => undefined, setTimer: () => 0, clearTimer: () => undefined,
    });
    director.start();
    const data = cinematicData({
      bulbs: [{ id: "c2_b00", group: "ch_centre", chandelier: 2, position: [8.9, -5, 5.5], intensity: 0.02 }],
      glow: FIXTURE_CENTRES.map((centre, id) => ({ centre, crisp: id === 2 })),
    });
    updateCinematicParts({ data });
    const state = cinematicControls(director, frame)?.state();
    expect(state).toMatchObject({ packaged: true, crispLamps: 1, crispChandeliers: [2], stride: 1, bodies: { sun: false, moon: false }, sheen: 0 });
    expect(state?.dimming).toEqual({ cove: "warm", ch_end: "warm", ch_centre: "warm", dome: "warm" });
    updateCinematicParts({ data: null });
    expect(cinematicControls(director, frame)?.state()).toMatchObject({ packaged: false, crispLamps: 0, crispChandeliers: [], dimming: null });
    director.stop();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run, one per command: `src/lib/relight/__tests__/sun-shadow.test.ts`, `src/lib/relight/__tests__/relight-debug.test.ts`.
Expected: each FAILS on its new tests (`cpuTaps`, `shadowCheckPoints`, `tallyShadow`, `cinematic-parts.js` and `state` do not exist).

- [ ] **Step 3: The parts registry** — create `packages/web/src/lib/relight/cinematic-parts.ts`:

```ts
import type { CrispBulbs } from "./bulbs.js";
import type { CinematicComposer } from "./cinematic-composer.js";
import type { CinematicData } from "./cinematic-package.js";
import type { SkyShadows } from "./sun-shadow.js";

/**
 * The session's cinematic parts, for the DEV instruments (T-639 R1d Task 22). RelightCinematic keeps it current;
 * it holds references only, so production pays for four fields.
 */
export interface CinematicParts {
  readonly data: CinematicData | null;
  readonly shadows: SkyShadows | null;
  readonly composer: CinematicComposer | null;
  readonly bulbs: CrispBulbs | null;
}

let parts: CinematicParts = { data: null, shadows: null, composer: null, bulbs: null };

export function updateCinematicParts(change: Partial<CinematicParts>): void {
  parts = { ...parts, ...change };
}

export function currentCinematicParts(): CinematicParts {
  return parts;
}
```

In `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { updateCinematicParts } from "../../lib/relight/cinematic-parts.js";` and, directly before its `return`, add:

```tsx
  // The DEV instruments (Task 22) read the session's parts; the registry holds references only.
  useEffect(() => {
    updateCinematicParts({ data, shadows, composer, bulbs });
    return () => { updateCinematicParts({ data: null, shadows: null, composer: null, bulbs: null }); };
  }, [data, shadows, composer, bulbs]);
```

- [ ] **Step 4: The CPU taps and the readable glare** — in `packages/web/src/lib/relight/sun-shadow.ts`, directly after the `update` method add:

```ts
  /**
   * DEV (Task 22): the 16 taps' lit share on the CPU, each a ray toward the body from the point moved in the map's
   * plane exactly as the GPU's taps are (right along the map's x, down its rows); 1 for a body that is down.
   */
  cpuTaps(position: Vec3, body: SkyBodyName): number {
    const direction = this.drawn[body];
    if (direction === null) return 1;
    const camera = lightViewFor(direction, this.box).camera;
    const right = new Vector3(), up = new Vector3(), back = new Vector3();
    camera.matrixWorld.extractBasis(right, up, back);
    let lit = 0;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        const across = (i - 1.5) * SHADOW_PCF_SPACING, down = (j - 1.5) * SHADOW_PCF_SPACING;
        const origin: Vec3 = [
          position[0] + right.x * across - up.x * down,
          position[1] + right.y * across - up.y * down,
          position[2] + right.z * across - up.z * down,
        ];
        if (!occludedFrom(this.triangles, origin, direction, SHADOW_BIAS)) lit += 1;
      }
    }
    return lit / 16;
  }
```

In `packages/web/src/lib/relight/cinematic-composer.ts`, replace `  private readonly glare: GlareNode;` with:

```ts
  /** The glow function in use (the design glow, or a fitted glare function; decision 6). */
  readonly glare: GlareNode;
```

- [ ] **Step 5: The instruments** — in `packages/web/src/lib/relight/relight-debug.ts`, merge into its imports: `DataTexture`, `DataUtils`, `FloatType`, `HalfFloatType`, `LinearFilter`, `RGBAFormat`, `RenderTarget` from `three`; `MeshBasicNodeMaterial` and `QuadMesh` from `three/webgpu`; `If`, `instanceIndex`, `texture`, `uint` and `vec4` from `three/tsl`; and add:

```ts
import { currentCinematicParts } from "./cinematic-parts.js";
import type { GlareNode } from "./cinematic-composer.js";
import type { LampDimming } from "./lamp-dimming.js";
import type { SkyBodyName, SkyShadows } from "./sun-shadow.js";
```

Directly before `export interface CinematicControls {` (Task 21) add:

```ts
/** R1d (Task 22): what the cinematic light is doing. */
export interface CinematicState {
  readonly packaged: boolean;
  readonly crispLamps: number;
  readonly crispChandeliers: readonly number[];
  readonly dimming: Readonly<Record<LampGroup, LampDimming>> | null;
  readonly moving: boolean;
  readonly lightMoving: boolean;
  readonly stride: number;
  readonly bodies: { readonly sun: boolean; readonly moon: boolean };
  readonly sheen: number | null;
}
export interface ShadowCheck {
  readonly body: SkyBodyName;
  readonly points: number;
  readonly decided: number;
  readonly disagreements: number;
}
export interface BloomEnergyCheck {
  readonly emitted: number;
  readonly glowed: number;
  readonly ratio: number;
}
export const GLARE_TEST_SIZE = 256;
export const GLARE_TEST_BLOCK = 8;

/** The shadow check's points: a square grid over the hall's box at the floor (5 cm up) and at eye height, about `count`. */
export function shadowCheckPoints(box: readonly [Vec3, Vec3], count: number): Vec3[] {
  const [lo, hi] = box;
  const side = Math.max(1, Math.round(Math.sqrt(count / 2)));
  const points: Vec3[] = [];
  for (const height of [lo[2] + 0.05, lo[2] + 1.6]) {
    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        points.push([lo[0] + ((column + 0.5) / side) * (hi[0] - lo[0]), lo[1] + ((row + 0.5) / side) * (hi[1] - lo[1]), height]);
      }
    }
  }
  return points;
}

/** The GPU's 16-tap shadow against the CPU twin's single ray, only where the GPU's taps all agree (0 or 1). */
export function tallyShadow(body: SkyBodyName, gpu: ArrayLike<number>, cpu: readonly number[]): ShadowCheck {
  let decided = 0, disagreements = 0;
  cpu.forEach((expected, index) => {
    const actual = gpu[index] ?? Number.NaN;
    if (actual !== 0 && actual !== 1) return;
    decided += 1;
    if (actual !== expected) disagreements += 1;
  });
  return { body, points: cpu.length, decided, disagreements };
}

/** The interior shadow every surface reads, evaluated on the GPU at given points (one compute pass, read back). */
async function readShadows(renderer: WebGPURenderer, shadows: SkyShadows, points: readonly Vec3[], body: SkyBodyName): Promise<Float32Array> {
  const input = new StorageBufferAttribute(Float32Array.from(points.flatMap((point) => [point[0], point[1], point[2], 1])), 4);
  const output = new StorageBufferAttribute(new Float32Array(points.length), 1);
  const read = storage(input, "vec4", points.length), write = storage(output, "float", points.length);
  const pass = Fn(() => {
    If(instanceIndex.lessThan(uint(points.length)), () => {
      write.element(instanceIndex).assign(shadows.hook(read.element(instanceIndex).xyz, body));
    });
  })().compute(points.length).setName("RelightShadowReadback");
  try {
    void renderer.compute(pass);
    return new Float32Array(await renderer.getArrayBufferAsync(output));
  } finally {
    pass.dispose();
    input.dispose();
    output.dispose();
  }
}

/** The glow function on a known emission: an 8 × 8 block of 1 in a half-float texture, glowed into a float target. */
async function measureGlare(renderer: WebGPURenderer, glare: GlareNode): Promise<BloomEnergyCheck> {
  const one = DataUtils.toHalfFloat(1);
  const halves = new Uint16Array(GLARE_TEST_SIZE * GLARE_TEST_SIZE * 4);
  const start = (GLARE_TEST_SIZE - GLARE_TEST_BLOCK) / 2;
  for (let y = start; y < start + GLARE_TEST_BLOCK; y += 1) {
    for (let x = start; x < start + GLARE_TEST_BLOCK; x += 1) halves.fill(one, (y * GLARE_TEST_SIZE + x) * 4, (y * GLARE_TEST_SIZE + x) * 4 + 4);
  }
  const emission = new DataTexture(halves, GLARE_TEST_SIZE, GLARE_TEST_SIZE, RGBAFormat, HalfFloatType);
  emission.minFilter = LinearFilter;
  emission.magFilter = LinearFilter;
  emission.needsUpdate = true;
  const target = new RenderTarget(GLARE_TEST_SIZE, GLARE_TEST_SIZE, { type: FloatType, depthBuffer: false });
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  material.colorNode = vec4(glare(texture(emission)).rgb, 1);
  const quad = new QuadMesh(material);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    quad.render(renderer);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, GLARE_TEST_SIZE, GLARE_TEST_SIZE);
    let glowed = 0;
    for (let index = 0; index < GLARE_TEST_SIZE * GLARE_TEST_SIZE; index += 1) glowed += Number(pixels[index * 4] ?? 0);
    const emitted = GLARE_TEST_BLOCK * GLARE_TEST_BLOCK;
    return { emitted, glowed, ratio: glowed / emitted };
  } finally {
    renderer.setRenderTarget(previous);
    material.dispose();
    target.dispose();
    emission.dispose();
  }
}

/** A point in an interior shadow's penumbra (its 16 CPU taps disagree) for a body that counts. */
function inPenumbra(kernel: KernelFrame, position: Vec3): boolean {
  const shadows = currentCinematicParts().shadows;
  if (shadows === null) return false;
  return (["sun", "moon"] as const).some((body) => {
    if ((body === "sun" ? kernel.setting.sunDir : kernel.setting.moonDir) === null) return false;
    const lit = shadows.cpuTaps(position, body);
    return lit > 0 && lit < 1;
  });
}

/**
 * The CPU twin's word with the frame's cinematic terms (the glow hiding, the interior shadow). The interior shadow
 * costs a ray over every occluder triangle, so it is cast only for a splat that differs without it.
 */
function expectedWord(frame: RelightFrame, kernel: KernelFrame, record: Uint8Array, position: Vec3, colour: Rgb, actual: number): number {
  const cinematic = frame.kernelCinematic;
  const plain = relightSplat(frame.model, kernel, record, position, colour, frame.visibility, { ...cinematic, interiorShadow: null });
  const word = packMultiplierWord(plain.m, plain.alpha);
  if (cinematic.interiorShadow === null || multiplierCodeDistance(actual, word) <= 1) return word;
  const shadowed = relightSplat(frame.model, kernel, record, position, colour, frame.visibility, cinematic);
  return packMultiplierWord(shadowed.m, shadowed.alpha);
}
```

In `interface CinematicControls` (Task 21) add, after `presetDisplay(preset: LightPresetId): DisplayParams;`:

```ts
  /** R1d (Task 22): the cinematic light's state. */
  state(): CinematicState;
  /** The interior shadows, GPU against the CPU twin, at about `points` points per body that counts. */
  shadowCheck(points: number): Promise<readonly ShadowCheck[]>;
  /** The glow function's energy on a known emission; null without the composer. */
  bloomEnergy(): Promise<BloomEnergyCheck | null>;
  /** Keep a Moon too faint to show, to measure both bodies' cost (Task 23). */
  forceBothBodies(on: boolean): void;
  /** Amortise the passes over this many frames while the light moves (decision 7). */
  setStride(stride: number): void;
  /** Set the hour the clock asks for, without waiting for the light (the frame budget's scrub). */
  scrubTo(minutes: number): void;
```

replace Task 21's `export function cinematicControls(director: LightDirector | null, frame: RelightFrame): CinematicControls | null {` with `export function cinematicControls(director: LightDirector | null, frame: RelightFrame, renderer: WebGPURenderer | null = null): CinematicControls | null {`, and in its returned object, after the `presetDisplay` member, add:

```ts
    state: () => {
      const { data } = currentCinematicParts();
      const shown = director.current();
      const groups = data?.lamps.groups;
      return {
        packaged: data !== null,
        crispLamps: data?.bulbs.length ?? 0,
        crispChandeliers: data === null ? [] : data.glow.flatMap((chandelier, id) => (chandelier.crisp ? [id] : [])),
        dimming: groups === undefined ? null : { cove: groups.cove.dimming, ch_end: groups.ch_end.dimming, ch_centre: groups.ch_centre.dimming, dome: groups.dome.dimming },
        moving: director.moving,
        lightMoving: director.lightMoving,
        stride: frame.passStride,
        bodies: { sun: (shown?.light.setting.sunDir ?? null) !== null, moon: (shown?.light.setting.moonDir ?? null) !== null },
        sheen: shown?.light.sheen ?? null,
      };
    },
    shadowCheck: async (count) => {
      const { data, shadows } = currentCinematicParts();
      const shown = director.current();
      const box = data?.probes[0]?.box;
      if (renderer === null || shadows === null || shown === null || box === undefined) throw new Error("There are no interior shadows to check.");
      const points = shadowCheckPoints(box, count);
      const checks: ShadowCheck[] = [];
      for (const body of ["sun", "moon"] as const) {
        if ((body === "sun" ? shown.light.setting.sunDir : shown.light.setting.moonDir) === null) continue;
        const gpu = await readShadows(renderer, shadows, points, body);
        checks.push(tallyShadow(body, gpu, points.map((point) => shadows.cpu(point, body))));
      }
      return checks;
    },
    bloomEnergy: async () => {
      const { composer } = currentCinematicParts();
      return renderer === null || composer === null ? null : measureGlare(renderer, composer.glare);
    },
    forceBothBodies: (on) => { director.forceBothBodies(on); },
    setStride: (stride) => { director.setStride(stride); },
    scrubTo: (minutes) => { useLightSettingStore.getState().setMinutes(minutes); },
```

In `installRelightDebug`, replace Task 21's `      return cinematicControls(currentDirector(), frame);` with `      return cinematicControls(currentDirector(), frame, renderer);`. In its `sample` member, replace the three lines (as R1c's A2 left them; keep R1c's visibility argument wherever it passes one)

```ts
        const { m, alpha } = relightSplat(frame.model, kernel, record, position, colour);
        const marched = kernel.windowSun !== null && ((record[11] ?? 0) & FLAG_SUN) !== 0;
        tally.add(words[splat] ?? 0, packMultiplierWord(m, alpha), marched, () => sunRaySensitive(frame.model, kernel, position));
```

with:

```ts
        const marched = kernel.windowSun !== null && ((record[11] ?? 0) & FLAG_SUN) !== 0;
        const actual = words[splat] ?? 0;
        // R1d: the twin with the cinematic terms; a splat in an interior shadow's penumbra is excused like a rounding case.
        tally.add(actual, expectedWord(frame, kernel, record, position, colour, actual), marched,
          () => sunRaySensitive(frame.model, kernel, position) || inPenumbra(kernel, position));
```

- [ ] **Step 6: Run the tests**

Run, one per command (`pnpm --filter @omnitwin/web exec vitest run <path>`): `src/lib/relight/__tests__/sun-shadow.test.ts` (Expected: PASS, 6 tests), `src/lib/relight/__tests__/relight-debug.test.ts` (Expected: PASS, the Task 0 count plus 4), `src/lib/relight/__tests__/cinematic-composer.test.ts` and `src/components/scene/__tests__/RelightCinematic.test.tsx` (Expected: PASS at their counts).

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/cinematic-parts.ts src/lib/relight/sun-shadow.ts src/lib/relight/cinematic-composer.ts src/lib/relight/relight-debug.ts src/components/scene/RelightCinematic.tsx`
Expected: no problems.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/cinematic-parts.ts packages/web/src/lib/relight/sun-shadow.ts packages/web/src/lib/relight/cinematic-composer.ts packages/web/src/lib/relight/relight-debug.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/lib/relight/__tests__/sun-shadow.test.ts packages/web/src/lib/relight/__tests__/relight-debug.test.ts && git diff --cached --stat && git commit -m "feat(relight): DEV instruments for the cinematic light: words with its terms, shadows, glow energy, state (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Verify in the browser

**Files:**
- Create: `tools/relight/relight/cinematiccheck.py`, `tools/relight/tests/test_cinematiccheck.py`, `packages/web/scripts/cinematic-verify.mjs`, `packages/web/scripts/light-scrub-budget.mjs`
- Modify: `tools/relight/relight/__main__.py` (register `cinematic-check`)
- Outputs (D:): `D:/claude/relight/grand-hall/renders/R1d_{off_captured,cin_captured,cin_night}/<view>@2x.png`, `D:/claude/relight/grand-hall/evidence/r1d/r1d-browser-run.json`, `evidence/r1d/light-scrub-budget.json`, `evidence/r1d/r1d-browser-checks.json`

**Interfaces:**
- Consumes: Tasks 21–22's `window.__relight.cinematic` (`still`, `state`, `shadowCheck`, `bloomEnergy`, `forceBothBodies`, `setStride`, `scrubTo`); R1b's `window.__relight` (`select`, `state`, `fixture`, `sample`), `window.__roomViewCapture`, `window.__roomWalk`, the vectors fixture (`src/lib/relight/__fixtures__/relight-vectors.json`), `browsercheck.py` (`CAPTURED_STOPS`, `LONG_TASK_MS`, `FRAME_MS`, `NIGHT_STATIONS`, `captured_verdict`, `stop_difference`, `_views`, `_word_ok`, `prepare`) and the proof's `07_compare`; Task 1's `bulbs.py` (`photo_check`, `NIGHT_VIEWS`, `GATE_CONTROL_RATIO`) and `<work>/bulbs.json`; Task 21's `nightcal.py` (`to_render_light`, `colour_accuracy`, `CELL_FRACTION`); `SkyClock` (Task 20: `role="slider"`, name "Time") and the lamps' radios ("On", "Off"); the walk's keys (`interiorMovementKey`: w, s and the arrows).
- Produces (`cinematiccheck.py`): `GLOW_REACH_PX = 48`, `SHADOW_DECIDED = 0.5`, `SHADOW_DISAGREE = 0.005`, `GLOW_TOLERANCE = 0.03`, `LAMP_HIT_SHARE = 0.9`, `DROPPED_MS = 33.4`, `MOVING_SHARE = 0.8`; `identity_mask(mask_lin, *srgbs, reach=GLOW_REACH_PX)`; `shadow_verdict(checks)`; `glow_verdict(energy)`; `photo_station_verdict(station)`; `budget_verdict(scenarios)`; `loading_verdict(off, cinematic)`; `fallback_verdict(runs)`; `words_verdict(checks)`; `identity_report`, `photo_report`, `lamps_report`; `run(cfg, args)` (the command `cinematic-check`).

What is judged, against the spec's numbers (§4.3, §4.6, §6, §7), each against an independent reference:
- **At the captured light, the hall is as captured where splats remain.** The seven proof views are rendered at the captured light with the cinematic light and with `?cinematic=off`, both with `?skins=off&floorskin=v1` (so only R1d differs), and compared in stops at every valid pixel (07_compare's mask: no view out, no fixture, nothing clipped or black) farther than 48 px (at 1×) from a fixture: the crisp lamps and their energy-conserving glow replace the captured glow there, which is what decision 1 changes. The 99th percentile must be within 1/20 stop (R1b's `CAPTURED_STOPS`), and is reported with and without the 48 px margin. The sheen is weighted to nothing at the captured light (Task 17), there are no interior shadows (no sun direction) and the eye holds the identity display (Task 9), so nothing else may differ.
- **The kernel's words.** Without the cinematic light, R1a's vectors (the captured light, the night, the sunny morning) through R1b's `fixture` check; with it, the CPU twin with the cinematic terms (Task 22) through `sample`, at the night, the sunny morning at 10:00, both bodies forced on (17 June 2026 at 11:00 BST: the Sun high in the south-east and an 8% Moon 29° up in the east, in front of the east-facing windows; A3's ephemeris, computed 7 October) and the moonlit night: each by R1b's own rule (`_word_ok`: within one code, alphas equal, at most 2% excused).
- **The interior shadows.** For each body that counts at those settings, the GPU's maps against the CPU twin at about 512 points: at least half decided (all 16 taps agree) and at most 0.5% of the decided points disagreeing.
- **The glow conserves energy.** The design glow on its known block returns its energy within 3%.
- **The night photographs, colour included.** The calibrated night (the product as shipped: skins on, the default floor) at stations 43 and 45 against the night photographs: 07_compare's r at least R1b's threshold (0.85, 0.80) and at least the captured hall's, and the median CIEDE2000 (Task 21's measure) no worse than the captured hall's.
- **The crisp lamps stand where the bulbs are.** Each crisp lamp projected into the night renders falls within ±3 px of a near-saturated pixel at least 90% of the time among those in view, and the control points (1 m out from each chandelier's axis) at most half as often (Task 1's check, run on the renders).
- **Fallbacks** (spec §7). A missing cinematic package leaves the hall relit with no crisp lamps and exactly one `cinematic` warning; `?cinematic=off` removes the cinematic controls entirely.
- **Loading** (§4.6, "no main-thread task over 50 ms while loading"). At load completion the cinematic session has no more long tasks over 50 ms than the same session with `?cinematic=off`, and no console warning or error the off session lacks.
- **The frame budget** (§4.6: "60 fps while scrubbing the clock and while walking (p99 frame ≤ 16.7 ms), no dropped frames during light motion"). On the RTX 4090 at 1920 × 1080: scrubbing the clock through the day (the store's hour moved every frame), dragging the clock itself with the pointer, walking (w held, then s), fading the lamps in and out at dusk, and both bodies forced on while scrubbing: in each, the p99 frame within 16.7 ms and no frame over 33.4 ms; in each motion scenario the light must actually be moving in at least 80% of the sampled frames. A miss takes decision 7's remedies in order (the stride first: rerun with `CINEMATIC_BUDGET_STRIDE=2`, which leaves every splat at the final light once it settles) and is reported with both runs; the limit is never loosened.

Everything browser-side holds the GPU lock and runs headed Chromium on the shared GPU, as R1b's driver does.

Verified (7 October): R1b plan lines 8667–8677 (`NIGHT_STATIONS`, `CAPTURED_STOPS = 0.05`, `LONG_TASK_MS = 50`, `FRAME_MS = 16.7`), 8691–8712 (`stop_difference`, `comparison_mask`, `captured_verdict`: the 99th percentile within `CAPTURED_STOPS`), 8719–8724 (`_views`, `_srgb8`), 8789–8796 (`_word_ok`), 8826–8843 (`prepare`, which also copies `views.json` into `<work>`; `importlib.import_module("07_compare")`), 8866–8872 (registering a command after `from . import browsercheck`), 8906 (`VECTORS = "src/lib/relight/__fixtures__/relight-vectors.json"`), 8913–8975 (the lock, `openWalk`, the console and long-task listeners, `captureViews`), 9003–9005 (the browser's flags), 9030–9037 (`fixture` for captured, night and sunny_morning; `sample(97)`); `packages/web/scripts/splat-drag-budget.mjs:64-104` (`DROPPED_FRAME_MS = 33.4`, `percentile`, `summarize`), `:111-138` (`sampleFrames`: rAF intervals inside the page), `:211-226` (`dragFor`); `packages/web/src/pages/RoomWalkPage.tsx:47-80` (`window.__roomWalk`), `packages/web/src/components/rooms/InteriorCamera.tsx:292-332` (the walk's keys on `window`), `packages/web/src/components/rooms/interior-camera-input.ts:16-18` (`interiorMovementKey`: w, a, s, d and the arrows); this plan's Task 20 (`SkyClock`: `role="slider"`, `aria-label="Time"`; the lamps' fieldset with radios "Automatic", "On", "Off", enabled for a timed preset), Tasks 21–22 (the controls), Task 1 (`photo_check(bulbs, chandeliers, views, photos, t_json_from_e57, translation)`); A3's `moonPosition` for 17 June 2026 10:00 UTC: elevation 29.2°, azimuth 92.6°, 8% lit (scratch run, 7 October).

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_cinematiccheck.py`:

```python
import unittest

import numpy as np

from relight import cinematiccheck as C


class Identity(unittest.TestCase):
    def test_the_mask_keeps_valid_pixels_away_from_fixtures(self):
        mask = np.zeros((10, 100, 3))
        mask[5, 50, 1] = 1.0                     # one fixture pixel (green)
        mask[0, 0, 0] = 1.0                      # one view-out pixel (red)
        srgb = np.full((10, 100, 3), 0.5)
        ok = C.identity_mask(mask, srgb, reach=3)
        self.assertFalse(ok[0, 0])               # the view out
        self.assertFalse(ok[5, 50])              # the fixture
        self.assertFalse(ok[5, 53])              # within its reach
        self.assertTrue(ok[5, 54])               # beyond it
        self.assertTrue(ok[9, 99])


class Verdicts(unittest.TestCase):
    def test_shadows_need_decided_points_and_almost_no_disagreement(self):
        good = {"body": "sun", "points": 512, "decided": 400, "disagreements": 2}
        self.assertTrue(C.shadow_verdict([good])["pass"])
        self.assertFalse(C.shadow_verdict([dict(good, disagreements=3)])["pass"])
        self.assertFalse(C.shadow_verdict([dict(good, decided=200, disagreements=0)])["pass"])
        self.assertFalse(C.shadow_verdict([])["pass"])

    def test_the_glow_returns_its_energy(self):
        self.assertTrue(C.glow_verdict({"emitted": 64, "glowed": 63.0, "ratio": 63 / 64})["pass"])
        self.assertFalse(C.glow_verdict({"emitted": 64, "glowed": 70.0, "ratio": 70 / 64})["pass"])
        self.assertFalse(C.glow_verdict(None)["pass"])

    def test_a_station_is_no_worse_than_the_captured_hall_by_r_and_colour(self):
        station = {"threshold": 0.85, "captured": {"r": 0.86, "median": 6.0}, "cinematic": {"r": 0.88, "median": 5.0}}
        self.assertTrue(C.photo_station_verdict(station))
        self.assertFalse(C.photo_station_verdict(dict(station, cinematic={"r": 0.855, "median": 5.0})))
        self.assertFalse(C.photo_station_verdict(dict(station, cinematic={"r": 0.88, "median": 6.5})))

    def test_the_budget_holds_every_scenario_and_the_light_really_moved(self):
        fast = {"p99Ms": 16.0, "droppedFrames": 0, "movingShare": 0.95, "motion": True}
        still = {"p99Ms": 16.0, "droppedFrames": 0, "movingShare": 0.0, "motion": False}
        self.assertTrue(C.budget_verdict({"scrub": fast, "walk": still})["pass"])
        self.assertFalse(C.budget_verdict({"scrub": dict(fast, p99Ms=17.1)})["pass"])
        self.assertFalse(C.budget_verdict({"scrub": dict(fast, droppedFrames=1)})["pass"])
        self.assertFalse(C.budget_verdict({"scrub": dict(fast, movingShare=0.5)})["pass"])
        self.assertFalse(C.budget_verdict({})["pass"])

    def test_loading_adds_no_long_task_and_no_message(self):
        off = {"longTasks": [60, 20], "messages": ["warning: a"]}
        self.assertTrue(C.loading_verdict(off, {"longTasks": [55, 10], "messages": ["warning: a"]})["pass"])
        self.assertFalse(C.loading_verdict(off, {"longTasks": [55, 70], "messages": []})["pass"])
        self.assertFalse(C.loading_verdict(off, {"longTasks": [], "messages": ["error: b"]})["pass"])

    def test_the_fallbacks_stay_relit_without_crisp_lamps_and_warn_once(self):
        runs = {"missing": {"relit": True, "state": {"packaged": False, "crispLamps": 0}, "cinematicWarnings": 1},
                "off": {"relit": True, "controls": False}}
        self.assertTrue(C.fallback_verdict(runs)["pass"])
        self.assertFalse(C.fallback_verdict(dict(runs, missing=dict(runs["missing"], cinematicWarnings=2)))["pass"])
        self.assertFalse(C.fallback_verdict(dict(runs, off={"relit": True, "controls": True}))["pass"])

    def test_words_follow_r1bs_rule(self):
        good = {"checked": 1000, "worstCodeDistance": 1, "alphaMismatches": 0, "missing": 0, "excused": 3, "sunMarched": 400}
        self.assertTrue(C.words_verdict({"sample_night": good, "sample_sunny": good})["pass"])
        self.assertFalse(C.words_verdict({"sample_night": dict(good, alphaMismatches=1)})["pass"])
        self.assertFalse(C.words_verdict({})["pass"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematiccheck -v`
Expected: FAIL — `ImportError: cannot import name 'cinematiccheck' from 'relight'`.

- [ ] **Step 3: The checks** — create `tools/relight/relight/cinematiccheck.py`:

```python
"""Browser checks of the cinematic light (T-639 R1d, plan Task 23).

Reads the renders cinematic-verify.mjs wrote under <root>/renders, its run record and light-scrub-budget.mjs's frame
record under <evidence>/r1d, and writes <evidence>/r1d/r1d-browser-checks.json. Sections: identity (the captured light
with and without the cinematic light, where splats remain), words (R1a's vectors without the cinematic light, the CPU
twin with it), shadows (the interior maps against their CPU twin), glow (the design glow's energy), photo (the night
against the night photographs: r and CIEDE2000, never worse than the hall as captured), lamps (the crisp lamps where
the photographs put the bulbs), fallback (a missing package, ?cinematic=off), loading (no new long task or console
message), budget (60 fps while the light moves and while walking). The verdicts take decoded arrays and records, so
the unit tests need no D: inputs."""
from __future__ import annotations

import importlib
import json
import os

import numpy as np
from scipy.ndimage import binary_dilation

from . import browsercheck as bc
from . import bulbs as B
from . import nightcal as N

#: The crisp lamps' glow replaces the captured glow this far around a fixture (at 1x): the design glow's reach.
GLOW_REACH_PX = 48
SHADOW_DECIDED = 0.5
SHADOW_DISAGREE = 0.005
GLOW_TOLERANCE = 0.03
LAMP_HIT_SHARE = 0.9
DROPPED_MS = 33.4
MOVING_SHARE = 0.8


def identity_mask(mask_lin, *srgbs, reach: int = GLOW_REACH_PX) -> np.ndarray:
    """07_compare's valid mask (no view out, no fixture, nothing clipped or black) less `reach` px around a fixture."""
    mask = np.asarray(mask_lin, np.float64)
    fixture = mask[..., 1] >= 0.05
    ok = (mask[..., 0] < 0.05) & ~fixture
    for s in srgbs:
        s = np.asarray(s, np.float64)
        ok &= (s.max(-1) < 0.98) & (s.max(-1) > 0.03)
    if reach > 0 and fixture.any():
        ok &= ~binary_dilation(fixture, iterations=reach)
    return ok


def shadow_verdict(checks: list[dict]) -> dict:
    ok = bool(checks) and all(c["decided"] >= SHADOW_DECIDED * c["points"] and c["disagreements"] <= SHADOW_DISAGREE * c["decided"]
                              for c in checks)
    return {"checks": checks, "pass": ok}


def glow_verdict(energy: dict | None) -> dict:
    ok = energy is not None and abs(float(energy["ratio"]) - 1.0) <= GLOW_TOLERANCE
    return {"energy": energy, "pass": bool(ok)}


def photo_station_verdict(station: dict) -> bool:
    captured, cinematic = station["captured"], station["cinematic"]
    return cinematic["r"] >= max(station["threshold"], captured["r"]) and cinematic["median"] <= captured["median"]


def budget_verdict(scenarios: dict) -> dict:
    def ok(s: dict) -> bool:
        return s["p99Ms"] <= bc.FRAME_MS and s["droppedFrames"] == 0 and (not s["motion"] or s["movingShare"] >= MOVING_SHARE)
    return {"scenarios": scenarios, "pass": bool(scenarios) and all(ok(s) for s in scenarios.values())}


def loading_verdict(off: dict, cinematic: dict) -> dict:
    long_off = [t for t in off["longTasks"] if t > bc.LONG_TASK_MS]
    long_cin = [t for t in cinematic["longTasks"] if t > bc.LONG_TASK_MS]
    new_messages = sorted(set(cinematic["messages"]) - set(off["messages"]))
    return {"longTasks": {"off": long_off, "cinematic": long_cin}, "newMessages": new_messages,
            "pass": len(long_cin) <= len(long_off) and not new_messages}


def fallback_verdict(runs: dict) -> dict:
    missing, off = runs["missing"], runs["off"]
    ok = (missing["relit"] and not missing["state"]["packaged"] and missing["state"]["crispLamps"] == 0
          and missing["cinematicWarnings"] == 1 and off["relit"] and not off["controls"])
    return {"runs": runs, "pass": bool(ok)}


def words_verdict(checks: dict) -> dict:
    ok = {name: bc._word_ok(name, value) for name, value in checks.items()}
    return {"checks": checks, "ok": ok, "pass": bool(checks) and all(ok.values())}


def identity_report(cmp, renders: str) -> dict:
    views = {}
    for view in bc._views(renders, "R1d_cin_captured"):
        if not os.path.exists(os.path.join(renders, "A_mask", f"{view}.png")):
            continue
        mask_lin, _ = cmp.render("A_mask", view)
        off_lin, off_s = cmp.render("R1d_off_captured", view)
        on_lin, on_s = cmp.render("R1d_cin_captured", view)
        plain = bc.captured_verdict(bc.stop_difference(on_lin, off_lin, identity_mask(mask_lin, off_s, on_s, reach=0)))
        margin = bc.captured_verdict(bc.stop_difference(on_lin, off_lin, identity_mask(mask_lin, off_s, on_s)))
        views[view] = {"withoutMargin": plain, "withMargin": margin, "pass": margin["pass"]}
    return {"views": views, "pass": bool(views) and all(v["pass"] for v in views.values())}


def photo_report(cmp) -> dict:
    stations = {}
    for view, threshold in bc.NIGHT_STATIONS.items():
        photo_lin, photo_s = cmp.photo(view)
        captured_lin, captured_s = cmp.render("R1d_cin_captured", view)
        night_lin, night_s = cmp.render("R1d_cin_night", view)
        ok_px = cmp.valid_mask(view, photo_s, captured_s, night_s)
        photo_cells, fraction = cmp.cells(photo_lin, ok_px)
        ok = fraction > N.CELL_FRACTION
        photo = photo_cells[ok]
        record = {"threshold": threshold, "cells": int(ok.sum())}
        for name, lin in (("captured", captured_lin), ("cinematic", night_lin)):
            cells = cmp.cells(lin, ok_px)[0][ok]
            record[name] = {"r": cmp.metrics(cells, photo, np.ones(len(cells), bool))["r"],
                            **N.colour_accuracy(N.to_render_light(photo, cells)[0], cells)}
        record["pass"] = photo_station_verdict(record)
        stations[view] = record
    return {"stations": stations, "pass": all(s["pass"] for s in stations.values())}


def lamps_report(cmp, cfg) -> dict:
    with open(os.path.join(cfg.paths["work"], "bulbs.json"), encoding="utf-8") as f:
        placed = json.load(f)["bulbs"]
    with open(cfg.paths["canonicalFrame"], encoding="utf-8") as f:
        t_je = np.asarray(json.load(f)["T_json_from_e57"], np.float64)
    with open(os.path.join(cfg.paths["work"], "views.json"), encoding="utf-8") as f:
        views = {v["name"]: v for v in json.load(f)}
    renders = {name: cmp.render("R1d_cin_night", name)[1] for name in B.NIGHT_VIEWS}
    check = B.photo_check(np.array([b["position"] for b in placed]).reshape(-1, 3), [b["chandelier"] for b in placed], views, renders, t_je,
                          cfg.room["manifestTranslation"])
    seen = [s for s in check["stations"].values() if s["inView"]]
    ok = bool(seen) and all(s["share"] >= LAMP_HIT_SHARE and s["controlShare"] <= B.GATE_CONTROL_RATIO * s["share"] for s in seen)
    return {"stations": check["stations"], "pass": ok}


def run(cfg, _args) -> int:
    root = bc.prepare(cfg)
    renders = os.path.join(root, "renders")
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    with open(os.path.join(evidence, "r1d-browser-run.json"), encoding="utf-8") as f:
        browser = json.load(f)
    with open(os.path.join(evidence, "light-scrub-budget.json"), encoding="utf-8") as f:
        budget = json.load(f)
    # The proof's comparison, importable once `python -m relight` has made the proof importable (R1b Task 18).
    cmp = importlib.import_module("07_compare")
    runs = browser["runs"]
    report = {
        "identity": identity_report(cmp, renders),
        "words": words_verdict({**runs["off"]["gpu"], **runs["cinematic"]["words"]}),
        "shadows": shadow_verdict([check for checks in runs["cinematic"]["shadows"].values() for check in checks]),
        "glow": glow_verdict(runs["cinematic"]["glow"]),
        "photo": photo_report(cmp),
        "lamps": lamps_report(cmp, cfg),
        "fallback": fallback_verdict({"missing": runs["missing"], "off": runs["off"]}),
        "loading": loading_verdict(runs["off"]["atLoad"], runs["cinematic"]["atLoad"]),
        "budget": budget_verdict(budget["scenarios"]),
    }
    report["pass"] = all(section["pass"] for section in report.values())
    with open(os.path.join(evidence, "r1d-browser-checks.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1, sort_keys=True, default=float)
    for name, section in report.items():
        if name != "pass":
            print(f"{name}: {'pass' if section['pass'] else 'FAIL'}", flush=True)
    for view, record in report["photo"]["stations"].items():
        print(f"  {view}: r {record['cinematic']['r']} (captured {record['captured']['r']}, needs {record['threshold']}), "
              f"median dE00 {record['cinematic']['median']:.2f} (captured {record['captured']['median']:.2f})", flush=True)
    return 0 if report["pass"] else 1
```

In `tools/relight/relight/__main__.py`, directly after Task 21's `from . import nightcal …` line add `from . import cinematiccheck  # noqa: E402  (R1d: the browser's cinematic checks)`, and directly after `COMMANDS["night-calibration"] = nightcal.run` add `COMMANDS["cinematic-check"] = cinematiccheck.run`.

- [ ] **Step 4: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematiccheck -v`
Expected: PASS, 8 tests.

- [ ] **Step 5: The browser driver** — create `packages/web/scripts/cinematic-verify.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// R1d browser verification (T-639, plan Task 23). Drives the REAL walk route on the REAL GPU (headed Chromium),
// holding the build PC's GPU lock throughout. Renders the proof's views at the captured light with and without the
// cinematic light (skins and floor skin off, so only R1d differs) and the night stations with it (the product as
// shipped); reads back the kernel's words (R1a's vectors without the cinematic light, the CPU twin with it), the
// interior shadows and the glow's energy; checks a missing package and ?cinematic=off; and records long tasks and
// console messages at load. The Python `cinematic-check` command judges what this writes.
//
//   node scripts/cinematic-verify.mjs        (the development server on 5192, as for relight-verify.mjs)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.CINEMATIC_BASE_URL ?? "http://127.0.0.1:5192";
const ROOT = process.env.CINEMATIC_ROOT ?? "D:/claude/relight/grand-hall";
const VIEWS = process.env.CINEMATIC_VIEWS ?? "D:/claude/real-hall/renovation/relight/work/views.json";
const VECTORS = process.env.CINEMATIC_VECTORS ?? "src/lib/relight/__fixtures__/relight-vectors.json";
const LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock";
const OWNER = "cinematic-verify (T-639 R1d)";
const STATIONS = ["mp43_night_end", "mp45_night_windows"];
const WIDTH = 1920, HEIGHT = 1080, SCALE = 2;
const LOAD_TIMEOUT_MS = 240_000;
const SETTLE_TIMEOUT_MS = 30_000;
const SHADOW_POINTS = 512;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function takeLock() {
  for (let waited = 0; ; waited += 30_000) {
    try {
      const handle = await open(LOCK, "wx");
      await handle.writeFile(JSON.stringify({ owner: OWNER, since: new Date().toISOString() }));
      await handle.close();
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = await readFile(LOCK, "utf8").catch(() => "?");
      if (waited >= 3_600_000) throw new Error(`The GPU lock is still held after an hour: ${holder}`);
      console.log(`waiting for the GPU lock: ${holder}`);
      await sleep(30_000);
    }
  }
}

async function releaseLock() {
  const holder = await readFile(LOCK, "utf8").catch(() => "");
  if (holder.includes(OWNER)) await rm(LOCK, { force: true });
}

/** A walk page at a query, waiting until the room is complete and relit; console messages and long tasks recorded. */
async function openWalk(browser, query, prepare = async () => undefined) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  const messages = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") messages.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => { messages.push(`pageerror: ${error.message}`); });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); })
      .observe({ type: "longtask", buffered: true });
  });
  await prepare(page);
  await page.goto(`${BASE_URL}/room/grand-hall?bare=1&${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => window.__roomWalk?.complete === true && window.__relight?.state().relit === true, undefined, { timeout: LOAD_TIMEOUT_MS });
  const atLoad = { longTasks: await page.evaluate(() => [...window.__longTasks]), messages: [...messages] };
  return { context, page, messages, atLoad };
}

/** The director still (or absent), then two frames. */
async function settle(page) {
  await page.waitForFunction(() => window.__relight?.cinematic?.still() !== false, undefined, { timeout: SETTLE_TIMEOUT_MS });
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); }));
}

async function captureViews(page, views, job) {
  const folder = join(ROOT, "renders", job);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  for (const view of views) {
    const dataUrl = await page.evaluate(async (request) => (await window.__roomViewCapture(request)).dataUrl,
      { position: view.pos, target: view.tgt, fov: view.fov, width: WIDTH * SCALE, height: HEIGHT * SCALE });
    await writeFile(join(folder, `${view.name}@2x.png`), Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
  }
}

async function main() {
  const views = JSON.parse(await readFile(VIEWS, "utf8"));
  const stations = views.filter((view) => STATIONS.includes(view.name));
  const vectors = JSON.parse(await readFile(VECTORS, "utf8"));
  const record = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, runs: {} };
  await takeLock();
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"],
  });
  try {
    // The captured light without and with the cinematic light: only R1d may differ.
    const offIdentity = await openWalk(browser, "light=captured&cinematic=off&skins=off&floorskin=v1");
    await captureViews(offIdentity.page, views, "R1d_off_captured");
    await offIdentity.context.close();
    const cinIdentity = await openWalk(browser, "light=captured&skins=off&floorskin=v1");
    await settle(cinIdentity.page);
    await captureViews(cinIdentity.page, views, "R1d_cin_captured");
    await cinIdentity.context.close();

    // Without the cinematic light (the product's own query): R1a's vectors, the loading baseline, no controls.
    const off = await openWalk(browser, "light=night&cinematic=off");
    const gpu = {};
    for (const setting of ["captured", "night", "sunny_morning"]) {
      gpu[`fixture_${setting}`] = await off.page.evaluate(([value, name]) => window.__relight.fixture(value, name), [vectors, setting]);
    }
    record.runs.off = {
      atLoad: off.atLoad, gpu, relit: await off.page.evaluate(() => window.__relight.state().relit),
      controls: await off.page.evaluate(() => window.__relight.cinematic !== null),
    };
    await off.context.close();

    // With the cinematic light, as shipped.
    const cin = await openWalk(browser, "light=night");
    const page = cin.page;
    await settle(page);
    const words = {}, shadows = {};
    await captureViews(page, stations, "R1d_cin_night");
    words.sample_night = await page.evaluate(() => window.__relight.sample(97));
    await page.evaluate(async () => { await window.__relight.select("sunny", 600); });
    await settle(page);
    words.sample_sunny = await page.evaluate(() => window.__relight.sample(97));
    shadows.sunny = await page.evaluate((points) => window.__relight.cinematic.shadowCheck(points), SHADOW_POINTS);
    // Both bodies: 17 June 2026, 11:00 BST, the Sun high in the south-east and an 8% Moon 29° up in the east.
    await page.evaluate(async () => { await window.__relight.select("sunny", 660, "2026-06-17"); window.__relight.cinematic.forceBothBodies(true); });
    await settle(page);
    words.sample_both = await page.evaluate(() => window.__relight.sample(97));
    shadows.both = await page.evaluate((points) => window.__relight.cinematic.shadowCheck(points), SHADOW_POINTS);
    const bothState = await page.evaluate(() => window.__relight.cinematic.state());
    await page.evaluate(() => { window.__relight.cinematic.forceBothBodies(false); });
    await page.evaluate(async () => { await window.__relight.select("moonlit"); });
    await settle(page);
    words.sample_moonlit = await page.evaluate(() => window.__relight.sample(97));
    shadows.moonlit = await page.evaluate((points) => window.__relight.cinematic.shadowCheck(points), SHADOW_POINTS);
    const glow = await page.evaluate(() => window.__relight.cinematic.bloomEnergy());
    record.runs.cinematic = {
      atLoad: cin.atLoad, words, shadows, glow, bothState,
      state: await page.evaluate(() => window.__relight.cinematic.state()), messages: [...cin.messages],
    };
    await cin.context.close();

    // A missing cinematic package: the hall stays relit, without crisp lamps, with one warning.
    const missing = await openWalk(browser, "light=night", async (target) => {
      await target.route("**/cinematic/v1/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
    });
    await sleep(3000);
    record.runs.missing = {
      relit: await missing.page.evaluate(() => window.__relight.state().relit),
      state: await missing.page.evaluate(() => window.__relight.cinematic.state()),
      cinematicWarnings: missing.messages.filter((message) => message.startsWith("warning:") && message.includes("cinematic")).length,
      messages: [...missing.messages],
    };
    await missing.context.close();
  } finally {
    await browser.close();
    await releaseLock();
  }
  record.finishedAt = new Date().toISOString();
  const evidence = join(ROOT, "evidence", "r1d");
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "r1d-browser-run.json"), JSON.stringify(record, null, 1));
  console.log("cinematic-verify: wrote", join(evidence, "r1d-browser-run.json"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 6: The frame budget** — create `packages/web/scripts/light-scrub-budget.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// R1d's frame budget while the light moves (T-639, plan Task 23; spec §4.6). Drives the REAL walk route with its
// controls on the REAL GPU (headed Chromium, 1920 x 1080 at DPR 1), holding the GPU lock, and samples the frame loop
// while: the clock is scrubbed through the day, the clock is dragged with the pointer, the visitor walks, the lamps
// fade in and out at dusk, and both bodies are forced on while scrubbing. Each scenario reports the p99 frame, the
// frames over 33.4 ms and the share of frames in which the light was moving.
//
//   node scripts/light-scrub-budget.mjs
//   CINEMATIC_BUDGET_STRIDE=2 node scripts/light-scrub-budget.mjs    (decision 7's first remedy)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.CINEMATIC_BASE_URL ?? "http://127.0.0.1:5192";
const ROOT = process.env.CINEMATIC_ROOT ?? "D:/claude/relight/grand-hall";
const STRIDE = Number(process.env.CINEMATIC_BUDGET_STRIDE ?? "1");
const LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock";
const OWNER = "light-scrub-budget (T-639 R1d)";
const WIDTH = 1920, HEIGHT = 1080;
const SAMPLE_MS = 6000;
const LOAD_TIMEOUT_MS = 240_000;
const DROPPED_FRAME_MS = 33.4;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function takeLock() {
  for (let waited = 0; ; waited += 30_000) {
    try {
      const handle = await open(LOCK, "wx");
      await handle.writeFile(JSON.stringify({ owner: OWNER, since: new Date().toISOString() }));
      await handle.close();
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = await readFile(LOCK, "utf8").catch(() => "?");
      if (waited >= 3_600_000) throw new Error(`The GPU lock is still held after an hour: ${holder}`);
      console.log(`waiting for the GPU lock: ${holder}`);
      await sleep(30_000);
    }
  }
}

async function releaseLock() {
  const holder = await readFile(LOCK, "utf8").catch(() => "");
  if (holder.includes(OWNER)) await rm(LOCK, { force: true });
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
}

function summarize(sample, motion) {
  const frames = sample.frames;
  const round = (value) => Math.round(value * 100) / 100;
  return {
    motion,
    frames: frames.length,
    p50Ms: round(percentile(frames, 50)),
    p99Ms: round(percentile(frames, 99)),
    maxMs: round(frames.length === 0 ? 0 : Math.max(...frames)),
    droppedFrames: frames.filter((value) => value > DROPPED_FRAME_MS).length,
    movingShare: frames.length === 0 ? 0 : sample.moving / frames.length,
  };
}

/**
 * rAF intervals for `durationMs` inside the page, the frames in which the light was moving, and optionally a scrub:
 * the store's hour moved every frame from sweep[0] to sweep[1] minutes.
 */
async function sampleFrames(page, durationMs, sweep = null) {
  return page.evaluate(([duration, range]) => new Promise((resolve) => {
    const frames = [];
    let moving = 0;
    const startedAt = performance.now();
    let last = startedAt;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      const controls = window.__relight?.cinematic ?? null;
      if (controls !== null && controls.state().lightMoving) moving += 1;
      if (range !== null && controls !== null) controls.scrubTo(range[0] + (range[1] - range[0]) * Math.min(1, (now - startedAt) / duration));
      if (now - startedAt >= duration) { resolve({ frames: frames.slice(1), moving }); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [durationMs, sweep]);
}

/** Drag the clock's time slider across its width for `durationMs`. */
async function dragClock(page, durationMs) {
  const box = await page.getByRole("slider", { name: "Time", exact: true }).boundingBox();
  if (box === null) throw new Error("The clock's time slider is not on the page.");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 4, y);
  await page.mouse.down();
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await page.mouse.move(box.x + 4 + (box.width - 8) * ((Date.now() - startedAt) / durationMs), y);
    await sleep(12);
  }
  await page.mouse.up();
}

async function main() {
  await takeLock();
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"],
  });
  const scenarios = {};
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/room/grand-hall?light=sunny`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => window.__roomWalk?.complete === true && (window.__relight?.cinematic ?? null) !== null, undefined, { timeout: LOAD_TIMEOUT_MS });
    await page.evaluate((stride) => { window.__relight.cinematic.setStride(stride); }, STRIDE);

    // Scrubbing the clock through the day (the store's hour moved every frame).
    await page.evaluate(async () => { await window.__relight.select("sunny", 360, "2026-06-17"); });
    scenarios.scrub = summarize(await sampleFrames(page, SAMPLE_MS, [360, 1260]), true);

    // Dragging the clock itself.
    await page.evaluate(async () => { await window.__relight.select("sunny", 600, "2026-06-17"); });
    const dragged = sampleFrames(page, SAMPLE_MS);
    await dragClock(page, SAMPLE_MS - 200);
    scenarios.drag = summarize(await dragged, true);

    // Walking with the light still: w held, then s.
    await page.evaluate(async () => { await window.__relight.select("sunny", 600, "2026-06-17"); });
    await sleep(2000);
    const walked = sampleFrames(page, SAMPLE_MS);
    await page.keyboard.down("w");
    await sleep(SAMPLE_MS / 2);
    await page.keyboard.up("w");
    await page.keyboard.down("s");
    await sleep(SAMPLE_MS / 2 - 100);
    await page.keyboard.up("s");
    scenarios.walk = summarize(await walked, false);

    // The lamps fading in and out at dusk (21:30 BST in June), on the owner's warm-down.
    await page.evaluate(async () => { await window.__relight.select("sunny", 1290, "2026-06-17"); });
    const faded = sampleFrames(page, SAMPLE_MS);
    for (let switchNumber = 0; switchNumber < 4; switchNumber += 1) {
      await page.getByRole("radio", { name: switchNumber % 2 === 0 ? "On" : "Off", exact: true }).check();
      await sleep(SAMPLE_MS / 4 - 50);
    }
    scenarios.lamps = summarize(await faded, true);

    // Both bodies forced on while scrubbing through the late morning (a crescent Moon in the east).
    await page.evaluate(async () => { await window.__relight.select("sunny", 600, "2026-06-17"); window.__relight.cinematic.forceBothBodies(true); });
    scenarios.both = summarize(await sampleFrames(page, SAMPLE_MS, [600, 720]), true);
    await page.evaluate(() => { window.__relight.cinematic.forceBothBodies(false); });
    await context.close();
  } finally {
    await browser.close();
    await releaseLock();
  }
  const evidence = join(ROOT, "evidence", "r1d");
  await mkdir(evidence, { recursive: true });
  const record = { measuredAt: new Date().toISOString(), stride: STRIDE, width: WIDTH, height: HEIGHT, dpr: 1, scenarios };
  await writeFile(join(evidence, "light-scrub-budget.json"), JSON.stringify(record, null, 1));
  console.log(JSON.stringify(scenarios, null, 1));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 7: Verify** (the development server running as R1b's Task 18 runs it, on `http://127.0.0.1:5192`, with Tasks 1–22 built and Task 21's calibrated package staged; each driver takes the GPU lock)

```bash
cd D:/claude/real-hall/repo/packages/web && node scripts/cinematic-verify.mjs && node scripts/light-scrub-budget.mjs
cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight cinematic-check --config config/grand-hall.json
```

Expected: `identity: pass`, `words: pass`, `shadows: pass`, `glow: pass`, `photo: pass` (both stations' r and median ΔE00 printed beside the captured hall's), `lamps: pass`, `fallback: pass`, `loading: pass`, `budget: pass`, exit 0. Copy into the session log: the identity's p99 with and without the margin, both stations' numbers, the glow ratio, the shadow tallies and every budget scenario's p50, p99 and max. On a `FAIL`, keep the evidence, find the cause and fix it; never loosen a threshold. For example: `identity` failing without the margin and passing with it is the crisp lamps' glow (decision 1, reported); failing with it means a cinematic term leaks into the captured light (the sheen's weight, an interior shadow, the eye); a `words` failure with many `excused` points at the interior shadow's penumbra rule (compare `cpuTaps` with the shader's taps, Task 10); `shadows` disagreeing means the map's view or depth differs from the twin (`lightViewFor`, `SHADOW_BIAS`); `glow` off by more than 3% means the pyramid's weights or the high-pass are not as Task 13 assumes; `photo` worse than captured means the night's colour or the lamps' light is wrong (Task 21's evidence first); `lamps` missing means the lamps' frame or the envelope's centring is wrong (Task 11); `budget` failing a scenario takes decision 7's remedies in order (rerun the budget with `CINEMATIC_BUDGET_STRIDE=2` and report both runs; then R1b's early-out remedy), and the limit is never loosened.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/cinematiccheck.py tools/relight/tests/test_cinematiccheck.py tools/relight/relight/__main__.py packages/web/scripts/cinematic-verify.mjs packages/web/scripts/light-scrub-budget.mjs && git diff --cached --stat && git commit -m "test(relight): the cinematic light verified in the browser: identity, words, shadows, glow, photographs, lamps, fallbacks, loading and the frame budget (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Integrate, record and ship the preview

**Files:**
- Modify: `docs/engineering/relight-package.md`, `docs/engineering/native-splats.md`, `docs/engineering/cinematic-package.md` (Task 3), `tools/relight/README.md`, the day's session log `docs/sessions/<YYYY-MM-DD>.md`, `docs/state/tasks.md`
- Publish: `D:/claude/splats/trades-hall/grand-hall/cinematic/v1/` to R2 at `splats/trades-hall/grand-hall/cinematic/v1/`

**Interfaces:**
- Consumes: every task above; R1a's publisher (`packages/api/src/scripts/publish-splat-tiles.ts --package`, nested folders, run from the shared checkout's `packages/api` so it reads `.env` in place; the R2 credentials stay there); R1b's bundle-check builds (mode `bundle-check`, `VERCEL_ENV` production and preview) and its preview and GPU-gate steps (R1b Task 19 Steps 4–8, as amended by A10: this is the one preview of R1); `.github/gpu/README.md`, `.github/gpu/PUBLISHING.md`.
- Produces: `claude/real-hall` pushed with R1d; the cinematic package on R2; the PR's description carrying R1d's evidence; the one Vercel preview for Blake; the session log and T-639's row.

R1 polished §5: "R1 is delivered as four plans, executed in order, with one preview at the end": this task is that end. The shared delivery contract (`.claude/conventions/shipping-changes.md`) holds: verification, integration, deployment to the preview and a check of the changed live flow there; merge waits for Blake's explicit go-ahead in chat, and production keeps the founder hold (no splats, no relight or cinematic request, no light control on venviewer.com).

Verified (7 October): R1a plan Task 7 Steps 2–3 (the publisher's nested folders; `--package` with the staged folder and the R2 prefix; the publisher refuses to overwrite an existing version; run from the shared checkout's `packages/api`), R1b plan Task 19 Steps 4–8 (the affected tests one file per command, `typecheck`, `eslint`, the two `bundle-check` builds into D: and their greps, the R2 HEAD check, push and PR, CI and the GPU gate within its 25-minute window, the preview under the GPU lock, hand-over and merge on Blake's go-ahead), amendment A10; `docs/engineering/` (`relight-package.md`, `native-splats.md`, `README.md`), `docs/state/tasks.md` (T-639's row), `tools/relight/README.md` (R1a Task 7), `tools/relight/tests/test_moon.py` (R1a), amendment A3 (`packages/web/src/lib/__tests__/moon.test.ts`).

- [ ] **Step 1: Every affected test, one file per command, then typecheck and lint**

```bash
cd D:/claude/real-hall/repo
for f in src/lib/__tests__/springs.test.ts src/lib/__tests__/sun.test.ts src/lib/__tests__/moon.test.ts src/lib/__tests__/light-setting.test.ts src/stores/__tests__/light-setting-store.test.ts src/lib/relight/__tests__/lamp-dimming.test.ts src/lib/relight/__tests__/light-motion.test.ts src/lib/relight/__tests__/eye.test.ts src/lib/relight/__tests__/sky-instant.test.ts src/lib/relight/__tests__/relight-kernel.test.ts src/lib/relight/__tests__/relight-frame.test.ts src/lib/relight/__tests__/relight-draw.test.ts src/lib/relight/__tests__/relight-apply.test.ts src/lib/__tests__/native-splat-scene.test.ts src/lib/relight/__tests__/cinematic-package.test.ts src/lib/__tests__/splat-staging-plugin.test.ts src/lib/relight/__tests__/light-director.test.ts src/lib/relight/__tests__/sun-shadow.test.ts src/components/stage/__tests__/StageFloor.test.tsx src/lib/relight/__tests__/bulbs.test.ts src/lib/__tests__/native-renderer-scope.test.ts src/components/scene/__tests__/NativeCanvas.test.tsx src/lib/__tests__/native-current-view-capture.test.ts src/lib/relight/__tests__/cinematic-composer.test.ts src/lib/relight/__tests__/sun-shafts.test.ts src/lib/relight/__tests__/window-view.test.ts src/lib/relight/__tests__/sky-panels.test.ts src/lib/relight/__tests__/display.test.ts src/lib/relight/__tests__/sheen.test.ts src/lib/relight/__tests__/reflection-probes.test.ts src/lib/relight/__tests__/sky-arcs.test.ts src/components/rooms/__tests__/SkyClock.test.tsx src/components/rooms/__tests__/LightControl.test.tsx src/components/rooms/__tests__/RoomSplatScene.test.tsx src/components/scene/__tests__/RelightCinematic.test.tsx src/components/scene/__tests__/RelightProvider.test.tsx src/lib/relight/__tests__/relight-debug.test.ts; do pnpm --filter @omnitwin/web exec vitest run "$f" || { echo "FAILED: $f"; break; }; done
pnpm --filter @omnitwin/web typecheck && pnpm exec eslint packages/web/src packages/web/scripts/cinematic-calibrate.mjs packages/web/scripts/cinematic-verify.mjs packages/web/scripts/light-scrub-budget.mjs
cd tools/relight && C:/Python313/python.exe -m unittest tests.test_bulbs tests.test_occluders tests.test_cinematic tests.test_nightcal tests.test_cinematiccheck tests.test_browsercheck tests.test_moon -v
```

Expected: every file passes, typecheck and lint exit 0, the Python tests pass. A failure is fixed at its cause and the whole step rerun.

- [ ] **Step 2: The production bundle holds nothing of the cinematic light; the preview bundle does** (R1b Task 19 Step 4's builds, into D:)

```bash
cd D:/claude/real-hall/repo && B=D:/claude/relight/grand-hall \
  && NODE_ENV=production VERCEL_ENV=production pnpm --filter @omnitwin/web exec vite build --mode bundle-check --outDir $B/bundle-production --emptyOutDir \
  && NODE_ENV=production VERCEL_ENV=preview pnpm --filter @omnitwin/web exec vite build --mode bundle-check --outDir $B/bundle-preview --emptyOutDir \
  && (grep -rlE "relight-cinematic-composite|relight-bulbs|RelightShadowReadback|cinematic/v1" $B/bundle-production && echo "LEAK: the cinematic light is in the production bundle" || echo "production bundle clean") \
  && (grep -rl "__relight" $B/bundle-production && echo "LEAK: the DEV instruments are in the production bundle" || echo "no instruments") \
  && (grep -rl "relight-cinematic-composite" $B/bundle-preview >/dev/null && echo "preview bundle has the cinematic light" || echo "MISSING: the preview bundle lacks the cinematic light")
```

Expected: both builds exit 0, then `production bundle clean`, `no instruments`, `preview bundle has the cinematic light`. A failed build stops the chain before any grep. A leak is fixed at its cause (a static import reaching the production graph), never by weakening the check.

- [ ] **Step 3: Publish the cinematic package and check it where previews read it**

Run R1a's publisher exactly as R1a Task 7 Step 3 runs it (this worktree's script, with the working directory set to the shared checkout's `packages/api`, which reads `.env` in place; never copy `.env`), with `--package D:/claude/splats/trades-hall/grand-hall/cinematic/v1` and the prefix `splats/trades-hall/grand-hall/cinematic/v1`. The publisher refuses to overwrite an existing version: if `cinematic/v1` is already published with other bytes, stop and report (a new version is the controller's call). Then:

```bash
cd D:/claude/real-hall/repo && node -e "
const base='https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/cinematic/v1/';
const m=require('D:/claude/splats/trades-hall/grand-hall/cinematic/v1/manifest.json');
const crypto=require('crypto');
(async()=>{let bad=0;for(const p of ['manifest.json',...Object.keys(m.files)]){const r=await fetch(base+p);const enc=r.headers.get('content-encoding'),type=r.headers.get('content-type');const body=Buffer.from(await r.arrayBuffer());
const want=m.files[p];const sha=crypto.createHash('sha256').update(body).digest('hex');
if(!r.ok||enc||(p.endsWith('.gz')&&type!=='application/octet-stream')||(want&&(want.sha256!==sha||want.bytes!==body.length))){bad++;console.log(r.status,enc,type,p,sha);}}console.log('cinematic files checked,',bad,'problems');})();"
```

Expected: `cinematic files checked, 0 problems` (each file served, no `Content-Encoding`, the `.gz` as `application/octet-stream`, and the bytes' SHA-256 and size as the manifest records). Also run R1c's own published-files check, since the cinematic package refuses a relight package of another model frame.

- [ ] **Step 4: The notes** — make these edits, each a section added in full:

In `docs/engineering/relight-package.md`, add at the end:

```markdown
## R1d: the cinematic light on top of the package (T-639)

R1d (`docs/superpowers/plans/2026-10-03-restored-hall-r1d-cinematic-light.md`) leaves this package's format alone and
adds a small sibling, the cinematic package (`docs/engineering/cinematic-package.md`), at
`splats/<venue>/<room>/cinematic/v1/`. What changes in the browser's use of this package:

- **The kernel's glow hiding.** While the crisp candle lamps draw, every splat of record class 3 (the chandelier
  emitter class, which the frontier splats study measured as the capture's glow of the bulbs) whose nearest chandelier
  centre has crisp lamps is drawn with alpha 0. A record carries no chandelier id; the nearest of the five centres
  (from the cinematic package) decides, the chandeliers standing at least 5 m apart. Class 4 (the dome's crests, lit by
  LED pin spots) is never hidden. Nothing is boosted: β is 1 in every setting (R1d amendment A1).
- **The lamps' dimming** (an artistic choice). The hall's lamps are LED and keep their colour when dimmed; Blake chose a
  warm-down anyway (spec §4.1, 7 October). Each group's light at drive d is `w[k]c[k] ⊙ tint(d) × output(d) × gain`:
  for `warm` (the default) `output = d^3.4` and `tint` the Planckian colour at `fullCct × d^0.42` over that at
  `fullCct`; for `led`, `output = 10^(3(d − 1))` (the DALI curve) and `tint = 1`. At full level both are exactly this
  package's light; `fullCct` and the per-group `dimming` are cinematic-package values, never constants.
- **The interior shadow.** Each sky body's direct term is multiplied by the interior occluders' shadow map (1 lit,
  0 shadowed, 16 taps), in the multiplier pass, the floor and the skins alike; at 1 every word is unchanged bit for bit.
- **Passes while the light moves.** The multiplier pass and the frame's own passes run every animation frame while the
  light moves (the light director), the draw on screen first; a cached draw that missed a change reruns when it is next
  shown. They run not at all while the light is still. An optional stride (1 by default) interleaves splats over frames.
- **The captured light** is exactly this package's captured setting, with no sheen (its weight is 0 there) and no
  interior shadow; only the crisp lamps and their glow replace the captured glow around the chandeliers.
```

In `docs/engineering/native-splats.md`, add at the end:

```markdown
## The frame composer hook (T-639 R1d)

A relit session with the cinematic package registers one frame composer per renderer
(`registerNativeFrameComposer`, `lib/native-renderer.ts`). When one is registered and the canvas draws at depth 1
(not offscreen), the canvas's main draw goes through it inside `withNativeRenderScope`, so every readiness and
profiling hook still sees it: the composer (`lib/relight/cinematic-composer.ts`) renders the draw into a half-float
MRT target (the displayed colour, the lamps' and the Moon's glow share, the expected depth blended by straight alpha),
adds the energy-conserving design glow and the shafts through the relit display, and every third frame measures the
frame's log-average luminance for the eye (read back asynchronously, one read at a time). View captures go through the
same composer into their own target and measure nothing. Without a relit session no composer is registered and the
canvas draw is I1a's own. The light director reruns the relight passes every frame only while the light moves, the
active draw first (`NativeSplatScene.runRelight({ activeOnly })`); stale draws rerun when they are next activated.
```

In `docs/engineering/cinematic-package.md`, add at the end a dated section "Published package (<date>)" stating, read from the staged manifest (`D:/claude/splats/trades-hall/grand-hall/cinematic/v1/manifest.json`) and Task 1's evidence: the crisp lamps per chandelier, the chandeliers still without them (the bulb table's `not_yet_triangulated`), whether the bake's refit shares were used, the warm-down's `fullCct` and range, and whether the night gains and the eye's anchors are calibrated.

In `tools/relight/README.md`, add to its command list, after `check`, in order: `bulbs` (the crisp lamps from the frontier study's bulb table; R1d Task 1), `occluders` (the interior occluder model; Task 2), `cinematic` (the cinematic package; Task 3), `night-calibration` (after `packages/web/scripts/cinematic-calibrate.mjs`; Task 21), `cinematic-check` (after `cinematic-verify.mjs` and `light-scrub-budget.mjs`; Task 23), each with its one-line purpose, its double run where it makes a data product, and its outputs under `D:/claude/relight/grand-hall/`.

In the day's session log `docs/sessions/<YYYY-MM-DD>.md` (create it if the day has none), add a section "T-639 R1d: the cinematic light" with: the commits (`git log --oneline` of R1d's), each offline product's double run (identical, or the majority), Task 1's coverage and photo check, Task 21's calibration (both stations' r and ΔE00 before and after, any dark group, the eye's anchors and the gate in cd/m²), Task 23's report (every section; the identity's p99 with and without the margin, the glow ratio, the shadow tallies, every budget scenario's p50, p99 and max, and the stride used), the R2 paths, the preview URL, and the open decisions in this plan's self-review. In `docs/state/tasks.md`, update T-639's row: R1d integrated and on the preview, waiting for Blake's judgement; name the evidence folder `D:/claude/relight/grand-hall/evidence/r1d`.

```bash
cd D:/claude/real-hall/repo && git add docs/engineering/relight-package.md docs/engineering/native-splats.md docs/engineering/cinematic-package.md tools/relight/README.md docs/sessions docs/state/tasks.md && git diff --cached --stat && git commit -m "docs(relight): the cinematic light, its package, its checks and where it is published (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and update the PR**

```bash
cd D:/claude/real-hall/repo && git status --short && git push -u origin claude/real-hall && gh pr list --head claude/real-hall --state open
```

R1's PR from this branch is open (one PR for R1, A10). Append to its description with `gh pr edit <number> --body-file <file>` (the current body read with `gh pr view <number> --json body`, the section below added, the file written in the scratch directory) this section, every `<…>` filled from `D:/claude/relight/grand-hall/evidence/r1d/r1d-browser-checks.json`, `light-scrub-budget.json`, `night-calibration.json`, `eye-anchors.json` and `bulbs.json` before the edit; do not edit the PR with any left unfilled:

```markdown
## R1d: cinematic light

The relit Grand Hall now opens at the real hour and moves with it: the true Sun and Moon light it through the window
volumes, the light sweeps the hours as a smooth time-lapse when the clock moves (a time-altitude chart of both
bodies' arcs, draggable, with detents at sunrise, the golden hours, sunset and moonrise), lamps fade and dim warm (an
artistic choice: the lamps are LED), crisp frosted candle lamps stand at the bulbs triangulated from the photographs
in place of the capture's glow, with an energy-conserving glow; the eye adapts to the frame and sees as a dark-adapted
eye only in truly dim light; the chandeliers and pilasters cast soft shadows from both bodies; the windows show the
street opposite, the sky and the Moon's disc; the floor and the gilding carry GGX sheen and soft reflections; faint
dusty shafts; a clutter toggle. Previews only; venviewer.com keeps its hold.

Verification (evidence D:/claude/relight/grand-hall/evidence/r1d on the build PC):
- captured light, with the cinematic light against without, where splats remain: p99 <value> stops with the 48 px margin, <value> without (limit 0.05)
- words: R1a's vectors without the cinematic light, worst <n> code; the CPU twin with it at night, sunny, both bodies and moonlit, worst <n> code, <n> excused (limit 1 code, 2%)
- interior shadows: <decided>/<points> decided, <n> disagreeing (limit 0.5%); glow energy ratio <value> (limit 1 ± 0.03)
- night photographs: station 43 r <value> (captured <value>, needs 0.85), median ΔE00 <value> (captured <value>); station 45 r <value> (captured <value>, needs 0.80), median ΔE00 <value> (captured <value>); night gains <accepted or refused, and why>
- crisp lamps: <n> at chandeliers <list>, <list> not yet triangulated; in the night renders <share> of lamps in view on a bright pixel (controls <share>)
- the eye's anchors: lamp-lit night <value> cd/m² (no night vision), moonlit <value> cd/m²
- frame budget on the RTX 4090 at 1920 × 1080: scrub p99 <value> ms, drag <value>, walk <value>, lamps <value>, both bodies <value> (limit 16.7 ms, no frame over 33.4 ms; stride <n>)
- fallbacks: a missing package stays relit with one warning; ?cinematic=off removes the controls; loading adds no long task

Blake judges the light on the Vercel preview; merge waits for his go-ahead.
```

- [ ] **Step 6: CI, the GPU gate and the preview** (R1b Task 19 Step 7, for R1d)

Run: `cd D:/claude/real-hall/repo && gh pr checks --watch`
Expected: every check green except "GPU performance (required)" waiting for its operator. Run the GPU gate as its operator on this PC within its 25-minute window, exactly as R1b Task 19 Step 7 sets out (`.github/gpu/README.md`, `.github/gpu/PUBLISHING.md`: the request's `sourceCommit`, the source manifest against `trusted.json`, WSL Ubuntu with `pnpm install --frozen-lockfile --prefer-offline`, the `node-compile-cache` deleted, `run-worker.py` holding the GPU lock). A red check is fixed at its cause and pushed again.

Then take the GPU lock (if this fails with `EEXIST`, wait for its owner, as every driver does):

```bash
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({owner:'cinematic preview check (T-639 R1d)',since:new Date().toISOString()}),{flag:'wx'})" D:/claude/visual-firstprinciples-20260928/gpu.lock
```

Open the Vercel preview for the PR (its deployment URL from the Vercel check or `gh pr view --json comments`; previews read R2 directly) and check the changed live flow with the Browser tools at `/room/grand-hall`: the hall loads relit at the real hour (live) with the clock; dragging the clock sweeps the Sun's patches across the floor and the chandeliers' shadows with them, and the detents catch at sunset; "Night, lamps lit" fades the lamps in through amber and shows the crisp candle lamps with their glow and no captured blob around them; "Moonlit night" shows the Moon's disc in a window when it is above the facade opposite, and the hall reads as moonlit; the lamps switch fades rather than switches; the console has no errors. Then close the preview's tab and release the lock:

```bash
node -e "require('fs').rmSync(process.argv[1])" D:/claude/visual-firstprinciples-20260928/gpu.lock
```

Record the preview URL in the session log and the PR. Deployment Protection may require Blake's Vercel login: give him the link, and ask before using any bypass.

- [ ] **Step 7: Hand the preview to Blake, and merge only on his go-ahead**

Send the controller: the preview link, the PR link, Step 5's verification section, any failed check, and the open decisions in this plan's self-review. Merge only after Blake's explicit go-ahead in chat (`gh pr merge --merge`), then confirm production kept its hold, with the Browser tools: `https://venviewer.com/room/grand-hall` shows no splats, makes no request for a relight or cinematic package (a path under `/splats/` containing `/relight/v` or `/cinematic/v`) and has no light control. Update the session log and `docs/state/tasks.md` with the merge commit and the production check (explicit pathspecs, pushed to master through the normal path).

---

## Self-review

**Spec coverage** (`docs/superpowers/specs/2026-10-03-r1-polished-design.md`, with the owner's requirements of 3 and 7 October and the coordinator's updates of 7 October):

| Requirement | Tasks |
|---|---|
| §4.1 live by default at the real hour; the light moving continuously; the displayed time following the chosen time through a critically damped spring, never jumping | 5, 6, 9, 19, 20 |
| §4.1 (amended 7 October, commit 475acd2e) lamps fade, never switch, with a warm-down as they dim, labelled as Blake's artistic choice (the lamps are LED); each group keeps its measured colour at full level; the LED-true curve behind a per-group flag | 3 (`lamps.groups[g].dimming`, `warmDown`), 4, 6, 9, 11, decision 11 |
| §4.2 the sun through the window volumes (R1a/R1b); interior occluders' soft shadow maps recomputed as the sun moves; lamps' shadows baked; the exact sun-bounce basis | 2, 7, 10; A5, A9 |
| §4.3 eye adaptation over one to two seconds, anchored to the calibrated presets; measured on the GPU from the rendered frame (coordinator, 7 October), the baked floor mean only a fallback | 5, 9, 13, 21; decision 4 |
| §4.3 crisp emissive lamps at their measured positions with a restrained energy-conserving bloom; the bulb splats no longer boosted (7 October: at the 83 triangulated bulbs, the glow splats hidden, not boosted) | 1, 3, 7, 8, 11, 13; decision 1; A1 |
| §4.3 the night calibrated to the hall's night photographs; a colour-accuracy measure; no heavy grade, the hall as captured at the captured light | 21, 23; Tasks 9 and 17 (the identity display, no sheen at the captured light) |
| §4.4 GGX sheen from the lamps, the windows and the sun (and the Moon) on the skins and the floor; reflection probes refreshed as the light changes; soft dusty sun shafts | 14, 17, 18 |
| §4.5 the Moon as a light source: its true position and phase by the bake's own cited ephemeris tested against published positions (one ephemeris: R1a's Meeus `moon.py` ported, Horizons-checked), true level with the opposition surge, through the sun's machinery, both bodies counting | A3–A6, A9; 6, 7, 10, 14, 15, 23 (both bodies forced on) |
| §4.5 night vision: a restrained, physically motivated scotopic shift driven by absolute luminance (coordinator: the approved night neither greyed nor blue-shifted) | 5, 16, 21 (the gate); decision 4 |
| §4.5 the night sky in the windows: the Moon's disc at its phase, the sky following the Moon; (coordinator, 7 October) the facade opposite in 55–83% of each view, lit by the same sun and sky and by street lighting at night, the disc only above its roofline; R2's hook | 15 (`WindowViewModel`); decision 9 |
| §4.5 the clock as a crafted object: both bodies' arcs, drag a body or the time, spring physics, detents at sunrise, golden hour, sunset and moonrise, accessible, reduced motion | 19, 20; decision 8 |
| §4.6 60 fps while scrubbing and walking (p99 ≤ 16.7 ms), no dropped frames during light motion, no loading task over 50 ms; passes every frame only while the light moves, amortised if needed | 7 (the active draw first, the stride), 9, 23 (budget, loading); decision 7 |
| §5 one preview at the end | 24; A10 |
| §6 the photo check with colour accuracy, never worse than captured; the captured light within 1/20 stop where splats remain; Blake judges the preview | 21, 23, 24 |
| §7 a missing package falls back; missing bulb positions fall back to the bulb splats, unboosted; phones and WebGL keep the captured hall | 8 (one warning), 1 and 7 (an uncovered chandelier keeps its glow), R1b's predicate; 23 (fallbacks) |
| The clutter toggle (R1d's share of §3's masks) | 20 (R1c's `setToggleHidden`) |
| Coordinator, 7 October: the glare function as an interface, any CIE fit from the text of CIE 135/1-6:1999; spectral rendering an upgrade interface, never a dependency; the frontier study's upgrade points | 13 (`GlareNode`); decision 10; the amendments file's last section |
| Coordinator, 7 October: the centre chandelier was lit for the whole walk though R1a's fit gave it ~0; R1d assumes no lamp weights; lamp colour a package value, never a constant | 3 (per-bulb intensities per unit weight, the refit's shares), 11, 17, 21 (a dark group refused); decision 11; the amendments file's "Interfaces from the bake" |

**Placeholder scan.** No "TBD", "TODO", "similar to Task N" or deferred code remains (`grep -n "TBD\|TODO\|similar to Task\|write it as\|FIXME"` over the parts prints nothing). Three kinds of angle-bracket slot are deliberate and carry their instructions: the session log's `<YYYY-MM-DD>` (the executor's date), Task 24's PR section (each `<…>` filled from named evidence files before the edit, which must not run with any left), and the "Published package (<date>)" note. Where the plan edits R1b or R1c code it quotes the exact line it replaces; Task 0 checks each anchor exists and stops otherwise.

**Type consistency** (names that cross tasks, checked by grep over the parts on 7 October):
- Lamps: `LampDimming`, `dimmedOutput`, `dimmedTint`, `planckRgb`, `warmCct` (Task 4) are what Tasks 6, 16 and 21 import; `LampGroupLight { dimming, gain }` and `LampLight { warmFullCct, groups }` (Task 6) are what Tasks 8, 9 and 21 build; `STEADY_LAMPS` is LED-true with no warm-down temperature. No `LAMP_FULL_CCT`, `lampTint` or `lampOutput` remains.
- Bulbs: the package's `bulbs: { envelope, entries: [{ id, group, chandelier, position, intensity }] }`, `chandeliers: [{ id, centre, crisp }]` and `lamps: { windowRadiance, warmDown, groups, night }` (Task 3) are what Task 8's schema parses into `CinematicData { bulbs, envelope, glow, lamps, … }`; `GlowChandelier`, `CHANDELIER_COUNT`, `glowHidden` and `setGlow` (Task 7) are what Tasks 8, 11 and 22 use. No bulb core, `coreLuminance`, package field `lampIntensity` (Task 17's sheen keeps a local function of that name for its sphere lights), `BULB_CORE_LUMINANCE` or `MAX_BULB_CORES` remains.
- `SkyLight.sheen` (Task 6) is produced by `lightForSky` (1), `capturedLight` (0) and `mixLights` (Task 9), and read by Task 17's mount and Task 22's state.
- `CinematicControls` (Task 21: `holdEye`, `soloLamps`, `still`, `measurement`, `adaptation`, `lightChroma`, `presetDisplay`; Task 22: `state`, `shadowCheck`, `bloomEnergy`, `forceBothBodies`, `setStride`, `scrubTo`) is exactly what the three drivers call.
- The bulb table's ids (`c<chandelier>_b<nn>`) are the ids in `bulbs.json`, the package, the browser's schema (its pattern `^c[0-4]_b\d{2,3}$`) and the bake's refit file.
- The kernel, frame, draw, light-setting, director, relight-debug and sun-shadow tests carry the count changes each task states.

**Verified while planning** (7 October; scratch copies under the session's scratchpad, never the repo; no build, no test suite in the repo, no GPU):
- Python, the plan's own code: `test_bulbs` (12), `test_occluders` (6), `test_cinematic` (16), `test_nightcal` (10) and `test_cinematiccheck` (8) pass, with a stand-in for R1b's `browsercheck`.
- Task 1 on the study's run-A bulb table (`work/bulbs.runA.json`): 83 bulbs placed, no problem; the night photo check 24 of 24 and 21 of 21 bulbs in view on a bright pixel, the controls 1 of 20 and 1 of 19 (the first control design, 0.3 m beside a bulb, hit 75% at station 45 and was replaced).
- Task 3 on R1a's floor light: 0.0348 per `ch_end` bulb and 0.0203 per `ch_centre` bulb per unit weight (equal shares); the warm-down at 3,700.1 K (3,537.4–3,984.7 K), within 30 K of the light study's spectral 3,672 K.
- Task 21 on a synthetic night (a power-law tone curve of slope 0.8, a camera tint, 8-bit renders): the slope recovered as 0.802, the basis adding up within 0.3%, the median ΔE00 from 1.02 to 0.57; CIEDE2000 on seven of Sharma's pairs both ways.
- TypeScript in the scratch harness: `lamp-dimming` (8), `light-motion` (12), `eye` (11) and the Meeus port (8) pass; the candle envelope's area (0.005885 m²) and centroid (0.411 of its height) and three's `LatheGeometry` bounds as Task 11's tests expect.
- `node --check` passes for `cinematic-calibrate.mjs`, `cinematic-verify.mjs` and `light-scrub-budget.mjs`.
- Not run, and stated: every vitest file (the R1b and R1c code they import is not merged), every browser step, every GPU measure. Their numbers are Tasks 21, 23 and 24's to produce.

**Limits, stated rather than designed around:**
- Crisp lamps exist only where the study has triangulated bulbs (chandeliers 0 and 2 in its first table; 1, 3 and 4 pending, about a minute of CPU each). Until then those chandeliers keep their glow splats, unboosted, and shine in the sheen as spheres at their centres; the hall mixes crisp and captured chandeliers.
- The captured-light identity is judged outside a 48 px margin around the fixtures, because the crisp lamps' glow replaces the captured glow there; the 99th percentile is also reported without the margin.
- The night gains only move light and colour between lamp groups (the camera's exposure and white balance cancel by construction); the lamps' absolute colour stays the bake's, which is a package value and the bake's refit to improve.
- The warm-down's starting temperature comes from the capture's lamp/daylight colour against CIE daylight D65; the daylight the ratio was measured against is uncertain (D60–D75 gives 3,540–3,990 K), and it shapes only how the colour warms.
- The LED-true curve is the DALI logarithmic curve, assumed: the hall's dimming system is "multi-channel programmable" (the contractor's record), not known to be DALI.
- The interior shadow's CPU twin is a hard edge; the DEV checks compare only where the GPU's taps agree and excuse penumbra splats in the word check.
- Eye adaptation's absolute luminance rests on k_abs ≈ 54 cd/m² per fit unit (±1 stop, the light study's estimate); Task 21's gate reports a miss and never tunes it away.

**Open decisions** (for Blake or the controller; R1d proceeds on the stated default):
1. Lamps automatic below a 7° Sun (about an hour before sunset).
2. The clutter hidden and the AV cabinet shown by default (R1c's `defaultHidden`).
3. The crisp lamp: a frosted candle envelope 35 mm across and 70 mm tall (a C35 candle) until the venue names its lamp; the glass's albedo 0.6; the glow share `BLOOM_SHARE` 4%.
4. The glow splats are hidden by record class (class 3, 48–59% of each chandelier's splats); a finer, photo-tuned halo flag from the bake would replace the class rule.
5. Every group dims warm (Blake's artistic choice); `led` per group on request, a package value.
6. The bake's house-light refit (the centre chandelier's attribution, per-bulb intensities): its owner and timing; until then equal shares, and the calibration refuses a dark group.
7. Chandeliers 1, 3 and 4: triangulate them before the preview (minutes of CPU) or show the mix.
8. The probes reflect the floor and the skins only, not the splats (decision 5).
9. The shafts' density (σ_s 0.012, g 0.6) and the dust; the night tint (CIE xy 0.25, 0.25) and `SCOTOPIC_MAX` 0.6, design values pending the frontier study's mesopic model.
10. The moonlit preset's date and display key (A7).
11. A day Moon's light below 1/100,000 of the day's is not marched (`MOON_NEGLIGIBLE`), though its disc shows; Task 23 measures the cost with both bodies forced on, so keeping it is a switch.
12. The facade opposite: albedo 0.3, street lighting about 1 cd/m², `FACADE_SKY_VIEW` 0.35, all assumed (the evening Matterport stations can measure the street light).
13. The design glow is not the CIE disability glare function; a fit takes its formula from the text of CIE 135/1-6:1999.
14. The floor's roughness 0.3 and gilding's kept diffuse share (`METAL_DIFFUSE_SCALE` 0.5).
15. k_abs 54 cd/m² per unit, ±1 stop.
16. The stride stays 1 unless Task 23's budget needs 2.
17. Ownership of A9's bounce-basis revision between R1a and R1d.
18. The night calibration's ridge (0.1 of the normal matrix's mean diagonal), a regularisation choice.
