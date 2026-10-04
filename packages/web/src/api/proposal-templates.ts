import { z } from "zod";
import {
  ProposalEventSchema,
  ProposalTemplateSchema,
  type CreateProposalTemplateInput,
  type ProposalEvent,
  type ProposalTemplate,
  type ReplaceProposalTemplateInput,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Proposal templates (roadmap X1; Tier B #16): a venue's proposal words and
// quote lines, by room and occasion. Responses are validated at the boundary.
// ---------------------------------------------------------------------------

function templatesPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/proposal-templates`;
}

export async function listProposalTemplates(venueId: string): Promise<ProposalTemplate[]> {
  return api.get(templatesPath(venueId), z.array(ProposalTemplateSchema));
}

export async function createProposalTemplate(venueId: string, input: CreateProposalTemplateInput): Promise<ProposalTemplate> {
  return api.post(templatesPath(venueId), input, undefined, ProposalTemplateSchema);
}

/** Replaces a template as it was read; one changed since answers 409. */
export async function replaceProposalTemplate(venueId: string, id: string, input: ReplaceProposalTemplateInput): Promise<ProposalTemplate> {
  return api.patch(`${templatesPath(venueId)}/${encodeURIComponent(id)}`, input, ProposalTemplateSchema);
}

/** Removes it for everyone at the venue; it can be restored. */
export async function removeProposalTemplate(venueId: string, id: string): Promise<void> {
  await api.delete(`${templatesPath(venueId)}/${encodeURIComponent(id)}`);
}

/** Undoes a removal, unless its name has been taken since (409). */
export async function restoreProposalTemplate(venueId: string, id: string): Promise<ProposalTemplate> {
  return api.post(`${templatesPath(venueId)}/${encodeURIComponent(id)}/restore`, undefined, undefined, ProposalTemplateSchema);
}

/** The event a proposal is for, and its room's id, before any version exists. */
export async function getProposalEvent(proposalId: string): Promise<ProposalEvent> {
  return api.get(`/proposals/${encodeURIComponent(proposalId)}/event`, ProposalEventSchema);
}
