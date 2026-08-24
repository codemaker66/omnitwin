import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalGrandHallEvidenceRequest } from "../../lib/local-grand-hall-evidence.js";

const { parseDescriptorMock, verifyDescriptorMock } = vi.hoisted(() => ({
  parseDescriptorMock: vi.fn(),
  verifyDescriptorMock: vi.fn(),
}));

vi.mock("../../lib/local-grand-hall-evidence.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/local-grand-hall-evidence.js")>();
  return {
    ...actual,
    parseLocalGrandHallEvidenceDescriptor: parseDescriptorMock,
    verifyLocalGrandHallPresentationManifest: verifyDescriptorMock,
  };
});

import { useLocalGrandHallEvidence } from "../use-local-grand-hall-evidence.js";

const TOKEN = "t".repeat(43);

function descriptorUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}/api/local-room-evidence-candidate?token=${TOKEN}`;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolver: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolver === null) throw new Error("Deferred resolver is unavailable.");
      resolver(value);
    },
  };
}

function responseFor(id: string): Response {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  parseDescriptorMock.mockReset();
  verifyDescriptorMock.mockReset();
});

describe("useLocalGrandHallEvidence", () => {
  it("does not fetch unless the operator supplied an explicit master-evidence grant", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useLocalGrandHallEvidence({ kind: "none" }),
    );

    expect(result.current.status).toBe("inactive");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the prior descriptor and suppresses its stale result after identity changes", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const firstUrl = descriptorUrl(43127);
    const secondUrl = descriptorUrl(43128);
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    parseDescriptorMock.mockImplementation((value: { readonly id: string }) => ({
      candidateId: value.id,
    }));
    verifyDescriptorMock.mockResolvedValue(undefined);
    const initialRequest: LocalGrandHallEvidenceRequest = {
      kind: "ready",
      descriptorUrl: firstUrl,
    };
    const nextRequest: LocalGrandHallEvidenceRequest = {
      kind: "ready",
      descriptorUrl: secondUrl,
    };

    const { result, rerender } = renderHook(
      ({ request }) => useLocalGrandHallEvidence(request),
      { initialProps: { request: initialRequest } },
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;

    rerender({ request: nextRequest });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(firstSignal?.aborted).toBe(true);

    first.resolve(responseFor("stale"));
    second.resolve(responseFor("current"));

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    if (result.current.status !== "ready") {
      throw new Error("The current evidence descriptor did not become ready.");
    }
    expect(result.current.candidate.candidateId).toBe("current");
    expect(parseDescriptorMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an oversized body before JSON parsing and keeps errors free of grant URLs", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String((512 * 1024) + 1),
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const request: LocalGrandHallEvidenceRequest = {
      kind: "ready",
      descriptorUrl: descriptorUrl(43127),
    };

    const { result } = renderHook(() => useLocalGrandHallEvidence(request));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    if (result.current.status !== "error") {
      throw new Error("The oversized descriptor was not rejected.");
    }
    expect(result.current.message).toMatch(/512 KiB safety limit/i);
    expect(result.current.message).not.toMatch(/token=|127\.0\.0\.1/iu);
    expect(parseDescriptorMock).not.toHaveBeenCalled();
  });
});
