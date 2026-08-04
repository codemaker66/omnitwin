import type { ReactElement } from "react";
import { EvidenceChip } from "../components/evidence/EvidenceChip.js";
import {
  EVIDENCE_CHIP_LABELS,
  PROVENANCE_BADGE_LABELS,
  type EvidenceChipState,
  type ProvenanceBadge,
} from "../lib/evidence-chip-model.js";
import "./EvidenceChipFixturePage.css";

// CARD A4 — storybook-style fixture route (/dev/evidence-chips). Renders
// every chip state and provenance badge in one place so visual regression
// screenshots and manual review cover the whole grammar at once. Dev
// diagnostic surface; no API calls.

const STATES = Object.keys(EVIDENCE_CHIP_LABELS) as readonly EvidenceChipState[];
const PROVENANCES = Object.keys(PROVENANCE_BADGE_LABELS) as readonly ProvenanceBadge[];

const STATE_DETAILS: Readonly<Record<EvidenceChipState, string>> = {
  current: "12 checks",
  "review-required": "capacity check",
  stale: "re-run",
  missing: "no capture yet",
};

export function EvidenceChipFixturePage(): ReactElement {
  return (
    <main className="chip-fixture" data-testid="evidence-chip-fixture">
      <header className="chip-fixture__head">
        <h1>Evidence chip grammar</h1>
        <p>
          The four canonical states (01 §9) and four provenance badges (02 §3) on the House
          tokens. Planning evidence — human review required before operational reliance.
        </p>
      </header>

      <section className="chip-fixture__group" aria-label="Canonical states">
        <h2>States</h2>
        <div className="chip-fixture__row" data-testid="fixture-states">
          {STATES.map((state) => (
            <EvidenceChip key={state} state={state} />
          ))}
        </div>
      </section>

      <section className="chip-fixture__group" aria-label="States with detail">
        <h2>With detail</h2>
        <div className="chip-fixture__row" data-testid="fixture-details">
          {STATES.map((state) => (
            <EvidenceChip key={state} state={state} detail={STATE_DETAILS[state]} />
          ))}
        </div>
      </section>

      <section className="chip-fixture__group" aria-label="Provenance badges">
        <h2>Provenance</h2>
        <div className="chip-fixture__row" data-testid="fixture-provenance">
          {PROVENANCES.map((provenance) => (
            <EvidenceChip key={provenance} state="current" provenance={provenance} />
          ))}
        </div>
      </section>

      <section className="chip-fixture__group" aria-label="Interactive chip">
        <h2>Interactive (button)</h2>
        <div className="chip-fixture__row" data-testid="fixture-interactive">
          <EvidenceChip
            state="review-required"
            detail="opens the Evidence lens"
            onActivate={() => {
              // Fixture no-op: the real surfaces wire this to the Evidence drawer.
            }}
          />
        </div>
        <p className="chip-fixture__note">
          Tab to any chip for the visible focus ring; interactive chips are real buttons.
        </p>
      </section>
    </main>
  );
}

export default EvidenceChipFixturePage;
