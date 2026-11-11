import { useId, useState, type ReactElement } from "react";
import type { BuildingCheck, BuildingCheckKind } from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { formatWallTime, msToWallInput } from "../diary/lib/board-time.js";
import type { BuildingDay, BuildingMoment } from "./lib/building-day.js";
import type { BuildingChecksApi } from "./lib/use-building-checks.js";

// ---------------------------------------------------------------------------
// The building (T-693): when it must be open and when it can be locked up,
// from the day's own bookings and suppliers, and the venue's own checks for
// each, ticked by the floor with who and when. At lock-up it names whoever is
// still in. The lists are the venue's words, kept by its administrators: a
// building with none says so rather than offering an invented list.
// ---------------------------------------------------------------------------

const KIND_WORDS: Readonly<Record<BuildingCheckKind, { readonly title: string; readonly short: string }>> = {
  opening: { title: "Opening checks", short: "opening" },
  lockup: { title: "Lock-up checks", short: "lock-up" },
};

function done(list: readonly BuildingCheck[]): number {
  return list.filter((check) => check.mark !== null).length;
}

/** "07:00", or "01:00, after midnight" when it falls past the board's date. */
function momentTime(moment: BuildingMoment, boardDate: string, timeZone: string): string {
  const date = msToWallInput(moment.atMs, timeZone).slice(0, 10);
  return `${formatWallTime(moment.atMs, timeZone)}${date > boardDate ? ", after midnight" : ""}`;
}

