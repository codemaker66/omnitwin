import { useEffect, useState, type ReactElement } from "react";
import { changeoverSplit, type Changeover, type ChangeoverItem, type ChangeoverPlanGroup } from "@omnitwin/types";
import { getChangeover } from "../../api/changeover.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import { formatWallTime } from "../diary/lib/board-time.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import type { TurnRoundCrew } from "./lib/turn-round-crew.js";
import { useSlotSheet, type SlotSheetResult } from "./lib/use-slot-sheet.js";

// ---------------------------------------------------------------------------
// What moves at a changeover: from the layout the booking before leaves in
// the room to the layout this booking needs. Short lists the crew can work
// from (back to store, bring from store, stays), a line from the plan for
// what moves within the room, and the dressing each booking lays. Built from
// the two sheets the floor already reads (api lib/changeover.ts); when either
// booking has no single layout for the room, it says so rather than guess.
//
// Dressing (the tables' linen) belongs to its booking: what the room had is
// cleared and what the next booking needs is laid, so a cloth is never
// listed as staying for a different function. Who is on setup for the
// turn-round comes first, from the published rota (lib/turn-round-crew.ts).
// ---------------------------------------------------------------------------

type ChangeoverResult =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly changeover: Changeover }
  | { readonly status: "error" };

function useChangeover(
  from: string | null,
  to: string | null,
  fromEventId: string | null,
  toEventId: string | null,
  attempt: number,
): ChangeoverResult | null {
  const [result, setResult] = useState<{ readonly key: string; readonly value: ChangeoverResult } | null>(null);
  const key = `${from ?? ""}>${to ?? ""}#${String(attempt)}`;
  useEffect(() => {
    if (from === null || to === null || from === to) return;
    const reading = new AbortController();
    setResult({ key, value: { status: "loading" } });
    getChangeover({ from, to, fromEventId, toEventId }, reading.signal)
      .then((changeover) => { if (!reading.signal.aborted) setResult({ key, value: { status: "ready", changeover } }); })
      .catch(() => { if (!reading.signal.aborted) setResult({ key, value: { status: "error" } }); });
    return () => { reading.abort(); };
  }, [from, to, fromEventId, toEventId, key]);
  if (from === null || to === null || from === to) return null;
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

/** Which sheet has no plan to compare piece by piece, in the floor's words. */
function noPlanWords(changeover: Changeover, fromTitle: string, toTitle: string): string {
  const missing = [changeover.from.hasPlan ? null : fromTitle, changeover.to.hasPlan ? null : toTitle]
    .filter((title): title is string => title !== null);
  const why = missing.length === 2
    ? "Neither sheet has a plan"
    : missing.length === 1 ? `The sheet for ${missing[0] ?? ""} has no plan` : "The plans can’t be compared";
  return `${why}, so moves within each part of the room aren’t shown.`;
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
export function ChangeoverList({ changeover, fromTitle, toTitle }: {
  readonly changeover: Changeover;
  /** The bookings the room goes from and to, to say whose sheet lacks a plan. */
  readonly fromTitle: string;
  readonly toTitle: string;
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
  // With no plan, the most it can say is which parts of the room change.
  const parts = plan === null
    ? furniture.map((line) => ({ line, count: changingPart(line) })).filter((entry) => entry.count > 0)
    : [];
  const settled = toStore.length === 0 && fromStore.length === 0 && movedPieces === 0 && parts.length === 0;

  let settledWords: string | null = null;
  if (settled) {
    if (plan === null) settledWords = "Nothing goes to or from store, and nothing changes part of the room.";
    else if (dressing.length > 0) settledWords = "The furniture stays as it is.";
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
        <Group heading="Stays" lines={stays.map(({ item, split }) => ({ key: itemKey(item), text: counted(split.stays, item.name) }))} />
      )}
      {!settled && plan !== null && (movedPieces > 0 || plan.staysPut > 0) && (
        <p className="dayboard-changeover-plan">
          On the plan: {plan.staysPut === 1 ? "1 piece stays where it is" : `${String(plan.staysPut)} pieces stay where they are`}
          {movedPieces > 0 ? `; ${pieces(plan.moved)} ${movedPieces === 1 ? "moves" : "move"} within the room.` : "."}
        </p>
      )}
      {plan === null && <p className="dayboard-changeover-plan">{noPlanWords(changeover, fromTitle, toTitle)}</p>}
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

/** Who is on setup for the turn-round, from the published rota. */
export function crewLine(crew: TurnRoundCrew, timeZone: string): string {
  const time = (ms: number): string => formatWallTime(ms, timeZone);
  const open = crew.unfilled === 0 ? "" : crew.hands.length === 0
    ? ` ${crew.unfilled === 1 ? "One setup shift is" : `${String(crew.unfilled)} setup shifts are`} still to fill.`
    : ` ${crew.unfilled === 1 ? "One more shift is" : `${String(crew.unfilled)} more shifts are`} still to fill.`;
  if (crew.hands.length === 0) return `Nobody is on setup for this turn-round.${open}`;
  return `On setup: ${joined(crew.hands.map((hand) => `${hand.name} ${time(hand.startsAtMs)}–${time(hand.endsAtMs)}`))}.${open}`;
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

export function ChangeoverSection({ previous, slot, room, after, crew = null, timeZone }: {
  readonly previous: DayBoardSlot;
  readonly slot: DayBoardSlot;
  readonly room: { readonly slug: string; readonly name: string };
  /** The open slot's own layouts, which the panel reads once for its sheet link too. */
  readonly after: SlotSheetResult;
  /** Who is on setup for the turn-round, when the rota plans setup. */
  readonly crew?: TurnRoundCrew | null;
  readonly timeZone: string;
}): ReactElement {
  const before = useSlotSheet(previous.eventId, room.slug, room.name, previous.kind);
  const [attempt, setAttempt] = useState(0);
  const from = before.state?.kind === "one" ? before.state.configurationId : null;
  const to = after.state?.kind === "one" ? after.state.configurationId : null;
  const changeover = useChangeover(from, to, previous.eventId, slot.eventId, attempt);
  const missing = noLayout(before, previous.title) ?? noLayout(after, slot.title);
  const failed = before.status === "error" || after.status === "error" || changeover?.status === "error";
  const retry = (): void => {
    if (before.status === "error") before.retry();
    if (after.status === "error") after.retry();
    if (changeover?.status === "error") setAttempt((count) => count + 1);
  };

  let body: ReactElement;
  if (before.status === "loading" || after.status === "loading" || changeover?.status === "loading") {
    body = <ActivityStatus>Working out what moves…</ActivityStatus>;
  } else if (!failed && missing !== null) {
    body = <p className="dayboard-changeover-note">{missing}</p>;
  } else if (!failed && from !== null && from === to) {
    body = <p className="dayboard-changeover-note">The same layout as {previous.title}: nothing moves.</p>;
  } else if (!failed && changeover?.status === "ready") {
    body = <ChangeoverList changeover={changeover.changeover} fromTitle={previous.title} toTitle={slot.title} />;
  } else {
    body = (
      <div className="dayboard-changeover-failed">
        <p className="dayboard-changeover-note">What moves could not be worked out just now.</p>
        <button type="button" className="dayboard-seen-button" onClick={retry}>Try again</button>
      </div>
    );
  }
  return (
    <section className="dayboard-changeover dayboard-detail-section" aria-label={`Changeover from ${previous.title}`}>
      <h3 className="dayboard-detail-heading">Changeover</h3>
      <p className="dayboard-changeover-from">From {previous.title}</p>
      {crew !== null && <p className="dayboard-changeover-crew">{crewLine(crew, timeZone)}</p>}
      {body}
    </section>
  );
}
