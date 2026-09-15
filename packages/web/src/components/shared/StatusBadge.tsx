// ---------------------------------------------------------------------------
// StatusBadge — status pill
//
// T-615 (one register): the seven states were Tailwind grey/blue/amber/green/
// red/slate — six hue families on an ivory app. They now read as one family:
// ivory ground, forest ink, and a copper or sage cast only where the state is
// actually in motion or actually settled. The label is always the state's own
// word, so hue is never the sole carrier of meaning; `rejected` keeps a
// distinct oxblood because a refusal must not read as merely quiet.
//
// 11px is the app's small-text floor; the pill sits at that floor deliberately
// and must not go below it.
// ---------------------------------------------------------------------------

interface StatusTone {
  readonly bg: string;
  readonly text: string;
  readonly border: string;
}

const NEUTRAL: StatusTone = {
  bg: "var(--vv-ivory-2)", text: "var(--vv-forest-soft)", border: "var(--vv-rule)",
};
const COPPER: StatusTone = {
  bg: "rgba(169, 98, 47, 0.12)", text: "var(--vv-copper-ink)", border: "rgba(169, 98, 47, 0.38)",
};

const STATUS_COLORS: Record<string, StatusTone> = {
  draft: NEUTRAL,
  submitted: COPPER,
  under_review: COPPER,
  approved: { bg: "rgba(143, 174, 139, 0.22)", text: "var(--vv-sage-ink)", border: "rgba(85, 112, 90, 0.4)" },
  rejected: { bg: "#fbf0ec", text: "#8e3a2c", border: "rgba(142, 58, 44, 0.38)" },
  withdrawn: NEUTRAL,
  archived: NEUTRAL,
};

interface StatusBadgeProps {
  readonly status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const colors = STATUS_COLORS[status] ?? NEUTRAL;
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 9999,
      fontSize: 11, fontWeight: 600, textTransform: "capitalize",
      background: colors.bg, color: colors.text,
      border: `1px solid ${colors.border}`,
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
