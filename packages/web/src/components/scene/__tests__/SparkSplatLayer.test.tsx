import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { RuntimePackagePreviewVisualAsset } from "@omnitwin/types";

const mocks = vi.hoisted(() => ({
  constructSplatMesh: vi.fn(),
  constructSparkRenderer: vi.fn(),
  invalidate: vi.fn(),
  openPrivateStream: vi.fn(),
  gl: {},
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void; gl: object }) => unknown) =>
    selector({ invalidate: mocks.invalidate, gl: mocks.gl }),
}));

vi.mock("@sparkjsdev/spark", () => ({
  SplatMesh: vi.fn(function SplatMesh(options: unknown) {
    return mocks.constructSplatMesh(options) as unknown;
  }),
  SparkRenderer: vi.fn(function SparkRenderer(options: unknown) {
    return mocks.constructSparkRenderer(options) as unknown;
  }),
}));

vi.mock("../../../api/runtime-packages.js", () => ({
  openRuntimePackagePreviewAsset: mocks.openPrivateStream,
}));

import {
  SparkSplatLayer,
  type SparkSplatRenderProfile,
} from "../SparkSplatLayer.js";

const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET: RuntimePackagePreviewVisualAsset = {
  assetVersionId: "10000000-0000-4000-8000-000000000001",
  fileName: "0_15_0_0.sog",
  fileExt: ".sog",
  sha256: "a".repeat(64),
  sizeBytes: 4,
};
const SOURCE = {
  kind: "private-stream" as const,
  id: `${PACKAGE_ID}:${ASSET.assetVersionId}`,
  runtimePackageId: PACKAGE_ID,
  asset: ASSET,
};

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mesh(initialized: Promise<unknown>): {
  readonly initialized: Promise<unknown>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly getBoundingBox: () => { isEmpty: () => boolean };
  readonly position: { set: ReturnType<typeof vi.fn> };
  readonly rotation: { set: ReturnType<typeof vi.fn> };
  readonly scale: { set: ReturnType<typeof vi.fn>; setScalar: ReturnType<typeof vi.fn> };
  visible: boolean;
  opacity: number;
  numSplats: number;
  maxSh: number;
} {
  return {
    initialized,
    dispose: vi.fn(),
    getBoundingBox: () => ({ isEmpty: () => true }),
    position: { set: vi.fn() },
    rotation: { set: vi.fn() },
    scale: { set: vi.fn(), setScalar: vi.fn() },
    visible: true,
    opacity: 1,
    numSplats: 1,
    maxSh: 3,
  };
}

beforeEach(() => {
  mocks.constructSparkRenderer.mockReturnValue({ dispose: vi.fn() });
});

afterEach(() => {
  cleanup();
  mocks.constructSplatMesh.mockReset();
  mocks.constructSparkRenderer.mockReset();
  mocks.invalidate.mockReset();
  mocks.openPrivateStream.mockReset();
});

