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
//
// A second rule meets this one in the store (the guest plan notes work,
// editor-store-guest-notes.test.ts): a guest plan read without its notes stays
// on the public routes whoever saves it, since the signed-in save stores each
// piece as sent. Either rule alone can send a save the public way, so a case
// that leaves the read unsaid proves neither. Every case here says how the
// plan was read, and each rule is shown where the other does not decide: who
// the person is, on a plan read with its notes; how it was read, for the staff
// the signed-in routes do answer.
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

/**
 * How the open plan was read. With its notes: the signed-in read, or the
 * public read in the browser that made the plan. Without them: any other
 * public read, and every read of the API live before the notes work.
 */
type Read = "with its notes" | "without its notes";
const EITHER_READ: readonly Read[] = ["with its notes", "without its notes"];

function person(role: string, venueId: string | null, platformRole: AuthUser["platformRole"] = "none"): AuthUser {
  return { id: `user-${role}`, email: `${role}@example.test`, role, platformRole, venueId, name: role };
}

function preview(extra: Partial<configApi.Configuration> = {}): configApi.Configuration {
  return { id: CONFIG, spaceId: SPACE, venueId: VENUE, userId: null, name: "Guest plan", isPublicPreview: true, revision: 1, objects: [], ...extra };
}

function store() {
  return useEditorStore.getState();
}

/** The open document, read as `read` says. */
function openPreview(read: Read, isPublicPreview = true): void {
  useEditorStore.setState({
    configId: CONFIG, spaceId: SPACE, venueId: VENUE, configRevision: 1, isPublicPreview, notesIncluded: read === "with its notes",
    objects: [], baseObjects: [], isDirty: true, isSaving: false, saveError: null, saveConflict: null,
  });
}

/**
 * What the public save is sent at `revision`: the three arguments a guest's
 * save always had, and for a plan read with its notes the word that they are
 * complete (api/configurations.ts BatchSaveOptions).
 */
function publicSave(read: Read, revision: number): readonly unknown[] {
  return read === "with its notes" ? [CONFIG, [], revision, { notesIncluded: true }] : [CONFIG, [], revision];
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

// Who the person is decides here, however the plan was read: the signed-in
// routes do not answer them. Read with its notes, nothing but that sends the
// save the public way.
describe.each(EITHER_READ)("saving a public preview read %s, signed in as someone the signed-in routes do not answer", (read) => {
  it.each(["client", "planner", "sales", "caterer"])("saves a signed-in %s's preview through the public route a guest uses", async (role) => {
    useAuthStore.getState().setUser(person(role, role === "sales" ? VENUE : null));
    openPreview(read);

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.publicBatchSave).toHaveBeenCalledWith(...publicSave(read, 1));
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ isDirty: false, saveError: null, configRevision: 2 });
  });

  it("saves another venue's member of staff as it would any visitor", async () => {
    useAuthStore.getState().setUser(person("staff", OTHER_VENUE));
    openPreview(read);

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.publicBatchSave).toHaveBeenCalledWith(...publicSave(read, 1));
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("reads the newer version for Keep mine through the same public route", async () => {
    useAuthStore.getState().setUser(person("client", null));
    openPreview(read);
    const conflict = new ApiError(409, "Layout changed on the server. Reload before saving again.", "REVISION_CONFLICT", {
      expectedRevision: 1, currentRevision: 2, changedBy: null, changedAt: "2026-11-11T10:00:00.000Z",
    });
    vi.mocked(configApi.publicBatchSave).mockRejectedValueOnce(conflict);
    // The save's own read of the newer version does not arrive, so Keep mine reads it.
    vi.mocked(configApi.getPublicConfig).mockRejectedValueOnce(new Error("offline"));
    expect(await store().saveToServer(true)).toBe(false);
    expect(store().saveConflict?.currentRevision).toBe(2);

    vi.mocked(configApi.getPublicConfig).mockResolvedValueOnce(preview({ revision: 2, notesIncluded: read === "with its notes" }));
    vi.mocked(configApi.publicBatchSave).mockResolvedValueOnce({ revision: 3, objects: [] });
    expect(await store().keepMine(true)).toBe(true);

    expect(configApi.getConfig).not.toHaveBeenCalled();
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(configApi.publicBatchSave).toHaveBeenLastCalledWith(...publicSave(read, 2));
  });
});

