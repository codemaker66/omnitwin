import { describe, it, expect } from "vitest";
import { ShortCodeSchema } from "@omnitwin/types";
import { generateShortCode, generateUniqueShortCode } from "../../services/shortcode.js";

describe("generateShortCode", () => {
  it("produces a 6-char string using only the nanoid alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShortCode();
      expect(ShortCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("generates varied output across calls", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add(generateShortCode());
    // 20 draws from 31^6 ≈ 887M should never collide in practice; if
    // this test ever flakes we've lost randomness.
    expect(codes.size).toBe(20);
  });
});

describe("generateUniqueShortCode", () => {
  it("returns the first candidate when it doesn't exist", async () => {
    let calls = 0;
    const result = await generateUniqueShortCode(() => {
      calls += 1;
      return Promise.resolve(false);
    });
    expect(ShortCodeSchema.safeParse(result).success).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries when a candidate collides", async () => {
    let calls = 0;
    const result = await generateUniqueShortCode(() => {
      calls += 1;
      return Promise.resolve(calls < 3);
    });
    expect(ShortCodeSchema.safeParse(result).success).toBe(true);
    expect(calls).toBe(3);
  });

  it("throws after exhausting attempts", async () => {
    await expect(
      generateUniqueShortCode(() => Promise.resolve(true), 3),
    ).rejects.toThrow(/exhausted/);
  });
});
