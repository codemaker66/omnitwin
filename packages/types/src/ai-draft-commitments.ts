import { z } from "zod";

// ---------------------------------------------------------------------------
// What an AI draft may not say (Plan 19, L6, 27 October 2026): a price, whether
// a date or room is available, or how many a room holds. Only the venue's team
// confirms these. A model has no authoritative source for any of them (prices
// are the quote's, availability the Diary's, capacity the venue's sourced
// figures), so a draft that states one is promising what nobody checked.
//
// The draft's rules tell the model so; this is the check after it. Each
// sentence of the draft is read, and a sentence that states one of the three
// is taken out before anyone sees the draft. The draft records which kinds were
// taken out, so the screen can say so. A draft with nothing left is no draft.
//
// The patterns are written for the claims, not the topics: "the team will
// confirm prices and availability" and "your 150 guests" stay; "£65 per head",
// "the Grand Hall is free on the 17th" and "it seats 200" go. They are
// tested on sentences written for them and on a second set written before the
// patterns were first run against it (__tests__/ai-draft-commitments.test.ts).
// They read English drafts; a human still reviews every draft.
// ---------------------------------------------------------------------------

export const AI_DRAFT_COMMITMENT_KINDS = ["price", "availability", "capacity"] as const;
export const AIDraftCommitmentKindSchema = z.enum(AI_DRAFT_COMMITMENT_KINDS);
export type AIDraftCommitmentKind = z.infer<typeof AIDraftCommitmentKindSchema>;

export interface AIDraftCommitment {
  readonly kind: AIDraftCommitmentKind;
  /** The words that made the claim, as the draft wrote them. */
  readonly phrase: string;
}

const NUM = String.raw`\d(?:[\d,.]*\d)?`;
/** A whole number: a lookahead after it cannot be met by backing off a digit. */
const WHOLE = String.raw`(?![\d,.]?\d)`;
/** A number that counts people or time, not money. */
const NOT_MONEY = String.raw`(?!\s*(?:guests|people|persons|covers|delegates|attendees|seated|standing|january|february|march|april|may|june|july|august|september|october|november|december|am\b|pm\b|hours?|minutes?|days?|weeks?|months?|years?))`;
/** A number that counts time, not people. */
const NOT_TIME = String.raw`(?!\s*(?:hours?|minutes?|mins?|days?|weeks?|months?|years?|am\b|pm\b|%|percent|january|february|march|april|may|june|july|august|september|october|november|december))`;
const ROOM_OR_DATE = String.raw`(?:date|day|evening|night|weekend|afternoon|morning|room|hall|saloon|space|suite|venue|it|that|this|they|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4})`;

