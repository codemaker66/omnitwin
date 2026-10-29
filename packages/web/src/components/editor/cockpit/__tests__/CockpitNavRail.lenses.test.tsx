import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { COCKPIT_MODES } from "../../../../lib/cockpit-modes.js";
import { setPlannerFeaturesForTesting, type PlannerFeatureOverrides } from "../../../../lib/planner-features.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { CockpitNavRail } from "../CockpitNavRail.js";

// Blake's decision 5 on the rail itself: which lenses, in what order, named
// or not, and where the "Venue tools" divider falls, per viewer and key.

type Viewer = "anonymous" | "loading" | "client" | "planner" | "caterer" | "hallkeeper" | "staff" | "manager" | "admin" | "sales";

const ALL = COCKPIT_MODES.map((mode) => mode.label);
const CLIENT_FOUR = ["Design", "Guests", "Costs", "Share"];
const HALLKEEPER_FOUR = ["Design", "Guests", "Ops", "Evidence"];
const VENUE_TOOLS = ["Flow", "Evidence", "Lighting", "Power", "Rigging", "AV", "Ops"];

function viewAs(viewer: Viewer): void {
  const auth = useAuthStore.getState();
  if (viewer === "anonymous") { auth.setUser(null); return; }
  if (viewer === "loading") { auth.logout(); auth.setLoading(true); return; }
  auth.setUser({ id: "viewer", email: "viewer@example.test", role: viewer, platformRole: "none", venueId: "venue", name: "Viewer" });
}

function withKeys(keys: PlannerFeatureOverrides): void { setPlannerFeaturesForTesting(keys); }

function rail(): HTMLElement { return screen.getByRole("navigation", { name: "Planner lenses" }); }

/** The lens buttons in DOM order, which is also the Tab order (none sets a tabindex). */
function lensNames(): string[] {
  return within(rail()).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "");
}

function venueTools(): HTMLElement | null {
  return within(rail()).queryByRole("group", { name: "Venue tools" });
}

