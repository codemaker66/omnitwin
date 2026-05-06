import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useIsCoarsePointer, useIsNarrowViewport } from "../../hooks/use-media-query.js";
import {
  MousePointer2, Armchair, RotateCw, Trash2, Undo2, Redo2,
  Camera, Grid3X3, Save, User, Eye, FileText, Check, X, MoreHorizontal,
} from "lucide-react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useVisibilityStore, WALL_KEYS } from "../../stores/visibility-store.js";
import { AuthModal } from "./AuthModal.js";
import {
  copyForEditorSaveStatus,
  deriveEditorSaveStatus,
  type EditorSaveStatus,
} from "../../lib/editor-save-status.js";
import {
  CATALOGUE_CATEGORIES,
  getCatalogueByCategory,
  getCatalogueItem,
  categoryLabel,
  catalogueIcon,
} from "../../lib/catalogue.js";
import type { CatalogueItem } from "../../lib/catalogue.js";


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TOOLBAR_W = 68;
const PANEL_W = 290;
const GOLD = "#c9a84c";
const ICON_SIZE = 22;

const toolbarStyle: React.CSSProperties = {
  position: "fixed", left: 0, top: 0, bottom: 0, width: TOOLBAR_W,
  // Subtle gradient + gold-tinted right border reads as "premium tool
  // rail" instead of a flat dark strip; the outer shadow and inset
  // accent tick give depth without competing with the 3D canvas.
  background: "linear-gradient(180deg, #151515 0%, #1a1a1a 50%, #141414 100%)",
  borderRight: "1px solid rgba(201,168,76,0.15)",
  boxShadow: "2px 0 20px rgba(0,0,0,0.35), inset -1px 0 0 rgba(201,168,76,0.03)",
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "14px 0", gap: 6, zIndex: 50,
  boxSizing: "border-box",
  fontFamily: "'Inter', sans-serif",
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarWidth: "none",
};

const btnStyle = (active: boolean, disabled = false, compact = false): React.CSSProperties => ({
  // Compact mode (narrow viewport bottom rail) keeps the original 48x48
  // square. Default desktop mode grows vertically to fit a 9px caption
  // beneath the icon — taller button + tighter rail gap = same rough
  // overall toolbar height even with 12 captions.
  width: compact ? 56 : 58,
  height: compact ? 52 : 58,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: compact ? 2 : 3,
  border: "1px solid transparent",
  borderRadius: 10,
  cursor: disabled ? "default" : "pointer",
  background: active
    ? `linear-gradient(145deg, ${GOLD}, #b6962f)`
    : "rgba(255,255,255,0.02)",
  color: active ? "#0e0e0e" : disabled ? "#555" : "#d8d8d8",
  transition: "background 0.18s, color 0.18s, border-color 0.18s, transform 0.18s",
  opacity: disabled ? 0.4 : 1,
  boxShadow: active
    ? "0 4px 16px rgba(201,168,76,0.35), inset 0 1px 0 rgba(255,255,255,0.2)"
    : "none",
  padding: 0,
});

const dividerStyle: React.CSSProperties = {
  width: 28, height: 1, background: "#333", margin: "4px 0",
};

const panelStyle: React.CSSProperties = {
  position: "fixed", left: TOOLBAR_W, top: 0, bottom: 0, width: PANEL_W,
  background: "linear-gradient(180deg, rgba(16,16,16,0.98) 0%, rgba(22,22,22,0.98) 100%)",
  borderRight: "1px solid rgba(201,168,76,0.1)",
  zIndex: 49, overflowY: "auto", padding: "24px 16px",
  fontFamily: "'Inter', sans-serif", color: "#ccc",
  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  boxShadow: "8px 0 40px rgba(0,0,0,0.4), inset -1px 0 0 rgba(201,168,76,0.05)",
};

const categoryHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2,
  color: GOLD, padding: "16px 8px 8px", cursor: "pointer",
  display: "flex", justifyContent: "space-between", alignItems: "center",
  borderBottom: "1px solid rgba(201,168,76,0.08)",
};

const assetRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
  borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#ddd",
  transition: "background 0.15s, border-color 0.15s",
};

const cameraDropdownStyle: React.CSSProperties = {
  position: "fixed", left: TOOLBAR_W + 8, background: "linear-gradient(145deg, #141414, #1c1c1c)",
  borderRadius: 16, padding: "12px 8px", zIndex: 51,
  boxShadow: "0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.12)",
  border: "1px solid rgba(201,168,76,0.15)", minWidth: 200,
};

const cameraItemStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 3, width: "100%", padding: "10px 14px", fontSize: 14,
  background: "none", border: "none", color: "#ccc", cursor: "pointer",
  textAlign: "left", borderRadius: 8, fontFamily: "'Inter', sans-serif",
};


// ---------------------------------------------------------------------------
// Tooltip — rich animated popout labels
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Delayed unmount hook — keeps element mounted during exit animation
// ---------------------------------------------------------------------------

function useDelayedUnmount(isOpen: boolean, delayMs: number): boolean {
  const [mounted, setMounted] = useState(isOpen);
  // The previous `alive` ref guard (`if (alive.current) setMounted(false)`)
  // was intended to prevent state updates on unmounted components — but React
  // StrictMode double-invokes the mount/unmount cycle, leaving the ref stuck
  // at `false` after the simulated unmount. The timeout callback then skips
  // `setMounted(false)`, so the element is never removed from the DOM.
  // React 18 silently discards state updates on truly unmounted components,
  // making the guard unnecessary. The cleanup return already handles the
  // timeout lifecycle correctly via clearTimeout.
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
    } else {
      const t = setTimeout(() => { setMounted(false); }, delayMs);
      return () => { clearTimeout(t); };
    }
  }, [isOpen, delayMs]);
  return mounted;
}

