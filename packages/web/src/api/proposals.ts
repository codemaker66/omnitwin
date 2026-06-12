import { z } from "zod";
import {
  ProposalStatusSchema,
  ProposalVersionPayloadSchema,
  QuoteSnapshotSchema,
  type CreateQuote,
  type ProposalVersionPayload,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Public proposal client — share-link surface only.
//
// Responses are validated at the boundary (house rule, T-422) so contract
// drift surfaces as ApiError(RESPONSE_VALIDATION_ERROR) instead of crashing
// inside the page. Money stays in integer minor units in transit; the page
// formats for display only.
// ---------------------------------------------------------------------------

export const PublicProposalSchema = z.object({
  title: z.string(),
  status: ProposalStatusSchema,
  sentAt: z.string().nullable(),
  venueName: z.string().nullable(),
  clientMessage: z.string().nullable(),
  capacityNote: z.string().nullable(),
  roomSummary: z.string().nullable().optional(),
  layoutSummary: z.string().nullable().optional(),
  packageSummary: z.array(z.string()).optional(),
  quote: QuoteSnapshotSchema.nullable(),
  version: z.number().int().positive(),
  comments: z.array(z.object({
    kind: z.string(),
    authorName: z.string().nullable(),
    body: z.string(),
    createdAt: z.string(),
  })).optional(),
  packages: z.array(z.object({
    label: z.string(),
    quantity: z.number().int(),
    totalMinor: z.number().int(),
    status: z.string(),
  })).optional(),
});

export type PublicProposal = z.infer<typeof PublicProposalSchema>;

export type ProposalResponseAction = "accept" | "request_changes";

const RespondResultSchema = z.object({ status: ProposalStatusSchema });
export type ProposalRespondResult = z.infer<typeof RespondResultSchema>;

export async function getPublicProposal(shareCode: string): Promise<PublicProposal> {
  return api.get(`/public/proposals/${encodeURIComponent(shareCode)}`, PublicProposalSchema);
}

export async function getProposalShare(token: string): Promise<PublicProposal> {
  return api.get(`/proposal-share/${encodeURIComponent(token)}`, PublicProposalSchema);
}

export async function respondToProposal(
  shareCode: string,
  action: ProposalResponseAction,
  note?: string,
): Promise<ProposalRespondResult> {
  return api.post(
    `/public/proposals/${encodeURIComponent(shareCode)}/respond`,
    { action, note: note ?? null },
    true,
    RespondResultSchema,
  );
}

export async function commentOnProposalShare(
  token: string,
  input: { readonly body: string; readonly kind?: "comment" | "request_changes"; readonly authorName?: string | null; readonly authorEmail?: string | null },
): Promise<{ kind: string; authorName: string | null; body: string; createdAt: string }> {
  const CommentSchema = z.object({
    kind: z.string(),
    authorName: z.string().nullable(),
    body: z.string(),
    createdAt: z.string(),
  });
  return api.post(`/proposal-share/${encodeURIComponent(token)}/comment`, input, true, CommentSchema);
}

export async function approveProposalShare(
  token: string,
  input: { readonly body?: string; readonly authorName?: string | null; readonly authorEmail?: string | null } = {},
): Promise<ProposalRespondResult> {
  return api.post(`/proposal-share/${encodeURIComponent(token)}/approve`, input, true, RespondResultSchema);
}

// ---------------------------------------------------------------------------
// Staff proposal client — dashboard authoring surface (T-427 phase 4).
//
// Row schemas follow the dashboard house pattern (see enquiries.ts): status
// fields stay z.string() so a newly added server-side status never hard-fails
// the list view. Content payloads keep the STRICT types schema — the claim
// guard must hold at this boundary too.
// ---------------------------------------------------------------------------

export const StaffProposalSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  opportunityId: z.string().nullable(),
  enquiryId: z.string().nullable(),
  configurationId: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  currentVersion: z.number().int(),
  shareCode: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export type StaffProposal = z.infer<typeof StaffProposalSchema>;

export const ProposalHistoryEntrySchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  fromStatus: z.string(),
  toStatus: z.string(),
  changedBy: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type ProposalHistoryEntry = z.infer<typeof ProposalHistoryEntrySchema>;

export const StaffProposalVersionSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  version: z.number().int(),
  payload: ProposalVersionPayloadSchema,
  sourceHash: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export type StaffProposalVersion = z.infer<typeof StaffProposalVersionSchema>;

const StaffQuoteLineItemSchema = z.object({
  id: z.string(),
  quoteId: z.string(),
  pricingRuleId: z.string().nullable(),
  description: z.string(),
  quantity: z.number().int(),
  unitAmountMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
  sortOrder: z.number().int(),
});

export const StaffQuoteSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  opportunityId: z.string().nullable(),
  proposalId: z.string().nullable(),
  enquiryId: z.string().nullable(),
  spaceId: z.string().nullable(),
  name: z.string(),
  status: z.string(),
  currency: z.string(),
  subtotalMinor: z.number().int(),
  totalMinor: z.number().int(),
  validUntil: z.string().nullable(),
  supersededByQuoteId: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const StaffQuoteWithItemsSchema = StaffQuoteSchema.extend({
  lineItems: z.array(StaffQuoteLineItemSchema),
});

export type StaffQuoteWithItems = z.infer<typeof StaffQuoteWithItemsSchema>;

export interface CreateProposalInput {
  readonly venueId: string;
  readonly title: string;
  readonly opportunityId?: string | null;
  readonly enquiryId?: string | null;
  readonly configurationId?: string | null;
}

const ShareTokenResultSchema = z.object({
  token: z.string(),
  shareUrl: z.string(),
  tokenPrefix: z.string(),
  proposal: StaffProposalSchema,
});

export type ShareTokenResult = z.infer<typeof ShareTokenResultSchema>;

export async function listProposals(status?: string): Promise<StaffProposal[]> {
  const params = status !== undefined ? `?status=${encodeURIComponent(status)}` : "";
  return api.get(`/proposals${params}`, z.array(StaffProposalSchema));
}

export async function getProposal(id: string): Promise<StaffProposal> {
  return api.get(`/proposals/${id}`, StaffProposalSchema);
}

export async function createProposal(input: CreateProposalInput): Promise<StaffProposal> {
  return api.post("/proposals", input, undefined, StaffProposalSchema);
}

export async function updateProposalTitle(id: string, title: string): Promise<StaffProposal> {
  return api.patch(`/proposals/${id}`, { title }, StaffProposalSchema);
}

export async function transitionProposal(id: string, status: string, note?: string): Promise<StaffProposal> {
  return api.post(`/proposals/${id}/transition`, { status, note: note ?? null }, undefined, StaffProposalSchema);
}

export async function createProposalShareToken(id: string): Promise<ShareTokenResult> {
  return api.post(`/proposals/${id}/share-token`, {}, undefined, ShareTokenResultSchema);
}

export async function getProposalHistory(id: string): Promise<ProposalHistoryEntry[]> {
  return api.get(`/proposals/${id}/history`, z.array(ProposalHistoryEntrySchema));
}

export async function createProposalVersion(
  id: string,
  payload: ProposalVersionPayload,
): Promise<StaffProposalVersion> {
  return api.post(`/proposals/${id}/versions`, payload, undefined, StaffProposalVersionSchema);
}

export async function getLatestProposalVersion(id: string): Promise<StaffProposalVersion> {
  return api.get(`/proposals/${id}/versions/latest`, StaffProposalVersionSchema);
}

export async function createQuote(input: CreateQuote): Promise<StaffQuoteWithItems> {
  return api.post("/quotes", input, undefined, StaffQuoteWithItemsSchema);
}
