// ---------------------------------------------------------------------------
// unrecorded-ask — a fact nobody recorded becomes a person to ask.
//
// The planner no longer turns an assumed input into a verdict: no "Within WLL"
// on a default 500 kg, no bottleneck score on doors placed mid-wall, no exit
// widths quoted from another country's code, no example price shown as the
// venue's. Where the fact is missing, the panel says "Not recorded" (or "Ask
// us for a quote") and offers this: the named person to ask, and a drafted
// question the viewer sends themselves. Nothing is sent automatically (a
// person sends, and a person decides), and no reply time is promised because
// none is recorded (redteam fix-first 2 and 3).
//
// Venue staff ask the hallkeeper, who keeps the building's facts; the mail
// opens with no recipient so they choose him from their own address book.
// Clients and visitors ask the events team at the address the venue publishes,
// or are told who to ask when the venue publishes none.
// ---------------------------------------------------------------------------

export type UnrecordedFact = "rigging-point" | "power-supply" | "door-positions" | "escape-routes" | "room-capacity";

/** A guest count above the venue's published figure: the "no" that needs a
 *  way forward, asked as a question rather than refused. */
export interface HeadcountQuestion {
  readonly kind: "headcount";
  readonly guests: number;
  readonly figure: number;
  /** The published format in words, lower case: "dinner". */
  readonly formatLabel: string;
}

/** A price for this plan, which only the venue's events team can give. */
export interface QuoteQuestion {
  readonly kind: "quote";
  readonly guests: number | null;
  readonly tables: number;
  readonly chairs: number;
}

/** A guest count the planner cannot lay out at its own spacing: how the venue
 *  would set the room for it. */
export interface LayoutQuestion {
  readonly kind: "layout";
  readonly guests: number;
  /** Seats the planner fits at its spacing. */
  readonly roomFor: number;
  /** The occasion in words: "a seated dinner". */
  readonly occasion: string;
}

export type AskTopic = UnrecordedFact | HeadcountQuestion | QuoteQuestion | LayoutQuestion;

export type AskAudience = "staff" | "guest";

export interface AskContext {
  readonly audience: AskAudience;
  /** The room's display name ("Grand Hall"), or null when unknown. */
  readonly roomName: string | null;
  /** The venue's published enquiry address, for guests; null when it publishes none. */
  readonly venueEmail: string | null;
  /** A link back to this plan, included in the drafted question when known. */
  readonly planUrl?: string | null;
}

export interface AskAction {
  /** "Ask the hallkeeper" / "Ask the events team" / "Ask us for a quote". */
  readonly label: string;
  /** The person, in a sentence: "the hallkeeper". */
  readonly who: string;
  /** A mailto: link carrying the drafted question, or null when there is no
   *  way to address it from here. */
  readonly href: string | null;
  /** What to do instead when there is no link. */
  readonly fallback: string | null;
  /** The drafted question, as it will appear in the mail. */
  readonly question: string;
}

/** "the Grand Hall"; a name that already starts with "The" keeps its own. */
export function roomPhrase(roomName: string | null): string {
  const name = roomName?.trim() ?? "";
  if (name === "") return "this room";
  return /^the\s/i.test(name) ? `the ${name.slice(4).trimStart()}` : `the ${name}`;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

function subjectFor(topic: AskTopic, room: string): string {
  if (typeof topic !== "string") {
    return topic.kind === "quote" ? `Quote for ${room}` : `${String(topic.guests)} guests in ${room}`;
  }
  switch (topic) {
    case "rigging-point": return `Rigging point in ${room}`;
    case "power-supply": return `Power supply in ${room}`;
    case "door-positions": return `Doors in ${room}`;
    case "escape-routes": return `Escape routes and maximum numbers in ${room}`;
    case "room-capacity": return `Capacity of ${room}`;
  }
}

function questionFor(topic: AskTopic, room: string): string {
  if (typeof topic !== "string") {
    if (topic.kind === "quote") {
      const guests = topic.guests !== null ? `${plural(topic.guests, "guest")} in ${room}` : room;
      const layout = topic.tables > 0 || topic.chairs > 0
        ? ` The plan has ${plural(topic.tables, "table")} and ${plural(topic.chairs, "chair")}.`
        : "";
      return `Could you quote for ${guests}, including VAT and any compulsory charges?${layout}`;
    }
    if (topic.kind === "layout") {
      return `We are planning ${String(topic.guests)} guests for ${topic.occasion} in ${room}. The online planner fits ${String(topic.roomFor)} at its spacing. How would you lay the room out for ${String(topic.guests)}?`;
    }
    return `We are planning ${String(topic.guests)} guests for ${topic.formatLabel} in ${room}, more than the published ${String(topic.figure)}. Is that possible, and what would it need?`;
  }
  switch (topic) {
    case "rigging-point":
      return `What is the working load limit of the rigging point we would use in ${room}, what is it rated for (static, manual hoist or power hoist), and who signed it off?`;
    case "power-supply":
      return `What power is available in ${room} for lighting: how many phases, and what breaker rating on each phase?`;
    case "door-positions":
      return `Where are the doors in ${room}, and how wide is each clear opening?`;
    case "escape-routes":
      return `What does the fire risk assessment allow in ${room}: the maximum number of people, and the escape routes for this layout?`;
    case "room-capacity":
      return `What capacity do you publish for ${room}, by layout?`;
  }
}

function whoFor(topic: AskTopic, audience: AskAudience): string {
  if (audience === "guest") return "the events team";
  if (topic === "room-capacity" || (typeof topic !== "string" && topic.kind === "quote")) return "the events team";
  return "the hallkeeper";
}

function labelFor(topic: AskTopic, who: string): string {
  return typeof topic !== "string" && topic.kind === "quote" ? "Ask us for a quote" : `Ask ${who}`;
}

function mailto(address: string, subject: string, body: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The person to ask about a fact nobody recorded (a missing building fact, a
 *  count above the published figure, or a price), and the drafted question. Pure. */
export function askFor(topic: AskTopic, context: AskContext): AskAction {
  const room = roomPhrase(context.roomName);
  const who = whoFor(topic, context.audience);
  const question = questionFor(topic, room);
  const planLine = context.planUrl !== undefined && context.planUrl !== null && context.planUrl !== ""
    ? `\n\nThe plan: ${context.planUrl}`
    : "";
  const body = `${question}${planLine}`;
  const subject = subjectFor(topic, room);
  const label = labelFor(topic, who);

  if (context.audience === "staff") {
    // No recipient: the hallkeeper is a colleague in the sender's own address
    // book, and the planner holds no address for him.
    return { label, who, href: mailto("", subject, body), fallback: null, question };
  }
  const email = context.venueEmail?.trim() ?? "";
  if (email !== "") {
    return { label, who, href: mailto(email, subject, body), fallback: null, question };
  }
  return {
    label,
    who,
    href: null,
    fallback: "Ask the venue's events team when you send your enquiry.",
    question,
  };
}
