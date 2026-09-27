import { z } from "zod";
import {
  ProposalLayoutSnapshotSchema,
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
    /** Who wrote it; from an API before it, a "Venue team" author is the venue's. */
    from: z.enum(["venue", "client"]).optional(),
  })).optional(),
  packages: z.array(z.object({
    label: z.string(),
    quantity: z.number().int(),
    totalMinor: z.number().int(),
    status: z.string(),
  })).optional(),
  layoutSnapshot: ProposalLayoutSnapshotSchema.nullable().optional(),
  /** The event it is for, as the venue holds it (roadmap X1). Empty from an
   *  API before it, so the page never breaks against one a deploy behind. */
  facts: z.object({
    eventDate: z.string().nullable(),
    guestCount: z.number().int().nullable(),
    occasion: z.string().nullable(),
    roomName: z.string().nullable(),
    roomSlug: z.string().nullable(),
  }).default({ eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null }),
  /** Who accepted it (the name they gave, if any) and when. */
  accepted: z.object({ by: z.string().nullable(), at: z.string() }).nullable().default(null),
  /** The venue, for its own room photographs and the printed address. */
  venueSlug: z.string().nullable().default(null),
  venueAddress: z.string().nullable().default(null),
  /** When the version shown was saved. */
  preparedAt: z.string().nullable().default(null),
  /** The venue team's preview only: the version the client's link shows. */
  sentVersion: z.number().int().positive().nullable().default(null),
});

export type PublicProposal = z.infer<typeof PublicProposalSchema>;
/** The proposal as the API sends it, before the defaults above fill it. */
export type PublicProposalPayload = z.input<typeof PublicProposalSchema>;

export type ProposalResponseAction = "accept" | "request_changes";

const RespondResultSchema = z.object({ status: ProposalStatusSchema });
export type ProposalRespondResult = z.infer<typeof RespondResultSchema>;

export async function getPublicProposal(shareCode: string): Promise<PublicProposal> {
  return api.get(`/public/proposals/${encodeURIComponent(shareCode)}`, PublicProposalSchema);
}

export async function getProposalShare(token: string): Promise<PublicProposal> {
  return api.get(`/proposal-share/${encodeURIComponent(token)}`, PublicProposalSchema);
}

/** An answer names the version the client read, so one made on a page older
 *  than the version now sent is refused (409 PROPOSAL_VERSION_CHANGED). */
export async function respondToProposal(
  shareCode: string,
  action: ProposalResponseAction,
  note?: string,
  version?: number,
): Promise<ProposalRespondResult> {
  return api.post(
    `/public/proposals/${encodeURIComponent(shareCode)}/respond`,
    { action, note: note ?? null, ...(version === undefined ? {} : { version }) },
    true,
    RespondResultSchema,
  );
}

export async function commentOnProposalShare(
  token: string,
  input: {
    readonly body: string;
    readonly kind?: "comment" | "request_changes";
    readonly authorName?: string | null;
    readonly authorEmail?: string | null;
    readonly version?: number;
  },
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
  input: { readonly body?: string; readonly authorName?: string | null; readonly authorEmail?: string | null; readonly version?: number } = {},
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

// Conversation thread (T-427 phase 6). `authorType` is derived server-side
// from the structural share-token link: "client" for share-link posts,
// "staff" for venue-team replies.
export const ProposalCommentRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  authorType: z.string(),
  authorName: z.string().nullable(),
  body: z.string(),
  isClientVisible: z.boolean(),
  createdAt: z.string(),
});

export type ProposalCommentRow = z.infer<typeof ProposalCommentRowSchema>;

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

/** One page of GET /proposals, newest first, with how many there are in all.
 *  `listProposals` keeps only the first page (the API's default 20), which
 *  is how the staff list silently stopped at twenty. */
export interface ProposalPage {
  readonly rows: readonly StaffProposal[];
  readonly total: number;
}

const ProposalPageSchema = z.object({
  data: z.array(StaffProposalSchema),
  // An API without paging metadata sent everything it had in one answer.
  meta: z.object({ total: z.number().int().nonnegative() }).optional(),
}).transform(({ data, meta }): ProposalPage => ({ rows: data, total: meta?.total ?? data.length }));

