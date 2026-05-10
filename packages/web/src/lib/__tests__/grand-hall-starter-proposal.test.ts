import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import {
  createGrandHallStarterProposal,
  hasOnlyStarterSafeViolations,
} from "../grand-hall-starter-proposal.js";

const roundTableId = getCatalogueItemBySlug("round-table-6ft")?.id ?? "missing-round-table";
const trestleTableId = getCatalogueItemBySlug("trestle-6ft")?.id ?? "missing-trestle";
const chairId = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair";

describe("Grand Hall starter proposal", () => {
  it("creates a staged editable proposal from real catalogue items", () => {
    const proposal = createGrandHallStarterProposal();

    expect(proposal.length).toBe(132);
    expect(new Set(proposal.map((item) => item.id)).size).toBe(proposal.length);
    expect(proposal.every((item) => item.id.startsWith("local-"))).toBe(true);
    expect(proposal.every((item) =>
      item.catalogueItemId === roundTableId
      || item.catalogueItemId === trestleTableId
      || item.catalogueItemId === chairId,
    )).toBe(true);
  });

  it("dresses every starter table with white linen and dinner settings", () => {
    const proposal = createGrandHallStarterProposal();
    const tables = proposal.filter((item) =>
      item.catalogueItemId === roundTableId || item.catalogueItemId === trestleTableId,
    );

    expect(tables).toHaveLength(16);
    for (const table of tables) {
      expect(table.clothed).toBe(true);
      expect(table.clothStyle).toBe("white");
      expect(table.tableSetting).toBe("dinner");
    }
  });

  it("keeps round-table chair rings and the banquet row grouped", () => {
    const proposal = createGrandHallStarterProposal();
    const groupIds = new Set(proposal.map((item) => item.groupId).filter((groupId) => groupId !== null));

    expect(groupIds.size).toBe(9);
    for (const groupId of groupIds) {
      const members = proposal.filter((item) => item.groupId === groupId);
      expect(members.length).toBeGreaterThanOrEqual(11);
    }
  });

  it("fits inside the Grand Hall footprint", () => {
    const proposal = createGrandHallStarterProposal();

    expect(hasOnlyStarterSafeViolations(proposal)).toBe(true);
  });
});
