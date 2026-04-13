import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// ToastContainer — renders floating toast notifications
// ---------------------------------------------------------------------------

const INFO_COLORS = { bg: "#eff6ff", border: "#3b82f6" };
const TOAST_COLORS: Record<string, { bg: string; border: string }> = {
  success: { bg: "#f0fdf4", border: "#22c55e" },
  error: { bg: "#fef2f2", border: "#ef4444" },
  info: INFO_COLORS,
};

export function ToastContainer(): React.ReactElement | null {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Notifications"
      style={{
        position: "fixed", top: 16, right: 16, zIndex: 500,
        display: "flex", flexDirection: "column", gap: 8,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {toasts.map((t) => {
        const colors = TOAST_COLORS[t.type] ?? INFO_COLORS;
        return (
          <div key={t.id} role={t.type === "error" ? "alert" : undefined} style={{
            background: colors.bg, borderLeft: `3px solid ${colors.border}`,
            padding: "10px 16px", borderRadius: 8, fontSize: 13,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxWidth: 360,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              onClick={() => { removeToast(t.id); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#999", padding: 0 }}
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
