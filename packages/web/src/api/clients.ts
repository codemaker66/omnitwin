import { z } from "zod";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth.
//
// Punch list #8: each shape used to be a hand-written `interface` and every
// call site cast the API response with `as T`, trusting the server. If the
// API contract drifted (renamed field, missing column, string-where-number),
// the app would crash deep in component code with no useful error.
//
// Now: schemas are the source of truth, TypeScript types are derived via
// `z.infer`, and every call site passes the schema to `api.get()` which
// validates the response at the boundary. Mismatches throw a clean
// `RESPONSE_VALIDATION_ERROR` with the exact field issues.
//
// This module is the demonstration migration. Other api/*.ts modules
// (configurations, enquiries, loadouts, spaces, uploads) still use the
// legacy `as T` path and emit dev-mode warnings until they are migrated.
// ---------------------------------------------------------------------------

const ClientUserSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  organizationName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  configurationCount: z.number(),
  enquiryCount: z.number(),
});
export type ClientUser = z.infer<typeof ClientUserSchema>;

const GuestLeadSchema = z.object({
  id: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  name: z.string().nullable(),
  enquiryCount: z.number(),
  convertedToUserId: z.string().nullable(),
});
export type GuestLead = z.infer<typeof GuestLeadSchema>;

const ConfigSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceName: z.string(),
  userName: z.string().nullable(),
  createdAt: z.string(),
});
export type ConfigSearchResult = z.infer<typeof ConfigSearchResultSchema>;

const SearchResultsSchema = z.object({
  users: z.array(ClientUserSchema),
  guestLeads: z.array(GuestLeadSchema),
  configurations: z.array(ConfigSearchResultSchema),
});
export type SearchResults = z.infer<typeof SearchResultsSchema>;

const ClientProfileSchema = z.object({
  user: z.object({
    id: z.string(),
    displayName: z.string().nullable(),
    organizationName: z.string().nullable(),
    email: z.string(),
    phone: z.string().nullable(),
    name: z.string(),
    role: z.string(),
    createdAt: z.string(),
  }),
  configurations: z.array(z.object({
    id: z.string(),
    name: z.string(),
    spaceName: z.string(),
    objectCount: z.number(),
    createdAt: z.string(),
  })),
  enquiries: z.array(z.object({
    id: z.string(),
    state: z.string(),
    eventType: z.string().nullable(),
    preferredDate: z.string().nullable(),
    spaceName: z.string(),
  })),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

const LeadProfileSchema = z.object({
  lead: z.object({
    id: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    name: z.string().nullable(),
    convertedToUserId: z.string().nullable(),
    createdAt: z.string(),
  }),
  enquiries: z.array(z.object({
    id: z.string(),
    state: z.string(),
    eventType: z.string().nullable(),
    preferredDate: z.string().nullable(),
    spaceName: z.string(),
    createdAt: z.string(),
  })),
});
export type LeadProfile = z.infer<typeof LeadProfileSchema>;

const RecentEnquirySchema = z.object({
  id: z.string(),
  state: z.string(),
  name: z.string(),
  email: z.string(),
  guestEmail: z.string().nullable(),
  guestPhone: z.string().nullable(),
  guestName: z.string().nullable(),
  userId: z.string().nullable(),
  eventType: z.string().nullable(),
  preferredDate: z.string().nullable(),
  createdAt: z.string(),
});
export type RecentEnquiry = z.infer<typeof RecentEnquirySchema>;

const RecentEnquiryListSchema = z.array(RecentEnquirySchema);

// ---------------------------------------------------------------------------
// API functions — every call passes its schema to api.get() for validation
// ---------------------------------------------------------------------------

export async function searchClients(q: string): Promise<SearchResults> {
  return api.get(`/clients/search?q=${encodeURIComponent(q)}`, SearchResultsSchema);
}

export async function getClientProfile(userId: string): Promise<ClientProfile> {
  return api.get(`/clients/${userId}/profile`, ClientProfileSchema);
}

export async function getLeadProfile(leadId: string): Promise<LeadProfile> {
  return api.get(`/clients/leads/${leadId}/profile`, LeadProfileSchema);
}

export async function getRecentEnquiries(): Promise<RecentEnquiry[]> {
  return api.get("/clients/recent", RecentEnquiryListSchema);
}
