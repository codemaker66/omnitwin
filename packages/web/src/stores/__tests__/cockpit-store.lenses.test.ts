import { afterEach, describe, expect, it, vi } from "vitest";
import { COCKPIT_MODES, type CockpitMode } from "../../lib/cockpit-modes.js";
import { useCockpitStore } from "../cockpit-store.js";

// Blake's decision 5 as the store holds it: whoever asks, a lens the viewer's
// rail does not offer cannot be opened, and one the viewer stops being offered
// goes back to Design. The cockpit decides what is offered (lib/use-lens-rail).

const ALL: readonly CockpitMode[] = COCKPIT_MODES.map((mode) => mode.id);
const CLIENT_FOUR: readonly CockpitMode[] = ["design", "guests", "costs", "share"];

afterEach(() => { useCockpitStore.getState().reset(); });

describe("cockpit-store: offered lenses", () => {
  it("offers all eleven until the cockpit says otherwise", () => {
    expect(useCockpitStore.getState().offeredModes).toEqual(ALL);
    for (const mode of ALL) {
      useCockpitStore.getState().setMode(mode);
      expect(useCockpitStore.getState().activeMode).toBe(mode);
    }
  });

  it("refuses a lens the viewer is not offered, from any caller, and stays where it was", () => {
    useCockpitStore.getState().offerModes(CLIENT_FOUR);
    useCockpitStore.getState().setMode("costs");
    useCockpitStore.getState().setMode("rigging");
    expect(useCockpitStore.getState().activeMode).toBe("costs");
    useCockpitStore.getState().setMode("flow");
    expect(useCockpitStore.getState().activeMode).toBe("costs");
    useCockpitStore.getState().setMode("share");
    expect(useCockpitStore.getState().activeMode).toBe("share");
  });

  it("puts an active lens the viewer is no longer offered back to Design", () => {
    useCockpitStore.getState().setMode("rigging");
    useCockpitStore.getState().offerModes(CLIENT_FOUR);
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(useCockpitStore.getState().offeredModes).toEqual(CLIENT_FOUR);
  });

  it("keeps an active lens the viewer is still offered", () => {
    useCockpitStore.getState().setMode("guests");
    useCockpitStore.getState().offerModes(CLIENT_FOUR);
    expect(useCockpitStore.getState().activeMode).toBe("guests");
  });

  it("does not notify when the same lenses are offered again", () => {
    useCockpitStore.getState().offerModes(CLIENT_FOUR);
    const listener = vi.fn();
    const unsubscribe = useCockpitStore.subscribe(listener);
    useCockpitStore.getState().offerModes([...CLIENT_FOUR]);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify for a refused lens", () => {
    useCockpitStore.getState().offerModes(CLIENT_FOUR);
    const listener = vi.fn();
    const unsubscribe = useCockpitStore.subscribe(listener);
    useCockpitStore.getState().setMode("power");
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("offers all eleven again after reset", () => {
    useCockpitStore.getState().offerModes(CLIENT_FOUR);
    useCockpitStore.getState().reset();
    expect(useCockpitStore.getState().offeredModes).toEqual(ALL);
  });
});
