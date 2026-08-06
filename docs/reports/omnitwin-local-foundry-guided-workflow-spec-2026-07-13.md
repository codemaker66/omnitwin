# Local Foundry guided review and plan preview

**Status:** implementation specification, not implemented by this document  
**Audience:** an operator who understands their capture project but does not need to understand hashes, schemas, or cloud infrastructure  
**Authority:** none. This workflow must not approve rights, claim physical accuracy, or authorize execution.

## Outcome

Extend the existing teal/cream/mint local intake page into one short, understandable flow:

1. check one source without changing it;
2. decide which files belong in a draft;
3. record missing rights, origin, and technical evidence;
4. compare local and cloud **plans only**; and
5. download digest-bound draft JSON files.

There is no `Run`, `Upload`, `Approve`, `Publish`, or `Make true` action in this companion workflow.

## Evidence inspected

This specification is grounded in the current implementations and contracts:

- `tools/reconstruction-foundry/src/local-app-assets.ts`
- `tools/reconstruction-foundry/src/local-app.ts`
- `tools/reconstruction-foundry/src/__tests__/local-app.test.ts`
- `tools/reconstruction-foundry/src/__tests__/local-app-cli.test.ts`
- `packages/reconstruction-foundry/src/intake-receipt.ts`
- `packages/reconstruction-foundry/src/intake-admission.ts`
- `packages/reconstruction-foundry/src/plan-only.ts`
- `packages/types/src/omnitwin-foundry-intake-admission.ts`
- `packages/types/src/omnitwin-foundry.ts`
- `docs/specs/omnitwin-intake-admission-v0.md`
- `docs/specs/omnitwin-plan-only-v0.md`

The existing app already proves a useful safety boundary: it binds only to `127.0.0.1`, uses a per-session token, fixes the source at startup, accepts no browser-supplied source path, applies strict browser security headers, keeps the source read-only, creates the receipt in memory, and exposes only state, receipt download, and stop routes. Those boundaries remain mandatory.

## Words the interface may and may not use

Use these phrases:

- “Detected as”
- “Included in this draft”
- “Left out of this draft”
- “Needs evidence”
- “Blocked”
- “No planning blocker found”
- “Plan only — nothing will run”
- “Downloaded”

Do not use these phrases for intake or planning results:

- “Approved”, “legally cleared”, or “safe to use”
- “Verified”, unless the sentence names the exact bytes or digest that were verified
- “Accurate”, “true”, “measured”, or “physically correct” based only on a recognised format
- “Ready to run”, “cloud ready”, or “selected provider”
- “Guaranteed cost” or “cost limit enforced”
- “Complete”, when only a receipt, draft, or plan exists

## Persistent page frame

Reuse the current dark teal background, cream workbench, mint active state, gold warning, serif headings, and compact RF mark. Mint means “current or available”, not “approved”. Gold means “attention needed”. Red is reserved for a failed or prohibited state. Every colour state also has visible text and an icon with a text label.

Every screen shows this fixed status strip:

> **On this computer** · **Source files read-only** · **Authority: none**

Immediately below it, show the five-step trail:

> 1 Check source · 2 Review files · 3 Record evidence · 4 Compare plans · 5 Download drafts

Completed steps use the label “Draft saved in memory” or “Check finished”; never “Approved”. The source label is a basename only. Never render an absolute path, token, credential, environment variable, or private server error.

## Screen 1 — Check source

### Starting

Heading:

> Checking the source you chose

Body:

> Foundry is reading file names, sizes, format clues, and fingerprints. It will not move, edit, upload, rebuild, or train on these files.

The source is still chosen outside the browser when the local session starts. There is no path box, drag target, recent-path list, or in-browser file picker in this version.

### Progress

Progress must describe measured work:

- During discovery, show an indeterminate bar and “Looking for regular files…” because the total is not yet known.
- After discovery, show `12 of 47 files checked · 3.2 GiB read of 8.4 GiB` only when those counters exist in authoritative state.
- If byte totals are not available, keep the bar indeterminate. Do not invent a percentage from elapsed time.
- Announce progress to assistive technology no more than once per second and only when a material count changes.

