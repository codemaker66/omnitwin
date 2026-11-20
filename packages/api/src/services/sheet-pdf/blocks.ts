import {
  accessNeeds,
  allergyFacts,
  buildProtectedPremisesSummary,
  careTables,
  formatTableLabels,
  NO_BOOKING,
  NO_TIME_TO_SET,
  otherMeals,
  PLANNER_TIME_NO_BOOKING,
  readyByWords,
  setupFromWords,
  sheetClock,
  sheetNoteMarkers,
  sheetRunningOrder,
  sheetSetupSteps,
  sheetStoreList,
  sheetTimes,
  venueZoneLabel,
  type DayLine,
  type HallkeeperSheetV2,
  type ProtectedPremisesLine,
  type SetupItem,
  type SetupStep,
  type StoreGroup,
} from "@omnitwin/types";
import { paragraphUnits, type Flow, type Unit } from "./flow.js";
import { WALL_BAND, drawMarker, drawScaleBar, drawSheetPlan, planNamesLeftOff } from "./plan-drawing.js";
import {
  INK, PAGE, TYPE,
  balancedLines, blockHeight, drawBlock, drawLine, hairline, lineHeight, textWidth, upright, wrapLines,
  type Doc, type TextStyle,
} from "./style.js";

// ---------------------------------------------------------------------------
// The sheet's blocks, in the order a hallkeeper reads them (A, then D:
// docs/superpowers/specs/2026-11-06-hallkeeper-sheet-a-d-f-design.md). Page 1
// is the brief in two columns: the room, who to call, the day in order and the
// planner's words; beside them what to keep in view and what to fetch. Page 2
// opens the setup to tick: a progress rail, the steps beside a rail of what to
// keep in view, the sign-off, then Martyn's Law prompts. Each block asks the
// flow for its room.
// ---------------------------------------------------------------------------

const X = PAGE.margin;
const W = PAGE.contentWidth;

// --------------------------------------------------------------- words ----

function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

function shortDay(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
}

function longDay(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
}

