import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import type { Configuration } from "../api/configurations.js";
import type { Space, Venue } from "../api/spaces.js";

// ---------------------------------------------------------------------------
// "Sign In to Save" on the planner (audit web-auth-routing-2).
//
// The claim that makes a guest's plan theirs used to live only in the sign-in
// dialog. Signing in tears that dialog down before it can run: the planner's
// auth boundary swaps the page for one inside Clerk's provider (a remount),
// whose access gate then shows its own screen while access is checked. So the
// plan stayed ownerless and the person's saves were refused.
//
// The page claims instead: whenever a signed-in person has a draft this
// browser created open at its own address. These tests run the real page and
// store inside the real boundary; only Clerk's provider (reduced to its
// access gate), the 3D room and the network are replaced.
// ---------------------------------------------------------------------------

const sessionHint = vi.hoisted(() => vi.fn(() => false));
vi.mock("../lib/clerk-session-hint.js", () => ({ hasLikelyClerkSession: sessionHint }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router-dom")>(),
  createBrowserRouter: vi.fn(() => ({})),
}));
vi.mock("../components/auth/ClerkRouteProvider.js", async () => {
  const { useAuthStore: authStore } = await import("../stores/auth-store.js");
  return {
    // As the real provider's WorkspaceAccessGate does: its own screen stands in
    // for the page while the person's access is checked.
    ClerkRouteProvider: ({ children }: { readonly children: ReactNode }) => {
      const checking = authStore((state) => state.accessStatus === "checking");
      return <div data-testid="clerk-provider">{checking ? <p>Checking access</p> : children}</div>;
    },
  };
});
vi.mock("../components/editor/cockpit/PlannerCockpit.js", () => ({
  PlannerCockpit: () => <div data-testid="planner-cockpit" />,
}));
vi.mock("../pages/BlueprintPage.js", () => ({ BlueprintPage: () => null }));
vi.mock("../components/editor/SaveSendPanel.js", () => ({ SaveSendPanel: () => null }));
vi.mock("../components/editor/MobilePlannerTopBar.js", () => ({ MobilePlannerTopBar: () => null }));
vi.mock("../components/editor/SubmitForReviewPanel.js", () => ({ SubmitForReviewPanel: () => null }));
vi.mock("../components/editor/EditorBridge.js", () => ({ EditorBridge: () => null }));
vi.mock("../components/editor/LayoutLiveLayer.js", () => ({ LayoutLiveLayer: () => null }));
vi.mock("../components/editor/ObjectNotePanel.js", () => ({ ObjectNotePanel: () => null }));
vi.mock("../components/editor/EventDetailsPanel.js", () => ({ EventDetailsPanel: () => null }));
vi.mock("../components/truth/TruthModeIndicator.js", () => ({ TruthModeIndicator: () => null }));
vi.mock("../hooks/use-media-query.js", () => ({ useIsCoarsePointer: () => false, useIsNarrowViewport: () => false }));
vi.mock("../api/configuration-conflict.js", () => ({ parseRevisionConflict: vi.fn(() => null) }));
vi.mock("../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));
vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  getConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  claimConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
}));
vi.mock("../api/spaces.js", () => ({ listVenues: vi.fn(), listSpaces: vi.fn(), getSpace: vi.fn(), getVenue: vi.fn() }));

const configApi = vi.mocked(await import("../api/configurations.js"));
const spacesApi = vi.mocked(await import("../api/spaces.js"));
const { EditorPage } = await import("../pages/EditorPage.js");
const { PlannerAuthBoundary } = await import("../router.js");
const { useAuthStore } = await import("../stores/auth-store.js");
const { useEditorStore } = await import("../stores/editor-store.js");

const venue: Venue = { id: "venue-trades", name: "Trades Hall", slug: "trades-hall", address: "85 Glassford Street", logoUrl: null, brandColour: null };
const reception: Space = { id: "space-reception", venueId: venue.id, name: "Reception Room", slug: "reception-room", widthM: "12", lengthM: "10", heightM: "4", floorPlanOutline: [] };