const PATTERNS: Readonly<Record<AIDraftCommitmentKind, readonly RegExp[]>> = {
  price: [
    // An amount of money: a currency sign or code beside a number, or a number in pounds.
    new RegExp(String.raw`[£$\u20ac]\s?${NUM}`, "iu"),
    new RegExp(String.raw`\b(?:gbp|usd|eur)\s?${NUM}`, "iu"),
    new RegExp(String.raw`\b${NUM}\s?(?:k\s)?(?:pounds?|quid|gbp|usd|eur|euros?|dollars?|pence|p\b)`, "iu"),
    // A charge per guest.
    new RegExp(String.raw`\b${NUM}\s?(?:pp|per (?:head|person|guest|cover))\b`, "iu"),
    // A pricing word that is given a figure: "the deposit is 500", "costs 900".
    new RegExp(String.raw`\b(?:price|cost|fee|charge|rate|deposit|hire|minimum spend|spend|vat|total|quote)[sd]?\s+(?:\w+\s+){0,3}?(?:is|are|of|at|from|would be|will be|comes? to|starts? at|totals?|totalling|be)\s+(?:around\s+|about\s+|just\s+|only\s+|roughly\s+)?${NUM}${WHOLE}${NOT_MONEY}`, "iu"),
    new RegExp(String.raw`\b(?:costs?|charges?|priced at|comes? to|totals?|totalling)\s+(?:around\s+|about\s+|just\s+|only\s+|roughly\s+)?${NUM}${WHOLE}${NOT_MONEY}`, "iu"),
    // A pricing promise with no figure.
    /\b(?:free of charge|no (?:extra |additional |hire )?(?:charge|cost|fee)|at no (?:extra |additional )?cost|complimentary|discount(?:ed)?|waive[ds]?|waiving|half[- ]price|reduced rate|special rate|included (?:in|at no) (?:the )?(?:price|cost|charge))\b/iu,
  ],
  availability: [
    // A date, a room or a time said to be free, open, booked or held, or not.
    new RegExp(String.raw`\b${ROOM_OR_DATE}(?:\s+(?:is|are|was|remains|will be|should be|looks|seems)|'s)\s+(?:still\s+|currently\s+|now\s+|definitely\s+)?(?:not\s+)?(?:available|free(?!\s+to\b)|open(?!\s+to\b)|yours|booked|taken|held|reserved|pencilled|secured|confirmed|unavailable)\b`, "iu"),
    /\b(?:isn't|aren't|wasn't)\s+(?:available|free|booked|taken)\b/iu,
    /\b(?:we|i)\s+(?:do\s+|still\s+)?(?:have|has)\s+(?:some\s+|good\s+|limited\s+|no\s+)?availability\b/iu,
    /\b(?:there\s+is|there's|there\s+are)\s+(?:still\s+)?(?:some\s+|no\s+)?(?:availability|other bookings|other events)\b/iu,
    /\b(?:fully|already|provisionally)\s+(?:booked|held|reserved)\b/iu,
    // Held for the client, or confirmed to them.
    /\b(?:held|reserved|pencilled(?:\s+in)?|secured|blocked out|set aside)\s+(?:the\s+\w+\s+|it\s+|that\s+date\s+)?for\s+you\b/iu,
    /\b(?:we|i)(?:'ve| have| has)?\s+(?:held|reserved|pencilled|secured|blocked)\b/iu,
    /\b(?:can|are happy to|are pleased to|am pleased to|'m pleased to|'re pleased to|'re happy to|am happy to)\s+confirm\b/iu,
    /\b(?:date|booking|room|hall|reservation|hold)\s+(?:is|has been)\s+(?:now\s+)?(?:confirmed|secured|guaranteed)\b/iu,
    /\bno other (?:bookings|events|enquiries)\b/iu,
  ],
  capacity: [
    // How many a room holds, seats or takes.
    new RegExp(String.raw`\b(?:seats?|holds?|accommodates?|fits?|takes?|caters? for|hosts?|welcomes?|sleeps?)\s+(?:up to\s+|a maximum of\s+|as many as\s+|over\s+|more than\s+|around\s+|about\s+|nearly\s+|almost\s+)?${NUM}${WHOLE}${NOT_TIME}`, "iu"),
    new RegExp(String.raw`\bcapacit(?:y|ies)\b[^.!?\n]{0,40}?\b${NUM}\b`, "iu"),
    new RegExp(String.raw`\b${NUM}\b[^.!?\n]{0,25}?\bcapacity\b`, "iu"),
    new RegExp(String.raw`\b(?:up to|a maximum of|maximum of|max(?:imum)?\.?|no more than|at most)\s+${NUM}${WHOLE}${NOT_TIME}`, "iu"),
    new RegExp(String.raw`\broom for\s+(?:up to\s+)?${NUM}`, "iu"),
    // That a room fits the party, with or without a figure.
    /\b(?:(?:comfortably|easily|happily|well)\s+(?:seat|hold|accommodate|fit|take|host)|(?:big|large|spacious|roomy) enough|plenty of (?:room|space)|ample (?:room|space)|within (?:the |its |our )?capacity|over capacity|too (?:small|large|big) for)\b/iu,
    /\b(?:seat|hold|accommodate|fit|take)s?\s+(?:all\s+)?(?:of\s+)?(?:your|the|all|everyone|every)\b[^.!?\n]{0,20}?\b(?:guests|people|party|delegates|attendees|everyone)\b/iu,
  ],
};

// Curly apostrophes read as straight ones, so a curly "isn't" is read as one.
function plain(text: string): string {
  return text.replace(/[\u2018\u2019\u02bc]/gu, "'");
}

/** Every price, availability or capacity claim in the text, at most one per kind. */
export function findDraftCommitments(text: string): readonly AIDraftCommitment[] {
  const read = plain(text);
  const found: AIDraftCommitment[] = [];
  for (const kind of AI_DRAFT_COMMITMENT_KINDS) {
    for (const pattern of PATTERNS[kind]) {
      const match = pattern.exec(read);
      if (match !== null) {
        found.push({ kind, phrase: match[0] });
        break;
      }
    }
  }
  return found;
}

// A sentence ends at ., ! or ? followed by space, or at the end of its line.
const SENTENCE = /[^.!?]+(?:[.!?]+(?=\s|$)|$)|[.!?]+/gu;

function sentencesOf(line: string): string[] {
  return line.match(SENTENCE) ?? [];
}

/**
 * The draft with every sentence that states a price, availability or capacity
 * taken out, line by line, so its paragraphs and sign-off keep their shape;
 * and the kinds taken out, in a fixed order. A line left empty goes, and no
 * more than one blank line is left between paragraphs.
 */
export function withholdDraftCommitments(text: string): {
  readonly text: string;
  readonly withheld: readonly AIDraftCommitmentKind[];
} {
  const withheld = new Set<AIDraftCommitmentKind>();
  const lines = text.split("\n").map((line) => {
    const kept = sentencesOf(line).filter((sentence) => {
      const claims = findDraftCommitments(sentence);
      for (const claim of claims) withheld.add(claim.kind);
      return claims.length === 0;
    });
    const rebuilt = kept.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "").join(" ");
    // A line that held only withheld sentences goes; a line that was blank stays a paragraph break.
    return { rebuilt, dropped: rebuilt === "" && line.trim() !== "" };
  });
  const joined = lines.filter((line) => !line.dropped).map((line) => line.rebuilt).join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return {
    text: joined,
    withheld: AI_DRAFT_COMMITMENT_KINDS.filter((kind) => withheld.has(kind)),
  };
}
