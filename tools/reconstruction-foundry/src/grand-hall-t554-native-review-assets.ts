export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_COUNT = 148;
export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_WIDTH_PX = 8_192;
export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_HEIGHT_PX = 4_096;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX = 256;
export const GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX = 256;
export const GRAND_HALL_T554_RAW_RGB8_TILE_BYTE_LENGTH =
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX *
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX *
  3;

export const GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS = Object.freeze({
  document: "/",
  stylesheet: "/assets/t554-native-review-v1.css",
  script: "/assets/t554-native-review-v1.js",
  bootstrap: "/api/bootstrap",
  state: "/api/state",
  selectSource: "/api/source/select",
  tile: "/api/source/tile",
  telemetry: "/api/source/telemetry",
  decision: "/api/source/decision",
  maskPrimitive: "/api/source/mask-primitive",
} as const);

export type GrandHallT554NativeReviewDecisionV1 =
  | "INCLUDE"
  | "EXCLUDE"
  | "UNSURE";

export type GrandHallT554NativeReviewObservationV1 =
  | "GRAND_HALL_PIXELS_OBSERVED"
  | "NO_GRAND_HALL_PIXELS_OBSERVED";

export type GrandHallT554NativeReviewDecisionReasonV1 =
  | "grand_hall_pixels_observed"
  | "no_grand_hall_pixels_observed"
  | "further_inspection_required";

export type GrandHallT554NativeReviewMaskReasonV1 =
  | "grand_hall_evidence"
  | "adjacent_room"
  | "facade"
  | "invented_or_generated_content"
  | "capture_artifact"
  | "unknown";

export interface GrandHallT554NativeReviewBootstrapRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-bootstrap-request.v1";
  readonly bootstrap: string;
}

export interface GrandHallT554NativeReviewBootstrapResponseV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-bootstrap-response.v1";
  readonly bearer: string;
}

export interface GrandHallT554NativeReviewStateRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-state-request.v1";
}

export interface GrandHallT554NativeReviewSourceRailRowV1 {
  readonly inventoryIndex: number;
  readonly sweepLabel: string;
  readonly observation: GrandHallT554NativeReviewObservationV1;
  readonly decision: GrandHallT554NativeReviewDecisionV1;
  readonly sourceCoverageCompletedTileCount: number;
  readonly sourceCoverageComplete: boolean;
}

export interface GrandHallT554NativeReviewCoverageSummaryV1 {
  readonly completedTileCount: number;
  readonly totalTileCount: 512;
  readonly complete: boolean;
  readonly effectiveDevicePixelsPerSourcePixel: number | null;
  readonly disqualifier:
    | "first_sample"
    | "document_not_visible"
     | "document_not_focused"
     | "below_native_device_scale"
     | "heartbeat_gap_exceeded"
     | "no_fully_visible_delivered_tiles"
    | "no_continuously_visible_tiles"
    | null;
}

export interface GrandHallT554NativeReviewActiveSourceV1 {
  readonly inventoryIndex: number;
  readonly sessionNonce: string;
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly nextTelemetrySequence: number;
  readonly sourceWidthPx: 8_192;
  readonly sourceHeightPx: 4_096;
  readonly tileWidthPx: 256;
  readonly tileHeightPx: 256;
  readonly tileColumnCount: 32;
  readonly tileRowCount: 16;
  readonly coverage: GrandHallT554NativeReviewCoverageSummaryV1;
}

export interface GrandHallT554NativeReviewStateResponseV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-state-response.v1";
  readonly workspaceRevision: number;
  readonly authority: "none";
  readonly exactEvidence: {
    readonly status: "verified" | "failed";
    readonly reviewPackSemanticSha256: string;
    readonly publicationReceiptFileSha256: string;
  };
  readonly sources: readonly GrandHallT554NativeReviewSourceRailRowV1[];
  readonly activeSource: GrandHallT554NativeReviewActiveSourceV1 | null;
}

export interface GrandHallT554NativeReviewSelectSourceRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-select-source-request.v1";
  readonly inventoryIndex: number;
  readonly expectedRevision: number;
}

export interface GrandHallT554NativeReviewTileRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-tile-request.v1";
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly column: number;
  readonly row: number;
}

export interface GrandHallT554NativeReviewTelemetryRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-telemetry-sample.v1";
  readonly sessionNonce: string;
  readonly sourceEpochNonce: string;
  readonly renderGeneration: number;
  readonly sequence: number;
  readonly documentVisibilityState: "visible" | "hidden" | "prerender";
  readonly documentFocusState: "focused" | "blurred";
  readonly viewportCssWidth: number;
  readonly viewportCssHeight: number;
  readonly devicePixelRatio: number;
  readonly sourceToCssTransform: {
    readonly a: number;
    readonly b: 0;
    readonly c: 0;
    readonly d: number;
    readonly e: number;
    readonly f: number;
  };
  readonly paintedTiles: readonly {
    readonly column: number;
    readonly row: number;
    readonly generation: number;
  }[];
}

export interface GrandHallT554NativeReviewTelemetryResponseV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-telemetry-response.v1";
  readonly nextTelemetrySequence: number;
  readonly coverage: GrandHallT554NativeReviewCoverageSummaryV1;
}

export interface GrandHallT554NativeReviewDecisionRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-decision-request.v1";
  readonly expectedRevision: number;
  readonly decision: GrandHallT554NativeReviewDecisionV1;
  readonly reason: GrandHallT554NativeReviewDecisionReasonV1;
}

