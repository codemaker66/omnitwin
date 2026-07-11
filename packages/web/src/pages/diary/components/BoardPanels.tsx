import type { ReactElement } from "react";
import type { CalendarConflict, ConflictReport, ConflictSeverity } from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import type { NeedsActionItem } from "../lib/board-layout.js";

// ---------------------------------------------------------------------------
// Board side panels (T-493): the conflict rail (explanations + honest checks),
// the needs-attention holding tray, the undo toast, and the ink-move
// confirmation. All crisp and opaque — no blur where information lives
// (the Hallkeeper Test, Canon §18).
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: readonly ConflictSeverity[] = ["blocking", "warning", "info"];

export interface ConflictRailProps {
  readonly report: ConflictReport;
  readonly onFocusEntry: (entryId: string) => void;
}

export function ConflictRail({ report, onFocusEntry }: ConflictRailProps): ReactElement {
  const grouped = new Map<ConflictSeverity, CalendarConflict[]>();
  for (const conflict of report.conflicts) {
    const bucket = grouped.get(conflict.severity) ?? [];
    bucket.push(conflict);
    grouped.set(conflict.severity, bucket);
  }

  return (
    <section className="diary-panel diary-conflicts" aria-label={BOARD_COPY.conflicts.title}>
      <h2 className="diary-panel-title">{BOARD_COPY.conflicts.title}</h2>
      {report.conflicts.length === 0 ? (
        <p className="diary-panel-empty">{BOARD_COPY.conflicts.none}</p>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const bucket = grouped.get(severity);
          if (bucket === undefined || bucket.length === 0) return null;
          return (
            <div key={severity} className={`diary-conflict-group is-${severity}`}>
              <h3 className="diary-conflict-heading">
                {BOARD_COPY.conflicts.severity[severity]}
                <span className="diary-conflict-count">{bucket.length}</span>
              </h3>
              <ul className="diary-conflict-list">
                {bucket.map((conflict) => (
                  <li key={conflict.id}>
                    <button
                      type="button"
                      className="diary-conflict-item"
                      onClick={() => {
                        onFocusEntry(conflict.entryIds[0]);
                      }}
                    >
                      {conflict.explanation}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <h3 className="diary-checks-title">{BOARD_COPY.conflicts.checksTitle}</h3>
      <ul className="diary-checks">
        <li className={`diary-check is-${report.checks.turnaround.status}`}>
          {BOARD_COPY.conflicts.turnaround[report.checks.turnaround.status]}
          <span className="diary-check-detail">{report.checks.turnaround.detail}</span>
        </li>
      </ul>
      <p className="diary-disclosure">{BOARD_COPY.disclosure}</p>
    </section>
  );
}

export interface HoldingTrayProps {
  readonly items: readonly NeedsActionItem[];
  readonly onFocusEntry: (entryId: string) => void;
}

export function HoldingTray({ items, onFocusEntry }: HoldingTrayProps): ReactElement {
  return (
    <section className="diary-panel diary-tray" aria-label={BOARD_COPY.tray.title}>
      <h2 className="diary-panel-title">
        {BOARD_COPY.tray.title}
        {items.length > 0 ? <span className="diary-tray-count">{items.length}</span> : null}
      </h2>
      {items.length === 0 ? (
        <p className="diary-panel-empty">{BOARD_COPY.tray.empty}</p>
      ) : (
        <ul className="diary-tray-list">
          {items.map((item) => (
            <li key={item.entry.id}>
              <button
                type="button"
                className="diary-tray-item"
                onClick={() => {
                  onFocusEntry(item.entry.id);
                }}
              >
                <span className="diary-tray-item-title">{item.entry.title}</span>
                {item.reasons.map((reason) => (
                  <span key={reason} className="diary-tray-item-reason">
                    {reason}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface UndoToastProps {
  readonly message: string;
  readonly showUndo: boolean;
  readonly onUndo: () => void;
}

export function UndoToast({ message, showUndo, onUndo }: UndoToastProps): ReactElement {
  return (
    <div className="diary-toast" role="status">
      <span className="diary-toast-message">{message}</span>
      {showUndo ? (
        <button type="button" className="diary-toast-undo" onClick={onUndo}>
          {BOARD_COPY.undo.action}
        </button>
      ) : null}
    </div>
  );
}

export interface InkConfirmProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function InkConfirm({ onConfirm, onCancel }: InkConfirmProps): ReactElement {
  return (
    <div
      className="diary-ink-confirm"
      role="alertdialog"
      aria-label={BOARD_COPY.confirmInk.title}
      aria-describedby="diary-ink-confirm-body"
    >
      <h2 className="diary-ink-confirm-title">{BOARD_COPY.confirmInk.title}</h2>
      <p id="diary-ink-confirm-body" className="diary-ink-confirm-body">
        {BOARD_COPY.confirmInk.body}
      </p>
      <div className="diary-ink-confirm-actions">
        <button type="button" className="diary-button is-primary" onClick={onConfirm} autoFocus>
          {BOARD_COPY.confirmInk.confirm}
        </button>
        <button type="button" className="diary-button" onClick={onCancel}>
          {BOARD_COPY.confirmInk.cancel}
        </button>
      </div>
    </div>
  );
}
