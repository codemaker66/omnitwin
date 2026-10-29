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
// It reads the draft's characters as they show (canonicalDraftText): a
// character that shows nothing (a zero-width space, a soft hyphen) is no
// longer inside a word, a wide or another script's digit is a digit, a sign
// such as "\uffe1" is "£", and a Cyrillic or Greek letter that looks Latin in
// a Latin word is the Latin letter. The draft people see is that text, so
// what is checked is what they read (review of 28 October 2026: "av\u200bailable",
// "\uff14,\uff15\uff10\uff10" and "\u0662\u0662\u0660" passed every pattern). The patterns read a
// copy that goes further and that nobody sees (patternReading): a look-alike
// letter in any word, markdown's marks, a table's bars, "4 500" and a word
// hyphenated over a line (red team, 29 October 2026).
//
// Each pattern reads the whole draft once, so a claim broken across a line
// ("That date is\navailable.") is found, and what is taken out is the line's
// sentences the claim touches, the same way for finding and for taking out,
// so what is taken out is exactly what is found. Splitting a line into
// sentences loses nothing: the pieces join back into the line, and what is
// kept is kept as written. Every pattern is bounded and reads the text once,
// so its time grows with the text, not its square. The sentence sets it is
// measured on are in __tests__/ai-draft-commitments.test.ts and
// __tests__/ai-draft-blind-sets.ts.
// ---------------------------------------------------------------------------

export const AI_DRAFT_COMMITMENT_KINDS = ["price", "availability", "capacity"] as const;
export const AIDraftCommitmentKindSchema = z.enum(AI_DRAFT_COMMITMENT_KINDS);
export type AIDraftCommitmentKind = z.infer<typeof AIDraftCommitmentKindSchema>;

export interface AIDraftCommitment {
  readonly kind: AIDraftCommitmentKind;
  /** The words that made the claim, as the draft reads once canonical. */
  readonly phrase: string;
}

// The draft's characters as they show. A format or control character shows
// nothing; NFKC makes wide letters, digits and signs ("\uff14", "\uffe1") the
// plain ones; a decimal digit of any script is the ASCII digit of its value
// (Unicode encodes every script's 0 to 9 as ten code points in order, so a
// digit's value is how far it is from the first of its run); a mark left on an
// ASCII letter or digit once composed (a combining underline, a variation
// selector) is dropped; and in a word holding a Latin letter, a Cyrillic or
// Greek letter drawn like a Latin one is that Latin letter. Text in another
// script, accented letters and emoji keep their characters.
const NEXT_LINE = /[\u0085\u2028\u2029]/gu;
const SHOWS_NOTHING = /(?![\t\n\v\f\r])[\p{Cc}\p{Cf}\u034f\u115f\u1160\u3164\uffa0]/gu;
const NON_ASCII_DIGIT = /(?![0-9])\p{Nd}/gu;
const ONE_DIGIT = /^\p{Nd}$/u;
const MARK_ON_ASCII = /(?<=[a-z0-9])\p{M}+/giu;
const WORD = /[\p{L}\p{M}]+/gu;
const CYRILLIC_OR_GREEK = /[\u0370-\u03ff\u0400-\u052f]/u;
const EACH_CYRILLIC_OR_GREEK = /[\u0370-\u03ff\u0400-\u052f]/gu;
const LATIN_LETTER = /[a-z]/iu;
/** Cyrillic and Greek letters drawn like Latin ones. */
const LOOKALIKE: Readonly<Record<string, string>> = {
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x",
  "\u0455": "s", "\u0456": "i", "\u0458": "j", "\u04bb": "h", "\u04cf": "l", "\u0501": "d", "\u051b": "q", "\u051d": "w",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O",
  "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0423": "Y", "\u0425": "X", "\u0405": "S", "\u0406": "I", "\u0408": "J",
  "\u03b1": "a", "\u03bf": "o", "\u03bd": "v", "\u03c1": "p", "\u03b9": "i", "\u03ba": "k", "\u03c5": "u",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039a": "K",
  "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
};
const digitValues = new Map<string, string>();

function asciiDigit(digit: string): string {
  const known = digitValues.get(digit);
  if (known !== undefined) return known;
  const point = digit.codePointAt(0) ?? 0;
  let zero = point;
  while (zero > 0 && ONE_DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
  const value = String((point - zero) % 10);
  digitValues.set(digit, value);
  return value;
}

function latinLookalikes(word: string): string {
  if (!CYRILLIC_OR_GREEK.test(word) || !LATIN_LETTER.test(word)) return word;
  return word.replace(EACH_CYRILLIC_OR_GREEK, (letter) => LOOKALIKE[letter] ?? letter);
}

/** The text as it shows, so the words read are the words seen. Reading it
 *  again changes nothing. */
export function canonicalDraftText(text: string): string {
  const plain = text
    .replace(NEXT_LINE, "\n")
    .replace(SHOWS_NOTHING, "")
    .normalize("NFKC")
    .replace(NON_ASCII_DIGIT, asciiDigit);
  // Lookalikes before marks: a mark on a letter made Latin is a mark on ASCII.
  return (CYRILLIC_OR_GREEK.test(plain) ? plain.replace(WORD, latinLookalikes) : plain).replace(MARK_ON_ASCII, "");
}

// A number, bounded so no pattern backs off through a long run of digits:
// "1,500", "12.50", "180" ("4 500" is read as "4,500": patternReading). It
// never starts inside a number, so a run of digits and commas is tried once,
// not at every digit; WHOLE stops a lookahead being met by backing off a digit.
const NUM = String.raw`(?<!\d[,.]?)\d(?:[\d,.]{0,12}\d)?`;
const WHOLE = String.raw`(?![\d,.]?\d)`;
/** A figure in thousands, as a price is written, never millions (a file's bytes): "4,500", "12,000.00". */
const GROUPED = String.raw`(?<!\d[,.]?)\d{1,3},\d{3}(?:\.\d{2})?(?![\d,.]?\d)`;
// Numbers in words, each one flat list. Measured on 29 October 2026: with the
// lists nested in each other and each word followed by "\b", the patterns
// compiled to three times the size they had before (V8, two-byte text), and
// once a process had compiled them all, 200,000 characters of digits took 4 s
// against 0.15 s; flat lists keep them about a quarter larger than before,
// and that time near 0.2 s. A pattern that grows should be measured the same way.
const UNIT_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine)`;
const TENS_OR_TEEN = String.raw`(?:ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)`;
const NUMBER_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)`;
// A number in words, as a room's size is written, never a bare "two" nor "twenty minutes": "two hundred",
// "a hundred and fifty", "a couple of hundred", "fifteen", "fifty five", "twenty-odd", "two-twenty".
const WORD_NUM = String.raw`(?:(?:a|several|a\s+few|a\s+couple\s+of|one|two|three|four|five|six|seven|eight|nine)\s+hundred(?:\s+and\s+[a-z]+)?|hundreds|${TENS_OR_TEEN}(?:-[a-z]+|\s${UNIT_WORD})?|${UNIT_WORD}-[efnst][a-z]+)`;
const COUNT = String.raw`(?:${NUM}${WHOLE}|${WORD_NUM})`;
/** "Grand" as money, never a grand room: "two grand", never "all eleven Grand Hall sources". */
const GRAND = String.raw`grand\b(?!\s+(?:hall|halls|room|rooms|staircase|entrance|piano|occasion|tour|old|ceiling|scale|setting|building|venue|space|style|day|evening|dinner|ball)\b)`;
/** Thousands in words, as a price is said: "four and a half thousand", "a couple of grand",
 *  "four thousand five hundred", "four to five thousand", "4.5 thousand", "four point five thousand". */
const WORD_THOUSANDS = String.raw`(?:(?:a|${NUMBER_WORD})\s+(?:and|to|or)\s+)?(?:a(?:\s+couple\s+of|\s+few)?|${NUMBER_WORD}(?:[- ]${UNIT_WORD})?(?:\s+point\s+${UNIT_WORD})?|${NUM})(?:\s+and\s+a\s+(?:half|quarter))?\s*(?:thousand|${GRAND})(?:\s*,?\s+(?:and\s+)?${NUMBER_WORD}(?:\s+hundred)?)?`;
/** Hundreds counted past ten, as a price is said and a room's size is not: "forty-five hundred", "twelve hundred". */
const WORD_HUNDREDS = String.raw`${TENS_OR_TEEN}(?:[- ]${UNIT_WORD})?\s+hundred`;
/** Not a time, a span of time or a distance: "until midnight", "6pm", "20 minutes", "2 to 3 hours", "200 metres",
 *  nor a decade or an ordinal ("1920s", "50th"). A range of people is a count: "seats 180 to 220". */
const TIME_WORD = String.raw`(?:am\b|pm\b|a\.m\.|p\.m\.|o'clock|hours?\b|hrs?\b|minutes?\b|mins?\b|days?\b|weeks?\b|months?\b|years?\b|%|percent\b|per\s+cent\b|metres?\b|meters?\b|miles?\b|yards?\b|feet\b|foot\b|ft\b|km\b|square\b|sq\b)`;
const NOT_TIME = String.raw`(?!(?:st|nd|rd|th|s|'s|\u2019s)\b|\s*(?:(?:to|and|[-\u2013])\s*\d{1,4}(?:[.:]\d{2})?\s*)?${TIME_WORD}|\s*(?:until|till)\b)`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAY = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)days?`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)`;
/** A date, as drafts write one: "the 17th", "14 August", "Saturday 17th June", "June 1st", "17 September 2027". */
/** A day of the month in words, as a date is said: "Saturday the twentieth", "the first of June". */
const WORD_ORDINAL = String.raw`(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-[a-z]+|thirtieth|thirty-first)`;
const DATE = String.raw`(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|${WEEKDAY}\s+the\s+${WORD_ORDINAL}|the\s+${WORD_ORDINAL}\s+of\s+${MONTH}|(?:${WEEKDAY}\s+)?(?:the\s+)?(?:${ORDINAL}|\d{1,2})(?:\s+(?:of\s+)?${MONTH})?(?:\s+\d{4})?|${MONTH}\s+(?:${ORDINAL}|\d{1,2})(?:,?\s+\d{4})?|${WEEKDAY})`;
/** A date written as one, never a bare number: "the 17th", "Saturday 17 June", "June 1st", "Saturday". */
const DATED = String.raw`(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|${WEEKDAY}\s+the\s+${WORD_ORDINAL}|the\s+${WORD_ORDINAL}\s+of\s+${MONTH}|(?:${WEEKDAY}\s+)?(?:the\s+)?${ORDINAL}(?:\s+(?:of\s+)?${MONTH})?(?:\s+\d{4})?|(?:${WEEKDAY}\s+)?\d{1,2}\s+(?:of\s+)?${MONTH}(?:\s+\d{4})?|${MONTH}\s+(?:${ORDINAL}|\d{1,2})(?:,?\s+\d{4})?|${WEEKDAY})`;
/** A date in figures, never a bare number, for the patterns added on 29 October 2026: "Saturday",
 *  "the 17th", "Saturday 17 June 2027", "17/06", "June 17". DATED without its words ("the first of
 *  June"), at about half its compiled size (see NUMBER_WORD). */
