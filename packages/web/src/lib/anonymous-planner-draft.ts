import { z } from "zod";
import type { EditorObject } from "../stores/editor-store.js";
import { changedBetween } from "./layout-live/live-document.js";
import {
  MAX_PLANNER_DRAFT_AGE_MS,
  anonymousPlannerDraftKey,
  signedInPlannerDraftKey,
} from "./planner-draft-storage.js";

export { anonymousPlannerDraftKey, signedInPlannerDraftKey };

// ---------------------------------------------------------------------------
// Unsaved planner work kept on this device (localStorage), so it survives a
// closed tab, a reload or a dropped network until the server has it.
//
// Guests' drafts began here (hence the name); signed-in layouts use the same
// store under a key of their own, `venviewer:planner-draft:<userId>:<configId>`,
// so one person's unsaved work is never offered to another person on a shared
// machine. A draft records the server revision it was edited from and, as a
// delta, the server objects it changed, so a draft the server has since moved
// past can be restored as unsaved work that meets the conflict honestly
// rather than overwriting the newer copy or being thrown away.
//
// Tabs share the key. Each draft names the page that wrote it
// (planner-page-lock.ts), so a page with nothing unsaved never removes another
// page's work, and a second tab can tell another open tab's in-progress work
// from work a closed tab left behind. Expiry and sign-out housekeeping live in
// planner-draft-storage.ts.
// ---------------------------------------------------------------------------

const DRAFT_VERSION = 1;
const MAX_DRAFT_OBJECTS = 1_000;

const EditorObjectDraftSchema = z.object({
  id: z.string().min(1),
  assetDefinitionId: z.string().min(1),
  positionX: z.number(),
  positionY: z.number(),
  positionZ: z.number(),
  rotationX: z.number(),
  rotationY: z.number(),
  rotationZ: z.number(),
  // Matches the API's positive uniform-scale contract. Corrupt/legacy drafts
  // are discarded rather than restoring a scene the renderer must reinterpret.
  scale: z.number().positive(),
  sortOrder: z.number().int(),
  clothed: z.boolean(),
  clothStyle: z.enum(["black", "white"]).nullable().default(null),
  tableSetting: z.enum(["dinner"]).nullable().default(null),
  // DRESSING (C2) fields default so pre-C2 drafts still restore.
  chairStyle: z.string().max(40).nullable().default(null),
  centerpiece: z.string().max(80).nullable().default(null),
  groupId: z.string().nullable(),
  label: z.string().max(80).optional(),
  notes: z.string(),
});

/** The server document a draft was edited from, as what the draft changed. */
const DraftBaseSchema = z.object({
  /** The server's copy of every object the draft changed or removed. */
  changed: z.array(EditorObjectDraftSchema).max(MAX_DRAFT_OBJECTS),
  /** Objects the draft placed that the server did not have. */
  addedIds: z.array(z.string().min(1)).max(MAX_DRAFT_OBJECTS),
});

const AnonymousPlannerDraftSchema = z.object({
  version: z.literal(DRAFT_VERSION),
  configId: z.string().min(1),
  spaceId: z.string().min(1),
  venueId: z.string().min(1),
  baseRevision: z.number().int().min(1),
  updatedAtMs: z.number().int().nonnegative(),
  hasUnsavedLocalChanges: z.boolean(),
  /** The signed-in person whose work this is; null or absent for a guest. */
  ownerUserId: z.string().min(1).nullable().optional(),
  /** The page that wrote it (planner-page-lock.ts); absent on older drafts. */
  writerPageId: z.string().min(1).max(100).optional(),
  /** Absent on drafts written before drafts carried their base. */
  base: DraftBaseSchema.optional(),
  objects: z.array(EditorObjectDraftSchema).max(MAX_DRAFT_OBJECTS),
});

export type AnonymousPlannerDraft = z.infer<typeof AnonymousPlannerDraftSchema>;

export interface PersistAnonymousPlannerDraftInput {
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly venueId: string | null;
  readonly configRevision: number | null;
  readonly isPublicPreview: boolean;
  readonly objects: readonly EditorObject[];
  readonly isDirty: boolean;
  /** The last document the server confirmed (the editor's baseObjects). */
  readonly baseObjects?: readonly EditorObject[];
  /** The signed-in person editing; null or absent for a guest. */
  readonly ownerUserId?: string | null;
  /** The page keeping it. With it, a page with nothing to keep never removes
   *  a draft another page wrote; without it, any draft under the key goes. */
  readonly writerPageId?: string;
}

export interface ReadPlannerDraftExpectation {
  readonly spaceId: string;
  readonly venueId: string;
  /** The server's current revision. */
  readonly baseRevision: number;
  /** Whose draft to read; null or absent reads the guest draft. */
  readonly ownerUserId?: string | null;
}

function draftKey(configId: string, ownerUserId: string | null): string {
  return ownerUserId === null ? anonymousPlannerDraftKey(configId) : signedInPlannerDraftKey(ownerUserId, configId);
}

/** The key this layout's unsaved work is kept under, for this person or a guest. */
export function plannerDraftKeyFor(configId: string, ownerUserId: string | null): string {
  return draftKey(configId, ownerUserId);
}

function storageAvailable(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Some browsers throw on access when site data is blocked.
    return null;
  }
}

function removeKey(key: string): void {
  const storage = storageAvailable();
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // Best effort only. Draft persistence must never block planning.
  }
}

/** The page that wrote the draft under this key; undefined when none says. */
function storedWriter(storage: Storage, key: string): string | undefined {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const writer: unknown = Reflect.get(parsed, "writerPageId");
    return typeof writer === "string" ? writer : undefined;
  } catch {
    return undefined;
  }
}

