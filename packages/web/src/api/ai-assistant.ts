import {
  AIAssistantStatusSchema,
  AIDraftSchema,
  ProposalMessageDraftSchema,
  type AIAssistantStatus,
  type AIDraft,
  type AIUsageFeature,
  type CreateAIDraftRequest,
  type ProposalMessageDraft,
} from "@omnitwin/types";
import { api } from "./client.js";

/** Whether AI drafts are on for the venue the person works at: for `feature`
 *  when one is named (each draft is switched on apart, C1), else at all. */
export async function getAIAssistantStatus(feature?: AIUsageFeature): Promise<AIAssistantStatus> {
  const query = feature === undefined ? "" : `?feature=${encodeURIComponent(feature)}`;
  return api.get(`/ai/status${query}`, AIAssistantStatusSchema);
}

export async function createAIDraft(input: CreateAIDraftRequest): Promise<AIDraft> {
  return api.post("/ai/drafts", input, false, AIDraftSchema);
}

/** An AI draft of a proposal's message to its client, with what it drew on.
 *  The server builds what the AI is told from the proposal itself; nothing
 *  else is sent. */
export async function draftProposalMessage(proposalId: string): Promise<ProposalMessageDraft> {
  return api.post(`/proposals/${encodeURIComponent(proposalId)}/message-draft`, {}, false, ProposalMessageDraftSchema);
}

/** An AI summary of an enquiry for the venue's team. The server builds what
 *  the AI is told from the enquiry it holds, with no name, contact details or
 *  ids (release audit ai-1); nothing but the enquiry's id is sent. */
export async function draftEnquirySummary(enquiryId: string): Promise<AIDraft> {
  return api.post(`/enquiries/${encodeURIComponent(enquiryId)}/summary-draft`, {}, false, AIDraftSchema);
}
