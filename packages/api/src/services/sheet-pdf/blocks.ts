import {
  accessNeeds,
  allergyFacts,
  buildProtectedPremisesSummary,
  otherMeals,
  sheetNoteMarkers,
  sheetRunningOrder,
  sheetSetupSteps,
  sheetStoreList,
  venueZoneLabel,
  type DayLine,
  type HallkeeperSheetV2,
  type ProtectedPremisesLine,
  type SetupItem,
  type StoreGroup,
} from "@omnitwin/types";
import { paragraphUnits, type Flow, type Unit } from "./flow.js";
import { WALL_BAND, drawMarker, drawScaleBar, drawSheetPlan } from "./plan-drawing.js";
import {
  INK, PAGE, TYPE,
  blockHeight, drawBlock, drawLine, hairline, lineHeight, textWidth, upright, wrapLines,
  type Doc, type TextStyle,
} from "./style.js";

// ---------------------------------------------------------------------------
// The sheet's blocks, in the order a hallkeeper reads them: the brief (who,
// when, what to keep in view, the day in order, what to fetch, the planner's
// words), then the room (the plan, the setup step by step, the sign-off),
// then Martyn's Law prompts. Each block asks the flow for its room first.
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

export function header(flow: Flow, sheet: HallkeeperSheetV2, marks: CopyMarks): void {
  const { doc } = flow;
  const textW = W - QR_SIZE - 18;
  const top = flow.y;
  const timeZone = sheet.venue.timezone;
  drawLine(doc, TYPE.overline, `Hallkeeper sheet · ${sheet.venue.name}`, X, top);
  let y = drawBlock(doc, TYPE.title, sheet.config.name, X, top + 11, textW);
  const when = sheet.timing === null ? "Date not set" : longDay(sheet.timing.eventStart, timeZone);
  y = drawBlock(doc, TYPE.lede, `${when} · ${sheet.space.name} · ${layoutWords(sheet.config.layoutStyle)}`, X, y + 3, textW);
  const status = sheet.approval === null
    ? `${marks.copyLine} · not yet approved. Check with the duty manager before setting up.`
    : `Approved by ${sheet.approval.approverName} · ${marks.copyLine}`;
  y = drawBlock(doc, sheet.approval === null ? TYPE.statusAlert : TYPE.status, status, X, y + 6, textW);
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

function factsOf(sheet: HallkeeperSheetV2): Fact[] {
  const timeZone = sheet.venue.timezone;
  const timing = sheet.timing;
  const ready: Fact = timing === null
    ? { label: "Ready by", value: "—", caption: "No booking holds this room yet", tone: "alert" }
    : timing.setupBy === null
      ? { label: "Ready by", value: "—", caption: "No changeover time for this room", tone: "alert" }
      : { label: "Ready by", value: clock(timing.setupBy, timeZone), caption: timing.bufferMinutes === null ? "" : `${String(timing.bufferMinutes)} min before the start`, tone: "accent" };
  return [
    ready,
    timing === null
      ? { label: "Starts", value: "—", caption: "Confirm the time first", tone: "plain" }
      : { label: "Starts", value: clock(timing.eventStart, timeZone), caption: `${shortDay(timing.eventStart, timeZone)} · ${venueZoneLabel(timeZone)}`, tone: "plain" },
    { label: "Guests", value: String(sheet.config.guestCount), caption: layoutWords(sheet.config.layoutStyle), tone: "plain" },
    { label: "Room", value: sheet.space.name, caption: `${metres(sheet.space.widthM)} × ${metres(sheet.space.lengthM)} m · ${metres(sheet.space.heightM)} m high`, tone: "plain", name: true },
  ];
}

export function facts(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const top = flow.y;
  const cellW = W / 4;
  const numeralTop = top + 18;
  const captionTop = numeralTop + TYPE.numeral.size + 2;
  hairline(doc, X, top, X + W, INK.ruleStrong, 0.7);
  let bottom = captionTop;
  for (const [index, fact] of factsOf(sheet).entries()) {
    const x = X + index * cellW + (index === 0 ? 0 : 12);
    const width = cellW - (index === 0 ? 14 : 26);
    if (index > 0) upright(doc, X + index * cellW, top + 8, captionTop + 10);
    drawLine(doc, fact.tone === "alert" ? TYPE.overlineAlert : TYPE.overline, fact.label, x, top + 9);
    if (fact.name === true) {
      let size: number = TYPE.factName.size;
      while (size > 11 && textWidth(doc, { ...TYPE.factName, size }, fact.value) > width) size -= 0.5;
      const style: TextStyle = { ...TYPE.factName, size };
      drawLine(doc, style, oneLine(doc, style, fact.value, width), x, numeralTop + (TYPE.numeral.size - size) * 0.86);
    } else {
      const style = fact.tone === "alert" ? TYPE.numeralAlert : fact.tone === "accent" ? TYPE.numeralAccent : TYPE.numeral;
      drawLine(doc, style, fact.value, x - 1, numeralTop);
    }
    if (fact.caption.length > 0) {
      bottom = Math.max(bottom, drawBlock(doc, fact.tone === "alert" ? TYPE.labelAlert : TYPE.label, fact.caption, x, captionTop, width));
    }
  }
  bottom += 8;
  hairline(doc, X, bottom, X + W, INK.ruleStrong, 0.7);
  flow.y = bottom + 12;
}

// -------------------------------------------------------- keep in view ----

interface KeptLine { readonly style: TextStyle; readonly text: string; readonly gap: number }
interface KeptColumn { readonly label: string; readonly alert: boolean; readonly lines: readonly KeptLine[] }

const NONE_RECORDED = "None recorded on this sheet";

function keptColumns(sheet: HallkeeperSheetV2): KeptColumn[] {
  const ins = sheet.instructions;
  const needs = accessNeeds(ins?.accessibility ?? null);
  const allergies = allergyFacts(ins?.dietary ?? null);
  const meals = otherMeals(ins?.dietary ?? null);
  const contact = ins?.dayOfContact ?? null;
  const allergyLines: KeptLine[] = [];
  if (allergies === null) allergyLines.push({ style: TYPE.bodyQuiet, text: NONE_RECORDED, gap: 2 });
  else {
    if (allergies.counts.length > 0) allergyLines.push({ style: TYPE.strong, text: `${allergies.counts.join(" and ")} ${allergies.noun}`, gap: 2 });
    if (allergies.notes !== null) allergyLines.push({ style: TYPE.body, text: allergies.notes, gap: 4 });
  }
  if (meals !== null) allergyLines.push({ style: TYPE.bodyDim, text: `Other meals: ${meals}`, gap: 0 });
  const contactLines: KeptLine[] = contact === null
    ? [{ style: TYPE.bodyQuiet, text: "None on this sheet", gap: 0 }]
    : [
        { style: TYPE.contactName, text: contact.name, gap: 1 },
        ...(contact.role.trim().length > 0 ? [{ style: TYPE.bodyDim, text: contact.role.trim(), gap: 3 }] : []),
        ...(contact.phone.trim().length > 0 ? [{ style: TYPE.phone, text: contact.phone.trim(), gap: 1 }] : []),
        ...(contact.email.trim().length > 0 ? [{ style: TYPE.bodyDim, text: contact.email.trim(), gap: 0 }] : []),
      ];
  return [
    { label: "Access needs", alert: needs.length > 0, lines: needs.length === 0 ? [{ style: TYPE.bodyQuiet, text: NONE_RECORDED, gap: 0 }] : needs.map((need) => ({ style: TYPE.body, text: need, gap: 2 })) },
    { label: "Allergies", alert: allergies !== null, lines: allergyLines },
    { label: "Day-of contact", alert: false, lines: contactLines },
  ];
}

const KEEP_PAD = 12;
const KEEP_GAP = 16;
const KEEP_HEAD = 20;
/** Above this the three columns would crowd a page; they stack and flow instead. */
const KEEP_MAX_PANEL = 300;

export function keepInView(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const columns = keptColumns(sheet);
  const columnW = (W - KEEP_PAD * 2 - KEEP_GAP * 2) / 3;
  const heights = columns.map((column) => column.lines.reduce((sum, line) => sum + blockHeight(doc, line.style, line.text, columnW) + line.gap, 0));
  const panelH = KEEP_HEAD + Math.max(...heights) + KEEP_PAD;

  if (panelH <= KEEP_MAX_PANEL) {
    flow.ensure(panelH);
    const top = flow.y;
    doc.save().rect(X, top, W, panelH).fill(INK.panel).restore();
    doc.save().rect(X, top, 2.6, panelH).fill(INK.forest).restore();
    drawLine(doc, TYPE.overlineAccent, "Keep in view", X, top + 9, { width: W - KEEP_PAD, to: "right" });
    for (const [index, column] of columns.entries()) {
      const x = X + KEEP_PAD + index * (columnW + KEEP_GAP);
      drawLine(doc, column.alert ? TYPE.overlineAlert : TYPE.overline, column.label, x, top + 9);
      let y = top + KEEP_HEAD;
      for (const line of column.lines) y = drawBlock(doc, line.style, line.text, x, y, columnW) + line.gap;
    }
    flow.y = top + panelH + 16;
    return;
  }

  // Stacked: each column runs full width and may cross a page; the forest
  // rule runs beside every line so the block still reads as one.
  // Each segment reaches into the gap below it, so consecutive lines join up.
  const bar = (top: number, height: number): void => { doc.save().rect(X, top, 2.6, height + 4).fill(INK.forest).restore(); };
  flow.ensure(40);
  drawLine(doc, TYPE.overlineAccent, "Keep in view", X + KEEP_PAD, flow.y);
  flow.y += 14;
  for (const column of columns) {
    flow.ensure(12 + lineHeight(doc, column.lines[0]?.style ?? TYPE.body));
    bar(flow.y, 12);
    drawLine(doc, column.alert ? TYPE.overlineAlert : TYPE.overline, column.label, X + KEEP_PAD, flow.y + 2);
    flow.y += 12;
    for (const line of column.lines) {
      flow.paragraph(line.style, line.text, X + KEEP_PAD, W - KEEP_PAD, bar);
      flow.y += line.gap;
    }
    flow.y += 6;
  }
  flow.y += 12;
}

// ------------------------------------------------ the day and the store ----

const TIME_W = 38;
const LATE = "After the room's ready-by time";

function dayLineHeight(doc: Doc, line: DayLine, width: number): number {
  const textW = width - TIME_W;
  let height = blockHeight(doc, line.emphasis ? TYPE.dayTitleStrong : TYPE.dayTitle, line.title, textW);
  if (line.otherDay) height += lineHeight(doc, TYPE.detailAccent);
  if (line.detail !== null) height += 0.5 + blockHeight(doc, TYPE.detail, line.detail, textW);
  if (line.late) height += 0.5 + blockHeight(doc, TYPE.detailAlert, LATE, textW);
  return Math.max(height, lineHeight(doc, TYPE.time)) + 4;
}

function drawDayLine(doc: Doc, line: DayLine, timeZone: string, x: number, y: number, width: number): void {
  const textW = width - TIME_W;
  drawLine(doc, line.emphasis ? TYPE.timeAccent : TYPE.time, clock(line.at, timeZone), x, y);
  let cursor = drawBlock(doc, line.emphasis ? TYPE.dayTitleStrong : TYPE.dayTitle, line.title, x + TIME_W, y, textW);
  if (line.otherDay) cursor = drawLine(doc, TYPE.detailAccent, shortDay(line.at, timeZone), x + TIME_W, cursor);
  if (line.detail !== null) cursor = drawBlock(doc, TYPE.detail, line.detail, x + TIME_W, cursor + 0.5, textW);
  if (line.late) drawBlock(doc, TYPE.detailAlert, LATE, x + TIME_W, cursor + 0.5, textW);
}

const QTY_W = 26;

function storeRowHeight(doc: Doc, name: string, width: number): number {
  return blockHeight(doc, TYPE.itemPlain, name, width - QTY_W - 8) + 2.5;
}

function storeGroupHeight(doc: Doc, group: StoreGroup, width: number): number {
  return 12 + group.items.reduce((sum, item) => sum + storeRowHeight(doc, item.name, width), 0) + 6;
}

function drawStoreRow(doc: Doc, name: string, qty: number, x: number, y: number, width: number): number {
  drawLine(doc, TYPE.qty, String(qty), x, y - 0.6, { width: QTY_W, to: "right" });
  return drawBlock(doc, TYPE.itemPlain, name, x + QTY_W + 8, y, width - QTY_W - 8) + 2.5;
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

function dayColumnHeight(doc: Doc, parts: BriefParts, width: number): number {
  return 14 + (parts.day.length === 0 ? blockHeight(doc, TYPE.bodyQuiet, NO_TIMES, width) : parts.day.reduce((sum, line) => sum + dayLineHeight(doc, line, width), 0));
}

function notesColumnHeight(doc: Doc, parts: BriefParts, width: number): number {
  return parts.notes.reduce((sum, [, text]) => sum + 14 + 13 + blockHeight(doc, TYPE.paragraph, text, width), 0);
}

function storeColumnHeight(doc: Doc, parts: BriefParts, width: number): number {
  return 14 + (parts.store.length === 0 ? lineHeight(doc, TYPE.bodyQuiet) : parts.store.reduce((sum, group) => sum + storeGroupHeight(doc, group, width), 0));
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
    { height: 14, need: 14 + dayLineHeight(doc, firstLine, width), draw: (y) => { drawLine(doc, TYPE.overline, DAY_HEADING, x, y); } },
    ...parts.day.map((line): Unit => ({ height: dayLineHeight(doc, line, width), draw: (y) => { drawDayLine(doc, line, parts.timeZone, x, y, width); } })),
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
      height: lead + 12,
      need: lead + 12 + storeRowHeight(doc, group.items[0]?.name ?? "", width),
      ...(index === 0 ? {} : { before: 6 }),
      draw: (y) => {
        if (index === 0) drawLine(doc, TYPE.overline, STORE_HEADING, x, y);
        drawLine(doc, TYPE.storeGroup, group.title, x, y + lead);
      },
    };
    const rows = group.items.map((item): Unit => ({ height: storeRowHeight(doc, item.name, width), draw: (y) => { drawStoreRow(doc, item.name, item.qty, x, y, width); } }));
    return [title, ...rows];
  });
}

