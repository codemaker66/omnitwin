import { beforeEach, describe, expect, it } from "vitest";
import { hasLikelyClerkSession } from "../clerk-session-hint.js";

describe("hasLikelyClerkSession", () => {
  beforeEach(() => {
    // happy-dom does not honour expiry-based deletion, so reset by
    // overwriting with Clerk's own signed-out marker (value 0).
    document.cookie = "__client_uat=0";
    document.cookie = "__client_uat_05kXmNMF=0";
    document.cookie = "unrelated=0";
  });

  it("is false when only signed-out markers are present", () => {
    expect(hasLikelyClerkSession()).toBe(false);
  });

  it("is false when Clerk's signed-out marker (value 0) is present", () => {
    document.cookie = "__client_uat=0";
    expect(hasLikelyClerkSession()).toBe(false);
  });

  it("is true for a non-zero __client_uat", () => {
    document.cookie = "__client_uat=1756725000";
    expect(hasLikelyClerkSession()).toBe(true);
  });

  it("is true for an instance-suffixed __client_uat_<hash>", () => {
    document.cookie = "__client_uat_05kXmNMF=1756725000";
    expect(hasLikelyClerkSession()).toBe(true);
  });

  it("ignores unrelated cookies", () => {
    document.cookie = "unrelated=1756725000";
    expect(hasLikelyClerkSession()).toBe(false);
  });
});
