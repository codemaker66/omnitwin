import { useEffect, useRef, useState, type ReactElement } from "react";
import { changeoverSplit, type Changeover, type ChangeoverItem, type ChangeoverPlanGroup } from "@omnitwin/types";
import { changeoverFailure, getChangeover, type ChangeoverFailure } from "../../api/changeover.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { formatWallTime } from "../diary/lib/board-time.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import { countWord } from "./lib/day-board-rooms.js";
import type { CrewOnPanel, HandRostered, TurnRoundCrew } from "./lib/turn-round-crew.js";
import { useSlotSheet, type SlotSheetResult } from "./lib/use-slot-sheet.js";

// ---------------------------------------------------------------------------
// What moves at a changeover: from the layout the booking before leaves in
// the room to the layout this booking needs. Short lists the crew can work
// from (back to store, bring from store, stays in the room), a line from the
// plan for what moves within the room, and the dressing each booking lays.
// Built from the two sheets the floor already reads (api lib/changeover.ts),
// read again each minute while the panel is open; when either booking has no
// single layout for the room, or a refusal will not mend itself, it says so
// rather than guess or offer a retry that cannot help.
//
// Dressing (the tables' linen) belongs to its booking: what the room had is
// cleared and what the next booking needs is laid, so a cloth is never
// listed as staying for a different function. Who is on setup for the
// turn-round comes first, from the published rota (lib/turn-round-crew.ts).
// ---------------------------------------------------------------------------

type ChangeoverResult =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly changeover: Changeover }
  | { readonly status: "error"; readonly failure: ChangeoverFailure };

/** As the sheet's progress line: a layout edited this afternoon reaches an open panel within a minute. */
export const CHANGEOVER_REFRESH_MS = 60_000;

/**
 * What moves from one layout to the next (or the same one again), read now
 * and each minute while the panel is open. A re-read that fails for now keeps
 * the last answer on screen, and the next minute reads again; a lasting
 * refusal replaces it, since the answer it came from no longer holds. The
 * answer depends on the two layouts alone, so they (and the attempt) key it.
 */
function useChangeover(from: string | null, to: string | null, attempt: number): ChangeoverResult | null {
  const [result, setResult] = useState<{ readonly key: string; readonly value: ChangeoverResult } | null>(null);
  const key = `${from ?? ""}>${to ?? ""}#${String(attempt)}`;
  useEffect(() => {
    if (from === null || to === null) return;
    let reading: AbortController | null = null;
    let shown: ChangeoverResult["status"] = "loading";
    const read = (): void => {
      // A hidden board waits for the next minute, once it has an answer.
      if (shown !== "loading" && typeof document !== "undefined" && document.hidden) return;
      reading?.abort();
      const current = new AbortController();
      reading = current;
      void getChangeover({ from, to }, current.signal)
        .then((changeover) => {
          if (current.signal.aborted) return;
          shown = "ready";
          setResult({ key, value: { status: "ready", changeover } });
        })
        .catch((error: unknown) => {
          if (current.signal.aborted) return;
          const failure = changeoverFailure(error);
          if (!failure.lasting && shown === "ready") return;
          shown = "error";
          setResult({ key, value: { status: "error", failure } });
        });
    };
    read();
    const timer = window.setInterval(read, CHANGEOVER_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      reading?.abort();
    };
  }, [from, to, key]);
  if (from === null || to === null) return null;
  return result?.key === key ? result.value : { status: "loading" };
}

function counted(count: number, name: string): string {
  return `${String(count)} × ${name}`;
}

function itemKey(item: ChangeoverItem): string {
  return `${item.category}\u0000${item.name}`;
}

/** Where pieces of this kind go: named when they land in one or two parts of
 *  the room; spread wider, the sheet's plan says where better than a list. */
function whereTo(item: ChangeoverItem): string | null {
  const zones = item.zones.filter((zone) => zone.after > zone.before).map((zone) => zone.zone);
  return zones.length === 0 || zones.length > 2 ? null : zones.join(", ");
}

