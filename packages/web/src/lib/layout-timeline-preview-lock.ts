/**
 * Synchronous mutation gate shared by planner action stores.
 *
 * Timeline state itself stays in its isolated Zustand store. This tiny module
 * avoids coupling editor history/autosave to preview data while still making
 * every mutation entry point fail closed during a phase preview.
 */
let previewMutationLock = false;
const lockListeners = new Set<(locked: boolean) => void>();

export function isLayoutTimelineMutationLocked(): boolean {
  return previewMutationLock;
}

export function setLayoutTimelineMutationLock(locked: boolean): void {
  if (previewMutationLock === locked) return;
  previewMutationLock = locked;
  for (const listener of [...lockListeners]) listener(locked);
}

/** Hear the lock open and close (the editor's view-only reason follows it). */
export function onLayoutTimelineMutationLockChange(listener: (locked: boolean) => void): () => void {
  lockListeners.add(listener);
  return () => { lockListeners.delete(listener); };
}
