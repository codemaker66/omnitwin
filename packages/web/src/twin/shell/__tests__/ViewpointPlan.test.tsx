import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { findUnsupportedProposalClaim, type TwinScanNode } from "@omnitwin/types";
import {
  PLAN_ASPECT,
  PLAN_CLICK_TOLERANCE_M,
  PLAN_CONE_RADIUS_M,
  PLAN_DEFAULT_FOV_RAD,
  PLAN_MARGIN_M,
  PLAN_SLOT,
  PlanMarks,
  TWIN_PLAN_GROUP_LABEL,
  ViewpointPlan,
  allViewpointPlanCopy,
  twinPlanMarkLabel,
  twinPlanScaleLabel,
  type PlanMarksProps,
} from "../ViewpointPlan.js";
import {
  chooseScaleBarM,
  fitPlanViewBox,
  formatPolygonPoints,
  formatViewBox,
  minimumNodeSpacingM,
  toPlanNodes,
  viewConePolygon,
} from "../minimap-geometry.js";

// -----------------------------------------------------------------------------
// ViewpointPlan — the plan view, made of surveyed poses instead of drawn dots.
//
// Pure DOM under happy-dom: this panel imports nothing from @react-three/fiber,
// which is the point — it is HUD, not scene, and the 3D view hands it four
// values (nodes, current id, yaw, a callback) and nothing else.
//
// The contract under test is three sentences. Every mark sits where the pose
// says. Every mark is operable by pointer AND keyboard, with one tab stop for
// the whole plan rather than 149. And the storey is never guessed: an unknown
// current viewpoint draws nothing at all, because choosing a floor to show is
// the same class of invention as choosing a room name (see shell/twin-rooms.ts).
// -----------------------------------------------------------------------------

/** Synthetic pose: E57 metres, Z-up, level tripod at the usual 1.5 m head. */
function node(id: string, x: number, y: number, floor = 0): TwinScanNode {
  return {
    id,
    index: Number(id.slice(-3)),
    pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] },
    floor,
    roomSlug: null,
  };
}

/**
 * Four ground-floor scans plus one upstairs. Plan coords are (x, −y), so
 * scan_002 at E57 y = 6 draws UP the screen and scan_003 at E57 y = −6 draws
 * down — the projection is exercised, not assumed.
 */
const NODES: readonly TwinScanNode[] = [
  node("scan_000", 0, 0),
  node("scan_001", 8, 0),
  node("scan_002", 0, 6),
  node("scan_003", 0, -6),
  node("scan_100", 30, 30, 1),
];

/** The ground-floor viewBox the component must fit, recomputed independently. */
function groundViewBox(): ReturnType<typeof fitPlanViewBox> {
  return fitPlanViewBox(
    toPlanNodes(NODES.filter((entry) => entry.floor === 0)).map((entry) => entry.point),
    { marginM: PLAN_MARGIN_M, aspect: PLAN_ASPECT },
  );
}

function mount(
  overrides: Partial<{
    nodes: readonly TwinScanNode[];
    currentId: string;
    yaw: number;
    fovRad: number;
  }> = {},
): { onSelect: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onSelect = vi.fn();
  const { container } = render(
    <ViewpointPlan
      nodes={overrides.nodes ?? NODES}
      currentId={overrides.currentId ?? "scan_000"}
      yaw={overrides.yaw ?? 0}
      fovRad={overrides.fovRad}
      onSelect={onSelect}
    />,
  );
  return { onSelect, container };
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

/** Force a measured box onto the plan's SVG: happy-dom performs no layout, so
 *  every getBoundingClientRect is 0×0 until a test says otherwise. */
function measure(container: HTMLElement, rect: DOMRect): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (svg === null) {
    throw new Error("the plan rendered no svg");
  }
  svg.getBoundingClientRect = (): DOMRect => rect;
  return svg;
}

/** The plan's click-through floor, which carries nearest-viewpoint travel. */
function floorOf(container: HTMLElement): Element {
  const floor = container.querySelector(".vv-twin-plan-floor");
  if (floor === null) {
    throw new Error("the plan rendered no floor");
  }
  return floor;
}

afterEach(() => {
  cleanup();
});

// -----------------------------------------------------------------------------
// THE HUD SLOT — the finding this suite exists to close.
//
// The panel's first slot (`top: 150px; right: 18px`) lay across
// `.vv-twin-controls` and disabled Enquire, Share and Fullscreen. Nothing caught
// it, because happy-dom performs no layout: every getBoundingClientRect is 0×0,
// so a rendering test literally cannot see two panels on top of each other. The
// answer is not to give up on proving it — it is to stop asking the DOM and do
// the arithmetic, against the shipped stylesheets.
//
// So: every HUD rectangle is modelled below as a function of the viewport,
// EVERY placement number in that model is asserted to still be present in the
// stylesheet it came from, and the plan's own rectangle is proved disjoint from
// all of them at the viewport sizes the panel actually renders at.
//
// The model's HEIGHTS are the one part not read from CSS — a control's height
// comes from its content and its box model, which no stylesheet states. They are
// therefore written as deliberate OVER-estimates, computed from the declared
// padding/border/font-size and rounded up, so a wrong guess errs towards
// reporting a collision that is not there rather than missing one that is.
// -----------------------------------------------------------------------------

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

