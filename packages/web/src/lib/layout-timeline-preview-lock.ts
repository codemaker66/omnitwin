/**
 * Synchronous mutation gate shared by planner action stores.
 *
 * Timeline state itself stays in its isolated Zustand store. This tiny module
 * avoids coupling editor history/autosave to preview data while still making
 * every mutation entry point fail closed during a phase preview.
 */
let previewMutationLock = false;

export function isLayoutTimelineMutationLocked(): boolean {
  return previewMutationLock;
}

export function setLayoutTimelineMutationLock(locked: boolean): void {
  previewMutationLock = locked;
}
