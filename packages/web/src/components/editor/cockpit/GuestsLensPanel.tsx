import { useMemo, type ChangeEvent, type ReactElement } from "react";
import { Users } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import { MAX_GUEST_FLOW_AGENTS } from "../../../lib/guest-flow-layout-input.js";
import {
  buildGuestsCapacityModel,
  seatSufficiencyLabel,
  type GuestsCapacityModel,
} from "../../../lib/cockpit-guests-model.js";
import type { ComfortBand } from "../../../lib/layout-capacity.js";

// ---------------------------------------------------------------------------
// GuestsLensPanel — guests & seating (Epic 0, fourth real lens panel).
//
// Answers the two questions a planner actually asks of a headcount: is there a
// seat for every guest (placed chairs vs the guest count), and is the room
// comfortable for them (the planning-grade capacity engine, in the seating
// style on the floor). The guest count is the SAME cockpit-store field the
// Flow, Costs and Share lenses read, so setting it here flows everywhere.
// SAFE: comfort figures are planning-grade estimates, not an occupancy limit.
// ---------------------------------------------------------------------------

type ChipTone = "ok" | "attention" | "review" | "info";

function seatChip(model: GuestsCapacityModel): { readonly tone: ChipTone; readonly label: string } {
  switch (model.seatStatus) {
    case "short": return { tone: "review", label: `Short ${String(Math.abs(model.seatBalance ?? 0))}` };
    case "spare": return { tone: "ok", label: `${String(model.seatBalance ?? 0)} spare` };
    case "exact": return { tone: "ok", label: "Every guest seated" };
    case "unset": return { tone: "info", label: "No guest count" };
  }
}

function comfortChip(band: ComfortBand): { readonly tone: ChipTone; readonly label: string } {
  switch (band) {
    case "over-capacity": return { tone: "review", label: "Over capacity" };
    case "tight": return { tone: "attention", label: "Tight" };
    case "comfortable": return { tone: "ok", label: "Comfortable" };
    case "spacious": return { tone: "ok", label: "Spacious" };
    case "open": return { tone: "info", label: "Open floor" };
  }
}

function seatBalanceText(model: GuestsCapacityModel): string {
  if (model.seatBalance === null) return "—";
  if (model.seatBalance === 0) return "Exact";
  if (model.seatBalance > 0) return `${String(model.seatBalance)} spare`;
  return `${String(Math.abs(model.seatBalance))} short`;
}

function meterTone(band: ComfortBand): ChipTone {
  if (band === "over-capacity") return "review";
  if (band === "tight") return "attention";
  return "ok";
}

export function GuestsLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const setPlannedGuestCount = useCockpitStore((state) => state.setPlannedGuestCount);

  const model = useMemo(
    () => buildGuestsCapacityModel({
      placedItems,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      guestCount: plannedGuestCount,
    }),
    [placedItems, dimensions, plannedGuestCount],
  );

  const onGuestCount = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (raw === "") { setPlannedGuestCount(null); return; }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    setPlannedGuestCount(Math.max(1, Math.min(MAX_GUEST_FLOW_AGENTS, parsed)));
  };

  const seat = seatChip(model);
  const comfort = comfortChip(model.band);
  const meterPct = Math.min(100, Math.max(0, model.utilizationPercent));

  return (
    <LensPanel
      eyebrow="Guests lens"
      title="Guests & seating"
      icon={<Users size={18} />}
      source="Planning"
      testId="guests-lens-panel"
      footer="Comfort figures are planning-grade estimates — human review required; not an occupancy or fire-capacity limit. Confirm with the venue team."
    >
      <LensPanelSection label="Headcount">
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Expected guests</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GUEST_FLOW_AGENTS}
            value={plannedGuestCount === null ? "" : String(plannedGuestCount)}
            placeholder="Set count"
            onChange={onGuestCount}
            data-testid="guests-count"
            aria-label="Expected guests"
          />
        </label>
        <p className="lens-panel__field-hint">Shared with the Flow, Costs and Share lenses.</p>
      </LensPanelSection>

      <LensPanelSection label="Seats">
        <div className="lens-panel__chips">
          <span className={`lens-panel__chip lens-panel__chip--${seat.tone}`} data-testid="guests-seat-chip">{seat.label}</span>
        </div>
        <p className="lens-panel__paragraph" data-testid="guests-seat-summary">{seatSufficiencyLabel(model)}</p>
        <LensPanelMetric label="Seats placed" value={String(model.seatsProvided)} />
        <LensPanelMetric label="Seat balance" value={seatBalanceText(model)} />
      </LensPanelSection>

      <LensPanelSection label="Room comfort">
        <div className="lens-panel__chips">
          <span className={`lens-panel__chip lens-panel__chip--${comfort.tone}`} data-testid="guests-comfort-chip">{comfort.label}</span>
        </div>
        <p className="lens-panel__paragraph lens-panel__paragraph--muted">{model.bandLabel}</p>
        <div className="lens-panel__meter" aria-hidden="true">
          <div
            className={`lens-panel__meter-fill lens-panel__meter-fill--${meterTone(model.band)}`}
            style={{ width: `${String(meterPct)}%` }}
          />
        </div>
        <LensPanelMetric label="Comfortable capacity" value={`${String(model.comfortableCapacity)} · ${model.styleLabel}`} />
        <LensPanelMetric label="Using" value={`${String(model.utilizationPercent)}% of comfortable`} />
        <LensPanelMetric label="Tight capacity" value={String(model.tightCapacity)} />
      </LensPanelSection>
    </LensPanel>
  );
}