const DATE_FIGURES = String.raw`(?:(?:${WEEKDAY}\s+)?(?:(?:the\s+)?\d{1,2}(?:st|nd|rd|th)(?:\s+(?:of\s+)?${MONTH})?|\d{1,2}\s+(?:of\s+)?${MONTH})(?:\s+\d{4})?|${WEEKDAY}|\d{1,2}\/\d{1,2}|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?)`;
/** A day for the same patterns: a date in figures, "the date", "that day". */
const DAY_FIGURES = String.raw`(?:${DATE_FIGURES}|(?:the|that|this|your)\s+(?:date|day))`;
/** A day, never a bare number or "may": a date, "June", "your preferred date", "that weekend". */
const DAY = String.raw`(?:${DATED}|(?!may\b)${MONTH}(?:\s+\d{4})?|(?:the|that|this|your|our|their)\s+(?:(?:preferred|chosen|requested|first[- ]choice|new|proposed|other|alternative|second|original)\s+)?(?:date|dates|day|slot|weekend|evening|night))`;
/** What can be free or taken: a date, a room, the Diary. */
const SLOT = String.raw`(?:${DATE}|${MONTH}(?:\s+\d{4})?|(?:the\s+|that\s+|this\s+|your\s+)?(?:date|day|slot|evening|night|weekend|afternoon|morning|room|rooms|hall|saloon|suite|venue|diary)|both\s+rooms|it|that|this)`;
/** Is, with any aside before it: "(the Saturday)", ", the 17th,", " \u2014 the 17th \u2014", ", which", " you mentioned". */
const IS = String.raw`(?:\s*\([^()\n]{1,30}\)|\s*,[^,.;:!?()\n]{1,40},|\s+[\u2013\u2014][^.;:!?()\n\u2013\u2014]{1,40}[\u2013\u2014]|\s*,?\s+which|\s+(?:you|we|they|she|he)\s+(?:mentioned|asked\s+(?:about|for)|requested|wanted|chose|gave|suggested|preferred|proposed|had\s+in\s+mind))?(?:\s+(?:is|are|was|remains|remain|would\s+be|will\s+be|should\s+be|be|(?:looks|look|seems|appears)(?:\s+to\s+be)?)|'s|\u2019s)`;
/** When a room is free or in use: "on the 17th", "that weekend", "then". */
const TIME_ANCHOR = String.raw`(?:on\s+(?:the\s+)?(?:\d|(?:mon|tues|wednes|thurs|fri|satur|sun)day|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|(?:your|that|this)\s+(?:date|day))|(?:that|this|next)\s+(?:day|night|evening|date|weekend|afternoon|morning|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|then\b|all\s+(?:day|evening|night|weekend))`;
/** Free, as availability: followed by nothing, or by when or where, never "free of columns" or "free text". */
const FREE = String.raw`free(?=\s*(?:$|[.,;:!?()\u2014\u2013]|-\s|on\b|that\b|this\b|then\b|in\b|at\b|from\b|next\b|all\s+day\b|now\b|still\b|again\b|too\b|as\s+well\b|as\s+a\s+bird\b|until\b|till\b|if\s+you\b|as\s+(?:of|things\s+stand)\b|to\s+(?:book|reserve|hold)\b|for\s+(?:the\b|you(?!\s+to\s+(?:visit|come|call|pop|drop|meet|talk|chat|view|see)\b)|your\s+(?:date|day|event|wedding|dinner|party)|(?:a|an)\s+(?:wedding|event|booking|dinner|party|ceremony|reception))\b))`;
/** Open, as availability: never opening hours ("open until midnight", "open to everyone"); "open to you" said alone. */
const OPEN = String.raw`open(?!\s+(?:until|till|from|at|between|daily|late)|\s+to(?!\s+(?:bookings?|offers?|enquiries|reservations)\b|\s+you\s*(?:$|[.!;,)]))|\s+for(?!\s+(?:the\s+|your\s+)?(?:[a-z]+\s+)?(?:saloon|hall|room|suite|date|day|event|wedding|booking|bookings|you)\b))`;
/** Available, never a document or a person: "available to download", "available from the team". */
const AVAILABLE = String.raw`available(?!\s+(?:to\s+(?:download|view|see|read|browse|print|share|discuss)|on\s+request|online|here|below|from\s+(?:our|your|their|this|that)\b|from\s+the\s+(?:events?\s+team|team|office|website|link|brochure|pack|reception|front\s+desk)\b|in\s+(?:the\s+)?(?:pack|link|brochure)))`;
const TAKEN = String.raw`taken(?!\s+(?:care|into|on\s+board|seriously|note|account|us|me|them|a\b|an\b|some|longer|time))`;
/** Booked or reserved as a state, never how booking is done or what a room is set aside for
 *  ("rooms are booked through our events team", "reserved for the drinks reception"). */
const BOOKED = String.raw`booked(?!\s+(?:through|via|online|directly|separately|in\s+advance|on\s+request|by\s+(?:contacting|calling|emailing|phone|email)|with\s+(?:our|the)\s+(?:events?\s+)?team)\b)`;
const RESERVED = String.raw`reserved(?!\s+for\s+(?:the\s+)?(?:drinks|reception|ceremony|dinner|use|private|members|guests|weddings|events|functions|staff|top\s+table)\b)`;
const CLEAR = String.raw`clear(?!\s+(?:that|how|what|why|whether|about)\b|\s+(?:in\s+(?:our|my|your|their)\s+(?:minds?|heads?)|to\s+(?:us|me|see))\b)`;
/** Free or taken, said of a date or a room: "vacant", "unoccupied". */
const FREE_OR_TAKEN = String.raw`(?:${AVAILABLE}|unavailable|${FREE}|${OPEN}|${BOOKED}|fully\s+booked|${TAKEN}|${RESERVED}|${CLEAR}|gone|up\s+for\s+grabs|spoken\s+for|snapped\s+up|vacant|unoccupied|unbooked|unreserved)`;
/** Said of a day only, never of "it" or "that": "the 17th is fine", "Saturday would be possible",
 *  "the 17th looks good", "Saturday is a yes from us", "your date is still on the table". */
const DAY_FINE = String.raw`(?:fine|possible|doable|achievable|bookable|ok|okay|no\s+problem|not\s+a\s+problem|good\s+for\s+us|good\s+to\s+go|all\s+clear|empty|on\s+offer|on\s+the\s+table|a\s+go(?![-\w])|good(?=\s*(?:$|[.,;!?)\u2014\u2013]|(?:for|to|from|on|at)\s+(?:us|our)\b|so\s+far\b))|a\s+(?:firm\s+)?yes(?=\s*(?:$|[.,;!?]|from\s+(?:us|our|the\s+(?:venue|team|hall))\b)))\b(?!\s+to\b)`;
const ROOM = String.raw`(?:hall|room|saloon|suite|space|venue|it)`;
const PEOPLE = String.raw`(?:guests|people|persons|covers|delegates|attendees|pax|seated|standing|theatre|cabaret|classroom|banquet|boardroom|for\s+dinner|for\s+a\s+(?:dinner|reception|ceremony))`;
const ABOUT = String.raw`(?:(?:all(?:\s+of)?|up\s+to|between|a\s+maximum\s+of|as\s+many\s+as|over|more\s+than|around|about|approx(?:imately|\.)?|nearly|almost|roughly|circa)\s+|(?:~|ca?\.)\s*)?`;
/** Not things a room holds or a count of occasions: "holds 14 stained-glass windows", "hosts 150 events a year",
 *  "seats 10 at each round table". */
const NOT_THINGS = String.raw`(?!\s+(?:at\s+(?:each|every|a|an|one|the\s+(?:top|head))\b(?!\s+(?:push|squeeze|time)\b)|per\s+(?:table|round)\b|to\s+a\s+table\b|around\s+(?:each|a|every)\s+table\b|(?:(?!(?:for|at|in|on|with|and|or|to)\s)[a-z-]+\s+)?(?:windows|portraits|paintings|pictures|banners|flags|crests|chandeliers|pipes|organs|candles|books|artworks|works|items|pieces|panels|events|weddings|functions|ceremonies|conferences|meetings|concerts|shows|performances|parties|exhibitions|tastings|viewings|bookings|enquiries|florists|staff|bars|tables(?!\s+of\b)|chairs|courses|years|times|visitors)\b))`;
/** What follows a number of people: people, how they sit, a condition, or nothing: "230 at a push", "120 for
 *  dinner", "132 with the revised arrangement"; never "3 tastings a year" or "2 viewings". */
const PEOPLE_AFTER = String.raw`(?=\s*(?:$|[.,;:!?)\u2014\u2013]|(?:[a-z-]+\s+)?(?:guests|people|persons|covers|delegates|attendees|pax|diners)\b|(?:seated|standing|comfortably|easily|happily|max|maximum|or\s+so|theatre|cabaret|banquet|reception|classroom|boardroom|if|but|so|when|with|including|plus|at\s+most)\b|(?:at|on|around|across|in|for)\s+(?:a\s+(?:push|squeeze|time|dinner|reception|ceremony|wedding|meal)|dinner|drinks|rounds?|long|banquet|trestle|rectangular|cabaret|theatre|rows|the|there|it|our)\b))`;
/** Said about a figure: "about", "a shade under", "somewhere between", "in the region of", "c.", "~". */
const APPROX = String.raw`(?:(?:about|around|roughly|only|just|nearly|almost|approx(?:imately|\.)?|circa|some|under|over|between|(?:just|a\s+(?:shade|touch|little|bit))\s+(?:under|over|shy\s+of)|shy\s+of|upwards\s+of|close\s+to|in\s+the\s+region\s+of|somewhere\s+(?:between|around))\s+|(?:~|c\.)\s*)?`;
/** What can follow an amount of money said bare: the end, "for the room", "plus VAT", "altogether", "or thereabouts",
 *  "sterling", "to hire the hall", "depending on the date". */
const MONEY_TAIL_WORDS = String.raw`\s*(?:$|[.,;!?()]|for\b|plus\b|\+|altogether\b|in\s+total\b|all\s+in\b|incl|inc\b|including\b|exc|excluding\b|ex\b|per\b|a\s+(?:head|night|day|session)\b|each\b|apiece\b|sterling\b|depending\b|or\s+(?:so|thereabouts)\b|up\s*front\b|upfront\b|on\s+(?:booking|signing)\b|to\s+(?:hire|book|rent|reserve|secure)\b|on\s+(?:a\s+)?(?:${WEEKDAY}|weekdays?|weekends?)\b)`;
const MONEY_TAIL = String.raw`(?=${MONEY_TAIL_WORDS})`;
/** A figure in thousands followed by another as a price's range: "4,500 to 5,000 depending on the date". */
const MONEY_RANGE = String.raw`(?=\s*(?:to|and|or|[-\u2013\u2014])\s*(?:[£$\u20ac]\s{0,3})?\d{1,3},\d{3}(?![\d,.]?\d)${MONEY_TAIL_WORDS})`;
/** What a bare figure can be the price of: "the Saloon is 900 for the afternoon", "canap\u00e9s are 12 apiece". */
const PRICED_FOR = String.raw`(?=\s+(?:for\s+(?:the\s+|an?\s+|each\s+)?(?:afternoon|evening|day|night|morning|room|hall|saloon|hire|weekend|event|venue|package|session|half[- ]day|full\s+day)\b|plus\s+vat\b|\+\s*vat\b|a\s+(?:head|pop|person|plate|bottle|night)\b|per\s+(?:head|person|guest)\b|each\b|apiece\b|sterling\b|to\s+(?:hire|rent)\b|all\s+in\b|altogether\b|in\s+total\b))`;
/** A charge for each guest or thing: "pp", "pph", "p.p.", "/head", "a head", "per person", "apiece", "a pop". */
const PER_HEAD = String.raw`(?:pph?\b|p\.\s?p\.?|p\/p\b|\/\s?(?:head|person|guest|cover|pp|pax|plate)\b|per\s+(?:head|person|guest|cover|plate)\b|a\s+(?:head|person|guest|cover|plate|pop|bottle|glass)\b|apiece\b)`;

