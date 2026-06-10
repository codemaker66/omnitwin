import { useEffect } from "react";
import { useEditorStore } from "../stores/editor-store.js";
import { useMarkupStore } from "../stores/markup-store.js";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return target.isContentEditable;
}

/**
 * Global undo/redo keyboard shortcuts for the venue planner.
 *
 * Mount once in the editor page shell so the shortcuts work in both the 3D
 * scene and the 2D blueprint view — both drive the single editor-store
 * history timeline.
 *
 * Deliberately inert while:
 * - focus is in a text field or contenteditable (native text undo must win), and
 * - the laser markup tool is active (MarkupLayer owns Ctrl+Z as stroke undo).
 */
export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Shift+Z arrives as "Z" — normalise before matching.
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      if (isTypingTarget(event.target)) return;
      if (useMarkupStore.getState().active) return;

      event.preventDefault();
      const editor = useEditorStore.getState();
      if (isUndo) {
        editor.undo();
      } else {
        editor.redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);
}
