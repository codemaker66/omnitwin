import { beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../api/configurations.js";
import { ApiError } from "../../api/client.js";
import { useAuthStore, type AuthUser } from "../auth-store.js";
import { useEditorStore } from "../editor-store.js";

// ---------------------------------------------------------------------------
// A public preview and a signed-in person (audit editor-save-1).
//
// A public preview names no owner, so the signed-in routes answer only the
// floor at its venue and a platform admin (the API's canAccessResource;
// claim-new-draft-postgres.test.ts holds that refusal). Signing in must never
// leave a client, planner, sales person or caterer with less than a guest
// has: they read and save the preview through the public routes, exactly as
// the guest who made it does. The real store runs; only the network is
// replaced.
// ---------------------------------------------------------------------------

vi.mock("../../api/configurations.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/configurations.js")>();
  return {
    ...actual,
    getConfig: vi.fn(),
    getPublicConfig: vi.fn(),
    createPublicConfig: vi.fn(),
    authBatchSave: vi.fn(),
    publicBatchSave: vi.fn(),
  };
});

vi.mock("../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));

vi.mock("../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));

const CONFIG = "00000000-0000-4000-8000-00000000c0f1";
const SPACE = "00000000-0000-4000-8000-000000000051";
const VENUE = "00000000-0000-4000-8000-0000000000a1";
const OTHER_VENUE = "00000000-0000-4000-8000-0000000000b2";

function person(role: string, venueId: string | null, platformRole: AuthUser["platformRole"] = "none"): AuthUser {
  return { id: `user-${role}`, email: `${role}@example.test`, role, platformRole, venueId, name: role };
}

function preview(extra: Partial<configApi.Configuration> = {}): configApi.Configuration {
  return { id: CONFIG, spaceId: SPACE, venueId: VENUE, userId: null, name: "Guest plan", isPublicPreview: true, revision: 1, objects: [], ...extra };
}

function store() {
  return useEditorStore.getState();
}

/**
 * The open document. `notesIncluded` is how it was read: the signed-in read
 * returns a guest plan's notes, the public read does not, and a guest plan
 * read without them stays on the public routes whoever saves it
 * (editor-store-guest-notes.test.ts).
 */
function openPreview(isPublicPreview = true, notesIncluded = false): void {
  useEditorStore.setState({
    configId: CONFIG, spaceId: SPACE, venueId: VENUE, configRevision: 1, isPublicPreview, notesIncluded,
    objects: [], baseObjects: [], isDirty: true, isSaving: false, saveError: null, saveConflict: null,
  });
}

const REFUSED = new ApiError(403, "Insufficient permissions", "FORBIDDEN");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
  useAuthStore.getState().setUser(null);
  vi.mocked(configApi.publicBatchSave).mockResolvedValue({ revision: 2, objects: [] });
  vi.mocked(configApi.authBatchSave).mockResolvedValue({ revision: 2, objects: [] });
});

describe("saving a public preview while signed in", () => {
  it.each(["client", "planner", "sales", "caterer"])("saves a signed-in %s's preview through the public route a guest uses", async (role) => {
    useAuthStore.getState().setUser(person(role, role === "sales" ? VENUE : null));
    openPreview();

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.publicBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ isDirty: false, saveError: null, configRevision: 2 });
  });

  it.each(["admin", "manager", "staff", "hallkeeper"])("keeps the signed-in route for the venue's own %s", async (role) => {
    useAuthStore.getState().setUser(person(role, VENUE));
    // Read through the signed-in route, which answers them, so with its notes.
    openPreview(true, true);

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.authBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });

  it("keeps the signed-in route for a platform admin", async () => {
    useAuthStore.getState().setUser(person("client", null, "admin"));
    openPreview(true, true);

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.authBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
  });

  it("saves another venue's member of staff as it would any visitor", async () => {
    useAuthStore.getState().setUser(person("staff", OTHER_VENUE));
    openPreview();

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.publicBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("still saves a layout the person owns through the signed-in route", async () => {
    useAuthStore.getState().setUser(person("client", null));
    openPreview(false);

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.authBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });

  it("reads the newer version for Keep mine through the same public route", async () => {
    useAuthStore.getState().setUser(person("client", null));
    openPreview();
    const conflict = new ApiError(409, "Layout changed on the server. Reload before saving again.", "REVISION_CONFLICT", {
      expectedRevision: 1, currentRevision: 2, changedBy: null, changedAt: "2026-11-11T10:00:00.000Z",
    });
    vi.mocked(configApi.publicBatchSave).mockRejectedValueOnce(conflict);
    // The save's own read of the newer version does not arrive, so Keep mine reads it.
    vi.mocked(configApi.getPublicConfig).mockRejectedValueOnce(new Error("offline"));
    expect(await store().saveToServer(true)).toBe(false);
    expect(store().saveConflict?.currentRevision).toBe(2);

    vi.mocked(configApi.getPublicConfig).mockResolvedValueOnce(preview({ revision: 2 }));
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({ revision: 3, objects: [] });
    expect(await store().keepMine(true)).toBe(true);

    expect(configApi.getConfig).not.toHaveBeenCalled();
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(configApi.publicBatchSave).toHaveBeenLastCalledWith(CONFIG, [], 2);
  });
});

describe("opening a public preview while signed in", () => {
  it("opens the preview the signed-in read refuses, as a guest would", async () => {
    useAuthStore.getState().setUser(person("client", null));
    vi.mocked(configApi.getConfig).mockRejectedValue(REFUSED);
    vi.mocked(configApi.getPublicConfig).mockResolvedValue(preview());

    await store().loadConfiguration(CONFIG, true);

    expect(configApi.getConfig).toHaveBeenCalledWith(CONFIG);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith(CONFIG);
    expect(store()).toMatchObject({ configId: CONFIG, isPublicPreview: true, error: null, isLoading: false });
  });

  it("gives the refusal when the layout is not a public preview either", async () => {
    useAuthStore.getState().setUser(person("client", null));
    vi.mocked(configApi.getConfig).mockRejectedValue(REFUSED);
    vi.mocked(configApi.getPublicConfig).mockRejectedValue(new ApiError(404, "Public preview configuration not found", "NOT_FOUND"));

    await store().loadConfiguration(CONFIG, true);

    expect(store()).toMatchObject({ configId: null, error: "Insufficient permissions", isLoading: false });
  });

  it("does not try the public route when the signed-in read fails for another reason", async () => {
    useAuthStore.getState().setUser(person("client", null));
    vi.mocked(configApi.getConfig).mockRejectedValue(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));

    await store().loadConfiguration(CONFIG, true);

    expect(configApi.getPublicConfig).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ configId: null, error: "Network error — check your connection" });
  });

  it("still opens a layout the signed-in read answers without a second read", async () => {
    useAuthStore.getState().setUser(person("client", null));
    vi.mocked(configApi.getConfig).mockResolvedValue(preview({ isPublicPreview: false, userId: "user-client" }));

    await store().loadConfiguration(CONFIG, true);

    expect(configApi.getPublicConfig).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ configId: CONFIG, isPublicPreview: false, error: null });
  });
});
