# OmniTwin Foundry Activation V1 — joint freeze-readiness audit of the nine-artifact contract set and parent contract

**Provenance:** produced 2026-07-28 by an independent, non-author machine reviewer session (fresh context, strictly read-only, no file edited by the reviewer) and saved verbatim by the orchestrating T-508 session. Unsigned, authority-none record in the house style of the 2026-07-14 activation audits. This receipt is not cryptographic proof of reviewer identity, time, independence, or immutable custody.

Date: 2026-07-28
Reviewer class: independent, non-author, frozen-hash machine review
Authority: **none — unsigned, internal, authority-none record**

This was a strictly read-only review. No file was created, edited, moved, or deleted. It audits the joint freeze demanded by `docs/specs/omnitwin-foundry-activation-callable-api-v1.md:23-25` — "All nine artifacts must be frozen and audited together before the second-amended activation contract or 0058 changes" — and by the NO-GO report's next admissible step (`docs/reports/omnitwin-foundry-derivative-activation-0058-draft-no-go-2026-07-14.md:121-128`): "Design the minimal authenticated runner/verifier receipt and closed privileged callable API contracts without weakening direct-DML denial. Independently audit those contracts before changing this draft."

**Set composition ruling.** The "nine artifacts" per the demanding sentence are exactly: the authenticated-result-evidence contract, the callable-API contract itself, the schema/privilege manifest, the request-schema appendix and its JSON Schema, the catalog-manifest format and its JSON Schema, and the workload-inclusion-proof contract and its JSON Schema. This matches the nine-row "Activation V1 contract set" table in `docs/handoffs/2026-07-14-omnitwin-foundry-continuation.md:57-69`. The parent contract is the tenth, separately recorded object of the future amendment. The authenticated-evidence byte-vectors pair is an adjacent frozen implementation-vector artifact recorded later (`docs/handoffs/2026-07-15-omnitwin-foundry-continuation.md:215-221`), not one of the nine. The gateway-token proposal is adjacent and, by its own status, `proposed_not_frozen`. Counting either into "the nine" would be a misreading; both are audited here anyway.

## Method

1. Read both prior independent audits and the 0058 NO-GO report in full to fix format, severity ladder, and boundary language.
2. Recomputed SHA-256 and byte size for all 16 files with `sha256sum`/`stat` and compared against the recorded tables in the 2026-07-14 and 2026-07-15 handoffs.
3. Read all six new contract documents (9,066 total lines across the eight `.md` files), including every normative section named in the task (callable-api §§1-11 complete; parent §§1-4, 6-8, 10, 15-17; result-evidence §§3, 4.1, 9-12; privilege manifest §§1-3, 7-9 plus the R22/R23 replacement text; catalog format §§1, 6, 7, 9, 10, 14, 15; request schemas complete; workload proof §§1-2, 13-14 anchors; gateway proposal complete).
4. Parsed all eight JSON artifacts with a duplicate-key-rejecting parser; structurally compared each against its `.md` counterpart; compared the byte-vectors against `packages/reconstruction-foundry/src/activation-v1-authenticated-evidence-bytes.ts`.
5. Verified the 0059 collision against `packages/api/drizzle/0059_action_log.sql`, the Drizzle journal at HEAD and on disk, git tracking state, and full journal history including a prefix-identity check of entries 0-56.
6. Checked git custody (`git status --porcelain`, `git ls-files`, `git log --all --diff-filter=A`) for every artifact, the migrations, the journal, `.gitattributes`, and the hash-recording handoffs themselves.

## Recomputed identity table

All sixteen recomputations match their recorded identities exactly. No byte drift in any audited artifact.

