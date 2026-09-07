# T603 Diary design QA — 7 September 2026

Final result: passed

This is an internal gate for the implemented light Diary and honest seven-day overview. It is not a claim of pixel equality, founder acceptance of the sublime, deployment, or physical-device performance qualification. The broader aesthetic and device targets remain open.

The previous [T596 viewer design QA](docs/reports/t596-design-qa-before-t603.md) is retained byte-for-byte. Its blocked visual acceptance is not superseded by this Diary-specific result.

## Visual truth and comparison

The founder selected the ivory/forest workspace reference (`codex-clipboard-f0e907f3-f358-46a7-ae9e-c81aeebdc6e4.png`, 1672×941) and the airy seven-day timetable reference (`codex-clipboard-afc41923-a7b1-429c-ad35-a219b472dbcd.png`, 1586×992). Their originals remain in the founder's local attachment directory, outside Git because the references include personal data.

Rendered route: `http://127.0.0.1:4410/diary?view=week&date=2026-09-07`.

Private evidence root: `D:/claude/venviewer-diary-redesign-evidence-20260907`.

The final comparison opened each source and its corresponding rendered screenshot together in the same tool result:

- Workspace source: `C:/Users/blake/AppData/Local/Temp/codex-clipboard-f0e907f3-f358-46a7-ae9e-c81aeebdc6e4.png`; implementation: `browser/viewport-1672x941.png` under the evidence root.
- Timetable source: `C:/Users/blake/AppData/Local/Temp/codex-clipboard-afc41923-a7b1-429c-ad35-a219b472dbcd.png`; implementation: `browser/viewport-1586x992.png` under the evidence root.

Both implementation captures use matching CSS dimensions and DPR 1; the source pixels and implementation pixels are equal in dimension, with no density rescaling. They show the light week view with the drawer closed. Content differs deliberately: a real local API serves 17 explicitly synthetic bookings across four actual room identities. The references' sample venue, extra rooms, guest counts and multi-day booking widths are not imported as venue facts. The combined direction uses the existing compact top navigation, not a second left sidebar.

Focused inspection used the native-resolution card/time/photo and attention-panel regions in the same comparisons, alongside DOM measurements in `browser/final-render.json`; these regions are legible without image upscaling. Raw screenshots and fixture responses remain outside Git.

## Comparison history

1. **P1: excessive room-row density.** `browser/first-1672x941.png` showed a roughly 562px first row and 151–206px cards because secondary client/guest data repeated in each narrow cell. The cards now prioritize title, exact times and state. Full title/client/guest details are present in accessible names, native hover titles and the opened detail panel. Every booking remains a separate visible button; no booking is hidden behind an unimplemented “more” control. `browser/compact-1672x941.png` records the first correction.
2. **P2: room identity floated halfway down a busy row.** Photos and names now align near the first booking. Large-desktop photos increased to 72×84px and use the supplied room-specific image derivatives. Unsupported room identities retain their name without an unrelated photograph.
3. **P2: small secondary type and an overlong attention column.** Card titles/times increased to 13/12px. Warning and check explanations now have explicit native disclosures and visible severity/counts; blocking conflicts remain expanded. The final viewport captures record the corrected state.
4. **Read-only interaction mismatch.** Hallkeeper inspection previously exposed editable controls and Save despite API-denied writes. Fields are now disabled, Save is absent, and Close receives/restores focus. The API authorization boundary is unchanged.

Root independently reviewed the final workspace comparison and requested no further source change before integration. The busy first row is still about 323px because it contains three actual same-day bookings; reference rows are about 110–125px and have different content. That remaining density difference is explicit and must not be presented as a pixel match.

## Fidelity surfaces

- **Typography:** Georgia display headings provide the reference's editorial hierarchy, with the existing application sans-serif for controls. Exact times remain visible. Long card titles use a two-line preview with full accessible text and an operable details panel. This is a deliberate readable-summary contract, not hidden duration geometry.
- **Spacing/layout:** warm sheet surfaces, restrained borders, 30px desktop gutters, a room-photo rail, seven equal day columns and a 254px attention panel. At 1024px the attention panels move below the board. Phone width uses a labelled internally scrolling week region; persistent page controls do not overflow.
- **Color/tokens:** ivory `#f6f5ed`, forest `#2f5947`, sage confirmation, pale-yellow pencil states and copper primary/review accents replace the old black/gold palette. Status text, boundaries and conflict labels supplement color.
- **Images:** actual supplied room photographs, with source provenance in the room-photo helper/assets commit. No generated substitute is represented as a room photograph. All four visible photographs decoded successfully at each tested viewport.
- **Copy/content:** existing booking kinds, option ranks, historical states, conflicts and real venue-local dates remain authoritative. New copy explicitly calls this view a booking summary and offers Day for the precise time scale. No sample source claims were copied into live inventory or bookings.

## Verification

- 178 affected tests passed across 16 files, including shared navigation. The 25 overview cases cover DST weeks, clock-change labels, half-open day membership, continuation/focus anchors and all booking states.
- Full web typecheck, including E2E TypeScript, passed. Diary ESLint passed after a preserved failed strict-null-check run. The final null-check correction also passed both affected component suites (13 tests).
- Actual local browser/API flow passed: save/reload/restore; a 15-minute Day booking measured 24px at 96px/hour; duration-preserving keyboard move and Undo; ink confirmation/cancel/move/Undo; historical inspection; conflict-to-booking focus; hallkeeper inspection; mobile drawer/internal week scroll; reduced motion. Original titles, rooms and times were compared through the API after restoration.
- Width checks at 1672, 1586, 1440 and 1024px found page width equal to viewport width and all seven columns fitting the board. At 390px, the page remained 390px wide and the 1157px week surface scrolled inside its 360px region. Screenshots, image dimensions and zero page errors are recorded in `browser/final-render.json` and `browser/flow-result.json`.
- This is a development browser against an explicit disposable local database, not production authentication evidence. Root owns the final combined production build and release.

## Remaining acceptance and polish

Busy-week density, display-font refinement, the broader Burkean sublime direction and founder aesthetic acceptance remain open. Physical iPhone/iPad/office-computer performance, 60fps and reconstruction PSNR are not established by desktop viewport emulation. These are not silently reduced requirements.

Integration checklist: preserve the sourced photo helper/assets and shell ancestors; cherry-pick the Diary change; run the combined release gates; rehearse the real account without importing synthetic fixture data; obtain founder visual judgment.
