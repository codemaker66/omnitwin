export const PLANNER_TOOLBAR_COMMAND_EVENT = "venviewer:planner-toolbar-command";

export type PlannerToolbarCommand = "open-furniture" | "open-markup" | "select";

export function dispatchPlannerToolbarCommand(command: PlannerToolbarCommand): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PlannerToolbarCommand>(
    PLANNER_TOOLBAR_COMMAND_EVENT,
    { detail: command },
  ));
}

export function readPlannerToolbarCommand(event: Event): PlannerToolbarCommand | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (detail === "open-furniture" || detail === "open-markup" || detail === "select") {
    return detail;
  }
  return null;
}