function ListEditor({ kind, checks, busy, onSave, onCancel }: {
  readonly kind: BuildingCheckKind;
  readonly checks: readonly BuildingCheck[];
  readonly busy: boolean;
  readonly onSave: (items: readonly { readonly id?: string; readonly label: string }[]) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const id = useId();
  const [items, setItems] = useState<readonly { readonly key: string; readonly id?: string; readonly label: string }[]>(
    () => checks.filter((check) => !check.retired).map((check) => ({ key: check.id, id: check.id, label: check.label })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const move = (index: number, by: number): void => {
    setItems((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(index + by, 0, item);
      return next;
    });
  };
  const words = KIND_WORDS[kind];
  return (
    <form
      className="dayboard-checks-editor"
      aria-label={`Change the ${words.short} checks`}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (items.some((item) => item.label.trim().length === 0)) {
          setProblem("Write each check, or take it off.");
          return;
        }
        setProblem(null);
        onSave(items.map((item) => (item.id === undefined ? { label: item.label.trim() } : { id: item.id, label: item.label.trim() })));
      }}
    >
      <ol>
        {items.map((item, index) => (
          <li key={item.key}>
            <input
              aria-label={`${words.title}, ${String(index + 1)}`}
              value={item.label}
              maxLength={200}
              onChange={(event) => { const label = event.target.value; setItems((current) => current.map((other) => (other.key === item.key ? { ...other, label } : other))); }}
            />
            <button type="button" className="dayboard-button" aria-label={`Move “${item.label}” up`} disabled={index === 0} onClick={() => { move(index, -1); }}>↑</button>
            <button type="button" className="dayboard-button" aria-label={`Move “${item.label}” down`} disabled={index === items.length - 1} onClick={() => { move(index, 1); }}>↓</button>
            <button type="button" className="dayboard-button" aria-label={`Take “${item.label}” off`} onClick={() => { setItems((current) => current.filter((other) => other.key !== item.key)); }}>Take off</button>
          </li>
        ))}
      </ol>
      <button type="button" className="dayboard-button" onClick={() => { setItems((current) => [...current, { key: `${id}-${String(current.length)}-${String(Date.now())}`, label: "" }]); }}>Add a check</button>
      {problem !== null && <p className="dayboard-checks-problem" role="status">{problem}</p>}
      <div className="dayboard-checks-editor-actions">
        <button type="submit" className="dayboard-button is-primary" aria-busy={busy} aria-disabled={busy}>
          {busy && <ActivityIndicator size={14} />}Save the list
        </button>
        <button type="button" className="dayboard-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChecksList({ kind, checks, timeZone, canTick, canPlan, api, stillIn }: {
  readonly kind: BuildingCheckKind;
  readonly checks: readonly BuildingCheck[];
  readonly timeZone: string;
  readonly canTick: boolean;
  readonly canPlan: boolean;
  readonly api: BuildingChecksApi;
  readonly stillIn?: string | null;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const words = KIND_WORDS[kind];
  const current = checks.filter((check) => !check.retired);
  return (
    <div className="dayboard-checks" role="group" aria-label={words.title}>
      <h3 className="dayboard-checks-title">
        {words.title}
        {current.length > 0 && <span className="dayboard-checks-count"> {done(current)} of {current.length}</span>}
      </h3>
      {stillIn !== undefined && stillIn !== null && <p className="dayboard-checks-still-in">{stillIn}</p>}
      {editing ? (
        <ListEditor
          kind={kind}
          checks={checks}
          busy={api.busy.has(`list:${kind}`)}
          onSave={(items) => { void api.replace(kind, items).then((saved) => { if (saved) setEditing(false); }); }}
          onCancel={() => { setEditing(false); }}
        />
      ) : (
        <>
          {checks.length === 0 ? (
            <p className="dayboard-checks-none">
              {canPlan ? `No ${words.short} checks yet. Write the building’s own.` : `No ${words.short} checks are set up. The office can write the building’s own.`}
            </p>
          ) : (
            <ul className="dayboard-checks-list">
              {checks.map((check) => {
                const busy = api.busy.has(check.id);
                return (
                  <li key={check.id} className={check.mark === null ? undefined : "is-done"}>
                    <label>
                      <input
                        type="checkbox"
                        checked={check.mark !== null}
                        disabled={!canTick || check.retired}
                        aria-busy={busy}
                        onChange={(event) => { if (!busy) void api.tick(check, event.target.checked); }}
                      />
                      <span className="dayboard-checks-label">{check.label}{check.retired ? " (since taken off the list)" : ""}</span>
                    </label>
                    {busy && <ActivityIndicator size={14} />}
                    {check.mark !== null && (
                      <span className="dayboard-checks-who">{check.mark.doneByName} · {formatWallTime(Date.parse(check.mark.doneAt), timeZone)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canPlan && (
            <button type="button" className="dayboard-checks-change" onClick={() => { setEditing(true); }}>
              {checks.length === 0 ? `Write the ${words.short} checks` : `Change the ${words.short} checks`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function BuildingSection({ building, api, boardDate, timeZone, canTick, canPlan }: {
  readonly building: BuildingDay;
  readonly api: BuildingChecksApi;
  /** The board's day, YYYY-MM-DD on the venue's clock. */
  readonly boardDate: string;
  readonly timeZone: string;
  readonly canTick: boolean;
  readonly canPlan: boolean;
}): ReactElement | null {
  const day = api.day;
  if (building.openBy === null && (day === null || (day.opening.length === 0 && day.lockup.length === 0)) && !canPlan) return null;
  const openWords = building.openBy === null ? null : `Open by ${momentTime(building.openBy, boardDate, timeZone)}`;
  const lockWords = building.lockUpAfter === null ? null : `Lock up after ${momentTime(building.lockUpAfter, boardDate, timeZone)}`;
  const counts = day === null ? null : (["opening", "lockup"] as const)
    .map((kind) => ({ kind, current: day[kind].filter((check) => !check.retired) }))
    .filter((entry) => entry.current.length > 0)
    .map((entry) => `${KIND_WORDS[entry.kind].short} ${String(done(entry.current))} of ${String(entry.current.length)}`);
  const stillIn = building.stillIn.length === 0
    ? null
    : `Still in the building: ${building.stillIn.map((arrival) => `${arrival.supplierName} (in at ${formatWallTime(Date.parse(arrival.arrivedAt ?? arrival.arrivesAt), timeZone)})`).join(", ")}.`;
  const line = [openWords, lockWords, ...(counts ?? [])].filter((part): part is string => part !== null);

  return (
    <section className="dayboard-building" aria-label="The building">
      <details className="dayboard-building-details">
        <summary>
          <span className="dayboard-building-title">The building</span>
          {line.length > 0 && <span className="dayboard-building-line">{line.join(" · ")}</span>}
        </summary>
        <div className="dayboard-building-body">
          {(building.openBy !== null || building.lockUpAfter !== null) && (
            <div className="dayboard-building-moments">
              {building.openBy !== null && openWords !== null && <p><strong>{openWords}</strong> · {building.openBy.why}</p>}
              {building.lockUpAfter !== null && lockWords !== null && <p><strong>{lockWords}</strong> · {building.lockUpAfter.why}</p>}
            </div>
          )}
          {api.status === "loading" && day === null && <ActivityStatus>Reading the building’s checks…</ActivityStatus>}
          {api.status === "failed" && (
            <div className="dayboard-checks-failed">
              <p>{day === null ? "The building’s checks could not be read just now." : "The building’s checks could not be read just now; these are as last read."}</p>
              <button type="button" className="dayboard-button" onClick={api.refresh}>Try again</button>
            </div>
          )}
          {day !== null && (
            <div className="dayboard-checks-pair">
              <ChecksList kind="opening" checks={day.opening} timeZone={timeZone} canTick={canTick} canPlan={canPlan} api={api} />
              <ChecksList kind="lockup" checks={day.lockup} timeZone={timeZone} canTick={canTick} canPlan={canPlan} api={api} stillIn={stillIn} />
            </div>
          )}
          <p className="dayboard-checks-problem" role="status">{api.failure ?? ""}</p>
        </div>
      </details>
    </section>
  );
}
