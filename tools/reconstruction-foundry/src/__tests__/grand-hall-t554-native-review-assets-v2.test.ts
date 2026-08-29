import { Script } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
} from "../grand-hall-t554-native-review-http-contract-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_COUPLED_TILE_BYTE_LENGTH_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_HEIGHT_PX_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_TILE_BYTE_LENGTH_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_WIDTH_PX_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_COLUMN_COUNT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_COUNT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_ROW_COUNT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX_V2,
  assertGrandHallT554NativeReviewCoupledTileLengthV2,
  assertGrandHallT554NativeReviewSourceTileLengthV2,
  createGrandHallT554NativeReviewAssetsV2,
} from "../grand-hall-t554-native-review-assets-v2.js";

const bootstrapToken = "b".repeat(43);
const bearerToken = "s".repeat(43);

function sourceCatalog() {
  return Array.from({ length: 148 }, (_, inventoryIndex) => ({
    inventoryIndex,
    sweepNumber: inventoryIndex + 1,
    agentObservation:
      inventoryIndex % 2 === 0
        ? {
            state: "grand_hall_pixels_observed_human_pending",
            proposedDisposition: "include_with_binary_pixel_mask",
            maskAuthoringState: "required_not_authored",
          }
        : {
            state: "no_grand_hall_pixels_observed_human_pending",
            proposedDisposition: "exclude_whole_frame",
            maskAuthoringState: "not_required_if_human_confirms_exclusion",
          },
    authorityNoneRecord: { state: "no_recorded_decision" },
  }));
}

function validOperatorState() {
  return {
    schemaVersion:
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.operatorState,
    lifecycle: "active",
    browserEpochNumber: 1,
    workspaceRevision: 0,
    maximumAllocatedRenderGeneration: 0,
    sources: sourceCatalog(),
    activeSource: null,
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    acceptanceAuthorized: false,
    reconstructionAuthorized: false,
    runtimeAuthorized: false,
    exportAuthorized: false,
    generatedContentAuthorized: false,
  };
}

function exactFunctionSlice(startName: string, endName: string): string {
  const start = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2.indexOf(
    `function ${startName}`,
  );
  const end = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2.indexOf(
    `function ${endName}`,
  );
  if (start < 0 || end <= start) {
    throw new Error(`Unable to extract ${startName} through ${endName}.`);
  }
  return GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2.slice(start, end);
}

class MockClassList {
  readonly members = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.members.add(name);
  }

  remove(...names: string[]): void {
    for (const name of names) this.members.delete(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.members.has(name);
    if (enabled) this.members.add(name);
    else this.members.delete(name);
    return enabled;
  }
}

interface MockCanvasContext {
  imageSmoothingEnabled: boolean;
  readonly clearCalls: unknown[][];
  readonly paintCalls: unknown[][];
  clearRect(...values: unknown[]): void;
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(...values: unknown[]): void;
}

function createMockCanvasContext(): MockCanvasContext {
  return {
    imageSmoothingEnabled: true,
    clearCalls: [],
    paintCalls: [],
    clearRect(...values: unknown[]) {
      this.clearCalls.push(values);
    },
    createImageData(width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(...values: unknown[]) {
      this.paintCalls.push(values);
    },
  };
}

class MockElement {
  readonly classList = new MockClassList();
  readonly attributes = new Map<string, string>();
  readonly children: MockElement[] = [];
  readonly listeners = new Map<string, Array<(event: never) => void>>();
  className = "";
  textContent = "";
  value = "";
  disabled = false;
  type = "";
  scrollLeft = 0;
  scrollTop = 0;
  clientLeft = 0;
  clientTop = 0;
  clientWidth = 800;
  clientHeight = 400;

  constructor(
    readonly id: string,
    private readonly canvasContext: MockCanvasContext | null = null,
  ) {}

  addEventListener(name: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  append(...children: MockElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: MockElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getContext(kind: string): MockCanvasContext | null {
    return kind === "2d" ? this.canvasContext : null;
  }

  getBoundingClientRect(): {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } {
    return this.id.endsWith("canvas")
      ? { left: 0, top: 0, width: 1_024, height: 512 }
      : { left: 0, top: 0, width: 800, height: 400 };
  }

  setPointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  releasePointerCapture(): void {}
}

function htmlElementIds(): readonly string[] {
  return Array.from(
    GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2.matchAll(/\bid="([a-z0-9-]+)"/gu),
    (match) => match[1] ?? "",
  ).filter((id) => id.length > 0);
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : null;
      },
    },
    json() {
      return Promise.resolve(value);
    },
  };
}

