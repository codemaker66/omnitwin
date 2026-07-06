import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TwinCoachHint } from "../TwinCoachHint.js";
import { TWIN_COACH_HINT } from "../twin-copy.js";

// -----------------------------------------------------------------------------
// TwinCoachHint — the one-time "how to move" nudge (finding [3]).
//
// Renders for real under happy-dom (plain DOM, no three.js). The behaviours
// that matter: it greets a first-timer, latches "seen" so it never re-nags,
// stays away for a returning visitor, and bows out on the first interaction or
// after the idle timeout. Fake timers drive the fade/auto-dismiss.
// -----------------------------------------------------------------------------

const SEEN_KEY = "vv-twin-coach-seen";

describe("TwinCoachHint", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("greets a first-time visitor and latches 'seen' at once", () => {
    render(<TwinCoachHint />);
    expect(screen.getByTestId("twin-coach").textContent).toBe(TWIN_COACH_HINT);
    // Latched immediately, so a reload before interacting cannot re-nag.
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("stays hidden for a returning visitor", () => {
    window.localStorage.setItem(SEEN_KEY, "1");
    render(<TwinCoachHint />);
    expect(screen.queryByTestId("twin-coach")).toBeNull();
  });

  it("bows out on the first interaction", () => {
    render(<TwinCoachHint />);
    expect(screen.queryByTestId("twin-coach")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    // The fade plays out, then the pill unmounts.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByTestId("twin-coach")).toBeNull();
  });

  it("auto-dismisses if the visitor never touches it", () => {
    render(<TwinCoachHint />);
    expect(screen.queryByTestId("twin-coach")).not.toBeNull();
    // The idle timeout flips it to leaving; the effect then schedules the fade.
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    // A second tick lets that fade play out and the pill unmount.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByTestId("twin-coach")).toBeNull();
  });
});
