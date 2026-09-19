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

export async function listEnquiries(
  status?: string,
  signal?: AbortSignal,
): Promise<Enquiry[]> {
  const params = status !== undefined ? `?status=${encodeURIComponent(status)}` : "";
  return api.get(`/enquiries${params}`, z.array(EnquirySchema), signal);
}

/** The two states that mean "this enquiry is still someone's job" — what
 *  the Diary's tray is for. Declared beside the request that uses it so the
 *  tray and the server filter cannot disagree about what "open" means. */
export const OPEN_ENQUIRY_STATES = ["submitted", "under_review"] as const;

/** One server page. 100 is the API's own MAX_LIMIT. */
const OPEN_ENQUIRY_PAGE = 100;

/** A ceiling on the paging loop, so a server that ignored `offset` could
 *  never spin the browser. 500 open enquiries is far past anything a single
 *  venue's tray shows. */
const OPEN_ENQUIRY_MAX_PAGES = 5;

/**
 * Every OPEN enquiry, newest first (T-619).
 *
 * The tray used to call `listEnquiries()` with no arguments — the default
 * page of twenty rows, ordered by `updatedAt` ASCENDING — and then filter
 * to the open states in the browser. That reads the twenty LEAST recently
 * touched enquiries of any state, so a venue with a busy inbox saw a tray
 * that was both truncated and stale-first. This asks the server the real
 * question instead: these states, newest first, a full page at a time until
 * a page comes back short.
 */
export async function listOpenEnquiries(signal?: AbortSignal): Promise<Enquiry[]> {
  const query = `status=${OPEN_ENQUIRY_STATES.join(",")}&order=newest&limit=${String(OPEN_ENQUIRY_PAGE)}`;
  const all: Enquiry[] = [];
  for (let page = 0; page < OPEN_ENQUIRY_MAX_PAGES; page += 1) {
    const offset = page * OPEN_ENQUIRY_PAGE;
    const rows = await api.get(
      `/enquiries?${query}&offset=${String(offset)}`,
      z.array(EnquirySchema),
      signal,
    );
    all.push(...rows);
    if (rows.length < OPEN_ENQUIRY_PAGE) break;
  }
  return all;
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
