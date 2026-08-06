import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { findUnsupportedProposalClaim, type TwinManifest } from "@omnitwin/types";
import {
  allTwinCopy,
  TWIN_DISCLOSURE,
  TWIN_ERROR_LINE,
  TWIN_LOADING_LINE,
  TWIN_MODE_DOLLHOUSE_LABEL,
  TWIN_MODE_GROUP_LABEL,
  TWIN_MODE_WALK_LABEL,
  TWIN_RETRY_LABEL,
  TWIN_TITLE,
  twinNodeLabel,
} from "../twin/twin-copy.js";
import {
  TWIN_FIXTURE_MANIFEST,
  TWIN_FIXTURE_MANIFEST_NO_MESH,
} from "../twin/__fixtures__/twin-fixture.js";

// ---------------------------------------------------------------------------
// TwinPage — public twin route shell (Twin Phase 1, Tasks 6 + 9).
//
// The page owns three Rite-voiced states (loading / error / ready) around a
// manifest fetch validated with TwinManifestSchema. The ready state mounts
// TwinViewer, so the R3F Canvas is mocked exactly as PlannerScene.test.tsx
// does: an empty host div — the scene children are constructed as React
// elements but never mounted, so their useThree/useFrame hooks don't run
// outside a real Canvas. The HUD outside the Canvas (node label, disclosure)
// renders for real and is asserted here.
// ---------------------------------------------------------------------------

type CanvasMockProps = Readonly<{
  dpr?: unknown;
  frameloop?: unknown;
}>;

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ dpr, frameloop }: CanvasMockProps) => (
    <div
      data-testid="r3f-canvas"
      data-dpr={JSON.stringify(dpr)}
      data-frameloop={typeof frameloop === "string" ? frameloop : ""}
    />
  ),
  useFrame: (): void => undefined,
  useThree: (): undefined => undefined,
}));

// TwinViewer imports drei's OrbitControls and (via DollhouseStage) useGLTF
// plus the meshopt decoder module. Canvas children never mount (the Canvas
// mock is an empty div), so inert stand-ins are all these need to be.
vi.mock("@react-three/drei", () => ({
  OrbitControls: (): null => null,
  useGLTF: vi.fn(() => ({ scene: {} })),
}));
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: { ready: Promise.resolve(), supported: true },
}));

const { TwinPage } = await import("../pages/TwinPage.js");

/** The plan's Task-1 fixture manifest — a schema-valid single-node twin/0. */
const validManifest: TwinManifest = {
  schema: "twin/0",
  venueSlug: "trades-hall",
  name: "Trades Hall Glasgow",
  capture: { kind: "matterport-e57", scanCount: 149 },
  tier: "ops-grade-2cm",
  upAxis: "z",
  units: "m",
  imagery: "cube-faces",
  faces: ["front", "back", "left", "right", "up", "down"],
  lods: [256, 1024],
  generatedAt: "2026-07-02T12:00:00.000Z",
  nodes: [
    {
      id: "scan_000",
      index: 0,
      pose: {
        q: [0.7376939654350281, 0.014615842141211033, -0.011572370305657387, -0.6748778820037842],
        t: [0.004310831427574158, 0.008259806782007217, 1.4990558624267578],
      },
      floor: 0,
      roomSlug: null,
    },
  ],
  edges: [{ a: "scan_000", b: "scan_001", distanceM: 2.67 }],
};

const fetchMock = vi.fn();

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response;
}

function mockLegacyManifest(data: unknown): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ error: "No active release" }, 404))
    .mockResolvedValueOnce(jsonResponse(data));
}

function binaryJsonResponse(json: string): Response {
  const bytes = new TextEncoder().encode(json);
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(bytes.buffer),
    headers: new Headers(),
  } as Response;
}

function mount(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/venues/trades-hall/twin"]}>
      <Routes>
        <Route path="/venues/:venueSlug/twin" element={<TwinPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TwinPage — loading state", () => {
  it("renders the loading line while the manifest is on its way", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    mount();
    expect(screen.getByText(TWIN_LOADING_LINE)).toBeTruthy();
  });

  it("resolves the production channel before requesting any bundle bytes", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    mount();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/assets/reconstruction-releases/active?venueSlug=trades-hall&releaseKind=venue_twin_v1",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it("uses the legacy local bundle only when no active Foundry release exists", async () => {
    mockLegacyManifest(validManifest);
    mount();
    await screen.findByTestId("twin-stage");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/twin/trades-hall/manifest.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
  });
});

