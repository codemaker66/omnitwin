import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Enquiry {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string;
  readonly configurationId: string | null;
  readonly userId: string | null;
  readonly guestEmail: string | null;
  readonly guestPhone: string | null;
  readonly guestName: string | null;
  readonly state: string;
  readonly name: string;
  readonly email: string;
  readonly preferredDate: string | null;
  readonly eventType: string | null;
  readonly estimatedGuests: number | null;
  readonly message: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StatusHistoryEntry {
  readonly id: string;
  readonly enquiryId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly changedBy: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listEnquiries(status?: string): Promise<Enquiry[]> {
  const params = status !== undefined ? `?status=${encodeURIComponent(status)}` : "";
  return api.get<Enquiry[]>(`/enquiries${params}`);
}

export async function getEnquiry(id: string): Promise<Enquiry> {
  return api.get<Enquiry>(`/enquiries/${id}`);
}

export async function transitionEnquiry(id: string, status: string, note?: string): Promise<Enquiry> {
  return api.post<Enquiry>(`/enquiries/${id}/transition`, { status, note });
}

export async function getEnquiryHistory(id: string): Promise<StatusHistoryEntry[]> {
  return api.get<StatusHistoryEntry[]>(`/enquiries/${id}/history`);
}

// NOTE: Per-enquiry hallkeeper PDF removed when the review workflow
// replaced the enquiry-sheet lifecycle. The sheet now lives on the
// approved snapshot served by `/configurations/:configId/snapshot/latest`
// (see packages/api/src/routes/configuration-reviews.ts) and renders
// via HallkeeperPage.