// The signed-in routes do answer these people. Their save goes that way for a
// plan read with its notes, as the signed-in read returns it; and the public
// way for one read without them, which only how it was read can explain.
describe("saving a public preview, signed in as someone the signed-in routes answer", () => {
  it.each(["admin", "manager", "staff", "hallkeeper"])("keeps the signed-in route for the venue's own %s, for a plan read with its notes", async (role) => {
    useAuthStore.getState().setUser(person(role, VENUE));
    openPreview("with its notes");

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.authBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });

  it("keeps the signed-in route for a platform admin, for a plan read with its notes", async () => {
    useAuthStore.getState().setUser(person("client", null, "admin"));
    openPreview("with its notes");

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.authBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });

  it.each(["admin", "manager", "staff", "hallkeeper"])("saves the venue's own %s through the public route for a plan read without its notes", async (role) => {
    useAuthStore.getState().setUser(person(role, VENUE));
    openPreview("without its notes");

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.publicBatchSave).toHaveBeenCalledWith(...publicSave("without its notes", 1));
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("saves a platform admin through the public route for a plan read without its notes", async () => {
    useAuthStore.getState().setUser(person("client", null, "admin"));
    openPreview("without its notes");

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.publicBatchSave).toHaveBeenCalledWith(...publicSave("without its notes", 1));
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });
});

describe("saving a layout the person owns", () => {
  // Not a guest plan: neither rule above applies to it, whatever its read said.
  it.each(EITHER_READ)("still goes through the signed-in route, read %s", async (read) => {
    useAuthStore.getState().setUser(person("client", null));
    openPreview(read, false);

    expect(await store().saveToServer(true)).toBe(true);

    expect(configApi.authBatchSave).toHaveBeenCalledWith(CONFIG, [], 1);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });
});

describe("opening a public preview while signed in", () => {
  // The public read's own word on the notes: true in the browser that made the plan, false in any other, absent from the API live before the notes work.
  it.each<{ readonly says: string; readonly notesIncluded: boolean | undefined; readonly held: boolean }>([
    { says: "with its notes", notesIncluded: true, held: true },
    { says: "without its notes", notesIncluded: false, held: false },
    { says: "by an API that does not say", notesIncluded: undefined, held: false },
  ])("opens the preview the signed-in read refuses, as a guest would, read $says", async ({ notesIncluded, held }) => {
    useAuthStore.getState().setUser(person("client", null));
    vi.mocked(configApi.getConfig).mockRejectedValue(REFUSED);
    vi.mocked(configApi.getPublicConfig).mockResolvedValue(preview(notesIncluded === undefined ? {} : { notesIncluded }));

    await store().loadConfiguration(CONFIG, true);

    expect(configApi.getConfig).toHaveBeenCalledWith(CONFIG);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith(CONFIG);
    expect(store()).toMatchObject({ configId: CONFIG, isPublicPreview: true, error: null, isLoading: false, notesIncluded: held });
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

  it("still opens a layout the signed-in read answers without a second read, with its notes", async () => {
    useAuthStore.getState().setUser(person("client", null));
    // The signed-in read returns every note, and says so (api/configurations.ts getConfig).
    vi.mocked(configApi.getConfig).mockResolvedValue(preview({ isPublicPreview: false, userId: "user-client", notesIncluded: true }));

    await store().loadConfiguration(CONFIG, true);

    expect(configApi.getPublicConfig).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ configId: CONFIG, isPublicPreview: false, error: null, notesIncluded: true });
  });
});
