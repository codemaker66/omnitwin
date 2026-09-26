# Approved setup-sheet integrity — 24 September 2026

T-633 repairs the saved-layout → review → setup-sheet boundary. An approved
configuration previously fell back to mutable live content when its frozen
snapshot was missing or malformed. The replacement could carry an approval
stamp despite never having been reviewed. Separate PDF selection could also
select historical evidence after a configuration reopened.

Approved sheets now require a valid frozen snapshot matching the configuration
and its current approval timestamp. Content, saved approval stamp and optional
PDF location come from the same row. Unavailable evidence returns the stable
503 code `APPROVED_SNAPSHOT_UNAVAILABLE`, after authorization. The browser
removes the invalid screen/print copy, explains the problem and offers retry.
Draft sheets do not reuse approved PDFs. Download and load responses are guarded
against stale routes, retries and unmounts; downloads validate PDF media type.

## Verification

- 77 focused API checks passed: 32 actual PostgreSQL integration cases, nine
  database-name safeguards, 19 service cases and 17 route/auth cases. Real PDF
  generation, missing/malformed/mismatched snapshots, loss of the latest
  approval, historical stamp preservation and reopened drafts are covered.
- 21 frontend unit cases passed. All 21 Hallkeeper browser cases passed across
  the initial run and the three affected PDF cases rerun after fixing an
  inaccessible busy button. The initial failing evidence is retained.
- A separate connected browser rehearsal used real Fastify and disposable
  PostgreSQL: save/reopen a placement, submit, review and approve with
  notifications suppressed, render/download the frozen sheet, edit live data,
  inject snapshot damage, and restore/retry. Desktop and 390px views were
  inspected. Zero email records were created; the deliberate 503 was the only
  browser error. No production fixture or real event approval was changed.
- API/web typechecks, API/web full lint, API/web builds and diff checks passed.
  CI now supplies a dedicated disposable database so these PostgreSQL
  regressions run in its normal test job.
- Read-only production preflight found 69 applied/local migrations, matching
  every historical hash and timestamp, with zero pending entries. There are no
  migration changes in this repair.
- The new snapshot reader accepted the existing approved production demo in a
  read-only transaction, preserving its September 7 version-one approval. The
  new browser regressions also require explicit admission to the pinned browser
  inventory; the original inventory and outcome requirements remain preserved.

Evidence, screenshots, failed runs and the connected harness are retained at
`D:/codex/saved-layout-review-proof-20260924/`. Local synthetic fixtures are
distinct from the existing founder-authenticated production demo inspected
read-only. Provider and live release results are recorded separately once known.

## Limits

This does not prove every saved-layout, Diary, inventory, supplier or client
workflow. Snapshot validation is structural and approval-bound; it does not
cryptographically compare an arbitrary schema-valid payload with its source
hash or independently verify stored CDN PDF bytes. Missing historical approver
fallback is helper-tested: the current database constraint prevents constructing
that invalid approval row. Physical-device performance and founder visual
acceptance remain unclaimed. Claude retains T-631/T-632 reconstruction ownership.
