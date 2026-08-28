# T-554 native-review core audit

Date: 2026-08-27
Scope: local authority-none preparation for the exact 148-source Grand Hall v3 review set
Decision state: all 148 human decisions remain `UNSURE`

## Boundary

This slice implements and tests the privileged server-side core required to
display exact supplied panorama pixels and collect later human review evidence.
It does not accept a panorama, pixel, room boundary, cleanup class, interface,
selection volume, transform, reconstruction, or runtime package. It has no
production factory, upload path, deployment path, external model call,
generated-content path, or accepted-artifact serializer.

The concrete v3 inputs remain anchored to:

- review-pack semantic SHA-256
  `sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530`;
- review-pack file SHA-256
  `sha256:9c7b18186c1065a5216eff64e9c27343d81105f1f4adbfd705ee4612782281dd`
  and 130,706 bytes;
- publication-receipt semantic SHA-256
  `sha256:67800d907aebb1643ea8ee2dda580d76ca5849b400a46e52aef127339ee42b17`;
- publication-receipt file SHA-256
  `sha256:fa03a33401b6589e3e2d6fa2d1e393cdbf0573776de5666f0c0c422d0763dfe5`
  and 3,590 bytes.

## Implemented core

- A production-anchored, deeply frozen registry loads only the exact pending v3
  pack and exposes source media inputs without browser-controlled paths.
- A same-descriptor media epoch bounds, hashes, fully decodes, and restats each
  exact JPEG before serving copied 256×256 RGB8 tiles. It performs no smoothing,
  resampling, wraparound, fill, or generation and destroys retained bytes on
  finalize, abandon, or failure.
- A server-derived coverage controller requires focused, visible, native-device
  scale display; credits at most a 500 ms heartbeat interval; requires 750 ms
  dwell per exact tile; rejects long gaps; and caps telemetry.
- Scope-bound append-only journals use canonical strict JSON, `wx`, descriptor
  flush, directory durability, a digest chain, compare-and-swap revisions,
  bounded count/bytes, exact replay, and quarantine on ambiguous append.
- A fail-closed mask store begins entirely excluded, accepts bounded integer
  primitives, rejects no-op revision consumption, and publishes paired
  canonical grayscale8 mask and reason-map PNGs. The reason map preserves the
  exact exclusion category for every excluded pixel. Reuse reopens, hashes,
  fully decodes, and cross-validates both immutable files.
- Publication durability is explicit in every v2 frozen binding. POSIX-like
  filesystems use directory `fsync`; Windows uses exact-file reopen, verified
  post-publication file flush, and stable directory/path witnesses because Node
  returns `EPERM` for directory `fsync` on this host.
- The serialized session controller uses one mutation lane and workspace CAS,
  journals complete source/decode custody before acknowledgement, confirms tile
  delivery only after a trusted adapter reports a successful send, invalidates
  mask review after edits, poisons ambiguous sessions, and attempts every buffer
  and resource cleanup even when one cleanup fails.
- Fixed local HTML/CSS/JavaScript assets and loopback HTTP security primitives
  exist. They contain no external request, storage, service-worker, acceptance,
  reconstruction, export, or generated-content surface.

## Verification

The integrated native-review core passed 9 test files and 105 tests. The full
Reconstruction Foundry suite passed 53 files and 746 tests. Package TypeScript
typecheck, ESLint, build, and `git diff --check` passed.

An exact-source smoke test used inventory index 0, `sweep_001jpg.jpg`, from the
supplied 148-file panorama directory and proved:

- source SHA-256
  `sha256:0543e2ce83bbbb5b8c4a8c689a49391092cc6d856124f8ac095d33b09c1db814`;
- decoded RGB8 pixel SHA-256
  `sha256:1f09de661c6c9d8a2027e71282569aadf2e1102f9007365b15d7c62b6bd0c936`;
- decoder `sharp 0.35.3`, `libvips 8.18.3`, unrotated RGB8 pipeline v1;
- first exact 256×256×3 tile: 196,608 bytes, SHA-256
  `sha256:78e1e66bf10a965996cb26a070eee6f90c40e61098822b616f7b910060a20688`;
- terminal disposition `finalized_stable`.

Independent adversarial reviews found and the implementation remediated session
poisoning, teardown, post-send custody, source-evidence completeness, mask
reason provenance, cached-evidence drift, cross-plane TOCTOU, root namespace,
buffer destruction, clock-gap, no-op revision, event-bound, secret-lifetime,
and fixed-header issues. A low availability-only edge remains: interruption
between the deterministic publication of the mask and reason-map files can
leave a partial pair that requires a fresh publication workspace. It cannot be
acknowledged as frozen evidence.

## Intentionally closed release gates

The browser workbench must not be started yet. The controller truthfully reports
both of these release blockers:

1. deterministic typed crash replay/import, including durable server-owned tile
   delivery history and cross-journal source/mask reconstruction;
2. a compiled, isolated implementation pack whose exact executable dependency
   closure is verified from concrete bytes before a production session factory
   can exist.

After those gates pass, a trusted loopback HTTP adapter/server/CLI must still
commit tile delivery only on response `finish`, discard on abort/failure, and
pass its own Host, Origin, bearer, body, rate, timeout, and browser isolation
tests. Only then may an authorized human begin the native-grid review. Pending
review remains separate from later acceptance, reconstruction, staging, or
runtime admission.

