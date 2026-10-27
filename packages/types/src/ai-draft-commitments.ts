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
// between them. It takes out every sentence whose words have a claim's shape
// (an amount of money; a date or room said to be free or taken; "we have held
// the date for you"; a room that seats a number), and leaves the topic alone
// ("the team will confirm the details", "your 150 guests", "set-up takes 4
// staff").
//
// Nothing excuses a claim's shape: not that it repeats the client's words or
// budget, is in quotation marks, is a question, or follows "whether" or "if".
// Each such exemption, tried and reviewed in turn (release review, 27 October
// 2026), let the draft's own claims through in the way a model writes them
// when it answers ("as you asked, room hire is £4,500"; "you asked whether the
// 17th is free. It is."). The rule the model is given says the same: no
// figure, no date's or room's availability and no room's size, even repeated
// or asked about; to defer, it says the events team will confirm the details.
// So a draft that keeps the rule should rarely lose a sentence here, though
// one with a claim's shape that makes none goes too. A bare answer left once
// the claim before it is out ("It is.", "Yes, it can.") goes with it. The
// check misses claims phrased in ways it does not know;
// __tests__/ai-draft-blind-sets.ts records how many, on sets written by
// agents that never saw it.
//
// It reads a draft line by line and a line sentence by sentence, the same way
// for finding and for taking out, so what is taken out is exactly what is
// found. Splitting a line into sentences loses nothing: the pieces join back
// into the line, and what is kept is kept as written. Every pattern is
// bounded, and each sentence is read once, so its time grows with the text,
// not its square. The sentence sets it is measured on are in
// __tests__/ai-draft-commitments.test.ts and __tests__/ai-draft-blind-sets.ts.
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
/** Not a time or a span of time: "until midnight", "6pm", "20 minutes", "2 to 3 hours".
 *  A range of people is a count: "seats 180 to 220". */
const TIME_WORD = String.raw`(?:am\b|pm\b|a\.m\.|p\.m\.|o'clock|hours?\b|hrs?\b|minutes?\b|mins?\b|days?\b|weeks?\b|months?\b|years?\b|%|percent\b)`;
const NOT_TIME = String.raw`(?!\s*(?:(?:to|and|[-\u2013])\s*\d{1,4}(?:[.:]\d{2})?\s*)?${TIME_WORD}|\s*(?:until|till)\b)`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAY = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)days?`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)`;
/** A date, as drafts write one: "the 17th", "14 August", "Saturday 17th June", "June 1st", "17 September 2027". */
/** A day of the month in words, as a date is said: "Saturday the twentieth", "the first of June". */
const WORD_ORDINAL = String.raw`(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-[a-z]+|thirtieth|thirty-first)`;
const DATE = String.raw`(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|${WEEKDAY}\s+the\s+${WORD_ORDINAL}|the\s+${WORD_ORDINAL}\s+of\s+${MONTH}|(?:${WEEKDAY}\s+)?(?:the\s+)?(?:${ORDINAL}|\d{1,2})(?:\s+(?:of\s+)?${MONTH})?(?:\s+\d{4})?|${MONTH}\s+(?:${ORDINAL}|\d{1,2})(?:,?\s+\d{4})?|${WEEKDAY})`;
/** What can be free or taken: a date, a room, the Diary. */
const SLOT = String.raw`(?:${DATE}|${MONTH}(?:\s+\d{4})?|(?:the\s+|that\s+|this\s+|your\s+)?(?:date|day|slot|evening|night|weekend|afternoon|morning|room|rooms|hall|saloon|suite|venue|diary)|both\s+rooms|it|that|this)`;
const IS = String.raw`(?:\s*\([^()\n]{1,30}\))?(?:\s+(?:is|are|was|remains|remain|would\s+be|will\s+be|should\s+be|be|(?:looks|look|seems|appears)(?:\s+to\s+be)?)|'s|\u2019s)`;
/** Free, as availability: followed by nothing, or by when or where, never "free of columns" or "free text". */
const FREE = String.raw`free(?=\s*(?:$|[.,;:!?()\u2014\u2013]|-\s|on\b|that\b|this\b|then\b|in\b|at\b|from\b|next\b|all\s+day\b|for\s+(?:the\b|you|your\s+(?:date|day|event|wedding|dinner|party))\b))`;
/** Open, as availability: never opening hours ("open until midnight", "open to everyone"). */
const OPEN = String.raw`open(?!\s+(?:until|till|from|at|between|daily|late)|\s+to(?!\s+(?:bookings?|offers?|enquiries|reservations)\b)|\s+for(?!\s+(?:the\s+|your\s+)?(?:[a-z]+\s+)?(?:saloon|hall|room|suite|date|day|event|wedding|booking|bookings|you)\b))`;
const ROOM = String.raw`(?:hall|room|saloon|suite|space|venue|it)`;
const PEOPLE = String.raw`(?:guests|people|persons|covers|delegates|attendees|pax|seated|standing|theatre|cabaret|classroom|banquet|boardroom|for\s+dinner|for\s+a\s+(?:dinner|reception|ceremony))`;
const ABOUT = String.raw`(?:all\s+(?:of\s+)?|up\s+to\s+|between\s+|a\s+maximum\s+of\s+|as\s+many\s+as\s+|over\s+|more\s+than\s+|around\s+|about\s+|approx(?:imately|\.)?\s+|nearly\s+|almost\s+|roughly\s+)?`;
/** What can follow an amount of money said bare: the end, "for the room", "plus VAT", "altogether". */
const MONEY_TAIL = String.raw`(?=\s*(?:$|[.,;!?()]|for\b|plus\b|\+|altogether\b|in\s+total\b|incl|inc\b|including\b|exc|excluding\b|ex\b|per\b|a\s+head\b|each\b))`;

