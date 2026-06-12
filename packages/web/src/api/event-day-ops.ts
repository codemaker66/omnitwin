import {
  CreateEventDayIssueInputSchema,
  EventDayChangesSinceLastHandoffSchema,
  EventDayIssueSchema,
  EventDayOpsBoardSchema,
  OpsTaskSchema,
  UpdateEventDayIssueInputSchema,
  UpdateOpsTaskStatusInputSchema,
  type CreateEventDayIssueInput,
  type EventDayChangesSinceLastHandoff,
  type EventDayIssue,
  type EventDayOpsBoard,
  type OpsTask,
  type UpdateEventDayIssueInput,
  type UpdateOpsTaskStatusInput,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function getEventDayOpsBoard(eventId: string): Promise<EventDayOpsBoard> {
  return api.get(`/events/${eventId}/ops-board`, EventDayOpsBoardSchema);
}

export async function getChangesSinceLastHandoff(eventId: string): Promise<EventDayChangesSinceLastHandoff> {
  return api.get(`/events/${eventId}/changes-since-last-handoff`, EventDayChangesSinceLastHandoffSchema);
}

export async function updateOpsTaskStatus(
  opsTaskId: string,
  input: UpdateOpsTaskStatusInput,
): Promise<OpsTask> {
  const payload = UpdateOpsTaskStatusInputSchema.parse(input);
  return api.patch(`/ops-tasks/${opsTaskId}/status`, payload, OpsTaskSchema);
}

export async function createEventDayIssue(
  eventId: string,
  input: CreateEventDayIssueInput,
): Promise<EventDayIssue> {
  const payload = CreateEventDayIssueInputSchema.parse(input);
  return api.post(`/events/${eventId}/issues`, payload, false, EventDayIssueSchema);
}

export async function updateEventDayIssue(
  eventId: string,
  issueId: string,
  input: UpdateEventDayIssueInput,
): Promise<EventDayIssue> {
  const payload = UpdateEventDayIssueInputSchema.parse(input);
  return api.patch(`/events/${eventId}/issues/${issueId}`, payload, EventDayIssueSchema);
}
