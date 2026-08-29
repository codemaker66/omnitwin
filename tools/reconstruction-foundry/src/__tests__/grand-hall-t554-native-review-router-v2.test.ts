import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
} from "../grand-hall-t554-native-review-http-contract-v2.js";
import type {
  GrandHallT554NativeReviewOperatorMaskTileV2,
  GrandHallT554NativeReviewOperatorSessionV2,
  GrandHallT554NativeReviewOperatorSourceTileV2,
} from "../grand-hall-t554-native-review-operator-session-v2.js";
import {
  createGrandHallT554NativeReviewRouterV2,
  GRAND_HALL_T554_NATIVE_REVIEW_ROUTER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SECURITY_HEADERS_V2,
  type GrandHallT554NativeReviewRouterFatalEventV2,
  type GrandHallT554NativeReviewRouterV2,
} from "../grand-hall-t554-native-review-router-v2.js";
import {
  createLocalSessionTokenBroker,
  LocalSessionRequestGate,
  type LocalSessionTokenBroker,
} from "../local-session-http.js";

const PORT = 31_337;
const HOST = `127.0.0.1:${String(PORT)}`;
const ORIGIN = `http://${HOST}`;
const AUTHORIZATION = "Bearer test-token";
const SOURCE_RGB8 = Buffer.alloc(256 * 256 * 3, 17);
const MASK8 = Buffer.alloc(256 * 256, 1);
const REASON8 = Buffer.alloc(256 * 256, 2);
const SNAPSHOT = Object.freeze({
  schemaVersion: "venviewer.grand-hall-t554-native-review-operator-session.v2",
  lifecycle: "active",
  browserEpochNumber: 1,
  workspaceRevision: 0,
  maximumAllocatedRenderGeneration: 1,
  sources: [],
  activeSource: null,
  authority: "none",
  reviewState: "human_pending",
  finalDecision: "PENDING",
  acceptanceAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  exportAuthorized: false,
  generatedContentAuthorized: false,
});

type HeaderValue = string | number | readonly string[];

class RequestHarness extends EventEmitter {
  aborted = false;
  destroyed = false;
  method = "GET";
  url = "/";
  rawHeaders: string[] = ["Host", HOST];
  headers: Record<string, string | undefined> = { host: HOST };
  readonly socket = {
    localAddress: "127.0.0.1",
    remoteAddress: "127.0.0.1",
    localPort: PORT,
  };
  readonly resume = vi.fn(() => this);
  readonly destroy = vi.fn(() => {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.aborted = true;
    this.emit("aborted");
    return this;
  });
}

class ResponseHarness extends EventEmitter {
  destroyed = false;
  headersSent = false;
  writableEnded = false;
  writableFinished = false;
  statusCode = 200;
  autoFinish = true;
  throwOnSetHeader = false;
  throwOnWrite = false;
  throwOnEnd = false;
  readonly headers = new Map<string, HeaderValue>();
  readonly chunks: Buffer[] = [];
  readonly setHeader = vi.fn((name: string, value: HeaderValue) => {
    if (this.throwOnSetHeader) throw new Error("secret setHeader failure");
    this.headers.set(name.toLowerCase(), value);
    return this;
  });
  readonly write = vi.fn((chunk: Buffer) => {
    this.headersSent = true;
    if (this.throwOnWrite) throw new Error("secret write failure");
    this.chunks.push(chunk);
    return true;
  });
  readonly end = vi.fn((chunk?: Buffer) => {
    this.headersSent = true;
    this.writableEnded = true;
    if (this.throwOnEnd) throw new Error("secret end failure");
    if (chunk !== undefined) this.chunks.push(chunk);
    if (this.autoFinish) {
      this.writableFinished = true;
      this.emit("finish");
    }
    return this;
  });
  readonly destroy = vi.fn(() => {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.emit("close");
    return this;
  });
}

interface OperatorHarness {
  readonly session: GrandHallT554NativeReviewOperatorSessionV2;
  readonly snapshot: ReturnType<
    typeof vi.fn<(input?: unknown) => Promise<unknown>>
  >;
  readonly selectSource: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly prepareSourceTile: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly recordSourceCoverage: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly recordExcludeDecision: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly beginMaskWorkflow: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly applyMaskEdit: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly freezeMask: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly prepareMaskTile: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly recordMaskCoverage: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly recordIncludeDecision: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly recordHumanAttestation: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly leaveSourcePending: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly abandonActiveSource: ReturnType<
    typeof vi.fn<(input: unknown) => Promise<unknown>>
  >;
  readonly stop: ReturnType<typeof vi.fn<(input: unknown) => Promise<unknown>>>;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

interface RouterHarness {
  readonly router: GrandHallT554NativeReviewRouterV2;
  readonly operator: OperatorHarness;
  readonly authorizeRequest: ReturnType<
    typeof vi.fn<(request: IncomingMessage) => void>
  >;
  readonly exchangeBootstrapToken: ReturnType<
    typeof vi.fn<(token: string) => string>
  >;
  readonly destroyBroker: ReturnType<typeof vi.fn<() => void>>;
  readonly enterGate: ReturnType<typeof vi.fn<() => () => void>>;
  readonly releaseGate: ReturnType<typeof vi.fn<() => void>>;
  readonly fatalHook: ReturnType<
    typeof vi.fn<
      (event: GrandHallT554NativeReviewRouterFatalEventV2) => Promise<void>
    >
  >;
}

function asOperatorSession(
  value: object,
): GrandHallT554NativeReviewOperatorSessionV2 {
  return value as GrandHallT554NativeReviewOperatorSessionV2;
}

function asRequestGate(value: object): LocalSessionRequestGate {
  return value as LocalSessionRequestGate;
}

function sourceTile(
  commit = vi.fn<() => Promise<void>>().mockResolvedValue(),
  discard = vi.fn<() => Promise<void>>().mockResolvedValue(),
): GrandHallT554NativeReviewOperatorSourceTileV2 {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-operator-source-tile.v2",
    renderMode: "source_rgb8",
    widthPx: 256,
    heightPx: 256,
    sourceRgb8: SOURCE_RGB8,
    commitDeliveryAfterSuccessfulSend: commit,
    discardAfterFailedSend: discard,
  };
}

function maskTile(
  commit = vi.fn<() => Promise<void>>().mockResolvedValue(),
  discard = vi.fn<() => Promise<void>>().mockResolvedValue(),
): GrandHallT554NativeReviewOperatorMaskTileV2 {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-operator-mask-tile.v2",
    renderMode: "source_rgb8_mask8_reason8",
    widthPx: 256,
    heightPx: 256,
    sourceRgb8: SOURCE_RGB8,
    mask8: MASK8,
    reason8: REASON8,
    commitDeliveryAfterSuccessfulSend: commit,
    discardAfterFailedSend: discard,
  };
}

