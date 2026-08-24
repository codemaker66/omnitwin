import type { RuntimePackagePreview } from "@omnitwin/types";
import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerifiedRuntimePackagePreview } from "../../../api/runtime-package-preview-transport.js";
import {
  GRAND_HALL_CAPTURED_SOG_MEMBERS,
  GRAND_HALL_CAPTURED_SOURCE,
} from "../../../lib/grand-hall-captured-source.js";
import type { RuntimeAssetViewTransform } from "../../../lib/runtime-package-resolution.js";
import { EXACT_GRAND_HALL_LOAD_DEADLINE_MS } from "../../../lib/exact-grand-hall-load-deadline.js";
import {
  serializeExactGrandHallRuntimeKey,
  type ExactGrandHallRuntimeKey,
} from "../../../stores/cockpit-store.js";

const exactLayerMocks = vi.hoisted(() => ({
  fetchRuntimePackagePreviewMetadata: vi.fn(),
  fetchVerifiedRuntimePackagePreviewMember: vi.fn(),
  invalidate: vi.fn(),
  createdMeshes: [] as unknown[],
  stallMeshInitialization: false,
  sparkRendererHost: vi.fn<(props: { readonly sortRadial?: boolean }) => null>(() => null),
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { readonly invalidate: () => void }) => unknown) => selector({
    invalidate: exactLayerMocks.invalidate,
  }),
}));
vi.mock("../../../api/runtime-package-preview-transport.js", () => ({
  fetchRuntimePackagePreviewMetadata: exactLayerMocks.fetchRuntimePackagePreviewMetadata,
  fetchVerifiedRuntimePackagePreviewMember: exactLayerMocks.fetchVerifiedRuntimePackagePreviewMember,
}));
vi.mock("@sparkjsdev/spark", () => ({
  SplatMesh: class SplatMesh {
    visible = true;
    opacity = 1;
    readonly position = { set: vi.fn() };
    readonly rotation = { set: vi.fn() };
    readonly scale = { setScalar: vi.fn() };
    readonly initialized: Promise<SplatMesh>;
    readonly numSplats: number;
    readonly dispose = vi.fn();

    constructor(options: { readonly maxSplats: number }) {
      this.numSplats = options.maxSplats - 1;
      exactLayerMocks.createdMeshes.push(this);
      this.initialized = exactLayerMocks.stallMeshInitialization
        ? new Promise<SplatMesh>(() => undefined)
        : Promise.resolve(this);
    }
  },
}));
vi.mock("../../scene/SparkSplatLayer.js", () => ({
  SparkRendererHost: exactLayerMocks.sparkRendererHost,
}));

const {
  decodeExactGrandHallResource,
  disposeExactGrandHallResource,
  ExactGrandHallSplatLayer,
} = await import("../ExactGrandHallSplatLayer.js");
type ExactGrandHallMesh = import("../ExactGrandHallSplatLayer.js").ExactGrandHallMesh;

const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const RUNTIME_KEY: ExactGrandHallRuntimeKey = {
  spaceId: "grand-hall-space-a",
  venueId: "trades-hall-venue-a",
  roomSlug: "grand-hall",
  runtimePackageId: PACKAGE_ID,
};
const ASSET_IDS = GRAND_HALL_CAPTURED_SOG_MEMBERS.map((_, index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const TRANSFORM: RuntimeAssetViewTransform = {
  position: [24.5169645, 6.327585, -4.1186185],
  rotation: [-Math.PI / 2, 0, 0],
  scale: 1,
  note: "test source transform",
};

class FakeMesh implements ExactGrandHallMesh {
  visible = true;
  opacity = 1;
  readonly position = { set: vi.fn() };
  readonly rotation = { set: vi.fn() };
  readonly scale = { setScalar: vi.fn() };
  readonly initialized: Promise<ExactGrandHallMesh>;
  readonly dispose = vi.fn();

  constructor(readonly numSplats: number) {
    this.initialized = Promise.resolve(this);
  }
}

function previewFixture(): RuntimePackagePreview {
  const receipts = GRAND_HALL_CAPTURED_SOG_MEMBERS.map((member, index) => ({
    assetVersionId: ASSET_IDS[index] ?? "",
    fileName: member.fileName,
    fileExt: ".sog" as const,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    storageKeySha256: String(index + 1).padStart(2, "0").repeat(32),
  }));
  return {
    scope: "exact_private_runtime_package_preview",
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: "c".repeat(64),
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_IDS[0] ?? "",
        visualAssetVersionIds: ASSET_IDS,
        visualAssetReceipts: receipts,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: GRAND_HALL_CAPTURED_SOURCE.decisionId,
        decisionRef: GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256,
        hierarchySha256: GRAND_HALL_CAPTURED_SOURCE.manifestSha256,
        format: "sog",
        level: "fine",
        lodSelectionPolicy: GRAND_HALL_CAPTURED_SOURCE.lodSelectionPolicy,
        expectedGaussianCount: GRAND_HALL_CAPTURED_SOURCE.gaussianCount,
      },
    },
    evidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    reviewedProfileId: null,
    issuedAt: "2026-08-21T12:00:00.000Z",
    visualAssets: receipts.map((receipt) => ({
      assetVersionId: receipt.assetVersionId,
      fileName: receipt.fileName,
      fileExt: receipt.fileExt,
      sha256: receipt.sha256,
      sizeBytes: receipt.sizeBytes,
    })),
  };
}

