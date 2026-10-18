# People Book slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One venue-scoped record per client person and organisation or household, with several emails and phones, memberships, an owner, duplicate suggestions and undoable merges, served by a commercial-only API, filled from today's data by a proven backfill, and fed by public enquiries and "Create opportunity" without making a duplicate each time.

**Architecture:** `contacts` and `client_accounts` are evolved in place by one additive migration that also backfills them; three new tables (`contact_points`, `account_memberships`, `record_merges`) hang off them with composite `(id, venue_id)` keys so tenancy is held by the database as well as the code. Small services under `packages/api/src/services/people-*.ts` own the writes (each in one transaction, locked in one fixed order), and one Fastify plugin, `routes/people.ts`, is their only door. The legacy columns (`contacts.email`, `contacts.phone`, `contacts.client_account_id`) stay as mirrors of the primary point and membership, so every existing reader keeps working unchanged.

**Tech Stack:** TypeScript (strict), Fastify, Drizzle ORM on PostgreSQL 16 with `pg_trgm` (migration 0081), Zod, Vitest, Playwright (one e2e edit), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-18-people-book-design.md` (approved by Blake on 18 October 2026); slice 1 is its section 7 item 1, with the scope the chief of staff decided on 18 October restated under "Scope" below.

## Global Constraints

- TypeScript strict, no `any`; Zod parses every request param, query and body, and every `record_merges` jsonb value read back.
- Tenancy: every query names the venue; another venue's person, organisation or merge answers 404 `NOT_FOUND`, never 403; `contact_points` and `account_memberships` carry composite `(id, venue_id)` foreign keys.
- Roles: every `/people` route is `canManageCommercial` (admin, manager, staff, sales; platform admins everywhere); hallkeeper, planner, client, caterer and a venue role with no venue get 403 before anything is read.
- Hallkeepers keep exactly today's `/clients` access; sales gains the Clients desk (`routes/clients.ts` and `CLIENT_SEARCH_ROLES`).
- Idempotent writes: advisory locks `crm-from-enquiry:<enquiryId>` (kept), `people-email:<venueId>:<normalisedEmail>` and `people-merge:<venueId>`, each taken with `pg_advisory_xact_lock(hashtextextended(<key>, 0))`; unique keys `(contact_id, kind, value)`, `(contact_id, client_account_id)` and `(venue_id, source_system, source_id) WHERE source_id IS NOT NULL`.
- Lock order in every transaction: advisory locks first, then `contacts` rows `FOR UPDATE` in ascending id, then the rows that point at them; a person is locked and re-checked as live before anything is linked to it.
- "Live" means `deleted_at IS NULL AND merged_into_id IS NULL AND erased_at IS NULL`; a merged person is a tombstone (`merged_into_id` and `deleted_at` set together), never deleted.
- Mirrors: `contacts.email`, `contacts.phone` and `contacts.client_account_id` equal the primary email point's `display_value`, the primary phone point's `display_value` and the primary membership's account, rewritten by `refreshContactMirror` in the same transaction as every write to points or memberships.
- A person with points of a kind has exactly one primary of that kind; a person with memberships has exactly one primary membership (`refreshContactMirror` promotes the oldest when none is primary).
- Schema first: the migration is additive and the previous API keeps working on it (new columns nullable, `client_accounts.kind` defaults to `'household'`).
- Migration number is provisional: `0094_people_book`, journal `idx` 92, `when` 1792076400000; origin/master `e1cf4e62` ends at `0093_forward_book_checks` (`when` 1791990000000). The chief of staff assigns the final number at merge; the `when` must exceed the journal's last; renumbering touches the SQL file name, the journal entry and the `TAG` and previous-tag constants in both migration tests.
- Database tests run only on `VENVIEWER_ROUTE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_route_atomicity_test` or `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test` (plus the venue-slug file's own `VENVIEWER_PUBLIC_ENQUIRY_TEST_DATABASE_URL`, Task 9); never `DATABASE_URL`, never `.env`.
- Route tests for every role gate: 401 without a token, 403 for each refused role, sales admitted.
- Fixtures are fictional: invented names, emails at `example.test` or `.invalid`, phones from Ofcom's drama ranges (0141 496 0000–0999, 07700 900000–900999).
- Keep history: never delete status histories, activities or `record_merges` rows; points and memberships a merge removes live on in its snapshot and come back on undo.
- Personal data stays out of logs and error tracking: log ids and outcomes, never names, emails or phones.
- Responses are `{ data }`, errors `{ error, code }`, every message in British English.
- No new desk UI in this slice; every visible wait in later slices uses `packages/web/src/components/shared/Activity.tsx`.

## Review Focus

1. Phones typed in different shapes ("+44 7700 900123", "07700 900 123", "+44 (0)141 496 0000", "0044 141 496 0000") are one number: adding a second shape to a person who holds the first answers with the existing point, and search finds the person from any shape. Tests: Task 6 and Task 8.
2. A returning guest types their email with other capitals or stray spaces (" Aileen.Murray@Example.TEST ") on the website form: the enquiry links to their existing person at that venue and nobody new is made. Test: Task 9.
3. A couple sharing one email, the wedding norm: a new enquiry from it links neither and makes no third record, and "Create opportunity" on it makes a new person rather than choosing one of them. Tests: Task 9 and Task 10.
4. Two people press Merge on the same pair at once in opposite directions, or one person presses twice: exactly one merge happens, the double press answers with that same merge, the opposite one is refused, and nothing is left half-moved. Test: Task 11.
5. A colleague moves a deal to someone else after a merge, and the merge is then undone: the deal stays where the colleague put it, the undo names it as skipped, and everything else is restored. Test: Task 12.

---

## Scope (decided by the chief of staff, 18 October 2026)

**In:** the record and its API, no new desk UI: the migration and backfill (Task 2); shared types and normalisers (Task 1); the `/people` API for search, people, contact points, memberships, organisations or households, duplicate suggestions, merge preview, merge, undo and tombstones (Tasks 5–8, 11, 12); public enquiries linking to a person and `guest_leads` becoming insert-only (Task 9); create-from-enquiry reusing the person (Task 10); sales on the Clients desk (Task 4), and the web readers that must accept a person without an email (Task 3).

**Out:** the People Book desk and timeline (slice 2); consent, export, erasure and the retention job (slice 3; the working copy of the design moves the job there, the committed copy names T-661); the Salesforce import (slice 4); event parties and "same again" (slice 5); guests (wave 2). Not built here although the schema allows them later: organisation merges (`record_merges.kind` admits `'organisation'`) and marking a duplicate suggestion as "kept apart".

## Where the code goes

| Path | Change | Responsibility |
| --- | --- | --- |
| `packages/types/src/people.ts` | create | Vocabularies, `normaliseEmail`, `normalisePhone`, `isUsablePhone`, every people Zod schema |
| `packages/types/src/index.ts` | modify | `export * from "./people.js"` |
| `packages/api/drizzle/0094_people_book.sql` | create | Schema, SQL normalisers and backfill, one transaction |
| `packages/api/drizzle/meta/_journal.json` | modify | Journal entry idx 92 |
| `packages/api/src/db/schema.ts` | modify | Columns on `contacts`, `client_accounts`, `enquiries`; tables `contactPoints`, `accountMemberships`, `recordMerges` |
| `packages/api/src/services/people-records.ts` | create | Person writes, contact points, memberships, mirrors, the person profile |
| `packages/api/src/services/people-organisations.ts` | create | Organisation or household writes and profile |
| `packages/api/src/services/people-duplicates.ts` | create | Duplicate suggestions |
| `packages/api/src/services/people-search.ts` | create | Search over names and contact points |
| `packages/api/src/services/people-link.ts` | create | Enquiry-to-person linking and the household for a deal |
| `packages/api/src/services/people-merge.ts` | create | Merge preview, apply and undo |
| `packages/api/src/routes/people.ts` | create | The `/people` plugin |
| `packages/api/src/index.ts` | modify | Register `peopleRoutes` at `/people` |
| `packages/api/src/routes/public-enquiries.ts` | modify | One transaction; link the person; guest lead insert-only |
| `packages/api/src/routes/crm.ts` | modify | Create-from-enquiry reuses the person and their organisation |
| `packages/api/src/routes/clients.ts`, `utils/query.ts` | modify | `canReadClients` admits sales |
| `packages/api/src/services/client-search.ts` | modify | Contact email may be null; export `matcher` |
| `packages/api/src/scripts/run-platform-postgres-tests.ts` | modify | The four new platform test files |
| `packages/web/src/api/clients.ts`, `api/crm.ts`, `components/dashboard/clients/ClientPanel.tsx`, `components/dashboard/pipeline/DealPanel.tsx` | modify | Read a contact with no email |
| `packages/web/src/lib/role-capabilities.ts` | modify | `CLIENT_SEARCH_ROLES` gains sales |
| `packages/api/src/__tests__/support/people-platform-fixture.ts` | create | Shared fixture for the platform-database people tests |
| tests | create / modify | Named in each task |

---

### Task 1: Shared people types and normalisers

**Files:**
- Create: `packages/types/src/people.ts`
- Modify: `packages/types/src/index.ts` (append after the last line, 2552 on origin/master)
- Test: `packages/types/src/__tests__/people.test.ts`

**Interfaces:**
- Consumes: `VenueIdSchema` (`./venue.js`), `UserIdSchema` (`./user.js`), `EnquiryIdSchema` (`./enquiry.js`), `ContactIdSchema`, `ClientAccountIdSchema` (`./commercial-spine.js`).
- Produces (all exported from `@omnitwin/types`):
  - `CONTACT_POINT_KINDS = ["email", "phone"]`, `CONTACT_POINT_LABELS = ["work", "personal", "mobile", "other"]`, `CLIENT_ACCOUNT_KINDS = ["organisation", "household"]`, `DUPLICATE_REASONS = ["shared_email", "shared_phone", "close_name"]`, `MERGE_KINDS = ["person", "organisation"]`, `MERGE_MOVE_TARGETS = ["contact_points.contact_id", "account_memberships.contact_id", "enquiries.contact_id", "opportunities.primary_contact_id", "client_accounts.primary_contact_id", "contacts.merged_into_id"]` (the merge's order), `MERGE_FILLED_FIELDS = ["givenName", "familyName", "jobTitle", "postalAddress", "notes", "ownerUserId", "lastContactAt"]`, each `as const` with its `…Schema` (`z.enum`) and type (`ContactPointKind`, `ContactPointLabel`, `ClientAccountKind`, `DuplicateReason`, `MergeKind`, `MergeMoveTarget`, `MergeFilledField`).
  - `PHONE_DIGITS_MIN = 6`, `PHONE_DIGITS_MAX = 15`, `MERGE_UNDO_DAYS = 30`, `CLOSE_NAME_SIMILARITY = 0.6`.
  - `normaliseEmail(raw: string | null | undefined): string | null`, `normalisePhone(raw: string | null | undefined): string | null`, `isUsablePhone(raw: string): boolean`.
  - Schemas and their inferred types, fields as in the table in Step 4: `ContactPointInputSchema`, `ContactPointSchema`, `ContactPointRowSchema`, `PersonSchema`, `PersonRowSchema`, `OrganisationSchema`, `MembershipRowSchema`, `PersonMembershipSchema`, `PersonProfileSchema`, `OrganisationProfileSchema`, `CreatePersonSchema`, `UpdatePersonSchema`, `CreateOrganisationSchema`, `UpdateOrganisationSchema`, `SetMembershipsSchema`, `PeopleSearchQuerySchema`, `PeopleSearchResultsSchema`, `DuplicateSuggestionSchema`, `MergeRequestSchema`, `MergeMovesSchema`, `MergePreviewSchema`, `MergeResultSchema`, `MergeSkipSchema`, `MergeUndoReportSchema`, `MergeUndoResultSchema`, `RecordMergeMoveSchema`, `RecordMergeSnapshotSchema`.

- [ ] **Step 1: Bring the branch up to date and build**

Run: `git -C E:/claude/people-book-20261018 merge origin/master`, then `pnpm install --frozen-lockfile` and `pnpm --filter @omnitwin/types build`.
Expected: a clean merge (the branch holds only design documents) and a green build. The uncommitted edit to the design file stays uncommitted; never stage it.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  ContactPointInputSchema, CreatePersonSchema, PersonProfileSchema, SetMembershipsSchema, UpdatePersonSchema,
  isUsablePhone, normaliseEmail, normalisePhone,
} from "../people.js";

const VENUE = "00000000-0000-4000-8000-0000000000a1";
const ORG_A = "00000000-0000-4000-8000-0000000000b1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

describe("normaliseEmail", () => {
  it("lowercases and trims, and gives none for a blank", () => {
    expect(normaliseEmail(" Aileen.Murray@Example.TEST ")).toBe("aileen.murray@example.test");
    expect(normaliseEmail("\tkirsty@example.test\n")).toBe("kirsty@example.test");
    for (const blank of ["", "   ", null, undefined]) expect(normaliseEmail(blank)).toBeNull();
  });
});

const PHONE_CASES = [
  ["07700 900123", "07700900123"], ["+44 7700 900123", "07700900123"], ["0044 7700 900123", "07700900123"],
  ["00 44 7700 900123", "07700900123"], ["+44 (0)141 496 0000", "01414960000"], ["+44 0141 496 0000", "01414960000"],
  ["(0141) 496-0000", "01414960000"], ["+1 (212) 555-0100", "+12125550100"], ["44 141 496 0000", "441414960000"],
  ["0141 496 0000 ext 12", "0141496000012"], ["+44", null], ["+", null], ["  ", null], ["", null],
] as const;

describe("normalisePhone", () => {
  it.each(PHONE_CASES)("%s is %s", (raw, expected) => { expect(normalisePhone(raw)).toBe(expected); });
  it("gives none for no value", () => { expect(normalisePhone(null)).toBeNull(); expect(normalisePhone(undefined)).toBeNull(); });
  it("takes 6 to 15 digits as a usable number", () => {
    expect(isUsablePhone("07700 900123")).toBe(true);
    expect(isUsablePhone("+1 (212) 555-0100")).toBe(true);
    expect(isUsablePhone("12345")).toBe(false);
    expect(isUsablePhone("+44 7700 900123 456789")).toBe(false);
    expect(isUsablePhone("call me")).toBe(false);
  });
});

describe("the people contracts", () => {
  it("takes an email or a usable phone as a contact point", () => {
    expect(ContactPointInputSchema.parse({ kind: "email", value: " Aileen.Murray@Example.TEST " }))
      .toEqual({ kind: "email", value: "Aileen.Murray@Example.TEST", label: "other", isPrimary: false });
    expect(ContactPointInputSchema.safeParse({ kind: "phone", value: "123" }).success).toBe(false);
    expect(ContactPointInputSchema.safeParse({ kind: "email", value: "not an email" }).success).toBe(false);
    expect(ContactPointInputSchema.safeParse({ kind: "fax", value: "0141 496 0000" }).success).toBe(false);
  });
  it("needs a name and turns blank optional text into none", () => {
    expect(CreatePersonSchema.parse({ venueId: VENUE, name: " Aileen Murray ", jobTitle: "  " }))
      .toMatchObject({ name: "Aileen Murray", jobTitle: null, contactPoints: [] });
    expect(CreatePersonSchema.safeParse({ venueId: VENUE, name: "   " }).success).toBe(false);
  });
  it("refuses an edit that changes nothing", () => {
    expect(UpdatePersonSchema.safeParse({ expectedUpdatedAt: "2026-10-18T09:00:00.000Z" }).success).toBe(false);
  });
  it("allows one primary organisation, and each organisation once", () => {
    expect(SetMembershipsSchema.safeParse({ memberships: [{ organisationId: ORG_A, isPrimary: true }, { organisationId: ORG_B, isPrimary: true }] }).success).toBe(false);
    expect(SetMembershipsSchema.safeParse({ memberships: [{ organisationId: ORG_A }, { organisationId: ORG_A }] }).success).toBe(false);
    expect(SetMembershipsSchema.parse({ memberships: [] })).toEqual({ memberships: [] });
  });
  it("reads a merged person as where they went", () => {
    const merged = PersonProfileSchema.parse({ status: "merged", mergedInto: { id: ORG_A, name: "Aileen Murray" }, mergeId: ORG_B, mergedAt: "2026-10-18T09:00:00.000Z" });
    expect(merged.status).toBe("merged");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @omnitwin/types exec vitest run src/__tests__/people.test.ts`
