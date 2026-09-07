import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HallkeeperFloorPlan, Phase } from "@omnitwin/types";
import { HallkeeperSheetV2Schema } from "@omnitwin/types";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InteractiveFloorPlan } from "../InteractiveFloorPlan.js";
import { HallkeeperPage } from "../../../pages/HallkeeperPage.js";

vi.mock("../../../api/client.js", () => ({ getAuthToken: vi.fn().mockResolvedValue(null) }));
vi.mock("../useHallkeeperContext.js", () => ({
  useHallkeeperContext: () => ({ status: "idle", context: null, error: null, retry: vi.fn() }),
}));
vi.mock("../HallkeeperStatusBanner.js", () => ({ HallkeeperStatusBanner: () => null }));
vi.mock("../../../lib/progress-sync-queue.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/progress-sync-queue.js")>(), listPendingProgress: vi.fn().mockResolvedValue([]),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing fixture element");
  return value;
}
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const objects: HallkeeperFloorPlan["objects"] = Array.from({ length: 18 }, (_, table) => {
  const x = 2 + (table % 6) * 3.2;
  const z = 2 + Math.floor(table / 6) * 3.2;
  return Array.from({ length: 9 }, (_, member) => {
    const angle = ((member - 1) / 8) * Math.PI * 2;
    return { objectId: id(table * 9 + member + 1), assetDefinitionId: id(member === 0 ? 1000 : 1001),
      name: member === 0 ? "Round table" : "Banquet chair", category: member === 0 ? "table" : "chair",
      x: x + (member === 0 ? 0 : Math.cos(angle) * 1.1), z: z + (member === 0 ? 0 : Math.sin(angle) * 1.1),
      rotationY: angle, scale: 1, widthM: member === 0 ? 1.8 : 0.45, depthM: member === 0 ? 1.8 : 0.5,
      collisionType: member === 0 ? "cylinder" as const : "box" as const };
  });
}).flat();
const plan: HallkeeperFloorPlan = { coordinateSpace: "real_m_v1",
  outline: [{ x: 0, z: 0 }, { x: 21, z: 0 }, { x: 21, z: 10.5 }, { x: 0, z: 10.5 }], objects };
const phases: Phase[] = [{ phase: "furniture", zones: [{ zone: "Centre", rows: [{
  key: "tables", name: "Round table with 8 chairs", category: "table", qty: 18,
  afterDepth: 0, isAccessory: false, notes: "", positions: objects.filter((object) => object.category === "table")
    .map((object) => ({ objectId: object.objectId, x: object.x, z: object.z, rotationY: object.rotationY })),
}] }] }];
const props = { room: { widthM: 21, lengthM: 10.5 }, phases, highlightedRowKey: null, onMarkerClick: vi.fn() };

