import { useEffect, useId, useState, type CSSProperties } from "react";
import { Info, ShieldQuestion, X } from "lucide-react";
import { TRUTH_MODE_TOKENS } from "@omnitwin/types";
import type { TruthModeSceneSummary } from "../../lib/truth-mode-summary.js";
import {
  formatConfidenceTier,
  formatEvidenceState,
  formatStalenessState,
} from "../../lib/truth-mode-summary.js";

export interface TruthModeIndicatorProps {
  readonly summary: TruthModeSceneSummary;
}

const shellToken = TRUTH_MODE_TOKENS["known-unknown"];
const observedToken = TRUTH_MODE_TOKENS.observed;
const warningToken = TRUTH_MODE_TOKENS.contested;

const rootStyle: CSSProperties = {
  position: "fixed",
  left: 12,
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
  zIndex: 38,
  width: "calc(100vw - 24px)",
  maxWidth: 340,
  boxSizing: "border-box",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const indicatorButtonStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${shellToken.border}`,
  background: "rgba(16, 18, 23, 0.88)",
  color: "#f7efe2",
  backdropFilter: "blur(14px)",
  boxShadow: "0 14px 34px rgba(0,0,0,0.34)",
  cursor: "pointer",
  textAlign: "left",
};

const popoverStyle: CSSProperties = {
  position: "fixed",
  left: 12,
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 176px)",
  width: "calc(100vw - 24px)",
  maxWidth: 340,
  boxSizing: "border-box",
  borderRadius: 12,
  border: `1px solid ${shellToken.border}`,
  background: "rgba(247, 242, 232, 0.98)",
  color: "#1d1a16",
  boxShadow: "0 18px 50px rgba(0,0,0,0.38)",
  maxHeight: "calc(100dvh - 200px)",
  overflowY: "auto",
  overflowX: "hidden",
};

const labelStyle: CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.11em",
  textTransform: "uppercase",
  color: shellToken.foreground,
};

const bodyTextStyle: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 12,
  lineHeight: 1.45,
  color: "#373029",
};

function StatusDot({ summary }: { readonly summary: TruthModeSceneSummary }): React.ReactElement {
  const token = summary.measuredRuntimeAssetsLoaded ? observedToken : shellToken;
  return (
    <span
      aria-hidden="true"
      style={{
        width: 12,
        height: 12,
        flex: "0 0 auto",
        borderRadius: "50%",
        border: `2px solid ${token.border}`,
        background: token.background,
        boxShadow: `0 0 0 3px ${token.background}`,
      }}
    />
  );
}

function Chip({ children, tone }: { readonly children: React.ReactNode; readonly tone: "neutral" | "warning" }): React.ReactElement {
  const token = tone === "warning" ? warningToken : shellToken;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "2px 7px",
        borderRadius: 999,
        border: `1px solid ${token.border}`,
        background: token.background,
        color: token.foreground,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: "normal",
      }}
    >
      {children}
    </span>
  );
}

function SummaryRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <section style={{ padding: "10px 12px", borderTop: "1px solid rgba(79, 86, 97, 0.18)" }}>
      <p style={labelStyle}>{label}</p>
      <div style={bodyTextStyle}>{children}</div>
    </section>
  );
}

export function TruthModeIndicator({ summary }: TruthModeIndicatorProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const issueCount = summary.knownIssues.length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div data-testid="truth-mode-indicator" style={rootStyle}>
      {open && (
        <div id={popoverId} role="dialog" aria-label="Truth Mode summary" style={popoverStyle} data-testid="truth-mode-popover">
          <header style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 12px 10px" }}>
            <Info size={17} aria-hidden="true" style={{ color: shellToken.border, flex: "0 0 auto", marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={labelStyle}>Truth Mode L2</p>
              <p style={{ ...bodyTextStyle, fontWeight: 700, color: "#1d1a16" }}>
                {summary.truthStatusLabel}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close Truth Mode summary"
              onClick={() => { setOpen(false); }}
              style={{
                width: 28,
                height: 28,
                display: "inline-grid",
                placeItems: "center",
                border: "1px solid rgba(79, 86, 97, 0.22)",
                borderRadius: 7,
                background: "transparent",
                color: "#1d1a16",
                cursor: "pointer",
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>

          <SummaryRow label="Source / evidence">
            <p style={bodyTextStyle}>{summary.evidenceSummary}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {summary.sourceStates.map((state) => (
                <Chip key={state} tone={state === "procedural_runtime" ? "warning" : "neutral"}>
                  {formatEvidenceState(state)}
                </Chip>
              ))}
            </div>
          </SummaryRow>

          <SummaryRow label="Verification">
            {summary.verificationSummary}
          </SummaryRow>

          <SummaryRow label="Confidence">
            {summary.confidenceSummary}
            <div style={{ marginTop: 8 }}>
              <Chip tone="neutral">{formatConfidenceTier(summary.confidenceTier)}</Chip>
            </div>
          </SummaryRow>

          <SummaryRow label="Freshness">
            <Chip tone="neutral">{formatStalenessState(summary.stalenessState)}</Chip>
          </SummaryRow>

          {issueCount > 0 && (
            <SummaryRow label="Known issues">
              <ul style={{ margin: "6px 0 0", paddingLeft: 17 }}>
                {summary.knownIssues.map((issue) => (
                  <li key={issue.id} style={{ marginBottom: 5 }}>{issue.message}</li>
                ))}
              </ul>
            </SummaryRow>
          )}

          <div style={{ padding: "10px 12px 12px", borderTop: "1px solid rgba(79, 86, 97, 0.18)" }}>
            <button
              type="button"
              disabled
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(79, 86, 97, 0.22)",
                background: "#f3eee5",
                color: "#6c6259",
                fontSize: 12,
                fontWeight: 700,
                cursor: "not-allowed",
              }}
            >
              Provenance drawer unavailable
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        data-testid="truth-mode-toggle"
        aria-label={open ? "Hide Truth Mode summary" : "Open Truth Mode summary"}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => { setOpen((value) => !value); }}
        style={indicatorButtonStyle}
      >
        <ShieldQuestion size={18} aria-hidden="true" style={{ color: shellToken.border, flex: "0 0 auto" }} />
        <StatusDot summary={summary} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", color: "#d8ad4a", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Truth Mode L1
          </span>
          <span style={{ display: "block", marginTop: 2, fontSize: 13, fontWeight: 800, lineHeight: 1.25 }}>
            {summary.modeLabel}: {summary.truthStatusLabel}
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
            <Chip tone={summary.generatedOrProceduralContent ? "warning" : "neutral"}>
              {summary.generatedOrProceduralContent ? "Procedural content present" : "Measured source only"}
            </Chip>
            <Chip tone={summary.measuredRuntimeAssetsLoaded ? "neutral" : "warning"}>
              {summary.measuredRuntimeAssetsLoaded ? "Measured runtime loaded" : "Measured runtime not loaded"}
            </Chip>
            <Chip tone={issueCount > 0 ? "warning" : "neutral"}>
              {issueCount > 0 ? `${String(issueCount)} known issues` : "No known issues"}
            </Chip>
          </span>
        </span>
      </button>
    </div>
  );
}