/** A proposal as the Proposals desk shows it (roadmap X1): who it is for,
 *  their event's date, guests and occasion from its deal or enquiry, and what
 *  its latest version comes to. Defaulted for an API from before them. */
export const DeskProposalSchema = StaffProposalSchema.extend({
  dealTitle: z.string().nullable().default(null),
  clientName: z.string().nullable().default(null),
  eventDate: z.string().nullable().default(null),
  guestCount: z.number().int().nullable().default(null),
  eventType: z.string().nullable().default(null),
  latestTotalMinor: z.number().int().nullable().default(null),
  latestCurrency: z.string().nullable().default(null),
  /** When a link to it was last opened since it was last sent; the team's
   *  previews never count, and anyone the link reaches does. */
  linkOpenedAt: z.string().nullable().default(null),
  /** The version the client's link shows, once sent. */
  sentVersion: z.number().int().positive().nullable().default(null),
});

export type DeskProposal = z.infer<typeof DeskProposalSchema>;

/** The desk's groups, in the order a booker works them. */
export const PROPOSAL_DESK_GROUPS = ["waiting", "drafts", "with_client", "accepted", "closed"] as const;
export type ProposalDeskGroup = (typeof PROPOSAL_DESK_GROUPS)[number];

export interface ProposalDeskPage {
  readonly rows: readonly DeskProposal[];
  /** How many there are in the group asked for (or in all). */
  readonly total: number;
  /** Every status's count over the whole list, never the page. */
  readonly statusCounts: Readonly<Record<string, number>>;
}

const ProposalDeskPageSchema = z.object({
  data: z.array(DeskProposalSchema),
  meta: z.object({ total: z.number().int().nonnegative() }),
  statusCounts: z.record(z.string(), z.number().int().nonnegative()),
}).transform(({ data, meta, statusCounts }): ProposalDeskPage => ({ rows: data, total: meta.total, statusCounts }));

export async function listProposalDesk(query: { readonly limit: number; readonly offset: number; readonly group?: ProposalDeskGroup }): Promise<ProposalDeskPage> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.group !== undefined) params.set("group", query.group);
  return api.getEnvelope(`/proposals/desk?${params.toString()}`, ProposalDeskPageSchema);
}

/** The proposal exactly as its client reads it, for the venue team. Never
 *  counted as the link being opened. */
export async function getProposalPreview(id: string): Promise<PublicProposal> {
  return api.get(`/proposals/${encodeURIComponent(id)}/preview`, PublicProposalSchema);
}

/** One proposal with the same facts as its row on the desk. */
export async function getDeskProposal(id: string): Promise<DeskProposal> {
  return api.get(`/proposals/${id}`, DeskProposalSchema);
}

export async function listProposalPage(
  query: { readonly limit: number; readonly offset: number; readonly status?: string },
  signal?: AbortSignal,
): Promise<ProposalPage> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.status !== undefined) params.set("status", query.status);
  return api.getEnvelope(`/proposals?${params.toString()}`, ProposalPageSchema, signal);
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

/** Sends the version the booker confirmed; a newer one saved meanwhile is
 *  refused (409 PROPOSAL_VERSION_CHANGED) rather than sent unseen. */
export async function createProposalShareToken(id: string, version?: number): Promise<ShareTokenResult> {
  return api.post(`/proposals/${id}/share-token`, version === undefined ? {} : { version }, undefined, ShareTokenResultSchema);
}

export async function getProposalHistory(id: string): Promise<ProposalHistoryEntry[]> {
  return api.get(`/proposals/${id}/history`, z.array(ProposalHistoryEntrySchema));
}

export async function getProposalComments(id: string): Promise<ProposalCommentRow[]> {
  return api.get(`/proposals/${id}/comments`, z.array(ProposalCommentRowSchema));
}

export async function postProposalComment(id: string, body: string): Promise<ProposalCommentRow> {
  return api.post(`/proposals/${id}/comments`, { body }, undefined, ProposalCommentRowSchema);
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
