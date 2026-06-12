import { z } from "zod";
import { api } from "./client.js";
import { StaffProposalSchema } from "./proposals.js";

export const OpportunityStageSchema = z.enum([
  "new",
  "qualified",
  "proposal_drafting",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
  "archived",
]);

export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const OpportunitySchema = z.object({
  id: z.string(),
  venueId: z.string(),
  clientAccountId: z.string().nullable(),
  primaryContactId: z.string().nullable(),
  sourceEnquiryId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  title: z.string(),
  stage: z.string(),
  eventType: z.string().nullable(),
  preferredDate: z.string().nullable(),
  guestCount: z.number().nullable(),
  estimatedValueMinor: z.number().int(),
  currency: z.string(),
  nextAction: z.string(),
  nextActionDueAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

export type Opportunity = z.infer<typeof OpportunitySchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  type: z.string(),
  body: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export type Activity = z.infer<typeof ActivitySchema>;

export const FollowUpTaskSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  assignedTo: z.string().nullable(),
  title: z.string(),
  dueAt: z.string().nullable(),
  status: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FollowUpTask = z.infer<typeof FollowUpTaskSchema>;

const ClientAccountSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  name: z.string(),
  accountType: z.string(),
  primaryContactId: z.string().nullable(),
  sourceEnquiryId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

const ContactSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  clientAccountId: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  roleLabel: z.string().nullable(),
  sourceEnquiryId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

const PipelineSchema = z.object({
  opportunities: z.array(OpportunitySchema),
  todayTasks: z.array(FollowUpTaskSchema),
  stageCounts: z.record(z.number().int()),
});

export type PipelineSummary = z.infer<typeof PipelineSchema>;

const OpportunityCreateResultSchema = z.object({
  opportunity: OpportunitySchema,
  task: FollowUpTaskSchema.nullable(),
});

export type OpportunityCreateResult = z.infer<typeof OpportunityCreateResultSchema>;

const FromEnquiryResultSchema = z.object({
  created: z.boolean(),
  opportunity: OpportunitySchema,
  clientAccount: ClientAccountSchema.nullable(),
  contact: ContactSchema.nullable(),
  followUpTask: FollowUpTaskSchema.nullable(),
});

export type FromEnquiryResult = z.infer<typeof FromEnquiryResultSchema>;

const OpportunityDetailSchema = z.object({
  opportunity: OpportunitySchema,
  activities: z.array(ActivitySchema),
  tasks: z.array(FollowUpTaskSchema),
  proposals: z.array(StaffProposalSchema),
});

export type OpportunityDetail = z.infer<typeof OpportunityDetailSchema>;

export interface CreateOpportunityInput {
  readonly venueId: string;
  readonly title: string;
  readonly eventType?: string | null;
  readonly preferredDate?: string | null;
  readonly guestCount?: number | null;
  readonly estimatedValueMinor?: number;
  readonly nextAction?: string;
  readonly nextActionDueAt?: string | null;
}

export async function createOpportunityFromEnquiry(enquiryId: string): Promise<FromEnquiryResult> {
  return api.post(`/crm/from-enquiry/${enquiryId}`, {}, undefined, FromEnquiryResultSchema);
}

export async function getPipeline(): Promise<PipelineSummary> {
  return api.get("/crm/pipeline", PipelineSchema);
}

export async function listOpportunities(stage?: string): Promise<Opportunity[]> {
  const query = stage !== undefined ? `?stage=${encodeURIComponent(stage)}` : "";
  return api.get(`/opportunities${query}`, z.array(OpportunitySchema));
}

export async function createOpportunity(input: CreateOpportunityInput): Promise<OpportunityCreateResult> {
  return api.post("/opportunities", input, undefined, OpportunityCreateResultSchema);
}

export async function getOpportunity(id: string): Promise<OpportunityDetail> {
  return api.get(`/opportunities/${id}`, OpportunityDetailSchema);
}

export async function updateOpportunity(id: string, input: Partial<CreateOpportunityInput> & { readonly stage?: string; readonly note?: string | null }): Promise<Opportunity> {
  return api.patch(`/opportunities/${id}`, input, OpportunitySchema);
}

export async function addOpportunityActivity(id: string, body: string): Promise<Activity> {
  return api.post(`/opportunities/${id}/activities`, { type: "note", body }, undefined, ActivitySchema);
}

export async function addFollowUpTask(id: string, title: string, dueAt?: string | null): Promise<FollowUpTask> {
  return api.post(`/opportunities/${id}/tasks`, { title, dueAt: dueAt ?? null }, undefined, FollowUpTaskSchema);
}

export async function updateFollowUpTaskStatus(opportunityId: string, taskId: string, status: string): Promise<FollowUpTask> {
  return api.patch(`/opportunities/${opportunityId}/tasks/${taskId}`, { status }, FollowUpTaskSchema);
}
