# Grand Hall T-554 fixed admission v2

Status: active implementation constraint; payload admission and launch remain blocked  
Date: 2026-08-29  
Authority: none  
Related: `docs/architecture/grand-hall-t554-native-review-loopback-v2.md`

## Purpose

This record defines the non-self-referential trust and admission model for the
successor Grand Hall T-554 compiled native-review workbench. It separates the
reviewed workbench payload from the code that fixes and enforces the payload's
reviewed identity.

The separation is mandatory. A payload member cannot contain the reviewed hash
of the manifest that hashes that same member. Doing so would change the member,
the manifest, and the reviewed hash recursively. No implementation may attempt
to solve that recursion by accepting a caller-selected root or anchor.

This model preserves all constraints in the private loopback workbench v2
record. In particular, a listener remains a later step. Admission creates only
an in-process, authority-none capability for the exact reviewed payload. It
does not listen, launch a browser, accept a source or pixel, or authorize any
downstream use.

## Immutable authority boundary

Every payload, capsule, runtime handle, workbench state, and response governed
by this record remains literal:

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

Admission is not acceptance. It does not establish room membership, pixel
membership, a mask, a transform, a reconstruction, runtime admission, export
eligibility, publication eligibility, staging eligibility, or production
trust.

The capsule's process-local implementation-runtime handle means only that the
exact reviewed decoder and payload are loaded in the attested process. It does
not change the downstream product fact `runtimeAuthorized: false` and grants
no reconstruction or staging runtime authority.

## Two-stage release model

### Stage 1: deterministic payload

Stage 1 builds one deterministic compiled payload outside the git workspace.
The payload contains the reviewed implementation needed for the unlaunchable
workbench:

- one tiny manifest-selected admission gate whose only runtime dependency is
  the exact fixed capsule URL;
- one separately selected heavy workbench core that the gate can import only
  after the capsule has verified, attested, and reverified the payload;
- the operator facade and its source and mask delegates;
- the injected HTTP router;
- the HTTP contract and response-delivery adapter;
- the exact fixed HTML, CSS, and browser JavaScript assets;
- strict replay, durable-store, source-custody, mask, and coverage code;
- the pinned decoder loader, native addon, libvips closure, runtime bootstrap,
  runtime inspector, and diagnostic probe;
- canonical module metadata and one canonical implementation manifest.

The payload MUST NOT contain:

- the fixed admission capsule;
- a fixed reviewed payload root or reviewed manifest anchor;
- a generic or production minter that can select a root;
- a runtime-attestor child that embeds the fixed-pack verifier;
- an HTTP listener, `createServer`, `listen`, browser launcher, redirect, or
  external request surface;
- a standalone or caller-selected production session factory;
- acceptance, reconstruction, export, generated-content, staging, upload, or
  publication authority.

The payload has one and only one permitted module target/specifier outside the
reviewed pack and Node builtins. Gate and core may each contain an import
occurrence targeting that same exact canonical fixed capsule URL:

```text
file:///C:/ProgramData/Venviewer/PrivateReleases/trades-hall-grand-hall-t554-workbench-v2/admission/fixed-admission-capsule.mjs
```

The literal is part of the reviewed payload bytes. It has no query, fragment,
alternate drive-letter case, alternate path case, percent-encoded alias,
authority component, or path traversal. Build metadata MUST prove that this is
the only out-of-pack import. Esbuild may keep exact relative imports to other
manifest-declared pack members such as the heavy core, HTTP adapter, and Sharp
loader external to an individual bundle; those are still hashed payload
members, not ambient runtime resolution. The build metafiles and emitted
literal imports MUST close over only that exact capsule URL, exact declared
relative pack members, and exact Node builtins.

The payload manifest MUST truthfully retain the following authority limits and
must distinguish the one fixed capsule dependency from forbidden ambient
module resolution:

```text
standaloneProductionFactoryIncluded: false
fixedAdmissionGatedFactoryIncluded: true
httpLaunchIncluded: false
tsxExecutionAuthorized: false
mixedSourceDistResolutionAuthorized: false
ambientExternalRuntimeModuleResolutionAuthorized: false
fixedAdmissionCapsuleExternalImportRequired: true
entryImportPolicy:
  fixed-admission-capsule-verifies-entire-pack-before-gate-import.v2
```

