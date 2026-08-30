import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_LINEAGE_SOURCE_PATHSPEC,
  grandHallLineageSourceStateSha256,
} from "./grand-hall-visual-lineage-source-state.js";

describe("Grand Hall lineage source-state closure", () => {
  it("includes the capture-mode helper and changes its digest when that dirty helper changes", () => {
    const helperPath = "packages/web/e2e/grand-hall-visual-lineage-capture-mode.ts";
    expect(GRAND_HALL_LINEAGE_SOURCE_PATHSPEC).toContain(helperPath);
    const digest = (helperBytes: string): string => grandHallLineageSourceStateSha256({
      trackedDiff: Buffer.alloc(0),
      untrackedFiles: [{ relativePath: helperPath, bytes: Buffer.from(helperBytes, "utf8") }],
      runtimeFiles: [{
        relativePath: "packages/types/dist/index.js",
        bytes: Buffer.from("runtime", "utf8"),
      }],
    });
    expect(digest("export const mode = 'v1';\n"))
      .not.toBe(digest("export const mode = 'dirty-mutation';\n"));
  });
});
