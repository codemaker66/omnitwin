import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  QuickActions,
  TWIN_QUICK_ENQUIRE_LABEL,
  TWIN_QUICK_GROUP_LABEL,
  TWIN_QUICK_PLAN_LABEL,
  TWIN_QUICK_SHARE_LABEL,
  allQuickActionCopy,
  twinQuickWalkLabel,
  type QuickActionDestination,
} from "../QuickActions.js";

// -----------------------------------------------------------------------------
// QuickActions — the rail that replaced the mockup's concierge.
//
// Pure DOM under happy-dom: this component imports nothing from
// @react-three/fiber or @react-three/drei, so there is no R3F surface to mock —
// which is itself part of the design (the rail is HUD, not scene).
//
// The contract under test is one sentence: a chip exists if and only if the
// capability behind it exists. Everything else here — group name, tab order,
// which id reaches the Usher — is the machinery that keeps that sentence true
// for a keyboard and a screen reader as well as for a mouse.
// -----------------------------------------------------------------------------

/** Two real manifest ids whose rooms are human-validated (see twin-rooms.ts).
 *  Destinations carry a SLUG, not a display string: the rail looks the name up,
 *  so no caller — including this test — can invent a room name. */
const DESTINATIONS: readonly QuickActionDestination[] = [
  { nodeId: "scan_028", slug: "grand-hall" },
  { nodeId: "scan_058", slug: "saloon" },
];

describe("QuickActions", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders no rail at all when no capability is supplied", () => {
    // Not an empty group — no group. A screen reader must not be walked into
    // "Quick actions" only to find nothing inside it.
    const { container } = render(<QuickActions />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("names the rail so the cluster is announced before its chips", () => {
    render(<QuickActions onShareView={vi.fn()} />);
    expect(screen.getByRole("group", { name: TWIN_QUICK_GROUP_LABEL })).toBeTruthy();
  });

  it("renders only the chips whose callbacks were given", () => {
    render(<QuickActions onSeeThePlan={vi.fn()} />);

    expect(screen.getByRole("button", { name: TWIN_QUICK_PLAN_LABEL })).toBeTruthy();
    expect(screen.queryByRole("button", { name: TWIN_QUICK_SHARE_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: TWIN_QUICK_ENQUIRE_LABEL })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("invokes the plan callback on click", () => {
    const onSeeThePlan = vi.fn();
    render(<QuickActions onSeeThePlan={onSeeThePlan} />);

    fireEvent.click(screen.getByRole("button", { name: TWIN_QUICK_PLAN_LABEL }));
    expect(onSeeThePlan).toHaveBeenCalledTimes(1);
  });

  it("invokes the share callback on click", () => {
    const onShareView = vi.fn();
    render(<QuickActions onShareView={onShareView} />);

    fireEvent.click(screen.getByRole("button", { name: TWIN_QUICK_SHARE_LABEL }));
    expect(onShareView).toHaveBeenCalledTimes(1);
  });

  it("invokes the enquiry callback on click", () => {
    const onEnquire = vi.fn();
    render(<QuickActions onEnquire={onEnquire} />);

    fireEvent.click(screen.getByRole("button", { name: TWIN_QUICK_ENQUIRE_LABEL }));
    expect(onEnquire).toHaveBeenCalledTimes(1);
  });

  it("renders one chip per destination and routes the right node id", () => {
    const onWalkTo = vi.fn();
    render(<QuickActions onWalkTo={onWalkTo} destinations={DESTINATIONS} />);

    expect(screen.getAllByRole("button")).toHaveLength(DESTINATIONS.length);

    fireEvent.click(
      screen.getByRole("button", { name: twinQuickWalkLabel("Grand Hall") }),
    );
    expect(onWalkTo).toHaveBeenCalledTimes(1);
    expect(onWalkTo).toHaveBeenCalledWith("scan_028");

    fireEvent.click(screen.getByRole("button", { name: twinQuickWalkLabel("Saloon") }));
    expect(onWalkTo).toHaveBeenCalledTimes(2);
    expect(onWalkTo).toHaveBeenLastCalledWith("scan_058");
  });

  it("renders no destination chip without a handler to carry it out", () => {
    // The dead-control trap: places to go, and no way to go there.
    const { container } = render(<QuickActions destinations={DESTINATIONS} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders no destination chip when there is nowhere named to go", () => {
    const { container } = render(<QuickActions onWalkTo={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("keeps tab order equal to reading order, with no tabindex overrides", () => {
    render(
      <QuickActions
        onSeeThePlan={vi.fn()}
        onWalkTo={vi.fn()}
        destinations={DESTINATIONS}
        onShareView={vi.fn()}
        onEnquire={vi.fn()}
      />,
    );

    const labels = screen.getAllByRole("button").map((button) => button.textContent);
    expect(labels).toEqual([
      TWIN_QUICK_PLAN_LABEL,
      twinQuickWalkLabel("Grand Hall"),
      twinQuickWalkLabel("Saloon"),
      TWIN_QUICK_SHARE_LABEL,
      TWIN_QUICK_ENQUIRE_LABEL,
    ]);

    // Natural document order only: a positive tabindex anywhere here would
    // reorder the whole page's tab sequence, not merely this rail.
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("tabindex")).toBeNull();
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("marks exactly one chip as the filled primary", () => {
    render(
      <QuickActions
        onSeeThePlan={vi.fn()}
        onWalkTo={vi.fn()}
        destinations={DESTINATIONS}
        onShareView={vi.fn()}
        onEnquire={vi.fn()}
      />,
    );

    const gold = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("vv-twin-quick-chip--gold"));
    expect(gold).toHaveLength(1);
    expect(gold[0]?.textContent).toBe(TWIN_QUICK_ENQUIRE_LABEL);
  });

  it("hides its icons from the accessible name so the label stands alone", () => {
    render(<QuickActions onShareView={vi.fn()} />);
    const chip = screen.getByRole("button", { name: TWIN_QUICK_SHARE_LABEL });
    const icon = chip.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("exposes every rendered string to the copy-claim sweep", () => {
    // If a new chip ever ships without its words joining allQuickActionCopy(),
    // the claim guard stops seeing them — so the sweep list is pinned here to
    // the labels the component actually renders.
    render(
      <QuickActions
        onSeeThePlan={vi.fn()}
        onWalkTo={vi.fn()}
        destinations={[{ nodeId: "scan_028", slug: "grand-hall" }]}
        onShareView={vi.fn()}
        onEnquire={vi.fn()}
      />,
    );

    const copy = allQuickActionCopy();
    for (const button of screen.getAllByRole("button")) {
      expect(copy).toContain(button.textContent);
    }
    expect(copy).toContain(TWIN_QUICK_GROUP_LABEL);
  });
});