// Panel entrance animations
const PANEL_ANIM_ID = "omni-panel-anims";
if (typeof document !== "undefined" && document.getElementById(PANEL_ANIM_ID) === null) {
  const ps = document.createElement("style");
  ps.id = PANEL_ANIM_ID;
  ps.textContent = `
    @keyframes omni-panel-slide {
      0% { transform: translateX(-100%); opacity: 0; filter: blur(8px); }
      60% { transform: translateX(8px); filter: blur(0); }
      100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes omni-panel-slide-out {
      0% { transform: translateX(0); opacity: 1; filter: blur(0); }
      100% { transform: translateX(-100%); opacity: 0; filter: blur(8px); }
    }
    @keyframes omni-panel-item {
      0% { opacity: 0; transform: translateX(-16px); }
      100% { opacity: 1; transform: translateX(0); }
    }
    @keyframes omni-dropdown-pop {
      0% { opacity: 0; transform: scale(0.9) translateY(-8px); filter: blur(4px); }
      60% { transform: scale(1.02) translateY(2px); }
      100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
    }
    @keyframes omni-dropdown-pop-out {
      0% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
      100% { opacity: 0; transform: scale(0.9) translateY(-8px); filter: blur(4px); }
    }
    .omni-asset-row {
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    .omni-asset-row:hover {
      background: rgba(201,168,76,0.08) !important;
      padding-left: 16px !important;
      border-left: 2px solid rgba(201,168,76,0.5) !important;
    }
    .omni-asset-row:active {
      transform: scale(0.97);
      background: rgba(201,168,76,0.15) !important;
    }
    .omni-cam-item {
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    .omni-cam-item:hover {
      background: rgba(201,168,76,0.1) !important;
      padding-left: 20px !important;
      color: #dfc06a !important;
    }
  `;
  document.head.appendChild(ps);
}

