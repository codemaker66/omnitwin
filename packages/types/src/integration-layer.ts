import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-layout-snapshot.js";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import { SpaceIdSchema } from "./space.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// Integration Layer v0
//
// Metadata and guardrails only. No live provider calls are implied by these
// records; credentials are represented as references and are never returned
// from public/client-safe shapes.
// ---------------------------------------------------------------------------

export const INTEGRATION_PROVIDERS = [
  "cvent",
  "salesforce",
  "email",
  "calendar",
  "accounting",
  "e_sign",
  "website_embed",
  "custom_webhook",
] as const;

export const INTEGRATION_CONNECTION_STATUSES = [
  "disabled",
  "pending_setup",
  "active",
  "error",
  "archived",
] as const;

export const INTEGRATION_CREDENTIAL_MODES = ["not_configured", "env_ref", "vault_ref"] as const;
export const WEBHOOK_ENDPOINT_STATUSES = ["disabled", "active", "test_only", "archived"] as const;
export const EMAIL_TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
export const INTEGRATION_EVENT_DIRECTIONS = ["inbound", "outbound"] as const;
export const INTEGRATION_EVENT_STATUSES = ["queued", "stubbed", "sent", "failed", "ignored"] as const;

export const IntegrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const IntegrationConnectionStatusSchema = z.enum(INTEGRATION_CONNECTION_STATUSES);
export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatusSchema>;

export const IntegrationCredentialModeSchema = z.enum(INTEGRATION_CREDENTIAL_MODES);
export type IntegrationCredentialMode = z.infer<typeof IntegrationCredentialModeSchema>;

export const WebhookEndpointStatusSchema = z.enum(WEBHOOK_ENDPOINT_STATUSES);
export type WebhookEndpointStatus = z.infer<typeof WebhookEndpointStatusSchema>;

export const EmailTemplateStatusSchema = z.enum(EMAIL_TEMPLATE_STATUSES);
export type EmailTemplateStatus = z.infer<typeof EmailTemplateStatusSchema>;

export const IntegrationEventDirectionSchema = z.enum(INTEGRATION_EVENT_DIRECTIONS);
export type IntegrationEventDirection = z.infer<typeof IntegrationEventDirectionSchema>;

export const IntegrationEventStatusSchema = z.enum(INTEGRATION_EVENT_STATUSES);
export type IntegrationEventStatus = z.infer<typeof IntegrationEventStatusSchema>;

export const IntegrationConnectionIdSchema = z.string().uuid();
export type IntegrationConnectionId = z.infer<typeof IntegrationConnectionIdSchema>;

export const WebhookEndpointIdSchema = z.string().uuid();
export type WebhookEndpointId = z.infer<typeof WebhookEndpointIdSchema>;

export const ExternalCalendarLinkIdSchema = z.string().uuid();
export type ExternalCalendarLinkId = z.infer<typeof ExternalCalendarLinkIdSchema>;

export const WebsiteEmbedConfigIdSchema = z.string().uuid();
export type WebsiteEmbedConfigId = z.infer<typeof WebsiteEmbedConfigIdSchema>;

export const EmailTemplateIdSchema = z.string().uuid();
export type EmailTemplateId = z.infer<typeof EmailTemplateIdSchema>;

export const IntegrationEventIdSchema = z.string().uuid();
export type IntegrationEventId = z.infer<typeof IntegrationEventIdSchema>;

export const IntegrationConfigSchema = z.record(CanonicalJsonValueSchema);
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

