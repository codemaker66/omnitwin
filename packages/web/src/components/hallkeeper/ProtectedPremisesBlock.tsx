import { useId, type ReactElement } from "react";
import {
  buildProtectedPremisesSummary,
  type ProtectedPremises,
  type ProtectedPremisesLine,
} from "@omnitwin/types";
import "./protected-premises.css";

// ---------------------------------------------------------------------------
// Martyn's Law readiness (T-648) — the hallkeeper sheet's prompts for the
// Terrorism (Protection of Premises) Act 2025.
//
// Always rendered, outside the instructions gate: an event with nothing
// entered shows every line as "Not set" or "Not checked", so a blank reads
// as a question to answer rather than an absence nobody notices. Wording
// comes from the shared buildProtectedPremisesSummary, so the screen, the
// printed sheet and the PDF say the same thing. Prompts only: nothing here
// may claim the venue or event is compliant, approved, certified or safe.
//
// Tone lives in a small mark beside the words (the register's rule); the
// words carry the meaning on their own.
// ---------------------------------------------------------------------------

export interface ProtectedPremisesBlockProps {
  /** The operator's record; null or undefined when nothing was entered. */
  readonly record: ProtectedPremises | null | undefined;
  /** configurations.guest_count, shown beside the Act's thresholds as information. */
  readonly guestCount: number;
  readonly timeZone: string;
}

export function ProtectedPremisesBlock({ record, guestCount, timeZone }: ProtectedPremisesBlockProps): ReactElement {
  const headingId = useId();
  const summary = buildProtectedPremisesSummary(record, { guestCount, timeZone });
  return <section className="hkpp" aria-labelledby={headingId} data-testid="protected-premises">
    <header className="hkpp-head">
      <h3 id={headingId}>{summary.heading}</h3>
      <p>{summary.intro}</p>
    </header>
    <LineGroup title="People" lines={summary.people} />
    <LineGroup title="Staff briefed on" lines={summary.procedures} marked />
    <LineGroup title="On the day" lines={summary.arrangements} />
    <footer className="hkpp-context">
      <p className="hkpp-guests">{summary.guestLine}</p>
      <p>{summary.context.join(" ")}</p>
    </footer>
  </section>;
}

function LineGroup({ title, lines, marked = false }: {
  readonly title: string;
  readonly lines: readonly ProtectedPremisesLine[];
  /** Procedures carry a mark: filled when briefed, copper when not, open when unchecked. */
  readonly marked?: boolean;
}): ReactElement {
  return <div className="hkpp-group">
    <h4>{title}</h4>
    <dl>
      {lines.map((line) => <div key={line.key} className={`hkpp-line${line.entered ? "" : " is-unset"}`}>
        <dt>{line.label}</dt>
        <dd>
          <span className="hkpp-value">
            {marked && <span className={`hkpp-mark ${markTone(line)}`} aria-hidden="true" />}
            {line.value}
          </span>
          {line.note !== null && <span className="hkpp-note">{line.note}</span>}
        </dd>
      </div>)}
    </dl>
  </div>;
}

function markTone(line: ProtectedPremisesLine): string {
  if (!line.entered) return "is-open";
  return line.value === "Briefed" ? "is-done" : "is-gap";
}
