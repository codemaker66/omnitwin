# The Restored Hall — R1a "The light bake" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reproducible offline tool, `tools/relight`, turns the Grand Hall's served splats and the 29 September light model into an immutable relight package (light records for all 24 served tiles, per-source bounce probes, window volumes and the sky bodies' bounce basis for the Sun and the Moon (amended 7 October; the 3 October sunlit-area table is gone), floor light maps, the capture light refitted with the centre chandelier's share and a colour per lamp group, and evidence that names every artifact by its SHA-256) and publishes the restored floor as floor skin v2, each checked against the proof that was compared with the hall's photographs.

**Architecture:** The proof's verified research scripts move into the repo unchanged except for where they read and write (Task 2). Small new modules build on their per-splat tables: a byte codec and the package contract (Task 1), the window volumes, their sun march and the sun-reach flag (Task 3, as built on 3 October), bounce probes, the sky bodies' factored bounce basis (each window's exact entering power times K basis volumes, `sunbounce.py`), the Moon's ephemeris and floor light maps (Task 4, as built on 7 October), the house lights refitted from the triangulated bulb table (Task 4b), R1c's record classes, the skins' light and each artifact's hash in its evidence (Task 4c), per-tile records with a transfer to the coarser levels plus a numpy reference of the browser's multiplier (Task 5), and the restored floor (Task 6). `docs/engineering/relight-package.md` is the contract that plan R1b (the browser) consumes. Spec: `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md` (§4.1, §4.2, §6, §8) and `docs/superpowers/specs/2026-10-03-r1-polished-design.md` (§4.1 as amended 7 October).

**Tech Stack:** Python 3.13 (`C:/Python313/python.exe`) with numpy 2.4, torch 2.9 + CUDA (RTX 4090), scipy 1.17 (`cKDTree`), Pillow 12 and OpenCV 5; `unittest` (no new dependencies); the repo's publisher `packages/api/src/scripts/publish-splat-tiles.ts --package` (pnpm 9.15.4, Node 22).

## Revisions (7 October, consolidated)

Applied in one pass from R1c's amendments (`docs/superpowers/plans/2026-10-03-r1c-amendments-to-r1a-r1b.md`, A1–A5), R1d's (`docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md`, A1, A5, A6, A8, A9 and its last section), Task 4's final outcome (commits `a2a25c56`, `deed4d4a`, `4efa4fa4`; the Task 4 report), the house-light refit, the packaging rule and the owner's lamp decision (spec §4.1, commit `475acd2e`). Tasks 1–4 keep their steps; each gains an "As built" note.
- **Goal and Architecture:** the sky bodies' basis, the refit, Task 4c.
- **"The multiplier" (normative):** the scenario light has two sky bodies, each with its direct light (the window volume march) and its bounce through Task 4's factored basis, folded at the 0.5 m probes (R1d A5, A9; A9 is superseded by Task 4's committed contract, the controller's ruling of 7 October); β, `b[w]` and the sunlit-area table are gone; the lamp rule takes R1d A1's tint and boost 1, and each lamp group's full colour is its package colour; covered and toggled splats (R1c A2).
- **Global Constraints:** the 2,700 K lamp default is superseded (each group keeps its measured colour; the warm dim is a setting); the packaging rule; the double-run rule.
- **File Structure:** `sunbounce.py`, `moon.py`, `housefit.py`, `skinlight.py`, `proof/shots.py`; the commands.
- **Task 1:** an "As built" note (10 tests). **Task 4:** an "As built (7 October)" note: the factored basis K 30, the Moon, gate-before-write, what depends on the fit.
- **Task 4b (new):** the house lights refitted: one per-bulb intensity for every chandelier lamp (ch_centre / ch_end = the bulb-count ratio, 2.021 on the 7 October table; superseded by the pre-flight fixes of 8 October below: 1.8370 with the 140 lamps and the crown tubes' measured weight), a colour per lamp group with priors from the emitter splats, `bulb-intensities.json` for R1d's Task 3, the acceptance (data cost within 2%, the centre's share, the night photographs no worse, double runs), and the fit's dependents regenerated in order (03c, 03d, 05_relight, `probes`, `sun-bounce`).
- **Task 4c (new):** R1c A1's codec (with one correction for NumPy 2's promotion rules) and A4's `skinlight.py` and `skin-light` (with one correction: `windows_volumes` returns a tuple); each artifact's SHA-256 in its evidence, written after the artifact; `record-artifacts`.
- **Task 5 (rewritten):** `reference.py` with the sky bodies' basis, the Moon, lamp tints and the visibility (12 tests); `records.py` with R1c's covers and toggles (6 tests); the package reads exact, hash-checked files and writes the `sky/` files, `lamps` per group, R1c's v2 sections; check 5 is the sky bounce through the package; the proof regression compares with the refit's own `05_relight` multipliers; the vectors carry `skyBounce`, `moon_test` and nine ray directions (R1d A8), under 1,000 kB.
- **Task 6:** the floor's albedo target is read from the refit's `fit.json`. **Task 7:** the README's commands, the publisher's `sky/` test, the exact-files check before publishing, the session log's checks. **Self-review notes:** updated.
- **Seam review fixes (8 October)** (the seam reviews `D:/claude/real-hall/plan-amendments-0710/review/seam-A-findings.md` (A) and `seam-B-findings.md` (B); Tasks 1–4 untouched):
  - A I-1: Task 5 Step 6 asserts `1 <= k <= 192` (`__main__.SUN_KMAX`), the most R1b's schema now accepts.
  - A I-2: Task 5 Step 7, the vectors' `nodes` are the four corner nodes of every case, whatever its weights and powers.
  - A I-3 and B M4: Task 5 Step 7, `check --package <dir>` writes `<evidence>/checks-<folder>.json` and no vectors unless `--vectors <path>`; the fixture comes only from the default package.
  - A I-4 and B M3: Task 5 Step 6, `tool` and `createdAt` come from the HEAD commit (`%cI`), never the clock; Step 7, check 4 rebuilds with the package's own two values and compares the files and the manifest without the six keys `check` adds, the only keys it writes.
  - A I-5: Task 5 Step 7, the wall-face rate `wallFaceRate` (check-sun's 200,000 splats at the sunny morning's Sun and `moon_test`'s Moon) in the checks file, the manifest's evidence and the vectors' `windowRays`; R1b Task 18 caps its rounding excuses at twice it.
  - A M-1: Task 5 Step 7, the fold has no fallback (stop and report). A M-2: Task 7 Step 3 checks `floor-skin/v2/floor-skin.json`.
  - A M-5 and M-6: Task 5 Step 6, each lamp group's colour divided in float64 from the values written to `capture`; the key `refit.bulbTableSha256` and its source in `refit.json`.
  - A M-7: Task 5 Step 7, `reference.SkyBounce` and `sunbounce.Table` called by keyword. A M-8: "The multiplier (normative)", the 2.2 m cap is the contract's length from Q to 7 cm beyond the glass.
  - B M5: Task 4c's `skinlight.py` docstring, light texels 5 cm (2 cm on the frieze). B M7: Task 5 Step 6, `evidence.artifacts` keys are paths relative to the work folder.
- **Pre-flight fixes (8 October)** (the controller's rulings `D:/claude/real-hall/plan-amendments-0710/scans/rulings-0810.md`; the fix-wave re-review `…/review/fixwave-rereview.md`; the scans `…/scans/r1c-a-scan.md`, `r1c-b-scan.md`, `r1d-a-scan.md`; Tasks 1–4 untouched):
  - L1: Task 4b, the lamps are the table's 140 `high` and `medium` entries (26, 22, 47, 23, 22); `low` and `exclude` are not lamps and `fit.notLamps` lists all 33; `bulb-intensities.json` names only the lamps (`NOT_LAMP_SHARE` is gone). Counts, ratios, the geometry check's measured numbers and `blobBalance` (−0.53, candles only) recomputed from the real `bulbs.json` (SHA-256 `1856cf8b…648d`).
  - L2: Task 4b, the centre chandelier's 7 crown tubes are a kind `crown` (`lamp_kind`; each must stand above every candle of its chandelier) at `w_crown × φ`; `crown_weight` measures w_crown as the ruling defines it, against the candles in the same faces: 0.3871 (92 pairs, 28 faces; the ruling's 0.456 is the table's `core_ratio_median`, whose denominator includes every entry of the chandelier, so the task uses the definition); ratio 1.8370 (1.7204 at 0, 2.0215 at 1). The refit runs at w_crown 0 and 1 too (`refit-house refit --w-crown`, `compare`/`install --tag`, Step 11), and `refit-house sensitivity` (Step 12, acceptance 6) reports each run's data cost, `ch_centre` share at the floor and ceiling and both stations' photo metrics against their render-to-render noise, and stops when the photographs clearly prefer an end; `promote` requires it and refuses a staging work whose installed fit is a sensitivity run. `bulb-intensities.json` gains per-bulb `kind` and top-level `wCrown`; Task 5's `lamps.refit` gains `wCrown` (the contract and R1b's schema follow). Steps 10–14 (were 10–13); Task 4b 14 tests (135), Task 4c 141, Task 5 159; Step 1 and Step 3's code verified in a scratch copy of the committed `tools/relight` (14 tests pass; the command's light modes smoke-tested on synthetic folders).
  - L4: Task 4b, the range-aware balance (`range_balance`, from each face's `distance_m` and `blob_area_mm2`; design bullet, acceptance 7): the ends' candles' range fit with a per-face intercept, the centre's median residual against it, each end's leave-one-out spread, a stop beyond 2× the largest spread; written to `evidence/refit/range-balance.json`, the reports and `bulb-intensities.json`; `promote` gates on it and, refused for any reason, writes `evidence/refit.json` with `pass: false` and copies nothing (Task 5 builds only from a `pass: true` record). On the 8 October table: −0.296 against a limit of 0.563 (end spreads +0.282, +0.275, −0.042, +0.244): it passes. Task 4b 15 tests (136), Task 4c 142, Task 5 160 (161 with the wall-face test below); checked from the plan's own text (15 and 136 pass; the command's smoke run covers the refusal).
  - The wall-face measurement as one public function (the controller's request, 8 October, so R1c Task 15 imports it instead of re-implementing it): Task 5 Step 7, `windows.wall_face_rate(volumes, horizon_tables, fresnel_table, P, s) -> {"marched", "wallFace"}` with one test; `check` calls it for the splats and the floor. Equal to R1c's re-implementation on the real volumes, splats and floor at both directions (splats 2,964 / 92,085, floor 3,630 / 35,155).
  - The scoped re-review of these fixes (`…/review/fix2-rereview-ab.md`, five Minor items): Task 4b Step 13 names the five gates (range-balance included) throughout; the photo checks (Steps 9, 11, 12) go through `photo_metrics` (written by Step 8), which deletes the previous `cmp/metrics.json` and its output first, refuses a leftover `renders/` and copies only when the render and the measurement both succeed, with a guard run in Step 9 proving a failed render copies nothing (checked in scratch: a missing harness, a failing `07_compare.py` and a leftover `renders/` each copy nothing); `check` takes the vectors' `sampleDepths` from a new public `windows.sample_depths(vol)`, so `_sample_depth` is used only inside `windows.py`, with a test (`test_windows` 40; Task 5 162); Task 4b's Consumes names the faces' `distance_m`.
  - P1: Task 5 Steps 6–8 reordered: Steps 6 and 7 write the code, Step 8 commits it, then builds, checks twice and commits the fixture; `records` and `check` refuse while `git status --porcelain -- tools/relight` prints anything (`_committed_tool`), so the manifest's `tool` is the commit that holds the code.
  - Re-review N3: Task 5 Step 7, `wallFaceRate.floor` (check-sun's 88,831 floor points, both directions) beside the splats'; R1b caps the floor's excuses with it.
  - Re-review N4: Task 5 Steps 6–7, the vectors' cap is 1,000 kB + 1.6 kB × max(0, K − 30), the K-proportional parts measured per K.
  - Scans: R1c-a I4 (the light-state gate's units) is R1c Task 8's own code, nothing in R1a. R1d-a M2: Task 4b Step 6's note now says R1d's Task 1 checks that `paths.emitters` is present and adds nothing; R1d-a B1's rule (commands go above `if __name__ == "__main__":`) is R1a's own, and Task 5's `_committed_tool` follows it.

## Revisions (30 September, pre-flight)

From the pre-flight scan of plan R1b (`.superpowers/sdd/2026-09-29-restored-hall-r1b-relit-browser/preflight-scan.md`; finding numbers as there). Only Task 5 changed; Tasks 1–3 and their "As built" note are untouched.
- 8: Task 5 Step 6 writes `capture.gamma` as exactly 1 after asserting that the fitted γ is within 1e-6 of 1; otherwise the build fails.
- 9: Task 5 Step 7: the vectors' probe table is the package's global grid. `index` is the global linear index, and `entries` holds every corner each splat's trilinear lookup touches after clamping.
- 19: Task 5 Step 7 lists every field of R1b's `RelightVectorsSchema`, in camelCase, with `emitterBoost` 1 for every setting (R1d amendment A1).
- 20: Task 5 Steps 6 and 7 build every manifest path with `/` and write JSON with `allow_nan=False`.
- 22: Task 5 Step 7 adds eight `floor-light.npz` texels (`floorTexels`), which R1b's Task 5 decodes from the floor PNGs.
- The vectors' `windows` (two planes with stencils) follow R1b's schema as it stands; the window-volume revision will replace them.

## Revisions (3 October, window volumes)

The controller's decision of 30 September, confirmed on 3 October: the runtime marches each window's occupancy volume exactly as the proof's `lt.trace_to_windows`, `march`, `horizon_deg` and `sun_direct` do, and the two-plane stencils are dropped. Task 3's as-built note gives the evidence; the spec records it in its "Amendment (3 October): window volumes". R1b changed to match (see its note). Changed here:
- Goal, Architecture and the File Structure rows of `__main__.py`, `windows.py` and `package.py`: window volumes, the sunlit-area table, the commands `check-sun` and `sun-area`.
- "The multiplier": `V` is the volume march (`windows.sun_visibility`); a window's horizon gate interpolates between whole degrees as the proof does (it was rounded); the glass transmission is interpolated; the bounce's sunlit area is the baked table, read bilinearly; the reach flag is `windows.sun_reach`, analytic and conservative.
- Task 3: an "As built (3 October)" note after Step 7. Its original steps are unchanged.
- Task 4: Files, Interfaces and Step 5's sun-bounce calibration (`windows.sunlit_area(vol, s)` with the interpolated gate and glass). New Step 6: `sun_vector`, `sun_area_nodes`, `sun_area_table` and `sun_area_at` in `windows.py` with four tests (`test_windows.py` 30 tests), and the `sun-area` command, which bakes each window's sunlit area at 1° in azimuth and elevation over the reach test's sun band into `<work>/sun-area.npz`. The floor light maps and the commit become Steps 7 and 8.
- Task 5: `reference.py` takes V from `windows.sun_visibility`, the gates and the glass from `windows.horizon_at` and `fresnel_at`, and `sunlit_glass_area` from the baked table (`Model` gains `volumes`, `sun_area` and `sun_area_origin` and drops `windows` and `site`; 7 tests). In Step 6 the records' reach flag is `windows.sun_reach`, and the package writes `windows/<id>.alpha.gz`, `windows/sun-area.bin.gz` and the manifest's `windows[].frame` and `sun.area`. In Step 7, `check` adds a fifth check, the table against direct `sunlit_area` at random real suns within 2%, and the vectors carry the volumes, the per-sample depths, the sunlit-area nodes and cases and 96 points' rays at 8 suns, with every sun-flagged splat stable to 1 mm, under 800 kB.
- Task 7: the README's command list, the publisher's nested-folder test and the session log's checks.
- The records, the package, the checks and the vectors all live in Task 5 (Steps 5–7) in this plan; Task 6 (the floor skin) is unchanged.
- `docs/engineering/relight-package.md` is revised in place; Task 1 Step 5 keeps the text it first wrote.

## Global Constraints

- Work only in the worktree `D:/claude/real-hall/repo`, branch `claude/real-hall`. Never edit `C:/Users/blake/omnitwin2`.
- Commit with explicit pathspecs only; inspect `git diff --cached --stat` before each commit; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Inputs are read-only: the staged tiles `D:/claude/splats/trades-hall/grand-hall/*.sog`, `D:/claude/splat-quality-20260923/**`, the proof `D:/claude/real-hall/renovation/**`, and `F:/**`.
- Outputs: work tables in `D:/claude/relight/grand-hall/work/`, the package in `D:/claude/splats/trades-hall/grand-hall/relight/v1/` (development serves this root through `SPLAT_STAGING_ROOT`), evidence in `D:/claude/relight/grand-hall/evidence/`. Nothing bulky goes on C:; C: filled up twice on 29 September.
- GPU rule: every step that runs torch on CUDA holds `D:/claude/visual-firstprinciples-20260928/gpu.lock`, a JSON file `{"owner":"relight-bake <step>","since":"<ISO time>"}` created exclusively and deleted afterwards. If another owner holds it (the T-640 performance session uses it), wait. One GPU job at a time; the PC lost power twice under concurrent GPU load. The proof's code (`lt.py`, `radiosity.py` and the moved scripts) runs torch on the CPU, with no CUDA anywhere, so it never takes the lock (corrected 29 September after the first run held the lock through CPU work).
- Memory rule: per-splat work runs in chunks of at most 500,000 splats, as the proof does. The PC's 32 GB are shared with other sessions.
- Spec numbers, verbatim: the light multiplier is clamped to between 1/16 and 8; the codec's round trip is within 1/20 of a stop; at the captured light the result is neutral. The night photo check (0.80 at station 45, 0.85 at station 43) is measured in R1b. (Amended 7 October: the spec's "lamps default to 2,700 K" is superseded by its §4.1 as amended on 7 October, commit `475acd2e`: at full level each lamp group keeps its measured colour, a package value per group from Task 4b's refit; the 2,700–2,800 K figure is not established, the frontier light study §b9 reading the measured ratio as 3,500–3,950 K against D60–D75; the lamps dim with a warm-down by the owner's artistic choice, a setting of the browser, never a package constant.)
- Packaging (the owner's rule, 7 October): the package is built only from exact, named work artifacts, never a glob such as `work/sun-bounce*`, and each is packaged only when its SHA-256 equals the one its evidence JSON records (Task 4c writes it, Task 5 checks it).
- Double runs: every data-producing command runs twice in separate processes and its outputs are compared array by array or byte by byte; a mismatch is settled by a third run and a majority (Task 2 as built).
- Execution host (amended 8 October). The CPU-heavy steps run on the RunPod runner, not on the shared PC. These are the proof's fit chain and its dependents (`03c`, `03d`, `05_relight`), `refit-house`, `probes`, `sun-bounce`, `records` and `check`.
  - **The runner.** The pod is `relight-runner`, on the network volume `omnitwin-foundry` in EUR-IS-3. It is driven by `D:/claude/real-hall/runpod/remote-relight.sh`; the recipe and traps are in `D:/claude/real-hall/runpod/README.md`.
  - **Why the pod.** It has ECC memory, which matters because the PC has silently corrupted heavy results before. It has no contention with other sessions, and it has memory headroom: the PC's commit charge reached 65 of 68 GB on 8 October, and the proof's fit once ran out of memory there.
  - **Validated on 8 October** (`D:/claude/real-hall/runpod/evidence/validate-fit.json`):
    - the committed 121 unit tests pass on the pod;
    - `proof fit`, run twice on the pod, is byte-identical between the two runs;
    - against the PC, the largest relative weight change is 1.86e-4, within the 0.01 tolerance, and the data-cost ratio is 1.000002.
  - **Syncing inputs and the tool.** Inputs and the tool go up with SHA-256 manifests.
    - The tool on the pod is a checkout of the committed HEAD (a shallow clone), so P1's `git status` and `rev-parse` checks run unchanged there. The runner's `git archive` push must become a clone before Task 5.
  - **Returning outputs.** Outputs come back only by exact path, through `pull`, which writes nothing unless the SHA-256 matches.
  - **Comparisons.** The double-run rule holds on the pod. Artifacts compared across machines use this plan's tolerances, never byte equality: the pod is AVX-512, the PC AVX2.
  - **What stays on the PC.** Steps that need the GPU or the browser harness stay on the PC under `gpu.lock`: the photo checks' renders, and R1b's and R1d's checks.
  - **Paths.** The steps name local `D:/` paths. On the pod the same tree lives under `/workspace/relight/D/`, and `pod/podrelight.py` maps it for the config's `D:/` check only.
  - **Cost.** The pod is stopped whenever it is idle.
- Frames: `json` is the served tiles' frame (metres, z up). `e57` is the light model's frame: +x at bearing 14.3°, window wall at y = −10.329, outward normal −y. `T_JE` (json ← e57) comes from `canonical_frame.json`. The package describes the model in the e57 frame and gives `tileToModel` = `T_EJ` = inverse of `T_JE`.
- Unit tests: from `tools/relight`, `C:/Python313/python.exe -m unittest discover -s tests -v`. Unit tests never need the GPU or the D: inputs.
- Proof facts this plan must reproduce (from `D:/claude/real-hall/renovation/relight/work/`): 6,030,980 finest-level splats (the environment tile plus the 11 finest tiles, product order); `fit.json` weights and colours; the measured lamp/daylight ratio (1.623, 1, 0.467) (`lamp_daylight_ratio.json`; amended 7 October: its colour temperature is not established); capture contrast γ = 1. Task 4b then refits the house lights and replaces the proof's weights and lamp colours; the proof fit is kept in `work/fit-proof/`.

## The multiplier (normative)

R1b's GPU kernel implements exactly this; Task 5's `relight/reference.py` is its executable definition. (Amended 3 October: R1b's TypeScript twin repeats the window march's float32 operations exactly; WGSL may fuse, reassociate and divide within 2.5 ULP, so the GPU may round a sample on a cell boundary or an outline the other way, which R1b's GPU checks allow for and count.) Per splat, in the e57 frame:

- Inputs from the record: direct light `D[k]` for the nine sources k = W1..W5, cove, ch_end, ch_centre, dome; normal `n`; flags (class, isotropic, sun-reachable, chandelier group; R1c's wall group and toggle). From the splat itself: position `p` and captured linear colour `C` (the stored DC colour, sRGB-decoded); `L = C · (0.2126, 0.7152, 0.0722)`. The sun-reachable flag is `windows.sun_reach(volumes, p, latitude)` (amended 3 October; its band covers the Moon since Task 4: declination within 28.75°, parallax up to 1.03°): analytic and conservative, true wherever some real sun or moon position can light p through some window's glass, occupancy ignored.
- Bounce light `I[k]` (RGB) = the per-source probe volume evaluated at `p` with normal `n`: trilinear over the eight grid corners with invalid corners dropped and the weights renormalised (the proof's `03_bases.trilinear_weights`), then the ambient-cube evaluation `E(n) = Σ axis n+² cube[+axis] + n−² cube[−axis]`, or the mean of the six faces for isotropic receivers (the proof's `lt.cube_eval`).
- Captured light: `Ecap = Σk w[k] c[k] ⊙ (D[k] + I[k])` with the fitted capture weights `w` and colours `c` from the manifest.
- Scenario light: `E = Σk s[k] ⊙ (D[k] + I[k])`, where `s[k]` is the setting's RGB weight for source k (R1b derives it from the presets), plus, for each sky body that is up (the Sun, and the Moon; amended 3 October for R1d), `bodyRGB × V_body(p) × cosθ_body` and the bodies' bounce `I_sky(p)`. Every rule below written for the Sun's direct light (the march, the gates, the glass, `cosθ`) applies to the Moon with the Moon's direction. **The sky bodies' bounce** (amended 7 October; R1a Task 4 as built, `sunbounce.py`; the contract's section "The sky bodies' bounce"): for a body toward σ (rounded to float32), each window's exact entering power `P_w(σ)` (`sunbounce.window_power`: the 56,448 patch rays of the room's 3,528 patches marched by the window volume twin, each ray owned by the first window that claims it, times the glass transmission, gated by that window's horizon), the coefficients `c(σ) = sunbounce.coefficients(table, P(σ), az, el)` (the four 4° nodes `windows.sun_corners` picks, each window's coefficients scaled by its weight times `P_w`, in float64), the basis sum on the 1 m grid `S1 = Σ_body bodyRGB ⊙ Σ_k c_k(σ_body) basis_k` (float16 basis widened), and `S1` read at each 0.5 m probe trilinearly (`sunbounce.trilinear_matrix`: the 1 m cell clamped into the grid and the position into the cell, invalid corners dropped and the rest renormalised, none when their weights sum to at most 1e-6). `I_sky(p)` is that 0.5 m sky volume evaluated at p exactly as `I[k]` is (trilinear over valid probes, the ambient cube at n); the browser folds it into the scenario probe volume (R1b Task 10), so the floor and R1c's skins receive it unchanged. β, the sunlit-area table and the area-scaled bounce `Σw b[w] sunRGB ⊙ I[w]` are gone (Task 4 as built; R1d's amendment A9 is superseded by this contract, the controller's ruling of 7 October). `V(p)`, only for sun-reachable splats, is `windows.sun_visibility` (Task 3 as built): the body's ray from p belongs to the first window, in order W1..W5, that claims it (a room point whose ray crosses the wall's inner face inside that window's outline shrunk by 5 cm, or a point in the embrasure within 0.25 m of the window's sides); it is 0 while that window's horizon gate is closed, if its length L exceeds 2.2 m (L the distance along the ray from Q, its wall-face crossing (for a point in the embrasure, the point itself), to the plane 7 cm beyond the glass, `max(0, (Q.y − (y0 − depth − 0.07)) / (−σy))`, so the cap includes those 7 cm: `windows.py:174,177`), or unless it leaves through the glass inside the outline shrunk by 3 cm; otherwise `V = exp(−τ) × F`, with τ marched through the window's occupancy volume in float32 steps of 1.5 cm from the wall face (0.045 m in for a point in the embrasure) to 7 cm beyond the glass, at the nearest cell, stopping once τ ≥ 6 (`docs/engineering/relight-package.md`, "Window volumes and the sun", gives every step and its order). A window's horizon gate is open while the sun's elevation `asin(σz)` in degrees is strictly greater than its horizon interpolated linearly between whole degrees at the sun's compass azimuth `az = (x_bearing − atan2(σy, σx) in degrees) mod 360`, as the proof's `lt.horizon_deg` interpolates its profile: `horizon[i](1 − f) + horizon[min(i + 1, 359)] f`, `i = min(floor(az), 359)`, `f = az − i`. `F` is the glass transmission, the 101-entry table interpolated linearly at `100 min(|σy|, 1)`. V, the gates, F, `P_w` and the body's azimuth and elevation all take σ rounded to float32; a body with `σy ≥ −0.001` lights nothing and bounces nothing. `cosθ = max(0, n·σ)`, or 0.25 for isotropic receivers.
- Interior (class 0) and chandelier fixtures (class 6, lamps on): `M = clamp(E / max(Ecap, 1e-4), 1/16, 8)` per channel.
- Embrasure (class 1: curtains, glazing bars, reveals, columns): `ρ = min(C / Ecap, 0.8)`, `excess = max(C − ρ Ecap, 0)`, `rBack = skyLevel × skyRGB / c[W1]`, `M = clamp((ρ E + excess rBack) / max(C, 1e-4), 1/16, 8)`.
- Lamp emitters (class 3 chandelier bulbs, class 4 dome lamps, class 5 cove strip) and fixtures (class 6) at lamp level ℓ ∈ [0, 1] of their group: `Mlit = t × (1 + (β − 1) × smoothstep(0.45, 0.9, L))` for classes 3 and 4 and `Mlit = t` for class 5, where t is the group's lamp tint (RGB, the colour of the dimmed lamp relative to its full-power colour; 1 at full power and in every preset) and β the setting's emitter boost, 1 in every setting (amended 3 October for R1d: crisp bulbs replace the boost), so the captured setting stays exactly neutral; the interior rule for class 6. `Munlit = (A E) / max(C, 1e-4)` with `A = 0.5` for class 4, `0.3` for class 5, `0.35` otherwise, times `clip(C / max(L, 1e-4), 0.5, 2)^0.4` except for class 5. `M = clamp(ℓ Mlit + (1 − ℓ) Munlit, 0, 8)`. (Amended 7 October, the owner's lamp decision, spec §4.1: at full level each group keeps its measured colour, which is the package's per-group colour, `capture.colours` and `lamps.groups[g].colour` from Task 4b's refit, never a constant; how a group's colour changes as it dims, the warm-down Blake chose, is a setting, t, never a package value.)
- Hidden (class 2: outside the hall, the environment shell, pane haze): alpha 0.
- Covered by a skin (class 7; amended for R1c): lit exactly as class 0 (`M = clamp(E / max(Ecap, 1e-4), 1/16, 8)`); alpha 0 while its wall group (bits 5–7) is drawn as skins (bit `group` of the visibility's `skin_groups`), else 1.
- Toggled (any class but 7 with bits 6–7 = t > 0; amended for R1c): alpha 0 while the toggle is hidden (bit `t − 1` of the visibility's `hidden_toggles`); otherwise its class's rule. The visibility defaults to nothing drawn and nothing hidden, so a package without skins or toggles is relit exactly as before.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `docs/engineering/relight-package.md` | Create | The package contract (read by R1b) |
| `tools/relight/README.md` | Create | How to run the bake and publish |
| `tools/relight/config/grand-hall.json` | Create | Every input path and room constant |
| `tools/relight/relight/__init__.py` | Create | Package marker |
| `tools/relight/relight/__main__.py` | Create | CLI: `proof`, `windows`, `check-sun`, `probes`, `floor`, `sun-bounce` (Task 4 as built), `refit-house` (Task 4b), `skin-light`, `record-artifacts` (Task 4c), `records`, `check` (`sun-area` was removed by Task 4) |
| `tools/relight/relight/config.py` | Create | Load and validate the config |
| `tools/relight/relight/gpulock.py` | Create | The shared GPU lock |
| `tools/relight/relight/codec.py` | Create | Log codes, octahedral normals, flags (R1c's class 7 and toggles, Task 4c), records, multiplier packing |
| `tools/relight/relight/windows.py` | Create | Window volumes and their march, horizons, Fresnel table, the sky band's reach (Sun and Moon), the direction grid and its corners |
| `tools/relight/relight/probes.py` | Create | Per-source bounce probes, cube luminance |
| `tools/relight/relight/sunbounce.py` | Create (Task 4 as built) | The sky bodies' factored bounce: exact window powers, the basis and coefficient table, K by the stable margin rule |
| `tools/relight/relight/moon.py` | Create (Task 4 as built) | The Moon's position (Meeus) |
| `tools/relight/relight/floorlight.py` | Create | Floor light maps on the floor-skin grid |
| `tools/relight/relight/housefit.py` | Create (Task 4b) | The house lights refitted from the bulb table; `bulb-intensities.json` |
| `tools/relight/relight/skinlight.py` | Create (Task 4c) | R1c's skins' light and relight package v2's skins section |
| `tools/relight/relight/records.py` | Create | Finest-level records, transfer to coarser levels, R1c's covers and toggles |
| `tools/relight/relight/reference.py` | Create | The normative multiplier in numpy, both sky bodies |
| `tools/relight/relight/package.py` | Create | Write tiles, probes, window volumes, the sky bodies' basis, maps, manifest, checksums, from exact hash-checked artifacts |
| `tools/relight/proof/*.py` | Create (moved) | The proof's scripts, paths from the config only (`shots.py` moved by Task 4b) |
| `tools/relight/tests/test_*.py` | Create | Unit tests |
| `tools/floor-skin/build_floor_skin.py`, `tools/floor-skin/README.md` | Modify | Arm R (restored albedo) with luminance calibration |
| `packages/web/src/lib/relight/__fixtures__/relight-vectors.json` | Create | Test vectors for R1b |
| The day's session log under `docs/sessions/`, `docs/state/tasks.md` | Modify | Record the bake |

---

### Task 0: Baseline

**Files:** none.

- [ ] **Step 1: Check the branch and the inputs**

Run:

```bash
cd D:/claude/real-hall/repo && git status --short && git log --oneline -1
C:/Python313/python.exe -c "import numpy, torch, scipy, PIL, cv2; print(numpy.__version__, torch.__version__, torch.cuda.is_available(), scipy.__version__)"
ls D:/claude/splats/trades-hall/grand-hall/*.sog | wc -l
ls D:/claude/splat-quality-20260923/canonical-frame-court/canonical_frame.json D:/claude/splat-quality-20260923/weather-daylight/horizon.json D:/claude/real-hall/renovation/relight/work/fit.json
```

Expected: clean tree; numpy 2.4.x, torch 2.9.x, `True`; 24 tiles; the three files exist.

- [ ] **Step 2: Check space**

Run: `powershell -NoProfile -Command "'C GB ' + [math]::Round((Get-PSDrive C).Free/1GB) + ' D GB ' + [math]::Round((Get-PSDrive D).Free/1GB)"`
Expected: D: has at least 200 GB free. If C: has under 20 GB, tell the controller before any GPU step: the pagefile lives on C:.

### Task 1: The package contract and the codec

**Files:**
- Create: `docs/engineering/relight-package.md`, `tools/relight/relight/__init__.py`, `tools/relight/relight/codec.py`, `tools/relight/tests/__init__.py`, `tools/relight/tests/test_codec.py`

**Interfaces:**
- Produces: `codec.SOURCES`, `codec.RECORD_BYTES = 12`, `encode_log(values, lo, hi) -> uint8`, `decode_log(codes, lo, hi) -> float64`, `source_range(values) -> (lo, hi)`, `encode_octahedral((N,3)) -> (N,2) uint8`, `decode_octahedral((N,2)) -> (N,3)`, `pack_records(direct (N,9), normals (N,3), flags (N,), ranges) -> bytes`, `unpack_records(buf, ranges) -> (direct, normals, flags)`, `pack_multiplier(rgb (N,3), alpha (N,)) -> (N,) uint32`, `unpack_multiplier(words) -> (rgb, alpha)`, and the class and flag constants.

- [ ] **Step 1: Write the failing tests**

`tools/relight/tests/__init__.py` is empty. `tools/relight/tests/test_codec.py`:

```python
import unittest
import numpy as np
from relight import codec


class LogCodes(unittest.TestCase):
    def test_round_trip_within_a_twentieth_of_a_stop(self):
        rng = np.random.default_rng(1)
        lo, hi = -20.0, 5.0
        v = np.exp2(rng.uniform(lo, hi, 100_000))
        back = codec.decode_log(codec.encode_log(v, lo, hi), lo, hi)
        self.assertLessEqual(float(np.abs(np.log2(back) - np.log2(v)).max()), 0.05)

    def test_zero_is_code_zero_and_decodes_to_zero(self):
        c = codec.encode_log(np.array([0.0, -1.0, 1e-30]), -25.0, 0.0)
        self.assertEqual(c.tolist(), [0, 0, 1])
        self.assertEqual(codec.decode_log(np.array([0]), -25.0, 0.0).tolist(), [0.0])

    def test_source_range_spans_25_stops_below_the_maximum(self):
        lo, hi = codec.source_range(np.array([0.0, 0.3, 5.0]))
        self.assertEqual((lo, hi), (-22.0, 3.0))

    def test_empty_source_has_a_valid_range(self):
        self.assertEqual(codec.source_range(np.zeros(4)), (-25.0, 0.0))


class Normals(unittest.TestCase):
    def test_octahedral_round_trip_within_two_degrees(self):
        rng = np.random.default_rng(2)
        n = rng.normal(size=(50_000, 3)); n /= np.linalg.norm(n, axis=1, keepdims=True)
        back = codec.decode_octahedral(codec.encode_octahedral(n))
        ang = np.degrees(np.arccos(np.clip((n * back).sum(1), -1, 1)))
        self.assertLessEqual(float(ang.max()), 2.0)

    def test_axis_normals_are_exact_enough(self):
        n = np.array([[0, 0, 1.0], [0, 0, -1.0], [1.0, 0, 0], [0, -1.0, 0]])
        back = codec.decode_octahedral(codec.encode_octahedral(n))
        self.assertTrue(np.allclose(back, n, atol=0.01))


class Records(unittest.TestCase):
    def test_records_round_trip(self):
        rng = np.random.default_rng(3)
        direct = np.exp2(rng.uniform(-10, 2, size=(1000, 9))); direct[::7, 3] = 0.0
        normals = rng.normal(size=(1000, 3)); normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        flags = rng.integers(0, 256, 1000).astype(np.uint8)
        ranges = [codec.source_range(direct[:, k]) for k in range(9)]
        buf = codec.pack_records(direct, normals, flags, ranges)
        self.assertEqual(len(buf), 1000 * codec.RECORD_BYTES)
        d2, n2, f2 = codec.unpack_records(buf, ranges)
        ok = direct > 0
        self.assertTrue(np.array_equal(d2 == 0, ~ok))
        self.assertLessEqual(float(np.abs(np.log2(d2[ok]) - np.log2(direct[ok])).max()), 0.05)
        self.assertTrue(np.array_equal(f2, flags))

    def test_flags_layout(self):
        self.assertEqual(codec.CLASS_MASK, 0b111)
        self.assertEqual((codec.FLAG_ISO, codec.FLAG_SUN, codec.FLAG_CH_CENTRE), (8, 16, 32))


class Multipliers(unittest.TestCase):
    def test_multiplier_words_round_trip(self):
        rgb = np.array([[1.0, 0.5, 8.0], [1 / 16, 2.0, 0.0], [3.0, 3.0, 3.0]])
        alpha = np.array([1.0, 1.0, 0.0])
        words = codec.pack_multiplier(rgb, alpha)
        self.assertEqual(words.dtype, np.uint32)
        back, a = codec.unpack_multiplier(words)
        nz = rgb > 0
        self.assertLessEqual(float(np.abs(np.log2(back[nz]) - np.log2(rgb[nz])).max()), 0.05)
        self.assertEqual(float(back[1, 2]), 0.0)
        self.assertEqual(a.tolist(), [1.0, 1.0, 0.0])

    def test_multipliers_are_clamped_to_the_spec_range(self):
        back, _ = codec.unpack_multiplier(codec.pack_multiplier(np.array([[100.0, 1e-9, 1.0]]), np.array([1.0])))
        self.assertAlmostEqual(float(back[0, 0]), 8.0, places=6)
        self.assertAlmostEqual(float(back[0, 1]), 1 / 16, places=6)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest discover -s tests -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'relight'` (or `codec`).

- [ ] **Step 3: Write the codec**

`tools/relight/relight/__init__.py`:

```python
"""Offline light bake for the Restored Hall (T-639 R1a)."""
```

`tools/relight/relight/codec.py`:

```python
"""Byte codec of the relight package (docs/engineering/relight-package.md).

A record is 12 bytes per splat: nine log-coded direct-light values (one per source,
in SOURCES order), an octahedral normal (2 bytes) and a flags byte. A log code is 0 for
zero and 1..255 for 2**lo .. 2**hi, evenly spaced in log2.
"""
from __future__ import annotations

import numpy as np

SOURCES = ("W1", "W2", "W3", "W4", "W5", "cove", "ch_end", "ch_centre", "dome")
RECORD_BYTES = 12
LOG_STEPS = 254
SOURCE_SPAN_STOPS = 25.0

CLASS_MASK = 0b0000_0111
CLASS_INTERIOR = 0
CLASS_EMBRASURE = 1
CLASS_HIDDEN = 2
CLASS_CH_EMITTER = 3
CLASS_DOME_EMITTER = 4
CLASS_COVE = 5
CLASS_CH_FIXTURE = 6
FLAG_ISO = 1 << 3
FLAG_SUN = 1 << 4
FLAG_CH_CENTRE = 1 << 5

MULT_LO, MULT_HI = -4.0, 3.0   # 1/16 .. 8, the spec's clamp


def encode_log(values, lo: float, hi: float) -> np.ndarray:
    if not hi > lo:
        raise ValueError("hi must exceed lo")
    v = np.asarray(values, dtype=np.float64)
    out = np.zeros(v.shape, dtype=np.uint8)
    pos = v > 0
    t = (np.log2(np.where(pos, v, 1.0)) - lo) / (hi - lo)
    code = 1 + np.rint(np.clip(t, 0.0, 1.0) * LOG_STEPS)
    out[pos] = code[pos].astype(np.uint8)
    return out


def decode_log(codes, lo: float, hi: float) -> np.ndarray:
    c = np.asarray(codes, dtype=np.float64)
    return np.where(c > 0, np.exp2(lo + (c - 1.0) * (hi - lo) / LOG_STEPS), 0.0)


def source_range(values) -> tuple[float, float]:
    v = np.asarray(values, dtype=np.float64)
    v = v[v > 0]
    if v.size == 0:
        return (-SOURCE_SPAN_STOPS, 0.0)
    hi = float(np.ceil(np.log2(v.max())))
    return (hi - SOURCE_SPAN_STOPS, hi)


def _sgn(a: np.ndarray) -> np.ndarray:
    return np.where(a >= 0.0, 1.0, -1.0)


def encode_octahedral(normals) -> np.ndarray:
    n = np.asarray(normals, dtype=np.float64)
    n = n / np.maximum(np.abs(n).sum(axis=1, keepdims=True), 1e-12)
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    u = np.where(z >= 0, x, (1.0 - np.abs(y)) * _sgn(x))
    v = np.where(z >= 0, y, (1.0 - np.abs(x)) * _sgn(y))
    return np.stack([np.rint((u * 0.5 + 0.5) * 255.0), np.rint((v * 0.5 + 0.5) * 255.0)], axis=1).astype(np.uint8)


def decode_octahedral(codes) -> np.ndarray:
    c = np.asarray(codes, dtype=np.float64) / 255.0 * 2.0 - 1.0
    u, v = c[:, 0], c[:, 1]
    z = 1.0 - np.abs(u) - np.abs(v)
    x = np.where(z < 0, (1.0 - np.abs(v)) * _sgn(u), u)
    y = np.where(z < 0, (1.0 - np.abs(u)) * _sgn(v), v)
    n = np.stack([x, y, z], axis=1)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


def pack_records(direct, normals, flags, ranges) -> bytes:
    d = np.asarray(direct, dtype=np.float64)
    if d.ndim != 2 or d.shape[1] != len(SOURCES) or len(ranges) != len(SOURCES):
        raise ValueError("direct light must be (N, 9) with nine ranges")
    rec = np.empty((d.shape[0], RECORD_BYTES), dtype=np.uint8)
    for k, (lo, hi) in enumerate(ranges):
        rec[:, k] = encode_log(d[:, k], lo, hi)
    rec[:, 9:11] = encode_octahedral(normals)
    rec[:, 11] = np.asarray(flags, dtype=np.uint8)
    return rec.tobytes()


def unpack_records(buf, ranges):
    rec = np.frombuffer(buf, dtype=np.uint8).reshape(-1, RECORD_BYTES)
    direct = np.stack([decode_log(rec[:, k], *ranges[k]) for k in range(len(SOURCES))], axis=1)
    return direct, decode_octahedral(rec[:, 9:11]), rec[:, 11].copy()


def pack_multiplier(rgb, alpha) -> np.ndarray:
    m = np.clip(np.asarray(rgb, dtype=np.float64), 0.0, 2.0 ** MULT_HI)
    m = np.where(m > 0, np.maximum(m, 2.0 ** MULT_LO), 0.0)
    codes = encode_log(m, MULT_LO, MULT_HI).astype(np.uint32)
    a = np.rint(np.clip(np.asarray(alpha, dtype=np.float64), 0.0, 1.0) * 255.0).astype(np.uint32)
    return codes[:, 0] | (codes[:, 1] << 8) | (codes[:, 2] << 16) | (a << 24)


def unpack_multiplier(words):
    w = np.asarray(words, dtype=np.uint32)
    codes = np.stack([(w >> s) & 0xFF for s in (0, 8, 16)], axis=1)
    return decode_log(codes, MULT_LO, MULT_HI), ((w >> 24) & 0xFF) / 255.0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest discover -s tests -v`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the contract**

`docs/engineering/relight-package.md`:

````markdown
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
| `windows/<id>-glass.png`, `windows/<id>-inner.png` | 8-bit transmittance stencils, row 0 at the top of the opening |
| `floor/light-0.png` … `light-2.png` | RGBA8 log-coded direct light of the nine sources on the floor grid (0: W1–W4, 1: W5, cove, ch_end, ch_centre, 2: dome, unused ×3) |

## Record (12 bytes per splat)

| Bytes | Meaning |
|---|---|
| 0–8 | Direct light of W1, W2, W3, W4, W5, cove, ch_end, ch_centre, dome: log code, 0 = zero, 1..255 = `2^(lo + (code − 1)(hi − lo)/254)` with the source's `lo`, `hi` from `encoding.sources` |
| 9–10 | Surface normal in the model frame, octahedral: `u = byte9/255·2 − 1`, `v = byte10/255·2 − 1` |
| 11 | Flags: bits 0–2 class (0 interior, 1 embrasure, 2 hidden, 3 chandelier bulb, 4 dome lamp, 5 cove strip, 6 chandelier fixture); bit 3 isotropic receiver; bit 4 reachable by the sun; bit 5 chandelier group centre (else end) |

## Manifest (fields)

- `schema`: `"venviewer.relight.v1"`; `room`; `createdAt`; `tool` (the repo commit that built it).
- `model`: `{ frame: "e57", tileToModel: 4×4 row-major }`.
- `site`: `{ latitude, longitude, north: [x,y,z], east: [x,y,z], up: [0,0,1] }` in the model frame.
- `sources`: the nine names in record order.
- `encoding`: `{ record: 12, sources: [[lo, hi] × 9], floor: [[lo, hi] × 9], multiplier: { lo: -4, hi: 3 } }`.
- `capture`: `{ weights: [9], colours: [[r,g,b] × 9], daylightColour: [r,g,b], skyBandWeights: [0.15, 0.66, 1.0, 1.21], gamma: 1 }`.
- `lamps`: `{ measuredColour: [r,g,b], cct: number, groups: { cove: 5, ch_end: 6, ch_centre: 7, dome: 8 } }` (the source index of each lamp group).
- `sun`: `{ bounce: { beta: number, skyFlux: [5] }, fresnel: [101 values for |cos| 0.00..1.00] }`.
- `windows`: per window `{ id, glassDepth, outline: { x0, x1, sill, top, kind }, planes: { inner: Plane, glass: Plane }, horizon: [360 elevations in degrees, by azimuth 0..359] }`, where `Plane = { origin, u, v, width, height, normal, stencil, stencilSize: [w, h] }` in the model frame.
- `probes`: `{ origin: [x,y,z], spacing: number, shape: [nx, ny, nz], file, validFile }` (axis-aligned in the model frame).
- `floor`: `{ skin: "floor-skin/v2", texelToModel: 4×4 row-major, texel: 0.05, size: [w, h], files: [3] }`.
- `tiles`: `[{ tile, tileSha256, level, count, file, sha256, bytes }]` for every served tile.
- `presetsFromProof`: the three proof scenarios' settings (night, sunny morning 31 May 09:00 BST, overcast noon), as `05_relight.SCENARIOS` defines them.
- `evidence`: `{ capturedIdentity, proofRegression, transfer, determinism, stencilSun, sunBounce }`.
- `files`: `{ <path>: { sha256, bytes } }` for every file except the manifest.

## The multiplier

Normative text: `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`, section "The multiplier".
Executable definition: `tools/relight/relight/reference.py`. The browser packs it per splat as a 32-bit word:
bits 0–7, 8–15 and 16–23 are the log codes of R, G and B over `[2^-4, 2^3]` (0 = zero); bits 24–31 are alpha.
````

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo
git add docs/engineering/relight-package.md tools/relight/relight/__init__.py tools/relight/relight/codec.py tools/relight/tests/__init__.py tools/relight/tests/test_codec.py
git diff --cached --stat
git commit -m "feat(relight): the relight package contract and its byte codec (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**As built (29 September; noted 7 October).** Committed as `ec4dd7bf` exactly as written, except that `test_codec.py` holds 10 tests (Step 4's "11" miscounted the file above, which has 10). The contract Step 5 wrote is revised in place by later tasks (3 October: window volumes; 7 October: the sky-body bounce, the lamp groups, records for skins and toggles, package v2); Step 5 keeps the text it first wrote. Task 4c adds R1c's record classes to `codec.py` (class 7 and the toggle bits).

### Task 2: The proof's light model, moved into the repo

**Files:**
- Create: `tools/relight/config/grand-hall.json`, `tools/relight/relight/config.py`, `tools/relight/relight/gpulock.py`, `tools/relight/relight/__main__.py`, `tools/relight/tests/test_config.py`
- Create (moved): `tools/relight/proof/` with the proof scripts `common.py`, `lt.py`, `radiosity.py`, `store.py`, `01_extract.py`, `02_geometry.py`, `02b_occ_e57.py`, `02c_cookie.py`, `03_bases.py`, `03b_window_fresnel.py`, `03c_embrasure_roomside.py`, `03d_embrasure_back.py`, `04_fit.py`, `05_relight.py`, `07_compare.py`, `pano_view.py`

**Interfaces:**
- Produces: `config.load(path) -> Config` (a frozen dataclass with `paths` and `room` dicts); `gpulock.hold(owner)` context manager; the CLI `python -m relight proof <step>` for steps `extract geometry occupancy cookie bases fresnel embrasure-room embrasure-back fit` (or `all`); the proof's work tables in `<work>/npy/*.npy` with the proof's names and shapes (`splats_pos` (N,3) f32 e57, `geom_cls` (N,) u8, `geom_chand_id` (N,) i8, `bases_E_win` (N,20) f16, `bases_E_ch` (N,2), `bases_E_dome` (N,), `bases_E_cove` (N,), `bases_n` (N,3), `bases_iso` (N,), `splats_tile` (N,) u8, `splats_opa`, `splats_rgb`, `splats_scl`, `E_cap` (N,3)), and `<work>/fit.json`, `probes.npz`, `patches.npz`, `occ_cookie.npz`, `fit_state.npz`.

- [ ] **Step 1: Write the failing config test**

`tools/relight/tests/test_config.py`:

```python
import json, os, tempfile, unittest
from relight import config

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Config(unittest.TestCase):
    def write(self, data):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, f); f.close()
        self.addCleanup(os.unlink, f.name)
        return f.name

    def test_loads_the_grand_hall_config(self):
        cfg = config.load(os.path.join(HERE, "config", "grand-hall.json"))
        self.assertEqual(cfg.room["slug"], "grand-hall")
        self.assertEqual(len(cfg.room["windows"]), 5)
        self.assertTrue(cfg.paths["work"].startswith("D:/"))

    def test_refuses_a_missing_key(self):
        with self.assertRaises(ValueError):
            config.load(self.write({"schema": "venviewer.relight-config.v1", "paths": {}, "room": {}}))

    def test_refuses_outputs_on_c(self):
        data = json.load(open(os.path.join(HERE, "config", "grand-hall.json")))
        data["paths"]["work"] = "C:/tmp/relight"
        with self.assertRaises(ValueError):
            config.load(self.write(data))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_config -v`
Expected: FAIL, no module `relight.config`.

- [ ] **Step 3: Write the config, loader and lock**

`tools/relight/config/grand-hall.json` (constants copied from the proof's `common.py`):

```json
{
  "schema": "venviewer.relight-config.v1",
  "paths": {
    "splats": "D:/claude/splats/trades-hall/grand-hall",
    "canonicalFrame": "D:/claude/splat-quality-20260923/canonical-frame-court/canonical_frame.json",
    "audit": "D:/claude/splat-quality-20260923/capture-lighting-audit",
    "horizon": "D:/claude/splat-quality-20260923/weather-daylight/horizon.json",
    "proofWork": "D:/claude/real-hall/renovation/relight/work",
    "work": "D:/claude/relight/grand-hall/work",
    "out": "D:/claude/splats/trades-hall/grand-hall/relight/v1",
    "evidence": "D:/claude/relight/grand-hall/evidence",
    "floorSkin": "D:/claude/splats/trades-hall/grand-hall/floor-skin/v1",
    "bundle": "packages/web/src/data/generated/trades-hall-splat-bundles.ts",
    "repo": "D:/claude/real-hall/repo"
  },
  "room": {
    "slug": "grand-hall",
    "site": { "latitude": 55.8593, "longitude": -4.2491, "xBearingDeg": 14.3 },
    "hallE57": { "x0": -1.823, "x1": 19.307, "y0": -10.329, "y1": 0.301, "floorZ": 0.02, "ceilingZ": 6.78 },
    "windows": {
      "W1": [-1.60, 1.15, 0.85, 0.90, 5.35, "arch"],
      "W2": [3.20, 4.70, 0.63, 0.95, 3.35, "rect"],
      "W3": [7.30, 10.45, 0.50, 0.50, 5.50, "arch"],
      "W4": [12.90, 14.50, 0.63, 0.90, 3.35, "rect"],
      "W5": [16.30, 19.10, 0.85, 0.85, 5.30, "arch"]
    },
    "finestTiles": ["env.sog", "0_0_0_1_0_1.sog", "0_1_0_1_0_0.sog", "0_2_0_0_1_1.sog", "0_3_0_0_0_0.sog", "0_3_0_1_0_1.sog",
                    "0_4_0_1_0_0.sog", "0_5_0_0_0_1.sog", "0_5_0_1_0_1.sog", "0_6_0_0_0_1.sog", "0_7_0_0_0_0.sog", "0_7_0_0_0_1.sog"],
    "manifestTranslation": [4.911651, 2.2253407083333334, -8.571432999999999],
    "probeSpacing": 0.5,
    "floorTexel": 0.05,
    "transferNeighbours": 8
  }
}
```

`tools/relight/relight/config.py`:

```python
"""The bake's configuration: every input path and room constant in one JSON file."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

SCHEMA = "venviewer.relight-config.v1"
PATH_KEYS = ("splats", "canonicalFrame", "audit", "horizon", "proofWork", "work", "out", "evidence", "floorSkin", "bundle", "repo")
ROOM_KEYS = ("slug", "site", "hallE57", "windows", "finestTiles", "manifestTranslation", "probeSpacing", "floorTexel", "transferNeighbours")
OUTPUT_KEYS = ("work", "out", "evidence")


@dataclass(frozen=True)
class Config:
    paths: dict[str, str]
    room: dict[str, Any]


def load(path: str) -> Config:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("schema") != SCHEMA:
        raise ValueError(f"config schema must be {SCHEMA}")
    paths, room = data.get("paths", {}), data.get("room", {})
    missing = [k for k in PATH_KEYS if k not in paths] + [k for k in ROOM_KEYS if k not in room]
    if missing:
        raise ValueError("config is missing: " + ", ".join(missing))
    for key in OUTPUT_KEYS:
        if not paths[key].upper().startswith("D:/"):
            raise ValueError(f"{key} must be on D: (C: fills up; see the plan's constraints)")
    if sorted(room["windows"]) != ["W1", "W2", "W3", "W4", "W5"]:
        raise ValueError("the Grand Hall has windows W1..W5")
    return Config(paths=dict(paths), room=dict(room))
```

`tools/relight/relight/gpulock.py`:

```python
"""The build PC's shared GPU lock (one GPU-heavy job at a time)."""
from __future__ import annotations

import contextlib, datetime, json, os, time

LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock"


@contextlib.contextmanager
def hold(owner: str, poll_s: float = 5.0):
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            time.sleep(poll_s)
    with os.fdopen(fd, "w") as f:
        json.dump({"owner": owner, "since": datetime.datetime.now().astimezone().isoformat()}, f)
    try:
        yield
    finally:
        os.remove(LOCK)
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_config -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Move the proof's scripts**

Copy byte for byte, then edit only as the next step says:

```bash
mkdir -p D:/claude/real-hall/repo/tools/relight/proof
cd D:/claude/real-hall/renovation/relight/scripts
cp common.py lt.py radiosity.py store.py 01_extract.py 02_geometry.py 02b_occ_e57.py 02c_cookie.py 03_bases.py 03b_window_fresnel.py 03c_embrasure_roomside.py 03d_embrasure_back.py 04_fit.py 05_relight.py 07_compare.py pano_view.py D:/claude/real-hall/repo/tools/relight/proof/
```

- [ ] **Step 6: Point the scripts at the config**

In `tools/relight/proof/common.py`, replace the block from `ROOT = ` through `REPO = `, and the `TILES`, `MANIFEST_T`, `X0, X1, Y0, Y1`, `FLOOR_Z`, `CEIL_Z` and `WINDOWS` literals, with reads from the config named by `RELIGHT_CONFIG`:

```python
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from relight import config as _config  # noqa: E402

CFG = _config.load(os.environ["RELIGHT_CONFIG"])
ROOT = os.path.dirname(CFG.paths["work"])
WORK = CFG.paths["work"]
SPLATS = CFG.paths["splats"]
CANON = CFG.paths["canonicalFrame"]
AUDIT = CFG.paths["audit"]
REPO = CFG.paths["repo"]
TILES = list(CFG.room["finestTiles"])
MANIFEST_T = np.array(CFG.room["manifestTranslation"])
_h = CFG.room["hallE57"]
X0, X1, Y0, Y1 = _h["x0"], _h["x1"], _h["y0"], _h["y1"]
FLOOR_Z = _h["floorZ"]
CEIL_Z = _h["ceilingZ"]
FACADE_NORMAL_BEARING = 104.3
WINDOWS = {k: tuple(v) for k, v in CFG.room["windows"].items()}
```

In `tools/relight/proof/lt.py`, replace `HORIZON_FILE = "…"` with `HORIZON_FILE = CFG.paths["horizon"]`. Then list every remaining literal path:

Run: `cd D:/claude/real-hall/repo/tools/relight/proof && grep -nE "[A-Z]:/" *.py`
Expected: no hits once done. Replace each hit with the matching `CFG.paths[...]` entry. The Matterport panoramas used by `pano_view.py` and `07_compare.py` live under the audit folder (`CFG.paths["audit"]`); if a hit names an input the config lacks, add a `paths` key for it and add that key to `PATH_KEYS`.

- [ ] **Step 7: Write the CLI**

`tools/relight/relight/__main__.py` (later tasks add commands to `COMMANDS`):

```python
"""python -m relight <command> [step] --config config/grand-hall.json"""
from __future__ import annotations

import argparse, os, runpy, sys

from . import config, gpulock

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROOF = os.path.join(HERE, "proof")
# proof step -> (script, needs the GPU)
PROOF_STEPS = {
    "extract": ("01_extract.py", False),
    "geometry": ("02_geometry.py", True),
    "occupancy": ("02b_occ_e57.py", False),
    "cookie": ("02c_cookie.py", False),
    "bases": ("03_bases.py", True),
    "fresnel": ("03b_window_fresnel.py", True),
    "embrasure-room": ("03c_embrasure_roomside.py", True),
    "embrasure-back": ("03d_embrasure_back.py", True),
    "fit": ("04_fit.py", True),
}
COMMANDS: dict = {}


def use_proof(cfg_path: str) -> None:
    """Make the moved proof scripts importable with the given config."""
    os.environ["RELIGHT_CONFIG"] = os.path.abspath(cfg_path)
    if PROOF not in sys.path:
        sys.path.insert(0, PROOF)


def run_proof(step: str, cfg_path: str) -> None:
    script, gpu = PROOF_STEPS[step]
    use_proof(cfg_path)
    old = os.getcwd()
    os.chdir(PROOF)
    try:
        if gpu:
            with gpulock.hold(f"relight-bake {step}"):
                runpy.run_path(os.path.join(PROOF, script), run_name="__main__")
        else:
            runpy.run_path(os.path.join(PROOF, script), run_name="__main__")
    finally:
        os.chdir(old)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="relight")
    ap.add_argument("command")
    ap.add_argument("step", nargs="?")
    ap.add_argument("--config", required=True)
    args = ap.parse_args(argv)
    cfg = config.load(args.config)
    os.makedirs(cfg.paths["work"], exist_ok=True)
    os.makedirs(cfg.paths["evidence"], exist_ok=True)
    if args.command == "proof":
        steps = list(PROOF_STEPS) if args.step in (None, "all") else [args.step]
        for step in steps:
            print(f"== proof {step}", flush=True)
            run_proof(step, args.config)
        return 0
    if args.command in COMMANDS:
        use_proof(args.config)
        return COMMANDS[args.command](cfg, args)
    ap.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

Later tasks register commands by appending `from .commands_<name> import register` style functions; to keep the CLI one file, they add their function above `if __name__ == "__main__":` and a line `COMMANDS["<name>"] = <function>`.

- [ ] **Step 8: Run the moved light model**

Run (hours; the GPU steps wait for the lock by themselves):

```bash
cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight proof all --config config/grand-hall.json 2>&1 | tee D:/claude/relight/grand-hall/evidence/proof-run.log
```

Expected: each step prints its progress and ends without a traceback; `D:/claude/relight/grand-hall/work/` holds `fit.json`, `probes.npz`, `patches.npz`, `occ_cookie.npz`, `fit_state.npz` and the `npy/` tables.

- [ ] **Step 9: Check the move reproduces the proof**

Run:

```bash
C:/Python313/python.exe - <<'EOF'
import json, numpy as np
a = json.load(open("D:/claude/real-hall/renovation/relight/work/fit.json")); b = json.load(open("D:/claude/relight/grand-hall/work/fit.json"))
wa, wb = np.array(a["weights"]), np.array(b["weights"])
print("bases", a["bases"] == b["bases"], "max weight change", float(np.max(np.abs(wb - wa) / np.maximum(np.abs(wa), 1e-6))))
ea = np.load("D:/claude/real-hall/renovation/relight/work/npy/E_cap.npy", mmap_mode="r"); eb = np.load("D:/claude/relight/grand-hall/work/npy/E_cap.npy", mmap_mode="r")
i = np.arange(0, ea.shape[0], 97)
la, lb = np.asarray(ea[i]) @ [0.2126, 0.7152, 0.0722], np.asarray(eb[i]) @ [0.2126, 0.7152, 0.0722]
ok = (la > 1e-6) & (lb > 1e-6)
print("N", ea.shape[0], eb.shape[0], "median |dlog2 Ecap|", float(np.median(np.abs(np.log2(lb[ok]) - np.log2(la[ok])))))
EOF
```

Expected: `bases True`, maximum relative weight change ≤ 0.01, `N 6030980 6030980`, median |Δlog2 Ecap| ≤ 0.02. Save the printout as `D:/claude/relight/grand-hall/evidence/proof-reproduction.txt`. If a number misses, stop and report it: the move changed behaviour.

- [ ] **Step 10: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/config/grand-hall.json tools/relight/relight/config.py tools/relight/relight/gpulock.py tools/relight/relight/__main__.py tools/relight/tests/test_config.py tools/relight/proof
git diff --cached --stat
git commit -m "feat(relight): move the proof's light model into tools/relight, paths from one config (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**As built (30 September).** Execution found six issues in the text above. The committed code and the task report
(`task-2-report.md` in the SDD workspace) are the record:

- Step order: `extract geometry occupancy cookie bases tables fresnel lamp-colour fit embrasure-room embrasure-back`.
  `03c` and `03d` read `fit_state.npz`, which only `04_fit.py` writes, so the fit runs before them, as it did in the
  proof.
- `tables` splits every N-row array of `splats.npz`, `geom.npz` and `bases.npz` into `npy/<archive>_<key>.npy` (the
  proof did this with inline code that was not saved). `lamp-colour` validates the proof's measured
  `lamp_daylight_ratio.json` and copies it.
- Every proof step is CPU-only and takes no GPU lock. `gpulock.hold` removes only its own record
  (`tests/test_gpulock.py`).
- `paths.panoramas` names the Matterport panorama folder, which is not under the audit folder.
- Step 9's weight metric compares only weights at least 1e-6 in both fits. `ch_centre` sits at the solver's lower bound
  (about 1e-11), where the original metric turns an 8.5e-8 absolute change into 0.0855.
- This PC corrupts some computations under load. Run 1 had 21 wrong probe values out of 36 million. The data was rerun
  step by step in separate processes and checked array by array against the proof. Any difference is settled by a
  third run and a majority vote. Tasks 3 to 5 follow the same rule: each data-producing command runs twice, and the
  outputs must match byte for byte.

### Task 3: Windows: stencils, horizons and sun reach

**Files:**
- Create: `tools/relight/relight/windows.py`, `tools/relight/tests/test_windows.py`
- Modify: `tools/relight/relight/__main__.py` (register `windows`, `check-stencils`)

**Interfaces:**
- Consumes: `proof/lt.py` (`load_occ`, `horizon_deg`, `glass_t`, `sun_direct`), `proof/common.py` (`WINDOWS`, `Y0`, `X0`, `X1`, `Y1`, `FLOOR_Z`, `sun_vec_e57`, `solar_position`), `<work>/occ_cookie.npz` (`occ` (X,Y,Z) f16 alpha, `occ_lo` (3,), `occ_res`).
- Produces: `windows.Plane` (dataclass: `origin`, `u`, `v`, `width`, `height`, `normal`, `stencil` float32 (h, w) transmittance, row 0 at the top); `windows.stencils_from_occupancy(occ, lo, res, window, y0) -> (inner Plane, glass Plane)`; `windows.visibility(planes, P, sun) -> (N,) float32`; `windows.fresnel_table(glass_t) -> 101 floats`; `windows.horizon_table(horizon_fn, w_index) -> 360 floats`; `windows.sun_directions(...) -> (K,3)`; `windows.sun_reach(planes_by_window, P, directions) -> (N,) bool`; files `<work>/windows.npz` and `<evidence>/stencil-sun.json`.

- [ ] **Step 1: Write the failing tests**

`tools/relight/tests/test_windows.py` (synthetic data; no GPU, no D: inputs):

```python
import unittest
import numpy as np
from relight import windows


def plane(y, x0=0.0, x1=2.0, z0=1.0, z1=3.0, stencil=None):
    st = np.ones((20, 20), np.float32) if stencil is None else stencil
    return windows.Plane(origin=np.array([x0, y, z1]), u=np.array([1.0, 0, 0]), v=np.array([0, 0, -1.0]),
                         width=x1 - x0, height=z1 - z0, normal=np.array([0, -1.0, 0]), stencil=st)


class Visibility(unittest.TestCase):
    def test_a_ray_through_both_openings_is_lit(self):
        inner, glass = plane(0.0), plane(-0.5)
        v = windows.visibility((inner, glass), np.array([[1.0, 3.0, 2.0]]), np.array([0.0, -1.0, 0.0]))
        self.assertAlmostEqual(float(v[0]), 1.0, places=5)

    def test_a_ray_missing_the_glass_opening_is_dark(self):
        inner, glass = plane(0.0), plane(-0.5)
        sun = np.array([-0.8, -0.6, 0.0]) / np.linalg.norm([-0.8, -0.6, 0.0])
        # crosses the inner plane at x = 0.2 (inside), the glass plane at x = -0.47 (outside)
        v = windows.visibility((inner, glass), np.array([[2.2, 1.5, 2.0]]), sun)
        self.assertEqual(float(v[0]), 0.0)

    def test_stencils_multiply(self):
        st = np.full((20, 20), 0.5, np.float32)
        inner, glass = plane(0.0, stencil=st), plane(-0.5, stencil=st)
        v = windows.visibility((inner, glass), np.array([[1.0, 3.0, 2.0]]), np.array([0.0, -1.0, 0.0]))
        self.assertAlmostEqual(float(v[0]), 0.25, places=4)

    def test_sun_behind_the_wall_is_dark(self):
        inner, glass = plane(0.0), plane(-0.5)
        v = windows.visibility((inner, glass), np.array([[1.0, 3.0, 2.0]]), np.array([0.0, 1.0, 0.0]))
        self.assertEqual(float(v[0]), 0.0)


class Stencils(unittest.TestCase):
    def test_a_bar_at_the_glass_depth_lands_in_the_glass_stencil_only(self):
        res, lo = 0.03, np.array([0.0, -1.0, 0.0])
        occ = np.zeros((100, 34, 100), np.float32)
        occ[45:48, 16:18, :] = 0.99          # a vertical bar at x = 1.35..1.44, y = -0.52..-0.46 (the glass depth)
        window = (0.3, 2.7, 0.5, 0.3, 2.7, "rect")
        inner, glass = windows.stencils_from_occupancy(occ, lo, res, window, y0=0.0)
        col = int(round((1.4 - glass.origin[0]) / glass.width * (glass.stencil.shape[1] - 1)))
        self.assertLess(float(glass.stencil[:, col].mean()), 0.2)
        self.assertGreater(float(inner.stencil[:, col].mean()), 0.9)


class Tables(unittest.TestCase):
    def test_fresnel_table_has_101_entries_rising_to_normal_incidence(self):
        t = windows.fresnel_table(lambda c: 0.92 * c ** 0.1)
        self.assertEqual(len(t), 101)
        self.assertGreater(t[100], t[10])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: FAIL, no module `relight.windows`.

- [ ] **Step 3: Write the stencils and visibility**

`tools/relight/relight/windows.py`:

```python
"""Two-plane window stencils: the browser's live sun test (spec 4.3).

Each window is modelled by its room-side plane (the wall's inner face, y = y0) and its glass
plane (y = y0 - depth). The inner stencil is the transmittance of everything between the two
planes (curtains, columns, reveals) projected along the wall normal; the glass stencil is the
transmittance of the glazing bars and tracery within 4.5 cm of the glass. A ray toward the sun
is lit by their product where it crosses both planes inside the opening.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

GLASS_HALF_DEPTH = 0.045


@dataclass
class Plane:
    origin: np.ndarray   # top-left corner of the opening's bounding box
    u: np.ndarray        # unit, along the width
    v: np.ndarray        # unit, downward along the height
    width: float
    height: float
    normal: np.ndarray   # outward (toward the street)
    stencil: np.ndarray  # (h, w) float32 transmittance, row 0 at the top


def stencils_from_occupancy(occ, lo, res, window, y0):
    """occ (X, Y, Z) alpha in cells of `res` from corner `lo` (e57 frame); window = (x0, x1, depth, sill, top, kind)."""
    x0, x1, depth, sill, top, _kind = window
    dens = -np.log1p(-np.clip(occ.astype(np.float64), 0.0, 0.995))
    ix0, ix1 = max(int(np.floor((x0 - lo[0]) / res)), 0), min(int(np.ceil((x1 - lo[0]) / res)), occ.shape[0])
    iz0, iz1 = max(int(np.floor((sill - lo[2]) / res)), 0), min(int(np.ceil((top - lo[2]) / res)), occ.shape[2])
    yc = lo[1] + (np.arange(occ.shape[1]) + 0.5) * res
    y_glass = y0 - depth
    in_glass = np.abs(yc - y_glass) <= GLASS_HALF_DEPTH
    in_inner = (yc < y0) & (yc > y_glass + GLASS_HALF_DEPTH)
    slab = dens[ix0:ix1, :, iz0:iz1]
    glass = np.exp(-slab[:, in_glass, :].sum(axis=1)).astype(np.float32)     # (w, h), z upward
    inner = np.exp(-slab[:, in_inner, :].sum(axis=1)).astype(np.float32)
    glass, inner = glass.T[::-1].copy(), inner.T[::-1].copy()                 # (h, w), row 0 at the top
    width, height = (ix1 - ix0) * res, (iz1 - iz0) * res
    x_left, z_top = lo[0] + ix0 * res, lo[2] + iz1 * res
    u, v, n = np.array([1.0, 0, 0]), np.array([0, 0, -1.0]), np.array([0, -1.0, 0])
    return (Plane(np.array([x_left, y0, z_top]), u, v, width, height, n, inner),
            Plane(np.array([x_left, y_glass, z_top]), u, v, width, height, n, glass))


def _sample(plane: Plane, q: np.ndarray) -> np.ndarray:
    d = q - plane.origin
    a, b = d @ plane.u, d @ plane.v
    inside = (a >= 0) & (a <= plane.width) & (b >= 0) & (b <= plane.height)
    h, w = plane.stencil.shape
    col = np.clip(np.rint(a / plane.width * (w - 1)), 0, w - 1).astype(np.int64)
    row = np.clip(np.rint(b / plane.height * (h - 1)), 0, h - 1).astype(np.int64)
    return np.where(inside, plane.stencil[row, col], 0.0)


def visibility(planes, P, sun) -> np.ndarray:
    """Transmittance of the rays P + t sun (t > 0) through both planes of one window."""
    P = np.asarray(P, np.float64)
    sun = np.asarray(sun, np.float64)
    out = np.ones(len(P), np.float64)
    for plane in planes:
        denom = float(sun @ plane.normal)
        if denom <= 1e-6:
            return np.zeros(len(P), np.float32)
        t = ((plane.origin - P) @ plane.normal) / denom
        q = P + t[:, None] * sun[None]
        out *= np.where(t > 0, _sample(plane, q), 0.0)
    return out.astype(np.float32)


def fresnel_table(glass_t) -> list[float]:
    return [float(glass_t(c / 100.0)) for c in range(101)]


def horizon_table(horizon_fn, w_index: int) -> list[float]:
    return [float(horizon_fn(w_index, float(az))) for az in range(360)]


def sun_directions(solar_position, sun_vec, year=2026, step_min=15):
    """Unit sun vectors (model frame): the 21st of each month, 04:00-22:00 UTC every step_min minutes, sun up."""
    out = []
    for month in range(1, 13):
        for minute in range(4 * 60, 22 * 60, step_min):
            az, el = solar_position(year, month, 21, minute // 60, minute % 60)
            if el > 0.5:
                out.append(sun_vec(az, el))
    return np.array(out)


def sun_reach(planes_by_window, P, directions, chunk=500_000) -> np.ndarray:
    """True where some sun direction reaches P through some window (transmittance above 0.02)."""
    reach = np.zeros(len(P), bool)
    for a in range(0, len(P), chunk):
        Pc = P[a:a + chunk]
        r = np.zeros(len(Pc), bool)
        for s in directions:
            for planes in planes_by_window.values():
                r |= visibility(planes, Pc, s) > 0.02
        reach[a:a + chunk] = r
    return reach
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the `windows` command**

Add to `tools/relight/relight/__main__.py`, above `if __name__ == "__main__":`:

```python
def windows_planes(cfg):
    """{name: (inner, glass)} from <work>/windows.npz."""
    import numpy as np
    from . import windows as W
    wz = np.load(os.path.join(cfg.paths["work"], "windows.npz"))
    def plane(name, tag):
        f = wz[f"{name}_{tag}_frame"]
        return W.Plane(f[0:3], f[3:6], f[6:9], float(f[12]), float(f[13]), f[9:12], wz[f"{name}_{tag}_stencil"])
    return {n: (plane(n, "inner"), plane(n, "glass")) for n in ("W1", "W2", "W3", "W4", "W5")}, wz


def cmd_windows(cfg, args) -> int:
    import numpy as np
    import common, lt, torch
    from . import windows as W
    g = np.load(os.path.join(cfg.paths["work"], "occ_cookie.npz"))
    occ, lo, res = g["occ"].astype(np.float32), np.asarray(g["occ_lo"], np.float64), float(g["occ_res"])
    save = {}
    for i, name in enumerate(common.WINDOWS):
        inner, glass = W.stencils_from_occupancy(occ, lo, res, common.WINDOWS[name], common.Y0)
        for tag, p in (("inner", inner), ("glass", glass)):
            save[f"{name}_{tag}_stencil"] = p.stencil
            save[f"{name}_{tag}_frame"] = np.concatenate([p.origin, p.u, p.v, p.normal, [p.width, p.height]])
        save[f"{name}_horizon"] = np.array(W.horizon_table(
            lambda wi, az: float(lt.horizon_deg(torch.tensor([wi]), torch.tensor([az]))[0]), i), np.float32)
    save["fresnel"] = np.array(W.fresnel_table(lambda c: float(lt.glass_t(c))), np.float32)
    np.savez_compressed(os.path.join(cfg.paths["work"], "windows.npz"), **save)
    print("windows.npz written", flush=True)
    return 0


COMMANDS["windows"] = cmd_windows
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight windows --config config/grand-hall.json`
Expected: `windows.npz written`. (`lt.horizon_deg` and `lt.glass_t` take torch tensors or floats as the proof calls them; if a call signature differs, adapt the lambda, not the proof.)

- [ ] **Step 6: Check the two-plane sun against the proof's 3D march**

Add a `check-stencils` command:

```python
def cmd_check_stencils(cfg, args) -> int:
    import json
    import numpy as np
    import common, lt
    from . import windows as W
    planes, wz = windows_planes(cfg)
    xs = np.arange(common.X0 + 0.05, common.X1 - 0.05, 0.05); ys = np.arange(common.Y0 + 0.05, common.Y1 - 0.05, 0.05)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    P = np.stack([X.ravel(), Y.ravel(), np.full(X.size, common.FLOOR_Z + 0.02)], 1)
    occ = lt.load_occ("cookie")
    fres = wz["fresnel"]
    report = []
    for (y, mo, d, hh, mi) in [(2026, 5, 31, 8, 0), (2026, 6, 21, 6, 0), (2026, 6, 21, 9, 0), (2026, 3, 20, 9, 0), (2026, 12, 21, 10, 30)]:
        az, el = common.solar_position(y, mo, d, hh, mi)
        s = common.sun_vec_e57(az, el)
        t3 = lt.sun_direct(occ, P, s).numpy()          # the proof's 3D march, torch on the CPU
        t2 = sum(W.visibility(p, P, s) for p in planes.values()) * fres[int(round(min(abs(s[1]), 1.0) * 100))]
        a, b = t3 > 0.3, t2 > 0.3
        union = a | b
        report.append({"utc": f"{y}-{mo:02d}-{d:02d}T{hh:02d}:{mi:02d}", "az": round(float(az), 2), "el": round(float(el), 2),
                       "iou": round(float((a & b).sum() / max(union.sum(), 1)), 4),
                       "meanAbsDiff": round(float(np.abs(t3 - t2)[union].mean()) if union.any() else 0.0, 4),
                       "litCells3d": int(a.sum()), "litCells2plane": int(b.sum())})
    ok = all(r["iou"] >= 0.85 and r["meanAbsDiff"] <= 0.1 for r in report if r["litCells3d"] > 0)
    json.dump({"threshold": {"iou": 0.85, "meanAbsDiff": 0.1}, "pass": ok, "directions": report},
              open(os.path.join(cfg.paths["evidence"], "stencil-sun.json"), "w"), indent=1)
    print(json.dumps(report, indent=1), "PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


COMMANDS["check-stencils"] = cmd_check_stencils
```

Run: `C:/Python313/python.exe -m relight check-stencils --config config/grand-hall.json`
Expected: `PASS`: every direction with a lit floor has IoU ≥ 0.85 and mean |ΔT| ≤ 0.1. If it fails, report the per-direction numbers and stop; do not loosen the thresholds (the controller chooses between a third plane and accepting softer patches).

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/windows.py tools/relight/relight/__main__.py tools/relight/tests/test_windows.py
git diff --cached --stat
git commit -m "feat(relight): two-plane window stencils, horizons and the check against the 3D sun (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**As built (3 October).** The steps above build two-plane stencils, which cannot pass Step 6 in this hall; they stay as written. Task 3 v2 replaced them. Its report (`task-3-report.md` in the SDD workspace: "Task 3 v2: window volumes" and the design note "Window volumes (runtime twin of the proof's sun march)") and the code are the record:

- Why: the hall's occluders sit through the whole depth of each embrasure (curtains about 0.3 m in, W5's blind 10 cm before its glass, sash boxes, linings and shutters), so a shadow cast from either plane lands in the wrong place. Three real bugs were fixed first (the check's missing horizon gate, the stencils' missing outline and the proof's 5 cm and 3 cm margins, a half-texel sampling offset). Even then, against the proof's 3D march at the three lit check suns, two planes reached IoU 0.45–0.56, stencils fitted to the march 0.72–0.73, eight planes 0.73–0.81, and one plane per 3 cm layer failed 21 June 09:00 on mean |ΔT| (0.12 against 0.1). On 30 September the controller decided, and on 3 October confirmed, that the runtime marches each window's occupancy volume exactly as the proof does (spec amendment of 3 October).
- `windows.py` holds `WindowVolume` (a frozen dataclass: `name`, `origin`, `res`, `alpha` uint8 (nx, ny, nz) in x, y, z C order, `offset`, `grid_lo` float32, `x0`, `x1`, `depth`, `sill`, `top`, `kind`, `y0`, `x_bearing`) and `FRAME_FIELDS` (21: `origin_x..z`, `res`, `nx`, `ny`, `nz`, `x0`, `x1`, `depth`, `sill`, `top`, `arch`, `y0`, `x_bearing`, `offset_x..z`, `grid_lo_x..z`). Its constants are `STEP` 0.015, `CAP` 2.2, `BEYOND_GLASS` 0.07, `TAU_STOP` 6, `ENTRY_GROW` −0.05, `EXIT_GROW` −0.03, `EMBRASURE_REACH` 0.25, `EMBRASURE_SKIP` 0.045, `MIN_DOWN` 0.001, `ALPHA_MAX` 0.995 and `CHUNK`.
- Its functions: `inside_outline(x, z, window, grow)`; `reach_bounds`; `volumes_from_occupancy(occ, lo, res, windows, y0, *, x_bearing, quantise=True) -> {name: WindowVolume}`; `volume_arrays(vol) -> (alpha, frame)` and `volume_from_arrays(name, alpha, frame)`; `march_visibility(vol, P, s)` (one window alone: no horizon, no glass); `sun_visibility(volumes, horizon_tables, fresnel_table, P, s, steps=None)`, the multiplier's V (the first window that claims the ray, its horizon gate, the glass; `steps` receives the samples marched per point); `sunlit_area(vol, s)` (m²: the glass lit through the embrasure × |σy|; no horizon, no glass); `ray_survives(vol, P, s)`; the reach flag's `opening_directions`, `sun_band_meets` and `sun_reach(volumes, P, latitude)`; `sun_az_el(s, x_bearing)`, `horizon_at(horizon, az)` (linear between whole degrees), `above_horizon(horizon, s, x_bearing)` and `fresnel_at(fresnel, s)` (linear); `fresnel_table`, `horizon_table` and `sun_directions` (kept; no task calls `sun_directions` now). `Plane`, the stencils, `visibility` and `site_axes` are gone.
- The twin computes in float32 in the proof's order of operations, so it reproduces the proof's cells exactly. The 8-bit alpha is the one intended difference; `check-sun` also runs the twin on float alpha to separate the two.
- `__main__.py`: `windows` writes `<work>/windows.npz` (per window `{name}_alpha` uint8 (nx, ny, nz), `{name}_frame` float64 in `FRAME_FIELDS` order and `{name}_horizon` 360 float32 by compass azimuth; `fresnel` 101 float32). `windows_volumes(cfg) -> (volumes, horizons, fresnel)` loads it in the config's window order. `check-sun` replaces `check-stencils` and writes `<evidence>/sun-check.json`: the twin against `lt.sun_direct` on the floor grid and on 200,000 finest splats at the five check suns (IoU ≥ 0.85 and mean |ΔT| ≤ 0.1 wherever the proof lights cells), each sun's step counts (`stepsMean`, `stepsP99`, `stepsMax`), and the reach flag on every finest splat (`sunReach.flaggedShare`) with `missed == 0` over 48 random real suns. `_random_suns(common, n, seed)` draws suns facing the wall from the proof's own solar model.
- `tests/test_windows.py` has 26 tests on synthetic volumes; the suite runs 50.
- Phase B passed and was committed as `4f722bf4` (3 October). `check-sun` against the proof's `lt.sun_direct` at the five check suns, on the floor points and the 200,000 splats: IoU 0.9998–1.0000, mean |ΔT| at most 0.0005, max |ΔT| 0.0103, all of it the 8-bit alpha (with float alpha the max is 8e-6); no cell, step or claim differs from the proof. Both commands ran twice with identical outputs.
- Measured (`D:/claude/relight/grand-hall/evidence/sun-check.json` and the design note): the volumes are W1 182 × 33 × 186, W2 217 × 26 × 180, W3 271 × 22 × 187, W4 219 × 26 × 187 and W5 188 × 33 × 187 cells, 5,472,496 in all and 6.1% occupied; 5.47 MB as bytes and 196,028 bytes gzipped at level 9 (W1 54,129, W2 26,933, W3 38,117, W4 27,205, W5 49,644). The reach flag marks 82.9% of the 6,030,980 finest splats. A marched ray takes 14–37 samples on average at the lit check suns, 44–83 at the 99th percentile, against the hard bound of 147; 7.6–23.4% of the splat sample is marched at those suns. The GPU cost (about 1 ms per sun change on a desktop GPU, dominated by divergence) is an estimate; R1b Task 18 measures it.
- Interface for later tasks: Tasks 4 and 5 use `windows_volumes(cfg)`, `sun_visibility`, `sunlit_area`, `sun_reach`, `sun_az_el`, `horizon_at`, `above_horizon`, `fresnel_at`, `volume_from_arrays`, `volume_arrays`, `_sample_depth` and `FRAME_FIELDS` as listed. Task 4 adds `sun_vector`, `sun_area_nodes`, `sun_area_table` and `sun_area_at`.

### Task 4: Bounce probes, sun bounce and floor light maps

**Files:**
- Create: `tools/relight/relight/probes.py`, `tools/relight/relight/floorlight.py`, `tools/relight/tests/test_probes.py`
- Modify: `tools/relight/relight/__main__.py` (register `probes`, `sun-area`, `floor`), `tools/relight/relight/windows.py` (add `sun_vector`, `sun_area_nodes`, `sun_area_table`, `sun_area_at`), `tools/relight/tests/test_windows.py` (four tests)

**Interfaces:**
- Consumes: `proof/radiosity.py` (`form_factors`, `radiosity`, `probe_indirect`, `patch_sun`), `proof/04_fit.py` (`SKY_W`), `proof/05_relight.py` (`sun_samples`, `scenario_light`, `SCENARIOS`), `<work>/fit_state.npz`, `<work>/patches.npz`, `proof/lt.py` (`window_cubes`, `point_cubes`, `cove_cubes`, `dome_ring_lights`, `dome_visible`, `cube_eval`), the floor skin v1 manifest; Task 3 as built (`__main__.windows_volumes(cfg)`, `windows.sunlit_area`, `windows.above_horizon`, `windows.fresnel_at`, `windows.sun_band_meets`, `windows.sun_az_el`).
- Produces: `probes.coarse_grid(hall, spacing) -> (P (M,3), shape, origin)`; `probes.valid_mask(P, hall, inset) -> (M,) bool`; `probes.patch_direct_by_source(patches, sky_w) -> (P, 9)`; `probes.bounce_probes(radiosity_mod, patches, rho, sky_w, probe_points) -> (M, 9, 3, 6)`; `probes.sun_bounce_weights_from_area(area (5,), sky_flux (5,), beta) -> (5,)`; `windows.sun_vector(az, el, x_bearing) -> (3,)`; `windows.sun_area_nodes(latitude) -> (az0, el0, needed (rows, columns) bool)`; `windows.sun_area_table(vol, az0, el0, needed) -> (rows, columns) float32`; `windows.sun_area_at(table, az0, el0, az, el) -> float`; `floorlight.floor_grid(floor_manifest, texel) -> dict`; files `<work>/probes-coarse.npz` (`cubes` f16, `valid`, `origin`, `shape`, `spacing`), `<work>/sun-bounce.json`, `<work>/sun-area.npz` (`azimuth0`, `elevation0`, `latitude`, `needed`, and per window `W1`..`W5` float32 (rows, columns)), `<work>/floor-light.npz` (`D` (h, w, 9) f32, `texelToModel` (4,4)).

- [ ] **Step 1: Write the failing tests**

`tools/relight/tests/test_probes.py`:

```python
import unittest
import numpy as np
from relight import probes

HALL = {"x0": 0.0, "x1": 2.0, "y0": 0.0, "y1": 1.0, "floorZ": 0.0, "ceilingZ": 1.0}


class Grid(unittest.TestCase):
    def test_coarse_grid_covers_the_hall_at_the_spacing(self):
        P, shape, origin = probes.coarse_grid(HALL, 0.5)
        self.assertEqual(tuple(shape), (5, 3, 3))
        self.assertEqual(P.shape, (45, 3))
        self.assertTrue(np.allclose(origin, [0.0, 0.0, 0.0]))

    def test_probes_outside_the_hall_are_invalid(self):
        P = np.array([[1.0, 0.5, 0.5], [3.0, 0.5, 0.5], [1.0, 0.5, -0.2]])
        self.assertEqual(probes.valid_mask(P, HALL, inset=0.01).tolist(), [True, False, False])


class PatchDirect(unittest.TestCase):
    def test_windows_combine_their_four_bands(self):
        n = 2
        patches = {"E_win": np.ones((n, 20), np.float32), "E_cove": np.full(n, 2.0), "E_ch": np.full((n, 2), 3.0), "E_dome": np.full(n, 4.0)}
        d = probes.patch_direct_by_source(patches, np.array([0.15, 0.66, 1.0, 1.21]))
        self.assertEqual(d.shape, (2, 9))
        self.assertAlmostEqual(float(d[0, 0]), 3.02, places=5)
        self.assertEqual(d[0, 5:].tolist(), [2.0, 3.0, 3.0, 4.0])


class SunBounce(unittest.TestCase):
    def test_bounce_weights_scale_with_the_sunlit_glass_area(self):
        w = probes.sun_bounce_weights_from_area(np.array([0.0, 2.0, 1.0, 0.0, 0.0]), np.ones(5), beta=0.5)
        self.assertEqual(w.tolist(), [0.0, 1.0, 0.5, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_probes -v`
Expected: FAIL, no module `relight.probes`.

- [ ] **Step 3: Write the probes module**

`tools/relight/relight/probes.py`:

```python
"""Per-source bounce light on a coarse probe grid, and the sun-bounce weights (spec 4.2, 4.3).

Radiosity is linear in the direct light, so each source's bounce is solved on its own with a white
unit source; the browser multiplies by the source's colour and weight. The sun's bounce is carried
by the window sources' probes, scaled by the sunlit glass area of each window.
"""
from __future__ import annotations

import numpy as np


def coarse_grid(hall, spacing):
    lo = np.array([hall["x0"], hall["y0"], hall["floorZ"]], np.float64)
    hi = np.array([hall["x1"], hall["y1"], hall["ceilingZ"]], np.float64)
    shape = np.floor((hi - lo) / spacing + 1e-9).astype(np.int64) + 1
    axes = [lo[i] + np.arange(shape[i]) * spacing for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    return np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1), shape, lo


def valid_mask(P, hall, inset=0.02):
    return ((P[:, 0] >= hall["x0"] + inset) & (P[:, 0] <= hall["x1"] - inset)
            & (P[:, 1] >= hall["y0"] + inset) & (P[:, 1] <= hall["y1"] - inset)
            & (P[:, 2] >= hall["floorZ"] + inset) & (P[:, 2] <= hall["ceilingZ"] - inset))


def patch_direct_by_source(patches, sky_w):
    """(P, 9) direct light per patch; each window combines its facade and sky bands with the capture's sky_w."""
    cols = [np.asarray(patches["E_win"][:, 4 * w:4 * w + 4], np.float64) @ sky_w for w in range(5)]
    cols += [patches["E_cove"], patches["E_ch"][:, 0], patches["E_ch"][:, 1], patches["E_dome"]]
    return np.stack([np.asarray(c, np.float64) for c in cols], 1).astype(np.float32)


def bounce_probes(radiosity_mod, patches, rho, sky_w, probe_points):
    """(M, 9, 3, 6) indirect ambient cubes per source at the probe points (white unit sources)."""
    F = radiosity_mod.form_factors(patches["P"], patches["N"], patches["A"], patches["opening"])
    Edir = patch_direct_by_source(patches, sky_w)
    B = radiosity_mod.radiosity(F, rho, Edir)                        # (P, 9, 3)
    return radiosity_mod.probe_indirect(probe_points, patches, B).numpy().astype(np.float32)


def sun_bounce_weights_from_area(sunlit_area, sky_flux, beta):
    return beta * np.asarray(sunlit_area, np.float64) / np.maximum(np.asarray(sky_flux, np.float64), 1e-9)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_probes -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Bake the coarse probes and calibrate the sun bounce**

Register a `probes` command. It runs on the CPU (the proof's torch code has no CUDA; it takes no GPU lock) and does, in order:

1. `P, shape, origin = probes.coarse_grid(cfg.room["hallE57"], cfg.room["probeSpacing"])`; `valid = probes.valid_mask(P, cfg.room["hallE57"])`.
2. Loads `patches.npz` and the fitted patch albedo from `fit_state.npz`: print `np.load(...).files` and use the array `04_fit.py` saves as the patch albedo (the proof's `05_relight.py` reads it as `FIT["rho"]`).
3. `cubes = probes.bounce_probes(radiosity, patches, rho, np.array(fit04.SKY_W), P)`; writes `probes-coarse.npz` with `cubes.astype(np.float16)`, `valid`, `origin`, `shape`, `spacing`.
4. Linearity check: the capture's bounce `Σk w[k] c[k] ⊙ cubes[:, k]` (weights and colours from `fit.json`, selected by name in the package's source order W1..W5, cove, ch_end, ch_centre, dome; `fit.json` lists `sun_cap` sixth, so drop it by name, never by position) against the proof's own capture bounce solved directly with `radiosity(F, rho, PDIR_CAP)` then `probe_indirect` at the same points: median relative difference of the luminance at valid probes ≤ 2%.
5. Sun-bounce calibration for the proof's sunny morning (`05_relight.SCENARIOS["sunny_morning"]`, its three sun samples from `sun_samples`): the full bounce is `patch_sun` → `radiosity` → `probe_indirect` (the proof's path, `05_relight.patch_direct` restricted to the sun term); the approximation is `Σw b[w] cubes[:, w]` with `b = sun_bounce_weights_from_area(area, skyFlux, β)`. With `vols, horizons, fresnel = windows_volumes(cfg)` (Task 3 as built) and each sun sample `s` (float64, model frame), `area[w] = windows.sunlit_area(vols[name], s) × windows.fresnel_at(fresnel, s)` (amended 3 October: the window volumes' march, and the glass transmission interpolated linearly), and 0 for a window whose horizon hides the sun (`not windows.above_horizon(horizons[name], s, vols[name].x_bearing)`: the horizon interpolated between whole degrees). The browser reads the same area from the table Step 6 bakes (Task 5's `reference.sunlit_glass_area`; Task 5 Step 7 checks the table against `sunlit_area` within 2%). `skyFlux[w] = Σ patches A × patch_direct_by_source[:, w]`. Fit β by least squares on the valid probes' luminance (a one-parameter fit, closed form) and report the median |Δlog2| of the bounce luminance at valid probes with non-zero full bounce.
6. Writes `<work>/sun-bounce.json`: `{ "beta": β, "skyFlux": [5], "linearityMedianRel": x, "medianAbsDlog2": y, "threshold": 0.25, "pass": y <= 0.25 and x <= 0.02 }`.

Run: `C:/Python313/python.exe -m relight probes --config config/grand-hall.json`
Expected: `pass: true`. If the sun bounce misses 0.25, stop and report: the contingency, a per-direction bounce table on a 1 m grid, is the controller's call.

- [ ] **Step 6: Bake each window's sunlit area over the sun's band**

The browser takes the sun's bounce from each window's sunlit glass area at every light change, and it must not march the volumes on its main thread for that. So the bake tabulates `windows.sunlit_area` at whole-degree suns, 1° in compass azimuth and in elevation, over the reach test's own sun band (`windows.sun_band_meets` at the site's latitude: declination within 23.45°, with its refraction margin and padding), and the browser interpolates the table bilinearly. A node is computed only where a real sun's lookup can read it (the corners of the band's 1° cells); the others hold 0.

Append to `tools/relight/tests/test_windows.py`, directly above the line `class Tables(unittest.TestCase):`:

```python
class SunArea(unittest.TestCase):
    def test_the_grid_spans_the_reach_tests_band_and_every_real_suns_cell(self):
        az0, el0, needed = windows.sun_area_nodes(LAT)
        self.assertEqual((az0, el0, needed.shape, int(needed.sum())), (41.0, -2.0, (62, 279), 10708))
        rng = np.random.default_rng(13)
        for s in real_suns(rng, 400):
            az, el = windows.sun_az_el(s, 14.3)
            i, j = int(np.floor(az - az0)), int(np.floor(el - el0))
            self.assertTrue(0 <= i <= 277 and 0 <= j <= 60, f"sun at {az:.2f}, {el:.2f}")
            self.assertTrue(bool(needed[j:j + 2, i:i + 2].all()), f"sun at {az:.2f}, {el:.2f}")

    def test_the_table_is_sunlit_area_at_needed_nodes_and_zero_elsewhere(self):
        vol = volume()
        needed = np.array([[True, True, False], [True, True, True]])
        table = windows.sun_area_table(vol, 100.0, 20.0, needed)
        self.assertEqual((table.dtype, table.shape), (np.dtype(np.float32), (2, 3)))
        for (j, i), want in np.ndenumerate(needed):
            direct = windows.sunlit_area(vol, windows.sun_vector(100.0 + i, 20.0 + j, vol.x_bearing))
            self.assertEqual(float(table[j, i]), float(np.float32(direct)) if want else 0.0)
        self.assertGreater(float(table[0, 0]), 1.0)

    def test_the_lookup_is_bilinear_and_reads_the_edge_beyond_the_grid(self):
        table = (np.arange(4)[None, :] + 10.0 * np.arange(3)[:, None]).astype(np.float32)    # t[j, i] = i + 10 j
        self.assertAlmostEqual(windows.sun_area_at(table, 41.0, -2.0, 42.25, -1.5), 6.25, places=12)
        self.assertEqual(windows.sun_area_at(table, 41.0, -2.0, 44.0, 0.0), 23.0)          # the last node itself
        self.assertEqual(windows.sun_area_at(table, 41.0, -2.0, 30.0, 70.0), 20.0)         # beyond the grid: its edge

    def test_sun_vector_points_at_its_azimuth_and_elevation(self):
        for az, el in ((98.944851, 32.713999), (180.0, 10.0), (60.0, 0.0)):
            s = windows.sun_vector(az, el, 14.3)
            np.testing.assert_allclose(s, sun_toward(az, el), rtol=0, atol=1e-15)
            back_az, back_el = windows.sun_az_el(s, 14.3)
            self.assertAlmostEqual(back_az, az, places=9)
            self.assertAlmostEqual(back_el, el, places=9)
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: FAIL, the four new tests (`module 'relight.windows' has no attribute 'sun_area_nodes'`, `'sun_area_table'`, `'sun_area_at'`, `'sun_vector'`); the 26 others pass.

Append to `tools/relight/relight/windows.py`:

```python
def sun_vector(az, el, x_bearing):
    """Unit vector toward a sun at compass azimuth az and elevation el (degrees), in the model frame whose +x axis has
    compass bearing x_bearing: the proof's common.sun_vec_e57 with the volume's own bearing."""
    th, e = np.radians(x_bearing - az), np.radians(el)
    return np.array([np.cos(th) * np.cos(e), np.sin(th) * np.cos(e), np.sin(e)])


def sun_area_nodes(latitude):
    """The sunlit-area table's grid at this latitude. A 1-degree cell [a, a + 1] x [e, e + 1] of compass azimuth and
    elevation (a = 0..359, e = -2..89) is in the band when sun_band_meets finds a possible apparent sun in it: the reach
    test's own band (declination within 23.45 degrees, refraction and padding included). The grid is the smallest
    rectangle of whole-degree nodes holding every band cell's corners. Returns (az0, el0, needed): node (row j, column
    i) is the sun at azimuth az0 + i and elevation el0 + j; needed marks the corners of band cells, the only nodes a
    real sun's bilinear lookup reads."""
    a = np.arange(0.0, 360.0)
    e = np.arange(-2.0, 90.0)
    A, E = np.meshgrid(a, e)
    band = sun_band_meets(A, A + 1.0, E, E + 1.0, latitude)
    rows, cols = np.nonzero(band)
    j0, j1, i0, i1 = int(rows.min()), int(rows.max()) + 1, int(cols.min()), int(cols.max()) + 1
    cells = band[j0:j1, i0:i1]
    needed = np.zeros((cells.shape[0] + 1, cells.shape[1] + 1), bool)
    for dj in (0, 1):
        for di in (0, 1):
            needed[dj:dj + cells.shape[0], di:di + cells.shape[1]] |= cells
    return float(a[i0]), float(e[j0]), needed


def sun_area_table(vol: WindowVolume, az0, el0, needed) -> np.ndarray:
    """(rows, columns) float32: sunlit_area at the sun sun_vector(az0 + i, el0 + j, vol.x_bearing) for every needed node
    (row j, column i), 0 elsewhere. A node whose sun does not face the wall is 0 by sunlit_area's own test."""
    table = np.zeros(needed.shape, np.float32)
    for j, i in zip(*np.nonzero(needed)):
        table[j, i] = sunlit_area(vol, sun_vector(az0 + i, el0 + j, vol.x_bearing))
    return table


def sun_area_at(table, az0, el0, az, el) -> float:
    """The (rows, columns) table interpolated bilinearly at compass azimuth az and elevation el (degrees), in float64 in
    this order (the browser's twin repeats it): x = az - az0 and y = el - el0, clamped to [0, columns - 1] and
    [0, rows - 1]; i = min(floor(x), columns - 2), j = min(floor(y), rows - 2); fx = x - i, fy = y - j;
    v0 = t[j, i] (1 - fx) + t[j, i + 1] fx, v1 = t[j + 1, i] (1 - fx) + t[j + 1, i + 1] fx; v0 (1 - fy) + v1 fy.
    A sun beyond the grid reads its edge; no real sun lies beyond it (sun_area_nodes)."""
    rows, columns = table.shape
    x = min(max(float(az) - az0, 0.0), columns - 1.0)
    y = min(max(float(el) - el0, 0.0), rows - 1.0)
    i, j = min(int(x), columns - 2), min(int(y), rows - 2)
    fx, fy = x - i, y - j
    v0 = float(table[j, i]) * (1.0 - fx) + float(table[j, i + 1]) * fx
    v1 = float(table[j + 1, i]) * (1.0 - fx) + float(table[j + 1, i + 1]) * fx
    return v0 * (1.0 - fy) + v1 * fy
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: PASS, 30 tests.

Register the command: add to `tools/relight/relight/__main__.py`, directly above `if __name__ == "__main__":`:

```python
def cmd_sun_area(cfg, args) -> int:
    """<work>/sun-area.npz: each window's sunlit glass area (m2, times the cosine to the wall normal) at whole-degree
    suns over the reach test's sun band at the site's latitude (windows.sun_area_nodes), marched through the uint8
    volumes of windows.npz, the ones the package carries. CPU only, no GPU lock."""
    import time
    import numpy as np
    from . import windows as W
    vols, _horizons, _fresnel = windows_volumes(cfg)
    latitude = float(cfg.room["site"]["latitude"])
    az0, el0, needed = W.sun_area_nodes(latitude)
    save = {"azimuth0": np.float64(az0), "elevation0": np.float64(el0), "latitude": np.float64(latitude), "needed": needed}
    print(f"sun-area grid: azimuth {az0:.0f}..{az0 + needed.shape[1] - 1:.0f}, elevation {el0:.0f}.."
          f"{el0 + needed.shape[0] - 1:.0f}, {int(needed.sum())} nodes", flush=True)
    for name, vol in vols.items():
        started = time.time()
        save[name] = W.sun_area_table(vol, az0, el0, needed)
        print(f"{name}: peak {float(save[name].max()):.3f} m2 in {time.time() - started:.0f} s", flush=True)
    np.savez_compressed(os.path.join(cfg.paths["work"], "sun-area.npz"), **save)
    print("sun-area.npz written", flush=True)
    return 0


COMMANDS["sun-area"] = cmd_sun_area
```

Run it twice, each in its own process, copying the output aside after each run (the PC's rule, Task 2 as built):

```bash
cd D:/claude/real-hall/repo/tools/relight && mkdir -p D:/claude/relight/grand-hall/verify/task4
C:/Python313/python.exe -m relight sun-area --config config/grand-hall.json && cp D:/claude/relight/grand-hall/work/sun-area.npz D:/claude/relight/grand-hall/verify/task4/sun-area-run1.npz
C:/Python313/python.exe -m relight sun-area --config config/grand-hall.json && cp D:/claude/relight/grand-hall/work/sun-area.npz D:/claude/relight/grand-hall/verify/task4/sun-area-run2.npz
C:/Python313/python.exe -c "import numpy as np; a=np.load('D:/claude/relight/grand-hall/verify/task4/sun-area-run1.npz'); b=np.load('D:/claude/relight/grand-hall/verify/task4/sun-area-run2.npz'); bad=[k for k in a.files if a[k].dtype!=b[k].dtype or a[k].shape!=b[k].shape or a[k].tobytes()!=b[k].tobytes()]; print(sorted(a.files)==sorted(b.files), 'differ:', bad)"
```

Expected: each run prints `sun-area grid: azimuth 41..319, elevation -2..59, 10708 nodes` (the grid `test_the_grid_spans_the_reach_tests_band_and_every_real_suns_cell` pins), one line per window and `sun-area.npz written`; the comparison prints `True differ: []`. About 6,100 of the nodes face the wall, and each of those marches one window's opening at 3 cm (4,000 to 17,500 points), so expect tens of minutes per run (an estimate; record the measured times in the task report). If the two runs differ, a third run decides by majority, and the evidence keeps all three.

- [ ] **Step 7: Bake the floor light maps**

`tools/relight/relight/floorlight.py`:

```python
"""Direct light of the nine sources on the floor skin's grid, at 5 cm texels, normal +z (the model frame's up)."""
from __future__ import annotations

import numpy as np


def floor_grid(floor_manifest, texel):
    """Texel counts and size of the floor at `texel` metres over the floor skin's grid extent."""
    g = floor_manifest["grid"]
    width_m, height_m = g["cols"] * g["texel"], g["rows"] * g["texel"]
    return {"w": int(round(width_m / texel)), "h": int(round(height_m / texel)), "width": width_m, "height": height_m}
```

The `floor` command: read `<floorSkin>/floor-skin.json` (v1; the floor-skin builder names its manifest `floor-skin.json`); read the grid's field names from `packages/web/src/lib/floor-skin.ts` (`FloorSkinManifestSchema.grid`) and use them in `floor_grid` if they differ from `cols`/`rows`/`texel`; build the texel centres at `cfg.room["floorTexel"]` in the capture frame from the grid's mapping (the inverse of `captureToMaskMatrix` in `lib/floor-skin.ts`); convert them to e57 with `common.json_to_e57`; set z to the fitted floor plane + 0.02 m; and compute the nine direct values exactly as `proof/03_bases.py` computes its patch direct light (the block that fills `Pw`, `Pch`, `Pdome`, `Pcove` before `np.savez(f"{WORK}/patches.npz", ...)`), with the texel centres as the points, normals +z, and the windows combined with `SKY_W`. Save `<work>/floor-light.npz` with `D` (h, w, 9) float32 and `texelToModel` (4, 4): the matrix that maps a texel centre's `(col, row, 0, 1)` to the model frame, row 0 being the first PNG row (plan R1b relies on exactly this). It runs on the CPU and takes no GPU lock.

Run: `C:/Python313/python.exe -m relight floor --config config/grand-hall.json`
Expected: `floor-light.npz` with no NaN; print each source's maximum and the share of floor texels with non-zero window light (above 0.9 for W3).

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/probes.py tools/relight/relight/floorlight.py tools/relight/relight/__main__.py tools/relight/relight/windows.py tools/relight/tests/test_probes.py tools/relight/tests/test_windows.py
git diff --cached --stat
git commit -m "feat(relight): per-source bounce probes, the calibrated sun bounce, the sunlit-area table and floor light maps (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**As built (7 October).** Steps 5 and 6 above (β, the area-scaled sun bounce and the 1° sunlit-area table) were tried, missed their gates and were replaced; Steps 1–4 and 7 stand with the changes below. The record is the task report (`.superpowers/sdd/2026-09-29-restored-hall-r1a-light-bake/task-4-report.md`: its "Outcome", "Final runs and commit (4 October)", "Data layout and the browser's contract, factored model" and the 7 October entries) and the commits `a2a25c56` (the factored sky-body basis, the Moon, the floor), `deed4d4a` (the stable 20% K rule) and `4efa4fa4` (review fixes: gate-before-write, a third independent draw, the contract's float32 precision). Later tasks use exactly what is listed here.

- **Why it changed.** β fitted on one sunny morning did not transfer: on 48 real suns it scored a pooled median |Δlog2| of 0.61, 46 of 48 suns over 0.25. The 1° area table missed Step 7's 2% check by up to 13%. A per-direction table on a 4° grid then failed at window-visibility edges (azimuth ≥ 155°), whatever K. The owner made moonlight a full light source on 3 October, so the sky band and the bounce cover the Moon too.
- **The sky band covers the Moon** (`windows.py:344-402`): `SKY_DECLINATION_MAX = 28.75` (23.44 + 5.30, the Moon's geocentric bound), `SKY_PARALLAX_MAX = 1.03` (the closest perigee's horizontal parallax), `REFRACTION_MAX = 0.6`, `REACH_PAD = 0.5`; `sun_band_meets` raises the box's top by the parallax; `sun_reach`, `sun_nodes` and `sun_band_meets` keep their names and cover both bodies. `check-sun` adds 48 random real moons (`missedMoon 0`); the reach flag now marks 0.83674 of the 6,030,980 finest splats (it was 0.82859).
- **The Moon's ephemeris** (`moon.py`, `tests/test_moon.py`, 6 tests): Meeus ch. 47 in full (Tables 47.A and 47.B), ch. 22 (mean obliquity, low-accuracy nutation), ch. 12 (apparent sidereal time), ch. 40 (topocentric parallax, geodetic latitude and height), ch. 13 (horizontal), the proof's refraction; `position(jd_ut, lat, lon) -> (az, el, distance_km)`, `julian_day(y, m, d, h=0)`, `NODAL_CYCLE_DAYS`. Against JPL Horizons over 2020–2038: median 2″, worst 15″ (the Task 4 review).
- **`probes`** (Steps 5.1–5.4 only; `__main__.py:382-436`): the per-source cubes `<work>/probes-coarse.npz` (`cubes` float16 (M, 9, 3, 6), `valid`, `origin`, `shape`, `spacing`; 0.5 m, (43, 22, 14)) and `<evidence>/probes-check.json` (`linearityMedianRel`, `linearityP99Rel`, `linearityMaxRel`, `probes`, `threshold` 0.02, `pass`). `probes.sun_bounce_weights_from_area` is gone; `probes.cube_luminance(cubes, lumw)` was added.
- **`sun-bounce`** (new; `sunbounce.py`, `__main__.py:527-698`, `tests/test_sunbounce.py`) replaces Steps 5.5–5.6 and Step 6. The sky bodies' bounce is factored per window w: `B_w(s) = P_w(s) × R_w(s)`.
  - `P_w(s)` is the power the room's 3,528 patches receive through window w, computed exactly at every light change from the proof's 16 sub-sample rays per patch (56,448 rays, `sunbounce.window_power`, `sunbounce.py:63-88`: marched by the window-volume twin `windows.sun_visibility_by_window`, `windows.py:270-290`, the glass transmission and the horizon gate included). It is never interpolated.
  - `R_w = B_w / P_w`, the bounce of a white unit light per unit power, is smooth. It is compressed into K basis volumes on the 1 m probe grid (`probes.coarse_grid(hall, 1.0)`: (22, 11, 7), the even probes of the 0.5 m grid, 1,260 valid) and a coefficient table on a 4° grid of directions over the sky band (`windows.sun_nodes(55.8593, 4)`: origin azimuth 24°, elevation −2°, (18, 79) nodes, 935 needed, 527 facing the wall). A node-window whose ungated power is below `REAL_FRACTION = 1e-4` of that window's median node power copies the nearest real node of its window (`fill_from_nearest`: squared grid-index distance, ties to the first real node in row-major order).
  - K is chosen by `sunbounce.choose_k` (`sunbounce.py:223-241`) on 48 held-out real suns and 48 real moons under `GATE = {median: 0.25, brightShare: 0.05}` with the stable margin rule (`MARGIN = 0.20`: the smallest K from which the gate passes and the worst bright direction stays within 0.20 at every larger K up to 192). It is then scored once, unchanged, on a check draw and a strict third draw. **K = 30** (selection worst bright 0.1663, check 0.1755, strict 0.1777; 0 bright directions over in all three).
  - The artifact is `<work>/sun-bounce.npz` (2,082,843 bytes; runs 12, 13 and 14 byte-identical): `basis` float16 (K, 1694, 3, 6), `coeffs` float32 (18, 79, 5, K), `floorMean` float32 (K, 3), `needed` bool (18, 79), `azimuth0` 24.0, `elevation0` −2.0, `step` 4.0, `gridOrigin` (−1.823, −10.329, 0.02), `gridShape` (22, 11, 7), `gridSpacing` 1.0, `valid` bool (1694), `patchRays` float32 (56448, 3), `patchNormal` float32 (3528, 3), `patchArea` float32 (3528,), and the bake diagnostics `real` and `nodePower` (never packaged). Evidence: `<evidence>/sun-bounce-check.json`.
  - The browser's contract (P_w's float32 order, the corners, the coefficients, the fold) is `docs/engineering/relight-package.md`, section "The sky bodies' bounce", copied from the report's "Data layout and the browser's contract, factored model".
  - Known limit (accepted 4 October): the proof's patch sampling (a 12.5 cm pitch) aliases at oblique suns (azimuth about 155° and beyond); `windows.sunlit_area` stays as the finer reference.
  - The display's floor-mean bounce at K 30 has median 9.3% and maximum 34% relative error on the selection set, 10.0% / 73% on the check set (the maximum on faint directions).
- **`floor`** (Step 7, as briefed; `__main__.py:701-767`): `<work>/floor-light.npz` (`D` (212, 424, 9) float32, `texelToModel` (4, 4)); its helpers live in `floorlight.py` (`floor_grid` with floor-skin v1's `widthPx`, `heightPx`, `texelM`; `capture_centres`, `model_plane`, `lift_to_plane`, `texel_to_model`, `patch_direct`), tested in `tests/test_floorlight.py` (5 tests). The command first recomputes the proof's patch light (the house lights exactly, the windows within float16) and requires W3 to light more than 90% of the texels (0.9119).
- **Gate before write** (`__main__._save_npz_if`, `_finite`, `__main__.py:27-67`): `probes`, `floor` and `sun-bounce` write their artifact into `work/` only when their checks pass (a failing run keeps its arrays as `<evidence>/<stem>-FAILED.npz`); their evidence JSON is written with non-finite numbers as null.
- **Runs** (6 threads, one process each, each data product at least twice): probes runs 5, 6, 7, floor runs 3, 4, 5, check-sun runs 2, 3, 4 and sun-bounce runs 12, 13, 14 byte-identical. Suite: 121 tests (`verify/task4/green22-suite.txt`).
- **Deferred to Tasks 4c and 5** (the Task 4 review's minor items): `sun-check.json` is written without `_finite`; an evidence JSON can be written before its artifact; no artifact hash links evidence to `work/`. Task 4c records each artifact's SHA-256 in its evidence after the artifact is written, and Task 5 packages only exact, hash-checked files.
- **What depends on the capture fit.** `probes` (its cubes use the fitted patch albedo `rho` of `fit_state.npz`) and `sun-bounce` (its exact fields and its basis use the same `rho`) are re-run by Task 4b after the house-light refit. `floor`, `windows` and `check-sun` do not read the fit and are not re-run.

### Task 4b: The house lights refitted: the centre chandelier's light from the bulb table

(Added 7 October. It is numbered 4b so that every reference to R1a's Tasks 5, 6 and 7 in R1b, R1c and R1d stays valid. It runs after Task 4 and before Task 4c and Task 5.)

**Files:**
- Create: `tools/relight/relight/housefit.py`, `tools/relight/tests/test_housefit.py`
- Create (moved byte for byte): `tools/relight/proof/shots.py` (the proof's `scripts/shots.py`, which `07_compare.py` imports; the R1b plan's File Structure lists it as "moved if R1a did not")
- Modify: `tools/relight/relight/__main__.py` (the `--from` option and the `refit-house` command), `tools/relight/config/grand-hall.json` (`paths.emitters`, `paths.lampColours`)
- Outputs (D:, never committed): the staging copy `D:/claude/relight/grand-hall-refit/` (`config.json`, `work/` with `work/refit/{proof, refit, refit-wcrown-0, refit-wcrown-1}` and each refit's `-run1`, `evidence/refit/`, `harness/`, `renders/`, `renders-baseline/`, `renders-<refit>/`, `verify/`); in the bake's work `D:/claude/relight/grand-hall/work/` the accepted `fit.json`, `fit_state.npz`, `npy/E_cap.npy`, `npy/emb_E_back_cap.npy`, `mult/{comp_house,mask,night,sunny_morning,overcast_noon}.{f16,json}` and `bulb-intensities.json`, the proof fit kept in `work/fit-proof/`, and the re-baked `probes-coarse.npz` and `sun-bounce.npz`; evidence `D:/claude/relight/grand-hall/evidence/refit.json`, `probes-check.json`, `sun-bounce-check.json`; run copies in `D:/claude/relight/grand-hall/verify/task4b/`.

**Interfaces:**
- Consumes: the proof's `04_fit.py` (`direct`, `patch_direct_capture`, `build_fit_set`, `patch_samples`, `E_capture_at`, `BASES`, `GROUPS`, `PAINT`, `PAINT_ALBEDO`, `HUBER`, `GAMMA_FREE`, `SKY_W`, `LAMP_RATIO`), `radiosity.py` (`form_factors`, `radiosity`, `probe_indirect`, `load_patches`), `store.py` (`Store`, `Probes`, `eval_cubes`, `LUMW`), `lt.load_occ`, `common.T_JE`, `03c_embrasure_roomside.py`, `03d_embrasure_back.py`, `05_relight.py` (scenarios `comp_house`, `mask`, `night`, `sunny_morning`, `overcast_noon`), `07_compare.py metrics`; the proof's render harness (`D:/claude/real-hall/renovation/relight/harness/run.mjs` and `app/dist/`, copied, never run in place: the proof folder is read-only) and its `work/views.json` and `work/order_check.json` (copied); the bulb table `D:/claude/real-hall/frontier/splats/evidence/bulbs.json` (`venviewer.frontier.bulbs.v1`: `frames.T_json_from_e57`, `bulbs[]` with `id`, `chandelier`, `position_e57`, `confidence` (its first word `high`, `medium`, `low` or `exclude`; every `medium` reading names "the centre chandelier's crown tubes"), `faces[]` with `face`, `blob_area_mm2` and `distance_m`, the range in metres from the face's station to the bulb, which the range-aware balance reads; 173 entries on 8 October, SHA-256 `1856cf8b047d36c7e0097942af30bccddcbf725afc19adfa7611d29fb688648d`); `D:/claude/real-hall/frontier/light/evidence/lamp_colours.json` (`groups.chandelier_emitters_all` and `groups.dome_ring_emitters`, each `median_log2_RG_BG`); `<work>/geom.npz` (`chandeliers`, 5 × 3, e57: the light model's chandelier centres, index 2 the centre one, in the order `03_bases.py` sums them: `E_ch[:, 0]` = 0, 1, 3, 4 and `E_ch[:, 1]` = 2, `03_bases.py:175-177`); `<work>/lamp_daylight_ratio.json`; Task 4 as built (`probes`, `sun-bounce`, `_proof_modules`, `_finite`, `THREADS`, the launcher and `compare.py` in `D:/claude/relight/grand-hall/verify/task4/`).
- Produces (`housefit.py`): `BULBS_SCHEMA`, `SHARES_SCHEMA = "venviewer.bulb-intensities.v1"`, `CENTRE = 2`, `ENDS = (0, 1, 3, 4)`, `LIGHTS` (04_fit's ten bases), `COLOUR_PRIOR_SIGMA`, `PRIOR_WEIGHT = 0.15`, `LOG_BOUNDS = (-25.0, 12.0)`, `RESIDUAL_TOLERANCE = 0.02`, `REPRODUCE_TOLERANCE = 0.01`, `LAMP_WORDS = ("high", "medium")`, `NOT_LAMP_WORDS = ("low", "exclude")`, `CANDLE = "candle"`, `CROWN = "crown"`, `CROWN_TEXT = "crown tube"`, `CROWN_WEIGHT_RANGE = (0.0, 1.0)`, `CROWN_ENDS = (0.0, 1.0)`, `DEFAULT_TAG = "refit"`, `PHOTO_VIEWS`, `PHOTO_JOB = "A_comp_house"`, `PHOTO_R_SLACK = 0.005`, `PHOTO_STOPS_SLACK = 0.02`, `PHOTO_METRICS`, `METRIC_ROUNDING = 0.001`, `FIT_FILES`, `SCENARIOS`; `sha256_file(path)`; `confidence_word(entry) -> str`; `is_lamp(entry) -> bool`; `lamp_kind(entry) -> str`; `blob_balance(bulbs) -> dict`; `crown_weight(bulbs) -> dict` (`wCrown`, `pairs`, `faces`); `RANGE_FACE_MIN = 2`, `RANGE_SPREAD_FACTOR = 2.0`; `candle_detections(bulbs) -> list`; `range_fit(detections) -> (slope, {face: intercept}) | None`; `median_residual(detections, fit) -> (median, count)`; `range_balance(bulbs) -> dict` (`slope`, `faces`, `balance`, `centreUsed`, `endSpreads`, `largestEndSpread`, `limit`, `factor`, `pass`, `reason`; ruling L4); `read_bulbs(path, chandelier_centres, t_json_from_e57=None) -> dict` (`sha256`, `ids`, `counts`, `candles`, `crowns`, `kinds`, `lamps`, `notLamps`, `blobBalance`, `crownWeight`, `rangeBalance`); `LampCounts(end_mean, centre_candles, crowns, w_crown)` with `centre` and `ratio`; `lamp_counts(bulbs, w_crown) -> LampCounts`; `colour_priors(lamp_colours) -> dict`; `FitConstants` (`of(fit04)`); `ProofModel(lamp_ratio)` and `RefitModel(lamp_ratio, counts, priors)` (each `name`, `n_log`, `n_col`, `init_log(w0)`, `weights(x)`, `colours(x)`, `bounds(lo, hi)`, `priors(x)`, `describe(x)`); `n_params(model, k)`, `unpack(model, x, k)`, `model_light(model, x, Dv, Iv, k)`, `VoxelData`, `residuals(model, x, data, k)`, `data_cost(model, x, data, k)`, `bounds_of(model, n, k)`, `initial_x(model, Dv, k)`, `anchor_albedo(model, x, data, k)`, `solve(model, x, data, k)`; `run_capture_fit(model, k, mods, out_dir, write_ecap, log) -> dict`; `bulb_shares(bulbs, counts, report, fit_sha256) -> dict`; `accept_fit(proof, refit, counts) -> dict`; `photo_gate(baseline, refit) -> dict`; `variant_tag(w_crown) -> str`; `photo_values(metrics) -> dict`; `photo_noise(first, repeat) -> dict`; `clearly_better(x, y, noise) -> bool`; `crown_sensitivity(runs, repeat) -> dict`; `same_run(dir_a, dir_b) -> list[str]`; `copy_verified(src, dst) -> str`; `snapshot_fit(work) -> dict`. The command `python -m relight refit-house <proof | refit | compare | install | photo-gate | sensitivity | promote> [--w-crown <w>] [--tag <refit folder>] [--from <staging work>]`. Data: `<work>/refit/<folder>/{fit.json, fit_state.npz, report.json}` (`proof`; `refit` at the measured w_crown and `refit-wcrown-0`, `refit-wcrown-1`, each also `E_cap.npy` and `bulb-intensities.json`), `<evidence>/refit/{photo-baseline,compare,compare-refit-wcrown-0,compare-refit-wcrown-1,accept,install,install-refit-wcrown-0,install-refit-wcrown-1,photo-refit,photo-refit-repeat,photo-refit-wcrown-0,photo-refit-wcrown-1,photo-gate,sensitivity,range-balance}.json`, and in the bake's work `bulb-intensities.json` (amended 8 October, the controller's rulings L1 and L2) = `{ schema: "venviewer.bulb-intensities.v1", wCrown, bulbs: { <every lamp of the table>: { kind: "candle" | "crown", intensity: <per unit of its group's weight; positive at the measured w_crown, and a crown tube's 0 only in the w_crown 0 sensitivity run, which is never promoted> } }, fit: { model, perBulbIntensity, lampRatio, groups: { ch_end | ch_centre: { source, weight, perBulbPerUnitWeight, chandeliers: { <index>: { lamps, share } } } }, crownWeightMeasured: { wCrown, pairs, faces }, rangeBalance, notLamps, blobBalance, tableSha256, fitJsonSha256 } }`: the lamps are the table's 140 `high` and `medium` entries; a crown tube's intensity is `wCrown` × its chandelier's candle's; `fit.notLamps` lists the 33 `low` and `exclude` entries, which `bulbs` does not name, so the two together name every id of the table once; `ch_centre` also carries `crownPerUnitWeight` and its chandelier's `candles` and `crowns`. This is the shape R1d's Task 3 reads (R1d draws the 140 lamps, each crown tube with its own envelope at its share; the amendments file's "Interfaces R1d expects from the bake", item 2, is superseded here).

**Why.** The capture fit (`04_fit.py`, run by Task 2) gives the centre chandelier `ch_centre` a weight of 1.44e-11, its lower bound `e^-25`, while the frontier splats study saw it lit through the whole 31 May walk (244 keyframes within 4 m, every one lit: `D:/claude/real-hall/frontier/splats/evidence/walk_lit_timeseries.json`). Albedo flatness cannot tell its light from the dome ring's and the end chandeliers' (their bases are nearly collinear over the fit's voxels), so they took its light (`ch_end` 2.24 and `dome` 0.754 in `work/fit.json`) and the captured light under the dome is wrong. Every multiplier is a ratio to that captured light, so the error reaches every relit splat near the centre of the hall.

**The design (chosen, with the reasons).**
- **One per-bulb intensity φ for every chandelier candle** (amended 8 October: the crown tubes are a second kind, below). `03_bases.py` makes `E_ch[:, 0]` the four end chandeliers' unit point lights summed and `E_ch[:, 1]` the centre chandelier's. The refit gives `ch_end` the weight `φ × n̄_end` (n̄_end the mean lamp count of chandeliers 0, 1, 3 and 4, every one a candle) and `ch_centre` the weight `φ × (n_candles + w_crown × n_crowns)`, the centre chandelier's candles plus its crown tubes at w_crown each, so `ch_centre / ch_end` is that count ratio exactly and each chandelier's weight is proportional to its lamps' light. Reasons: the five chandeliers carry one lamp product (their emitter splats agree within 0.11 stop in R/G, `lamp_colours.json`); every lamp was lit and steady through the walk (the study's clipped-share series never fell below 0.2%); and the alternative, a free per-chandelier intensity with a strong shared prior, would put a prior on exactly the direction the data cannot identify (the proof's fit drove it to its bound), so the fit would return the prior with a pull that means nothing. The constraint states the physics and leaves the fit its identifiable freedoms. The table's clipped-blob areas (a relative, monotone proxy within one face, the table's `clipped_measure_note`) are not fitted: `blob_balance` reports them as evidence, the median over every face that frames candles of the centre chandelier and of an end chandelier of log2 of the centre's median clipped-core area over the ends' (crown tubes left out). About 0 would support one intensity. On the 8 October table it is −0.53 over 30 faces (the centre's candles' clipped cores read 0.69 of the ends' in the same faces; −0.56 with every non-excluded entry, so the lamp rule does not explain it): the number goes into the evidence and the task report. The same-face comparison does not take out range, and the centre chandelier hangs higher under the dome, so the gate is the range-aware balance below (ruling L4), with the night photo check (acceptance 3) and the sensitivity runs.
- **The range-aware balance** (added 8 October, the controller's ruling L4: one intensity per candle is a premise the data must not contradict). Within each face (one exposure) the candles' log2 clipped area (`blob_area_mm2`, at the bulb) is modelled against the log2 range from that face's station to the bulb (`distance_m`, the only per-face record of where the station stood; the table's faces also carry `sweep`, `mm_per_px` and `blob_area_px`), with a per-face intercept and one shared slope, least squares over the faces holding at least two fitted candles (`range_fit`). The fit uses the four end chandeliers' candles only. The centre's candles' median residual against it is the corrected balance. Each end chandelier's median residual against the fit of the other three (leave-one-out) is its spread, the measure of "the same product". The premise stands while |balance| ≤ 2 × the largest |spread|; otherwise the task stops and reports the numbers, and `promote` refuses (acceptance 7). The numbers go into `evidence/refit/range-balance.json`, every refit `report.json`, `bulb-intensities.json`'s `fit`, `evidence/refit.json` (promoted or refused) and the task report. On the 8 October table: slope −0.015 log2 per log2 m over 130 faces, corrected balance **−0.296** (972 centre detections), end spreads +0.282, +0.275, −0.042 and +0.244 (chandeliers 0, 1, 3, 4), limit 0.563: it passes. The slope moves from −1.32 to +0.06 between the leave-one-out fits (within a face the end candles' ranges vary little), which the spreads carry into the limit.
- **Lamp counts** (amended 8 October, the controller's ruling L1: one lamp set for R1a and R1d). The lamps are the table's `high` and `medium` entries, the frontier splats study's 140 confident lamps (`proposal.md` §d6.0 and §e). `low` (unresolved by eye, 6 entries) and `exclude` (a brass highlight or glare, 27) are not lamps; `fit.notLamps` lists both, and an unknown confidence word is refused. On the 8 October table (173 entries, all five chandeliers) that gives 26, 22, 47, 23 and 22 lamps for chandeliers 0–4: 26, 22, 40, 23 and 22 candles and the centre's 7 crown tubes. n̄_end is 23.25; the centre's light is 40 + 7 w_crown candles; the ratio is 1.8370 at the measured w_crown (0.3871, below), 1.7204 at w_crown 0 and 2.0215 at 1. Each chandelier's lamps must stand around the light model's chandelier of the same index (median within 0.25 m of its axis, none beyond its volume's radius plus 0.1 m; measured on 8 October: medians 0.167, 0.114, 0.045, 0.045 and 0.127 m off the axis, farthest 0.757, 0.751, 1.002, 0.773 and 0.697 m against limits 0.85, 0.85, 1.1, 0.85 and 0.85), and the table's `T_json_from_e57` must be the canonical frame's (equal on 8 October), so a numbering or frame mismatch cannot pass. The four end chandeliers keep their equal weighting inside `E_ch[:, 0]`: their counts differ by −5% to +12%, inside the counts' own uncertainty (the study lists 31 May glow clusters with no E57 bulb, possibly lamps dark at the E57 survey), and a per-chandelier end basis would change the bases every record, probe and floor texel carries.
- **The crown tubes** (added 8 October, the controller's ruling L2). The centre chandelier's 7 crown tubes are a separate kind of lamp, `crown`: its `medium` entries, whose reading names "the centre chandelier's crown tubes" (`c2_b41`, `c2_b45`–`c2_b49`, `c2_b53`). They stand 1.377–1.400 m above the chandelier's centre, above every one of its candles (the highest 1.122 m; `read_bulbs` refuses a crown tube at or below a candle, so a reading that names the crown tubes for a candle cannot pass). Measured on 8 October: their clipped cores' median core ratio is 0.456 against 1.011 for the centre's `high` candles, their median clipped area 1,719 mm² against 3,533 mm², their detection rate 0.39 against 0.90. A crown tube has `w_crown × φ`. `w_crown` is measured by the task, never typed (`crown_weight`): in each face that frames crown tubes and candles of the centre chandelier, each crown tube's clipped area (mm² at the bulb) over the median of those candles'; the median over every such pair. On the 8 October table that is **0.3871** (92 pairs in 28 faces). (The ruling's 0.456 is the table's own `core_ratio_median`, whose denominator is the median of every entry of the chandelier in the face, crown tubes, `low` and `exclude` entries included, in pixels; measured in pixels against the candles alone it is 0.407. The ruling defines w_crown against the candles in the same faces, so the task computes that.) It is a default, not a constant: the refit also runs at w_crown 0 and 1 and reports, for each, the data cost, both night stations' photo metrics and the `ch_centre` share at the floor and the ceiling (`fit.json`'s `budget`). If the night photo check clearly prefers one end (every metric at both stations better there than at the other end by more than its run-to-run noise, measured by rendering the refit's multipliers twice), the task stops and reports instead of choosing (acceptance 6). `bulb-intensities.json` gives each lamp its `kind` and the top-level `wCrown`; a crown tube's share is `wCrown` × a candle's, and R1d draws it with its own, smaller envelope at that share.
- **A colour per lamp group.** The cove (LED tape), the chandeliers (candle lamps; `ch_end` and `ch_centre` share one colour) and the dome (LED pin spots) each get the measured lamp/daylight ratio (`lamp_daylight_ratio.json`, `1.623 : 1 : 0.467`) times `exp([δR, 0, δB])`, with a fitted offset held by a prior per group (residual `0.15 × (δ − m) / σ`, 04_fit's prior strength): the chandeliers at m = 0 (the ratio was measured on chandelier and dome emitter splats, 94% of them chandeliers) with σ = 0.035 (0.05 stop); the dome at its emitter splats' measured shift from the chandeliers' (`lamp_colours.json`: −0.350 stop R/G, +0.173 B/G; the light study §b9) with σ = 0.10 (0.15 stop); the cove at m = 0 with σ = 0.35 (0.5 stop), because its splats are surfaces lit by the tape and measure albedo times light, not the tape. No group colour is a constant: the 2,700–2,800 K figure is not established (the light study §b9 reads the ratio as 3,500–3,950 K against D60–D75).
- **Everything else is `04_fit.py`'s**, run by the same loop: the windows with their weak spread prior, the daylight colour with its prior, the capture's sun (its weight stays free and goes to its bound, as in the proof), the six material groups' albedos with the paint band's green anchored at 0.60, γ fixed at 1, and four rounds of radiosity with the patch albedo `rho` re-estimated from the fitted light.
- **The baseline is the proof's own model through the same loop** (`ProofModel`, 04_fit's parameterisation exactly). It must reproduce `work/fit.json` (every weight of at least 1e-6 within 1% relative, Task 2's own bar; `ch_centre` and `sun_cap` sit at the bound and are not compared), so the refit's data cost is judged against a baseline computed the same way.

**Acceptance** (all required; a miss stops the task and goes to the controller with the numbers):
1. The refit's data cost (the robust photometric residual alone, `0.5 Σ (ρ(r) w_g)²` at the fourth round, priors excluded) is at most 1.02 times the proof model's.
2. The centre chandelier gets its physical share: `ch_centre / ch_end` equals the lamp ratio (its candles plus w_crown × its crown tubes over n̄_end; 1.8370 at the measured w_crown on the 8 October table) to 1e-9, and log φ is more than 0.01 inside its bounds.
3. The Matterport night photograph check is no worse: the proof's `07_compare.py metrics` on the house light alone (`A_comp_house`) at stations 43 and 45, rendered with the refit's multipliers, against the same check rendered from the proof fit on the same day with the same harness: Pearson r at least the baseline's minus 0.005 (the metric's rounding and render noise), the median affine residual and each chroma error at most the baseline's plus 0.02 stop. (The proof's numbers: r 0.881 at 43, 0.820 at 45.)
4. Double runs give identical outputs: the refit and both sensitivity runs each twice in separate processes (`fit.json`, `report.json`, `bulb-intensities.json` and `E_cap.npy` byte for byte, `fit_state.npz` array by array); `03c` and `03d` twice for each installed fit (the ten tables they write, by SHA-256); `05_relight.py` twice for each (every multiplier file it writes, byte for byte); `probes` and `sun-bounce` twice (array by array, as Task 4 as built).
5. Every artifact that depends on the fit is regenerated, in this order, and nothing else is: `fit.json`, `fit_state.npz` and `npy/E_cap.npy` (the refit); `03c_embrasure_roomside.py` (the embrasure rows of `E_cap.npy`, from `fit_state.npz`'s `Wc`, `rho` and `Pdir_cap`; it also rewrites the embrasure rows of `bases_n`, `bases_iso`, `bases_E_win`, `bases_E_ch`, `bases_E_dome` and `bases_E_cove`, which do not depend on the fit and must come out identical); `03d_embrasure_back.py` (`npy/emb_E_back_cap.npy`, from `weights` and `cols`); `05_relight.py` (`mult/*.f16`, from all of `fit_state.npz`: the photo check's inputs and Task 5's proof regression); `probes` (`probes-coarse.npz`: its cubes are solved with the fitted `rho`, and its linearity check reads `fit.json` and `fit_state.npz`); `sun-bounce` (`sun-bounce.npz`: its exact fields and its basis are solved with the fitted `rho`, so K is re-chosen by the same stable rule on the same selection draws, whose directions do not depend on the fit, and both further draws are scored again). `fit.json` does not feed the sun-bounce selection directly; `rho` in `fit_state.npz` does, so the whole `sun-bounce` bake is re-run. Not re-run, because they do not read the fit: `windows`, `check-sun`, `floor`, the proof steps before the fit, and R1c's `skin-light` (direct light of white unit sources). Task 5 then packages the refit's weights and per-group colours, and Task 6 calibrates the floor to the refit's `group_albedo_mean["floor"]`.
6. The crown tubes' sensitivity (ruling L2) is reported and does not clearly prefer an end: `refit-house sensitivity` holds, for the refit and the runs at w_crown 0 and 1, the data cost, the `ch_centre` share at the floor and the ceiling and the photo metrics at both night stations, and fails when every metric at both stations (r, the median affine residual and both chroma errors) is better at one end than at the other by more than that metric's run-to-run noise (the difference between two renders of the refit's own multipliers, never below the metrics' 0.001 rounding). A failure stops the task: the three metric sets and the noise go to the controller, who chooses w_crown; the task never chooses an end itself.
7. The range-aware balance (ruling L4) holds: the centre's candles' median residual against the ends' range fit lies within 2 × the largest leave-one-out end spread. A failure stops the task (Step 10) and `promote` refuses; the numbers go to the controller either way.

- [ ] **Step 1: Write the failing tests** — create `tools/relight/tests/test_housefit.py`:

```python
import json, math, os, tempfile, unittest
import numpy as np
from relight import housefit as HF

CENTRES = np.array([[2.24, -7.66, 4.28], [2.24, -2.42, 4.24], [8.9, -5.0, 4.82], [15.5, -7.68, 4.28], [15.47, -2.33, 4.3]])
T_JE = np.array([[0.0, -1.0, 0.0, 0.5], [1.0, 0.0, 0.0, 0.25], [0.0, 0.0, 1.0, -2.0], [0.0, 0.0, 0.0, 1.0]])
LAMP_RATIO = np.array([1.623, 1.0, 0.467])
K = HF.FitConstants(groups=6, paint=5, paint_albedo=0.60, huber=0.25, gamma_free=False)
EXCLUDE = "exclude: by eye a brass highlight or glare that triangulated, not a lamp"
LOW = "low: unresolved by eye"
MEDIUM = "medium: a lamp seen by eye, partly hidden, dim or small (the centre chandelier's crown tubes)"
CANDLE_AREAS = (3000.0, 3400.0, 2600.0, 3800.0)     # the centre's four candles in face s09_f2: median 3,200 mm2


def bulb(cid, n, confidence="high", offset=(0.3, 0.0, 0.0)):
    p = CENTRES[cid] + np.asarray(offset, np.float64)
    return {"id": f"c{cid}_b{n:02d}", "chandelier": cid, "position_e57": p.tolist(), "confidence": confidence, "faces": []}


def full_table():
    """Two candles on each end chandelier and four on the centre one, symmetric about each centre, the centre's in one
    face; two crown tubes 0.5 m above the centre's candles (1,280 and 1,600 mm2 in that face, and the second in a face
    without candles); a "medium" lamp on chandelier 1 (a candle: only the centre chandelier has crown tubes); a brass glint
    on chandelier 0 and an unresolved entry on chandelier 3, neither a lamp."""
    out = []
    for c in range(5):
        lamps = 4 if c == 2 else 2
        for n in range(lamps):
            a = 2 * math.pi * n / lamps
            out.append(bulb(c, n, offset=(0.3 * math.cos(a), 0.3 * math.sin(a), 0.1)))
            if c == 2:
                out[-1]["faces"] = [{"face": "s09_f2", "blob_area_mm2": CANDLE_AREAS[n]}]
    out.append(dict(bulb(2, 5, MEDIUM, offset=(0.2, 0.0, 0.6)), faces=[{"face": "s09_f2", "blob_area_mm2": 1280.0}]))
    out.append(dict(bulb(2, 6, MEDIUM, offset=(-0.2, 0.0, 0.6)),
                    faces=[{"face": "s09_f2", "blob_area_mm2": 1600.0}, {"face": "s10_f0", "blob_area_mm2": 900.0}]))
    out.append(bulb(1, 5, MEDIUM, offset=(0.0, 0.3, 0.0)))
    out.append(bulb(0, 7, EXCLUDE))
    out.append(bulb(3, 8, LOW, offset=(0.0, 0.0, 0.2)))
    return {"schema": HF.BULBS_SCHEMA, "frames": {"T_json_from_e57": T_JE.tolist()}, "bulbs": out}


def entry(table, bid):
    return next(b for b in table["bulbs"] if b["id"] == bid)


def write(folder, data):
    path = os.path.join(folder, "bulbs.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return path


class Bulbs(unittest.TestCase):
    def test_the_lamps_are_the_high_and_medium_entries_and_the_crown_tubes_a_kind_of_their_own(self):
        with tempfile.TemporaryDirectory() as d:
            got = HF.read_bulbs(write(d, full_table()), CENTRES, T_JE)
        self.assertEqual(got["counts"], {0: 2, 1: 3, 2: 6, 3: 2, 4: 2})
        self.assertEqual(got["candles"], {0: 2, 1: 3, 2: 4, 3: 2, 4: 2})
        self.assertEqual(got["crowns"], ["c2_b05", "c2_b06"])
        self.assertEqual([got["kinds"][b] for b in ("c1_b05", "c2_b00", "c2_b05")], ["candle", "candle", "crown"])
        self.assertEqual(got["notLamps"], ["c0_b07", "c3_b08"])        # the brass glint and the unresolved entry
        self.assertEqual(sorted(list(got["kinds"]) + got["notLamps"]), got["ids"])
        self.assertEqual(len(got["ids"]), 17)
        self.assertEqual(len(got["sha256"]), 64)
        counts = HF.lamp_counts(got, 0.45)
        self.assertEqual((counts.end_mean, counts.centre_candles, counts.crowns, counts.w_crown), (2.25, 4.0, 2.0, 0.45))
        self.assertAlmostEqual(counts.centre, 4.9, places=14)            # 4 candles + 0.45 x 2 crown tubes
        self.assertAlmostEqual(counts.ratio, 4.9 / 2.25, places=14)
        for w in (-0.1, 1.1, math.nan):
            with self.assertRaises(ValueError):
                HF.lamp_counts(got, w)

    def test_a_table_that_misses_a_chandelier_misplaces_one_or_is_malformed_is_refused(self):
        good = full_table()
        far = full_table(); far["bulbs"][0]["position_e57"] = (CENTRES[0] + [2.0, 0.0, 0.0]).tolist()
        shifted = full_table(); shifted["frames"]["T_json_from_e57"][0][3] += 0.01
        low_crown = full_table(); entry(low_crown, "c2_b05")["position_e57"] = (CENTRES[2] + [0.2, 0.0, 0.05]).tolist()
        unmeasured = full_table()
        for bid in ("c2_b05", "c2_b06"):
            entry(unmeasured, bid)["faces"] = [{"face": "s10_f0", "blob_area_mm2": 900.0}]
        bad = [dict(good, bulbs=[b for b in good["bulbs"] if b["chandelier"] != 4]), far, shifted,
               low_crown, unmeasured, dict(good, bulbs=[b for b in good["bulbs"] if b["id"] not in ("c2_b05", "c2_b06")]),
               dict(good, schema="venviewer.frontier.bulbs.v0"), dict(good, bulbs=good["bulbs"] + [good["bulbs"][0]]),
               dict(good, bulbs=[dict(good["bulbs"][0], confidence="maybe")] + good["bulbs"][1:]),
               dict(good, bulbs=[dict(good["bulbs"][0], id="c1_b00")] + good["bulbs"][1:])]
        with tempfile.TemporaryDirectory() as d:
            for case in bad:
                with self.assertRaises(ValueError):
                    HF.read_bulbs(write(d, case), CENTRES, T_JE)

    def test_the_clipped_cores_compare_the_centre_with_the_ends_face_by_face(self):
        table = full_table()
        table["bulbs"][0]["faces"] = [{"face": "s01_f0", "blob_area_mm2": 1000.0}, {"face": "s02_f0", "blob_area_mm2": 900.0}]
        table["bulbs"][4]["faces"] = [{"face": "s01_f0", "blob_area_mm2": 2000.0}, {"face": "s03_f0", "blob_area_mm2": 5.0}]
        entry(table, "c2_b05")["faces"].append({"face": "s01_f0", "blob_area_mm2": 9000.0})   # a crown tube: left out
        got = HF.blob_balance(table["bulbs"])
        self.assertEqual(got["faces"], 1)                                  # only s01_f0 frames both
        self.assertAlmostEqual(got["medianLog2CentreOverEnd"], 1.0, places=12)

    def test_the_crown_tubes_weigh_their_clipped_cores_against_the_centres_candles_face_by_face(self):
        got = HF.crown_weight(full_table()["bulbs"])
        self.assertEqual((got["pairs"], got["faces"]), (2, 1))           # s10_f0 frames no candle
        self.assertAlmostEqual(got["wCrown"], 0.45, places=12)           # 1,280 and 1,600 over the candles' median 3,200
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(HF.read_bulbs(write(d, full_table()), CENTRES, T_JE)["crownWeight"], got)

    def test_the_centres_candles_are_judged_against_the_ends_with_the_range_taken_out(self):
        def ranged(centre_shift):
            """Six faces, each holding two candles of every chandelier whose clipped area falls as 1 / range (log2 area =
            the face's intercept - log2 range + the chandelier's own shift); the centre's candles 3 m farther away."""
            out = []
            for f in range(6):
                for c, shift in ((0, 0.04), (1, -0.04), (3, 0.02), (4, -0.02), (2, centre_shift)):
                    for n in range(2):
                        d = 4.0 + f + 1.5 * n + (3.0 if c == 2 else 0.25 * c)
                        out.append({"id": f"c{c}_b{10 * f + n:02d}", "chandelier": c, "confidence": "high",
                                    "faces": [{"face": f"s{f:02d}_f0", "distance_m": d,
                                               "blob_area_mm2": 2 ** (11.0 + 0.1 * f - math.log2(d) + shift)}]})
            return out
        self.assertLess(HF.blob_balance(ranged(0.0))["medianLog2CentreOverEnd"], -0.4)   # range alone reads as a dimmer centre
        same = HF.range_balance(ranged(0.0))
        self.assertAlmostEqual(same["slope"], -1.0, delta=0.05)
        self.assertLess(abs(same["balance"]), 0.02)
        self.assertEqual((same["faces"], same["centreUsed"], sorted(same["endSpreads"])), (6, 12, ["0", "1", "3", "4"]))
        self.assertAlmostEqual(same["limit"], 2 * max(abs(v) for v in same["endSpreads"].values()), places=15)
        self.assertTrue(same["pass"])
        dimmer = HF.range_balance(ranged(-1.0))                            # the centre's candles truly half as bright
        self.assertAlmostEqual(dimmer["balance"], -1.0, delta=0.02)
        self.assertEqual((dimmer["pass"], dimmer["endSpreads"]), (False, same["endSpreads"]))
        unjudged = HF.range_balance([b for b in ranged(0.0) if b["chandelier"] != 2])
        self.assertEqual((unjudged["pass"], unjudged["balance"]), (False, None))   # nothing to judge fails, never passes


class Priors(unittest.TestCase):
    def test_the_dome_prior_is_its_emitters_measured_shift_from_the_chandeliers(self):
        colours = {"groups": {"chandelier_emitters_all": {"median_log2_RG_BG": [0.754, -1.169]},
                              "dome_ring_emitters": {"median_log2_RG_BG": [0.404, -0.996]}}}
        p = HF.colour_priors(colours)
        self.assertEqual((p["chandeliers"], p["cove"]), ((0.0, 0.0), (0.0, 0.0)))
        np.testing.assert_allclose(p["dome"], [math.log(2) * -0.350, math.log(2) * 0.173], atol=1e-12)


class Models(unittest.TestCase):
    def test_the_proof_model_is_04_fits_own_parameters(self):
        m = HF.ProofModel(LAMP_RATIO)
        n = HF.n_params(m, K)
        x = np.linspace(-1.0, 1.0, n)
        w, cols, mu, gam = HF.unpack(m, x, K)
        np.testing.assert_allclose(w, np.exp(x[:10]))
        cday = np.exp([x[10], 0.0, x[11]])
        np.testing.assert_allclose(cols[:6], np.tile(cday, (6, 1)))
        np.testing.assert_allclose(cols[6:], np.tile(cday * LAMP_RATIO, (4, 1)))
        self.assertAlmostEqual(float(mu[5, 1]), math.log(0.60), places=15)
        self.assertAlmostEqual(gam, math.exp(x[-1]), places=15)
        self.assertEqual(n, 34)
        lo, hi = HF.bounds_of(m, n, K)
        self.assertEqual((lo[0], hi[9], lo[12], hi[15], lo[-1], hi[-1]), (-25.0, 12.0, -1e-9, 1e-9, -1e-9, 1e-9))
        self.assertEqual(len(m.priors(x)), 11)

    def test_the_refit_shares_one_per_bulb_intensity_and_colours_each_lamp_group(self):
        counts = HF.LampCounts(end_mean=23.25, centre_candles=40.0, crowns=7.0, w_crown=0.4)
        m = HF.RefitModel(LAMP_RATIO, counts, {"chandeliers": (0.0, 0.0), "dome": (-0.24, 0.12), "cove": (0.0, 0.0)})
        n = HF.n_params(m, K)
        x = np.zeros(n); x[8] = math.log(0.05); x[13] = 0.1; x[16] = -0.2
        w, cols, _mu, _gam = HF.unpack(m, x, K)
        self.assertAlmostEqual(w[7], 0.05 * 23.25, places=12)
        self.assertAlmostEqual(w[8], 0.05 * 42.8, places=12)             # 40 candles + 0.4 x 7 crown tubes
        self.assertAlmostEqual(w[8] / w[7], counts.ratio, places=12)
        np.testing.assert_allclose(cols[6], LAMP_RATIO)
        np.testing.assert_allclose(cols[7], LAMP_RATIO * np.exp([0.1, 0.0, 0.0]))
        np.testing.assert_allclose(cols[8], cols[7])
        np.testing.assert_allclose(cols[9], LAMP_RATIO * np.exp([0.0, 0.0, -0.2]))
        self.assertEqual(n, 35)
        p = m.priors(x)
        self.assertEqual(len(p), 13)
        self.assertAlmostEqual(float(p[11]), 0.15 * (0.0 + 0.24) / HF.COLOUR_PRIOR_SIGMA["dome"], places=12)
        lo, hi = HF.bounds_of(m, n, K)
        self.assertEqual((lo[8], hi[8], lo[11], hi[16]), (-25.0, 12.0, -1.0, 1.0))
        self.assertEqual(m.describe(x)["name"], "refit")
        self.assertEqual(m.describe(x)["lampCounts"]["wCrown"], 0.4)


class Solve(unittest.TestCase):
    def test_the_refit_recovers_known_lights_from_flat_albedos(self):
        rng = np.random.default_rng(7)
        m = HF.RefitModel(LAMP_RATIO, HF.LampCounts(end_mean=2.0, centre_candles=3.0, crowns=2.0, w_crown=0.5),
                          {"chandeliers": (0.0, 0.0), "dome": (0.0, 0.0), "cove": (0.0, 0.0)})
        n = HF.n_params(m, K)
        truth = np.zeros(n)
        truth[:5] = math.log(0.5); truth[5] = -20.0; truth[6] = math.log(0.3); truth[7] = math.log(0.2); truth[8] = math.log(0.15)
        albedo = np.array([[0.3, 0.3, 0.3], [0.5, 0.5, 0.5], [0.2, 0.2, 0.2], [0.4, 0.35, 0.3], [0.25, 0.25, 0.25], [0.55, 0.6, 0.65]])
        truth[m.n_log + m.n_col:-1] = np.delete(np.log(albedo).ravel(), K.paint * 3 + 1)
        V = 600
        Dv = rng.uniform(0.0, 1.0, (V, 10)); Dv[:, 5] = 0.0
        Iv = rng.uniform(0.0, 0.1, (V, 10, 3))
        g = np.repeat(np.arange(6), V // 6)
        E, mu, _gam = HF.model_light(m, truth, Dv, Iv, K)
        data = HF.VoxelData(Dv_ok=Dv, Iv_ok=Iv, logC=np.log(E) + mu[g], g_ok=g, wg=np.full(V, 1.0 / math.sqrt(V / 6)))
        sol = HF.solve(m, HF.anchor_albedo(m, HF.initial_x(m, Dv, K), data, K), data, K)
        w_fit = HF.unpack(m, sol.x, K)[0]
        w_true = HF.unpack(m, truth, K)[0]
        lights = [0, 1, 2, 3, 4, 6, 7, 8, 9]                              # sun_cap has no direct light at these voxels
        np.testing.assert_allclose(w_fit[lights], w_true[lights], rtol=0.02)
        self.assertLess(HF.data_cost(m, sol.x, data, K), 1e-6)


class Acceptance(unittest.TestCase):
    @staticmethod
    def report(cost, w_end=1.0, w_centre=2.0, log_phi=-3.0):
        weights = [1.0] * 10; weights[7] = w_end; weights[8] = w_centre
        return {"dataCost": cost, "weights": weights, "logPerBulb": log_phi}

    def test_the_refit_may_cost_two_percent_more_and_must_light_the_centre_by_its_lamps(self):
        counts = HF.LampCounts(end_mean=2.0, centre_candles=3.0, crowns=2.0, w_crown=0.5)   # centre 4: ratio 2
        proof = self.report(1.0)
        self.assertTrue(HF.accept_fit(proof, self.report(1.019), counts)["pass"])
        self.assertFalse(HF.accept_fit(proof, self.report(1.021), counts)["pass"])
        self.assertFalse(HF.accept_fit(proof, self.report(1.0, w_centre=1.9), counts)["pass"])
        self.assertFalse(HF.accept_fit(proof, self.report(1.0, log_phi=-25.0), counts)["pass"])

    def test_the_night_photographs_must_match_no_worse(self):
        def metrics(r43, r45, mae=0.5, chroma=(0.25, 0.2)):
            row = lambda r: {HF.PHOTO_JOB: {"r": r, "mae_affine_stops": mae, "chroma_mae_rg_bg": list(chroma)}}
            return {"mp43_night_end": row(r43), "mp45_night_windows": row(r45)}
        base = metrics(0.881, 0.820)
        self.assertTrue(HF.photo_gate(base, metrics(0.877, 0.83))["pass"])
        self.assertFalse(HF.photo_gate(base, metrics(0.870, 0.83))["pass"])
        self.assertFalse(HF.photo_gate(base, metrics(0.89, 0.83, mae=0.53))["pass"])
        self.assertFalse(HF.photo_gate(base, metrics(0.89, 0.83, chroma=(0.28, 0.2)))["pass"])

    def test_the_crown_tubes_sensitivity_stops_when_the_photographs_clearly_prefer_an_end(self):
        def metrics(r, mae=0.5, chroma=(0.25, 0.2)):
            return {view: {HF.PHOTO_JOB: {"r": r, "mae_affine_stops": mae, "chroma_mae_rg_bg": list(chroma)}} for view in HF.PHOTO_VIEWS}

        def run(w, photo):
            return {"wCrown": w, "dataCost": 1.0, "budget": {g: {"ch_centre": 0.1 + 0.1 * w} for g in ("floor", "ceiling")},
                    "photo": photo}

        def verdict(low, high):
            runs = {HF.DEFAULT_TAG: run(0.45, metrics(0.880)), HF.variant_tag(0.0): run(0.0, low), HF.variant_tag(1.0): run(1.0, high)}
            return HF.crown_sensitivity(runs, metrics(0.882))           # a second render moves r by 0.002
        self.assertEqual([HF.variant_tag(w) for w in HF.CROWN_ENDS], ["refit-wcrown-0", "refit-wcrown-1"])
        self.assertTrue(verdict(metrics(0.880), metrics(0.881))["pass"])                       # within the noise
        better = metrics(0.885, mae=0.48, chroma=(0.23, 0.18))
        got = verdict(metrics(0.880), better)
        self.assertEqual((got["pass"], got["preferredEnd"]), (False, 1.0))                    # w_crown 1 wins every metric
        self.assertEqual(got["runs"]["refit-wcrown-1"]["chCentreShare"], {"floor": 0.2, "ceiling": 0.2})
        self.assertAlmostEqual(got["noise"]["mp43_night_end"]["r"], 0.002, places=12)
        self.assertEqual(got["noise"]["mp45_night_windows"]["mae_affine_stops"], HF.METRIC_ROUNDING)
        self.assertEqual(verdict(better, metrics(0.880))["preferredEnd"], 0.0)
        self.assertTrue(verdict(metrics(0.880), metrics(0.885, mae=0.48, chroma=(0.25, 0.18)))["pass"])   # one metric level


class Outputs(unittest.TestCase):
    def test_every_lamp_is_named_with_its_kind_per_unit_of_its_group_weight_and_the_rest_are_not_lamps(self):
        with tempfile.TemporaryDirectory() as d:
            bulbs = HF.read_bulbs(write(d, full_table()), CENTRES, T_JE)
        counts = HF.lamp_counts(bulbs, 0.45)                               # the centre: 4 + 0.45 x 2 = 4.9 candles of light
        report = {"weights": [1.0] * 7 + [2.25 * 0.5, 4.9 * 0.5, 1.0], "logPerBulb": math.log(0.5)}
        out = HF.bulb_shares(bulbs, counts, report, "a" * 64)
        self.assertEqual((out["schema"], out["wCrown"]), ("venviewer.bulb-intensities.v1", 0.45))
        self.assertEqual(sorted(list(out["bulbs"]) + out["fit"]["notLamps"]), bulbs["ids"])
        self.assertEqual(out["fit"]["notLamps"], ["c0_b07", "c3_b08"])
        self.assertEqual(out["bulbs"]["c0_b00"], {"kind": "candle", "intensity": 1 / 2.25})
        self.assertEqual(out["bulbs"]["c2_b05"]["kind"], "crown")
        self.assertAlmostEqual(out["bulbs"]["c2_b03"]["intensity"], 1 / 4.9, places=15)
        self.assertAlmostEqual(out["bulbs"]["c2_b05"]["intensity"], 0.45 * out["bulbs"]["c2_b03"]["intensity"], places=15)
        centre = [v["intensity"] for bid, v in out["bulbs"].items() if bid.startswith("c2_")]
        self.assertAlmostEqual(sum(centre), 1.0, places=12)                # the centre chandelier's lamps carry its weight
        self.assertAlmostEqual(out["fit"]["groups"]["ch_end"]["chandeliers"]["1"]["share"], 3 / 9, places=15)
        self.assertAlmostEqual(out["fit"]["lampRatio"], 4.9 / 2.25, places=12)
        self.assertEqual(out["fit"]["crownWeightMeasured"]["pairs"], 2)

    def test_two_runs_are_compared_array_by_array_and_byte_by_byte(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            for d in (a, b):
                np.savez(os.path.join(d, "fit_state.npz"), rho=np.ones((2, 3), np.float32))
                with open(os.path.join(d, "fit.json"), "w", encoding="utf-8") as f:
                    f.write('{"a": 1}')
            self.assertEqual(HF.same_run(a, b), [])
            np.savez(os.path.join(b, "fit_state.npz"), rho=np.zeros((2, 3), np.float32))
            with open(os.path.join(b, "extra.json"), "w", encoding="utf-8") as f:
                f.write("{}")
            self.assertEqual(HF.same_run(a, b), ["extra.json", "fit_state.npz"])

    def test_the_proof_fit_is_kept_once_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as work:
            os.makedirs(os.path.join(work, "npy"))
            for name, data in (("fit.json", b'{"weights": [1]}'), ("fit_state.npz", b"npz"), ("npy/E_cap.npy", b"cap"),
                               ("npy/emb_E_back_cap.npy", b"back")):
                with open(os.path.join(work, name), "wb") as f:
                    f.write(data)
            first = HF.snapshot_fit(work)
            self.assertEqual(sorted(first), sorted(HF.FIT_FILES))
            self.assertEqual(HF.snapshot_fit(work), first)                 # again: the same snapshot
            with open(os.path.join(work, "npy", "E_cap.npy"), "wb") as f:
                f.write(b"changed")
            with self.assertRaises(ValueError):
                HF.snapshot_fit(work)
            with open(os.path.join(work, "fit.json"), "w", encoding="utf-8") as f:
                f.write('{"model": {"name": "refit"}}')
            self.assertEqual(HF.snapshot_fit(work), first)                 # the work holds the refit: the snapshot stands


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_housefit -v`
Expected: FAIL, `ImportError: cannot import name 'housefit'`.

- [ ] **Step 3: Write the refit** — create `tools/relight/relight/housefit.py`:

```python
"""The house lights refitted (T-639 R1a Task 4b): the capture's light fit of proof/04_fit.py, run by the same loop, with
the house lights parameterised by the frontier splats study's bulb table instead of free per-group weights.

The proof's fit gives the centre chandelier a weight of 1.4e-11 (its bound) although the 31 May walk saw it lit
throughout; albedo flatness cannot tell its light from the dome ring's and the end chandeliers', so they took it.

RefitModel: one per-bulb intensity phi for every chandelier candle. The lamps are the table's "high" and "medium"
entries (the splats study's 140); "low" and "exclude" entries are not lamps. The centre chandelier's crown tubes (its
"medium" entries whose reading names them) are a second kind of lamp, each w_crown x phi, with w_crown measured from the
table's clipped cores (crown_weight), a default the plan's sensitivity runs bracket at 0 and 1. 03_bases.py's E_ch[:, 0]
is the four end chandeliers' unit point lights summed and E_ch[:, 1] the centre chandelier's, so ch_end weighs phi x the
mean lamp count of the four ends and ch_centre phi x (its candles + w_crown x its crown tubes): their ratio is that
count ratio exactly. A colour per lamp group
(cove, chandeliers, dome): the measured lamp/daylight ratio times exp of a fitted (R/G, B/G) offset held by a prior per
group (colour_priors). Everything else is 04_fit.py's. ProofModel is 04_fit.py's own parameterisation through the same
loop: it reproduces the proof's fit and is the baseline the refit's data cost is judged against. The plan's Task 4b
gives the reasons for each choice.
"""
from __future__ import annotations

import hashlib, json, math, os, shutil, time
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

BULBS_SCHEMA = "venviewer.frontier.bulbs.v1"
SHARES_SCHEMA = "venviewer.bulb-intensities.v1"
CHANDELIERS = 5
CENTRE = 2
ENDS = (0, 1, 3, 4)
VOLUME_RADIUS = (0.75, 0.75, 1.0, 0.75, 0.75)    # 02_geometry.py's chandelier volumes (horizontal radius, m)
VOLUME_MARGIN = 0.10                            # two triangulated bulbs stand a few mm outside the radius
CENTROID_TOLERANCE = 0.25                       # a chandelier's lamps' median stands this close to its model centre (m)
FRAME_TOLERANCE = 1e-9
LIGHTS = ("W1", "W2", "W3", "W4", "W5", "sun_cap", "cove", "ch_end", "ch_centre", "dome")   # 04_fit.BASES
COLOUR_PRIOR_SIGMA = {"cove": 0.35, "chandeliers": 0.035, "dome": 0.10}   # natural log: 0.5, 0.05 and 0.15 stop
PRIOR_WEIGHT = 0.15                             # 04_fit.py's prior strength
OFFSET_BOUND = 1.0                              # a lamp colour offset stays within e^+-1 (1.44 stops)
LOG_BOUNDS = (-25.0, 12.0)                      # 04_fit.py's bounds on the log weights
RESIDUAL_TOLERANCE = 0.02                       # the refit's data cost may exceed the proof model's by at most 2%
RATIO_TOLERANCE = 1e-9
BOUND_MARGIN = 0.01
REPRODUCE_TOLERANCE = 0.01                      # the proof model against fit.json (Task 2's bar)
LAMP_WORDS = ("high", "medium")                 # the lamps: the splats study's 140 (the controller's ruling L1, 8 October)
NOT_LAMP_WORDS = ("low", "exclude")             # unresolved by eye, or a brass highlight or glare: not lamps
CANDLE, CROWN = "candle", "crown"               # the two kinds of lamp (ruling L2)
CROWN_TEXT = "crown tube"                       # a centre-chandelier "medium" reading that names the crown tubes
CROWN_WEIGHT_RANGE = (0.0, 1.0)                 # w_crown, a crown tube's intensity over a candle's
CROWN_ENDS = (0.0, 1.0)                         # the sensitivity runs' w_crown
DEFAULT_TAG = "refit"                           # the refit at the measured w_crown; a sensitivity run is refit-wcrown-<w>
RANGE_FACE_MIN = 2                              # a face's intercept in the range fit needs at least two fitted candles
RANGE_SPREAD_FACTOR = 2.0                       # the centre's range-aware balance within 2x the largest end spread (L4)
PHOTO_VIEWS = ("mp43_night_end", "mp45_night_windows")
PHOTO_JOB = "A_comp_house"
PHOTO_R_SLACK = 0.005
PHOTO_STOPS_SLACK = 0.02
PHOTO_METRICS = (("r", 1.0), ("mae_affine_stops", -1.0), ("chroma_rg", -1.0), ("chroma_bg", -1.0))   # +1: higher is better
METRIC_ROUNDING = 0.001                         # 07_compare.py rounds every metric to 3 decimals
FIT_FILES = ("fit.json", "fit_state.npz", "npy/E_cap.npy", "npy/emb_E_back_cap.npy")
SNAPSHOT = "fit-proof"
SCENARIOS = ("comp_house", "mask", "night", "sunny_morning", "overcast_noon")


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def confidence_word(entry) -> str:
    """The by-eye reading's first word ("high: ...", "medium: ..."); any word but the table's four is refused."""
    word = str(entry.get("confidence", "")).split(":")[0].strip()
    if word not in LAMP_WORDS + NOT_LAMP_WORDS:
        raise ValueError(f"bulb {entry.get('id')!r}: unknown confidence {entry.get('confidence')!r}")
    return word


def is_lamp(entry) -> bool:
    """A lamp is a "high" or "medium" entry (ruling L1: the splats study's 140); "low" (unresolved by eye) and "exclude"
    (a brass highlight or glare) are not lamps."""
    return confidence_word(entry) in LAMP_WORDS


def lamp_kind(entry) -> str:
    """CROWN for the centre chandelier's crown tubes, its "medium" entries whose reading names them (ruling L2); every
    other lamp is a CANDLE."""
    if not is_lamp(entry):
        raise ValueError(f"bulb {entry.get('id')!r} is not a lamp")
    crown = (int(entry["chandelier"]) == CENTRE and confidence_word(entry) == "medium"
             and CROWN_TEXT in str(entry["confidence"]))
    return CROWN if crown else CANDLE


def blob_balance(bulbs) -> dict:
    """Evidence for one per-bulb intensity, never fitted: in each face that frames candles of the centre chandelier and
    of an end chandelier (one exposure), log2 of the centre's median clipped-core area (mm2 at the bulb) over the ends';
    the median over those faces. The area is a relative, monotone proxy of intensity within one face (the table's note).
    The crown tubes are left out: crown_weight measures them."""
    faces = {}
    for b in bulbs:
        if not is_lamp(b) or lamp_kind(b) == CROWN:
            continue
        side = "centre" if int(b["chandelier"]) == CENTRE else "end"
        for f in b.get("faces", []):
            area = f.get("blob_area_mm2")
            if area is not None and area > 0:
                faces.setdefault(f["face"], {"centre": [], "end": []})[side].append(float(area))
    logs = [math.log2(float(np.median(v["centre"])) / float(np.median(v["end"]))) for v in faces.values() if v["centre"] and v["end"]]
    return {"faces": len(logs), "medianLog2CentreOverEnd": float(np.median(logs)) if logs else None}


def crown_weight(bulbs) -> dict:
    """w_crown's measured default (ruling L2), never fitted: in each face that frames crown tubes and candles of the
    centre chandelier (one exposure), each crown tube's clipped-core area (mm2 at the bulb) over the median of those
    candles'; the median over every such (tube, face) pair. The area is a relative, monotone proxy of intensity within one
    face (the table's note), so this is a default, which the sensitivity runs bracket at 0 and 1. A table without crown
    tubes, or whose crown tubes share no face with a candle, is refused."""
    faces = {}
    for b in bulbs:
        if int(b["chandelier"]) != CENTRE or not is_lamp(b):
            continue
        kind = lamp_kind(b)
        for f in b.get("faces", []):
            area = f.get("blob_area_mm2")
            if area is not None and area > 0:
                faces.setdefault(f["face"], {CANDLE: [], CROWN: []})[kind].append(float(area))
    shared = [v for v in faces.values() if v[CROWN] and v[CANDLE]]
    ratios = [a / float(np.median(v[CANDLE])) for v in shared for a in v[CROWN]]
    if not ratios:
        raise ValueError("no face frames both a crown tube and a candle of the centre chandelier (or the table names no "
                         "crown tubes): w_crown cannot be measured")
    return {"wCrown": float(np.median(ratios)), "pairs": len(ratios), "faces": len(shared)}


def candle_detections(bulbs) -> list:
    """Every detection of a candle with a positive clipped area and range: (chandelier, face, log2 of its clipped area in
    mm2 at the bulb (blob_area_mm2), log2 of the face's station-to-bulb range in m (distance_m))."""
    out = []
    for b in bulbs:
        if not is_lamp(b) or lamp_kind(b) != CANDLE:
            continue
        for f in b.get("faces", []):
            area, rng = f.get("blob_area_mm2"), f.get("distance_m")
            if area is not None and rng is not None and area > 0 and rng > 0:
                out.append((int(b["chandelier"]), str(f["face"]), math.log2(float(area)), math.log2(float(rng))))
    return out


def range_fit(detections):
    """log2 area = a_face + slope x log2 range, least squares with a per-face intercept (one exposure per face) and one
    shared slope, over the faces holding at least RANGE_FACE_MIN of these detections: (slope, {face: a_face}), or None
    when no face does or the ranges never vary within a face."""
    faces = {}
    for _c, face, y, x in detections:
        faces.setdefault(face, []).append((x, y))
    faces = {f: np.asarray(v, np.float64) for f, v in faces.items() if len(v) >= RANGE_FACE_MIN}
    sxx = sum(float(((v[:, 0] - v[:, 0].mean()) ** 2).sum()) for v in faces.values())
    if sxx <= 0.0:
        return None
    slope = sum(float(((v[:, 0] - v[:, 0].mean()) * (v[:, 1] - v[:, 1].mean())).sum()) for v in faces.values()) / sxx
    return slope, {f: float(v[:, 1].mean() - slope * v[:, 0].mean()) for f, v in faces.items()}


def median_residual(detections, fit):
    """(the median residual of these detections against a range fit, in log2, and how many faces of the fit held them)."""
    slope, intercepts = fit
    r = [y - intercepts[face] - slope * x for _c, face, y, x in detections if face in intercepts]
    return (float(np.median(r)) if r else None), len(r)


def range_balance(bulbs) -> dict:
    """Ruling L4: whether the clipped cores contradict one intensity per candle once range is taken out. The range fit
    is made on the four end chandeliers' candles; the centre's candles' median residual against it is the corrected
    balance. Each end chandelier's median residual against the fit of the other three (leave-one-out) is its spread;
    the centre passes within RANGE_SPREAD_FACTOR x the largest |spread|. Never raises: a table it cannot judge fails,
    with the reason."""
    detections = candle_detections(bulbs)
    ends = [d for d in detections if d[0] in ENDS]
    centre = [d for d in detections if d[0] == CENTRE]
    out = {"factor": RANGE_SPREAD_FACTOR, "faceMin": RANGE_FACE_MIN, "detections": {"ends": len(ends), "centre": len(centre)},
           "slope": None, "faces": 0, "balance": None, "centreUsed": 0, "endSpreads": {}, "largestEndSpread": None,
           "limit": None, "pass": False, "reason": None}
    fit = range_fit(ends)
    if fit is None:
        out["reason"] = "the end chandeliers' candles give no range fit (no face holds two of them at different ranges)"
        return out
    out["slope"], out["faces"] = fit[0], len(fit[1])
    out["balance"], out["centreUsed"] = median_residual(centre, fit)
    for c in ENDS:
        others = range_fit([d for d in ends if d[0] != c])
        out["endSpreads"][str(c)] = None if others is None else median_residual([d for d in ends if d[0] == c], others)[0]
    if out["balance"] is None or any(v is None for v in out["endSpreads"].values()):
        out["reason"] = "the centre's candles or an end chandelier share no fitted face"
        return out
    out["largestEndSpread"] = max(abs(v) for v in out["endSpreads"].values())
    out["limit"] = RANGE_SPREAD_FACTOR * out["largestEndSpread"]
    out["pass"] = bool(abs(out["balance"]) <= out["limit"])
    if not out["pass"]:
        out["reason"] = "the centre's candles differ from the ends' by more than the ends differ among themselves"
    return out


def read_bulbs(path, chandelier_centres, t_json_from_e57=None) -> dict:
    """The bulb table: every id; the lamps per chandelier ("high" and "medium"; each chandelier's checked to stand around
    the light model's chandelier of the same index) and each lamp's kind (every crown tube above all the centre
    chandelier's candles); the entries that are not lamps ("low" and "exclude"); the clipped-core evidence (the centre's
    candles against the ends', the crown tubes' measured weight, the range-aware balance of ruling L4) and the table's
    SHA-256."""
    with open(path, "rb") as f:
        raw = f.read()
    data = json.loads(raw)
    if data.get("schema") != BULBS_SCHEMA:
        raise ValueError(f"{path}: the bulb table must be {BULBS_SCHEMA}")
    if t_json_from_e57 is not None:
        theirs = np.asarray(data.get("frames", {}).get("T_json_from_e57"), np.float64)
        if theirs.shape != (4, 4) or float(np.abs(theirs - np.asarray(t_json_from_e57, np.float64)).max()) > FRAME_TOLERANCE:
            raise ValueError(f"{path}: the table's T_json_from_e57 is not the canonical frame's")
    centres = np.asarray(chandelier_centres, np.float64)
    if centres.shape != (CHANDELIERS, 3):
        raise ValueError("the light model has five chandelier centres")
    ids, lamps, not_lamps, kinds = set(), {c: [] for c in range(CHANDELIERS)}, [], {}
    for entry in data["bulbs"]:
        bid, c = str(entry["id"]), int(entry["chandelier"])
        if not 0 <= c < CHANDELIERS or not bid.startswith(f"c{c}_b"):
            raise ValueError(f"bulb {bid!r}: its id and its chandelier {c} disagree")
        if bid in ids:
            raise ValueError(f"bulb {bid} appears twice")
        ids.add(bid)
        if is_lamp(entry):
            lamps[c].append((bid, np.asarray(entry["position_e57"], np.float64)))
            kinds[bid] = lamp_kind(entry)
        else:
            not_lamps.append(bid)
    counts, candles = {}, {}
    for c in range(CHANDELIERS):
        if not lamps[c]:
            raise ValueError(f"chandelier {c} has no lamp in the table: the refit needs all five")
        P = np.stack([p for _bid, p in lamps[c]])
        off = float(np.hypot(*(np.median(P, 0)[:2] - centres[c, :2])))
        reach = float(np.hypot(P[:, 0] - centres[c, 0], P[:, 1] - centres[c, 1]).max())
        if off > CENTROID_TOLERANCE or reach > VOLUME_RADIUS[c] + VOLUME_MARGIN:
            raise ValueError(f"chandelier {c}'s lamps do not stand around the light model's chandelier {c} "
                             f"(median {off:.3f} m off its axis, farthest {reach:.3f} m)")
        counts[c] = len(lamps[c])
        candles[c] = sum(1 for bid, _p in lamps[c] if kinds[bid] == CANDLE)
    crowns = sorted(bid for bid, kind in kinds.items() if kind == CROWN)
    height = {bid: float(p[2]) for bid, p in lamps[CENTRE]}
    lowest_crown = min((height[bid] for bid in crowns), default=math.inf)
    highest_candle = max((z for bid, z in height.items() if kinds[bid] == CANDLE), default=-math.inf)
    if lowest_crown <= highest_candle:
        raise ValueError(f"a crown tube stands at {lowest_crown:.3f} m, not above every candle of the centre chandelier "
                         f"(the highest at {highest_candle:.3f} m): the reading that names the crown tubes is wrong here")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "ids": sorted(ids), "counts": counts, "candles": candles,
            "crowns": crowns, "kinds": dict(sorted(kinds.items())),
            "lamps": {c: sorted(b for b, _p in lamps[c]) for c in range(CHANDELIERS)}, "notLamps": sorted(not_lamps),
            "blobBalance": blob_balance(data["bulbs"]), "crownWeight": crown_weight(data["bulbs"]),
            "rangeBalance": range_balance(data["bulbs"])}


@dataclass(frozen=True)
class LampCounts:
    end_mean: float          # mean lamps per end chandelier, every one a candle (the four summed in E_ch[:, 0])
    centre_candles: float    # the centre chandelier's candles (E_ch[:, 1])
    crowns: float            # the centre chandelier's crown tubes
    w_crown: float           # a crown tube's intensity over a candle's

    @property
    def centre(self) -> float:
        """The centre chandelier's light in candles: its candles plus w_crown x its crown tubes."""
        return self.centre_candles + self.w_crown * self.crowns

    @property
    def ratio(self) -> float:
        return self.centre / self.end_mean


def lamp_counts(bulbs, w_crown) -> LampCounts:
    """read_bulbs' lamps at a crown weight within CROWN_WEIGHT_RANGE."""
    w = float(w_crown)
    if not (math.isfinite(w) and CROWN_WEIGHT_RANGE[0] <= w <= CROWN_WEIGHT_RANGE[1]):
        raise ValueError(f"w_crown {w_crown!r} is outside {CROWN_WEIGHT_RANGE}")
    candles = bulbs["candles"]
    return LampCounts(sum(candles[c] for c in ENDS) / len(ENDS), float(candles[CENTRE]), float(len(bulbs["crowns"])), w)


def colour_priors(lamp_colours) -> dict:
    """Each lamp group's prior offset (natural log of R/G and B/G) from the measured lamp/daylight ratio: the chandeliers
    at 0 (the ratio was measured on their splats, 94% of the sample), the dome at its emitter splats' measured shift from
    the chandeliers', the cove at 0 (its splats measure the tape times the albedo, not the tape)."""
    g = lamp_colours["groups"]
    ch, dome = g["chandelier_emitters_all"]["median_log2_RG_BG"], g["dome_ring_emitters"]["median_log2_RG_BG"]
    ln2 = math.log(2.0)
    return {"cove": (0.0, 0.0), "chandeliers": (0.0, 0.0),
            "dome": (ln2 * (float(dome[0]) - float(ch[0])), ln2 * (float(dome[1]) - float(ch[1])))}


@dataclass(frozen=True)
class FitConstants:
    """04_fit.py's constants the loop needs (read from the module; tests give their own)."""
    groups: int
    paint: int
    paint_albedo: float
    huber: float
    gamma_free: bool

    @classmethod
    def of(cls, fit04) -> "FitConstants":
        return cls(len(fit04.GROUPS), int(fit04.PAINT), float(fit04.PAINT_ALBEDO), float(fit04.HUBER), bool(fit04.GAMMA_FREE))


class ProofModel:
    """04_fit.py's parameters: x[0:10] log weights of LIGHTS; x[10:16] the daylight, cove and house colours' (R, B) logs,
    the lamp colours pinned to cday x the measured ratio; then the albedos and log gamma."""
    name, n_log, n_col = "proof", 10, 6

    def __init__(self, lamp_ratio):
        self.lamp_ratio = None if lamp_ratio is None else np.asarray(lamp_ratio, np.float64)

    def init_log(self, w0):
        return np.log(np.asarray(w0, np.float64))

    def weights(self, x):
        return np.exp(np.asarray(x[:10], np.float64))

    def colours(self, x):
        cday, ccove, chouse = (np.exp([x[10 + 2 * i], 0.0, x[11 + 2 * i]]) for i in range(3))
        if self.lamp_ratio is not None:
            ccove = cday * self.lamp_ratio
            chouse = cday * self.lamp_ratio
        return np.stack([cday] * 6 + [ccove] + [chouse] * 3, 0)

    def bounds(self, lo, hi):
        lo[:10], hi[:10] = LOG_BOUNDS
        if self.lamp_ratio is not None:
            lo[12:16], hi[12:16] = -1e-9, 1e-9

    def priors(self, x):
        lw = np.asarray(x[:5], np.float64)
        return np.concatenate([0.15 * (lw - lw.mean()) / 0.6, 0.15 * np.asarray(x[10:16], np.float64) / 0.5])

    def describe(self, x):
        return {"name": self.name}


class RefitModel:
    """x[0:5] the windows' log weights, x[5] the capture's sun, x[6] the cove, x[7] the dome, x[8] log phi (the per-bulb
    chandelier intensity); x[9:11] the daylight colour's (R, B) logs; x[11:13], x[13:15], x[15:17] the cove's, the
    chandeliers' and the dome's colour offsets from cday x the measured ratio; then the albedos and log gamma."""
    name, n_log, n_col = "refit", 9, 8
    OFFSETS = (("cove", 11), ("chandeliers", 13), ("dome", 15))

    def __init__(self, lamp_ratio, counts: LampCounts, priors: dict):
        self.lamp_ratio = np.asarray(lamp_ratio, np.float64)
        self.counts = counts
        self.prior_means = {g: tuple(float(v) for v in priors[g]) for g in COLOUR_PRIOR_SIGMA}

    def init_log(self, w0):
        w0 = np.asarray(w0, np.float64)
        log_phi = 0.5 * (math.log(w0[7] / self.counts.end_mean) + math.log(w0[8] / self.counts.centre))
        return np.r_[np.log(w0[:7]), math.log(w0[9]), log_phi]

    def weights(self, x):
        phi = math.exp(float(x[8]))
        return np.r_[np.exp(np.asarray(x[:7], np.float64)), phi * self.counts.end_mean, phi * self.counts.centre, math.exp(float(x[7]))]

    def colours(self, x):
        cday = np.exp([x[9], 0.0, x[10]])
        base = cday * self.lamp_ratio
        lamp = {g: base * np.exp([x[i], 0.0, x[i + 1]]) for g, i in self.OFFSETS}
        return np.stack([cday] * 6 + [lamp["cove"]] + [lamp["chandeliers"]] * 2 + [lamp["dome"]], 0)

    def bounds(self, lo, hi):
        lo[:9], hi[:9] = LOG_BOUNDS
        lo[11:17], hi[11:17] = -OFFSET_BOUND, OFFSET_BOUND

    def priors(self, x):
        x = np.asarray(x, np.float64)
        lw = x[:5]
        out = [0.15 * (lw - lw.mean()) / 0.6, 0.15 * x[9:11] / 0.5]
        for g, i in self.OFFSETS:
            out.append(PRIOR_WEIGHT * (x[i:i + 2] - np.asarray(self.prior_means[g])) / COLOUR_PRIOR_SIGMA[g])
        return np.concatenate(out)

    def describe(self, x):
        return {"name": self.name, "perBulbIntensity": math.exp(float(x[8])), "logPerBulb": float(x[8]),
                "lampCounts": {"endMean": self.counts.end_mean, "centreCandles": self.counts.centre_candles,
                               "crowns": self.counts.crowns, "wCrown": self.counts.w_crown, "centre": self.counts.centre,
                               "ratio": self.counts.ratio},
                "colourOffsets": {g: [float(x[i]), float(x[i + 1])] for g, i in self.OFFSETS},
                "colourPriors": {g: list(self.prior_means[g]) for g in COLOUR_PRIOR_SIGMA}, "colourPriorSigma": dict(COLOUR_PRIOR_SIGMA)}


def n_params(model, k: FitConstants) -> int:
    return model.n_log + model.n_col + k.groups * 3 - 1 + 1


def unpack(model, x, k: FitConstants):
    """(weights (10,), colours (10, 3), log albedos (groups, 3), gamma), as 04_fit.py's unpack."""
    s = model.n_log + model.n_col
    mu = np.insert(np.asarray(x[s:-1], np.float64), k.paint * 3 + 1, math.log(k.paint_albedo)).reshape(k.groups, 3)
    return model.weights(x), model.colours(x), mu, float(math.exp(float(x[-1])))


def model_light(model, x, Dv, Iv, k: FitConstants):
    """The modelled capture light per voxel (04_fit.py's model_E): (E (V, 3), log albedos, gamma)."""
    wts, cols, mu, gam = unpack(model, x, k)
    return np.einsum("vbc,bc->vc", Dv[:, :, None] + Iv, wts[:, None] * cols), mu, gam


@dataclass
class VoxelData:
    Dv_ok: np.ndarray            # (V, 10) direct light per voxel and light
    Iv_ok: np.ndarray | None     # (V, 10, 3) bounce per voxel, light and channel (set each round)
    logC: np.ndarray             # (V, 3) log of the captured voxel colour
    g_ok: np.ndarray             # (V,) material group
    wg: np.ndarray               # (V,) 1 / sqrt(voxels in the group)
    C: np.ndarray | None = None  # (V, 3) the captured voxel colour (diagnostics)


def residuals(model, x, data: VoxelData, k: FitConstants):
    """(data part, prior part): 04_fit.py's pseudo-Huber residual on log colour per voxel and channel times the group
    weight, and the model's priors."""
    E, mu, gam = model_light(model, x, data.Dv_ok, data.Iv_ok, k)
    r = data.logC - gam * (np.log(np.maximum(E, 1e-9)) + mu[data.g_ok])
    rt = np.sign(r) * k.huber * np.sqrt(2.0 * (np.sqrt(1.0 + (r / k.huber) ** 2) - 1.0))
    return (rt * data.wg[:, None]).ravel(), model.priors(x)


def data_cost(model, x, data: VoxelData, k: FitConstants) -> float:
    d, _p = residuals(model, x, data, k)
    return float(0.5 * np.dot(d, d))


def bounds_of(model, n, k: FitConstants):
    lo, hi = np.full(n, -np.inf), np.full(n, np.inf)
    model.bounds(lo, hi)
    lo[-1], hi[-1] = (math.log(0.3), math.log(1.5)) if k.gamma_free else (-1e-9, 1e-9)
    return lo, hi


def initial_x(model, Dv, k: FitConstants):
    """04_fit.py's start: every light contributes about 0.2 where it is typical."""
    nb = Dv.shape[1]
    dnz = [np.median(Dv[Dv[:, j] > 0, j]) if (Dv[:, j] > 0).any() else 1.0 for j in range(nb)]
    x = np.zeros(n_params(model, k))
    x[:model.n_log] = model.init_log(0.2 / np.maximum(dnz, 1e-9))
    return x


def anchor_albedo(model, x, data: VoxelData, k: FitConstants):
    """04_fit.py's first round: the group albedos the start light implies, every light scaled so the paint band's mean
    green albedo is the anchor."""
    E0, _mu, _g = model_light(model, x, data.Dv_ok, data.Iv_ok, k)
    mu0 = np.stack([np.mean(data.logC[data.g_ok == gi] - np.log(E0[data.g_ok == gi]), 0) for gi in range(k.groups)])
    shift = mu0[k.paint, 1] - math.log(k.paint_albedo)
    x = np.array(x, np.float64)
    x[:model.n_log] += shift
    mu0 -= shift
    x[model.n_log + model.n_col:-1] = np.delete(mu0.ravel(), k.paint * 3 + 1)
    return x


def solve(model, x, data: VoxelData, k: FitConstants):
    """04_fit.py's least_squares call: trust-region reflective, x_scale 'jac', at most 4000 evaluations."""
    lo, hi = bounds_of(model, len(x), k)
    return least_squares(lambda z: np.concatenate(residuals(model, z, data, k)), np.clip(x, lo + 1e-9, hi - 1e-9),
                         bounds=(lo, hi), method="trf", x_scale="jac", max_nfev=4000)


def run_capture_fit(model, k: FitConstants, mods, out_dir, write_ecap, log=print) -> dict:
    """04_fit.py's main with the model's parameters: the fit set and its voxels, four rounds of radiosity, the light fit
    and the patch albedo from it, the diagnostics, and out_dir/fit.json and fit_state.npz in 04_fit.py's shapes (plus the
    model's description); with write_ecap also out_dir/E_cap.npy. mods: fit04, radiosity, store, lt, torch."""
    fit04, rad, st, lt, torch = mods["fit04"], mods["radiosity"], mods["store"], mods["lt"], mods["torch"]
    if tuple(fit04.BASES) != LIGHTS:
        raise ValueError(f"04_fit.BASES is {fit04.BASES}, not {LIGHTS}")
    started = time.time()
    store, probes, pt, occ = st.Store(), st.Probes(), rad.load_patches(), lt.load_occ()
    nb = len(LIGHTS)
    Pdir = fit04.patch_direct_capture(pt, occ)
    F = rad.form_factors(pt["P"], pt["N"], pt["A"], pt["opening"])
    fs = fit04.build_fit_set(store)
    V, vid, w = fs["V"], fs["vid"], fs["w"]
    wsum = np.bincount(vid, w, V); ncount = np.bincount(vid, minlength=V)
    Cv = np.stack([np.bincount(vid, w * fs["C"][:, c], V) for c in range(3)], 1) / np.maximum(wsum, 1e-9)[:, None]
    Dv = np.zeros((V, nb))
    for a in range(0, len(fs["idx"]), 200_000):
        D = fit04.direct(store, fs["idx"][a:a + 200_000])
        for j in range(nb):
            Dv[:, j] += np.bincount(vid[a:a + 200_000], w[a:a + 200_000] * D[:, j], V)
    Dv /= np.maximum(wsum, 1e-9)[:, None]
    ok = (ncount >= 12) & (Cv.min(1) > 0.004) & (Cv.max(1) < 0.97)
    okv = np.where(ok)[0]; g_ok = fs["vgroup"][okv]
    ng = np.bincount(g_ok, minlength=k.groups)
    data = VoxelData(Dv_ok=Dv[okv], Iv_ok=None, logC=np.log(Cv[okv]), g_ok=g_ok, wg=1.0 / np.sqrt(ng[g_ok]), C=Cv[okv])
    sub = np.arange(0, len(fs["idx"]), 3)
    S_idx, S_patch = fit04.patch_samples(store, pt)
    log(f"refit-house {model.name}: voxels {dict(zip(fit04.GROUPS, ng.tolist()))}, {len(S_idx)} albedo samples, "
        f"{time.time() - started:.0f} s")
    x = initial_x(model, data.Dv_ok, k)
    rho = np.full((len(pt["P"]), 3), 0.35, np.float32); rho[pt["opening"]] = 0.0
    history, sol = [], None
    for it in range(4):
        B = rad.radiosity(F, rho, Pdir)
        Iprobe = rad.probe_indirect(probes.P[probes.kp], pt, B)
        Iflat = Iprobe.reshape(len(probes.kp), nb * 3, 6)
        Iv = np.zeros((V, nb * 3))
        for a in range(0, len(sub), 25_000):
            jj = sub[a:a + 25_000]; ii = fs["idx"][jj]
            n, iso = store.normals(ii)
            I = st.eval_cubes(probes, Iflat, store.pos[ii], n, iso)
            for j in range(nb * 3):
                Iv[:, j] += np.bincount(vid[jj], w[jj] * I[:, j], V)
        Iv /= np.maximum(np.bincount(vid[sub], w[sub], V), 1e-9)[:, None]
        data.Iv_ok = Iv[okv].reshape(len(okv), nb, 3)
        if it == 0:
            x = anchor_albedo(model, x, data, k)
        sol = solve(model, x, data, k)
        x = sol.x
        wts, cols, mu, gam = unpack(model, x, k)
        Wc = (wts[:, None] * cols).astype(np.float32)
        Imix = torch.einsum("pbcd,bc->pcd", Iprobe, torch.from_numpy(Wc))
        Es = fit04.E_capture_at(store, probes, S_idx, Wc, Imix)
        alb = np.clip(store.colour(S_idx) ** (1.0 / gam) / np.maximum(Es, 1e-6), 0, 1)
        sums = np.stack([np.bincount(S_patch, alb[:, c], len(pt["P"])) for c in range(3)], 1)
        cnts = np.bincount(S_patch, minlength=len(pt["P"]))
        rho_new = sums / np.maximum(cnts, 1)[:, None]
        rho_new[cnts <= 5] = np.median(rho_new[cnts > 5], 0)
        rho_new[pt["opening"]] = 0.0
        rho = np.clip(rho_new, 0.01, 0.9).astype(np.float32)
        rec = dict(iter=it, cost=round(float(sol.cost), 5), dataCost=data_cost(model, x, data, k), nfev=int(sol.nfev),
                   gamma=round(gam, 4), weights={b: float(f"{v:.5g}") for b, v in zip(LIGHTS, wts)},
                   col_day=cols[0].round(3).tolist(), col_cove=cols[6].round(3).tolist(), col_house=cols[7].round(3).tolist(),
                   col_dome=cols[9].round(3).tolist(), group_albedo_mean=dict(zip(fit04.GROUPS, np.exp(mu).round(3).tolist())),
                   patch_rho_median=np.median(rho[~pt["opening"]], 0).round(3).tolist())
        history.append(rec)
        log(json.dumps(rec) + f" {time.time() - started:.0f} s")
    E, mu, gam = model_light(model, x, data.Dv_ok, data.Iv_ok, k)
    wts, cols, _mu, _gam = unpack(model, x, k)
    spread, budget = {}, {}
    for gi, gname in enumerate(fit04.GROUPS):
        m = data.g_ok == gi
        lc = np.log2(data.C[m]); la = lc - gam * np.log2(np.maximum(E[m], 1e-9))
        lum_c = np.log2(data.C[m] @ st.LUMW); lum_a = lum_c - gam * np.log2(np.maximum(E[m] @ st.LUMW, 1e-9))
        spread[gname] = dict(voxels=int(m.sum()), sd_log2_captured_lum=round(float(np.std(lum_c)), 3),
                             sd_log2_albedo_lum=round(float(np.std(lum_a)), 3), sd_log2_captured_rgb=np.std(lc, 0).round(3).tolist(),
                             sd_log2_albedo_rgb=np.std(la, 0).round(3).tolist())
        contrib = ((data.Dv_ok[m][:, :, None] + data.Iv_ok[m]) * (wts[:, None] * cols)[None]) @ st.LUMW
        ind = (data.Iv_ok[m] * (wts[:, None] * cols)[None]) @ st.LUMW
        budget[gname] = dict(zip(LIGHTS, (contrib.sum(0) / contrib.sum()).round(3).tolist()))
        budget[gname]["indirect_share"] = round(float(ind.sum() / contrib.sum()), 3)
    B = rad.radiosity(F, rho, Pdir)
    Iprobe = rad.probe_indirect(probes.P[probes.kp], pt, B)
    Wc = (wts[:, None] * cols).astype(np.float32)
    os.makedirs(out_dir, exist_ok=True)
    if write_ecap:
        Imix = torch.einsum("pbcd,bc->pcd", Iprobe, torch.from_numpy(Wc))
        part = os.path.join(out_dir, "E_cap.npy.part")
        out = np.lib.format.open_memmap(part, mode="w+", dtype=np.float32, shape=(store.N, 3))
        for sl in store.chunks(200_000):
            n, iso = store.normals(sl)
            out[sl] = fit04.direct(store, sl) @ Wc + st.eval_cubes(probes, Imix, store.pos[sl], n, iso)
        out.flush(); del out
        os.replace(part, os.path.join(out_dir, "E_cap.npy"))
    np.savez(os.path.join(out_dir, "fit_state.npz"), rho=rho, Pdir_cap=Pdir, weights=wts, cols=cols, Wc=Wc, gamma=np.array(gam))
    fit = {"bases": list(LIGHTS), "weights": wts.tolist(), "colours": cols.tolist(), "sky_weights_capture": np.asarray(fit04.SKY_W).tolist(),
           "gamma": gam, "groups": list(fit04.GROUPS), "group_albedo_mean": np.exp(mu).tolist(), "paint_albedo_green": k.paint_albedo,
           "history": history, "spread": spread, "budget": budget, "model": model.describe(x)}
    with open(os.path.join(out_dir, "fit.json"), "w", encoding="utf-8") as f:
        json.dump(fit, f, indent=1, allow_nan=False)
    report = {"model": model.name, "dataCost": history[-1]["dataCost"], "cost": float(sol.cost), "weights": wts.tolist(),
              "colours": cols.tolist(), "gamma": gam, "describe": model.describe(x)}
    if isinstance(model, RefitModel):
        report["logPerBulb"] = float(x[8])
    return report


def bulb_shares(bulbs, counts: LampCounts, report, fit_sha256) -> dict:
    """bulb-intensities.json for R1d's Task 3: every lamp of the table ("high" and "medium") with its kind and its
    intensity per unit of its group's weight (phi over the group's weight: 1 / the mean end-chandelier lamp count for
    ch_end, 1 / (the centre's candles + w_crown x its crown tubes) for ch_centre, and a crown tube w_crown x a candle's),
    the w_crown used, and the refit's group shares (each chandelier's share of its group's lamps). The entries that are
    not lamps ("low" and "exclude") are named only in fit.notLamps: with bulbs they name every id of the table once."""
    per_unit = {"ch_end": 1.0 / counts.end_mean, "ch_centre": 1.0 / counts.centre}
    group_of = lambda bid: "ch_centre" if int(bid.split("_")[0][1:]) == CENTRE else "ch_end"
    values = {bid: {"kind": kind, "intensity": per_unit[group_of(bid)] * (counts.w_crown if kind == CROWN else 1.0)}
              for bid, kind in bulbs["kinds"].items()}
    ends_total = sum(bulbs["counts"][c] for c in ENDS)
    groups = {"ch_end": {"source": 6, "weight": report["weights"][7], "perBulbPerUnitWeight": per_unit["ch_end"],
                         "chandeliers": {str(c): {"lamps": bulbs["counts"][c], "share": bulbs["counts"][c] / ends_total} for c in ENDS}},
              "ch_centre": {"source": 7, "weight": report["weights"][8], "perBulbPerUnitWeight": per_unit["ch_centre"],
                            "crownPerUnitWeight": per_unit["ch_centre"] * counts.w_crown,
                            "chandeliers": {str(CENTRE): {"lamps": bulbs["counts"][CENTRE], "candles": bulbs["candles"][CENTRE],
                                                          "crowns": len(bulbs["crowns"]), "share": 1.0}}}}
    return {"schema": SHARES_SCHEMA, "wCrown": counts.w_crown, "bulbs": dict(sorted(values.items())),
            "fit": {"model": "one per-bulb intensity for every chandelier candle, w_crown of it for a crown tube (T-639 R1a Task 4b)",
                    "perBulbIntensity": math.exp(report["logPerBulb"]), "lampRatio": counts.ratio, "groups": groups,
                    "crownWeightMeasured": bulbs["crownWeight"], "rangeBalance": bulbs["rangeBalance"], "notLamps": bulbs["notLamps"],
                    "blobBalance": bulbs["blobBalance"], "tableSha256": bulbs["sha256"], "fitJsonSha256": fit_sha256}}


def accept_fit(proof, refit, counts: LampCounts) -> dict:
    residual = refit["dataCost"] / proof["dataCost"]
    w = refit["weights"]
    ratio = w[8] / w[7] if w[7] > 0 else math.inf
    lp = refit["logPerBulb"]
    out = {"dataCostProof": proof["dataCost"], "dataCostRefit": refit["dataCost"], "residualRatio": residual,
           "residualPass": bool(residual <= 1.0 + RESIDUAL_TOLERANCE), "centreOverEnd": ratio, "lampRatio": counts.ratio,
           "ratioPass": bool(abs(ratio / counts.ratio - 1.0) <= RATIO_TOLERANCE), "logPerBulb": lp,
           "boundPass": bool(LOG_BOUNDS[0] + BOUND_MARGIN < lp < LOG_BOUNDS[1] - BOUND_MARGIN)}
    out["pass"] = out["residualPass"] and out["ratioPass"] and out["boundPass"]
    return out


def photo_gate(baseline, refit) -> dict:
    """07_compare's house-light metrics at the night stations, the refit's against the proof fit's: no worse."""
    views, ok = {}, True
    for view in PHOTO_VIEWS:
        b, r = baseline[view][PHOTO_JOB], refit[view][PHOTO_JOB]
        row = {"rBaseline": b["r"], "rRefit": r["r"], "maeBaseline": b["mae_affine_stops"], "maeRefit": r["mae_affine_stops"],
               "chromaBaseline": b["chroma_mae_rg_bg"], "chromaRefit": r["chroma_mae_rg_bg"]}
        row["pass"] = bool(r["r"] >= b["r"] - PHOTO_R_SLACK and r["mae_affine_stops"] <= b["mae_affine_stops"] + PHOTO_STOPS_SLACK
                           and all(rc <= bc + PHOTO_STOPS_SLACK for rc, bc in zip(r["chroma_mae_rg_bg"], b["chroma_mae_rg_bg"])))
        ok &= row["pass"]
        views[view] = row
    return {"job": PHOTO_JOB, "views": views, "slack": {"r": PHOTO_R_SLACK, "stops": PHOTO_STOPS_SLACK}, "pass": bool(ok)}


def variant_tag(w_crown) -> str:
    """The refit folder of a sensitivity run at w_crown: refit-wcrown-0, refit-wcrown-1."""
    return f"{DEFAULT_TAG}-wcrown-{float(w_crown):g}"


def photo_values(metrics) -> dict:
    """07_compare's house-light metrics at the night stations: {view: {r, mae_affine_stops, chroma_rg, chroma_bg}}."""
    out = {}
    for view in PHOTO_VIEWS:
        m = metrics[view][PHOTO_JOB]
        out[view] = {"r": m["r"], "mae_affine_stops": m["mae_affine_stops"],
                     "chroma_rg": m["chroma_mae_rg_bg"][0], "chroma_bg": m["chroma_mae_rg_bg"][1]}
    return out


def photo_noise(first, repeat) -> dict:
    """Each metric's run-to-run noise: its difference between two renders of the same multipliers, never below the
    metrics' rounding."""
    a, b = photo_values(first), photo_values(repeat)
    return {view: {key: max(abs(a[view][key] - b[view][key]), METRIC_ROUNDING) for key, _sign in PHOTO_METRICS}
            for view in PHOTO_VIEWS}


def clearly_better(x, y, noise) -> bool:
    """Every metric at both night stations better in x than in y by more than its noise (r higher, the stops lower)."""
    return all(sign * (x[view][key] - y[view][key]) > noise[view][key] for view in PHOTO_VIEWS for key, sign in PHOTO_METRICS)


def crown_sensitivity(runs, repeat) -> dict:
    """The refit at the measured w_crown and at both ends (ruling L2). runs maps DEFAULT_TAG and both variant tags to
    {wCrown, dataCost, budget (fit.json's), photo (07_compare's metrics.json)}; repeat is a second render of the default's
    multipliers, which gives each metric's run-to-run noise. The night photographs clearly prefer an end when every metric
    there beats the other end's by more than its noise: then the task stops and reports instead of choosing."""
    noise = photo_noise(runs[DEFAULT_TAG]["photo"], repeat)
    rows = {tag: {"wCrown": r["wCrown"], "dataCost": r["dataCost"],
                  "chCentreShare": {g: r["budget"][g]["ch_centre"] for g in ("floor", "ceiling")},
                  "photo": photo_values(r["photo"])} for tag, r in runs.items()}
    low, high = (rows[variant_tag(w)]["photo"] for w in CROWN_ENDS)
    preferred = CROWN_ENDS[0] if clearly_better(low, high, noise) else CROWN_ENDS[1] if clearly_better(high, low, noise) else None
    return {"runs": rows, "noise": noise, "metricRounding": METRIC_ROUNDING, "preferredEnd": preferred,
            "pass": preferred is None}


def same_run(dir_a, dir_b) -> list:
    """The names of the files that differ between two runs' folders: .npz array by array (keys, dtype, shape, bytes),
    every other file byte by byte; a file present in one folder only differs."""
    differ = []
    for name in sorted(set(os.listdir(dir_a)) | set(os.listdir(dir_b))):
        pa, pb = os.path.join(dir_a, name), os.path.join(dir_b, name)
        if not (os.path.isfile(pa) and os.path.isfile(pb)):
            differ.append(name)
            continue
        if name.endswith(".npz"):
            with np.load(pa) as za, np.load(pb) as zb:
                same = sorted(za.files) == sorted(zb.files) and all(
                    za[key].dtype == zb[key].dtype and za[key].shape == zb[key].shape and za[key].tobytes() == zb[key].tobytes()
                    for key in za.files)
        else:
            with open(pa, "rb") as fa, open(pb, "rb") as fb:
                same = fa.read() == fb.read()
        if not same:
            differ.append(name)
    return differ


def copy_verified(src, dst) -> str:
    """src copied to dst through a partial file renamed over it; returns the SHA-256, checked equal at both ends."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    part = dst + ".part"
    shutil.copyfile(src, part)
    os.replace(part, dst)
    digest = sha256_file(dst)
    if digest != sha256_file(src):
        raise OSError(f"{dst}: the copied bytes differ from {src}")
    return digest


def snapshot_fit(work) -> dict:
    """The work's capture fit (FIT_FILES) kept once in <work>/fit-proof/. An existing snapshot must equal the files it
    would copy, unless the work's fit.json is already the refit (then the snapshot stands as it is); never overwritten."""
    with open(os.path.join(work, "fit.json"), encoding="utf-8") as f:
        refitted = (json.load(f).get("model") or {}).get("name") == "refit"
    out = {}
    for name in FIT_FILES:
        src, dst = os.path.join(work, name), os.path.join(work, SNAPSHOT, name)
        if os.path.exists(dst):
            if not refitted and sha256_file(dst) != sha256_file(src):
                raise ValueError(f"{dst} exists and differs from {src}: the snapshot of the proof fit is never overwritten")
            out[name] = sha256_file(dst)
        elif refitted:
            raise ValueError(f"{work} holds the refit but no snapshot of the proof fit")
        else:
            out[name] = copy_verified(src, dst)
    return out
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_housefit -v`
Expected: PASS, 15 tests.

- [ ] **Step 5: Register the command** — in `tools/relight/relight/__main__.py`, directly after `    ap.add_argument("--config", required=True)` add:

```python
    ap.add_argument("--from", dest="source", default=None)   # refit-house promote: the staging work folder (Task 4b)
    ap.add_argument("--w-crown", dest="w_crown", type=float, default=None)   # refit-house refit: a sensitivity run's w_crown
    ap.add_argument("--tag", default=None)                    # refit-house compare | install: a refit's folder (default refit)
```

and directly after `COMMANDS["floor"] = cmd_floor` add:

```python


def cmd_refit_house(cfg, args) -> int:
    """The house lights refitted (Task 4b, housefit.py). `proof` runs 04_fit.py's own model through the loop (the
    baseline: it must reproduce this work's fit.json); `refit` the refit at the table's measured w_crown (with
    bulb-intensities.json), or with --w-crown <w> a sensitivity run at that w (folder refit-wcrown-<w>); each writes
    <work>/refit/<folder>/ and never touches the fit the work uses. `compare [--tag <folder>]` checks a refit's two runs
    (refit/<folder> against refit/<folder>-run1; default the refit); `install [--tag <folder>]` puts a refit into this
    (staging) work, the default only when accepted and reproduced, a sensitivity run when its two runs agree;
    `photo-gate` holds 07_compare's night metrics (<work>/cmp/metrics.json) to the baseline's; `sensitivity` compares
    the refit with both sensitivity runs (data cost, the ch_centre share at the floor and the ceiling, the night photos
    against their run-to-run noise) and fails when the photos clearly prefer an end; `promote --from <staging work>`
    keeps this work's proof fit in <work>/fit-proof/ and copies the accepted refit, its embrasure light and its
    multipliers in, and only when every gate passed, the range-aware balance of ruling L4 included; refused, it copies
    nothing and records why. Evidence: <evidence>/refit/*.json (staging) and <evidence>/refit.json (promote, either way).
    CPU only."""
    from . import housefit as HF
    mode, work = args.step, cfg.paths["work"]
    refit_dir, ev_dir = os.path.join(work, "refit"), os.path.join(cfg.paths["evidence"], "refit")
    os.makedirs(ev_dir, exist_ok=True)
    tag = args.tag or HF.DEFAULT_TAG
    suffix = "" if tag == HF.DEFAULT_TAG else f"-{tag}"            # evidence names: compare.json, compare-<tag>.json

    def write_json(path, data):
        part = path + ".part"
        with open(part, "w", encoding="utf-8") as f:
            json.dump(_finite(data), f, indent=1, sort_keys=True, allow_nan=False)
        os.replace(part, path)

    def read_json(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    if mode in ("proof", "refit"):
        common, lt, radiosity, fit04 = _proof_modules()
        import torch
        import store as store_mod
        if fit04.LAMP_RATIO is None:
            print(f"FAIL: {work}/lamp_daylight_ratio.json is missing (04_fit.LAMP_RATIO)", flush=True)
            return 1
        current = read_json(os.path.join(work, "fit.json"))
        if (current.get("model") or {}).get("name") == "refit":
            print("FAIL: this work's fit.json is already the refit; both fits start from the proof fit's tables", flush=True)
            return 1
        k = HF.FitConstants.of(fit04)
        mods = {"fit04": fit04, "radiosity": radiosity, "store": store_mod, "lt": lt, "torch": torch}
        out_dir, bulbs, counts = os.path.join(refit_dir, mode), None, None
        if mode == "proof":
            model = HF.ProofModel(fit04.LAMP_RATIO)
        else:
            with np.load(os.path.join(work, "geom.npz")) as z:
                centres = np.asarray(z["chandeliers"], np.float64)
            bulbs = HF.read_bulbs(cfg.paths["emitters"], centres, common.T_JE)
            if args.w_crown is None:
                counts = HF.lamp_counts(bulbs, bulbs["crownWeight"]["wCrown"])
            else:
                counts = HF.lamp_counts(bulbs, args.w_crown)
                out_dir = os.path.join(refit_dir, HF.variant_tag(args.w_crown))
            model = HF.RefitModel(fit04.LAMP_RATIO, counts, HF.colour_priors(read_json(cfg.paths["lampColours"])))
        started = time.time()
        report = HF.run_capture_fit(model, k, mods, out_dir, write_ecap=(mode == "refit"), log=lambda line: print(line, flush=True))
        report["threads"] = THREADS
        ok = True
        if mode == "proof":
            a, b = np.asarray(current["weights"], np.float64), np.asarray(report["weights"], np.float64)
            both = (a >= 1e-6) & (b >= 1e-6)
            change = float(np.max(np.abs(b[both] - a[both]) / a[both]))
            ok = bool(change <= HF.REPRODUCE_TOLERANCE and int(both.sum()) >= 8)
            report["reproduction"] = {"maxRelWeightChange": change, "weightsCompared": int(both.sum()),
                                      "tolerance": HF.REPRODUCE_TOLERANCE, "pass": ok}
        else:
            report["bulbs"] = {"path": cfg.paths["emitters"], "sha256": bulbs["sha256"], "notLamps": bulbs["notLamps"],
                               "counts": {str(c): n for c, n in bulbs["counts"].items()}, "crowns": bulbs["crowns"],
                               "crownWeightMeasured": bulbs["crownWeight"], "wCrown": counts.w_crown,
                               "blobBalance": bulbs["blobBalance"]}
            write_json(os.path.join(out_dir, "bulb-intensities.json"),
                       HF.bulb_shares(bulbs, counts, report, HF.sha256_file(os.path.join(out_dir, "fit.json"))))
            report["bulbs"]["rangeBalance"] = bulbs["rangeBalance"]
            if args.w_crown is None:   # ruling L4: the bulb table's own check, a gate of promote
                write_json(os.path.join(ev_dir, "range-balance.json"), bulbs["rangeBalance"])
            rb = bulbs["rangeBalance"]
            print(f"range balance (L4): centre {rb['balance']} log2 against the ends, limit {rb['limit']} "
                  f"(end spreads {json.dumps(rb['endSpreads'])}): {'PASS' if rb['pass'] else 'STOP: ' + str(rb['reason'])}", flush=True)
        write_json(os.path.join(out_dir, "report.json"), report)
        print(f"refit-house {mode} -> {out_dir}: data cost {report['dataCost']:.6f}, weights {json.dumps(report['weights'])}, "
              f"{'PASS' if ok else 'FAIL'}, {time.time() - started:.0f} s", flush=True)
        return 0 if ok else 1
    if mode == "compare":
        run_a, run_b = os.path.join(refit_dir, f"{tag}-run1"), os.path.join(refit_dir, tag)
        differ = HF.same_run(run_a, run_b)
        write_json(os.path.join(ev_dir, f"compare{suffix}.json"), {"runA": run_a, "runB": run_b, "differ": differ, "pass": not differ,
                                                                  "sha256": {n: HF.sha256_file(os.path.join(run_b, n)) for n in sorted(os.listdir(run_b))}})
        print(f"refit-house compare {tag}: {'identical' if not differ else 'DIFFER: ' + ', '.join(differ)}", flush=True)
        return 0 if not differ else 1
    if mode == "install":
        compare = read_json(os.path.join(ev_dir, f"compare{suffix}.json"))
        if tag == HF.DEFAULT_TAG:
            proof = read_json(os.path.join(refit_dir, "proof", "report.json"))
            refit = read_json(os.path.join(refit_dir, tag, "report.json"))
            c = refit["describe"]["lampCounts"]
            verdict = HF.accept_fit(proof, refit, HF.LampCounts(c["endMean"], c["centreCandles"], c["crowns"], c["wCrown"]))
            verdict.update(reproduction=proof["reproduction"], runsIdentical=compare["pass"])
            verdict["pass"] = bool(verdict["pass"] and proof["reproduction"]["pass"] and compare["pass"])
            write_json(os.path.join(ev_dir, "accept.json"), verdict)
        else:
            verdict = {"tag": tag, "runsIdentical": compare["pass"], "pass": bool(compare["pass"])}   # evidence, not accepted
        if not verdict["pass"]:
            print(f"FAIL: {tag} is not installed: {json.dumps(_finite(verdict))}", flush=True)
            return 1
        snapshot = HF.snapshot_fit(work)
        src = os.path.join(refit_dir, tag)
        installed = {name: HF.copy_verified(os.path.join(src, os.path.basename(name)), os.path.join(work, name))
                     for name in ("fit.json", "fit_state.npz", "npy/E_cap.npy")}
        write_json(os.path.join(ev_dir, f"install{suffix}.json"), {"tag": tag, "snapshot": snapshot, "installed": installed})
        print(f"refit-house install {tag}: {json.dumps(installed)}", flush=True)
        return 0
    if mode == "photo-gate":
        verdict = HF.photo_gate(read_json(os.path.join(ev_dir, "photo-baseline.json")), read_json(os.path.join(work, "cmp", "metrics.json")))
        write_json(os.path.join(ev_dir, "photo-gate.json"), verdict)
        print(f"refit-house photo-gate: {json.dumps(verdict)}", flush=True)
        return 0 if verdict["pass"] else 1
    if mode == "sensitivity":
        runs = {}
        for name in (HF.DEFAULT_TAG,) + tuple(HF.variant_tag(w) for w in HF.CROWN_ENDS):
            report = read_json(os.path.join(refit_dir, name, "report.json"))
            runs[name] = {"wCrown": report["describe"]["lampCounts"]["wCrown"], "dataCost": report["dataCost"],
                          "budget": read_json(os.path.join(refit_dir, name, "fit.json"))["budget"],
                          "photo": read_json(os.path.join(ev_dir, f"photo-{name}.json"))}
        verdict = HF.crown_sensitivity(runs, read_json(os.path.join(ev_dir, f"photo-{HF.DEFAULT_TAG}-repeat.json")))
        write_json(os.path.join(ev_dir, "sensitivity.json"), verdict)
        print(f"refit-house sensitivity: {json.dumps(_finite(verdict))}", flush=True)
        if not verdict["pass"]:
            print(f"STOP: the night photographs clearly prefer w_crown {verdict['preferredEnd']}: report to the controller", flush=True)
        return 0 if verdict["pass"] else 1
    if mode == "promote":
        if args.source is None:
            print("promote needs --from <the staging work folder>", flush=True)
            return 2
        src = os.path.abspath(args.source)
        src_ev = os.path.join(os.path.dirname(src), "evidence", "refit")

        def gate(name):
            path = os.path.join(src_ev, f"{name}.json")
            return read_json(path) if os.path.exists(path) else {"pass": False, "missing": path}

        gates = {name: gate(name) for name in ("accept", "compare", "photo-gate", "sensitivity", "range-balance")}
        failed = [name for name, g in gates.items() if g.get("pass") is not True]
        refusal = None
        if failed:
            refusal = f"gates failed or missing: {', '.join(failed)}"
        elif ((read_json(os.path.join(src, "fit.json")).get("model") or {}).get("name") != "refit"
              or HF.sha256_file(os.path.join(src, "fit.json")) != HF.sha256_file(os.path.join(src, "refit", HF.DEFAULT_TAG, "fit.json"))):
            refusal = "the staging work's fit.json is not the refit at the measured w_crown (a sensitivity run is installed)"
        else:
            geometry = ("bases_n", "bases_iso", "bases_E_win", "bases_E_ch", "bases_E_dome", "bases_E_cove", "emb_idx", "emb_E_back_win")
            moved = [n for n in geometry if HF.sha256_file(os.path.join(src, "npy", f"{n}.npy")) != HF.sha256_file(os.path.join(work, "npy", f"{n}.npy"))]
            if moved:
                refusal = f"the fit-independent tables differ between the two works: {moved}"
        if refusal is not None:
            write_json(os.path.join(cfg.paths["evidence"], "refit.json"),
                       {"staging": src, "pass": False, "refusal": refusal, "gates": gates, "copied": {}})
            print(f"FAIL: nothing promoted: {refusal}", flush=True)
            return 1
        snapshot = HF.snapshot_fit(work)
        names = HF.FIT_FILES + tuple(f"mult/{s}.{e}" for s in HF.SCENARIOS for e in ("f16", "json"))
        copied = {name: HF.copy_verified(os.path.join(src, name), os.path.join(work, name)) for name in names}
        copied["bulb-intensities.json"] = HF.copy_verified(os.path.join(src, "refit", HF.DEFAULT_TAG, "bulb-intensities.json"),
                                                           os.path.join(work, "bulb-intensities.json"))
        refit = read_json(os.path.join(src, "refit", HF.DEFAULT_TAG, "report.json"))
        write_json(os.path.join(cfg.paths["evidence"], "refit.json"),
                   {"staging": src, "pass": True, "gates": gates, "snapshot": snapshot, "copied": copied, "bulbs": refit["bulbs"],
                    "weights": refit["weights"], "colours": refit["colours"], "describe": refit["describe"]})
        print(f"refit-house promote: {len(copied)} files from {src}", flush=True)
        return 0
    print("refit-house needs a mode: proof, refit, compare, install, photo-gate, sensitivity or promote", flush=True)
    return 2


COMMANDS["refit-house"] = cmd_refit_house
```

(`json`, `os`, `time` and `np` are imported at the top of `__main__.py`; `_proof_modules`, `_finite` and `THREADS` are its own: `__main__.py:4-7,50-67,358,371-379`.)

- [ ] **Step 6: The config keys and the moved `shots.py`**

In `tools/relight/config/grand-hall.json`, directly after the line `"horizon": "D:/claude/splat-quality-20260923/weather-daylight/horizon.json",` add:

```json
    "emitters": "D:/claude/real-hall/frontier/splats/evidence/bulbs.json",
    "lampColours": "D:/claude/real-hall/frontier/light/evidence/lamp_colours.json",
```

`config.load` keeps every path and requires only `PATH_KEYS` (`config.py:9,24-36`), so both keys are optional for other configs; `refit-house refit` reads them. (R1d's Task 1 reads the same `paths.emitters`: it checks that the key is present and adds nothing.) Then move `shots.py` byte for byte and run the suite:

```bash
cp D:/claude/real-hall/renovation/relight/scripts/shots.py D:/claude/real-hall/repo/tools/relight/proof/shots.py
cmp D:/claude/real-hall/renovation/relight/scripts/shots.py D:/claude/real-hall/repo/tools/relight/proof/shots.py && echo identical
cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest discover -s tests -v 2>&1 | tail -3
```

Expected: `identical`; `OK` with 136 tests (Task 4's 121 and these 15). `shots.py` reads only `common.ROOT` and an optional system font (`C:/Windows/Fonts/segoeui.ttf`, with a fallback), so Task 2's path rule holds: it names no input.

- [ ] **Step 7: Commit the code**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/housefit.py tools/relight/relight/__main__.py tools/relight/tests/test_housefit.py tools/relight/config/grand-hall.json tools/relight/proof/shots.py
git diff --cached --stat
git commit -m "feat(relight): refit the house lights from the bulb table, one intensity per chandelier candle and a measured weight for the crown tubes (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Stage the refit** (CPU and disk only; about 1.6 GB on D:)

```bash
STAGE=D:/claude/relight/grand-hall-refit
mkdir -p $STAGE/evidence/refit $STAGE/verify $STAGE/harness/app D:/claude/relight/grand-hall/verify/task4b
C:/Python313/python.exe - <<'EOF'
import json, shutil
stage = "D:/claude/relight/grand-hall-refit"
shutil.copytree("D:/claude/relight/grand-hall/work", stage + "/work", ignore=shutil.ignore_patterns("sunfields-4oct", "refit", "fit-proof"))
cfg = json.load(open("D:/claude/real-hall/repo/tools/relight/config/grand-hall.json", encoding="utf-8"))
cfg["paths"].update(work=stage + "/work", evidence=stage + "/evidence", out=stage + "/out-unused")
json.dump(cfg, open(stage + "/config.json", "w", encoding="utf-8"), indent=2)
for name in ("views.json", "order_check.json"):
    shutil.copyfile("D:/claude/real-hall/renovation/relight/work/" + name, stage + "/work/" + name)
views = json.load(open(stage + "/work/views.json", encoding="utf-8"))
mp = [v["name"] for v in views if v["name"].startswith("mp")]
linear = {"tone": "none", "exposure": 1.0, "bloom": 0.0, "threshold": 1.0}
jobs = [{"name": "A_capture", "mult": None, "presentation": linear, "views": mp},
        {"name": "A_comp_house", "mult": "comp_house.f16", "presentation": linear, "views": ["mp43_night_end", "mp45_night_windows"]},
        {"name": "A_mask", "mult": "mask.f16", "presentation": linear, "views": mp}]
json.dump({"views": views, "jobs": jobs}, open(stage + "/work/jobs_photo.json", "w", encoding="utf-8"), indent=1)
print(mp)
EOF
cp D:/claude/real-hall/renovation/relight/harness/run.mjs $STAGE/harness/ && cp -r D:/claude/real-hall/renovation/relight/harness/app/dist $STAGE/harness/app/
sed "s#verify/task4#verify/task4b#" D:/claude/relight/grand-hall/verify/task4/run_cmd.sh > D:/claude/relight/grand-hall/verify/task4b/run_cmd.sh
cp D:/claude/relight/grand-hall/verify/task4/compare.py D:/claude/relight/grand-hall/verify/task4b/
cat > $STAGE/photo_metrics.sh <<'SH'
# photo_metrics <out.json>: render the photo jobs into a fresh $STAGE/renders and measure them with 07_compare.py, then
# copy $STAGE/work/cmp/metrics.json to <out.json>. The previous metrics and <out.json> are deleted first and every
# command must succeed, so a failed render or measurement copies nothing and returns non-zero: it can never hand on an
# earlier run's metrics. It refuses to start while $STAGE/renders exists (07_compare.py reuses a render's 1x PNG).
# HARNESS overrides the render harness (Step 9's guard check points it at a missing file).
photo_metrics() {
  local out="$1" metrics="$STAGE/work/cmp/metrics.json"
  rm -f "$metrics" "$out" &&
  test ! -e "$STAGE/renders" &&
  (cd D:/claude/real-hall/repo/tools/relight/proof &&
   FORCE=1 node "${HARNESS:-$STAGE/harness/run.mjs}" "$STAGE/work/jobs_photo.json" &&
   RELIGHT_CONFIG="$STAGE/config.json" C:/Python313/python.exe 07_compare.py metrics) &&
  test -s "$metrics" &&
  cp "$metrics" "$out"
}
SH
ls D:/claude/splat-quality-20260923/same-data-runtime-bakeoff/native/packages/web/package.json
```

Expected: the staging work holds every table (`npy/`, `geom.npz`, `bases.npz`, `patches.npz`, `probes.npz`, `occ_cookie.npz`, `fit.json`, `fit_state.npz`, `lamp_daylight_ratio.json`, …) and `views.json`, `order_check.json` and `jobs_photo.json`; the printed views are the four `mp*` stations (`mp43_night_end`, `mp45_night_windows`, `mp15_day_end`, `mp8_day_windows`); the harness copy has `run.mjs` and `app/dist/`; the Playwright package the harness requires exists. The harness's root is the folder above `harness/`, so it reads `$STAGE/work/mult/` and `$STAGE/work/order_check.json` and writes `$STAGE/renders/`, which `07_compare.py` reads (`common.ROOT` is the folder above `work`). The proof's folder is never written.

- [ ] **Step 9: The baseline photo check, from the proof fit** (in the staging work, before any refit is installed; the harness holds the GPU lock itself)

```bash
STAGE=D:/claude/relight/grand-hall-refit
cd D:/claude/real-hall/repo/tools/relight/proof
for run in 1 2; do
  RELIGHT_CONFIG=$STAGE/config.json C:/Python313/python.exe 05_relight.py comp_house mask 2>&1 | tail -3
  mkdir -p $STAGE/verify/baseline-mult-run$run && cp $STAGE/work/mult/comp_house.* $STAGE/work/mult/mask.* $STAGE/verify/baseline-mult-run$run/
done
for f in comp_house.f16 comp_house.json mask.f16 mask.json; do cmp $STAGE/verify/baseline-mult-run1/$f $STAGE/verify/baseline-mult-run2/$f && echo "$f identical"; done
. $STAGE/photo_metrics.sh
# The guard: with stale metrics in place and a missing harness, a failed render must copy nothing and leave no metrics.
mkdir -p $STAGE/work/cmp && echo '{"stale": true}' > $STAGE/work/cmp/metrics.json
HARNESS=$STAGE/harness/absent.mjs photo_metrics $STAGE/verify/guard.json; echo "guard run exit $?"
test ! -e $STAGE/verify/guard.json && test ! -e $STAGE/work/cmp/metrics.json && echo "guard holds: a failed render copies nothing"
photo_metrics $STAGE/evidence/refit/photo-baseline.json && mv $STAGE/renders $STAGE/renders-baseline && echo "baseline measured" || echo "STOP: the baseline render or its metrics failed"
```

Expected: four `identical` lines; `guard run exit 1` and `guard holds: a failed render copies nothing` (anything else is a stop: the guard is broken, so a failed render could hand on old metrics); `baseline measured`, never `STOP`; renders for `A_capture`, `A_comp_house` and `A_mask`; `metrics.json` with `A_comp_house` at `mp43_night_end` and `mp45_night_windows` close to the proof's (r 0.881 and 0.820: the work reproduces the proof's fit within Task 2's bar). The baseline renders move aside so the refit's are rendered fresh. Every photo measurement from here on goes through `photo_metrics` (Step 8, amended 8 October after the pre-flight re-review): it deletes the previous `cmp/metrics.json` and its own output first, refuses while an old `renders/` exists (`07_compare.py` reuses a render's 1× PNG), and copies only when the render and the measurement both succeed, so a failed render can never feed an earlier run's metrics to the photo gate or the crown tubes' sensitivity. The guard run above proves it on this PC (tested in scratch on 8 October: a missing harness, a failing `07_compare.py` and a leftover `renders/` each copy nothing and remove the stale metrics).

- [ ] **Step 10: The fits** (CPU; about 2–3 minutes each, one at a time, each in its own process)

The proof model once; the refit at the measured w_crown and the two sensitivity runs at w_crown 0 and 1 (ruling L2), each twice.

```bash
STAGE=D:/claude/relight/grand-hall-refit
cd D:/claude/real-hall/repo/tools/relight
C:/Python313/python.exe -m relight refit-house proof --config $STAGE/config.json 2>&1 | tee $STAGE/verify/refit-proof.log | tail -2
for W in measured 0 1; do
  if [ $W = measured ]; then TAG=refit; OPT=""; else TAG=refit-wcrown-$W; OPT="--w-crown $W"; fi
  C:/Python313/python.exe -m relight refit-house refit $OPT --config $STAGE/config.json 2>&1 | tee $STAGE/verify/$TAG-run1.log | tail -2
  mv $STAGE/work/refit/$TAG $STAGE/work/refit/$TAG-run1
  C:/Python313/python.exe -m relight refit-house refit $OPT --config $STAGE/config.json 2>&1 | tee $STAGE/verify/$TAG-run2.log | tail -2
  C:/Python313/python.exe -m relight refit-house compare --tag $TAG --config $STAGE/config.json
done
```

Expected: the proof run ends `PASS` (its `reproduction.maxRelWeightChange` at most 0.01 over the 8 weights above 1e-6); all six refit runs end `PASS`, writing `refit/refit`, `refit/refit-wcrown-0` and `refit/refit-wcrown-1`; each `compare` prints `identical` (`evidence/refit/compare.json`, `compare-refit-wcrown-0.json`, `compare-refit-wcrown-1.json`). Read the three `report.json` and record in the task report: `bulbs.counts` (26, 22, 47, 23 and 22 on the 8 October table), `bulbs.crowns` (7), `bulbs.crownWeightMeasured` (`wCrown` 0.3871 over 92 pairs in 28 faces), `bulbs.notLamps` (33), the data costs, the ten weights, `ch_centre / ch_end` (1.8370, 1.7204 and 2.0215 with the 8 October table), the three colour offsets against their priors (an offset more than two prior widths from its mean goes to the controller: the data then disagrees with the measured emitter colour), `bulbs.blobBalance` (−0.53 over 30 faces on 8 October), `bulbs.rangeBalance`, and the budget's `ch_centre` share at the floor and the ceiling in each `fit.json`. Each refit run also prints the range-aware balance (ruling L4) and the default writes `evidence/refit/range-balance.json`: on the 8 October table `centre -0.296… log2 against the ends, limit 0.563… (end spreads {"0": 0.2815…, "1": 0.2748…, "3": -0.0417…, "4": 0.2439…}): PASS`. If it ends `STOP`, stop the task here: run Step 13's `promote` line alone (it copies nothing, exits 1 and records the refusal with the numbers in `evidence/refit.json`), write the task report (Step 14) with the numbers, and report to the controller; Steps 11–13 do not run.

- [ ] **Step 11: The crown tubes' sensitivity: the night photographs at each end** (CPU, then the harness, which holds the GPU lock itself; the refit at the measured w_crown is installed last, in Step 12)

Each sensitivity run goes through the photo check exactly as the refit does (Step 12): installed in the staging work (its two runs must be identical; it is evidence, so the acceptance does not apply), its embrasure light and its `comp_house` multipliers twice (`mask.f16` does not depend on the fit: Step 9's stays), rendered and measured. `07_compare.py` reuses a render's 1× PNG when one exists (`render()`, `07_compare.py:30-34`), so every render goes into a fresh `renders/`: the previous one is moved aside first (Step 9 moved the baseline's).

```bash
STAGE=D:/claude/relight/grand-hall-refit
. $STAGE/photo_metrics.sh
cd D:/claude/real-hall/repo/tools/relight
for TAG in refit-wcrown-0 refit-wcrown-1; do
  C:/Python313/python.exe -m relight refit-house install --tag $TAG --config $STAGE/config.json || break
  for run in 1 2; do
    C:/Python313/python.exe -m relight proof embrasure-room --config $STAGE/config.json 2>&1 | tail -1
    C:/Python313/python.exe -m relight proof embrasure-back --config $STAGE/config.json 2>&1 | tail -1
    C:/Python313/python.exe -c "import hashlib; [print(n, hashlib.sha256(open('$STAGE/work/npy/' + n + '.npy', 'rb').read()).hexdigest()) for n in ('bases_n', 'bases_iso', 'bases_E_win', 'bases_E_ch', 'bases_E_dome', 'bases_E_cove', 'E_cap', 'emb_idx', 'emb_E_back_win', 'emb_E_back_cap')]" > $STAGE/evidence/refit/embrasure-$TAG-run$run.txt
    (cd proof && RELIGHT_CONFIG=$STAGE/config.json C:/Python313/python.exe 05_relight.py comp_house 2>&1 | tail -3)
    mkdir -p $STAGE/verify/$TAG-mult-run$run && cp $STAGE/work/mult/comp_house.* $STAGE/verify/$TAG-mult-run$run/
  done
  diff $STAGE/evidence/refit/embrasure-$TAG-run1.txt $STAGE/evidence/refit/embrasure-$TAG-run2.txt && echo "$TAG embrasure identical"
  for f in comp_house.f16 comp_house.json; do cmp $STAGE/verify/$TAG-mult-run1/$f $STAGE/verify/$TAG-mult-run2/$f && echo "$TAG $f identical"; done
  photo_metrics $STAGE/evidence/refit/photo-$TAG.json && mv $STAGE/renders $STAGE/renders-$TAG || { echo "STOP: $TAG's render or metrics failed"; break; }
done
```

Expected: for each run, `install` prints the three installed files (`evidence/refit/install-<tag>.json`; the first install also keeps the staging work's proof fit in `work/fit-proof/`); `<tag> embrasure identical`; both `comp_house` files identical; renders for `A_capture`, `A_comp_house` and `A_mask`; `evidence/refit/photo-refit-wcrown-0.json` and `photo-refit-wcrown-1.json`. An `install` that fails (its two runs differ) stops the loop: settle that run by a third run and a majority (the PC's rule) before going on. A `STOP` line (a failed render or measurement: `photo_metrics` copied nothing, so no earlier metrics stand in) stops the task. These metrics gate nothing on their own: Step 12's `sensitivity` reads them.

- [ ] **Step 12: Install the refit in the staging work, check the photographs and the crown tubes' sensitivity**

```bash
STAGE=D:/claude/relight/grand-hall-refit
. $STAGE/photo_metrics.sh
cd D:/claude/real-hall/repo/tools/relight
C:/Python313/python.exe -m relight refit-house install --config $STAGE/config.json
for run in 1 2; do
  C:/Python313/python.exe -m relight proof embrasure-room --config $STAGE/config.json 2>&1 | tail -1
  C:/Python313/python.exe -m relight proof embrasure-back --config $STAGE/config.json 2>&1 | tail -1
  C:/Python313/python.exe -c "import hashlib; [print(n, hashlib.sha256(open('$STAGE/work/npy/' + n + '.npy', 'rb').read()).hexdigest()) for n in ('bases_n', 'bases_iso', 'bases_E_win', 'bases_E_ch', 'bases_E_dome', 'bases_E_cove', 'E_cap', 'emb_idx', 'emb_E_back_win', 'emb_E_back_cap')]" > $STAGE/evidence/refit/embrasure-run$run.txt
done
diff $STAGE/evidence/refit/embrasure-run1.txt $STAGE/evidence/refit/embrasure-run2.txt && echo "embrasure identical"
cd proof
for run in 1 2; do
  RELIGHT_CONFIG=$STAGE/config.json C:/Python313/python.exe 05_relight.py comp_house mask night sunny_morning overcast_noon 2>&1 | tail -3
  mkdir -p $STAGE/verify/refit-mult-run$run && cp $STAGE/work/mult/*.f16 $STAGE/work/mult/*.json $STAGE/verify/refit-mult-run$run/
done
for f in $(ls $STAGE/verify/refit-mult-run1); do cmp -s $STAGE/verify/refit-mult-run1/$f $STAGE/verify/refit-mult-run2/$f && echo "$f identical" || echo "$f DIFFER"; done
cd ..
photo_metrics $STAGE/evidence/refit/photo-refit.json &&
  C:/Python313/python.exe -m relight refit-house photo-gate --config $STAGE/config.json &&
  mv $STAGE/renders $STAGE/renders-refit &&
  photo_metrics $STAGE/evidence/refit/photo-refit-repeat.json &&
  C:/Python313/python.exe -m relight refit-house sensitivity --config $STAGE/config.json || echo "STOP: the first failure above stops the task"
```

Expected: `install` prints the three installed files; the embrasure tables are identical between the two passes (`embrasure identical`); every multiplier file `identical`; `photo-gate` exits 0 with `"pass": true`. A failing gate is a stop: report both metric sets to the controller (the refit stays in the staging copy; the bake's work is untouched). The refit's multipliers are then rendered a second time (`photo-refit-repeat.json`: the run-to-run noise), and `sensitivity` exits 0 with `"preferredEnd": null`, printing for the refit and both ends the data cost, the `ch_centre` share at the floor and the ceiling and the photo metrics, and each metric's noise (`evidence/refit/sensitivity.json`). An exit 1 is a stop (acceptance 6): the night photographs clearly prefer one end, so the three metric sets and the noise go to the controller, who chooses w_crown; nothing is promoted. A `STOP` line is a stop: a failed render or measurement (nothing copied, no earlier metrics reused), a failing photo gate or a sensitivity that prefers an end; report what the lines above it printed. `03c` takes about 5 minutes and `03d` about 3 per pass (Task 2's logs).

- [ ] **Step 13: Promote, then re-bake the probes and the sky-body bounce** (in the bake's work; one heavy job at a time)

```bash
cd D:/claude/real-hall/repo/tools/relight
C:/Python313/python.exe -m relight refit-house promote --from D:/claude/relight/grand-hall-refit/work --config config/grand-hall.json
cd D:/claude/relight/grand-hall/verify/task4b
./run_cmd.sh probes 8 6 probes-coarse.npz && cp ../../evidence/probes-check.json probes-check-run8.json
./run_cmd.sh probes 9 6 probes-coarse.npz && cp ../../evidence/probes-check.json probes-check-run9.json
C:/Python313/python.exe compare.py probes-coarse-run8.npz probes-coarse-run9.npz
C:/Python313/python.exe compare.py probes-check-run8.json probes-check-run9.json
./run_cmd.sh sun-bounce 15 6 sun-bounce.npz && cp ../../evidence/sun-bounce-check.json sun-bounce-check-run15.json
./run_cmd.sh sun-bounce 16 6 sun-bounce.npz && cp ../../evidence/sun-bounce-check.json sun-bounce-check-run16.json
C:/Python313/python.exe compare.py sun-bounce-run15.npz sun-bounce-run16.npz
C:/Python313/python.exe compare.py sun-bounce-check-run15.json sun-bounce-check-run16.json
```

Expected: `promote` copies the four fit files, the ten multiplier files and `bulb-intensities.json` (the refit's at the measured w_crown) and writes `evidence/refit.json` (every copied file's SHA-256, the snapshot's and the five gates: accept, compare, photo-gate, sensitivity and range-balance); `promote` refuses, copying nothing and exiting 1, if any gate failed or is missing (accept, compare, photo-gate, sensitivity and the range balance), if the staging work's `fit.json` is not the refit at the measured w_crown (`work/refit/refit/fit.json`: a sensitivity run installed last), or if the fit-independent tables (`bases_*`, `emb_idx`, `emb_E_back_win`) differ between the two works; refused, it writes `evidence/refit.json` as `{ pass: false, refusal, gates, copied: {} }`, so the numbers are recorded either way and Task 5 builds nothing from it. Promoted, `evidence/refit.json` has `pass: true` and the five gates. Both `probes` runs pass their linearity gate and compare `differ: []`; both `sun-bounce` runs exit 0 (K chosen by the stable rule on the same selection draws; the check draw and the strict draw both pass), compare `differ: []` and `parsed values equal`. Record K, its rule and the three draws' worst bright directions; if K changes from 30, say so (Task 5, the package and the browser read K from the data, never a constant). A failing `sun-bounce` gate is BLOCKED with the numbers, as Task 4's rules say: the failing arrays stay in `evidence/sun-bounce-FAILED.npz`, the previous artifact stays in place, and the controller decides before Task 4c. On a mismatch between two runs, a third run decides by majority (the PC's rule).

- [ ] **Step 14: Record**

Write the task report (`.superpowers/sdd/2026-09-29-restored-hall-r1a-light-bake/task-4b-report.md`): the lamp counts (candles and crown tubes) and the ratio, the measured w_crown with its pairs and faces, `blobBalance`, the range-aware balance (slope, faces, the corrected balance, the four end spreads, the limit and the verdict), the proof model's reproduction, the data costs and their ratio, the weights before and after (with `ch_centre`), the colour offsets against their priors, the budget shares at the floor and ceiling, the photo metric sets (baseline, refit, repeat, both ends) with the sensitivity verdict and each metric's noise, every double-run comparison, K and the three draws, and the SHA-256 of every promoted artifact (`evidence/refit.json`). The data stays on D: (never committed); the code was committed in Step 7.

### Task 4c: Record classes for skins and toggles, the skins' light, and each artifact's hash in its evidence

(Added 7 October: R1c's amendments A1 (Python part) and A4 to the committed bake code, `docs/superpowers/plans/2026-10-03-r1c-amendments-to-r1a-r1b.md`, applied as written except the two corrections noted in Steps 1 and 4, and the Task 4 review's deferred items. It runs after Task 4b and before Task 5; R1c's Task 0 greps for its names.)

**Files:**
- Modify: `tools/relight/relight/codec.py` (R1c A1), `tools/relight/relight/__main__.py` (R1c A4's options and `skin-light` command; `_artifact`, `_write_evidence`; each data command records its artifact; `record-artifacts`)
- Create: `tools/relight/relight/skinlight.py` (R1c A4), `tools/relight/tests/test_codec_skins.py` (R1c A1), `tools/relight/tests/test_skinlight.py` (R1c A4), `tools/relight/tests/test_artifacts.py`

**Interfaces:**
- Consumes: Task 1's codec, Task 4 as built (`floorlight.patch_direct`, `probes.patch_direct_by_source`, `windows.sun_reach`, `windows_volumes`, `_proof_modules`, `SOURCES`, `_finite`, `_save_npz_if`), Task 4b (`refit-house`).
- Produces: `codec.CLASS_SKIN = 7`, `SKIN_GROUP_SHIFT = 5`, `SKIN_GROUP_MAX = 6`, `TOGGLE_SHIFT = 6`, `TOGGLE_NONE, TOGGLE_CLUTTER, TOGGLE_CABINET = 0, 1, 2`, `cover_flags(flags, group)`, `toggle_flags(flags, toggle)`, `skin_group_of(flags)`, `toggle_of(flags)`; `skinlight.VISIBILITY`, `skin_light_grids(path)`, `grid_points(M, size)`, `pack_skin_records(D, normals, ranges)`, `skins_section(skin_light_dir, skin_package_dir, groups) -> (section, files)`; the CLI options `--skins`, `--skin-light`, `--skin-package`, `--out`, `--package` and the command `skin-light`; `__main__._artifact(path) -> {path, sha256, bytes}` and `_write_evidence(path, data)`; every data command's evidence carries `artifact` (`windows.json`, `probes-check.json`, `sun-bounce-check.json`, `floor-light.json`, `skin-light.json`), written after the artifact; the command `record-artifacts`.

**Why the hashes.** Task 4's review deferred three items: an evidence JSON could be written before its artifact (a raising write left `pass: true` beside the old artifact), `sun-check.json` was written without `_finite`, and nothing linked an evidence file to the artifact it describes. Task 5 packages only exact named files whose SHA-256 equals the one their evidence records (the owner's packaging rule, 7 October: never a glob such as `work/sun-bounce*`).

- [ ] **Step 1: The record classes (R1c A1)** — in `tools/relight/relight/codec.py`, directly after `FLAG_CH_CENTRE = 1 << 5` add:

```python

# Skins (R1c, amendment A1): a splat a skin covers is class 7, its wall group in bits 5-7 (0 door wall, 1 window wall,
# 2 end_xmin, 3 end_xmax, 4 ceiling; 7 reserved, so no record's flags byte is R1b's pass-through 0xff), lit exactly as
# class 0 and hidden while its group's skins draw. Any other class may carry a toggle in bits 6-7 (bit 5 stays the
# chandelier group): 1 the loose clutter, 2 the AV cabinet; a toggled splat is hidden while its toggle is.
CLASS_SKIN = 7
SKIN_GROUP_SHIFT = 5
SKIN_GROUP_MAX = 6
TOGGLE_SHIFT = 6
TOGGLE_NONE, TOGGLE_CLUTTER, TOGGLE_CABINET = 0, 1, 2
```

and directly after the function `unpack_records` add:

```python


def cover_flags(flags, group):
    """Class 7 in wall group `group` for the interior splats (class 0) among `flags`, ISO and SUN kept; others unchanged."""
    f = np.asarray(flags, dtype=np.uint8)
    g = np.broadcast_to(np.asarray(group, dtype=np.int64), f.shape)
    if (g < 0).any() or (g > SKIN_GROUP_MAX).any():
        raise ValueError("a wall group is 0..6")
    covered = (f & CLASS_MASK) == CLASS_INTERIOR
    out = (f & (FLAG_ISO | FLAG_SUN)) | CLASS_SKIN | (g.astype(np.uint8) << SKIN_GROUP_SHIFT)
    return np.where(covered, out, f).astype(np.uint8)


def toggle_flags(flags, toggle):
    """The toggle in bits 6-7 of every splat that is not class 7 (whose bits 5-7 hold its wall group)."""
    f = np.asarray(flags, dtype=np.uint8)
    t = np.broadcast_to(np.asarray(toggle, dtype=np.int64), f.shape)
    if (t < 0).any() or (t > 3).any():
        raise ValueError("a toggle is 0..3")
    skin = (f & CLASS_MASK) == CLASS_SKIN
    return np.where(skin, f, (f & 0b0011_1111) | (t.astype(np.uint8) << TOGGLE_SHIFT)).astype(np.uint8)


def skin_group_of(flags):
    f = np.asarray(flags, dtype=np.uint8)
    return np.where((f & CLASS_MASK) == CLASS_SKIN, (f >> SKIN_GROUP_SHIFT).astype(np.int64), -1)


def toggle_of(flags):
    f = np.asarray(flags, dtype=np.uint8)
    return np.where((f & CLASS_MASK) == CLASS_SKIN, 0, f >> TOGGLE_SHIFT).astype(np.int64)
```

(One correction to A1 as written, found by running its own test on this PC's numpy 2.4.2: A1's `skin_group_of` returned `np.where(cond, f >> SKIN_GROUP_SHIFT, -1).astype(np.int64)`; under NumPy 2's promotion rules (NEP 50) the Python `-1` takes the uint8 operand's type, so every other class read 255, not −1, and A1's test failed. The shift is widened to int64 before `np.where`. Checked: with the correction, A1's tests, A3's and Task 5's reference tests pass, 20 tests.)

Create `tools/relight/tests/test_codec_skins.py`:

```python
import unittest
import numpy as np
from relight import codec


class Skins(unittest.TestCase):
    def test_cover_flags_make_interior_splats_class_7_in_their_group(self):
        f = np.array([0, codec.FLAG_ISO | codec.FLAG_SUN, codec.CLASS_EMBRASURE, codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE], np.uint8)
        out = codec.cover_flags(f, np.array([4, 6, 1, 2]))
        self.assertEqual(int(out[0]), 7 | (4 << 5))
        self.assertEqual(int(out[1]), 7 | codec.FLAG_ISO | codec.FLAG_SUN | (6 << 5))
        self.assertEqual(out[2:].tolist(), f[2:].tolist())
        self.assertEqual(codec.skin_group_of(out).tolist(), [4, 6, -1, -1])
        self.assertLess(int(out.max()), 0xff)
        with self.assertRaises(ValueError):
            codec.cover_flags(f, 7)

    def test_toggles_keep_class_and_flags_and_skip_covered_splats(self):
        f = np.array([0, codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE, 7 | (2 << 5)], np.uint8)
        out = codec.toggle_flags(f, 2)
        self.assertEqual(int(out[0]), 2 << 6)
        self.assertEqual(int(out[1]) & 0b0011_1111, int(f[1]))
        self.assertEqual(int(out[2]), int(f[2]))
        self.assertEqual(codec.toggle_of(out).tolist(), [2, 2, 0])


if __name__ == "__main__":
    unittest.main()
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_codec tests.test_codec_skins -v`
Expected: PASS, 12 tests (the codec's 10 and these 2).

- [ ] **Step 2: The skins' light (R1c A4)** — create `tools/relight/relight/skinlight.py`:

```python
"""The skins' light (R1c, amendment A4): R1a's floor light model at every light texel of every skin (its `lightTexel`:
5 cm, 2 cm on the frieze; the nine sources' direct light, white and unit, the windows with the capture's sky weights, at
the texel's centre 2 cm in front of its bay plane with the height field's normal), packed as R1a records with the skins'
own ranges; each skin's share of sun-reachable texels on its 2 cm sun grid; and relight package v2's skins section built
from them."""
from __future__ import annotations

import gzip, hashlib, json, os, posixpath

import numpy as np

from . import codec

VISIBILITY = {"toggles": {"clutter": 1, "cabinet": 2}, "defaultHidden": 1}   # the loose clutter hidden, the cabinet shown


def skin_light_grids(path):
    """tools/skins' light-grids.json (R1c Task 5), each skin with its light texels' normals loaded."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    root = os.path.dirname(path)
    out = []
    for e in data["skins"]:
        w, h = (int(v) for v in e["size"])
        normals = np.load(os.path.join(root, e["normals"])).astype(np.float64)
        if normals.shape != (h, w, 3):
            raise ValueError(f"{e['id']}: normals {normals.shape}, expected {(h, w, 3)}")
        sun = e.get("sun")
        out.append({"id": e["id"], "group": int(e["group"]), "lightTexel": float(e["lightTexel"]), "size": (w, h),
                    "texelToModel": np.asarray(e["texelToModel"], np.float64).reshape(4, 4), "normals": normals,
                    "sun": None if sun is None else {"size": tuple(int(v) for v in sun["size"]),
                                                    "texelToModel": np.asarray(sun["texelToModel"], np.float64).reshape(4, 4)}})
    return out


def grid_points(M, size):
    """Every texel's centre, M @ (column, row, 0, 1), row-major."""
    w, h = size
    rows, cols = np.meshgrid(np.arange(h, dtype=np.float64), np.arange(w, dtype=np.float64), indexing="ij")
    return (M[:3, 0] * cols[..., None] + M[:3, 1] * rows[..., None] + M[:3, 3]).reshape(-1, 3)


def pack_skin_records(D, normals, ranges):
    return codec.pack_records(D, normals, np.full(len(D), codec.CLASS_INTERIOR, np.uint8), ranges)


def skins_section(skin_light_dir, skin_package_dir, groups):
    """Relight package v2's `skins` section and its files ({relative path: gzip bytes}) from the skin-light output and the
    skin package (whose manifest it pins by SHA-256)."""
    with open(os.path.join(skin_light_dir, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    with open(os.path.join(skin_package_dir, "manifest.json"), "rb") as f:
        manifest_bytes = f.read()
    package = posixpath.join(*os.path.normpath(skin_package_dir).replace("\\", "/").split("/")[-2:])
    if not package.startswith("skins/"):
        raise ValueError(f"{skin_package_dir} is not a skins/<version> folder")
    entries, files = [], {}
    for s in index["skins"]:
        with open(os.path.join(skin_light_dir, f"{s['id']}.records"), "rb") as f:
            data = f.read()
        w, h = s["size"]
        if len(data) != w * h * codec.RECORD_BYTES:
            raise ValueError(f"{s['id']}: {len(data)} bytes for {w} x {h} light texels")
        gz = gzip.compress(data, compresslevel=9, mtime=0)
        rel = posixpath.join("skins", f"{s['id']}.light.gz")
        files[rel] = gz
        M = np.asarray(s["texelToModel"], np.float64).reshape(4, 4)
        n = np.cross(M[:3, 1], M[:3, 0])
        n = n / np.linalg.norm(n)
        entries.append({"id": s["id"], "group": int(s["group"]), "size": [int(w), int(h)], "texelToModel": [float(x) for x in M.ravel()],
                        "normal": [float(x) for x in n], "file": rel, "sha256": hashlib.sha256(gz).hexdigest(), "bytes": len(gz),
                        "sun": s["sun"]})
    section = {"package": package, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
               "encoding": [[float(lo), float(hi)] for lo, hi in index["ranges"]], "groups": list(groups), "entries": entries}
    return section, files
```

(A light texel's normal in the section is the bay's: the light grid's column and row directions are `u` and `v` with `u × v = −n`, so `n = v × u`.)

Create `tools/relight/tests/test_skinlight.py`:

```python
import gzip, hashlib, json, os, tempfile, unittest
import numpy as np
from relight import codec, skinlight as SL

M = [0.05, 0, 0, 0.025, 0, 0, -1, 0.98, 0, -0.05, 0, 1.975, 0, 0, 0, 1]   # u +x, v -z: the bay faces -y


def write_grids(root):
    os.makedirs(os.path.join(root, "door-w2"))
    np.save(os.path.join(root, "door-w2", "light-normals.npy"), np.tile([0.0, -1.0, 0.0], (2, 3, 1)))
    with open(os.path.join(root, "light-grids.json"), "w", encoding="utf-8") as f:
        json.dump({"skins": [{"id": "door-w2", "group": 0, "lightTexel": 0.05, "size": [3, 2], "texelToModel": M,
                              "normals": "door-w2/light-normals.npy", "sun": None}]}, f)
    return os.path.join(root, "light-grids.json")


class SkinLight(unittest.TestCase):
    def test_grids_load_with_their_normals_and_points(self):
        grids = SL.skin_light_grids(write_grids(tempfile.mkdtemp()))
        self.assertEqual((grids[0]["id"], grids[0]["size"]), ("door-w2", (3, 2)))
        P = SL.grid_points(grids[0]["texelToModel"], grids[0]["size"])
        np.testing.assert_allclose(P[4], [0.025 + 0.05, 0.98, 1.975 - 0.05], atol=1e-12)        # column 1, row 1

    def test_records_round_trip_and_the_section_pins_both_packages(self):
        root = tempfile.mkdtemp()
        light = os.path.join(root, "skin-light"); os.makedirs(light)
        D = np.zeros((6, 9)); D[:, 0] = 0.5; D[:, 5] = 0.25
        ranges = [codec.source_range(D[:, k]) for k in range(9)]
        with open(os.path.join(light, "door-w2.records"), "wb") as f:
            f.write(SL.pack_skin_records(D, np.tile([0.0, -1.0, 0.0], (6, 1)), ranges))
        with open(os.path.join(light, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"ranges": [list(r) for r in ranges], "skins": [{"id": "door-w2", "group": 0, "lightTexel": 0.05, "size": [3, 2],
                                                                       "texelToModel": M, "reachShare": 0.0, "sun": None}]}, f)
        pkg = os.path.join(root, "grand-hall", "skins", "v1"); os.makedirs(pkg)
        with open(os.path.join(pkg, "manifest.json"), "wb") as f:
            f.write(b'{"schema": "venviewer.skins.v1"}')
        section, files = SL.skins_section(light, pkg, ["door", "window", "end_xmin", "end_xmax", "ceiling"])
        self.assertEqual(section["package"], "skins/v1")
        self.assertEqual(section["manifestSha256"], hashlib.sha256(b'{"schema": "venviewer.skins.v1"}').hexdigest())
        entry = section["entries"][0]
        np.testing.assert_allclose(entry["normal"], [0.0, -1.0, 0.0], atol=1e-12)
        direct, _n, flags = codec.unpack_records(gzip.decompress(files[entry["file"]]), ranges)
        np.testing.assert_allclose(direct[:, 0], 0.5, rtol=0.04)
        self.assertEqual(flags.tolist(), [codec.CLASS_INTERIOR] * 6)


if __name__ == "__main__":
    unittest.main()
```

The matrix has u = +x and v = −z, so `n = v × u = (0, 0, −1) × (1, 0, 0) = (0, −1, 0)`.

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_skinlight -v`
Expected: PASS, 2 tests.

- [ ] **Step 3: Each artifact's hash in its evidence** — in `tools/relight/relight/__main__.py`, directly before `def split_tables(cfg: config.Config) -> None:` add:

```python
def _artifact(path: str) -> dict:
    """An artifact's record for its evidence JSON (Task 4c): its exact path, SHA-256 and size. Task 5 packages a work
    artifact only when its bytes still have the SHA-256 its evidence records."""
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return {"path": os.path.abspath(path).replace("\\", "/"), "sha256": h.hexdigest(), "bytes": os.path.getsize(path)}


def _write_evidence(path: str, data: dict) -> None:
    """An evidence JSON, written after the artifact it describes and through a partial file renamed over the target, with
    non-finite numbers as null (so a failure never leaves a half-written or stale 'pass')."""
    part = path + ".part"
    with open(part, "w", encoding="utf-8") as f:
        json.dump(_finite(data), f, indent=1, allow_nan=False)
    os.replace(part, path)


```

Then make each data command record its artifact after writing it:

1. `cmd_windows` (`__main__.py:223`): directly after `    np.savez_compressed(os.path.join(cfg.paths["work"], "windows.npz"), **save)` add
   ```python
    _write_evidence(os.path.join(cfg.paths["evidence"], "windows.json"),
                    {"windows": list(cfg.room["windows"]), "artifact": _artifact(os.path.join(cfg.paths["work"], "windows.npz"))})
   ```
2. `cmd_check_sun` (`:349-350`): replace the two lines `    with open(os.path.join(cfg.paths["evidence"], "sun-check.json"), "w") as f:` and `        json.dump(out, f, indent=1)` with `    _write_evidence(os.path.join(cfg.paths["evidence"], "sun-check.json"), out)` (the deferred `_finite`; `check-sun` writes no artifact).
3. `cmd_probes` (`:429-432`): delete the two lines `    with open(os.path.join(cfg.paths["evidence"], "probes-check.json"), "w", encoding="utf-8") as f:` and `        json.dump(_finite(out), f, indent=1, allow_nan=False)`, and directly after the statement `kept = _save_npz_if(os.path.join(work, "probes-coarse.npz"), …, spacing=np.float64(spacing))` add
   ```python
    out["artifact"] = _artifact(kept) if out["pass"] else None   # the evidence follows its artifact (Task 4c)
    _write_evidence(os.path.join(cfg.paths["evidence"], "probes-check.json"), out)
   ```
4. `cmd_sun_bounce` (`:679-686`): delete the two lines `    with open(os.path.join(cfg.paths["evidence"], "sun-bounce-check.json"), "w", encoding="utf-8") as f:` and `        json.dump(_finite(out), f, indent=1, allow_nan=False)`, and directly after the line `                        patchArea=room.areas)` (the end of `kept = _save_npz_if(os.path.join(work, "sun-bounce.npz"), …)`) add
   ```python
    out["artifact"] = _artifact(kept) if ok else None            # the evidence follows its artifact (Task 4c)
    _write_evidence(os.path.join(cfg.paths["evidence"], "sun-bounce-check.json"), out)
   ```
5. `cmd_floor` (`:763`): directly after `    kept = _save_npz_if(os.path.join(work, "floor-light.npz"), lit_ok, cfg.paths["evidence"], D=D, texelToModel=texel_to_model)` add
   ```python
    _write_evidence(os.path.join(cfg.paths["evidence"], "floor-light.json"),
                    {"shares": share, "w3Share": share["W3"], "threshold": FLOOR_W3_SHARE, "pass": lit_ok,
                     "artifact": _artifact(kept) if lit_ok else None})
   ```

(A failing run still writes its evidence, with `artifact: null`; its arrays are the `<evidence>/<stem>-FAILED.npz` that `_save_npz_if` kept, never the artifact.) Then add, directly above `if __name__ == "__main__":`:

```python
ARTIFACTS = (("windows.npz", "windows.json"), ("probes-coarse.npz", "probes-check.json"),
             ("sun-bounce.npz", "sun-bounce-check.json"), ("floor-light.npz", "floor-light.json"))


def cmd_record_artifacts(cfg, args) -> int:
    """Each work artifact written before the commands recorded it themselves (Task 4c), added to its evidence JSON with
    its exact path, SHA-256 and size. Refuses an evidence file that records a failing run or another hash."""
    for name, evidence in ARTIFACTS:
        path, ev = os.path.join(cfg.paths["work"], name), os.path.join(cfg.paths["evidence"], evidence)
        data = {}
        if os.path.exists(ev):
            with open(ev, encoding="utf-8") as f:
                data = json.load(f)
        if data.get("pass") is False:
            print(f"FAIL: {evidence} records a failing run; {name} is not recorded", flush=True)
            return 1
        record = _artifact(path)
        old = data.get("artifact")
        if old and old.get("sha256") != record["sha256"]:
            print(f"FAIL: {evidence} records {old['sha256']} but {name} is {record['sha256']}", flush=True)
            return 1
        data["artifact"] = record
        _write_evidence(ev, data)
        print(f"{name}: {record['sha256']} -> {evidence}", flush=True)
    return 0


COMMANDS["record-artifacts"] = cmd_record_artifacts
```

Create `tools/relight/tests/test_artifacts.py`:

```python
import hashlib, json, os, tempfile, unittest
from relight import __main__ as M


class Artifacts(unittest.TestCase):
    def test_an_artifact_is_recorded_by_its_exact_path_hash_and_size(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.npz")
            with open(path, "wb") as f:
                f.write(b"abc")
            record = M._artifact(path)
            self.assertEqual(record["sha256"], hashlib.sha256(b"abc").hexdigest())
            self.assertEqual(record["bytes"], 3)
            self.assertTrue(record["path"].endswith("/a.npz") and "\\" not in record["path"])

    def test_evidence_is_written_whole_with_non_finite_numbers_as_null(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "e.json")
            M._write_evidence(path, {"x": float("inf"), "artifact": None})
            with open(path, encoding="utf-8") as f:
                self.assertEqual(json.load(f), {"x": None, "artifact": None})
            self.assertFalse(os.path.exists(path + ".part"))


if __name__ == "__main__":
    unittest.main()
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_artifacts tests.test_config -v`
Expected: PASS: these 2 and `test_config`'s tests (its gate-before-write tests still hold: `_save_npz_if` still writes the artifact).

- [ ] **Step 4: The skins' light command (R1c A4)** — in `tools/relight/relight/__main__.py`, directly after `    ap.add_argument("--config", required=True)` add:

```python
    ap.add_argument("--skins", default=None)          # R1c: skin-light takes light-grids.json; records takes the geometry folder
    ap.add_argument("--skin-light", default=None)     # R1c: records' <work>/skin-light, for package v2's skins section
    ap.add_argument("--skin-package", default=None)   # R1c: the skin package folder package v2 names
    ap.add_argument("--out", default=None)            # R1c: the package's folder (default the config's out)
    ap.add_argument("--package", default=None)        # R1c: the package check reads (default the config's out)
```

and directly after `COMMANDS["floor"] = cmd_floor` add:

```python


def cmd_skin_light(cfg, args) -> int:
    """<work>/skin-light/<id>.records and index.json (R1c, amendment A4): every skin light texel's nine sources' direct
    light, cmd_floor's model at the skins' texel centres and normals (tools/skins' light-grids.json), as R1a records with
    the skins' own ranges; each skin's sun-reachable share on its 2 cm sun grid (windows.sun_reach), its sun grid named
    only when some texel is reachable. CPU only."""
    import importlib
    from . import codec, floorlight as FL, probes as PR, skinlight as SL
    from . import windows as W
    if args.skins is None:
        print("skin-light needs --skins <tools/skins work>/geometry/light-grids.json", flush=True)
        return 2
    common, lt, _radiosity, fit04 = _proof_modules()
    b3 = importlib.import_module("03_bases")
    started, work = time.time(), cfg.paths["work"]
    with np.load(os.path.join(work, "probes.npz")) as z:
        volume = {"cubes": z["win_cubes"], "origin": tuple(float(v) for v in z["origin"]),
                  "shape": tuple(int(v) for v in z["shape"]), "keep": z["keep"]}
    with np.load(os.path.join(work, "geom.npz")) as z:
        house = {"chandeliers": z["chandeliers"], "dome_c": z["dome_c"]}
    with np.load(os.path.join(work, "bases.npz")) as z:
        house["ring"] = z["ring"]
    box = (common.X0, common.X1, common.Y0, common.Y1, common.FLOOR_Z)
    grids = SL.skin_light_grids(args.skins)
    lights = []
    for g in grids:
        q, n = SL.grid_points(g["texelToModel"], g["size"]), g["normals"].reshape(-1, 3)
        direct = FL.patch_direct(lt, b3.trilinear_weights, volume, house, box, q, n)
        D = PR.patch_direct_by_source(direct, np.array(fit04.SKY_W))
        if not np.isfinite(D).all() or (D < 0).any():
            print(f"FAIL: {g['id']}: the direct light is not finite and non-negative", flush=True)
            return 1
        lights.append(D)
    ranges = [codec.source_range(np.concatenate([D[:, k] for D in lights])) for k in range(len(SOURCES))]
    vols, _horizons, _fresnel = windows_volumes(cfg)
    out = os.path.join(work, "skin-light")
    os.makedirs(out, exist_ok=True)
    index = {"ranges": [list(r) for r in ranges], "skins": []}
    for g, D in zip(grids, lights):
        with open(os.path.join(out, f"{g['id']}.records"), "wb") as f:
            f.write(SL.pack_skin_records(D, g["normals"].reshape(-1, 3), ranges))
        reach, sun = 0.0, None
        if g["sun"] is not None:
            P = SL.grid_points(g["sun"]["texelToModel"], g["sun"]["size"])
            reach = float(np.mean(W.sun_reach(vols, P, cfg.room["site"]["latitude"])))
            if reach > 0:
                sun = {"size": list(g["sun"]["size"]), "texelToModel": [float(x) for x in g["sun"]["texelToModel"].ravel()]}
        index["skins"].append({"id": g["id"], "group": g["group"], "lightTexel": g["lightTexel"], "size": list(g["size"]),
                               "texelToModel": [float(x) for x in g["texelToModel"].ravel()], "reachShare": reach, "sun": sun})
        print(f"skin-light {g['id']}: {g['size'][0]} x {g['size'][1]} texels, sun reach {reach:.3f}", flush=True)
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, allow_nan=False)
    _write_evidence(os.path.join(cfg.paths["evidence"], "skin-light.json"),
                    {"skins": len(grids), "texels": int(sum(len(D) for D in lights)), "ranges": index["ranges"],
                     "seconds": round(time.time() - started, 1), "artifact": _artifact(os.path.join(out, "index.json")),
                     "records": {g["id"]: _artifact(os.path.join(out, f"{g['id']}.records"))["sha256"] for g in grids}})
    return 0


COMMANDS["skin-light"] = cmd_skin_light
```

(Two changes to A4 as written, both checked against the committed code: `windows_volumes(cfg)` returns `(volumes, horizons, fresnel)` (`__main__.py:190-197`) and `windows.sun_reach` iterates `volumes.values()` (`windows.py:405-416`), so A4's `W.sun_reach(windows_volumes(cfg), …)` would raise on the tuple; the volumes dict is unpacked first. And the evidence is written with `_write_evidence` and records the index's and each record file's hash, Step 3's rule. The `skin-light` output is a data product: R1c Task 8 runs it twice by hand and compares the two folders, as the double-run rule requires.)

- [ ] **Step 5: Run the suite, record the earlier artifacts, commit**

```bash
cd D:/claude/real-hall/repo/tools/relight
C:/Python313/python.exe -m unittest discover -s tests -v 2>&1 | tail -3
C:/Python313/python.exe D:/claude/relight/grand-hall/verify/task4b/compare.py D:/claude/relight/grand-hall/work/probes-coarse.npz D:/claude/relight/grand-hall/verify/task4b/probes-coarse-run9.npz
C:/Python313/python.exe D:/claude/relight/grand-hall/verify/task4b/compare.py D:/claude/relight/grand-hall/work/sun-bounce.npz D:/claude/relight/grand-hall/verify/task4b/sun-bounce-run16.npz
C:/Python313/python.exe -m relight record-artifacts --config config/grand-hall.json
cd D:/claude/real-hall/repo
git add tools/relight/relight/codec.py tools/relight/relight/skinlight.py tools/relight/relight/__main__.py tools/relight/tests/test_codec_skins.py tools/relight/tests/test_skinlight.py tools/relight/tests/test_artifacts.py
git diff --cached --stat
git commit -m "feat(relight): record classes for skins and toggles, the skins' light, and each artifact's hash in its evidence (T-639 R1c amendments A1, A4; R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `OK`, 142 tests (Task 4b's 136 and these 6); both comparisons `differ: []` (the work's artifacts are Task 4b's verified runs, so the hashes recorded are theirs); `record-artifacts` prints four lines (`windows.npz`, `probes-coarse.npz`, `sun-bounce.npz`, `floor-light.npz`, each with its SHA-256) and exits 0.

### Task 5: Records for every served tile, the reference multiplier and the checks

(Revised 7 October, consolidated: the sky bodies' bounce is Task 4's factored basis, not the sunlit-area table; the Moon is a second sky body; the house lights are Task 4b's refit with a colour per lamp group; R1c's covers, toggles and package v2; R1d's lamp tints and `moon_test` vectors; only exact, hash-checked artifacts are packaged. The plan's "Revisions (7 October, consolidated)" lists each change.)

**Files:**
- Create: `tools/relight/relight/records.py`, `tools/relight/relight/reference.py`, `tools/relight/relight/package.py`, `tools/relight/tests/test_reference.py`, `tools/relight/tests/test_records.py`
- Create: `packages/web/src/lib/relight/__fixtures__/relight-vectors.json`
- Modify: `tools/relight/relight/__main__.py` (register `records`, `check`), `tools/relight/relight/windows.py` (the public `wall_face_rate` and `sample_depths`, and the helper `_alpha_at`, Step 7), `tools/relight/tests/test_windows.py` (two tests, Step 7)

**Interfaces:**
- Consumes: the Task 2 tables; Task 3 as built (`__main__.windows_volumes(cfg)`, `windows.sun_visibility`, `sun_reach`, `sun_az_el`, `sun_corners`, `horizon_at`, `fresnel_at`, `volume_arrays`, `volume_from_arrays`, `ray_survives`, `MIN_DOWN`, `CHUNK`; `__main__.CHECK_SUNS`, `SPLAT_SEED`, `_random_suns`); Task 4 as built (`<work>/probes-coarse.npz`, `<work>/sun-bounce.npz` and `sunbounce.Table`, `Patches`, `window_power`, `coefficients`, `bounce`, `trilinear_matrix`, `sun_bounce`; `<work>/floor-light.npz`; `moon.py`; `__main__._random_moons`); Task 4b (`<work>/fit.json` and `fit_state.npz`, the refit, model name `refit`; `<work>/mult/{night,sunny_morning,overcast_noon}.f16`; `<evidence>/refit.json`); Task 4c (`codec.CLASS_SKIN` and the toggle bits, `skinlight`, `__main__._artifact`, `_write_evidence`, the `artifact` record of every evidence JSON); `<evidence>/sun-check.json`; the repo's SOG decoder `tools/xgrids-lcc2/scripts/sog-floor-census.py` (`decode_tile(path) -> (centers, scales, quats, opacity, meta)`); R1c's skins geometry (`covers.npz`, `toggles.json`, R1c Task 5) and skin package, only with `--skins`, `--skin-light`, `--skin-package`.
- Produces: `windows.wall_face_rate(volumes, horizon_tables, fresnel_table, P, s) -> {"marched": int, "wallFace": int}` (public, `from relight import windows`; the measurement R1b's rounding excuses are capped by, which R1c Task 15 imports for its skins) and `windows.sample_depths(vol) -> (256,) float32` (the march's per-byte sample depths, public for the vectors' `sampleDepths`); `windows._sample_depth` stays private to `windows.py`; `records.flags_for(...) -> (N,) uint8`; `records.transfer(src_pos, src_values, dst_pos, k) -> values`; `records.cover_test`, `in_boxes`, `apply_covers`, `apply_toggles`, `load_skin_inputs` (R1c A3); `reference.SkyBounce`, `reference.Model` (with `volumes`, `horizons`, `fresnel`, `sky`), `reference.Setting` (with `captured`, `with_sky`, `with_lamps`, `with_emitter_boost`; `lamp_tints`, `moon_dir`, `moon_rgb`), `reference.Visibility`, `NO_VISIBILITY`, `reference.sky_bodies(setting)`, `window_powers(model, s) -> (5,)`, `body_coefficients(model, s) -> (K,)`, `probe_points(model)`, `to_probes(model, values)`, `sky_cubes(model, bodies) -> (M, 3, 6)`, `fresnel_at(model, s)`, `multiplier(direct, normals, flags, pos, colour_lin, model, setting, visibility=NO_VISIBILITY) -> (rgb (N,3), alpha (N,))`; `package.verified(work, evidence, name, evidence_name)` and `package.write(...)`; the package in `<out>` (relight v1; with R1c's options relight v2 in `--out`); `<evidence>/checks.json` (`checks-<folder>.json` for a package named by `--package`), with the wall-face rates `wallFaceRate` (the splats' and the floor's) and the commit it was checked with, `checkedWith`; the R1b fixture (only from the default package, or with `--vectors`).

**The sky bodies.** The Sun and the Moon are both directional sky bodies (the owner's direction of 3 October; R1d amendments A4, A5). Each body's direct light is the window volume march of `windows.sun_visibility`, gated per window by its horizon, with the glass; its bounce is Task 4's factored basis: per window w the exact power `P_w` of the 56,448 patch rays (`sunbounce.window_power`), the coefficients `c(σ) = sunbounce.coefficients(table, P(σ), az, el)` at the body's float32 direction, the K basis volumes summed on the 1 m grid with the body's RGB, `S1 = Σ_body RGB ⊙ Σ_k c_k basis_k`, and `S1` read at each 0.5 m probe trilinearly (`sunbounce.trilinear_matrix`: the 1 m cell clamped into the grid, the position into the cell, invalid corners dropped and the rest renormalised). That 0.5 m sky volume joins the nine sources' bounce exactly as `I[k]` does: the browser folds it into the scenario probe volume (R1b Task 10), so every splat, the floor and R1c's skins receive it with no code of their own. On the 1 m nodes the resampling is exact; between them it is the same trilinear function the 1 m grid defines, except near invalid corners (check 5 measures the difference). β, the area-scaled bounce `Σw b[w] sunRGB ⊙ I[w]` and the sunlit-area table are gone (Task 4 as built).

- [ ] **Step 1: Write the failing tests for the reference multiplier**

`tools/relight/tests/test_reference.py`:

```python
import unittest
from dataclasses import replace
import numpy as np
from relight import codec, reference, sunbounce, windows


def model(n_probes_axis=2, spacing=1.0):
    shape = (n_probes_axis,) * 3
    M = int(np.prod(shape))
    cubes = np.zeros((M, 9, 3, 6), np.float32)
    cubes[:, 5] = 0.1                                       # the cove bounces a little everywhere
    return reference.Model(
        capture_w=np.array([1.0, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]),
        capture_c=np.tile([1.0, 1.0, 1.0], (9, 1)),
        daylight_colour=np.array([1.0, 1.0, 1.0]),
        probes=cubes, probe_valid=np.ones(M, bool), probe_origin=np.zeros(3), probe_spacing=spacing, probe_shape=shape,
        volumes={}, fresnel=np.ones(101, np.float32))


def splats(n=4):
    direct = np.zeros((n, 9)); direct[:, 0] = 1.0; direct[:, 5] = 0.5
    normals = np.tile([0.0, 0.0, 1.0], (n, 1))
    flags = np.zeros(n, np.uint8)
    pos = np.full((n, 3), 0.5)
    colour = np.full((n, 3), 0.4)
    return direct, normals, flags, pos, colour


def window_volume():
    """An empty, open window W1: x 0.3..2.7, z 0.3..2.7 at the wall face y0 = 0, its glass 0.5 m out, bearing 14.3."""
    return windows.volumes_from_occupancy(np.zeros((100, 34, 100), np.float32), np.array([0.0, -1.0, 0.0]), 0.03,
                                          {"W1": (0.3, 2.7, 0.5, 0.3, 2.7, "rect")}, 0.0, x_bearing=14.3)["W1"]


def sky_basis(face_value=0.25, valid=None):
    """One basis volume on a 2 x 2 x 2 grid of 1 m from the origin, every probe holding face_value on +z, and a 2 x 2 table
    whose every node weighs it 1 for the one window; one 0.5 m patch 1 m from the wall facing it."""
    basis = np.zeros((1, 8, 3, 6), np.float16); basis[0, :, :, 4] = face_value
    table = sunbounce.Table(coeffs=np.ones((2, 2, 1, 1), np.float32), az0=100.0, el0=4.0, step=4.0)
    patches = sunbounce.Patches.from_arrays(np.array([[1.5, 1.0, 1.5]]), np.array([[0.0, -1.0, 0.0]]), np.array([0.25]))
    return reference.SkyBounce(table=table, basis=basis, origin=np.zeros(3), spacing=1.0, shape=(2, 2, 2),
                               valid=np.ones(8, bool) if valid is None else valid, patches=patches, floor_mean=np.zeros((1, 3), np.float32))


OUT_OF_THE_WALL = np.array([0.0, -np.cos(np.radians(5.7)), np.sin(np.radians(5.7))])   # compass azimuth 104.3, 5.7 degrees up


class CapturedSettingIsNeutral(unittest.TestCase):
    def test_multiplier_is_one_at_the_captured_light(self):
        m = model()
        rgb, alpha = reference.multiplier(*splats(), m, reference.Setting.captured(m))
        self.assertTrue(np.allclose(rgb, 1.0, atol=1e-6))
        self.assertTrue(np.all(alpha == 1.0))


class Rules(unittest.TestCase):
    def test_night_without_sky_keeps_only_lamp_light(self):
        m = model()
        rgb, _ = reference.multiplier(*splats(), m, reference.Setting.captured(m).with_sky(0.0))
        # captured: W1 1.0 + cove (0.5 direct + 0.1 bounce) x 0.5 = 1.3; night: 0.3
        self.assertTrue(np.allclose(rgb, 0.3 / 1.3, atol=1e-5))

    def test_multiplier_is_clamped(self):
        m = model()
        rgb, _ = reference.multiplier(*splats(), m, reference.Setting.captured(m).with_sky(100.0))
        self.assertTrue(np.all(rgb <= 8.0 + 1e-9))

    def test_hidden_splats_have_zero_alpha(self):
        m = model()
        d, n, f, p, c = splats()
        f[1] = codec.CLASS_HIDDEN
        _, alpha = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m))
        self.assertEqual(alpha.tolist(), [1.0, 0.0, 1.0, 1.0])

    def test_lit_bulbs_are_boosted_and_unlit_bulbs_reflect(self):
        m = model()
        d, n, f, p, c = splats()
        f[:] = codec.CLASS_CH_EMITTER
        c[:] = 0.95                                        # a bright bulb: 1 + (4 - 1) x smoothstep(0.45, 0.9, L) = 4
        on, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m).with_lamps(1.0).with_emitter_boost(4.0))
        self.assertTrue(np.allclose(on, 4.0, atol=1e-6))
        neutral, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m))
        self.assertTrue(np.allclose(neutral, 1.0, atol=1e-6))      # the captured setting leaves bulbs as captured
        off, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m).with_lamps(0.0))
        self.assertTrue(np.all(off < 1.0))

    def test_a_lamp_tint_colours_lit_bulbs_and_the_cove(self):
        m = model()
        d, n, f, p, c = splats()
        f[:] = codec.CLASS_CH_EMITTER
        c[:] = 0.95
        tints = {g: (1.0, 1.0, 1.0) for g in reference.LAMP_GROUPS}
        tints["ch_end"] = (1.2, 1.0, 0.6)
        lit, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), lamp_tints=tints))
        np.testing.assert_allclose(lit, np.tile([1.2, 1.0, 0.6], (4, 1)), atol=1e-9)

    def test_the_horizon_blocks_the_sun(self):
        d, n, f, p, c = splats(1)
        n[:] = [0.0, -1.0, 0.0]; f[:] = codec.FLAG_SUN; p[:] = [1.5, 1.0, 1.5]    # enters at z 1.6, leaves the glass at 1.65
        open_m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": np.zeros(360, np.float32)})
        shut_m = replace(open_m, horizons={"W1": np.full(360, 90.0, np.float32)})
        setting = replace(reference.Setting.captured(open_m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3))
        lit, _ = reference.multiplier(d, n, f, p, c, open_m, setting)
        shut, _ = reference.multiplier(d, n, f, p, c, shut_m, setting)
        self.assertTrue(np.all(lit > 1.0 + 1e-3))
        self.assertTrue(np.allclose(shut, 1.0, atol=1e-9))

    def test_the_moon_lights_like_the_sun_through_the_same_window(self):
        d, n, f, p, c = splats(1)
        n[:] = [0.0, -1.0, 0.0]; f[:] = codec.FLAG_SUN; p[:] = [1.5, 1.0, 1.5]
        m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": np.zeros(360, np.float32)})
        by_sun, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3)))
        by_moon, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), moon_dir=OUT_OF_THE_WALL, moon_rgb=np.ones(3)))
        both, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3),
                                                                    moon_dir=OUT_OF_THE_WALL, moon_rgb=np.ones(3)))
        np.testing.assert_allclose(by_moon, by_sun, atol=1e-12)
        self.assertTrue(np.all(both > by_sun))

    def test_the_sky_bodies_bounce_through_the_basis_scaled_by_the_exact_window_power(self):
        d, n, f, p, c = splats(1)                          # no sun flag: only the bounce reaches this splat
        horizon = np.zeros(360, np.float32)
        m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": horizon}, sky=sky_basis())
        power = sunbounce.window_power([m.volumes["W1"]], [horizon], m.fresnel, m.sky.patches, np.asarray(OUT_OF_THE_WALL, np.float32))
        self.assertGreater(float(power[0]), 0.2)           # the patch faces the open window: 0.25 m2 x cos 5.7 degrees
        sun = replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.array([1.0, 2.0, 0.5]))
        lit, _ = reference.multiplier(d, n, f, p, c, m, sun)
        np.testing.assert_allclose(lit[0], 1.0 + 0.25 * float(power[0]) * np.array([1.0, 2.0, 0.5]) / 1.3, rtol=1e-9)   # the cove's float32 0.1
        moon = replace(reference.Setting.captured(m), moon_dir=OUT_OF_THE_WALL, moon_rgb=np.array([1.0, 2.0, 0.5]))
        np.testing.assert_allclose(reference.multiplier(d, n, f, p, c, m, moon)[0], lit, rtol=1e-12)
        shut = replace(m, horizons={"W1": np.full(360, 90.0, np.float32)})
        np.testing.assert_allclose(reference.multiplier(d, n, f, p, c, shut, sun)[0], 1.0, atol=1e-12)

    def test_the_basis_reaches_the_probes_trilinearly(self):
        m = replace(model(3, 0.5), sky=sky_basis())        # 0.5 m probes over the 1 m basis grid
        S1 = np.zeros((8, 3, 6)); S1[:, 0, 4] = [0, 0, 0, 0, 1, 1, 1, 1]           # value = x on the basis grid (ix major)
        out = reference.to_probes(m, S1)
        self.assertAlmostEqual(float(out[(1 * 3 + 0) * 3 + 0, 0, 4]), 0.5, places=12)   # probe x 0.5
        self.assertAlmostEqual(float(out[(2 * 3 + 2) * 3 + 2, 0, 4]), 1.0, places=12)   # probe x 1.0
        valid = np.ones(8, bool); valid[4:] = False                                     # the x = 1 plane is invalid
        out = reference.to_probes(replace(m, sky=sky_basis(valid=valid)), S1)
        self.assertEqual(float(out[(1 * 3 + 1) * 3 + 1, 0, 4]), 0.0)                   # only the x = 0 corners remain

    def test_a_covered_splat_is_lit_as_interior_and_hidden_while_its_group_draws(self):
        d, n, f, p, c = splats(2)
        f[1] = codec.cover_flags(np.array([codec.CLASS_INTERIOR], np.uint8), 3)[0]
        m = model(); s = reference.Setting.captured(m)
        M, a = reference.multiplier(d, n, f, p, c, m, s)
        np.testing.assert_allclose(M[1], M[0]); self.assertEqual(a.tolist(), [1.0, 1.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(skin_groups=1 << 3))
        self.assertEqual(a.tolist(), [1.0, 0.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(skin_groups=1 << 2))
        self.assertEqual(a.tolist(), [1.0, 1.0])

    def test_a_toggled_splat_is_hidden_with_its_toggle(self):
        d, n, f, p, c = splats(2)
        f[:] = codec.toggle_flags(np.zeros(2, np.uint8), np.array([0, 2]))
        m = model(); s = reference.Setting.captured(m)
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(hidden_toggles=0b10))
        self.assertEqual(a.tolist(), [1.0, 0.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(hidden_toggles=0b01))
        self.assertEqual(a.tolist(), [1.0, 1.0])


if __name__ == "__main__":
    unittest.main()
```

(`test_a_lamp_tint_colours_lit_bulbs_and_the_cove` is R1d's amendment A1, `test_the_moon_lights_like_the_sun_through_the_same_window` its A5, the two visibility tests R1c's A2; the two sky-bounce tests are this revision's. The sky-bounce test's tolerance is 1e-9 because the synthetic cove bounce is a float32 0.1.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_reference -v`
Expected: FAIL, no module `relight.reference`.

- [ ] **Step 3: Write the reference multiplier**

`tools/relight/relight/reference.py`:

```python
"""The normative relight multiplier (the plan's section "The multiplier"), in numpy.

The browser's GPU kernel (plan R1b) must match this within the codec's precision; the test vectors written by
`python -m relight check` hold both inputs and expected outputs. Each sky body's direct light (the Sun's and the Moon's)
is the window volume march of windows.sun_visibility (Task 3 as built). Their bounce is the factored sky-body basis of
sunbounce.py (Task 4 as built): per window the exact entering power P_w of the 56,448 patch rays times the smooth
response R_w of K basis volumes on the 1 m grid, mixed by the 4-degree coefficient table, resampled onto the 0.5 m
probes and evaluated there exactly as the nine sources' bounce is (the browser folds it into the scenario volume)."""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np

from . import codec, sunbounce
from .windows import sun_az_el, sun_visibility
from .windows import fresnel_at as window_fresnel_at

LUMW = np.array([0.2126, 0.7152, 0.0722])
WINDOWS = ("W1", "W2", "W3", "W4", "W5")
LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")


@dataclass(frozen=True, eq=False)
class SkyBounce:
    """The sky bodies' bounce basis as the package carries it (sunbounce.py; the contract's "The sky bodies' bounce")."""
    table: sunbounce.Table          # coeffs (rows, columns, windows, K) float32; az0, el0, step (degrees)
    basis: np.ndarray               # (K, M1, 3, 6) float16: the unit-field volumes on the basis grid
    origin: np.ndarray              # (3,) the basis grid's corner (model frame)
    spacing: float                  # 1.0 m
    shape: tuple                    # (22, 11, 7)
    valid: np.ndarray               # (M1,) bool
    patches: sunbounce.Patches      # the patch rays (16 n, 3), normals (n, 3) and areas (n,), float32
    floor_mean: np.ndarray          # (K, 3) float32: each volume's mean +z irradiance over the floor light maps


@dataclass(frozen=True, eq=False)
class Model:
    capture_w: np.ndarray        # (9,)
    capture_c: np.ndarray        # (9, 3)
    daylight_colour: np.ndarray  # (3,) the capture's daylight colour, c[W1]
    probes: np.ndarray           # (M, 9, 3, 6)
    probe_valid: np.ndarray      # (M,) bool
    probe_origin: np.ndarray     # (3,)
    probe_spacing: float
    probe_shape: tuple
    volumes: dict                # name -> windows.WindowVolume, in window order W1..W5; empty = no sky-body light
    fresnel: np.ndarray          # (101,)
    horizons: dict = field(default_factory=dict)   # name -> (360,) horizon elevation in degrees by compass azimuth
    sky: SkyBounce | None = None                  # the sky bodies' bounce; None in synthetic models without it


@dataclass(frozen=True)
class Setting:
    weights: np.ndarray          # (9, 3): each source's weight x colour
    sky_level: float
    sky_colour: np.ndarray       # (3,)
    lamp_levels: dict            # group -> level 0..1
    sun_dir: np.ndarray | None   # (3,) toward the sun, model frame
    sun_rgb: np.ndarray          # (3,)
    emitter_boost: float = 1.0   # 1 in every setting (R1d draws crisp bulbs instead of boosting the bulb splats)
    lamp_tints: dict = field(default_factory=lambda: {g: (1.0, 1.0, 1.0) for g in LAMP_GROUPS})   # group -> RGB tint
    moon_dir: np.ndarray | None = None   # (3,) toward the Moon, model frame (amendment A5)
    moon_rgb: np.ndarray = field(default_factory=lambda: np.zeros(3))

    @staticmethod
    def captured(model: Model) -> "Setting":
        return Setting(weights=model.capture_w[:, None] * model.capture_c, sky_level=1.0,
                       sky_colour=np.asarray(model.daylight_colour, np.float64).copy(),
                       lamp_levels={g: 1.0 for g in LAMP_GROUPS}, sun_dir=None, sun_rgb=np.zeros(3), emitter_boost=1.0)

    def with_sky(self, level: float) -> "Setting":
        w = self.weights.copy()
        w[:5] = w[:5] * (level / self.sky_level) if self.sky_level > 0 else w[:5] * 0.0
        return replace(self, weights=w, sky_level=level)

    def with_lamps(self, level: float) -> "Setting":
        return replace(self, lamp_levels={g: level for g in LAMP_GROUPS})

    def with_emitter_boost(self, boost: float) -> "Setting":
        return replace(self, emitter_boost=boost)


@dataclass(frozen=True)
class Visibility:
    """What the browser hides (R1c, amendment A2): wall groups drawn as skins (bit g) and hidden toggles (bit t - 1)."""
    skin_groups: int = 0
    hidden_toggles: int = 0


NO_VISIBILITY = Visibility()


def trilinear(model: Model, pos):
    """Corner indices (N, 8) and weights (N, 8) over valid probes, renormalised (03_bases.trilinear_weights)."""
    shape = np.array(model.probe_shape)
    q = (np.asarray(pos, np.float64) - model.probe_origin) / model.probe_spacing
    q = np.clip(q, 0.0, shape - 1 - 1e-6)
    i0 = np.floor(q).astype(np.int64)
    f = q - i0
    idx, wts = [], []
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                c = np.minimum(i0 + [dx, dy, dz], shape - 1)
                lin = (c[:, 0] * shape[1] + c[:, 1]) * shape[2] + c[:, 2]
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                idx.append(lin); wts.append(w * model.probe_valid[lin])
    idx, wts = np.stack(idx, 1), np.stack(wts, 1)
    s = wts.sum(1, keepdims=True)
    return idx, np.where(s > 0, wts / np.maximum(s, 1e-12), 0.0)


def cube_eval(cubes, n, iso):
    """cubes (N, K, 3, 6), n (N, 3), iso (N,) -> (N, K, 3), as lt.cube_eval."""
    nx, ny, nz = n[:, 0], n[:, 1], n[:, 2]
    w = np.stack([np.clip(nx, 0, None) ** 2, np.clip(-nx, 0, None) ** 2, np.clip(ny, 0, None) ** 2,
                  np.clip(-ny, 0, None) ** 2, np.clip(nz, 0, None) ** 2, np.clip(-nz, 0, None) ** 2], 1)
    e = (cubes * w[:, None, None, :]).sum(-1)
    return np.where(iso[:, None, None], cubes.mean(-1), e)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def fresnel_at(model: Model, s) -> float:
    """The glass transmission for a sky body: windows.fresnel_at at its direction in float32, as sun_visibility takes it."""
    return window_fresnel_at(model.fresnel, np.asarray(s, np.float32))


def sky_bodies(setting: Setting) -> list:
    """The setting's sky bodies that have a direction, as (direction, RGB): the Sun, then the Moon."""
    return [(np.asarray(d, np.float64), np.asarray(rgb, np.float64))
            for d, rgb in ((setting.sun_dir, setting.sun_rgb), (setting.moon_dir, setting.moon_rgb)) if d is not None]


def window_powers(model: Model, s) -> np.ndarray:
    """P_w (windows,) for a sky body toward s: sunbounce.window_power at the float32 direction, each window gated by its
    horizon; zeros while the body is behind the wall."""
    names = [n for n in WINDOWS if n in model.volumes]
    return sunbounce.window_power([model.volumes[n] for n in names], [model.horizons[n] for n in names], model.fresnel,
                                  model.sky.patches, np.asarray(s, np.float32))


def body_coefficients(model: Model, s) -> np.ndarray:
    """(K,) float64: the basis volumes' weights for a white unit body toward s (sunbounce.coefficients with the exact
    powers, at the body's azimuth and elevation from its float32 direction)."""
    s32 = np.asarray(s, np.float32)
    first = next(iter(model.volumes.values()))
    az, el = sun_az_el(s32, first.x_bearing)
    return sunbounce.coefficients(model.sky.table, window_powers(model, s32), az, el)


def probe_points(model: Model) -> np.ndarray:
    """(M, 3): the probe grid's points, probe (ix ny + iy) nz + iz at origin + spacing (ix, iy, iz)."""
    nx, ny, nz = model.probe_shape
    ix, iy, iz = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing="ij")
    return np.asarray(model.probe_origin, np.float64) + model.probe_spacing * np.stack([ix.ravel(), iy.ravel(), iz.ravel()], 1)


def to_probes(model: Model, values) -> np.ndarray:
    """(M, 3, 6): basis-grid values (M1, 3, 6) at the probes, trilinearly (sunbounce.trilinear_matrix: the cell clamped
    into the basis grid and the position into the cell, invalid corners dropped and the rest renormalised, none when
    their weights sum to at most 1e-6)."""
    sky = model.sky
    W = sunbounce.trilinear_matrix(sky.origin, sky.spacing, sky.shape, sky.valid, probe_points(model))
    v = np.asarray(values, np.float64)
    return (W @ v.reshape(len(v), 18)).reshape(-1, 3, 6)


def sky_cubes(model: Model, bodies) -> np.ndarray:
    """(M, 3, 6) float64: the sky bodies' bounce at the probes, as the browser folds it into the scenario volume: on the
    basis grid S1 = sum over the bodies of RGB x sum_k c_k basis_k (float16 widened, float64 sums), then to_probes."""
    S1 = np.zeros(model.sky.basis.shape[1:], np.float64)
    for s, rgb in bodies:
        S1 += sunbounce.bounce(model.sky.basis, body_coefficients(model, s)) * np.asarray(rgb, np.float64)[None, :, None]
    return to_probes(model, S1)


def multiplier(direct, normals, flags, pos, colour_lin, model: Model, setting: Setting, visibility: Visibility = NO_VISIBILITY):
    direct = np.asarray(direct, np.float64)
    n = np.asarray(normals, np.float64)
    flags = np.asarray(flags, np.uint8)
    C = np.asarray(colour_lin, np.float64)
    P = np.asarray(pos, np.float64)
    cls = flags & codec.CLASS_MASK
    iso = (flags & codec.FLAG_ISO) > 0
    idx, wts = trilinear(model, P)
    cubes = (model.probes[idx].astype(np.float64) * wts[:, :, None, None, None]).sum(1)   # (N, 9, 3, 6)
    I = cube_eval(cubes, n, iso)                                                          # (N, 9, 3)
    light = direct[:, :, None] + I
    Ecap = (light * (model.capture_w[:, None] * model.capture_c)[None]).sum(1)
    E = (light * setting.weights[None]).sum(1)
    bodies = sky_bodies(setting)
    if bodies and model.volumes:
        reach = (flags & codec.FLAG_SUN) > 0
        for s, rgb in bodies:
            # the body's direct light: the window volume march, the owner's horizon gate and the glass (float32 inside)
            vis = np.zeros(len(n))
            if reach.any():
                vis[reach] = sun_visibility(model.volumes, model.horizons, model.fresnel, P[reach], s)
            cosv = np.where(iso, 0.25, np.clip(n @ s, 0, None))
            E = E + (vis * cosv)[:, None] * rgb[None]
        if model.sky is not None:
            # both bodies' bounce: the basis at the probes, then the same trilinear lookup and ambient cube as I[k]
            sky = (sky_cubes(model, bodies)[idx] * wts[:, :, None, None]).sum(1)          # (N, 3, 6)
            E = E + cube_eval(sky[:, None], n, iso)[:, 0]
    L = C @ LUMW
    M = E / np.maximum(Ecap, 1e-4)
    emb = cls == codec.CLASS_EMBRASURE
    if emb.any():
        rho = np.minimum(C[emb] / np.maximum(Ecap[emb], 1e-4), 0.8)
        excess = np.maximum(C[emb] - rho * Ecap[emb], 0.0)
        r_back = setting.sky_level * setting.sky_colour / np.maximum(model.daylight_colour, 1e-6)
        M[emb] = (rho * E[emb] + excess * r_back[None]) / np.maximum(C[emb], 1e-4)
    M = np.clip(M, 1 / 16, 8.0)
    fx = np.isin(cls, [codec.CLASS_CH_EMITTER, codec.CLASS_DOME_EMITTER, codec.CLASS_COVE, codec.CLASS_CH_FIXTURE])
    if fx.any():
        centre = (flags & codec.FLAG_CH_CENTRE) > 0
        group = np.where(cls == codec.CLASS_DOME_EMITTER, "dome",
                         np.where(cls == codec.CLASS_COVE, "cove", np.where(centre, "ch_centre", "ch_end")))
        level = np.array([setting.lamp_levels[g] for g in group[fx]])[:, None]
        c_fx = cls[fx]
        bulb = np.isin(c_fx, [codec.CLASS_CH_EMITTER, codec.CLASS_DOME_EMITTER])[:, None]
        cove = (c_fx == codec.CLASS_COVE)[:, None]
        tint = np.array([setting.lamp_tints[g] for g in group[fx]], np.float64)
        lit = np.where(bulb, (1.0 + (setting.emitter_boost - 1.0) * smoothstep(0.45, 0.9, L[fx]))[:, None] * tint,
                       np.where(cove, tint, M[fx]))
        chroma = np.clip(C[fx] / np.maximum(L[fx], 1e-4)[:, None], 0.5, 2.0) ** 0.4
        A = np.where((c_fx == codec.CLASS_DOME_EMITTER)[:, None], 0.5, 0.35) * chroma
        A = np.where(cove, 0.3, A)
        unlit = A * E[fx] / np.maximum(C[fx], 1e-4)
        M[fx] = np.clip(level * lit + (1 - level) * unlit, 0.0, 8.0)
    group = (flags >> codec.SKIN_GROUP_SHIFT).astype(np.int64)
    toggle = (flags >> codec.TOGGLE_SHIFT).astype(np.int64)
    covered = (cls == codec.CLASS_SKIN) & (((visibility.skin_groups >> group) & 1) == 1)
    toggled = (cls != codec.CLASS_SKIN) & (toggle > 0) & (((visibility.hidden_toggles >> np.maximum(toggle - 1, 0)) & 1) == 1)
    alpha = np.where((cls == codec.CLASS_HIDDEN) | covered | toggled, 0.0, 1.0)
    return M, alpha
```

(`multiplier`'s alpha lines are R1c's amendment A2, the lamp tint R1d's A1, the loop over the sky bodies R1d's A5; the sky bounce is Task 4's contract. Verified on 7 October against the committed `sunbounce.py` and `windows.py` and Task 4c's `codec.py`: these 12 tests, R1c A1's 2 and Step 5's 6 pass.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_reference -v`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the records and transfer, with tests**

`tools/relight/tests/test_records.py`:

```python
import unittest
import numpy as np
from relight import codec, records


class Flags(unittest.TestCase):
    def test_flags_pack_class_iso_reach_and_group(self):
        f = records.flags_for(cls=np.array([0, 1, 2, 3, 3, 4]), iso=np.array([1, 0, 0, 0, 0, 0], bool),
                              reach=np.array([1, 1, 0, 0, 0, 0], bool), chand_id=np.array([-1, -1, -1, 0, 4, -1]),
                              centre_ids=(4,), cove=np.zeros(6, bool), fixture=np.zeros(6, bool), pane=np.zeros(6, bool))
        self.assertEqual(int(f[0]), codec.CLASS_INTERIOR | codec.FLAG_ISO | codec.FLAG_SUN)
        self.assertEqual(int(f[1]) & codec.CLASS_MASK, codec.CLASS_EMBRASURE)
        self.assertEqual(int(f[2]) & codec.CLASS_MASK, codec.CLASS_HIDDEN)
        self.assertEqual(int(f[3]), codec.CLASS_CH_EMITTER)
        self.assertEqual(int(f[4]), codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE)
        self.assertEqual(int(f[5]) & codec.CLASS_MASK, codec.CLASS_DOME_EMITTER)

    def test_pane_haze_is_hidden_and_the_cove_strip_is_its_own_class(self):
        f = records.flags_for(cls=np.array([1, 0]), iso=np.zeros(2, bool), reach=np.zeros(2, bool), chand_id=np.array([-1, -1]),
                              centre_ids=(4,), cove=np.array([False, True]), fixture=np.zeros(2, bool), pane=np.array([True, False]))
        self.assertEqual(int(f[0]) & codec.CLASS_MASK, codec.CLASS_HIDDEN)
        self.assertEqual(int(f[1]) & codec.CLASS_MASK, codec.CLASS_COVE)


class Transfer(unittest.TestCase):
    def test_transfer_takes_the_nearest_values(self):
        src = np.array([[0.0, 0, 0], [10.0, 0, 0]]); vals = np.array([[1.0], [3.0]])
        out = records.transfer(src, vals, np.array([[0.1, 0, 0], [9.8, 0, 0]]), k=1)
        self.assertEqual(out[:, 0].tolist(), [1.0, 3.0])

    def test_transfer_blends_by_inverse_distance(self):
        src = np.array([[0.0, 0, 0], [2.0, 0, 0]]); vals = np.array([[1.0], [3.0]])
        out = records.transfer(src, vals, np.array([[1.0, 0, 0]]), k=2)
        self.assertAlmostEqual(float(out[0, 0]), 2.0, places=6)


class Covers(unittest.TestCase):
    COVERS = {"ids": np.array(["door-w2"]), "groups": np.array([0], np.int8),
              "frames": np.array([[0.0, 0, 0, 1, 0, 0, 0, 0, -1, 0, -1, 0]]),     # origin, u +x, v -z, normal -y
              "cell": np.float64(0.05), "shapes": np.array([[2, 2]]), "offsets": np.array([0]),
              "wmin": np.array([0.0, 0.0, 0.0, np.nan], np.float32), "wmax": np.array([0.01, 0.01, 0.01, np.nan], np.float32)}

    def test_splats_in_the_envelope_are_covered_in_their_group(self):
        P = np.array([[0.02, -0.02, -0.02], [0.02, -0.20, -0.02], [0.07, -0.02, -0.07], [0.02, 0.05, -0.02]])
        self.assertEqual(records.cover_test(P, np.full(4, 0.002), self.COVERS).tolist(), [0, -1, -1, 0])

    def test_boxes_keep_objects_as_splats_and_toggle_them(self):
        P = np.array([[0.02, -0.02, -0.02], [0.03, -0.02, -0.03], [5.0, 5.0, 5.0]])
        box = (np.array([0.025, -0.1, -0.05]), np.array([0.05, 0.0, 0.0]))
        covered = records.apply_covers(np.zeros(3, np.uint8), P, np.full(3, 0.002), self.COVERS, [box])
        self.assertEqual(codec.skin_group_of(covered).tolist(), [0, -1, -1])
        toggled = records.apply_toggles(covered, P, [(box[0], box[1], 1)])
        self.assertEqual(codec.toggle_of(toggled).tolist(), [0, 1, 0])


if __name__ == "__main__":
    unittest.main()
```

`tools/relight/relight/records.py` (the covers and toggles are R1c's amendment A3):

```python
"""Per-splat records: the finest level from the light model's tables, coarser levels by transfer."""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from . import codec


def flags_for(cls, iso, reach, chand_id, centre_ids, cove, fixture, pane):
    """Model classes (0 interior, 1 embrasure, 2 exterior, 3 chandelier bulb, 4 dome lamp) to record flags."""
    c = np.asarray(cls).astype(np.uint8).copy()
    c[np.asarray(fixture) & (c <= 1)] = codec.CLASS_CH_FIXTURE
    c[np.asarray(cove)] = codec.CLASS_COVE
    c[np.asarray(pane)] = codec.CLASS_HIDDEN
    f = c.astype(np.uint8)
    f |= np.where(np.asarray(iso), codec.FLAG_ISO, 0).astype(np.uint8)
    f |= np.where(np.asarray(reach), codec.FLAG_SUN, 0).astype(np.uint8)
    centre = np.isin(np.asarray(chand_id), centre_ids) & np.isin(c, [codec.CLASS_CH_EMITTER, codec.CLASS_CH_FIXTURE])
    f |= np.where(centre, codec.FLAG_CH_CENTRE, 0).astype(np.uint8)
    return f


def transfer(src_pos, src_values, dst_pos, k=8):
    """Inverse-distance blend of the k nearest source splats' values (for the coarser levels)."""
    tree = cKDTree(np.asarray(src_pos, np.float64))
    d, i = tree.query(np.asarray(dst_pos, np.float64), k=k)
    v = np.asarray(src_values)
    if k == 1:
        return v[i]
    w = 1.0 / np.maximum(d, 1e-4)
    w /= w.sum(1, keepdims=True)
    return (v[i] * w[..., None]).sum(1)


# Covers and toggles (R1c, amendment A3). tools/skins (R1c Task 5) writes, in its geometry folder, covers.npz (each skin's
# frame and its relief envelope on 5 cm cells: wmin, wmax along the normal, NaN where it covers nothing) and toggles.json
# (axis-aligned E57 boxes: the toggleable objects, and the objects that must stay splats).
COVER_BELOW = 0.10      # a splat up to 10 cm behind the envelope's floor (wmin) is covered,
COVER_ABOVE = 0.03      # and up to 3 cm in front of its top (wmax),
COVER_SIGMA = 0.05      # plus twice its own largest scale, at most 5 cm.


def cover_test(pos, sigma_max, covers):
    """Each splat's wall group if a skin's envelope holds it (the cell under its centre, its depth within
    [wmin - 0.10, wmax + 0.03 + min(2 sigma_max, 0.05)]), else -1. covers: covers.npz as a dict."""
    P = np.asarray(pos, np.float64)
    smax = np.asarray(sigma_max, np.float64)
    out = np.full(len(P), -1, np.int64)
    cell = float(covers["cell"])
    wmin_all, wmax_all = np.asarray(covers["wmin"], np.float64), np.asarray(covers["wmax"], np.float64)
    for s in range(len(covers["ids"])):
        fr = np.asarray(covers["frames"][s], np.float64)
        o, u, v, n = fr[0:3], fr[3:6], fr[6:9], fr[9:12]
        rows, cols = (int(x) for x in covers["shapes"][s])
        off = int(covers["offsets"][s])
        D = P - o
        a, b, w = D @ u, D @ v, D @ n
        c = np.floor(a / cell).astype(np.int64)
        r = np.floor(b / cell).astype(np.int64)
        inside = (c >= 0) & (c < cols) & (r >= 0) & (r < rows) & (out < 0)
        if not inside.any():
            continue
        idx = off + r[inside] * cols + c[inside]
        lo = wmin_all[idx] - COVER_BELOW
        hi = wmax_all[idx] + COVER_ABOVE + np.minimum(2 * smax[inside], COVER_SIGMA)
        ok = np.isfinite(lo) & np.isfinite(hi) & (w[inside] >= lo) & (w[inside] <= hi)
        out[np.flatnonzero(inside)[ok]] = int(covers["groups"][s])
    return out


def in_boxes(pos, boxes):
    """Index of the first axis-aligned box (lo, hi) holding each splat, else -1."""
    P = np.asarray(pos, np.float64)
    out = np.full(len(P), -1, np.int64)
    for k, (lo, hi) in enumerate(boxes):
        hit = np.all((P > np.asarray(lo)) & (P < np.asarray(hi)), 1) & (out < 0)
        out[hit] = k
    return out


def apply_covers(flags, pos, sigma_max, covers, keep_boxes):
    """Class 7 for every interior splat a skin's envelope holds, unless a keep or toggle box holds it (the object stays a splat)."""
    group = cover_test(pos, sigma_max, covers)
    target = (group >= 0) & (in_boxes(pos, keep_boxes) < 0)
    out = np.asarray(flags, np.uint8).copy()
    out[target] = codec.cover_flags(out[target], group[target])
    return out


def apply_toggles(flags, pos, toggle_boxes):
    """toggle_boxes: [(lo, hi, toggle)]: the toggle of the first box holding each splat (class 7 excepted)."""
    k = in_boxes(pos, [(lo, hi) for lo, hi, _t in toggle_boxes])
    out = np.asarray(flags, np.uint8).copy()
    hit = k >= 0
    if hit.any():
        toggles = np.array([t for _lo, _hi, t in toggle_boxes], np.int64)
        out[hit] = codec.toggle_flags(out[hit], toggles[k[hit]])
    return out


def load_skin_inputs(geometry_dir):
    """tools/skins' geometry (R1c Task 5): covers.npz, and toggles.json's toggle boxes and keep boxes."""
    import json, os
    with np.load(os.path.join(geometry_dir, "covers.npz")) as z:
        covers = {k: z[k] for k in z.files}
    with open(os.path.join(geometry_dir, "toggles.json"), encoding="utf-8") as f:
        t = json.load(f)
    toggles = [(np.asarray(b["lo"], np.float64), np.asarray(b["hi"], np.float64), int(b["bit"])) for b in t["toggles"]]
    keep = [(np.asarray(b["lo"], np.float64), np.asarray(b["hi"], np.float64)) for b in t["keep"]] + [(lo, hi) for lo, hi, _t in toggles]
    return covers, toggles, keep
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_records -v`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the records and the package** (amended 8 October, the controller's ruling P1: Steps 6 and 7 write the code; Step 8 commits it and only then builds, checks and writes the fixture)

**Only exact, hash-checked files are packaged** (the owner's rule, 7 October). `package.py` reads each work artifact by its exact name, never a glob (never `work/sun-bounce*`), and only when its SHA-256 equals the one its evidence records (Task 4c) and that evidence passed:

```python
def verified(work, evidence, name, evidence_name):
    """The exact work artifact `name`, refused unless its evidence JSON passed and records this file's SHA-256 (Task 4c)."""
    import hashlib, json, os
    path = os.path.join(work, name)
    with open(os.path.join(evidence, evidence_name), encoding="utf-8") as f:
        ev = json.load(f)
    record = ev.get("artifact")
    if ev.get("pass") is False or not record:
        raise ValueError(f"{evidence_name} records no passing artifact for {name}")
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest() != record["sha256"] or os.path.getsize(path) != record["bytes"]:
        raise ValueError(f"{path} is not the artifact {evidence_name} records ({record['sha256']})")
    return path, record["sha256"]
```

The artifacts and their evidence: `windows.npz` (`windows.json`), `probes-coarse.npz` (`probes-check.json`), `sun-bounce.npz` (`sun-bounce-check.json`), `floor-light.npz` (`floor-light.json`); `fit.json` and `fit_state.npz` are checked against `<evidence>/refit.json`'s `copied` hashes (its `pass` must be true: a refused promote leaves `copied` empty), and `fit.json`'s `model.name` must be `refit` (Task 4b promoted it; the bake never packages the proof fit). The manifest's `evidence.artifacts` records `{ name: sha256 }` for every file read, each key the artifact's path relative to the work folder with `/` separators (`windows.npz`, `probes-coarse.npz`, `sun-bounce.npz`, `floor-light.npz`, `fit.json`, `fit_state.npz`, and in package v2 `skin-light/index.json` and each `skin-light/<id>.records`; R1c Task 8 reads `evidence.artifacts["probes-coarse.npz"]`).

`tools/relight/relight/package.py` writes every file of `docs/engineering/relight-package.md` into the package folder (`args.out` when given, amended for R1c; otherwise `cfg.paths["out"]`): per served tile the gzip of its records (`gzip.compress(data, compresslevel=9, mtime=0)` so the bytes are deterministic), `probes.bin.gz` (the coarse cubes as `<f2` in `[probe][source][channel][face]` order), `probe-valid.bin.gz`, each window's volume as `windows/<id>.alpha.gz` (the gzip, compressed the same way, of `np.ascontiguousarray(vol.alpha).tobytes()`: `nx·ny·nz` bytes in x-major C order, from `windows.npz` through `windows_volumes(cfg)`), the sky bodies' bounce from `sun-bounce.npz` (amended 7 October; these replace the sunlit-area table): `sky/basis.bin.gz` (`basis` as `<f2`, `[k][probe][channel][face]`, K × 1694 × 3 × 6), `sky/basis-valid.bin.gz` (`valid`, one byte per 1 m probe), `sky/coefficients.bin.gz` (`coeffs` as `<f4`, `[row][column][window][k]`, 18 × 79 × 5 × K), `sky/patch-rays.bin.gz` (`patchRays` as `<f4`, `[ray][x, y, z]`, 56,448 × 3, sub-sample-major), `sky/patch-normals.bin.gz` (`patchNormal`, `<f4`, 3528 × 3) and `sky/patch-areas.bin.gz` (`patchArea`, `<f4`, 3528), each compressed the same way; the three floor light PNGs (RGBA8 log codes per `encoding.floor`), and `manifest.json` with every contract field and a SHA-256 and size per file (`json.dumps(..., indent=1, sort_keys=True, allow_nan=False)`, so a NaN or infinity fails the build instead of writing a file browsers cannot parse). `sun-bounce.npz`'s `needed`, `real` and `nodePower` are bake diagnostics and are not packaged. Every path the manifest names (the `files` keys, `tiles[].file`, `probes.file` and `validFile`, `windows[].volume`, the `sky` files, `floor.files`, `skins.entries[].file`) is built with `/` (`posixpath.join` or `PurePosixPath`), never `os.path`, whose `\` on Windows would make R1b refuse the whole package. `package.write` takes `tool` and `created_at` as arguments: `records` passes the repository's HEAD commit, `git -C <cfg.paths["repo"]> rev-parse HEAD`, and that commit's committer time, `git -C <cfg.paths["repo"]> log -1 --format=%cI` (as R1d's `cinematic` writes them), never the wall clock, as the manifest's `tool` and `createdAt`; so a second write at the same commit is byte-identical (R1c Task 15's double run compares two `records` trees, the manifest included), and check 4 passes the package's own two values (Step 7). `capture.gamma` is written as exactly `1` after asserting that the fitted gamma (`fit.json`'s `gamma`) is within 1e-6 of 1; otherwise the build fails, because the kernel has no γ term (R1b accepts a γ within 1e-6 of 1 and refuses any other).

**Built only from committed code** (amended 8 October, the controller's ruling P1). The manifest's `tool` names the commit that built the package, so that commit must hold exactly the code that ran: `records` refuses, writing nothing, while `tools/relight` has any uncommitted change (staged, unstaged or untracked), and `check` (Step 7) refuses the same way before it reads the package. Add to `tools/relight/relight/__main__.py`, directly above `if __name__ == "__main__":`:

```python
def _committed_tool(cfg):
    """(HEAD commit, its committer time) of the repository that holds tools/relight, or None (with the reason printed)
    while tools/relight has any uncommitted change: a package is built and checked only from committed code, so its
    `tool` names exactly the code that made it (ruling P1, 8 October)."""
    import subprocess
    git = lambda *a: subprocess.run(["git", "-C", cfg.paths["repo"], *a], check=True, capture_output=True, text=True).stdout.strip()
    dirty = git("status", "--porcelain", "--", "tools/relight")
    if dirty:
        print(f"FAIL: tools/relight has uncommitted changes; commit them before building or checking a package:\n{dirty}", flush=True)
        return None
    return git("rev-parse", "HEAD"), git("log", "-1", "--format=%cI")
```

`records` calls it first and returns 1 on None; otherwise it passes the pair to `package.write` as `tool` and `created_at` (the two `git` calls above are the ones this step names). `__pycache__` is ignored by the repository's `.gitignore`, so running the code leaves the check clean.

(Amended for R1c.) With `--skin-light <dir>` and `--skin-package <dir>`, `package.write` also takes `section, files = skinlight.skins_section(skin_light_dir, skin_package_dir, groups)`, where `groups` is `["door", "window", "end_xmin", "end_xmax", "ceiling"]`. It writes each of `files` (`skins/<id>.light.gz`, compressed with `mtime = 0`) with a SHA-256 and size in `files`, and adds the manifest fields `skins: section` and `visibility: skinlight.VISIBILITY`. Without them, neither field is written. The skin-light folder is read only when `<evidence>/skin-light.json`'s `artifact` matches its `index.json` and each `records` hash matches its file. The manifest's `evidence.build` records `{ skins, skinLight, skinPackage }` (the three arguments, or null), so check 4 can rebuild exactly.

Register a `records` command that:

1. Loads the Task 2 tables (memory-mapped) and computes per finest-level splat, in chunks: `direct` (N, 9) from the proof's `04_fit.direct(store, idx)` (ten bases; keep the columns W1..W5, cove, ch_end, ch_centre, dome in that order and drop `sun_cap`, whose fitted weight is at its bound), with the embrasure room-side and back-face light that `03c`/`03d` produce folded into the window columns exactly as `04_fit.direct` already combines them for class 1; normals `bases_n` (e57 frame); `iso` from `bases_iso`; exterior and pane haze from `05_relight.exterior_masks`; the cove strip from `05_relight.cove_strip`; `fixture` = `geom_chand_id >= 0` with class 0; the centre chandelier's id as `03_bases.py` assigns it to `E_ch` column 1; and `reach` = `windows.sun_reach(vols, P, cfg.room["site"]["latitude"])` for classes 0 and 1 only, False for every other class (the analytic, conservative flag of Task 3 as built, whose band Task 4 widened to the Moon's: true wherever some real sun or moon can light the splat through some window; `vols` from `windows_volumes(cfg)[0]`; in chunks of `windows.CHUNK`; numpy, no GPU lock). On the finest level it marks 83.7% of the splats (`<evidence>/sun-check.json`, `sunReach.flaggedShare` 0.83674 after Task 4).
2. Splits them per finest tile with `splats_tile` (the order of `cfg.room["finestTiles"]`); `ranges = [codec.source_range(direct[:, k]) for k in range(9)]` over all finest splats.
3. For each of the other 12 served tiles (every `*.sog` in `cfg.paths["splats"]` not in `finestTiles`): decode the centres with `decode_tile`, convert them to e57 with `common.json_to_e57`, then transfer `direct` (k = `cfg.room["transferNeighbours"]`, 8) and, with k = 1, the normals, class, iso, chandelier id, cove, fixture and pane values; compute `reach` with `windows.sun_reach` at the coarse splats' own e57 positions for their transferred classes 0 and 1 (a transferred flag would not be conservative at the coarse splat's own position); recompute the flags with `flags_for`.
4a. (Amended for R1c.) With `--skins <tools/skins geometry folder>`: `covers, toggles, keep = records.load_skin_inputs(folder)`, then on every level, after its flags are computed, `flags = records.apply_toggles(records.apply_covers(flags, P_e57, sigma_max, covers, keep), P_e57, toggles)`, each splat at its own e57 position. `sigma_max` is the splat's largest scale: on the finest level the row maximum of `npy/splats_scl.npy` (float16 metres), on the others the row maximum of `decode_tile`'s `scales` (the codebook already exponentiated, `tools/xgrids-lcc2/scripts/sog-floor-census.py`). Print each level's covered splats per wall group and toggled splats per toggle. Without `--skins` nothing changes.
4. Writes the package with `package.write` (into `args.out` when given; amended for R1c), with `site.north = common.sun_vec_e57(0, 0)`, `site.east = common.sun_vec_e57(90, 0)` and `site.up = [0, 0, 1]` (so the browser's sun and moon match the bake's); each window, in order W1..W5, as `{ id, frame: windows.volume_arrays(vol)[1].tolist(), volume: "windows/<id>.alpha.gz", horizon: [float(v) for v in horizons[id]] }` from `windows.npz` (the frame float64 in `FRAME_FIELDS` order; assert every window's `res` is the same and that `site.north` equals `(cos x_bearing, sin x_bearing, 0)` within 1e-9); `sun = { fresnel: [101] }`; the `sky` section from `sun-bounce.npz` (`k` = `basis.shape[0]`, read from the data, never a constant; `grid: { origin: gridOrigin, spacing: gridSpacing, shape: gridShape }`, `basis`, `valid`, `table: { azimuth0, elevation0, step, size: [columns, rows], file }`, `patches: { count, subsamples: 16, rays, normals, areas }`, `floorMean` (K × 3), `bodies: ["sun", "moon"]`; assert `azimuth0`, `elevation0` and `step` are whole numbers, `1 <= k <= 192` (`__main__.SUN_KMAX`, the most the K search tries; R1b's schema accepts up to it; the test vectors' K-proportional parts grow with it, so Step 7's size cap is a function of K), `coeffs.shape == (rows, columns, 5, k)`, `patchRays` holds 16 × `count` rays, and the grid's origin equals the probes' origin); the `capture` from Task 4b's `fit.json` (weights and colours selected by name in the source order, `sun_cap` dropped by name, never by position; `daylightColour` its W1 colour); the `lamps` section: for each group `{ source, colour, type }`, `colour` the group's lamp/daylight ratio at full level (`capture.colours[source] / capture.daylightColour`, per channel: the refit's measured-and-fitted colour, never a constant), divided in float64 from the very Python floats written to `capture.colours` and `capture.daylightColour` (never from a float32 copy of either: R1b refuses the package unless each group's colour equals that quotient within 1e-9 × max(1, |quotient|), and a float32 round trip on either side exceeds it), `type` the installer's record (`cove` `"led-tape"`, `dome` `"led-spot"`, `ch_end` and `ch_centre` `"candle-unconfirmed"`; information only: how a lamp's colour changes as it dims is a setting, R1b's `lampTints`, never a package value), plus `measuredRatio` (`lamp_daylight_ratio.json`) and `refit: { perBulbIntensity, lampRatio, wCrown, bulbTableSha256 }` from `<evidence>/refit.json` (`perBulbIntensity` = `exp(gates.accept.logPerBulb)`, `lampRatio` = `gates.accept.lampRatio`, `wCrown` = `bulbs.wCrown`, the crown tubes' weight the refit used (amended 8 October, ruling L2), `bulbTableSha256` = `bulbs.sha256`, the bulb table's SHA-256; the key names are the contract's and R1b's schema's); `evidence.sunCheck` (`sun-check.json`'s `pass`, `threshold` and per-direction IoU and mean |ΔT|), `evidence.skyBounce` (`sun-bounce-check.json`'s `K`, `kRule`, the selection, check and strict draws' `worstBright` and `pooledMedian`, `pass`), `evidence.refit` (`refit.json`'s gates: residual ratio, lamp ratio, photo metrics, the crown tubes' sensitivity) and `evidence.artifacts`. The manifest's `tiles` list holds each tile's name, the SHA-256 of the `.sog` file, its level (from the bundle file: 5 for the finest, `null` for `env.sog`), count, file, SHA-256 and size.

Step 8 runs it once the code is committed: `C:/Python313/python.exe -m relight records --config config/grand-hall.json`. Expected then: `D:/claude/splats/trades-hall/grand-hall/relight/v1/` holds `manifest.json`, 24 `tiles/*.relight.gz`, `probes.bin.gz`, `probe-valid.bin.gz`, 5 window volumes (`windows/W1.alpha.gz` … `W5.alpha.gz`, 196,028 bytes in all: 54,129, 26,933, 38,117, 27,205 and 49,644, Task 3's Phase B), the six `sky/*.bin.gz` files (about 2.1 MB together at K 30) and 3 floor maps; the tile counts sum to 11,487,038; `manifest.json`'s `capture.weights` give `ch_centre / ch_end` the refit's lamp ratio.

- [ ] **Step 7: Write the checks and the test vectors**

Register a `check` command that first calls `_committed_tool(cfg)` (Step 6; it returns 1 on None and records the commit as `checkedWith` in its checks file, never in the manifest) and reads the package back from disk (never in-memory arrays; `--package <dir>` names the package, default `cfg.paths["out"]`, amended for R1c). What it writes depends on the package it checks (amended 8 October, seam review I-3), so checking package v2 never touches v1's evidence or the committed fixture:
- its results go to `<evidence>/checks.json` for the default package (v1), and to `<evidence>/checks-<package folder name>.json` with `--package <dir>` (`checks-v2.json` for `…/relight/v2`);
- the test vectors (below) are written to `packages/web/src/lib/relight/__fixtures__/relight-vectors.json` only for the default package, whose fixture R1b's and R1d's tests read as v1's, or to the path an explicit `--vectors <path>` names; a `--package` run without `--vectors` writes no vectors and prints `vectors: not written (--package without --vectors)`;
- the checks' results also go into the checked package's manifest `evidence` (end of this step), the only change `check` makes to a package.

Its `reference.Model` comes from the package's files: each window through `windows.volume_from_arrays(id, np.frombuffer(gzip.decompress(<windows/<id>.alpha.gz>), np.uint8).reshape(nx, ny, nz), np.asarray(frame, np.float64))` with `nx, ny, nz` from the frame, the horizons and the glass table from the manifest, and `sky` = `reference.SkyBounce(table=sunbounce.Table(coeffs=coeffs, az0=azimuth0, el0=elevation0, step=step), basis=basis, origin=origin, spacing=spacing, shape=shape, valid=valid, patches=sunbounce.Patches(rays=rays, normals=normals, areas=areas), floor_mean=floor_mean)` from the `sky` files and fields (every argument by keyword; `sunbounce.Table`'s fields are `coeffs`, `az0`, `el0` and `step`, `sunbounce.py:43-47`).

1. **Captured identity:** for every tile, `reference.multiplier` at `Setting.captured(model)` gives |log2 M| ≤ 0.05 for at least 99.9% of non-hidden splats.
2. **Proof regression:** for the finest level, `reference.multiplier` for the proof's `night` and `overcast_noon` settings (built from `05_relight.SCENARIOS` and `scenario_light` on Task 4b's `fit_state.npz`: window weights `W[w] × sky` with `col_sky`, lamp weights `house × WC`) against the proof's own multipliers for the same fit, `<work>/mult/night.f16` and `overcast_noon.f16` (N × 4 float16, product order; Task 4b ran `05_relight.py` on the refit and promoted them): median |Δlog2| ≤ 0.1 and 95th percentile ≤ 0.3 over interior splats (class 0, not in a chandelier). For `sunny_morning` (`<work>/mult/sunny_morning.f16`; the proof's sun bounce is its full radiosity, the reference's the basis): median ≤ 0.25. The same numbers against the original proof's `proofWork/mult/*.f16` are recorded for information (they show what the refit changed); they are not gated.
3. **Transfer:** for each coarser tile, the median |Δlog2| between a coarse splat's night multiplier and its nearest finest splat's ≤ 0.1.
4. **Determinism:** writing the package a second time into a temporary folder on D: gives the same package (amended 8 October, seam review I-4): every file `files` names byte for byte, and `manifest.json` byte for byte once the keys this command adds to `evidence` (`capturedIdentity`, `proofRegression`, `transfer`, `determinism`, `skyBounceCheck`, `wallFaceRate`) are removed from the copy on disk and it is dumped again with `package.write`'s own `json.dumps` arguments (so a second `check` of the same package, which the double-run rule asks for, compares like with like). That holds because the manifest carries no wall-clock value: `tool` and `createdAt` come from a commit (Step 6), and the second write is given the package's own `tool` and `createdAt`, so it tests the same inputs at whatever commit is checked out now. With `--package`, the second write uses the arguments recorded in the package's `evidence.build` (amended for R1c).
5. **The sky bodies' bounce through the package** (amended 7 October; it replaces the sunlit-area table's check): (a) every `sky` array read back from the package equals `sun-bounce.npz`'s (`basis`, `valid`, `coeffs`, `patchRays`, `patchNormal`, `patchArea`, `floorMean`: dtype, shape and bytes); (b) for 48 random real suns (`_random_suns(common, 48, SPLAT_SEED + 31)`) and 48 random real moons (`_random_moons(cfg, 48, SPLAT_SEED + 37)`), the bounce luminance at 20,000 random finest splats (seeded with `SPLAT_SEED`, isotropic receivers) through the package's path (`reference.sky_cubes` at the 0.5 m probes, then `reference.trilinear` and `cube_eval`) against `sunbounce.sun_bounce` read on the 1 m grid at the same splats (`sunbounce.trilinear_matrix`): where both are positive, median |Δlog2| ≤ 0.02 and 99th percentile ≤ 0.1, and where either is zero both are (the 0.5 m resampling adds no light and loses none). Record per body `directions`, `medianAbsDlog2`, `p99AbsDlog2`, `zeroDisagreements` and `pass`. A miss is reported with the numbers, never loosened.

**The wall-face rate** (amended 8 October, seam review I-5; R1b Task 18 caps the GPU's rounding excuses at twice it). It is a measurement, not a sixth check: the share of marched rays whose verdict float32 rounding alone could flip at the wall face. The sample is `check-sun`'s: the 200,000 finest splats `np.sort(np.random.default_rng(SPLAT_SEED).choice(N, SPLAT_SAMPLE, replace=False))` of `<work>/npy/splats_pos.npy` (as `cmd_check_sun` draws them, `__main__.py:311-312`), as float64 e57 positions, at the `sunny_morning` setting's `sun_dir` and the `moon_test` setting's `moon_dir`, through the package's window volumes.
- **One public function measures it** (amended 8 October, the controller's request: R1c Task 15 measures its skins' rate with the same code, so the two can never drift): `windows.wall_face_rate(volumes, horizon_tables, fresnel_table, P, s) -> {"marched": int, "wallFace": int}`, beside the march it measures. `marched` counts the rays on which `windows.sun_visibility(model.volumes, model.horizons, model.fresnel, P, s, steps=steps)` takes a sample (`steps > 0`): the function repeats `sun_visibility`'s ownership, horizon gates and survival line for line. A marched ray from a room point (`P.y > y0` of its owning window, the first window in order that claims it, which for a marched ray is also the first whose `windows.ray_survives` is true) is wall-face sensitive when the two cells on either side of `y0` in its first sample's column hold different sample depths. Those cells are grid cells `(c[0], iy0 − 1, c[2])` and `(c[0], iy0, c[2])`, with `c` and `iy0` computed in float32 exactly as for `wallFace` below (the first sample's cell as the march computes it); the depths are `windows._sample_depth` of their alpha bytes, and a cell outside the box reads alpha 0. Whichever cell the bake chose does not matter: every marched room ray's first sample lies on `y0`, a cell boundary, so a GPU that rounds differently may read the other cell, and R1b's twin with `WINDOW_ROUNDING` marks exactly these first samples. `check` calls it for each population and direction and sums the two directions. `_sample_depth` stays private: only `windows.py` calls it, and `check` takes the vectors' `sampleDepths` from the public `windows.sample_depths(vol)`, added beside it.

Append to the end of `tools/relight/relight/windows.py`:

```python
def sample_depths(vol: WindowVolume) -> np.ndarray:
    """The march's optical depth per sample for each alpha byte 0..255, (256,) float32: _sample_depth's table, public
    for the test vectors' sampleDepths, which R1b's twin must compute bit for bit."""
    return _sample_depth(vol, np.arange(256, dtype=np.uint8))


def _alpha_at(vol: WindowVolume, gx, gy, gz):
    """The alpha bytes of occupancy-grid cells (gx[i], gy, gz[i]); a cell outside this window's box reads 0."""
    cell = np.stack([gx, np.full(len(gx), gy, np.int64), gz], 1) - vol.offset
    inside = np.all((cell >= 0) & (cell < np.array(vol.alpha.shape)), axis=1)
    out = np.zeros(len(gx), np.uint8)
    out[inside] = vol.alpha[cell[inside, 0], cell[inside, 1], cell[inside, 2]]
    return out


def wall_face_rate(volumes, horizon_tables, fresnel_table, P, s) -> dict:
    """The rays from the points P toward the sky body s that float32 rounding alone could send into another cell at a
    window's wall face (R1a Task 5 Step 7; R1b caps the GPU's rounding excuses at twice wallFace / marched).

    marched: the rays sun_visibility takes at least one sample on (its steps > 0): each belongs to the first window, in
    order, that claims it, whose horizon gate is open and through which it survives. wallFace: the marched rays from a
    room point (P.y > y0 of that window) whose first sample, on the wall face y0, has cells of unlike sample depth on
    either side: occupancy-grid cells (c[0], iy0 - 1, c[2]) and (c[0], iy0, c[2]), with c = floor((Q - grid_lo) / res)
    the first sample's cell in float32 exactly as the march computes it (Q = P + s tq, tq = (y0 - P.y) / s.y), iy0 =
    round((y0 - grid_lo.y) / res), and a cell outside the box read as alpha 0. Whichever of the two cells the march
    read, the y0 boundary passes through that sample, so a GPU that rounds differently may read the other.
    P (N, 3) model-frame points of any float dtype (taken to float32, as the march takes them); s a direction.
    Returns {"marched": int, "wallFace": int}; sum two directions' counts to pool them."""
    D = np.asarray(s, F32)
    out = {"marched": 0, "wallFace": 0}
    if float(D[1]) >= -MIN_DOWN:
        return out
    gates = {name: above_horizon(horizon_tables[name], D, vol.x_bearing) for name, vol in volumes.items()}
    for a in range(0, len(P), CHUNK):
        Pc = np.asarray(P[a:a + CHUNK], F32)
        free = np.ones(len(Pc), bool)
        for name, vol in volumes.items():
            claimed, survives, Q, start, length = _rays(vol, Pc, D)
            idx = np.nonzero(free & survives)[0] if gates[name] else np.zeros(0, np.int64)
            free &= ~claimed
            idx = idx[start[idx] < length[idx]]            # the march takes its first sample: steps > 0
            out["marched"] += int(idx.size)
            room = idx[Pc[idx, 1] > vol.y0]
            if room.size:
                c = np.floor((Q[room] - vol.grid_lo) / F32(vol.res)).astype(np.int64)
                iy0 = int(round((vol.y0 - float(vol.grid_lo[1])) / vol.res))
                below, above = (_sample_depth(vol, _alpha_at(vol, c[:, 0], iy, c[:, 2])) for iy in (iy0 - 1, iy0))
                out["wallFace"] += int(np.count_nonzero(below != above))
    return out
```

and add to `tools/relight/tests/test_windows.py`, directly above `if __name__ == "__main__":`:

```python
class WallFace(unittest.TestCase):
    def test_the_wall_face_rate_counts_marched_rays_whose_first_sample_straddles_unlike_cells(self):
        lo = np.array([0.0, -0.99, 0.0])                   # the wall face y0 = 0 is the boundary of grid rows 32 and 33
        occ = grid()
        occ[40:60, 32, :] = 0.5                            # x 1.20..1.80: the embrasure's first row, behind the wall face
        vols = windows.volumes_from_occupancy(occ, lo, RES, {"W": RECT}, 0.0, x_bearing=14.3)
        P = np.array([[1.5, 3.0, 1.5],                     # a room ray into the occupied row: marched, wall-face
                      [0.9, 3.0, 1.5],                     # a room ray where both rows are empty: marched only
                      [1.5, -0.1, 1.5],                    # a point in the embrasure: marched, never a room ray
                      [5.0, 3.0, 1.5]])                    # outside the outline: never marched
        open_, closed, fresnel = {"W": np.full(360, -90.0)}, {"W": np.full(360, 90.0)}, np.ones(101)
        steps = np.zeros(len(P), np.int32)
        windows.sun_visibility(vols, open_, fresnel, P, HEAD_ON, steps=steps)
        got = windows.wall_face_rate(vols, open_, fresnel, P, HEAD_ON)
        self.assertEqual(got, {"marched": 3, "wallFace": 1})
        self.assertEqual(got["marched"], int(np.count_nonzero(steps)))       # marched is sun_visibility's steps > 0
        self.assertEqual(windows.wall_face_rate(vols, open_, fresnel, P.astype(np.float32), HEAD_ON), got)
        self.assertEqual(windows.wall_face_rate(vols, closed, fresnel, P, HEAD_ON), {"marched": 0, "wallFace": 0})   # gate shut
        self.assertEqual(windows.wall_face_rate(vols, open_, fresnel, P, unit(0.0, 1.0, 0.3)), {"marched": 0, "wallFace": 0})
        occ[40:60, 33, :] = 0.5                            # the room-side row too: the two cells agree
        same = windows.volumes_from_occupancy(occ, lo, RES, {"W": RECT}, 0.0, x_bearing=14.3)
        self.assertEqual(windows.wall_face_rate(same, open_, fresnel, P, HEAD_ON), {"marched": 3, "wallFace": 0})

    def test_the_public_sample_depths_are_the_marchs_own_per_byte_depths(self):
        depths = windows.sample_depths(volume())
        self.assertEqual((depths.shape, depths.dtype), ((256,), np.float32))
        self.assertEqual(float(depths[0]), 0.0)
        self.assertAlmostEqual(float(depths[128]), -np.log(1.0 - 128 / 255) * 0.5, places=6)    # x step / cell = 0.5
        self.assertEqual(float(depths[254]), float(depths[255]))                               # alpha clamps at 0.995
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: PASS, 40 tests (Task 4's 38 and these two). Checked on 8 October against R1c Task 15's own re-implementation, on the real window volumes (`work/windows.npz`, the bytes the package carries), check-sun's 200,000 splats and its 88,831 floor points at the sunny morning's Sun and `moon_test`'s Moon: equal counts in all four cases.

- The floor's own rate (amended 8 October, re-review N3): floor rays cross the windows lower than splat rays do, so the same count is made on `check-sun`'s floor grid, the 88,831 points `cmd_check_sun` builds as `sets["floor"]` (`__main__.py:309-313`: x and y every 5 cm from 5 cm inside the hall's box, `z = FLOOR_Z + 0.02`; `sun-check.json`'s `points.floor`), at the same two directions. R1b Task 18 caps the floor texels' excuses with this rate and the splats' words with the splats'.
- Record `wallFaceRate: { splats: 200000, marched, wallFace, floor: { points: 88831, marched, wallFace } }` (each population's two directions pooled; a rate is `wallFace / marched`, and the sample size shows its noise) in the checks file, the manifest's `evidence` and the vectors' `windowRays`. If either `marched` is 0, stop and report.

Then, for the default package (or to the `--vectors` path), write `packages/web/src/lib/relight/__fixtures__/relight-vectors.json` in exactly the shape of `RelightVectorsSchema` (schema `venviewer.relight-vectors.v1`) defined in plan R1b's Task 4, `docs/superpowers/plans/2026-09-29-restored-hall-r1b-relit-browser.md`: read that block and the helper schemas above it before writing. Every key is camelCase as there, so `reference.py`'s `sky_level`, `sky_colour`, `lamp_levels`, `emitter_boost`, `sun_dir`, `sun_rgb`, `moon_dir` and `moon_rgb` become `skyLevel`, `skyColour`, `lampLevels`, `emitterBoost`, `sunDir`, `sunRgb`, `moonDir` and `moonRgb`; the lamp group keys stay `cove`, `ch_end`, `ch_centre`, `dome`. Write it with `json.dumps(..., allow_nan=False)`. Its fields, every one required:
- `schema`: `"venviewer.relight-vectors.v1"`; `sources`: the nine source names in record order.
- `encoding`: `{ sources: [[lo, hi] × 9] }`, the manifest's.
- `capture`: `{ weights: [9], colours: [[r, g, b] × 9], daylightColour: [r, g, b] }`, the manifest's (Task 4b's refit).
- `site`: `{ north, east, up }`, the manifest's (`sun_vec_e57(0, 0)`, `sun_vec_e57(90, 0)`, `[0, 0, 1]`).
- `sun`: `{ fresnel: [101] }` (amended 7 October: β and `skyFlux` are gone).
- `windows`: the five windows in order, each `{ id, frame: [21], alphaGz, horizon: [360] }`. `frame` and `horizon` are the manifest's; `alphaGz` is the base64 of the package's `windows/<id>.alpha.gz` bytes.
- `sampleDepths`: the 256 values of `windows.sample_depths(vol)` (the public table of the private `_sample_depth`, amended 8 October), the march's per-sample optical depth for each alpha byte, as floats. Every window has the same cell size: assert that the five arrays are equal, then write W1's. R1b's twin must compute the same table bit for bit.
- `skyBounce` (amended 7 October; it replaces `sunArea`): the factored basis's slice the kernel's tests need. `k`, `azimuth0`, `elevation0`, `step`, `size: [columns, rows]` and `grid: { origin, spacing, shape }`, the manifest's `sky`; `floorMean: [[r, g, b] × K]`.
  - `cases`: one per `windowRays` direction, in its order (nine): `{ dir: [x, y, z], powers: [5], azimuth, elevation, corners: [[row, column, weight] × 4], coefficients: [K] }`. `dir` is the direction as float32 values; `powers` is `reference.window_powers(model, dir)` (float64); `azimuth` and `elevation` are `windows.sun_az_el` of the float32 direction; `corners` are `windows.sun_corners(azimuth0, elevation0, step, (rows, columns), azimuth, elevation)` in its order; `coefficients` is `reference.body_coefficients(model, dir)`.
  - `nodes`: the four corner nodes of every case, as `cases[].corners` lists them, whatever their weights and the case's powers, each node once (numpy's `sunbounce.coefficients` reads a node only for windows with `P_w > 0`, so a dark case reads none, but R1b's `skyCoefficients`, its GPU coefficient pass and its debug check read all four corners of every case; at most 36 nodes, about 29 kB of base64 at K 30): `{ index: row × columns + column, values }`, `values` the base64 of the node's float32 little-endian `[window][k]` coefficients (5K values).
  - `fold`: one 0.5 m probe among the vector splats' trilinear corners whose eight 1 m corners all have positive weight (R1b asserts every corner's weight is positive and reads the basis at all eight; if no such probe exists, stop and report: there is no fallback, and in the hall's interior one exists: each splat's eight 0.5 m corners include one probe whose three indices are odd, which sits at the centre of a 1 m cell, so its eight 1 m corners each weigh 1/8 wherever all eight are valid), `{ probe, corners: [[index, weight] × 8], basis, rgb, cube }`: `probe` its global 0.5 m index; `corners` that probe's row of `sunbounce.trilinear_matrix(origin, spacing, shape, valid, reference.probe_points(model))` (its eight 1 m corners in the matrix's dx, dy, dz order, `index = (ix·ny + iy)·nz + iz` over the 1 m shape, zero weights kept); `basis`, for each corner of positive weight, `{ index, values }`, `values` the base64 of its float16 little-endian `[k][channel][face]` values (18K); `rgb` the `sunny_morning` setting's `sunRgb`; `cube` the 18 values of `reference.to_probes` at that probe of the first case's bounce (`sunbounce.bounce(basis, coefficients)` times `rgb`).
  - `probeCubes`: `{ sunny_morning, moon_test }`, each the list of every probe in `probes.entries` with that setting's sky bodies' bounce, `{ index, cube }`: `cube` the base64 of float32 little-endian `[channel][face]` (18 values) of `reference.sky_cubes(model, reference.sky_bodies(setting))` at that probe. (The kernel's vector tests take the folded sky bounce from here: the full basis and the patch rays would add 2 MB. The patch rays are held to `cases[].powers` against the staged package in R1b's Task 5.)
- `windowRays`: `{ suns: [[x, y, z] × 9], points: [[x, y, z] × 96], visibility: [[v × 9] × 96], steps: [[n × 9] × 96], wallFace: [[p, k] × n], wallFaceRate: { splats, marched, wallFace, floor: { points, marched, wallFace } } }` (`wallFaceRate` as measured above, amended 8 October).
  - The directions: the `sunny_morning` setting's `sunDir` first, then the five suns of `check-sun` (`CHECK_SUNS` through `common.solar_position` and `common.sun_vec_e57`), then two of `_random_suns(common, 2, SPLAT_SEED + 2)`, then the `moon_test` setting's `moonDir` (R1d amendment A8: nine directions).
  - The points: the 64 splats' positions, then 32 points of `check-sun`'s floor grid (5 cm spacing, `z = FLOOR_Z + 0.02`), drawn with `np.random.default_rng(SPLAT_SEED)`: 12 lit at the sunny-morning sun (visibility > 0.3), 12 marched but dark there (steps > 0, visibility < 0.01), and 8 whose first sample, at some of the nine directions, lies on the room side of the wall face `y0` between cells of unlike alpha (the `wallFace` cases below; if fewer than 8 exist on the grid, take all there are and record the number in the task report).
  - `visibility[p][k]` and `steps[p][k]` are `windows.sun_visibility(model.volumes, model.horizons, model.fresnel, points, suns[k], steps=...)`, as float32 values and integers.
  - `wallFace` lists every point–direction pair `[p, k]` with `steps > 0` whose ray starts in the room and whose first sample the bake puts on the room side of `y0`, where the cells on either side of `y0` hold unlike alpha. `y0` is exactly a cell boundary of the occupancy grid, so every marched room ray's first sample sits on it, and float32 rounding puts about 1% of them on the room side. For the owning window `vol` (the first window, in order, whose `windows.ray_survives` is true for that point and direction), compute in float32 exactly as `windows._rays` does: `P32 = np.float32(P)`, `s32 = np.float32(s)`, `tq = (np.float32(vol.y0) - P32[1]) / s32[1]`, `Q = P32 + s32 * tq`, the first cell `c = np.floor((Q - vol.grid_lo) / np.float32(vol.res)).astype(np.int64)` (grid indices), and `iy0 = int(round((vol.y0 - float(vol.grid_lo[1])) / vol.res))`. The pair is listed when `c[1] >= iy0` and the alphas at grid cells `(c[0], iy0 - 1, c[2])` and `(c[0], iy0, c[2])` differ (a cell outside the box reads 0).
- The gates must not hang on the last bit of an arcsine (numpy's and the browser's may differ there): for each of the nine directions and every window, assert that the direction's elevation lies more than 1e-6° from that window's horizon at its azimuth (`windows.sun_az_el` from the float32 direction, `windows.horizon_at`). Replace a random sun that fails with the next one `_random_suns` draws; the `moon_test` direction is fixed (R1d's A7 checked it above every window's horizon at its azimuth: 32.3° against 14–22°).
- `probes`: `{ origin, spacing, shape, entries }` on the package's global grid. `origin`, `spacing` and `shape` are the manifest's `probes`, never a local block around the splats (a splat outside the grid is clamped to the global grid's edge, and R1b checks hidden splats too). Each entry is `{ index, valid, cube }`: `index` is the global linear index `(ix·ny + iy)·nz + iz` over `shape`; `valid` is that probe's validity; `cube` is its 162 float16 values (`[source][channel][face]`, little-endian) in base64. `entries` holds every corner that each vector splat's trilinear lookup touches after clamping: all eight per splat, valid or not, as `reference.trilinear` computes them, each probe once.
- `presetsFromProof`: `{ night, sunny_morning, overcast_noon }`, as in the manifest.
- `settings`: `captured`, `night`, `sunny_morning` and `moon_test`, each `{ weights: [[r, g, b] × 9], skyLevel, skyColour: [r, g, b], lampLevels: { cove, ch_end, ch_centre, dome }, emitterBoost, sunDir: [x, y, z] or null, sunRgb: [r, g, b], moonDir: [x, y, z] or null, moonRgb: [r, g, b] }`. `emitterBoost` is 1 for every setting (R1d amendment A1); R1b compares it exactly. `moonDir` is null and `moonRgb` zero in the first three. `moon_test` is not a preset: every lamp at 0 (every lamp weight 0), sky 0, no Sun, `moonDir = common.sun_vec_e57(139.3, 32.3)` (the moonlit preset's full Moon) and `moonRgb` equal to `sunny_morning`'s `sunRgb` (a strong light, so the Moon's march, gates, glass and bounce are exercised above the clamp; R1d amendment A8). No setting carries `lampTints` (the kernel reads ones).
- `splats`: 64 finest-level splats chosen across classes (16 interior, 16 embrasure, 8 bulbs, 8 fixtures and cove, 8 sun-reachable floor, 8 hidden), each `{ record, position, colour, expected }`: its 12-byte record as 24 hex digits, its position (e57), its captured linear colour, and `expected` with `captured`, `night`, `sunny_morning` and `moon_test`, each `{ m: [r, g, b], alpha, word }` (`word` the packed uint32), computed by `reference.multiplier` with the full model (the sky bounce included) and no visibility. The eight sun-reachable floor splats are lit at the sunny-morning sun (`windows.sun_visibility` > 0.3). Every splat with the sun flag must keep its sunny-morning and `moon_test` visibility (within 1e-6) when its position moves 1 mm along +x, −x, +y, −y, +z or −z; replace one that does not with the next candidate in the seeded order. R1b finds these splats in the live draw by record and position and holds the GPU's words to them within one code, and the served positions and the GPU's float32 differ from the bake's by far less than 1 mm.
- `floorTexels`: eight texels of `<work>/floor-light.npz`, each `{ col, row, direct }` with `direct = D[row, col, :]` (the nine values in source order; `row` is the PNG row). Spread them over the floor (near the windows and under the lamps), so that every source is non-zero at some of them and no two sources have equal values at all eight. R1b decodes the floor PNGs at these texels (its Task 5), so a source written to the wrong channel fails there.

Keep it under 1,000 kB + 1.6 kB × max(0, K − 30) (raised from 800 kB on 7 October: the sky slice adds about 150 kB, mostly `probeCubes`; the volumes' gzip takes 261,376 bytes in base64; amended 8 October, re-review N4: the parts that grow with K, `nodes` (36 × 5K float32 in base64), `fold.basis` (8 × 18K float16 in base64), `cases[].coefficients` (9 × K numbers) and `floorMean` (K × 3), take about 1.6 kB per K, about 48 kB at K 30 and 304 kB at K 192, so a refit that lands at a larger K does not stop on size alone; anything else over the cap is a stop). Record `capturedIdentity`, `proofRegression`, `transfer`, `determinism`, `skyBounceCheck` and `wallFaceRate` in the checks file and, once every check has run, in the checked package's manifest `evidence` too: the manifest is rewritten with `package.write`'s own `json.dumps` arguments, each run replacing these six keys and nothing else, and they hold no time or other wall-clock value (check 4 removes exactly these six before it compares).

Step 8 runs it twice once the code is committed: `C:/Python313/python.exe -m relight check --config config/grand-hall.json`. Expected then: `checks.json` with all five `pass: true` and `wallFaceRate` (print each population's `marched`, `wallFace` and their ratio; on 8 October's window volumes, both directions pooled: splats 92,085 marched and 2,964 wall-face, 3.22%; floor 35,155 and 3,630, 10.33%), and the fixture written (print its size against its K's cap, the number of `wallFace` pairs and the `fold` probe's corner count). If a check fails, stop and report the numbers.

- [ ] **Step 8: Commit the code, then build, check twice and commit the fixture** (amended 8 October, the controller's ruling P1: the package is built only from committed code, and its `tool` is that commit)

```bash
cd D:/claude/real-hall/repo/tools/relight
C:/Python313/python.exe -m unittest discover -s tests 2>&1 | tail -3
cd D:/claude/real-hall/repo
git add tools/relight/relight/records.py tools/relight/relight/reference.py tools/relight/relight/package.py tools/relight/relight/__main__.py tools/relight/relight/windows.py tools/relight/tests/test_reference.py tools/relight/tests/test_records.py tools/relight/tests/test_windows.py
git diff --cached --stat
git commit -m "feat(relight): records for all 24 tiles, the reference multiplier with both sky bodies, the package and its checks (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
test -z "$(git status --porcelain -- tools/relight)" && echo "tools/relight clean at $(git rev-parse HEAD)"
cd tools/relight
C:/Python313/python.exe -m relight records --config config/grand-hall.json
V=D:/claude/relight/grand-hall/verify/task5 && mkdir -p $V
FIX=D:/claude/real-hall/repo/packages/web/src/lib/relight/__fixtures__/relight-vectors.json
PKG=D:/claude/splats/trades-hall/grand-hall/relight/v1
for run in 1 2; do
  C:/Python313/python.exe -m relight check --config config/grand-hall.json
  cp D:/claude/relight/grand-hall/evidence/checks.json $V/checks-run$run.json && cp $PKG/manifest.json $V/manifest-run$run.json && cp $FIX $V/vectors-run$run.json
done
C:/Python313/python.exe D:/claude/relight/grand-hall/verify/task4b/compare.py $V/checks-run1.json $V/checks-run2.json
cmp $V/manifest-run1.json $V/manifest-run2.json && echo "manifest identical"
cmp $V/vectors-run1.json $V/vectors-run2.json && echo "vectors identical"
C:/Python313/python.exe -c "import json; m = json.load(open('$PKG/manifest.json')); print('tool', m['tool'], m['createdAt'])"
cd D:/claude/real-hall/repo
git add packages/web/src/lib/relight/__fixtures__/relight-vectors.json
git diff --cached --stat
git commit -m "test(relight): the relight test vectors from package v1 (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the suite `OK` with 162 tests; the code commit; `tools/relight clean at <that commit>`; `records` as Step 6 expects (if it prints `FAIL: tools/relight has uncommitted changes`, something was left out of the commit: commit it and build again, never build around it); both `check` runs as Step 7 expects, `checks-run1.json vs checks-run2.json : parsed values equal`, `manifest identical` and `vectors identical` (the second run rewrites the six evidence keys with the same values and the fixture byte for byte); the manifest's `tool` is the code commit's hash and `createdAt` its committer time; then the fixture commit, which touches no file under `tools/relight`. On a difference between the two runs, a third run decides by majority (the PC's rule); a third run that agrees with neither stops the task.

### Task 6: The restored floor (floor skin v2)

**Files:**
- Modify: `tools/floor-skin/build_floor_skin.py`, `tools/floor-skin/README.md`

**Interfaces:**
- Consumes: `D:/claude/real-hall/renovation/floor/floor_restored_albedo_2mm.png` and `floor_restored_albedo_mask.png` (the prototype; same grid and mask as Arm C); the fitted floor albedo of Task 4b's refit (`<work>/fit.json`, `group_albedo_mean` for `floor`; its SHA-256 must equal `<evidence>/refit.json`'s `copied["fit.json"]` and its `model.name` must be `refit`; amended 7 October).
- Produces: floor skin v2 at `D:/claude/splats/trades-hall/grand-hall/floor-skin/v2/`: `provenance.kind = "restored-albedo"`, `provenance.arm = "R"`, the same `grid`, `plane`, `tiles`, `height` and `slab` as v1, and `colour.albedoScale` (the calibration factor, for R1b).

- [ ] **Step 1: Add arm R and the calibration**

In `tools/floor-skin/build_floor_skin.py`, add to `ARMS`:

```python
        "R": ("floor_R_restored_2mm.png", "floor_R_restored_mask.png", "Arm C restored: delit, evened, healed, refinished (renovation, T-639)")}
```

and an option `--albedo-luminance <float>`. With arm R it scales the texture in linear light so its mean luminance over the mask equals that value before the tiers are encoded, writes `"kind": "restored-albedo"` in `provenance`, and writes `"albedoScale": <factor>` in `colour`. Arms A, B and C are unchanged (`kind` stays `"measured-photographic"`). If the manifest schema in `packages/web/src/lib/floor-skin.ts` only admits `"measured-photographic"`, leave that file for R1b (which reads v2) and note it in the task report.

- [ ] **Step 2: Build v2**

Prepare the input folder that the prototype's README ("Plugging into the floor-skin package") describes: the restored PNG and mask under the arm R names, next to copies of the Arm C inputs' `floor.json` and `floor_height_resid_5cm.png`. Compute the target luminance from Task 4b's `fit.json` (the floor's albedo · (0.2126, 0.7152, 0.0722); the refit moves it, so it is read, never typed: the proof's `[0.342, 0.318, 0.348]` gave 0.3218), then run:

```bash
cd D:/claude/real-hall/repo
LUM=$(C:/Python313/python.exe -c "import json; f = json.load(open('D:/claude/relight/grand-hall/work/fit.json')); assert f['model']['name'] == 'refit'; a = f['group_albedo_mean'][f['groups'].index('floor')]; print(round(0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2], 4))")
echo "floor albedo luminance $LUM"
C:/Python313/python.exe tools/floor-skin/build_floor_skin.py --arm R --room grand-hall --floor D:/claude/relight/grand-hall/floor-R-inputs --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v2 --albedo-luminance $LUM
```

(`fit.json`'s `group_albedo_mean` is a list in `groups` order, `04_fit.py:288`; `floor` is its first group.)

Expected: v2 written; the builder's slab-mask check passes (the mask equals Arm C's); `floor-skin.json` (the builder's manifest name) shows arm R, `restored-albedo` and the scale.

- [ ] **Step 3: Document and commit**

Add arm R to `tools/floor-skin/README.md`: the restored albedo is not a photograph and needs live light (R1b), and the `?floor=matched` ratio does not apply to it.

```bash
cd D:/claude/real-hall/repo
git add tools/floor-skin/build_floor_skin.py tools/floor-skin/README.md
git diff --cached --stat
git commit -m "feat(floor-skin): arm R, the restored albedo calibrated to the fitted floor (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Stage, publish and record

**Files:**
- Create: `tools/relight/README.md`
- Modify: the day's session log under `docs/sessions/`, `docs/state/tasks.md` (T-639 row)

- [ ] **Step 1: Write the README**

`tools/relight/README.md`: what the bake makes (link the contract), the commands in order (`proof all`, `windows`, `check-sun`, `probes`, `floor`, `sun-bounce`; then Task 4b's house-light refit in its staging copy (`refit-house proof`; `refit` twice at the measured crown-tube weight and twice at each of `--w-crown 0` and `--w-crown 1`, each pair `compare`d; for each sensitivity run `install --tag`, the proof's `embrasure-room`, `embrasure-back` and `05_relight.py comp_house`, the copied render harness and `07_compare.py metrics`; then `install`, the same steps for the refit, `photo-gate`, a second render, `sensitivity`, `promote`) and its re-runs of `probes` and `sun-bounce`; `record-artifacts`; `skin-light` (R1c); `records`; `check`; amended 7 October: `sun-area` is gone), the double-run rule, the GPU-lock and D: rules, the packaging rule (exact named artifacts whose SHA-256 their evidence records), each step's time on this PC (from the logs), and how to publish.

- [ ] **Step 2: Teach the publisher nested package folders**

The relight package has subfolders (`tiles/`, `windows/`, `sky/`, `floor/`; `skins/` in v2), and `packages/api/src/scripts/publish-splat-tiles.ts --package` today collects only the files directly inside the version folder. Read the script's `--package` path and its test file `packages/api/src/scripts/__tests__/publish-splat-tiles.test.ts` first, then test first:

1. Add tests: a package folder with `manifest.json`, `tiles/a.relight.gz`, `windows/W1.alpha.gz`, `sky/basis.bin.gz` and `floor/light-0.png` publishes all five under the prefix with their relative paths (`<prefix>/tiles/a.relight.gz`); `.gz` objects are uploaded with `Content-Type: application/octet-stream` and no `Content-Encoding` (the browser gunzips them itself; a `Content-Encoding: gzip` header would make the browser decompress twice); `.png` gets `image/png` and `.json` `application/json`; every object keeps the immutable cache header the script already sets.
2. Run them and see them fail: `pnpm --filter @omnitwin/api exec vitest run src/scripts/__tests__/publish-splat-tiles.test.ts`.
3. Make the file collection recursive (relative paths with `/` separators) and the content types as above, changing nothing else.
4. Run the same command and see them pass; commit with explicit pathspecs.

- [ ] **Step 3: Publish both packages to R2**

The R2 credentials stay in `packages/api/.env`, so run this worktree's publisher script (the one Step 2 changed) with the working directory set to the shared checkout's `packages/api`, where the script reads `.env` in place, as I1a did; never copy `.env`. Use the flags `tools/floor-skin/README.md` documents for publishing a package version (`--package` with the staged folder and the R2 prefix); the publisher refuses to overwrite an existing version. Before publishing, check that the relight folder holds exactly the files its manifest names (the packaging rule, 7 October: a stray or stale file is never published):

```bash
C:/Python313/python.exe -c "import json, os; root = 'D:/claude/splats/trades-hall/grand-hall/relight/v1'; m = json.load(open(root + '/manifest.json')); have = {os.path.relpath(os.path.join(d, f), root).replace(os.sep, '/') for d, _s, fs in os.walk(root) for f in fs}; want = set(m['files']) | {'manifest.json'}; print('extra', sorted(have - want), 'missing', sorted(want - have))"
```

Expected: `extra [] missing []`. Publish `D:/claude/splats/trades-hall/grand-hall/relight/v1` to `splats/trades-hall/grand-hall/relight/v1`, and `…/floor-skin/v2` to `splats/trades-hall/grand-hall/floor-skin/v2`. Then check one file of each:

```bash
curl -sI https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/relight/v1/manifest.json | grep -iE "^HTTP|content-type|cache-control"
curl -sI https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/floor-skin/v2/floor-skin.json | grep -iE "^HTTP|content-type|cache-control"
```

Expected: 200, a JSON content type, immutable caching. (A floor skin's descriptor is `floor-skin.json`, which `tools/floor-skin/build_floor_skin.py` writes and `packages/web/src/lib/floor-skin.ts` reads; it has no `manifest.json`.)

- [ ] **Step 4: Record and commit**

Add a section to the day's session log: what was baked, the checks with their numbers (the sun check against the proof with its Moon coverage; the sky-body bounce's gate on its three draws, with K; the house-light refit's acceptance: data cost ratio, lamp ratio (the 140 lamps, the crown tubes' measured weight), the night photographs at stations 43 and 45, the crown tubes' sensitivity at w_crown 0 and 1; captured identity, proof regression, transfer, determinism, the sky bounce through the package), each artifact's SHA-256 (`evidence/*.json`), sizes and times, and the R2 paths. Update T-639's row in `docs/state/tasks.md` (R1a done; R1b next).

```bash
cd D:/claude/real-hall/repo
git add tools/relight/README.md docs/sessions docs/state/tasks.md
git diff --cached --stat
git commit -m "docs(relight): the Grand Hall light bake, its checks and where it is published (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin claude/real-hall
```

---

## Self-review notes

- Spec coverage: §4.1 sources, window volumes (amended 3 October), captured light and lamp colour (a colour per lamp group from the refit, never a constant; amended 7 October) → Tasks 2, 3, 4b, 5; §4.2 records, probes, window volumes, the sky bodies' bounce basis and manifest (including the data the browser needs to refuse a mismatched package: `tileSha256` and counts) → Tasks 1, 3, 4, 5; the Moon as a light source (3 October) → Tasks 4, 5; the centre chandelier's light → Task 4b; the floor's restored albedo and its light → Tasks 4, 6; §6 unit tests (codec, window volumes and their march, the sky-body basis, probes, the refit, reference) and the photo-anchored regression against the proof → Tasks 1, 3, 4, 4b, 5 (R1b compares with the photographs directly); §8 package size and build-PC rules → Global Constraints and Task 5; R1c's record classes, skins' light and package v2 → Tasks 4c, 5. The browser (§4.3, the §4.4 web units, §5 and the rest of §6) is plan R1b.
- The window-volume revision (3 October): the multiplier's V, `reference.py`, the package and the vectors all take the march from `windows.sun_visibility`; R1b's TypeScript twin repeats it in the same float32 order, and Task 5 Step 7's vectors give it the volumes, the per-sample depths and 96 points' rays at nine directions.
- The sky-body revision (7 October): both bodies' bounce is Task 4's factored basis everywhere (`reference.py`, the package's `sky` files, the contract's "The sky bodies' bounce", the vectors' `skyBounce`); P_w's float32 order is the Task 4 report's contract, which R1b's twin and GPU passes repeat.
- Packaging (7 October): every artifact the package reads is named exactly and checked against the SHA-256 its evidence records (Tasks 4c, 5); the folder published holds exactly the manifest's files (Task 7). Provenance (8 October): the package is built and checked only from committed code, its `tool` that commit (Task 5 Steps 6–8).
- The house lights (8 October): one lamp set for R1a and R1d, the table's 140 `high` and `medium` entries; the centre chandelier's crown tubes a second kind at a measured weight, with its sensitivity reported and a stop if the night photographs clearly prefer an end (Task 4b).
- Test counts (8 October): Task 4 as built 121; Task 4b 15 (136); Task 4c 6 (142); Task 5's `test_reference` 12, `test_records` 6 and `test_windows`' 2 (`wall_face_rate`, `sample_depths`; 162 after Task 5).
- The section "The multiplier" is normative for both plans and matches `reference.py` line for line.
