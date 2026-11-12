import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock only the network edges; stores + model stay real.
const mocks = vi.hoisted(() => ({
  compileOpsHandoffPack: vi.fn(),
  linkEventConfiguration: vi.fn(),
  getEventPhaseGraph: vi.fn(),
}));
vi.mock("../../../../api/ops-handoff.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/ops-handoff.js")>();
  return { ...actual, compileOpsHandoffPack: mocks.compileOpsHandoffPack };
});
vi.mock("../../../../api/events.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api/events.js")>();
  return {
    ...actual,
    linkEventConfiguration: mocks.linkEventConfiguration,
    getEventPhaseGraph: mocks.getEventPhaseGraph,
  };
});

import { OpsLensPanel } from "../OpsLensPanel.js";
import { ApiError } from "../../../../api/client.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const VENUE_ID = "33333333-3333-4333-8333-333333333333";

function renderPanel(search = ""): void {
  render(<MemoryRouter initialEntries={[`/plan/${CONFIG_ID}${search}`]}><OpsLensPanel /></MemoryRouter>);
}

/** Minimal phase graph: the panel reads only the event id and name from it. */
function eventGraph(): unknown {
  return {
    event: {
      id: EVENT_ID, venueId: VENUE_ID, createdBy: null, name: "Baxter wedding",
      eventType: null, status: "draft", startsAt: null, endsAt: null,
      guestCount: null, clientName: null, notes: null,
      createdAt: "2026-09-15T09:00:00.000Z", updatedAt: "2026-09-15T09:00:00.000Z",
    },
    phases: [], scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  };
}

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}

function signInStaff(): void {
  useAuthStore.getState().setUser({ id: "u1", email: "staff@venue.test", role: "staff", platformRole: "none", venueId: VENUE_ID, name: "Staff" });
}

beforeEach(() => {
  mocks.compileOpsHandoffPack.mockReset();
  mocks.linkEventConfiguration.mockReset();
  mocks.linkEventConfiguration.mockResolvedValue({});
  mocks.getEventPhaseGraph.mockReset();
  mocks.getEventPhaseGraph.mockResolvedValue(eventGraph());
  usePlacementStore.setState({ placedItems: [] });
  useEditorStore.setState({ configId: null, venueId: VENUE_ID, isPublicPreview: false });
  useAuthStore.getState().logout();
  useLightingRigStore.getState().clear();
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const HASH = "a".repeat(64);
const STAMP = "2026-11-12T09:00:00.000Z";

/** A whole pack as the compile route sends it, valid against the shared schema. */
function storedBundle(): unknown {
  const packId = "44444444-4444-4444-8444-444444444444";
  return {
    pack: {
      id: packId, eventId: null, configId: CONFIG_ID, snapshotId: "55555555-5555-4555-8555-555555555555",
      snapshotHash: HASH, version: 1, status: "compiled", sourceLabel: "Approved configuration snapshot v1",
      summary: "Grand Hall handoff compiled from approved snapshot v1.", createdBy: null, compiledAt: STAMP, updatedAt: STAMP,
    },
    taskGroups: [], opsTasks: [],
    furniturePickList: { id: "66666666-6666-4666-8666-666666666666", handoffPackId: packId, title: "Grand Hall furniture pick list", totalItems: 0, createdAt: STAMP },
    pickListItems: [], supplierInstructions: [], loadInSequence: [], breakdownSequence: [], roomFlipPlans: [],
    beoDocument: {
      id: "77777777-7777-4777-8777-777777777777", handoffPackId: packId, title: "Dinner BEO internal handoff",
      body: "BEO internal operations handoff.", sourceSnapshotHash: HASH, safeStatus: "internal_operations_handoff", createdAt: STAMP,
    },
    snapshotDiff: {
      id: "88888888-8888-4888-8888-888888888888", handoffPackId: packId, previousSnapshotHash: null, currentSnapshotHash: HASH,
      addedCount: 0, removedCount: 0, changedCount: 0, summary: "No previous approved snapshot is available for comparison.",
      payload: { added: [], removed: [], changed: [] }, createdAt: STAMP,
    },
  };
}

/** A mocked compile that made a new pack, as most cases here want. */
function compiled(bundle: unknown): { readonly bundle: unknown; readonly created: true } {
  return { bundle, created: true };
}

/** The real compile call, answered by the route's envelope (`created` beside
 *  `data`). Undefined answers as an API a deploy behind does: 201 and `data`
 *  alone, because it made a new pack on every compile. */
async function answerCompileWith(created: boolean | undefined): Promise<void> {
  const actual = await vi.importActual<typeof import("../../../../api/ops-handoff.js")>("../../../../api/ops-handoff.js");
  mocks.compileOpsHandoffPack.mockImplementation(actual.compileOpsHandoffPack);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
    JSON.stringify({ data: storedBundle(), created }),
    { status: created === false ? 200 : 201, headers: { "Content-Type": "application/json" } },
  ))));
}

