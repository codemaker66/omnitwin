<!-- ChatGPT review of the fused-twin brief (D:/claude/fused-twin-2026-09-04/chatgpt-brief-2026-09-04.md), pasted by Blake 2026-09-04 late evening; kept verbatim for provenance. The path in this line was mangled by a printf escape when first written and corrected on 2026-09-05. -->
**Venviewer: second opinion on Claude's fused-room brief**

4 September 2026. Prepared for Blake and Claude. This is advice on the supplied brief, not an instruction to start its jobs. I reviewed the brief, project policies, current plans, relevant source code and primary technical sources. I did not independently reproduce the capture measurements, run training, modify application code or spend money. Proposed settings, budgets and acceptance thresholds below are experiments, not predicted results.

**My recommendation: keep the hybrid direction and gsplat, but change the order and the evidence gates.** First prove that a small replacement floor region improves the actual browser image. In parallel, establish a trustworthy training/export baseline from fewer, better images. Add other sources only when each demonstrably improves it. The best delivered room may remain a hybrid; a single fused splat need not beat every representation on every surface.

**1. Highest return: what I would change first**

| Rank | Move | Why it earns its place |
|---|---|---|
| 1 | Test one floor patch with the old floor splats suppressed | Directly addresses the defect Blake notices; establishes whether compositing works before building a whole-floor pipeline. |
| 2 | Fix the measurement protocol and trainer-to-browser comparison | Prevents optimizing a score or representation that never reaches the user. |
| 3 | Check LCC Creator Data and curate a spatially balanced training set | Potentially removes ingestion uncertainty and avoids spending most updates on redundant virtual views. |
| 4 | Reduce initial bytes and fix the asset delivery path | Produces visible benefit without waiting for reconstruction research. |
| 5 | Add E57, panoramas and Bright Walls through controlled comparisons | Finds their actual contributions and exposes alignment or lighting conflicts. |
| 6 | Try another trainer only against a working baseline | Makes the comparison interpretable and limits engineering diversion. |

The strongest overlooked tool is **LCC Studio Creator Data**. Current v2.3 documentation describes PortalCam raw/undistorted images, people/equipment masks, COLMAP camera parameters and an optimized LAS cloud in aligned coordinates. The international version is documented as free without separate entitlement. Check the installed build and an actual export; compare a small region against your custom package. This is a useful independent control, not proof the vendor export is better. It does not include inter-sensor calibration files. [XGRIDS documentation](https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.3.0/06-model-reconstruction.html)

Do not make XGRIDS-only training wait for Matterport registration. Likewise, the first XGRIDS photo-floor patch uses images already in the served frame and need not wait for Bright Walls. Move delivery work alongside these experiments. Transfer the required Grand Hall subset first; all 296 GB need not be on the GPU volume to learn anything useful.

**2. Trainer choice and settings**

Keep the working, pinned **gsplat MCMC** installation for the first controlled baseline. Upgrading everything now introduces another variable.

My starting experiment is 1,000–3,000 sharp views distributed across the whole hall, selected for coverage and useful detail. Sample by physical location, original exposure and camera/source, rather than generated filename count. Virtual views constitute about 83% of the current image list, so uniform image sampling strongly weights them. Mask people, equipment, lens rims and changed objects in the loss; blackening pixels is not the same as excluding them.

Start with batch 1, half-resolution images, SH degree 3, a 3M cap, normalized coordinates, and a properly scheduled 30k run. Evaluate at approximately 5k/15k/30k on a fixed small validation set. Extend to 60k if validation and browser appearance still improve. Keep higher-resolution detail refinement as a separate comparison. Batch sizes above one require compatible image shapes and collation: the present mix includes 2000×1500 and 700×700 images and variable sparse-depth arrays.

