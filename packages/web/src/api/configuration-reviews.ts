import { z } from "zod";
import {
  CONFIGURATION_REVIEW_STATUSES,
  ConfigurationSheetSnapshotSchema,
  type ConfigurationReviewStatus,
  type ConfigurationSheetSnapshot,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Configuration review API client
//
// Wraps the 11 review/snapshot endpoints defined in
// packages/api/src/routes/configuration-reviews.ts. Every response body is
// validated through a Zod schema before reaching component code, matching
// the api/configurations.ts pattern.
//
// The snapshot `payload` field is intentionally passed through as
// `z.unknown()` rather than the full HallkeeperSheetV2 schema. Why: the
// transport boundary collides with TypeScript's generic-inference limit
// (see feedback_zod_passthrough_generic.md) when a nested schema carries
// `.passthrough()` + `.default()`. The consumer (HallkeeperPage / any
// component that actually renders the sheet) re-parses the payload with
// the canonical schema at read time. Responses from this client are
// authoritative about the snapshot metadata (id, version, timestamps,
// approval); the payload is a typed blob that the renderer owns.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared response schemas
// ---------------------------------------------------------------------------

/**
 * Client-side snapshot envelope: preserves every field we care about on
 * the metadata side but holds the payload as `unknown`. Callers that
 * need the rendered sheet validate `payload` separately via the
 * canonical `ConfigurationSheetSnapshotSchema`.
 */
const SnapshotEnvelopeSchema = z.object({
  id: z.string().uuid(),
  configurationId: z.string().uuid(),
  version: z.number().int().positive(),
  payload: z.unknown(),
  diagramUrl: z.string().url().nullable(),
  pdfUrl: z.string().url().nullable(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().uuid().nullable(),
});

export type SnapshotEnvelope = z.infer<typeof SnapshotEnvelopeSchema>;

/** Fully-typed snapshot — use when you actually need to render the sheet. */
export function parseSnapshot(envelope: SnapshotEnvelope): ConfigurationSheetSnapshot {
  return ConfigurationSheetSnapshotSchema.parse(envelope);
}

/**
 * Safely narrow an envelope to a full ConfigurationSheetSnapshot. Returns
 * null if the payload doesn't match HallkeeperSheetV2Schema — renderers
 * should handle null by showing a "sheet payload is invalid" error state
 * rather than rendering partial data. Prefer this over `parseSnapshot`
 * when the component needs to survive a contract-drift production bug.
 */
export function safeParseSnapshot(
  envelope: SnapshotEnvelope,
): ConfigurationSheetSnapshot | null {
  const parsed = ConfigurationSheetSnapshotSchema.safeParse(envelope);
  return parsed.success ? parsed.data : null;
}

const ReviewStatusSchema = z.enum(CONFIGURATION_REVIEW_STATUSES);

const ApiEnvelope = <T extends z.ZodTypeAny>(dataSchema: T): z.ZodObject<{ data: T }> =>
  z.object({ data: dataSchema });

// ---------------------------------------------------------------------------
// Transition response shapes (mirrored from the route-side returns)
// ---------------------------------------------------------------------------

const SubmitResponseSchema = ApiEnvelope(z.object({
  created: z.boolean(),
  snapshot: SnapshotEnvelopeSchema,
  reviewStatus: ReviewStatusSchema,
}));

const ApproveResponseSchema = ApiEnvelope(z.object({
  reviewStatus: z.literal("approved"),
  snapshot: SnapshotEnvelopeSchema,
}));

const GenericStatusResponseSchema = ApiEnvelope(z.object({
  reviewStatus: ReviewStatusSchema,
}));

const ReviewHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  configurationId: z.string().uuid(),
  fromStatus: ReviewStatusSchema,
  toStatus: ReviewStatusSchema,
  // Display name of the acting user. Never the raw UUID — see the
  // matching schema in @omnitwin/types/configuration-review for why.
  changedByName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ReviewHistoryEntry = z.infer<typeof ReviewHistoryEntrySchema>;

const ReviewHistoryResponseSchema = ApiEnvelope(z.object({
  configurationId: z.string().uuid(),
  entries: z.array(ReviewHistoryEntrySchema),
}));

const AvailableTransitionsResponseSchema = ApiEnvelope(z.object({
  configurationId: z.string().uuid(),
  currentStatus: ReviewStatusSchema,
  availableTransitions: z.array(ReviewStatusSchema),
}));

const SnapshotResponseSchema = ApiEnvelope(SnapshotEnvelopeSchema);

// ---------------------------------------------------------------------------
// Review presence — polling-based "who is viewing" tracking
// ---------------------------------------------------------------------------

const ActiveReviewerSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  lastSeenAt: z.string().datetime(),
});

export type ActiveReviewer = z.infer<typeof ActiveReviewerSchema>;

const ReviewViewersResponseSchema = ApiEnvelope(z.object({
  configurationId: z.string().uuid(),
  viewers: z.array(ActiveReviewerSchema),
}));

const HeartbeatResponseSchema = ApiEnvelope(z.object({
  ok: z.literal(true),
}));

// ---------------------------------------------------------------------------
// Transition endpoints
// ---------------------------------------------------------------------------

/**
 * Submit a configuration for review. Idempotent: if the layout is
 * identical to the latest snapshot, `created` returns false and the
 * existing snapshot is echoed back without a state transition.
 */
export async function submitForReview(
  configId: string,
  note?: string,
): Promise<{
  created: boolean;
  snapshot: SnapshotEnvelope;
  reviewStatus: ConfigurationReviewStatus;
}> {
  const body = note !== undefined && note.trim().length > 0 ? { note: note.trim() } : {};
  const res = await api.post(
    `/configurations/${configId}/review/submit`,
    body,
    undefined,
    SubmitResponseSchema,
  );
  return res.data;
}