const client = { id: "client-1", email: "client@example.test", name: "Client", role: "client", platformRole: "none" as const, venueId: null };
const staff = { id: "staff-1", email: "staff@example.test", name: "Staff", role: "staff", platformRole: "none" as const, venueId: venue.id };

const TABLE = { id: "draft-1-table", configurationId: "draft-1", assetDefinitionId: "round-table-6ft", positionX: "1", positionY: "0",
  positionZ: "2", rotationX: "0", rotationY: "0", rotationZ: "0", scale: "1", sortOrder: 0, metadata: null };

function draft(id: string, extra: Partial<Configuration> = {}): Configuration {
  return { id, spaceId: reception.id, venueId: venue.id, userId: null, name: id, isPublicPreview: true, revision: 3,
    updatedAt: "2026-11-10T10:00:00.000Z", objects: [{ ...TABLE, configurationId: id }], ...extra };
}

/** The claim secret the create route gave this browser for a draft. */
function secretFor(configId: string): string {
  return `secret-for-${configId}-0123456789abcdef`;
}

/** A draft this browser created, as the store records it. */
function track(configId: string): void {
  localStorage.setItem("omnitwin_my_configs", JSON.stringify([{ configId, createdAt: "2026-11-10T10:00:00.000Z", claimSecret: secretFor(configId) }]));
}

function Location(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPlanner(entry: string): void {
  const page = <Suspense fallback={<p>Loading</p>}><PlannerAuthBoundary><EditorPage /></PlannerAuthBoundary></Suspense>;
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Location />
      <Routes>
        <Route path="/plan" element={page} />
        <Route path="/plan/:code" element={page} />
      </Routes>
    </MemoryRouter>,
  );
}

async function plannerOpenOn(configId: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("planner-3d-shell").getAttribute("data-planner-config-id")).toBe(configId);
  });
}

const REFUSED = new ApiError(403, "Insufficient permissions", "FORBIDDEN");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionHint.mockReturnValue(false);
  useEditorStore.getState().reset();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true, error: null, accessStatus: "signed_out", accessEmail: null });
  spacesApi.listVenues.mockResolvedValue([venue]);
  spacesApi.listSpaces.mockResolvedValue([reception]);
  spacesApi.getVenue.mockResolvedValue({ ...venue, spaces: [reception] });
  spacesApi.getSpace.mockResolvedValue(reception);
  configApi.claimConfig.mockImplementation((configId) => Promise.resolve(draft(configId, { isPublicPreview: false, userId: client.id })));
  configApi.authBatchSave.mockResolvedValue({ revision: 4, objects: [TABLE] });
  configApi.publicBatchSave.mockResolvedValue({ revision: 4, objects: [TABLE] });
});

afterEach(cleanup);

