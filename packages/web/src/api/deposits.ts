import { z } from "zod";
import {
  ClientDepositViewSchema,
  DepositRequestViewSchema,
  StaffDepositViewSchema,
  type ClientDepositView,
  type DepositRequestView,
  type RequestDeposit,
  type StaffDepositView,
} from "@omnitwin/types";
import { ApiError, api } from "./client.js";

// ---------------------------------------------------------------------------
// Deposits (Plan 19 L5), in Stripe test mode. The venue asks for one on an
// accepted proposal; the client pays it on Stripe's own checkout page, which
// the API opens. Responses are validated at the boundary (house rule, T-422).
// ---------------------------------------------------------------------------

const CheckoutSchema = z.object({ url: z.url().startsWith("https://") });

export async function getProposalDeposit(proposalId: string, signal?: AbortSignal): Promise<StaffDepositView> {
  return api.get(`/proposals/${encodeURIComponent(proposalId)}/deposit`, StaffDepositViewSchema, signal);
}

export async function requestProposalDeposit(proposalId: string, input: RequestDeposit): Promise<DepositRequestView> {
  return api.post(`/proposals/${encodeURIComponent(proposalId)}/deposit`, input, false, DepositRequestViewSchema);
}

export async function cancelProposalDeposit(proposalId: string, requestId: string): Promise<DepositRequestView> {
  return api.post(`/proposals/${encodeURIComponent(proposalId)}/deposit/${encodeURIComponent(requestId)}/cancel`, {}, false, DepositRequestViewSchema);
}

/** The deposit on a client's link, or null when there is none to show. */
export async function getShareDeposit(token: string, signal?: AbortSignal): Promise<ClientDepositView | null> {
  try {
    return await api.get(`/proposal-share/${encodeURIComponent(token)}/deposit`, ClientDepositViewSchema, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Opens (or reopens) Stripe's checkout page for the request the page showed. */
export async function startShareDepositCheckout(token: string, requestId: string): Promise<string> {
  const result = await api.post(`/proposal-share/${encodeURIComponent(token)}/deposit/checkout`, { requestId }, true, CheckoutSchema);
  return result.url;
}