describe("OpsLensPanel", () => {
  it("builds the live setup plan from the layout", () => {
    usePlacementStore.setState({ placedItems: [...place(roundTable(), 18), ...place(chair(), 144)] });
    renderPanel();
    expect(screen.getByTestId("ops-lens-panel")).toBeTruthy();
    expect(screen.getByText("Run of show")).toBeTruthy();
    expect(screen.getByTestId("ops-task-round-tables")).toBeTruthy();
    expect(screen.getByTestId("ops-task-chairs")).toBeTruthy();
    expect(screen.getByText("Suggested crew")).toBeTruthy();
    expect(screen.getByText(/not a guaranteed schedule/i)).toBeTruthy();
  });

  it("shows an empty-state hint with nothing placed", () => {
    renderPanel();
    expect(screen.getByTestId("ops-empty")).toBeTruthy();
  });

  it("adds a lighting rig task from the Lighting lens rig", () => {
    useLightingRigStore.getState().setCount("par", 12);
    renderPanel();
    expect(screen.getByTestId("ops-task-lighting").textContent).toMatch(/12 to place/);
  });

  it("tells an anonymous organiser who prepares the pack and how to reach them", () => {
    usePlacementStore.setState({ placedItems: place(chair(), 10) });
    renderPanel();
    const note = screen.getByTestId("ops-precondition").textContent ?? "";
    expect(note).not.toMatch(/sign in as venue staff/iu);
    expect(note).toBe("The events team prepares the setup pack once they have your plan. To send it to them, use Send to Events Team.");
    expect(screen.queryByTestId("ops-compile")).toBeNull();
  });

  it("asks to save the layout when signed in without a saved configuration", () => {
    signInStaff();
    renderPanel();
    expect(screen.getByTestId("ops-precondition").textContent).toMatch(/save this layout/i);
    expect(screen.queryByTestId("ops-compile")).toBeNull();
  });

  it("compiles the handoff pack and links to it", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.compileOpsHandoffPack.mockResolvedValue(compiled({
      pack: { id: "pk1", summary: "Setup plan compiled for the Grand Hall.", status: "draft" },
      opsTasks: [{}, {}, {}],
      loadInSequence: [{}, {}],
    }));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID });
    expect(screen.getByTestId("ops-pack-open").getAttribute("href")).toBe("/ops/handoff/pk1");
    expect(screen.getByTestId("ops-pack-result").textContent).toMatch(/3 tasks · 2 load-in steps/);
  });

  // T-695 review H6: a recompile that changes nothing returns the standing
  // pack (200, created false), and the panel says so rather than "compiled".
  it("says the pack is unchanged when the compile returned the standing pack", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    await answerCompileWith(false);

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    const result = screen.getByTestId("ops-pack-result");
    expect(result.textContent).toContain("Handoff pack unchanged");
    expect(result.textContent).toContain("The plan is the same as the last pack, so the floor keeps its progress.");
    expect(result.textContent).not.toContain("Handoff pack compiled");
  });

  it("says the pack is compiled when the compile made a new one", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    await answerCompileWith(true);

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    const result = screen.getByTestId("ops-pack-result");
    expect(result.textContent).toContain("Handoff pack compiled");
    expect(result.textContent).not.toContain("Handoff pack unchanged");
    expect(result.textContent).not.toContain("the floor keeps its progress");
  });

  // The web and the API deploy separately, so the page is briefly ahead of
  // the API. An API before `created` made a new pack on every compile and
  // sent only `data`: the pack it made must still show, as compiled.
  it("shows the pack an API a deploy behind made, whose reply has no `created`", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    await answerCompileWith(undefined);

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    const result = screen.getByTestId("ops-pack-result");
    expect(result.textContent).toContain("Handoff pack compiled");
    expect(result.textContent).not.toContain("Handoff pack unchanged");
    expect(screen.queryByTestId("ops-pack-unchanged")).toBeNull();
  });

  it("shows a friendly error when compiling fails", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.compileOpsHandoffPack.mockRejectedValue(new Error("network"));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-error")).toBeTruthy(); });
    expect(screen.queryByTestId("ops-pack-result")).toBeNull();
  });

  it("shows an actionable server review gate instead of a generic connection error", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.compileOpsHandoffPack.mockRejectedValue(new ApiError(
      409,
      "Ops compilation remains blocked until a separate reviewed guest-flow evidence artifact is attached",
      "BLOCKING_REVIEW_GATE",
    ));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => {
      expect(screen.getByTestId("ops-error").textContent).toMatch(/separate reviewed guest-flow evidence artifact/i);
    });
  });

  it("says a refused compile plainly instead of blaming the connection", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID });
    mocks.compileOpsHandoffPack.mockRejectedValue(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-error")).toBeTruthy(); });
    const message = screen.getByTestId("ops-error").textContent ?? "";
    expect(message).toMatch(/^You don't have permission to compile this layout's handoff pack/u);
    expect(message).not.toMatch(/connection/iu);
  });

  it("on a shared link's preview, keeps the venue's sales the setup plan and says who compiles, with no compile to refuse", () => {
    useAuthStore.getState().setUser({ id: "u3", email: "sales@venue.test", role: "sales", platformRole: "none", venueId: VENUE_ID, name: "Sales" });
    useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: true });
    usePlacementStore.setState({ placedItems: [...place(roundTable(), 6), ...place(chair(), 48)] });

    renderPanel();
    // The browser's own sections stand: the setup plan and the effort estimate.
    expect(screen.getByTestId("ops-task-round-tables")).toBeTruthy();
    expect(screen.getByText("Suggested crew")).toBeTruthy();
    expect(screen.queryByTestId("ops-compile")).toBeNull();
    expect(screen.getByTestId("ops-precondition").textContent).toBe(
      "Only this venue's admins, managers, staff and hallkeepers can compile its handoff pack, so one of them has to do it.",
    );
  });

  it("on a shared link's preview, keeps the compile for the venue's floor", () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, isPublicPreview: true });

    renderPanel();
    expect(screen.getByTestId("ops-compile")).toBeTruthy();
    expect(screen.queryByTestId("ops-precondition")).toBeNull();
  });

  it("binds the corridor's event to the saved layout and compiles the pack against it", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.compileOpsHandoffPack.mockResolvedValue(compiled({
      pack: { id: "pk2", summary: "Setup plan compiled for the Grand Hall.", status: "compiled" },
      opsTasks: [{}],
      loadInSequence: [{}],
    }));

    renderPanel(`?eventId=${EVENT_ID}`);

    // Mounting the lens writes nothing: the link is also a participation grant,
    // so it waits for the explicit compile.
    expect((await screen.findByTestId("ops-event-binding")).textContent)
      .toMatch(/Not attached to Baxter wedding yet/);
    expect(mocks.linkEventConfiguration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ops-compile"));
    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.linkEventConfiguration).toHaveBeenCalledWith(EVENT_ID, {
      configurationId: CONFIG_ID,
      linkType: "source_configuration",
    });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID, eventId: EVENT_ID });
    expect(screen.getByTestId("ops-event-binding").textContent)
      .toMatch(/Attached to Baxter wedding, so this pack reaches the event day board/);

    // A second compile reuses the recorded binding instead of writing again.
    fireEvent.click(screen.getByTestId("ops-compile"));
    await waitFor(() => { expect(mocks.compileOpsHandoffPack).toHaveBeenCalledTimes(2); });
    expect(mocks.linkEventConfiguration).toHaveBeenCalledTimes(1);
  });

  it("compiles without an event when the planner was not opened from an event link", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    mocks.compileOpsHandoffPack.mockResolvedValue(compiled({
      pack: { id: "pk3", summary: "Setup plan compiled.", status: "compiled" },
      opsTasks: [], loadInSequence: [],
    }));

    renderPanel();
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID });
    expect(mocks.linkEventConfiguration).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ops-event-binding")).toBeNull();
  });

  it("compiles without the event and names the refusal when a client-owned layout is rejected", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.linkEventConfiguration.mockRejectedValue(new ApiError(
      409,
      "This layout belongs to a client account, and linking it would give that client access to the event schedule",
      "CONFIGURATION_OWNER_IS_CUSTOMER",
    ));
    mocks.compileOpsHandoffPack.mockResolvedValue(compiled({
      pack: { id: "pk4", summary: "Setup plan compiled.", status: "compiled" },
      opsTasks: [{}], loadInSequence: [{}],
    }));

    renderPanel(`?eventId=${EVENT_ID}`);
    await screen.findByTestId("ops-event-binding");
    fireEvent.click(screen.getByTestId("ops-compile"));

    // The refusal never becomes a 409 dead end: the pack still compiles,
    // unbound, exactly as it did before the event chain existed.
    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID });
    expect(screen.queryByTestId("ops-error")).toBeNull();
    const note = screen.getByTestId("ops-event-binding");
    expect(note.textContent).toMatch(/Not attached to Baxter wedding\./);
    expect(note.textContent).toMatch(/belongs to a client account/);
    expect(note.textContent).toMatch(/reach the event day board/);
    expect(note.className).toMatch(/lens-panel__note--warn/);
  });

  it("lets a hallkeeper compile the pack without the event when the binding is forbidden", async () => {
    useAuthStore.getState().setUser({ id: "u2", email: "hall@venue.test", role: "hallkeeper", platformRole: "none", venueId: VENUE_ID, name: "Hallkeeper" });
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.linkEventConfiguration.mockRejectedValue(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    mocks.compileOpsHandoffPack.mockResolvedValue(compiled({
      pack: { id: "pk5", summary: "Setup plan compiled.", status: "compiled" },
      opsTasks: [{}], loadInSequence: [{}],
    }));

    renderPanel(`?eventId=${EVENT_ID}`);
    await screen.findByTestId("ops-event-binding");
    fireEvent.click(screen.getByTestId("ops-compile"));

    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenCalledWith({ configId: CONFIG_ID });
    expect(screen.getByTestId("ops-event-binding").textContent)
      .toMatch(/You don't have permission to attach this pack to the event, so venue staff or an administrator has to do it/);
  });

  it("retries a failed binding on the next compile and attaches the pack once it succeeds", async () => {
    signInStaff();
    useEditorStore.setState({ configId: CONFIG_ID, venueId: VENUE_ID });
    usePlacementStore.setState({ placedItems: place(chair(), 20) });
    mocks.linkEventConfiguration.mockRejectedValueOnce(new Error("network"));
    mocks.linkEventConfiguration.mockResolvedValue({});
    mocks.compileOpsHandoffPack.mockResolvedValue(compiled({
      pack: { id: "pk6", summary: "Setup plan compiled.", status: "compiled" },
      opsTasks: [{}], loadInSequence: [{}],
    }));

    renderPanel(`?eventId=${EVENT_ID}`);
    await screen.findByTestId("ops-event-binding");

    fireEvent.click(screen.getByTestId("ops-compile"));
    await waitFor(() => { expect(screen.getByTestId("ops-pack-result")).toBeTruthy(); });
    expect(mocks.compileOpsHandoffPack).toHaveBeenNthCalledWith(1, { configId: CONFIG_ID });
    expect(screen.getByTestId("ops-event-binding").textContent)
      .toMatch(/The attachment request didn't complete/);

    fireEvent.click(screen.getByTestId("ops-compile"));
    await waitFor(() => {
      expect(screen.getByTestId("ops-event-binding").textContent).toMatch(/Attached to Baxter wedding/);
    });
    expect(mocks.linkEventConfiguration).toHaveBeenCalledTimes(2);
    expect(mocks.compileOpsHandoffPack).toHaveBeenNthCalledWith(2, { configId: CONFIG_ID, eventId: EVENT_ID });
  });
});
