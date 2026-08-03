import { describe, expect, it, vi } from "vitest";
import {
  HistoricalRuntimeAssetError,
  fetchVerifiedHistoricalRuntimeAsset,
  sha256Hex,
} from "../historical-runtime-assets.js";
import { API_URL } from "../../config/env.js";
import { historicalRuntimeBindingFixture } from "../../test-utils/historical-runtime-binding.js";

function verifiedHeaders(binding = historicalRuntimeBindingFixture()): Record<string, string> {
  const member = binding.visualAssets[0];
  if (member === undefined || member.mimeType === null) throw new Error("Fixture member missing");
  return {
    "content-type": member.mimeType,
    "content-length": String(member.sizeBytes),
    "cache-control": "private, no-store",
    "x-content-sha256": member.sha256,
    "x-runtime-binding-digest": binding.bindingDigest,
    "x-runtime-package-content-digest": binding.runtimePackageContentDigest,
    "x-asset-version-id": member.assetVersionId,
  };
}

function response(
  binding = historicalRuntimeBindingFixture({ sizeBytes: 3 }),
  headerOverrides: Readonly<Record<string, string>> = {},
  bytes = new Uint8Array([1, 2, 3]),
): Response {
  return new Response(bytes, {
    status: 200,
    headers: { ...verifiedHeaders(binding), ...headerOverrides },
  });
}

describe("fetchVerifiedHistoricalRuntimeAsset", () => {
  it("computes the complete browser SHA-256 digest as lowercase hex", async () => {
    const encoded = new TextEncoder().encode("abc");
    expect(await sha256Hex(encoded.buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("authenticates the exact route, headers, length, and SHA before returning bytes", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(binding));
    const digest = vi.fn().mockResolvedValue(member.sha256);
    const controller = new AbortController();

    const result = await fetchVerifiedHistoricalRuntimeAsset(binding, member, controller.signal, {
      fetch: fetchMock,
      getAuthToken: vi.fn().mockResolvedValue("session-token"),
      digest,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_URL}/calendar/venues/${binding.venueId}/spaces/${binding.spaceId}/runtime-bindings/${binding.bindingId}/members/0/grand-hall.sog`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer session-token" },
      redirect: "error",
      signal: controller.signal,
    }));
    expect(digest).toHaveBeenCalledOnce();
    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([
    ["content-type", "text/plain"],
    ["content-length", "4"],
    ["cache-control", "private, max-age=0"],
    ["x-content-sha256", "0".repeat(64)],
    ["x-runtime-binding-digest", "0".repeat(64)],
    ["x-runtime-package-content-digest", "0".repeat(64)],
    ["x-asset-version-id", "00000000-0000-4000-8000-000000000000"],
  ])("rejects a mismatched %s header before hashing", async (name, value) => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const digest = vi.fn();
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response(binding, { [name]: value })),
        getAuthToken: vi.fn().mockResolvedValue("token"),
        digest,
      },
    )).rejects.toMatchObject({ code: "HEADER_MISMATCH" });
    expect(digest).not.toHaveBeenCalled();
  });

  it("rejects missing authentication without issuing a byte request", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const fetchMock = vi.fn<typeof fetch>();
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      {
        fetch: fetchMock,
        getAuthToken: vi.fn().mockResolvedValue(null),
        digest: vi.fn(),
      },
    )).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a member that is not the exact ordered binding member", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      { ...member, sha256: "0".repeat(64) },
      new AbortController().signal,
      { fetch: vi.fn(), getAuthToken: vi.fn(), digest: vi.fn() },
    )).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
  });

  it("rejects a body-length mismatch and a recomputed digest mismatch", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const dependencies = {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(binding, {}, new Uint8Array([1, 2]))),
      getAuthToken: vi.fn().mockResolvedValue("token"),
      digest: vi.fn().mockResolvedValue(member.sha256),
    };
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      dependencies,
    )).rejects.toMatchObject({ code: "SIZE_MISMATCH" });

    dependencies.fetch.mockResolvedValue(response(binding));
    dependencies.digest.mockResolvedValue("0".repeat(64));
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      dependencies,
    )).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });

  it("maps non-200, network, and abort failures without exposing bytes", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const base = {
      getAuthToken: vi.fn().mockResolvedValue("token"),
      digest: vi.fn(),
    };
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      { ...base, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })) },
    )).rejects.toMatchObject({ code: "HTTP_UNAVAILABLE", status: 404 });
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      { ...base, fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")) },
    )).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    const controller = new AbortController();
    controller.abort();
    const aborted = fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      controller.signal,
      { ...base, fetch: vi.fn<typeof fetch>() },
    );
    await expect(aborted).rejects.toBeInstanceOf(HistoricalRuntimeAssetError);
    await expect(aborted).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("rejects redirects instead of forwarding authorization to another origin", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3 });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      new TypeError("Failed to fetch: redirect mode is set to error"),
    );

    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      {
        fetch: fetchMock,
        getAuthToken: vi.fn().mockResolvedValue("token"),
        digest: vi.fn(),
      },
    )).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: "error" }));
  });

  it("fails closed when the descriptor cannot authenticate an exact content type", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 3, mimeType: null });
    const member = binding.visualAssets[0];
    if (member === undefined) throw new Error("Fixture member missing");
    const fetchMock = vi.fn<typeof fetch>();
    await expect(fetchVerifiedHistoricalRuntimeAsset(
      binding,
      member,
      new AbortController().signal,
      { fetch: fetchMock, getAuthToken: vi.fn(), digest: vi.fn() },
    )).rejects.toMatchObject({ code: "HEADER_MISMATCH" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
