# Build, ship and verify the requested outcome

Founder direction, 7 September 2026: “we build something we ship it.”

For requested product implementation, fixes and improvements, the standing
authorization includes the appropriate release to the existing production
environment after applicable checks. Carry the work through implementation,
verification, coherent commits, integration, deployment and live verification.
Do not stop at “implemented locally”, “ready to deploy”, a commit, or a handoff,
and do not ask Blake to authorize the same deployment again.

## Coordinate the release and finish it

Check current branch, release and task ownership before changing shared state.
An assigned release owner coordinates one safe release at a time. Send the exact
tested commit and relevant evidence, arrange integration or a clear handoff of
release execution, and follow the result through to production. The originating
task remains responsible for seeing its requested change delivered.

If the named owner is unavailable and no competing release is active, use the
existing authorized release path from an isolated clean checkout, notify the
other task and preserve its work. An ownership label, stale freeze or unanswered
coordination message alone is not a missing user permission. Never race a known
active deployment, overwrite another task's changes or force-push shared history.

## Verify the change that ships

Use checks appropriate to the affected behavior and dependencies. Fix failures,
inspect the final diff, preserve unrelated work, and follow applicable backup,
migration ordering and recovery procedures. Deploy the verified source to the
existing intended environment. Check provider outcome and deployed identity,
then exercise the changed live flow; a successful push alone is not completion.
For UI changes, inspect the actual rendered production page.

A product-change task is done when the requested behavior is shipped and verified
live. Record source/deployment identity, meaningful checks and material limits.
A real failed gate, unavailable access/service or a newer explicit hold can leave
delivery unfinished; name the concrete obstacle and continue resolving it.
Do not describe an unfinished release as done or manufacture an approval gate.

## Keep the requested scope

A request explicitly limited to research, planning, a prototype or local work
keeps that scope. For documents, instructions and development tooling, deliver
to the intended repository or artifact destination; no unrelated application
deployment is required. Do not release unqualified experiments or claim founder
aesthetic acceptance from technical checks.

Preserve tenancy, authorization, source/privacy protections, data retention,
secrets, spending limits and approval of real venue operations. Shipping a code
change does not grant unrelated purchases, privilege changes, external messages
or destructive data actions. A later explicit user hold governs its named scope
and duration. This instruction supersedes older blanket “no deployment”,
Monday/Tuesday freezes and “another owner will ship it” stopping rules.
