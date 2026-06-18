import {
  CreateSupplierAcknowledgementInputSchema,
  SupplierAcknowledgementSchema,
  SupplierSafePackViewSchema,
  type CreateSupplierAcknowledgementInput,
  type SupplierAcknowledgement,
  type SupplierAcknowledgementStatus,
  type SupplierSafePackView,
} from "@omnitwin/types";
import { api } from "./client.js";

export { SupplierSafePackViewSchema };
export type {
  CreateSupplierAcknowledgementInput,
  SupplierAcknowledgement,
  SupplierAcknowledgementStatus,
  SupplierSafePackView,
};

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
