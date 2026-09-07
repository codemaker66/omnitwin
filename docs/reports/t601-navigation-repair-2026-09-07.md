# T-601 public navigation repair — 7 September 2026

Blake reported that the main page offered no login, dashboard or Hallkeeper
access and did not expose furniture planning. Actual production browser
inspection reproduced this: `/` only linked to room tours and venue information;
`/room/grand-hall` only offered a return to the room list.

The live `/plan?space=grand-hall` eventually opened the Grand Hall but automatically
selected a frozen timeline phase, disabling furniture editing. Choosing Exit
preview revealed the editable layout; Add furniture opened the real catalogue
and the Move control was available. This inspection did not change furniture,
bookings, snapshots or account privileges.

## Changes

- `3797b341`: primary planning, Dashboard, Diary, Hallkeeper and Log in links on
  `/` and `/fresh`; furniture explanation and Grand Hall planning action;
  same-room planning and workspace exits from room tours. Native planner entry
  resets the previous editor instance so the selected room is respected.
- `9978329e`: safe internal `returnTo` helper and regression coverage. T-608
  copied this helper into its login/registration/route-guard integration; do not
  cherry-pick it twice into the combined release.
- `dee23d43`: ordinary planner entry keeps the saved layout editable. Explicit
  historical links and deliberate timeline interactions retain preview locks.
  Context changes discard the previous configuration's captured phase selection.
- `5cb8ff62`: a phase-free external URL clears a preview established before
  React Router committed the new destination. Timeline-generated URL changes
  retain their separate handling.
- `288fa67a`: corrected two test queries to use React Testing Library's supported
  role options after the combined TypeScript gate caught `exact: true`. The
  two affected page suites subsequently passed all 40 cases.

## Verification and delivery

Source review and diff hygiene passed. The first focused Vitest run passed
170/171 cases: homepage, room tour, venue information and auth-return suites
passed; the new ordinary cross-configuration timeline case failed. Its assertion
was retained while correcting the external URL/effect ordering. This failed
evidence is retained in `D:/claude/venviewer-navigation-tests-20260907.log`.
The full 52-case timeline suite then passed after `5cb8ff62`, including the
unchanged failing regression and existing deep-link, motion and freeze cases.
The affected set therefore passes 171/171 across those runs.

Actual browser checks on the navigation source show visible desktop entry links
and the Grand Hall planning action. At 390 × 844, both public pages have all five
links with 44 px targets and no horizontal page overflow (375 px content width).
Keyboard Tab moves from Plan an event to Dashboard. About the venue opens the
actual `/fresh` page. Light and dark mobile headers were inspected. Viewport
overrides were reset after checks. No 3D workload remains open in this task.

The private frozen install was stopped after stalling at 353/360 packages.
Its lockfile and the existing demo-release checkout's lockfile have matching
SHA-256 `12F58A8F9A2D762ADDC5F831ECEE15914F875C406E7A2D5E2B26B66962F4EAC8`.
The latter's web/types dependencies are reused for execution only, with transform
caches directed to this checkout; no installation runs through those links.

The exclusive release executor owns combined types/lint/build/tests and final
integration. Production workspace navigation and planner checks remain open.

On the actual Vercel combined preview, clicking Hallkeeper and Dashboard from
the homepage reached real Clerk forms at `/login?returnTo=...`; their Sign up
links retained the intended workspace. No credentials or registration were
submitted. The preview planner could not connect: browser network evidence
showed `http://localhost:3001/venues` failing with `ERR_CONNECTION_REFUSED`,
because this preview did not receive `VITE_API_URL`. This is a preview
configuration limit; full planner verification must use the intended API.

Independent source review also identified the no-destination login/signup
fallback and recovery during an unresolved access check. T-608 supplied tested
follow-up `e645d726`; it was initially queued after the first frozen candidate
and then integrated as `d920f6c2` into final candidate `7f2a701b`. Explicit
workspace destinations were preserved through the preview
sign-in and sign-up links; post-authentication return remains unverified.

T-601's exclusive release executor received the exact navigation and timeline
commits with that pending qualification stated. The subsequent production
evidence is recorded below; no founder aesthetic acceptance is claimed.

## Production verification — 18:47–18:52 UTC

The release executor confirmed production source
`7f2a701b4dade7d9d6048a82511ffa83cf4ff821`, Vercel Production deployment
`6314446074` successful at 18:43:44 UTC, and the matching API healthy/ready.
Its provider receipt is retained at
`D:/claude/venviewer-presentation-readiness-20260907/live-provider-7f2a701.json`.
The exact candidate passed combined typecheck, build and lint, plus 934 affected
web tests in 65 files; these are separate from this slice's earlier 171 cases.

Actual browser checks on the newly published `https://venviewer.com/`:

- The five primary links and Grand Hall furniture-planning action are visible.
- Native homepage clicks reached the real Dashboard, populated Diary and
  Hallkeeper Day Board in the existing signed-in platform-admin session.