function pieces(groups: readonly ChangeoverPlanGroup[]): string {
  const words = groups.map((group) => counted(group.count, group.name));
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

interface Line {
  readonly item: ChangeoverItem;
  readonly split: ReturnType<typeof changeoverSplit>;
}

/**
 * Without a plan to pair pieces, the fewest of a kind that must change part
 * of the room: what the parts gaining it gain, beyond what comes from store.
 */
function changingPart(line: Line): number {
  const gained = line.item.zones.reduce((sum, zone) => sum + Math.max(0, zone.after - zone.before), 0);
  return Math.max(0, gained - line.split.fromStore);
}

/** A dressing line: what the room had cleared, and what the next booking lays. */
function dressingWords(item: ChangeoverItem): string {
  const steps = [
    item.before > 0 ? `clear ${String(item.before)}` : null,
    item.after > 0 ? `lay ${String(item.after)}` : null,
  ].filter((step): step is string => step !== null);
  return `${item.name}: ${steps.join(", ")}`;
}

/** Why the plan cannot pair the pieces, in the floor's words, and what that leaves out. */
function noPlanWords(changeover: Changeover, fromTitle: string, toTitle: string): string {
  if (changeover.tooManyPieces) {
    return "These layouts have too many pieces to pair one by one, so moves within each part of the room aren’t shown.";
  }
  const missing = [changeover.from.hasPlan ? null : fromTitle, changeover.to.hasPlan ? null : toTitle]
    .filter((title): title is string => title !== null);
  const why = missing.length === 2
    ? "Neither sheet has a plan"
    : missing.length === 1 ? `The sheet for ${missing[0] ?? ""} has no plan` : "The plans can’t be compared";
  // A sheet without a plan places a table's chairs at the table, so no part
  // of the room is compared either (changeover.zonesCompared).
  return changeover.zonesCompared
    ? `${why}, so moves within each part of the room aren’t shown.`
    : `${why}, so what moves within the room isn’t shown.`;
}

/** Of the pieces of an item that stay in the room, how many the plan moves:
 *  its group, matched as the API matches items (by name and category, in any case). */
function movingOf(plan: Changeover["plan"], item: ChangeoverItem): number {
  const fold = (words: string): string => words.trim().toLowerCase();
  const group = plan?.moved.find((candidate) =>
    fold(candidate.name) === fold(item.name) && fold(candidate.category) === fold(item.category));
  return group?.count ?? 0;
}

/** The plan's line: what stays where it is and what moves within the room, leaving out a nought. */
function planWords(plan: NonNullable<Changeover["plan"]>, movedPieces: number): string {
  const stays = plan.staysPut === 0 ? null
    : plan.staysPut === 1 ? "1 piece stays where it is" : `${String(plan.staysPut)} pieces stay where they are`;
  const moves = movedPieces === 0 ? null : `${pieces(plan.moved)} ${movedPieces === 1 ? "moves" : "move"} within the room`;
  return `On the plan: ${[stays, moves].filter((words): words is string => words !== null).join("; ")}.`;
}

/**
 * A refusal no retry mends, in the floor's words: whose sheet it is about
 * (from the layouts the server names) and who can put it right.
 */
function refusalWords(
  failure: Extract<ChangeoverFailure, { readonly lasting: true }>,
  sides: readonly { readonly configId: string; readonly title: string }[],
): string {
  const titles = [...new Set(sides.filter((side) => failure.configIds.includes(side.configId)).map((side) => side.title))];
  const whose = titles.length === 0 ? "one of these bookings" : titles.join(" and ");
  const many = titles.length > 1;
  switch (failure.reason) {
    case "unreadable":
      return `The approved ${many ? "sheets" : "sheet"} for ${whose} can’t be read, so what moves can’t be worked out. Ask the office to check ${many ? "them" : "it"}.`;
    case "removed":
      return `The layout for ${whose} has been removed, so what moves can’t be worked out. Ask the office which layout it uses now.`;
    case "rooms":
      return "The two layouts are for different rooms, so what moves can’t be worked out here.";
    case "no-access":
      return `This board can’t open the layout for ${whose}, so what moves can’t be worked out here.`;
    case "refused":
      return "What moves can’t be worked out for these two layouts.";
  }
}

function Group({ heading, lines }: {
  readonly heading: string;
  readonly lines: readonly { readonly key: string; readonly text: string; readonly where?: string | null }[];
}): ReactElement {
  return (
    <div className="dayboard-changeover-group">
      <h4 className="dayboard-changeover-heading">{heading}</h4>
      <ul>
        {lines.map((line) => (
          <li key={line.key}>
            {line.text}
            {line.where !== undefined && line.where !== null && <span className="dayboard-changeover-where"> · {line.where}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The move list, in the order the crew works it. */
export function ChangeoverList({ changeover, fromTitle, toTitle, sameLayoutAs = null }: {
  readonly changeover: Changeover;
  /** The bookings the room goes from and to, to say whose sheet lacks a plan. */
  readonly fromTitle: string;
  readonly toTitle: string;
  /** The booking before, when this one keeps its layout: the furniture stays,
   *  and only the dressing changes hands. */
  readonly sameLayoutAs?: string | null;
}): ReactElement {
  const furniture = changeover.items
    .filter((item) => !item.isAccessory)
    .map((item): Line => ({ item, split: changeoverSplit(item) }));
  const dressing = changeover.items.filter((item) => item.isAccessory && (item.before > 0 || item.after > 0));
  const toStore = furniture.filter((line) => line.split.toStore > 0);
  const fromStore = furniture.filter((line) => line.split.fromStore > 0);
  const stays = furniture.filter((line) => line.split.stays > 0);
  const plan = changeover.plan;
  const movedPieces = plan?.moved.reduce((sum, group) => sum + group.count, 0) ?? 0;
  // With no plan, the most it can say is which parts of the room change, and
  // only when both sides were placed in parts of the room the same way.
  const parts = plan === null && changeover.zonesCompared
    ? furniture.map((line) => ({ line, count: changingPart(line) })).filter((entry) => entry.count > 0)
    : [];
  const settled = toStore.length === 0 && fromStore.length === 0 && movedPieces === 0 && parts.length === 0;

  let settledWords: string | null = null;
  if (settled && sameLayoutAs !== null) {
    settledWords = dressing.length > 0
      ? `The same layout as ${sameLayoutAs}: the furniture stays as it is.`
      : `The same layout as ${sameLayoutAs}: nothing moves.`;
  } else if (settled) {
    if (plan === null) {
      settledWords = changeover.zonesCompared
        ? "Nothing goes to or from store, and nothing changes part of the room."
        : "Nothing goes to or from store.";
    } else if (dressing.length > 0) settledWords = "The furniture stays as it is.";
    else settledWords = "Nothing moves: the room is already set as the next booking needs it.";
  }

  return (
    <div className="dayboard-changeover-lists">
      {settledWords !== null && <p className="dayboard-changeover-note">{settledWords}</p>}
      {toStore.length > 0 && (
        <Group heading="Back to store" lines={toStore.map(({ item, split }) => ({ key: itemKey(item), text: counted(split.toStore, item.name) }))} />
      )}
      {fromStore.length > 0 && (
        <Group heading="Bring from store" lines={fromStore.map(({ item, split }) => ({ key: itemKey(item), text: counted(split.fromStore, item.name), where: whereTo(item) }))} />
      )}
      {parts.length > 0 && (
        <Group heading="To another part of the room" lines={parts.map(({ line, count }) => ({ key: itemKey(line.item), text: counted(count, line.item.name), where: whereTo(line.item) }))} />
      )}
      {!settled && stays.length > 0 && (
        <Group heading="Stays in the room" lines={stays.map(({ item, split }) => {
          // Of those staying, the plan may still move some within the room.
          const moving = Math.min(split.stays, movingOf(plan, item));
          return { key: itemKey(item), text: counted(split.stays, item.name), where: moving === 0 ? null : `${String(moving)} to move` };
        })} />
      )}
      {!settled && plan !== null && (movedPieces > 0 || plan.staysPut > 0) && (
        <p className="dayboard-changeover-plan">{planWords(plan, movedPieces)}</p>
      )}
      {plan === null && sameLayoutAs === null && <p className="dayboard-changeover-plan">{noPlanWords(changeover, fromTitle, toTitle)}</p>}
      {dressing.length > 0 && (
        <Group heading="Linen and dressing" lines={dressing.map((item) => ({ key: itemKey(item), text: dressingWords(item) }))} />
      )}
    </div>
  );
}

function joined(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** Where a hand may be, when not held to this room: one person is not in
 *  every room an event or the house turns at once. */
function rosteredWords(rostered: HandRostered): string {
  switch (rostered.kind) {
    case "room": return "";
    case "event": return ` (for ${rostered.eventName ?? "the event"}, any room)`;
    case "house": return " (whole house)";
  }
}

/** Setup shifts nobody fills, as a sentence: "Two more shifts are still to fill." */
function unfilledWords(unfilled: number, more: boolean, over: boolean): string {
  const one = unfilled === 1;
  const shifts = more ? (one ? "more shift" : "more shifts") : (one ? "setup shift" : "setup shifts");
  const state = over ? (one ? "was not filled" : "were not filled") : (one ? "is still to fill" : "are still to fill");
  return `${countWord(unfilled)} ${shifts} ${state}.`;
}

/** Who is on setup for the turn-round, from the published rota: each
 *  person's shifts as they are ("11:00–12:30 then 17:30–19:00"), and a hand
 *  rostered for an event or the whole house marked as such, since one person
 *  is not in every room. A turn-round that is over is told in the past. */
export function crewLine(crew: TurnRoundCrew, timeZone: string): string {
  const time = (ms: number): string => formatWallTime(ms, timeZone);
  const count = crew.hands.length;
  const open = crew.unfilled === 0 ? "" : ` ${unfilledWords(crew.unfilled, count > 0, crew.over)}`;
  if (count === 0) return `Nobody ${crew.over ? "was" : "is"} on setup for this turn-round.${open}`;
  const hand = (person: TurnRoundCrew["hands"][number]): string => {
    const spans = person.spans.map((span) => `${time(span.startsAtMs)}–${time(span.endsAtMs)}`).join(" then ");
    return `${person.name} ${spans}${rosteredWords(person.rostered)}`;
  };
  const lead = !crew.over ? "On setup" : count === 1 ? "Was on setup" : "Were on setup";
  return `${lead}: ${joined(crew.hands.map(hand))}.${open}`;
}

/** The panel's word on the crew: who is on, as last read (and when, if the
 *  rota could not be read since); the rota being read; or not read at all. */
function CrewWords({ crew, note, timeZone }: {
  readonly crew: CrewOnPanel | null;
  readonly note: string | null;
  readonly timeZone: string;
}): ReactElement | null {
  if (crew === null) return null;
  switch (crew.kind) {
    case "read":
      return <p className="dayboard-changeover-crew">{crewLine(crew.crew, timeZone)}{note === null ? "" : ` ${note}`}</p>;
    case "reading":
      return <p className="dayboard-changeover-crew"><ActivityStatus>Reading the rota…</ActivityStatus></p>;
    case "unread":
      return <p className="dayboard-changeover-crew">Who is on setup could not be read just now.</p>;
  }
}

/** Why one side has no single layout to compare, as a whole sentence. */
function noLayout(side: SlotSheetResult, title: string): string | null {
  const state = side.state;
  if (state === null) return null;
  switch (state.kind) {
    case "one": return null;
    case "many": return `${title} has more than one layout for this room, so what moves can’t be worked out here.`;
    case "no-layout": return `${title} has no layout for this room yet, so what moves can’t be worked out until it has one.`;
    case "no-event": return `${title} has no layout to compare.`;
  }
}

export function ChangeoverSection({ previous, slot, room, after, crew = null, crewNote = null, timeZone }: {
  readonly previous: DayBoardSlot;
  readonly slot: DayBoardSlot;
  readonly room: { readonly slug: string; readonly name: string };
  /** The open slot's own layouts, which the panel reads once for its sheet link too. */
  readonly after: SlotSheetResult;
  /** Who is on setup for the turn-round, when the rota plans setup; or,
   *  before the rota's first read lands, that it is being read or could not be. */
  readonly crew?: CrewOnPanel | null;
  /** When the crew was read, if the rota could not be read since. */
  readonly crewNote?: string | null;
  readonly timeZone: string;
}): ReactElement {
  const before = useSlotSheet(previous.eventId, room.slug, room.name, previous.kind);
  const [attempt, setAttempt] = useState(0);
  const from = before.state?.kind === "one" ? before.state.configurationId : null;
  const to = after.state?.kind === "one" ? after.state.configurationId : null;
  // One layout for two bookings of one event: the room is as that event left
  // it, dressing and all. Two events sharing a layout still change the linen.
  const sameEvent = previous.eventId !== null && previous.eventId === slot.eventId;
  const unchanged = from !== null && from === to && sameEvent;
  const changeover = useChangeover(unchanged ? null : from, to, attempt);
  const missing = noLayout(before, previous.title) ?? noLayout(after, slot.title);
  const sheetsFailed = before.status === "error" || after.status === "error";
  const failure = changeover?.status === "error" ? changeover.failure : null;
  const failed = sheetsFailed || failure !== null;
  // Try again leaves the page while it reads; focus waits on the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = (): void => {
    heading.current?.focus();
    if (before.status === "error") before.retry();
    if (after.status === "error") after.retry();
    if (failure !== null) setAttempt((count) => count + 1);
  };

  let body: ReactElement;
  if (before.status === "loading" || after.status === "loading" || changeover?.status === "loading") {
    body = <ActivityStatus>Working out what moves…</ActivityStatus>;
  } else if (!failed && missing !== null) {
    body = <p className="dayboard-changeover-note">{missing}</p>;
  } else if (!failed && unchanged) {
    body = <p className="dayboard-changeover-note">The same layout as {previous.title}: nothing moves.</p>;
  } else if (!failed && changeover?.status === "ready") {
    body = <ChangeoverList changeover={changeover.changeover} fromTitle={previous.title} toTitle={slot.title} sameLayoutAs={from === to ? previous.title : null} />;
  } else if (!sheetsFailed && failure?.lasting === true) {
    // Each layout once: a layout both bookings share is named as this one's.
    const sides = [
      ...(from === null || from === to ? [] : [{ configId: from, title: previous.title }]),
      ...(to === null ? [] : [{ configId: to, title: slot.title }]),
    ];
    body = <p className="dayboard-changeover-note">{refusalWords(failure, sides)}</p>;
  } else {
    body = (
      <div className="dayboard-changeover-failed">
        <p className="dayboard-changeover-note">What moves could not be worked out just now.</p>
        <button type="button" className="dayboard-seen-button" onClick={retry} aria-label="Try again to work out what moves">Try again</button>
      </div>
    );
  }
  return (
    <section className="dayboard-changeover dayboard-detail-section" aria-label={`Changeover from ${previous.title}`}>
      <h3 className="dayboard-detail-heading" ref={heading} tabIndex={-1}>Changeover</h3>
      <p className="dayboard-changeover-from">From {previous.title}</p>
      <CrewWords crew={crew} note={crewNote} timeZone={timeZone} />
      {body}
    </section>
  );
}
