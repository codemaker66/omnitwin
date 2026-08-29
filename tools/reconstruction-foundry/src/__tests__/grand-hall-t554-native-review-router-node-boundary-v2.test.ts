import {
  createServer,
  request as createClientRequest,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2,
} from "../grand-hall-t554-native-review-http-contract-v2.js";
import type {
  GrandHallT554NativeReviewOperatorSessionSnapshotV2,
  GrandHallT554NativeReviewOperatorSessionV2,
} from "../grand-hall-t554-native-review-operator-session-v2.js";
import * as routerModule from "../grand-hall-t554-native-review-router-v2.js";
import {
  createLocalSessionTokenBroker,
  LocalSessionRequestGate,
  type LocalSessionTokenBroker,
} from "../local-session-http.js";

const LOOPBACK_HOST = "127.0.0.1";
const DOCUMENT_BYTES = Buffer.from(
  "<!doctype html><meta charset=utf-8><title>Native review boundary</title>",
  "utf8",
);
const STYLESHEET_BYTES = Buffer.from("html{color-scheme:dark}", "utf8");
const SCRIPT_BYTES = Buffer.from("export {};", "utf8");
const BEARER_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const SNAPSHOT = Object.freeze({
  schemaVersion: "venviewer.grand-hall-t554-native-review-operator-session.v2",
  lifecycle: "active",
  browserEpochNumber: 1,
  workspaceRevision: 0,
  maximumAllocatedRenderGeneration: 1,
  sources: Object.freeze([]),
  activeSource: null,
  authority: "none",
  reviewState: "human_pending",
  finalDecision: "PENDING",
  acceptanceAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  exportAuthorized: false,
  generatedContentAuthorized: false,
} satisfies GrandHallT554NativeReviewOperatorSessionSnapshotV2);

interface BoundaryResponse {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly body: Buffer;
  readonly complete: boolean;
}

interface ServerResponseObservation {
  readonly requestUrl: string | null;
  finishCount: number;
  closeCount: number;
  statusCodeAtFinish: number | null;
  writableFinishedAtFinish: boolean;
}

interface BoundaryHarness {
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
  readonly router: routerModule.GrandHallT554NativeReviewRouterV2;
  readonly tokenBroker: LocalSessionTokenBroker;
  readonly snapshotOperator: ReturnType<
    typeof vi.fn<
      () => Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>
    >
  >;
  readonly closeOperator: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly observations: ServerResponseObservation[];
}

interface RequestInput {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: readonly string[];
  readonly body?: Buffer;
}

let activeHarness: BoundaryHarness | null = null;

function rejectUnexercisedOperatorOperation(): Promise<never> {
  return Promise.reject(
    new Error("The real-node boundary test reached an unexercised operation."),
  );
}

function createOperatorHarness(): {
  readonly session: GrandHallT554NativeReviewOperatorSessionV2;
  readonly snapshotOperator: BoundaryHarness["snapshotOperator"];
  readonly closeOperator: BoundaryHarness["closeOperator"];
} {
  const snapshotOperator = vi
    .fn<() => Promise<GrandHallT554NativeReviewOperatorSessionSnapshotV2>>()
    .mockResolvedValue(SNAPSHOT);
  const closeOperator = vi.fn<() => Promise<void>>().mockResolvedValue();
  const session: GrandHallT554NativeReviewOperatorSessionV2 = {
    snapshot: snapshotOperator,
    selectSource: rejectUnexercisedOperatorOperation,
    prepareSourceTile: rejectUnexercisedOperatorOperation,
    recordSourceCoverage: rejectUnexercisedOperatorOperation,
    recordExcludeDecision: rejectUnexercisedOperatorOperation,
    beginMaskWorkflow: rejectUnexercisedOperatorOperation,
    applyMaskEdit: rejectUnexercisedOperatorOperation,
    freezeMask: rejectUnexercisedOperatorOperation,
    prepareMaskTile: rejectUnexercisedOperatorOperation,
    recordMaskCoverage: rejectUnexercisedOperatorOperation,
    recordIncludeDecision: rejectUnexercisedOperatorOperation,
    recordHumanAttestation: rejectUnexercisedOperatorOperation,
    leaveSourcePending: rejectUnexercisedOperatorOperation,
    abandonActiveSource: rejectUnexercisedOperatorOperation,
    stop: rejectUnexercisedOperatorOperation,
    close: closeOperator,
  };
  return { session, snapshotOperator, closeOperator };
}

