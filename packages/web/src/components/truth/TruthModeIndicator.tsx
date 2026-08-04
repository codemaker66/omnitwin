import { useEffect, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Info, ShieldQuestion, X } from "lucide-react";
import { TRUTH_MODE_TOKENS } from "@omnitwin/types";
import type { TruthModeSceneSummary } from "../../lib/truth-mode-summary.js";
import {
  formatConfidenceTier,
  formatEvidenceState,
  formatStalenessState,
} from "../../lib/truth-mode-summary.js";
import { evidenceChipStateFromVerificationState } from "../../lib/evidence-chip-model.js";
import { EvidenceChip } from "../evidence/EvidenceChip.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "../shared/FloatingWidgetFrame.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";

export interface TruthModeIndicatorProps {
  readonly summary: TruthModeSceneSummary;
}

const shellToken = TRUTH_MODE_TOKENS["known-unknown"];
const observedToken = TRUTH_MODE_TOKENS.observed;
const warningToken = TRUTH_MODE_TOKENS.contested;

const DEFAULT_PLACEMENT: FloatingWidgetPlacement = {
  type: "percent",
  xPercent: 0.12,
  yPercent: 0.1,
};

const AVOID_SELECTORS = [
  ".planner-status-header",
  ".cockpit-layer-controls",
  "[data-testid='planner-toolbar']",
  "[data-floating-widget-id='planner-view-mode']",
  "[data-floating-widget-id='planner-spatial-hud']",
  "[data-floating-widget-id='cockpit-minimap']",
  "[data-floating-widget-id='placement-coach']",
  ".planner-command-deck",
  ".planner-section-slider-dock",
  "[data-testid='cockpit-bottom']",
] as const;

const contentStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  width: "min(320px, calc(100vw - 24px))",
  fontFamily: "\"Inter\", system-ui, sans-serif",
};

const indicatorButtonStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  boxSizing: "border-box",
  alignItems: "center",
  gap: 9,
  minWidth: 0,
  border: `1px solid ${shellToken.border}`,
  borderRadius: 8,
  background:
    "linear-gradient(150deg, rgba(19, 21, 24, 0.96), rgba(11, 12, 13, 0.94))",
  boxShadow: "inset 0 1px 0 rgba(255, 247, 221, 0.07)",
  color: "#f7efe2",
  cursor: "pointer",
  padding: "10px 11px",
  textAlign: "left",
};

const compactStatusLineStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  columnGap: 8,
  rowGap: 3,
  marginTop: 5,
  color: "rgba(247, 239, 226, 0.72)",
  fontSize: 10.5,
  fontWeight: 720,
  lineHeight: 1.25,
};

const compactStatusItemStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minWidth: 0,
  whiteSpace: "normal",
};

const compactStatusDotStyle: CSSProperties = {
  width: 4,
  height: 4,
  flex: "0 0 auto",
  marginRight: 5,
  borderRadius: "50%",
  background: "#d8ad4a",
  boxShadow: "0 0 8px rgba(216, 173, 74, 0.55)",
};

const detailsStyle: CSSProperties = {
  overflow: "hidden",
  border: `1px solid ${shellToken.border}`,
  borderRadius: 8,
  background:
    "linear-gradient(180deg, rgba(22, 24, 27, 0.98), rgba(10, 11, 12, 0.98))",
  color: "#f7efe2",
  boxShadow: "inset 0 1px 0 rgba(255, 247, 221, 0.06)",
};

const labelStyle: CSSProperties = {
  margin: 0,
  color: "#d8ad4a",
  fontSize: 10,
  fontWeight: 820,
  letterSpacing: "0.11em",
  lineHeight: 1.1,
  textTransform: "uppercase",
};

const bodyTextStyle: CSSProperties = {
  margin: "3px 0 0",
  color: "rgba(247, 239, 226, 0.76)",
  fontSize: 12,
  lineHeight: 1.45,
};

function StatusDot({ summary }: { readonly summary: TruthModeSceneSummary }): ReactElement {
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

function Chip({ children, tone }: { readonly children: ReactNode; readonly tone: "neutral" | "warning" }): ReactElement {
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
        fontWeight: 740,
        lineHeight: 1.2,
        whiteSpace: "normal",
      }}
    >
      {children}
    </span>
  );
}

function CompactStatusItem({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <span style={compactStatusItemStyle}>
      <span aria-hidden="true" style={compactStatusDotStyle} />
      <span>{children}</span>
    </span>
  );
}