export const IntegrationConnectionRecordSchema = z.object({
  id: IntegrationConnectionIdSchema,
  venueId: VenueIdSchema,
  provider: IntegrationProviderSchema,
  label: SafePlanningWordingSchema,
  status: IntegrationConnectionStatusSchema,
  credentialMode: IntegrationCredentialModeSchema,
  credentialRef: z.string().trim().min(1).max(200).nullable(),
  config: IntegrationConfigSchema,
  healthStatus: SafePlanningWordingSchema,
  lastCheckedAt: z.string().datetime().nullable(),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type IntegrationConnectionRecord = z.infer<typeof IntegrationConnectionRecordSchema>;

export const PublicIntegrationConnectionSchema = IntegrationConnectionRecordSchema.omit({
  credentialRef: true,
}).extend({
  credentialConfigured: z.boolean(),
}).strict();
export type PublicIntegrationConnection = z.infer<typeof PublicIntegrationConnectionSchema>;

export const CreateIntegrationConnectionSchema = z.object({
  venueId: VenueIdSchema,
  provider: IntegrationProviderSchema,
  label: SafePlanningWordingSchema,
  status: IntegrationConnectionStatusSchema.default("pending_setup"),
  credentialMode: IntegrationCredentialModeSchema.default("not_configured"),
  credentialRef: z.string().trim().min(1).max(200).nullable().optional(),
  config: IntegrationConfigSchema.default({}),
}).strict();
export type CreateIntegrationConnection = z.infer<typeof CreateIntegrationConnectionSchema>;

export const UpdateIntegrationConnectionSchema = z.object({
  label: SafePlanningWordingSchema.optional(),
  status: IntegrationConnectionStatusSchema.optional(),
  credentialMode: IntegrationCredentialModeSchema.optional(),
  credentialRef: z.string().trim().min(1).max(200).nullable().optional(),
  config: IntegrationConfigSchema.optional(),
}).strict();
export type UpdateIntegrationConnection = z.infer<typeof UpdateIntegrationConnectionSchema>;

export const WebhookEndpointSchema = z.object({
  id: WebhookEndpointIdSchema,
  venueId: VenueIdSchema,
  integrationConnectionId: IntegrationConnectionIdSchema.nullable(),
  label: SafePlanningWordingSchema,
  url: z.string().url(),
  eventTypes: z.array(z.string().trim().min(1).max(120)).min(1).max(30),
  status: WebhookEndpointStatusSchema,
  signingSecretRef: z.string().trim().min(1).max(200).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

export const PublicWebhookEndpointSchema = WebhookEndpointSchema.omit({
  signingSecretRef: true,
}).extend({
  signingConfigured: z.boolean(),
}).strict();
export type PublicWebhookEndpoint = z.infer<typeof PublicWebhookEndpointSchema>;

export const ExternalCalendarLinkSchema = z.object({
  id: ExternalCalendarLinkIdSchema,
  venueId: VenueIdSchema,
  integrationConnectionId: IntegrationConnectionIdSchema.nullable(),
  calendarLabel: SafePlanningWordingSchema,
  externalCalendarId: z.string().trim().min(1).max(240),
  syncDirection: z.enum(["read_only", "write_outbound", "two_way"]),
  status: IntegrationConnectionStatusSchema,
  lastSyncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type ExternalCalendarLink = z.infer<typeof ExternalCalendarLinkSchema>;

export const WebsiteEmbedConfigSchema = z.object({
  id: WebsiteEmbedConfigIdSchema,
  venueId: VenueIdSchema,
  roomId: SpaceIdSchema.nullable(),
  embedKey: z.string().trim().min(6).max(80),
  venueName: SafePlanningWordingSchema,
  roomName: SafePlanningWordingSchema.nullable(),
  ctaLabel: SafePlanningWordingSchema,
  ctaUrl: z.string().url(),
  safeMode: z.literal(true),
  analyticsMode: z.literal("stub"),
  status: z.enum(["draft", "active", "archived"]),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type WebsiteEmbedConfig = z.infer<typeof WebsiteEmbedConfigSchema>;

export const ClientSafeWebsiteEmbedConfigSchema = z.object({
  embedKey: z.string().trim().min(6).max(80),
  venue: SafePlanningWordingSchema,
  room: SafePlanningWordingSchema.nullable(),
  cta: z.object({
    label: SafePlanningWordingSchema,
    url: z.string().url(),
  }).strict(),
  safeMode: z.literal(true),
  analytics: z.object({
    mode: z.literal("stub"),
    enabled: z.literal(false),
  }).strict(),
  status: z.enum(["draft", "active", "archived"]),
}).strict();
export type ClientSafeWebsiteEmbedConfig = z.infer<typeof ClientSafeWebsiteEmbedConfigSchema>;

export const CreateWebsiteEmbedConfigSchema = z.object({
  venueId: VenueIdSchema,
  roomId: SpaceIdSchema.nullable().optional(),
  ctaLabel: SafePlanningWordingSchema,
  ctaUrl: z.string().url(),
  safeMode: z.literal(true).default(true),
  status: z.enum(["draft", "active"]).default("draft"),
}).strict();
export type CreateWebsiteEmbedConfig = z.infer<typeof CreateWebsiteEmbedConfigSchema>;

export const EmailTemplateSchema = z.object({
  id: EmailTemplateIdSchema,
  venueId: VenueIdSchema.nullable(),
  templateKey: z.string().trim().min(1).max(120),
  label: SafePlanningWordingSchema,
  subjectTemplate: SafePlanningWordingSchema,
  bodyTemplate: z.string().trim().min(1).max(6000),
  status: EmailTemplateStatusSchema,
  managedByCode: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

export const IntegrationEventSchema = z.object({
  id: IntegrationEventIdSchema,
  venueId: VenueIdSchema,
  integrationConnectionId: IntegrationConnectionIdSchema.nullable(),
  direction: IntegrationEventDirectionSchema,
  eventType: z.string().trim().min(1).max(120),
  status: IntegrationEventStatusSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  summary: SafePlanningWordingSchema,
  createdAt: z.string().datetime(),
}).strict();
export type IntegrationEvent = z.infer<typeof IntegrationEventSchema>;

export const WebhookOutboundTestInputSchema = z.object({
  venueId: VenueIdSchema,
  eventType: z.string().trim().min(1).max(120),
  payload: IntegrationConfigSchema,
  signingSecretRef: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();
export type WebhookOutboundTestInput = z.infer<typeof WebhookOutboundTestInputSchema>;

export const WebhookOutboundTestResultSchema = z.object({
  sent: z.literal(false),
  status: z.literal("stubbed"),
  eventType: z.string().trim().min(1).max(120),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  signatureHeader: z.string().trim().min(1).max(220),
  deliveryMode: z.literal("stub_only"),
  disclosure: z.literal("Webhook test was signed locally and not delivered."),
}).strict();
export type WebhookOutboundTestResult = z.infer<typeof WebhookOutboundTestResultSchema>;

export function redactIntegrationConnection(record: IntegrationConnectionRecord): PublicIntegrationConnection {
  const { credentialRef: _credentialRef, ...safeRecord } = record;
  return PublicIntegrationConnectionSchema.parse({
    ...safeRecord,
    credentialConfigured: record.credentialMode !== "not_configured" && record.credentialRef !== null,
  });
}

export function redactWebhookEndpoint(record: WebhookEndpoint): PublicWebhookEndpoint {
  const { signingSecretRef: _signingSecretRef, ...safeRecord } = record;
  return PublicWebhookEndpointSchema.parse({
    ...safeRecord,
    signingConfigured: record.signingSecretRef !== null,
  });
}

export function clientSafeWebsiteEmbedConfig(record: WebsiteEmbedConfig): ClientSafeWebsiteEmbedConfig {
  return ClientSafeWebsiteEmbedConfigSchema.parse({
    embedKey: record.embedKey,
    venue: record.venueName,
    room: record.roomName,
    cta: {
      label: record.ctaLabel,
      url: record.ctaUrl,
    },
    safeMode: true,
    analytics: {
      mode: "stub",
      enabled: false,
    },
    status: record.status,
  });
}

export function integrationPayloadHash(payload: Record<string, CanonicalJsonValue>): string {
  return sha256Hex(`venviewer.integration_payload.v0\n${stableCanonicalJson(payload)}`);
}
