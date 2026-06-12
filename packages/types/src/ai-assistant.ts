import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-layout-snapshot.js";
import {
  findUnsafePublicClaim,
  safePlanningLanguage,
  SafePlanningWordingSchema,
  UNSAFE_PUBLIC_CLAIM_PHRASES,
} from "./evidence-runtime.js";

// ---------------------------------------------------------------------------
// AI Assistant Foundation v0
//
// Draft-only AI help. Output is never authority, never sent automatically, and
// always carries unverified + human-review metadata.
// ---------------------------------------------------------------------------

export const AI_ASSISTANT_SCHEMA_VERSION = "ai_assistant.v0";
export const AI_DRAFT_DIGEST_DOMAIN_PREFIX = "venviewer.ai_draft.v0\n";

export const AI_DRAFT_USE_CASES = [
  "enquiry_summary",
  "lead_qualification",
  "proposal_draft",
  "beo_supplier_instruction_draft",
  "route_conflict_explanation",
  "truth_mode_explanation",
] as const;

export const AI_DRAFT_PROVENANCE = ["ai_generated"] as const;
export const AI_DRAFT_EVIDENCE_STATUSES = ["unverified"] as const;
export const AI_DRAFT_SEND_STATES = ["draft_only"] as const;

export const AIDraftUseCaseSchema = z.enum(AI_DRAFT_USE_CASES);
export type AIDraftUseCase = z.infer<typeof AIDraftUseCaseSchema>;

export const AIDraftProvenanceSchema = z.enum(AI_DRAFT_PROVENANCE);
export type AIDraftProvenance = z.infer<typeof AIDraftProvenanceSchema>;

export const AIDraftEvidenceStatusSchema = z.enum(AI_DRAFT_EVIDENCE_STATUSES);
export type AIDraftEvidenceStatus = z.infer<typeof AIDraftEvidenceStatusSchema>;

export const AIDraftSendStateSchema = z.enum(AI_DRAFT_SEND_STATES);
export type AIDraftSendState = z.infer<typeof AIDraftSendStateSchema>;

export const AIDraftContextSchema = z.record(CanonicalJsonValueSchema);
export type AIDraftContext = z.infer<typeof AIDraftContextSchema>;

export const CreateAIDraftRequestSchema = z.object({
  useCase: AIDraftUseCaseSchema,
  context: AIDraftContextSchema,
  requestedTone: SafePlanningWordingSchema.optional(),
}).strict();
export type CreateAIDraftRequest = z.infer<typeof CreateAIDraftRequestSchema>;

export const AIAssistantStatusSchema = z.object({
  configured: z.boolean(),
  provider: z.string().trim().min(1).max(80).nullable(),
  model: z.string().trim().min(1).max(120).nullable(),
  disabledReason: SafePlanningWordingSchema.nullable(),
}).strict();
export type AIAssistantStatus = z.infer<typeof AIAssistantStatusSchema>;

export const AIDraftSchema = z.object({
  schemaVersion: z.literal(AI_ASSISTANT_SCHEMA_VERSION),
  useCase: AIDraftUseCaseSchema,
  title: SafePlanningWordingSchema,
  body: z.string().trim().min(1).max(8000).superRefine((text, ctx) => {
    const unsafe = findUnsafePublicClaim(text);
    if (unsafe !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsafe public/client claim phrase "${unsafe}" is not allowed in AI draft output.`,
      });
    }
  }),
  blockedUnsafeClaims: z.array(z.enum(UNSAFE_PUBLIC_CLAIM_PHRASES)).max(20),
  safeLanguageApplied: z.boolean(),
  humanReviewRequired: z.literal(true),
  provenance: z.literal("ai_generated"),
  evidenceStatus: z.literal("unverified"),
  sendState: z.literal("draft_only"),
  generatedAt: z.string().datetime(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AIDraft = z.infer<typeof AIDraftSchema>;

function escapedPhrase(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function findUnsafeAIDraftClaims(text: string): readonly (typeof UNSAFE_PUBLIC_CLAIM_PHRASES)[number][] {
  const matches: (typeof UNSAFE_PUBLIC_CLAIM_PHRASES)[number][] = [];
  for (const phrase of UNSAFE_PUBLIC_CLAIM_PHRASES) {
    const pattern = new RegExp(`\\b${escapedPhrase(phrase)}\\b`, "iu");
    if (pattern.test(text)) matches.push(phrase);
  }
  return matches;
}

export function sanitizeAIDraftText(text: string): {
  readonly text: string;
  readonly blockedUnsafeClaims: readonly (typeof UNSAFE_PUBLIC_CLAIM_PHRASES)[number][];
  readonly safeLanguageApplied: boolean;
} {
  const blockedUnsafeClaims = findUnsafeAIDraftClaims(text);
  const safeText = safePlanningLanguage(text);
  return {
    text: safeText,
    blockedUnsafeClaims,
    safeLanguageApplied: safeText !== text || blockedUnsafeClaims.length > 0,
  };
}

export function aiDraftDigest(input: {
  readonly useCase: AIDraftUseCase;
  readonly title: string;
  readonly body: string;
  readonly context: Record<string, CanonicalJsonValue>;
  readonly generatedAt: string;
}): string {
  return sha256Hex(`${AI_DRAFT_DIGEST_DOMAIN_PREFIX}${stableCanonicalJson(input)}`);
}

export function createReviewGatedAIDraft(input: {
  readonly useCase: AIDraftUseCase;
  readonly title: string;
  readonly body: string;
  readonly context: Record<string, CanonicalJsonValue>;
  readonly generatedAt: string;
}): AIDraft {
  const title = safePlanningLanguage(input.title);
  const sanitized = sanitizeAIDraftText(input.body);
  return AIDraftSchema.parse({
    schemaVersion: AI_ASSISTANT_SCHEMA_VERSION,
    useCase: input.useCase,
    title,
    body: sanitized.text,
    blockedUnsafeClaims: sanitized.blockedUnsafeClaims,
    safeLanguageApplied: sanitized.safeLanguageApplied || title !== input.title,
    humanReviewRequired: true,
    provenance: "ai_generated",
    evidenceStatus: "unverified",
    sendState: "draft_only",
    generatedAt: input.generatedAt,
    digest: aiDraftDigest({
      useCase: input.useCase,
      title,
      body: sanitized.text,
      context: input.context,
      generatedAt: input.generatedAt,
    }),
  });
}
