import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  FoundryPlanPreviewV0Schema,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import {
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_FOUNDRY_MAX_DRAFT_BODY_BYTES,
  LOCAL_FOUNDRY_MAX_GUIDED_FILES,
  LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface AdmissionPostBody {
  readonly receiptSha256: string;
  readonly projectId: string;
  readonly reviewedBy: string;
  readonly sourceMedia: "local";
  readonly caseSensitivity: "insensitive";
  readonly decisions: readonly Record<string, unknown>[];
}

const REVIEWED_FILE_TIME = new Date("2026-07-13T16:30:00.000Z");
const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
  }));
});

async function makeGuidedFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-guided-http-"));
  temporaryDirectories.push(root);
  await Promise.all([
    writeFile(join(root, "capture.e57"), Buffer.from("ASTM-E57\0fixture", "ascii")),
    writeFile(join(root, "model.xbin"), Buffer.from("XBAGfixture", "ascii")),
    writeFile(join(root, "mystery.bin"), Buffer.from("unknown-fixture", "ascii")),
  ]);
  await Promise.all([
    utimes(join(root, "capture.e57"), REVIEWED_FILE_TIME, REVIEWED_FILE_TIME),
    utimes(join(root, "model.xbin"), REVIEWED_FILE_TIME, REVIEWED_FILE_TIME),
    utimes(join(root, "mystery.bin"), REVIEWED_FILE_TIME, REVIEWED_FILE_TIME),
  ]);
  return root;
}

async function makeFileCountFixture(fileCount: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-guided-count-"));
  temporaryDirectories.push(root);
  for (let start = 0; start < fileCount; start += 50) {
    await Promise.all(Array.from(
      { length: Math.min(50, fileCount - start) },
      (_, offset) => {
        const index = start + offset;
        const name = `model-${String(index).padStart(4, "0")}.obj`;
        return writeFile(join(root, name), `# fixture ${String(index)}\nv 0 0 0\n`);
      },
    ));
  }
  return root;
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no token");
  return token;
}

