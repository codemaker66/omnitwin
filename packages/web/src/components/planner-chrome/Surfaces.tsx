import { forwardRef, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import "./chrome.css";

// ---------------------------------------------------------------------------
// Surfaces — what the chrome is made of (spec 7.2, 7.3).
//
// Lacquer: the one ground at rest, e1, or e2 when lifted (a panel, the
// caption). Chip: the hold and "Sample". StatusDot: the mark beside a state's
// words, never the state alone. Notice: a state that says what is safe and
// what to do. MarkLabel: a tag on the floor (an aisle, a ghost's fit) whose
// place in the room is written by its caller each frame.
// ---------------------------------------------------------------------------

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "style" | "className">;

export interface LacquerProps extends DivProps {
  /** e2: panels, sheets, the caption and the command line. */
  readonly raised?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

export const Lacquer = forwardRef<HTMLDivElement, LacquerProps>(function Lacquer({ raised = false, className, children, ...rest }, ref): ReactElement {
  return (
    <div {...rest} ref={ref} className={["pc-lacquer", raised ? "pc-lacquer--raised" : "", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
});

export type ChipTone = "hold" | "sample";

export function Chip({ tone, children }: { readonly tone: ChipTone; readonly children: ReactNode }): ReactElement {
  return <span className={`pc-chip pc-chip--${tone}`}>{children}</span>;
}

export type StatusDotTone = "saved" | "offline" | "failed" | "draft";

/** The mark beside a state's words. Decorative: the words carry the meaning. */
export function StatusDot({ tone }: { readonly tone: StatusDotTone }): ReactElement {
  return <i className={`pc-dot pc-dot--${tone}`} aria-hidden="true" />;
}

export interface NoticeProps {
  /** The state in a few words ("Not saved"). */
  readonly lead: string;
  /** What is safe and what happens next. */
  readonly body?: ReactNode;
  /** status for a state that arrives quietly; alert for one that needs the person now. */
  readonly urgency?: "status" | "alert";
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function Notice({ lead, body, urgency = "status", actions, className }: NoticeProps): ReactElement {
  return (
    <div className={["pc-lacquer pc-notice", className ?? ""].filter(Boolean).join(" ")} role={urgency} aria-live={urgency === "alert" ? "assertive" : "polite"}>
      <b className="pc-notice__lead">{lead}</b>
      {body !== undefined ? <p className="pc-notice__body">{body}</p> : null}
      {actions !== undefined ? <div className="pc-notice__actions">{actions}</div> : null}
    </div>
  );
}

export type MarkTone = "plain" | "copper" | "sage" | "amber" | "brick";

export interface MarkLabelProps {
  readonly tone?: MarkTone;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A tag on the floor ("1.4 m to Table 7", "Table 8 · 10 seats · fits"). Its
 * caller writes --pc-mark-x and --pc-mark-y on the element each frame, from the
 * projected point it labels, so following the camera costs no React render.
 */
export const MarkLabel = forwardRef<HTMLSpanElement, MarkLabelProps>(function MarkLabel({ tone = "plain", children, className }, ref): ReactElement {
  return (
    <span ref={ref} className={["pc-mark", tone === "plain" ? "" : `pc-mark--${tone}`, className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
});
