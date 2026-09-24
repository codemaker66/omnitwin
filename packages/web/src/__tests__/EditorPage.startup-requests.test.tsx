import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import type { Configuration } from "../api/configurations.js";
import type { Space, Venue } from "../api/spaces.js";

// The /plan start-up chain: tracked-draft lookups run beside the venue and
// room lookups, the chosen draft is not read twice, and the room and venue
// reads start before the draft opens — without changing which draft opens,
// which endpoint an account loads through, or what a superseded route does.

vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => null }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({ TruthModeIndicator: () => null }));
vi.mock("../hooks/use-media-query.js", () => ({ useIsCoarsePointer: () => false, useIsNarrowViewport: () => false }));
vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  getConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
  parseRevisionConflict: vi.fn(() => null),
}));
vi.mock("../api/spaces.js", () => ({ listVenues: vi.fn(), listSpaces: vi.fn(), getSpace: vi.fn(), getVenue: vi.fn() }));

const configApi = vi.mocked(await import("../api/configurations.js"));
const spacesApi = vi.mocked(await import("../api/spaces.js"));
const { EditorPage } = await import("../pages/EditorPage.js");
const { useAuthStore } = await import("../stores/auth-store.js");
const { useEditorStore } = await import("../stores/editor-store.js");

const venue: Venue = { id: "venue-trades", name: "Trades Hall", slug: "trades-hall", address: "85 Glassford Street", logoUrl: null, brandColour: null };
function room(id: string, slug: string, name: string): Space {
  return { id, venueId: venue.id, name, slug, widthM: "12", lengthM: "10", heightM: "4", floorPlanOutline: [] };
}
const reception = room("space-reception", "reception-room", "Reception Room");
const grandHall = room("space-grand", "grand-hall", "Grand Hall");