/** Can or cannot: "can", "would", "can't", "won't". */
const MODAL = String.raw`(?:can|could|will|would|can't|can\u2019t|cannot|can\s+not|couldn't|couldn\u2019t|won't|won\u2019t|will\s+not|wouldn't|wouldn\u2019t|would\s+not)`;
/** A judgement of what the client's money will buy, which is the team's to make:
 *  "your budget should comfortably cover dinner", "well within your budget". */
const BUDGET_JUDGED = /\bbudget\b[^.!?;\n]{0,60}?\b(?:should|would|will|could)\s+(?:easily\s+|comfortably\s+|more\s+than\s+|just\s+about\s+)?(?:cover|stretch|be\s+(?:enough|plenty|ample|sufficient))\b|\b(?:well\s+)?(?:within|over|under|exceeds?|beyond)\s+(?:(?:your|their|the|our)\s+)?budget\b/giu;

const PATTERNS: Readonly<Record<AIDraftCommitmentKind, readonly RegExp[]>> = {
  price: [
    // An amount of money by its sign or code: "£2,500", "GBP 4,200", "1500 GBP"; "\uffe1" is "£" once canonical.
    new RegExp(String.raw`[£$\uffe1\u20ac]\s{0,3}${NUM}`, "giu"),
    new RegExp(String.raw`\b(?:gbp|usd|eur)\s{0,3}${NUM}|\b${NUM}\s?(?:gbp|usd|eur)\b`, "giu"),
    // By its name: "1,800 pounds", "two thousand pounds", "four and a half grand", "4,500 sterling", "2k for the room".
    new RegExp(String.raw`\b(?:${NUM}|${WORD_NUM}|(?:a|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+and\s+a\s+(?:half|quarter))?\s+thousand|(?:a|one|two|three|four|five|six|seven|eight|nine|ten|a\s+couple\s+of)(?:\s+and\s+a\s+(?:half|quarter))?\s+(?=grand))\s?(?:pounds?|quid|euros?|dollars?|sterling|${GRAND})\b`, "giu"),
    new RegExp(String.raw`\b${NUM}\s?k\b${MONEY_TAIL}`, "giu"),
    // A charge per guest or per thing: "£65 per head", "65pp", "65 pph", "72/head", "fifty five a head", "12 apiece", "five a head".
    new RegExp(String.raw`\b(?:${NUM}${WHOLE}|${WORD_NUM})\s?${PER_HEAD}|\b${UNIT_WORD}\s+(?:a\s+(?:head|pop|plate)\b|apiece\b|pph?\b|p\.\s?p\.?|\/\s?head\b)`, "giu"),
    // A figure with VAT: "900 plus VAT", "1,000 + VAT", "1,000 including VAT".
    new RegExp(String.raw`\b${NUM}${WHOLE}\s*(?:\+|plus|inc(?:luding|l\.?)?|exc(?:luding|l\.?)?|ex)\s*vat\b`, "giu"),
    // A pricing word given a figure: "the deposit is 500", "room hire is 2,000", "prices begin at 3,950",
    // "room hire is four thousand five hundred", "a 500 deposit".
    new RegExp(String.raw`\b(?:deposit|minimum\s+spend|hire\s+fee|hire\s+charge|room\s+hire|venue\s+hire|exclusive\s+use|fee|price|cost|charge)s?(?:\s+[a-z]+){0,5}?\s+(?:is|are|would\s+be|will\s+be|of|comes?\s+to|(?:starts?|begins?)\s+(?:at|from)|from)\s+${APPROX}(?:${NUM}${WHOLE}(?!\s*(?:guests|people|covers|delegates|tables|chairs|staff|until|till|am\b|pm\b|o'clock|hours?|minutes?|%))|(?:a|${UNIT_WORD})\s+hundred${MONEY_TAIL})`, "giu"),
    // A rate, a package or a total given a figure, never "a rate of 1 server per 10 guests": "our Saturday rate is 4,500",
    // "the package comes to 7,800", "hire of the Grand Hall is forty-five hundred".
    new RegExp(String.raw`\b(?:rates?|hire|package|figure|total|bill|balance|supplement|corkage)(?:\s+[a-z]+){0,5}?\s+(?:is|are|would\s+be|will\s+be|comes?\s+to|(?:starts?|begins?)\s+(?:at|from)|runs?\s+to)\s+${APPROX}(?:${NUM}${WHOLE}(?:${MONEY_TAIL}|(?=\s+(?:and|to|or)\s+\d))|(?:a|${UNIT_WORD})\s+hundred${MONEY_TAIL})`, "giu"),
    new RegExp(String.raw`\b(?:a|an)\s+${NUM}${WHOLE}\s+(?:deposit|hire\s+fee|minimum\s+spend|room\s+hire)\b`, "giu"),
    // A total said as money: "comes to 4,200", "works out at 3,000 altogether", "we'd be looking at 2,000 for the evening",
    // "expect to pay about 4,500", "budget around 4,500 for the room".
    new RegExp(String.raw`\b(?:comes?\s+(?:to|(?:out|in)\s+at)|works?\s+out\s+at|costs?(?:\s+you)?|charges?|priced\s+at|looking\s+at|would\s+be|start(?:s|ing)?\s+from|set\s+you\s+back|pay(?:ing)?|budget(?:ing)?(?:\s+for)?|ask(?:s|ing)?(?:\s+for)?|(?:drops?|falls?|rises?|goes\s+(?:up|down)|comes\s+down|reduces?|is\s+reduced)\s+to)\s+${APPROX}${NUM}${WHOLE}${MONEY_TAIL}`, "giu"),
    // A room or a package given for a figure, never for a count or a time: "we can do the Saloon for 900 on a weekday".
    new RegExp(String.raw`\b(?:do|let\s+you\s+have|offer(?:\s+you)?|give\s+you)\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|venue|space|package|date|day|evening)\s+for\s+(?:about\s+|around\s+|roughly\s+|just\s+|only\s+)?${NUM}${WHOLE}(?!\s*(?:guests|people|persons|covers|delegates|attendees|pax|seated|standing|hours?|hrs?|minutes?|mins?|am\b|pm\b|o'clock|until|till|%))`, "giu"),
    // A figure asked for up front, or put down: "we'd want 1,000 up front to hold the date", "we'd need 500 down to secure it".
    new RegExp(String.raw`${GROUPED}(?=\s+(?:up\s*front|upfront|on\s+(?:booking|signing)|to\s+(?:hold|secure|reserve|confirm)\b|as\s+(?:a\s+)?deposit\b|deposit\b))|\b${NUM}${WHOLE}\s+down\s+(?:to|on)\s+(?:hold|secure|reserve|confirm|book)\b|\b(?:need|want|ask\s+for|require|take)\s+(?:a\s+)?${NUM}${WHOLE}\s+(?:down|up\s*front|upfront|as\s+(?:a\s+)?deposit)\b`, "giu"),
    // A figure said to be the price, never a count, a code ("0078") or a figure of millions:
    // "Saturdays are 4,500 for the Grand Hall", "the Saloon is 900 for the afternoon", "it's 4,500 to hire the hall",
    // "the Grand Hall is 4,500 to 5,000 depending on the date", "the Saloon is a shade under 1,000 for the afternoon".
    new RegExp(String.raw`(?<!\b(?:numbers?|guests?|count|headcount|people|party|group|list|attendance|covers)\s{1,3})\b(?:is|are|'s|\u2019s|be)\s+${APPROX}(?!0\d)(?:${GROUPED}(?:${MONEY_TAIL}|${MONEY_RANGE})|${NUM}${WHOLE}${PRICED_FOR})`, "giu"),
    // Thousands in words, said as a price: "is four and a half thousand", "costs a couple of grand",
    // "that's forty-five hundred for the evening", "somewhere between four and five thousand".
    new RegExp(String.raw`\b(?:is|are|'s|\u2019s|be|costs?|comes?\s+(?:to|(?:out|in)(?:\s+at)?)|works?\s+out\s+at|priced\s+at|looking\s+at|(?:start|begin)(?:s|ning|ing)?\s+(?:at|from)|set\s+you\s+back|charges?|pay(?:ing)?|budget(?:ing)?(?:\s+for)?|runs?\s+to|ask(?:s|ing)?(?:\s+for)?|go(?:es)?\s+for)\s+${APPROX}(?:${WORD_THOUSANDS}|${WORD_HUNDREDS})${MONEY_TAIL}`, "giu"),
    // A figure in thousands said as a price, whatever follows: "weddings start from 5,000 in the Grand Hall",
    // "prices begin at 3,950", "hire runs to 4,500 on a Saturday", "we ask 4,500 for Saturdays", "goes for 4,500".
    new RegExp(String.raw`\b(?:comes?\s+(?:to|(?:out|in)(?:\s+at)?)|works?\s+out\s+at|costs?(?:\s+you)?|priced\s+at|looking\s+at|would\s+be|(?:start|begin)(?:s|ning|ing)?\s+(?:from|at)|pay(?:ing)?|budget(?:ing)?(?:\s+for)?|runs?\s+(?:to|at)|ask(?:s|ing)?(?:\s+for)?|go(?:es|ing)?\s+for)\s+${APPROX}${GROUPED}(?!\s*(?:guests|people|persons|covers|delegates|attendees|visitors|square|sq\b|feet|metres|years))`, "giu"),
    // A figure that buys the room: "4,500 gets you the Grand Hall for the evening".
    new RegExp(String.raw`${GROUPED}\s+(?:gets?|buys?|secures?|reserves?|(?:will|would|should)\s+(?:get|buy|secure|reserve))\s+(?:you|the|your)\b`, "giu"),
    // A share of the price in words: "the deposit is a quarter of the total".
    /\b(?:a\s+(?:quarter|third|fifth|tenth)|half|two\s+thirds|three\s+quarters)\s+of\s+the\s+(?:total|price|cost|hire|quote|balance|room\s+hire|bill)\b(?!\s+(?:number|guests|people|count|capacity)\b)/giu,
    // A share of the price: "a 25% deposit", "10% off the room hire".
    /\b\d{1,3}(?:\.\d)?\s?%\s+(?:deposit|off|discount|surcharge|service\s+charge)\b|\b\d{1,3}\s?%\s+(?:of|on)\s+the\s+(?:total|hire|room\s+hire|balance|quote)\b|\b\d{1,3}\s?%\s+(?:less|more|lower|higher|cheaper|dearer)\b/giu,
    // A figure in thousands said in words: "costs a little over five thousand".
    /\b(?:costs?|priced\s+at|comes?\s+to|works?\s+out\s+at|start(?:s|ing)?\s+(?:at|from)|set\s+you\s+back)\s+(?:[a-z]+\s+){0,3}?(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+thousand\b/giu,
    // A chargeable thing said to cost nothing: "room hire is free when you book dinner", "corkage is waived".
    /\b(?:hire|room\s+hire|venue\s+hire|corkage|parking|cake\s+cutting|delivery|set-up|setup)\s+(?:is|are|would\s+be|will\s+be|comes)\s+(?:also\s+)?(?:free|included|waived|complimentary)\b/giu,
    /\b(?:deposit|discount|surcharge|service\s+charge|reduction)\s+of\s+\d{1,3}(?:\.\d)?\s?%/giu,
    // Said as a summary's label: "Price: 4,500 for the evening", "Deposit: 25%".
    new RegExp(String.raw`\b(?:price|cost|deposit|fee|hire|room\s+hire|venue\s+hire|total|quote|rate|minimum\s+spend|per\s+head)\s*[:\u2013\u2014-]\s*(?:about\s+|around\s+|approx\.?\s+|roughly\s+)?(?:[£$\u20ac]\s{0,3})?${NUM}${WHOLE}(?!\s*(?:guests|people|persons|covers|delegates|attendees|seated|standing|tables|chairs|staff))`, "giu"),
    // Said as a label with no colon, where a line, a list's item or a clause starts, never "previews total 98,252
    // bytes": "Room hire 4,500, deposit 1,000".
    new RegExp(String.raw`(?:^|(?<=[,;(]\s{0,3}|[-*\u2022]\s{1,3}|[.!?]\s{1,3}))(?:(?:deposit|room\s+hire|venue\s+hire|hire\s+(?:fee|charge)|minimum\s+spend|per\s+head)\s+(?:[£$\u20ac]\s{0,3})?(?:${GROUPED}|\d{2,5}(?![\d,.:]))${NOT_TIME}(?!\s*(?:guests|people|persons|covers|delegates|attendees|seated|standing|tables|chairs|staff))|(?:price|cost|total|fee|rate|quote)\s+(?:[£$\u20ac]\s{0,3})?${GROUPED}(?!\s*(?:guests|people|persons|covers|delegates|attendees|seated|standing|visitors|square|sq\b|feet|metres|years)))`, "giu"),
    BUDGET_JUDGED,
    // A price compared, held or waived in words: "a third cheaper", "rates are frozen", "won't cost you anything".
    /\b(?:is|are|be|'s|\u2019s|would\s+be|will\s+be|works?\s+out|comes?\s+out|comes?\s+in)\s+(?:(?:usually|also|generally|often|normally|typically|always|even|much|far|slightly|considerably|significantly|half|twice|a\s+(?:bit|little|lot|third|quarter|fifth|fraction))\s+){0,2}(?:the\s+)?(?:cheaper|less\s+expensive|more\s+expensive|dearer)\b|\b(?:much|far|a\s+lot|slightly|considerably|significantly|half|twice|a\s+(?:bit|little|lot|third|quarter|fifth|fraction))\s+(?:cheaper|less\s+expensive|more\s+expensive|dearer)\b|\b(?:cheaper|less\s+expensive|more\s+expensive|dearer)\s+than\b/giu,
    /\b(?:half|twice|double|triple|a\s+(?:third|quarter|fraction)\s+of)\s+the\s+(?:price|cost|rate|fee)\b/giu,
    /\bnothing\s+(?:extra\s+|more\s+|further\s+)?to\s+pay\b|(?<!\b(?:what|which|anything)\s{0,3})\b(?:is|are|'s|\u2019s|would\s+be|will\s+be|comes?|come)\s+(?:(?:also|already|all|usually|always|fully|normally|generally)\s+){0,2}included\s+in\s+(?:the|your|our)\s+(?:[a-z]+\s+){0,2}?(?:rate|price|cost|fee|hire\s+fee|room\s+hire)\b|(?:^|(?<=[,(\u2014\u2013]))\s{0,3}(?:all\s+)?included\s+in\s+(?:the|your|our)\s+(?:[a-z]+\s+){0,3}?(?:rate|price|cost|fee|hire\s+fee|room\s+hire)\b/giu,
    /\b(?:prices?|rates?|charges?|fees?)\s+(?:are|is|will\s+be|would\s+be)\s+(?:frozen|held|fixed|guaranteed|locked|the\s+same)\b/giu,
    /\b(?:won't|won\u2019t|will\s+not|wouldn't|wouldn\u2019t|doesn't|doesn\u2019t|does\s+not)\s+cost\s+(?:you\s+)?(?:anything|a\s+penny|any\s+more|extra)\b/giu,
    // A price promise with no figure.
    /\b(?:free\s+of\s+charge|for\s+free|at\s+no\s+(?:extra\s+|additional\s+)?cost|no\s+(?:(?:extra|additional|room|venue|hire|corkage|service)\s+){0,2}(?:charge|fee)\b|half[- ]price)/giu,
    // Something given at no charge, in the words that give it: "parking is complimentary", "with complimentary fizz".
    /\b(?:is|are|be|'s|\u2019s|comes?|come|offer|offers|offering|include|includes|including|with|plus|enjoy|get|receive|provide|provides|a|an|the|our|your|there\s+is|there\s+are)\s+(?:(?:also|usually|always|normally|generally|often)\s+)?complimentary\b(?!\s+(?:about|of)\b)|(?:^|(?<=[.!?:;]))\s{0,3}(?:[-*\u2022]\s{1,3})?complimentary\s+(?!about\b|of\b)[a-z]/giu,
    // A discount, a waiver or a rate given, not a topic named ("asks about a discount"): "we can offer a discount", "the fee is waived".
    /\b(?:offer|offers|offering|give|gives|giving|apply|applies|applying|honour|honor|extend|do|arrange|knock\s+off|comes?\s+with|come\s+with)\s+(?:you\s+)?(?:a\s+|an\s+|our\s+|the\s+)?(?:small\s+|special\s+|further\s+|extra\s+|generous\s+|friday\s+|midweek\s+|early[- ]booking\s+|[a-z]+day\s+)?(?:discounts?|reduced\s+rates?|special\s+rates?|discounted\s+(?:rates?|prices?))\b|\bthere(?:'s|\u2019s|\s+is|\s+are)\s+(?:a\s+|an\s+)?(?:[a-z]+\s+)?(?:discounts?|reduced\s+rates?|special\s+rates?)\b|\b(?:get|gets|receive|qualify\s+for|qualifies\s+for|eligible\s+for|entitled\s+to)\s+(?:a\s+|an\s+|our\s+|the\s+)?(?:[a-z]+\s+)?(?:discount|reduced\s+rate|special\s+rate)\b|\b(?:discount|reduced\s+rate|special\s+rate)\s+(?:applies|would\s+apply|will\s+apply|of\b)|\b(?:at|on)\s+(?:a\s+|our\s+)?(?:discounted|reduced|special)\s+(?:rate|price)\b|\bdiscounted\s+(?:rate|price)\s+(?:of|is|would|will)\b|\bwe\s+(?:(?:also|usually|often|normally|do|can|could)\s+){0,2}(?:have|has|run|offer)\s+(?:a\s+|an\s+)?(?:[a-z]+\s+)?(?:discounts?|reduced\s+rates?|special\s+rates?|discounted\s+(?:rates?|prices?))\b|\b(?:discounts?|reduced\s+rates?|special\s+rates?)\s+(?:is|are)\s+(?:also\s+|usually\s+|often\s+)?(?:available|offered)\b|\bour\s+(?:[a-z]+\s+)?(?:discounts?|special\s+rates?|reduced\s+rates?|discounted\s+rates?)\b/giu,
    /(?:\b(?:be|is|are|been|being|get|gets|was|were|'s|\u2019s)\s+(?:(?:also|usually|always|normally|generally|often)\s+)?waived\b|\b(?:waive|waives|waived|waiving)\s+(?:(?:the|your|our|any|all|it|this|that)\b|(?:[a-z]+\s+)?(?:corkage|fees?|charges?|hire|deposit|costs?|minimum|cake[- ]cutting|service|supplement|surcharge)\b))/giu,
  ],
  availability: [
    // A date or room said to be free, open, booked or taken: "14 August is free in the Grand Hall",
    // "the Grand Hall would be available on that date", "the 17th has already gone".
    new RegExp(String.raw`\b${SLOT}${IS}\s+(?:still\s+|currently\s+|now\s+|definitely\s+|already\s+|wide\s+|usually\s+|normally\s+|provisionally\s+|tentatively\s+)?(?:not\s+)?${FREE_OR_TAKEN}\b`, "giu"),
    // A room or the diary in use or empty then: "the Grand Hall is not in use that evening", "our diary is empty on the 17th".
    new RegExp(String.raw`\b${SLOT}${IS}\s+(?:still\s+|currently\s+|already\s+)?(?:not\s+)?(?:in\s+use|empty)\s+${TIME_ANCHOR}`, "giu"),
    // A day said to be fine or given, never "that's fine" or "the day is yours to enjoy":
    // "the 17th is fine", "Saturday would be possible", "your date, the 17th, is available", "the 17th is yours".
    new RegExp(String.raw`\b${DAY}${IS}\s+(?:also\s+|still\s+|absolutely\s+|perfectly\s+|totally\s+|definitely\s+|certainly\s+|now\s+)?(?:not\s+)?${DAY_FINE}`, "giu"),
    new RegExp(String.raw`\b(?:(?:${WEEKDAY}\s+)?(?:the\s+)?${ORDINAL}(?:\s+(?:of\s+)?${MONTH})?|(?:${WEEKDAY}\s+)?\d{1,2}\s+(?:of\s+)?${MONTH}|${WEEKDAY}|(?:the|that|this|your)\s+(?:date|slot))${IS}\s+(?:all\s+)?yours\b`, "giu"),
    // Asked of a day or a room, so that a "Yes." after it goes too: "Is the 17th available? Yes."
    new RegExp(String.raw`\b(?:is|are|was|were)\s+${DAY}\s+(?:still\s+|currently\s+|now\s+|definitely\s+|also\s+)?(?:not\s+)?(?:${FREE_OR_TAKEN}|${DAY_FINE})`, "giu"),
    new RegExp(String.raw`\b(?:is|are|was|were)\s+(?:(?:the|that|this|your|our)\s+(?:[a-z]+\s+)?(?:hall|saloon|room|rooms|suite|venue)|both\s+rooms)\s+(?:still\s+|currently\s+|now\s+|definitely\s+|also\s+)?(?:not\s+)?${FREE_OR_TAKEN}\b`, "giu"),
    // A day accepted, never asked about or the client's: "that date works", "Saturday would work well",
    // never "let us know if the date works", "any Saturday would work for us" or "a call on Thursday would work well".
    new RegExp(String.raw`(?<![-\u2013/]|\b(?:if|whether|which|what|when|how|any|or|on|for|by|until|before|after|from)\s{1,3})\b${DAY}\s+(?:(?:also\s+|definitely\s+)?works|(?:would|should|will|could|can)\s+(?:also\s+|definitely\s+)?work)(?:\s+(?:well|fine|nicely|perfectly|beautifully|for\s+us|with\s+us|on\s+our\s+(?:side|end)|at\s+our\s+end))*(?=\s*(?:$|[.!;,)\u2014\u2013]))`, "giu"),
    // A day had, or nothing else on it: "we've got the 17th", "nothing is booked that night", "you can have the hall on the 17th".
    new RegExp(String.raw`\bwe(?:'ve|\u2019ve|\s+have)?\s+(?:still\s+)?(?:got|have)\s+${DATED}(?=\s*(?:$|[.!;,)\u2014\u2013]|(?:free|open|available|if\s+you|for\s+you|still|left|going|on\s+offer)\b))`, "giu"),
    new RegExp(String.raw`\bnothing\s+(?:else\s+)?(?:is\s+|has\s+been\s+|'s\s+|\u2019s\s+)?(?:booked|pencilled|penciled|happening|on|in)\s+(?:in\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|building|diary)\s+)?(?:(?:that|this|on\s+(?:that|this|the))\s+(?:night|day|evening|date|weekend|afternoon|morning)|on\s+${DATED}|for\s+(?:that|this|your|the)\s+(?:date|day|evening|night))`, "giu"),
    new RegExp(String.raw`\byou(?:\s+(?:can|could|would|will)|'ll|\u2019ll|'d|\u2019d)\s+have\s+(?:the\s+)?(?:(?:[a-z]+\s+)?(?:hall|saloon|room|suite|venue|building)\s+)?(?:on\s+|for\s+)?${DATED}`, "giu"),
    /\b(?:nobody|no\s+one|no-one)(?:\s+(?:has|is\s+(?:using|in|booked\s+(?:in|into))|has\s+booked|will\s+be\s+(?:using|in))|(?:'s|\u2019s)\s+(?:using|in|booked(?:\s+(?:in|into))?))\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|building|venue|date)\b/giu,
    new RegExp(String.raw`\b(?:nobody|no\s+one|no-one)(?:\s+else)?(?:(?:\s+has|'s|\u2019s)\s+(?:yet\s+)?(?:booked|taken|reserved|claimed)\s+${DAY}|\s+(?:is\s+)?(?:else\s+)?(?:in|on|booked)\s+(?:on|for)\s+${DAY})`, "giu"),
    // Nobody in the room then: "there's no one in the Grand Hall on the 17th".
    new RegExp(String.raw`\b(?:nobody|no\s+one|no-one)\s+(?:else\s+)?(?:is\s+|'s\s+|\u2019s\s+)?(?:in|using|booked\s+(?:in|into))\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite)\s+(?:on\s+${DATE_FIGURES}|(?:that|this)\s+(?:night|day|evening|weekend)\b|then\b|yet\b)`, "giu"),
    // The day hosted or booked for the client: "we can host you on the 17th", "we can take your booking for the 17th", "the diary shows the 17th as free".
    new RegExp(String.raw`\b(?:we|i)\s+${MODAL}\s+(?:host|have|accommodate|fit|take|book|squeeze)\s+(?:you|your\s+(?:event|wedding|party|booking|dinner))(?:\s+in)?\s+(?:on|for)\s+${DATED}|\b(?:we|i)\s+${MODAL}\s+(?:take|accept|confirm)\s+(?:your|the|a)\s+booking\s+(?:for|on)\s+${DATED}`, "giu"),
    new RegExp(String.raw`\b(?:diary|calendar|system|bookings?\s+sheet)\s+(?:shows?|has|lists?)\s+(?:${DAY}|(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room))\s+(?:as\s+)?(?:free|open|available|clear|empty|booked|taken)\b`, "giu"),
    new RegExp(String.raw`\b${SLOT}\s+(?:has|have|hasn't|hasn\u2019t|haven't|haven\u2019t|has\s+not|have\s+not)\s+(?:already\s+|yet\s+)?(?:gone|been\s+(?:taken|booked|snapped\s+up|claimed|reserved))\b`, "giu"),
    // Said as a note, or held for the client: "GH 14 Jun - prov. hold", "us to hold 3 March", "Saturdays free next spring".
    new RegExp(String.raw`(?<!\bno\s{1,3})\b(?:prov\.?\s+hold\b|provisional\s+hold\s+(?:on|until|till|for|in\s+place|is|has|expires)\b)|\b(?:has|have|is\s+on|with|under)\s+(?:a\s+)?provisional\s+hold\b|\b(?:us|we)\s+(?:to\s+)?(?:hold|reserve|pencil(?:\s+in)?)\s+(?:${DATED})|\b(?:${WEEKDAY}|dates|days|evenings|weekends)\s+(?:still\s+)?(?:free|open|available)\b(?!\s+(?:to\s+you\b|for\s+you\s+to\s+(?:visit|come|call|pop|drop|meet|talk|chat|view|see)\b))|\bgh\s+(?:free|available|open|booked|taken|held)\b`, "giu"),
    new RegExp(String.raw`\bearliest\s+(?:date\s+)?we\s+(?:could|can|would)\s+(?:fit\s+you\s+in|offer\s+you|do|host)\b|\bfit\s+you\s+in\s+(?:(?:on|for)\s+(?:${DATE}|that\s+(?:date|day)|the\s+date|(?:your|the|that)\s+(?:preferred\s+|chosen\s+|requested\s+|first[- ]choice\s+)?(?:date|day))|in\s+${MONTH})|\bfit\s+you\s+in\s+(?:on\s+|for\s+)?(?:${DATE_FIGURES}|(?:that|this|next|the|your)\s+(?:${WEEKDAY}|date|day|evening|weekend|night)\b)`, "giu"),
    new RegExp(String.raw`(?<!\b(?:nothing|none|no\s+part)\s{1,3}(?:for|of|about|on)\s{1,3})\b(?:your|the|our|their)\s+(?:[a-z]+\s+){0,2}?(?:wedding|event|booking|dinner|party|reception|conference)(?:\s+[^\s.!?,;:]+){0,4}?\s+(?:is|has\s+been)\s+(?:now\s+)?(?:confirmed|booked|secured|reserved)\b`, "giu"),
    /\b(?:isn't|aren't|wasn't|isn\u2019t|aren\u2019t|wasn\u2019t)\s+(?:available|free|booked|taken)\b/giu,
    /\bwe(?:'re|\u2019re|\s+are)\s+(?:still\s+|currently\s+)?(?:not\s+)?(?:free|booked|fully\s+booked|full)\s+(?:on|that|this|then|for\s+(?:that|this|the|your)\s+(?:date|day|evening|night|weekend))\b/giu,
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
    new RegExp(String.raw`(?:\b(?:hall|saloon|room|suite)|${DATE})(?:\s*[:\u2013\u2014]|\s+-)\s*(?:still\s+)?(?:free|available|open|booked|held|taken|reserved|vacant|unbooked)\b`, "giu"),
    new RegExp(String.raw`\b(?:dates?|days?|${WEEKDAY}|slots?|evenings?|weekends?)\s+(?:that\s+)?(?:we\s+(?:still\s+)?have\s+)?(?:(?:are|is)\s+(?:still\s+)?)?(?:left|remaining)\b`, "giu"),
    /\bconfirmed\s+(?:as\s+)?(?:free|available|open|clear)\b|\bnothing\s+(?:else\s+)?(?:is\s+)?(?:in|booked\s+in|on)\s+(?:the|our)\s+diary\b/giu,
    new RegExp(String.raw`\b(?:we|i)(?:\s+${MODAL}(?:\s+be\s+able\s+to)?|(?:'re|\u2019re|\s+are|'m|\u2019m|\s+am)\s+(?:able|happy|pleased|glad|delighted)\s+to)\s+(?:accommodate|do|offer|host|take)\s+(?:your|the|that|this)\s+(?:preferred\s+|chosen\s+|requested\s+|first[- ]choice\s+)?(?:date|day|evening|weekend)\b`, "giu"),
    /\b(?:more|fewer|several|some|a\s+few|no|plenty\s+of)\s+(?:open|free|available)\s+(?:dates|days|slots|saturdays|fridays|sundays|evenings|weekends)\b/giu,
    // The room had, or the event hosted, on a date: "we've got the Grand Hall all day on the 14th", "we can host your event on 30 May".
    new RegExp(String.raw`\bwe(?:'ve|\u2019ve|\s+have)?\s+(?:got|have)\s+the\s+(?:[a-z]+\s+)?(?:hall|saloon|room|suite)\s+(?:from\s+\d|all\s+(?:day|evening|night)|on\s+${DATE}|that\s+(?:day|evening|night)|until)`, "giu"),
    new RegExp(String.raw`\b(?:we|i)\s+${MODAL}\s+(?:host|accommodate|fit\s+in|take|do)\s+(?:your|the|this|their)\s+(?:[a-z]+\s+){0,2}?(?:event|wedding|dinner|party|conference|reception|booking|ceremony)\s+(?:on|in)\s+(?:the\s+)?(?:${DATE})`, "giu"),
    /\bnothing\s+else\s+(?:is\s+)?(?:happening|on)\b/giu,
    /\bwe\s+(?:still\s+)?have\s+(?:one|two|three|four|a\s+few|a\s+couple|\d{1,2})\s+(?:left|remaining)\b|\bgoing\s+fast\b/giu,
    /\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+have\s+(?:it|the\s+(?:[a-z]+\s+)?(?:hall|room|saloon|building|guildhall|venue|place))\s+to\s+yoursel(?:f|ves)\b/giu,
    new RegExp(String.raw`\bwe\s+can\s+do\s+${DATED}`, "giu"),
    new RegExp(String.raw`\b(?:we|i)(?:(?:'re|\u2019re|\s+are|'m|\u2019m|\s+am)?\s+(?:able|happy|pleased|delighted|glad)\s+to|\s+${MODAL}(?:\s+be\s+able\s+to)?)\s+offer\s+you\s+(?:(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|date|day|evening|space)\b(?:[^.!?\n]{0,20}?\b(?:on|for)\s+${DATE})?|${DATED})`, "giu"),
    // The date accepted, or the room given: "17 September 2027 works well for us", "the room is yours on the 17th".
    new RegExp(String.raw`\b(?:${DATE}|(?:that|this|the|your)\s+date)\s+works\s+(?:well\s+|nicely\s+|perfectly\s+)?for\s+us\b`, "giu"),
    /\b(?:room|hall|saloon|suite|venue|guildhall|date|slot)\s+is\s+(?:all\s+)?yours\b|\b(?:is|are)\s+ours\s+to\s+(?:offer|give)\b|\bit(?:'s|\u2019s|\s+is)\s+(?:all\s+)?yours\b(?!\s+to\b)/giu,
    /\b(?:nobody|no\s+one|no-one)\s+else\s+(?:has|is\s+(?:using|in|booked|on)|has\s+booked|will\s+be\s+(?:using|in))\b|\byou(?:'d|\u2019d|\s+would|'ll|\u2019ll|\s+will)\s+be\s+the\s+only\s+(?:booking|event|party|wedding)\b/giu,
    // Confirmed by the venue: "we can confirm the date", "I'm happy to confirm the Grand Hall", "your date is confirmed".
    /\b(?:we|i)(?:'m|\u2019m|'re|\u2019re|\s+am|\s+are)?\s+(?:can\s+|could\s+)?(?:now\s+)?(?:happy\s+|pleased\s+|delighted\s+|glad\s+|able\s+)?(?:to\s+)?confirm\s+(?:that\s+)?(?:the|your)\s+(?:date|booking|room|hall|grand\s+hall|saloon|reservation|hold|day|evening)\b/giu,
    /(?<!\bno\s{1,3})\b(?:date|booking|room|hall|reservation|hold)\s+(?:is|has\s+been)\s+(?:now\s+)?(?:confirmed|secured|guaranteed)\b/giu,
    // Said as a summary's label: "Availability: free on 17 June", "Status: held".
    /\b(?:availability|status|diary)\s*[:\u2013\u2014-]\s*(?:(?:still|currently|now)\s+)?(?:(?:the\s+)?(?:date|room|hall)\s+)?(?:free|available|open|booked|held|taken|reserved|confirmed|pencilled|clear)\b/giu,
    // A date marked as a note: "Saturday 17 June - no bookings yet", "Saturday 17 June \u2705".
    new RegExp(String.raw`\b${DATE_FIGURES}(?:\s*[:\u2013\u2014]|\s+-)\s*(?:no\s+(?:other\s+)?(?:bookings?|events?|holds?)|nothing\s+(?:booked|on|in\s+the\s+diary))\b|\b${DATE_FIGURES}\s*(?:[:\u2013\u2014-]\s*)?[\u2705\u2611\u2713\u2714\u274c\u2716\u2717\u2718]`, "giu"),
    // Nothing else that day, or room on it: "there are no events in the Grand Hall on the 17th",
    // "nothing clashes with the 17th", "we've got space on the 17th", "there's space in the Grand Hall on the 17th".
    new RegExp(String.raw`\bno\s+(?:other\s+|existing\s+|current\s+)?(?:bookings?|events?|functions?|weddings?|parties|reservations?|holds?)\b[^.!?\n]{0,40}?\b(?:(?:on|for)\s+${DATE_FIGURES}|(?:that|this)\s+(?:night|day|evening|date|weekend)\b)|\bnothing\s+(?:else\s+)?(?:clashes|conflicts|overlaps)\s+with\s+(?:${DATE_FIGURES}|(?:your|the|that)\s+(?:date|day|booking|event|wedding|evening)\b)`, "giu"),
    new RegExp(String.raw`\b(?:we(?:'ve|\u2019ve|\s+have)?\s+(?:still\s+)?(?:got|have)|there(?:'s|\u2019s|\s+is)(?:\s+still)?)\s+(?:some\s+|plenty\s+of\s+)?(?:space|room|a\s+(?:slot|space|gap|window|spot))\b(?:\s+(?:in|at)\s+(?:the\s+|our\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|diary|calendar|building))?\s+(?:(?:on|for)\s+${DATE_FIGURES}|(?:that|this)\s+(?:night|day|evening|weekend)\b)`, "giu"),
    // A day made to work, counted on, or answered at once: "we could definitely make the 17th work", "count on the 17th",
    // "the 17th? Free as a bird.", "you asked about the 17th. Good news: we can do it."
    new RegExp(String.raw`\b(?:we|i)\s+${MODAL}\s+(?:(?:definitely|certainly|easily|probably|absolutely|surely|still)\s+)?make\s+${DAY_FIGURES}\s+work\b|\bcount\s+on\s+(?:having\s+)?${DATE_FIGURES}(?=\s*(?:$|[.!;,)]))`, "giu"),
    new RegExp(String.raw`\b${DAY_FIGURES}\s*\?\s*(?:(?:yes|yep|good\s+news|happily|sadly|unfortunately|i'm\s+afraid|i\u2019m\s+afraid)[\s,.!:\u2014\u2013-]{0,3})?(?:it(?:'s|\u2019s|\s+is)\s+)?(?:still\s+)?(?:free|open|available|booked|taken|gone|yours|clear|fine|ok|okay)\b|\b${DATE_FIGURES}[^\n]{0,80}?\b(?:good|great)\s+news\b[^.!?\n]{0,20}?\bwe\s+(?:can|could)\s+(?:definitely\s+|certainly\s+)?do\s+(?:it|that)(?=\s*(?:$|[.!]))`, "giu"),
  ],
  capacity: [
    // A room that seats, holds or takes a number: "the Grand Hall seats 200", "it holds approx. 200 guests".
    new RegExp(String.raw`\b${ROOM}(?:\s+${MODAL}|'ll|\u2019ll|'d|\u2019d)?\s+(?:only\s+)?(?:comfortably\s+|easily\s+|happily\s+)?(?:seats?|sits?|holds?|accommodates?|fits?|takes?|hosts?|manages?|handles?|caters?(?:\s+(?:for|to))?|sleeps?|welcomes?|copes?\s+with|allows?)\s+${ABOUT}${COUNT}${NOT_TIME}${NOT_THINGS}`, "giu"),
    // "The Grand Hall can have 220 at dinner", "the Grand Hall is licensed to 250", "the Grand Hall has 220 seats",
    // "there are 220 seats in the Grand Hall", "Grand Hall: 220 seated".
    new RegExp(String.raw`\b${ROOM}\s+${MODAL}\s+(?:easily\s+|comfortably\s+)?have\s+${ABOUT}${NUM}${WHOLE}${NOT_TIME}${PEOPLE_AFTER}|\b${ROOM}(?:\s+is|'s|\u2019s)\s+(?:licensed|rated|certified|approved|permitted)\s+(?:for|to|up\s+to)\s+${ABOUT}${NUM}${WHOLE}${NOT_TIME}`, "giu"),
    new RegExp(String.raw`\b${ROOM}\s+(?:has|offers|provides|boasts)\s+${ABOUT}${NUM}${WHOLE}\s+(?:seats|places|covers)\b(?!\s+(?:at|per|to|around|on)\s+(?:each|a|every|the)\s+(?:table|round))|\bthere(?:\s+are|'re|\u2019re|\s+would\s+be|\s+will\s+be)\s+${ABOUT}${NUM}${WHOLE}\s+(?:seats|places|covers)\s+(?:in|at)\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|saloon|room|suite|venue)\b`, "giu"),
    new RegExp(String.raw`\b(?:hall|room|saloon|suite)\s*(?:[:\u2013\u2014]|\s-)\s*${ABOUT}${NUM}${WHOLE}\s+(?:seated|standing|theatre|cabaret|classroom|banquet|boardroom|reception|dining|guests|people|pax|covers|max(?:imum)?)\b`, "giu"),
    new RegExp(String.raw`\b${ROOM}\s+(?:can|could|will|would)\s+(?:easily\s+|comfortably\s+|happily\s+)?do\s+${ABOUT}${COUNT}(?=\s+(?:${PEOPLE}|for\b|at\b|on\s+rounds\b))`, "giu"),
    // A capacity given: "a capacity of 180", "capacity's 220", "180 capacity", "within capacity".
    new RegExp(String.raw`\bcapacity(?:\s+(?:of|is|for|would\s+be|will\s+be)|'s|\u2019s)\s+${ABOUT}${COUNT}`, "giu"),
    new RegExp(String.raw`\bcapacity\s+(?:in|of|for)\s+(?:the\s+)?(?:[a-z]+\s+){0,3}?(?:is|of)\s+${ABOUT}${COUNT}`, "giu"),
    new RegExp(String.raw`\b${NUM}${WHOLE}\s+capacity\b`, "giu"),
    /\b(?:within|over|at|beyond)\s+(?:the\s+|its\s+|our\s+)?capacity\b/giu,
    // People who can be seated: "200 guests can be seated", "a maximum of 200 standing".
    new RegExp(String.raw`\b${COUNT}\s+(?:guests|people|persons|covers|delegates)\s+(?:can|could|will)\s+(?:all\s+)?(?:be\s+)?(?:seated|accommodated|fit|fitted|hosted)\b`, "giu"),
    // Never the client's own count: "they expect up to 150 guests".
    new RegExp(String.raw`(?<!\b(?:expects?|expecting|expected|invites?|inviting|invited|plans?|planning|planned|brings?|bringing|anticipates?|anticipating|estimates?|estimating|hopes?\s+for|hoping\s+for|thinking\s+of|wants?|wanting|needs?|asks?\s+for|asking\s+for)\s{1,3}(?:(?:a|an|the|their|his|her)\s{1,3})?(?:(?:[a-z]+\s{1,3})?(?:party|group|wedding|event|dinner|reception|gathering|celebration|ceremony|conference)\s{1,3}of\s{1,3})?)\b(?:up\s+to|a\s+maximum\s+of|maximum\s+of|max(?:imum)?\.?|no\s+more\s+than|at\s+most)\s+${COUNT}\s+${PEOPLE}`, "giu"),
    // Room for a number: "space for 200", "seating for 200", "there's room for everyone".
    new RegExp(String.raw`\b(?:space|room|seating|seats)\s+for\s+${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    new RegExp(String.raw`(?:^|(?<=[(\u2013\u2014,:]\s{0,3})|(?<=[.!?]\s{1,3}))(?:seats|holds|takes|sleeps|seating|holding|accommodating)\s+${ABOUT}${COUNT}${NOT_TIME}(?!\s+(?:per|to\s+a|at\s+(?:each|a|every)|a\s+table|round)\b)`, "giu"),
    // Said as a summary's label: "Capacity: 200 seated", "Max: 300".
    new RegExp(String.raw`\b(?:capacity|max(?:imum)?(?:\s+capacity)?|seats|seating)\s*[:\u2013\u2014-]\s*${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    new RegExp(String.raw`\bthere(?:'s|\u2019s|\s+is|\s+would\s+be|\s+will\s+be)\s+(?:plenty\s+of\s+|ample\s+|enough\s+)?(?:room|space)\s+for\s+(?:everyone|everybody|all\s+(?:of\s+)?(?:your|the|them|you)|(?:your|the|their)\s+(?:whole\s+)?(?:${COUNT}\s+)?(?:guests|party|group|wedding\s+party|numbers|wedding\s+breakfast|dinner|reception|ceremony|event|wedding)|${ABOUT}${COUNT}${NOT_TIME}|(?:a|your|the)\s+(?:[a-z]+\s+)?(?:group|party|crowd|gathering)\b|dancing|(?:a\s+)?(?:dance\s*floor|band|top\s+table|ceilidh|buffet|stage|dj|string\s+quartet))`, "giu"),
    // That it fits: "ideal for 200", "perfect for a party of 150", "works for 120 guests", "suits your 120 guests", "big enough for everyone".
    new RegExp(String.raw`\b(?:(?:ideal|perfect|suited|suits?|right\s+size)\s+(?:for\s+)?|(?:works(?:\s+(?:well|nicely|perfectly|best))?|good|great|fine|best|comfortable|designed|built|licensed)\s+for\s+)(?:(?:your|the|their)\s+)?(?:(?:a\s+)?(?:party|parties|group|groups|wedding|dinner)\s+of\s+)?${ABOUT}${COUNT}${NOT_TIME}`, "giu"),
    // Two figures said as a room's size: "180 for dinner, 250 standing", "250 theatre / 180 banquet".
    new RegExp(String.raw`\b${COUNT}\s+(?:${PEOPLE}|reception)(?:[- ]style)?\s*(?:[,;/\u2013\u2014]|\bor\b)\s*(?:up\s+to\s+|about\s+|around\s+)?${COUNT}\s+(?:${PEOPLE}|reception)\b`, "giu"),
    // A limit said of the room: "220 is the limit for the Grand Hall", "the most we can seat in the Saloon is 90".
    new RegExp(String.raw`\b${COUNT}\s+(?:(?:guests|people|seated|standing|covers)\s+)?(?:is|would\s+be|'s|\u2019s)\s+(?:the|its|our|their)\s+(?:absolute\s+)?(?:limit|maximum|max|capacity)\b`, "giu"),
    new RegExp(String.raw`\bthe\s+(?:most|maximum|max)\b[^.!?\n]{0,40}?\b(?:can|could)\s+(?:comfortably\s+|safely\s+)?(?:seat|hold|take|fit|accommodate|host|do|manage)\b[^.!?\n]{0,30}?\b(?:is|would\s+be|'s|\u2019s)\s+${ABOUT}${COUNT}`, "giu"),
    // A room's limit or fit said with a number: "max 220", "too many for the Saloon", "70 people should be fine", "up to 18 tables".
    new RegExp(String.raw`\bmax(?:imum)?\.?\s+(?:cap(?:acity)?\.?\s+)?${COUNT}(?=\s*(?:$|[.,;:!?)\u2014\u2013]|(?:guests|people|persons|covers|pax|seated|standing|delegates|attendees)\b))`, "giu"),
    new RegExp(String.raw`\btoo\s+(?:many|few)(?:\s+(?:guests|people))?\s+for\s+(?:the\s+|that\s+|this\s+)?(?:[a-z]+\s+)?(?:hall|room|saloon|suite|space|venue|it)\b`, "giu"),
    new RegExp(String.raw`\b${COUNT}\s+(?:people|guests|pax|covers)\s+(?:(?:should|would|will|could)\s+(?:be\s+)?(?:fine|ok|okay|no\s+problem|comfortable|easy)\b|(?:won't|won\u2019t|wouldn't|wouldn\u2019t|shouldn't|shouldn\u2019t|will\s+not|would\s+not)\s+be\s+(?:a\s+|any\s+)?(?:problem|issue|squeeze|stretch)\b)|\b${COUNT}\s+(?:guests\s+|people\s+)?(?:is|are|would\s+be|will\s+be|should\s+be)\s+(?:no\s+problem|no\s+trouble|fine|ok|okay|easy|comfortable|manageable)(?:\s+at\s+all)?\s+(?:for|in)\s+(?:the|that|this|our)\s+(?:[a-z]+\s+)?(?:hall|saloon|room|suite|venue|space)\b|\b(?:seat|seats|set|sets|fit|fits|take|takes|hold|holds|lay|lays|accommodate|accommodates|room\s+for|space\s+for)\b[^.!?\n]{0,40}?\bup\s+to\s+${COUNT}\s+(?:tables|rounds)\b`, "giu"),
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
    new RegExp(String.raw`\b${ROOM}\s+(?:can|could|will|would)\s+(?:comfortably\s+|easily\s+)?(?:seat|hold|accommodate|fit|take)\s+(?:all\s+(?:of\s+)?)?(?:your|the|their)\s+(?:whole\s+|entire\s+|full\s+)?(?:${COUNT}\s+)?(?:guests|party|group|delegates|people|attendees|wedding\s+party)\b`, "giu"),
    new RegExp(String.raw`\b(?:hall|room|saloon|suite|venue)(?:'s|\u2019s)\s+(?:maximum|capacity|limit)\s+(?:of\s+|is\s+|would\s+be\s+)?${ABOUT}(?:\d|${WORD_NUM})`, "giu"),
    new RegExp(String.raw`\btoo\s+(?:small|large|big|cramped|tight)(?=\s+for\s+(?:${ABOUT}${COUNT}|your|their|everyone|everybody|all|us|you|them|dancing|a\s+dance\s*floor|a\s+band|the\s+(?:[a-z]+\s+)?(?:guests|party|group|numbers|wedding|dinner|event|reception|ceremony)|a\s+(?:[a-z]+\s+)?(?:party|group|wedding|dinner|reception|crowd|ceremony))\b|\s+to\s+(?:seat|hold|take|fit|accommodate|host)\b|\s*[.,;:!?)]|\s*$)`, "giu"),
    /\b(?:be|is|'s|\u2019s|would\s+be|will\s+be|might\s+be|could\s+be)\s+(?:a\s+bit\s+of\s+|quite\s+|rather\s+)?a\s+(?:tight\s+)?squeeze\b|\b(?:at|near|over|reach|reaches|hit|hits|to)\s+(?:its\s+|the\s+|our\s+)?maximum\s+capacity\b/giu,
    new RegExp(String.raw`\b${ROOM}(?:\s+${MODAL}|'ll|\u2019ll|'d|\u2019d)?\s+(?:easily\s+|comfortably\s+)?(?:take|takes|hold|holds|seat|seats|accommodate|accommodates|fit|fits)\s+(?:their|your|that|those)\s+numbers?\b`, "giu"),
    // Said against a limit: "over the limit for the Lower Hall", "limits the Saloon to 140", "within what the hall can manage".
    /\b(?:over|under|within|beyond|above)\s+(?:the|its|our|that|this)\s+(?:limit|capacity|maximum)\b|\b(?:within|beyond|more\s+than|over)\s+what\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|room|saloon|suite|space|venue|it)\s+(?:can|could)\s+(?:manage|take|hold|seat|accommodate|handle)\b/giu,
    new RegExp(String.raw`\blimit(?:s|ed)?\s+(?:the\s+)?(?:[a-z]+\s+)?(?:hall|room|saloon|suite|space|venue|it)\s+to\s+${ABOUT}${COUNT}`, "giu"),
    new RegExp(String.raw`\b${COUNT}\s+(?:pax|guests|people|covers)\s+(?:seated\s+|standing\s+)?(?:ok|okay|fine|fits?|no\s+problem)\b`, "giu"),
    /\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|eighteen|twenty)\s+tables\s+(?:of\s+[a-z0-9]+\s+)?(?:would|will|could|can|should)\s+(?:all\s+)?(?:sit|fit|go)\b/giu,
    new RegExp(String.raw`\b(?:up\s+to\s+)?${COUNT}\s+can\s+be\s+(?:seated|accommodated)\b`, "giu"),
    // "Up to two hundred and twenty can dine in the Grand Hall", "220 dinner guests fit in the Grand Hall",
    // "220 guests is no trouble at all", "in the Grand Hall you can have 220 guests".
    new RegExp(String.raw`\b(?:up\s+to|as\s+many\s+as|a\s+maximum\s+of|no\s+more\s+than)\s+${COUNT}\s+(?:(?:guests|people|diners|delegates)\s+)?(?:can|could|will|would)\s+(?:(?:comfortably|easily|all)\s+)?(?:dine|sit\s+down|be\s+seated|fit|eat|dance|be\s+accommodated|be\s+hosted)\b|\b${COUNT}\s+(?:[a-z]+\s+)?(?:guests|people|covers|delegates|diners)\s+(?:(?:can|could|will|would|should)\s+)?(?:(?:all|easily|comfortably)\s+)?fit\s+(?:in|into)\s+(?:the|it|there)\b`, "giu"),
    new RegExp(String.raw`\b${COUNT}\s+(?:guests|people|covers|pax)\s+(?:is|are)\s+(?:(?:absolutely|perfectly|totally)\s+)?(?:no\s+(?:trouble|problem|issue|bother)|not\s+a\s+problem|fine|easy|easily\s+done|comfortable|manageable|doable)\b(?!\s+(?:to|with)\b)`, "giu"),
    new RegExp(String.raw`\bin\s+(?:the|our)\s+(?:[a-z]+\s+){0,2}?(?:hall|saloon|room|suite)\b,?\s+you\s+(?:can|could|'ll|\u2019ll|will|would)\s+(?:(?:easily|comfortably)\s+)?(?:be\s+able\s+to\s+)?(?:have|fit|seat|host|welcome|invite|accommodate)\s+${ABOUT}${COUNT}${NOT_TIME}|\byou\s+(?:can|could|'ll|\u2019ll|will|would)\s+(?:(?:easily|comfortably)\s+)?(?:have|fit|seat|host|welcome|invite|accommodate|get)\s+${ABOUT}${COUNT}\s+(?:guests\s+|people\s+)?(?:in|into)\s+(?:the|our)\s+(?:[a-z]+\s+){0,2}?(?:hall|saloon|room|suite)\b`, "giu"),
    /\bwill\s+(?:all\s+)?fit\s+in\s+(?:the\s+)?(?:grand\s+hall|hall|room|saloon|suite|reception\s+room)\b/giu,
    new RegExp(String.raw`\badds?\s+(?:another\s+|an\s+extra\s+)?${COUNT}\s+(?:seats|covers|places)\b`, "giu"),
    /\bwithin\s+(?:the\s+)?(?:[a-z]+\s+)?(?:room|hall|saloon|suite)(?:'s|\u2019s)\s+(?:limit|capacity|maximum)\b/giu,
    // Said of the room's size against the party: "takes twice as many guests", "a party of 70 should be no problem", "we can seat up to 250".
    /\b(?:takes?|holds?|seats?|fits?)\s+(?:about\s+|roughly\s+|around\s+|nearly\s+)?(?:twice|half|three\s+times|double)\s+as\s+many\b/giu,
    new RegExp(String.raw`\b(?:party|group|wedding|dinner|numbers?)\s+of\s+${COUNT}\s+(?:should|would|will|is|are)\s+(?:be\s+)?(?:no\s+problem|fine|easy|comfortable|manageable|ok|okay)\b|\bno\s+problem\s+(?:fitting|seating|accommodating)\b`, "giu"),
    new RegExp(String.raw`\bwe\s+(?:${MODAL}\s+)?(?:(?:easily|comfortably|happily|just\s+about)\s+)?(?:seat|fit|accommodate|hold|squeeze(?:\s+in)?|fit\s+in|get\s+in|cater\s+for|welcome|take)\s+${ABOUT}${COUNT}${NOT_TIME}${PEOPLE_AFTER}`, "giu"),
    new RegExp(String.raw`\byour\s+${COUNT}\s+(?:guests\s+)?will\s+(?:be\s+)?(?:very\s+|quite\s+|perfectly\s+)?(?:comfortable|fit)\b`, "giu"),
  ],
};

/** The patterns as they read a whole draft, its ASCII letters made lower case
 *  (lowerAscii): "^" and "$" are a line's start and end, as they were when each
 *  line was read alone, and matching ignores no case, which reads six times
 *  faster than ignoring it (every pattern's letters are ASCII and lower case). */
function wholeText(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, `${pattern.flags.replace(/[im]/gu, "")}m`);
}
const WHOLE_TEXT_PATTERNS: Readonly<Record<AIDraftCommitmentKind, readonly RegExp[]>> = {
  price: PATTERNS.price.map(wholeText),
  availability: PATTERNS.availability.map(wholeText),
  capacity: PATTERNS.capacity.map(wholeText),
};

/** The text with A to Z made a to z, and nothing else changed: each character
 *  stays where it was, so a match in it is a match in the text. */
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]+/gu, (letters) => letters.toLowerCase());
}

// What the patterns read, which is not what the draft shows (red team, 29
// October 2026). In any word, not only one with a Latin letter in it, a
// letter drawn like a Latin one is that letter ("\u041e\u041a", "ava\u0131lable",
// "\u1d00\u1d20\u1d00\u026a\u029f\u1d00\u0299\u029f\u1d07", "\u043e\u0440\u0435\u0578"); "\u20a4" is "£"; markdown's emphasis and
// quotation marks are spaces and a table's bars are colons ("- **Room hire:**
// 4,500", "| 17 June | Available |", "is \u201cavailable\u201d"); a letter O in a
// figure is a nought ("4,5OO"); a space between thousands is a comma ("4 500");
// and a word broken over a line with a hyphen is whole ("avail-\nable"). Each
// is one character for one but the join, so where each character read came
// from is kept, and a claim found is the text's own words. The draft keeps its
// characters, real Cyrillic or Greek words among them: this is only what is read.
const READ_AS: Readonly<Record<string, string>> = {
  // Cyrillic
  "\u0430": "a", "\u0432": "b", "\u0433": "r", "\u0435": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h", "\u043e": "o",
  "\u043f": "n", "\u0440": "p", "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u044c": "b", "\u0455": "s",
  "\u0456": "i", "\u0458": "j", "\u0475": "v", "\u04af": "y", "\u04bb": "h", "\u04cf": "l", "\u0501": "d", "\u051b": "q",
  "\u051d": "w", "\u0405": "s", "\u0406": "i", "\u0408": "j", "\u0410": "a", "\u0412": "b", "\u0415": "e", "\u041a": "k",
  "\u041c": "m", "\u041d": "h", "\u041e": "o", "\u0420": "p", "\u0421": "c", "\u0422": "t", "\u0423": "y", "\u0425": "x",
  "\u042c": "b", "\u0474": "v", "\u04ae": "y", "\u04c0": "l", "\u0500": "d", "\u051a": "q", "\u051c": "w",
  // Greek
  "\u03b1": "a", "\u03b3": "y", "\u03b9": "i", "\u03ba": "k", "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t",
  "\u03c5": "u", "\u03c7": "x", "\u03c9": "w", "\u03f2": "c", "\u03f3": "j", "\u0391": "a", "\u0392": "b", "\u0395": "e",
  "\u0396": "z", "\u0397": "h", "\u0399": "i", "\u039a": "k", "\u039c": "m", "\u039d": "n", "\u039f": "o", "\u03a1": "p",
  "\u03a4": "t", "\u03a5": "y", "\u03a7": "x", "\u03f9": "c",
  // Armenian
  "\u0566": "q", "\u0570": "h", "\u0578": "n", "\u057d": "u", "\u0581": "g", "\u0585": "o", "\u054d": "u", "\u0555": "o",
  // Latin letters NFKC keeps: dotless and dotted i, IPA, small capitals
  "\u0130": "i", "\u0131": "i", "\u0138": "k", "\u01c0": "l", "\u0237": "j", "\u0251": "a", "\u0261": "g", "\u0262": "g",
  "\u0269": "i", "\u026a": "i", "\u0274": "n", "\u0280": "r", "\u028b": "u", "\u028f": "y", "\u0299": "b", "\u029c": "h",
  "\u029f": "l", "\u1d00": "a", "\u1d04": "c", "\u1d05": "d", "\u1d07": "e", "\u1d0a": "j", "\u1d0b": "k", "\u1d0d": "m",
  "\u1d0f": "o", "\u1d18": "p", "\u1d1b": "t", "\u1d1c": "u", "\u1d20": "v", "\u1d21": "w", "\u1d22": "z", "\ua730": "f",
  "\ua731": "s", "\ua7af": "q",
  // Signs and marks
  "\u20a4": "£", "*": " ", "`": " ", "\"": " ", "\u201c": " ", "\u201d": " ", "\u201e": " ", "\u201f": " ",
  "\u2018": " ", "\u201b": " ", "\u00ab": " ", "\u00bb": " ", "|": ":",
};
const READ_AS_ANY = new RegExp(`[${Object.keys(READ_AS).join("").replace(/[\\\]^-]/gu, "\\$&")}]`, "gu");
/** A figure with a letter O in it, its ASCII made lower case: "4,5oo". */
const FIGURE_WITH_O = /(?<![\p{L}\p{N}_])\d[\d,.]{0,12}o[\d,.o]{0,12}(?![\p{L}\p{N}_])/gu;
/** A space between thousands, as NFKC makes a thin one: "4 500" is "4,500"; "0141 552 2911" is no figure. */
const THOUSANDS_SPACE = /(?<=(?<![\d,.])\d{1,3}) (?=\d{3}(?![\d,.]?\d))/gu;
const BROKEN_WORD = /(?<=\p{L})-[ \t]*\n[ \t]*(?=\p{L})/gu;

interface PatternReading {
  /** What the patterns read: the text, one character for one, but for words joined over a line. */
  readonly text: string;
  /** Where in the text each character read came from, and one past the end; none when nothing was joined. */
  readonly from: readonly number[] | undefined;
}

function patternReading(text: string): PatternReading {
  const read = lowerAscii(text)
    .replace(READ_AS_ANY, (character) => READ_AS[character] ?? character)
    .replace(FIGURE_WITH_O, (figure) => figure.replace(/o/gu, "0"))
    .replace(THOUSANDS_SPACE, ",");
  const joins = Array.from(read.matchAll(BROKEN_WORD));
  if (joins.length === 0) return { text: read, from: undefined };
  const from: number[] = [];
  let joined = "";
  let at = 0;
  for (const join of joins) {
    joined += read.slice(at, join.index);
    for (let index = at; index < join.index; index += 1) from.push(index);
    at = join.index + join[0].length;
  }
  joined += read.slice(at);
  for (let index = at; index <= read.length; index += 1) from.push(index);
  return { text: joined, from };
}

// A sentence ends at ., ! or ? (and any closing quote or bracket) before a
// space or the end of the line. "6.30pm", "12.50", "co.uk", "approx. 150" and
// "e.g. the Saloon" do not end one. A run of stops is read once from its start,
// so a long run takes time that grows with it. A list's number ("1. ") is not
// a sentence. Read over a whole draft it ends the same sentences as over each
// line alone.
const SENTENCE_END = /(?<![.!?])(?<!\b(?:approx|e\.g|i\.e|vs|mr|mrs|ms|dr|st|incl|excl|tel|ref|cf|ca))(?<!^[ \t]*\d{1,3})[.!?]+["'\u201d\u2019)\]]*(?=\s|$)/gimu;
const SENTENCE_END_LOWER = wholeText(SENTENCE_END);

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
  /** Which of the text's sentences the claim spans, counted across its lines. */
  readonly sentences: readonly number[];
}

interface Reading {
  /** Each line's sentences; a line's sentences join back into the line. */
  readonly lines: readonly (readonly string[])[];
  /** The line, and the sentence in it, of each of the text's sentences. */
  readonly places: readonly (readonly [number, number])[];
  /** The claims, kind by kind, each with the sentences it spans. */
  readonly claims: readonly Found[];
}

/** A line that starts with a capital: a new sentence or a list's next item
 *  ("Viewings on Saturdays\nFree parking nearby"), which no claim runs into,
 *  unless the line before stops on a word that leaves its sentence open
 *  ("The 17th is\nAvailable.", "The Grand Hall seats\nTwo hundred"). */
const CAPITAL_LINE = /\n\s*[A-Z]/gu;
const OPEN_LINE_END = /(?:^|[^a-z'\u2019])(?:is|are|was|were|be|been|remains?|seems?|looks?|seats?|sits?|holds?|takes?|costs?|of|to|for|from|at|on|in|the|a|an|than|between|about|around|by|as|our|your|its|still|now|also|not|currently|definitely)[ \t]*$/u;

function runsIntoNewItem(text: string, from: number, to: number): boolean {
  for (const line of text.slice(from, to).matchAll(CAPITAL_LINE)) {
    const end = from + line.index;
    if (!OPEN_LINE_END.test(lowerAscii(text.slice(Math.max(0, end - 40), end)))) return true;
  }
  return false;
}

/** The text's lines in sentences, and its claims with the sentences they span.
 *  Each pattern and the sentence ends are read over the whole text once, so a
 *  claim broken across lines ("That date is\navailable.") is found and takes
 *  out the sentence on each. */
function read(text: string): Reading {
  const lower = lowerAscii(text);
  const stops = Array.from(lower.matchAll(SENTENCE_END_LOWER), (end) => end.index + end[0].length);
  const lines: string[][] = [];
  const starts: number[] = [];
  const places: (readonly [number, number])[] = [];
  let next = 0;
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    const sentences: string[] = [];
    let at = lineStart;
    for (; next < stops.length && (stops[next] ?? lineEnd) <= lineEnd; next += 1) {
      const stop = stops[next] ?? lineEnd;
      starts.push(at);
      places.push([lines.length, sentences.length]);
      sentences.push(text.slice(at, stop));
      at = stop;
    }
    if (at < lineEnd) {
      starts.push(at);
      places.push([lines.length, sentences.length]);
      sentences.push(text.slice(at, lineEnd));
    }
    lines.push(sentences);
    lineStart = lineEnd + 1;
  }
  const claims: Found[] = [];
  if (starts.length === 0) return { lines, places, claims };
  const reading = patternReading(text);
  const at = (index: number): number => reading.from?.[index] ?? index;
  for (const kind of AI_DRAFT_COMMITMENT_KINDS) {
    for (const pattern of WHOLE_TEXT_PATTERNS[kind]) {
      for (const match of reading.text.matchAll(pattern)) {
        const words = match[0].trim();
        if (words === "") continue;
        const start = match.index + match[0].length - match[0].trimStart().length;
        const from = at(start);
        const to = at(start + words.length - 1) + 1;
        if (runsIntoNewItem(text, from, to)) continue;
        const first = lastStartAtOrBefore(starts, from);
        const last = lastStartAtOrBefore(starts, to - 1);
        const spanned: number[] = [];
        for (let index = first; index <= last; index += 1) spanned.push(index);
        claims.push({ kind, phrase: text.slice(at(match.index), at(match.index + match[0].length - 1) + 1), sentences: spanned });
      }
    }
  }
  return { lines, places, claims };
}

/** Every price, availability or capacity claim in the text as it shows, in a fixed order of kinds. */
export function findDraftCommitments(text: string): readonly AIDraftCommitment[] {
  return read(canonicalDraftText(text)).claims.map((claim): AIDraftCommitment => ({ kind: claim.kind, phrase: claim.phrase }));
}

// An answer left on its own once the claim before it is out: "It is.", "Yes,
// it can.", "I'm pleased to say it is.", "I'm afraid not." Only the bare
// answer: "Yes, we'd love to show you round" and "It is a beautiful room" stay.
const APOS = String.raw`['\u2019]`;
const ANSWER_CORE = String.raw`(?:(?:it|that|they|we|this)\s+(?:(?:certainly|definitely|really|absolutely|still|actually|indeed)\s+)?(?:is|are|was|were|can|could|will|would|does|do|did|has|have|should)(?:n${APOS}t|\s+not)?|(?:it|that|they|we)${APOS}(?:s|re|ll|d))`;
/** A bare answer: "Not at all.", "Sadly not.", "Very much so." Never "Not yet, but soon" or "So: what next". */
const ANSWER_BARE = String.raw`(?:(?:very\s+much\s+)?so|not(?:\s+(?:at\s+all|yet|really|quite|now|any\s*more))?|cannot)\s*[.!]`;
const ANSWER_TAIL = String.raw`(?:(?:\s*,\s*|\s+)(?:not|indeed|still|now|too|comfortably|easily|happily|already|actually|though|yet|at\s+all|i${APOS}m\s+afraid|sadly|unfortunately|thankfully))*\s*(?:[.!;:\u2014\u2013)]|,\s*(?:and|but|so)\b|$)`;
const ANSWER_OPENER = String.raw`(?:yes|yeah|yep|no|nope|sure|sadly|unfortunately|happily|fortunately|luckily|thankfully|good\s+news|great\s+news|of\s+course|absolutely|certainly|indeed|definitely|correct|exactly|that${APOS}s\s+right|(?:i${APOS}m|i\s+am|we${APOS}re|we\s+are)\s+(?:pleased|happy|delighted|glad|sorry|sad)\s+to\s+(?:say|confirm|report|tell\s+you)|(?:i${APOS}m|i\s+am|we${APOS}re|we\s+are)\s+afraid)\b`;
const ANSWER = new RegExp(String.raw`^\s*["'\u201c\u2018(]?(?:(?:${ANSWER_OPENER}\s*[,!.:\u2014\u2013-]?\s*){1,2}(?:(?:that\s+)?${ANSWER_CORE}${ANSWER_TAIL}|${ANSWER_BARE}|$)|${ANSWER_CORE}${ANSWER_TAIL}|${ANSWER_BARE})`, "iu");

const DROPPED = Symbol("dropped");

/** The text with the sentences that make a claim taken out, and an answer
 *  left on its own after one, on its line or the next. Everything else is
 *  kept as written: indentation, spacing, line endings. A line left empty
 *  goes, and the blank lines either side of it become one. */
function withholdOnce(text: string, withheld: Set<AIDraftCommitmentKind>): { readonly text: string; readonly found: boolean } {
  const reading = read(text);
  if (reading.claims.length === 0) return { text, found: false };
  const outByLine = reading.lines.map(() => new Set<number>());
  for (const claim of reading.claims) {
    withheld.add(claim.kind);
    for (const sentence of claim.sentences) {
      const place = reading.places[sentence];
      if (place !== undefined) outByLine[place[0]]?.add(place[1]);
    }
  }
  let afterClaim = false;
  const lines = text.split("\n").map((line, lineIndex): string | typeof DROPPED => {
    const sentences = reading.lines[lineIndex] ?? [];
    const out = outByLine[lineIndex] ?? new Set<number>();
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
  return { text: result.join("\n"), found: true };
}

/**
 * The draft as it shows (canonicalDraftText), with every sentence that states
 * a price, availability or capacity taken out, line by line, so its
 * paragraphs and sign-off keep their shape; and the kinds taken out, in a
 * fixed order. Taking a sentence out can join what was either side of it, so
 * the text is read again until nothing more is found: what is left holds no
 * claim this check knows, and nothing is left when five readings still find one.
 */
export function withholdDraftCommitments(text: string): {
  readonly text: string;
  readonly withheld: readonly AIDraftCommitmentKind[];
} {
  const withheld = new Set<AIDraftCommitmentKind>();
  let current = canonicalDraftText(text);
  let found = true;
  for (let round = 0; round < 5 && found; round += 1) {
    const next = withholdOnce(current, withheld);
    current = next.text;
    found = next.found;
  }
  if (found && read(current).claims.length > 0) current = "";
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
