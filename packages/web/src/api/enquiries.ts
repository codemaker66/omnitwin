import { z } from "zod";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Response schemas — Zod validation at the API boundary.
//
// Enquiry responses are parsed from server JSON and validated before reaching
// the dashboard. `state`/status fields stay `z.string()` (rather than a strict
// enum) so a newly-added server-side status never hard-fails the list view;
// the dashboard maps unknown states defensively.
// ---------------------------------------------------------------------------

const EnquirySchema = z.object({
  id: z.string(),
  venueId: z.string(),
  spaceId: z.string(),
  configurationId: z.string().nullable(),
  userId: z.string().nullable(),
  guestEmail: z.string().nullable(),
  guestPhone: z.string().nullable(),
  guestName: z.string().nullable(),
  state: z.string(),
  name: z.string(),
  email: z.string(),
  preferredDate: z.string().nullable(),
  eventType: z.string().nullable(),
  estimatedGuests: z.number().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Enquiry = z.infer<typeof EnquirySchema>;

const StatusHistoryEntrySchema = z.object({
  id: z.string(),
  enquiryId: z.string(),
  fromStatus: z.string(),
  toStatus: z.string(),
  changedBy: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntrySchema>;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export type EnquiryListOrder = "updated_asc" | "created_desc";

/** GET /enquiries query. A string is the single-status shorthand; anything
 *  omitted keeps the API default (all visible states, least recently
 *  updated first, 20 rows from offset 0). `venueId` narrows the caller's
 *  scope only. */
export interface EnquiryListQuery {
  readonly status?: string;
  readonly states?: readonly string[];
  readonly order?: EnquiryListOrder;
  readonly venueId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

function enquiryListPath(query: EnquiryListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", query.status);
  if (query.states !== undefined) params.set("states", query.states.join(","));
  if (query.order !== undefined) params.set("order", query.order);
  if (query.venueId !== undefined) params.set("venueId", query.venueId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const search = params.toString();
  return `/enquiries${search === "" ? "" : `?${search}`}`;
}

export async function listEnquiries(
  query?: string | EnquiryListQuery,
  signal?: AbortSignal,
): Promise<Enquiry[]> {
  const options: EnquiryListQuery = typeof query === "string" ? { status: query } : query ?? {};
  return api.get(enquiryListPath(options), z.array(EnquirySchema), signal);
}

/** One page of GET /enquiries with its paging metadata. */
export interface EnquiryPage {
  readonly rows: readonly Enquiry[];
  /** Enquiries matching the query in the caller's scope, all pages. */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** The order the server confirms it applied; null when it did not say. */
  readonly order: EnquiryListOrder | null;
}

const EnquiryPageSchema = z.object({
  data: z.array(EnquirySchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    // Echoed by an API that supports `order`. An older API ignores the
    // parameter, keeps its least-recently-updated order and omits this.
    order: z.string().optional(),
  }),
}).transform(({ data, meta }): EnquiryPage => ({
  rows: data,
  total: meta.total,
  limit: meta.limit,
  offset: meta.offset,
  order: meta.order === "created_desc" || meta.order === "updated_asc" ? meta.order : null,
}));

export async function listEnquiryPage(query: EnquiryListQuery, signal?: AbortSignal): Promise<EnquiryPage> {
  return api.getEnvelope(enquiryListPath(query), EnquiryPageSchema, signal);
}

/** The stages the staff desk counts, in pipeline order. */
export const COUNTED_ENQUIRY_STATES = ["submitted", "under_review", "approved", "rejected", "withdrawn"] as const;

export interface EnquiryStageCounts {
  /** Every enquiry in the caller's scope. */
  readonly all: number;
  readonly byState: Readonly<Record<(typeof COUNTED_ENQUIRY_STATES)[number], number>>;
  /** The new enquiry left untouched longest (the API's default order is
   *  least recently updated first), or null when none is waiting. */
  readonly longestWaiting: Enquiry | null;
}

/** Totals per stage from one-row pages, which every API version serves. */
export async function countEnquiryStages(signal?: AbortSignal): Promise<EnquiryStageCounts> {
  const [all, ...stages] = await Promise.all([
    listEnquiryPage({ limit: 1 }, signal),
    ...COUNTED_ENQUIRY_STATES.map((status) => listEnquiryPage({ status, limit: 1 }, signal)),
  ]);
  const total = (index: number): number => stages[index]?.total ?? 0;
  return {
    all: all.total,
    byState: {
      submitted: total(0), under_review: total(1), approved: total(2), rejected: total(3), withdrawn: total(4),
    },
    longestWaiting: stages[0]?.rows[0] ?? null,
  };
}

export async function getEnquiry(id: string, signal?: AbortSignal): Promise<Enquiry> {
  return api.get(`/enquiries/${id}`, EnquirySchema, signal);
}

export async function transitionEnquiry(id: string, status: string, note?: string): Promise<Enquiry> {
  return api.post(`/enquiries/${id}/transition`, { status, note }, undefined, EnquirySchema);
}

export async function getEnquiryHistory(
  id: string,
  signal?: AbortSignal,
): Promise<StatusHistoryEntry[]> {
  return api.get(`/enquiries/${id}/history`, z.array(StatusHistoryEntrySchema), signal);
}

// NOTE: Per-enquiry hallkeeper PDF removed when the review workflow
// replaced the enquiry-sheet lifecycle. The sheet now lives on the
// approved snapshot served by `/configurations/:configId/snapshot/latest`
// (see packages/api/src/routes/configuration-reviews.ts) and renders
// via HallkeeperPage.