Expected: FAIL, `Failed to resolve import "../people.js"`.

- [ ] **Step 4: Implement `packages/types/src/people.ts` and the index export**

`normaliseEmail`: `raw.trim().toLowerCase()`, null when empty. `normalisePhone`, the same algorithm the SQL function in Task 2 runs:

```text
s = raw.trim(); d = s with every non-digit removed; if d is empty: null
if s starts with "+":    if d starts with "44": r = d without "44"; return r empty ? null : (r starts with "0" ? r : "0" + r)
                         else return "+" + d
if d starts with "0044": r = d without "0044"; return r empty ? null : (r starts with "0" ? r : "0" + r)
return d
```

`isUsablePhone(raw)`: `normalisePhone(raw)` is not null and its digits (a leading `+` not counted) number from `PHONE_DIGITS_MIN` to `PHONE_DIGITS_MAX`. A private `optionalText(max)` is `z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional()`. Dates are ISO strings (`z.string().datetime()`), ids `z.string().uuid()`; a field is nullable where its column is.

| Schema | Fields and rules |
| --- | --- |
| `ContactPointInputSchema` | `z.discriminatedUnion("kind")`: email `value` `trim().email().max(255)`; phone `value` `trim().min(1).max(50)` refined by `isUsablePhone`, message "A phone number needs 6 to 15 digits"; both `label` default `"other"`, `isPrimary` default `false` |
| `ContactPointSchema` | `id, contactId, kind, value, displayValue, label, isPrimary, sourceSystem, sourceId, createdAt` |
| `ContactPointRowSchema` | `ContactPointSchema` plus `venueId, updatedAt` |
| `PersonSchema` | `id, venueId, name, givenName, familyName, jobTitle, postalAddress, notes, roleLabel, email, phone, clientAccountId, ownerUserId, lastContactAt, sourceSystem, sourceId, sourceEnquiryId, createdAt, updatedAt` |
| `PersonRowSchema` | `PersonSchema` plus `mergedIntoId, erasedAt, deletedAt` |
| `OrganisationSchema` | `id, venueId, name, kind, accountType, address, website, vatNumber, notes, ownerUserId, primaryContactId, sourceSystem, sourceId, sourceEnquiryId, createdAt, updatedAt` |
| `MembershipRowSchema` | `id, venueId, contactId, clientAccountId, roleLabel, isPrimary, createdAt, updatedAt` |
| `PersonMembershipSchema` | `id, organisation: { id, name, kind }, roleLabel, isPrimary` |
| `PersonProfileSchema` | discriminated on `status`: `"live"` with `person, contactPoints, memberships, owner: { id, name } \| null, duplicateSuggestionCount` (int ≥ 0); `"merged"` with `mergedInto: { id, name }, mergeId, mergedAt` |
| `OrganisationProfileSchema` | `organisation, members: [{ personId, name, roleLabel, isPrimary }], owner: { id, name } \| null` |
| `CreatePersonSchema` | `venueId`; `name` `trim().min(1).max(200)`; `givenName, familyName` optionalText(100); `jobTitle, roleLabel` optionalText(120); `postalAddress` optionalText(1000); `notes` optionalText(5000); `ownerUserId` uuid nullable optional; `contactPoints` array of `ContactPointInputSchema`, max 10, default `[]` |
| `UpdatePersonSchema` | the create fields without `venueId` and `contactPoints`, all optional, plus `expectedUpdatedAt` datetime optional; refined: at least one field other than `expectedUpdatedAt` |
| `CreateOrganisationSchema` | `venueId`; `name` 1..200; `kind`; `address` optionalText(1000); `website` optionalText(255); `vatNumber` optionalText(40); `notes` optionalText(5000); `ownerUserId` |
| `UpdateOrganisationSchema` | as `UpdatePersonSchema`, over the organisation fields |
| `SetMembershipsSchema` | `memberships`: array (max 20) of `{ organisationId, roleLabel optionalText(120), isPrimary default false }`; refined: at most one primary, each `organisationId` once |
| `PeopleSearchQuerySchema` | `q` `trim().min(2).max(200)` |
| `PeopleSearchResultsSchema` | `people: [{ id, name, organisationName, email, phone, matched: "name" \| "email" \| "phone" }]`, `organisations: [{ id, name, kind, memberCount }]` |
| `DuplicateSuggestionSchema` | `person: { id, name, organisationName }`, `reasons` array of `DuplicateReasonSchema`, min 1 |
| `MergeRequestSchema` | `survivorId: ContactIdSchema` |
| `MergeMovesSchema` | an object with every `MERGE_MOVE_TARGETS` key, each an int ≥ 0 |
| `MergePreviewSchema` | `survivor: { id, name }, merged: { id, name }, moves, alreadyHeld: { contactPoints, memberships }` |
| `MergeResultSchema` | `mergeId, survivorId, mergedId, moves, alreadyHeld, undoUntil, replayed` |
| `MergeSkipSchema` | `target: MergeMoveTarget \| "survivor_field" \| "removed_row"`, `ref` (a row id, or a field name for `survivor_field`) |
| `MergeUndoReportSchema` | `restored: MergeMoves, skipped: MergeSkip[]` |
| `MergeUndoResultSchema` | `MergeUndoReportSchema` plus `mergeId, replayed` |
| `RecordMergeMoveSchema` | `target: MergeMoveTarget, ids: uuid[]` |
| `RecordMergeSnapshotSchema` | `person: PersonRow, contactPoints: ContactPointRow[], memberships: MembershipRow[], removed: { contactPointIds, membershipIds }, survivorFilled: [{ field: MergeFilledField, before: string \| null, after: string \| null }]` |

Append to `index.ts`: a comment line `// T-665 slice 1: the People Book's records, matching and merges.` and `export * from "./people.js";`.

- [ ] **Step 5: Run it to see it pass, and build**

Run: `pnpm --filter @omnitwin/types exec vitest run src/__tests__/people.test.ts && pnpm --filter @omnitwin/types typecheck && pnpm --filter @omnitwin/types build`
Expected: `Test Files  1 passed`, typecheck and build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/people.ts packages/types/src/index.ts packages/types/src/__tests__/people.test.ts
git commit -m "feat(types): the People Book's records, normalisers and merge contracts (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The migration, its backfill and the Drizzle schema

**Files:**
- Create: `packages/api/drizzle/0094_people_book.sql`
- Modify: `packages/api/drizzle/meta/_journal.json` (append one entry)
- Modify: `packages/api/src/db/schema.ts:28-94` (type imports), `:705-745` (`enquiries`), `:772-786` (`clientAccounts`), `:788-804` (`contacts`); new tables after `:804` and after `followUpTasks` (`:856-870`)
- Modify: `packages/api/src/services/client-search.ts:80-82` and `:233-237` (`email: string | null`)
- Test: `packages/api/src/__tests__/people-book-migration.test.ts` (no database), `packages/api/src/__tests__/people-book-migration-postgres.test.ts`

**Interfaces:**
- Consumes: Task 1's vocabularies, `normaliseEmail`, `normalisePhone`, `RecordMergeSnapshot`, `RecordMergeMove`, `MergeUndoReport`.
- Produces: Drizzle columns `contacts.givenName, familyName, jobTitle, postalAddress, notes, ownerUserId, lastContactAt, sourceSystem, sourceId, mergedIntoId, erasedAt` (and `email` nullable); `clientAccounts.kind, address, website, vatNumber, notes, ownerUserId, sourceSystem, sourceId, mergedIntoId`; `enquiries.contactId`; tables `contactPoints`, `accountMemberships`, `recordMerges`; SQL functions `people_trim(text)`, `people_normalise_email(text)`, `people_normalise_phone(text)`, `people_name_key(text)`.

- [ ] **Step 1: Start the two disposable clusters (once; Tasks 4 to 13 reuse them)**

On the fast drive, with the portable binaries at `C:/Users/blake/omnitwin2/.dev-db/pgsql/bin`. Check `netsh interface ipv4 show excludedportrange protocol=tcp` first; 55476 and 55477 must lie outside the reserved ranges.

