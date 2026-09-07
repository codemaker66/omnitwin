# Venviewer presentation release — 7 September 2026

The combined presentation release is live at venviewer.com. The original
approximately 14:45 UTC presentation deadline was missed: publication was
interrupted by account usage limits and resumed after the deadline. This report
records delivered behavior and measured limits; it does not claim the deadline
was met.

## Publication checkpoint

The latest verified web source is
`3b1d33891698987a16d4087605911ab0490a0e66`, Vercel deployment `6315371782`.
The 20:00:53 UTC receipt records public entry `/assets/index-zrJBDNK3.js` and
unchanged stylesheet `/assets/index-DNroCu9R.css`. The normal authenticated
provider UI independently confirmed Production Ready, `venviewer.com`,
`omnitwin-web.vercel.app`, exact master source and deployment
`omnitwin-orqnf2q3x-codemaker66s-projects.vercel.app`, provider ID
`9txgtCfPmQ44PZ8n9rgExnquwWkf`.
API `7f2a701b4dade7d9d6048a82511ffa83cf4ff821` is ready and has no
runtime difference from the qualified compatible API. The protected deployment
URL did not permit direct HTML comparison; provider UI proof is recorded separately.

Auth recovery `3b1d3389` is published. Actual signed-in account reload passed with
the exact new entry and corrected CSS. A fresh anonymous in-app-browser `/register`
check initially failed to load Clerk, then recovered on one unchanged reload.
The real username/email/password, Google, Continue and Sign in controls rendered;
Sign in led to the normal login page. Both checks used the exact new public entry.
The initial provider-load failure is retained; its cause was not conclusively
captured, and later DNS resolution does not prove a DNS cause. No signup or
verification email was submitted. Earlier 7f/2805 rendered checks below retain
their actual source identity; they are not described as rerun against 3b1d.

The entry-referenced `ClerkRouteProvider-BXCBb_au.js` returned HTTP 200 JavaScript
with the verification guidance, account-settings action and `skipCache: true`
retry. An earlier probe of a locally hashed filename returned the SPA fallback
HTML; that wrong-path probe was not evidence of a deployment defect. Provider,
signed-in reload and bounded anonymous form-arrival checks are complete. Actual
Elaine signup, email verification and callback remain untested.

## Presentation and actual workspace

