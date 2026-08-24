import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileGrandHallSmallLocalSogCandidateDescriptorV0,
  prepareLocalExactReadOnlyMemberGrantV0,
  type LocalExactReadOnlyMemberGrantV0,
  type LocalSogCandidateDescriptorV0,
  type LocalSogCandidateTierDescriptorV0,
  type PreparedLocalSogCandidateGatewayV0,
} from "../local-sog-candidate-gateway.js";
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

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
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

async function makeGateway(): Promise<{
  readonly sourceRoot: string;
  readonly firstBytes: Buffer;
  readonly preparedGateway: PreparedLocalSogCandidateGatewayV0;
}> {
  const sourceRoot = await mkdtemp(join(tmpdir(), "foundry-sog-http-"));
  cleanup.push(sourceRoot);
  await mkdir(join(sourceRoot, "members"));
  const memberIds = [
    "desktop-0",
    "desktop-1",
    "desktop-2",
    "desktop-3",
    "mobile-0",
    "mobile-1",
    "mobile-2",
  ] as const;
  const bytesById = new Map<string, Buffer>();
  const grants: LocalExactReadOnlyMemberGrantV0[] = [];
  for (const [index, memberId] of memberIds.entries()) {
    const bytes = Buffer.from(`fixture-${String(index)}-${memberId}`, "utf8");
    const relativePath = `members/${memberId}.sog`;
    await writeFile(join(sourceRoot, ...relativePath.split("/")), bytes);
    bytesById.set(memberId, bytes);
    grants.push({
      memberId,
      relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
    });
  }
  const memberGrant = await prepareLocalExactReadOnlyMemberGrantV0({
    sourceRoot,
    members: grants,
  });
  const grantById = new Map(grants.map((grant) => [grant.memberId, grant]));
  const allowedConsumerOrigin = "http://127.0.0.1:55979";
  const descriptor = (
    gatewayOrigin: string,
    sessionToken: string,
  ): LocalSogCandidateDescriptorV0 => {
    const base = compileGrandHallSmallLocalSogCandidateDescriptorV0(
      gatewayOrigin,
      sessionToken,
    );
    const tiers = base.tiers.map((tier): LocalSogCandidateTierDescriptorV0 => {
      const members = tier.members.map((member) => {
        const grant = grantById.get(member.memberId);
        if (grant === undefined) throw new Error("test grant is incomplete");
        return {
          ...member,
          sha256: grant.sha256,
          sizeBytes: grant.sizeBytes,
          url: `${gatewayOrigin}/api/local-sog-candidate/members/${member.memberId}.sog?token=${encodeURIComponent(sessionToken)}`,
        };
      });
      return {
        ...tier,
        sizeBytes: members.reduce((total, member) => total + member.sizeBytes, 0),
        members,
      };
    });
    const first = tiers[0];
    const second = tiers[1];
    if (first === undefined || second === undefined) {
      throw new Error("test descriptor tiers are incomplete");
    }
    return { ...base, tiers: [first, second] };
  };
  return {
    sourceRoot,
    firstBytes: bytesById.get("desktop-0")!,
    preparedGateway: {
      allowedConsumerOrigin,
      descriptor,
      acceptsRequestOrigin: (requestOrigin, gatewayOrigin) =>
        requestOrigin === undefined ||
        requestOrigin === gatewayOrigin ||
        requestOrigin === allowedConsumerOrigin,
      corsHeaders: (
        requestOrigin,
        gatewayOrigin,
      ): Readonly<Record<string, string>> => {
        if (
          requestOrigin !== allowedConsumerOrigin ||
          requestOrigin === gatewayOrigin
        ) {
          return Object.freeze({});
        }
        return Object.freeze({
          "Access-Control-Allow-Origin": requestOrigin,
          "Access-Control-Expose-Headers":
            "Accept-Ranges, Content-Length, Content-Range, ETag, X-Foundry-Sha256, X-Foundry-Size-Bytes",
          "Cross-Origin-Resource-Policy": "cross-origin",
          Vary: "Origin",
        });
      },
      openMember: memberGrant.openMember,
    },
  };
}