```powershell
$bin = "C:/Users/blake/omnitwin2/.dev-db/pgsql/bin"
foreach ($c in @(@{ dir = "route"; port = 55476 }, @{ dir = "platform"; port = 55477 })) {
  & "$bin/initdb.exe" -D "E:/claude/people-book-20261018-pg/$($c.dir)" -U postgres --auth=trust -E UTF8 --no-locale
  Start-Process -FilePath "$bin/pg_ctl.exe" -WindowStyle Hidden -ArgumentList @('-D', "E:\claude\people-book-20261018-pg\$($c.dir)", '-o', "`"-p $($c.port) -c listen_addresses=127.0.0.1`"", '-l', "E:\claude\people-book-20261018-pg\$($c.dir).log", 'start')
}
# once each port answers:
& "$bin/psql.exe" -h 127.0.0.1 -p 55476 -U postgres -c "CREATE DATABASE venviewer_route_atomicity_test"
& "$bin/psql.exe" -h 127.0.0.1 -p 55477 -U postgres -c "CREATE DATABASE venviewer_platform_test"
```

If `0094_people_book.sql` changes after the platform database has applied it, the platform gate refuses the drifting journal: drop and recreate `venviewer_platform_test`, then rerun Step 10.

- [ ] **Step 2: Write the failing file test (no database)**

`people-book-migration.test.ts`, following `booking-event-bind.test.ts:36-60`:

```ts
const TAG = "0094_people_book";
const PREVIOUS = "0093_forward_book_checks";
const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ");

it("is the journal's next entry, after 0093", async () => {
  // index > 0, previous tag PREVIOUS, idx === previous.idx + 1, when > previous.when
});
it("holds the vocabularies @omnitwin/types states", async () => {
  const sql = await readFile(resolve("drizzle", `${TAG}.sql`), "utf8");
  expect(sql).toContain(`CHECK ("kind" IN (${quoted(CONTACT_POINT_KINDS)}))`);
  expect(sql).toContain(`CHECK ("label" IN (${quoted(CONTACT_POINT_LABELS)}))`);
  expect(sql).toContain(`CHECK ("kind" IN (${quoted(CLIENT_ACCOUNT_KINDS)}))`);
  expect(sql).toContain(`CHECK ("kind" IN (${quoted(MERGE_KINDS)}))`);
});
it("waits at most five seconds for a lock and creates every table idempotently", async () => {
  expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
  for (const table of ["contact_points", "account_memberships", "record_merges"]) expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
});
```

- [ ] **Step 3: Write the failing migration test on the route database**

`people-book-migration-postgres.test.ts`, in the style of `enquiry-source-migration-postgres.test.ts`: the same URL guard (127.0.0.1:55476 `/venviewer_route_atomicity_test`), `describe.skipIf(testUrl === undefined)`, a random schema on `search_path`, the same `applyMigration` (split on `--> statement-breakpoint`, one transaction). Build the tables as the release before 0094 defined them: `venues`, `users`, `opportunities`, `activities`, `proposals` and `guest_leads` from `getTableConfig` in full; `contacts`, `client_accounts` and `enquiries` from `getTableConfig` without the columns 0094 adds, with `contacts.email` declared `NOT NULL`. Every `id` is `primary key default gen_random_uuid()`, `created_at`/`updated_at` default `now()`.

Rows, at venue A unless said (every timestamp explicit):

| Key | Rows |
| --- | --- |
| C1 | Enquiry E1 (guest "Aileen Murray", " Aileen.Murray@Example.TEST ", phone "+44 7700 900123", 2026-03-01); account ACC1 named "aileen murray " with primary contact C1; contact C1 named "Aileen Murray", email " Aileen.Murray@Example.TEST ", phone "+44 7700 900123", account ACC1, role label "Primary event contact", source E1; deal D1 for C1 created 2026-03-01; an activity on D1 2026-03-02; a proposal on D1 sent 2026-03-05 |
| C2 | Account ACC2 "Glasgow Medical Society", primary contact C2 "Iain Robertson", iain@example.test, account ACC2 |
| C3, C4 | Two contacts "Morag Shaw", both morag@example.test, from enquiries E3 and E4, each with its own account; E5, unconverted, also from morag@example.test |
| Kirsty | E6 (2026-04-01, guest "Kirsty Lane", "Kirsty@Example.test", phone "0141 496 0001") and E7 (2026-05-01, guest "Kirsty Lane-Brown", "kirsty@example.test ", no phone); venue B: E8 (guest "K. Lane", "kirsty@example.test"); a guest lead for kirsty@example.test named "Overwritten By B", phone "07700 900999" |
| Euan | E9, signed in: user U1, email "planner@example.test", name "Euan Stewart", no guest fields |
| Seed | E10, fixture_source 'demo-seed', guest "Seed Guest", seed@example.test |
| C5 | Contact "Blank Email" with email "   " |

Assertions (each an `it`):

```ts
it("makes email optional and adds the columns as the Drizzle schema declares them", ...);
  // information_schema: contacts.email is_nullable YES; every added column of contacts, client_accounts and enquiries
  // matches getTableConfig (name, SQL type, notNull, default); client_accounts.kind NOT NULL default 'household'
it("gives each contact its email and phone as primary points, normalised, and trims the mirror", ...);
  // C1 points: [email, "aileen.murray@example.test", "Aileen.Murray@Example.TEST", "other", true],
  //            [phone, "07700900123", "+44 7700 900123", "other", true]; contacts.email of C1 is "Aileen.Murray@Example.TEST"
it("turns a blank email into none and gives it no point", ...);              // C5.email IS NULL, no points
it("makes each contact a member of its account, as its primary", ...);       // C1 → ACC1, role "Primary event contact", primary
it("calls an account named after its contact a household, and the rest organisations", ...); // ACC1 household, ACC2 organisation
it("links each converted enquiry to the contact made from it", ...);         // E1 → C1, E3 → C3, E4 → C4
it("keeps today's duplicates apart and links nothing to an email two of them hold", ...); // C3, C4 live; E5.contact_id null
it("makes one person per venue for an enquirer who had none, from that venue's own enquiries", ...);
  // venue A: one contact "Kirsty Lane-Brown", email "kirsty@example.test", phone "0141 496 0001", source E6,
  // created_at = E6.created_at; E6 and E7 linked to it; venue B: "K. Lane", E8 linked;
  // no contact anywhere named "Overwritten By B" or holding 07700900999
it("makes a person for a signed-in enquirer", ...);                          // "Euan Stewart", planner@example.test, E9 linked
it("leaves seed fixtures alone", ...);                                       // E10 unlinked, no seed@example.test point
it("dates each person's last contact from their latest enquiry, deal, activity or proposal", ...);
  // C1: 2026-03-05 (the proposal); Kirsty at A: E7.created_at
it("normalises in SQL exactly as @omnitwin/types does", ...);
  // for each input of Task 1's PHONE_CASES (listed again in this file) plus " Aileen.Murray@Example.TEST " and "\tkirsty@example.test\n":
  // SELECT people_normalise_phone($1), people_normalise_email($1) equals normalisePhone / normaliseEmail
it("changes nothing when run again", ...);
  // apply the file a second time; contacts, contact_points, account_memberships, client_accounts, enquiries equal row for row
it("lets the previous API keep writing, and holds the new rules", ...);
  // INSERT client_accounts without kind → 'household'; INSERT contacts with email NULL succeeds;
  // a second primary email point for C1 → 23505; a point whose venue_id is not its contact's → 23503;
  // label 'fax' → 23514; record_merges with survivor_id = merged_id → 23514
```

Agreement is tested on ASCII. PostgreSQL's `lower()` follows the database locale for other letters, which is one reason every live write normalises in TypeScript and only the backfill uses the SQL functions.

- [ ] **Step 4: Run both to see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-book-migration.test.ts`, then `VENVIEWER_ROUTE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_route_atomicity_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-book-migration-postgres.test.ts`
Expected: FAIL, `ENOENT ... drizzle/0094_people_book.sql`.

- [ ] **Step 5: Write `0094_people_book.sql`**

A header comment in the house style (`0090_booking_event_bind.sql:1-41`) saying what it does and in what order, that rerunning changes nothing, and the residual: in the pre-deploy window the previous container writes `contacts` with no points and enquiries with no person; create-from-enquiry (Task 10) links such an enquiry when it is worked. Then, separated by `--> statement-breakpoint`:

1. `SET LOCAL lock_timeout = '5s';`
2. Functions, `CREATE OR REPLACE`, `IMMUTABLE`: `people_trim(raw)` = `regexp_replace(raw, '^[[:space:]]+|[[:space:]]+$', '', 'g')`; `people_normalise_email(raw)` = `NULLIF(lower(people_trim(raw)), '')`; `people_name_key(raw)` = `NULLIF(lower(regexp_replace(people_trim(raw), '[[:space:]]+', ' ', 'g')), '')`; `people_normalise_phone(raw)` in plpgsql, Task 1's algorithm.
3. `contacts`: `ALTER COLUMN "email" DROP NOT NULL`; `ADD COLUMN IF NOT EXISTS` `given_name varchar(100)`, `family_name varchar(100)`, `job_title varchar(120)`, `postal_address text`, `notes text`, `owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL`, `last_contact_at timestamptz`, `source_system varchar(40)`, `source_id varchar(255)`, `merged_into_id uuid REFERENCES contacts(id) ON DELETE RESTRICT`, `erased_at timestamptz`; checks `contacts_source_pair_check` (`(source_system IS NULL) = (source_id IS NULL)`) and `contacts_not_merged_into_self` (`merged_into_id <> id`), each `DROP CONSTRAINT IF EXISTS` then `ADD`; `contacts_id_venue_unique UNIQUE (id, venue_id)` added in a `DO` block only when `pg_constraint` has no such `conname` on `'contacts'::regclass` (foreign keys depend on it, so it is never dropped); indexes `contacts_venue_source_unique` (unique, `(venue_id, source_system, source_id) WHERE source_id IS NOT NULL`), `contacts_merged_into_idx (merged_into_id) WHERE merged_into_id IS NOT NULL`, `contacts_owner_idx (owner_user_id) WHERE owner_user_id IS NOT NULL`.
4. `client_accounts`: `ADD COLUMN IF NOT EXISTS` `kind varchar(20)` (no default yet), `address text`, `website varchar(255)`, `vat_number varchar(40)`, `notes text`, `owner_user_id` (as contacts), `source_system`, `source_id`, `merged_into_id uuid REFERENCES client_accounts(id) ON DELETE RESTRICT`; the same three constraints and indexes named `client_accounts_…`.
5. `contact_points`: `id uuid pk default gen_random_uuid()`, `venue_id uuid NOT NULL REFERENCES venues(id)`, `contact_id uuid NOT NULL`, `kind varchar(10) NOT NULL`, `value varchar(255) NOT NULL`, `display_value varchar(255) NOT NULL`, `label varchar(20) NOT NULL DEFAULT 'other'`, `is_primary boolean NOT NULL DEFAULT false`, `source_system varchar(40)`, `source_id varchar(255)`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`; `contact_points_contact_venue_fk FOREIGN KEY (contact_id, venue_id) REFERENCES contacts(id, venue_id) ON DELETE CASCADE`; checks `contact_points_kind_check`, `contact_points_label_check`, `contact_points_value_check` (`value <> '' AND display_value <> ''`), `contact_points_source_pair_check`; `contact_points_contact_kind_value_unique UNIQUE (contact_id, kind, value)`; indexes `contact_points_one_primary_unique` (unique, `(contact_id, kind) WHERE is_primary`) and `contact_points_venue_kind_value_idx (venue_id, kind, value)`.
6. `account_memberships`: `id`, `venue_id NOT NULL REFERENCES venues(id)`, `contact_id uuid NOT NULL`, `client_account_id uuid NOT NULL`, `role_label varchar(120)`, `is_primary boolean NOT NULL DEFAULT false`, timestamps; `account_memberships_contact_venue_fk` and `account_memberships_account_venue_fk` (composite, `ON DELETE CASCADE`, onto `contacts(id, venue_id)` and `client_accounts(id, venue_id)`); `account_memberships_pair_unique UNIQUE (contact_id, client_account_id)`; `account_memberships_one_primary_unique` (unique, `(contact_id) WHERE is_primary`); `account_memberships_account_idx (client_account_id)`.
7. `record_merges`: `id`, `venue_id NOT NULL REFERENCES venues(id)`, `kind varchar(20) NOT NULL`, `survivor_id uuid NOT NULL`, `merged_id uuid NOT NULL`, `snapshot jsonb NOT NULL`, `moves jsonb NOT NULL`, `merged_by uuid REFERENCES users(id) ON DELETE SET NULL`, `merged_at timestamptz NOT NULL DEFAULT now()`, `undone_at timestamptz`, `undone_by uuid REFERENCES users(id) ON DELETE SET NULL`, `undo_report jsonb`; checks `record_merges_kind_check`, `record_merges_distinct_check` (`survivor_id <> merged_id`), `record_merges_shape_check` (`jsonb_typeof(moves) = 'array' AND jsonb_typeof(snapshot) = 'object'`), `record_merges_undo_pair_check` (`(undone_at IS NULL) = (undo_report IS NULL)`); indexes `record_merges_merged_idx (venue_id, kind, merged_id, merged_at DESC)` and `record_merges_survivor_idx (venue_id, kind, survivor_id)`.
8. `enquiries`: `ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL`; `enquiries_contact_idx (contact_id) WHERE contact_id IS NOT NULL`.
9. The backfill, in this order:

```sql
-- a. Trim the mirrors; a blank becomes none.
UPDATE contacts SET email = NULLIF(people_trim(email), ''), phone = NULLIF(people_trim(phone), '')
WHERE email IS DISTINCT FROM NULLIF(people_trim(email), '') OR phone IS DISTINCT FROM NULLIF(people_trim(phone), '');
-- b. Points from each contact's email and phone, primary. (Repeat with kind 'phone', people_normalise_phone(c.phone), c.phone.)
INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, label, is_primary)
SELECT c.venue_id, c.id, 'email', people_normalise_email(c.email), c.email, 'other', true FROM contacts c
WHERE people_normalise_email(c.email) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contact_points p WHERE p.contact_id = c.id AND p.kind = 'email')
ON CONFLICT DO NOTHING;
-- c. Memberships from contacts.client_account_id, same venue only.
INSERT INTO account_memberships (venue_id, contact_id, client_account_id, role_label, is_primary)
SELECT c.venue_id, c.id, c.client_account_id, c.role_label, true
FROM contacts c JOIN client_accounts a ON a.id = c.client_account_id AND a.venue_id = c.venue_id
WHERE NOT EXISTS (SELECT 1 FROM account_memberships m WHERE m.contact_id = c.id)
ON CONFLICT DO NOTHING;
-- d. Household when the account carries its primary contact's name.
UPDATE client_accounts a SET kind = CASE WHEN EXISTS (
  SELECT 1 FROM contacts c WHERE c.id = a.primary_contact_id AND people_name_key(c.name) = people_name_key(a.name)
) THEN 'household' ELSE 'organisation' END
WHERE a.kind IS NULL;
-- e. Converted enquiries to the contact made from them (the earliest live one).
UPDATE enquiries e SET contact_id = c.id
FROM (SELECT DISTINCT ON (source_enquiry_id) id, source_enquiry_id, venue_id FROM contacts
      WHERE source_enquiry_id IS NOT NULL AND deleted_at IS NULL ORDER BY source_enquiry_id, created_at, id) c