export interface GrandHallT554NativeReviewMaskPrimitiveRequestV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-mask-primitive-request.v1";
  readonly expectedRevision: number;
  readonly reason: GrandHallT554NativeReviewMaskReasonV1;
  readonly primitive: {
    readonly kind: "rectangle";
    readonly operation: "include" | "exclude";
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface GrandHallT554NativeReviewApiRouteV1 {
  readonly method: "POST";
  readonly path: string;
  readonly requestContentType: "application/json";
  readonly responseContentType:
    | "application/json"
    | "application/vnd.venviewer.rgb8";
  readonly bearerRequired: boolean;
  readonly requestFields: readonly string[];
}

/**
 * Closed route and exact-key contract for the later loopback server. No route
 * permits a filesystem path, URL, byte claim, digest claim, or mask payload.
 */
export const GRAND_HALL_T554_NATIVE_REVIEW_API_CONTRACT = Object.freeze({
  bootstrap: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.bootstrap,
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerRequired: false,
    requestFields: Object.freeze(["schemaVersion", "bootstrap"]),
  }),
  state: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.state,
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerRequired: true,
    requestFields: Object.freeze(["schemaVersion"]),
  }),
  selectSource: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.selectSource,
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerRequired: true,
    requestFields: Object.freeze([
      "schemaVersion",
      "inventoryIndex",
      "expectedRevision",
    ]),
  }),
  tile: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.tile,
    requestContentType: "application/json",
    responseContentType: "application/vnd.venviewer.rgb8",
    bearerRequired: true,
    requestFields: Object.freeze([
      "schemaVersion",
      "sourceEpochNonce",
      "renderGeneration",
      "column",
      "row",
    ]),
  }),
  telemetry: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.telemetry,
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerRequired: true,
    requestFields: Object.freeze([
      "schemaVersion",
      "sessionNonce",
      "sourceEpochNonce",
      "renderGeneration",
      "sequence",
      "documentVisibilityState",
      "documentFocusState",
      "viewportCssWidth",
      "viewportCssHeight",
      "devicePixelRatio",
      "sourceToCssTransform",
      "paintedTiles",
    ]),
  }),
  decision: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.decision,
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerRequired: true,
    requestFields: Object.freeze([
      "schemaVersion",
      "expectedRevision",
      "decision",
      "reason",
    ]),
  }),
  maskPrimitive: Object.freeze({
    method: "POST",
    path: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.maskPrimitive,
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerRequired: true,
    requestFields: Object.freeze([
      "schemaVersion",
      "expectedRevision",
      "reason",
      "primitive",
    ]),
  }),
} satisfies Readonly<Record<string, GrandHallT554NativeReviewApiRouteV1>>);

export function assertGrandHallT554RawRgb8TileLength(byteLength: number): void {
  if (byteLength !== GRAND_HALL_T554_RAW_RGB8_TILE_BYTE_LENGTH) {
    throw new RangeError(
      "Grand Hall native-review RGB8 tile byte length is not exactly 256 x 256 x 3.",
    );
  }
}

export const GRAND_HALL_T554_NATIVE_REVIEW_HTML = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Grand Hall native evidence review</title>
  <link rel="stylesheet" href="${GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.stylesheet}">
  <script src="${GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.script}" defer></script>
</head>
<body>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">VENVIEWER · T-554 · PRIVATE LOOPBACK</p>
        <h1>Grand Hall native evidence review</h1>
      </div>
      <div class="evidence-strip" aria-label="Evidence status">
        <span id="evidence-status" class="status-chip">Evidence bytes: checking</span>
        <span id="authority-status" class="status-chip status-chip-caution">Authority: none</span>
        <span id="workspace-revision" class="status-chip">Revision: —</span>
      </div>
    </header>

    <section class="truth-warning" aria-label="Scope warning">
      <strong>Grand Hall source evidence only.</strong>
      Exclude adjacent rooms, facade imagery, invented content, generated fill,
      capture artifacts, and every pixel that cannot be supported by the supplied data.
    </section>

    <div class="workbench-grid">
      <aside class="source-panel" aria-label="148 source panoramas">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">FIXED REGISTRY</p>
            <h2>148 sources</h2>
          </div>
          <span id="source-progress">0 / 148 resolved</span>
        </div>
        <nav id="source-list" class="source-list" aria-label="Source rail"></nav>
      </aside>

      <section class="review-panel" aria-label="Native source inspection">
        <header class="source-heading">
          <div>
            <p id="source-index" class="eyebrow">SOURCE — / 148</p>
            <h2 id="source-sweep">No source selected</h2>
            <p id="source-observation" class="observation">Observation: —</p>
          </div>
          <div class="coverage-summary">
            <span id="coverage-progress">Native-grid coverage: 0 / 512</span>
            <span id="scale-status">Device scale: —</span>
          </div>
        </header>

        <div class="viewer-toolbar" aria-label="View and mask tools">
          <div class="tool-group">
            <button id="zoom-out" type="button">− Zoom</button>
            <button id="zoom-native" type="button">1:1 native</button>
            <button id="zoom-in" type="button">+ Zoom</button>
          </div>
          <div class="tool-group" role="group" aria-label="Pointer mode">
            <button id="mode-pan" class="is-selected" type="button">Pan</button>
            <button id="mode-include" type="button">Mark Grand Hall</button>
            <button id="mode-exclude" type="button">Mark excluded / unknown</button>
          </div>
          <label class="reason-control" for="mask-reason">
            Region reason
            <select id="mask-reason">
              <option value="grand_hall_evidence">Grand Hall evidence</option>
              <option value="adjacent_room">Adjacent room</option>
              <option value="facade">Facade</option>
              <option value="invented_or_generated_content">Invented or generated content</option>
              <option value="capture_artifact">Capture artifact</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>

        <div id="source-viewport" class="source-viewport" tabindex="0" aria-label="8192 by 4096 exact source canvas">
          <div id="canvas-stage" class="canvas-stage zoom-025">
            <canvas id="source-canvas" width="8192" height="4096"></canvas>
          </div>
        </div>

        <footer class="decision-bar">
          <div>
            <p class="eyebrow">SOURCE DECISION</p>
            <p class="decision-note">A decision records review state only. It grants no authority.</p>
          </div>
          <div class="decision-actions" role="group" aria-label="Source decision">
            <button id="decision-include" class="decision-include" type="button">INCLUDE</button>
            <button id="decision-exclude" class="decision-exclude" type="button">EXCLUDE</button>
            <button id="decision-unsure" class="decision-unsure" type="button">UNSURE</button>
          </div>
        </footer>
      </section>
    </div>

    <footer class="session-footer">
      <span id="session-status" role="status" aria-live="polite">Starting private review session…</span>
      <span>Exact RGB8 tiles · no wrap · no interpolation · no generated fill</span>
    </footer>
  </main>
