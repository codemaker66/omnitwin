import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalNativeIntakeControllerV0,
  type LocalNativeIntakeAdapterV0,
} from "../local-native-intake.js";
import {
  LOCAL_NATIVE_INTAKE_MAX_REQUEST_BODY_BYTES,
  startLocalNativeIntakeApp,
  type LocalNativeIntakeActionEvent,
  type LocalNativeCollectionAnalysisAppController,
  type LocalNativeIntakeAppController,
  type LocalNativeIntakeAppHandle,
} from "../local-native-intake-app.js";
import type {
  NativeAdapterRequestV0,
  NativeOutputBoundaryResponseV0,
  NativePathComparisonRequestV0,
  NativePathComparisonResponseV0,
  NativeSourcePickerResponseV0,
} from "../trusted-windows-native-source-basket.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const EVENT_SCHEMA = "trusted-windows-native-source-basket-event.v1";
const openApps: LocalNativeIntakeAppHandle[] = [];

function makeView(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: "omnitwin.foundry.local-native-intake-view.v0",
    mode: "ordinary_windows_native_selection_node_path_reopen_preview",
    filesystemModel: "node_path_reopen_after_native_selection",
    nativeCustodyClaimed: false,
    authority: "none",
    phase: "selecting",
    busy: false,
    message: "Choose local capture sources.",
    sources: [],
    totals: {
      selectedRoots: 0,
      discoveredFiles: 0,
      totalBytesDecimal: "0",
      storedRoots: 0,
      failedRoots: 0,
      cancelledRoots: 0,
    },
    nextEvent: {
      schemaVersion: EVENT_SCHEMA,
      sessionRef: "basket_0123456789abcdef0123456789abcdef",
      revision: 0,
      eventToken: "evt_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    canCancelImport: false,
    reportAvailable: false,
    durableOutcome: "not_started",
    ...overrides,
  };
}

function makeActionResult(
  event: LocalNativeIntakeActionEvent,
  view: unknown,
  started = event.action === "start",
): Record<string, unknown> {
  return {
    schemaVersion: "omnitwin.foundry.local-native-intake-action-result.v0",
    status: started ? "started" : "updated",
    code: started ? "IMPORT_STAGED" : "ITEMS_ADDED",
    message: started
      ? "Local inspection and copying have started."
      : "The selected items were added.",
    view,
  };
}

class RecordingController implements LocalNativeIntakeAppController {
  view: unknown = makeView();
  readonly events: LocalNativeIntakeActionEvent[] = [];
  cancelCalls = 0;
  reportCalls = 0;
  closeCalls = 0;
  closeHook: (() => Promise<void>) | undefined;
  report: unknown = {
    schemaVersion: "omnitwin.foundry.local-native-intake-report.v0",
    authority: "none",
    outcome: "complete",
    items: [],
  };
  dispatchHook: ((event: LocalNativeIntakeActionEvent) => Promise<unknown>) | undefined;

  getView(): unknown {
    return this.view;
  }

  async dispatch(event: LocalNativeIntakeActionEvent): Promise<unknown> {
    this.events.push(event);
    if (this.dispatchHook !== undefined) return this.dispatchHook(event);
    return makeActionResult(event, this.view);
  }

  cancelActive(): Promise<unknown> {
    this.cancelCalls += 1;
    return Promise.resolve(this.view);
  }

  getReport(): unknown {
    this.reportCalls += 1;
    return this.report;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return this.closeHook?.() ?? Promise.resolve();
  }
}

function makeAnalysisView(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "omnitwin.foundry.local-native-collection-analysis-view.v0",
    authority: "none",
    phase: "ready",
    busy: false,
    message: "The verified local collection is ready for bounded inspection.",
    planState: "needs_operator_review",
    cancellationBoundary: "between_bounded_verification_steps",
    collectionIndexSha256: "1".repeat(64),
    items: [],
    totals: {
      totalItems: 0,
      completedItems: 0,
      failedItems: 0,
      cancelledItems: 0,
      detectedFamilies: 0,
    },
    canStart: true,
    canCancel: false,
    reportAvailable: false,
    failureCode: null,
    ...overrides,
  };
}

