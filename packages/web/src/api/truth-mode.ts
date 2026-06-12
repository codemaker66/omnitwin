import {
  TruthModeSummarySchema,
  type EvidenceTargetType,
  type TruthModeSummary,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getTruthModeSummary(input: {
  readonly targetType: EvidenceTargetType;
  readonly targetId: string;
}): Promise<TruthModeSummary> {
  const query = new URLSearchParams({
    targetType: input.targetType,
    targetId: input.targetId,
  });
  return api.get(`/truth-mode/summary?${query.toString()}`, TruthModeSummarySchema);
}