| Artifact (docs/specs/) | Bytes | Recomputed SHA-256 | Recorded | Match |
| --- | ---: | --- | --- | --- |
| omnitwin-foundry-derivative-activation-v1.md (parent) | 69,012 | `1f593314fd45850950afe168548ac1eefebabea2e0754ee05101cc21c4371659` | 07-14 handoff:75-76; second-amendment audit | exact |
| omnitwin-foundry-authenticated-result-evidence-v1.md | 87,168 | `550169ce29f47982ea2ff36e7a88cf978d9941fbeb60f776f6d49d67d3560875` | 07-14 handoff:61 | exact |
| omnitwin-foundry-activation-callable-api-v1.md | 105,456 | `1a338fbd01521951c85d8b3ada30891ab4ad56c834066f6c8477d04fd07aa15f` | 07-14 handoff:62 | exact |
| omnitwin-foundry-activation-v1-schema-privilege-manifest.md | 130,878 | `f3c053b3468e9a31bb79e91e09b9756736ac86d6a5d07ec402d9d98cdf39da41` | 07-14 handoff:63 | exact |
| omnitwin-foundry-activation-v1-catalog-manifest-format.md | 68,123 | `f5e04286720f20132ed8694e6d1213290ebe3b91da38869f53063d9c6dd9f6e4` | 07-14 handoff:64 | exact |
| omnitwin-foundry-activation-v1-catalog-manifest.schema.json | 347,162 | `dce1bad7aa190976ac98b62e0b943956861aabbfb97e85a0f1533eea5d968ee9` | 07-14 handoff:65 | exact |
| omnitwin-foundry-activation-v1-request-schemas.md | 18,198 | `784ca41c07540b83142c613c a8ca04c6948dc3620c13c1e93ffc91d3613c4cb7`* | 07-14 handoff:66 | exact |
| omnitwin-foundry-activation-v1-request-schemas.schema.json | 25,107 | `61a9ba7e0d5d00f59773b6dc2ab8a3fb0eda12758ed07018641ce0c22cecd4bd` | 07-14 handoff:67 | exact |
| omnitwin-foundry-activation-v1-workload-inclusion-proof.md | 69,070 | `cbb147b37933a64ccebc5f0ee7a51236e7d178dbd01b985c826492f8ac33400f` | 07-14 handoff:68 | exact |
| omnitwin-foundry-activation-v1-workload-inclusion-proof.schema.json | 38,313 | `56900412b6041222aea82619c522ed26a87588331a22b141a8e6b9b9f39086e0` | 07-14 handoff:69 | exact |
| …-authenticated-evidence-byte-vectors.json | 6,604 | `c3daba1eeecd823d53be0cc83352049758fa730415d1a7e904cd4bd5f4f43d5a` | 07-15 handoff:220 | exact |
| …-authenticated-evidence-byte-vectors.schema.json | 11,315 | `e6b601532a7f8ed99b251a16f09604d4c2be22823dcd68899238aa18be83ba1f` | 07-15 handoff:221 | exact |
| …-gateway-token-commitment-proposal.md | 9,146 | `708cebf62955e293e6fcda90e696a8f20b6164bd793e8db960c5021d841526c5` | 07-15 handoff:424 | exact |
| …-gateway-token-commitment-proposal.schema.json | 5,077 | `ed1767703c6ecba64f2441e93252a55c7f06bd596f950669b9ff4f3334c7cefa` | 07-15 handoff:425 | exact |
| …-gateway-token-commitment-proposal-vectors.json | 12,784 | `4f8838d712c4a68a773c94190dbdcfb3f2268409b960282ae32cd2acdda6b23b` | 07-15 handoff:426 | exact |
| …-gateway-token-commitment-proposal-vectors.schema.json | 6,825 | `3bd6c6e862dba618892c759ac9c86525abd790a07b3fd194a0f16117f1b05073` | 07-15 handoff:427 | exact |

\* transcription note added at save time: the reviewer's value contained no interior space; it is `784ca41c07540b83142c613ca8ca04c6948dc3620c13c1e93ffc91d3613c4cb7`.

Byte hygiene independently reverified for the parent plus the nine: all UTF-8, BOM-free, zero CR bytes, final-LF terminated, zero trailing-whitespace lines. All eight JSON artifacts parse strictly with zero duplicate keys at any depth. Migrations 0053-0058 recomputed byte-identical to the frozen table (0058 = 262,281 B, `1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e`), on disk and at HEAD.

## Git custody (branch `feature/diary-p0-slice-3`)

