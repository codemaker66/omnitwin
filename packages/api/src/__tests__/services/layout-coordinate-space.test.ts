import { describe, expect, it } from "vitest";
import {
  LEGACY_RENDER_COORDINATE_SPACE,
  REAL_METRE_COORDINATE_SPACE,
} from "../../db/coordinate-space.js";
import { canRenderPersistedLayout } from "../../services/layout-coordinate-space.js";

describe("persisted layout coordinate provenance", () => {
  it("suppresses legacy proposal geometry that cannot be reconstructed safely", () => {
    expect(canRenderPersistedLayout(LEGACY_RENDER_COORDINATE_SPACE)).toBe(false);
  });

  it("renders proposal geometry captured in the real-metre contract", () => {
    expect(canRenderPersistedLayout(REAL_METRE_COORDINATE_SPACE)).toBe(true);
  });
});