async function startBoundaryHarness(): Promise<BoundaryHarness> {
  const operator = createOperatorHarness();
  const tokenBroker = createLocalSessionTokenBroker({
    ttlMs: 5 * 60 * 1_000,
    monotonicNowMs: () => 1,
  });
  const router = routerModule.createGrandHallT554NativeReviewRouterV2({
    operatorSession: operator.session,
    tokenBroker,
    requestGate: new LocalSessionRequestGate({
      monotonicNowMs: () => 1,
    }),
    staticAssets: Object.freeze({
      documentHtml: DOCUMENT_BYTES,
      stylesheetCss: STYLESHEET_BYTES,
      applicationJavascript: SCRIPT_BYTES,
    }),
    onFatal: () => undefined,
  });
  const observations: ServerResponseObservation[] = [];
  const server = createServer((incoming, outgoing) => {
    const observation: ServerResponseObservation = {
      requestUrl: incoming.url ?? null,
      finishCount: 0,
      closeCount: 0,
      statusCodeAtFinish: null,
      writableFinishedAtFinish: false,
    };
    observations.push(observation);
    outgoing.once("finish", () => {
      observation.finishCount += 1;
      observation.statusCodeAtFinish = outgoing.statusCode;
      observation.writableFinishedAtFinish = outgoing.writableFinished;
    });
    outgoing.once("close", () => {
      observation.closeCount += 1;
    });
    void router.handle(incoming, outgoing).catch(() => {
      if (!outgoing.destroyed) outgoing.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The loopback test server did not expose an IP address.");
  }
  const port = (address satisfies AddressInfo).port;
  const harness: BoundaryHarness = {
    server,
    port,
    origin: `http://${LOOPBACK_HOST}:${String(port)}`,
    router,
    tokenBroker,
    snapshotOperator: operator.snapshotOperator,
    closeOperator: operator.closeOperator,
    observations,
  };
  activeHarness = harness;
  return harness;
}

async function closeBoundaryHarness(harness: BoundaryHarness): Promise<void> {
  const closeRouter = harness.router.close();
  const closeServer = new Promise<void>((resolve, reject) => {
    harness.server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  await Promise.all([closeRouter, closeServer]);
  expect(harness.server.listening).toBe(false);
  expect(harness.closeOperator).toHaveBeenCalledTimes(1);
}

async function requestBoundary(
  harness: BoundaryHarness,
  input: RequestInput,
): Promise<BoundaryResponse> {
  return await new Promise<BoundaryResponse>((resolve, reject) => {
    const clientRequest = createClientRequest(
      {
        host: LOOPBACK_HOST,
        port: harness.port,
        method: input.method,
        path: input.path,
        headers: input.headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("aborted", () => {
          reject(new Error("The loopback response was aborted."));
        });
        response.once("error", reject);
        response.once("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks),
            complete: response.complete,
          });
        });
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end(input.body);
  });
}

function staticHeaders(harness: BoundaryHarness): string[] {
  return ["Host", `${LOOPBACK_HOST}:${String(harness.port)}`];
}

function apiHeaders(
  harness: BoundaryHarness,
  body: Buffer,
  authorization?: string,
): string[] {
  const headers = [
    "Host",
    `${LOOPBACK_HOST}:${String(harness.port)}`,
    "Origin",
    harness.origin,
    "Sec-Fetch-Site",
    "same-origin",
    "Sec-Fetch-Mode",
    "cors",
    "Sec-Fetch-Dest",
    "empty",
    "Content-Type",
    "application/json",
    "Content-Length",
    String(body.byteLength),
  ];
  if (authorization !== undefined) {
    headers.push("Authorization", authorization);
  }
  return headers;
}

function replaceHeader(
  headers: readonly string[],
  name: string,
  value: string,
): string[] {
  const result = [...headers];
  const index = result.findIndex(
    (entry, entryIndex) =>
      entryIndex % 2 === 0 && entry.toLowerCase() === name.toLowerCase(),
  );
  if (index < 0) throw new Error(`Missing boundary-test header ${name}.`);
  result[index + 1] = value;
  return result;
}

function removeHeader(headers: readonly string[], name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < headers.length; index += 2) {
    const headerName = headers[index];
    const headerValue = headers[index + 1];
    if (
      headerName !== undefined &&
      headerValue !== undefined &&
      headerName.toLowerCase() !== name.toLowerCase()
    ) {
      result.push(headerName, headerValue);
    }
  }
  return result;
}

function parseJsonObject(response: BoundaryResponse): Record<string, unknown> {
  const parsed: unknown = JSON.parse(response.body.toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The boundary response was not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function bootstrapToken(router: BoundaryHarness["router"]): string {
  const fragment = router.takeBootstrapFragmentForLaunch();
  if (fragment === null || !fragment.startsWith("#bootstrap=")) {
    throw new Error(
      "The router did not expose its one-shot bootstrap fragment.",
    );
  }
  return fragment.slice("#bootstrap=".length);
}

function exchangeBearerDirectly(harness: BoundaryHarness): string {
  return harness.tokenBroker.exchangeBootstrapToken(
    bootstrapToken(harness.router),
  );
}

function expectSecurityHeaders(response: BoundaryResponse): void {
  for (const [name, value] of Object.entries(
    routerModule.GRAND_HALL_T554_NATIVE_REVIEW_SECURITY_HEADERS_V2,
  )) {
    expect(response.headers[name.toLowerCase()], name).toBe(value);
  }
}

function expectFinishedResponse(
  harness: BoundaryHarness,
  observationIndex: number,
  statusCode: number,
): void {
  const observation = harness.observations[observationIndex];
  expect(observation).toMatchObject({
    finishCount: 1,
    closeCount: 1,
    statusCodeAtFinish: statusCode,
    writableFinishedAtFinish: true,
  });
}

afterEach(async () => {
  if (activeHarness === null) return;
  const harness = activeHarness;
  activeHarness = null;
  if (harness.server.listening) await closeBoundaryHarness(harness);
});

describe("Grand Hall T-554 native-review router real node:http boundary v2", () => {
  it("exposes only an injected router and no server creation or listen surface", async () => {
    expect(Object.keys(routerModule).sort()).toEqual(
      [
        "GRAND_HALL_T554_NATIVE_REVIEW_ROUTER_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_SECURITY_HEADERS_V2",
        "createGrandHallT554NativeReviewRouterV2",
      ].sort(),
    );
    expect("createServer" in routerModule).toBe(false);
    expect("listen" in routerModule).toBe(false);

    const harness = await startBoundaryHarness();
    expect("createServer" in harness.router).toBe(false);
    expect("listen" in harness.router).toBe(false);
  });

  it("serves exact static bytes and completes real bootstrap and bearer-authenticated state requests", async () => {
    const harness = await startBoundaryHarness();
    const staticResponse = await requestBoundary(harness, {
      method: "GET",
      path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.document,
      headers: staticHeaders(harness),
    });
    expect(staticResponse.statusCode).toBe(200);
    expect(staticResponse.complete).toBe(true);
    expect(staticResponse.body).toEqual(DOCUMENT_BYTES);
    expect(staticResponse.headers["content-type"]).toBe(
      "text/html; charset=utf-8",
    );
    expect(staticResponse.headers["content-length"]).toBe(
      String(DOCUMENT_BYTES.byteLength),
    );
    expectSecurityHeaders(staticResponse);
    expectFinishedResponse(harness, 0, 200);

    const bootstrapBody = Buffer.from(
      JSON.stringify({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.bootstrap,
        bootstrapToken: bootstrapToken(harness.router),
      }),
      "utf8",
    );
    const bootstrapResponse = await requestBoundary(harness, {
      method: "POST",
      path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.bootstrap,
      headers: apiHeaders(harness, bootstrapBody),
      body: bootstrapBody,
    });
    expect(bootstrapResponse.statusCode).toBe(200);
    expect(bootstrapResponse.complete).toBe(true);
    expectSecurityHeaders(bootstrapResponse);
    const bootstrapJson = parseJsonObject(bootstrapResponse);
    expect(bootstrapJson.schemaVersion).toBe(
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.bootstrap,
    );
    expect(bootstrapJson.bearerToken).toMatch(BEARER_PATTERN);
    expectFinishedResponse(harness, 1, 200);
    if (typeof bootstrapJson.bearerToken !== "string") {
      throw new Error("The bootstrap response did not contain a bearer token.");
    }

    const stateBody = Buffer.from(
      JSON.stringify({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.state,
      }),
      "utf8",
    );
    const stateResponse = await requestBoundary(harness, {
      method: "POST",
      path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
      headers: apiHeaders(
        harness,
        stateBody,
        `Bearer ${bootstrapJson.bearerToken}`,
      ),
      body: stateBody,
    });
    expect(stateResponse.statusCode).toBe(200);
    expect(stateResponse.complete).toBe(true);
    expect(parseJsonObject(stateResponse)).toEqual(SNAPSHOT);
    expect(stateResponse.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(stateResponse.headers["content-length"]).toBe(
      String(stateResponse.body.byteLength),
    );
    expectSecurityHeaders(stateResponse);
    expect(harness.snapshotOperator).toHaveBeenCalledTimes(1);
    expectFinishedResponse(harness, 2, 200);
  });

  it("rejects adversarial headers after real Node parsing and finishes fixed sanitized errors", async () => {
    const harness = await startBoundaryHarness();
    const bearer = exchangeBearerDirectly(harness);
    const body = Buffer.from(
      JSON.stringify({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_REQUEST_SCHEMA_VERSIONS_V2.state,
      }),
      "utf8",
    );
    const authorization = `Bearer ${bearer}`;
    const validHeaders = apiHeaders(harness, body, authorization);
    const cases = [
      {
        label: "wrong Host",
        headers: replaceHeader(validHeaders, "Host", "127.0.0.1:1"),
        statusCode: 421,
        error: "MISDIRECTED_REQUEST",
      },
      {
        label: "wrong Origin",
        headers: replaceHeader(validHeaders, "Origin", `${harness.origin}/x`),
        statusCode: 403,
        error: "ORIGIN_FORBIDDEN",
      },
      {
        label: "missing Fetch Metadata",
        headers: removeHeader(validHeaders, "Sec-Fetch-Dest"),
        statusCode: 403,
        error: "ORIGIN_FORBIDDEN",
      },
      {
        label: "duplicate Authorization",
        headers: [...validHeaders, "Authorization", authorization],
        statusCode: 401,
        error: "AUTHENTICATION_REQUIRED",
      },
      {
        label: "chunked Transfer-Encoding",
        headers: [
          ...removeHeader(validHeaders, "Content-Length"),
          "Transfer-Encoding",
          "chunked",
        ],
        statusCode: 400,
        error: "MALFORMED_REQUEST",
      },
      {
        label: "Content-Encoding",
        headers: [...validHeaders, "Content-Encoding", "gzip"],
        statusCode: 400,
        error: "MALFORMED_REQUEST",
      },
      {
        label: "chunked Trailer declaration",
        headers: [
          ...removeHeader(validHeaders, "Content-Length"),
          "Transfer-Encoding",
          "chunked",
          "Trailer",
          "X-Review-Proof",
        ],
        statusCode: 400,
        error: "MALFORMED_REQUEST",
      },
    ] as const;

    for (const boundaryCase of cases) {
      const observationIndex = harness.observations.length;
      const response = await requestBoundary(harness, {
        method: "POST",
        path: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_ROUTES_V2.state,
        headers: boundaryCase.headers,
        body,
      });
      expect(response.statusCode, boundaryCase.label).toBe(
        boundaryCase.statusCode,
      );
      expect(response.complete, boundaryCase.label).toBe(true);
      expect(parseJsonObject(response), boundaryCase.label).toEqual({
        schemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_SCHEMA_VERSIONS_V2.error,
        error: boundaryCase.error,
      });
      expectSecurityHeaders(response);
      expectFinishedResponse(
        harness,
        observationIndex,
        boundaryCase.statusCode,
      );
    }
    expect(harness.snapshotOperator).not.toHaveBeenCalled();
  });
});
