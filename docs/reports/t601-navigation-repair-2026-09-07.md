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
commits with that pending qualification stated. This report is an in-progress
record, not a deployment or acceptance claim.
