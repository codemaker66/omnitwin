import { useMemo, useState, type ReactElement } from "react";
import type { Action } from "@omnitwin/types";
import type { AuditLogEntry } from "../../api/action-log.js";
import { replayActions, verifyReplayable, type ReplayObject } from "../../lib/action-log-replay.js";
import { deriveBaseFromLive, documentAtOrdinal, planRestore, timelineMarkers } from "../../lib/time-machine.js";
import { plannerActionContext } from "../../stores/planner-action-log.js";
import "./time-machine-panel.css";

// ---------------------------------------------------------------------------
// TimeMachinePanel — travel the layout's recorded history.
//
// Scrub the trail; the plan redraws as the room stood at that moment. This is
// deep undo, version restore and replay in one surface, because the audit
// trail holds every mutation and its inverse (see lib/time-machine.ts).
//
// Claim safety: the clock shown is the operator's device time AS RECORDED,
// never presented as server-verified; the restore line states plainly that
// restoring APPENDS a reversible change rather than erasing history; and the
// mini plan is labelled indicative geometry, not a measured drawing.
// ---------------------------------------------------------------------------

export interface TimeMachinePanelProps {
  readonly entries: readonly AuditLogEntry[];
  /** The room as it stands NOW. Supplying it lets the panel reverse-replay
   *  the trail to recover what the layout was loaded with — without it, a
   *  reopened layout reconstructs missing all its pre-existing furniture,
   *  because loadConfiguration records no Action for the objects it loads. */
  readonly live?: readonly ReplayObject[];
  /** False when `entries` is only a PAGE of the trail. The anchor is then
   *  derived from the oldest changes we hold while `live` reflects all of
   *  them, so every reconstruction is off by the missing tail — the panel
   *  says so and withdraws restore rather than offering a wrong one.
   *  Defaults to true: a caller holding the whole trail needs no ceremony. */
  readonly trailComplete?: boolean;
  /** Called with the restore Action to append. Absent = preview only. */
  readonly onRestore?: (action: Action) => void;
}

/** Metres-to-percent for the top-down mini plan. Indicative geometry for
 *  orientation only — never a measured drawing. */
const PLAN_SPAN_M = 24;

function planPosition(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(96, Math.max(2, ((n + PLAN_SPAN_M / 2) / PLAN_SPAN_M) * 100));
}

/** Silhouette class from the recorded kind — a dancefloor must not read as a
 *  dining table. Unknown kinds fall back to the neutral disc. */
function kindClass(kind: unknown): string {
  const raw = typeof kind === "string" ? kind : "";
  if (raw.includes("top-table")) return "top-table";
  if (raw.includes("dancefloor")) return "dancefloor";
  if (raw.includes("chair")) return "chair";
  return "generic";
}

interface TouchedAtEntry {
  /** Objects present in the reconstruction that this gesture added or edited. */
  readonly changed: ReadonlySet<string>;
  /** Objects this gesture REMOVED. They are absent from the reconstruction at
   *  this point by definition, so they cannot be highlighted — they are drawn
   *  as ghosts where they stood. Without this the deletion, which is usually
   *  the very change an operator is hunting for, is the one change the plan
   *  cannot show at all. */
  readonly removed: readonly ReplayObject[];
}

/** What this single entry actually did — what changed HERE. */
function touchedByEntry(entry: AuditLogEntry | undefined): TouchedAtEntry {
  const changed = new Set<string>();
  const removed: ReplayObject[] = [];
  if (entry === undefined) return { changed, removed };
  const payload = entry.payload as {
    added?: readonly { object?: Record<string, unknown> }[];
    removed?: readonly { object?: Record<string, unknown> }[];
    updated?: readonly { id?: unknown }[];
  } | null;
  if (payload === null || typeof payload !== "object") return { changed, removed };
  for (const placed of payload.added ?? []) {
    const id = placed.object?.id;
    if (typeof id === "string") changed.add(id);
  }
  for (const patch of payload.updated ?? []) {
    if (typeof patch.id === "string") changed.add(patch.id);
  }
  for (const placed of payload.removed ?? []) {
    const object = placed.object;
    if (object === undefined) continue;
    const id = object.id;
    // Rebuilt rather than asserted: spreading a Record<string, unknown> with a
    // narrowed id satisfies ReplayObject structurally, so no cast is needed.
    if (typeof id === "string") removed.push({ ...object, id });
  }
  return { changed, removed };
}

