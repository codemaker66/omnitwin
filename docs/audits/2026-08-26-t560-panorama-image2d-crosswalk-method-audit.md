# T-560 panorama/Image2D candidate-crosswalk method audit

Date: 2026-08-26
Status: method accepted for the frozen local build/check; real run pending
Authority: none
Implementation commit: `b04b4d2ae5093f1e6b2016b684c69187404571f3`

## Scope reviewed

The audit covers these exact files in the implementation commit:

- `tools/twin-forge/e57-scripts/build_panorama_image2d_crosswalk.py`
  (`sha256:e7c285651e772bfc1db7eb7e1e80c17f5aba690e60953ecc444aa6333475e650`);
- `tools/twin-forge/e57-scripts/panorama_image2d_crosswalk.py`
  (`sha256:1057a1aa10d639018db66b3da69bf9b4c3e2f28eba5ad57a236ce2eb0ca46659`);
- `tools/twin-forge/e57-scripts/requirements-panorama-image2d-crosswalk.lock.json`
  (`sha256:639797f9047bd3022c2f04df1b6825a6082c81b4bc4bc4b8723abc6bdeb9dc10`);
- `tools/twin-forge/e57-scripts/tests/run_isolated_unittest.py`
  (`sha256:e707147bfbb19c577a6196f68153d547656f1f49e74bc111e2ca8db22ee6ecd5`);
- `tools/twin-forge/e57-scripts/tests/test_build_panorama_image2d_crosswalk.py`
  (`sha256:89b0bdb052de517bc687c9817af66fa445ec792958df039dc1153c6d9420a97e`);
  and
- `tools/twin-forge/e57-scripts/tests/test_panorama_image2d_crosswalk.py`
  (`sha256:7385fcf3f464d99f8fa6c63a84fc3dd12ec5da665bf1e1c4be19c51391f7423d`).

The recovered matcher/reconstruction baseline was compared structurally. All
26 matcher/reconstruction methods were AST-identical to that baseline;
`_derive_crosswalk`, `_load_sources`, `_crosswalk_for_matrix`, custody order,
and provenance order were unchanged by boundary hardening.

## Frozen behavior

The method:

- binds the exact 148-image external panorama manifest and complete source
  inventory;
- binds the completed T-559 pack containing 149 `Data3D` identities and 894
  native JPEG faces;
- builds the full 22,052-pair content-retrieval matrix;
- uses a fixed cubeface ray convention and shortlist-only spherical
  verification with no sequence, filename, GPano, pose, or room-label input;
- ranks deterministically and fails closed for weak, tied, colliding, or
  unsupported candidates;
- writes canonical JSON to a new output only, with the receipt written last;
  and
- independently recomputes before accepting an existing output in check mode.

All results are machine candidates requiring human review. No candidate is a
camera transform, room-membership decision, mask, or architectural fact.

## Runtime and dependency provenance

- CPython 3.12.12 standalone build `20260211`, executable SHA-256
  `711df14e4ef9f0890c5c84330faba821839f3f6757dbe27cbf69ac3de6852446`;
- Python archive SHA-256
  `93bf8e8c05ede0077b197a29c99ebdaf253497f27190097494265150b4e70ba8`;
- NumPy 1.26.4 wheel SHA-256
  `08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818`;
- OpenCV headless 4.10.0.84 wheel SHA-256
  `afcf28bd1209dd58810d33defb622b325d3cbe49dcd7a43a902982c33e5fad05`;
- exact installed-tree digests and counts for both packages;
- exact native `.pyd`/DLL hashes, OpenCV build-information hash, CPU feature
  line, environment controls, one OpenCV thread, and OpenCL disabled; and
- execution only with `-I -S -B -X pycache_prefix=NUL`, `PYTHONPATH` absent,
  no `site`, no user site, and explicitly loaded reviewed local modules.

The import allowlist is derived from byte-verified wheel members, not from a
live post-verification directory inventory. Installer-generated metadata files
are bound by exact installed-tree digests.

## Verification results before the method commit

