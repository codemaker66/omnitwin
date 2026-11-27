import { useCallback, useEffect, useRef } from "react";
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
  error: { bg: "var(--vv-oxblood-bg)", border: "var(--vv-oxblood)" },
  info: INFO_COLORS,
};

export function ToastContainer(): React.ReactElement {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const holdToasts = useToastStore((s) => s.holdToasts);
  const releaseToasts = useToastStore((s) => s.releaseToasts);
  const regionRef = useRef<HTMLDivElement>(null);
  const pointerOver = useRef(false);
  /** Where the keyboard was before it came into the notifications. */
  const cameFrom = useRef<HTMLElement | null>(null);

  // Somebody is reading while the pointer rests on a notification or the
  // keyboard is inside them; the clock starts again only when both have left.
  // Whether the keyboard is inside is looked up, never remembered: a dismissed
  // button is removed from the page without a blur ever arriving here, so a
  // remembered "focused" would stay true and hold every later notification.
  const settle = useCallback((keyboardInside: boolean): void => {
    const region = regionRef.current;
    const pointerOnOne = pointerOver.current && region !== null && region.childElementCount > 0;
    if (keyboardInside || pointerOnOne) holdToasts();
    else releaseToasts();
  }, [holdToasts, releaseToasts]);
  const keyboardInside = useCallback(
    (): boolean => regionRef.current?.contains(document.activeElement) === true,
    [],
  );

  // After every notification that arrives or goes. A pointer cannot be over a
  // stack that has emptied, and no mouseleave says so until it next moves.
  useEffect(() => {
    if (toasts.length === 0) pointerOver.current = false;
    settle(keyboardInside());
  }, [toasts, settle, keyboardInside]);
  // The page is not left holding the clock if this goes while someone reads.
  useEffect(() => releaseToasts, [releaseToasts]);

  /** Dismisses one. If the keyboard was on its button, focus is put somewhere
   *  on purpose rather than dropped: the next notification, or back where the
   *  keyboard came from, or the page's main content. */
  const dismiss = (id: string, button: HTMLButtonElement): void => {
    const hadFocus = document.activeElement === button;
    const buttons = Array.from(regionRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(button);
    const neighbour = buttons[at + 1] ?? buttons[at - 1] ?? null;
    removeToast(id);
    if (!hadFocus) return;
    const origin = cameFrom.current !== null && cameFrom.current.isConnected ? cameFrom.current : null;
    (neighbour ?? origin ?? document.getElementById("dashboard-main"))?.focus();
  };

  // The region is on the page from the first paint and stays when it empties.
  // A live region created together with its first message is commonly not
  // announced, so "Venue settings saved" used to go unheard. It is not atomic:
  // a region that stays would otherwise have every notification still showing
  // read out again each time one arrives.
  return (
    <div
      ref={regionRef}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Notifications"
      onMouseEnter={() => { pointerOver.current = true; settle(keyboardInside()); }}
      onMouseLeave={() => { pointerOver.current = false; settle(keyboardInside()); }}
      onFocus={(event) => {
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) cameFrom.current = from;
        settle(true);
      }}
      onBlur={(event) => {
        const to = event.relatedTarget;
        settle(to instanceof Node && event.currentTarget.contains(to));
      }}
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
              onClick={(event) => { dismiss(t.id, event.currentTarget); }}
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
