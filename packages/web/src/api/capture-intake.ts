import {
  CaptureIntakeOperatorStatusSchema,
  type CaptureIntakeOperatorStatus,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getCaptureIntakeOperatorStatus(
  signal?: AbortSignal,
): Promise<CaptureIntakeOperatorStatus> {
  return api.get("/admin/capture-intake", CaptureIntakeOperatorStatusSchema, signal);
}
