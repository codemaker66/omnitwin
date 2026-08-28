import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// THE HERO'S MOUNT GATE — "lazy" is not the same word as "not downloaded".
//
// FreshPage mounts <ArrivalHero/> through React.lazy. For as long as that
// mount was UNCONDITIONAL, every homepage visit fetched and executed the hero
// chunk before the component's own no-key gate could return null: 324,840 B
// gzip / 1,167,199 B raw on a keyless production build — the hero chunk, its
// CSS, the whole `three` vendor chunk this marketing page does not otherwise
// touch, useTwinManifest, device-store, springs — plus a wasted
// /twin/trades-hall/manifest.json round trip, on the LCP-critical homepage,
// in exchange for a component that renders nothing. The numbers and the
// method are recorded above arrivalHeroCanRun() in FreshPage.tsx.
//
// Nothing could have caught that. Every existing test renders the page in an
// environment where the hero is SUPPOSED to mount, and asks what the DOM
// looks like afterwards — a question whose answer ("no .arrival-hero") is
// identical whether the chunk was skipped or downloaded, run, and gated to
// null. So this file asks the other question: was the module loaded at all.
// `heroModule.loads` counts invocations of the mocked ArrivalHero module's
// factory, which is exactly when a real build would issue the network
// request, so a zero here is the byte saving stated above and a regression
// to the unconditional mount fails on this line.
//
// WHY BOTH DIRECTIONS ARE PINNED. The gate has two arms and each protects
// something different, so a test for one alone would license breaking the
// other:
//   - `googleTilesApiKey() !== null` is the byte saving;
//   - `import.meta.env.DEV` is what keeps e2e/arrival.spec.ts and
//     e2e/arrival-hero-controls.spec.ts alive. Both reach the hero's phases
//     through the DEV-only `?arrivalPhase=` seam, which lives INSIDE the
//     chunk and is therefore worthless if the chunk never mounts. CI runs
//     them against the Vite dev server, so DEV is true exactly where they
//     run. Tightening the gate to "key only" would leave the hero with no
//     browser coverage anywhere on earth without a paid Map Tiles key.
// Vitest runs with import.meta.env.DEV === true (the same fact
// arrival-dev-harness.test.ts relies on), so the dev arm is the ambient case
// and the production arm is reached with vi.stubEnv.
// ---------------------------------------------------------------------------

/** Bumped by the mocked hero module's factory — i.e. once per chunk fetch. */
const heroModule = { loads: 0 };

// vi.doMock, NOT vi.mock, AND IT MATTERS — this counter was silently dead
// once already. With hoisted vi.mock, the factory runs on the FIRST import of
// the mocked module and never again: vi.resetModules() clears the module
// cache, but the second test's re-import was served without re-invoking the
// factory, so `loads` stayed 0 even when the hero really did mount and render.
// Proved, not reasoned: with VITE_GOOGLE_MAPS_TILES_KEY set — which forces the
// gate open — the `loads === 0` line still PASSED and only the DOM assertion
// below it failed. An assertion that holds in the state it exists to forbid is
// not an assertion. vi.doMock is registered per test, after vi.resetModules(),
// so the factory is genuinely re-entered on every case and the count is live
// in both directions (re-run that same falsification and `loads` fails first).
function mockHeroModules(): void {
  // The walk chunk carries three + Spark, far beyond happy-dom. Same stub
  // fresh.test.tsx uses, for the same reason.
  vi.doMock("../FreshWalk.js", () => ({
    default: () => <div data-testid="fresh-walk-stub" />,
  }));
  // Deliberately a WORKING hero, unlike fresh-arrival-boundary.test.tsx's
  // rejecting one: the question here is whether the module is reached, so it
  // must be able to render if it is.
  vi.doMock("../../landing/arrival/ArrivalHero.js", () => {
    heroModule.loads += 1;
    return { ArrivalHero: () => <div data-testid="arrival-hero-stub" /> };
  });
}

async function renderFreshPage(): Promise<void> {
  mockHeroModules();
  // Imported per test, after the env is stubbed and the registry reset, so
  // each case gets a fresh module graph and a fresh factory invocation.
  const { FreshPage } = await import("../FreshPage.js");
  render(<FreshPage />);
}

beforeEach(() => {
  vi.resetModules();
  heroModule.loads = 0;
});

afterEach(() => {
  cleanup();
  vi.doUnmock("../FreshWalk.js");
  vi.doUnmock("../../landing/arrival/ArrivalHero.js");
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("FreshPage — the Arrival hero's mount gate", () => {
  it("mounts the hero in a dev build, so the e2e phase seam can still reach it", async () => {
    // The premise the second arm of the gate rests on, asserted rather than
    // assumed: if this ever became false, the two Playwright specs would go
    // silently dark rather than fail.
    expect(import.meta.env.DEV).toBe(true);

    await renderFreshPage();

    await waitFor(() => {
      expect(screen.queryByTestId("arrival-hero-stub")).not.toBeNull();
    });
    expect(heroModule.loads).toBe(1);
  });

  it("never requests the hero chunk on a keyless production build", async () => {
    vi.stubEnv("DEV", false);

    await renderFreshPage();

    // Give React every chance to resolve a lazy child: if the mount were
    // still unconditional, the stub would appear within these ticks.
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(heroModule.loads).toBe(0);
    expect(screen.queryByTestId("arrival-hero-stub")).toBeNull();

    // And the guarantee that outranks the byte count: the photograph, and the
    // page around it, are untouched by the hero not being there at all.
    expect(document.querySelector("img.fr-hero-photo")).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
