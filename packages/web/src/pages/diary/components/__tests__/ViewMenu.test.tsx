import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewMenu } from "../ViewMenu.js";

// ---------------------------------------------------------------------------
// The View menu (roadmap N3's reduced toolbar): a disclosure holding released
// and cancelled bookings, Refresh and How the Diary works. It closes on a
// press or focus outside and on Escape, and whatever it does, focus is left
// on its button.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

function renderMenu(showExited = false): { onShowExited: ReturnType<typeof vi.fn>; onRefresh: ReturnType<typeof vi.fn>; onHowItWorks: ReturnType<typeof vi.fn> } {
  const onShowExited = vi.fn();
  const onRefresh = vi.fn();
  const onHowItWorks = vi.fn();
  render(
    <div>
      <button type="button">Elsewhere</button>
      <ViewMenu showExited={showExited} onShowExited={onShowExited} onRefresh={onRefresh} onHowItWorks={onHowItWorks} />
    </div>,
  );
  return { onShowExited, onRefresh, onHowItWorks };
}

describe("ViewMenu", () => {
  it("opens under its button and holds the three ways the board is read", () => {
    renderMenu();
    const view = screen.getByRole("button", { name: "View" });
    expect(view.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    fireEvent.click(view);
    expect(view.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Show released & cancelled" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDefined();
    expect(screen.getByRole("button", { name: "How the Diary works" }).getAttribute("aria-keyshortcuts")).toBe("?");
  });

  it("keeps itself open while released and cancelled bookings are shown or hidden", () => {
    const { onShowExited } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show released & cancelled" }));
    expect(onShowExited).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "View" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("closes when it acts, with focus on its button", () => {
    const { onRefresh, onHowItWorks } = renderMenu();
    const view = screen.getByRole("button", { name: "View" });
    fireEvent.click(view);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(view);

    fireEvent.click(view);
    fireEvent.click(screen.getByRole("button", { name: "How the Diary works" }));
    expect(onHowItWorks).toHaveBeenCalledTimes(1);
    // Focus is on View before the guide opens, so the guide returns it there.
    expect(document.activeElement).toBe(view);
  });

  it("closes on Escape with focus back on its button, and on a press or focus outside", () => {
    renderMenu();
    const view = screen.getByRole("button", { name: "View" });
    fireEvent.click(view);
    screen.getByRole("button", { name: "Refresh" }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(view.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(view);

    fireEvent.click(view);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(view.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(view);
    act(() => { screen.getByRole("button", { name: "Elsewhere" }).focus(); });
    expect(view.getAttribute("aria-expanded")).toBe("false");
  });
});
