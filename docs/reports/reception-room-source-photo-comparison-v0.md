# Reception Room computer-vision comparison v0

## Plain answer

Yes. The development viewer can now give the computer-vision scorer the exact
image it has just drawn. We proved that handoff with a small artificial 3D
scene. The proof did not use the real Reception photograph or either real
Reception model. (For engineers: the pixels came directly from the live
Spark/Three graphics buffer.)

The browser test loaded no photograph or poster image. Two separate completed
renders produced the same stable pixels, and the viewer rejected a test request
meant for a different page.

The scoring part is built and tested. It measures edges, structure and colour
inside marked parts of the image. It checks the five details that matter:

- timber doors and glazing;
- curtains and windows;
- column and moulding detail;
- floorboards; and
- room depth and fixed small detail.

No real Reception photograph or real Quality/Mobile Reception asset set has
been run through that connection. The real customer-facing app page was not
tested.
Therefore this version has not chosen Quality or Mobile, and it must not be
described as having done so.

Older evidence does exist: six Quality/Mobile JPEG exports and captures from
the older development viewer. They were analysed earlier, but they did not use
this new capture connection and were not matched to an authoritative real
photograph.

## What works now

The local scorer can:

- lock the photograph, camera information, masks, candidate identities and
  comparison rules before scoring;
- compare three repeats of each candidate against the reference photograph;
- measure fine-edge distance, gradient direction, colour error, PSNR, SSIM and
  mean pixel error;
- ignore pixels outside each marked region;
- require all five important room features to agree;
- stop a lead when an ordinary background area clearly gets worse;
- create a randomly labelled A/B review board; and
- keep product selection, physical approval, commercial approval and runtime
  replacement disabled.

The scorer has 38 passing generated-image and provenance tests.

The browser helper has 26 passing tests. They prove strict plan checking,
three fresh generated captures, exact receipt binding, a runner-owned frozen
web build, rejection of a fake or stale local page, and detection of changed
tool bytes even when the package version number stays the same.

The viewer-side capture code has 65 focused passing tests, plus one passing real
browser test with generated Gaussian splats. That browser test uses the actual
Spark/Three rendering path. It proves the mechanism, not the Reception result.

For every requested frame, the capture path now:

1. claims the exact local web address so a fake or old page cannot use it;
2. builds the viewer itself, freezes every served HTML, JavaScript, CSS and
   asset byte in memory, and retains a hash-checkable copy in the run folder;
3. records the exact Node, Vite, Playwright and Chromium file identities;
4. checks the exact candidate, camera, renderer settings and renderer build;
5. checks every active 3D source and its full point count;
6. waits for the view-dependent visible point count to stop changing;
7. reads the presented pixels directly from graphics memory;
8. saves a complete frame record tied to the capture plan and served build;
9. stops if source files, source paths, retained build files or tool files
   change; and
10. stops cleanly after 60 seconds if the renderer produces no completed frame.

## What does not work yet

The development Reception real-component route is wired, but it has not been
exercised with the real Reception candidate files and a permitted source
photograph. The generated browser proof did not test the real customer-facing
app page and does not prove that the real files are available, lawful to use,
correctly matched to the photograph or physically closer to the room.

The stronger held-out physical mode is also deliberately disabled. Its trusted
capture-adapter list is empty. It cannot be enabled merely by filling in a JSON
file; the existing renderer connection must first pass formal independent
review and be explicitly allowed by its exact file hash.

No current file proves:

- that Quality or Mobile is physically closer to the room;
- that a declared right, room state, photo history or camera check is true;
- that a declaration existed before anyone saw the candidate results; or
- that a candidate is commercially safe or ready to replace V5.

The receipts bind an operator's declarations to exact file hashes. That helps
detect later changes, but it is not independent authentication of the facts in
those declarations.

## The two kinds of comparison

### 1. Source-photo diagnostic — available in the scorer

Use this when the photograph may have helped build, tune, align or inspect
either candidate.

It can locate a wrong crop, camera mismatch, blurred detail, edge drift,
ghosting or a large colour difference. It cannot choose Quality or Mobile. The
candidate may already have “seen” the photograph while it was being made.

The protocol name is `source_view_diagnostic`.

Its machine decision always keeps these fields closed:

