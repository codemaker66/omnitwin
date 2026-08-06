import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimePackagePreviewVisualAsset } from "@omnitwin/types";

const tokenGetter = vi.hoisted(() => vi.fn());

vi.mock("../api/auth-bridge.js", () => ({
  getTokenGetter: () => tokenGetter,
}));

import {
  getApprovedRoomRuntimeProfile,
  getLatestRuntimePackage,
  getRuntimePackagePreview,
  openRuntimePackagePreviewAsset,
} from "../api/runtime-packages.js";
import { RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT } from
  "../pages/living-hall/reception-presentation-contract.js";

const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET: RuntimePackagePreviewVisualAsset = {
  assetVersionId: "10000000-0000-4000-8000-000000000001",
  fileName: "0_15_0_0.sog",
  fileExt: ".sog",
  sha256: "a".repeat(64),
  sizeBytes: 4,
};
const APPROVED_URLS = [
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/1/content.sog",
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/2/content.sog",
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/3/content.sog",
] as const;

function approvedProfileBody(extra: Record<string, unknown> = {}): unknown {
  return {
    data: {
      scope: "approved_room_runtime_profile",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      profileId: "quality-sog-fine-v1",
      presentationContract: RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT,
      visualAssetUrls: [...APPROVED_URLS],
      ...extra,
    },
  };
}

function metadataBody(): unknown {
  return {
    data: {
      scope: "exact_private_runtime_package_preview",
      runtimePackageId: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      revision: 7,
      identityKind: "content_sha256",
      contentDigest: "b".repeat(64),
      manifestJson: {
        schemaVersion: "venviewer.runtime-package.v1",
        venueSlug: "trades-hall",
        roomSlug: "reception-room",
        packageType: "room-runtime",
        assets: {
          primaryVisualAssetVersionId: ASSET.assetVersionId,
          visualAssetVersionIds: [ASSET.assetVersionId],
          visualAssetReceipts: [{
            ...ASSET,
            storageKeySha256: "c".repeat(64),
          }],
          semanticMeshAssetVersionId: null,
          collisionAssetVersionId: null,
          pointCloudAssetVersionId: null,
        },
      },
      evidenceStatus: "machine_checked",
      runtimeStatus: "internal_ready",
      reviewedProfileId: "quality-sog-fine-v1",
      issuedAt: "2026-07-14T12:00:00.000Z",
      visualAssets: [ASSET],
    },
  };
}

describe("runtime package API client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    tokenGetter.mockResolvedValue("clerk-admin-token");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    tokenGetter.mockReset();
    vi.unstubAllGlobals();
  });

  it("keeps the retired detailed-package browser resolver on safe fallback without a request", async () => {
    await expect(getLatestRuntimePackage({
      venue: "trades-hall",
      room: "grand-hall",
    })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches only the redacted server-approved room profile for public rendering", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(approvedProfileBody()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const profile = await getApprovedRoomRuntimeProfile({
      venue: "trades-hall",
      room: "reception-room",
    });

    expect(profile).toEqual({
      scope: "approved_room_runtime_profile",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      profileId: "quality-sog-fine-v1",
      presentationContract: RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT,
      visualAssetUrls: [...APPROVED_URLS],
    });
    expect(JSON.stringify(profile)).not.toMatch(
      /manifestJson|runtimePackageId|assetVersionId|sha256|storageKey/iu,
    );
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "http://localhost:3001/assets/runtime-packages/approved-profile" +
        "?venue=trades-hall&room=reception-room",
    );
  });

  it("rejects private package evidence added to the public approved-profile response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(approvedProfileBody({
      manifestJson: { privateReceipt: "must-not-cross-public-boundary" },
    })), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(getApprovedRoomRuntimeProfile({
      venue: "trades-hall",
      room: "reception-room",
    })).rejects.toMatchObject({ code: "RESPONSE_VALIDATION_ERROR" });
  });

  it("fetches exact metadata through the authenticated admin path", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(metadataBody()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const preview = await getRuntimePackagePreview(PACKAGE_ID);
    expect(preview.runtimePackageId).toBe(PACKAGE_ID);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    if (typeof url !== "string") throw new Error("metadata request URL was not a string");
    expect(url).toBe(
      `http://localhost:3001/admin/assets/runtime-package-previews/${PACKAGE_ID}`,
    );
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer clerk-admin-token");
  });

  it("rejects a valid response for a different package id", async () => {
    const body = metadataBody() as { data: { runtimePackageId: string } };
    body.data.runtimePackageId = "20000000-0000-4000-8000-000000000099";
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(getRuntimePackagePreview(PACKAGE_ID)).rejects.toMatchObject({
      code: "RUNTIME_PACKAGE_PREVIEW_IDENTITY_MISMATCH",
    });
  });

  it("opens bytes with the token in a header, never in the URL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        "content-length": String(bytes.byteLength),
        "x-content-sha256": ASSET.sha256,
      },
    }));
    const controller = new AbortController();

    const opened = await openRuntimePackagePreviewAsset(PACKAGE_ID, ASSET, controller.signal);
    expect(opened).toMatchObject({
      sourceId: `${PACKAGE_ID}:${ASSET.assetVersionId}`,
      fileName: ASSET.fileName,
      streamLength: 4,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    if (typeof url !== "string") throw new Error("asset request URL was not a string");
    expect(url).toBe(
      `http://localhost:3001/admin/assets/runtime-package-previews/${PACKAGE_ID}` +
        `/assets/${ASSET.assetVersionId}/${ASSET.fileName}`,
    );
    expect(url).not.toContain("clerk-admin-token");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer clerk-admin-token");
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
  });

  it("fails before fetch when no administrator token is available", async () => {
    tokenGetter.mockResolvedValue(null);
    await expect(
      openRuntimePackagePreviewAsset(PACKAGE_ID, ASSET, new AbortController().signal),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or mismatched Content-Length", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "x-content-sha256": ASSET.sha256 },
    }));
    await expect(
      openRuntimePackagePreviewAsset(PACKAGE_ID, ASSET, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED" });

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-length": "3",
        "x-content-sha256": ASSET.sha256,
      },
    }));
    await expect(
      openRuntimePackagePreviewAsset(PACKAGE_ID, ASSET, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED" });
  });

  it("rejects a missing or mismatched server-verified SHA-256 header", async () => {
    for (const fingerprint of [null, "b".repeat(64)]) {
      const headers = new Headers({ "content-length": "4" });
      if (fingerprint !== null) headers.set("x-content-sha256", fingerprint);
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers,
      }));
      await expect(
        openRuntimePackagePreviewAsset(PACKAGE_ID, ASSET, new AbortController().signal),
      ).rejects.toMatchObject({ code: "RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED" });
    }
  });

  it("passes AbortError through so scene cleanup stays silent", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    const opening = openRuntimePackagePreviewAsset(PACKAGE_ID, ASSET, controller.signal);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
  });
});