Stage 1 MUST build twice from the same reviewed source and dependency closure.
The two outputs must have identical canonical manifest bytes, member paths,
member hashes, member lengths, member-inventory digest, member count, and total
member bytes. The output remains an unreviewed candidate until the Stage 1 hash
approval gate is explicitly satisfied.

The payload uses a new v2 manifest schema and implementation identity. It does
not reinterpret the v1 manifest. The v2 inventory assigns distinct exact roles
to the admission gate and heavy core as well as the adapter, bootstrap, static
assets, decoder closure, and native runtime members.

### Stage 2: separately reviewed fixed capsule

Only after Stage 1 approval may Stage 2 compile the fixed admission capsule.
The capsule is not a payload member. It embeds module-private constants for:

- the exact canonical Windows release root;
- the exact payload root beneath that release root;
- the Stage 1 manifest semantic SHA-256;
- the Stage 1 manifest raw-file SHA-256 and byte length;
- the Stage 1 member-inventory SHA-256;
- the reviewed member count and total member bytes.

No production or operator caller can replace those constants. The capsule
accepts no payload root, manifest anchor, member digest, deployment root, or
runtime identity through a function argument, CLI argument, environment
variable, configuration file, browser request, session record, or IPC message.

The fixed release layout is:

```text
C:\ProgramData\Venviewer\PrivateReleases\
  trades-hall-grand-hall-t554-workbench-v2\
    admission\fixed-admission-capsule.mjs
    payload\...
    release-receipt.json
```

The volume root and every fixed-path ancestor, the release root, `admission`
directory, capsule file, payload root, release receipt, and every payload
directory and file MUST be direct canonical local filesystem objects. They
must not be symlinks, junctions, mount-point aliases, other reparse points,
hard-linked files, UNC paths, device paths, extended-path aliases, or mutable
`current` pointers. Installation is no-replace and receipt-last. Payload and
capsule bytes are protected after installation by the exact ACL policy;
mutable session workspaces live outside the release root. A Windows read-only
attribute is not treated as an access-control boundary.

The installer and release runbook MUST establish and record an explicit
Windows ACL: the designated execution identity receives read/execute only;
only the named installer administrators and `SYSTEM` receive modify/write/
delete/ownership/ACL-change rights; inheritance and every other principal are
audited and may not introduce write, delete, ownership, or ACL-change access
to the capsule, receipt, or payload. Runtime filesystem checks do not make a substituted capsule
self-authenticating. The external trust root is the separately reviewed
capsule hash plus the fixed installation procedure and Windows access control,
or a future approved code-signing root. An administrator or same-authority
principal able to replace both the capsule and payload is outside the
protection offered by payload-to-capsule hash binding alone.

The capsule itself MUST NOT embed its own file hash. Its exact file SHA-256 and
byte length are externally reviewed and recorded. This is the terminal
non-self-referential trust root for this local release.

The compiled capsule is one self-contained ESM file whose only runtime imports
are exact Node builtins. It does not resolve repository modules, packages,
payload modules, configuration, or helper files during its initial evaluation.
The payload gate is reached only by the private post-verification dynamic
import described below.

## ESM evaluation and same-instance authority

Node ESM modules are cached by resolved URL. The capsule therefore serves two
roles in one exact module instance:

1. it is the process main module and private admission orchestrator;
2. it supplies the two assertion functions and one inert frozen ABI witness
   imported by the payload through the exact fixed capsule URL.

The capsule MUST complete its ESM evaluation before importing the payload. Its
top-level evaluation performs only bounded synchronous definition and guard
work:

- assert that `import.meta.url` is byte-for-byte the fixed capsule URL;
- initialize the module-private `WeakSet` and `WeakMap` identity stores;
- define and export the exact narrow three-binding surface: the pack assertion,
  the pack-bound runtime assertion, and the inert frozen authority-none ABI
  witness used to prove that the gate and core resolved this same capsule
  module instance, named exactly
  `assertGrandHallT554NativeReviewFixedPackV2`,
  `assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2`, and
  `GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2`;
- determine whether this exact module instance is the process main module;
- when it is main, schedule the private main routine with `setImmediate` or an
  equivalently explicit post-evaluation turn.

