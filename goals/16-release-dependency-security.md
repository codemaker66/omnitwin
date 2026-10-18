# Goal 16 — Remove the release dependency security blockers

Activated by Blake's 15 September 2026 instruction: “create the next goal.”
Task **T-612**, a bounded part of **F-15 Privacy/security/access lifecycle**.
Status: **complete, 15 September 2026**. No token budget requested.

## Outcome

Ship a reproducible dependency update that clears Venviewer's current audit gate
and patches the affected native API runtime, while preserving the released
planner, event access, saved layouts and venue operations.

This follows completed Goal15 (its goal file was never committed to this repository) and the
subsequent [planner recovery/annotation release](../docs/reports/planner-recovery-and-annotations-2026-09-15.md).
At creation, master/web is54ebfc61cdede41b7ae4355fd6fe0cccfe2085c5 and API is
04dbd8bb89453a893cb882474002417a00ca46fc. Recheck before implementation and
integration; these are a dated starting point, not a release lock.

The [existing advisory applicability review](D:/codex/venviewer-event-access-20260914/evidence/security-advisory-applicability.md)
recorded two high and six moderate findings against unchanged dependencies.
The released manifests still contain Sharp0.35.3, js-yaml4.3.1 and Vitest4.1.8.
The review identified Sharp0.35.4, js-yaml4.3.2 and Vitest4.1.11 as compatible
minimum fixes. Verify current primary advisories and resolved source before
choosing final versions; do not rely on these numbers as permanent truth.