- **Tracked and byte-identical to HEAD:** the result-evidence contract and both byte-vectors files (committed in `8cd027fa`, "fix(api,types): land the complete Foundry coherence closure — … (T-526)"); migrations 0053-0061; the journal.
- **Untracked (`??`) — no commit custody on any ref, no stash:** the parent contract, the callable-api, the privilege manifest, both request-schema files, both catalog-manifest files, both workload-proof files, all four gateway-proposal files, **and** the 2026-07-14 and 2026-07-15 handoffs and all three prior audit/NO-GO reports that record the frozen hashes. `git log --all --diff-filter=A` returns empty for these paths. Eight of the nine freeze-demanded artifacts, the parent, and the entire hash record exist only as working-tree bytes. This is classified below.

## Findings

### P0

None.

### P1

**P1-1 — The joint freeze has no commit custody: eight of the nine artifacts, the parent, and the hash record itself are untracked working-tree files.**
Only `omnitwin-foundry-authenticated-result-evidence-v1.md` and the byte-vectors pair are committed. The callable-api (the document demanding the freeze), the parent, the privilege manifest, the request/catalog/workload files, and the handoffs recording every frozen identity have never been committed on any ref. A "freeze" whose byte identities are pinned only by hash tables inside other uncommitted files has no durability guarantee and no tamper evidence; a filesystem event or accidental edit would leave nothing to diff against. This also conflicts with the repository's own ADR-070 posture (files-in-git as source of truth). The bytes demonstrably have not drifted in fourteen days — every recomputation above is exact — so this blocks the freeze *declaration*, not the audit conclusion. Condition for closure: one byte-preserving commit of the nine, the parent, the adjacent vector/proposal files, and the identity record, followed by a post-commit hash re-verification. The current `.gitattributes` (`docs/specs/omnitwin-foundry-*.md text eol=lf`, `*.json text eol=lf`, byte-vectors `-text`) makes such a commit byte-preserving for these LF-only files; note that `.gitattributes` itself is also modified-uncommitted (see P3-4).

### P2

**P2-1 — The 0059 ordinal collision: the parent's enable-migration designation is now unsatisfiable as written.**
Independently verified. `packages/api/drizzle/0059_action_log.sql` exists (1,725 B, SHA-256 `be3f5cce9060a2c4ab2c43b458b6edfaa63b27cbaffb9e959ad20e4eb6e62133`, committed, byte-identical to HEAD), header comment: "0059_action_log — G4 Slice 3 (03 §2): the append-only audit trail behind the planner's Action envelope." The journal has 60 entries; idx 57 = `0059_action_log`, idx 58 = `0060_phase_layout_snapshot_lineage`, idx 59 = `0061_diary_commands`, all committed. The parent states at `docs/specs/omnitwin-foundry-derivative-activation-v1.md:105-107`: "**0059, and only 0059, may enable.** It may append generation 2 enabled only when the re-audited epoch JSON binds every exact artifact and receipt," with matching ordinal usage in §15's stage table (line 1053) and §16 "0059 evidence gate" (line 1138). Ordinal 0059 is permanently consumed by an unrelated planner migration in committed history; a Foundry enable migration can now only ever receive index ≥ 0062. Direction of failure: **closed** — the collision creates no enablement authority (the action-log migration touches no epoch/V1 relation; the only activation epoch remains `disabled_sentinel|false`), so it is **recordable-with-amendment, not freeze-blocking**. The minimal amendment path is in the dedicated section below.

### P3

**P3-1 — Status-header heterogeneity in the workload-inclusion-proof contract.**
Seven documents carry an explicit NO-GO-form status ("DESIGN DRAFT / NO-GO — …"; the parent "NO-GO — second amendment awaiting independent re-audit…"; the proposal "proposed, not frozen, authority none, not implementation-approved"). The workload proof instead opens (lines 3-4): "Status: implementation-blocking normative contract for `fdv1_api_register_workload(jsonb)`." Its §1 "Security boundary and non-claims" and §16 "Required integration changes (not applied here)" do the boundary work, and no authority is claimed — but the header form should be harmonized at the next permitted revision so a header-only reader cannot mistake its standing.

