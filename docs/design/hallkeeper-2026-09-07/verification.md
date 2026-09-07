# T-606 delivery evidence

7 September 2026 · Research/design delivery only

## Delivered

- [Full workflow and proposed implementation contract](workflow.md): lifecycle, contact exchanges, screen family, physical work, changes, cover, handover, print/offline, failure behaviour, source-inspected integration gaps, delivery order and field acceptance.
- [Master image direction and eight copyable prompts](image-prompts.md): day sheet, room setup, change review, phone/offline, deliveries, break cover, A4 print and venue memory/work order. Blake generates the images.
- [Unmodified supplied visual reference](style-reference.png), hash checked against the original clipboard file.
- Interactive conversation concept at `C:/Users/blake/.codex/visualizations/2026/09/07/01a07bad-cdd7-72f2-88e3-2ff82e1fe7fe/hallkeeper-day.html`. It is a 27 KB fragment with local illustrative interactions, not an application integration.

## Review and verification

Three bounded independent agents researched venue operations, proposed workflow improvements and inspected the existing product. A subsequent independent review corrected decision-owner wording, a break/collection collision, overly broad asset quarantine, missing lone-worker close support and inconsistent revision notation. Root inspected the resulting files and confirmed the legacy schedule fallback in source. No staff interviews occurred.

Playwright CLI exercised the locally rendered concept in Chromium. The first scenario run completed 18 assertions covering pending versus current guest count, local change preparation, Escape/focus restoration, task progress without room release, note retention during the open preview, room selection, twenty-table setup, handover without assumed acceptance, overflow at 1024/736/390/360 CSS pixels and drawer horizontal fit. The initial run captured no page runtime errors.

Visual inspection then found that the original tall mobile drawer could open outside the visible viewport even though its DOM visibility and horizontal-fit checks passed. The retained `change-mobile.png` records that failure. The drawer was changed to remain in the viewport, its focus movement was corrected, and a mobile attention shortcut and better next-action wrapping were added. Targeted reruns at 390 and 360 CSS pixels passed overflow, attention opening and actual dialog-title viewport checks. Root viewed the final mobile day and change images, plus desktop day, change and setup captures. These are browser viewport checks, not physical-phone qualification or founder aesthetic acceptance.

Scripts and screenshots are under `output/playwright/hallkeeper-2026-09-07/`, including `check.cjs`, `mobile-check.cjs`, `final-desktop.png`, `final-mobile-390.png` and `final-change-mobile-390.png`. The task-owned renderer used loopback port 8846. Setup failures included blocked file-URL navigation, a missing screenshot directory and an overwrite requiring the renderer's explicit force option; each was resolved locally. One later full-load navigation timed out on external wrapper dependencies. Switching the check to DOM-ready navigation let the actual fragment run; the standalone renderer also recorded an intermittent unpkg Floating UI load/bootstrap error. The fragment does not import or use Floating UI, and these checks do not certify the renderer's external CDN availability.

The Markdown files have balanced fenced blocks, no trailing whitespace and no broken local links. The fragment is below the 1 MB limit, uses literal markup, and contains no full-document wrapper. Targeted `git diff --check` passed, with Git's existing LF/CRLF advisory. Reference SHA-256: `DA4F191405D207B99652EFDF89F61CBFADB4AEFE94AFD0D55BE8D08BDCFF7A6F`.

## Limits and integration ownership

No application source, production records, communications, integrations, migrations, deployments, GPU runs or generated images were created by this lane. App tests/builds are not applicable to these design artifacts. Existing source capabilities are inspected, not newly production-verified. T-601/T-603/T-605 keep their release, Diary and platform ownership.

Prototype interactions reset on reload; drafts and work states are local examples. The prototype illustrates a subset of the specification. Full offline operation, role permissions, actual stock/route/room facts, physical readiness, external delivery and the complete field workflow require implementation and venue qualification. This task completes the requested research/design/prompt pack, not the live hallkeeper programme.
