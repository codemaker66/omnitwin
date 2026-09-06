import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CaptionRegion } from "../CaptionRegion.js";
import { CAPTION_DEBOUNCE_MS, createCaptionStore } from "../captions.js";
import { manualClock } from "./fake-audio-context.js";

afterEach(cleanup);

describe("CaptionRegion", () => {
  it("renders exactly one polite live region and shows the caption when captions are on", () => {
    const clock = manualClock();
    const store = createCaptionStore({ schedule: clock.schedule });
    render(<CaptionRegion store={store} captionsOn />);
    const region = screen.getByTestId("quiz-captions");
    const live = region.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute("aria-live")).toBe("polite");
    expect(live[0]?.getAttribute("aria-atomic")).toBe("true");
    expect(region.getAttribute("data-captions")).toBe("on");
    expect(live[0]?.textContent).toBe("");
    act(() => {
      store.announce("[the chain swings]");
    });
    expect(screen.getByText("[the chain swings]")).toBeTruthy();
  });

  it("keeps the region live but marks it hidden when captions are off", () => {
    const store = createCaptionStore({ schedule: manualClock().schedule });
    render(<CaptionRegion store={store} captionsOn={false} className="stage-captions" />);
    const region = screen.getByTestId("quiz-captions");
    expect(region.getAttribute("data-captions")).toBe("off");
    expect(region.className).toBe("quiz-caption-region stage-captions");
    expect(region.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    act(() => {
      store.announce("[a ring spreads]");
    });
    expect(screen.getByText("[a ring spreads]")).toBeTruthy();
  });

  it("re-keys the caption so the same words twice are announced twice", () => {
    const clock = manualClock();
    const store = createCaptionStore({ schedule: clock.schedule });
    render(<CaptionRegion store={store} captionsOn />);
    act(() => {
      store.announce("[the lantern gutters]");
    });
    const first = screen.getByText("[the lantern gutters]");
    act(() => {
      clock.advance(CAPTION_DEBOUNCE_MS);
      store.announce("[the lantern gutters]");
    });
    const second = screen.getByText("[the lantern gutters]");
    expect(second).not.toBe(first);
  });
});
