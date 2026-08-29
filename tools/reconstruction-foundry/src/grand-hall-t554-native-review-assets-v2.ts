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
<body>
  <a class="skip-link" href="#review-workbench">Skip to review workbench</a>
  <header class="app-header">
    <div class="brand-block">
      <span class="brand-mark" aria-hidden="true">V</span>
      <div>
        <strong>VENVIEWER</strong>
        <span>Trades Hall Glasgow · Grand Hall evidence review</span>
      </div>
    </div>
    <div class="session-summary" aria-label="Session state">
      <span id="lifecycle-chip" class="chip">Starting</span>
      <span id="revision-label">Workspace revision —</span>
      <span id="epoch-label">Browser epoch —</span>
    </div>
  </header>

  <section class="truth-strip" aria-label="Permanent authority boundary">
    <strong>Authority: none</strong>
    <span>Review state: human_pending</span>
    <span>Final decision: PENDING</span>
    <span>No generated content or architectural inference is permitted.</span>
  </section>

  <main id="review-workbench" class="workbench" tabindex="-1">
    <aside class="source-panel" aria-labelledby="source-heading">
      <div class="panel-heading">
        <div>
          <p class="section-label">Evidence inventory</p>
          <h1 id="source-heading">148 source panoramas</h1>
        </div>
        <span id="history-count" class="quiet-count">0 recorded</span>
      </div>
      <p class="panel-help">Agent observations are proposals only. Every durable record shown here remains authority-none.</p>
      <div id="source-list" class="source-list" role="list" aria-label="Source panoramas"></div>
    </aside>

    <section class="viewer-panel" aria-labelledby="viewer-heading">
      <div class="viewer-toolbar">
        <div>
          <p class="section-label">Native source evidence</p>
          <h2 id="viewer-heading">Select a source to inspect</h2>
        </div>
        <div class="toolbar-cluster" aria-label="View controls">
          <button id="zoom-out" type="button" class="quiet-button" aria-label="Zoom out">−</button>
          <button id="zoom-native" type="button" class="quiet-button">Native device scale</button>
          <button id="zoom-in" type="button" class="quiet-button" aria-label="Zoom in">+</button>
          <output id="scale-indicator" class="scale-indicator">CSS 12.5% · device 0.125 px/source px</output>
        </div>
      </div>

      <div class="evidence-bar">
        <span id="phase-label">No active source</span>
        <span id="source-coverage-label">Source coverage 0 / 512</span>
        <span id="mask-coverage-label">Mask-review coverage not active</span>
        <span id="mask-revision-label">Mask not begun</span>
      </div>

      <div id="source-viewport" class="source-viewport mode-pan" tabindex="0" aria-label="Scrollable 8192 by 4096 source panorama">
        <div id="canvas-stage" class="canvas-stage zoom-0125">
          <canvas id="source-canvas" width="8192" height="4096" aria-label="Exact RGB source panorama"></canvas>
          <canvas id="overlay-canvas" width="8192" height="4096" aria-label="Deterministic exclusion mask and reason overlay"></canvas>
        </div>
      </div>

      <div class="tile-navigator" aria-label="Systematic tile navigation">
        <strong>Tile navigation</strong>
        <button id="tile-previous" type="button" class="quiet-button">Previous</button>
        <label>Column <input id="tile-column" type="number" min="1" max="32" step="1" value="1"></label>
        <label>Row <input id="tile-row" type="number" min="1" max="16" step="1" value="1"></label>
        <button id="tile-go" type="button" class="quiet-button">Go</button>
        <button id="tile-next" type="button" class="quiet-button">Next</button>
        <span>Alt + arrow keys also move one tile.</span>
      </div>

      <div class="mask-tools" aria-labelledby="mask-tools-heading">
        <div>
          <p class="section-label">Integer source-coordinate mask tools</p>
          <h3 id="mask-tools-heading">Rectangle and polygon edits</h3>
        </div>
        <div class="segmented-control" aria-label="Pointer tool">
          <button id="tool-pan" type="button" class="tool-button is-selected" aria-pressed="true">Pan</button>
          <button id="tool-rectangle" type="button" class="tool-button" aria-pressed="false">Rectangle</button>
          <button id="tool-polygon" type="button" class="tool-button" aria-pressed="false">Polygon</button>
        </div>
        <label>Operation
          <select id="mask-operation">
            <option value="exclude">Exclude</option>
            <option value="include">Include</option>
          </select>
        </label>
        <label>Exclusion reason
          <select id="mask-reason">
            <option value="adjacent_room_pixels">Adjacent room pixels</option>
            <option value="portal_beyond_grand_hall_plane">Portal beyond Grand Hall plane</option>
            <option value="facade_or_exterior_pixels">Facade or exterior pixels</option>
            <option value="capture_artifact_outside_verified_room">Capture artifact outside verified room</option>
            <option value="unverified_or_unknown_pixels">Unverified or unknown pixels</option>
          </select>
        </label>
        <label>Rectangle seam
          <select id="rectangle-seam">
            <option value="none">None</option>
            <option value="wrap">Wrap: drag from right side to left side</option>
          </select>
        </label>
        <label>Polygon seam
          <select id="polygon-seam">
            <option value="none">None</option>
            <option value="wrap_shortest">Wrap shortest</option>
          </select>
        </label>
        <button id="polygon-commit" type="button" class="quiet-button">Apply polygon</button>
        <button id="polygon-clear" type="button" class="quiet-button">Clear points</button>
        <output id="polygon-status">0 polygon points</output>
      </div>

      <div class="reason-legend" aria-label="Deterministic exclusion overlay colors">
        <span><i class="reason-one" aria-hidden="true"></i>Adjacent room</span>
        <span><i class="reason-two" aria-hidden="true"></i>Beyond portal plane</span>
        <span><i class="reason-three" aria-hidden="true"></i>Facade / exterior</span>
        <span><i class="reason-four" aria-hidden="true"></i>Capture artifact</span>
        <span><i class="reason-five" aria-hidden="true"></i>Unverified / unknown</span>
        <span><i class="reason-included" aria-hidden="true"></i>Included: transparent</span>
      </div>
    </section>

    <aside class="action-panel" aria-labelledby="actions-heading">
      <div class="panel-heading">
        <div>
          <p class="section-label">Human operator flow</p>
          <h2 id="actions-heading">Review actions</h2>
        </div>
      </div>

      <section class="action-card" aria-labelledby="source-review-actions">
        <h3 id="source-review-actions">1 · Source review</h3>
        <label>EXCLUDE note
          <textarea id="exclude-note" maxlength="1000" rows="3" placeholder="State the observed evidence for whole-frame exclusion."></textarea>
        </label>
        <button id="source-exclude" type="button" class="danger-button">Record EXCLUDE</button>
        <button id="source-leave-pending" type="button" class="quiet-button">Leave pending</button>
        <button id="mask-begin" type="button" class="primary-button">Begin pixel mask</button>
        <p class="gate-copy">Source coverage is a navigation aid. The server independently enforces every transition.</p>
      </section>

      <section class="action-card" aria-labelledby="mask-actions">
        <h3 id="mask-actions">2 · Mask authoring and review</h3>
        <button id="mask-freeze" type="button" class="primary-button">Freeze mask for review</button>
        <p>Mask review uses a separate coupled tile and coverage path. Included pixels remain transparent; excluded pixels retain their reason color.</p>
      </section>

      <section class="action-card" aria-labelledby="include-actions">
        <h3 id="include-actions">3 · INCLUDE decision</h3>
        <label>Classification
          <select id="include-classification">
            <option value="grand_hall_core">Grand Hall core</option>
            <option value="grand_hall_portal_threshold">Grand Hall portal threshold</option>
          </select>
        </label>
        <label>INCLUDE note
          <textarea id="include-note" maxlength="1000" rows="3" placeholder="State only what the supplied source evidence supports."></textarea>
        </label>
        <button id="source-include" type="button" class="primary-button">Record INCLUDE</button>
      </section>

      <section class="action-card" aria-labelledby="attestation-actions">
        <h3 id="attestation-actions">4 · Authority-none human attestation</h3>
        <label>Reviewer identifier
          <input id="reviewer-id" type="text" maxlength="160" autocomplete="off">
        </label>
        <label>Knowledge basis, one item per line
          <textarea id="knowledge-basis" maxlength="7712" rows="4" placeholder="Direct inspection of supplied panorama\nComparison with verified Grand Hall boundary"></textarea>
        </label>
        <button id="source-attest" type="button" class="primary-button">Record authority-none attestation</button>
        <p>This record is explicitly not cryptographic and grants no reconstruction, runtime, export, or publication authority.</p>
      </section>

      <section class="action-card session-actions" aria-labelledby="session-actions-heading">
        <h3 id="session-actions-heading">Session controls</h3>
        <button id="source-abandon" type="button" class="danger-button">Abandon active source</button>
        <button id="session-stop" type="button" class="danger-button">Stop local review session</button>
      </section>
    </aside>
  </main>

  <footer class="status-footer">
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
  background: #070a0d;
  color: #f4efe3;
  --ink: #f4efe3;
  --muted: #9ca4ad;
  --line: #273039;
  --panel: #0e1318;
  --panel-raised: #151b21;
  --gold: #d5aa5a;
  --gold-strong: #f1c979;
  --danger: #ff756b;
  --focus: #79c9ff;
}

