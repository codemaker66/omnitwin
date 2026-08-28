# Grand Hall T-554 deterministic native-review replay v2

Status: authority-none replay/compiled candidate implemented; browser and production release blocked
Date: 2026-08-27
Authority: none

## Decision

Do not resume or silently upgrade v1 native-review session roots. The v1 core is
useful as tested custody and interaction groundwork, but it does not persist
successful tile delivery, type its domain events, or own a total-order session
coordinator. Existing v1 roots are therefore
`legacy_v1_unreplayable`, inspection-only evidence.

V2 reuses the strict low-level append-only file engine and adds a typed domain
protocol, pure reducers, one coordinator ledger, declared child ledgers,
transactional intents, exact root inventory, and exclusive resume ownership.
No production session factory or browser launch may exist until a strict replay
of concrete bytes reconstructs every security-relevant state transition.

## Typed evidence

Every v2 journal event is one strict discriminated schema. An outer event hash
chain is necessary but is not sufficient: replay also rejects an unknown event
type, unknown key, wrong payload version, impossible transition, stale compare-
and-swap revision, generation reuse, child swap, or inconsistent derived fact,
even if an attacker self-consistently rehashes the files.

One coordinator ledger owns:

- session creation, browser epochs, lifecycle, and exclusive live ownership;
- globally increasing render generation and workspace revision;
- source-selection intent, child allocation, commit, recovery-abort, and
  abandon;
- mask workflow, edit, freeze intent, child allocation, commit, recovery-abort,
  and invalidation;
- exact implementation, registry, source, mask, child-head, and root-inventory
  bindings;
- terminal stop.

Source and mask child ledgers contain only their typed review-start, first
successful tile-delivery, and coverage-observation events. Every child is
declared by the coordinator before creation and referenced by a later commit or
recovery-abort. An orphan, undeclared, missing, extra, aliased, or mismatched
child blocks replay.

## Successful delivery and coverage

The browser cannot assert delivery. The trusted HTTP adapter waits for response
`finish`, then derives and durably appends one first-delivery event for the
exact subject, render generation, row, column, and tile index. Only after the
append flushes may the in-memory delivery cache advance. Abort or uncertain
send creates no event and receives no credit. Duplicate successful sends are
idempotent after the first durable delivery.

Coverage observations persist only raw browser display telemetry plus server-
owned bindings and witnesses. Painted tiles are normalized to one exact
512-bit bitmap. Replay recomputes viewport geometry, scale, delivered/visible/
credited bitmaps, heartbeat gap, disqualifier, credited duration, the complete
512-cell capped dwell vector, its digest, completion bitmap, and count.

Each live process/browser epoch has a fresh segment identity and monotonic
position. The first observation in every segment is forced to zero credit.
Resume never credits time across a crash. It mints fresh browser and source
epochs, reopens and re-verifies the exact source, resets delivery and continuity,
and carries prior partial dwell only when the stable source-review subject,
registry, implementation, raw/decoded source, decoder, descriptor witness, and
rendering policy remain exact.

The carry state contains the canonical 1,024-byte little-endian Uint16 dwell
vector for all 512 tiles, its SHA-256, and completion witnesses. A bitset alone
cannot preserve partial dwell and is not a valid replay seed.

## Masks and freeze transactions

Mask replay starts entirely excluded and reapplies every typed integer edit.
Each edit binds expected/resulting revision, primitive and reason, prior/result
state digest, included/excluded counts, and reason histogram. Replay derives
those facts independently.

Freeze is an intent transaction:

1. derive exact canonical binary-mask and reason-map bytes and binding;
2. append and flush `mask.freeze-intended.v2`;
3. publish-or-verify each no-replace content-addressed file;
4. reopen and fully decode both files;
5. create the declared mask-review child;
6. append and flush `mask.freeze-committed.v2`;
7. update the in-memory pointer and acknowledge.

