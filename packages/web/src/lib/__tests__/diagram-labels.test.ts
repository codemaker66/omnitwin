import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { generateDiagramLabels } from "../diagram-labels.js";

describe("generateDiagramLabels", () => {
  it("positions a label above the visible scaled furniture top", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("round-table-6ft catalogue item missing");

    const labels = generateDiagramLabels([{
      id: "table-1",
      catalogueItemId: table.id,
      x: 2,
      y: 1,
      z: 3,
      scale: 2,
    }]);

    expect(labels[0]?.position).toEqual([2, 1 + table.height * 2 + 0.2, 3]);
  });

  it("uses the shared scale-1 fallback for invalid persisted scale", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("round-table-6ft catalogue item missing");

    const labels = generateDiagramLabels([{
      id: "table-1",
      catalogueItemId: table.id,
      x: 0,
      y: 0,
      z: 0,
      scale: 0,
    }]);

    expect(labels[0]?.position[1]).toBeCloseTo(table.height + 0.2);
  });
});