The proposed 300k command has a real scheduling problem. In the inspected gsplat 1.5.3 code, changing only `max_steps` leaves MCMC refinement ending at 25k. Its step-scaling helper also scales refinement and SH schedules. Use a deliberate full schedule, or base 30k plus an appropriate scaler; setting 300k and then applying scaler 10 requests 3 million steps. Inspect the resolved configuration before launching. [Pinned trainer](https://raw.githubusercontent.com/nerfstudio-project/gsplat/v1.5.3/examples/simple_trainer.py), [MCMC implementation](https://github.com/nerfstudio-project/gsplat/blob/v1.5.3/gsplat/strategy/mcmc.py)

Test reliable depth separately: no depth versus a weak, explicitly normalized depth term. The proposed 0.02 weight is a starting hypothesis, not a universal setting. Verify units, camera-space Z versus ray distance, occlusion, pixel scaling and confidence masks. Preserve thin chandeliers and reflective/glass regions from inappropriate surface constraints. Do not add a blanket normal loss until a floor/wall patch shows it helps.

The 2.48M initial points already sit close to a 3M cap. Inspect their useful coverage and outliers; compare initialization density before deciding that simply increasing the cap will help. For E57 initialization, voxel-filter validated structural surfaces and exclude spurious glass/reflection returns. Do not seed every raw point.

| Alternative | My disposition |
|---|---|
| 3DGUT | Best targeted research alternative if fisheye rectification demonstrably loses useful coverage or calibration fidelity. It is compatible with MCMC; these are not competing choices. |
| Postshot / fresh LCC reconstruction | One control using the same region and source set can be valuable. Compare exported results in Spark, not screenshots from different viewers. |
| Bilateral grid / modest exposure correction | Test before replacing the whole trainer when the second pass introduces photometric inconsistency. |
| WildGaussians / Splatfacto-W | Consider when controlled tests establish an appearance-change problem; account for what survives export. |
| 2DGS / PGSR | Test on problematic surfaces if the existing mesh is inadequate. Do not assume a surface reconstruction method improves the complete hall's appearance. |
| Hierarchical 3DGS | Defer for this single room; its main motivation is much larger datasets. Runtime LoD remains a separate need. |
| 3DGRT | Defer: a ray-tracing result does not establish equivalent appearance/performance in the current browser rasterizer. |

NVIDIA provides 3DGUT with MCMC configurations; gsplat incorporated 3DGUT in 1.5.2. The proposed ADR's suggestion that moving to 3DGUT necessarily loses MCMC is incorrect. [NVIDIA implementation](https://github.com/nv-tlabs/3dgrut), [gsplat release](https://github.com/nerfstudio-project/gsplat/releases/tag/v1.5.2)

Postshot documents importing existing COLMAP cameras and points. The research methods have different objectives and export requirements; none has demonstrated superiority on your hall. [Postshot import](https://activation.jawset.com/docs/d/Postshot%2BUser%2BGuide/Importing%2BImages), [2DGS](https://github.com/hbb1/2d-gaussian-splatting), [PGSR](https://github.com/zju3dv/PGSR), [Hierarchical 3DGS](https://repo-sam.inria.fr/fungraph/hierarchical-3d-gaussians/)

**3. Run one: XGRIDS appearance first, selective fusion afterward**

Use one XGRIDS pass as the appearance baseline. Then compare A versus A+validated E57 depth, A versus A+registered Matterport crops, and A versus A+Bright Walls. Combine winning additions afterward. Keep source balance and comparable compute budgets. If runs use different image counts, report updates, wall time and sampling policy rather than pretending equal step counts mean equal treatment.

Registering the E57 cloud does not automatically establish the poses of the separate 148 panorama files. There are 149 sweeps, and image identity, center, orientation and cube-face conventions need verification. E57 images have their own poses and association identifiers. Validate five Grand Hall panoramas spread across the room before expanding; include only verified Grand Hall imagery. [E57 Image2D definition](https://asmaloney.github.io/libE57Format-docs/d1/d28/structe57_1_1_image2_d.html)

Keep FPFH/RANSAC/ICP as a coarse alignment route, but strengthen acceptance. Report correspondence count, overlap, thresholds, residual distribution and independent landmarks at both ends and several heights. Your detailed plan includes fitness, which is useful, but nearest-neighbor RMSE still is not photographic alignment accuracy. At focal length 2000 px and distance 5 m, a 3 cm sideways error projects to roughly 12 px. It also spans six 5 mm atlas texels. A target around 1–2 px median on sharp overlap features at evaluation resolution is a reasonable initial photographic gate, with tails disclosed; it is not promised attainable. [Open3D ICP](https://www.open3d.org/docs/latest/tutorial/pipelines/icp_registration.html)

Check furniture, doors, lights, daylight and reflections across capture dates. An exposure model cannot repair geometry disagreement or make contradictory scene states simultaneously correct.

**4. Floor: replace the bad contribution, then compare sources**

An opaque plane under the intact splat is not a reliable replacement. Depth testing rejects splat fragments behind it; floor splats in front can still obscure it. Illustratively, ten overlapping alpha-0.3 contributions transmit only 0.7^10, about 2.8%, of the background. Actual accumulated opacity depends on the projection and must be measured. The installed Spark 2.1 material confirms transparent rendering with depth testing and no depth writing. [Spark renderer documentation](https://github.com/sparkjsdev/spark/blob/main/docs/docs/spark-renderer.md)

Make a 2×2 m patch and compare four candidates from three oblique viewpoints and a walking clip: vendor floor; photo plane underneath intact splats; photo plane with the corresponding floor splats suppressed; registered Matterport mesh/textures with that same suppression. Protect skirting, chair legs and nearby objects through a bounded mask. Start the already-aligned XGRIDS patch while Matterport alignment proceeds. If the existing Matterport floor wins once aligned, use it as the regional candidate before writing a whole-floor baker.

At 21×10 m, 5 mm/texel is 4200×2000, or 8.4MP. Uncompressed RGBA occupies about 33.6 MB, rising to about 44.8 MB with mipmaps. Those are memory allocations, not proof of 5 mm source detail. Compare 2.5/5/10 mm on the patch, then use measured texture compression and anisotropic filtering.

Choose source views by visibility, projected resolution, sharpness, incidence angle and consistent exposure. Avoid blindly averaging many slightly misregistered photographs: it can destroy the detail you are trying to recover. [Waechter et al., Let There Be Color!, ECCV 2014](https://download.hrz.tu-darmstadt.de/pub/FB20/GCC/paper/Waechter-2014-LTB.pdf)

A polished floor has view-dependent reflections. A static atlas freezes them, so inspect motion as well as stills. The existing floor splat is not automatically a valid reflection residual: it contains a base-color contribution too. A true residual needs to be fitted against the replacement base. Depth-supervised retraining is a useful parallel experiment, but it cannot create photographic detail missing from the inputs.

**5. Walls: test the panorama hypothesis directly**

Rebuild one wall zone using XGRIDS-only, panorama-only and combined inputs at comparable budgets. Include gilt lettering, a plain wall area and a window edge in the evaluation. The remembered result suggests where to look; it does not establish which ingredient caused the improvement.

Cube-face crops are a sensible pinhole ingestion path once their poses are verified. They add directions, not independent camera centers. Start with source-balanced sampling and a consistent displayed lighting condition. Add exposure compensation only when the combined result shows a photometric problem after alignment is sound.

Appearance-conditioned training has an export obligation. Splatfacto-W documents selecting a camera appearance during export; a better conditioned training render need not equal a better portable splat. The inspected gsplat `app_opt` PLY path bakes an appearance and exports SH0 only. Always evaluate the actual browser export separately. [Splatfacto-W](https://github.com/KevinXu02/splatfacto-w), [WildGaussians](https://wild-gaussians.github.io/), [gsplat trainer](https://raw.githubusercontent.com/nerfstudio-project/gsplat/v1.5.3/examples/simple_trainer.py)

**6. Delivery: budget bytes and frame time, not just tile size**

The current generated manifest contains 106,893,914 bytes for the sharp room plus environment: 106.9 decimal MB, or 101.9 MiB. At 20 Mbps, its ideal transfer floor is 42.8 seconds. Including the 7,226,379-byte preview makes roughly 45.6 seconds of data. This excludes application loading, latency, decoding and GPU upload. The brief mixes MB and MiB. [Generated manifest](C:/Users/blake/omnitwin2/packages/web/src/data/generated/trades-hall-splat-bundles.ts:109)

Four concurrent 4 MB requests share the same 2.5 MB/s connection: the group takes roughly 6.4 seconds at the ideal rate. Smaller chunks improve prioritization and earlier useful completion; they do not remove the total-byte limit.

My order: a roughly 1–3 MB navigable starting representation; direct R2 custom-domain delivery with correct caching/CORS; current-view and likely-next-view refinement; then measured rechunking and format comparisons. Cloudflare documents custom-domain caching and distinguishes it from the development endpoint. A small photographic loading image can arrive sooner, but count it separately from a usable 3D room. First usable view in 3–5 seconds is an experiment target, not a measured result. [Cloudflare public-bucket delivery](https://developers.cloudflare.com/r2/buckets/public-buckets/)

Avoid rendering complete coarse and fine copies together after replacement, and account for their combined peak memory during transition. The repository already has a Spark RAD experiment; its recorded complete payload was larger than SOG, so do not switch formats on streaming terminology alone.

There is a concrete compatibility trap: current PlayCanvas documentation says its default SPZ export is v4; Spark v2.1.0's decoder explicitly accepts only v1–3. Pin a compatible encoder/version and test a real artifact before conversion at scale. [PlayCanvas SPZ](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/spz/), [Spark v2.1 decoder](https://raw.githubusercontent.com/sparkjsdev/spark/v2.1.0/rust/spark-lib/src/spz.rs)

The detailed W7 plan already says PLY to SOG, unlike the brief's vendor-octree wording. Preserve that simpler supported export route; proprietary LCC2 authoring is not a prerequisite.

Measure a representative office integrated GPU early, plus the Apple devices required by the latest project amendment. Record resolution, p95/p99 frame times, input response, stalls, memory, cold loading and warm loading. 60 fps means a 16.7 ms frame budget; 176 fps on the 4090 does not establish it elsewhere. LoD must pass the same appearance requirements at the intended display conditions. A permanently blurrier device tier would not satisfy the current founder amendment.

**7. Biggest risk and the cheapest tests that expose it**

The largest risk is attributing failure to insufficient training while pose, masks, sampling, appearance or export still limit the result. The proposed zone experiment supports trainability; because coverage, sampling and cap changed, it does not isolate the sole cause.

The first-run report says PSNR 13 was measured at 7k steps and the run stopped near 14.4k. The 0.17-pass calculation belongs to 7k/41,737. A completed 30k run would be 0.72 passes over the total list, or about 0.82 over the reported training subset; 300k would be about 8.21 training passes. [Local diagnosis](C:/Users/blake/omnitwin2/docs/reports/foundry-first-run-diagnosis-2026-09-04.md)

Before a long run, deliberately overfit a small clean patch, and compare its native trainer render, uncompressed exported PLY in Spark, and compressed delivery artifact. This separates training problems from export/renderer problems. Undoing normalization must preserve the spherical-harmonic direction basis as well as positions and covariance. Verify this with render comparisons, not only an overlay of Gaussian centers.

The optional external-depth adapter also needs review before use: `venviewer_training/colmap_depth_dataset.py:97` looks up `parser.image_names[index]`, whereas upstream dataset indices are split/remapped. Check that it selects the correct image, scales metric depth into normalized coordinates and is actually wired into the executed trainer. This is a prospective integration finding, not evidence it caused the previous run. [Adapter](C:/Users/blake/omnitwin2/venviewer_training/colmap_depth_dataset.py:97)

Strengthen W1 before relying on its scores:

- Preserve full camera rotation, including roll, and calibrated intrinsics or an exactly derived crop. Yaw/pitch alone need not reproduce a photograph's pose.
- Keep reconstruction-at-source-view scores separate from truly held-out novel-view scores. Exclude every sibling crop from the same exposure and nearby capture groups from training when reserving a test view. The vendor's training split may be unknown.
- Use fixed color processing and masks. Report raw scores separately from any reference-fitted exposure correction. Segment actual surfaces; horizontal bands alone mix floor, walls and objects.
- Retain six review viewpoints, a larger fixed validation set, and walking clips. Check lettering, chandelier edges, specular motion and missing coverage; six stills cannot certify the entire room.

Do not silently redefine PSNR 50 as a promise of photographic quality. For normalized pixels it implies RMSE about 0.00316, or 0.81 on an 8-bit 0–255 scale. Even a fixed viewpoint does not ensure this amid calibration, noise, compression and exposure differences. Record source-view, held-out-view and export-fidelity protocols separately.

The project's claim that no real-room radiance field has exceeded 30 dB is false: the original 3DGS paper reports 30.632 for room, 30.317 for kitchen and 31.980 for bonsai on its benchmark. Those do not predict performance on the Grand Hall, but they invalidate the supposed universal ceiling. [Original paper, Table 5](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/3d_gaussian_splatting_low.pdf)

**8. Three-week sequence and hypothetical $300 allocation**

At the supplied $3.49/hour rate, $300 is approximately 86 GPU hours, before other charges. At an assumed sustained 45 iterations/s, 300k steps is 1.85 hours, about $6.46 before evaluation/setup. Measure throughput near the final Gaussian count and resolution before using that as a quote. Engineer time and experiment discipline are likely scarcer than GPU hours.

| Period | Work and decision gate |
|---|---|
| Days 1–3, September 5–7 | Protect the Monday demonstration and existing freeze. Offline: establish camera/split/export checks, inspect Creator Data availability, select clean patch and whole-room keyframes, measure an office device. Start no architecture migration. |
| Days 4–6 | Run the floor patch comparisons; XGRIDS 30k baseline and small overfit/export control; compare vendor-provided inputs if available. Diagnose failed gates before extending training. |
| Days 7–10 | Complete verified E57/panorama mapping; depth-only, panorama-only and Bright-Walls-only additions to the baseline. Change one ingredient per comparison and combine demonstrated wins. |
| Days 11–14 | Finish the winning regional hybrid; improve initial-byte delivery; evaluate SOG against a compatible alternative. Test one targeted trainer challenger only if a remaining failure justifies it. |
| Days 15–18 | Repeat the winning recipe on the Grand Hall, refine the highest-value detail, validate motion and target devices. Reject improvements that disappear after export or damage another critical region. |
| Days 19–21 | Roll the established recipe into the most valuable additional rooms, with per-room checks. Process all seven if the pipeline and quality gates permit; otherwise report completed rooms and unresolved exceptions rather than claiming automatic success. |

Suggested budget ceilings: $20 ingestion/smoke, $40 baseline/controls, $60 fusion comparisons, $25 optional challenger, $55 final/other-room runs, $100 reserve. These total $300 and are spending limits, not a target to consume. Use early checkpoints and stop runs that reproduce a known failure. The existing $60 programme/$25-per-run policy is not changed by this hypothetical review.

**Handoff:** the review is complete. Code changes and new GPU results: none. Verified here: source-code/configuration pitfalls, official tool capabilities and the calculations above. Still unverified: actual Creator Data availability on Blake's installation, capture alignment, attainable image quality and performance on the required devices. The next implementation task I recommend is the calibrated floor-patch comparison plus trainer/export control, not the full 300k fused run.