Secondary action:

> Stop check

Confirmation:

> **Stop this check?** No receipt will be created. The source files will not be changed.

Buttons: `Keep checking` and `Stop and close session`.

### Check finished

Heading:

> The source check finished

Body:

> Foundry recorded what it observed. Every file still needs a human decision about its use, origin, and rights.

Primary action: `Review files`  
Secondary action: `Download intake receipt`

The existing summary remains: files read, total size, detected format groups, duplicate groups, quarantine reasons, and the receipt fingerprint. Replace the current result heading “Receipt ready — every file is not approved yet” with the simpler copy above; the persistent authority strip supplies the legal boundary.

### Safe failure, cancellation, and expiry

- Failure heading: `The check could not finish safely`
- Failure body: `The source may have moved, changed, disconnected, or contained a link or special entry. No receipt was issued and no source file was changed.`
- Cancelled heading: `The check was stopped`
- Expired heading: `This private local session ended`
- Expired body: `Nothing was saved by the local server. Start a new local session to continue.`

Do not show a partial receipt. Do not offer “continue anyway”. Provide `Close this session`; restarting with a source remains a separate local action.

## Screen 2 — Review files

Heading:

> Choose what belongs in the draft

Body:

> This changes only the draft record. It does not delete, move, approve, or process a source file.

### Summary and filters

Show counts for:

- decision needed;
- included in draft;
- left out of draft;
- unknown or ambiguous format;
- proprietary or vendor-controlled;
- exact duplicate groups.

Controls:

- Search relative file name.
- Filter by `Decision needed`, `Included`, `Left out`, `Unknown type`, `Vendor-controlled`, `Duplicate`, and `Needs rights evidence`.
- Sort by relative path, size, detected type, or blocker count.
- `Show only this duplicate group` from a duplicate notice.

Desktop uses a real semantic table. Mobile uses one card per file; it must not squeeze the table into horizontal scrolling.

### Required per-file decision

Each file has a two-choice fieldset:

- `Keep in this draft`
- `Leave out of this draft`

No choice is preselected. Every receipt path must receive exactly one decision before a review draft can be built. “Keep” means only that the file appears in the draft ingest manifest.

If left out, require one reason from the contract and a plain explanation:

- exact duplicate;
- unsupported format;
- rights not cleared;
- origin unknown;
- unrelated to this project;
- replaced by a newer input;
- operator chose to leave it out.

Copy under the control:

> The source file stays where it is.

### Type review

Show the top detector result as:

> Detected as: OBJ mesh · high confidence

Supporting copy:

> A type match is a clue. It does not prove that the file is complete, safe, correctly scaled, or suitable for reconstruction.

Actions:

- `Use this detected type`
- `Choose a different type`
- `I do not know — keep blocked`

A different type is an operator override. It requires both a rationale and at least one evidence reference. The reference can identify a vendor document, a read-only inspector report, or another saved project record. An extension alone is not sufficient evidence.

### Origin and truth label

For a kept file, require one understandable origin label:

- `Original captured data`
- `Official vendor export`
- `Derived from captured data`
- `AI-enhanced captured derivative`
- `AI-generated cinematic derivative`
- `Concept or imagined reference`
- `Reference only`

Map these labels to the strict capture-state and provenance fields. Generated or concept files require at least one named parent or conditioning asset. They cannot be labelled original captured data. An original raw capture must remain a direct source with no parent asset.

Always display:

> This label records origin. It does not prove physical accuracy.

### Bulk actions

Allow bulk exclusion only after a preview names the exact affected count and reason. Allow copying shared source, session, or rights **record details** to selected files. Never provide `Approve all`, `Clear all rights`, `Mark all accurate`, or an automatic duplicate deletion action. A duplicate suggestion may say “These bytes match exactly”; the operator still chooses which draft entry, if any, to leave out.

