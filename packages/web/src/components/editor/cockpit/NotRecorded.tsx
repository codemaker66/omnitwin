import { useId, type ReactElement } from "react";
import type { AskAction } from "../../../lib/unrecorded-ask.js";

// ---------------------------------------------------------------------------
// NotRecorded — a building fact nobody recorded, shown as a person to ask.
//
// Replaces every verdict that used to stand on an assumed input (a default
// WLL, a default breaker, doors placed mid-wall). The gap is never a grey
// void: it names the fact, says plainly that it is not recorded, and offers
// the one next step, a drafted question to the named person, which the
// viewer sends themselves. The dashed hairline is the register's "missing"
// treatment (house-tokens.css): no hue carries the meaning, the words do.
// ---------------------------------------------------------------------------

export interface NotRecordedProps {
  /** The fact, e.g. "Point WLL". */
  readonly label: string;
  readonly ask: AskAction;
  readonly testId: string;
  /** Why it matters or where it would come from, in one sentence. */
  readonly detail?: string;
}

export function NotRecorded({ label, ask, testId, detail }: NotRecordedProps): ReactElement {
  const hintId = useId();
  return (
    <div className="lens-panel__unrecorded" data-testid={testId}>
      <div className="lens-panel__unrecorded-head">
        <span className="lens-panel__unrecorded-label">{label}</span>
        <span className="lens-panel__unrecorded-value" data-testid={`${testId}-status`}>Not recorded</span>
      </div>
      {detail !== undefined && <span className="lens-panel__row-meta">{detail}</span>}
      {ask.href !== null ? (
        <>
          <a
            className="lens-panel__ask"
            href={ask.href}
            aria-describedby={hintId}
            data-testid={`${testId}-ask`}
          >
            {ask.label}
          </a>
          <span className="lens-panel__unrecorded-hint" id={hintId}>
            Opens an email with the question written. Nothing is sent until you send it.
          </span>
        </>
      ) : (
        <span className="lens-panel__unrecorded-hint" data-testid={`${testId}-next`}>{ask.fallback}</span>
      )}
    </div>
  );
}
