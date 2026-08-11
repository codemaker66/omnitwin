import { describe, expect, it } from "vitest";
import { AIActionProposalSchema } from "@omnitwin/types";
import { adviseLayout, type AdvisorItem } from "../layout-advisor.js";

// ---------------------------------------------------------------------------
// The advisor — the copilot's engine. DETERMINISTIC BY CHOICE: every
// proposal is derived from geometry the operator can check, so it can be
// explained, replayed and argued with. A language model cannot promise that,
// and for a room where the answer affects egress, "trust me" is not a
// product.
//
// It only ever PROPOSES. Every proposal is an AIActionProposal whose actions
// carry an `ai` actor, so nothing it emits can be applied without a recorded
// operator acceptance (the 01 §12 law lives in the type, not in this file's
// good intentions).
// ---------------------------------------------------------------------------

const seqIds = (): (() => string) => {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
};

const CTX = {
  configurationId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
  advisorRef: "advisor-v1",
  now: () => "2026-07-28T10:00:00.000Z",
  makeId: seqIds(),
};

function item(id: string, x: number, z: number, over: Partial<AdvisorItem> = {}): AdvisorItem {
  return { id, kind: "table-round", x, z, radiusM: 0.75, ...over };
}

describe("adviseLayout — clearance", () => {
  it("proposes nothing when the room is comfortably spaced", () => {
    const result = adviseLayout([item("a", 0, 0), item("b", 5, 0)], { ...CTX, minClearanceM: 1.2 });
    expect(result.proposals).toEqual([]);
    expect(result.checked).toBe(1); // one pair examined
  });

  it("flags a pair closer than the clearance guidance and proposes moving one apart", () => {
    // Centres 2.0m apart, radii 0.75 each => gap 0.5m, guidance 1.2m.
    const result = adviseLayout([item("a", 0, 0), item("b", 2, 0)], { ...CTX, minClearanceM: 1.2 });
    expect(result.proposals).toHaveLength(1);

    const proposal = result.proposals[0];
    if (proposal === undefined) throw new Error("expected a proposal");
    expect(AIActionProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal.status).toBe("proposed");
    expect(proposal.acceptance).toBeNull();
    expect(proposal.proposedActions).toHaveLength(1);
    expect(proposal.proposedActions[0]?.actor).toEqual({ kind: "ai", ref: "advisor-v1" });
    expect(proposal.proposedActions[0]?.intent).toBe("object.update");
  });

  it("moves the pair to EXACTLY the guidance gap, along the line between them", () => {
    const result = adviseLayout([item("a", 0, 0), item("b", 2, 0)], { ...CTX, minClearanceM: 1.2 });
    const action = result.proposals[0]?.proposedActions[0];
    if (action === undefined) throw new Error("expected an action");
    const payload = action.payload as { updated: { id: string; after: { positionX: number; positionZ: number } }[] };
    const patch = payload.updated[0];
    if (patch === undefined) throw new Error("expected a patch");
    // Needed centre distance = 1.2 + 0.75 + 0.75 = 2.7; it must move 0.7m
    // further out along +X, and not drift on Z.
    expect(patch.id).toBe("b");
    expect(patch.after.positionX).toBeCloseTo(2.7, 5);
    expect(patch.after.positionZ).toBeCloseTo(0, 5);
  });

  it("carries a true inverse — accepting then undoing restores the original position", () => {
    const result = adviseLayout([item("a", 0, 0), item("b", 2, 0)], { ...CTX, minClearanceM: 1.2 });
    const action = result.proposals[0]?.proposedActions[0];
    if (action === undefined) throw new Error("expected an action");
    const inverse = action.inverse as { updated: { id: string; after: { positionX: number } }[] };
    expect(inverse.updated[0]?.id).toBe("b");
    expect(inverse.updated[0]?.after.positionX).toBeCloseTo(2, 5);
  });

  it("states its reasoning in claim-safe language — guidance, never a safety verdict", () => {
    const result = adviseLayout([item("a", 0, 0), item("b", 2, 0)], { ...CTX, minClearanceM: 1.2 });
    const rationale = result.proposals[0]?.rationale ?? "";
    expect(rationale).toContain("0.50m");
    expect(rationale).toContain("1.20m");
    expect(rationale.toLowerCase()).toContain("review");
    // It must never assert safety, compliance, or a fire determination.
    for (const banned of ["safe", "compliant", "approved", "guarantee"]) {
      expect(rationale.toLowerCase()).not.toContain(banned);
    }
  });

  it("is deterministic and order-independent — the same room yields the same advice", () => {
    const forward = adviseLayout([item("a", 0, 0), item("b", 2, 0), item("c", 9, 9)], {
      ...CTX,
      minClearanceM: 1.2,
      makeId: seqIds(),
    });
    const reversed = adviseLayout([item("c", 9, 9), item("b", 2, 0), item("a", 0, 0)], {
      ...CTX,
      minClearanceM: 1.2,
      makeId: seqIds(),
    });
    const ids = (r: typeof forward): string[] =>
      r.proposals.flatMap((p) => p.proposedActions.map((a) => {
        const payload = a.payload as { updated?: { id: string }[] };
        return payload.updated?.[0]?.id ?? "";
      }));
    expect(ids(reversed)).toEqual(ids(forward));
  });

  it("never proposes moving an object that cannot move (a fixed feature)", () => {
    const result = adviseLayout(
      [item("stage", 0, 0, { fixed: true }), item("b", 2, 0)],
      { ...CTX, minClearanceM: 1.2, makeId: seqIds() },
    );
    const moved = result.proposals[0]?.proposedActions[0]?.payload as { updated: { id: string }[] } | undefined;
    expect(moved?.updated[0]?.id).toBe("b"); // the movable one yields, never the stage
  });

  it("reports honestly when it cannot resolve a pair rather than inventing a move", () => {
    const result = adviseLayout(
      [item("stage", 0, 0, { fixed: true }), item("pillar", 1, 0, { fixed: true })],
      { ...CTX, minClearanceM: 1.2, makeId: seqIds() },
    );
    expect(result.proposals).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain("both fixed");
  });
});

