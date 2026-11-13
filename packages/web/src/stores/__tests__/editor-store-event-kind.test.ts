import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Configuration, PlacedObject } from "../../api/configurations.js";
import type { Space } from "../../api/spaces.js";
import { useEditorStore } from "../editor-store.js";
import { useAuthStore } from "../auth-store.js";
import { usePlannerEventStore } from "../planner-event-store.js";
import { answerEventKind, resetEventKindQuestionForTesting, useEventKindQuestion } from "../../lib/event-kind-record.js";
import { claimOpenDraft } from "../../hooks/use-planner-draft-claim.js";

// ---------------------------------------------------------------------------
// The event question's seams in the editor (T-674): a layout's load hands its
// answer, and whether it opened new, to lib/event-kind-record; a superseded
// load hands over nothing; and a guest's new plan, once claimed, writes its
// answer into the layout's own metadata through the real PATCH call.
// ---------------------------------------------------------------------------

vi.mock("../../api/configuration-conflict.js", () => ({ parseRevisionConflict: vi.fn(() => null) }));
vi.mock("../../api/configurations.js", () => ({
  getConfig: vi.fn(), getPublicConfig: vi.fn(), createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(), publicBatchSave: vi.fn(), patchConfigMetadata: vi.fn(),
}));
vi.mock("../../api/spaces.js", () => ({ getSpace: vi.fn() }));
vi.mock("../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));
vi.mock("../../lib/planner-claim.js", () => ({ claimTrackedDraft: vi.fn(), trackedClaimSecret: vi.fn() }));
const configApi = vi.mocked(await import("../../api/configurations.js"));
const conflictApi = vi.mocked(await import("../../api/configuration-conflict.js"));
const spacesApi = vi.mocked(await import("../../api/spaces.js"));
const actionApi = vi.mocked(await import("../../api/action-log.js"));
const claimApi = vi.mocked(await import("../../lib/planner-claim.js"));

const PLANNER = { id: "planner-1", email: "planner@fixture.test", role: "planner", platformRole: "none", venueId: null, name: "Fixture Planner" } as const;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function placed(configId: string): PlacedObject {
  return {
    id: `${configId}-table`, configurationId: configId, assetDefinitionId: "round-table-6ft",
    positionX: "1", positionY: "0", positionZ: "2", rotationX: "0", rotationY: "0", rotationZ: "0",
    scale: "1", sortOrder: 0, metadata: null,
  };
}

function configuration(id: string, options: { readonly own?: boolean; readonly furnished?: boolean; readonly metadata?: unknown } = {}): Configuration {
  return {
    id, revision: 1, spaceId: "room", venueId: "venue", userId: options.own === true ? PLANNER.id : null, name: id,
    isPublicPreview: options.own !== true, updatedAt: "2026-11-13T10:00:00.000Z",
    objects: options.furnished === true ? [placed(id)] : [],
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

function space(id: string): Space {
  return { id, venueId: "venue", name: id, slug: id, widthM: "10", lengthM: "20", heightM: "6", floorPlanOutline: [] };
}

const store = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState();
const question = (): ReturnType<typeof useEventKindQuestion.getState> => useEventKindQuestion.getState();
const saveToServer = useEditorStore.getState().saveToServer;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  store().reset();
  resetEventKindQuestionForTesting();
  conflictApi.parseRevisionConflict.mockReturnValue(null);
  spacesApi.getSpace.mockImplementation((_venue, id) => Promise.resolve(space(id)));
  actionApi.postActionBatch.mockResolvedValue({ accepted: 0, duplicates: 0 });
  configApi.patchConfigMetadata.mockResolvedValue({ id: "written" });
  useAuthStore.setState({ isAuthenticated: false, user: null, isLoading: false });
});

afterEach(() => {
  useEditorStore.setState({ saveToServer });
  useAuthStore.setState({ isAuthenticated: false, user: null });
  resetEventKindQuestionForTesting();
});

describe("a layout's answer, as its load opens it", () => {
  it("reads a signed-in layout's answer from its own load, by the time the load resolves, writing nothing", async () => {
    configApi.getConfig.mockResolvedValueOnce(configuration("signed", { own: true, metadata: { eventKind: "corporate" } }));
    const loading = store().loadConfiguration("signed", true);
    expect(usePlannerEventStore.getState().eventKind).toBeNull();
    await loading;
    expect(usePlannerEventStore.getState().eventKind).toBe("corporate");
    expect(question()).toMatchObject({ configId: "signed", guest: false, known: true, answer: "corporate" });
    expect(configApi.patchConfigMetadata).not.toHaveBeenCalled();
  });

  it("hands over nothing from a load another load has overtaken", async () => {
    const overtaken = deferred<Configuration>();
    configApi.getConfig.mockReturnValueOnce(overtaken.promise);
    const stale = store().loadConfiguration("older", true);
    configApi.getConfig.mockResolvedValueOnce(configuration("newer", { own: true, metadata: { eventKind: "wedding" } }));
    await store().loadConfiguration("newer", true);
    overtaken.resolve(configuration("older", { own: true, metadata: { eventKind: "corporate" } }));
    await stale;
    expect(store().configId).toBe("newer");
    expect(question()).toMatchObject({ configId: "newer", answer: "wedding" });
    expect(usePlannerEventStore.getState().eventKind).toBe("wedding");
  });

  it("opens a layout as new only when nothing stands on its floor", async () => {
    configApi.getConfig.mockResolvedValueOnce(configuration("furnished", { own: true, furnished: true }));
    await store().loadConfiguration("furnished", true);
    expect(question()).toMatchObject({ configId: "furnished", known: true, answer: undefined, askable: false });
    configApi.getConfig.mockResolvedValueOnce(configuration("empty", { own: true }));
    await store().loadConfiguration("empty", true);
    expect(question()).toMatchObject({ configId: "empty", known: true, answer: undefined, askable: true });
  });

  it("opens a new guest draft as new, unanswered and kept on this device", async () => {
    configApi.createPublicConfig.mockResolvedValueOnce(configuration("draft"));
    await store().createPublicConfig("room");
    expect(question()).toMatchObject({ configId: "draft", guest: true, known: true, answer: undefined, askable: true });
  });
});

describe("a guest's new plan as it becomes the person's", () => {
  async function createAndSignIn(): Promise<void> {
    configApi.createPublicConfig.mockResolvedValueOnce(configuration("new-plan"));
    await store().createPublicConfig("room");
    useEditorStore.setState({ saveToServer: vi.fn(() => Promise.resolve(true)) });
    useAuthStore.setState({ isAuthenticated: true, user: PLANNER });
    claimApi.claimTrackedDraft.mockResolvedValueOnce("claimed");
  }

  it("writes an answer given after the claim into the layout's metadata", async () => {
    await createAndSignIn();
    await claimOpenDraft("new-plan", PLANNER.id);
    expect(store().isPublicPreview).toBe(false);
    answerEventKind("wedding");
    await vi.waitFor(() => { expect(configApi.patchConfigMetadata).toHaveBeenCalledWith("new-plan", { eventKind: "wedding" }); });
    await vi.waitFor(() => { expect(question()).toMatchObject({ guest: false, answer: "wedding", save: "kept" }); });
  });

  it("writes an answer given while the claim was on its way, the moment it lands", async () => {
    await createAndSignIn();
    answerEventKind("corporate");
    expect(configApi.patchConfigMetadata).not.toHaveBeenCalled();
    await claimOpenDraft("new-plan", PLANNER.id);
    await vi.waitFor(() => { expect(configApi.patchConfigMetadata).toHaveBeenCalledWith("new-plan", { eventKind: "corporate" }); });
  });

  it("writes nothing when the claim is refused: the plan stays a guest's draft, its answer on this device", async () => {
    await createAndSignIn();
    claimApi.claimTrackedDraft.mockReset();
    claimApi.claimTrackedDraft.mockResolvedValueOnce("not-created-here");
    answerEventKind("other");
    await claimOpenDraft("new-plan", PLANNER.id);
    expect(store().isPublicPreview).toBe(true);
    expect(question().guest).toBe(true);
    expect(configApi.patchConfigMetadata).not.toHaveBeenCalled();
  });
});