The capsule MUST NOT use top-level `await import(payload)`. The payload has a
static import back to the capsule. Awaiting the payload while the capsule is
still evaluating would create an asynchronous evaluation cycle. Deferring the
private main ensures that the capsule has completed evaluation and entered the
ESM cache before the payload is imported.

The capsule's private main proceeds in this exact order:

1. enforce the fixed main-process, argument, preload, and path guards;
2. capture and verify the fixed release-root identity;
3. verify the canonical manifest and every exact payload member without
   importing any payload code;
4. mint a process-local verified-pack handle in the capsule-owned identity
   store;
5. load and attest the exact reviewed decoder/runtime bootstrap in this same
   process;
6. reverify the canonical manifest, complete inventory, every member byte, and
   release-root identity;
7. derive the gate URL only from the branded verified manifest, resolve it as
   an exact in-root member URL, and dynamically import only that gate;
8. verify the gate namespace's exact closed export vocabulary and
   authority-none policy;
9. invoke the gate's single one-shot core loader with the exact branded pack;
10. allow that gate, only after its own synchronous pack-identity assertion,
    to derive and dynamically import the exact heavy core bound by the branded
    manifest; no caller supplies either module string or URL;
11. reverify the complete pack again and attest that the loaded reviewed native
    module inventory and multiplicity remain exact after core evaluation;
12. only then mint a runtime-authority handle and bind it by `WeakMap` to the
    exact verified-pack handle;
13. verify that the core namespace contains only its one admitted factory plus
    exact policy/witness values—never raw source, mask, takeover, listener,
    alternate-factory, or injected-test exports—and invoke that factory, whose
    first operational action reasserts the exact pack/runtime pair before
    session, source, filesystem-write, token, or HTTP work.

When the payload imports the exact fixed capsule URL, Node must resolve it to
the already-loaded capsule module instance. Consequently, assertions inside
the separately bundled operator, source-session, and mask-workflow code access
the same module-private `WeakSet` and `WeakMap` identities used by the capsule
minters. No serialized digest, structural object, copied object, child-process
observation, or independently bundled verifier can substitute for this module
identity.

The capsule assertion surface verifies both:

- that the pack handle is the exact identity minted by this capsule instance;
- that the runtime-authority handle is the exact identity minted by this
  capsule instance and maps to that exact pack handle.

The minting functions, verifier entry, private main, fixed roots, reviewed
anchors, identity stores, and admitted module namespace are not exported.

## Direct-import and initializer guard

Importing the capsule as a dependency is not an admission operation. When
`import.meta.main` is false, the capsule:

- performs no payload verification;
- performs no runtime loading or attestation;
- mints no pack or runtime handle;
- imports no payload;
- creates no session, token, socket, or browser state.

Importing the manifest-selected gate directly causes its fixed external
capsule import to load the capsule as a non-main dependency. The capsule
identity stores remain empty. The gate's one-shot core loader MUST synchronously
assert the exact pack handle as its first operation and before it imports the
heavy core. It must fail before decoder, filesystem, journal,
session-owner, source, mask, token, HTTP, or browser work.

The gate is a pure module. It has no top-level factory invocation, heavy-core
import, source access, filesystem access, decoder load, session acquisition,
token creation, socket creation, timer, worker, child process, browser launch,
or external request. It exports one one-shot admitted core loader and a minimal
closed set of authority-none constants and types. Raw source, mask, operator,
takeover, unbranded core, and listener openers are not exported from the gate.

The heavy core is not an authorized process entry. Its verified dependency
graph may evaluate the already-attested pinned Sharp/native closure when the
gate imports it. It therefore cannot honestly promise that an adversary who
manually imports an internal core member will trigger no module-loading side
effect. It MUST remain free of top-level session, source, journal, mutable
filesystem, token, network, timer, child-process, or browser actions, and its
single factory MUST reassert the capsule-owned pack/runtime identities before
any such privileged operation. The supported capsule path verifies every core
and decoder byte, attests the exact decoder in the same process, reverifies the
payload, and asserts authority before this module evaluation occurs.

Internally reachable source and mask session openers retain their own first-
boundary pack and runtime assertions as defence in depth. The admitted wrapper
does not replace those assertions.

## Process and URL guards

Before minting any identity, the capsule MUST reject:

- `import.meta.url` differing from the exact fixed capsule URL;
- a lower-case or alternate-case drive or path alias;
- a query, fragment, percent-encoded alias, host component, slash variant, or
  copied capsule path;
