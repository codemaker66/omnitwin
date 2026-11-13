import {
  CreateSupplierAcknowledgementInputSchema,
  CreateSupplierCoordinationPackInputSchema,
  GenerateSupplierCoordinationShareTokenInputSchema,
  SupplierAcknowledgementSchema,
  SupplierCoordinationPackBundleSchema,
  SupplierCoordinationPackSchema,
  SupplierCoordinationShareTokenResultSchema,
  SupplierPassBoardSchema,
  SupplierSafePackViewSchema,
  type CreateSupplierAcknowledgementInput,
  type CreateSupplierCoordinationPackInput,
  type GenerateSupplierCoordinationShareTokenInput,
  type SupplierAcknowledgement,
  type SupplierAcknowledgementStatus,
  type SupplierCoordinationPack,
  type SupplierCoordinationPackBundle,
  type SupplierCoordinationShareTokenResult,
  type SupplierPassBoard,
  type SupplierPassDetails,
  type SupplierPassScopeItem,
  type SupplierPassSummary,
  type SupplierSafePackView,
} from "@omnitwin/types";
import { api } from "./client.js";

export { SupplierSafePackViewSchema, SupplierPassBoardSchema };
export type {
  CreateSupplierAcknowledgementInput,
  CreateSupplierCoordinationPackInput,
  SupplierAcknowledgement,
  SupplierAcknowledgementStatus,
  SupplierPassBoard,
  SupplierPassDetails,
  SupplierPassScopeItem,
  SupplierPassSummary,
  SupplierSafePackView,
};

// ---------------------------------------------------------------------------
// The supplier's side: their pass, read and acknowledged without an account.
// ---------------------------------------------------------------------------

export async function getSupplierShare(token: string): Promise<SupplierSafePackView> {
  return api.get(`/supplier-share/${encodeURIComponent(token)}`, SupplierSafePackViewSchema);
}

export async function acknowledgeSupplierShare(
  token: string,
  input: CreateSupplierAcknowledgementInput,
): Promise<SupplierAcknowledgement> {
  const parsed = CreateSupplierAcknowledgementInputSchema.parse(input);
  return api.post(
    `/supplier-share/${encodeURIComponent(token)}/acknowledge`,
    parsed,
    true,
    SupplierAcknowledgementSchema,
  );
}

// ---------------------------------------------------------------------------
// The venue's side: issuing passes from the event board (A Door for Everyone
// Outside, stage 1). Staff, managers and admins issue and withdraw; the API
// refuses anyone else, and a hallkeeper reads the same board.
// ---------------------------------------------------------------------------

export async function getEventSupplierPasses(eventId: string, signal?: AbortSignal): Promise<SupplierPassBoard> {
  return api.get(`/supplier-coordination/events/${encodeURIComponent(eventId)}/passes`, SupplierPassBoardSchema, signal);
}

/** Makes the pass (not yet sent anywhere): the supplier's part, from the plan. */
export async function createSupplierPass(input: CreateSupplierCoordinationPackInput): Promise<SupplierCoordinationPackBundle> {
  const parsed = CreateSupplierCoordinationPackInputSchema.parse(input);
  return api.post("/supplier-coordination/packs", parsed, false, SupplierCoordinationPackBundleSchema);
}

/** Makes the pass's link. Any earlier link to the same pass stops working;
 *  with `supersedesPackId`, so does the pass this one replaces. */
export async function makeSupplierPassLink(
  packId: string,
  input: GenerateSupplierCoordinationShareTokenInput = {},
): Promise<SupplierCoordinationShareTokenResult> {
  const parsed = GenerateSupplierCoordinationShareTokenInputSchema.parse(input);
  return api.post(
    `/supplier-coordination/packs/${encodeURIComponent(packId)}/share-token`,
    parsed,
    false,
    SupplierCoordinationShareTokenResultSchema,
  );
}

/** Withdraws the pass: every link to it stops working at once. */
export async function withdrawSupplierPass(packId: string): Promise<SupplierCoordinationPack> {
  return api.post(
    `/supplier-coordination/packs/${encodeURIComponent(packId)}/revoke`,
    {},
    false,
    SupplierCoordinationPackSchema,
  );
}