Canonical positive worker launch:

```powershell
& $python -I -S -B -X pycache_prefix=NUL `
  tools\twin-forge\e57-scripts\build_panorama_image2d_crosswalk.py --help
```

Result: exit 0.

Focused startup/import/seal suite:

```powershell
& $python -I -S -B -X pycache_prefix=NUL `
  tests\run_isolated_unittest.py `
  tests.test_build_panorama_image2d_crosswalk.StartupImportAndSealTests -v
```

Result: 15/15 passed in 1.526 seconds on the final code snapshot.

Core custody/schema/ranking/publication suite:

```powershell
& $python -I -S -B -X pycache_prefix=NUL `
  tests\run_isolated_unittest.py tests.test_panorama_image2d_crosswalk -v
```

Result: 27/27 passed in 3.224 seconds.

Complete real sealed NumPy/OpenCV builder suite:

```powershell
& $python -I -S -B -X pycache_prefix=NUL `
  tests\run_isolated_unittest.py tests.test_build_panorama_image2d_crosswalk -v
```

Result: 40/40 passed in 91.534 seconds. The final helper rename was then
covered by another 15/15 focused pass and does not alter matching behavior.

After the method and operations record commits, the canonical combined command
ran the builder module first and the core module second through the isolated
entry point. Result: 67/67 passed in 86.552 seconds. A proposed generic
discovery command was rejected because `unittest` inserted the tests directory
into `sys.path`; that was a safe import-gate rejection. The runbook now uses
explicit dependency-safe module order and does not weaken the gate.

Static checks found all five Python files parseable, zero production functions
over 50 lines (builder maximum 46; core maximum 48), strict duplicate-free
canonical lock JSON, exact 43-key runtime control agreement, and no stale
“tree seal” overclaim. `git diff --cached --check` passed before commit.

## Reviewer findings resolved

Independent review drove these corrections before freeze:

- recovered the authoritative builder semantics from the retained Python 3.12
  bytecode and quarantined stale caches;
- replaced a process-unstable marshal fingerprint with a stable recursive code
  identity digest and rejected callable spoofs before attribute access;
- made the worker require exact isolated import-state containers and standard
  import machinery before any local/dependency import;
- removed the reviewed scripts directory from normal import search and loaded
  reviewed local modules only by exact file specs;
- derived allowed dependency import origins solely from verified wheel members;
- rejected namespace escapes and every preloaded `numpy`, `numpy.*`, `cv2`, or
  `cv2.*` module before environment mutation;
- bound pip-generated metadata through exact installed-tree counts/digests;
- retained the verified import finder for lazy imports;
- corrected provenance verification while the guarded finder is active;
- closed internally owned backends on every success/failure path while leaving
  injected backends caller-owned; and
- made Windows handle-close failures truthful and retryable without repeating
  successful import-path deactivation.

Two independent final reviews found no remaining correctness/security blocker
within the declared operating model. `DependencyImportPlan` contains shallowly
mutable mapping fields, but they are transient, immediately copied, and
re-attested; this is recorded as non-blocking future hardening debt.

## Precise security boundary

This worker is pinned, isolated, and fail-closed for a trusted same-user local
run. It is not a hostile-user sandbox and does not claim a completely read-only
dependency tree.

Windows handles deny write/delete for all dependency paths that exist when the
seal is created. Windows still permits creation of new children. Python imports
are separately restricted to verified wheel-derived origin paths, and
end-of-run dependency re-attestation detects persistent drift. Native DLL or
configuration loading is not comprehensively isolated from a hostile
same-user concurrent writer. Network is unused, but the operating system does
not deny network access. The runbook therefore forbids concurrent or untrusted
writers.

## Authority and completion boundary

The method commit does not alter source data or create correspondence evidence.
As of this audit revision, the real no-replace build and separate check have not
run and the target output is absent. No source was modified; no output was
uploaded, pushed, merged, deployed, registered, staged, trained from, rendered,
or promoted. Production trust remains `null`, and T-554 through T-558 remain
unchanged.
