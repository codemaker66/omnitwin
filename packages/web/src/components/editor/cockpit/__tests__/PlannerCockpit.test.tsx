import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";

// The cockpit hosts the full editor (App) in its stage; mock it to a stand-in
// so the test stays a structural shell test (no WebGL). The top bar reads
// router + store context of its own, so mock it too for this shell test.
vi.mock("../../../../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../ReferenceRoomHeader.js", () => ({ ReferenceRoomHeader: () => <header data-testid="reference-room-header-mock" /> }));
vi.mock("../CockpitRightDock.js", () => ({ CockpitRightDock: () => <aside data-testid="cockpit-dock-mock" /> }));
vi.mock("../CockpitBottom.js", () => ({ CockpitBottom: () => <footer data-testid="cockpit-bottom-mock" /> }));
// The When ribbon reads router search params (its ?eventId corridor) and
// fetches the calendar — out of scope for a structural shell test.
vi.mock("../WhenRibbon.js", () => ({ WhenRibbon: () => <aside data-testid="when-ribbon-mock" /> }));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

function seedUser(role: string, platformRole: "none" | "admin" = "none"): void {
  useAuthStore.getState().setUser({ id: "operator", role, platformRole, venueId: "venue", name: "Operator", email: "operator@example.test" });
}

beforeEach(() => { seedUser("staff"); });
afterEach(() => { cleanup(); useCockpitStore.getState().reset(); useAuthStore.getState().logout(); });

