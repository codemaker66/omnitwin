import type { SupplierPassScopeItem, SupplierPassSummary } from "../../api/supplier-coordination.js";

// ---------------------------------------------------------------------------
// The words of supplier passes (A Door for Everyone Outside, stage 1), for
// the staff sheet and the supplier's own page alike. Plain British English in
// the venue's clock: no system words, nothing claimed that nobody checked,
// and every "no" with a next step.
// ---------------------------------------------------------------------------

const DEFAULT_ZONE = "Europe/London";

function validDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Saturday 24 October" on the venue's clock. */
export function longDay(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  const date = validDate(iso);
  if (date === null) return null;
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
}

/** "Sat 31 Oct" on the venue's clock. */
export function shortDay(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  const date = validDate(iso);
  if (date === null) return null;
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
}

/** "14:02" on the venue's clock. */
export function clockTime(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  const date = validDate(iso);
  if (date === null) return null;
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

/** "Thu 15 Oct, 14:02". */
export function dayAndTime(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  const day = shortDay(iso, timeZone);
  const time = clockTime(iso, timeZone);
  return day === null || time === null ? null : `${day}, ${time}`;
}

/** "Updated 14:02, Thu 15 Oct". */
export function updatedWords(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  const day = shortDay(iso, timeZone);
  const time = clockTime(iso, timeZone);
  return day === null || time === null ? null : `Updated ${time}, ${day}`;
}

/** "Grand Hall", "Grand Hall and Saloon", "Saloon, Grand Hall and Hall of Fame". */
export function roomList(rooms: readonly string[]): string | null {
  if (rooms.length === 0) return null;
  if (rooms.length === 1) return rooms[0] ?? null;
  return `${rooms.slice(0, -1).join(", ")} and ${rooms[rooms.length - 1] ?? ""}`;
}

/** "1 part" / "3 parts". */
export function partCount(count: number): string {
  return `${String(count)} ${count === 1 ? "part" : "parts"}`;
}

// ---------------------------------------------------------------------------
// The staff board.
// ---------------------------------------------------------------------------

export type PassState = "live" | "draft" | "withdrawn" | "ended";

export function passState(pass: SupplierPassSummary): PassState {
  if (pass.revokedAt !== null || pass.status === "revoked") return "withdrawn";
  if (pass.status === "draft" || pass.link === null) return "draft";
  return pass.live ? "live" : "ended";
}

/** The pass's link, said plainly. */
export function linkWords(pass: SupplierPassSummary, timeZone: string): string {
  switch (passState(pass)) {
    case "withdrawn": {
      const when = dayAndTime(pass.revokedAt, timeZone);
      return when === null ? "Withdrawn. The link no longer opens." : `Withdrawn ${when}. The link no longer opens.`;
    }
    case "draft":
      return "Not sent: no link made yet.";
    case "ended": {
      const until = shortDay(pass.expiresAt, timeZone);
      return until === null ? "The link no longer opens." : `Stopped working ${until}.`;
    }
    case "live": {
      const until = shortDay(pass.expiresAt, timeZone);
      const assumed = pass.expiryAssumed ? " (7 days after the event)" : "";
      return until === null ? "The link opens." : `Works until ${until}${assumed}.`;
    }
  }
}

/** Whether the holder has opened it and said they have read it. The name is
 *  whatever the holder of the link typed, so it is reported as given. */
export function readWords(pass: SupplierPassSummary, timeZone: string): string {
  const read = [...pass.acknowledgements].reverse().find((ack) => ack.status === "acknowledged");
  if (read !== undefined) {
    const when = dayAndTime(read.createdAt, timeZone) ?? "";
    return read.acknowledgedByName === null ? `Read ${when}.` : `Read ${when}. Name given: ${read.acknowledgedByName}.`;
  }
  const opened = dayAndTime(pass.openedAt, timeZone);
  if (opened !== null) return `Opened ${opened}; not marked as read yet.`;
  return passState(pass) === "live" ? "Not opened yet." : "Never opened.";
}

/** The newest question the holder sent, if it is the last thing they said. */
export function openQuestion(pass: SupplierPassSummary): SupplierPassSummary["acknowledgements"][number] | null {
  const last = pass.acknowledgements[pass.acknowledgements.length - 1];
  return last !== undefined && last.status === "needs_clarification" ? last : null;
}

/** What a pass gives its holder, summarised for the board. */
export function partsSummary(pass: SupplierPassSummary): string {
  const first = pass.items[0];
  if (first === undefined) return "No parts";
  const arrive = pass.items.find((item) => item.arrivalWindow !== null)?.arrivalWindow ?? null;
  const more = pass.items.length > 1 ? ` and ${String(pass.items.length - 1)} more` : "";
  return `${first.title}${more}${arrive === null ? "" : ` · arrives ${arrive}`}`;
}

/** "The plan changed on Thu 15 Oct at 16:10, after this pass was made." */
export function planChangedWords(iso: string | null, timeZone: string): string | null {
  const day = shortDay(iso, timeZone);
  const time = clockTime(iso, timeZone);
  if (day === null || time === null) return null;
  return `The plan changed on ${day} at ${time}, after this pass was made.`;
}

// ---------------------------------------------------------------------------
// The issue sheet.
// ---------------------------------------------------------------------------

/** The parts a pass for this holder starts with: everything the plan names
 *  for that supplier. General notes are offered, never chosen for them. */
export function defaultScope(scope: readonly SupplierPassScopeItem[], supplierId: string | null): readonly string[] {
  if (supplierId === null) return [];
  return scope.filter((item) => item.supplierId === supplierId).map((item) => item.instructionId);
}

/** The parts that may go on a pass for this holder: theirs and the general
 *  notes, never a part the plan gives another supplier. */
export function offerableScope(scope: readonly SupplierPassScopeItem[], supplierId: string | null): readonly SupplierPassScopeItem[] {
  return scope.filter((item) => item.supplierId === null || (supplierId !== null && item.supplierId === supplierId));
}

/** What the holder will and will not see, said before anything is made. */
export function seeSentence(input: {
  readonly holder: string;
  readonly day: string | null;
  readonly rooms: string | null;
  readonly parts: number;
  readonly hasAddress: boolean;
  readonly contact: { readonly name: string; readonly phone: string | null } | null;
}): { readonly will: string; readonly willNot: string } {
  const when = [input.day, input.rooms].filter((part): part is string => part !== null).join(", ");
  const facts = [
    when.length > 0 ? when : "the day and room once the Diary has them",
    `the ${partCount(input.parts)} you ticked, with any arrival times`,
    ...(input.hasAddress ? ["the venue's address"] : []),
    input.contact === null
      ? "the venue team as their contact"
      : `you as their contact (${input.contact.phone === null ? input.contact.name : `${input.contact.name}, ${input.contact.phone}`})`,
  ];
  return {
    will: `${input.holder} will see ${facts.slice(0, -1).join(", ")} and ${facts[facts.length - 1] ?? ""}.`,
    willNot: "They will not see prices, the client's details, other suppliers' parts or anything you did not tick.",
  };
}

/** "4 passes · 2 read · 1 question waiting", or how the board stands empty. */
export function boardSummary(passes: readonly SupplierPassSummary[]): string {
  if (passes.length === 0) return "No passes made for this event yet.";
  const current = passes.filter((pass) => passState(pass) !== "withdrawn");
  if (current.length === 0) return `${String(passes.length)} withdrawn; none open.`;
  const read = current.filter((pass) => pass.acknowledgements.some((ack) => ack.status === "acknowledged")).length;
  const questions = current.filter((pass) => openQuestion(pass) !== null).length;
  const parts = [`${String(current.length)} ${current.length === 1 ? "pass" : "passes"}`, `${String(read)} read`];
  if (questions > 0) parts.push(`${String(questions)} ${questions === 1 ? "question" : "questions"} waiting`);
  return parts.join(" · ");
}

/** Whether a pass belongs to this holder: the same supplier on file, or,
 *  for someone not on file, the same name. The API holds the same rule. */
export function sameHolder(
  pass: Pick<SupplierPassSummary, "supplierId" | "title">,
  holder: { readonly supplierId: string | null; readonly name: string },
): boolean {
  if (pass.supplierId !== null || holder.supplierId !== null) return pass.supplierId === holder.supplierId;
  const normalise = (value: string): string => value.trim().toLocaleLowerCase("en-GB").replace(/\s+/gu, " ");
  return normalise(pass.title) === normalise(holder.name);
}

/** The pass a fresh one for this holder replaces: their newest that has not
 *  been withdrawn, so one holder never has two passes open. */
export function passToReplace(
  passes: readonly SupplierPassSummary[],
  holder: { readonly supplierId: string | null; readonly name: string },
): SupplierPassSummary | null {
  const theirs = passes
    .filter((pass) => passState(pass) !== "withdrawn" && sameHolder(pass, holder))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return theirs[0] ?? null;
}

/** The message staff paste into a text, WhatsApp or email. It carries the
 *  essentials itself, so it still helps with no signal at the kerb. */
export function passMessage(input: {
  readonly venueName: string | null;
  readonly day: string | null;
  readonly rooms: string | null;
  readonly address: string | null;
  readonly arrivals: readonly { readonly title: string; readonly window: string }[];
  readonly contact: { readonly name: string; readonly phone: string | null } | null;
  readonly url: string;
  readonly until: string | null;
}): string {
  const venue = input.venueName ?? "The venue";
  const where = [input.day, input.rooms].filter((part): part is string => part !== null).join(", ");
  const lines = [where.length > 0 ? `${venue}: your brief for ${where}.` : `${venue}: your brief for the event.`];
  for (const arrival of input.arrivals.slice(0, 3)) lines.push(`Arrive ${arrival.window} (${arrival.title}).`);
  if (input.address !== null) lines.push(`Address: ${input.address}.`);
  if (input.contact !== null) {
    lines.push(input.contact.phone === null
      ? `Questions: ${input.contact.name}.`
      : `Questions: ${input.contact.name}, ${input.contact.phone}.`);
  }
  lines.push(`Your brief: ${input.url}`);
  if (input.until !== null) lines.push(`The link works until ${input.until}.`);
  return lines.join("\n");
}

/** The calendar day of an instant on the venue's clock, as a date input
 *  holds it ("2026-10-31"). */
export function venueDateInput(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string {
  const date = validDate(iso);
  if (date === null) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/u.exec(name);
  if (match === null) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

/** The last minute of a chosen day on the venue's clock, as an instant. A
 *  pass chosen to stop "on Saturday" works until Saturday night is over. */
export function endOfVenueDay(dateInput: string, timeZone: string = DEFAULT_ZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateInput);
  if (match === null) return null;
  const wallClock = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 0);
  if (Number.isNaN(wallClock)) return null;
  const offset = zoneOffsetMinutes(new Date(wallClock), timeZone);
  return new Date(wallClock - offset * 60_000);
}