```text
status = source_view_diagnostic_only
candidateDirectionalLead = empty
productWinner = empty
promotionAuthorized = false
```

### 2. Held-out physical comparison — not available in v0

This future mode is for photographs that were kept completely separate from
both candidates. It requires at least six distinct camera stations, three
physical photo captures at each station, complete candidate-photo histories,
frozen thresholds, all five hero features and a blinded review.

Even after it is enabled, it may report only a directional clue that still
needs human review. It will not grant product, physical or commercial approval.

The protocol name is `heldout_physical_comparison`, but v0 rejects it because
there is no independently approved capture adapter on the trusted list.

## What Blake needs to do

No command is required from Blake now. Copy this form, fill in what is known,
write `unknown` rather than guessing, and give it to the technical operator:

```text
Reception source-photo handoff

1. Original RAW or untouched lossless photograph file or folder:
2. I have permission to use it for an internal comparison: yes / no / unknown
3. It helped build, tune, align or inspect Quality: yes / no / unknown
4. It helped build, tune, align or inspect Mobile: yes / no / unknown
5. Original camera/calibration export file (position, aim and lens settings):
6. Room, doors, curtains and fixed objects were unchanged: yes / no / unknown
7. Quality and Mobile candidate file or folder locations, if known:
8. Getting any required item requires LCC: yes / no / unknown
```

Use these rules:

- If permission is no or unknown, stop.
- If either candidate-history answer is yes or unknown, use only the
  source-photo diagnostic.
- If the camera or unchanged-room answer is no or unknown, pixel scores are not
  assessable until that gap is resolved.
- Do not use a JPEG, screenshot, hand-aligned crop or guessed camera.
- Do not resize, shift, rotate, warp or search for the most flattering crop.
- Do not apply a different colour correction to each candidate.

Do not open LCC or inspect the protected reference folder. If—and only if—a
required file can be obtained only from LCC, Blake must first type exactly
`Resume LCC capture` in this task. This document does not grant that permission.

## What the technical operator needs

For each source-photo view, collect:

- one upright, already-rectified, lossless sRGB PNG;
- the original RAW/source hash and the fixed development recipe;
- an internal-comparison rights declaration;
- image size, focal lengths and principal point in pixels;
- the exact camera transforms, projection, near/far planes and field of view;
- viewport size and device-pixel ratio;
- one unchanged room-state identity;
- masks made before candidate scoring; and
- exact Quality and Mobile asset, profile, renderer and splat-count identities.

These are specialist inputs. Do not ask an average user to invent matrices,
hashes or JSON. If the camera exporter cannot provide them, record the gap and
stop the pixel-matched comparison.

The scorer reads a strict protocol and run package. The repository does not yet
contain a safe point-and-click form that creates those packages. Until that is
built, a technical operator must prepare and independently check them.

## Commands for a technical operator

These commands match the current command-line interface. They are useful only
after a complete source-diagnostic draft or run package has been prepared.
Every output path must be new and its parent folder must already exist. Evidence
paths written inside `draft.json` must be relative paths that stay inside the
comparison bundle. The runner's command-line paths must be absolute.

```powershell
$Repo = 'C:\Users\blake\omnitwin2'
$Bundle = 'D:\Reception-source-photo-comparison'
Set-Location $Repo

python tools/reception-hd/compare_source_photo_renders.py freeze-protocol `
  --draft "$Bundle\draft.json" `
  --output "$Bundle\protocol.json"

python tools/reception-hd/compare_source_photo_renders.py verify-protocol `
  --protocol "$Bundle\protocol.json"
```

The browser helper may verify a complete diagnostic capture plan without
opening a browser:

```powershell
node tools/reception-hd/run_source_photo_capture.mjs `
  --repo-root "$Repo" `
  --protocol "$Bundle\protocol.json" `
  --plan "$Bundle\capture-plan.json" `
  --output-root "$Bundle\capture-run" `
  --verify-only
```

`--verify-only` checks the plan and opens no browser. Remove it only after a
technical operator has prepared and independently checked a complete,
authorized bundle and confirmed the local candidate files are available. The
capture connection is wired, but no such real Reception run has been completed.

