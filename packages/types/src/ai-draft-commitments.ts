import { z } from "zod";

// ---------------------------------------------------------------------------
// What an AI draft may not say (Plan 19, L6, 27 October 2026): a price, whether
// a date or room is available, or how many a room holds. Only the venue's team
// confirms these. A model has no authoritative source for any of them (prices
// are the quote's, availability the Diary's, capacity the venue's sourced
// figures), so a draft that states one is promising what nobody checked.
//
// The draft's rules tell the model so, and that is the first guard; a person
// reads every draft before it is used, and that is the last. This check sits
// between them and is written for precision: it takes out a sentence only
// where the words have a claim's shape (an amount of money; a date or room
// said to be free or taken; "we have held the date for you"; a room that seats
// a number), and leaves the topic alone ("the team will confirm prices and
// availability", "your 150 guests", "set-up takes 4 staff"). A clause that
// reports what the client asked, said or can spend ("you asked whether the
// 17th is free", "their budget is around £10,000") is theirs, and stays, as
// does a claim asked about ("the team will confirm whether the Saloon is
// free"). It misses claims phrased in ways it does not know: on three sets
// written by agents that never saw it, it found 104 of 160 claims on first
// reading, and took out 7 of 160 sentences that made none.
//
// It reads a draft line by line and a line sentence by sentence, the same way
// for finding and for taking out, so what is taken out is exactly what is
// found, and a draft whose claims are out is one the schema accepts. Splitting
// a line into sentences loses nothing: the pieces join back into the line.
// Every pattern is bounded, so its time grows with the text, not its square.
// The sentence sets it is measured on are in __tests__/ai-draft-commitments.test.ts.
// ---------------------------------------------------------------------------

export const AI_DRAFT_COMMITMENT_KINDS = ["price", "availability", "capacity"] as const;
export const AIDraftCommitmentKindSchema = z.enum(AI_DRAFT_COMMITMENT_KINDS);
export type AIDraftCommitmentKind = z.infer<typeof AIDraftCommitmentKindSchema>;

export interface AIDraftCommitment {
  readonly kind: AIDraftCommitmentKind;
  /** The words that made the claim, as the draft wrote them. */
  readonly phrase: string;
}

// A number, bounded so no pattern backs off through a long run of digits:
// "1,500", "12.50", "180". WHOLE stops a lookahead being met by backing off a digit.
const NUM = String.raw`\d(?:[\d,.]{0,12}\d)?`;
const WHOLE = String.raw`(?![\d,.]?\d)`;
// A number in words, as a room's size is written: "two hundred", "a hundred and fifty".
const WORD_NUM = String.raw`(?:(?:a|one|two|three|four|five|six|seven|eight|nine|several|a\s+few)\s+hundred(?:\s+and\s+[a-z]+)?|hundreds|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-[a-z]+)?)`;
const COUNT = String.raw`(?:${NUM}${WHOLE}|${WORD_NUM})`;
/** Not a time or a span of time: "until midnight", "6pm", "20 minutes". */
const NOT_TIME = String.raw`(?!\s*(?:am\b|pm\b|a\.m\.|p\.m\.|o'clock|hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|until|till|to\s+\d|[-\u2013]\s*\d|%|percent))`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAY = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)days?`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)`;
/** A date, as drafts write one: "the 17th", "14 August", "Saturday 17th June", "June 1st", "17 September 2027". */
const DATE = String.raw`(?:(?:${WEEKDAY}\s+)?(?:the\s+)?(?:${ORDINAL}|\d{1,2})(?:\s+(?:of\s+)?${MONTH})?(?:\s+\d{4})?|${MONTH}\s+(?:${ORDINAL}|\d{1,2})(?:,?\s+\d{4})?|${WEEKDAY})`;
/** What can be free or taken: a date, a room, the Diary. */
const SLOT = String.raw`(?:${DATE}|(?:the\s+|that\s+|this\s+|your\s+)?(?:date|day|slot|evening|night|weekend|afternoon|morning|room|rooms|hall|saloon|suite|venue|diary)|both\s+rooms|it|that|this)`;
const IS = String.raw`(?:\s*\([^()\n]{1,30}\))?(?:\s+(?:is|are|was|remains|remain|would\s+be|will\s+be|should\s+be|looks|look|seems)|'s|\u2019s)`;
/** Free, as availability: followed by nothing, or by when or where, never "free of columns" or "free text". */
const FREE = String.raw`free(?=\s*(?:$|[.,;:!?)\u2014\u2013]|-\s|on\b|that\b|this\b|then\b|in\b|at\b|for\s+(?:you|your\s+(?:date|day|event|wedding|dinner|party))\b))`;
/** Open, as availability: never opening hours ("open until midnight", "open to everyone"). */
const OPEN = String.raw`open(?!\s+(?:until|till|from|to|at|for|between|daily|late))`;
const ROOM = String.raw`(?:hall|room|saloon|suite|space|venue|it)`;
const PEOPLE = String.raw`(?:guests|people|persons|covers|delegates|attendees|seated|standing|for\s+dinner|for\s+a\s+(?:dinner|reception|ceremony))`;
const ABOUT = String.raw`(?:up\s+to\s+|a\s+maximum\s+of\s+|as\s+many\s+as\s+|over\s+|more\s+than\s+|around\s+|about\s+|approx(?:imately|\.)?\s+|nearly\s+|almost\s+|roughly\s+)?`;
/** What can follow an amount of money said bare: the end, "for the room", "plus VAT", "altogether". */
const MONEY_TAIL = String.raw`(?=\s*(?:$|[.,;!?)]|for\b|plus\b|\+|altogether\b|in\s+total\b|incl|inc\b|including\b|exc|excluding\b|ex\b|per\b|a\s+head\b|each\b))`;