/** Can or cannot: "can", "would", "can't", "won't". */
const MODAL = String.raw`(?:can|could|will|would|can't|can\u2019t|cannot|can\s+not|couldn't|couldn\u2019t|won't|won\u2019t|will\s+not|wouldn't|wouldn\u2019t|would\s+not)`;
/** A judgement of what the client's money will buy, which is the team's to make:
 *  "your budget should comfortably cover dinner", "well within your budget". */
const BUDGET_JUDGED = /\bbudget\b[^.!?;\n]{0,60}?\b(?:should|would|will|could)\s+(?:easily\s+|comfortably\s+|more\s+than\s+|just\s+about\s+)?(?:cover|stretch|be\s+(?:enough|plenty|ample|sufficient))\b|\b(?:well\s+)?(?:within|over|under|exceeds?|beyond)\s+(?:(?:your|their|the|our)\s+)?budget\b/giu;

const PATTERNS: Readonly<Record<AIDraftCommitmentKind, readonly RegExp[]>> = {
  price: [
    // An amount of money by its sign or code: "£2,500", "GBP 4,200", "1500 GBP".
    new RegExp(String.raw`[£$\u20ac]\s?${NUM}`, "giu"),
    new RegExp(String.raw`\b(?:gbp|usd|eur)\s?${NUM}|\b${NUM}\s?(?:gbp|usd|eur)\b`, "giu"),
    // By its name: "1,800 pounds", "two thousand pounds", "2k for the room".
    new RegExp(String.raw`\b(?:${NUM}|${WORD_NUM}|(?:a|one|two|three|four|five|six|seven|eight|nine|ten)\s+thousand|(?:a|one|two|three|four|five|six|seven|eight|nine|ten|a\s+couple\s+of)\s+(?=grand))\s?(?:pounds?|quid|euros?|dollars?|grand)\b`, "giu"),
    new RegExp(String.raw`\b${NUM}\s?k\b${MONEY_TAIL}`, "giu"),
    // A charge per guest: "£65 per head", "65pp", "65 a head".
    new RegExp(String.raw`\b${NUM}${WHOLE}\s?(?:pp\b|per\s+(?:head|person|guest|cover)\b|a\s+head\b)`, "giu"),
    // A figure with VAT: "900 plus VAT", "1,000 + VAT", "1,000 including VAT".
    new RegExp(String.raw`\b${NUM}${WHOLE}\s*(?:\+|plus|inc(?:luding|l\.?)?|exc(?:luding|l\.?)?|ex)\s*vat\b`, "giu"),
    // A pricing word given a figure: "the deposit is 500", "room hire is 2,000", "a 500 deposit".
    new RegExp(String.raw`\b(?:deposit|minimum\s+spend|hire\s+fee|hire\s+charge|room\s+hire|venue\s+hire|exclusive\s+use|fee|price|cost|charge)s?(?:\s+[a-z]+){0,5}?\s+(?:is|are|would\s+be|will\s+be|of|comes?\s+to|starts?\s+(?:at|from)|from)\s+(?:around\s+|about\s+|just\s+|only\s+|roughly\s+)?${NUM}${WHOLE}(?!\s*(?:guests|people|covers|delegates|tables|chairs|staff|until|till|am\b|pm\b|o'clock|hours?|minutes?|%))`, "giu"),
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
    // Said as a summary's label: "Price: 4,500 for the evening", "Deposit: 25%".
    new RegExp(String.raw`\b(?:price|cost|deposit|fee|hire|room\s+hire|venue\s+hire|total|quote|rate|minimum\s+spend|per\s+head)\s*[:\u2013\u2014-]\s*(?:about\s+|around\s+|approx\.?\s+|roughly\s+)?(?:[£$\u20ac]\s?)?${NUM}${WHOLE}(?!\s*(?:guests|people|persons|covers|delegates|attendees|seated|standing|tables|chairs|staff))`, "giu"),
    BUDGET_JUDGED,
    // A price compared, held or waived in words: "a third cheaper", "rates are frozen", "won't cost you anything".
    /\b(?:is|are|be|would\s+be|will\s+be|works?\s+out|comes?\s+out|much|far|a\s+lot|slightly|considerably|significantly|half|twice|a\s+(?:bit|little|lot|third|quarter|fifth|fraction))\s+(?:the\s+|a\s+(?:bit|little|lot|third|quarter|fifth)\s+)?(?:cheaper|less\s+expensive|more\s+expensive|dearer)\b|\b(?:cheaper|less\s+expensive|more\s+expensive|dearer)\s+than\b/giu,
    /\b(?:half|twice|double|triple|a\s+(?:third|quarter|fraction)\s+of)\s+the\s+(?:price|cost|rate|fee)\b/giu,
    /\bnothing\s+(?:extra\s+|more\s+|further\s+)?to\s+pay\b|(?<!\b(?:what|which|anything)\s{1,3})\b(?:is|are|would\s+be|will\s+be|comes?|come)\s+(?:also\s+|already\s+)?included\s+in\s+(?:the|your|our)\s+(?:[a-z]+\s+){0,2}?(?:rate|price|cost|fee|hire\s+fee|room\s+hire)\b/giu,
    /\b(?:prices?|rates?|charges?|fees?)\s+(?:are|is|will\s+be|would\s+be)\s+(?:frozen|held|fixed|guaranteed|locked|the\s+same)\b/giu,
    /\b(?:won't|won\u2019t|will\s+not|wouldn't|wouldn\u2019t|doesn't|doesn\u2019t|does\s+not)\s+cost\s+(?:you\s+)?(?:anything|a\s+penny|any\s+more|extra)\b/giu,
    // A price promise with no figure.
    /\b(?:free\s+of\s+charge|for\s+free|at\s+no\s+(?:extra\s+|additional\s+)?cost|no\s+(?:(?:extra|additional|room|venue|hire|corkage|service)\s+){0,2}(?:charge|fee)\b|half[- ]price)/giu,
    // Something given at no charge, in the words that give it: "parking is complimentary", "with complimentary fizz".
    /\b(?:is|are|be|comes?|come|offer|offers|offering|include|includes|including|with|plus|enjoy|get|receive|provide|provides|a|an|the|our|your)\s+(?:also\s+)?complimentary\b(?!\s+(?:about|of)\b)|(?:^\s*|[.!?:;]\s+|^\s*[-*\u2022]\s+)complimentary\s+(?!about\b|of\b)[a-z]/giu,
    // A discount, a waiver or a rate given, not a topic named ("asks about a discount"): "we can offer a discount", "the fee is waived".
    /\b(?:offer|offers|offering|give|gives|giving|apply|applies|applying|honour|honor|extend|do|arrange|knock\s+off)\s+(?:you\s+)?(?:a\s+|an\s+|our\s+|the\s+)?(?:small\s+|special\s+|further\s+|extra\s+|generous\s+|friday\s+|midweek\s+|early[- ]booking\s+|[a-z]+day\s+)?(?:discounts?|reduced\s+rates?|special\s+rates?|discounted\s+(?:rates?|prices?))\b|\bthere(?:'s|\u2019s|\s+is|\s+are)\s+(?:a\s+|an\s+)?(?:[a-z]+\s+)?(?:discounts?|reduced\s+rates?|special\s+rates?)\b|\b(?:get|gets|receive|qualify\s+for|qualifies\s+for|eligible\s+for|entitled\s+to)\s+(?:a\s+|an\s+|our\s+|the\s+)?(?:[a-z]+\s+)?(?:discount|reduced\s+rate|special\s+rate)\b|\b(?:discount|reduced\s+rate|special\s+rate)\s+(?:applies|would\s+apply|will\s+apply|of\b)|\b(?:at|on)\s+(?:a\s+|our\s+)?(?:discounted|reduced|special)\s+(?:rate|price)\b|\bdiscounted\s+(?:rate|price)\s+(?:of|is|would|will)\b/giu,
    /\b(?:be|is|are|been|being|get|gets|was|were)\s+waived\b|\bwaive[ds]?\s+(?:the|your|our|it|this|that|any|all)\b|\bwaiving\s+(?:the|your|it|this|that|any|all)\b/giu,
  ],
  availability: [
    // A date or room said to be free, open, booked or taken: "14 August is free in the Grand Hall",
    // "the Grand Hall would be available on that date", "the 17th has already gone".
    new RegExp(String.raw`\b${SLOT}${IS}\s+(?:still\s+|currently\s+|now\s+|definitely\s+|already\s+|wide\s+|usually\s+|normally\s+|provisionally\s+|tentatively\s+)?(?:not\s+)?(?:available(?!\s+(?:to\s+(?:download|view|see|read|browse|print|share|discuss)|on\s+request|online|here|below|from\s+(?:our|your|their|this|that)\b|from\s+the\s+(?:events?\s+team|team|office|website|link|brochure|pack|reception|front\s+desk)\b|in\s+(?:the\s+)?(?:pack|link|brochure)))|unavailable|${FREE}|${OPEN}|booked|fully\s+booked|taken(?!\s+(?:care|into|on\s+board|up|over|seriously|note|account|us|me|them|a\b|an\b|some|longer|time))|reserved|clear(?!\s+(?:that|to|how|what|why|whether|from|about|of)\b)|gone)\b`, "giu"),
    new RegExp(String.raw`\b${SLOT}\s+(?:has|have|hasn't|hasn\u2019t|haven't|haven\u2019t|has\s+not|have\s+not)\s+(?:already\s+|yet\s+)?(?:gone|been\s+(?:taken|booked))\b`, "giu"),
    // Said as a note, or held for the client: "GH 14 Jun - prov. hold", "us to hold 3 March", "Saturdays free next spring".
    new RegExp(String.raw`(?<!\bno\s{1,3})\b(?:prov\.?\s+hold\b|provisional\s+hold\s+(?:on|until|till|for|in\s+place|is|has|expires)\b)|\b(?:us|we)\s+(?:to\s+)?(?:hold|reserve|pencil(?:\s+in)?)\s+(?:${DATE})|\b(?:${WEEKDAY}|dates|days|evenings|weekends)\s+(?:still\s+)?(?:free|open|available)\b(?!\s+(?:to\s+you\b|for\s+you\s+to\b))|\bgh\s+(?:free|available|open|booked|taken|held)\b`, "giu"),
    new RegExp(String.raw`\bearliest\s+(?:date\s+)?we\s+(?:could|can|would)\s+(?:fit\s+you\s+in|offer\s+you|do|host)\b|\bfit\s+you\s+in\s+(?:(?:on|for)\s+(?:${DATE}|that\s+(?:date|day)|the\s+date)|in\s+${MONTH})`, "giu"),
    new RegExp(String.raw`(?<!\b(?:nothing|none|no\s+part)\s{1,3}(?:for|of|about|on)\s{1,3})\b(?:your|the|our|their)\s+(?:[a-z]+\s+){0,2}?(?:wedding|event|booking|dinner|party|reception|conference)(?:\s+(?:on|for)\s+(?:${DATE}))?\s+(?:is|has\s+been)\s+(?:now\s+)?(?:confirmed|booked|secured|reserved)\b`, "giu"),
    /\b(?:isn't|aren't|wasn't|isn\u2019t|aren\u2019t|wasn\u2019t)\s+(?:available|free|booked|taken)\b/giu,
    /\bwe(?:'re|\u2019re|\s+are)\s+(?:still\s+)?free\s+(?:on|that|this|then)\b/giu,
    /\b(?:we|i)\s+(?:do\s+|still\s+)?(?:have|has)\s+(?:some\s+|good\s+|limited\s+|no\s+)?availability\b/giu,
    new RegExp(String.raw`\bwe\s+(?:still\s+)?have\s+(?:the\s+)?(?:${DATE}|date|day|evening|weekend|room|hall|saloon)\s+(?:free|open|available)\b`, "giu"),
    /\b(?:there\s+is|there's|there\u2019s|there\s+are)\s+(?:still\s+)?(?:some\s+)?availability\b/giu,
    /\b(?:no\s+other\s+(?:bookings?|events?)|nothing\s+else\s+(?:is\s+|has\s+been\s+)?booked)\b/giu,
    // Held for the client: "we have held the date for you", "we'll hold the date", "we could pencil you in".
    new RegExp(String.raw`\b(?:we|i)(?:'ve|\u2019ve|'ll|\u2019ll|'re|\u2019re|'m|\u2019m|\s+have|\s+will|\s+can|\s+could|\s+would|\s+are|\s+am)?\s+(?:be\s+(?:happy|glad)\s+to\s+)?(?:hold|held|holding|reserve|reserved|reserving|pencil|pencilled|penciled|pencilling|secure|secured|securing|block|blocked|blocking)\s+(?:out\s+)?(?:the|your|that|this)\s+(?:[a-z]+\s+){0,2}?(?:date|day|room|hall|saloon|suite|space|evening|weekend|${ORDINAL})\b`, "giu"),
    /\bpencil(?:led|ed)?\s+you\s+in\b/giu,
    /\b(?:provisionally|tentatively)\s+(?:held|booked|reserved|pencilled|penciled|taken)\b|\bon\s+(?:a\s+)?(?:provisional\s+|first[- ]option\s+|second[- ]option\s+)hold\b/giu,
    /\b(?:placed|put|made|taken)\s+(?:a\s+)?(?:provisional\s+|first[- ]option\s+|second[- ]option\s+)?hold\s+on\b/giu,
    /\b(?:date|wedding|event|booking|day)\s+is\s+(?:now\s+)?(?:locked|booked|pencilled)\s+in\b|\blocked\s+in\s+with\s+us\b/giu,
    /\b(?:event|booking|wedding|dinner|date)\s+(?:is\s+|has\s+been\s+)?confirmed\s+(?:for|on)\b/giu,
    /\bno\s+clash(?:es)?\b/giu,
    // Said as a note, or as what is left: "Grand Hall free 21 Nov", "the only Saturday we have left", "more open dates in January".
    new RegExp(String.raw`\b(?:hall|saloon|room|suite|date|slot)\s+(?:free|available|open|booked|taken|held)\s+(?:on\s+)?(?:${DATE})`, "giu"),
    new RegExp(String.raw`(?:\b(?:hall|saloon|room|suite)|${DATE})\s*[:\u2013\u2014]\s*(?:still\s+)?(?:free|available|open|booked|held|taken|reserved)\b`, "giu"),
    new RegExp(String.raw`\b(?:dates?|days?|${WEEKDAY}|slots?|evenings?|weekends?)\s+(?:that\s+)?(?:we\s+(?:still\s+)?have\s+)?(?:(?:are|is)\s+(?:still\s+)?)?(?:left|remaining)\b`, "giu"),
    /\bconfirmed\s+(?:as\s+)?(?:free|available|open|clear)\b|\bnothing\s+(?:else\s+)?(?:is\s+)?(?:in|booked\s+in|on)\s+(?:the|our)\s+diary\b/giu,
    new RegExp(String.raw`\b(?:we|i)\s+${MODAL}\s+(?:accommodate|do|offer|host|take)\s+(?:your|the|that|this)\s+(?:preferred\s+|chosen\s+|requested\s+|first[- ]choice\s+)?(?:date|day|evening|weekend)\b`, "giu"),
    /\b(?:more|fewer|several|some|a\s+few|no|plenty\s+of)\s+(?:open|free|available)\s+(?:dates|days|slots|saturdays|fridays|sundays|evenings|weekends)\b/giu,
    // The room had, or the event hosted, on a date: "we've got the Grand Hall all day on the 14th", "we can host your event on 30 May".
    new RegExp(String.raw`\bwe(?:'ve|\u2019ve|\s+have)?\s+(?:got|have)\s+the\s+(?:[a-z]+\s+)?(?:hall|saloon|room|suite)\s+(?:from\s+\d|all\s+(?:day|evening|night)|on\s+${DATE}|that\s+(?:day|evening|night)|until)`, "giu"),
    new RegExp(String.raw`\b(?:we|i)\s+${MODAL}\s+(?:host|accommodate|fit\s+in|take|do)\s+(?:your|the|this|their)\s+(?:[a-z]+\s+){0,2}?(?:event|wedding|dinner|party|conference|reception|booking|ceremony)\s+(?:on|in)\s+(?:the\s+)?(?:${DATE})`, "giu"),
    /\bnothing\s+else\s+(?:is\s+)?(?:happening|on)\b/giu,
    /\bwe\s+(?:still\s+)?have\s+(?:one|two|three|four|a\s+few|a\s+couple|\d{1,2})\s+(?:left|remaining)\b|\bgoing\s+fast\b/giu,
    /\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+have\s+(?:it|the\s+(?:hall|room|saloon|building|guildhall|venue|place))\s+to\s+yoursel(?:f|ves)\b/giu,
    new RegExp(String.raw`\bwe\s+can\s+do\s+${DATE}`, "giu"),
    new RegExp(String.raw`\b(?:we|i)(?:(?:'re|\u2019re|\s+are|'m|\u2019m|\s+am)?\s+(?:able|happy|pleased|delighted|glad)\s+to|\s+${MODAL}(?:\s+be\s+able\s+to)?)\s+offer\s+you\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|date|day|evening|space)\b(?:[^.!?\n]{0,20}?\b(?:on|for)\s+${DATE})?`, "giu"),
    // The date accepted, or the room given: "17 September 2027 works well for us", "the room is yours on the 17th".
    new RegExp(String.raw`\b(?:${DATE}|(?:that|this|the|your)\s+date)\s+works\s+(?:well\s+|nicely\s+|perfectly\s+)?for\s+us\b`, "giu"),
    /\b(?:room|hall|saloon|suite|venue|guildhall|date|slot)\s+is\s+(?:all\s+)?yours\b|\b(?:is|are)\s+ours\s+to\s+(?:offer|give)\b/giu,
    /\b(?:nobody|no\s+one|no-one)\s+else\s+(?:has|is\s+(?:using|in|booked|on)|has\s+booked|will\s+be\s+(?:using|in))\b|\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+be\s+the\s+only\s+(?:booking|event|party|wedding)\b/giu,
    // Confirmed by the venue: "we can confirm the date", "I'm happy to confirm the Grand Hall", "your date is confirmed".
    /\b(?:we|i)(?:'m|\u2019m|'re|\u2019re|\s+am|\s+are)?\s+(?:can\s+|could\s+)?(?:now\s+)?(?:happy\s+|pleased\s+|delighted\s+|glad\s+|able\s+)?(?:to\s+)?confirm\s+(?:that\s+)?(?:the|your)\s+(?:date|booking|room|hall|grand\s+hall|saloon|reservation|hold|day|evening)\b/giu,
    /(?<!\bno\s{1,3})\b(?:date|booking|room|hall|reservation|hold)\s+(?:is|has\s+been)\s+(?:now\s+)?(?:confirmed|secured|guaranteed)\b/giu,
    // Said as a summary's label: "Availability: free on 17 June", "Status: held".
    /\b(?:availability|status|diary)\s*[:\u2013\u2014-]\s*(?:(?:still|currently|now)\s+)?(?:(?:the\s+)?(?:date|room|hall)\s+)?(?:free|available|open|booked|held|taken|reserved|confirmed|pencilled|clear)\b/giu,
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
    // Never the client's own count: "they expect up to 150 guests".
    new RegExp(String.raw`(?<!\b(?:expects?|expecting|expected|invites?|inviting|invited|plans?|planning|planned|brings?|bringing|anticipates?|anticipating|estimates?|estimating|hopes?\s+for|hoping\s+for|thinking\s+of|wants?|wanting|needs?|asks?\s+for|asking\s+for|of)\s{1,3})\b(?:up\s+to|a\s+maximum\s+of|maximum\s+of|max(?:imum)?\.?|no\s+more\s+than|at\s+most)\s+${COUNT}\s+${PEOPLE}`, "giu"),
    // Room for a number: "space for 200", "seating for 200", "there's room for everyone".
    new RegExp(String.raw`\b(?:space|room|seating|seats)\s+for\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    new RegExp(String.raw`(?:^|[(\u2013\u2014,:]\s*)(?:seats|holds|takes|sleeps)\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    // Said as a summary's label: "Capacity: 200 seated", "Max: 300".
    new RegExp(String.raw`\b(?:capacity|max(?:imum)?(?:\s+capacity)?|seats|seating)\s*[:\u2013\u2014-]\s*${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    new RegExp(String.raw`\bthere(?:'s|\u2019s|\s+is|\s+would\s+be|\s+will\s+be)\s+(?:plenty\s+of\s+|ample\s+|enough\s+)?(?:room|space)\s+for\s+(?:everyone|everybody|all\s+(?:of\s+)?(?:your|the|them|you)|(?:your|the|their)\s+(?:whole\s+)?(?:guests|party|group|wedding\s+party|numbers)|${ABOUT}${COUNT}${NOT_TIME}|(?:a|your|the)\s+(?:[a-z]+\s+)?(?:group|party|crowd|gathering)\b|dancing|(?:a\s+)?(?:dance\s*floor|band|top\s+table|ceilidh|buffet|stage|dj|string\s+quartet))`, "giu"),
    // That it fits: "ideal for 200", "perfect for a party of 150", "big enough for everyone", "your guests will fit".
    new RegExp(String.raw`\b(?:ideal|perfect|works\s+well|suited|suits?|right\s+size)\s+(?:for\s+)?(?:(?:a\s+)?(?:party|parties|group|groups|wedding|dinner)\s+of\s+)?${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    // A room's limit or fit said with a number: "max 220", "too many for the Saloon", "70 people should be fine", "up to 18 tables".
    new RegExp(String.raw`\bmax(?:imum)?\.?\s+(?:cap(?:acity)?\.?\s+)?${COUNT}(?=\s*(?:$|[.,;:!?)\u2014\u2013]|(?:guests|people|persons|covers|pax|seated|standing|delegates|attendees)\b))`, "giu"),
    new RegExp(String.raw`\btoo\s+(?:many|few)(?:\s+(?:guests|people))?\s+for\s+(?:the\s+|that\s+|this\s+)?(?:[a-z]+\s+)?(?:hall|room|saloon|suite|space|venue|it)\b`, "giu"),
    new RegExp(String.raw`\b${COUNT}\s+(?:people|guests|pax|covers)\s+(?:should|would|will|could)\s+(?:be\s+)?(?:fine|ok|okay|no\s+problem|comfortable|easy)\b|\b(?:seat|seats|set|sets|fit|fits|take|takes|hold|holds|lay|lays|accommodate|accommodates|room\s+for|space\s+for)\b[^.!?\n]{0,40}?\bup\s+to\s+${COUNT}\s+(?:tables|rounds)\b`, "giu"),
    new RegExp(String.raw`\b${COUNT}\s+(?:guests|people)\b[^.!?\n]{0,40}?\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+need\s+the\s+(?:[a-z]+\s+)?(?:hall|room|saloon|suite)\b|\b(?:${COUNT}\s+(?:guests|people|covers|pax|delegates)|(?:to|under|below|around|about|of|with)\s+${NUM}${WHOLE}${NOT_TIME})\b[^.!?\n]{0,60}?\b(?:room|hall|saloon|suite)\s+(?:would|will|should|could)\s+(?:work|do)\b`, "giu"),
    /\b(?:big|large|spacious|roomy)\s+enough\s+for\b/giu,
    // Never a time taken: "set-up easily takes two hours".
    /\b(?:comfortably|easily)\s+(?:seats?|holds?|accommodates?|fits?|hosts?|takes?(?!\s+(?:[a-z0-9.,'-]+\s+){0,3}?(?:minutes?|hours?|days?|weeks?|months?)\b|\s+(?:place|longer|time|up|care|over)\b))\b/giu,
    /\b(?:guests|people|everyone|everybody|all\s+of\s+you|you\s+all)\s+(?:would|will|could|can|should)\s+(?:all\s+)?(?:easily\s+|comfortably\s+)?fit\b/giu,
    new RegExp(String.raw`\ball\s+${COUNT}\s+of\s+(?:you|them|your\s+guests|the\s+guests|their\s+guests)\s+(?:would|will|could|can|should)\s+(?:all\s+)?(?:easily\s+|comfortably\s+)?(?:fit|be\s+seated|be\s+accommodated)\b`, "giu"),
    new RegExp(String.raw`\bmax(?:imum)?\.?\s+(?:is|of|would\s+be)\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    /\btops?\s+out\s+at\b/giu,
    new RegExp(String.raw`\b(?:get|fit|squeeze|seat|put)\s+${ABOUT}${COUNT}${NOT_TIME}\s+(?:guests\s+|people\s+)?(?:into|in)\s+(?:the|it|there)\b`, "giu"),
    /\bhalf[- ]empty\b|\bwithout\s+(?:it\s+)?(?:feeling|being|looking)\s+(?:crowded|cramped|full|tight)\b|\b(?:designed|built|meant|made)\s+for\s+(?:(?:larger|bigger)\s+)?(?:groups|parties|numbers)\s+(?:of|three|twice|much|far|several)\b/giu,
    // A room that takes the whole party, or a room's limit named: "the room will fit all of your guests", "the hall's maximum".
    new RegExp(String.raw`\b${ROOM}\s+(?:can|could|will|would)\s+(?:comfortably\s+|easily\s+)?(?:seat|hold|accommodate|fit|take)\s+(?:all\s+(?:of\s+)?)?(?:your|the|their)\s+(?:${COUNT}\s+)?(?:guests|party|group|delegates|people|attendees|wedding\s+party)\b`, "giu"),
    /\b(?:hall|room|saloon|suite|venue)(?:'s|\u2019s)\s+(?:maximum|capacity|limit)\s+(?:of\s+|is\s+)?\d/giu,
    new RegExp(String.raw`\btoo\s+(?:small|large|big|cramped|tight)(?=\s+for\s+(?:${ABOUT}${COUNT}|your|their|everyone|everybody|all|the\s+(?:[a-z]+\s+)?(?:guests|party|group|numbers|wedding|dinner|event|reception|ceremony)|a\s+(?:[a-z]+\s+)?(?:party|group|wedding|dinner|reception|crowd|ceremony))\b|\s+to\s+(?:seat|hold|take|fit|accommodate|host)\b|\s*[.,;:!?)]|\s*$)`, "giu"),
    /\b(?:be|is|'s|\u2019s|would\s+be|will\s+be|might\s+be|could\s+be)\s+(?:a\s+bit\s+of\s+|quite\s+|rather\s+)?a\s+(?:tight\s+)?squeeze\b|\b(?:at|near|over|reach|reaches|hit|hits)\s+(?:its\s+|the\s+|our\s+)?maximum\s+capacity\b/giu,
    new RegExp(String.raw`\b${ROOM}\s+(?:${MODAL}\s+)?(?:easily\s+|comfortably\s+)?(?:take|takes|hold|holds|seat|seats|accommodate|accommodates|fit|fits)\s+(?:their|your|that|those)\s+numbers?\b`, "giu"),
    // Said against a limit: "over the limit for the Lower Hall", "limits the Saloon to 140", "within what the hall can manage".
    /\b(?:over|under|within|beyond|above)\s+(?:the|its|our|that|this)\s+(?:limit|capacity|maximum)\b|\b(?:within|beyond|more\s+than|over)\s+what\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|room|saloon|suite|space|venue|it)\s+(?:can|could)\s+(?:manage|take|hold|seat|accommodate|handle)\b/giu,
    new RegExp(String.raw`\blimit(?:s|ed)?\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|room|saloon|suite|space|venue|it)\s+to\s+${ABOUT}${COUNT}`, "giu"),
    new RegExp(String.raw`\b${COUNT}\s+(?:pax|guests|people|covers)\s+(?:seated\s+|standing\s+)?(?:ok|okay|fine|fits?|no\s+problem)\b`, "giu"),
    /\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|eighteen|twenty)\s+tables\s+(?:of\s+[a-z0-9]+\s+)?(?:would|will|could|can|should)\s+(?:all\s+)?(?:sit|fit|go)\b/giu,
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

// A sentence ends at ., ! or ? (and any closing quote or bracket) before a
// space or the end of the line. "6.30pm", "12.50", "co.uk", "approx. 150" and
// "e.g. the Saloon" do not end one. A run of stops is read once from its start,
// so a long run takes time that grows with it. A list's number ("1. ") is not
// a sentence.
const SENTENCE_END = /(?<![.!?])(?<!\b(?:approx|e\.g|i\.e|vs|mr|mrs|ms|dr|st|incl|excl|tel|ref|cf|ca))(?<!^[ \t]*\d{1,3})[.!?]+["'\u201d\u2019)\]]*(?=\s|$)/giu;

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

interface Found extends AIDraftCommitment {
  /** Which of the line's sentences the claim spans. */
  readonly sentences: readonly number[];
}

/** The claims in one line, each with the sentences it spans. */
function claimsInLine(line: string): readonly Found[] {
  const sentences = sentencesOf(line);
  const starts: number[] = [];
  let at = 0;
  for (const sentence of sentences) {
    starts.push(at);
    at += sentence.length;
  }
  const found: Found[] = [];
  for (const kind of AI_DRAFT_COMMITMENT_KINDS) {
    for (const pattern of PATTERNS[kind]) {
      for (const match of line.matchAll(pattern)) {
        const claim = { kind, phrase: match[0] };
        const first = lastStartAtOrBefore(starts, match.index);
        const last = lastStartAtOrBefore(starts, match.index + Math.max(0, match[0].length - 1));
        const spanned: number[] = [];
        for (let index = first; index <= last; index += 1) spanned.push(index);
        found.push({ ...claim, sentences: spanned });
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

// An answer left on its own once the claim before it is out: "It is.", "Yes,
// it can.", "I'm pleased to say it is.", "I'm afraid not." Only the bare
// answer: "Yes, we'd love to show you round" and "It is a beautiful room" stay.
const APOS = String.raw`['\u2019]`;
const ANSWER_CORE = String.raw`(?:(?:it|that|they|we|this)\s+(?:is|are|was|were|can|could|will|would|does|do|did|has|have|should)(?:n${APOS}t|\s+not)?|(?:it|that|they|we)${APOS}(?:s|re|ll|d)|cannot|not|so)`;
const ANSWER_TAIL = String.raw`(?:(?:\s*,\s*|\s+)(?:not|indeed|still|now|too|comfortably|easily|happily|already|actually|though|yet|at\s+all|i${APOS}m\s+afraid|sadly|unfortunately|thankfully))*\s*(?:[.!;:\u2014\u2013)]|,\s*(?:and|but|so)\b|$)`;
const ANSWER_OPENER = String.raw`(?:yes|yeah|yep|no|nope|sadly|unfortunately|happily|fortunately|luckily|thankfully|good\s+news|great\s+news|of\s+course|absolutely|certainly|indeed|definitely|correct|exactly|that${APOS}s\s+right|(?:i${APOS}m|i\s+am|we${APOS}re|we\s+are)\s+(?:pleased|happy|delighted|glad|sorry|sad)\s+to\s+(?:say|confirm|report|tell\s+you)|(?:i${APOS}m|i\s+am|we${APOS}re|we\s+are)\s+afraid)`;
const ANSWER = new RegExp(String.raw`^\s*["'\u201c\u2018(]?(?:${ANSWER_OPENER}\s*[,!.:\u2014\u2013-]?\s*(?:(?:that\s+)?${ANSWER_CORE}${ANSWER_TAIL}|$)|${ANSWER_CORE}${ANSWER_TAIL}|not\s+at\s+all\b)`, "iu");

const DROPPED = Symbol("dropped");

/** The text with the sentences that make a claim taken out, and an answer
 *  left on its own after one, on its line or the next. Everything else is
 *  kept as written: indentation, spacing, line endings. A line left empty
 *  goes, and the blank lines either side of it become one. */
function withholdOnce(text: string, withheld: Set<AIDraftCommitmentKind>): string {
  const read = text.split("\n").map((line) => ({ line, claims: claimsInLine(line) }));
  if (read.every(({ claims }) => claims.length === 0)) return text;
  let afterClaim = false;
  const lines = read.map(({ line, claims }): string | typeof DROPPED => {
    const sentences = sentencesOf(line);
    const out = new Set<number>();
    for (const claim of claims) {
      withheld.add(claim.kind);
      for (const index of claim.sentences) out.add(index);
    }
    sentences.forEach((sentence, index) => {
      if (sentence.trim() === "") return;
      if (afterClaim && ANSWER.test(sentence)) out.add(index);
      afterClaim = out.has(index);
    });
    if (out.size === 0) return line;
    const kept = sentences.filter((_, index) => !out.has(index)).join("");
    if (kept.trim() === "") return DROPPED;
    if (!out.has(0)) return kept;
    // The first sentence went: the line keeps its indentation and its list marker.
    const lead = /^[ \t]*(?:[-*>\u2022\u2013\u2014]\s+|\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s+)?/iu.exec(line)?.[0] ?? "";
    return lead + kept.trimStart();
  });
  // A line that goes takes nothing else with it, and adds nothing: in a run
  // of blank lines that held one, one blank line is kept (none at the start
  // or end of the text), and a run with no blank line keeps none.
  const result: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line !== DROPPED && line !== undefined && line.trim() !== "") {
      result.push(line);
      index += 1;
      continue;
    }
    let end = index;
    let dropped = false;
    const run: string[] = [];
    while (end < lines.length) {
      const next = lines[end];
      if (next === DROPPED) dropped = true;
      else if (next === undefined || next.trim() !== "") break;
      else run.push(next);
      end += 1;
    }
    const blank = run[0];
    if (!dropped) result.push(...run);
    else if (blank !== undefined && result.length > 0 && end < lines.length) result.push(blank);
    index = end;
  }
  return result.join("\n");
}

/**
 * The draft with every sentence that states a price, availability or capacity
 * taken out, line by line, so its paragraphs and sign-off keep their shape;
 * and the kinds taken out, in a fixed order. Taking a sentence out can join
 * what was either side of it, so the text is read again until nothing more is
 * found: what is left holds no claim this check knows.
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
  if (result.text.trim() === "") return false;
  if (result.withheld.length === 0) return true;
  return result.text.split(/\s+/u).filter((word) => /[a-z0-9]/iu.test(word)).length >= MIN_WORDS_LEFT_AFTER_WITHHOLDING;
}