</body>
</html>
`;

export const GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #090d10;
  color: #edf1ef;
}

* { box-sizing: border-box; }

html, body { width: 100%; min-width: 980px; height: 100%; margin: 0; overflow: hidden; }
body { background: radial-gradient(circle at 72% 0%, #17231f 0, #090d10 36rem); }
button, select { font: inherit; }
button { color: inherit; }

.app-shell { display: flex; flex-direction: column; height: 100vh; padding: 14px; gap: 10px; }
.topbar { display: flex; align-items: center; justify-content: space-between; min-height: 68px; padding: 0 16px; border: 1px solid #27332f; border-radius: 12px; background: #101714; }
h1, h2, p { margin: 0; }
h1 { font-family: Georgia, "Times New Roman", serif; font-size: 25px; font-weight: 500; letter-spacing: .02em; }
h2 { font-size: 16px; font-weight: 650; }
.eyebrow { margin-bottom: 5px; color: #b99c60; font-size: 10px; font-weight: 750; letter-spacing: .16em; }
.evidence-strip { display: flex; align-items: center; gap: 8px; }
.status-chip { padding: 7px 10px; border: 1px solid #34413c; border-radius: 999px; color: #cbd5d0; background: #0b100e; font-size: 11px; }
.status-chip-good { border-color: #326c51; color: #94ddb4; }
.status-chip-bad { border-color: #87463f; color: #ffaaa0; }
.status-chip-caution { border-color: #695735; color: #e5c77c; }
.truth-warning { padding: 9px 14px; border: 1px solid #715b2f; border-radius: 9px; background: #1c180f; color: #e4d5ad; font-size: 12px; line-height: 1.45; }
.truth-warning strong { color: #f2d58a; }

.workbench-grid { display: grid; grid-template-columns: 274px minmax(0, 1fr); min-height: 0; flex: 1; gap: 10px; }
.source-panel, .review-panel { min-height: 0; border: 1px solid #27332f; border-radius: 12px; background: #0d1311; overflow: hidden; }
.source-panel { display: flex; flex-direction: column; }
.panel-heading { display: flex; justify-content: space-between; align-items: end; padding: 14px; border-bottom: 1px solid #27332f; }
.panel-heading > span { color: #93a29b; font-size: 11px; }
.source-list { min-height: 0; padding: 7px; overflow: auto; scrollbar-color: #46564f #111916; }
.source-row { display: grid; grid-template-columns: 42px 1fr auto; width: 100%; margin: 0 0 5px; padding: 9px 8px; gap: 8px; border: 1px solid transparent; border-radius: 8px; background: #131b18; text-align: left; cursor: pointer; }
.source-row:hover, .source-row:focus-visible { border-color: #7d6840; outline: none; }
.source-row.is-active { border-color: #c19c50; background: #211c12; }
.source-number { color: #b99c60; font-variant-numeric: tabular-nums; }
.source-name { overflow: hidden; color: #dfe6e2; text-overflow: ellipsis; white-space: nowrap; }
.source-decision { padding: 2px 5px; border-radius: 4px; color: #a4b0aa; background: #26302c; font-size: 9px; font-weight: 750; }
.source-decision.decision-INCLUDE { color: #9fe0b9; background: #173323; }
.source-decision.decision-EXCLUDE { color: #f1aaa4; background: #3a201f; }
.source-decision.decision-UNSURE { color: #e3c87f; background: #372f1c; }

.review-panel { display: flex; flex-direction: column; }
.source-heading { display: flex; justify-content: space-between; align-items: center; min-height: 72px; padding: 12px 16px; border-bottom: 1px solid #27332f; }
.observation { margin-top: 5px; color: #9ba9a3; font-size: 11px; }
.coverage-summary { display: grid; justify-items: end; gap: 5px; color: #aab6b0; font-size: 11px; font-variant-numeric: tabular-nums; }
.viewer-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 7px 10px; gap: 8px; border-bottom: 1px solid #27332f; background: #111916; }
.tool-group { display: flex; gap: 5px; }
.viewer-toolbar button, .viewer-toolbar select, .decision-actions button { border: 1px solid #394740; border-radius: 7px; background: #151f1b; }
.viewer-toolbar button { padding: 7px 9px; cursor: pointer; }
.viewer-toolbar button:hover, .viewer-toolbar button:focus-visible, .viewer-toolbar button.is-selected { border-color: #b48e44; background: #2b2416; outline: none; }
.reason-control { display: flex; align-items: center; gap: 7px; color: #9da9a4; font-size: 11px; }
.reason-control select { max-width: 210px; padding: 6px; color: #dfe7e3; }
.source-viewport { position: relative; min-height: 0; flex: 1; overflow: auto; background-color: #070a09; background-image: linear-gradient(45deg, #111714 25%, transparent 25%), linear-gradient(-45deg, #111714 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111714 75%), linear-gradient(-45deg, transparent 75%, #111714 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; scrollbar-color: #526159 #0a0e0c; }
.source-viewport:focus-visible { outline: 2px solid #c19c50; outline-offset: -2px; }
.canvas-stage { position: relative; transform-origin: 0 0; }
.canvas-stage canvas { position: absolute; inset: 0 auto auto 0; display: block; width: 8192px; height: 4096px; transform-origin: 0 0; image-rendering: pixelated; }
.canvas-stage.zoom-025 { width: 2048px; height: 1024px; }
.canvas-stage.zoom-025 canvas { transform: scale(.25); }
.canvas-stage.zoom-050 { width: 4096px; height: 2048px; }
.canvas-stage.zoom-050 canvas { transform: scale(.5); }
.canvas-stage.zoom-100 { width: 8192px; height: 4096px; }
.canvas-stage.zoom-100 canvas { transform: scale(1); }
.canvas-stage.zoom-200 { width: 16384px; height: 8192px; }
.canvas-stage.zoom-200 canvas { transform: scale(2); }
.canvas-stage.zoom-400 { width: 32768px; height: 16384px; }
.canvas-stage.zoom-400 canvas { transform: scale(4); }
.source-viewport.mode-pan canvas { cursor: grab; }
.source-viewport.mode-pan.is-panning canvas { cursor: grabbing; }
.source-viewport.mode-mask canvas { cursor: crosshair; }

.decision-bar { display: flex; align-items: center; justify-content: space-between; min-height: 66px; padding: 9px 14px; border-top: 1px solid #27332f; background: #111815; }
.decision-note { color: #8f9d96; font-size: 11px; }
.decision-actions { display: flex; gap: 8px; }
.decision-actions button { min-width: 96px; padding: 10px 14px; font-size: 11px; font-weight: 800; letter-spacing: .08em; cursor: pointer; }
.decision-actions button:focus-visible { outline: 2px solid #d3ad60; outline-offset: 2px; }
.decision-include { border-color: #397454 !important; color: #a9e6c0; }
.decision-exclude { border-color: #844d46 !important; color: #efaea7; }
.decision-unsure { border-color: #78643b !important; color: #e2c67e; }
.session-footer { display: flex; justify-content: space-between; padding: 0 5px; color: #7f8e87; font-size: 10px; }
.session-footer [role="status"] { color: #c6d0cb; }
button:disabled, select:disabled { cursor: not-allowed; opacity: .45; }
`;