Independent creation review of [CI34919476716](https://github.com/codemaker66/omnitwin/actions/runs/34919476716)
confirmed the same three advisories and two high/six moderate findings on54ebfc61.
Test, Build, Lint, Typecheck and the53-case event-access gate passed; all four
broader E2E shards failed. Their repair is a separate launch requirement.

## Execution prompt

Reproduce the current dependency audit from a clean, owned checkout of the
current production lineage. Determine which affected copies reach the API,
static web build, capture tooling and development/CI. Trace native and bundled
libraries as well as manifest/lockfile entries.

Apply the smallest coherent compatible update that removes the findings at
the existing audit threshold. Cover every affected direct pin and transitive
resolution; inspect the lockfile and actual installed/build outputs. Preserve
runtime behavior and useful tests. An override cannot patch code already
embedded in a vendor bundle; verify any affected embedded copy directly.

Qualify the changed native runtime and test toolchain, obtain independent review,
commit exact paths, coordinate one release through T-601, deploy the necessary
API/web artifacts, and verify exact live identities and the affected existing
flows. A local clean audit, dependency commit or web-only redeployment cannot
establish that the API's native library was patched.

## Required evidence and completion criteria

1. **Current baseline and applicability.** Retain the failing audit, exact source,
   package-manager/runtime versions, dependency paths and authoritative advisory
   references. Distinguish production from development exposure and inspection
   from exploitation evidence. Do not invent an incident or silently waive a
   finding because its current path appears constrained.
2. **Reproducible patched dependencies.** Use compatible exact pins and a reviewed
   lockfile, followed by a clean frozen-lockfile install. Confirm no affected
   version survives in the in-scope installed or shipped dependency closure.
   Run the existing pnpm audit gate at moderate severity and above without
   suppressions, exclusions or a weaker threshold. Report any lower-severity
   findings separately. If a new advisory changes scope, investigate and record
   it rather than assuming the historical count is exhaustive.
3. **Real native-library verification.** Build the actual Linux API image with
   its production architecture and package layout. Record installed Sharp and
   relevant native decoder versions from that image. Exercise accepted and
   rejected image/WebP paths with safe fixtures; retain format, size and boundary
   checks. Preserve original captures. Source pins or a Windows install alone
   are insufficient evidence for the deployed Linux runtime. Bind this proof
   to the deployed artifact: inspect those versions in the running container,
   or verify its immutable image digest matches the qualified image, including
   architecture and libc. A matching source commit alone does not establish
   which native libraries the live process uses.
4. **Preserved behavior.** Run affected image/foundry/capture-tool tests and
   appropriate workspace tests, lint, typecheck and builds. The Vitest change
   must pass existing mandatory platform/event-access/route PostgreSQL gates
   against explicit disposable databases, with migration/replay receipts and
   no hidden required skips. Preserve the53-case event-access baseline and
   current test inventory; do not make a changed test count the definition of
   success. Exercise actual rendered saved-planner, Flow warning open/dismiss
   and event-schedule navigation on the qualified build.
5. **Independent review and delivery.** Review the dependency diff, native
   runtime proof and regressions. Preserve newly released Flow/camera/caption
   behavior and F03 authority guards. Recheck current release ownership and
   source before integration. Deliver through the existing serial API/web path,
   verify provider/custom-domain/source/readiness, and check an existing
   authorized live journey. Where the release changes smoke identities, retain
   a backup and rotate only the existing public smoke configuration after its
   unchanged checks pass; preserve scheduler/runner settings.
6. **Honest closeout.** Deliver
   docs/reports/release-dependency-security-2026-09-15.md with before/after audit,
   exact source and artifact identities, installed/native version evidence,
   checks, deployment/live receipts and remaining limits. Update T-612, this
   goal, F-15's execution record and the dated session. Mark complete only when
   this security slice is delivered and verified; separate unrelated existing
   E2E/platform failures instead of declaring the full Friday release ready.

## Ownership and boundaries

- This task owns the bounded dependency update, its necessary compatibility
  corrections and evidence. T-601 remains the serial release coordinator.
  Inspect and preserve all other owners' work in the shared tree; install and
  test only in owned dependencies. The dirty shared package/lockfile state is
  not a release candidate or permission to discard work.
- Retain the current Spark patch and supported Three/R3F compatibility. Do not
  turn this into a renderer migration, general dependency modernization, visual
  redesign or replacement of the planner architecture. Preserve the combined
  Spark lifecycle/embedded-fflate fix and its four-parser-copy regressions.
- Preserve frozen Goal14/15 evidence and T-605's unfinished source and reserved
  migrations0071/0072. No schema change is planned for this dependency slice.
- Test databases must be explicit and disposable. Do not use ambient production
  credentials, create client identities or change account privileges for tests.
  Use existing authorized records/accounts for the live check.
- No customer/staff messages, unrelated production data writes, source-capture
  changes, CMS hold changes, new paid compute or unsolicited infrastructure
  provisioning. Identify any additional deployed worker requiring a separate
  qualified update; do not claim it patched from the API image's version.
- This does not complete all of F-15, ordinary-client provider/revocation
  acceptance, durable DMs, water/AV requests, broad E2E repair, physical-mobile
  60fps, reconstruction quality or founder design acceptance. Those remain in
  the full Friday programme (Codex's plan `18-FRIDAY-LAUNCH-2026-09-18`, never committed here).

The creation turn established this execution contract. Implementation, delivery,
live verification and independent closeout are complete as recorded below.

## Delivery evidence — 15 September 2026

The bounded security slice is deployed on API/web
`641f26674bde55102221042e42967619bbd8b607` through the reserved T-601 lane.
PR15 merged; Railway a4963f16-2efe-49f9-928b-842de0df99ae and Vercel production
6455104527 succeeded. The running API independently reports Sharp0.35.4,
libvips8.18.6 and libheif1.23.2 on Linux x64/musl. The unchanged audit moves
from two high/six moderate findings to zero across all severities.

Final candidate CI34947244086 passes Audit/Lint/Typecheck/Build/Test/Native:
12,387 workspace tests pass with258 disclosed conditional skips; separate
platform60/event-access53 and route13 cases ran without required skips.
The actual API image passes12 native fixtures, and44 Spark regressions pass.
Local synthetic-client and existing founder-provider rendered journeys pass;
all15 existing public smoke checks pass, with backup/config rotation and
unchanged runner/wrapper/scheduler XML. T-601 received the serial lane back.

The [delivery report](../docs/reports/release-dependency-security-2026-09-15.md)
retains exact artifacts, original failures, review, running-native binding,
live/source proof and limits. Independent final record audit is complete.
Broader E2E repair belongs to Goal17; full F-15, ordinary-client provider,
mobile60fps, reconstruction and founder design acceptance remain open.
