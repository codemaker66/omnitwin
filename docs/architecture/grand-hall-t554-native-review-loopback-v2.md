# Grand Hall T-554 private loopback workbench v2

Status: active implementation constraint; launch remains blocked
Date: 2026-08-28
Authority: none

## Purpose and ordering

The v2 loopback workbench is the private operator surface for reviewing the
exact supplied 8192 x 4096 panorama pixels and their server-derived Grand Hall
masks. It is not a customer application, an acceptance surface, a
reconstruction tool, or a staging runtime.

Implementation must proceed in this order:

1. retain one freshly verified source epoch through mask editing;
2. serve coupled source, mask, and exclusion-reason tiles from server-owned
   state, and record delivery only after the response finishes;
3. durably collect mask-review coverage and implement clean/crash resume with
   a fresh browser/source epoch and an exact carried dwell vector;
4. expose INCLUDE only after complete exact source and mask coverage;
5. place one process-owned operator facade over the source and mask
   controllers;
6. place an injected, unlaunchable HTTP router over that facade;
7. compile the facade, router, adapter, and fixed assets into a newly reviewed
   implementation pack;
8. only then add an explicit local listener and optional browser launch.

The listener, CLI, browser launch, freeze button, and INCLUDE path remain
blocked while any earlier prerequisite is incomplete. In particular, a freeze
endpoint must not strand a session in `mask_review` before durable mask-review
resume exists.

## Evidence display

The privileged evidence surface uses Canvas2D, not WebGL. Canvas pixels are
painted at exact integer offsets with smoothing disabled. WebGL/Spark testing
belongs to later reconstructed-runtime QA and must not be imported into this
workbench.

Source pixels come only from the active descriptor-bound decoded source epoch.
Mask and exclusion-reason pixels come only from the replayed server-owned mask
revision. The browser cannot submit or select any source, mask, reason-map, or
filesystem bytes. A mask-review tile response is one fixed binary record whose
planes are bound to one delivery lifecycle; the server must not credit a
source plane, mask plane, or reason plane independently.

The visible render generation may advance after a mask edit or freeze while
the retained source epoch keeps its own earlier source render generation. The
server uses the epoch's own generation when copying source pixels and the
current visible generation when authorizing the browser request. Conflating
those generations is an error.

## Process-owned facade

One operator facade owns exactly one exclusive session controller at a time.
It serializes every action and owns transitions among source review, mask edit,
and mask review. A transition must resolve or fail closed on every pending tile
response before closing one controller and opening another. HTTP code may not
independently acquire source and mask controllers.

The facade projects one deep-frozen browser state. That state contains only
the bounded values needed to render and submit compare-and-swap operations. It
omits filesystem paths, child names, implementation-pack internals, source or
mask digests, completion bitmaps, dwell vectors, browser-epoch hashes, and
source-review subjects.

Every projection is literal:

```text
authority: none
reviewState: human_pending
finalDecision: PENDING
acceptanceAuthorized: false
reconstructionAuthorized: false
runtimeAuthorized: false
exportAuthorized: false
generatedContentAuthorized: false
```

`UNSURE` is not a durable v2 decision. It means leave the source pending or
explicitly abandon the current review. INCLUDE and EXCLUDE remain evidence-
backed decisions; neither is acceptance.

## HTTP boundary

The eventual server reuses `local-session-http.ts` and must enforce all of the
following before routing:

- bind only exact IPv4 `127.0.0.1`, preferably on an ephemeral port;
- verify exact local and remote socket addresses plus the final bound address;
- require exactly one `Host: 127.0.0.1:<actual-port>` on every request;
- require exactly one exact same-origin `Origin` and same-origin Fetch Metadata
  on every API request, including bootstrap, state, and tile requests;
- emit no CORS headers and reject OPTIONS, TRACE, CONNECT, Upgrade, absolute-
  form targets, encoded aliases, double slashes, queries, and redirects;
- exchange one random URL-fragment bootstrap exactly once for one memory-only
  bearer, then remove the fragment before the exchange;
- never place credentials in cookies, storage APIs, queries, DOM attributes,
  logs, screenshots, environment files, or persisted session evidence;
