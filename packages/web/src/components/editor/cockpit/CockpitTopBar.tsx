import { type ReactElement } from "react";
import { ShieldQuestion, Layers3, Eye, EyeOff } from "lucide-react";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { buildTopBarModel } from "../../../lib/cockpit-topbar-model.js";
import { COCKPIT_OVERLAY_KEYS, type CockpitOverlayKey } from "../../../lib/cockpit-modes.js";
import { useLinkedEvent, type LinkedEvent } from "../../../hooks/use-linked-event.js";
import "./CockpitTopBar.css";

const OVERLAY_LABELS: Readonly<Record<CockpitOverlayKey, string>> = {
  guestFlow: "Guest flow",
  routeClearance: "Route clearance",
  heritageBuffer: "Heritage buffer",
  densityHeatmap: "Density heatmap",
  lightingProbes: "Lighting probes",
  agentReplay: "Agents replay",
};

interface EventCell {
  readonly kicker: string;
  readonly value: string;
}

function eventCell(linked: LinkedEvent, phaseName: string | null): EventCell {
  if (linked.status === "loading") return { kicker: "Event", value: "Loading event…" };
  if (linked.status === "error") return { kicker: "Event", value: "Event unavailable" };
  if (linked.eventName === null) return { kicker: "Event", value: "No event linked" };
  return {
    kicker: "Event phase",
    value: phaseName !== null ? `${linked.eventName} → ${phaseName}` : linked.eventName,
  };
}

/**
 * Cockpit top bar — real, data-bound chrome. Venue + save status + placed-item
 * summary come from the editor store; the event/phase from an optional linked
 * event; the avatar from auth; the runtime label + Layers menu from the cockpit
 * store. SAFE wording is preserved verbatim. Replaces the Phase-1 placeholder.
 */
export function CockpitTopBar(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const objectCount = useEditorStore((s) => s.objects.length);
  const isDirty = useEditorStore((s) => s.isDirty);
  const isSaving = useEditorStore((s) => s.isSaving);
  const saveError = useEditorStore((s) => s.saveError);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const user = useAuthStore((s) => s.user);
  const runtimeAssetStatus = useCockpitStore((s) => s.runtimeAssetStatus);
  const layersOpen = useCockpitStore((s) => s.layersOpen);
  const overlayVisibility = useCockpitStore((s) => s.overlayVisibility);
  const selectedPhaseId = useCockpitStore((s) => s.selectedPhaseId);
  const linked = useLinkedEvent();

  const model = buildTopBarModel({
    spaceName: space?.name ?? null,
    isPublicPreview,
    objectCount,
    userName: user?.name ?? null,
    save: { isDirty, isSaving, saveError, lastSavedAt },
    runtimeAssetStatus,
  });

  const activePhase = linked.graph !== null
    ? (linked.graph.phases.find((phase) => phase.id === selectedPhaseId) ?? linked.graph.phases[0] ?? null)
    : null;
  const event = eventCell(linked, activePhase?.name ?? null);

  return (
    <header className="cockpit-topbar" data-testid="cockpit-topbar" aria-label="Planner status">
      <div className="cockpit-topbar__brand">
        <span className="cockpit-topbar__mark" aria-hidden="true">Vv</span>
        <span className="cockpit-topbar__brand-copy">
          <span className="cockpit-topbar__brand-title">Venviewer</span>
          <span className="cockpit-topbar__brand-sub">{model.brandSubtitle}</span>
        </span>
      </div>

      <div className="cockpit-topbar__cell">
        <span className="cockpit-topbar__kicker">Venue</span>
        <strong className="cockpit-topbar__value">{model.venueLabel}</strong>
      </div>

      <div className="cockpit-topbar__cell">
        <span className="cockpit-topbar__kicker">{event.kicker}</span>
        <strong className="cockpit-topbar__value cockpit-topbar__event">{event.value}</strong>
      </div>

      <span className="cockpit-topbar__badge">
        <ShieldQuestion size={14} aria-hidden="true" />
        {model.reviewBadge}
      </span>

      <div className="cockpit-topbar__cell cockpit-topbar__cell--save" data-save-status={model.saveStatus}>
        <span className="cockpit-topbar__dot" aria-hidden="true" />
        <span className="cockpit-topbar__save-copy">
          <span className="cockpit-topbar__kicker">Save status</span>
          <strong className="cockpit-topbar__value">{model.saveLabel}</strong>
        </span>
      </div>

      <div className="cockpit-topbar__cell cockpit-topbar__cell--runtime">
        <span className="cockpit-topbar__kicker">Runtime asset</span>
        <strong className="cockpit-topbar__value">{model.runtimeLabel}</strong>
      </div>

      <div className="cockpit-topbar__actions">
        <span className="cockpit-topbar__summary">{model.summaryLabel}</span>
        <div className="cockpit-topbar__layers">
          <button
            type="button"
            className={layersOpen ? "cockpit-topbar__layers-btn is-open" : "cockpit-topbar__layers-btn"}
            aria-label="Layers"
            aria-haspopup="menu"
            aria-expanded={layersOpen}
            onClick={() => { useCockpitStore.getState().toggleLayers(); }}
          >
            <Layers3 size={18} aria-hidden="true" />
          </button>
          {layersOpen && (
            <div className="cockpit-topbar__menu" role="menu" aria-label="Layers">
              <p className="cockpit-topbar__menu-head">Scene overlays</p>
              {COCKPIT_OVERLAY_KEYS.map((key) => {
                const visible = overlayVisibility[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={visible}
                    className={visible ? "cockpit-topbar__menu-item is-on" : "cockpit-topbar__menu-item"}
                    onClick={() => { useCockpitStore.getState().toggleOverlay(key); }}
                  >
                    {visible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
                    <span>{OVERLAY_LABELS[key]}</span>
                  </button>
                );
              })}
              <p className="cockpit-topbar__menu-note">Overlays are planning aids · human review required.</p>
            </div>
          )}
        </div>
        {model.userInitials !== null && (
          <span className="cockpit-topbar__avatar" aria-label={`Signed in as ${user?.name ?? "user"}`}>
            {model.userInitials}
          </span>
        )}
      </div>
    </header>
  );
}
