import { createHmac } from "node:crypto";
import {
  WebhookOutboundTestResultSchema,
  clientSafeWebsiteEmbedConfig,
  integrationPayloadHash,
  redactIntegrationConnection,
  redactWebhookEndpoint,
  type EmailTemplate,
  type IntegrationConnectionRecord,
  type IntegrationConfig,
  type PublicIntegrationConnection,
  type PublicWebhookEndpoint,
  type WebhookEndpoint,
  type WebhookOutboundTestResult,
  type WebsiteEmbedConfig,
  type ClientSafeWebsiteEmbedConfig,
} from "@omnitwin/types";

export interface ManagedEmailTemplateSeed {
  readonly templateKey: string;
  readonly label: string;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
}

export const MANAGED_EMAIL_TEMPLATE_SEEDS: readonly ManagedEmailTemplateSeed[] = [
  {
    templateKey: "new_enquiry_notification",
    label: "New enquiry notification",
    subjectTemplate: "New enquiry for {{spaceName}}",
    bodyTemplate: "Internal notification for venue staff. Includes contact, event date, guest count, and dashboard link.",
  },
  {
    templateKey: "enquiry_approved",
    label: "Enquiry approved",
    subjectTemplate: "Your enquiry for {{spaceName}} has been approved",
    bodyTemplate: "Planner/client update prepared by the venue team. Final arrangements remain with venue staff.",
  },
  {
    templateKey: "configuration_submitted",
    label: "Layout review requested",
    subjectTemplate: "Layout submitted for review - {{eventName}}",
    bodyTemplate: "Internal review notification for a submitted layout snapshot.",
  },
  {
    templateKey: "hallkeeper_notified",
    label: "Hallkeeper notified",
    subjectTemplate: "Event handoff ready - {{eventName}}",
    bodyTemplate: "Internal event handoff notification with a link to the hallkeeper sheet.",
  },
];

export function publicIntegrationConnection(record: IntegrationConnectionRecord): PublicIntegrationConnection {
  return redactIntegrationConnection(record);
}

export function publicWebhookEndpoint(record: WebhookEndpoint): PublicWebhookEndpoint {
  return redactWebhookEndpoint(record);
}

export function safeEmbedConfig(record: WebsiteEmbedConfig): ClientSafeWebsiteEmbedConfig {
  return clientSafeWebsiteEmbedConfig(record);
}

export function createWebhookSignatureStub(input: {
  readonly eventType: string;
  readonly payload: IntegrationConfig;
  readonly signingSecretRef: string | null;
}): WebhookOutboundTestResult {
  const payloadHash = integrationPayloadHash(input.payload);
  const secretMaterial = input.signingSecretRef ?? "venviewer-webhook-stub-secret-reference";
  const signature = createHmac("sha256", secretMaterial)
    .update(`${input.eventType}.${payloadHash}`)
    .digest("hex");
  return WebhookOutboundTestResultSchema.parse({
    sent: false,
    status: "stubbed",
    eventType: input.eventType,
    payloadHash,
    signatureHeader: `t=0,v1=${signature},mode=stub`,
    deliveryMode: "stub_only",
    disclosure: "Webhook test was signed locally and not delivered.",
  });
}

export function managedTemplateSeedToEmailTemplate(seed: ManagedEmailTemplateSeed, input: {
  readonly id: string;
  readonly venueId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}): EmailTemplate {
  return {
    id: input.id,
    venueId: input.venueId,
    templateKey: seed.templateKey,
    label: seed.label,
    subjectTemplate: seed.subjectTemplate,
    bodyTemplate: seed.bodyTemplate,
    status: "active",
    managedByCode: true,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}
