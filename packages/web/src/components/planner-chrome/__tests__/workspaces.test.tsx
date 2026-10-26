import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VENUE_FLOOR_ROLES } from "../../../lib/role-capabilities.js";
import {
  STAFF_WORKSPACE_ROLES,
  WORKSPACES,
  canUseWorkspaces,
  cockpitModeFor,
  type WorkspaceViewerAuth,
} from "../../../lib/workspaces-model.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";
import { WorkspaceMenu } from "../WorkspaceMenu.js";
import { WorkspacePanel } from "../WorkspacePanel.js";
import { forgetKeptBodies, keptLayouts, KEPT_LAYOUTS, keptBody } from "../workspace-keep.js";
import { useWorkspaceStore } from "../workspace-state.js";

// ---------------------------------------------------------------------------
// The staff workspaces (T-674, v2 slice 18; spec 4.6, 6.15, 4.2, frame 20).
// The menu at the dock's left, named for the workspace in use; Ctrl 1–5; the
// panel in the right zone, titled with the menu's name (F-32); the one Escape
// order; who sees any of it; and C-17: figures typed into AV (and Power and
// Rigging) survive a part switch, a workspace switch and the panel closing.
// AV is v1's real body; the bodies that read the network are stood in for.
// ---------------------------------------------------------------------------

vi.mock("../../editor/cockpit/GuestsLensPanel.js", () => ({ GuestsLensPanel: () => <div data-testid="guests-body" /> }));
vi.mock("../../editor/cockpit/FlowLensPanel.js", () => ({ FlowLensPanel: () => <div data-testid="flow-body" /> }));
vi.mock("../../editor/cockpit/EvidenceLensPanel.js", () => ({ EvidenceLensPanel: () => <div data-testid="evidence-body" /> }));
vi.mock("../../editor/cockpit/CostsLensPanel.js", () => ({ CostsLensPanel: () => <div data-testid="costs-body" /> }));
vi.mock("../../editor/cockpit/LightingLensPanel.js", () => ({ LightingLensPanel: () => <div data-testid="lighting-body" /> }));
vi.mock("../../editor/cockpit/PowerLensPanel.js", () => ({ PowerLensPanel: () => <div data-testid="power-body" /> }));
vi.mock("../../editor/cockpit/RiggingLensPanel.js", () => ({ RiggingLensPanel: () => <div data-testid="rigging-body" /> }));
vi.mock("../../editor/cockpit/CockpitMinimap.js", () => ({ CockpitMinimap: () => <div data-testid="map-body" /> }));

const VENUE = "venue-trades-hall";

function user(role: string, patch: Partial<AuthUser> = {}): AuthUser {
  return { id: `u-${role}`, email: `${role}@example.test`, role, platformRole: "none", venueId: VENUE, name: role, ...patch };
}

function signIn(next: AuthUser | null): void {
  useAuthStore.setState({ user: next, isAuthenticated: next !== null, isLoading: false });
}

function auth(role: string | null, patch: Partial<AuthUser> = {}): WorkspaceViewerAuth {
  return { isLoading: false, isAuthenticated: role !== null, user: role === null ? null : user(role, patch) };
}

function ctrl(digit: number): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { code: `Digit${String(digit)}`, key: String(digit), ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(event); });
  return event;
}

function escape(): void {
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })); });
}

/** The dock's menu and the right zone, as lane C composes them. */
function Planner(): ReactElement {
  const right = usePlannerChromeStore((state) => state.right);
  return (
    <>
      <div className="pc-lacquer pc-dock"><WorkspaceMenu /></div>
      <div>{right === "workspace" ? <WorkspacePanel /> : null}</div>
    </>
  );
}

beforeEach(() => {
  useEditorStore.setState({ venueId: VENUE, configId: "layout-1", space: null });
  useWorkspaceStore.setState({ workspace: "design", part: "lighting", chosen: 0 });
  usePlannerChromeStore.getState().closeAll();
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.setState({ mode: "inactive" });
  signIn(user("staff"));
});

afterEach(() => {
  cleanup();
  act(() => { forgetKeptBodies(); });
});

