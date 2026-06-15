import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ProposalLayoutSnapshot } from "@omnitwin/types";
import { ProposalLayoutVisual } from "../ProposalLayoutVisual.js";

afterEach(() => { cleanup(); });

function snapshot(overrides: Partial<ProposalLayoutSnapshot> = {}): ProposalLayoutSnapshot {
  return {
    roomWidthM: 20,
    roomLengthM: 10,
    items: [
      { shape: "round", kind: "table", xM: 4, zM: 3, widthM: 1.8, depthM: 1.8, rotationDeg: 0 },
      { shape: "rect", kind: "chair", xM: 4, zM: 4.5, widthM: 0.45, depthM: 0.45, rotationDeg: 0 },
      { shape: "rect", kind: "stage", xM: 10, zM: 1, widthM: 6, depthM: 3, rotationDeg: 90 },
    ],
    ...overrides,
  };
}

describe("ProposalLayoutVisual", () => {
  it("renders an accessible read-only SVG plan with room + footprints", () => {
    const { container } = render(<ProposalLayoutVisual snapshot={snapshot()} />);
    const svg = screen.getByTestId("proposal-layout-visual");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/1 tables, 1 seats, room about 20\.0 by 10\.0 metres/);

    // Round table → ellipse; rect items → rect; plus the room rect.
    expect(container.querySelectorAll("ellipse").length).toBe(1);
    expect(container.querySelectorAll("rect").length).toBe(1 + 2);
  });

  it("rotates rectangular footprints around their centre", () => {
    const { container } = render(
      <ProposalLayoutVisual snapshot={snapshot({
        items: [{ shape: "rect", kind: "stage", xM: 10, zM: 5, widthM: 6, depthM: 3, rotationDeg: 45 }],
      })} />,
    );
    const rects = Array.from(container.querySelectorAll("rect"));
    const rotated = rects.find((r) => (r.getAttribute("transform") ?? "").includes("rotate(45"));
    expect(rotated).toBeDefined();
  });

  it("renders nothing when there are no items", () => {
    const { container } = render(<ProposalLayoutVisual snapshot={snapshot({ items: [] })} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing for a degenerate room", () => {
    const { container } = render(<ProposalLayoutVisual snapshot={snapshot({ roomWidthM: 0 })} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
