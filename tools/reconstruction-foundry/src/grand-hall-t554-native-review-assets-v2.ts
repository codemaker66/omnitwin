import {
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
} from "./grand-hall-t554-native-review-http-contract-v2.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_COUNT_V2 = 148;
export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_WIDTH_PX_V2 = 8_192;
export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_HEIGHT_PX_V2 = 4_096;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX_V2 = 256;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX_V2 = 256;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_COLUMN_COUNT_V2 = 32;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_ROW_COUNT_V2 = 16;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_COUNT_V2 = 512;
export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_TILE_BYTE_LENGTH_V2 =
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX_V2 *
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX_V2 *
  3;
export const GRAND_HALL_T554_NATIVE_REVIEW_COUPLED_TILE_BYTE_LENGTH_V2 =
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_TILE_BYTE_LENGTH_V2 +
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX_V2 *
    GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX_V2 *
    2;

export function assertGrandHallT554NativeReviewSourceTileLengthV2(
  byteLength: number,
): void {
  if (byteLength !== GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_TILE_BYTE_LENGTH_V2) {
    throw new Error(
      `Grand Hall source RGB tile must be exactly ${String(GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_TILE_BYTE_LENGTH_V2)} bytes.`,
    );
  }
}

export function assertGrandHallT554NativeReviewCoupledTileLengthV2(
  byteLength: number,
): void {
  if (
    byteLength !== GRAND_HALL_T554_NATIVE_REVIEW_COUPLED_TILE_BYTE_LENGTH_V2
  ) {
    throw new Error(
      `Grand Hall coupled RGB, mask, and reason tile must be exactly ${String(GRAND_HALL_T554_NATIVE_REVIEW_COUPLED_TILE_BYTE_LENGTH_V2)} bytes.`,
    );
  }
}

export const GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2 = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Venviewer — Grand Hall native review</title>
  <link rel="stylesheet" href="${GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet}">
</head>
<body id="app-body" data-review-phase="idle">
  <a class="skip-link" href="#review-workbench">Skip to review workbench</a>
  <header class="app-header">
    <div class="brand-block">
      <span class="brand-mark" aria-hidden="true">V</span>
      <div class="brand-copy">
        <strong>VENVIEWER</strong>
        <span>Trades Hall Glasgow</span>
      </div>
    </div>
    <div class="workbench-identity">
      <strong>GRAND HALL TRUTH WORKBENCH</strong>
      <span>Exact native panorama evidence review</span>
    </div>
    <div class="header-progress" aria-label="Source decision progress">
      <strong id="history-count">0 / 148</strong>
      <span>authority-none decisions recorded</span>
    </div>
    <div class="header-authority">
      <strong>AUTHORITY NONE</strong>
      <span>No acceptance or runtime authority</span>
    </div>
    <div class="session-summary" aria-label="Crash-safe session state">
      <span id="lifecycle-chip" class="chip">Starting</span>
      <span id="revision-label">Workspace revision —</span>
      <span id="epoch-label">Browser epoch —</span>
    </div>
  </header>

  <section class="truth-strip" aria-label="Permanent authority boundary">
    <strong>Exact source pixels</strong>
    <span>Native 8192 × 4096</span>
    <span>No smoothing</span>
    <span>No source-data resampling</span>
    <span>No generated pixels</span>
    <span>Review state: human_pending · final decision: PENDING</span>
  </section>

  <main id="review-workbench" class="workbench" tabindex="-1">
    <aside class="source-panel" aria-labelledby="source-heading">
      <div class="panel-heading">
        <div>
          <p class="section-label">Source review progress</p>
          <h2 id="source-heading">Sources (148)</h2>
        </div>
        <span id="source-filter-count" class="quiet-count">148 shown</span>
      </div>
      <label class="source-search-label" for="source-search">Search sources</label>
      <input id="source-search" class="source-search" type="search" maxlength="80" autocomplete="off" placeholder="Source or sweep number">
      <p class="panel-help"><strong>All human decisions begin UNSURE.</strong> Agent observations never decide membership.</p>
      <ol id="source-list" class="source-list" aria-label="Source panoramas"></ol>
      <div class="source-legend" aria-label="Human decision states">
        <span><i class="status-unsure" aria-hidden="true"></i>UNSURE</span>
        <span><i class="status-recorded" aria-hidden="true"></i>Recorded</span>
      </div>
    </aside>

    <section class="viewer-panel" aria-labelledby="viewer-heading">
      <div class="viewer-toolbar">
        <div>
          <p class="section-label">Exact source</p>
          <h1 id="viewer-heading">Select a source to inspect</h1>
        </div>
        <div class="toolbar-cluster" role="group" aria-label="View controls">
          <button id="zoom-out" type="button" class="quiet-button">Zoom out</button>
          <button id="zoom-native" type="button" class="primary-button">Review at native device scale</button>
          <button id="zoom-in" type="button" class="quiet-button">Zoom in</button>
          <output id="scale-indicator" class="scale-indicator">CSS 12.5% · device 0.125 px/source px</output>
        </div>
      </div>

      <div class="evidence-bar">
        <span id="phase-label">No active source</span>
        <span>Exact RGB8 source</span>
        <span>No generated pixels</span>
        <span>Canvas2D · pixelated rendering</span>
      </div>

      <div id="source-viewport" class="source-viewport mode-pan" tabindex="0" aria-label="Scrollable 8192 by 4096 source panorama">
        <div id="canvas-stage" class="canvas-stage zoom-0125">
          <canvas id="source-canvas" width="8192" height="4096" aria-label="Exact RGB source panorama"></canvas>
          <canvas id="overlay-canvas" width="8192" height="4096" aria-hidden="true"></canvas>
        </div>
      </div>

      <nav class="tile-navigator" aria-label="Systematic tile navigation">
        <strong>Tile navigation</strong>
        <button id="tile-previous" type="button" class="quiet-button">Previous</button>
        <label>Column <input id="tile-column" type="number" min="1" max="32" step="1" value="1"></label>
        <label>Row <input id="tile-row" type="number" min="1" max="16" step="1" value="1"></label>
        <button id="tile-go" type="button" class="quiet-button">Go</button>
        <button id="tile-next" type="button" class="quiet-button">Next</button>
        <span>Alt + arrow keys also move one tile.</span>
      </nav>

      <section class="machine-evidence-rail" aria-label="Machine evidence, separate from human decisions">
        <div>
          <h3>Source</h3>
          <span>Exact source pixels</span>
          <span>Native 8192 × 4096</span>
        </div>
        <div>
          <h3>T561 — observation</h3>
          <span id="active-observation">Agent observation — not a decision</span>
        </div>
        <div>
          <h3>T565 — diagnostic</h3>
          <span>Not exposed by this operator core</span>
        </div>
        <div>
          <h3>Interfaces</h3>
          <span>Not exposed by this operator core</span>
        </div>
      </section>
    </section>

    <aside class="action-panel" aria-labelledby="actions-heading">
      <div class="panel-heading">
        <div>
          <p class="section-label">Source inspector</p>
          <h2 id="actions-heading">Human review gates</h2>
        </div>
      </div>

      <section class="inspector-section source-facts" aria-labelledby="source-facts-heading">
        <h3 id="source-facts-heading">Immutable source facts</h3>
        <dl>
          <div><dt>Source</dt><dd id="source-fact-identity">—</dd></div>
          <div><dt>Dimensions</dt><dd>8192 × 4096</dd></div>
          <div><dt>Format</dt><dd>Exact RGB8 tiles</dd></div>
          <div><dt>Custody</dt><dd id="source-fact-custody">Select a source</dd></div>
        </dl>
      </section>

      <section class="inspector-section human-state" aria-labelledby="human-state-heading">
        <h3 id="human-state-heading">Overall human state</h3>
        <strong id="active-human-decision">Human decision: UNSURE</strong>
        <span>No acceptance or runtime authority</span>
        <span id="source-coverage-label">Source coverage 0 / 512</span>
        <span id="mask-coverage-label">Mask-review coverage not active</span>
        <span id="mask-revision-label">Mask not begun</span>
      </section>

      <section class="inspector-section mask-authoring-section" aria-labelledby="mask-tools-heading">
        <p class="section-label">Exact mask</p>
        <h3 id="mask-tools-heading">Integer source-coordinate tools</h3>
        <div class="segmented-control" role="group" aria-label="Pointer tool">
          <button id="tool-pan" type="button" class="tool-button is-selected" aria-pressed="true">Pan</button>
          <button id="tool-rectangle" type="button" class="tool-button" aria-pressed="false">Rectangle</button>
          <button id="tool-polygon" type="button" class="tool-button" aria-pressed="false">Polygon</button>
        </div>
        <div class="mask-tools">
          <label>Operation
            <select id="mask-operation">
              <option value="exclude">Exclude pixels</option>
              <option value="include">Include pixels</option>
            </select>
          </label>
          <label>Exclusion reason
            <select id="mask-reason">
              <option value="adjacent_room_pixels">Adjacent room pixels</option>
              <option value="portal_beyond_grand_hall_plane">Beyond reviewed interface</option>
              <option value="facade_or_exterior_pixels">Facade or exterior pixels</option>
              <option value="capture_artifact_outside_verified_room">Capture artifact</option>
              <option value="unverified_or_unknown_pixels">Unverified or unknown</option>
            </select>
          </label>
          <label>Rectangle seam
            <select id="rectangle-seam">
              <option value="none">None</option>
              <option value="wrap">Wrap right to left</option>
            </select>
          </label>
          <label>Polygon seam
            <select id="polygon-seam">
              <option value="none">None</option>
              <option value="wrap_shortest">Wrap shortest</option>
            </select>
          </label>
          <div class="polygon-actions">
            <button id="polygon-commit" type="button" class="quiet-button">Apply polygon</button>
            <button id="polygon-clear" type="button" class="quiet-button">Clear points</button>
          </div>
          <output id="polygon-status">0 polygon points</output>
        </div>
        <div class="reason-legend" aria-label="Deterministic exclusion overlay colors">
          <span><i class="reason-one" aria-hidden="true"></i>Adjacent room</span>
          <span><i class="reason-two" aria-hidden="true"></i>Beyond interface</span>
          <span><i class="reason-three" aria-hidden="true"></i>Facade / exterior</span>
          <span><i class="reason-four" aria-hidden="true"></i>Capture artifact</span>
          <span><i class="reason-five" aria-hidden="true"></i>Unverified / unknown</span>
          <span><i class="reason-included" aria-hidden="true"></i>Included: transparent</span>
        </div>
        <button id="mask-freeze" type="button" class="primary-button">Freeze candidate</button>
        <button id="mask-revise" type="button" class="quiet-button">Revise frozen mask</button>
        <p id="mask-revision-warning" class="gate-copy">A frozen candidate remains HUMAN PENDING. Revision requires explicit confirmation.</p>
      </section>

      <section class="inspector-section" aria-labelledby="source-review-actions">
        <h3 id="source-review-actions">Source review</h3>
        <button id="mask-begin" type="button" class="primary-button">Begin INCLUDE mask</button>
        <p class="gate-copy">Source coverage is a navigation aid. The server independently enforces every transition.</p>
      </section>

      <section class="inspector-section" aria-labelledby="attestation-actions">
        <h3 id="attestation-actions">Authority-none human attestation</h3>
        <label>Reviewer identifier
          <input id="reviewer-id" type="text" maxlength="160" autocomplete="off">
        </label>
        <label>Knowledge basis, one item per line
          <textarea id="knowledge-basis" maxlength="7712" rows="4" placeholder="Direct inspection of supplied panorama&#10;Comparison with verified Grand Hall boundary"></textarea>
        </label>
        <button id="source-attest" type="button" class="primary-button">Record authority-none attestation</button>
        <p>This non-cryptographic record grants no reconstruction, runtime, export, or publication authority.</p>
      </section>

      <section class="inspector-section session-actions" aria-labelledby="session-actions-heading">
        <h3 id="session-actions-heading">Session controls</h3>
        <button id="source-abandon" type="button" class="danger-button">Abandon active source</button>
        <button id="session-stop" type="button" class="danger-button">Stop local review session</button>
      </section>
    </aside>
  </main>

  <section class="decision-rail" aria-labelledby="decision-heading">
    <div class="decision-note">
      <p class="section-label">Evidence note · required for INCLUDE or EXCLUDE</p>
      <h2 id="decision-heading">Human decision: UNSURE</h2>
      <textarea id="decision-note" maxlength="1000" rows="3" placeholder="Record concise source-supported evidence for this decision."></textarea>
    </div>
    <label class="classification-control">INCLUDE classification
      <select id="include-classification">
        <option value="grand_hall_core">Grand Hall core</option>
        <option value="grand_hall_portal_threshold">Grand Hall portal threshold</option>
      </select>
    </label>
    <div class="decision-action">
      <button id="source-include" type="button" class="decision-button include-button" aria-describedby="decision-gate-copy">INCLUDE</button>
      <span>Requires frozen mask and complete source + mask coverage</span>
    </div>
    <div class="decision-action">
      <button id="source-exclude" type="button" class="decision-button exclude-button" aria-describedby="decision-gate-copy">EXCLUDE</button>
      <span>Whole-frame decision; explicit confirmation required</span>
    </div>
    <div class="decision-action">
      <button id="source-leave-pending" type="button" class="decision-button unsure-button" aria-describedby="decision-gate-copy">LEAVE UNSURE</button>
      <span>Records no INCLUDE or EXCLUDE decision</span>
    </div>
    <p id="decision-gate-copy" class="decision-gate-copy">Select an exact source. Every decision remains authority-none.</p>
  </section>

  <dialog id="confirmation-dialog" class="confirmation-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-copy">
    <div class="confirmation-boundary">AUTHORITY NONE · HUMAN PENDING</div>
    <h2 id="confirmation-title">Confirm action</h2>
    <p id="confirmation-copy">This action requires explicit confirmation.</p>
    <div class="confirmation-actions">
      <button id="confirmation-cancel" type="button" class="quiet-button">Cancel</button>
      <button id="confirmation-commit" type="button" class="danger-button">Confirm</button>
    </div>
  </dialog>

  <footer class="status-footer">
    <div>
      <strong>No acceptance or runtime authority.</strong>
      <span>Evidence only · crash-safe autosave</span>
    </div>
    <div id="session-status" role="status" aria-live="polite">Starting local review…</div>
    <div id="session-error" role="alert" aria-live="assertive"></div>
  </footer>
  <script src="${GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script}" defer></script>
