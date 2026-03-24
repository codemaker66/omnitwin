// ---------------------------------------------------------------------------
// StatusBadge — colour-coded status pill
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: "#f3f4f6", text: "#6b7280" },
  submitted: { bg: "#dbeafe", text: "#2563eb" },
  under_review: { bg: "#fef3c7", text: "#d97706" },
  approved: { bg: "#d1fae5", text: "#059669" },
  rejected: { bg: "#fee2e2", text: "#dc2626" },
  withdrawn: { bg: "#e2e8f0", text: "#475569" },
  archived: { bg: "#f1f5f9", text: "#94a3b8" },
};

interface StatusBadgeProps {
  readonly status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const colors = STATUS_COLORS[status] ?? { bg: "#f3f4f6", text: "#6b7280" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 9999,
      fontSize: 11, fontWeight: 600, textTransform: "capitalize",
      background: colors.bg, color: colors.text,
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
