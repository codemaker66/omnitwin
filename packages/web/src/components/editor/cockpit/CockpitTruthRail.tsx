import { useEffect, useState, type ReactElement } from "react";
import { ShieldQuestion } from "lucide-react";
import type { TruthModeSummary } from "@omnitwin/types";
import { useEditorStore } from "../../../stores/editor-store.js";
import { getTruthModeSummary } from "../../../api/truth-mode.js";
import { buildTruthRailRows } from "../../../lib/cockpit-truth-rail-model.js";
import "./CockpitTruthRail.css";

type SummaryStatus = "idle" | "loading" | "loaded" | "fallback";

function sourceNote(status: SummaryStatus): string {
  switch (status) {
    case "loaded": return "Live evidence";
    case "loading": return "Loading evidence";
    case "fallback": return "Planning fallback";
    case "idle": return "Planning fallback";
  }
}

/**
 * Cockpit Truth rail — the right-hand evidence panel. Binds to the non-mutating
 * truth-mode summary for the active configuration and renders deliberately
 * cautious rows (never a single green "all clear"). Degrades to SAFE planning
 * fallbacks when no config is loaded or the summary is unavailable.
 */
export function CockpitTruthRail(): ReactElement {
  const configId = useEditorStore((s) => s.configId);
  const [summary, setSummary] = useState<TruthModeSummary | null>(null);
  const [status, setStatus] = useState<SummaryStatus>("idle");

  useEffect(() => {
    if (configId === null) {
      setSummary(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setSummary(null);
    void getTruthModeSummary({ targetType: "configuration", targetId: configId })
      .then((loaded) => {
        if (cancelled) return;
        setSummary(loaded);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        setStatus("fallback");
      });
    return () => { cancelled = true; };
  }, [configId]);

  const rows = buildTruthRailRows(summary);

  return (
    <aside className="cockpit-truth" data-testid="cockpit-truth-rail" aria-label="Truth Mode">
      <header className="cockpit-truth__head">
        <span className="cockpit-truth__head-icon" aria-hidden="true"><ShieldQuestion size={18} /></span>
        <span className="cockpit-truth__head-copy">
          <span className="cockpit-truth__eyebrow">Truth Mode</span>
          <span className="cockpit-truth__title">Layout evidence</span>
        </span>
        <span className="cockpit-truth__source">{sourceNote(status)}</span>
      </header>

      <div className="cockpit-truth__rows">
        {rows.map((row) => (
          <div className="cockpit-truth__row" key={row.key}>
            <p className="cockpit-truth__label">{row.label}</p>
            <p className="cockpit-truth__value">{row.value}</p>
            <span className={`cockpit-truth__chip cockpit-truth__chip--${row.tone}`}>
              {row.tone === "neutral" ? "current" : "review"}
            </span>
          </div>
        ))}
      </div>

      {summary !== null && (
        <div className="cockpit-truth__counts" aria-label="Evidence counts">
          <CountChip value={summary.counts.evidenceItems} label="Evidence" />
          <CountChip value={summary.counts.checkResults} label="Checks" />
          <CountChip value={summary.counts.reviewGates} label="Gates" />
          <CountChip value={summary.counts.staleEvents} label="Stale" />
        </div>
      )}

      <p className="cockpit-truth__footer">
        Planning evidence · human review required before operational reliance.
      </p>
    </aside>
  );
}

function CountChip({ value, label }: { readonly value: number; readonly label: string }): ReactElement {
  return (
    <span className="cockpit-truth__count">
      <strong>{value.toLocaleString("en-GB")}</strong>
      <small>{label}</small>
    </span>
  );
}
