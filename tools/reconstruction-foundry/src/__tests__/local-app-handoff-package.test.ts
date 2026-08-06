import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0,
  verifyFoundryLocalInspectionHandoffPackageV0,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const roots: string[] = [];
const apps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-handoff-http-"));
  roots.push(root);
  await writeFile(
    join(root, "room.obj"),
    "# deterministic room fixture\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    "utf8",
  );
  return root;
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no token");
  return token;
}

function request(
  app: LocalFoundryAppHandle,
  input: {
    readonly method?: string;
    readonly path: string;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const outgoing = httpRequest({
      hostname: app.host,
      port: app.port,
      method: input.method ?? "GET",
      path: input.path,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    outgoing.on("error", rejectResult);
    if (input.body !== undefined) outgoing.write(input.body);
    outgoing.end();
  });
}

function get(
  app: LocalFoundryAppHandle,
  path: string,
  digest?: string,
): Promise<HttpResult> {
  return request(app, {
    path: `${path}?token=${encodeURIComponent(tokenFor(app))}${
      digest === undefined ? "" : `&digest=${encodeURIComponent(digest)}`
    }`,
  });
}

function post(
  app: LocalFoundryAppHandle,
  path: string,
  value: unknown,
): Promise<HttpResult> {
  const body = JSON.stringify(value);
  return request(app, {
    method: "POST",
    path: `${path}?token=${encodeURIComponent(tokenFor(app))}`,
    body,
    headers: {
      Origin: app.origin,
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    },
  });
}

async function waitForReady(
  app: LocalFoundryAppHandle,
  differentFromRevisionSha256?: string,
): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await get(app, "/api/state");
    expect(response.status).toBe(200);
    const state = JSON.parse(response.body) as LocalFoundryPublicState;
    if (
      state.phase === "ready" &&
      state.receipt !== undefined &&
      state.guidedWorkflow.completeHandoff === "ready" &&
      state.guidedWorkflow.completeHandoffRevisionSha256 !== null &&
      state.guidedWorkflow.completeHandoffRevisionSha256 !==
        differentFromRevisionSha256
    ) {
      return state;
    }
    if (state.phase === "failed") throw new Error("fixture inspection failed");
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
  throw new Error("local app did not finish inspecting the fixture");
}

function handoff(
  app: LocalFoundryAppHandle,
  revisionSha256: string,
): Promise<HttpResult> {
  return get(
    app,
    "/api/local-inspection-handoff-package",
    revisionSha256,
  );
}

function readyHandoff(state: LocalFoundryPublicState): {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly revisionSha256: string;
} {
  if (
    state.receipt === undefined ||
    state.guidedWorkflow.completeHandoff !== "ready" ||
    state.guidedWorkflow.completeHandoffRevisionSha256 === null
  ) {
    throw new Error("expected a ready complete handoff");
  }
  return {
    receipt: state.receipt,
    revisionSha256: state.guidedWorkflow.completeHandoffRevisionSha256,
  };
}

