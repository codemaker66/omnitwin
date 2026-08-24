import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TWIN_FIXTURE_MANIFEST_EQUIRECT } from "../__fixtures__/twin-fixture.js";

const harness = vi.hoisted(() => ({
  meshShouldFail: false,
  panoMounts: 0,
  blobSequence: 0,
  consoleMessages: [] as string[],
  revokedBlobUrls: [] as string[],
  clearedBlobUrls: [] as string[],
  disposedSceneBlobUrls: [] as string[],
}));

vi.mock("@react-three/fiber", () => {
  const camera = {
    position: { x: 0, y: 0, z: 0, set: vi.fn() },
    quaternion: { setFromEuler: vi.fn() },
    lookAt: vi.fn(),
  };
  const state = {
    camera,
    gl: { capabilities: { maxTextureSize: 4096 }, initTexture: vi.fn() },
    invalidate: vi.fn(),
  };
  return {
    Canvas: ({ children }: { readonly children: React.ReactNode }) => (
      <div data-testid="r3f-canvas">{children}</div>
    ),
    useFrame: (): void => undefined,
    useThree: <T,>(selector: (value: typeof state) => T): T => selector(state),
  };
});

vi.mock("@react-three/drei", () => ({ OrbitControls: (): null => null }));

vi.mock("../PanoStage.js", async () => {
  const { useEffect } = await import("react");
  interface MockPanoProps {
    readonly nodeId: string;
    readonly onStreamError?: (nodeId: string) => void;
    readonly onTier?: (nodeId: string, tier: "preview" | "base") => void;
  }
  return {
    PanoStage: ({ nodeId, onStreamError, onTier }: MockPanoProps) => {
      useEffect(() => {
        harness.panoMounts += 1;
      }, []);
      return (
        <div data-testid={`mock-pano-${nodeId}`}>
          <button type="button" onClick={() => onStreamError?.(nodeId)}>
            Fail panorama
          </button>
          <button type="button" onClick={() => onTier?.(nodeId, "base")}>
            Complete panorama
          </button>
        </div>
      );
    },
  };
});

vi.mock("../DollhouseStage.js", async () => {
  const { useLayoutEffect, useRef } = await import("react");
  interface MockDollhouseProps {
    readonly meshUrl: string;
    readonly onOwnedSceneReady?: (meshUrl: string, scene: { readonly blobUrl: string }) => void;
  }
  return {
    DOLLHOUSE_DOT_RADIUS_M: 0.18,
    preloadDollhouse: vi.fn(),
    clearDollhouse: (blobUrl: string): void => {
      harness.clearedBlobUrls.push(blobUrl);
    },
    DollhouseStage: ({ meshUrl, onOwnedSceneReady }: MockDollhouseProps) => {
      const sceneRef = useRef({ blobUrl: meshUrl });
      useLayoutEffect(() => {
        onOwnedSceneReady?.(meshUrl, sceneRef.current);
      }, [meshUrl, onOwnedSceneReady]);
      if (harness.meshShouldFail) {
        throw new Error(`GLB decode failed at ${meshUrl}`);
      }
      return <div data-testid="mock-dollhouse">mesh from {meshUrl}</div>;
    },
  };
});

vi.mock("../local-evidence-dollhouse-resources.js", () => ({
  disposeOwnedLocalDollhouseScene: (scene: { readonly blobUrl: string }): void => {
    harness.disposedSceneBlobUrls.push(scene.blobUrl);
  },
}));

vi.mock("../NavMarkers.js", () => ({ NavMarkers: (): null => null }));
vi.mock("../ParallaxStage.js", () => ({ ParallaxStage: (): null => null }));
vi.mock("../TravelControls.js", () => ({ TravelControls: (): null => null }));
vi.mock("../WalkControls.js", () => ({
  WalkControls: (): null => null,
  lookStateFromCamera: () => ({ yaw: 0, pitch: 0 }),
}));
vi.mock("../TwinCoachHint.js", () => ({ TwinCoachHint: (): null => null }));
vi.mock("../TwinMinimap.js", () => ({ TwinMinimap: (): null => null }));
vi.mock("../TwinViewerControls.js", () => ({ TwinViewerControls: (): null => null }));

const { TwinViewer } = await import("../TwinViewer.js");

const TOKEN = "review-token-that-must-not-render";
const ASSET_BASE =
  `http://127.0.0.1:55982/api/local-room-evidence-candidate/twin/${TOKEN}`;