Primary action: `Continue to evidence`  
Secondary action: `Download receipt`

The primary action stays disabled until every file has a decision and every kept file has a type and origin label. Its disabled explanation names the first unresolved group and links to it.

## Screen 3 — Record evidence

Heading:

> Record what is known — leave the rest blocked

Body:

> This page records evidence for later review. It does not give legal advice, grant permission, or certify measurements.

Use three sections with plain summaries and optional detail drawers.

### A. Source and operator record

Required:

- internal project ID;
- operator name for the audit trail;
- source kind: local folder, removable drive, vendor workspace, or object-prefix record;
- safe display name and redacted location description.

Copy below operator name:

> Your name records who prepared this draft. It does not make you a legal or technical approver.

The source remains `readOnly: true` and `sourceMutationPermitted: false` without an editable control.

### B. Rights record

For each kept asset or a deliberately selected group, show separate rows for:

- commercial product use;
- model training or fine-tuning;
- redistribution or export.

Each row uses the contract choices: allowed, restricted/requires review, prohibited, or unknown. `Unknown` is the default. An allowed or restricted record requires a rights basis, HTTPS terms reference, reviewed date, and any restrictions. Keep code, model-weight, dataset, capture-service, and customer permissions as separate evidence references when they differ.

Persistent warning:

> Foundry can record a rights review, but it cannot create permission. Unknown stays blocked. A permissive software licence does not grant rights to customer captures, model weights, or datasets.

The overall legal state emitted here is only `requires_review` or `blocked`; the UI has no `approved` value.

### C. Technical and coordinate record

Show, for each kept asset:

- access: direct, official export, official API, metadata only, technically blocked, legally blocked, or unknown;
- capture/export date when known;
- coordinate frame: named evidence-backed frame or `Not recorded`;
- calibration and parent assets when known;
- geometry, appearance, calibration, and scale value as `none`, `low`, `medium`, `high`, or `unknown`;
- one decisive next test.

Beginner defaults are `unknown`, no coordinate frame, and a format-specific next test. Never infer “measured” from an E57 extension or “captured” from a photograph. A measured frame requires declared units, handedness, up axis, and provenance evidence. A visual nudge is not a reviewed transform.

For XGRIDS XBIN, show:

> Vendor-controlled raw capture. Foundry has not decoded the payload. Keep it metadata-only or blocked unless an official documented access route and rights record exist.

Do not provide a bypass, decrypt, or “try anyway” control.

### Build draft

Primary action: `Build review draft`  
Secondary action: `Back to file decisions`

While compiling, show `Checking every file decision and fingerprint…`. This is a bounded local compile, not reconstruction. If validation fails, move focus to an error summary and link each error to its field. Do not silently correct an operator override, rights value, path set, digest, or proprietary access state.

Success heading:

> Review draft built

Success body:

> The draft is bound to this exact receipt. Its authority is none. Planning, training, signing, publishing, and promotion are not authorized.

Any later edit invalidates the admission result and every plan derived from it. Show `Draft changed — rebuild before downloading or comparing plans` until recompilation succeeds.

## Screen 4 — Compare local and cloud plans

Heading:

> Compare plans — nothing will run

Body:

> Foundry checks whether each declared route fits the draft, recipe, rights record, capacity, estimate, and budget. It will not choose a provider, contact a cloud service, upload files, reserve hardware, or spend money.

The operator first selects one versioned local recipe by its human name, such as `Inspect and organise`, `Build measured geometry`, `Build captured appearance`, or `Package for browser`. Expanding the recipe shows its exact stages, inputs, outputs, rights purposes, container digest, resources, network policy, and checkpoint declaration. There is no hidden “automatic” recipe.

### Route cards

Show local CPU, local GPU, and declared cloud routes as comparable cards. Each card includes:

