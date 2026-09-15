# Public release smoke check

The existing Windows task `VenviewerSmokeMON` invokes the reviewed public-only runner at `D:/claude/demo-smoke-readonly-20260906/Invoke-PublicReleaseSmoke.ps1`, using `final-config.json`. On 7 September 2026 at 20:25 UTC, its old draft-creating action was replaced after all 15 bounded public checks passed. The existing trigger, principal and settings were compared before and after and remained identical. No new automation, credential or notification was created.

On 15 September 2026 the task was confirmed Ready, retaining its Monday 08:00 Europe/London schedule. The replacement action actually ran on 14 September at 08:00 BST: result 0 and all fifteen public checks passed. Its next recorded run is 21 September 2026; the existing interactive-login, awake and power conditions still apply.

## Release maintenance

The sole serial release executor owns configuration rotation. Follow the reviewed local [maintenance procedure](D:/claude/demo-smoke-readonly-20260906/MAINTENANCE.md): verify the exact provider deployment and production-domain binding, observe API identity and actual public HTML/assets, prepare a new configuration, run all checks, preserve the previous configuration, then replace it with the passing bytes. The scheduled task itself needs no further change.

Do not assume a documentation-only deployment has identical assets: the fbc6cb9e rebuild changed its entry JavaScript and HTML while preserving application source from 3b1d3389. Use the observed final response, not a local build hash or guessed source marker. A protected generated provider URL cannot be treated as the public domain's HTML.

## Evidence and limits

- [Action update receipt and before/after task XML](D:/claude/demo-smoke-readonly-20260906/action-update-receipt-20260907.json): 15 passed, zero failed; action-only change and preserved settings.
- [Initial independently checked final identity](D:/claude/venviewer-demo-release-evidence-20260907/final-public-identity-fbc6cb9e.json): provider-linked public HTML/assets and API version.
- [Subsequent copy-release rotation](D:/claude/demo-smoke-readonly-20260906/copy-rotation-54f4dc5a-20260907/rotation-receipt.json): 15 passed, zero failed; config-only update with unchanged scheduler XML.

The runner uses only unauthenticated GET/HEAD requests with bounded time/body limits. No browser JavaScript, authentication, database writes, draft creation, email or external alert runs. A passing HTML shell does not prove the route's record exists or is accessible. These checks do not establish inventory correctness, saved plans, PDF correctness, visual quality or device performance; actual changed live workflows remain required separately. Failed attempts remain in the evidence directory.