/**
 * The rest of the brief: the day in order beside what to bring from the
 * store, each column free to carry on overleaf by itself. The planner's
 * notes sit under the day when that keeps the brief no longer than the
 * store or this page already make it; otherwise they follow full width.
 */
export function brief(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const parts = briefParts(sheet);
  const leftW = W * 0.54;
  const gutter = 22;
  const rightX = X + leftW + gutter;
  const rightW = W - leftW - gutter;
  const dayH = dayColumnHeight(doc, parts, leftW);
  const storeH = storeColumnHeight(doc, parts, rightW);
  const notesBeside = parts.notes.length > 0 && dayH + notesColumnHeight(doc, parts, leftW) <= Math.max(storeH, flow.room);
  const left = [...dayUnits(doc, parts, X, leftW), ...(notesBeside ? notesUnits(doc, parts, X, leftW) : [])];
  flow.lanes([left, storeUnits(doc, parts, rightX, rightW)], (top, bottom) => { upright(doc, X + leftW + gutter / 2, top, bottom - 5); });
  flow.y += 14;
  if (!notesBeside) notesFlowing(flow, parts);
}

/** The planner's notes full width, a paragraph free to cross pages. */
function notesFlowing(flow: Flow, parts: BriefParts): void {
  const { doc } = flow;
  if (parts.notes.length === 0) return;
  hairline(doc, X, flow.y - 8, X + W);
  for (const [heading, text] of parts.notes) {
    flow.ensure(13 + lineHeight(doc, TYPE.paragraph) * Math.min(2, wrapLines(doc, TYPE.paragraph, text, W).length));
    drawLine(doc, TYPE.overline, heading, X, flow.y);
    flow.y += 13;
    flow.paragraph(TYPE.paragraph, text, X, W);
    flow.y += 8;
  }
  flow.y += 10;
}

