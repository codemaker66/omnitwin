import { describe, it, expect } from "vitest";
import { GuestEnquiryEmailSchema } from "@omnitwin/types/enquiry";
import { isValidEmail } from "../email-validation.js";

// ---------------------------------------------------------------------------
// Email validation — covers the typo classes the previous regex let through
// ---------------------------------------------------------------------------

describe("isValidEmail — accepts realistic addresses", () => {
  it.each([
    "alice@example.com",
    "alice.smith@example.co.uk",
    "alice+events@trades-hall.com",
    "first.last+filter@sub.domain.example.com",
    "user_name-123@example-domain.io",
    "j@x.io", // shortest plausible address
  ])("accepts %s", (addr) => {
    expect(isValidEmail(addr)).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidEmail("  alice@example.com  ")).toBe(true);
  });
});

describe("isValidEmail — rejects obvious typos", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["no @", "alice.example.com"],
    ["double @", "alice@@example.com"],
    ["@ at start", "@example.com"],
    ["@ at end", "alice@"],
    ["domain with no dot", "alice@localhost"],
    ["leading dot in local", ".alice@example.com"],
    ["trailing dot in local", "alice.@example.com"],
    ["consecutive dots in local", "al..ice@example.com"],
    ["space in local", "al ice@example.com"],
    ["space in domain", "alice@exa mple.com"],
    ["unicode in local (out of scope)", "ali\u00e7e@example.com"],
  ])("rejects (%s)", (_label, addr) => {
    expect(isValidEmail(addr)).toBe(false);
  });
});

describe("isValidEmail — length limits (RFC 3696 / RFC 5321)", () => {
  it("rejects local part > 64 chars", () => {
    const local = "a".repeat(65);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });

  it("accepts local part of exactly 64 chars", () => {
    const local = "a".repeat(64);
    expect(isValidEmail(`${local}@example.com`)).toBe(true);
  });

  it("rejects total length > 254 chars", () => {
    const local = "a".repeat(64);
    // 4 labels of 63 chars + 3 dots = 255, plus ".com" = 259. With 64 + @
    // that's 324 chars total — well past the 254 cap.
    const domain = `${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(63)}.${"g".repeat(63)}.com`;
    const total = `${local}@${domain}`;
    expect(total.length).toBeGreaterThan(254);
    expect(isValidEmail(total)).toBe(false);
  });
});

// public-claims-6: every caller posts the address to /public/enquiries, so an
// address the API's own rule refuses is refused here, where the guest can
// still correct it, rather than coming back as a failed send.
describe("isValidEmail — never passes an address the enquiry API refuses", () => {
  it.each([
    ["one-letter top-level domain", "jane@gmail.c"],
    ["numeric top-level domain", "jane@example.123"],
    ["symbol the API refuses before the @", "o!brien@example.com"],
    ["another such symbol", "jane{events}@example.com"],
  ])("rejects (%s)", (_label, addr) => {
    expect(GuestEnquiryEmailSchema.safeParse(addr).success, "the API refuses it").toBe(false);
    expect(isValidEmail(addr)).toBe(false);
  });

  it.each([
    "alice@example.com",
    "alice.smith@example.co.uk",
    "alice+events@trades-hall.com",
    "o'brien@example.ie",
    "j@x.io",
  ])("still accepts %s, which the API takes too", (addr) => {
    expect(GuestEnquiryEmailSchema.safeParse(addr).success).toBe(true);
    expect(isValidEmail(addr)).toBe(true);
  });
});

describe("isValidEmail — closes regressions in the old loose regex", () => {
  // The previous regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepted these:
  it.each([
    "..@..",
    ".a@b.c",
    "a.@b.c",
    "a..b@example.com",
    "a@b..c",
  ])("now rejects what the old regex passed: %s", (addr) => {
    expect(isValidEmail(addr)).toBe(false);
  });
});
