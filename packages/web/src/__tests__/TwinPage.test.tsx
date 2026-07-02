import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { findUnsupportedProposalClaim, type TwinManifest } from "@omnitwin/types";
import {
  allTwinCopy,
  TWIN_DISCLOSURE,
  TWIN_ERROR_LINE,
  TWIN_LOADING_LINE,
  TWIN_RETRY_LABEL,
  TWIN_TITLE,
  twinNodeLabel,
} from "../twin/twin-copy.js";

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

  it("requests the manifest from the venue's slug under the default asset base", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    mount();
    // The request is abortable (reviewer P1): the hook passes its
    // AbortController's signal so superseded fetches are truly cancelled.
    expect(fetchMock).toHaveBeenCalledWith(
      "/twin/trades-hall/manifest.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("TwinPage — error state", () => {
  it("shows the error line with a retry button, and retrying refetches", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    mount();

    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: TWIN_RETRY_LABEL }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
  });

  it("treats a schema-invalid manifest as an error state, never a crash", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ schema: "twin/1" }));
    mount();
    expect(await screen.findByText(TWIN_ERROR_LINE)).toBeTruthy();
    expect(screen.queryByTestId("twin-stage")).toBeNull();
  });
});

describe("TwinPage — ready state", () => {
  it("mounts the viewer with its canvas host, node label, and the disclosure", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validManifest));
    mount();

    const stage = await screen.findByTestId("twin-stage");
    expect(within(stage).getByTestId("r3f-canvas")).toBeTruthy();

    const label = within(stage).getByTestId("twin-node-label");
    expect(label.textContent).toBe(twinNodeLabel("scan_000", validManifest.name));
    expect(screen.getByText(TWIN_DISCLOSURE)).toBeTruthy();
  });

  it("renders the disclosure exactly once on the page", async () => {
    fetchMock.mockResolvedValue(jsonResponse(validManifest));
    mount();

    await screen.findByTestId("twin-stage");
    expect(screen.getAllByText(TWIN_DISCLOSURE)).toHaveLength(1);
  });
});

describe("TwinPage — document chrome and landmarks", () => {
  it("sets the twin title on mount and restores the previous title on unmount", async () => {
    document.title = "Previous title";
    fetchMock.mockResolvedValue(jsonResponse(validManifest));
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

describe("twin copy — claim safety", () => {
  it("carries no unsupported certainty claims in any user-visible line", () => {
    const lines = allTwinCopy();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });
});
