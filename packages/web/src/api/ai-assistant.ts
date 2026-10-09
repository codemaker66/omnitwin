import {
  AIAssistantStatusSchema,
  AIDraftSchema,
  ProposalMessageDraftSchema,
  type AIAssistantStatus,
  type AIDraft,
  type CreateAIDraftRequest,
  type ProposalMessageDraft,
  type ProposalMessageDraftQuote,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getAIAssistantStatus(): Promise<AIAssistantStatus> {
  return api.get("/ai/status", AIAssistantStatusSchema);
}

export async function createAIDraft(input: CreateAIDraftRequest): Promise<AIDraft> {
  return api.post("/ai/drafts", input, false, AIDraftSchema);
}

/** An AI draft of a proposal's message to its client, with what it drew on
 *  and the figures in it to check. The server builds what the AI is told from
 *  the proposal itself; only the composer's quote, when given, is sent. */
export async function draftProposalMessage(proposalId: string, quote?: ProposalMessageDraftQuote): Promise<ProposalMessageDraft> {
  return api.post(`/proposals/${encodeURIComponent(proposalId)}/message-draft`, quote === undefined ? {} : { quote }, false, ProposalMessageDraftSchema);
}