const TWIN_CSS = readSource("src/twin/twin.css");
const DOSSIER_CSS = readSource("src/twin/shell/room-dossier.css");
const QUICK_CSS = readSource("src/twin/shell/quick-actions.css");
const PLAN_CSS = readSource("src/twin/shell/viewpoint-plan.css");

interface SlotRect {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Viewport {
  readonly w: number;
  readonly h: number;
}

function boxAt(name: string, left: number, top: number, width: number, height: number): SlotRect {
  return { name, left, top, right: left + width, bottom: top + height };
}

/** Two rects share area. Touching edges do not count — a 0px gap is a gap. */
function overlaps(a: SlotRect, b: SlotRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Every HUD rectangle EXCEPT the plan, in CSS px, for a viewport wider than
 * 480px.
 *
 * Deliberately not modelled below 480px: twin.css's own phone block takes over
 * there, and the plan does not render below 621px anyway, so a model of that
 * regime would be asserting a geometry this panel never meets — worse than no
 * model, because it would read as proof.
 */
function occupiedHudRects(v: Viewport): readonly SlotRect[] {
  if (v.w <= 480) {
    throw new Error("the phone regime is not modelled; the plan does not render there");
  }
  // room-dossier.css and quick-actions.css both switch at 700px; twin.css's own
  // right-hand column keeps its 18px inset all the way down to 480px.
  const small = v.w <= 700;

  const dossierLeft = small ? 12 : 18;
  const dossierWidth = small ? Math.min(320, v.w - 130) : Math.min(340, v.w - 150);
  const dossierTop = small ? 56 : 62;
  // Its max-height, i.e. the tallest the card can ever grow — the worst case.
  const dossierHeight = small ? v.h - 230 : v.h - 200;

  const quickLeft = small ? 12 : 18;
  const quickWidth = small ? Math.min(280, v.w - 170) : Math.min(300, v.w - 110);
  const quickBottom = small ? 88 : 56;

  return [
    // .vv-twin-node-label: no width cap above 480px, so half the viewport is a
    // gross over-estimate of a one-line pill. Its real separation is vertical.
    boxAt("node label", 18, 18, v.w / 2, 34),
    // .vv-twin-mode: 3 segments, 0.72rem in 6px/14px pills + 3px padding + border.
    boxAt("mode control", v.w - 18 - 260, 18, 260, 34),
    // .vv-twin-surface: the 103px measured in room-dossier.css's own comment.
    boxAt("surface", v.w - 18 - 103, 62, 103, 30),
    // .vv-twin-controls: 112px wide (measured, room-dossier.css) and
    // Enquire 35 + 10 + Share 38 + 10 + Fullscreen 38 = 131 tall.
    boxAt("utility rail", v.w - 18 - 112, 106, 112, 131),
    boxAt("room dossier", dossierLeft, dossierTop, dossierWidth, dossierHeight),
    boxAt("quick actions", quickLeft, v.h - quickBottom - 220, quickWidth, 220),
    boxAt("viewer disclosure", 18, v.h - 14 - 44, 416, 44),
    boxAt("coach hint", v.w / 2 - 190, v.h - 64 - 34, 380, 34),
    // .twin-minimap: 200px map + 10px padding + 1px border each side = 222 wide;
    // 240 (map max-height) + 25 (floor pills) + 8 gap + 20 padding + 2 = 295.
    boxAt("minimap", v.w - 18 - 222, v.h - 18 - 295, 222, 295),
  ];
}

/** The plan's own rectangle, derived from PLAN_SLOT — the same numbers the
 *  stylesheet is pinned to below. */
function planSlotRect(v: Viewport): SlotRect {
  const height = Math.min(
    PLAN_SLOT.widthPx / PLAN_ASPECT,
    v.h - PLAN_SLOT.topPx - PLAN_SLOT.bottomReservePx,
  );
  return boxAt(
    "viewpoint plan",
    v.w - PLAN_SLOT.rightPx - PLAN_SLOT.widthPx,
    PLAN_SLOT.topPx,
    PLAN_SLOT.widthPx,
    height,
  );
}

/** The sizes this ships at, plus the exact floor the media queries allow. */
const RENDERS_AT: readonly Viewport[] = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: PLAN_SLOT.minViewportWidthPx, h: PLAN_SLOT.minViewportHeightPx },
];

