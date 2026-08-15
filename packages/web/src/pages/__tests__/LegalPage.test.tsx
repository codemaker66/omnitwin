import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { LegalPage } from "../LegalPage.js";

// ---------------------------------------------------------------------------
// LegalPage — the three public legal documents.
//
// Contract under test: each route renders a real document, not a promise of
// one. The placeholder these pages replaced said "will be updated with full
// details before launch" on a page that sat under a form collecting names,
// emails and phone numbers, so the forward-looking-language assertion below is
// the point of this file, not decoration.
// ---------------------------------------------------------------------------

const TYPES = ["accessibility", "privacy", "terms"] as const;

/** Language that promises a document instead of being one. */
const PLACEHOLDER_PHRASES = [
  "will be updated",
  "before launch",
  "coming soon",
  "tbd",
  "lorem ipsum",
  "placeholder",
] as const;

/** Every processor named in the privacy policy must be one actually in use —
 *  and every one actually in use must be named. */
const SUB_PROCESSORS = [
  "Neon",
  "Railway",
  "Vercel",
  "Resend",
  "Clerk",
  "Sentry",
  "Cloudflare R2",
] as const;

function textOf(type: (typeof TYPES)[number]): string {
  render(<LegalPage type={type} />);
  const root = document.querySelector(".lg-root");
  expect(root).not.toBeNull();
  return root?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("every document", () => {
  it.each(TYPES)("renders its own heading — %s", (type) => {
    render(<LegalPage type={type} />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    const expected = {
      accessibility: "Accessibility Statement",
      privacy: "Privacy Policy",
      terms: "Terms of Service",
    }[type];
    expect(headings[0]?.textContent).toBe(expected);
  });

  it.each(TYPES)("carries no forward-looking placeholder language — %s", (type) => {
    const lower = textOf(type).toLowerCase();
    for (const phrase of PLACEHOLDER_PHRASES) {
      expect(lower, `${type} still promises a future document: "${phrase}"`).not.toContain(phrase);
    }
  });

  it.each(TYPES)("shows a machine-readable last-updated date — %s", (type) => {
    render(<LegalPage type={type} />);
    const time = document.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-08-15");
    expect(time?.textContent).toBe("15 August 2026");
  });

  it.each(TYPES)("gives a contents list and real section anchors — %s", (type) => {
    render(<LegalPage type={type} />);
    const tocLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(".lg-toc-list a"),
    );
    expect(tocLinks.length).toBeGreaterThanOrEqual(6);
    for (const link of tocLinks) {
      const id = link.getAttribute("href")?.replace("#", "") ?? "";
      expect(document.getElementById(id), `${type} contents entry "${id}" has no section`).not.toBeNull();
    }
    // One numbered h2 per section — the contents heading carries its own class.
    expect(document.querySelectorAll(".lg-heading").length).toBe(tocLinks.length);
  });

  it.each(TYPES)("keeps every claim inside the house claim guard — %s", (type) => {
    expect(findUnsupportedProposalClaim(textOf(type))).toBeNull();
  });

  it.each(TYPES)("names the venue and gives a route to a person — %s", (type) => {
    const text = textOf(type);
    expect(text).toContain("The Trades House of Glasgow");
    expect(text).toContain("info@tradeshallglasgow.co.uk");
    expect(text).toContain("+44 141 552 2418");
  });
});

describe("the privacy policy", () => {
  it("names the ICO with a route to complain", () => {
    const text = textOf("privacy");
    expect(text).toContain("Information Commissioner's Office");
    expect(text).toContain("ico.org.uk");
    expect(text).toContain("0303 123 1113");
  });

  it("names every sub-processor actually in use", () => {
    const text = textOf("privacy");
    for (const processor of SUB_PROCESSORS) {
      expect(text, `privacy policy does not name ${processor}`).toContain(processor);
    }
  });

  it("lists every field the public enquiry endpoint accepts", () => {
    const text = textOf("privacy").toLowerCase();
    for (const field of [
      "email address",
      "your name",
      "phone number",
      "event date",
      "event type",
      "guest count",
      "message",
    ]) {
      expect(text, `privacy policy omits the "${field}" field`).toContain(field);
    }
  });

  it("states a lawful basis without claiming consent", () => {
    const text = textOf("privacy");
    expect(text).toContain("Article 6(1)(b)");
    expect(text).toContain("Article 6(1)(f)");
    expect(text).toContain("We do not rely on consent");
  });

  it("gives a retention period and every data-subject right", () => {
    const text = textOf("privacy");
    expect(text).toContain("24 months");
    for (const right of [
      "Access",
      "Rectification",
      "Erasure",
      "Restriction",
      "Portability",
      "Objection",
    ]) {
      expect(text, `privacy policy omits the right to ${right}`).toContain(right);
    }
  });

  it("is honest that transfers may leave the UK, and on what safeguard", () => {
    const text = textOf("privacy");
    expect(text).toContain("outside the United Kingdom");
    expect(text).toContain("UK International Data Transfer Agreement");
  });
});

describe("the terms of service", () => {
  it("says plainly that an enquiry is not a booking", () => {
    const text = textOf("terms");
    expect(text).toContain("An enquiry is not a booking");
    expect(text).toContain("does not reserve a date");
  });

  it("treats published capacities and rates as subject to confirmation", () => {
    const text = textOf("terms");
    expect(text).toContain("the venue's own published figures");
    expect(text).toContain("subject to confirmation");
  });

  it("is governed by the law of Scotland", () => {
    expect(textOf("terms")).toContain("law of Scotland");
  });
});

describe("the accessibility statement", () => {
  it("makes no conformance claim, and says why", () => {
    const text = textOf("accessibility");
    expect(text).toContain("make no claim that the site conforms");
    expect(text).toContain("No third-party accessibility audit");
    // A target is allowed; a claim of having met it is not.
    expect(text).not.toContain("conforms to WCAG 2.2 AA");
  });

  it("names the two measured contrast failures rather than hiding them", () => {
    const text = textOf("accessibility");
    expect(text).toContain("1.92:1");
    expect(text).toContain("2.12:1");
    expect(text).toContain("4.5:1");
  });

  it("commits to a response time for access problems", () => {
    expect(textOf("accessibility")).toContain("five working days");
  });
});

describe("the page shell", () => {
  it("puts a skip link first and links home", () => {
    render(<LegalPage type="privacy" />);
    const first = document.querySelector("a");
    expect(first?.getAttribute("href")).toBe("#lg-main");
    expect(document.getElementById("lg-main")).not.toBeNull();
  });

  it("links to the sibling documents but never to itself", () => {
    render(<LegalPage type="privacy" />);
    const footerHrefs = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(".lg-footer-links a"),
    ).map((a) => a.getAttribute("href"));
    expect(footerHrefs).toContain("/terms");
    expect(footerHrefs).toContain("/accessibility");
    expect(footerHrefs).not.toContain("/privacy");
  });

  it("honours the theme chosen on the home page", () => {
    window.localStorage.setItem("fresh-theme.v1", "dark");
    render(<LegalPage type="terms" />);
    expect(document.querySelector('[data-theme="dark"]')).not.toBeNull();
  });

  it("leaves the theme to the system when nothing was chosen", () => {
    render(<LegalPage type="terms" />);
    expect(document.querySelector(".lg-root")?.hasAttribute("data-theme")).toBe(false);
  });
});
