import { describe, expect, it } from "vitest";
import type { StageMove } from "../../../../api/crm.js";
import { summaryText } from "../../enquiries/enquiry-desk-format.js";
import {
  dealStageTone, dealStageWords, dealTimeline, dueKey, dueWords, groupByDue, pipelineSummary, stagePath, stageSteps,
} from "../pipeline-desk-format.js";

// 11:00 in Glasgow on Friday 2 October 2026 (British Summer Time).
const NOW = Date.parse("2026-10-02T10:00:00.000Z");

function open(due: string | null): { stage: string; nextActionDueAt: string | null; closedAt: null; updatedAt: string } {
  return { stage: "qualified", nextActionDueAt: due, closedAt: null, updatedAt: "2026-09-30T10:00:00.000Z" };
}

describe("when the next step is due", () => {
  it("reads on the venue's calendar, not UTC's", () => {
    // 23:30 UTC on the 1st is half past midnight on the 2nd in Glasgow: today.
    expect(dueKey(open("2026-10-01T23:30:00.000Z"), NOW)).toBe("today");
    expect(dueWords(open("2026-10-01T23:30:00.000Z"), NOW)).toBe("Due today");
    expect(dueWords(open("2026-10-01T12:00:00.000Z"), NOW)).toBe("Due yesterday");
    expect(dueWords(open("2026-09-28T12:00:00.000Z"), NOW)).toBe("Overdue by 4 days");
    expect(dueWords(open("2026-10-03T12:00:00.000Z"), NOW)).toBe("Due tomorrow");
    expect(dueWords(open("2026-10-06T12:00:00.000Z"), NOW)).toBe("Due Tuesday");
    expect(dueWords(open("2026-10-20T12:00:00.000Z"), NOW)).toBe("Due 20 Oct");
    expect(dueWords(open("2027-01-20T12:00:00.000Z"), NOW)).toBe("Due 20 Jan 2027");
    expect(dueWords(open(null), NOW)).toBe("No date set");
  });

  it("says when a closed deal closed, whatever its old due date", () => {
    const won = { stage: "won", nextActionDueAt: "2026-09-01T12:00:00.000Z", closedAt: "2026-09-30T10:00:00.000Z", updatedAt: "2026-09-30T10:00:00.000Z" };
    expect(dueKey(won, NOW)).toBe("closed");
    expect(dueWords(won, NOW)).toBe("Won 2 days ago");
    expect(dueWords({ ...won, stage: "lost", closedAt: null }, NOW)).toBe("Lost 2 days ago");
  });

  it("groups in the order a booker works them, keeping each group's order", () => {
    const groups = groupByDue([
      { id: "later", ...open("2026-11-01T12:00:00.000Z") },
      { id: "won", stage: "won", nextActionDueAt: null },
      { id: "late-1", ...open("2026-09-30T12:00:00.000Z") },
      { id: "none", ...open(null) },
      { id: "late-2", ...open("2026-09-29T12:00:00.000Z") },
      { id: "today", ...open("2026-10-02T16:00:00.000Z") },
    ], NOW);
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.id)])).toEqual([
      ["Overdue", ["late-1", "late-2"]],
      ["Due today", ["today"]],
      ["Later", ["later"]],
      ["No date set", ["none"]],
      ["Won and lost", ["won"]],
    ]);
  });
});

describe("the opening sentence", () => {
  const sentence = (due: { overdue: number; today: number } | null, openCount = 3, value: number | null = 1_234_500): string | null => {
    const parts = pipelineSummary({ due, openCount, openValueMinor: value, currency: "GBP" });
    return parts === null ? null : summaryText(parts);
  };
  it("says what is owed today and what is open, in whole sentences", () => {
    expect(sentence({ overdue: 2, today: 1 })).toBe("1 deal has a step due today, and 2 are overdue. £12,345.00 is open across 3 deals.");
    expect(sentence({ overdue: 0, today: 2 })).toBe("2 deals have a step due today. £12,345.00 is open across 3 deals.");
    expect(sentence({ overdue: 1, today: 0 }, 1)).toBe("Nothing is due today; 1 deal is overdue. £12,345.00 is open across 1 deal.");
    expect(sentence({ overdue: 0, today: 0 }, 0)).toBe("Nothing is due today or overdue. No deals are open.");
    expect(sentence({ overdue: 0, today: 0 }, 2, null)).toBe("Nothing is due today or overdue. 2 deals are open.");
  });
  it("says nothing rather than guess from an API that does not count", () => {
    expect(sentence(null)).toBeNull();
  });
});

