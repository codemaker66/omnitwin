import { describe, expect, it } from "vitest";
import {
  computeHoldReminderInstants,
  resequenceHolds,
  resequenceLaddersAfterExit,
  type LadderHold,
  type WindowedLadderHold,
} from "../../services/hold-hygiene.js";

// ---------------------------------------------------------------------------
// Hold hygiene (T-491; Canon §3 — the wedge).
//
// resequenceHolds is the pure core of "auto re-sequencing on release with a
// human ping": given the SURVIVING active holds of a contested slot, it
// reassigns contiguous ranks, preserves joint ties, and names who was
// promoted to 1st option so the caller can tell a human.
// ---------------------------------------------------------------------------

function hold(
  id: string,
  rank: number | null,
  overrides: Partial<LadderHold> = {},
): LadderHold {
  return {
    id,
    title: `Hold ${id}`,
    ownerUserId: `owner-${id}`,
    rank,
    jointFlag: false,
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("resequenceHolds", () => {
  it("promotes the ladder when the first option departs", () => {
    const result = resequenceHolds([hold("b", 2), hold("c", 3)]);
    expect(result.changes).toEqual([
      { id: "b", fromRank: 2, toRank: 1 },
      { id: "c", fromRank: 3, toRank: 2 },
    ]);
    expect(result.promotedToFirst).toEqual([
      { id: "b", title: "Hold b", ownerUserId: "owner-b" },
    ]);
  });

  it("leaves an already-correct ladder untouched", () => {
    const result = resequenceHolds([hold("a", 1), hold("b", 2)]);
    expect(result.changes).toEqual([]);
    expect(result.promotedToFirst).toEqual([]);
  });

  it("closes a mid-ladder gap without promoting anyone to first", () => {
    const result = resequenceHolds([hold("a", 1), hold("c", 3)]);
    expect(result.changes).toEqual([{ id: "c", fromRank: 3, toRank: 2 }]);
    expect(result.promotedToFirst).toEqual([]);
  });

  it("keeps joint ties sharing one rank", () => {
    const result = resequenceHolds([
      hold("a", 1),
      hold("j1", 2, { jointFlag: true }),
      hold("j2", 2, { jointFlag: true }),
      hold("d", 4),
    ]);
    expect(result.changes).toEqual([{ id: "d", fromRank: 4, toRank: 3 }]);
    expect(result.promotedToFirst).toEqual([]);
  });

  it("promotes a joint pair to joint first together", () => {
    const result = resequenceHolds([
      hold("j1", 2, { jointFlag: true }),
      hold("j2", 2, { jointFlag: true }),
      hold("c", 3),
    ]);
    expect(result.changes).toEqual([
      { id: "j1", fromRank: 2, toRank: 1 },
      { id: "j2", fromRank: 2, toRank: 1 },
      { id: "c", fromRank: 3, toRank: 2 },
    ]);
    expect(result.promotedToFirst).toEqual([
      { id: "j1", title: "Hold j1", ownerUserId: "owner-j1" },
      { id: "j2", title: "Hold j2", ownerUserId: "owner-j2" },
    ]);
  });

  it("separates same-rank holds that are NOT flagged joint (data repair)", () => {
    const older = hold("old", 2, { createdAt: new Date("2026-06-01T10:00:00.000Z") });
    const newer = hold("new", 2, { createdAt: new Date("2026-06-20T10:00:00.000Z") });
    const result = resequenceHolds([newer, older]);
    // "new" keeps rank 2 after the repair, so only "old" appears as a change.
    expect(result.changes).toEqual([{ id: "old", fromRank: 2, toRank: 1 }]);
    expect(result.promotedToFirst).toEqual([
      { id: "old", title: "Hold old", ownerUserId: "owner-old" },
    ]);
  });

  it("sends unranked holds to the back of the ladder by creation time", () => {
    const result = resequenceHolds([
      hold("unranked-late", null, { createdAt: new Date("2026-07-02T10:00:00.000Z") }),
      hold("ranked", 2),
      hold("unranked-early", null, { createdAt: new Date("2026-06-15T10:00:00.000Z") }),
    ]);
    expect(result.changes).toEqual([
      { id: "ranked", fromRank: 2, toRank: 1 },
      { id: "unranked-early", fromRank: null, toRank: 2 },
      { id: "unranked-late", fromRank: null, toRank: 3 },
    ]);
  });

  it("a sole surviving unranked hold becomes first option", () => {
    const result = resequenceHolds([hold("only", null, { ownerUserId: null })]);
    expect(result.changes).toEqual([{ id: "only", fromRank: null, toRank: 1 }]);
    expect(result.promotedToFirst).toEqual([
      { id: "only", title: "Hold only", ownerUserId: null },
    ]);
  });

  it("returns nothing for an empty ladder", () => {
    expect(resequenceHolds([])).toEqual({ changes: [], promotedToFirst: [] });
  });

  it("is deterministic for identical createdAt (id tiebreak)", () => {
    const a = hold("aa", null);
    const b = hold("bb", null);
    const forward = resequenceHolds([a, b]);
    const reversed = resequenceHolds([b, a]);
    expect(forward).toEqual(reversed);
    expect(forward.changes[0]?.id).toBe("aa");
  });
});

describe("resequenceLaddersAfterExit (connected-component ladder scope)", () => {
  const day = (hour: number, minute = 0): Date =>
    new Date(Date.UTC(2026, 8, 18, hour, minute));

  function windowed(
    id: string,
    rank: number | null,
    startHour: number,
    endHour: number,
    overrides: Partial<WindowedLadderHold> = {},
  ): WindowedLadderHold {
    return {
      ...hold(id, rank),
      startsAt: day(startHour),
      endsAt: day(endHour),
      ...overrides,
    };
  }

  it("promotes through an overlap chain even when the tail never touched the departed hold", () => {
    // Departed H1 09:00–11:00. H2 (10:30–13:00) overlapped it; H3
    // (12:30–14:00) overlaps only H2. All three form one contested slot —
    // the ladder must stay contiguous: H2→1, H3→2.
    const result = resequenceLaddersAfterExit(
      [windowed("h2", 2, 10, 13, { startsAt: day(10, 30) }), windowed("h3", 3, 12, 14, { startsAt: day(12, 30) })],
      { startsAt: day(9), endsAt: day(11) },
    );
    expect(result.changes).toEqual([
      { id: "h2", fromRank: 2, toRank: 1 },
      { id: "h3", fromRank: 3, toRank: 2 },
    ]);
    expect(result.promotedToFirst.map((p) => p.id)).toEqual(["h2"]);
  });

  it("splits disjoint survivor clusters into independent ladders, each with its own first option", () => {
    // Departed hold spanned 09:00–14:00 and was the only bridge between a
    // morning hold (09:00–10:00) and an afternoon hold (13:00–14:00). After
    // the exit they contest nothing — each becomes 1st option of its own slot.
    const result = resequenceLaddersAfterExit(
      [windowed("morning", 2, 9, 10), windowed("afternoon", 2, 13, 14)],
      { startsAt: day(9), endsAt: day(14) },
    );
    expect(result.changes).toEqual([
      { id: "morning", fromRank: 2, toRank: 1 },
      { id: "afternoon", fromRank: 2, toRank: 1 },
    ]);
    expect(result.promotedToFirst.map((p) => p.id).sort()).toEqual(["afternoon", "morning"]);
  });

  it("leaves ladders in unrelated windows untouched", () => {
    // The evening ladder never overlaps the departed morning hold or its
    // chain — its ranks must not move.
    const result = resequenceLaddersAfterExit(
      [windowed("noon", 2, 11, 13, { startsAt: day(10, 30) }), windowed("evening", 2, 18, 23)],
      { startsAt: day(9), endsAt: day(11) },
    );
    expect(result.changes).toEqual([{ id: "noon", fromRank: 2, toRank: 1 }]);
    expect(result.promotedToFirst.map((p) => p.id)).toEqual(["noon"]);
  });

  it("keeps joint ties shared inside a component", () => {
    const result = resequenceLaddersAfterExit(
      [
        windowed("j1", 2, 17, 23, { jointFlag: true }),
        windowed("j2", 2, 17, 23, { jointFlag: true }),
        windowed("c", 3, 18, 22),
      ],
      { startsAt: day(17), endsAt: day(23) },
    );
    expect(result.changes).toEqual([
      { id: "j1", fromRank: 2, toRank: 1 },
      { id: "j2", fromRank: 2, toRank: 1 },
      { id: "c", fromRank: 3, toRank: 2 },
    ]);
    expect(result.promotedToFirst.map((p) => p.id)).toEqual(["j1", "j2"]);
  });

  it("returns nothing when no survivor touches the departed window", () => {
    const result = resequenceLaddersAfterExit(
      [windowed("far", 1, 18, 23)],
      { startsAt: day(9), endsAt: day(11) },
    );
    expect(result).toEqual({ changes: [], promotedToFirst: [] });
  });

  it("returns nothing for an empty survivor set", () => {
    expect(
      resequenceLaddersAfterExit([], { startsAt: day(9), endsAt: day(11) }),
    ).toEqual({ changes: [], promotedToFirst: [] });
  });
});

describe("computeHoldReminderInstants (T-7 / T-3 / T-1)", () => {
  it("returns the three reminder instants before the decision date", () => {
    const decisionAt = new Date("2026-08-01T12:00:00.000Z");
    expect(computeHoldReminderInstants(decisionAt)).toEqual([
      { daysBefore: 7, at: new Date("2026-07-25T12:00:00.000Z") },
      { daysBefore: 3, at: new Date("2026-07-29T12:00:00.000Z") },
      { daysBefore: 1, at: new Date("2026-07-31T12:00:00.000Z") },
    ]);
  });

  it("computes exact instants across the October DST boundary", () => {
    // Decision date after the 25 Oct 2026 fall-back: T-7 lands before the
    // transition. Instant math means exactly 7×24h earlier — the schedule
    // never drifts by the folded hour.
    const decisionAt = new Date("2026-10-28T09:00:00.000Z");
    const instants = computeHoldReminderInstants(decisionAt);
    expect(instants[0]?.at.toISOString()).toBe("2026-10-21T09:00:00.000Z");
    expect(instants[2]?.at.toISOString()).toBe("2026-10-27T09:00:00.000Z");
  });
});