function operatorHarness(): OperatorHarness {
  const snapshot = vi
    .fn<(input?: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const selectSource = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const prepareSourceTile = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(sourceTile());
  const recordSourceCoverage = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue({ schemaVersion: "source-coverage", complete: false });
  const recordExcludeDecision = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const beginMaskWorkflow = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const applyMaskEdit = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const freezeMask = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const prepareMaskTile = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(maskTile());
  const recordMaskCoverage = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue({ schemaVersion: "mask-coverage", complete: false });
  const recordIncludeDecision = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const recordHumanAttestation = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const leaveSourcePending = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const abandonActiveSource = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const stop = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(SNAPSHOT);
  const close = vi.fn<() => Promise<void>>().mockResolvedValue();
  const session = asOperatorSession({
    snapshot,
    selectSource,
    prepareSourceTile,
    recordSourceCoverage,
    recordExcludeDecision,
    beginMaskWorkflow,
    applyMaskEdit,
    freezeMask,
    prepareMaskTile,
    recordMaskCoverage,
    recordIncludeDecision,
    recordHumanAttestation,
    leaveSourcePending,
    abandonActiveSource,
    stop,
    close,
  });
  return {
    session,
    snapshot,
    selectSource,
    prepareSourceTile,
    recordSourceCoverage,
    recordExcludeDecision,
    beginMaskWorkflow,
    applyMaskEdit,
    freezeMask,
    prepareMaskTile,
    recordMaskCoverage,
    recordIncludeDecision,
    recordHumanAttestation,
    leaveSourcePending,
    abandonActiveSource,
    stop,
    close,
  };
}

function routerHarness(): RouterHarness {
  const operator = operatorHarness();
  const authorizeRequest = vi.fn<(request: IncomingMessage) => void>();
  const exchangeBootstrapToken = vi
    .fn<(token: string) => string>()
    .mockReturnValue("B".repeat(43));
  const destroyBroker = vi.fn<() => void>();
  const tokenBroker = {
    bootstrapFragment: `#bootstrap=${"A".repeat(43)}`,
    authorizeRequest,
    exchangeBootstrapToken,
    destroy: destroyBroker,
  } satisfies LocalSessionTokenBroker;
  const releaseGate = vi.fn<() => void>();
  const enterGate = vi.fn<() => () => void>().mockReturnValue(releaseGate);
  const requestGate = asRequestGate({
    enter: enterGate,
  });
  const fatalHook = vi
    .fn<(event: GrandHallT554NativeReviewRouterFatalEventV2) => Promise<void>>()
    .mockResolvedValue();
  const router = createGrandHallT554NativeReviewRouterV2({
    operatorSession: operator.session,
    tokenBroker,
    requestGate,
    staticAssets: Object.freeze({
      documentHtml: Buffer.from("html"),
      stylesheetCss: Buffer.from("css"),
      applicationJavascript: Buffer.from("js"),
    }),
    onFatal: fatalHook,
  });
  return {
    router,
    operator,
    authorizeRequest,
    exchangeBootstrapToken,
    destroyBroker,
    enterGate,
    releaseGate,
    fatalHook,
  };
}

function asRequest(request: RequestHarness): IncomingMessage {
  const structuralRequest: unknown = request;
  return structuralRequest as IncomingMessage;
}

function asResponse(response: ResponseHarness): ServerResponse {
  const structuralResponse: unknown = response;
  return structuralResponse as ServerResponse;
}

function apiRequest(
  path: string,
  value: unknown,
  authorized = true,
): {
  readonly request: RequestHarness;
  readonly bytes: Buffer;
} {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  const request = new RequestHarness();
  request.method = "POST";
  request.url = path;
  request.rawHeaders = [
    "Host",
    HOST,
    "Origin",
    ORIGIN,
    "Sec-Fetch-Site",
    "same-origin",
    "Sec-Fetch-Mode",
    "cors",
    "Sec-Fetch-Dest",
    "empty",
    "Content-Type",
    "application/json",
    "Content-Length",
    String(bytes.byteLength),
  ];
  if (authorized) {
    request.rawHeaders.push("Authorization", AUTHORIZATION);
    request.headers.authorization = AUTHORIZATION;
  }
  return { request, bytes };
}

async function performApi(
  router: GrandHallT554NativeReviewRouterV2,
  path: string,
  body: unknown,
  authorized = true,
  response = new ResponseHarness(),
): Promise<{
  readonly request: RequestHarness;
  readonly response: ResponseHarness;
}> {
  const prepared = apiRequest(path, body, authorized);
  const handling = router.handle(
    asRequest(prepared.request),
    asResponse(response),
  );
  prepared.request.emit("data", prepared.bytes);
  prepared.request.emit("end");
  await handling;
  return { request: prepared.request, response };
}

async function performPreparedApi(
  router: GrandHallT554NativeReviewRouterV2,
  prepared: ReturnType<typeof apiRequest>,
  response = new ResponseHarness(),
  emittedBytes: Buffer = prepared.bytes,
): Promise<ResponseHarness> {
  const handling = router.handle(
    asRequest(prepared.request),
    asResponse(response),
  );
  prepared.request.emit("data", emittedBytes);
  prepared.request.emit("end");
  await handling;
  return response;
}

function removeRawHeader(request: RequestHarness, name: string): void {
  const retained: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const headerName = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (
      headerName !== undefined &&
      value !== undefined &&
      headerName.toLowerCase() !== name.toLowerCase()
    ) {
      retained.push(headerName, value);
    }
  }
  request.rawHeaders = retained;
}

function replaceRawHeaderValue(
  request: RequestHarness,
  name: string,
  value: string,
): void {
  const index = request.rawHeaders.findIndex(
    (entry, entryIndex) =>
      entryIndex % 2 === 0 && entry.toLowerCase() === name.toLowerCase(),
  );
  if (index < 0) throw new Error(`Missing test header ${name}.`);
  request.rawHeaders[index + 1] = value;
}

function jsonResponse(response: ResponseHarness): unknown {
  return JSON.parse(Buffer.concat(response.chunks).toString("utf8")) as unknown;
}

