import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useSpring, animated } from "@react-spring/web";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { useGuidelineStore } from "../stores/guideline-store.js";
import { useSectionStore } from "../stores/section-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import {
  playArcOpenSound,
  playArcCloseSound,
  playActivationClick,
} from "../lib/toolbar-sounds.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDef {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
  readonly accent: string;
  readonly icon: () => React.ReactElement;
  readonly toggle: () => void;
  readonly isActive: () => boolean;
}

/** Gap between tool buttons in the row. */
const TOOL_GAP = 6;
/** Stagger delay between tool animations in ms. */
const STAGGER_MS = 25;
/** Tool icon button size. */
const TOOL_SIZE = 44;
/** Toolbox button size. */
const TOOLBOX_SIZE = 52;
/** Gap between toolbox and first tool. */
const TOOLBOX_GAP = 10;

// ---------------------------------------------------------------------------
// Accent colours — each tool has a distinct personality
// ---------------------------------------------------------------------------

// Regal palette — rich jewel tones befitting a grand historic venue
const ACCENT_MEASURE = "#5B9BD5"; // sapphire
const ACCENT_XRAY = "#9B72CF";    // amethyst
const ACCENT_TAPE = "#D4A843";    // burnished brass
const ACCENT_BOX = "#4DA66A";     // emerald
const ACCENT_PLACE = "#C25B5B";   // garnet

// ---------------------------------------------------------------------------
// SVG Icons — clean, minimal, 2px stroke, white, no fill
// ---------------------------------------------------------------------------

function MeasureIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="7" width="16" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <line x1="5" y1="7" x2="5" y2="10" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="7" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" />
      <line x1="11" y1="7" x2="11" y2="10" stroke="currentColor" strokeWidth="1.2" />
      <line x1="14" y1="7" x2="14" y2="11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function XrayIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="6" y1="6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" />
      <line x1="14" y1="6" x2="6" y2="14" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function TapeIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="6" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5" />
      <path d="M17 8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BoxIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="4" y="5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.5" />
      <line x1="4" y1="5" x2="7" y2="3" stroke="currentColor" strokeWidth="1.2" />
      <line x1="14" y1="5" x2="17" y2="3" stroke="currentColor" strokeWidth="1.2" />
      <line x1="17" y1="3" x2="17" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5" />
      <line x1="14" y1="15" x2="17" y2="12" stroke="currentColor" strokeWidth="1.2" />
      <line x1="7" y1="3" x2="17" y2="3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function PlaceIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ToolboxIcon(): React.ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="9" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 9V7a3 3 0 013-3h2a3 3 0 013 3v2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="14" x2="21" y2="14" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Row geometry helper
// ---------------------------------------------------------------------------

/**
 * Computes the horizontal offset (to the left) for a tool in the row.
 * Index 0 is closest to the toolbox, higher indices are further left.
 */
