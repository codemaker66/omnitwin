import { describe, it, expect } from "vitest";
import {
  UsernameSchema,
  NewUsernameSchema,
  LayoutSlugSchema,
  ShortCodeSchema,
  RESERVED_USERNAMES,
  SHORTCODE_ALPHABET_CHARS,
  SHORTCODE_LENGTH,
  buildLayoutPathKey,
  slugifyLayoutName,
} from "../url-identifiers.js";

describe("UsernameSchema", () => {
  it("accepts lowercase alphanumeric handles", () => {
    expect(UsernameSchema.safeParse("blake").success).toBe(true);
    expect(UsernameSchema.safeParse("trades-hall").success).toBe(true);
    expect(UsernameSchema.safeParse("user123").success).toBe(true);
    expect(UsernameSchema.safeParse("abc").success).toBe(true);
    expect(UsernameSchema.safeParse("a".repeat(30)).success).toBe(true);
  });

  it("rejects out-of-shape handles", () => {
    expect(UsernameSchema.safeParse("").success).toBe(false);
    expect(UsernameSchema.safeParse("ab").success).toBe(false);
    expect(UsernameSchema.safeParse("a".repeat(31)).success).toBe(false);
    expect(UsernameSchema.safeParse("Blake").success).toBe(false);
    expect(UsernameSchema.safeParse("blake_user").success).toBe(false);
    expect(UsernameSchema.safeParse("-blake").success).toBe(false);
    expect(UsernameSchema.safeParse("blake-").success).toBe(false);
    expect(UsernameSchema.safeParse("blake@host").success).toBe(false);
    expect(UsernameSchema.safeParse("blake space").success).toBe(false);
  });
});

describe("NewUsernameSchema", () => {
  it("accepts regular handles", () => {
    expect(NewUsernameSchema.safeParse("blake").success).toBe(true);
  });

  it("rejects every reserved first-segment word", () => {
    for (const reserved of RESERVED_USERNAMES) {
      const result = NewUsernameSchema.safeParse(reserved);
      expect(
        result.success,
        `expected reserved username "${reserved}" to be rejected`,
      ).toBe(false);
    }
  });

  it("still rejects out-of-shape handles", () => {
    expect(NewUsernameSchema.safeParse("Blake").success).toBe(false);
    expect(NewUsernameSchema.safeParse("ab").success).toBe(false);
  });
});

describe("LayoutSlugSchema", () => {
  it("accepts typical layout slugs", () => {
    expect(LayoutSlugSchema.safeParse("wedding-rehearsal").success).toBe(true);
    expect(LayoutSlugSchema.safeParse("spring-gala-2026").success).toBe(true);
    expect(LayoutSlugSchema.safeParse("abc").success).toBe(true);
    expect(LayoutSlugSchema.safeParse("a".repeat(60)).success).toBe(true);
  });

  it("rejects malformed slugs", () => {
    expect(LayoutSlugSchema.safeParse("ab").success).toBe(false);
    expect(LayoutSlugSchema.safeParse("a".repeat(61)).success).toBe(false);
    expect(LayoutSlugSchema.safeParse("Wedding-Rehearsal").success).toBe(false);
    expect(LayoutSlugSchema.safeParse("-wedding").success).toBe(false);
    expect(LayoutSlugSchema.safeParse("wedding/sub").success).toBe(false);
  });
});

describe("ShortCodeSchema", () => {
  it("accepts exactly-6-char nanoid alphabet codes", () => {
    expect(ShortCodeSchema.safeParse("a7k3q9").success).toBe(true);
    expect(ShortCodeSchema.safeParse("b2c3d4").success).toBe(true);
    expect(ShortCodeSchema.safeParse("xyz234").success).toBe(true);
  });

  it("rejects the confusable characters 0, 1, i, l, o", () => {
    expect(ShortCodeSchema.safeParse("abc0de").success).toBe(false);
    expect(ShortCodeSchema.safeParse("abc1de").success).toBe(false);
    expect(ShortCodeSchema.safeParse("abcide").success).toBe(false);
    expect(ShortCodeSchema.safeParse("abclde").success).toBe(false);
    expect(ShortCodeSchema.safeParse("abcode").success).toBe(false);
  });

  it("rejects wrong-length codes", () => {
    expect(ShortCodeSchema.safeParse("abc23").success).toBe(false);
    expect(ShortCodeSchema.safeParse("abc2345").success).toBe(false);
    expect(ShortCodeSchema.safeParse("").success).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(ShortCodeSchema.safeParse("A7K3Q9").success).toBe(false);
  });
});