No branch was pushed, no provider was configured, no data was uploaded, no
deployment was made, and no generated architectural content was used.

## Post-audit continuation: decision and attestation evidence

Date: 2026-08-28

Subsequent v2 slices delivered the deterministic crash replay and compiled-pack
verification gates described above. This continuation adds the next local,
authority-none evidence boundary; it does not revise the 2026-08-27 audit's
historical claims about the code at that earlier checkpoint.

The coordinator journal now accepts two strict events:

- `source.decision-recorded.v2`, limited to `INCLUDE` or `EXCLUDE` and bound to
  the exact session, registry, implementation, source custody, workspace CAS,
  next global render-generation barrier, canonical timestamp, and a
  domain-separated self-digest;
- `source.human-attestation-recorded.v2`, bound to that exact decision and
  source, with a fixed statement, canonical timestamp, domain-separated
  self-digest, `humanPresenceProof: not_cryptographic`,
  `agentDecisionAuthority: none`, and `authority: none`.

An `EXCLUDE` decision requires a fully completed exact native-source child
prefix. An `INCLUDE` decision additionally requires a fully completed exact
native-mask child prefix bound to the current immutable frozen mask. The session
store derives those historical durable prefixes, strictly replays their actual
events, verifies full 512-tile coverage and cumulative dwell state, and compares
the resulting proof to the coordinator claim. Therefore a literal full bitmap,
count, or self-consistent digest cannot substitute for the underlying durable
review history. Decision and attestation records remain in immutable replay
history after permitted source abandonment; no seal or accepted artifact is
implied.

The durable journal now also requires each decision/attestation record time to
be at or after the event's declared time, both on append and reopen. A declared
reviewer identifier remains an assertion only: this slice contains no browser
controller, authenticated reviewer boundary, cryptographic human-presence
proof, signature, accepted-chain seal, or production factory.

Focused verification passed 4 files and 76 tests, including real 516-record
source and mask child prefixes, incomplete-prefix attacks, impossible state
transitions, stale barriers, digest drift, future-time append rejection, and a
low-level future-time injection rejected on reopen. Strict TypeScript,
affected-file ESLint, the package build, and `git diff --check` also passed.

No real decision or attestation was recorded. All 148 panorama decisions remain
pending, T-554 remains blocked, and no branch push, provider operation,
credential use, upload, generation, staging, deployment, publication, or
production change occurred.

Two continuation obligations remain explicit:

- before any accepted-chain or sealing layer exists, it must either reject
  multiple decisions for the same source subject or require an explicit,
  digest-bound supersession relation; the current authority-none history may
  retain repeated reviews after abandonment but cannot choose between them;
- add full disk-reopen composition cases for both INCLUDE and EXCLUDE paths,
  joining a coordinator journal, real complete source/mask children, decision,
  authority-none attestation, abandonment, and the final machine-verification
  digest. The individual layers and real child-prefix proofs are covered now;
  this end-to-end composition remains a later hardening gate.

## Post-audit continuation: composition and repeated-decision hardening

Date: 2026-08-28

The two continuation obligations immediately above are now closed at the
authority-none boundary.

Coordinator replay permits a previously decided source to be reselected and
inspected again, while preserving the original decision and attestation in
history. It permits a genuinely distinct source with a fresh recorded JPEG
digest and review subject to receive its own decision, while rejecting a second
decision before any mutation when the exact source identity, recorded source
JPEG SHA-256, or source-review subject matches an earlier decision. A
schema-valid inventory/filename relabel retaining the same claimed JPEG digest
therefore cannot bypass the guard. Concrete byte truth remains the
responsibility of the pinned registry, descriptor, and decoder boundary; the
coordinator replay does not reopen the JPEG. This prevents a later `INCLUDE` or
`EXCLUDE` from silently competing with the first record. There is still no
accepted/current winner, seal, or supersession event; a future correction
requires a separately designed, digest-bound supersession relation.

Two full session-store composition regressions now cover the complete closed
paths:

- complete 516-record source child -> `EXCLUDE` -> authority-none human
  attestation -> abandonment without a mask -> session stop;
- complete 516-record source child -> exact mask workflow -> real frozen binary
  mask and reason-map publication -> complete 516-record mask child ->
  `INCLUDE` -> authority-none human attestation -> abandonment with both child
  heads -> session stop.

Each session is released and opened twice under separately acquired owner
leases. Both opens recursively inventory the root, reopen and semantically
replay every exact durable child record, verify the decision-bound coverage and
mask evidence, and produce identical root-inventory and semantic
verification-attestation digests. The test-only canonical bulk writer is used
to avoid quadratic setup cost for the 515 post-start coverage events; it does
not bypass either public session-store verification pass and no public writer,
session factory, browser controller, or acceptance export was introduced.

Focused verification passed the session-store file at 20/20 tests and the
coordinator-replay file at 27/27 tests. Strict TypeScript, affected-file ESLint,
the package build, and `git diff --check` also passed.

No real human decision or attestation was recorded. All 148 panorama decisions
remain pending, T-554 remains blocked, and no browser, provider, credential,
upload, generation, staging, deployment, publication, or production action
occurred.