function SummaryRow({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <section style={{ padding: "10px 12px", borderTop: "1px solid rgba(247, 239, 226, 0.1)" }}>
      <p style={labelStyle}>{label}</p>
      <div style={bodyTextStyle}>{children}</div>
    </section>
  );
}

export function TruthModeIndicator({ summary }: TruthModeIndicatorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const detailsId = useId();
  const issueCount = summary.knownIssues.length;
  const collapsedSourceLabel = summary.generatedOrProceduralContent ? "Procedural" : "Measured";
  const collapsedRuntimeLabel = summary.measuredRuntimeAssetsLoaded ? "Runtime loaded" : "Runtime not loaded";
  const collapsedIssueLabel = issueCount > 0 ? `${String(issueCount)} issues` : "No issues";
  const fullSourceLabel = summary.generatedOrProceduralContent ? "Procedural content present" : "Measured source only";
  const fullRuntimeLabel = summary.measuredRuntimeAssetsLoaded ? "Measured runtime loaded" : "Measured runtime not loaded";
  const fullIssueLabel = issueCount > 0 ? `${String(issueCount)} known issues` : "No known issues";

  useEffect(() => {
    if (!open) return undefined;
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
    <FloatingWidgetFrame
      id="truth-mode-indicator"
      title="Truth Mode"
      compactLabel={collapsedIssueLabel}
      className="truth-mode-widget"
      bodyClassName="truth-mode-widget__body"
      strategy="fixed"
      testId="truth-mode-indicator"
      defaultPlacement={DEFAULT_PLACEMENT}
      avoidSelectors={AVOID_SELECTORS}
      avoidPaddingPx={12}
      storageScope="planner-truth-mode-v1"
      zIndex={38}
      autoCompact={cameraInteractionActive}
    >
      <div style={contentStyle}>
        <button
          type="button"
          data-testid="truth-mode-toggle"
          aria-label={open ? "Hide Truth Mode summary" : "Open Truth Mode summary"}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => { setOpen((value) => !value); }}
          style={indicatorButtonStyle}
        >
          <ShieldQuestion size={18} aria-hidden="true" style={{ color: shellToken.border, flex: "0 0 auto" }} />
          <StatusDot summary={summary} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", color: "#d8ad4a", fontSize: 10, fontWeight: 820, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Truth Mode L1
            </span>
            <span style={{ display: "block", marginTop: 2, fontSize: 13, fontWeight: 800, lineHeight: 1.25 }}>
              {summary.modeLabel}: {summary.truthStatusLabel}
            </span>
            <span
              data-testid="truth-mode-status-line"
              style={compactStatusLineStyle}
              aria-label={[fullSourceLabel, fullRuntimeLabel, fullIssueLabel].join(", ")}
            >
              <CompactStatusItem>{collapsedSourceLabel}</CompactStatusItem>
              <CompactStatusItem>{collapsedRuntimeLabel}</CompactStatusItem>
              <CompactStatusItem>{collapsedIssueLabel}</CompactStatusItem>
            </span>
          </span>
        </button>

        {open && (
          <div id={detailsId} role="dialog" aria-label="Truth Mode summary" style={detailsStyle} data-testid="truth-mode-popover">
            <header style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 12px 10px" }}>
              <Info size={17} aria-hidden="true" style={{ color: shellToken.border, flex: "0 0 auto", marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={labelStyle}>Truth Mode L2</p>
                <p style={{ ...bodyTextStyle, color: "#f7efe2", fontWeight: 760 }}>{summary.truthStatusLabel}</p>
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
                  border: "1px solid rgba(247, 239, 226, 0.14)",
                  borderRadius: 7,
                  background: "rgba(255, 255, 255, 0.045)",
                  color: "#f7efe2",
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
              <p style={bodyTextStyle}>{summary.verificationSummary}</p>
              {/* CARD A4: the canonical evidence chip, driven by the summary's
                  verification state. The source tags above keep their own
                  11-value provenance vocabulary by design — mapping them onto
                  the four chip states would overstate what is known. */}
              <div style={{ marginTop: 8 }}>
                <EvidenceChip state={evidenceChipStateFromVerificationState(summary.verificationState)} />
              </div>
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

            <section style={{ padding: "10px 12px 12px", borderTop: "1px solid rgba(247, 239, 226, 0.1)" }}>
              <p style={labelStyle}>Next action</p>
              <p style={bodyTextStyle}>Open the Evidence lens for provenance records, review gates, and sign-off state.</p>
            </section>
          </div>
        )}
      </div>
    </FloatingWidgetFrame>
  );
}