describe("SHORTCODE_ALPHABET_CHARS + SHORTCODE_LENGTH", () => {
  it("alphabet excludes confusable characters", () => {
    for (const confusable of ["0", "1", "i", "l", "o"]) {
      expect(
        SHORTCODE_ALPHABET_CHARS.includes(confusable),
        `alphabet should not contain "${confusable}"`,
      ).toBe(false);
    }
  });

  it("length is 6", () => {
    expect(SHORTCODE_LENGTH).toBe(6);
  });

  it("every alphabet character passes ShortCodeSchema when repeated 6 times", () => {
    for (const ch of SHORTCODE_ALPHABET_CHARS) {
      const candidate = ch.repeat(6);
      expect(
        ShortCodeSchema.safeParse(candidate).success,
        `expected ShortCodeSchema to accept "${candidate}"`,
      ).toBe(true);
    }
  });
});

describe("buildLayoutPathKey", () => {
  it("produces a uuid path key", () => {
    expect(
      buildLayoutPathKey("uuid", { uuid: "f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0" }),
    ).toBe("uuid:f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0");
  });

  it("produces a shortcode path key", () => {
    expect(buildLayoutPathKey("shortcode", { shortCode: "a7k3q9" })).toBe("sc:a7k3q9");
  });

  it("produces a user_slug path key", () => {
    expect(
      buildLayoutPathKey("user_slug", { username: "blake", slug: "wedding-rehearsal" }),
    ).toBe("u:blake/wedding-rehearsal");
  });

  it("throws when required identifier fields are missing", () => {
    expect(() => buildLayoutPathKey("uuid", {})).toThrow();
    expect(() => buildLayoutPathKey("shortcode", {})).toThrow();
    expect(() => buildLayoutPathKey("user_slug", { username: "blake" })).toThrow();
    expect(() => buildLayoutPathKey("user_slug", { slug: "x" })).toThrow();
  });
});

describe("slugifyLayoutName", () => {
  it("lowercases and hyphenates typical names", () => {
    expect(slugifyLayoutName("Spring Gala 2026")).toBe("spring-gala-2026");
    expect(slugifyLayoutName("Wedding Rehearsal")).toBe("wedding-rehearsal");
  });

  it("strips diacritics", () => {
    expect(slugifyLayoutName("Café Opening")).toBe("cafe-opening");
    expect(slugifyLayoutName("Naïve Soirée")).toBe("naive-soiree");
  });

  it("collapses symbols and trims hyphens", () => {
    expect(slugifyLayoutName("  !!!Hello---World!!!  ")).toBe("hello-world");
    expect(slugifyLayoutName("a & b / c")).toBe("a-b-c");
  });

  it("falls back to 'untitled' when input is empty-ish", () => {
    expect(slugifyLayoutName("")).toBe("untitled");
    expect(slugifyLayoutName("   ")).toBe("untitled");
    expect(slugifyLayoutName("!!!")).toBe("untitled");
    expect(slugifyLayoutName("a")).toBe("untitled");
  });

  it("caps at 60 characters", () => {
    const long = "A".repeat(200);
    const result = slugifyLayoutName(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(LayoutSlugSchema.safeParse(result).success).toBe(true);
  });

  it("every typical output satisfies LayoutSlugSchema", () => {
    for (const name of ["Spring Gala", "Café Opening", "Event 1", "A & B"]) {
      const slug = slugifyLayoutName(name);
      expect(
        LayoutSlugSchema.safeParse(slug).success,
        `slugifyLayoutName("${name}") produced "${slug}" which failed LayoutSlugSchema`,
      ).toBe(true);
    }
  });
});