describe("who sees the workspaces (spec 4.6; D4)", () => {
  it("is the venue's floor today, the same set that reads internal event data, and not sales", () => {
    expect([...STAFF_WORKSPACE_ROLES].sort()).toEqual([...VENUE_FLOOR_ROLES].sort());
    expect(STAFF_WORKSPACE_ROLES).not.toContain("sales");
  });

  it("admits staff, manager, hallkeeper and admin at the plan's venue, and a platform administrator anywhere", () => {
    for (const role of ["staff", "manager", "hallkeeper", "admin"]) expect(canUseWorkspaces(auth(role), VENUE)).toBe(true);
    expect(canUseWorkspaces(auth("client", { platformRole: "admin", venueId: null }), "elsewhere")).toBe(true);
  });

  it("refuses clients, planners, caterers, sales, guests, another venue's staff and a plan whose venue is not known yet", () => {
    for (const role of ["client", "planner", "caterer", "sales"]) expect(canUseWorkspaces(auth(role), VENUE)).toBe(false);
    expect(canUseWorkspaces(auth(null), VENUE)).toBe(false);
    expect(canUseWorkspaces(auth("staff", { venueId: "another-venue" }), VENUE)).toBe(false);
    expect(canUseWorkspaces(auth("staff"), null)).toBe(false);
    expect(canUseWorkspaces({ ...auth("staff"), isLoading: true }, VENUE)).toBe(false);
  });

  it("shows a client no key, and leaves Ctrl 1–5 to the browser", () => {
    signIn(user("client", { venueId: null }));
    render(<Planner />);
    expect(screen.queryByTestId("planner-workspace-menu")).toBeNull();
    const event = ctrl(3);
    expect(event.defaultPrevented).toBe(false);
    expect(usePlannerChromeStore.getState().right).toBeNull();
  });

  it("shows sales the client's view until D4", () => {
    signIn(user("sales"));
    render(<Planner />);
    expect(screen.queryByTestId("planner-workspace-menu")).toBeNull();
  });

  it("closes an open workspace when the person signs out", () => {
    render(<Planner />);
    ctrl(2);
    expect(screen.getByTestId("planner-workspace")).toBeTruthy();
    act(() => { signIn(null); });
    expect(usePlannerChromeStore.getState().right).toBeNull();
    expect(screen.queryByTestId("planner-workspace")).toBeNull();
  });
});

describe("the menu (spec 6.15, frame 20)", () => {
  it("names the key for the workspace in use: Design by default, never Layout", () => {
    render(<Planner />);
    const key = screen.getByTestId("planner-workspace-menu");
    expect(key.textContent).toBe("Design");
    expect(key.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toMatch(/\bLayout\b/u);
  });

  it("opens with the five, each with its line and Ctrl digit, over the foot", () => {
    render(<Planner />);
    fireEvent.click(screen.getByTestId("planner-workspace-menu"));
    const dialog = screen.getByRole("dialog", { name: "Workspaces" });
    const rows = within(dialog).getAllByRole("menuitemradio");
    expect(rows.map((row) => row.querySelector(".pc-workspace-menu__name")?.textContent)).toEqual(["Design", "Guests", "Flow", "Production", "Costs"]);
    expect(rows.map((row) => row.getAttribute("aria-keyshortcuts"))).toEqual(["Control+1", "Control+2", "Control+3", "Control+4", "Control+5"]);
    expect(rows[0]?.getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByText("Snap, guides and overlays")).toBeTruthy();
    expect(within(dialog).getByText("Lighting, power, rigging and AV")).toBeTruthy();
    expect(within(dialog).getByText("Clients see the room and the dock, never these.")).toBeTruthy();
    // Focus goes to the workspace in use.
    expect(document.activeElement).toBe(rows[0]);
  });

  it("moves between the rows with the arrows, Home and End", () => {
    render(<Planner />);
    fireEvent.click(screen.getByTestId("planner-workspace-menu"));
    const rows = screen.getAllByRole("menuitemradio");
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(rows[4]);
    fireEvent.keyDown(rows[4] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[4]);
  });

  it("shows the chosen workspace in the right zone, replacing its panel, and the key takes its name", () => {
    usePlannerChromeStore.getState().open("right", "lay-out");
    render(<Planner />);
    fireEvent.click(screen.getByTestId("planner-workspace-menu"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Flow/u }));
    expect(usePlannerChromeStore.getState().right).toBe("workspace");
    expect(screen.queryByRole("dialog", { name: "Workspaces" })).toBeNull();
    const panel = screen.getByTestId("planner-workspace");
    expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("Flow");
    expect(screen.getByTestId("planner-workspace-menu").textContent).toBe("Flow");
  });

  it("closes on Esc and gives focus back to its key", () => {
    render(<Planner />);
    const key = screen.getByTestId("planner-workspace-menu");
    fireEvent.click(key);
    expect(screen.getByRole("dialog", { name: "Workspaces" })).toBeTruthy();
    escape();
    expect(screen.queryByRole("dialog", { name: "Workspaces" })).toBeNull();
    expect(document.activeElement).toBe(key);
  });
});