Start at [the showcase](https://venviewer.com/demo), with its
[eight-page PDF](https://venviewer.com/demo/venviewer-elaine-showcase.pdf).
Sixteen actual desktop/mobile chapter views, controls and the byte-matching PDF
passed on 7f2a701. Layouts, diary, sheet and conversational AI here are labelled
samples; the AI conversation is scripted product vision. The actual workspace
is separate.

The [new private furniture demonstration](https://venviewer.com/plan/c6b0c1af-ff93-4fde-9b15-2789c3ec4cbb)
contains ten imported white 6ft tables and eighty Turini chairs, saved/read back at
revision 2. It and the separate 22-object QA draft passed render/save/reopen.
Final 2805 checks corrected unknown capacity: two Round labels, diameter 1.83 m,
no fabricated capacity row and 18 seats across four tables in the QA draft.
The protected approved plan remains 162 objects, with its existing snapshot,
sheet and handoff.

Actual live navigation, editable homepage Plan Grand Hall entry, Diary week/day
and booking drawer, inventory, Hallkeeper room filtering, event-to-sheet/handoff,
PDF generation and shared Activity settlement were checked. The Day Board does
not currently project the prepared demo event; use its direct event link from
the presentation guide. All 43 shared setup checks remained unchecked. Final
2805 CSS, 2D, Day Board and homepage checks made no operational writes. The
existing 90/22-object draft writes were separate supported-API demo/QA actions.

Final 2805 onboarding text contrast measured 11.3448:1 for the inspected dark
text/light background pair, with no overflow at 1,892px. This is a scoped rendered
check, not a complete accessibility audit or customer activation rehearsal.

## Preservation and qualification

Production migrations 0069/0070 completed at 14:37:34 UTC on the verified active
target. A prior backup and immutable-prefix/hash receipts are retained. At
19:21 UTC the original object/configuration/snapshot and booking hashes still
matched the baseline. Sixteen configurations and 281 objects include the approved
162, new 90, QA 22, and two separately created configurations containing 2 and 5
objects; totals do not establish ownership of every record. No stock quantities
or venue facts were invented. The API integrity owner's authenticated empty-PATCH
smoke preserved its update/feed and approved evidence.

Validation comprises source-specific build/type/lint and actual-database receipts,
77 scoped calendar/timeline and 205 final blueprint tests, plus 453 web files with
5,964 passing and 16 skipped tests across separate runs. Original worker-startup
failures and bounded recovery remain retained; this was not one clean full-suite
invocation. The auth recovery adds 132/132 tests across seven auth files, full
web/E2E types, lint and production build. These run scopes overlap and should not
be added into an invented unique total.

[Linux CI for 2805](https://github.com/codemaker66/omnitwin/actions/runs/34156314598)
passed Test, Lint, Typecheck, Build and Security Audit. E2E shards 1, 2 and 4
failed; shard 3 was cancelled by the next push, and the overall run is cancelled.
At this checkpoint [3b1d Linux CI](https://github.com/codemaker66/omnitwin/actions/runs/34157607379)
has passed Build, Typecheck, Security Audit and Lint; Test and E2E are still running.
These are job-level results, not an all-green workflow claim.

The retained `ci-2805-summary.json` audit also confirms required PostgreSQL passed.
Its 60 observed E2E failure identities were already present in 7f, but they remain
real qualification gaps: visual differences, missing Twin baselines, measured
room-hop latency above its limit and drag frames. Prior occurrence does not make
these failures harmless. Receipt: `D:/claude/venviewer-presentation-readiness-20260907/ci-2805-summary.json`.

**Full CI E2E is not green.** Live furniture moving-camera performance is
inconclusive after trusted-pointer interruption. No 60 fps, physical-device,
PSNR50, full Goal 12 or founder aesthetic acceptance claim is made.

## Remaining work

Reusable Clients & access is delivered; actual Elaine verified-account access
and activation are not established. The qualified auth recovery only exposes
real Clerk account-settings/email-verification guidance and obtains a fresh token
on explicit access retry. It does not verify an email, send an invitation or
create a membership by itself. T-608 remains in progress.

Newer founder direction reopens T-606 for a compact room plan, current stage,
next action and six-room library. Its existing publication is delivered, but the
same task remains in progress while its owner qualifies the newer implementation.
That Hallkeeper work, qualified copy tip `4789857`, scaled-chair
geometry fix `997d980b`, capture-failure recovery `48022cad` and active Goal 12
event-decision work remain separate follow-ups with their original owners and
gates. T-605's migration 0071
reservation does not authorize an unqualified migration. T-601 coordinates the
next release only after the current executor explicitly hands the release lane
back; no further runtime change is included in this documentation update.

## Evidence

Source-specific receipts and `presentation-runbook.md` are retained under
`D:/claude/venviewer-presentation-readiness-20260907`, including
`live-provider-7f2a701.json`, `live-provider-2805f78e.json`, `live-provider-3b1d3389.json`,
`preservation-after-live-qa-inventory-20260907.json` and the source-specific gate
directories. Provider screenshots and their capture provenance are in
`navigation-live/`. API no-op evidence is
`D:/claude/venviewer-platform-evidence-20260907/live-event-noop-7f2a701b.json`.
Private venue browser evidence remains outside Git.

Final auth and provider observations are retained in
`D:/claude/venviewer-client-onboarding-20260907/output/playwright/onboarding-live-verification.json`
and `onboarding-provider-alias-proof.md` in the same directory. The final provider
screenshot was emitted inline in the originating task; that tool returned no
filesystem image path. The earlier `navigation-live/` images concern 2805.

Canonical changed-flow reports:

- [Furniture](furniture-planner-followup-2026-09-07.md)
- [Navigation](t601-navigation-repair-2026-09-07.md)
- [Activity](activity-global-live-2026-09-07.md)
- [Showcase](elaine-showcase-2026-09-07.md)
- [Hallkeeper](../design/hallkeeper-2026-09-07/live-verification.md)
- [Onboarding owner guide](../operations/client-onboarding.md)
- [Diary design and limits](../../design-qa.md), with actual production review at
  `D:/claude/venviewer-diary-redesign-evidence-20260907/production/live-review.md`