describe("ViewpointPlan — the HUD slot", () => {
  for (const viewport of RENDERS_AT) {
    it(`collides with nothing at ${String(viewport.w)}×${String(viewport.h)}`, () => {
      const plan = planSlotRect(viewport);
      // A slot with no area is not a slot; a collision-free zero rect would
      // pass the disjointness loop while showing the visitor nothing.
      expect(plan.right - plan.left).toBeGreaterThan(0);
      expect(plan.bottom - plan.top).toBeGreaterThan(100);
      // ...and it must be inside the viewport, not off the edge of it.
      expect(plan.left).toBeGreaterThanOrEqual(0);
      expect(plan.right).toBeLessThanOrEqual(viewport.w);
      expect(plan.bottom).toBeLessThanOrEqual(viewport.h);

      const collisions = occupiedHudRects(viewport)
        .filter((other) => overlaps(plan, other))
        .map((other) => other.name);
      expect(collisions).toEqual([]);
    });
  }

  it("clears the utility rail and the minimap by a real gap, not by a rounding error", () => {
    // The two neighbours in the SAME column, where a near-miss would still read
    // as a collision to a visitor. Named separately so a regression says which.
    for (const viewport of RENDERS_AT) {
      const plan = planSlotRect(viewport);
      const rects = occupiedHudRects(viewport);
      const rail = rects.find((entry) => entry.name === "utility rail");
      const minimap = rects.find((entry) => entry.name === "minimap");
      expect(plan.top - (rail?.bottom ?? 0)).toBeGreaterThanOrEqual(12);
      expect((minimap?.top ?? 0) - plan.bottom).toBeGreaterThanOrEqual(12);
    }
  });

  it("pins every placement number the model used to the stylesheet it came from", () => {
    // Without this the proof above is arithmetic about a layout that may no
    // longer exist. Each string is the exact declaration the model encodes; if
    // another lane re-slots one of these, this fails and the proof is re-derived
    // rather than silently going stale.
    for (const declaration of [
      "top: calc(18px + env(safe-area-inset-top));", // .vv-twin-mode
      "top: calc(62px + env(safe-area-inset-top));", // .vv-twin-surface
      "top: calc(106px + env(safe-area-inset-top));", // .vv-twin-controls
      "right: calc(18px + env(safe-area-inset-right));",
      "bottom: calc(18px + env(safe-area-inset-bottom));", // .twin-minimap
      "bottom: calc(64px + env(safe-area-inset-bottom));", // .vv-twin-coach
      "bottom: calc(14px + env(safe-area-inset-bottom));", // .vv-twin-viewer-disclosure
      "width: 200px;", // .twin-minimap-map
      "max-height: 240px;",
    ]) {
      expect(TWIN_CSS).toContain(declaration);
    }

    for (const declaration of [
      "top: calc(62px + env(safe-area-inset-top));",
      "left: calc(18px + env(safe-area-inset-left));",
      "width: min(340px, calc(100vw - 150px));",
      "max-height: calc(100dvh - 200px);",
      "top: calc(56px + env(safe-area-inset-top));",
      "width: min(320px, calc(100vw - 130px));",
      "max-height: calc(100dvh - 230px);",
    ]) {
      expect(DOSSIER_CSS).toContain(declaration);
    }

    for (const declaration of [
      "bottom: calc(56px + env(safe-area-inset-bottom));",
      "max-width: min(300px, calc(100vw - 110px));",
      "bottom: calc(88px + env(safe-area-inset-bottom));",
      "max-width: min(280px, calc(100vw - 170px));",
    ]) {
      expect(QUICK_CSS).toContain(declaration);
    }
  });

  it("spells PLAN_SLOT into the stylesheet, so the proof and the paint agree", () => {
    expect(PLAN_CSS).toContain(
      `top: calc(${String(PLAN_SLOT.topPx)}px + env(safe-area-inset-top));`,
    );
    expect(PLAN_CSS).toContain(
      `right: calc(${String(PLAN_SLOT.rightPx)}px + env(safe-area-inset-right));`,
    );
    expect(PLAN_CSS).toContain(`width: ${String(PLAN_SLOT.widthPx)}px;`);
    expect(PLAN_CSS).toContain(
      `max-height: calc(100dvh - ${String(PLAN_SLOT.topPx + PLAN_SLOT.bottomReservePx)}px);`,
    );
  });

  it("ties the CSS aspect-ratio to PLAN_ASPECT so the two cannot drift", () => {
    // Spelled as a bare number precisely so this assertion can be an identity
    // rather than a look-alike: `3 / 2` in CSS would need a parser to compare.
    expect(PLAN_CSS).toContain(`aspect-ratio: ${String(PLAN_ASPECT)};`);
  });

  it("does not render below its width and height floors, rather than overlapping", () => {
    // A phone has no free rectangle: .vv-twin-dossier reaches 100vw - 118px
    // there, leaving under 100px beside it. The honest response is absence, and
    // `display: none` specifically — an invisible-but-focusable plan would still
    // hold a tab stop, which is the worst of the three states.
    const hidden = (feature: string, px: number): RegExp =>
      new RegExp(
        `@media \\(${feature}: ${String(px)}px\\) \\{\\s*\\.vv-twin-plan \\{\\s*display: none;`,
        "u",
      );
    expect(PLAN_CSS).toMatch(hidden("max-width", PLAN_SLOT.minViewportWidthPx - 1));
    expect(PLAN_CSS).toMatch(hidden("max-height", PLAN_SLOT.minViewportHeightPx - 1));
  });

  it("has a width floor because narrower viewports really do cross the dossier", () => {
    // Stated as arithmetic rather than taste. The dossier's right edge parks at
    // 332px for any viewport at least 450px wide (12px inset + its 320px cap),
    // and the plan's left edge is `100vw − 240`. Those meet at 572px, so a
    // narrow-but-not-phone viewport is a genuine collision — asserted here
    // rather than asserted about.
    const narrow: Viewport = { w: 481, h: PLAN_SLOT.minViewportHeightPx };
    const dossier = occupiedHudRects(narrow).find((entry) => entry.name === "room dossier");
    expect(dossier).toBeDefined();
    expect(dossier !== undefined && overlaps(planSlotRect(narrow), dossier)).toBe(true);

    // The floor is set well above the 584px where a 12px gutter first appears.
    // That headroom is deliberate and is the claim being pinned: the dossier
    // belongs to another lane and may grow, and a slot proven with a one-pixel
    // margin is proven for today only.
    const atFloor: Viewport = {
      w: PLAN_SLOT.minViewportWidthPx,
      h: PLAN_SLOT.minViewportHeightPx,
    };
    const atFloorDossier = occupiedHudRects(atFloor).find(
      (entry) => entry.name === "room dossier",
    );
    expect(planSlotRect(atFloor).left - (atFloorDossier?.right ?? 0)).toBeGreaterThanOrEqual(
      40,
    );
  });
});