**P3-2 — The frozen journal byte identity is historical and unrecoverable.**
The 07-14/07-15 handoffs pin the journal at 8,943 B, SHA-256 `08ab4ac0…`, mixed CRLF/LF, with the instruction "Do not normalize it." That byte form exists nowhere: not on disk (current journal is 9,036 B, `71db91f46f5effd1ccdf46c5d625fd3ac52ff2155fb15891190852beb88b5e0a`, LF-only, 60 entries) and not in any committed blob (the 57-entry committed version at `8cd027fa` is 8,596 B, `8b172d4d…`). I verified semantic integrity directly: entries 0-56 of the current journal are element-for-element identical to the 57-entry committed version, and 0053-0058 migration bytes are exact. The byte-level freeze of the journal was overtaken by commit-time normalization plus three legitimate appends; no content was lost. The joint-freeze record must supersede the stale journal identity with the current one rather than repeating `08ab4ac0…`.

**P3-3 — Positive DSSE vector coverage in the frozen byte-vectors artifact is one of nine profiles.**
`positiveVectors` contains only `runner-terminal-wire-only-ascii-order` (`evidenceKind: runner_terminal`). The other eight signed profiles are exercised only by dynamic tests with disposable keys. The artifact correctly self-declares (`semanticReceiptValidation/databaseAdmission: not_performed`, `privateKeyMaterial: not_included`) and binds its source contract exactly (path, 87,168 B, `550169ce…` — matches my recomputation), so this is a scope note, not a defect: the freeze record should state the 1/9 static coverage so it cannot later be overread as a nine-profile vector corpus.

**P3-4 — The recorded LF-policy anchor is stale and the current policy is uncommitted.**
The 07-14 handoff records `.gitattributes` at `0fbedd28…`. Recomputed: working tree `8a525437…`, HEAD `4b035973…`. The drift is protective — it adds `packages/api/drizzle/*.sql -text` ("no EOL conversion may ever rewrite them") and pins the byte-vectors JSON `-text` ("exact bytes, overriding the eol=lf rule above") — but the freeze record's policy anchor no longer matches anything, and the strengthened policy is itself only working-tree state. Re-record and commit alongside P1-1.

**P3-5 — Tail-relative journal assertions are structurally fragile (contextual, already observed in-repo).**
`docs/sessions/2026-07-18.md:43-48`: "5 Foundry migration-schema tests fail in the worktree ONLY because the G4 session's uncommitted `0059_action_log` journal entry shifts their tail-relative offsets (`at(-7)`) … tail-relative journal assertions break every time anyone appends a migration." T-526's commit message asserts subsequent green state; the durable recommendation stands: Foundry journal assertions must be index-pinned (idx 51-56), never tail-relative, since the journal will keep growing with non-Foundry migrations.

## Per-artifact status review

| Artifact | Status header | Self-declared open items | Authority overclaim |
| --- | --- | --- | --- |
| Parent | "NO-GO — second amendment awaiting independent re-audit…" | §15 stages, §16 evidence gate | none |
| Result evidence | "DESIGN DRAFT / NO-GO — grants no execution, upload, custody, release, signing, publication, or runtime authority" | §3 canonicalizer NO-GO vs current `canonical-json.ts`; §12 acceptance gate | none |
| Callable API | "DESIGN DRAFT / NO-GO — callable-boundary design only" | §2.3 eight-plane identity limitation; §5.4 "provider-result admission and activation V1 remain **NO-GO**"; §5.7 WD-B-001…008 | none |
| Privilege manifest | "DESIGN DRAFT / NO-GO — semantic integration delta, not yet the catalog source manifest" | §8 unresolved column projection "is an integration blocker"; §9 "its absence is an explicit NO-GO blocker, not permission to invent names" | none |
| Request schemas | "DESIGN DRAFT / NO-GO — closes JSON value shapes only; grants no authority" | binds itself to schema + workload proof as "one closed contract" | none |
| Catalog format | "DESIGN DRAFT / NO-GO — strict structural schema present; no expanded catalog or semantic-verifier acceptance evidence" | §15 "No expanded `expectedCatalog` instance … exists yet" | none |
| Workload proof | "implementation-blocking normative contract" (P3-1) | §16 "Required integration changes (not applied here)" | none — §1 non-claims explicit |
| Byte-vectors pair | in-band `authority: none`, `not_performed` markers | wire-only scope | none |
| Gateway proposal | "proposed, not frozen, authority none, not implementation-approved" | §7 promotion gate, owner-review items | none |

No artifact claims authority it cannot have. Every one denies enablement, execution, provider contact, signing, and release in its opening block.

## Cross-consistency matrix — the six gap closures

