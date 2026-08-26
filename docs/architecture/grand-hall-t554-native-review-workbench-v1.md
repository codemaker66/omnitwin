# Grand Hall T-554 privileged native-review workbench v1

Status: active implementation constraint
Date: 2026-08-26
Authority: none
Scope: local procedural evidence for the exact 148-source Grand Hall review set

## Purpose

The T-554 native-review workbench exists to let an authorized venue reviewer
inspect the exact supplied 8192×4096 panorama bytes and record source-bound
Grand Hall-only decisions without trusting the browser to claim that an image,
pixel region, mask, or review step was verified. It is a private operator tool,
not a customer or production application.

The workbench can produce only `human_pending`, authority-none evidence. It has
no acceptance endpoint, acceptance button, accepted-artifact serializer,
reconstruction command, runtime admission path, upload path, external model
call, or generated-content path.

## Trust boundary

Keep the implementation inside `tools/reconstruction-foundry`. Do not place it
in `packages/api` or `packages/web`. It binds only to `127.0.0.1` and inherits
the hardened local-session HTTP policy rather than production proxy, auth,
telemetry, or deployment concerns.

The browser is an untrusted display and input device. The server owns:

- the fixed v3 source registry and every filesystem path;
- open descriptors, stable-read snapshots, source bytes, decoded pixels, and
  decoder identity;
- source epochs, render generations, session nonces, server time, monotonic
  elapsed time, and append-only journal sequence;
- visible-cell derivation, dwell accumulation, completion bitmaps, and counts;
- mask state, deterministic edit application, frozen PNG bytes, decoded mask
  facts, hashes, and pixel counts;
- lifecycle state, content-addressed publication, inventories, receipts, and
  zero-write verification.

Browser requests may never contain filesystem paths, source hashes, mask
hashes, pixel counts, coverage bitmaps, completion claims, verified-dimension
claims, server timestamps, dwell durations, frozen-state claims, or authority
booleans.

## Source custody and display

For one inventory index selected from the fixed 148-row v3 registry:

1. Resolve the source filename and expected identity from the verified registry.
2. Reject traversal, alternate data streams, UNC input, unsafe names, links,
   reparse aliases, hard links, case collisions, non-regular files, oversize
   files, and unstable root/path state.
3. Open one server-owned read-only descriptor.
4. Stat, bounded-read exactly, trailing-byte probe, SHA-256, and fully decode
   the same captured buffer.
5. Derive RGB8 dimensions, channel count, decoded-pixel SHA-256, decoder
   identity, and a descriptor witness; restat the descriptor and path.
6. Create a random source epoch bound to the v3 pack semantic/file identity,
   its publication receipt, the exact source row, raw and decoded hashes, the
   decoder, and the workbench implementation manifest.
7. Serve only opaque 256×256 RGB8 tiles from the immutable decoded buffer. The
   exact source grid is 32×16 = 512 tiles.
8. Render without smoothing, wraparound, interpolation, generated fill, or a
   composited substitute.
9. Keep the descriptor epoch alive until the source review is sealed or
   explicitly abandoned, then discard all buffers.

No request may cause a later path reopen to supply displayed pixels for an
already active source epoch.

## Server-derived coverage journal

The browser may submit only a session nonce, random source epoch, server-issued
render generation, gap-free sequence, raw CSS viewport dimensions, raw
source-to-CSS transform matrix, device-pixel ratio, browser visibility/focus
state, and painted tile-generation acknowledgements.

The server derives effective device pixels per source pixel and the set of
fully visible, delivered, currently painted cells. A cell receives dwell only
when it remains fully visible across consecutive eligible samples, the page is
visible and focused, scale is at least one device pixel per source pixel, the
source epoch and render generation are current, and the heartbeat gap is within
the configured clamp. The v1 policy requires at least 750 ms cumulative
eligible dwell per cell and credits at most 500 ms per heartbeat gap.

Use a monotonic server clock for elapsed duration and UTC only for event
timestamps. Wall-clock or monotonic rollback, sequence gaps, stale epochs,
stale tile generations, subject changes, partial cells, hidden/blurred state,
sub-native scale, unpainted tiles, and unsupported transforms fail closed.

Persist each event immediately as a single immutable file created with `wx`,
flushed before acknowledgement, and linked to the previous event digest. State
is rebuilt by strict replay; in-memory summaries are caches only. A missing,
extra, corrupt, truncated, duplicated, reordered, or chain-broken event makes
the review incomplete.

Browser focus and visibility remain procedural telemetry, not cryptographic
human-presence proof.

## Fail-closed mask editing

