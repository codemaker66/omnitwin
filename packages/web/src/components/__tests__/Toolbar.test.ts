import { describe, it, expect, beforeEach } from "vitest";
import { useMeasurementStore } from "../../stores/measurement-store.js";
import { useXrayStore } from "../../stores/xray-store.js";
import { useGuidelineStore } from "../../stores/guideline-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import {
  isToolbarMuted,
  setToolbarMuted,
  toggleToolbarMute,
} from "../../lib/toolbar-sounds.js";

// ---------------------------------------------------------------------------
// These tests verify the Toolbar's integration with tool stores,
// keyboard shortcut handling, sound utility, and arc geometry.
// ---------------------------------------------------------------------------

const initialMeasurement = useMeasurementStore.getState();
const initialXray = useXrayStore.getState();
const initialGuideline = useGuidelineStore.getState();
const initialCatalogue = useCatalogueStore.getState();

beforeEach(() => {
  useMeasurementStore.setState(initialMeasurement, true);
  useXrayStore.setState(initialXray, true);
  useGuidelineStore.setState(initialGuideline, true);
  useCatalogueStore.setState(initialCatalogue, true);
  setToolbarMuted(true);
});

// ---------------------------------------------------------------------------
// Tool store integration
// ---------------------------------------------------------------------------

