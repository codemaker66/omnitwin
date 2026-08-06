# Local guided Foundry workflow — evidence handoff

**Date:** 2026-07-13  
**Status:** usable for safe intake review, plan preview, and local approved-file
verification; not a reconstruction runner

## Direct answer

Yes, computer vision is useful here. It can find visible double-drawing,
ghosting, broken fixed views, edge changes, and regressions between two renders.
It cannot prove that newly visible detail is physically real unless the result
is compared with independent, registered photographs or measurements that were
not used to make the result.

The Reception evidence already found one real problem: the runtime was drawing
coarse parents together with their fine descendants. The corrected Quality
frontier uses four fine SOG leaves and removes that visible double-drawing. This
is a real presentation improvement, but it recovers existing information; it
does not add new captured HD detail.

## What was built

One local command now opens a plain-language guided workflow:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source "C:\path\to\your-capture"
```

The person using it can:

1. wait while the chosen file or folder is read and fingerprinted;
2. see likely formats, sizes, exact duplicates, and why every file is held;
3. decide whether to keep or leave out every file;
4. label kept material as original capture, official export, or reference only;
5. build two authority-none review drafts bound to the exact receipt;
6. compare captured-only, pretrained enhancement, or rights-gated training
   intent across local CPU, local CUDA, and RunPod planning routes; and
7. request four JSON downloads from the browser, then check the Downloads
   folder before closing; and
8. run a local-only check of the approved files, see simple progress, stop it,
   continue it, and open the finished report.

The simple screen handles up to 500 files. At 501 files it disables guided
admission, keeps the complete receipt downloadable, and directs the operator to
the authorized batch-review path so no file is silently omitted.

The approved-file check is bound to the exact source, receipt, and admission
decision. It rereads the approved bytes and records what it actually checked.
Its displayed provider charge is **£0.00** because it uses no paid provider;
that figure does not include the person's time, electricity, or computer cost.

The local server now exposes the approved-file check through the
`start`, `status`, `current`, `cancel`, `resume`, and `report` routes. Those
routes are local workflow controls, not reconstruction or enhancement routes.

## What it deliberately cannot do

- It cannot change, delete, move, or approve source files.
- It cannot decode or relabel proprietary XGRIDS XBIN. XBIN is reference-only.
- It cannot turn an uncertain format into an accepted format without
  receipt-bound evidence.
- It cannot put AI-generated material into measured geometry.
- It cannot discover credentials, invent computer capacity, invent a RunPod
  price, contact a provider, launch a reconstruction worker, or spend money.
- It does not copy the full capture into a staging area or upload it anywhere.
- Its private resume record can contain tiny fragments of source bytes needed
  to verify a stopped read. It is therefore private material, even though it is
  not a staged copy of the capture.
- Stop and Continue work only while the same local app process remains open.
  Continue deliberately rereads the approved file from byte 0. A browser
  refresh can recover the current verifier, but closing and restarting the app
  cannot reopen that saved check in the screen yet.
- It cannot train a scene, reconstruct or enhance the room, judge whether the
  scan is physically accurate, or publish a runtime package.

The process creates no external service client or request. That statement
assumes the source is on a truly local or removable disk. A mapped, shared, or
cloud-synced drive may cause Windows or its sync software to fetch or transmit
bytes outside Foundry's control.

## Safety and identity checks

- The server binds only to `127.0.0.1`.
- Browser writes require the exact session token and exact loopback origin.
- Admission downloads and plan downloads require the exact current artifact
  digest; a stale tab cannot silently receive another tab's result.
- A verification start is bound to the exact source, receipt, and admission
  digests. Changing the reviewed evidence invalidates the old verifier instead
  of presenting it as current.
- Request bodies are bounded and reject unknown top-level fields.
- The source is read-only. Receipt, review, result, and plan state remain in
  memory until the operator requests a browser download. Verification state is
  written only under its private local resume root.
- The default session is bounded to four hours. The ready screen keeps checking
  expiry and shows a warning during the final 15 minutes.
- Stop and tab-close guards cover unbuilt file choices, unbuilt plan choices,
  built-but-not-requested drafts, and choices changed while a request is in
  flight.
- Absolute source directories are not returned to the page. The source
  basename and receipt-relative filenames are intentionally shown.
- Verification responses sent to the browser contain only the job ID,
  revision/run identity, totals, progress, phase, and outcome. They never send
  absolute paths, source keys, checkpoints, private evidence, or credentials
  to the page.
- Downloaded JSON contains relative names, fingerprints/header evidence,
  project ID, and reviewer name. It must be reviewed and kept private before
  sharing.

## Verification

Earlier intake and plan-preview evidence remains valid:

- Reconstruction Foundry: 19 test files, 158 tests passed; typecheck, lint, and
  build passed. A later wording-only plan-preview change passed its 9 focused
  tests plus typecheck, lint, and build.
- Local Foundry CLI/app: 6 test files, 41 tests passed; typecheck, lint, and
  build passed.
- The 500-file success and 501-file fail-closed boundary was exercised with
  real temporary files through the loopback HTTP contract.
- The embedded browser JavaScript parses as standalone JavaScript; static IDs,
  route references, and unsaved/expiry guards are covered by tests.

Latest integrated approved-file verification evidence:

- The full Reconstruction Foundry package passed **111/111 tests**.
- Five repeated race-focused runs passed **25/25 tests**. These cover stop,
  continue, stale-run protection, and related timing boundaries.
- Typecheck, lint, and production build all passed.
- Real-browser QA passed on desktop and a **390×844** mobile viewport. It found
  no horizontal overflow, dialog, console warning, or console error.
- The complete review-to-verification path passed with **1/1 approved file**
  and **130 B** checked.

Current count reconciliation — 2026-07-14: the totals above are historical
checkpoint totals, not current package totals. A fresh read-only rerun passed
Reconstruction Foundry at 23 files / 215 tests with one Windows-only symlink
test skipped, and the Foundry CLI at 12 files / 145 tests. Relevant package
typechecks passed; browser QA, lint and production builds were not rerun in this
reconciliation.
- Refreshing after the completed check started an asynchronous restore. Once
  that restore settled, the screen correctly recovered the **1/1, 130 B**
  result and clearly labelled it as belonging to the last saved review draft,
  not the blank decision form shown after reload.

The visual captures below prove the layout used during that manual QA. They
were captured before the final audit added four-hour countdown wording,
download privacy wording, and unbuilt-choice guards. Those later changes are
covered by automated tests but were deliberately not mislabelled as
re-screenshotted release evidence.

- `docs/reports/evidence/local-foundry-guided-plan-desktop-pre-final-audit-2026-07-13.png`
  - 133,253 bytes
  - SHA-256 `9414C081F246B7C69F6CFE7A1853AA4696AB73C34D31A8CD3A1966C3B68D3CD8`
- `docs/reports/evidence/local-foundry-guided-plan-mobile-pre-final-audit-2026-07-13.png`
  - 49,508 bytes
  - SHA-256 `E578FA890523814AD3C87AEE6708FFD94E1F399ED3D83822A4357DC3034BA028`

The computer-vision triage implementation and its evidence are in:

- `tools/reception-hd/triage_fixed_views.py`
- `tools/reception-hd/reports/reception-room-fixed-view-cv-triage.json`
- `docs/reports/reception-room-cv-triage-independent-audit-2026-07-13.md`

The CV triage has 21 focused passing tests. It correctly sends the invalid
parent-plus-child views to human review and reports the four-leaf Quality view
as `triage_clear`. `triage_clear` means “no tested visible regression found”; it
does not mean physical acceptance.

## What remains genuinely blocked

1. **New physical detail:** no rights-cleared, registered 30-photo Reception
   set exists yet, so no independent hero-detail candidate can be trained or
   judged against held-out photographs.
2. **Operator source selection:** the app still starts from one PowerShell
   command; it has no safe in-browser folder picker or drag-and-drop handoff.
3. **Process-restart reopening:** the verifier now has private durable job
   records and same-process Stop/Continue, but the screen cannot reopen a saved
   check after the local app process is closed and restarted.
4. **Real workers:** local CPU/CUDA and RunPod rows have no attested worker
   program, measured capacity snapshot, provider quote, cancellation loop, or
   output-parity proof.
5. **Production provenance:** database migrations and a private hash-pinned
   Quality runtime package still need proof in a disposable production-shaped
   environment before any release.

## Exact next move

Blake's next physical action is to capture the rights-cleared Reception photo
set in `docs/reports/reception-room-30-photo-capture-checklist.md`. Keep several
photographs completely out of training so computer vision and human review can
judge whether detail was truly added.

The next software slice should add safe process-restart reopening for the
private verification record, then one frozen, non-training local worker behind
the existing authority gate. It should prove start, progress, cancel, restart,
and exact output hashes locally before any RunPod client or paid action is
introduced.

## Honest conclusion

Computer vision has already improved the diagnosis and prevented a false HD
claim. The local guided workflow now makes the safe intake and planning steps
understandable to a non-specialist, and it can now recheck the exact approved
files locally without presenting that file-integrity check as reconstruction.
The missing result is still the important one: a new captured-detail Reception
candidate that beats the corrected four-leaf baseline on held-out photographs
and moving views.