describe("the stages", () => {
  it("names and colours every stage, and an unknown one plainly", () => {
    expect(dealStageWords("proposal_sent")).toBe("Proposal sent");
    expect(dealStageWords("something_new")).toBe("In the pipeline");
    expect([dealStageTone("new"), dealStageTone("proposal_sent"), dealStageTone("won"), dealStageTone("lost")])
      .toEqual(["new", "withdrawn", "approved", "declined"]);
  });

  it("offers one next step per stage and only the moves the stage rules allow", () => {
    const words = (stage: string): [string | null, string[]] => {
      const steps = stageSteps(stage);
      return [steps.primary?.label ?? null, steps.secondary.map((step) => step.label)];
    };
    expect(words("new")).toEqual(["Mark qualified", ["Mark lost…"]]);
    expect(words("qualified")).toEqual(["Draft a proposal", ["Mark lost…"]]);
    expect(words("proposal_drafting")).toEqual(["Mark the proposal sent", ["Back to qualified", "Mark lost…"]]);
    expect(words("proposal_sent")).toEqual(["Mark won…", ["They asked for changes", "Mark lost…"]]);
    expect(words("negotiation")).toEqual(["Mark the revised proposal sent", ["Mark won…", "Mark lost…"]]);
    expect(words("won")).toEqual([null, ["Archive"]]);
    expect(words("archived")).toEqual([null, []]);
  });

  it("marks the path done, current and ahead, showing Negotiation only while a deal is in it", () => {
    expect(stagePath("proposal_sent").map((stop) => `${stop.label}:${stop.state}`))
      .toEqual(["New:done", "Qualified:done", "Drafting:done", "Sent:current", "Won:ahead"]);
    expect(stagePath("negotiation").map((stop) => `${stop.label}:${stop.state}`))
      .toEqual(["New:done", "Qualified:done", "Drafting:done", "Sent:done", "Negotiation:current", "Won:ahead"]);
    expect(stagePath("won").map((stop) => stop.state)).toEqual(["done", "done", "done", "done", "current"]);
  });
});

describe("the timeline", () => {
  const move = (overrides: Partial<StageMove>): StageMove => ({
    id: "m", fromStage: "new", toStage: "qualified", note: null, changedByName: "Catherine Tait", createdAt: "2026-09-25T10:00:00.000Z", ...overrides,
  });
  it("puts every move, note and the opening newest first, with the reasons given", () => {
    const moments = dealTimeline({ createdAt: "2026-09-20T10:00:00.000Z" }, [
      move({ id: "a", toStage: "won", note: "Accepted the proposal", createdAt: "2026-09-30T10:00:00.000Z" }),
      move({ id: "b", toStage: "qualified", note: "Moved to Qualified", changedByName: null }),
    ], [{ id: "n", opportunityId: "o", type: "note", body: "Prefers a later start.", createdBy: null, createdAt: "2026-09-27T10:00:00.000Z" }]);
    expect(moments.map((moment) => [moment.sentence, moment.quote])).toEqual([
      ["Catherine Tait marked it won.", "Accepted the proposal"],
      ["Note", "Prefers a later start."],
      // The old board's automatic "Moved to X" says nothing, so it is not quoted.
      ["It moved to Qualified.", null],
      ["The deal was opened.", null],
    ]);
  });

  it("tells a move nobody at the venue made in its own words", () => {
    const moments = dealTimeline({ createdAt: "2026-09-20T10:00:00.000Z" }, [
      move({ id: "a", toStage: "won", note: "The client accepted the proposal (version 2).", changedByName: null, createdAt: "2026-09-30T10:00:00.000Z" }),
      move({ id: "b", toStage: "negotiation", note: "The client asked for changes to the proposal (version 1).", changedByName: null, createdAt: "2026-09-28T10:00:00.000Z" }),
      move({ id: "c", toStage: "proposal_sent", note: "The proposal (version 1) was sent.", createdAt: "2026-09-25T10:00:00.000Z" }),
      move({ id: "d", toStage: "lost", note: "  ", changedByName: null, createdAt: "2026-09-22T10:00:00.000Z" }),
    ], []);
    expect(moments.map((moment) => [moment.sentence, moment.quote])).toEqual([
      ["The client accepted the proposal (version 2).", null],
      ["The client asked for changes to the proposal (version 1).", null],
      // A person's move names them, with what happened beneath.
      ["Catherine Tait moved it to Proposal sent.", "The proposal (version 1) was sent."],
      ["It was marked lost.", null],
      ["The deal was opened.", null],
    ]);
  });
});
