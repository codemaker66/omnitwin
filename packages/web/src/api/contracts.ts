import { z } from "zod";
import {
  ClientContractViewSchema,
  StaffContractVersionSchema,
  StaffContractViewSchema,
  type ClientContractView,
  type SignContract,
  type StaffContractVersion,
  type StaffContractView,
} from "@omnitwin/types";
import { ApiError, api } from "./client.js";

// ---------------------------------------------------------------------------
// The contract and its simple electronic signature (Plan 19 L5). The venue
// prepares a version from the accepted proposal and its terms; the client
// signs the exact version their page shows. Validated at the boundary.
// ---------------------------------------------------------------------------

const SignedSchema = z.object({ signerName: z.string(), signedAt: z.string(), already: z.boolean() });
export type ContractSigned = z.infer<typeof SignedSchema>;

export async function getProposalContract(proposalId: string, signal?: AbortSignal): Promise<StaffContractView> {
  return api.get(`/proposals/${encodeURIComponent(proposalId)}/contract`, StaffContractViewSchema, signal);
}

export async function prepareProposalContract(proposalId: string, input: { readonly terms: string; readonly version: number }): Promise<StaffContractVersion> {
  return api.post(`/proposals/${encodeURIComponent(proposalId)}/contract`, input, false, StaffContractVersionSchema);
}

/** The contract on a client's link, or null when there is none to show. */
export async function getShareContract(token: string, signal?: AbortSignal): Promise<ClientContractView | null> {
  try {
    return await api.get(`/proposal-share/${encodeURIComponent(token)}/contract`, ClientContractViewSchema, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function signShareContract(token: string, input: SignContract): Promise<ContractSigned> {
  return api.post(`/proposal-share/${encodeURIComponent(token)}/contract/sign`, input, true, SignedSchema);
}
