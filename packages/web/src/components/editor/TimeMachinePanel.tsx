import { useMemo, useState, type ReactElement } from "react";
import type { Action } from "@omnitwin/types";
import type { AuditLogEntry } from "../../api/action-log.js";
import { documentAtOrdinal, planRestore, timelineMarkers } from "../../lib/time-machine.js";
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

/** The object ids this single entry actually touched — what changed HERE. */
function touchedByEntry(entry: AuditLogEntry | undefined): ReadonlySet<string> {
  if (entry === undefined) return new Set();
  const payload = entry.payload as {
    added?: readonly { object?: { id?: unknown } }[];
    removed?: readonly { object?: { id?: unknown } }[];
    updated?: readonly { id?: unknown }[];
  } | null;
  if (payload === null || typeof payload !== "object") return new Set();
  const ids = new Set<string>();
  for (const placed of payload.added ?? []) {
    if (typeof placed.object?.id === "string") ids.add(placed.object.id);
  }
  for (const patch of payload.updated ?? []) {
    if (typeof patch.id === "string") ids.add(patch.id);
  }
  return ids;
}

export function TimeMachinePanel({ entries, onRestore }: TimeMachinePanelProps): ReactElement {
  const markers = useMemo(() => timelineMarkers(entries), [entries]);
  // Markers are newest-first; the scrubber reads left-to-right as oldest to
  // newest, so slider index 0 is the OLDEST recorded point.
  const oldestFirst = useMemo(() => [...markers].reverse(), [markers]);
  const [index, setIndex] = useState<number | null>(null);

  const lastIndex = Math.max(0, oldestFirst.length - 1);
  const clamped = index === null ? lastIndex : Math.min(index, lastIndex);
  const selected = oldestFirst[clamped];
  const latest = oldestFirst[lastIndex];

  const at = useMemo(
    () => documentAtOrdinal(entries, selected?.ordinal ?? 0),
    [entries, selected?.ordinal],
  );
  const live = useMemo(
    () => documentAtOrdinal(entries, latest?.ordinal ?? 0),
    [entries, latest?.ordinal],
  );

  const touchedIds = useMemo(
    () => touchedByEntry(entries.find((candidate) => candidate.ordinal === selected?.ordinal)),
    [entries, selected?.ordinal],
  );

  const restore = useMemo(() => {
    if (selected === undefined) return null;
    return planRestore(live.objects, at.objects, plannerActionContext(), {
      targetOrdinal: selected.ordinal,
    });
  }, [live.objects, at.objects, selected]);

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

      <div className="tm__plan" data-testid="tm-plan" aria-label="Top-down plan at the selected moment">
        {at.objects.map((object) => (
          <span
            key={object.id}
            className={[
              "tm__object",
              `tm__object--${kindClass(object.kind)}`,
              touchedIds.has(object.id) ? "tm__object--touched" : "",
            ].filter((part) => part !== "").join(" ")}
            data-testid="tm-object"
            data-kind={kindClass(object.kind)}
            data-touched={touchedIds.has(object.id) ? "true" : "false"}
            style={{
              left: `${String(planPosition(object.positionX))}%`,
              top: `${String(planPosition(object.positionZ))}%`,
            }}
            title={String(object.kind ?? object.id)}
          />
        ))}
        {at.objects.length === 0 && <span className="tm__empty">Empty room</span>}
      </div>

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
        {restore === null ? (
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
        )}
        {at.issues.length > 0 && (
          <p className="tm__warn" data-testid="tm-issues">
            {String(at.issues.length)} point(s) in the trail could not be replayed exactly.
          </p>
        )}
      </footer>
    </section>
  );
}
