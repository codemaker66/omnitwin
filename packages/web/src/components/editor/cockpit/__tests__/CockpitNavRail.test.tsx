import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitNavRail } from "../CockpitNavRail.js";

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("CockpitNavRail", () => {
  it("renders nine lens buttons with Design pressed by default", () => {
    render(<CockpitNavRail />);
    const buttons = screen.getAllByRole("button", { name: /design|guests|flow|evidence|lighting|power|ops|costs|share/i });
    expect(buttons.length).toBeGreaterThanOrEqual(9);
    expect(screen.getByRole("button", { name: /design/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the active lens in the store on click", () => {
    render(<CockpitNavRail />);
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(useCockpitStore.getState().activeMode).toBe("flow");
    expect(screen.getByRole("button", { name: /flow/i }).getAttribute("aria-pressed")).toBe("true");
  });
});