/** Can or cannot: "can", "would", "can't", "won't". */
const MODAL = String.raw`(?:can|could|will|would|can't|can\u2019t|cannot|can\s+not|couldn't|couldn\u2019t|won't|won\u2019t|will\s+not|wouldn't|wouldn\u2019t|would\s+not)`;
/** A judgement of what the client's money will buy, which is the team's to make:
 *  "your budget should comfortably cover dinner", "well within your budget". */
const BUDGET_JUDGED = /\bbudget\b[^.!?;\n]{0,60}?\b(?:should|would|will|could)\s+(?:easily\s+|comfortably\s+|more\s+than\s+|just\s+about\s+)?(?:cover|stretch|be\s+(?:enough|plenty|ample|sufficient))\b|(?<!\b(?:keep|keeps|keeping|stay|stays|staying|remain|remaining)\s{1,3}(?:well\s{1,3})?)\b(?:well\s+)?(?:within|over|under|exceeds?|beyond)\s+(?:your|their|the|our)\s+budget\b/giu;

const PATTERNS: Readonly<Record<AIDraftCommitmentKind, readonly RegExp[]>> = {
  price: [
    // An amount of money by its sign or code: "£2,500", "GBP 4,200", "1500 GBP".
    new RegExp(String.raw`[£$\u20ac]\s?${NUM}`, "giu"),
    new RegExp(String.raw`\b(?:gbp|usd|eur)\s?${NUM}|\b${NUM}\s?(?:gbp|usd|eur)\b`, "giu"),
    // By its name: "1,800 pounds", "two thousand pounds", "2k for the room".
    new RegExp(String.raw`\b(?:${NUM}|${WORD_NUM}|(?:a|one|two|three|four|five|six|seven|eight|nine|ten)\s+thousand)\s?(?:pounds?|quid|euros?|dollars?)\b`, "giu"),
    new RegExp(String.raw`\b${NUM}\s?k\b${MONEY_TAIL}`, "giu"),
    // A charge per guest: "£65 per head", "65pp", "65 a head".
    new RegExp(String.raw`\b${NUM}${WHOLE}\s?(?:pp\b|per\s+(?:head|person|guest|cover)\b|a\s+head\b)`, "giu"),
    // A figure with VAT: "900 plus VAT", "1,000 + VAT", "1,000 including VAT".
    new RegExp(String.raw`\b${NUM}${WHOLE}\s*(?:\+|plus|inc(?:luding|l\.?)?|exc(?:luding|l\.?)?|ex)\s*vat\b`, "giu"),
    // A pricing word given a figure: "the deposit is 500", "room hire is 2,000", "a 500 deposit".
    new RegExp(String.raw`\b(?:deposit|minimum\s+spend|hire\s+fee|hire\s+charge|room\s+hire|venue\s+hire|exclusive\s+use|fee|price|cost|charge)s?(?:\s+[a-z]+){0,5}?\s+(?:is|are|would\s+be|will\s+be|of|comes?\s+to|starts?\s+(?:at|from)|from)\s+(?:around\s+|about\s+|just\s+|only\s+|roughly\s+)?${NUM}${WHOLE}(?!\s*(?:guests|people|covers|delegates|tables|chairs|staff|until|till|to\s+\d|am\b|pm\b|o'clock|hours?|minutes?|%|-\s*\d))`, "giu"),
    new RegExp(String.raw`\b(?:a|an)\s+${NUM}${WHOLE}\s+(?:deposit|hire\s+fee|minimum\s+spend|room\s+hire)\b`, "giu"),
    // A total said as money: "comes to 4,200", "works out at 3,000 altogether", "we'd be looking at 2,000 for the evening".
    new RegExp(String.raw`\b(?:comes?\s+to|works?\s+out\s+at|costs?|charges?|priced\s+at|looking\s+at|would\s+be|start(?:s|ing)?\s+from)\s+(?:about\s+|around\s+|roughly\s+|just\s+)?${NUM}${WHOLE}${MONEY_TAIL}`, "giu"),
    // A figure in thousands said as a price, whatever follows: "weddings start from 5,000 in the Grand Hall".
    new RegExp(String.raw`\b(?:comes?\s+to|works?\s+out\s+at|costs?|priced\s+at|looking\s+at|would\s+be|start(?:s|ing)?\s+(?:from|at))\s+(?:about\s+|around\s+|roughly\s+|just\s+)?\d{1,3}(?:,\d{3})+(?![\d,]|\s*(?:guests|people|persons|covers|delegates|attendees))`, "giu"),
    // A share of the price: "a 25% deposit", "10% off the room hire".
    /\b\d{1,3}(?:\.\d)?\s?%\s+(?:deposit|off|discount|surcharge|service\s+charge)\b|\b\d{1,3}\s?%\s+(?:of|on)\s+the\s+(?:total|hire|room\s+hire|balance|quote)\b|\b\d{1,3}\s?%\s+(?:less|more|lower|higher|cheaper|dearer)\b/giu,
    // A figure in thousands said in words: "costs a little over five thousand".
    /\b(?:costs?|priced\s+at|comes?\s+to|works?\s+out\s+at|start(?:s|ing)?\s+(?:at|from)|set\s+you\s+back)\s+(?:[a-z]+\s+){0,3}?(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+thousand\b/giu,
    // A chargeable thing said to cost nothing: "room hire is free when you book dinner", "corkage is waived".
    /\b(?:hire|room\s+hire|venue\s+hire|corkage|parking|cake\s+cutting|delivery|set-up|setup)\s+(?:is|are|would\s+be|will\s+be|comes)\s+(?:also\s+)?(?:free|included|waived|complimentary)\b/giu,
    /\b(?:deposit|discount|surcharge|service\s+charge|reduction)\s+of\s+\d{1,3}(?:\.\d)?\s?%/giu,
    BUDGET_JUDGED,
    // A price compared, held or waived in words: "a third cheaper", "rates are frozen", "won't cost you anything".
    /\b(?:cheaper|less\s+expensive|more\s+expensive|dearer)\b/giu,
    /\b(?:half|twice|double|triple|a\s+(?:third|quarter|fraction)\s+of)\s+the\s+(?:price|cost|rate|fee)\b/giu,
    /\bnothing\s+(?:extra\s+|more\s+|further\s+)?to\s+pay\b|\bincluded\s+in\s+(?:the|your|our)\s+(?:[a-z]+\s+){0,2}?(?:rate|price|cost|fee|hire\s+fee|room\s+hire)\b/giu,
    /\b(?:prices?|rates?|charges?|fees?)\s+(?:are|is|will\s+be|would\s+be)\s+(?:frozen|held|fixed|guaranteed|locked|the\s+same)\b/giu,
    /\b(?:won't|won\u2019t|will\s+not|wouldn't|wouldn\u2019t|doesn't|doesn\u2019t|does\s+not)\s+cost\s+(?:you\s+)?(?:anything|a\s+penny|any\s+more|extra)\b/giu,
    // A price promise with no figure.
    /\b(?:free\s+of\s+charge|for\s+free|at\s+no\s+(?:extra\s+|additional\s+)?cost|no\s+(?:extra\s+|additional\s+|hire\s+)?(?:charge|fee)\b|complimentary(?!\s+(?:about|of|on))|discount(?:ed|s)?|waive[ds]?|waiving|half[- ]price|reduced\s+rate|special\s+rate)/giu,
  ],
  availability: [
    // A date or room said to be free, open, booked or taken: "14 August is free in the Grand Hall",
    // "the Grand Hall would be available on that date", "the 17th has already gone".
    new RegExp(String.raw`\b${SLOT}${IS}\s+(?:still\s+|currently\s+|now\s+|definitely\s+|already\s+|usually\s+|normally\s+|provisionally\s+|tentatively\s+)?(?:not\s+)?(?:available(?!\s+(?:to\s+(?:download|view|see|read|browse|print|share|discuss)|on\s+request|online|here|below|from|in\s+(?:the\s+)?(?:pack|link|brochure)))|unavailable|${FREE}|${OPEN}|booked|fully\s+booked|taken|reserved|clear|gone)\b`, "giu"),
    new RegExp(String.raw`\b${SLOT}\s+(?:has|have)\s+(?:already\s+)?(?:gone|been\s+taken|been\s+booked)\b`, "giu"),
    /\b(?:isn't|aren't|wasn't|isn\u2019t|aren\u2019t|wasn\u2019t)\s+(?:available|free|booked|taken)\b/giu,
    /\bwe(?:'re|\u2019re|\s+are)\s+(?:still\s+)?free\s+(?:on|that|this|then)\b/giu,
    /\b(?:we|i)\s+(?:do\s+|still\s+)?(?:have|has)\s+(?:some\s+|good\s+|limited\s+|no\s+)?availability\b/giu,
    new RegExp(String.raw`\bwe\s+(?:still\s+)?have\s+(?:the\s+)?(?:${DATE}|date|day|evening|weekend|room|hall|saloon)\s+(?:free|open|available)\b`, "giu"),
    /\b(?:there\s+is|there's|there\u2019s|there\s+are)\s+(?:still\s+)?(?:some\s+)?availability\b/giu,
    /\b(?:no\s+other\s+(?:bookings?|events?)|nothing\s+else\s+(?:is\s+|has\s+been\s+)?booked)\b/giu,
    // Held for the client: "we have held the date for you", "we'll hold the date", "we could pencil you in".
    new RegExp(String.raw`\b(?:we|i)(?:'ve|\u2019ve|'ll|\u2019ll|\s+have|\s+will|\s+can|\s+could|\s+would)?\s+(?:be\s+(?:happy|glad)\s+to\s+)?(?:hold|held|reserve|reserved|pencil|pencilled|penciled|secure|secured|block|blocked)\s+(?:out\s+)?(?:the|your|that|this)\s+(?:[a-z]+\s+){0,2}?(?:date|day|room|hall|saloon|suite|space|evening|weekend|${ORDINAL})\b`, "giu"),
    /\bpencil(?:led|ed)?\s+you\s+in\b/giu,
    /\b(?:provisionally|tentatively)\s+(?:held|booked|reserved|pencilled|penciled|taken)\b|\bon\s+(?:a\s+)?(?:provisional\s+|first[- ]option\s+|second[- ]option\s+)hold\b/giu,
    /\b(?:placed|put|made|taken)\s+(?:a\s+)?(?:provisional\s+|first[- ]option\s+|second[- ]option\s+)?hold\s+on\b/giu,
    /\b(?:date|wedding|event|booking|day)\s+is\s+(?:now\s+)?(?:locked|booked|pencilled)\s+in\b|\blocked\s+in\s+with\s+us\b/giu,
    /\b(?:event|booking|wedding|dinner|date)\s+(?:is\s+|has\s+been\s+)?confirmed\s+(?:for|on)\b/giu,
    /\bno\s+clash(?:es)?\b/giu,
    // Said as a note, or as what is left: "Grand Hall free 21 Nov", "the only Saturday we have left", "more open dates in January".
    new RegExp(String.raw`\b(?:hall|saloon|room|suite|date|slot)\s+(?:free|available|open|booked|taken|held)\s+(?:on\s+)?(?:${DATE})`, "giu"),
    new RegExp(String.raw`\b(?:dates?|days?|${WEEKDAY}|slots?|evenings?|weekends?)\s+(?:that\s+)?(?:we\s+(?:still\s+)?have\s+)?(?:left|remaining)\b`, "giu"),
    /\b(?:more|fewer|several|some|a\s+few|no|plenty\s+of)\s+(?:open|free|available)\s+(?:dates|days|slots|saturdays|fridays|sundays|evenings|weekends)\b/giu,
    // The room had, or the event hosted, on a date: "we've got the Grand Hall all day on the 14th", "we can host your event on 30 May".
    new RegExp(String.raw`\bwe(?:'ve|\u2019ve|\s+have)?\s+(?:got|have)\s+the\s+(?:[a-z]+\s+)?(?:hall|saloon|room|suite)\s+(?:from\s+\d|all\s+(?:day|evening|night)|on\s+${DATE}|that\s+(?:day|evening|night)|until)`, "giu"),
    new RegExp(String.raw`\b(?:we|i)\s+${MODAL}\s+(?:host|accommodate|fit\s+in|take|do)\s+(?:your|the|this|their)\s+(?:[a-z]+\s+){0,2}?(?:event|wedding|dinner|party|conference|reception|booking|ceremony)\s+(?:on|in)\s+(?:the\s+)?(?:${DATE})`, "giu"),
    /\bnothing\s+else\s+(?:is\s+)?(?:happening|on)\b/giu,
    /\bwe\s+(?:still\s+)?have\s+(?:one|two|three|four|a\s+few|a\s+couple|\d{1,2})\s+(?:left|remaining)\b|\bgoing\s+fast\b/giu,
    /\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+have\s+the\s+(?:hall|room|saloon|building|guildhall|venue|place)\s+to\s+yoursel(?:f|ves)\b/giu,
    new RegExp(String.raw`\bwe\s+can\s+do\s+${DATE}`, "giu"),
    new RegExp(String.raw`\b(?:we|i)(?:(?:'re|\u2019re|\s+are|'m|\u2019m|\s+am)?\s+(?:able|happy|pleased|delighted|glad)\s+to|\s+${MODAL}(?:\s+be\s+able\s+to)?)\s+offer\s+you\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|date|day|evening|space)\b(?:[^.!?\n]{0,20}?\b(?:on|for)\s+${DATE})?`, "giu"),
    // The date accepted, or the room given: "17 September 2027 works well for us", "the room is yours on the 17th".
    new RegExp(String.raw`\b(?:${DATE}|(?:that|this|the|your)\s+date)\s+works\s+(?:well\s+|nicely\s+|perfectly\s+)?for\s+us\b`, "giu"),
    /\b(?:room|hall|saloon|suite|venue|guildhall|date)\s+is\s+(?:all\s+)?yours\b|\b(?:is|are)\s+ours\s+to\s+(?:offer|give)\b/giu,
    /\b(?:nobody|no\s+one|no-one)\s+else\s+(?:has|is\s+(?:using|in|booked|on)|has\s+booked|will\s+be\s+(?:using|in))\b|\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+be\s+the\s+only\s+(?:booking|event|party|wedding)\b/giu,
    // Confirmed by the venue: "we can confirm the date", "I'm happy to confirm the Grand Hall", "your date is confirmed".
    /\b(?:we|i)(?:'m|\u2019m|'re|\u2019re|\s+am|\s+are)?\s+(?:can\s+|could\s+)?(?:now\s+)?(?:happy\s+|pleased\s+|delighted\s+|glad\s+|able\s+)?(?:to\s+)?confirm\s+(?:that\s+)?(?:the|your)\s+(?:date|booking|room|hall|grand\s+hall|saloon|reservation|hold|day|evening)\b/giu,
    /\b(?:date|booking|room|hall|reservation|hold)\s+(?:is|has\s+been)\s+(?:now\s+)?(?:confirmed|secured|guaranteed)\b/giu,
  ],
  capacity: [
    // A room that seats, holds or takes a number: "the Grand Hall seats 200", "it holds approx. 200 guests".
    new RegExp(String.raw`\b${ROOM}\s+(?:${MODAL}\s+)?(?:only\s+)?(?:comfortably\s+|easily\s+|happily\s+)?(?:seats?|holds?|accommodates?|fits?|takes?|hosts?|caters?\s+(?:for|to)|sleeps?)\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    // A capacity given: "a capacity of 180", "180 capacity", "within capacity".
    new RegExp(String.raw`\bcapacity\s+(?:of|is|for)\s+${ABOUT}${NUM}${WHOLE}`, "giu"),
    new RegExp(String.raw`\bcapacity\s+(?:in|of|for)\s+(?:the\s+)?(?:[a-z]+\s+){0,3}?(?:is|of)\s+${ABOUT}${NUM}${WHOLE}`, "giu"),
    new RegExp(String.raw`\b${NUM}${WHOLE}\s+capacity\b`, "giu"),
    /\b(?:within|over|at|beyond)\s+(?:the\s+|its\s+|our\s+)?capacity\b/giu,
    // People who can be seated: "200 guests can be seated", "a maximum of 200 standing".
    new RegExp(String.raw`\b${COUNT}\s+(?:guests|people|persons|covers|delegates)\s+(?:can|could|will)\s+(?:all\s+)?(?:be\s+)?(?:seated|accommodated|fit|fitted|hosted)\b`, "giu"),
    new RegExp(String.raw`\b(?:up\s+to|a\s+maximum\s+of|maximum\s+of|max(?:imum)?\.?|no\s+more\s+than|at\s+most)\s+${COUNT}\s+${PEOPLE}`, "giu"),
    // Room for a number: "space for 200", "seating for 200", "there's room for everyone".
    new RegExp(String.raw`\b(?:space|room|seating|seats)\s+for\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    /\bthere(?:'s|\u2019s|\s+is)\s+(?:plenty\s+of\s+|ample\s+|enough\s+)?(?:room|space)\s+for\b/giu,
    // That it fits: "ideal for 200", "perfect for a party of 150", "big enough for everyone", "your guests will fit".
    new RegExp(String.raw`\b(?:ideal|perfect|works\s+well|suited|suits?|right\s+size)\s+(?:for\s+)?(?:(?:a\s+)?(?:party|parties|group|groups|wedding|dinner)\s+of\s+)?(?:up\s+to\s+)?${COUNT}${NOT_TIME}`, "giu"),
    /\b(?:big|large|spacious|roomy)\s+enough\s+for\b/giu,
    /\b(?:comfortably|easily)\s+(?:seat|hold|accommodate|fit|take|host)\b/giu,
    /\b(?:guests|people|everyone|everybody|all\s+of\s+you|you\s+all)\s+(?:would|will|could|can|should)\s+(?:all\s+)?(?:easily\s+|comfortably\s+)?fit\b/giu,
    new RegExp(String.raw`\ball\s+${COUNT}\s+of\s+(?:you|them|your\s+guests|the\s+guests|their\s+guests)\s+(?:would|will|could|can|should)\s+(?:all\s+)?(?:easily\s+|comfortably\s+)?(?:fit|be\s+seated|be\s+accommodated)\b`, "giu"),
    new RegExp(String.raw`\bmax(?:imum)?\.?\s+(?:is|of|would\s+be)\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    /\btops?\s+out\s+at\b/giu,
    new RegExp(String.raw`\b(?:get|fit|squeeze|seat|put)\s+${ABOUT}${COUNT}${NOT_TIME}\s+(?:guests\s+|people\s+)?(?:into|in)\s+(?:the|it|there)\b`, "giu"),
    /\bhalf[- ]empty\b|\bwithout\s+(?:it\s+)?(?:feeling|being|looking)\s+(?:crowded|cramped|full|tight)\b|\b(?:designed|built|meant|made)\s+for\s+(?:(?:larger|bigger)\s+)?(?:groups|parties|numbers)\s+(?:of|three|twice|much|far|several)\b/giu,
    // A room that takes the whole party, or a room's limit named: "the room will fit all of your guests", "the hall's maximum".
    new RegExp(String.raw`\b${ROOM}\s+(?:can|could|will|would)\s+(?:comfortably\s+|easily\s+)?(?:seat|hold|accommodate|fit|take)\s+(?:all\s+(?:of\s+)?)?(?:your|the)\s+(?:guests|party|group|wedding\s+party)\b`, "giu"),
    /\b(?:hall|room|saloon|suite|venue)(?:'s|\u2019s)\s+(?:maximum|capacity|limit)\s+(?:of\s+|is\s+)?\d/giu,
    /\btoo\s+(?:small|large|big)\s+for\b/giu,
    /\bmaximum\s+capacity\b|\ba\s+squeeze\b/giu,
    new RegExp(String.raw`\b${ROOM}\s+(?:can|could|will)\s+(?:easily\s+|comfortably\s+)?(?:take|hold|seat|accommodate|fit)\s+(?:their|your)\s+numbers\b`, "giu"),
    new RegExp(String.raw`\b(?:up\s+to\s+)?${COUNT}\s+can\s+be\s+(?:seated|accommodated)\b`, "giu"),
    /\bwill\s+(?:all\s+)?fit\s+in\s+(?:the\s+)?(?:grand\s+hall|hall|room|saloon|suite|reception\s+room)\b/giu,
    new RegExp(String.raw`\badds?\s+(?:another\s+|an\s+extra\s+)?${COUNT}\s+(?:seats|covers|places)\b`, "giu"),
    /\bwithin\s+(?:the\s+)?(?:[a-z]+\s+)?(?:room|hall|saloon|suite)(?:'s|\u2019s)\s+(?:limit|capacity|maximum)\b/giu,
    // Said of the room's size against the party: "takes twice as many guests", "a party of 70 should be no problem", "we can seat up to 250".
    /\b(?:takes?|holds?|seats?|fits?)\s+(?:about\s+|roughly\s+|around\s+|nearly\s+)?(?:twice|half|three\s+times|double)\s+as\s+many\b/giu,
    new RegExp(String.raw`\b(?:party|group|wedding|dinner|numbers?)\s+of\s+${COUNT}\s+(?:should|would|will|is|are)\s+(?:be\s+)?(?:no\s+problem|fine|easy|comfortable|manageable|ok|okay)\b|\bno\s+problem\s+(?:fitting|seating|accommodating)\b`, "giu"),
    new RegExp(String.raw`\bwe\s+(?:${MODAL}\s+)?(?:seat|fit|accommodate|hold)\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    new RegExp(String.raw`\byour\s+${COUNT}\s+(?:guests\s+)?will\s+(?:be\s+)?(?:very\s+|quite\s+|perfectly\s+)?(?:comfortable|fit)\b`, "giu"),
  ],
};

// A clause that says what the client asked, wants, wrote or can spend is
// theirs: "you asked whether the 17th is free", "they want to know if the hall
// can hold 180", "their budget is around £12,000". Only that clause: in "the
// client asked about the deposit; it is £500" the second is the draft's own.
const REPORTED = /\b(?:you|they|he|she|(?:the\s+)?(?:client|clients|guest|guests|couple|bride|groom|organiser|organizer|enquirer))(?:'d|\u2019d|'re|\u2019re|\s+are|\s+were|\s+would|\s+do|\s+did)?\s+(?:asked|ask|asks|asking|wonder(?:ed|ing)?|want(?:s|ed)?\s+to\s+know|like\s+to\s+know|would\s+like|like|mentioned|mention|said|say|says|wrote|write|quoted|quote|hope|hoped|hoping|plan|planned|planning|expect|expected|expecting|need|needs|wish|wishes|prefer|prefers)\b(?!\s+(?:is|are|was|were|will|would|should|has|have)\b)|\b(?:asked|asking|enquired|enquiring|wondered|wondering)\s+(?:us\s+)?(?:whether|if|about|for)\b|\bbudget\b|\b(?:per|in)\s+(?:their|your|the\s+client's|the\s+client\u2019s)\s+(?:email|message|enquiry|note)\b/iu;
/** "If you'd like, the Grand Hall is free": a condition, not the client's words. */
const CONDITIONAL = /\bif\s+you(?:'d|\u2019d|\s+would)\s+like\b/iu;
/** Said back to a question the client asked: "you asked whether the 17th is free - it is". */
const ANSWERED = /\b(?:free|available|open)\b[^.!?\n]{0,40}?(?:\u2014|\u2013|\s-|,|;)\s*(?:and\s+)?(?:yes,?\s+)?it\s+is\b/iu;
/** The judgement of the client's money, read once in a clause. */
const JUDGES_THE_BUDGET = new RegExp(BUDGET_JUDGED.source, "iu");
// A claim asked about rather than made, a few words after "whether" or "if",
// or after "the team will confirm what": "the team will confirm whether the
// Saloon is available", "we'll check if the room can seat 120". A comma ends
// the question, so "if you'd like, the hall is free" is still a claim.
const ASKED_ABOUT = /(?:\b(?:whether|if)(?:\s+or\s+not)?|\b(?:confirm|check|ask|know|see|find\s+out|work\s+out|tell\s+you|look\s+into|advise|clarify|explain)\s+(?:(?:with|to)\s+you\s+)?(?:exactly\s+)?(?:what(?:'s|\u2019s)?|which|how\s+(?:many|much)|how|when))(?:\s+[^\s,;:]+){0,3}\s*$/iu;
// Where one clause ends and the next begins. A colon after "wrote" or "the
// client's message" opens what they wrote, so it ends nothing.
const CLAUSE_BREAK = /(?:[;:\u2014\u2013]|\s-\s|,\s+(?:but|so|and|although|though|while|whereas|yet)\b)\s*/gu;
const OPENS_THEIR_WORDS = /\b(?:asked|asks|wrote|writes|said|says|mentioned|message|email|enquiry|note|request|question|words|quoted)\s*$/iu;
/** How far back from a claim "whether" or "the team will confirm what" is looked for. */
const ASKED_WINDOW = 160;

/** The index of the last start at or before the offset. */
function lastStartAtOrBefore(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** A sentence read once: its clauses, which of them are the client's words,
 *  and whether it answers a question or sets a condition, which makes it the
 *  draft's own however it starts. Reading once keeps a sentence with many
 *  claims in it in time that grows with it. */
interface Reading {
  readonly sentence: string;
  readonly answers: boolean;
  readonly starts: readonly number[];
  readonly reported: readonly boolean[];
}

function readSentence(sentence: string): Reading {
  const starts: number[] = [];
  const reported: boolean[] = [];
  let start = 0;
  const close = (end: number): void => {
    const clause = sentence.slice(start, end);
    starts.push(start);
    reported.push(REPORTED.test(clause) && !JUDGES_THE_BUDGET.test(clause));
  };
  for (const pause of sentence.matchAll(CLAUSE_BREAK)) {
    if (pause[0].trim() === ":" && OPENS_THEIR_WORDS.test(sentence.slice(Math.max(0, pause.index - 40), pause.index))) continue;
    close(pause.index);
    start = pause.index + pause[0].length;
  }
  close(sentence.length);
  return { sentence, answers: ANSWERED.test(sentence) || CONDITIONAL.test(sentence), starts, reported };
}

/** Whether a claim found at the offset is the client's words or a question,
 *  not the draft's own statement. */
function notTheDraftsClaim(reading: Reading, offset: number): boolean {
  if (reading.answers) return false;
  const clause = lastStartAtOrBefore(reading.starts, offset);
  const clauseStart = reading.starts[clause] ?? 0;
  const from = Math.max(clauseStart, offset - ASKED_WINDOW);
  const before = reading.sentence.slice(from, offset);
  if (ASKED_ABOUT.test(from > clauseStart ? before.replace(/^\S*\s?/u, "") : before)) return true;
  return reading.reported[clause] ?? false;
}

// A sentence ends at ., ! or ? (and any closing quote or bracket) before a
// space or the end of the line. "6.30pm", "12.50" and "co.uk" do not end one.
const SENTENCE_END = /[.!?]+["'\u201d\u2019)\]]*(?=\s|$)/gu;

/** A line in sentences, losslessly: the pieces join back into the line. */
export function sentencesOf(line: string): readonly string[] {
  const pieces: string[] = [];
  let start = 0;
  for (const end of line.matchAll(SENTENCE_END)) {
    const stop = end.index + end[0].length;
    pieces.push(line.slice(start, stop));
    start = stop;
  }
  if (start < line.length) pieces.push(line.slice(start));
  return pieces;
}

interface Found extends AIDraftCommitment {
  /** Which of the line's sentences the claim spans. */
  readonly sentences: readonly number[];
}

/** The claims in one line, each with the sentences it spans; a claim that
 *  starts in a sentence reporting what the client asked or said is theirs. */
function claimsInLine(line: string): readonly Found[] {
  const sentences = sentencesOf(line);
  const starts: number[] = [];
  let at = 0;
  for (const sentence of sentences) {
    starts.push(at);
    at += sentence.length;
  }
  const readings = new Map<number, Reading>();
  const readingOf = (index: number): Reading => {
    const known = readings.get(index);
    if (known !== undefined) return known;
    const reading = readSentence(sentences[index] ?? "");
    readings.set(index, reading);
    return reading;
  };
  const found: Found[] = [];
  for (const kind of AI_DRAFT_COMMITMENT_KINDS) {
    for (const pattern of PATTERNS[kind]) {
      for (const match of line.matchAll(pattern)) {
        const first = lastStartAtOrBefore(starts, match.index);
        if (notTheDraftsClaim(readingOf(first), match.index - (starts[first] ?? 0))) continue;
        const last = lastStartAtOrBefore(starts, match.index + Math.max(0, match[0].length - 1));
        const spanned: number[] = [];
        for (let index = first; index <= last; index += 1) spanned.push(index);
        found.push({ kind, phrase: match[0], sentences: spanned });
      }
    }
  }
  return found;
}

/** Every price, availability or capacity claim in the text, in a fixed order of kinds. */
export function findDraftCommitments(text: string): readonly AIDraftCommitment[] {
  const found = text.split("\n").flatMap((line) => claimsInLine(line));
  return AI_DRAFT_COMMITMENT_KINDS.flatMap((kind) => found
    .filter((claim) => claim.kind === kind)
    .map((claim): AIDraftCommitment => ({ kind: claim.kind, phrase: claim.phrase })));
}

function withholdOnce(text: string, withheld: Set<AIDraftCommitmentKind>): string {
  const lines = text.split("\n").map((line) => {
    const claims = claimsInLine(line);
    if (claims.length === 0) return { text: line, dropped: false };
    const out = new Set<number>();
    for (const claim of claims) {
      withheld.add(claim.kind);
      for (const index of claim.sentences) out.add(index);
    }
    const kept = sentencesOf(line).filter((_, index) => !out.has(index)).join("").replace(/\s{2,}/gu, " ").trim();
    return { text: kept, dropped: kept === "" };
  });
  return lines.filter((line) => !line.dropped).map((line) => line.text).join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

/**
 * The draft with every sentence that states a price, availability or capacity
 * taken out, line by line, so its paragraphs and sign-off keep their shape;
 * and the kinds taken out, in a fixed order. A line left empty goes, and no
 * more than one blank line is left between paragraphs. Taking a sentence out
 * can join what was either side of it, so the text is read again until
 * nothing more is found: what is left holds no claim this check knows, and
 * the draft schema, which reads it the same way, accepts it.
 */
export function withholdDraftCommitments(text: string): {
  readonly text: string;
  readonly withheld: readonly AIDraftCommitmentKind[];
} {
  const withheld = new Set<AIDraftCommitmentKind>();
  let current = text;
  for (let round = 0; round < 5; round += 1) {
    const next = withholdOnce(current, withheld);
    if (next === current) break;
    current = next;
  }
  if (findDraftCommitments(current).length > 0) current = "";
  return { text: current, withheld: AI_DRAFT_COMMITMENT_KINDS.filter((kind) => withheld.has(kind)) };
}

/** The fewest words a draft keeps once claims are out: a greeting and a
 *  sign-off alone ("Dear Elaine, With best wishes, The Events Team") are no draft. */
export const MIN_WORDS_LEFT_AFTER_WITHHOLDING = 12;

/** Whether what is left once claims are out is still a draft worth reading. */
export function draftLeftAfterWithholding(result: {
  readonly text: string;
  readonly withheld: readonly AIDraftCommitmentKind[];
}): boolean {
  if (result.text === "") return false;
  if (result.withheld.length === 0) return true;
  return result.text.split(/\s+/u).filter((word) => /[a-z0-9]/iu.test(word)).length >= MIN_WORDS_LEFT_AFTER_WITHHOLDING;
}
