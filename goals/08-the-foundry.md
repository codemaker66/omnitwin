# 08 · The Foundry — own the reconstruction, then the research frontier

## The /goal block

Own the reconstruction of the Grand Hall and then every room: land the sources on the pod (W2) and run the training (W7) exactly as docs/plan/14 writes them, within the money caps, judged at the court; register every source to the served frame (Bright Walls, the E57 with its 49 sweeps, the 148 native 8K panoramas as pinhole crops); produce the first real Trades Hall chair and table through the Item Foundry; then run the research frontier one decisive experiment at a time, each with a pinned baseline, a falsifiable hypothesis, a compute estimate, a stop condition and a verdict of adopt, revise or park. Every technology from NVIDIA or a research lab is verified from its primary source and its licence before it is used; a name in the vision's register is a candidate, never a dependency. Generated detail is labelled generated, with lineage, and never becomes heritage fact.

## Outcome, in Blake's words

"we aim for psnr 50+"; "new paradigms, new techologies, new tools, no pipelines and workflows, we will use what is already built out in the web by people like nvidia and other research labs and combine their tech together and create our own novel discoveries and tech"; "if you need money you will have it, if you need compute you will have it"; "You have full permission to use all our data in whatever manner you want including deconstructing and reverse engineering anything you may find".

## Where we are (GOAL.md §2)

The RunPod H100 pod trmciz4jo6yf6m is stopped ($3.49 an hour running); the volume omnitwin-foundry (500 GB) keeps /workspace with the venv and the real pycolmap. The first Grand Hall run reached PSNR 13 because it was starved (0.17 passes over 41,737 images); a 1,023-frame zone reaches 20 dB in 7k steps (docs/reports/foundry-first-run-diagnosis-2026-09-04.md). The T-502 package at D:\claude\colmap-gh\hall-t502 has 7,178 undistorted pinhole frames with binary PINHOLE cameras, verified by reprojection. The R2 upload of about 157 GB of sources is in flight. Nine vendor builds; Bright Walls in its own unregistered frame; the E57 at F:\E57 (hall = sweeps 0–48); the 148 8K panoramas; the Matterport OBJ. state/training_runs.jsonl has zero lines; the first run fixes that. The Foundry audits (T-506, T-526) left four HIGH schema bypasses to harden. Caps: $60 across the ladder, $25 a run, the pod stopped every session, ask beyond.

## Decided (docs/plan/13 and 14 §1)

Train normalised, save Parser.transform, invert on export; at least seven passes over the images; a held-out set of a few hundred views; panoramas enter as pinhole crops; Bright Walls is evidence, not a blend; the court judges; a candidate is called "fused" only when its receipt proves more than one source was trained on; "PSNR 50" is stated with its protocol every time (goal 02 D6). The data authority is owner-stated and project-specific (the vision §46); third-party code and weight licences are checked separately.

## The research register, with gates

Each row is a candidate until its gate is passed: the primary source read, the licence recorded, the decisive question answered on our data against a pinned baseline.

| Candidate | Decisive question | Gate |
|---|---|---|
| Depth supervision from the registered E57 (DN-Splatter style) | Does LiDAR depth fix the floor and thin structures in held-out views? | Held-out PSNR and the court's floor band against run 1 |
| 3DGUT / 3DGRT (NVIDIA) | Do unscented projections keep quality at the fisheye edges and under distortion? | Same package, same steps, same held-out set; delivery to Spark proved |
| Anti-aliased rendering (Mip-Splatting family) | Does it remove the shimmer on the gilded names when moving? | Temporal path score in the court |
| MCMC densification (already in gsplat) | Is the budgeted primitive count better spent? | Same-count comparison |
| Neural Harmonic Textures | Does higher-capacity appearance beat spherical harmonics on the gilding and glass? | Only if the master survives export to a browser representation with measured loss |
| Generative repair (Difix3D+, NVIDIA Fixer, GSFixer) | Can the weakest court views be repaired without inventing heritage? | Labelled generated; region masks; never fed back as evidence |
| Relighting (GR3EN, inverse rendering) | Can daylight, evening and gala states be presented coherently? | Presentation states only; never lighting-engineering evidence |
| Hero volumes | Can the chandelier and the name boards live at higher fidelity without seams? | Seam, occlusion and memory tests; transition at a measured distance |
| SOG, SPZ, streamed formats | What does each cost in measured loss? | Separate error accounting (goal 02 D7 step 5) |
| Learned matching (VGGT, MASt3R) | Can the fisheye slots be registered where SIFT fails? | Pose accuracy against the XBAG pose file (1.4° and 12 cm median today) |

## The work, in slices

F1 W2: the sources on the pod (after the upload plateaus; one pod hour; cap $5), checked with rclone, the pod stopped, recorded in docs/operations.

F2 W7 run 1 (cap $25): XGRIDS pinholes only, named honestly (gh-owned-run1), normalised, 300k steps, the transform saved and inverted, judged at the court, served behind `?twin=fused` on a preview. The first row in state/training_runs.jsonl: run id, date, source package and its hash, steps, passes, cost, PSNR with its protocol, artifact path.

F3 Run 2 with depth from the registered E57 (after goal 02's W4), cap $25.

F4 The panoramas as pinhole crops (after W4), and the panorama-only walls Blake remembered, rebuilt and judged.

F5 The Item Foundry's first two items (R4): one chair and one table from HUMAN.md 2's photographs or a phone capture, reconstructed (RealityScan or Metashape, or a verified AI candidate), cleaned in Blender, exported as GLB with measured footprint, pivot, materials and levels of detail; instanced in a 180-seat layout on the device matrix; recognised by Elaine.

F6 A hero volume for the chandelier, from the existing frames first, recapture only if the court says so (HUMAN.md 12).

F7 Generative repair on the three worst court views, labelled, with masks, compared by people.

F8 Relighting presets for event phases, presentation-only.

F9 The operator experience (plan 15 G8): beginner and expert modes, once two runs have reproduced; ingest, inventory, alignment, run, cancel, retry, resume, review, publish, roll back; qualified on Windows, macOS and Linux; provider independence proved by a second execution path.

F10 Harden the four HIGH schema bypasses from the Foundry audit.

## Money

A slice names its cap before the pod starts. Every start and stop is logged with its reason. A table of spend per experiment lives in docs/reports/foundry-spend.md. Beyond the caps, HUMAN.md 11.

## Done when

An owned Grand Hall beats gh2-vendor at the court on the floor band and the whole frame and is served behind the flag at goal 02's gates; two runs are reproducible from their receipts; one real chair and one real table are in the catalogue; the register has verdicts, not names; the pod is stopped.

## Verify

```
python tools/court/judge.py --candidate gh-owned-run1
wc -l state/training_runs.jsonl
node packages/web/scripts/splat-drag-budget.mjs --room grand-hall --twin fused --layout 180
```

## Forbidden

Training without the decisions plan 14 requires. Spend beyond a slice's cap. A candidate named "fused" without proof. Printing a secret. A generated detail presented as observed. Reading an unverified third-party licence as permission. Leaving the pod running.

## Human inputs

HUMAN.md 2 (item photographs), 7 (DNS, shared with goal 02), 11 (compute beyond caps), 12 (recapture).

## Unlocks

Goal 02's beauty gates; goal 03's real furniture; goal 10's second venue gets a repeatable capture-to-room recipe.