WHERE e.id = c.source_enquiry_id AND e.venue_id = c.venue_id AND e.contact_id IS NULL;
-- f. One person per venue and normalised email for enquirers no live contact holds; seeds excluded.
DROP TABLE IF EXISTS pg_temp."people_0094_enquirers";
CREATE TEMP TABLE "people_0094_enquirers" AS
SELECT gen_random_uuid() AS contact_id, g.* FROM (
  SELECT e.venue_id,
    people_normalise_email(coalesce(e.guest_email, e.email)) AS email_key,
    (array_agg(people_trim(coalesce(e.guest_email, e.email)) ORDER BY e.created_at DESC, e.id DESC))[1] AS email_display,
    (array_agg(coalesce(NULLIF(people_trim(e.guest_name), ''), NULLIF(people_trim(e.name), ''), people_trim(coalesce(e.guest_email, e.email)))
       ORDER BY e.created_at DESC, e.id DESC))[1] AS name,
    (array_agg(people_trim(e.guest_phone) ORDER BY e.created_at DESC, e.id DESC)
       FILTER (WHERE people_normalise_phone(e.guest_phone) IS NOT NULL))[1] AS phone_display,
    (array_agg(e.id ORDER BY e.created_at, e.id))[1] AS first_enquiry_id,
    min(e.created_at) AS first_at
  FROM enquiries e
  WHERE e.contact_id IS NULL AND e.fixture_source IS NULL AND people_normalise_email(coalesce(e.guest_email, e.email)) IS NOT NULL
  GROUP BY e.venue_id, people_normalise_email(coalesce(e.guest_email, e.email))
) g
WHERE NOT EXISTS (SELECT 1 FROM contact_points p JOIN contacts c ON c.id = p.contact_id
  WHERE p.venue_id = g.venue_id AND p.kind = 'email' AND p.value = g.email_key
    AND c.deleted_at IS NULL AND c.merged_into_id IS NULL AND c.erased_at IS NULL);
INSERT INTO contacts (id, venue_id, name, email, phone, source_enquiry_id, created_at, updated_at)
SELECT contact_id, venue_id, left(name, 200), left(email_display, 255), left(phone_display, 50), first_enquiry_id, first_at, now()
FROM people_0094_enquirers;
-- then their email point (email_key, email_display, 'other', primary) and, where phone_display is not null, their phone point.
-- g. Every still-unlinked, non-seed enquiry whose email exactly one live person holds.
UPDATE enquiries e SET contact_id = m.contact_id
FROM (SELECT p.venue_id, p.value, (array_agg(DISTINCT p.contact_id))[1] AS contact_id
      FROM contact_points p JOIN contacts c ON c.id = p.contact_id
        AND c.deleted_at IS NULL AND c.merged_into_id IS NULL AND c.erased_at IS NULL
      WHERE p.kind = 'email' GROUP BY p.venue_id, p.value HAVING count(DISTINCT p.contact_id) = 1) m
WHERE e.contact_id IS NULL AND e.fixture_source IS NULL AND e.venue_id = m.venue_id
  AND people_normalise_email(coalesce(e.guest_email, e.email)) = m.value;
-- h. Last contact: the latest related enquiry, deal, activity or sent proposal.
UPDATE contacts c SET last_contact_at = x.at FROM (
  SELECT c2.id, GREATEST(
    (SELECT max(e.created_at) FROM enquiries e WHERE e.contact_id = c2.id),
    (SELECT max(o.created_at) FROM opportunities o WHERE o.primary_contact_id = c2.id),
    (SELECT max(a.created_at) FROM activities a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.primary_contact_id = c2.id),
    (SELECT max(p.sent_at) FROM proposals p JOIN opportunities o ON o.id = p.opportunity_id WHERE o.primary_contact_id = c2.id)
  ) AS at FROM contacts c2 WHERE c2.last_contact_at IS NULL) x
WHERE c.id = x.id AND x.at IS NOT NULL;
```

10. Finish `kind`: `SET DEFAULT 'household'`, `SET NOT NULL`, `client_accounts_kind_check` (`DROP IF EXISTS`, then `ADD`).

- [ ] **Step 6: Declare the schema in `schema.ts`**

Every column, constraint and index above, with the same names; the composite keys follow `events_id_venue_unique` (`schema.ts:1356`) and `bookings_event_venue_fk`. `contacts.email` loses `.notNull()`. `clientAccounts.kind` is `varchar("kind", { length: 20 }).notNull().default("household")`. `recordMerges.snapshot` is `jsonb().$type<RecordMergeSnapshot>().notNull()`, `moves` `$type<RecordMergeMove[]>()`, `undoReport` `$type<MergeUndoReport>()`. `contactPoints` and `accountMemberships` follow `contacts`; `recordMerges` follows `followUpTasks`.

- [ ] **Step 7: Append the journal entry**

`{ "idx": 92, "version": "7", "when": 1792076400000, "tag": "0094_people_book", "breakpoints": true }`

- [ ] **Step 8: Let the client search carry a person without an email**

`ClientSearchResults.contacts[].email` and `ContactProfile.contact.email` become `string | null`. Nothing else in the API needs to change for the nullable column (`pnpm --filter @omnitwin/api typecheck` proves it).

- [ ] **Step 9: Run the tests and the typecheck to see them pass**

Run the two commands from Step 4, then `pnpm --filter @omnitwin/api typecheck`.
Expected: both files pass with none skipped; typecheck clean.

- [ ] **Step 10: Migrate the platform database**

Run: `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api test:platform-db`
Expected: the receipt's `migration` stage lists 0094 applied and replayed unchanged, and the existing platform files pass.

- [ ] **Step 11: Commit**

```bash
git add packages/api/drizzle/0094_people_book.sql packages/api/drizzle/meta/_journal.json packages/api/src/db/schema.ts packages/api/src/services/client-search.ts packages/api/src/__tests__/people-book-migration.test.ts packages/api/src/__tests__/people-book-migration-postgres.test.ts
git commit -m "feat(api): the People Book's records and their backfill, migration 0094 (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web readers accept a person with no email

**Files:**
- Modify: `packages/web/src/api/clients.ts:54-61` (`ContactSearchResultSchema.email`), `:102-112` (`ContactProfileSchema.contact.email`)
- Modify: `packages/web/src/api/crm.ts:80-92` (`ContactSchema.email`), `:174-182` (`DealContactSchema.email`)
- Modify: `packages/web/src/components/dashboard/clients/ClientPanel.tsx:111-118` (`Who.email: string | null`), `:155-157`
- Modify: `packages/web/src/components/dashboard/pipeline/DealPanel.tsx:502-505`
- Test: `packages/web/src/components/dashboard/clients/__tests__/clients-desk-format.test.ts`

**Interfaces:**
- Consumes: Task 2 (`contacts.email` may be null in every API answer that carries a contact).
- Produces: `ContactSearchResult.email`, `ContactProfile["contact"]["email"]`, `DealContact.email` typed `string | null`.

- [ ] **Step 1: Write the failing test**

```ts
it("lists a person with no email under their organisation alone", () => {
  const groups = groupResults({
    users: [], guestLeads: [], configurations: [], accounts: [], deals: [], proposals: [],
    contacts: [{ id: ID, name: "Ailsa Henderson", email: null, phone: null, accountName: "Henderson Family" }],
  });
  expect(groups[0]?.rows[0]).toMatchObject({ kind: "contact", title: "Ailsa Henderson", detail: "Henderson Family" });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @omnitwin/web exec vitest run src/components/dashboard/clients/__tests__/clients-desk-format.test.ts && pnpm --filter @omnitwin/web typecheck`
Expected: FAIL at typecheck, `Type 'null' is not assignable to type 'string'`.

- [ ] **Step 3: Implement**

The four schema fields become `z.string().nullable()`. `ClientPanel` and `DealPanel` render the `mailto:` link only when the email is not null; nothing else on either panel changes.

- [ ] **Step 4: Run it to see it pass**

Run the commands from Step 2.
Expected: the file passes and the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/clients.ts packages/web/src/api/crm.ts packages/web/src/components/dashboard/clients/ClientPanel.tsx packages/web/src/components/dashboard/pipeline/DealPanel.tsx packages/web/src/components/dashboard/clients/__tests__/clients-desk-format.test.ts
git commit -m "fix(web): read a client contact who has no email (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sales reaches the Clients desk

**Files:**
- Modify: `packages/api/src/utils/query.ts` (beside `canReadDiary`, `:162-167` on origin/master)
- Modify: `packages/api/src/routes/clients.ts:9`, `:59`, `:98`, `:187`, `:250`, `:270`
- Modify: `packages/web/src/lib/role-capabilities.ts:44-51`
- Test: `packages/api/src/__tests__/client-search-postgres.test.ts`, `packages/web/src/lib/__tests__/role-capabilities.test.ts`, `packages/web/e2e/find-anything.spec.ts:250-264`

