export type EditorSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "failed" | "offline";

export interface EditorSaveStatusInput {
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly saveError: string | null;
  readonly lastSavedAt: Date | null;
  readonly isOnline?: boolean;
}

export interface EditorSaveStatusCopy {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export function deriveEditorSaveStatus(input: EditorSaveStatusInput): EditorSaveStatus {
  if (input.isSaving) return "saving";
  if (input.isOnline === false) return "offline";
  if (input.saveError !== null) return "failed";
  if (input.isDirty) return "unsaved";
  if (input.lastSavedAt !== null) return "saved";
  return "idle";
}

export function copyForEditorSaveStatus(status: EditorSaveStatus): EditorSaveStatusCopy {
  switch (status) {
    case "saving":
      return {
        label: "Saving...",
        shortLabel: "Saving",
        description: "Saving your latest layout changes.",
      };
    case "failed":
      return {
        label: "Save failed - retry",
        shortLabel: "Retry",
        description: "The last save did not reach the server. Retry before sending the layout.",
      };
    case "offline":
      return {
        label: "Offline - changes local",
        shortLabel: "Offline",
        description: "Network is unavailable. Changes are currently only in this browser session.",
      };
    case "unsaved":
      return {
        label: "Unsaved changes",
        shortLabel: "Unsaved",
        description: "This layout has local changes that have not been saved yet.",
      };
    case "saved":
      return {
        label: "Saved just now",
        shortLabel: "Saved",
        description: "The current layout has been saved.",
      };
    case "idle":
      return {
        label: "Save Layout",
        shortLabel: "Save",
        description: "Save the current layout before sharing it with the events team.",
      };
  }
}
