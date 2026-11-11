import { useEffect, useState, type ReactElement } from "react";
import { changeoverSplit, type Changeover, type ChangeoverItem, type ChangeoverPlanGroup } from "@omnitwin/types";
import { getChangeover } from "../../api/changeover.js";
import { ActivityStatus } from "../../components/shared/Activity.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import { useSlotSheet, type SlotSheetResult } from "./lib/use-slot-sheet.js";

// ---------------------------------------------------------------------------
// What moves at a changeover: from the layout the booking before leaves in
// the room to the layout this booking needs. Three short lists the crew can
// work from (back to store, bring from store, stays) and a line from the plan
// for what moves within the room. Built from the two sheets the floor already
// reads (api lib/changeover.ts); when either booking has no single layout for
// the room, it says so rather than guess.
// ---------------------------------------------------------------------------

type ChangeoverResult =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly changeover: Changeover }
  | { readonly status: "error" };

function useChangeover(from: string | null, to: string | null, fromEventId: string | null, toEventId: string | null): ChangeoverResult | null {
  const [result, setResult] = useState<{ readonly key: string; readonly value: ChangeoverResult } | null>(null);
  const key = `${from ?? ""}>${to ?? ""}`;
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

/** Where pieces new to the room go: the zones that gain them. */
function whereTo(item: ChangeoverItem): string | null {
  const zones = item.zones.filter((zone) => zone.after > zone.before).map((zone) => zone.zone);
  return zones.length === 0 ? null : zones.join(", ");
}

function pieces(groups: readonly ChangeoverPlanGroup[]): string {
  const words = groups.map((group) => counted(group.count, group.name));
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** The move list, in the order the crew works it. */
export function ChangeoverList({ changeover }: { readonly changeover: Changeover }): ReactElement {
  const lines = changeover.items.map((item) => ({ item, split: changeoverSplit(item) }));
  const toStore = lines.filter((line) => line.split.toStore > 0);
  const fromStore = lines.filter((line) => line.split.fromStore > 0);
  const stays = lines.filter((line) => line.split.stays > 0);
  const plan = changeover.plan;
  const movedPieces = plan?.moved.reduce((sum, group) => sum + group.count, 0) ?? 0;
  if (toStore.length === 0 && fromStore.length === 0 && movedPieces === 0) {
    return <p className="dayboard-changeover-note">Nothing moves: the room is already set as the next booking needs it.</p>;
  }
  return (
    <div className="dayboard-changeover-lists">
      {toStore.length > 0 && (
        <div className="dayboard-changeover-group">
          <h4 className="dayboard-changeover-heading">Back to store</h4>
          <ul>{toStore.map(({ item, split }) => <li key={`${item.category}\u0000${item.name}`}>{counted(split.toStore, item.name)}</li>)}</ul>
        </div>
      )}
      {fromStore.length > 0 && (
        <div className="dayboard-changeover-group">
          <h4 className="dayboard-changeover-heading">Bring from store</h4>
          <ul>
            {fromStore.map(({ item, split }) => {
              const where = whereTo(item);
              return (
                <li key={`${item.category}\u0000${item.name}`}>
                  {counted(split.fromStore, item.name)}
                  {where !== null && <span className="dayboard-changeover-where"> · {where}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {stays.length > 0 && (
        <div className="dayboard-changeover-group">
          <h4 className="dayboard-changeover-heading">Stays</h4>
          <ul>{stays.map(({ item, split }) => <li key={`${item.category}\u0000${item.name}`}>{counted(split.stays, item.name)}</li>)}</ul>
        </div>
      )}
      {plan !== null && (movedPieces > 0 || plan.staysPut > 0) && (
        <p className="dayboard-changeover-plan">
          On the plan: {plan.staysPut === 1 ? "1 piece stays where it is" : `${String(plan.staysPut)} pieces stay where they are`}
          {movedPieces > 0 ? `; ${pieces(plan.moved)} ${movedPieces === 1 ? "moves" : "move"} within the room.` : "."}
        </p>
      )}
    </div>
  );
}

/** Why one side has no single layout to compare, in the floor's words. */
function noLayout(side: SlotSheetResult, title: string): string | null {
  const state = side.state;
  if (side.status === "error") return "The layouts could not be checked.";
  if (state === null) return null;
  switch (state.kind) {
    case "one": return null;
    case "many": return `${title} has more than one layout for this room; open its sheets to choose.`;
    case "no-event":
    case "no-layout": return `${title} has no layout for this room yet.`;
  }
}

export function ChangeoverSection({ previous, slot, room }: {
  readonly previous: DayBoardSlot;
  readonly slot: DayBoardSlot;
  readonly room: { readonly slug: string; readonly name: string };
}): ReactElement {
  const before = useSlotSheet(previous.eventId, room.slug, room.name, previous.kind);
  const after = useSlotSheet(slot.eventId, room.slug, room.name, slot.kind);
  const from = before.state?.kind === "one" ? before.state.configurationId : null;
  const to = after.state?.kind === "one" ? after.state.configurationId : null;
  const changeover = useChangeover(from, to, previous.eventId, slot.eventId);
  const missing = noLayout(before, previous.title) ?? noLayout(after, slot.title);

  let body: ReactElement;
  if (before.status === "loading" || after.status === "loading" || changeover?.status === "loading") {
    body = <ActivityStatus>Working out what moves…</ActivityStatus>;
  } else if (missing !== null) {
    body = <p className="dayboard-changeover-note">{missing} What moves can’t be worked out until it has one.</p>;
  } else if (from !== null && from === to) {
    body = <p className="dayboard-changeover-note">The same layout as {previous.title}: nothing moves.</p>;
  } else if (changeover?.status === "ready") {
    body = <ChangeoverList changeover={changeover.changeover} />;
  } else {
    body = <p className="dayboard-changeover-note">What moves could not be worked out just now.</p>;
  }
  return (
    <section className="dayboard-changeover dayboard-detail-section" aria-label={`Changeover from ${previous.title}`}>
      <h3 className="dayboard-detail-heading">Changeover</h3>
      <p className="dayboard-changeover-from">From {previous.title}</p>
      {body}
    </section>
  );
}