function layoutWords(style: string): string {
  const words = style.replace(/[-_]/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function metres(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

/** The first line of `text` that fits `width`, with an ellipsis when cut. */
function oneLine(doc: Doc, style: TextStyle, text: string, width: number): string {
  const lines = wrapLines(doc, style, text, width);
  if (lines.length <= 1) return lines[0] ?? "";
  let cut = lines[0] ?? "";
  while (cut.length > 1 && textWidth(doc, style, `${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

// -------------------------------------------------------------- header ----

export interface CopyMarks {
  /** The paper check's QR as module rows ("0101…"), or null when none could be made. */
  readonly qr: readonly string[] | null;
  /** What the code opens, in words. */
  readonly caption: string;
  /** "v7, issued 16 Oct 14:02, printed 17 Oct 06:02" (describeSheetCopy). */
  readonly copyLine: string;
}

const QR_SIZE = 62;

function drawQr(doc: Doc, rows: readonly string[], x: number, y: number, size: number): void {
  const quiet = 2;
  const cell = size / (rows.length + quiet * 2);
  doc.save().rect(x, y, size, size).fill("#ffffff");
  for (const [r, row] of rows.entries()) {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "1") doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.02, cell + 0.02);
    }
  }
  doc.fill("#000000").restore();
}

/** "Saturday 24 October · Grand Hall · Dinner rounds", with the guest count when asked for. */
function ledeWords(sheet: HallkeeperSheetV2, withGuests: boolean): string {
  const when = sheet.timing === null ? "Date not set" : longDay(sheet.timing.eventStart, sheet.venue.timezone);
  const count = sheet.config.guestCount;
  const guests = withGuests && count > 0 ? `${String(count)} ${count === 1 ? "guest" : "guests"}` : null;
  return [when, sheet.space.name, guests, layoutWords(sheet.config.layoutStyle)].filter((part): part is string => part !== null).join(" · ");
}

/** Who approved this copy and which copy it is; before approval, that it is a draft. */
function statusOf(sheet: HallkeeperSheetV2, copyLine: string): { readonly text: string; readonly style: TextStyle } {
  return sheet.approval === null
    ? { text: `${copyLine} · not yet approved. Check with the duty manager before setting up.`, style: TYPE.statusAlert }
    : { text: `Approved by ${sheet.approval.approverName} · ${copyLine}`, style: TYPE.status };
}

export function header(flow: Flow, sheet: HallkeeperSheetV2, marks: CopyMarks): void {
  const { doc } = flow;
  const textW = W - QR_SIZE - 18;
  const top = flow.y;
  drawLine(doc, TYPE.overline, oneLine(doc, TYPE.overline, `Hallkeeper sheet · ${sheet.venue.name}`, textW), X, top);
  let y = drawBlock(doc, TYPE.title, sheet.config.name, X, top + 11, textW);
  y = drawBlock(doc, TYPE.lede, ledeWords(sheet, false), X, y + 3, textW);
  const status = statusOf(sheet, marks.copyLine);
  y = drawBlock(doc, status.style, status.text, X, y + 6, textW);
  if (marks.qr !== null) {
    y = drawBlock(doc, TYPE.small, marks.caption, X, y + 2, textW);
    drawQr(doc, marks.qr, X + W - QR_SIZE, top - 2, QR_SIZE);
  }
  flow.y = Math.max(y, top - 2 + (marks.qr === null ? 0 : QR_SIZE)) + 12;
}

// --------------------------------------------------------------- facts ----

interface Fact {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
  readonly tone: "plain" | "accent" | "alert";
  /** A name rather than a numeral. */
  readonly name?: boolean;
}

/** A time's caption, led by its day when that is not the day guests come in ("Fri 13 Nov · 13 h to set the room"). */
function onGuestsDay(iso: string, words: string, guestsIn: string | null, timeZone: string): string {
  if (guestsIn === null || shortDay(iso, timeZone) === shortDay(guestsIn, timeZone)) return words;
  return words.length === 0 ? shortDay(iso, timeZone) : `${shortDay(iso, timeZone)} · ${words}`;
}

/**
 * The header's facts (Blake, 18 November 2026: "Setup from + Ready by"):
 * when the setup window opens, when the room must be ready (the planner's
 * final time, else when guests come in, sheetTimes), when guests come in, how
 * many and where. A ready-by time after guests come in is set in brick and says
 * so; it is the planner's time and is never moved.
 */
function factsOf(sheet: HallkeeperSheetV2): Fact[] {
  const timeZone = sheet.venue.timezone;
  const timing = sheet.timing;
  const times = sheetTimes(sheet);
  const setup: Fact = times.setupFrom === null
    ? { label: "Setup from", value: "—", caption: timing === null ? "" : "No changeover time for this room", tone: timing === null ? "plain" : "alert" }
    : {
      label: "Setup from",
      value: clock(times.setupFrom, timeZone),
      caption: onGuestsDay(times.setupFrom, setupFromWords(times) ?? "", times.guestsIn, timeZone),
      tone: times.noTimeToSet ? "alert" : "plain",
    };
  const ready: Fact = times.readyBy === null
    ? { label: "Ready by", value: "—", caption: NO_BOOKING, tone: "alert" }
    : timing === null
      ? { label: "Ready by", value: clock(times.readyBy, timeZone), caption: PLANNER_TIME_NO_BOOKING, tone: "alert" }
      : {
        label: "Ready by",
        value: clock(times.readyBy, timeZone),
        caption: onGuestsDay(times.readyBy, readyByWords(times) ?? "", times.guestsIn, timeZone),
        tone: (times.readyBeforeGuestsMinutes ?? 0) < 0 ? "alert" : "accent",
      };
  return [
    setup,
    ready,
    timing === null
      ? { label: "Guests in", value: "—", caption: "Confirm the time first", tone: "plain" }
      : { label: "Guests in", value: clock(timing.eventStart, timeZone), caption: `${shortDay(timing.eventStart, timeZone)} · ${venueZoneLabel(timeZone)}`, tone: "plain" },
    { label: "Guests", value: String(sheet.config.guestCount), caption: layoutWords(sheet.config.layoutStyle), tone: "plain" },
    { label: "Room", value: sheet.space.name, caption: `${metres(sheet.space.widthM)} × ${metres(sheet.space.lengthM)} m · ${metres(sheet.space.heightM)} m high`, tone: "plain", name: true },
  ];
}

/**
 * Each fact's width in points before a sheet's own captions are measured
 * (in the sheet's own fonts, 18 Nov 2026): a time's numeral is 79 pt;
 * "6 h 30 min to set the room" 93 pt; "60 min before guests come in" 106 pt;
 * "Sat 24 Oct · UK time" 72 pt; "Dinner rounds" 50 pt; "21 × 10.5 m · 7 m high"
 * 76 pt. The room takes the rest, and its name shrinks to fit as before.
 * No one set of widths holds every caption a sheet can print on one line
 * (#454 review, measured over 2026-27: "Wed 30 Sept · UK time" 80.1 pt,
 * "Dinner banquet" 54.6, "4 h 44 min before guests come in" 119.3, in
 * two-figure hours "20 h 44 min before guests come in" 123.8, "No changeover
 * time for this room" 118.7), but a sheet prints one caption a fact, so
 * factCells lends each caption that needs it the room the others leave.
 */
const FACT_WIDTHS = [108, 126, 96, 74] as const;
/**
 * Space either side of the rule between two facts. At 8 pt (it was 10), every
 * Setup from and Ready by caption in single-figure hours keeps to one line in
 * each of the venue's rooms, beside the widest date and layout words of
 * 2026-27. In two-figure hours a caption can still part in a room whose name
 * fills its cell, and "No changeover time for this room" can part beside a
 * planner's ready-by time (#454 review, round 2, measured on the composition
 * itself).
 */
const FACT_GAP = 8;

const captionStyle = (fact: Fact): TextStyle => (fact.tone === "alert" ? TYPE.labelAlert : TYPE.label);
const numeralStyle = (fact: Fact): TextStyle => (fact.tone === "alert" ? TYPE.numeralAlert : fact.tone === "accent" ? TYPE.numeralAccent : TYPE.numeral);

/** The room's name at the largest size that fits `width`, shrinking in half points as it always has. */
function nameStyle(doc: Doc, name: string, width: number): TextStyle {
  let size: number = TYPE.factName.size;
  while (size > 11 && textWidth(doc, { ...TYPE.factName, size }, name) > width) size -= 0.5;
  return { ...TYPE.factName, size };
}

/** A fact's cell: where its rule stands, and where and how wide its words run. */
interface FactCell { readonly ruleX: number; readonly x: number; readonly width: number }

/** A caption parted after its first middle dot, where one fact ends and the next begins ("Sun 14 Jun ·", "6 h to set the room"); null without one. */
function dotParts(caption: string): readonly [string, string] | null {
  const at = caption.indexOf(" · ");
  return at <= 0 ? null : [caption.slice(0, at + 2), caption.slice(at + 3)];
}

/**
 * A caption's lines in `width`: one when it fits; else two, parted after its
 * middle dot when both parts fit; else wrapped and evened out, so no word
 * sits alone (balancedLines).
 */
function captionLines(doc: Doc, style: TextStyle, caption: string, width: number): readonly string[] {
  if (caption.length === 0) return [];
  if (textWidth(doc, style, caption) <= width) return [caption];
  const parts = dotParts(caption);
  if (parts !== null && parts.every((part) => textWidth(doc, style, part) <= width)) return parts;
  return balancedLines(doc, style, caption, width);
}

/**
 * The cells for this sheet's facts. Each starts at FACT_WIDTHS. A caption
 * wider than its cell borrows the room the other facts leave beyond their
 * own widest line (overline, numeral or name at its first size, caption),
 * the smallest shortfall first, lent in proportion to what each can spare.
 * A caption that cannot get a whole line may borrow for its two parts
 * either side of its middle dot; failing that it keeps its cell and wraps,
 * evened out. So a sheet whose captions fit keeps the widths it always had.
 */
function factCells(doc: Doc, all: readonly Fact[]): FactCell[] {
  const fixed = FACT_WIDTHS.reduce((sum, width) => sum + width, 0);
  const gaps = all.map((_, index) => (index === 0 ? FACT_GAP : FACT_GAP * 2));
  const text = all.map((_, index) => (FACT_WIDTHS[index] ?? W - fixed) - (gaps[index] ?? 0));
  const overline = (fact: Fact): number => textWidth(doc, fact.tone === "alert" ? TYPE.overlineAlert : TYPE.overline, fact.label);
  const measure = (fact: Fact, words: string): number => textWidth(doc, captionStyle(fact), words);
  // What a fact needs for its caption on one line; and what it keeps when it lends.
  const wants = all.map((fact) => Math.max(overline(fact), fact.caption.length === 0 ? 0 : measure(fact, fact.caption)));
  const keeps = all.map((fact, index) => Math.max(wants[index] ?? 0, fact.name === true
    ? textWidth(doc, nameStyle(doc, fact.value, text[index] ?? 0), fact.value)
    // A numeral is drawn a point left of its cell.
    : textWidth(doc, numeralStyle(fact), fact.value) - 1));
  const short = all.map((_, index) => index).filter((index) => (wants[index] ?? 0) > (text[index] ?? 0))
    .sort((a, b) => ((wants[a] ?? 0) - (text[a] ?? 0)) - ((wants[b] ?? 0) - (text[b] ?? 0)));
  const spare = all.map((_, index) => (short.includes(index) ? 0 : Math.max(0, (text[index] ?? 0) - (keeps[index] ?? 0))));
  /** Widens a cell to `want` from the others' spare room, when there is enough of it. */
  const borrow = (index: number, want: number): void => {
    // A hundredth of a point over, so the caption measured is the caption that fits.
    const need = want - (text[index] ?? 0) + 0.01;
    const available = spare.reduce((sum, value) => sum + value, 0);
    if (need <= 0.01 || need > available) return;
    for (const [lender, value] of spare.entries()) {
      const lent = value * need / available;
      spare[lender] = value - lent;
      text[lender] = (text[lender] ?? 0) - lent;
    }
    text[index] = (text[index] ?? 0) + need;
  };
  for (const index of short) borrow(index, wants[index] ?? 0);
  for (const index of short) {
    const fact = all[index];
    const parts = fact === undefined ? null : dotParts(fact.caption);
    if (fact === undefined || parts === null || (text[index] ?? 0) >= (wants[index] ?? 0)) continue;
    borrow(index, Math.max(...parts.map((part) => measure(fact, part))));
  }
  let ruleX = X;
  return all.map((_, index) => {
    const cell = { ruleX, x: ruleX + (index === 0 ? 0 : FACT_GAP), width: text[index] ?? 0 };
    ruleX += (text[index] ?? 0) + (gaps[index] ?? 0);
    return cell;
  });
}

export function facts(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const top = flow.y;
  const numeralTop = top + 18;
  const captionTop = numeralTop + TYPE.numeral.size + 2;
  const all = factsOf(sheet);
  const cells = factCells(doc, all);
  const captions = all.map((fact, index) => captionLines(doc, captionStyle(fact), fact.caption, cells[index]?.width ?? 0));
  const bottom = all.reduce((lowest, fact, index) => Math.max(lowest, captionTop + (captions[index]?.length ?? 0) * lineHeight(doc, captionStyle(fact), fact.caption)), captionTop);
  // The rules between the facts reach 10 pt below the captions' first line, and a line further for each more.
  const ruleEnd = Math.max(captionTop + 10, bottom + 10 - lineHeight(doc, TYPE.label));
  hairline(doc, X, top, X + W, INK.ruleStrong, 0.7);
  for (const [index, fact] of all.entries()) {
    const cell = cells[index];
    if (cell === undefined) continue;
    if (index > 0) upright(doc, cell.ruleX, top + 8, ruleEnd);
    drawLine(doc, fact.tone === "alert" ? TYPE.overlineAlert : TYPE.overline, fact.label, cell.x, top + 9);
    if (fact.name === true) {
      const style = nameStyle(doc, fact.value, cell.width);
      drawLine(doc, style, oneLine(doc, style, fact.value, cell.width), cell.x, numeralTop + (TYPE.numeral.size - style.size) * 0.86);
    } else {
      drawLine(doc, numeralStyle(fact), fact.value, cell.x - 1, numeralTop);
    }
    const style = captionStyle(fact);
    const step = lineHeight(doc, style, fact.caption);
    for (const [line, words] of (captions[index] ?? []).entries()) drawLine(doc, style, words, cell.x, captionTop + line * step);
  }
  hairline(doc, X, bottom + 8, X + W, INK.ruleStrong, 0.7);
  flow.y = bottom + 20;
}

// ------------------------------------------------- what to keep in view ----

type DayContact = NonNullable<NonNullable<HallkeeperSheetV2["instructions"]>["dayOfContact"]>;

/** One care fact: its place set apart from its words when the planner wrote "place: words". */
interface CareLine { readonly place: string | null; readonly words: string }

/** A note's sentences: a break after ".", "!" or "?" where a capital or a digit follows. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * "Table 5, seat 4: severe peanut allergy." as its place and its words. Only a
 * colon that ends a short place, a space after it, sets the place apart; a
 * clock time ("out at 21:15") or a link ("https://") keeps the sentence whole.
 */
function careLine(sentence: string): CareLine {
  const split = /^(.{1,40}?):\s+(\S.*)$/su.exec(sentence);
  const place = split?.[1]?.trim() ?? "";
  const words = split?.[2]?.trim() ?? "";
  return place.length > 0 && words.length > 0 ? { place, words } : { place: null, words: sentence };
}

interface CareFacts {
  /** The allergy notes, then the access needs: one fact a line, in the words Keep in view uses on screen. */
  readonly lines: readonly CareLine[];
  /** The meals made for allergens: "2 nut-free and 6 gluten-free meals". */
  readonly counts: string | null;
  /** "Other meals: 14 vegetarian · 4 vegan". */
  readonly meals: string | null;
  readonly contact: DayContact | null;
  /** The Martyn's Law lead on duty: "Callum Reid · Duty manager". */
  readonly onDuty: string | null;
}

function careFacts(sheet: HallkeeperSheetV2): CareFacts {
  const instructions = sheet.instructions;
  const allergies = allergyFacts(instructions?.dietary ?? null);
  const meals = otherMeals(instructions?.dietary ?? null);
  const leadName = instructions?.protectedPremises?.dutyLead?.name?.trim() ?? "";
  const leadRole = instructions?.protectedPremises?.dutyLead?.role?.trim() ?? "";
  return {
    lines: [
      ...sentences(allergies?.notes ?? "").map((sentence) => careLine(sentence)),
      ...accessNeeds(instructions?.accessibility ?? null).flatMap((need) => sentences(need)).map((sentence) => careLine(sentence)),
    ],
    counts: allergies === null || allergies.counts.length === 0 ? null : `${allergies.counts.join(" and ")} ${allergies.noun}`,
    meals: meals === null ? null : `Other meals: ${meals}`,
    contact: instructions?.dayOfContact ?? null,
    onDuty: leadName.length === 0 ? null : leadRole.length === 0 ? leadName : `${leadName} · ${leadRole}`,
  };
}

const PANEL_PAD = 11;

/** How a tinted panel looks: its wash, and the bar down its left edge, if any. */
interface PanelLook { readonly fill: string; readonly bar: string | null }
const BRICK_PANEL: PanelLook = { fill: INK.brickWash, bar: INK.alert };
const RAIL_PANEL: PanelLook = { fill: INK.rail, bar: null };

/** How far each slice's wash reaches under the next, so no seam shows where they meet. */
const SLICE_OVERLAP = 0.5;

/**
 * A slice of a tinted panel: its share of the wash and the bar, then what it
 * draws. Slices stack without gaps, so a panel can run on overleaf.
 */
function panelUnit(doc: Doc, look: PanelLook, x: number, width: number, height: number, draw: (y: number) => void, need?: number): Unit {
  return {
    height,
    ...(need === undefined ? {} : { need }),
    draw: (y) => {
      doc.save().rect(x, y, width, height + SLICE_OVERLAP).fill(look.fill).restore();
      if (look.bar !== null) doc.save().rect(x, y, 2.6, height + SLICE_OVERLAP).fill(look.bar).restore();
      draw(y);
    },
  };
}

/** Words inside a panel, one slice a line, the lines evened out; `after` is the space below the last line. */
function panelText(doc: Doc, look: PanelLook, style: TextStyle, text: string, x: number, width: number, after = 0): Unit[] {
  const height = lineHeight(doc, style, text);
  const lines = balancedLines(doc, style, text, width - PANEL_PAD * 2);
  return lines.map((line, index) => panelUnit(doc, look, x, width, height + (index === lines.length - 1 ? after : 0), (y) => {
    drawLine(doc, style, line, x + PANEL_PAD, y);
  }));
}

/** An overline inside a panel, kept with the line below it. */
function panelHeading(doc: Doc, look: PanelLook, style: TextStyle, label: string, x: number, width: number, above: number): Unit {
  const height = above + 13;
  return panelUnit(doc, look, x, width, height, (y) => { drawLine(doc, style, label, x + PANEL_PAD, y + above); }, height + 14);
}

/** The space that closes a panel. */
function panelEnd(doc: Doc, look: PanelLook, x: number, width: number): Unit {
  return panelUnit(doc, look, x, width, PANEL_PAD, () => undefined);
}

const NONE_RECORDED = "None recorded on this sheet";

/** Space below each care fact. */
const CARE_GAP = 3;

/** Keep in view's care as slices for a lane: the allergies and access needs, one fact a line, then the meals. */
function careUnits(doc: Doc, sheet: HallkeeperSheetV2, look: PanelLook, x: number, width: number): Unit[] {
  const care = careFacts(sheet);
  const units: Unit[] = [panelHeading(doc, look, TYPE.overlineAlert, "Keep in view", x, width, PANEL_PAD)];
  if (care.lines.length === 0 && care.counts === null) units.push(...panelText(doc, look, TYPE.bodyQuiet, NONE_RECORDED, x, width, 4));
  for (const line of care.lines) {
    if (line.place !== null) units.push(...panelText(doc, look, TYPE.carePlace, line.place, x, width));
    units.push(...panelText(doc, look, TYPE.careWords, line.words, x, width, CARE_GAP));
  }
  if (care.counts !== null) units.push(...panelText(doc, look, TYPE.strong, care.counts, x, width, 2));
  if (care.meals !== null) units.push(...panelText(doc, look, TYPE.bodyDim, care.meals, x, width, 2));
  return units;
}

const NO_CONTACT = "None on this sheet";

/**
 * Who to call on the day and who is on duty, as slices for the rail beside
 * the setup: the name, role and phone a crew calls. The email stays with the
 * contact on page 1.
 */
function contactUnits(doc: Doc, sheet: HallkeeperSheetV2, look: PanelLook, x: number, width: number): Unit[] {
  const care = careFacts(sheet);
  const units: Unit[] = [panelHeading(doc, look, TYPE.overline, "Call on the day", x, width, 8)];
  const contact = care.contact;
  if (contact === null) {
    units.push(...panelText(doc, look, TYPE.bodyQuiet, NO_CONTACT, x, width, 2));
  } else {
    units.push(...panelText(doc, look, TYPE.contactName, contact.name, x, width, 1));
    if (contact.role.trim().length > 0) units.push(...panelText(doc, look, TYPE.bodyDim, contact.role.trim(), x, width, 2));
    if (contact.phone.trim().length > 0) units.push(...panelText(doc, look, TYPE.phoneLarge, contact.phone.trim(), x, width, 1));
  }
  if (care.onDuty !== null) {
    units.push(panelHeading(doc, look, TYPE.overline, "On duty", x, width, 8));
    units.push(...panelText(doc, look, TYPE.body, care.onDuty, x, width));
  }
  return units;
}

type ContactLine = readonly [style: TextStyle, text: string, after: number];

/** Lines stacked in a column, top to bottom; drawn when `draw` is set. Returns their height. */
function stackLines(doc: Doc, lines: readonly ContactLine[], x: number, y: number, width: number, draw: boolean): number {
  let cursor = y;
  for (const [style, text, after] of lines) {
    cursor = (draw ? drawBlock(doc, style, text, x, cursor, width) : cursor + blockHeight(doc, style, text, width)) + after;
  }
  return cursor - y;
}

/** Page 1's people, under the room: who to call on the day beside who is on duty. */
function contactsUnit(doc: Doc, sheet: HallkeeperSheetV2, x: number, width: number): Unit {
  const contact = sheet.instructions?.dayOfContact ?? null;
  const lead = sheet.instructions?.protectedPremises?.dutyLead ?? null;
  const present = (lines: readonly ContactLine[]): ContactLine[] => lines.filter(([, text]) => text.length > 0);
  const call = contact === null ? [[TYPE.bodyQuiet, NO_CONTACT, 0] as const] : present([
    [TYPE.contactName, contact.name.trim(), 1],
    [TYPE.bodyDim, contact.role.trim(), 2],
    [TYPE.phoneLarge, contact.phone.trim(), 1],
    [TYPE.label, contact.email.trim(), 0],
  ]);
  const leadName = lead?.name?.trim() ?? "";
  // The Martyn's Law lead on duty, when one is entered.
  const duty = leadName.length === 0 ? [] : present([[TYPE.contactName, leadName, 1], [TYPE.bodyDim, lead?.role?.trim() ?? "", 0]]);
  const callW = Math.round(width * 0.62);
  const dutyX = x + callW + 14;
  const dutyW = width - callW - 14;
  const height = 14 + Math.max(stackLines(doc, call, x, 0, callW, false), stackLines(doc, duty, dutyX, 0, dutyW, false)) + 2;
  return {
    height,
    before: 14,
    draw: (y) => {
      drawLine(doc, TYPE.overline, "Call on the day", x, y);
      stackLines(doc, call, x, y + 14, callW, true);
      if (duty.length === 0) return;
      drawLine(doc, TYPE.overline, "On duty", dutyX, y);
      stackLines(doc, duty, dutyX, y + 14, dutyW, true);
    },
  };
}

// ------------------------------------------------ the day and the store ----

const TIME_W = 38;
const LATE = "After the room's ready-by time";
/** Under a line that falls after guests come in (Room ready at the planner's time, or a step before it): kept and said. */
const LATE_GUESTS = "After guests come in";
/** What a day line warns of, in brick under its title: late against the ready-by time or the doors, and no time to set the room. */
function dayWarning(line: DayLine): string | null {
  const words = [line.late ? (line.afterGuests ? LATE_GUESTS : LATE) : null, line.noTimeToSet ? NO_TIME_TO_SET : null];
  const said = words.filter((part): part is string => part !== null);
  return said.length === 0 ? null : said.join(" · ");
}
/** A warned line's time in brick, as the header and the rail set it; its weight as it would have been. */
const TIME_ALERT: TextStyle = { ...TYPE.time, color: INK.alert };
const TIME_ALERT_STRONG: TextStyle = { ...TYPE.timeAccent, color: INK.alert };
/** A day line's date and detail when they share its title's line: the title's size, so one baseline. */
const DAY_DATE_INLINE: TextStyle = { ...TYPE.dayTitle, face: "Inter-Medium", color: INK.accent };
const DAY_DETAIL_INLINE: TextStyle = { ...TYPE.dayTitle, color: INK.secondary };

/** The line's title, date and detail as runs on one line beside its time, or null when they do not fit there. */
function dayRuns(doc: Doc, line: DayLine, timeZone: string, textW: number): readonly (readonly [TextStyle, string])[] | null {
  if (dayWarning(line) !== null) return null;
  const runs: (readonly [TextStyle, string])[] = [[line.emphasis ? TYPE.dayTitleStrong : TYPE.dayTitle, line.title]];
  if (line.otherDay) runs.push([DAY_DATE_INLINE, ` · ${shortDay(line.at, timeZone)}`]);
  if (line.detail !== null) runs.push([DAY_DETAIL_INLINE, ` · ${line.detail}`]);
  return runs.reduce((sum, [style, text]) => sum + textWidth(doc, style, text), 0) <= textW ? runs : null;
}

function dayLineHeight(doc: Doc, line: DayLine, timeZone: string, width: number): number {
  const textW = width - TIME_W;
  if (dayRuns(doc, line, timeZone, textW) !== null) return Math.max(lineHeight(doc, TYPE.dayTitle), lineHeight(doc, TYPE.time)) + 4;
  let height = blockHeight(doc, line.emphasis ? TYPE.dayTitleStrong : TYPE.dayTitle, line.title, textW);
  if (line.otherDay) height += lineHeight(doc, TYPE.detailAccent);
  if (line.detail !== null) height += 0.5 + blockHeight(doc, TYPE.detail, line.detail, textW);
  const warning = dayWarning(line);
  if (warning !== null) height += 0.5 + blockHeight(doc, TYPE.detailAlert, warning, textW);
  return Math.max(height, lineHeight(doc, TYPE.time)) + 4;
}

function drawDayLine(doc: Doc, line: DayLine, timeZone: string, x: number, y: number, width: number): void {
  const textW = width - TIME_W;
  const warning = dayWarning(line);
  const timeStyle = warning === null ? (line.emphasis ? TYPE.timeAccent : TYPE.time) : line.emphasis ? TIME_ALERT_STRONG : TIME_ALERT;
  drawLine(doc, timeStyle, clock(line.at, timeZone), x, y);
  const runs = dayRuns(doc, line, timeZone, textW);
  if (runs !== null) {
    let left = x + TIME_W;
    for (const [style, text] of runs) {
      drawLine(doc, style, text, left, y);
      left += textWidth(doc, style, text);
    }
    return;
  }
  let cursor = drawBlock(doc, line.emphasis ? TYPE.dayTitleStrong : TYPE.dayTitle, line.title, x + TIME_W, y, textW);
  if (line.otherDay) cursor = drawLine(doc, TYPE.detailAccent, shortDay(line.at, timeZone), x + TIME_W, cursor);
  if (line.detail !== null) cursor = drawBlock(doc, TYPE.detail, line.detail, x + TIME_W, cursor + 0.5, textW);
  if (warning !== null) drawBlock(doc, TYPE.detailAlert, warning, x + TIME_W, cursor + 0.5, textW);
}

const QTY_W = 26;
/** Space under each store line, and above each group after the first. */
const STORE_ROW_GAP = 1.2;
const STORE_GROUP_GAP = 4;
/** A store group's name, over its lines. */
const STORE_TITLE_H = 11;

function storeRowHeight(doc: Doc, name: string, width: number): number {
  return blockHeight(doc, TYPE.itemPlain, name, width - QTY_W - 8) + STORE_ROW_GAP;
}

function drawStoreRow(doc: Doc, name: string, qty: number, x: number, y: number, width: number): number {
  drawLine(doc, TYPE.qty, String(qty), x, y - 0.6, { width: QTY_W, to: "right" });
  return drawBlock(doc, TYPE.itemPlain, name, x + QTY_W + 8, y, width - QTY_W - 8) + STORE_ROW_GAP;
}

const NO_TIMES = "No times recorded yet. Confirm them with the duty manager.";
const NOTHING_PLACED = "Nothing placed yet.";

interface BriefParts {
  readonly timeZone: string;
  readonly day: readonly DayLine[];
  readonly store: readonly StoreGroup[];
  /** The planner's two notes with words in them: [heading, text]. */
  readonly notes: readonly (readonly [string, string])[];
}

function briefParts(sheet: HallkeeperSheetV2): BriefParts {
  const notes = ([
    ["From the planner", sheet.instructions?.specialInstructions.trim() ?? ""],
    ["Access and load-in", sheet.instructions?.accessNotes.trim() ?? ""],
  ] as const).filter(([, text]) => text.length > 0);
  return { timeZone: sheet.venue.timezone, day: sheetRunningOrder(sheet), store: sheetStoreList(sheet), notes };
}

const DAY_HEADING = "The day, in order";
const STORE_HEADING = "From the store";

function dayUnits(doc: Doc, parts: BriefParts, x: number, width: number): Unit[] {
  const [firstLine] = parts.day;
  if (firstLine === undefined) {
    return [{ height: 14 + blockHeight(doc, TYPE.bodyQuiet, NO_TIMES, width), draw: (y) => {
      drawLine(doc, TYPE.overline, DAY_HEADING, x, y);
      drawBlock(doc, TYPE.bodyQuiet, NO_TIMES, x, y + 14, width);
    } }];
  }
  return [
    { height: 14, need: 14 + dayLineHeight(doc, firstLine, parts.timeZone, width), draw: (y) => { drawLine(doc, TYPE.overline, DAY_HEADING, x, y); } },
    ...parts.day.map((line): Unit => ({ height: dayLineHeight(doc, line, parts.timeZone, width), draw: (y) => { drawDayLine(doc, line, parts.timeZone, x, y, width); } })),
  ];
}

/** The planner's notes under the day: a rule, the heading, then the words line by line. */
function notesUnits(doc: Doc, parts: BriefParts, x: number, width: number): Unit[] {
  return parts.notes.flatMap(([heading, text]) => {
    const body = paragraphUnits(doc, TYPE.paragraph, text, x, width);
    const lines = body.slice(0, 2).reduce((sum, unit) => sum + unit.height, 0);
    const head: Unit = { height: 27, need: 27 + lines, draw: (y) => {
      hairline(doc, x, y + 5, x + width);
      drawLine(doc, TYPE.overline, heading, x, y + 14);
    } };
    return [head, ...body];
  });
}

function storeUnits(doc: Doc, parts: BriefParts, x: number, width: number): Unit[] {
  if (parts.store.length === 0) {
    return [{ height: 14 + lineHeight(doc, TYPE.bodyQuiet), draw: (y) => {
      drawLine(doc, TYPE.overline, STORE_HEADING, x, y);
      drawLine(doc, TYPE.bodyQuiet, NOTHING_PLACED, x, y + 14);
    } }];
  }
  return parts.store.flatMap((group, index): Unit[] => {
    const lead = index === 0 ? 14 : 0;
    const title: Unit = {
      height: lead + STORE_TITLE_H,
      need: lead + STORE_TITLE_H + storeRowHeight(doc, group.items[0]?.name ?? "", width),
      ...(index === 0 ? {} : { before: STORE_GROUP_GAP }),
      draw: (y) => {
        if (index === 0) drawLine(doc, TYPE.overline, STORE_HEADING, x, y);
        drawLine(doc, TYPE.storeGroup, group.title, x, y + lead);
      },
    };
    const rows = group.items.map((item): Unit => ({ height: storeRowHeight(doc, item.name, width), draw: (y) => { drawStoreRow(doc, item.name, item.qty, x, y, width); } }));
    return [title, ...rows];
  });
}

/** The height units take in a lane, the space above each included. */
function unitsHeight(units: readonly Unit[]): number {
  return units.reduce((sum, unit) => sum + (unit.before ?? 0) + unit.height, 0);
}

/** The units with space above the first, which a page's top drops. */
function spaced(units: readonly Unit[], before: number): Unit[] {
  const [first, ...rest] = units;
  return first === undefined ? [] : [{ ...first, before }, ...rest];
}

/** The height notesFlowing takes for the planner's notes across the page. */
function notesFlowingHeight(doc: Doc, parts: BriefParts): number {
  if (parts.notes.length === 0) return 0;
  return parts.notes.reduce((sum, [, text]) => sum + 13 + blockHeight(doc, TYPE.paragraph, text, W) + 8, 0) + 10;
}

/**
 * Where the planner's notes would stand on page 1, saying where they are
 * instead: on the page the setup opens, when that page is already known.
 */
function notesPointerUnit(doc: Doc, parts: BriefParts, x: number, width: number, page: number | null): Unit {
  const heading = parts.notes[0]?.[0] ?? "From the planner";
  const where = page === null ? "With the setup, above its steps." : `On page ${String(page)}, above the setup's steps.`;
  return {
    height: 13 + blockHeight(doc, TYPE.bodyDim, where, width),
    before: 14,
    draw: (y) => {
      drawLine(doc, TYPE.overline, heading, x, y);
      drawBlock(doc, TYPE.bodyDim, where, x, y + 13, width);
    },
  };
}

/** A column of page 1: where it stands and how tall its units run. */
interface Column { readonly x: number; readonly width: number; readonly height: number }

/**
 * Page 1's word on where the planner's notes went, in the first column that
 * still has room for it on this page, or null when neither has. It names the
 * page when both columns end on this one, since the setup then opens the next.
 */
function notesPointer(doc: Doc, parts: BriefParts, room: number, columns: readonly [Column, Column]): { readonly lane: 0 | 1; readonly unit: Unit } | null {
  const next = doc.bufferedPageRange().count + 1;
  for (const lane of [0, 1] as const) {
    const own = columns[lane];
    const other = columns[lane === 0 ? 1 : 0];
    const unit = notesPointerUnit(doc, parts, own.x, own.width, other.height <= room ? next : null);
    if (own.height + unitsHeight([unit]) <= room) return { lane, unit };
  }
  return null;
}

/**
 * Where the planner's notes still have to print once page 1 is set: nowhere
 * ("none": page 1 printed them, or there are none); after the setup's rail,
 * where page 1 says they are ("after-rail"); or leading the setup page under
 * its head, the first words after page 1, when page 1 had no room even to
 * say where they went ("leading").
 */
export type PlannerNotesLeft = "none" | "after-rail" | "leading";

/**
 * Page 1 under the facts (A), two columns that each run on by themselves:
 * the room, who to call and who is on duty, then the day in order; beside
 * them what to keep in view, then what to bring from the store. The
 * planner's notes follow the day when that keeps the page no longer, or run
 * full width below when they fit there. When this page has no room for them
 * they open the setup page instead: after its rail when a column here has
 * room to say so, else leading it. A layout with nothing placed has no setup
 * page to open, so its notes run on below the columns.
 */
export function brief(flow: Flow, sheet: HallkeeperSheetV2): PlannerNotesLeft {
  const { doc } = flow;
  const parts = briefParts(sheet);
  const leftW = Math.round(W * PLAN_SHARE);
  const gutter = 18;
  const rightX = X + leftW + gutter;
  const rightW = W - leftW - gutter;
  const left = [roomUnit(doc, sheet, X, leftW), contactsUnit(doc, sheet, X, leftW), ...spaced(dayUnits(doc, parts, X, leftW), 18)];
  const right = [...careUnits(doc, sheet, BRICK_PANEL, rightX, rightW), panelEnd(doc, BRICK_PANEL, rightX, rightW), ...spaced(storeUnits(doc, parts, rightX, rightW), 18)];
  const leftH = unitsHeight(left);
  const rightH = unitsHeight(right);
  const notes = notesUnits(doc, parts, X, leftW);
  const beside = notes.length > 0 && leftH + unitsHeight(notes) <= Math.max(rightH, flow.room);
  const fitsBelow = notes.length > 0 && !beside && Math.max(leftH, rightH) + 14 + notesFlowingHeight(doc, parts) <= flow.room;
  const deferred = notes.length > 0 && !beside && !fitsBelow && sheetSetupSteps(sheet).length > 0;
  const pointer = deferred ? notesPointer(doc, parts, flow.room, [{ x: X, width: leftW, height: leftH }, { x: rightX, width: rightW, height: rightH }]) : null;
  if (beside) left.push(...notes);
  if (pointer !== null) (pointer.lane === 0 ? left : right).push(pointer.unit);
  flow.lanes([left, right]);
  flow.y += 14;
  if (notes.length > 0 && !beside && !deferred) notesFlowing(flow, parts);
  return !deferred ? "none" : pointer !== null ? "after-rail" : "leading";
}

/**
 * The rule over a section, drawn once the section has its room, so it never
 * sits alone at the foot of a page, and never at a page's top, where the
 * page edge already separates it.
 */
function ruleAbove(flow: Flow): void {
  if (flow.y > flow.top) hairline(flow.doc, X, flow.y - 8, X + W);
}

/** The planner's notes full width, a paragraph free to cross pages; `rule` sets a rule over them unless something above already closes. */
function notesFlowing(flow: Flow, parts: BriefParts, rule = true): void {
  const { doc } = flow;
  if (parts.notes.length === 0) return;
  for (const [index, [heading, text]] of parts.notes.entries()) {
    flow.ensure(13 + lineHeight(doc, TYPE.paragraph) * Math.min(2, wrapLines(doc, TYPE.paragraph, text, W).length));
    if (index === 0 && rule) ruleAbove(flow);
    drawLine(doc, TYPE.overline, heading, X, flow.y);
    flow.y += 13;
    flow.paragraph(TYPE.paragraph, text, X, W);
    flow.y += 8;
  }
  flow.y += 10;
}

// ------------------------------------------- the room, beside care (A) ----

/** A data:image/... URL's bytes, or null. */
function diagramBytes(url: string | null): Buffer | null {
  if (url === null || !url.startsWith("data:image/")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const bytes = Buffer.from(url.slice(comma + 1), "base64");
  return bytes.length > 0 ? bytes : null;
}

const NO_PLAN = "No plan was saved with this layout. Set the room from the list.";
/** The dashed box that says so: room for its one line. */
const NO_PLAN_H = 50;
/** Page 1 gives the room this share of its width; Keep in view takes the rest. */
const PLAN_SHARE = 0.6;
const PLAN_MAX_H = 260;

/** The plan's span in metres: its outline's, or the room's own size without one. */
function planSpan(sheet: HallkeeperSheetV2): { readonly width: number; readonly length: number } {
  const plan = sheet.floorPlan ?? null;
  if (plan === null) return { width: sheet.space.widthM, length: sheet.space.lengthM };
  const xs = plan.outline.map((point) => point.x);
  const zs = plan.outline.map((point) => point.z);
  return { width: Math.max(...xs) - Math.min(...xs), length: Math.max(...zs) - Math.min(...zs) };
}

/** The height the plan takes at `width`, the band for the wall names included. */
function planHeight(sheet: HallkeeperSheetV2, width: number, max: number): number {
  const span = planSpan(sheet);
  return Math.min((width - WALL_BAND * 2) * (span.length / span.width), max) + WALL_BAND * 2;
}

/**
 * What the plan shows, in words: where it comes from and what its marks mean,
 * then any planner's name the drawing had no room for. Table numbers explain
 * themselves.
 */
function planCaption(notes: boolean, rings: boolean, leftOff: readonly string[]): string {
  return [
    "Drawn from the saved layout, looking down.",
    notes ? "Copper numbers: notes, with the setup." : null,
    rings ? "Brick rings: keep in view." : null,
    namesLeftOff(leftOff),
  ].filter((part): part is string => part !== null).join(" ");
}

/** The planner's names a plan had no room for, in words for under it, or null when it named them all. */
function namesLeftOff(leftOff: readonly string[]): string | null {
  return leftOff.length > 0 ? `No room to name on this plan: ${leftOff.join(", ")}.` : null;
}

/** The room as one unit for a lane: its heading, the plan (or the picture), the scale bar and the caption. */
function roomUnit(doc: Doc, sheet: HallkeeperSheetV2, x: number, width: number): Unit {
  const plan = sheet.floorPlan ?? null;
  // The saved plan is drawn whenever there is one (planner-qol E-X4): a
  // thumbnail is a picture taken at some earlier save and can show an older
  // layout than the one the sheet lists. The picture is used only for a
  // layout saved with no plan at all.
  const diagram = plan === null ? diagramBytes(sheet.diagramUrl) : null;
  const markers = sheetNoteMarkers(sheet);
  const ringed = careTables(sheet);
  const planH = plan !== null || diagram !== null ? planHeight(sheet, width, PLAN_MAX_H) : NO_PLAN_H;
  const leftOff = plan === null ? [] : planNamesLeftOff(doc, plan, width, planH, markers);
  const caption = plan === null ? null : planCaption(markers.size > 0, ringed.size > 0, leftOff);
  const captionW = width - 96;
  const captionH = caption === null ? 0 : Math.max(14, blockHeight(doc, TYPE.small, caption, captionW)) + 4;
  return {
    height: 14 + planH + 6 + captionH,
    draw: (y) => {
      drawLine(doc, TYPE.overline, `The room · ${sheet.space.name}`, x, y);
      const box = { x, y: y + 14, width, height: planH };
      let pictured = false;
      if (diagram !== null) {
        try {
          doc.image(diagram, box.x, box.y, { fit: [box.width, box.height], align: "center", valign: "center" });
          doc.save().rect(box.x, box.y, box.width, box.height).lineWidth(0.5).strokeColor(INK.rule).stroke().restore();
          pictured = true;
        } catch {
          pictured = false;
        }
      }
      if (!pictured && plan !== null) {
        const drawn = drawSheetPlan(doc, plan, box, markers, ringed, true);
        if (caption !== null) {
          const top = box.y + planH + 6;
          drawScaleBar(doc, drawn.pointsPerMetre, x + width, top + 6);
          drawBlock(doc, TYPE.small, caption, x, top, captionW);
        }
      }
      if (!pictured && plan === null) {
        doc.save().rect(box.x, box.y, box.width, box.height).lineWidth(0.6).dash(2, { space: 2 }).strokeColor(INK.ruleStrong).stroke().undash().restore();
        drawBlock(doc, TYPE.bodyDim, NO_PLAN, box.x + 12, box.y + (box.height - blockHeight(doc, TYPE.bodyDim, NO_PLAN, box.width - 24)) / 2, box.width - 24);
      }
    },
  };
}

// ------------------------------------------------ the setup, to tick (D) ----

const CHECK = 10.5;
/** Room the step numerals take, left of each step's name and lines. */
const STEP_INDENT = 30;
/** A line taller than this sets its notes line by line, free to run on overleaf. */
const ROW_WHOLE_MAX = 220;
/** Page 2 gives the rail beside the steps this share of its width. */
const RAIL_SHARE = 0.29;

interface RowGeometry {
  readonly left: number;
  readonly right: number;
  readonly nameX: number;
  readonly nameW: number;
  readonly whereX: number;
  readonly whereW: number;
}

/** One grid for every line of every step: tick box, count, item, place. */
function rowGeometry(x: number, width: number): RowGeometry {
  const left = x + STEP_INDENT;
  const right = x + width;
  const whereW = Math.min(150, (width - STEP_INDENT) * 0.32);
  const nameX = left + CHECK + 8 + QTY_W + 8;
  return { left, right, nameX, nameW: right - whereW - 10 - nameX, whereX: right - whereW, whereW };
}

/**
 * Where a line's pieces go: its zones, then the planner's table numbers or a
 * laid floor's size. For the chairs at the tables, how many go to which
 * tables ("110 at Tables 1–11 (10 each) · 10 at Top table"): the count at each
 * table in brackets, where no comma of a list of tables can claim it, tied to
 * the last table by no-break spaces so a wrap never parts them.
 */
function whereText(item: SetupItem): string {
  if (item.seats !== null) {
    return item.seats.map((seats) => `${String(seats.qty)} at ${seats.tables}${seats.each === null ? "" : `\u00A0(${String(seats.each)}\u00A0each)`}`).join(" · ");
  }
  const zones = item.where.map((place) => (item.where.length === 1 ? place.zone : `${place.zone} ${String(place.qty)}`)).join(" · ");
  const names = formatTableLabels(item.labels);
  return names.length === 0 ? zones : `${zones} · ${names}`;
}

/** The chairs at a table's line, where a setup short enough to sit under the brief prints them. */
function chairsText(item: SetupItem): string | null {
  if (item.chairs === null) return null;
  return item.chairs.each === null ? `${String(item.chairs.total)} chairs in all` : `${String(item.chairs.each)} chairs each`;
}

const CHAIRS_STYLE: TextStyle = { face: "Inter-Regular", size: 8.4, color: INK.quiet };

/** The name's lines, and whether the chair count fits after the last one. */
function nameLayout(doc: Doc, item: SetupItem, nameW: number): { lines: readonly string[]; chairsInline: boolean } {
  const style = item.accessory ? TYPE.itemPlain : TYPE.item;
  const lines = wrapLines(doc, style, item.name, nameW);
  const chairs = chairsText(item);
  const last = lines[lines.length - 1] ?? "";
  return { lines, chairsInline: chairs === null || textWidth(doc, style, last) + 8 + textWidth(doc, CHAIRS_STYLE, chairs) <= nameW };
}

/** A line's height: its item column (name, chairs, notes) or its place column, whichever runs longer. */
function setupRowHeight(doc: Doc, item: SetupItem, geometry: RowGeometry, markers: ReadonlyMap<string, number>): number {
  const style = item.accessory ? TYPE.itemPlain : TYPE.item;
  const { lines, chairsInline } = nameLayout(doc, item, geometry.nameW);
  let itemH = lines.length * lineHeight(doc, style) + (chairsInline ? 0 : lineHeight(doc, CHAIRS_STYLE));
  for (const note of item.notes) itemH += 1.5 + blockHeight(doc, TYPE.note, note, geometry.nameW - (markers.has(note) ? 12 : 0));
  const whereH = 1.2 + blockHeight(doc, TYPE.where, whereText(item), geometry.whereW);
  return Math.max(itemH, whereH, CHECK) + 8;
}

function sortedNotes(item: SetupItem, markers: ReadonlyMap<string, number>): string[] {
  return [...item.notes].sort((a, b) => (markers.get(a) ?? Infinity) - (markers.get(b) ?? Infinity));
}

function drawSetupRow(doc: Doc, item: SetupItem, y: number, geometry: RowGeometry, markers: ReadonlyMap<string, number>): void {
  const style = item.accessory ? TYPE.itemPlain : TYPE.item;
  doc.save().roundedRect(geometry.left, y + 0.5, CHECK, CHECK, 1.2).lineWidth(0.8).strokeColor(INK.secondary).stroke().restore();
  drawLine(doc, TYPE.qty, String(item.qty), geometry.left + CHECK + 8, y - 0.2, { width: QTY_W, to: "right" });
  const { lines, chairsInline } = nameLayout(doc, item, geometry.nameW);
  let cursor = y;
  for (const line of lines) cursor = drawLine(doc, style, line, geometry.nameX, cursor);
  const chairs = chairsText(item);
  if (chairs !== null) {
    if (chairsInline) drawLine(doc, CHAIRS_STYLE, chairs, geometry.nameX + textWidth(doc, style, lines[lines.length - 1] ?? "") + 8, cursor - lineHeight(doc, style) + 1.2);
    else cursor = drawLine(doc, CHAIRS_STYLE, chairs, geometry.nameX, cursor);
  }
  drawBlock(doc, TYPE.where, whereText(item), geometry.whereX, y + 1.2, geometry.whereW);
  for (const note of sortedNotes(item, markers)) {
    const number = markers.get(note);
    if (number !== undefined) drawMarker(doc, number, geometry.nameX + 4.2, cursor + 7.5, 4.2);
    cursor = drawBlock(doc, TYPE.note, note, geometry.nameX + (number === undefined ? 0 : 12), cursor + 1.5, geometry.nameW - (number === undefined ? 0 : 12));
  }
}

/** One note under its line, a unit a printed line, its number on the first. */
function noteLineUnits(doc: Doc, note: string, number: number | undefined, geometry: RowGeometry): Unit[] {
  const indent = number === undefined ? 0 : 12;
  const height = lineHeight(doc, TYPE.note);
  const lines = wrapLines(doc, TYPE.note, note, geometry.nameW - indent);
  return lines.map((line, index): Unit => ({
    height: height + (index === 0 ? 1.5 : 0),
    draw: (y) => {
      const top = y + (index === 0 ? 1.5 : 0);
      if (index === 0 && number !== undefined) drawMarker(doc, number, geometry.nameX + 4.2, top + 6, 4.2);
      drawLine(doc, TYPE.note, line, geometry.nameX + indent, top);
    },
  }));
}

/** A setup line as units: whole when it fits, else the line, then its notes line by line. */
function rowUnits(doc: Doc, item: SetupItem, geometry: RowGeometry, markers: ReadonlyMap<string, number>): Unit[] {
  const rule = (bottom: number): void => { hairline(doc, geometry.nameX, bottom - 3.5, geometry.right, INK.rule, 0.4); };
  const height = setupRowHeight(doc, item, geometry, markers);
  if (height <= ROW_WHOLE_MAX) {
    return [{ height, draw: (y) => { drawSetupRow(doc, item, y, geometry, markers); rule(y + height); } }];
  }
  const bare: SetupItem = { ...item, notes: [] };
  const head = setupRowHeight(doc, bare, geometry, markers) - 8;
  return [
    { height: head, need: head + lineHeight(doc, TYPE.note) * 2, draw: (y) => { drawSetupRow(doc, bare, y, geometry, markers); } },
    ...sortedNotes(item, markers).flatMap((note) => noteLineUnits(doc, note, markers.get(note), geometry)),
    { height: 8, draw: (y) => { rule(y + 8); } },
  ];
}

const STEP_LATE = "after the room's ready-by time";
/** A step due after the doors, though not after a planner's ready-by time later still: the day's reading, as Room ready's. */
const STEP_AFTER_GUESTS = "after guests come in";

function deadlineWords(deadline: NonNullable<SetupStep["deadline"]>, timeZone: string): string {
  return `by ${deadline.otherDay ? `${shortDay(deadline.at, timeZone)} ` : ""}${clock(deadline.at, timeZone)}`;
}

/** A step's head: its numeral alone in the margin, its name, its deadline in copper, the reason beneath. */
function stepHeadUnit(doc: Doc, step: SetupStep, index: number, timeZone: string, x: number, width: number, keep: number): Unit {
  const late = step.deadline?.late === true ? (step.deadline.afterGuests ? STEP_AFTER_GUESTS : STEP_LATE) : null;
  const reason = [step.deadline?.reason ?? null, late].filter((part): part is string => part !== null).join(" · ");
  const deadline = step.deadline === null ? null : deadlineWords(step.deadline, timeZone);
  const deadlineStyle = step.deadline?.late === true ? TYPE.stepDeadlineAlert : TYPE.stepDeadline;
  const reasonW = width - STEP_INDENT;
  const reasonH = reason.length === 0 ? 0 : blockHeight(doc, TYPE.stepReason, reason, reasonW) + 2;
  const height = 22 + reasonH + 9;
  return {
    height,
    need: height + keep,
    draw: (y) => {
      drawLine(doc, TYPE.stepNumeral, String(index + 1), x, y - 7);
      const deadlineW = deadline === null ? 0 : textWidth(doc, deadlineStyle, deadline) + 12;
      drawLine(doc, TYPE.stepName, oneLine(doc, TYPE.stepName, step.label, width - STEP_INDENT - deadlineW), x + STEP_INDENT, y);
      if (deadline !== null) drawLine(doc, deadlineStyle, deadline, x, y + 1.5, { width, to: "right" });
      if (reason.length > 0) drawBlock(doc, TYPE.stepReason, reason, x + STEP_INDENT, y + 21, reasonW);
      hairline(doc, x + STEP_INDENT, y + height - 4, x + width, INK.ruleStrong, 0.6);
    },
  };
}

const PLAN_NOTES_HEADING = "Notes on the plan";

/**
 * The plan's numbered notes that no setup line carries, so every number on
 * the plan can still be looked up. The manifest normally carries each one
 * under its item; this keeps a note whose piece it lost.
 */
function planNoteUnits(doc: Doc, steps: readonly SetupStep[], markers: ReadonlyMap<string, number>, geometry: RowGeometry): Unit[] {
  const printed = new Set(steps.flatMap((step) => step.items.flatMap((item) => item.notes)));
  const loose = [...markers].filter(([note]) => !printed.has(note)).sort((a, b) => a[1] - b[1]);
  if (loose.length === 0) return [];
  const heading: Unit = { height: 16, need: 16 + lineHeight(doc, TYPE.note) * 2, draw: (y) => { drawLine(doc, TYPE.overline, PLAN_NOTES_HEADING, geometry.nameX, y + 2); } };
  return [heading, ...loose.flatMap(([note, number]) => [...noteLineUnits(doc, note, number, geometry), { height: 4, draw: () => undefined }])];
}

/**
 * The setup's steps as units. On the setup's own page the chairs at a step's
 * tables have a line of their own after those tables (study D), and the
 * tables' lines leave the chairs to it. A setup short enough to sit under the
 * brief on page 1 (`compact`, given the steps without the chairs line) keeps
 * each table's chairs on its own line instead, so a short sheet stays one
 * page; the seated chairs' notes then go to the next line that carries them,
 * or among the plan's notes after the steps.
 */
function stepUnits(doc: Doc, sheet: HallkeeperSheetV2, setup: readonly SetupStep[], x: number, width: number, compact = false): Unit[] {
  const markers = sheetNoteMarkers(sheet);
  const geometry = rowGeometry(x, width);
  const steps = setup.map((step) => ({ ...step, items: step.items.flatMap((item): SetupItem[] => {
    if (compact) return item.seats === null ? [item] : [];
    return [item.seats === null ? { ...item, chairs: null } : item];
  }) }));
  return [
    ...steps.flatMap((step, index): Unit[] => {
      const rows = step.items.flatMap((item) => rowUnits(doc, item, geometry, markers));
      // A step starts where its head and its first three lines (or all, if fewer) fit.
      const keep = rows.slice(0, 3).reduce((sum, unit) => sum + unit.height, 0);
      return [stepHeadUnit(doc, step, index, sheet.venue.timezone, x, width, keep), ...rows, { height: 12, draw: () => undefined }];
    }),
    ...planNoteUnits(doc, steps, markers, geometry),
  ];
}

/**
 * A ring on the setup's rail: its mark, its name, its time, and the word under
 * that time when it falls after the one it must precede: "late" for a step
 * after the room's ready-by time; "after doors" for Room ready after guests
 * come in, and for a step between the doors and that later ready-by time.
 */
interface Station { readonly kind: "step" | "ready" | "guests"; readonly mark: string; readonly label: string; readonly time: string; readonly flag: "late" | "after doors" | null }

function railStations(sheet: HallkeeperSheetV2, steps: readonly SetupStep[]): Station[] {
  const timeZone = sheet.venue.timezone;
  const times = sheetTimes(sheet);
  const afterDoors = (times.readyBeforeGuestsMinutes ?? 0) < 0;
  // Room ready is the sheet's ready-by time (sheetTimes), never setup's start.
  const ready: Station = { kind: "ready", mark: "", label: "Room ready", time: times.readyBy === null ? "—" : sheetClock(times.readyBy, times.guestsIn, timeZone), flag: afterDoors ? "after doors" : null };
  const guests: Station = { kind: "guests", mark: "", label: "Guests in", time: times.guestsIn === null ? "—" : clock(times.guestsIn, timeZone), flag: null };
  return [
    ...steps.map((step, index): Station => ({
      kind: "step", mark: String(index + 1), label: step.label,
      time: step.deadline === null ? "" : sheetClock(step.deadline.at, times.guestsIn, timeZone),
      flag: step.deadline?.late === true ? (step.deadline.afterGuests ? "after doors" : "late") : null,
    })),
    // The two stand in time order: Room ready leads at the same minute or
    // before, and follows Guests in when the planner's time is after the doors.
    ...(afterDoors ? [guests, ready] : [ready, guests]),
  ];
}

/** A time after the one it must precede: brick on the rail, and under it the words, which a mono print keeps. */
const RAIL_TIME_LATE: TextStyle = { ...TYPE.railTime, color: INK.alert };
const RAIL_LATE: TextStyle = { ...TYPE.railLabel, face: "Inter-SemiBold", color: INK.alert };

const RAIL_H = 80;
/** The line "late" or "after doors" takes under the times, whole however long the time beside it ("Sun 08:00"). */
const RAIL_LATE_H = 13;

/** How tall the rail stands: a line more when any time on it carries a word. */
function railHeight(sheet: HallkeeperSheetV2, steps: readonly SetupStep[]): number {
  return RAIL_H + (railStations(sheet, steps).some((station) => station.flag !== null) ? RAIL_LATE_H : 0);
}

/** The setup at a glance: a ring per step, then the room ready and the guests in. The rings are empty; nothing is done when the sheet prints. */
function progressRail(flow: Flow, sheet: HallkeeperSheetV2, steps: readonly SetupStep[]): void {
  const { doc } = flow;
  const top = flow.y;
  drawLine(doc, TYPE.overline, "Setup, in order", X, top);
  drawLine(doc, TYPE.label, "Tick each line as it is done.", X, top - 0.6, { width: W, to: "right" });
  const stations = railStations(sheet, steps);
  const span = W / stations.length;
  const lineY = top + 30;
  hairline(doc, X + span / 2, lineY, X + W - span / 2, INK.ruleStrong, 0.8);
  for (const [index, station] of stations.entries()) {
    const cx = X + span * (index + 0.5);
    const radius = station.kind === "ready" ? 12.5 : 10;
    const stroke = station.kind === "ready" ? INK.accent : station.kind === "guests" ? INK.ruleStrong : INK.secondary;
    doc.save().circle(cx, lineY, radius).lineWidth(station.kind === "ready" ? 1.6 : 0.9).fillAndStroke(INK.panel, stroke).restore();
    if (station.mark.length > 0) drawLine(doc, TYPE.railMark, station.mark, cx - span / 2, lineY - 6.2, { width: span, to: "center" });
    const labelStyle = station.kind === "ready" ? TYPE.railLabelAccent : TYPE.railLabel;
    drawLine(doc, labelStyle, oneLine(doc, labelStyle, station.label, span - 6), cx - span / 2, lineY + 17, { width: span, to: "center" });
    if (station.time.length > 0) {
      const style = station.flag !== null ? RAIL_TIME_LATE : station.kind === "guests" ? TYPE.railTimeQuiet : TYPE.railTime;
      drawLine(doc, style, oneLine(doc, style, station.time, span - 4), cx - span / 2, lineY + 29, { width: span, to: "center" });
      if (station.flag !== null) drawLine(doc, RAIL_LATE, station.flag, cx - span / 2, lineY + 43, { width: span, to: "center" });
    }
  }
  const height = railHeight(sheet, steps);
  hairline(doc, X, top + height - 8, X + W, INK.rule, 0.5);
  flow.y = top + height;
}

/**
 * The small plan at the foot of the rail, for the crew handed the setup page
 * alone: the room with the care tables ringed and the planner's names set as
 * page 1 sets them, on a piece or beside it, and any it has no room for named
 * under it.
 */
function railPlanUnit(doc: Doc, sheet: HallkeeperSheetV2, x: number, width: number): Unit | null {
  const plan = sheet.floorPlan ?? null;
  if (plan === null) return null;
  const inner = width - PANEL_PAD * 2;
  const height = planHeight(sheet, inner, 200);
  const markers = new Map<string, number>();
  const caption = namesLeftOff(planNamesLeftOff(doc, plan, inner, height, markers));
  const captionH = caption === null ? 0 : blockHeight(doc, TYPE.small, caption, inner) + 4;
  return panelUnit(doc, RAIL_PANEL, x, width, height + 10 + captionH, (y) => {
    drawSheetPlan(doc, plan, { x: x + PANEL_PAD, y: y + 6, width: inner, height }, markers, careTables(sheet), true);
    if (caption !== null) drawBlock(doc, TYPE.small, caption, x + PANEL_PAD, y + 10 + height, inner);
  });
}

/** A brief that ran on overleaf and filled less than this share of that page leaves the rest to the setup. */
const SPILL_SHARE = 0.4;

/**
 * The head of the setup's own page, for the crew handed it alone: which
 * event, when, where and for how many, and whether this copy is approved.
 * Page 1 keeps the paper check's code; every page's footer names the copy.
 */
function setupHeader(flow: Flow, sheet: HallkeeperSheetV2, copyLine: string): void {
  const { doc } = flow;
  const top = flow.y;
  drawLine(doc, TYPE.overline, oneLine(doc, TYPE.overline, `Hallkeeper sheet · ${sheet.venue.name}`, W), X, top);
  let y = drawBlock(doc, TYPE.runningTitle, sheet.config.name, X, top + 11, W);
  y = drawBlock(doc, TYPE.lede, ledeWords(sheet, true), X, y + 2, W);
  const status = statusOf(sheet, copyLine);
  y = drawBlock(doc, status.style, status.text, X, y + 4, W);
  hairline(doc, X, y + 8, X + W, INK.ruleStrong, 0.7);
  flow.y = y + 20;
}

/**
 * Page 2 (D): the setup to tick. A setup that fits whole under the brief on
 * page 1 stays there, its steps full width, Keep in view already in sight.
 * Otherwise it opens a page, so the crew can be handed the setup alone: its
 * head, the progress rail, then the steps beside a rail of what to keep in
 * view, who to call and the small plan. The planner's notes page 1 had no
 * room for come after the rail where page 1 points to them, or first, under
 * the head, when page 1 could not point. When the brief itself ran on
 * overleaf and left most of that page empty, the setup starts there instead
 * of a page later. A layout with nothing placed says so where it stands.
 */
export function setupPage(flow: Flow, sheet: HallkeeperSheetV2, copyLine: string, plannerNotes: PlannerNotesLeft = "none"): void {
  const { doc } = flow;
  const steps = sheetSetupSteps(sheet);
  if (steps.length === 0) {
    if (plannerNotes !== "none") notesFlowing(flow, briefParts(sheet));
    flow.ensure(40);
    ruleAbove(flow);
    drawLine(doc, TYPE.overline, "Setup, in order", X, flow.y);
    drawLine(doc, TYPE.bodyQuiet, "Nothing is placed in this layout yet.", X, flow.y + 14);
    flow.y += 40;
    // The plan's numbers still need their words when no line carries them.
    const loose = planNoteUnits(doc, [], sheetNoteMarkers(sheet), { left: X, right: X + W, nameX: X, nameW: W, whereX: X + W, whereW: 0 });
    if (loose.length > 0) {
      flow.lanes([loose]);
      flow.y += 12;
    }
    return;
  }
  // Under the brief there is no chairs line, so it claims none of its chairs' notes (sheetSetupSteps).
  const whole = stepUnits(doc, sheet, sheetSetupSteps(sheet, { chairsLine: false }), X, W, true);
  if (plannerNotes === "none" && doc.bufferedPageRange().count === 1 && flow.y + railHeight(sheet, steps) + unitsHeight(whole) <= flow.bottom) {
    ruleAbove(flow);
    progressRail(flow, sheet, steps);
    flow.lanes([whole]);
    flow.y += 12;
    return;
  }
  const spilled = doc.bufferedPageRange().count > 1 && flow.y - flow.top <= flow.pageRoom * SPILL_SHARE;
  if (spilled) {
    ruleAbove(flow);
  } else {
    if (flow.y > flow.top) flow.newPage();
    setupHeader(flow, sheet, copyLine);
  }
  const railW = Math.round(W * RAIL_SHARE);
  const gutter = 16;
  const stepsW = W - railW - gutter;
  const railX = X + stepsW + gutter;
  const stepsLane = stepUnits(doc, sheet, steps, X, stepsW);
  if (plannerNotes === "leading") {
    // Page 1 had no room to say where the planner's notes went, so they come
    // first here, under the head; the rail then keeps with the first step.
    notesFlowing(flow, briefParts(sheet), false);
    flow.ensure(railHeight(sheet, steps) + (stepsLane[0]?.need ?? stepsLane[0]?.height ?? 0));
    ruleAbove(flow);
  }
  progressRail(flow, sheet, steps);
  // The planner's notes page 1 pointed to: across the page, before the first step.
  if (plannerNotes === "after-rail") notesFlowing(flow, briefParts(sheet));
  const railPlan = railPlanUnit(doc, sheet, railX, railW);
  flow.lanes([
    stepsLane,
    [
      ...careUnits(doc, sheet, RAIL_PANEL, railX, railW),
      ...contactUnits(doc, sheet, RAIL_PANEL, railX, railW),
      ...(railPlan === null ? [] : [railPlan]),
      panelEnd(doc, RAIL_PANEL, railX, railW),
    ],
  ]);
  flow.y += 12;
}

// ------------------------------------------------------------- sign off ----

const FIRE_LINE = "Fire exits must remain unobstructed at all times. Maximum occupancy must be observed per venue licence. Report any safety concerns to the duty manager immediately.";

export function signOff(flow: Flow): void {
  const { doc } = flow;
  flow.ensure(64);
  flow.y += 4;
  drawLine(doc, TYPE.overline, "Sign off", X, flow.y);
  const line = flow.y + 28;
  const half = (W - 28) / 2;
  const rule = (label: string, from: number, to: number): void => {
    drawLine(doc, TYPE.label, label, from, line - 9);
    hairline(doc, from + textWidth(doc, TYPE.label, label) + 6, line, to, INK.edge, 0.6);
  };
  for (const [label, x] of [["Room set by", X], ["Checked by", X + half + 28]] as const) {
    rule(label, x, x + half * 0.7);
    rule("at", x + half * 0.74, x + half);
  }
  flow.y = drawBlock(doc, TYPE.small, FIRE_LINE, X, line + 10, W) + 18;
}

// --------------------------------------------------------- Martyn's Law ----

const NOTHING_RECORDED = "Nothing recorded for this event: responsible person, lead on duty, team briefing, door supervision and the four procedures are not set.";
const MARTYNS_LABEL_W = 92;
const MARTYNS_VALUE: TextStyle = { face: "Inter-SemiBold", size: 8.4, color: INK.primary, lineGap: 1 };
const MARTYNS_UNSET: TextStyle = { face: "Inter-Regular", size: 8.4, color: INK.quiet, lineGap: 1 };
const MARTYNS_NOTE: TextStyle = { ...TYPE.note, size: 8.2 };

/** Lays the block out from `y`, drawing only when asked; returns its bottom. */
function martynsLayout(doc: Doc, sheet: HallkeeperSheetV2, y: number, draw: boolean): number {
  const summary = buildProtectedPremisesSummary(sheet.instructions?.protectedPremises, { guestCount: sheet.config.guestCount, timeZone: sheet.venue.timezone });
  const all = [...summary.people, ...summary.arrangements, ...summary.procedures];
  const line = (style: TextStyle, text: string, x: number, at: number, width: number): number =>
    draw ? drawBlock(doc, style, text, x, at, width) : at + blockHeight(doc, style, text, width);
  if (draw) drawLine(doc, TYPE.overline, `${summary.heading} · prompts only`, X, y);
  let cursor = y + 13;
  if (!all.some((item) => item.entered)) {
    cursor = line(TYPE.bodyDim, NOTHING_RECORDED, X, cursor, W);
  } else {
    cursor = line(TYPE.bodyDim, summary.intro, X, cursor, W) + 4;
    const columnW = (W - 18) / 2;
    const entry = (item: ProtectedPremisesLine, x: number, at: number): number => {
      if (draw) drawBlock(doc, { ...TYPE.label, size: 7.8 }, item.label, x, at + 0.6, MARTYNS_LABEL_W - 6);
      let bottom = line(item.entered ? MARTYNS_VALUE : MARTYNS_UNSET, item.value, x + MARTYNS_LABEL_W, at, columnW - MARTYNS_LABEL_W);
      if (item.note !== null) bottom = line(MARTYNS_NOTE, item.note, x + MARTYNS_LABEL_W, bottom + 0.5, columnW - MARTYNS_LABEL_W);
      return bottom + 3;
    };
    const rightX = X + columnW + 18;
    if (draw) drawLine(doc, { ...TYPE.overline, size: 6.2 }, "Staff briefed on", rightX + MARTYNS_LABEL_W, cursor);
    cursor += 11;
    let left = cursor;
    for (const item of [...summary.people, ...summary.arrangements.filter((item) => item.key !== "notes")]) left = entry(item, X, left);
    let right = cursor;
    for (const item of summary.procedures) right = entry(item, rightX, right);
    cursor = Math.max(left, right);
    const notes = summary.arrangements.find((item) => item.key === "notes");
    if (notes !== undefined) cursor = entry(notes, X, cursor);
  }
  return line(TYPE.small, [summary.guestLine, ...summary.context].join(" "), X, cursor + 4, W);
}

export function martynsLaw(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const height = martynsLayout(doc, sheet, 0, false) + 8;
  if (height > flow.pageRoom) { martynsFlowing(flow, sheet); return; }
  flow.ensure(height);
  ruleAbove(flow);
  flow.y = martynsLayout(doc, sheet, flow.y, true) + 10;
}

/**
 * Martyn's Law when what was entered runs longer than a page: one column,
 * label beside value, every value and note free to cross pages line by line.
 */
function martynsFlowing(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const summary = buildProtectedPremisesSummary(sheet.instructions?.protectedPremises, { guestCount: sheet.config.guestCount, timeZone: sheet.venue.timezone });
  const valueX = X + MARTYNS_LABEL_W;
  const valueW = W - MARTYNS_LABEL_W;
  flow.ensure(13 + lineHeight(doc, TYPE.bodyDim) * 2);
  ruleAbove(flow);
  drawLine(doc, TYPE.overline, `${summary.heading} · prompts only`, X, flow.y);
  flow.y += 13;
  flow.paragraph(TYPE.bodyDim, summary.intro, X, W);
  flow.y += 4;
  const entry = (item: ProtectedPremisesLine): void => {
    const style = item.entered ? MARTYNS_VALUE : MARTYNS_UNSET;
    flow.ensure(lineHeight(doc, style) * 2);
    drawBlock(doc, { ...TYPE.label, size: 7.8 }, item.label, X, flow.y + 0.6, MARTYNS_LABEL_W - 6);
    flow.paragraph(style, item.value, valueX, valueW);
    if (item.note !== null) { flow.y += 0.5; flow.paragraph(MARTYNS_NOTE, item.note, valueX, valueW); }
    flow.y += 3;
  };
  for (const item of [...summary.people, ...summary.arrangements.filter((item) => item.key !== "notes")]) entry(item);
  flow.ensure(11 + lineHeight(doc, MARTYNS_VALUE) * 2);
  flow.y += 4;
  drawLine(doc, { ...TYPE.overline, size: 6.2 }, "Staff briefed on", valueX, flow.y);
  flow.y += 11;
  for (const item of summary.procedures) entry(item);
  const notes = summary.arrangements.find((item) => item.key === "notes");
  if (notes !== undefined) { flow.y += 4; entry(notes); }
  flow.y += 4;
  flow.paragraph(TYPE.small, [summary.guestLine, ...summary.context].join(" "), X, W);
  flow.y += 10;
}

// ------------------------------------------------------------- footers ----

/** Every page: which event and room, which copy, which page. */
export function footers(doc: Doc, sheet: HallkeeperSheetV2, copyLine: string): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const when = sheet.timing === null ? "" : ` · ${shortDay(sheet.timing.eventStart, sheet.venue.timezone)}`;
  for (let index = range.start; index < range.start + total; index++) {
    doc.switchToPage(index);
    const y = PAGE.footerTop;
    hairline(doc, X, y - 7, X + W, INK.rule, 0.5);
    const page = `Page ${String(index - range.start + 1)} of ${String(total)}`;
    const pageW = textWidth(doc, TYPE.footerStrong, page);
    drawLine(doc, TYPE.footerStrong, page, X + W - pageW, y);
    const copyW = textWidth(doc, TYPE.footerStrong, copyLine);
    drawLine(doc, TYPE.footerStrong, copyLine, X + W - pageW - 14 - copyW, y);
    drawLine(doc, TYPE.footer, oneLine(doc, TYPE.footer, `${sheet.config.name} · ${sheet.space.name}${when}`, W - pageW - copyW - 40), X, y);
  }
}