class RecordingAnalysisController implements LocalNativeCollectionAnalysisAppController {
  view: unknown = makeAnalysisView();
  startCalls = 0;
  cancelCalls = 0;
  reportCalls = 0;
  closeCalls = 0;
  report: unknown = {
    schemaVersion: "omnitwin.foundry.local-native-collection-analysis-report.v0",
    authority: "none",
    outcome: "complete",
    planState: "needs_operator_review",
    cancellationBoundary: "between_bounded_verification_steps",
    collectionIndexSha256: "1".repeat(64),
    items: [],
    totals: {
      totalItems: 0,
      completedItems: 0,
      failedItems: 0,
      cancelledItems: 0,
      detectedFamilies: 0,
    },
    failureCode: null,
    reportSha256: "2".repeat(64),
  };

  getView(): unknown {
    return this.view;
  }

  start(): unknown {
    this.startCalls += 1;
    this.view = makeAnalysisView({
      phase: "running",
      busy: true,
      canStart: false,
      canCancel: true,
    });
    return this.view;
  }

  cancel(): Promise<unknown> {
    this.cancelCalls += 1;
    this.view = makeAnalysisView({
      phase: "cancelled",
      canStart: false,
      reportAvailable: true,
    });
    return Promise.resolve(this.view);
  }

  getReport(): unknown {
    this.reportCalls += 1;
    return this.report;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class CancellingNativeAdapter implements LocalNativeIntakeAdapterV0 {
  closeCalls = 0;

  pickFiles(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "add_files",
      status: "cancelled",
    });
  }

  pickFolder(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "add_folder",
      status: "cancelled",
    });
  }

  dropSources(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "add_dropped",
      status: "cancelled",
    });
  }

  resolveOutputBoundary(
    request: NativeAdapterRequestV0,
  ): Promise<NativeOutputBoundaryResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "start",
      status: "cancelled",
    });
  }

  compareCanonicalPaths(
    request: NativePathComparisonRequestV0,
  ): Promise<NativePathComparisonResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-path-comparison.v0",
      requestRef: request.requestRef,
      status: "unavailable",
      code: "NOT_NEEDED_FOR_CANCELLED_PICKER",
    });
  }

  closeAndConfirmNoLiveScopes(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class FirstCloseFailsNativeAdapter extends CancellingNativeAdapter {
  override closeAndConfirmNoLiveScopes(): Promise<void> {
    this.closeCalls += 1;
    return this.closeCalls === 1
      ? Promise.reject(new Error("C:\\Private\\fixture helper still live"))
      : Promise.resolve();
  }
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop().catch(() => undefined);
  }));
});

async function start(
  controller = new RecordingController(),
  analysisController = new RecordingAnalysisController(),
): Promise<{
  readonly app: LocalNativeIntakeAppHandle;
  readonly controller: RecordingController;
  readonly analysisController: RecordingAnalysisController;
}> {
  const app = await startLocalNativeIntakeApp({ controller, analysisController });
  openApps.push(app);
  return { app, controller, analysisController };
}

function tokenQuery(app: LocalNativeIntakeAppHandle): string {
  return new URL(app.url).search;
}