export async function startReview(configId: string): Promise<ConfigurationReviewStatus> {
  const res = await api.post(
    `/configurations/${configId}/review/start-review`,
    {},
    undefined,
    GenericStatusResponseSchema,
  );
  return res.data.reviewStatus;
}

export async function approveLayout(
  configId: string,
  note?: string,
): Promise<{ reviewStatus: "approved"; snapshot: SnapshotEnvelope }> {
  const body = note !== undefined && note.trim().length > 0 ? { note: note.trim() } : {};
  const res = await api.post(
    `/configurations/${configId}/review/approve`,
    body,
    undefined,
    ApproveResponseSchema,
  );
  return res.data;
}

export async function rejectLayout(
  configId: string,
  note: string,
): Promise<ConfigurationReviewStatus> {
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    throw new Error("A rejection note is required");
  }
  const res = await api.post(
    `/configurations/${configId}/review/reject`,
    { note: trimmed },
    undefined,
    GenericStatusResponseSchema,
  );
  return res.data.reviewStatus;
}

export async function requestChanges(
  configId: string,
  note: string,
): Promise<ConfigurationReviewStatus> {
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    throw new Error("A changes-requested note is required");
  }
  const res = await api.post(
    `/configurations/${configId}/review/request-changes`,
    { note: trimmed },
    undefined,
    GenericStatusResponseSchema,
  );
  return res.data.reviewStatus;
}

export async function withdrawReview(
  configId: string,
  note?: string,
): Promise<ConfigurationReviewStatus> {
  const body = note !== undefined && note.trim().length > 0 ? { note: note.trim() } : {};
  const res = await api.post(
    `/configurations/${configId}/review/withdraw`,
    body,
    undefined,
    GenericStatusResponseSchema,
  );
  return res.data.reviewStatus;
}

export async function archiveReview(configId: string): Promise<ConfigurationReviewStatus> {
  const res = await api.post(
    `/configurations/${configId}/review/archive`,
    {},
    undefined,
    GenericStatusResponseSchema,
  );
  return res.data.reviewStatus;
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

export async function getReviewHistory(
  configId: string,
): Promise<readonly ReviewHistoryEntry[]> {
  const res = await api.get(
    `/configurations/${configId}/review/history`,
    ReviewHistoryResponseSchema,
  );
  return res.data.entries;
}

export async function getAvailableTransitions(
  configId: string,
): Promise<{
  currentStatus: ConfigurationReviewStatus;
  availableTransitions: readonly ConfigurationReviewStatus[];
}> {
  const res = await api.get(
    `/configurations/${configId}/review/available-transitions`,
    AvailableTransitionsResponseSchema,
  );
  return {
    currentStatus: res.data.currentStatus,
    availableTransitions: res.data.availableTransitions,
  };
}

export async function getLatestSnapshot(configId: string): Promise<SnapshotEnvelope> {
  const res = await api.get(
    `/configurations/${configId}/snapshot/latest`,
    SnapshotResponseSchema,
  );
  return res.data;
}

export async function getSnapshotByVersion(
  configId: string,
  version: number,
): Promise<SnapshotEnvelope> {
  const res = await api.get(
    `/configurations/${configId}/snapshot/${String(version)}`,
    SnapshotResponseSchema,
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// Review presence — heartbeat + viewers list
// ---------------------------------------------------------------------------

/**
 * Record a heartbeat for the currently-viewed review. Call every
 * ~10s from `useReviewViewers`. The server upserts; there's no need
 * to coordinate with a prior "join" event.
 */
export async function heartbeatReviewViewers(configId: string): Promise<void> {
  await api.post(
    `/configurations/${configId}/review/viewers/heartbeat`,
    {},
    false,
    HeartbeatResponseSchema,
  );
}

/**
 * Fetch the list of staff currently viewing this review. Excludes
 * the caller themselves — the UI shows OTHER viewers.
 */
export async function listReviewViewers(configId: string): Promise<readonly ActiveReviewer[]> {
  const res = await api.get(
    `/configurations/${configId}/review/viewers`,
    ReviewViewersResponseSchema,
  );
  return res.data.viewers;
}

/**
 * Explicitly end this caller's review session. Called on unmount —
 * gives a snappier departure signal than waiting for the heartbeat
 * window to elapse.
 */
export async function endReviewViewerSession(configId: string): Promise<void> {
  await api.delete(
    `/configurations/${configId}/review/viewers/self`,
  );
}

// ---------------------------------------------------------------------------
// Pending-reviews list — staff/admin only
//
// Calls GET /configurations/reviews/pending. The API scopes results by
// role: admin sees all venues; staff sees their own venue; other roles
// receive 403 and the call throws. The UI should therefore only invoke
// this for a role that will succeed (the ReviewsView gates on role
// before mounting).
// ---------------------------------------------------------------------------

export interface PendingReviewEntry {
  readonly id: string;
  readonly name: string;
  readonly venueId: string;
  readonly spaceId: string;
  readonly userId: string | null;
  readonly reviewStatus: ConfigurationReviewStatus;
  readonly submittedAt: string | null;
  readonly updatedAt: string;
  readonly guestCount: number;
}

const PendingReviewEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  reviewStatus: ReviewStatusSchema,
  submittedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  guestCount: z.number().int().nonnegative(),
});

const PendingReviewsResponseSchema = ApiEnvelope(z.object({
  entries: z.array(PendingReviewEntrySchema),
}));

export async function listPendingReviews(): Promise<readonly PendingReviewEntry[]> {
  const res = await api.get(
    `/configurations/reviews/pending`,
    PendingReviewsResponseSchema,
  );
  return res.data.entries;
}