describe("SparkSplatLayer private streams", () => {
  it("reports a real Spark onAfterRender without recreating the renderer", async () => {
    const initialization = deferred<unknown>();
    const splatMesh = mesh(initialization.promise);
    initialization.resolve(splatMesh);
    mocks.constructSplatMesh.mockReturnValue(splatMesh);
    mocks.openPrivateStream.mockResolvedValue({
      sourceId: SOURCE.id,
      fileName: ASSET.fileName,
      stream: new ReadableStream<Uint8Array>(),
      streamLength: ASSET.sizeBytes,
    });
    const previous = vi.fn();
    const sparkRenderer = { dispose: vi.fn(), onAfterRender: previous };
    mocks.constructSparkRenderer.mockReturnValue(sparkRenderer);
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<SparkSplatLayer source={SOURCE} onPresentedFrame={first} />);

    await waitFor(() => expect(sparkRenderer.onAfterRender).not.toBe(previous));
    const renderer = {};
    const scene = {};
    const camera = {};
    sparkRenderer.onAfterRender(renderer, scene, camera);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ renderer, scene, camera, sparkRenderer });

    view.rerender(<SparkSplatLayer source={SOURCE} onPresentedFrame={second} />);
    sparkRenderer.onAfterRender(renderer, scene, camera);
    expect(second).toHaveBeenCalledTimes(1);
    expect(mocks.constructSparkRenderer).toHaveBeenCalledTimes(1);
  });

  it("applies one explicit renderer and mesh profile without changing the source", async () => {
    const initialization = deferred<unknown>();
    const splatMesh = mesh(initialization.promise);
    initialization.resolve(splatMesh);
    mocks.constructSplatMesh.mockReturnValue(splatMesh);
    mocks.openPrivateStream.mockResolvedValue({
      sourceId: SOURCE.id,
      fileName: ASSET.fileName,
      stream: new ReadableStream<Uint8Array>(),
      streamLength: ASSET.sizeBytes,
    });
    const profile: SparkSplatRenderProfile = {
      id: "test-fixed-fine",
      maxSh: 3,
      enableLod: false,
      renderer: {
        preBlurAmount: 0,
        blurAmount: 0.3,
        sortRadial: true,
        enableLod: false,
        depthWrite: false,
      },
    };

    render(<SparkSplatLayer source={SOURCE} renderProfile={profile} />);

    await waitFor(() => {
      expect(mocks.constructSplatMesh).toHaveBeenCalledTimes(1);
      expect(mocks.constructSparkRenderer).toHaveBeenCalled();
    });
    expect(mocks.constructSparkRenderer).toHaveBeenLastCalledWith({
      renderer: {},
      onDirty: mocks.invalidate,
      transparent: true,
      depthWrite: false,
      ...profile.renderer,
    });
    expect(mocks.constructSplatMesh).toHaveBeenCalledWith(expect.objectContaining({
      fileName: ASSET.fileName,
      editable: false,
      raycastable: false,
      enableLod: false,
    }));
    expect(splatMesh.maxSh).toBe(3);
  });

  it("constructs Spark with the authenticated stream, length, and filename", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const initialization = deferred<unknown>();
    const splatMesh = mesh(initialization.promise);
    initialization.resolve(splatMesh);
    mocks.constructSplatMesh.mockReturnValue(splatMesh);
    mocks.openPrivateStream.mockResolvedValue({
      sourceId: SOURCE.id,
      fileName: ASSET.fileName,
      stream,
      streamLength: ASSET.sizeBytes,
    });

    render(<SparkSplatLayer source={SOURCE} includeRendererHost={false} />);

    await waitFor(() => {
      expect(mocks.constructSplatMesh).toHaveBeenCalledTimes(1);
    });
    expect(mocks.constructSplatMesh).toHaveBeenCalledWith({
      stream,
      streamLength: ASSET.sizeBytes,
      fileName: ASSET.fileName,
      editable: false,
      raycastable: false,
    });
    expect(mocks.openPrivateStream).toHaveBeenCalledWith(
      PACKAGE_ID,
      ASSET,
      expect.any(AbortSignal),
    );
  });

  it("passes an authenticated Mobile SPZ filename to Spark without changing format", async () => {
    const mobileAsset: RuntimePackagePreviewVisualAsset = {
      ...ASSET,
      assetVersionId: "daa01028-999a-4566-a306-9f43242efe1f",
      fileName: "0_13_0_0.spz",
      fileExt: ".spz",
      sha256: "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c",
      sizeBytes: 8_620_036,
    };
    const mobileSource = {
      kind: "private-stream" as const,
      id: `${PACKAGE_ID}:${mobileAsset.assetVersionId}`,
      runtimePackageId: PACKAGE_ID,
      asset: mobileAsset,
    };
    const stream = new ReadableStream<Uint8Array>();
    const initialization = deferred<unknown>();
    const splatMesh = mesh(initialization.promise);
    initialization.resolve(splatMesh);
    mocks.constructSplatMesh.mockReturnValue(splatMesh);
    mocks.openPrivateStream.mockResolvedValue({
      sourceId: mobileSource.id,
      fileName: mobileAsset.fileName,
      stream,
      streamLength: mobileAsset.sizeBytes,
    });

    render(<SparkSplatLayer source={mobileSource} includeRendererHost={false} />);

    await waitFor(() => {
      expect(mocks.constructSplatMesh).toHaveBeenCalledTimes(1);
    });
    expect(mocks.constructSplatMesh).toHaveBeenCalledWith({
      stream,
      streamLength: mobileAsset.sizeBytes,
      fileName: "0_13_0_0.spz",
      editable: false,
      raycastable: false,
    });
    expect(mocks.openPrivateStream).toHaveBeenCalledWith(
      PACKAGE_ID,
      mobileAsset,
      expect.any(AbortSignal),
    );
  });

  it("aborts a pending private fetch without reporting an error after unmount", async () => {
    let receivedSignal: AbortSignal | undefined;
    const onError = vi.fn();
    mocks.openPrivateStream.mockImplementation(
      (_packageId: string, _asset: RuntimePackagePreviewVisualAsset, signal: AbortSignal) => {
        receivedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    );

    const view = render(
      <SparkSplatLayer source={SOURCE} includeRendererHost={false} onError={onError} />,
    );
    await waitFor(() => {
      expect(receivedSignal).toBeDefined();
    });
    view.unmount();

    expect(receivedSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.constructSplatMesh).not.toHaveBeenCalled();
  });

  it("aborts the stream and disposes the mesh exactly once on unmount", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const initialization = deferred<unknown>();
    const splatMesh = mesh(initialization.promise);
    let receivedSignal: AbortSignal | undefined;
    mocks.constructSplatMesh.mockReturnValue(splatMesh);
    mocks.openPrivateStream.mockImplementation(
      (_packageId: string, _asset: RuntimePackagePreviewVisualAsset, signal: AbortSignal) => {
        receivedSignal = signal;
        return Promise.resolve({
          sourceId: SOURCE.id,
          fileName: ASSET.fileName,
          stream,
          streamLength: ASSET.sizeBytes,
        });
      },
    );

    const view = render(<SparkSplatLayer source={SOURCE} includeRendererHost={false} />);
    await waitFor(() => {
      expect(mocks.constructSplatMesh).toHaveBeenCalledTimes(1);
    });
    view.unmount();

    expect(receivedSignal?.aborted).toBe(true);
    expect(splatMesh.dispose).toHaveBeenCalledTimes(1);
  });

  it("aborts authenticated bytes and reports once when Spark rejects the file", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const initialization = deferred<unknown>();
    const splatMesh = mesh(initialization.promise);
    const onError = vi.fn();
    let receivedSignal: AbortSignal | undefined;
    mocks.constructSplatMesh.mockReturnValue(splatMesh);
    mocks.openPrivateStream.mockImplementation(
      (_packageId: string, _asset: RuntimePackagePreviewVisualAsset, signal: AbortSignal) => {
        receivedSignal = signal;
        return Promise.resolve({
          sourceId: SOURCE.id,
          fileName: ASSET.fileName,
          stream,
          streamLength: ASSET.sizeBytes,
        });
      },
    );

    render(
      <SparkSplatLayer
        source={SOURCE}
        includeRendererHost={false}
        onError={onError}
      />,
    );
    await waitFor(() => {
      expect(mocks.constructSplatMesh).toHaveBeenCalledTimes(1);
    });
    initialization.reject(new Error("invalid splat"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(receivedSignal?.aborted).toBe(true);
    expect(splatMesh.dispose).toHaveBeenCalledTimes(1);
  });

  it("cancels an unlocked stream if unmounted before Spark receives it", async () => {
    const opening = deferred<{
      sourceId: string;
      fileName: string;
      stream: ReadableStream<Uint8Array>;
      streamLength: number;
    }>();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    mocks.openPrivateStream.mockReturnValue(opening.promise);

    const view = render(<SparkSplatLayer source={SOURCE} includeRendererHost={false} />);
    view.unmount();
    opening.resolve({
      sourceId: SOURCE.id,
      fileName: ASSET.fileName,
      stream,
      streamLength: ASSET.sizeBytes,
    });

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
    });
    expect(mocks.constructSplatMesh).not.toHaveBeenCalled();
  });
});