/** Remove this page's own copy; another page's in-progress work is left alone. */
function removeUnlessAnotherPages(key: string, writerPageId: string | undefined): void {
  if (writerPageId !== undefined) {
    const storage = storageAvailable();
    if (storage === null) return;
    const writer = storedWriter(storage, key);
    if (writer !== undefined && writer !== writerPageId) return;
  }
  removeKey(key);
}

/** Forget every copy of this layout's unsaved work on this device: the
 *  person's own and any guest copy (they chose the server's version). */
export function discardPlannerDraft(configId: string, ownerUserId: string | null): void {
  if (ownerUserId !== null) removeKey(signedInPlannerDraftKey(ownerUserId, configId));
  removeKey(anonymousPlannerDraftKey(configId));
}

/** Forget the one copy this draft was read from (the server already holds it). */
export function forgetPlannerDraft(draft: AnonymousPlannerDraft): void {
  removeKey(draftKey(draft.configId, draft.ownerUserId ?? null));
}

function baseDelta(
  base: readonly EditorObject[],
  objects: readonly EditorObject[],
): AnonymousPlannerDraft["base"] {
  const differing = changedBetween(base, objects);
  const baseIds = new Set(base.map((object) => object.id));
  const changed = base.filter((object) => differing.has(object.id));
  const addedIds = objects.filter((object) => !baseIds.has(object.id)).map((object) => object.id);
  if (changed.length > MAX_DRAFT_OBJECTS || addedIds.length > MAX_DRAFT_OBJECTS) return undefined;
  return { changed, addedIds };
}

/**
 * Keep (or forget) this layout's unsaved work on this device. Returns true
 * only when the current work is now stored here; false when there is nothing
 * unsaved, nobody it could belong to, or the browser refused the write.
 */
export function persistAnonymousPlannerDraft(
  input: PersistAnonymousPlannerDraftInput,
): boolean {
  if (input.configId === null) return false;
  const owner = input.ownerUserId ?? null;
  const writer = input.writerPageId;
  // A guest copy is obsolete once the layout is claimed, or once a signed-in
  // person's own copy (which restored it) carries the work: left behind, it
  // would come back later as an old draft meeting a conflict of its own.
  if (!input.isPublicPreview || owner !== null) removeUnlessAnotherPages(anonymousPlannerDraftKey(input.configId), writer);
  // Private work with no signed-in owner has no key it could safely live under.
  if (owner === null && !input.isPublicPreview) return false;
  const key = draftKey(input.configId, owner);

  if (!input.isDirty || input.objects.length > MAX_DRAFT_OBJECTS) {
    // Over the cap an older copy would restore less than the person has:
    // drop it rather than offer it later as their work.
    removeUnlessAnotherPages(key, writer);
    return false;
  }

  if (input.spaceId === null || input.venueId === null || input.configRevision === null) return false;

  const storage = storageAvailable();
  if (storage === null) return false;

  const base = input.baseObjects === undefined ? undefined : baseDelta(input.baseObjects, input.objects);
  const draft: AnonymousPlannerDraft = {
    version: DRAFT_VERSION,
    configId: input.configId,
    spaceId: input.spaceId,
    venueId: input.venueId,
    baseRevision: input.configRevision,
    updatedAtMs: Date.now(),
    hasUnsavedLocalChanges: true,
    ownerUserId: owner,
    ...(writer === undefined ? {} : { writerPageId: writer }),
    ...(base === undefined ? {} : { base }),
    objects: [...input.objects],
  };

  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    // Quota/private-mode failures leave the live editor untouched, and the
    // work is honestly not kept on this device.
    return false;
  }
}

/**
 * The unsaved work kept on this device for a layout, or null. A draft at the
 * server's revision restores as it is. A draft from another revision is
 * returned only when it carries its base (plannerDraftBaseObjects), so its
 * save can meet the newer copy as a conflict; one without is discarded.
 */
export function readAnonymousPlannerDraft(
  configId: string,
  expected: ReadPlannerDraftExpectation,
): AnonymousPlannerDraft | null {
  const storage = storageAvailable();
  if (storage === null) return null;

  const owner = expected.ownerUserId ?? null;
  const key = draftKey(configId, owner);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeKey(key);
    return null;
  }

  const result = AnonymousPlannerDraftSchema.safeParse(parsed);
  if (!result.success) {
    removeKey(key);
    return null;
  }

  const draft = result.data;
  const expired = Date.now() - draft.updatedAtMs > MAX_PLANNER_DRAFT_AGE_MS;
  const mismatched =
    draft.configId !== configId
    || draft.spaceId !== expected.spaceId
    || draft.venueId !== expected.venueId
    || (draft.ownerUserId ?? null) !== owner;
  const unrestorable = draft.baseRevision !== expected.baseRevision && draft.base === undefined;

  if (expired || mismatched || unrestorable) {
    removeKey(key);
    return null;
  }

  return draft.hasUnsavedLocalChanges ? draft : null;
}

/** The server document a draft was edited from, rebuilt from its delta;
 *  null for a draft written before drafts carried their base. */
export function plannerDraftBaseObjects(draft: AnonymousPlannerDraft): readonly EditorObject[] | null {
  const base = draft.base;
  if (base === undefined) return null;
  const changedById = new Map(base.changed.map((object) => [object.id, object]));
  const added = new Set(base.addedIds);
  const rebuilt: EditorObject[] = [];
  const kept = new Set<string>();
  for (const object of draft.objects) {
    if (added.has(object.id)) continue;
    rebuilt.push(changedById.get(object.id) ?? object);
    kept.add(object.id);
  }
  // What the draft removed comes back from the stored server copies.
  for (const object of base.changed) {
    if (!kept.has(object.id)) rebuilt.push(object);
  }
  return rebuilt;
}
