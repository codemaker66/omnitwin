import { type ReactElement, type ReactNode } from "react";
import "./LensPanel.css";

// ---------------------------------------------------------------------------
// LensPanel — the shared dock shell for every cockpit lens tool (Epic 0).
//
// One chrome for all lens panels: an eyebrow + serif title header with an
// optional status chip, a scrollable body of labelled sections (one dominant
// top-to-bottom reading axis, per the inspector-dock research), and a footer
// reserved for the SAFE / claim-safety line. Panels compose
// LensPanelSection / LensPanelMetric inside; the framework owns the rest so no
// lens reinvents the dock. The root sits in the cockpit grid's `panel` area.
// ---------------------------------------------------------------------------

export interface LensPanelProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly icon?: ReactNode;
  /** Small status chip (e.g. "Simulated", "Simulating…", "Unavailable"). */
  readonly source?: string;
  readonly children: ReactNode;
  /** Claim-safety line pinned to the bottom of the dock. */
  readonly footer?: ReactNode;
  readonly testId?: string;
}

export function LensPanel({ eyebrow, title, icon, source, children, footer, testId }: LensPanelProps): ReactElement {
  return (
    <aside className="lens-panel" data-testid={testId ?? "lens-panel"} aria-label={title}>
      <header className="lens-panel__head">
        {icon !== undefined && <span className="lens-panel__head-icon" aria-hidden="true">{icon}</span>}
        <span className="lens-panel__head-copy">
          <span className="lens-panel__eyebrow">{eyebrow}</span>
          <span className="lens-panel__title">{title}</span>
        </span>
        {source !== undefined && <span className="lens-panel__source">{source}</span>}
      </header>
      <div className="lens-panel__body">{children}</div>
      {footer !== undefined && <p className="lens-panel__footer">{footer}</p>}
    </aside>
  );
}

export interface LensPanelSectionProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** A labelled, collapsible-ready content group (progressive disclosure). */
export function LensPanelSection({ label, children }: LensPanelSectionProps): ReactElement {
  return (
    <section className="lens-panel__section">
      <h3 className="lens-panel__section-label">{label}</h3>
      <div className="lens-panel__section-body">{children}</div>
    </section>
  );
}

/** The dominant reading unit: label on the left, value on the right. */
export function LensPanelMetric({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="lens-panel__metric">
      <span className="lens-panel__metric-label">{label}</span>
      <span className="lens-panel__metric-value">{value}</span>
    </div>
  );
}
