import { z } from "zod";
import {
  boundedJsonObjectSchema,
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
import { AIDraftCommitmentKindSchema, canonicalDraftText, withholdDraftCommitments } from "./ai-draft-commitments.js";

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

export const AIDraftContextSchema = z.record(z.string(), CanonicalJsonValueSchema);
export type AIDraftContext = z.infer<typeof AIDraftContextSchema>;

/** The most a draft's context may hold, as canonical JSON. The largest the
 *  server builds (a proposal's message: the client's words and latest
 *  message, 2,000 characters each, with the event's facts) is under 5,000;
 *  this bounds what a screen can send to be scrubbed and sent on. */
export const MAX_AI_DRAFT_CONTEXT_CHARACTERS = 16_000;

/** The most an AI draft request's context may hold, as JSON, checked before
 *  the parse walks it (#278). */
export const AI_DRAFT_CONTEXT_MAX_BYTES = 32 * 1024;

export const CreateAIDraftRequestSchema = z.object({
  useCase: AIDraftUseCaseSchema,
  context: boundedJsonObjectSchema(AI_DRAFT_CONTEXT_MAX_BYTES).refine(
    (context) => stableCanonicalJson(context).length <= MAX_AI_DRAFT_CONTEXT_CHARACTERS,
    { message: `A draft's context may hold at most ${String(MAX_AI_DRAFT_CONTEXT_CHARACTERS)} characters.` },
  ),
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
        code: "custom",
        message: `Unsafe public/client claim phrase "${unsafe}" is not allowed in AI draft output.`,
      });
    }
  }),
  blockedUnsafeClaims: z.array(z.enum(UNSAFE_PUBLIC_CLAIM_PHRASES)).max(20),
  /** The kinds of claim taken out of the model's words: a sentence stating a
   *  price, availability or capacity. Present only when something was, so a
   *  web build from before it still reads every draft that took nothing out. */
  withheldCommitments: z.array(AIDraftCommitmentKindSchema).min(1).max(3).optional(),
  safeLanguageApplied: z.boolean(),
  humanReviewRequired: z.literal(true),
  provenance: z.literal("ai_generated"),
  evidenceStatus: z.literal("unverified"),
  sendState: z.literal("draft_only"),
  generatedAt: z.iso.datetime(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AIDraft = z.infer<typeof AIDraftSchema>;

/** An AI draft of a proposal's message to its client, with what the server
 *  gave the AI to draw on, so the screen claims only what was used: the
 *  event's details, the client's enquiry, the client's latest words on the
 *  proposal. */
export const ProposalMessageDraftSchema = z.object({
  draft: AIDraftSchema,
  drewOn: z.object({
    event: z.boolean(),
    enquiry: z.boolean(),
    clientWords: z.boolean(),
  }).strict(),
}).strict();
export type ProposalMessageDraft = z.infer<typeof ProposalMessageDraftSchema>;

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

/**
 * The model's words as a draft people review: unsupported certainty replaced,
 * every sentence stating a price, availability or capacity taken out, and the
 * draft marked AI-written, unverified and never sent. Throws (the body is
 * empty) when nothing is left once the claims are out.
 *
 * The claims are taken out here, where every draft is made, and not checked
 * again where a draft is read: the web and the API deploy apart, and a page
 * open since an earlier build would otherwise refuse drafts that a later
 * check passed. Taking out reads the words last, so what it passes is what
 * the draft says. The words are made canonical first (canonicalDraftText: no
 * character that shows nothing, plain digits and signs), and the draft holds
 * the canonical words, so what the booker and the client read is what was
 * checked, for unsafe wording and for claims alike.
 */
export function createReviewGatedAIDraft(input: {
  readonly useCase: AIDraftUseCase;
  readonly title: string;
  readonly body: string;
  readonly context: Record<string, CanonicalJsonValue>;
  readonly generatedAt: string;
}): AIDraft {
  const title = safePlanningLanguage(input.title);
  const sanitized = sanitizeAIDraftText(canonicalDraftText(input.body));
  const withheld = withholdDraftCommitments(sanitized.text);
  return AIDraftSchema.parse({
    schemaVersion: AI_ASSISTANT_SCHEMA_VERSION,
    useCase: input.useCase,
    title,
    body: withheld.text,
    blockedUnsafeClaims: sanitized.blockedUnsafeClaims,
    ...(withheld.withheld.length > 0 ? { withheldCommitments: [...withheld.withheld] } : {}),
    safeLanguageApplied: sanitized.safeLanguageApplied || title !== input.title,
    humanReviewRequired: true,
    provenance: "ai_generated",
    evidenceStatus: "unverified",
    sendState: "draft_only",
    generatedAt: input.generatedAt,
    digest: aiDraftDigest({
      useCase: input.useCase,
      title,
      body: withheld.text,
      context: input.context,
      generatedAt: input.generatedAt,
    }),
  });
}
