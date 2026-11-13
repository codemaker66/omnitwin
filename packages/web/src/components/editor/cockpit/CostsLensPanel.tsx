import { useMemo, type ChangeEvent, type ReactElement } from "react";
import { CircleDollarSign } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useCostStore } from "../../../stores/cost-store.js";
import { useLightingRigStore } from "../../../stores/lighting-rig-store.js";
import { usePlannerTruth, type PlannerTruth } from "../../../hooks/use-planner-truth.js";
import {
  costQuantitiesFromLayout,
  buildCostScenario,
  coversSourceLabel,
  type CostQuantities,
} from "../../../lib/cockpit-cost-model.js";
import { parsePoundsToMinor, formatMinorAsCurrency } from "../../../lib/money-input.js";

// ---------------------------------------------------------------------------
// CostsLensPanel — what this plan costs, said honestly to each viewer.
//
// Clients and visitors never see an example price: the planner's built-in
// rates (£750 room hire, £45 a cover…) are not Trades Hall's, and a "Total
// estimate" built on them once read £5,044 against a published £2,800. They
// see "Ask us for a quote", with the plan's own numbers carried in the drafted
// question. A published rate could stand here only with its year, its source,
// VAT and every compulsory charge; the venue's published wedding rates do not
// yet record VAT or compulsory charges, so none is shown (redteam fix-first 3).
//
// Venue staff keep the editable scenario, every rate marked as an example and
// not the venue's price. Staff is the planner's existing gate (usePlannerTruth
// → canReadInternalEventData). Exact integer-pence arithmetic throughout.
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

/** The plan's own quantities: what a quote is built from. No prices. */
function LayoutQuantities({ quantities }: { readonly quantities: CostQuantities }): ReactElement {
  return (
    <LensPanelSection label="From the layout">
      <LensPanelMetric label="Covers" value={`${String(quantities.covers)} · ${coversSourceLabel(quantities.coversSource)}`} />
      <LensPanelMetric label="Tables" value={String(quantities.tables)} />
      <LensPanelMetric label="Chairs" value={String(quantities.chairs)} />
      <LensPanelMetric label="AV items" value={String(quantities.avItems)} />
      <LensPanelMetric label="Lighting fixtures" value={`${String(quantities.lightingFixtures)} · from the rig`} />
    </LensPanelSection>
  );
}

/** Clients and visitors: the way to a real price, never an example one. */
function QuoteCosts({
  quantities, guestCount, truth,
}: {
  readonly quantities: CostQuantities;
  readonly guestCount: number | null;
  readonly truth: PlannerTruth;
}): ReactElement {
  const ask = truth.ask({ kind: "quote", guests: guestCount, tables: quantities.tables, chairs: quantities.chairs });
  return (
    <LensPanel
      title="Costs"
      icon={<CircleDollarSign size={18} />}
      source="Quote"
      testId="costs-lens-panel"
      footer="Every price comes from the venue's events team."
    >
      <LensPanelSection label="Price">
        <div className="lens-panel__quote" data-testid="costs-quote">
          <p className="lens-panel__paragraph">
            The events team prices each event for its date, room and needs. Your question carries this plan&apos;s numbers.
          </p>
          {ask.href !== null ? (
            <a className="lens-panel__ask" href={ask.href} data-testid="costs-quote-ask">{ask.label}</a>
          ) : (
            <span className="lens-panel__unrecorded-hint" data-testid="costs-quote-next">{ask.fallback}</span>
          )}
        </div>
      </LensPanelSection>
      <LayoutQuantities quantities={quantities} />
    </LensPanel>
  );
}

/** Venue staff: the editable scenario, at example rates marked as such. */
function ExampleCosts({ quantities }: { readonly quantities: CostQuantities }): ReactElement {
  const roomHireMinor = useCostStore((state) => state.roomHireMinor);
  const cateringPerCoverMinor = useCostStore((state) => state.cateringPerCoverMinor);
  const furniturePerTableMinor = useCostStore((state) => state.furniturePerTableMinor);
  const avPerItemMinor = useCostStore((state) => state.avPerItemMinor);
  const lightingPerFixtureMinor = useCostStore((state) => state.lightingPerFixtureMinor);
  const marginPercent = useCostStore((state) => state.marginPercent);
  const setRoomHireMinor = useCostStore((state) => state.setRoomHireMinor);
  const setCateringPerCoverMinor = useCostStore((state) => state.setCateringPerCoverMinor);
  const setFurniturePerTableMinor = useCostStore((state) => state.setFurniturePerTableMinor);
  const setAvPerItemMinor = useCostStore((state) => state.setAvPerItemMinor);
  const setLightingPerFixtureMinor = useCostStore((state) => state.setLightingPerFixtureMinor);
  const setMarginPercent = useCostStore((state) => state.setMarginPercent);

  const model = buildCostScenario(quantities, {
    roomHireMinor,
    cateringPerCoverMinor,
    furniturePerTableMinor,
    avPerItemMinor,
    lightingPerFixtureMinor,
    marginPercent,
  });

  const onMargin = (event: ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number.parseInt(event.target.value, 10);
    setMarginPercent(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <LensPanel
      title="Cost scenario"
      icon={<CircleDollarSign size={18} />}
      source="Example rates"
      testId="costs-lens-panel"
      footer="Example rates for venue staff, not the venue's prices and not a quote. Clients and visitors see “Ask us for a quote” here."
    >
      <LensPanelSection label="Example rates">
        <p className="lens-panel__field-hint" data-testid="cost-example-note">Example rates, not the venue&apos;s prices. Replace them with real figures to plan.</p>
        <RateField label="Room hire (£)" minor={roomHireMinor} onMinor={setRoomHireMinor} testId="cost-room-hire" />
        <RateField label="Catering (£/cover)" minor={cateringPerCoverMinor} onMinor={setCateringPerCoverMinor} testId="cost-catering" />
        <RateField label="Furniture (£/table)" minor={furniturePerTableMinor} onMinor={setFurniturePerTableMinor} testId="cost-furniture" />
        <RateField label="AV (£/item)" minor={avPerItemMinor} onMinor={setAvPerItemMinor} testId="cost-av" />
        <RateField label="Lighting (£/fixture)" minor={lightingPerFixtureMinor} onMinor={setLightingPerFixtureMinor} testId="cost-lighting" />
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

      <LensPanelSection label="At these rates">
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
            Total at example rates
            <small>
              {model.perCoverMinor !== null
                ? `${formatMinorAsCurrency(model.perCoverMinor)} per cover`
                : "Set guest count for price per cover"}
            </small>
          </span>
          <span className="lens-panel__cost-line-amount">{formatMinorAsCurrency(model.totalMinor)}</span>
        </div>
      </LensPanelSection>

      <LayoutQuantities quantities={quantities} />
    </LensPanel>
  );
}

export function CostsLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const rigCounts = useLightingRigStore((state) => state.counts);
  const truth = usePlannerTruth();
  const lightingFixtures = useMemo(
    () => Object.values(rigCounts).reduce((sum, n) => sum + n, 0),
    [rigCounts],
  );
  const quantities = costQuantitiesFromLayout(placedItems, plannedGuestCount, lightingFixtures);

  return truth.staff
    ? <ExampleCosts quantities={quantities} />
    : <QuoteCosts quantities={quantities} guestCount={plannedGuestCount} truth={truth} />;
}
