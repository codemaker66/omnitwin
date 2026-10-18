# R1a re-aim: relight the photo-trained 3D hall (T-639, 18 October 2026)

**Decision (Blake, 18 October):** re-aim the relighting from the old XGRIDS scan to the photo-trained 3D hall now (the
option he chose showed about 4–6 days and $15–25 of cloud compute). **Budget:** T-639's RunPod cap is $45 in total, about
$15.3 spent; check the balance before any pod and keep it above $15 after the planned spend.

**Why:** the old scan's floor and walls are hazy and stained ("2/100", 18 October), and the whole R1a package (Tasks 1–5)
was built on it. The photo-trained hall (pano lane, `D:/claude/pano-splat-20261003`) is the forward splat.

## What carries over and what does not

Mapped from the code (18 October dependency map; the frame claim checked against the pano lane's DESIGN.md and
`build_dataset.py:11,94,213`).

- **Carries over unchanged.** The new hall is trained in HallFrame, the old tiles' own frame (same
  `canonical_frame.json` transform), so the room box, windows, E57 occupancy, the window cookie, the probe grid and keep
  mask, the patches, the dome ring, the chandelier volumes, the bulb table, `windows.npz` and the floor light's geometry
  carry over. The radiosity, sun-bounce, window and reference code carry over.
- **Must be redone.** The proof's fit regresses the scan's own colours (`proof/04_fit.py:96-122,228`), so its albedo
  `rho`, light weights, `E_cap` and everything downstream of them are capture-specific: the bases per splat, the Fresnel
  term, the embrasure rows, the proof's multipliers (the check-2 oracle), the probes and the sky-body bounce (fed by
  `rho`), the records, the package and the checks.
- **New code.** A reader for the photo-trained hall (PLY: logit opacity, log scales, SH degree 3, two base colours), the
  per-state lamp/daylight measurement, a two-state fit, two captured states in the multiplier rule and the package, and
  the link from relight records to however the pano lane packages the hall for the product (it is one 8.4M-splat master
  today, not served tiles).

## The new capture is two light states, and that is the test

The photo-trained hall has one geometry and two base colours: day (sweeps 0–25) and evening (26–47). This changes the
work and gives it an honest outside check:

1. **A joint fit.** One albedo (physical) shared by both states, separate light weights per state. Two light states pin
   the lamp/daylight split that a single capture could not (the old fit's centre chandelier collapsed to ~1e-11).
2. **Relighting tested on real data.** Fit on the day state, relight it to the evening light, and compare with the
   captured evening colours per splat class, on held-out stations. That measures how true the relight is, not only how
   closely it reproduces the proof.
3. **The nearest captured state as the base.** Night starts from the evening capture, daytime settings from the day
   capture, so the multiplier stays near 1 where it can. This is expected to cure the glowing night curtains (the
   evening capture saw them without daylight behind); verified, not assumed.

## Steps

| # | Step | Kind | Gate |
|---|---|---|---|
| 0 | The pano lane names the forward model file (and SHA-256), the floor skin and its states, and the product presentation (grade and views); packaging plan agreed with it | inputs | its message; SHA verified |
| 1 | Alignment check: the hall's wall planes and floor against `hallE57` and `FLOOR_Z` | check, PC | residuals within 2 cm, or a recorded correction |
| 2 | Reader and tables: positions, normals, scales, opacity, the two base colours, SH policy | new code, TDD | double run identical; counts equal the PLY's |
| 3 | Classes: rerun geometry with thresholds retuned to the new density and opacity statistics | rerun + tune | class counts reported; diagnostic class renders checked by me (never shown to Blake) |
| 4 | Bases and Fresnel per splat, reusing the probe grid, patches, cookie and ring; both states' capture times from the sweep metadata | rerun | as Task 2's gates |
| 5 | Lamp/daylight ratio per state; the joint two-state fit; the day-to-evening relight test on held-out stations | new design | residuals per state; the relight test reported per class |
| 6 | The multiplier rule with two captured states (base per setting), plus rules for the look defects the new capture does not cure (back-lit window splats, unlit chandeliers, the floor streak); R1a's normative text, the package contract and R1b's plan in lockstep | design + code | the identity check passes for each captured state; unit tests |
| 7 | Rerun the chain: embrasure rows, the proof's multipliers, the house refit per state, probes and sun-bounce (K re-measured only if the gate fails at K 80) | rerun | Task 4/4d gates |
| 8 | Records, package and checks with two states, on the pod, run twice | rerun + new fields | checks pass; runs identical |
| 9 | Relit frames through the pano lane's product presentation (4090 slot), look review against the as-captured frames | render | only beautiful frames reach Blake, each beside the as-captured view |
| 10 | Reviews: spec, an independent number check, and the frames' look | review | — |

## Findings from steps 0-2 (18 October)

- **Step 0 (the pano lane):** the forward model is `runs/final_2state150k/out` (day PLY sha `4a5623ad…`, 8,375,174
  splats; evening base colour `evening_f_dc.npy`, sha `f25486cf…`). The floor was trained as an opaque skin, so the
  model has almost no floor splats (1,576 within 10 cm): the fit's floor group comes from the skin's texels, and the
  relight uses the pano lane's unlit restored floor albedo, never its lit showcase skin. The presentation is the pano
  lane's `viewer/` with its capture grade and five named views.
- **Step 1 (alignment):** the frame is confirmed. The floor plane lands within 1.4 cm of `floorZ`; three walls agree
  with the old scan within 1.8 cm. On the y1 wall the new hall's surface sits 4–8 cm deeper (median +7.6 cm beyond
  the box face, old scan +0.5 cm). The relight models no occlusion there, so the effect is limited to the patches and
  the cove light at that wall; which surface is real goes to the pano lane's LiDAR before step 5.
- **The facade bearing:** the proof uses 104.3° for the window wall's outward normal; the planner's sun work measured
  101.1° true from LiDAR (±1°). A 3° error moves every sun patch on the floor. Step 4 re-derives it from the E57 and
  corrects the config with that evidence.
- **Step 2 (reader):** `relight/plyread.py` (f4af5cc6) reads the PLY into the old extractor's tables plus the evening
  colour; `config/grand-hall-pano.json` and `proof/01_extract_ply.py` (the model's SHA-256 checked) run it into a
  separate work folder, `D:/claude/relight/grand-hall-pano`.

## Cost (honest)

- **Work:** about **7–10 days**, more than the 4–6 days in the option Blake saw. The two-state fit and rule (steps 5–6,
  about 3–4 days) and the packaging link are new work the first estimate did not count.
- **Cloud:** about **$10–25** of RunPod at $3.99/h: the final records and double check about $6, a probes and sun-bounce
  re-bake $3–5, the K re-measurement only if needed about $7. Otherwise uploads dominate: the PLY is about 2 GB, and a
  link the pod can download from directly would save most of that time. Within the $45 cap.
- **Risk:** the new capture's lamp states, capture times and window content are not yet known (the photos clip windows
  and lamps), and the pano lane has no packaging yet. Steps 0 and 1 settle those before anything is spent.
