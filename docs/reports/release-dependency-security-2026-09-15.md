# Release dependency security — 15 September 2026

**Delivered Goal 16 / T-612 security slice, 15 September 2026.** API and web are live on `641f26674bde55102221042e42967619bbd8b607`. The unchanged dependency audit has zero findings; actual loaded production libraries, the authorized live journey and all 15 public smoke checks are verified. Independent final review is complete; scoped task/goal/F-15/session records are updated. This does not establish full Friday launch readiness.

## Source and scope

The starting released lineage was master/web `54ebfc61cdede41b7ae4355fd6fe0cccfe2085c5`, with API `04dbd8bb89453a893cb882474002417a00ca46fc`. Implementation uses the owned checkout at `D:/codex/venviewer-dependency-security-20260915/worktree`; unrelated shared work and T-605's reserved migrations 0071/0072 are outside the change.

The final candidate and integrated master source are `641f26674bde55102221042e42967619bbd8b607`, tree `785a667b67c34b6d52962628e0f36cc9b601642a`, from branch `codex/release-dependency-security-20260915`. [PR 15](https://github.com/codemaker66/omnitwin/pull/15) contains 16 changed files and was readied before the fast-forward integration. The dependency correction adds a private startup diagnostic and an actual-image CI gate; it does not change the root Dockerfile, schema, planner implementation or input acceptance limits. Integration is established separately from deployment and live acceptance.

The three coherent implementation commits are:

| Commit | Change |
| --- | --- |
| `b380d6b432216a2497b884479303c9d7e3b995e1` | Exact dependency pins, native qualification and restricted runtime diagnostic |
| `f9de5030c0f49efa0abf322dc36434ddf4828050` | Explicit nullable condition for lint; bounded decoder scratch directory in image qualification |
| `641f26674bde55102221042e42967619bbd8b607` | Two expected Vitest version literals updated in the existing reproducibility guard |

## Baseline, applicability and dependency result

The retained baseline audit exits 1 on source `54ebfc61`, Node 22.18.0 and pnpm 9.15.4. It reports **2 high and 6 moderate findings**, represented by four module entries across three advisories. This is a dependency finding count, not eight independent incidents or evidence of exploitation.

| Dependency | Before | Qualified pin | Applicability and authoritative reference |
| --- | --- | --- | --- |
| Sharp | 0.35.3 | **0.35.4** in foundry and twin-forge | Native image decoder; the API reaches it through foundry, while capture tooling accepts a broader set of source image files. [Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |
| js-yaml | Root override 4.3.1 | **4.3.2** | Inspected use is in lint/development configuration; the audit's dependency classification alone does not prove production reachability. [js-yaml advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| Vitest and resolved @vitest packages | 4.1.8 | **4.1.11** across all eight direct manifests | Development/CI mock interception boundary; no exposed vulnerable mock server was demonstrated. [Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |

The Vitest manifests are packages api, web, types and reconstruction-foundry, plus tools capture-factory, reconstruction-foundry, twin-forge and xgrids-lcc2. The reviewed lockfile keeps the change within these families and Sharp's optional native dependencies. `@emnapi/runtime` moves from 1.11.1 to 1.11.3 because the patched Sharp WASM package requires it. Sharp's native bundle moves to 1.3.3, whose [upstream release](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.3) provides libvips 8.18.6 and libheif 1.23.2.

The API's existing platform-admin restriction, RIFF/WebP framing, 32 MiB input bound, full decode and 70-million-pixel bound remain intact. The upstream Sharp advisory describes possible RCE under particular glibc conditions; this report neither demonstrates such an exploit in Venviewer nor treats the API's musl deployment as a waiver.

The same `pnpm audit --audit-level=moderate` gate now exits 0 with **zero critical, high, moderate, low or informational findings**. Advisories, actions and muted entries are empty. No threshold, exclusion or suppression was added. Both audits report 888 dependencies; this is the audit inventory, not a count of packages in the production container.

Evidence: [baseline audit](D:/codex/venviewer-dependency-security-20260915/evidence/audit-before.json), [baseline identity](D:/codex/venviewer-dependency-security-20260915/evidence/baseline-runtime.json), [patched audit](D:/codex/venviewer-dependency-security-20260915/evidence/audit-after.json), [independent advisory/diff review](D:/codex/venviewer-dependency-security-20260915/advisory-review.md).

## Reproducibility and preserved embedded fixes

A clean installation into the owned dependency graph completed using pnpm 9.15.4 and the frozen lockfile; its postinstall type/foundry compilation completed. The installed Windows closure independently resolves all eight Vitest pins to 4.1.11, Sharp to 0.35.4 and js-yaml to 4.3.2. Windows inspection is retained as reproducibility evidence; Linux/native qualification below is separate.

Spark stays at 2.1.0, Three at 0.180.0, R3F at 8.18.0 and drei at 9.122.0. The combined renderer-lifecycle/embedded-fflate patch remains byte-identical:

- SHA-256: `9b79df4d4540071b6a784c3d3aa52556c9bbbf208618b09b080074e947471835`.
- pnpm patch identity: `bdnakpe5oiep5uzksirp72ypou`.

These are different identity representations. The existing four embedded-parser-copy guards and lifecycle tests were preserved; an external fflate override was not substituted for the vendor-bundle patch. Final-candidate CI explicitly passes **44/44 Spark checks**: SparkSplatLayer 13, renderer lifecycle 16, ZIP64 10 and stack compatibility 5. These results are individually present in the [completed Test log](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/104309582093-Test.log), rather than inferred from the workspace aggregate.

Evidence: [frozen install](D:/codex/venviewer-dependency-security-20260915/evidence/install-frozen.log), [installed closure](D:/codex/venviewer-dependency-security-20260915/evidence/installed-closure.json), [final focused pin guards: 3/3](D:/codex/venviewer-dependency-security-20260915/evidence/dependency-pins-final.log).

## Actual Linux API image

[CI 34947244086](https://github.com/codemaker66/omnitwin/actions/runs/34947244086) built the actual root Dockerfile and final `pnpm --filter @omnitwin/api --prod deploy` package layout for linux/amd64. The PR merge checkout is `81de1b4a84e544d5f37dc2cbc19399dde62fcc52`; its tree equals the final candidate tree `785a667b67c34b6d52962628e0f36cc9b601642a`. Matching file trees do not make these commit IDs identical.

| Observed property | Actual CI image result |
| --- | --- |
| Image ID | `sha256:f998ec09e7b5ad14ac27ffb3c203b4e370bbf4f373cbaf3b5eedf5fcf3375390` |
| Platform | Linux amd64; Node 22.23.2; Alpine 3.24.1 |
| libc | musl 1.2.6-r2, loaded `/lib/ld-musl-x86_64.so.1` |
| Process identity | UID 100 / GID 101 |
| Foundry-resolved Sharp | **0.35.4**, linuxmusl-x64 native add-on |
| Loaded libvips / libheif / WebP | **8.18.6 / 1.23.2 / 1.6.0** |
| Native fixture completion | 08:32:14.370 UTC; **12 passed, 0 failed** |

The fixture harness resolves Sharp through the deployed foundry module, checks actual loaded objects, and compares them with the new runtime diagnostic. It executes real accepted lossless/lossy WebP inputs and rejects PNG, a short RIFF header, byte-count mismatch, a real 33,554,434-byte length-consistent RIFF/JUNK input, declared-size mismatch, a truncated chunk, a truncated encoded stream with complete framing, and a genuine two-frame animation. It fully decodes and accepts exactly **70,000,000 pixels**, then rejects a valid **70,010,000-pixel** image specifically at the pixel limit.

Qualification runs without network access, with read-only application/root files, 2 GiB memory, 2 CPUs, 128-PID limit and a bounded 1 GiB ephemeral `/tmp` using nosuid/nodev/noexec. The exact-boundary case took 3,053 ms; peak process RSS was 706,852 KiB. Those are fixture resource measurements, not planner or mobile frame-rate results. The harness does not boot the API, use authentication or a database, decode HEIF, or execute exploits. Loaded libheif identity is verified; HEIF behavior is not.

The API now writes a private `native-image-runtime` startup log with loaded native versions, architecture, Node and libc identification. The getter limits the process report to required fields, temporarily excludes network enumeration, restores that setting, and tolerates report failure. Two focused tests cover filtering/restoration and report failure. It adds no public diagnostic endpoint and does not publish environment variables or stacks.

The deployed-artifact requirement is satisfied by inspecting the actual running Railway process, separately from CI: its private startup event at 08:48:55 UTC reports Sharp 0.35.4, libvips 8.18.6, libheif 1.23.2, Node 22.23.2, Linux x64 and the loaded musl loader. See the release receipts below. Railway and CI image identities are recorded separately; neither source equality nor a Windows install substitutes for this running-process evidence.

Evidence: [final native receipt](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/native-image-results-34947244086/runtime-and-fixtures.jsonl), [image inspection](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/native-image-results-34947244086/image-inspect.json), [independent qualification](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/qualification-review.md), [diagnostic unit results](D:/codex/venviewer-dependency-security-20260915/evidence/image-runtime-unit.log).

## Required regression and database gates

Final-candidate CI 34947244086 passes all six mandatory jobs: **Security Audit, Build, Typecheck, Lint, API Native Image and Test**. Test job 104309582093 completed successfully at **08:43:09 UTC**. The audit log reports no known vulnerabilities at 08:30:48.677 UTC. Broader E2E remains unresolved, with failed shards already present in the retained pre-integration snapshot; this is not an overall-green-CI claim.

Both dedicated PostgreSQL gates already have final receipts and independently inspected underlying assertions:

| Gate | Passed / skipped | Explicit disposable target | Migration / replay | Completed UTC |
| --- | --- | --- | --- | --- |
| Platform | **60 / 0** | venviewer_platform_test | 0 → 69; replay stays 69 | 08:31:04.616 |
| Event access | **53 / 0** | venviewer_event_access_test | 0 → 69; replay stays 69 | 08:31:16.015 |

All 113 assertions passed with no failed, skipped, pending or todo cases, exit 0 and no timeout. The services use PostgreSQL 16.15 on Linux x86_64. Event access retains 28 client-schedule and 25 capability-coherence cases. Platform retains six required files covering booking/event mutations, database boundaries, retention and quote/proposal permissions. No production database was used.

The final 641f Test log explicitly shows `route-atomicity-postgres.test.ts` **13/13 passing** at **08:40:16.138 UTC**, duration **953 ms**, against the separate declared `venviewer_route_atomicity_test` service at port 55476. The suite uses an invocation-owned random fixture schema and rejects ambient production targets. It covers handler transactions, locks, concurrent claims/quotes/proposals, stale authorization and rollback. It is not a full migration or foreign-key qualification suite; migration/replay proof comes from the platform and event-access gates above. This route result is verified directly, not derived from aggregate API counts.

The final workspace invocation records **12,387 passed, 0 failed and 258 skipped**, with these package results:

| Package | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| types | 2,237 | 0 | 0 |
| reconstruction-foundry | 597 | 0 | 2 |
| web | 6,169 | 0 | 18 |
| capture-factory | 10 | 0 | 0 |
| twin-forge | 30 | 0 | 0 |
| xgrids-lcc2 | 70 | 0 | 0 |
| reconstruction-foundry CLI | 330 | 0 | 0 |
| API | 2,944 | 0 | 238 |

The corrected dependency-pin guard passes **3/3** at 08:32:03.829 UTC; the image-runtime diagnostic passes **2/2** at 08:34:02.599 UTC. The dedicated database gates above have zero skips, and all 13 route-atomicity cases explicitly ran; the broad workspace invocation retains its conditional skips and is not represented as zero skips.

Evidence: [mandatory gates before integration](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/pre-integration-gates.json), [completed final Test log](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/104309582093-Test.log), [platform receipt](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/platform-postgres-results-34947244086/1789461054439-9a0997ff-d093-4b9e-bd0f-a1f94071d9bd/receipt.json), [event-access receipt](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/event-access-postgres-results-34947244086/1789461068771-e9ead7fe-18b0-4c5a-973d-c27f93ba7e37/receipt.json), [preceding failed Test log](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34945845018/104305009370-Test.log).

## Rendered saved-planner and schedule verification

The owned f9 build was exercised using a real local API and fresh disposable PostgreSQL, with the existing explicit fixture-auth flag and a synthetic client. Its source stayed clean and unchanged through the check. The only later f9 → 641f delta is two expected version strings in a types test; it changes no application production implementation. The fixture-auth build is explicitly not deployable.

The rendered journey preserved the saved plan's **162 objects: 18 tables and 144 chairs**, opened and dismissed the Flow warning annotation, restored focus, navigated to the eight-phase event schedule and back to the same event. The client schedule did not expose the internal booking-time control. At an emulated 390 × 844 viewport, document width remained 390. Seven screenshots, read-only request evidence and before/after database checks are retained. Existing object rows matched and email rows remained zero.

Console evidence has zero errors and one shader signed/unsigned warning; renderer disposal logged context loss. Public Google Fonts were allowed to render the intended typography. Other external requests and non-read HTTP methods were blocked. The check does not qualify Clerk provider integration, ordinary-client production authorization, physical mobile devices, 60fps, simulation accuracy or founder visual acceptance. Existing annotation crowding remains a separate product-quality issue.

Evidence: [browser qualification](D:/codex/venviewer-dependency-security-20260915/evidence/browser-qualification.json), [build/source receipt](D:/codex/venviewer-dependency-security-20260915/evidence/goal16-browser-web-build.json), [browser request log](D:/codex/venviewer-dependency-security-20260915/evidence/browser-requests.txt), [saved-planner screenshot](D:/codex/venviewer-dependency-security-20260915/output/playwright/goal16/02-saved-planner.png), [Flow warning](D:/codex/venviewer-dependency-security-20260915/output/playwright/goal16/03-flow-warning-open.png), [mobile schedule](D:/codex/venviewer-dependency-security-20260915/output/playwright/goal16/06-planner-schedule-mobile.png).

## Retained failed evidence and corrections

The first candidate's [CI 34945164248](https://github.com/codemaker66/omnitwin/actions/runs/34945164248) correctly failed lint on an implicit nullable-string condition and failed one native case because the fully read-only harness prevented libvips scratch files. The explicit condition and bounded temporary mount corrected the causes. The 70-million-pixel boundary and failure propagation remain intact; no limit or lint rule was weakened.

The next candidate's [CI 34945845018](https://github.com/codemaker66/omnitwin/actions/runs/34945845018) passed native 12/12, audit, lint, typecheck, build and required PostgreSQL gates, but Test caught two stale Vitest 4.1.8 expectations in the existing pin guard. Updating them to the intended 4.1.11 pin preserved that guard. Its focused three tests and the final 641f workspace Test job now pass; the failed f9 evidence remains retained.

Local Docker Desktop could not start because of a stale inference socket. Automatic approval review rejected removing that socket; the removal was not performed and repair was not pursued further. The existing GitHub runner supplied actual Linux image qualification instead. This local limitation did not justify substituting Windows version evidence for the required Linux result.

## Serial release, live journey and public smoke

T-601 reserved the next serial release slot after mandatory qualification and accepted lane handback after the actual provider/native/live/smoke checks. Immediately before integration, remote master remained54ebfc61 and Railway had no competing active deployment. The clean release checkout contained only qualified641f source, with no fixture-auth build or owned dependency directory. Only the three existing non-secret build identity variables were set with skip-deploys; master was fast-forwarded normally, without force, and the existing provider integrations performed one API/web rollout. No manual duplicate deployment or schema migration was needed.

| Evidence | Observed result |
| --- | --- |
| Integrated source / PR | `641f26674bde55102221042e42967619bbd8b607`; PR15 merged08:45:48UTC |
| Railway deployment | `a4963f16-2efe-49f9-928b-842de0df99ae`; source641f; success08:49:02UTC |
| Running decoder | Startup08:48:55UTC; Sharp0.35.4 / libvips8.18.6 / libheif1.23.2 / WebP1.6.0; Linuxx64, musl, Node22.23.2 |
| Railway image digest | `sha256:7bd73a67b094a2eb51ec610d7e93886982a8b3d4f577d11cfedbba9c650dfa59`; config digest`sha256:cbd0d6e2cb6580eef869503d15e1df7ce725ad5cecd367178546683c587197aa` |
| API live/version/readiness | HTTP200; ready statusok; version0.0.4, gitSha641f, production, builtAt08:45:42UTC |
| Vercel production | GitHub deployment6455104527, success08:47:06UTC; overview`9keycVP8QoUN1dzhk2agzVaRUNos` |
| Custom domain | Authenticated provider overview shows Ready, Production, exact641f commit and Current Domains: venviewer.com |
| Raw public HTML SHA-256 | `9665a43adbe267e760b798ede9aefcc51715baf5ebf7556124f53ba84931257e` |
| Observed boot assets | `/assets/index-DTyPHiJW.js`; `/assets/index-DNroCu9R.css` |

The freshly reloaded existing founder account opened event`fa64096b-4bbe-4d76-87a8-2b938343d863`, its approved plan`3b18bfc3-4a40-4723-8130-13134c80e16e`, and the saved162objects/18tables/144chairs. Flow completed its default80-agent simulation; the review warning expanded with readable details, dismissed, and restored focus to the collapsed warning. The admin event-details panel opened and closed without edits, and browser Back returned to the same eight-phase event schedule. Actual screenshots were inspected through CUA. The page DOM independently showed the new boot script and eight phase headings.

This is an existing platform-admin provider journey. Its internal Booking time control and admin detail panel are expected for that account; ordinary-client provider/navigation acceptance is not inferred from it. The client-specific navigation was separately exercised with a synthetic local identity. No save, freeze, approval, booking or Send action was performed. No production SQL before/after audit was performed, so the stronger row-preservation claim belongs only to the local fixture evidence.

The unchanged public-smoke wrapper passed **15/15 checks, exit0**, at08:50:24–08:50:29UTC. Its result is intentionally named PUBLIC_CHECKS_PASSED_AUTHENTICATED_DEMO_UNVERIFIED; authenticated behavior is established separately above. A byte-exact passing prepared configuration replaced final-config only after validation, with the previous file retained at`D:/claude/demo-smoke-readonly-20260906/final-config.before-641f2667-20260915T085024Z.json`. Only API/web expectedSHA, HTML hash, provider receipt and the changed bootJS path differed; CSS and the full route/artifact allowlist remained unchanged.

The new config SHA-256 is`394fcce414af32ec184e55616aaab177245dab01baade45e7a5698cd6f3a5692`; the prior hash is`5b82572bf2f86097960c613e32135d73f8b6d681270e464f7327be93d1a9c247`. Runner/wrapper hashes and full exported scheduler XML match before/after. VenviewerSmokeMON remains Ready, last result0, next existing run21September08:00BST. No task schedule, settings, notification consumer or credential was added.

Release proof: [merged PR receipt](D:/codex/venviewer-dependency-security-20260915/evidence/integrated-pr15.json), [pre-release provider state](D:/codex/venviewer-dependency-security-20260915/evidence/railway-immediate-pre-release.json), [Railway production](D:/codex/venviewer-dependency-security-20260915/evidence/railway-production-deployment.json), [running native binding](D:/codex/venviewer-dependency-security-20260915/evidence/running-native-binding.json), [private native event](D:/codex/venviewer-dependency-security-20260915/evidence/railway-running-native-message.jsonl), [Vercel source/domain observation](D:/codex/venviewer-dependency-security-20260915/evidence/web-provider-ui-641f2667.json), [public identity](D:/codex/venviewer-dependency-security-20260915/evidence/public-release-identity-641f2667.json), [live journey](D:/codex/venviewer-dependency-security-20260915/evidence/live-journey-641f2667.json), [15-check result](D:/claude/demo-smoke-readonly-20260906/final-results/2026-09-15T08-50-24.676Z-adc152dd.json), [config rotation](D:/codex/venviewer-dependency-security-20260915/evidence/smoke-rotation.json), [scheduler/runner preservation](D:/codex/venviewer-dependency-security-20260915/evidence/smoke-preservation.json).

The old web/API provider revisions remain identified in the baseline and pre-release receipts; no schema change complicates a compatible rollback. Redeploying the prior API would restore the vulnerable native dependency and is not security remediation. Original captures, T-605 work and0071/0072 reservations, prior Goal14/15 evidence and the CMS hold were untouched. All owned local test services were stopped; synthetic files and failed evidence remain retained.

## Remaining limits and completion criteria

The bounded security slice is delivered with source, actual running-native and live/public-smoke evidence. Independent final record review and task/goal/F-15/session closeout are complete. The [inspected Railway production-project service inventory](D:/codex/venviewer-dependency-security-20260915/evidence/railway-service-inventory.json) contains only `@omnitwin/api` (service `38c3240d-3540-4d69-936c-0b3041e48aad`); it identifies no separate capture worker in that inspected project. This does not establish the inventory of other projects or hosts, nor claim that any worker there was patched by this API release.

The released baseline's broad E2E inventory is **84 failed, 114 passed, 37 skipped and116 not run**. Final candidate CI34947244086 finishes with **85 failed, 106 passed, 28 skipped and132 not run** across four failed browser shards (17/44/6/18 failures). Overall CI is therefore **failure**, while its six mandatory security/regression jobs pass. There are82 overlapping failure names and **three newly observed failures**, all of which executed without failure in the compared baseline:

- Venue-settings save: nonexact `getByText('Saved')` matches both the Saved status and the Venue settings saved toast after the saved-payload assertion passes.
- Planner tool-pill: the room-resolve settle assertion expects resolved or fallback, but remains unavailable for90seconds on each attempt before the tool/escape/clearance assertions can finish.
- Twin room-hop: the150ms long-task budget sees166/193/180ms after room/imagery assertions pass.

The three are not relabeled as baseline failures. Application web-source and E2E-source have no diff in this security increment, but that alone does not establish dependency independence or dismiss these results. T-601 / Goal17 received the complete comparison and owns repair. Successful narrow local/live journeys do not establish every planner tool or the room-hop performance budget. Shard3 reached its1560-second suite/teardown timeout with72 cases not run and two additional non-test timeout errors. Differences in unexecuted/skipped cases mean that a missing failure name is not automatically a repaired test. [Exact all-shard comparison](D:/codex/venviewer-dependency-security-20260915/evidence/ci-34947244086/e2e-baseline-comparison.json) retains names and trigger evidence; the original failed logs remain available.

This security slice does not complete F-15 access/privacy lifecycle, ordinary-client provider/revocation acceptance, DMs, water/AV requests, operations synchronization, physical-mobile 60fps, reconstruction quality or founder design acceptance. It makes no claim that the full Friday platform is ready for public use.

| Goal criterion | Disposition |
| --- | --- |
| 1. Current baseline and applicability | Evidence retained; independent advisory review complete |
| 2. Reproducible patched dependencies | Frozen install, exact pins, installed closure and unchanged zero-finding audit evidenced |
| 3. Real native-library verification | Actual API image12/12 and independently inspected running Railway native versions pass |
| 4. Preserved behavior | Final Test 12,387 pass/0 fail/258 conditional skips; separate 113 PostgreSQL cases and 13 route cases ran without skips; Spark 44/44 and rendered f9 journey pass |
| 5. Independent review and delivery | Independent reviews retained; serial API/web delivery, actual live journey and15public smoke checks pass |
| 6. Honest closeout | Final report, independent review and scoped task/goal/F-15/session closeout complete |


Final independent review: [six-criterion and record audit](D:/codex/venviewer-dependency-security-20260915/evidence/final-review.md). Goal16 is complete for this bounded security delivery; Goal17 and the wider Friday programme remain active.