</body>
</html>
`;

export const GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2 = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #080d11;
  color: #eee7da;
  --ink: #eee7da;
  --muted: #8e9698;
  --line: #293136;
  --panel: #11171b;
  --panel-raised: #151c20;
  --gold: #b88a45;
  --verified: #5f9f6e;
  --pending: #c49042;
  --invalid: #c85a50;
  --diagnostic: #46a7ad;
}

* { box-sizing: border-box; }
html, body { min-height: 100%; margin: 0; }
body { min-width: 320px; background: #080d11; color: var(--ink); }
button, input, select, textarea { font: inherit; }
button, select, input, textarea { color: var(--ink); background: var(--panel-raised); border: 1px solid var(--line); border-radius: 3px; }
button { cursor: pointer; }
button:disabled, input:disabled, select:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.42; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--diagnostic); outline-offset: 2px; }
textarea, input, select { width: 100%; padding: 0.5rem 0.6rem; }
textarea { resize: vertical; }
h1, h2, h3, p { margin-top: 0; }
h1, h2 { letter-spacing: 0.01em; }
h1 { font-size: 1rem; }
h2 { font-size: 0.92rem; }
h3 { margin-bottom: 0.65rem; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.08em; }
output, dd, .header-progress, .header-authority, .session-summary, .evidence-bar, .tile-navigator, .quiet-count { font-variant-numeric: tabular-nums; }

.skip-link { position: fixed; z-index: 100; left: 1rem; top: -5rem; padding: 0.75rem 1rem; background: var(--gold); color: #090b0d; }
.skip-link:focus { top: 1rem; }
.app-header { min-height: 64px; display: grid; grid-template-columns: auto minmax(220px, 1fr) auto auto auto; align-items: center; gap: 1rem; padding: 0.55rem 0.9rem; border-bottom: 1px solid var(--line); background: #080d11; }
.brand-block { display: flex; align-items: center; gap: 0.8rem; }
.brand-copy strong, .brand-copy span, .workbench-identity strong, .workbench-identity span, .header-progress strong, .header-progress span, .header-authority strong, .header-authority span { display: block; }
.brand-copy strong { font-family: Georgia, "Times New Roman", serif; font-size: 1rem; font-weight: 500; letter-spacing: 0.11em; }
.brand-copy span, .workbench-identity span, .header-progress span, .header-authority span { margin-top: 0.18rem; color: var(--muted); font-size: 0.66rem; }
.brand-mark { display: grid !important; place-items: center; width: 34px; height: 38px; border: 1px solid var(--gold); color: var(--gold); font-family: Georgia, serif; }
.workbench-identity { padding-left: 1rem; border-left: 1px solid var(--line); }
.workbench-identity strong { font-family: Georgia, "Times New Roman", serif; font-size: 0.85rem; font-weight: 500; letter-spacing: 0.12em; }
.header-progress strong { font-size: 0.84rem; font-weight: 500; text-align: center; }
.header-authority { padding: 0 1rem; border-right: 1px solid var(--line); border-left: 1px solid var(--line); }
.header-authority strong { color: var(--invalid); font-size: 0.74rem; letter-spacing: 0.1em; }
.session-summary { display: grid; grid-template-columns: auto; justify-items: end; gap: 0.12rem; color: var(--muted); font-size: 0.65rem; }
.chip { padding: 0.2rem 0.45rem; border: 1px solid var(--line); border-radius: 3px; text-transform: uppercase; letter-spacing: 0.08em; }
.chip-active { color: var(--verified); border-color: var(--verified); }
.chip-poisoned { color: var(--ink); border-color: var(--invalid); background: #281312; }
.chip-stopped { color: var(--muted); }
.truth-strip { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem 1.5rem; min-height: 32px; padding: 0.45rem 0.9rem; border-bottom: 1px solid var(--line); background: #0b1115; color: var(--muted); font-size: 0.68rem; }
.truth-strip strong { color: var(--ink); font-weight: 500; }

.workbench { display: grid; grid-template-columns: 260px minmax(520px, 1fr) 330px; min-height: 610px; height: calc(100vh - 273px); border-bottom: 1px solid var(--line); }
.source-panel, .action-panel { min-width: 0; background: var(--panel); }
.source-panel { border-right: 1px solid var(--line); }
.action-panel { border-left: 1px solid var(--line); overflow-y: auto; }
.panel-heading { display: flex; justify-content: space-between; gap: 0.8rem; align-items: flex-start; padding: 0.8rem 0.9rem; border-bottom: 1px solid var(--line); }
.panel-heading h1, .panel-heading h2 { margin-bottom: 0; }
.section-label { margin-bottom: 0.28rem; color: var(--gold); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em; }
.quiet-count { color: var(--muted); font-size: 0.68rem; white-space: nowrap; }
.source-search-label { display: block; padding: 0.65rem 0.8rem 0.3rem; color: var(--muted); font-size: 0.68rem; }
.source-search { width: calc(100% - 1.6rem); margin: 0 0.8rem 0.65rem; }
.panel-help { padding: 0.65rem 0.8rem; margin-bottom: 0; color: var(--muted); font-size: 0.72rem; line-height: 1.45; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.panel-help strong { color: var(--pending); font-weight: 500; }
.source-list { height: calc(100% - 221px); min-height: 300px; margin: 0; overflow-y: auto; padding: 0.4rem; list-style: none; }
.source-item { margin-bottom: 0.25rem; }
.source-row { display: grid; grid-template-columns: 2.3rem minmax(0, 1fr); gap: 0.55rem; width: 100%; padding: 0.55rem; text-align: left; background: #0d1317; border-color: transparent; }
.source-row:hover { border-color: var(--line); }
.source-row.is-active { border-color: var(--gold); background: #17150f; }
.source-row.is-recorded { border-left-color: var(--verified); }
.source-index { color: var(--gold); font-variant-numeric: tabular-nums; }
.source-copy { min-width: 0; }
.source-copy strong, .source-copy span { display: block; overflow-wrap: anywhere; }
.source-copy strong { font-size: 0.75rem; font-weight: 500; }
.source-copy span { margin-top: 0.16rem; color: var(--muted); font-size: 0.65rem; line-height: 1.35; }
.source-copy .human-status { color: var(--pending); }
.source-row.is-recorded .human-status { color: var(--verified); }
.source-empty { padding: 1rem; color: var(--muted); font-size: 0.72rem; }
.source-legend { display: flex; gap: 1rem; align-items: center; min-height: 35px; padding: 0.55rem 0.8rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.65rem; }
.source-legend span { display: inline-flex; gap: 0.35rem; align-items: center; }
.source-legend i { width: 7px; height: 7px; border-radius: 50%; background: var(--pending); }
.source-legend .status-recorded { background: var(--verified); }

.viewer-panel { display: flex; min-width: 0; flex-direction: column; background: #080d11; overflow: hidden; }
.viewer-toolbar { min-height: 62px; display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.65rem 0.8rem; border-bottom: 1px solid var(--line); }
.viewer-toolbar h2 { margin-bottom: 0; }
.toolbar-cluster { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 0.4rem; }
.quiet-button, .primary-button, .danger-button, .tool-button { padding: 0.48rem 0.68rem; }
.primary-button { border-color: var(--gold); background: #251d11; color: var(--ink); }
.danger-button { border-color: var(--invalid); background: #211215; color: var(--ink); }
.scale-indicator { min-width: 12rem; color: var(--muted); font-size: 0.68rem; text-align: right; }
.evidence-bar { display: flex; flex-wrap: wrap; gap: 0.45rem 1.2rem; min-height: 34px; align-items: center; padding: 0.45rem 0.8rem; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.66rem; }
.evidence-bar span:first-child { color: var(--diagnostic); }
.source-viewport { flex: 1 1 auto; min-height: 300px; overflow: auto; overscroll-behavior: contain; background: #030506; }
.source-viewport.mode-pan { cursor: grab; }
.source-viewport.mode-pan.is-panning { cursor: grabbing; }
.source-viewport.mode-edit { cursor: crosshair; }
.canvas-stage { position: relative; transform-origin: 0 0; background: #000; }
.canvas-stage canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; image-rendering: pixelated; }
#overlay-canvas { pointer-events: none; }
.zoom-00625 { width: 512px; height: 256px; }
.zoom-0125 { width: 1024px; height: 512px; }
.zoom-025 { width: 2048px; height: 1024px; }
.zoom-05 { width: 4096px; height: 2048px; }
.zoom-1 { width: 8192px; height: 4096px; }
.zoom-2 { width: 16384px; height: 8192px; }
.zoom-4 { width: 32768px; height: 16384px; }
.tile-navigator { display: flex; align-items: center; flex-wrap: wrap; gap: 0.45rem; padding: 0.55rem 0.8rem; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.68rem; }
.tile-navigator label { display: flex; align-items: center; gap: 0.35rem; }
.tile-navigator input { width: 4.5rem; }
.machine-evidence-rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); min-height: 102px; border-top: 1px solid var(--line); background: #0b1115; }
.machine-evidence-rail > div { min-width: 0; padding: 0.65rem 0.75rem; border-right: 1px solid var(--line); }
.machine-evidence-rail > div:last-child { border-right: 0; }
.machine-evidence-rail h3 { margin-bottom: 0.45rem; color: var(--gold); }
.machine-evidence-rail span { display: block; margin-top: 0.2rem; color: var(--muted); font-size: 0.66rem; line-height: 1.35; }

.inspector-section { padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--line); }
.inspector-section h3 { color: var(--gold); }
.inspector-section label { display: block; margin-top: 0.55rem; color: var(--muted); font-size: 0.68rem; }
.inspector-section button { width: 100%; margin-top: 0.45rem; }
.inspector-section p { margin: 0.55rem 0 0; color: var(--muted); font-size: 0.68rem; line-height: 1.45; }
.source-facts dl { margin: 0; }
.source-facts dl div { display: grid; grid-template-columns: 5.2rem minmax(0, 1fr); gap: 0.5rem; margin-top: 0.45rem; font-size: 0.68rem; }
.source-facts dt { color: var(--muted); }
.source-facts dd { margin: 0; overflow-wrap: anywhere; }
.human-state strong, .human-state span { display: block; }
.human-state strong { color: var(--pending); font-size: 0.74rem; font-weight: 500; }
.human-state span { margin-top: 0.35rem; color: var(--muted); font-size: 0.66rem; }
.mask-tools { display: grid; gap: 0.5rem; margin-top: 0.6rem; }
.mask-tools label { color: var(--muted); font-size: 0.68rem; }
.segmented-control { display: flex; }
.segmented-control button { flex: 1; margin-top: 0; border-radius: 0; }
.segmented-control button:first-child { border-radius: 3px 0 0 3px; }
.segmented-control button:last-child { border-radius: 0 3px 3px 0; }
.tool-button.is-selected { color: #080d11; background: var(--gold); border-color: var(--gold); }
.polygon-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
.polygon-actions button { margin-top: 0; }
.reason-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 0.38rem 0.55rem; margin: 0.7rem 0; color: var(--muted); font-size: 0.63rem; }
.reason-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
.reason-legend i { width: 12px; height: 12px; border: 1px solid #d7dce0; }
.reason-one { background: rgba(255, 91, 76, 0.78); }
.reason-two { background: rgba(255, 183, 3, 0.78); }
.reason-three { background: rgba(160, 103, 245, 0.78); }
.reason-four { background: rgba(0, 194, 255, 0.78); }
.reason-five { background: rgba(235, 64, 122, 0.78); }
.reason-included { background: transparent; }

.gate-copy { color: var(--pending) !important; }
body[data-review-phase="idle"] .mask-authoring-section,
body[data-review-phase="source_review"] .mask-authoring-section,
body[data-review-phase="decision_recorded"] .mask-authoring-section,
body[data-review-phase="human_attested"] .mask-authoring-section { display: none; }

.decision-rail { display: grid; grid-template-columns: minmax(330px, 1.5fr) minmax(180px, 0.55fr) repeat(3, minmax(175px, 0.72fr)); grid-template-rows: auto auto; gap: 0.55rem; min-height: 140px; padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--line); background: #0b1115; }
.decision-note { grid-row: 1 / 3; }
.decision-note h2 { margin-bottom: 0.42rem; }
.decision-note textarea { min-height: 74px; }
.classification-control { grid-row: 1 / 3; color: var(--muted); font-size: 0.68rem; }
.classification-control select { margin-top: 0.4rem; }
.decision-action { display: flex; min-width: 0; flex-direction: column; }
.decision-action span { margin-top: 0.35rem; color: var(--muted); font-size: 0.63rem; line-height: 1.35; text-align: center; }
.decision-button { min-height: 48px; padding: 0.7rem; font-size: 0.73rem; font-weight: 600; letter-spacing: 0.08em; }
.include-button { border-color: var(--verified); background: #132018; }
.exclude-button { border-color: var(--invalid); background: #281312; }
.unsure-button { border-color: var(--pending); background: #241c10; }
.decision-gate-copy { grid-column: 3 / 6; margin: 0; color: var(--pending); font-size: 0.66rem; text-align: center; }

.confirmation-dialog { width: min(520px, calc(100vw - 2rem)); padding: 0; border: 1px solid var(--gold); border-radius: 3px; background: var(--panel-raised); color: var(--ink); }
.confirmation-dialog::backdrop { background: rgba(2, 5, 7, 0.82); }
.confirmation-dialog h2, .confirmation-dialog p, .confirmation-actions { margin: 0; padding: 0.8rem 1rem; }
.confirmation-boundary { padding: 0.55rem 1rem; border-bottom: 1px solid var(--line); color: var(--invalid); font-size: 0.66rem; letter-spacing: 0.1em; }
.confirmation-dialog p { color: var(--muted); font-size: 0.75rem; line-height: 1.5; }
.confirmation-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; border-top: 1px solid var(--line); }

.status-footer { min-height: 37px; display: grid; grid-template-columns: auto 1fr minmax(0, 1fr); gap: 1rem; align-items: center; padding: 0.45rem 0.8rem; background: #080d11; font-size: 0.66rem; }
.status-footer > div:first-child { display: flex; gap: 0.7rem; color: var(--muted); }
.status-footer > div:first-child strong { color: var(--ink); font-weight: 500; }
#session-status { text-align: center; }
#session-error { color: var(--ink); text-align: right; }

@media (max-width: 1360px) {
  .app-header { grid-template-columns: auto minmax(200px, 1fr) auto auto; }
  .header-progress { display: none; }
  .workbench { grid-template-columns: 230px minmax(500px, 1fr) 300px; }
  .decision-rail { grid-template-columns: minmax(300px, 1fr) minmax(170px, 0.45fr) repeat(3, minmax(155px, 0.6fr)); }
}

@media (max-width: 1120px) {
  .app-header { grid-template-columns: auto minmax(200px, 1fr) auto; }
  .header-authority { border-right: 0; }
  .session-summary { display: none; }
  .workbench { height: auto; grid-template-columns: 230px minmax(0, 1fr); }
  .action-panel { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 0; overflow: visible; }
  .action-panel > .panel-heading { grid-column: 1 / -1; }
  .inspector-section { border-right: 1px solid var(--line); }
  .decision-rail { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .decision-note { grid-column: 1 / 3; grid-row: auto; }
  .classification-control { grid-row: auto; }
  .decision-gate-copy { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .app-header { grid-template-columns: 1fr; align-items: start; }
  .workbench-identity, .header-authority { padding: 0.55rem 0 0; border: 0; border-top: 1px solid var(--line); }
  .workbench { display: block; }
  .source-list { height: 240px; min-height: 0; }
  .source-panel { border-right: 0; border-bottom: 1px solid var(--line); }
  .viewer-toolbar { align-items: flex-start; flex-direction: column; }
  .toolbar-cluster { justify-content: flex-start; }
  .scale-indicator { text-align: left; }
  .action-panel { display: block; }
  .machine-evidence-rail { grid-template-columns: 1fr 1fr; }
  .machine-evidence-rail > div:nth-child(2) { border-right: 0; }
  .decision-rail { display: block; }
  .decision-rail > * { margin-bottom: 0.65rem; }
  .status-footer { grid-template-columns: 1fr; }
  .status-footer > div:first-child { display: block; }
  #session-status { text-align: left; }
  #session-error { text-align: left; }
}

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; }
}
`;

