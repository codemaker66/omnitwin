import type { ReactElement } from "react";
import {
  BadgeCheck,
  Check,
  CircleDashed,
  FlaskConical,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  EVIDENCE_CHIP_LABELS,
  PROVENANCE_BADGE_LABELS,
  type EvidenceChipState,
  type ProvenanceBadge,
} from "../../lib/evidence-chip-model.js";
import "./EvidenceChip.css";

// CARD A4 (G2b) — the one chip grammar (01 §9 · 02 §3). Hue + icon + label
// always; hue never carries meaning alone. Four canonical states, four
// provenance badges. Renders as a real <button> when interactive, otherwise
// a keyboard-focusable status span, both with a visible focus ring.

const STATE_ICONS: Readonly<Record<EvidenceChipState, typeof Check>> = {
  current: Check,
  "review-required": TriangleAlert,
  stale: RotateCcw,
  missing: CircleDashed,
};

const PROVENANCE_ICONS: Readonly<Record<ProvenanceBadge, typeof Check>> = {
  operator: UserRound,
  "machine-checked": BadgeCheck,
  ai: Sparkles,
  simulated: FlaskConical,
};

export interface EvidenceChipProps {
  readonly state: EvidenceChipState;
  /** Optional detail after the canonical name, e.g. "re-run" or a rule name. */
  readonly detail?: string;
  readonly provenance?: ProvenanceBadge;
  /** When present the chip is a real button (e.g. opens the Evidence drawer). */
  readonly onActivate?: () => void;
  readonly className?: string;
}

function accessibleName(state: EvidenceChipState, detail?: string, provenance?: ProvenanceBadge): string {
  const base = `Evidence: ${EVIDENCE_CHIP_LABELS[state]}`;
  const withDetail = detail !== undefined && detail.length > 0 ? `${base} — ${detail}` : base;
  return provenance !== undefined
    ? `${withDetail} (${PROVENANCE_BADGE_LABELS[provenance]})`
    : withDetail;
}

export function EvidenceChip({
  state,
  detail,
  provenance,
  onActivate,
  className,
}: EvidenceChipProps): ReactElement {
  const StateIcon = STATE_ICONS[state];
  const classes = className !== undefined ? `evidence-chip ${className}` : "evidence-chip";
  const label = accessibleName(state, detail, provenance);

  const body = (
    <>
      <StateIcon className="evidence-chip__icon" size={12} aria-hidden="true" />
      <span className="evidence-chip__label">{EVIDENCE_CHIP_LABELS[state]}</span>
      {detail !== undefined && detail.length > 0 && (
        <span className="evidence-chip__detail">{detail}</span>
      )}
      {provenance !== undefined && <ProvenancePill provenance={provenance} />}
    </>
  );

  if (onActivate !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        data-state={state}
        aria-label={label}
        onClick={onActivate}
      >
        {body}
      </button>
    );
  }

  // Static badge: readable in browse mode via the label, but deliberately
  // NOT focusable and NOT a live region — focusability belongs to the
  // operable button branch above, and role="status" would announce every
  // list-rendered chip on mount (the truth rail shows seven at once).
  return (
    <span className={classes} data-state={state} aria-label={label}>
      {body}
    </span>
  );
}

function ProvenancePill({ provenance }: { readonly provenance: ProvenanceBadge }): ReactElement {
  const Icon = PROVENANCE_ICONS[provenance];
  return (
    <span className="evidence-chip__provenance" data-provenance={provenance}>
      <Icon size={10} aria-hidden="true" />
      {PROVENANCE_BADGE_LABELS[provenance]}
    </span>
  );
}