describe("ViewpointPlan — what it draws", () => {
  it("draws one mark per viewpoint on the current storey, and none from another", () => {
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: twinPlanMarkLabel(101) })).toBeNull();
  });

  it("names every mark by its 1-based viewpoint number, never its scan id", () => {
    mount();
    for (const viewpoint of [1, 2, 3, 4]) {
      expect(screen.getByRole("button", { name: twinPlanMarkLabel(viewpoint) })).toBeTruthy();
    }
  });

  it("draws nothing when the current viewpoint is unknown — no storey may be guessed", () => {
    const { container } = mount({ currentId: "scan_404" });
    expect(container.firstChild).toBeNull();
  });

  it("draws nothing for an empty bundle", () => {
    const { container } = mount({ nodes: [], currentId: "scan_000" });
    expect(container.firstChild).toBeNull();
  });

  it("puts each mark exactly where the pose projects to, in plan metres", () => {
    mount();
    // scan_002 stands at E57 (0, 6) → plan (0, −6): up the screen, not down.
    const mark = screen.getByRole("button", { name: twinPlanMarkLabel(3) });
    const dot = mark.querySelector(".vv-twin-plan-dot");
    expect(dot?.getAttribute("cx")).toBe("0");
    expect(dot?.getAttribute("cy")).toBe("-6");

    const east = screen.getByRole("button", { name: twinPlanMarkLabel(2) });
    expect(east.querySelector(".vv-twin-plan-dot")?.getAttribute("cx")).toBe("8");
  });

  it("fits an aspect-preserving viewBox to the storey it is drawing", () => {
    const { container } = mount();
    const expected = groundViewBox();
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      formatViewBox(expected),
    );
    // The upstairs node at plan (30, −30) must NOT have stretched the box.
    expect(expected.x + expected.width).toBeLessThan(30);
  });

  it("marks the standing viewpoint as the current location, and only that one", () => {
    mount({ currentId: "scan_001" });
    expect(
      screen.getByRole("button", { name: twinPlanMarkLabel(2) }).getAttribute("aria-current"),
    ).toBe("location");
    const flagged = screen
      .getAllByRole("button")
      .filter((mark) => mark.getAttribute("aria-current") !== null);
    expect(flagged).toHaveLength(1);
  });
});

