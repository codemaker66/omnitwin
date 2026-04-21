import { describe, it, expect } from "vitest";
import {
  parseLayoutUrlPath,
  buildCanonicalPath,
  type ResolveInput,
} from "../../services/layout-resolver.js";

// ---------------------------------------------------------------------------
// layout-resolver — pure helpers
//
// `parseLayoutUrlPath` and `buildCanonicalPath` carry the URL grammar
// complexity (UUID form, shortcode alphabet, reserved first-segment
// list, malformed paths). The async `resolveLayoutUrl` is DB-bound and
// covered via the integration harness (pending task #7) against a real
// Postgres branch; those cases can't be faithfully mocked through
// Drizzle's query builder chaining, so pure-helper coverage is what
// this file pins.
// ---------------------------------------------------------------------------

describe("parseLayoutUrlPath — /plan/<uuid>", () => {
  it("accepts a lowercase UUID", () => {
    expect(
      parseLayoutUrlPath("/plan/f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0"),
    ).toEqual<ResolveInput>({
      kind: "uuid",
      uuid: "f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0",
    });
  });

  it("normalises an uppercase UUID to lowercase", () => {
    expect(
      parseLayoutUrlPath("/plan/F9FC5C8A-B7ED-4021-9F3D-90EAC550C9B0"),
    ).toEqual<ResolveInput>({
      kind: "uuid",
      uuid: "f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0",
    });
  });

  it("tolerates trailing slash and leading slash variants", () => {
    const input: ResolveInput = {
      kind: "uuid",
      uuid: "f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0",
    };
    expect(parseLayoutUrlPath("plan/f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0")).toEqual(input);
    expect(parseLayoutUrlPath("/plan/f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0/")).toEqual(input);
  });

  it("strips query and hash", () => {
    const uuid = "f9fc5c8a-b7ed-4021-9f3d-90eac550c9b0";
    expect(parseLayoutUrlPath(`/plan/${uuid}?source=landing`)).toEqual({
      kind: "uuid",
      uuid,
    });
    expect(parseLayoutUrlPath(`/plan/${uuid}#section-1`)).toEqual({
      kind: "uuid",
      uuid,
    });
  });
});

describe("parseLayoutUrlPath — /plan/<shortcode>", () => {
  it("accepts a valid shortcode", () => {
    expect(parseLayoutUrlPath("/plan/a7k3q9")).toEqual<ResolveInput>({
      kind: "shortcode",
      shortCode: "a7k3q9",
    });
  });

  it("rejects shortcodes containing confusable characters", () => {
    for (const confusable of ["abc0de", "abc1de", "abcide", "abclde", "abcode"]) {
      expect(parseLayoutUrlPath(`/plan/${confusable}`)).toBeNull();
    }
  });

  it("rejects wrong-length codes", () => {
    expect(parseLayoutUrlPath("/plan/abc23")).toBeNull();
    expect(parseLayoutUrlPath("/plan/abc2345")).toBeNull();
  });
});

describe("parseLayoutUrlPath — /<username>/<slug>", () => {
  it("accepts a valid user_slug", () => {
    expect(parseLayoutUrlPath("/blake/wedding-rehearsal")).toEqual<ResolveInput>({
      kind: "user_slug",
      username: "blake",
      slug: "wedding-rehearsal",
    });
  });

  it("accepts hyphenated usernames and slugs", () => {
    expect(parseLayoutUrlPath("/trades-hall-staff/spring-gala-2026")).toEqual({
      kind: "user_slug",
      username: "trades-hall-staff",
      slug: "spring-gala-2026",
    });
  });

  it("rejects reserved first segments", () => {
    for (const reserved of [
      "admin", "api", "app", "dashboard", "plan", "login", "signup",
      "hallkeeper", "editor", "privacy", "terms", "venviewer", "www",
    ]) {
      expect(
        parseLayoutUrlPath(`/${reserved}/some-slug`),
        `expected /${reserved}/some-slug to be rejected`,
      ).toBeNull();
    }
  });

  it("rejects malformed username or slug", () => {
    expect(parseLayoutUrlPath("/-leading/slug")).toBeNull();
    expect(parseLayoutUrlPath("/trailing-/slug")).toBeNull();
    expect(parseLayoutUrlPath("/Blake/wedding")).toBeNull();
    expect(parseLayoutUrlPath("/blake/Wedding")).toBeNull();
    expect(parseLayoutUrlPath("/ab/slug")).toBeNull();
  });
});

describe("parseLayoutUrlPath — invalid paths", () => {
  it("rejects empty path", () => {
    expect(parseLayoutUrlPath("")).toBeNull();
    expect(parseLayoutUrlPath("/")).toBeNull();
  });

  it("rejects single-segment paths", () => {
    expect(parseLayoutUrlPath("/blake")).toBeNull();
    expect(parseLayoutUrlPath("/plan")).toBeNull();
  });

  it("rejects three-or-more-segment paths", () => {
    expect(parseLayoutUrlPath("/blake/wedding/extra")).toBeNull();
    expect(parseLayoutUrlPath("/plan/a7k3q9/extra")).toBeNull();
  });
});

describe("buildCanonicalPath", () => {
  it("builds a shortcode path", () => {
    expect(buildCanonicalPath("shortcode", { shortCode: "a7k3q9" })).toBe("/plan/a7k3q9");
  });

  it("builds a user_slug path", () => {
    expect(
      buildCanonicalPath("user_slug", { username: "blake", slug: "wedding-rehearsal" }),
    ).toBe("/blake/wedding-rehearsal");
  });

  it("throws when required parts are missing", () => {
    expect(() => buildCanonicalPath("shortcode", {})).toThrow();
    expect(() => buildCanonicalPath("user_slug", { username: "blake" })).toThrow();
    expect(() => buildCanonicalPath("user_slug", { slug: "x" })).toThrow();
  });
});

describe("parseLayoutUrlPath ↔ buildCanonicalPath roundtrip", () => {
  it("shortcode roundtrips", () => {
    const parsed = parseLayoutUrlPath("/plan/a7k3q9");
    expect(parsed).not.toBeNull();
    if (parsed === null || parsed.kind !== "shortcode") return;
    expect(buildCanonicalPath("shortcode", { shortCode: parsed.shortCode })).toBe("/plan/a7k3q9");
  });

  it("user_slug roundtrips", () => {
    const parsed = parseLayoutUrlPath("/blake/wedding-rehearsal");
    expect(parsed).not.toBeNull();
    if (parsed === null || parsed.kind !== "user_slug") return;
    expect(
      buildCanonicalPath("user_slug", { username: parsed.username, slug: parsed.slug }),
    ).toBe("/blake/wedding-rehearsal");
  });
});