function sendRequest(
  app: LocalFoundryAppHandle,
  input: {
    readonly method?: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const request = httpRequest({
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
    request.on("error", rejectResult);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

function postJson(
  app: LocalFoundryAppHandle,
  path: string,
  value: unknown,
  options: {
    readonly token?: string;
    readonly origin?: string;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<HttpResult> {
  const body = JSON.stringify(value);
  const token = options.token ?? tokenFor(app);
  return sendRequest(app, {
    method: "POST",
    path: `${path}?token=${encodeURIComponent(token)}`,
    headers: {
      Origin: options.origin ?? app.origin,
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      ...options.headers,
    },
    body,
  });
}

function getArtifact(
  app: LocalFoundryAppHandle,
  path: string,
  digest?: string,
): Promise<HttpResult> {
  return sendRequest(app, {
    path: `${path}?token=${encodeURIComponent(tokenFor(app))}${
      digest === undefined ? "" : `&digest=${encodeURIComponent(digest)}`
    }`,
  });
}

function parseJson(response: HttpResult): unknown {
  return JSON.parse(response.body) as unknown;
}

async function readState(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await getArtifact(app, "/api/state");
  expect(response.status).toBe(200);
  return parseJson(response) as LocalFoundryPublicState;
}

async function waitForReady(
  app: LocalFoundryAppHandle,
  timeoutMs = 5_000,
): Promise<FoundryUniversalIntakeReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readState(app);
    if (state.phase === "ready" && state.receipt !== undefined) return state.receipt;
    if (state.phase === "failed") throw new Error("fixture inspection failed");
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
  throw new Error("local app did not finish inspecting the fixture");
}

function admissionBody(receipt: FoundryUniversalIntakeReceipt): AdmissionPostBody {
  return {
    receiptSha256: receipt.receiptSha256,
    projectId: "guided-http-fixture",
    reviewedBy: "test-operator",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions: receipt.files.map((file) => {
      if (file.path === "capture.e57") {
        return {
          action: "admit",
          path: file.path,
          inputType: "generic_e57",
          role: "raw_capture",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: [],
          evidenceKinds: [],
        };
      }
      if (file.path === "model.xbin") {
        return {
          action: "admit",
          path: file.path,
          inputType: "xgrids_xbin",
          role: "reference_only",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: [],
          evidenceKinds: [],
        };
      }
      return {
        action: "exclude",
        path: file.path,
        reason: "provenance_unknown",
      };
    }),
  };
}

function allObjAdmissionBody(receipt: FoundryUniversalIntakeReceipt): AdmissionPostBody {
  return {
    receiptSha256: receipt.receiptSha256,
    projectId: "guided-file-count-fixture",
    reviewedBy: "test-operator",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions: receipt.files.map((file) => ({
      action: "admit",
      path: file.path,
      inputType: "obj",
      role: "official_export",
      formatDecision: "accept_detector",
      formatEvidencePaths: [],
      parentPaths: [],
      evidenceKinds: [],
    })),
  };
}

function safePlanOptions(): Record<string, unknown> {
  return {
    hdAppearance: "captured_only",
    includeSemanticInference: false,
    buildOperationalMesh: true,
    buildNeuralRepresentation: false,
  };
}

function replaceDecision(
  body: AdmissionPostBody,
  path: string,
  replacement: Record<string, unknown>,
): AdmissionPostBody {
  return {
    ...body,
    decisions: body.decisions.map((decision) =>
      decision.path === path ? replacement : decision,
    ),
  };
}

function expectSafeError(response: HttpResult, status: number): void {
  expect(response.status).toBe(status);
  const parsed = parseJson(response) as { readonly error?: unknown; readonly code?: unknown };
  expect(parsed.error).toEqual(expect.any(String));
}

function expectNoPrivateDirectory(text: string, source: string): void {
  const privateDirectory = dirname(source);
  expect(text).not.toContain(privateDirectory);
  expect(text).not.toContain(privateDirectory.replaceAll("\\", "\\\\"));
}

async function compileAdmission(
  app: LocalFoundryAppHandle,
  receipt: FoundryUniversalIntakeReceipt,
): Promise<{
  readonly reviewSha256: string;
  readonly resultSha256: string;
}> {
  const response = await postJson(app, "/api/admission-draft", admissionBody(receipt));
  expect(response.status).toBe(201);
  const parsed = parseJson(response) as {
    readonly reviewSha256: string;
    readonly resultSha256: string;
  };
  expect(parsed).toMatchObject({
    receiptSha256: receipt.receiptSha256,
    authority: "none",
  });
  return parsed;
}

const MISSING_ARTIFACT_DIGEST = `sha256:${"0".repeat(64)}`;

describe("Foundry local guided review HTTP contract", () => {
  it("accepts exactly 500 reviewed files and fails closed at 501 without hiding the receipt", async () => {
    expect(LOCAL_FOUNDRY_MAX_GUIDED_FILES).toBe(500);

    const sourceAtLimit = await makeFileCountFixture(LOCAL_FOUNDRY_MAX_GUIDED_FILES);
    const appAtLimit = await startLocalFoundryApp({ source: sourceAtLimit });
    openApps.push(appAtLimit);
    const receiptAtLimit = await waitForReady(appAtLimit, 20_000);
    expect(receiptAtLimit.files).toHaveLength(LOCAL_FOUNDRY_MAX_GUIDED_FILES);
    const accepted = await postJson(
      appAtLimit,
      "/api/admission-draft",
      allObjAdmissionBody(receiptAtLimit),
    );
    expect(accepted.status, accepted.body).toBe(201);

    const sourceOverLimit = await makeFileCountFixture(LOCAL_FOUNDRY_MAX_GUIDED_FILES + 1);
    const appOverLimit = await startLocalFoundryApp({ source: sourceOverLimit });
    openApps.push(appOverLimit);
    const receiptOverLimit = await waitForReady(appOverLimit, 20_000);
    expect(receiptOverLimit.files).toHaveLength(LOCAL_FOUNDRY_MAX_GUIDED_FILES + 1);
    const downloadableReceipt = await getArtifact(appOverLimit, "/api/receipt");
    expect(downloadableReceipt.status).toBe(200);
    expect((parseJson(downloadableReceipt) as FoundryUniversalIntakeReceipt).files)
      .toHaveLength(LOCAL_FOUNDRY_MAX_GUIDED_FILES + 1);

    const rejected = await postJson(appOverLimit, "/api/admission-draft", {});
    expectSafeError(rejected, 409);
    expect(rejected.body).toContain("supports at most 500 files");
    expect(rejected.body).toContain("no file is silently omitted");
  }, 60_000);

  it("binds every file decision to the exact receipt before creating a draft", async () => {
    const source = await makeGuidedFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const body = admissionBody(receipt);

    expect((await getArtifact(app, "/api/admission-review", MISSING_ARTIFACT_DIGEST)).status).toBe(409);
    expect((await getArtifact(app, "/api/admission-result", MISSING_ARTIFACT_DIGEST)).status).toBe(409);

    const wrongReceipt = await postJson(app, "/api/admission-draft", {
      ...body,
      receiptSha256: "0".repeat(64),
    });
    expectSafeError(wrongReceipt, 400);
    expect(wrongReceipt.body).toContain("different intake receipt");
    expect((await getArtifact(app, "/api/admission-review", MISSING_ARTIFACT_DIGEST)).status).toBe(409);

    const missingDecision = await postJson(app, "/api/admission-draft", {
      ...body,
      decisions: body.decisions.filter((decision) => decision.path !== "mystery.bin"),
    });
    expectSafeError(missingDecision, 400);
    expect(missingDecision.body).toContain("Every inspected file needs exactly one choice");
    expect((await getArtifact(app, "/api/admission-result", MISSING_ARTIFACT_DIGEST)).status).toBe(409);

    const compiled = await compileAdmission(app, receipt);
    const reviewResponse = await getArtifact(app, "/api/admission-review", compiled.reviewSha256);
    const resultResponse = await getArtifact(app, "/api/admission-result", compiled.resultSha256);
    expect(reviewResponse.status).toBe(200);
    expect(resultResponse.status).toBe(200);

    const review = FoundryIntakeAdmissionReviewV0Schema.parse(parseJson(reviewResponse));
    const result = FoundryIntakeAdmissionResultV0Schema.parse(parseJson(resultResponse));
    expect(review.receiptSha256).toBe(receipt.receiptSha256);
    expect(result.receiptSha256).toBe(receipt.receiptSha256);
    expect(result.reviewSha256).toBe(review.reviewSha256);
    expect(review.decisions.map((decision) => decision.path)).toEqual(
      receipt.files.map((file) => file.path),
    );
    expect(review.authority).toBe("none");
    expect(review.sourceMutationPermitted).toBe(false);
    expect(result.manifest.assets.find((asset) => asset.relativePath === "model.xbin"))
      .toMatchObject({
        inputType: "xgrids_xbin",
        captureState: "reference",
        accessState: "metadata_only",
      });
    expect(result.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "mystery.bin", reason: "provenance_unknown" }),
    ]));
  });

  it("keeps unknown and proprietary inputs blocked when a browser asks for a bypass", async () => {
    const source = await makeGuidedFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const body = admissionBody(receipt);

    const unknownAsKnown = await postJson(
      app,
      "/api/admission-draft",
      replaceDecision(body, "mystery.bin", {
        action: "admit",
        path: "mystery.bin",
        inputType: "manual_evidence",
        role: "reference_only",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      }),
    );
    expectSafeError(unknownAsKnown, 400);
    expect(unknownAsKnown.body).toContain("Choose the format explicitly");

    const relabelledXbin = await postJson(
      app,
      "/api/admission-draft",
      replaceDecision(body, "model.xbin", {
        action: "admit",
        path: "model.xbin",
        inputType: "generic_e57",
        role: "raw_capture",
        formatDecision: "operator_override",
        formatEvidencePaths: ["model.xbin"],
        parentPaths: [],
        evidenceKinds: [],
      }),
    );
    expectSafeError(relabelledXbin, 400);
    expect(relabelledXbin.body).toContain("cannot be relabelled");

    const directlyAccessibleXbin = await postJson(
      app,
      "/api/admission-draft",
      replaceDecision(body, "model.xbin", {
        action: "admit",
        path: "model.xbin",
        inputType: "xgrids_xbin",
        role: "raw_capture",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      }),
    );
    expectSafeError(directlyAccessibleXbin, 400);
    expect(directlyAccessibleXbin.body).toContain("must use the reference-only role");

    const falseDuplicate = await postJson(
      app,
      "/api/admission-draft",
      replaceDecision(body, "mystery.bin", {
        action: "exclude",
        path: "mystery.bin",
        reason: "duplicate_content",
      }),
    );
    expectSafeError(falseDuplicate, 400);
    expect(falseDuplicate.body).toContain("not in an exact-copy group");

    expect((await getArtifact(app, "/api/admission-review", MISSING_ARTIFACT_DIGEST)).status).toBe(409);
    expect((await getArtifact(app, "/api/admission-result", MISSING_ARTIFACT_DIGEST)).status).toBe(409);
  });

  it("downloads validated drafts from memory and produces only non-executable plans", async () => {
    const source = await makeGuidedFixture();
    const before = (await readdir(source, { recursive: true })).sort();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const compiled = await compileAdmission(app, receipt);

    const reviewResponse = await getArtifact(app, "/api/admission-review", compiled.reviewSha256);
    const resultResponse = await getArtifact(app, "/api/admission-result", compiled.resultSha256);
    expect(reviewResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-admission-review-draft.json\"",
    );
    expect(resultResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-admission-result-draft.json\"",
    );
    const review = FoundryIntakeAdmissionReviewV0Schema.parse(parseJson(reviewResponse));
    const result = FoundryIntakeAdmissionResultV0Schema.parse(parseJson(resultResponse));
    expect(result.reviewSha256).toBe(review.reviewSha256);

    const planResponse = await postJson(app, "/api/plan-preview", {
      ...safePlanOptions(),
      admissionResultSha256: compiled.resultSha256,
    });
    expect(planResponse.status, planResponse.body).toBe(201);
    const planEnvelope = parseJson(planResponse) as {
      readonly preview: unknown;
      readonly processingOutline: {
        readonly state: string;
        readonly lanes: readonly unknown[];
        readonly affectedAssets?: readonly {
          readonly assetId: string;
          readonly relativePath: string;
        }[];
      };
      readonly qualityDecisionBoard: {
        readonly state: string;
        readonly cards: readonly unknown[];
        readonly affectedAssets: readonly {
          readonly assetId: string;
          readonly relativePath: string;
        }[];
      };
    };
    const returnedPreview = FoundryPlanPreviewV0Schema.parse(planEnvelope.preview);
    expect(returnedPreview).toMatchObject({
      ingestManifestSha256: result.manifestSha256,
      authority: "none",
    });
    expect(planEnvelope.processingOutline).toMatchObject({
      state: "unavailable",
      lanes: [],
      affectedAssets: [{
        assetId: expect.any(String),
        relativePath: "model.xbin",
      }],
    });
    expect(planEnvelope.qualityDecisionBoard).toMatchObject({
      state: "unavailable",
      cards: [],
      affectedAssets: [{
        assetId: expect.any(String),
        relativePath: "model.xbin",
      }],
    });

    const dossierResponse = await getArtifact(
      app,
      "/api/plan-dossier",
      returnedPreview.previewSha256,
    );
    expect(dossierResponse.status).toBe(200);
    expect(dossierResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-plan-preview.json\"",
    );
    const preview = FoundryPlanPreviewV0Schema.parse(parseJson(dossierResponse));
    expect(preview.ingestManifestSha256).toBe(result.manifestSha256);
    expect(preview.admissionResultSha256).toBe(result.resultSha256);
    expect(preview.authority).toBe("none");
    expect(preview.capabilities).toEqual({
      planning: "preview_only",
      execution: "not_authorized",
      processLaunch: "not_available",
      networkAccess: "not_available",
      providerSdk: "not_available",
      credentialAccess: "not_available",
      spend: "not_authorized",
      sourceMutation: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    });
    expect(preview.planningGate.status).toBe("blocked");
    expect(preview.planningGate.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "proprietary_xgrids_xbin_decoder_not_verified" }),
    ]));
    expect(preview.exactArtifacts).toEqual({
      state: "withheld_planning_gate_blocked",
      reconstructionRecipe: null,
      planOnlyDossier: null,
    });
    expect([...preview.routes.local, ...preview.routes.cloud].length).toBeGreaterThan(0);
    expect([...preview.routes.local, ...preview.routes.cloud]
      .every((route) => route.status === "blocked" && route.jobSpecSha256 === null))
      .toBe(true);
    expect("selectedCandidate" in preview).toBe(false);
    expect("processingOutline" in preview).toBe(false);
    expect("qualityDecisionBoard" in preview).toBe(false);

    for (const response of [reviewResponse, resultResponse, planResponse, dossierResponse]) {
      expectNoPrivateDirectory(response.body, source);
    }
    expect((await readdir(source, { recursive: true })).sort()).toEqual(before);
  });

  it("shows a read-only file-to-activity outline without inventing workers", async () => {
    const source = await makeGuidedFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const admissionResponse = await postJson(
      app,
      "/api/admission-draft",
      replaceDecision(admissionBody(receipt), "model.xbin", {
        action: "exclude",
        path: "model.xbin",
        reason: "provenance_unknown",
      }),
    );
    expect(admissionResponse.status, admissionResponse.body).toBe(201);
    const admission = parseJson(admissionResponse) as { readonly resultSha256: string };

    const response = await postJson(app, "/api/plan-preview", {
      ...safePlanOptions(),
      admissionResultSha256: admission.resultSha256,
    });
    expect(response.status, response.body).toBe(201);
    const envelope = parseJson(response) as {
      readonly preview: unknown;
      readonly processingOutline: {
        readonly state: string;
        readonly meaning: string;
        readonly recipeState: string;
        readonly authority: string;
        readonly disclaimer: string;
        readonly lanes: readonly {
          readonly id: string;
          readonly representedAssets: readonly {
            readonly assetId: string;
            readonly relativePath: string;
          }[];
        }[];
      };
      readonly qualityDecisionBoard: {
        readonly state: string;
        readonly meaning: string;
        readonly recipeState: string;
        readonly authority: string;
        readonly gainEvidence: string;
        readonly winner: string;
        readonly cards: readonly {
          readonly id: string;
          readonly expectedGain: string;
          readonly evidenceRequirements: readonly {
            readonly id: string;
            readonly state: string;
            readonly representedAssets: readonly {
              readonly assetId: string;
              readonly relativePath: string;
            }[];
          }[];
          readonly representedAssets: readonly {
            readonly assetId: string;
            readonly relativePath: string;
          }[];
        }[];
      };
    };
    const preview = FoundryPlanPreviewV0Schema.parse(envelope.preview);
    expect(preview.status).toBe("blocked_before_recipe");
    expect(preview.planningGate.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "trusted_worker_binding_missing" }),
    ]));
    expect(preview.exactArtifacts).toEqual({
      state: "withheld_planning_gate_blocked",
      reconstructionRecipe: null,
      planOnlyDossier: null,
    });
    expect(envelope.processingOutline).toMatchObject({
      state: "outline_only",
      meaning: "read_only_file_to_activity_outline",
      recipeState: "not_compiled",
      authority: "none",
      disclaimer:
        "This is a file-to-activity outline only. It does not select a worker, compile a recipe, or say that any activity can run.",
    });
    expect(envelope.processingOutline.lanes.map((lane) => lane.id)).toEqual([
      "source_review",
      "point_geometry",
      "alignment_and_operational_geometry",
      "captured_appearance",
    ]);
    expect(envelope.processingOutline.lanes.every(
      (lane) => lane.representedAssets.length === 1,
    )).toBe(true);
    expect(envelope.processingOutline.lanes.flatMap(
      (lane) => lane.representedAssets.map((asset) => asset.relativePath),
    )).toEqual(["capture.e57", "capture.e57", "capture.e57", "capture.e57"]);
    expect(JSON.stringify(envelope.processingOutline)).not.toMatch(
      /containerImage|command|workerProfile|jobSpec|recipeSha256/u,
    );
    expect(envelope.qualityDecisionBoard).toMatchObject({
      state: "available",
      meaning: "source_aware_quality_decision_support",
      recipeState: "not_compiled",
      authority: "none",
      gainEvidence: "unmeasured",
      winner: "not_selected",
    });
    expect(envelope.qualityDecisionBoard.cards.map((card) => card.id)).toEqual([
      "preserve_captured_detail",
      "add_captured_photo_detail",
      "separate_operational_geometry",
    ]);
    expect(envelope.qualityDecisionBoard.cards.every(
      (card) => card.expectedGain === "unmeasured",
    )).toBe(true);
    expect(envelope.qualityDecisionBoard.cards.every(
      (card) => card.evidenceRequirements.length > 0,
    )).toBe(true);
    expect(JSON.stringify(envelope.qualityDecisionBoard)).not.toMatch(
      /containerImage|command|workerProfile|jobSpec|recipeSha256|will improve|hd-ready|missingEvidence/u,
    );
  });

  it("rejects bad tokens, origins, paths, oversized bodies, commands, credentials, uploads, and spend controls", async () => {
    const source = await makeGuidedFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const body = admissionBody(receipt);

    const noToken = await sendRequest(app, {
      method: "POST",
      path: "/api/admission-draft",
      headers: { Origin: app.origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(noToken.status).toBe(401);
    expect((await postJson(app, "/api/admission-draft", body, { token: "wrong" })).status)
      .toBe(401);
    expect((await postJson(app, "/api/admission-draft", body, {
      origin: "https://attacker.example",
    })).status).toBe(403);
    expect((await postJson(app, "/api/admission-draft", body, {
      headers: { Host: "attacker.example" },
    })).status).toBe(421);
    expect((await sendRequest(app, {
      method: "POST",
      path: `/api/admission-draft?token=${encodeURIComponent(tokenFor(app))}&source=C%3A%5Cprivate%5Csecret.e57`,
      headers: { Origin: app.origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })).status).toBe(401);

    const injectedRoute = await getArtifact(app, "/C:/private/secret.e57");
    expect(injectedRoute.status).toBe(404);
    expect(injectedRoute.body).not.toContain("secret.e57");

    const forbiddenPath = "C:\\private\\client-a\\secret.e57";
    const forbiddenBody = await postJson(app, "/api/admission-draft", {
      ...body,
      sourcePath: forbiddenPath,
    });
    expectSafeError(forbiddenBody, 400);
    expect(forbiddenBody.body).not.toContain("secret.e57");
    expect(forbiddenBody.body).not.toContain("client-a");

    expect(LOCAL_FOUNDRY_MAX_DRAFT_BODY_BYTES).toBeGreaterThanOrEqual(
      LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
    );
    const oversized = "x".repeat(LOCAL_FOUNDRY_MAX_DRAFT_BODY_BYTES + 1);
    const oversizedResponse = await sendRequest(app, {
      method: "POST",
      path: `/api/admission-draft?token=${encodeURIComponent(tokenFor(app))}`,
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(oversized)),
      },
      body: oversized,
    });
    expectSafeError(oversizedResponse, 413);
    expect((await getArtifact(app, "/api/admission-review", MISSING_ARTIFACT_DIGEST)).status).toBe(409);

    const compiled = await compileAdmission(app, receipt);
    const maliciousPlan = await postJson(app, "/api/plan-preview", {
      ...safePlanOptions(),
      admissionResultSha256: compiled.resultSha256,
      sourcePath: forbiddenPath,
      arbitraryUrl: "https://attacker.example/upload",
      command: ["powershell", "-Command", "Invoke-WebRequest"],
      providerCredential: "RUNPOD_SECRET",
      execute: true,
      upload: true,
      approved: true,
      spendUsd: 100,
    });
    expectSafeError(maliciousPlan, 400);
    expect(maliciousPlan.body).not.toContain("RUNPOD_SECRET");
    expect(maliciousPlan.body).not.toContain("secret.e57");
    expect((await getArtifact(app, "/api/plan-dossier", MISSING_ARTIFACT_DIGEST)).status).toBe(409);
  });

  it("rejects stale downloads and plans when another tab rebuilds the in-memory draft", async () => {
    const source = await makeGuidedFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const first = await compileAdmission(app, receipt);

    const secondResponse = await postJson(app, "/api/admission-draft", {
      ...admissionBody(receipt),
      reviewedBy: "second-tab-operator",
    });
    expect(secondResponse.status).toBe(201);
    const second = parseJson(secondResponse) as {
      readonly reviewSha256: string;
      readonly resultSha256: string;
    };
    expect(second.resultSha256).not.toBe(first.resultSha256);

    expect((await getArtifact(app, "/api/admission-review", first.reviewSha256)).status)
      .toBe(409);
    expect((await getArtifact(app, "/api/admission-result", first.resultSha256)).status)
      .toBe(409);
    const stalePlan = await postJson(app, "/api/plan-preview", {
      ...safePlanOptions(),
      admissionResultSha256: first.resultSha256,
    });
    expectSafeError(stalePlan, 409);
    expect(stalePlan.body).toContain("review draft changed");

    const currentPlan = await postJson(app, "/api/plan-preview", {
      ...safePlanOptions(),
      admissionResultSha256: second.resultSha256,
    });
    expect(currentPlan.status).toBe(201);
    const currentPreview = parseJson(currentPlan) as {
      readonly preview: { readonly previewSha256: string };
    };

    const thirdResponse = await postJson(app, "/api/admission-draft", {
      ...admissionBody(receipt),
      projectId: "third-tab-project",
    });
    expect(thirdResponse.status).toBe(201);
    expect((await getArtifact(app, "/api/plan-dossier", currentPreview.preview.previewSha256)).status)
      .toBe(409);
  });

  it("removes the private in-memory workflow when the operator stops it or the session expires", async () => {
    const source = await makeGuidedFixture();
    const before = (await readdir(source, { recursive: true })).sort();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const receipt = await waitForReady(app);
    await compileAdmission(app, receipt);

    const stopped = await postJson(app, "/api/stop", {});
    expect(stopped.status).toBe(202);
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    await expect(getArtifact(app, "/api/admission-review", MISSING_ARTIFACT_DIGEST)).rejects.toThrow();

    const expiring = await startLocalFoundryApp({
      source,
      sessionTtlMs: 60,
    });
    openApps.push(expiring);
    await expect(expiring.closed).resolves.toEqual({ reason: "session_expired" });
    await expect(getArtifact(expiring, "/api/admission-review", MISSING_ARTIFACT_DIGEST)).rejects.toThrow();
    expect((await readdir(source, { recursive: true })).sort()).toEqual(before);
  });
});