function pressed(): string[] {
  return within(rail()).getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

afterEach(() => {
  cleanup();
  setPlannerFeaturesForTesting(null);
  useCockpitStore.getState().reset();
  useAuthStore.getState().logout();
});

describe("CockpitNavRail with both keys off", () => {
  it.each<Viewer>(["anonymous", "loading", "client", "hallkeeper", "staff"])("shows %s today's eleven unnamed icons in today's order", (viewer) => {
    withKeys({ lensesByRole: false, lensesDivider: false });
    viewAs(viewer);
    render(<CockpitNavRail />);
    expect(lensNames()).toEqual(ALL);
    expect(rail().classList.contains("is-named")).toBe(false);
    for (const button of within(rail()).getAllByRole("button")) expect(button.getAttribute("title")).toBe(button.getAttribute("aria-label"));
    expect(venueTools()).toBeNull();
  });
});

describe("CockpitNavRail with lensesByRole", () => {
  it.each<[Viewer, string[]]>([
    ["anonymous", CLIENT_FOUR],
    ["loading", CLIENT_FOUR],
    ["client", CLIENT_FOUR],
    ["planner", CLIENT_FOUR],
    ["caterer", CLIENT_FOUR],
    ["hallkeeper", HALLKEEPER_FOUR],
    ["staff", ALL],
    ["manager", ALL],
    ["admin", ALL],
    ["sales", ALL],
  ])("shows %s their own lenses, named, undivided", (viewer, names) => {
    withKeys({ lensesByRole: true });
    viewAs(viewer);
    render(<CockpitNavRail />);
    expect(lensNames()).toEqual(names);
    expect(rail().classList.contains("is-named")).toBe(true);
    for (const button of within(rail()).getAllByRole("button")) {
      // The name is the button's own text under its icon; no tooltip repeats it.
      expect(button.querySelector("span")?.textContent).toBe(button.getAttribute("aria-label"));
      expect(button.hasAttribute("title")).toBe(false);
    }
    expect(venueTools()).toBeNull();
  });

  it("follows the viewer: a client's four become a staff member's eleven on sign-in", () => {
    withKeys({ lensesByRole: true });
    viewAs("loading");
    render(<CockpitNavRail />);
    expect(lensNames()).toEqual(CLIENT_FOUR);
    act(() => { viewAs("staff"); });
    expect(lensNames()).toEqual(ALL);
  });
});

describe("CockpitNavRail with lensesDivider", () => {
  it.each<Viewer>(["anonymous", "client", "hallkeeper", "staff"])("gives %s the client's four, then Venue tools, all named", (viewer) => {
    withKeys({ lensesDivider: true });
    viewAs(viewer);
    render(<CockpitNavRail />);
    expect(lensNames()).toEqual([...CLIENT_FOUR, ...VENUE_TOOLS]);
    expect(rail().classList.contains("is-named")).toBe(true);
    const group = venueTools();
    expect(group).not.toBeNull();
    if (group === null) return;
    expect(within(group).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(VENUE_TOOLS);
    // The visible label is the divider, and it names the group.
    const label = group.querySelector(".cockpit-rail__divider");
    expect(label?.textContent).toBe("Venue tools");
    expect(group.getAttribute("aria-labelledby")).toBe(label?.id);
    // The divider is not a stop on the way: only the eleven buttons take focus.
    expect(label?.hasAttribute("tabindex")).toBe(false);
  });
});

describe("CockpitNavRail with both keys on", () => {
  it.each<[Viewer, string[], boolean]>([
    ["anonymous", CLIENT_FOUR, false],
    ["loading", CLIENT_FOUR, false],
    ["client", CLIENT_FOUR, false],
    ["hallkeeper", HALLKEEPER_FOUR, false],
    ["staff", [...CLIENT_FOUR, ...VENUE_TOOLS], true],
    ["admin", [...CLIENT_FOUR, ...VENUE_TOOLS], true],
  ])("filters %s by role first; the divider appears only where venue tools remain", (viewer, names, divided) => {
    withKeys({ lensesByRole: true, lensesDivider: true });
    viewAs(viewer);
    render(<CockpitNavRail />);
    expect(lensNames()).toEqual(names);
    expect(rail().classList.contains("is-named")).toBe(true);
    expect(venueTools() !== null).toBe(divided);
  });
});

describe("CockpitNavRail pressed state", () => {
  it("marks the chosen lens with aria-pressed, in a divided rail too", () => {
    withKeys({ lensesByRole: true, lensesDivider: true });
    viewAs("staff");
    render(<CockpitNavRail />);
    expect(pressed()).toEqual(["Design"]);
    fireEvent.click(screen.getByRole("button", { name: "Rigging" }));
    expect(useCockpitStore.getState().activeMode).toBe("rigging");
    expect(pressed()).toEqual(["Rigging"]);
    fireEvent.click(screen.getByRole("button", { name: "Costs" }));
    expect(pressed()).toEqual(["Costs"]);
  });

  it("presses Design when the active lens is one this viewer cannot see", () => {
    withKeys({ lensesByRole: true });
    viewAs("client");
    useCockpitStore.setState({ activeMode: "rigging" });
    render(<CockpitNavRail />);
    expect(pressed()).toEqual(["Design"]);
  });
});

describe("the named rail's CSS", () => {
  const css = readFileSync(resolve("src/components/editor/cockpit/ReferenceViewer.css"), "utf8");

  it("still hides the names of an unnamed rail", () => {
    expect(css).toContain(".reference-viewer .cockpit-rail__button span { display: none; }");
  });

  it("shows a named rail's names at 11 px on one line in a column wide enough for Evidence", () => {
    expect(css).toMatch(/\.reference-left-dock:has\(> \.cockpit-rail\.is-named\) \{ grid-template-columns: 64px minmax\(0, 1fr\); \}/);
    const named = /\.reference-viewer \.cockpit-rail\.is-named \.cockpit-rail__button span \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(named).toContain("display: block");
    expect(named).toContain("11px");
    expect(named).toContain("white-space: nowrap");
  });
});
