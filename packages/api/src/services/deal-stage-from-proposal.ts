import { and, eq, isNull } from "drizzle-orm";
import type { OpportunityStage } from "@omnitwin/types";
import { opportunities, opportunityStatusHistory } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { nextActionForStage } from "./deal-next-action.js";

// ---------------------------------------------------------------------------
// A proposal's moves move its deal (roadmap X1).
//
// When a proposal is sent, the deal it is for stands at Proposal sent; when
// the client asks for changes, at Negotiation; when they accept or decline
// it, the deal is won or lost, with the client's act as its reason. A deal
// already won, lost or archived is never moved, and no event moves a deal
// backwards. The move is made only if the deal still stands where it was
// read, so two events at once record one move, and the move and its history
// row are written together.
// ---------------------------------------------------------------------------

const OPEN: readonly OpportunityStage[] = ["new", "qualified", "proposal_drafting", "proposal_sent", "negotiation"];

interface DealMove {
  readonly to: OpportunityStage;
  /** The stages this event may move a deal from. */
  readonly from: readonly OpportunityStage[];
  readonly note: (version: string, byClient: boolean) => string;
}

const MOVES: Readonly<Partial<Record<string, DealMove>>> = {
  sent: {
    to: "proposal_sent",
    from: ["new", "qualified", "proposal_drafting", "negotiation"],
    note: (version) => `The proposal${version} was sent.`,
  },
  changes_requested: {
    to: "negotiation",
    from: ["proposal_sent"],
    note: (version, byClient) => byClient
      ? `The client asked for changes to the proposal${version}.`
      : `Changes were asked for on the proposal${version}.`,
  },
  accepted: {
    to: "won",
    from: OPEN,
    note: (version, byClient) => byClient
      ? `The client accepted the proposal${version}.`
      : `The proposal${version} was marked accepted.`,
  },
  declined: {
    to: "lost",
    from: OPEN,
    note: (version, byClient) => byClient
      ? `The client declined the proposal${version}.`
      : `The proposal${version} was marked declined.`,
  },
};

export interface ProposalForDeal {
  readonly venueId: string;
  readonly opportunityId: string | null;
  readonly currentVersion: number;
}

/**
 * Moves the proposal's deal to the stage its new status means, where the deal
 * is open and not already past it. Returns the stage it moved to, or null
 * when it did not move. `actorUserId` is null for the client's own act on the
 * share link.
 */
export async function moveDealWithProposal(
  db: Database,
  proposal: ProposalForDeal,
  toStatus: string,
  actorUserId: string | null,
): Promise<OpportunityStage | null> {
  const move = MOVES[toStatus];
  const dealId = proposal.opportunityId;
  if (move === undefined || dealId === null) return null;

  return db.transaction(async (tx) => {
    const [deal] = await tx.select({ stage: opportunities.stage }).from(opportunities)
      .where(and(eq(opportunities.id, dealId), eq(opportunities.venueId, proposal.venueId), isNull(opportunities.deletedAt)))
      .limit(1);
    const from = deal?.stage as OpportunityStage | undefined;
    if (from === undefined || !move.from.includes(from)) return null;

    const closing = move.to === "won" || move.to === "lost";
    const [moved] = await tx.update(opportunities)
      .set({
        stage: move.to,
        nextAction: nextActionForStage(move.to),
        updatedAt: new Date(),
        ...(closing ? { closedAt: new Date() } : {}),
      })
      // Only from where it was read: a concurrent move wins, and this one is dropped.
      .where(and(eq(opportunities.id, dealId), eq(opportunities.stage, from)))
      .returning({ id: opportunities.id });
    if (moved === undefined) return null;

    const version = proposal.currentVersion > 0 ? ` (version ${String(proposal.currentVersion)})` : "";
    await tx.insert(opportunityStatusHistory).values({
      opportunityId: dealId,
      fromStage: from,
      toStage: move.to,
      changedBy: actorUserId,
      note: move.note(version, actorUserId === null),
    });
    return move.to;
  });
}
