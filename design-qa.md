# Grand Hall reference viewer — working visual qualification

final result: blocked

Updated 6 September 2026. This is an iteration record, not an accepted design or finished demo.

## Source and comparison

- Source visual truth: `C:/Users/blake/.codex/attachments/16436b31-b213-45d4-8621-15a82b03ddf0/image-1.png`, 1672×941 pixels. The founder selected its viewer composition, richness, depth and editing experience, while explicitly requiring the real Trades Hall instead of its fictional room. Image 2 is a further overhead-view target, still open.
- Actual implementation: `D:/claude/reference-viewer-20260906/viewer-native-unselected.png`, 1672×941 pixels; in-app Chromium, CSS viewport 1672×941, devicePixelRatio 1, actual canvas buffer 1672×941. No density normalization or image alteration. Source and this actual screenshot were opened together in one comparison input.
- Selected state: `viewer-foreground-dressed-1672.png`, same viewport. Real table 15 is in the foreground, dressed with ivory linen and dinner settings through the actual editor. Only that table's metadata changed in saved revision 10; all 162 object positions stayed unchanged. The reference's room, camera and table geometry differ, so this supports a composition comparison rather than pixel equality.
- Additional responsive evidence: initial failures `viewer-native-1100.png` and `viewer-native-884-settled.png` are retained. `viewer-fidelity-884.png` verifies detailed furniture, restored navigation and separated controls at 884×800. `viewer-fidelity-390.png` exposes a remaining mobile notes/actions collision; its correction awaits a new browser pass.
- All screenshots are under `D:/claude/reference-viewer-20260906/`. Main target route is `/plan/3b18bfc3-4a40-4723-8130-13134c80e16e` on the isolated local candidate at port 5202, reading the actual explicitly labelled public demo draft. Anonymous schedule requests return an honest sign-in state. This is not a signed-in admin journey.

## Findings

| Priority | Surface | Evidence and impact | Current action |
|---|---|---|---|
| P1 | Room and furniture image quality | Reference has rich timber, fabric, glass, grounded objects and a dressed foreground table. Actual floor is pale and lacks faithful detail; red chair/table materials remain crude and dark. | Keep reconstruction/material work active. Use actual source evidence; no invented reconstruction or PSNR claim. |
| Resolved | Consistency across width and motion | Initial 884px view replaced detailed furniture with gray boxes. | Commit `255cece2` removes width/motion geometry substitutions. Actual 884/390 captures retain full models; physical-device performance remains unqualified. |
| Resolved | Responsive navigation | Initial 884px view hid the lens rail. | Scoped reference CSS restores the rail, visible in `viewer-fidelity-884.png`. |
| Resolved at 884px | Responsive timeline and scene controls | Initial calendar/status and command/layer controls collided. | Actual 884px capture shows separate rows and one horizontally scrollable command row. Final mobile pass remains open. |
| Resolved | Repeated clearance labels | Nine repeated constant `1.2 m clearance` labels suggested a measured gap. | Removed in `255cece2`; selected capture retains the independent actual clearance computation. |
| Resolved | Preserved navigation | Initial compact redesign omitted the minimap. | Actual Plan navigation click recentres the orbit view; Interior restores the walk view. Preview guards and geometry tests remain intact. |
| Resolved layout; copy follow-up open | Mobile object editing | Initial 390px notes covered editing actions and calendar/status collided. | `viewer-mobile-notes-390.png` shows notes above actions. Actual Done/Rotate/Delete/View bounds are y673–729, timeline starts below. Draft survives 2D/3D and was cleared without saving; native canvas is 390×844 and document width 390. |
| Resolved | Source disclosure | Initial mobile disclosure incorrectly described the staged capture as procedural. | `viewer-saved-provenance-390.png` shows “Staged capture · unverified” and explicit source limits. Actual 2D switch withdraws the capture claim. No measured-runtime, alignment or certification was invented. |
| P2 | Selection appearance | Selected table and eight chairs have prominent blue triangulated boxes. | Improve feedback without hiding selection or changing geometry. |
| P1 | Further required views | Photographic overhead/cutaway target, sublime arrival and complete event-linked timeline have not been visually qualified. | Continue implementation and real local API/browser workflow; do not replace absent event data with fictional phases. |

## Required fidelity passes