describe("PlannerCockpit", () => {
  it.each(["client", "planner", "unknown"])("does not render an empty booking disclosure for %s", (role) => {
    seedUser(role);
    const { container } = render(<PlannerCockpit hasLinkedEvent />);
    expect(screen.queryByText("Booking time")).toBeNull();
    expect(screen.queryByTestId("when-ribbon-mock")).toBeNull();
    expect(container.querySelector(".reference-when-ribbon")).toBeNull();
  });

  it.each(["staff", "admin", "hallkeeper"])("keeps the booking disclosure for an authenticated %s", (role) => {
    seedUser(role);
    render(<PlannerCockpit hasLinkedEvent />);
    expect(screen.getByText("Booking time")).toBeTruthy();
    expect(screen.getByTestId("when-ribbon-mock")).toBeTruthy();
  });

  it("keeps the booking disclosure for a platform admin with a customer base role", () => {
    seedUser("planner", "admin");
    render(<PlannerCockpit hasLinkedEvent />);
    expect(screen.getByText("Booking time")).toBeTruthy();
  });

  it.each(["checking", "signed out"])("removes the booking disclosure while %s", (state) => {
    render(<PlannerCockpit hasLinkedEvent />);
    act(() => {
      if (state === "checking") useAuthStore.getState().setLoading(true);
      else useAuthStore.getState().logout();
    });
    expect(screen.queryByText("Booking time")).toBeNull();
    expect(screen.queryByTestId("when-ribbon-mock")).toBeNull();
  });

  it.each([
    { role: "client", mobile: true }, { role: "client", mobile: false },
    { role: "planner", mobile: true }, { role: "planner", mobile: false },
  ])("keeps capture failure visible without staff booking controls for $role on mobile=$mobile", ({ role, mobile }) => {
    seedUser(role);
    useCockpitStore.getState().setRoomResolve({ phase: "unavailable", loadedChunks: 1, totalChunks: 12 });
    render(<PlannerCockpit mobile={mobile} hasLinkedEvent />);
    expect(screen.getByTestId("room-resolve-caption").textContent).toContain("Room capture could not load");
    expect(screen.queryByText("Booking time")).toBeNull();
    expect(screen.queryByTestId("when-ribbon-mock")).toBeNull();
  });

  it.each([true, false])("keeps settled capture failure visible without working motion on mobile=%s", (mobile) => {
    useCockpitStore.getState().setRoomResolve({ phase: "unavailable", loadedChunks: 1, totalChunks: 12 });
    const { rerender } = render(<PlannerCockpit mobile={mobile} />);
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("Room capture could not load");
    expect(caption.querySelector("svg")).toBeNull();
    useCockpitStore.getState().setRoomResolve({ phase: "degraded", loadedChunks: 11, totalChunks: 12 });
    rerender(<PlannerCockpit mobile={mobile} />);
    expect(screen.getByTestId("room-resolve-caption").textContent).toContain("Part of the room capture");
    expect(screen.getByTestId("room-resolve-caption").querySelector("svg")).toBeNull();
  });
  it("keeps booking controls reachable independently of the layout timeline's expansion", () => {
    const { container, rerender } = render(<PlannerCockpit hasLinkedEvent />);
    const disclosure = screen.getByText("Booking time").closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.querySelector('[data-testid="when-ribbon-mock"]')).not.toBeNull();
    expect(container.querySelector(".reference-when-ribbon")?.parentElement).toBe(screen.getByTestId("cockpit-shell"));
    rerender(<PlannerCockpit hasLinkedEvent={false} />);
    expect(screen.queryByText("Booking time")).toBeNull();
  });
  it("renders the grid regions, the live editor, and the nav rail", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell")).toBeTruthy();
    expect(screen.getByTestId("mock-editor-3d")).toBeTruthy();
    expect(screen.getByTestId("cockpit-rail")).toBeTruthy();
  });

  it("hosts the editor inside the stage region", () => {
    const { container } = render(<PlannerCockpit />);
    const stage = container.querySelector(".cockpit-stage");
    expect(stage).not.toBeNull();
    expect(stage?.querySelector('[data-testid="mock-editor-3d"]')).not.toBeNull();
  });

  it("marks the stage with the active lens (Design by default) so CSS shows tools only in Design", () => {
    const { container } = render(<PlannerCockpit />);
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("design");
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("flow");
  });

  // CARD A2: the stage exposes the resolve phase as an honesty attribute and
  // hosts the quiet caption while the captured room develops. No spinner.
  it("exposes the resolve phase on the stage and shows the quiet caption while developing", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "developing", loadedChunks: 2, totalChunks: 7 });
    const { container } = render(<PlannerCockpit />);

    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase")).toBe("developing");
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.textContent).toContain("Loading captured room");
    expect(caption.textContent).toContain("2 of 7 chunks");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("keeps the caption hidden outside the developing phase", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "fallback", loadedChunks: 0, totalChunks: 0 });
    const { container } = render(<PlannerCockpit />);

    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase")).toBe("fallback");
    expect(screen.getByTestId("room-resolve-caption").getAttribute("data-visible")).toBe("false");
  });

  it("pauses pending capture motion and announcements in Model without claiming unseen chunks are ready", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "developing", loadedChunks: 0, totalChunks: 7 });
    render(<PlannerCockpit />);
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.querySelector("svg")).not.toBeNull();
    act(() => { useCockpitStore.getState().setLayerMode("mesh"); });
    expect(caption.getAttribute("data-visible")).toBe("false");
    expect(caption.getAttribute("aria-hidden")).toBe("true");
    expect(caption.getAttribute("aria-live")).toBe("off");
    expect(caption.querySelector("svg")).toBeNull();
    expect(useCockpitStore.getState().roomResolve).toEqual({ phase: "developing", loadedChunks: 0, totalChunks: 7 });
    act(() => { useCockpitStore.getState().setLayerMode("splat"); });
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.getAttribute("aria-hidden")).toBe("false");
    expect(caption.getAttribute("aria-live")).toBe("polite");
    expect(caption.querySelector("svg")).not.toBeNull();
  });

  it.each(["degraded", "unavailable"] as const)("keeps the terminal %s capture notice visible in Model", (phase) => {
    useCockpitStore.getState().setLayerMode("mesh");
    useCockpitStore.getState().setRoomResolve({ phase, loadedChunks: 0, totalChunks: 7 });
    render(<PlannerCockpit />);
    const caption = screen.getByTestId("room-resolve-caption");
    expect(caption.getAttribute("data-visible")).toBe("true");
    expect(caption.getAttribute("aria-live")).toBe("polite");
    expect(caption.querySelector("svg")).toBeNull();
  });
});
