import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientUser {
  readonly id: string;
  readonly displayName: string | null;
  readonly organizationName: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly configurationCount: number;
  readonly enquiryCount: number;
}

export interface GuestLead {
  readonly id: string;
  readonly email: string;
  readonly phone: string | null;
  readonly name: string | null;
  readonly enquiryCount: number;
  readonly convertedToUserId: string | null;
}

export interface ConfigSearchResult {
  readonly id: string;
  readonly name: string;
  readonly spaceName: string;
  readonly userName: string | null;
  readonly createdAt: string;
}

export interface SearchResults {
  readonly users: readonly ClientUser[];
  readonly guestLeads: readonly GuestLead[];
  readonly configurations: readonly ConfigSearchResult[];
}

export interface ClientProfile {
  readonly user: {
    readonly id: string;
    readonly displayName: string | null;
    readonly organizationName: string | null;
    readonly email: string;
    readonly phone: string | null;
    readonly name: string;
    readonly role: string;
    readonly createdAt: string;
  };
  readonly configurations: readonly { readonly id: string; readonly name: string; readonly spaceName: string; readonly objectCount: number; readonly createdAt: string }[];
  readonly enquiries: readonly { readonly id: string; readonly state: string; readonly eventType: string | null; readonly preferredDate: string | null; readonly spaceName: string }[];
}

export interface LeadProfile {
  readonly lead: {
    readonly id: string;
    readonly email: string;
    readonly phone: string | null;
    readonly name: string | null;
    readonly convertedToUserId: string | null;
    readonly createdAt: string;
  };
  readonly enquiries: readonly { readonly id: string; readonly state: string; readonly eventType: string | null; readonly preferredDate: string | null; readonly spaceName: string; readonly createdAt: string }[];
}

export interface RecentEnquiry {
  readonly id: string;
  readonly state: string;
  readonly name: string;
  readonly email: string;
  readonly guestEmail: string | null;
  readonly guestPhone: string | null;
  readonly guestName: string | null;
  readonly userId: string | null;
  readonly eventType: string | null;
  readonly preferredDate: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function searchClients(q: string): Promise<SearchResults> {
  return api.get<SearchResults>(`/clients/search?q=${encodeURIComponent(q)}`);
}

export async function getClientProfile(userId: string): Promise<ClientProfile> {
  return api.get<ClientProfile>(`/clients/${userId}/profile`);
}

export async function getLeadProfile(leadId: string): Promise<LeadProfile> {
  return api.get<LeadProfile>(`/clients/leads/${leadId}/profile`);
}

export async function getRecentEnquiries(): Promise<RecentEnquiry[]> {
  return api.get<RecentEnquiry[]>("/clients/recent");
}
