import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TwinScanNode } from "@omnitwin/types";
import { TwinMinimap, minimapViewBox, yawToMinimapRotationDeg } from "../TwinMinimap.js";

// -----------------------------------------------------------------------------
// TwinMinimap — top-down scan graph with teleport (Twin Phase 1, Task 10).
//
// Pure SVG + DOM, no three.js: dots at (t.x, −t.y), a listbox with per-dot
// options, floor toggles that dim the other storey, and arrow-key selection
// with Enter-to-teleport. Everything here renders for real under happy-dom.
// -----------------------------------------------------------------------------

function node(
  id: string,
  index: number,
  x: number,
  y: number,
  floor = 0,
): TwinScanNode {
  return { id, index, pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] }, floor, roomSlug: null };
}

/** Three ground-floor scans in an L, one first-floor scan off to the side. */
const nodes: readonly TwinScanNode[] = [
  node("scan_000", 0, 0, 0),
  node("scan_001", 1, 4, 0),
  node("scan_002", 2, 0, 4),
  node("scan_003", 3, 10, 10, 1),
];

function mountMinimap(
  overrides: Partial<{
    currentId: string;
    yaw: number;
    onSelect: (id: string) => void;
    nodes: readonly TwinScanNode[];
  }> = {},
): { onSelect: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn();
  render(
    <TwinMinimap
      nodes={overrides.nodes ?? nodes}
      currentId={overrides.currentId ?? "scan_000"}
      yaw={overrides.yaw ?? 0}
      onSelect={overrides.onSelect ?? onSelect}
    />,
  );
  return { onSelect };
}

afterEach(() => {
  cleanup();
});

describe("TwinMinimap — rendering", () => {
  it("renders one option per fixture node inside a labelled listbox", () => {
    mountMinimap();
    expect(screen.getByRole("listbox", { name: "Scan positions" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("carries a Go-to aria-label on every dot", () => {
    mountMinimap();
    for (const index of [0, 1, 2, 3]) {
      expect(
        screen.getByRole("option", { name: `Go to scan ${String(index)}` }),
      ).toBeTruthy();
    }
  });

  it("rotates the view cone by the camera yaw around the current dot", () => {
    mountMinimap({ yaw: Math.PI / 2 });
    const listbox = screen.getByRole("listbox", { name: "Scan positions" });
    const cone = listbox.querySelector(".twin-minimap-cone");
    expect(cone).not.toBeNull();
    expect(cone?.getAttribute("transform")).toBe("rotate(-90 0 0)");
  });
});

describe("TwinMinimap — selection by pointer", () => {
  it("fires onSelect with the node id when a dot is clicked", () => {
    const { onSelect } = mountMinimap();
    fireEvent.click(screen.getByRole("option", { name: "Go to scan 1" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("scan_001");
  });
});

describe("TwinMinimap — floors", () => {
  it("shows floor toggles only when more than one floor is present", () => {
    mountMinimap({ nodes: nodes.filter((entry) => entry.floor === 0) });
    expect(screen.queryByRole("group", { name: "Floors" })).toBeNull();
  });

  it("dims other-floor dots to 0.25 and follows the toggle", () => {
    mountMinimap();
    expect(screen.getByRole("group", { name: "Floors" })).toBeTruthy();

    // Active floor defaults to the current node's floor (0).
    const upstairs = screen.getByRole("option", { name: "Go to scan 3" });
    const ground = screen.getByRole("option", { name: "Go to scan 0" });
    expect(upstairs.getAttribute("opacity")).toBe("0.25");
    expect(ground.getAttribute("opacity")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Floor 1" }));
    expect(upstairs.getAttribute("opacity")).toBe("1");
    expect(ground.getAttribute("opacity")).toBe("0.25");
  });
});

describe("TwinMinimap — keyboard", () => {
  it("moves the selection with arrows and teleports with Enter", () => {
    const { onSelect } = mountMinimap();
    const listbox = screen.getByRole("listbox", { name: "Scan positions" });

    // scan_001 is the nearest same-floor node to the right of scan_000.
    fireEvent.keyDown(listbox, { key: "ArrowRight" });
    expect(
      screen.getByRole("option", { name: "Go to scan 1" }).getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("scan_001");
  });

  it("moves up-screen toward negative plan-y (scan_002 sits at −4)", () => {
    mountMinimap();
    const listbox = screen.getByRole("listbox", { name: "Scan positions" });
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(
      screen.getByRole("option", { name: "Go to scan 2" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("never selects across floors with arrows", () => {
    mountMinimap();
    const listbox = screen.getByRole("listbox", { name: "Scan positions" });
    // scan_003 (floor 1) is down-right of everything; ArrowDown from scan_000
    // must not reach it — no same-floor node lies below, so selection stays.
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: "Go to scan 0" }).getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("TwinMinimap — pure helpers", () => {
  it("auto-fits the viewBox to the node extents plus 2 m padding", () => {
    expect(minimapViewBox(nodes)).toBe("-2 -12 14 14");
  });

  it("maps three-space yaw to a clockwise SVG rotation in degrees", () => {
    expect(yawToMinimapRotationDeg(0)).toBe(0);
    expect(yawToMinimapRotationDeg(Math.PI / 2)).toBe(-90);
    expect(yawToMinimapRotationDeg(-Math.PI)).toBe(180);
  });
});
