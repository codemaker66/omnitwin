import { useMemo, type ReactElement } from "react";
import { ShieldCheck } from "lucide-react";
import { LensPanel, LensPanelSection } from "./LensPanel.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import { buildEvidencePack, type EvidenceStatus } from "../../../lib/cockpit-evidence-model.js";
import { changeHistoryRows } from "../../../lib/change-history-model.js";
import { useChangeHistory } from "../../../hooks/use-change-history.js";

// ---------------------------------------------------------------------------
// EvidenceLensPanel — the Layout Evidence Pack (Epic 0 Evidence lens panel).
//
// A purpose-fit check list built live from the layout (seating provision, room
// comfort, egress reference), each with an honest status. Composes the same
// Guests capacity model + egress engine the rest of the app uses. SAFE: every
// figure is a planning-grade estimate for human review — the egress check states
// what guidance INDICATES for the headcount, never a verification of the room's
// real exits, and nothing here is a fire/occupancy/compliance determination.
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<EvidenceStatus, string> = {
  pass: "ok",
  attention: "attention",
  review: "review",
  info: "info",
};

const STATUS_LABEL: Record<EvidenceStatus, string> = {
  pass: "Pass",
  attention: "Attention",
  review: "Review",
  info: "Info",
};

export function EvidenceLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);

  const pack = useMemo(
    () => buildEvidencePack({
      placedItems,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      guestCount: plannedGuestCount,
    }),
    [placedItems, dimensions, plannedGuestCount],
  );

  const needsAttention = pack.reviewCount + pack.attentionCount;
  const source = needsAttention === 0 ? "Pack clear" : `${String(needsAttention)} to review`;

  return (
    <LensPanel
      eyebrow="Evidence lens"
      title="Layout evidence"
      icon={<ShieldCheck size={18} />}
      source={source}
      testId="evidence-lens-panel"
      footer="Planning-grade checks for human review — purpose-fit draft, not a fire, occupancy, or compliance determination. The egress reference is what guidance indicates for the headcount; confirm the room's real exits with the venue."
    >
      <LensPanelSection label="Purpose-fit checks">
        <div className="lens-panel__chips" data-testid="evidence-summary">
          {pack.passCount > 0 && (
            <span className="lens-panel__chip lens-panel__chip--ok"><strong>{pack.passCount}</strong> pass</span>
          )}
          {pack.attentionCount > 0 && (
            <span className="lens-panel__chip lens-panel__chip--attention"><strong>{pack.attentionCount}</strong> attention</span>
          )}
          {pack.reviewCount > 0 && (
            <span className="lens-panel__chip lens-panel__chip--review"><strong>{pack.reviewCount}</strong> review</span>
          )}
          {needsAttention === 0 && pack.passCount === 0 && (
            <span className="lens-panel__chip lens-panel__chip--info">Add a guest count to assess</span>
          )}
        </div>

        {pack.checks.map((check) => (
          <div key={check.id} className={`lens-panel__row lens-panel__row--${check.status === "pass" ? "pass" : check.status}`} data-testid={`evidence-check-${check.id}`}>
            <div className="lens-panel__row-head">
              <span className="lens-panel__row-title">{check.label}</span>
              <span className={`lens-panel__chip lens-panel__chip--${STATUS_TONE[check.status]}`} data-testid={`evidence-status-${check.id}`}>
                {STATUS_LABEL[check.status]}
              </span>
            </div>
            <div className="lens-panel__row-meta">{check.detail}</div>
          </div>
        ))}
      </LensPanelSection>

      <ChangeHistorySection />
    </LensPanel>
  );
}

// ---------------------------------------------------------------------------
// Change history — G4 slice 4 (01 §9). The recorded audit trail, straight
// from the server's read model. Claim safety lives in the display model:
// times are the operator's clock as recorded (labelled), origins state the
// recorded surface/tool without certifying them, and fold summaries say
// detail was compressed. 01 §9 names this a drawer "tab"; the lens panel
// composes sections, so it ships as the drawer's Change history section.
// ---------------------------------------------------------------------------

function ChangeHistorySection(): ReactElement {
  const configId = useEditorStore((state) => state.configId);
  const isPublicPreview = useEditorStore((state) => state.isPublicPreview);
  const history = useChangeHistory(configId, !isPublicPreview);
  const rows = useMemo(() => changeHistoryRows(history.entries), [history.entries]);

  return (
    <div data-testid="evidence-change-history">
      <LensPanelSection label="Change history">
        {isPublicPreview && (
          <div className="lens-panel__row-meta">
            Sign in and claim this layout to start recording its change
            history — from then on, every saved edit appears here.
          </div>
        )}
        {!isPublicPreview && history.error && (
          <div className="lens-panel__row-meta">
            Couldn&apos;t load the change history — it stays recorded on the
            server; reopen the lens to retry.
          </div>
        )}
        {!isPublicPreview && !history.error && rows.length === 0 && !history.loading && (
          <div className="lens-panel__row-meta">
            No changes recorded yet — edits appear here once they&apos;re saved.
          </div>
        )}
        {!isPublicPreview && history.loading && rows.length === 0 && (
          <div className="lens-panel__row-meta">Loading the recorded trail…</div>
        )}
        {rows.map((row) => (
          <div key={row.ordinal} className="lens-panel__row" data-testid="change-history-row">
            <div className="lens-panel__row-head">
              <span className="lens-panel__row-title">{row.title}</span>
              <span className={`lens-panel__chip lens-panel__chip--${row.tone === "remove" ? "review" : row.tone === "note" ? "attention" : "info"}`}>
                {row.when}
              </span>
            </div>
            <div className="lens-panel__row-meta">{row.origin}</div>
          </div>
        ))}
        {rows.length > 0 && (
          <div className="lens-panel__row-meta">
            Times are the operator&apos;s clock, {rows[0]?.whenNote}.
          </div>
        )}
        {!isPublicPreview && history.hasMore && (
          <button
            type="button"
            className="lens-panel__chip lens-panel__chip--info"
            onClick={history.loadMore}
            disabled={history.loading}
          >
            {history.loading ? "Loading…" : "Load more"}
          </button>
        )}
      </LensPanelSection>
    </div>
  );
}