describe("adviseLayout — orphaned seating", () => {
  it("flags a chair stranded far from any table and proposes removing it", () => {
    const result = adviseLayout(
      [item("t1", 0, 0), item("c1", 0.9, 0, { kind: "chair", radiusM: 0.25 }), item("c2", 12, 12, { kind: "chair", radiusM: 0.25 })],
      { ...CTX, minClearanceM: 0.1, orphanRadiusM: 2, makeId: seqIds() },
    );
    const orphan = result.proposals.find((p) => p.rationale.includes("no table within"));
    expect(orphan).toBeDefined();
    const action = orphan?.proposedActions[0];
    expect(action?.intent).toBe("object.remove");
    const payload = action?.payload as { removed: { object: { id: string } }[] };
    expect(payload.removed[0]?.object.id).toBe("c2");
    // Removal must be undoable: the inverse puts the chair back.
    const inverse = action?.inverse as { added: { object: { id: string } }[] };
    expect(inverse.added[0]?.object.id).toBe("c2");
  });

  it("leaves a chair tucked at its table alone", () => {
    const result = adviseLayout(
      [item("t1", 0, 0), item("c1", 0.9, 0, { kind: "chair", radiusM: 0.25 })],
      { ...CTX, minClearanceM: 0.1, orphanRadiusM: 2, makeId: seqIds() },
    );
    expect(result.proposals.filter((p) => p.rationale.includes("no table within"))).toEqual([]);
  });
});

describe("adviseLayout — the law", () => {
  it("every proposal it emits is unapplied and carries only ai-authored actions", () => {
    const result = adviseLayout(
      [item("a", 0, 0), item("b", 2, 0), item("c", 2.4, 0), item("far", 20, 20, { kind: "chair", radiusM: 0.25 })],
      { ...CTX, minClearanceM: 1.2, orphanRadiusM: 2, makeId: seqIds() },
    );
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const proposal of result.proposals) {
      expect(AIActionProposalSchema.safeParse(proposal).success).toBe(true);
      expect(proposal.status).toBe("proposed");
      expect(proposal.acceptance).toBeNull();
      for (const action of proposal.proposedActions) {
        expect(action.actor.kind).toBe("ai");
        expect(action.provenance.tool).toBe("layout-advisor");
        expect(action.inverse).not.toBeNull();
      }
    }
  });

  it("an empty room produces no advice and says so without ceremony", () => {
    const result = adviseLayout([], { ...CTX, minClearanceM: 1.2, makeId: seqIds() });
    expect(result.proposals).toEqual([]);
    expect(result.checked).toBe(0);
    expect(result.unresolved).toEqual([]);
  });
});