- route name and adapter ID;
- `Plan only` badge;
- input bytes;
- required versus declared CPU, RAM, GPU, GPU memory, and scratch space;
- every blocker in plain language with the stable blocker code available in details;
- whether a strict plan-only JobSpec was formed and its digest;
- exact ingest-manifest digest.

Local cards say:

> Estimated provider charge: $0. Electricity, staff time, and hardware wear are not priced here.

If local capacity was declared rather than measured by a trusted probe, say:

> This preview uses declared capacity. It has not tested this computer.

Remote cards also show estimate source, observed time, expiry time, the six-part cost breakdown, total estimate, and budget cap. Their fixed warning is:

> Estimate supplied for planning. No provider was contacted. No charge limit or kill switch is running.

Candidate status copy:

- `No planning blocker found` for `viable_plan_only`.
- `Blocked as planned` for `blocked_plan_only`, followed by every next action.

Never use `Ready`, `Best`, or `Selected`. A visually highlighted route may be labelled `Simplest plan to review`, but the reason must be visible and it still carries the plan-only warning.

The current D-016 posture must be visible: local routes with a model-training purpose are blocked. A remote RunPod route may pass planning checks, but it still cannot create a pod or start training.

Primary action: `Build plan preview` or, after compilation, `Download plan dossier`  
Secondary action: `Back to evidence`

There is no execution control. `killSwitchEnabled: true` in a JobSpec is described as a required declaration, not an active safety service.

### Plan states

- **Building:** `Checking route capacity, rights, estimate freshness, and budget…`
- **At least one viable plan-only route:** `One or more routes have no planning blocker. Nothing is authorized to run.`
- **All blocked:** `No route passes the current planning checks.` Show the grouped next actions; do not relax a gate.
- **Stale estimate:** `This cloud estimate expired. Add a new evidence-backed estimate before comparing this route.`
- **Manifest changed:** discard the old preview and show `The review draft changed. Build a new plan preview.`
- **Compile failed:** show no candidate as viable and no partial “winner”.

## Screen 5 — Download drafts

Heading:

> Save the evidence you created

Show four independent files when available:

1. `foundry-intake-receipt.json`
2. `foundry-admission-review-draft.json`
3. `foundry-admission-result-draft.json`
4. `foundry-plan-only-dossier.json`

Each row shows its full digest through a `Copy fingerprint` control, its bound parent digest, authority `none`, and what it does **not** authorize. Downloaded JSON is created from validated in-memory state. The local server must not write a draft beside the source or to a hidden working directory.

Before the first download, show:

> These JSON files contain relative file names, sizes, evidence notes, and cryptographic fingerprints, but not the source bytes. Store them with private project records.

Do not create an ad-hoc ZIP or “project package” until a versioned wrapper contract binds the exact file set and digests. A browser download success changes the row to `Downloaded`; it does not change authority or completion state.

If a download fails:

> The draft could not be downloaded. No source file was changed. Try the download again before this session ends.

Final primary action: `Stop and close local session`.

If unsaved in-memory edits exist, confirm:

> **Close without downloading the latest draft?** The local server does not save this work. Your source files will not be changed.

## Interaction and security rules

1. Keep the current loopback-only, high-entropy token, exact host/origin checks, CSP, no-referrer, no-store, and fixed-route posture.
2. New browser requests may reference only receipt-relative paths and digests already held by the session. They must never accept an absolute path, command, executable, provider credential, arbitrary URL, or environment-variable name.
3. Keep all review, admission, and plan state in memory. Do not use local storage, a service worker, telemetry, analytics, cloud fonts, or network APIs. Session storage may retain only the session token as it does now.
4. Bound and strictly validate every request body. Recompile the admission result and plan dossier on the trusted local server; never trust browser-supplied derived fields or digests.
5. Every edit that affects a contract digest invalidates downstream artifacts immediately.
6. Never mutate, rename, delete, stage, upload, decode, decrypt, reconstruct, train, sign, publish, or promote from this workflow.
7. Stop aborts active inspection/compilation, clears in-memory state, closes connections, and ends the server. A cancelled operation emits no partial receipt or falsely complete draft.
8. Use unload protection only to warn about undownloaded in-memory work. It must not claim that work was autosaved.
9. Do not expose technical stack traces. Give a stable safe error plus a plain next action; keep private absolute paths out of browser responses and downloads.
10. The receipt remains the byte-identity root. A review must account for its exact sorted path set, and every plan must bind the exact resulting ingest-manifest digest.