- execution when the capsule is not the process main module;
- extra CLI arguments;
- any nonempty `process.execArgv`, including `--import`,
  `--require`, `--loader`, `--experimental-loader`, inspector, eval, or source
  execution flags;
- present or nonempty `NODE_OPTIONS` or `NODE_PATH`;
- source-tree, `tsx`, mixed source/dist, package-search, or caller-selected
  module resolution;
- a second call, concurrent call, or reentrant call to the private main;
- a second mint, second gate/core import, second core-loader call, or second
  core-factory call;
- release-root identity or inventory drift at any pre-verification,
  attestation, re-verification, or import boundary.

The capsule state machine is one-way and module-private. Dependency evaluation
terminates inertly; main execution has explicit terminal states:

```text
unevaluated -> evaluated-non-main -> closed
           \-> main-scheduled
                -> verifying
                -> runtime-attesting
                -> reverifying
                -> importing-gate
                -> importing-core
                -> admitted
                -> closed

any nonterminal state -> fatal -> revoked
```

Any repeated, skipped, concurrent, or backward transition is a terminal fatal
error. Failure destroys transient manifest copies and runtime observations,
closes any partially created operator resource, removes every minted pack or
runtime handle from the capsule-owned identity stores, and leaves no reusable
authority. A handle minted before a later verification/import failure must no
longer satisfy any exported assertion.

## Listener remains absent

This Stage 2 capsule does not create or own an HTTP listener. It does not call
`createServer`, `listen`, open a browser, exchange a bootstrap token, or expose
a URL. The admitted workbench remains unlaunchable.

Adding the fixed IPv4 loopback listener described in the loopback-v2 record
requires a later capsule revision, a new deterministic capsule build, a new
capsule hash review, the complete loopback release-test suite, and explicit
authorization. The Stage 1 payload may be reused only if the later capsule does
not require any payload byte to change; otherwise both stages must be rebuilt
and reviewed in order.

## Required verification

### Stage 1 payload tests

- Two independent builds produce byte-identical manifests and member
  inventories.
- The compiled payload contains the operator, source/mask delegates, router,
  contract, response adapter, and exact assets.
- The manifest-selected gate has only the exact capsule URL as a runtime
  dependency, performs no heavy-core import during module evaluation, and
  rejects unbranded input before the dynamic core import.
- The external-import metafiles contain only required Node builtins, exact
  manifest-declared relative pack members, and exactly one out-of-pack import:
  the fixed capsule URL.
- No payload byte contains a fixed reviewed payload root, reviewed manifest
  raw hash, reviewed manifest semantic hash, capsule implementation, listener,
  browser launcher, production minter, or caller-selected verifier.
- The gate export vocabulary is exact and contains one admitted core loader,
  with no raw source, mask, operator, takeover, unbranded-core, or listener
  opener.
- Static inspection and a source-fixture/runtime canary prove no gate
  top-level side effect without pretending that the not-yet-built fixed
  capsule is installed.
- Source-fixture tests prove forged, cloned, serialized, structurally equal,
  child-produced, or separately bundled handles fail before core import and
  every privileged boundary. Exact installed-byte direct-import and ESM-cache
  tests belong to Stage 2, after the fixed capsule exists.
- Direct internal-core import cannot create a session, touch mutable review
  state, mint a token, or open a network surface; the authorized capsule/gate
  path proves verification and same-process decoder attestation precede core
  import.
- The full implementation-manifest adversarial suite covers noncanonical
  bytes, wrong anchors, member tampering, missing and extra nodes, empty
  directories, aliases, junctions, reparse points, hard links, path swaps,
  descriptor races, growth races, final-inventory races, runtime drift,
  preload injection, and environment-based resolution.

### Stage 2 capsule tests

- Capsule compilation is reproducible from the approved Stage 1 anchor.
- The capsule is one self-contained ESM whose only static runtime dependencies
  are exact Node builtins; repository, package, config, and helper resolution
  are absent.
- The capsule namespace exports exactly the two assertion functions and the
  one inert frozen authority-none ABI witness; verifier, minters, reviewed
  anchors and roots, private main, identity stores, and admitted module are not
  exported.
- Running the capsule at the exact fixed URL creates one ESM module instance.
  The payload's fixed external import resolves to that same instance.