// ------------------------------------------------------------- the room ----

/** A data:image/... URL's bytes, or null. */
function diagramBytes(url: string | null): Buffer | null {
  if (url === null || !url.startsWith("data:image/")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const bytes = Buffer.from(url.slice(comma + 1), "base64");
  return bytes.length > 0 ? bytes : null;
}

const NO_PLAN = "No plan was saved with this layout. Set the room from the list.";
const LEGEND_SIDE = 130;

const LEGEND_STYLE: TextStyle = { ...TYPE.note, size: 8.6 };
const LEGEND_GAP = 14;
/** Room the scale bar and caption need beside the legend. */
const LEGEND_MIN = 34;
type LegendEntry = readonly [string, number];

/** Beneath the plan the legend leaves room for the scale bar; overleaf it has the page. */
function legendColumnW(besidePlan: boolean): number {
  return (W - (besidePlan ? LEGEND_SIDE : 0) - LEGEND_GAP) / 2;
}

function legendEntryHeight(doc: Doc, note: string, columnW: number): number {
  return blockHeight(doc, LEGEND_STYLE, note, columnW - 14) + 3;
}

function legendHeight(doc: Doc, entries: readonly LegendEntry[]): number {
  const columnW = legendColumnW(true);
  const half = Math.ceil(entries.length / 2);
  const column = (part: readonly LegendEntry[]): number => part.reduce((sum, [note]) => sum + legendEntryHeight(doc, note, columnW), 0);
  return Math.max(LEGEND_MIN, column(entries.slice(0, half)), column(entries.slice(half)));
}

/**
 * The plan's numbered notes in two columns from `top`. When they fit, the
 * columns split evenly; when they don't, each page fills the first column,
 * then the second, and the rest carries on overleaf in reading order.
 * Returns the y below the last note and whether it ran onto a new page.
 */
function drawLegend(flow: Flow, entries: readonly LegendEntry[], top: number): { bottom: number; turned: boolean } {
  const { doc } = flow;
  let rest = entries;
  let pageTop = top;
  let turned = false;
  let bottom = top;
  while (rest.length > 0) {
    const columnW = legendColumnW(!turned);
    const room = flow.bottom - pageTop;
    const height = (entry: LegendEntry): number => legendEntryHeight(doc, entry[0], columnW);
    const total = (part: readonly LegendEntry[]): number => part.reduce((sum, entry) => sum + height(entry), 0);
    const half = Math.ceil(rest.length / 2);
    let columns: LegendEntry[][];
    if (Math.max(total(rest.slice(0, half)), total(rest.slice(half))) <= room) {
      columns = [rest.slice(0, half), rest.slice(half)];
    } else {
      columns = [[], []];
      let next = 0;
      for (const column of columns) {
        let used = 0;
        for (let entry = rest[next]; entry !== undefined && used + height(entry) <= room; entry = rest[next]) {
          used += height(entry);
          column.push(entry);
          next++;
        }
      }
      // A fresh page always takes at least one note, so the loop moves on.
      const [only] = rest;
      if (next === 0 && turned && only !== undefined) columns[0]?.push(only);
    }
    for (const [index, part] of columns.entries()) {
      const x = X + index * (columnW + LEGEND_GAP);
      let y = pageTop;
      for (const [note, number] of part) {
        drawMarker(doc, number, x + 5, y + 5, 4.6);
        y = drawBlock(doc, LEGEND_STYLE, note, x + 14, y, columnW - 14) + 3;
      }
      bottom = Math.max(bottom, y);
    }
    rest = rest.slice(columns.reduce((sum, part) => sum + part.length, 0));
    if (rest.length > 0) {
      flow.newPage();
      pageTop = flow.top;
      bottom = pageTop;
      turned = true;
    }
  }
  return { bottom, turned };
}

export function room(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const plan = sheet.floorPlan ?? null;
  const diagram = diagramBytes(sheet.diagramUrl);
  const markers = sheetNoteMarkers(sheet);
  const legend = diagram === null ? [...markers.entries()].sort((a, b) => a[1] - b[1]) : [];
  const legendH = plan !== null && diagram === null ? legendHeight(doc, legend) : 0;
  const xs = plan?.outline.map((point) => point.x) ?? [];
  const zs = plan?.outline.map((point) => point.z) ?? [];
  const span = plan === null
    ? { width: sheet.space.widthM, length: sheet.space.lengthM }
    : { width: Math.max(...xs) - Math.min(...xs), length: Math.max(...zs) - Math.min(...zs) };
  const fullH = plan !== null || diagram !== null
    ? Math.min((W - WALL_BAND * 2) * (span.length / span.width), 280) + WALL_BAND * 2
    : 70;
  // A legend too long to share any page with the plan flows on from beneath
  // it, so only its first lines need to fit beside the scale bar here.
  const legendFits = 14 + fullH + 6 + legendH + 16 <= flow.pageRoom;
  const overhead = 14 + 6 + (legendFits ? legendH : LEGEND_MIN) + 16;

  let planH = fullH;
  if (flow.room >= overhead + fullH) hairline(doc, X, flow.y - 8, X + W);
  else if (plan !== null && diagram === null && flow.room - overhead >= 190) { planH = flow.room - overhead; hairline(doc, X, flow.y - 8, X + W); }
  else flow.newPage();

  drawLine(doc, TYPE.overline, `The room · ${sheet.space.name}`, X, flow.y);
  flow.y += 14;
  const box = { x: X, y: flow.y, width: W, height: planH };
  let drawn: { pointsPerMetre: number; named: boolean } | null = null;
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
  if (!pictured && plan !== null) drawn = drawSheetPlan(doc, plan, box, markers);
  if (!pictured && plan === null) {
    doc.save().rect(box.x, box.y, box.width, box.height).lineWidth(0.6).dash(2, { space: 2 }).strokeColor(INK.ruleStrong).stroke().undash().restore();
    drawLine(doc, TYPE.bodyDim, NO_PLAN, box.x, box.y + box.height / 2 - 5, { width: box.width, to: "center" });
  }
  flow.y += planH + 6;

  if (drawn !== null) {
    const top = flow.y;
    drawScaleBar(doc, drawn.pointsPerMetre, X + W, top + 6);
    const caption = drawn.named ? "Drawn from the saved layout, looking down. Numbers are the planner's table names." : "Drawn from the saved layout, looking down.";
    const captionW = LEGEND_SIDE - 10;
    const lines = wrapLines(doc, TYPE.small, caption, captionW);
    let y = top + 12;
    for (const line of lines) y = drawLine(doc, TYPE.small, line, X + W - captionW, y, { width: captionW, to: "right" });
    const placed = drawLegend(flow, legend, top);
    flow.y = (placed.turned ? placed.bottom : Math.max(top + LEGEND_MIN, placed.bottom)) + 16;
  } else {
    flow.y += 10;
  }
}

// ---------------------------------------------------------- setup steps ----

const CHECK = 10.5;

interface RowGeometry { readonly nameX: number; readonly nameW: number; readonly whereW: number }

function rowGeometry(): RowGeometry {
  const whereW = Math.min(200, W * 0.36);
  const nameX = X + CHECK + 8 + QTY_W + 8;
  return { nameX, nameW: X + W - whereW - 10 - nameX, whereW };
}

function chairsText(item: SetupItem): string | null {
  if (item.chairs === null) return null;
  return item.chairs.each === null ? `${String(item.chairs.total)} chairs in all` : `${String(item.chairs.each)} chairs each`;
}

function whereText(item: SetupItem): string {
  return item.where.map((place) => (item.where.length === 1 ? place.zone : `${place.zone} ${String(place.qty)}`)).join(" · ");
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

function setupRowHeight(doc: Doc, item: SetupItem, geometry: RowGeometry, markers: ReadonlyMap<string, number>): number {
  const style = item.accessory ? TYPE.itemPlain : TYPE.item;
  const { lines, chairsInline } = nameLayout(doc, item, geometry.nameW);
  let height = lines.length * lineHeight(doc, style) + (chairsInline ? 0 : lineHeight(doc, CHAIRS_STYLE));
  height = Math.max(height, blockHeight(doc, TYPE.where, whereText(item), geometry.whereW));
  for (const note of item.notes) height += 1.5 + blockHeight(doc, TYPE.note, note, geometry.nameW - (markers.has(note) ? 12 : 0));
  return Math.max(height, CHECK) + 8;
}

function drawSetupRow(doc: Doc, item: SetupItem, y: number, geometry: RowGeometry, markers: ReadonlyMap<string, number>): void {
  const style = item.accessory ? TYPE.itemPlain : TYPE.item;
  doc.save().roundedRect(X, y + 0.5, CHECK, CHECK, 1.2).lineWidth(0.8).strokeColor(INK.secondary).stroke().restore();
  drawLine(doc, TYPE.qty, String(item.qty), X + CHECK + 8, y - 0.2, { width: QTY_W, to: "right" });
  const { lines, chairsInline } = nameLayout(doc, item, geometry.nameW);
  let cursor = y;
  for (const line of lines) cursor = drawLine(doc, style, line, geometry.nameX, cursor);
  const chairs = chairsText(item);
  if (chairs !== null) {
    if (chairsInline) drawLine(doc, CHAIRS_STYLE, chairs, geometry.nameX + textWidth(doc, style, lines[lines.length - 1] ?? "") + 8, cursor - lineHeight(doc, style) + 1.2);
    else cursor = drawLine(doc, CHAIRS_STYLE, chairs, geometry.nameX, cursor);
  }
  const whereLines = wrapLines(doc, TYPE.where, whereText(item), geometry.whereW);
  let whereY = y + 1.2;
  for (const line of whereLines) whereY = drawLine(doc, TYPE.where, line, X + W - geometry.whereW, whereY, { width: geometry.whereW, to: "right" });
  const ordered = [...item.notes].sort((a, b) => (markers.get(a) ?? Infinity) - (markers.get(b) ?? Infinity));
  for (const note of ordered) {
    const number = markers.get(note);
    if (number !== undefined) drawMarker(doc, number, geometry.nameX + 4.2, cursor + 7.5, 4.2);
    cursor = drawBlock(doc, TYPE.note, note, geometry.nameX + (number === undefined ? 0 : 12), cursor + 1.5, geometry.nameW - (number === undefined ? 0 : 12));
  }
}

/** A line whose notes run longer than a page: the line itself, then its notes line by line across pages. */
function tallSetupRow(flow: Flow, item: SetupItem, geometry: RowGeometry, markers: ReadonlyMap<string, number>): void {
  const { doc } = flow;
  const bare: SetupItem = { ...item, notes: [] };
  const head = setupRowHeight(doc, bare, geometry, markers) - 8;
  flow.ensure(head + lineHeight(doc, TYPE.note) * 2);
  drawSetupRow(doc, bare, flow.y, geometry, markers);
  flow.y += head;
  const ordered = [...item.notes].sort((a, b) => (markers.get(a) ?? Infinity) - (markers.get(b) ?? Infinity));
  for (const note of ordered) {
    const number = markers.get(note);
    const indent = number === undefined ? 0 : 12;
    flow.y += 1.5;
    flow.ensure(lineHeight(doc, TYPE.note));
    if (number !== undefined) drawMarker(doc, number, geometry.nameX + 4.2, flow.y + 6, 4.2);
    flow.paragraph(TYPE.note, note, geometry.nameX + indent, geometry.nameW - indent);
  }
  flow.y += 8;
}

export function setupSteps(flow: Flow, sheet: HallkeeperSheetV2): void {
  const { doc } = flow;
  const timeZone = sheet.venue.timezone;
  const steps = sheetSetupSteps(sheet);
  const markers = sheetNoteMarkers(sheet);
  const geometry = rowGeometry();
  const firstRow = steps[0]?.items[0];
  flow.ensure(24 + 30 + (firstRow === undefined ? 16 : setupRowHeight(doc, firstRow, geometry, markers)));
  drawLine(doc, TYPE.section, "Setup, in order", X, flow.y);
  drawLine(doc, TYPE.label, "Tick each line as it is done. Where each item goes is on the plan.", X + textWidth(doc, TYPE.section, "Setup, in order") + 12, flow.y + 5);
  flow.y += 24;
  if (steps.length === 0) {
    drawLine(doc, TYPE.bodyQuiet, "Nothing is placed in this layout yet.", X, flow.y);
    flow.y += 26;
    return;
  }
  for (const [index, step] of steps.entries()) {
    // A step starts where its heading and its first three lines (or all, if fewer) fit.
    flow.ensure(25 + step.items.slice(0, 3).reduce((sum, item) => sum + setupRowHeight(doc, item, geometry, markers), 0));
    const top = flow.y;
    drawLine(doc, TYPE.step, String(index + 1), X, top - 4);
    drawLine(doc, { ...TYPE.section, size: 13 }, step.label, X + 18, top);
    if (step.deadline !== null) {
      const words = `done by ${step.deadline.otherDay ? `${shortDay(step.deadline.at, timeZone)} ` : ""}${clock(step.deadline.at, timeZone)}${step.deadline.reason === null ? "" : ` · ${step.deadline.reason}`}${step.deadline.late ? " · after the ready-by time" : ""}`;
      const style: TextStyle = { face: "Inter-Medium", size: 8.4, color: step.deadline.late ? INK.alert : INK.secondary, tnum: true };
      const rightW = W - 18 - textWidth(doc, { ...TYPE.section, size: 13 }, step.label) - 24;
      drawLine(doc, style, oneLine(doc, style, words, rightW), X, top + 3.5, { width: W, to: "right" });
    }
    flow.y = top + 19;
    hairline(doc, X, flow.y, X + W, INK.ruleStrong, 0.6);
    flow.y += 6;
    for (const item of step.items) {
      const height = setupRowHeight(doc, item, geometry, markers);
      if (height <= flow.pageRoom) {
        flow.ensure(height);
        drawSetupRow(doc, item, flow.y, geometry, markers);
        flow.y += height;
      } else {
        tallSetupRow(flow, item, geometry, markers);
      }
      hairline(doc, geometry.nameX, flow.y - 3.5, X + W, INK.rule, 0.4);
    }
    flow.y += 10;
  }
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
  hairline(doc, X, flow.y - 8, X + W);
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
  hairline(doc, X, flow.y - 8, X + W);
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
