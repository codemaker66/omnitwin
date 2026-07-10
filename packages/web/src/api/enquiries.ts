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
