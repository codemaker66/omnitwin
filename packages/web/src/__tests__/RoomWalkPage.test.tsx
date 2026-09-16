import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The walk page mounts a real R3F canvas through RoomSplatScene. That scene is
// stubbed so the assertions are about what the PAGE says — the header count,
// the honesty copy — not about WebGL, which happy-dom cannot provide.
const scene = vi.hoisted(() => ({
  push: null as null | ((p: Record<string, unknown>) => void),
  /** The scene reports a lost drawing context through this. */
  lost: null as null | ((lost: boolean) => void),
  /** How much of the touch vocabulary the page asked for. */
  touchLocomotion: null as null | string,
}));
vi.mock("../components/rooms/RoomSplatScene.js", () => ({
  RoomSplatScene: ({ room, onProgress, onRendererLost, touchLocomotion }: {
    readonly room: string;
    readonly onProgress?: (p: Record<string, unknown>) => void;
    readonly onRendererLost?: (lost: boolean) => void;
    readonly touchLocomotion?: string;
  }) => {
    scene.push = onProgress ?? null;
    scene.lost = onRendererLost ?? null;
    scene.touchLocomotion = touchLocomotion ?? null;
    return <div data-testid="room-splat-scene">{room}</div>;
  },
}));

const { RoomWalkPage, walkStatusLine } = await import("../pages/RoomWalkPage.js");

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

  // Changed 2026-09-16 (T-617). This used to REQUIRE the dashboard, the
  // hallkeeper's day and the log-in on the public walk. They are three
  // invitations to a locked room for the visitor this page is for, and the
  // test now pins their absence rather than their presence.
  it("offers a visitor's door and no staff entrances", () => {
    mount("/room/grand-hall");
    expect(screen.getByRole("navigation", { name: "Planning this room" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan this room" })).toBeTruthy();
    for (const name of ["Dashboard", "Hallkeeper", "Log in"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    const banner = screen.getByRole("banner");
    for (const href of ["/dashboard", "/hallkeeper/today", "/login"]) {
      expect(banner.querySelector(`a[href="${href}"]`)).toBeNull();
    }
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
    expect(body).toMatch(/Incomplete scan/iu);
    expect(body).toMatch(/Alignment is under review/iu);
    expect(body).not.toMatch(/\d+\.\d × \d+\.\d × \d+\.\d m/u);
  });

  it("keeps the working-scan disclaimer and the alignment caveat for a room under review", () => {
    mount("/room/saloon");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Incomplete scan/iu);
    expect(body).toMatch(/Alignment is under review/iu);
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

    // The ledger carries the words as well as the numbers: a measurement that
    // cannot say what the visitor was being told is half a measurement.
    expect(window.__roomWalk).toEqual({
      settled: 2,
      total: 11,
      complete: false,
      firstView: true,
      splats: 0,
      failed: 0,
      status: "Sharpening the room — 18%",
    });
  });

  // -------------------------------------------------------------------------
  // Nought per cent
  //
  // The pill used to flip to "Sharpening the room - 0%" the moment the coarse
  // room landed and sit there for the whole finest level: 106,479,738 bytes
  // over eleven tiles in the Grand Hall, which is minutes on a phone. Zero is
  // the one number that reads as broken, and it was shown at the exact moment
  // the room had in fact just arrived.
  // -------------------------------------------------------------------------

  it("never shows nought per cent once the room is on screen", () => {
    mount("/room/grand-hall");
    report({ firstView: true, settled: 0 });

    const pill = screen.getByTestId("walk-loading").textContent ?? "";
    expect(pill).not.toMatch(/0\s*%/u);
    expect(pill).toMatch(/The room is here\. Sharpening it\./u);
    // No number means no progress bar to sit at zero either.
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("floors the first countable tile at one per cent", () => {
    mount("/room/grand-hall");
    // One tile of a large set rounds to zero; zero is the thing that must
    // never be shown once something has happened.
    report({ firstView: true, settled: 1, total: 500 });

    expect(screen.getByTestId("walk-loading").textContent ?? "").toContain("1%");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });

  it("says streaming, not nought per cent, before the first view", () => {
    mount("/room/grand-hall");
    report({ firstView: false, settled: 0 });

    const pill = screen.getByTestId("walk-loading").textContent ?? "";
    expect(pill).toMatch(/streaming/iu);
    expect(pill).not.toMatch(/%/u);
  });
});

// ---------------------------------------------------------------------------
// walkStatusLine, on its own
// ---------------------------------------------------------------------------

describe("walkStatusLine", () => {
  const base = { settled: 0, total: 11, splats: 0, failed: 0, complete: false, firstView: false };

  it("offers no percentage before there is one to stand behind", () => {
    expect(walkStatusLine(base).percent).toBeUndefined();
    expect(walkStatusLine({ ...base, firstView: true }).percent).toBeUndefined();
    expect(walkStatusLine({ ...base, firstView: true, total: 0 }).percent).toBeUndefined();
  });

  it("never returns nought", () => {
    for (let total = 1; total <= 400; total += 1) {
      for (const settled of [0, 1]) {
        const line = walkStatusLine({ ...base, firstView: true, settled, total });
        expect(line.percent === undefined || line.percent >= 1).toBe(true);
        expect(line.label).not.toMatch(/\b0\s*%/u);
      }
    }
  });

  it("reaches a hundred when every tile is in", () => {
    expect(walkStatusLine({ ...base, firstView: true, settled: 11, total: 11 }).percent).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// The view being taken away, and the way out of the page
// ---------------------------------------------------------------------------

describe("RoomWalkPage renderer loss", () => {
  it("says something calm first, and only offers a reload after a fair wait", () => {
    vi.useFakeTimers();
    try {
      mount("/room/grand-hall");
      act(() => { scene.lost?.(true); });

      const pill = screen.getByTestId("walk-context-lost").textContent ?? "";
      expect(pill).toMatch(/The view paused/u);
      expect(screen.queryByTestId("walk-reload")).toBeNull();

      act(() => { vi.advanceTimersByTime(6_000); });
      expect(screen.getByTestId("walk-context-lost").textContent ?? "")
        .toMatch(/The view has not come back/u);
      expect(screen.getByTestId("walk-reload")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the message away when the context comes back", () => {
    vi.useFakeTimers();
    try {
      mount("/room/grand-hall");
      act(() => { scene.lost?.(true); });
      act(() => { vi.advanceTimersByTime(6_000); });
      expect(screen.getByTestId("walk-reload")).toBeTruthy();

      act(() => { scene.lost?.(false); });
      expect(screen.queryByTestId("walk-context-lost")).toBeNull();
      expect(screen.queryByTestId("walk-reload")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not talk about streaming while the view is gone", () => {
    mount("/room/grand-hall");
    act(() => {
      scene.push?.({
        settled: 3, total: 11, splats: 0, failed: 0, complete: false, firstView: true,
      });
    });
    expect(screen.getByTestId("walk-loading")).toBeTruthy();

    act(() => { scene.lost?.(true); });
    expect(screen.queryByTestId("walk-loading")).toBeNull();
    expect(screen.getByTestId("walk-context-lost")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The full-screen control and the touch kill order
// ---------------------------------------------------------------------------

describe("RoomWalkPage chrome", () => {
  function allowFullscreen(allowed: boolean): void {
    Object.defineProperty(document, "fullscreenEnabled", { value: allowed, configurable: true });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: allowed ? () => Promise.resolve() : undefined,
      configurable: true,
    });
  }

  it("offers full screen only where the browser can actually do it", () => {
    // An iPhone's Safari has no Element.requestFullscreen at all. Showing a
    // control that then fails silently is worse than its absence.
    allowFullscreen(false);
    mount("/room/grand-hall");
    expect(screen.queryByTestId("walk-fullscreen")).toBeNull();
    cleanup();

    allowFullscreen(true);
    mount("/room/grand-hall");
    const control = screen.getByTestId("walk-fullscreen");
    expect(control.getAttribute("aria-pressed")).toBe("false");
    expect(control.textContent).toBe("Full screen");
  });

  it("keeps the whole vocabulary by default and withdraws it on the kill order", () => {
    mount("/room/grand-hall");
    expect(scene.touchLocomotion).toBe("full");
    cleanup();

    mount("/room/grand-hall?touch=tap");
    expect(scene.touchLocomotion).toBe("tap-only");
  });

  it("keeps a capture-only render free of every control", () => {
    allowFullscreen(true);
    mount("/room/grand-hall?bare=1");
    expect(screen.queryByTestId("walk-fullscreen")).toBeNull();
    expect(screen.queryByTestId("walk-loading")).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// Nothing floating over the room may swallow a tap
//
// Found by a real-touch probe, not by these tests: on a 390x844 Chromium
// driven through CDP Input.dispatchTouchEvent, a tap at (195, 760) landed on
// the status pill and never reached the canvas, so tap-to-glide did nothing
// in the one place a visitor aims first - the floor just in front of them.
// The pill reports; it does not take input. Asserted against the stylesheet
// because happy-dom does not load it and no unit test could otherwise see it.
// ---------------------------------------------------------------------------

describe("the walk stylesheet", () => {
  // Resolved from the vitest root (packages/web) rather than import.meta.url,
  // which the module runner serves over http and fileURLToPath refuses.
  const css = readFileSync(resolve("src/pages/RoomWalkPage.css"), "utf8");

  function ruleBody(selector: string): string {
    const at = css.indexOf(selector + " {");
    expect(at, selector + " is missing from RoomWalkPage.css").toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  }

  it.each([".walk__bar", ".walk__foot", ".walk__loading"])(
    "%s lets a tap through to the room",
    (selector) => {
      expect(ruleBody(selector)).toMatch(/pointer-events:\s*none/u);
    },
  );

  it.each([".walk__bar > *", ".walk__reload"])(
    "%s takes its own input back",
    (selector) => {
      expect(ruleBody(selector)).toMatch(/pointer-events:\s*auto/u);
    },
  );

  it("measures the viewport in dvh as well as vh", () => {
    // 100vh is the TALLEST a phone viewport ever gets, so the room's bottom
    // edge would spend the whole visit behind the address bar.
    expect(css).toMatch(/min-height:\s*100vh/u);
    expect(css).toMatch(/min-height:\s*100dvh/u);
  });

  it("adds the safe-area insets rather than replacing the padding", () => {
    // A device without a notch must be unchanged.
    expect(css).toMatch(/calc\(1rem \+ env\(safe-area-inset-top\)\)/u);
    expect(css).toMatch(/calc\(4\.5rem \+ env\(safe-area-inset-bottom\)\)/u);
  });
});