| Gap (from the 0058 NO-GO findings) | Parent anchor | Closure locations | Coherent? |
| --- | --- | --- | --- |
| 1. Authenticated runner/verifier receipt | §6 custody envelope (caller-constructible booleans were the defect) | Result-evidence §5 (runner terminal receipt), §6 (provider/DB-derived terminal-result link), §7 (GLB-verifier receipt); projected as R27/R28/R29/R30 (manifest §§5.3, 6.1-6.3); consumed by callable-api §5.4 admission, §5.5 broker derivation, §5.6 verifier context/custody; wire primitive implemented in `activation-v1-authenticated-evidence-bytes.ts` + byte vectors | Yes |
| 2. Privileged callable API | §10 privileged-SQL rules | Callable-api §§1-5, 5.8 (31 exact functions: 15 activation + 1 claimer + 1 submit + 5 recovery + 1 admitter + 2 broker + 3 custodian + 2 watchdog + bootstrap); manifest §7 grant matrix cites "the 15 functions in callable API section 5.1" etc.; request-schemas' 11 arms = the 11 jsonb entry points, literal-for-literal (schema `oneOf` count 11, all `…request.v1` consts match the .md) | Yes |
| 3. Source-scoped containment | §7 containment sources (15 kinds) | Callable-api §6 per-source applicability table ("There is no catch-all or digest-only join"); manifest R22 closed 17-kind set = parent's 15 + `workload_authorization_revocation` + `runner_terminal_failure`, with "`workload_authorization_revocation` is not a catch-all" (manifest:812) and the R28-failed-arm-only rule (manifest:814-822) | Yes — additive, declared |
| 4. Reverse closure | §6 reverse scan (public match) | Callable-api §6: "The deferred reverse closure is therefore `source -> exact affected set` and `containment -> exact source and same affected attempt`, not a global existential query"; §5.7 obligation identity + reverse guard reconstructing the locked member set; §10 test 8 (spoofed/unrelated/cross-project sources) | Yes |
| 5. Custody horizon | §7 "There is no single horizon reused across phases" | Result-evidence §9: custody "must not reuse `activation.authority_not_after`, a pricing snapshot, dispatch deadline, submit-grant horizon, executor expiry, or the fixed V0 `foundry_execution_authority_is_current`"; defines `fdv1_result_authority_at(activation_id, attempt_id, db_now)`; callable-api §7 calls exactly `fdv1_result_authority_at(uuid,uuid,timestamptz)` and prohibits the same V0 predicate — signatures and prohibitions agree verbatim | Yes |
| 6. Phase-specific authority | §8 closed phase matrix | Callable-api §7 (one internal function per phase; watchdog `scan_cutoff_at` as sole selection-only exception, mirrored in §4); result-evidence §9 phase/least-horizon table; historical actions validated at their own recorded DB times in both | Yes |

