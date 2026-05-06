import { z } from "zod";
import type { EditorObject } from "../stores/editor-store.js";

const DRAFT_VERSION = 1;
const STORAGE_PREFIX = "venviewer:anonymous-planner-draft:";
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const EditorObjectDraftSchema = z.object({
  id: z.string().min(1),
  assetDefinitionId: z.string().min(1),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  positionZ: z.number().finite(),
  rotationX: z.number().finite(),
  rotationY: z.number().finite(),
  rotationZ: z.number().finite(),
  scale: z.number().finite(),
  sortOrder: z.number().int(),
  clothed: z.boolean(),
  groupId: z.string().nullable(),
  label: z.string().max(80).optional(),
  notes: z.string(),
});

const AnonymousPlannerDraftSchema = z.object({
  version: z.literal(DRAFT_VERSION),
  configId: z.string().min(1),
  spaceId: z.string().min(1),
  venueId: z.string().min(1),
  updatedAtMs: z.number().int().nonnegative(),
  hasUnsavedLocalChanges: z.boolean(),
  objects: z.array(EditorObjectDraftSchema).max(1_000),
});

export type AnonymousPlannerDraft = z.infer<typeof AnonymousPlannerDraftSchema>;

export interface PersistAnonymousPlannerDraftInput {
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly venueId: string | null;
  readonly isPublicPreview: boolean;
  readonly objects: readonly EditorObject[];
  readonly isDirty: boolean;
}

export function anonymousPlannerDraftKey(configId: string): string {
  return `${STORAGE_PREFIX}${configId}`;
}

function storageAvailable(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function removeDraft(configId: string): void {
  const storage = storageAvailable();
  if (storage === null) return;
  try {
    storage.removeItem(anonymousPlannerDraftKey(configId));
  } catch {
    // Best effort only. Draft persistence must never block planning.
  }
}

export function persistAnonymousPlannerDraft(
  input: PersistAnonymousPlannerDraftInput,
): void {
  if (input.configId === null) return;

  if (!input.isPublicPreview || !input.isDirty) {
    removeDraft(input.configId);
    return;
  }

  if (input.spaceId === null || input.venueId === null) return;

  const storage = storageAvailable();
  if (storage === null) return;

  const draft: AnonymousPlannerDraft = {
    version: DRAFT_VERSION,
    configId: input.configId,
    spaceId: input.spaceId,
    venueId: input.venueId,
    updatedAtMs: Date.now(),
    hasUnsavedLocalChanges: true,
    objects: [...input.objects],
  };

  try {
    storage.setItem(anonymousPlannerDraftKey(input.configId), JSON.stringify(draft));
  } catch {
    // Quota/private-mode failures should leave the live editor untouched.
  }
}

export function readAnonymousPlannerDraft(
  configId: string,
  expected: {
    readonly spaceId: string;
    readonly venueId: string;
  },
): AnonymousPlannerDraft | null {
  const storage = storageAvailable();
  if (storage === null) return null;

  const key = anonymousPlannerDraftKey(configId);
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
    removeDraft(configId);
    return null;
  }

  const result = AnonymousPlannerDraftSchema.safeParse(parsed);
  if (!result.success) {
    removeDraft(configId);
    return null;
  }

  const draft = result.data;
  const expired = Date.now() - draft.updatedAtMs > MAX_DRAFT_AGE_MS;
  const mismatched =
    draft.configId !== configId
    || draft.spaceId !== expected.spaceId
    || draft.venueId !== expected.venueId;

  if (expired || mismatched) {
    removeDraft(configId);
    return null;
  }

  return draft.hasUnsavedLocalChanges ? draft : null;
}