describe("TwinPage — error state", () => {
  it("shows the error line with a retry button, and retrying refetches", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    mount();

    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
    // Each attempt is descriptor + legacy-fallback: both rejected here.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: TWIN_RETRY_LABEL }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
  });

  it("falls back to the local bundle when the API is unreachable (not just 404)", async () => {
    // The twin's assets are fully local — a dead API must not kill the page.
    fetchMock
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(jsonResponse(validManifest));
    mount();

    expect(await screen.findByTestId("twin-stage")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/twin/trades-hall/manifest.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
  });

  it("treats a schema-invalid manifest as an error state, never a crash", async () => {
    mockLegacyManifest({ schema: "twin/1" });
    mount();
    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
    expect(screen.queryByTestId("twin-stage")).toBeNull();
  });

  it("fails closed on a Foundry manifest digest mismatch without legacy fallback", async () => {
    const releaseDigest = "b".repeat(64);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data: {
          schemaVersion: "venviewer.reconstruction-active-release.v1",
          venueSlug: "trades-hall",
          releaseKind: "venue_twin_v1",
          channel: "production",
          releaseId: "10000000-0000-4000-8000-000000000010",
          releaseDigest,
          publicationId: "10000000-0000-4000-8000-000000000011",
          manifestSha256: "f".repeat(64),
          manifestUrl: `https://releases.example.com/releases/sha256/bb/${releaseDigest}/manifest.json`,
          assetBaseUrl: `https://releases.example.com/releases/sha256/bb/${releaseDigest}`,
          channelRevision: 3,
        },
      }))
      .mockResolvedValueOnce(binaryJsonResponse(JSON.stringify(validManifest)));

    mount();
    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("TwinPage — ready state", () => {
  it("loads the exact immutable Foundry manifest after verifying its bytes", async () => {
    const releaseDigest = "c".repeat(64);
    const manifestJson = JSON.stringify(validManifest);
    const manifestSha256 = createHash("sha256").update(manifestJson).digest("hex");
    const assetBaseUrl = `https://releases.example.com/releases/sha256/cc/${releaseDigest}`;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data: {
          schemaVersion: "venviewer.reconstruction-active-release.v1",
          venueSlug: "trades-hall",
          releaseKind: "venue_twin_v1",
          channel: "production",
          releaseId: "10000000-0000-4000-8000-000000000010",
          releaseDigest,
          publicationId: "10000000-0000-4000-8000-000000000011",
          manifestSha256,
          manifestUrl: `${assetBaseUrl}/manifest.json`,
          assetBaseUrl,
          channelRevision: 3,
        },
      }))
      .mockResolvedValueOnce(binaryJsonResponse(manifestJson));

    mount();
    expect(await screen.findByTestId("twin-stage")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${assetBaseUrl}/manifest.json`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("mounts the viewer with its canvas host, node label, and the disclosure", async () => {
    mockLegacyManifest(validManifest);
    mount();

    const stage = await screen.findByTestId("twin-stage");
    expect(within(stage).getByTestId("r3f-canvas")).toBeTruthy();

    const label = within(stage).getByTestId("twin-node-label");
    expect(label.textContent).toBe(twinNodeLabel("scan_000", validManifest.name));
    expect(screen.getByText(TWIN_DISCLOSURE)).toBeTruthy();
  });

  it("renders the disclosure exactly once on the page", async () => {
    mockLegacyManifest(validManifest);
    mount();

    await screen.findByTestId("twin-stage");
    expect(screen.getAllByText(TWIN_DISCLOSURE)).toHaveLength(1);
  });
});

describe("TwinPage — document chrome and landmarks", () => {
  it("sets the twin title on mount and restores the previous title on unmount", async () => {
    document.title = "Previous title";
    mockLegacyManifest(validManifest);
    const view = mount();

    expect(document.title).toBe(TWIN_TITLE);
    await screen.findByTestId("twin-stage");
    view.unmount();
    expect(document.title).toBe("Previous title");
  });

  it("exposes a named main landmark", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    mount();
    expect(screen.getByRole("main", { name: TWIN_TITLE })).toBeTruthy();
  });
});

describe("TwinPage — view mode control (Phase 2, Task 5)", () => {
  it("shows the segmented control when the manifest carries a mesh", async () => {
    mockLegacyManifest(TWIN_FIXTURE_MANIFEST);
    mount();

    await screen.findByTestId("twin-stage");
    const group = screen.getByRole("radiogroup", { name: TWIN_MODE_GROUP_LABEL });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: TWIN_MODE_WALK_LABEL }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("hides the control entirely when the bundle has no mesh", async () => {
    mockLegacyManifest(TWIN_FIXTURE_MANIFEST_NO_MESH);
    mount();

    await screen.findByTestId("twin-stage");
    expect(screen.queryByRole("radiogroup", { name: TWIN_MODE_GROUP_LABEL })).toBeNull();
  });

  it("switching to Dollhouse checks the segment and hides the walk minimap", async () => {
    mockLegacyManifest(TWIN_FIXTURE_MANIFEST);
    mount();

    await screen.findByTestId("twin-stage");
    expect(screen.getByRole("listbox", { name: "Scan positions" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: TWIN_MODE_DOLLHOUSE_LABEL }));
    await waitFor(() => {
      expect(
        screen
          .getByRole("radio", { name: TWIN_MODE_DOLLHOUSE_LABEL })
          .getAttribute("aria-checked"),
      ).toBe("true");
    });
    expect(screen.queryByRole("listbox", { name: "Scan positions" })).toBeNull();
  });
});

describe("twin copy — claim safety", () => {
  it("carries no unsupported certainty claims in any user-visible line", () => {
    const lines = allTwinCopy();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });
});
