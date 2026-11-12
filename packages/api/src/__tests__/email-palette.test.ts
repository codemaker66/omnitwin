import { describe, expect, it } from "vitest";
import { WORKSPACE_COLOURS } from "@omnitwin/types";
import {
  EMAIL_TEXT_PAIRS,
  configApproved,
  configChangesRequested,
  configRejected,
  configSubmitted,
  enquiryAcknowledgement,
  enquiryApproved,
  enquiryRejected,
  hallkeeperNotified,
  holdDecisionReminder,
  newEnquiryNotification,
  requestEscalation,
  venueTeamInvitation,
} from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// The emails' colours: every one a House value, every text pair measured.
//
// The emails used a navy, blue and grey palette of their own, and their muted
// ink (#999 on #f5f5f0) measured 2.6:1. Client email text now holds 7:1
// (goals/01). These tests measure each declared text pair with the WCAG
// formula and refuse any colour in the rendered HTML that the House register
// does not define, so a hue cannot be invented in a template unnoticed.
// ---------------------------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? "0", 16));
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every colour written into a style attribute, lower-cased. */
function styleColours(html: string): string[] {
  const colours: string[] = [];
  for (const style of html.matchAll(/style="([^"]*)"/gu)) {
    for (const hex of (style[1] ?? "").matchAll(/#[0-9a-f]{3,8}\b/giu)) colours.push(hex[0].toLowerCase());
  }
  return colours;
}

/** Every text colour (`color:`, not `background-color:`) in a style attribute. */
function textColours(html: string): string[] {
  const colours: string[] = [];
  for (const style of html.matchAll(/style="([^"]*)"/gu)) {
    for (const decl of (style[1] ?? "").matchAll(/(?:^|;)\s*color:\s*(#[0-9a-f]{3,8})\b/giu)) {
      colours.push((decl[1] ?? "").toLowerCase());
    }
  }
  return colours;
}

const HOUSE_VALUES = new Set(Object.values(WORKSPACE_COLOURS).map((value) => value.toLowerCase()));
const CLIENT_TEXT = new Set(EMAIL_TEXT_PAIRS.filter((pair) => pair.floor === 7).map((pair) => pair.text.toLowerCase()));

const review = { eventName: "Henderson wedding", venueName: "Trades Hall Glasgow", spaceName: "Grand Hall", snapshotVersion: 3 };

/** Every email that goes out on the shared letterheads (Layout, VenueLayout). */
async function letterheadEmails(): Promise<readonly { readonly name: string; readonly html: string }[]> {
  const rendered = await Promise.all([
    newEnquiryNotification({
      roomName: "Grand Hall", source: "website", eventType: "Wedding", contactName: "Jane Smith",
      contactEmail: "jane@example.test", contactPhone: null, eventDate: "2027-05-14", guestCount: 120,
      message: "A reception for 120.", dashboardUrl: "https://example.test/dashboard",
    }),
    enquiryAcknowledgement({
      venueName: "Trades Hall Glasgow", roomName: "Grand Hall", organiserName: "Jane Smith", eventType: "Wedding",
      eventDate: "2027-05-14", guestCount: 120, replyToEmail: "events@example.test",
    }),
    enquiryApproved({ venueName: "Trades Hall Glasgow", roomName: "Grand Hall", eventDate: "2027-05-14", configUrl: "https://example.test/plan/1" }),
    enquiryRejected({ venueName: "Trades Hall Glasgow", roomName: "Grand Hall", eventDate: "2027-05-14", note: "The hall is taken that day." }),
    configSubmitted({ ...review, submittedByName: "Jane Smith", reviewUrl: "https://example.test/review" }),
    configApproved({
      ...review, approvedByName: "Elaine", approvedAt: "14 May 2027", hallkeeperUrl: "https://example.test/h",
      editorUrl: "https://example.test/plan/1", note: "Approved as drawn.",
    }),
    configRejected({ ...review, rejectedByName: "Elaine", editorUrl: "https://example.test/plan/1", note: "Exits are blocked." }),
    configChangesRequested({ ...review, requestedByName: "Elaine", editorUrl: "https://example.test/plan/1", note: "Move the top table." }),
    hallkeeperNotified({ ...review, eventDate: "2027-05-14", hallkeeperUrl: "https://example.test/h" }),
    requestEscalation({
      adminName: "Elaine", kindLabel: "Chairs", quantity: 10, roomName: "Grand Hall", requestedByName: "Sam",
      detail: null, waitingMinutes: 12, dayBoardUrl: "https://example.test/day",
    }),
    venueTeamInvitation({
      venueName: "Trades Hall Glasgow", inviterName: "Elaine", email: "sam@example.test", roleLabel: "Hallkeeper",
      roleSummary: "The room on the day: sheets, setup and requests", openUntil: "Tuesday 24 November 2026",
      signUpUrl: "https://example.test/register",
    }),
  ]);
  const names = [
    "new enquiry", "acknowledgement", "approved", "rejected", "config submitted", "config approved",
    "config rejected", "config changes requested", "hallkeeper notified", "request escalation", "team invitation",
  ];
  return rendered.map((email, index) => ({ name: names[index] ?? String(index), html: email.html }));
}

describe("email palette", () => {
  it("holds every declared text pair to its floor: 7:1 for what clients read", () => {
    expect(EMAIL_TEXT_PAIRS.length).toBeGreaterThan(0);
    for (const pair of EMAIL_TEXT_PAIRS) {
      const ratio = contrast(pair.text, pair.ground);
      expect(ratio, `${pair.use}: ${pair.text} on ${pair.ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(pair.floor);
    }
  });

  it("would have caught the old muted ink, which is why it is gone", () => {
    // The retired INK_MUTED on the retired page ground: under any floor.
    expect(contrast("#999999", "#f5f5f0")).toBeLessThan(3);
  });

  it("writes only House colours into every letterhead email", async () => {
    for (const { name, html } of await letterheadEmails()) {
      const colours = styleColours(html);
      expect(colours.length, name).toBeGreaterThan(0);
      for (const colour of colours) {
        expect(HOUSE_VALUES.has(colour), `${name}: ${colour} is not a House colour`).toBe(true);
      }
      for (const retired of ["#999", "#999999", "#1a1a2e", "#3b82f6", "#333", "#555", "#fff", "#eee"]) {
        expect(colours, `${name}: retired ${retired}`).not.toContain(retired);
      }
    }
  });

  it("sets every letterhead text in an ink measured at 7:1", async () => {
    for (const { name, html } of await letterheadEmails()) {
      const colours = textColours(html);
      expect(colours.length, name).toBeGreaterThan(0);
      for (const colour of colours) {
        expect(CLIENT_TEXT.has(colour), `${name}: text colour ${colour} has no 7:1 pair`).toBe(true);
      }
    }
  });

  it("is valid table markup, so every sentence and the footer stay inside the sheet", async () => {
    // MetaRow used react-email's <Row>, which renders a whole <table>; inside
    // the facts table's <tbody> that is a parse error a browser repairs by
    // closing the sheet early, so the closing paragraphs and the footer fell
    // out of it (seen rendering the acknowledgement on 17 October 2026).
    for (const { name, html } of await letterheadEmails()) {
      expect(html, name).not.toMatch(/<tbody[^>]*>\s*<table/iu);
    }
  });

  it("keeps the staff-only hold reminder on House colours too", async () => {
    const { html } = await holdDecisionReminder({
      holdTitle: "Henderson wedding", spaceName: "Grand Hall", ownerName: "Elaine",
      holdDate: "Saturday 14 November 2026", decisionDate: "Friday 2 October 2026",
      daysUntilDecision: 3, rank: 1, jointFlag: false, diaryUrl: "https://example.test/diary",
    });
    const declared = new Set(EMAIL_TEXT_PAIRS.map((pair) => pair.text.toLowerCase()));
    for (const colour of styleColours(html)) expect(HOUSE_VALUES.has(colour), colour).toBe(true);
    for (const colour of textColours(html)) expect(declared.has(colour), `hold reminder text ${colour}`).toBe(true);
  });

  it("sends a client's decision on the venue's letterhead, not the platform's", async () => {
    for (const { html } of [
      await enquiryApproved({ venueName: "Trades Hall Glasgow", roomName: null, eventDate: null, configUrl: null }),
      await enquiryRejected({ venueName: "Trades Hall Glasgow", roomName: null, eventDate: null, note: null }),
    ]) {
      expect(html).not.toContain("VENVIEWER");
      expect(html).toContain("Sent by the events team at Trades Hall Glasgow");
    }
  });

  it("says a refusal's date as a person does, and offers the next step", async () => {
    const { html } = await enquiryRejected({ venueName: "Trades Hall Glasgow", roomName: "Grand Hall", eventDate: "2027-05-14", note: null });
    expect(html).toContain("Friday 14 May 2027");
    expect(html).not.toContain("2027-05-14");
    expect(html).toContain("reply to this message");
  });
});

// The acknowledgement speaks for the venue to every public enquirer. It
// promises no reply time: the venue has not said what it keeps to
// (questionnaire Q28, roadmap A6; trust check, 28 October 2026).
describe("the enquiry acknowledgement's promises", () => {
  it("says a person will reply, and promises no time for it", async () => {
    const { html } = await enquiryAcknowledgement({
      venueName: "Trades Hall Glasgow", roomName: "Grand Hall", organiserName: "Jane Smith", eventType: "Wedding",
      eventDate: "2027-05-14", guestCount: 120, replyToEmail: "events@example.test",
    });
    expect(html).toContain("one of us will come back to you personally.");
    expect(html).not.toMatch(/working day|within \d+|within (one|a|two|three|24|48)\b|\bhours?\b|same day|tomorrow/iu);
  });
});
