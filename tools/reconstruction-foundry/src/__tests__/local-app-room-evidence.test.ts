import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalRoomEvidenceCandidateError,
  ROOM_EVIDENCE_DIGEST_DOMAIN,
  compileRoomEvidenceCandidateDigestV0,
  type PreparedLocalRoomEvidenceCandidateV0,
} from "../local-room-evidence-candidate.js";
import { prepareLocalExactReadOnlyMemberGrantV0 } from "../local-sog-candidate-gateway.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
} from "../local-app.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

const cleanup: string[] = [];
const apps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async (app) => {
      if (app.getPhase() !== "stopped") await app.stop();
    }),
  );
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

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
    readonly headers?: Readonly<Record<string, string>>;
  },
): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const outgoing = httpRequest(
      {
        hostname: app.host,
        port: app.port,
        method: input.method ?? "GET",
        path: input.path,
        headers: input.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.once("error", rejectResult);
        response.once("end", () => {
          resolveResult({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    outgoing.once("error", rejectResult);
    outgoing.end();
  });
}

async function fixture(): Promise<{
  readonly root: string;
  readonly bytes: Buffer;
  readonly gateway: PreparedLocalRoomEvidenceCandidateV0;
}> {
  const root = await mkdtemp(join(tmpdir(), "foundry-room-evidence-http-"));
  cleanup.push(root);
  await mkdir(join(root, "members"));
  const bytes = Buffer.from("fixture-room-evidence", "utf8");
  await writeFile(join(root, "members", "preview.jpg"), bytes);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const grant = await prepareLocalExactReadOnlyMemberGrantV0({
    sourceRoot: root,
    members: [
      {
        memberId: "preview",
        relativePath: "members/preview.jpg",
        sha256: digest,
        sizeBytes: bytes.length,
      },
    ],
  });
  const allowedConsumerOrigin = "http://127.0.0.1:55983";
  const profile = Object.freeze({
    schemaVersion: "omnitwin.local-foundry.room-evidence-candidate.v0",
    candidateId: "fixture-room-evidence",
    candidateRevision: 1,
    sources: Object.freeze([
      Object.freeze({
        sourceId: "fixture",
        state: "present_current_bytes_validated",
        sha256: digest,
        sizeBytes: bytes.length,
      }),
    ]),
  });
  const profileDigest = compileRoomEvidenceCandidateDigestV0(profile);
  const open = async (rangeHeader: string | undefined) => {
    const result = await grant.openMember("preview", rangeHeader);
    if (result.state === "range_not_satisfiable") return result;
    return {
      state: "ready" as const,
      response: {
        lease: result.lease,
        mediaType: "image/jpeg",
        suffix: "jpg",
      },
    };
  };
  return {
    root,
    bytes,
    gateway: {
      allowedConsumerOrigin,
      descriptor: (origin, token) => ({
        schemaVersion: "omnitwin.local-foundry.room-evidence-candidate.v0",
        candidateId: "fixture-room-evidence",
        candidateRevision: 1,
        candidateDigest: profileDigest,
        profileDigest,
        integrity: {
          algorithm: "sha256",
          domain: ROOM_EVIDENCE_DIGEST_DOMAIN,
          canonicalization:
            "utf8_json_recursive_lexicographic_object_keys_array_order_preserved",
        },
        profile,
        leases: {
          panoramaAssetBaseUrl: `${origin}/api/local-room-evidence-candidate/twin/${token}/`,
          members: [
            {
              memberId: "preview",
              suffix: "jpg",
              url: `${origin}/api/local-room-evidence-candidate/members/preview.jpg?token=${token}`,
            },
          ],
        },
      }),
      acceptsRequestOrigin: (requestOrigin, origin) =>
        requestOrigin === undefined ||
        requestOrigin === origin ||
        requestOrigin === allowedConsumerOrigin,
      corsHeaders: (requestOrigin, origin): Readonly<Record<string, string>> =>
        requestOrigin === allowedConsumerOrigin && requestOrigin !== origin
          ? {
              "Access-Control-Allow-Origin": requestOrigin,
              "Access-Control-Expose-Headers":
                "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, X-Foundry-Sha256, X-Foundry-Size-Bytes",
              "Cross-Origin-Resource-Policy": "cross-origin",
              Vary: "Origin",
            }
          : {},
      openMember: async (memberId, suffix, rangeHeader) => {
        if (memberId !== "preview" || suffix !== "jpg") {
          throw new LocalRoomEvidenceCandidateError("not granted");
        }
        return open(rangeHeader);
      },
      openTwinMember: async (relativePath, rangeHeader) => {
        if (
          relativePath !== "tiles/scan_000/equirect_512.webp" &&
          relativePath !== "mesh/dollhouse.glb"
        ) {
          throw new LocalRoomEvidenceCandidateError("not granted");
        }
        return open(rangeHeader);
      },
    },
  };
}

describe("local Foundry room-evidence HTTP gateway", () => {
  it("protects the descriptor and exact members by Host, token, origin and suffix", async () => {
    const source = await fixture();
    const app = await startLocalFoundryApp({
      source: source.root,
      localRoomEvidenceTestHooks: { preparedGateway: source.gateway },
    });
    apps.push(app);
    const token = tokenFor(app);
    const descriptorPath = `/api/local-room-evidence-candidate?token=${token}`;

    expect(
      (await request(app, { path: "/api/local-room-evidence-candidate" }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app, {
          path: descriptorPath,
          headers: { Origin: "http://127.0.0.1:55984" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app, {
          path: descriptorPath,
          headers: { Host: "attacker.example" },
        })
      ).status,
    ).toBe(421);

    const descriptor = await request(app, {
      path: descriptorPath,
      headers: { Origin: "http://127.0.0.1:55983" },
    });
    expect(descriptor.status).toBe(200);
    expect(descriptor.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:55983",
    );
    expect(descriptor.headers["cache-control"]).toContain("no-store");
    expect(descriptor.body.toString("utf8")).not.toContain(source.root);
    const sealed = JSON.parse(descriptor.body.toString("utf8")) as {
      readonly profile: unknown;
      readonly profileDigest: string;
    };
    expect(compileRoomEvidenceCandidateDigestV0(sealed.profile)).toBe(
      sealed.profileDigest,
    );

    expect(
      (
        await request(app, {
          path: `/api/local-room-evidence-candidate/members/preview.png?token=${token}`,
          headers: { Origin: "http://127.0.0.1:55983" },
        })
      ).status,
    ).toBe(409);
  });

  it("serves immutable member and path-lease ranges with exact MIME and identity headers", async () => {
    const source = await fixture();
    const app = await startLocalFoundryApp({
      source: source.root,
      localRoomEvidenceTestHooks: { preparedGateway: source.gateway },
    });
    apps.push(app);
    const token = tokenFor(app);
    const headers = {
      Origin: "http://127.0.0.1:55983",
      Range: "bytes=2-7",
    };
    const member = await request(app, {
      path: `/api/local-room-evidence-candidate/members/preview.jpg?token=${token}`,
      headers,
    });
    expect(member.status).toBe(206);
    expect(member.body).toEqual(source.bytes.subarray(2, 8));
    expect(member.headers["content-type"]).toBe("image/jpeg");
    expect(member.headers["content-range"]).toBe(
      `bytes 2-7/${String(source.bytes.length)}`,
    );
    expect(member.headers["x-foundry-sha256"]).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(member.headers.location).toBeUndefined();

    const twin = await request(app, {
      path: `/api/local-room-evidence-candidate/twin/${token}/mesh/dollhouse.glb`,
      headers: { Origin: "http://127.0.0.1:55983" },
    });
    expect(twin.status).toBe(200);
    expect(twin.body).toEqual(source.bytes);
    expect(twin.headers.location).toBeUndefined();

    const wrongToken = await request(app, {
      path: `/api/local-room-evidence-candidate/twin/${"b".repeat(43)}/mesh/dollhouse.glb`,
      headers: { Origin: "http://127.0.0.1:55983" },
    });
    expect(wrongToken.status).toBe(401);
    expect(
      (
        await request(app, {
          path: `/api/local-room-evidence-candidate/twin/${token}/../manifest.json`,
          headers: { Origin: "http://127.0.0.1:55983" },
        })
      ).status,
    ).toBe(403);
  });

  it("permits only exact Range GET preflights from the allowlisted origin", async () => {
    const source = await fixture();
    const app = await startLocalFoundryApp({
      source: source.root,
      localRoomEvidenceTestHooks: { preparedGateway: source.gateway },
    });
    apps.push(app);
    const token = tokenFor(app);
    const result = await request(app, {
      method: "OPTIONS",
      path: `/api/local-room-evidence-candidate/twin/${token}/tiles/scan_000/equirect_512.webp`,
      headers: {
        Origin: "http://127.0.0.1:55983",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Range",
      },
    });
    expect(result.status).toBe(204);
    expect(result.headers["access-control-allow-methods"]).toBe("GET");
    expect(result.headers["access-control-allow-headers"]).toBe("Range");
  });
});
