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

  it.each(["grand-hall", "reception-room", "saloon", "south-gallery", "deacon-conveners-room"])(
    "connects the %s tour to a fresh plan for the same room",
    (room) => {
      mount(`/room/${room}`);
      expect(screen.getByRole("link", { name: "Plan this room" }).getAttribute("href"))
        .toBe(`/plan?space=${room}`);
    },
  );

  // T-616 / gate line 2: this used to pin Dashboard and Hallkeeper into a
  // PUBLIC room walk. Both bounced an anonymous visitor into a Clerk login
  // wall, so the page advertised two doors its reader cannot open. What a
  // visitor standing in a room wants is a date, so the exits are now: plan
  // this room, ask about a date, log in.
  it("offers a public visitor only exits they can actually take", () => {
    mount("/room/grand-hall");
    expect(screen.getByRole("navigation", { name: "Planning and workspaces" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask about a date" }).getAttribute("href")).toBe("/#enquire");
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Hallkeeper" })).toBeNull();
  });

  it("keeps capture-only renders free of navigation", () => {
    mount("/room/grand-hall?bare=1");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("keeps the room name and dimensions without capture counts", () => {
    mount("/room/grand-hall");
    const header = screen.getByRole("banner").textContent ?? "";
    expect(header).toContain("Grand Hall");
    expect(header).toMatch(/\d+\.\d × \d+\.\d × \d+\.\d m/u);
    expect(header).not.toMatch(/splats/u);
  });

  // The three below pinned "being aligned", "not yet walkable", "Incomplete
  // scan" and "Alignment is under review" — four phrases about OUR work, on a
  // page a wedding guest reads. The behaviour they guard is unchanged and is
  // what they assert now: a closed room mounts no scene and offers a way back,
  // and a room the scan did not measure cleanly prints no dimensions.
  it("does not mount a room whose walk is closed, and says so without jargon", () => {
    mount("/room/robert-adam-room");
    expect(screen.queryByTestId("room-splat-scene")).toBeNull();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/not open to walk yet/iu);
    expect(body).not.toMatch(/aligned|alignment|incomplete scan/iu);
    expect(screen.getByRole("link", { name: /rooms/iu }).getAttribute("href")).toBe("/");
  });

  it("withholds the dimensions of a room whose scan did not measure cleanly", () => {
    mount("/room/saloon");
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\d+\.\d × \d+\.\d × \d+\.\d m/u);
    expect(body).toMatch(/come from the venue, not this scan/iu);
    expect(body).not.toMatch(/incomplete scan|alignment/iu);
  });

  it("tells a visitor of a measured room where its dimensions came from", () => {
    mount("/room/grand-hall");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/dimensions are taken from the scan/iu);
    expect(body).toMatch(/confirm them with the venue/iu);
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
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("36");
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it("takes the pill away once the finest level is up", () => {
    mount("/room/grand-hall");
    report({ firstView: true, settled: 11, complete: true });
    expect(screen.queryByTestId("walk-loading")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("publishes the first view in the walk ledger, so a measurement can time it", () => {
    mount("/room/grand-hall");
    report({ firstView: true, settled: 2 });

    expect(window.__roomWalk).toEqual({ settled: 2, total: 11, complete: false, firstView: true });
  });
});
