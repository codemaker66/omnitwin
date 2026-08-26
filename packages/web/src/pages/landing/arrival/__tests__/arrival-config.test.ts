import { afterEach, describe, expect, it, vi } from "vitest";
import { googleTilesApiKey } from "../arrival-config.js";

describe("googleTilesApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when the env var is unset or blank", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", "");
    expect(googleTilesApiKey()).toBeNull();
  });

  it("returns the trimmed key when set", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_TILES_KEY", " AIza-test-key ");
    expect(googleTilesApiKey()).toBe("AIza-test-key");
  });
});
