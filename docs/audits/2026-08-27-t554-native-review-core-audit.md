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