function draft(id: string, space: Space, extra: Partial<Configuration> = {}): Configuration {
  return {
    id, spaceId: space.id, venueId: space.venueId, userId: null, name: id, isPublicPreview: true, revision: 3,
    updatedAt: "2026-09-20T10:00:00.000Z",
    objects: [{ id: `${id}-table`, configurationId: id, assetDefinitionId: "round-table-6ft", positionX: "1", positionY: "0",
      positionZ: "2", rotationX: "0", rotationY: "0", rotationZ: "0", scale: "1", sortOrder: 0, metadata: null }],
    ...extra,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Tracked drafts, oldest first, as the store records them. */
function track(...configIds: readonly string[]): void {
  localStorage.setItem("omnitwin_my_configs", JSON.stringify(configIds.map((configId, index) =>
    ({ configId, createdAt: `2026-09-2${String(index)}T10:00:00.000Z` }))));
}

function lookupSignal(configId: string): AbortSignal | undefined {
  return configApi.getPublicConfig.mock.calls.find(([id]) => id === configId)?.[1];
}

function Location(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function LeavePlanner(): ReactElement {
  const navigate = useNavigate();
  return <button type="button" onClick={() => { void navigate("/elsewhere"); }}>Leave planner</button>;
}

function renderPlanner(entry = "/plan"): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Location />
      <LeavePlanner />
      <Routes>
        <Route path="/plan" element={<EditorPage />} />
        <Route path="/plan/:code" element={<EditorPage />} />
        <Route path="/elsewhere" element={<p>Elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
  useAuthStore.getState().setUser(null);
  spacesApi.listVenues.mockResolvedValue([venue]);
  spacesApi.listSpaces.mockResolvedValue([grandHall, reception]);
  spacesApi.getVenue.mockResolvedValue({ ...venue, spaces: [grandHall, reception] });
  spacesApi.getSpace.mockImplementation((_venueId, spaceId) => Promise.resolve(spaceId === grandHall.id ? grandHall : reception));
});

afterEach(cleanup);

describe("tracked draft lookups", () => {
  it("start together, beside the venue lookup", async () => {
    const venues = deferred<Venue[]>();
    spacesApi.listVenues.mockReturnValue(venues.promise);
    configApi.getPublicConfig.mockReturnValue(new Promise(() => undefined));
    track("draft-a", "draft-b", "draft-c");
    renderPlanner();
    await waitFor(() => { expect(configApi.getPublicConfig).toHaveBeenCalledTimes(3); });
    expect(configApi.getPublicConfig.mock.calls.map(([id]) => id)).toEqual(["draft-c", "draft-b", "draft-a"]);
    expect(spacesApi.listSpaces).not.toHaveBeenCalled();
  });

  it("still open the newest tracked draft for the room, whatever order the answers arrive in", async () => {
    // Newest first: stale, reception (newer), grand hall, reception (older).
    track("reception-older", "grand", "reception-newer", "stale");
    const answers = new Map([
      ["stale", deferred<Configuration>()], ["reception-newer", deferred<Configuration>()],
      ["grand", deferred<Configuration>()], ["reception-older", deferred<Configuration>()],
    ]);
    configApi.getPublicConfig.mockImplementation((id) => answers.get(id)?.promise ?? Promise.reject(new Error(id)));
    renderPlanner();
    await screen.findByRole("heading", { name: "Opening the Reception Room planner" });

    await act(async () => {
      answers.get("reception-older")?.resolve(draft("reception-older", reception));
      answers.get("grand")?.resolve(draft("grand", grandHall));
      answers.get("reception-newer")?.resolve(draft("reception-newer", reception));
      await Promise.resolve();
    });
    // A newer entry has not answered yet, so nothing may be chosen.
    expect(location()).toBe("/plan");

    await act(async () => {
      answers.get("stale")?.reject(new ApiError(404, "Public preview configuration not found", "NOT_FOUND"));
      await Promise.resolve();
    });
    await waitFor(() => { expect(location()).toBe("/plan/reception-newer"); });
    expect(configApi.createPublicConfig).not.toHaveBeenCalled();
  });

  it("ignore stale, claimed, unreachable and other-room drafts exactly as before", async () => {
    track("other-room", "unreachable", "claimed", "stale");
    configApi.getPublicConfig.mockImplementation((id) => {
      if (id === "stale") return Promise.reject(new ApiError(404, "Public preview configuration not found", "NOT_FOUND"));
      if (id === "claimed") return Promise.resolve(draft("claimed", reception, { isPublicPreview: false, userId: "owner" }));
      if (id === "unreachable") return Promise.reject(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
      return Promise.resolve(draft(id, grandHall));
    });
    configApi.createPublicConfig.mockResolvedValue(draft("created", reception));
    renderPlanner();
    await waitFor(() => { expect(location()).toBe("/plan/created"); });
    expect(configApi.createPublicConfig).toHaveBeenCalledWith(reception.id);
  });

  it("never navigate for a superseded route, and are cancelled", async () => {
    track("reception-draft");
    const answer = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValue(answer.promise);
    renderPlanner();
    await screen.findByRole("heading", { name: "Opening the Reception Room planner" });
    fireEvent.click(screen.getByRole("button", { name: "Leave planner" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
    expect(lookupSignal("reception-draft")?.aborted).toBe(true);

    await act(async () => { answer.resolve(draft("reception-draft", reception)); await answer.promise; });
    expect(location()).toBe("/elsewhere");
    expect(configApi.createPublicConfig).not.toHaveBeenCalled();
  });

  it("cancel the lookups left unanswered once a newer draft has been chosen", async () => {
    track("older", "newest");
    configApi.getPublicConfig.mockImplementation((id) => id === "newest"
      ? Promise.resolve(draft("newest", reception))
      : new Promise(() => undefined));
    renderPlanner();
    await waitFor(() => { expect(location()).toBe("/plan/newest"); });
    expect(lookupSignal("older")?.aborted).toBe(true);
  });
});

describe("opening the chosen draft", () => {
  it("gives a guest's planner the draft already read instead of reading it again", async () => {
    track("reception-draft");
    configApi.getPublicConfig.mockResolvedValue(draft("reception-draft", reception));
    renderPlanner();
    await waitFor(() => {
      expect(screen.getByTestId("planner-3d-shell").getAttribute("data-planner-config-id")).toBe("reception-draft");
    });
    expect(configApi.getPublicConfig).toHaveBeenCalledTimes(1);
    expect(configApi.getConfig).not.toHaveBeenCalled();
    expect(useEditorStore.getState()).toMatchObject({
      configId: "reception-draft", spaceId: reception.id, venueId: venue.id, configRevision: 3, isPublicPreview: true, isDirty: false,
    });
    expect(useEditorStore.getState().objects.map((object) => [object.id, object.positionX])).toEqual([["reception-draft-table", 1]]);
  });

  it("still loads a signed-in account's reopened draft through the authenticated endpoint", async () => {
    useAuthStore.getState().setUser({ id: "planner-1", email: "planner@example.test", name: "Planner", role: "planner", platformRole: "none", venueId: venue.id });
    track("reception-draft");
    configApi.getPublicConfig.mockResolvedValue(draft("reception-draft", reception));
    configApi.getConfig.mockResolvedValue(draft("reception-draft", reception));
    renderPlanner();
    await waitFor(() => {
      expect(screen.getByTestId("planner-3d-shell").getAttribute("data-planner-config-id")).toBe("reception-draft");
    });
    expect(configApi.getConfig).toHaveBeenCalledWith("reception-draft");
    // Only the lookup used the public endpoint.
    expect(configApi.getPublicConfig).toHaveBeenCalledTimes(1);
  });

  it("reads the room and venue while the draft is created, then does not read the room again", async () => {
    const created = deferred<Configuration>();
    configApi.createPublicConfig.mockReturnValue(created.promise);
    renderPlanner();
    await waitFor(() => { expect(configApi.createPublicConfig).toHaveBeenCalledWith(reception.id); });
    expect(spacesApi.getSpace).toHaveBeenCalledWith(venue.id, reception.id);
    expect(spacesApi.getVenue).toHaveBeenCalledWith(venue.id);

    await act(async () => { created.resolve(draft("created", reception, { revision: 1, objects: [] })); await created.promise; });
    await waitFor(() => { expect(useEditorStore.getState().space?.id).toBe(reception.id); });
    expect(location()).toBe("/plan/created");
    expect(spacesApi.getSpace).toHaveBeenCalledTimes(1);
  });
});
