import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeFoundryRoomRealityPackageAssemblySha256,
  type FoundryRoomRealityPackageAssemblyPayloadV0,
  type FoundryRoomRealityPackageAssemblyResultV0,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_E57_POINT_CLASSIFICATION_MASK_MAXIMUM_BODY_BYTES,
} from "../local-e57-point-classification-mask.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalRoomRealityReviewPublicStateV0,
} from "../local-app.js";
import type {
  LocalRoomRealityReviewDraftV0,
  LocalRoomRealityReviewSurfaceV0,
} from "../local-room-reality-review.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const openApps: LocalFoundryAppHandle[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    openApps.splice(0).map(async (app) => {
      if (app.getPhase() !== "stopped") await app.stop();
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

async function startFixtureApp(): Promise<LocalFoundryAppHandle> {
  const root = await mkdtemp(join(tmpdir(), "foundry-room-review-route-"));
  temporaryDirectories.push(root);
  await writeFile(
    join(root, "harmless-fixture.txt"),
    "fixture metadata only\n",
  );
  const app = await startLocalFoundryApp({
    source: root,
    port: 0,
    sessionTtlMs: 60_000,
  });
  openApps.push(app);
  return app;
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("local app URL has no session token");
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
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: app.host,
        port: app.port,
        method: input.method ?? "GET",
        path: input.path,
        headers: input.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.once("error", reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

function blockedCandidate(): FoundryRoomRealityPackageAssemblyResultV0 {
  const payload: FoundryRoomRealityPackageAssemblyPayloadV0 = {
    schemaVersion: "omnitwin.foundry.room-reality-package-assembly.v0",
    status: "blocked",
    packageId: "harmless-room-review-fixture",
    projectId: "harmless-local-project",
    ingestManifestSha256: `sha256:${"1".repeat(64)}`,
    packageDraftSha256: `sha256:${"2".repeat(64)}`,
    referenceCatalogSha256: `sha256:${"3".repeat(64)}`,
    ingestLegalReviewState: "blocked",
    referenceCatalogAuthority: "caller_supplied_unverified",
    exactMemberIdentities: "not_verified",
    movableObjectClassification: "not_verified",
    releaseEligibility: "blocked",
    releaseBlockers: [
      "EXACT_MEMBER_IDENTITIES_UNVERIFIED",
      "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
      "REFERENCE_CATALOG_UNAUTHENTICATED",
      "RIGHTS_BLOCKED",
    ],
    canonicalPackage: null,
    unresolvedReferences: ["required_room_role:fixture:architectural_geometry"],
    authority: "none",
    capabilities: {
      signing: "not_authorized",
      publication: "not_authorized",
      runtimeActivation: "not_authorized",
      exportAuthority: "not_authorized",
      runtimePackageRegistration: "not_authorized",
    },
  };
  return {
    ...payload,
    assemblySha256: computeFoundryRoomRealityPackageAssemblySha256(payload),
  };
}

function jsonHeaders(
  app: LocalFoundryAppHandle,
): Readonly<Record<string, string>> {
  return {
    "Content-Type": "application/json",
    Origin: app.origin,
  };
}

describe("Foundry local Room Reality Package review routes", () => {
  it("serves a reachable review page and keeps the API token-bound", async () => {
    const app = await startFixtureApp();
    const token = tokenFor(app);

    const page = await sendRequest(app, {
      path: `/room-review?token=${encodeURIComponent(token)}`,
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain(
      "Review what is known. Record what must change.",
    );
    expect(page.body).toContain("A review draft is not an approval");
    expect(page.body).toContain("Open a generated E57 point crop");
    expect(page.body).toContain(
      "explicitly ask the local 127.0.0.1 process",
    );
    expect(page.body).toContain("Nothing is uploaded externally or persisted");
    expect(page.headers["content-security-policy"]).toContain(
      "connect-src 'self'",
    );
    expect(page.headers["content-security-policy"]).toContain(
      "worker-src 'none'",
    );

    const visualScript = await sendRequest(app, {
      path: "/room-review.js",
    });
    expect(visualScript.status).toBe(200);
    expect(visualScript.body).toContain(
      "generated_bounded_e57_crop_json_only",
    );
    expect(visualScript.body).toContain(
      'const maskRoute = "/api/room-reality-review/e57-classification-mask"',
    );

    const missingToken = await sendRequest(app, {
      path: "/api/room-reality-review/state",
    });
    expect(missingToken.status).toBe(401);

    const empty = await sendRequest(app, {
      path: `/api/room-reality-review/state?token=${encodeURIComponent(token)}`,
    });
    expect(empty.status).toBe(200);
    expect(
      JSON.parse(empty.body) as LocalRoomRealityReviewPublicStateV0,
    ).toEqual({
      state: "empty",
      authority: "none",
      execution: "disabled",
      packageExport: "disabled",
      realMediaRead: "not_performed",
      surface: null,
      draft: null,
    });
  });

  it("keeps classification-mask compilation token-bound, same-origin, bounded, and stateless on refusal", async () => {
    const app = await startFixtureApp();
    const token = tokenFor(app);
    const path = `/api/room-reality-review/e57-classification-mask?token=${encodeURIComponent(token)}`;

    const missingToken = await sendRequest(app, {
      method: "POST",
      path: "/api/room-reality-review/e57-classification-mask",
      headers: jsonHeaders(app),
      body: "{}",
    });
    expect(missingToken.status).toBe(401);

    const crossOrigin = await sendRequest(app, {
      method: "POST",
      path,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid",
      },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);

    const wrongContentType = await sendRequest(app, {
      method: "POST",
      path,
      headers: {
        "Content-Type": "text/plain",
        Origin: app.origin,
      },
      body: "{}",
    });
    expect(wrongContentType.status).toBe(415);

    const tooLarge = await sendRequest(app, {
      method: "POST",
      path,
      headers: jsonHeaders(app),
      body: "x".repeat(
        LOCAL_E57_POINT_CLASSIFICATION_MASK_MAXIMUM_BODY_BYTES + 1,
      ),
    });
    expect(tooLarge.status).toBe(413);

    const malformed = await sendRequest(app, {
      method: "POST",
      path,
      headers: jsonHeaders(app),
      body: "{}",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toContain("invalid field set");

    const wrongMethod = await sendRequest(app, { path });
    expect(wrongMethod.status).toBe(405);

    const state = await sendRequest(app, {
      path: `/api/room-reality-review/state?token=${encodeURIComponent(token)}`,
    });
    expect(state.status).toBe(200);
    expect(
      JSON.parse(state.body) as LocalRoomRealityReviewPublicStateV0,
    ).toMatchObject({
      state: "empty",
      authority: "none",
      packageExport: "disabled",
    });
    expect(state.body).not.toContain("classificationMask");
  });

  it("loads only a validated JSON dossier and records an exact non-executable draft", async () => {
    const app = await startFixtureApp();
    const token = tokenFor(app);
    const candidate = blockedCandidate();
    const path = `/api/room-reality-review/dossier?token=${encodeURIComponent(token)}`;

    const opened = await sendRequest(app, {
      method: "POST",
      path,
      headers: jsonHeaders(app),
      body: JSON.stringify({ candidate }),
    });
    expect(opened.status).toBe(201);
    const surface = JSON.parse(opened.body) as LocalRoomRealityReviewSurfaceV0;
    expect(surface.authority).toBe("none");
    expect(surface.inspectionBoundary.realMediaRead).toBe("not_performed");
    expect(surface.dimensions).toHaveLength(7);
    expect(surface.capabilities.packageExport).toBe("not_authorized");

    const draftRequest = {
      reviewSurfaceSha256: surface.reviewSurfaceSha256,
      candidateAssemblySha256: surface.candidate.assemblySha256,
      reviewedAt: "2026-08-09T12:00:00.000Z",
      reviewedBy: "Route fixture reviewer",
      decisions: surface.dimensions.map((dimension) => ({
        dimensionId: dimension.id,
        action: "record_unresolved",
        note: `Keep ${dimension.label.toLowerCase()} unresolved.`,
      })),
    };
    const drafted = await sendRequest(app, {
      method: "POST",
      path: `/api/room-reality-review/draft?token=${encodeURIComponent(token)}`,
      headers: jsonHeaders(app),
      body: JSON.stringify(draftRequest),
    });
    expect(drafted.status).toBe(201);
    const draft = JSON.parse(drafted.body) as LocalRoomRealityReviewDraftV0;
    expect(draft.authority).toBe("none");
    expect(draft.releaseEligibility).toBe("blocked");
    expect(draft.capabilities.execution).toBe("not_authorized");
    expect(draft.capabilities.packageExport).toBe("not_authorized");
    expect(draft.reviewDraftSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const restored = await sendRequest(app, {
      path: `/api/room-reality-review/state?token=${encodeURIComponent(token)}`,
    });
    const state = JSON.parse(
      restored.body,
    ) as LocalRoomRealityReviewPublicStateV0;
    expect(state.state).toBe("ready");
    if (state.state !== "ready") throw new Error("expected ready review state");
    expect(state.draft?.reviewDraftSha256).toBe(draft.reviewDraftSha256);
  });

  it("rejects cross-origin, malformed, stale, and wrong-method requests without replacing good state", async () => {
    const app = await startFixtureApp();
    const token = tokenFor(app);
    const candidate = blockedCandidate();
    const dossierPath = `/api/room-reality-review/dossier?token=${encodeURIComponent(token)}`;

    const crossOrigin = await sendRequest(app, {
      method: "POST",
      path: dossierPath,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid",
      },
      body: JSON.stringify({ candidate }),
    });
    expect(crossOrigin.status).toBe(403);

    const opened = await sendRequest(app, {
      method: "POST",
      path: dossierPath,
      headers: jsonHeaders(app),
      body: JSON.stringify({ candidate }),
    });
    expect(opened.status).toBe(201);
    const surface = JSON.parse(opened.body) as LocalRoomRealityReviewSurfaceV0;

    const malformed = await sendRequest(app, {
      method: "POST",
      path: dossierPath,
      headers: jsonHeaders(app),
      body: JSON.stringify({ candidate, executable: true }),
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toContain("invalid field set");

    const staleDraft = await sendRequest(app, {
      method: "POST",
      path: `/api/room-reality-review/draft?token=${encodeURIComponent(token)}`,
      headers: jsonHeaders(app),
      body: JSON.stringify({
        reviewSurfaceSha256: `sha256:${"9".repeat(64)}`,
        candidateAssemblySha256: surface.candidate.assemblySha256,
        reviewedAt: "2026-08-09T12:00:00.000Z",
        reviewedBy: "Route fixture reviewer",
        decisions: surface.dimensions.map((dimension) => ({
          dimensionId: dimension.id,
          action: "record_unresolved",
          note: `Keep ${dimension.label.toLowerCase()} unresolved.`,
        })),
      }),
    });
    expect(staleDraft.status).toBe(400);
    expect(staleDraft.body).toContain("changed");

    const wrongMethod = await sendRequest(app, {
      path: dossierPath,
    });
    expect(wrongMethod.status).toBe(405);

    const stateResponse = await sendRequest(app, {
      path: `/api/room-reality-review/state?token=${encodeURIComponent(token)}`,
    });
    const state = JSON.parse(
      stateResponse.body,
    ) as LocalRoomRealityReviewPublicStateV0;
    expect(state.state).toBe("ready");
    if (state.state !== "ready")
      throw new Error("expected good state to survive");
    expect(state.surface.reviewSurfaceSha256).toBe(surface.reviewSurfaceSha256);
    expect(state.draft).toBeNull();
  });
});
