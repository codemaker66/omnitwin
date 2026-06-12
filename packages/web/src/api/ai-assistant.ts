import {
  AIAssistantStatusSchema,
  AIDraftSchema,
  type AIAssistantStatus,
  type AIDraft,
  type CreateAIDraftRequest,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getAIAssistantStatus(): Promise<AIAssistantStatus> {
  return api.get("/ai/status", AIAssistantStatusSchema);
}

export async function createAIDraft(input: CreateAIDraftRequest): Promise<AIDraft> {
  return api.post("/ai/drafts", input, false, AIDraftSchema);
}