Recovery regenerates intended bytes from replayed edits. Exact pre-existing
files may be adopted; mismatched or unexplained files block. A partial exact
pair is classified by a recovery-abort event and cannot become frozen evidence.
A later edit durably invalidates the frozen binding and its coverage without
deleting historical bytes.

Mask-child publication uses one deterministic, operation-bound sibling stage.
Crash recovery accepts only enumerated writer states: an exact creation prefix
(including the empty reserved directory and strict-prefix file writes) may be
removed node by node and recreated until the staged journal commits revision
one. A committed revision-one stage rolls forward by repairing its descriptor;
it is never discarded. An exact cleanup suffix may be finished only after the
published revision-one child and descriptor have both been reverified, and the
published pair is reopened again after cleanup before success is returned.
Cleanup suffixes must follow the writer's actual unlink/rmdir order and preserve
the expected hard-link transitions. Unknown nodes, changed bytes, external
links, a different operation binding, or an impossible prefix or suffix block
recovery; no recursive or replacement cleanup is permitted.

This local review workspace is a trusted, private, same-user operator boundary,
not a hostile-user filesystem sandbox. The run must have exclusive ownership
of its private parent and forbids concurrent or untrusted filesystem writers.
Pinned identities, exact no-replace writes, before/after checks, and the final
published-pair reopen detect drift within that boundary; they do not claim to
provide descriptor-relative `openat`/`unlinkat` isolation against a malicious
same-account process racing individual operating-system path syscalls.

## Root ownership and recovery

The v2 session store owns a fixed root layout containing a preserved verified
implementation manifest, coordinator journal, and coordinator-declared child
journals. Creation and resume use exclusive ownership so two processes cannot
both become live. Every mutation verifies current browser-epoch ownership;
stale controllers fail closed.

Replay returns a state only after the exact recursive inventory, all journal
chains, all typed reducers, all child references, all published evidence, and
all bindings pass. It may classify a recognized intent as recoverable. It never
returns a partially trusted state for missing, extra, corrupt, ambiguous, or
impossible evidence.

## Implementation provenance

V2 production execution must use an isolated compiled Node ESM implementation
pack, not `tsx` source-tree execution or mixed source/dist workspace resolution.
A minimal fixed bootstrap verifies a canonical manifest and the exact compiled
server bundle, trusted HTTP adapter, static assets, Sharp/native addon, and
libvips dependency closure before importing the entrypoint.

The public verifier accepts no manifest path or caller-provided anchor. Test
fixtures are reachable only through an explicit test-only seam. Verification
must precede nonce generation or writable-root reservation. It stable-reads
every direct regular member, rejects missing/extra/case-colliding/unsafe paths,
links, hard links, reparse aliases, special files, and races, and returns the
manifest semantic SHA-256 plus exact file SHA-256 and length. The exact verified
manifest bytes are then preserved in the new session root.

An implementation upgrade may inspect old evidence but may not resume it.

The current checkpoint implements this boundary only as a caller-anchored,
authority-none candidate. Its path-remapped native inspector, exact
Sharp/libvips closure, decoder probe, fresh-child runtime attestation, and
post-import pack re-verification can diagnose the reviewed bytes, but no
module-private production pack or loaded-runtime authority is configured.
The compiled core exports no listener, browser launcher, acceptance path,
reconstruction path, or production factory.

The required implementation order and network/browser invariants for the
later private operator surface are specified separately in
`grand-hall-t554-native-review-loopback-v2.md`. That surface remains blocked
until exact mask tile delivery, durable mask-review coverage/resume, and a
unified process-owned v2 facade exist.

## Authority boundary

All v2 state remains `authority: none`, `reviewState: human_pending`, and
`finalDecision: PENDING`. Acceptance, reconstruction, runtime, export,
publication, and generated-content permissions remain false. V2 adds no API for
any of those actions and accepts no browser-supplied path, digest, count,
completion bitmap, timestamp, dwell duration, frozen-state claim, or authority
claim.
