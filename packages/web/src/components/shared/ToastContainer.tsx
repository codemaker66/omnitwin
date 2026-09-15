import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// ToastContainer — renders floating toast notifications
//
// T-615 (one register): the toast palette was Tailwind's default blue/green/red
// on white — a second visual register sitting on top of an ivory app. It now
// draws from the House layer: an ivory sheet, forest ink, and one meaning-
// bearing edge (sage for success, oxblood for error, copper otherwise). Hue
// never carries the meaning alone — the message says what happened, and an
// error additionally carries role="alert".
// ---------------------------------------------------------------------------

interface ToastTone {
  readonly bg: string;
  readonly border: string;
}

const INFO_COLORS: ToastTone = { bg: "var(--vv-ivory-3)", border: "var(--vv-copper)" };
const TOAST_COLORS: Record<string, ToastTone> = {
  success: { bg: "var(--vv-ivory-3)", border: "var(--vv-sage-ink)" },
  error: { bg: "#fbf0ec", border: "#8e3a2c" },
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
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {toasts.map((t) => {
        const colors = TOAST_COLORS[t.type] ?? INFO_COLORS;
        return (
          <div key={t.id} role={t.type === "error" ? "alert" : undefined} style={{
            background: colors.bg,
            border: "1px solid var(--vv-rule)",
            borderLeft: `3px solid ${colors.border}`,
            padding: "10px 14px", borderRadius: 8, fontSize: 13,
            color: "var(--vv-forest)",
            boxShadow: "0 10px 26px rgba(27, 58, 47, 0.16)", maxWidth: 360,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              onClick={() => { removeToast(t.id); }}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flex: "0 0 auto", width: 28, height: 28,
                background: "none", border: "none", borderRadius: 6,
                cursor: "pointer", fontSize: 16, lineHeight: 1,
                color: "var(--vv-forest-soft)", padding: 0,
              }}
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