**Interfaces:**
- Produces: `canReadClients(user: Pick<JwtUser, "role" | "venueId" | "platformRole">, venueId: string): boolean`, which is `canManageVenue(user, venueId) || canManageCommercial(user, venueId)`; `CLIENT_SEARCH_ROLES = ["admin", "manager", "staff", "hallkeeper", "sales"] as const`.

- [ ] **Step 1: Write the failing tests**

In `client-search-postgres.test.ts`:

```ts
it("lets sales search the clients, with the commercial record, and open the desk's lists", async () => {
  const found = await search("henderson", "sales");
  expect(found.contacts.map((contact) => contact.name)).toEqual(["Ailsa Henderson"]);
  expect(found.deals).toHaveLength(1);
  for (const url of ["/clients/recent", "/clients/upcoming"]) {
    expect((await server.inject({ method: "GET", url, headers: bearer("sales") })).statusCode, url).toBe(200);
  }
});

it("still refuses the Clients desk to planners, clients and caterers", async () => {
  for (const role of ["planner", "client", "caterer"]) {
    for (const url of ["/clients/search?q=henderson", "/clients/recent", "/clients/upcoming",
      `/clients/${randomUUID()}/profile`, `/clients/leads/${randomUUID()}/profile`]) {
      expect((await server.inject({ method: "GET", url, headers: bearer(role) })).statusCode, `${role} ${url}`).toBe(403);
    }
  }
});
```

In the existing upcoming-list test, after its lead exists, add: sales opens `GET /clients/leads/<that lead>/profile` with 200. The two hallkeeper tests stay as they are; they are the proof hallkeepers keep exactly today's access.

In `role-capabilities.test.ts`, replace "offers the Clients desk only to the roles /clients admits" with:

```ts
it("offers the Clients desk to the roles /clients admits, sales included", () => {
  // routes/clients.ts gates on canReadClients: the venue floor and the commercial team (People Book design §6.7).
  expect([...CLIENT_SEARCH_ROLES]).toEqual(["admin", "manager", "staff", "hallkeeper", "sales"]);
  for (const role of USER_ROLES) {
    expect(canOpenDashboardView("search", role, "none"), `search for ${role}`)
      .toBe(hasRole(VENUE_FLOOR_ROLES, role) || hasRole(COMMERCIAL_ROLES, role));
  }
  expect(canOpenDashboardView("search", "sales", "none")).toBe(true);
  expect(canOpenDashboardView("search", "planner", "none")).toBe(false);
});
```

In `find-anything.spec.ts`, the sales block (`:250-264`) now says sales finds clients: the placeholder is "A name, a date or a page", typing "henderson" shows `salesFind.getByRole("option", { name: /Ailsa Henderson/u })`, and `salesSearches.searches.at(-1)` is "henderson". Replace its comment: Blake's C2 question was open; the approved People Book design (§6.7, 18 October 2026) gives sales the desk.

- [ ] **Step 2: Run them to see them fail**

Run: `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/client-search-postgres.test.ts` and `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/role-capabilities.test.ts`
Expected: FAIL; sales receives 403 and the role set lacks "sales".

- [ ] **Step 3: Implement**

Add `canReadClients` with a doc comment naming the design section. In `clients.ts` the five `canManageVenue` gates (search, user profile, lead profile, recent, upcoming) become `canReadClients`; the search still passes `commercial: canManageCommercial(...)`, and the contact profile keeps `canManageCommercial`. Recent and upcoming are included because the desk calls them on opening, and a desk offered to sales that answers 403 on open is the dead end the drift test forbids. Set `CLIENT_SEARCH_ROLES` and rewrite its comment to mirror `canReadClients`.

- [ ] **Step 4: Run them to see them pass**

Run the commands from Step 2, then `pnpm --filter @omnitwin/web exec playwright test e2e/find-anything.spec.ts`.
Expected: all pass; none skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/utils/query.ts packages/api/src/routes/clients.ts packages/api/src/__tests__/client-search-postgres.test.ts packages/web/src/lib/role-capabilities.ts packages/web/src/lib/__tests__/role-capabilities.test.ts packages/web/e2e/find-anything.spec.ts
git commit -m "feat: sales reaches the Clients desk; hallkeepers keep today's access (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Duplicate suggestions

