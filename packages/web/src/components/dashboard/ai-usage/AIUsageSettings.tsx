import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import type { AIUsageSummary } from "@omnitwin/types";
import { getAIUsage } from "../../../api/ai-usage.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { callWords, featureWords, monthWords, moneyWords, unansweredCalls, usedPercent } from "./ai-usage-format.js";
import "./AIUsageSettings.css";

// ---------------------------------------------------------------------------
// AI drafting: what the venue's AI use has cost (T-656; Plan 19, L6 "metering
// live"). Every model call is recorded against the venue and held to its
// monthly allowance on the server; this is where the venue's admin and
// manager read it: this month's spend against the allowance, what each
// feature used, and the months before. Read-only. Months run in UTC, as the
// allowance does; costs are the provider's list prices in US dollars when
// each call was made.
// ---------------------------------------------------------------------------

/** The months shown: this one and the two before. */
const MONTHS = 3;

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly summary: AIUsageSummary };

export interface AIUsageSettingsProps {
  readonly venueId: string;
}

export function AIUsageSettings({ venueId }: AIUsageSettingsProps): ReactElement {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadCount, setReloadCount] = useState(0);

  // One venue's use is never shown under another's name.
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    getAIUsage(venueId, MONTHS, controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", summary });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: "error" });
      });
    return () => { controller.abort(); };
  }, [venueId, reloadCount]);

  return (
    <section className="ai-usage" data-register="ivory" aria-labelledby={titleId} data-testid="ai-usage">
      <header className="ai-usage__head">
        <h3 id={titleId} ref={headingRef} tabIndex={-1}>AI drafting</h3>
        <p>
          What the venue&apos;s AI drafts and briefs have cost, against its monthly allowance. A draft that would go
          over the allowance is not written.
        </p>
      </header>

      {load.status === "loading" && <ActivityStatus>Loading AI use…</ActivityStatus>}

      {load.status === "error" && (
        <div className="ai-usage__error">
          <p role="alert">AI use could not be loaded.</p>
          <button type="button" className="ai-usage__quiet" onClick={() => {
            // The button goes while it reads again: focus waits on the section's heading.
            headingRef.current?.focus();
            setReloadCount((count) => count + 1);
          }}>
            Try again
          </button>
        </div>
      )}

      {load.status === "ready" && <AIUsageReport summary={load.summary} />}
    </section>
  );
}

function AIUsageReport({ summary }: { readonly summary: AIUsageSummary }): ReactElement {
  const { allowance } = summary;
  const thisMonth = summary.months.find((month) => month.month === allowance.month);
  const earlier = summary.months.filter((month) => month.month !== allowance.month);
  const percent = usedPercent(allowance.spentMicroUsd, allowance.heldMicroUsd, allowance.limitMicroUsd);
  const refused = thisMonth?.features.reduce((total, feature) => total + feature.outcomes.budget_blocked, 0) ?? 0;
  const monthName = monthWords(allowance.month);
  return (
    <>
      <div className="ai-usage__allowance" data-testid="ai-usage-allowance">
        <p className="ai-usage__figure">
          {moneyWords(allowance.spentMicroUsd)} <span>of {moneyWords(allowance.limitMicroUsd)} in {monthName}</span>
        </p>
        <div className="ai-usage__bar" aria-hidden="true" data-full={percent >= 100 ? "true" : "false"}>
          <span style={{ width: `${String(percent)}%` }} />
        </div>
        <p className="ai-usage__left">
          {moneyWords(allowance.remainingMicroUsd)} left this month
          {allowance.heldMicroUsd > 0 ? `, with ${moneyWords(allowance.heldMicroUsd)} set aside for drafts being written` : ""}.
          {refused > 0 ? ` ${refused === 1 ? "One draft was" : `${refused.toLocaleString("en-GB")} drafts were`} not written because the allowance was used.` : ""}
        </p>
      </div>

      {thisMonth === undefined || thisMonth.features.length === 0 ? (
        <p className="ai-usage__empty">No AI drafts or briefs yet in {monthName}.</p>
      ) : (
        <div className="ai-usage__scroll">
          <table className="ai-usage__table">
            <caption>{monthName}, by feature</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Calls</th>
                <th scope="col">Not answered</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {thisMonth.features.map((feature) => (
                <tr key={feature.feature}>
                  <th scope="row">{featureWords(feature.feature)}</th>
                  <td>{feature.calls.toLocaleString("en-GB")}</td>
                  <td>{unansweredCalls(feature).toLocaleString("en-GB")}</td>
                  <td>{moneyWords(feature.costMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {earlier.length > 0 && (
        <dl className="ai-usage__months" aria-label="Earlier months">
          {earlier.map((month) => (
            <div key={month.month}>
              <dt>{monthWords(month.month)}</dt>
              <dd>{month.calls === 0 ? "No calls" : `${callWords(month.calls)}, ${moneyWords(month.costMicroUsd)}`}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="ai-usage__footnote">
        Costs are the AI provider&apos;s list prices in US dollars when each call was made. Months run in UTC.
        &quot;Not answered&quot; counts calls the AI declined, cut short or failed; they are recorded at what they cost.
      </p>
    </>
  );
}
