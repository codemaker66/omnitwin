import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The walk page mounts a real R3F canvas through RoomSplatScene. That scene is
// stubbed so the assertions are about what the PAGE says — the header count,
// the honesty copy — not about WebGL, which happy-dom cannot provide.
vi.mock("../components/rooms/RoomSplatScene.js", () => ({
  RoomSplatScene: ({ room }: { readonly room: string }) => (
    <div data-testid="room-splat-scene">{room}</div>
  ),
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
