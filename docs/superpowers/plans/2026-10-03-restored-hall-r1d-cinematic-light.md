# The Restored Hall — R1d "Cinematic light" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revisions (8 October, pre-flight).** This plan was revised on 8 October after two pre-flight scans (`D:/claude/real-hall/plan-amendments-0710/scans/r1d-a-scan.md` for the header and Tasks 0–9, `r1d-b-scan.md` for Tasks 10–24), the seam review's list for R1d (`review/seam-B-findings.md`), the fix-wave re-review's N2 and the controller's rulings of 8 October (`scans/rulings-0810.md`). Each id below is fixed where named, or carries a written ruling. The plan's code was re-run in scratch copies (the Self-review's "Verified while planning").
>
> - **Rulings.** L1 (the 140 high- and medium-confidence lamps; low and exclude are `notLamps`): decision 1, Task 0 Step 1, Task 1 (code, tests, Step 6), Task 3, Task 24's package note, the Self-review. L2 (the centre chandelier's 7 crown tubes, kind `crown`, at `wCrown` of a candle's share, with their own smaller envelope): Tasks 1, 3 (`ENVELOPES`), 8 (`kind`, `envelopes`), 11 (one mesh per group and kind) and 17 (sphere radius by kind). L3 (each group's warm-down starts from its own colour): decision 11, Tasks 3 (`lamps.warmDown.groups`), 6 (`LampGroupLight.warmFullCct`), 8, 9, 16 and 21. N2 (penumbra excuses counted apart; R1b's window and floor excuses keep the wall-face rate): Tasks 22 (`excusedPenumbra`, each confirmed by its splat's own GPU taps since round 3) and 23 (`words_verdict(checks, rate)`), Task 24's PR text. E1 (the fallback eye never runs the CPU twin per frame): Task 9 (`readSkyLight`, at most every 250 ms while the light moves, once at rest) and Task 11 (the glass's ambient on the GPU).
> - **Scan A, blocking.** B1 (commands registered after the main guard): Tasks 1–3, now registered directly above it. B2 (all 173 entries crisp): Tasks 1 and 3, with L1 and the refit required. B3 (`visibility` against R1b's `v`): Task 7's anchors and replacement. B4 (the removed sunlit-area table): Task 7's test.
> - **Scan A, important.** I1: Task 1 (the crown kind), with L2. I2: Tasks 3, 6 and 8, with L3. I3: Task 9, with E1. I4 (stale table, share and anchor text): decisions 1 and 11, Task 0, the Self-review (open decisions 6, 7 and 17 settled) and the amendments file's status note. I5 (Task 0 Step 2's patterns): Task 0 Step 2.
> - **Scan A, minor.** M1: decision 4. M2: Task 1 Step 5 (R1a's `paths.emitters` used, the config not edited). M3: the R1b line references in Tasks 0–9 re-read. M4 (the shares in the light's own units), ruling: kept on purpose, with the reason in Task 6's prose (the shares only mix the eye's anchors, and `MOON_NEGLIGIBLE` sits about two orders below a visible change; wording corrected in round 3). M5: Task 7 (`setDisplay` writes through R1b's `writeDisplay`). M6: Task 9's prose and `mixLights`' doc comment (a counted second body is between 1/100,000 and about 1/1,000 of the light and is dropped while a blend runs). M7: Tasks 1–3 write only on success and record each artifact's SHA-256, and the manifest records the bulb table's (`bulbs.tableSha256`); the package's `files` are exactly its occluders. M8: decision 4 and Task 21's gate. M9, ruling, not applied: R1b owns `prepare` and did not take the optional skip; Task 23 measures the sky passes' GPU time while the light moves, so their cost during a lamp fade is judged, not assumed. M10: Task 3's contract text. M11: Task 6 Step 6 (the control's doc comment).
> - **Scan B, blocking.** B1: Task 10 (`CinematicHooksProvider` around the scene and R1c's skins; `RelightProvider-cinematic.test.tsx`). B2: Task 11's test. B3: Task 15's test. B4: Task 16's test 3. B5: Task 7's `setDisplay` (the held eye reaches `frame.current.display`). B6: Task 15. B7: Tasks 21 and 24 (`node --check` for the drivers). B8: Task 20. B9: Tasks 10 and 18. B10: Tasks 11 and 15. B11 and B12: Task 20. B13: Task 22. B14: Tasks 22 and 23, with N2. B15: Tasks 9 and 10 (the cinematic light loads lazily behind its gate) and Task 24 Step 2 (its grep unchanged). B16: Task 24 Steps 5 and 6 (the PR opened there; the GPU gate's procedure written out).
> - **Scan B, important.** I1: Task 17 (F0 from R1c's `specularColour`). I2: Task 11. I3 and I4: Task 18. I5: Task 13 (the fragment's own window depth, `FragmentDepthNode`); ruling on the suggested `perspectiveDepthToViewZ(depth, …)`: not used, because three's `depth` node is built from `positionView`, the quad corner's. I6: Tasks 13, 14, 15 and 17. I7: Task 15. I8: Tasks 22 (`passTimes`) and 23 (`gpu_time_verdict`). I9: Tasks 8, 10, 11, 13–15, 17 and 18 (`CINEMATIC_SPANS`) and 23. I10: Tasks 13 and 21 (`measureNext`). I11: Tasks 3, 8 and 21, with L3. I12: Task 16 (with Task 9's identity test and R1b's provider test line). I13: with L1 above. I14: with L2 above. I15: decision 5 and Task 17. I16: Task 24 Step 1. I17: Task 14.
> - **Scan B, minor.** M1: Task 10. M2: Task 14's Interfaces and text. M3: Task 15 (the solid angle named, the clamp branch zeroing the sky, the facade lit by its slot's own body; the gradient a design choice, ruled in the text). M4: Task 16. M5: Task 20. M6: Task 22. M7: Task 13 (the composite keeps the output's alpha; the measure divides out the white balance; the roll-off cancels in the anchored eye, ruled in the text). M8: File Structure and Task order. M9: decision 9. M10: Contracts. M11: Task 23. M12: Task 21. M13, ruling: cosmetic, accepted in Task 13's text.
> - **Seam review, for R1d.** 1: Task 17, with scan B I1. 2: Contracts item 4 and the amendments file's status note. 3: decision 11, Task 3 and the amendments file's status note. 4 and 5: the amendments file's status note. 6: open decision 17 settled. 7: Task 22 (R1b's `sample` already asks `gpuKernel()`).
> - **Re-review N2 (R1d's side).** Task 23 (the vectors' `wallFaceRate` passed through; the stale "2%" gone), with ruling N2.
> - **The controller's interface note of 8 October.** R1a's `bulb-intensities.json` (`wCrown`, `bulbs: {id: {kind, intensity}}`, `fit.notLamps`, `fit.tableSha256`): Task 3. R1b's `skyLightFor` keeping a body's first CPU light: Task 9 (`readSkyLight`). R1a's `wallFaceRate`: Task 23. R1b's corrected `timedCompute`: Task 22.
> - **Found while re-running the code** (not in the scans): an excess-property type error in Task 8's test, never-read state in Tasks 9 and 13, Task 11's attribute and bounding-box types and a lint error in its test, `ivec2`/`uvec3` argument types in Tasks 13 and 14, an unused import in Task 15, and a `renderTarget` assignment in Task 18 that does not typecheck. Each is fixed and re-checked.
>
> **Round 3 (8 October), after the scoped re-review (`review/fix2-rereview-d.md`) and the light frontier results (`D:/claude/real-hall/frontier/light/proposal.md` §e).**
>
> - **NB1** (Task 23's driver hung after `gpuTime`, holding the GPU lock; Task 21's after `?light=night`): the director's DEV `reapply` and the controls' director-aware `select` and `reapply` (Task 21); the drivers select through them, hand the light back after `gpuTime` with `reapply`, bound every wait in the page (`within`) and close the browser after a run limit, so a hung run fails and frees the lock (Tasks 21 and 23); +1 director test. **NB2**: Task 3 (`write_package` refuses a stray file before writing; `cmd_cinematic` records the refusal). **NB3**: Task 21 (`measureNext` gives up after `MEASURE_FRAME_LIMIT` frames or when the director stops). **NB4** (the M4 wording): Task 6's prose (about two orders; only the beams would need the GPU). **NB5**: Task 24 Step 6 (`gh run download` into a fresh request folder; Node 22.23.2). **N2 per splat**: Tasks 22 and 23 (a penumbra excuse needs its splat's own GPU taps to be fractional; no cap factor; open decision 19 settled). **M3 residual**: Task 4's R1b references (2072–2075, 5457–5468). **L3 residual**: the Self-review's warm-down limit, per group. **M10 nit**: the relight-package text Task 24 writes ("horizontally"; each group's own `fullCct`). **Out of scope 3**: Task 13 builds its glow once, so a rebuilt composite no longer leaks bloom targets.
> - **Task 24's delivery gaps**: Step 5 checks release ownership before the push; Step 6 confirms the preview's deployed commit is the pushed head; Step 7 names the exact tested commit; Step 5's PR section carries one list for Blake.
> - **Light frontier results**: k_abs 121.8 measured (decisions 3, 4, 10; Tasks 5, 15, 16, 21; the levels 21 and 16 cd/m², the margin 0.8–1.6 stops, Task 21's gate at 8.7–11.4, the city's weight 2.26 times lower); `SCOTOPIC_LUMINANCE` 0.1, following Cao's rod gains (decision 4, Task 5); the Sun's and the Moon's beams by elevation and the blue hour in xy (decision 2; Task 6's new `sky-colour.ts`, asked for by the director with its package, Task 9; the Moon's disc, Task 15); the window views (`CITY_CCT` 3,830 K, `FACADE_SKY_VIEW` 0.24, the facade's daytime 0.018: decision 9, Task 15); the glare (the fitted pyramid as `?glare=cie`, the design glow the default: decision 6, Tasks 11, 13, 15, 22); `CHROMA_ADAPTATION` 0.6 kept with 0.74 recorded, the warm-down's colour cost recorded, R1d's night chain kept (Tasks 4, 5, 16); the moonlit preset on 23 December 2026, 23:50 GMT (Task 6); Task 21's RGB measure, its expected 3.5 ΔE00 residual and station 45's margin (Task 21; Task 24's PR line); the 3,700 K start confirmed and per group (the Self-review's limit). Every item for Blake is in Task 24's list.
>
> **Round 4 (8 October), after the final re-review (`review/final-rereview-d.md`).**
>
> - **M1** (a started frame-budget sample rejecting first ended Node with the GPU lock held): one lock module for every driver, `packages/web/scripts/gpu-lock.mjs` (Task 21 Step 6), frees the lock on a normal end, an uncaught exception or rejection, SIGINT, SIGTERM, SIGHUP, SIGBREAK and `process.exit`; the three drivers take it with `holdGpuLock`, the frame budget handles its started samples, and the watchdog's close is caught. `gpu-lock-check.mjs` proves the ten exit paths, each in its own process against a temporary lock (Task 21 Steps 6–7, Task 23 Step 7, Task 24 Step 1; the Global Constraints, the File Structure). Run 8 October: 10 of 10; with the module's handlers removed, 2 of 10.
> - **M2** (the moonlit preset 2.4 × 10⁻⁴ off R1b's Moon): the Moon table's top row now sits at the study's own elevation for its 4,248 K, 60.7575° (`evidence/d2_sky_scenes.json`), which is the moonlit preset's Moon (60.75755° by R1b's port, without the study's 30 m of height), so the preset keeps R1b's Moon exactly (Task 6: the table, its prose and comments, the sky-colour and light-setting tests).
> - **M3** (R1b references one low after R1b's new line 35): re-anchored, 192 numbers on 18 lines, each single-line reference's text re-read in R1b.
> - **M4**: Task 23's Consumes no longer names `penumbraMarched`.
> - **M5** (`?glare=cie` never run): Task 23's driver draws the night stations under `?glare=cie` and records its glare, energy and console; Task 22's state names the glare in use; `cinematiccheck.py` sets each station's two glows side by side (`renders/R1d_glare_compare`) and judges the page (`glareCie`); Task 24's PR line and Step 6's look at the preview; the Self-review's limit states the overshoot below 6.5 px per degree.
> - **M6** (the scotopic ramp): shaped by the study's d3 table of Cao's rod gains (a tenth of the way at 0.62 cd/m², all of it by 0.1), its zero held at 5 cd/m² so the approved night keeps none, within 0.025 of Cao's share everywhere (decision 4; Task 5's code, tests, prose and Verified line; the spec row; open decision 9; Blake's list). `NIGHT_TINT` and `SCOTOPIC_MAX` 0.6 stay design values.
> - **M7**: Task 24's list holds every open decision that is Blake's (1–5, 8–15 and 20–22, the bulb table's unresolved entries and the merge); open decision 23 says where the others go.
> - **The relight-debug edits' check, kept**: strict `tsc` and the repo's ESLint on R1b's `relight-debug.ts` with Tasks 21 and 22 applied from this file (the Self-review's verification list).
>
> **Revision (11 October, R1a Task 5 fix round 2).** R1b's `ProbeField` gains its lookup `box`, and `trilinearCorners` reads the probes as the proof did: the position clamped into that box first. Task 11's `ambientAt` test builds its field with `box: OPEN_BOX`. Nothing else here builds a `ProbeField`: `ambientAt` and `bounceNode` read R1b's fields, which carry the manifest's box.

**Goal:** On development and preview builds, a desktop WebGPU visitor sees the relit Grand Hall live at the real hour by default, lit by the true Sun and the true Moon, sweeping through the hours as a smooth critically damped time-lapse when the clock moves (a crafted clock that shows both bodies' arcs and lets you drag either, or the hour), with lamps that fade and dim warm (Blake's artistic choice: the lamps are LED), eye adaptation with night vision, crisp frosted lamps (candles, and the centre chandelier's crown tubes) at their triangulated positions in place of the chandeliers' captured glow with a restrained energy-conserving bloom, soft interior shadows from both bodies, the street opposite, the sky and the Moon's disc in the windows with the city's light at night, GGX sheen and soft reflections, faint dusty shafts and a clutter toggle, at 60 fps (p99 frame ≤ 16.7 ms) on the RTX 4090 while scrubbing, dragging and walking; anything missing falls back as the spec says, and venviewer.com keeps the founder hold.

**Architecture:** R1d extends R1b's relit browser and never builds a parallel one. The Moon joins the Sun in R1b's light setting and kernel through amendments A3–A5 (its true position, phase and light; the same window march, gates and bounce), so every R1d system treats "the sky bodies" alike. One `LightDirector` (created by R1b's provider, one per relight frame) steps the repo's single spring core (`lib/springs.ts`, `stepSpring`) for the displayed day and minutes, each lamp group's drive, a blend and the eye; while the light moves it applies a new `RelightApplication` to R1b's `RelightFrame` every animation frame (R1b's passes rerun through `NativeSplatScene.runRelight`, the active draw first), and while it is still it runs nothing. The kernel (R1b's `relight-kernel.ts` and `relight-draw.ts`) hides the chandeliers' captured glow where crisp lamps are drawn and gains an interior shadow per sky body and an amortising stride; an offline step in `tools/relight` places the bulbs from the triangulated emitter table and builds the simplified occluder model, the bulbs' intensities and the lamps' dimming into a small `venviewer.cinematic.v1` package beside the relight package. A registered frame composer renders the main canvas draw into an MRT target (colour, emission, expected depth) and adds the bloom and the shafts; the shadow maps, the night sky, the scotopic display, the GGX sheen and box-projected reflection probes plug into R1b's floor, sky panels and display and R1c's skin hooks; the clock is a time–altitude chart driven through the same springs. Spec: `docs/superpowers/specs/2026-10-03-r1-polished-design.md` §4 (and §6, §7, §8), parent `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md`; the amendments R1d needs in R1a and R1b: `docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md`.

**Tech Stack:** React 18.3 + @react-three/fiber 8.18, three 0.186 (WebGPURenderer, TSL, compute, MRT, pnpm patch), Zod 3.24, zustand 5.0, Vitest 4.1 + happy-dom 20, TypeScript 5.7, pnpm 9.15.4, Node 22, Playwright 1.59 (headed Chromium on the RTX 4090), Python 3.13 (`C:/Python313/python.exe`, numpy 2.4, scipy 1.17, Pillow 12, `unittest`) in `tools/relight`.

## Global Constraints

- Work only in the worktree `D:/claude/real-hall/repo`, branch `claude/real-hall`. Never edit `C:/Users/blake/omnitwin2` or another worktree.
- R1d starts only when R1a, R1b and R1c are merged into `claude/real-hall` with every amendment in `docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md` applied. Task 0 checks the anchors this plan edits and the R1c interface; a mismatch is reported to the controller, never designed around.
- Commit with explicit pathspecs only; inspect `git diff --cached --stat` before each commit; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Founder hold (19 September 2026, amended 28 September 2026): splats, the relit hall, the cinematic effects and the light control exist only where `gaussianSplatsAvailable()` is true (development and Vercel preview builds, never a venviewer.com host). No query, saved state or role may override it; `?light=`, `?relight=off`, `?cinematic=off`, `?skins=off`, `?floorskin=v1` and `?glare=cie` are honoured only where it is true.
- TypeScript strict: no `any`, no `as unknown as`, `import type` for types, `noUncheckedIndexedAccess` respected, the repo's `strictTypeChecked` lint (`strict-boolean-expressions`, `no-unnecessary-condition`, `prefer-readonly`, `no-floating-promises`). No new `console` call in app code: fallbacks warn once through R1b's `warnRelightFallback(kind, message, cause?)` (`lib/relight/relight-warning.ts`). If TypeScript rejects a TSL type annotation in a plan code block, change the annotation only, never the node graph.
- Tests: `pnpm --filter @omnitwin/web exec vitest run <path relative to packages/web>`, one file per command, in the foreground. Python: from `tools/relight`, `C:/Python313/python.exe -m unittest tests.<module> -v`.
- All visible loading and working states use `packages/web/src/components/shared/Activity.tsx` (`.claude/conventions/loading-and-working-motion.md`); never attach an Activity indicator to the Three.js frame loop. The light control follows `.claude/conventions/product-experience.md`: quiet colour-change hovers, a small press-down, a visible focus ring, plain factual words, WCAG AA.
- The one spring core: every time-lapse, lamp fade, light blend and eye adaptation steps `stepSpring(state, target, dtSeconds, config)` from `packages/web/src/lib/springs.ts`; no other easing, tween or CSS animation drives light.
- Reduced motion (`prefers-reduced-motion: reduce`, `lib/reduced-motion.ts`): the sun never sweeps. A changed time or date cross-fades the light over the blend spring instead; lamps still fade (a change of brightness, not motion), exposure still adapts, and the dust stops drifting.
- Build-PC GPU rule: one GPU-heavy job at a time. Every browser render or benchmark holds `D:/claude/visual-firstprinciples-20260928/gpu.lock`, a JSON file `{"owner":"<name>","since":"<ISO time>"}` created exclusively (`wx`) and deleted afterwards; if another owner holds it (the T-644 performance session uses it), wait. R1d's drivers take it through `packages/web/scripts/gpu-lock.mjs` (Task 21), which frees it on every way a run can end; `node scripts/gpu-lock-check.mjs` proves each. Render on demand, never a spinning loop. Keep heavy work out of any quiet window the controller announces for the benchmark session.
- The build PC corrupts some heavy computations silently: every offline data product (Tasks 1, 2, 3 and 21) runs twice in separate processes, and the two outputs must be byte-identical (JSON compared parsed). On a mismatch a third run decides by majority; the evidence records every run.
- Outputs go to D: (`D:/claude/relight/grand-hall/…`; the staged packages under `D:/claude/splats/trades-hall/grand-hall/`). Inputs are read-only: `D:/claude/splats/**` (served in development through `SPLAT_STAGING_ROOT=D:\claude\splats`; previews read the public R2 bucket `https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats` directly), `D:/claude/real-hall/renovation/**`, `F:/**`.
- Spec numbers, verbatim (R1 polished §4.5, §6, §7): "60 fps while scrubbing the clock and while walking (p99 frame ≤ 16.7 ms), no dropped frames during light motion, no main-thread task over 50 ms while loading"; the per-splat multiplier pass and the skins' sun pass "run every frame while the light moves (amortised across frames if needed), and not at all while it is still"; eye adaptation "over one to two seconds to the scene's light, anchored to the calibrated presets"; the night photo check keeps "a correlation of at least 0.80 at station 45 and 0.85 at station 43", "never worse than the hall as captured", plus a colour-accuracy measure, also never worse than the hall as captured; "at the captured light, the hall matches the captured hall (within 1/20 of a stop where splats remain)"; "missing bulb positions fall back to the bulb splats, unboosted"; "the clutter toggle never leaves a hole"; "phones and the WebGL fallback keep the captured hall until R4".
- The Moon (the owner's requirement of 3 October, verbatim in substance): its true position from a cited ephemeris tested against published positions for Glasgow (amendment A3); "about 0.1–0.3 lux at full moon high in the sky, with a phase function including the opposition surge"; "physically slightly warmer than the sun"; a scotopic shift in the display "physically motivated and restrained"; it "goes through the same machinery as the sun: window-volume march, shadow map, bounce basis, shafts"; "when both bodies are up (a day moon), both count, within the 16.7 ms budget"; the night sky in the window panels shows "the moon's disc when it is in view, at its true phase, with the sky's brightness following the moon", keeping the hook for R2's real sky; the clock "shows the sun's and the moon's arcs for the chosen date, and lets you drag either body or the time directly", with "gentle detents at sunrise, golden hour, sunset and moonrise", "beautiful at rest and fully keyboard and screen-reader accessible", and "keeps 60 fps while dragging on the RTX 4090".
- Relighting stays WebGPU-only and desktop-class only, decided by R1b's one predicate `nativeRelightSupported`; every R1d effect exists only inside a relit session (the provider's frame is not null) and only with `?cinematic=off` absent.
- The display rule (R1b decision 3) holds: every relit surface ends in R1b's `displayNode(rgb, frame.uniforms.display, knee)`; R1d adds no tone curve. Light that R1d adds in the composer (bulb glow, shafts) is composed in linear light and passes through the same roll-off with the floor's knee, 0.8.
- The multiplier stays normative in the R1a plan's section "The multiplier" as amended (β = 1 for every preset; lamp tints). R1d's additions to the kernel (glow hiding, clutter groups, the interior sun shadow) are inactive when their data is absent, so R1a's test vectors keep passing unchanged.
- The shared patch: R1d does not edit `patches/three@0.186.0.patch`. T-640 was renamed T-644 (the performance loop); its patch is on master before R1d starts (Task 0 checks).

## Decisions this plan takes (with the evidence)

1. **The chandeliers' captured glow is hidden where crisp lamps are drawn; nothing is boosted.** Measured by the frontier splats study (`D:/claude/real-hall/frontier/splats/proposal.md` §0, §b1, §d6.0, 7 October): its bulb table holds 173 entries over all five chandeliers, triangulated from clipped blobs in the E57 photographs to 3.0–4.3 mm (each chandelier's p50 ray residual), each read by eye with a confidence; the lamps are the 140 `high` and `medium` entries, 26, 22, 47, 23 and 22 for chandeliers 0–4 (the controller's ruling L1 of 8 October, one lamp set for R1a and R1d; the 6 `low` and 27 `exclude` entries are not lamps), and the centre chandelier's 7 `medium` crown tubes are a smaller lamp kind of their own (ruling L2); the vendor splats register to them within 7–15 mm (p50), and the chandeliers did not move between stations; the emitter class (class 3: inside a chandelier's volume and brighter than 0.30) is 48–59% of each chandelier's splats and is glow, the capture's bloom of the bulbs; the chandeliers are polished, cast and gilt brass scrollwork with frosted or opal candle lamps and no crystal prisms (inspected at 1.5 mm/px; the light study §b9 found the envelopes frosted, glowing evenly with no filament visible). The 3 October reading of class 3 as mostly crystals is withdrawn. So Task 1 places the crisp lamps at the triangulated positions, Task 11 draws each as a small frosted envelope of even luminance (a candle, or a smaller tube for a crown lamp), and while they draw the kernel gives alpha 0 to every class-3 splat of a chandelier that has crisp lamps (Task 7: the record's class, and the nearest chandelier centre, since a record carries no chandelier id). A chandelier the table does not yet cover keeps its glow splats as captured, unboosted (spec §7: missing bulb positions fall back to the bulb splats). Nothing is boosted (β = 1, A1). The dome's class-4 "emitters" are its 14 gilt crests lit by LED pin spots (the contractor's record, light study §b9): lit surfaces, not lamps, so they get no crisp primitive, are neither hidden nor boosted and follow the dome group's level. Without the cinematic package nothing is hidden. A finer, photo-tuned halo flag (the splats study's §c5) is open: it would be a bake output read by the same hiding rule.
2. **The Moon is a second sky body through the Sun's machinery, with the bake's own ephemeris** (the owner's requirement of 3 October; one lunar ephemeris, the coordinator's direction of 7 October). Its position is R1a's `moon.py` (Meeus ch. 47 in full) ported line for line to TypeScript (amendment A3: the two agree to 7×10⁻¹⁴°, and both stand within 3.4″ of JPL Horizons over Glasgow in the cases tested; R1a's review found median 2″, worst 15″ over 2020–2038), its phase from the same NOAA Sun the hall uses, its illuminance by Krisciunas & Schaefer with a restrained opposition surge (about 0.3 lux at full Moon high), its colour about 4,100 K high in the sky, reddening toward the horizon (2,920 K at 7.5°: the frontier light study's §e d2, 8 October; Task 6). The light setting and the kernel carry it beside the Sun (A4, A5): the same window march, gates and glass, its own floor grid, and the sky-body bounce basis (A6, A9). R1d adds its shadow map, its shafts and its disc in the windows. A Moon whose light is below 1/100,000 of the day's and the lamps' is not marched (it cannot move a displayed pixel by a tenth of a code), so a day Moon's light costs nothing while its disc still shows; Task 23 measures the frame budget with both bodies forced on, so a day Moon's light would fit if Blake wants it kept.
3. **Moonlight is visible only when the lamps are dimmer than it, and the city is always there at night.** Under lit chandeliers (the lamp-lit night is about 16 cd/m², tens of lux on the floor) a full Moon's 0.3 lux is lost, so the control has a lamps switch (automatic, on, off) beside the presets, and the "Moonlit night" preset (A7) has every lamp off. Live time's automatic lamps fade up while the Sun is below 7° (about an hour before sunset in Glasgow) and fade out above it. At night the street-lit facade across Glassford Street (about 1 cd/m², filling 55–83% of each window's view; the frontier light study, `D:/claude/real-hall/frontier/light/proposal.md` §b3) lights the hall through the windows at some 0.03–0.1 lux mid-hall, so a full Moon's patch on the floor is only 1–3× its surroundings: R1d adds that city light (Task 15's weights, Task 6's `cityLevel`). Weather joins in R2.
4. **The eye adapts to the rendered frame, measured on the GPU, around calibrated anchors, and sees as a dark-adapted eye does only where the light is truly dim.** Every third frame a compute pass reduces the composed frame to its log-average luminance (64 × 36 samples) and reads it back asynchronously (Task 13); the exposure is divided out, so it is the scene's luminance. The target display mixes three anchors by each one's share of the light (the sunny day, the lamp-lit night, the moonlit night: Task 21 measures each anchor's display and its reference view's luminance), each corrected by half the difference between its luminance and the frame's (an eye never adapts fully; R1b's `adaptDisplay` uses the same half) and 60% of the difference in the light's colour (read from the light, never the frame, so the night tint cannot feed back), within eightfold of the anchors; only the approach is a spring (toward brighter in about one second, toward darker in about two: adaptation, time-compressed, never physiological timing). The captured light is held at exactly the identity display. The baked floor mean (R1b's `adaptDisplay`) is only the fallback: before the anchors are calibrated, and in a relit session without the cinematic package (R1a Task 4's floor-mean basis as built: median error 9.3%, at most 34% on the selection set; 10.0% and 73% on the check set, the largest at faint directions). The fallback never runs the CPU twin's sky march for a light change (the controller's ruling E1): it reads the GPU's sky light back asynchronously, at most four times a second (Task 9). Absolute luminance comes from the capture's calibration, 121.8 cd/m² per fit unit (the frontier study's k_abs, measured from the capture day's modelled sky by its pre-registered method: §e d2, 8 October, double-run and identical; ±1 stop, and it depends on the sky's shape), which puts the captured hall at about 21 cd/m² and the lamp-lit night at about 16 (the study's §b4 estimate of 54, which gave 9 and 7, is withdrawn: it fell 1.17 stops low). The scotopic shift (Task 16: Thompson, Shirley & Ferwerda 2002, scotopic luminance V = Y[1.33(1 + (Y + Z)/X) − 1.68] with a blue shift) is therefore driven only by absolute luminance: nothing at or above 5 cd/m², then shaped by Cao's rod gains as the study's d3 tabulates them (a tenth of their maximum at 0.62 cd/m², all of it by 0.1, interpolated in log luminance), so 7.7% of the full 60% at 1 cd/m² (Cao's 8.3%) and all of it by 0.1, for dimmed lamps, the blue hour without lamps and moonlight. Cao's gains reach zero at 10 cd/m²; R1d holds the zero at 5, so the approved night keeps exactly none, at a cost of at most 2.5% of the full shift against Cao's share (at 5 cd/m²). The approved night stays neither greyed nor blue-shifted with a margin of 0.8–1.6 stops (d3's log-average interior luminance of the proof's night, 8.7–11.4 cd/m², and the median 16, against 5) inside k_abs's ±1 stop (one stop low would give the darkest view a 2% mix); Task 21's gate measures it at the calibrated night anchor and requires no shift there; a miss is reported, never tuned away. R1d's night chain stays: the study's own mesopic chain (Cao's rod gains with CIECAM16 adaptation) is not recommended by its d3 (it turns 1% lamps strongly blue and renders the lamp-free blue hour cream).
5. **Reflection probes render the relit meshes, not the splats.** A splat draw is instancing-bound (T-640/T-644 measured it), so a cube face of the hall's splats costs about a whole frame, and the probes must refresh while the light moves. The probes draw the restored floor and the skins (R1c), which carry almost all of the hall's large reflected surfaces, in linear light; the bright emitters (the Sun, the Moon, the lamps, the windows) reflect analytically through the GGX sheen instead, so nothing is counted twice. The 3D ornament that stays splats is absent from the soft reflections by design; Blake judges the result. No splat gets a specular term: the splats study found a measured per-splat specular unsupported (§d6, §0 "Recommendation" 3, §e), so nothing in R1d claims one. An optional designed brass and gilt sheen on the splats would use one shared broad roughness per material (α ≥ 0.2), be labelled "designed" in the provenance view and be judged by Blake (an open decision). The skins' gilt sheen is itself a designed prior until the materials track's measured layer is imported: R1c's `GILT_ROUGHNESS` (perceptual 0.40, α 0.16) and `GOLD_F0` (gold leaf's F0 from its optical constants) are priors, and R1d reports them as such wherever it shows the gilt's provenance.
6. **Bloom and shafts need the main draw in a render target.** Splats write no depth and are blended, so a glow or a shaft drawn over the canvas cannot be occluded correctly. A registered frame composer (Task 12) draws the main canvas render into three's MRT target (colour, emission and expected depth, the last two blended by every splat's alpha exactly as its colour is) inside R1b's existing canvas render scope, so every readiness and profiling hook still sees the main draw. Without a relit session the composer is never registered and the canvas draw is I1a's own. The bloom is a restrained, energy-conserving design glow (a small share of each bulb's light moved from its core into the halo, never added); it is not presented as the CIE disability glare function. The frontier study fitted that function's pyramid (§e d3, 8 October: CIE 135/1-6:1999 at age 40 as eleven Gaussians, σ = 0.5·2ⁱ px at 11.25 px per degree, within 0.8% of its encircled energy; 9% of a lamp's light beyond 1°, 63% spread in all). R1d takes the glow as one replaceable function of the emission (the composer's `glare`, a `Glare`, Task 13): the restrained design glow by default, as Blake asked, and the fitted CIE glare as an option at the preview (`?glare=cie`) for Blake to judge; either takes its share of each emitter's light, so the light is moved, never added.
7. **Per-frame passes are kept affordable** by four measures, in this order: the floor's base light moves to the GPU (A2); while the light moves only the active draw's multiplier pass runs and the others rerun when they become active (Task 7); R1b's early-out remedy (non-reach and non-entering splats skip the march); and, only if Task 23's measurement needs it, the pass is amortised over two frames by interleaved halves (`passStride`, Task 7) whose last phases complete after the light settles, so every splat ends exactly at the final light.
8. **The clock is a time–altitude chart**, the astronomer's classic: the hours run left to right, the Sun's and the Moon's arcs for the chosen date rise and set across a horizon line with the twilight bands beneath it, and the displayed instant is a vertical line where both bodies stand. Dragging a body along its arc, or the line itself, moves the time through the spring core, with gentle detents at sunrise, the golden hours, sunset, moonrise and moonset; slider semantics keep it fully keyboard and screen-reader accessible.
9. **The windows show the street, not an open sky** (the frontier study, §b3). Only 17–45% of each window's view is sky (the capture-lighting audit's `D:/claude/splat-quality-20260923/capture-lighting-audit/out/view_sky_fraction.json`: W1 0.39, W2 0.27, W3 0.17, W4 0.39, W5 0.45); the rest is the facade across Glassford Street. Each window panel shows the facade below that window's measured horizon (R1a's per-window horizon tables, the same the Sun's gates use) and the sky above it, with the Moon's disc at its true phase only where the Moon stands above the facade's roofline. The facade is a Lambertian sandstone wall facing 284.3° (albedo 0.3, the study's assumption), lit by the sky (its view of it 0.24, and with the Sun high in front of the windows only the dim anti-solar part: the frontier study measured the facade at 0.018 of the windows' sky band then, §e d2, 8 October), by the Sun once the Sun clears the hall's own roof as seen from the facade (the audit's `D:/claude/splat-quality-20260923/weather-daylight/opposite_facade.json` sunlit hours give that roofline: about 8° at azimuth 200° rising to about 14° at 292°; the hours are London local time, as its script builds them with `tz='Europe/London'`, `opposite_facade.py:16`, so the June end is the Sun at 291.7°, 13.7°, not the 303.4°, 6.4° a UTC reading would give), and at night by street lighting at about 1 cd/m² (assumed, §b3; the evening Matterport stations can measure it), its colour about 3,830 K (warm sandstone under 4,000 K LEDs; d2). The panel's mean is the light the room receives through that window (the package's window radiance times its weight), so what the windows show and what they admit agree. The view is an interface (`WindowViewModel`), so R2's real sky and the frontier's spectral sky-view replace R1d's clear-sky one without touching the panels.
10. **The frontier light study plugs in through interfaces, never as a dependency** (`D:/claude/real-hall/frontier/light/proposal.md` §c9, §e). R1d stays RGB. Its upgrade points: the luminance calibration (`LuminanceCalibration`, Task 5: the spectral package's k_abs replaces the measured 121.8 cd/m²); the lamps' dimming colour (`dimmedTint`'s signature, Task 4: a spectral LED or tungsten model replaces the Planckian RGB tint); the window view (`WindowViewModel`, Task 15: the spectral sky-view and facade bands); the night-vision display stage (`nightVisionNode`, Task 16: a mesopic model with chromatic adaptation could replace the Thompson shift; the study's d3 of 8 October found its chain not ready, so the Thompson stage stays); and the glare function (`Glare`, Task 13: the study's fitted CIE pyramid is now an option, `?glare=cie`). Its colour-accuracy method (spectral against RGB, CIEDE2000) reports beside R1d's in Task 21 when it exists.
11. **The lamps keep the bake's colour at full level and dim warm by the owner's choice, and R1d assumes no lamp weights.** The hall's lamps are LED (the contractor's record for the frieze tape and the dome's pin spots; the chandeliers' frosted candles almost certainly: light study §b9), and LEDs keep their colour as they dim. Blake chose a warm-down anyway (spec §4.1, commit 475acd2e, 7 October): an artistic choice, labelled so in the code and the docs. Each group's dimming is a package value (`lamps.groups[g].dimming`, Task 3): `warm`, the default, the tungsten laws used as a look (light d^3.4, colour temperature d^0.42 of full); `led`, the lamps' own (constant colour, the DALI logarithmic curve). At full level every group's light is exactly the bake's (the relight package's own weight and colour for that source) times its night gain (Task 21: one number per group, so a group's colour stays the bake's), and the warm-down's starting temperature only shapes the dimming. It is a package value per group (`lamps.warmDown.groups[g].fullCct`; the controller's ruling L3 of 8 October: there is no single start): the colour temperature that the group's own colour in the relight package (R1a Task 4b fits a colour per lamp group: the cove, the chandeliers (`ch_end` and `ch_centre` share one) and the dome, each the measured lamp/daylight ratio 1.623 : 1 : 0.467 times a fitted offset held by a prior) implies against CIE daylight by McCamy's formula: about 3,700 K for the chandeliers at the ratio itself (3,540–3,990 K for D60–D75; the light study's spectral reading: 3,509–3,956 K), about 4,370 K for the dome at its prior offset. The earlier 2,750 K is withdrawn: it is not established. No lamp weight is assumed either: the centre chandelier was lit for the whole capture walk though R1a's proof fit gave it a weight of 1.4e-11 (splats study §b1), so the bake refits the house lights (R1a Task 4b: one intensity φ per candle, the centre's crown tubes at w_crown × φ) and writes each lamp's intensity per unit of its group's weight, which R1d's Task 3 reads; every lamp quantity R1d draws (the crisp lamps' radiance, the lamps' sheen, the night gains) is per unit of the package's own weights, and Task 21 refuses to calibrate a lamp group the bake leaves dark.

## Contracts R1d relies on (checked by Task 0)

1. **R1a, R1b and R1c merged, with the amendments applied** (R1d's `docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md` A1–A11; R1c's `docs/superpowers/plans/2026-10-03-r1c-amendments-to-r1a-r1b.md`). The amendments file's sections are historical: they were applied on 7 October in R1a's and R1b's consolidated texts (A9 superseded by R1a Task 4's factored basis), and R1d anchors on the current plans' text, never on an amendment's quoted anchor. From R1b as amended: `RelightFrame` (`apply`, `prepare`, `onApply`, `uniforms` with the Sun's and the Moon's, `inputs`, `model`, `floor`, `floorBase`, `floorSun`, `floorMoon`, `kernelFrame`, `meanLight`, `readSkyLight`, `addPasses`, `setVisibility`, the private `writeDisplay`), `skyBody`, `probeReads`, `bounceNode`, `RelightApplication`, `createRelightDraw`, `NativeSplatScene.runRelight`, `relightSplat`, `prepareKernelFrame`, `settingForChoice`, `settingForSky`, `WeatherPreset`, `adaptDisplay`, `PRESET_DISPLAY`, `PRESET_DEFAULTS`, `MOONLIT_DISPLAY_KEY`, `LIGHT_PRESETS`, `useLightSettingStore`, `displayNode`, `HIGHLIGHT_KNEE`, `litFloorMaterial`, `skyPanelNode`, `RelightProvider`, `LightControl`, `measureRelight` and `RELIGHT_SPANS` (`relight-spans.ts`), `window.__relight` (with `gpuTime`), `relight-debug.ts`'s `wordTally`, `sunRaySensitive`, `timedCompute`, `computeTimestamps` and `TimedComputeRenderer` (Task 17, as amended 8 October: `timedCompute` resolves the timestamps while tracking is on, the controller's ruling N1), `relight-verify.mjs`, `browsercheck.py` (`_word_ok(name, v, rate)`, `_wall_face_rate`, `SKY_BUDGET_MS`, `SKY_TIMINGS`, `FRAME_MS`, `RELIGHT_SPANS`); `moon.ts` (`moonPosition`, `MOON_ANGULAR_RADIUS`, `MOON_CCT`, `sunIlluminance`, `atmosphericTransmission`); `sun.ts` (`solarPosition`, `sunDirection`).
2. **R1c's interface** (the amendments file's section "The R1c interface R1d consumes", items 1–8, with item 4's `SkinSurface` carrying R1c's optional `specularColour: Node<"vec3">`, the metal's Fresnel colour, R1c Task 20).
3. **The staged packages and tables:** relight package v2 (R1c) at `D:/claude/splats/trades-hall/grand-hall/relight/v2/manifest.json` (with each lamp group's colour, `lamps.groups[g].colour`, R1a Task 4b), floor skin v2, the skin package, R1a's work tables `D:/claude/relight/grand-hall/work/npy/{splats_pos,geom_cls,geom_chand_id}.npy` (finest level, e57 frame, product order) and `<work>/floor-light.npz`; the emitter table of triangulated chandelier lamps (the frontier splats study's `D:/claude/real-hall/frontier/splats/evidence/bulbs.json`, json frame, 173 entries with a `confidence` each; the config's `paths.emitters`, which R1a Task 4b adds); and the bake's house-light refit, `<work>/bulb-intensities.json` (R1a Task 4b as amended 8 October: each of the 140 lamps `{ kind, intensity }`, the top-level `wCrown`, `fit.notLamps`, `fit.tableSha256`), which R1a writes before R1d starts and Task 3 requires.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tools/relight/relight/bulbs.py` | Create | The crisp lamps from the triangulated emitter table, the chandeliers' centres; the night photographs' projection check |
| `tools/relight/relight/occluders.py` | Create | The simplified interior occluder model: chandelier and pilaster voxels to a triangle mesh |
| `tools/relight/relight/cinematic.py` | Create | Bulb intensities, the lamps' dimming and warm-down temperature, probe placements, the `venviewer.cinematic.v1` writer |
| `tools/relight/relight/nightcal.py` | Create | The night calibration fit and the colour-accuracy measure |
| `tools/relight/relight/__main__.py` | Modify | Commands `bulbs`, `occluders`, `cinematic`, `night-calibration`, `cinematic-check` |
| `tools/relight/config/grand-hall.json` | Read | `paths.emitters` (the frontier study's bulb table), which R1a Task 4b adds; Task 1 checks it |
| `tools/relight/relight/cinematiccheck.py` | Create | The browser checks of the cinematic light: identity, words, shadows, glow, photographs with CIEDE2000, lamps, fallbacks, loading, the frame budget |
| `tools/relight/tests/test_bulbs.py`, `test_occluders.py`, `test_cinematic.py`, `test_nightcal.py`, `test_cinematiccheck.py` | Create | Unit tests |
| `docs/engineering/cinematic-package.md` | Create | The `venviewer.cinematic.v1` contract |
| `packages/web/src/lib/relight/lamp-dimming.ts` | Create | Planckian colour, the artistic warm-down and the LED-true dimming curve |
| `packages/web/src/lib/relight/light-motion.ts` | Create | The displayed day and minutes, lamp drives, blend and eye, stepped with `stepSpring` |
| `packages/web/src/lib/relight/sky-instant.ts` | Create | The Sun and the Moon at a displayed instant (fractional minutes) |
| `packages/web/src/lib/relight/sky-colour.ts` | Create | The sky's measured colours: the beams by their elevation, the clear blue hour in xy (the frontier study, 8 October) |
| `packages/web/src/lib/relight/eye.ts` | Create | Anchored adaptation targets, the luminance calibration and the scotopic amount |
| `packages/web/src/lib/relight/light-director.ts` | Create | Each animation frame while the light moves: targets, springs, the application, the passes |
| `packages/web/src/lib/light-setting.ts`, `packages/web/src/stores/light-setting-store.ts` | Modify | Live time, the whole day, the lamps switch, `follow` |
| `packages/web/src/lib/relight/relight-kernel.ts`, `relight-draw.ts`, `relight-frame.ts` | Modify | Glow hiding, the bodies' shadow hook, the pass stride, `setDisplay` |
| `packages/web/src/lib/native-splat-scene.ts` | Modify | `runRelight({ activeOnly })`, stale draws rerun on activation |
| `packages/web/src/lib/relight/cinematic-package.ts` | Create | The cinematic manifest schema, URL, verified fetch and decode |
| `packages/web/src/lib/relight/sun-shadow.ts` | Create | The occluders' shadow maps for the Sun and the Moon: cameras, R32F targets, PCF node, CPU twin |
| `packages/web/src/lib/relight/bulbs.ts` | Create | The crisp frosted lamps (candles and the crown tubes): each kind's envelope geometry, radiance, glow share, the glass's light on the GPU; the chandeliers handed to the kernel's glow hiding |
| `packages/web/src/lib/native-renderer.ts`, `packages/web/src/components/scene/NativeCanvas.tsx`, `packages/web/src/lib/native-current-view-capture.ts` | Modify | The frame composer hook |
| `packages/web/src/lib/relight/cinematic-composer.ts` | Create | MRT target, bloom, shafts, composite |
| `packages/web/src/lib/relight/sun-shafts.ts` | Create | The air's visibility volume for both bodies and the view-ray march with dust |
| `packages/web/src/lib/relight/window-view.ts`, `packages/web/src/lib/relight/sky-panels.ts`, `packages/web/src/components/scene/RelightWindowView.tsx` | Create/Modify/Create | The Moon's disc at its phase and the moonlit sky in the window panels; the sky model hook for R2; their mount |
| `packages/web/src/lib/relight/display.ts` | Modify | The scotopic shift; `DisplayUniforms.linear` for the probes |
| `packages/web/src/lib/relight/sheen.ts` | Create | GGX from the Sun, the Moon, the lamps and the windows, and the probes' specular |
| `packages/web/src/lib/relight/reflection-probes.ts` | Create | Cube probes of the relit meshes, refreshed while the light moves, box-projected reads |
| `packages/web/src/lib/relight/floor-material.ts` | Modify | The floor's interior shadow, sheen and reflections |
| `packages/web/src/lib/relight/sky-arcs.ts` | Create | The bodies' arcs for a date, their rise, set and golden-hour detents |
| `packages/web/src/components/rooms/SkyClock.tsx`, `SkyClock.css` | Create | The clock: the chart, its drag, detents, keys and words |
| `packages/web/src/components/scene/RelightCinematic.tsx`, `packages/web/src/components/scene/floor-hooks-context.ts`, `packages/web/src/components/scene/cinematic-hooks.tsx`, `packages/web/src/components/scene/cinematic-light.ts` | Create | `RelightCinematic` mounts the shadows, bulbs, composer, shafts, window view and probes beside the relit scene and publishes their hooks; `CinematicHooksProvider` provides the floor's hooks and the value of R1c's `SkinLightHooksContext` (R1c creates that context) around the scene and R1c's skins; `cinematic-light.ts` is the one entry the provider imports lazily, only in development and preview bundles |
| `packages/web/src/components/scene/RelightProvider.tsx` | Modify | Loads the cinematic light's entry and package; the director replaces the per-choice apply |
| `packages/web/src/lib/relight/relight-spans.ts` | Modify | The cinematic light's two loading spans |
| `packages/web/src/components/rooms/LightControl.tsx`, `LightControl.css` | Modify | The clock, the lamps switch, now, the clutter toggle |
| `packages/web/src/lib/relight/relight-debug.ts`, `packages/web/src/lib/relight/cinematic-parts.ts` | Modify/Create | The calibration controls and cinematic instruments on `window.__relight`; the session's parts for them |
| `packages/web/scripts/gpu-lock.mjs`, `packages/web/scripts/gpu-lock-check.mjs`, `packages/web/scripts/cinematic-calibrate.mjs`, `packages/web/scripts/cinematic-verify.mjs`, `packages/web/scripts/light-scrub-budget.mjs` | Create | The GPU lock every driver takes, freed on every exit, and its check; the night calibration's renders and the eye's anchors; browser verification (the glow comparison included); the scrub, drag, walk, lamps and both-bodies frame budget |
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
| 11 | Crisp frosted lamps: candles and the crown tubes |
| 12 | The frame composer hook in the native renderer |
| 13 | The cinematic composer: MRT, the energy-conserving glow and the eye's GPU measurement |
| 14 | Sun and Moon shafts with faint dust |
| 15 | The view through the windows: the facade opposite, the sky, the Moon's disc and the city's light |
| 16 | Night vision: the display's scotopic shift |
| 17 | GGX sheen from the Sun, the Moon, the lamps and the windows |
| 18 | Reflection probes |
| 19 | The sky's arcs and detents |
| 20 | The clock: a crafted control for the Sun, the Moon and the hour |
| 21 | Night calibration, the colour-accuracy measure and the eye's anchors |
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
C:/Python313/python.exe -c "import json;c=json.load(open('tools/relight/config/grand-hall.json'));print('emitters', c['paths'].get('emitters'))"
C:/Python313/python.exe -c "import json,hashlib;b=json.load(open('D:/claude/relight/grand-hall/work/bulb-intensities.json'));t=open('D:/claude/real-hall/frontier/splats/evidence/bulbs.json','rb').read();print('refit', len(b['bulbs']), 'lamps', sum(1 for v in b['bulbs'].values() if v['kind']=='crown'), 'crown; wCrown', b['wCrown'], 'same table', b['fit']['tableSha256']==hashlib.sha256(t).hexdigest())"
```
Expected: a clean tree on `claude/real-hall`; both amendment files; the staged packages and R1a's tables exist. Anything missing: stop and report (R1d builds on R1a, R1b and R1c as merged). The last three lines check the two inputs from outside R1a–R1c: the frontier study's bulb table, which the config's `paths.emitters` names (R1a Task 4b adds the key), and the bake's house-light refit (`bulb-intensities.json`, which R1a Task 4b writes before R1a merges): `emitters D:/claude/real-hall/frontier/splats/evidence/bulbs.json`, then `refit 140 lamps 7 crown; wCrown <the measured weight: 0.3871 on 8 October> same table True`. A missing file or key, another lamp count, or `same table False` (the table changed after the refit): stop and report. Tasks 1 and 3 refuse to run without them.

- [ ] **Step 2: The R1b and R1c names R1d edits or calls exist** (one `grep` per file; every pattern must print at least one line)

```bash
cd D:/claude/real-hall/repo/packages/web/src
grep -n "export class RelightFrame\|addPasses(\|setVisibility(\|prepare(renderer: WebGPURenderer)\|meanLight(light: ChoiceLight)\|floorBasePass\|export type RelightUniforms\|readSkyLight(renderer: WebGPURenderer)\|private writeDisplay(display: DisplayParams)\|export function probeReads\|export function bounceNode" lib/relight/relight-frame.ts
grep -n "export function relightSplat\|export function prepareKernelFrame\|export function capturedSetting\|readonly lampTints\|const litBulb" lib/relight/relight-kernel.ts
grep -n "export function createRelightDraw\|const lit = select(bulb\|lampTints\|run: (renderer)" lib/relight/relight-draw.ts
grep -n "runRelight(\|activeRelightDraw()\|private activate(snapshot: Snapshot)" lib/native-splat-scene.ts
grep -n "export function settingForChoice\|export function settingForSky\|export type WeatherPreset\|export function adaptDisplay\|PRESET_EMITTER_BOOST\|export const PRESET_DISPLAY\|export const PRESET_DEFAULTS\|MOONLIT_DISPLAY_KEY\|unitsPerLux\|moonlit: { date: \"2026-09-26\", minutes: 1380 }" lib/light-setting.ts
grep -n "export function moonPosition\|export const MOON_ANGULAR_RADIUS\|export const MOON_CCT\|export function sunIlluminance\|export function atmosphericTransmission" lib/moon.ts
grep -n "export function sunEcliptic\|export function solarPosition\|export function sunDirection" lib/sun.ts
grep -n "export function skyBody\|readonly floorMoon\|readonly floorBase\|moonDir: uniform\|readonly skyPower\|readonly bounceCoefficients" lib/relight/relight-frame.ts
grep -n "readonly moonDir\|readonly moonSun\|readonly moonOn" lib/relight/relight-kernel.ts
grep -n "export const SkinLightHooksContext" components/scene/skin-hooks-context.ts
grep -n "bodyVisibility\|export interface SkinSurface\|export interface SkinSheen\|setStride" lib/skins/skin-material.ts lib/skins/skin-frame.ts
grep -n "export function applicationForChoice" lib/relight/relight-apply.ts
grep -n "export function displayNode\|export interface DisplayUniforms" lib/relight/display.ts
grep -n "export function litFloorMaterial\|material.colorNode = Fn" lib/relight/floor-material.ts
grep -n "export function RelightProvider\|frame.onApply(() => { host.runRelight(); invalidate(); })\|requestAnimationFrame(apply)\|void wanted.then((data) => {\|<RelightSkins frame={frame} transform={transform} />\|import { getNativeRenderer } from \"../../lib/native-renderer.js\";\|measureRelight(\"relight:apply\", apply);" components/scene/RelightProvider.tsx
grep -n "export function nativeRendererForScene" lib/native-renderer.ts
grep -n "TOGGLE_SHIFT\|TOGGLE_CLUTTER\|TOGGLE_CABINET\|CLASS_SKIN" lib/relight/relight-codec.ts
grep -n "export function skinVisibility" lib/skins/skin-visibility.ts
grep -n "export interface SkinLightHooks\|sunShadow\|sheen\|specularColour\|export const NO_SKIN_HOOKS" lib/skins/skin-material.ts
grep -n "hiddenToggles\|setToggleHidden" stores/light-setting-store.ts
grep -n "export function warnRelightFallback\|export async function fetchVerified\|export async function sha256Hex\|export async function inflate" lib/relight/relight-warning.ts lib/relight/relight-assets.ts lib/relight/relight-png.ts
grep -n "export function measureRelight\|export const RELIGHT_SPANS" lib/relight/relight-spans.ts
grep -n "export function computeTimestamps\|export async function timedCompute\|export function wordTally\|function sunRaySensitive\|gpuTime: async" lib/relight/relight-debug.ts
grep -n "const skins = useLightSettingStore((state) => state.skins);\|Preparing the walls" components/rooms/LightControl.tsx
grep -n "export function stepSpring\|export function isSpringSettled" lib/springs.ts
grep -n "export const CAPTURE_DAYLIGHT_CCT\|export function daylightRgb\|export function cctShift" lib/relight/daylight.ts
grep -n "expect(PRESET_DEFAULTS.moonlit).toEqual({ date: \"2026-09-26\", minutes: 1380 });\|by the full Moon of 26 September" lib/__tests__/light-setting.test.ts
```
Expected: every pattern prints at least one line (check each alternative of each command, not only that the command prints). The current R1b and R1c texts are the anchors (R1b's consolidated plan carries the amendments file's A1–A9; R1c's interface list is the amendments file's section "The R1c interface R1d consumes", with R1c Task 20's `specularColour`). Any missing name: stop and report to the controller with the command's output. The plan's edits are anchored on these lines; nothing in R1d works around a missing one.

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
for f in src/lib/__tests__/springs.test.ts src/lib/__tests__/light-setting.test.ts src/stores/__tests__/light-setting-store.test.ts src/lib/relight/__tests__/relight-kernel.test.ts src/lib/relight/__tests__/relight-draw.test.ts src/lib/relight/__tests__/relight-frame.test.ts src/lib/relight/__tests__/relight-apply.test.ts src/lib/relight/__tests__/display.test.ts src/lib/__tests__/native-splat-scene.test.ts src/components/scene/__tests__/RelightProvider.test.tsx src/components/rooms/__tests__/LightControl.test.tsx src/components/scene/__tests__/NativeCanvas.test.tsx src/lib/__tests__/native-current-view-capture.test.ts src/components/stage/__tests__/StageFloor.test.tsx src/lib/relight/__tests__/relight-debug.test.ts src/lib/__tests__/splat-staging-plugin.test.ts src/lib/relight/__tests__/sky-panels.test.ts src/lib/__tests__/native-renderer-scope.test.ts src/lib/relight/__tests__/relight-spans.test.ts src/components/rooms/__tests__/RoomSplatScene.test.tsx src/components/rooms/__tests__/LightControl-skins.test.tsx src/components/scene/__tests__/RelightSkins.test.tsx src/lib/skins/__tests__/skin-material.test.ts; do pnpm --filter @omnitwin/web exec vitest run "$f" || { echo "FAILED: $f"; break; }; done
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
- Modify: `tools/relight/relight/__main__.py` (the `bulbs` command, directly above `if __name__ == "__main__":`)
- Read: `tools/relight/config/grand-hall.json` (`paths.emitters`, which R1a Task 4b adds)
- Outputs (D:, never committed): `D:/claude/relight/grand-hall/work/bulbs.json` (written only when the task passes), `D:/claude/relight/grand-hall/evidence/r1d/bulbs.json` (or `bulbs-FAILED.json`), `D:/claude/relight/grand-hall/verify/r1d/bulbs-run{1,2}.json`

**Interfaces:**
- Consumes: the emitter table at `cfg.paths["emitters"]`: the frontier splats study's bulb table (`D:/claude/real-hall/frontier/splats/evidence/bulbs.json`, schema `venviewer.frontier.bulbs.v1`, written by its `scripts/10_bulb_table.py` from `05_build_obs.py`'s triangulation): `frames.T_json_from_e57`, `bulbs[]` with `id` (`c<chandelier>_b<nn>`), `chandelier`, `position_json` (HallFrame metres, z up), `position_e57`, `faces_used`, `ray_residual_mm_p50` and `confidence` (`"<word>: <reading>"`, the word `high`, `medium`, `low` or `exclude`; every `medium` reading names "the centre chandelier's crown tubes"); `canonical_frame.json`'s `T_json_from_e57` (`cfg.paths["canonicalFrame"]`); the proof's `work/views.json` and night photographs (`cfg.paths["proofWork"]`), `cfg.room["manifestTranslation"]`; R1a's `__main__.COMMANDS`.
- Produces (`bulbs.py`): `SCHEMA = "venviewer.relight-bulbs.v2"`, `TABLE_SCHEMA = "venviewer.frontier.bulbs.v1"`, `CHANDELIER_CENTRES` (5 × 3, e57, the proof's `CHANDELIERS`), `CHANDELIER_RADII = (0.75, 0.75, 1.0, 0.75, 0.75)`, `CHANDELIER_SPAN` (each volume's z below and above its centre), `CENTRE_CHANDELIER = 2`, `GROUPS = ("ch_end", "ch_centre")`, `CONFIDENCE_WORDS`, `LAMP_WORDS = ("high", "medium")`, `KINDS = ("candle", "crown")`, `CROWN_TEXT = "crown tube"`, `CROWN_MIN_RISE = 1.25`, `MIN_VIEWS = 12`, `MAX_RAY_MM = 15.0`, `VOLUME_MARGIN = 0.1`, `FRAME_TOLERANCE = 1e-4`, `CONTROL_OFFSET = 1.0`, `NIGHT_VIEWS = ("mp43_night_end", "mp45_night_windows")`; `lamp_kind(entry) -> str | None` ("crown", "candle", or None for an entry that is not a lamp; an unknown confidence word is refused); `read_emitters(path, t_json_from_e57) -> dict` (`{ rows: [{ id, chandelier, confidence, kind, json, e57, views, rayMm }], notLamps: [{ id, chandelier, confidence }], sha256 }`, the rows sorted by id; refuses another schema, a different frame transform, a duplicate or malformed id, an unknown confidence); `json_to_e57(points, t_json_from_e57)`; `bulb_group(chandelier) -> str`; `place_bulbs(rows, t_json_from_e57) -> (bulbs, problems)` (the lamps only, each with its kind); `chandelier_entries(bulbs) -> list[dict]`; `e57_to_room`, `project_view`, `photo_hits`, `control_points(bulbs_e57, chandeliers)`, `photo_check(bulbs_e57, chandeliers, views, photos, t_json_from_e57, manifest_translation)`.
- Produces (data): `<work>/bulbs.json` = `{ schema, frame: "e57", source, tableSha256, chandeliers: [{ id, centre: [3], crisp, bulbs }], counts: { ch_end, ch_centre }, kinds: { candle, crown }, notLamps: [{ id, chandelier, confidence }], bulbs: [{ id, group, kind, chandelier, position: [3], views, rayMm }] }`, read by Task 3; `<evidence>/r1d/bulbs.json` with the artifact's SHA-256.

Decision 1: the crisp lamps stand where the photographs put the bulbs, not where the capture's glow is. The emitter table is the frontier splats study's triangulation from clipped blobs in the E57 faces (173 entries over all five chandeliers on 7 October, 3.0–4.3 mm p50 ray residual per chandelier), each entry read by eye with a confidence. The lamps are the `high` and `medium` entries, 140 on the 7 October table (26, 22, 47, 23 and 22 for chandeliers 0–4): the controller's ruling L1 of 8 October, one lamp set for the bake's refit (R1a Task 4b) and R1d, as the study recommends (§d6.0, §e). `low` (unresolved by eye, 6) and `exclude` (a brass highlight or glare, 27) are not lamps: they are listed in `notLamps` and drawn as nothing (an `exclude` entry drawn as a lamp would put a lit candle on a brass glint, and the bake's refit gives none of them an intensity). The centre chandelier's 7 `medium` entries whose reading names its crown tubes are a lamp kind of their own, `crown` (ruling L2: "small cylindrical crown lamps" 1.38–1.40 m above its centre, above all its candles, whose highest stands 1.12 m up); every medium entry of the table carries the same reading, so the chandelier decides, and a crown tube lower than 1.25 m above the centre is reported as a misreading. Every other lamp is a `candle`. Each lamp keeps the table's id (`c0_b00`; the bake's per-bulb refit reads the same table, so both name the same lamps, and the table's SHA-256 goes into `bulbs.json` so Task 3 can refuse a refit of another table) and is taken to the e57 (model) frame with the canonical frame's rigid `T_json_from_e57` (json = T_JE @ e57, so e57 = R_JEᵀ (json − t)); the table's own transform must equal it, and its own `position_e57` must agree within 0.1 mm (it rounds to 10 µm), so a frame mismatch can never pass silently. Each lamp is checked: at least 12 views and a p50 ray residual within 15 mm (05's own acceptance is 12 views; its worst lamp on 7 October is 13.8 mm), and inside its chandelier's volume as the proof classes it (`02_geometry.py`: 0.75 m radius and 0.6 m below to 0.75 m above for an end chandelier, 1.0 m and 0.75 m to 1.45 m for the centre one; the test reads the proof's centres so the two never drift) with a 10 cm margin, because two triangulated bulbs stand 7 mm and 2 mm outside the radius on 7 October. A chandelier the table does not cover is listed as not crisp and keeps its glow splats (decision 1). The check projects every bulb into the hall's two night photographs (the proof's views, which `07_compare.py` aligned with `cmp/photo_*.png`) and counts the bulbs within ±3 pixels of a near-saturated photo pixel; control points, each bulb moved 1 m further from its chandelier's axis at the same height, show that the test discriminates (into empty air beside the fixture: points 0.3 m beside a bulb land in its neighbours' bloom and hit 75% as often at station 45, so they prove nothing). On the 7 October table the 140 lamps hit 43 of 43 in view at station 43 and 19 of 19 at station 45, the controls 1 of 35 and 1 of 17 (computed 8 October with this task's code; all 173 entries, brass included, hit as often because the brass glints sit inside the bulbs' bloom, so the photographs cannot tell a lamp from a glint and the confidence must). It proves the frame conversion end to end. Gate: at each station with covered bulbs in view, at least 70% of them hit, and the controls hit at most half as often; at least one station sees covered bulbs. A miss is reported with the numbers, never tuned away.

Verified (7 October; the table and the lamp rule again on 8 October): `D:/claude/real-hall/frontier/splats/scripts/10_bulb_table.py:1-9,30-40,95` (schema `venviewer.frontier.bulbs.v1`, `frames.T_json_from_e57`, written to `evidence/bulbs.json`); `evidence/bulbs.json` itself (173 entries, SHA-256 `1856cf8b047d36c7e0097942af30bccddcbf725afc19adfa7611d29fb688648d` on 8 October, no `not_yet_triangulated` key; a bulb: `id` `c0_b00`, `chandelier`, `chandelier_role`, `position_json`, `position_e57`, `faces_used`, `ray_residual_mm_p50`, `ray_residual_mm_max`, `clipped_blob_area_mm2_median`, `core_ratio_median`, `confidence`, `faces`; `confidence_counts` high 127, medium 13, exclude 27, low 6; every medium reading "a lamp seen by eye, partly hidden, dim or small (the centre chandelier's crown tubes)"; the centre's medium entries `c2_b41`, `c2_b45`–`c2_b49`, `c2_b53`), `05_build_obs.py:33-36` (`BULB_MIN_VIEWS = 12`, `BULB_MERGE_M = 0.05`), `common_obs.py:3` (json = HallFrame, e57 = the light model's frame, json = T_JE @ e57), `:51-61` (`json_to_e57(p, T) = (p − T[:3, 3]) @ T[:3, :3]`); the 140 lamps taken to e57 (8 October, this task's code): at least 12 views, the worst ray p50 13.79 mm, within 0.757, 0.751, 1.002, 0.773 and 0.697 m of their chandeliers' axes and −0.39 to +1.40 m of a centre's height, the crown tubes 1.377–1.400 m above the centre chandelier's centre and its candles at most 1.122 m; R1a Task 4b's `lamp_kind` (the same rule: R1a plan, Task 4b, "The crown tubes"); `tools/relight/proof/02_geometry.py:21-22` (`CHANDELIERS`), `:84-88` (the volumes: radius 0.75, z −0.6..+0.75; the centre chandelier 1.0, −0.75..+1.45); `canonical_frame.json` (`T_json_from_e57`, rigid); `tools/relight/proof/common.py:30,45-63` (`json_to_room` = (x + t0, z + t1, −y + t2)); the proof's `work/views.json` (`name`, `pos`, `tgt`, `fov` 48) and `cmp/photo_mp43_night_end.png`, `photo_mp45_night_windows.png` (1920 × 1080 RGB); `tools/relight/relight/__main__.py:119` (`COMMANDS`), `:163-185` (`main` dispatches `COMMANDS[args.command](cfg, args)`), `:773-774` (`if __name__ == "__main__": sys.exit(main())`: a command must be registered above it); `tools/relight/relight/config.py:9,24-36` (`PATH_KEYS`; `load` keeps every path, so an extra key is allowed).

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_bulbs.py`:

```python
import ast
import hashlib
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
# The 7 October table's confidence texts (every medium entry names the crown tubes: the chandelier decides).
HIGH = "high: no flag"
MEDIUM = "medium: a lamp seen by eye, partly hidden, dim or small (the centre chandelier's crown tubes)"


def to_json(points_e57) -> list[list[float]]:
    return (np.asarray(points_e57, np.float64) @ T_JE[:3, :3].T + T_JE[:3, 3]).tolist()


def row(bulb_id: str, chandelier: int, e57, views: int = 30, ray_mm: float = 3.0, kind: str | None = "candle") -> dict:
    return {"id": bulb_id, "chandelier": chandelier, "kind": kind, "json": to_json([e57])[0], "views": views, "rayMm": ray_mm}


class Table(unittest.TestCase):
    def write(self, folder: str, data: dict) -> str:
        path = os.path.join(folder, "bulbs.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return path

    def table(self, bulbs: list[dict], transform=None) -> dict:
        frames = {"T_json_from_e57": (T_JE if transform is None else transform).tolist()}
        return {"schema": B.TABLE_SCHEMA, "frames": frames, "bulbs": bulbs}

    def bulb(self, bulb_id: str, chandelier: int, e57, confidence: str = HIGH) -> dict:
        return {"id": bulb_id, "chandelier": chandelier, "position_json": to_json([e57])[0], "position_e57": list(e57),
                "faces_used": 20, "ray_residual_mm_p50": 3.0, "confidence": confidence}

    def test_reads_the_studys_table_sorted_by_id_with_its_lamps_and_its_checksum(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, self.table([self.bulb("c2_b00", 2, [8.9, -5.0, 6.2], MEDIUM),
                                                  self.bulb("c0_b01", 0, [2.2, -7.6, 4.3], "exclude: brass highlight"),
                                                  self.bulb("c0_b00", 0, [2.3, -7.7, 4.2])]))
            read = B.read_emitters(path, T_JE)
            with open(path, "rb") as f:
                digest = hashlib.sha256(f.read()).hexdigest()
        self.assertEqual([r["id"] for r in read["rows"]], ["c0_b00", "c0_b01", "c2_b00"])
        self.assertEqual([(r["confidence"], r["kind"]) for r in read["rows"]], [("high", "candle"), ("exclude", None), ("medium", "crown")])
        self.assertEqual((read["rows"][0]["views"], read["rows"][0]["rayMm"]), (20, 3.0))
        np.testing.assert_allclose(read["rows"][2]["e57"], [8.9, -5.0, 6.2], atol=1e-12)
        self.assertEqual(read["notLamps"], [{"id": "c0_b01", "chandelier": 0, "confidence": "exclude"}])
        self.assertEqual(read["sha256"], digest)

    def test_refuses_another_schema_frame_or_confidence_or_a_malformed_or_repeated_id(self):
        good = self.bulb("c0_b00", 0, [2.3, -7.7, 4.2])
        shifted = T_JE.copy(); shifted[0, 3] += 0.01
        cases = [dict(self.table([good]), schema="venviewer.frontier.bulbs.v0"), self.table([good], transform=shifted),
                 self.table([dict(good, id="c1_b00")]), self.table([good, good]),
                 self.table([dict(good, position_e57=[2.3, -7.7, 4.3])]), self.table([dict(good, confidence="certain: by eye")])]
        with tempfile.TemporaryDirectory() as folder:
            for case in cases:
                with self.assertRaises(ValueError):
                    B.read_emitters(self.write(folder, case), T_JE)

    def test_only_high_and_medium_are_lamps_and_the_centres_crown_tubes_are_their_own_kind(self):
        def kind(chandelier: int, confidence: str):
            return B.lamp_kind({"id": f"c{chandelier}_b00", "chandelier": chandelier, "confidence": confidence})
        self.assertEqual([kind(0, HIGH), kind(0, MEDIUM), kind(2, MEDIUM), kind(2, "medium: partly hidden"), kind(2, HIGH)],
                         ["candle", "candle", "crown", "candle", "candle"])
        self.assertEqual([kind(1, "low: unresolved by eye"), kind(4, "exclude: brass highlight")], [None, None])


class Placement(unittest.TestCase):
    def test_the_chandeliers_are_the_proofs(self):
        with open(PROOF_GEOMETRY, encoding="utf-8") as f:
            source = f.read()
        literal = re.search(r"CHANDELIERS = np\.array\((\[.*?\])\)", source, re.S).group(1)
        np.testing.assert_array_equal(np.array(ast.literal_eval(literal)), B.CHANDELIER_CENTRES)

    def test_json_to_e57_inverts_the_canonical_transform(self):
        e57 = np.array([[2.24, -7.66, 4.28], [8.9, -5.0, 5.5]])
        np.testing.assert_allclose(B.json_to_e57(to_json(e57), T_JE), e57, atol=1e-12)

    def test_places_each_lamp_in_its_chandelier_with_a_stable_id_and_its_kind(self):
        centre = B.CHANDELIER_CENTRES[2]
        rows = [row("c0_b04", 0, B.CHANDELIER_CENTRES[0] + [0.0, 0.8, 0.0]), row("c2_b00", 2, centre + [0.5, 0.0, 1.0]),
                row("c2_b41", 2, centre + [0.4, 0.0, 1.38], kind="crown"), row("c2_b07", 2, centre, kind=None)]
        bulbs, problems = B.place_bulbs(rows, T_JE)
        self.assertEqual([(b["id"], b["group"], b["kind"]) for b in bulbs],
                         [("c0_b04", "ch_end", "candle"), ("c2_b00", "ch_centre", "candle"), ("c2_b41", "ch_centre", "crown")])
        np.testing.assert_allclose(bulbs[1]["position"], centre + [0.5, 0.0, 1.0], atol=1e-5)
        self.assertEqual(problems, [])

    def test_reports_a_lamp_outside_its_volume_poorly_seen_or_a_crown_below_the_crown(self):
        far = B.CHANDELIER_CENTRES[0] + [0.0, 0.9, 0.0]          # 0.15 m beyond the radius, 5 cm beyond the margin
        rows = [row("c0_b00", 0, far), row("c1_b00", 1, B.CHANDELIER_CENTRES[1], views=11),
                row("c2_b41", 2, B.CHANDELIER_CENTRES[2] + [0.2, 0.0, 0.5], kind="crown"),
                row("c3_b00", 3, B.CHANDELIER_CENTRES[3], ray_mm=15.5)]
        _bulbs, problems = B.place_bulbs(rows, T_JE)
        self.assertEqual([p["id"] for p in problems], ["c0_b00", "c1_b00", "c2_b41", "c3_b00"])
        self.assertEqual([p["reason"] for p in problems], ["outside its chandelier", "too few views", "crown tube below the crown", "ray residual"])

    def test_lists_every_chandelier_and_which_have_crisp_lamps(self):
        bulbs, _ = B.place_bulbs([row("c2_b00", 2, B.CHANDELIER_CENTRES[2])], T_JE)
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

The chandeliers' lamps were triangulated from clipped blobs in the E57 photographs by the frontier splats study
(05_build_obs.py: robust ray midpoints, rematched twice, at least 12 views; 3.0-4.3 mm p50 ray residual) and tabled by
its 10_bulb_table.py (venviewer.frontier.bulbs.v1) in the json frame (HallFrame, metres, z up; json = T_JE @ e57) with
a confidence read by eye. The lamps are the "high" and "medium" entries (the controller's ruling L1 of 8 October, the
study's recommendation: 140 on the 7 October table); "low" (unresolved) and "exclude" (brass or glare) are not lamps.
The centre chandelier's medium entries whose confidence names the crown tubes are their own kind, "crown" (ruling L2);
every other lamp is a "candle". Each lamp keeps the table's id (the bake's refit reads the same table), is taken to the
e57 frame (the light model's and the relight package's model frame) and is checked against its chandelier's volume as
the proof classes it (02_geometry.py). The same table gives the same JSON."""
from __future__ import annotations

import hashlib
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
#: The table's confidence words (the part before ":"); the lamps are LAMP_WORDS (ruling L1).
CONFIDENCE_WORDS = ("high", "medium", "low", "exclude")
LAMP_WORDS = ("high", "medium")
KINDS = ("candle", "crown")
#: Ruling L2: the centre chandelier's medium entries whose confidence text names the crown tubes. (Every medium entry
#: of the 7 October table carries the same text, so the chandelier decides.)
CROWN_TEXT = "crown tube"
#: The crown tubes stand 1.377-1.400 m above the centre chandelier's centre, its highest candle 1.122 m (7 October):
#: a crown lamp lower than this is a misreading of the table.
CROWN_MIN_RISE = 1.25
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


def lamp_kind(entry: dict) -> str | None:
    """A table entry's lamp kind: "crown" for the centre chandelier's crown tubes, "candle" for every other high or
    medium entry, None for an entry that is not a lamp (low or exclude). An unknown confidence word is refused."""
    text = str(entry.get("confidence", ""))
    word = text.split(":")[0].strip()
    if word not in CONFIDENCE_WORDS:
        raise ValueError(f"Bulb {entry.get('id')!r} has an unknown confidence {text!r}")
    if word not in LAMP_WORDS:
        return None
    crown = int(entry["chandelier"]) == CENTRE_CHANDELIER and word == "medium" and CROWN_TEXT in text
    return "crown" if crown else "candle"


def read_emitters(path: str, t_json_from_e57) -> dict:
    """The study's bulb table: rows {id, chandelier, confidence, kind, json, e57, views, rayMm} sorted by id (kind None
    for an entry that is not a lamp), the entries that are not lamps {id, chandelier, confidence}, and the table's
    SHA-256. Refused: another schema, a frame transform other than ours, an id that is malformed, repeated or names
    another chandelier, an unknown confidence, or a table e57 position that disagrees with ours."""
    with open(path, "rb") as f:
        raw = f.read()
    table = json.loads(raw)
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
        kind = lamp_kind(bulb)
        position = [float(v) for v in bulb["position_json"]]
        if len(position) != 3 or not all(math.isfinite(v) for v in position):
            raise ValueError(f"Bulb {bulb_id} has no finite position")
        e57 = json_to_e57([position], ours)[0]
        if np.max(np.abs(e57 - np.asarray(bulb["position_e57"], np.float64))) > FRAME_TOLERANCE:
            raise ValueError(f"Bulb {bulb_id}: the table's e57 position disagrees with the canonical transform")
        rows.append({"id": bulb_id, "chandelier": chandelier, "confidence": str(bulb["confidence"]).split(":")[0].strip(),
                     "kind": kind, "json": position, "e57": e57.tolist(), "views": int(bulb["faces_used"]),
                     "rayMm": float(bulb["ray_residual_mm_p50"])})
    rows.sort(key=lambda r: r["id"])
    not_lamps = [{"id": r["id"], "chandelier": r["chandelier"], "confidence": r["confidence"]} for r in rows if r["kind"] is None]
    return {"rows": rows, "notLamps": not_lamps, "sha256": hashlib.sha256(raw).hexdigest()}


def json_to_e57(points, t_json_from_e57) -> np.ndarray:
    """e57 = R^T (json - t) for the canonical frame's rigid json = T_JE @ e57."""
    t = np.asarray(t_json_from_e57, np.float64)
    return (np.asarray(points, np.float64).reshape(-1, 3) - t[:3, 3]) @ t[:3, :3]


def bulb_group(chandelier: int) -> str:
    return "ch_centre" if chandelier == CENTRE_CHANDELIER else "ch_end"


def place_bulbs(rows: list[dict], t_json_from_e57) -> tuple[list[dict], list[dict]]:
    """The lamps (the rows with a kind) in the e57 frame with their ids, groups and kinds, and every problem (a lamp
    outside its chandelier's volume with the margin, seen in fewer than MIN_VIEWS views, with a p50 ray residual above
    MAX_RAY_MM, or a crown tube lower than CROWN_MIN_RISE above its chandelier's centre)."""
    lamps = [r for r in rows if r["kind"] is not None]
    positions = json_to_e57([r["json"] for r in lamps], t_json_from_e57) if lamps else np.zeros((0, 3))
    bulbs, problems = [], []
    for row, position in zip(lamps, positions):
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
        elif row["kind"] == "crown" and rise < CROWN_MIN_RISE:
            problems.append({"id": bulb_id, "reason": "crown tube below the crown", "rise": round(rise, 4)})
        bulbs.append({"id": bulb_id, "group": bulb_group(chandelier), "kind": row["kind"], "chandelier": chandelier,
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
Expected: PASS, 13 tests.

- [ ] **Step 5: Register the command** — `tools/relight/config/grand-hall.json` already names the table: R1a Task 4b adds `paths.emitters` (`"D:/claude/real-hall/frontier/splats/evidence/bulbs.json"`, the study's table, which its `10_bulb_table.py` writes), and Task 0 Step 1 checked it; add nothing to the config. If the key or the table is absent, stop and report it to the controller: it is an input from R1a and the frontier study, not something this task makes. Then add to `tools/relight/relight/__main__.py`, directly above `if __name__ == "__main__":` (`main()` dispatches `COMMANDS` and exits there, so a command registered below it is never seen):

```python
def cmd_bulbs(cfg, args) -> int:
    """<work>/bulbs.json: the crisp lamps at the emitter table's triangulated lamps (R1d Task 1), written only when
    every lamp is placed and the night photographs' check passes (a failure removes an older table's file), and
    <evidence>/r1d/bulbs.json (bulbs-FAILED.json on a failure): the coverage, the entries that are not lamps, any
    misplaced lamp, the photographs' check and the artifact's SHA-256. Exit 1 on a misplaced lamp, no lamp or a failed
    check."""
    import hashlib
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
    kinds = {k: sum(1 for b in bulbs if b["kind"] == k) for k in B.KINDS}
    with open(os.path.join(cfg.paths["proofWork"], "views.json"), encoding="utf-8") as f:
        views = {v["name"]: v for v in json.load(f)}
    photos = {}
    for name in B.NIGHT_VIEWS:
        with Image.open(os.path.join(cfg.paths["proofWork"], "cmp", f"photo_{name}.png")) as im:
            photos[name] = np.asarray(im.convert("RGB"), np.float64) / 255.0
    check = B.photo_check(np.array([b["position"] for b in bulbs]).reshape(-1, 3), [b["chandelier"] for b in bulbs], views, photos, t_je,
                          cfg.room["manifestTranslation"])
    ok = bool(bulbs) and not problems and check["pass"]
    out = {"schema": B.SCHEMA, "frame": "e57", "source": source, "tableSha256": table["sha256"], "chandeliers": chandeliers,
           "counts": counts, "kinds": kinds, "notLamps": table["notLamps"], "bulbs": bulbs}
    text = json.dumps(out, indent=1, sort_keys=True, allow_nan=False)
    target = os.path.join(cfg.paths["work"], "bulbs.json")
    # Gate before write: <work>/bulbs.json exists only for a table that passed.
    if ok:
        with open(target + ".tmp", "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(target + ".tmp", target)
    elif os.path.exists(target):
        os.remove(target)
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    os.makedirs(evidence, exist_ok=True)
    report = {"tableSha256": table["sha256"], "counts": counts, "kinds": kinds,
              "crisp": [c["id"] for c in chandeliers if c["crisp"]], "notCovered": [c["id"] for c in chandeliers if not c["crisp"]],
              "notLamps": {word: sum(1 for n in table["notLamps"] if n["confidence"] == word) for word in ("low", "exclude")},
              "problems": problems, "photoCheck": check,
              "artifact": {"path": "bulbs.json", "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()} if ok else None}
    with open(os.path.join(evidence, "bulbs.json" if ok else "bulbs-FAILED.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1, sort_keys=True, allow_nan=False)
    print("bulbs", json.dumps(counts), "kinds", json.dumps(kinds), "crisp", report["crisp"], "not covered", report["notCovered"],
          "not lamps", len(table["notLamps"]), "problems", len(problems), "photo check", "pass" if check["pass"] else "FAIL",
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
Expected: each run prints the lamps per group and kind, the chandeliers with crisp lamps and those not covered, the entries that are not lamps, the problems and the photographs' check; with the 7 October table (computed 8 October with this task's code): `bulbs {"ch_end": 93, "ch_centre": 47} kinds {"candle": 133, "crown": 7} crisp [0, 1, 2, 3, 4] not covered [] not lamps 33 problems 0 photo check pass {"mp43_night_end": [1.0, 0.0286, true], "mp45_night_windows": [1.0, 0.0588, true]}`, then `identical`. `DIFFER`: run a third time and keep the majority (Global Constraints). A problem or `FAIL` (exit 1, `<work>/bulbs.json` not written, the evidence in `bulbs-FAILED.json`): stop and report the lamps and both stations' shares; the gates are not tuned to pass.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/bulbs.py tools/relight/tests/test_bulbs.py tools/relight/relight/__main__.py && git diff --cached --stat && git commit -m "feat(relight): the crisp lamps at the triangulated chandelier bulbs, checked against the night photographs (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The simplified interior occluder model (offline)

**Files:**
- Create: `tools/relight/relight/occluders.py`, `tools/relight/tests/test_occluders.py`
- Modify: `tools/relight/relight/__main__.py` (the `occluders` command, directly above `if __name__ == "__main__":`)
- Outputs (D:): `D:/claude/relight/grand-hall/work/occluders.npz` (`triangles` (T, 3, 3) float32, e57 metres), `D:/claude/relight/grand-hall/evidence/r1d/occluders.json` (or `occluders-FAILED.json`), `D:/claude/relight/grand-hall/verify/r1d/occluders-run{1,2}.npz`

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

- [ ] **Step 5: Register the command** — add to `tools/relight/relight/__main__.py`, directly above `if __name__ == "__main__":` (below it the command is never registered: `main()` exits first):

```python
def cmd_occluders(cfg, args) -> int:
    """<work>/occluders.npz: the simplified interior occluder model (R1d Task 2), written only when both parts have
    triangles within MAX_TRIANGLES; <evidence>/r1d/occluders.json (occluders-FAILED.json on a failure) with the
    triangles' SHA-256 (np.savez stamps the zip's time, so the array's bytes are hashed, not the file's). Exit 1 when a
    part is empty."""
    import hashlib
    from . import occluders as O
    npy = os.path.join(cfg.paths["work"], "npy")

    def table(name: str):
        return np.load(os.path.join(npy, name), mmap_mode="r")

    windows = [(float(v[0]), float(v[1])) for v in cfg.room["windows"].values()]
    tris, parts = O.build_occluders(table("splats_pos.npy"), table("splats_opa.npy"), table("geom_cls.npy"),
                                    table("geom_chand_id.npy"), float(cfg.room["hallE57"]["y0"]), windows)
    ok = all(parts[name]["triangles"] > 0 for name in O.PART_NAMES)
    path = os.path.join(cfg.paths["work"], "occluders.npz")
    # Gate before write: <work>/occluders.npz exists only for a model with both parts.
    if ok:
        with open(path + ".tmp", "wb") as f:
            np.savez(f, triangles=tris)
        os.replace(path + ".tmp", path)
    elif os.path.exists(path):
        os.remove(path)
    flat = tris.reshape(-1, 3)
    bounds = [flat.min(0).round(4).tolist(), flat.max(0).round(4).tolist()] if len(flat) else [[0, 0, 0], [0, 0, 0]]
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    os.makedirs(evidence, exist_ok=True)
    record = {"parts": parts, "triangles": int(len(tris)), "bounds": bounds, "voxel": O.OCCLUDER_VOXEL,
              "artifact": {"path": "occluders.npz", "trianglesSha256": hashlib.sha256(np.ascontiguousarray(tris, "<f4").tobytes()).hexdigest()} if ok else None}
    with open(os.path.join(evidence, "occluders.json" if ok else "occluders-FAILED.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=1, sort_keys=True)
    print("occluders", json.dumps(parts), "bounds", json.dumps(bounds), flush=True)
    return 0 if ok else 1


COMMANDS["occluders"] = cmd_occluders
```

- [ ] **Step 6: Run it twice and compare the arrays** (CPU only, minutes; two separate processes)

```bash
cd D:/claude/real-hall/repo/tools/relight \
 && C:/Python313/python.exe -m relight occluders --config config/grand-hall.json; cp D:/claude/relight/grand-hall/work/occluders.npz D:/claude/relight/grand-hall/verify/r1d/occluders-run1.npz \
 && C:/Python313/python.exe -m relight occluders --config config/grand-hall.json; cp D:/claude/relight/grand-hall/work/occluders.npz D:/claude/relight/grand-hall/verify/r1d/occluders-run2.npz \
 && C:/Python313/python.exe -c "import numpy as np;a,b=(np.load(f'D:/claude/relight/grand-hall/verify/r1d/occluders-run{i}.npz')['triangles'] for i in (1,2));print('identical' if a.dtype==b.dtype and a.shape==b.shape and a.tobytes()==b.tobytes() else 'DIFFER', a.shape)"
```
Expected: each run prints both parts with triangles and bounds within the hall box (x −1.823..19.307, y −10.329..0.301, z 0.02..6.78, within 0.1 m); then `identical (T, 3, 3)` with T at most 1,500,000. (`np.savez` stamps the zip's time, so the arrays are compared, not the files.) `DIFFER`: a third run and the majority. A part with no triangles exits 1 and writes no `occluders.npz` (its evidence in `occluders-FAILED.json`): stop and report.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add tools/relight/relight/occluders.py tools/relight/tests/test_occluders.py tools/relight/relight/__main__.py && git diff --cached --stat && git commit -m "feat(relight): the simplified interior occluder model for the sun's shadow map (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The cinematic package and its contract (offline)

**Files:**
- Create: `tools/relight/relight/cinematic.py`, `tools/relight/tests/test_cinematic.py`, `docs/engineering/cinematic-package.md`
- Modify: `tools/relight/relight/__main__.py` (the `cinematic` command, directly above `if __name__ == "__main__":`)
- Outputs (D:): the staged package `D:/claude/splats/trades-hall/grand-hall/cinematic/v1/` (exactly `manifest.json` and `occluders.bin.gz`, written only when the build passes), `D:/claude/relight/grand-hall/evidence/r1d/cinematic.json` (or `cinematic-FAILED.json`), `D:/claude/relight/grand-hall/verify/r1d/cinematic-run{1,2}/`

**Interfaces:**
- Consumes: Task 1's `<work>/bulbs.json` (v2: `tableSha256`; `bulbs[]` with `id`, `group`, `kind`, `chandelier`, `position`; `chandeliers[]` with `id`, `centre`, `crisp`), Task 2's `<work>/occluders.npz`, R1a's `<work>/floor-light.npz` (`D` (h, w, 9) float32, the nine sources' direct light per unit weight; `texelToModel` 16 row-major), relight package v2's `manifest.json` (R1c; `model.tileToModel` and R1a Task 4b's `lamps.groups[g].colour`, each group's lamp/daylight colour at full level), `cfg.room["hallE57"]`, `cfg.room["slug"]`, `cfg.paths["out"]` (`…/relight/v1`), `cfg.paths["repo"]`, `cfg.room["windows"]`; the bake's house-light refit `<work>/bulb-intensities.json`, required (R1a Task 4b as amended 8 October: `{ schema, wCrown, bulbs: { <lamp id>: { kind, intensity } }, fit: { notLamps, tableSha256, … } }`, the 140 lamps, a crown tube at `wCrown` × a candle's); and once Task 21 has run, `<work>/night-calibration.json` and `<work>/eye-anchors.json`.
- Produces (`cinematic.py`): `SCHEMA = "venviewer.cinematic.v1"`, `SOURCE_INDEX = {"ch_end": 6, "ch_centre": 7}`, `ENVELOPES = {"candle": {"radius": 0.0175, "height": 0.07}, "crown": {"radius": 0.0125, "height": 0.05}}`, `BULB_KINDS = ("candle", "crown")`, `PLANCK_RANGE = (1667.0, 25000.0)`, `LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")`, `DEFAULT_DIMMING = "warm"`, `D65_CCT = 6504.0`, `DAYLIGHT_RANGE` (D60 and D75), `WINDOW_PROBE_DISTANCE = 2.0`, `EYE_ANCHORS = ("day", "lamps", "moon")`, `MAX_BULBS = 512`, `SHARES_SCHEMA = "venviewer.bulb-intensities.v1"`; `texel_of(point, texel_to_model, width, height) -> (column, row)`; `texel_point(column, row, texel_to_model) -> (3,)`; `bulb_shares(path, bulbs, table_sha256) -> {id: float}` (the refit required; refuses another table, other lamps or kinds); `bulb_intensities(direct, texel_to_model, bulbs, chandeliers, shares) -> {id: float}`; `projected_solid_angle(point, x0, x1, sill, top, y0, cells=48) -> float`; `window_radiance(direct, texel_to_model, windows, y0) -> list[float]`; `daylight_xy(cct) -> (x, y)`; `xy_to_linear_srgb(x, y) -> (3,)`; `mccamy_cct(rgb) -> float`; `warm_down(relight_manifest: dict) -> dict` (`{ groups: { <group>: { fullCct, range } }, provenance }`); `lamp_groups() -> dict`; `probe_placements(hall) -> list[dict]`; `bulb_entries(bulbs, intensities) -> list[dict]`; `night_gains(path) -> dict`; `eye_anchors(path) -> dict | None`; `package_paths(cfg) -> (relight_manifest, out_dir)`; `package_files(fields: dict, triangles) -> (manifest, files: {name: bytes})`; `write_package(out_dir, files) -> None` (refuses a folder holding any other file); the command `cinematic`.
- Produces (data, the contract): `venviewer.cinematic.v1` as `docs/engineering/cinematic-package.md` defines it, read by Task 8.

A lamp's GGX sheen (Task 17) and a crisp lamp's brightness (Task 11) must agree with the light the lamp already throws on the floor, so each crisp lamp's intensity is solved from R1a's floor light, per unit of the group's own source weight (decision 11: no weight is assumed). Under each covered chandelier the group's baked direct light equals the group intensity times its geometry: the sum over the group's crisp bulbs of their shares times `cosθ / d²`, plus, for each of the group's chandeliers without crisp lamps yet, its bulbs at its centre (the group's mean bulbs per covered chandelier), since the bake's source holds every chandelier of the group and at 5 m or more a chandelier is a point to within a few per cent. The median over covered chandeliers is the group intensity; each bulb's is that times its share. The shares are the bake's refit (R1a Task 4b writes `bulb-intensities.json` before R1d starts; it is required): one intensity φ per candle and `wCrown` × φ per crown tube, normalised to a mean of 1 per group, so a crown tube takes `wCrown` of a candle's share of the floor-solved light (the controller's ruling L2). The refit must be of Task 1's table (its `fit.tableSha256`) and name exactly Task 1's lamps with the same kinds; a lamp it lists among `fit.notLamps`, a missing or extra lamp, or another kind is refused, so a brass glint can never be drawn as a lamp, nor a lamp left dark by the bake drawn lit. Each window's sky radiance per unit source weight is solved the same way: 2 m into the room in front of the window, its baked direct light on the floor divided by the window's projected solid angle there (the light has already crossed the embrasure and the glass). An arched window (W1, W3, W5) is taken as its bounding rectangle, a design approximation: it overstates W1's opening by about 7% of its area, so W1's radiance is understated by as much. Each kind of lamp has its own envelope, a design value for Blake to judge: a candle is a frosted candle lamp 35 mm across and 70 mm tall above its holder (the common C35 candle; the venue's lamp product is asked for, light study §b9); a crown tube is a smaller frosted cylinder, 25 mm across and 50 mm tall (the study saw "small cylindrical crown lamps"; their clipped cores cover 0.49 of a candle's in the same faces, about 0.7 of its size, though that mixes size with brightness). The lamps' dimming (decision 11): every group `warm` (the owner's artistic warm-down), each group's warm-down starting at its own colour temperature (the controller's ruling L3): McCamy's formula on the group's colour in relight package v2 (R1a Task 4b's fitted colour, `lamps.groups[g].colour`, relative to daylight) against CIE daylight at D65, D60 to D75 recorded as its range; a start outside the Planckian fit's range (1,667–25,000 K) refuses the build. Three reflection probes stand on the hall's long axis at eye height, each boxed by the hall. The night gains are 1 and the eye's anchors absent until Task 21 measures them. The package is built in memory and written only when it passes, exactly its two files (the owner's packaging rule of 7 October: a folder that holds anything else is refused); its files' SHA-256 go into `<evidence>/r1d/cinematic.json`. Everything is written deterministically: `createdAt` is the commit's time and the gzip carries no timestamp.

Verified (7 October): R1a's `floor-light.npz` layout (R1a Task 4 report, Addendum: `D` (h, w, 9), 424 × 212 texels at 0.05 m, columns toward −x, rows toward +y, row 0 on the window side; `texelToModel` row-major); `docs/engineering/relight-package.md` (sources W1..W5, cove, ch_end, ch_centre, dome: indices 5–8); `tools/relight/config/grand-hall.json` (`paths.out`, `paths.repo`, `room.slug`, `room.hallE57`, `room.windows`: W1, W3 and W5 `arch`); `D:/claude/relight/grand-hall/work/lamp_daylight_ratio.json` (`lamp_over_daylight_rgb` [1.623, 1.0, 0.467], the ratio R1a Task 4b's group colours are fitted around); the contract's `lamps.groups[g].colour` (`docs/engineering/relight-package.md`, "Manifest": `capture.colours[source] / capture.daylightColour`) and R1a Task 4b's `bulb-intensities.json` (R1a plan, Task 4b's Produces, amended 8 October); the CIE daylight locus (CIE 15:2004, x_D for 4,000–7,000 K and 7,000–25,000 K, y_D = −3.000 x_D² + 2.870 x_D − 0.275) and McCamy's CCT (*Color Res. Appl.* 17(2):142–144, 1992: n = (x − 0.3320)/(0.1858 − y), CCT = 449n³ + 3525n² + 6823.3n + 5520.33): the measured ratio gives 3,700.1 K at D65 (6,504 K) and 3,537.4–3,984.7 K for D60–D75, and the dome at its prior offset (−0.350 stop R/G, +0.173 B/G) 4,368.3 K (4,168.6–4,722.6 K) (computed 7 and 8 October with this task's code; the light study's spectral reading, `D:/claude/real-hall/frontier/light/evidence/lamp_colours.json`: 3,509, 3,672, 3,956 K). This task's code and its 17 tests ran on 8 October in a scratch copy, with Task 1's real lamps, the real `floor-light.npz` and a refit file shaped as R1a's at w_crown 0.3871: 0.043983 per `ch_end` candle, 0.025072 per `ch_centre` candle and 0.009705 per crown tube, per unit weight.

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
TABLE = "a" * 64
LAMPS = [{"id": "c0_b00", "group": "ch_end", "kind": "candle"}, {"id": "c0_b01", "group": "ch_end", "kind": "candle"},
         {"id": "c2_b00", "group": "ch_centre", "kind": "candle"}, {"id": "c2_b41", "group": "ch_centre", "kind": "crown"}]


def refit(table=TABLE, drop=None, extra=None, not_lamps=(), kinds=None, values=None) -> dict:
    """R1a Task 4b's bulb-intensities.json: every lamp {kind, intensity}, a crown tube at wCrown x its candle's."""
    intensity = {"c0_b00": 3.0, "c0_b01": 1.0, "c2_b00": 7.0, "c2_b41": 2.8, **(values or {})}
    kind = {lamp["id"]: lamp["kind"] for lamp in LAMPS} | (kinds or {})
    bulbs = {i: {"kind": kind[i], "intensity": intensity[i]} for i in intensity if i != drop}
    if extra is not None:
        bulbs[extra] = {"kind": "candle", "intensity": 1.0}
    return {"schema": C.SHARES_SCHEMA, "wCrown": 0.4, "bulbs": bulbs, "fit": {"notLamps": ["c0_b07", *not_lamps], "tableSha256": table}}


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

    def test_the_bakes_refit_divides_each_group_its_crown_tubes_at_their_weight(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "bulb-intensities.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(refit(), f)
            shares = C.bulb_shares(path, LAMPS, TABLE)
        self.assertEqual([shares["c0_b00"], shares["c0_b01"]], [1.5, 0.5])
        self.assertAlmostEqual(shares["c2_b00"], 7.0 / 4.9, places=12)
        self.assertAlmostEqual(shares["c2_b41"], 2.8 / 4.9, places=12)       # wCrown 0.4 x the candle's 7

    def test_a_refit_that_is_missing_or_disagrees_with_the_lamps_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "bulb-intensities.json")
            with self.assertRaises(FileNotFoundError):
                C.bulb_shares(path, LAMPS, TABLE)
            bad = [dict(refit(), schema="venviewer.bulb-intensities.v0"), refit(table="b" * 64),
                   refit(drop="c0_b01"), refit(extra="c4_b00"), refit(not_lamps=["c0_b01"]),
                   refit(kinds={"c2_b41": "candle"}), refit(values={"c0_b00": 0.0})]
            for case in bad:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(case, f)
                with self.assertRaises(ValueError):
                    C.bulb_shares(path, LAMPS, TABLE)

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

    def test_each_entry_carries_its_lamps_kind_and_intensity(self):
        entries = C.bulb_entries([{"id": "c2_b41", "group": "ch_centre", "kind": "crown", "chandelier": 2, "position": [1.0, 2.0, 4.0], "views": 30, "rayMm": 3.0}],
                                 {"c2_b41": 7.123456789})
        self.assertEqual(entries, [{"id": "c2_b41", "group": "ch_centre", "kind": "crown", "chandelier": 2, "position": [1.0, 2.0, 4.0], "intensity": 7.123457}])


class Lamps(unittest.TestCase):
    def test_mccamy_puts_srgb_white_at_d65(self):
        self.assertAlmostEqual(C.mccamy_cct(np.array([1.0, 1.0, 1.0])), 6504.0, delta=3.0)
        x, y = C.daylight_xy(C.D65_CCT)
        self.assertAlmostEqual(x, 0.3127, delta=2e-4)
        self.assertAlmostEqual(y, 0.3291, delta=2e-4)

    def test_each_groups_warm_down_starts_at_its_own_colour_temperature(self):
        chandeliers_colour = [1.623, 1.0, 0.467]
        dome = [1.623 * 2 ** -0.35, 1.0, 0.467 * 2 ** 0.173]          # the dome's prior offset from the chandeliers'
        manifest = {"lamps": {"groups": {"cove": {"colour": chandeliers_colour}, "ch_end": {"colour": chandeliers_colour},
                                         "ch_centre": {"colour": chandeliers_colour}, "dome": {"colour": dome}}}}
        warm = C.warm_down(manifest)
        self.assertEqual(list(warm["groups"]), list(C.LAMP_GROUPS))
        self.assertEqual(warm["groups"]["ch_end"], {"fullCct": 3700.1, "range": [3537.4, 3984.7]})
        self.assertEqual(warm["groups"]["dome"], {"fullCct": 4368.3, "range": [4168.6, 4722.6]})
        self.assertIn("McCamy", warm["provenance"])
        with self.assertRaises(ValueError):
            C.warm_down({"lamps": {"groups": dict(manifest["lamps"]["groups"], cove={"colour": [1.0, 0.0, 1.0]})}})

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

    def test_a_calibration_with_a_bad_or_coloured_gain_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "night-calibration.json")
            for cove in ([1, 1, 0], [1, 1.1, 1]):
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({"gains": {"cove": cove, "ch_end": [1, 1, 1], "ch_centre": [1, 1, 1], "dome": [1, 1, 1]}}, f)
                with self.assertRaises(ValueError):
                    C.night_gains(path)


class Writer(unittest.TestCase):
    def test_the_package_is_deterministic_checksummed_and_exactly_its_files(self):
        tris = np.arange(18, dtype=np.float32).reshape(2, 3, 3)
        warm = {"fullCct": 3700.1, "range": [3537.4, 3984.7]}
        fields = {"room": "grand-hall", "createdAt": "2026-10-03T21:40:00+01:00", "tool": "abc",
                  "tileToModel": [float(v) for v in np.eye(4).ravel()], "tableSha256": TABLE,
                  "relight": {"package": "relight/v2", "manifestSha256": "0" * 64}, "bulbs": [], "chandeliers": chandeliers(),
                  "windowRadiance": [1.0, 2.0, 3.0, 4.0, 5.0], "warmDown": {"groups": {g: warm for g in C.LAMP_GROUPS}, "provenance": "test"},
                  "groups": C.lamp_groups(), "probes": [], "night": C.night_gains("missing.json"), "eye": None}
        first, files = C.package_files(fields, tris)
        self.assertEqual(C.package_files(fields, tris), (first, files))
        self.assertEqual(sorted(files), ["manifest.json", "occluders.bin.gz"])
        data = files["occluders.bin.gz"]
        self.assertEqual(first["files"], {"occluders.bin.gz": {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}})
        self.assertEqual(np.frombuffer(gzip.decompress(data), "<f4").reshape(-1, 3, 3).tolist(), tris.tolist())
        self.assertEqual(json.loads(files["manifest.json"]), first)
        self.assertEqual([first["schema"], first["occluders"]["triangles"], first["bulbs"]["tableSha256"]], [C.SCHEMA, 2, TABLE])
        self.assertEqual(first["bulbs"]["envelopes"], C.ENVELOPES)
        self.assertEqual(first["lamps"]["groups"]["dome"], {"dimming": "warm"})
        self.assertEqual(first["lamps"]["warmDown"]["groups"]["dome"], warm)
        self.assertEqual([c["crisp"] for c in first["chandeliers"]], [True, False, True, False, False])
        with tempfile.TemporaryDirectory() as folder:
            C.write_package(folder, files)
            for name, expected in files.items():
                with open(os.path.join(folder, name), "rb") as f:
                    self.assertEqual(f.read(), expected)
            with open(os.path.join(folder, "stale.bin"), "wb") as f:
                f.write(b"0")
            with self.assertRaises(ValueError):
                C.write_package(folder, dict(files, **{"manifest.json": b"{}"}))
            # Refused before writing: the package already there is untouched (finding NB2).
            with open(os.path.join(folder, "manifest.json"), "rb") as f:
                self.assertEqual(f.read(), files["manifest.json"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematic -v`
Expected: FAIL — `ImportError: cannot import name 'cinematic' from 'relight'`.

- [ ] **Step 3: Implement** — create `tools/relight/relight/cinematic.py`:

```python
"""The cinematic package (venviewer.cinematic.v1, T-639 R1d plan Task 3).

What R1d's browser reads beside the relight package: the crisp lamps at the triangulated lamps (Task 1), each with
its kind (a candle, or one of the centre chandelier's crown tubes) and its intensity per unit of its group's source
weight (solved from R1a's floor light and divided between the lamps by the bake's refit, so a lamp's crisp glass, its
specular and its diffuse light agree; no weight is assumed), the chandeliers whose glow the browser hides, the lamps'
dimming (warm by the owner's artistic choice, LED-true on a flag) and each group's warm-down starting temperature
(from that group's colour in the relight package), the interior occluder model (Task 2), the reflection probes'
placements, the night calibration and the eye's anchors (Task 21). Contract: docs/engineering/cinematic-package.md.
The same inputs and commit give the same bytes."""
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
#: The crisp lamps' envelopes by kind (design values for Blake; the venue's lamp product is asked for): a frosted
#: candle lamp 35 mm across and 70 mm tall above its holder (the common C35), and the centre chandelier's crown tube,
#: a smaller frosted cylinder 25 mm across and 50 mm tall ("small cylindrical crown lamps", splats study §d6.0; their
#: clipped cores cover 0.49 of a candle's area in the same faces, about 0.7 of its size, though that mixes size with
#: brightness).
ENVELOPES = {"candle": {"radius": 0.0175, "height": 0.07}, "crown": {"radius": 0.0125, "height": 0.05}}
BULB_KINDS = ("candle", "crown")
#: The Planckian fit's range (lamp-dimming.ts, Kang et al. 2002): a warm-down must start inside it.
PLANCK_RANGE = (1667.0, 25000.0)
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
#: The bake's house-light refit (R1a Task 4b): each lamp's kind and intensity per unit of its group's weight.
SHARES_SCHEMA = "venviewer.bulb-intensities.v1"


def texel_of(point, texel_to_model, width: int, height: int) -> tuple[int, int]:
    """The light-map texel nearest a model point's x and y: the in-plane inverse of texelToModel, clamped."""
    t = np.asarray(texel_to_model, np.float64).reshape(4, 4)
    column, row = np.linalg.solve(t[:2, :2], np.asarray(point, np.float64)[:2] - t[:2, 3])
    return int(min(max(round(column), 0), width - 1)), int(min(max(round(row), 0), height - 1))


def texel_point(column: int, row: int, texel_to_model) -> np.ndarray:
    t = np.asarray(texel_to_model, np.float64).reshape(4, 4)
    return (t @ np.array([column, row, 0.0, 1.0]))[:3]


def bulb_shares(path: str, bulbs: list[dict], table_sha256: str) -> dict:
    """Each crisp lamp's share of its group's intensity: the bake's refit (R1a Task 4b's bulb-intensities.json, each
    lamp {kind, intensity}; a crown tube's intensity is wCrown x its chandelier's candle's) normalised to a mean of 1
    per group. Refused: a missing file or another schema, a refit of another table, a refit whose lamps are not exactly
    Task 1's (a lamp missing, a lamp listed among fit.notLamps, an extra lamp), a kind unlike Task 1's, or an intensity
    that is not positive and finite."""
    with open(path, encoding="utf-8") as f:
        refit = json.load(f)
    if refit.get("schema") != SHARES_SCHEMA:
        raise ValueError(f"The bake's bulb intensities must be {SHARES_SCHEMA}")
    fit = refit.get("fit", {})
    if fit.get("tableSha256") != table_sha256:
        raise ValueError("The bake's refit was made from another bulb table than Task 1's")
    lamps = refit["bulbs"]
    ours = {b["id"] for b in bulbs}
    not_lamps = set(fit.get("notLamps", []))
    if ours & not_lamps or set(lamps) != ours:
        raise ValueError(f"The bake's lamps differ from Task 1's: missing {sorted(ours - set(lamps))}, extra "
                         f"{sorted(set(lamps) - ours)}, listed as not lamps {sorted(ours & not_lamps)}")
    out = {}
    for group in sorted({b["group"] for b in bulbs}):
        members = [b for b in bulbs if b["group"] == group]
        values = []
        for bulb in members:
            entry = lamps[bulb["id"]]
            value = entry.get("intensity") if isinstance(entry, dict) else None
            if entry.get("kind") != bulb["kind"]:
                raise ValueError(f"The bake's refit calls lamp {bulb['id']} a {entry.get('kind')!r}, Task 1 a {bulb['kind']!r}")
            if not isinstance(value, (int, float)) or not np.isfinite(value) or value <= 0:
                raise ValueError(f"The bake's refit gives lamp {bulb['id']} no positive intensity: {value!r}")
            values.append(float(value))
        mean = sum(values) / len(values)
        out.update({bulb["id"]: value / mean for bulb, value in zip(members, values)})
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


def warm_down(relight_manifest: dict) -> dict:
    """Where each group's artistic warm-down starts (the controller's ruling L3: per group, from R1a Task 4b's fitted
    colour for that group): the colour temperature of the group's lamp/daylight colour in the relight package
    (lamps.groups[g].colour) times CIE daylight at D65, with D60-D75 as its range (the daylight the colours are relative
    to is not known better). It shapes the dimming only: at full level the bake's colour is kept."""
    groups = {}
    for group in LAMP_GROUPS:
        colour = np.asarray(relight_manifest["lamps"]["groups"][group]["colour"], np.float64)
        if colour.shape != (3,) or not np.all(np.isfinite(colour)) or colour.min() <= 0:
            raise ValueError(f"The relight package's {group} colour must be three positive numbers: {colour.tolist()}")
        at = lambda cct: mccamy_cct(colour * xy_to_linear_srgb(*daylight_xy(cct)))  # noqa: E731
        low, high = sorted(at(t) for t in DAYLIGHT_RANGE)
        groups[group] = {"fullCct": round(at(D65_CCT), 1), "range": [round(low, 1), round(high, 1)]}
    return {"groups": groups,
            "provenance": "McCamy CCT of each group's lamp/daylight colour in the relight package (R1a Task 4b) against "
                          "CIE daylight D65 (range D60-D75)"}


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
    """The manifest's crisp lamps: id, group, kind, chandelier, position (e57 = the model frame) and intensity (6
    figures)."""
    return [{"id": b["id"], "group": b["group"], "kind": b["kind"], "chandelier": int(b["chandelier"]),
             "position": [float(v) for v in b["position"]], "intensity": round(float(intensities[b["id"]]), 6)} for b in bulbs]


def night_gains(path: str) -> dict:
    """Task 21's per-group night gains, or ones when it has not run. A gain is one positive number per group, written
    as three equal channels (the browser's RGB weights): it moves light between the groups and never changes a group's
    colour, which stays the bake's (R1a Task 4b)."""
    if not os.path.exists(path):
        return {"calibrated": False, "gains": {g: [1.0, 1.0, 1.0] for g in LAMP_GROUPS}, "evidence": None}
    with open(path, encoding="utf-8") as f:
        calibration = json.load(f)
    gains = {g: [float(v) for v in calibration["gains"][g]] for g in LAMP_GROUPS}
    for group, gain in gains.items():
        if len(gain) != 3 or not all(np.isfinite(gain)) or min(gain) <= 0 or max(gain) != min(gain):
            raise ValueError(f"The night gain of {group} must be one positive number in three equal channels: {gain}")
    return {"calibrated": True, "gains": gains, "evidence": calibration.get("evidence")}


def package_paths(cfg) -> tuple[str, str]:
    """(relight package v2's manifest, the cinematic package's folder): beside R1a's relight/v1 in the same room."""
    relight_root = os.path.dirname(os.path.normpath(cfg.paths["out"]))
    return os.path.join(relight_root, "v2", "manifest.json"), os.path.join(os.path.dirname(relight_root), "cinematic", "v1")


def package_files(fields: dict, triangles: np.ndarray) -> tuple[dict, dict]:
    """The package in memory: its manifest and its two files' bytes, manifest.json and occluders.bin.gz (float32
    little-endian triangles, gzip without a timestamp). The manifest names exactly the occluders in `files`."""
    tris = np.ascontiguousarray(np.asarray(triangles, "<f4"))
    data = gzip.compress(tris.tobytes(), compresslevel=9, mtime=0)
    flat = tris.reshape(-1, 3)
    bounds = ([flat.min(0).astype(float).round(4).tolist(), flat.max(0).astype(float).round(4).tolist()]
              if len(flat) else [[0.0] * 3, [0.0] * 3])
    manifest = {
        "schema": SCHEMA, "room": fields["room"], "createdAt": fields["createdAt"], "tool": fields["tool"],
        "model": {"frame": "e57", "tileToModel": fields["tileToModel"]},
        "relight": fields["relight"],
        "bulbs": {"envelopes": ENVELOPES, "tableSha256": fields["tableSha256"], "entries": fields["bulbs"]},
        "chandeliers": [{"id": int(c["id"]), "centre": [float(v) for v in c["centre"]], "crisp": bool(c["crisp"])} for c in fields["chandeliers"]],
        "lamps": {"windowRadiance": fields["windowRadiance"], "warmDown": fields["warmDown"], "groups": fields["groups"], "night": fields["night"]},
        "occluders": {"file": OCCLUDER_FILE, "triangles": int(len(tris)), "bounds": bounds},
        "reflections": {"probes": fields["probes"]},
        "eye": fields["eye"],
        "files": {OCCLUDER_FILE: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}},
    }
    text = json.dumps(manifest, indent=1, sort_keys=True, allow_nan=False)
    return manifest, {"manifest.json": text.encode("utf-8"), OCCLUDER_FILE: data}


def write_package(out_dir: str, files: dict) -> None:
    """Refuse a folder that holds any file the package does not name, then write the package's files (each through a
    temporary name): a published package is exactly its manifest and the files it names (the owner's packaging rule,
    7 October), and a refused build leaves the package already there as it was (finding NB2)."""
    os.makedirs(out_dir, exist_ok=True)
    strays = sorted(set(os.listdir(out_dir)) - set(files))
    if strays:
        raise ValueError(f"{out_dir} holds files the manifest does not name: {strays}")
    for name, data in files.items():
        path = os.path.join(out_dir, name)
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
```

- [ ] **Step 4: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematic -v`
Expected: PASS, 17 tests.

- [ ] **Step 5: Register the command** — add to `tools/relight/relight/__main__.py`, directly above `if __name__ == "__main__":`:

```python
def cmd_cinematic(cfg, args) -> int:
    """The cinematic package (R1d Task 3) beside relight package v2: the crisp lamps, their kinds and intensities, the
    chandeliers, the lamps' dimming and each group's warm-down, the occluders, the reflection probes and the night
    gains. Built in memory and written only when it passes (exactly its two files); <evidence>/r1d/cinematic.json
    (cinematic-FAILED.json on a failure) records the files' SHA-256. Exit 1 if there is no crisp lamp, a lamp has no
    positive intensity, there are more than MAX_BULBS, or a group's warm-down starts outside the Planckian fit."""
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
    # The bake's refit is required (R1a Task 4b): its lamps, kinds and table must be Task 1's.
    shares = C.bulb_shares(os.path.join(work, "bulb-intensities.json"), bulbs, placed["tableSha256"])
    intensity = C.bulb_intensities(direct, texel_to_model, bulbs, chandeliers, shares)
    repo = cfg.paths["repo"]
    commit = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    created = subprocess.run(["git", "-C", repo, "log", "-1", "--format=%cI"], capture_output=True, text=True, check=True).stdout.strip()
    warm = C.warm_down(relight)
    fields = {
        "room": cfg.room["slug"], "createdAt": created, "tool": commit,
        "tileToModel": [float(v) for v in relight["model"]["tileToModel"]], "tableSha256": placed["tableSha256"],
        "relight": {"package": "relight/v2", "manifestSha256": hashlib.sha256(relight_bytes).hexdigest()},
        "bulbs": C.bulb_entries([b for b in bulbs if b["id"] in intensity], intensity), "chandeliers": chandeliers,
        "windowRadiance": C.window_radiance(direct, texel_to_model, cfg.room["windows"], float(cfg.room["hallE57"]["y0"])),
        "warmDown": warm, "groups": C.lamp_groups(),
        "probes": C.probe_placements(cfg.room["hallE57"]),
        "night": C.night_gains(os.path.join(work, "night-calibration.json")),
        "eye": C.eye_anchors(os.path.join(work, "eye-anchors.json")),
    }
    manifest, files = C.package_files(fields, triangles)
    entries = manifest["bulbs"]["entries"]
    starts = [g["fullCct"] for g in warm["groups"].values()]
    ok = (bool(entries) and len(entries) == len(bulbs) and all(e["intensity"] > 0 for e in entries) and len(entries) <= C.MAX_BULBS
          and all(C.PLANCK_RANGE[0] <= t <= C.PLANCK_RANGE[1] for t in starts))
    # Gate before write: the served folder is only ever a package that passed, exactly its two files; a folder holding a
    # stray file refuses the build before anything is written (finding NB2), and the refusal is recorded below.
    refused = None
    if ok:
        try:
            C.write_package(out_dir, files)
        except ValueError as error:
            ok, refused = False, str(error)
    evidence = os.path.join(cfg.paths["evidence"], "r1d")
    os.makedirs(evidence, exist_ok=True)
    record = {"ok": ok, "outDir": out_dir, "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
              "bulbs": len(entries), "warmDown": warm, "night": manifest["lamps"]["night"]["calibrated"], "eye": manifest["eye"] is not None,
              "refused": refused}
    with open(os.path.join(evidence, "cinematic.json" if ok else "cinematic-FAILED.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=1, sort_keys=True, allow_nan=False)
    groups = {g: sum(1 for b in bulbs if b["group"] == g) for g in C.SOURCE_INDEX}
    by_kind = {f"{g}/{k}": [e["intensity"] for e in entries if e["group"] == g and e["kind"] == k] for g in C.SOURCE_INDEX for k in C.BULB_KINDS}
    print("cinematic", out_dir, "bulbs", json.dumps(groups), "intensity", json.dumps({k: [min(v), max(v)] for k, v in by_kind.items() if v}),
          "warm-down", json.dumps({g: v["fullCct"] for g, v in warm["groups"].items()}),
          "triangles", manifest["occluders"]["triangles"], "night calibrated", manifest["lamps"]["night"]["calibrated"],
          "written" if ok else "REFUSED", flush=True)
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

A package folder holds exactly these two files, and `files` names exactly `occluders.bin.gz` (the owner's packaging
rule of 7 October): the builder refuses a folder holding anything else, and the browser refuses a `files` entry no
field names.

## Manifest

- `schema`: `"venviewer.cinematic.v1"`; `room`; `createdAt` (the building commit's time); `tool` (that commit).
- `model`: `{ frame: "e57", tileToModel: 4×4 row-major }`, equal to the relight package's (the browser refuses a
  package whose matrix differs by more than 1e-9).
- `relight`: `{ package: "relight/v2", manifestSha256 }`: the relight manifest it was built against (recorded; the
  browser checks the model frame, not this hash, so a later relight package of the same frame still works).
- `bulbs`: `{ envelopes: { candle: { radius, height }, crown: { radius, height } }, tableSha256, entries: [{ id,
  group: "ch_end" | "ch_centre", kind: "candle" | "crown", chandelier, position: [x, y, z], intensity }] }`: the crisp
  lamps at the chandelier lamps that the frontier splats study triangulated from the photographs (ids are its
  table's, `c<chandelier>_b<nn>`; `tableSha256` is that table's SHA-256): its `high` and `medium` entries, 140 on the
  7 October table; `low` and `exclude` entries are not lamps. `kind` is `crown` for the centre chandelier's crown
  tubes (only `ch_centre` lamps can be), `candle` otherwise; `envelopes` are the frosted lamps drawn for each kind
  (design values: a candle 35 mm across and 70 mm tall, a crown tube 25 mm across and 50 mm tall). `intensity` is the
  lamp's intensity per unit of its group's source weight (a lamp lights a surface with `weights[k] × intensity ×
  cosθ / d²`), solved from the baked floor light under each chandelier and divided between the lamps by the bake's
  refit (R1a Task 4b: one intensity per candle, `wCrown` of it per crown tube). At most 512 entries. The dome has
  none: its bright "emitters" are crests lit by LED pin spots.
- `chandeliers`: five `{ id, centre: [x, y, z], crisp }`. While the crisp lamps draw, the browser hides every glow
  splat (record class 3, the chandelier emitter class) whose nearest chandelier centre, horizontally, is `crisp`; a
  chandelier the table does not cover keeps its glow, unboosted.
- `lamps`: `{ windowRadiance, warmDown: { groups: { cove, ch_end, ch_centre, dome: { fullCct, range: [low, high] } },
  provenance }, groups: { cove, ch_end, ch_centre, dome: { dimming: "warm" | "led" } }, night: { calibrated, gains:
  { cove, ch_end, ch_centre, dome: [g, g, g] }, evidence } }`. `windowRadiance` (five numbers, W1..W5) is each
  window's sky radiance per unit source weight as the room sees it through the opening (the window's light is
  `weights[k] × windowRadiance[k]`), solved from the baked floor light 2 m in front of it (an arched window taken as
  its bounding rectangle, a design approximation that understates W1's radiance by about 7%). `dimming` is how a
  group fades: `warm`, the default, is an artistic choice (Blake, 7 October; the hall's lamps are LED and do not warm
  when dimmed): light d^3.4 and colour temperature d^0.42 of the group's `warmDown.groups[g].fullCct`; `led` is the
  lamps' own, constant colour on the DALI logarithmic curve. At full level every group's light is exactly the relight
  package's times its night gain. Each group's `fullCct` is the colour temperature of that group's own colour in the
  relight package (`lamps.groups[g].colour`, R1a Task 4b's fit, relative to daylight) against CIE daylight D65
  (McCamy), `range` the same for D60–D75. A night gain is one number per group, written as three equal channels: it
  multiplies the group's weight and never changes its colour (1 until the night calibration has run).
- `eye`: `null`, or `{ anchors: { day, lamps, moon: { exposure, whiteBalance: [r, g, b], logLuminance, logChroma:
  [r/g, b/g] } } }`: each calibrated anchor's display, the reference view's log2 log-average luminance (before
  exposure) measured in the browser at that anchor as the eye measures every frame, and the log2 chroma of the
  anchor's light colour (R1d Task 21). The eye adapts to the rendered frame against these anchors; without them it
  falls back to the baked floor light, read from the GPU's sky light.
- `occluders`: `{ file, triangles, bounds: [[min], [max]] }`: the chandeliers and the window wall's pilasters as 4 cm
  voxel shells (R1d Task 2), the casters of the sun's interior shadow map.
- `reflections`: `{ probes: [{ position: [x, y, z], box: [[min], [max]] }] }`: the reflection probes and the box each
  one is projected onto.
- `files`: `{ "occluders.bin.gz": { sha256, bytes } }`, the one file besides the manifest.

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
Expected: each run prints the crisp lamps per group (`{"ch_end": 93, "ch_centre": 47}`), each group and kind's intensity range (all positive; on 7 October's floor light with the refit's shares, every lamp of a kind equal: 0.043983 per `ch_end` candle, about 0.0251 per `ch_centre` candle and `wCrown` of that per crown tube, 0.009705 at w_crown 0.3871), each group's warm-down start (the chandeliers' near 3,700 K when their fitted colour is near the measured ratio, the dome's near 4,370 K at its prior; whatever R1a Task 4b fitted, never a constant), the triangle count and `written`; then `identical`. A refused refit (another table, other lamps or kinds) raises `ValueError` naming it, and no crisp lamp, a lamp without positive intensity or a warm-down start outside 1,667–25,000 K exits 1 (`REFUSED`, nothing written, the evidence in `cinematic-FAILED.json`): stop and report.

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
- Produces: `type LampDimming = "warm" | "led"`, `LAMP_DIMMINGS`; `WARM_LIGHT_EXPONENT = 3.4`, `WARM_CCT_EXPONENT = 0.42`, `LED_DECADES = 3`, `PLANCK_MIN_CCT = 1667`, `PLANCK_MAX_CCT = 25000`; `planckRgb(cct: number): Rgb` (linear sRGB, G = 1, negatives clamped to 0); `dimmedOutput(drive: number, dimming: LampDimming): number`; `warmCct(drive: number, fullCct: number): number`; `dimmedTint(drive: number, dimming: LampDimming, fullCct: number | null): Rgb` (exactly `[1, 1, 1]` at full drive, for `led`, and without a warm-down temperature; otherwise keeps the colour's luminance). No lamp temperature is a constant here: each group's warm-down starts at its own temperature from the cinematic package (`lamps.warmDown.groups[g].fullCct`, Task 3; the controller's ruling L3), which Task 6 passes in.

Decision 11 and spec §4.1 (amended 7 October, commit 475acd2e): lamps fade, never switch, and dim warm. A group's drive d (0 off, 1 full) comes from Task 5's spring. The hall's lamps are LED and keep their colour as they dim, so the warm-down is Blake's artistic choice and is labelled so in the code: it borrows a gas-filled tungsten lamp's look, d^3.4 of the light at d^0.42 of the colour temperature (the usual voltage laws for tungsten filament lamps; the light study's T = T₀ (Φ/Φ₀)^0.1235), so a fading group passes through amber like a candle. The LED-true curve keeps the colour and follows the DALI logarithmic dimming curve (IEC 62386-102: arc power levels 1–254 span 0.1% to 100% of the light evenly in log, X(n) = 10^((n − 1)/(253/3) − 1) %; with n = 1 + 253d this is 10^(3(d − 1)) of full light), the curve the hall's programmable dimming system would use if it is DALI (not known; a design value). Both give exactly the full light at d = 1 and none at d = 0, so every preset's lamps (all on or all off) are unchanged. The colour is the Planckian locus in CIE 1931 xy by Kang et al.'s cubic fit (*J. Korean Phys. Soc.* 41(6):865–871, 2002; valid 1,667–25,000 K), taken to linear sRGB exactly as R1b's `daylightRgb` takes the daylight locus (the same matrix, green 1). The tint is relative: the faded colour over the full colour, scaled so the colour's luminance is unchanged (brightness is `dimmedOutput` alone), so at full level every group keeps the bake's colour exactly whatever the starting temperature; the temperature only shapes how the colour warms. Below about 1,700 K the locus leaves the sRGB gamut and blue clamps to 0. The warm-down's colour cost against LED-true dimming, measured by the frontier light study (§e d3, 8 October, from a 2,750 K start): 1.5–1.65 times the median chroma at 10% light and 3.2–3.8 times at 1%; from the chandeliers' 3,700 K this law reaches 2,780 K at 10% light and 2,095 K at 1%. The warm-down stays (Blake's choice); the cost is in Task 24's list for him.

Reference values, computed with this task's code on 7 October (`node`, scratch script; 2,750 K is a test temperature, not the hall's): `planckRgb(2700) = [2.396114495, 1, 0.2396443072]`, `planckRgb(4000) = [1.531348647, 1, 0.5772511803]`, `planckRgb(2222) = [3.228367736, 1, 0.1001678783]` against `planckRgb(2221.999) = [3.228370194, 1, 0.1001675718]` (the fit's segments meet within 3e-6), `dimmedOutput(0.5, "warm") = 0.0947322854069`, `warmCct(0.5, 2750) = 2055.41771687`, `dimmedTint(0.5, "warm", 2750) = [1.295036608, 0.8166422786, 0.1561357948]` (the tinted colour's luminance 1.230377778, equal to the full colour's), `dimmedOutput(2/3, "led") = 0.1` and `dimmedOutput(1/3, "led") = 0.01` (to 12 places).

Verified (7 October): spec `docs/superpowers/specs/2026-10-03-r1-polished-design.md` §4.1 as amended by commit 475acd2e ("Lamps fade, never switch, with a warm-down as they dim… the warm dim is Blake's deliberate artistic choice… At full level each lamp group keeps its measured colour"); `D:/claude/real-hall/frontier/light/proposal.md` §b9 (the lamps are LED: the contractor's record, the frosted envelopes, the market) and §c4 (T = T₀ (Φ/Φ₀)^0.1235 for the incandescent law); R1b plan Task 4 lines 2072–2075 (`Rgb`, `LUMINANCE`, `LAMP_GROUPS`, `LampGroup` in `relight-kernel.ts`; lines as of 8 October, re-read after the pre-flight round); R1b plan Task 8 lines 5457–5468 (`daylightRgb`: the XYZ → linear sRGB rows and the G = 1 normalisation this task repeats).

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/lamp-dimming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LAMP_DIMMINGS, PLANCK_MAX_CCT, PLANCK_MIN_CCT, dimmedOutput, dimmedTint, planckRgb, warmCct,
} from "../lamp-dimming.js";

/** A test temperature only: each group's warm-down starts at the cinematic package's `lamps.warmDown.groups[g].fullCct`. */
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
- Produces (`eye.ts`): `EYE_ANCHOR_NAMES = ["day", "lamps", "moon"]`, `type EyeAnchorName`; `interface EyeAnchor { readonly exposure: number; readonly whiteBalance: Rgb; readonly logLuminance: number; readonly logChroma: readonly [number, number] }`; `type EyeAnchors`; `type LightShares = Readonly<Record<EyeAnchorName, number>>`; `interface FrameMeasurement { readonly logLuminance: number; readonly at: number }`; `LUMINANCE_ADAPTATION = 0.5`, `CHROMA_ADAPTATION = 0.6`, `EYE_RANGE_STOPS = 3`, `PHOTOPIC_LUMINANCE = 5`, `SCOTOPIC_LUMINANCE = 0.1`, `CAO_KNEE_LUMINANCE = 0.62`, `CAO_KNEE_SHARE = 0.1`, `SCOTOPIC_MAX = 0.6`, `IDENTITY_EYE`; `interface LuminanceCalibration { readonly cdPerUnit: number; readonly uncertaintyStops: number; readonly provenance: string }`, `CAPTURE_CALIBRATION` (121.8 cd/m² per unit, ±1 stop: the frontier study's measurement); `normaliseShares(shares: LightShares): LightShares`; `lightChroma(colour: Rgb): readonly [number, number]`; `adaptationLuminance(logLuminance: number, calibration: LuminanceCalibration): number`; `scotopicAmount(luminance: number): number`; `anchoredEye(anchors: EyeAnchors, shares: LightShares, chroma: readonly [number, number], measured: FrameMeasurement | null, calibration: LuminanceCalibration): EyeTarget`.

Everything that moves in R1d's light moves through the one spring core, critically damped (stiffness ω², damping 2ω: the fastest approach without overshoot, so the sun never swings back and a lamp never flashes past its level). Measured with `stepSpring` at 60 fps (7 October, scratch script): ω = 3 reaches 95% in 1.60 s (the time-lapse: a 540-minute sweep moves at most 10 minutes per frame and settles in 5.0 s to 0.01 minute); ω = 4 in 1.20 s and ω = 2.5 in 1.92 s (the eye toward a brighter and a darker scene: "over one to two seconds", spec §4.3); ω = 5 in 0.97 s (the blend); the lamps (ω = 3) are a quarter of the way up after 0.3 s. A spring that settles snaps to its target, so at rest the displayed light is exactly the chosen one (the captured light's display is exactly 1).

The displayed instant is a London day number and fractional minutes. A change of hour within the day sweeps the minutes spring (the time-lapse). Crossing midnight (live time, or "Now" a little after midnight) is the same sweep: the target is expressed against the displayed day (one day is 1,440 minutes) and the displayed day and minutes are re-based whenever the minutes leave 0..1440, so the sun moves on without a jump. Any other change of date, and any change of time under reduced motion, is a cross-fade instead: the instant jumps and a blend spring fades the old light out and the new one in (the director mixes the two lights, Task 9); a target that changes during a blend waits for it to finish, so the light never pops. A change of the light's kind at the same instant (another weather, or the captured light) is the same cross-fade (`crossFade`). Live time's own progress (a minute per minute) is not motion: the director sets it with `retime` and reapplies the light only when the Sun or the Moon has moved 0.02°, so a still, live hall runs no pass for seconds at a time. The eye's springs work in log2 (exposure, white balance's red and blue over green) and take the brighter or darker rate by the exposure's direction. `lightMoving` is true while anything but the eye moves: the director reapplies the light only then, and only moves the display while the eye alone adapts.

The eye's target (decision 4): each anchor (the sunny day, the lamp-lit night, the moonlit night; Task 21 measures them) carries its calibrated display, the log-average luminance of the reference view measured at it on the GPU (as Task 13 measures every frame) and its light's colour. The target mixes the anchors in log space by each one's share of the light; each anchor is corrected by half the difference between its luminance and the frame's (an eye never adapts fully; R1b's `adaptDisplay` uses the same half) and by 60% of the difference between its light's colour and the current light's (again R1b's rule), within eightfold of the anchors. Colour adaptation reads the light's colour, not the frame's, so the display's own scotopic tint (Task 16) can never feed back into the white balance. Before the first measurement the anchors' own luminance stands in; afterwards the latest measurement holds until the next (Task 9). The scotopic amount comes from the adaptation luminance in cd/m², through the capture's absolute calibration: the frontier light study measured k_abs = 121.8 cd/m² per unit of the fit's light × albedo (a frame value) from the capture day's sky by its pre-registered method (the 35–55° band the fit's window weights stand for, modelled at the capture's hour from the reanalysis: 82–147 across the five windows, 85 under a clear sky; ±1 stop, and it depends on the sky's shape; `D:/claude/real-hall/frontier/light/proposal.md` §e d2, 8 October, double-run and identical), so L = 121.8 × 2^λ cd/m². It replaces the study's §b4 estimate of 54, which fell 1.17 stops low. On that scale the captured hall's median is about 21 cd/m² and the lamp-lit night's about 16 (d3's log-average over its three views: 8.7–11.4), photopic with 0.8–1.6 stops to spare (CIE 191:2010's mesopic range lies below about 5 cd/m²). The shift is therefore driven by absolute luminance and never by the preset: none at 5 cd/m² or above (so the approved night is neither greyed nor blue-shifted), and below that shaped by Cao's rod gains as the study's d3 tabulates them (Cao et al. 2008 through Wanat & Mantiuk 2014; `scripts/d3_night_vision.py:155`: the gain k1 is 0.173 at 0.1 cd/m², 0.0173 at 0.62 and 0 at 10, interpolated in log luminance), the shift following k1's share of its maximum: a tenth of the way at 0.62 cd/m² (`CAO_KNEE_LUMINANCE`, `CAO_KNEE_SHARE`), the full 0.6 by 0.1, 7.7% of it at 1 cd/m² against Cao's 8.3%, and 7–8% at the study's 10% lamps (0.86–1.15 cd/m²). Cao's zero is at 10 cd/m²; R1d holds it at 5, so the approved night (8.7–16 cd/m²) keeps exactly none, and the ramp stays within 0.025 of Cao's share everywhere (the largest gap at 5 cd/m²). The shift follows k1, the gain on the long- and middle-wave cones that carry luminance (the study's "10% at 0.62"); k2, on the short-wave cones, falls faster (2.8% there). It reaches dimmed lamps, the blue hour without lamps and moonlight (d3's moonlit city adapts at about 0.001 cd/m²). When the spectral package's calibration exists (an upgrade, §c9 `calibration.kAbsCdPerUnit`) it replaces `CAPTURE_CALIBRATION` through the same interface. The 1–2 s adaptation is a deliberate compression for a clock that sweeps hours in seconds (dark adaptation takes minutes, §b5): the product calls it adaptation, time-compressed, never physiological timing.

Verified (7 October; the calibration and the ramp again on 8 October): `D:/claude/real-hall/frontier/light/proposal.md` §e d2 (k_abs 121.8 cd/m² per fit unit by the pre-registered 35–55° band anchor; `evidence/d2_sky_scenes.json` `absolute_calibration`: per window 82.3–146.7, median 121.83, clear sky 84.6; the captured hall 0.1704 × 121.8 = 20.8 and the night 0.1281 × 121.8 = 15.6 cd/m²) and §e d3 (`evidence/d3_night_vision.json`: Cao's rod gains at most 0.0008 at the lamp-lit night's 8.7–11.4 cd/m², at their maximum by 0.1 cd/m²; CIECAM16's D 0.742–0.745), `D:/claude/real-hall/frontier/light/scripts/d3_night_vision.py:155` (`_Y_TAB, _K1_TAB, _K2_TAB = np.log10([0.10, 0.62, 10.0]), [0.173, 0.0173, 0.0], [0.357, 0.0101, 0.0]`) and `:159-163` (`k_rod`: interpolated in log10 luminance, held at the 0.1 values below and zero above 10; read 8 October, round 4), §b5, §c9; `packages/web/src/lib/springs.ts:12-22` (`SpringConfig { stiffness, damping }`, `SpringState { value, velocity }`), `:48-64` (`stepSpring(state, target, dtSeconds, config)`: semi-implicit Euler in 1/240 s substeps, `dtSeconds` clamped to 0.25 s at `:55`), `:67-75` (`isSpringSettled(state, target, epsilon = 0.001)`); R1b plan lines 2074–2075 (`LAMP_GROUPS`, `LampGroup`); R1b plan lines 5710–5720 (`adaptDisplay`: exposure × √(reference/current) within eightfold, white balance × (ratio)^0.6, green 1) (R1b's lines as of 8 October). 

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
    expect(CAPTURE_CALIBRATION.cdPerUnit).toBe(121.8);
    expect(adaptationLuminance(Math.log2(10 / 121.8), CALIBRATION)).toBeCloseTo(10, 9);
    expect(adaptationLuminance(0, { ...CALIBRATION, cdPerUnit: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the captured hall and the lamp-lit night photopic, and the moonlit city fully dark-adapted (frontier light study §e)", () => {
    expect(scotopicAmount(adaptationLuminance(Math.log2(0.1704), CALIBRATION))).toBe(0);
    expect(scotopicAmount(adaptationLuminance(Math.log2(0.1281), CALIBRATION))).toBe(0);
    expect(scotopicAmount(8.7)).toBe(0);   // d3's darkest view of the lamp-lit night
    expect(scotopicAmount(adaptationLuminance(Math.log2(0.001 / CALIBRATION.cdPerUnit), CALIBRATION))).toBe(SCOTOPIC_MAX);
  });

  it("shifts toward the rods only below 5 cd/m², as Cao's rod gains rise (the study's d3 table), fully by 0.1, at most 0.6", () => {
    expect([scotopicAmount(5), scotopicAmount(500), scotopicAmount(0.1), scotopicAmount(1e-6), scotopicAmount(0)])
      .toEqual([0, 0, SCOTOPIC_MAX, SCOTOPIC_MAX, SCOTOPIC_MAX]);
    expect(scotopicAmount(0.62)).toBeCloseTo(0.1 * SCOTOPIC_MAX, 12);
    expect(scotopicAmount(Math.sqrt(0.62 * 0.1))).toBeCloseTo(0.55 * SCOTOPIC_MAX, 12);
    expect(scotopicAmount(1) / SCOTOPIC_MAX).toBeCloseTo(0.0771, 4);
    // Cao's k1 as a share of its maximum (0.173 at 0.1 cd/m², 0.0173 at 0.62, 0 at 10, linear in log luminance): the
    // ramp holds its zero at 5 cd/m² rather than 10, and stays within 0.025 of Cao's share everywhere between.
    const knee = Math.log10(0.62);
    const cao = (y: number) => (y <= knee ? 0.1 + (0.9 * (knee - y)) / (knee + 1) : Math.max(0, (0.1 * (1 - y)) / (1 - knee)));
    for (let step = 0; step <= 200; step += 1) {
      const y = -1 + step / 100;
      expect(Math.abs(scotopicAmount(10 ** y) / SCOTOPIC_MAX - cao(y))).toBeLessThanOrEqual(0.025);
    }
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
 * The light's motion (T-639 R1d, spec §4.1 and §4.3): the displayed hour as a critically damped time-lapse, each lamp
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
 * The eye (T-639 R1d decision 4; spec §4.3 "eye adaptation over one to two seconds to the scene's light, anchored
 * to the calibrated presets"). The target mixes three calibrated anchors by each one's share of the light, each
 * corrected by half the difference between its measured luminance and the rendered frame's (measured on the GPU,
 * Task 13) and by 60% of the difference between its light's colour and the current light's, within eightfold of
 * the anchors. Below 5 cd/m² it mixes toward the rods' response (Thompson, Shirley & Ferwerda 2002; the display
 * applies it, Task 16) as Cao's rod gains rise (the frontier light study, §e d3): a tenth of the way at 0.62 cd/m², all
 * of the 0.6 by 0.1.
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
/**
 * R1b's rule: 60% of a change in the light's colour. CIECAM16's degree of adaptation in these scenes is 0.74 (the
 * frontier light study, §e d3, 8 October); raising this toward it would take 17–34% of the approved night's chroma, so
 * 0.6 stays at the anchors unless Blake prefers the stronger adaptation.
 */
export const CHROMA_ADAPTATION = 0.6;
export const EYE_RANGE_STOPS = 3;
export const PHOTOPIC_LUMINANCE = 5;
/** Full night vision by 0.1 cd/m², where Cao's rod gains saturate (the frontier light study, §e d3, 8 October). */
export const SCOTOPIC_LUMINANCE = 0.1;
/**
 * Cao's rod gain k1 (Cao et al. 2008, as Wanat & Mantiuk 2014 tabulate it; the frontier light study's d3,
 * `scripts/d3_night_vision.py:155`) is a tenth of its maximum at 0.62 cd/m²: the ramp passes through it.
 */
export const CAO_KNEE_LUMINANCE = 0.62;
export const CAO_KNEE_SHARE = 0.1;
export const SCOTOPIC_MAX = 0.6;
export const IDENTITY_EYE: EyeTarget = { exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 };

/** Absolute luminance of a frame value (light × albedo in the fit's units): the spectral package's, when it exists, replaces it. */
export interface LuminanceCalibration {
  readonly cdPerUnit: number;
  readonly uncertaintyStops: number;
  readonly provenance: string;
}
/**
 * k_abs, measured from the capture day's modelled sky by the frontier light study's pre-registered method
 * (D:/claude/real-hall/frontier/light/proposal.md §e d2, 8 October; double-run, identical): the 35–55° band the fit's
 * window weights stand for, 82–147 across the windows, 85 under a clear sky. It replaces the §b4 estimate of 54.
 */
export const CAPTURE_CALIBRATION: LuminanceCalibration = {
  cdPerUnit: 121.8,
  uncertaintyStops: 1,
  provenance: "frontier light study e/d2, 8 Oct 2026: the 35-55 degree sky band at capture, median of the windows (82-147; 85 clear sky); depends on the sky's shape",
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

/**
 * The night-vision mix at an adaptation luminance (cd/m²): Cao's k1 as a share of its maximum, linear in log luminance
 * through its table's 0.1 and 0.62 cd/m² rows, times SCOTOPIC_MAX. Its zero is held at PHOTOPIC_LUMINANCE (5 cd/m²)
 * rather than Cao's 10, so the approved night keeps none; within 0.025 of Cao's share everywhere, the most at 5 cd/m².
 */
export function scotopicAmount(luminance: number): number {
  if (!(luminance > SCOTOPIC_LUMINANCE)) return SCOTOPIC_MAX;
  if (luminance >= PHOTOPIC_LUMINANCE) return 0;
  const log = Math.log10(luminance), knee = Math.log10(CAO_KNEE_LUMINANCE);
  const share = log >= knee
    ? (CAO_KNEE_SHARE * (Math.log10(PHOTOPIC_LUMINANCE) - log)) / (Math.log10(PHOTOPIC_LUMINANCE) - knee)
    : CAO_KNEE_SHARE + ((1 - CAO_KNEE_SHARE) * (knee - log)) / (knee - Math.log10(SCOTOPIC_LUMINANCE));
  return SCOTOPIC_MAX * share;
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
- Create: `packages/web/src/lib/relight/sky-instant.ts`, `packages/web/src/lib/relight/sky-colour.ts`
- Test: `packages/web/src/lib/__tests__/light-setting.test.ts`, `packages/web/src/stores/__tests__/light-setting-store.test.ts`, `packages/web/src/components/rooms/__tests__/LightControl.test.tsx` (modify); `packages/web/src/lib/relight/__tests__/sky-instant.test.ts`, `packages/web/src/lib/relight/__tests__/sky-colour.test.ts` (create)

**Interfaces:**
- Consumes: R1b's `light-setting.ts` as amended by A1, A4 and A7 (`LIGHT_PRESETS`, `PRESET_DEFAULTS`, `PRESET_DISPLAY`, `PRESET_EMITTER_BOOST`, `WeatherPreset`, `LightInputs` with `unitsPerLux`, `ChoiceLight` with `moon`, `settingForChoice`, `settingForSky`, `londonOffsetHours`, `londonLocalToUtc`, `isIsoDate`, `clampMinutes`, `luminanceOf`); `moonPosition`, `MoonPosition`, `MOON_CCT` (A3); `solarPosition`, `sunDirection`, `SolarPosition` (R1b Task 6); Task 4 (`LampDimming`, `dimmedOutput`, `dimmedTint`, `planckRgb`); Task 5 (`LampDrives`, `MotionInstant`, `normaliseShares`, `LightShares`); R1b's `daylight.ts` (`CAPTURE_DAYLIGHT_CCT`, `daylightRgb`, `cctShift`; R1b plan lines 5455–5475) for `sky-colour.ts`; the frontier light study's `evidence/d2_sky_scenes.json` (`twilight_curve`, the scenes' `direct_sun`) and §e e3 for its tables.
- Produces (`light-setting.ts`): `LIGHT_PRESETS = ["live", "captured", "night", "moonlit", "sunny", "overcast"]`; `WeatherPreset = Exclude<LightPresetId, "captured" | "live">`; `MIN_MINUTES = 0`, `MAX_MINUTES = 1439`; `type LampMode = "auto" | "on" | "off"`, `LAMP_MODES`; `PRESET_LAMPS`; `LAMPS_ON_ELEVATION = 7`; `MOON_NEGLIGIBLE = 1e-5`; `interface LampGroupLight { readonly dimming: LampDimming; readonly warmFullCct: number | null; readonly gain: Rgb }` (each group's own warm-down start: the controller's ruling L3), `interface LampLight { readonly groups: Readonly<Record<LampGroup, LampGroupLight>> }`, `STEADY_LAMPS` (every group LED-true with gain 1 and no warm-down temperature: the light without the cinematic package); `interface SkyLight extends ChoiceLight { sun; moon; shares: LightShares; colour: Rgb; moonSky: { level: number; colour: Rgb }; sheen: number }` (`sheen`: 1 for every computed sky; Task 9's captured light has 0); `weatherOf(preset: Exclude<LightPresetId, "captured">): WeatherPreset`; `lampsLitFor(sunElevation: number): boolean`; `lampTargets(mode: LampMode, sunElevation: number): LampDrives`; `interface SkyExtras { readonly city: readonly Rgb[] | null; readonly keepMoon: boolean; readonly colourByElevation?: boolean }` (`colourByElevation`: the frontier study's measured colours, asked for by the cinematic light only), `NO_EXTRAS`; `cityLevel(sunElevation: number): number`; `lightForSky(inputs: LightInputs, weather: WeatherPreset, sun: SolarPosition, moon: MoonPosition, drives: LampDrives, lamps: LampLight, extras?: SkyExtras): SkyLight` (`extras.city`: each window's light from the street-lit facade and the skyglow at full night, Task 15; `extras.keepMoon` keeps a negligible Moon for Task 23's both-bodies budget); `settingForChoice` and `settingForSky` rebuilt on it (same results for every preset); `dayNumber(date: string): number`; `dateOfDay(day: number): string`; `londonClock(now: Date): MotionInstant`; `liveChoice(now: Date): LightChoice`.
- Produces (`sky-colour.ts`): `SUN_CCT_BY_ELEVATION`, `MOON_CCT_BY_ELEVATION` ([degrees, K]), `TWILIGHT_SKY_XY` ([degrees, x, y]), `TWILIGHT_FROM_ELEVATION = 2`; `xyRgb(x, y): Rgb`; `relativeToCapture(rgb: Rgb): Rgb`; `planckShift(cct: number): Rgb`; `cctAtElevation(table, elevation): number`; `sunBeamShift(weatherShift: Rgb, elevation: number, referenceElevation: number): Rgb`; `moonBeamShift(elevation: number): Rgb`; `skyShiftAt(elevation: number, weatherShift: Rgb): Rgb`.
- Produces (`sky-instant.ts`): `interface SkyAt { readonly utc: Date; readonly sun: SolarPosition; readonly moon: MoonPosition }`; `instantOf(at: MotionInstant): Date`; `skyAt(at: MotionInstant, latitude: number, longitude: number): SkyAt`.
- Produces (store): `follow: boolean`, `lamps: LampMode`, `setLamps(lamps: LampMode): void`, `followClock(): void`; the store starts live (`liveChoice(new Date())`, following, lamps automatic); `selectPreset` sets each preset's lamps and stops following (live follows); `setMinutes` and `setDate` stop following.

Live time is the default (spec §4.1): the hall at London's real hour, in clear weather until R2 brings the real weather, with automatic lamps. It is a preset (`live`, labelled "Live") whose weather is the clear morning's and whose display anchor is the sunny morning's (`PRESET_DEFAULTS.live` and `PRESET_DISPLAY.live` repeat the sunny preset's, so R1b's `applicationForChoice` carries it like any preset when the cinematic package is absent); the clock follows real time while `follow` is true, which "Now" (Task 20) restores in any weather. The clock spans the whole day (the Moon is mostly a night light), so the hour runs 00:00–23:59.

The lamps (decision 3) have three modes: automatic (lit while the Sun is below 7°, about an hour before sunset in Glasgow, where the low Sun descends some 6–8° an hour), on and off. Every preset keeps its own: the night lit; the moonlit night, sunny morning and overcast noon off; live automatic (every proof scenario's `house` is exactly 1 or 0, `05_relight.py:36–42`, so the switch's on and off reproduce them exactly). A lamp group's drive (0..1, Task 5's spring) sets its light as `w[k]c[k] ⊙ dimmedTint(d) × dimmedOutput(d) × gain` and its emitters' level as `dimmedOutput(d)` with `lampTints` (amendment A1), where the group's dimming is the cinematic package's (decision 11: `warm`, the artistic warm-down from that group's own start, `lamps.warmDown.groups[g].fullCct`, by default (the controller's ruling L3: there is no single start); `led` on the per-group flag) and the gain is Task 21's night calibration (one number per group, so the group's colour stays the bake's; ones until then). Without the package every group fades LED-true at the bake's colour (no warm-down temperature is known). At drive 0 and 1 with gain 1 every curve gives exactly R1b's light, so every preset's setting, and so every test vector, is unchanged; the group's colour at full level is always the relight package's own.

Both bodies count whenever their light can show (decision 2): the Moon is dropped only when its light is below 1/100,000 of the day's and the lamps' together (in daylight, or under lit chandeliers), where it cannot move a displayed pixel by a tenth of a code; a day Moon's disc still shows in the windows (Task 15), and Task 23 measures the frame budget with both bodies forced on. In clear weather the Moon also lights its own sky: the clear sky's relation to its Sun (the Sun's strength is `sunRatio × sky × mean window weight`) taken backwards gives the moonlit sky's level, in the clear sky's colour relative to the Sun's applied to moonlight. It enters through the windows' weights; R1b's `skyLevel` stays the Sun's sky (so the proof's night is exactly reproduced), and the night sky panels read the moonlit sky from `moonSky` (Task 15). The eye's shares (Task 5) are each part's light: the day (the Sun and its sky), the lamps and the Moon (with its sky), with their summed colour for the eye's white balance. They are summed in the light's own units (the weights, the bodies' RGB), not in floor light, an approximation kept on purpose: the shares only mix the eye's anchors in log space, each anchor then corrected by half the measured frame's difference (Task 5), and only where two parts are comparable (dusk with the lamps lit, a lamp fade under the Moon) does the weighting matter; and `MOON_NEGLIGIBLE` (1e-5) sits about two orders of magnitude below a tenth of a code (about 1e-3 of the light: finding M6), so the factor of four or five the scan found between these shares and floor light cannot make a visible Moon negligible. Floor shares would need GPU read-backs every frame only for the bodies' direct beams: the lamps' and the windows' sky light have static floor means per unit weight (R1a Task 4's basis), but the Sun's and the Moon's direct light on the floor depends on their march, which ruling E1 keeps off the per-frame path.

The city lights the hall at night (the frontier light study, `D:/claude/real-hall/frontier/light/proposal.md` §b3): the facade across Glassford Street fills 55–83% of each window's view, lit by street lighting to about 1 cd/m², far brighter than the skyglow, so mid-hall receives some 0.03–0.1 lux from it and a full Moon's patch is only 1–3× its surroundings. `lightForSky` adds each window's city light (`extras.city`, built by Task 15 from the package's window radiance, each window's view of the facade and the calibration) scaled by `cityLevel`: street lighting comes up through dusk, none with the Sun above the horizon and all of it below −6°. It counts in the night's share for the eye. R1b's own settings (`settingForChoice`, `settingForSky`) pass no extras, so R1a's vectors and every R1b test are unchanged; only the cinematic light's director adds the city.

The sky's colours follow the frontier light study's measurements (`D:/claude/real-hall/frontier/light/proposal.md` §e, 8 October, every product double-run and identical) when the cinematic light asks for them (`extras.colourByElevation`, which the director sets while the cinematic package is in use; R1b's own settings never ask, so every R1b test and R1a vector stands). The Sun's beam reddens toward the horizon (at AOD 0.1: 1,480 K at 1°, 3,760 K at 10°, 5,310 K at 60°; a fixed colour misses exactly the low morning Sun that enters these windows), applied as the measured change from the weather's reference hour, so each preset at its own hour keeps R1b's colour exactly. The Moon's beam reddens likewise (3,640 K at 17°, 2,920 K at 7.5°) from R1b's `MOON_CCT`, which the study's 4,248 K confirms with the Moon 60.7575° up (`evidence/d2_sky_scenes.json`; 60.8° rounded). That Moon is the moonlit preset's own (60.75755° by R1b's port, which omits the study's 30 m of height, so a little higher), so the table's top row is at 60.7575° and from there up the beam is R1b's exactly, the moonlit preset included; lower Moons are redder. The clear sky's blue hour lies at or beyond 25,000 K and below the Planckian locus, so a colour temperature cannot express it: it is taken in CIE xy from the study's twilight curve, blending from the weather's own sky colour at 2° to the measured twilight at 0° and below (clear weather only; overcast keeps its weather's colour until R2). The moonlit sky keeps the model's sky colour (only the Sun's twilight is blue). Below about 1.6° the Planckian fit holds the Sun at 1,667 K (the study gives 1,480 K at 1°).

`skyAt` computes both bodies at the displayed instant itself: NOAA's Sun and the Meeus Moon (A3) take microseconds each, so the light is exact at every frame of a time-lapse.

Verified (7 October; R1b's line numbers re-read on 8 October): R1b plan Task 8 (`light-setting.ts`, lines 5484–5721: `LIGHT_PRESETS`, `type WeatherPreset`, `MIN_MINUTES`/`MAX_MINUTES`, `PRESET_DEFAULTS`, `PRESET_DISPLAY`, `PRESET_EMITTER_BOOST`, `defaultChoice`, `londonOffsetHours`, `isIsoDate`, `londonLocalToUtc`, `clampMinutes`, `formatMinutes`, `LightInputs` at 5591, `lightInputsFromParts`: `presets.night` is `{ weather: clear, house, lampLevel }`, `const luminanceOf`, `adaptDisplay` at 5714), the store (5726–5761), the control (`LABELS`, 9761–9768; its doc comment's "an hour between 06:00 and 22:00", 9772), the control's tests (9637–9661), `light-setting.test.ts` (5237–5381: `expectSetting` compares weights, sky, `lampLevels`, `emitterBoost`, `sunDir`, `sunRgb` to 1e-6; the clamp test at 5297); R1b plan line 2076 (`type LampLevels`); amendment A1 (`PRESET_EMITTER_BOOST` with `moonlit`; `RelightSetting.lampTints`), A4 (amendments lines 577–731: `unitsPerLux` at 602–613, `ChoiceLight` at 616, `settingForChoice` at 627, `settingForSky` at 641), A7 (lines 927–951: `LIGHT_PRESETS` with `moonlit`, `PRESET_DEFAULTS.moonlit`, `MOONLIT_DISPLAY_KEY`); `tools/relight/relight/codec.py:11` (`SOURCES`: W1–W5, then `cove`, `ch_end`, `ch_centre`, `dome`, the order of `LAMP_GROUPS`); `tools/relight/proof/05_relight.py:36-42` (`house` 1.0 at night, 0.0 otherwise).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/sky-colour.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MOON_CCT } from "../../moon.js";
import { cctShift } from "../daylight.js";
import {
  MOON_CCT_BY_ELEVATION, SUN_CCT_BY_ELEVATION, TWILIGHT_SKY_XY, cctAtElevation, moonBeamShift, planckShift, relativeToCapture,
  skyShiftAt, sunBeamShift, xyRgb,
} from "../sky-colour.js";

const ratio = (rgb: readonly number[]): number => (rgb[0] ?? 0) / (rgb[2] ?? 1);

describe("the sky's measured colours (T-639 R1d)", () => {
  it("reads the frontier study's tables in mired, held at their ends", () => {
    expect([cctAtElevation(SUN_CCT_BY_ELEVATION, 10), cctAtElevation(SUN_CCT_BY_ELEVATION, -5), cctAtElevation(SUN_CCT_BY_ELEVATION, 90)]).toEqual([3760, 1480, 5310]);
    expect(cctAtElevation(SUN_CCT_BY_ELEVATION, 5)).toBeCloseTo(1 / ((1 / 3) / 2280 + (2 / 3) / 3100), 9);
    expect(cctAtElevation(MOON_CCT_BY_ELEVATION, 7.5)).toBe(2920);
    expect(() => cctAtElevation([], 10)).toThrow(RangeError);
  });

  it("applies the measured reddening as a change, so R1b's colours stand where it measured them", () => {
    const weather = cctShift(5000);
    expect(sunBeamShift(weather, 44.5, 44.5)).toEqual(weather);
    const low = sunBeamShift(weather, 3, 44.5);
    expect(low[1]).toBe(1);
    expect(ratio(low)).toBeGreaterThan(2 * ratio(weather));
    expect(ratio(sunBeamShift(weather, 60, 44.5))).toBeLessThan(ratio(weather));
    expect(moonBeamShift(70)).toEqual(cctShift(MOON_CCT));
    expect(moonBeamShift(60.7575)).toEqual(cctShift(MOON_CCT));
    expect(moonBeamShift(60.757546)).toEqual(cctShift(MOON_CCT));   // the moonlit preset's Moon by R1b's port (23 Dec 2026, 23:50 UTC)
    expect(moonBeamShift(60.7)).not.toEqual(cctShift(MOON_CCT));
    expect(ratio(moonBeamShift(7.5))).toBeGreaterThan(ratio(moonBeamShift(17)));
    expect(ratio(moonBeamShift(17))).toBeGreaterThan(ratio(cctShift(MOON_CCT)));
  });

  it("gives the clear blue hour in xy, bluer than any daylight, and the weather's own sky by day", () => {
    const weather = cctShift(7500);
    expect(skyShiftAt(2, weather)).toEqual(weather);
    expect(skyShiftAt(30, weather)).toEqual(weather);
    const deep = TWILIGHT_SKY_XY[3];
    if (deep === undefined) throw new Error("The table reaches −6°.");
    expect(skyShiftAt(-6, weather)).toEqual(relativeToCapture(xyRgb(deep[1], deep[2])));
    expect(ratio(skyShiftAt(-6, weather))).toBeLessThan(ratio(cctShift(25000)));
    const halfway = skyShiftAt(1, weather), zero = skyShiftAt(0, weather);
    expect(halfway[2]).toBeCloseTo((weather[2] + zero[2]) / 2, 12);
    expect(skyShiftAt(-30, weather)).toEqual(skyShiftAt(-8, weather));
  });

  it("takes xy and black bodies to the capture's terms: D65 is white, a warm street lamp red", () => {
    const d65 = xyRgb(0.3127, 0.329);
    expect(d65[0]).toBeCloseTo(1, 2);
    expect(d65[2]).toBeCloseTo(1, 2);
    const street = planckShift(3830);
    expect(street[1]).toBe(1);
    expect(street[0]).toBeGreaterThan(1.3);
    expect(street[2]).toBeLessThan(0.75);
  });
});
```

create `packages/web/src/lib/relight/__tests__/sky-instant.test.ts`:

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

The moonlit preset opens on the frontier study's brightest evening full Moon that the windows admit (Step 3), so replace `    expect(PRESET_DEFAULTS.moonlit).toEqual({ date: "2026-09-26", minutes: 1380 });` with `    expect(PRESET_DEFAULTS.moonlit).toEqual({ date: "2026-12-23", minutes: 1430 });`, and in the next test's title replace `by the full Moon of 26 September` with `by its full Moon` (the test's checks hold at the new date: the Moon 60.8° up and full, its light about 3e-6 of the morning Sun's, warmer than the Sun's colour).

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
    // Each group's warm-down starts at its own temperature (the controller's ruling L3): here the chandeliers' 3,700 K, the dome's 4,370 K.
    const warmGroup = { dimming: "warm", warmFullCct: 3700, gain: [1, 1, 1] } as const;
    const warm: LampLight = { groups: { cove: warmGroup, ch_end: warmGroup, ch_centre: warmGroup, dome: { ...warmGroup, warmFullCct: 4370 } } };
    const dimmed = lightForSky(inputs(), "night", sun, moon, half, warm).setting;
    const tint = dimmedTint(0.5, "warm", 3700), captured = inputs().captureWeights[6] ?? [0, 0, 0];
    [0, 1, 2].forEach((c) => { relClose(dimmed.weights[6]?.[c] ?? Number.NaN, (captured[c] ?? 0) * (tint[c] ?? 0) * dimmedOutput(0.5, "warm")); });
    expect(dimmed.lampLevels.ch_end).toBeCloseTo(dimmedOutput(0.5, "warm"), 12);
    expect(dimmed.lampTints?.ch_end).toEqual(tint);
    expect(tint[2]).toBeLessThan(tint[0]);
    expect(dimmed.lampTints?.dome).toEqual(dimmedTint(0.5, "warm", 4370));
    expect(dimmed.lampTints?.dome).not.toEqual(tint);
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
    const warmGroup = { dimming: "warm", warmFullCct: 3700, gain: [1, 1, 1] } as const, ledGroup = { dimming: "led", warmFullCct: 3700, gain: [1, 1, 1] } as const;
    const mixed: LampLight = { groups: { cove: ledGroup, ch_end: warmGroup, ch_centre: warmGroup, dome: warmGroup } };
    const setting = lightForSky(inputs(), "night", sun, moon, half, mixed).setting;
    expect(setting.lampTints?.cove).toEqual([1, 1, 1]);
    expect(setting.lampTints?.ch_end).toEqual(dimmedTint(0.5, "warm", 3700));
  });

  it("applies the night gains, one number per group, to the lamps' light only (R1d)", () => {
    const at = londonLocalToUtc(PRESET_DEFAULTS.night.date, PRESET_DEFAULTS.night.minutes);
    const sun = solarPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon = moonPosition(at, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE);
    const lamps: LampLight = { groups: { ...STEADY_LAMPS.groups, ch_end: { dimming: "led", warmFullCct: null, gain: [2, 2, 2] } } };
    const light = lightForSky(inputs(), "night", sun, moon, { cove: 1, ch_end: 1, ch_centre: 1, dome: 1 }, lamps).setting;
    const captured = inputs().captureWeights[6] ?? [0, 0, 0];
    expect(light.weights[6]).toEqual([captured[0] * 2, captured[1] * 2, captured[2] * 2]);
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

  it("reddens the beams and blues the clear twilight only when the cinematic light asks, keeping each preset's own hour (R1d)", () => {
    const off = { cove: 0, ch_end: 0, ch_centre: 0, dome: 0 };
    const measured = { city: null, keepMoon: false, colourByElevation: true };
    const sky = (date: string, minutes: number) => {
      const instant = londonLocalToUtc(date, minutes);
      return { sun: solarPosition(instant, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE), moon: moonPosition(instant, TRADES_HALL_LATITUDE, TRADES_HALL_LONGITUDE) };
    };
    const own = sky(PRESET_DEFAULTS.sunny.date, PRESET_DEFAULTS.sunny.minutes);
    expect(lightForSky(inputs(), "sunny", own.sun, own.moon, off, STEADY_LAMPS, measured).setting)
      .toEqual(lightForSky(inputs(), "sunny", own.sun, own.moon, off, STEADY_LAMPS).setting);
    // The moonlit preset's own Moon is the study's measured one (60.7575° up): its beam is R1b's exactly.
    const moonlit = sky(PRESET_DEFAULTS.moonlit.date, PRESET_DEFAULTS.moonlit.minutes);
    expect(moonlit.moon.elevation).toBeGreaterThanOrEqual(60.7575);
    expect(lightForSky(inputs(), "moonlit", moonlit.sun, moonlit.moon, off, STEADY_LAMPS, measured).setting.moonRgb)
      .toEqual(lightForSky(inputs(), "moonlit", moonlit.sun, moonlit.moon, off, STEADY_LAMPS).setting.moonRgb);
    // 05:30 BST on the sunny morning's date: the Sun a few degrees up, its beam redder than R1b's fixed colour.
    const low = sky(PRESET_DEFAULTS.sunny.date, 330);
    expect(low.sun.elevation).toBeGreaterThan(0);
    const red = lightForSky(inputs(), "sunny", low.sun, low.moon, off, STEADY_LAMPS, measured).setting;
    const plain = lightForSky(inputs(), "sunny", low.sun, low.moon, off, STEADY_LAMPS).setting;
    expect(red.sunRgb[0] / red.sunRgb[2]).toBeGreaterThan(plain.sunRgb[0] / plain.sunRgb[2]);
    // 16:30 GMT on 21 December: the Sun a few degrees below the horizon, the clear sky the measured blue hour.
    const dusk = sky("2026-12-21", 990);
    expect(dusk.sun.elevation).toBeLessThan(0);
    const blue = lightForSky(inputs(), "sunny", dusk.sun, dusk.moon, off, STEADY_LAMPS, measured).setting;
    const grey = lightForSky(inputs(), "sunny", dusk.sun, dusk.moon, off, STEADY_LAMPS).setting;
    expect(blue.skyColour[2] / blue.skyColour[0]).toBeGreaterThan(grey.skyColour[2] / grey.skyColour[0]);
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

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-colour.test.ts`
Expected: FAIL — cannot find module `../sky-colour.js`.

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
import { moonBeamShift, skyShiftAt, sunBeamShift } from "./relight/sky-colour.js";
import { normaliseShares, type LightShares } from "./relight/eye.js";
import type { LampDrives } from "./relight/light-motion.js";
```

Replace (A7's) `export const LIGHT_PRESETS = ["captured", "night", "moonlit", "sunny", "overcast"] as const;` with `export const LIGHT_PRESETS = ["live", "captured", "night", "moonlit", "sunny", "overcast"] as const;`, (A4's) `export type WeatherPreset = Exclude<LightPresetId, "captured">;` with `export type WeatherPreset = Exclude<LightPresetId, "captured" | "live">;`, `export const MIN_MINUTES = 360;` with `export const MIN_MINUTES = 0;` and `export const MAX_MINUTES = 1320;` with `export const MAX_MINUTES = 1439;`. In `PRESET_DEFAULTS`, directly before `  captured: { date: "2026-09-29", minutes: 720 },` add:

```ts
  /** Live time's choice is liveChoice(now); this entry is its display anchor, the clear morning's (R1d). */
  live: { date: "2026-05-31", minutes: 540 },
```

and replace (A7's) `  moonlit: { date: "2026-09-26", minutes: 1380 },` with:

```ts
  /** The frontier study's brightest evening full Moon the windows admit: 23:50 GMT, 60.8° up, 0.275 lux, 4,248 K (§e, 8 October). */
  moonlit: { date: "2026-12-23", minutes: 1430 },
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
  /**
   * Where this group's warm-down starts: the cinematic package's `lamps.warmDown.groups[g].fullCct`, from the group's
   * own colour (the controller's ruling L3); null without the package.
   */
  readonly warmFullCct: number | null;
  /** The group's night gain (the cinematic package, Task 21): one number in three equal channels; ones until calibrated. */
  readonly gain: Rgb;
}

export interface LampLight {
  readonly groups: Readonly<Record<LampGroup, LampGroupLight>>;
}

const LED_GROUP: LampGroupLight = { dimming: "led", warmFullCct: null, gain: [1, 1, 1] };
/** Without the cinematic package: no warm-down temperature is known, so every group fades at the bake's colour. */
export const STEADY_LAMPS: LampLight = { groups: { cove: LED_GROUP, ch_end: LED_GROUP, ch_centre: LED_GROUP, dome: LED_GROUP } };

/** What the cinematic light adds to a sky's light (R1d). */
export interface SkyExtras {
  /** Each window's light from the street-lit facade and the skyglow at full night (fit units, W1..W5; Task 15), or null. */
  readonly city: readonly Rgb[] | null;
  /** Keep a Moon too faint to show (Task 23's both-bodies budget only). */
  readonly keepMoon: boolean;
  /**
   * The frontier light study's measured colours (sky-colour.ts): the Sun's and the Moon's beams by their elevation and
   * the clear blue hour in CIE xy. Only the cinematic light asks (the director, with its package); R1b's settings never do.
   */
  readonly colourByElevation?: boolean;
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
  // The measured colours (extras.colourByElevation): each beam's change with its elevation, applied from R1b's colour at
  // the weather's own hour (and the Moon's from 60.7575° up, the moonlit preset's own Moon), so a preset at its own hour
  // keeps R1b's beams exactly; the clear twilight's
  // blue in CIE xy. The moonlit sky keeps the model's sky colour: only the Sun's twilight is blue.
  const measured = extras.colourByElevation === true;
  const sunBeam = measured ? sunBeamShift(sunShift, sun.elevation, model.referenceElevation) : sunShift;
  const moonBeam = measured ? moonBeamShift(moon.elevation) : moonShift;
  const skyTint = measured && model.sunRatio > 0 ? skyShiftAt(sun.elevation, skyShift) : skyShift;
  const daylight = inputs.daylightColour;
  const modelSky: Rgb = [daylight[0] * skyShift[0], daylight[1] * skyShift[1], daylight[2] * skyShift[2]];
  const skyColour: Rgb = [daylight[0] * skyTint[0], daylight[1] * skyTint[1], daylight[2] * skyTint[2]];
  const sunUp = model.sunRatio > 0 && sun.elevation > 0;
  const sunStrength = sunUp ? model.sunRatio * skyLevel * inputs.meanWindowWeight : 0;
  const sunRgb: Rgb = [sunStrength * (daylight[0] * sunBeam[0]), sunStrength * (daylight[1] * sunBeam[1]), sunStrength * (daylight[2] * sunBeam[2])];

  const level = (group: LampGroup): number => dimmedOutput(drives[group], lamps.groups[group].dimming);
  const tintOf = (group: LampGroup): Rgb => dimmedTint(drives[group], lamps.groups[group].dimming, lamps.groups[group].warmFullCct);
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
  const moonColour: Rgb = [daylight[0] * moonBeam[0], daylight[1] * moonBeam[1], daylight[2] * moonBeam[2]];
  const moonUp = model.sunRatio > 0 && moon.elevation > 0 && moon.illuminance > 0;
  const moonStrength = moonUp ? moon.illuminance * inputs.unitsPerLux : 0;
  const moonLight = moonStrength * luminanceOf(moonColour);
  const moonCounts = moonLight > 0 && (extras.keepMoon || moonLight >= MOON_NEGLIGIBLE * (dayLight + lampLight));
  const moonRgb: Rgb = moonCounts ? times(moonColour, moonStrength) : [0, 0, 0];
  // Its sky: the clear sky's relation to its Sun taken backwards, in the sky's colour relative to the Sun's.
  const moonSkyLevel = moonCounts ? moonStrength / (model.sunRatio * inputs.meanWindowWeight) : 0;
  const moonSkyColour: Rgb = [modelSky[0] * moonShift[0] / sunShift[0], modelSky[1] * moonShift[1] / sunShift[1], modelSky[2] * moonShift[2] / sunShift[2]];

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

- [ ] **Step 4: The sky at an instant, and its measured colours** — create `packages/web/src/lib/relight/sky-colour.ts`:

```ts
import { MOON_CCT } from "../moon.js";
import { CAPTURE_DAYLIGHT_CCT, cctShift, daylightRgb } from "./daylight.js";
import { planckRgb } from "./lamp-dimming.js";
import type { Rgb } from "./relight-kernel.js";

/**
 * The sky's colours as the frontier light study measured them (T-639 R1d; D:/claude/real-hall/frontier/light/proposal.md
 * §e, 8 October 2026, every product double-run and identical): the Sun's and the Moon's beams redden toward the horizon,
 * and the clear sky's blue hour lies off the Planckian locus, so it is given in CIE xy, never as a colour temperature.
 * Each is relative to the capture's daylight (green 1), as R1b's `cctShift` is. The beams carry the measured change
 * from a reference, never a second absolute colour: the Sun at a weather's own hour, and the Moon from 60.7575° up (the
 * moonlit preset's own Moon), keep R1b's colours exactly, so every preset's beams at its own hour are unchanged.
 */

/** The direct Sun at AOD 0.1 by elevation, [degrees, K] (§e d2 and e3; at AOD 0.4 the same elevations run 1,000–4,900 K). */
export const SUN_CCT_BY_ELEVATION: readonly (readonly [number, number])[] = [[1, 1480], [3, 2280], [6, 3100], [10, 3760], [20, 4550], [40, 5110], [60, 5310]];
/**
 * The direct Moon by elevation, [degrees, K] (§e d2). The top row is the study's moonlit Moon at its own elevation
 * (`evidence/d2_sky_scenes.json`: 4,248 K at 60.7575°, the moonlit preset's Moon), which agrees with R1b's MOON_CCT,
 * 4,100 K: from there up the beam is R1b's exactly.
 */
export const MOON_CCT_BY_ELEVATION: readonly (readonly [number, number])[] = [[7.5, 2920], [17, 3640], [60.7575, 4248]];
/**
 * The clear sky's colour through twilight by the Sun's elevation, [degrees, x, y] (§e d2's twilight curve,
 * `evidence/d2_sky_scenes.json`): from −4° down it is at or beyond 25,000 K and below the locus (Duv −0.002 to −0.018).
 */
export const TWILIGHT_SKY_XY: readonly (readonly [number, number, number])[] = [
  [0, 0.279, 0.2867], [-2, 0.2684, 0.2708], [-4, 0.2529, 0.2493], [-6, 0.2418, 0.2379], [-8, 0.2308, 0.2243],
];
/** At and above this Sun elevation the clear sky keeps its weather's colour; from 0° down it is the twilight table's. */
export const TWILIGHT_FROM_ELEVATION = 2;

/** Linear sRGB (green 1) of a CIE 1931 xy chromaticity, as daylight.ts takes the daylight locus; negatives clamp to 0. */
export function xyRgb(x: number, y: number): Rgb {
  const X = x / y, Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.2040 + 1.0570 * Z;
  return [Math.max(r / g, 0), 1, Math.max(b / g, 0)];
}

/** A colour relative to the capture's daylight, green 1 (R1b's `cctShift` for any colour). */
export function relativeToCapture(rgb: Rgb): Rgb {
  const capture = daylightRgb(CAPTURE_DAYLIGHT_CCT);
  const r = rgb[0] / capture[0], g = rgb[1] / capture[1], b = rgb[2] / capture[2];
  return [r / g, 1, b / g];
}

/** A black body's colour relative to the capture's daylight: for lights below the daylight locus's 4,000 K. */
export function planckShift(cct: number): Rgb {
  return relativeToCapture(planckRgb(cct));
}

/** A table's colour temperature at an elevation: linear in elevation in mired (1/T), held at the table's ends. */
export function cctAtElevation(table: readonly (readonly [number, number])[], elevation: number): number {
  const first = table[0], last = table[table.length - 1];
  if (first === undefined || last === undefined) throw new RangeError("A colour table needs at least one row.");
  if (!(elevation > first[0])) return first[1];
  if (elevation >= last[0]) return last[1];
  for (let i = 1; i < table.length; i += 1) {
    const [e1, t1] = table[i] ?? last, [e0, t0] = table[i - 1] ?? first;
    if (elevation <= e1) {
      const f = (elevation - e0) / (e1 - e0);
      return 1 / ((1 - f) / t0 + f / t1);
    }
  }
  return last[1];
}

/** The measured change of a black body's colour from a reference temperature to another (green 1). */
function planckChange(cct: number, reference: number): Rgb {
  const to = planckRgb(cct), from = planckRgb(reference);
  const r = to[0] / from[0], g = to[1] / from[1], b = to[2] / from[2];
  return [r / g, 1, b / g];
}

const times = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/**
 * The Sun's beam at an elevation: the weather's own colour at its reference hour, reddened (or whitened) by the measured
 * change from the reference elevation's colour to this one's. Below about 1.6° the Planckian fit holds 1,667 K (the study
 * gives 1,480 K at 1°).
 */
export function sunBeamShift(weatherShift: Rgb, elevation: number, referenceElevation: number): Rgb {
  return times(weatherShift, planckChange(cctAtElevation(SUN_CCT_BY_ELEVATION, elevation), cctAtElevation(SUN_CCT_BY_ELEVATION, referenceElevation)));
}

/** The Moon's beam at an elevation: R1b's MOON_CCT from the table's top row up (the moonlit preset's Moon), reddened toward the horizon as the study measured. */
export function moonBeamShift(elevation: number): Rgb {
  const top = MOON_CCT_BY_ELEVATION[MOON_CCT_BY_ELEVATION.length - 1]?.[1] ?? MOON_CCT;
  return times(cctShift(MOON_CCT), planckChange(cctAtElevation(MOON_CCT_BY_ELEVATION, elevation), top));
}

/** The twilight table's chromaticity at a Sun elevation: linear in elevation, held at its ends. */
function twilightXy(elevation: number): readonly [number, number] {
  const first = TWILIGHT_SKY_XY[0], last = TWILIGHT_SKY_XY[TWILIGHT_SKY_XY.length - 1];
  if (first === undefined || last === undefined) return [0.3127, 0.329];
  if (elevation >= first[0]) return [first[1], first[2]];
  if (!(elevation > last[0])) return [last[1], last[2]];
  for (let i = 1; i < TWILIGHT_SKY_XY.length; i += 1) {
    const [e1, x1, y1] = TWILIGHT_SKY_XY[i] ?? last, [e0, x0, y0] = TWILIGHT_SKY_XY[i - 1] ?? first;
    if (elevation >= e1) {
      const f = (e0 - elevation) / (e0 - e1);
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    }
  }
  return [last[1], last[2]];
}

/**
 * The clear sky's colour at a Sun elevation, relative to the capture's daylight: its weather's own colour from
 * TWILIGHT_FROM_ELEVATION up (exactly), the measured twilight's from 0° down, and a blend between them.
 */
export function skyShiftAt(elevation: number, weatherShift: Rgb): Rgb {
  const toward = Math.min(Math.max((TWILIGHT_FROM_ELEVATION - elevation) / TWILIGHT_FROM_ELEVATION, 0), 1);
  if (toward === 0) return weatherShift;
  const [x, y] = twilightXy(elevation);
  const twilight = relativeToCapture(xyRgb(x, y));
  return [weatherShift[0] + (twilight[0] - weatherShift[0]) * toward, 1, weatherShift[2] + (twilight[2] - weatherShift[2]) * toward];
}
```

(It reads R1b's `daylight.ts`, `moon.ts`'s `MOON_CCT` and Task 4's `planckRgb`. Verified on 8 October in a scratch copy with R1b's `daylight.ts` and Task 4's `lamp-dimming.ts` taken from the plans: its 4 tests pass, strict `tsc` and the repo's ESLint settings are clean.)

Create `packages/web/src/lib/relight/sky-instant.ts`:

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

- [ ] **Step 6: The control's label** — in `packages/web/src/components/rooms/LightControl.tsx`, in `LABELS`, directly before `  captured: "As captured",` add `  live: "Live",`, and in the control's doc comment replace ` * R1d's amendment A7) and the capture's own light, an hour between 06:00 and 22:00 and a date. It exists only while` with ` * R1d's amendment A7), live time and the capture's own light (R1d), an hour of the whole day and a date. It exists only while`.

- [ ] **Step 7: Run the tests, and the R1b tests that read the store's default**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-colour.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-instant.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/light-setting.test.ts`
Expected: PASS, the Task 0 count plus 10. The two vector tests (night and sunny morning) must pass unchanged: they prove that `lightForSky` reproduces R1b's settings; if one fails, report the field and the difference and stop (the vectors are R1a's construction, never adjusted).

Run: `pnpm --filter @omnitwin/web exec vitest run src/stores/__tests__/light-setting-store.test.ts`
Expected: PASS, the Task 0 count plus 2.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl.test.tsx`
Expected: PASS, the Task 0 count.

Then, one per command: `src/lib/relight/__tests__/relight-apply.test.ts`, `src/components/scene/__tests__/RelightProvider.test.tsx`, `src/lib/relight/__tests__/relight-debug.test.ts`, `src/components/rooms/__tests__/RoomSplatScene.test.tsx`. Where one fails because it assumed the store starts at the captured light, add `useLightSettingStore.getState().selectPreset("captured");` at the start of that file's `beforeEach` (after any reset to the initial state; import the store if the file does not) and rerun it; any other failure is a regression: stop and report it.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors. A `Record<LightPresetId, …>` elsewhere in the package without `live` is reported here: give it a `live` entry equal to its `sunny` entry.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/light-setting.ts src/lib/relight/sky-instant.ts src/lib/relight/sky-colour.ts src/stores/light-setting-store.ts src/components/rooms/LightControl.tsx`
Expected: no problems.

- [ ] **Step 9: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/light-setting.ts packages/web/src/lib/relight/sky-instant.ts packages/web/src/lib/relight/sky-colour.ts packages/web/src/stores/light-setting-store.ts packages/web/src/components/rooms/LightControl.tsx packages/web/src/lib/relight/__tests__/sky-instant.test.ts packages/web/src/lib/relight/__tests__/sky-colour.test.ts packages/web/src/lib/__tests__/light-setting.test.ts packages/web/src/stores/__tests__/light-setting-store.test.ts packages/web/src/components/rooms/__tests__/LightControl.test.tsx && git status --short packages/web/src && git diff --cached --stat
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

The interior shadow (Task 10 provides it) multiplies each body's direct term after the window march: in the pass, in the floor's and the skins' materials (Tasks 10 and 17) and in the CPU twin, so the GPU and the DEV checks agree. It is built into each draw's pass, so a draw rebuilds its pass once when the hook is set or cleared (on its first run after the change), never per frame. A hook of 1 everywhere leaves every multiplier unchanged bit for bit (`v × 1 × cosine` is `v × cosine` in IEEE arithmetic), so R1a's vectors still pass.

The stride (decision 7): `passStride` s and `passPhase` p make the pass handle splats p, p + s, p + 2s, …, dispatched as `ceil(count / s)` invocations (three's `renderer.compute(node, count)`). The default is 1 and 0 (every splat); the director (Task 9) uses another stride only if Task 23's measurement needs it, and returns to 1 for one full pass when the light settles. R1c's skin passes follow through `onPassStride` (the R1c interface, item 3). `runRelight({ activeOnly: true })` is what the director calls while the light moves: the frame's own passes, then only the draw on screen; every other cached draw is marked stale and reruns its pass when it is next activated, so a draw is never shown at an old light.

`setDisplay` writes the display uniforms without reapplying the light: the eye changes every frame while it adapts, and moving it must not rerun a pass. It calls R1b's own `writeDisplay` (so the display is written in one place; Task 16 adds the scotopic amount there) and updates `current.display`, so the applied light's record always names the display shown.

Verified (7 October; R1b re-read on 8 October, its line numbers as of then): R1b plan lines 2673–2761 (`RelightKernelModel`, `RelightSetting`, `KernelFrame`, `SplatMultiplier { m, alpha }`), 2931–2996 (`relightSplat`: each body's block names its visibility `v` beside the function's `visibility` argument, `const v = sunVisibility(model.windows, windowSun, position).visibility;` and its `for` line `e[c] = at(e, c) + v * cosine * channel(frame.setting.sunRgb, c)`, the Moon's the same with `moonSun` and `moonRgb`; `const luminance = dot(colour, LUMINANCE);`; the final `return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha: … }`), 1561–1611 (the kernel test's `syntheticModel(windows = [], sky: SkyModel | null = null)`, `record`, `CENTRE`, `GREY`, `testWindow`, `RECT`; no sunlit-area table: R1b's consolidation removed `SunAreaTable`), 1729–1741 (the gating test's open window and sun `[0, -0.8, 0.6]` that light `[1.5, 1, 1.5]`), 1904–1913 (A5's test: `syntheticModel([testWindow(RECT, () => 0, 0)])`, no sky model), 6726–7011 (`RelightFrame`: `private readonly listeners`, mutable `current`, `apply`'s `this.writeDisplay(display);` and `for (const listener of this.listeners) listener();`, the private `writeDisplay(display)`), 6199 (`Vector4` imported from `three`), 7159–7241 (the draw's tests: `geometry(count)`, `vi.spyOn(renderer, "compute")`), 7339–7461 (`createRelightDraw`: `const i = instanceIndex;`, `const pass = Fn(() => {`, the bodies' `e.addAssign(u.sunRgb.mul(visibility.mul(cosine)));` (the draw's TSL local is named `visibility`), `})().compute(count, [WORKGROUP]).setName("RelightMultiplier");`, `const luminance = dot(colour, vec3(...LUMINANCE)).toVar();`, the `wordsWrite.element(i).assign(…bitOr(alpha.shiftLeft(24)))` line, `run`'s `void renderer.compute(pass);`, `dispose`'s `pass.dispose();`), 7576–7701 (the host's relit tests: `setup(automaticSort, relightSupported)`, `state.compute`), 7826–7836 (`runRelight`); amendment A1 (`lampTints`), A5 (the moon blocks, as R1b's consolidation renamed their local `v`); `packages/web/src/lib/native-splat-scene.ts:36` (`interface Snapshot`), `:87` (`snapshots`), `:552-564` (`private activate(snapshot: Snapshot)`), `__tests__/native-splat-scene.test.ts:480-501` (motion and detail draws cached together, `state.runtime.frame(n)`); three 0.186: `src/nodes/core/UniformNode.js:241` (`uniform(value, type)`), `src/nodes/accessors/UniformArrayNode.js:375` (`uniformArray`), `src/nodes/utils/LoopNode.js:346,364` (`Loop`, `Break`; the object form's loop variable is `i`, as `@types/three` `src/nodes/utils/LoopNode.d.ts` types it), `src/nodes/tsl/TSLCore.js:1216` (`bool`), `src/nodes/math/MathNode.js:1035,1196` (`lengthSq`), `src/renderers/common/Renderer.js:2877` and `@types/three` `src/renderers/common/Renderer.d.ts:975-978` (`compute(computeNodes, dispatchSize?: number | number[] | IndirectStorageBufferAttribute)`), `src/renderers/webgpu/WebGPUBackend.js:1915-1945` (a number is an invocation count, divided into workgroups).

- [ ] **Step 1: Find the anchors** (each command must print at least one line; where R1c reformatted a line, apply the step to its equivalent and say so in the task report)

```bash
cd D:/claude/real-hall/repo/packages/web/src/lib && grep -n "v \* cosine \* channel(frame.setting.sunRgb, c)\|v \* cosine \* channel(frame.setting.moonRgb, c)\|  return { m: \[at(m, 0), at(m, 1), at(m, 2)\], alpha" relight/relight-kernel.ts
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
    // No sky model (R1b's syntheticModel(windows, sky = null), as A5's own test): each body's term is its direct light alone.
    const sun: Vec3 = [0, -0.8, 0.6];
    const model = syntheticModel([testWindow(RECT, () => 0, 0)]);
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

Append to `packages/web/src/lib/relight/__tests__/relight-frame.test.ts`, inside its `describe`, before the closing `});` (import `float` from `three/tsl`, `CHANDELIER_COUNT` from `../relight-kernel.js` and `type InteriorShadowHook` from `../relight-frame.js`; `applicationForChoice` and `defaultChoice` are already imported by R1b's test):

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

  it("sets the display without reapplying the light, and the applied light's display follows (R1d)", () => {
    const frame = new RelightFrame(data);
    frame.setDisplay({ exposure: 3, whiteBalance: [1, 1, 1] });
    expect(frame.current).toBeNull();
    frame.apply(applicationForChoice(frame.inputs, defaultChoice("night"), (light) => frame.meanLight(light)));
    const listener = vi.fn();
    frame.onApply(listener);
    frame.setDisplay({ exposure: 2, whiteBalance: [1.1, 1, 0.9] });
    expect(frame.uniforms.display.exposure.value).toBe(2);
    expect(frame.uniforms.display.whiteBalance.value.toArray()).toEqual([1.1, 1, 0.9]);
    expect(frame.current?.display).toEqual({ exposure: 2, whiteBalance: [1.1, 1, 0.9] });
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

Give `relightSplat` a last parameter: after R1c's `visibility` parameter add `, cinematic: KernelCinematic = NO_CINEMATIC` (the signature then ends `…, colour: Rgb, visibility: RelightVisibility = NO_VISIBILITY, cinematic: KernelCinematic = NO_CINEMATIC): SplatMultiplier {`). Each body's block names its window visibility `v` (R1b's consolidated kernel; the function's `visibility` argument is R1c's skins and toggles). Replace the Sun's line

```ts
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + v * cosine * channel(frame.setting.sunRgb, c);
```

with:

```ts
    // R1d: the interior occluders' shadow (the CPU twin of Task 10's map); 1 keeps the product bit for bit.
    const shadow = cinematic.interiorShadow?.(position, "sun") ?? 1;
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + v * shadow * cosine * channel(frame.setting.sunRgb, c);
```

and the Moon's (A5's) line

```ts
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + v * cosine * channel(frame.setting.moonRgb, c);
```

with:

```ts
    const shadow = cinematic.interiorShadow?.(position, "moon") ?? 1;
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + v * shadow * cosine * channel(frame.setting.moonRgb, c);
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

  /**
   * The eye's display, every frame while it adapts, without reapplying the light (R1d): R1b's own `writeDisplay`, and
   * the applied light's record follows, so `current.display` is always the display shown (the DEV checks read it).
   */
  setDisplay(display: DisplayParams): void {
    this.writeDisplay(display);
    if (this.current !== null) this.current = { ...this.current, display };
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
- Modify: `packages/web/src/lib/splat-staging-plugin.ts`, `packages/web/src/lib/relight/relight-spans.ts` (the cinematic light's two spans)
- Test: `packages/web/src/lib/relight/__tests__/cinematic-package.test.ts`, `packages/web/src/lib/relight/__tests__/cinematic-fixture.ts` (create), `packages/web/src/lib/__tests__/splat-staging-plugin.test.ts`, `packages/web/src/lib/relight/__tests__/relight-spans.test.ts` (modify)

**Interfaces:**
- Consumes: Task 3's `venviewer.cinematic.v1` (`docs/engineering/cinematic-package.md`); R1b's `FetchLike` and `fetchVerified` (`relight-assets.ts`), `inflate` (`relight-png.ts`), `warnRelightFallback` (`relight-warning.ts`), `WINDOW_COUNT` and `Vec3` (`relight-codec.ts`); Task 7's `CHANDELIER_COUNT`, `GlowChandelier`; Task 4's `LAMP_DIMMINGS`, `PLANCK_MIN_CCT`, `PLANCK_MAX_CCT`; Task 5's `EyeAnchors`; Task 6's `LampLight`, `LampGroupLight` (with each group's `warmFullCct`); `LAMP_GROUPS`, `LampGroup` (`relight-kernel.ts`); R1b's `measureRelight` and `RELIGHT_SPANS` (`relight-spans.ts`).
- Produces: `CINEMATIC_SCHEMA = "venviewer.cinematic.v1"`, `CINEMATIC_PATH = "cinematic/v1"`, `MAX_OCCLUDER_TRIANGLES = 1_500_000`, `MAX_CRISP_BULBS = 512`; `CinematicManifestSchema`, `type CinematicManifest`; `type BulbGroup = "ch_end" | "ch_centre"`; `BULB_KINDS = ["candle", "crown"]`, `type BulbKind`; `interface CinematicBulb { readonly id: string; readonly group: BulbGroup; readonly kind: BulbKind; readonly chandelier: number; readonly position: Vec3; readonly intensity: number }`; `interface BulbEnvelope { readonly radius: number; readonly height: number }`; `interface CinematicProbe { readonly position: Vec3; readonly box: readonly [Vec3, Vec3] }`; `interface CinematicData { readonly manifestUrl: string; readonly manifest: CinematicManifest; readonly occluders: Float32Array; readonly bulbs: readonly CinematicBulb[]; readonly envelopes: Readonly<Record<BulbKind, BulbEnvelope>>; readonly glow: readonly GlowChandelier[]; readonly windowRadiance: readonly number[]; readonly lamps: LampLight; readonly eyeAnchors: EyeAnchors | null; readonly probes: readonly CinematicProbe[] }`; `cinematicManifestUrl(relightBaseUrl: string, location?: string): string`; `cinematicOffBySearch(search: string, previewable: boolean): boolean`; `loadCinematicData(fetchFn: FetchLike, manifestUrl: string, relightTileToModel: readonly number[], signal?: AbortSignal): Promise<CinematicData>`; `loadCinematicPackage(manifestUrl: string, relightTileToModel: readonly number[], fetchFn?: FetchLike): Promise<CinematicData | null>` (cached per URL; any failure warns once with kind `cinematic` and resolves null); `resetCinematicPackages(): void` (tests). In `relight-spans.ts`: `CINEMATIC_SPANS = ["relight:cinematic-package", "relight:cinematic-parts"]`, `type CinematicSpan`, and `measureRelight` takes either kind of span.

The package sits beside the relight package it was built with (`<room>/cinematic/v1/` next to `<room>/relight/v2/`, Task 3's `package_paths`), so its URL is resolved from the relight package's own base URL and no room table is needed. It is small (a manifest and one gzip of triangles, about 1 MB for a few hundred thousand triangles), so it loads on the main thread: `fetch` and the gzip stream (`DecompressionStream` inside R1b's `inflate`) are asynchronous, and the only synchronous work is the manifest's schema and one pass over the floats to refuse a non-finite coordinate (a few milliseconds), each timed as the span `relight:cinematic-package` (R1b's `measureRelight`; Task 23 judges every span at 50 ms). Every field is validated at run time: the schema (at most 512 crisp lamps, each id naming its chandelier, the centre chandelier's lamps in `ch_centre` and the others' in `ch_end`, a `crown` lamp only on the centre chandelier, positive intensities, the bulb table's SHA-256; five chandeliers, every crisp one with lamps and every lamp's chandelier crisp; each kind's envelope of at most 5 cm radius and 20 cm height; each group's dimming `warm` or `led` and its own warm-down start on the Planckian fit's range (the controller's ruling L3); a night gain of one positive number per group (three equal channels); five window radiances; anchors well-formed; `files` naming exactly the occluders, the owner's packaging rule), the model frame (the relight package's `tileToModel` within 1e-9), the occluder file's size and SHA-256 (`fetchVerified`) and its decompressed length (36 bytes a triangle). Anything wrong switches the cinematic light off for the session with one warning, and the hall stays relit (spec §7): the glow splats draw as captured and unboosted, the lamps fade at the bake's colour (no warm-down temperature), and there are no crisp lamps, interior shadows, sheen of the lamps, reflections or night gains. `?cinematic=off` does the same on purpose, only where splats may run.

Verified (7 October; R1b's line numbers re-read on 8 October): R1b plan lines 3627 (`type FetchLike = (url: string, init: { readonly signal?: AbortSignal }) => Promise<Response>`), 3684–3701 (`sha256Hex`, `fetchVerified(fetchFn, url, expected, signal?)`), 1394 (`inflate(bytes, format: "gzip" | "deflate", maxBytes)` in `relight-png.ts`), 904–916 (`warnRelightFallback(kind, message, cause?)`, `resetRelightWarnings`), 1211 (`relightManifestUrl`: a package's URL is `<splat base>/<venue>/<room>/<path>/manifest.json`), 9612 (the staging plugin's `PACKAGE_DIRECTORIES`) and its tests (`resolveStagedSplatPath`, `stagedContentType`, `ROOT`), 7119–7136 and 7226–7246 (`relight-spans.ts` and its test); this plan's Task 3 (`package_files`: the manifest's fields, `occluders.bin.gz`, `bulbs.envelopes`, `bulbs.tableSha256`, each entry's `kind`, `chandeliers`, `lamps.warmDown.groups` and `lamps.groups`, night gains of three equal channels, intensities rounded to 6 figures, `MAX_BULBS = 512`) and Task 7 (`CHANDELIER_COUNT = 5`, `GlowChandelier`); `packages/web/src/lib/splat-staging-plugin.ts:38` (`PACKAGE_EXTENSIONS`, `.json` and, after R1b, `.gz`).

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
const WARM_DIMMING = { dimming: "warm" };
const ENVELOPES = { candle: { radius: 0.0175, height: 0.07 }, crown: { radius: 0.0125, height: 0.05 } };
const WARM = { fullCct: 3700.1, range: [3537.4, 3984.7] }, DOME_WARM = { fullCct: 4368.3, range: [4168.6, 4722.6] };
/** The manifest as JSON: the fields the tests edit are typed, every other field passes through. */
type Open<T> = Record<string, unknown> & T;
type Manifest = Open<{
  bulbs: Open<{ entries: Record<string, unknown>[] }>; chandeliers: { id: number; centre: number[]; crisp: boolean }[];
  lamps: Open<{
    warmDown: Open<{ groups: Record<string, { fullCct: number }> }>; groups: Record<string, { dimming: string }>;
    night: Open<{ gains: Record<string, number[]> }>;
  }>;
  occluders: Open<{ triangles: number }>; files: Record<string, unknown>;
}>;

function build(edit: (manifest: Manifest) => void = () => undefined, triangles = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])) {
  const packed = new Uint8Array(gzipSync(Buffer.from(triangles.buffer, triangles.byteOffset, triangles.byteLength)));
  const manifest: Manifest = {
    schema: "venviewer.cinematic.v1", room: "grand-hall", createdAt: "2026-10-07T12:00:00+01:00", tool: "abc123",
    model: { frame: "e57", tileToModel: IDENTITY },
    relight: { package: "relight/v2", manifestSha256: "0".repeat(64) },
    bulbs: { envelopes: ENVELOPES, tableSha256: "a".repeat(64), entries: [{ id: "c0_b00", group: "ch_end", kind: "candle", chandelier: 0, position: [1, 2, 3], intensity: 2 }] },
    chandeliers: CENTRES.map((centre, id) => ({ id, centre, crisp: id === 0 })),
    lamps: {
      windowRadiance: [1, 2, 3, 4, 5],
      warmDown: { groups: { cove: WARM, ch_end: WARM, ch_centre: WARM, dome: DOME_WARM }, provenance: "test" },
      groups: { cove: WARM_DIMMING, ch_end: WARM_DIMMING, ch_centre: WARM_DIMMING, dome: { dimming: "led" } },
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
    expect(data.bulbs).toEqual([{ id: "c0_b00", group: "ch_end", kind: "candle", chandelier: 0, position: [1, 2, 3], intensity: 2 }]);
    expect(data.envelopes).toEqual(ENVELOPES);
    expect(data.glow.map((chandelier) => chandelier.crisp)).toEqual([true, false, false, false, false]);
    expect(data.glow[2]?.centre).toEqual([8.9, -5, 4.82]);
    expect(data.windowRadiance).toEqual([1, 2, 3, 4, 5]);
    // Each group's warm-down starts at its own temperature (the controller's ruling L3).
    expect(data.lamps.groups.ch_end).toEqual({ dimming: "warm", warmFullCct: 3700.1, gain: [1, 1, 1] });
    expect(data.lamps.groups.dome).toEqual({ dimming: "led", warmFullCct: 4368.3, gain: [1, 1, 1] });
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
    const lamp = (index: number, chandelier = 0, group = "ch_end") => ({ id: `c${String(chandelier)}_b${String(index).padStart(3, "0")}`, group, kind: "candle", chandelier, position: [0, 0, 0], intensity: 1 });
    expect(parse((manifest) => { manifest.bulbs.entries = Array.from({ length: 513 }, (_unused, index) => lamp(index)); })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [lamp(0, 0, "ch_centre")]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [{ ...lamp(0), id: "c1_b000" }]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [{ ...lamp(0), intensity: 0 }]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [{ ...lamp(0), kind: "crown" }]; })).toBe(false);
    expect(parse((manifest) => { manifest.bulbs.entries = [lamp(0), lamp(0, 2, "ch_centre")]; })).toBe(false);
    expect(parse((manifest) => { manifest.chandeliers[3] = { id: 3, centre: [0, 0, 0], crisp: true }; })).toBe(false);
    expect(parse((manifest) => { manifest.chandeliers = manifest.chandeliers.slice(0, 4); })).toBe(false);
    expect(parse((manifest) => { manifest.lamps.groups.cove = { dimming: "incandescent" }; })).toBe(false);
    expect(parse((manifest) => { const cove = manifest.lamps.warmDown.groups.cove; if (cove !== undefined) cove.fullCct = 900; })).toBe(false);
    expect(parse((manifest) => { manifest.lamps.night.gains.cove = [1, 0, 1]; })).toBe(false);
    expect(parse((manifest) => { manifest.lamps.night.gains.cove = [1, 1.1, 1]; })).toBe(false);
    expect(parse((manifest) => { manifest.files = {}; })).toBe(false);
    expect(parse((manifest) => { manifest.files = { ...manifest.files, "stale.bin": { sha256: "0".repeat(64), bytes: 1 } }; })).toBe(false);
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
/** Task 3's envelopes: a candle and the smaller crown tube. */
export const FIXTURE_ENVELOPES = { candle: { radius: 0.0175, height: 0.07 }, crown: { radius: 0.0125, height: 0.05 } } as const;
const FIXTURE_WARM = { fullCct: 3700.1, range: [3537.4, 3984.7] } as const;

/** A valid cinematic manifest for tests (T-639 R1d). */
export function cinematicManifest(): CinematicManifest {
  return CinematicManifestSchema.parse({
    schema: "venviewer.cinematic.v1", room: "grand-hall", createdAt: "2026-10-07T12:00:00+01:00", tool: "abc123",
    model: { frame: "e57", tileToModel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    relight: { package: "relight/v2", manifestSha256: "0".repeat(64) },
    bulbs: { envelopes: FIXTURE_ENVELOPES, tableSha256: "0".repeat(64), entries: [] },
    chandeliers: FIXTURE_CENTRES.map((centre, id) => ({ id, centre, crisp: false })),
    lamps: {
      windowRadiance: [1, 1, 1, 1, 1],
      warmDown: { groups: { cove: FIXTURE_WARM, ch_end: FIXTURE_WARM, ch_centre: FIXTURE_WARM, dome: FIXTURE_WARM }, provenance: "test" },
      groups: { cove: { dimming: "warm" }, ch_end: { dimming: "warm" }, ch_centre: { dimming: "warm" }, dome: { dimming: "warm" } },
      night: { calibrated: false, gains: { cove: [1, 1, 1], ch_end: [1, 1, 1], ch_centre: [1, 1, 1], dome: [1, 1, 1] }, evidence: null },
    },
    occluders: { file: "occluders.bin.gz", triangles: 0, bounds: [[0, 0, 0], [0, 0, 0]] },
    reflections: { probes: [] },
    eye: null,
    files: { "occluders.bin.gz": { sha256: "0".repeat(64), bytes: 20 } },
  });
}

/** Cinematic data for tests: the Grand Hall's box, no crisp lamps, every group warm from 3,700.1 K, gains of one, with the given changes. */
export function cinematicData(changes: Partial<CinematicData> = {}): CinematicData {
  return {
    manifestUrl: "https://cdn.test/splats/trades-hall/grand-hall/cinematic/v1/manifest.json",
    manifest: cinematicManifest(),
    occluders: new Float32Array(), bulbs: [],
    envelopes: FIXTURE_ENVELOPES,
    glow: FIXTURE_CENTRES.map((centre) => ({ centre, crisp: false })),
    windowRadiance: [1, 1, 1, 1, 1],
    lamps: {
      groups: {
        cove: { dimming: "warm", warmFullCct: 3700.1, gain: [1, 1, 1] }, ch_end: { dimming: "warm", warmFullCct: 3700.1, gain: [1, 1, 1] },
        ch_centre: { dimming: "warm", warmFullCct: 3700.1, gain: [1, 1, 1] }, dome: { dimming: "warm", warmFullCct: 3700.1, gain: [1, 1, 1] },
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
import { measureRelight } from "./relight-spans.js";
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
const rgb = z.tuple([positive, positive, positive]);
/** A night gain moves light between the groups and never changes a group's colour: one number in three equal channels. */
const gain = rgb.refine(([r, g, b]) => r === g && g === b, { message: "A night gain is one number per group." });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const anchor = z.object({ exposure: positive, whiteBalance: rgb, logLuminance: finite, logChroma: z.tuple([finite, finite]) });
export const BULB_KINDS = ["candle", "crown"] as const;
export type BulbKind = (typeof BULB_KINDS)[number];
const bulb = z.object({
  id: z.string().regex(/^c[0-4]_b\d{2,3}$/u),
  group: z.enum(["ch_end", "ch_centre"]),
  kind: z.enum(BULB_KINDS),
  chandelier: z.number().int().min(0).max(CHANDELIER_COUNT - 1),
  position: vec3,
  intensity: positive,
}).refine(
  (entry) => entry.id.startsWith(`c${String(entry.chandelier)}_`) && (entry.chandelier === CENTRE_CHANDELIER) === (entry.group === "ch_centre")
    && (entry.kind === "candle" || entry.chandelier === CENTRE_CHANDELIER),
  { message: "A lamp's id, chandelier, group and kind must agree (only the centre chandelier has crown tubes)." },
);
const envelope = z.object({ radius: positive.max(0.05), height: positive.max(0.2) });
const warmStart = z.object({ fullCct: finite.min(PLANCK_MIN_CCT).max(PLANCK_MAX_CCT), range: z.tuple([finite, finite]) });
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
    envelopes: z.object({ candle: envelope, crown: envelope }),
    tableSha256: sha256,
    entries: z.array(bulb).max(MAX_CRISP_BULBS),
  }),
  chandeliers: z.array(chandelier).length(CHANDELIER_COUNT)
    .refine((entries) => entries.every((entry, index) => entry.id === index), { message: "The chandeliers are 0 to 4, in order." }),
  lamps: z.object({
    windowRadiance: z.array(finite.nonnegative()).length(WINDOW_COUNT),
    warmDown: z.object({ groups: z.object({ cove: warmStart, ch_end: warmStart, ch_centre: warmStart, dome: warmStart }), provenance: z.string() }),
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
  // The owner's packaging rule: `files` names exactly the files the fields name.
  for (const name of Object.keys(manifest.files)) {
    if (name !== manifest.occluders.file) context.addIssue({ code: z.ZodIssueCode.custom, path: ["files", name], message: "No field names this file." });
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
  /** A candle, or one of the centre chandelier's crown tubes (the controller's ruling L2). */
  readonly kind: BulbKind;
  /** The chandelier it hangs from, 0–4 (2 is the centre chandelier). */
  readonly chandelier: number;
  /** Triangulated from the photographs (Task 1), model frame. */
  readonly position: Vec3;
  /** Per unit of its group's source weight: it lights a surface with weight × intensity × cosθ / d² (Task 3). */
  readonly intensity: number;
}
/** The crisp lamp drawn for each kind: a frosted envelope (design values: a candle, a smaller crown tube). */
export interface BulbEnvelope {
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
  readonly envelopes: Readonly<Record<BulbKind, BulbEnvelope>>;
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
  const json: unknown = await response.json();
  // The synchronous work is timed as R1d's loading span (Task 23 judges every span at 50 ms).
  const manifest = measureRelight("relight:cinematic-package", () => CinematicManifestSchema.parse(json));
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
  if (!measureRelight("relight:cinematic-package", () => occluders.every((value) => Number.isFinite(value)))) throw new Error("The occluders hold a coordinate that is not finite.");
  const groupLight = (group: LampGroup): LampGroupLight => ({
    dimming: manifest.lamps.groups[group].dimming,
    warmFullCct: manifest.lamps.warmDown.groups[group].fullCct,
    gain: manifest.lamps.night.gains[group],
  });
  return {
    manifestUrl,
    manifest,
    occluders,
    bulbs: manifest.bulbs.entries.map((entry): CinematicBulb => ({ ...entry })),
    envelopes: manifest.bulbs.envelopes,
    glow: manifest.chandeliers.map((entry): GlowChandelier => ({ centre: entry.centre, crisp: entry.crisp })),
    windowRadiance: manifest.lamps.windowRadiance,
    lamps: { groups: { cove: groupLight("cove"), ch_end: groupLight("ch_end"), ch_centre: groupLight("ch_centre"), dome: groupLight("dome") } },
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

- [ ] **Step 4: Serve it in development, and name its spans** — in `packages/web/src/lib/splat-staging-plugin.ts`, add `"cinematic"` as the last entry of `PACKAGE_DIRECTORIES` (R1b's `["floor-skin", "relight"]` and R1c's additions). Its `.json` and `.gz` files are already among `PACKAGE_EXTENSIONS`.

In `packages/web/src/lib/relight/relight-spans.ts`, directly after `export type RelightSpan = (typeof RELIGHT_SPANS)[number];` add:

```ts
/** R1d: the cinematic light's main-thread work while it loads (its package's schema and floats; its parts' construction). */
export const CINEMATIC_SPANS = ["relight:cinematic-package", "relight:cinematic-parts"] as const;
export type CinematicSpan = (typeof CINEMATIC_SPANS)[number];
```

and replace `export function measureRelight<T>(name: RelightSpan, work: () => T): T {` with `export function measureRelight<T>(name: RelightSpan | CinematicSpan, work: () => T): T {`. In `packages/web/src/lib/relight/__tests__/relight-spans.test.ts`, add `CINEMATIC_SPANS` to its import from `../relight-spans.js` and append inside its `describe`:

```ts
  it("names the cinematic light's loading spans beside R1b's (R1d)", () => {
    expect(CINEMATIC_SPANS).toEqual(["relight:cinematic-package", "relight:cinematic-parts"]);
    expect(measureRelight("relight:cinematic-parts", () => "built")).toBe("built");
    expect(performance.getEntriesByType("measure").map((entry) => entry.name)).toEqual(["relight:cinematic-parts"]);
  });
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/cinematic-package.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/splat-staging-plugin.test.ts`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-spans.test.ts`
Expected: PASS, the Task 0 count plus 1.

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/cinematic-package.ts src/lib/relight/relight-spans.ts src/lib/splat-staging-plugin.ts`
Expected: no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/cinematic-package.ts packages/web/src/lib/relight/__tests__/cinematic-package.test.ts packages/web/src/lib/relight/__tests__/cinematic-fixture.ts packages/web/src/lib/splat-staging-plugin.ts packages/web/src/lib/__tests__/splat-staging-plugin.test.ts packages/web/src/lib/relight/relight-spans.ts packages/web/src/lib/relight/__tests__/relight-spans.test.ts && git diff --cached --stat && git commit -m "feat(relight): the cinematic package in the browser, validated, with one fallback warning (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The light director: every frame while the light moves, nothing while it is still

**Files:**
- Create: `packages/web/src/lib/relight/light-director.ts`, `packages/web/src/components/scene/cinematic-light.ts`
- Modify: `packages/web/src/components/scene/RelightProvider.tsx`
- Test: `packages/web/src/lib/relight/__tests__/light-director.test.ts` (create), `packages/web/src/components/scene/__tests__/RelightProvider.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`LightMotion`, `MINUTES_PER_DAY`, `MotionFrame`, `MotionInstant`, `MotionTargets`, `EyeTarget`, `LampDrives`; `anchoredEye`, `lightChroma`, `adaptationLuminance`, `scotopicAmount`, `CAPTURE_CALIBRATION`, `IDENTITY_EYE`, `EyeAnchors`, `FrameMeasurement`, `LuminanceCalibration`), Task 6 (`lightForSky`, `lampTargets`, `weatherOf`, `dayNumber`, `dateOfDay`, `londonClock`, `settingForChoice`, `SkyLight`, `SkyExtras`, `LampLight`, `STEADY_LAMPS`, the store's `follow` and `lamps`; `skyAt`), Task 7 (`RelightFrame.setDisplay`, `setPassStride`, `passStride`; `NativeSplatScene.runRelight({ activeOnly })`), Task 8 (`loadCinematicPackage`, `cinematicManifestUrl`, `cinematicOffBySearch`, `CinematicData`); R1b's `RelightFrame` (`apply`, `onApply`, `inputs`, `meanLight`, `readSkyLight`, `current`), `applicationForChoice`, `capturedSetting`, `LUMINANCE`, `measureRelight`, `warnRelightFallback`; `nativeRendererForScene` (`lib/native-renderer.ts`); `prefersReducedMotion` (`lib/reduced-motion.ts`); `gaussianSplatsAvailable` (`lib/splat-access.ts`).
- Produces (`light-director.ts`): `AMORTISE_STRIDE = 1`, `LIVE_RETIME_MINUTES = 1`, `BODY_STEP_DEGREES = 0.02`, `LIGHT_STEP_RELATIVE = 1e-3`, `LIVE_TICK_MS = 1000`, `FALLBACK_ALBEDO = 0.34`, `SKY_READ_INTERVAL_MS = 250`; `interface DirectorCinematic { readonly lamps: LampLight; readonly eyeAnchors: EyeAnchors | null; readonly city: readonly Rgb[] | null; readonly calibration: LuminanceCalibration }`; `interface DirectorOptions { readonly frame: RelightFrame; readonly invalidate: () => void; readonly clock?: () => number; readonly now?: () => number; readonly reducedMotion?: () => boolean; readonly requestFrame?: (callback: () => void) => number; readonly cancelFrame?: (handle: number) => void; readonly setTimer?: (callback: () => void, ms: number) => number; readonly clearTimer?: (handle: number) => void; readonly readSkyLight?: () => Promise<unknown> }` (`readSkyLight` reads the GPU's sky light of the light last applied back into the frame: the fallback eye's, ruling E1); `interface DisplayedLight { readonly instant: MotionInstant; readonly utc: Date; readonly sun: SolarPosition; readonly moon: MoonPosition; readonly light: SkyLight; readonly captured: boolean; readonly following: boolean; readonly lamps: LampDrives; readonly eye: EyeTarget; readonly moving: boolean; readonly lightMoving: boolean }`; `capturedLight(inputs: LightInputs, sun: SolarPosition, moon: MoonPosition): SkyLight`; `mixLights(from: SkyLight, to: SkyLight, amount: number): SkyLight`; `lightDelta(a: RelightSetting, b: RelightSetting): { readonly degrees: number; readonly relative: number }`; `class LightDirector` with `constructor(options: DirectorOptions)`, getters `moving` and `lightMoving`, `start(): void`, `stop(): void`, `setCinematic(cinematic: DirectorCinematic | null): void`, `setMeasurement(measurement: FrameMeasurement): void`, `setStride(stride: number): void`, `forceBothBodies(on: boolean): void`, `onLight(listener: (light: DisplayedLight) => void): () => void` (just before each apply), `onDisplayed(listener: (light: DisplayedLight) => void): () => void` (every tick), `current(): DisplayedLight | null`; `subscribeDisplayedLight(listener: (light: DisplayedLight | null) => void): () => void` and `currentDisplayedLight(): DisplayedLight | null` (the one session's displayed light, for the clock outside the canvas).
- Produces (`cinematic-light.ts`): the cinematic light's one entry, re-exporting `LightDirector`, `cinematicManifestUrl`, `cinematicOffBySearch`, `loadCinematicPackage` and `CAPTURE_CALIBRATION` (later tasks add their parts to it). The provider imports it only with a dynamic `import()` inside the build-time branch `import.meta.env.DEV || import.meta.env.VITE_DEPLOY_ENV === "preview"`, and its types with `import type`, so no production bundle carries the cinematic light (finding B15; Task 24 Step 2 checks).
- Produces (provider): the cinematic light's code loads beside the relight package (`Promise.all`); with it loaded and on (not `?cinematic=off`), one `LightDirector` per relight frame replaces R1b's per-choice apply, its fallback eye reading the GPU's sky light back through `frame.readSkyLight` with the host's renderer (`nativeRendererForScene`); the frame's apply listener runs `host.runRelight({ activeOnly: director.lightMoving })`; the cinematic package is loaded beside the relight package once the frame is on the host and handed to the director; the provider keeps `cinematic: { frame, director, light, data }` state (`light`: the loaded entry) for Task 10's `RelightCinematic`. Without the code (a production bundle, or a load that fails, warned once) the hall stays relit as R1b draws it.

The director is the only writer of the light while a relit, cinematic session runs (decisions 2–4, 7). Each tick it reads the store, forms the targets (the displayed instant: London's real time while following, else the choice's day and minutes; each lamp group's drive by the switch, automatic lamps following the Sun the visitor sees; the eye), steps Task 5's springs, computes both bodies at the displayed instant (Task 6's `skyAt`) and the light (`lightForSky` with the cinematic package's night gains, the city's light and the frontier study's measured colours of the beams and the blue hour, Task 6; or the captured light), and mixes two lights while a cross-fade runs. A cross-fade passes through the kernel's two body slots: the old light's dominant body (the Sun when it is up, else the Moon) fades in the first slot while the new light's rises in the second, so the mix is the linear superposition of the two lights, which is a cross-fade of the light except for a counted second body (finding M6). That body is only ever the Moon with the Sun up: counted, it is at least 1/100,000 of the light (`MOON_NEGLIGIBLE`, decision 2) and at most about 1/1,000 (a full Moon gives about 0.3 lux, a clear sky with the Sun on the horizon several hundred). It is dropped while a blend runs and returns at its end, a step of at most about a thousandth of the light, about a tenth of a display code at the brightest pixel. It applies the light to R1b's frame only when it has changed enough to show: a body moved 0.02° or any weight, colour or lamp level changed by 0.1% while the light moves, and the exact final light once it rests (and once more at full stride if the last moving applies were amortised). Applying reruns the passes through R1b's `onApply` listener, the active draw only while the light moves (Task 7). The display is written every tick with `setDisplay`, so an adapting eye never reruns a pass. A tick schedules the next animation frame only while something moves; a still, live hall ticks once a second (`LIVE_TICK_MS`) to advance the clock with `retime`, and reapplies only when the bodies have moved 0.02°, about every five seconds. Nothing runs while the light is still and the clock is not following.

The eye's target is Task 5's `anchoredEye` once the package's anchors exist, with the latest GPU measurement (Task 13), which holds until the next one: a still hall renders no frame and measures nothing, so the eye holds where it is rather than drifting. Without anchors (before Task 21) it falls back to R1b's display for the choice, `applicationForChoice` on the floor's mean light, recomputed when the choice's minute changes, with its scotopic amount from that mean light times the floor's albedo (0.34, the oak, the frontier study's §b3). The floor mean needs each sky body's light on the CPU, and the CPU twin never runs per frame (the controller's ruling E1): after each apply the director reads the GPU's sky light back with R1b's `readSkyLight`, at most every `SKY_READ_INTERVAL_MS` (four times a second) while the light moves and once more when it rests, and forms the fallback target again when a read-back lands. For a direction not yet read back R1b's frame serves the body's latest read-back, and it runs the twin at most once per body before the first (R1b Task 10), so a drag of the clock never marches the sky on the main thread, and at rest the fallback is exactly R1b's display for the choice. The captured light is the identity display, exactly.

The provider keeps R1b's path whole under `?cinematic=off` (where splats may run), so R1b's own checks can always run against R1b's behaviour. It imports the cinematic light only through `components/scene/cinematic-light.ts`, with a dynamic `import()` inside the build-time branch `import.meta.env.DEV || import.meta.env.VITE_DEPLOY_ENV === "preview"`, as R1b loads its light control (R1b 9904): `vite.config.ts` defines `VITE_DEPLOY_ENV` at build time, so a production build drops the import and its chunk (checked 8 October in a scratch Vite 6.4.3 build with the repo's `define`: the production output has no trace of the gated module, the preview output has its chunk; Task 24 Step 2 greps the real bundle). The code and the relight package load together (`Promise.all`), so the director is the only writer of the light from the first apply.

Verified (7 October; R1b's line numbers re-read on 8 October): R1b plan lines 9368–9466 (`RelightProvider`: `const scene = useThree(…)`, `void wanted.then((data) => {`, `const apply = (): void => {…}`, `measureRelight("relight:apply", apply);` at 9425, `host.setRelight(owner, frame);`, `host.runRelight();`, `stop = [frame.onApply(() => { host.runRelight(); invalidate(); }), useLightSettingStore.subscribe(…)]`, `setLoaded({ from: wanted, frame: next });`, `settle(data);`, deps `[wanted, host, invalidate]`), 8990–9031 (the provider's tests: imports, `WEBGPU`, `IDENTITY`, `Probe`, `beforeAll`, `afterEach`, `settle(ms = 60)`), 9070 (the test this task replaces), 6903–6905 (`meanLight(light: ChoiceLight): Rgb`), 6929–6938 (`readSkyLight(renderer)`: prepare, read back, `acceptSkyReadback`), 6981–6997 (`skyLightFor`: a direction not read back takes the body's latest light; the twin at most once per body before the first read-back, ruling E1), 6832–6840 (the presets' own-hour bodies, computed once each), 6729 and 6754 (`inputs`, `current`), 5514–5520 (`PRESET_DEFAULTS`: sunny 2026-05-31 at 09:00, two days after the capture and at full Moon, so the Moon is below Glasgow's horizon all morning), 9904 (the light control's lazy import), amendment A4 (`applicationForChoice(inputs, choice, meanLight)`); `packages/web/src/lib/splat-access.ts:30` (`gaussianSplatsAvailable`), `packages/web/src/lib/native-renderer.ts:80` (`nativeRendererForScene(scene)`), `packages/web/src/lib/reduced-motion.ts:4` (`prefersReducedMotion`); vitest 4.1's `vi.mock(import(path), factory)` (`node_modules/vitest/dist/index.d.ts:430`); the lazy pattern (`import type * as Entry`, `typeof Entry`, a gated `() => import(…)`) typechecked and built in `plan-amendments-0710/fix2-scratch-d/ts9` and `vite-gate`; this plan's Tasks 5–8.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/light-director.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STEADY_LAMPS, defaultChoice, settingForChoice } from "../../light-setting.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { CAPTURE_CALIBRATION, type EyeAnchor } from "../eye.js";
import { LightDirector, SKY_READ_INTERVAL_MS, capturedLight, currentDisplayedLight, lightDelta, mixLights } from "../light-director.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { capturedSetting, skyLightOf } from "../relight-kernel.js";
import { buildTestPackage } from "./relight-test-package.js";

// The CPU twin's sky light, counted: the director never runs it per frame (ruling E1).
vi.mock(import("../relight-kernel.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, skyLightOf: vi.fn(actual.skyLightOf) };
});

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

function rig(reducedMotion = false, readSkyLight?: () => Promise<unknown>) {
  const frame = new RelightFrame(data);
  const queue: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const clock = { time: 0, wall: Date.UTC(2026, 4, 31, 8, 0) };
  const applies: number[] = [];
  frame.onApply(() => { applies.push(clock.time); });
  const director = new LightDirector({
    frame, invalidate: () => undefined, now: () => clock.time, clock: () => clock.wall, reducedMotion: () => reducedMotion,
    requestFrame: (callback) => queue.push(callback), cancelFrame: () => undefined,
    setTimer: (callback) => timers.push(callback), clearTimer: () => undefined, readSkyLight,
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
  return { frame, director, frames, second, applies, queue, clock };
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
    const warm = { dimming: "warm", warmFullCct: 3700, gain: [1, 1, 1] } as const;
    director.setCinematic({
      lamps: { groups: { cove: warm, ch_end: warm, ch_centre: warm, dome: warm } },
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

  it("reads the fallback eye's sky light back from the GPU at most four times a second while the light moves and once at rest, never running the CPU twin per frame (ruling E1)", async () => {
    useLightSettingStore.getState().selectPreset("sunny");
    const reads: number[] = [];
    const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
    const { director, frames, applies, clock } = rig(false, () => { reads.push(clock.time); return Promise.resolve(); });
    // The read-backs land between frames, as the GPU's do.
    const run = async (seconds: number): Promise<void> => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) { frames(1 / 60); await flush(); }
    };
    director.start();
    await flush();
    expect(reads).toEqual([0]);
    const twin = vi.mocked(skyLightOf);
    twin.mockClear();
    // A second's drag of the clock, a new minute every frame, 09:01 to 10:00 (the full Moon is below the horizon).
    for (let minute = 541; minute <= 600; minute += 1) {
      useLightSettingStore.getState().setMinutes(minute);
      frames(1 / 60);
      await flush();
    }
    expect(reads.length - 1).toBeGreaterThanOrEqual(3);
    expect(reads.length - 1).toBeLessThanOrEqual(4);
    reads.slice(1).forEach((at, index) => { expect(at - (reads[index] ?? 0)).toBeGreaterThanOrEqual(SKY_READ_INTERVAL_MS); });
    await run(6);
    // The resting light is read back after its last apply, so the eye rests on the GPU's light for it.
    expect(reads.at(-1) ?? -1).toBeGreaterThanOrEqual(applies.at(-1) ?? Number.POSITIVE_INFINITY);
    expect(twin).not.toHaveBeenCalled();
    director.stop();
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

In the same file, add `import { resetCinematicPackages } from "../../../lib/relight/cinematic-package.js";` to its imports and, directly after its line `afterEach(() => { mounted?.unmount(); mounted = null; resetRelightWarnings(); vi.restoreAllMocks(); });`, add:

```tsx
// R1d: the provider imports the cinematic light lazily; warm that import once, so a test's 60 ms settle sees it resolve.
beforeAll(async () => { await import("../cinematic-light.js"); });
// The test package has no cinematic package beside it: the provider's fetch of one finds nothing, off the network.
beforeEach(() => { vi.stubGlobal("fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 404 }))); });
afterEach(() => { resetCinematicPackages(); vi.unstubAllGlobals(); });
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
import { warnRelightFallback } from "./relight-warning.js";
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
/** The fallback eye's sky light is read back from the GPU at most this often while the light moves (ruling E1). */
export const SKY_READ_INTERVAL_MS = 250;
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
  /**
   * Reads the GPU's sky light for the light last applied back into the frame (R1b's `RelightFrame.readSkyLight` with the
   * host's renderer): the fallback eye's sky light (ruling E1). Absent, the frame's own store serves it.
   */
  readonly readSkyLight?: () => Promise<unknown>;
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
 * first body slot while the new one's rises in the second. A counted second body (only the Moon with the Sun up: between
 * 1/100,000 and about 1/1,000 of the light) is dropped while the blend runs and returns at its end (finding M6).
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
  private readSkyLight: (() => Promise<unknown>) | null;
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
  private skyStale = false;
  private readingSky = false;
  private skyReadAt = Number.NEGATIVE_INFINITY;
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
    this.readSkyLight = options.readSkyLight ?? null;
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
    // The frontier study's measured colours with the cinematic package in use (Task 6); without it, R1b's colours.
    const extras: SkyExtras = { city: this.cinematic?.city ?? null, keepMoon: this.keepMoon, colourByElevation: this.cinematic !== null };
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
      // The fallback eye's target comes from this light's floor mean: its sky light is read back from the GPU (E1).
      if (weather !== null && (this.cinematic?.eyeAnchors ?? null) === null) this.skyStale = true;
    }
    if (this.shownEye === null || !sameEye(this.shownEye, frame.eye)) {
      this.frame.setDisplay({ exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance });
      this.shownEye = frame.eye;
      shown = true;
    }
    for (const listener of this.displayedListeners) listener(displayed);
    publish(this, displayed);
    if (shown) this.invalidate();
    this.readSkyIfDue(frame.lightMoving);
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

  /**
   * The fallback eye's sky light (ruling E1): after a light is applied its sky light is read back from the GPU, at most
   * every SKY_READ_INTERVAL_MS while the light moves and once more when it rests; when it lands, the eye's target is
   * formed again. R1b's frame serves a direction not yet read back from the body's latest read-back, so the CPU twin
   * never runs per frame.
   */
  private readSkyIfDue(lightMoving: boolean): void {
    const read = this.readSkyLight;
    if (read === null || !this.skyStale || this.readingSky) return;
    const at = this.now();
    if (lightMoving && at - this.skyReadAt < SKY_READ_INTERVAL_MS) return;
    this.skyStale = false;
    this.readingSky = true;
    this.skyReadAt = at;
    void read()
      .then(() => { this.fallback = null; }, (reason: unknown) => {
        // Without the GPU's read-back the eye keeps the frame's own sky light (R1b's store), with one warning.
        this.readSkyLight = null;
        warnRelightFallback("sky-readback", "The sky light could not be read back; the eye keeps the light it has.", reason);
      })
      .finally(() => {
        this.readingSky = false;
        this.wake();
      });
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

  /**
   * Without anchors: R1b's display for the choice (the floor's mean light), recomputed when its minute changes and when
   * the GPU's sky light lands (`readSkyIfDue`); the frame's `meanLight` runs the CPU twin at most once per body (R1b).
   */
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

- [ ] **Step 4: The provider** — create the cinematic light's one entry, `packages/web/src/components/scene/cinematic-light.ts`:

```ts
/**
 * The cinematic light's one entry (T-639 R1d). The relight provider imports it lazily, and only in development and
 * preview bundles, so venviewer.com's bundle carries none of the cinematic light (Task 24 Step 2 checks). Later tasks
 * add their parts here.
 */
export { cinematicManifestUrl, cinematicOffBySearch, loadCinematicPackage } from "../../lib/relight/cinematic-package.js";
export { CAPTURE_CALIBRATION } from "../../lib/relight/eye.js";
export { LightDirector } from "../../lib/relight/light-director.js";
```

In `packages/web/src/components/scene/RelightProvider.tsx`, replace R1b's `import { getNativeRenderer } from "../../lib/native-renderer.js";` (its Task 17) with `import { getNativeRenderer, nativeRendererForScene } from "../../lib/native-renderer.js";` and add the imports (only types from the cinematic light, so none of its code is bundled with the provider):

```ts
import type { CinematicData } from "../../lib/relight/cinematic-package.js";
import type { LightDirector } from "../../lib/relight/light-director.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";
import type * as CinematicLightEntry from "./cinematic-light.js";
```

directly above `export interface RelightProviderProps {` add:

```ts
type CinematicLight = typeof CinematicLightEntry;
/**
 * The cinematic light's code (R1d), loaded lazily and only in development and preview bundles: the condition is a
 * build-time constant (`vite.config.ts` defines `VITE_DEPLOY_ENV`), so a production build drops the import and its
 * chunk, as it drops R1b's light control.
 */
const loadCinematicLight: (() => Promise<CinematicLight>) | null = import.meta.env.DEV || import.meta.env.VITE_DEPLOY_ENV === "preview"
  ? () => import("./cinematic-light.js")
  : null;
```

directly after the line `const [loaded, setLoaded] = useState<…>(null);` add:

```ts
  // R1d: the cinematic light's director, code and package, for this frame only (Task 10 reads it: until then it is
  // written only, and `noUnusedLocals` refuses an unread binding).
  const [, setCinematic] = useState<{
    readonly frame: RelightFrame; readonly director: LightDirector; readonly light: CinematicLight; readonly data: CinematicData | null;
  } | null>(null);
```

replace the line `    void wanted.then((data) => {` with:

```ts
    // R1d: the cinematic light's code loads beside the package; without it the hall stays relit as R1b draws it.
    const lightCode: Promise<CinematicLight | null> = loadCinematicLight === null
      ? Promise.resolve(null)
      : loadCinematicLight().catch((reason: unknown) => {
        warnRelightFallback("cinematic", "The cinematic light could not be loaded; the hall stays relit without it.", reason);
        return null;
      });
    void Promise.all([wanted, lightCode]).then(([data, light]) => {
```

(its closing `}, fallBack);` stays: a package that fails still falls back), and replace the block

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
        // R1d: with the cinematic light loaded and on, the director is the only writer of the light (decision 7);
        // ?cinematic=off, or no cinematic code, keeps R1b's per-choice apply whole.
        const previewable = gaussianSplatsAvailable();
        const director = light === null || light.cinematicOffBySearch(window.location.search, previewable) ? null : new light.LightDirector({
          frame, invalidate,
          // The fallback eye's sky light, read back from the GPU the host draws with (ruling E1); none without one.
          readSkyLight: async () => {
            const renderer = nativeRendererForScene(scene);
            if (renderer !== null) await frame.readSkyLight(renderer);
          },
        });
        const apply = (): void => {
          frame.apply(applicationForChoice(frame.inputs, useLightSettingStore.getState().choice, (choiceLight) => frame.meanLight(choiceLight)));
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
        if (director !== null && light !== null) {
          setCinematic({ frame, director, light, data: null });
          void light.loadCinematicPackage(light.cinematicManifestUrl(data.baseUrl), data.manifest.model.tileToModel).then((found) => {
            if (cancelled || found === null) return;
            director.setCinematic({ lamps: found.lamps, eyeAnchors: found.eyeAnchors, city: null, calibration: light.CAPTURE_CALIBRATION });
            setCinematic({ frame, director, light, data: found });
          });
        }
```

(`data` is the resolved package in that callback, `light` the loaded entry or null, `scene` the provider's `useThree` scene and `cancelled` the effect's flag; R1b's `(light) => frame.meanLight(light)` is renamed `choiceLight` so it does not shadow the entry. R1b's `stop.push(frame.onDisplay(…))` line after the block stays. Task 15 gives the director the city's light.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/light-director.test.ts`
Expected: PASS, 10 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider.test.tsx`
Expected: PASS, the Task 0 count plus 1 (one R1b test replaced, one added). Its other tests start at the captured light (Task 6 Step 7), whose display the director holds at exactly the identity.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/RoomSplatScene.test.tsx`
Expected: PASS, the Task 0 count.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/light-director.ts src/components/scene/cinematic-light.ts src/components/scene/RelightProvider.tsx`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/light-director.ts packages/web/src/lib/relight/__tests__/light-director.test.ts packages/web/src/components/scene/cinematic-light.ts packages/web/src/components/scene/RelightProvider.tsx packages/web/src/components/scene/__tests__/RelightProvider.test.tsx && git diff --cached --stat && git commit -m "feat(relight): the light director: springs every frame while the light moves, nothing while it is still (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Shadow maps for the Sun and the Moon

**Files:**
- Create: `packages/web/src/lib/relight/sun-shadow.ts`, `packages/web/src/components/scene/RelightCinematic.tsx`, `packages/web/src/components/scene/cinematic-hooks.tsx`, `packages/web/src/components/scene/floor-hooks-context.ts`
- Modify: `packages/web/src/lib/relight/floor-material.ts`, `packages/web/src/components/stage/StageFloor.tsx`, `packages/web/src/components/scene/RelightProvider.tsx`, `packages/web/src/components/scene/cinematic-light.ts`
- Test: `packages/web/src/lib/relight/__tests__/sun-shadow.test.ts`, `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx`, `packages/web/src/components/scene/__tests__/RelightProvider-cinematic.test.tsx` (create)

**Interfaces:**
- Consumes: Task 8 (`CinematicData`: `occluders`, `probes[].box`), Task 7 (`InteriorShadowHook`, `NO_INTERIOR_SHADOW`, `RelightFrame.setShadowHook`, `KernelCinematic["interiorShadow"]`), Task 9 (`LightDirector.onLight`, `DisplayedLight`; the provider's `cinematic` state and `cinematic-light.ts`), Task 8 (`measureRelight`'s span `relight:cinematic-parts`); R1b's `SKY_BODIES` and `type SkyBody` (`relight-kernel.ts`), `litFloorMaterial` as amended by A2 and A5 (its `model` and `lightUv` nodes and the two bodies' term), `StageFloor`'s lit-material memo, `RelightProvider`'s render; R1c's `SkinLightHooksContext`, `SkinLightHooks`, `NO_SKIN_HOOKS`, `SkinSurface`, `SkinSheen` (the R1c interface, item 4) and its `RelightSkins` mount in the provider.
- Produces (`sun-shadow.ts`): `SHADOW_MAP_SIZE = 2048`, `SHADOW_PCF_SPACING = 0.02`, `SHADOW_BIAS = 0.02`, `SHADOW_REDRAW_DEGREES = 0.05`; `type SkyBodyName` (R1b's `SkyBody`, its `SKY_BODIES` list: one list, as R1c's `skin-light.ts` re-exports it); `type ShadowRenderer = Pick<WebGPURenderer, "getRenderTarget" | "setRenderTarget" | "getClearColor" | "getClearAlpha" | "setClearColor" | "clear" | "render">`; `interface LightView { readonly radius: number; readonly depthOrigin: number; readonly camera: OrthographicCamera; readonly viewProjection: Matrix4; readonly direction: Vec3 }`; `lightViewFor(direction: Vec3, box: readonly [Vec3, Vec3]): LightView`; `occludedFrom(triangles: Float32Array, origin: Vec3, direction: Vec3, minT: number): boolean`; `occluderGeometry(triangles: Float32Array): BufferGeometry`; `class SkyShadows` with `constructor(triangles: Float32Array, box: readonly [Vec3, Vec3])`, readonly `hook: InteriorShadowHook`, readonly `cpu: (position: Vec3, body: SkyBodyName) => number`, `update(renderer: ShadowRenderer, setting: RelightSetting): number` (the maps redrawn), `dispose(): void`.
- Produces (`floor-material.ts`): `interface FloorLightHooks { readonly interiorShadow: InteriorShadowHook | null; readonly sheen: ((surface: SkinSurface) => SkinSheen) | null }`, `NO_FLOOR_HOOKS`; `litFloorMaterial(map, frame, hooks?: FloorLightHooks)`.
- Produces (`floor-hooks-context.ts`): `FloorLightHooksContext` (default `NO_FLOOR_HOOKS`).
- Produces (`cinematic-hooks.tsx`): `interface CinematicHooks { readonly floor: FloorLightHooks; readonly skins: SkinLightHooks }`, `NO_CINEMATIC_HOOKS`, `CinematicHooksProvider({ hooks, children })` (provides `FloorLightHooksContext` and R1c's `SkinLightHooksContext`). It holds no cinematic code, so the provider imports it statically and wraps the scene and R1c's `RelightSkins` in it from the first render.
- Produces (`RelightCinematic.tsx`, exported through `cinematic-light.ts`): `interface RelightCinematicProps { readonly frame: RelightFrame | null; readonly director: LightDirector | null; readonly data: CinematicData | null; readonly transform: RuntimeAssetViewTransform; readonly onHooks: (hooks: CinematicHooks) => void }`; `RelightCinematic(props)`, mounted by the provider beside the relit scene, never around it: with all three present and a WebGPU renderer, it builds `SkyShadows` (timed as the span `relight:cinematic-parts`), draws the maps before the frame first uses them, sets the frame's shadow hook, redraws on the director's `onLight`, and hands `{ floor: { interiorShadow }, skins: { sunShadow } }` to `onHooks` (`NO_CINEMATIC_HOOKS` once unmounted); otherwise it hands the empty hooks. It renders a `relight-cinematic` group, where later tasks mount their parts.
- Produces (provider): it reads Task 9's `cinematic` state, keeps the mount's `hooks`, wraps `{children}` and R1c's `RelightSkins` in `CinematicHooksProvider`, and renders the lazily loaded `RelightCinematic` beside them.

Spec §4.2 asks for "a sun shadow map of interior occluders from a simplified occluder model", and the owner's requirement puts the Moon through the same machinery. Task 2's occluders (the chandeliers and the window wall's pilasters as 4 cm voxel shells) are drawn into one light-depth map per body slot. The map is orthographic, looking along −s from a sphere around the hall's box (from the package's probe boxes), 2,048 texels across about 24 m (about 1.2 cm a texel). Each texel holds the distance along the light from the camera to the nearest occluder (depth-tested, so no float blending is needed; 0 is the clear and means none); a point is shaded by an occluder nearer the light than itself by more than 2 cm. Sixteen taps 2 cm apart (±3 cm) soften the edge (PCF), which is about the penumbra of the Sun's 0.53° disc over the metre or so between a chandelier and what it shades. The maps are redrawn only when a body slot has turned 0.05° (a quarter of a texel at the far wall), so a still sky costs nothing and a sweep costs two small draws a frame. The R32F target is read with `textureLoad` (float32 textures are not filterable in core WebGPU), in the multiplier pass (a texture, so the pass stays within its eight storage buffers), the floor and the skins.

The CPU twin casts one ray per point toward the body (Möller–Trumbore over every triangle) and gives 1 or 0: a hard edge. The DEV checks (Task 22) compare it with the GPU only where the GPU's 16 taps agree (0 or 1), so the penumbra is never counted as a disagreement.

The mount sits beside the relit scene, not around it, and hands its hooks up. The cinematic light's code is loaded lazily (Task 9, finding B15), so a component that wrapped the scene would change the scene's parents when the code arrived and remount every splat and skin. Instead the provider wraps the scene and R1c's skins, from the first render, in `CinematicHooksProvider`, whose value the mount sets through `onHooks`. That also puts R1c's `RelightSkins`, which the provider mounts beside `{children}` and which reads `SkinLightHooksContext`, inside the hooks (finding B1: wrapped around `{children}` alone, every skin would have stayed without the interior shadow, the sheen and the reflections). `RelightProvider-cinematic.test.tsx` checks that the scene and the skins both receive the mount's hooks.

Verified (7 October; R1b's and R1c's lines re-read on 8 October): three 0.186 `src/nodes/accessors/TextureNode.js:1034` (`textureLoad = (...params) => texture(...params).setSampler(false)`), `src/nodes/accessors/Position.js:62` (`positionWorld`), `src/nodes/tsl/TSLCore.js:1219` (`ivec2`), `src/core/RenderTarget.js:54` (`constructor(width, height, options)`: `type`, `format`, `depthBuffer`, filters), `src/renderers/common/Renderer.js:1496` (`render`), `:2352` (`getClearColor(target)`), `:2364` (`setClearColor(color, alpha = 1)`), `:2376` (`getClearAlpha`), `:2460` (`clear`), `:2737` (`setRenderTarget`), `:2750` (`getRenderTarget`); @types/three 0.186 `src/renderers/common/Renderer.d.ts:510` (`render(…): void`) and `:768` (`clear(…): void`), so they take no `void` operator (`no-meaningless-void-operator`, finding B9); R1b plan lines 8781–8797 (`litFloorMaterial`: `const model = u.tileToModel.mul(vec4(positionLocal, 1)).xyz.toVar();`, `lightUv`, the two bodies' term), 8883 and 8904–8912 (`StageFloor`: `const relightFrame = relight.frame;`, the memo's `return floor.tiles.map((tile) => litFloorMaterial(tile.map, relightFrame));`, deps `[floor, colourMode, relightFrame]`), 9467–9470 (the provider's render), 9007 (`WEBGPU`), 9488–9491 (`mountInStubRoot(element, width, height, renderer fields)`), 2449–2450 (`SKY_BODIES`, `type SkyBody`); R1c Task 21 Step 6 (the provider's `{frame !== null && <RelightSkins frame={frame} transform={transform} />}` beside the panels), R1c's `RelightSkins` (`const hooks = useContext(SkinLightHooksContext);`), `NO_SKIN_HOOKS` (`skin-material.ts`) and `SkinLightHooksContext` (`skin-hooks-context.ts`); amendment A5 (the floor's two bodies' term); the R1c interface items 4 (`SkinLightHooks.sunShadow(position, body)`) and 5.

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
import { useContext, useState, type ReactElement, type ReactNode } from "react";
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
import { CinematicHooksProvider, NO_CINEMATIC_HOOKS, type CinematicHooks } from "../cinematic-hooks.js";
import { FloorLightHooksContext } from "../floor-hooks-context.js";
import { RelightCinematic, type RelightCinematicProps } from "../RelightCinematic.js";
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
/** The provider's arrangement (Step 5): the mount beside the scene, its hooks handed down through CinematicHooksProvider. */
function Cinematic({ children, ...props }: Omit<RelightCinematicProps, "onHooks"> & { readonly children?: ReactNode }): ReactElement {
  const [hooks, setHooks] = useState<CinematicHooks>(NO_CINEMATIC_HOOKS);
  return (
    <>
      <RelightCinematic {...props} onHooks={setHooks} />
      <CinematicHooksProvider hooks={hooks}>{children}</CinematicHooksProvider>
    </>
  );
}
const renderer = () => ({
  isWebGPURenderer: true, render: vi.fn(), clear: vi.fn(), setRenderTarget: vi.fn(), getRenderTarget: () => null,
  getClearColor: <T,>(target: T): T => target, getClearAlpha: () => 1, setClearColor: vi.fn(), compute: vi.fn(),
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
    mounted = mountInStubRoot(<Cinematic frame={frame} director={director} data={cinematic()} transform={IDENTITY}><Probe /></Cinematic>, 1440, 900, gl);
    await act(async () => { await Promise.resolve(); });
    expect(setHook).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    expect(typeof seen.at(-1)?.floor).toBe("function");
    expect(seen.at(-1)?.skin).toBe(seen.at(-1)?.floor);
    mounted.unmount();
    mounted = null;
    expect(setHook).toHaveBeenLastCalledWith(null, null);
  });

  it("hands the scene no hooks without the package", async () => {
    const frame = new RelightFrame(data);
    mounted = mountInStubRoot(<Cinematic frame={frame} director={null} data={null} transform={IDENTITY}><Probe /></Cinematic>, 1440, 900, renderer());
    await act(async () => { await Promise.resolve(); });
    expect(seen.at(-1)).toEqual({ floor: null, skin: null });
  });
});
```

Create `packages/web/src/components/scene/__tests__/RelightProvider-cinematic.test.tsx` (the provider's arrangement with the mount and R1c's skins faked: the scene and the skins both receive the mount's hooks):

```tsx
import { useContext } from "react";
import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCinematicPackages } from "../../../lib/relight/cinematic-package.js";
import { loadRelightModelData, type RelightModelData } from "../../../lib/relight/relight-assets.js";
import { resetRelightWarnings } from "../../../lib/relight/relight-warning.js";
import { buildTestPackage } from "../../../lib/relight/__tests__/relight-test-package.js";
import type { RuntimeAssetViewTransform } from "../../../lib/runtime-package-resolution.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import type { CinematicHooks } from "../cinematic-hooks.js";
import { FloorLightHooksContext } from "../floor-hooks-context.js";
import { RelightProvider } from "../RelightProvider.js";

// The mount, faked: it hands the provider known hooks. R1c's skins, faked: they record the hooks they receive.
const TEST = vi.hoisted(() => ({
  shadow: (): never => { throw new Error("The test's shadow hook is never drawn."); },
  skins: new Array<unknown>(),
}));
vi.mock(import("../RelightCinematic.js"), async () => {
  const { createElement, useEffect } = await import("react");
  return {
    RelightCinematic: ({ onHooks }: { readonly onHooks: (hooks: CinematicHooks) => void }) => {
      useEffect(() => {
        onHooks({ floor: { interiorShadow: TEST.shadow, sheen: null }, skins: { sunShadow: TEST.shadow, sheen: null } });
      }, [onHooks]);
      return createElement("group");
    },
  };
});
vi.mock(import("../RelightSkins.js"), async () => {
  const { useContext: read } = await import("react");
  const { SkinLightHooksContext } = await import("../skin-hooks-context.js");
  return {
    RelightSkins: (): null => {
      TEST.skins.push(read(SkinLightHooksContext).sunShadow);
      return null;
    },
  };
});

const WEBGPU = { isWebGPURenderer: true, backend: { device: { limits: { maxStorageBufferBindingSize: 134_217_728, maxStorageBuffersPerShaderStage: 16 } } } };
const IDENTITY: RuntimeAssetViewTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" };
const floors: unknown[] = [];
function Probe(): null {
  floors.push(useContext(FloorLightHooksContext).interiorShadow);
  return null;
}

let data: RelightModelData;
let mounted: StubRoot | null = null;
const initial = useLightSettingStore.getState();
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
  await import("../cinematic-light.js");
});
beforeEach(() => {
  useLightSettingStore.setState(initial, true);
  useLightSettingStore.getState().selectPreset("captured");
  floors.length = 0;
  TEST.skins.length = 0;
  // No cinematic package beside the test package: the mount runs without one, off the network.
  vi.stubGlobal("fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 404 })));
});
afterEach(() => { mounted?.unmount(); mounted = null; resetRelightWarnings(); resetCinematicPackages(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function settle(ms = 60): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, ms); }); });
}

describe("the relight provider with the cinematic light (T-639 R1d)", () => {
  it("hands the mount's hooks to the scene and to R1c's skins (finding B1)", async () => {
    mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
    await settle();
    expect(floors.at(-1)).toBe(TEST.shadow);
    expect(TEST.skins.at(-1)).toBe(TEST.shadow);
  });

  it("hands neither any hook with ?cinematic=off", async () => {
    window.history.replaceState({}, "", "/?cinematic=off");
    try {
      mounted = mountInStubRoot(<RelightProvider relightPackage={Promise.resolve(data)} transform={IDENTITY}><Probe /></RelightProvider>, 1440, 900, WEBGPU);
      await settle();
      expect(TEST.skins.length).toBeGreaterThan(0);
      expect([floors.at(-1), TEST.skins.at(-1)]).toEqual([null, null]);
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shadow.test.ts`
Expected: FAIL — cannot find module `../sun-shadow.js`.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: FAIL — cannot find module `../cinematic-hooks.js` (or `../RelightCinematic.js`).

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider-cinematic.test.tsx`
Expected: FAIL — cannot find module `../floor-hooks-context.js` (or `../RelightCinematic.js`).

- [ ] **Step 3: The maps** — create `packages/web/src/lib/relight/sun-shadow.ts`:

```ts
import { BufferAttribute, BufferGeometry, Color, DoubleSide, FloatType, Matrix4, Mesh, NearestFilter, OrthographicCamera, RedFormat, Scene, Vector3 } from "three";
import { MeshBasicNodeMaterial, RenderTarget, type Node, type UniformNode, type WebGPURenderer } from "three/webgpu";
import { clamp, dot, float, floor, ivec2, positionWorld, select, textureLoad, uniform, vec2, vec4 } from "three/tsl";
import type { Vec3 } from "./relight-codec.js";
import type { InteriorShadowHook } from "./relight-frame.js";
import { SKY_BODIES, type RelightSetting, type SkyBody } from "./relight-kernel.js";

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
/** R1b's sky bodies: one list (R1c's `skin-light.ts` re-exports the same). */
export type SkyBodyName = SkyBody;
const BODIES = SKY_BODIES;
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
    renderer.clear();
    renderer.render(this.scene, view.camera);
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

- [ ] **Step 5: The mount** — create `packages/web/src/components/scene/cinematic-hooks.tsx` (no cinematic code: the provider imports it statically):

```tsx
import type { ReactElement, ReactNode } from "react";
import { NO_FLOOR_HOOKS, type FloorLightHooks } from "../../lib/relight/floor-material.js";
import { NO_SKIN_HOOKS, type SkinLightHooks } from "../../lib/skins/skin-material.js";
import { FloorLightHooksContext } from "./floor-hooks-context.js";
import { SkinLightHooksContext } from "./skin-hooks-context.js";

/** The cinematic light's hooks into the relit floor and R1c's skins (T-639 R1d): interior shadow, sheen, reflections. */
export interface CinematicHooks {
  readonly floor: FloorLightHooks;
  readonly skins: SkinLightHooks;
}
export const NO_CINEMATIC_HOOKS: CinematicHooks = { floor: NO_FLOOR_HOOKS, skins: NO_SKIN_HOOKS };

/**
 * Gives the cinematic light's hooks to the relit scene and R1c's skins. The provider mounts it from the first render,
 * so the lazily loaded cinematic light only changes its value and never remounts the scene (findings B1, B15).
 */
export function CinematicHooksProvider({ hooks, children }: { readonly hooks: CinematicHooks; readonly children?: ReactNode }): ReactElement {
  return (
    <SkinLightHooksContext.Provider value={hooks.skins}>
      <FloorLightHooksContext.Provider value={hooks.floor}>{children}</FloorLightHooksContext.Provider>
    </SkinLightHooksContext.Provider>
  );
}
```

Create `packages/web/src/components/scene/RelightCinematic.tsx`:

```tsx
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import type { WebGPURenderer } from "three/webgpu";
import type { CinematicData } from "../../lib/relight/cinematic-package.js";
import { NO_FLOOR_HOOKS, type FloorLightHooks } from "../../lib/relight/floor-material.js";
import type { LightDirector } from "../../lib/relight/light-director.js";
import type { RelightFrame } from "../../lib/relight/relight-frame.js";
import { measureRelight } from "../../lib/relight/relight-spans.js";
import { SkyShadows } from "../../lib/relight/sun-shadow.js";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import type { SkinLightHooks } from "../../lib/skins/skin-material.js";
import { NO_CINEMATIC_HOOKS, type CinematicHooks } from "./cinematic-hooks.js";

export interface RelightCinematicProps {
  readonly frame: RelightFrame | null;
  readonly director: LightDirector | null;
  readonly data: CinematicData | null;
  /** The room's model-to-scene placement, for what this mounts into the scene (Tasks 11, 15). */
  readonly transform: RuntimeAssetViewTransform;
  /** Hands the parts' hooks to the provider, which gives them to the floor and R1c's skins (`CinematicHooksProvider`). */
  readonly onHooks: (hooks: CinematicHooks) => void;
}

function isShadowRenderer(gl: unknown): gl is WebGPURenderer {
  return typeof gl === "object" && gl !== null && "isWebGPURenderer" in gl && gl.isWebGPURenderer === true;
}

/**
 * The cinematic light inside a relit session (T-639 R1d): the interior shadows of both bodies (this task), then the
 * bulbs, the composer, the shafts, the window view and the probes (Tasks 11–18). Loaded lazily (development and
 * preview bundles only) and mounted beside the relit scene, it hands its hooks up; without the package, or on WebGL2,
 * it hands none, and the hall stays relit as R1b and R1c draw it.
 */
export function RelightCinematic({ frame, director, data, onHooks }: RelightCinematicProps): ReactElement {
  const gl = useThree((state) => state.gl);
  const [shadows, setShadows] = useState<SkyShadows | null>(null);

  useEffect(() => {
    const box = data?.probes[0]?.box;
    if (frame === null || director === null || data === null || box === undefined || !isShadowRenderer(gl)) return;
    // The maps exist before any pass reads them: drawn for the light already applied, then the hook handed over.
    const created = measureRelight("relight:cinematic-parts", () => {
      const built = new SkyShadows(data.occluders, box);
      if (frame.current !== null) built.update(gl, frame.current.setting);
      return built;
    });
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
  // The provider gives these to the relit floor and to R1c's skins; none once this is unmounted.
  useEffect(() => { onHooks({ floor: floorHooks, skins: skinHooks }); }, [floorHooks, skinHooks, onHooks]);
  useEffect(() => () => { onHooks(NO_CINEMATIC_HOOKS); }, [onHooks]);
  return (
    <group name="relight-cinematic">
    </group>
  );
}
```

In `packages/web/src/components/scene/cinematic-light.ts`, append `export { RelightCinematic } from "./RelightCinematic.js";`.

In `packages/web/src/components/scene/RelightProvider.tsx`, add `import { CinematicHooksProvider, NO_CINEMATIC_HOOKS, type CinematicHooks } from "./cinematic-hooks.js";`; replace Task 9's `  const [, setCinematic] = useState<{` with `  const [cinematic, setCinematic] = useState<{`, and directly after that state's closing line `  } | null>(null);` add `  const [hooks, setHooks] = useState<CinematicHooks>(NO_CINEMATIC_HOOKS);`. Directly before the provider's `return (` add `  const live = cinematic !== null && cinematic.frame === frame ? cinematic : null;`, and replace its render (R1b's, with R1c Task 21's skins):

```tsx
    <RelightContext.Provider value={state}>
      {children}
      {frame !== null && <RelightSkyPanels frame={frame} transform={transform} />}
      {frame !== null && <RelightSkins frame={frame} transform={transform} />}
    </RelightContext.Provider>
```

with:

```tsx
    <RelightContext.Provider value={state}>
      {/* R1d: the scene and R1c's skins take the cinematic light's hooks (finding B1). This wrapper is always mounted,
          so the lazily loaded cinematic light changes its value and never remounts the scene. */}
      <CinematicHooksProvider hooks={live === null ? NO_CINEMATIC_HOOKS : hooks}>
        {children}
        {frame !== null && <RelightSkins frame={frame} transform={transform} />}
      </CinematicHooksProvider>
      {frame !== null && <RelightSkyPanels frame={frame} transform={transform} />}
      {live !== null && (
        <live.light.RelightCinematic frame={live.frame} director={live.director} data={live.data} transform={transform} onHooks={setHooks} />
      )}
    </RelightContext.Provider>
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shadow.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 2 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightProvider-cinematic.test.tsx`
Expected: PASS, 2 tests.

Then, one per command: `src/components/scene/__tests__/RelightProvider.test.tsx`, `src/components/stage/__tests__/StageFloor.test.tsx`, `src/lib/relight/__tests__/relight-draw.test.ts`, `src/components/scene/__tests__/RelightSkins.test.tsx` (R1c's). Expected: PASS, each at its count after Task 9 (the floor, the skins and the provider render as before without the package).

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/sun-shadow.ts src/lib/relight/floor-material.ts src/components/scene/RelightCinematic.tsx src/components/scene/cinematic-hooks.tsx src/components/scene/cinematic-light.ts src/components/scene/floor-hooks-context.ts src/components/stage/StageFloor.tsx src/components/scene/RelightProvider.tsx src/components/scene/__tests__/RelightCinematic.test.tsx src/components/scene/__tests__/RelightProvider-cinematic.test.tsx`
Expected: no errors, no problems.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/sun-shadow.ts packages/web/src/lib/relight/__tests__/sun-shadow.test.ts packages/web/src/lib/relight/floor-material.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/cinematic-hooks.tsx packages/web/src/components/scene/cinematic-light.ts packages/web/src/components/scene/floor-hooks-context.ts packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx packages/web/src/components/scene/__tests__/RelightProvider-cinematic.test.tsx packages/web/src/components/stage/StageFloor.tsx packages/web/src/components/scene/RelightProvider.tsx && git diff --cached --stat && git commit -m "feat(relight): shadow maps of the interior occluders for the Sun and the Moon (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Crisp frosted lamps: candles and the crown tubes

**Files:**
- Create: `packages/web/src/lib/relight/bulbs.ts`
- Modify: `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/bulbs.test.ts` (create), `packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 8 (`CinematicData`: `bulbs` with per-bulb `kind` and `intensity`, `envelopes`, `glow`; `BULB_KINDS`, `BulbGroup`, `BulbKind`, `BulbEnvelope`, `CinematicBulb`), Task 7 (`RelightFrame.setGlow`), Task 10 (the mount's `relight-cinematic` group), Task 8's span `relight:cinematic-parts`; R1b's `RelightFrame` (`uniforms.sourceWeights`, `uniforms.display`, `tileToModel`), `probeReads(frame)` and `bounceNode(u, reads, p, normal, iso)` (the folded scenario probes on the GPU), and for the CPU twin `KernelFrame.scenarioCube`, `trilinearCorners`, `cubeEval`, `ProbeField`; `displayNode`, `HIGHLIGHT_KNEE`; three's `LatheGeometry`, `mrt`, `instancedBufferAttribute`, `Fn`, `bool`.
- Produces (`bulbs.ts`): `BLOOM_SHARE = 0.04`, `glowShare` (the share in force, a uniform the composer sets from its glare), `BULB_GLASS_ALBEDO = 0.6`, `BULB_SOURCE = { ch_end: 6, ch_centre: 7 }`, `CANDLE_OUTLINE` and `TUBE_OUTLINE` (radius and height fractions), `LAMP_OUTLINES: Record<BulbKind, …>`, `LATHE_SEGMENTS = 24`; `envelopeArea(envelope: BulbEnvelope, kind: BulbKind): number`; `envelopeCentroid(envelope: BulbEnvelope, kind: BulbKind): number`; `lampGeometry(envelope: BulbEnvelope, kind: BulbKind): BufferGeometry`; `bulbRadiancePerWeight(intensity: number, area: number): number`; `ambientAt(frame: Pick<KernelFrame, "scenarioCube">, field: ProbeField, position: Vec3): Rgb` (the glass's light on the CPU: tests and checks only); `class CrispBulbs` with `constructor(frame: RelightFrame, data: CinematicData)` (one instanced mesh per group and kind: `relight-bulbs-<group>` for candles, `relight-bulbs-ch_centre-crown` for the crown tubes), readonly `object: Group` (model frame), `dispose(): void`.
- Produces (mount): `RelightCinematic` draws the lamps at the room's placement and hands the chandeliers to the kernel's glow hiding while they are drawn (`setGlow(data.glow)`, and `[]` when they go); nothing of theirs runs on the CPU after an apply.

The lamps' light already reaches every surface through the bake (the multiplier, the floor, the skins); the crisp lamps give the eye what the capture could not (decision 1): sharp, small, bright frosted glass where the capture's blown-out glow was. Each candle is a frosted candle envelope (a lathe of a candle-flame outline, 35 mm across and 70 mm tall from the package's `envelopes.candle`, a design value for Blake until the venue names its lamp), and each of the centre chandelier's seven crown tubes a smaller frosted tube (a cylinder with a rounded top, 25 mm across and 50 mm tall from `envelopes.crown`, the controller's ruling L2, a design value too); each stands upright at its triangulated position, the centroid of its glowing surface on the point the photographs fix (the table's position is the centroid of the clipped core). Frosted or opal glass glows evenly, so the envelope has one radiance over its whole surface: a convex emitter of even radiance L sends π L S through its surface S, a point of intensity I sends 4π I, so `L = 4 I / S` (for a sphere this is R1b's `I / (π r²)`) with S its kind's surface and I the lamp's own intensity per unit of its group's weight (Task 3, solved from the floor's bake with the refit's shares: a crown tube at `wCrown` of a candle's, ruling L2). One instanced mesh is drawn per group and kind. So the glass, the sheen of a lamp (Task 17), its glow and the floor all agree, and no lamp weight is assumed (decision 11): the group's source weight is the package's, times the fade, the dimming tint and the night gain (Task 6), so a lamp fading in on the warm-down passes through amber (the owner's artistic choice; an `led` group fades at constant colour). A small share of the light (`BLOOM_SHARE`, 4%, a design value) leaves the glass and is written to the composer's emission target (Task 13), which spreads it into the glow: energy is moved, never added. Unlit, the glass shows the light around it: its frosted albedo (0.6, a design value) times the isotropic light of the folded scenario probes at the lamp, read on the GPU from R1b's fold (`bounceNode` over `probeReads(frame)`, the scenario volume the frame's prepare writes after each apply). Nothing of the lamps runs on the CPU after an apply: reading the fold on the CPU (`KernelFrame.scenarioCube`) would take each sky body's light from the frame's CPU store, which R1b fills from the CPU twin at most once per body and refreshes only from the GPU's read-backs, so it would be stale and, before R1b's 8 October change, cost the twin's 4–9 ms per body every frame of a sweep (finding I2, the controller's ruling E1). `ambientAt` stays as that light's CPU twin for the tests. The dome has no crisp lamps (its bright class-4 splats are crests lit by LED pin spots).

Verified (7 October; R1b's lines re-read on 8 October): R1b plan lines 6282 (`sourceWeights: uniformArray<"vec3">(sourceWeights, "vec3")`), 6671–6678 (`probeReads(frame)`: the capture's and the scenario's folded volumes, read-only storage), 6684–6711 (`bounceNode(u, reads, p, normal, iso: Node<"bool">)`: trilinear over valid probes, `{ capture; scenario }`), 2760 (`trilinearCorners`), 2784 (`cubeEval(cube, normal, iso)`), 2726 (`KernelFrame.scenarioCube(index): Float64Array`), 9314–9327 (`RelightSkyPanels`: `const [px, py, pz] = transform.position; const [rx, ry, rz] = transform.rotation;` and the model-to-tile matrix `frame.tileToModel.clone().invert()` inside a group at the room's placement); `packages/web/src/lib/runtime-package-resolution.ts:63` (`rotation: readonly [number, number, number]`) and @react-three/fiber 8.18 `three-types.d.ts:15` (`rotation` takes a mutable tuple, finding B10); @types/three 0.186 `src/nodes/accessors/BufferAttributeNode.d.ts:219` (`instancedBufferAttribute<T>(array, type?)`: the type argument names the node's type); `tools/relight/relight/cinematic.py` (Task 3: `SOURCE_INDEX` 6 and 7, `ENVELOPES`); float32 holds 1.125 and 1.0625 exactly, not 1.1 (`Math.fround(1.1)` is 1.100000023841858, finding B2); `D:/claude/real-hall/frontier/splats/scripts/10_bulb_table.py:1-9` (a position is the centroid of the bulb's clipped core); three 0.186 `src/geometries/LatheGeometry.js` (`LatheGeometry(points: Vector2[], segments, phiStart, phiLength)`, revolved about +y), `src/nodes/core/MRTNode.js:243` (`mrt`), `src/materials/nodes/NodeMaterial.js:564` (a material's `mrtNode` merges with the renderer's MRT), `src/nodes/accessors/BufferAttributeNode.js:428` (`instancedBufferAttribute`).

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/bulbs.test.ts`:

```ts
import { Box3, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CrispBulbs, ambientAt, bulbRadiancePerWeight, envelopeArea, envelopeCentroid, lampGeometry,
} from "../bulbs.js";
import type { BulbEnvelope, CinematicData } from "../cinematic-package.js";
import { loadRelightModelData, type RelightModelData } from "../relight-assets.js";
import { RelightFrame } from "../relight-frame.js";
import { OPEN_BOX, type ProbeField } from "../relight-kernel.js";
import { FIXTURE_CENTRES, FIXTURE_ENVELOPES, cinematicData } from "./cinematic-fixture.js";
import { buildTestPackage } from "./relight-test-package.js";

let data: RelightModelData;
beforeAll(async () => {
  const pkg = buildTestPackage();
  data = await loadRelightModelData(pkg.fetch, pkg.manifestUrl);
});
const CANDLE: BulbEnvelope = FIXTURE_ENVELOPES.candle;
const CROWN: BulbEnvelope = FIXTURE_ENVELOPES.crown;
// Positions float32 holds exactly: an instance matrix is float32 (finding B2).
const cinematic = (): CinematicData => cinematicData({
  bulbs: [
    { id: "c0_b00", group: "ch_end", kind: "candle", chandelier: 0, position: [1, 2, 3], intensity: 2 },
    { id: "c0_b01", group: "ch_end", kind: "candle", chandelier: 0, position: [1.125, 2, 3], intensity: 3 },
    { id: "c2_b00", group: "ch_centre", kind: "candle", chandelier: 2, position: [5, 5, 6], intensity: 4 },
    { id: "c2_b40", group: "ch_centre", kind: "crown", chandelier: 2, position: [5, 5, 7.25], intensity: 1.5 },
  ],
  glow: FIXTURE_CENTRES.map((centre, id) => ({ centre, crisp: id === 0 || id === 2 })),
});

describe("crisp frosted lamps (T-639 R1d)", () => {
  it("glows evenly: a lamp's intensity over a quarter of its glowing surface", () => {
    expect(bulbRadiancePerWeight(2, 0.01)).toBeCloseTo(800, 9);
    const sphere = 4 * Math.PI * 0.02 * 0.02;
    expect(bulbRadiancePerWeight(2, sphere)).toBeCloseTo(2 / (Math.PI * 0.0004), 9);
  });

  it("measures each kind's glowing surface: the candle between a cone's and a cylinder's, the crown tube's near its cylinder's", () => {
    const area = envelopeArea(CANDLE, "candle");
    expect(area).toBeGreaterThan(Math.PI * 0.0175 * Math.hypot(0.0175, 0.07));
    expect(area).toBeLessThan(2 * Math.PI * 0.0175 * 0.07);
    const centroid = envelopeCentroid(CANDLE, "candle");
    expect(centroid).toBeGreaterThan(0.2 * 0.07);
    expect(centroid).toBeLessThan(0.5 * 0.07);
    const tube = envelopeArea(CROWN, "crown");
    expect(tube).toBeGreaterThan(2 * Math.PI * 0.0125 * 0.8 * 0.05);
    expect(tube).toBeLessThan(2 * Math.PI * 0.0125 * 0.05 + Math.PI * 0.0125 * 0.0125);
    expect(envelopeCentroid(CROWN, "crown") / 0.05).toBeGreaterThan(0.4);
    expect(envelopeCentroid(CROWN, "crown") / 0.05).toBeLessThan(0.6);
  });

  it("stands each lamp upright along +z, centred on its glowing surface", () => {
    for (const [envelope, kind] of [[CANDLE, "candle"], [CROWN, "crown"]] as const) {
      const geometry = lampGeometry(envelope, kind);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new Box3();
      expect(box.max.z - box.min.z).toBeCloseTo(envelope.height, 6);
      expect(box.max.x - box.min.x).toBeCloseTo(2 * envelope.radius, 4);
      expect(box.min.z).toBeCloseTo(-envelopeCentroid(envelope, kind), 6);
      geometry.dispose();
    }
  });

  it("reads the light around the glass as the probes' isotropic mean (the CPU twin)", () => {
    const field: ProbeField = { origin: [0, 0, 0], spacing: 1, shape: [2, 2, 2], box: OPEN_BOX, valid: () => true, cube: () => new Float32Array(162) };
    const cube = Float64Array.from({ length: 18 }, (_unused, index) => (index < 6 ? 0.3 : index < 12 ? 0.6 : 0.9));
    expect(ambientAt({ scenarioCube: () => cube }, field, [0.5, 0.5, 0.5])).toEqual([0.3, 0.6, 0.9]);
  });

  it("draws one instanced mesh per group and kind at the triangulated positions, unscaled", () => {
    const frame = new RelightFrame(data);
    const bulbs = new CrispBulbs(frame, cinematic());
    const meshes = bulbs.object.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
    expect(meshes.map((mesh) => [mesh.name, mesh.count])).toEqual([
      ["relight-bulbs-ch_end", 2], ["relight-bulbs-ch_centre", 1], ["relight-bulbs-ch_centre-crown", 1],
    ]);
    const matrix = new Matrix4();
    meshes[0]?.getMatrixAt(1, matrix);
    const position = new Vector3(), scale = new Vector3();
    matrix.decompose(position, new Quaternion(), scale);
    expect(position.toArray()).toEqual([1.125, 2, 3]);
    expect(scale.toArray()).toEqual([1, 1, 1]);
    bulbs.dispose();
  });

  it("lights the unlit glass on the GPU from the scenario fold, so an apply costs the lamps nothing on the CPU (ruling E1)", () => {
    const frame = new RelightFrame(data);
    const onApply = vi.spyOn(frame, "onApply");
    const bulbs = new CrispBulbs(frame, cinematic());
    expect(onApply).not.toHaveBeenCalled();
    const meshes = bulbs.object.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
    expect(meshes).toHaveLength(3);
    expect(meshes.every((mesh) => mesh.material instanceof MeshBasicNodeMaterial && mesh.material.colorNode !== null && mesh.material.mrtNode !== null)).toBe(true);
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
    const withLamps: CinematicData = { ...cinematic(), bulbs: [{ id: "c2_b00", group: "ch_centre", kind: "candle", chandelier: 2, position: [8.9, -5, 5.5], intensity: 0.02 }], glow: centre };
    mounted = mountInStubRoot(<Cinematic frame={frame} director={director} data={withLamps} transform={IDENTITY}><Probe /></Cinematic>, 1440, 900, renderer());
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
  DoubleSide, Group, InstancedBufferAttribute, InstancedMesh, LatheGeometry, Matrix4, Vector2, type BufferGeometry,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { Fn, bool, float, instancedBufferAttribute, mrt, uniform, vec3, vec4 } from "three/tsl";
import { BULB_KINDS, type BulbEnvelope, type BulbGroup, type BulbKind, type CinematicData } from "./cinematic-package.js";
import { HIGHLIGHT_KNEE, displayNode } from "./display.js";
import type { Vec3 } from "./relight-codec.js";
import { bounceNode, probeReads, type RelightFrame } from "./relight-frame.js";
import { cubeEval, trilinearCorners, type KernelFrame, type ProbeField, type Rgb } from "./relight-kernel.js";

/**
 * Crisp frosted lamps at the triangulated bulbs (T-639 R1d, decision 1): candles, and the centre chandelier's crown
 * tubes (the controller's ruling L2). Each glows evenly over its kind's envelope with the radiance its intensity gives,
 * so its glass, sheen and glow agree with the light the bake already throws, and gives a small share of it to the
 * composer's glow; unlit, its frosted glass shows the light around it, read on the GPU.
 */
export const BLOOM_SHARE = 0.04;
export const BULB_GLASS_ALBEDO = 0.6;
export const BULB_SOURCE: Readonly<Record<BulbGroup, number>> = { ch_end: 6, ch_centre: 7 };
/**
 * The glow's share in force for every emitter (these lamps and the Moon's disc, Task 15): the composer sets it from its
 * glare (Task 13: the design glow's BLOOM_SHARE, or the fitted CIE glare's 0.632) and restores BLOOM_SHARE when it goes.
 * One value for the session's one relit canvas.
 */
export const glowShare = uniform(BLOOM_SHARE);
const BULB_GROUPS: readonly BulbGroup[] = ["ch_end", "ch_centre"];
type Outline = readonly (readonly [number, number])[];
/** A frosted candle lamp's outline as (radius, height) fractions of the envelope's, base to tip; the holder hides the base. */
export const CANDLE_OUTLINE: Outline = [
  [0.8, 0], [0.95, 0.08], [1, 0.2], [0.98, 0.35], [0.88, 0.5], [0.7, 0.65], [0.48, 0.8], [0.26, 0.91], [0.1, 0.98], [0, 1],
];
/** A crown tube's outline: a frosted cylinder with a rounded top, base to tip (a design value, like the candle's). */
export const TUBE_OUTLINE: Outline = [[1, 0], [1, 0.8], [0.97, 0.88], [0.87, 0.94], [0.66, 0.98], [0.36, 0.995], [0, 1]];
export const LAMP_OUTLINES: Readonly<Record<BulbKind, Outline>> = { candle: CANDLE_OUTLINE, crown: TUBE_OUTLINE };
export const LATHE_SEGMENTS = 24;

const frusta = (envelope: BulbEnvelope, kind: BulbKind): { readonly area: number; readonly height: number }[] => {
  const outline = LAMP_OUTLINES[kind];
  return outline.slice(1).map((point, k) => {
    const previous = outline[k] ?? point;
    const a = previous[0] * envelope.radius, b = point[0] * envelope.radius;
    const rise = (point[1] - previous[1]) * envelope.height;
    return { area: Math.PI * (a + b) * Math.hypot(b - a, rise), height: ((previous[1] + point[1]) / 2) * envelope.height };
  });
};

/** The envelope's glowing surface: its sides (the holder covers the base), the sum of the outline's frusta. */
export function envelopeArea(envelope: BulbEnvelope, kind: BulbKind): number {
  return frusta(envelope, kind).reduce((sum, frustum) => sum + frustum.area, 0);
}

/** The height of the glowing surface's centroid above the envelope's base. */
export function envelopeCentroid(envelope: BulbEnvelope, kind: BulbKind): number {
  const parts = frusta(envelope, kind);
  return parts.reduce((sum, frustum) => sum + frustum.area * frustum.height, 0) / envelopeArea(envelope, kind);
}

/** A lamp's envelope, its axis along +z (the model frame's up), centred on its glowing surface's centroid. */
export function lampGeometry(envelope: BulbEnvelope, kind: BulbKind): BufferGeometry {
  const outline = LAMP_OUTLINES[kind].map(([radius, height]) => new Vector2(radius * envelope.radius, height * envelope.height));
  const geometry = new LatheGeometry(outline, LATHE_SEGMENTS);
  geometry.translate(0, -envelopeCentroid(envelope, kind), 0);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** An even emitter of radiance L sends π L S through its surface S; a point of intensity I sends 4π I: L = 4 I / S. */
export function bulbRadiancePerWeight(intensity: number, area: number): number {
  return (4 * intensity) / area;
}

/**
 * The CPU twin of the glass's light (tests and checks only): the isotropic light at a point from the folded scenario
 * probes, trilinear over valid probes. The lamps themselves read it on the GPU (`bounceNode`).
 */
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

export class CrispBulbs {
  readonly object = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshBasicNodeMaterial[] = [];

  constructor(frame: RelightFrame, data: CinematicData) {
    this.object.name = "relight-bulbs";
    const u = frame.uniforms;
    const reads = probeReads(frame);
    for (const group of BULB_GROUPS) {
      for (const kind of BULB_KINDS) {
        const members = data.bulbs.filter((bulb) => bulb.group === group && bulb.kind === kind);
        if (members.length === 0) continue;
        const envelope = data.envelopes[kind];
        const geometry = lampGeometry(envelope, kind);
        // The node type is named explicitly: an unconstrained type parameter would widen "float" to string.
        const intensity = instancedBufferAttribute<"float">(new InstancedBufferAttribute(Float32Array.from(members, (bulb) => bulb.intensity), 1), "float");
        const position = instancedBufferAttribute<"vec3">(new InstancedBufferAttribute(Float32Array.from(members.flatMap((bulb) => [...bulb.position])), 3), "vec3");
        // L = w[k] × I_b × 4 / S_kind. The weight carries the fade, the dimming tint (the owner's artistic warm-down
        // unless the group is LED) and the night gain (Task 6).
        const emitted = u.sourceWeights.element(BULB_SOURCE[group]).mul(intensity).mul(4 / envelopeArea(envelope, kind));
        const material = new MeshBasicNodeMaterial({ fog: false, toneMapped: false, side: DoubleSide });
        material.name = `relight-bulb-${group}-${kind}`;
        material.colorNode = Fn(() => {
          // Unlit, the frosted glass shows the isotropic light of R1b's folded scenario probes at the lamp, read on the
          // GPU where the frame's prepare wrote it: no CPU work per apply (ruling E1).
          const around = bounceNode(u, reads, position, vec3(0, 0, 1), bool(true)).scenario;
          return vec4(displayNode(emitted.mul(float(1).sub(glowShare)).add(around.mul(BULB_GLASS_ALBEDO)), u.display, float(HIGHLIGHT_KNEE)), 1);
        })();
        // The glow's share goes to the composer's emission target (Task 13); without the composer it is not drawn.
        material.mrtNode = mrt({ emission: vec4(emitted.mul(glowShare), 1) });
        const mesh = new InstancedMesh(geometry, material, members.length);
        mesh.name = kind === "candle" ? `relight-bulbs-${group}` : `relight-bulbs-${group}-${kind}`;
        const matrix = new Matrix4();
        members.forEach((bulb, index) => {
          matrix.makeTranslation(bulb.position[0], bulb.position[1], bulb.position[2]);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.object.add(mesh);
        this.geometries.push(geometry);
        this.materials.push(material);
      }
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.clear();
  }
}
```

(Each lamp's intensity and model position are per-instance attributes bound by `instancedBufferAttribute` itself; each kind has its own envelope geometry, double-sided because the holder leaves its base open. The glass reads the fold with two read-only storage buffers in its fragment stage, well within WebGPU's default eight.)

- [ ] **Step 4: Mount them** — in `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { CrispBulbs } from "../../lib/relight/bulbs.js";` and `Matrix4` from `three`, replace the destructured line with `export function RelightCinematic({ frame, director, data, transform, onHooks }: RelightCinematicProps): ReactElement {`, and directly after the shadows' `useEffect` add:

```tsx
  const [bulbs, setBulbs] = useState<CrispBulbs | null>(null);
  useEffect(() => {
    if (frame === null || director === null || data === null || data.bulbs.length === 0) return;
    const created = measureRelight("relight:cinematic-parts", () => new CrispBulbs(frame, data));
    // Decision 1: the chandeliers' captured glow is hidden only while their crisp lamps are drawn.
    frame.setGlow(data.glow);
    setBulbs(created);
    return () => {
      frame.setGlow([]);
      created.dispose();
      setBulbs(null);
    };
  }, [frame, director, data]);
  const modelToTile = useMemo(() => (frame === null ? new Matrix4() : frame.tileToModel.clone().invert()), [frame]);
  // R3F types `rotation` as a mutable tuple, so the placement is destructured, as R1b's sky panels do (finding B10).
  const [px, py, pz] = transform.position;
  const [rx, ry, rz] = transform.rotation;
```

and in its return, directly after the opening `<group name="relight-cinematic">`, add:

```tsx
        {bulbs !== null && (
          <group position={[px, py, pz]} rotation={[rx, ry, rz]} scale={transform.scale} name="relight-cinematic-model">
            <primitive object={bulbs.object} matrix={modelToTile} matrixAutoUpdate={false} />
          </group>
        )}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/bulbs.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 3 tests.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/bulbs.ts src/components/scene/RelightCinematic.tsx`
Expected: no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/bulbs.ts packages/web/src/lib/relight/__tests__/bulbs.test.ts packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/__tests__/RelightCinematic.test.tsx && git diff --cached --stat && git commit -m "feat(relight): crisp frosted lamps (candles and crown tubes) at the triangulated bulbs, the chandeliers' captured glow hidden (T-639 R1d)

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
- Consumes: Task 12 (`NativeFrameComposer`, `registerNativeFrameComposer`), Task 11 (the bulbs' `emission` output, `BLOOM_SHARE`, `glowShare`), Task 9 (`LightDirector.setMeasurement`), Task 5 (`FrameMeasurement`); R1b's `RelightFrame.uniforms.display` (`exposure`, `whiteBalance`), `displayNode`, `HIGHLIGHT_KNEE`, `LUMINANCE`; three's `mrt`, `output`, `Node` (a fragment-depth node over the node builder's fragment coordinate), `perspectiveDepthToViewZ`, `cameraNear`, `cameraFar`, `BlendMode`, `QuadMesh`, `RenderTarget` (`count`), `Renderer.setMRT`/`getMRT`/`compute`/`getArrayBufferAsync`, `bloom` (`three/addons/tsl/display/BloomNode.js`), `gaussianBlur` (`three/addons/tsl/display/GaussianBlurNode.js`: `getTextureNode()`, `resolutionScale`, a vec2 direction scaling the horizontal and the vertical pass, normalised coefficients from `_getCoefficients`); the frontier light study's `evidence/d3_night_vision.json` `glare.pyramid` (σ, weights).
- Produces: `MEASURE_COLUMNS = 64`, `MEASURE_ROWS = 36`, `MEASURE_EVERY = 3`, `EXPECTED_DEPTH_FAR = 1000`, `GLARE_STRENGTH = 1 / 3`, `GLARE_RADIUS = 0.35`; `interface GlareSpread { node; setView(pixelsPerDegree); dispose() }`, `interface Glare { name: "design" | "cie"; share: number; spread(emission): GlareSpread }`; `type ViewListener = (camera: Camera, width: number, height: number) => void`; `designGlare: Glare` (the default, `BLOOM_SHARE`); `CIE_GLARE_PIXELS_PER_DEGREE = 11.25`, `CIE_GLARE_SIGMAS`, `CIE_GLARE_WEIGHTS`, `CIE_GLARE_SHARE`, `CIE_TAP_SIGMA = 2`, `blurCoefficients(sigma): number[]`, `passVariance(coefficients, step, offset): number`, `cieGlareSteps(pixelsPerDegree): [horizontal, vertical][]`, `cieGlare: Glare` (the frontier study's fit, `?glare=cie`), `glareFromSearch(search): Glare`, `pixelsPerDegree(camera, height): number`; `fragmentDepthSnippet(builder: object): string`, `class FragmentDepthNode extends Node<"float">`, `fragmentViewDepth: Node<"float">` (the fragment's linear view depth from its own window depth); `bloomWeightSum(radius: number): number`; `logAverage(samples: Float32Array): number`; `class CinematicComposer implements NativeFrameComposer` with `constructor(frame: RelightFrame, options?: { readonly glare?: Glare; readonly onMeasure?: (measurement: FrameMeasurement) => void; readonly now?: () => number })`, readonly `target: RenderTarget` (textures `output`, `emission`, `depth`), readonly `mrt: MRTNode`, `compose(renderer, scene, camera, draw, output?)`, `setAddition(node: Node<"vec3"> | null): void` (Task 14's shafts), `setViewListener(listener: ViewListener | null): void` (told the drawn view's camera and size before each composite, a capture's included), `dispose(): void`.
- Produces (mount): `RelightCinematic` registers the composer on the canvas's renderer and feeds its measurements to the director.

The main draw goes into a three-attachment half-float target (decision 6): `output` (each material's displayed colour, blended as the material blends), `emission` (the bulbs' and the Moon's glow share; every other fragment writes zero with its own alpha, so a splat in front of a bulb dims its glow exactly as it dims its colour) and `depth` (linear view depth, blended by straight alpha, so behind splats it is their expected depth; cleared to 1,000 m). The depth is the fragment's own window depth (the fragment-position builtin's z, WGSL `fragCoord.z`) turned into view depth: for a splat that is its centre's, because the splat material moves the quad's corners only in clip x and y (three 0.186 `GaussianSplat.js:1171`), whereas `positionView`, and three's `depth` node built from it (`ViewportDepthNode.js:97`), is the quad corner's (finding I5; a fix through `perspectiveDepthToViewZ(depth, …)` with three's `depth` node would carry the same corner depth). @types/three omits the builder's `getFragCoord`, so a type guard checks it at run time (no cast). The last two attachments blend by straight alpha whatever the material's own premultiplication (`BlendMode(NormalBlending)` per attachment; three's default for an MRT name without a blend mode is none). The glow is three's bloom pyramid at strength 1/3: its five levels are normalised blurs weighted 1, 0.8, 0.6, 0.4, 0.2 at radius 0 and `mix(f, 1.2 − f, radius)` otherwise, which sums to 3 at every radius, so strength 1/3 spreads exactly the emitted share and adds no light (energy conserving; the high-pass threshold is 0 with a 10⁻⁶ edge, so even a dimmed bulb glows). It is a design glow, not a model of the eye's scatter: the glare is one function of the emission (`glare`), and the frontier study's fit to the CIE disability glare function is the other (decision 6; `?glare=cie` at the preview, for Blake to judge): its eleven Gaussians (σ = 0.5·2ⁱ px at 11.25 px per degree, scaled to the drawn view's own pixels per degree) are built as a cascade of three's separable blurs, each level at half the size of the one before, its tap steps solved per axis, bilinear filtering's own spread counted, so each level's variance is the fit's on both axes (`cieGlareSteps`; a single step for both axes missed by up to 18% vertically at 16 px per degree, checked 8 October), summed by the fit's weights over their total and fed the fit's share of each emitter's light (0.632; `glowShare`), so it too moves light rather than adding it. The glow is built once, so the shafts' rebuilt composite reuses it. The composite is `output + displayNode(glow + addition)` with the output's alpha (the canvas is created with alpha: finding M7): the added light is shown with the same exposure, white balance and roll-off (knee 0.8) as every relit surface, and with nothing added it is the output exactly (the captured light's identity holds; the half-float target keeps 11 bits, far inside 1/20 of a stop). Before the composite the composer tells `setViewListener`'s listener the drawn view's camera and size, so the shafts (Task 14) march the view being drawn, a capture's included, never the walk's last frame (finding I6). A capture's glow is computed at the drawing buffer's resolution, because three's bloom sizes its pyramid there (`BloomNode.js:348-357`); the glow conserves energy in texture space, so a larger capture shows the same glow, only less finely sampled, and this is accepted (finding M13, cosmetic).

The eye's measurement (decision 4): every third composed canvas frame a compute pass samples the `output` attachment on a 64 × 36 grid, divides each pixel by the white balance and each luminance by the exposure in force (so the measurement is the scene's light, before the eye) and writes log2 of it; the display's roll-off stays in the measure, and since Task 21 measures the eye's anchors with this same pass, it is in both sides of the eye's correction and cancels (finding M7, ruling); one asynchronous read-back at a time returns the 2,304 values, and their mean (the log-average luminance, robust to the bulbs' highlights) goes to the director with the time its frame was drawn (not when the read-back lands, so a waiting driver can tell a fresh measurement from a stale one: finding I10). Captures measure nothing.

Verified (7 October): three 0.186 `src/renderers/common/Renderer.js:1298` (`setMRT`), `:1311` (`getMRT`), `:2097` (`getArrayBufferAsync`), `:2877` (`compute`); `src/nodes/core/MRTNode.js:60-81` (outputs; `blendModes` default `{ output: MaterialBlending }`), `:107` (`setBlendMode`), `:121-125` (`getBlendMode`: an unnamed output is `NoBlending`), `:135` (`setClearColor(name, color, alpha)`), `:202-226` (`setup` matches the target's textures by name), `:243` (`mrt`); `src/renderers/common/BlendMode.js:8` (`new BlendMode(blending = NormalBlending)`); `src/renderers/webgpu/utils/WebGPUPipelineUtils.js:140-170` (each attachment's own blend from the MRT); `src/core/RenderTarget.js:148` (`count`); `src/nodes/core/PropertyNode.js:332` (`output`); `src/renderers/common/QuadMesh.js:112-118` (`render(renderer)` renders through `renderer.render`); `src/renderers/webgpu/nodes/WGSLNodeBuilder.js:1637-1641` (`getFragCoord()`: the `position` builtin `fragCoord`, returned as `fragCoord.xy`), `src/nodes/display/ViewportDepthNode.js:97` (the `depth` node from `positionView.z`), `:227-239` (`perspectiveDepthToViewZ`, reversed depth handled), `examples/jsm/objects/GaussianSplat.js:1086,1169-1171` (`clip = centerClip + vec4(offsetNdc × w, 0, 0)`), `src/nodes/tsl/TSLCore.js:39` (TSL methods live on `Node.prototype`, so a subclass's instance chains), @types/three `src/nodes/core/Node.d.ts:402` (`generate(builder, output?)`) and `src/nodes/core/IndexNode.d.ts:11` (a typed subclass `extends Node<"uint">`); `packages/web/src/components/scene/NativeCanvas.tsx:118` (`alpha: true`); R1b plan lines 4943–4946 (`DisplayUniforms { exposure; whiteBalance }`); `examples/jsm/tsl/display/GaussianBlurNode.js:32` (constructor: texture, direction node, `sigma`, `resolutionScale`), `:151-158` (its targets sized by `resolutionScale` from its input), `:167` (`updateBefore` sizes from its input texture each frame), `:213` (`getTextureNode`), `:248-252` (`3 + 2σ` taps per side, offsets `direction × passDirection × invSize × i`), `:333-349` (coefficients normalised over both sides), `:393` (`gaussianBlur` takes a texture node as it is, 8 October); `examples/jsm/tsl/display/BloomNode.js:86,93,100,107` (`strength`, `radius`, `threshold`, `smoothWidth` uniforms), `:125` (half resolution), `:156` (5 mips), `:348-357` (`updateBefore` sizes to the drawing buffer), `:435-444` (factors 1, 0.8, 0.6, 0.4, 0.2 through `lerpBloomFactor`), `:579-597` (`lerpBloomFactor = mix(factor, 1.2 − factor, radius)`, `bloom` export); `package.json` `"./addons/*": "./examples/jsm/*"`; `@types/three/examples/jsm/tsl/display/BloomNode.d.ts`.

- [ ] **Step 1: Write the failing tests** — create `packages/web/src/lib/relight/__tests__/cinematic-composer.test.ts`:

```ts
import { MaterialBlending, NormalBlending, PerspectiveCamera, RenderTarget, Scene, Vector2, type Camera } from "three";
import { WebGPURenderer, type MRTNode } from "three/webgpu";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BLOOM_SHARE } from "../bulbs.js";
import {
  CIE_GLARE_PIXELS_PER_DEGREE, CIE_GLARE_SHARE, CIE_GLARE_SIGMAS, CIE_TAP_SIGMA, CinematicComposer, GLARE_STRENGTH, MEASURE_COLUMNS, MEASURE_ROWS,
  blurCoefficients, bloomWeightSum, cieGlare, cieGlareSteps, designGlare, fragmentDepthSnippet, glareFromSearch, logAverage, passVariance, pixelsPerDegree,
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

  it("offers the frontier study's fitted CIE glare as an option: its share, and each level's σ at the view's pixels per degree", () => {
    expect([designGlare.share, cieGlare.share]).toEqual([BLOOM_SHARE, CIE_GLARE_SHARE]);
    expect(CIE_GLARE_SHARE).toBeCloseTo(0.632, 3);
    const coefficients = blurCoefficients(CIE_TAP_SIGMA);
    expect(coefficients.reduce((sum, weight, k) => sum + (k === 0 ? weight : 2 * weight), 0)).toBeCloseTo(1, 12);
    expect([passVariance([1], 1, 0.3), passVariance([0.5, 0.25], 1, 0)].map((value) => Math.round(value * 1e12) / 1e12)).toEqual([0.21, 0.5]);
    for (const ppd of [CIE_GLARE_PIXELS_PER_DEGREE, 30]) {
      let horizontal = 0, vertical = 0;
      cieGlareSteps(ppd).forEach(([across, down], level) => {
        const source = level === 0 ? 1 : 2 ** (level - 1), size = 2 ** level;
        horizontal += level === 0 ? passVariance(coefficients, across, 0) : passVariance(coefficients, 2 * across, 0.5) * source * source;
        vertical += level === 0 ? passVariance(coefficients, down, 0) : 0.25 * source * source + passVariance(coefficients, down, 0) * size * size;
        const sigma = (CIE_GLARE_SIGMAS[level] ?? 0) * ppd / CIE_GLARE_PIXELS_PER_DEGREE;
        expect([Math.sqrt(horizontal) / sigma, Math.sqrt(vertical) / sigma].map((ratio) => Math.round(ratio * 1e6) / 1e6)).toEqual([1, 1]);
      });
    }
    expect(pixelsPerDegree(new PerspectiveCamera(60), 1080)).toBeCloseTo((540 / Math.tan(Math.PI / 6)) * (Math.PI / 180), 9);
    expect([glareFromSearch("?glare=cie"), glareFromSearch(""), glareFromSearch("?glare=other")]).toEqual([cieGlare, designGlare, designGlare]);
  });

  it("names its attachments and blends emission and depth by straight alpha, the output as the material does", () => {
    const composer = new CinematicComposer(new RelightFrame(data));
    expect(composer.target.textures.map((texture) => texture.name)).toEqual(["output", "emission", "depth"]);
    expect(composer.mrt.getBlendMode("output").blending).toBe(MaterialBlending);
    expect([composer.mrt.getBlendMode("emission").blending, composer.mrt.getBlendMode("depth").blending]).toEqual([NormalBlending, NormalBlending]);
    composer.dispose();
  });

  it("takes the expected depth from the fragment's own window depth, a splat's centre (finding I5)", () => {
    expect(fragmentDepthSnippet({ getFragCoord: () => "fragCoord.xy" })).toBe("fragCoord.z");
    expect(fragmentDepthSnippet({ getFragCoord: () => "gl_FragCoord.xy" })).toBe("gl_FragCoord.z");
    expect(() => fragmentDepthSnippet({})).toThrow(/fragment coordinate/u);
  });

  it("draws the main render into its MRT target and composes it to the canvas, telling the view first, restoring both", () => {
    const log: string[] = [];
    const views: { camera: Camera; width: number; height: number }[] = [];
    const composer = new CinematicComposer(new RelightFrame(data));
    composer.setViewListener((camera, width, height) => { views.push({ camera, width, height }); log.push("view"); });
    const camera = new PerspectiveCamera();
    composer.compose(fake(log), new Scene(), camera, () => { log.push("draw"); });
    expect(log).toEqual(["mrt", "mrt on", "draw", "mrt off", "view", "canvas", "composite", "canvas"]);
    expect(views).toHaveLength(1);
    expect(views[0]?.camera).toBe(camera);
    expect([views[0]?.width, views[0]?.height, composer.target.width, composer.target.height]).toEqual([320, 180, 320, 180]);
    composer.dispose();
  });

  it("composes a capture into the capture's own target, with the capture's camera and size, and measures nothing then", () => {
    const log: string[] = [];
    const onMeasure = vi.fn();
    const composer = new CinematicComposer(new RelightFrame(data), { onMeasure });
    const sizes: number[][] = [];
    composer.setViewListener((_camera, width, height) => { sizes.push([width, height]); });
    const capture = new RenderTarget(64, 32);
    for (let frame = 0; frame < 6; frame += 1) composer.compose(fake(log), new Scene(), new PerspectiveCamera(), () => undefined, capture);
    expect(log.filter((entry) => entry === "capture")).toHaveLength(6);
    expect(sizes[0]).toEqual([64, 32]);
    expect(log).not.toContain("measure");
    composer.dispose();
  });

  it("measures every third canvas frame, one read-back at a time, before the eye's exposure and white balance", async () => {
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
    // A holder, not a reassigned local: the lint follows a local's narrowing and would call the check below always true.
    const held: { gl: object | null } = { gl: null };
    function Gl(): null {
      held.gl = useThree((state) => state.gl);
      return null;
    }
    mounted = mountInStubRoot(<Cinematic frame={frame} director={director} data={cinematic()} transform={IDENTITY}><Gl /></Cinematic>, 1440, 900, renderer());
    await act(async () => { await Promise.resolve(); });
    const gl = held.gl;
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
import { Color, HalfFloatType, NormalBlending, PerspectiveCamera, RenderTarget, Vector2, Vector3, type Camera, type Object3D } from "three";
import { BlendMode, MeshBasicNodeMaterial, Node, QuadMesh, StorageBufferAttribute, type ComputeNode, type MRTNode, type NodeBuilder, type WebGPURenderer } from "three/webgpu";
import {
  Fn, If, Return, cameraFar, cameraNear, dot, float, instanceIndex, int, ivec2, log2, max, mrt, output, perspectiveDepthToViewZ,
  storage, texture, textureLoad, uint, uniform, vec3, vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import type { NativeFrameComposer } from "../native-renderer.js";
import { BLOOM_SHARE, glowShare } from "./bulbs.js";
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

/** A glare's glow of an emission, the drawn view it is sized for, and the render targets it holds. */
export interface GlareSpread {
  readonly node: Node<"vec4">;
  /** The drawn view's pixels per degree (the canvas's, or a capture's), set before each composite. */
  setView(pixelsPerDegree: number): void;
  dispose(): void;
}
/** How the emission is spread (decision 6): the share of each emitter's light it takes, and the spreading itself. */
export interface Glare {
  readonly name: "design" | "cie";
  readonly share: number;
  spread(emission: Node<"vec4">): GlareSpread;
}
export type ViewListener = (camera: Camera, width: number, height: number) => void;

/**
 * The frontier light study's fit of CIE 135/1-6:1999's glare spread at age 40 (§e d3, 8 October): eleven Gaussians of
 * σ = 0.5·2ⁱ px at 11.25 px per degree, reproducing its encircled energy within 0.8% of the total.
 */
export const CIE_GLARE_PIXELS_PER_DEGREE = 11.25;
export const CIE_GLARE_SIGMAS: readonly number[] = [0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
export const CIE_GLARE_WEIGHTS: readonly number[] = [
  0.21806844141280843, 0.15208708662897202, 0.0962986696155163, 0.048733774370684546, 0.030108892766608327, 0.01669265042196182,
  0.01255822222092342, 0.00898338695015865, 0.009135937813787059, 0, 0.039347685022988146,
];
/** The share of a point's light the fit spreads (its weights' sum; 0.514 of it leaves the point's own pixel). */
export const CIE_GLARE_SHARE = CIE_GLARE_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
/** three's GaussianBlurNode `sigma` for every level of the CIE glare: a 7-tap half kernel. */
export const CIE_TAP_SIGMA = 2;

/** The sum of three's bloom weights at a radius (BloomNode's lerpBloomFactor). */
export function bloomWeightSum(radius: number): number {
  return BLOOM_FACTORS.reduce((sum, factor) => sum + factor + (1.2 - 2 * factor) * radius, 0);
}

/** R1d's design glow, the default: three's pyramid at a third, no threshold, on the restrained 4% share (decision 6). */
export const designGlare: Glare = {
  name: "design",
  share: BLOOM_SHARE,
  spread: (emission) => {
    const node = bloom(emission, GLARE_STRENGTH, GLARE_RADIUS, 0);
    node.smoothWidth.value = 1e-6;
    return { node, setView: () => undefined, dispose: () => { node.dispose(); } };
  },
};

/** three's GaussianBlurNode coefficients at its `sigma` (its `_getCoefficients`): the centre first, normalised over both sides. */
export function blurCoefficients(sigma: number): number[] {
  const radius = 3 + 2 * sigma, spread = radius / 3;
  const weights = [1];
  let sum = 1;
  for (let i = 1; i < radius; i += 1) {
    const weight = Math.exp(-0.5 * i * i / (spread * spread));
    weights.push(weight);
    sum += 2 * weight;
  }
  return weights.map((weight) => weight / sum);
}

/**
 * The variance, in the sampled texture's texels squared, of one blur pass whose taps sit at `offset + k × step` texels
 * from a texel centre, each read with bilinear filtering (a tap a fraction f past a texel spreads f(1 − f) more).
 */
export function passVariance(coefficients: readonly number[], step: number, offset: number): number {
  let variance = 0;
  for (let k = 1 - coefficients.length; k < coefficients.length; k += 1) {
    const at = offset + k * step, fraction = at - Math.floor(at);
    variance += (coefficients[Math.abs(k)] ?? 0) * ((k * step) ** 2 + fraction * (1 - fraction));
  }
  return variance;
}

/** The step at which a growing pass variance reaches `wanted` (0 if it already does at 0), by bisection. */
function stepFor(variance: (step: number) => number, wanted: number): number {
  if (!(wanted > variance(0))) return 0;
  let low = 0, high = 1;
  while (variance(high) < wanted) high *= 2;
  for (let n = 0; n < 60; n += 1) {
    const middle = (low + high) / 2;
    if (variance(middle) < wanted) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * Each CIE level's tap steps, [horizontal, vertical] in its own texels, so the cascade gives every level the fit's σ on
 * both axes at a view's pixels per degree. Level 0 blurs the emission at full size. Each later level's horizontal pass
 * reads the level before at twice its own resolution (its centre between two texels: the 2 × 2 average) and its
 * vertical pass reads its own. Every tap is read with bilinear filtering, whose own spread `passVariance` counts, so the
 * variances add up to the fit's exactly in this model; the energy is exact, every pass's coefficients being normalised.
 */
export function cieGlareSteps(pixelsPerDegree: number): (readonly [number, number])[] {
  const coefficients = blurCoefficients(CIE_TAP_SIGMA), scale = pixelsPerDegree / CIE_GLARE_PIXELS_PER_DEGREE;
  let horizontal = 0, vertical = 0;
  return CIE_GLARE_SIGMAS.map((sigma, level) => {
    const target = (sigma * scale) ** 2, source = level === 0 ? 1 : 2 ** (level - 1), size = 2 ** level;
    const across = (step: number): number => (level === 0 ? passVariance(coefficients, step, 0) : passVariance(coefficients, 2 * step, 0.5) * source * source);
    const down = (step: number): number => (level === 0 ? passVariance(coefficients, step, 0) : 0.25 * source * source + passVariance(coefficients, step, 0) * size * size);
    const dx = stepFor(across, target - horizontal), dy = stepFor(down, target - vertical);
    horizontal += across(dx);
    vertical += down(dy);
    return [dx, dy] as const;
  });
}

/**
 * The frontier study's fitted CIE glare, an option for Blake to judge at the preview (`?glare=cie`): the eleven
 * Gaussians as a cascade of three's separable blurs, each level at half the previous one's size, summed by the fit's
 * weights over their total, on the fit's share of each emitter's light.
 */
export const cieGlare: Glare = {
  name: "cie",
  share: CIE_GLARE_SHARE,
  spread: (emission) => {
    // Each level's [horizontal, vertical] steps: GaussianBlurNode scales its horizontal pass by x and its vertical by y.
    const steps = CIE_GLARE_SIGMAS.map(() => uniform(new Vector2(1, 1)));
    const levels: ReturnType<typeof gaussianBlur>[] = [];
    steps.forEach((step, level) => {
      const previous = levels[level - 1];
      levels.push(gaussianBlur(previous === undefined ? emission : previous.getTextureNode(), step, CIE_TAP_SIGMA, { resolutionScale: level === 0 ? 1 : 0.5 }));
    });
    const node = levels.reduce<Node<"vec4">>((sum, level, index) => sum.add(level.mul((CIE_GLARE_WEIGHTS[index] ?? 0) / CIE_GLARE_SHARE)), vec4(0, 0, 0, 0));
    return {
      node,
      setView: (pixelsPerDegree) => {
        cieGlareSteps(pixelsPerDegree).forEach(([across, down], index) => {
          steps[index]?.value.set(across, down);
        });
      },
      dispose: () => { for (const level of levels) level.dispose(); },
    };
  },
};

/** `?glare=cie` shows the fitted CIE glare for Blake to judge at the preview; the design glow otherwise (decision 6). */
export function glareFromSearch(search: string): Glare {
  return new URLSearchParams(search).get("glare") === "cie" ? cieGlare : designGlare;
}

/** A drawn view's pixels per degree at its centre; a camera without a field of view keeps the fit's own scale. */
export function pixelsPerDegree(camera: Camera, height: number): number {
  if (!(camera instanceof PerspectiveCamera)) return CIE_GLARE_PIXELS_PER_DEGREE;
  return (height / 2 / Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) * (Math.PI / 180);
}

/** The mean of log2 samples: log2 of the geometric mean luminance. */
export function logAverage(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value;
  return samples.length === 0 ? 0 : sum / samples.length;
}

/** three 0.186's node builders give the fragment-position builtin's `.xy` (WGSLNodeBuilder.js:1637); its types omit it. */
interface FragCoordBuilder {
  getFragCoord(): string;
}
function hasFragCoord(builder: object): builder is FragCoordBuilder {
  return "getFragCoord" in builder && typeof builder.getFragCoord === "function";
}

/** The fragment's window depth in the shading language: the fragment-position builtin's z (WGSL `fragCoord.z`). */
export function fragmentDepthSnippet(builder: object): string {
  if (!hasFragCoord(builder)) throw new Error("This node builder has no fragment coordinate.");
  const coord: unknown = builder.getFragCoord();
  if (typeof coord !== "string" || !coord.endsWith(".xy")) throw new Error("Unexpected fragment coordinate.");
  return `${coord.slice(0, -3)}.z`;
}

/**
 * The fragment's own window depth, in [0, 1]. For a splat it is its centre's: the splat material offsets the quad only
 * in clip x and y (three 0.186 `examples/jsm/objects/GaussianSplat.js:1171`), whereas `positionView`, and three's
 * `depth` node built from it (`ViewportDepthNode.js:97`), is the quad corner's (finding I5).
 */
export class FragmentDepthNode extends Node<"float"> {
  constructor() {
    super("float");
  }

  override generate(builder: NodeBuilder): string {
    return fragmentDepthSnippet(builder);
  }
}

/** The fragment's linear view depth (metres in front of the camera) from its window depth; the walk's camera is perspective. */
export const fragmentViewDepth: Node<"float"> = perspectiveDepthToViewZ(new FragmentDepthNode(), cameraNear, cameraFar).negate();

export class CinematicComposer implements NativeFrameComposer {
  readonly target: RenderTarget;
  readonly mrt: MRTNode;
  private readonly frame: RelightFrame;
  private readonly onMeasure: ((measurement: FrameMeasurement) => void) | null;
  private readonly now: () => number;
  private readonly quad: QuadMesh;
  private readonly material: MeshBasicNodeMaterial;
  private additionNode: Node<"vec3"> | null = null;
  private viewListener: ViewListener | null = null;
  private readonly glare: Glare;
  /** The glow, built once for the session, so a rebuilt composite never leaks a bloom node's targets. */
  private readonly glow: GlareSpread;
  private readonly samples = new StorageBufferAttribute(new Float32Array(MEASURE_COUNT), 1);
  private readonly measureSize = uniform(new Vector2(1, 1));
  private readonly measureExposure = uniform(1);
  private readonly measureWhiteBalance = uniform(new Vector3(1, 1, 1));
  /** The eye's measuring pass (Task 22 times it on the GPU). */
  readonly measure: ComputeNode;
  private readonly size = new Vector2();
  private frames = 0;
  private reading = false;

  constructor(frame: RelightFrame, options: { readonly glare?: Glare; readonly onMeasure?: (measurement: FrameMeasurement) => void; readonly now?: () => number } = {}) {
    this.frame = frame;
    this.onMeasure = options.onMeasure ?? null;
    this.now = options.now ?? (() => performance.now());
    this.glare = options.glare ?? designGlare;
    // Every emitter moves this glare's share of its light into the emission target (bulbs.ts; one relit canvas).
    glowShare.value = this.glare.share;
    this.target = new RenderTarget(1, 1, { type: HalfFloatType, count: 3, depthBuffer: true });
    ["output", "emission", "depth"].forEach((name, index) => { const attachment = this.target.textures[index]; if (attachment !== undefined) attachment.name = name; });
    // Every fragment writes no glow with its own alpha, and its linear view depth; both blend by straight alpha.
    this.mrt = mrt({ output, emission: vec4(0, 0, 0, output.a), depth: vec4(fragmentViewDepth, 0, 0, output.a) });
    this.mrt.setBlendMode("emission", new BlendMode(NormalBlending));
    this.mrt.setBlendMode("depth", new BlendMode(NormalBlending));
    this.mrt.setClearColor("depth", new Color(EXPECTED_DEPTH_FAR, 0, 0), 0);
    this.glow = this.glare.spread(texture(this.target.textures[1]));
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
      // The scene's light, before the eye: the displayed colour over the white balance and the exposure in force. The
      // display's roll-off stays in; the anchors are measured by this same pass (Task 21), so it cancels in the eye.
      const rgb = textureLoad(frameTexture, ivec2(int(x), int(y))).rgb.div(this.measureWhiteBalance);
      write.element(i).assign(log2(max(dot(rgb, vec3(...LUMINANCE)).div(this.measureExposure), 1e-6)));
    })().compute(MEASURE_COUNT, [64]).setName("RelightEyeMeasure");
  }

  /** Light to add before the display (Task 14's shafts), in the relit surfaces' units; null for none. */
  setAddition(node: Node<"vec3"> | null): void {
    this.additionNode = node;
    this.material.colorNode = this.compositeNode();
    this.material.needsUpdate = true;
  }

  /** Told the drawn view's camera and size before each composite (Task 14's shafts), a capture's included (finding I6). */
  setViewListener(listener: ViewListener | null): void {
    this.viewListener = listener;
  }

  compose(renderer: WebGPURenderer, _scene: Object3D, camera: Camera, draw: () => void, outputTarget: RenderTarget | null = null): void {
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
    this.viewListener?.(camera, size.x, size.y);
    this.glow.setView(pixelsPerDegree(camera, size.y));
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
    this.glow.dispose();
    glowShare.value = BLOOM_SHARE;
  }

  private compositeNode(): Node<"vec4"> {
    const colour = texture(this.target.textures[0]);
    // Built once in the constructor: a composite rebuilt for the shafts reuses it (no bloom targets leak).
    const glow = this.glow.node.rgb;
    const added = this.additionNode === null ? glow : glow.add(this.additionNode);
    // Added light goes through the same display (exposure, white balance, roll-off from 0.8); nothing added is the
    // output exactly, its alpha included (the canvas is created with alpha, finding M7).
    return vec4(colour.rgb.add(displayNode(added, this.frame.uniforms.display, float(HIGHLIGHT_KNEE))), colour.a);
  }

  private measureFrame(renderer: WebGPURenderer, size: Vector2): void {
    // Stamped with the time its frame was drawn, not when the read-back lands (finding I10).
    const at = this.now();
    this.measureSize.value.set(size.x, size.y);
    this.measureExposure.value = this.frame.uniforms.display.exposure.value;
    this.measureWhiteBalance.value.copy(this.frame.uniforms.display.whiteBalance.value);
    void renderer.compute(this.measure);
    this.reading = true;
    void renderer.getArrayBufferAsync(this.samples).then((buffer) => {
      this.reading = false;
      this.onMeasure?.({ logLuminance: logAverage(new Float32Array(buffer)), at });
    }, () => { this.reading = false; });
  }
}
```

- [ ] **Step 4: Mount it** — in `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { CinematicComposer, glareFromSearch } from "../../lib/relight/cinematic-composer.js";` and `import { registerNativeFrameComposer } from "../../lib/native-renderer.js";`, and directly after the bulbs' effect add:

```tsx
  // Task 14's shafts read the composer; until then it is written only (`noUnusedLocals` refuses an unread binding).
  const [, setComposer] = useState<CinematicComposer | null>(null);
  useEffect(() => {
    if (frame === null || director === null || data === null || !isShadowRenderer(gl)) return;
    // `?glare=cie` shows the fitted CIE glare for Blake to judge; the design glow otherwise (this mount is preview-only).
    const created = measureRelight("relight:cinematic-parts", () => new CinematicComposer(frame, { glare: glareFromSearch(window.location.search), onMeasure: (measurement) => { director.setMeasurement(measurement); } }));
    const release = registerNativeFrameComposer(gl, created);
    setComposer(created);
    return () => {
      release();
      created.dispose();
      setComposer(null);
    };
  }, [frame, director, data, gl]);
```

(Task 14 names the state `composer` when its shafts read it.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/cinematic-composer.test.ts`
Expected: PASS, 7 tests.

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
- Consumes: Task 13 (`CinematicComposer.target` `depth` attachment, `setAddition`, `setViewListener`), Task 10 (`SkyShadows.hook`), Task 8's span `relight:cinematic-parts`, Task 7/A5 (`sunVisibilityNode`, `skyBody`, `windowVolumeRead`, the frame's `sunRgb`/`moonRgb`/`sunOn`/`moonOn`/`sunDir`/`moonDir` uniforms); three's `Storage3DTexture`, `textureStore`, `texture3D`, `mx_noise_float`; `prefersReducedMotion`.
- Produces: `AIR_VOXEL = 0.2`, `SHAFT_STEPS = 32`, `AIR_SCATTERING = 0.012`, `SHAFT_ANISOTROPY = 0.6`, `DUST_CONTRAST = 0.35`, `DUST_FREQUENCY = 1.6`, `DUST_DRIFT = 0.03`; `airVolumeShape(box: readonly [Vec3, Vec3], voxel: number): readonly [number, number, number]`; `henyeyGreenstein(cosine: number, g: number): number`; `interleavedGradientNoise(x: number, y: number): number`; `class SunShafts` with `constructor(frame: RelightFrame, box: readonly [Vec3, Vec3], interior: InteriorShadowHook, sceneToModel: Matrix4)`, `fillAir(renderer: Pick<WebGPURenderer, "compute">): void` (after each apply), `node(depth: Node<"float">): Node<"vec3">` (the in-scattered light for the composite; its march runs only while a body is in), `setCamera(camera: Camera, width: number, height: number): void` (the drawn view, from the composer's view listener), `tick(seconds: number, reducedMotion: boolean): void`, readonly `active: boolean`, `dispose(): void`.

Shafts are the light the air scatters toward the eye from the Sun's and the Moon's beams through the windows (spec §4.4, "sun shafts with faint dust"; the owner's requirement puts the Moon through them too). The air's visibility of each body is computed once per light change into a 20 cm volume over the hall (about 90 × 50 × 35 cells in the Grand Hall; `Storage3DTexture`'s default rgba8unorm, which a visibility in [0, 1] needs and which can be both stored and filtered; red the Sun, green the Moon: finding M2), each cell marching the same window volumes, gates and glass as the splats and multiplying by the interior shadow (Tasks 7, 10), so a shaft is exactly where the floor's sunlit patch and the chandeliers' shadows say it is. Each pixel's view ray is then marched to the frame's expected depth (the composer's `depth` attachment, so a splat wall stops it) in 32 steps with interleaved gradient noise (Jimenez 2014) jittering the start, reading the volume trilinearly. The in-scattered light is `π Σ body RGB × V × σ_s × p_HG(cos θ) × Δt` in the relit surfaces' units (a matte surface's displayed value is π times its radiance), with single scattering, σ_s = 0.012 m⁻¹ (faint: about 6% of a metre-long beam's light, a design value) and a Henyey–Greenstein phase with g = 0.6 (forward scattering, so shafts read strongest looking toward the windows). Dust is a slow 3D noise modulating σ_s by ±35% at about 60 cm features, drifting 3 cm a second; under reduced motion it stands still. With no body in, nothing is marched: the air is not filled, and the composite skips the view-ray march by a branch on a uniform the fill sets (finding I17: before, every pixel marched 32 noisy steps all night to add nothing). The march takes the camera of the view being drawn from the composer (`setViewListener`), so a capture's shafts are its own view's, never the walk's last frame (finding I6).

Verified (7 October; re-read 8 October): three 0.186 `src/renderers/common/Storage3DTexture.js:22-73` (`new Storage3DTexture(width, height, depth)`, linear filters; `Texture`'s default `RGBAFormat` and `UnsignedByteType`, `src/textures/Texture.js:48`), `src/nodes/accessors/StorageTextureNode.js:313` (`textureStore(value, uvNode, storeNode)`), `src/nodes/accessors/Texture3DNode.js:171` (`texture3D`), `src/nodes/materialx/MaterialXNodes.js:66` (`mx_noise_float`), `src/nodes/display/ScreenNode.js:198` (`screenUV`); amendment A5 (`sunVisibilityNode(u, volumes, p, body)`, `skyBody`); R1b plan Task 10 (`windowVolumeRead(frame.windowVolumes)`, one binding per pass), Task 15 (`RelightSkyPanels`: the model-to-scene placement).

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
    expect(shafts.node(float(5))).not.toBeNull();
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
  Fn, If, Loop, Return, dot, exp, float, fract, instanceIndex, max, mx_noise_float, normalize, pow, screenUV, select,
  texture3D, textureStore, uint, uniform, uvec3, vec2, vec3, vec4,
} from "three/tsl";
import type { Vec3 } from "./relight-codec.js";
import { skyBody, sunVisibilityNode, windowVolumeRead, type InteriorShadowHook, type RelightFrame } from "./relight-frame.js";

/**
 * Sun and Moon shafts with faint dust (T-639 R1d, spec §4.4): the air's visibility of each body, once per light
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
  /** The air's visibility pass, run once per light change (Task 22 times it on the GPU). */
  readonly fill: ComputeNode;
  private readonly lo = uniform(new Vector3());
  private readonly extent = uniform(new Vector3());
  private readonly inverseProjection = uniform(new Matrix4());
  private readonly cameraWorld = uniform(new Matrix4());
  private readonly sceneToModel = uniform(new Matrix4());
  private readonly time = uniform(0);
  private readonly resolution = uniform(new Vector2(1, 1));
  /** 1 while a body is in: the composite's march runs only then (finding I17). */
  private readonly marching = uniform(0);
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
      textureStore(this.air, uvec3(x, y, z), vec4(sun, moon, 0, 1));
    })().compute(count, [64]).setName("RelightAirVisibility");
  }

  get active(): boolean {
    return this.activeValue;
  }

  /** After each apply: the air's view of each body, or nothing while neither is in. */
  fillAir(renderer: Pick<WebGPURenderer, "compute">): void {
    const u = this.frame.uniforms;
    this.activeValue = u.sunOn.value > 0.5 || u.moonOn.value > 0.5;
    this.marching.value = this.activeValue ? 1 : 0;
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
      // A uniform branch: with neither body in, no pixel marches.
      If(this.marching.greaterThan(0.5), () => {
        Loop(SHAFT_STEPS, ({ i }) => {
          const t = float(i).add(jitter).mul(step);
          const p = origin.add(direction.mul(t));
          const visibility = texture3D(this.air, p.sub(this.lo).div(this.extent)).rg;
          const dust = float(1).add(mx_noise_float(p.mul(DUST_FREQUENCY).add(vec3(this.time.mul(DUST_DRIFT), 0, this.time.mul(DUST_DRIFT * 0.4)))).mul(DUST_CONTRAST));
          const scattering = float(AIR_SCATTERING).mul(dust).mul(exp(t.mul(-AIR_SCATTERING)));
          light.addAssign(u.sunRgb.mul(visibility.x.mul(sunPhase)).add(u.moonRgb.mul(visibility.y.mul(moonPhase))).mul(scattering.mul(step)));
        });
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

- [ ] **Step 4: Mount them** — in `packages/web/src/components/scene/RelightCinematic.tsx`, add `import { SunShafts } from "../../lib/relight/sun-shafts.js";`, `import { prefersReducedMotion } from "../../lib/reduced-motion.js";`, `import { texture } from "three/tsl";`, and `useFrame` from `@react-three/fiber`; replace Task 13's two lines

```tsx
  // Task 14's shafts read the composer; until then it is written only (`noUnusedLocals` refuses an unread binding).
  const [, setComposer] = useState<CinematicComposer | null>(null);
```

with `  const [composer, setComposer] = useState<CinematicComposer | null>(null);`, and directly after the composer's effect add:

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
    const created = measureRelight("relight:cinematic-parts", () => new SunShafts(frame, box, shadows.hook, sceneToModel));
    created.fillAir(gl);
    const stop = frame.onApply(() => { created.fillAir(gl); });
    composer.setAddition(created.node(texture(composer.target.textures[2] ?? composer.target.texture).x));
    // The march follows the view being drawn, a capture's included (finding I6).
    composer.setViewListener((camera, width, height) => { created.setCamera(camera, width, height); });
    setShafts(created);
    return () => {
      stop();
      composer.setViewListener(null);
      composer.setAddition(null);
      created.dispose();
      setShafts(null);
    };
  }, [frame, composer, shadows, data, gl, sceneToModel]);
  useFrame((_state, delta) => {
    shafts?.tick(delta, prefersReducedMotion());
  });
```

(`Euler`, `Quaternion`, `Vector3` join `Matrix4` in the `three` import.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sun-shafts.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/scene/__tests__/RelightCinematic.test.tsx`
Expected: PASS, 4 tests (the test's `renderer()` mocks `compute`, Task 10).

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/sun-shafts.ts src/components/scene/RelightCinematic.tsx`
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
- Modify: `packages/web/src/lib/relight/sky-panels.ts` (a window index per vertex), `packages/web/src/components/scene/RelightCinematic.tsx`, `packages/web/src/components/scene/RelightProvider.tsx`, `packages/web/src/components/scene/cinematic-light.ts`
- Test: `packages/web/src/lib/relight/__tests__/window-view.test.ts` (create), `packages/web/src/lib/relight/__tests__/sky-panels.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`LuminanceCalibration`, `CAPTURE_CALIBRATION`), Task 6 (`SkyLight`, `cityLevel`), Task 8 (`CinematicData.windowRadiance`), Task 9 (`DisplayedLight`, `LightDirector.onDisplayed`, `DirectorCinematic.city`), Task 11 (`glowShare`), Task 13 (the emission target); R1b Task 6's `lib/moon.ts` (amendment A3 as applied: `MOON_ANGULAR_RADIUS`, `MOON_CCT`, `MoonPosition`); R1b's `WindowModel` (`frame.x0`, `x1`, `sill`, `top`, `y0`, `xBearing`, `horizon`), `sunAzimuthElevation`, `horizonAt`, `sunDirection`, `cctShift`, `skyPanelWindows`, `skyPanelGeometry`, `displayNode`, `HIGHLIGHT_KNEE`, `LUMINANCE`, `measureRelight`; Task 9's `cinematic-light.ts`; three's `attribute`, `positionLocal`, `cameraPosition` (updated on every render), `textureLoad`, `DataTexture`.
- Produces (`window-view.ts`): `FACADE_AZIMUTH = 284.3`, `FACADE_ALBEDO = 0.3`, `FACADE_SKY_VIEW = 0.24`, `FRONT_SUN_FACADE_SKY = 0.25`, `FACADE_ROOFLINE` (`[[200, 8.2], [255, 10.35], [292, 13.7]]`), `CITY_FACADE_LUMINANCE = 1`, `SKYGLOW_LUMINANCE = 0.006`, `CITY_CCT = 3830`, `VIEW_POINT_DISTANCE = 2`, `VIEW_POINT_HEIGHT = 1.6`, `EARTHSHINE = 3e-4`; `facadeRoofline(azimuth: number): number`; `facadeSunCosine(position: SolarPosition): number` (0 unless the body lights the facade); `facadeSkyFactor(sun: { azimuth; elevation } | null): number` (the facade's share of a uniform sky's light: 1, down to `FRONT_SUN_FACADE_SKY` with the Sun high in front of the windows); `windowSkyFraction(window: WindowModel, cells?: number): number`; `cityColour(daylight: Rgb): Rgb` (luminance 1); `cityWindowWeights(windows: readonly WindowModel[], windowRadiance: readonly number[], skyFractions: readonly number[], calibration: LuminanceCalibration, daylight: Rgb): Rgb[]`; `moonDiscRadiance(moon: MoonPosition, calibration: LuminanceCalibration): number` (the lit part's radiance, frame units); `interface WindowView { readonly sky: readonly Rgb[]; readonly facade: readonly Rgb[]; readonly moonDisc: Rgb; readonly moonDir: Vec3; readonly sunDir: Vec3; readonly moonUp: boolean }`; `interface WindowViewModel { view(light: SkyLight, captured: boolean): WindowView }` (the R2 and frontier hook); `class ClearSkyWindowView implements WindowViewModel` with `constructor(inputs: LightInputs, windows: readonly WindowModel[], windowRadiance: readonly number[], calibration: LuminanceCalibration)`, readonly `skyFractions: readonly number[]`; `class WindowViewPanels` with `constructor(frame: RelightFrame)`, readonly `material`, readonly `geometry`, `show(view: WindowView): void`, `setPlacement(sceneToModel: Matrix4): void` (the eye is three's `cameraPosition` of the view being drawn, taken to the model frame in the shader), `dispose(): void`.
- Produces (mount): `RelightWindowView({ frame, director, data, transform })` replaces R1b's sky panels while the cinematic package is in use (the provider draws R1b's panels otherwise); the provider gives the director the city's light (`cityWindowWeights` and `windowSkyFraction`, which `cinematic-light.ts` exports, so the provider still imports none of the cinematic light: finding B15).

Decision 9. Each window shows what stands beyond it: below that window's measured horizon (R1a's per-window table, the same that gates the Sun) the facade across Glassford Street, above it the sky, and the Moon's disc only where the Moon stands above the facade's roofline. The panel's values come from the light the room actually receives through that window, so the view and the light agree: the window's mean radiance is its weight times the package's window radiance (Task 3; a matte surface's displayed value is π times its radiance), split between the sky and the facade by the window's sky fraction (the share of its view above the horizon, from 2 m inside at eye height, by solid angle; the capture-lighting audit measured 0.17–0.45) and a facade model: a Lambertian sandstone wall facing 284.3° (albedo 0.3), lit by its share of the sky (0.24 of it: the sky above 25° in its front half, the frontier study's d2 geometry; and with the Sun high in front of the windows only a quarter of that, because the facade then faces the dim anti-solar sky: d2 measured the facade at 0.018 of the windows' 35–55° band at the capture's Sun, where a uniform sky gives 0.3 × 0.24 = 0.072; a shape fitted to that one scene, its twilight scenes reading 0.09–0.10), by the Sun or the Moon once either clears the hall's roof as seen from the facade (the audit's sunlit hours give the roofline, about 8° at azimuth 200° to 14° at 292°), and by street lighting at night (about 1 cd/m², the frontier study's §b3 assumption; the evening Matterport stations can measure it). If a model term would exceed the window's measured light, the sky takes none and the facade keeps the window's mean. The facade is lit by each body slot's own direction and colour, so during a cross-fade (Task 9's two slots) the light on it is the light the room receives (finding M3). The sky's gentle brightening toward its horizon (×1.1 there to ×0.9 forty degrees up, centred on ×1) is a design choice: it moves the drawn sky's mean by a few per cent from the admitted light, within the 10% the gradient spans (finding M3, accepted). The city's light also enters the room (Task 6's `extras.city`): each window's mean at full night is the facade's street light over the facade's share of the view plus the skyglow (6 mcd/m²) over the sky's, in the frame's units through the calibration (with the measured k_abs, 121.8, its weight against the lamps is 2.26 times lower than the withdrawn 54 gave), coloured as the study measured the street-lit facade, about 3,830 K (Planckian: below the daylight locus's 4,000 K); it fades in through dusk with `cityLevel`. The Moon's disc takes the Moon's colour at its elevation (Task 6's `moonBeamShift`).

The Moon's disc is drawn at its true angular radius and phase: on the visible hemisphere, a point is lit where its normal faces the Sun (the Sun's direction from the Moon is the Sun's from the Earth to 0.15°), softened over ±0.03 and lifted by a faint earthshine (3 × 10⁻⁴ of full). Its lit part's radiance is the Moon's illuminance over the lit part's solid angle (about 4,000 cd/m² at full; Krisciunas & Schaefer's illuminance already falls with the phase, so dividing by the whole disc would count the phase twice, finding I7), through the calibration; the bloom's share of it goes to the emission target, so the Moon glows in the night exactly as the bulbs do. The sky's own values are flat in colour with a gentle brightening toward its horizon. All of it is behind one interface (`WindowViewModel`): R2's sky from the weather and the frontier study's spectral sky-view and facade bands replace `ClearSkyWindowView` without touching the panels. The panels find the eye with three's `cameraPosition`, which three sets for every render, so a capture shows its own view through the windows, not the walk's last frame (finding I6).

Verified (7 October; R1b's lines re-read on 8 October): R1b plan lines 2134 (`WindowFrame`: `x0`, `x1`, `depth`, `sill`, `top`, `y0`, `xBearing`; the room is y > y0), 2215 (`WindowModel.horizon`, 360 entries), 2258–2263 (`sunAzimuthElevation(dir, xBearing)`: compass azimuth `xBearing − atan2(dy, dx)`, elevation `asin(dz)`), 2266 (`horizonAt`), 4230–4235 (`SolarPosition { azimuth; elevation }`), 4498–4505 (`MoonPosition`: `illuminatedFraction`, `illuminance`), 9268–9301 (`skyPanelWindows`, `skyPanelGeometry`: four vertices per window, `uv.y` 0 at the sill), 9314–9327 (`RelightSkyPanels` placement: `const [px, py, pz] = transform.position; const [rx, ry, rz] = transform.rotation;`), 9469 (the provider's `RelightSkyPanels` line), 5471 (`cctShift`); three 0.186 `src/nodes/accessors/Camera.js` (`cameraPosition`, a uniform three updates for every render's camera); the repo's `eslint.config.js` (`eqeqeq: ["error", "always"]`, so `== null` is refused: finding B6); `D:/claude/splat-quality-20260923/capture-lighting-audit/out/view_sky_fraction.json` (W1 0.39, W2 0.27, W3 0.174, W4 0.393, W5 0.447); `D:/claude/splat-quality-20260923/weather-daylight/opposite_facade.json` (the facade's sunlit hours: 21 March 13:30–17:10, 21 June 14:10–20:00, 21 September 14:20–18:00, 21 December 13:40–13:50) and the Sun's positions at those ends by the proof's NOAA algorithm (azimuth 199.7°/32.9° and 254.7°/10.6° in March; 291.7°/13.7° at the June end; 199.6°/8.7° to 201.9°/8.2° in December); `D:/claude/real-hall/frontier/light/proposal.md` §b3 (the facade fills 55–83% of each view; street-lit facade about 1 cd/m²; skyglow 6 mcd/m²), §f (LED about 4,000 K; its §e d2 of 8 October measured the street-lit facade at about 3,830 K, `CITY_CCT`); three 0.186 `src/nodes/core/AttributeNode.js` (`attribute(name, type)`), `src/nodes/accessors/Position.js` (`positionLocal`), `src/nodes/accessors/TextureNode.js:1034` (`textureLoad`).

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
  CITY_FACADE_LUMINANCE, ClearSkyWindowView, FACADE_ALBEDO, FACADE_SKY_VIEW, FRONT_SUN_FACADE_SKY, SKYGLOW_LUMINANCE, cityColour,
  cityWindowWeights, facadeRoofline, facadeSkyFactor, facadeSunCosine, moonDiscRadiance, windowSkyFraction,
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
    expect([facadeRoofline(150), facadeRoofline(200), facadeRoofline(292), facadeRoofline(320)]).toEqual([8.2, 8.2, 13.7, 13.7]);
    // Interpolated: 8.2 + 2.15 × 27.5 / 55 is 9.274999999999999 in binary64 (finding B3).
    expect(facadeRoofline(227.5)).toBeCloseTo(9.275, 12);
    expect(facadeSunCosine({ azimuth: 250, elevation: 20 })).toBeGreaterThan(0);
    expect(facadeSunCosine({ azimuth: 250, elevation: 8 })).toBe(0);
    expect(facadeSunCosine({ azimuth: 100, elevation: 40 })).toBe(0);
  });

  it("dims the facade's sky with the Sun high in front of the windows, as the frontier study measured (d2)", () => {
    expect(FACADE_ALBEDO * FACADE_SKY_VIEW * facadeSkyFactor({ azimuth: 121.08, elevation: 44.53 })).toBeCloseTo(0.018, 12);
    expect(facadeSkyFactor({ azimuth: 121.08, elevation: 44.53 })).toBe(FRONT_SUN_FACADE_SKY);
    expect([facadeSkyFactor(null), facadeSkyFactor({ azimuth: 250, elevation: 30 }), facadeSkyFactor({ azimuth: 121, elevation: -2 })]).toEqual([1, 1, 1]);
    expect(facadeSkyFactor({ azimuth: 121, elevation: 5 })).toBeCloseTo(1 - (1 - FRONT_SUN_FACADE_SKY) / 2, 12);
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

  it("brings the street-lit facade and the skyglow into the room at night, as the measured 3,830 K light", () => {
    const frame = new RelightFrame(data);
    const radiance = [1, 2, 3, 4, 5], fractions = [0.4, 0.3, 0.2, 0.4, 0.45];
    const weights = cityWindowWeights(frame.model.windows, radiance, fractions, CAPTURE_CALIBRATION, frame.inputs.daylightColour);
    const colour = cityColour(frame.inputs.daylightColour);
    expect(luminance(colour)).toBeCloseTo(1, 12);
    const expected = ((1 - 0.3) * CITY_FACADE_LUMINANCE + 0.3 * SKYGLOW_LUMINANCE) / CAPTURE_CALIBRATION.cdPerUnit / (Math.PI * 2);
    expect(luminance(weights[1] ?? [0, 0, 0])).toBeCloseTo(expected, 12);
  });

  it("shines the Moon's lit part with its illuminance over the lit part's solid angle, counting the phase once", () => {
    const omega = Math.PI * (MOON_ANGULAR_RADIUS * Math.PI / 180) ** 2;
    const full = { azimuth: 139, elevation: 32, distanceKm: 384400, phaseAngle: 0, illuminatedFraction: 1, illuminance: 0.25 };
    expect(moonDiscRadiance(full, CAPTURE_CALIBRATION)).toBeCloseTo(0.25 / omega / CAPTURE_CALIBRATION.cdPerUnit, 9);
    const half = { ...full, phaseAngle: 90, illuminatedFraction: 0.5, illuminance: 0.02 };
    expect(moonDiscRadiance(half, CAPTURE_CALIBRATION)).toBeCloseTo(0.02 / (omega * 0.5) / CAPTURE_CALIBRATION.cdPerUnit, 9);
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
import { DataTexture, DoubleSide, FloatType, Matrix4, NearestFilter, RedFormat, Vector3 } from "three";
import { MeshBasicNodeMaterial, type BufferGeometry } from "three/webgpu";
import {
  asin, atan, attribute, cameraPosition, clamp, cross, dot, float, floor, int, ivec2, max, min, mix, mod, mrt, normalize, positionLocal,
  select, smoothstep, sqrt, textureLoad, uniform, uniformArray, vec3, vec4,
} from "three/tsl";
import { cityLevel, type LightInputs, type SkyLight } from "../light-setting.js";
import { MOON_ANGULAR_RADIUS, type MoonPosition } from "../moon.js";
import { sunDirection, type SolarPosition } from "../sun.js";
import { glowShare } from "./bulbs.js";
import { HIGHLIGHT_KNEE, displayNode } from "./display.js";
import type { LuminanceCalibration } from "./eye.js";
import type { Vec3 } from "./relight-codec.js";
import type { RelightFrame } from "./relight-frame.js";
import { LUMINANCE, horizonAt, sunAzimuthElevation, type Rgb, type WindowModel } from "./relight-kernel.js";
import { moonBeamShift, planckShift } from "./sky-colour.js";
import { skyPanelGeometry, skyPanelWindows } from "./sky-panels.js";

/**
 * What the windows show (T-639 R1d, decision 9): the facade across Glassford Street below each window's measured
 * horizon, the sky above it, the Moon's disc at its phase where it stands above the facade, all scaled to the light
 * the room receives through that window; and the city's light that enters at night.
 */
export const FACADE_AZIMUTH = 284.3;
export const FACADE_ALBEDO = 0.3;
/** The facade's view of the sky: the sky above 25° in its front half (the frontier light study's d2 geometry, 8 October). */
export const FACADE_SKY_VIEW = 0.24;
/**
 * With the Sun high in front of the windows the facade, facing them across the street, sees only the dim anti-solar sky:
 * d2 measured it at 0.018 of the windows' 35–55° band at the capture's Sun (121°, 44.5°), a quarter of a uniform sky's
 * 0.072 (albedo 0.3 × view 0.24). A shape fitted to that one scene; d2's sunset and blue hour read 0.09–0.10.
 */
export const FRONT_SUN_FACADE_SKY = 0.25;
/** [compass azimuth, elevation]: the Sun must stand above this to light the facade over the hall's roof. */
export const FACADE_ROOFLINE: readonly (readonly [number, number])[] = [[200, 8.2], [255, 10.35], [292, 13.7]];
/** The street-lit facade at night, cd/m² (assumed; the evening stations can measure it). */
export const CITY_FACADE_LUMINANCE = 1;
export const SKYGLOW_LUMINANCE = 0.006;
/** The street-lit facade's colour: warm sandstone under 4,000 K LEDs (the frontier light study's d2, 8 October). */
export const CITY_CCT = 3830;
export const VIEW_POINT_DISTANCE = 2;
export const VIEW_POINT_HEIGHT = 1.6;
export const EARTHSHINE = 3e-4;
/** Below this lit fraction the disc is a hair of light (a new Moon's illuminance is near zero anyway). */
const MIN_LIT_FRACTION = 1e-3;
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

/**
 * The facade's share of a uniform sky's light with the Sun where it is: 1 with the Sun behind the hall, below the horizon
 * or absent; FRONT_SUN_FACADE_SKY with it 10° or more up and within 60° of the windows' facing, by linear ramps between.
 */
export function facadeSkyFactor(sun: { readonly azimuth: number; readonly elevation: number } | null): number {
  if (sun === null) return 1;
  const off = Math.abs((((sun.azimuth - (FACADE_AZIMUTH - 180)) % 360) + 540) % 360 - 180);
  const front = Math.min(Math.max((90 - off) / 30, 0), 1) * Math.min(Math.max(sun.elevation / 10, 0), 1);
  return 1 - (1 - FRONT_SUN_FACADE_SKY) * front;
}

/** The share of a window's view above its horizon from 2 m inside at eye height, by solid angle (each cell's cos θ / r²). */
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

/** The street-lit facade's colour in the frame's terms (CITY_CCT, Planckian: below the daylight locus), luminance 1. */
export function cityColour(daylight: Rgb): Rgb {
  const shift = planckShift(CITY_CCT);
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

/**
 * The lit part of the Moon's disc in the frame's units: its illuminance over the lit part's solid angle, through the
 * calibration. The illuminance already falls with the phase (Krisciunas & Schaefer), so dividing by the whole disc would
 * count the phase twice (finding I7); the earthshine is a separate, faint term in the panels.
 */
export function moonDiscRadiance(moon: MoonPosition, calibration: LuminanceCalibration): number {
  const omega = Math.PI * (MOON_ANGULAR_RADIUS * RAD) ** 2;
  return calibration.cdPerUnit > 0 ? moon.illuminance / (omega * Math.max(moon.illuminatedFraction, MIN_LIT_FRACTION)) / calibration.cdPerUnit : 0;
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
  private readonly cityLight: readonly Rgb[];
  private readonly xBearing: number;

  constructor(inputs: LightInputs, windows: readonly WindowModel[], windowRadiance: readonly number[], calibration: LuminanceCalibration) {
    this.inputs = inputs;
    this.xBearing = windows[0]?.frame.xBearing ?? 0;
    this.windowRadiance = windowRadiance;
    this.calibration = calibration;
    this.skyFractions = windows.map((window) => windowSkyFraction(window));
    const street = cityColour(inputs.daylightColour);
    this.cityLight = windows.map(() => times(street, CITY_FACADE_LUMINANCE / Math.max(calibration.cdPerUnit, 1e-12)));
  }

  view(light: SkyLight, captured: boolean): WindowView {
    const { setting, sun, moon } = light;
    // Each body slot by its own direction and colour: in a cross-fade the second slot may carry the rising Sun (finding M3).
    const onFacade = (direction: Vec3 | null, rgb: Rgb): Rgb =>
      (captured || direction === null ? [0, 0, 0] : times(rgb, facadeSunCosine(sunAzimuthElevation(direction, this.xBearing))));
    const sunOnFacade = onFacade(setting.sunDir, setting.sunRgb);
    const moonOnFacade = onFacade(setting.moonDir, setting.moonRgb);
    const city = captured ? 0 : cityLevel(sun.elevation);
    // The facade's share of the sky's light, less with the Sun high in front of the windows (the first slot's body).
    const facadeSky = FACADE_ALBEDO * FACADE_SKY_VIEW * facadeSkyFactor(captured || setting.sunDir === null ? null : sunAzimuthElevation(setting.sunDir, this.xBearing));
    const sky: Rgb[] = [], facade: Rgb[] = [];
    for (let k = 0; k < WINDOWS; k += 1) {
      const f = this.skyFractions[k] ?? 0;
      const mean = times(setting.weights[k] ?? [0, 0, 0], Math.PI * (this.windowRadiance[k] ?? 0));
      const direct = plus(times(plus(sunOnFacade, moonOnFacade), FACADE_ALBEDO), times(this.cityLight[k] ?? [0, 0, 0], city));
      const skyOf = (c: 0 | 1 | 2): number => Math.max(mean[c] - (1 - f) * direct[c], 0) / Math.max(f + (1 - f) * facadeSky, 1e-12);
      const skyValue: Rgb = [skyOf(0), skyOf(1), skyOf(2)];
      const model = plus(times(skyValue, facadeSky), direct);
      // When the model's own light exceeds what the window admits, the sky takes none and the facade the window's mean
      // (finding M3: the sky is zeroed too, so the view's mean stays the admitted light).
      const over = f < 1 && f * luminanceOf(skyValue) + (1 - f) * luminanceOf(model) > luminanceOf(mean) * (1 + 1e-9);
      sky.push(over ? [0, 0, 0] : skyValue);
      facade.push(over ? times(mean, 1 / (1 - f)) : model);
    }
    const site = this.inputs.site;
    const moonUp = !captured && moon.elevation > 0;
    // The disc in the Moon's colour at its elevation, luminance 1 (Task 6: reddening toward the horizon).
    const beam = moonBeamShift(moon.elevation), daylight = this.inputs.daylightColour;
    const tint: Rgb = [daylight[0] * beam[0], daylight[1] * beam[1], daylight[2] * beam[2]];
    return {
      sky, facade,
      moonDisc: times(tint, moonUp ? moonDiscRadiance(moon, this.calibration) / Math.max(luminanceOf(tint), 1e-12) : 0),
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
  /** Scene to model frame (the room's placement): the eye is three's `cameraPosition` of the view being drawn (finding I6). */
  private readonly sceneToModel = uniform(new Matrix4());

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
    const eye = this.sceneToModel.mul(vec4(cameraPosition, 1)).xyz;
    const direction = normalize(positionLocal.sub(eye));
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
    this.material.colorNode = vec4(displayNode(select(onDisc, disc.mul(float(1).sub(glowShare)), base), frame.uniforms.display, float(HIGHLIGHT_KNEE)), 1);
    this.material.mrtNode = mrt({ emission: vec4(select(onDisc, disc.mul(glowShare), vec3(0)), 1) });
  }

  show(view: WindowView): void {
    view.sky.forEach((value, k) => { this.sky[k]?.set(value[0], value[1], value[2]); });
    view.facade.forEach((value, k) => { this.facade[k]?.set(value[0], value[1], value[2]); });
    this.moonDisc.value.set(view.moonDisc[0], view.moonDisc[1], view.moonDisc[2]);
    this.moonDir.value.set(view.moonDir[0], view.moonDir[1], view.moonDir[2]);
    this.sunDir.value.set(view.sunDir[0], view.sunDir[1], view.sunDir[2]);
    this.moonUp.value = view.moonUp ? 1 : 0;
  }

  /** The room's placement: scene to model frame (tileToModel × placement⁻¹). */
  setPlacement(sceneToModel: Matrix4): void {
    this.sceneToModel.value.copy(sceneToModel);
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
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { CinematicData } from "../../lib/relight/cinematic-package.js";
import { CAPTURE_CALIBRATION } from "../../lib/relight/eye.js";
import type { LightDirector } from "../../lib/relight/light-director.js";
import type { RelightFrame } from "../../lib/relight/relight-frame.js";
import { measureRelight } from "../../lib/relight/relight-spans.js";
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
  const panels = useMemo(() => measureRelight("relight:cinematic-parts", () => new WindowViewPanels(frame)), [frame]);
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
  useEffect(() => { panels.setPlacement(sceneToModel); }, [panels, sceneToModel]);
  useEffect(() => () => { panels.dispose(); }, [panels]);
  // R3F types `rotation` as a mutable tuple, so the placement is destructured, as R1b's sky panels do (finding B10).
  const [px, py, pz] = transform.position;
  const [rx, ry, rz] = transform.rotation;
  return (
    <group position={[px, py, pz]} rotation={[rx, ry, rz]} scale={transform.scale} name="relight-window-view">
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

In `packages/web/src/components/scene/cinematic-light.ts`, append `export { cityWindowWeights, windowSkyFraction } from "../../lib/relight/window-view.js";`. In `packages/web/src/components/scene/RelightProvider.tsx`, replace `      {frame !== null && <RelightSkyPanels frame={frame} transform={transform} />}` with `      {frame !== null && (live === null || live.data === null) && <RelightSkyPanels frame={frame} transform={transform} />}` (the window view replaces R1b's panels once the package is in use; an explicit null test, since the repo's `eqeqeq` refuses `== null`: finding B6), and replace Task 9's line

```ts
            director.setCinematic({ lamps: found.lamps, eyeAnchors: found.eyeAnchors, city: null, calibration: light.CAPTURE_CALIBRATION });
```

with (through the loaded entry, so the provider imports none of the cinematic light):

```ts
            // The city's light through the windows at night (decision 3), built from what each window sees.
            const fractions = frame.model.windows.map((window) => light.windowSkyFraction(window));
            const city = light.cityWindowWeights(frame.model.windows, found.windowRadiance, fractions, light.CAPTURE_CALIBRATION, frame.inputs.daylightColour);
            director.setCinematic({ lamps: found.lamps, eyeAnchors: found.eyeAnchors, city, calibration: light.CAPTURE_CALIBRATION });
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/window-view.test.ts`
Expected: PASS, 6 tests.

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/sky-panels.test.ts`
Expected: PASS, the Task 0 count plus 1.

Then, one per command: `src/components/scene/__tests__/RelightCinematic.test.tsx`, `src/components/scene/__tests__/RelightProvider.test.tsx`. Expected: PASS at their counts after Task 14 (the provider's panel test runs without the cinematic package and still finds R1b's one panel mesh, named `relight-sky-panel`).

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/window-view.ts src/lib/relight/sky-panels.ts src/components/scene/RelightWindowView.tsx src/components/scene/RelightCinematic.tsx src/components/scene/RelightProvider.tsx src/components/scene/cinematic-light.ts`
Expected: no errors, no problems.

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/window-view.ts packages/web/src/lib/relight/__tests__/window-view.test.ts packages/web/src/lib/relight/sky-panels.ts packages/web/src/lib/relight/__tests__/sky-panels.test.ts packages/web/src/components/scene/RelightWindowView.tsx packages/web/src/components/scene/RelightCinematic.tsx packages/web/src/components/scene/RelightProvider.tsx packages/web/src/components/scene/cinematic-light.ts && git diff --cached --stat && git commit -m "feat(relight): the windows show the street, the sky and the Moon at its phase; the city lights the night (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Night vision: the display's scotopic shift

**Files:**
- Modify: `packages/web/src/lib/relight/display.ts`, `packages/web/src/lib/relight/relight-frame.ts`, `packages/web/src/lib/relight/light-director.ts`
- Test: `packages/web/src/lib/relight/__tests__/display.test.ts`, `packages/web/src/lib/relight/__tests__/relight-frame.test.ts`, `packages/web/src/lib/relight/__tests__/light-director.test.ts`, `packages/web/src/components/scene/__tests__/RelightProvider.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`EyeTarget.scotopic`), Task 7 (`RelightFrame.setDisplay`), Task 9 (the director's apply and display writes); R1b's `display.ts` (`DisplayParams`, `DisplayUniforms`, `displayColour`, `displayNode`) and the frame's `display` uniforms.
- Produces (`display.ts`): `DisplayParams.scotopic?: number`; `DisplayUniforms.scotopic?: UniformNode<"float", number>` and `DisplayUniforms.linear?: UniformNode<"float", number>` (Task 18's probes); `NIGHT_TINT: Rgb` (luminance 1); `scotopicLuminance(rgb: Rgb): number`; `SCOTOPIC_WHITE`; `nightVision(rgb: Rgb, amount: number): Rgb` (CPU) and `nightVisionNode(rgb: Node<"vec3">, amount: Node<"float">): Node<"vec3">` (TSL; the frontier study's upgrade point); `displayColour` and `displayNode` apply it first when the amount is present.
- Produces (frame): the display uniforms gain `scotopic` (0) and `linear` (0); R1b's `writeDisplay`, which `apply`, R1b's `refineDisplay` and Task 7's `setDisplay` all call, writes `scotopic` (0 when absent).

Decision 4: the shift follows the absolute luminance the eye adapts to (Task 5's `scotopicAmount`, through the capture's calibration), never the preset, so the captured light and the lamp-lit night (about 21 and 16 cd/m²) are untouched and only dimmed lamps, the blue hour without lamps and moonlight go toward the rods. The stage is Thompson, Shirley & Ferwerda's (2002, *A spatial post-processing algorithm for images of night scenes*, *Journal of Graphics Tools* 7(1):1–12): the scotopic luminance V = Y[1.33(1 + (Y + Z)/X) − 1.68] from the linear colour's CIE XYZ (sRGB primaries, D65), shown in their bluish night colour (CIE xy 0.25, 0.25, at luminance 1), mixed in by the amount. V is normalised by its value for the display's white (about 2.57), so a neutral grey keeps its luminance and a warm surface darkens toward the rods as it should (the Purkinje shift: incandescent light's scotopic-to-photopic ratio is about 1.4 against daylight's 2.5). It is applied to the linear light before exposure, in the one display every relit surface and the composer's added light pass through, so it is consistent everywhere; at amount 0 it is the identity exactly (`mix(c, ·, 0)` is `c`). The frontier study's mesopic model (Wanat & Mantiuk's rod gains with CAT16 chromatic adaptation, its §c7) could replace `nightVisionNode` through the same inputs, but its d3 (8 October) does not recommend it: the chain turns both 1% scenes strongly blue and renders the lamp-free blue hour cream, so the Thompson stage stays, and `NIGHT_TINT` and `SCOTOPIC_MAX` 0.6 remain design values.

Verified (7 October; R1b's lines re-read on 8 October): R1b plan lines 4898–4961 (`display.ts`: `import { float, max, min, mix, select, vec3 } from "three/tsl";` at 4898, `DisplayParams` at 4909, `displayColour(rgb, params, knee = HIGHLIGHT_KNEE)` at 4932 with its first line `const c: Rgb = …` at 4933, `DisplayUniforms { exposure, whiteBalance }` at 4943, `displayNode(rgb, display, knee)` with `const c = rgb.mul(display.exposure).mul(display.whiteBalance);` at 4955 and `return select(peak.greaterThan(knee), rolled, c);` at 4961), 6310 (`display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)) } satisfies DisplayUniforms,`), 6324 (`type RelightUniforms = ReturnType<typeof createRelightUniforms>`, so the new uniforms are typed as written), 7023–7031 (`refineDisplay` writes through `writeDisplay`), 7033–7036 (`private writeDisplay(display: DisplayParams)`: the display uniforms' one writer; `apply` calls it), 4696 (the display tests), 9065 (the provider test `expect(frame?.current?.display).toEqual(PRESET_DISPLAY.captured);`); this plan's Task 7 (`setDisplay` writes through `writeDisplay`), Task 9 (`frame.apply({ … display: { exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance } })`, `this.frame.setDisplay({ exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance })`, and its test's identity line `expect(frame.current?.display).toEqual({ exposure: 1, whiteBalance: [1, 1, 1] });`); the night tint (0.706, 0.990, 1.966) and a grey of 0.5 half-shifted, (0.427, 0.497, 0.741), computed 8 October (node): at exposure 2 its peak, 1.48, is above the 0.8 knee, so the test sets the knee aside (finding B4).

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
    // A lamp group's warm-down start (Task 3's chandeliers, 3,700 K; ruling L3: there is no single lamp temperature).
    const lamp = planckRgb(3700);
    const warm = nightVision([lamp[0] / luminance(lamp), 1 / luminance(lamp), lamp[2] / luminance(lamp)], 1);
    expect(luminance(warm)).toBeLessThan(0.7);
    expect(scotopicLuminance([1, 1, 1])).toBe(SCOTOPIC_WHITE);
  });

  it("mixes in by the amount before exposure (R1d)", () => {
    // A knee of 10 keeps the comparison off the highlight roll-off: the shifted grey's peak at exposure 2 is 1.48 (finding B4).
    const half = displayColour([0.5, 0.5, 0.5], { exposure: 2, whiteBalance: [1, 1, 1], scotopic: 0.5 }, 10);
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

- [ ] **Step 4: The frame and the director** — in `packages/web/src/lib/relight/relight-frame.ts`, replace `    display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)) } satisfies DisplayUniforms,` with `    display: { exposure: uniform(1), whiteBalance: uniform(new Vector3(1, 1, 1)), scotopic: uniform(0), linear: uniform(0) } satisfies DisplayUniforms,`, and in R1b's `private writeDisplay(display: DisplayParams): void`, directly after `    this.uniforms.display.whiteBalance.value.set(display.whiteBalance[0], display.whiteBalance[1], display.whiteBalance[2]);` add `    this.uniforms.display.scotopic.value = display.scotopic ?? 0;` (`writeDisplay` is the display uniforms' one writer: `apply`, R1b's `refineDisplay` and Task 7's `setDisplay` all call it; finding I12).

In `packages/web/src/lib/relight/light-director.ts`, replace `      this.frame.apply({ setting: light.setting, sun: weather === null ? null : sky.sun, display: { exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance } });` with `      this.frame.apply({ setting: light.setting, sun: weather === null ? null : sky.sun, display: frame.eye });` and `      this.frame.setDisplay({ exposure: frame.eye.exposure, whiteBalance: frame.eye.whiteBalance });` with `      this.frame.setDisplay(frame.eye);` (an `EyeTarget` is a `DisplayParams` with its scotopic amount).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/display.test.ts`
Expected: PASS, the Task 0 count plus 3 (R1b's own display tests unchanged).

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-frame.test.ts`
Expected: PASS, the count after Task 7 plus 1.

The director's display now carries the eye's scotopic amount, so the captured light's display is exactly `{ exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 }` (finding I12). In `packages/web/src/lib/relight/__tests__/light-director.test.ts`, replace `    expect(frame.current?.display).toEqual({ exposure: 1, whiteBalance: [1, 1, 1] });` with `    expect(frame.current?.display).toEqual({ exposure: 1, whiteBalance: [1, 1, 1], scotopic: 0 });`, and in `packages/web/src/components/scene/__tests__/RelightProvider.test.tsx` replace `    expect(frame?.current?.display).toEqual(PRESET_DISPLAY.captured);` with `    expect(frame?.current?.display).toEqual({ ...PRESET_DISPLAY.captured, scotopic: 0 });` (the director path; Task 9's `?cinematic=off` test keeps R1b's display, which has none).

Then, one per command: `src/lib/relight/__tests__/light-director.test.ts`, `src/lib/relight/__tests__/relight-draw.test.ts`, `src/components/scene/__tests__/RelightProvider.test.tsx`, `src/components/scene/__tests__/RelightProvider-cinematic.test.tsx`. Expected: PASS at their counts.

Run: `pnpm --filter @omnitwin/web exec tsc --noEmit -p tsconfig.json` and `pnpm --filter @omnitwin/web exec eslint src/lib/relight/display.ts src/lib/relight/relight-frame.ts src/lib/relight/light-director.ts`
Expected: no errors, no problems.

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo && git add packages/web/src/lib/relight/display.ts packages/web/src/lib/relight/relight-frame.ts packages/web/src/lib/relight/light-director.ts packages/web/src/lib/relight/__tests__/display.test.ts packages/web/src/lib/relight/__tests__/relight-frame.test.ts packages/web/src/lib/relight/__tests__/light-director.test.ts packages/web/src/components/scene/__tests__/RelightProvider.test.tsx && git status --short packages/web/src && git diff --cached --stat && git commit -m "feat(relight): night vision from absolute luminance, the identity in the photopic hall (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: GGX sheen from the Sun, the Moon, the lamps and the windows

**Files:**
- Create: `packages/web/src/lib/relight/sheen.ts`
- Modify: `packages/web/src/lib/relight/floor-material.ts`, `packages/web/src/components/scene/RelightCinematic.tsx`
- Test: `packages/web/src/lib/relight/__tests__/sheen.test.ts` (create)

**Interfaces:**
- Consumes: R1c's `SkinSurface` (`position`, `normal`, `albedo`, `roughness`, `metal`, the optional `specularColour` (the metal's F0, gold for gilding: R1c Task 20), `bodyVisibility(body)`) and `SkinSheen` (`diffuseScale`, `specular`); Task 10 (`FloorLightHooks.sheen`, `InteriorShadowHook`), Task 8 (`CinematicData`: `bulbs` with per-bulb `kind` and `intensity`, `envelopes`, `glow`, `windowRadiance`; the span `relight:cinematic-parts`), Task 11 (`BULB_SOURCE`), Task 14 (the mount's `sceneToModel`); three's `cameraPosition`; R1b's frame uniforms (`sunDir`, `sunRgb`, `sunOn`, `moonDir`, `moonRgb`, `moonOn`, `sourceWeights`), the floor material's `model`, `lightUv`, `floorSunNode`.
- Produces: `MIN_ROUGHNESS = 0.05`, `FLOOR_ROUGHNESS = 0.3`, `DIELECTRIC_F0 = 0.04`, `METAL_DIFFUSE_SCALE = 0.5`, `MAX_LAMP_LIGHTS = 8`, `UNCOVERED_LAMP_RADIUS = 0.75`; `ggxDistribution(nDotH: number, alpha: number): number`; `smithCorrelatedVisibility(nDotL: number, nDotV: number, alpha: number): number`; `fresnelSchlick(f0: number, vDotH: number): number`; `envBrdfApprox(f0: number, roughness: number, nDotV: number): number` (Karis 2014); `interface LampLight3 { readonly position: Vec3; readonly radius: number; readonly source: number; readonly intensity: number }` (one per chandelier); `lampLightsOf(data: CinematicData): LampLight3[]`; `type ReflectionHook = (position: Node<"vec3">, direction: Node<"vec3">, roughness: Node<"float">) => Node<"vec3">`; `class CinematicSheen` with `constructor(frame: RelightFrame, data: CinematicData, interior: InteriorShadowHook | null)`, readonly `hook: (surface: SkinSurface) => SkinSheen`, `setPlacement(sceneToModel: Matrix4): void` (the eye is three's `cameraPosition` of the view being drawn, taken to the model frame in the shader), `setWeight(weight: number): void` (the displayed light's `sheen`: 0 at the captured light), `setReflections(hook: ReflectionHook | null): void` (Task 18).
- Produces (floor): `litFloorMaterial` with `hooks.sheen` set adds the floor's sheen (roughness 0.3, dielectric) and scales its base light by `diffuseScale`.

Spec §4.2 asks for "GGX sheen using R1c's maps". The specular is Cook–Torrance with the GGX distribution, the height-correlated Smith visibility and Schlick's Fresnel (F0 = mix(0.04, the metal's specular colour, metal), the specular colour being R1c's `specularColour` (gold for gilding, R1c Task 20) and the albedo where a skin has none: with the albedo alone the gilded frieze would reflect in its dark brown, not gold, finding I1; roughness from R1c's map, α = roughness², floored at 0.05 so the Sun's 0.53° disc never becomes a single texel's flash), in the relit surfaces' units (a matte surface shows π times its radiance, so a specular term is π × BRDF × E × cos). Its lights:
- **The Sun and the Moon**, the kernel's two body slots: each body's light gated exactly as the surface's diffuse light is (R1c's `bodyVisibility`, the window march at the pixel; the floor's own sun or moon grid) and by the interior shadow (Task 10).
- **The lamps**, one sphere light per chandelier: for a chandelier with crisp lamps its centre and radius span them (plus the largest envelope among their kinds: a candle's or a crown tube's, ruling L2) and its intensity is the sum of theirs (Task 3's per-lamp intensities, times the group's source weight, so it carries the fade, the dimming tint and the night gain); for a chandelier the bulb table does not cover (all five are covered since 7 October; the path stays for a package without one), a 0.75 m sphere (its volume's radius) at the proof's centre with its group's mean lamps, as Task 3 counts it on the floor. The dome has none: its light comes from 14 crests lit by LED pin spots, a broad source whose specular R1d leaves out. A sphere light by Karis's representative point (*Real Shading in Unreal Engine 4*, 2013): the point on the sphere nearest the reflected ray, with the energy-conserving widening α' = clamp(α + R / (2d)) and normalisation (α/α')².
- **The windows**, one rectangle each, their radiance the window's weight times the package's window radiance: also by representative point (the reflected ray's crossing of the window plane, clamped to the opening) with the same widening by the window's half-size over its distance.
- **The probes** (Task 18): their prefiltered radiance along the reflected ray times Karis's analytic environment BRDF (*Physically Based Shading on Mobile*, 2014).
At the captured light the sheen is weighted to nothing (the displayed light's `sheen`, Task 9: 0 for the captured light, 1 for a computed sky, carried by the cross-fade): the capture's splats and floor already hold its own reflections, and spec §4.3 wants the hall exactly as captured there; the weight multiplies the specular and the gilding's diffuse share alike, so at 0 every surface is exactly R1b's and R1c's. Gilding keeps half of its diffuse light (`diffuseScale` 1 − 0.5 × metal × weight): its captured albedo already holds part of what it reflected under the capture's diffuse light, and the probes now carry that share as reflection (a design value for Blake). The floor uses the same sheen with roughness 0.3, a waxed oak floor (a design value; R1c's floor maps take over when they exist). The gilt skins' roughness and F0 are R1c's designed prior (`GILT_ROUGHNESS` 0.40, α 0.16, and `GOLD_F0`) unless the measured layer is imported, so their sheen is labelled designed, as decision 5 records. Every view direction is three's `cameraPosition`, which three sets for each render, taken to the model frame by the room's placement, so a capture's highlights are its own view's (finding I6).

Verified (7 October; re-read 8 October): the R1c interface item 4 (`SkinSurface`, with R1c Task 20's optional `specularColour`; `SkinSheen`, `SkinLightHooks.sheen`; the skin material adds `sheen.specular` and scales its base light by `sheen.diffuseScale`), R1c's `GILT_ROUGHNESS` and `GOLD_F0`; R1b plan lines 8781–8797 (`litFloorMaterial`: `albedo`, `model`, `lightUv`, `base`, the bodies' term) as amended by A2 and A5 and Task 10; this plan's Task 3 (`lamp_intensities`: a bulb lights a surface with weights[k] × intensity × cosθ / d²; `window_radiance`), Task 11 (`BULB_SOURCE`).

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
        { id: "c0_b00", group: "ch_end", kind: "candle", chandelier: 0, position: [1, 0, 3], intensity: 2 },
        { id: "c0_b01", group: "ch_end", kind: "candle", chandelier: 0, position: [3, 0, 3], intensity: 3 },
        { id: "c2_b00", group: "ch_centre", kind: "crown", chandelier: 2, position: [9, -5, 5], intensity: 4 },
      ],
      glow: FIXTURE_CENTRES.map((centre, id) => ({ centre, crisp: id === 0 || id === 2 })),
    });
    expect(lampLightsOf(data)).toEqual([
      { position: [2, 0, 3], radius: 1.0175, source: 6, intensity: 5 },
      { position: [9, -5, 5], radius: 0.0125, source: 7, intensity: 4 },
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
import { Matrix4, Vector4 } from "three";
import type { Node } from "three/webgpu";
import {
  Loop, cameraPosition, clamp, dot, exp2, float, length, max, min, mix, normalize, reflect, select, uniform, uniformArray, vec2, vec3, vec4,
} from "three/tsl";
import type { SkinSheen, SkinSurface } from "../skins/skin-material.js";
import { BULB_SOURCE } from "./bulbs.js";
import type { CinematicBulb, CinematicData } from "./cinematic-package.js";
import type { Vec3 } from "./relight-codec.js";
import type { InteriorShadowHook, RelightFrame } from "./relight-frame.js";

/**
 * GGX sheen (T-639 R1d, spec §4.4) on R1c's maps and the floor: Cook–Torrance with the GGX distribution, the
 * height-correlated Smith visibility and Schlick's Fresnel, from the two sky bodies, the lamps as sphere lights and
 * the windows as rectangles (Karis 2013's representative points), plus the probes' reflections (Karis 2014's
 * analytic environment BRDF). In the relit surfaces' units: π × BRDF × E × cos.
 */
export const MIN_ROUGHNESS = 0.05;
export const FLOOR_ROUGHNESS = 0.3;
export const DIELECTRIC_F0 = 0.04;
export const METAL_DIFFUSE_SCALE = 0.5;
export const MAX_LAMP_LIGHTS = 8;
/** A chandelier the bulb table does not cover shines as a sphere of its volume's radius (02_geometry.py). */
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
 * One sphere light per chandelier. With crisp lamps: centre and radius span them (plus the largest envelope among their
 * kinds), the intensity is theirs summed. Not yet triangulated: a sphere of the volume's radius at the proof's centre with its
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
    const envelope = Math.max(...bulbs.map((bulb) => data.envelopes[bulb.kind].radius));
    lights.push({ position: centre, radius: spread + envelope, source: BULB_SOURCE[group], intensity: bulbs.reduce((sum, bulb) => sum + bulb.intensity, 0) });
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
  /** Scene to model frame (the room's placement): the eye is three's `cameraPosition` of the view being drawn (finding I6). */
  private readonly sceneToModel = uniform(new Matrix4());
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
      const eye = this.sceneToModel.mul(vec4(cameraPosition, 1)).xyz;
      const v = normalize(eye.sub(p));
      const nDotV = max(dot(n, v), 1e-4);
      const roughness = max(surface.roughness, MIN_ROUGHNESS);
      const alpha = roughness.mul(roughness);
      // The metal's own F0 (R1c's specularColour, gold for gilding), else its albedo (finding I1).
      const f0 = mix(vec3(DIELECTRIC_F0), surface.specularColour ?? surface.albedo, surface.metal);
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

  /** The room's placement: scene to model frame (tileToModel × placement⁻¹, Task 14's memo). */
  setPlacement(sceneToModel: Matrix4): void {
    this.sceneToModel.value.copy(sceneToModel);
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
    setSheen(measureRelight("relight:cinematic-parts", () => new CinematicSheen(frame, data, shadows?.hook ?? null)));
    return () => { setSheen(null); };
  }, [frame, data, shadows]);
  // The view direction is three's cameraPosition of the view being drawn, taken to the model frame (finding I6).
  useEffect(() => { sheen?.setPlacement(sceneToModel); }, [sheen, sceneToModel]);
  useEffect(() => {
    if (sheen === null || director === null) return;
    // No added sheen at the captured light; the cross-fade carries it in and out (Task 9's SkyLight.sheen).
    const shown = director.current();
    if (shown !== null) sheen.setWeight(shown.light.sheen);
    return director.onDisplayed((light) => { sheen.setWeight(light.light.sheen); });
  }, [sheen, director]);
```

(`sceneToModel` is Task 14's memo). Replace the two hook memos with:

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
- Produces: `PROBE_SIZE = 128`, `PROBE_LAYER = 5`, `REFLECTED_MATERIALS = ["stage-floor-lit", "relight-skin"]`; `boxProjectedDirection(point: Vec3, direction: Vec3, centre: Vec3, box: readonly [Vec3, Vec3]): Vec3`; `probeWeights(x: number, probes: readonly CinematicProbe[]): number[]` (the two nearest along the hall's axis, summing to 1); `markReflected(scene: Object3D): number` (layer 5 on the floor's and the skins' meshes; the count); `class ReflectionProbes` with `constructor(frame: RelightFrame, probes: readonly CinematicProbe[], modelToScene: Matrix4)`, readonly `hook: ReflectionHook`, `invalidate(): void` (a change during a refresh lets it finish, then starts the next), `step(renderer: WebGPURenderer, scene: Scene): boolean` (one cube face; true while a refresh is under way or another is due), `dispose(): void`.

Decision 5. Three cube probes (128 texels a face, half float) stand on the hall's long axis at eye height (Task 3), each boxed by the hall. They capture only the relit meshes, the restored floor and R1c's skins (layer 5: a splat draw costs about a frame and cannot be redrawn per face while the light moves), in linear light (the display's `linear` switch is on only while a probe draws). A change of light starts a refresh that draws one face a frame (18 frames for the three probes, under a third of a second at 60 fps); a change during a refresh lets it finish and then starts the next, so while the light moves the probes refresh continuously, each a third of a second behind the light (finding I4: restarting on every change would redraw probe 0's first face forever and complete nothing while the light moves); the probes are double-buffered, so a material never samples the cube being drawn, and each probe's new cube replaces its old one when its sixth face is done (that face generates the mip chain, as `CubeCamera.update` does). A surface reads the two nearest probes along the hall's axis, each box-projected (the reflected ray's exit from the probe's box, seen from the probe's centre), at the mip level of its roughness. The six face cameras are oriented for the renderer's coordinate system before the first face is drawn, as `CubeCamera.update` would do (the plan draws the faces itself, and three sets a face camera's direction only in `updateCoordinateSystem`: without it all six look down −z, finding I3). The bright emitters (the Sun, the Moon, the lamps, the windows) are not in the probes; they reflect analytically through the sheen (Task 17), so nothing is counted twice. The 3D ornament that stays splats is missing from the soft reflections by design.

Verified (7 October; re-read 8 October): three 0.186 `src/cameras/CubeCamera.js:66` (`coordinateSystem = null` at construction), `:105-157` (`updateCoordinateSystem`: each face camera's `up` and `lookAt` for the WebGL or WebGPU system), `:184-188` (only `update` calls it), @types/three `src/cameras/CubeCamera.d.ts:70,80` and `src/renderers/common/Renderer.d.ts:389` (`coordinateSystem`); `src/renderers/common/Renderer.d.ts:510` (`render(…): void`, so no `void` operator: finding B9); `src/nodes/accessors/TextureNode.js:198-217` (a node's `value` reads its `referenceNode`'s) and `:696-704` (`sample` clones with `referenceNode = this.getBase()`), `src/cameras/CubeCamera.js:77-97` (the six face cameras take the CubeCamera's layers), `:178-255` (`update`: per face `renderer.setRenderTarget(renderTarget, face, activeMipmapLevel)` and `render(scene, camera)`, mipmaps generated with the last face), `src/nodes/accessors/CubeTextureNode.js:184` (`cubeTexture(value, uvNode, levelNode)`), `src/renderers/common/CubeRenderTarget.js` (`new CubeRenderTarget(size, options)`); the R1c interface item 5 (R1c's `SKIN_MATERIAL_NAME = "relight-skin"`); R1b plan line 8784 (`material.name = "stage-floor-lit"`).

- [ ] **Step 1: Write the failing test** — create `packages/web/src/lib/relight/__tests__/reflection-probes.test.ts`:

```ts
import { Matrix4, Mesh, MeshBasicMaterial, Scene, Vector3, type Camera } from "three";
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

  it("draws one face a frame after a change of light, 18 in all, each face its own way, with the display linear only while drawing", () => {
    const frame = new RelightFrame(data);
    const probes = new ReflectionProbes(frame, PROBES, new Matrix4());
    const linear: number[] = [];
    const looks: string[] = [];
    const renderer = Object.assign(new WebGPURenderer(), {
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      setRenderTarget: () => undefined,
      render: (_scene: Scene, camera: Camera) => {
        linear.push(frame.uniforms.display.linear.value);
        looks.push(camera.getWorldDirection(new Vector3()).toArray().map((value) => Math.round(value)).join(","));
        return undefined;
      },
    });
    const scene = new Scene();
    expect(probes.step(renderer, scene)).toBe(false);
    probes.invalidate();
    let frames = 0;
    while (probes.step(renderer, scene)) frames += 1;
    expect([frames + 1, linear.length]).toEqual([18, 18]);
    expect(new Set(linear)).toEqual(new Set([1]));
    expect(frame.uniforms.display.linear.value).toBe(0);
    // The six faces look six ways (finding I3: unoriented, all six look down −z).
    expect(new Set(looks.slice(0, 6)).size).toBe(6);
    probes.dispose();
  });

  it("lets a refresh finish when the light changes during it, then refreshes again (finding I4)", () => {
    const frame = new RelightFrame(data);
    const probes = new ReflectionProbes(frame, PROBES, new Matrix4());
    let renders = 0;
    const renderer = Object.assign(new WebGPURenderer(), {
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      setRenderTarget: () => undefined,
      render: () => { renders += 1; return undefined; },
    });
    const scene = new Scene();
    probes.invalidate();
    for (let face = 0; face < 5; face += 1) expect(probes.step(renderer, scene)).toBe(true);
    probes.invalidate();
    while (probes.step(renderer, scene)) { /* one face a frame */ }
    expect(renders).toBe(36);
    expect(probes.step(renderer, scene)).toBe(false);
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
  /** A change of light arrived during a refresh: the next starts when this one finishes (finding I4). */
  private dirty = false;

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

  /** A change of light: redraw every probe, one face a frame; during a refresh, once it finishes. */
  invalidate(): void {
    if (this.pending === 0) this.pending = this.probes.length * 6;
    else this.dirty = true;
  }

  /** Draw the next face; returns true while faces remain or another refresh is due. The display is linear only while a face draws. */
  step(renderer: WebGPURenderer, scene: Scene): boolean {
    if (this.pending === 0) {
      if (!this.dirty) return false;
      this.dirty = false;
      this.pending = this.probes.length * 6;
    }
    const done = this.probes.length * 6 - this.pending;
    const probe = this.probes[Math.floor(done / 6)];
    const face = done % 6;
    if (probe === undefined) { this.pending = 0; return false; }
    // The face cameras' directions are set only by updateCoordinateSystem, which CubeCamera.update would call (finding I3).
    if (probe.camera.coordinateSystem !== renderer.coordinateSystem) {
      probe.camera.coordinateSystem = renderer.coordinateSystem;
      probe.camera.updateCoordinateSystem();
      probe.camera.updateMatrixWorld(true);
    }
    const write = probe.targets[1];
    const faceCamera = probe.camera.children[face];
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace(), previousMip = renderer.getActiveMipmapLevel();
    const linear = this.frame.uniforms.display.linear;
    write.texture.generateMipmaps = face === 5;
    linear.value = 1;
    try {
      renderer.setRenderTarget(write, face);
      if (faceCamera instanceof PerspectiveCamera) renderer.render(scene, faceCamera);
    } finally {
      linear.value = 0;
      renderer.setRenderTarget(previous, previousFace, previousMip);
    }
    if (face === 5) {
      // The probe is complete: materials read it from now on, and the next refresh draws into the old one.
      // (The cube camera's own renderTarget is never used: the faces are drawn here, not by CubeCamera.update.)
      probe.targets = [write, probe.targets[0]];
      probe.node.value = write.texture;
    }
    this.pending -= 1;
    return this.pending > 0 || this.dirty;
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
    const created = measureRelight("relight:cinematic-parts", () => new ReflectionProbes(frame, data.probes, sceneToModel.clone().invert()));
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
Expected: PASS, 5 tests.

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
- Consumes: Task 6 (`dayNumber`, `skyAt`, `instantOf`), R1b Task 6's `solarPosition` (`lib/sun.ts`) and `moonPosition` (`lib/moon.ts`: R1a's `moon.py` ported, amendment A3 as applied).
- Produces: `ARC_STEP_MINUTES = 5`, `SUNRISE_ELEVATION = -0.833`, `GOLDEN_ELEVATION = 6`, `DETENT_MINUTES = 8`, `DETENT_PULL = 0.6`; `interface ArcPoint { readonly minutes: number; readonly elevation: number; readonly azimuth: number }`; `interface SkyArcs { readonly date: string; readonly sun: readonly ArcPoint[]; readonly moon: readonly ArcPoint[] }`; `skyArcs(date: string, latitude: number, longitude: number): SkyArcs`; `type DetentKind = "sunrise" | "golden-morning" | "golden-evening" | "sunset" | "moonrise" | "moonset"`; `interface Detent { readonly kind: DetentKind; readonly minutes: number }`; `skyDetents(date: string, latitude: number, longitude: number): Detent[]` (sorted); `detentPull(minutes: number, detents: readonly Detent[]): number`; `snapToDetent(minutes: number, detents: readonly Detent[]): number`.

The clock (Task 20) draws the Sun's and the Moon's arcs for the chosen date as a time–altitude chart (decision 8): every five minutes of London's wall clock, both bodies' elevations (and azimuths, for the words). The detents are the moments the owner named: sunrise and sunset (the Sun's upper limb on a refracted horizon, −0.833°, NOAA's convention, so they match the published times), the golden hours' edges (the Sun crossing 6°: the morning's golden hour ends, the evening's begins), and moonrise and moonset (the Moon's centre crossing 0°, refracted, the Moon's apparent centre as the clock draws it). Each crossing is found on the five-minute grid and refined by bisection to under a second. A detent is gentle: while dragging within 8 minutes of one, the target is pulled 60% of the way toward it, falling off smoothly to nothing at the edge; on release within 8 minutes, it settles there (through the time spring, so the arrival is a glide). A day can lack some (the Moon may not rise; at midsummer the golden hours do happen, but not every crossing exists at every latitude): only those that exist are returned.

Verified (7 October; R1b's lines re-read 8 October): Task 6's `instantOf` (London wall minutes, October's first repeated hour) and the NOAA Sun (R1b plan lines 4230–4235, `SolarPosition`, and 4257, `solarPosition`); the pre-flight scan recomputed every detent this task and Tasks 20 and 23 quote with the proof's NOAA and R1a's `moon.py` (8 October): they hold to 0.1 min; the Glasgow times computed with the proof's NOAA algorithm on 7 October (scratch run): 21 June 2026 sunrise 271.22 min (04:31 BST) and sunset 1326.41 min (22:06 BST), Sun at 6° at 334.04 and 1263.60 min; 21 December 2026 sunrise 525.67 (08:46 GMT) and sunset 944.48 (15:44 GMT), against NOAA's published 04:31/22:06 and 08:46/15:44 for Glasgow.

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
- Consumes: Task 19 (`skyArcs`, `skyDetents`, `detentPull`, `snapToDetent`, `SkyArcs`, `Detent`), Task 9 (`subscribeDisplayedLight`, `currentDisplayedLight`, `DisplayedLight`), Task 6 (the store's `follow`, `lamps`, `setLamps`, `followClock`; `LAMP_MODES`, `dateOfDay`, `formatMinutes`, `clampMinutes`); R1c item 7 (the store's `hiddenToggles`, `setToggleHidden`) and R1c Task 21 Step 4's walls status in `LightControl` (`const skins = useLightSettingStore((state) => state.skins);` and the "Preparing the walls…" `ActivityStatus` with its measured progress, tested by R1c's `LightControl-skins.test.tsx`); R1b's `TRADES_HALL_LATITUDE`/`LONGITUDE`, `ActivityStatus`, the walk's palette variables (`--stone`, `--stone-dim`, `--brass`).
- Produces (`SkyClock.tsx`): `CLOCK_WIDTH = 288`, `CLOCK_HEIGHT = 112`, `ELEVATION_TOP = 60`, `ELEVATION_BOTTOM = -20`, `KEY_STEP_MINUTES = 5`, `KEY_PAGE_MINUTES = 60`; `type ClockReading = Pick<DisplayedLight, "instant" | "sun" | "moon" | "following">`; `clockX(minutes: number): number`; `clockY(elevation: number): number`; `arcPath(points: SkyArcs["sun"]): string`; `minutesFromPointer(clientX: number, rect: Pick<DOMRect, "left" | "width">): number`; `compassWord(azimuth: number): string`; `clockWords(minutes: number, reading: ClockReading | null): string`; `SkyClock({ subscribe }: { subscribe?: (listener: (reading: ClockReading | null) => void) => () => void }): ReactElement`.
- Produces (`LightControl`): the presets; the clock (in place of R1b's hour slider); the date and a "Now" button (pressed while following); the lamps' three modes; two switches for what can be hidden ("Loose cables and stray items", "AV cabinet"; R1c's toggles); and R1c's "Preparing the walls…" status, kept as R1c wrote it (finding B11).

Spec §4.5 and decision 8. The clock is an astronomer's time–altitude chart: the day runs left to right (00:00 to 24:00), the Sun's arc and the Moon's (dashed) rise and set across a horizon line, with the twilight bands beneath it (civil, nautical, astronomical: −6°, −12°, −18°); a fine vertical line stands at the displayed instant, with the Sun and the Moon (drawn at its phase) where they are at that moment. Dragging anywhere on the chart, a body or the line, moves the hour: the pointer's time, pulled gently toward a detent within 8 minutes (Task 19), goes to the store, and the director's time spring carries the light there (the line and the bodies follow the light as it is shown, not the finger, so the glide is felt). Releasing within 8 minutes of sunrise, a golden hour's edge, sunset, moonrise or moonset settles there. The chart is one slider for assistive technology: its value is the hour (0–1439), its words say the time and where each body stands ("18:30. The Sun is 12° up in the west. The Moon is below the horizon."), and the keys move it (arrows five minutes, with Shift or Page Up/Down an hour, Home and End the day's ends, N for now). Its ticks, labels and colours follow the walk's palette and the product experience brief: quiet colour-change hovers, a small press, a visible brass focus ring, plain words. Under reduced motion nothing in the clock animates; the light cross-fades (Task 5). The displayed instant arrives at up to 60 updates a second through the director's channel and is written straight to the SVG's attributes (no React render per frame), so dragging stays at 60 fps.

Verified (7 October; re-read 8 October): R1b plan lines 9762–9813 (`LightControl.tsx`: `useId`, `LABELS`, the radio group, the Time and Date rows, `ActivityStatus`) and 9814 onward (`.css`, the palette variables), 9665–9761 (its tests: `import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";`) as Task 6 changed them (Task 6 leaves the preset assertion `expect(screen.getAllByRole("radio")…).toEqual(["live", …])`, which this task's lamp radios would break: finding B12); R1c Task 21 Step 4 (the walls status) and R1c's `LightControl-skins.test.tsx`; the repo's lint (`restrict-template-expressions` refuses a number in a template, `no-unnecessary-condition` refuses an optional call of a method the DOM types declare: finding B8) and happy-dom 20.9's `Element.setPointerCapture`/`releasePointerCapture` (`lib/nodes/element/Element.js:809,828`); R1c's interface item 7 (`hiddenToggles`, `setToggleHidden(toggle: 1 | 2, hidden: boolean)`; the clutter hidden and the cabinet shown by default); `.claude/conventions/product-experience.md` and `.claude/conventions/loading-and-working-motion.md` (read by Task 0's prerequisites); this plan's Tasks 6, 9 and 19.

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
    // 31 May 2026's sunset is at 21:49 BST (1309.22 min; moonrise is 23:04, 1384.4 min): released 4 minutes away, it settles there.
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

In `packages/web/src/components/rooms/__tests__/LightControl.test.tsx`, add `within` to its import from `@testing-library/react`; replace Task 6's preset assertion (this task adds the lamps' three radios to the control, so an unscoped query would find nine: finding B12)

```tsx
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["live", "captured", "night", "moonlit", "sunny", "overcast"]);
```

with:

```tsx
    const presets = within(screen.getByRole("group", { name: "Light" })).getAllByRole("radio");
    expect(presets.map((radio) => radio.getAttribute("value"))).toEqual(["live", "captured", "night", "moonlit", "sunny", "overcast"]);
```

replace (as Task 6 left them):

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
  return `M${cx.toFixed(1)} ${(cy - radius).toFixed(1)} A${String(radius)} ${String(radius)} 0 0 1 ${cx.toFixed(1)} ${(cy + radius).toFixed(1)} A${rx.toFixed(2)} ${String(radius)} 0 0 ${String(sweep)} ${cx.toFixed(1)} ${(cy - radius).toFixed(1)}Z`;
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
    event.currentTarget.setPointerCapture(event.pointerId);
    move(detentPull(pointerMinutes(event), detents));
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (dragging.current) move(detentPull(pointerMinutes(event), detents));
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    move(snapToDetent(pointerMinutes(event), detents));
    event.currentTarget.releasePointerCapture(event.pointerId);
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
  // R1c Task 21: the walls' loading status, kept (finding B11).
  const skins = useLightSettingStore((state) => state.skins);
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
      {status === "ready" && skins.status === "loading" && (
        <ActivityStatus className="light-control__status" {...(skins.progress === null ? {} : { progress: skins.progress })}>
          Preparing the walls…
        </ActivityStatus>
      )}
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

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/rooms/__tests__/LightControl-skins.test.tsx`
Expected: PASS at its count after R1c (the walls' status, kept).

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
- Create: `tools/relight/relight/nightcal.py`, `tools/relight/tests/test_nightcal.py`, `packages/web/scripts/gpu-lock.mjs`, `packages/web/scripts/gpu-lock-check.mjs`, `packages/web/scripts/cinematic-calibrate.mjs`
- Modify: `tools/relight/relight/__main__.py` (register `night-calibration`), `packages/web/src/lib/relight/light-director.ts` (eye hold, lamp solo, the latest measurement, the calibration in use, the session's director), `packages/web/src/lib/relight/relight-debug.ts` (the calibration controls)
- Test: `tools/relight/tests/test_nightcal.py` (create), `packages/web/src/lib/relight/__tests__/light-director.test.ts`, `packages/web/src/lib/relight/__tests__/relight-debug.test.ts` (modify)
- Outputs (D:): `D:/claude/relight/grand-hall/renders/R1d_night_{all,rest,cove,ch_end,ch_centre,dome}/<station>@2x.png` and `renders/R1d_captured/<station>@2x.png`, `D:/claude/relight/grand-hall/evidence/r1d/night-basis-held.json`, `D:/claude/relight/grand-hall/work/eye-anchors.json` (only when its gate passes) and `evidence/r1d/eye-anchors.json`, `D:/claude/relight/grand-hall/work/night-calibration.json` (only when accepted) and `evidence/r1d/night-calibration.json`, `D:/claude/relight/grand-hall/verify/r1d/night-calibration-run{1,2}.json`; then the cinematic package rebuilt (Task 3's command, twice).

**Interfaces:**
- Consumes: Task 3 (`cinematic.night_gains`, `cinematic.eye_anchors`, the `cinematic` command), Task 9 (`LightDirector`, its `tick`, `publisher`, `wake`), Task 13 (the measurement), Tasks 5–6 (`EyeTarget`, `FrameMeasurement`, `LuminanceCalibration`, `CAPTURE_CALIBRATION`, `adaptationLuminance`, `scotopicAmount`, `lightChroma`, `LampDrives`, `lampTargets`); R1b's `window.__roomViewCapture`, `window.__roomWalk`, `window.__relight` (`state`; the drivers select through this task's controls, finding NB1), `useLightSettingStore` (`selectPreset`, `setMinutes`, `setDate`), `applicationForChoice`, `defaultChoice`, `relight-verify.mjs`'s lock and capture helpers, `browsercheck.py` (`NIGHT_STATIONS`, `prepare`) and the proof's `07_compare` (`photo`, `render`, `valid_mask`, `cells`, `metrics`).
- Produces (`nightcal.py`): `GAIN_RANGE = (0.25, 4.0)`, `RIDGE = 0.1`, `CELL_FRACTION = 0.7`, `KNEE_SRGB = 0.9`, `ADDITIVITY = 0.02`, `GROUP_MIN_SHARE = 0.01`, `LAMP_GROUPS`, `BASIS = ("rest", …LAMP_GROUPS)`, `JOB_PREFIX = "R1d_night_"`, `CAPTURED_JOB = "R1d_captured"`, `HELD_FILE`; `linear_to_lab(rgb)` (D65), `ciede2000(lab1, lab2)` (Sharma, Wu & Dalal 2005); `to_render_light(photo, render) -> (cells, a, b)`; `white_balanced(photo, render)` (the per-channel von Kries gain to the render's median cell); `fit_gains(photo, rest, basis, ridge=RIDGE)` (one gain per group, on the cells' luminance, as three equal channels); `normalise_gains(gains, basis)` (one scale for all); `colour_accuracy(photo, render) -> {median, p90}`; `dark_groups(basis) -> list[str]`; `additivity(cells) -> float`; `accepted(stations) -> bool`; `station_cells(cmp, view, exposure) -> dict`; `measure(cmp, photo, model) -> dict`; `run(cfg, args) -> int` (the command `night-calibration`).
- Produces (director): `LightDirector.holdEye(display: EyeTarget | null): void`, `soloLamps(group: LampGroup | "all" | "none" | null): void` (the basis renders' lamps, at gains of 1), `latestMeasurement(): FrameMeasurement | null`, `measureNext(): Promise<FrameMeasurement>` (draws frames until one drawn after the call is measured; gives up after `MEASURE_FRAME_LIMIT = 120` frames or when the director stops: finding NB3), `reapply(): Promise<void>` (applies the light again and resolves once it is applied; rejects after `REAPPLY_TIMEOUT_MS = 10_000` or when the director stops: finding NB1), getter `calibration: LuminanceCalibration`; `currentDirector(): LightDirector | null` (the director that last displayed a light; null once it stops).
- Produces (DEV, `relight-debug.ts`): `interface CinematicControls { holdEye(display: EyeTarget | null): void; soloLamps(group: LampGroup | "all" | "none" | null): void; still(): boolean; measurement(): FrameMeasurement | null; measureNext(): Promise<FrameMeasurement>; select(preset: LightPresetId, minutes?: number, date?: string): Promise<void>; reapply(): Promise<void>; adaptation(): { readonly luminance: number; readonly scotopic: number } | null; lightChroma(): readonly [number, number] | null; presetDisplay(preset: LightPresetId): DisplayParams }` (`select` sets the store as R1b's `select` does and resolves once the director has applied the choice, also when the store already held it: finding NB1); `cinematicControls(director: LightDirector | null, frame: RelightFrame): CinematicControls | null`; `RelightDebug.cinematic: CinematicControls | null` on `window.__relight` (null under `?cinematic=off`; Task 22 extends `CinematicControls`).

Spec §4.3 asks for "night colour calibration" and a photo check that gains "a colour-accuracy measure", both "never worse than the hall as captured". The night photographs of Matterport stations 43 and 45 (the proof's `cmp/photo_*`, the same R1b's photo check uses) were taken with every lamp lit. The browser renders each station with the eye held at the night's own exposure, neutral white balance and no night vision: every lamp lit, none (the rest: the street, the skyglow and any Moon through the windows), each lamp group alone at full drive (so the dimming curve, warm or LED, plays no part), and the captured light, all at R1b's 2× size into the renders folder R1b's checks read. Two things about the photographs are unknown, and the calibration is built so that neither can leak into the lamps:
- **The tone curve.** The proof's own comparison (07_compare: its masks, its 48 × 27 cells, its log-luminance r) fits the photograph's cell log luminance against the render's as a line; its slope is the tone curve's contrast. The photograph is brought into the render's light by inverting that power law per channel.
- **The camera's exposure and white balance.** The photograph's cells are first balanced per channel to the all-lamps render (a von Kries gain: the camera's white balance). Then one gain per lamp group is fitted on the cells' luminance by relative least squares (log-like, so the cells beside the bulbs do not outweigh the room), with a ridge toward 1 scaled by the normal matrix's own size, and all the gains are scaled by one number so the lamps' total luminance is unchanged. The camera's exposure and white balance therefore cancel (a test proves it), and the gains move only light between the groups (the frieze tape against the chandeliers against the dome's crests), never colour: each group keeps R1a Task 4b's fitted colour, and the package carries each gain as three equal channels (the controller's ruling L3; finding I11: per-channel gains would have replaced R1a's fitted group colours with colours fitted to two photographs).
- **No compounding.** The basis renders light the bake's own light, at gains of 1 (the director's `soloLamps`, "all" included), so a calibration rerun after an accepted one fits from the bake again rather than on top of the gains in the package.
Each solo render holds the rest too, so a group's own light is its render less the rest; the four groups and the rest must add up to the all-lamps render within 2% (median cell luminance), proving the renders are linear light (cells past the display's knee are left out). The measure is CIEDE2000 between cells (Sharma, Wu & Dalal 2005, tested on seven of their published pairs in both orders), after the camera's white balance is removed by a per-channel von Kries gain and both images are scaled so the render's 95th-percentile cell is white, reported as median and 90th percentile beside r, for the hall as captured, the uncalibrated night and the calibrated night. The fit brings each night photograph into the all-lamps render's light (the tone curve fitted against that render); for the measure, each compared render (captured, before, after) brings the photograph into its own light, as 07_compare does (finding M12). The gains are kept only if at both stations the calibrated night is no worse than the captured hall, than the uncalibrated night and than R1b's threshold (0.85 at station 43, 0.80 at 45) by r, and no worse than either by median ΔE00. Two expectations from the frontier study (§e, 8 October) frame the result. The measure stays RGB: its spectral variant worsened B/G at both stations (v1), so it is not reported as an improvement. And a residual colour error is expected, because the gains carry no colour: d1b puts the lamps' RGB-bounce error at a median ΔE00 of 3.5 (under 2,750 K tungsten; smaller near the lamps' 3,600 K, not measured), which no colourless gain can absorb, so it stays in the measure and is not a failure of the calibration. Station 45 is the tight one: in v1's cells it clears its 0.80 threshold by only 0.007 (r 0.807; station 43 0.880 against 0.85). Decision 11's rule is enforced here: a lamp group below 1% of the lamps' light in the renders is dark in the bake (R1a's fit gave the lit centre chandelier 1.4e-11), and the calibration is refused, naming it, until the bake refits; gains never paper over a lost lamp. A refusal leaves the gains at 1 and writes only the evidence.

The eye's anchors are measured at the walk's own starting view: for the sunny morning, the lamp-lit night and the moonlit night, the eye is held at that preset's calibrated display (R1b's `applicationForChoice` at the preset's own hour; the moonlit key, A7) and the composer's measurement (Task 13, the frame's light before the eye) and the light's chroma are recorded. The frontier study's gate is checked here: the lamp-lit night's adaptation luminance (2^λ × 121.8 cd/m², the calibration in use; the study's d3 puts the proof's night at 8.7–11.4 cd/m² by it, where the withdrawn 54 would have read 3.9–5.0 and failed in two of three views) must give no night vision at all (at or above 5 cd/m²), and the moonlit night's must be dimmer and give some. A miss is reported with the numbers (the calibration's ±1 stop is the likely cause), never tuned away, and the anchors are not written for the package; the eye then keeps its fallback. (This gate is what turns decision 4's "no night vision for the lamp-lit night" from a 0.8–1.6-stop margin into a measured fact: finding A-M8.) A still hall draws no frame and so measures nothing, so the driver asks the director for frames until one drawn after the light settled is measured (`measureNext`; finding I10), which gives up after `MEASURE_FRAME_LIMIT` frames rather than polling for ever (finding NB3). The drivers select through the controls' own `select`, which has the director apply the choice even when the store already held it (R1b's `select` waits for an apply that such a selection never brings: a page opened at `?light=night` and asked for the night would wait for ever), bound every wait in the page, and close the browser after a run limit, so a hung run fails and frees the GPU lock (finding NB1).

Verified (7 October; R1b's lines re-read on 8 October): R1b plan lines 10836 (`RoomViewCaptureRequest { position, target, fov, width, height }`), 10892 and 11514 (`window.__roomViewCapture(request)` resolves a `NativeCurrentViewCapture` whose `dataUrl` the driver writes), 10258–10261 (`RelightDebug`: `state`, `select(preset, minutes?, date?)`), 10128–10146 (`relight-debug.ts`'s imports: `applicationForChoice`, `PRESET_DEFAULTS`, `PRESET_DISPLAY`, `type LightPresetId`, `type DisplayParams`, `type RelightFrame`; no `defaultChoice` yet), 10512–10576 (`installRelightDebug(frame, host, renderer)`, its `select,` member at 10574, resolving after the next apply and two frames), 10730 (`window.__relight = debug`), 6165–6166 (`applicationForChoice(…, defaultChoice("night"), …).display` equals `PRESET_DISPLAY.night`), 11144 (`NIGHT_STATIONS = {"mp43_night_end": 0.85, "mp45_night_windows": 0.80}`), 11243 (`photo_report`: `cmp.photo`, `cmp.render`, `cmp.valid_mask`, `cmp.cells`, `cmp.metrics`, cells with fraction > 0.7), 11370–11394 (`prepare(cfg)`; `importlib.import_module("07_compare")` once `python -m relight` has made the proof importable), 11413 (`from . import browsercheck  # noqa: E402`), 11447–11521 (`relight-verify.mjs`: `BASE_URL` 5192, `ROOT`, `VIEWS`, `WIDTH`/`HEIGHT`/`SCALE` 1920 × 1080 × 2, `takeLock` at 11458 with its hour limit, `releaseLock`, the captures writing `<ROOT>/renders/<job>/<view>@2x.png`), 11555 (headed Chromium, its background flags and `--enable-webgpu-developer-features`, which this driver passes too: finding I8); `tools/relight/proof/07_compare.py:30-35` (`render`: the `@2x` render box-averaged to 1× by `one_x`), `:37-42` (`photo`), `:45-50` (`valid_mask`: the A_mask render's red and green below 0.05, each sRGB's max in (0.03, 0.98)), `:53-57` (`cells`, 48 × 27, with each cell's valid fraction), `:60-69` (`metrics`: r of the cells' log2 luminance; `np.polyfit(lm, lp, 1)`, the tone curve's slope); `D:/claude/real-hall/renovation/relight/renders/A_mask/mp43_night_end.png` and `work/cmp/photo_mp43_night_end.png` (1920 × 1080; R1b's `prepare` copies both); this plan's Task 3 (`night_gains`: calibrated whenever the file exists; `eye_anchors` reads `{ anchors: { day, lamps, moon: { exposure, whiteBalance, logLuminance, logChroma } } }`), Task 5 (`LightMotion.current`: the eye in log2, so exposures 2 and 4 are exact), Task 9 (`publisher`, `publish`, `private measurement`, `private wake()`, the `tick` lines replaced below), Task 13 (the measurement: the output's luminance over the exposure in force, every third frame). The calibration code and its tests below were run on 7 October and, revised to one gain per group, again on 8 October (`C:/Python313/python.exe`, a scratch copy with a stand-in `browsercheck`, `plan-amendments-0710/fix2-scratch-d/py21`): the 10 tests pass, CIEDE2000 reproduces Sharma's pairs to four decimals both ways, and a synthetic night (four coloured groups with true gains 1.3, 0.85, 1.1 and 0.9, a power-law tone curve of slope 0.8, a camera tint [1.1, 1, 0.85] at exposure 1.6, 8-bit renders and photograph) recovered the slope as 0.805, added up within 0.7%, recovered each group's normalised gain within 0.04 (the ridge's pull toward 1) and lowered the median ΔE00 from 1.97 to 0.90.

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
        # One gain per group (ruling L3): it scales the group's light and never its colour.
        self.truth = {"cove": 1.2, "ch_end": 0.9, "ch_centre": 1.0, "dome": 1.1}
        self.photo = self.rest + sum(self.truth[g] * self.basis[g] for g in N.LAMP_GROUPS)

    def test_recovers_one_gain_per_group_of_a_noiseless_night(self):
        gains = N.fit_gains(self.photo, self.rest, self.basis, ridge=1e-12)
        for g in N.LAMP_GROUPS:
            np.testing.assert_allclose(gains[g], [self.truth[g]] * 3, atol=1e-6)

    def test_the_ridge_pulls_toward_one_and_the_range_holds(self):
        def spread(gains):
            return sum((gains[g][0] - 1.0) ** 2 for g in N.LAMP_GROUPS)

        loose = N.fit_gains(self.photo, self.rest, self.basis, ridge=1e-12)
        middle = N.fit_gains(self.photo, self.rest, self.basis, ridge=1.0)
        tight = N.fit_gains(self.photo, self.rest, self.basis, ridge=100.0)
        self.assertLessEqual(spread(middle), spread(loose) + 1e-12)
        self.assertLessEqual(spread(tight), spread(middle) + 1e-12)
        self.assertLess(spread(tight), 1e-3)
        clamped = N.fit_gains(self.photo * 100.0, self.rest, self.basis, ridge=1e-12)
        self.assertTrue(all(N.GAIN_RANGE[0] <= v <= N.GAIN_RANGE[1] for g in N.LAMP_GROUPS for v in clamped[g]))

    def test_a_cameras_exposure_and_white_balance_cancel_and_never_recolour_a_group(self):
        tint = np.array([2.0 * 1.2, 2.0, 2.0 * 0.8])
        np.testing.assert_allclose(N.white_balanced(self.photo * tint, self.photo), self.photo, rtol=1e-12)
        for gain in N.normalise_gains({g: [2.0] * 3 for g in N.LAMP_GROUPS}, self.basis).values():
            np.testing.assert_allclose(gain, [1.0, 1.0, 1.0], rtol=1e-12)
        gains = N.normalise_gains(N.fit_gains(self.photo * 2.0, self.rest, self.basis, ridge=1e-12), self.basis)
        self.assertTrue(all(gain[0] == gain[1] == gain[2] for gain in gains.values()))
        light = {g: float((self.basis[g] @ N.LUMINANCE).sum()) for g in N.LAMP_GROUPS}
        self.assertAlmostEqual(sum(gains[g][0] * light[g] for g in N.LAMP_GROUPS), sum(light.values()), places=9)

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

In `packages/web/src/lib/relight/__tests__/light-director.test.ts`, add `MEASURE_FRAME_LIMIT` and `currentDirector` to its import from `../light-director.js` and append inside its `describe`:

```ts
  it("holds the eye where the calibration asks, lights one group alone, measures on demand and names the session's director (Task 21)", async () => {
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
    // A still hall draws nothing: measureNext asks for frames until one drawn after the call is measured (finding I10).
    const next = director.measureNext();
    director.setMeasurement({ logLuminance: -1, at: 1e9 });
    frames(1 / 60);
    await expect(next).resolves.toEqual({ logLuminance: -1, at: 1e9 });
    director.stop();
    expect(currentDirector()).toBeNull();
  });

  it("hands the light back on demand, and bounds its DEV waits (findings NB1 and NB3)", async () => {
    useLightSettingStore.getState().selectPreset("night");
    const { director, frames, applies } = rig();
    director.start();
    frames(8);
    const before = applies.length;
    // Choosing what the store already holds applies nothing, so a driver waiting for an apply would wait for ever.
    useLightSettingStore.getState().selectPreset("night");
    frames(1);
    expect(applies).toHaveLength(before);
    const back = director.reapply();
    frames(1 / 60);
    await expect(back).resolves.toBeUndefined();
    expect(applies).toHaveLength(before + 1);
    // No composer, so no measurement: measureNext gives up after its frame limit instead of polling for ever.
    const never = director.measureNext();
    frames((MEASURE_FRAME_LIMIT + 2) / 60);
    await expect(never).rejects.toThrow(/No frame was measured/u);
    director.stop();
    await expect(director.reapply()).rejects.toThrow(/stopped/u);
    await expect(director.measureNext()).rejects.toThrow(/stopped/u);
  });
```

In `packages/web/src/lib/relight/__tests__/relight-debug.test.ts`, add `cinematicControls` to its import from `../relight-debug.js`, add the imports

```ts
import { PRESET_DISPLAY } from "../../light-setting.js";
import { useLightSettingStore } from "../../../stores/light-setting-store.js";
import { CAPTURE_CALIBRATION } from "../eye.js";
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
    // A selection the store already holds still resolves: the director applies its light again (finding NB1).
    const chosen = controls?.select("night");
    time += 1000 / 60;
    for (const callback of queue.splice(0)) callback();
    await expect(chosen).resolves.toBeUndefined();
    expect([controls?.measurement(), controls?.adaptation()]).toEqual([null, null]);
    director.setMeasurement({ logLuminance: Math.log2(10 / CAPTURE_CALIBRATION.cdPerUnit), at: 1 });
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
captured light, all at gains of 1 (the bake's own light). Each group gets one gain from them. The photographs' tone
curve and white balance are unknown:
- the comparison is the proof's own (07_compare: its masks, its 48 x 27 cells, its r), exactly as R1b's photo check;
- the photograph is brought into the render's light by inverting the power law that best maps the render's cell
  log luminance onto the photograph's (07_compare's affine fit in log2, whose slope is the tone curve's contrast);
- the photograph is balanced per channel to the all-lamps render (the camera's white balance), and one gain per
  group is fitted on the cells' luminance by relative least squares (log-like, so the cells beside the bulbs do not
  outweigh the room) with a ridge toward 1, then all are scaled by one number so the lamps' total luminance is
  unchanged: the camera's exposure and white balance cannot enter, and the gains only move light between the groups.
  Each group's colour stays R1a Task 4b's fitted colour (the controller's ruling L3).
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


def white_balanced(photo, render):
    """The photograph balanced per channel to the render: the gain that matches its median cell to the render's (a
    von Kries gain, the camera's white balance, which the lamp gains must never absorb). (N, 3) cells in and out."""
    photo, render = np.asarray(photo, np.float64), np.asarray(render, np.float64)
    return photo * (np.median(render, 0) / np.maximum(np.median(photo, 0), 1e-12))


def fit_gains(photo, rest, basis, ridge=RIDGE):
    """One gain per lamp group, on the cells' luminance: min sum_cells ((p - r - sum_g G_g b_g) / p)^2 + ridge' |G - 1|^2,
    clamped to GAIN_RANGE. A gain scales its group's light and never its colour, which stays R1a Task 4b's fitted colour
    (the controller's ruling L3). The residual is relative; ridge' = ridge x the normal matrix's mean diagonal, so the
    pull toward 1 has no units. (N, 3) cells in, the photograph in the render's light and white balance; returns
    {group: [g, g, g]} (the package's three equal channels, Task 3)."""
    p = np.asarray(photo, np.float64) @ LUMINANCE
    r = np.asarray(rest, np.float64) @ LUMINANCE
    weight = 1.0 / np.maximum(p, 1e-6)
    A = np.stack([np.asarray(basis[g], np.float64) @ LUMINANCE for g in LAMP_GROUPS], 1) * weight[:, None]
    b = (p - r) * weight
    normal = A.T @ A
    strength = ridge * float(np.trace(normal)) / len(LAMP_GROUPS)
    x = np.clip(np.linalg.solve(normal + strength * np.eye(len(LAMP_GROUPS)), A.T @ b + strength), *GAIN_RANGE)
    return {g: [float(x[i])] * 3 for i, g in enumerate(LAMP_GROUPS)}


def normalise_gains(gains, basis):
    """Scale every group's gain by one number so the lamps' total luminance over the cells is unchanged: the camera's
    exposure cancels, and the gains only move light between the groups, never colour. Clamped to GAIN_RANGE."""
    light = np.array([float((np.asarray(basis[g], np.float64) @ LUMINANCE).sum()) for g in LAMP_GROUPS])
    G = np.array([gains[g][0] for g in LAMP_GROUPS], np.float64)
    out = np.clip(G * (light.sum() / max(float((light * G).sum()), 1e-30)), *GAIN_RANGE)
    return {g: [float(out[i])] * 3 for i, g in enumerate(LAMP_GROUPS)}


def colour_accuracy(photo, render):
    """CIEDE2000 between cells after the camera's white balance is removed (the per-channel gain that matches the
    photograph's median cell to the render's) and both are scaled so the render's 95th-percentile cell luminance is
    white (L* 100). (N, 3) cells, the photograph already in the render's light; returns the median and 90th percentile."""
    photo, render = np.asarray(photo, np.float64), np.asarray(render, np.float64)
    balanced = white_balanced(photo, render)
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
    """07_compare's r of the cells and the colour accuracy, the photograph brought into this compared render's own
    light (the fit itself uses the all-lamps render's: run)."""
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
    # Each photograph in the all-lamps render's light and white balance (the basis is rendered at gains of 1).
    photos = [white_balanced(to_render_light(c["photo"], c["all"])[0], c["all"]) for c in cells.values()]
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

- [ ] **Step 4: The director's calibration controls** — in `packages/web/src/lib/relight/light-director.ts`, directly after `export const SKY_READ_INTERVAL_MS = 250;` add:

```ts
/** DEV: how long `reapply` waits for the director to apply its light (finding NB1). */
export const REAPPLY_TIMEOUT_MS = 10_000;
/** DEV: frames `measureNext` draws before it gives up; the composer measures every third frame (finding NB3). */
export const MEASURE_FRAME_LIMIT = 120;
```

directly after `  private keepMoon = false;` add:

```ts
  /** DEV (Task 21): a display the eye is held at, and the lamps the calibration's basis renders light (at gains of 1). */
  private heldEye: EyeTarget | null = null;
  private solo: LampGroup | "all" | "none" | null = null;
```

directly after the `forceBothBodies` method add:

```ts
  /** DEV (Task 21): hold the display at a known eye (night vision only if given); null releases it. */
  holdEye(display: EyeTarget | null): void {
    this.heldEye = display;
    this.wake();
  }

  /**
   * DEV (Task 21): light the lamps for a basis render, at full drive and gains of 1, the bake's own light (so a rerun of
   * the calibration never compounds an accepted one): "all" every group, one group alone, "none" every lamp off; null
   * restores the switch and the package's gains.
   */
  soloLamps(group: LampGroup | "all" | "none" | null): void {
    this.solo = group;
    this.wake();
  }

  /** The composer's latest measurement (Task 13), held until the next. */
  latestMeasurement(): FrameMeasurement | null {
    return this.measurement;
  }

  /**
   * DEV (Task 21): draw frames until the composer measures one drawn after this call, and resolve with it. A still hall
   * draws no frame by itself, so a driver that only waited would wait for ever (finding I10). Without a composer (no
   * cinematic package) no frame is ever measured, so it gives up after MEASURE_FRAME_LIMIT frames, and at once when the
   * director has stopped (finding NB3).
   */
  measureNext(): Promise<FrameMeasurement> {
    const since = this.now();
    return new Promise((resolve, reject) => {
      let frames = 0;
      const poll = (): void => {
        const measured = this.measurement;
        if (measured !== null && measured.at > since) {
          resolve(measured);
          return;
        }
        if (this.unsubscribe === null) {
          reject(new Error("The light director has stopped."));
          return;
        }
        if (frames >= MEASURE_FRAME_LIMIT) {
          reject(new Error(`No frame was measured in ${String(MEASURE_FRAME_LIMIT)} frames.`));
          return;
        }
        frames += 1;
        this.invalidate();
        this.requestFrame(poll);
      };
      poll();
    });
  }

  /**
   * DEV (Tasks 21 and 23): apply the light again and resolve once it is applied. A selection the store already holds
   * changes nothing, and R1b's gpuTime applies lights of its own, so a driver hands the light back through this rather
   * than by selecting again, which would wait for an apply that never comes (finding NB1). It rejects when the director
   * has stopped or applies nothing within REAPPLY_TIMEOUT_MS.
   */
  reapply(): Promise<void> {
    if (this.unsubscribe === null) return Promise.reject(new Error("The light director has stopped."));
    this.applied = null;
    this.shownEye = null;
    return new Promise((resolve, reject) => {
      let timer: number | null = null;
      const off = this.onLight(() => {
        off();
        if (timer !== null) this.clearTimer(timer);
        resolve();
      });
      timer = this.setTimer(() => {
        off();
        reject(new Error(`The light director applied nothing within ${String(REAPPLY_TIMEOUT_MS)} ms.`));
      }, REAPPLY_TIMEOUT_MS);
      this.wake();
    });
  }

  /** The luminance calibration in use: the cinematic package's, or the capture's. */
  get calibration(): LuminanceCalibration {
    return this.cinematic?.calibration ?? CAPTURE_CALIBRATION;
  }
```

add `type LampGroupLight` to its import from `../light-setting.js`; directly after the function `currentDisplayedLight` add:

```ts
/** The lamps' light at gains of 1: the bake's own (the calibration's basis renders, Task 21). */
function unitGains(lamps: LampLight): LampLight {
  const unit = (group: LampGroup): LampGroupLight => ({ ...lamps.groups[group], gain: [1, 1, 1] });
  return { groups: { cove: unit("cove"), ch_end: unit("ch_end"), ch_centre: unit("ch_centre"), dome: unit("dome") } };
}
```

and

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
    const lamps: LampDrives = solo === null ? switched : solo === "all" ? ALL_LAMPS_ON : {
      cove: solo === "cove" ? 1 : 0, ch_end: solo === "ch_end" ? 1 : 0, ch_centre: solo === "ch_centre" ? 1 : 0, dome: solo === "dome" ? 1 : 0,
    };
```

in the same `tick`, replace `frame.lamps, this.cinematic?.lamps ?? STEADY_LAMPS, extras);` (the end of the `lightForSky` call) with `frame.lamps, solo === null ? this.cinematic?.lamps ?? STEADY_LAMPS : unitGains(this.cinematic?.lamps ?? STEADY_LAMPS), extras);`,

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
  /** The basis renders' lamps at full drive and gains of 1 ("all", one group, "none"); null restores the switch and gains. */
  soloLamps(group: LampGroup | "all" | "none" | null): void;
  /** True when the director has nothing left to move. */
  still(): boolean;
  /** The composer's latest measurement of the frame's light (Task 13); null before the first. */
  measurement(): FrameMeasurement | null;
  /** Draws frames until one drawn after the call is measured; resolves with it (a still hall draws none by itself). */
  measureNext(): Promise<FrameMeasurement>;
  /**
   * A choice, set as R1b's `select` sets it, resolved once the director has applied it: also when the store already
   * held it (a page opened with `?light=night` asked for the night), where R1b's `select` would wait for ever (finding NB1).
   */
  select(preset: LightPresetId, minutes?: number, date?: string): Promise<void>;
  /** Hands the light back to the director after something else applied one (R1b's gpuTime); resolves once it has. */
  reapply(): Promise<void>;
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
    measureNext: () => director.measureNext(),
    select: async (preset, minutes, date) => {
      const store = useLightSettingStore.getState();
      store.selectPreset(preset);
      if (minutes !== undefined) store.setMinutes(minutes);
      if (date !== undefined) store.setDate(date);
      await director.reapply();
    },
    reapply: () => director.reapply(),
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

- [ ] **Step 6: The GPU lock, and the calibration driver** — every R1d driver takes the build PC's GPU lock through one module, which frees it on every way a run can end: a normal end, an uncaught exception or rejection (the frame budget's started samples once left one behind: the final re-review's M1), Ctrl-C and the other signals Node can catch, and `process.exit`. Only a hard kill can leave it, and its owner, time and process id are written in it. Create `packages/web/scripts/gpu-lock.mjs`:

```js
import { readFileSync, rmSync } from "node:fs";
import { open, readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// The build PC's GPU lock for R1d's drivers (T-639; the plan's Global Constraints): taken exclusively, waited for while
// another owner holds it, and released on every way out of the process: a normal end, an uncaught exception or
// rejection, Ctrl-C and the other signals Node can catch, and process.exit (final re-review M1). Only a hard kill
// (Task Manager, SIGKILL, a power cut) can leave it behind; its owner, time and process id are written in it.
// `node scripts/gpu-lock-check.mjs` proves each path against a temporary lock file.
// ---------------------------------------------------------------------------

export const GPU_LOCK = process.env.GPU_LOCK_PATH ?? "D:/claude/visual-firstprinciples-20260928/gpu.lock";
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Take the lock for `owner`, waiting up to `waitMs` while another owner holds it, and return `{ release }`. The release,
 * and the handlers that run it on every other exit, remove the lock only while it still names this owner.
 */
export async function holdGpuLock(owner, { path = GPU_LOCK, waitMs = 3_600_000, pollMs = 30_000 } = {}) {
  for (let waited = 0; ; waited += pollMs) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ owner, since: new Date().toISOString(), pid: process.pid }));
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = await readFile(path, "utf8").catch(() => "?");
      if (waited >= waitMs) throw new Error(`The GPU lock is still held after ${waitMs / 60_000} minutes: ${holder}`);
      console.log(`waiting for the GPU lock: ${holder}`);
      await sleep(pollMs);
    }
  }
  let held = true;
  // Synchronous, so it also runs inside the "exit" event, where nothing asynchronous completes.
  const releaseNow = () => {
    if (!held) return;
    held = false;
    try {
      if (readFileSync(path, "utf8").includes(JSON.stringify(owner))) rmSync(path, { force: true });
    } catch {
      // Already gone.
    }
  };
  const onSignal = (signal) => { releaseNow(); process.exit(signal === "SIGINT" ? 130 : 143); };
  const onFatal = (error) => { console.error(error); releaseNow(); process.exit(1); };
  process.on("exit", releaseNow);
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", onFatal);
  for (const signal of SIGNALS) process.on(signal, onSignal);
  return {
    release() {
      releaseNow();
      process.off("exit", releaseNow);
      process.off("uncaughtException", onFatal);
      process.off("unhandledRejection", onFatal);
      for (const signal of SIGNALS) process.off(signal, onSignal);
    },
  };
}
```

create `packages/web/scripts/gpu-lock-check.mjs`, which proves each exit path in its own process against a temporary lock file (never the build PC's own):

```js
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { holdGpuLock } from "./gpu-lock.mjs";

// ---------------------------------------------------------------------------
// Proves that a driver frees the GPU lock on every way it can end (T-639 R1d; final re-review M1). Each scenario runs
// in its own Node process against a temporary lock file, never the build PC's own lock:
//
//   node scripts/gpu-lock-check.mjs        (prints one line per exit path; exits 1 if any left the lock behind)
//
// Signals are raised with process.emit, which runs the same handlers a real Ctrl-C or SIGTERM does; Windows cannot
// deliver a catchable SIGTERM to another process, and nothing can catch a hard kill.
// ---------------------------------------------------------------------------

const forever = () => new Promise(() => undefined);
const later = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const SCENARIOS = {
  "released at the end": async (lock) => { lock.release(); },
  "ended without a release": async () => undefined,
  "a sample rejecting while finally closes the browser (the budget driver's shape)": async (lock) => {
    const sample = new Promise((_resolve, reject) => { setTimeout(() => { reject(new Error("the sample's page closed")); }, 20); });
    try {
      throw new Error("the drag failed");
    } finally {
      await later(200);
      lock.release();
      await sample;
    }
  },
  "a hung step ended by the watchdog": async (lock) => {
    let end = () => undefined;
    const step = new Promise((_resolve, reject) => { end = reject; });
    const watchdog = setTimeout(() => { end(new Error("Target page, context or browser has been closed")); }, 20);
    try {
      await step;
    } catch {
      // The run fails; its finally frees the lock.
    } finally {
      clearTimeout(watchdog);
      lock.release();
    }
  },
  "an unhandled rejection": async () => { void Promise.reject(new Error("left without a handler")); await forever(); },
  "an uncaught exception": async () => { setTimeout(() => { throw new Error("thrown from a timer"); }, 10); await forever(); },
  "process.exit": async () => { process.exit(3); },
  "SIGINT (Ctrl-C)": async () => { process.emit("SIGINT", "SIGINT"); await forever(); },
  SIGTERM: async () => { process.emit("SIGTERM", "SIGTERM"); await forever(); },
  "SIGHUP (the console closed)": async () => { process.emit("SIGHUP", "SIGHUP"); await forever(); },
};

if (process.argv[2] === "--child") {
  const [, , , name, path] = process.argv;
  const lock = await holdGpuLock("gpu-lock-check", { path, waitMs: 0, pollMs: 10 });
  if (existsSync(path)) console.log("held");
  await SCENARIOS[name](lock);
} else {
  const folder = mkdtempSync(join(tmpdir(), "gpu-lock-check-"));
  const self = fileURLToPath(import.meta.url);
  const names = Object.keys(SCENARIOS);
  let failed = 0;
  for (const name of names) {
    const path = join(folder, "gpu.lock");
    const child = spawn(process.execPath, [self, "--child", name, path], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", () => undefined);
    const hang = setTimeout(() => { child.kill(); }, 15_000);
    const code = await new Promise((resolve) => { child.on("exit", (exitCode) => { resolve(exitCode); }); });
    clearTimeout(hang);
    const ok = out.includes("held") && !existsSync(path);
    if (!ok) failed += 1;
    console.log(`${ok ? "released" : "LEFT BEHIND"}  ${name} (exit ${code})`);
    rmSync(path, { force: true });
  }
  rmSync(folder, { recursive: true, force: true });
  console.log(`gpu-lock check: ${names.length - failed} of ${names.length} exit paths released the lock`);
  process.exitCode = failed === 0 ? 0 : 1;
}
```

and create `packages/web/scripts/cinematic-calibrate.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { holdGpuLock } from "./gpu-lock.mjs";

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
const OWNER = "cinematic-calibrate (T-639 R1d)";
const STATIONS = ["mp43_night_end", "mp45_night_windows"];
/** Each basis render and the lamps it lights, at gains of 1 (the bake's own light, so a rerun never compounds). */
const SOLO = { all: "all", rest: "none", cove: "cove", ch_end: "ch_end", ch_centre: "ch_centre", dome: "dome" };
const ANCHORS = [["day", "sunny"], ["lamps", "night"], ["moon", "moonlit"]];
const WIDTH = 1920, HEIGHT = 1080, SCALE = 2;
const LOAD_TIMEOUT_MS = 240_000;
const SETTLE_TIMEOUT_MS = 30_000;
/** One step in the page (a selection, a capture, a check) must finish within this. */
const STEP_TIMEOUT_MS = 180_000;
/** The whole run: past it the watchdog closes the browser, which ends every wait, so the GPU lock is never held for ever. */
const RUN_LIMIT_MS = 40 * 60_000;

/** A promise bounded in time: a hang becomes an error naming the step, and main's finally frees the GPU lock (finding NB1). */
function within(promise, what, ms = STEP_TIMEOUT_MS) {
  let timer;
  const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`${what} did not finish within ${ms / 1000} s.`)); }, ms); });
  return Promise.race([promise, limit]).finally(() => { clearTimeout(timer); });
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

/** The director still, then one measurement of a frame drawn after it settled (a still hall draws none by itself). */
async function settle(page) {
  await page.waitForFunction(() => window.__relight?.cinematic?.still() === true, undefined, { timeout: SETTLE_TIMEOUT_MS });
  await within(page.evaluate((ms) => Promise.race([
    window.__relight.cinematic.measureNext(),
    new Promise((_resolve, reject) => { setTimeout(() => { reject(new Error("No frame was measured.")); }, ms); }),
  ]), SETTLE_TIMEOUT_MS), "A measurement of the settled frame", SETTLE_TIMEOUT_MS + 10_000);
}

async function capture(page, view, job) {
  const folder = join(ROOT, "renders", job);
  await mkdir(folder, { recursive: true });
  const dataUrl = await within(page.evaluate(async (request) => (await window.__roomViewCapture(request)).dataUrl,
    { position: view.pos, target: view.tgt, fov: view.fov, width: WIDTH * SCALE, height: HEIGHT * SCALE }), `The capture of ${view.name}`);
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
  // The lock is freed on every way this run can end (gpu-lock.mjs), not only by the finally below.
  const lock = await holdGpuLock(OWNER);
  let browser = null;
  // The watchdog: a run that hangs anyway is ended by closing the browser, and the finally below frees the GPU lock.
  const watchdog = setTimeout(() => { console.error(`${OWNER}: stopped after ${RUN_LIMIT_MS / 60_000} minutes.`); void browser?.close().catch(() => undefined); }, RUN_LIMIT_MS);
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion", "--enable-webgpu-developer-features"],
    });
    const page = await openWalk(browser);
    // The night at its own hour, applied by the director although the query already chose it: R1b's `select` waits
    // for an apply that a selection changing nothing never brings (finding NB1).
    await within(page.evaluate(() => window.__relight.cinematic.select("night")), "Selecting the night");
    const night = await page.evaluate(() => window.__relight.cinematic.presetDisplay("night"));
    const held = { exposure: night.exposure, whiteBalance: [1, 1, 1], scotopic: 0 };
    await page.evaluate((display) => { window.__relight.cinematic.holdEye(display); }, held);
    for (const [name, group] of Object.entries(SOLO)) {
      await page.evaluate((solo) => { window.__relight.cinematic.soloLamps(solo); }, group);
      await settle(page);
      for (const view of stations) await capture(page, view, `R1d_night_${name}`);
    }
    await page.evaluate(() => { window.__relight.cinematic.soloLamps(null); window.__relight.cinematic.holdEye(null); });
    await within(page.evaluate(() => window.__relight.cinematic.select("captured")), "Selecting the captured light");
    await settle(page);
    for (const view of stations) await capture(page, view, "R1d_captured");
    await mkdir(join(ROOT, "evidence", "r1d"), { recursive: true });
    await writeFile(join(ROOT, "evidence", "r1d", "night-basis-held.json"), JSON.stringify({ exposure: held.exposure }, null, 1));

    // The eye's anchors: each preset at its own hour, the eye held at its calibrated display without night vision.
    const anchors = {}, adaptation = {};
    for (const [anchor, preset] of ANCHORS) {
      await within(page.evaluate((name) => window.__relight.cinematic.select(name), preset), `Selecting ${preset}`);
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
    clearTimeout(watchdog);
    try {
      if (browser !== null) await within(browser.close(), "Closing the browser", 60_000);
    } finally {
      lock.release();
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 7: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_nightcal -v`
Expected: PASS, 10 tests.

Run, one per command: `src/lib/relight/__tests__/light-director.test.ts` (Expected: PASS, 12 tests), `src/lib/relight/__tests__/relight-debug.test.ts` (Expected: PASS, the Task 0 count plus 1).

Run: `node scripts/gpu-lock-check.mjs` (from `packages/web`)
Expected: one `released` line for each of the 10 exit paths, then `gpu-lock check: 10 of 10 exit paths released the lock`, exit 0. (Checked 8 October with this code: 10 of 10; with the module's exit handlers removed, 2 of 10, the frame budget's failure among them.)

Run: `pnpm --filter @omnitwin/web exec eslint src/lib/relight/light-director.ts src/lib/relight/relight-debug.ts` and `node --check scripts/gpu-lock.mjs`, `node --check scripts/gpu-lock-check.mjs` and `node --check scripts/cinematic-calibrate.mjs` (from `packages/web`; the repo's ESLint parses only `src` through the TypeScript project service, so a driver is checked by Node: finding B7)
Expected: no problems; `node --check` prints nothing.

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
cd D:/claude/real-hall/repo && git add tools/relight/relight/nightcal.py tools/relight/tests/test_nightcal.py tools/relight/relight/__main__.py packages/web/scripts/gpu-lock.mjs packages/web/scripts/gpu-lock-check.mjs packages/web/scripts/cinematic-calibrate.mjs packages/web/src/lib/relight/light-director.ts packages/web/src/lib/relight/relight-debug.ts packages/web/src/lib/relight/__tests__/light-director.test.ts packages/web/src/lib/relight/__tests__/relight-debug.test.ts && git diff --cached --stat && git commit -m "feat(relight): the night calibration against the night photographs, CIEDE2000, and the eye's measured anchors (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: DEV instruments for the cinematic light

**Files:**
- Create: `packages/web/src/lib/relight/cinematic-parts.ts`
- Modify: `packages/web/src/lib/relight/sun-shadow.ts` (`cpuTaps`), `packages/web/src/lib/relight/cinematic-composer.ts` (`glare` readable; its `measure` pass is readable since Task 13), `packages/web/src/lib/relight/sun-shafts.ts` (its `fill` pass is readable since Task 14), `packages/web/src/lib/relight/relight-debug.ts` (the instruments; the word check's CPU twin with the cinematic terms), `packages/web/src/components/scene/RelightCinematic.tsx` (keeps the parts current)
- Test: `packages/web/src/lib/relight/__tests__/sun-shadow.test.ts`, `packages/web/src/lib/relight/__tests__/relight-debug.test.ts` (modify)

**Interfaces:**
- Consumes: Task 21's `CinematicControls`, `cinematicControls`, `currentDirector`; Task 10 (`SkyShadows`: `hook`, `cpu`, `lightViewFor`, `occludedFrom`, `SHADOW_PCF_SPACING`, `SHADOW_BIAS`, the private `drawn` and `box`), Task 13 (`CinematicComposer`, `Glare`, `CIE_GLARE_PIXELS_PER_DEGREE`), Task 11 (`CrispBulbs`), Task 8 (`CinematicData`), Task 7 (`RelightFrame.kernelCinematic`, `passStride`), Task 9 (`LightDirector.forceBothBodies`, `setStride`, `moving`, `lightMoving`, `current`); R1b's `relight-debug.ts` (`sample` with its `gpuKernel()`: the kernel asked with the GPU's own read-back sky light, `wordTally`, `WordCheck`, `sunRaySensitive`, `multiplierCodeDistance`, `readDisplay`'s readback pattern), `useLightSettingStore` (`selectPreset`, `setMinutes`); R1c's `RelightFrame.visibility` and `relightSplat`'s visibility argument (A2).
- Produces (`cinematic-parts.ts`): `interface CinematicParts { readonly data: CinematicData | null; readonly shadows: SkyShadows | null; readonly composer: CinematicComposer | null; readonly bulbs: CrispBulbs | null; readonly shafts: SunShafts | null }`; `updateCinematicParts(change: Partial<CinematicParts>): void`; `currentCinematicParts(): CinematicParts`.
- Produces (`sun-shadow.ts`): `SkyShadows.cpuTaps(position: Vec3, body: SkyBodyName): number` (the 16 taps' lit share on the CPU).
- Produces (`cinematic-composer.ts`): `CinematicComposer.glare` (readonly, the glow function in use).
- Produces (`relight-debug.ts`): `interface CinematicState { packaged; crispLamps; crispChandeliers; dimming; moving; lightMoving; stride; bodies: { sun; moon }; sheen; glare }` (`glare`: the composer's glow function, `"design"` or `"cie"`, null without a composer); `interface ShadowCheck { body; points; decided; disagreements }`; `interface BloomEnergyCheck { emitted; glowed; ratio }`; `GLARE_TEST_SIZE = 256`, `GLARE_TEST_BLOCK = 8`; `shadowCheckPoints(box, count): Vec3[]`; `tallyShadow(body, gpu, cpu): ShadowCheck`; `WordCheck.excusedPenumbra?: number` (R1d's own excuse, each confirmed by its splat's own GPU taps, counted apart from R1b's window-rounding `excused`: the controller's ruling N2, made exact per splat); `interface PassTimes { timing: "timestamp-query" | null; airFillMedianMs: number | null; eyeMeasureMedianMs: number | null }`; `CinematicControls` gains `state(): CinematicState`, `shadowCheck(points: number): Promise<readonly ShadowCheck[]>`, `bloomEnergy(): Promise<BloomEnergyCheck | null>`, `forceBothBodies(on: boolean): void`, `setStride(stride: number): void`, `scrubTo(minutes: number): void`, `passTimes(runs: number): Promise<PassTimes>` (the air fill's and the eye measure's GPU time, by R1b's `timedCompute`: finding I8); `cinematicControls(director, frame, renderer?)`.

Task 23 judges the cinematic light by these instruments, so each one compares the GPU with an independent twin rather than with itself:
- **The words.** R1b's `sample` check now computes the CPU twin with the frame's cinematic terms (`frame.kernelCinematic`: the glow hiding and the interior shadow), so the GPU's words are judged against the light actually shown. The interior shadow's twin casts a ray over every occluder triangle (some 10⁵), so it is cast only for a splat that differs without it; a splat that still differs and lies in an interior shadow's penumbra by the CPU's 16 taps is excused only if its own GPU taps, read back through the hook every surface uses, are neither all lit nor all shadowed for a body that counts (the edge the GPU's taps soften); otherwise it counts as the difference it is. The excuses are counted apart (`excusedPenumbra`) from R1b's window-rounding cases, which Task 23 caps by R1a's wall-face rate; each penumbra excuse is proven splat by splat, so it needs no cap of its own (the controller's ruling N2, made exact on the re-review's advice; finding B14). A splat counts as marched when either body is in, as R1b's own check counts it, so the moonlit night's words are judged too (finding B13). The CPU twin is R1b's `gpuKernel()`, the kernel asked with the GPU's own read-back sky light, so a sky ray the GPU rounds the other way moves both sides alike (seam review, item 7). R1b's `fixture` check compares with R1a's vectors, which have no cinematic terms, so Task 23 runs it with `?cinematic=off`.
- **The shadows.** At a grid of points over the hall (the floor, 5 cm up, and eye height), the GPU's 16-tap shadow is read back through a compute pass running the very hook every surface uses, and compared with the CPU twin's single ray where the GPU's taps all agree (0 or 1; Task 10).
- **The glow.** The glare in use (the design glow, or `?glare=cie`'s fitted glare) is tested on the GPU with a known emission: an 8 × 8 block of 1 at the centre of a 256 × 256 half-float texture, run through the composer's own glare into a float target and summed: the sum must equal the block's (the design pyramid's weights sum to 3 at strength 1/3; the CIE levels' normalised blurs are summed by weights over their total). Each test builds its own bloom node, so it disposes it (and its render targets) when done (finding M6).
- **The light.** The state (the package, the crisp lamps and chandeliers, each group's dimming, motion, the stride, which bodies count, the sheen weight), the both-bodies switch, the stride and a scrub that sets the store's hour without waiting, for Task 23's frame budget.
- **The new passes' GPU time.** The air fill (Task 14) and the eye measure (Task 13) run on every frame of motion; each is timed on the GPU by R1b's `timedCompute` (timestamp queries, tracking on only while it encodes and while each resolve starts: the re-review's N1), median of a series after one unrecorded run, and reported with R1b's own `gpuTime` (finding I8). Without `timestamp-query` they are reported as unmeasured, never estimated.

The session's parts (the package, the shadow maps, the composer, the lamps, the shafts) reach the instruments through a registry of types only (`cinematic-parts.ts`), kept current by `RelightCinematic`; nothing in it runs in production beyond holding five references (and the cinematic light is not in a production bundle at all: Task 9).

Verified (7 October; R1b's lines re-read on 8 October): R1b plan lines 10463–10507 (`computeTimestamps(renderer)`, `timedCompute(renderer, passes)`: tracking on while encoding and while each resolve starts, re-review N1), 10666–10728 (`gpuTime`: one unrecorded run, then `median`), 10128–10146 (`relight-debug.ts`'s imports: `Vector3`, `type Matrix4`; `StorageBufferAttribute`, `type WebGPURenderer`; `Fn`, `float`, `storage`, `uniform`, `vec3`; `useLightSettingStore`; `relightSplat`, `type KernelFrame`, `type Rgb`; `FLAG_SUN`, `multiplierCodeDistance`, `packMultiplierWord`), 10156–10166 (`interface WordCheck`), 10316–10334 (`wordTally`: excused only when marched, sensitive and more than one code apart), 10386 (`sunRaySensitive`), 10392 (`readDisplay`: a `StorageBufferAttribute` written by a compute pass and read with `renderer.getArrayBufferAsync`), 10524 (`gpuKernel`), 10569–10593 (`const debug: RelightDebug = { state, select, sample, … }`; `sample`'s loop, `const tally = wordTally();`, the three lines this task replaces, `return tally.result(0);`); this plan's Task 10 (`SkyShadows`: `private readonly drawn`, `private readonly box`, `cpu`, `hook`; `lightViewFor` builds the camera with `lookAt`, so its world matrix's first two columns are the map's right and up; the taps at `(i − 1.5, j − 1.5) × SHADOW_PCF_SPACING`, j down the map), Task 13 (`private readonly glare: Glare`; `designGlare`, `cieGlare`, each `spread` with its own `dispose`; the emission target is `HalfFloatType`), Task 21 (`cinematicControls(director, frame)`, the `get cinematic()` member); three 0.186 `src/renderers/common/Renderer.js:3225` (`readRenderTargetPixelsAsync(renderTarget, x, y, width, height, textureIndex = 0, faceIndex = 0)`) and `:2097` (`getArrayBufferAsync`), `src/Three.Core.js:160` (`DataUtils`), `src/extras/DataUtils.js:150` (`toHalfFloat`), `src/textures/DataTexture.js`, `src/core/RenderTarget.js:54`, `QuadMesh` (as Task 13 uses it), `src/math/Matrix4.js:239` (`extractBasis(xAxis, yAxis, zAxis)`).

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
      bulbs: [{ id: "c2_b00", group: "ch_centre", kind: "candle", chandelier: 2, position: [8.9, -5, 5.5], intensity: 0.02 }],
      glow: FIXTURE_CENTRES.map((centre, id) => ({ centre, crisp: id === 2 })),
    });
    updateCinematicParts({ data });
    const state = cinematicControls(director, frame)?.state();
    expect(state).toMatchObject({ packaged: true, crispLamps: 1, crispChandeliers: [2], stride: 1, bodies: { sun: false, moon: false }, sheen: 0, glare: null });
    expect(state?.dimming).toEqual({ cove: "warm", ch_end: "warm", ch_centre: "warm", dome: "warm" });
    updateCinematicParts({ data: null });
    expect(cinematicControls(director, frame)?.state()).toMatchObject({ packaged: false, crispLamps: 0, crispChandeliers: [], dimming: null, glare: null });
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
import type { SunShafts } from "./sun-shafts.js";
import type { SkyShadows } from "./sun-shadow.js";

/**
 * The session's cinematic parts, for the DEV instruments (T-639 R1d Task 22). RelightCinematic keeps it current;
 * it holds references only.
 */
export interface CinematicParts {
  readonly data: CinematicData | null;
  readonly shadows: SkyShadows | null;
  readonly composer: CinematicComposer | null;
  readonly bulbs: CrispBulbs | null;
  readonly shafts: SunShafts | null;
}

let parts: CinematicParts = { data: null, shadows: null, composer: null, bulbs: null, shafts: null };

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
    updateCinematicParts({ data, shadows, composer, bulbs, shafts });
    return () => { updateCinematicParts({ data: null, shadows: null, composer: null, bulbs: null, shafts: null }); };
  }, [data, shadows, composer, bulbs, shafts]);
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

In `packages/web/src/lib/relight/cinematic-composer.ts`, replace `  private readonly glare: Glare;` with:

```ts
  /** The glare in use (the design glow, or the fitted CIE glare; decision 6). */
  readonly glare: Glare;
```

- [ ] **Step 5: The instruments** — in `packages/web/src/lib/relight/relight-debug.ts`, merge into its imports: `DataTexture`, `DataUtils`, `FloatType`, `HalfFloatType`, `LinearFilter`, `RGBAFormat`, `RenderTarget` from `three`; `MeshBasicNodeMaterial` and `QuadMesh` from `three/webgpu`; `If`, `instanceIndex`, `texture`, `uint` and `vec4` from `three/tsl`; and add:

```ts
import { currentCinematicParts } from "./cinematic-parts.js";
import { CIE_GLARE_PIXELS_PER_DEGREE, type Glare } from "./cinematic-composer.js";
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
  /** The composer's glow function (`?glare=cie` gives "cie"); null without a composer. */
  readonly glare: Glare["name"] | null;
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
export interface PassTimes {
  /** How the passes were timed: timestamp queries, or null where the device has none (then nothing is measured). */
  readonly timing: "timestamp-query" | null;
  readonly airFillMedianMs: number | null;
  readonly eyeMeasureMedianMs: number | null;
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

/** The glare on a known emission: an 8 × 8 block of 1 in a half-float texture, glowed into a float target. */
async function measureGlare(renderer: WebGPURenderer, glare: Glare): Promise<BloomEnergyCheck> {
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
  // A glare's spread holds its own render targets: disposed below (finding M6). The CIE glare at its own scale.
  const glow = glare.spread(texture(emission));
  glow.setView(CIE_GLARE_PIXELS_PER_DEGREE);
  material.colorNode = vec4(glow.node.rgb, 1);
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
    glow.dispose();
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
  /** The air fill's and the eye measure's GPU time, the median of `runs` (R1b's timedCompute; nulls without timestamp-query). */
  passTimes(runs: number): Promise<PassTimes>;
```

replace Task 21's `export function cinematicControls(director: LightDirector | null, frame: RelightFrame): CinematicControls | null {` with `export function cinematicControls(director: LightDirector | null, frame: RelightFrame, renderer: WebGPURenderer | null = null): CinematicControls | null {`, and in its returned object, after the `presetDisplay` member, add:

```ts
    state: () => {
      const { data, composer } = currentCinematicParts();
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
        glare: composer?.glare.name ?? null,
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
    passTimes: async (runs) => {
      const { shafts, composer } = currentCinematicParts();
      if (renderer === null || !computeTimestamps(renderer)) return { timing: null, airFillMedianMs: null, eyeMeasureMedianMs: null };
      const timed = renderer;
      // One unrecorded run first (the pipeline and the timestamp pool), then the median, as R1b's gpuTime does.
      const medianOf = async (pass: ComputeNode | undefined): Promise<number | null> => {
        if (pass === undefined) return null;
        const times: number[] = [];
        for (let run = -1; run < Math.max(1, Math.floor(runs)); run += 1) {
          const ms = await timedCompute(timed, [pass]);
          if (run >= 0 && ms !== null) times.push(ms);
        }
        return times.length === 0 ? null : median(times);
      };
      return { timing: "timestamp-query", airFillMedianMs: await medianOf(shafts?.fill), eyeMeasureMedianMs: await medianOf(composer?.measure) };
    },
```

In `installRelightDebug`, replace Task 21's `      return cinematicControls(currentDirector(), frame);` with `      return cinematicControls(currentDirector(), frame, renderer);`. In R1b's `interface WordCheck`, directly after `  readonly sunMarched: number;` add:

```ts
  /**
   * R1d: splats more than one code apart only in an interior shadow's penumbra, by the CPU's taps and by the splat's own
   * GPU taps alike, counted apart from `excused` (ruling N2).
   */
  readonly excusedPenumbra?: number;
```

In its `sample` member, directly after `      const tally = wordTally();` add

```ts
      // R1d (ruling N2): splats the CPU's taps put in an interior shadow's penumbra, decided by their own GPU taps below.
      const penumbral: { readonly actual: number; readonly expected: number; readonly position: Vec3; readonly sensitive: () => boolean }[] = [];
```

replace the three lines (R1b's, as of 8 October)

```ts
        const { m, alpha } = relightSplat(frame.model, kernel, record, position, colour, frame.visibility);
        const marched = (kernel.windowSun !== null || kernel.moonSun !== null) && ((record[11] ?? 0) & FLAG_SUN) !== 0;
        tally.add(words[splat] ?? 0, packMultiplierWord(m, alpha), marched, () => sunRaySensitive(frame.model, kernel, position));
```

with:

```ts
        const marched = (kernel.windowSun !== null || kernel.moonSun !== null) && ((record[11] ?? 0) & FLAG_SUN) !== 0;
        const actual = words[splat] ?? 0;
        // R1d: the twin with the cinematic terms (the glow hiding, the interior shadow).
        const expected = expectedWord(frame, kernel, record, position, colour, actual);
        const sensitive = (): boolean => sunRaySensitive(frame.model, kernel, position);
        // In an interior shadow's penumbra by the CPU's taps: R1d's own excuse, decided below splat by splat (ruling N2).
        if (marched && actual >>> 24 === expected >>> 24 && multiplierCodeDistance(actual, expected) > 1 && !sensitive() && inPenumbra(kernel, position)) {
          penumbral.push({ actual, expected, position, sensitive });
          continue;
        }
        tally.add(actual, expected, marched, sensitive);
```

and replace `sample`'s `      return tally.result(0);` (the one in `sample`, not in `fixture`) with:

```ts
      // R1d's own excuse, splat by splat (ruling N2): a splat the CPU's taps put in a penumbra is excused only where its own
      // GPU taps, read through the hook every surface uses, are neither all lit nor all shadowed for a body that counts;
      // otherwise it counts as the difference it is. Counted apart from R1b's window-rounding `excused`.
      const { shadows } = currentCinematicParts();
      const taps: Float32Array[] = [];
      if (shadows !== null && penumbral.length > 0) {
        const points = penumbral.map((entry) => entry.position);
        for (const body of ["sun", "moon"] as const) {
          if ((body === "sun" ? kernel.setting.sunDir : kernel.setting.moonDir) !== null) taps.push(await readShadows(renderer, shadows, points, body));
        }
      }
      let excusedPenumbra = 0;
      penumbral.forEach((entry, index) => {
        const fractional = taps.some((lit) => { const value = lit[index] ?? 1; return value > 0 && value < 1; });
        if (fractional) excusedPenumbra += 1;
        else tally.add(entry.actual, entry.expected, true, entry.sensitive);
      });
      return { ...tally.result(0), excusedPenumbra };
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
- Outputs (D:): `D:/claude/relight/grand-hall/renders/R1d_{off_captured,cin_captured,cin_night,cin_night_cie}/<view>@2x.png`, `renders/R1d_glare_compare/<view>.png` (each night station with the design glow beside the fitted CIE glare), `D:/claude/relight/grand-hall/evidence/r1d/r1d-browser-run.json`, `evidence/r1d/light-scrub-budget.json`, `evidence/r1d/r1d-browser-checks.json`

**Interfaces:**
- Consumes: Task 21's `packages/web/scripts/gpu-lock.mjs` (`holdGpuLock`) and `gpu-lock-check.mjs`; Tasks 21–22's `window.__relight.cinematic` (`select`, `reapply`, `still`, `state` with `packaged` and `glare`, `shadowCheck`, `bloomEnergy`, `forceBothBodies`, `setStride`, `scrubTo`, `passTimes`); R1b's `window.__relight` (`state`, `fixture`, `sample` with R1d's `excusedPenumbra`, `gpuTime`; the drivers select through Task 21's controls, finding NB1), `window.__roomViewCapture`, `window.__roomWalk`, the `relight:*` performance spans (R1b's and Task 8's `CINEMATIC_SPANS`), the vectors fixture (`src/lib/relight/__fixtures__/relight-vectors.json`, with `windowRays.wallFaceRate`), `browsercheck.py` (`CAPTURED_STOPS`, `LONG_TASK_MS`, `FRAME_MS`, `SKY_BUDGET_MS`, `SKY_TIMINGS`, `NIGHT_STATIONS`, `captured_verdict`, `stop_difference`, `_views`, `_word_ok(name, v, rate)`, `_wall_face_rate`, `prepare`) and the proof's `07_compare`; Task 1's `bulbs.py` (`photo_check`, `NIGHT_VIEWS`, `GATE_CONTROL_RATIO`) and `<work>/bulbs.json`; Task 21's `nightcal.py` (`to_render_light`, `colour_accuracy`, `CELL_FRACTION`); `SkyClock` (Task 20: `role="slider"`, name "Time") and the lamps' radios ("On", "Off"); the walk's keys (`interiorMovementKey`: w, s and the arrows).
- Produces (`cinematiccheck.py`): `GLOW_REACH_PX = 48`, `SHADOW_DECIDED = 0.5`, `SHADOW_DISAGREE = 0.005`, `GLOW_TOLERANCE = 0.03`, `LAMP_HIT_SHARE = 0.9`, `DROPPED_MS = 33.4`, `MOVING_SHARE = 0.8`, `CINEMATIC_SPANS`; `identity_mask(mask_lin, *srgbs, reach=GLOW_REACH_PX)`; `shadow_verdict(checks)`; `glow_verdict(energy)`; `photo_station_verdict(station)`; `budget_verdict(scenarios)`; `GLARE_COMPARE_JOB = "R1d_glare_compare"`, `GLARE_COMPARE_GAP = 16`, `glare_compare(renders) -> list[str]`, `glare_cie_verdict(run, side_by_side)`; `loading_verdict(off, cinematic)`; `fallback_verdict(runs)`; `words_verdict(checks, rate)`; `gpu_time_verdict(time, passes)`; `identity_report`, `photo_report`, `lamps_report`; `run(cfg, args)` (the command `cinematic-check`).

What is judged, against the spec's numbers (§4.3, §4.6, §6, §7), each against an independent reference:
- **At the captured light, the hall is as captured where splats remain.** The seven proof views are rendered at the captured light with the cinematic light and with `?cinematic=off`, both with `?skins=off&floorskin=v1` (so only R1d differs), and compared in stops at every valid pixel (07_compare's mask: no view out, no fixture, nothing clipped or black) farther than 48 px (at 1×) from a fixture: the crisp lamps and their energy-conserving glow replace the captured glow there, which is what decision 1 changes. The 99th percentile must be within 1/20 stop (R1b's `CAPTURED_STOPS`), and is reported with and without the 48 px margin. The sheen is weighted to nothing at the captured light (Task 17), there are no interior shadows (no sun direction) and the eye holds the identity display (Task 9), so nothing else may differ.
- **The kernel's words.** Without the cinematic light, R1a's vectors (the captured light, the night, the sunny morning) through R1b's `fixture` check; with it, the CPU twin with the cinematic terms (Task 22) through `sample`, at the night, the sunny morning at 10:00, both bodies forced on (17 June 2026 at 11:00 BST: the Sun high in the south-east and an 8% Moon 29° up in the east, in front of the east-facing windows; R1b Task 6's `moonPosition`, R1a's `moon.py` ported, computed 7 October; the pre-flight scan's recomputation with `moon.py` on 8 October gives azimuth 92.60°, elevation 29.25°) and the moonlit night. Each is judged by R1b's own rule (`_word_ok(name, v, rate)`: within one code, alphas equal, the window-rounding excuses within twice R1a's measured wall-face rate of the marched splats, which the driver copies from the vectors as R1b's does), and R1d's own penumbra excuses, a different population, counted apart and each confirmed by its splat's own GPU taps in Task 22, so reported rather than capped: the controller's ruling N2, made exact per splat on the re-review's advice (finding B14).
- **The interior shadows.** For each body that counts at those settings, the GPU's maps against the CPU twin at about 512 points: at least half decided (all 16 taps agree) and at most 0.5% of the decided points disagreeing.
- **The glow conserves energy.** The design glow on its known block returns its energy within 3%.
- **The fitted CIE glare runs, and Blake can compare it** (decision 6; the final re-review's M5). A page at `?glare=cie` names the CIE glare in its state, returns its energy on the same known block within 3% on the GPU (Task 22's check, now through the fit's eleven levels), logs no console error, and draws the night stations; each is set beside the same station drawn with the default design glow (`renders/R1d_glare_compare/<view>.png`: design left, CIE right, at the capture's own resolution), so Blake sees both side by side.
- **The night photographs, colour included.** The calibrated night (the product as shipped: skins on, the default floor) at stations 43 and 45 against the night photographs: 07_compare's r at least R1b's threshold (0.85, 0.80) and at least the captured hall's, and the median CIEDE2000 (Task 21's measure) no worse than the captured hall's.
- **The crisp lamps stand where the bulbs are.** Each crisp lamp projected into the night renders falls within ±3 px of a near-saturated pixel at least 90% of the time among those in view, and the control points (1 m out from each chandelier's axis) at most half as often (Task 1's check, run on the renders).
- **Fallbacks** (spec §7). A missing cinematic package leaves the hall relit with no crisp lamps and exactly one `cinematic` warning; `?cinematic=off` removes the cinematic controls entirely.
- **Loading** (§4.6, "no main-thread task over 50 ms while loading"). The main-thread work the cinematic light adds is timed as spans (`measureRelight`: the package's decode, `relight:cinematic-package`, and its parts' construction, `relight:cinematic-parts`, beside R1b's own spans), read once the package is in use (`state().packaged`) and the parts have settled: every span at most 50 ms, R1d's two kinds measured, and no console warning or error the off session lacks. Long tasks are reported for information only: R1b's own pre-flight found comparing their counts between sessions unreliable (finding I9).
- **GPU time** (R1d A9 point 4 and R1b's budgets, now in the cinematic session). R1b's `gpuTime(12)` at the sunny morning, judged by R1b's own rules: the multiplier pass's median (now with the interior shadow's 32 taps) within one frame, 16.7 ms, and both bodies' sky passes' median within 1 ms, measured and labelled (`skyTiming`). The air fill's and the eye measure's GPU time, new on every frame of motion, are reported beside them (Task 22's `passTimes`, timestamp queries); without `timestamp-query` they are reported as unmeasured (finding I8).
- **The frame budget** (§4.6: "60 fps while scrubbing the clock and while walking (p99 frame ≤ 16.7 ms), no dropped frames during light motion"). On the RTX 4090 at 1920 × 1080: scrubbing the clock through the day (the store's hour moved every frame), dragging the clock itself with the pointer, walking (w held, then s), fading the lamps in and out at dusk, and both bodies forced on while scrubbing: in each, the p99 frame within 16.7 ms and no frame over 33.4 ms; in each motion scenario the light must actually be moving in at least 80% of the sampled frames. A miss takes decision 7's remedies in order (the stride first: rerun with `CINEMATIC_BUDGET_STRIDE=2`, which leaves every splat at the final light once it settles) and is reported with both runs; the limit is never loosened.

Everything browser-side holds the GPU lock and runs headed Chromium on the shared GPU with R1b's flags, `--enable-webgpu-developer-features` included (timestamp queries), as R1b's driver does. A session judged with the cinematic light waits for its package (`state().packaged`) before anything is read, so nothing is measured before R1d is in use.

Verified (7 October; R1b's lines re-read on 8 October): R1b plan lines 11144–11170 (`NIGHT_STATIONS`, `CAPTURED_STOPS = 0.05`, `LONG_TASK_MS = 50`, `SKY_BUDGET_MS = 1.0`, `SKY_TIMINGS`, `MARCHED_NAMES`, `EXCUSED_RATE_FACTOR = 2`, `FRAME_MS = 16.7`, `RELIGHT_SPANS`), `stop_difference`, `comparison_mask`, `captured_verdict` (the 99th percentile within `CAPTURED_STOPS`), `_views`, `_srgb8`, 11265–11266 (`gpu_report`'s `rate = _wall_face_rate(rates)`), 11281–11297 (its `gpuTime` rules: `passMedianMs <= FRAME_MS`, `skyTiming in SKY_TIMINGS`, `skyMedianMs <= SKY_BUDGET_MS`), 11300–11329 (`_wall_face_rate(record)`, `_excused_ok`, `_word_ok(name, v, rate)`), 11353–11366 (`loading_report`: every span at most 50 ms, every kind measured, no new message; long tasks information only), 11370–11394 (`prepare`, which also copies `views.json` into `<work>`; `importlib.import_module("07_compare")`), 11413 (registering a command after `from . import browsercheck`), the driver's `VECTORS` and its copy of `vectors.windowRays.wallFaceRate` into the run, 11447–11536 (the lock, `openWalk`, the console and long-task listeners, `atLoad` with the `relight:*` spans), 11555 (the browser's flags, `--enable-webgpu-developer-features` among them), the `fixture` checks for captured, night and sunny_morning and `sample(97)`; R1b Task 17's `gpuTime(runs)` (10666–10728: it applies its lights itself, so the driver hands the light back to the director afterwards); `packages/web/scripts/splat-drag-budget.mjs:64-104` (`DROPPED_FRAME_MS = 33.4`, `percentile`, `summarize`), `:111-138` (`sampleFrames`: rAF intervals inside the page), `:211-226` (`dragFor`); `packages/web/src/pages/RoomWalkPage.tsx:47-80` (`window.__roomWalk`), `packages/web/src/components/rooms/InteriorCamera.tsx:292-332` (the walk's keys on `window`), `packages/web/src/components/rooms/interior-camera-input.ts:16-18` (`interiorMovementKey`: w, a, s, d and the arrows); this plan's Task 20 (`SkyClock`: `role="slider"`, `aria-label="Time"`; the lamps' fieldset with radios "Automatic", "On", "Off", enabled for a timed preset), Tasks 21–22 (the controls), Task 1 (`photo_check(bulbs, chandeliers, views, photos, t_json_from_e57, translation)`); R1b Task 6's `moonPosition` for 17 June 2026 10:00 UTC: elevation 29.2°, azimuth 92.6°, 8% lit (scratch run, 7 October; R1a's `moon.py`: 29.25°, 92.60°, the pre-flight scan, 8 October).

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_cinematiccheck.py`:

```python
import os
import tempfile
import unittest

import numpy as np
from PIL import Image

from relight import browsercheck as bc
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

    def test_loading_keeps_every_span_within_50_ms_and_adds_no_message(self):
        off = {"longTasks": [60, 20], "messages": ["warning: a"], "spans": []}
        spans = [{"name": "relight:cinematic-package", "ms": 4.0}, {"name": "relight:cinematic-parts", "ms": 30.0}]
        # Long tasks are information only.
        self.assertTrue(C.loading_verdict(off, {"longTasks": [55, 70], "messages": ["warning: a"], "spans": spans})["pass"])
        self.assertFalse(C.loading_verdict(off, {"longTasks": [], "messages": [], "spans": [dict(spans[0], ms=51.0), spans[1]]})["pass"])
        self.assertFalse(C.loading_verdict(off, {"longTasks": [], "messages": [], "spans": spans[:1]})["pass"])   # never measured
        self.assertFalse(C.loading_verdict(off, {"longTasks": [], "messages": ["error: b"], "spans": spans})["pass"])

    def test_the_fallbacks_stay_relit_without_crisp_lamps_and_warn_once(self):
        runs = {"missing": {"relit": True, "state": {"packaged": False, "crispLamps": 0}, "cinematicWarnings": 1},
                "off": {"relit": True, "controls": False}}
        self.assertTrue(C.fallback_verdict(runs)["pass"])
        self.assertFalse(C.fallback_verdict(dict(runs, missing=dict(runs["missing"], cinematicWarnings=2)))["pass"])
        self.assertFalse(C.fallback_verdict(dict(runs, off={"relit": True, "controls": True}))["pass"])

    def test_words_follow_r1bs_rule_and_count_the_penumbra_apart(self):
        rate = (10, 1000)   # R1a's wall-face rate: at most 2 x 1% of the 400 marched, 8, may be excused for rounding
        good = {"checked": 1000, "worstCodeDistance": 1, "alphaMismatches": 0, "missing": 0, "excused": 3, "sunMarched": 400,
                "excusedPenumbra": 20}
        self.assertTrue(C.words_verdict({"sample_night": good, "sample_sunny": good}, rate)["pass"])
        self.assertFalse(C.words_verdict({"sample_night": dict(good, alphaMismatches=1)}, rate)["pass"])
        self.assertFalse(C.words_verdict({"sample_sunny": dict(good, excused=9)}, rate)["pass"])
        # Each penumbra excuse is confirmed by its splat's own GPU taps (Task 22): reported, never capped; malformed fails.
        self.assertTrue(C.words_verdict({"sample_sunny": dict(good, excusedPenumbra=300)}, rate)["pass"])
        self.assertFalse(C.words_verdict({"sample_sunny": dict(good, excusedPenumbra=-1)}, rate)["pass"])
        self.assertFalse(C.words_verdict({"sample_sunny": good}, None)["pass"])   # no measured rate: never passes
        self.assertFalse(C.words_verdict({}, rate)["pass"])

    def test_gpu_time_follows_r1bs_budgets(self):
        time = {"runs": 12, "passMedianMs": 3.2, "skyTiming": "timestamp-query", "skyMedianMs": 0.6}
        passes = {"timing": "timestamp-query", "airFillMedianMs": 0.9, "eyeMeasureMedianMs": 0.02}
        self.assertTrue(C.gpu_time_verdict(time, passes)["pass"])
        self.assertFalse(C.gpu_time_verdict(dict(time, passMedianMs=16.8), passes)["pass"])
        self.assertFalse(C.gpu_time_verdict(dict(time, skyMedianMs=1.2), passes)["pass"])
        self.assertFalse(C.gpu_time_verdict(dict(time, skyMedianMs=None), passes)["pass"])   # a NaN arrives as null
        self.assertFalse(C.gpu_time_verdict(None, passes)["pass"])


class GlareCompare(unittest.TestCase):
    def test_each_night_station_is_set_beside_its_cie_glare(self):
        views = sorted(bc.NIGHT_STATIONS)
        with tempfile.TemporaryDirectory() as renders:
            for job, grey in (("R1d_cin_night", 64), ("R1d_cin_night_cie", 191)):
                os.makedirs(os.path.join(renders, job))
                for view in views:
                    Image.new("RGB", (4, 2), (grey, grey, grey)).save(os.path.join(renders, job, f"{view}@2x.png"))
            folder = os.path.join(renders, C.GLARE_COMPARE_JOB)
            os.makedirs(folder)
            Image.new("RGB", (1, 1)).save(os.path.join(folder, "stale.png"))   # an earlier run's pair never remains
            self.assertEqual(C.glare_compare(renders), views)
            self.assertEqual(sorted(os.listdir(folder)), [f"{view}.png" for view in views])
            with Image.open(os.path.join(folder, f"{views[0]}.png")) as pair:
                self.assertEqual(pair.size, (8 + C.GLARE_COMPARE_GAP, 2))
                self.assertEqual(pair.getpixel((3, 1)), (64, 64, 64))                          # the design glow, left
                self.assertEqual(pair.getpixel((4 + C.GLARE_COMPARE_GAP, 0)), (191, 191, 191))   # the CIE glare, right
            os.remove(os.path.join(renders, "R1d_cin_night_cie", f"{views[1]}@2x.png"))
            self.assertEqual(C.glare_compare(renders), views[:1])

    def test_the_cie_page_uses_its_glare_keeps_its_energy_and_logs_no_error(self):
        views = sorted(bc.NIGHT_STATIONS)
        run = {"glare": "cie", "glow": {"emitted": 64, "glowed": 63.0, "ratio": 63 / 64}, "messages": ["warning: a"]}
        self.assertTrue(C.glare_cie_verdict(run, views)["pass"])
        self.assertFalse(C.glare_cie_verdict(dict(run, glare="design"), views)["pass"])   # the query not honoured
        self.assertFalse(C.glare_cie_verdict(dict(run, glow={"emitted": 64, "glowed": 59.0, "ratio": 59 / 64}), views)["pass"])
        self.assertFalse(C.glare_cie_verdict(dict(run, messages=["pageerror: b"]), views)["pass"])
        self.assertFalse(C.glare_cie_verdict(run, views[:1])["pass"])                      # a station not compared
        self.assertFalse(C.glare_cie_verdict(None, views)["pass"])


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
the photographs put the bulbs), fallback (a missing package, ?cinematic=off), loading (every main-thread span within 50 ms, no new console
message), GPU time (R1b's rules in the cinematic session), budget (60 fps while the light moves and while walking), glareCie (the `?glare=cie` page: the fitted CIE glare in use,
its energy within 3%, no console error, and each night station beside the design glow's in renders/R1d_glare_compare).
The verdicts take decoded arrays and records, so the unit tests need no D: inputs."""
from __future__ import annotations

import importlib
import json
import os
import shutil

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
#: R1d's spans of main-thread work while the cinematic light loads (relight-spans.ts, CINEMATIC_SPANS).
CINEMATIC_SPANS = ("relight:cinematic-package", "relight:cinematic-parts")
#: The glow's comparison for Blake (decision 6): each night station with the design glow (left) and `?glare=cie`'s fitted
#: CIE glare (right), at the capture's own resolution, GLARE_COMPARE_GAP px of black between them.
GLARE_COMPARE_JOB = "R1d_glare_compare"
GLARE_COMPARE_GAP = 16


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


def glare_compare(renders: str) -> list[str]:
    """Each night station drawn with the design glow (R1d_cin_night) and with `?glare=cie` (R1d_cin_night_cie), set side
    by side, design left, at the capture's own resolution, into <renders>/R1d_glare_compare/<view>.png (the folder emptied
    first, so no earlier run's pair remains). Returns the stations written; one missing either render is left out."""
    from PIL import Image
    folder = os.path.join(renders, GLARE_COMPARE_JOB)
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)
    written = []
    for view in sorted(bc.NIGHT_STATIONS):
        paths = [os.path.join(renders, job, f"{view}@2x.png") for job in ("R1d_cin_night", "R1d_cin_night_cie")]
        if not all(os.path.exists(path) for path in paths):
            continue
        with Image.open(paths[0]) as design, Image.open(paths[1]) as cie:
            if design.size != cie.size:
                continue
            width, height = design.size
            pair = Image.new("RGB", (2 * width + GLARE_COMPARE_GAP, height))
            pair.paste(design.convert("RGB"), (0, 0))
            pair.paste(cie.convert("RGB"), (width + GLARE_COMPARE_GAP, 0))
        pair.save(os.path.join(folder, f"{view}.png"))
        written.append(view)
    return written


def glare_cie_verdict(run: dict | None, side_by_side: list[str]) -> dict:
    """The `?glare=cie` page (final re-review M5): the fitted CIE glare in use, its energy on the known block within 3% on
    the GPU, no console error, and every night station set beside the design glow's."""
    record = run if isinstance(run, dict) else {}
    errors = [m for m in record.get("messages", []) if m.startswith(("error:", "pageerror:"))]
    ok = (record.get("glare") == "cie" and glow_verdict(record.get("glow"))["pass"] and not errors
          and sorted(side_by_side) == sorted(bc.NIGHT_STATIONS))
    return {"glare": record.get("glare"), "energy": record.get("glow"), "errors": errors, "sideBySide": side_by_side, "pass": bool(ok)}


def photo_station_verdict(station: dict) -> bool:
    captured, cinematic = station["captured"], station["cinematic"]
    return cinematic["r"] >= max(station["threshold"], captured["r"]) and cinematic["median"] <= captured["median"]


def budget_verdict(scenarios: dict) -> dict:
    def ok(s: dict) -> bool:
        return s["p99Ms"] <= bc.FRAME_MS and s["droppedFrames"] == 0 and (not s["motion"] or s["movingShare"] >= MOVING_SHARE)
    return {"scenarios": scenarios, "pass": bool(scenarios) and all(ok(s) for s in scenarios.values())}


def loading_verdict(off: dict, cinematic: dict) -> dict:
    """R1b's loading rule on the cinematic light (finding I9): every relight span read once the package is in use at
    most 50 ms, R1d's two kinds measured, no console message the off session lacks. Long tasks: information only."""
    spans = cinematic["spans"]
    over = [s for s in spans if s["ms"] > bc.LONG_TASK_MS]
    measured = {s["name"] for s in spans}
    missing = [name for name in CINEMATIC_SPANS if name not in measured]
    new_messages = sorted(set(cinematic["messages"]) - set(off["messages"]))
    return {"spans": spans, "overBudget": over, "missingSpans": missing, "newMessages": new_messages,
            "longTasks": {"off": [t for t in off["longTasks"] if t > bc.LONG_TASK_MS],
                          "cinematic": [t for t in cinematic["longTasks"] if t > bc.LONG_TASK_MS]},
            "pass": not over and not missing and not new_messages}


def fallback_verdict(runs: dict) -> dict:
    missing, off = runs["missing"], runs["off"]
    ok = (missing["relit"] and not missing["state"]["packaged"] and missing["state"]["crispLamps"] == 0
          and missing["cinematicWarnings"] == 1 and off["relit"] and not off["controls"])
    return {"runs": runs, "pass": bool(ok)}


def _penumbra_ok(v: dict) -> bool:
    """R1d's penumbra excuses (Task 22): each is confirmed by its splat's own GPU taps, so their number is reported, not
    capped (the controller's ruling N2, made exact per splat); the record must carry a well-formed count."""
    excused = v.get("excusedPenumbra", 0)
    return isinstance(excused, int) and not isinstance(excused, bool) and excused >= 0


def words_verdict(checks: dict, rate) -> dict:
    """R1b's `_word_ok` with R1a's wall-face rate (the window-rounding excuses), and R1d's penumbra count well formed (B14)."""
    ok = {name: bc._word_ok(name, value, rate) and _penumbra_ok(value) for name, value in checks.items()}
    return {"checks": checks, "wallFaceRate": rate, "ok": ok, "pass": bool(checks) and all(ok.values())}


def gpu_time_verdict(time: dict | None, passes: dict | None) -> dict:
    """R1b's rules in the cinematic session (finding I8): measured, the multiplier pass's median within one frame, both
    bodies' sky passes' median within 1 ms and labelled; the air fill's and the eye measure's times reported."""
    ok = (isinstance(time, dict) and time.get("runs", 0) > 0
          and isinstance(time.get("passMedianMs"), (int, float)) and 0 < time["passMedianMs"] <= bc.FRAME_MS
          and time.get("skyTiming") in bc.SKY_TIMINGS
          and isinstance(time.get("skyMedianMs"), (int, float)) and time["skyMedianMs"] <= bc.SKY_BUDGET_MS)
    return {"gpuTime": time, "passTimes": passes, "pass": bool(ok)}


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
        "words": words_verdict({**runs["off"]["gpu"], **runs["cinematic"]["words"]}, bc._wall_face_rate(browser.get("wallFaceRate"))),
        "shadows": shadow_verdict([check for checks in runs["cinematic"]["shadows"].values() for check in checks]),
        "glow": glow_verdict(runs["cinematic"]["glow"]),
        "glareCie": glare_cie_verdict(runs.get("cie"), glare_compare(renders)),
        "photo": photo_report(cmp),
        "lamps": lamps_report(cmp, cfg),
        "fallback": fallback_verdict({"missing": runs["missing"], "off": runs["off"]}),
        "loading": loading_verdict(runs["off"]["atLoad"], runs["cinematic"]["atLoad"]),
        "gpuTime": gpu_time_verdict(runs["cinematic"].get("gpuTime"), runs["cinematic"].get("passTimes")),
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
    print("  gpu time:", json.dumps(report["gpuTime"], sort_keys=True), flush=True)
    print(f"  the glow side by side (design left, CIE right): {os.path.join(renders, GLARE_COMPARE_JOB)}", flush=True)
    return 0 if report["pass"] else 1
```

In `tools/relight/relight/__main__.py`, directly after Task 21's `from . import nightcal …` line add `from . import cinematiccheck  # noqa: E402  (R1d: the browser's cinematic checks)`, and directly after `COMMANDS["night-calibration"] = nightcal.run` add `COMMANDS["cinematic-check"] = cinematiccheck.run`.

- [ ] **Step 4: Run the tests**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_cinematiccheck -v`
Expected: PASS, 11 tests (against R1b's real `browsercheck.py`: `_word_ok` takes the wall-face rate).

- [ ] **Step 5: The browser driver** — create `packages/web/scripts/cinematic-verify.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { holdGpuLock } from "./gpu-lock.mjs";

// ---------------------------------------------------------------------------
// R1d browser verification (T-639, plan Task 23). Drives the REAL walk route on the REAL GPU (headed Chromium),
// holding the build PC's GPU lock throughout. Renders the proof's views at the captured light with and without the
// cinematic light (skins and floor skin off, so only R1d differs) and the night stations with it (the product as
// shipped); reads back the kernel's words (R1a's vectors without the cinematic light, the CPU twin with it), the
// interior shadows, the glow's energy and the GPU time; draws the night stations again under ?glare=cie (the fitted CIE
// glare, its energy and console recorded) for the side-by-side comparison; checks a missing package and ?cinematic=off;
// and records the relight spans, long tasks and console messages at load. The Python `cinematic-check` command judges what this writes.
//
//   node scripts/cinematic-verify.mjs        (the development server on 5192, as for relight-verify.mjs)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.CINEMATIC_BASE_URL ?? "http://127.0.0.1:5192";
const ROOT = process.env.CINEMATIC_ROOT ?? "D:/claude/relight/grand-hall";
const VIEWS = process.env.CINEMATIC_VIEWS ?? "D:/claude/real-hall/renovation/relight/work/views.json";
const VECTORS = process.env.CINEMATIC_VECTORS ?? "src/lib/relight/__fixtures__/relight-vectors.json";
const OWNER = "cinematic-verify (T-639 R1d)";
const STATIONS = ["mp43_night_end", "mp45_night_windows"];
const WIDTH = 1920, HEIGHT = 1080, SCALE = 2;
const LOAD_TIMEOUT_MS = 240_000;
const SETTLE_TIMEOUT_MS = 30_000;
const SHADOW_POINTS = 512;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** One step in the page (a selection, a capture, a check) must finish within this. */
const STEP_TIMEOUT_MS = 180_000;
/** The whole run: past it the watchdog closes the browser, which ends every wait, so the GPU lock is never held for ever. */
const RUN_LIMIT_MS = 60 * 60_000;

/** A promise bounded in time: a hang becomes an error naming the step, and main's finally frees the GPU lock (finding NB1). */
function within(promise, what, ms = STEP_TIMEOUT_MS) {
  let timer;
  const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`${what} did not finish within ${ms / 1000} s.`)); }, ms); });
  return Promise.race([promise, limit]).finally(() => { clearTimeout(timer); });
}

/**
 * A walk page at a query, waiting until the room is complete and relit (and, with `packaged`, the cinematic package in
 * use and its parts settled); console messages, long tasks and the relight spans recorded.
 */
async function openWalk(browser, query, prepare = async () => undefined, packaged = false) {
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
  if (packaged) {
    // The cinematic light loads after the walk is relit: read nothing before its package is in use (finding I9).
    await page.waitForFunction(() => window.__relight?.cinematic?.state().packaged === true, undefined, { timeout: LOAD_TIMEOUT_MS });
    await settle(page);
  }
  const atLoad = {
    longTasks: await page.evaluate(() => [...window.__longTasks]), messages: [...messages],
    spans: await page.evaluate(() => performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("relight:"))
      .map((entry) => ({ name: entry.name, ms: Math.round(entry.duration * 10) / 10 }))),
  };
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
    const dataUrl = await within(page.evaluate(async (request) => (await window.__roomViewCapture(request)).dataUrl,
      { position: view.pos, target: view.tgt, fov: view.fov, width: WIDTH * SCALE, height: HEIGHT * SCALE }), `The capture of ${view.name}`);
    await writeFile(join(folder, `${view.name}@2x.png`), Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
  }
}

async function main() {
  const views = JSON.parse(await readFile(VIEWS, "utf8"));
  const stations = views.filter((view) => STATIONS.includes(view.name));
  const vectors = JSON.parse(await readFile(VECTORS, "utf8"));
  // R1a's measured wall-face rate caps the rounding excuses, as in R1b's run (finding B14).
  const record = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, wallFaceRate: vectors.windowRays.wallFaceRate, runs: {} };
  // The lock is freed on every way this run can end (gpu-lock.mjs), not only by the finally below.
  const lock = await holdGpuLock(OWNER);
  let browser = null;
  // The watchdog: a run that hangs anyway is ended by closing the browser, and the finally below frees the GPU lock.
  const watchdog = setTimeout(() => { console.error(`${OWNER}: stopped after ${RUN_LIMIT_MS / 60_000} minutes.`); void browser?.close().catch(() => undefined); }, RUN_LIMIT_MS);
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion", "--enable-webgpu-developer-features"],
    });
    // The captured light without and with the cinematic light: only R1d may differ.
    const offIdentity = await openWalk(browser, "light=captured&cinematic=off&skins=off&floorskin=v1");
    await captureViews(offIdentity.page, views, "R1d_off_captured");
    await offIdentity.context.close();
    const cinIdentity = await openWalk(browser, "light=captured&skins=off&floorskin=v1", undefined, true);
    await settle(cinIdentity.page);
    await captureViews(cinIdentity.page, views, "R1d_cin_captured");
    await cinIdentity.context.close();

    // Without the cinematic light (the product's own query): R1a's vectors, the loading baseline, no controls.
    const off = await openWalk(browser, "light=night&cinematic=off");
    const gpu = {};
    for (const setting of ["captured", "night", "sunny_morning"]) {
      gpu[`fixture_${setting}`] = await within(off.page.evaluate(([value, name]) => window.__relight.fixture(value, name), [vectors, setting]), `The ${setting} fixture check`);
    }
    record.runs.off = {
      atLoad: off.atLoad, gpu, relit: await off.page.evaluate(() => window.__relight.state().relit),
      controls: await off.page.evaluate(() => window.__relight.cinematic !== null),
    };
    await off.context.close();

    // With the cinematic light, as shipped.
    const cin = await openWalk(browser, "light=night", undefined, true);
    const page = cin.page;
    await settle(page);
    const words = {}, shadows = {};
    await captureViews(page, stations, "R1d_cin_night");
    words.sample_night = await within(page.evaluate(() => window.__relight.sample(97)), "The word check");
    await within(page.evaluate(() => window.__relight.cinematic.select("sunny", 600)), "Selecting the sunny morning");
    await settle(page);
    words.sample_sunny = await within(page.evaluate(() => window.__relight.sample(97)), "The word check");
    shadows.sunny = await within(page.evaluate((points) => window.__relight.cinematic.shadowCheck(points), SHADOW_POINTS), "The shadow check");
    // R1b's GPU timing in the cinematic session, and the new passes' (finding I8). gpuTime applies its lights itself,
    // so the light is handed back to the director afterwards: re-selecting what the store holds would change nothing
    // and wait for ever for an apply (finding NB1).
    const gpuTime = await within(page.evaluate(() => window.__relight.gpuTime(12)), "R1b's gpuTime");
    const passTimes = await within(page.evaluate(() => window.__relight.cinematic.passTimes(12)), "The new passes' GPU time");
    await within(page.evaluate(() => window.__relight.cinematic.reapply()), "Handing the light back to the director");
    await settle(page);
    // Both bodies: 17 June 2026, 11:00 BST, the Sun high in the south-east and an 8% Moon 29° up in the east.
    await within(page.evaluate(async () => { await window.__relight.cinematic.select("sunny", 660, "2026-06-17"); window.__relight.cinematic.forceBothBodies(true); }), "Selecting both bodies");
    await settle(page);
    words.sample_both = await within(page.evaluate(() => window.__relight.sample(97)), "The word check");
    shadows.both = await within(page.evaluate((points) => window.__relight.cinematic.shadowCheck(points), SHADOW_POINTS), "The shadow check");
    const bothState = await page.evaluate(() => window.__relight.cinematic.state());
    await page.evaluate(() => { window.__relight.cinematic.forceBothBodies(false); });
    await within(page.evaluate(() => window.__relight.cinematic.select("moonlit")), "Selecting the moonlit night");
    await settle(page);
    words.sample_moonlit = await within(page.evaluate(() => window.__relight.sample(97)), "The word check");
    shadows.moonlit = await within(page.evaluate((points) => window.__relight.cinematic.shadowCheck(points), SHADOW_POINTS), "The shadow check");
    const glow = await within(page.evaluate(() => window.__relight.cinematic.bloomEnergy()), "The glow's energy");
    record.runs.cinematic = {
      atLoad: cin.atLoad, words, shadows, glow, bothState, gpuTime, passTimes,
      state: await page.evaluate(() => window.__relight.cinematic.state()), messages: [...cin.messages],
    };
    await cin.context.close();

    // The fitted CIE glare (decision 6), exercised before Blake is asked to judge it (final re-review M5): the same night
    // stations drawn with it, for cinematic-check to set beside the design glow's, its energy on the GPU and its console.
    const cie = await openWalk(browser, "light=night&glare=cie", undefined, true);
    await settle(cie.page);
    await captureViews(cie.page, stations, "R1d_cin_night_cie");
    record.runs.cie = {
      glare: await cie.page.evaluate(() => window.__relight.cinematic.state().glare),
      glow: await within(cie.page.evaluate(() => window.__relight.cinematic.bloomEnergy()), "The CIE glare's energy"),
      messages: [...cie.messages],
    };
    await cie.context.close();

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
    clearTimeout(watchdog);
    try {
      if (browser !== null) await within(browser.close(), "Closing the browser", 60_000);
    } finally {
      lock.release();
    }
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
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { holdGpuLock } from "./gpu-lock.mjs";

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
const OWNER = "light-scrub-budget (T-639 R1d)";
const WIDTH = 1920, HEIGHT = 1080;
const SAMPLE_MS = 6000;
const LOAD_TIMEOUT_MS = 240_000;
const DROPPED_FRAME_MS = 33.4;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** One step in the page (a selection, a capture, a check) must finish within this. */
const STEP_TIMEOUT_MS = 180_000;
/** The whole run: past it the watchdog closes the browser, which ends every wait, so the GPU lock is never held for ever. */
const RUN_LIMIT_MS = 30 * 60_000;

/** A promise bounded in time: a hang becomes an error naming the step, and main's finally frees the GPU lock (finding NB1). */
function within(promise, what, ms = STEP_TIMEOUT_MS) {
  let timer;
  const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`${what} did not finish within ${ms / 1000} s.`)); }, ms); });
  return Promise.race([promise, limit]).finally(() => { clearTimeout(timer); });
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
  return within(page.evaluate(([duration, range]) => new Promise((resolve) => {
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
  }), [durationMs, sweep]), "Sampling the frame loop", durationMs + STEP_TIMEOUT_MS);
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
  // The lock is freed on every way this run can end (gpu-lock.mjs), not only by the finally below.
  const lock = await holdGpuLock(OWNER);
  let browser = null;
  // The watchdog: a run that hangs anyway is ended by closing the browser, and the finally below frees the GPU lock.
  const watchdog = setTimeout(() => { console.error(`${OWNER}: stopped after ${RUN_LIMIT_MS / 60_000} minutes.`); void browser?.close().catch(() => undefined); }, RUN_LIMIT_MS);
  const scenarios = {};
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion", "--enable-webgpu-developer-features"],
    });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/room/grand-hall?light=sunny`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Measured only with the cinematic light in use (its package and parts), never before it loads (finding I9).
    await page.waitForFunction(() => window.__roomWalk?.complete === true && window.__relight?.cinematic?.state().packaged === true, undefined, { timeout: LOAD_TIMEOUT_MS });
    await page.evaluate((stride) => { window.__relight.cinematic.setStride(stride); }, STRIDE);

    // Scrubbing the clock through the day (the store's hour moved every frame).
    await within(page.evaluate(async () => { await window.__relight.cinematic.select("sunny", 360, "2026-06-17"); }), "Selecting the light");
    scenarios.scrub = summarize(await sampleFrames(page, SAMPLE_MS, [360, 1260]), true);

    // Dragging the clock itself.
    await within(page.evaluate(async () => { await window.__relight.cinematic.select("sunny", 600, "2026-06-17"); }), "Selecting the light");
    const dragged = sampleFrames(page, SAMPLE_MS);
    dragged.catch(() => undefined); // handled where it is awaited below, so never an unhandled rejection (M1)
    await dragClock(page, SAMPLE_MS - 200);
    scenarios.drag = summarize(await dragged, true);

    // Walking with the light still: w held, then s.
    await within(page.evaluate(async () => { await window.__relight.cinematic.select("sunny", 600, "2026-06-17"); }), "Selecting the light");
    await sleep(2000);
    const walked = sampleFrames(page, SAMPLE_MS);
    walked.catch(() => undefined); // handled where it is awaited below, so never an unhandled rejection (M1)
    await page.keyboard.down("w");
    await sleep(SAMPLE_MS / 2);
    await page.keyboard.up("w");
    await page.keyboard.down("s");
    await sleep(SAMPLE_MS / 2 - 100);
    await page.keyboard.up("s");
    scenarios.walk = summarize(await walked, false);

    // The lamps fading in and out at dusk (21:30 BST in June), on the owner's warm-down.
    await within(page.evaluate(async () => { await window.__relight.cinematic.select("sunny", 1290, "2026-06-17"); }), "Selecting the light");
    const faded = sampleFrames(page, SAMPLE_MS);
    faded.catch(() => undefined); // handled where it is awaited below, so never an unhandled rejection (M1)
    for (let switchNumber = 0; switchNumber < 4; switchNumber += 1) {
      await page.getByRole("radio", { name: switchNumber % 2 === 0 ? "On" : "Off", exact: true }).check();
      await sleep(SAMPLE_MS / 4 - 50);
    }
    scenarios.lamps = summarize(await faded, true);

    // Both bodies forced on while scrubbing through the late morning (a crescent Moon in the east).
    await within(page.evaluate(async () => { await window.__relight.cinematic.select("sunny", 600, "2026-06-17"); window.__relight.cinematic.forceBothBodies(true); }), "Selecting the light");
    scenarios.both = summarize(await sampleFrames(page, SAMPLE_MS, [600, 720]), true);
    await page.evaluate(() => { window.__relight.cinematic.forceBothBodies(false); });
    await context.close();
  } finally {
    clearTimeout(watchdog);
    try {
      if (browser !== null) await within(browser.close(), "Closing the browser", 60_000);
    } finally {
      lock.release();
    }
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
cd D:/claude/real-hall/repo/packages/web && node scripts/gpu-lock-check.mjs && node scripts/cinematic-verify.mjs && node scripts/light-scrub-budget.mjs
cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight cinematic-check --config config/grand-hall.json
```

Expected: `identity: pass`, `words: pass`, `shadows: pass`, `glow: pass`, `glareCie: pass`, `photo: pass` (both stations' r and median ΔE00 printed beside the captured hall's), `lamps: pass`, `fallback: pass`, `loading: pass`, `gpuTime: pass` (its numbers printed), `budget: pass`, exit 0. Copy into the session log: the identity's p99 with and without the margin, both stations' numbers, the glow ratio and the CIE glare's, the side-by-side folder, the shadow tallies, each word check's `excused` beside its cap and its `excusedPenumbra` (each confirmed by its splat's GPU taps), every span over 10 ms, the GPU times (the pass's and the sky passes' medians, `skyTiming`, the air fill's and the eye measure's) and every budget scenario's p50, p99 and max. On a `FAIL`, keep the evidence, find the cause and fix it; never loosen a threshold. For example: `identity` failing without the margin and passing with it is the crisp lamps' glow (decision 1, reported); failing with it means a cinematic term leaks into the captured light (the sheen's weight, an interior shadow, the eye); a `words` failure at penumbra splats that the GPU's own taps do not confirm points at the interior shadow's penumbra rule (compare `cpuTaps` with the shader's taps, Task 10), and one with many `excused` at R1b's window march; `gpuTime` failing on the pass means the interior shadow's 32 taps or the glow hiding cost too much (decision 7's remedies), on the sky passes R1b's own budget; `shadows` disagreeing means the map's view or depth differs from the twin (`lightViewFor`, `SHADOW_BIAS`); `glow` off by more than 3% means the pyramid's weights or the high-pass are not as Task 13 assumes; `glareCie` failing on its energy means the cascade's steps or level weights are not as `cieGlareSteps` and the fit assume (Task 13), on its name that `?glare=cie` did not reach the composer (Task 15's mount); `photo` worse than captured means the night's colour or the lamps' light is wrong (Task 21's evidence first); `lamps` missing means the lamps' frame or the envelope's centring is wrong (Task 11); `budget` failing a scenario takes decision 7's remedies in order (rerun the budget with `CINEMATIC_BUDGET_STRIDE=2` and report both runs; then R1b's early-out remedy), and the limit is never loosened.

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
- Consumes: every task above; R1a's publisher (`packages/api/src/scripts/publish-splat-tiles.ts --package`, nested folders, run from the shared checkout's `packages/api` so it reads `.env` in place; the R2 credentials stay there); R1b's bundle-check builds (mode `bundle-check`, `VERCEL_ENV` production and preview) and its R2 check (R1b Task 19 Steps 4–6; R1b and R1c open no PR, so this task opens R1's one PR, A10: this is the one preview of R1); the GPU gate's own procedure, `.github/gpu/README.md` and `.github/gpu/PUBLISHING.md`, written out in Step 6; the delivery contract, `.claude/conventions/shipping-changes.md`.
- Produces: `claude/real-hall` pushed with R1d; the cinematic package on R2; R1's PR, opened here with R1d's evidence as its description; the GPU gate run and published; the one Vercel preview for Blake; the session log and T-639's row.

R1 polished §5: "R1 is delivered as four plans, executed in order, with one preview at the end": this task is that end. The shared delivery contract (`.claude/conventions/shipping-changes.md`) holds: verification, integration, deployment to the preview and a check of the changed live flow there; merge waits for Blake's explicit go-ahead in chat, and production keeps the founder hold (no splats, no relight or cinematic request, no light control on venviewer.com).

Verified (7 October; re-read 8 October): R1a plan Task 7 Steps 2–3 (the publisher's nested folders; `--package` with the staged folder and the R2 prefix; the publisher refuses to overwrite an existing version; run from the shared checkout's `packages/api`), R1b plan Task 19 Steps 4–6 (the affected tests one file per command, `typecheck`, `eslint`, the two `bundle-check` builds into D: and their greps, the R2 check; its Step 6: "Open no PR"), R1c Task 24 (opens none), `gh pr list --head claude/real-hall --state all` (only #36 and #37, both merged: the pre-flight scan, 8 October; finding B16), amendment A10; the GPU gate's operator procedure as run for PR #36 on 29 September and checked on 8 October (`.github/gpu/README.md`, `PUBLISHING.md`, the project memory's operator recipe); `packages/web/vite.config.ts:91` (`"import.meta.env.VITE_DEPLOY_ENV": JSON.stringify(env["VERCEL_ENV"] ?? "")`, so Task 9's gated `import()` is a build-time constant: the production build drops the cinematic light's chunk, checked in a scratch Vite 6.4.3 build on 8 October; finding B15); `docs/engineering/` (`relight-package.md`, `native-splats.md`, `README.md`), `docs/state/tasks.md` (T-639's row), `tools/relight/README.md` (R1a Task 7), `tools/relight/tests/test_moon.py` (R1a), amendment A3 (`packages/web/src/lib/__tests__/moon.test.ts`).

- [ ] **Step 1: Every affected test, one file per command, then typecheck and lint**

```bash
cd D:/claude/real-hall/repo
for f in src/lib/__tests__/springs.test.ts src/lib/__tests__/sun.test.ts src/lib/__tests__/moon.test.ts src/lib/__tests__/light-setting.test.ts src/stores/__tests__/light-setting-store.test.ts src/lib/relight/__tests__/lamp-dimming.test.ts src/lib/relight/__tests__/light-motion.test.ts src/lib/relight/__tests__/eye.test.ts src/lib/relight/__tests__/sky-instant.test.ts src/lib/relight/__tests__/sky-colour.test.ts src/lib/relight/__tests__/relight-kernel.test.ts src/lib/relight/__tests__/relight-frame.test.ts src/lib/relight/__tests__/relight-draw.test.ts src/lib/relight/__tests__/relight-apply.test.ts src/lib/__tests__/native-splat-scene.test.ts src/lib/relight/__tests__/cinematic-package.test.ts src/lib/__tests__/splat-staging-plugin.test.ts src/lib/relight/__tests__/light-director.test.ts src/lib/relight/__tests__/sun-shadow.test.ts src/components/stage/__tests__/StageFloor.test.tsx src/lib/relight/__tests__/bulbs.test.ts src/lib/__tests__/native-renderer-scope.test.ts src/components/scene/__tests__/NativeCanvas.test.tsx src/lib/__tests__/native-current-view-capture.test.ts src/lib/relight/__tests__/cinematic-composer.test.ts src/lib/relight/__tests__/sun-shafts.test.ts src/lib/relight/__tests__/window-view.test.ts src/lib/relight/__tests__/sky-panels.test.ts src/lib/relight/__tests__/display.test.ts src/lib/relight/__tests__/sheen.test.ts src/lib/relight/__tests__/reflection-probes.test.ts src/lib/relight/__tests__/sky-arcs.test.ts src/components/rooms/__tests__/SkyClock.test.tsx src/components/rooms/__tests__/LightControl.test.tsx src/components/rooms/__tests__/RoomSplatScene.test.tsx src/components/scene/__tests__/RelightCinematic.test.tsx src/components/scene/__tests__/RelightProvider.test.tsx src/components/scene/__tests__/RelightProvider-cinematic.test.tsx src/lib/relight/__tests__/relight-spans.test.ts src/lib/relight/__tests__/relight-debug.test.ts src/lib/skins/__tests__/skin-material.test.ts src/components/scene/__tests__/RelightSkins.test.tsx src/components/rooms/__tests__/LightControl-skins.test.tsx; do pnpm --filter @omnitwin/web exec vitest run "$f" || { echo "FAILED: $f"; break; }; done
pnpm --filter @omnitwin/web typecheck && pnpm exec eslint packages/web/src
for f in gpu-lock gpu-lock-check cinematic-calibrate cinematic-verify light-scrub-budget; do node --check packages/web/scripts/$f.mjs || { echo "FAILED: $f"; break; }; done
node packages/web/scripts/gpu-lock-check.mjs
cd tools/relight && C:/Python313/python.exe -m unittest tests.test_bulbs tests.test_occluders tests.test_cinematic tests.test_nightcal tests.test_cinematiccheck tests.test_browsercheck tests.test_moon -v
```

Expected: every file passes (R1c's skin material, skins mount and walls status among them: R1d changes their hooks, the display and the control; finding I16), typecheck and lint exit 0, `node --check` prints nothing for the three drivers and the lock's two scripts, the lock check prints `10 of 10` (the repo's ESLint parses only `src`, through the TypeScript project service; finding B7), the Python tests pass. A failure is fixed at its cause and the whole step rerun.

- [ ] **Step 2: The production bundle holds nothing of the cinematic light; the preview bundle does** (R1b Task 19 Step 4's builds, into D:)

```bash
cd D:/claude/real-hall/repo && B=D:/claude/relight/grand-hall \
  && NODE_ENV=production VERCEL_ENV=production pnpm --filter @omnitwin/web exec vite build --mode bundle-check --outDir $B/bundle-production --emptyOutDir \
  && NODE_ENV=production VERCEL_ENV=preview pnpm --filter @omnitwin/web exec vite build --mode bundle-check --outDir $B/bundle-preview --emptyOutDir \
  && (grep -rlE "relight-cinematic-composite|relight-bulbs|RelightShadowReadback|cinematic/v1" $B/bundle-production && echo "LEAK: the cinematic light is in the production bundle" || echo "production bundle clean") \
  && (grep -rl "__relight" $B/bundle-production && echo "LEAK: the DEV instruments are in the production bundle" || echo "no instruments") \
  && (grep -rl "relight-cinematic-composite" $B/bundle-preview >/dev/null && echo "preview bundle has the cinematic light" || echo "MISSING: the preview bundle lacks the cinematic light")
```

Expected: both builds exit 0, then `production bundle clean`, `no instruments`, `preview bundle has the cinematic light`. A failed build stops the chain before any grep. The provider reaches the cinematic light only through Task 9's gated `import("./cinematic-light.js")` and type-only imports, so the production graph holds none of it (finding B15). A leak is fixed at its cause (a static import reaching the production graph: look for a non-type import of `cinematic-light.ts`, `RelightCinematic.tsx`, `cinematic-package.ts`, `bulbs.ts` or `cinematic-composer.ts` outside the gated chunk), never by weakening the check.

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

- **The kernel's glow hiding.** While the crisp lamps draw, every splat of record class 3 (the chandelier
  emitter class, which the frontier splats study measured as the capture's glow of the bulbs) whose nearest chandelier
  centre, measured horizontally, has crisp lamps is drawn with alpha 0. A record carries no chandelier id; the nearest of the five centres
  (from the cinematic package) decides, the chandeliers standing at least 5 m apart. Class 4 (the dome's crests, lit by
  LED pin spots) is never hidden. Nothing is boosted: β is 1 in every setting (R1d amendment A1).
- **The lamps' dimming** (an artistic choice). The hall's lamps are LED and keep their colour when dimmed; Blake chose a
  warm-down anyway (spec §4.1, 7 October). Each group's light at drive d is `w[k]c[k] ⊙ tint(d) × output(d) × gain`:
  for `warm` (the default) `output = d^3.4` and `tint` the Planckian colour at `fullCct × d^0.42` over that at
  `fullCct`; for `led`, `output = 10^(3(d − 1))` (the DALI curve) and `tint = 1`. At full level both are exactly this
  package's light; each group's own `fullCct` (from that group's colour, `lamps.warmDown.groups[g]`) and its `dimming`
  are cinematic-package values, never constants.
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

In `docs/engineering/cinematic-package.md`, add at the end a dated section "Published package (<date>)" stating, read from the staged manifest (`D:/claude/splats/trades-hall/grand-hall/cinematic/v1/manifest.json`) and Task 1's evidence (`<evidence>/r1d/bulbs.json`): the crisp lamps per chandelier and kind (candles and crown tubes), the chandeliers without them (Task 1's `not covered`: none on the 7 October table, finding I13), the entries that are not lamps by confidence (`notLamps`: low and exclude, ruling L1), the bulb table's SHA-256 (`bulbs.tableSha256`) and the refit's `wCrown` (R1a Task 4b's `bulb-intensities.json`), each group's warm-down `fullCct` and range (`lamps.warmDown.groups`, ruling L3), and whether the night gains and the eye's anchors are calibrated.

In `tools/relight/README.md`, add to its command list, after `check`, in order: `bulbs` (the crisp lamps from the frontier study's bulb table; R1d Task 1), `occluders` (the interior occluder model; Task 2), `cinematic` (the cinematic package; Task 3), `night-calibration` (after `packages/web/scripts/cinematic-calibrate.mjs`; Task 21), `cinematic-check` (after `cinematic-verify.mjs` and `light-scrub-budget.mjs`; Task 23), each with its one-line purpose, its double run where it makes a data product, and its outputs under `D:/claude/relight/grand-hall/`.

In the day's session log `docs/sessions/<YYYY-MM-DD>.md` (create it if the day has none), add a section "T-639 R1d: the cinematic light" with: the commits (`git log --oneline` of R1d's), each offline product's double run (identical, or the majority), Task 1's coverage and photo check, Task 21's calibration (both stations' r and ΔE00 before and after, any dark group, the eye's anchors and the gate in cd/m²), Task 23's report (every section; the identity's p99 with and without the margin, the glow ratio, the shadow tallies, every budget scenario's p50, p99 and max, and the stride used), the R2 paths, the preview URL, and the open decisions in this plan's self-review. In `docs/state/tasks.md`, update T-639's row: R1d integrated and on the preview, waiting for Blake's judgement; name the evidence folder `D:/claude/relight/grand-hall/evidence/r1d`.

```bash
cd D:/claude/real-hall/repo && git add docs/engineering/relight-package.md docs/engineering/native-splats.md docs/engineering/cinematic-package.md tools/relight/README.md docs/sessions docs/state/tasks.md && git diff --cached --stat && git commit -m "docs(relight): the cinematic light, its package, its checks and where it is published (T-639 R1d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open R1's PR**

First check release ownership, as the delivery contract asks before shared state changes (`.claude/conventions/shipping-changes.md`, "Coordinate the release and finish it"): after `git fetch origin`, read T-639's row and latest notes in `docs/state/tasks.md` and today's session log for a named release owner or an active release, and list what is in flight with `gh pr list --base master --state open` and `gh run list --branch master --limit 5`. A deployment running on master is waited out, never raced; a named release owner other than this task is sent the exact tested commit (`git rev-parse HEAD`) and Step 1's evidence before the push. An ownership label or an unanswered message alone is not a missing permission: with no competing release, push. Record what the check found in the session log.

```bash
cd D:/claude/real-hall/repo && git status --short && git push -u origin claude/real-hall && gh pr list --head claude/real-hall --state open
```

No PR is open from this branch (R1b and R1c open none; A10 makes this R1's one preview). Open it with `gh pr create --base master --head claude/real-hall --title "R1: the restored hall, relit, with the cinematic light (T-639)" --body-file <file>` (the file written in the scratch directory), its body this section with every `<…>` filled from `D:/claude/relight/grand-hall/evidence/r1d/r1d-browser-checks.json`, `light-scrub-budget.json`, `night-calibration.json`, `eye-anchors.json` and `bulbs.json`; do not open the PR with any left unfilled. If a PR from this branch is already open, append the section to its description instead (`gh pr view <number> --json body`, then `gh pr edit <number> --body-file <file>`):

```markdown
## R1d: cinematic light

The relit Grand Hall now opens at the real hour and moves with it: the true Sun and Moon light it through the window
volumes, the light sweeps the hours as a smooth time-lapse when the clock moves (a time-altitude chart of both
bodies' arcs, draggable, with detents at sunrise, the golden hours, sunset and moonrise), lamps fade and dim warm (an
artistic choice: the lamps are LED), crisp frosted lamps (candles, and the centre chandelier's crown tubes) stand at the bulbs triangulated from the photographs
in place of the capture's glow, with an energy-conserving glow; the eye adapts to the frame and sees as a dark-adapted
eye only in truly dim light; the chandeliers and pilasters cast soft shadows from both bodies; the windows show the
street opposite, the sky and the Moon's disc; the floor and the gilding carry GGX sheen and soft reflections; faint
dusty shafts; a clutter toggle. Previews only; venviewer.com keeps its hold.

Verification (evidence D:/claude/relight/grand-hall/evidence/r1d on the build PC):
- captured light, with the cinematic light against without, where splats remain: p99 <value> stops with the 48 px margin, <value> without (limit 0.05)
- words: R1a's vectors without the cinematic light, worst <n> code; the CPU twin with it at night, sunny, both bodies and moonlit, worst <n> code (limit 1), <n> rounding excuses (cap: twice R1a's wall-face rate, <n>) and <n> penumbra excuses (each confirmed by its splat's own GPU taps)
- interior shadows: <decided>/<points> decided, <n> disagreeing (limit 0.5%); glow energy ratio <value> (limit 1 ± 0.03)
- the fitted CIE glare (`?glare=cie`): energy ratio <value> (limit 1 ± 0.03), no console error; both night stations with each glow side by side in `D:/claude/relight/grand-hall/renders/R1d_glare_compare` (design left)
- night photographs: station 43 r <value> (captured <value>, needs 0.85), median ΔE00 <value> (captured <value>); station 45 r <value> (captured <value>, needs 0.80), median ΔE00 <value> (captured <value>); night gains <accepted or refused, and why> (the frontier study expects a median ΔE00 residual near 3.5 from the lamps' RGB bounce, which colourless gains cannot absorb, and gave station 45 only 0.007 over its 0.80)
- crisp lamps: <n> (<n> candles and <n> crown tubes) at all five chandeliers; in the night renders <share> of lamps in view on a bright pixel (controls <share>)
- the eye's anchors: lamp-lit night <value> cd/m² (no night vision), moonlit <value> cd/m²
- frame budget on the RTX 4090 at 1920 × 1080: scrub p99 <value> ms, drag <value>, walk <value>, lamps <value>, both bodies <value> (limit 16.7 ms, no frame over 33.4 ms; stride <n>)
- GPU time on the RTX 4090: the multiplier pass's median <value> ms (limit 16.7), both bodies' sky passes <value> ms (limit 1, <skyTiming>), the air fill <value> ms and the eye measure <value> ms (reported)
- fallbacks: a missing package stays relit with one warning; ?cinematic=off removes the controls; loading: every main-thread span within 50 ms (the largest <value> ms)

For Blake to judge at the preview: every open decision in the plan's self-review that is yours (1–5, 8–15 and 20–22; the evidence is there and in the frontier light study's §e, 8 October):
1. The glow (13): the restrained design glow (4% of each lamp's light, the default, as asked) or the physiological CIE glare, 9% of a lamp's light beyond 1°, from the study's fit. Open the preview with `?glare=cie` to compare, or see both night stations side by side in `D:/claude/relight/grand-hall/renders/R1d_glare_compare` (the design glow left).
2. The crisp lamps (3, 4): a frosted C35 candle (35 × 70 mm) and the centre chandelier's crown tubes (25 × 50 mm), design values until the venue names its lamps; the glass's albedo 0.6; the capture's glow splats hidden by their record class, where a photo-tuned halo flag would be finer; and whether any of the bulb table's six unresolved entries is a real bulb (it would show neither crisp nor as glow).
3. The lamps light automatically once the Sun is below 7°, about an hour before sunset (1).
4. The clutter hidden and the AV cabinet shown by default (2).
5. The warm-down (5; your artistic choice, kept) against LED-true dimming: it costs 1.5–1.65 times the chroma at 10% light and 3.2–3.8 times at 1%; LED-true is a per-group switch in the package.
6. The night look (9): the Thompson night tint and its 60% maximum stay design values. The shift now follows Cao's rod gains from the study's table: none from 5 cd/m², a tenth of it at 0.62, all of it by 0.1. Lamps dimmed to 10% (0.86–1.15 cd/m² in the study) therefore show 7–8% of it, where the straight ramp of the earlier draft showed 38–45%. The study's own mesopic chain is not recommended (blue at 1% lamps, a cream blue hour). Also the shafts' density (σ_s 0.012, g 0.6) and the dust.
7. The eye's colour adaptation (22): R1b's 60% (kept) or CIECAM16's 0.74, which takes 17–34% of the approved night's chroma.
8. The absolute calibration (15): k_abs 121.8 cd/m² per unit, measured, in place of the estimated 54; every absolute level 1.17 stops higher, the lamp-lit night photopic with 0.8–1.6 stops to spare, and the city light's weight against the lamps 2.26 times lower.
9. The Moon (10, 11): the moonlit preset opens on 23 December 2026, 23:50 GMT, the year's brightest evening full Moon the windows admit (60.8° up, 0.275 lux, 4,248 K; it was 26 September), with its display key; a day Moon below 1/100,000 of the day's light shows its disc but lights nothing.
10. The windows' view (12): the facade opposite at albedo 0.3 and the street lit to about 1 cd/m², both assumed (the evening Matterport stations could measure the street); its sky view 0.24, its daytime brightness with the Sun in front (0.018 of the windows' sky band) and the street light's 3,830 K are the study's.
11. The surfaces (8, 14, 20): the probes reflect the floor and the skins, not the splats; the floor's roughness 0.3 and the gilding's kept diffuse share 0.5; a designed brass and gilt sheen on the splats (not built), the gilding's roughness and colour shown as priors.
12. If the GPU gate refuses the worker's runtime (Step 6; 21): re-pinning `.github/gpu/worker-profile.json` changes the trust root, and is yours to decide.
13. The merge, on your go-ahead.

Blake judges the light on the Vercel preview; merge waits for his go-ahead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 6: CI, the GPU gate and the preview**

Run: `cd D:/claude/real-hall/repo && gh pr checks --watch`
Expected: every check green except "GPU performance (required)" waiting for its operator. A red check is fixed at its cause and pushed again.

Then the GPU gate, as its operator on this PC (the procedure is `.github/gpu/README.md` and `.github/gpu/PUBLISHING.md`; R1b's plan no longer carries it). The job "GPU performance (required)" issues a request (artifact `gpu-request-<run>-<attempt>`) that expires 25 minutes after it is issued, so prepare first:
- Check the PC can run it: virtualization on and WSL Ubuntu running (`Get-CimInstance Win32_Processor | Select VirtualizationFirmwareEnabled` is `True`; both were confirmed on 8 October), and a quiet minute (`D:/claude/perf-20260929/bench/quiet.ps1 -CpuMax 30`: the Twin hop's 150 ms main-thread budget fails under load on master too).
- Download the request into a fresh request directory with `gh run download <run> --name gpu-request-<run>-<attempt> --dir D:/claude/real-hall/gpu-gate/<run>-<attempt>/request`, keeping `request.json`, `trusted.json` and `READY.json` exactly as downloaded (README step 2); copy that folder unchanged to `<ws>-request` in WSL for the worker, and give `publish-result.mjs` the Windows copy. `D:/claude/real-hall/gpu-gate/36567607843-1` holds a past run's layout.
- The request's `sourceCommit` is the PR's merge ref (`refs/pull/<n>/merge`): fetch it, `git -c core.autocrlf=false archive --format=tar -o <D: folder>/source.tar <sha>`, and `python .github/gpu/source_manifest.py --repo D:/claude/real-hall/repo --commit <sha>`; its `sourceHashes`, tree and commit must match `trusted.json` (this can be done before the request exists).
- In WSL Ubuntu (as root), with Node 22.23.2 and pnpm 9.15.4, the versions the README pins (step 4; `node --version` prints `v22.23.2`, or stop and report): a fresh `/root/venviewer-t639-gpu-<run>-<attempt>` workspace and its install home, the tar extracted, then `env -i HOME=<install-home> PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 CI=true pnpm install --frozen-lockfile --prefer-offline --store-dir /root/.local/share/pnpm/store`, then delete `<workspace>/node-compile-cache` (the worker rejects it as an unexpected file). From Git Bash call WSL through a script file with `MSYS_NO_PATHCONV=1`, or `/root` paths are rewritten.
- Take the GPU lock (`D:/claude/visual-firstprinciples-20260928/gpu.lock`, created exclusively, as every driver does; wait for another owner), run `python3 <ws>/.github/gpu/run-worker.py --workspace <ws> --request-dir <ws>-request --output <new folder> --bwrap /root/venviewer-t613-gpu-isolation-probe/tools/unpacked/usr/bin/bwrap --browser-cache /root/.cache/ms-playwright --pnpm /root/.local/share/pnpm/.tools/pnpm/9.15.4 --lease /root/venviewer-t613-gpu-isolation-probe/benchmark.lock` (`--pnpm` must be that `.tools` folder), copy the output to D:, inspect it, release the lock, and publish from Windows with the controller extracted from the same commit: `node <controller>/.github/gpu/publish-result.mjs --request-dir … --worker-output … --repo D:/claude/real-hall/repo --run-id <run> --attempt <attempt> --source <sha>`. (`D:/claude/perf-20260929/gpu-gate/gate-run.sh` automates the rerun, the download, the worker and the publish.)
- A new attempt needs a new request, and the gate's last job reads the CPU shards of the same attempt: after a red gate, push a fix or rerun the whole workflow, never only the failed job; push nothing to the branch after publishing.
- If `publish-result.mjs` refuses with "Actual initial runtime differs" (the worker's runtime against `.github/gpu/worker-profile.json`: on 8 October WSL's kernel had moved to 6.18.40.1 after the 7 October reboot), stop: re-pinning the worker profile is a change to the trust root, and Blake decides it. Report the refusal and the measured runtime; never edit the profile to pass.

Then take the GPU lock (if this fails with `EEXIST`, wait for its owner, as every driver does):

```bash
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({owner:'cinematic preview check (T-639 R1d)',since:new Date().toISOString()}),{flag:'wx'})" D:/claude/visual-firstprinciples-20260928/gpu.lock
```

Confirm the preview is built from the pushed head before looking at it (the delivery contract: check the deployed identity). The Vercel integration records each preview as a GitHub deployment of its commit:

```bash
cd D:/claude/real-hall/repo && sha=$(git rev-parse HEAD) && test "$(gh pr view --json headRefOid -q .headRefOid)" = "$sha" && id=$(gh api "repos/{owner}/{repo}/deployments?sha=$sha&environment=Preview" --jq '.[0].id') && gh api "repos/{owner}/{repo}/deployments/$id/statuses" --jq '.[0] | .state + " " + .environment_url'
```

Expected: `success https://…`, the preview of exactly the pushed head. An empty id or another state means the head's preview has not deployed yet: wait for it (or fix its build), and never check an older preview.

Open that preview (previews read R2's `/splats` directly, because the deployment redirects `/splats`) and check the changed live flow with the Browser tools at `/room/grand-hall`: the hall loads relit at the real hour (live) with the clock; dragging the clock sweeps the Sun's patches across the floor and the chandeliers' shadows with them, and the detents catch at sunset; "Night, lamps lit" fades the lamps in through amber and shows the crisp lamps (candles, and the centre chandelier's crown tubes) with their glow and no captured blob around them; "Moonlit night" shows the Moon's disc in a window when it is above the facade opposite, and the hall reads as moonlit; the lamps switch fades rather than switches; the console has no errors. Then open `/room/grand-hall?glare=cie` and choose "Night, lamps lit": the crisp lamps carry the fitted CIE glare (wider and fainter than the design glow, 9% of a lamp's light beyond 1°), the hall is otherwise the same, and the console has no errors. Then close the preview's tab and release the lock:

```bash
node -e "require('fs').rmSync(process.argv[1])" D:/claude/visual-firstprinciples-20260928/gpu.lock
```

Record the preview URL in the session log and the PR. Deployment Protection may require Blake's Vercel login: give him the link, and ask before using any bypass.

- [ ] **Step 7: Hand the preview to Blake, and merge only on his go-ahead**

Send the controller: the exact tested commit (the PR head that Step 6's preview was built from), the preview link, the PR link, Step 5's verification section with its list for Blake, any failed check, and the open decisions in this plan's self-review. Merge only after Blake's explicit go-ahead in chat (`gh pr merge --merge`), then confirm production kept its hold, with the Browser tools: `https://venviewer.com/room/grand-hall` shows no splats, makes no request for a relight or cinematic package (a path under `/splats/` containing `/relight/v` or `/cinematic/v`) and has no light control. Update the session log and `docs/state/tasks.md` with the merge commit and the production check (explicit pathspecs, pushed to master through the normal path).

---

## Self-review

**Spec coverage** (`docs/superpowers/specs/2026-10-03-r1-polished-design.md`, with the owner's requirements of 3 and 7 October and the coordinator's updates of 7 October):

| Requirement | Tasks |
|---|---|
| §4.1 live by default at the real hour; the light moving continuously; the displayed time following the chosen time through a critically damped spring, never jumping | 5, 6, 9, 19, 20 |
| §4.1 (amended 7 October, commit 475acd2e) lamps fade, never switch, with a warm-down as they dim, labelled as Blake's artistic choice (the lamps are LED); each group keeps its measured colour at full level; the LED-true curve behind a per-group flag | 3 (`lamps.groups[g].dimming`, `warmDown.groups[g]`: each group's own start, ruling L3), 4, 6, 9, 11, decision 11 |
| §4.2 the sun through the window volumes (R1a/R1b); interior occluders' soft shadow maps recomputed as the sun moves; lamps' shadows baked; the exact sun-bounce basis | 2, 7, 10; A5, A9 |
| §4.3 eye adaptation over one to two seconds, anchored to the calibrated presets; measured on the GPU from the rendered frame (coordinator, 7 October), the baked floor mean only a fallback, fed by the GPU's sky light read back at most four times a second while the light moves, never the CPU twin per frame (ruling E1) | 5, 9, 13, 21; decision 4 |
| §4.3 crisp emissive lamps at their measured positions with a restrained energy-conserving bloom; the bulb splats no longer boosted (8 October: at the 140 high- and medium-confidence lamps of the 7 October bulb table, on all five chandeliers (ruling L1), the centre chandelier's 7 crown tubes drawn as their own smaller kind (ruling L2); the glow splats hidden, not boosted) | 1, 3, 7, 8, 11, 13; decision 1; A1 |
| §4.3 the night calibrated to the hall's night photographs; a colour-accuracy measure; no heavy grade, the hall as captured at the captured light | 21, 23; Tasks 9 and 17 (the identity display, no sheen at the captured light) |
| §4.4 GGX sheen from the lamps, the windows and the sun (and the Moon) on the skins and the floor; reflection probes refreshed as the light changes; soft dusty sun shafts | 14, 17, 18 |
| §4.5 the Moon as a light source: its true position and phase by the bake's own cited ephemeris tested against published positions (one ephemeris: R1a's Meeus `moon.py` ported, Horizons-checked), true level with the opposition surge, through the sun's machinery, both bodies counting; both beams' colour by elevation and the blue hour in xy (the frontier study's d2, 8 October) | A3–A6, A9; 6, 7, 10, 14, 15, 23 (both bodies forced on) |
| §4.5 night vision: a restrained, physically motivated scotopic shift driven by absolute luminance (coordinator: the approved night neither greyed nor blue-shifted) | 5 (k_abs 121.8 measured; the shift shaped by Cao's rod gains from the study's d3 table, none from 5 cd/m², full by 0.1: the frontier study's §e), 16, 21 (the gate); decision 4 |
| §4.5 the night sky in the windows: the Moon's disc at its phase, the sky following the Moon; (coordinator, 7 October) the facade opposite in 55–83% of each view, lit by the same sun and sky and by street lighting at night, the disc only above its roofline; R2's hook | 15 (`WindowViewModel`); decision 9 |
| §4.5 the clock as a crafted object: both bodies' arcs, drag a body or the time, spring physics, detents at sunrise, golden hour, sunset and moonrise, accessible, reduced motion | 19, 20; decision 8 |
| §4.6 60 fps while scrubbing and walking (p99 ≤ 16.7 ms), no dropped frames during light motion, no loading task over 50 ms; passes every frame only while the light moves, amortised if needed | 7 (the active draw first, the stride), 9, 23 (budget, loading); decision 7 |
| §5 one preview at the end | 24; A10 |
| §6 the photo check with colour accuracy, never worse than captured; the captured light within 1/20 stop where splats remain; Blake judges the preview | 21, 23 (R1b's word check at R1a's wall-face rate; R1d's penumbra excuses each confirmed by the splat's own GPU taps: ruling N2), 24 |
| §7 a missing package falls back; missing bulb positions fall back to the bulb splats, unboosted; phones and WebGL keep the captured hall | 8 (one warning), 1 and 7 (an uncovered chandelier keeps its glow), R1b's predicate; 23 (fallbacks) |
| The clutter toggle (R1d's share of §3's masks) | 20 (R1c's `setToggleHidden`) |
| Coordinator, 7 October: the glare function as an interface, any CIE fit from the text of CIE 135/1-6:1999; spectral rendering an upgrade interface, never a dependency; the frontier study's upgrade points | 13 (`Glare`: the design glow by default, the study's fitted CIE glare at `?glare=cie`); decision 10; the amendments file's last section |
| Coordinator, 7 October: the centre chandelier was lit for the whole walk though R1a's fit gave it ~0; R1d assumes no lamp weights; lamp colour a package value, never a constant | 3 (per-bulb intensities per unit weight, the refit's shares), 11, 17, 21 (a dark group refused); decision 11; the amendments file's "Interfaces from the bake" |

**Placeholder scan.** No "TBD", "TODO", "similar to Task N" or deferred code remains (`grep -n "TBD\|TODO\|similar to Task\|write it as\|FIXME"` over the plan prints only this paragraph; re-run 8 October). Three kinds of angle-bracket slot are deliberate and carry their instructions: the session log's `<YYYY-MM-DD>` (the executor's date), Task 24's PR section (each `<…>` filled from named evidence files before the edit, which must not run with any left), and the "Published package (<date>)" note. Where the plan edits R1b or R1c code it quotes the exact line it replaces; Task 0 checks each anchor exists and stops otherwise.

**Type consistency** (names that cross tasks, checked by grep over the parts on 7 October and over the whole plan on 8 October):
- Lamps: `LampDimming`, `dimmedOutput`, `dimmedTint`, `planckRgb`, `warmCct` (Task 4) are what Tasks 6, 16 and 21 import; `LampGroupLight { dimming, warmFullCct, gain }` and `LampLight { groups }` (Task 6; each group's own warm-down start, ruling L3) are what Tasks 8, 9 and 21 build; `STEADY_LAMPS` is LED-true with no warm-down temperature. No `LAMP_FULL_CCT`, `lampTint` or `lampOutput` remains.
- Bulbs: the package's `bulbs: { envelopes: { candle, crown }, tableSha256, entries: [{ id, group, kind, chandelier, position, intensity }] }`, `chandeliers: [{ id, centre, crisp }]` and `lamps: { windowRadiance, warmDown: { groups: { <group>: { fullCct, range } } }, groups, night }` (Task 3) are what Task 8's schema parses into `CinematicData { bulbs, envelopes, glow, lamps, … }`; `BulbKind` (`candle`, `crown`) is what Tasks 11 and 17 draw and size; `GlowChandelier`, `CHANDELIER_COUNT`, `glowHidden` and `setGlow` (Task 7) are what Tasks 8, 11 and 22 use. No bulb core, `coreLuminance`, package field `lampIntensity` (Task 17's sheen keeps a local function of that name for its sphere lights), `BULB_CORE_LUMINANCE` or `MAX_BULB_CORES` remains.
- `SkyLight.sheen` (Task 6) is produced by `lightForSky` (1), `capturedLight` (0) and `mixLights` (Task 9), and read by Task 17's mount and Task 22's state.
- `CinematicControls` (Task 21: `holdEye`, `soloLamps`, `still`, `measurement`, `measureNext`, `select`, `reapply`, `adaptation`, `lightChroma`, `presetDisplay`; Task 22: `state`, `shadowCheck`, `bloomEnergy`, `forceBothBodies`, `setStride`, `scrubTo`, `passTimes`) is exactly what the three drivers call.
- The glare: `Glare` and `GlareSpread` (Task 13: `designGlare`, `cieGlare`, `glareFromSearch`) are what Task 13's mount and Task 22's energy check use; `glowShare` (Task 11) is what the lamps' and the Moon's disc's materials read and the composer sets. The sky's measured colours (`sky-colour.ts`, Task 6) are what `lightForSky` (with `extras.colourByElevation`, set by Task 9's director) and Task 15's window view use.
- Loading spans: `CINEMATIC_SPANS` (Task 8, in R1b's `relight-spans.ts`) are the names Task 8 (`relight:cinematic-package`) and Tasks 10, 11, 13, 14, 15, 17 and 18 (`relight:cinematic-parts`) measure through `measureRelight`, and the ones Task 23's loading check reads.
- The director's sky read-back: `DirectorOptions.readSkyLight` (Task 9) is the provider's call into R1b's `frame.readSkyLight(renderer)`; the fallback eye relies on it and the glass's ambient (Task 11) is computed on the GPU, so neither runs a per-frame CPU twin (ruling E1).
- The bulb table's ids (`c<chandelier>_b<nn>`) are the ids in `bulbs.json`, the package, the browser's schema (its pattern `^c[0-4]_b\d{2,3}$`) and the bake's refit file.
- The kernel, frame, draw, light-setting, director, relight-debug and sun-shadow tests carry the count changes each task states.

**Verified while planning** (7 October, and again on 8 October for the pre-flight revisions; scratch copies outside the repo, never the repo; no build of the repo, no test suite in the repo, no GPU):
- Python, the plan's own code as it stands on 8 October (each module and test extracted from this file into a scratch package and run single-threaded): `test_bulbs` (13; with the proof's real `02_geometry.py` beside it), `test_occluders` (6), `test_cinematic` (17), `test_nightcal` (10) and `test_cinematiccheck` (9, against R1b's current `browsercheck.py` taken from R1b's plan: `_word_ok(name, v, rate)`) pass.
- Task 1 on the 7 October bulb table (`D:/claude/real-hall/frontier/splats/evidence/bulbs.json`, 173 entries): 140 lamps placed (`{"ch_end": 93, "ch_centre": 47}`; 133 candles, 7 crown tubes on chandelier 2), all five chandeliers crisp, 33 entries not lamps (27 exclude, 6 low), no problem; the night photo check passes at both stations (every lamp in view on a bright pixel; the controls at 2.9% and 5.9%).
- Task 3 on R1a's 7 October floor light with refit shares in R1a's file format (uniform within a group and kind): 0.043983 per `ch_end` candle, about 0.0251 per `ch_centre` candle, 0.009705 per crown tube at `wCrown` 0.3871; each group's warm-down start from its own colour (the chandeliers near 3,700 K, the dome's prior near 4,370 K).
- Task 21 on a synthetic night (a power-law tone curve of slope 0.8, a camera tint, exposure 1.6, 8-bit renders): the slope recovered as 0.805, the basis adding up within 0.7%, one gain per group within 0.04 of the truth, the median ΔE00 from 1.97 to 0.90; CIEDE2000 on seven of Sharma's pairs both ways.
- TypeScript, strict `tsc` and the repo's own ESLint settings over each changed task's files in isolated scratch projects (R1b and R1c imports stubbed by their planned signatures; three 0.186's real types): Tasks 8, 9, 10, 11, 13, 14, 15, 17, 18, 20 and 21 clean. Run under vitest with happy-dom: Task 8's package and span tests (6 and 2), and Task 18's five probe tests on real three 0.186 with a stand-in frame (its orientation test fails without the fix). From 7 October: `lamp-dimming` (8), `light-motion` (12), `eye` (11) and the Meeus port (8) pass; the candle envelope's area (0.005885 m²) and centroid (0.411 of its height), on 8 October the crown tube's (0.0041024 m², 0.521), and three's `LatheGeometry` bounds as Task 11's tests expect.
- The bundle gate (Task 24 Step 2, finding B15): a scratch Vite 6.4.3 build with the repo's `define` drops the gated dynamic import from the production output and keeps it in the preview's.
- `node --check` passes for `cinematic-calibrate.mjs`, `cinematic-verify.mjs` and `light-scrub-budget.mjs` as this file now writes them.
- 8 October, after the re-review and the light frontier results (round 3): `test_cinematic` (17; its stray-file test now checks that a refused build leaves the package untouched) and `test_cinematiccheck` (9; the penumbra decided per splat) re-run from this file; under vitest on this file's code, `eye` (11, at k_abs 121.8 and the 0.1 cd/m² ramp) and the new `sky-colour` (4) with R1b's `daylight.ts` and Task 4's `lamp-dimming.ts` taken from the plans, and the CIE glare's cascade arithmetic (its test's assertions); strict `tsc` and the repo's ESLint clean again for Tasks 9, 10, 11, 13, 14, 15, 17, 18, 20 and 21, the director's `reapply` and bounded `measureNext`, the controls' `select`, the per-splat penumbra code and Task 22's glare check; the three drivers pass `node --check`, and their bounded wait was exercised in node (a hang rejects with the step's name, a quick step resolves, no timer lingers). A first CIE cascade with one step for both axes was modelled with bilinear filtering and missed by up to 18% vertically at 16 px per degree; the per-axis solve replaced it.
- 8 October, after the final re-review (round 4; scratch `D:/claude/real-hall/plan-amendments-0710/fix2-scratch-d/r4`): the five Python suites from this file pass (`test_bulbs` 13, `test_occluders` 6, `test_cinematic` 17, `test_nightcal` 10, `test_cinematiccheck` 11, two new for the glow comparison); under vitest, `eye` (11, the Cao-shaped ramp) and `sky-colour` (4, the moonlit preset's Moon exact), with a scratch check of the light setting at the moonlit preset's Moon; the five scripts pass `node --check` and the lock check prints 10 of 10. R1b's `relight-debug.ts`, taken whole from R1b's plan with Tasks 21 and 22 applied from this file by their own anchors (the controls, `select` and `reapply` among them, the state with its glare, the shadow check, `measureGlare`, the per-splat penumbra code in `sample`), beside Task 22's `cinematic-parts.ts`, `cpuTaps`, the composer's readable glare and `RelightCinematic`'s registry effect, typechecks under strict `tsc` and lints clean under the repo's ESLint rules, against the real director (Tasks 9 and 21), composer, shadows and shafts and R1b's other modules stubbed by their planned signatures; two injected type errors and an injected lint error were caught (`r4/relight-debug-tsc-eslint.txt`). The round-3 line above named these without kept output; this run is the evidence.
- Not run, and stated: the other vitest files (the R1b and R1c code they import is not merged), every browser step, every GPU measure. Their numbers are Tasks 21, 23 and 24's to produce.

**Limits, stated rather than designed around:**
- Crisp lamps are the 140 high- and medium-confidence entries of the 7 October table (ruling L1). An unresolved (`low`) entry that is a real bulb is drawn neither crisp nor by its glow, which its chandelier hides; Blake's look at the preview is the check. A chandelier a later table leaves uncovered keeps its glow splats, unboosted, and shines in the sheen as a sphere at its centre.
- The crown tubes' envelope (25 mm across, 50 mm tall) is a design value smaller than a candle (ruling L2); their light share is R1a's measured `wCrown` (0.3871 of a candle).
- The captured-light identity is judged outside a 48 px margin around the fixtures, because the crisp lamps' glow replaces the captured glow there; the 99th percentile is also reported without the margin.
- The night gains are one number per lamp group (rulings L3 and I11): they move only light between groups, never their colour (the camera's exposure and white balance cancel by construction); each group's colour stays R1a Task 4b's fit, a package value.
- Each group's warm-down starts at the colour temperature its own fitted colour implies (R1a Task 4b's `lamps.groups[g].colour` against CIE daylight D65; ruling L3): about 3,700 K for the chandeliers and about 4,370 K for the dome at its prior. The frontier study confirms the chandeliers' range (8 October, §e V2: the best single Planckian lamp is 3,590 K against the modelled exterior and 3,520 K against D65, both inside 3,537–3,985 K; 2,750 K is rejected). The daylight the ratio was measured against is uncertain (D60–D75 moves the chandeliers' start over 3,540–3,990 K), and the start shapes only how the colour warms.
- The LED-true curve is the DALI logarithmic curve, assumed: the hall's dimming system is "multi-channel programmable" (the contractor's record), not known to be DALI.
- The interior shadow's CPU twin is a hard edge; the DEV checks compare only where the GPU's taps agree. A penumbra splat is excused in the word check only where both the CPU's taps and its own GPU taps put it in the penumbra, and the excuses are counted apart from R1b's rounding excuses (ruling N2).
- A blend between two lights drops a counted second body while it runs (the Moon with the Sun up: at most about a thousandth of the light) and restores it at the end (finding M6).
- The Sun's beam colour by elevation is the frontier study's clear sky at AOD 0.1 (at AOD 0.4 the same elevations run 1,000–4,900 K); R2's weather brings the real aerosol. The blue hour's colour is the study's clear model, which runs 0.7–0.9 stop too bright in twilight; only its colour is used, and R1b's sky level stays.
- The facade's dimming with the Sun in front of the windows is a shape fitted to the study's one sunlit scene (0.018 of the windows' sky band at the capture's Sun), itself a lower bound: the study does not model the sunlit hall front's light reflected onto the facade.
- The fitted CIE glare (an option, `?glare=cie`) conserves its energy exactly in a model of three's blurs with bilinear filtering, and gives each level the fit's σ at 6.5 px per degree and above (a canvas taller than about 430 px at a 60° field of view); below that the first levels' tap steps clamp to 0 and their widths overshoot (8% at 6 px per degree). Task 23 runs it on the GPU (its energy, its console, the night stations beside the design glow) and Task 24 Step 6 looks at it on the preview.
- Task 21's colour measure keeps an expected residual: the lamps' RGB-bounce error (the study's d1b: median ΔE00 3.5 under 2,750 K tungsten) that colourless gains cannot absorb; and station 45 had only 0.007 to spare over its 0.80 threshold in the study's v1 cells.
- Eye adaptation's absolute luminance rests on k_abs = 121.8 cd/m² per fit unit, the frontier study's measurement from the capture day's modelled sky (±1 stop; it depends on the sky's shape and assumed efficacies, and the facade model omits the sunlit hall front's reflected light: §e5); Task 21's gate reports a miss and never tunes it away.

**Open decisions** (for Blake or the controller; R1d proceeds on the stated default):
1. Lamps automatic below a 7° Sun (about an hour before sunset).
2. The clutter hidden and the AV cabinet shown by default (R1c's `defaultHidden`).
3. The crisp lamp: a frosted candle envelope 35 mm across and 70 mm tall (a C35 candle) until the venue names its lamp, and the centre chandelier's crown tube 25 mm across and 50 mm tall (ruling L2, a design value); the glass's albedo 0.6; the glow share `BLOOM_SHARE` 4%.
4. The glow splats are hidden by record class (class 3, 48–59% of each chandelier's splats); a finer, photo-tuned halo flag from the bake would replace the class rule.
5. Every group dims warm (Blake's artistic choice); `led` per group on request, a package value. Its colour cost against LED-true dimming (the frontier study's d3): 1.5–1.65 times the chroma at 10% light, 3.2–3.8 times at 1%.
6. Settled 8 October: the house-light refit is R1a Task 4b's `bulb-intensities.json`, which Task 3 requires (one intensity per lamp of a group and kind, the crown tubes at `wCrown` of a candle); the calibration still refuses a dark group.
7. Settled 8 October: the 7 October table covers all five chandeliers (ruling L1); none shows a mix.
8. The probes reflect the floor and the skins only, not the splats (decision 5).
9. The shafts' density (σ_s 0.012, g 0.6) and the dust; the night tint (CIE xy 0.25, 0.25) and `SCOTOPIC_MAX` 0.6, design values (the frontier study's mesopic chain is not recommended: d3, 8 October); the shift follows Cao's rod gains from the study's d3 table (a tenth of the way at 0.62 cd/m², all of it by 0.1), its zero held at 5 cd/m² rather than Cao's 10 so the approved night is untouched (within 0.025 of Cao's share everywhere).
10. The moonlit preset's date, now 23 December 2026 at 23:50 GMT (the frontier study's brightest evening full Moon the windows admit: 60.8° up, 0.275 lux, 4,248 K; it was 26 September at 23:00), and its display key (A7).
11. A day Moon's light below 1/100,000 of the day's is not marched (`MOON_NEGLIGIBLE`), though its disc shows; Task 23 measures the cost with both bodies forced on, so keeping it is a switch.
12. The facade opposite: albedo 0.3 and street lighting about 1 cd/m² (assumed; the evening Matterport stations can measure the street light); its sky view 0.24, its daytime brightness with the Sun in front (0.018 of the windows' sky band) and the street light's colour (3,830 K) from the frontier study's d2 (8 October).
13. The glow: the restrained design glow (4% of each lamp's light) by default, as Blake asked; the frontier study's fit of CIE 135/1-6:1999's glare (§e d3: 9% of a lamp's light beyond 1°, 63% spread in all) is an option at the preview, `?glare=cie`, for Blake to judge.
14. The floor's roughness 0.3 and gilding's kept diffuse share (`METAL_DIFFUSE_SCALE` 0.5).
15. k_abs 121.8 cd/m² per unit (measured 8 October; the estimate was 54), ±1 stop: it raises every absolute level 1.17 stops, widens the night's photopic margin to 0.8–1.6 stops, decides Task 21's gate in favour and lowers the city light's weight against the lamps 2.26×.
16. The stride stays 1 unless Task 23's budget needs 2.
17. Settled 7 October: A9's bounce basis is R1a Task 4's contract, computed by R1b; R1d only reads it (the controller's ruling).
18. The night calibration's ridge (0.1 of the normal matrix's mean diagonal), a regularisation choice.
19. Settled 8 October (the re-review): each penumbra excuse is decided by its splat's own GPU taps, so no cap factor is needed (ruling N2).
20. A designed brass and gilt sheen on the splats (decision 5): not built; R1d reports R1c's gilt roughness and F0 as priors.
21. The GPU gate (Task 24 Step 6): if the worker's runtime no longer matches `.github/gpu/worker-profile.json`, re-pinning it changes the trust root, and Blake decides.
22. The eye's colour adaptation: `CHROMA_ADAPTATION` 0.6 (R1b's rule, kept) or CIECAM16's 0.74 (the frontier study's d3: it takes 17–34% of the approved night's chroma).
23. The glow: see 13; `?glare=cie` shows the alternative at the preview, and Task 23 sets the night stations' two glows side by side. Task 24's PR list holds every open decision here that is Blake's to judge (1–5, 8–15 and 20–22, with the bulb table's unresolved entries and the merge); the technical defaults 16 and 18 go to the controller with Step 7, and 6, 7, 17 and 19 are settled.
