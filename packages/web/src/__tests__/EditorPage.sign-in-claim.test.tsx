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