// Onboarding arrow + callout animations. Added outside the tooltip sheet
// so they stay mounted on first visit regardless of hover state.
const ONBOARDING_ANIM_ID = "omni-onboarding-anims";
if (typeof document !== "undefined" && document.getElementById(ONBOARDING_ANIM_ID) === null) {
  const s = document.createElement("style");
  s.id = ONBOARDING_ANIM_ID;
  s.textContent = `
    @keyframes omni-onboard-arrow {
      0%, 100% { transform: translateX(0) rotate(0deg) scale(1); }
      45%      { transform: translateX(-14px) rotate(-3deg) scale(1.06); }
      55%      { transform: translateX(-14px) rotate(-3deg) scale(1.06); }
    }
    @keyframes omni-onboard-card-in {
      0%   { opacity: 0; transform: translateX(12px) scale(0.94); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes omni-onboard-pulse-ring {
      0%   { transform: translateY(-50%) scale(0.6); opacity: 0.9; }
      100% { transform: translateY(-50%) scale(2.2); opacity: 0; }
    }
    @keyframes omni-onboard-tip-flash {
      0%, 100% { opacity: 0.4; }
      50%      { opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

const ONBOARDING_KEY = "omni-onboarding-dismissed";

const TOOLTIP_ANIM_ID = "omni-tooltip-anims-v2";
if (typeof document !== "undefined" && document.getElementById(TOOLTIP_ANIM_ID) === null) {
  const s = document.createElement("style");
  s.id = TOOLTIP_ANIM_ID;
  s.textContent = `
    @keyframes omni-tt-enter {
      0% { opacity: 0; transform: translateX(-16px) scale(0.85); filter: blur(6px); }
      60% { transform: translateX(6px) scale(1.03); filter: blur(0); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes omni-tt-pop-out {
      0% { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); }
      40% { transform: translateX(4px) scale(1.08); }
      100% { opacity: 0; transform: translateX(-12px) scale(0.7); filter: blur(6px); }
    }
    @keyframes omni-tt-glow {
      0%, 100% { box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.15), inset 0 1px 0 rgba(255,255,255,0.04); }
      50% { box-shadow: 0 16px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 24px rgba(201,168,76,0.08); }
    }
    @keyframes omni-tt-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes omni-tt-arrow {
      0% { opacity: 0; transform: translateY(-50%) translateX(-4px); }
      100% { opacity: 1; transform: translateY(-50%) translateX(0); }
    }
    @keyframes omni-tt-badge {
      0% { opacity: 0; transform: scale(0.8); }
      100% { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(s);
}

interface ToolBtnProps {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly description: string;
  readonly shortcut?: string;
  /** Short caption shown under the icon (e.g. "Furniture", "Snap"). Hidden in compact mode. */
  readonly subLabel?: string;
  /** Compact mode (narrow viewport bottom rail): hide the caption, keep button square. */
  readonly compact?: boolean;
  readonly showShortcut?: boolean;
  readonly tooltipEnabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

function ToolBtn({
  active,
  disabled = false,
  label,
  description,
  shortcut,
  subLabel,
  compact = false,
  showShortcut = true,
  tooltipEnabled = true,
  onClick,
  children,
}: ToolBtnProps): React.ReactElement {
  const [showTooltip, setShowTooltip] = useState(false);
  const [exiting, setExiting] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = (): void => {
    if (exitTimer.current !== null) { clearTimeout(exitTimer.current); exitTimer.current = null; }
    setExiting(false);
    enterTimer.current = setTimeout(() => { setShowTooltip(true); }, 200);
  };
  const dismiss = (): void => {
    if (enterTimer.current !== null) { clearTimeout(enterTimer.current); enterTimer.current = null; }
    if (!showTooltip) { setShowTooltip(false); return; }
    setExiting(true);
    exitTimer.current = setTimeout(() => { setShowTooltip(false); setExiting(false); }, 250);
  };
  const onLeave = (): void => { dismiss(); };
  const handleClick = (): void => {
    dismiss();
    onClick();
  };
  const captionTestId = subLabel !== undefined
    ? `tool-caption-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    : undefined;

  return (
    <div
      style={{ position: "relative", flex: "0 0 auto" }}
      onMouseEnter={tooltipEnabled ? onEnter : undefined}
      onMouseLeave={tooltipEnabled ? onLeave : undefined}
    >
      <button
        type="button"
        aria-label={label}
        style={btnStyle(active, disabled, compact)}
        onClick={handleClick}
        disabled={disabled}
      >
        {children}
        {subLabel !== undefined && (
          <span data-testid={captionTestId} style={{
            // Subtle, professional caption — uppercase Inter at 9px with
            // generous tracking. Active button flips to dark text on the
            // gold gradient; inactive uses a low-contrast neutral so the
            // icon stays the dominant visual element.
            display: "block",
            maxWidth: "100%",
            fontSize: compact ? 8 : subLabel.length >= 8 ? 8.5 : 9,
            fontWeight: 600,
            letterSpacing: compact ? 0.2 : subLabel.length >= 8 ? 0.25 : 0.6,
            lineHeight: 1,
            color: active
              ? "rgba(14,14,14,0.78)"
              : disabled
                ? "rgba(255,255,255,0.18)"
                : "rgba(255,255,255,0.42)",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            fontFamily: "'Inter', system-ui, sans-serif",
            userSelect: "none",
            pointerEvents: "none",
          }}>
            {subLabel}
          </span>
        )}
      </button>
      {showTooltip && !disabled && tooltipEnabled && (
        <div style={{
          position: "absolute",
          left: 58,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 100,
          pointerEvents: "none",
          animation: exiting
            ? "omni-tt-pop-out 0.25s cubic-bezier(0.55, 0, 1, 0.45) forwards"
            : "omni-tt-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}>
          {/* Arrow — large, gold-tinted */}
          <div style={{
            position: "absolute",
            left: -10,
            top: "50%",
            width: 0, height: 0,
            borderTop: "11px solid transparent",
            borderBottom: "11px solid transparent",
            borderRight: "11px solid #141414",
            animation: "omni-tt-arrow 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }} />
          {/* Card */}
          <div style={{
            background: "linear-gradient(145deg, #141414 0%, #1c1c1c 50%, #181818 100%)",
            border: "1px solid rgba(201,168,76,0.2)",
            borderRadius: 16,
            padding: "18px 24px 16px",
            minWidth: 240,
            maxWidth: 300,
            animation: "omni-tt-glow 3s ease-in-out infinite",
          }}>
            {/* Gold accent bar at top */}
            <div style={{
              width: 36,
              height: 3,
              borderRadius: 2,
              background: `linear-gradient(90deg, ${GOLD}, rgba(201,168,76,0.3))`,
              marginBottom: 12,
            }} />
            {/* Label */}
            <div style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#fff",
              letterSpacing: -0.4,
              fontFamily: "'Playfair Display', serif",
              lineHeight: 1.1,
            }}>
              {label}
            </div>
            {/* Description */}
            <div style={{
              fontSize: 14,
              color: "#999",
              marginTop: 8,
              lineHeight: 1.5,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 400,
            }}>
              {description}
            </div>
            {/* Shortcut badge */}
            {shortcut !== undefined && showShortcut && (
              <div style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 8,
                background: "linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.08))",
                border: "1px solid rgba(201,168,76,0.2)",
                color: GOLD,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'Inter', system-ui, sans-serif",
                letterSpacing: 0.8,
                animation: "omni-tt-badge 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both",
              }}>
                <span style={{ fontSize: 10, color: "rgba(201,168,76,0.6)", fontWeight: 500 }}>SHORTCUT</span>
                <span>{shortcut}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding hint — first-visit arrow + callout pointing at the Furniture
// button. Dismissed permanently via localStorage["omni-onboarding-dismissed"].
// Rendered only when: (a) user hasn't dismissed, (b) no furniture placed yet
// (empty-scene heuristic — if they've already put something down, they've
// clearly found the button).
// ---------------------------------------------------------------------------

interface OnboardingHintProps {
  readonly onDismiss: () => void;
}

function OnboardingHint({ onDismiss }: OnboardingHintProps): React.ReactElement | null {
  // Dynamically measure the chair *icon* (not the button) so the arrow
  // tip aligns with the visible glyph rather than the button's geometric
  // centre. With a caption stacked beneath the icon, the button's centre
  // falls in the gap between icon and label — visually "below" the chair.
  // Reading the inner <svg>'s rect puts the arrow on the icon itself.
  const [topPx, setTopPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    let raf = 0;
    function measure(): void {
      const btn = document.querySelector('[aria-label="Add Furniture"]');
      if (!(btn instanceof HTMLElement)) return;
      // Prefer the chair-icon SVG; fall back to the button if for some
      // reason no svg child exists (defensive — current Lucide always
      // renders an svg).
      const icon = btn.querySelector("svg");
      const target = icon instanceof SVGElement ? icon : btn;
      const rect = target.getBoundingClientRect();
      setTopPx(rect.top + rect.height / 2);
    }
    // First read after layout commit; second after a frame so any
    // late-arriving font metrics (caption load) are already applied.
    measure();
    raf = window.requestAnimationFrame(measure);

    const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const targetEl = document.querySelector('[aria-label="Add Furniture"]');
    if (obs !== null && targetEl !== null) obs.observe(targetEl);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      if (obs !== null) obs.disconnect();
    };
  }, []);

  if (topPx === null) return null;

  return (
    <div
      style={{
        position: "fixed",
        // sit flush against the toolbar's right edge — the arrow's tip
        // lands within a few px of the chair icon when the SVG is rendered
        // with its head at the SVG's left side.
        left: TOOLBAR_W,
        top: topPx,
        // translate up by half so `topPx` is treated as the target button's
        // vertical centre — keeps the arrow on the chair icon regardless
        // of card content height.
        transform: "translateY(-50%)",
        zIndex: 52,
        display: "flex",
        alignItems: "center",
        gap: 14,
        pointerEvents: "auto",
        animation: "omni-onboard-card-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {/* Animated arrow — points LEFT toward the Furniture icon, lunges
          toward the toolbar with a soft scale + rotate kick, glowing pulse
          radiates from the arrowhead at the tip. */}
      <div
        aria-hidden
        style={{
          position: "relative",
          width: 64,
          height: 36,
          display: "flex",
          alignItems: "center",
          color: GOLD,
          filter: "drop-shadow(0 2px 8px rgba(201,168,76,0.55))",
          animation: "omni-onboard-arrow 1.4s cubic-bezier(0.34, 1.56, 0.64, 1) infinite",
        }}
      >
        {/* Pulse ring — radiates from the arrowhead position (left side of SVG) */}
        <div
          style={{
            position: "absolute",
            left: 4,
            top: "50%",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(201,168,76,0.7), rgba(201,168,76,0.1) 60%, transparent 80%)",
            transformOrigin: "center",
            animation: "omni-onboard-pulse-ring 1.4s ease-out infinite",
            pointerEvents: "none",
          }}
        />
        {/* Curved arrow — long bowed shaft from card-side to toolbar-side,
            ending in a chunky chevron pointing left at the chair icon. */}
        <svg width="64" height="36" viewBox="0 0 64 36" fill="none" style={{ position: "relative", zIndex: 1 }}>
          <defs>
            <linearGradient id="omni-onboard-grad" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#dfc06a" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#dfc06a" stopOpacity="1" />
              <stop offset="100%" stopColor="#fff3c4" stopOpacity="1" />
            </linearGradient>
          </defs>
          {/* Curved shaft: starts top-right, dips through the centre,
              exits left at the icon row. The bow gives the arrow a sense
              of motion without committing to a full hand-drawn squiggle. */}
          <path
            d="M 60 8 Q 40 28, 22 18 Q 18 16, 14 18"
            stroke="url(#omni-onboard-grad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Chevron head — points left (toolbar side), thicker stroke for emphasis. */}
          <path
            d="M 22 10 L 12 18 L 22 26"
            stroke="#fff3c4"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>

      {/* Callout card */}
      <div
        role="dialog"
        aria-label="Get started"
        style={{
          background: "linear-gradient(145deg, #1a1a1a 0%, #222 100%)",
          border: "1px solid rgba(201,168,76,0.35)",
          borderRadius: 14,
          padding: "14px 18px 12px",
          minWidth: 240,
          maxWidth: 300,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.08), 0 0 32px rgba(201,168,76,0.12)",
          color: "#f1f1f1",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: GOLD, textTransform: "uppercase" }}>
          Start here
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, lineHeight: 1.25, fontFamily: "'Playfair Display', serif" }}>
          Click to add furniture
        </div>
        <div style={{ fontSize: 13, color: "#aaa", marginTop: 6, lineHeight: 1.4 }}>
          Round tables, stage platforms, bars, chairs — drag any piece into the room to begin your layout.
        </div>
        <label
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#888",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            onChange={(e) => { if (e.target.checked) onDismiss(); }}
            style={{ accentColor: GOLD, cursor: "pointer" }}
          />
          Don&rsquo;t show this tip again
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile interaction dock
// ---------------------------------------------------------------------------

type ActiveTool = "select" | "add" | "rotate" | "delete";

type MobileShellMode = "idle" | "placing" | "selected";

interface MobileDockAction {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly tone?: "default" | "primary" | "danger" | "quiet";
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
}

interface MobilePlannerDockProps {
  readonly mode: MobileShellMode;
  readonly activeTool: ActiveTool;
  readonly panelOpen: boolean;
  readonly cameraOpen: boolean;
  readonly moreOpen: boolean;
  readonly snapEnabled: boolean;
  readonly allWallsUp: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isAuthenticated: boolean;
  readonly selectedName: string | null;
  readonly selectedDetail: string | null;
  readonly placingName: string | null;
  readonly onSelect: () => void;
  readonly onAdd: () => void;
  readonly onCamera: () => void;
  readonly onMore: () => void;
  readonly onSnap: () => void;
  readonly onWalls: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onGenerateSheet: () => void;
  readonly onAuth: () => void;
  readonly onRotatePlacement: () => void;
  readonly onCancelPlacement: () => void;
  readonly onDoneSelected: () => void;
  readonly onRotateSelected: () => void;
  readonly onDeleteSelected: () => void;
}

const mobileDockWrapperStyle: React.CSSProperties = {
  position: "fixed",
  left: "max(12px, env(safe-area-inset-left))",
  right: "max(12px, env(safe-area-inset-right))",
  bottom: "calc(env(safe-area-inset-bottom) + 10px)",
  zIndex: 64,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  pointerEvents: "none",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const mobileDockSurfaceStyle: React.CSSProperties = {
  minHeight: 74,
  display: "grid",
  gridAutoFlow: "column",
  gridAutoColumns: "minmax(0, 1fr)",
  alignItems: "stretch",
  gap: 6,
  padding: 8,
  borderRadius: 28,
  background: "rgba(18, 17, 15, 0.92)",
  border: "1px solid rgba(246, 232, 201, 0.1)",
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.34)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  pointerEvents: "auto",
};

const mobileSheetStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 14,
  background: "rgba(248, 242, 230, 0.95)",
  border: "1px solid rgba(74,44,28,0.12)",
  boxShadow: "0 18px 48px rgba(30, 20, 10, 0.2)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  pointerEvents: "auto",
};

const mobileSheetTitleStyle: React.CSSProperties = {
  color: "#241913",
  fontSize: 15,
  fontWeight: 780,
  lineHeight: 1.2,
  marginBottom: 3,
};

const mobileSheetDetailStyle: React.CSSProperties = {
  color: "rgba(36,25,19,0.62)",
  fontSize: 12,
  fontWeight: 570,
  lineHeight: 1.35,
};

function mobileActionStyle(action: MobileDockAction): React.CSSProperties {
  const active = action.active === true;
  const primary = action.tone === "primary";
  const danger = action.tone === "danger";
  const quiet = action.tone === "quiet";
  return {
    minWidth: 0,
    minHeight: 56,
    borderRadius: 22,
    border: "1px solid transparent",
    background: primary
      ? "#c9a84c"
      : danger
        ? "rgba(145, 34, 45, 0.18)"
        : active
          ? "rgba(201,168,76,0.22)"
          : quiet
            ? "rgba(255,255,255,0.03)"
            : "rgba(255,255,255,0.06)",
    color: primary ? "#16120c" : danger ? "#ffc1c8" : "#f6ead0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 720,
    lineHeight: 1,
    cursor: action.disabled === true ? "default" : "pointer",
    opacity: action.disabled === true ? 0.36 : 1,
    padding: 6,
    transition: "background 160ms ease, transform 160ms ease, opacity 160ms ease",
  };
}

function MobileDockButton(action: MobileDockAction): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={action.ariaLabel ?? action.label}
      aria-pressed={action.active === true ? true : undefined}
      disabled={action.disabled}
      onClick={action.onClick}
      style={mobileActionStyle(action)}
    >
      {action.icon}
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
        {action.label}
      </span>
    </button>
  );
}

function MobilePlannerDock({
  mode,
  activeTool,
  panelOpen,
  cameraOpen,
  moreOpen,
  snapEnabled,
  allWallsUp,
  canUndo,
  canRedo,
  isAuthenticated,
  selectedName,
  selectedDetail,
  placingName,
  onSelect,
  onAdd,
  onCamera,
  onMore,
  onSnap,
  onWalls,
  onUndo,
  onRedo,
  onGenerateSheet,
  onAuth,
  onRotatePlacement,
  onCancelPlacement,
  onDoneSelected,
  onRotateSelected,
  onDeleteSelected,
}: MobilePlannerDockProps): React.ReactElement {
  const idleActions: readonly MobileDockAction[] = [
    { label: "Select", active: activeTool === "select", onClick: onSelect, icon: <MousePointer2 size={20} /> },
    { label: "Add", active: panelOpen, onClick: onAdd, icon: <Armchair size={20} /> },
    { label: "View", active: cameraOpen, onClick: onCamera, icon: <Camera size={20} /> },
    { label: "More", active: moreOpen, onClick: onMore, icon: <MoreHorizontal size={20} /> },
  ];
  const placingActions: readonly MobileDockAction[] = [
    { label: "Rotate", tone: "primary", onClick: onRotatePlacement, icon: <RotateCw size={20} /> },
    { label: "Cancel", tone: "quiet", onClick: onCancelPlacement, icon: <X size={20} /> },
    { label: "View", active: cameraOpen, onClick: onCamera, icon: <Camera size={20} /> },
  ];
  const selectedActions: readonly MobileDockAction[] = [
    { label: "Done", tone: "primary", onClick: onDoneSelected, icon: <Check size={20} /> },
    { label: "Rotate", active: activeTool === "rotate", onClick: onRotateSelected, icon: <RotateCw size={20} /> },
    { label: "Delete", tone: "danger", onClick: onDeleteSelected, icon: <Trash2 size={20} /> },
    { label: "View", active: cameraOpen, onClick: onCamera, icon: <Camera size={20} /> },
  ];
  const actions =
    mode === "placing" ? placingActions
      : mode === "selected" ? selectedActions
        : idleActions;

  return (
    <div data-testid="planner-toolbar" style={mobileDockWrapperStyle}>
      {mode === "placing" ? (
        <div data-testid="mobile-planner-sheet" style={mobileSheetStyle}>
          <div style={mobileSheetTitleStyle}>Tap to place {placingName ?? "item"}</div>
          <div style={mobileSheetDetailStyle}>
            Tap a clear spot in the hall. Drag before lifting to refine the position.
          </div>
        </div>
      ) : null}

      {mode === "selected" ? (
        <div data-testid="mobile-object-sheet" style={mobileSheetStyle}>
          <div style={mobileSheetTitleStyle}>{selectedName ?? "Selected item"}</div>
          <div style={mobileSheetDetailStyle}>{selectedDetail ?? "Drag in the scene to move. Use Done when placed."}</div>
        </div>
      ) : null}

      {moreOpen ? (
        <div data-testid="mobile-more-sheet" style={{ ...mobileSheetStyle, display: "grid", gap: 8 }}>
          <div style={mobileSheetTitleStyle}>Tools</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <MobileDockButton label="Snap" active={snapEnabled} onClick={onSnap} icon={<Grid3X3 size={20} />} />
            <MobileDockButton label="Walls" active={allWallsUp} onClick={onWalls} icon={<Eye size={20} />} />
            <MobileDockButton label="Undo" disabled={!canUndo} onClick={onUndo} icon={<Undo2 size={20} />} />
            <MobileDockButton label="Redo" disabled={!canRedo} onClick={onRedo} icon={<Redo2 size={20} />} />
            <MobileDockButton label="Sheet" onClick={onGenerateSheet} icon={<FileText size={20} />} />
            <MobileDockButton label={isAuthenticated ? "Account" : "Sign In"} onClick={onAuth} icon={<User size={20} />} />
          </div>
        </div>
      ) : null}

      <div style={mobileDockSurfaceStyle}>
        {actions.map((action) => (
          <MobileDockButton key={action.label} {...action} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function shouldRenderDesktopToolbar(mobileChrome: boolean): boolean {
  return !mobileChrome;
}

export function VerticalToolbox(): React.ReactElement {
  const navigate = useNavigate();
  // Narrow-viewport flag: ≤640 CSS px. Drives the bottom-rail layout AND
  // publishes CSS vars that App.tsx consumes to pad the Canvas correctly.
  const isNarrow = useIsNarrowViewport();
  const isTouch = useIsCoarsePointer();
  const mobileChrome = isNarrow || isTouch;

  // Publish toolbox dimensions as CSS vars on <html> so other fixed-
  // position chrome can align with us without importing TOOLBAR_W.
  // useLayoutEffect (not useEffect) so the Canvas wrapper reads correct
  // values on the first paint — no one-frame jump as the layout settles.
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (mobileChrome) {
      root.style.setProperty("--toolbox-offset", "0px");
      root.style.setProperty("--toolbox-bottom", "calc(104px + env(safe-area-inset-bottom))");
    } else {
      root.style.setProperty("--toolbox-offset", `${String(TOOLBAR_W)}px`);
      root.style.setProperty("--toolbox-bottom", "0px");
    }
    return () => {
      root.style.removeProperty("--toolbox-offset");
      root.style.removeProperty("--toolbox-bottom");
    };
  }, [mobileChrome]);

  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [saveFlash, setSaveFlash] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try { return window.localStorage.getItem(ONBOARDING_KEY) === "1"; }
    catch { return false; }
  });
  const placedCount = usePlacementStore((s) => s.placedItems.length);

  const canUndo = usePlacementStore((s) => s.undoStack.length > 0);
  const canRedo = usePlacementStore((s) => s.redoStack.length > 0);
  const snapEnabled = usePlacementStore((s) => s.snapEnabled);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isSaving = useEditorStore((s) => s.isSaving);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveError = useEditorStore((s) => s.saveError);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const wallMode = useVisibilityStore((s) => s.mode);
  const allWallsUp = wallMode === "manual";
  const saveStatus = deriveEditorSaveStatus({ isDirty, isSaving, saveError, lastSavedAt });
  const displayedSaveStatus: EditorSaveStatus =
    saveFlash && saveStatus !== "failed" && saveStatus !== "saving" ? "saved" : saveStatus;
  const saveCopy = copyForEditorSaveStatus(displayedSaveStatus);
  const placedItems = usePlacementStore((s) => s.placedItems);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectedIdList = Array.from(selectedIds);
  const selectedItem = selectedIdList.length > 0
    ? placedItems.find((item) => item.id === selectedIdList[0])
    : undefined;
  const selectedCatalogueItem = selectedItem !== undefined
    ? getCatalogueItem(selectedItem.catalogueItemId)
    : undefined;
  const selectedName = selectedCatalogueItem?.name ?? null;
  const selectedDetail = selectedCatalogueItem !== undefined
    ? `${selectedCatalogueItem.subtitle} · ${selectedCatalogueItem.width.toFixed(1)}m × ${selectedCatalogueItem.depth.toFixed(1)}m`
    : null;
  const placingItemId = useCatalogueStore((s) => s.selectedItemId);
  const placingCatalogueItem = placingItemId !== null ? getCatalogueItem(placingItemId) : undefined;
  const mobileMode: MobileShellMode =
    placingItemId !== null ? "placing"
      : selectedItem !== undefined ? "selected"
        : "idle";

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    try { window.localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* storage unavailable */ }
  }, []);

  const handleToolClick = useCallback((tool: ActiveTool) => {
    if (tool === "add") {
      setPanelOpen((p) => !p);
      setActiveTool((prev) => prev === "add" ? "select" : "add");
      // Once the user opens the Furniture panel they've obviously found the
      // button — hide the hint for good even if they never tick the checkbox.
      setOnboardingDismissed(true);
      try { window.localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* storage unavailable */ }
    } else {
      setPanelOpen(false);
      setActiveTool(tool);
    }
    setCameraOpen(false);
    setMobileMoreOpen(false);
  }, []);

  const handleUndo = useCallback(() => {
    usePlacementStore.getState().undo();
    useSelectionStore.getState().clearSelection();
  }, []);

  const handleRedo = useCallback(() => {
    usePlacementStore.getState().redo();
    useSelectionStore.getState().clearSelection();
  }, []);

  const handleCameraToggle = useCallback(() => {
    setCameraOpen((p) => !p);
    setPanelOpen(false);
    setMobileMoreOpen(false);
  }, []);

  const handleMobileMoreToggle = useCallback(() => {
    setMobileMoreOpen((p) => !p);
    setPanelOpen(false);
    setCameraOpen(false);
  }, []);

  const handleSnapToggle = useCallback(() => {
    usePlacementStore.getState().toggleSnap();
  }, []);

  const handleToggleAllWalls = useCallback(() => {
    const store = useVisibilityStore.getState();
    if (store.mode === "manual") {
      // Switch back to auto — camera controls walls again
      store.setMode("auto-3");
    } else {
      // Switch to manual with all walls up, locks cleared
      store.setMode("manual");
      const allUp: Record<string, boolean> = {};
      const allOpacity: Record<string, number> = {};
      for (const key of WALL_KEYS) {
        allUp[key] = true;
        allOpacity[key] = 1;
      }
      useVisibilityStore.setState({
        walls: allUp as Record<typeof WALL_KEYS[number], boolean>,
        wallOpacity: allOpacity as Record<typeof WALL_KEYS[number], number>,
      });
    }
  }, []);

  const handleGenerateSheet = useCallback(() => {
    const configId = useEditorStore.getState().configId;
    if (configId === null) return;
    window.open(`/hallkeeper/${configId}`, "_blank");
  }, []);

  const handleAuth = useCallback(() => {
    if (useAuthStore.getState().isAuthenticated) {
      void navigate("/dashboard");
    } else {
      setShowAuth(true);
    }
  }, [navigate]);

  const handleCancelPlacement = useCallback(() => {
    useCatalogueStore.getState().clearSelection();
    usePlacementStore.getState().clearGhost();
    setActiveTool("select");
    setPanelOpen(false);
  }, []);

  const handleRotatePlacement = useCallback(() => {
    usePlacementStore.getState().rotateGhost(Math.PI / 12);
  }, []);

  const handleDoneSelected = useCallback(() => {
    useSelectionStore.getState().clearSelection();
    setActiveTool("select");
  }, []);

  const handleRotateSelected = useCallback(() => {
    const ids = Array.from(useSelectionStore.getState().selectedIds);
    const state = usePlacementStore.getState();
    for (const id of ids) {
      const item = state.placedItems.find((candidate) => candidate.id === id);
      if (item !== undefined) {
        state.rotateItem(id, item.rotationY + Math.PI / 12);
      }
    }
    setActiveTool("rotate");
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const ids = useSelectionStore.getState().selectedIds;
    usePlacementStore.getState().removeItems(ids);
    useSelectionStore.getState().clearSelection();
    setActiveTool("select");
  }, []);

  const handleSave = useCallback(() => {
    // Punch list #10: previously called saveToServer(true) unconditionally,
    // forcing the authenticated endpoint even for guests. Guest sessions
    // would 401 silently. Now reads the live auth state at click time so
    // guests hit the public-preview endpoint and authenticated users hit
    // the auth endpoint. The store action's internal isPublicPreview check
    // still applies — if a config is already claimed, the auth path is used
    // regardless of the flag.
    const authed = useAuthStore.getState().isAuthenticated;
    void useEditorStore.getState().saveToServer(authed).then((saved) => {
      if (!saved) return;
      setSaveFlash(true);
      window.setTimeout(() => { setSaveFlash(false); }, 2000);
    });
  }, []);

  const handleAssetClick = useCallback((item: CatalogueItem) => {
    useCatalogueStore.getState().selectItem(item.id);
    setPanelOpen(false);
    setActiveTool("select");
    setMobileMoreOpen(false);
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  }, []);

  const handleCameraPreset = useCallback((presetIndex: number) => {
    const bookmarks = useBookmarkStore.getState().bookmarks;
    const bookmark = bookmarks[presetIndex];
    if (bookmark !== undefined) {
      useBookmarkStore.getState().requestNavigation(bookmark.id);
    }
    setCameraOpen(false);
    setMobileMoreOpen(false);
  }, []);

  const bookmarks = useBookmarkStore((s) => s.bookmarks);

  // Delayed unmount for exit animations
  const panelMounted = useDelayedUnmount(panelOpen, 300);
  const cameraMounted = useDelayedUnmount(cameraOpen, 250);

  // F key opens furniture panel
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey) {
        // Don't conflict with placement rotation (handled by PlacementGhost)
        if (useCatalogueStore.getState().selectedItemId !== null) return;
        handleToolClick("add");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [handleToolClick]);

  // OnboardingHint measures the Furniture button position itself via the
  // DOM — no static constant to keep in sync when button styling shifts.
  const showOnboarding = !onboardingDismissed && placedCount === 0 && !panelOpen && !isNarrow && !isTouch;

  const showDesktopHints = !isTouch && !isNarrow;
  const selectDescription = isTouch
    ? "Tap furniture to select it, then drag to move it across the room."
    : "Click any piece of furniture to grab it. Drag to slide it across the room. Shift+click to select multiple.";
  const addDescription = isTouch
    ? "Open the furniture catalogue, then tap an item and place it in the room."
    : "Open the catalogue — round tables, trestle tables, poseur tables, chairs, staging, AV gear, lecterns and more.";
  const rotateDescription = isTouch
    ? "Rotate the selected item with touch-friendly controls."
    : "Twist any selected item 15° at a time. Perfect for angling tables toward the stage or lining up rows.";

  const desktopToolbarVisible = shouldRenderDesktopToolbar(mobileChrome);

  return (
    <>
      {showOnboarding && (
        <OnboardingHint onDismiss={dismissOnboarding} />
      )}

      {mobileChrome ? (
        <MobilePlannerDock
          mode={mobileMode}
          activeTool={activeTool}
          panelOpen={panelOpen}
          cameraOpen={cameraOpen}
          moreOpen={mobileMoreOpen}
          snapEnabled={snapEnabled}
          allWallsUp={allWallsUp}
          canUndo={canUndo}
          canRedo={canRedo}
          isAuthenticated={isAuthenticated}
          selectedName={selectedName}
          selectedDetail={selectedDetail}
          placingName={placingCatalogueItem?.name ?? null}
          onSelect={() => { handleToolClick("select"); }}
          onAdd={() => { handleToolClick("add"); }}
          onCamera={handleCameraToggle}
          onMore={handleMobileMoreToggle}
          onSnap={handleSnapToggle}
          onWalls={handleToggleAllWalls}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onGenerateSheet={handleGenerateSheet}
          onAuth={handleAuth}
          onRotatePlacement={handleRotatePlacement}
          onCancelPlacement={handleCancelPlacement}
          onDoneSelected={handleDoneSelected}
          onRotateSelected={handleRotateSelected}
          onDeleteSelected={handleDeleteSelected}
        />
      ) : null}

      {desktopToolbarVisible && (
      <div data-testid="planner-toolbar" style={isNarrow ? {
        // Bottom rail on phone portrait: fixed bottom, horizontal flex,
        // horizontal scroll if the tool set doesn't fit. The same buttons
        // as desktop — no progressive disclosure needed; we have ~8 primary
        // tools and each is ~48px, fitting inside a 390px screen with a
        // little scroll headroom.
        position: "fixed" as const,
        left: 0, right: 0, bottom: 0,
        height: "calc(64px + env(safe-area-inset-bottom))",
        boxSizing: "border-box" as const,
        background: "linear-gradient(180deg, #141414 0%, #1a1a1a 50%, #151515 100%)",
        borderTop: "1px solid rgba(201,168,76,0.15)",
        boxShadow: "0 -2px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(201,168,76,0.03)",
        display: "flex", flexDirection: "row" as const, alignItems: "center",
        padding: "6px 10px calc(6px + env(safe-area-inset-bottom))", gap: 6, zIndex: 50,
        overflowX: "auto" as const,
        scrollbarWidth: "none" as const,
        fontFamily: "'Inter', sans-serif",
      } : toolbarStyle}>
        <ToolBtn active={activeTool === "select"} compact={isNarrow} subLabel="Select" label="Select & Move" description={selectDescription} shortcut="V" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={() => { handleToolClick("select"); }}>
          <MousePointer2 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "add"} compact={isNarrow} subLabel={isNarrow ? "Place" : "Furniture"} label="Add Furniture" description={addDescription} shortcut="F" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={() => { handleToolClick("add"); }}>
          <Armchair size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "rotate"} compact={isNarrow} subLabel="Rotate" label="Rotate" description={rotateDescription} shortcut="Q / E" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={() => { handleToolClick("rotate"); }}>
          <RotateCw size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={displayedSaveStatus === "saved"} compact={isNarrow} subLabel={saveCopy.shortLabel} disabled={isSaving} label={saveCopy.label} description={saveCopy.description} tooltipEnabled={showDesktopHints} onClick={handleSave}>
          <Save size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "delete"} compact={isNarrow} subLabel="Delete" label="Delete" description="Remove whatever you've selected. Tables will take their chairs with them — no orphans left behind." shortcut="Del" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={() => { handleToolClick("delete"); }}>
          <Trash2 size={ICON_SIZE} />
        </ToolBtn>

        <div style={dividerStyle} />

        <ToolBtn active={false} compact={isNarrow} subLabel="Undo" disabled={!canUndo} label="Undo" description="Made a mistake? Step back in time. Every move, place, and delete can be reversed." shortcut="Ctrl+Z" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={handleUndo}>
          <Undo2 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={false} compact={isNarrow} subLabel="Redo" disabled={!canRedo} label="Redo" description="Changed your mind about undoing? Bring it back exactly as it was." shortcut="Ctrl+Y" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={handleRedo}>
          <Redo2 size={ICON_SIZE} />
        </ToolBtn>

        <div style={dividerStyle} />

        <ToolBtn active={cameraOpen} compact={isNarrow} subLabel="Camera" label="Camera Views" description="Teleport to pre-set viewpoints — see the room from the entrance, the stage, or overhead." tooltipEnabled={showDesktopHints} onClick={() => { setCameraOpen((p) => !p); setPanelOpen(false); }}>
          <Camera size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={snapEnabled} compact={isNarrow} subLabel="Snap" label="Grid Snap" description="Furniture locks to a 1-metre grid for perfectly aligned layouts. Toggle off for freeform placement." shortcut="G" showShortcut={showDesktopHints} tooltipEnabled={showDesktopHints} onClick={handleSnapToggle}>
          <Grid3X3 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={allWallsUp} compact={isNarrow} subLabel="Walls" label="Show All Walls" description={isTouch ? "Toggle the room walls for a clearer touch planning view." : "Pin every wall up so you can see the full room structure. Click individual walls to toggle them."} tooltipEnabled={showDesktopHints} onClick={handleToggleAllWalls}>
          <Eye size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={false} compact={isNarrow} subLabel="Sheet" label="Events Sheet" description="Generate a professional setup sheet the crew can print and use on event day. Tables, chairs, positions — all laid out." tooltipEnabled={showDesktopHints} onClick={handleGenerateSheet}>
          <FileText size={ICON_SIZE} />
        </ToolBtn>

        <div style={{ flex: 1 }} />

        <ToolBtn active={false} compact={isNarrow} subLabel={isAuthenticated ? "Account" : "Sign In"} label={isAuthenticated ? "Your Account" : "Sign In"} description={isAuthenticated ? "View your saved layouts, manage your profile, and track your enquiries." : "Create a free account to save layouts, share with your team, and send to the venue."} tooltipEnabled={showDesktopHints} onClick={() => { if (isAuthenticated) { void navigate("/dashboard"); } else { setShowAuth(true); } }}>
          <User size={ICON_SIZE} />
        </ToolBtn>
      </div>
      )}

      {/* === Slide-out asset panel === */}
      {panelMounted && (
        <div
          data-testid="furniture-panel"
          style={{
            ...panelStyle,
            ...(mobileChrome ? {
              left: 10,
              right: 10,
              top: "auto",
              bottom: "calc(var(--toolbox-bottom, 64px) + 10px)",
              width: "auto",
              maxHeight: "min(58dvh, 430px)",
              borderRadius: 18,
              boxSizing: "border-box" as const,
              boxShadow: "0 -18px 50px rgba(0,0,0,0.45), 0 0 0 1px rgba(201,168,76,0.12)",
            } : {}),
            animation: panelOpen
              ? "omni-panel-slide 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards"
              : "omni-panel-slide-out 0.3s cubic-bezier(0.55, 0, 1, 0.45) forwards",
          }}
        >
          {/* Gold accent */}
          <div style={{ width: 32, height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${GOLD}, rgba(201,168,76,0.2))`, marginBottom: 14 }} />
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 2.5, color: GOLD, marginBottom: 4 }}>
            Catalogue
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f5f5f5", fontFamily: "'Playfair Display', serif", marginBottom: 16, letterSpacing: -0.3 }}>
            Furniture
          </div>

          {/* Search */}
          <div style={{ position: "relative", marginBottom: 16 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              placeholder="Search furniture\u2026"
              aria-label="Search furniture"
              style={{
                width: "100%", padding: "9px 12px 9px 32px", fontSize: 13,
                fontFamily: "'Inter', system-ui, sans-serif",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, color: "#f0f0f0", outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,168,76,0.06)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {CATALOGUE_CATEGORIES.map((cat) => {
            const allItems = getCatalogueByCategory(cat);
            const q = searchQuery.trim().toLowerCase();
            const items = q.length > 0 ? allItems.filter((item) => item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || categoryLabel(cat).toLowerCase().includes(q)) : allItems;
            if (items.length === 0) return null;
            const collapsed = collapsedCategories.has(cat) && q.length === 0;
            return (
              <div key={cat}>
                <div data-testid={`category-header-${cat}`} style={categoryHeaderStyle} onClick={() => { toggleCategory(cat); }}>
                  <span>{categoryLabel(cat)} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>{items.length}</span></span>
                  <span style={{ fontSize: 14 }}>{collapsed ? "+" : "\u2212"}</span>
                </div>
                {!collapsed && items.map((item, idx) => (
                  <div
                    key={item.id}
                    className="omni-asset-row"
                    style={{
                      ...assetRowStyle,
                      animation: `omni-panel-item 0.3s cubic-bezier(0.16, 1, 0.3, 1) ${String(idx * 0.04)}s both`,
                      borderLeft: "2px solid transparent",
                    }}
                    onClick={() => { handleAssetClick(item); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAssetClick(item); }}
                  >
                    {/* SVG thumbnail */}
                    <div
                      style={{
                        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                        background: "rgba(201,168,76,0.04)",
                        border: "1px solid rgba(201,168,76,0.08)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 2,
                      }}
                      dangerouslySetInnerHTML={{ __html: catalogueIcon(item) }}
                    />
                    {/* Name + subtitle */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#eee", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Empty search state */}
          {searchQuery.trim().length > 0 && CATALOGUE_CATEGORIES.every((cat) => {
            const q = searchQuery.trim().toLowerCase();
            return getCatalogueByCategory(cat).filter((item) => item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || categoryLabel(cat).toLowerCase().includes(q)).length === 0;
          }) && (
            <div style={{ textAlign: "center", padding: "24px 8px", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
              No items match &ldquo;{searchQuery.trim()}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* === Camera dropdown === */}
      {cameraMounted && bookmarks.length > 0 && (
        <div style={{
          ...cameraDropdownStyle,
          ...(mobileChrome ? {
            left: 12,
            right: 12,
            bottom: "calc(var(--toolbox-bottom, 64px) + 12px)",
            top: "auto",
            minWidth: 0,
            boxSizing: "border-box" as const,
          } : {
            top: 280,
          }),
          animation: cameraOpen
            ? "omni-dropdown-pop 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards"
            : "omni-dropdown-pop-out 0.25s cubic-bezier(0.55, 0, 1, 0.45) forwards",
        }}>
          {bookmarks.map((bm, i) => (
            <button
              key={bm.id}
              type="button"
              className="omni-cam-item"
              style={{
                ...cameraItemStyle,
                animation: `omni-panel-item 0.25s cubic-bezier(0.16, 1, 0.3, 1) ${String(i * 0.05)}s both`,
              }}
              onClick={() => { handleCameraPreset(i); }}
            >
              <span style={{ color: "#f2f2f2", fontWeight: 750, lineHeight: 1.2 }}>
                {bm.name}
              </span>
              <span style={{ color: "rgba(255,255,255,0.44)", fontSize: 11, lineHeight: 1.2 }}>
                {bm.kind === "reference" && bm.reference !== undefined
                  ? `${bm.reference.heightMode === "custom" ? "Custom" : bm.reference.heightMode === "sitting" ? "Sitting" : "Standing"} POV - ${bm.reference.sourceLabel}`
                  : "Preset view"}
              </span>
            </button>
          ))}
        </div>
      )}
      {showAuth && <AuthModal onClose={() => { setShowAuth(false); }} />}
    </>
  );
}
