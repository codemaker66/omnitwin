import { useMemo } from "react";
import { create } from "zustand";
import { KEY_PRIORITY, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import {
  WORKSPACES,
  canUseWorkspaces,
  type ProductionPart,
  type WorkspaceId,
} from "../../lib/workspaces-model.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";

// ---------------------------------------------------------------------------
// The workspace in use (T-674, v2 slice 18; spec 4.6, 6.15, 4.2).
//
// Which of the five the menu's key names and the right zone's panel shows,
// and which part of Production is in front. "Design" until someone chooses
// another, and remembered while the planner is open, so the key keeps the
// name of the last one used after its panel closes (frame 20: "Design ▾").
// Opening one replaces whatever the right zone held (one panel per zone).
// ---------------------------------------------------------------------------

interface WorkspaceState {
  readonly workspace: WorkspaceId;
  readonly part: ProductionPart;
  /** Counts each time a workspace is chosen: the panel moves focus to its first control on each. */
  readonly chosen: number;
  readonly setPart: (part: ProductionPart) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  workspace: "design",
  part: "lighting",
  chosen: 0,
  setPart: (part) => { set({ part }); },
}));

/** Whether the right zone is showing a workspace now. */
export function workspacePanelOpen(): boolean {
  return usePlannerChromeStore.getState().right === "workspace";
}

/** Shows a workspace in the right zone, replacing that zone's panel. */
export function chooseWorkspace(workspace: WorkspaceId): void {
  useWorkspaceStore.setState((state) => ({ workspace, chosen: state.chosen + 1 }));
  usePlannerChromeStore.getState().open("right", "workspace");
}

/** Ctrl 1–5: that workspace, or closes it when it is the one showing. */
export function toggleWorkspace(workspace: WorkspaceId): void {
  if (workspacePanelOpen() && useWorkspaceStore.getState().workspace === workspace) {
    usePlannerChromeStore.getState().close("right");
    return;
  }
  chooseWorkspace(workspace);
}

export function closeWorkspace(): void {
  if (workspacePanelOpen()) usePlannerChromeStore.getState().close("right");
}

// The menu's key, which takes focus back when the panel closes (spec 4.5).
// The key lives in the dock and the panel in the right zone, so the key
// registers itself here rather than through a prop neither parent carries.
let trigger: HTMLButtonElement | null = null;

export function setWorkspaceTrigger(element: HTMLButtonElement | null): void {
  trigger = element;
}

export function workspaceTrigger(): HTMLButtonElement | null {
  return trigger !== null && trigger.isConnected ? trigger : null;
}

/** Whether the person at the keyboard sees the workspaces on this plan. */
export function useWorkspacesAllowed(): boolean {
  const planVenueId = useEditorStore((state) => state.space?.venueId ?? state.venueId);
  return useAuthStore((auth) => canUseWorkspaces(auth, planVenueId));
}

/**
 * Ctrl 1–5, through the planner's one keyboard owner, while the person may
 * use the workspaces. They also answer from a field (Ctrl and a digit never
 * types), so moving from the Guests field to Flow is one chord.
 */
export function useWorkspaceKeys(allowed: boolean): void {
  const bindings = useMemo((): KeyBinding[] => WORKSPACES.map((entry): KeyBinding => ({
    keys: [
      { code: `Digit${String(entry.digit)}`, mod: true },
      { code: `Numpad${String(entry.digit)}`, mod: true },
    ],
    priority: KEY_PRIORITY.planner,
    inFields: true,
    when: () => allowed,
    run: () => { toggleWorkspace(entry.id); },
  })), [allowed]);
  usePlannerKeyBindings(bindings);
}
