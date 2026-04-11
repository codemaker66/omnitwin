import { api, ApiError, getAuthToken } from "./client.js";
import { API_URL } from "../config/env.js";

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

export interface HallkeeperSheet {
  readonly venue: { readonly name: string; readonly address: string };
  readonly space: { readonly name: string; readonly widthM: string; readonly lengthM: string; readonly heightM: string };
  readonly event: {
    readonly name: string;
    readonly type: string | null;
    readonly date: string | null;
    readonly guestCount: number | null;
    readonly contactName: string;
    readonly contactEmail: string;
    readonly message: string | null;
  };
  readonly configuration: { readonly name: string } | null;
  readonly equipment: readonly { readonly category: string; readonly name: string; readonly quantity: number }[];
  readonly referenceLoadouts: readonly { readonly name: string; readonly photoCount: number }[];
  readonly statusHistory: readonly { readonly from: string; readonly to: string; readonly at: string; readonly by: string }[];
  readonly generatedAt: string;
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

export async function getHallkeeperSheet(id: string): Promise<HallkeeperSheet> {
  return api.get<HallkeeperSheet>(`/enquiries/${id}/hallkeeper-sheet`);
}

export async function downloadHallkeeperPdf(id: string): Promise<void> {
  // Punch list #12: previously read `omnitwin_access_token` from
  // localStorage — that key is leftover from the pre-Clerk JWT auth and
  // is always null for Clerk users, silently 401-ing every download.
  // Now uses the same Clerk-aware getAuthToken() as the rest of the app.
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}/enquiries/${id}/hallkeeper-sheet/pdf`, {
    headers: token !== null ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Failed to download PDF", "DOWNLOAD_ERROR");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hallkeeper-sheet-${id}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