describe("InteractiveFloorPlan saved geometry", () => {
  it("draws every saved footprint despite the manifest folding 144 chairs into 18 bundles", () => {
    const { container } = render(<InteractiveFloorPlan {...props} floorPlan={plan} />);
    expect(container.querySelectorAll("[data-footprint-id]")).toHaveLength(162);
    expect(container.querySelectorAll("ellipse[data-footprint-shape]")).toHaveLength(18);
    expect(container.querySelectorAll("polygon[data-footprint-shape]")).toHaveLength(144);
    expect(screen.getByText("Saved layout · 162 footprints")).toBeTruthy();
    expect(container.querySelector("[data-room-outline]")?.tagName).toBe("polygon");
  });

  it("keeps actual table-row selection, keyboard access and highlight without inventing chair links", () => {
    const click = vi.fn();
    const { container } = render(<InteractiveFloorPlan {...props} floorPlan={plan} highlightedRowKey="tables" onMarkerClick={click} />);
    const buttons = screen.getAllByRole("button", { name: "Find Round table with 8 chairs in the manifest" });
    expect(buttons).toHaveLength(18);
    fireEvent.click(required(buttons[0]));
    fireEvent.keyDown(required(buttons[1]), { key: "Enter" });
    fireEvent.keyDown(required(buttons[2]), { key: " " });
    expect(click.mock.calls).toEqual([["tables"], ["tables"], ["tables"]]);
    expect(container.querySelectorAll('[data-highlighted="true"]')).toHaveLength(18);
    const chair = required(container.querySelector(`[data-footprint-id="${id(2)}"]`));
    expect(chair.getAttribute("role")).toBeNull();
    fireEvent.click(chair);
    expect(click).toHaveBeenCalledTimes(3);
  });

  it("retains legacy marker fallback for absent or null saved geometry", () => {
    const { container, rerender } = render(<InteractiveFloorPlan {...props} />);
    expect(container.querySelectorAll("circle")).toHaveLength(18);
    expect(container.querySelectorAll("[data-footprint-id]")).toHaveLength(0);
    rerender(<InteractiveFloorPlan {...props} floorPlan={null} />);
    expect(container.querySelectorAll("circle")).toHaveLength(18);
  });

  it("treats a saved empty layout as authoritative instead of substituting manifest markers", () => {
    const { container } = render(<InteractiveFloorPlan {...props} floorPlan={{ ...plan, objects: [] }} />);
    expect(container.querySelectorAll("[data-footprint-id], circle")).toHaveLength(0);
    expect(screen.getByText("No furniture in this saved layout")).toBeTruthy();
  });

  it("does not substitute plausible markers when a provided saved plan is invalid", () => {
    const { container } = render(<InteractiveFloorPlan {...props} floorPlan={{ ...plan, coordinateSpace: "unknown" }} />);
    expect(screen.getByRole("alert").textContent).toContain("Saved floor plan unavailable");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("uses the highlighted phase row when an object explicitly occurs in multiple manifest phases", () => {
    const row = required(required(required(phases[0]).zones[0]).rows[0]);
    const twoPhases: Phase[] = [...phases, { phase: "dress", zones: [{ zone: "Centre", rows: [{ ...row, key: "dress-tables" }] }] }];
    const click = vi.fn();
    render(<InteractiveFloorPlan {...props} floorPlan={plan} phases={twoPhases} highlightedRowKey="dress-tables" onMarkerClick={click} />);
    fireEvent.click(required(screen.getAllByRole("button", { pressed: true })[0]));
    expect(click).toHaveBeenCalledWith("dress-tables");
  });

  it("renders the fetched sheet's frozen plan at the real page boundary with no writes", async () => {
    const sheet = HallkeeperSheetV2Schema.parse({
      config: { id: id(3000), name: "Saved dinner", guestCount: 144, layoutStyle: "dinner-rounds" },
      venue: { name: "Test venue", address: "Test address", timezone: "Europe/London" },
      space: { name: "Test room", widthM: 99, lengthM: 99, heightM: 6 }, // current metadata must not resize the saved outline
      timing: null, instructions: null, phases, totals: { entries: [], totalRows: 1, totalItems: 18 },
      diagramUrl: null, floorPlan: plan, webViewUrl: "https://example.test/hallkeeper", generatedAt: "2026-09-06T12:00:00Z", approval: null,
    });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(init?.method ?? "GET").toBe("GET");
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v2")) return Promise.resolve(new Response(JSON.stringify({ data: sheet }), { status: 200 }));
      if (url.endsWith("/progress")) return Promise.resolve(new Response(JSON.stringify({ data: { checked: {} } }), { status: 200 }));
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<MemoryRouter initialEntries={[`/hallkeeper/${id(3000)}`]}><Routes>
      <Route path="/hallkeeper/:configId" element={<HallkeeperPage />} />
    </Routes></MemoryRouter>);
    const livePlan = await screen.findByRole("group", { name: "Interactive saved floor plan" });
    expect(livePlan.querySelectorAll("[data-footprint-id]")).toHaveLength(162);
    const printCopy = required(container.querySelector(".hk-print-only[aria-hidden='true']"));
    expect(printCopy.querySelectorAll("[data-footprint-id]")).toHaveLength(162);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