export const GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2 = `
(() => {
  "use strict";

  const routes = Object.freeze(${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2)});
  const requestSchemas = Object.freeze(${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2)});
  const responseSchemas = Object.freeze(${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2)});
  const sourceWidth = 8192;
  const sourceHeight = 4096;
  const tileWidth = 256;
  const tileHeight = 256;
  const tileColumns = 32;
  const tileRows = 16;
  const tileCount = 512;
  const sourceTileByteLength = 196608;
  const coupledTileByteLength = 327680;
  const tilePixelCount = 65536;
  const sourcePixelCount = 33554432;
  const maximumPolygonPointCount = 512;
  const sourceTileResponseSchema = responseSchemas.sourceTile;
  const maskTileResponseSchema = responseSchemas.maskTile;
  const bootstrapPattern = /^#bootstrap=([A-Za-z0-9_-]{43})$/;
  const bearerPattern = /^[A-Za-z0-9_-]{43}$/;
  const errorCodePattern = /^[A-Z][A-Z0-9_]{0,127}$/;
  const maskReasons = Object.freeze([
    "adjacent_room_pixels",
    "portal_beyond_grand_hall_plane",
    "facade_or_exterior_pixels",
    "capture_artifact_outside_verified_room",
    "unverified_or_unknown_pixels",
  ]);
  const overlayColors = Object.freeze([
    Object.freeze([255, 91, 76, 199]),
    Object.freeze([255, 183, 3, 199]),
    Object.freeze([160, 103, 245, 199]),
    Object.freeze([0, 194, 255, 199]),
    Object.freeze([235, 64, 122, 199]),
  ]);
  const zoomScales = Object.freeze([0.0625, 0.125, 0.25, 0.5, 1, 2, 4]);
  const zoomClasses = Object.freeze(["zoom-00625", "zoom-0125", "zoom-025", "zoom-05", "zoom-1", "zoom-2", "zoom-4"]);
  const apiPaths = new Set([
    routes.state,
    routes.sourceSelect,
    routes.sourceTile,
    routes.sourceCoverage,
    routes.sourceExclude,
    routes.sourceLeavePending,
    routes.maskBegin,
    routes.maskEdit,
    routes.maskTile,
    routes.maskFreeze,
    routes.maskReviewTile,
    routes.maskReviewCoverage,
    routes.sourceInclude,
    routes.sourceAttest,
    routes.sourceAbandon,
    routes.sessionStop,
  ]);

  let bearer = null;
  let operatorState = null;
  let mutationInFlight = false;
  let coverageInFlight = false;
  let tileLoadController = null;
  let tileLoadPromise = null;
  let installedRenderKey = null;
  let paintedTiles = new Map();
  let maskReviewCoverageComplete = false;
  let maskReviewCoverageGeneration = null;
  let maskReviewDeliveredTileCount = 0;
  let maskReviewCompletedTileCount = 0;
  let zoomIndex = 1;
  let pointerMode = "pan";
  let pointerStart = null;
  let polygonPoints = [];
  let sourceFilterQuery = "";
  let sourceListRenderKey = null;
  let frozenRevisionArm = null;
  let confirmationResolver = null;

  function requireElement(id) {
    const element = document.getElementById(id);
    if (element === null) throw new Error("Required review control is unavailable.");
    return element;
  }

  const sourceList = requireElement("source-list");
  const sourceViewport = requireElement("source-viewport");
  const canvasStage = requireElement("canvas-stage");
  const sourceCanvas = requireElement("source-canvas");
  const overlayCanvas = requireElement("overlay-canvas");
  const sourceContext = sourceCanvas.getContext("2d", { alpha: false });
  const overlayContext = overlayCanvas.getContext("2d", { alpha: true });
  if (sourceContext === null || overlayContext === null) {
    throw new Error("Canvas2D is required for exact native review.");
  }
  sourceContext.imageSmoothingEnabled = false;
  overlayContext.imageSmoothingEnabled = false;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasExactKeys(value, expectedKeys, label) {
    if (!isRecord(value)) throw new Error(label + " must be an object.");
    const actual = Object.keys(value).sort();
    const expected = Array.from(expectedKeys).sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new Error(label + " has an unexpected public field shape.");
    }
  }

  function isSafeNonnegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isSafePositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function requireLiteral(value, literal, label) {
    if (value !== literal) throw new Error(label + " is invalid.");
  }

  function validateRecordedDecision(value, label) {
    hasExactKeys(value, ["classification", "result"], label);
    if (value.result === "EXCLUDE") {
      requireLiteral(value.classification, "no_observed_grand_hall_pixels", label + " classification");
      return;
    }
    if (value.result === "INCLUDE") {
      if (value.classification !== "grand_hall_core" && value.classification !== "grand_hall_portal_threshold") {
        throw new Error(label + " classification is invalid.");
      }
      return;
    }
    throw new Error(label + " result is invalid.");
  }

  function sameDecision(left, right) {
    return left !== null && right !== null && left.result === right.result && left.classification === right.classification;
  }

  function validateAuthorityNoneRecord(value, label) {
    if (!isRecord(value) || typeof value.state !== "string") throw new Error(label + " is invalid.");
    if (value.state === "no_recorded_decision") {
      hasExactKeys(value, ["state"], label);
      return;
    }
    if (value.state === "decision_recorded") {
      hasExactKeys(value, ["attestation", "decision", "state"], label);
      requireLiteral(value.attestation, "not_recorded", label + " attestation");
      validateRecordedDecision(value.decision, label + " decision");
      return;
    }
    if (value.state === "authority_none_attestation_recorded") {
      hasExactKeys(value, ["attestation", "decision", "state"], label);
      requireLiteral(value.attestation, "not_cryptographic", label + " attestation");
      validateRecordedDecision(value.decision, label + " decision");
      return;
    }
    throw new Error(label + " state is invalid.");
  }

  function validateAgentObservation(value, label) {
    hasExactKeys(value, ["maskAuthoringState", "proposedDisposition", "state"], label);
    if (value.state === "grand_hall_pixels_observed_human_pending") {
      requireLiteral(value.proposedDisposition, "include_with_binary_pixel_mask", label + " proposed disposition");
      requireLiteral(value.maskAuthoringState, "required_not_authored", label + " mask authoring state");
      return;
    }
    if (value.state === "no_grand_hall_pixels_observed_human_pending") {
      requireLiteral(value.proposedDisposition, "exclude_whole_frame", label + " proposed disposition");
      requireLiteral(value.maskAuthoringState, "not_required_if_human_confirms_exclusion", label + " mask authoring state");
      return;
    }
    throw new Error(label + " state is invalid.");
  }

  function validateSourceCatalogEntry(value, index) {
    const label = "Source catalog entry " + String(index);
    hasExactKeys(value, ["agentObservation", "authorityNoneRecord", "inventoryIndex", "sweepNumber"], label);
    if (value.inventoryIndex !== index || !isSafePositiveInteger(value.sweepNumber)) {
      throw new Error(label + " identity is invalid.");
    }
    validateAgentObservation(value.agentObservation, label + " agent observation");
    validateAuthorityNoneRecord(value.authorityNoneRecord, label + " authority-none record");
  }

  function validateCoverageSummary(value, label) {
    hasExactKeys(value, ["complete", "completedTileCount", "totalTileCount"], label);
    if (!isSafeNonnegativeInteger(value.completedTileCount) || value.completedTileCount > tileCount) {
      throw new Error(label + " completed count is invalid.");
    }
    requireLiteral(value.totalTileCount, tileCount, label + " total count");
    if (typeof value.complete !== "boolean" || value.complete !== (value.completedTileCount === tileCount)) {
      throw new Error(label + " completion state is invalid.");
    }
  }

  function validateMaskSummary(value, phase, decision) {
    if (value === null) {
      if (phase === "mask_edit" || phase === "mask_review" || (decision !== null && decision.result === "INCLUDE")) {
        throw new Error("Active source mask is missing.");
      }
      return;
    }
    if (decision !== null && decision.result === "EXCLUDE") {
      throw new Error("Whole-frame EXCLUDE decision cannot expose a current pixel mask.");
    }
    hasExactKeys(value, ["excludedPixelCount", "frozen", "includedPixelCount", "revision"], "Active source mask");
    if (!isSafeNonnegativeInteger(value.revision) || value.revision > 4095 ||
        !isSafeNonnegativeInteger(value.includedPixelCount) ||
        !isSafeNonnegativeInteger(value.excludedPixelCount) ||
        value.includedPixelCount + value.excludedPixelCount !== sourcePixelCount ||
        typeof value.frozen !== "boolean") {
      throw new Error("Active source mask is invalid.");
    }
    if (phase === "mask_edit" && value.frozen) throw new Error("Editable mask cannot be frozen.");
    if ((phase === "mask_review" || (decision !== null && decision.result === "INCLUDE")) && !value.frozen) {
      throw new Error("Reviewed INCLUDE mask must be frozen.");
    }
  }

  function validateActiveSource(value, sources) {
    if (value === null) return;
    hasExactKeys(value, ["decision", "humanAttested", "inventoryIndex", "mask", "phase", "renderGeneration", "sourceCoverage", "sweepNumber"], "Active source");
    if (!isSafeNonnegativeInteger(value.inventoryIndex) || value.inventoryIndex >= 148 ||
        !isSafePositiveInteger(value.sweepNumber) || !isSafePositiveInteger(value.renderGeneration) ||
        sources[value.inventoryIndex].sweepNumber !== value.sweepNumber) {
      throw new Error("Active source identity is invalid.");
    }
    if (!["source_review", "mask_edit", "mask_review", "decision_recorded", "human_attested"].includes(value.phase)) {
      throw new Error("Active source phase is invalid.");
    }
    validateCoverageSummary(value.sourceCoverage, "Active source coverage");
    if (value.decision !== null) validateRecordedDecision(value.decision, "Active source decision");
    if (typeof value.humanAttested !== "boolean") throw new Error("Active source attestation state is invalid.");
    if (["source_review", "mask_edit", "mask_review"].includes(value.phase) && (value.decision !== null || value.humanAttested)) {
      throw new Error("Nonterminal active source cannot carry a current decision or attestation.");
    }
    if (value.phase === "decision_recorded" && (value.decision === null || value.humanAttested)) {
      throw new Error("Decision-recorded phase is inconsistent.");
    }
    if (value.phase === "human_attested" && (value.decision === null || !value.humanAttested)) {
      throw new Error("Human-attested phase is inconsistent.");
    }
    validateMaskSummary(value.mask, value.phase, value.decision);
    if (value.phase === "source_review" && value.mask !== null) throw new Error("Source-review phase cannot expose a current mask.");
    if (value.decision !== null) {
      const record = sources[value.inventoryIndex].authorityNoneRecord;
      if (record.state === "no_recorded_decision" || !sameDecision(record.decision, value.decision)) {
        throw new Error("Active decision does not match durable authority-none history.");
      }
      if (value.humanAttested !== (record.state === "authority_none_attestation_recorded")) {
        throw new Error("Active attestation does not match durable authority-none history.");
      }
    }
  }

  function validateOperatorState(value) {
    hasExactKeys(value, [
      "acceptanceAuthorized", "activeSource", "authority", "browserEpochNumber",
      "exportAuthorized", "finalDecision", "generatedContentAuthorized", "lifecycle",
      "maximumAllocatedRenderGeneration", "reconstructionAuthorized", "reviewState",
      "runtimeAuthorized", "schemaVersion", "sources", "workspaceRevision",
    ], "Operator state");
    requireLiteral(value.schemaVersion, responseSchemas.operatorState, "Operator state schema");
    if (!["active", "poisoned", "stopped"].includes(value.lifecycle) ||
        !isSafePositiveInteger(value.browserEpochNumber) ||
        !isSafeNonnegativeInteger(value.workspaceRevision) ||
        !isSafeNonnegativeInteger(value.maximumAllocatedRenderGeneration) ||
        !Array.isArray(value.sources) || value.sources.length !== 148) {
      throw new Error("Operator state public values are invalid.");
    }
    value.sources.forEach(validateSourceCatalogEntry);
    validateActiveSource(value.activeSource, value.sources);
    if (value.activeSource !== null && value.maximumAllocatedRenderGeneration < value.activeSource.renderGeneration) {
      throw new Error("Maximum render generation is inconsistent.");
    }
    if (value.lifecycle === "stopped" && value.activeSource !== null) throw new Error("Stopped state cannot retain an active source.");
    requireLiteral(value.authority, "none", "Operator authority");
    requireLiteral(value.reviewState, "human_pending", "Operator review state");
    requireLiteral(value.finalDecision, "PENDING", "Operator final decision");
    requireLiteral(value.acceptanceAuthorized, false, "Operator gate");
    requireLiteral(value.reconstructionAuthorized, false, "Reconstruction gate");
    requireLiteral(value.runtimeAuthorized, false, "Runtime gate");
    requireLiteral(value.exportAuthorized, false, "Export gate");
    requireLiteral(value.generatedContentAuthorized, false, "Generated-content gate");
    return value;
  }

  function validateBootstrapResponse(value) {
    hasExactKeys(value, ["bearerToken", "schemaVersion"], "Bootstrap response");
    requireLiteral(value.schemaVersion, responseSchemas.bootstrap, "Bootstrap response schema");
    if (typeof value.bearerToken !== "string" || !bearerPattern.test(value.bearerToken)) {
      throw new Error("Bootstrap bearer token is invalid.");
    }
    return value;
  }

  function validateErrorResponse(value) {
    hasExactKeys(value, ["error", "schemaVersion"], "Error response");
    requireLiteral(value.schemaVersion, responseSchemas.error, "Error response schema");
    if (typeof value.error !== "string" || !errorCodePattern.test(value.error)) {
      throw new Error("Error response code is invalid.");
    }
    return value;
  }

  function validateSourceCoverageAcknowledgement(value) {
    hasExactKeys(value, ["complete", "completedTileCount", "schemaVersion", "sequence"], "Source coverage response");
    requireLiteral(value.schemaVersion, responseSchemas.sourceCoverage, "Source coverage response schema");
    if (!isSafePositiveInteger(value.sequence) || !isSafeNonnegativeInteger(value.completedTileCount) ||
        value.completedTileCount > tileCount || typeof value.complete !== "boolean" ||
        value.complete !== (value.completedTileCount === tileCount)) {
      throw new Error("Source coverage response is invalid.");
    }
    return value;
  }

  function validateMaskCoverageAcknowledgement(value) {
    hasExactKeys(value, ["complete", "completedTileCount", "deliveredTileCount", "schemaVersion", "sequence"], "Mask-review coverage response");
    requireLiteral(value.schemaVersion, responseSchemas.maskCoverage, "Mask-review coverage response schema");
    if (!isSafePositiveInteger(value.sequence) || !isSafeNonnegativeInteger(value.deliveredTileCount) ||
        value.deliveredTileCount > tileCount || !isSafeNonnegativeInteger(value.completedTileCount) ||
        value.completedTileCount > tileCount || value.completedTileCount > value.deliveredTileCount ||
        typeof value.complete !== "boolean" || value.complete !== (value.completedTileCount === tileCount)) {
      throw new Error("Mask-review coverage response is invalid.");
    }
    return value;
  }

  function responseHasJsonContentType(response) {
    const contentType = response.headers.get("Content-Type");
    return contentType === "application/json" || contentType === "application/json; charset=utf-8";
  }

  async function readFailure(response) {
    if (!responseHasJsonContentType(response)) throw new Error("Local API returned a non-JSON failure.");
    const errorDto = validateErrorResponse(await response.json());
    throw new Error("Local review request failed: " + errorDto.error + ".");
  }

  async function exchangeBootstrapOnce() {
    const fragment = window.location.hash;
    window.history.replaceState(null, document.title, window.location.pathname);
    const match = bootstrapPattern.exec(fragment);
    if (match === null || match[1] === undefined) {
      throw new Error("A single exact local bootstrap fragment is required.");
    }
    const bootstrapSecret = match[1];
    const response = await fetch(routes.bootstrap, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: Object.freeze({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        schemaVersion: requestSchemas.bootstrap,
        bootstrapToken: bootstrapSecret,
      }),
    });
    if (!response.ok) await readFailure(response);
    if (!responseHasJsonContentType(response)) throw new Error("Bootstrap response content type is invalid.");
    const dto = validateBootstrapResponse(await response.json());
    bearer = dto.bearerToken;
  }

  function authorizedRequestOptions(body, accept, signal) {
    if (bearer === null) throw new Error("Local review session is not bootstrapped.");
    return {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: Object.freeze({
        Accept: accept,
        Authorization: "Bearer " + bearer,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(body),
      signal: signal,
    };
  }

  async function apiJson(path, body, validator) {
    if (!apiPaths.has(path)) throw new Error("Local API path is not allowlisted.");
    const response = await fetch(path, authorizedRequestOptions(body, "application/json", undefined));
    if (!response.ok) await readFailure(response);
    if (!responseHasJsonContentType(response)) throw new Error("Local API response content type is invalid.");
    return validator(await response.json());
  }

  function requireBinaryHeader(response, name, expected) {
    if (response.headers.get(name) !== expected) throw new Error("Binary tile response header " + name + " is invalid.");
  }

  async function apiBinaryTile(path, body, expectedKind, signal) {
    if (!apiPaths.has(path)) throw new Error("Local tile path is not allowlisted.");
    const response = await fetch(path, authorizedRequestOptions(body, "application/octet-stream", signal));
    if (!response.ok) await readFailure(response);
    requireBinaryHeader(response, "Content-Type", "application/octet-stream");
    requireBinaryHeader(response, "X-Venviewer-Tile-Width", "256");
    requireBinaryHeader(response, "X-Venviewer-Tile-Height", "256");
    if (response.headers.get("Content-Encoding") !== null) throw new Error("Binary tile response must not be content encoded.");
    if (expectedKind === "source") {
      requireBinaryHeader(response, "X-Venviewer-Schema-Version", sourceTileResponseSchema);
      requireBinaryHeader(response, "X-Venviewer-Render-Mode", "source_rgb8");
    } else {
      requireBinaryHeader(response, "X-Venviewer-Schema-Version", maskTileResponseSchema);
      requireBinaryHeader(response, "X-Venviewer-Render-Mode", "source_rgb8_mask8_reason8");
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  function createRgbaImageData(context, rgbBytes) {
    const imageData = context.createImageData(tileWidth, tileHeight);
    for (let pixelIndex = 0; pixelIndex < tilePixelCount; pixelIndex += 1) {
      const rgbOffset = pixelIndex * 3;
      const rgbaOffset = pixelIndex * 4;
      imageData.data[rgbaOffset] = rgbBytes[rgbOffset];
      imageData.data[rgbaOffset + 1] = rgbBytes[rgbOffset + 1];
      imageData.data[rgbaOffset + 2] = rgbBytes[rgbOffset + 2];
      imageData.data[rgbaOffset + 3] = 255;
    }
    return imageData;
  }

  function decodeSourceTile(raw) {
    if (raw.byteLength !== sourceTileByteLength) throw new Error("Source tile is not exactly 196608 bytes.");
    return createRgbaImageData(sourceContext, raw);
  }

  function decodeCoupledTile(raw) {
    if (raw.byteLength !== coupledTileByteLength) throw new Error("Coupled tile is not exactly 327680 bytes.");
    const rgb = raw.subarray(0, sourceTileByteLength);
    const maskOffset = sourceTileByteLength;
    const reasonOffset = sourceTileByteLength + tilePixelCount;
    const overlayImageData = overlayContext.createImageData(tileWidth, tileHeight);
    for (let pixelIndex = 0; pixelIndex < tilePixelCount; pixelIndex += 1) {
      const maskSample = raw[maskOffset + pixelIndex];
      const reasonSample = raw[reasonOffset + pixelIndex];
      const includedPair = maskSample === 0 && reasonSample === 0;
      const excludedPair = maskSample === 255 && reasonSample >= 1 && reasonSample <= 5;
      if (!includedPair && !excludedPair) throw new Error("Coupled tile contains an invalid mask and reason pair.");
      const rgbaOffset = pixelIndex * 4;
      if (includedPair) {
        overlayImageData.data[rgbaOffset] = 0;
        overlayImageData.data[rgbaOffset + 1] = 0;
        overlayImageData.data[rgbaOffset + 2] = 0;
        overlayImageData.data[rgbaOffset + 3] = 0;
      } else {
        const color = overlayColors[reasonSample - 1];
        overlayImageData.data[rgbaOffset] = color[0];
        overlayImageData.data[rgbaOffset + 1] = color[1];
        overlayImageData.data[rgbaOffset + 2] = color[2];
        overlayImageData.data[rgbaOffset + 3] = color[3];
      }
    }
    return {
      sourceImageData: createRgbaImageData(sourceContext, rgb),
      overlayImageData: overlayImageData,
    };
  }

  function setStatus(message) {
    requireElement("session-status").textContent = message;
  }

  function clearError() {
    requireElement("session-error").textContent = "";
  }

  function showFailure(error) {
    const message = error instanceof Error ? error.message : "Local review operation failed.";
    requireElement("session-error").textContent = message;
  }

  function abortError() {
    const error = new Error("Tile load aborted.");
    error.name = "AbortError";
    return error;
  }

  function isAbortError(error) {
    return isRecord(error) && error.name === "AbortError";
  }

  function activeRenderKey(state) {
    if (state.activeSource === null) return null;
    const active = state.activeSource;
    const maskRevision = active.mask === null ? "none" : String(active.mask.revision);
    return String(state.browserEpochNumber) + ":" + String(active.renderGeneration) + ":" + active.phase + ":" + maskRevision;
  }

  function clearRenderState() {
    sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
    overlayContext.clearRect(0, 0, sourceWidth, sourceHeight);
    sourceContext.imageSmoothingEnabled = false;
    overlayContext.imageSmoothingEnabled = false;
    paintedTiles = new Map();
    maskReviewCoverageComplete = false;
    maskReviewCoverageGeneration = null;
    maskReviewDeliveredTileCount = 0;
    maskReviewCompletedTileCount = 0;
    pointerStart = null;
    polygonPoints = [];
    for (const id of ["decision-note", "reviewer-id", "knowledge-basis"]) {
      requireElement(id).value = "";
    }
    renderPolygonStatus();
  }

  function paintedTileKey(column, row) {
    return String(row * tileColumns + column);
  }

  function paintedTileArray() {
    return Array.from(paintedTiles.values()).sort((left, right) => left.row - right.row || left.column - right.column);
  }

  function tileRequestFor(active, column, row, mode) {
    if (mode === "source") {
      return {
        path: routes.sourceTile,
        body: {
          schemaVersion: requestSchemas.sourceTile,
          expectedBrowserEpochNumber: operatorState.browserEpochNumber,
          renderGeneration: active.renderGeneration,
          column: column,
          row: row,
        },
      };
    }
    if (mode === "mask_edit") {
      return {
        path: routes.maskTile,
        body: {
          schemaVersion: requestSchemas.maskTile,
          expectedBrowserEpochNumber: operatorState.browserEpochNumber,
          renderGeneration: active.renderGeneration,
          column: column,
          row: row,
        },
      };
    }
    return {
      path: routes.maskReviewTile,
      body: {
        schemaVersion: requestSchemas.maskReviewTile,
        expectedBrowserEpochNumber: operatorState.browserEpochNumber,
        renderGeneration: active.renderGeneration,
        column: column,
        row: row,
      },
    };
  }

  async function loadAndPaintTile(active, column, row, mode, renderKey, signal) {
    const request = tileRequestFor(active, column, row, mode);
    const raw = await apiBinaryTile(request.path, request.body, mode === "source" ? "source" : "coupled", signal);
    if (signal.aborted || operatorState === null || activeRenderKey(operatorState) !== renderKey) throw abortError();
    const integerX = column * tileWidth;
    const integerY = row * tileHeight;
    if (mode === "source") {
      const sourceImageData = decodeSourceTile(raw);
      if (signal.aborted || operatorState === null || activeRenderKey(operatorState) !== renderKey) throw abortError();
      sourceContext.putImageData(sourceImageData, integerX, integerY);
    } else {
      const decoded = decodeCoupledTile(raw);
      if (signal.aborted || operatorState === null || activeRenderKey(operatorState) !== renderKey) throw abortError();
      sourceContext.putImageData(decoded.sourceImageData, integerX, integerY);
      overlayContext.putImageData(decoded.overlayImageData, integerX, integerY);
    }
    if (signal.aborted || operatorState === null || activeRenderKey(operatorState) !== renderKey) throw abortError();
    paintedTiles.set(paintedTileKey(column, row), Object.freeze({ column: column, row: row }));
  }

  async function loadRenderTiles(active, mode, renderKey, signal) {
    let nextTileIndex = 0;
    let firstError = null;
    const worker = async () => {
      while (!signal.aborted) {
        const tileIndex = nextTileIndex;
        nextTileIndex += 1;
        if (tileIndex >= tileCount) return;
        const column = tileIndex % tileColumns;
        const row = Math.floor(tileIndex / tileColumns);
        try {
          await loadAndPaintTile(active, column, row, mode, renderKey, signal);
        } catch (error) {
          if (!isAbortError(error) && firstError === null) firstError = error;
          if (!signal.aborted) tileLoadController.abort();
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    if (firstError !== null) throw firstError;
  }

  function startTileLoad(active, mode, renderKey) {
    const controller = new AbortController();
    tileLoadController = controller;
    const pending = loadRenderTiles(active, mode, renderKey, controller.signal)
      .catch((error) => {
        if (!isAbortError(error)) showFailure(error);
      })
      .finally(() => {
        if (tileLoadController === controller) tileLoadController = null;
        if (tileLoadPromise === pending) tileLoadPromise = null;
        renderOperatorState();
      });
    tileLoadPromise = pending;
  }

  async function abortAndDrainTileLoad() {
    const controller = tileLoadController;
    const pending = tileLoadPromise;
    if (controller !== null) controller.abort();
    if (pending !== null) await pending;
    if (tileLoadController === controller) tileLoadController = null;
    if (tileLoadPromise === pending) tileLoadPromise = null;
  }

  function observationCopy(observation) {
    return observation.state === "grand_hall_pixels_observed_human_pending"
      ? "Agent saw possible Grand Hall pixels · proposed mask · human pending"
      : "Agent saw no Grand Hall pixels · proposed whole-frame exclusion · human pending";
  }

  function historyCopy(record) {
    if (record.state === "no_recorded_decision") return "Human decision: UNSURE";
    const decision = record.decision.result + " · " + record.decision.classification;
    return record.state === "authority_none_attestation_recorded"
      ? decision + " · authority-none attestation"
      : decision + " · attestation not recorded";
  }

  function setControlDisabled(id, disabled) {
    requireElement(id).disabled = disabled;
  }

  function sourceMatchesFilter(source) {
    if (sourceFilterQuery.length === 0) return true;
    return (
      String(source.inventoryIndex + 1).includes(sourceFilterQuery) ||
      String(source.sweepNumber).includes(sourceFilterQuery) ||
      historyCopy(source.authorityNoneRecord).toLowerCase().includes(sourceFilterQuery)
    );
  }

  function sourceListStateKey() {
    if (operatorState === null) return "empty";
    const activeIndex = operatorState.activeSource === null ? "none" : String(operatorState.activeSource.inventoryIndex);
    const confirmationState = confirmationResolver === null ? "idle" : "confirming";
    const mutationState = mutationInFlight ? "mutating" : "stable";
    const decisions = operatorState.sources.map((source) => historyCopy(source.authorityNoneRecord)).join("|");
    return operatorState.lifecycle + ":" + activeIndex + ":" + confirmationState + ":" + mutationState + ":" + sourceFilterQuery + ":" + decisions;
  }

  function renderSourceList() {
    const nextRenderKey = sourceListStateKey();
    if (sourceListRenderKey === nextRenderKey) return;
    const retainedScrollTop = sourceList.scrollTop;
    const focusedElement = document.activeElement;
    const focusedSourceIndex = focusedElement !== null && focusedElement !== undefined && typeof focusedElement.getAttribute === "function"
      ? focusedElement.getAttribute("data-source-index")
      : null;
    sourceList.replaceChildren();
    sourceListRenderKey = nextRenderKey;
    if (operatorState === null) return;
    let recordedCount = 0;
    let shownCount = 0;
    for (const source of operatorState.sources) {
      if (source.authorityNoneRecord.state !== "no_recorded_decision") recordedCount += 1;
      if (!sourceMatchesFilter(source)) continue;
      shownCount += 1;
      const item = document.createElement("li");
      item.className = "source-item";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "source-row";
      row.setAttribute("data-source-index", String(source.inventoryIndex));
      const isActive = operatorState.activeSource !== null && operatorState.activeSource.inventoryIndex === source.inventoryIndex;
      if (isActive) {
        row.classList.add("is-active");
        row.setAttribute("aria-current", "true");
      }
      if (source.authorityNoneRecord.state !== "no_recorded_decision") row.classList.add("is-recorded");
      row.disabled = operatorState.lifecycle !== "active" || mutationInFlight || confirmationResolver !== null;
      const index = document.createElement("span");
      index.className = "source-index";
      index.textContent = String(source.inventoryIndex + 1).padStart(3, "0");
      const copy = document.createElement("span");
      copy.className = "source-copy";
      const title = document.createElement("strong");
      title.textContent = "Sweep " + String(source.sweepNumber);
      const history = document.createElement("span");
      history.className = "human-status";
      history.textContent = historyCopy(source.authorityNoneRecord);
      copy.append(title, history);
      row.append(index, copy);
      row.addEventListener("click", () => {
        void selectSource(source.inventoryIndex).catch(showFailure);
      });
      item.append(row);
      sourceList.append(item);
    }
    if (shownCount === 0) {
      const empty = document.createElement("li");
      empty.className = "source-empty";
      empty.textContent = "No sources match this local filter.";
      sourceList.append(empty);
    }
    sourceList.scrollTop = retainedScrollTop;
    if (focusedSourceIndex !== null) {
      for (const item of sourceList.children) {
        const candidate = item.children[0];
        if (candidate !== undefined && typeof candidate.getAttribute === "function" &&
            candidate.getAttribute("data-source-index") === focusedSourceIndex && typeof candidate.focus === "function") {
          candidate.focus();
          break;
        }
      }
    }
    requireElement("history-count").textContent = String(recordedCount) + " / 148";
    requireElement("source-filter-count").textContent = String(shownCount) + " shown";
  }

  function updateSourceFilter() {
    const raw = requireElement("source-search").value.trim().toLowerCase();
    sourceFilterQuery = raw.slice(0, 80);
    sourceListRenderKey = null;
    renderSourceList();
  }

  function renderLifecycle() {
    const chip = requireElement("lifecycle-chip");
    if (operatorState === null) {
      chip.textContent = "Starting";
      chip.className = "chip";
      return;
    }
    chip.textContent = operatorState.lifecycle;
    chip.className = "chip chip-" + operatorState.lifecycle;
    requireElement("revision-label").textContent = "Workspace revision " + String(operatorState.workspaceRevision);
    requireElement("epoch-label").textContent = "Browser epoch " + String(operatorState.browserEpochNumber);
  }

  function revisionArmMatches(active) {
    return (
      frozenRevisionArm !== null &&
      active.phase === "mask_review" &&
      active.mask !== null &&
      active.mask.frozen &&
      frozenRevisionArm.inventoryIndex === active.inventoryIndex &&
      frozenRevisionArm.renderGeneration === active.renderGeneration &&
      frozenRevisionArm.maskRevision === active.mask.revision
    );
  }

  function confirmationDetails(kind, active) {
    const sourceIdentity = "Source " + String(active.inventoryIndex + 1) + " · Sweep " + String(active.sweepNumber) + ". ";
    if (kind === "EXCLUDE") {
      return {
        title: "Confirm irreversible EXCLUDE",
        copy: sourceIdentity + "This writes an irreversible authority-none whole-frame EXCLUDE decision. It records no acceptance and grants no reconstruction, runtime, staging, or production authority.",
        commit: "Confirm EXCLUDE",
        className: "danger-button",
      };
    }
    if (kind === "INCLUDE") {
      if (active.mask === null || !active.mask.frozen) throw new Error("INCLUDE confirmation requires one frozen mask.");
      return {
        title: "Confirm irreversible INCLUDE",
        copy: sourceIdentity + "This writes an irreversible authority-none INCLUDE decision for frozen mask revision " + String(active.mask.revision) + " with " + String(active.mask.includedPixelCount) + " included and " + String(active.mask.excludedPixelCount) + " excluded pixels. It records no acceptance and grants no downstream authority.",
        commit: "Confirm INCLUDE",
        className: "primary-button",
      };
    }
    if (kind === "REVISE") {
      if (active.mask === null || !active.mask.frozen) throw new Error("Mask revision confirmation requires one frozen mask.");
      return {
        title: "Revise frozen mask",
        copy: sourceIdentity + "This arms exact integer editing for frozen mask revision " + String(active.mask.revision) + ". Your first real edit will use the existing durable mask-edit transition and invalidate that frozen binding and its mask-review coverage. No decision is recorded by arming revision.",
        commit: "Arm revision",
        className: "primary-button",
      };
    }
    throw new Error("Confirmation kind is invalid.");
  }

  function settleConfirmation(confirmed) {
    const resolver = confirmationResolver;
    if (resolver === null) return;
    confirmationResolver = null;
    const dialog = requireElement("confirmation-dialog");
    if (dialog.open === true && typeof dialog.close === "function") dialog.close();
    resolver(confirmed);
    sourceListRenderKey = null;
    renderOperatorState();
  }

  function confirmSensitiveAction(kind, active) {
    if (confirmationResolver !== null) throw new Error("Another confirmation is already open.");
    const details = confirmationDetails(kind, active);
    const dialog = requireElement("confirmation-dialog");
    if (typeof dialog.showModal !== "function" || typeof dialog.close !== "function") {
      throw new Error("A modal confirmation dialog is required for this action.");
    }
    requireElement("confirmation-title").textContent = details.title;
    requireElement("confirmation-copy").textContent = details.copy;
    const commit = requireElement("confirmation-commit");
    commit.textContent = details.commit;
    commit.className = details.className;
    return new Promise((resolve, reject) => {
      confirmationResolver = resolve;
      sourceListRenderKey = null;
      renderOperatorState();
      try {
        dialog.showModal();
      } catch (error) {
        confirmationResolver = null;
        sourceListRenderKey = null;
        renderOperatorState();
        reject(error);
      }
    });
  }

  async function toggleFrozenMaskRevision() {
    const active = requireActiveSource("mask_review");
    if (active.mask === null || !active.mask.frozen) throw new Error("A frozen mask is required for revision.");
    if (revisionArmMatches(active)) {
      frozenRevisionArm = null;
      setPointerMode("pan");
      renderOperatorState();
      setStatus("Cancelled the local revision arm. Frozen mask evidence remains unchanged.");
      return;
    }
    if (!(await confirmSensitiveAction("REVISE", active))) {
      setStatus("Kept the frozen mask unchanged.");
      return;
    }
    frozenRevisionArm = {
      inventoryIndex: active.inventoryIndex,
      renderGeneration: active.renderGeneration,
      maskRevision: active.mask.revision,
    };
    setPointerMode("rectangle");
    renderOperatorState();
    setStatus("Revision armed. The frozen evidence remains intact until the first exact edit; that edit invalidates the old mask-review coverage.");
  }

  function renderActionGates() {
    const active = operatorState === null ? null : operatorState.activeSource;
    const sessionActive = operatorState !== null && operatorState.lifecycle === "active" && !mutationInFlight && confirmationResolver === null;
    const sourceReview = sessionActive && active !== null && active.phase === "source_review";
    const maskEdit = sessionActive && active !== null && active.phase === "mask_edit";
    const maskReview = sessionActive && active !== null && active.phase === "mask_review";
    const decisionRecorded = sessionActive && active !== null && active.phase === "decision_recorded";
    const sourceCoverageComplete = sourceReview && active.sourceCoverage.complete;
    const decisionNoteLength = requireElement("decision-note").value.trim().length;
    const revisionArmed = maskReview && revisionArmMatches(active);
    const maskEditable = maskEdit || revisionArmed;
    setControlDisabled("source-exclude", !(sourceCoverageComplete && decisionNoteLength > 0));
    setControlDisabled("source-leave-pending", !sourceReview);
    setControlDisabled("mask-begin", !sourceCoverageComplete);
    setControlDisabled("mask-freeze", !maskEdit);
    setControlDisabled("mask-revise", !maskReview);
    requireElement("mask-revise").textContent = revisionArmed ? "Cancel mask revision" : "Revise frozen mask";
    requireElement("mask-revision-warning").textContent = revisionArmed
      ? "Revision armed. The first exact edit invalidates the frozen binding and old mask-review coverage."
      : "A frozen candidate remains HUMAN PENDING. Revision requires explicit confirmation.";
    setControlDisabled("source-include", !(maskReview && !revisionArmed && maskReviewCoverageComplete && decisionNoteLength > 0));
    setControlDisabled("source-attest", !(decisionRecorded && requireElement("reviewer-id").value.trim().length > 0 && knowledgeBasisFromInput(false).length > 0));
    setControlDisabled("source-abandon", !(sessionActive && active !== null));
    setControlDisabled("session-stop", !sessionActive);
    setControlDisabled("decision-note", !(sourceReview || maskReview));
    setControlDisabled("include-classification", !maskReview);
    setControlDisabled("tool-pan", !(sourceReview || maskEdit || maskReview));
    for (const id of ["tool-rectangle", "tool-polygon", "mask-operation", "rectangle-seam", "polygon-seam", "polygon-commit", "polygon-clear"]) {
      setControlDisabled(id, !maskEditable);
    }
    setControlDisabled("mask-reason", !maskEditable || requireElement("mask-operation").value === "include");
  }

  function renderActiveSource() {
    const active = operatorState === null ? null : operatorState.activeSource;
    if (active === null) {
      frozenRevisionArm = null;
      requireElement("app-body").setAttribute("data-review-phase", "idle");
      requireElement("viewer-heading").textContent = "Select a source to inspect";
      requireElement("phase-label").textContent = "No active source";
      requireElement("source-fact-identity").textContent = "—";
      requireElement("source-fact-custody").textContent = "Select a source";
      requireElement("active-observation").textContent = "Agent observation — not a decision";
      requireElement("active-human-decision").textContent = "Human decision: UNSURE";
      requireElement("decision-heading").textContent = "Human decision: UNSURE";
      requireElement("decision-gate-copy").textContent = "Select an exact source. Every decision remains authority-none.";
      requireElement("source-coverage-label").textContent = "Source coverage 0 / 512";
      requireElement("mask-coverage-label").textContent = "Mask-review coverage not active";
      requireElement("mask-revision-label").textContent = "Mask not begun";
      return;
    }
    requireElement("app-body").setAttribute("data-review-phase", active.phase);
    const catalogEntry = operatorState.sources[active.inventoryIndex];
    if (catalogEntry === undefined || catalogEntry.inventoryIndex !== active.inventoryIndex || catalogEntry.sweepNumber !== active.sweepNumber) {
      throw new Error("Active source catalog binding is invalid.");
    }
    const humanDecision = active.decision === null ? "UNSURE" : active.decision.result;
    requireElement("viewer-heading").textContent = "Source " + String(active.inventoryIndex + 1) + " · Sweep " + String(active.sweepNumber);
    requireElement("phase-label").textContent = "Phase " + active.phase;
    requireElement("source-fact-identity").textContent = "Source " + String(active.inventoryIndex + 1) + " · Sweep " + String(active.sweepNumber);
    requireElement("source-fact-custody").textContent = "Verified by active exact source epoch";
    requireElement("active-observation").textContent = observationCopy(catalogEntry.agentObservation);
    requireElement("active-human-decision").textContent = "Human decision: " + humanDecision;
    requireElement("decision-heading").textContent = "Human decision: " + humanDecision;
    requireElement("source-coverage-label").textContent = "Source coverage " + String(active.sourceCoverage.completedTileCount) + " / 512" + (active.sourceCoverage.complete ? " · complete" : "");
    requireElement("mask-coverage-label").textContent = active.phase === "mask_review"
      ? "Mask-review coverage " + String(maskReviewCompletedTileCount) + " / 512 completed · " + String(maskReviewDeliveredTileCount) + " delivered" + (maskReviewCoverageComplete ? " · complete" : "")
      : "Mask-review coverage not active";
    requireElement("mask-revision-label").textContent = active.mask === null
      ? "Mask not begun"
      : "Mask revision " + String(active.mask.revision) + (active.mask.frozen ? " · frozen" : " · editable");
    const decisionGate = requireElement("decision-gate-copy");
    if (active.phase === "source_review") {
      decisionGate.textContent = active.sourceCoverage.complete
        ? "Choose EXCLUDE, begin an INCLUDE mask, or LEAVE UNSURE. No action grants acceptance."
        : "Review every exact source tile at native device scale before choosing a human action.";
    } else if (active.phase === "mask_edit") {
      decisionGate.textContent = "Apply only source-supported integer edits, then freeze the candidate for a separate native review.";
    } else if (active.phase === "mask_review") {
      decisionGate.textContent = maskReviewCoverageComplete
        ? "INCLUDE requires an evidence note and explicit confirmation. Revision invalidates this frozen coverage."
        : "Review the frozen source, mask, and reason pair at native device scale. Human decision remains UNSURE.";
    } else if (active.phase === "decision_recorded") {
      decisionGate.textContent = "An authority-none decision is recorded. A separate non-cryptographic human attestation remains available.";
    } else {
      decisionGate.textContent = "Authority-none attestation recorded. No acceptance or downstream authority was granted.";
    }
  }

  function renderOperatorState() {
    renderLifecycle();
    renderSourceList();
    renderActiveSource();
    renderActionGates();
    updateScaleIndicator();
  }

  async function installOperatorState(nextState) {
    validateOperatorState(nextState);
    await abortAndDrainTileLoad();
    const nextRenderKey = activeRenderKey(nextState);
    if (installedRenderKey !== nextRenderKey) clearRenderState();
    operatorState = nextState;
    installedRenderKey = nextRenderKey;
    sourceListRenderKey = null;
    if (nextState.activeSource === null || !revisionArmMatches(nextState.activeSource)) frozenRevisionArm = null;
    if (nextState.activeSource === null ||
        (nextState.activeSource.phase !== "mask_edit" && !revisionArmMatches(nextState.activeSource))) setPointerMode("pan");
    renderOperatorState();
    if (nextState.lifecycle !== "active" || nextState.activeSource === null || nextRenderKey === null) return;
    const phase = nextState.activeSource.phase;
    if (phase === "source_review") startTileLoad(nextState.activeSource, "source", nextRenderKey);
    if (phase === "mask_edit") startTileLoad(nextState.activeSource, "mask_edit", nextRenderKey);
    if (phase === "mask_review") {
      maskReviewCoverageGeneration = nextState.activeSource.renderGeneration;
      startTileLoad(nextState.activeSource, "mask_review", nextRenderKey);
    }
  }

  function requireActiveSource(phase) {
    if (operatorState === null || operatorState.lifecycle !== "active" || operatorState.activeSource === null) {
      throw new Error("An active local source is required.");
    }
    if (phase !== null && operatorState.activeSource.phase !== phase) {
      throw new Error("This action is not available in the current phase.");
    }
    return operatorState.activeSource;
  }

  function requireEditableMaskSource() {
    const active = requireActiveSource(null);
    if (active.phase === "mask_edit") return active;
    if (active.phase === "mask_review" && revisionArmMatches(active)) return active;
    throw new Error("Mask editing requires an editable mask or a confirmed frozen-mask revision.");
  }

  function epochRevisionGeneration(schemaVersion, active) {
    return {
      schemaVersion: schemaVersion,
      expectedBrowserEpochNumber: operatorState.browserEpochNumber,
      expectedWorkspaceRevision: operatorState.workspaceRevision,
      renderGeneration: active.renderGeneration,
    };
  }

  async function runStateMutation(path, body, statusMessage) {
    if (mutationInFlight) return;
    if (confirmationResolver !== null) throw new Error("Complete or cancel the open confirmation first.");
    mutationInFlight = true;
    clearError();
    renderOperatorState();
    try {
      await abortAndDrainTileLoad();
      const nextState = await apiJson(path, body, validateOperatorState);
      await installOperatorState(nextState);
      setStatus(statusMessage);
    } finally {
      mutationInFlight = false;
      renderOperatorState();
    }
  }

  async function selectSource(inventoryIndex) {
    if (operatorState === null || operatorState.lifecycle !== "active") return;
    if (!Number.isInteger(inventoryIndex) || inventoryIndex < 0 || inventoryIndex >= 148) {
      throw new Error("Source selection is invalid.");
    }
    await runStateMutation(routes.sourceSelect, {
      schemaVersion: requestSchemas.sourceSelect,
      expectedBrowserEpochNumber: operatorState.browserEpochNumber,
      expectedWorkspaceRevision: operatorState.workspaceRevision,
      inventoryIndex: inventoryIndex,
    }, "Selected source " + String(inventoryIndex + 1) + " for native review.");
  }

  async function excludeSource() {
    const active = requireActiveSource("source_review");
    const note = requireElement("decision-note").value.trim();
    if (note.length < 1 || note.length > 1000) throw new Error("EXCLUDE note must contain 1 to 1000 characters.");
    if (!(await confirmSensitiveAction("EXCLUDE", active))) {
      setStatus("Kept the human decision UNSURE; no EXCLUDE request was sent.");
      return;
    }
    await runStateMutation(routes.sourceExclude, {
      ...epochRevisionGeneration(requestSchemas.sourceExclude, active),
      note: note,
    }, "Recorded an authority-none EXCLUDE decision.");
  }

  async function leaveSourcePending() {
    const active = requireActiveSource("source_review");
    await runStateMutation(routes.sourceLeavePending, epochRevisionGeneration(requestSchemas.sourceLeavePending, active), "Left the source human-pending without a decision.");
  }

  async function beginMask() {
    const active = requireActiveSource("source_review");
    await runStateMutation(routes.maskBegin, epochRevisionGeneration(requestSchemas.maskBegin, active), "Began integer source-coordinate mask authoring.");
  }

  function createMaskEdit(operation, primitive) {
    const active = requireEditableMaskSource();
    if (active.mask === null) throw new Error("Editable mask state is unavailable.");
    if (operation === "include") {
      return {
        expectedRevision: active.mask.revision,
        operation: "include",
        primitive: primitive,
      };
    }
    const reasonCode = requireElement("mask-reason").value;
    if (!maskReasons.includes(reasonCode)) throw new Error("Exclusion reason is invalid.");
    return {
      expectedRevision: active.mask.revision,
      operation: "exclude",
      reasonCode: reasonCode,
      primitive: primitive,
    };
  }

  async function applyMaskEdit(edit) {
    const active = requireEditableMaskSource();
    const revisingFrozenMask = active.phase === "mask_review";
    await runStateMutation(routes.maskEdit, {
      ...epochRevisionGeneration(requestSchemas.maskEdit, active),
      edit: edit,
    }, revisingFrozenMask
      ? "Applied the first exact revision edit and invalidated the previous frozen binding and mask-review coverage."
      : "Applied an exact integer source-coordinate mask edit.");
  }

  async function freezeMask() {
    const active = requireActiveSource("mask_edit");
    if (active.mask === null) throw new Error("Editable mask state is unavailable.");
    await runStateMutation(routes.maskFreeze, {
      ...epochRevisionGeneration(requestSchemas.maskFreeze, active),
      expectedMaskRevision: active.mask.revision,
    }, "Froze the mask and entered its separate native review phase.");
  }

  async function includeSource() {
    const active = requireActiveSource("mask_review");
    const classification = requireElement("include-classification").value;
    if (classification !== "grand_hall_core" && classification !== "grand_hall_portal_threshold") {
      throw new Error("INCLUDE classification is invalid.");
    }
    const note = requireElement("decision-note").value.trim();
    if (note.length < 1 || note.length > 1000) throw new Error("INCLUDE note must contain 1 to 1000 characters.");
    if (!(await confirmSensitiveAction("INCLUDE", active))) {
      setStatus("Kept the human decision UNSURE; no INCLUDE request was sent.");
      return;
    }
    await runStateMutation(routes.sourceInclude, {
      ...epochRevisionGeneration(requestSchemas.sourceInclude, active),
      classification: classification,
      note: note,
    }, "Recorded an authority-none INCLUDE decision.");
  }

  function knowledgeBasisFromInput(throwOnInvalid) {
    const lines = requireElement("knowledge-basis").value.split(/\\r?\\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    const valid = lines.length >= 1 && lines.length <= 32 && lines.every((line) => line.length <= 240);
    if (!valid && throwOnInvalid) throw new Error("Knowledge basis must contain 1 to 32 non-empty lines of at most 240 characters each.");
    return valid ? lines : [];
  }

  async function attestSource() {
    const active = requireActiveSource("decision_recorded");
    const reviewerId = requireElement("reviewer-id").value.trim();
    if (reviewerId.length < 1 || reviewerId.length > 160) throw new Error("Reviewer identifier must contain 1 to 160 characters.");
    const knowledgeBasis = knowledgeBasisFromInput(true);
    await runStateMutation(routes.sourceAttest, {
      ...epochRevisionGeneration(requestSchemas.sourceAttest, active),
      reviewerId: reviewerId,
      knowledgeBasis: knowledgeBasis,
    }, "Recorded a non-cryptographic, authority-none human attestation.");
  }

  async function abandonSource() {
    const active = requireActiveSource(null);
    await runStateMutation(routes.sourceAbandon, epochRevisionGeneration(requestSchemas.sourceAbandon, active), "Explicitly abandoned the active source without granting authority.");
  }

  async function stopSession() {
    if (operatorState === null || operatorState.lifecycle !== "active") return;
    await runStateMutation(routes.sessionStop, {
      schemaVersion: requestSchemas.sessionStop,
      expectedBrowserEpochNumber: operatorState.browserEpochNumber,
      expectedWorkspaceRevision: operatorState.workspaceRevision,
    }, "Stopped the local review session.");
  }

  function coveragePayload(active, schemaVersion) {
    const canvasBounds = sourceCanvas.getBoundingClientRect();
    const viewportBounds = sourceViewport.getBoundingClientRect();
    const viewportCssWidth = sourceViewport.clientWidth;
    const viewportCssHeight = sourceViewport.clientHeight;
    const devicePixelRatio = window.devicePixelRatio;
    const scale = canvasBounds.width / sourceWidth;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 64 ||
        !Number.isFinite(viewportCssWidth) || viewportCssWidth <= 0 || viewportCssWidth > 16384 ||
        !Number.isFinite(viewportCssHeight) || viewportCssHeight <= 0 || viewportCssHeight > 16384 ||
        !Number.isFinite(devicePixelRatio) || devicePixelRatio < 0.25 || devicePixelRatio > 8) {
      return null;
    }
    const visibilityState = document.visibilityState === "visible"
      ? "visible"
      : document.visibilityState === "prerender" ? "prerender" : "hidden";
    return {
      schemaVersion: schemaVersion,
      expectedBrowserEpochNumber: operatorState.browserEpochNumber,
      renderGeneration: active.renderGeneration,
      documentVisibilityState: visibilityState,
      documentFocusState: document.hasFocus() ? "focused" : "blurred",
      viewportCssWidth: viewportCssWidth,
      viewportCssHeight: viewportCssHeight,
      devicePixelRatio: devicePixelRatio,
      sourceToCssTransform: {
        a: scale,
        b: 0,
        c: 0,
        d: scale,
        e: canvasBounds.left - viewportBounds.left - sourceViewport.clientLeft,
        f: canvasBounds.top - viewportBounds.top - sourceViewport.clientTop,
      },
      paintedTiles: paintedTileArray(),
    };
  }

  async function sendCoverageHeartbeat() {
    if (operatorState === null || operatorState.lifecycle !== "active" || operatorState.activeSource === null ||
        coverageInFlight || mutationInFlight || tileLoadPromise !== null || installedRenderKey === null) return;
    const active = operatorState.activeSource;
    if (active.phase !== "source_review" && active.phase !== "mask_review") return;
    const renderKey = activeRenderKey(operatorState);
    const isSource = active.phase === "source_review";
    const payload = coveragePayload(active, isSource ? requestSchemas.sourceCoverage : requestSchemas.maskReviewCoverage);
    if (payload === null) return;
    coverageInFlight = true;
    try {
      if (isSource) {
        const acknowledgement = await apiJson(routes.sourceCoverage, payload, validateSourceCoverageAcknowledgement);
        if (operatorState !== null && activeRenderKey(operatorState) === renderKey && operatorState.activeSource !== null) {
          operatorState.activeSource.sourceCoverage = {
            completedTileCount: acknowledgement.completedTileCount,
            totalTileCount: tileCount,
            complete: acknowledgement.complete,
          };
        }
      } else {
        const acknowledgement = await apiJson(routes.maskReviewCoverage, payload, validateMaskCoverageAcknowledgement);
        if (operatorState !== null && activeRenderKey(operatorState) === renderKey &&
          operatorState.activeSource !== null && maskReviewCoverageGeneration === active.renderGeneration) {
          maskReviewCoverageComplete = acknowledgement.complete;
          maskReviewDeliveredTileCount = acknowledgement.deliveredTileCount;
          maskReviewCompletedTileCount = acknowledgement.completedTileCount;
        }
      }
      renderOperatorState();
    } finally {
      coverageInFlight = false;
    }
  }

  function sourcePoint(event) {
    const bounds = sourceCanvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Source canvas has no visible extent.");
    return {
      xPx: Math.max(0, Math.min(sourceWidth - 1, Math.floor((event.clientX - bounds.left) * sourceWidth / bounds.width))),
      yPx: Math.max(0, Math.min(sourceHeight - 1, Math.floor((event.clientY - bounds.top) * sourceHeight / bounds.height))),
    };
  }

  function selectedMaskOperation() {
    const operation = requireElement("mask-operation").value;
    if (operation !== "include" && operation !== "exclude") throw new Error("Mask operation is invalid.");
    return operation;
  }

  function rectanglePrimitive(start, end) {
    const horizontalSeam = requireElement("rectangle-seam").value;
    const topPx = Math.min(start.yPx, end.yPx);
    const bottomExclusivePx = Math.max(start.yPx, end.yPx) + 1;
    if (horizontalSeam === "none") {
      return {
        kind: "rectangle",
        horizontalSeam: "none",
        leftPx: Math.min(start.xPx, end.xPx),
        topPx: topPx,
        rightExclusivePx: Math.max(start.xPx, end.xPx) + 1,
        bottomExclusivePx: bottomExclusivePx,
      };
    }
    if (horizontalSeam !== "wrap") throw new Error("Rectangle seam mode is invalid.");
    const leftPx = start.xPx;
    const rightExclusivePx = end.xPx + 1;
    if (leftPx <= rightExclusivePx) throw new Error("A wrapping rectangle must start on the right side and end on the left side of the seam.");
    return {
      kind: "rectangle",
      horizontalSeam: "wrap",
      leftPx: leftPx,
      topPx: topPx,
      rightExclusivePx: rightExclusivePx,
      bottomExclusivePx: bottomExclusivePx,
    };
  }

  async function submitRectangle(start, end) {
    const primitive = rectanglePrimitive(start, end);
    await applyMaskEdit(createMaskEdit(selectedMaskOperation(), primitive));
  }

  function renderPolygonStatus() {
    requireElement("polygon-status").textContent = String(polygonPoints.length) + " polygon points";
  }

  function addPolygonPoint(event) {
    requireEditableMaskSource();
    if (polygonPoints.length >= maximumPolygonPointCount) throw new Error("Polygon point limit is 512.");
    polygonPoints.push(Object.freeze(sourcePoint(event)));
    renderPolygonStatus();
    setStatus("Polygon point " + String(polygonPoints.length) + " recorded in integer source coordinates.");
  }

  async function submitPolygon() {
    requireEditableMaskSource();
    if (polygonPoints.length < 3 || polygonPoints.length > maximumPolygonPointCount) {
      throw new Error("Polygon must contain 3 to 512 points.");
    }
    const horizontalSeam = requireElement("polygon-seam").value;
    if (horizontalSeam !== "none" && horizontalSeam !== "wrap_shortest") throw new Error("Polygon seam mode is invalid.");
    const primitive = {
      kind: "polygon",
      horizontalSeam: horizontalSeam,
      points: polygonPoints.map((point) => ({ xPx: point.xPx, yPx: point.yPx })),
    };
    await applyMaskEdit(createMaskEdit(selectedMaskOperation(), primitive));
    polygonPoints = [];
    renderPolygonStatus();
  }

  function setPointerMode(mode) {
    if (!["pan", "rectangle", "polygon"].includes(mode)) throw new Error("Pointer mode is invalid.");
    pointerMode = mode;
    sourceViewport.classList.toggle("mode-pan", mode === "pan");
    sourceViewport.classList.toggle("mode-edit", mode !== "pan");
    for (const entry of [["tool-pan", "pan"], ["tool-rectangle", "rectangle"], ["tool-polygon", "polygon"]]) {
      const selected = mode === entry[1];
      requireElement(entry[0]).classList.toggle("is-selected", selected);
      requireElement(entry[0]).setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  function updateScaleIndicator() {
    const cssScale = zoomScales[zoomIndex];
    const deviceScale = cssScale * window.devicePixelRatio;
    const verdict = deviceScale >= 1 ? "native device scale met" : "below native device scale";
    requireElement("scale-indicator").textContent = "CSS " + String(cssScale * 100) + "% · device " + deviceScale.toFixed(3) + " px/source px · " + verdict;
  }

  function changeZoom(nextIndex) {
    const bounded = Math.max(0, Math.min(zoomScales.length - 1, nextIndex));
    if (bounded === zoomIndex) return;
    const oldScale = zoomScales[zoomIndex];
    const sourceCenterX = (sourceViewport.scrollLeft + sourceViewport.clientWidth / 2) / oldScale;
    const sourceCenterY = (sourceViewport.scrollTop + sourceViewport.clientHeight / 2) / oldScale;
    zoomIndex = bounded;
    canvasStage.className = "canvas-stage " + zoomClasses[zoomIndex];
    const newScale = zoomScales[zoomIndex];
    sourceViewport.scrollLeft = sourceCenterX * newScale - sourceViewport.clientWidth / 2;
    sourceViewport.scrollTop = sourceCenterY * newScale - sourceViewport.clientHeight / 2;
    updateScaleIndicator();
  }

  function chooseNativeDeviceScale() {
    let nativeIndex = zoomScales.length - 1;
    for (let index = 0; index < zoomScales.length; index += 1) {
      if (zoomScales[index] * window.devicePixelRatio >= 1) {
        nativeIndex = index;
        break;
      }
    }
    changeZoom(nativeIndex);
  }

  function readTileNavigation() {
    const column = Number(requireElement("tile-column").value) - 1;
    const row = Number(requireElement("tile-row").value) - 1;
    if (!Number.isInteger(column) || column < 0 || column >= tileColumns || !Number.isInteger(row) || row < 0 || row >= tileRows) {
      throw new Error("Tile column must be 1–32 and row must be 1–16.");
    }
    return { column: column, row: row };
  }

  function navigateToTile(column, row) {
    const boundedColumn = Math.max(0, Math.min(tileColumns - 1, column));
    const boundedRow = Math.max(0, Math.min(tileRows - 1, row));
    requireElement("tile-column").value = String(boundedColumn + 1);
    requireElement("tile-row").value = String(boundedRow + 1);
    sourceViewport.scrollLeft = boundedColumn * tileWidth * zoomScales[zoomIndex];
    sourceViewport.scrollTop = boundedRow * tileHeight * zoomScales[zoomIndex];
    setStatus("Navigated to tile column " + String(boundedColumn + 1) + ", row " + String(boundedRow + 1) + ".");
  }

  function moveTile(delta) {
    const current = readTileNavigation();
    const linear = Math.max(0, Math.min(tileCount - 1, current.row * tileColumns + current.column + delta));
    navigateToTile(linear % tileColumns, Math.floor(linear / tileColumns));
  }

  sourceCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || mutationInFlight || operatorState === null || operatorState.activeSource === null) return;
    clearError();
    if (pointerMode === "polygon") {
      try {
        addPolygonPoint(event);
      } catch (error) {
        showFailure(error);
      }
      return;
    }
    if (pointerMode === "rectangle") {
      try {
        requireEditableMaskSource();
        pointerStart = sourcePoint(event);
        sourceCanvas.setPointerCapture(event.pointerId);
      } catch (error) {
        showFailure(error);
      }
      return;
    }
    pointerStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: sourceViewport.scrollLeft,
      scrollTop: sourceViewport.scrollTop,
    };
    sourceCanvas.setPointerCapture(event.pointerId);
    sourceViewport.classList.add("is-panning");
  });

  sourceCanvas.addEventListener("pointermove", (event) => {
    if (pointerMode !== "pan" || pointerStart === null || !Object.hasOwn(pointerStart, "clientX")) return;
    sourceViewport.scrollLeft = pointerStart.scrollLeft - (event.clientX - pointerStart.clientX);
    sourceViewport.scrollTop = pointerStart.scrollTop - (event.clientY - pointerStart.clientY);
  });

  sourceCanvas.addEventListener("pointerup", (event) => {
    if (pointerStart === null) return;
    const start = pointerStart;
    pointerStart = null;
    sourceViewport.classList.remove("is-panning");
    if (sourceCanvas.hasPointerCapture(event.pointerId)) sourceCanvas.releasePointerCapture(event.pointerId);
    if (pointerMode === "rectangle" && Object.hasOwn(start, "xPx")) {
      try {
        const end = sourcePoint(event);
        void submitRectangle(start, end).catch(showFailure);
      } catch (error) {
        showFailure(error);
      }
    }
  });

  sourceCanvas.addEventListener("pointercancel", (event) => {
    pointerStart = null;
    sourceViewport.classList.remove("is-panning");
    if (sourceCanvas.hasPointerCapture(event.pointerId)) sourceCanvas.releasePointerCapture(event.pointerId);
  });

  requireElement("zoom-out").addEventListener("click", () => changeZoom(zoomIndex - 1));
  requireElement("zoom-native").addEventListener("click", chooseNativeDeviceScale);
  requireElement("zoom-in").addEventListener("click", () => changeZoom(zoomIndex + 1));
  requireElement("tool-pan").addEventListener("click", () => setPointerMode("pan"));
  requireElement("tool-rectangle").addEventListener("click", () => setPointerMode("rectangle"));
  requireElement("tool-polygon").addEventListener("click", () => setPointerMode("polygon"));
  requireElement("polygon-clear").addEventListener("click", () => {
    polygonPoints = [];
    renderPolygonStatus();
    setStatus("Cleared the unsubmitted polygon points.");
  });
  requireElement("polygon-commit").addEventListener("click", () => void submitPolygon().catch(showFailure));
  requireElement("source-exclude").addEventListener("click", () => void excludeSource().catch(showFailure));
  requireElement("source-leave-pending").addEventListener("click", () => void leaveSourcePending().catch(showFailure));
  requireElement("mask-begin").addEventListener("click", () => void beginMask().catch(showFailure));
  requireElement("mask-freeze").addEventListener("click", () => void freezeMask().catch(showFailure));
  requireElement("mask-revise").addEventListener("click", () => void toggleFrozenMaskRevision().catch(showFailure));
  requireElement("source-include").addEventListener("click", () => void includeSource().catch(showFailure));
  requireElement("source-attest").addEventListener("click", () => void attestSource().catch(showFailure));
  requireElement("source-abandon").addEventListener("click", () => void abandonSource().catch(showFailure));
  requireElement("session-stop").addEventListener("click", () => void stopSession().catch(showFailure));
  requireElement("tile-go").addEventListener("click", () => {
    try {
      const tile = readTileNavigation();
      navigateToTile(tile.column, tile.row);
    } catch (error) {
      showFailure(error);
    }
  });
  requireElement("tile-previous").addEventListener("click", () => {
    try { moveTile(-1); } catch (error) { showFailure(error); }
  });
  requireElement("tile-next").addEventListener("click", () => {
    try { moveTile(1); } catch (error) { showFailure(error); }
  });

  for (const id of ["decision-note", "include-classification", "reviewer-id", "knowledge-basis", "mask-operation"]) {
    requireElement(id).addEventListener("input", renderActionGates);
    requireElement(id).addEventListener("change", renderActionGates);
  }
  requireElement("source-search").addEventListener("input", updateSourceFilter);
  requireElement("confirmation-cancel").addEventListener("click", () => settleConfirmation(false));
  requireElement("confirmation-commit").addEventListener("click", () => settleConfirmation(true));
  requireElement("confirmation-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    settleConfirmation(false);
  });
  requireElement("confirmation-dialog").addEventListener("close", () => settleConfirmation(false));

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const targetIsViewer = target === sourceViewport ||
      (target !== null && typeof sourceViewport.contains === "function" && sourceViewport.contains(target));
    if (!targetIsViewer) return;
    if (event.key === "Escape" && polygonPoints.length > 0) {
      polygonPoints = [];
      renderPolygonStatus();
      setStatus("Cleared the unsubmitted polygon points.");
      return;
    }
    if (!event.altKey) return;
    try {
      const tile = readTileNavigation();
      if (event.key === "ArrowLeft") navigateToTile(tile.column - 1, tile.row);
      else if (event.key === "ArrowRight") navigateToTile(tile.column + 1, tile.row);
      else if (event.key === "ArrowUp") navigateToTile(tile.column, tile.row - 1);
      else if (event.key === "ArrowDown") navigateToTile(tile.column, tile.row + 1);
      else return;
      event.preventDefault();
    } catch (error) {
      showFailure(error);
    }
  });

  window.addEventListener("resize", updateScaleIndicator);
  window.addEventListener("pagehide", () => {
    if (tileLoadController !== null) tileLoadController.abort();
  });

  async function start() {
    await exchangeBootstrapOnce();
    const initialState = await apiJson(routes.state, {
      schemaVersion: requestSchemas.state,
    }, validateOperatorState);
    await installOperatorState(initialState);
    setPointerMode("pan");
    setStatus("Local Grand Hall native review is ready. No source was selected automatically.");
    window.setInterval(() => {
      void sendCoverageHeartbeat().catch(showFailure);
    }, 250);
  }

  renderPolygonStatus();
  updateScaleIndicator();
  void start().catch(showFailure);
})();
`;

export interface GrandHallT554NativeReviewStaticAssetV2 {
  readonly route: string;
  readonly contentType:
    | "text/html; charset=utf-8"
    | "text/css; charset=utf-8"
    | "text/javascript; charset=utf-8";
  readonly bytes: Buffer;
}

export function createGrandHallT554NativeReviewAssetsV2(): readonly GrandHallT554NativeReviewStaticAssetV2[] {
  return Object.freeze([
    Object.freeze({
      route: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.document,
      contentType: "text/html; charset=utf-8",
      bytes: Buffer.from(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2, "utf8"),
    }),
    Object.freeze({
      route: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet,
      contentType: "text/css; charset=utf-8",
      bytes: Buffer.from(GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2, "utf8"),
    }),
    Object.freeze({
      route: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script,
      contentType: "text/javascript; charset=utf-8",
      bytes: Buffer.from(
        GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
        "utf8",
      ),
    }),
  ] satisfies readonly GrandHallT554NativeReviewStaticAssetV2[]);
}