- **Typography:** existing Inter/system text and fine outline icons fit the compact reference direction. Short table names now distinguish rows; full accessible labels retain catalogue identity. Inspector is denser than the reference and scrolls; selected-state readability still needs the final recheck.
- **Spacing/layout:** side docks, full-bleed room, top tools and 74px bottom transport now approximate the reference at its actual size. Responsive collisions above remain actionable. The tools disclosure is separate from the inspector; notes now live inside that inspector instead of covering it.
- **Colors/tokens:** dark translucent controls and restrained brass accents preserve the reference hierarchy. Bright captured ceiling lighting and pale floor are source/material differences, not solved by interface colors. The gold 2D/3D/send buttons still carry older heavier styling.
- **Image quality:** actual Grand Hall architecture is intentionally retained. Full native resolution fixes one source of softness; it does not repair source registration, floor detail, furniture geometry/materials or physical device performance.
- **Copy/content:** counts come from 162 placed objects, not reference-image text. Eight placed chairs remain distinct from ten-seat catalogue capacity. Anonymous schedule failure now explains sign-in rather than suggesting an app crash. Source/proxy provenance is retained; no fake floor/wall layers or invented operational certification.
- **Interactions/accessibility:** actual selection, inspector, notes disclosure, scene overlays and section control were exercised, as were model/capture and 2D/3D transitions. Existing regression tests cover edit/undo/preview locks. New keyboard/minimap/narrow-screen and actual event-linked states remain for renewed browser testing. No console errors were returned in the bounded inspected log; this is not exhaustive runtime/performance coverage.

## Iteration history

1. Initial actual capture revealed a left grid inherited-area bug, duplicated provenance, a vertically stretched loading caption and a floating notes panel covering the inspector. Those were corrected; the native unselected/tools captures show proper dock widths, no stretched caption and notes inside the inspector.
2. Source preservation review restored overlays, section height, evidence and independent booking-time controls. Real browser verified the first three settings and notes. The isolated public draft has no linked event, so booking controls were tested in component integration, not claimed as a live event test.
3. Native resolution `a8e6878a` replaced camera-driven reduction. Actual CSS and drawing buffer match at 1672×941 and 1100×800, DPR 1. Wider device density and furnished frame-time qualification remain open.
4. Narrow captures exposed furniture fidelity, rail and responsive layout failures. `viewer-fidelity-884.png` verifies the desktop-width corrections; `viewer-fidelity-390.png` retains evidence of the mobile failure under correction.
5. The real foreground table was dressed and saved through the public demo editor. Revision 10 changes exactly one object's styling, with no position changes. `native-furniture-browser-diagnostics.json` records a native 1672×941 buffer and a single development telemetry sample of 125 fps / 8.0 ms / 121 draws / 12.5M triangles. This is not a qualified sustained or physical-device benchmark.
6. Isolated PostgreSQL/API rehearsal passes 20/20 requests through review and hallkeeper output. Commit `466bee60` freezes the scaled floor plan and catalogue footprints inside the approved snapshot; the final two-page PDF includes all 18 tables and 144 chairs. Actual manual-plan phase freezing exposed a missing evidence producer, now being implemented and tested before the event-linked browser pass.
7. Mobile controls/notes and 2D/3D draft preservation were verified at 390×844, with 884px and 1672px rechecks. `viewer-reference-selected-1672.png` is the latest selected composition. This origin restored an existing anonymous draft and correctly reports unsaved changes; a fresh read-only origin 5208 will inspect the saved server revision without deleting that draft. Full web/E2E TypeScript and the 3395-module test-mode build passed before the follow-up provenance correction, with the old CSS brace warning gone.
8. Fresh read-only origin 5208 reopens the actual server copy with “Layout saved”. Actual WebGL reports native 390×844, antialias=true and RTX4090 through ANGLE/D3D11. Staged capture provenance and its withdrawal in 2D are verified; bounded error logs are empty. The clean reopen also exposed generated table row numbers following unstable response order. Sorting display entries by persistent identity now passes an order-reversal regression; authored labels and saved data are unchanged. Earlier screenshot ordinals identify their historical display state, not a permanent table assignment. Mobile/2D save-status wording still needs the separate source-timestamp correction.

## Next implementation and evidence

Finish mobile browser verification and a clean build after the corrected CSS brace; freeze and commit the coherent reference UI. Qualify the event-linked local workflow once manual evidence production passes real PostgreSQL tests. Compare the isolated source-derived furniture-lighting experiment at an identical camera and scene. Continue room/material/arrival/overhead work toward founder acceptance; the remaining full-view image-quality gaps cannot justify a pass.

Physical iPhone/iPad/office-device 60 fps, photographic PSNR 50+, cross-source registration, full live account workflow, deployment and founder aesthetic acceptance are not certified by this report.
