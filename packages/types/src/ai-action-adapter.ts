import { z } from "zod";
import { ISO_DATE_TIME } from "./action.js";
import { BoundedActionSchema } from "./action-log-batch.js";

// ---------------------------------------------------------------------------
// AI action adapter — G4 Slice 4 CONTRACT ONLY (implementation gated on
// Phase 8). The 01 §12 law, encoded so illegal states are unrepresentable:
//
//   An AI proposes Actions as GHOSTS. Nothing applies until a human
//   operator's acceptance is recorded. Ever.
//
// Concretely: `accepted` status and a recorded operator acceptance imply
// each other (both directions enforced); every proposed action must carry
// an `ai` actor (an AI may not attribute work to an operator); ghost
// actions obey the same ingestion bounds as the audit log; and the only
// transitions out of `proposed` are the pure operator events below —
// settled proposals (accepted or dismissed) never transition again.
// ---------------------------------------------------------------------------

export const AI_PROPOSAL_MAX_ACTIONS = 50;

export const AI_PROPOSAL_STATUSES = ["proposed", "accepted", "dismissed"] as const;
export type AIProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number];

/** The recorded operator event — who accepted the ghost, and when. */
const ProposalAcceptanceSchema = z
  .object({
    acceptedBy: z.string().uuid(),
    acceptedTs: z.string().regex(ISO_DATE_TIME, "acceptedTs must be an ISO datetime."),
  })
  .strict();

const ProposalBaseShape = {
  id: z.string().uuid(),
  configurationId: z.string().uuid(),
  /** Human-readable why — surfaced verbatim next to the ghosts. */
  rationale: z.string().trim().min(1).max(2000),
  proposedActions: z
    .array(BoundedActionSchema)
    .min(1)
    .max(AI_PROPOSAL_MAX_ACTIONS)
    .superRefine((actions, ctx) => {
      for (const [index, action] of actions.entries()) {
        if (action.actor.kind !== "ai") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "proposed actions must carry an ai actor — an AI may not attribute work to anyone else",
            path: [index, "actor", "kind"],
          });
        }
      }
    }),
  createdTs: z.string().regex(ISO_DATE_TIME, "createdTs must be an ISO datetime."),
};

/** A discriminated union, not a refine: the `accepted ⟺ recorded operator
 *  acceptance` law lives in the INFERRED TYPE itself, so a hand-constructed
 *  `{ ...proposed, status: "accepted" }` fails to typecheck — Phase 8's
 *  apply path can trust the static type, not just the parse boundary. */
export const AIActionProposalSchema = z.discriminatedUnion("status", [
  z.object({ ...ProposalBaseShape, status: z.literal("proposed"), acceptance: z.null() }).strict(),
  z.object({ ...ProposalBaseShape, status: z.literal("accepted"), acceptance: ProposalAcceptanceSchema }).strict(),
  z.object({ ...ProposalBaseShape, status: z.literal("dismissed"), acceptance: z.null() }).strict(),
]);
export type AIActionProposal = z.infer<typeof AIActionProposalSchema>;

/** The operator accepts the ghosts. Only a `proposed` ghost can be
 *  accepted; settled proposals return null. Pure — the caller applies the
 *  actions (and logs them) separately, which is what keeps the law honest:
 *  acceptance is recorded BEFORE anything mutates. */
export function acceptProposal(
  proposal: AIActionProposal,
  event: { readonly operatorId: string; readonly now: string },
): AIActionProposal | null {
  if (proposal.status !== "proposed") return null;
  return {
    ...proposal,
    status: "accepted",
    acceptance: { acceptedBy: event.operatorId, acceptedTs: event.now },
  };
}

/** The operator waves the ghosts away. Only from `proposed`; pure. */
export function dismissProposal(proposal: AIActionProposal): AIActionProposal | null {
  if (proposal.status !== "proposed") return null;
  return { ...proposal, status: "dismissed" };
}
