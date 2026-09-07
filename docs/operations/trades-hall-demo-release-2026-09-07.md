# Trades Hall combined demo release — 7 September 2026

T-601 is the single release owner. The founder authorized this reviewed demo release to go live. Other tasks provide exact tested commits; they do not publish concurrently. Use the clean isolated release checkout, not the multi-owner development tree.

## Gates and source

The candidate combines the qualified viewer, inventory reservations/remedies, internal demo review, furniture batch and selected light Diary. Final schema is 67 entries through 0068. Existing migration SQL and journal prefixes are immutable. Source-owner checks and prior combined checks qualify their recorded source; final shared contracts, build and database additions require combined verification. The final source must remain clean while tested and deployed. Public source history excludes retained private documents, original captures and reference screenshots containing personal data.

The normal production web build uses the verified public Clerk frontend, the actual HTTPS API origin and E2E bypass disabled. Keep provider secrets out of frontend build processes. Windows checks do not qualify a Linux container. Local Docker is unavailable in this session; the existing Railway builder must pass the actual Linux image build, start, readiness and provenance checks before the web is published.

## Bind the actual database

Read the active production Railway service configuration in memory; do not print or persist credentials. Verify its endpoint against the previously inspected active Neon production branch. The old local deployment-secret file points to a different endpoint and must not be used. GitHub's production environment database secret was bound to the verified service target on 6 September; verify rather than assume it if configuration changes.

Create or verify a ready no-compute backup branch from the actual production parent and retain its branch ID, parent LSN and timestamp. Run exact-source read-only migration preflight and compare every applied SQL hash and timestamp with the local prefix. Preserve reports before and after. Do not infer readiness from migration count alone. Current observed production prefix is 60 entries through 0061; seven additions are pending at this writing.

The external guarded migration helper requires the exact clean commit, qualified release gates, a verified backup branch ID and explicit Apply. It pins the service endpoint, keeps credentials in the child process, migrates once and verifies the complete resulting ledger. If a step fails, preserve evidence and inspect actual state before retrying. No tests run against production.

## Deploy and establish what is live

1. After candidate, backup and migration gates pass, apply the reviewed pending schema to the verified actual target.
2. Set the existing API service's non-secret BUILD_GIT_SHA, BUILD_TIMESTAMP and BUILD_APP_VERSION without triggering a separate deploy. Upload the exact clean checkout to that existing project/environment/service through Railway CLI. Keep the returned deployment ID.
3. Follow logs for that specific deployment. Require successful Linux build, supported workspace runtime resolution, health readiness, and /health/version matching the intended source. A failed image blocks web publication. Forward-fix against the migrated schema; do not restore an arbitrary old API.
4. Refetch origin, confirm no competing release and push only the verified commit to the authorized master branch. Verify the actual Vercel production alias and source revision, not a preview or merely the last listed deployment. Observe the production CI result and actual API revision because Git-connected deployment behavior can also react to this push.
5. Rehearse using the founder's real authenticated session. Verify Diary, catalogue, saved plan, explicitly labelled private demo event, internal review with Notify team unchecked and server-confirmed suppression, frozen approved layout and hallkeeper PDF. Preserve ordinary bookings and operational stock. Do not create imaginary shortages to match illustrative screenshots.

Record final provider IDs, source revisions, readiness and browser evidence outside public history as needed. A successful HTTP response or generated screenshot alone does not prove authenticated end-to-end readiness. Publish the final result only with those distinctions intact.

## Recovery and remaining limits

Migration 0064 permits immutable configuration evidence by removing canonical uniqueness; an old API may assume that uniqueness. Preserve all post-backup writes. Do not delete evidence, re-add the old constraint or automatically restore the whole database. Use a verified compatible artifact or a forward repair.

The morning smoke task must use the prepared read-only runner, with final source/artifact identities independently bound to provider receipts. Preserve its existing trigger and principal. It supplements the authenticated rehearsal; it does not prove device performance or delivery of alerts.

Full sublime acceptance, wider UI modernization, calibrated reconstruction, PSNR50+ and physical iPhone/iPad/office-device 60fps remain open. The dense week and approximate imported model dimensions are recorded limits, not reduced final product requirements.
