# Hallkeeper focused workspace — 7 September 2026

Blake rejected the long Hallkeeper sheet and supplied populated architectural references. This is a revision to the real sheet at `/hallkeeper/:configId`, not a replacement of the fictional Hillside walkthrough.

## Working surface

The room is the heading. The saved event plan sits beside one working panel. Preparation, Setup, Checks, Hosting, Reset and Handback have distinct colours; selecting one is navigation, never an execution status or room-release action. Setup retains every stable row key and quantity, showing five rows per page with category, remaining and search controls. A furniture marker opens its exact category/page without changing a check. Final checks are directly available from Checks where supplied. Full paper output retains the entire manifest, plan, instructions and approval provenance.

Verified event context is optional. Configuration and venue IDs establish room identity; an event query is accepted only after configuration membership is verified. A handoff pack for a different layout is excluded. Planned phase times remain planned; estimated sheet timing is labelled indicative. Issues are labelled event-wide. Existing event operations owns operational task changes and handoff review. This UI does not imply that supplier arrival, cover acceptance, escalation delivery or room release has occurred.

The existing save/rollback/offline queue and per-sheet Activity behaviour remain. Runtime sheet and progress payloads are validated before use, including returned configuration identity. Production data is not changed by browser verification.

## Supplied plans

`/hallkeeper/rooms` has six independent room entries. North Gallery is the left room in the combined source; South Gallery is the separate supplied right-room reference. Both connected Robert Adam sections remain one room. Sources are copied byte-for-byte under `public/room-plans/originals`.

Five image-generation derivatives remove obvious seating. They retain source architecture and ambiguous symbols, with regenerated linework and lettering; they are visual references, not measured geometry. The original switch and download remain available. North's two generated variants distorted proportions and are rejected, retained only as evidence. Its faithful original left-room detail is displayed through a CSS viewport; no source pixels are changed. Source annotation differences from database dimensions are not silently reconciled. No production room dimensions, saved polygons or approved layout geometry are changed.

Per-room prompt, source hash and visual QA records are alongside this file. Built-in image generation was used; no API-key image workflow was used.

## Verification and delivery

55 focused tests across six files passed, including runtime envelope/configuration identity rejection, stale responses, auth changes, offline queues, pagination, marker navigation, venue guards and image failure recovery. Full web and e2e TypeScript checks and scoped app/test lint passed. Desktop 1440 and mobile 390 browser checks exercised the actual page with mocked API data; no horizontal mobile overflow. All 43 test manifest rows and 162 frozen footprints were retained in four printed pages. The final PDF was visually checked through the last page. Six library images decoded; North and South were inspected independently. White transparent original linework is shown on a dark paper background.

The clean original candidate `6b9dd2ef` passed its production-config build. The published copy cleanup `54f4dc5a` is now merged, retaining its unrelated copy and current auth behavior. Independent integration review confirmed the focused workspace, full print mirror and verified event links. The saved plan explicitly counts footprints; the header counts manifest items. The same focused tests, full source/e2e types and scoped lint passed after integration. Final merged source `91220e00` passed its exact clean production build and is live on Vercel Production `6315921182`. The actual signed-in sheet, six-room library and public smoke checks pass; see [live verification](live-verification.md) for receipts and the explicit native print/download inspection limits. Local browser evidence lives in the isolated worktree under `output/playwright/hallkeeper-focus/`; exact build receipts are outside it at `D:/claude/venviewer-hallkeeper-focus-evidence-20260907`. Do not treat local checks, deployment and Blake's aesthetic acceptance as the same state.