- accept strict UTF-8 JSON with duplicate/prototype-key rejection, exact keys,
  bounded bodies/headers/time, rate and concurrency limits, and no transfer-
  encoding ambiguity;
- apply CSP `default-src 'none'`, same-origin connect/script/style/image only,
  no framing, workers, service workers, storage credentials, caching, or
  external requests.

The complete implementation pack and runtime identity, exact session replay,
and source custody must be verified before token generation or socket listen.
The current reviewed pack explicitly declares `httpLaunchIncluded: false` and
`productionFactoryIncluded: false`; source-tree or `tsx` execution is not a
substitute.

## Closed browser request vocabulary

Every API route is an exact POST route with strict request keys. The intended
v2 vocabulary is:

- `/api/v2/bootstrap`
- `/api/v2/state`
- `/api/v2/source/select`
- `/api/v2/source/tile`
- `/api/v2/source/coverage`
- `/api/v2/source/exclude`
- `/api/v2/source/leave-pending`
- `/api/v2/mask/begin`
- `/api/v2/mask/edit`
- `/api/v2/mask/tile`
- `/api/v2/mask/freeze`
- `/api/v2/mask-review/tile`
- `/api/v2/mask-review/coverage`
- `/api/v2/source/include`
- `/api/v2/source/attest`
- `/api/v2/source/abandon`
- `/api/v2/session/stop`

Individual routes remain absent until their underlying durable operation is
implemented. No route may accept a path, filename, URL, source/mask bytes,
digest, count, coverage bitmap, completion claim, timestamp, dwell duration,
frozen-state claim, authority claim, crash-takeover instruction, acceptance,
export, reconstruction, runtime-admission, upload, generation, or publication
request.

## Tile response custody

The trusted response adapter commits delivery exactly once and only after the
Node response emits `finish`. Request abort, response close/error, or any
uncertain send discards the prepared delivery and credits nothing. A durable
append failure after response finish terminally fails the operator process and
requires explicit recovery; it is never retried against the live browser.

Every prepared plane is hashed before send, checked again before commit, and
zeroed on commit, discard, close, or failure. Mutation of any coupled plane
invalidates the entire delivery. Phase changes cannot overtake an unresolved
delivery.

## Mask-review resume

Clean reopen and explicit crash takeover both mint a fresh browser epoch, a
fresh descriptor-bound source epoch, a fresh coverage segment, and a new mask
child. They carry only the exact capped Uint16 dwell vector and exact frozen
source/mask bindings from the verified predecessor child. The first sample in
the new segment receives zero credit. No time, delivery, focus, or visibility
claim crosses a process/browser boundary.

Crash takeover is a CLI-only operation requiring the branded prior-owner
witness. Browser input cannot request it. Impossible root inventory, child,
publication, or recovery state keeps the listener closed.

## Release tests

Before launch, tests must cover:

- exact bind/Host/Origin/Fetch-Metadata behavior and DNS-rebinding attempts;
- one-winner bootstrap exchange, bearer expiry/destruction, duplicate headers,
  CSRF, wrong schemes, and duplicated tabs;
- strict JSON, slow/oversize bodies, length/transfer ambiguity, header flood,
  rate and concurrency exhaustion;
- exact tile sentinel bytes, content type/length/no encoding, finish/abort/
  close/error races, mutation, zeroing, and phase-transition draining;
- hidden, blurred, sub-native, partial-cell, long-gap, stale-generation, and
  two-tab coverage rejection;
- replayed mask/reason overlays after every edit, edit/freeze invalidation,
  resume carry, and no INCLUDE before exact complete mask coverage;
- crash injection at every owner, coordinator, child, publication, response,
  and resume boundary;
- a closed route inventory and authority-none literals in every response;
- browser QA proving no external request, cookie, storage, worker, smoothing,
  frame embedding, arbitrary path surface, or cached sensitive response.

Passing these tests creates procedural authority-none review evidence only. It
does not prove human identity, accept any pixel or room boundary, authorize a
reconstruction, or permit staging or production use.