- Query, fragment, percent, case, slash, copied-path, junction, and symlink
  capsule aliases fail rather than creating a second usable module instance.
- A test canary proves capsule ESM evaluation completes before the deferred
  private main dynamically imports the payload.
- A regression test forbids top-level await across the capsule-to-payload
  cycle.
- Importing the capsule with `import.meta.main === false` mints nothing and
  imports no payload.
- Extra argv, every nonempty `execArgv`, present `NODE_OPTIONS` or `NODE_PATH`,
  source execution, and external loader injection fail before verification or
  mint.
- Reentrant, concurrent, and repeated private-main, mint, import, and factory
  attempts fail terminally.
- Every payload mutation and root/inventory race fails before payload import.
- Runtime bootstrap and both pre-core and post-core native-module attestation
  occur in the capsule process; the runtime handle is minted only after the
  post-core observation and is bound to the exact pack handle in the same
  capsule module instance.
- Re-verification occurs after bootstrap and again after core import, before
  runtime-authority minting or core-factory invocation.
- Weak identity tests reject clones, structured clones, serialized records,
  child observations, handles from another capsule instance, and crossed
  pack/runtime pairs.
- Failure-path tests prove no handle, token, session, socket, browser state, or
  downstream authority survives.
- A post-mint failure test proves every previously minted pack/runtime handle
  is revoked from the WeakSet/WeakMap identity stores and fails subsequent
  assertion.
- The Stage 2 capsule and admitted payload expose no listener or browser launch
  surface.

### Windows deployment tests

- Installation is fixed-path, same-volume, atomic, no-replace, and
  receipt-last.
- The release root and every descendant reject symlinks, junctions, mount
  points, other reparse points, hard links, path aliases, and unexpected nodes.
- ACL inspection proves exact read/execute and administrative rights for every
  fixed ancestor, capsule, receipt, payload directory, and payload member, with
  no untrusted write/delete/ownership/ACL-change path.
- Installed capsule and payload hashes match the approved release receipt.
- The release receipt is diagnostic and auditable; it is not accepted as a
  caller-supplied runtime trust root.

## Hash approval gates

### Stage 1 approval

The review record MUST contain:

- exact source Git commit;
- builder version and deterministic-build evidence;
- canonical manifest semantic SHA-256;
- canonical manifest raw-file SHA-256 and byte length;
- member-inventory SHA-256;
- member count and total member bytes;
- every member path, kind, SHA-256, and byte length;
- explicit hashes for the workbench bundle, each static asset, runtime
  bootstrap, runtime inspector, Sharp addon, both libvips DLLs, decoder
  metadata, loader, and diagnostic probe;
- exact fixed capsule URL embedded in the payload;
- reviewer acceptance of the closed export and external-import inventories.

No Stage 2 fixed anchor may be authored before these values are accepted.

### Stage 2 approval

The review record MUST contain:

- the accepted Stage 1 anchor values embedded by the capsule;
- canonical fixed-anchor source SHA-256;
- deterministic capsule build evidence;
- capsule raw-file SHA-256 and byte length;
- capsule dependency/build-metafile SHA-256;
- exact capsule export inventory;
- exact fixed Windows capsule and payload paths;
- installed release inventory and ACL evidence;
- canonical release-receipt SHA-256;
- code-signing identity and signature evidence if a later approved signing
  root is used.

The capsule hash is approved externally. It is never embedded into the capsule
or payload.

### Later listener approval

A listener requires a new Stage 2 capsule hash approval and every loopback-v2
release test. It does not inherit launch authority merely because the payload
and admission-only capsule were approved.

## Explicitly prohibited shortcuts

- Filling a fixed production-pack lookup inside any payload member.
- Passing the pack root or reviewed anchor to production verification.
- Selecting roots or anchors through CLI, environment, browser, session, or
  configuration input.
- Treating a caller-anchored candidate handle as production admission.
- Treating a child-process runtime observation as same-instance authority.
- Bundling a second verifier or capsule instance into the payload.
- Using a relative, package, query-bearing, fragment-bearing, case-variant, or
  percent-variant capsule import.
- Starting payload import before complete verification.
- Starting the listener before a later reviewed capsule explicitly contains
  and authorizes it.
- Converting authority-none review evidence into acceptance, reconstruction,
  runtime, export, generated-content, staging, publication, or production
  authority.
