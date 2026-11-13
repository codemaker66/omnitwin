import { useMemo, type ReactElement } from "react";
import { ClipboardList } from "lucide-react";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { LensPanel, LensPanelSection } from "./LensPanel.js";
import { NotRecorded } from "./NotRecorded.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import { buildEvidencePack, type EvidenceCheck } from "../../../lib/cockpit-evidence-model.js";
import { changeHistoryRows } from "../../../lib/change-history-model.js";
import { useChangeHistory } from "../../../hooks/use-change-history.js";
import { usePlannerTruth, type PlannerTruth } from "../../../hooks/use-planner-truth.js";
import { TimeMachinePanel } from "../TimeMachinePanel.js";

// ---------------------------------------------------------------------------
// EvidenceLensPanel — the Layout Evidence Pack (Evidence lens panel).
//
// Each row says what is recorded about the layout, who stated it and when,
// and names the person to ask for what is not. There is no "Pass" chip: a
// tick is only honest for something a named person checked. Capacity reads
// the venue's published figure; escape routes and the room's maximum belong
// to the venue's fire risk assessment, so they show "Not recorded" with the
// hallkeeper to ask, never another country's code (redteam fix-first 2).
// ---------------------------------------------------------------------------

function EvidenceRow({ check, truth }: { readonly check: EvidenceCheck; readonly truth: PlannerTruth }): ReactElement {
  if (check.status === "not-recorded" && check.ask !== null) {
    return (
      <NotRecorded
        label={check.label}
        detail={check.detail}
        ask={truth.ask(check.ask)}
        testId={`evidence-check-${check.id}`}
      />
    );
  }
  if (check.status === "reading") {
    return (
      <div className="lens-panel__row lens-panel__row--info" data-testid={`evidence-check-${check.id}`}>
        <span className="lens-panel__row-title">{check.label}</span>
        <ActivityStatus className="lens-panel__row-meta">Reading the venue&apos;s published figures…</ActivityStatus>
      </div>
    );
  }
  const review = check.status === "review";
  const ask = check.ask !== null ? truth.ask(check.ask) : null;
  return (
    <div className={`lens-panel__row lens-panel__row--${review ? "review" : "info"}`} data-testid={`evidence-check-${check.id}`}>
      <div className="lens-panel__row-head">
        <span className="lens-panel__row-title">{check.label}</span>
        <span className={`lens-panel__chip lens-panel__chip--${review ? "review" : "info"}`} data-testid={`evidence-status-${check.id}`}>
          {review ? "Review" : "Noted"}
        </span>
      </div>
      <div className="lens-panel__row-meta">{check.detail}</div>
      {check.source !== null && <p className="lens-panel__stated" data-testid={`evidence-source-${check.id}`}>{check.source}</p>}
      {ask !== null && (ask.href !== null ? (
        <a className="lens-panel__ask" href={ask.href} data-testid={`evidence-ask-${check.id}`}>{ask.label}</a>
      ) : (
        <span className="lens-panel__unrecorded-hint">{ask.fallback}</span>
      ))}
    </div>
  );
}

export function EvidenceLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const truth = usePlannerTruth();

  const pack = useMemo(
    () => buildEvidencePack({
      placedItems,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      guestCount: plannedGuestCount,
      published: truth.published,
    }),
    [placedItems, dimensions, plannedGuestCount, truth.published],
  );

  const source = pack.reviewCount > 0
    ? `${String(pack.reviewCount)} to review`
    : pack.notRecordedCount > 0 ? `${String(pack.notRecordedCount)} not recorded` : "Noted";

  return (
    <LensPanel
      title="Layout evidence"
      icon={<ClipboardList size={18} />}
      source={source}
      testId="evidence-lens-panel"
      footer="Each row says what is recorded and who stated it. The venue's fire risk assessment sets each room's maximum and escape routes."
    >
      <LensPanelSection label="What is recorded">
        <div className="lens-panel__chips" data-testid="evidence-summary">
          {pack.reviewCount > 0 && (
            <span className="lens-panel__chip lens-panel__chip--review"><strong>{pack.reviewCount}</strong> to review</span>
          )}
          {pack.notRecordedCount > 0 && (
            <span className="lens-panel__chip lens-panel__chip--info"><strong>{pack.notRecordedCount}</strong> not recorded</span>
          )}
        </div>

        {pack.checks.map((check) => <EvidenceRow key={check.id} check={check} truth={truth} />)}
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
  // The live room anchors the trail — see TimeMachinePanel's `live` prop.
  // Rebuilt through Object.fromEntries because EditorObject is an interface
  // and so carries no implicit index signature; this satisfies ReplayObject
  // structurally rather than by asserting it with a cast.
  const editorObjects = useEditorStore((state) => state.objects);
  const liveObjects = useMemo(
    () => editorObjects.map((object) => ({ ...Object.fromEntries(Object.entries(object)), id: object.id })),
    [editorObjects],
  );
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
          <ActivityStatus className="lens-panel__row-meta">Loading the recorded trail…</ActivityStatus>
        )}
        {/* The time machine reads the SAME entries the list below renders,
            so the scrubbed plan and the written history can never disagree
            — and the trail gets a surface an operator can actually open. */}
        {history.entries.length > 0 && (
          <div className="lens-panel__row" style={{ padding: 0, border: "none", background: "none" }}>
            {/* hasMore means we hold only the oldest page while the live room
                reflects everything after it — every reconstruction is then off
                by the missing tail, so the panel says so and withdraws restore. */}
            <TimeMachinePanel
              entries={history.entries}
              live={liveObjects}
              trailComplete={!history.hasMore}
            />
          </div>
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
            {history.loading && <ActivityIndicator size={18} />}
            {history.loading ? "Loading…" : "Load more"}
          </button>
        )}
      </LensPanelSection>
    </div>
  );
}