function verifiedFixture(runtimePackageId = PACKAGE_ID): VerifiedRuntimePackagePreview {
  const preview = { ...previewFixture(), runtimePackageId };
  return {
    preview,
    members: preview.visualAssets.map((member) => ({
      ...member,
      bytes: new ArrayBuffer(member.sizeBytes),
    })),
  };
}

function mockSuccessfulTransport(runtimePackageId = PACKAGE_ID): VerifiedRuntimePackagePreview {
  const verified = verifiedFixture(runtimePackageId);
  exactLayerMocks.fetchRuntimePackagePreviewMetadata.mockResolvedValue(verified.preview);
  exactLayerMocks.fetchVerifiedRuntimePackagePreviewMember.mockImplementation(
    (_preview: RuntimePackagePreview, index: number) => {
      const member = verified.members[index];
      if (member === undefined) throw new Error("Expected exact Grand Hall member fixture.");
      return Promise.resolve(member);
    },
  );
  return verified;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  exactLayerMocks.createdMeshes.length = 0;
  exactLayerMocks.stallMeshInitialization = false;
  vi.useRealTimers();
});

describe("exact Grand Hall all-or-nothing decode", () => {
  it("keeps every member invisible until all exact counts have decoded", async () => {
    const meshes = GRAND_HALL_CAPTURED_SOG_MEMBERS.map(
      (member) => new FakeMesh(member.gaussianCount),
    );
    let index = 0;
    const createMesh = vi.fn(() => meshes[index++] ?? new FakeMesh(0));

    const resource = await decodeExactGrandHallResource(
      verifiedFixture(),
      TRANSFORM,
      new AbortController().signal,
      createMesh,
    );

    expect(resource.splatCount).toBe(GRAND_HALL_CAPTURED_SOURCE.gaussianCount);
    expect(resource.meshes).toEqual(meshes);
    expect(createMesh).toHaveBeenCalledTimes(GRAND_HALL_CAPTURED_SOG_MEMBERS.length);
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(false);
      expect(mesh.opacity).toBe(0);
      expect(mesh.position.set).toHaveBeenCalledWith(...TRANSFORM.position);
      expect(mesh.rotation.set).toHaveBeenCalledWith(...TRANSFORM.rotation);
      expect(mesh.scale.setScalar).toHaveBeenCalledWith(1);
      expect(mesh.dispose).not.toHaveBeenCalled();
    }

    disposeExactGrandHallResource(resource);
    expect(meshes.every((mesh) => mesh.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("disposes the complete partial set when one decoded count differs", async () => {
    const meshes = GRAND_HALL_CAPTURED_SOG_MEMBERS.map(
      (member, index) => new FakeMesh(member.gaussianCount + (index === 3 ? 1 : 0)),
    );
    let index = 0;

    await expect(decodeExactGrandHallResource(
      verifiedFixture(),
      TRANSFORM,
      new AbortController().signal,
      () => meshes[index++] ?? new FakeMesh(0),
    )).rejects.toThrow(/different Gaussian count/u);

    expect(meshes.slice(0, 4).every((mesh) => mesh.dispose.mock.calls.length === 1)).toBe(true);
    expect(meshes.slice(4).every((mesh) => mesh.dispose.mock.calls.length === 0)).toBe(true);
  });
});

describe("ExactGrandHallSplatLayer terminal lifecycle", () => {
  it("reports ready only after all eleven decoded members attach in one commit", async () => {
    const verified = verifiedFixture();
    const transportEvents: string[] = [];
    exactLayerMocks.fetchRuntimePackagePreviewMetadata.mockImplementation(() => {
      transportEvents.push("metadata");
      return Promise.resolve(verified.preview);
    });
    exactLayerMocks.fetchVerifiedRuntimePackagePreviewMember.mockImplementation(
      (_preview: RuntimePackagePreview, index: number) => {
        transportEvents.push(`member:${String(index)}`);
        const member = verified.members[index];
        if (member === undefined) throw new Error("Expected exact Grand Hall member fixture.");
        return Promise.resolve(member);
      },
    );
    const onChunkLoaded = vi.fn<(memberName: string) => void>();
    let attachedAtReady = 0;
    let container: HTMLElement | null = null;
    const onReady = vi.fn(() => {
      attachedAtReady = container?.querySelectorAll("primitive").length ?? 0;
    });

    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onChunkLoaded,
      onReady,
    }));
    container = rendered.container;

    await waitFor(() => { expect(onReady).toHaveBeenCalledTimes(1); });
    expect(attachedAtReady).toBe(GRAND_HALL_CAPTURED_SOG_MEMBERS.length);
    expect(rendered.container.querySelectorAll("primitive")).toHaveLength(
      GRAND_HALL_CAPTURED_SOG_MEMBERS.length,
    );
    expect(onChunkLoaded.mock.calls.map(([memberName]) => memberName)).toEqual(
      GRAND_HALL_CAPTURED_SOG_MEMBERS.map((member) => member.fileName),
    );
    expect(exactLayerMocks.sparkRendererHost.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ sortRadial: false }),
    );
    expect(transportEvents).toEqual([
      "metadata",
      ...GRAND_HALL_CAPTURED_SOG_MEMBERS.map((_, index) => `member:${String(index)}`),
    ]);
  });

  it("rejects non-exact metadata before requesting any protected member", async () => {
    const preview = previewFixture();
    const wrongRoomPreview: RuntimePackagePreview = {
      ...preview,
      roomSlug: "reception-room",
      manifestJson: {
        ...preview.manifestJson,
        roomSlug: "reception-room",
      },
    };
    exactLayerMocks.fetchRuntimePackagePreviewMetadata.mockResolvedValue(wrongRoomPreview);
    const onReady = vi.fn();
    const onFailed = vi.fn();

    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onReady,
      onFailed,
    }));

    await waitFor(() => { expect(onFailed).toHaveBeenCalledOnce(); });
    expect(exactLayerMocks.fetchRuntimePackagePreviewMetadata).toHaveBeenCalledOnce();
    expect(exactLayerMocks.fetchVerifiedRuntimePackagePreviewMember).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("primitive")).toBeNull();
  });

  it("reports a terminal failure while leaving every source member detached", async () => {
    exactLayerMocks.fetchRuntimePackagePreviewMetadata.mockRejectedValue(
      new Error("protected preview unavailable"),
    );
    const onChunkFailed = vi.fn();
    const onReady = vi.fn();
    const onFailed = vi.fn();

    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onChunkFailed,
      onReady,
      onFailed,
    }));

    await waitFor(() => { expect(onFailed).toHaveBeenCalledTimes(1); });
    expect(onReady).not.toHaveBeenCalled();
    expect(onChunkFailed).toHaveBeenCalledTimes(GRAND_HALL_CAPTURED_SOG_MEMBERS.length);
    expect(rendered.container.querySelector("primitive")).toBeNull();
  });

  it("times out stalled transport, aborts it, and emits one terminal detached failure", async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | undefined;
    exactLayerMocks.fetchRuntimePackagePreviewMetadata.mockImplementation(
      (_runtimePackageId: string, signal: AbortSignal) => {
        transportSignal = signal;
        return new Promise<RuntimePackagePreview>(() => undefined);
      },
    );
    const onChunkFailed = vi.fn();
    const onReady = vi.fn();
    const onFailed = vi.fn();
    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onChunkFailed,
      onReady,
      onFailed,
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXACT_GRAND_HALL_LOAD_DEADLINE_MS);
    });
    expect(transportSignal?.aborted).toBe(true);
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onChunkFailed).toHaveBeenCalledTimes(GRAND_HALL_CAPTURED_SOG_MEMBERS.length);
    expect(onReady).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("primitive")).toBeNull();
  });

  it("times out decoder initialization and disposes the invisible partial resource", async () => {
    vi.useFakeTimers();
    exactLayerMocks.stallMeshInitialization = true;
    mockSuccessfulTransport();
    const onReady = vi.fn();
    const onFailed = vi.fn();
    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onReady,
      onFailed,
    }));
    await act(async () => { await Promise.resolve(); });
    expect(exactLayerMocks.createdMeshes).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXACT_GRAND_HALL_LOAD_DEADLINE_MS);
    });
    const partialMesh = exactLayerMocks.createdMeshes[0] as ExactGrandHallMesh | undefined;
    expect(partialMesh?.dispose).toHaveBeenCalledOnce();
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("primitive")).toBeNull();
  });

  it("rejects stale timeout and completion callbacks after a same-package room/venue remount", async () => {
    vi.useFakeTimers();
    const nextRuntimeKey: ExactGrandHallRuntimeKey = {
      ...RUNTIME_KEY,
      spaceId: "grand-hall-space-b",
      venueId: "trades-hall-venue-b",
    };
    let resolveFirst: ((value: RuntimePackagePreview) => void) | undefined;
    exactLayerMocks.fetchRuntimePackagePreviewMetadata
      .mockImplementationOnce(() => new Promise<RuntimePackagePreview>((resolvePromise) => {
        resolveFirst = resolvePromise;
      }))
      .mockResolvedValueOnce(verifiedFixture().preview);
    const verified = verifiedFixture();
    exactLayerMocks.fetchVerifiedRuntimePackagePreviewMember.mockImplementation(
      (_preview: RuntimePackagePreview, index: number) => {
        const member = verified.members[index];
        if (member === undefined) throw new Error("Expected exact Grand Hall member fixture.");
        return Promise.resolve(member);
      },
    );
    const onReady = vi.fn();
    const onFailed = vi.fn();
    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      key: serializeExactGrandHallRuntimeKey(RUNTIME_KEY),
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onReady,
      onFailed,
    }));
    rendered.rerender(createElement(ExactGrandHallSplatLayer, {
      key: serializeExactGrandHallRuntimeKey(nextRuntimeKey),
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onReady,
      onFailed,
    }));
    await act(async () => {
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
    });
    expect(onReady).toHaveBeenCalledOnce();

    await act(async () => {
      resolveFirst?.(verifiedFixture().preview);
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(EXACT_GRAND_HALL_LOAD_DEADLINE_MS);
    });
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
    expect(rendered.container.querySelectorAll("primitive")).toHaveLength(
      GRAND_HALL_CAPTURED_SOG_MEMBERS.length,
    );
  });

  it("detaches and disposes an attached resource when only its room/venue key changes", async () => {
    const nextRuntimeKey: ExactGrandHallRuntimeKey = {
      ...RUNTIME_KEY,
      spaceId: "grand-hall-space-c",
      venueId: "trades-hall-venue-c",
    };
    const verified = verifiedFixture();
    exactLayerMocks.fetchRuntimePackagePreviewMetadata
      .mockResolvedValueOnce(verified.preview)
      .mockImplementationOnce(() => new Promise<RuntimePackagePreview>(() => undefined));
    exactLayerMocks.fetchVerifiedRuntimePackagePreviewMember.mockImplementation(
      (_preview: RuntimePackagePreview, index: number) => {
        const member = verified.members[index];
        if (member === undefined) throw new Error("Expected exact Grand Hall member fixture.");
        return Promise.resolve(member);
      },
    );
    const firstReady = vi.fn();
    const rendered = render(createElement(ExactGrandHallSplatLayer, {
      key: serializeExactGrandHallRuntimeKey(RUNTIME_KEY),
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
      onReady: firstReady,
    }));
    await waitFor(() => { expect(firstReady).toHaveBeenCalledOnce(); });
    const firstMeshes = [...exactLayerMocks.createdMeshes] as ExactGrandHallMesh[];
    expect(rendered.container.querySelectorAll("primitive")).toHaveLength(
      GRAND_HALL_CAPTURED_SOG_MEMBERS.length,
    );

    rendered.rerender(createElement(ExactGrandHallSplatLayer, {
      key: serializeExactGrandHallRuntimeKey(nextRuntimeKey),
      runtimePackageId: PACKAGE_ID,
      transform: TRANSFORM,
      active: true,
    }));
    expect(rendered.container.querySelector("primitive")).toBeNull();
    for (const mesh of firstMeshes) expect(mesh.dispose).toHaveBeenCalledOnce();
  });
});