- In a separate anonymous in-app browser, homepage Log in opened the real Clerk
  form. Hallkeeper opened `/login?returnTo=%2Fhallkeeper%2Ftoday`; Sign up retained
  that destination. No credentials were entered and the user's session was not
  signed out. Completing a new sign-in remains outside this observed evidence.
- At 390 × 844, `/` and `/fresh` show all five primary links with 44 px heights;
  document scroll width is 375 px, with no horizontal overflow. The actual
  homepage-to-venue-information link was exercised. Screenshots are retained in
  this task's CUA tool output, with the exact captured image bytes saved at
  `D:/claude/venviewer-presentation-readiness-20260907/navigation-live/`:
  `home-desktop-7f2a701.jpg`, `home-mobile-7f2a701.jpg`,
  `venue-mobile-7f2a701.jpg` and `hallkeeper-7f2a701.jpg`. No alternate browser
  capture or image editing was used. The temporary viewport was reset and
  anonymous tab closed.

These checks made no furniture, booking or snapshot writes. No additional bare
planner route was opened to create a draft.

## Live planner verification — 19:10–19:17 UTC

After T-602's saved-layout verification and the shared GPU window, the actual
production browser opened the designated demonstration configuration at
`https://venviewer.com/plan/c6b0c1af-ff93-4fde-9b15-2789c3ec4cbb`.
Ordinary entry showed 90 objects (10 tables, 80 chairs), enabled Add furniture
and Move, and no historical phase in the URL. Add furniture opened the real
catalogue; Move could be selected. This check did not drag or write furniture.

Native clicks completed Flow → More planner tools → Scene overlays and switched
Guest flow off and back on. The checkbox centre hit its actual input. At
1907 × 916, the document stayed within that viewport; the tools panel was at
`(1393, 82, 238, 716)` and Flow panel at `(1645, 14, 248, 724)`, each with internal
scrolling. No forced clicks were used. Guest flow was restored on, Design and
Interior were restored, and the tab returned to the homepage to release the
GPU. The final URL before exit was the same configuration with
`?timelineScope=day&timelineDate=2026-09-07`.

Exact CUA screenshot bytes are saved alongside the navigation evidence:
`flow-on-7f2a701.jpg`, `flow-off-7f2a701.jpg`, and
`planner-design-7f2a701.jpg`. The final Design/Interior screenshot shows the
furnished hall with Move selected. Two separate Flow visual observations were
reported to its coordinator: the peak-density summary label/value overlap in
the narrow panel, and switching from Interior to Flow leaves a close-up capture
view until Interior is restored. Functional control checks passed; this does
not certify those visual details, simulated operational metrics or frame rate.

## Linux timeline follow-up

Linux CI run `34152318157` exposed a real failure in the existing history-date
case: resolving a linked event's time zone could update the auto-anchor ref
without changing its civil date, leaving URL synchronization with a stale
render-time pending flag. Unedited code reproduced the same missing
`timelineDate=2026-06-14` under process `TZ=UTC`; this was not test contamination.

Commit `d48daa71190dce28d658163b89bd766eb39ca6ae` moves that completion check into
the URL synchronization effect and exercises the preserved history assertions
under both UTC and Europe/London on every host. The full private timeline suite
passes 53/53 under both process time zones; the final test mock lint correction
passes its two affected cases. Scoped typed ESLint reports no errors or warnings.
The release candidate has one additional unrelated unavailable-state case,
which the patch preserves. Parent source review and patch applicability passed.

Retained evidence:
`D:/claude/venviewer-navigation-timeline-utc-repro-20260907.log`,
`D:/claude/venviewer-navigation-timeline-utc-fixed-20260907.log`, and
`D:/claude/venviewer-navigation-timeline-london-fixed-20260907.log`.
The exclusive executor integrated that two-file commit as `d6aa0190` for its
follow-up release. Parent review then found a related failure path: when the
automatic anchor changes civil date, publishing the previous render's date
could leave that stale URL behind if the new range request fails.

This was reproduced with a deferred linked-event read and a rejected new-range
request. Commit `51de226877aa6a4d1b0462b7e721667fe3c74591` adds the bounded guard
that the current date must match the automatic target before synchronizing.
Explicit/manual dates keep their existing bypass. All 54 private timeline cases
pass under UTC, including both browser-zone cases and the preserved new failing
regression; scoped typed lint passes with zero errors and warnings. The
candidate's extra unavailable-range case is preserved. Failed fork-worker
startup was retained as runner evidence and is not represented as a test result.

The additional failure and pass evidence is saved at
`D:/claude/venviewer-navigation-timeline-anchor-error-repro-threads-20260907.log`
and `D:/claude/venviewer-navigation-timeline-anchor-error-fixed-20260907.log`.
The sole executor has the final qualified guard commit; its publication receipt
is the remaining delivery item for this slice.