const CLIENT_ROUTE_JSON = JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS);

export const GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT = String.raw`(() => {
  "use strict";

  const routes = ${CLIENT_ROUTE_JSON};
  const sourceCount = 148;
  const sourceWidth = 8192;
  const sourceHeight = 4096;
  const tileWidth = 256;
  const tileHeight = 256;
  const tileColumns = 32;
  const tileRows = 16;
  const rawTileByteLength = tileWidth * tileHeight * 3;
  const zoomScales = [0.25, 0.5, 1, 2, 4];
  const zoomClasses = ["zoom-025", "zoom-050", "zoom-100", "zoom-200", "zoom-400"];
  const apiPaths = new Set([
    routes.state,
    routes.selectSource,
    routes.tile,
    routes.telemetry,
    routes.decision,
    routes.maskPrimitive,
  ]);
  const decisionReasons = Object.freeze({
    INCLUDE: "grand_hall_pixels_observed",
    EXCLUDE: "no_grand_hall_pixels_observed",
    UNSURE: "further_inspection_required",
  });
  const maskReasons = new Set([
    "grand_hall_evidence",
    "adjacent_room",
    "facade",
    "invented_or_generated_content",
    "capture_artifact",
    "unknown",
  ]);

  const requireElement = (id) => {
    const element = document.getElementById(id);
    if (element === null) throw new Error("Required review element is missing.");
    return element;
  };

  const sourceList = requireElement("source-list");
  const sourceCanvas = requireElement("source-canvas");
  const sourceViewport = requireElement("source-viewport");
  const canvasStage = requireElement("canvas-stage");
  const context = sourceCanvas.getContext("2d", { alpha: true });
  if (context === null) throw new Error("The exact source canvas is unavailable.");
  context.imageSmoothingEnabled = false;

  let bearer = null;
  let reviewState = null;
  let paintedTiles = new Map();
  let zoomIndex = 0;
  let pointerMode = "pan";
  let pointerStart = null;
  let mutationInFlight = false;
  let telemetryInFlight = false;
  let sourceLoadSerial = 0;
  let activeTileController = null;

  const setSessionStatus = (message) => {
    requireElement("session-status").textContent = message;
  };

  const showFailure = () => {
    setSessionStatus("The local review operation failed closed. Check the operator terminal.");
  };

  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isSafeNonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
  const isSha256 = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  const isNonce = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

  const exchangeBootstrap = async () => {
    const fragment = window.location.hash;
    const match = /^#bootstrap=([A-Za-z0-9_-]{43})$/.exec(fragment);
    window.history.replaceState(null, document.title, window.location.pathname);
    if (match === null) throw new Error("The one-time review fragment is missing.");
    let bootstrapSecret = match[1];
    const response = await fetch(routes.bootstrap, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "venviewer.grand-hall-t554-native-review-bootstrap-request.v1",
        bootstrap: bootstrapSecret,
      }),
    });
    bootstrapSecret = "";
    if (!response.ok) throw new Error("The one-time review exchange failed.");
    const value = await response.json();
    if (
      !isRecord(value) ||
      value.schemaVersion !== "venviewer.grand-hall-t554-native-review-bootstrap-response.v1" ||
      !isNonce(value.bearer)
    ) throw new Error("The local review session response is invalid.");
    bearer = value.bearer;
  };

  const apiFetch = async (path, body, signal) => {
    if (bearer === null || !apiPaths.has(path)) throw new Error("The local API route is unavailable.");
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
      headers: {
        Authorization: "Bearer " + bearer,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("The local review server rejected the request.");
    return response;
  };

  const apiJson = async (path, body) => {
    const response = await apiFetch(path, body);
    const value = await response.json();
    if (!isRecord(value)) throw new Error("The local review response is invalid.");
    return value;
  };

  const validateCoverage = (coverage) => {
    if (
      !isRecord(coverage) ||
      !isSafeNonnegativeInteger(coverage.completedTileCount) ||
      coverage.completedTileCount > 512 ||
      coverage.totalTileCount !== 512 ||
      typeof coverage.complete !== "boolean"
    ) throw new Error("The coverage response is invalid.");
  };

  const validateActiveSource = (active) => {
    if (active === null) return;
    if (
      !isRecord(active) ||
      !isSafeNonnegativeInteger(active.inventoryIndex) ||
      active.inventoryIndex >= sourceCount ||
      !isNonce(active.sessionNonce) ||
      !isNonce(active.sourceEpochNonce) ||
      !Number.isSafeInteger(active.renderGeneration) ||
      active.renderGeneration < 1 ||
      !isSafeNonnegativeInteger(active.nextTelemetrySequence) ||
      active.sourceWidthPx !== sourceWidth ||
      active.sourceHeightPx !== sourceHeight ||
      active.tileWidthPx !== tileWidth ||
      active.tileHeightPx !== tileHeight ||
      active.tileColumnCount !== tileColumns ||
      active.tileRowCount !== tileRows
    ) throw new Error("The active source response is invalid.");
    validateCoverage(active.coverage);
  };

  const validateState = (nextState) => {
    if (
      !isRecord(nextState) ||
      nextState.schemaVersion !== "venviewer.grand-hall-t554-native-review-state-response.v1" ||
      !isSafeNonnegativeInteger(nextState.workspaceRevision) ||
      nextState.authority !== "none" ||
      !isRecord(nextState.exactEvidence) ||
      (nextState.exactEvidence.status !== "verified" && nextState.exactEvidence.status !== "failed") ||
      !isSha256(nextState.exactEvidence.reviewPackSemanticSha256) ||
      !isSha256(nextState.exactEvidence.publicationReceiptFileSha256) ||
      !Array.isArray(nextState.sources)
    ) throw new Error("The review state response is invalid.");
    if (nextState.sources.length !== 148) throw new Error("The fixed review registry must contain 148 sources.");
    nextState.sources.forEach((source, index) => {
      if (
        !isRecord(source) ||
        source.inventoryIndex !== index ||
        typeof source.sweepLabel !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(source.sweepLabel) ||
        (source.observation !== "GRAND_HALL_PIXELS_OBSERVED" && source.observation !== "NO_GRAND_HALL_PIXELS_OBSERVED") ||
        (source.decision !== "INCLUDE" && source.decision !== "EXCLUDE" && source.decision !== "UNSURE") ||
        !isSafeNonnegativeInteger(source.sourceCoverageCompletedTileCount) ||
        source.sourceCoverageCompletedTileCount > 512 ||
        typeof source.sourceCoverageComplete !== "boolean"
      ) throw new Error("A fixed source registry row is invalid.");
    });
    validateActiveSource(nextState.activeSource);
  };

  const decisionClass = (decision) => {
    if (decision === "INCLUDE") return "decision-INCLUDE";
    if (decision === "EXCLUDE") return "decision-EXCLUDE";
    return "decision-UNSURE";
  };

  const observationLabel = (observation) => observation === "GRAND_HALL_PIXELS_OBSERVED"
    ? "Grand Hall pixels observed by the attention aid"
    : "No Grand Hall pixels observed by the attention aid";

  const renderRail = () => {
    sourceList.replaceChildren();
    if (reviewState === null) return;
    const activeIndex = reviewState.activeSource === null ? -1 : reviewState.activeSource.inventoryIndex;
    let resolved = 0;
    reviewState.sources.forEach((source) => {
      if (source.decision !== "UNSURE") resolved += 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source-row" + (source.inventoryIndex === activeIndex ? " is-active" : "");
      if (source.inventoryIndex === activeIndex) button.setAttribute("aria-current", "true");
      const number = document.createElement("span");
      number.className = "source-number";
      number.textContent = String(source.inventoryIndex + 1).padStart(3, "0");
      const name = document.createElement("span");
      name.className = "source-name";
      name.textContent = source.sweepLabel;
      const decision = document.createElement("span");
      decision.className = "source-decision " + decisionClass(source.decision);
      decision.textContent = source.decision;
      button.append(number, name, decision);
      button.addEventListener("click", () => {
        void selectSource(source.inventoryIndex).catch(showFailure);
      });
      sourceList.append(button);
    });
    requireElement("source-progress").textContent = String(resolved) + " / 148 resolved";
  };

  const renderEvidence = () => {
    if (reviewState === null) return;
    const evidence = requireElement("evidence-status");
    evidence.textContent = reviewState.exactEvidence.status === "verified"
      ? "Evidence bytes: exact"
      : "Evidence bytes: failed closed";
    evidence.className = "status-chip " + (reviewState.exactEvidence.status === "verified" ? "status-chip-good" : "status-chip-bad");
    requireElement("workspace-revision").textContent = "Revision: " + String(reviewState.workspaceRevision);
  };

  const renderActiveSource = () => {
    if (reviewState === null || reviewState.activeSource === null) {
      requireElement("source-index").textContent = "SOURCE — / 148";
      requireElement("source-sweep").textContent = "No source selected";
      requireElement("source-observation").textContent = "Observation: —";
      return;
    }
    const active = reviewState.activeSource;
    const source = reviewState.sources[active.inventoryIndex];
    requireElement("source-index").textContent = "SOURCE " + String(active.inventoryIndex + 1) + " / 148";
    requireElement("source-sweep").textContent = source.sweepLabel;
    requireElement("source-observation").textContent = "Observation: " + observationLabel(source.observation);
    renderCoverage(active.coverage);
  };

  const renderCoverage = (coverage) => {
    requireElement("coverage-progress").textContent = "Native-grid coverage: " + String(coverage.completedTileCount) + " / 512";
    const scale = coverage.effectiveDevicePixelsPerSourcePixel;
    requireElement("scale-status").textContent = scale === null
      ? "Device scale: waiting"
      : "Device scale: " + scale.toFixed(2) + " px / source px";
  };

  const installState = (nextState) => {
    validateState(nextState);
    const previousKey = reviewState === null || reviewState.activeSource === null
      ? ""
      : reviewState.activeSource.sourceEpochNonce + ":" + String(reviewState.activeSource.renderGeneration);
    reviewState = nextState;
    const nextKey = nextState.activeSource === null
      ? ""
      : nextState.activeSource.sourceEpochNonce + ":" + String(nextState.activeSource.renderGeneration);
    renderEvidence();
    renderRail();
    renderActiveSource();
    if (previousKey !== nextKey) beginSourcePaint();
  };

  const rgbToImageData = (raw) => {
    if (raw.byteLength !== rawTileByteLength) throw new Error("The raw RGB8 tile byte length is invalid.");
    const imageData = context.createImageData(tileWidth, tileHeight);
    const rgba = imageData.data;
    let sourceOffset = 0;
    let targetOffset = 0;
    while (sourceOffset < raw.byteLength) {
      rgba[targetOffset] = raw[sourceOffset];
      rgba[targetOffset + 1] = raw[sourceOffset + 1];
      rgba[targetOffset + 2] = raw[sourceOffset + 2];
      rgba[targetOffset + 3] = 255;
      sourceOffset += 3;
      targetOffset += 4;
    }
    return imageData;
  };

  const fetchAndPaintTile = async (active, column, row, serial, signal) => {
    const response = await apiFetch(routes.tile, {
      schemaVersion: "venviewer.grand-hall-t554-native-review-tile-request.v1",
      sourceEpochNonce: active.sourceEpochNonce,
      renderGeneration: active.renderGeneration,
      column,
      row,
    }, signal);
    if (response.headers.get("Content-Type") !== "application/vnd.venviewer.rgb8") {
      throw new Error("The tile media type is invalid.");
    }
    const raw = new Uint8Array(await response.arrayBuffer());
    if (serial !== sourceLoadSerial || signal.aborted) return;
    const imageData = rgbToImageData(raw);
    context.imageSmoothingEnabled = false;
    context.putImageData(imageData, column * tileWidth, row * tileHeight);
    const key = String(row) + ":" + String(column);
    paintedTiles.set(key, { column, row, generation: active.renderGeneration });
    setSessionStatus("Exact tiles painted: " + String(paintedTiles.size) + " / 512");
  };

  const loadSourceTiles = async (active, serial, signal) => {
    const pending = [];
    for (let row = 0; row < tileRows; row += 1) {
      for (let column = 0; column < tileColumns; column += 1) pending.push({ column, row });
    }
    let cursor = 0;
    const loadNext = async () => {
      while (cursor < pending.length && serial === sourceLoadSerial && !signal.aborted) {
        const tile = pending[cursor];
        cursor += 1;
        await fetchAndPaintTile(active, tile.column, tile.row, serial, signal);
      }
    };
    await Promise.all(Array.from({ length: 8 }, () => loadNext()));
    if (serial === sourceLoadSerial && !signal.aborted) setSessionStatus("All 512 exact source tiles are painted.");
  };

  const beginSourcePaint = () => {
    sourceLoadSerial += 1;
    if (activeTileController !== null) activeTileController.abort();
    activeTileController = new AbortController();
    paintedTiles = new Map();
    context.clearRect(0, 0, sourceWidth, sourceHeight);
    context.imageSmoothingEnabled = false;
    if (reviewState === null || reviewState.activeSource === null) return;
    const active = reviewState.activeSource;
    const serial = sourceLoadSerial;
    void loadSourceTiles(active, serial, activeTileController.signal).catch((error) => {
      if (!isRecord(error) || error.name !== "AbortError") showFailure();
    });
  };

  const selectSource = async (inventoryIndex) => {
    if (reviewState === null || mutationInFlight) return;
    mutationInFlight = true;
    try {
      const nextState = await apiJson(routes.selectSource, {
        schemaVersion: "venviewer.grand-hall-t554-native-review-select-source-request.v1",
        inventoryIndex,
        expectedRevision: reviewState.workspaceRevision,
      });
      installState(nextState);
    } finally {
      mutationInFlight = false;
    }
  };

  const paintedTileArray = () => Array.from(paintedTiles.values()).sort((left, right) =>
    left.row - right.row || left.column - right.column,
  );

  const telemetryTransform = () => {
    const canvasBounds = sourceCanvas.getBoundingClientRect();
    const viewportBounds = sourceViewport.getBoundingClientRect();
    const scale = canvasBounds.width / sourceWidth;
    return {
      viewportCssWidth: sourceViewport.clientWidth,
      viewportCssHeight: sourceViewport.clientHeight,
      sourceToCssTransform: {
        a: scale,
        b: 0,
        c: 0,
        d: scale,
        e: canvasBounds.left - viewportBounds.left - sourceViewport.clientLeft,
        f: canvasBounds.top - viewportBounds.top - sourceViewport.clientTop,
      },
    };
  };

  const sendTelemetry = async () => {
    if (reviewState === null || reviewState.activeSource === null || telemetryInFlight) return;
    const active = reviewState.activeSource;
    const transform = telemetryTransform();
    if (transform.viewportCssWidth <= 0 || transform.viewportCssHeight <= 0) return;
    telemetryInFlight = true;
    try {
      const visibility = document.visibilityState === "prerender"
        ? "prerender"
        : document.visibilityState === "visible" ? "visible" : "hidden";
      const response = await apiJson(routes.telemetry, {
        schemaVersion: "venviewer.grand-hall-t554-native-review-telemetry-sample.v1",
        sessionNonce: active.sessionNonce,
        sourceEpochNonce: active.sourceEpochNonce,
        renderGeneration: active.renderGeneration,
        sequence: active.nextTelemetrySequence,
        documentVisibilityState: visibility,
        documentFocusState: document.hasFocus() ? "focused" : "blurred",
        viewportCssWidth: transform.viewportCssWidth,
        viewportCssHeight: transform.viewportCssHeight,
        devicePixelRatio: window.devicePixelRatio,
        sourceToCssTransform: transform.sourceToCssTransform,
        paintedTiles: paintedTileArray(),
      });
      if (
        response.schemaVersion !== "venviewer.grand-hall-t554-native-review-telemetry-response.v1" ||
        !isSafeNonnegativeInteger(response.nextTelemetrySequence)
      ) throw new Error("The telemetry response is invalid.");
      validateCoverage(response.coverage);
      if (
        reviewState !== null &&
        reviewState.activeSource !== null &&
        reviewState.activeSource.sourceEpochNonce === active.sourceEpochNonce
      ) {
        reviewState.activeSource.nextTelemetrySequence = response.nextTelemetrySequence;
        reviewState.activeSource.coverage = response.coverage;
        renderCoverage(response.coverage);
      }
    } finally {
      telemetryInFlight = false;
    }
  };

  const submitDecision = async (decision) => {
    if (reviewState === null || reviewState.activeSource === null || mutationInFlight) return;
    mutationInFlight = true;
    try {
      const nextState = await apiJson(routes.decision, {
        schemaVersion: "venviewer.grand-hall-t554-native-review-decision-request.v1",
        expectedRevision: reviewState.workspaceRevision,
        decision,
        reason: decisionReasons[decision],
      });
      installState(nextState);
      setSessionStatus("Source decision recorded as " + decision + ".");
    } finally {
      mutationInFlight = false;
    }
  };

  const sourcePoint = (event) => {
    const bounds = sourceCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(sourceWidth - 1, Math.floor((event.clientX - bounds.left) * sourceWidth / bounds.width)));
    const y = Math.max(0, Math.min(sourceHeight - 1, Math.floor((event.clientY - bounds.top) * sourceHeight / bounds.height)));
    return { x, y };
  };

  const submitMaskRectangle = async (start, end) => {
    if (reviewState === null || reviewState.activeSource === null || mutationInFlight) return;
    const selectedReason = requireElement("mask-reason").value;
    if (!maskReasons.has(selectedReason)) throw new Error("The region reason is invalid.");
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.max(start.x, end.x) - x + 1;
    const height = Math.max(start.y, end.y) - y + 1;
    mutationInFlight = true;
    try {
      const nextState = await apiJson(routes.maskPrimitive, {
        schemaVersion: "venviewer.grand-hall-t554-native-review-mask-primitive-request.v1",
        expectedRevision: reviewState.workspaceRevision,
        reason: selectedReason,
        primitive: {
          kind: "rectangle",
          operation: pointerMode === "include" ? "include" : "exclude",
          x,
          y,
          width,
          height,
        },
      });
      installState(nextState);
      setSessionStatus("Integer source-aligned region primitive recorded.");
    } finally {
      mutationInFlight = false;
    }
  };

  const setPointerMode = (mode) => {
    pointerMode = mode;
    sourceViewport.classList.toggle("mode-pan", mode === "pan");
    sourceViewport.classList.toggle("mode-mask", mode !== "pan");
    requireElement("mode-pan").classList.toggle("is-selected", mode === "pan");
    requireElement("mode-include").classList.toggle("is-selected", mode === "include");
    requireElement("mode-exclude").classList.toggle("is-selected", mode === "exclude");
  };

  const changeZoom = (nextIndex) => {
    const bounded = Math.max(0, Math.min(zoomScales.length - 1, nextIndex));
    if (bounded === zoomIndex) return;
    const oldScale = zoomScales[zoomIndex];
    const sourceCentreX = (sourceViewport.scrollLeft + sourceViewport.clientWidth / 2) / oldScale;
    const sourceCentreY = (sourceViewport.scrollTop + sourceViewport.clientHeight / 2) / oldScale;
    zoomIndex = bounded;
    canvasStage.className = "canvas-stage " + zoomClasses[zoomIndex];
    const newScale = zoomScales[zoomIndex];
    sourceViewport.scrollLeft = sourceCentreX * newScale - sourceViewport.clientWidth / 2;
    sourceViewport.scrollTop = sourceCentreY * newScale - sourceViewport.clientHeight / 2;
    setSessionStatus("View scale changed to " + String(newScale) + ":1 CSS scale.");
  };

  sourceCanvas.addEventListener("pointerdown", (event) => {
    if (reviewState === null || reviewState.activeSource === null || event.button !== 0) return;
    sourceCanvas.setPointerCapture(event.pointerId);
    pointerStart = pointerMode === "pan"
      ? { clientX: event.clientX, clientY: event.clientY, scrollLeft: sourceViewport.scrollLeft, scrollTop: sourceViewport.scrollTop }
      : sourcePoint(event);
    sourceViewport.classList.toggle("is-panning", pointerMode === "pan");
  });

  sourceCanvas.addEventListener("pointermove", (event) => {
    if (pointerStart === null || pointerMode !== "pan") return;
    sourceViewport.scrollLeft = pointerStart.scrollLeft - (event.clientX - pointerStart.clientX);
    sourceViewport.scrollTop = pointerStart.scrollTop - (event.clientY - pointerStart.clientY);
  });

  const finishPointer = (event) => {
    if (pointerStart === null) return;
    const start = pointerStart;
    pointerStart = null;
    sourceViewport.classList.remove("is-panning");
    if (sourceCanvas.hasPointerCapture(event.pointerId)) sourceCanvas.releasePointerCapture(event.pointerId);
    if (pointerMode !== "pan") {
      const end = sourcePoint(event);
      void submitMaskRectangle(start, end).catch(showFailure);
    }
  };

  sourceCanvas.addEventListener("pointerup", finishPointer);
  sourceCanvas.addEventListener("pointercancel", finishPointer);
  requireElement("zoom-out").addEventListener("click", () => { changeZoom(zoomIndex - 1); });
  requireElement("zoom-native").addEventListener("click", () => { changeZoom(2); });
  requireElement("zoom-in").addEventListener("click", () => { changeZoom(zoomIndex + 1); });
  requireElement("mode-pan").addEventListener("click", () => { setPointerMode("pan"); });
  requireElement("mode-include").addEventListener("click", () => { setPointerMode("include"); });
  requireElement("mode-exclude").addEventListener("click", () => { setPointerMode("exclude"); });
  requireElement("decision-include").addEventListener("click", () => { void submitDecision("INCLUDE").catch(showFailure); });
  requireElement("decision-exclude").addEventListener("click", () => { void submitDecision("EXCLUDE").catch(showFailure); });
  requireElement("decision-unsure").addEventListener("click", () => { void submitDecision("UNSURE").catch(showFailure); });

  const start = async () => {
    await exchangeBootstrap();
    const initialState = await apiJson(routes.state, {
      schemaVersion: "venviewer.grand-hall-t554-native-review-state-request.v1",
    });
    installState(initialState);
    setPointerMode("pan");
    if (reviewState !== null && reviewState.activeSource === null) await selectSource(0);
    window.setInterval(() => { void sendTelemetry().catch(showFailure); }, 250);
  };

  void start().catch(showFailure);
})();
`;

export interface GrandHallT554NativeReviewStaticAssetV1 {
  readonly route: string;
  readonly contentType:
    | "text/html; charset=utf-8"
    | "text/css; charset=utf-8"
    | "application/javascript; charset=utf-8";
  readonly bytes: Buffer;
}

export const GRAND_HALL_T554_NATIVE_REVIEW_ASSETS = Object.freeze([
  Object.freeze({
    route: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.document,
    contentType: "text/html; charset=utf-8",
    bytes: Buffer.from(GRAND_HALL_T554_NATIVE_REVIEW_HTML, "utf8"),
  }),
  Object.freeze({
    route: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.stylesheet,
    contentType: "text/css; charset=utf-8",
    bytes: Buffer.from(GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET, "utf8"),
  }),
  Object.freeze({
    route: GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.script,
    contentType: "application/javascript; charset=utf-8",
    bytes: Buffer.from(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT, "utf8"),
  }),
] satisfies readonly GrandHallT554NativeReviewStaticAssetV1[]);
