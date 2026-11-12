import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { measurementDeclined } from "../../observability/measurement-choice.js";
import {
  DIETARY_MEMORY_CONSENT,
  DIETARY_MEMORY_MONTHS_UNUSED,
  DIETARY_NOTE_RETENTION,
  findUnsupportedProposalClaim,
} from "@omnitwin/types";
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
  "Anthropic",
  "Stripe",
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
    // Each document carries its own date: the privacy policy and the
    // accessibility statement changed in the v1.0 final review; the terms
    // changed on 11 November, when the Grand Hall's dimensions became measured.
    const expected = type === "terms"
      ? { iso: "2026-11-11", text: "11 November 2026" }
      : { iso: "2026-11-08", text: "8 November 2026" };
    expect(time?.getAttribute("datetime")).toBe(expected.iso);
    expect(time?.textContent).toBe(expected.text);
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
  // T-685: before the page-speed timings may be switched on, the page says what
  // they are and offers a way to object that works on every browser.
  it("says what the page-speed timings are, and its switch turns them off on this device", () => {
    render(<LegalPage type="privacy" />);
    const page = document.body.textContent ?? "";
    expect(page).toContain("How fast our pages are");
    expect(page).toContain("delete them after 90 days");
    expect(page).toContain("It does not send the address of the page you opened");
    // Only what is true of the real system (12 November 2026): the host's own
    // request logs record the address, and Safari clears the stored choice.
    expect(page).toContain("our own server does not log it; our hosting provider's standard request logs record it");
    expect(page).not.toContain("we do not keep that with the timings or log it");
    expect(page).toContain("until the browser clears our site's data (Safari does this after about a week without a visit)");
    const button = screen.getByRole("button", { name: "Don't measure my visits" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(measurementDeclined()).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Your visits on this device are not measured.");
    fireEvent.click(button);
    expect(measurementDeclined()).toBe(false);
  });

  it("says what the dietary note is, who reads it, that logs leave it out, and how long it is kept", () => {
    const text = textOf("privacy");
    expect(text).toContain("Dietary and allergy notes for an event");
    expect(text).toContain("The note is health information.");
    expect(text).toContain("Please give allergens and numbers, not guests' names.");
    expect(text).toContain("The note is kept out of our server logs and error reports.");
    // The period comes from the one definition the retention pass runs on.
    expect(text).toContain(`${String(DIETARY_NOTE_RETENTION.daysAfterEvent)} days after the event`);
    expect(text).toContain("24 months after it last changed");
  });

  it("describes both paths for the note: left unticked, and remembered with the planner's account", () => {
    const text = textOf("privacy");
    // The box, word for word as the planner shows it, and that it starts unticked.
    expect(text).toContain(`asked "${DIETARY_MEMORY_CONSENT.question}" The box starts unticked.`);
    expect(text).toContain("Left unticked, the note stays with that event only.");
    expect(text).toContain("we record who ticked the box, when, and the words beside it");
    expect(text).toContain("They can see and remove that copy at any time.");
    // How long the remembered copy is kept, from the same definition the API runs on.
    expect(text).toContain("An allergy note you asked us to remember");
    expect(text).toContain(`If ${String(DIETARY_MEMORY_MONTHS_UNUSED)} months pass without it being saved with a layout, we remove it.`);
    // Withdrawal is real and immediate.
    expect(text).toContain("you can take that back at any time");
    const link = screen.getByRole("link", { name: "See or remove them (sign in first)" });
    expect(link.getAttribute("href")).toBe("/account/allergy-notes");
  });

  it("names no lawful condition for the health note: that is the venue adviser's to confirm", () => {
    const text = textOf("privacy");
    for (const claim of ["Article 9", "explicit consent", "9(2)"]) {
      expect(text, `privacy policy claims "${claim}"`).not.toContain(claim);
    }
  });

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

  // Release audit ai-1: the events team's AI help sends an enquiry's words to
  // Anthropic, so the policy names it, says what is sent and what is not (as
  // the code that builds each request sends it), and that a person decides.
  it("names Anthropic for AI help, what it is sent, what it is not, and that a person decides", () => {
    render(<LegalPage type="privacy" />);
    const section = document.getElementById("who-else");
    const text = section?.textContent ?? "";
    expect(text).toContain("Anthropic");
    expect(text).toContain("used only when a member of the team asks for it");
    // All three paths: the summary, the proposal's message and the planner's brief reader.
    expect(text).toContain("a summary of your enquiry, the wording of a message to you about a proposal, or reading a description of your event");
    expect(text).toContain("where your enquiry stands and the day it arrived");
    expect(text).toContain("Email addresses and phone numbers it can recognise in those words are taken out first; anything else written there, such as a name, is sent as written.");
    expect(text).toContain("A message to you is also sent your name, so that it can address you.");
    expect(text).toContain("The email address and phone number you gave in the enquiry form's own fields are not sent.");
    expect(text).toContain("nothing it writes is sent to you without a person choosing to send it");
  });

  // v1.0 final review: clients and planners sign in too (/login and /register
  // are public, and a new account's default role is planner), so no part of
  // the policy may describe accounts as venue staff's alone.
  it("says clients and planners sign in, not only venue staff", () => {
    render(<LegalPage type="privacy" />);
    const held = document.getElementById("other-information")?.textContent ?? "";
    expect(held).toContain("Clients, planners and people who work for the venue can have an account on the planning tools.");
    expect(held).toContain("You do not need an account to send an enquiry.");
    expect(held).not.toContain("This part of the policy is about them, not about you as a visitor.");
    const cookies = document.getElementById("cookies")?.textContent ?? "";
    expect(cookies).toContain("so that clients, planners and venue staff with an account stay signed in");
    const processors = document.getElementById("who-else")?.textContent ?? "";
    expect(processors).toContain("It handles sign-in for clients, planners and venue staff");
    expect(processors).not.toContain("It handles staff sign-in");
  });

  it("says the site serves its own typefaces, and names the two pages that still use Google Fonts", () => {
    render(<LegalPage type="privacy" />);
    const cookies = document.getElementById("cookies")?.textContent ?? "";
    expect(cookies).toContain("The typefaces used by this site are served by the site itself, not by Google.");
    expect(cookies).toContain("/amissing-book/");
    expect(cookies).toContain("/trades-house-media/leaflet.html");
    // Visitors reach the leaflet at /trades-house/leaflet, which frames the file above.
    expect(cookies).toContain("the visitor leaflet (/trades-house/leaflet, and its printable copy at /trades-house-media/leaflet.html)");
    expect(cookies).not.toContain("Two older standalone pages");
    expect(cookies).not.toContain("The typefaces used by this site are served by Google Fonts.");
  });

  it("says Resend also carries the acknowledgement sent to the guest", () => {
    render(<LegalPage type="privacy" />);
    const processors = document.getElementById("who-else")?.textContent ?? "";
    expect(processors).toContain("the acknowledgement of your enquiry that is sent to you");
    // Examples, not a closed list: Resend also sends hold reminders and request escalations.
    expect(processors).toContain("such as replies to enquiries, layout reviews, date-hold reminders, escalated requests and team invitations");
  });

  // Platform admins read every enquiry (routes/enquiries.ts), and a client reads an
  // enquiry made from their own account (canAccessResource), so staff alone is false.
  it("says who can see enquiry records, including the people who run the service", () => {
    const text = textOf("privacy");
    expect(text).toContain("to a client who made the enquiry from their own account, and to the people at Venviewer who run the service");
    expect(text).not.toContain("visible only to signed-in venue staff who hold the events role");
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
    expect(text).toContain(
      "The room capacities and rates shown on this site are the venue's own published figures.",
    );
    expect(text).toContain("subject to confirmation");
  });

  it("says the Grand Hall's dimensions were measured, not published by the venue", () => {
    // Blake, 11 November 2026: "The measured 21.14 x 10.59 m". Every page that
    // gives the Grand Hall's size gives the laser scan's, so the terms may not
    // call every room dimension the venue's own published figure.
    const text = textOf("terms");
    expect(text).toContain(
      "So are the room dimensions, except the Grand Hall's, which were measured from a laser scan of the hall.",
    );
    expect(text).not.toContain("capacities, dimensions and rates shown on this site are the venue's own published figures");
  });

  it("dates the version in force with the date the page shows", () => {
    render(<LegalPage type="terms" />);
    const shown = document.querySelector("time")?.textContent ?? "";
    expect(shown).toBe("11 November 2026");
    expect(document.getElementById("changes-to-terms")?.textContent).toContain(`dated ${shown}.`);
  });

  it("is governed by the law of Scotland", () => {
    expect(textOf("terms")).toContain("law of Scotland");
  });

  it("credits the LiDAR survey the planner's city is drawn from, under its licence", () => {
    render(<LegalPage type="terms" />);
    const section = document.getElementById("intellectual-property");
    expect(section?.textContent).toContain(
      "Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0",
    );
    const licence = screen.getByRole("link", { name: "Open Government Licence v3.0" });
    expect(section?.contains(licence)).toBe(true);
    expect(licence.getAttribute("href")).toBe(
      "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    );
    expect(licence.getAttribute("target")).toBe("_blank");
    expect(licence.getAttribute("rel")?.split(" ")).toContain("noopener");
  });

  it("credits the council's street lighting data the night street is drawn from", () => {
    render(<LegalPage type="terms" />);
    const section = document.getElementById("intellectual-property");
    expect(section?.textContent).toContain(
      "Contains public sector information licensed under the Open Government Licence v3.0. Street lighting: Glasgow City Council. "
        + "Contains OS data © Crown copyright and database right 2026.",
    );
  });
});

describe("the accessibility statement", () => {
  it("still says it was written on 15 August, whatever date the terms carry", () => {
    expect(textOf("accessibility")).toContain("It was written on 15 August 2026 by the team that builds the site");
  });

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

  it("lists the planner's single-key shortcuts and its cut-off tool hints as known problems", () => {
    render(<LegalPage type="accessibility" />);
    const known = document.getElementById("known-problems")?.textContent ?? "";
    expect(known).toContain("Single-key shortcuts in the planner");
    expect(known).toContain("WCAG success criterion 2.1.4, Character Key Shortcuts");
    expect(known).toContain("Hints in the planner's tools panel");
    expect(known).toContain("is cut off at the panel's edge");
    // On screen the button is a three-dot icon; its name is for screen readers.
    expect(known).toContain("a button marked with three dots");
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