## Responsive layout

### Desktop, 1024 px and wider

- Keep the current 1500 px maximum shell.
- Use a 240–280 px step rail, a flexible main column, and an optional 340–400 px evidence drawer.
- Keep the primary action visible at the top and bottom of long review screens.
- File review uses a sticky semantic table header. Opening details must not cover the decision control or change the row order.

### Tablet, 720–1023 px

- Move the step trail above the workbench.
- Use one main column with a slide-in evidence drawer.
- Route cards may use two columns only when each remains at least 320 px wide.

### Mobile, 320–719 px

- One column; no horizontal page scrolling.
- Replace each file row with a card in the same reading order.
- Filters open in a labelled sheet and retain their state.
- Put `Back` and the current primary action in a sticky bottom bar that does not cover focused fields or browser zoom content.
- Long relative paths and fingerprints wrap; the full value remains copyable.
- Buttons and inputs are at least 44 by 44 CSS px.

## Accessibility requirements

- One `h1`, logical nested headings, a skip link, semantic landmarks, real buttons, fieldsets, legends, labels, and table headers.
- Minimum 16 px body copy and 14 px secondary metadata. Do not carry the current 0.64–0.8 rem table text into the guided editor.
- Do not rely on mint, gold, or red alone. Pair every status with text and an icon whose accessible name is not duplicated.
- Visible keyboard focus on every interactive element. Tab order follows the visible order. Escape closes a drawer without losing edits.
- On screen changes, move focus to the new `h1`; on validation failure, move focus to the error summary.
- Use `aria-live="polite"` for phase changes, not every polling response. Use a real progress element or `role="progressbar"` with measured values; use an indeterminate state when totals are unknown.
- Error text states what happened, what remains safe, and the next action. Associate it with the field using `aria-describedby`.
- Honour reduced-motion settings. No essential information depends on animation.
- Reflow without lost content at 200% browser zoom and 400% text zoom. Test screen-reader labels and keyboard use; screenshots alone cannot prove accessibility.

## Explicit non-goals

This version does not:

- replace the terminal or signed desktop shell used to choose the one source;
- decode or decrypt XBIN, LCC/LCC2, MatterPak, FBX, or CAD/BIM payloads;
- decide ownership, write legal advice, or set legal state to approved;
- validate physical accuracy, coordinate truth, calibration, scale, completeness, reconstruction fitness, or “HD-ness” merely from intake metadata;
- align sources, create transforms, generate geometry, reconstruct splats, enhance images, or generate cinematic content;
- stage/copy source bytes;
- discover provider credentials, contact RunPod or another provider, upload data, reserve compute, dispatch a job, start training, spend money, or enforce a live cost cap/kill switch;
- sign, publish, promote, release, or alter a production pointer;
- hide generated provenance or convert a generated derivative into captured/metric authority;
- claim a candidate is best when only deterministic planning checks were performed.

## Desktop acceptance checks

Test at 1440×900 and 1024×768 with a real small fixture and bounded synthetic fixtures.

- The fixed safety strip, source basename, current step, primary action, and stop action are visible without ambiguity.
- Keyboard-only use completes every file decision, evidence field, compile, download, and stop action.
- The 500th file remains reachable; a 501+ fixture explains pagination or virtualization without losing paths from the downloaded receipt.
- Unknown, ambiguous, duplicate, and XBIN fixtures show their exact warnings and never expose a bypass.
- A source mutation, symlink, disconnect, invalid token, foreign origin, stale estimate, over-budget route, rights block, capacity block, and digest mismatch each fail closed.
- Editing one upstream decision invalidates both the admission result and plan preview.
- No screen, network response, or downloaded draft contains the absolute source path or session token.
- At 200% zoom, no control overlaps and no meaning requires horizontal page scrolling.

