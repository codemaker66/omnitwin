# Grand Hall Difix no-reference input pack

Status: local diagnostic tooling only

Authority: none

Room scope: Trades Hall Grand Hall only

Provider execution: not authorized by this pack

## Purpose

This workflow freezes one direct 1024×576 hardware-WebGL render of the exact
11-member Grand Hall SOG frontier at the inspection-only source-pose-19890
camera. It then creates a no-replace input pack for a future bounded Difix
no-reference diagnostic.

The pack does **not** classify the render as captured-source truth. It does not
accept the room boundary, calibrate an optical camera, run Difix, authorize
generated pixels, replace reconstruction truth, admit a runtime package, stage,
publish, or promote anything.

## Prerequisites

- Use the dedicated `codex/grand-hall-exact-runtime` worktree.
- Commit or otherwise freeze all relevant web/types source changes before the
  capture. The browser harness hashes the full served source state before and
  after rendering and discards the image if that state drifts.
- Build `@omnitwin/types` so the browser harness can hash its exact runtime.
- Use a hardware browser channel. The harness rejects SwiftShader, llvmpipe,
  software rasterizers, unknown renderers, and lost WebGL contexts.
- Choose a new absolute evidence directory and a new absolute pack directory.
  Existing capture files or pack directories are never replaced.

## 1. Produce the direct browser capture

In PowerShell, replace the two operator-chosen directories below. Do not reuse
an earlier output name.

```powershell
$env:GRAND_HALL_LINEAGE_ROOT = 'C:\GRAND_HALL_BIG_MODEL_VARIATIONS'
$env:GRAND_HALL_LINEAGE_EVIDENCE_DIR = 'C:\Users\blake\AppData\Local\Venviewer\grand-hall-difix-capture-<new-run-id>'
$env:GRAND_HALL_LINEAGE_CAPTURE_MODE = 'difix-no-reference-input-1024x576-v1'
$env:E2E_BROWSER_CHANNEL = 'msedge'
pnpm --filter @omnitwin/web exec playwright test e2e/grand-hall-visual-lineage.local.spec.ts --project=chromium --workers=1
```

The explicit mode:

- declares only the SOG test runnable; SPZ and PLY are skipped;
- fixes the viewport/backing canvas to 1024×576 at nominal DPR 1; Chrome's
  observed positive finite DPR is preserved byte-for-byte and may carry less
  than 5×10⁻⁷ absolute floating-point drift from one;
- captures the canvas element with Playwright's element-screenshot operation,
  records the exact method as `playwright_canvas_element_screenshot`, and does
  not claim raw-framebuffer readback or apply a resize;
- persists the observed canvas width/height, DPR, and context-antialias value in
  the browser record and digest-addressed renderer artifact;
- requires `NoToneMapping`, sRGB, antialias off, a settled Spark runtime, all
  6,019,684 active splats, all 11 exact source receipts, and hardware WebGL;
- uses eight post-settle warm-up frames and one observed timing frame;
- preserves the existing start/end git commit, dirty-state, and full served
  source-state drift check; and
- uses exclusive publication so an existing PNG or JSON record stops the run.

Expected capture names:

```text
grand-hall-sog-source-pose-19890-interior-v1-difix-no-reference-input-1024x576-v1.png
grand-hall-sog-source-pose-19890-interior-v1-difix-no-reference-input-1024x576-v1.json
```

Do not accept a run whose browser record says `worktreeDirty: true` without a
specific review of its bound `worktreeSourceStateSha256`. A dirty run remains
diagnostic even though the digest makes its exact source state inspectable.

## 2. Create the authority-none pack

Use the exact two files from step 1 and a new, nonexistent output directory.

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-input-pack -- --capture-png 'C:\absolute\capture.png' --browser-record 'C:\absolute\capture.json' --output 'C:\absolute\new-pack-directory'
```

The writer stable-reads both inputs, fully decodes the PNG, requires exact
non-palette/non-alpha 8-bit unsigned RGB in sRGB, validates every
machine-record binding, rechecks both inputs before and after publication work,
claims a new output directory, writes every member with create-only semantics,
and writes `publication-receipt.json` last. A failed run may leave a partial
directory without a publication receipt; quarantine it and choose a new output
directory. Never delete and reuse it as if it were the same run.

The complete pack contains:

- the byte-identical `source-render.png`;
- the byte-identical `browser-capture-record.json`;
- a 1024×576 one-channel all-white `protected-mask.png`;
- a 1024×576 one-channel all-black `generated-region-mask.png`;
- digest-addressed camera, renderer, reconstruction, and render-generation
  JSON artifacts;
- canonical `manifest.authority-none.json`; and
- receipt-last `publication-receipt.json`.

White in the protected mask means protected source pixel. White in the
generated-region mask would mean a generated region; the shipped mask has zero
such pixels. These masks do not instruct Difix itself to edit or replace source
truth. They bind evaluation and non-destructive lane policy.

## 3. Recheck without writing

```powershell
pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-input-pack -- --check --output 'C:\absolute\new-pack-directory'
```

The check requires the exact receipt inventory and canonical source, record,
protected-mask, generated-mask, camera, renderer, reconstruction,
render-generation, manifest order; hashes every file; fully
decodes the source and both masks, revalidates the browser record and all pinned
camera/renderer/capture-method/SOG/run-window facts, reproduces the bundle digest, parses canonical
artifacts, and confirms every digest-addressed filename.

## Stop conditions

Stop without provider execution if any of the following occurs:

- output already exists;
- either input is relative, a symbolic link or Windows junction, missing,
  malformed, or changes during the stable-read windows; ordinary hardlinked
  files are permitted and remain protected by the stable identity/content
  rereads;
- capture is not a fully decodable single 1024×576 non-palette/non-alpha 8-bit
  unsigned RGB PNG in sRGB;
- browser record screenshot hash, size, dimensions, camera, renderer, source
  member, splat count, runtime stability, git/source state, or run window does
  not match;
- the observed DPR is not positive, finite, nominally one within the exclusive
  5×10⁻⁷ absolute capture tolerance, or is not exactly cross-bound between the
  viewport, structured capture marker, and renderer artifact;
- WebGL renderer is software or unknown;
- any mask is not the exact constant-value image; or
- pack inventory, digest address, canonical JSON, or authority guard fails.

## Remaining authorization boundary

This pack deliberately stops before environment creation, model download,
weight execution, output evaluation, or distillation. A later one-shot local
Difix diagnostic must separately pin the reviewed source/model revisions,
NVIDIA noncommercial terms, isolated WSL environment, exact inference
parameters, output directory, attempt receipt, and evaluation policy. No API
key or Hugging Face token is required for the currently identified public
Difix and `difix_ref` weights, but their license constraints still apply.
