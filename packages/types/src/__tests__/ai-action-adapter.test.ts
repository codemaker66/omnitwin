import { describe, expect, it } from "vitest";
import {
  AI_PROPOSAL_MAX_ACTIONS,
  AIActionProposalSchema,
  acceptProposal,
  dismissProposal,
} from "../ai-action-adapter.js";

// G4 Slice 4: the AI adapter CONTRACT (implementation gated on Phase 8).
// The 01 §12 law, encoded in types: an AI proposes Actions as ghosts —
// nothing applies until a HUMAN OPERATOR's acceptance is recorded. The
// schema makes the illegal states unrepresentable: `accepted` requires a
// recorded operator acceptance, every proposed action carries an `ai`
// actor, and the only transitions out of `proposed` are operator events.

const PROPOSAL = {
  id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  configurationId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
  rationale: "Two tables block the servery line; moving them opens the aisle.",
  proposedActions: [
    {
      id: "1d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
      actor: { kind: "ai" as const, ref: "copilot-v1" },
      intent: "object.update",
      payload: { updated: [{ id: "obj-1", before: { positionX: 1 }, after: { positionX: 3 } }] },
      inverse: { updated: [{ id: "obj-1", before: { positionX: 3 }, after: { positionX: 1 } }] },
      provenance: { surface: "planner", tool: "ai-copilot" },
      ts: "2026-07-18T18:00:00.000Z",
    },
  ],
  status: "proposed" as const,
  createdTs: "2026-07-18T18:00:00.000Z",
  acceptance: null,
};

describe("AIActionProposalSchema", () => {
  it("accepts a well-formed proposed ghost", () => {
    const parsed = AIActionProposalSchema.parse(PROPOSAL);
    expect(parsed.status).toBe("proposed");
    expect(parsed.acceptance).toBeNull();
    expect(AI_PROPOSAL_MAX_ACTIONS).toBeGreaterThan(0);
  });

  it("makes 'accepted without a recorded operator' unrepresentable — both directions", () => {
    expect(AIActionProposalSchema.safeParse({
      ...PROPOSAL,
      status: "accepted",
      acceptance: null, // accepted with nobody accepting — illegal
    }).success).toBe(false);

    expect(AIActionProposalSchema.safeParse({
      ...PROPOSAL,
      status: "proposed",
      acceptance: { // acceptance recorded on a still-proposed ghost — illegal
        acceptedBy: "00000000-0000-4000-8000-000000000099",
        acceptedTs: "2026-07-18T18:05:00.000Z",
      },
    }).success).toBe(false);

    expect(AIActionProposalSchema.safeParse({
      ...PROPOSAL,
      status: "dismissed",
      acceptance: { // a dismissed ghost carrying an acceptance — illegal
        acceptedBy: "00000000-0000-4000-8000-000000000099",
        acceptedTs: "2026-07-18T18:05:00.000Z",
      },
    }).success).toBe(false);

    expect(AIActionProposalSchema.safeParse({
      ...PROPOSAL,
      status: "accepted",
      acceptance: {
        acceptedBy: "00000000-0000-4000-8000-000000000099",
        acceptedTs: "2026-07-18T18:05:00.000Z",
      },
    }).success).toBe(true);
  });

  it("rejects proposals whose actions claim any non-ai actor", () => {
    expect(AIActionProposalSchema.safeParse({
      ...PROPOSAL,
      proposedActions: [{
        ...PROPOSAL.proposedActions[0],
        actor: { kind: "operator", ref: "user-1" }, // an AI may not impersonate
      }],
    }).success).toBe(false);
  });

  it("bounds the proposal: empty and oversized action lists rejected, ingestion caps apply", () => {
    expect(AIActionProposalSchema.safeParse({ ...PROPOSAL, proposedActions: [] }).success).toBe(false);
    const oversized = Array.from({ length: AI_PROPOSAL_MAX_ACTIONS + 1 }, (_, i) => ({
      ...PROPOSAL.proposedActions[0],
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    expect(AIActionProposalSchema.safeParse({ ...PROPOSAL, proposedActions: oversized }).success).toBe(false);
    // The slice-3 ingestion bounds guard proposals too (depth cap shown here).
    let deep: unknown = true;
    for (let i = 0; i < 64; i += 1) deep = { next: deep };
    expect(AIActionProposalSchema.safeParse({
      ...PROPOSAL,
      proposedActions: [{ ...PROPOSAL.proposedActions[0], payload: deep }],
    }).success).toBe(false);
  });
});

describe("proposal transitions (pure operator events)", () => {
  it("acceptProposal stamps the operator and moves proposed → accepted", () => {
    const parsed = AIActionProposalSchema.parse(PROPOSAL);
    const accepted = acceptProposal(parsed, {
      operatorId: "00000000-0000-4000-8000-000000000099",
      now: "2026-07-18T18:05:00.000Z",
    });
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.acceptance?.acceptedBy).toBe("00000000-0000-4000-8000-000000000099");
    expect(AIActionProposalSchema.safeParse(accepted).success).toBe(true);
  });

  it("transitions only leave 'proposed' — accepted/dismissed ghosts are settled", () => {
    const parsed = AIActionProposalSchema.parse(PROPOSAL);
    const dismissed = dismissProposal(parsed);
    expect(dismissed?.status).toBe("dismissed");
    expect(dismissed !== null && acceptProposal(dismissed, {
      operatorId: "00000000-0000-4000-8000-000000000099",
      now: "2026-07-18T18:06:00.000Z",
    })).toBeNull();
    const accepted = acceptProposal(parsed, {
      operatorId: "00000000-0000-4000-8000-000000000099",
      now: "2026-07-18T18:05:00.000Z",
    });
    expect(accepted !== null && dismissProposal(accepted)).toBeNull();
  });
});
