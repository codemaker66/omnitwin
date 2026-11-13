import { create } from "zustand";

// ---------------------------------------------------------------------------
// The new chrome's zones (T-671 slice 6; spec 1.1 law 4, 5.1–5.4).
//
// One panel per zone. The left zone is for making (Add, History, Event
// details), the right for deciding (Details, Lay out, Send, a workspace, Sign
// in). A second panel in a zone replaces the first. An open side zone asks the
// room to make room: the camera's view offset slides the room into the space
// the zones leave (the camera applies it on `dialGlide`, slice 8).
// ---------------------------------------------------------------------------

const LEFT_PANELS = ["add", "history", "event-details"] as const;
const RIGHT_PANELS = ["details", "lay-out", "send", "workspace", "sign-in"] as const;

export type LeftPanel = (typeof LEFT_PANELS)[number];
export type RightPanel = (typeof RIGHT_PANELS)[number];
export type ChromeZone = "left" | "right";

function isLeftPanel(panel: string): panel is LeftPanel {
  return (LEFT_PANELS as readonly string[]).includes(panel);
}

function isRightPanel(panel: string): panel is RightPanel {
  return (RIGHT_PANELS as readonly string[]).includes(panel);
}

/** The gutter round the chrome on a desktop or tablet (spec 5.1). */
export const CHROME_GUTTER_PX = 20;

/** The side zones' widths: left 360, right 344, both 320 under 1280 px (spec 5.1, 5.2, 6.7). */
export const ZONE_WIDTH_PX = { left: 360, right: 344, compact: 320 } as const;

/** Up to this a phone: sheets replace the dock, and the room does not move aside. */
const PHONE_MAX_WIDTH_PX = 767;
const COMPACT_MAX_WIDTH_PX = 1279;

export interface ChromeZones {
  readonly left: LeftPanel | null;
  readonly right: RightPanel | null;
}

/** The width of the room each side zone covers, in CSS pixels: what the room makes room for. */
export interface ViewOffsetRequest {
  readonly left: number;
  readonly right: number;
}

export function requestedViewOffset(zones: ChromeZones, viewportWidth: number): ViewOffsetRequest {
  if (viewportWidth <= PHONE_MAX_WIDTH_PX) return { left: 0, right: 0 };
  const compact = viewportWidth <= COMPACT_MAX_WIDTH_PX;
  const width = (side: ChromeZone): number => (compact ? ZONE_WIDTH_PX.compact : ZONE_WIDTH_PX[side]) + CHROME_GUTTER_PX;
  return {
    left: zones.left === null ? 0 : width("left"),
    right: zones.right === null ? 0 : width("right"),
  };
}

interface PlannerChromeState extends ChromeZones {
  /** Opens a panel in its zone, replacing whatever was there. */
  readonly open: {
    (zone: "left", panel: LeftPanel): void;
    (zone: "right", panel: RightPanel): void;
  };
  readonly close: (zone: ChromeZone) => void;
  readonly closeAll: () => void;
  /** What the room is asked to give up at this viewport width. */
  readonly viewOffset: (viewportWidth: number) => ViewOffsetRequest;
}

export const usePlannerChromeStore = create<PlannerChromeState>()((set, get) => ({
  left: null,
  right: null,
  open: (zone: ChromeZone, panel: string): void => {
    if (zone === "left" && isLeftPanel(panel)) set({ left: panel });
    if (zone === "right" && isRightPanel(panel)) set({ right: panel });
  },
  close: (zone) => {
    if (zone === "left") set({ left: null });
    else set({ right: null });
  },
  closeAll: () => { set({ left: null, right: null }); },
  viewOffset: (viewportWidth) => requestedViewOffset(get(), viewportWidth),
}));