/** Plain-language names for the surfaces a furniture plan does not draw. */
const SURFACE_NAMES: Record<string, string> = {
  markup: "markup",
  lighting: "lighting",
  event: "event details",
  object: "object note",
  layout: "layout",
};

/** "2 markup and 1 lighting change" — from the replayer's own skipped tally,
 *  so the sentence can never drift from what was actually left out. */
function describeSkipped(skipped: readonly { readonly intent: string; readonly count: number }[]): string {
  const bySurface = new Map<string, number>();
  for (const item of skipped) {
    const surface = SURFACE_NAMES[item.intent.split(".")[0] ?? ""] ?? "other";
    bySurface.set(surface, (bySurface.get(surface) ?? 0) + item.count);
  }
  const parts = [...bySurface.entries()].map(
    ([surface, count]) => `${String(count)} ${surface} change${count === 1 ? "" : "s"}`,
  );
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

export function TimeMachinePanel({
  entries,
  live,
  trailComplete = true,
  onRestore,
}: TimeMachinePanelProps): ReactElement {
  const markers = useMemo(() => timelineMarkers(entries), [entries]);
  // Markers are newest-first; the scrubber reads left-to-right as oldest to
  // newest, so slider index 0 is the OLDEST recorded point.
  const oldestFirst = useMemo(() => [...markers].reverse(), [markers]);
  const [index, setIndex] = useState<number | null>(null);

  const lastIndex = Math.max(0, oldestFirst.length - 1);
  const clamped = index === null ? lastIndex : Math.min(index, lastIndex);
  const selected = oldestFirst[clamped];
  const latest = oldestFirst[lastIndex];

  // Anchor the trail: reverse-replay the live room to recover what the
  // layout was loaded with, so a reopened configuration reconstructs its
  // pre-existing furniture instead of an empty floor.
  const anchor = useMemo(
    () => (live === undefined ? null : deriveBaseFromLive(live, entries)),
    [live, entries],
  );
  const base = anchor?.base ?? [];

  const at = useMemo(
    () => documentAtOrdinal(entries, selected?.ordinal ?? 0, base),
    [entries, selected?.ordinal, base],
  );
  const newest = useMemo(
    () => documentAtOrdinal(entries, latest?.ordinal ?? 0, base),
    [entries, latest?.ordinal, base],
  );

  const touched = useMemo(
    () => touchedByEntry(entries.find((candidate) => candidate.ordinal === selected?.ordinal)),
    [entries, selected?.ordinal],
  );

  // What this reconstruction covers, in the replayer's own numbers. Both were
  // already computed on every render and thrown away; a plan that silently
  // omits the markup and lighting in the same trail is a claim, not a drawing.
  const coverage = useMemo(() => {
    const drawn = replayActions(entries, base).applied;
    const omitted = describeSkipped(replayActions(entries, base).skipped);
    const unreadable = verifyReplayable(entries).issues.length;
    return { drawn, omitted, unreadable };
  }, [entries, base]);

  const restore = useMemo(() => {
    // A partial trail anchors against a live room that reflects changes we do
    // not hold, so any restore computed here would move the room somewhere
    // nobody asked for. Offer nothing rather than something wrong.
    if (selected === undefined || !trailComplete || anchor?.exact === false) return null;
    return planRestore(newest.objects, at.objects, plannerActionContext(), {
      targetOrdinal: selected.ordinal,
    });
  }, [newest.objects, at.objects, selected, trailComplete, anchor?.exact]);

  const restoreSummary = useMemo(() => {
    if (restore === null) return null;
    const payload = restore.payload as {
      added?: readonly unknown[];
      removed?: readonly unknown[];
      updated?: readonly unknown[];
    };
    const parts: string[] = [];
    const back = payload.added?.length ?? 0;
    const gone = payload.removed?.length ?? 0;
    const moved = payload.updated?.length ?? 0;
    if (back > 0) parts.push(`${String(back)} back`);
    if (gone > 0) parts.push(`${String(gone)} removed`);
    if (moved > 0) parts.push(`${String(moved)} moved`);
    return parts.join(" · ");
  }, [restore]);

  if (oldestFirst.length === 0) {
    return (
      <section className="tm" data-testid="time-machine-panel">
        <header className="tm__head">
          <span className="tm__eyebrow">Time machine</span>
          <h3 className="tm__title">No recorded history yet</h3>
        </header>
        <p className="tm__note">
          Once edits are saved, every change becomes a point you can travel back to.
        </p>
      </section>
    );
  }

  return (
    <section className="tm" data-testid="time-machine-panel">
      <header className="tm__head">
        <span className="tm__eyebrow">Time machine</span>
        <h3 className="tm__title">{selected?.title ?? "—"}</h3>
        <p className="tm__meta" data-testid="tm-when">
          {selected?.actorLabel} · {selected?.when}
          <span className="tm__note-inline"> ({selected?.whenNote})</span>
        </p>
      </header>

      {anchor?.exact === false ? (
        <p className="tm__warn" data-testid="tm-anchor-warning">
          {anchor.reason ?? "The room this trail started from cannot be recovered."}
          {" "}Nothing is drawn for this moment — a plan the record cannot
          support would be more misleading than no plan.
        </p>
      ) : (
        <div className="tm__plan" data-testid="tm-plan" aria-label="Top-down plan at the selected moment">
          {at.objects.map((object) => (
            <span
              key={object.id}
              className={[
                "tm__object",
                `tm__object--${kindClass(object.kind)}`,
                touched.changed.has(object.id) ? "tm__object--touched" : "",
              ].filter((part) => part !== "").join(" ")}
              data-testid="tm-object"
              data-kind={kindClass(object.kind)}
              data-touched={touched.changed.has(object.id) ? "true" : "false"}
              style={{
                left: `${String(planPosition(object.positionX))}%`,
                top: `${String(planPosition(object.positionZ))}%`,
              }}
              title={typeof object.kind === "string" ? object.kind : object.id}
            />
          ))}
          {/* Removed objects are gone from the reconstruction by definition,
              so they are ghosted where they stood — otherwise a deletion is
              the one change the plan cannot show. */}
          {touched.removed.map((object) => (
            <span
              key={`removed-${object.id}`}
              className={`tm__object tm__object--${kindClass(object.kind)} tm__object--removed`}
              data-testid="tm-object-removed"
              data-kind={kindClass(object.kind)}
              style={{
                left: `${String(planPosition(object.positionX))}%`,
                top: `${String(planPosition(object.positionZ))}%`,
              }}
              title={`Removed here: ${typeof object.kind === "string" ? object.kind : object.id}`}
            />
          ))}
          {at.objects.length === 0 && touched.removed.length === 0 && (
            <span className="tm__empty">Empty room</span>
          )}
        </div>
      )}

      {touched.removed.length > 0 && (
        <p className="tm__note" data-testid="tm-removed">
          {touched.removed.length === 1
            ? "1 object removed here — ghosted where it stood."
            : `${String(touched.removed.length)} objects removed here — ghosted where they stood.`}
        </p>
      )}

      <label className="tm__scrub">
        <span className="tm__scrub-label">
          Change {String(clamped + 1)} of {String(oldestFirst.length)}
        </span>
        <input
          type="range"
          min={0}
          max={lastIndex}
          value={clamped}
          data-testid="tm-scrubber"
          onChange={(event) => { setIndex(Number.parseInt(event.target.value, 10)); }}
        />
      </label>

      <footer className="tm__foot">
        {/* The coverage statement. A furniture plan draws furniture changes;
            markup, lighting and event edits are recorded in the same trail and
            are not drawn. Saying which, with the replayer's own tallies, is
            what separates a drawing from a claim. */}
        <p className="tm__note" data-testid="tm-coverage">
          This plan is rebuilt from {String(coverage.drawn)} recorded furniture
          change{coverage.drawn === 1 ? "" : "s"}.
          {coverage.omitted !== "" && ` Also recorded, but not drawn here: ${coverage.omitted}.`}
          {coverage.unreadable > 0
            && ` ${String(coverage.unreadable)} record${coverage.unreadable === 1 ? "" : "s"} could not be read back.`}
        </p>

        {!trailComplete && (
          <p className="tm__warn" data-testid="tm-truncated">
            Earlier changes are not loaded, so this reconstruction starts
            partway through the trail. Restoring stays unavailable until the
            whole trail is held.
          </p>
        )}

        {trailComplete && anchor?.exact !== false && (
          restore === null ? (
            <p className="tm__note" data-testid="tm-restore-state">
              This is the current layout.
            </p>
          ) : (
            <>
              <p className="tm__note" data-testid="tm-restore-state">
                Restoring appends a reversible change ({restoreSummary}) — it never erases history.
              </p>
              {onRestore !== undefined && (
                <button
                  type="button"
                  className="tm__restore"
                  data-testid="tm-restore"
                  onClick={() => { onRestore(restore); }}
                >
                  Restore the room to this moment
                </button>
              )}
            </>
          )
        )}
      </footer>
    </section>
  );
}