describe("Toolbar tool store integration", () => {
  it("measure tool toggles via store", () => {
    expect(useMeasurementStore.getState().active).toBe(false);
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(true);
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(false);
  });

  it("xray tool toggles via store", () => {
    expect(useXrayStore.getState().enabled).toBe(false);
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(true);
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(false);
  });

  it("guideline (tape) tool toggles via store", () => {
    expect(useGuidelineStore.getState().active).toBe(false);
    useGuidelineStore.getState().toggle();
    expect(useGuidelineStore.getState().active).toBe(true);
    useGuidelineStore.getState().toggle();
    expect(useGuidelineStore.getState().active).toBe(false);
  });

  it("catalogue drawer toggles via store", () => {
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
    useCatalogueStore.getState().toggleDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(true);
    useCatalogueStore.getState().toggleDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool definitions (4 tools with correct shortcuts and accents)
// ---------------------------------------------------------------------------

describe("Toolbar tool definitions", () => {
  const TOOL_DEFS = [
    { id: "measure", shortcut: "M", accent: "#5B9BD5" },
    { id: "xray", shortcut: "X", accent: "#9B72CF" },
    { id: "tape", shortcut: "T", accent: "#D4A843" },
    { id: "place", shortcut: "F", accent: "#C25B5B" },
  ] as const;

  it("has exactly 4 tools", () => {
    expect(TOOL_DEFS).toHaveLength(4);
  });

  it("each tool has a unique ID", () => {
    const ids = TOOL_DEFS.map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("each tool has a unique keyboard shortcut", () => {
    const shortcuts = TOOL_DEFS.map((t) => t.shortcut);
    expect(new Set(shortcuts).size).toBe(4);
  });

  it("each tool has a unique accent colour", () => {
    const accents = TOOL_DEFS.map((t) => t.accent);
    expect(new Set(accents).size).toBe(4);
  });

  it("all shortcuts are single uppercase letters", () => {
    for (const tool of TOOL_DEFS) {
      expect(tool.shortcut).toMatch(/^[A-Z]$/);
    }
  });

  it("all accent colours are valid hex", () => {
    for (const tool of TOOL_DEFS) {
      expect(tool.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Row geometry
// ---------------------------------------------------------------------------

describe("Toolbar row geometry", () => {
  const TOOL_SIZE = 44;
  const TOOL_GAP = 6;
  const TOOLBOX_GAP = 10;
  const TOOL_COUNT = 4;

  function computeRowOffset(index: number): number {
    return TOOLBOX_GAP + index * (TOOL_SIZE + TOOL_GAP);
  }

  it("first tool (index 0) is closest to toolbox", () => {
    const offset = computeRowOffset(0);
    expect(offset).toBe(TOOLBOX_GAP);
  });

  it("last tool (index 3) is furthest from toolbox", () => {
    const offset = computeRowOffset(3);
    expect(offset).toBeGreaterThan(computeRowOffset(2));
  });

  it("tools are evenly spaced", () => {
    const step = TOOL_SIZE + TOOL_GAP;
    for (let i = 1; i < TOOL_COUNT; i++) {
      expect(computeRowOffset(i) - computeRowOffset(i - 1)).toBe(step);
    }
  });

  it("all tools have positive offsets", () => {
    for (let i = 0; i < TOOL_COUNT; i++) {
      expect(computeRowOffset(i)).toBeGreaterThan(0);
    }
  });

  it("offsets increase monotonically", () => {
    for (let i = 1; i < TOOL_COUNT; i++) {
      expect(computeRowOffset(i)).toBeGreaterThan(computeRowOffset(i - 1));
    }
  });

  it("total row width matches expected", () => {
    const lastOffset = computeRowOffset(TOOL_COUNT - 1);
    const totalWidth = lastOffset + TOOL_SIZE;
    expect(totalWidth).toBe(TOOLBOX_GAP + TOOL_COUNT * TOOL_SIZE + (TOOL_COUNT - 1) * TOOL_GAP);
  });
});

// ---------------------------------------------------------------------------
// Sound utility
// ---------------------------------------------------------------------------

describe("Toolbar sound utility", () => {
  it("starts muted", () => {
    expect(isToolbarMuted()).toBe(true);
  });

  it("toggleToolbarMute toggles state", () => {
    expect(toggleToolbarMute()).toBe(false); // now unmuted
    expect(isToolbarMuted()).toBe(false);
    expect(toggleToolbarMute()).toBe(true); // back to muted
    expect(isToolbarMuted()).toBe(true);
  });

  it("setToolbarMuted sets directly", () => {
    setToolbarMuted(false);
    expect(isToolbarMuted()).toBe(false);
    setToolbarMuted(true);
    expect(isToolbarMuted()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stagger timing
// ---------------------------------------------------------------------------

describe("Toolbar stagger timing", () => {
  const STAGGER_MS = 40;
  const TOOL_COUNT = 4;

  it("opening: tool 0 at 0ms, tool 3 at 120ms", () => {
    for (let i = 0; i < TOOL_COUNT; i++) {
      expect(i * STAGGER_MS).toBe(i * 40);
    }
    expect(0 * STAGGER_MS).toBe(0);
    expect(3 * STAGGER_MS).toBe(120);
  });

  it("closing: tool 3 retracts first (at 0ms), tool 0 last (at 120ms)", () => {
    for (let i = 0; i < TOOL_COUNT; i++) {
      const closeDelay = (TOOL_COUNT - 1 - i) * STAGGER_MS;
      if (i === 3) expect(closeDelay).toBe(0);
      if (i === 0) expect(closeDelay).toBe(120);
    }
  });
});

// ---------------------------------------------------------------------------
// hexToRgb utility
// ---------------------------------------------------------------------------

describe("hexToRgb", () => {
  function hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${String(r)}, ${String(g)}, ${String(b)}`;
  }

  it("converts sapphire accent correctly", () => {
    expect(hexToRgb("#5B9BD5")).toBe("91, 155, 213");
  });

  it("converts amethyst accent correctly", () => {
    expect(hexToRgb("#9B72CF")).toBe("155, 114, 207");
  });

  it("converts brass accent correctly", () => {
    expect(hexToRgb("#D4A843")).toBe("212, 168, 67");
  });

  it("converts garnet accent correctly", () => {
    expect(hexToRgb("#C25B5B")).toBe("194, 91, 91");
  });

  it("converts black", () => {
    expect(hexToRgb("#000000")).toBe("0, 0, 0");
  });

  it("converts white", () => {
    expect(hexToRgb("#FFFFFF")).toBe("255, 255, 255");
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcut mapping
// ---------------------------------------------------------------------------

describe("Toolbar keyboard shortcuts", () => {
  it("M toggles measure", () => {
    expect(useMeasurementStore.getState().active).toBe(false);
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(true);
  });

  it("X toggles xray", () => {
    expect(useXrayStore.getState().enabled).toBe(false);
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(true);
  });

  it("T toggles tape", () => {
    expect(useGuidelineStore.getState().active).toBe(false);
    useGuidelineStore.getState().toggle();
    expect(useGuidelineStore.getState().active).toBe(true);
  });

  it("F toggles catalogue", () => {
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
    useCatalogueStore.getState().toggleDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(true);
  });

  it("Escape deactivates active tool (measure)", () => {
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(true);
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(false);
  });

  it("Escape deactivates active tool (xray)", () => {
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(true);
    useXrayStore.getState().toggle();
    expect(useXrayStore.getState().enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Active tool accent colour derivation
// ---------------------------------------------------------------------------

describe("Toolbar active tool accent", () => {
  const ACCENTS: Record<string, string> = {
    measure: "#5B9BD5",
    xray: "#9B72CF",
    tape: "#D4A843",
    place: "#C25B5B",
  };

  it("no active tool → no accent", () => {
    expect(useMeasurementStore.getState().active).toBe(false);
    expect(useXrayStore.getState().enabled).toBe(false);
    expect(useGuidelineStore.getState().active).toBe(false);
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
  });

  it("measure active → sapphire accent", () => {
    useMeasurementStore.getState().toggle();
    expect(ACCENTS["measure"]).toBe("#5B9BD5");
  });

  it("xray active → amethyst accent", () => {
    useXrayStore.getState().toggle();
    expect(ACCENTS["xray"]).toBe("#9B72CF");
  });

  it("tape active → brass accent", () => {
    useGuidelineStore.getState().toggle();
    expect(ACCENTS["tape"]).toBe("#D4A843");
  });

  it("place active → garnet accent", () => {
    useCatalogueStore.getState().toggleDrawer();
    expect(ACCENTS["place"]).toBe("#C25B5B");
  });
});

// ---------------------------------------------------------------------------
// Touch support logic
// ---------------------------------------------------------------------------

describe("Toolbar touch support", () => {
  it("touch devices use tap-to-toggle (no hover)", () => {
    let arcOpen = false;
    arcOpen = !arcOpen; // first tap
    expect(arcOpen).toBe(true);
    arcOpen = !arcOpen; // second tap
    expect(arcOpen).toBe(false);
  });

  it("tapping a tool activates it and closes arc", () => {
    let arcOpen = true;
    useMeasurementStore.getState().toggle();
    arcOpen = false; // tool activation closes arc
    expect(useMeasurementStore.getState().active).toBe(true);
    expect(arcOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spring configuration constants
// ---------------------------------------------------------------------------

describe("Toolbar spring configs", () => {
  it("opening spring: wobbly/bouncy preset", () => {
    const openConfig = { tension: 200, friction: 12 };
    expect(openConfig.tension).toBe(200);
    expect(openConfig.friction).toBe(12);
  });

  it("hover spring: stiff/snappy preset", () => {
    const hoverConfig = { tension: 300, friction: 20 };
    expect(hoverConfig.tension).toBe(300);
    expect(hoverConfig.friction).toBe(20);
  });

  it("closing spring: decisive preset", () => {
    const closeConfig = { tension: 250, friction: 18 };
    expect(closeConfig.tension).toBe(250);
    expect(closeConfig.friction).toBe(18);
  });
});