function viewer(experience: "public" | "local-evidence-review") {
  return (
    <MemoryRouter
      initialEntries={[
        `/dev/trades-hall-visual?localRoomEvidence=http%3A%2F%2F127.0.0.1%3A55982%2Fapi%2Flocal-room-evidence-candidate%3Ftoken%3D${TOKEN}`,
      ]}
    >
      <TwinViewer
        manifest={TWIN_FIXTURE_MANIFEST_EQUIRECT}
        assetBase={ASSET_BASE}
        experience={experience}
        evidenceDisclosure="Captured panoramas · source-manifest frame only · authority none"
      />
    </MemoryRouter>
  );
}

function recordConsoleArguments(values: readonly unknown[]): void {
  for (const value of values) {
    if (typeof value === "string") {
      harness.consoleMessages.push(value);
    } else if (value instanceof Error) {
      harness.consoleMessages.push(`${value.name}: ${value.message}\n${value.stack ?? ""}`);
    }
  }
}

function consoleText(): string {
  return harness.consoleMessages.join("\n");
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  harness.meshShouldFail = false;
  harness.panoMounts = 0;
  harness.blobSequence = 0;
  harness.consoleMessages.length = 0;
  harness.revokedBlobUrls.length = 0;
  harness.clearedBlobUrls.length = 0;
  harness.disposedSceneBlobUrls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), { status: 200 })),
    ),
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:local-review-mesh-${String(++harness.blobSequence)}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((blobUrl: string) => {
    harness.revokedBlobUrls.push(blobUrl);
  });
  vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    recordConsoleArguments(values);
  });
  vi.spyOn(console, "warn").mockImplementation((...values: unknown[]) => {
    recordConsoleArguments(values);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TwinViewer local evidence stage failures", () => {
  it("keeps a sanitized panorama failure sticky, then remounts and recovers on retry", async () => {
    render(viewer("local-evidence-review"));
    expect(harness.panoMounts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Fail panorama" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Captured panorama could not be opened");
    expect(alert.textContent).not.toContain(TOKEN);
    expect(alert.textContent).not.toContain("127.0.0.1");
    expect(alert.textContent).not.toContain("localRoomEvidence");
    expect(alert.textContent).not.toContain("/api/");

    // Unrelated updates do not make the error disappear.
    fireEvent.pointerEnter(screen.getByRole("radiogroup", { name: /view mode/i }));
    expect(screen.getByRole("alert")).toBe(alert);

    fireEvent.click(within(alert).getByRole("button", { name: "Retry panorama" }));
    await waitFor(() => {
      expect(harness.panoMounts).toBe(2);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Complete panorama" }));
    expect(screen.getByRole("application").className).toContain("vv-twin-viewer--live");
  });

  it.each(["Dollhouse", "Plan"])(
    "contains a token-bearing %s GLB failure and offers an explicit return to Walk",
    async (modeLabel) => {
      harness.meshShouldFail = true;
      render(viewer("local-evidence-review"));

      fireEvent.click(screen.getByRole("radio", { name: modeLabel }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Mesh review could not be opened");
      expect(alert.textContent).toContain("panorama walk remains available");
      expect(alert.textContent).not.toContain("mesh-secret");
      expect(alert.textContent).not.toContain(TOKEN);
      expect(alert.textContent).not.toContain("127.0.0.1");
      expect(alert.textContent).not.toContain("dollhouse.glb");
      expect(consoleText()).not.toContain(TOKEN);
      expect(consoleText()).not.toContain("127.0.0.1");
      expect(consoleText()).not.toContain("/api/local-room-evidence-candidate");
      expect(consoleText()).not.toContain("dollhouse.glb");

      const meshRequest = vi.mocked(fetch).mock.calls.find(([input]) =>
        requestUrl(input).endsWith("/mesh/dollhouse.glb"),
      );
      expect(meshRequest?.[1]).toMatchObject({
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });

      fireEvent.click(within(alert).getByRole("button", { name: "Return to Walk" }));
      await waitFor(() => {
        expect(screen.queryByRole("alert")).toBeNull();
      });
      expect(screen.getByRole("radio", { name: "Walk" }).getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(screen.getByTestId("mock-pano-scan_000")).toBeTruthy();
      expect(harness.revokedBlobUrls).toContain("blob:local-review-mesh-1");
      expect(harness.clearedBlobUrls).toEqual(["blob:local-review-mesh-1"]);
      // The mocked decoder threw before a scene committed, so there is no
      // owned scene to dispose; cache eviction + revoke still run.
      expect(harness.disposedSceneBlobUrls).toEqual([]);
    },
  );

  it("re-fetches through a fresh blob lease and recovers when mesh retry succeeds", async () => {
    harness.meshShouldFail = true;
    render(viewer("local-evidence-review"));
    fireEvent.click(screen.getByRole("radio", { name: "Dollhouse" }));
    const alert = await screen.findByRole("alert");

    harness.meshShouldFail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry mesh" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-dollhouse").textContent).toContain(
        "blob:local-review-mesh-2",
      );
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) =>
        requestUrl(input).endsWith("/mesh/dollhouse.glb"),
      ),
    ).toHaveLength(2);
    expect(harness.revokedBlobUrls).toContain("blob:local-review-mesh-1");
    expect(harness.clearedBlobUrls).toEqual(["blob:local-review-mesh-1"]);
    expect(consoleText()).not.toContain(TOKEN);
    expect(consoleText()).not.toContain("127.0.0.1");
    expect(consoleText()).not.toContain("/api/local-room-evidence-candidate");
  });

  it("clears, disposes, and revokes each old local mesh lease exactly once across re-entry and retry", async () => {
    render(viewer("local-evidence-review"));
    fireEvent.click(screen.getByRole("radio", { name: "Dollhouse" }));
    await screen.findByTestId("mock-dollhouse");

    fireEvent.click(screen.getByRole("radio", { name: "Walk" }));
    await waitFor(() => {
      expect(harness.revokedBlobUrls).toEqual(["blob:local-review-mesh-1"]);
    });
    expect(harness.clearedBlobUrls).toEqual(["blob:local-review-mesh-1"]);
    expect(harness.disposedSceneBlobUrls).toEqual(["blob:local-review-mesh-1"]);

    fireEvent.click(screen.getByRole("radio", { name: "Dollhouse" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-dollhouse").textContent).toContain(
        "blob:local-review-mesh-2",
      );
    });

    // Turn the already-registered second scene into a decoder failure, then
    // exercise the explicit retry path. Its old lease must be fully released
    // before the third fetch mounts.
    harness.meshShouldFail = true;
    fireEvent.click(screen.getByRole("radio", { name: "Plan" }));
    const alert = await screen.findByRole("alert");
    harness.meshShouldFail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry mesh" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-dollhouse").textContent).toContain(
        "blob:local-review-mesh-3",
      );
    });

    expect(harness.clearedBlobUrls).toEqual([
      "blob:local-review-mesh-1",
      "blob:local-review-mesh-2",
    ]);
    expect(harness.disposedSceneBlobUrls).toEqual([
      "blob:local-review-mesh-1",
      "blob:local-review-mesh-2",
    ]);
    expect(harness.revokedBlobUrls).toEqual([
      "blob:local-review-mesh-1",
      "blob:local-review-mesh-2",
    ]);
  });

  it("catches a token-bearing mesh fetch rejection before React can log it", async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      return url.endsWith("/mesh/dollhouse.glb")
        ? Promise.reject(new Error(`Failed to fetch ${url}?token=${TOKEN}`))
        : Promise.resolve(
            new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), { status: 200 }),
          );
    });
    render(viewer("local-evidence-review"));
    fireEvent.click(screen.getByRole("radio", { name: "Dollhouse" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Mesh review could not be opened");
    expect(alert.textContent).not.toContain(TOKEN);
    expect(consoleText()).not.toContain(TOKEN);
    expect(consoleText()).not.toContain("127.0.0.1");
    expect(consoleText()).not.toContain("/api/local-room-evidence-candidate");
    expect(harness.blobSequence).toBe(0);
  });

  it("does not install the local panorama error bridge in the public experience", () => {
    render(viewer("public"));

    fireEvent.click(screen.getByRole("button", { name: "Fail panorama" }));
    expect(screen.queryByTestId("twin-local-evidence-error")).toBeNull();
  });

  it("keeps the public GLB on its direct cached path without local disposal", async () => {
    render(viewer("public"));
    fireEvent.click(screen.getByRole("radio", { name: "Dollhouse" }));

    await screen.findByTestId("mock-dollhouse");
    fireEvent.click(screen.getByRole("radio", { name: "Walk" }));

    expect(harness.blobSequence).toBe(0);
    expect(harness.clearedBlobUrls).toEqual([]);
    expect(harness.disposedSceneBlobUrls).toEqual([]);
    expect(harness.revokedBlobUrls).toEqual([]);
  });
});