describe("a guest who signs in on their own plan", () => {
  it("has the plan added to their account, though signing in remounts the planner and closes the dialog", async () => {
    track("draft-1");
    configApi.getPublicConfig.mockResolvedValue(draft("draft-1"));
    renderPlanner("/plan/draft-1");
    await plannerOpenOn("draft-1");
    expect(screen.queryByTestId("clerk-provider")).toBeNull();

    // Clerk reports the sign-in made in the dialog: the access check begins,
    // and the boundary puts the planner inside Clerk's provider.
    act(() => { useAuthStore.getState().beginAccessCheck(client.email); });
    await waitFor(() => { expect(screen.getByTestId("clerk-provider")).toBeTruthy(); });
    expect(screen.queryByTestId("planner-3d-shell")).toBeNull();
    expect(configApi.claimConfig).not.toHaveBeenCalled();

    // The API names the person, and the planner comes back.
    act(() => { useAuthStore.getState().setUser(client); });
    await plannerOpenOn("draft-1");

    await waitFor(() => { expect(configApi.claimConfig).toHaveBeenCalledWith("draft-1", secretFor("draft-1")); });
    await waitFor(() => { expect(useEditorStore.getState().isPublicPreview).toBe(false); });
    // The plan is then saved as theirs, through the signed-in route.
    await waitFor(() => { expect(configApi.authBatchSave).toHaveBeenCalledWith("draft-1", expect.any(Array), 3); });
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
    expect(configApi.claimConfig).toHaveBeenCalledTimes(1);
  });

  it("has it added when sign-in brought them back to the plan's address on a fresh page", async () => {
    // Clerk's cookie is there from the first render, so the provider is too.
    sessionHint.mockReturnValue(true);
    track("draft-1");
    configApi.getPublicConfig.mockResolvedValue(draft("draft-1"));
    renderPlanner("/plan/draft-1");
    await plannerOpenOn("draft-1");

    act(() => { useAuthStore.getState().beginAccessCheck(client.email); });
    act(() => { useAuthStore.getState().setUser(client); });

    await waitFor(() => { expect(configApi.claimConfig).toHaveBeenCalledWith("draft-1", secretFor("draft-1")); });
    await waitFor(() => { expect(useEditorStore.getState().isPublicPreview).toBe(false); });
    expect(configApi.claimConfig).toHaveBeenCalledTimes(1);
  });
});

describe("a signed-in person opening a public preview by its address", () => {
  beforeEach(() => {
    sessionHint.mockReturnValue(true);
  });

  it("opens their own unclaimed draft and makes it theirs", async () => {
    useAuthStore.getState().setUser(client);
    track("draft-1");
    // Nobody owns it yet, so the signed-in read refuses a client.
    configApi.getConfig.mockRejectedValue(REFUSED);
    configApi.getPublicConfig.mockResolvedValue(draft("draft-1"));
    renderPlanner("/plan/draft-1");
    await plannerOpenOn("draft-1");

    await waitFor(() => { expect(configApi.claimConfig).toHaveBeenCalledWith("draft-1", secretFor("draft-1")); });
    await waitFor(() => { expect(useEditorStore.getState().isPublicPreview).toBe(false); });
  });

  it("opens someone else's shared plan as a preview, never claims it, and saves it as a guest would", async () => {
    useAuthStore.getState().setUser(client);
    configApi.getConfig.mockRejectedValue(REFUSED);
    configApi.getPublicConfig.mockResolvedValue(draft("shared-plan"));
    renderPlanner("/plan/shared-plan");
    await plannerOpenOn("shared-plan");

    expect(screen.queryByRole("heading", { name: "Layout could not be loaded" })).toBeNull();
    expect(configApi.claimConfig).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isPublicPreview).toBe(true);

    await act(async () => { await useEditorStore.getState().saveToServer(true); });
    expect(configApi.publicBatchSave).toHaveBeenCalledWith("shared-plan", expect.any(Array), 3);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(useEditorStore.getState().saveError).toBeNull();
  });

  it("does not take a guest's plan for a member of staff who opens its link", async () => {
    useAuthStore.getState().setUser(staff);
    configApi.getConfig.mockResolvedValue(draft("guest-plan"));
    renderPlanner("/plan/guest-plan");
    await plannerOpenOn("guest-plan");

    await act(async () => { await Promise.resolve(); });
    expect(configApi.claimConfig).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isPublicPreview).toBe(true);
  });
});