const VERSIONS = GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2;
const EPOCH_REVISION_GENERATION = {
  expectedBrowserEpochNumber: 1,
  expectedWorkspaceRevision: 0,
  renderGeneration: 1,
} as const;
const TILE = {
  expectedBrowserEpochNumber: 1,
  renderGeneration: 1,
  column: 0,
  row: 0,
} as const;
const COVERAGE = {
  expectedBrowserEpochNumber: 1,
  renderGeneration: 1,
  documentVisibilityState: "visible",
  documentFocusState: "focused",
  viewportCssWidth: 1_024,
  viewportCssHeight: 512,
  devicePixelRatio: 1,
  sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  paintedTiles: [{ column: 0, row: 0 }],
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("Grand Hall T-554 injected native review router v2", () => {
  it("is immutable, one-shot for launch bootstrap, and has no launch surface", () => {
    const testHarness = routerHarness();
    expect(testHarness.router.schemaVersion).toBe(
      GRAND_HALL_T554_NATIVE_REVIEW_ROUTER_V2,
    );
    expect(Object.isFrozen(testHarness.router)).toBe(true);
    expect(testHarness.router.takeBootstrapFragmentForLaunch()).toBe(
      `#bootstrap=${"A".repeat(43)}`,
    );
    expect(testHarness.router.takeBootstrapFragmentForLaunch()).toBeNull();
    expect(Object.keys(testHarness.router).sort()).toEqual(["schemaVersion"]);
  });

  it.each([
    [
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.document,
      "html",
      "text/html; charset=utf-8",
    ],
    [
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.stylesheet,
      "css",
      "text/css; charset=utf-8",
    ],
    [
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.script,
      "js",
      "text/javascript; charset=utf-8",
    ],
  ] as const)(
    "serves exact frozen bytes for GET %s with locked security headers",
    async (path, body, contentType) => {
      const testHarness = routerHarness();
      const request = new RequestHarness();
      request.url = path;
      const response = new ResponseHarness();

      await testHarness.router.handle(asRequest(request), asResponse(response));

      expect(Buffer.concat(response.chunks).toString("utf8")).toBe(body);
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("content-security-policy")).toBe(
        GRAND_HALL_T554_NATIVE_REVIEW_SECURITY_HEADERS_V2[
          "Content-Security-Policy"
        ],
      );
      expect(response.headers.get("content-security-policy")).not.toMatch(
        /blob:|data:|unsafe-inline/u,
      );
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
      expect(testHarness.releaseGate).toHaveBeenCalledTimes(1);
    },
  );

  it("holds the request gate through the ordinary response terminal event", async () => {
    const testHarness = routerHarness();
    const request = new RequestHarness();
    const response = new ResponseHarness();
    response.autoFinish = false;
    let settled = false;
    const handling = testHarness.router
      .handle(asRequest(request), asResponse(response))
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(testHarness.releaseGate).not.toHaveBeenCalled();

    response.writableFinished = true;
    response.emit("finish");
    await handling;
    expect(testHarness.releaseGate).toHaveBeenCalledTimes(1);
  });

  it("serves private asset copies after the caller mutates its frozen container's buffers", async () => {
    const testHarness = routerHarness();
    const documentHtml = Buffer.from("original-html");
    const stylesheetCss = Buffer.from("original-css");
    const applicationJavascript = Buffer.from("original-js");
    const router = createGrandHallT554NativeReviewRouterV2({
      operatorSession: testHarness.operator.session,
      tokenBroker: {
        bootstrapFragment: "#bootstrap=test",
        exchangeBootstrapToken: () => "test",
        authorizeRequest: () => undefined,
        destroy: () => undefined,
      },
      requestGate: asRequestGate({ enter: () => () => undefined }),
      staticAssets: Object.freeze({
        documentHtml,
        stylesheetCss,
        applicationJavascript,
      }),
      onFatal: () => undefined,
    });
    documentHtml.fill(0x78);
    stylesheetCss.fill(0x78);
    applicationJavascript.fill(0x78);
    const request = new RequestHarness();
    const response = new ResponseHarness();
    await router.handle(asRequest(request), asResponse(response));
    expect(Buffer.concat(response.chunks).toString("utf8")).toBe(
      "original-html",
    );
    await router.close();
  });

  it("exchanges bootstrap without Authorization and never invokes operator authority", async () => {
    const testHarness = routerHarness();
    const response = await performApi(
      testHarness.router,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap,
      { schemaVersion: VERSIONS.bootstrap, bootstrapToken: "A".repeat(43) },
      false,
    );
    expect(testHarness.exchangeBootstrapToken).toHaveBeenCalledWith(
      "A".repeat(43),
    );
    expect(testHarness.authorizeRequest).not.toHaveBeenCalled();
    expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
    expect(jsonResponse(response.response)).toEqual({
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.bootstrap,
      bearerToken: "B".repeat(43),
    });
  });

  it.each([
    [
      "state",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
      "snapshot",
    ],
    [
      "source select",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceSelect,
      {
        schemaVersion: VERSIONS.sourceSelect,
        expectedBrowserEpochNumber: 1,
        expectedWorkspaceRevision: 0,
        inventoryIndex: 0,
      },
      "selectSource",
    ],
    [
      "source coverage",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceCoverage,
      { schemaVersion: VERSIONS.sourceCoverage, ...COVERAGE },
      "recordSourceCoverage",
    ],
    [
      "source exclude",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceExclude,
      {
        schemaVersion: VERSIONS.sourceExclude,
        ...EPOCH_REVISION_GENERATION,
        note: "none",
      },
      "recordExcludeDecision",
    ],
    [
      "leave pending",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceLeavePending,
      {
        schemaVersion: VERSIONS.sourceLeavePending,
        ...EPOCH_REVISION_GENERATION,
      },
      "leaveSourcePending",
    ],
    [
      "mask begin",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskBegin,
      { schemaVersion: VERSIONS.maskBegin, ...EPOCH_REVISION_GENERATION },
      "beginMaskWorkflow",
    ],
    [
      "mask edit",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskEdit,
      {
        schemaVersion: VERSIONS.maskEdit,
        ...EPOCH_REVISION_GENERATION,
        edit: {
          expectedRevision: 0,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 1,
            bottomExclusivePx: 1,
          },
        },
      },
      "applyMaskEdit",
    ],
    [
      "mask freeze",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskFreeze,
      {
        schemaVersion: VERSIONS.maskFreeze,
        ...EPOCH_REVISION_GENERATION,
        expectedMaskRevision: 1,
      },
      "freezeMask",
    ],
    [
      "mask-review coverage",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskReviewCoverage,
      { schemaVersion: VERSIONS.maskReviewCoverage, ...COVERAGE },
      "recordMaskCoverage",
    ],
    [
      "source include",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceInclude,
      {
        schemaVersion: VERSIONS.sourceInclude,
        ...EPOCH_REVISION_GENERATION,
        classification: "grand_hall_core",
        note: "include",
      },
      "recordIncludeDecision",
    ],
    [
      "source attest",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceAttest,
      {
        schemaVersion: VERSIONS.sourceAttest,
        ...EPOCH_REVISION_GENERATION,
        reviewerId: "human",
        knowledgeBasis: ["visual review"],
      },
      "recordHumanAttestation",
    ],
    [
      "source abandon",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceAbandon,
      { schemaVersion: VERSIONS.sourceAbandon, ...EPOCH_REVISION_GENERATION },
      "abandonActiveSource",
    ],
    [
      "session stop",
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sessionStop,
      {
        schemaVersion: VERSIONS.sessionStop,
        expectedBrowserEpochNumber: 1,
        expectedWorkspaceRevision: 0,
      },
      "stop",
    ],
  ] as const)(
    "dispatches exact %s route to %s",
    async (_label, path, body, methodName) => {
      const testHarness = routerHarness();
      const result = await performApi(testHarness.router, path, body);
      expect(testHarness.authorizeRequest).toHaveBeenCalledTimes(1);
      expect(testHarness.operator[methodName]).toHaveBeenCalledTimes(1);
      expect(result.response.statusCode).toBe(200);
      if (methodName === "abandonActiveSource") {
        expect(testHarness.operator.abandonActiveSource).toHaveBeenCalledWith({
          ...EPOCH_REVISION_GENERATION,
          reason: "operator_abandon",
        });
      }
    },
  );

  it("writes one exact original source buffer and commits only after finish", async () => {
    const testHarness = routerHarness();
    const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
    const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
    testHarness.operator.prepareSourceTile.mockResolvedValue(
      sourceTile(commit, discard),
    );

    const result = await performApi(
      testHarness.router,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );

    expect(result.response.chunks).toEqual([SOURCE_RGB8]);
    expect(result.response.chunks[0]).toBe(SOURCE_RGB8);
    expect(result.response.headers.get("content-length")).toBe(196_608);
    expect(result.response.headers.has("content-encoding")).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it.each([
    [GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskTile, VERSIONS.maskTile],
    [
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskReviewTile,
      VERSIONS.maskReviewTile,
    ],
  ] as const)(
    "writes exact original source, mask, reason planes sequentially for %s",
    async (path, schemaVersion) => {
      const testHarness = routerHarness();
      const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
      testHarness.operator.prepareMaskTile.mockResolvedValue(maskTile(commit));
      const result = await performApi(testHarness.router, path, {
        schemaVersion,
        ...TILE,
      });
      expect(result.response.chunks).toHaveLength(3);
      expect(result.response.chunks[0]).toBe(SOURCE_RGB8);
      expect(result.response.chunks[1]).toBe(MASK8);
      expect(result.response.chunks[2]).toBe(REASON8);
      expect(result.response.headers.get("content-length")).toBe(327_680);
      expect(result.response.headers.has("content-encoding")).toBe(false);
      expect(commit).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [255, 256, 196_608],
    [256, 255, 196_608],
    [256, 256, 196_607],
    [256, 256, 196_609],
  ] as const)(
    "discards a non-exact source tile %sx%s with %s bytes",
    async (widthPx, heightPx, byteLength) => {
      const testHarness = routerHarness();
      const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
      const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
      testHarness.operator.prepareSourceTile.mockResolvedValue({
        ...sourceTile(commit, discard),
        widthPx,
        heightPx,
        sourceRgb8: Buffer.alloc(byteLength),
      });
      const result = await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
        { schemaVersion: VERSIONS.sourceTile, ...TILE },
      );
      expect(commit).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledTimes(1);
      expect(result.response.statusCode).toBe(500);
    },
  );

  it.each([
    [255, 256, 255 * 256 * 3, 65_536, 65_536],
    [256, 255, 256 * 255 * 3, 65_536, 65_536],
    [256, 256, 196_607, 65_536, 65_536],
    [256, 256, 196_608, 65_535, 65_536],
    [256, 256, 196_608, 65_536, 65_535],
  ] as const)(
    "discards non-exact tile dimensions/planes %sx%s",
    async (widthPx, heightPx, sourceLength, maskLength, reasonLength) => {
      const testHarness = routerHarness();
      const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
      const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
      testHarness.operator.prepareMaskTile.mockResolvedValue({
        ...maskTile(commit, discard),
        widthPx,
        heightPx,
        sourceRgb8: Buffer.alloc(sourceLength),
        mask8: Buffer.alloc(maskLength),
        reason8: Buffer.alloc(reasonLength),
      });
      const result = await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskTile,
        { schemaVersion: VERSIONS.maskTile, ...TILE },
      );
      expect(commit).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledTimes(1);
      expect(result.response.statusCode).toBe(500);
    },
  );

  it.each(["setHeader", "write", "end"] as const)(
    "destroys a partially started response and discards after synchronous %s failure",
    async (failurePoint) => {
      const testHarness = routerHarness();
      const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
      const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
      testHarness.operator.prepareMaskTile.mockResolvedValue(
        maskTile(commit, discard),
      );
      const response = new ResponseHarness();
      if (failurePoint === "setHeader") response.throwOnSetHeader = true;
      if (failurePoint === "write") response.throwOnWrite = true;
      if (failurePoint === "end") response.throwOnEnd = true;

      await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.maskTile,
        { schemaVersion: VERSIONS.maskTile, ...TILE },
        true,
        response,
      );

      expect(response.destroy).toHaveBeenCalledTimes(1);
      expect(commit).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "destroyed",
    "headersSent",
    "writableEnded",
    "writableFinished",
  ] as const)(
    "late-bound tile response with initial %s state is discarded without a write",
    async (state) => {
      const testHarness = routerHarness();
      const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
      const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
      testHarness.operator.prepareSourceTile.mockResolvedValue(
        sourceTile(commit, discard),
      );
      const response = new ResponseHarness();
      response[state] = true;

      await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
        { schemaVersion: VERSIONS.sourceTile, ...TILE },
        true,
        response,
      );

      expect(commit).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledTimes(1);
      expect(response.end).not.toHaveBeenCalled();
      expect(testHarness.releaseGate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "request-aborted",
    "request-error",
    "response-close",
    "response-error",
  ] as const)(
    "discards and terminalizes a pending tile on %s",
    async (signal) => {
      const testHarness = routerHarness();
      const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
      const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
      testHarness.operator.prepareSourceTile.mockResolvedValue(
        sourceTile(commit, discard),
      );
      const prepared = apiRequest(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
        { schemaVersion: VERSIONS.sourceTile, ...TILE },
      );
      const response = new ResponseHarness();
      response.autoFinish = false;
      const handling = testHarness.router.handle(
        asRequest(prepared.request),
        asResponse(response),
      );
      prepared.request.emit("data", prepared.bytes);
      prepared.request.emit("end");
      await vi.waitFor(() => {
        expect(response.end).toHaveBeenCalledTimes(1);
      });

      if (signal === "request-aborted") {
        prepared.request.aborted = true;
        prepared.request.destroyed = true;
        prepared.request.emit("aborted");
      } else if (signal === "request-error") {
        prepared.request.emit("error", new Error("private request failure"));
      } else if (signal === "response-close") {
        response.destroy();
      } else {
        response.emit("error", new Error("private response failure"));
      }
      response.writableFinished = true;
      response.emit("finish");
      await handling;

      expect(commit).not.toHaveBeenCalled();
      expect(discard).toHaveBeenCalledTimes(1);
      expect(response.destroyed).toBe(true);
      expect(testHarness.releaseGate).toHaveBeenCalledTimes(1);
    },
  );

  it("latches fatal delivery failure without an unhandled cleanup promise or second response", async () => {
    const testHarness = routerHarness();
    const cause = new Error("secret durable commit failure");
    const commit = vi.fn<() => Promise<void>>().mockRejectedValue(cause);
    const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
    testHarness.operator.prepareSourceTile.mockResolvedValue(
      sourceTile(commit, discard),
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const result = await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
        { schemaVersion: VERSIONS.sourceTile, ...TILE },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(testHarness.destroyBroker).toHaveBeenCalledTimes(1);
      expect(testHarness.operator.close).toHaveBeenCalledTimes(1);
      expect(testHarness.fatalHook).toHaveBeenCalledWith({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-router-fatal.v2",
        code: "TILE_DELIVERY_COMMIT_FAILED",
      });
      expect(result.response.end).toHaveBeenCalledTimes(1);
      expect(
        Buffer.concat(result.response.chunks).includes(Buffer.from("secret")),
      ).toBe(false);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("observes a discard-callback rejection without an unhandled handle or lifecycle promise", async () => {
    const testHarness = routerHarness();
    const discard = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("private discard failure"));
    testHarness.operator.prepareSourceTile.mockResolvedValue(
      sourceTile(undefined, discard),
    );
    const prepared = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    const response = new ResponseHarness();
    response.autoFinish = false;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const handling = testHarness.router.handle(
        asRequest(prepared.request),
        asResponse(response),
      );
      prepared.request.emit("data", prepared.bytes);
      prepared.request.emit("end");
      await vi.waitFor(() => {
        expect(response.end).toHaveBeenCalledTimes(1);
      });
      response.destroy();
      await handling;
      await testHarness.router.close().catch(() => undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(discard).toHaveBeenCalledTimes(1);
      expect(testHarness.fatalHook).toHaveBeenCalledWith({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-router-fatal.v2",
        code: "TILE_DELIVERY_DISCARD_FAILED",
      });
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("drains adapter discard before operator close and makes close idempotent", async () => {
    const testHarness = routerHarness();
    const order: string[] = [];
    const discard = vi.fn<() => Promise<void>>().mockImplementation(() => {
      order.push("discard");
      return Promise.resolve();
    });
    testHarness.operator.close.mockImplementation(() => {
      order.push("operator-close");
      return Promise.resolve();
    });
    testHarness.operator.prepareSourceTile.mockResolvedValue(
      sourceTile(vi.fn<() => Promise<void>>().mockResolvedValue(), discard),
    );
    const response = new ResponseHarness();
    response.autoFinish = false;
    const prepared = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    const handling = testHarness.router.handle(
      asRequest(prepared.request),
      asResponse(response),
    );
    prepared.request.emit("data", prepared.bytes);
    prepared.request.emit("end");
    await Promise.resolve();

    const firstClose = testHarness.router.close();
    const secondClose = testHarness.router.close();
    expect(secondClose).toBe(firstClose);
    await Promise.all([handling, firstClose]);

    expect(order).toEqual(["discard", "operator-close"]);
    expect(testHarness.destroyBroker).toHaveBeenCalledTimes(1);
    expect(testHarness.operator.close).toHaveBeenCalledTimes(1);
    expect(testHarness.releaseGate).toHaveBeenCalledTimes(1);
  });

  it("drains every admitted handle and tile discard before operator close", async () => {
    const testHarness = routerHarness();
    const order: string[] = [];
    const firstDiscard = vi.fn<() => Promise<void>>().mockImplementation(() => {
      order.push("discard-one");
      return Promise.resolve();
    });
    const secondDiscard = vi
      .fn<() => Promise<void>>()
      .mockImplementation(() => {
        order.push("discard-two");
        return Promise.resolve();
      });
    testHarness.operator.close.mockImplementation(() => {
      order.push("operator-close");
      return Promise.resolve();
    });
    testHarness.operator.prepareSourceTile
      .mockResolvedValueOnce(sourceTile(undefined, firstDiscard))
      .mockResolvedValueOnce(sourceTile(undefined, secondDiscard));
    const first = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    const second = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    const firstResponse = new ResponseHarness();
    const secondResponse = new ResponseHarness();
    firstResponse.autoFinish = false;
    secondResponse.autoFinish = false;
    const firstHandling = testHarness.router.handle(
      asRequest(first.request),
      asResponse(firstResponse),
    );
    const secondHandling = testHarness.router.handle(
      asRequest(second.request),
      asResponse(secondResponse),
    );
    first.request.emit("data", first.bytes);
    first.request.emit("end");
    second.request.emit("data", second.bytes);
    second.request.emit("end");
    await vi.waitFor(() => {
      expect(firstResponse.end).toHaveBeenCalledTimes(1);
      expect(secondResponse.end).toHaveBeenCalledTimes(1);
    });

    await Promise.all([
      firstHandling,
      secondHandling,
      testHarness.router.close(),
    ]);
    expect(firstDiscard).toHaveBeenCalledTimes(1);
    expect(secondDiscard).toHaveBeenCalledTimes(1);
    expect(order.at(-1)).toBe("operator-close");
    expect(testHarness.operator.close).toHaveBeenCalledTimes(1);
  });

  it("drains another pending tile before operator close when one commit latches fatal", async () => {
    const testHarness = routerHarness();
    const order: string[] = [];
    const failingCommit = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("private commit failure"));
    const secondDiscard = vi
      .fn<() => Promise<void>>()
      .mockImplementation(() => {
        order.push("second-discard");
        return Promise.resolve();
      });
    testHarness.operator.close.mockImplementation(() => {
      order.push("operator-close");
      return Promise.resolve();
    });
    testHarness.operator.prepareSourceTile
      .mockResolvedValueOnce(sourceTile(failingCommit))
      .mockResolvedValueOnce(sourceTile(undefined, secondDiscard));
    const first = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    const second = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    const firstResponse = new ResponseHarness();
    const secondResponse = new ResponseHarness();
    firstResponse.autoFinish = false;
    secondResponse.autoFinish = false;
    const firstHandling = testHarness.router.handle(
      asRequest(first.request),
      asResponse(firstResponse),
    );
    const secondHandling = testHarness.router.handle(
      asRequest(second.request),
      asResponse(secondResponse),
    );
    first.request.emit("data", first.bytes);
    first.request.emit("end");
    second.request.emit("data", second.bytes);
    second.request.emit("end");
    await vi.waitFor(() => {
      expect(firstResponse.end).toHaveBeenCalledTimes(1);
      expect(secondResponse.end).toHaveBeenCalledTimes(1);
    });
    firstResponse.writableFinished = true;
    firstResponse.emit("finish");

    await Promise.all([firstHandling, secondHandling]);
    await expect(testHarness.router.close()).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(failingCommit).toHaveBeenCalledTimes(1);
    expect(secondDiscard).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["second-discard", "operator-close"]);
    expect(testHarness.fatalHook).toHaveBeenCalledTimes(1);
  });

  it("allows the fatal hook to await router.close without a promise cycle", async () => {
    const operator = operatorHarness();
    operator.prepareSourceTile.mockResolvedValue(
      sourceTile(
        vi
          .fn<() => Promise<void>>()
          .mockRejectedValue(new Error("private durable failure")),
      ),
    );
    let router: GrandHallT554NativeReviewRouterV2 | null = null;
    const fatalHook = vi.fn<
      (event: GrandHallT554NativeReviewRouterFatalEventV2) => Promise<void>
    >(() => {
      if (router === null) return Promise.reject(new Error("Router missing."));
      return router.close();
    });
    router = createGrandHallT554NativeReviewRouterV2({
      operatorSession: operator.session,
      tokenBroker: {
        bootstrapFragment: "#bootstrap=test",
        exchangeBootstrapToken: () => "test",
        authorizeRequest: () => undefined,
        destroy: () => undefined,
      },
      requestGate: asRequestGate({ enter: () => () => undefined }),
      staticAssets: Object.freeze({
        documentHtml: Buffer.from("html"),
        stylesheetCss: Buffer.from("css"),
        applicationJavascript: Buffer.from("js"),
      }),
      onFatal: fatalHook,
    });

    await performApi(
      router,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
      { schemaVersion: VERSIONS.sourceTile, ...TILE },
    );
    await expect(router.close()).rejects.toBeInstanceOf(AggregateError);
    expect(fatalHook).toHaveBeenCalledTimes(1);
    expect(operator.close).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled request body and stalled ordinary response terminal", async () => {
    vi.useFakeTimers();
    const bodyHarness = routerHarness();
    const prepared = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    const bodyResponse = new ResponseHarness();
    const bodyHandling = bodyHarness.router.handle(
      asRequest(prepared.request),
      asResponse(bodyResponse),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await bodyHandling;
    expect(prepared.request.destroy).toHaveBeenCalledTimes(1);
    expect(bodyHarness.releaseGate).toHaveBeenCalledTimes(1);

    const responseHarness = routerHarness();
    const request = new RequestHarness();
    const response = new ResponseHarness();
    response.autoFinish = false;
    const responseHandling = responseHarness.router.handle(
      asRequest(request),
      asResponse(response),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await responseHandling;
    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(responseHarness.releaseGate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-loopback local address", "localAddress", "::1", 403],
    ["non-loopback remote address", "remoteAddress", "::1", 403],
    ["zero local port", "localPort", 0, 403],
  ] as const)(
    "rejects %s before serving bytes",
    async (_label, property, value, expectedStatus) => {
      const testHarness = routerHarness();
      const request = new RequestHarness();
      if (property === "localAddress") {
        request.socket.localAddress = String(value);
      } else if (property === "remoteAddress") {
        request.socket.remoteAddress = String(value);
      } else {
        request.socket.localPort = Number(value);
      }
      const response = new ResponseHarness();
      await testHarness.router.handle(asRequest(request), asResponse(response));
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.chunks).toHaveLength(1);
      expect(Buffer.concat(response.chunks).toString("utf8")).not.toContain(
        "html",
      );
    },
  );

  it.each(["missing", "wrong", "dns-name", "duplicate"] as const)(
    "rejects a %s Host header",
    async (mode) => {
      const testHarness = routerHarness();
      const request = new RequestHarness();
      if (mode === "missing") removeRawHeader(request, "host");
      if (mode === "wrong") replaceRawHeaderValue(request, "host", HOST + "0");
      if (mode === "dns-name") {
        replaceRawHeaderValue(request, "host", `localhost:${String(PORT)}`);
      }
      if (mode === "duplicate") request.rawHeaders.push("Host", HOST);
      const response = new ResponseHarness();
      await testHarness.router.handle(asRequest(request), asResponse(response));
      expect(response.statusCode).toBe(421);
      expect(Buffer.concat(response.chunks).toString("utf8")).not.toContain(
        "html",
      );
    },
  );

  it("requires one exact Origin and all Fetch Metadata headers on bootstrap, state, and tile APIs", async () => {
    const routeCases = [
      {
        path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap,
        body: {
          schemaVersion: VERSIONS.bootstrap,
          bootstrapToken: "A".repeat(43),
        },
        authorized: false,
      },
      {
        path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
        body: { schemaVersion: VERSIONS.state },
        authorized: true,
      },
      {
        path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.sourceTile,
        body: { schemaVersion: VERSIONS.sourceTile, ...TILE },
        authorized: true,
      },
    ] as const;
    const provenanceHeaders = [
      ["Origin", ORIGIN],
      ["Sec-Fetch-Site", "same-origin"],
      ["Sec-Fetch-Mode", "cors"],
      ["Sec-Fetch-Dest", "empty"],
    ] as const;
    for (const routeCase of routeCases) {
      for (const [name, expected] of provenanceHeaders) {
        for (const mode of ["missing", "wrong", "duplicate"] as const) {
          const testHarness = routerHarness();
          const prepared = apiRequest(
            routeCase.path,
            routeCase.body,
            routeCase.authorized,
          );
          if (mode === "missing") removeRawHeader(prepared.request, name);
          if (mode === "wrong") {
            replaceRawHeaderValue(prepared.request, name, `${expected}-wrong`);
          }
          if (mode === "duplicate") {
            prepared.request.rawHeaders.push(name, expected);
          }
          const response = await performPreparedApi(
            testHarness.router,
            prepared,
          );
          expect(response.statusCode, `${routeCase.path} ${name} ${mode}`).toBe(
            403,
          );
          expect(testHarness.authorizeRequest).not.toHaveBeenCalled();
        }
      }
    }
  });

  it.each([
    "/?query=1",
    "http://127.0.0.1/",
    "/api/%76v2/state",
    "/api\\v2/state",
    "/api//v2/state",
    "/api/./v2/state",
    "/api/../v2/state",
    "/api/v2/state\u0000",
    "/api/v2/státe",
  ])("rejects raw target alias %s before dispatch", async (url) => {
    const testHarness = routerHarness();
    const request = new RequestHarness();
    request.url = url;
    const response = new ResponseHarness();
    await testHarness.router.handle(asRequest(request), asResponse(response));
    expect(response.statusCode).toBe(400);
    expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
  });

  it.each(["OPTIONS", "TRACE", "CONNECT", "PATCH", "get"])(
    "rejects unlisted method %s",
    async (method) => {
      const testHarness = routerHarness();
      const request = new RequestHarness();
      request.method = method;
      const response = new ResponseHarness();
      await testHarness.router.handle(asRequest(request), asResponse(response));
      expect(response.statusCode).toBe(405);
    },
  );

  it.each([
    ["Cookie", "secret=1"],
    ["Expect", "100-continue"],
    ["Upgrade", "websocket"],
    ["Access-Control-Request-Method", "POST"],
    ["Transfer-Encoding", "chunked"],
    ["TE", "trailers"],
    ["Content-Encoding", "gzip"],
    ["Trailer", "X-Checksum"],
  ] as const)("rejects forbidden transport header %s", async (name, value) => {
    const testHarness = routerHarness();
    const request = new RequestHarness();
    request.rawHeaders.push(name, value);
    const response = new ResponseHarness();
    await testHarness.router.handle(asRequest(request), asResponse(response));
    expect(response.statusCode).toBe(400);
  });

  it.each(["\u0000", "\u0001", "\u0008", "\u000b", "\u001f", "\u007f"])(
    "rejects raw header control value U+%s",
    async (control) => {
      const testHarness = routerHarness();
      const request = new RequestHarness();
      request.rawHeaders.push("X-Test", control);
      const response = new ResponseHarness();
      await testHarness.router.handle(asRequest(request), asResponse(response));
      expect(response.statusCode).toBe(400);
    },
  );

  it.each(["odd", "pair-cap", "byte-cap"] as const)(
    "rejects raw header %s violation",
    async (mode) => {
      const testHarness = routerHarness();
      const request = new RequestHarness();
      if (mode === "odd") request.rawHeaders.push("X-Odd");
      if (mode === "pair-cap") {
        for (let index = 0; index < 64; index += 1) {
          request.rawHeaders.push(`X-${String(index)}`, "x");
        }
      }
      if (mode === "byte-cap") {
        request.rawHeaders.push("X-Large", "x".repeat(16_384));
      }
      const response = new ResponseHarness();
      await testHarness.router.handle(asRequest(request), asResponse(response));
      expect(response.statusCode).toBe(400);
    },
  );

  it.each(["missing", "duplicate"] as const)(
    "rejects %s Authorization before reading a non-bootstrap API body",
    async (mode) => {
      const testHarness = routerHarness();
      const prepared = apiRequest(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
        { schemaVersion: VERSIONS.state },
      );
      if (mode === "missing")
        removeRawHeader(prepared.request, "authorization");
      if (mode === "duplicate") {
        prepared.request.rawHeaders.push("Authorization", AUTHORIZATION);
      }
      const response = await performPreparedApi(testHarness.router, prepared);
      expect(response.statusCode).toBe(401);
      expect(testHarness.authorizeRequest).not.toHaveBeenCalled();
      expect(prepared.request.resume).not.toHaveBeenCalled();
      expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "duplicate", "malformed", "short", "long"] as const)(
    "rejects a %s JSON Content-Length boundary",
    async (mode) => {
      const testHarness = routerHarness();
      const prepared = apiRequest(
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
        { schemaVersion: VERSIONS.state },
      );
      let emitted = prepared.bytes;
      if (mode === "missing")
        removeRawHeader(prepared.request, "content-length");
      if (mode === "duplicate") {
        prepared.request.rawHeaders.push(
          "Content-Length",
          String(prepared.bytes.byteLength),
        );
      }
      if (mode === "malformed") {
        replaceRawHeaderValue(
          prepared.request,
          "content-length",
          `0${String(prepared.bytes.byteLength)}`,
        );
      }
      if (mode === "short") {
        replaceRawHeaderValue(
          prepared.request,
          "content-length",
          String(prepared.bytes.byteLength + 1),
        );
      }
      if (mode === "long") {
        replaceRawHeaderValue(
          prepared.request,
          "content-length",
          String(prepared.bytes.byteLength - 1),
        );
        emitted = prepared.bytes;
      }
      const response = await performPreparedApi(
        testHarness.router,
        prepared,
        new ResponseHarness(),
        emitted,
      );
      expect(response.statusCode).toBe(400);
      expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized declared JSON body before attaching listeners", async () => {
    const testHarness = routerHarness();
    const prepared = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    replaceRawHeaderValue(prepared.request, "content-length", "262145");
    const response = await performPreparedApi(testHarness.router, prepared);
    expect(response.statusCode).toBe(413);
    expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
  });

  it("authenticates every non-bootstrap API before attaching body listeners", async () => {
    const testHarness = routerHarness();
    const prepared = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    testHarness.authorizeRequest.mockImplementation(() => {
      expect(prepared.request.listenerCount("data")).toBe(0);
    });
    const response = new ResponseHarness();
    const handling = testHarness.router.handle(
      asRequest(prepared.request),
      asResponse(response),
    );
    prepared.request.emit("data", prepared.bytes);
    prepared.request.emit("end");
    await handling;
    expect(testHarness.operator.snapshot).toHaveBeenCalledTimes(1);
  });

  it("integrates the real broker for one-winner bootstrap, bearer format, reuse, and expiry", async () => {
    let now = 0;
    const broker = createLocalSessionTokenBroker({
      ttlMs: 5 * 60 * 1_000,
      monotonicNowMs: () => now,
    });
    const operator = operatorHarness();
    const router = createGrandHallT554NativeReviewRouterV2({
      operatorSession: operator.session,
      tokenBroker: broker,
      requestGate: new LocalSessionRequestGate(),
      staticAssets: Object.freeze({
        documentHtml: Buffer.from("html"),
        stylesheetCss: Buffer.from("css"),
        applicationJavascript: Buffer.from("js"),
      }),
      onFatal: () => undefined,
    });
    const fragment = router.takeBootstrapFragmentForLaunch();
    expect(fragment).toMatch(/^#bootstrap=[A-Za-z0-9_-]{43}$/u);
    const bootstrapToken = fragment?.slice("#bootstrap=".length);
    if (bootstrapToken === undefined)
      throw new Error("Missing bootstrap token.");

    const first = await performApi(
      router,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap,
      { schemaVersion: VERSIONS.bootstrap, bootstrapToken },
      false,
    );
    expect(first.response.statusCode).toBe(200);
    const bootstrapDto = jsonResponse(first.response);
    if (
      !(
        typeof bootstrapDto === "object" &&
        bootstrapDto !== null &&
        "bearerToken" in bootstrapDto &&
        typeof bootstrapDto.bearerToken === "string"
      )
    ) {
      throw new Error("Missing real bearer token.");
    }
    const bearerToken = bootstrapDto.bearerToken;

    const reuse = await performApi(
      router,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap,
      { schemaVersion: VERSIONS.bootstrap, bootstrapToken },
      false,
    );
    expect(reuse.response.statusCode).toBe(401);

    const malformed = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    replaceRawHeaderValue(malformed.request, "authorization", "Basic nope");
    malformed.request.headers.authorization = "Basic nope";
    expect((await performPreparedApi(router, malformed)).statusCode).toBe(401);

    const authorized = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    const authorization = `Bearer ${bearerToken}`;
    replaceRawHeaderValue(authorized.request, "authorization", authorization);
    authorized.request.headers.authorization = authorization;
    expect((await performPreparedApi(router, authorized)).statusCode).toBe(200);

    now = 5 * 60 * 1_000;
    const expired = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    replaceRawHeaderValue(expired.request, "authorization", authorization);
    expired.request.headers.authorization = authorization;
    expect((await performPreparedApi(router, expired)).statusCode).toBe(401);
    await router.close();
  });

  it.each([
    "path",
    "url",
    "hash",
    "digest",
    "bitmap",
    "dwell",
    "timestamp",
    "authority",
    "acceptance",
    "upload",
    "export",
    "runtime",
    "reconstruction",
    "crash",
    "takeover",
  ])(
    "rejects prohibited browser field %s before operator dispatch",
    async (field) => {
      const testHarness = routerHarness();
      const result = await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
        { schemaVersion: VERSIONS.state, [field]: "forged" },
      );
      expect(result.response.statusCode).toBe(400);
      expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
    },
  );

  it.each([
    Buffer.from('{"schemaVersion":"x","schemaVersion":"y"}'),
    Buffer.from('{"schemaVersion":"x","__proto__":{}}'),
    Buffer.from([0xff, 0xfe]),
  ])("rejects duplicate/prototype/invalid UTF-8 JSON", async (bytes) => {
    const testHarness = routerHarness();
    const prepared = apiRequest(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    const contentLengthIndex = prepared.request.rawHeaders.findIndex(
      (value) => value === "Content-Length",
    );
    prepared.request.rawHeaders[contentLengthIndex + 1] = String(
      bytes.byteLength,
    );
    const response = new ResponseHarness();
    const handling = testHarness.router.handle(
      asRequest(prepared.request),
      asResponse(response),
    );
    prepared.request.emit("data", bytes);
    prepared.request.emit("end");
    await handling;
    expect(response.statusCode).toBe(400);
    expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
  });

  it("sanitizes operator messages and controller codes through the fixed table", async () => {
    const testHarness = routerHarness();
    testHarness.operator.snapshot.mockRejectedValue(
      Object.assign(new Error("SECRET filesystem path"), {
        code: "WORKSPACE_REVISION_CONFLICT",
      }),
    );
    const result = await performApi(
      testHarness.router,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      { schemaVersion: VERSIONS.state },
    );
    expect(result.response.statusCode).toBe(409);
    expect(jsonResponse(result.response)).toEqual({
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.error,
      error: "STATE_CONFLICT",
    });
    expect(
      Buffer.concat(result.response.chunks).toString("utf8"),
    ).not.toContain("SECRET");
  });

  it.each([
    ["ARGUMENT_INVALID", 400, "MALFORMED_REQUEST"],
    ["BROWSER_EPOCH_CONFLICT", 409, "STATE_CONFLICT"],
    ["WORKSPACE_REVISION_CONFLICT", 409, "STATE_CONFLICT"],
    ["RENDER_GENERATION_CONFLICT", 409, "STATE_CONFLICT"],
    ["MASK_REVISION_CONFLICT", 409, "STATE_CONFLICT"],
    ["PHASE_INVALID", 422, "OPERATION_REJECTED"],
    ["NO_ACTIVE_SOURCE", 422, "OPERATION_REJECTED"],
    ["SOURCE_STALE", 422, "OPERATION_REJECTED"],
    ["BINDING_STALE", 422, "OPERATION_REJECTED"],
    ["SOURCE_COVERAGE_INCOMPLETE", 422, "OPERATION_REJECTED"],
    ["MASK_COVERAGE_INCOMPLETE", 422, "OPERATION_REJECTED"],
    ["MASK_REVISION_TAINTED", 422, "OPERATION_REJECTED"],
    ["PENDING_TILE_DELIVERY", 422, "OPERATION_REJECTED"],
    ["DELIVERY_ALREADY_RESOLVED", 422, "OPERATION_REJECTED"],
    ["SESSION_CLOSED", 503, "SERVICE_UNAVAILABLE"],
    ["SESSION_STOPPED", 503, "SERVICE_UNAVAILABLE"],
    ["RECOVERY_REQUIRED", 503, "SERVICE_UNAVAILABLE"],
  ] as const)(
    "maps controller code %s to fixed %s",
    async (controllerCode, expectedStatus, expectedError) => {
      const testHarness = routerHarness();
      testHarness.operator.snapshot.mockRejectedValue(
        Object.assign(new Error("private controller detail"), {
          code: controllerCode,
        }),
      );
      const result = await performApi(
        testHarness.router,
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
        { schemaVersion: VERSIONS.state },
      );
      expect(result.response.statusCode).toBe(expectedStatus);
      expect(jsonResponse(result.response)).toEqual({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.error,
        error: expectedError,
      });
      expect(
        Buffer.concat(result.response.chunks).toString("utf8"),
      ).not.toContain("private");
    },
  );

  it("rejects new work after close without invoking broker or operator", async () => {
    const testHarness = routerHarness();
    await testHarness.router.close();
    const request = new RequestHarness();
    const response = new ResponseHarness();
    await testHarness.router.handle(asRequest(request), asResponse(response));
    expect(response.statusCode).toBe(503);
    expect(testHarness.authorizeRequest).not.toHaveBeenCalled();
    expect(testHarness.operator.snapshot).not.toHaveBeenCalled();
  });

  it("requires a frozen static asset byte container", () => {
    const testHarness = routerHarness();
    expect(() =>
      createGrandHallT554NativeReviewRouterV2({
        operatorSession: testHarness.operator.session,
        tokenBroker: {
          bootstrapFragment: "#bootstrap=x",
          exchangeBootstrapToken: () => "x",
          authorizeRequest: () => undefined,
          destroy: () => undefined,
        },
        requestGate: {
          enter: () => () => undefined,
        } as LocalSessionRequestGate,
        staticAssets: {
          documentHtml: Buffer.from("html"),
          stylesheetCss: Buffer.from("css"),
          applicationJavascript: Buffer.from("js"),
        },
        onFatal: () => undefined,
      }),
    ).toThrow(TypeError);
  });
});
