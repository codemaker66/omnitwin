import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Bookmark, X } from "lucide-react";
import { countLabel } from "../../lib/count-label.js";
import { useHistoryClock } from "../../lib/history-clock.js";
import { clockTime, HISTORY_CAP, historyView, stepsToReach, type HistoryRow, type HistorySitting } from "../../lib/history-steps.js";
import { isLayoutTimelineMutationLocked } from "../../lib/layout-timeline-preview-lock.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useHistoryKeys } from "./history-keys.js";
import { Key } from "./Keys.js";
import { Notice } from "./Surfaces.js";
import "./chrome.css";
import "./history.css";

// ---------------------------------------------------------------------------
// History, in the left zone (T-674 slice 15; approved spec §6.9, §4.2, §4.5,
// §11 H). A list of the layout's steps, each named in the venue's words and
// timed, grouped by sitting, oldest first: where it began, every step, the
// saves as bookmarks. The step the layout stands at is marked; the steps
// Redo would put back follow it, dimmed. Choosing a row returns the layout
// there in one go, by undoing or redoing that many steps.
//
// H opens and closes it (HistoryKeys, mounted with the chrome); ↑ ↓ Home End
// move through the rows and Enter returns there; Esc closes it, in the
// planner's one Escape order. Receipts stay the receipt's (Receipt.tsx):
// History announces only where it returned to.
// ---------------------------------------------------------------------------

/** Mount once with the chrome: binds H, whether or not History is open. */
export function HistoryKeys(): null {
  useHistoryKeys();
  return null;
}

export interface HistoryPanelProps {
  /** The key that opened History, which takes focus back when it closes. */
  readonly returnFocusTo?: () => HTMLElement | null;
}

/**
 * Returns the layout to a position, as one gesture: that many undos, or
 * redos. Stops if the editor refuses a step (an act's layout is showing).
 * True when it got there.
 */
export function returnToPosition(target: number): boolean {
  const editor = useEditorStore.getState;
  const { undo, redo } = stepsToReach(editor().history.past.length, target);
  for (let i = 0; i < undo; i += 1) {
    const before = editor().history.past.length;
    editor().undo();
    if (editor().history.past.length === before) return false;
  }
  for (let i = 0; i < redo; i += 1) {
    const before = editor().history.past.length;
    editor().redo();
    if (editor().history.past.length === before) return false;
  }
  return true;
}

function sittingHeading(sitting: HistorySitting, last: boolean): string {
  if (sitting.from === null) return "Earlier";
  if (last) return `Since ${clockTime(sitting.from)}`;
  return sitting.to === null || sitting.to === sitting.from
    ? clockTime(sitting.from)
    : `${clockTime(sitting.from)} to ${clockTime(sitting.to)}`;
}

function returnedLine(row: HistoryRow): string {
  if (row.kind === "origin") return row.name === "Before these steps" ? "Back before these steps" : `Back to the layout ${row.name.toLowerCase()}`;
  if (row.kind === "saved") return `Back to the save at ${row.at === null ? "" : clockTime(row.at)}`;
  return `Back to ${row.name}`;
}

function rowSuffix(row: HistoryRow): string {
  if (row.state === "current") return ", where the layout is now";
  if (row.state === "undone") return ", undone";
  return "";
}

