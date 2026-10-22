import { describe, expect, it } from "vitest";
import { askFor, roomPhrase, type AskContext } from "../unrecorded-ask.js";

const GUEST: AskContext = {
  audience: "guest",
  roomName: "Grand Hall",
  venueEmail: "info@tradeshallglasgow.co.uk",
  planUrl: "https://venviewer.com/plan/config-1",
};
const STAFF: AskContext = { ...GUEST, audience: "staff" };

function decodedHref(href: string | null): string {
  return decodeURIComponent(href ?? "");
}

describe("askFor — a fact nobody recorded becomes a person to ask", () => {
  it("sends a guest to the events team at the venue's published address", () => {
    const ask = askFor("rigging-point", GUEST);
    expect(ask.label).toBe("Ask the events team");
    expect(ask.who).toBe("the events team");
    expect(ask.href).toMatch(/^mailto:info@tradeshallglasgow\.co\.uk\?subject=/);
    expect(ask.fallback).toBeNull();
  });

  it("sends venue staff to the hallkeeper, with no address guessed for him", () => {
    const ask = askFor("power-supply", STAFF);
    expect(ask.label).toBe("Ask the hallkeeper");
    expect(ask.href).toMatch(/^mailto:\?subject=/);
  });

  it("sends staff to the events team for a published capacity or a price", () => {
    expect(askFor("room-capacity", STAFF).label).toBe("Ask the events team");
    expect(askFor({ kind: "quote", guests: 80, tables: 10, chairs: 80 }, STAFF).who).toBe("the events team");
  });

  it("writes the question and links back to the plan", () => {
    const ask = askFor("escape-routes", GUEST);
    expect(ask.question).toBe("What does the fire risk assessment allow in the Grand Hall: the maximum number of people, and the escape routes for this layout?");
    const href = decodedHref(ask.href);
    expect(href).toContain("subject=Escape routes and maximum numbers in the Grand Hall");
    expect(href).toContain("The plan: https://venviewer.com/plan/config-1");
  });

  it("asks for a quote including VAT and every compulsory charge", () => {
    const ask = askFor({ kind: "quote", guests: 120, tables: 15, chairs: 120 }, GUEST);
    expect(ask.label).toBe("Ask us for a quote");
    expect(ask.question).toBe("Could you quote for 120 guests in the Grand Hall, including VAT and any compulsory charges? The plan has 15 tables and 120 chairs.");
  });

  it("asks about a count above the published figure as a question, not a refusal", () => {
    const ask = askFor({ kind: "headcount", guests: 200, figure: 180, formatLabel: "dinner" }, GUEST);
    expect(ask.question).toBe("We are planning 200 guests for dinner in the Grand Hall, more than the published 180. Is that possible, and what would it need?");
  });

  it("asks how the venue would lay out a count the plan has no room for, stating seats, not a capacity", () => {
    const ask = askFor({ kind: "layout", guests: 170, seatsPlaced: 140, occasion: "a seated dinner" }, GUEST);
    expect(ask.label).toBe("Ask the events team");
    expect(ask.question).toBe("We are planning 170 guests for a seated dinner in the Grand Hall. The plan has 140 seats, with no room for another table at the online planner's spacing. How would you lay the room out for 170?");
    expect(ask.question).not.toMatch(/\b(?:fits?|capacity)\b/);
    expect(decodedHref(ask.href)).toContain("subject=170 guests in the Grand Hall");
  });

  it("names who to ask when the venue publishes no address", () => {
    const ask = askFor("door-positions", { ...GUEST, venueEmail: null });
    expect(ask.href).toBeNull();
    expect(ask.fallback).toBe("Ask the venue's events team when you send your enquiry.");
    expect(ask.label).toBe("Ask the events team");
  });

  it("encodes a room name so it cannot add fields to the mail link", () => {
    const ask = askFor("door-positions", { ...GUEST, roomName: "Hall&cc=attacker@example.com?x" });
    expect(ask.href).not.toContain("&cc=");
    expect(decodedHref(ask.href)).toContain("Doors in the Hall&cc=attacker@example.com?x");
  });

  it("leaves the plan line out when no plan link is known", () => {
    const ask = askFor("door-positions", { ...GUEST, planUrl: null });
    expect(decodedHref(ask.href)).not.toContain("The plan:");
  });
});

describe("roomPhrase", () => {
  it("reads a room as the room", () => {
    expect(roomPhrase("Grand Hall")).toBe("the Grand Hall");
    expect(roomPhrase("The Saloon")).toBe("the Saloon");
    expect(roomPhrase(null)).toBe("this room");
    expect(roomPhrase("   ")).toBe("this room");
  });
});