describe("Ctrl 1–5 (spec 4.2, 11)", () => {
  it("open each workspace, and the same chord again closes it", () => {
    render(<Planner />);
    for (const entry of WORKSPACES) {
      const event = ctrl(entry.digit);
      expect(event.defaultPrevented).toBe(true);
      expect(screen.getByTestId("planner-workspace").getAttribute("data-workspace")).toBe(entry.id);
    }
    ctrl(5);
    expect(usePlannerChromeStore.getState().right).toBeNull();
  });

  it("answer from inside a field too, since Ctrl and a digit never types", () => {
    render(<Planner />);
    ctrl(4);
    act(() => { useWorkspaceStore.getState().setPart("av"); });
    const field = screen.getByTestId("av-spl");
    field.focus();
    act(() => { field.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "2", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(screen.getByTestId("planner-workspace").getAttribute("data-workspace")).toBe("guests");
  });
});

describe("the panel (spec 4.6; F-32)", () => {
  it("is titled with the menu's name for every workspace, with its line", () => {
    render(<Planner />);
    for (const entry of WORKSPACES) {
      ctrl(entry.digit);
      const panel = screen.getByTestId("planner-workspace");
      expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe(entry.name);
      expect(within(panel).getByText(entry.line)).toBeTruthy();
      expect(panel.getAttribute("aria-labelledby")).toBe(within(panel).getByRole("heading", { level: 2 }).id);
    }
  });

  it("holds v1's bodies: Guests, Flow then the evidence, Costs, and Production's four parts", () => {
    render(<Planner />);
    ctrl(2);
    expect(screen.getByTestId("guests-body")).toBeTruthy();
    ctrl(3);
    const flow = screen.getByTestId("planner-workspace");
    const order = [...flow.querySelectorAll("[data-testid$='-body']")].map((element) => element.getAttribute("data-testid"));
    expect(order).toEqual(["flow-body", "evidence-body"]);
    ctrl(5);
    expect(screen.getByTestId("costs-body")).toBeTruthy();
    ctrl(4);
    const parts = screen.getByRole("radiogroup", { name: "Production" });
    expect(within(parts).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Lighting", "Power", "Rigging", "AV"]);
  });

  it("puts snap, the overlays and the map in Design, each working its store", () => {
    render(<Planner />);
    ctrl(1);
    const snap = screen.getByRole("switch", { name: "Snap to the 1 m grid" });
    const before = usePlacementStore.getState().snapEnabled;
    fireEvent.click(snap);
    expect(usePlacementStore.getState().snapEnabled).toBe(!before);
    fireEvent.click(screen.getByRole("switch", { name: "Guest flow paths" }));
    expect(useCockpitStore.getState().overlayVisibility.guestFlow).toBe(false);
    expect(screen.getByTestId("map-body")).toBeTruthy();
  });

  it("moves focus to its first control on opening, and Esc closes it with focus back on the menu's key", () => {
    render(<Planner />);
    ctrl(1);
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Snap to the 1 m grid" }));
    escape();
    expect(usePlannerChromeStore.getState().right).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("planner-workspace-menu"));
  });

  it("closes from its own key, focus back on the menu's key", () => {
    render(<Planner />);
    ctrl(5);
    fireEvent.click(screen.getByRole("button", { name: /Close Costs/u }));
    expect(usePlannerChromeStore.getState().right).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("planner-workspace-menu"));
  });

  it("has the room's overlays follow the workspace in front, and puts Design back when it closes", () => {
    render(<Planner />);
    ctrl(3);
    expect(useCockpitStore.getState().activeMode).toBe("flow");
    ctrl(4);
    expect(useCockpitStore.getState().activeMode).toBe("lighting");
    act(() => { useWorkspaceStore.getState().setPart("rigging"); });
    expect(useCockpitStore.getState().activeMode).toBe("rigging");
    ctrl(4);
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(cockpitModeFor(null, "av")).toBe("design");
  });

  it("stands its bodies aside while an act's layout is showing", () => {
    useLayoutTimelinePreviewStore.setState({ mode: "keyframe" });
    render(<Planner />);
    ctrl(2);
    expect(screen.queryByTestId("guests-body")).toBeNull();
    expect(screen.getByText("An act's layout is showing")).toBeTruthy();
  });

  it("says nothing a client should not read, and no engineering word", () => {
    render(<Planner />);
    fireEvent.click(screen.getByTestId("planner-workspace-menu"));
    const menuText = screen.getByRole("dialog", { name: "Workspaces" }).textContent ?? "";
    for (const word of [/\blens\b/iu, /\bobject\b/iu, /\blayers?\b/iu, /\bLayout\b/u, /!/u]) expect(menuText).not.toMatch(word);
    escape();
    for (const entry of WORKSPACES) {
      ctrl(entry.digit);
      const head = screen.getByTestId("planner-workspace").querySelector(".pc-workspace__head")?.textContent ?? "";
      for (const word of [/\blens\b/iu, /\bobject\b/iu, /\blayers?\b/iu, /!/u]) expect(head).not.toMatch(word);
    }
  });
});

describe("figures kept while the planner is open (C-17)", () => {
  function typeSpl(value: string): void {
    fireEvent.change(screen.getByTestId("av-spl"), { target: { value } });
  }

  it("keep AV's figures across a part switch, a workspace switch and closing the panel", () => {
    render(<Planner />);
    ctrl(4);
    act(() => { useWorkspaceStore.getState().setPart("av"); });
    typeSpl("118");
    expect(screen.getByText("Not saved with the layout. The figures stay while the planner is open.")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Lighting" }));
    expect(screen.getByTestId("av-spl").closest("[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "AV" }));
    expect(screen.getByTestId<HTMLInputElement>("av-spl").value).toBe("118");

    ctrl(5);
    expect(screen.queryByTestId("av-spl")).toBeNull();
    ctrl(4);
    expect(screen.getByTestId<HTMLInputElement>("av-spl").value).toBe("118");

    ctrl(4);
    expect(screen.queryByTestId("planner-workspace")).toBeNull();
    ctrl(4);
    expect(screen.getByTestId<HTMLInputElement>("av-spl").value).toBe("118");
  });

  it("keeps them per layout: another layout starts empty, and coming back finds them", () => {
    render(<Planner />);
    ctrl(4);
    act(() => { useWorkspaceStore.getState().setPart("av"); });
    typeSpl("104");
    act(() => { useEditorStore.setState({ configId: "layout-2" }); });
    expect(screen.getByTestId<HTMLInputElement>("av-spl").value).toBe("");
    act(() => { useEditorStore.setState({ configId: "layout-1" }); });
    expect(screen.getByTestId<HTMLInputElement>("av-spl").value).toBe("104");
  });

  it("lets the oldest layout go after the last few", async () => {
    for (let i = 0; i <= KEPT_LAYOUTS; i += 1) act(() => { keptBody(`layout-${String(i)}`, "av"); });
    await act(async () => { await Promise.resolve(); });
    expect(keptLayouts()).toHaveLength(KEPT_LAYOUTS);
    expect(keptLayouts()).not.toContain("layout-0");
  });
});
