import {
  GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES,
  GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT,
  GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES,
  type RuntimePackagePreview,
} from "@omnitwin/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "../../config/env.js";
import {
  EXACT_GRAND_HALL_LOAD_DEADLINE_MS,
  beginExactGrandHallLoadDeadline,
} from "../../lib/exact-grand-hall-load-deadline.js";
import {
  RuntimePackagePreviewTransportError,
  fetchRuntimePackagePreviewMetadata,
  fetchVerifiedRuntimePackagePreview,
  fetchVerifiedRuntimePackagePreviewMember,
  sha256Hex,
  type RuntimePackagePreviewTransportDependencies,
} from "../runtime-package-preview-transport.js";

const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
] as const;
const FILES = ["grand-hall-0.sog", "grand-hall-1.sog"] as const;
const HASHES = ["1".repeat(64), "2".repeat(64)] as const;
const BODIES = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])] as const;

afterEach(() => {
  vi.useRealTimers();
});

function apiUrl(path: string): string {
  return new URL(`${API_URL.replace(/\/+$/u, "")}${path}`).href;
}

function metadataUrl(runtimePackageId = PACKAGE_ID): string {
  return apiUrl(`/admin/assets/runtime-package-previews/${runtimePackageId}`);
}

function memberUrl(index: number): string {
  const assetVersionId = ASSET_IDS[index];
  const fileName = FILES[index];
  if (assetVersionId === undefined || fileName === undefined) {
    throw new Error("Fixture member missing");
  }
  return `${metadataUrl()}/assets/${assetVersionId}/${fileName}`;
}

function previewFixture(): RuntimePackagePreview {
  return {
    scope: "exact_private_runtime_package_preview",
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: "a".repeat(64),
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_IDS[0],
        visualAssetVersionIds: [...ASSET_IDS],
        visualAssetReceipts: ASSET_IDS.map((assetVersionId, index) => ({
          assetVersionId,
          fileName: FILES[index] ?? "missing.sog",
          fileExt: ".sog" as const,
          sha256: HASHES[index] ?? "0".repeat(64),
          sizeBytes: BODIES[index]?.byteLength ?? 1,
          storageKeySha256: String(index + 3).repeat(64),
        })),
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    reviewedProfileId: null,
    issuedAt: "2026-08-21T12:00:00.000Z",
    visualAssets: ASSET_IDS.map((assetVersionId, index) => ({
      assetVersionId,
      fileName: FILES[index] ?? "missing.sog",
      fileExt: ".sog" as const,
      sha256: HASHES[index] ?? "0".repeat(64),
      sizeBytes: BODIES[index]?.byteLength ?? 1,
    })),
  };
}

function syntheticGrandHallPreviewFixture(
  memberCount: number,
  memberBytes: number,
): RuntimePackagePreview {
  const preview = previewFixture();
  const visualAssets = Array.from({ length: memberCount }, (_, index) => ({
    assetVersionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    fileName: `grand-hall-${String(index)}.sog`,
    fileExt: ".sog" as const,
    sha256: index.toString(16).padStart(64, "0"),
    sizeBytes: memberBytes,
  }));
  const visualAssetReceipts = visualAssets.map((member, index) => ({
    ...member,
    storageKeySha256: (index + 1).toString(16).padStart(2, "0").repeat(32),
  }));
  const primaryVisualAssetVersionId = visualAssets[0]?.assetVersionId;
  if (primaryVisualAssetVersionId === undefined) throw new Error("Expected a primary member.");
  return {
    ...preview,
    manifestJson: {
      ...preview.manifestJson,
      assets: {
        ...preview.manifestJson.assets,
        primaryVisualAssetVersionId,
        visualAssetVersionIds: visualAssets.map((member) => member.assetVersionId),
        visualAssetReceipts,
      },
    },
    visualAssets,
  };
}

function routeResponse(
  body: string | ArrayBuffer | null,
  init: ResponseInit,
  url: string,
  redirected = false,
): Response {
  const response = new Response(body, init);
  Object.defineProperties(response, {
    redirected: { configurable: true, value: redirected },
    url: { configurable: true, value: url },
  });
  return response;
}

function metadataResponse(
  payload: unknown = { data: previewFixture() },
  headerOverrides: Readonly<Record<string, string>> = {},
  url = metadataUrl(),
): Response {
  const body = JSON.stringify(payload);
  const size = new TextEncoder().encode(body).byteLength;
  return routeResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(size),
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      vary: "Origin, Authorization",
      ...headerOverrides,
    },
  }, url);
}