For a real browser run, do **not** start Vite or another web server. The capture
helper now builds the viewer itself and must own the plan's `webOrigin`. Make
that value an unused address such as `http://127.0.0.1:4173`. Then run the same
command without `--verify-only`:

```powershell
$Repo = 'C:\Users\blake\omnitwin2'
node tools/reception-hd/run_source_photo_capture.mjs `
  --repo-root "$Repo" `
  --protocol "$Bundle\protocol.json" `
  --plan "$Bundle\capture-plan.json" `
  --output-root "$Bundle\capture-run"
```

The two candidate `assetOrigin` values must also use
`http://127.0.0.1:PORT`, with different ports from the web origin and from each
other. No candidate server needs to be running: the helper reads the exact
hash-checked `localPath` files from the plan and supplies those bytes directly
to the browser. The capture stops if any address, local file, viewer build or
tool identity does not match. Its new output folder retains the copied plan,
the exact served build, a served-page manifest, frame receipts and `run.json`.

If an independently prepared, complete source-diagnostic `run.json` already
exists, score it with:

```powershell
python tools/reception-hd/compare_source_photo_renders.py score `
  --protocol "$Bundle\protocol.json" `
  --run "$Bundle\capture-run\run.json" `
  --output "$Bundle\result.json" `
  --review-board "$Bundle\blind-board.png" `
  --review-template "$Bundle\review-instructions.md" `
  --answer-key "$Bundle\answer-key.json" `
  --review-form "$Bundle\completed-review.json"
```

Keep `answer-key.json` away from the reviewer. The generated review form starts
at “not assessable.” The reviewer must record the real display, viewing distance
and answer for every row. Afterwards, record the review with:

```powershell
python tools/reception-hd/compare_source_photo_renders.py record-review `
  --result "$Bundle\result.json" `
  --review-board "$Bundle\blind-board.png" `
  --answer-key "$Bundle\answer-key.json" `
  --completed-review "$Bundle\completed-review.json" `
  --output "$Bundle\review-receipt.json"
```

## How to read a result

| Mode | Result | Meaning |
|---|---|---|
| Current source diagnostic | `source_view_diagnostic_only` | Useful for finding visible faults. It cannot choose Quality or Mobile. |
| Future held-out mode | `no_stable_machine_signal` | The measurements or important features do not agree strongly enough. |
| Future held-out mode | `context_regression_veto` | One candidate led on all five important features but clearly damaged at least one ordinary context area. |
| Future held-out mode | `unstable_under_normalisation` | The conclusion changes under the one shared colour treatment, so it is unstable. |
| Future held-out mode | `directional_lead_requires_human_review` | All five features agree and no context regression is found. This is still not a winner. |
| Either review path | `review_recorded_gate_open` | The human review tied, was incomplete or was not reliable enough. |
| Current source diagnostic | `review_recorded_source_diagnostic_only` | A source-mode review was recorded, but A/B answers cannot become a candidate preference. |
| Either review path | `review_recorded_no_machine_signal_gate_open` | The human saw a difference but the computer-vision gates did not produce a valid clue. |
| Future held-out mode | `review_recorded_disagreement_gate_open` | The human answer and valid machine clue disagree, so the gate stays open. |
| Future held-out mode | `review_recorded_directional_observation_only` | A blinded reviewer agreed with a valid machine clue. Product and approval gates remain open. |

Every result keeps `productWinner` empty. It never authorizes a V5 replacement,
publication, training, physical truth or commercial use.

Source mode never converts better numbers or A/B review answers into a Quality
or Mobile preference.

## Engineering work still required

1. Run one authorized real Reception source diagnostic through the connected
   development route, using exact candidate files, a permitted lossless source
   photograph and a calibrated matching camera.
2. Add a simple local form that creates the protocol and capture plan without
   asking a person to write complex JSON.
3. Independently review the renderer-owned adapter, bind the review to its
   exact hash and only then add that hash to the held-out trusted list.
4. Keep every source-photo result diagnostic even if one candidate has lower
   error.
5. Only after all earlier gates pass, freeze a separate six-station held-out
   study and perform blinded review.

Until those steps are complete, the accurate statement is: **the computer-
vision scorer and live renderer capture mechanism work on generated tests, no
real Reception source-photo run exists, and there is no physical or product
winner.**
