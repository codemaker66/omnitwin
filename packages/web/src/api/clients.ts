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
  spaceName: z.string().nullable(),
  userName: z.string().nullable(),
  createdAt: z.string(),
});
export type ConfigSearchResult = z.infer<typeof ConfigSearchResultSchema>;

// The commercial record the search also finds (roadmap X1): only the roles
// that work it receive any, and an API from before them sends none.
const ContactSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  accountName: z.string().nullable(),
});
export type ContactSearchResult = z.infer<typeof ContactSearchResultSchema>;

const AccountSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountType: z.string(),
  primaryContactId: z.string().nullable(),
});
export type AccountSearchResult = z.infer<typeof AccountSearchResultSchema>;

const DealSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: z.string(),
  preferredDate: z.string().nullable(),
  guestCount: z.number().nullable(),
  contactName: z.string().nullable(),
});
export type DealSearchResult = z.infer<typeof DealSearchResultSchema>;

const ProposalSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  currentVersion: z.number(),
  opportunityId: z.string().nullable(),
  sentAt: z.string().nullable(),
});
export type ProposalSearchResult = z.infer<typeof ProposalSearchResultSchema>;

const SearchResultsSchema = z.object({
  users: z.array(ClientUserSchema),
  guestLeads: z.array(GuestLeadSchema),
  configurations: z.array(ConfigSearchResultSchema),
  contacts: z.array(ContactSearchResultSchema).default([]),
  accounts: z.array(AccountSearchResultSchema).default([]),
  deals: z.array(DealSearchResultSchema).default([]),
  proposals: z.array(ProposalSearchResultSchema).default([]),
});
export type SearchResults = z.infer<typeof SearchResultsSchema>;

const ContactProfileSchema = z.object({
  contact: z.object({
    id: z.string(),
    venueId: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    roleLabel: z.string().nullable(),
    sourceEnquiryId: z.string().nullable(),
    createdAt: z.string(),
    account: z.object({ id: z.string(), name: z.string() }).nullable(),
  }),
  deals: z.array(z.object({
    id: z.string(),
    title: z.string(),
    stage: z.string(),
    preferredDate: z.string().nullable(),
    guestCount: z.number().nullable(),
    estimatedValueMinor: z.number(),
    currency: z.string(),
    updatedAt: z.string(),
  })),
  proposals: z.array(z.object({
    id: z.string(),
    opportunityId: z.string().nullable(),
    title: z.string(),
    status: z.string(),
    currentVersion: z.number(),
    sentAt: z.string().nullable(),
  })),
});
export type ContactProfile = z.infer<typeof ContactProfileSchema>;

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
    /** False when the guest named no room: spaceName is then only where the
     *  enquiry is filed. Absent from an API that predates it. */
    roomChosen: z.boolean().optional(),
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
    roomChosen: z.boolean().optional(),
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
  /** The guest's lead, so a guest opens on their own profile; null for a
   *  signed-in client, or from an API before it said. */
  leadId: z.string().nullable().default(null),
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

/** Live enquiries whose date is today or within the year ahead, soonest first. */
export async function getUpcomingClients(): Promise<RecentEnquiry[]> {
  return api.get("/clients/upcoming", RecentEnquiryListSchema);
}

export async function getContactProfile(contactId: string): Promise<ContactProfile> {
  return api.get(`/clients/contacts/${contactId}/profile`, ContactProfileSchema);
}