## Mobile acceptance checks

Test at 390×844 and the minimum 320×568 viewport.

- The page has no horizontal scroll, clipped warning, or hidden decision control.
- File cards preserve the same decision and evidence fields as desktop; mobile does not offer a weaker shortcut.
- The sticky action bar does not cover the focused field, validation message, or final file card.
- Touch targets are at least 44 px and controls remain usable with screen magnification.
- Long Unicode paths, 64-character fingerprints, cost breakdowns, and blocker codes wrap without truncating the copyable value.
- A screen reader announces the page heading, file position, decision group, blocker text, measured progress, and download result in a useful order.
- Rotating or resizing preserves unsaved in-memory choices without changing their meaning or silently compiling a draft.

These acceptance checks are requirements for the implementation; this design document does not claim they currently pass.

## Adversarial misuse cases

| Attempt | Required response |
|---|---|
| Rename a hostile or unrelated file to `.e57` | Say “Detected as” with evidence/caveats; never claim valid geometry or safe content. |
| Paste an absolute path or add `?source=` to a local URL | Reject it. The source remains the one fixed at startup. |
| Open the session from another site, host, or computer | Reject host/origin/socket mismatch without leaking the source. |
| Select every file and look for “Approve all” | No such action exists. Every path still needs a draft decision and evidence state. |
| Override a detected type with no evidence | Block draft compilation and request rationale plus an evidence reference. |
| Treat an exact duplicate suggestion as permission to delete | Offer draft exclusion only; never delete or modify either source file. |
| Mark an XBIN payload as directly usable | Reject the admission state; allow only metadata-only or blocked states without proven official access and rights. |
| Record software code as MIT and infer capture/model rights | Keep capture, weights, dataset, training, and redistribution rights separate and unresolved. |
| Label an AI-generated image as an original capture | Reject the incompatible origin fields and require generated provenance plus parent/conditioning assets. |
| Call a recognised E57 “measured truth” | Keep coordinate and accuracy state unknown until units, frame, calibration/control, and provenance evidence exist. |
| Interpret `viable_plan_only` as permission to run | Show “No planning blocker found — nothing is authorized to run”; expose no run control. |
| Interpret a RunPod card as a provider request | State that no provider was contacted and no upload, pod, charge, or kill switch exists. |
| Use an expired estimate or estimate above the cap | Mark the route blocked; do not silently refresh, raise the cap, or choose another route. |
| Change a file decision after a plan was built | Invalidate and hide the stale plan until a new admission result and plan are compiled. |
| Change or disconnect the source during hashing | Issue no receipt and no partial result; report a safe failure. |
| Stop during hashing or compilation | Abort, clear in-memory partial state, leave source files unchanged, and close the session. |
| Tamper with downloaded JSON | Later schema validation must reject digest or path-set mismatch; a downloaded file never gains authority. |
| Share a downloaded receipt | Warn before download that relative names, evidence notes, and fingerprints may be sensitive even though source bytes are absent. |
| Leave the page open after session expiry | Disable server actions, say the private session ended, and never imply autosave. |

## Definition of done for the next implementation

The workflow is ready for implementation handoff only when:

1. every screen state and exact boundary copy above is represented in tests;
2. admission drafts are recompiled against the exact in-memory receipt and retain authority `none`;
3. plan cards are rendered only from a validated `FoundryPlanOnlyDossierV0` bound to the exact manifest;
4. no browser route can accept a source path, command, credential, execution confirmation, approval, or provider mutation;
5. cancellation and expiry leave no partial artifact or source mutation;
6. desktop, mobile, keyboard, zoom, and screen-reader checks pass with the adversarial fixtures; and
7. an independent review finds no wording or control that implies legal approval, physical truth, or execution authority.
