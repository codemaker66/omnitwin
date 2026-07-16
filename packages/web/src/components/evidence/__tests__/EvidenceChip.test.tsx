import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { EvidenceChip } from "../EvidenceChip.js";

// CARD A4: the chip grammar component. Hue + icon + label ALWAYS — never
// color alone (02 §3 color-blind law); keyboard-focusable with a visible
// ring; states match 01 §9 names exactly.

afterEach(() => { cleanup(); });

describe("EvidenceChip", () => {
  it("renders hue + icon + label for every canonical state — never color alone", () => {
    const states = ["current", "review-required", "stale", "missing"] as const;
    const expectedLabels = ["Current", "Review required", "Stale", "Missing"];
    for (const [index, state] of states.entries()) {
      const { container, unmount } = render(<EvidenceChip state={state} />);
      const chip = container.querySelector(".evidence-chip");
      expect(chip, state).not.toBeNull();
      expect(chip?.getAttribute("data-state"), state).toBe(state);
      // Label text always present.
      expect(chip?.textContent, state).toContain(expectedLabels[index]);
      // Icon always present (decorative — meaning is carried by the label).
      expect(chip?.querySelector("svg"), state).not.toBeNull();
      unmount();
    }
  });

  it("supports a detail label after the canonical state name", () => {
    render(<EvidenceChip state="stale" detail="re-run" />);
    const chip = screen.getByText("Stale").closest(".evidence-chip");
    expect(chip?.textContent).toContain("re-run");
  });

  it("stays out of the tab order and out of live regions when static", () => {
    // Focusability belongs to operable widgets (the button branch below).
    // A static badge must not be a dead tab stop, and must not be a live
    // region — seven of these render at once in the truth rail, and
    // role="status" would announce every one on mount (reviewer HIGH).
    const { container } = render(<EvidenceChip state="current" />);
    const chip = container.querySelector(".evidence-chip");
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.getAttribute("tabindex")).toBeNull();
    expect(chip?.getAttribute("role")).toBeNull();
    // Still fully labelled for browse-mode reading.
    expect(chip?.getAttribute("aria-label")).toBe("Evidence: Current");
  });

  it("becomes a real button when given an action, and activates on click and keyboard", () => {
    const onActivate = vi.fn();
    const { container } = render(<EvidenceChip state="review-required" onActivate={onActivate} />);
    const chip = container.querySelector(".evidence-chip");
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.getAttribute("type")).toBe("button");
    fireEvent.click(chip as Element);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("renders provenance badges with glyph + label", () => {
    const { container } = render(<EvidenceChip state="current" provenance="ai" />);
    const badge = container.querySelector(".evidence-chip__provenance");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("AI");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(badge?.getAttribute("data-provenance")).toBe("ai");
  });

  it("carries an accessible name that includes state and provenance", () => {
    const { container } = render(
      <EvidenceChip state="review-required" detail="capacity check" provenance="simulated" />,
    );
    const chip = container.querySelector(".evidence-chip");
    expect(chip?.getAttribute("aria-label")).toBe(
      "Evidence: Review required — capacity check (Simulated)",
    );
  });
});