// #373: a venue's own staff save a guest plan by the signed-in route. A plan
// opened before the sign-in resolved was read the public way, without its
// notes, and the signed-in save stores each piece as sent, so that copy stays
// on the public routes (lib/guest-plan-notes signedInRoutesSuit). Once the
// person is known, the plan is read again through the signed-in route, and
// their saves go that way (delta review of #388, B2). Work not yet saved is
// never read over.
describe("a member of staff who opened a guest plan's link before sign-in resolved", () => {
  const NOTE = "TEST ONLY nut allergy, seat by the door";

  /** The public read: the note is the guest's, kept from any browser but theirs, and the table says it holds one. */
  function readWithoutNotes(extra: Partial<Configuration> = {}): Configuration {
    return draft("guest-plan", { notesIncluded: false, objects: [{ ...TABLE, configurationId: "guest-plan", metadata: { noteHeld: true } }], ...extra });
  }

  /** The signed-in read returns every note, and says so (api/configurations.ts getConfig). */
  function readWithNotes(objects: Configuration["objects"], extra: Partial<Configuration> = {}): Configuration {
    return draft("guest-plan", { notesIncluded: true, objects, ...extra });
  }

  const noted = { ...TABLE, configurationId: "guest-plan", metadata: { notes: NOTE } };

  async function signInAs(user: typeof staff | typeof client): Promise<void> {
    act(() => { useAuthStore.getState().beginAccessCheck(user.email); });
    act(() => { useAuthStore.getState().setUser(user); });
    await plannerOpenOn("guest-plan");
  }

  function table(): { readonly positionX: number; readonly notes: string; readonly noteHeld?: boolean } | undefined {
    return useEditorStore.getState().objects.find((object) => object.id === TABLE.id);
  }

  /** The last save by the signed-in route: the plan, the note it sent on the table, and the revision it was made against. */
  function lastSignedInSave(): { readonly configId: string; readonly note: unknown; readonly revision: number } | null {
    const call = configApi.authBatchSave.mock.calls.at(-1);
    if (call === undefined) return null;
    const [configId, batch, revision] = call;
    return { configId, note: batch.find((piece) => piece.id === TABLE.id)?.metadata?.notes, revision };
  }

  it("reads the plan again through the signed-in route, and saves by that route", async () => {
    configApi.getPublicConfig.mockResolvedValue(readWithoutNotes());
    configApi.getConfig.mockResolvedValue(readWithNotes([noted]));
    renderPlanner("/plan/guest-plan");
    await plannerOpenOn("guest-plan");
    expect(useEditorStore.getState().notesIncluded).toBe(false);

    await signInAs(staff);

    await waitFor(() => { expect(configApi.getConfig).toHaveBeenCalledWith("guest-plan"); });
    await waitFor(() => { expect(useEditorStore.getState().notesIncluded).toBe(true); });
    act(() => { useEditorStore.getState().updateObject(TABLE.id, { positionX: 3 }); });
    await act(async () => { await useEditorStore.getState().saveToServer(true); });

    // The note goes as the signed-in read gave it, so the route that stores pieces as sent keeps it.
    expect(lastSignedInSave()).toEqual({ configId: "guest-plan", note: NOTE, revision: 3 });
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
    expect(configApi.getConfig).toHaveBeenCalledTimes(1);
  });

  it("saves work made before the sign-in resolved the public way first, then reads the plan again with the work in it", async () => {
    configApi.getPublicConfig.mockResolvedValue(readWithoutNotes());
    renderPlanner("/plan/guest-plan");
    await plannerOpenOn("guest-plan");
    act(() => { useEditorStore.getState().updateObject(TABLE.id, { positionX: 3 }); });

    await signInAs(staff);
    await act(async () => { await Promise.resolve(); });

    // Nothing is read over work not yet saved.
    expect(configApi.getConfig).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(table()?.positionX).toBeCloseTo(3);

    // It goes the way the plan was read, which settles the note it cannot see; the read follows it.
    configApi.publicBatchSave.mockImplementationOnce((_id, batch) => {
      const moved = batch.map((piece) => ({ ...TABLE, configurationId: "guest-plan", positionX: String(piece.positionX), metadata: { noteHeld: true } }));
      configApi.getConfig.mockResolvedValue(readWithNotes(moved.map((piece) => ({ ...piece, metadata: { notes: NOTE } })), { revision: 4 }));
      return Promise.resolve({ revision: 4, objects: moved });
    });
    await act(async () => { await useEditorStore.getState().saveToServer(true); });
    expect(configApi.publicBatchSave).toHaveBeenCalledWith("guest-plan", [expect.objectContaining({ id: TABLE.id })], 3);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();

    await waitFor(() => { expect(useEditorStore.getState().notesIncluded).toBe(true); });
    expect(configApi.getConfig).toHaveBeenCalledTimes(1);
    expect(table()?.positionX).toBeCloseTo(3);
    expect(table()?.notes).toBe(NOTE);

    act(() => { useEditorStore.getState().updateObject(TABLE.id, { positionX: 4 }); });
    await act(async () => { await useEditorStore.getState().saveToServer(true); });
    expect(lastSignedInSave()).toEqual({ configId: "guest-plan", note: NOTE, revision: 4 });
  });

  it("drops a read that comes back after the person has changed the plan, keeps the change, and reads again once it is saved", async () => {
    configApi.getPublicConfig.mockResolvedValue(readWithoutNotes());
    let answer: (config: Configuration) => void = () => undefined;
    configApi.getConfig.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    renderPlanner("/plan/guest-plan");
    await plannerOpenOn("guest-plan");

    await signInAs(staff);
    await waitFor(() => { expect(configApi.getConfig).toHaveBeenCalledTimes(1); });
    act(() => { useEditorStore.getState().updateObject(TABLE.id, { positionX: 3 }); });
    await act(async () => { answer(readWithNotes([noted])); await Promise.resolve(); });

    expect(table()?.positionX).toBeCloseTo(3);
    expect(table()?.noteHeld).toBe(true);
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, notesIncluded: false });

    configApi.publicBatchSave.mockImplementationOnce((_id, batch) => {
      const moved = batch.map((piece) => ({ ...TABLE, configurationId: "guest-plan", positionX: String(piece.positionX), metadata: { noteHeld: true } }));
      configApi.getConfig.mockResolvedValue(readWithNotes(moved.map((piece) => ({ ...piece, metadata: { notes: NOTE } })), { revision: 4 }));
      return Promise.resolve({ revision: 4, objects: moved });
    });
    await act(async () => { await useEditorStore.getState().saveToServer(true); });
    await waitFor(() => { expect(useEditorStore.getState().notesIncluded).toBe(true); });
    expect(configApi.getConfig).toHaveBeenCalledTimes(2);
    expect(table()?.positionX).toBeCloseTo(3);
  });

  it("does not read again for someone the signed-in routes do not answer", async () => {
    configApi.getPublicConfig.mockResolvedValue(readWithoutNotes());
    renderPlanner("/plan/guest-plan");
    await plannerOpenOn("guest-plan");

    await signInAs(client);
    await act(async () => { await Promise.resolve(); });

    expect(configApi.getConfig).not.toHaveBeenCalled();
    expect(useEditorStore.getState().notesIncluded).toBe(false);
  });
});

describe("a signed-in person's new plan", () => {
  beforeEach(() => {
    sessionHint.mockReturnValue(true);
    useAuthStore.getState().setUser(client);
    configApi.createPublicConfig.mockResolvedValue({ ...draft("created", { revision: 1, objects: [] }), claimSecret: secretFor("created") });
  });

  it("is claimed once, as it is created, and nothing is saved until they change it", async () => {
    renderPlanner("/plan?space=reception-room");
    await waitFor(() => { expect(screen.getByTestId("location").textContent).toBe("/plan/created"); });
    await plannerOpenOn("created");

    await act(async () => { await Promise.resolve(); });
    expect(configApi.claimConfig).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().isPublicPreview).toBe(false);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });

  it("is claimed once the plan is open when the claim did not arrive as it was created", async () => {
    configApi.claimConfig.mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    renderPlanner("/plan?space=reception-room");
    await waitFor(() => { expect(screen.getByTestId("location").textContent).toBe("/plan/created"); });
    await plannerOpenOn("created");

    await waitFor(() => { expect(configApi.claimConfig).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(useEditorStore.getState().isPublicPreview).toBe(false); });
  });
});
