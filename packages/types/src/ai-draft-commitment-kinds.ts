import { z } from "zod";

// The kinds of commitment an AI draft may not make on its own (Plan 19 L6).
// They live apart from the filter that finds them (ai-draft-commitments.ts,
// served as @omnitwin/types/ai-draft-review) so a schema that names a kind does
// not load the filter: it is large, and every page importing the types index
// would fetch it in the dev graph the Twin's byte budget measures.
export const AI_DRAFT_COMMITMENT_KINDS = ["price", "availability", "capacity"] as const;
export const AIDraftCommitmentKindSchema = z.enum(AI_DRAFT_COMMITMENT_KINDS);
export type AIDraftCommitmentKind = z.infer<typeof AIDraftCommitmentKindSchema>;
