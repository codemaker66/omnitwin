import type { CanonicalJsonValue } from "./canonical-layout-snapshot.js";
import { safePlanningLanguage } from "./evidence-runtime.js";
import {
  AI_ASSISTANT_SCHEMA_VERSION,
  AIDraftSchema,
  aiDraftDigest,
  sanitizeAIDraftText,
  type AIDraft,
  type AIDraftUseCase,
} from "./ai-assistant.js";
import { canonicalDraftText, withholdDraftCommitments } from "./ai-draft-commitments.js";

// ---------------------------------------------------------------------------
// Making a review-gated AI draft, and the commitment filter it runs (Plan 19
// L6). Served as @omnitwin/types/ai-draft-review, not from the index: the
// filter is large, and every page importing the types index (the Twin's /tour
// among them) would fetch it in the dev graph its byte budget measures. Only
// the API makes drafts.
// ---------------------------------------------------------------------------

export {
  canonicalDraftText,
  draftLeftAfterWithholding,
  findDraftCommitments,
  MIN_WORDS_LEFT_AFTER_WITHHOLDING,
  sentencesOf,
  withholdDraftCommitments,
  type AIDraftCommitment,
} from "./ai-draft-commitments.js";

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
