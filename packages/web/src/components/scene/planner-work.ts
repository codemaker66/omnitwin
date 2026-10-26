import { createContext, useContext } from "react";

/**
 * A 3D view inside the planner shows someone's layout, which lives in the
 * editor's stores and outlives anything the view does. The editor provides
 * this; a view without it (a landing, a room walk) holds no one's work and
 * must not promise that any is safe.
 */
export interface PlannerWork {
  /**
   * The planner's own 2D view of the same layout, for a 3D view that cannot
   * draw; null while switching to it is not allowed. It replaces a link to
   * /blueprint, which opens a demonstration plan rather than this layout.
   */
  readonly continueIn2d: (() => void) | null;
}

export const PlannerWorkContext = createContext<PlannerWork | null>(null);

export function usePlannerWork(): PlannerWork | null {
  return useContext(PlannerWorkContext);
}
