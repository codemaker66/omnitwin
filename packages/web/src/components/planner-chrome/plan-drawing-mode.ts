import { useEffect, useState } from "react";
import { create } from "zustand";
import { putDownPieceInHand } from "../../lib/planner-keymap.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { useToolStore } from "../../stores/tool-store.js";

// ---------------------------------------------------------------------------
// Plan's Model / Drawing (T-674; approved spec §4.1, §6.3). In Plan the room
// can be read two ways: the model (the captured room, from above) or the
// drawing (the same layout set on paper). Which one is Plan's own choice, kept
// while you go to Room or Walk and come back. Both show one layout, one
// selection and one undo; switching never reloads, never moves the camera and
// never loses the selection.
//
// The drawing cannot hold a tool that works on the room itself (the tape, the
// pen, a card held over the floor) or an act's layout: taking one up shows the
// model, and choosing the drawing puts it down. The most recent choice wins,
// and nothing is left in hand with nowhere to use it.
// ---------------------------------------------------------------------------

export type PlanRegister = "model" | "drawing";

interface PlanDrawingState {
  readonly register: PlanRegister;
  /** The drawing is zoomed in past its fit: the switch then offers Fit. */
  readonly zoomed: boolean;
  /** Counts each ask to fit the room on the page again. */
  readonly fitRequest: number;
  readonly setRegister: (register: PlanRegister) => void;
  readonly setZoomed: (zoomed: boolean) => void;
  readonly requestFit: () => void;
}

export const usePlanDrawingStore = create<PlanDrawingState>()((set, get) => ({
  register: "model",
  zoomed: false,
  fitRequest: 0,
  setRegister: (register) => {
    if (get().register !== register) set({ register });
  },
  setZoomed: (zoomed) => {
    if (get().zoomed !== zoomed) set({ zoomed });
  },
  requestFit: () => { set({ fitRequest: get().fitRequest + 1 }); },
}));

/** Why the drawing cannot be chosen now, or null when it can. */
export function drawingRefusal(previewing: boolean): string | null {
  return previewing ? "Close the act's layout first" : null;
}

function previewingAct(): boolean {
  return useLayoutTimelinePreviewStore.getState().mode !== "inactive";
}

/** Whether something in hand works on the room itself: the tape, the pen, a card held over the floor, or an act's layout shown. */
export function roomInHand(): boolean {
  const tool = useToolStore.getState().activeTool;
  return tool === "measure" || tool === "draw" || useCatalogueStore.getState().selectedItemId !== null || previewingAct();
}

/** Chooses how Plan shows the room. Choosing the drawing puts down the tape, the pen or a card in hand. */
export function chooseRegister(register: PlanRegister): void {
  if (register === "drawing") {
    if (previewingAct()) return;
    const tools = useToolStore.getState();
    if (tools.activeTool === "measure" || tools.activeTool === "draw") tools.setTool("select");
    if (useCatalogueStore.getState().selectedItemId !== null) putDownPieceInHand();
  }
  usePlanDrawingStore.getState().setRegister(register);
}

/** Whether the view is Plan: chosen on the dock (the only way in, and only where the room has set views), and not walking. */
export function usePlanView(): boolean {
  const preset = useHallViewStore((state) => state.activePreset);
  const walking = useCockpitStore((state) => state.walkMode);
  return preset === "plan" && !walking;
}

/** Phones (spec §5.4) have no top centre, so no switch: Plan there is the model. */
const PHONE_QUERY = "(max-width: 767px)";

function phoneNow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}

export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(phoneNow);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    const update = (): void => { setPhone(query.matches); };
    update();
    query.addEventListener("change", update);
    return () => { query.removeEventListener("change", update); };
  }, []);
  return phone;
}

/** Whether the drawing shows: Plan, the drawing chosen, wider than a phone. */
export function usePlanDrawingShown(): boolean {
  const plan = usePlanView();
  const register = usePlanDrawingStore((state) => state.register);
  const phone = usePhoneWidth();
  return plan && register === "drawing" && !phone;
}

/**
 * The register's rules, mounted once with the drawing: taking up a tool that
 * works on the room shows the model, and choosing Plan again (the dock's Plan,
 * Shift 1) fits the room on the page again.
 */
export function usePlanDrawingRules(): void {
  useEffect(() => {
    const yieldToTheRoom = (): void => {
      if (usePlanDrawingStore.getState().register === "drawing" && roomInHand()) usePlanDrawingStore.getState().setRegister("model");
    };
    yieldToTheRoom();
    const unsubscribers = [
      useToolStore.subscribe(yieldToTheRoom),
      useCatalogueStore.subscribe(yieldToTheRoom),
      useLayoutTimelinePreviewStore.subscribe(yieldToTheRoom),
      usePlanDrawingStore.subscribe(yieldToTheRoom),
      useHallViewStore.subscribe((state, before) => {
        if (state.viewRequest !== null && state.viewRequest !== before.viewRequest && state.viewRequest.preset === "plan") {
          usePlanDrawingStore.getState().requestFit();
        }
      }),
    ];
    return () => { for (const unsubscribe of unsubscribers) unsubscribe(); };
  }, []);
}