async function sendRequest(
  app: LocalNativeIntakeAppHandle,
  options: {
    readonly route: string;
    readonly method?: string;
    readonly body?: string;
    readonly query?: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
): Promise<HttpResult> {
  const method = options.method ?? "GET";
  const body = options.body;
  const headers: Record<string, string> = {
    ...(method === "POST" ? { Origin: app.origin } : {}),
    ...(body === undefined ? {} : {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    }),
    ...options.headers,
  };
  return new Promise<HttpResult>((resolveResult, rejectResult) => {
    const request = httpRequest({
      host: app.host,
      port: app.port,
      path: `${options.route}${options.query ?? tokenQuery(app)}`,
      method,
      headers,
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", rejectResult);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function validEvent(
  action: LocalNativeIntakeActionEvent["action"],
): Record<string, unknown> {
  return {
    schemaVersion: EVENT_SCHEMA,
    sessionRef: "basket_0123456789abcdef0123456789abcdef",
    revision: 0,
    eventToken: "evt_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    action,
    ...(action === "start"
      ? { confirmation: "inspect_and_keep_verified_copies" }
      : {}),
  };
}

describe("local native intake app HTTP surface", () => {
  it("forwards the exact public binding to the real local intake controller", async () => {
    const adapter = new CancellingNativeAdapter();
    const controller = createLocalNativeIntakeControllerV0({ adapter });
    const app = await startLocalNativeIntakeApp({ controller });
    openApps.push(app);
    const beforeResult = await sendRequest(app, { route: "/api/native-source-basket" });
    expect(beforeResult.status).toBe(200);
    const before = JSON.parse(beforeResult.body) as {
      readonly phase: string;
      readonly nextEvent: Readonly<Record<string, unknown>> | null;
    };
    expect(before.phase).toBe("selecting");
    expect(before.nextEvent).not.toBeNull();
    const action = { ...before.nextEvent, action: "add_folder" };
    const actionResult = await sendRequest(app, {
      route: "/api/native-source-basket/action",
      method: "POST",
      body: JSON.stringify(action),
    });
    expect(actionResult.status).toBe(200);
    expect(JSON.parse(actionResult.body)).toMatchObject({
      schemaVersion: "omnitwin.foundry.local-native-intake-action-result.v0",
      status: "picker_cancelled",
      code: "PICKER_CANCELLED",
      view: {
        schemaVersion: "omnitwin.foundry.local-native-intake-view.v0",
        phase: "selecting",
        busy: false,
      },
    });
    expect(actionResult.body).not.toMatch(/[A-Za-z]:[\\/]/u);
    await app.stop();
    expect(adapter.closeCalls).toBe(1);
  });

  it("serves only token-bound loopback assets with restrictive response headers", async () => {
    const { app } = await start();
    const root = await sendRequest(app, { route: "/" });
    expect(root.status).toBe(200);
    expect(root.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(root.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(root.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(root.body).toContain("Build a local capture workspace");
    expect(root.body).not.toContain("__SESSION_TOKEN__");

    const css = await sendRequest(app, { route: "/app.css" });
    const javascript = await sendRequest(app, { route: "/app.js" });
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(javascript.status).toBe(200);
    expect(javascript.headers["content-type"]).toBe("text/javascript; charset=utf-8");

    expect((await sendRequest(app, { route: "/", query: "" })).status).toBe(401);
    expect((await sendRequest(app, { route: "/", query: "?token=wrong" })).status).toBe(401);
    expect((await sendRequest(app, {
      route: "/",
      query: `${tokenQuery(app)}&extra=true`,
    })).status).toBe(401);
    expect((await sendRequest(app, { route: "/missing" })).status).toBe(404);
  });

  it("forwards exact basket actions and rejects every browser-supplied path or option", async () => {
    const { app, controller } = await start();
    const add = validEvent("add_files");
    const accepted = await sendRequest(app, {
      route: "/api/native-source-basket/action",
      method: "POST",
      body: JSON.stringify(add),
    });
    expect(accepted.status).toBe(200);
    expect(controller.events).toEqual([add]);

    const dropped = validEvent("add_dropped");
    const dropAccepted = await sendRequest(app, {
      route: "/api/native-source-basket/action",
      method: "POST",
      body: JSON.stringify(dropped),
    });
    expect(dropAccepted.status).toBe(200);
    expect(controller.events).toEqual([add, dropped]);

    for (const forbidden of [
      { sourcePath: "C:\\private\\capture.e57" },
      { workspacePath: "C:\\private\\workspace" },
      { filename: "capture.e57" },
      { helperConfig: { executable: "C:\\helper.exe" } },
      { filters: ["e57"] },
      { options: { recursive: true } },
    ]) {
      const result = await sendRequest(app, {
        route: "/api/native-source-basket/action",
        method: "POST",
        body: JSON.stringify({ ...add, ...forbidden }),
      });
      expect(result.status).toBe(400);
      expect(result.body).not.toContain("C:\\private");
    }
    for (const unsupported of [
      { ...add, action: "clear" },
      { ...add, action: "remove", basketPosition: 1 },
    ]) {
      const result = await sendRequest(app, {
        route: "/api/native-source-basket/action",
        method: "POST",
        body: JSON.stringify(unsupported),
      });
      expect(result.status).toBe(400);
      expect(result.body).toContain("not valid");
    }
    expect(controller.events).toHaveLength(2);
  });

  it("accepts a start only after the output choice is staged and returns 202", async () => {
    const { app, controller } = await start();
    let release: ((value: unknown) => void) | undefined;
    controller.dispatchHook = async () => new Promise<unknown>((resolveValue) => {
      release = resolveValue;
    });
    const pending = sendRequest(app, {
      route: "/api/native-source-basket/action",
      method: "POST",
      body: JSON.stringify(validEvent("start")),
    });
    const settledBeforeStaging = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolveValue) => setTimeout(() => {
        resolveValue(false);
      }, 20)),
    ]);
    expect(settledBeforeStaging).toBe(false);
    expect(controller.events).toEqual([validEvent("start")]);
    const dispatched = controller.events[0];
    if (dispatched === undefined) throw new Error("The start event was not recorded.");
    release?.(makeActionResult(
      dispatched,
      makeView({
        phase: "importing",
        busy: true,
        canCancelImport: true,
        durableOutcome: "in_progress",
      }),
    ));
    const result = await pending;
    expect(result.status).toBe(202);
    expect(JSON.parse(result.body)).toMatchObject({
      accepted: true,
      view: { phase: "importing", canCancelImport: true },
    });
  });

  it("does not claim acceptance when the output picker returns without staging", async () => {
    const { app, controller } = await start();
    controller.dispatchHook = () => Promise.resolve({
      schemaVersion: "omnitwin.foundry.local-native-intake-action-result.v0",
      status: "start_rejected",
      code: "START_REJECTED",
      message: "No workspace was chosen.",
      view: makeView({ phase: "selecting", busy: false }),
    });
    const result = await sendRequest(app, {
      route: "/api/native-source-basket/action",
      method: "POST",
      body: JSON.stringify(validEvent("start")),
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      accepted: false,
      view: { phase: "selecting", busy: false },
    });
  });

  it("forwards cancellation and report requests only from exact empty JSON bodies", async () => {
    const { app, controller } = await start();
    const cancelled = await sendRequest(app, {
      route: "/api/native-source-basket/cancel-active",
      method: "POST",
      body: "{}",
    });
    const report = await sendRequest(app, {
      route: "/api/native-source-basket/report",
      method: "POST",
      body: "{}",
    });
    expect(cancelled.status).toBe(200);
    expect(report.status).toBe(200);
    expect(controller.cancelCalls).toBe(1);
    expect(controller.reportCalls).toBe(1);
    expect(JSON.parse(report.body)).toMatchObject({ authority: "none", outcome: "complete" });

    expect((await sendRequest(app, {
      route: "/api/native-source-basket/report",
      method: "POST",
      body: JSON.stringify({ filename: "report.json" }),
    })).status).toBe(400);
    expect(controller.reportCalls).toBe(1);
  });

  it("exposes explicit path-free collection analysis start, status, cancel, and report routes", async () => {
    const { app, analysisController } = await start();
    analysisController.view = makeAnalysisView({
      items: [{
        basketPosition: 1,
        kind: "file",
        label: "File 1",
        labelSafety: "generated_kind_and_position_only",
        state: "complete",
        selectedFileCount: 1,
        selectedBytesDecimal: "9",
        truth: {
          pendingReview: 1,
          admitted: 0,
          excluded: 0,
          captured: 0,
          enhancedCaptured: 0,
          generatedCinematic: 0,
          conceptImagination: 0,
        },
        families: [{
          inputType: "xgrids_xbin",
          fileCount: 1,
          support: "opaque_reference_only",
        }],
        facts: { state: "unavailable", sha256: "3".repeat(64) },
        readiness: { state: "blocked", sha256: "4".repeat(64) },
        checklist: { state: "blocked", sha256: "5".repeat(64) },
        blockers: {
          state: "present",
          codes: ["OPERATOR_EVIDENCE_REVIEW_REQUIRED", "XBIN_OFFICIAL_EXPORT_ONLY"],
          count: 2,
        },
        nextAction: { state: "required", code: "OBTAIN_OFFICIAL_EXPORT" },
        planState: "needs_operator_review",
        failureCode: null,
      }],
    });
    const status = await sendRequest(app, {
      route: "/api/native-collection-analysis/status",
      method: "POST",
      body: "{}",
    });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body)).toMatchObject({
      phase: "ready",
      planState: "needs_operator_review",
      canStart: true,
      items: [{
        blockers: { count: 2 },
        nextAction: { code: "OBTAIN_OFFICIAL_EXPORT" },
      }],
    });

    const started = await sendRequest(app, {
      route: "/api/native-collection-analysis/start",
      method: "POST",
      body: "{}",
    });
    expect(started.status).toBe(202);
    expect(JSON.parse(started.body)).toMatchObject({ phase: "running", canCancel: true });
    expect(analysisController.startCalls).toBe(1);

    const cancelled = await sendRequest(app, {
      route: "/api/native-collection-analysis/cancel",
      method: "POST",
      body: "{}",
    });
    const report = await sendRequest(app, {
      route: "/api/native-collection-analysis/report",
      method: "POST",
      body: "{}",
    });
    expect(cancelled.status).toBe(200);
    expect(report.status).toBe(200);
    expect(analysisController.cancelCalls).toBe(1);
    expect(analysisController.reportCalls).toBe(1);
    expect(JSON.parse(report.body)).toMatchObject({
      outcome: "complete",
      planState: "needs_operator_review",
    });
    expect(report.body).not.toMatch(/[A-Za-z]:[\\/]/u);

    expect((await sendRequest(app, {
      route: "/api/native-collection-analysis/report",
      method: "POST",
      body: JSON.stringify({ option: true }),
    })).status).toBe(400);
    expect((await sendRequest(app, {
      route: "/api/native-collection-analysis/status",
      method: "POST",
      body: "{}",
      headers: { Origin: "https://outside.example" },
    })).status).toBe(403);
    analysisController.view = makeAnalysisView({
      items: [{ activeSourcePath: "C:\\Private\\copied.e57" }],
    });
    const unsafe = await sendRequest(app, {
      route: "/api/native-collection-analysis/status",
      method: "POST",
      body: "{}",
    });
    expect(unsafe.status).toBe(500);
    expect(unsafe.body).not.toContain("Private");
    expect(unsafe.body).not.toContain("copied.e57");
  });

  it("enforces method, origin, content type, host, and request-size boundaries", async () => {
    const { app, controller } = await start();
    const body = JSON.stringify(validEvent("add_folder"));
    const route = "/api/native-source-basket/action";
    const wrongMethod = await sendRequest(app, { route, method: "GET" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe("POST");
    expect((await sendRequest(app, {
      route,
      method: "POST",
      body,
      headers: { Origin: "https://outside.example" },
    })).status).toBe(403);
    expect((await sendRequest(app, {
      route,
      method: "POST",
      body,
      headers: { Origin: "" },
    })).status).toBe(403);
    expect((await sendRequest(app, {
      route,
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain" },
    })).status).toBe(415);
    expect((await sendRequest(app, {
      route,
      method: "POST",
      body,
      headers: { Host: "localhost:9999" },
    })).status).toBe(421);
    const oversized = JSON.stringify({ value: "x".repeat(LOCAL_NATIVE_INTAKE_MAX_REQUEST_BODY_BYTES) });
    expect((await sendRequest(app, {
      route,
      method: "POST",
      body: oversized,
    })).status).toBe(413);
    expect(controller.events).toHaveLength(0);
  });

  it("fails closed without serializing path-bearing controller values", async () => {
    const controller = new RecordingController();
    controller.view = makeView({
      message: "Private source is C:\\Users\\operator\\capture.e57",
      sourcePath: "C:\\Users\\operator\\capture.e57",
    });
    const { app } = await start(controller);
    const result = await sendRequest(app, { route: "/api/native-source-basket" });
    expect(result.status).toBe(500);
    expect(result.body).toContain("No original source was changed");
    expect(result.body).not.toContain("operator");
    expect(result.body).not.toContain("capture.e57");
    expect(result.body).not.toContain("sourcePath");
  });

  it.each([
    ["basename", "customer-secret.e57"],
    ["multi-dot basename", "customer-secret.capture.e57"],
    ["Unicode basename", "客户.e57"],
    ["relative path", "relative\\client\\secret.e57"],
    ["embedded absolute path", "source=C:\\Private\\secret.e57"],
  ] as const)("fails closed without serializing a private %s string", async (_kind, privateValue) => {
    const controller = new RecordingController();
    controller.view = makeView({ message: privateValue });
    const { app } = await start(controller);

    const result = await sendRequest(app, { route: "/api/native-source-basket" });

    expect(result.status).toBe(500);
    expect(result.body).toContain("No original source was changed");
    expect(result.body).not.toContain("customer-secret");
    expect(result.body).not.toContain("relative");
    expect(result.body).not.toContain("Private");
    expect(result.body).not.toContain("secret.e57");
  });

  it("stops the controller and server exactly once through the browser route", async () => {
    const { app, controller, analysisController } = await start();
    const result = await sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ stopping: true });
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(app.getPhase()).toBe("stopped");
    expect(controller.closeCalls).toBe(1);
    expect(analysisController.closeCalls).toBe(1);
    await app.stop();
    expect(controller.closeCalls).toBe(1);
    expect(analysisController.closeCalls).toBe(1);
  });

  it("shares one close attempt across concurrent browser and programmatic stops", async () => {
    const { app, controller } = await start();
    let releaseClose: (() => void) | undefined;
    controller.closeHook = () => new Promise<void>((resolveClose) => {
      releaseClose = resolveClose;
    });
    const firstBrowserStop = sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    const secondBrowserStop = sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    for (let attempt = 0; attempt < 50 && controller.closeCalls === 0; attempt += 1) {
      await new Promise<void>((resolveTurn) => {
        setImmediate(resolveTurn);
      });
    }
    expect(controller.closeCalls).toBe(1);
    const programmaticStop = app.stop();
    expect(controller.closeCalls).toBe(1);
    expect(app.getPhase()).toBe("stopping");
    const settledBeforeHelperClose = await Promise.race([
      Promise.all([firstBrowserStop, secondBrowserStop]).then(() => true),
      new Promise<boolean>((resolveValue) => setTimeout(() => {
        resolveValue(false);
      }, 20)),
    ]);
    expect(settledBeforeHelperClose).toBe(false);
    releaseClose?.();
    const [first, second] = await Promise.all([firstBrowserStop, secondBrowserStop]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await programmaticStop;
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(controller.closeCalls).toBe(1);
  });

  it("reports a failed helper close truthfully and permits a later stop retry", async () => {
    const { app, controller } = await start();
    controller.closeHook = () => controller.closeCalls === 1
      ? Promise.reject(new Error("fixture helper still live"))
      : Promise.resolve();
    const failed = await sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    expect(failed.status).toBe(503);
    expect(JSON.parse(failed.body)).toEqual({
      stopping: false,
      error: "The local helper did not confirm shutdown. Retry shutdown to confirm that the helper has stopped.",
    });
    expect(app.getPhase()).toBe("running");
    expect(controller.closeCalls).toBe(1);
    expect((await sendRequest(app, { route: "/api/native-source-basket" })).status).toBe(200);

    const retried = await sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    expect(retried.status).toBe(200);
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(controller.closeCalls).toBe(2);
  });

  it("retries a failed real-controller helper close through a second app stop", async () => {
    const adapter = new FirstCloseFailsNativeAdapter();
    const controller = createLocalNativeIntakeControllerV0({ adapter });
    const app = await startLocalNativeIntakeApp({ controller });
    openApps.push(app);

    const failed = await sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    expect(failed.status).toBe(503);
    expect(JSON.parse(failed.body)).toEqual({
      stopping: false,
      error: "The local helper did not confirm shutdown. Retry shutdown to confirm that the helper has stopped.",
    });
    expect(failed.body).not.toContain("Private");
    expect(failed.body).not.toContain("fixture helper");
    expect(app.getPhase()).toBe("running");
    expect(adapter.closeCalls).toBe(1);

    const retried = await sendRequest(app, {
      route: "/api/stop",
      method: "POST",
      body: "{}",
    });
    expect(retried.status).toBe(200);
    expect(JSON.parse(retried.body)).toEqual({ stopping: true });
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(app.getPhase()).toBe("stopped");
    expect(adapter.closeCalls).toBe(2);

    await expect(controller.close()).resolves.toBeUndefined();
    expect(adapter.closeCalls).toBe(2);
  });
});

describe("local native intake app startup", () => {
  it("rejects non-loopback hosts, unsafe ports, and unsafe session lengths", async () => {
    const controller = new RecordingController();
    await expect(startLocalNativeIntakeApp({
      controller,
      host: "0.0.0.0",
    })).rejects.toThrow("127.0.0.1");
    await expect(startLocalNativeIntakeApp({
      controller,
      port: 80,
    })).rejects.toThrow("between 1024 and 65535");
    await expect(startLocalNativeIntakeApp({
      controller,
      sessionTtlMs: 49,
    })).rejects.toThrow("outside the supported range");
  });

  it("expires a bounded session and closes its controller", async () => {
    const controller = new RecordingController();
    const app = await startLocalNativeIntakeApp({ controller, sessionTtlMs: 50 });
    openApps.push(app);
    await expect(app.closed).resolves.toEqual({ reason: "session_expired" });
    expect(app.getPhase()).toBe("stopped");
    expect(controller.closeCalls).toBe(1);
  });

  it("keeps an expired session closed to actions and retries a transient close failure", async () => {
    const controller = new RecordingController();
    controller.closeHook = () => controller.closeCalls === 1
      ? Promise.reject(new Error("fixture helper still live"))
      : Promise.resolve();
    const app = await startLocalNativeIntakeApp({ controller, sessionTtlMs: 50 });
    openApps.push(app);

    for (let attempt = 0; attempt < 100 && controller.closeCalls === 0; attempt += 1) {
      await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 2));
    }
    await Promise.resolve();

    expect(controller.closeCalls).toBeGreaterThanOrEqual(1);
    expect(app.getPhase()).toBe("stopping");
    expect((await sendRequest(app, { route: "/api/native-source-basket" })).status).toBe(409);
    await expect(Promise.race([
      app.closed,
      new Promise<never>((_resolve, reject) => setTimeout(() => {
        reject(new Error("expired shutdown retry timed out"));
      }, 1_000)),
    ])).resolves.toEqual({ reason: "session_expired" });
    expect(app.getPhase()).toBe("stopped");
    expect(controller.closeCalls).toBe(2);
  });
});
