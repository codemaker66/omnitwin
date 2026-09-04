import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The walk page mounts a real R3F canvas through RoomSplatScene. That scene is
// stubbed so the assertions are about what the PAGE says — the header count,
// the honesty copy — not about WebGL, which happy-dom cannot provide.
const scene = vi.hoisted(() => ({ push: null as null | ((p: Record<string, unknown>) => void) }));
vi.mock("../components/rooms/RoomSplatScene.js", () => ({
  RoomSplatScene: ({ room, onProgress }: {
    readonly room: string;
    readonly onProgress?: (p: Record<string, unknown>) => void;
  }) => {
    scene.push = onProgress ?? null;
    return <div data-testid="room-splat-scene">{room}</div>;
  },
}));

const { RoomWalkPage } = await import("../pages/RoomWalkPage.js");
const { roomSplatBundle, roomSplatServedSplats } = await import("../data/room-splat-bundles.js");

function mount(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomSlug" element={<RoomWalkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); });

describe("RoomWalkPage", () => {
  it("mounts the room named in the URL", () => {
    mount("/room/grand-hall");
    expect(screen.getByTestId("room-splat-scene").textContent).toBe("grand-hall");
  });

  it("counts the splats the visitor will actually see", () => {
    mount("/room/grand-hall");
    const header = screen.getByRole("banner").textContent ?? "";
    const served = roomSplatServedSplats("grand-hall");
    const staged = roomSplatBundle("grand-hall")?.totalSplats ?? 0;
    expect(served).toBe(6_019_684);
    expect(header).toContain(`${served.toLocaleString("en-GB")} splats`);
    expect(header).not.toContain(staged.toLocaleString("en-GB"));
  });

  it("does not mount a room whose walk has been closed until its alignment is fixed", () => {
    mount("/room/robert-adam-room");
    expect(screen.queryByTestId("room-splat-scene")).toBeNull();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/being aligned/iu);
    expect(body).toMatch(/not yet walkable/iu);
    expect(screen.getByRole("link", { name: /rooms/iu }).getAttribute("href")).toBe("/");
  });

  it("tells a visitor of a review room how far the scan goes and withholds dimensions", () => {
    mount("/room/saloon");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/where the scanner's operator walked/iu);
    expect(body).toMatch(/alignment is still being checked/iu);
    expect(body).not.toMatch(/\d+\.\d × \d+\.\d × \d+\.\d m/u);
  });

  it("keeps the working-scan disclaimer and the alignment caveat for a room under review", () => {
    mount("/room/saloon");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/working scan of the real room/iu);
    expect(body).toMatch(/alignment is still being checked/iu);
  });
});


// ---------------------------------------------------------------------------
// The coarse-first ladder (2026-09-04): the room arrives twice, so the page
// says which arrival it is waiting for, and the ledger carries both moments
// for the harness to time.
// ---------------------------------------------------------------------------
describe("RoomWalkPage delivery copy", () => {
  function report(progress: Partial<Record<string, unknown>>): void {
    act(() => {
      scene.push?.({
        settled: 0, total: 11, splats: 0, failed: 0, complete: false, firstView: false, ...progress,
      });
    });
  }

  it("says the room is streaming until the first view is up, then that it is sharpening", () => {
    mount("/room/grand-hall");
    report({});
    expect(screen.getByTestId("walk-loading").textContent ?? "").toMatch(/streaming/iu);

    report({ firstView: true, settled: 4 });
    const sharpening = screen.getByTestId("walk-loading").textContent ?? "";
    expect(sharpening).toMatch(/sharpening/iu);
    expect(sharpening).toContain("36%");
  });

  it("takes the pill away once the finest level is up", () => {
    mount("/room/grand-hall");
    report({ firstView: true, settled: 11, complete: true });
    expect(screen.queryByTestId("walk-loading")).toBeNull();
  });

  it("publishes the first view in the walk ledger, so a measurement can time it", () => {
    mount("/room/grand-hall");
    report({ firstView: true, settled: 2 });

    expect(window.__roomWalk).toEqual({ settled: 2, total: 11, complete: false, firstView: true });
  });
});