describe("ViewpointPlan — the view cone", () => {
  it("draws the pure function's wedge at the yaw it was handed", () => {
    const yaw = 0.9;
    const { container } = mount({ yaw });
    const expected = viewConePolygon({
      origin: { x: 0, y: 0 },
      yaw,
      fovRad: PLAN_DEFAULT_FOV_RAD,
      radiusM: PLAN_CONE_RADIUS_M,
    });
    expect(container.querySelector(".vv-twin-plan-cone")?.getAttribute("points")).toBe(
      formatPolygonPoints(expected),
    );
  });

  it("points up the screen at yaw 0 and left at +90°, matching the walk", () => {
    // The cone's arc midpoint is the vertex that carries the direction. A sign
    // flip anywhere in the yaw chain lands it on the opposite side of the apex.
    const { container: north } = mount({ yaw: 0 });
    const up = north.querySelector(".vv-twin-plan-cone")?.getAttribute("points") ?? "";
    expect(up.split(" ")[7]).toBe(`0,-${String(PLAN_CONE_RADIUS_M)}`);
    cleanup();

    const { container: west } = mount({ yaw: Math.PI / 2 });
    const left = west.querySelector(".vv-twin-plan-cone")?.getAttribute("points") ?? "";
    expect(left.split(" ")[7]).toBe(`-${String(PLAN_CONE_RADIUS_M)},0`);
  });

  it("keeps the cone out of the accessibility tree — it is a picture of the camera", () => {
    const { container } = mount();
    expect(
      container.querySelector(".vv-twin-plan-cone-layer")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("accepts a real horizontal fov from the host", () => {
    const fovRad = 1.4;
    const { container } = mount({ fovRad, yaw: 0 });
    const expected = viewConePolygon({
      origin: { x: 0, y: 0 },
      yaw: 0,
      fovRad,
      radiusM: PLAN_CONE_RADIUS_M,
    });
    expect(container.querySelector(".vv-twin-plan-cone")?.getAttribute("points")).toBe(
      formatPolygonPoints(expected),
    );
  });
});

describe("ViewpointPlan — travel by pointer", () => {
  it("travels to the viewpoint whose mark was clicked", () => {
    const { onSelect } = mount();
    fireEvent.click(screen.getByRole("button", { name: twinPlanMarkLabel(2) }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("scan_001");
  });

  it("travels to the nearest viewpoint when the empty floor is clicked", () => {
    const { onSelect, container } = mount();
    measure(container, domRect(0, 0, 600, 400));
    const box = groundViewBox();
    // Aim at a point a metre short of scan_001 (plan 8, 0), in client pixels.
    const scale = Math.min(600 / box.width, 400 / box.height);
    const clientX = (600 - box.width * scale) / 2 + (7 - box.x) * scale;
    const clientY = (400 - box.height * scale) / 2 + (0 - box.y) * scale;

    fireEvent.click(floorOf(container), { clientX, clientY });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("scan_001");
  });

  it("ignores a floor click that lands nowhere near a viewpoint", () => {
    const { onSelect, container } = mount();
    measure(container, domRect(0, 0, 600, 400));
    // Top-left corner of the element: past the margin, outside the footprint.
    fireEvent.click(floorOf(container), { clientX: 1, clientY: 1 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(PLAN_CLICK_TOLERANCE_M).toBeGreaterThan(0);
  });

  it("ignores a floor click when the element has never been measured", () => {
    // happy-dom, an unmounted node, display:none — all report a zero rect, and
    // a NaN plan coordinate would otherwise teleport to whatever sorted first.
    const { onSelect, container } = mount();
    fireEvent.click(floorOf(container), { clientX: 40, clientY: 40 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ViewpointPlan — travel by keyboard", () => {
  it("offers the whole plan as ONE tab stop, anchored on where you stand", () => {
    // 149 tab stops is not an accessible plan, it is a tab trap with a map in
    // it. Roving tabindex: one stop in, arrows within, Enter to travel.
    mount({ currentId: "scan_001" });
    const inTabOrder = screen
      .getAllByRole("button")
      .filter((mark) => mark.getAttribute("tabindex") === "0");
    expect(inTabOrder).toHaveLength(1);
    expect(inTabOrder[0]?.getAttribute("aria-label")).toBe(twinPlanMarkLabel(2));
  });

  it("travels on Enter and on Space", () => {
    const { onSelect } = mount();
    const mark = screen.getByRole("button", { name: twinPlanMarkLabel(2) });
    fireEvent.keyDown(mark, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("scan_001");
    fireEvent.keyDown(mark, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("scan_001");
  });

  it("moves the roving stop to the nearest mark in the screen direction pressed", () => {
    mount();
    fireEvent.keyDown(screen.getByRole("button", { name: twinPlanMarkLabel(1) }), {
      key: "ArrowRight",
    });
    expect(
      screen.getByRole("button", { name: twinPlanMarkLabel(2) }).getAttribute("tabindex"),
    ).toBe("0");

    // Back west, then up: scan_002 is at E57 y = +6, i.e. plan y = −6 — UP.
    fireEvent.keyDown(screen.getByRole("button", { name: twinPlanMarkLabel(2) }), {
      key: "ArrowLeft",
    });
    fireEvent.keyDown(screen.getByRole("button", { name: twinPlanMarkLabel(1) }), {
      key: "ArrowUp",
    });
    expect(
      screen.getByRole("button", { name: twinPlanMarkLabel(3) }).getAttribute("tabindex"),
    ).toBe("0");
  });

  it("leaves the roving stop where it is when nothing lies that way", () => {
    mount({ currentId: "scan_001" });
    const east = screen.getByRole("button", { name: twinPlanMarkLabel(2) });
    fireEvent.keyDown(east, { key: "ArrowRight" });
    expect(east.getAttribute("tabindex")).toBe("0");
  });

  it("jumps to the first and last mark with Home and End", () => {
    mount();
    fireEvent.keyDown(screen.getByRole("button", { name: twinPlanMarkLabel(1) }), {
      key: "End",
    });
    expect(
      screen.getByRole("button", { name: twinPlanMarkLabel(4) }).getAttribute("tabindex"),
    ).toBe("0");

    fireEvent.keyDown(screen.getByRole("button", { name: twinPlanMarkLabel(4) }), {
      key: "Home",
    });
    expect(
      screen.getByRole("button", { name: twinPlanMarkLabel(1) }).getAttribute("tabindex"),
    ).toBe("0");
  });

  it("re-anchors the roving stop when the walk moves under it", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ViewpointPlan nodes={NODES} currentId="scan_000" yaw={0} onSelect={onSelect} />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: twinPlanMarkLabel(1) }), {
      key: "ArrowRight",
    });
    rerender(
      <ViewpointPlan nodes={NODES} currentId="scan_003" yaw={0} onSelect={onSelect} />,
    );
    expect(
      screen.getByRole("button", { name: twinPlanMarkLabel(4) }).getAttribute("tabindex"),
    ).toBe("0");
  });

  it("carries FOCUS with the roving stop, not just the tabindex", () => {
    // The half of the roving-tabindex pattern that is easy to leave out and
    // impossible to notice in a screenshot: if the tabindex moves and focus
    // does not, the visitor's caret and the plan's highlight part company on
    // the first arrow press, and the next Tab leaves from the wrong place.
    mount();
    const start = screen.getByRole("button", { name: twinPlanMarkLabel(1) });
    start.focus();
    expect(document.activeElement).toBe(start);

    fireEvent.keyDown(start, { key: "ArrowRight" });
    const east = screen.getByRole("button", { name: twinPlanMarkLabel(2) });
    expect(document.activeElement).toBe(east);
    expect(east.getAttribute("tabindex")).toBe("0");
  });

  it("carries focus on Home and End too, not only on the arrows", () => {
    mount();
    const first = screen.getByRole("button", { name: twinPlanMarkLabel(1) });
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: twinPlanMarkLabel(4) }),
    );

    fireEvent.keyDown(document.activeElement ?? first, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("leaves focus alone when the press moves nothing", () => {
    // The counterpart to the two above: a move that finds no candidate must not
    // blur, or ArrowRight at the east wall silently drops the visitor out of
    // the plan and back to the document.
    mount({ currentId: "scan_001" });
    const east = screen.getByRole("button", { name: twinPlanMarkLabel(2) });
    east.focus();
    fireEvent.keyDown(east, { key: "ArrowRight" });
    expect(document.activeElement).toBe(east);
  });

  it("gives every mark a focus ring element, not a bare circle", () => {
    mount();
    for (const mark of screen.getAllByRole("button")) {
      expect(mark.querySelector(".vv-twin-plan-focus")).not.toBeNull();
      expect(mark.tagName.toLowerCase()).toBe("g");
    }
  });
});

describe("ViewpointPlan — the instrument furniture", () => {
  it("draws a scale bar of a real ladder length, labelled in metres", () => {
    const { container } = mount();
    const bar = container.querySelector(".vv-twin-plan-scale-bar");
    expect(bar).not.toBeNull();
    const length = Number(bar?.getAttribute("x2")) - Number(bar?.getAttribute("x1"));
    const expected = chooseScaleBarM(groundViewBox().width / 3);
    expect(length).toBeCloseTo(expected, 6);
    expect(container.textContent).toContain(twinPlanScaleLabel(expected));
  });

  it("backs the scale so a viewpoint landing on it cannot hide the figure", () => {
    // Observed, not imagined: at 149 nodes on a 1.5 m grid the standing mark
    // sits squarely on the bar. The plate must be drawn BEFORE the bar and must
    // span it, or it is decoration rather than a fix.
    const { container } = mount();
    const scale = container.querySelector(".vv-twin-plan-scale");
    const plate = scale?.querySelector(".vv-twin-plan-scale-plate");
    const bar = scale?.querySelector(".vv-twin-plan-scale-bar");
    expect(plate).not.toBeNull();
    expect(scale?.firstElementChild).toBe(plate);

    const plateX = Number(plate?.getAttribute("x"));
    const plateW = Number(plate?.getAttribute("width"));
    expect(plateX).toBeLessThan(Number(bar?.getAttribute("x1")));
    expect(plateX + plateW).toBeGreaterThan(Number(bar?.getAttribute("x2")));
  });

  it("paints chrome UNDER the marks, so no control is ever covered by a caption", () => {
    // SVG paints in document order, so this ordering IS the z-order, and it is
    // the whole reason the scale plate can be opaque. Reversed, the plate hides
    // the standing viewpoint — a real regression caught in a browser, not a
    // hypothetical. Marks last, always.
    const { container } = mount();
    const svg = container.querySelector("svg");
    const order = Array.from(svg?.children ?? []).map((child) => child.getAttribute("class"));
    expect(order).toEqual([
      "vv-twin-plan-floor",
      "vv-twin-plan-cone-layer",
      "vv-twin-plan-scale",
      "vv-twin-plan-marks",
    ]);
  });

  it("anchors north, because a plan without an orientation is a doodle", () => {
    const { container } = mount();
    expect(container.querySelector(".vv-twin-plan-north")).not.toBeNull();
  });

  it("names the plan so the mark cluster is announced with its context", () => {
    mount();
    expect(screen.getByRole("group", { name: TWIN_PLAN_GROUP_LABEL })).toBeTruthy();
  });
});

describe("ViewpointPlan — copy", () => {
  it("renders nothing but the swept templates, so a sample IS the sweep", () => {
    // A sweep list cannot enumerate 149 sentences, and a list that merely
    // sampled them would report green over copy nobody checked. The argument is
    // closed from the other end instead: this pins that every rendered name is
    // twinPlanMarkLabel(n) — the numeral being the only variable, and a decimal
    // integer carrying no claim — and that the template itself is in the list.
    mount();
    const marks = screen.getAllByRole("button");
    expect(marks).toHaveLength(4);
    marks.forEach((mark, index) => {
      expect(mark.getAttribute("aria-label")).toBe(twinPlanMarkLabel(index + 1));
    });

    const copy = allViewpointPlanCopy();
    expect(copy).toContain(twinPlanMarkLabel(1));
    expect(copy).toContain(TWIN_PLAN_GROUP_LABEL);
    expect(copy).toContain(twinPlanScaleLabel(5));
  });

  it("passes the claim guard on every line it can render", () => {
    // Run here as well as in shell-copy-claims.test.ts: a panel whose copy is
    // only swept somewhere else is unguarded on the day someone moves the list.
    const copy = allViewpointPlanCopy();
    expect(copy.length).toBeGreaterThan(0);
    for (const line of copy) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });
});

describe("ViewpointPlan — 149 viewpoints", () => {
  /** The shipped Trades Hall bundle's node count, laid out on a 1.5 m grid. */
  const BIG: readonly TwinScanNode[] = Array.from({ length: 149 }, (_, index) =>
    node(
      `scan_${String(index).padStart(3, "0")}`,
      (index % 13) * 1.5,
      Math.floor(index / 13) * 1.5,
    ),
  );

  it("renders every one of them, with a bounded element budget per mark", () => {
    const { container } = render(
      <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={0} onSelect={vi.fn()} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(149);

    // The virtualisation question is element count, so it is pinned rather than
    // eyeballed: 4 elements per mark plus fixed furniture. If a future mark
    // grows a fifth child this fails and the budget gets re-argued on purpose.
    expect(container.querySelectorAll("*").length).toBeLessThan(149 * 5 + 40);
  });

  it("does not remount a single mark when the view turns", () => {
    // Kept, but stated honestly for what it is. A yaw change leaves every
    // mark's DOM node IDENTICAL — the same object, not merely the same markup.
    // That is worth pinning (a keyed remount would drop focus mid-keyboard
    // walk and restart every CSS transition), but it is NOT the memo
    // guarantee: React reuses keyed host nodes whether or not the component
    // above them re-ran, so this assertion passes with `memo` deleted. The two
    // tests below are the ones that fail when memoisation goes.
    const onSelect = vi.fn();
    const { rerender } = render(
      <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={0} onSelect={onSelect} />,
    );
    const before = screen.getAllByRole("button");
    const dotsBefore = before.map((mark) => mark.querySelector(".vv-twin-plan-dot"));

    rerender(
      <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={1.2} onSelect={onSelect} />,
    );

    const after = screen.getAllByRole("button");
    expect(after).toHaveLength(149);
    after.forEach((mark, index) => {
      expect(mark).toBe(before[index]);
      expect(mark.querySelector(".vv-twin-plan-dot")).toBe(dotsBefore[index]);
    });
  });

  /**
   * Counts the mark layer's renders from OUTSIDE it.
   *
   * PlanMarks reads `viewpointById.get(node.id)` once per mark while rendering
   * and nowhere else, so a spy on `Map.prototype.get` filtered to scan ids is a
   * direct count of marks rendered: 149 when the layer runs, 0 when the memo
   * skips it. This is the seam that makes the memo falsifiable — a DOM
   * assertion cannot see a render that produced identical output.
   */
  function countMarkRendersDuring(act: () => void): number {
    const spy = vi.spyOn(Map.prototype, "get");
    try {
      act();
      return spy.mock.calls.filter(
        ([key]) => typeof key === "string" && key.startsWith("scan_"),
      ).length;
    } finally {
      spy.mockRestore();
    }
  }

  it("skips the mark layer entirely when only the yaw changes", () => {
    // The headline perf claim, finally pinned. A look-drag emits yaw every
    // frame; the measured difference between reconciling the cone alone and
    // rebuilding all 149 marks is 0.392 ms vs 14.0 ms (module header). Counting
    // renders rather than timing them keeps this stable on a loaded CI box.
    //
    // MUTATION-CHECKED: this fails (149 instead of 0) if `memo` is removed from
    // PlanMarks, AND if any of ViewpointPlan's props to it stop being
    // referentially stable — an inline `onActivate`, an unmemoised `hitR`, a
    // `viewpointById` rebuilt per render. A memo fed fresh props is decoration,
    // so both halves have to be covered by one assertion.
    const onSelect = vi.fn();
    const { rerender } = render(
      <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={0} onSelect={onSelect} />,
    );

    const duringYaw = countMarkRendersDuring(() => {
      rerender(
        <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={1.2} onSelect={onSelect} />,
      );
    });
    expect(duringYaw).toBe(0);

    // The control, without which "0" could just mean the seam never fires: a
    // change that legitimately rebuilds the storey must show all 149.
    const duringStorey = countMarkRendersDuring(() => {
      rerender(
        <ViewpointPlan nodes={[...BIG]} currentId="scan_000" yaw={1.2} onSelect={onSelect} />,
      );
    });
    expect(duringStorey).toBe(149);
  });

  it("memoises the mark layer itself, independently of who calls it", () => {
    // The memo boundary on its own, so a failure says WHICH half broke: the
    // test above fails for unstable props too, this one only for a missing
    // memo. Identical props must not re-render; a changed prop must.
    const viewpointById = new Map<string, number>(
      BIG.map((entry): [string, number] => [entry.id, entry.index + 1]),
    );
    const get = vi.spyOn(viewpointById, "get");
    const props: PlanMarksProps = {
      nodes: toPlanNodes(BIG),
      viewpointById,
      currentId: "scan_000",
      rovingId: "scan_000",
      dotR: 0.3,
      currentR: 0.5,
      focusR: 0.9,
      hitR: 0.75,
      onActivate: vi.fn(),
      onMarkKeyDown: vi.fn(),
      registerMark: vi.fn(),
    };

    const { rerender } = render(
      <svg>
        <PlanMarks {...props} />
      </svg>,
    );
    expect(get).toHaveBeenCalledTimes(149);

    get.mockClear();
    rerender(
      <svg>
        <PlanMarks {...props} />
      </svg>,
    );
    expect(get).not.toHaveBeenCalled();

    get.mockClear();
    rerender(
      <svg>
        <PlanMarks {...props} rovingId="scan_001" />
      </svg>,
    );
    expect(get).toHaveBeenCalledTimes(149);
  });

  it("keeps every hit disc disjoint at shipped density, so nearest beats paint order", () => {
    // THE FINDING. Hit radius was a flat fraction of the viewBox, and the
    // viewBox grows with the capture while the scans stay on their 1.5 m grid —
    // so at 149 nodes the discs overlapped and a click in the overlap went to
    // whichever mark SVG painted last. Two neighbours' discs touching is the
    // whole failure, so the assertion is over every pair, at the shipped count.
    const { container } = render(
      <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={0} onSelect={vi.fn()} />,
    );
    const hits = Array.from(container.querySelectorAll(".vv-twin-plan-hit"));
    expect(hits).toHaveLength(149);

    const radii = new Set(hits.map((hit) => hit.getAttribute("r")));
    expect(radii.size).toBe(1);
    const hitR = Number(hits[0]?.getAttribute("r"));
    expect(hitR).toBeGreaterThan(0);

    // Measured off the DRAWN centres, not off the fixture: this has to be true
    // of what shipped to the DOM, not of what the arithmetic intended.
    const drawn = hits.map((hit) => ({
      id: String(hit.getAttribute("cx")),
      point: { x: Number(hit.getAttribute("cx")), y: Number(hit.getAttribute("cy")) },
    }));
    let closest = Infinity;
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const a = drawn[i];
        const b = drawn[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        closest = Math.min(closest, Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y));
      }
    }
    expect(closest).toBeCloseTo(1.5, 9);
    expect(hitR * 2).toBeLessThanOrEqual(closest + 1e-9);

    // And it is the CLAMP that binds here, not the fraction — which is the
    // mutation guard: delete the clamp and the radius jumps to the fraction of
    // a 29.25 m box (≈1.11 m), overlapping its neighbours by a wide margin.
    expect(hitR).toBeCloseTo(closest / 2, 9);
    const viewBoxWidth = Number(
      (container.querySelector("svg")?.getAttribute("viewBox") ?? "").split(" ")[2],
    );
    expect(viewBoxWidth).toBeGreaterThan(closest * 2);
  });

  it("still travels to the genuinely nearest viewpoint at that density", () => {
    // The geometric proof above says a click inside a disc picks that disc's
    // node. This is the other half of the drawing — the gaps the disjoint discs
    // necessarily leave, which fall through to the floor and resolve by
    // distance. Aimed 0.4 m from one mark and 1.1 m from its neighbour.
    const onSelect = vi.fn();
    const { container } = render(
      <ViewpointPlan nodes={BIG} currentId="scan_000" yaw={0} onSelect={onSelect} />,
    );
    measure(container, domRect(0, 0, 600, 400));
    const box = fitPlanViewBox(
      toPlanNodes(BIG).map((entry) => entry.point),
      { marginM: PLAN_MARGIN_M, aspect: PLAN_ASPECT },
    );
    // Column 4, row 2 of the grid → index 2 × 13 + 4 = 30, at plan (6, −3).
    const scale = Math.min(600 / box.width, 400 / box.height);
    const clientX = (600 - box.width * scale) / 2 + (6.4 - box.x) * scale;
    const clientY = (400 - box.height * scale) / 2 + (-3 - box.y) * scale;

    fireEvent.click(floorOf(container), { clientX, clientY });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("scan_030");
  });

  it("clamps the hit disc from the SPACING, which a sparse capture proves too", () => {
    // The clamp must not silently become the only rule: on a sparse room the
    // fraction is the smaller of the two and must still win, or a four-node
    // room gets discs half a room wide.
    const sparse = toPlanNodes(NODES.filter((entry) => entry.floor === 0));
    expect(minimumNodeSpacingM(sparse)).toBeCloseTo(6, 9);
    const { container } = mount();
    const hitR = Number(container.querySelector(".vv-twin-plan-hit")?.getAttribute("r"));
    expect(hitR).toBeGreaterThan(0);
    expect(hitR).toBeLessThan(minimumNodeSpacingM(sparse) / 2);
  });
});
