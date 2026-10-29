import {
  AIAssistantStatusSchema,
  AIDraftSchema,
  ProposalMessageDraftSchema,
  type AIAssistantStatus,
  type AIDraft,
  type CreateAIDraftRequest,
  type ProposalMessageDraft,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getAIAssistantStatus(): Promise<AIAssistantStatus> {
  return api.get("/ai/status", AIAssistantStatusSchema);
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
