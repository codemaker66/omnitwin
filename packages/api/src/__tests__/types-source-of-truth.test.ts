import { describe, it, expect } from "vitest";
import { LAYOUT_STYLES, LayoutStyleSchema } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Source-of-truth contract — punch list #13
//
// `@omnitwin/types` is the single source of truth for shared schemas. The
// API package previously duplicated `LayoutStyleSchema` inline in
// `routes/configurations.ts` with camelCase variants (`dinnerRounds`,
// `dinnerBanquet`) that silently disagreed with the kebab-case values in
// `@omnitwin/types`. The DB column is `varchar(50)` with no enum constraint,
// so both formats could coexist in production data — and the solver
// (which keys off kebab-case) would silently fail to find a strategy for
// any config created via the API.
//
// These tests pin the new contract:
//   1. Code-level: routes/configurations.ts imports LayoutStyleSchema from
//      @omnitwin/types and does NOT contain any inline camelCase enum.
//   2. Behavioural: the canonical kebab-case values still parse, and the
//      legacy camelCase variants are explicitly rejected.
//
// This is a tripwire — if anyone re-introduces a duplicate enum by
// copy-paste, these tests fail loudly at the source-grep level before
// the runtime drift can leak into production.
// ---------------------------------------------------------------------------

describe("LayoutStyle source-of-truth (#13)", () => {
  it("routes/configurations.ts imports LayoutStyleSchema from @omnitwin/types", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/routes/configurations.ts"),
      "utf-8",
    );
    // Strip comments before checking — comments may legitimately mention
    // the legacy camelCase variants for context (and should, in fact,
    // document what was removed and why).
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // Positive: imports the shared schema
    expect(codeOnly).toContain("LayoutStyleSchema");
    expect(codeOnly).toMatch(/from\s+["']@omnitwin\/types["']/);

    // Negative: no inline camelCase enum literals anywhere in code
    expect(codeOnly).not.toContain("dinnerRounds");
    expect(codeOnly).not.toContain("dinnerBanquet");
  });

  it("canonical kebab-case values parse through LayoutStyleSchema", () => {
    for (const style of LAYOUT_STYLES) {
      expect(LayoutStyleSchema.safeParse(style).success).toBe(true);
    }
  });

  it("rejects legacy camelCase variants", () => {
    expect(LayoutStyleSchema.safeParse("dinnerRounds").success).toBe(false);
    expect(LayoutStyleSchema.safeParse("dinnerBanquet").success).toBe(false);
  });

  it("LAYOUT_STYLES is the kebab-case set the solver expects", () => {
    // Pinned exact values so any future drift in the source schema also
    // breaks this test, forcing a deliberate decision to update both ends.
    expect(LAYOUT_STYLES).toEqual([
      "ceremony",
      "dinner-rounds",
      "dinner-banquet",
      "theatre",
      "boardroom",
      "cabaret",
      "cocktail",
      "custom",
    ]);
  });
});
