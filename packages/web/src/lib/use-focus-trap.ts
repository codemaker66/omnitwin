import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// useFocusTrap — traps Tab/Shift+Tab within a container element
//
// WCAG 2.1 SC 2.4.3: focus order must be meaningful. Modal dialogs must
// trap focus so keyboard users can't Tab behind the overlay.
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Returns a ref to attach to the modal/dialog container.
 * While mounted, Tab and Shift+Tab cycle within the container.
 */
export function useFocusTrap<T extends HTMLElement>(
  active = true,
): React.RefObject<T> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (container === null) return;

    const el = container; // narrow once, capture non-null
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((node) => node.offsetParent !== null); // visible only

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    el.addEventListener("keydown", handleKeyDown);
    return () => { el.removeEventListener("keydown", handleKeyDown); };
  }, [active]);

  return containerRef;
}
