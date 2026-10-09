import {
  AIAssistantStatusSchema,
  CreateEventArchitectRunInputSchema,
  CreateEventArchitectOpsReviewInputSchema,
  CreateEventBriefDraftInputSchema,
  EventArchitectCandidateSelectionSchema,
  EventArchitectOpsReviewGateSchema,
  EventBriefDraftSchema,
  PersistedEventArchitectRunSchema,
  SelectEventArchitectCandidateInputSchema,
  type AIAssistantStatus,
  type CreateEventArchitectRunInput,
  type CreateEventArchitectOpsReviewInput,
  type CreateEventBriefDraftInput,
  type EventArchitectCandidateSelection,
  type EventArchitectOpsReviewGate,
  type EventBriefDraft,
  type PersistedEventArchitectRun,
  type SelectEventArchitectCandidateInput,
} from "@omnitwin/types";
import { api } from "./client.js";

/** Whether the server reads event briefs (T-650): its own "AI is off" says no. */
export async function getEventBriefReaderStatus(): Promise<AIAssistantStatus> {
  return api.get("/event-architect/brief-drafts/status", AIAssistantStatusSchema);
}

/** A planner's description read into an unchecked draft of the brief. The
 *  server scrubs contact details before the AI reads it; nothing runs. */
export async function readEventBrief(
  input: CreateEventBriefDraftInput,
  signal?: AbortSignal,
): Promise<EventBriefDraft> {
  return api.post(
    "/event-architect/brief-drafts",
    CreateEventBriefDraftInputSchema.parse(input),
    false,
    EventBriefDraftSchema,
    { signal },
  );
}

export async function createEventArchitectRun(
  input: CreateEventArchitectRunInput,
): Promise<PersistedEventArchitectRun> {
  return api.post(
    "/event-architect/runs",
    CreateEventArchitectRunInputSchema.parse(input),
    false,
    PersistedEventArchitectRunSchema,
  );
}
export async function getEventArchitectRun(
  runId: string,
  signal?: AbortSignal,
): Promise<PersistedEventArchitectRun> {
  return api.get(
    `/event-architect/runs/${runId}`,
    PersistedEventArchitectRunSchema,
    signal,
  );
}

export async function selectEventArchitectCandidate(
  candidateId: string,
  input: SelectEventArchitectCandidateInput,
): Promise<EventArchitectCandidateSelection> {
  return api.post(
    `/event-architect/candidates/${candidateId}/select`,
    SelectEventArchitectCandidateInputSchema.parse(input),
    false,
    EventArchitectCandidateSelectionSchema,
  );
}

export async function getEventArchitectOpsReview(
  candidateId: string,
  signal?: AbortSignal,
): Promise<EventArchitectOpsReviewGate> {
  return api.get(
    `/event-architect/candidates/${candidateId}/ops-review`,
    EventArchitectOpsReviewGateSchema,
    signal,
  );
}

export async function createEventArchitectOpsReview(
  candidateId: string,
  input: CreateEventArchitectOpsReviewInput,
): Promise<EventArchitectOpsReviewGate> {
  return api.post(
    `/event-architect/candidates/${candidateId}/ops-review`,
    CreateEventArchitectOpsReviewInputSchema.parse(input),
    false,
    EventArchitectOpsReviewGateSchema,
  );
}
