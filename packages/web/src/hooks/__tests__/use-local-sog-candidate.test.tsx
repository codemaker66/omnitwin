import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalSogCandidateRequest } from "../../lib/local-sog-candidate.js";
import {
  useLocalSogCandidate,
  type LocalSogCandidateLoadState,
} from "../use-local-sog-candidate.js";

const TOKEN = "t".repeat(43);

function descriptorUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}/api/local-sog-candidate?token=${TOKEN}`;
}

function candidate(origin: string): Record<string, unknown> {
  const member = (
    memberId: string,
    relativePath: string,
    sha256: string,
    sizeBytes: number,
    splatCount: number,
  ) => ({
    memberId,
    relativePath,
    sha256,
    sizeBytes,
    splatCount,
    url: `${origin}/api/local-sog-candidate/members/${memberId}.sog?token=${TOKEN}`,
  });
  return {
    schemaVersion: "omnitwin.local-foundry.sog-candidate-descriptor.v0",
    candidateId: "grand-hall-small-lcc2-8539a478-v1",
    candidateRevision: 1,
    candidateDigest: "sha256:1a2303e1d3c850d85e078edf966f3b10c9e06d7a8134403302a18e78f7a45b00",
    runtimeRegistration: "not_registered",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    usage: "appearance_only",
    labels: {
      title: "Grand Hall — captured visual candidate",
      source: "XGRIDS PortalCam · Grand Hall Small",
      status: "Owner-authorized Venviewer use · unreviewed visual only",
      caveat: "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.",
    },
    source: {
      kind: "xgrids_lcc2_sog",
      manifestSha256: "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d",
      frontierReceiptSha256: "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1",
      lcc2Guid: "8539a47831505d8b5c0891353d7f05d1",
      pathExposed: false,
      inventory: {
        sog: { count: 19 }, meshPly: { count: 14 }, bvh: { count: 14 }, obj: { count: 1 }, poses: { count: 2_894 },
      },
    },
    rights: {
      basis: "customer_owned",
      evidenceState: "operator_supplied_unverified",
      evidenceReference: "user-attestation:2026-08-19",
      attestationStatement: "The operator attests that the customer owns all supplied venue data and derivatives, whether commissioned, created, or captured by the customer, and authorizes their use for all Venviewer product purposes, including internal development, customer-facing experiences, derived assets, model-assisted reconstruction, publication, and distribution.",
      attestationSha256: "sha256:e8659e0c6e757a5bfd167b3b2abfa4ae729a44f5249fefe2cfcb0497d3d2c2cb",
      scope: "all_venviewer_product_purposes",
      licensedUse: "authorized_for_all_venviewer_product_purposes",
      publicationAndDistributionRights: "owner_authorized",
      licensingBlocker: false,
      runtimeActivation: "technically_inactive_pending_alignment_qa_and_promotion",
    },
    authority: {
      appearance: "local_unreviewed_candidate",
      geometry: "none", placement: "none", measurement: "none", collision: "none", export: "none",
    },
    transform: {
      state: "unreviewed_visual_only",
      sourceFrame: "xgrids_lcc2_local",
      targetFrame: null,
      units: "not_established",
      matrix: null,
    },
    presentationTransform: {
      state: "unreviewed_visual_only",
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 1,
      notTransformArtifactV0: true,
      note: "Presentation framing only; not ARF→CVF or CVF→RRF registration.",
    },
    presentationCamera: {
      state: "unreviewed_visual_only",
      position: [-8, 2, 8], target: [-8, 2, 0], fov: 65,
      controls: "bounded_orbit", notTransformArtifactV0: true,
    },
    availableEvidence: {
      inventory: {
        state: "bounded_inventory_observation",
        fileCount: 52,
        totalBytes: 182_313_418,
        sogFiles: 19,
        meshPlyFiles: 14,
        btreeFiles: 14,
        objFiles: 1,
        poseFiles: 1,
        poseCount: 2_894,
        otherFiles: 3,
      },
      delivery: {
        streamableFormat: "sog",
        streamableMemberCount: 7,
        selectedTiers: ["desktop", "mobile"],
        unstreamedEvidence: [
          "other_sog_alternatives",
          "mesh_ply",
          "btree",
          "obj",
          "poses",
          "manifest_report_thumbnail",
        ],
      },
      operationalAuthority: "none",
    },
    tiers: [
      {
        id: "desktop", memberCount: 4, splatCount: 2_482_968, sizeBytes: 44_988_345,
        members: [
          member("desktop-0", "lcc2-result/data/3dgs/0_1_0_1_0.sog", "sha256:4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c", 11_522_216, 643_263),
          member("desktop-1", "lcc2-result/data/3dgs/0_3_0_1_0.sog", "sha256:ee8785d1639e23917e7755c127c5fa67b3c575ea26934a8282594ec0831e567b", 11_656_582, 649_182),
          member("desktop-2", "lcc2-result/data/3dgs/0_5_0_0_1.sog", "sha256:dab77f8d9c0e55d659cb293fbc35392058b6810564e9b839d0e594460794e751", 11_246_512, 615_820),
          member("desktop-3", "lcc2-result/data/3dgs/0_7_0_1_0.sog", "sha256:b51f3ac35985e464ae09bd9c169d224b08a3be5052919971cc0ccfb2c9178c04", 10_563_035, 574_703),
        ],
      },
      {
        id: "mobile", memberCount: 3, splatCount: 1_240_774, sizeBytes: 24_441_495,
        members: [
          member("mobile-0", "lcc2-result/data/3dgs/0_3_0_0.sog", "sha256:1f49fe1bd35f4e9d4207680ac9303d5ade56219c04eb0bc64451e514e4c55d7f", 10_356_300, 563_937),
          member("mobile-1", "lcc2-result/data/3dgs/0_6_0_0.sog", "sha256:8890d03b096bd1489fb113daddfa175f653824be4cc1bafdef11925fc51e3786", 9_841_081, 525_405),
          member("mobile-2", "lcc2-result/data/3dgs/0_7_0_0.sog", "sha256:1df5d7758af4dfb0a155e16799c8915ae850de342354d203ee7284cb17c4c75c", 4_244_114, 151_432),
        ],
      },
    ],
    capabilities: { publication: false, export: false, measurement: false, activation: false },
  };
}

function responseFor(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: (value) => {
      if (resolvePromise === null) throw new Error("Deferred promise was not initialized.");
      resolvePromise(value);
    },
  };
}

function requireReady(state: LocalSogCandidateLoadState): Extract<LocalSogCandidateLoadState, { status: "ready" }> {
  if (state.status !== "ready") throw new Error("Local candidate did not become ready.");
  return state;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useLocalSogCandidate", () => {
  it("stays inactive without an explicit candidate and never fetches", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLocalSogCandidate({ kind: "none" }, 1_440));

    expect(result.current.status).toBe("inactive");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the previous request and suppresses a stale response after descriptor identity changes", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const firstUrl = descriptorUrl(43127);
    const secondUrl = descriptorUrl(43128);
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.cache).toBe("no-store");
        expect(init?.credentials).toBe("omit");
        expect(init?.redirect).toBe("error");
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const initialRequest: LocalSogCandidateRequest = { kind: "ready", descriptorUrl: firstUrl };
    const nextRequest: LocalSogCandidateRequest = { kind: "ready", descriptorUrl: secondUrl };

    const { result, rerender } = renderHook(
      ({ request }) => useLocalSogCandidate(request, 1_440),
      { initialProps: { request: initialRequest } },
    );
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;

    rerender({ request: nextRequest });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2); });
    expect(firstSignal?.aborted).toBe(true);

    first.resolve(responseFor(candidate("http://127.0.0.1:43127")));
    second.resolve(responseFor(candidate("http://127.0.0.1:43128")));

    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    if (result.current.status !== "ready") throw new Error("Candidate did not become ready.");
    expect(result.current.selection.members[0]?.url).toContain("127.0.0.1:43128");
  });

  it("switches desktop to mobile without refetching and keeps member identity stable across an explicit reload", async () => {
    const url = descriptorUrl(43127);
    const body = candidate("http://127.0.0.1:43127");
    const fetchMock = vi.fn(() => Promise.resolve(responseFor(body)));
    vi.stubGlobal("fetch", fetchMock);
    const request: LocalSogCandidateRequest = { kind: "ready", descriptorUrl: url };

    const { result, rerender } = renderHook(
      ({ viewportWidth }) => useLocalSogCandidate(request, viewportWidth),
      { initialProps: { viewportWidth: 1_440 } },
    );
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const desktopResult = requireReady(result.current);
    const desktopIdentity = desktopResult.selection.members[0]?.identity;
    const desktopKey = desktopResult.selection.selectionKey;

    rerender({ viewportWidth: 800 });
    const mobileResult = requireReady(result.current);
    expect(mobileResult.selection.tier.id).toBe("mobile");
    expect(mobileResult.selection.selectionKey).not.toBe(desktopKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ viewportWidth: 1_440 });
    const restoredDesktopResult = requireReady(result.current);
    act(() => { restoredDesktopResult.retry(); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(requireReady(result.current).selection.members[0]?.identity).toBe(desktopIdentity);
  });

  it("surfaces a retryable descriptor failure without returning stale members", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    const request: LocalSogCandidateRequest = { kind: "ready", descriptorUrl: descriptorUrl(43127) };

    const { result } = renderHook(() => useLocalSogCandidate(request, 1_440));

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    if (result.current.status !== "error") throw new Error("Candidate failure was not surfaced.");
    expect(result.current.retryable).toBe(true);
    expect(result.current.message).toMatch(/503/);
    expect("selection" in result.current).toBe(false);
  });

  it("rejects an oversized descriptor before attempting to parse its JSON", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String((256 * 1024) + 1),
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const request: LocalSogCandidateRequest = { kind: "ready", descriptorUrl: descriptorUrl(43127) };

    const { result } = renderHook(() => useLocalSogCandidate(request, 1_440));

    await waitFor(() => { expect(result.current.status).toBe("error"); });
    if (result.current.status !== "error") throw new Error("Oversized descriptor failure was not surfaced.");
    expect(result.current.message).toMatch(/256 KiB safety limit/i);
    expect(result.current.message).not.toMatch(/invalid JSON/i);
  });
});