* { box-sizing: border-box; }
html, body { min-height: 100%; margin: 0; }
body { background: #070a0d; color: var(--ink); }
button, input, select, textarea { font: inherit; }
button, select, input, textarea { color: var(--ink); background: #11171d; border: 1px solid var(--line); border-radius: 6px; }
button { cursor: pointer; }
button:disabled, input:disabled, select:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.42; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
textarea, input, select { width: 100%; padding: 0.55rem 0.65rem; }
textarea { resize: vertical; }
h1, h2, h3, p { margin-top: 0; }
h1, h2 { letter-spacing: -0.02em; }
h1 { font-size: 1.1rem; }
h2 { font-size: 1.05rem; }
h3 { font-size: 0.9rem; }

.skip-link { position: fixed; z-index: 100; left: 1rem; top: -5rem; padding: 0.75rem 1rem; background: var(--gold); color: #090b0d; }
.skip-link:focus { top: 1rem; }
.app-header { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--line); background: #0a0e12; }
.brand-block { display: flex; align-items: center; gap: 0.8rem; }
.brand-block strong, .brand-block span { display: block; }
.brand-block span { color: var(--muted); font-size: 0.75rem; }
.brand-mark { display: grid !important; place-items: center; width: 36px; height: 36px; border: 1px solid var(--gold); color: var(--gold); font-family: Georgia, serif; }
.session-summary { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 0.75rem; color: var(--muted); font-size: 0.78rem; }
.chip { padding: 0.25rem 0.55rem; border: 1px solid var(--line); border-radius: 999px; text-transform: uppercase; letter-spacing: 0.08em; }
.chip-active { color: #78d7a5; border-color: #315c47; }
.chip-poisoned { color: var(--danger); border-color: #743c39; }
.chip-stopped { color: #d0d4d8; }
.truth-strip { display: flex; flex-wrap: wrap; gap: 0.6rem 1.4rem; padding: 0.65rem 1rem; border-bottom: 1px solid #513e1d; background: #171207; color: #e9d1a1; font-size: 0.8rem; }
.truth-strip strong { color: var(--gold-strong); }

.workbench { display: grid; grid-template-columns: minmax(230px, 280px) minmax(0, 1fr) minmax(260px, 320px); min-height: calc(100vh - 159px); }
.source-panel, .action-panel { min-width: 0; background: var(--panel); }
.source-panel { border-right: 1px solid var(--line); }
.action-panel { border-left: 1px solid var(--line); padding-bottom: 1rem; overflow-y: auto; max-height: calc(100vh - 159px); }
.panel-heading { display: flex; justify-content: space-between; gap: 0.8rem; align-items: flex-start; padding: 1rem; border-bottom: 1px solid var(--line); }
.panel-heading h1, .panel-heading h2 { margin-bottom: 0; }
.section-label { margin-bottom: 0.3rem; color: var(--gold); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.12em; }
.quiet-count { color: var(--muted); font-size: 0.72rem; white-space: nowrap; }
.panel-help { padding: 0.75rem 1rem; margin-bottom: 0; color: var(--muted); font-size: 0.78rem; line-height: 1.5; border-bottom: 1px solid var(--line); }
.source-list { height: calc(100vh - 306px); min-height: 380px; overflow-y: auto; padding: 0.45rem; }
.source-row { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); gap: 0.65rem; width: 100%; padding: 0.65rem; margin-bottom: 0.35rem; text-align: left; background: #0d1217; }
.source-row:hover { border-color: #56616c; }
.source-row.is-active { border-color: var(--gold); background: #1a160e; }
.source-index { color: var(--gold); font-variant-numeric: tabular-nums; }
.source-copy { min-width: 0; }
.source-copy strong, .source-copy span { display: block; overflow-wrap: anywhere; }
.source-copy strong { font-size: 0.8rem; }
.source-copy span { margin-top: 0.2rem; color: var(--muted); font-size: 0.68rem; line-height: 1.35; }

.viewer-panel { min-width: 0; background: #080c10; overflow: hidden; }
.viewer-toolbar { min-height: 68px; display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--line); }
.viewer-toolbar h2 { margin-bottom: 0; }
.toolbar-cluster { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 0.4rem; }
.quiet-button, .primary-button, .danger-button, .tool-button { padding: 0.55rem 0.75rem; }
.primary-button { border-color: #735a2b; background: #3e3018; color: var(--gold-strong); }
.danger-button { border-color: #6d3430; color: #ffafa8; }
.scale-indicator { min-width: 11rem; color: var(--muted); font-size: 0.72rem; text-align: right; }
.evidence-bar { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; min-height: 38px; align-items: center; padding: 0.5rem 1rem; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.72rem; }
.source-viewport { height: min(53vh, 620px); min-height: 300px; overflow: auto; overscroll-behavior: contain; background-color: #030506; background-image: linear-gradient(45deg, #0f1419 25%, transparent 25%), linear-gradient(-45deg, #0f1419 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0f1419 75%), linear-gradient(-45deg, transparent 75%, #0f1419 75%); background-size: 24px 24px; background-position: 0 0, 0 12px, 12px -12px, -12px 0; }
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
.tile-navigator { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; padding: 0.65rem 1rem; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.75rem; }
.tile-navigator label { display: flex; align-items: center; gap: 0.35rem; }
.tile-navigator input { width: 4.5rem; }
.mask-tools { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 0.65rem; align-items: end; padding: 0.8rem 1rem; border-bottom: 1px solid var(--line); }
.mask-tools h3 { margin-bottom: 0; }
.mask-tools label { color: var(--muted); font-size: 0.72rem; }
.segmented-control { display: flex; }
.segmented-control button { flex: 1; border-radius: 0; }
.segmented-control button:first-child { border-radius: 6px 0 0 6px; }
.segmented-control button:last-child { border-radius: 0 6px 6px 0; }
.tool-button.is-selected { color: #080a0c; background: var(--gold); border-color: var(--gold); }
.reason-legend { display: flex; flex-wrap: wrap; gap: 0.65rem 1rem; padding: 0.75rem 1rem; color: var(--muted); font-size: 0.7rem; }
.reason-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
.reason-legend i { width: 12px; height: 12px; border: 1px solid #d7dce0; }
.reason-one { background: rgba(255, 91, 76, 0.78); }
.reason-two { background: rgba(255, 183, 3, 0.78); }
.reason-three { background: rgba(160, 103, 245, 0.78); }
.reason-four { background: rgba(0, 194, 255, 0.78); }
.reason-five { background: rgba(235, 64, 122, 0.78); }
.reason-included { background: transparent; }

.action-card { padding: 0.9rem 1rem; border-bottom: 1px solid var(--line); }
.action-card h3 { color: var(--gold-strong); }
.action-card label { display: block; margin: 0.6rem 0; color: var(--muted); font-size: 0.75rem; }
.action-card button { width: 100%; margin-top: 0.45rem; }
.action-card p { margin: 0.65rem 0 0; color: var(--muted); font-size: 0.72rem; line-height: 1.5; }
.gate-copy { color: #dbc494 !important; }
.status-footer { min-height: 53px; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: center; padding: 0.65rem 1rem; border-top: 1px solid var(--line); background: #0a0e12; font-size: 0.78rem; }
#session-error { color: var(--danger); text-align: right; }

@media (max-width: 1180px) {
  .workbench { grid-template-columns: 230px minmax(0, 1fr); }
  .action-panel { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); max-height: none; border-left: 0; border-top: 1px solid var(--line); overflow-x: auto; }
  .action-panel > .panel-heading { display: none; }
  .action-card { border-right: 1px solid var(--line); }
  .mask-tools { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
}

@media (max-width: 760px) {
  .app-header { align-items: flex-start; }
  .workbench { display: block; }
  .source-list { height: 240px; min-height: 0; }
  .source-panel { border-right: 0; border-bottom: 1px solid var(--line); }
  .viewer-toolbar { align-items: flex-start; flex-direction: column; }
  .toolbar-cluster { justify-content: flex-start; }
  .scale-indicator { text-align: left; }
  .mask-tools { display: block; }
  .mask-tools > * { margin-bottom: 0.65rem; }
  .action-panel { display: block; }
  .status-footer { grid-template-columns: 1fr; }
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
    for (const id of ["exclude-note", "include-note", "reviewer-id", "knowledge-basis"]) {
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
    if (record.state === "no_recorded_decision") return "No durable decision";
    const decision = record.decision.result + " · " + record.decision.classification;
    return record.state === "authority_none_attestation_recorded"
      ? decision + " · authority-none attestation"
      : decision + " · attestation not recorded";
  }

  function setControlDisabled(id, disabled) {
    requireElement(id).disabled = disabled;
  }

  function renderSourceList() {
    sourceList.replaceChildren();
    if (operatorState === null) return;
    let recordedCount = 0;
    for (const source of operatorState.sources) {
      if (source.authorityNoneRecord.state !== "no_recorded_decision") recordedCount += 1;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "source-row";
      row.setAttribute("role", "listitem");
      const isActive = operatorState.activeSource !== null && operatorState.activeSource.inventoryIndex === source.inventoryIndex;
      if (isActive) {
        row.classList.add("is-active");
        row.setAttribute("aria-current", "true");
      }
      row.disabled = operatorState.lifecycle !== "active" || mutationInFlight;
      const index = document.createElement("span");
      index.className = "source-index";
      index.textContent = String(source.inventoryIndex + 1).padStart(3, "0");
      const copy = document.createElement("span");
      copy.className = "source-copy";
      const title = document.createElement("strong");
      title.textContent = "Sweep " + String(source.sweepNumber);
      const observation = document.createElement("span");
      observation.textContent = observationCopy(source.agentObservation);
      const history = document.createElement("span");
      history.textContent = historyCopy(source.authorityNoneRecord);
      copy.append(title, observation, history);
      row.append(index, copy);
      row.addEventListener("click", () => {
        void selectSource(source.inventoryIndex).catch(showFailure);
      });
      sourceList.append(row);
    }
    requireElement("history-count").textContent = String(recordedCount) + " recorded";
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

  function activePhaseIs(phase) {
    return operatorState !== null && operatorState.activeSource !== null && operatorState.activeSource.phase === phase;
  }

  function renderActionGates() {
    const active = operatorState === null ? null : operatorState.activeSource;
    const sessionActive = operatorState !== null && operatorState.lifecycle === "active" && !mutationInFlight;
    const sourceReview = sessionActive && active !== null && active.phase === "source_review";
    const maskEdit = sessionActive && active !== null && active.phase === "mask_edit";
    const maskReview = sessionActive && active !== null && active.phase === "mask_review";
    const decisionRecorded = sessionActive && active !== null && active.phase === "decision_recorded";
    const sourceCoverageComplete = sourceReview && active.sourceCoverage.complete;
    setControlDisabled("source-exclude", !(sourceCoverageComplete && requireElement("exclude-note").value.trim().length > 0));
    setControlDisabled("source-leave-pending", !sourceReview);
    setControlDisabled("mask-begin", !sourceCoverageComplete);
    setControlDisabled("mask-freeze", !maskEdit);
    setControlDisabled("source-include", !(maskReview && maskReviewCoverageComplete && requireElement("include-note").value.trim().length > 0));
    setControlDisabled("source-attest", !(decisionRecorded && requireElement("reviewer-id").value.trim().length > 0 && knowledgeBasisFromInput(false).length > 0));
    setControlDisabled("source-abandon", !(sessionActive && active !== null));
    setControlDisabled("session-stop", !sessionActive);
    for (const id of ["tool-rectangle", "tool-polygon", "mask-operation", "rectangle-seam", "polygon-seam", "polygon-commit", "polygon-clear"]) {
      setControlDisabled(id, !maskEdit);
    }
    setControlDisabled("mask-reason", !maskEdit || requireElement("mask-operation").value === "include");
  }

  function renderActiveSource() {
    const active = operatorState === null ? null : operatorState.activeSource;
    if (active === null) {
      requireElement("viewer-heading").textContent = "Select a source to inspect";
      requireElement("phase-label").textContent = "No active source";
      requireElement("source-coverage-label").textContent = "Source coverage 0 / 512";
      requireElement("mask-coverage-label").textContent = "Mask-review coverage not active";
      requireElement("mask-revision-label").textContent = "Mask not begun";
      return;
    }
    requireElement("viewer-heading").textContent = "Source " + String(active.inventoryIndex + 1) + " · Sweep " + String(active.sweepNumber);
    requireElement("phase-label").textContent = "Phase " + active.phase;
    requireElement("source-coverage-label").textContent = "Source coverage " + String(active.sourceCoverage.completedTileCount) + " / 512" + (active.sourceCoverage.complete ? " · complete" : "");
    requireElement("mask-coverage-label").textContent = active.phase === "mask_review"
      ? "Mask-review coverage " + String(maskReviewCompletedTileCount) + " / 512 completed · " + String(maskReviewDeliveredTileCount) + " delivered" + (maskReviewCoverageComplete ? " · complete" : "")
      : "Mask-review coverage not active";
    requireElement("mask-revision-label").textContent = active.mask === null
      ? "Mask not begun"
      : "Mask revision " + String(active.mask.revision) + (active.mask.frozen ? " · frozen" : " · editable");
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
    if (nextState.activeSource === null || nextState.activeSource.phase !== "mask_edit") setPointerMode("pan");
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
    const note = requireElement("exclude-note").value.trim();
    if (note.length < 1 || note.length > 1000) throw new Error("EXCLUDE note must contain 1 to 1000 characters.");
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
    const active = requireActiveSource("mask_edit");
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
    const active = requireActiveSource("mask_edit");
    await runStateMutation(routes.maskEdit, {
      ...epochRevisionGeneration(requestSchemas.maskEdit, active),
      edit: edit,
    }, "Applied an exact integer source-coordinate mask edit.");
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
    const note = requireElement("include-note").value.trim();
    if (note.length < 1 || note.length > 1000) throw new Error("INCLUDE note must contain 1 to 1000 characters.");
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
    requireActiveSource("mask_edit");
    if (polygonPoints.length >= maximumPolygonPointCount) throw new Error("Polygon point limit is 512.");
    polygonPoints.push(Object.freeze(sourcePoint(event)));
    renderPolygonStatus();
    setStatus("Polygon point " + String(polygonPoints.length) + " recorded in integer source coordinates.");
  }

  async function submitPolygon() {
    requireActiveSource("mask_edit");
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
        requireActiveSource("mask_edit");
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

  for (const id of ["exclude-note", "include-note", "reviewer-id", "knowledge-basis", "mask-operation"]) {
    requireElement(id).addEventListener("input", renderActionGates);
    requireElement(id).addEventListener("change", renderActionGates);
  }

  document.addEventListener("keydown", (event) => {
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