export function HistoryPanel({ returnFocusTo }: HistoryPanelProps = {}): ReactElement {
  const history = useEditorStore((state) => state.history);
  const objects = useEditorStore((state) => state.objects);
  const conflict = useEditorStore((state) => state.saveConflict !== null);
  const previewing = useEditorStore((state) => state.lockReason === "phase-preview");
  const clock = useHistoryClock();
  const view = useMemo(() => historyView(history, clock, objects), [history, clock, objects]);
  const rows = useMemo(() => view.sittings.flatMap((sitting) => sitting.rows), [view]);
  const currentKey = rows.find((row) => row.state === "current")?.key ?? null;
  const [cursor, setCursor] = useState<string | null>(currentKey);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const idBase = useId();
  const optionId = (key: string): string => `${idBase}-${key}`;

  const close = (): void => {
    const chrome = usePlannerChromeStore.getState();
    if (chrome.left === "history") chrome.close("left");
  };
  useEscapeLayer("panel", { open: true, onEscape: close, returnFocusTo });

  // Opening a panel moves focus to its first control (spec 4.5): the list, at where the layout is now.
  useEffect(() => {
    if (listRef.current !== null) listRef.current.focus({ preventScroll: true });
    else closeRef.current?.focus({ preventScroll: true });
  }, []);

  // Undo and redo from anywhere move the mark; the cursor follows it.
  useEffect(() => { setCursor(currentKey); }, [currentKey]);

  const active = cursor !== null && rows.some((row) => row.key === cursor) ? cursor : currentKey;
  useEffect(() => {
    if (active === null) return;
    const element = document.getElementById(`${idBase}-${active}`);
    if (typeof element?.scrollIntoView === "function") element.scrollIntoView({ block: "nearest" });
  }, [active, idBase]);

  const choose = (row: HistoryRow): void => {
    setCursor(row.key);
    if (previewing || isLayoutTimelineMutationLocked()) {
      setAnnouncement("An act's layout is showing; close it to return to a step");
      return;
    }
    if (row.position === useEditorStore.getState().history.past.length) {
      setAnnouncement(row.state === "current" ? "The layout is already here" : returnedLine(row));
      return;
    }
    setAnnouncement(returnToPosition(row.position) ? returnedLine(row) : "That step could not be returned to");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0) return;
    const index = Math.max(0, rows.findIndex((row) => row.key === active));
    let next: HistoryRow | undefined;
    if (event.key === "ArrowDown") next = rows[Math.min(rows.length - 1, index + 1)];
    else if (event.key === "ArrowUp") next = rows[Math.max(0, index - 1)];
    else if (event.key === "Home") next = rows[0];
    else if (event.key === "End") next = rows[rows.length - 1];
    else if (event.key === "Enter" || event.key === " ") {
      const row = rows[index];
      event.preventDefault();
      if (row !== undefined) choose(row);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    setCursor(next.key);
  };

  const undone = view.steps - view.position;
  const count = view.empty
    ? "Nothing yet"
    : `${countLabel(view.steps, "step")}${undone > 0 ? ` · ${String(undone)} to redo` : ""}`;

  return (
    <section className="pc-lacquer pc-lacquer--raised pc-history" aria-label="History" data-testid="planner-history">
      <header className="pc-history__head">
        <h2 className="pc-caps pc-history__heading">History</h2>
        <span className="pc-meta pc-num pc-history__count">{count}</span>
        <Key
          ref={closeRef}
          small
          iconOnly
          label="Close History"
          icon={<X className="pc-icon" aria-hidden="true" />}
          shortcut={["H"]}
          tooltipSide="below"
          onPress={close}
        />
      </header>

      {conflict ? (
        <Notice
          className="pc-history__notice"
          lead="Changed elsewhere"
          body="This layout changed somewhere else. Your steps stay here; showing the other version starts History again."
        />
      ) : null}
      {previewing ? (
        <Notice className="pc-history__notice" lead="An act's layout is showing" body="Close it to return to a step." />
      ) : null}

      {view.empty ? (
        <div className="pc-history__empty">
          <p className="pc-history__lead">Nothing to undo yet</p>
          <p className="pc-meta pc-history__line">Each change you make is listed here with its time. Choose one to return the layout there.</p>
        </div>
      ) : (
        <>
          {view.dropped > 0 ? (
            <p className="pc-meta pc-history__cap">
              History keeps the last {String(HISTORY_CAP)} steps, so the earliest have dropped off.
            </p>
          ) : null}
          <div
            ref={listRef}
            className="pc-history__list"
            role="listbox"
            aria-label="Steps"
            tabIndex={0}
            aria-activedescendant={active === null ? undefined : optionId(active)}
            onKeyDown={onKeyDown}
          >
            {view.sittings.map((sitting, index) => {
              const headingId = `${idBase}-sitting-${String(index)}`;
              return (
                <div key={sitting.key} role="group" aria-labelledby={headingId} className="pc-history__sitting">
                  <div id={headingId} role="presentation" className="pc-caps pc-num pc-history__sitting-head">
                    {sittingHeading(sitting, index === view.sittings.length - 1)}
                  </div>
                  {sitting.rows.map((row) => (
                    <div
                      key={row.key}
                      id={optionId(row.key)}
                      role="option"
                      aria-selected={row.key === active}
                      aria-current={row.state === "current" ? "step" : undefined}
                      className={[
                        "pc-history__row",
                        `is-${row.state}`,
                        `is-${row.kind}`,
                        row.key === active ? "is-cursor" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => { choose(row); }}
                    >
                      <span className="pc-history__mark" aria-hidden="true">
                        {row.kind === "saved" ? <Bookmark className="pc-icon pc-history__bookmark" /> : null}
                      </span>
                      <span className="pc-history__name">
                        {row.name}
                        <span className="pc-history__hidden">{rowSuffix(row)}</span>
                      </span>
                      {row.at !== null && row.kind !== "saved" ? (
                        <span className="pc-meta pc-num pc-history__time">{clockTime(row.at)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="pc-meta pc-history__foot">History starts when you open the layout.</p>
      <div className="pc-history__hidden" role="status">{announcement}</div>
    </section>
  );
}
