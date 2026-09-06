# Trades Hall demo release integration — 6 September 2026

This is an isolated local release candidate, not a deployed or newly qualified
combined application. The parent release coordinator owns final verification,
production migration and publication. The newer founder request is to make
inventory and completed project work live and ready for the 7 September demo.

## Exact source composition

Worktree: `D:/claude/venviewer-demo-release-20260906`, branch
`codex/trades-hall-demo-release`, created from exact `fffae64d`. That commit is a
documentation follow-up to the qualified combined application `b0477037`.

| Source | Local integration | Scope |
| --- | --- | --- |
| `3584afc2` | `a39df9a7` | Audited physical-stock domain |
| `42aebd34` | `ff754a8d` | Venue-admin stock API, editor and audited corrections |
| `b563183e` | `5376a4bc` | Reservations, shortage projection and admin-approved internal remedy requests |
| Reviewed application subset of `d044dec6` | `32fb2d02` | Selected inventory style, guarded navigation and real browser regression coverage |
| `dd3296c8` | `45ba21b5` | Docker patch inputs and supported Node prerequisite |
| `febf53e6` | `813231cb` | Node 22.23.2 image default |

The current viewer coordinator owns a further Capture-placement/coach repair.
Its forthcoming tested commit is not included in the hashes above.

## Conflict decisions

- The demo manifest, lockfile and composed Spark lifecycle/ZIP64 patch are
  unchanged. Do not replace them with the inventory parent's security-only patch.
  Three remains 0.180.0 and Spark remains 2.1.0.
- Inventory routes register alongside existing venue routes. The schema retains
  the demo's replacement of the canonical-layout configuration uniqueness
  constraint with a configuration/created/id index, plus all new inventory tables.
  Shared types preserve the new hallkeeper floor-plan exports and inventory exports.
- The API client retains readable nested/invalid-body errors and adds the
  inventory POST cancellation signal. One does not replace the other.
- DashboardLayout uses the verified inventory version. It restores the earlier
  venue request-ownership/Activity prerequisite absent from the demo branch and
  retains role-aware navigation, actual notifications and dirty/busy sign-out
  protection. DashboardPage preserves unsaved edits until the router accepts
  navigation. Inventory and focus-trap source match the selected-style commit.
- The demo already contains the missing PlannerCockpit CSS closing brace; its
  version is retained. Router, viewer and shared Activity source are unchanged.
- The original private inventory commit remains the full source/design archive.
  Its raw DOCX, equipment JSON, detailed source review and source-rich planning
  documents are excluded from this public-release ancestry. The selected image,
  generated illustration bytes/digests and a concise experience brief are included.
  No operational inventory import or venue facts are inferred from preview figures.

## Migration reconciliation

All existing SQL through 0063 and their journal entries are unchanged. The active
production preflight reported to this integration owner has 60 applied entries
through 0061; it therefore still needs existing 0062 and 0063 before the new tail.
The release coordinator owns the exact active-target preflight and immutable
prefix check; an older unrelated database receipt is not production evidence.

| Index | Tag | Timestamp |
| --- | --- | --- |
| 62 | `0064_manual_layout_evidence` | `1788717600000` |
| 63 | `0065_venue_inventory` | `1788717700000` |
| 64 | `0066_inventory_reservations` | `1788717800000` |

The two inventory SQL files retain their original SQL contents under the new
names. Their tests use those names. The increasing timestamps matter because
Drizzle determines pending migrations relative to the applied timestamp. Keeping
the inventory branch's older timestamps after manual-layout evidence could skip
inventory migration on a database already at the demo tail.

## Verification boundary

At this documentation point, source comparisons and staged diff checks pass;
the selected inventory application files match their verified source, and the
demo manifest/lock/Spark/router/viewer files remain unchanged. No combined test,
dependency installation, database mutation or deployment has yet been performed
by this integration task. Prior test receipts belong to their stated candidates.

Before publication, coordinate one frozen source and independently owned install
for the following boundaries:

- `pnpm install --frozen-lockfile` in this new worktree; inspect module ownership
  first. Never install through another candidate's junctions.
- `pnpm -r run typecheck`, `pnpm -r run lint`, applicable workspace tests and
  `pnpm -r run build` on the combined source. Include real inventory, route atomicity,
  manual-layout/frozen-evidence and migration-readiness regressions.
- Apply the complete 65-entry journal to a newly created disposable PostgreSQL
  database. Verify every entry, the canonical-layout index change, inventory
  constraints and history triggers. Recheck the actual production prefix through
  the read-only deployment helper before any production write.
- `node --test tools/deployment/docker-prerequisites.test.mjs`, then a real Linux
  API image build/boot. Windows source inspection does not qualify that image.
- Exercise the actual inventory reservation, stock and navigation Playwright
  suites serially against fresh disposable fixtures. Preserve quota pacing,
  mutation failures, unsaved corrections and true authentication boundaries.
- Qualify the combined demo journey and real production account/build settings,
  then verify the deployed API/web revisions and smoke flows under the parent
  coordinator's release sequence.

The source is not aesthetically accepted or physically device-qualified by these
integration comparisons. Full reconstruction, PSNR 50+ and physical-device 60fps
remain separate open requirements.
