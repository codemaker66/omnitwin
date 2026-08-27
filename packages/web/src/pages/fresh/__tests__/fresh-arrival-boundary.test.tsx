import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useArrivalStore } from "../../landing/arrival/arrival-store.js";

// ---------------------------------------------------------------------------
// The hero armor, AT THE SITE WHERE IT IS ACTUALLY DEPLOYED — Task 12b review
// finding 3.
//
// ArrivalErrorBoundary.test.tsx proves the component contains a throw in a
// hand-built harness. Nothing proved it was WIRED INTO FreshPage: both lines
// could have been deleted from FreshPage.tsx and every arrival test, plus all
// of fresh.test.tsx, would still have passed. This file closes that, twice
// over:
//
//   1. behaviourally — FreshPage is rendered with the lazy hero module made to
//      REJECT, which is the real production shape (a deploy purges the chunk
//      hashes an already-open tab's index.html still names). The homepage must
//      survive it whole.
//   2. structurally — the boundary must sit OUTSIDE the `<Suspense>`, and be
//      imported eagerly rather than lazily. Neither is observable from the
//      rendered DOM, and both are the reason the behaviour above holds, so
//      they are pinned against the source text (the same tripwire pattern
//      this repo already uses in src/__tests__/GltfFurniture.test.ts:75).
//
// Its own file, not a case inside fresh.test.tsx: the module mock below has to
// make the hero fail for the whole module, and fresh.test.tsx renders the same
// page expecting a working one.
// ---------------------------------------------------------------------------

// The walk chunk carries three + Spark — far beyond happy-dom. Same stub
// fresh.test.tsx uses, for the same reason.
vi.mock("../FreshWalk.js", () => ({
  default: () => <div data-testid="fresh-walk-stub" />,
}));

// A rejecting dynamic import: exactly what a stale index.html pointing at
// purged chunk hashes produces, down to the browser's own message.
vi.mock("../../landing/arrival/ArrivalHero.js", () =>
  Promise.reject(new Error("Failed to fetch dynamically imported module")),
);

/**
 * A hand-rolled console.error capture rather than vi.spyOn: `console.error`'s
 * `(...data: any[])` signature collapses spyOn's return type to `any`, which
 * this repo's strictTypeChecked lint rejects. React logs the caught error on
 * this channel, and the boundary logs its own line — neither is noise worth
 * printing on a passing run.
 */
function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  /* eslint-disable no-console -- capturing the channel IS the point here */
  const original = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
  /* eslint-enable no-console */
}

/** Only the hero's own diagnostics, never React's or anything else's. */
function arrivalLogs(calls: readonly unknown[][]): unknown[][] {
  return calls.filter((args) => typeof args[0] === "string" && args[0].startsWith("Arrival:"));
}

async function readFreshPageSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const raw = await fs.readFile(path.resolve("src/pages/fresh/FreshPage.tsx"), "utf-8");
  // Comments stripped so a sentence describing the wiring can never be
  // mistaken for the wiring.
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("FreshPage — a hero chunk that fails to load cannot take the homepage with it", () => {
  let consoleError: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    useArrivalStore.getState().reset();
    consoleError = captureConsoleError();
  });

  afterEach(() => {
    cleanup();
    consoleError.restore();
    window.localStorage.clear();
  });

  it("renders the whole page, photograph included, when the hero chunk rejects", async () => {
    const { FreshPage } = await import("../FreshPage.js");
    render(<FreshPage />);

    // The boundary is what turns the rejection into a store write; waiting on
    // it is waiting on the containment itself, not on a timer.
    await waitFor(() => {
      expect(useArrivalStore.getState().failReason).toBe("crash");
    });

    // The thing spec §6 promises can never break.
    const photo = document.querySelector("img.fr-hero-photo");
    expect(photo).not.toBeNull();
    // And the page around it: headline, rooms, rates — all still here.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelector('[data-room-caps="grand-hall"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-rate-row]").length).toBeGreaterThan(0);
    // Nothing of the live hero mounted.
    expect(document.querySelector(".arrival-hero")).toBeNull();
    // And it is not silent: one line, naming the hero.
    expect(arrivalLogs(consoleError.calls)).toHaveLength(1);
  });

  it("leaves the store in fallback so nothing downstream waits on a hero that will never arrive", async () => {
    const { FreshPage } = await import("../FreshPage.js");
    render(<FreshPage />);

    await waitFor(() => {
      expect(useArrivalStore.getState().phase).toBe("fallback");
    });
  });
});

describe("FreshPage — the wiring the behaviour above depends on", () => {
  it("wraps the Suspense in ArrivalErrorBoundary, boundary OUTSIDE", async () => {
    const source = await readFreshPageSource();
    // Order matters and is invisible at runtime: Suspense is not an error
    // boundary and re-throws a rejected chunk import, so the boundary has to
    // be the outer of the two. This exact nesting is the deployed shape.
    expect(source).toMatch(
      /<ArrivalErrorBoundary>\s*<Suspense\s+fallback=\{null\}>\s*<ArrivalHero\s*\/>\s*<\/Suspense>\s*<\/ArrivalErrorBoundary>/,
    );
  });

  it("imports the boundary eagerly — it cannot live inside the chunk it guards", async () => {
    const source = await readFreshPageSource();
    expect(source).toMatch(
      /import\s*\{\s*ArrivalErrorBoundary\s*\}\s*from\s*"\.\.\/landing\/arrival\/ArrivalErrorBoundary\.js"/,
    );
    // The hero, by contrast, IS lazy — that asymmetry is the whole point.
    expect(source).toMatch(/const\s+ArrivalHero\s*=\s*lazy\(/);
    expect(source).not.toMatch(/ArrivalErrorBoundary\s*=\s*lazy\(/);
  });
});