- Initialize every source-aligned 8192×4096 mask on the server to 255, meaning
  excluded or unknown.
- Accept only bounded integer edit primitives. The browser never supplies mask
  bytes, counts, hashes, or a frozen flag.
- Apply edits deterministically without interpolation and with explicit
  panorama-seam handling.
- Freeze to a canonical grayscale8 PNG containing only 0 and 255.
- Reopen and fully decode the exact emitted PNG with the strict media kernel;
  derive every format fact, hash, length, included count, excluded count, and
  reason/count consistency from bytes.
- Review the frozen mask in a separate source-aligned native-grid coverage
  phase bound to source and mask raw/decoded hashes, render configuration,
  source epoch, and session nonce.
- Any later edit creates a new immutable mask revision and invalidates previous
  mask coverage, attestation, and receipt.

Unique source-to-mask paths are required. Identical mask byte digests across
different sources are valid—for example, two independently reviewed all-include
masks can legitimately be byte-identical.

## Per-source evidence

Each canonical source receipt must bind actual derived evidence, including:

- v3 review-pack and publication-receipt semantic/file SHA-256 and byte length;
- exact source inventory and observation rows;
- workbench implementation manifest;
- descriptor/source/decode witness;
- append-only source coverage ledger semantic/file SHA-256 and byte length;
- decision and server-ordered human attestation;
- for `INCLUDE`, exact frozen mask bytes, derived counts and reasons, plus the
  independent mask-review coverage ledger;
- authority `none` and acceptance, reconstruction, runtime, generated-content,
  and publication authorizations all `false`;
- both semantic receipt digest and exact serialized-file SHA-256/length.

Attestation must follow the final applicable source/mask interval; sealing must
follow attestation. All instants use canonical UTC millisecond form.

## Separate pending export and verifier

Export is a separate CLI/process from the interactive workbench. It copies the
exact v3 inputs and all concrete receipts, ledgers, implementation manifests,
and content-addressed masks into a new no-replace directory. The terminal
receipt lists the exact sorted recursive payload inventory, raw SHA-256 and
length of every member, total count/bytes, all v3 bindings, and all 148 source
bindings. It is written and flushed last. Its own exact file SHA-256 is computed
externally because a file cannot recursively contain its own raw digest.

The checker rejects every missing or extra path, alias, link, hard link,
reparse point, unsafe/case-colliding name, noncanonical JSON byte encoding,
duplicate key, unreferenced member, swapped source, wrong pack, wrong
implementation, false mask count, ledger chain failure, receipt-not-last
publication, or check-mode write. It parses and replays the actual bytes rather
than trusting digest strings copied into an index.

Even when all 148 source rows are resolved, the export remains:

```text
authority: none
reviewState: human_pending
finalDecision: PENDING
reviewer: null
nativeResolutionHumanReviewCompleted: false
nativeReviewEvidenceSetSha256: null
```

The workbench and pending exporter must never call the accepted T-554 chain.
A later, separate authenticated acceptance verifier must consume the byte-sealed
directory together with the remaining room, interface, cleanup, closed-volume,
and registration evidence.

## HTTP boundary

The local server must enforce:

- loopback socket plus `127.0.0.1`-only bind;
- exact `Host` and exact `Origin` on every mutation, with no CORS;
- one-time URL-fragment bootstrap exchanged for a memory-only bearer, followed
  by immediate fragment removal;
- strict UTF-8 JSON with duplicate/prototype-key rejection and exact Zod keys;
- bounded bodies, headers, request timeouts, rate limits, and concurrency;
- one serialized writer with compare-and-swap workspace revision;
- CSP `default-src 'none'`, no framing, no service worker, no storage token,
  same-origin COOP/CORP, and `Cache-Control: no-store`;
- a fixed session TTL and explicit buffer/token destruction on stop.

## Required release tests

Release gates include source path and descriptor races; raw-tile sentinel
equality; injected truth fields; one-heartbeat/full-grid claims; replay,
reorder, clock rollback, focus/visibility, scale 0.999, partial-cell, stale
epoch/generation, and exact 512-cell completion; fail-closed masks, seam edits,
format attacks, count derivation, edit invalidation, and legitimate identical
masks; journal crash/corruption/two-tab/CAS/finalize races; Host/Origin/token,
CSRF, clickjacking, caching, slow-body and flood tests; fabricated, missing,
extra, swapped, noncanonical, aliased, and crash-injected export members; and a
browser test proving no external request or arbitrary path surface exists.

Passing these gates establishes procedural evidence only. It does not
authenticate a human, accept Grand Hall membership, authorize reconstruction,
or prove architectural truth.