function computeRowOffset(index: number): number {
  return TOOLBOX_GAP + index * (TOOL_SIZE + TOOL_GAP);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Horizontal toolbar — tools shoot out in a row to the left of a toolbox button.
 *
 * Click toggles the row open/closed with staggered jelly CSS transitions.
 * Each tool has a distinct accent colour and hover effect.
 * Keyboard shortcuts work without opening the row.
 */
export function Toolbar(): React.ReactElement {
  const [arcOpen, setArcOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const pulseIndexRef = useRef<number | null>(null);

  // Store subscriptions
  const measureActive = useMeasurementStore((s) => s.active);
  const xrayEnabled = useXrayStore((s) => s.enabled);
  const tapeActive = useGuidelineStore((s) => s.active);
  const boxEnabled = useSectionStore((s) => s.boxEnabled);
  const catalogueOpen = useCatalogueStore((s) => s.drawerOpen);

  // Tool definitions — stable array
  const tools: readonly ToolDef[] = useMemo(() => [
    {
      id: "measure",
      label: "Measure",
      shortcut: "M",
      accent: ACCENT_MEASURE,
      icon: MeasureIcon,
      toggle: () => { useMeasurementStore.getState().toggle(); },
      isActive: () => useMeasurementStore.getState().active,
    },
    {
      id: "xray",
      label: "X-Ray",
      shortcut: "X",
      accent: ACCENT_XRAY,
      icon: XrayIcon,
      toggle: () => { useXrayStore.getState().toggle(); },
      isActive: () => useXrayStore.getState().enabled,
    },
    {
      id: "tape",
      label: "Tape",
      shortcut: "T",
      accent: ACCENT_TAPE,
      icon: TapeIcon,
      toggle: () => { useGuidelineStore.getState().toggle(); },
      isActive: () => useGuidelineStore.getState().active,
    },
    {
      id: "box",
      label: "Box",
      shortcut: "B",
      accent: ACCENT_BOX,
      icon: BoxIcon,
      toggle: () => { useSectionStore.getState().toggleBox(); },
      isActive: () => useSectionStore.getState().boxEnabled,
    },
    {
      id: "place",
      label: "Place",
      shortcut: "F",
      accent: ACCENT_PLACE,
      icon: PlaceIcon,
      toggle: () => { useCatalogueStore.getState().toggleDrawer(); },
      isActive: () => useCatalogueStore.getState().drawerOpen,
    },
  ], []);

  const toolCount = tools.length;

  // Derive active tool from store state
  const derivedActiveId = measureActive ? "measure"
    : xrayEnabled ? "xray"
    : tapeActive ? "tape"
    : boxEnabled ? "box"
    : catalogueOpen ? "place"
    : null;

  useEffect(() => {
    setActiveToolId(derivedActiveId);
  }, [derivedActiveId]);

  const activeAccent = useMemo(() => {
    if (activeToolId === null) return null;
    const t = tools.find((t) => t.id === activeToolId);
    return t?.accent ?? null;
  }, [activeToolId, tools]);

  // ------- Open/close (pure click toggle) -------

  const toggleArc = useCallback(() => {
    setArcOpen((prev) => {
      if (!prev) playArcOpenSound(toolCount);
      else playArcCloseSound(toolCount);
      return !prev;
    });
    setHoveredIndex(-1);
  }, [toolCount]);

  // ------- Tool activation -------

  const activateTool = useCallback((index: number) => {
    const tool = tools[index];
    if (tool === undefined) return;
    tool.toggle();
    playActivationClick(index);
    setArcOpen(false);
    setHoveredIndex(-1);
  }, [tools]);

  // ------- Keyboard shortcuts -------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.code === "Escape") {
        if (activeToolId !== null) {
          const tool = tools.find((t) => t.id === activeToolId);
          if (tool !== undefined && tool.isActive()) {
            tool.toggle();
          }
        }
        setArcOpen(false);
        setHoveredIndex(-1);
        return;
      }

      const key = e.key.toUpperCase();
      const toolIndex = tools.findIndex((t) => t.shortcut === key);
      if (toolIndex === -1) return;

      e.preventDefault();

      if (arcOpen) {
        pulseIndexRef.current = toolIndex;
        setTimeout(() => { pulseIndexRef.current = null; }, 250);
      }

      activateTool(toolIndex);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [tools, activeToolId, arcOpen, activateTool]);

  // ------- Toolbox breathing spring (only visual, no interaction logic) -------

  const breathingSpring = useSpring({
    loop: true,
    from: { scale: 1.0 },
    to: [{ scale: 1.02 }, { scale: 1.0 }],
    config: { duration: 1500 },
    pause: arcOpen,
  });

  // ------- Render -------
  //
  // Architecture: ONE container div with pointerEvents "auto".
  // Tools are positioned in a horizontal row to the LEFT of the toolbox.
  // CSS transitions with a jelly cubic-bezier handle the shotgun blast animation.
  // Stagger is fast (25ms) so they blast out nearly simultaneously.

  // Container width: toolbox + gap + all tools with gaps
  const rowWidth = TOOLBOX_SIZE + TOOLBOX_GAP + toolCount * TOOL_SIZE + (toolCount - 1) * TOOL_GAP;

  return (
    <>
      {/* Invisible backdrop — only when open, closes on click */}
      {arcOpen && (
        <div
          data-testid="toolbar-backdrop"
          onClick={() => {
            setArcOpen(false);
            setHoveredIndex(-1);
            playArcCloseSound(toolCount);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 49,
          }}
        />
      )}

      {/* Main toolbar container */}
      <div
        data-testid="toolbar-root"
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          width: rowWidth,
          height: TOOLBOX_SIZE,
          zIndex: 50,
          pointerEvents: "auto",
        }}
      >

        {/* Tool buttons — horizontal row shooting left from the toolbox */}
        {tools.map((tool, i) => {
          const isHovered = hoveredIndex === i;
          const isActiveTool = activeToolId === tool.id;
          const Icon = tool.icon;
          const rgb = hexToRgb(tool.accent);

          // Each tool sits to the LEFT of the toolbox
          const rightOffset = TOOLBOX_SIZE + computeRowOffset(i);

          // Fast stagger: tools blast out almost simultaneously
          const openDelay = i * STAGGER_MS;
          const closeDelay = (toolCount - 1 - i) * STAGGER_MS;
          const delay = arcOpen ? openDelay : closeDelay;

          return (
            <button
              key={tool.id}
              type="button"
              data-testid={`tool-${tool.id}`}
              data-shortcut={tool.shortcut}
              style={{
                position: "absolute",
                top: (TOOLBOX_SIZE - TOOL_SIZE) / 2,
                right: rightOffset,
                width: TOOL_SIZE,
                height: TOOL_SIZE,
                borderRadius: 10,
                // Accent border — refined, intensifies on interaction
                border: isActiveTool
                  ? `1.5px solid ${tool.accent}`
                  : isHovered
                  ? `1.5px solid rgba(${rgb}, 0.6)`
                  : `1.5px solid rgba(${rgb}, 0.2)`,
                cursor: arcOpen ? "pointer" : "default",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                // Frosted glass — light, airy, with jewel-tone warmth on interaction
                background: isActiveTool
                  ? `linear-gradient(160deg, rgba(${rgb}, 0.18) 0%, rgba(255, 255, 255, 0.85) 100%)`
                  : isHovered
                  ? `linear-gradient(160deg, rgba(${rgb}, 0.1) 0%, rgba(255, 255, 255, 0.8) 100%)`
                  : "rgba(255, 255, 255, 0.7)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                // Shadow: clean lift → accent glow on hover → bright halo when active
                boxShadow: isActiveTool
                  ? `0 0 14px rgba(${rgb}, 0.35), 0 2px 8px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.6)`
                  : isHovered
                  ? `0 0 10px rgba(${rgb}, 0.2), 0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.5)`
                  : "0 1px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)",
                // Icon colour: jewel accent always, darkens slightly on hover for contrast
                color: isActiveTool
                  ? tool.accent
                  : isHovered
                  ? tool.accent
                  : tool.accent,
                // Jelly shotgun blast: translateX from toolbox position to final,
                // with aggressive overshoot bounce
                transform: arcOpen
                  ? (isHovered ? "translateX(0) scale(1.12)" : "translateX(0) scale(1)")
                  : `translateX(${String(rightOffset - TOOLBOX_SIZE / 2 + TOOL_SIZE / 2)}px) scale(0.3)`,
                opacity: arcOpen ? 1 : 0,
                pointerEvents: arcOpen ? "auto" : "none",
                // Jelly curve: big overshoot then settle
                transition: arcOpen
                  ? `transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.6) ${String(delay)}ms, opacity 0.12s ease ${String(delay)}ms, background 0.15s, border-color 0.15s, box-shadow 0.15s, color 0.15s`
                  : `transform 0.2s cubic-bezier(0.6, -0.28, 0.74, 0.05) ${String(delay)}ms, opacity 0.1s ease ${String(delay + 60)}ms, background 0.15s, border-color 0.15s, box-shadow 0.15s, color 0.15s`,
                zIndex: isHovered ? 2 : 1,
              }}
              onClick={(e) => {
                e.stopPropagation();
                activateTool(i);
              }}
              onPointerEnter={() => { setHoveredIndex(i); }}
              onPointerLeave={() => { setHoveredIndex(-1); }}
              title={`${tool.label} (${tool.shortcut})`}
              aria-label={`${tool.label} tool`}
            >
              <Icon />
              <span
                style={{
                  fontSize: 8,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  opacity: isActiveTool ? 1 : isHovered ? 0.9 : 0.65,
                  transition: "opacity 0.15s, color 0.15s",
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  color: isActiveTool ? tool.accent : isHovered ? "#ffffff" : tool.accent,
                }}
              >
                {tool.shortcut}
              </span>
            </button>
          );
        })}

        {/* Active tool badge — shows below toolbox when row is closed */}
        {!arcOpen && activeToolId !== null && (() => {
          const activeTool = tools.find((t) => t.id === activeToolId);
          if (activeTool === undefined) return null;
          const ActiveIcon = activeTool.icon;
          const rgb = hexToRgb(activeTool.accent);
          return (
            <button
              type="button"
              data-testid="active-tool-badge"
              style={{
                position: "absolute",
                top: TOOLBOX_SIZE + 8,
                right: (TOOLBOX_SIZE - 32) / 2,
                width: 32,
                height: 32,
                borderRadius: 8,
                border: `1px solid rgba(${rgb}, 0.25)`,
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `linear-gradient(135deg, rgba(${rgb}, 0.12), rgba(255, 255, 255, 0.75))`,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                boxShadow: `0 0 8px rgba(${rgb}, 0.2), 0 1px 4px rgba(0,0,0,0.08)`,
                color: activeTool.accent,
                zIndex: 3,
              }}
              onClick={(e) => {
                e.stopPropagation();
                activateTool(tools.indexOf(activeTool));
              }}
              title={`${activeTool.label} (active — click to deactivate)`}
              aria-label={`Deactivate ${activeTool.label} tool`}
            >
              <ActiveIcon />
            </button>
          );
        })()}

        {/* Toolbox button — click toggles row */}
        <animated.button
          type="button"
          data-testid="toolbox-button"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: TOOLBOX_SIZE,
            height: TOOLBOX_SIZE,
            borderRadius: 14,
            border: activeAccent !== null
              ? `2px solid rgba(${hexToRgb(activeAccent)}, 0.4)`
              : arcOpen
              ? "2px solid rgba(0, 0, 0, 0.1)"
              : "2px solid rgba(0, 0, 0, 0.06)",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: arcOpen
              ? "rgba(255, 255, 255, 0.85)"
              : "rgba(255, 255, 255, 0.75)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: activeAccent !== null
              ? `0 0 12px rgba(${hexToRgb(activeAccent)}, 0.2), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)`
              : "0 2px 8px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.5)",
            color: activeAccent ?? "#555",
            zIndex: 5,
            transform: arcOpen
              ? "scale(1)"
              : breathingSpring.scale.to((s) => `scale(${String(s)})`),
            transition: "background 0.2s, border-color 0.3s, box-shadow 0.3s",
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggleArc();
          }}
          title="Tools"
          aria-label="Open tools menu"
        >
          <ToolboxIcon />
        </animated.button>

      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Convert hex colour (#RRGGBB) to "R, G, B" string for use in rgba(). */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${String(r)}, ${String(g)}, ${String(b)}`;
}