describe("local Foundry SOG candidate HTTP gateway", () => {
  it("requires loopback token and one exact allowlisted consumer origin", async () => {
    const fixture = await makeGateway();
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      localSogCandidateTestHooks: {
        preparedGateway: fixture.preparedGateway,
      },
    });
    apps.push(app);
    const token = encodeURIComponent(tokenFor(app));
    const path = `/api/local-sog-candidate?token=${token}`;

    expect((await request(app, { path: "/api/local-sog-candidate" })).status).toBe(401);
    expect((await request(app, {
      path,
      headers: { Origin: "http://127.0.0.1:55980" },
    })).status).toBe(403);
    expect((await request(app, {
      path,
      headers: { Host: "attacker.example" },
    })).status).toBe(421);

    const allowed = await request(app, {
      path,
      headers: { Origin: "http://127.0.0.1:55979" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:55979",
    );
    expect(allowed.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(allowed.headers["cache-control"]).toContain("no-store");
    expect(allowed.headers.location).toBeUndefined();
    const descriptor = JSON.parse(allowed.body.toString("utf8")) as LocalSogCandidateDescriptorV0;
    expect(descriptor.runtimeRegistration).toBe("not_registered");
    expect(descriptor.tiers[0].members[0]?.url).toMatch(
      new RegExp(`^${app.origin.replaceAll(".", "\\.")}/api/local-sog-candidate/members/desktop-0\\.sog\\?token=`, "u"),
    );
    expect(allowed.body.toString("utf8")).not.toContain(fixture.sourceRoot);
  });

  it("streams only granted bytes with exact full/range headers and no redirects", async () => {
    const fixture = await makeGateway();
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      localSogCandidateTestHooks: {
        preparedGateway: fixture.preparedGateway,
      },
    });
    apps.push(app);
    const token = encodeURIComponent(tokenFor(app));
    const path = `/api/local-sog-candidate/members/desktop-0.sog?token=${token}`;
    const headers = { Origin: "http://127.0.0.1:55979" };

    const extensionless = await request(app, {
      path: `/api/local-sog-candidate/members/desktop-0?token=${token}`,
      headers,
    });
    expect(extensionless.status).toBe(403);

    const full = await request(app, { path, headers });
    expect(full.status).toBe(200);
    expect(full.body).toEqual(fixture.firstBytes);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["x-foundry-sha256"]).toBe(sha256(fixture.firstBytes));
    expect(full.headers["x-foundry-size-bytes"]).toBe(
      String(fixture.firstBytes.length),
    );
    expect(full.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(full.headers.etag).toBe(`"${sha256(fixture.firstBytes)}"`);
    expect(full.headers.location).toBeUndefined();

    const partial = await request(app, {
      path,
      headers: { ...headers, Range: "bytes=2-6" },
    });
    expect(partial.status).toBe(206);
    expect(partial.body).toEqual(fixture.firstBytes.subarray(2, 7));
    expect(partial.headers["content-range"]).toBe(
      `bytes 2-6/${String(fixture.firstBytes.length)}`,
    );
    expect(partial.headers["content-length"]).toBe("5");

    const invalidRange = await request(app, {
      path,
      headers: { ...headers, Range: "bytes=0-1,4-5" },
    });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers["content-range"]).toBe(
      `bytes */${String(fixture.firstBytes.length)}`,
    );
    expect(invalidRange.headers.location).toBeUndefined();
  });

  it("permits only a token-bound GET preflight from the allowlisted origin", async () => {
    const fixture = await makeGateway();
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      localSogCandidateTestHooks: {
        preparedGateway: fixture.preparedGateway,
      },
    });
    apps.push(app);
    const token = encodeURIComponent(tokenFor(app));
    const path = `/api/local-sog-candidate/members/desktop-0.sog?token=${token}`;
    const allowed = await request(app, {
      method: "OPTIONS",
      path,
      headers: {
        Origin: "http://127.0.0.1:55979",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Range",
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:55979",
    );
    expect(allowed.headers["access-control-allow-methods"]).toBe("GET");
    expect(allowed.headers["access-control-allow-headers"]).toBe("Range");

    const rejected = await request(app, {
      method: "OPTIONS",
      path,
      headers: {
        Origin: "http://127.0.0.1:55979",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(rejected.status).toBe(403);
  });
});