describe("Grand Hall T-554 Canvas2D native-review assets v2", () => {
  it("exports exact 8192x4096, 32x16, 256px tile geometry and byte guards", () => {
    expect(GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_WIDTH_PX_V2).toBe(8_192);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_HEIGHT_PX_V2).toBe(4_096);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_TILE_WIDTH_PX_V2).toBe(256);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_TILE_HEIGHT_PX_V2).toBe(256);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_TILE_COLUMN_COUNT_V2).toBe(32);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_TILE_ROW_COUNT_V2).toBe(16);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_TILE_COUNT_V2).toBe(512);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_TILE_BYTE_LENGTH_V2).toBe(
      196_608,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_COUPLED_TILE_BYTE_LENGTH_V2).toBe(
      327_680,
    );
    expect(() => {
      assertGrandHallT554NativeReviewSourceTileLengthV2(196_608);
    }).not.toThrow();
    expect(() => {
      assertGrandHallT554NativeReviewSourceTileLengthV2(196_607);
    }).toThrow(/exactly 196608 bytes/iu);
    expect(() => {
      assertGrandHallT554NativeReviewCoupledTileLengthV2(327_680);
    }).not.toThrow();
    expect(() => {
      assertGrandHallT554NativeReviewCoupledTileLengthV2(327_681);
    }).toThrow(/exactly 327680 bytes/iu);
  });

  it("ships only the three static assets on the frozen v2 contract routes", () => {
    const assets = createGrandHallT554NativeReviewAssetsV2();
    expect(assets).toHaveLength(3);
    expect(assets.map((asset) => asset.route)).toEqual([
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.document,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script,
    ]);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toContain(
      `href="${GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet}"`,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toContain(
      `src="${GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script}"`,
    );
    expect(
      () => new Script(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2),
    ).not.toThrow();
    expect(assets.map((asset) => asset.contentType)).toEqual([
      "text/html; charset=utf-8",
      "text/css; charset=utf-8",
      "text/javascript; charset=utf-8",
    ]);
  });

  it("returns fresh payload buffers without letting one consumer diverge reviewed strings or later consumers", () => {
    const firstConsumer = createGrandHallT554NativeReviewAssetsV2();
    const secondConsumer = createGrandHallT554NativeReviewAssetsV2();
    const reviewedStrings = [
      GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
    ];
    for (let index = 0; index < reviewedStrings.length; index += 1) {
      const firstAsset = firstConsumer[index];
      const secondAsset = secondConsumer[index];
      if (firstAsset === undefined || secondAsset === undefined) {
        throw new Error("Static asset fixture is incomplete.");
      }
      expect(firstAsset.bytes).not.toBe(secondAsset.bytes);
      firstAsset.bytes.fill(0);
      expect(secondAsset.bytes.toString("utf8")).toBe(reviewedStrings[index]);
    }
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toMatch(/^<!doctype html>/u);
    expect(
      createGrandHallT554NativeReviewAssetsV2().map((asset) =>
        asset.bytes.toString("utf8"),
      ),
    ).toEqual(reviewedStrings);
  });

  it("uses two aligned exact canvases and no inline executable or style content", () => {
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toMatch(
      /<canvas id="source-canvas" width="8192" height="4096"/u,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toMatch(
      /<canvas id="overlay-canvas" width="8192" height="4096"/u,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).not.toMatch(/<style\b/iu);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).not.toMatch(
      /<script(?![^>]*\bsrc=)[^>]*>/iu,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).not.toMatch(
      /\s(?:style|on[a-z]+)=/iu,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2).toContain(
      "#overlay-canvas { pointer-events: none; }",
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2).toContain(
      ".zoom-4 { width: 32768px; height: 16384px; }",
    );
  });

  it("contains no external, persistence, export, worker, unsafe-DOM, or non-Canvas2D surface", () => {
    const allAssets = [
      GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
    ].join("\n");
    expect(allAssets).not.toMatch(/https?:\/\//iu);
    expect(allAssets).not.toMatch(/(?:src|href)=["']\/\//iu);
    expect(allAssets).not.toMatch(/\b(?:blob|data):/iu);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).not.toMatch(/<img\b/iu);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).not.toMatch(
      /\bImage\s*\(/u,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).not.toMatch(
      /\b(?:Worker|SharedWorker|WebSocket|EventSource|eval|Function)\s*\(/u,
    );
    expect(allAssets).not.toMatch(
      /WebGL|createObjectURL|toDataURL|toBlob|showSaveFilePicker|download/iu,
    );
    expect(allAssets).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker/iu,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|\.style\b/u,
    );
  });

  it("clears the exact one-use fragment before fetch and keeps the bearer off URLs and DOM", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2;
    const fragmentRead = client.indexOf("window.location.hash");
    const fragmentClear = client.indexOf("window.history.replaceState");
    const bootstrapFetch = client.indexOf("fetch(routes.bootstrap");
    expect(fragmentRead).toBeGreaterThan(-1);
    expect(fragmentClear).toBeGreaterThan(fragmentRead);
    expect(bootstrapFetch).toBeGreaterThan(fragmentClear);
    expect(client).toContain(
      "const bootstrapPattern = /^#bootstrap=([A-Za-z0-9_-]{43})$/;",
    );
    expect(client).toContain("bootstrapToken: bootstrapSecret");
    expect(client).toContain('credentials: "omit"');
    expect(client).toContain('redirect: "error"');
    expect(client).toContain('referrerPolicy: "no-referrer"');
    expect(client).not.toMatch(
      /URLSearchParams|location\.search|[?&](?:bootstrap|bearer|token)=/iu,
    );
    expect(client).not.toMatch(
      /(?:textContent|value)\s*=\s*(?:bearer|bootstrapSecret)/u,
    );
    expect(client).not.toMatch(
      /setAttribute\([^)]*(?:bearer|bootstrap|token)/iu,
    );
  });

  it("serializes only fixed contract routes and exact request schema versions", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2;
    expect(client).toContain(
      `const routes = Object.freeze(${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2)});`,
    );
    expect(client).toContain(
      `const requestSchemas = Object.freeze(${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2)});`,
    );
    expect(client).toContain("if (!apiPaths.has(path))");
    expect(client.match(/\bfetch\(/gu)).toHaveLength(3);
    expect(client).toContain("fetch(routes.bootstrap");
    expect(client).toContain("fetch(path, authorizedRequestOptions");
    for (const route of Object.values(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
    )) {
      expect(route).toMatch(/^\/(?:$|[a-z0-9./-]+$)/u);
      expect(route).not.toMatch(/[?#*{}:]/u);
    }
  });

  it("strictly validates the full redacted operator projection and rejects extra authority material", () => {
    const validatorSource = exactFunctionSlice(
      "isRecord",
      "responseHasJsonContentType",
    );
    const harness: {
      validateOperatorStateForTest?: (value: unknown) => unknown;
    } = {};
    new Script(
      `const tileCount = 512; const sourcePixelCount = 33554432; const responseSchemas = ${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2)};\n${validatorSource}\nglobalThis.validateOperatorStateForTest = validateOperatorState;`,
    ).runInNewContext(harness);
    const validateOperatorStateForTest = harness.validateOperatorStateForTest;
    if (validateOperatorStateForTest === undefined) {
      throw new Error("Operator state validator harness was not installed.");
    }
    const state = validOperatorState();
    expect(validateOperatorStateForTest(state)).toBe(state);

    const leakedSource = structuredClone(state);
    const leakedSourceEntry = leakedSource.sources[0];
    if (leakedSourceEntry === undefined)
      throw new Error("Source fixture is missing.");
    Object.assign(leakedSourceEntry, { fileName: "not-public.jpg" });
    expect(() => validateOperatorStateForTest(leakedSource)).toThrow(
      /unexpected public field shape/iu,
    );

    const leakedHistory = structuredClone(state);
    const leakedHistoryEntry = leakedHistory.sources[0];
    if (leakedHistoryEntry === undefined)
      throw new Error("History fixture is missing.");
    Object.assign(leakedHistoryEntry.authorityNoneRecord, {
      reviewerId: "not-public",
    });
    expect(() => validateOperatorStateForTest(leakedHistory)).toThrow(
      /unexpected public field shape/iu,
    );

    const unauthorized = structuredClone(state);
    unauthorized.runtimeAuthorized = true;
    expect(() => validateOperatorStateForTest(unauthorized)).toThrow(
      /Runtime gate is invalid/iu,
    );
  });

  it("decodes exact RGB|mask|reason planes and rejects every invalid mask-reason pairing", () => {
    const decoderSource = exactFunctionSlice(
      "createRgbaImageData",
      "setStatus",
    );
    const sourceContext = createMockCanvasContext();
    const overlayContext = createMockCanvasContext();
    const harness: {
      sourceContext: MockCanvasContext;
      overlayContext: MockCanvasContext;
      decodeSourceTileForTest?: (raw: Uint8Array) => {
        data: Uint8ClampedArray;
      };
      decodeCoupledTileForTest?: (raw: Uint8Array) => {
        sourceImageData: { data: Uint8ClampedArray };
        overlayImageData: { data: Uint8ClampedArray };
      };
    } = { sourceContext, overlayContext };
    new Script(
      `const tileWidth = 256; const tileHeight = 256; const tilePixelCount = 65536; const sourceTileByteLength = 196608; const coupledTileByteLength = 327680; const overlayColors = [[255,91,76,199],[255,183,3,199],[160,103,245,199],[0,194,255,199],[235,64,122,199]];\n${decoderSource}\nglobalThis.decodeSourceTileForTest = decodeSourceTile; globalThis.decodeCoupledTileForTest = decodeCoupledTile;`,
    ).runInNewContext(harness);
    const decodeSourceTileForTest = harness.decodeSourceTileForTest;
    const decodeCoupledTileForTest = harness.decodeCoupledTileForTest;
    if (
      decodeSourceTileForTest === undefined ||
      decodeCoupledTileForTest === undefined
    ) {
      throw new Error("Tile decoder harness was not installed.");
    }

    const coupled = new Uint8Array(327_680);
    coupled[0] = 17;
    coupled[1] = 18;
    coupled[2] = 19;
    coupled[196_608] = 255;
    coupled[196_608 + 65_536] = 1;
    const decoded = decodeCoupledTileForTest(coupled);
    expect(Array.from(decoded.sourceImageData.data.slice(0, 4))).toEqual([
      17, 18, 19, 255,
    ]);
    expect(Array.from(decoded.overlayImageData.data.slice(0, 4))).toEqual([
      255, 91, 76, 199,
    ]);
    expect(Array.from(decoded.overlayImageData.data.slice(4, 8))).toEqual([
      0, 0, 0, 0,
    ]);

    const reasonWithoutMask = new Uint8Array(327_680);
    reasonWithoutMask[196_608 + 65_536] = 1;
    expect(() => decodeCoupledTileForTest(reasonWithoutMask)).toThrow(
      /invalid mask and reason pair/iu,
    );
    const maskWithoutReason = new Uint8Array(327_680);
    maskWithoutReason[196_608] = 255;
    expect(() => decodeCoupledTileForTest(maskWithoutReason)).toThrow(
      /invalid mask and reason pair/iu,
    );
    expect(() => decodeSourceTileForTest(new Uint8Array(196_607))).toThrow(
      /exactly 196608 bytes/iu,
    );
    expect(() => decodeCoupledTileForTest(new Uint8Array(327_679))).toThrow(
      /exactly 327680 bytes/iu,
    );
  });

  it("paints only after decode at integer tile offsets with smoothing disabled", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2;
    expect(client).toContain("sourceContext.imageSmoothingEnabled = false");
    expect(client).toContain("overlayContext.imageSmoothingEnabled = false");
    expect(client).toContain("const integerX = column * tileWidth");
    expect(client).toContain("const integerY = row * tileHeight");
    const decodeIndex = client.indexOf(
      "const decoded = decodeCoupledTile(raw)",
    );
    const sourcePaintIndex = client.indexOf(
      "sourceContext.putImageData(decoded.sourceImageData, integerX, integerY)",
    );
    const overlayPaintIndex = client.indexOf(
      "overlayContext.putImageData(decoded.overlayImageData, integerX, integerY)",
    );
    const paintedMarkIndex = client.indexOf(
      "paintedTiles.set(paintedTileKey(column, row)",
    );
    expect(decodeIndex).toBeGreaterThan(-1);
    expect(sourcePaintIndex).toBeGreaterThan(decodeIndex);
    expect(overlayPaintIndex).toBeGreaterThan(sourcePaintIndex);
    expect(paintedMarkIndex).toBeGreaterThan(overlayPaintIndex);
  });

  it("keys render state and aborts and drains all tile workers before every state mutation", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2;
    expect(client).toContain(
      'String(state.browserEpochNumber) + ":" + String(active.renderGeneration) + ":" + active.phase + ":" + maskRevision',
    );
    expect(client).toContain(
      "await Promise.all(Array.from({ length: 4 }, () => worker()))",
    );
    const mutationStart = client.indexOf("async function runStateMutation");
    const mutationEnd = client.indexOf(
      "async function selectSource",
      mutationStart,
    );
    const mutation = client.slice(mutationStart, mutationEnd);
    expect(mutation.indexOf("await abortAndDrainTileLoad()")).toBeGreaterThan(
      mutation.indexOf("mutationInFlight = true"),
    );
    expect(mutation.indexOf("await apiJson(path")).toBeGreaterThan(
      mutation.indexOf("await abortAndDrainTileLoad()"),
    );
    for (const action of [
      "selectSource",
      "excludeSource",
      "leaveSourcePending",
      "beginMask",
      "applyMaskEdit",
      "freezeMask",
      "includeSource",
      "attestSource",
      "abandonSource",
      "stopSession",
    ]) {
      const start = client.indexOf(`async function ${action}`);
      const next = client.indexOf("\n  async function ", start + 1);
      expect(client.slice(start, next < 0 ? undefined : next)).toContain(
        "runStateMutation(",
      );
    }
  });

  it("sends only current evidence coverage fields at a 250ms active-render heartbeat", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2;
    const start = client.indexOf("function coveragePayload");
    const end = client.indexOf("async function sendCoverageHeartbeat", start);
    const coveragePayloadSource = client.slice(start, end);
    for (const required of [
      "expectedBrowserEpochNumber",
      "renderGeneration",
      "documentVisibilityState",
      "documentFocusState",
      "viewportCssWidth",
      "viewportCssHeight",
      "devicePixelRatio",
      "sourceToCssTransform",
      "paintedTiles",
    ]) {
      expect(coveragePayloadSource).toContain(required);
    }
    expect(coveragePayloadSource).not.toMatch(
      /timestamp|Date\.|performance\.|dwell|bitmap/iu,
    );
    expect(client).toContain("tileLoadPromise !== null");
    expect(client).toContain(
      'active.phase !== "source_review" && active.phase !== "mask_review"',
    );
    expect(client).toContain(
      "window.setInterval(() => {\n      void sendCoverageHeartbeat().catch(showFailure);\n    }, 250)",
    );
  });

  it.each([
    { devicePixelRatio: 0.25, expectedZoomIndex: 6 },
    { devicePixelRatio: 0.5, expectedZoomIndex: 5 },
    { devicePixelRatio: 0.75, expectedZoomIndex: 5 },
    { devicePixelRatio: 1, expectedZoomIndex: 4 },
    { devicePixelRatio: 1.25, expectedZoomIndex: 4 },
    { devicePixelRatio: 1.5, expectedZoomIndex: 4 },
    { devicePixelRatio: 2, expectedZoomIndex: 3 },
    { devicePixelRatio: 3, expectedZoomIndex: 3 },
  ])(
    "chooses a non-undersampling native scale at DPR $devicePixelRatio",
    ({ devicePixelRatio, expectedZoomIndex }) => {
      const chooserSource = exactFunctionSlice(
        "chooseNativeDeviceScale",
        "readTileNavigation",
      );
      const harness: {
        window: { devicePixelRatio: number };
        selectedZoomIndex: number | null;
        chooseNativeDeviceScaleForTest?: () => void;
      } = {
        window: { devicePixelRatio },
        selectedZoomIndex: null,
      };
      new Script(
        `const zoomScales = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4]; function changeZoom(index) { globalThis.selectedZoomIndex = index; }\n${chooserSource}\nglobalThis.chooseNativeDeviceScaleForTest = chooseNativeDeviceScale;`,
      ).runInNewContext(harness);
      const chooseNativeDeviceScaleForTest =
        harness.chooseNativeDeviceScaleForTest;
      if (chooseNativeDeviceScaleForTest === undefined) {
        throw new Error("Native-scale chooser harness was not installed.");
      }
      chooseNativeDeviceScaleForTest();
      expect(harness.selectedZoomIndex).toBe(expectedZoomIndex);
      const selectedScale = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4][
        expectedZoomIndex
      ];
      if (selectedScale === undefined) {
        throw new Error("Expected zoom fixture is invalid.");
      }
      expect(selectedScale * devicePixelRatio).toBeGreaterThanOrEqual(1);
    },
  );

  it("keeps all permanent truth boundaries and exposes the complete non-authoritative phase flow", () => {
    const allAssets = [
      GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
    ].join("\n");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toContain("Authority: none");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toContain("human_pending");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toContain("PENDING");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2).toMatch(
      /No generated content or architectural inference is permitted/iu,
    );
    expect(allAssets).not.toContain("UNSURE");
    for (const routeName of [
      "sourceSelect",
      "sourceExclude",
      "sourceLeavePending",
      "maskBegin",
      "maskEdit",
      "maskFreeze",
      "maskReviewTile",
      "maskReviewCoverage",
      "sourceInclude",
      "sourceAttest",
      "sourceAbandon",
      "sessionStop",
    ]) {
      expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).toContain(
        `routes.${routeName}`,
      );
    }
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).toContain(
      'requireActiveSource("source_review")',
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).toContain(
      'requireActiveSource("mask_edit")',
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).toContain(
      'requireActiveSource("mask_review")',
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2).toContain(
      'requireActiveSource("decision_recorded")',
    );
  });

  it("executes in a mocked DOM, clears the fragment before bootstrap, and keeps the bearer closure-only", async () => {
    const sourceContext = createMockCanvasContext();
    const overlayContext = createMockCanvasContext();
    const elements = new Map<string, MockElement>();
    for (const id of htmlElementIds()) {
      const context =
        id === "source-canvas"
          ? sourceContext
          : id === "overlay-canvas"
            ? overlayContext
            : null;
      elements.set(id, new MockElement(id, context));
    }
    const initialValues: Readonly<Record<string, string>> = {
      "mask-operation": "exclude",
      "mask-reason": "adjacent_room_pixels",
      "rectangle-seam": "none",
      "polygon-seam": "none",
      "include-classification": "grand_hall_core",
      "tile-column": "1",
      "tile-row": "1",
    };
    for (const [id, value] of Object.entries(initialValues)) {
      const element = elements.get(id);
      if (element !== undefined) element.value = value;
    }

    let fragmentCleared = false;
    const fetchCalls: Array<{
      path: string;
      options: Record<string, unknown>;
    }> = [];
    const intervalDelays: number[] = [];
    const documentMock = {
      title: "Grand Hall review",
      visibilityState: "visible",
      getElementById(id: string) {
        return elements.get(id) ?? null;
      },
      createElement(tag: string) {
        return new MockElement(tag);
      },
      hasFocus() {
        return true;
      },
      addEventListener() {},
    };
    const windowMock = {
      location: { hash: `#bootstrap=${bootstrapToken}`, pathname: "/" },
      history: {
        replaceState(_state: unknown, _title: string, path: string) {
          expect(path).toBe("/");
          fragmentCleared = true;
          windowMock.location.hash = "";
        },
      },
      devicePixelRatio: 1,
      addEventListener() {},
      setInterval(_callback: () => void, delay: number) {
        intervalDelays.push(delay);
        return 1;
      },
    };
    const context: Record<string, unknown> = {
      document: documentMock,
      window: windowMock,
      AbortController,
      Uint8Array,
      console,
      fetch: (path: string, options: Record<string, unknown>) => {
        if (fetchCalls.length === 0) expect(fragmentCleared).toBe(true);
        fetchCalls.push({ path, options });
        if (path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap) {
          return Promise.resolve(
            jsonResponse({
              schemaVersion:
                GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.bootstrap,
              bearerToken,
            }),
          );
        }
        if (path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state) {
          return Promise.resolve(jsonResponse(validOperatorState()));
        }
        return Promise.reject(
          new Error(`Unexpected mocked fetch path ${path}.`),
        );
      },
    };

    new Script(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2, {
      filename: "grand-hall-t554-native-review-v2.js",
    }).runInNewContext(context);
    for (let attempt = 0; attempt < 20 && fetchCalls.length < 2; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]?.path).toBe(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap,
    );
    expect(fetchCalls[1]?.path).toBe(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
    );
    const bootstrapOptions = fetchCalls[0]?.options;
    const stateOptions = fetchCalls[1]?.options;
    expect(bootstrapOptions?.credentials).toBe("omit");
    expect(JSON.parse(String(bootstrapOptions?.body))).toEqual({
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.bootstrap,
      bootstrapToken,
    });
    expect(stateOptions?.credentials).toBe("omit");
    expect(stateOptions?.headers).toMatchObject({
      Authorization: `Bearer ${bearerToken}`,
    });
    expect(JSON.parse(String(stateOptions?.body))).toEqual({
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.state,
    });
    expect(intervalDelays).toEqual([250]);
    expect(context).not.toHaveProperty("bearer");
    expect(windowMock).not.toHaveProperty("bearer");
    for (const element of elements.values()) {
      expect(element.textContent).not.toContain(bearerToken);
      expect(element.value).not.toContain(bearerToken);
      expect(Array.from(element.attributes.values()).join(" ")).not.toContain(
        bearerToken,
      );
    }
    expect(elements.get("source-list")?.children).toHaveLength(148);
    expect(elements.get("session-status")?.textContent).toMatch(
      /No source was selected automatically/iu,
    );
  });
});
