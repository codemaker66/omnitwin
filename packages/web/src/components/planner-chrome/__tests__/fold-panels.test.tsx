import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Nothing in the new chrome works out of sight (T-680 in T-671's chrome;
// review of 6 Nov). Cleared, a panel opened into a hidden zone took the next
// Esc and left the tools to a second, and Replace… went on picking from a
// hidden rail. The real dock stack, Lay out and the keymap's tool keys are
// mounted as the planner mounts them; presses go through its one keyboard owner.
// ---------------------------------------------------------------------------

vi.mock("../../grand-hall/hall-space.js", () => ({ useModelledGrandHall: () => true }));
vi.mock("../../../api/spaces.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/spaces.js")>(),
  getVenue: vi.fn(() => new Promise(() => undefined)),
}));

const { DockStack } = await import("../DockStack.js");
const { LayOutPanel } = await import("../LayOutPanel.js");
const { useNothingOutOfSight } = await import("../nothing-out-of-sight.js");
const { ChromePresence } = await import("../../editor/cockpit/ChromeFold.js");
const { usePlannerToolKeys } = await import("../../../lib/planner-keymap.js");
const { useCardsStore } = await import("../../../stores/cards-store.js");
const { useCatalogueStore } = await import("../../../stores/catalogue-store.js");
const { cardNeeds } = await import("../../../lib/card-stock.js");
const { cardParamsFor } = await import("../../../lib/setup-cards.js");
const { useChromePresenceStore } = await import("../../../stores/chrome-presence-store.js");
const { usePlannerChromeStore } = await import("../../../stores/planner-chrome-store.js");
const { useToolStore } = await import("../../../stores/tool-store.js");

const ALL_OPEN = { left: false, right: false, top: false, bottom: false };

function Planner({ guarded = true }: { readonly guarded?: boolean }): ReactElement {
  usePlannerToolKeys();
  return (
    <>
      {guarded ? <Guard /> : null}
      <PlannerZones />
      <ChromePresence />
    </>
  );
}

function Guard(): null {
  useNothingOutOfSight();
  return null;
}

function PlannerZones(): ReactElement {
  const right = usePlannerChromeStore((state) => state.right);
  return (
    <div className="pc-shell">
      <DockStack />
      {right === "lay-out" ? <LayOutPanel /> : null}
    </div>
  );
}

function press(key: string): void {
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}

const cleared = (): boolean => useChromePresenceStore.getState().cleared;

beforeEach(() => {
  window.localStorage.clear();
  useChromePresenceStore.setState({ folded: ALL_OPEN, cleared: false, instant: false, hintPending: false, hintsShown: 0 });
  useCardsStore.getState().reset();
  usePlannerChromeStore.getState().closeAll();
  useToolStore.getState().setTool("select");
});

afterEach(() => {
  cleanup();
});

describe("a panel asked for while the tools are cleared", () => {
  it("L opens Lay out with the tools back, and one Esc closes it", () => {
    render(<Planner />);
    press("\\");
    expect(cleared()).toBe(true);
    press("l");
    expect(usePlannerChromeStore.getState().right).toBe("lay-out");
    expect(cleared()).toBe(false);
    press("Escape");
    expect(usePlannerChromeStore.getState().right).toBeNull();
    expect(cleared()).toBe(false);
  });

  it("/ opens the catalogue with the tools back, and one Esc closes it", () => {
    render(<Planner />);
    press("\\");
    press("/");
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    expect(cleared()).toBe(false);
    press("Escape");
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
  });

  it("A opens the catalogue with the tools back", () => {
    render(<Planner />);
    press("\\");
    press("a");
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    expect(cleared()).toBe(false);
  });

  it("without the guard, the hidden panel would take the first Esc (the bug it fixes)", () => {
    render(<Planner guarded={false} />);
    press("\\");
    press("l");
    expect(cleared()).toBe(true);
    press("Escape");
    expect(usePlannerChromeStore.getState().right).toBeNull();
    expect(cleared()).toBe(true);
  });
});

describe("Replace… and the cleared tools", () => {
  it("brings the tools back when it starts, since its cards are on the rail", () => {
    render(<Planner />);
    press("\\");
    act(() => { useCardsStore.getState().startReplacing("Replace Table 8 with…"); });
    expect(cleared()).toBe(false);
    // The rail says what it is doing, where it can be seen.
    expect(screen.getByTestId("planner-dock-stack").textContent).toContain("Replace Table 8 with…");
  });

  it("ends when the tools are cleared, so the next Esc brings them back", () => {
    render(<Planner />);
    act(() => { useCardsStore.getState().startReplacing("Replace Table 8 with…"); });
    press("\\");
    expect(useCardsStore.getState().replacing).toBeNull();
    expect(cleared()).toBe(true);
    press("Escape");
    expect(cleared()).toBe(false);
  });

  it("is left alone while the tools show", () => {
    render(<Planner />);
    act(() => { useCardsStore.getState().startReplacing("Replace Table 8 with…"); });
    expect(useCardsStore.getState().replacing).toBe("Replace Table 8 with…");
    expect(cleared()).toBe(false);
  });
});

// #357 V9: the digits armed cards while the tools were cleared, and the hint, or the store's
// refusal, went to the hidden rail, so on screen nothing happened.
describe("a card asked for by its digit while the tools are cleared", () => {
  function digit(n: number): void {
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: String(n), code: `Digit${String(n)}`, bubbles: true, cancelable: true })); });
  }

  beforeEach(() => { useCatalogueStore.getState().disarm(); });

  it("is put in hand with the tools back, so its hint is seen", () => {
    render(<Planner />);
    press("\\");
    expect(cleared()).toBe(true);
    digit(1);
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
    expect(cleared()).toBe(false);
    expect(screen.getByTestId("planner-dock-stack").textContent).toContain("Click the floor to set it down");
  });

  it("refused by the store, brings the tools back to say why", () => {
    render(<Planner />);
    const params = cardParamsFor("round", {});
    if (params === null) throw new Error("no round card");
    // After the dock's own stock read has run (none for a guest), as staff with none left.
    act(() => { useCardsStore.getState().setStock(new Map([...cardNeeds(params)].map(([id]) => [id, 0]))); });
    press("\\");
    digit(1);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(cleared()).toBe(false);
    expect(screen.getByTestId("planner-dock-stack").textContent).toContain("None left in store");
  });
});

// #357 V7: Lay out's line was inserted already holding its words.
describe("Lay out's voice", () => {
  it("is there, empty, from the moment the panel opens", () => {
    render(<Planner />);
    press("l");
    const panel = screen.getByTestId("lay-out-panel");
    const voice = panel.querySelector("[role='status']");
    expect(voice).not.toBeNull();
    expect(voice?.textContent).toBe("");
  });
});