describe("Foundry local app complete handoff download", () => {
  it("downloads one deterministic, self-contained, revision-bound file without changing the source", async () => {
    const source = await makeFixture();
    const beforeNames = (await readdir(source, { recursive: true })).sort();
    const beforeBytes = await readFile(join(source, "room.obj"));
    const app = await startLocalFoundryApp({ source });
    apps.push(app);
    const readyState = await waitForReady(app);
    expect(readyState.guidedWorkflow.completeHandoffMaximumSerializedBytes).toBe(
      FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0,
    );
    const initial = readyHandoff(readyState);
    const { receipt, revisionSha256 } = initial;

    const first = await handoff(app, revisionSha256);
    const second = await handoff(app, revisionSha256);
    expect(first.status, first.body).toBe(200);
    expect(first.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-local-inspection-handoff-package-v0.json\"",
    );
    expect(second.body).toBe(first.body);

    const packaged = verifyFoundryLocalInspectionHandoffPackageV0(
      JSON.parse(first.body),
    );
    expect(packaged.evidence.receipt.receiptSha256).toBe(receipt.receiptSha256);
    expect(packaged.evidence.admission).toBeNull();
    expect(packaged.evidence.planPreview).toBeNull();
    expect(packaged.evidence.capturedQualityComparison).toBeNull();
    expect(packaged.authority).toBe("none");
    expect(packaged.execution).toBe("not_authorized");
    expect(first.body).not.toContain(source);
    expect(first.body).not.toContain(tokenFor(app));
    expect(first.body).not.toMatch(/[A-Z]:\\/u);

    expect((await handoff(app, "0".repeat(64))).status).toBe(409);
    const extraQuery = await request(app, {
      path: `/api/local-inspection-handoff-package?token=${encodeURIComponent(
        tokenFor(app),
      )}&digest=${revisionSha256}&extra=1`,
    });
    expect(extraQuery.status).toBe(401);
    expect((await readdir(source, { recursive: true })).sort()).toEqual(
      beforeNames,
    );
    expect(await readFile(join(source, "room.obj"))).toEqual(beforeBytes);
  });

  it("adds the current reviewed choices and plan while retaining authority none", async () => {
    const source = await makeFixture();
    const app = await startLocalFoundryApp({ source });
    apps.push(app);
    const initial = readyHandoff(await waitForReady(app));
    const { receipt } = initial;
    const file = receipt.files[0];
    if (file === undefined) throw new Error("expected the OBJ fixture");

    const admissionResponse = await post(app, "/api/admission-draft", {
      receiptSha256: receipt.receiptSha256,
      projectId: "local-handoff-http-test",
      reviewedBy: "test-operator",
      sourceMedia: "local",
      caseSensitivity: "insensitive",
      decisions: [{
        action: "admit",
        path: file.path,
        inputType: "obj",
        role: "official_export",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      }],
    });
    expect(admissionResponse.status, admissionResponse.body).toBe(201);
    expect((await handoff(app, initial.revisionSha256)).status).toBe(409);
    const admission = JSON.parse(admissionResponse.body) as {
      readonly resultSha256: string;
    };
    const afterAdmission = readyHandoff(
      await waitForReady(app, initial.revisionSha256),
    );

    const planResponse = await post(app, "/api/plan-preview", {
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
      admissionResultSha256: admission.resultSha256,
    });
    expect(planResponse.status, planResponse.body).toBe(201);
    expect((await handoff(app, afterAdmission.revisionSha256)).status).toBe(409);

    const afterPlan = readyHandoff(
      await waitForReady(app, afterAdmission.revisionSha256),
    );
    const response = await handoff(app, afterPlan.revisionSha256);
    expect(response.status, response.body).toBe(200);
    const packaged = verifyFoundryLocalInspectionHandoffPackageV0(
      JSON.parse(response.body),
    );
    expect(packaged.evidence.admission?.result.resultSha256).toBe(
      admission.resultSha256,
    );
    expect(packaged.evidence.planPreview?.admissionResultSha256).toBe(
      admission.resultSha256,
    );
    expect(packaged.handoff.artifacts.map((artifact) => artifact.role)).toEqual(
      expect.arrayContaining([
        "intake_receipt",
        "source_facts",
        "source_readiness",
        "operator_evidence_checklist",
        "admission_review",
        "admission_result",
        "plan_preview",
      ]),
    );
    expect(packaged.authority).toBe("none");
    expect(packaged.execution).toBe("not_authorized");
    expect(packaged.onlineApproval).toBe("required");
  });

  it("refuses to save a package when a source file changed after inspection", async () => {
    const source = await makeFixture();
    const app = await startLocalFoundryApp({ source });
    apps.push(app);
    const initial = readyHandoff(await waitForReady(app));

    await writeFile(
      join(source, "room.obj"),
      "# changed after inspection\nv 0 0 0\n",
      "utf8",
    );

    const response = await handoff(app, initial.revisionSha256);
    expect(response.status).toBe(409);
    expect(response.body).toContain("source changed after inspection");

    const stateResponse = await get(app, "/api/state");
    expect(stateResponse.status).toBe(200);
    const state = JSON.parse(stateResponse.body) as LocalFoundryPublicState;
    expect(state.guidedWorkflow.completeHandoff).toBe("unavailable");
  });
});