function memberResponse(
  index: number,
  headerOverrides: Readonly<Record<string, string>> = {},
  bytes: Uint8Array = BODIES[index] ?? new Uint8Array([0]),
  url = memberUrl(index),
): Response {
  const member = previewFixture().visualAssets[index];
  if (member === undefined) throw new Error("Fixture member missing");
  const body = bytes.slice().buffer;
  return routeResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(member.sizeBytes),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(member.fileName)}`,
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      vary: "Origin, Authorization",
      "x-content-sha256": member.sha256,
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-site",
      ...headerOverrides,
    },
  }, url);
}

function dependencies(
  fetchMock: typeof globalThis.fetch,
  digest: RuntimePackagePreviewTransportDependencies["digest"] = vi.fn().mockResolvedValue(HASHES[0]),
): RuntimePackagePreviewTransportDependencies {
  return {
    fetch: fetchMock,
    getAuthToken: vi.fn().mockResolvedValue("session-token"),
    digest,
  };
}

describe("runtime package preview transport", () => {
  it("computes the complete browser SHA-256 digest as lowercase hex", async () => {
    const encoded = new TextEncoder().encode("abc");
    expect(await sha256Hex(encoded.buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("fetches strict authenticated metadata only from the configured API route", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metadataResponse());
    const controller = new AbortController();

    const preview = await fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      controller.signal,
      dependencies(fetchMock),
    );

    expect(preview.runtimePackageId).toBe(PACKAGE_ID);
    expect(preview.visualAssets.map((member) => member.fileName)).toEqual(FILES);
    expect(fetchMock).toHaveBeenCalledWith(metadataUrl(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer session-token",
      },
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal,
    });
  });

  it("rejects an exact Grand Hall inventory above the shared atomic browser limit", async () => {
    const preview = syntheticGrandHallPreviewFixture(
      9,
      GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES,
    );
    expect(preview.visualAssets.every((member) =>
      member.sizeBytes <= GRAND_HALL_ROOM_ONLY_MAX_MEMBER_BYTES)).toBe(true);
    expect(preview.visualAssets.reduce(
      (total, member) => total + member.sizeBytes,
      0,
    )).toBeGreaterThan(GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      metadataResponse({ data: preview }),
    );

    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      new AbortController().signal,
      dependencies(fetchMock),
    )).rejects.toMatchObject({ code: "RESPONSE_SCHEMA_INVALID" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects exact Grand Hall member fan-out beyond the sequential loader limit", async () => {
    const preview = syntheticGrandHallPreviewFixture(
      GRAND_HALL_ROOM_ONLY_MAX_MEMBER_COUNT + 1,
      1,
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      metadataResponse({ data: preview }),
    );

    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      new AbortController().signal,
      dependencies(fetchMock),
    )).rejects.toMatchObject({ code: "RESPONSE_SCHEMA_INVALID" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["content-type", "application/problem+json"],
    ["content-length", "999"],
    ["cache-control", "public, max-age=60"],
    ["pragma", "cache"],
    ["vary", "Origin"],
  ])("rejects mismatched metadata %s", async (name, value) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      metadataResponse(undefined, { [name]: value }),
    );
    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      new AbortController().signal,
      dependencies(fetchMock),
    )).rejects.toMatchObject({ code: name === "content-length" ? "SIZE_MISMATCH" : "HEADER_MISMATCH" });
  });

  it.each(["externalUrl", "basename"])("rejects an injected %s metadata field", async (field) => {
    const preview = previewFixture();
    const first = preview.visualAssets[0];
    if (first === undefined) throw new Error("Fixture member missing");
    const payload = {
      data: {
        ...preview,
        visualAssets: [{ ...first, [field]: "https://untrusted.example/member.sog" }, ...preview.visualAssets.slice(1)],
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metadataResponse(payload));
    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      new AbortController().signal,
      dependencies(fetchMock),
    )).rejects.toMatchObject({ code: "RESPONSE_SCHEMA_INVALID" });
  });

  it("rejects a substituted package identity and a reordered composition", async () => {
    const wrongIdentity = previewFixture();
    const reordered = previewFixture();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(metadataResponse({
        data: { ...wrongIdentity, runtimePackageId: "20000000-0000-4000-8000-000000000002" },
      }))
      .mockResolvedValueOnce(metadataResponse({
        data: { ...reordered, visualAssets: [...reordered.visualAssets].reverse() },
      }));
    const deps = dependencies(fetchMock);

    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      new AbortController().signal,
      deps,
    )).rejects.toMatchObject({ code: "PACKAGE_MISMATCH" });
    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      new AbortController().signal,
      deps,
    )).rejects.toMatchObject({ code: "RESPONSE_SCHEMA_INVALID" });
  });

  it("verifies every exact member header, body length, and digest before returning bytes", async () => {
    const preview = previewFixture();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(memberResponse(0));
    const digest = vi.fn().mockResolvedValue(HASHES[0]);
    const controller = new AbortController();

    const result = await fetchVerifiedRuntimePackagePreviewMember(
      preview,
      0,
      controller.signal,
      dependencies(fetchMock, digest),
    );

    expect(result.fileName).toBe(FILES[0]);
    expect(new Uint8Array(result.bytes)).toEqual(BODIES[0]);
    expect(digest).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(memberUrl(0), expect.objectContaining({
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream",
        Authorization: "Bearer session-token",
      },
    }));
  });

  it.each([
    ["content-type", "model/vnd.sog"],
    ["content-length", "4"],
    ["content-disposition", "inline; filename*=UTF-8''substitute.sog"],
    ["cache-control", "public"],
    ["pragma", "cache"],
    ["vary", "Authorization"],
    ["x-content-sha256", "0".repeat(64)],
    ["x-content-type-options", "none"],
    ["cross-origin-resource-policy", "cross-origin"],
  ])("rejects mismatched member %s before reading or hashing", async (name, value) => {
    const digest = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(memberResponse(0, { [name]: value }));
    await expect(fetchVerifiedRuntimePackagePreviewMember(
      previewFixture(),
      0,
      new AbortController().signal,
      dependencies(fetchMock, digest),
    )).rejects.toMatchObject({ code: "HEADER_MISMATCH" });
    expect(digest).not.toHaveBeenCalled();
  });

  it("rejects a body-size mismatch and a recomputed digest mismatch", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(memberResponse(0, {}, new Uint8Array([1, 2])))
      .mockResolvedValueOnce(memberResponse(0));
    const digest = vi.fn().mockResolvedValue("0".repeat(64));
    const deps = dependencies(fetchMock, digest);

    await expect(fetchVerifiedRuntimePackagePreviewMember(
      previewFixture(), 0, new AbortController().signal, deps,
    )).rejects.toMatchObject({ code: "SIZE_MISMATCH" });
    expect(digest).not.toHaveBeenCalled();

    await expect(fetchVerifiedRuntimePackagePreviewMember(
      previewFixture(), 0, new AbortController().signal, deps,
    )).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });

  it("rejects an invalid member index and mutated preview before authentication", async () => {
    const preview = previewFixture();
    const member = preview.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const getAuthToken = vi.fn().mockResolvedValue("session-token");
    const deps: RuntimePackagePreviewTransportDependencies = {
      fetch: vi.fn<typeof fetch>(),
      getAuthToken,
      digest: vi.fn(),
    };

    await expect(fetchVerifiedRuntimePackagePreviewMember(
      preview, 99, new AbortController().signal, deps,
    )).rejects.toMatchObject({ code: "MEMBER_MISMATCH" });
    await expect(fetchVerifiedRuntimePackagePreviewMember(
      { ...preview, visualAssets: [{ ...member, sha256: "0".repeat(64) }, ...preview.visualAssets.slice(1)] },
      0,
      new AbortController().signal,
      deps,
    )).rejects.toMatchObject({ code: "MEMBER_MISMATCH" });
    expect(getAuthToken).not.toHaveBeenCalled();
  });

  it("rejects a substituted or redirected response URL", async () => {
    const substituted = metadataResponse(undefined, {}, "https://untrusted.example/preview");
    const redirected = metadataResponse();
    Object.defineProperty(redirected, "redirected", { configurable: true, value: true });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(substituted)
      .mockResolvedValueOnce(redirected);
    const deps = dependencies(fetchMock);

    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID, new AbortController().signal, deps,
    )).rejects.toMatchObject({ code: "RESPONSE_URL_MISMATCH" });
    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID, new AbortController().signal, deps,
    )).rejects.toMatchObject({ code: "RESPONSE_URL_MISMATCH" });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: "error" }));
  });

  it("fetches all members sequentially with one token and preserves declared order", async () => {
    const events: string[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      events.push(`fetch:${url}`);
      if (url === metadataUrl()) return Promise.resolve(metadataResponse());
      if (url === memberUrl(0)) return Promise.resolve(memberResponse(0));
      if (url === memberUrl(1)) return Promise.resolve(memberResponse(1));
      return Promise.reject(new Error("Unexpected URL"));
    });
    const digest = vi.fn()
      .mockImplementationOnce(() => { events.push("digest:0"); return Promise.resolve(HASHES[0]); })
      .mockImplementationOnce(() => { events.push("digest:1"); return Promise.resolve(HASHES[1]); });
    const getAuthToken = vi.fn().mockResolvedValue("session-token");

    const result = await fetchVerifiedRuntimePackagePreview(
      PACKAGE_ID,
      new AbortController().signal,
      { fetch: fetchMock, getAuthToken, digest },
    );

    expect(result.members.map((member) => member.fileName)).toEqual(FILES);
    expect(getAuthToken).toHaveBeenCalledOnce();
    expect(events).toEqual([
      `fetch:${metadataUrl()}`,
      `fetch:${memberUrl(0)}`,
      "digest:0",
      `fetch:${memberUrl(1)}`,
      "digest:1",
    ]);
  });

  it("cancels between sequential members without issuing the next request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(memberResponse(0));
    const digest = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve(HASHES[0]);
    });

    await expect(fetchVerifiedRuntimePackagePreview(
      PACKAGE_ID,
      controller.signal,
      dependencies(fetchMock, digest),
    )).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects missing auth, HTTP failures, network errors, invalid input, and cancellation", async () => {
    const signal = new AbortController().signal;
    const noAuth: RuntimePackagePreviewTransportDependencies = {
      fetch: vi.fn<typeof fetch>(),
      getAuthToken: vi.fn().mockResolvedValue(null),
      digest: vi.fn(),
    };
    await expect(fetchRuntimePackagePreviewMetadata(PACKAGE_ID, signal, noAuth))
      .rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });

    const unavailable = routeResponse(null, { status: 503 }, metadataUrl());
    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      signal,
      dependencies(vi.fn<typeof fetch>().mockResolvedValue(unavailable)),
    )).rejects.toMatchObject({ code: "HTTP_UNAVAILABLE", status: 503 });

    await expect(fetchRuntimePackagePreviewMetadata(
      PACKAGE_ID,
      signal,
      dependencies(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))),
    )).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    await expect(fetchRuntimePackagePreviewMetadata(
      "not-a-uuid",
      signal,
      dependencies(vi.fn<typeof fetch>()),
    )).rejects.toMatchObject({ code: "INPUT_INVALID" });

    const controller = new AbortController();
    controller.abort();
    const aborted = fetchRuntimePackagePreviewMetadata(PACKAGE_ID, controller.signal, noAuth);
    await expect(aborted).rejects.toBeInstanceOf(RuntimePackagePreviewTransportError);
    await expect(aborted).rejects.toMatchObject({ code: "ABORTED" });
  });
});

describe("exact Grand Hall whole-load transport deadline", () => {
  it("uses one bounded ten-minute clock for the complete package", () => {
    expect(EXACT_GRAND_HALL_LOAD_DEADLINE_MS).toBe(600_000);
  });

  it.each(["token", "fetch", "body", "digest"] as const)(
    "aborts a stalled %s phase without starting later transport work",
    async (phase) => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<typeof fetch>();
      const digest = vi.fn<RuntimePackagePreviewTransportDependencies["digest"]>();
      const getAuthToken = vi.fn<RuntimePackagePreviewTransportDependencies["getAuthToken"]>();
      getAuthToken.mockImplementation(() => phase === "token"
        ? new Promise<string | null>(() => undefined)
        : Promise.resolve("session-token"));
      if (phase === "fetch") {
        fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
      } else if (phase === "body") {
        const response = metadataResponse();
        vi.spyOn(response, "arrayBuffer").mockImplementation(
          () => new Promise<ArrayBuffer>(() => undefined),
        );
        fetchMock.mockResolvedValue(response);
      } else if (phase === "digest") {
        fetchMock.mockResolvedValue(memberResponse(0));
        digest.mockImplementation(() => new Promise<string>(() => undefined));
      }

      const onTimeout = vi.fn();
      const deadline = beginExactGrandHallLoadDeadline(onTimeout);
      const operation = phase === "digest"
        ? fetchVerifiedRuntimePackagePreviewMember(
            previewFixture(),
            0,
            deadline.signal,
            { fetch: fetchMock, getAuthToken, digest },
          )
        : fetchRuntimePackagePreviewMetadata(
            PACKAGE_ID,
            deadline.signal,
            { fetch: fetchMock, getAuthToken, digest },
          );

      const rejection = expect(operation).rejects.toMatchObject({ code: "ABORTED" });
      await vi.advanceTimersByTimeAsync(EXACT_GRAND_HALL_LOAD_DEADLINE_MS);
      await rejection;
      expect(onTimeout).toHaveBeenCalledOnce();
      expect(deadline.signal.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(phase === "token" ? 0 : 1);
      expect(digest).toHaveBeenCalledTimes(phase === "digest" ? 1 : 0);
    },
  );
});
