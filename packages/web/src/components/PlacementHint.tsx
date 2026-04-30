import { useState, useEffect, useRef } from "react";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "../hooks/use-media-query.js";

// ---------------------------------------------------------------------------
// PlacementHint — contextual shortcut bar + invalid placement feedback
// ---------------------------------------------------------------------------

const STORAGE_KEY = "omni-placement-hint-dismissed";

const GOLD = "#c9a84c";
const AMBER = "#f59e0b";

// Inject animation keyframes once
const STYLE_ID = "omni-placement-hint";
if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes omni-hint-in {
      0%   { opacity: 0; transform: translateX(-50%) translateY(12px); filter: blur(6px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); filter: blur(0); }
    }
    @keyframes omni-hint-out {
      0%   { opacity: 1; transform: translateX(-50%) translateY(0); filter: blur(0); }
      100% { opacity: 0; transform: translateX(-50%) translateY(8px); filter: blur(4px); }
    }
    @keyframes omni-hint-shake {
      0%, 100% { transform: translateX(0); }
      20%  { transform: translateX(-3px); }
      40%  { transform: translateX(3px); }
      60%  { transform: translateX(-2px); }
      80%  { transform: translateX(2px); }
    }
  `;
  document.head.appendChild(s);
}

const barStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 32,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  zIndex: 50,
  pointerEvents: "auto",
  userSelect: "none",
};

const hintPillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "10px 22px",
  background: "linear-gradient(145deg, rgba(16,16,16,0.95), rgba(22,22,22,0.95))",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(201,168,76,0.15)",
  borderRadius: 14,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(201,168,76,0.08)",
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: "rgba(255,255,255,0.7)",
  whiteSpace: "nowrap" as const,
};

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 7px",
  borderRadius: 4,
  background: "rgba(201,168,76,0.12)",
  border: "1px solid rgba(201,168,76,0.2)",
  color: GOLD,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "'Inter', system-ui, sans-serif",
  lineHeight: 1.4,
};

const dotStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.2)",
  fontSize: 10,
};

const dismissBtnStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: "7px 14px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  color: "rgba(255,255,255,0.3)",
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "'Inter', system-ui, sans-serif",
  cursor: "pointer",
  transition: "all 0.2s ease",
  whiteSpace: "nowrap" as const,
  letterSpacing: 0.2,
};

const reasonPillStyle: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 10,
  background: "rgba(245,158,11,0.1)",
  border: "1px solid rgba(245,158,11,0.25)",
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: AMBER,
  whiteSpace: "nowrap" as const,
  transition: "opacity 0.2s ease",
};

export function PlacementHint(): React.ReactElement | null {
  const selectedItemId = useCatalogueStore((s) => s.selectedItemId);
  const ghostInvalidReason = usePlacementStore((s) => s.ghostInvalidReason);
  const isTouch = useIsCoarsePointer();
  const isNarrow = useIsNarrowViewport();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [exiting, setExiting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shownReason, setShownReason] = useState<string | null>(null);
  const reasonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeKeyRef = useRef(0);

  const isActive = selectedItemId !== null;
  const showHints = isActive && !dismissed;

  // Show reason when it appears, auto-clear after 2s
  useEffect(() => {
    if (ghostInvalidReason !== null && isActive) {
      setShownReason(ghostInvalidReason);
      shakeKeyRef.current += 1;
      if (reasonTimerRef.current !== null) clearTimeout(reasonTimerRef.current);
      reasonTimerRef.current = setTimeout(() => { setShownReason(null); }, 2000);
    } else {
      setShownReason(null);
    }
    return () => { if (reasonTimerRef.current !== null) clearTimeout(reasonTimerRef.current); };
  }, [ghostInvalidReason, isActive]);

  // Mount / unmount with exit animation
  useEffect(() => {
    if (isActive) {
      setExiting(false);
      setMounted(true);
    } else if (mounted) {
      setExiting(true);
      const timer = setTimeout(() => { setMounted(false); setExiting(false); }, 250);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [isActive, mounted]);

  if (!mounted) return null;

  const mobile = isTouch || isNarrow;

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Storage unavailable — still dismiss for this session
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid="placement-hint"
      style={{
        ...barStyle,
        ...(mobile ? {
          bottom: "calc(var(--toolbox-bottom, 64px) + 12px)",
          width: "calc(100vw - 24px)",
          maxWidth: 420,
          boxSizing: "border-box" as const,
          zIndex: 58,
        } : {}),
        animation: exiting
          ? "omni-hint-out 0.25s ease forwards"
          : "omni-hint-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {/* Invalid placement reason */}
      {shownReason !== null && (
        <div
          key={shakeKeyRef.current}
          style={{
            ...reasonPillStyle,
            ...(mobile ? {
              maxWidth: "100%",
              boxSizing: "border-box" as const,
              whiteSpace: "normal" as const,
              textAlign: "center" as const,
            } : {}),
            animation: "omni-hint-shake 0.4s ease",
          }}
        >
          {shownReason}
        </div>
      )}

      {/* Key hints row */}
      {showHints && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: mobile ? "center" : "flex-start",
          gap: mobile ? 8 : 0,
          width: mobile ? "100%" : "auto",
        }}>
          <div style={{
            ...hintPillStyle,
            ...(mobile ? {
              flex: "1 1 auto",
              minWidth: 0,
              justifyContent: "center",
              flexWrap: "wrap" as const,
              gap: "8px 10px",
              padding: "10px 12px",
              whiteSpace: "normal" as const,
              textAlign: "center" as const,
              fontSize: 12,
            } : {}),
          }}>
            {mobile ? (
              <>
                <span>Tap to place</span>
                <span style={dotStyle}>&bull;</span>
                <span>Drag to move</span>
                <span style={dotStyle}>&bull;</span>
                <span>Rotate</span>
                <span style={dotStyle}>&bull;</span>
                <span>Cancel</span>
              </>
            ) : (
              <>
                <span><span style={kbdStyle}>Click</span> Place</span>
                <span style={dotStyle}>&bull;</span>
                <span><span style={kbdStyle}>Q</span> <span style={kbdStyle}>E</span> Rotate</span>
                <span style={dotStyle}>&bull;</span>
                <span><span style={kbdStyle}>Esc</span> Cancel</span>
              </>
            )}
          </div>

          <button
            type="button"
            aria-label={mobile ? "Hide placement tip" : "Don't show placement tip again"}
            style={{
              ...dismissBtnStyle,
              ...(mobile ? {
                marginLeft: 0,
                flex: "0 0 auto",
                minWidth: 52,
                minHeight: 44,
                padding: "8px 12px",
                color: "rgba(255,255,255,0.68)",
              } : {}),
            }}
            onClick={handleDismiss}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(255,255,255,0.3)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
          >
            {mobile ? "Hide" : "Don't show again"}
          </button>
        </div>
      )}
    </div>
  );
}