**Files:**
- Create: `packages/api/src/services/people-duplicates.ts`
- Create: `packages/api/src/services/people-records.ts` (only the shared types and predicates here; Task 6 fills it)
- Create: `packages/api/src/__tests__/support/people-platform-fixture.ts`
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts:15-34` (add the test file)
- Test: `packages/api/src/__tests__/people-duplicates-postgres.test.ts`

**Interfaces:**
- Consumes: Task 2 tables; `people_name_key`; `CLOSE_NAME_SIMILARITY`, `DUPLICATE_REASONS`, `DuplicateSuggestion`.
- Produces:
  - In `people-records.ts`: `PeopleTx = Parameters<Parameters<Database["transaction"]>[0]>[0]`, `PeopleConn = Database | PeopleTx`, `liveContact(): SQL` and `liveAccount(): SQL` (the "live" predicates from Global Constraints; an account is live when `deleted_at` and `merged_into_id` are null).
  - `duplicateSuggestions(db: PeopleConn, venueId: string, personId: string): Promise<DuplicateSuggestion[]>` and `countDuplicateSuggestions(db: PeopleConn, venueId: string, personId: string): Promise<number>`.
  - Fixture: `PLATFORM_TARGET: string | undefined` (guarded exactly as `client-search-postgres.test.ts:22-29`); `openPeopleFixture(register: (server: FastifyInstance, db: Database) => Promise<void>): Promise<PeopleFixture>`; `PeopleFixture` has `pool`, `db`, `server`, `venueId`, `otherVenueId` (random venues, slug = id), `users: Record<"admin" | "manager" | "staff" | "sales" | "hallkeeper" | "planner" | "caterer" | "otherStaff" | "platformAdmin", string>` (real `users` rows; `otherStaff` is staff at `otherVenueId`; `platformAdmin` has `platform_role` 'admin' and no venue), `bearer(who)` (the mock token JSON for that user), `addPerson({ name, venueId?, emails?, phones?, organisations? }): Promise<string>` (SQL inserts: the contact, its points normalised by the SQL functions with the first of each kind primary, its memberships with the first primary, and the mirrors), `addOrganisation({ name, kind?, venueId? }): Promise<string>`, `close()`.

- [ ] **Step 1: Write the failing test**

Each case uses its own addresses so the cases never meet.

```ts
describe.skipIf(PLATFORM_TARGET === undefined)("duplicate suggestions on the migrated disposable database", () => {
  let f: PeopleFixture;
  beforeAll(async () => { f = await openPeopleFixture(async () => undefined); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("suggests two people who hold one email, each to the other", async () => {
    const a = await f.addPerson({ name: "Aileen Murray", emails: ["dup1@example.test"] });
    const b = await f.addPerson({ name: "A Murray", emails: [" DUP1@Example.test "] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([{ person: { id: b, name: "A Murray", organisationName: null }, reasons: ["shared_email"] }]);
    expect(await countDuplicateSuggestions(f.db, f.venueId, b)).toBe(1);
  });
  it("suggests two people who hold one phone, however it was typed", async () => {
    // "+44 7700 900101" and "07700 900 101" → reasons ["shared_phone"]
  });
  it("names every reason a pair shares, in a fixed order", async () => {
    // the same email and phone → ["shared_email", "shared_phone"]
  });
  it("suggests a close name within one organisation", async () => {
    // household "Murray household"; "Aileen Murray" and "Aileen Murrey" (similarity 0.647) → ["close_name"]
  });
  it("does not suggest a couple whose names share only a surname", async () => {
    // household; "Ailsa Henderson" and "Iain Henderson" (similarity 0.476) → []
  });
  it("does not suggest close names in different organisations", async () => { /* → [] */ });
  it("leaves out merged, deleted and erased people, and other venues", async () => {
    // four more holders of one email: one merged_into_id set, one deleted_at, one erased_at, one at otherVenueId → []
  });
});
```

The similarities are pg_trgm 1.6's `similarity()` on the lowercased names, measured for this plan.

- [ ] **Step 2: Run it to see it fail**

Run: `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-duplicates-postgres.test.ts`
Expected: FAIL, `Failed to load url ../services/people-duplicates.js`.

- [ ] **Step 3: Implement**

Three rules over live people at the venue, the person itself excluded: `shared_email` and `shared_phone`, the same `value` of that kind; `close_name`, both members of one live account and `similarity(people_name_key(a.name), people_name_key(b.name)) >= 0.6`. Reasons come in `DUPLICATE_REASONS` order; suggestions sort by number of reasons descending, then name, then id; at most 50. `organisationName` is the other person's primary live account's name. The count is the length of the list.

- [ ] **Step 4: Run it to see it pass**

Run the command from Step 2. Expected: every case passes, none skipped.

- [ ] **Step 5: Add the file to `PLATFORM_POSTGRES_TEST_FILES` and commit**

```bash
git add packages/api/src/services/people-duplicates.ts packages/api/src/services/people-records.ts packages/api/src/__tests__/support/people-platform-fixture.ts packages/api/src/__tests__/people-duplicates-postgres.test.ts packages/api/src/scripts/run-platform-postgres-tests.ts
git commit -m "feat(api): suggest possible duplicate people, never merge them (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: People: create, read, edit, contact points and memberships

**Files:**
- Modify: `packages/api/src/services/people-records.ts`
- Create: `packages/api/src/routes/people.ts`
- Modify: `packages/api/src/index.ts` (import beside `crmRoutes`, `:69`; register after it, `:503`)
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts`
- Test: `packages/api/src/__tests__/people-routes.test.ts` (no database, `buildServer` as in `commercial-spine-routes.test.ts`), `packages/api/src/__tests__/people-routes-postgres.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas; Task 5 `countDuplicateSuggestions`, `duplicateSuggestions`, the fixture; `canManageCommercial`, `isPlatformAdmin`, `authenticate`.
- Produces, in `people-records.ts`:
  - `lockPerson(tx: PeopleTx, scopeVenueId: string | null, personId: string): Promise<PersonLock>`, with `PersonLock = { state: "missing" } | { state: "merged"; mergedIntoId: string } | { state: "live"; row: typeof contacts.$inferSelect }` (`SELECT … FOR UPDATE`; deleted or erased is `missing`).
  - `NewPerson = { venueId: string; name: string; givenName?: string | null; familyName?: string | null; jobTitle?: string | null; roleLabel?: string | null; postalAddress?: string | null; notes?: string | null; ownerUserId: string | null; sourceEnquiryId?: string | null; lastContactAt?: Date | null; contactPoints: readonly ContactPointInput[] }`.
  - `insertPerson(tx: PeopleTx, input: NewPerson): Promise<string>` (the contact, then each point through `upsertContactPoint`, then `refreshContactMirror`).
  - `upsertContactPoint(tx: PeopleTx, person: { id: string; venueId: string }, input: ContactPointInput): Promise<{ pointId: string; created: boolean }>`.
  - `removeContactPoint(tx: PeopleTx, personId: string, pointId: string): Promise<boolean>`.
  - `setPersonMemberships(tx: PeopleTx, person: { id: string; venueId: string }, input: SetMemberships): Promise<"ok" | "organisation_not_found">`.
  - `refreshContactMirror(tx: PeopleConn, personId: string): Promise<void>`.
  - `isCommercialMember(db: PeopleConn, venueId: string, userId: string): Promise<boolean>`: a `users` row with that `venue_id` whose role passes `canManageCommercial({ role, venueId, platformRole: "none" }, venueId)`.
  - `updatePersonFields(tx: PeopleTx, row: typeof contacts.$inferSelect, patch: UpdatePerson): Promise<"ok" | "stale">`.
  - `readPersonProfile(db: PeopleConn, scopeVenueId: string | null, personId: string): Promise<PersonProfile | null>` (live only here; Task 11 adds the merged answer).
- Produces, in `routes/people.ts`: `peopleRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void>`, with a local `peopleScope(user: JwtUser): { ok: true; venueId: string | null } | { ok: false }` (the shape of `commercialScope` in `crm.ts:39-45`) run first on every route, then validation, then the venue. Routes in this task:

| Route | Answers |
| --- | --- |
| `POST /people` (`CreatePersonSchema`) | 201 live profile; 400; 403 when `!canManageCommercial(user, body.venueId)`; 422 `OWNER_NOT_AT_VENUE` |
| `GET /people/:personId` | 200 profile; 404 |
| `PATCH /people/:personId` (`UpdatePersonSchema`) | 200 profile; 404; 409 `STALE_RECORD`; 422 `OWNER_NOT_AT_VENUE` |
| `POST /people/:personId/contact-points` (`ContactPointInputSchema`) | 201 for a new point, 200 for one already held; the body is the profile either way; 404 |
| `DELETE /people/:personId/contact-points/:pointId` | 204; 404 when the point is not this person's |
| `PUT /people/:personId/memberships` (`SetMembershipsSchema`) | 200 profile; 404 `ORGANISATION_NOT_FOUND` (nothing changed) |
| `GET /people/:personId/duplicates` | 200 `DuplicateSuggestion[]`; 404 |

- [ ] **Step 1: Write the failing gate test (no database)**

```ts
const ROUTES = [
  ["POST", "/people"], ["GET", `/people/${ID}`], ["PATCH", `/people/${ID}`],
  ["POST", `/people/${ID}/contact-points`], ["DELETE", `/people/${ID}/contact-points/${ID2}`],
  ["PUT", `/people/${ID}/memberships`], ["GET", `/people/${ID}/duplicates`],
] as const; // Tasks 7, 8, 11 and 12 append theirs

it("asks every people route for a sign-in", async () => { /* each → 401 */ });
it("refuses the book to every role outside the commercial team, before reading anything", async () => {
  // hallkeeper, planner, client and caterer at VENUE_A, and staff with venueId null: each route → 403, even with a junk body
});
it("lets sales through the door", async () => { /* sales at VENUE_A: each route → not 401 and not 403 */ });
it("refuses a malformed id or body before the database", async () => {
  // staff: GET /people/not-a-uuid → 400; POST /people { venueId: VENUE_A } → 400;
  // POST /people/:id/contact-points { kind: "phone", value: "123" } → 400; PUT memberships with two primaries → 400
});
```

- [ ] **Step 2: Write the failing database test**

`people-routes-postgres.test.ts`, on the fixture with `peopleRoutes` registered at `/people`; every live answer is parsed with `PersonProfileSchema`.

```ts
it("creates a person with their email and phone, normalised, and makes the creator the owner", async () => {
  const res = await post("/people", "staff", { venueId: f.venueId, name: "Aileen Murray", jobTitle: "Secretary",
    contactPoints: [{ kind: "email", value: " Aileen.Murray@Example.TEST ", label: "work" }, { kind: "phone", value: "+44 7700 900123", label: "mobile" }] });
  expect(res.statusCode, res.body).toBe(201);
  const profile = live(res);
  expect(profile.person).toMatchObject({ name: "Aileen Murray", jobTitle: "Secretary", email: "Aileen.Murray@Example.TEST", phone: "+44 7700 900123", ownerUserId: f.users.staff });
  expect(profile.contactPoints.map((p) => [p.kind, p.value, p.displayValue, p.label, p.isPrimary])).toEqual([
    ["email", "aileen.murray@example.test", "Aileen.Murray@Example.TEST", "work", true],
    ["phone", "07700900123", "+44 7700 900123", "mobile", true],
  ]);
  expect(profile.owner?.id).toBe(f.users.staff);
  expect(profile.duplicateSuggestionCount).toBe(0);
});
it("lets sales create and edit a person", ...);                                    // 201, then PATCH 200
it("refuses an owner who is not on the venue's commercial team", ...);             // hallkeeper id, otherStaff id → 422 OWNER_NOT_AT_VENUE
it("refuses to create a person at another venue", ...);                            // staff, body.venueId = otherVenueId → 403
it("answers not found for another venue's person, a deleted one and a made-up id", ...); // each Task 6 route → 404
it("edits with the time it last read, and refuses an edit made from an older read", ...);
  // PATCH { jobTitle: "Chair", expectedUpdatedAt: created.person.updatedAt } → 200; the same old time again → 409 STALE_RECORD
it("answers a phone typed another way with the point the person already holds", ...); // Review Focus 1
  // POST contact-points { kind: "phone", value: "07700 900 123" } → 200, the same point id, one phone point
it("makes a new primary email the one the record shows", ...);
  // POST { kind: "email", value: "aileen@work.example.test", isPrimary: true } → 201; person.email "aileen@work.example.test"; the old point not primary
it("promotes the oldest remaining email when the primary goes, and shows none when the last goes", ...);
it("will not remove another person's contact point", ...);                         // → 404, the point still there
it("sets a person's organisations, mirrors the primary, and refuses another venue's", ...);
  // PUT [{ org A, roleLabel "Secretary", isPrimary: true }, { org B }] → contacts.client_account_id = A;
  // PUT with an otherVenueId organisation → 404 ORGANISATION_NOT_FOUND and the memberships unchanged; PUT [] → none, mirror null
it("keeps one point when the same new email is added twice at once", ...);         // Promise.all → statuses [200, 201]; one row
it("counts and lists the person's possible duplicates", ...);                      // a second holder of the email → count 1, list of one
```

- [ ] **Step 3: Run both to see them fail**

Run: `pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-routes.test.ts` and `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-routes-postgres.test.ts`
Expected: FAIL, 404 where 401 or 201 is expected (no `/people` routes yet).

- [ ] **Step 4: Implement the service and the routes**

Every person write is one transaction that begins with `lockPerson`; until Task 11, a `merged` lock answers 404 like `missing`. `upsertContactPoint`: normalise the value (`normaliseEmail`/`normalisePhone`); if the person holds `(kind, value)`, return it with `created: false`, making it primary first when asked; otherwise insert it with `is_primary` false and a target-less `onConflictDoNothing()` (the schema-from-Drizzle fixtures in Tasks 9 and 10 carry no unique keys), then, when asked or when the person has no primary of that kind, demote the others and make it primary; finally `refreshContactMirror`. `refreshContactMirror`: per kind, if no point is primary make the oldest (`created_at`, then `id`) primary; the same for memberships whose account is live; then set `email`, `phone`, `client_account_id` and `updated_at`. `removeContactPoint` deletes the row then refreshes. `setPersonMemberships` checks every organisation is a live account at the person's venue before changing anything, deletes the memberships not in the list, upserts the rest (no primary in the list: the first is primary) and refreshes. The owner defaults to the actor when the actor `isCommercialMember`, otherwise none; an explicit owner must pass `isCommercialMember` or the answer is 422. `updatePersonFields` compares `expectedUpdatedAt` in SQL as `date_trunc('milliseconds', updated_at) = $1`, because the API serialises milliseconds and PostgreSQL keeps microseconds, and writes `updated_at = new Date()`. Contact points list primary first, then oldest; memberships primary first, then by name. Log `{ event: "people.<verb>", personId }` only.

- [ ] **Step 5: Run both to see them pass**

Run the commands from Step 3. Expected: both pass, none skipped.

- [ ] **Step 6: Add the database file to `PLATFORM_POSTGRES_TEST_FILES` and commit**

```bash
git add packages/api/src/services/people-records.ts packages/api/src/routes/people.ts packages/api/src/index.ts packages/api/src/scripts/run-platform-postgres-tests.ts packages/api/src/__tests__/people-routes.test.ts packages/api/src/__tests__/people-routes-postgres.test.ts
git commit -m "feat(api): people with several emails and phones, memberships and an owner (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Organisations and households

**Files:**
- Create: `packages/api/src/services/people-organisations.ts`
- Modify: `packages/api/src/routes/people.ts`
- Test: `packages/api/src/__tests__/people-routes.test.ts`, `packages/api/src/__tests__/people-routes-postgres.test.ts`

**Interfaces:**
- Consumes: Task 6 `peopleScope`, `isCommercialMember`, `liveAccount()`, `liveContact()`.
- Produces: `insertOrganisation(tx: PeopleTx, input: CreateOrganisation & { ownerUserId: string | null; createdBy: string; primaryContactId?: string | null; sourceEnquiryId?: string | null }): Promise<string>`; `updateOrganisationFields(tx: PeopleTx, row: typeof clientAccounts.$inferSelect, patch: UpdateOrganisation): Promise<"ok" | "stale">`; `readOrganisationProfile(db: PeopleConn, scopeVenueId: string | null, organisationId: string): Promise<OrganisationProfile | null>`; routes `POST /people/organisations` (201; 400; 403; 422 `OWNER_NOT_AT_VENUE`), `GET /people/organisations/:organisationId` (200; 404), `PATCH /people/organisations/:organisationId` (200; 404; 409 `STALE_RECORD`; 422).

- [ ] **Step 1: Write the failing tests**

Append the three routes to `ROUTES` in the gate test. In the database test:

```ts
it("creates a household and an organisation, each owned by its creator", ...);
  // POST { name: "Murray household", kind: "household" } → 201, kind household, accountType "event_client", owner staff;
  // POST { name: "Glasgow Medical Society", kind: "organisation", website: "medsoc.example.test", vatNumber: "GB000000000" } → 201
it("reads an organisation with its live members, primary first", ...);
  // two members via PUT /people/:id/memberships, one later merged by SQL (merged_into_id and deleted_at) → only the live one listed
it("edits an organisation with the time it last read, and refuses an older read", ...); // 200, then 409 STALE_RECORD
it("answers not found for another venue's organisation", ...);                        // GET and PATCH → 404
it("lets sales create an organisation", ...);                                          // 201
```

- [ ] **Step 2: Run them to see them fail**

Run the two commands from Task 6 Step 3. Expected: FAIL, 404 for `/people/organisations`.

- [ ] **Step 3: Implement**

The organisation rules mirror Task 6's: the gate first, the owner default and check, the millisecond `expectedUpdatedAt` comparison, live members only (`liveContact()`), and log ids only. `primaryContactId` stays as written until Task 10 or a merge changes it.

- [ ] **Step 4: Run them to see them pass**

Expected: both files pass, none skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/people-organisations.ts packages/api/src/routes/people.ts packages/api/src/__tests__/people-routes.test.ts packages/api/src/__tests__/people-routes-postgres.test.ts
git commit -m "feat(api): organisations and households in the People Book (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Search

**Files:**
- Create: `packages/api/src/services/people-search.ts`
- Modify: `packages/api/src/services/client-search.ts:47-67` (export `Matcher` and `matcher`)
- Modify: `packages/api/src/routes/people.ts`
- Test: `packages/api/src/__tests__/people-routes.test.ts`, `packages/api/src/__tests__/people-routes-postgres.test.ts`

**Interfaces:**
- Consumes: `matcher(query: string): Matcher`, `normalisePhone`, `PeopleSearchResults`.
- Produces: `searchPeople(db: Database, query: string, scopeVenueId: string | null): Promise<PeopleSearchResults>`; route `GET /people/search?q=` (200; 400 `VALIDATION_ERROR` under 2 characters).

- [ ] **Step 1: Write the failing tests**

Append `["GET", "/people/search?q=murray"]` to `ROUTES`. In the database test, with "Aileen Murray" (aileen.murray@example.test, 07700 900123, member of "Murray household"):

```ts
it("finds a person by a name heard rather than read", ...);   // q "Murrey" → people[0] { name "Aileen Murray", matched "name", organisationName "Murray household" }
it("finds a person by part of their email", ...);             // q "aileen.murray@" → matched "email"
it("finds a person from any shape of their phone", ...);      // Review Focus 1: q "07700 900 123" and q "+44 7700 900123" → matched "phone"
it("finds organisations and counts their members", ...);      // q "Murray" → organisations [{ name "Murray household", kind "household", memberCount 1 }]
it("finds only this venue's live people", ...);               // a merged and an otherVenueId "Aileen Murray" are absent
it("takes the query's own wildcards literally", ...);          // q "%%" → people [] and organisations []
```

- [ ] **Step 2: Run them to see them fail**

Expected: FAIL, 404 for `/people/search` (or 400 from the `:personId` uuid check).

- [ ] **Step 3: Implement**

People match when `matcher(q)` matches `contacts.name` (`matched: "name"`), or an email point's `value` (`"email"`), or, when `normalisePhone(q)` has at least 6 digits, a phone point whose `value` contains those digits with any leading `+` removed (`"phone"`). Organisations match by name. Live records only, the venue unless the scope is platform-wide; ordered by the matcher's rank (1 for an email or phone hit), then name; at most 20 each. `email` and `phone` in a result are the mirrors.

- [ ] **Step 4: Run them to see them pass**

Expected: both files pass, none skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/people-search.ts packages/api/src/services/client-search.ts packages/api/src/routes/people.ts packages/api/src/__tests__/people-routes.test.ts packages/api/src/__tests__/people-routes-postgres.test.ts
git commit -m "feat(api): search people by name, email or any shape of phone (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Public enquiries link to a person; guest leads become insert-only

**Files:**
- Create: `packages/api/src/services/people-link.ts`
- Modify: `packages/api/src/routes/public-enquiries.ts:183-238`
- Modify: `packages/api/src/__tests__/public-enquiry-venue-slug-postgres.test.ts:92` and its returning-guest case (`:200-214`), `packages/api/src/__tests__/fixtures/public-enquiry-postgres.sql`, `packages/api/src/__tests__/enquiries-acknowledgement-postgres.test.ts:181-184` and `:217`
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts`
- Test: `packages/api/src/__tests__/people-enquiry-link-postgres.test.ts`

**Interfaces:**
- Consumes: Task 6 `insertPerson`, `lockPerson`, `liveContact()`; `normaliseEmail`, `isUsablePhone`.
- Produces:
  - `personEmailLockKey(venueId: string, normalisedEmail: string): string`, which is `` `people-email:${venueId}:${normalisedEmail}` ``.
  - `EnquiryForLink = { id: string; venueId: string; contactId: string | null; email: string; name: string | null; phone: string | null }`.
  - `LinkOutcome = { outcome: "linked" | "created"; contactId: string } | { outcome: "ambiguous"; contactId: null }`.
  - `linkEnquiryToPerson(tx: PeopleTx, enquiry: EnquiryForLink, options: { ownerUserId: string | null; whenShared: "leave" | "create" }): Promise<LinkOutcome>`.

- [ ] **Step 1: Write the failing test**

`people-enquiry-link-postgres.test.ts` on the fixture, registering `publicEnquiryRoutes` at `/public`, with `services/email.js` and `services/commercial-notifications.js` mocked as in `public-enquiry-venue-slug-postgres.test.ts:38-46`, a space for each venue, and `TWIN_PUBLIC_VENUE_SLUGS` set to both fixture venue slugs (restored after).

```ts
it("makes a person for a new email, with their phone, and links the enquiry", ...);
  // { email "kirsty@example.test", name "Kirsty Lane", phone "0141 496 0001" } → 201; one contact "Kirsty Lane" at the venue,
  // points [email kirsty@example.test primary, phone 01414960001 primary], owner null, last_contact_at set; enquiry.contact_id = it
it("links a returning guest who types their email differently, and makes nobody new", ...);  // Review Focus 2
  // person holding aileen.murray@example.test; enquiry with " Aileen.Murray@Example.TEST " → linked to them, contacts count unchanged
it("links neither of two people who share an email, and makes no third", ...);              // Review Focus 3
  // two people hold "couple@example.test"; enquiry → contact_id null; still two holders
it("keeps a separate person at each venue for one email", ...);                              // A then B → two contacts, one per venue
it("makes one person when the same new email arrives twice at once", ...);
  // Promise.all of two enquiries from "twice@example.test" → both 201, one contact, both enquiries linked to it
it("answers every guest alike, whoever they turn out to be", ...);
  // the 201 bodies of a created, a linked and a shared-email enquiry have exactly the keys enquiryId and message, the same message
it("writes a guest lead once and never overwrites it from another venue", ...);
  // first at A: lead name "Kirsty Lane", phone "0141 496 0001"; then at B with name "Somebody Else", phone "07700 900999" → lead unchanged
```

In the existing tests: `public-enquiry-postgres.sql` gains `client_accounts`, `contacts`, `contact_points` and `account_memberships` with every column the Drizzle model declares, and `enquiries.contact_id`; the venue-slug test's reset statement names them too, and its returning-guest case now expects the lead to keep the first enquiry's phone, "0141 000 0000". `enquiries-acknowledgement-postgres.test.ts` adds `schema.clientAccounts, schema.contacts, schema.contactPoints, schema.accountMemberships` to its tables and its reset statement.

- [ ] **Step 2: Run it to see it fail**

Run: `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-enquiry-link-postgres.test.ts`
Expected: FAIL, no contact made and `contact_id` null.

- [ ] **Step 3: Implement `linkEnquiryToPerson`**

```text
key = normaliseEmail(enquiry.email); null → ambiguous
advisory lock personEmailLockKey(venueId, key)
up to two attempts:
  holders = DISTINCT live contacts at the venue with an email point of value key, LIMIT 2
  2 holders → whenShared "leave": ambiguous, nothing written; "create": go to create
  1 holder  → lockPerson; not live (merged meanwhile; its points have moved) → next attempt
              live → enquiries.contact_id = it; contacts.last_contact_at = GREATEST(last_contact_at, now()) → linked
  0 holders → create
create: insertPerson { name: enquiry.name ?? enquiry.email, ownerUserId, sourceEnquiryId: enquiry.id, lastContactAt: now,
          contactPoints: [email primary] + [phone primary when isUsablePhone(phone)] }; enquiries.contact_id = it → created
after two attempts with no live holder: ambiguous
```

- [ ] **Step 4: Put the public enquiry in one transaction**

In `public-enquiries.ts`, the enquiry insert, its status history, `linkEnquiryToPerson(tx, …, { ownerUserId: null, whenShared: "leave" })` and the guest lead run in one `db.transaction`; the in-app notice, the acknowledgement and the hallkeepers' emails stay after it, unchanged. The guest lead is inserted only when no row has that exact email (`INSERT … SELECT … WHERE NOT EXISTS`); the update branch (`:230-238`) goes, which ends the cross-venue overwrite. Log `{ event: "enquiry.person_linked", enquiryId, venueId, outcome }`. The 201 body is unchanged.

- [ ] **Step 5: Run the new and changed tests to see them pass**

Run Step 2's command, then `VENVIEWER_ROUTE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_route_atomicity_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/enquiries-acknowledgement-postgres.test.ts`, then the venue-slug file with `VENVIEWER_PUBLIC_ENQUIRY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_public_enquiry_test` (create that database first).
Expected: all pass, none skipped.

- [ ] **Step 6: Add the new file to `PLATFORM_POSTGRES_TEST_FILES` and commit**

```bash
git add packages/api/src/services/people-link.ts packages/api/src/routes/public-enquiries.ts packages/api/src/__tests__/people-enquiry-link-postgres.test.ts packages/api/src/__tests__/public-enquiry-venue-slug-postgres.test.ts packages/api/src/__tests__/fixtures/public-enquiry-postgres.sql packages/api/src/__tests__/enquiries-acknowledgement-postgres.test.ts packages/api/src/scripts/run-platform-postgres-tests.ts
git commit -m "feat(api): a public enquiry finds or makes its person, and never overwrites a guest lead (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Create-from-enquiry reuses the person and their organisation

**Files:**
- Modify: `packages/api/src/services/people-link.ts`
- Modify: `packages/api/src/routes/crm.ts:112-150`
- Test: `packages/api/src/__tests__/crm-postgres.test.ts:84-87` (tables), `:116` (reset), new cases

**Interfaces:**
- Consumes: Task 9 `linkEnquiryToPerson`, `EnquiryForLink`; Task 6 `lockPerson`, `isCommercialMember`, `refreshContactMirror`; Task 7 `insertOrganisation`.
- Produces:
  - `ensureEnquiryPerson(tx: PeopleTx, enquiry: EnquiryForLink, ownerUserId: string | null): Promise<{ contactId: string; created: boolean }>`: the linked person when `enquiry.contactId` is live (locked), otherwise `linkEnquiryToPerson(…, { ownerUserId, whenShared: "create" })`.
  - `ensurePrimaryAccount(tx: PeopleTx, person: { id: string; venueId: string; name: string }, input: { sourceEnquiryId: string; createdBy: string; ownerUserId: string | null }): Promise<{ account: typeof clientAccounts.$inferSelect; created: boolean }>`: the person's primary membership's live account, or a new household named after them (kind `household`, account type `event_client`, primary contact the person) with a primary membership, followed by `refreshContactMirror`.

- [ ] **Step 1: Write the failing tests**

Add `schema.contactPoints, schema.accountMemberships` to `tables` and to the reset statement. The existing "makes one deal of an enquiry, however many presses reach it at once" stays unchanged; it now also proves the person and household are made once. New cases (people inserted by SQL into the fixture schema):

```ts
it("reuses the enquiry's person and their household", ...);
  // person P (email point) in household H (primary membership), enquiry linked to P → 201;
  // deal.primary_contact_id = P, client_account_id = H; contacts and client_accounts counts unchanged; body.contact.id = P
it("gives a person with no organisation a household named after them", ...);
  // P with no membership → a new client_accounts row { name: P.name, kind: "household", primary_contact_id: P },
  // a primary membership, contacts.client_account_id = it
it("finds the person by email when the enquiry has none", ...);
  // unlinked enquiry; P holds its email → enquiry.contact_id = P and the deal is P's
it("makes a new person for an email two people share", ...);                     // Review Focus 3
  // two holders; unlinked enquiry → a third person, the enquiry linked to it, the deal its
it("brings the person's last contact forward", ...);                             // P.last_contact_at ≥ the time before the press
```

- [ ] **Step 2: Run them to see them fail**

Run: `VENVIEWER_ROUTE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_route_atomicity_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/crm-postgres.test.ts`
Expected: the new cases FAIL (a new account and contact every time); the existing cases pass.

- [ ] **Step 3: Implement**

Inside the existing transaction, after the advisory lock and the existing-deal check (`crm.ts:121-126`, unchanged): the owner is the actor when `isCommercialMember(tx, venueId, actor)`, else none; `ensureEnquiryPerson` with `{ email: guestEmail ?? email, name: guestName ?? name, phone: guestPhone }`; `ensurePrimaryAccount`; `contacts.last_contact_at = GREATEST(last_contact_at, now())`; then the deal, activity, history and follow-up exactly as today. The response keeps its shape: `clientAccount` and `contact` are the rows used, re-read after the mirror refresh.

- [ ] **Step 4: Run them to see them pass**

Run Step 2's command. Expected: every case passes, none skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/people-link.ts packages/api/src/routes/crm.ts packages/api/src/__tests__/crm-postgres.test.ts
git commit -m "feat(api): a deal from an enquiry joins the person and household already known (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Merge preview, merge and tombstones

**Files:**
- Create: `packages/api/src/services/people-merge.ts`
- Modify: `packages/api/src/services/people-records.ts` (`readPersonProfile` merged answer)
- Modify: `packages/api/src/routes/people.ts`
- Modify: `packages/api/src/scripts/run-platform-postgres-tests.ts`
- Test: `packages/api/src/__tests__/people-routes.test.ts`, `packages/api/src/__tests__/people-merge-postgres.test.ts`

**Interfaces:**
- Consumes: Task 6 `lockPerson`, `refreshContactMirror`, `readPersonProfile`; `RecordMergeSnapshot`, `RecordMergeMove`, `MergePreview`, `MergeResult`, `MERGE_MOVE_TARGETS`, `MERGE_FILLED_FIELDS`, `MERGE_UNDO_DAYS`.
- Produces:
  - `MergeFailure = { kind: "not_found" } | { kind: "same_record" } | { kind: "already_merged"; survivorId: string } | { kind: "survivor_merged"; mergedIntoId: string }`.
  - `previewPersonMerge(db: PeopleConn, scopeVenueId: string | null, mergedId: string, survivorId: string): Promise<MergePreview | MergeFailure>`.
  - `applyPersonMerge(db: Database, scopeVenueId: string | null, mergedId: string, survivorId: string, actorId: string): Promise<MergeResult | MergeFailure>`.
  - Routes `GET /people/:personId/merge-preview?survivorId=` (200; 404; 422 `SAME_RECORD`; 409 `ALREADY_MERGED`, `SURVIVOR_MERGED`) and `POST /people/:personId/merge` (`MergeRequestSchema`; 201 new, 200 `replayed: true`; the same refusals). `:personId` is the record that closes.
  - `GET /people/:personId` of a merged person: 200 `{ status: "merged", mergedInto: { id, name }, mergeId, mergedAt }` from the newest not-undone `record_merges` row; every Task 6 write to a merged person (`lockPerson` state `merged`): 409 `{ code: "MERGED", mergedIntoId }`.

- [ ] **Step 1: Write the failing tests**

Append the two routes to `ROUTES`. `people-merge-postgres.test.ts`, on the fixture with `peopleRoutes` and `publicEnquiryRoutes` (mocked as in Task 9). Each case builds its own pair: S "Aileen Murray" (aileen.murray@example.test primary; member of organisation X, primary; no job title); L "A. Murray" (aileen.murray@example.test, held by S too; aileen@work.example.test; phone "07700 900123", primary; member of X, also held, and of household Y; job title "Secretary"); enquiries E1 and E2 for L; deal D1 with primary contact L; Y's primary contact L; an earlier tombstone T with `merged_into_id` L.

```ts
it("says what moves before anything moves", ...);
  // preview → moves { "contact_points.contact_id": 2, "account_memberships.contact_id": 1, "enquiries.contact_id": 2,
  //   "opportunities.primary_contact_id": 1, "client_accounts.primary_contact_id": 1, "contacts.merged_into_id": 1 },
  //   alreadyHeld { contactPoints: 1, memberships: 1 }; every table's rows identical before and after the preview
it("moves everything to the survivor in one go, and keeps a record", ...);
  // POST merge → 201, MergeResultSchema; moves equal the preview; E1, E2, D1, Y.primary_contact_id and T now S;
  // S points: aileen.murray@ primary, aileen@work. not primary, phone primary; S.phone "07700 900123";
  // S memberships X primary, Y not; S.job_title "Secretary"; L merged_into_id S and deleted_at set; one record_merges row
it("answers an old link to the merged person with where they went", ...);
  // GET L and GET T → { status: "merged", mergedInto: { id: S, name: "Aileen Murray" } }; PATCH L → 409 MERGED
it("answers a second press with the same merge", ...);                       // Review Focus 4: 200, replayed true, same mergeId, one row
it("does one of two opposite merges pressed at once", ...);                  // Review Focus 4
  // Promise.all(merge L into S, merge S into L) → one 201 and one 409; one record; exactly one of the two a tombstone
it("refuses a merge into itself, another venue's person or a closed record", ...);
  // same id → 422 SAME_RECORD; survivor at otherVenueId → 404; survivor already merged → 409 SURVIVOR_MERGED
it("links a later enquiry from a moved email to the survivor", ...);         // public enquiry from aileen@work.example.test → contact_id S
it("lets sales merge", ...);                                                 // 201
```

- [ ] **Step 2: Run them to see them fail**

Run: `VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api exec vitest run src/__tests__/people-merge-postgres.test.ts`
Expected: FAIL, 404 for the merge routes.

- [ ] **Step 3: Implement `applyPersonMerge`, in this order, in one transaction**

```text
1. Read L's venue (404 outside the scope); advisory lock people-merge:<venue>.
2. Lock L and S: SELECT … FOR UPDATE, ascending id. Checks, in order: L = S → same_record (before any read);
   either missing, deleted or erased, or S at another venue → not_found; L.merged_into_id = S → replay the newest
   not-undone record for (venue, 'person', L, S); L merged elsewhere → already_merged; S merged → survivor_merged.
3. Snapshot: L's row, all of L's points and memberships; removed and survivorFilled empty.
4. contact_points: delete L's points whose (kind, value) S holds (ids into removed.contactPointIds); then
   UPDATE … SET contact_id = S, is_primary = is_primary AND NOT <S has a primary of that kind> WHERE contact_id = L RETURNING id.
5. account_memberships: likewise; delete L's memberships of accounts S belongs to (removed.membershipIds), move the rest,
   primary only if S has none.
6. enquiries.contact_id, 7. opportunities.primary_contact_id, 8. client_accounts.primary_contact_id,
   9. contacts.merged_into_id (earlier tombstones, so every tombstone is one hop from a live record):
   each UPDATE … SET <column> = S WHERE <column> = L RETURNING id, changing no other column.
10. Survivor fields: each of MERGE_FILLED_FIELDS but lastContactAt that is null on S and set on L is copied; lastContactAt
    becomes the later of the two; each change goes into survivorFilled { field, before, after } (dates as ISO strings).
11. refreshContactMirror(S).
12. Tombstone L: merged_into_id = S, deleted_at = now(), updated_at = now().
13. Insert record_merges { kind 'person', survivor S, merged L, snapshot, moves: one entry per MERGE_MOVE_TARGETS
    in this order, ids possibly empty, merged_by actor }.
Result: counts from the moves, alreadyHeld from removed, undoUntil = merged_at + MERGE_UNDO_DAYS.
```

`previewPersonMerge` runs the checks and counts of steps 2 to 9 without locks or writes. Log `{ event: "people.merged", mergeId, survivorId, mergedId }` only.

- [ ] **Step 4: Run them to see them pass**

Run Step 2's command and the gate test. Expected: both pass, none skipped.

- [ ] **Step 5: Add the file to `PLATFORM_POSTGRES_TEST_FILES` and commit**

```bash
git add packages/api/src/services/people-merge.ts packages/api/src/services/people-records.ts packages/api/src/routes/people.ts packages/api/src/scripts/run-platform-postgres-tests.ts packages/api/src/__tests__/people-routes.test.ts packages/api/src/__tests__/people-merge-postgres.test.ts
git commit -m "feat(api): merge two people with a preview, a record and a tombstone (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Undo a merge within 30 days

**Files:**
- Modify: `packages/api/src/services/people-merge.ts`
- Modify: `packages/api/src/routes/people.ts`
- Test: `packages/api/src/__tests__/people-routes.test.ts`, `packages/api/src/__tests__/people-merge-postgres.test.ts`

**Interfaces:**
- Consumes: Task 11 records, `RecordMergeSnapshotSchema`, `RecordMergeMoveSchema`, `MergeUndoReportSchema`, `MergeUndoResult`.
- Produces:
  - `UndoFailure = { kind: "not_found" } | { kind: "undo_expired" } | { kind: "later_merge_first"; laterMergeId: string } | { kind: "erased" }`.
  - `undoPersonMerge(db: Database, scopeVenueId: string | null, mergeId: string, actorId: string): Promise<MergeUndoResult | UndoFailure>`.
  - Route `POST /people/merges/:mergeId/undo`: 200 `MergeUndoResult` (`replayed` true for a second press); 404; 409 `UNDO_EXPIRED`, `UNDO_LATER_MERGE_FIRST` (with `laterMergeId`), `ERASED`.

- [ ] **Step 1: Write the failing tests**

Append the route to `ROUTES`. In the merge test, after Task 11's merge of L into S:

```ts
it("puts everything back within 30 days", ...);
  // undo → 200, MergeUndoResultSchema, skipped []; L live (merged_into_id and deleted_at null); E1, E2, D1, Y.primary_contact_id
  // and T back on L; L's three points (the shared address re-made with its original id) and two memberships with their own
  // primary flags; S back to its one point and membership, job_title null, phone null; record undone_at and undone_by set
it("leaves what a colleague changed since, and says so", ...);               // Review Focus 5
  // after the merge: D1.primary_contact_id → another person Q; S.job_title → "Chair"; undo →
  // D1 stays Q; S.job_title stays "Chair"; skipped contains { target: "opportunities.primary_contact_id", ref: D1 }
  // and { target: "survivor_field", ref: "jobTitle" }; everything else restored
it("answers a second press with the same report", ...);                      // 200, replayed true, identical report
it("closes after 30 days", ...);                                             // merged_at = now() - 31 days → 409 UNDO_EXPIRED; 29 days → 200
it("asks for the later merge to be undone first", ...);
  // A into B, then B into C; undo of the first → 409 UNDO_LATER_MERGE_FIRST with the second's id; undo the second, then the first → both 200
it("answers not found for another venue's merge, and lets sales undo", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run the command from Task 11 Step 2. Expected: FAIL, 404 for the undo route.

- [ ] **Step 3: Implement `undoPersonMerge`, in this order, in one transaction**

```text
1. Load the record within the scope (404); advisory lock people-merge:<venue>; reload it FOR UPDATE.
2. undone_at set → replay undo_report with replayed true.
3. SQL clock: merged_at <= now() - interval '30 days' → undo_expired.
4. Lock L and S (ascending id). L erased → erased. L.merged_into_id ≠ S → later_merge_first with the newest not-undone
   record whose merged_id is S.
5. Restore L: merged_into_id = null, deleted_at = snapshot.person.deletedAt, updated_at = now().
6. For each move, in reverse merge order: UPDATE <table> SET <column> = L WHERE id = ANY(ids) AND <column> = S RETURNING id;
   points and memberships move back with is_primary false; ids not returned → skipped { target, ref: id }.
7. Re-insert the removed points and memberships from the snapshot for L, original ids, is_primary false,
   target-less onConflictDoNothing; any not inserted → skipped { target: "removed_row", ref: id }.
8. Set is_primary on L's restored points and memberships as the snapshot had them.
9. Each survivorFilled entry: UPDATE contacts SET <field> = before WHERE id = S AND <field> IS NOT DISTINCT FROM after
   (lastContactAt compared at millisecond precision); no row → skipped { target: "survivor_field", ref: field }.
10. refreshContactMirror(L) and refreshContactMirror(S).
11. Record: undone_at = now(), undone_by = actor, undo_report = { restored, skipped }.
```

Every jsonb value is parsed with its schema before use; a record that does not parse is a 500 with the merge id logged, and nothing changes.

- [ ] **Step 4: Run them to see them pass**

Expected: both files pass, none skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/people-merge.ts packages/api/src/routes/people.ts packages/api/src/__tests__/people-routes.test.ts packages/api/src/__tests__/people-merge-postgres.test.ts
git commit -m "feat(api): undo a merge within 30 days, keeping what changed since (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Verify the slice, record it and hand it on

**Files:**
- Modify: `docs/engineering/README.md` (a "People Book" row in "Find the implementation")
- Modify: `docs/state/tasks.md` (the T-665 row; add it if master still has none)
- Modify: `docs/design/platform-2026-09-26/roadmap.md` (row 8's "Sales has dates and pages until C2"), `docs/design/find-anything-2026-10-07/README.md:97` (the C2 note)
- Create or modify: `docs/sessions/<date of the work>.md`

- [ ] **Step 1: Run every check from a clean tree**

```bash
pnpm --filter @omnitwin/types build
pnpm typecheck
pnpm lint
VENVIEWER_ROUTE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55476/venviewer_route_atomicity_test pnpm test
VENVIEWER_PLATFORM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test pnpm --filter @omnitwin/api test:platform-db
pnpm --filter @omnitwin/web exec playwright test e2e/find-anything.spec.ts
```

Expected: all green; the platform receipt lists the four new files passed with zero skipped. A machine short of memory fails vitest workers with "Failed to start forks worker": rerun alone and keep the failed output.

- [ ] **Step 2: Record what is true**

The engineering-map row names `routes/people.ts`, `services/people-*.ts` and migration 0094, and the boundaries: venue-scoped with composite keys, the mirrors, the lock order, tombstones. The session log records the calls this plan made: a merge sets `deleted_at` beside `merged_into_id` so every existing reader drops a tombstone unchanged; the legacy columns are mirrors; organisation merges and "kept apart" are not built; the pre-deploy-window residual; the provisional migration number. The roadmap and Find notes say sales searches clients since this slice. The task row says local, committed or merged as the evidence shows.

- [ ] **Step 3: Commit, push and hand to the chief of staff**

```bash
git add docs/engineering/README.md docs/state/tasks.md docs/design/platform-2026-09-26/roadmap.md docs/design/find-anything-2026-10-07/README.md docs/sessions/<date>.md
git commit -m "docs: record People Book slice 1 (T-665)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Open the pull request against master with the check evidence and the platform receipt, and send the chief of staff its head SHA for the migration number and the merge queue. After it deploys: `/health/version` reports the merge SHA, the ledger holds the migration, and a signed-in sales session's `GET /clients/search?q=<a real client's name>` answers 200; record those three facts in the task row.