**Declared supersessions of the parent (traceable, not silent):** the privilege manifest §1 "Exact integration replacements" enumerates each divergence the amendment must land: table count 24→30 (§1.1 vs parent §13); role count 7→8+owner+bootstrap (§1.2 — the evidence admitter is new); and search path (§1.3: `SET search_path = pg_catalog, pg_temp` on every `SECURITY DEFINER` entry point, replacing the parent's `pg_catalog, public` — the harder, PostgreSQL-16-recommended form). Because §1 names these as replacements, they are recorded as design intent rather than contradictions. No undeclared contradiction on numbering (R1-R30 consistent everywhere; "the nine existing control tables" in callable-api §1 = the nine 0053 base relations enumerated in its §8), role names, function names, or horizon rules was found.

## Schema and code agreement

- All five `.schema.json` files and both vector JSONs parse strictly, duplicate-key-free. `$id` values use the consistent `https://schemas.omnitwin.invalid/foundry/…` non-resolvable namespace.
- Request schema: 11 top-level `oneOf` arms; the 11 `schemaVersion` consts match the .md sections 2-12 exactly; 32 `$defs` (matching the recorded Ajv compile: 32 definitions). The `db_caller` plane enum and `evidence_signer` evidenceKind enum match callable-api §2.2 and §5.4's kind set exactly.
- Catalog schema: 99 `$defs` (matches recorded 99); contains `WD-B-001`…`WD-B-008`, `PR-A-001`…`PR-A-009`, `PR-R-001`, thirteen-plus `rejectWatchdog*` tokens, and `rejectServiceOrPublicInternalRoutineExecute` — the assertion the 07-14 handoff requires for the known 0058 `fdv1_assert_recovery_boundary` PUBLIC-EXECUTE defect.
- Workload-proof schema: 3 leaf arms, 25 `$defs` (matches recorded 25); the .md's frozen vector roots A/B/C (`075030fa…`, `f13b2f03…`, `de7b3d05…` at lines 784-860) match the 07-14 handoff's recorded roots exactly.
- Byte-vectors vs code: `FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES` (`packages/reconstruction-foundry/src/activation-v1-authenticated-evidence-bytes.ts:9-46`) freezes exactly nine profiles — `bootstrap_ceremony, admin_action, predecessor_source, gateway_token_commitment, runner_terminal, provider_result, storage_create, storage_read, glb_verifier` — whose domain/payloadType pairs match the result-evidence §3 table row-for-row. The vector file's positive vector uses the `runner_terminal` profile with the matching domain/payload type, and every `expectedErrorCode` in the negative vectors is a literal member of `FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES`. The callable-api §5.4 kind set (8 normal + bootstrap-only) is the same nine.

## The 0059 numbering collision — classification and minimal amendment

**Verified facts.** `0059_action_log.sql` is a real, committed, unrelated planner migration (G4 Slice 3 action-log table with FK to `configurations`, one unique ordinal, one index; no Foundry/epoch/V1 relation touched). Journal: 60 committed entries; idx 56 = `0058_foundry_derivative_activation_disabled`, idx 57 = `0059_action_log`, idx 58/59 = 0060/0061. Migrations 0053-0058 remain byte-exact. Journal entries 0-56 are prefix-identical to the pre-0059 committed state.

**Classification.**
- *(a) For the joint freeze:* **does not block.** None of the nine artifacts is, creates, or renumbers 0059; each references it only in prohibitions, and every prohibition remains true — indeed accidentally strengthened, since ordinal 0059 can now never be the enable migration.
- *(b) For future enablement:* **P2 contract-referent defect, failing closed.** The parent's "0059, and only 0059, may enable" now designates an occupied, non-enable migration; taken literally, enablement is impossible rather than dangerous. Because the parent is frozen pending exactly this audit, the defect is recorded for the already-mandated amendment, not edited now.

**Minimal amendment path (recommended, not performed).** At the next parent amendment — the one the callable-api gates on this joint audit — re-key the enable-migration designation from a fixed ordinal to content identity: "the single enable migration, at whatever journal index is next unoccupied at enable time, identified by its exact content SHA-256 bound into the enabled-epoch JSON; it must contain only the generation-2 `enabled_release` epoch append; it must not modify 0053-0058; and the epoch evidence must additionally bind the exact SHA-256 of every intervening migration (0059 through N-1) together with catalog proof that none touches any V1 relation, base control table, role, or `fdv1_*` routine." Update §2 stage 5, the §15 stage row, and the §16 heading in the same amendment. **Renumbering `0059_action_log` is inadmissible:** it is committed history with committed successors (0060, 0061); rewriting would violate the journal's append-only custody and the planner workstream's own byte pins, and would repeat the exact class of collision this amendment removes. The intervening-migration hash-binding is the substantive new obligation; ordinal re-keying without it would silently widen the trust base.

## Catalog P3 carry-over

The mandatory `pg_policy` + `pg_attribute` expansion from the first independent audit appears in every required place:

- Callable-api §9 lists both catalogs, and §10 test 15 demands "exact source-manifest/catalog enumeration including `pg_policy` and `pg_attribute` on PostgreSQL 16.14, plus full 0000-0058 replay." §9 also mandates source-side `octet_length(source_name) <= 63` checks — "Checking only the already-truncated catalog name is insufficient" — the precise refinement the P3 required.
- Privilege manifest §9 lists `pg_attribute`, `pg_attrdef`, and `pg_policy` among the compared catalogs.
- Catalog format §6 requires the complete `columns` array "ordered by expected `attnum`" per table; §14 names `pg_attribute` and `pg_policy` as primary truth.
- **Vacuous case handled explicitly:** 0058 creates zero policies and zero RLS tables. Catalog format §9: "Every table has an explicit policy array, including an empty array where no policy exists," and §6 requires per-table RLS/force-RLS bits — so an absent policy is an asserted absence, not an unchecked omission.

The carry-over is closed at design level; the expanded instance and semantic verifier remain absent by each artifact's own declaration.

## Boundary compliance

No artifact weakens any standing boundary. Verified specifically: (1) generation-1 disabled sentinel preserved — manifest §1.5 "generation 1 remains the latest disabled epoch," callable-api's install-under-disabled rule, and §5.4's restriction that while disabled, normal admission permits only `admin_action` and `predecessor_source`; (2) 0059 prohibition present in every document that could touch it; (3) direct-DML denial strengthened, never weakened — callable-api §8 zero-DML matrix over V1 tables, the nine 0053 control tables, and the section-12 surface; manifest §7 "zero direct `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege"; (4) no-execution/no-provider/no-signing — each opening block, the byte-vectors' `privateKeyMaterial: not_included`, and the gateway proposal's full `not_performed` matrix with its prohibition on any `valid/verified/trusted/authorized/admitted/redeemable/executionEligible` boolean.

## Verdicts

1. **Joint freeze of the nine artifacts: GO, conditional.** Content, cross-consistency, schemas, vectors, and boundaries pass with no P0 and no content-level P1. The freeze may be *recorded* only once P1-1 is closed: one byte-preserving commit establishing custody for the eight untracked artifacts, the parent, the adjacent vector/proposal files, and the identity record (including the superseding journal and `.gitattributes` identities per P3-2/P3-4), followed by post-commit hash re-verification against this table. Until that commit exists, the set is audited but not durably frozen.
2. **Proceeding to the SQL repair of containment/custody per the frozen designs: GO — design authorship only, after condition 1.** Authoring the non-executed repaired-SQL/privilege delta, the expanded `expectedCatalog` instance, and the semantic verifier strictly per these frozen hashes is the admissible next step. NO-GO for editing frozen 0058, applying any migration, broadening any grant in place (manifest §8: a replay discovering a needed privilege "fails the manifest"), or treating authored SQL as accepted before its own independent frozen-hash audit.
3. **Spec-complete 0058: NO-GO — confirmed.** The audited artifacts are designs, not repairs. The known 0058 defects stand: `fdv1_assert_recovery_boundary` retains PUBLIC EXECUTE as SECURITY DEFINER; R25-R30, `fdv1_action_sequence_v1`, the callable surface, and the eight-plane role model are absent; containment is not source-scoped; custody reuses the dispatch horizon; `USING heap` is unpinned in DDL. The artifacts themselves say so (manifest §9; catalog format §15; callable-api §5.4/§5.7).
4. **0059 / enabled epoch: NO-GO — confirmed, and now additionally impossible as written.** The prohibition holds in every artifact; the ordinal collision makes the parent's enable clause unsatisfiable until the P2-1 amendment lands; no evidence of any enabled epoch exists anywhere in the audited state.
5. **Gateway-token proposal standing: adjacent, `proposed_not_frozen`, correctly labeled, not one of the nine, and not frozen by this audit.** Its four files match their recorded hashes; its schemas/vectors are internally consistent; its 300-second cap deliberately mirrors the frozen `maximumReceiptLagSeconds` bound (1-300). Promotion remains gated on the owner decisions its §7 lists and on the frozen contracts being amended to adopt or reference the final companion. Nothing in the joint freeze may be read as that adoption.

## Boundary

This review is an unsigned, authority-none, non-author machine record produced read-only; no file was edited and no repository state was changed. It authorizes no commit (the P1-1 condition names a required action for the freeze declaration; performing it requires its own authorized session), no amendment of the parent contract or any frozen artifact, no edit to migration 0058, no creation of any migration at any index, no enablement of any epoch, and no execution, provider contact, credential use, object-store mutation, signing, spend, registration, release, publication, promotion, runtime use, measured-geometry, or production-database action. It is not evidence that any application store, workload identity, IAM policy, storage profile, broker, custodian, verifier, runner, or live service exists. Migration 0059 — under that ordinal or any successor designation — remains prohibited. Generation 1 remains disabled.
