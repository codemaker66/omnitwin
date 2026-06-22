import { type ChangeEvent, type ReactElement } from "react";
import { CircleDollarSign } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useCostStore } from "../../../stores/cost-store.js";
import { costQuantitiesFromLayout, buildCostScenario, coversSourceLabel } from "../../../lib/cockpit-cost-model.js";
import { parsePoundsToMinor, formatMinorAsCurrency } from "../../../lib/money-input.js";

// ---------------------------------------------------------------------------
// CostsLensPanel — layout-driven cost scenario (Epic 3, second real lens panel).
//
// Quantities come from the live layout (covers from the guest count or placed
// chairs; tables / AV from placed items); rates are the planner's editable
// inputs. Exact integer-pence arithmetic. SAFE: a scenario estimate from
// editable rates, never a quote — the defaults are example rates, not prices.
// ---------------------------------------------------------------------------

/** An editable pounds rate field bound to integer minor units in the store. */
function RateField({
  label, minor, onMinor, testId,
}: {
  readonly label: string;
  readonly minor: number;
  readonly onMinor: (minor: number) => void;
  readonly testId: string;
}): ReactElement {
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (raw === "") {
      onMinor(0);
      return;
    }
    const parsed = parsePoundsToMinor(raw);
    if (parsed !== null) onMinor(parsed);
  };
  return (
    <label className="lens-panel__field lens-panel__field--inline">
      <span className="lens-panel__field-label">{label}</span>
      <input
        className="lens-panel__input"
        type="text"
        inputMode="decimal"
        value={String(minor / 100)}
        onChange={onChange}
        data-testid={testId}
        aria-label={label}
      />
    </label>
  );
}

export function CostsLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);

  const roomHireMinor = useCostStore((state) => state.roomHireMinor);
  const cateringPerCoverMinor = useCostStore((state) => state.cateringPerCoverMinor);
  const furniturePerTableMinor = useCostStore((state) => state.furniturePerTableMinor);
  const avPerItemMinor = useCostStore((state) => state.avPerItemMinor);
  const marginPercent = useCostStore((state) => state.marginPercent);
  const setRoomHireMinor = useCostStore((state) => state.setRoomHireMinor);
  const setCateringPerCoverMinor = useCostStore((state) => state.setCateringPerCoverMinor);
  const setFurniturePerTableMinor = useCostStore((state) => state.setFurniturePerTableMinor);
  const setAvPerItemMinor = useCostStore((state) => state.setAvPerItemMinor);
  const setMarginPercent = useCostStore((state) => state.setMarginPercent);

  const quantities = costQuantitiesFromLayout(placedItems, plannedGuestCount);
  const model = buildCostScenario(quantities, {
    roomHireMinor,
    cateringPerCoverMinor,
    furniturePerTableMinor,
    avPerItemMinor,
    marginPercent,
  });

  const onMargin = (event: ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number.parseInt(event.target.value, 10);
    setMarginPercent(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <LensPanel
      eyebrow="Costs lens"
      title="Cost scenario"
      icon={<CircleDollarSign size={18} />}
      source="Estimate"
      testId="costs-lens-panel"
      footer="Scenario estimate from your editable rates — not a quote or an offer. Confirm pricing with the venue."
    >
      <LensPanelSection label="Rates (editable)">
        <p className="lens-panel__field-hint">Starting example rates — edit to your venue&apos;s pricing.</p>
        <RateField label="Room hire (£)" minor={roomHireMinor} onMinor={setRoomHireMinor} testId="cost-room-hire" />
        <RateField label="Catering (£/cover)" minor={cateringPerCoverMinor} onMinor={setCateringPerCoverMinor} testId="cost-catering" />
        <RateField label="Furniture (£/table)" minor={furniturePerTableMinor} onMinor={setFurniturePerTableMinor} testId="cost-furniture" />
        <RateField label="AV (£/item)" minor={avPerItemMinor} onMinor={setAvPerItemMinor} testId="cost-av" />
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Margin (%)</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={String(marginPercent)}
            onChange={onMargin}
            data-testid="cost-margin"
            aria-label="Margin percent"
          />
        </label>
      </LensPanelSection>

      <LensPanelSection label="Estimate">
        {model.lineItems.map((line) => (
          <div key={line.key} className="lens-panel__cost-line">
            <span className="lens-panel__cost-line-label">
              {line.label}
              <small>{line.detail}</small>
            </span>
            <span className="lens-panel__cost-line-amount">{formatMinorAsCurrency(line.amountMinor)}</span>
          </div>
        ))}
        <LensPanelMetric label="Subtotal" value={formatMinorAsCurrency(model.subtotalMinor)} />
        {model.marginMinor > 0 && (
          <LensPanelMetric label={`Margin (${String(marginPercent)}%)`} value={formatMinorAsCurrency(model.marginMinor)} />
        )}
        <div className="lens-panel__cost-line lens-panel__cost-line--total" data-testid="cost-total">
          <span className="lens-panel__cost-line-label">
            Total estimate
            <small>
              {model.perCoverMinor !== null
                ? `${formatMinorAsCurrency(model.perCoverMinor)} per cover`
                : "set a guest count for a per-cover figure"}
            </small>
          </span>
          <span className="lens-panel__cost-line-amount">{formatMinorAsCurrency(model.totalMinor)}</span>
        </div>
      </LensPanelSection>

      <LensPanelSection label="From the layout">
        <LensPanelMetric label="Covers" value={`${String(quantities.covers)} · ${coversSourceLabel(quantities.coversSource)}`} />
        <LensPanelMetric label="Tables" value={String(quantities.tables)} />
        <LensPanelMetric label="Chairs" value={String(quantities.chairs)} />
        <LensPanelMetric label="AV items" value={String(quantities.avItems)} />
      </LensPanelSection>
    </LensPanel>
  );
}
