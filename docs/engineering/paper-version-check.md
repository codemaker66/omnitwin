# Paper that knows its version (One Living Record, first slice)

Every printed hallkeeper sheet states in words which version it is and when it
was printed, and carries a QR code that opens a no-sign-in page answering one
question: is this copy current? This is fix-first item 16 of the October 2026
upgrade brief (`D:/claude/dream-platform-20261016/redteam/final__judge.json`,
`adjudicate__living-record.json`).

## What the paper says

- Version line, in the venue's timezone, on page 1 and in every page footer of
  the PDF, and at the head and foot of the browser print:
  `v7, issued 16 Oct 14:02, printed 17 Oct 06:02`; a sheet printed before
  approval reads `Draft, printed 17 Oct 06:02`. Dates are included because a
  sheet is usually issued days before the morning it is printed. One function
  writes it: `describeSheetCopy` in `packages/types/src/sheet-paper-check.ts`.
- QR code: an approved copy encodes `/sheet-check?s=<snapshot id>&v=<version>&h=<16 hex of the source hash>&p=<printed minute>`;
  a draft copy encodes `/sheet-check?c=<configuration id>&p=…`. The PDF adds
  its own printed minute; the browser print's QR comes from the payload
  (`paperCheck.qr`, a module matrix) and carries no printed minute.
- Ink only: black on white, no colour carries meaning, so it survives a mono
  laser printer.

## What the check answers

`GET /public/sheet-check` (`packages/api/src/routes/public-sheet-check.ts`,
rule in `services/sheet-paper-check.ts`) returns version state only:
`current`, `superseded` (with the version to ask for), `not_approved`,
`retired` (archived or withdrawn; a rejected layout can return to draft, so it is `not_approved`) or `unknown`. It never returns
event, room, guest or contact content. Every wrong link (unknown id, wrong
version or fingerprint, deleted layout, damaged approval) gets the same
`unknown`, and the route is limited to 30 checks a minute per caller, so it
cannot be used to enumerate sheets. "Current" uses the same rule the sheet is
served by: the layout is approved and its newest approved snapshot carries the
layout's own approval time.

The page (`packages/web/src/pages/SheetCheckPage.tsx`) says the answer in one
sentence with the next step ("Ask the duty manager for v9 before setting up").
When the request cannot reach the server it says "Can't check: no signal" and
repeats the paper's own version and printed minute from the link. A service
worker scoped to `/sheet-check` (`packages/web/public/sheet-check-sw.js`),
installed on a phone's first check, gives the same answer when the phone cannot
reach the site at all. It caches nothing. A phone that has never opened a
check gets its browser's own offline page.

## Scope and limits

- Versions belong to one room's layout (one configuration), not yet to the
  event: an event with two rooms has two sheets, each checked on its own. The
  event-level issue waits on the event spine.
- Today an approved layout moves only to archived, so an approved copy is
  superseded only where a newer approval is recorded; the common stale case is
  a draft printout once a version is approved.
- `/hallkeeper/:configId/sheet` now renders every PDF on request, so each copy
  prints its own time and the check QR. It no longer redirects to the
  approval-time copy in R2 (`services/pdf-prerender.ts`), which cannot know when
  it is printed. The pre-render still runs at approval and nothing reads it.
- The paper check is added when a sheet is served and is never written into a
  frozen snapshot or its hash.

## Tests

- `packages/types/src/__tests__/sheet-paper-check.test.ts`: link shapes, the
  version line, timezone pinning.
- `packages/api/src/__tests__/sheet-paper-check.test.ts`: the rule, the QR
  matrix, the route's validation, headers and rate limit.
- `packages/api/src/__tests__/sheet-paper-check-postgres.test.ts` (platform
  PostgreSQL gate): print v1, approve v2, scan v1 says superseded; an
  unauthenticated scan returns only state and version; guessed links all get
  the same `unknown`.
- `packages/api/src/__tests__/hallkeeper-pdf-v2.test.ts`: the line on every
  page and the QR target.
- `packages/web/src/pages/__tests__/SheetCheckPage.test.tsx`,
  `src/__tests__/sheet-check-sw.test.ts`, and the print cases in
  `src/pages/__tests__/HallkeeperPage.test.tsx`.
