# Grand Hall T-554 native-review Stage 1 candidate runbook

Status: implemented; no reviewed candidate has been issued yet
Authority: none
Scope: private local Grand Hall human-review workbench payload only

## What this stage does

Stage 1 materializes two independent `git archive` snapshots from one clean,
explicitly named Git commit and compiles one exact T-554 workbench payload from
each snapshot. It never compiles source bytes from the live worktree. Temporary
dependency junctions point each snapshot at the dependency closure already
installed in the reviewed workspace; the junctions and snapshot roots are
removed before publication. Stage 1 then independently proves that both builds
have identical builder versions, closed module surfaces, canonical manifest
bytes, member paths, member hashes, member lengths, member-inventory digests,
member counts, total member bytes, and every payload member byte.

The result is one create-only directory containing:

```text
build-a/...
build-b/...
stage1-candidate-authority-none.json
receipt.json
```

The candidate record is written before the receipt. The receipt is written
last, and the completed directory is atomically renamed into its requested
absent path. Generation fails and removes its owned staging directory if the
worktree changes before publication. The checker verifies the exact root and
payload counts and cross-binds the record to both payloads. A pinned
`es-module-lexer` 2.1.0 inspection re-parses the five persisted ESM members and
exact-compares every import path, import kind, multiplicity, module assignment,
export, non-literal dynamic-import count, and `import.meta` count with the
reviewed builder surface. Changing a review anchor, count, surface record, or
compiled module and merely re-sealing the manifest/candidate/receipt chain is
rejected.

The candidate is **not** an accepted Stage 1 review record. Its acceptance
fields remain `false` / `human_pending`, and the tool cannot turn them true.
After review, acceptance must be captured in a separate no-replace record that
binds this exact candidate. Stage 2 must not exist before that record exists.

This stage does **not** contain or install the fixed-admission capsule. It does
not listen, launch a browser, access any panorama, make a room or pixel
decision, accept evidence, reconstruct, export, upload, deploy, publish, or
touch production. Its literal state remains `authority: none` and
`stage1HashApproved: false`.

## Preconditions

1. Use Windows x64.
2. Finish and test the intended workbench source changes.
3. Commit those changes on `codex/grand-hall-exact-runtime`.
4. Confirm the worktree is clean.
5. Choose an absent output directory outside the Git worktree. Prefer the
   evidence volume rather than the constrained system volume.
6. Record the full lowercase 40-character commit SHA. Do not use a branch name,
   abbreviated SHA, environment substitution, or an uncommitted worktree.

## Generate

From the repository root, replace only the two angle-bracket values:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-stage1-candidate -- `
  --workspace "C:\Users\blake\omnitwin2-grand-hall-exact-runtime" `
  --reviewed-git-sha "<exact-lowercase-40-hex-commit>" `
  --output "D:\venviewer-evidence\trades-hall-grand-hall-t554-native-review-stage1-<short-sha>"
```

The command refuses a dirty worktree, a SHA mismatch, an existing output, an
output inside the worktree, nondeterministic builds, or any failed exact-byte
verification.

## Verify without rebuilding

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-t554-stage1-candidate -- `
  --check `
  --output "D:\venviewer-evidence\trades-hall-grand-hall-t554-native-review-stage1-<short-sha>"
```

Verification requires the exact four-entry root inventory, canonical
self-bound candidate and receipt JSON, both exact payload inventories, both
manifest anchors, both member-inventory digests, and the receipt cross-bindings.
It also reproves that the two persisted manifests and member inventories remain
identical.

## Review gate

Before Stage 2 is designed or compiled, inspect the candidate record and report
these exact values together:

- `reviewedGitSha`;
- `reviewedGitTreeSha`;
- the complete `sourceMaterialization` record;
- `builderVersion`;
- `candidateSha256`;
- `reviewAnchor.manifestSemanticSha256`;
- `reviewAnchor.manifestFileSha256` and `manifestFileByteLength`;
- `reviewAnchor.memberInventorySha256`, `memberCount`, and
  `totalMemberBytes`;
- every `members` entry, including its path, kind, SHA-256, and byte length;
- every explicit `importantMembers` binding;
- the exact `closedModuleSurface.fixedAdmissionCapsuleUrl`;
- every closed external-import, emitted-import, and export inventory;
- every per-module `moduleSyntax` count, including non-literal dynamic imports
  and `import.meta` expressions;
- `closedModuleSurface.reviewerAcceptance` with both inventory acceptances and
  `moduleSyntaxInventoryAccepted` still `false`, state `human_pending`;
- all eleven deterministic-comparison fields as `true`;
- every guard in the record, especially `stage1HashApproved: false`,
  `stage2CapsuleIncluded: false`, `listenerIncluded: false`, and
  `browserLaunchIncluded: false`.

The reviewer must explicitly accept the complete closed import/export and
module-syntax surface, not only its aggregate hash. An approval must identify
that exact tuple and be captured in a separate create-only Stage 1 acceptance
record. Approval of a
screenshot, a branch, a short SHA, one payload member, or a prior candidate is
not approval of the candidate. Until that separate accepted record exists, do
not compile or install Stage 2 and do not launch the workbench.

## Failure handling

- Never rename or reuse a partial directory as a candidate.
- Never edit a candidate in place.
- If generation fails, inspect the error, fix the source or environment, commit
  any source change, and generate to a new absent directory.
- If `--check` fails, quarantine that directory and issue no approval request
  for it.
- Do not delete source capture data or any pre-existing evidence directory as
  part of this workflow.
