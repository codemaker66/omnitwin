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
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function firstDirectSummary(details: Element): Element | undefined {
  return Array.from(details.children).find((child) => child.tagName === "SUMMARY");
}

function isExposedByDisclosure(node: HTMLElement): boolean {
  // Only the first direct summary receives native disclosure keyboard behaviour.
  if (node.tagName === "SUMMARY" && (node.parentElement?.tagName !== "DETAILS" ||
      firstDirectSummary(node.parentElement) !== node)) return false;
  let ancestor = node.parentElement;
  while (ancestor !== null) {
    if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open") &&
        firstDirectSummary(ancestor)?.contains(node) !== true) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

function visibleFocusableNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((node) => !node.hasAttribute("disabled"))
    .filter((node) => node.getAttribute("tabindex") !== "-1")
    .filter((node) => node.closest("[hidden], [aria-hidden='true']") === null)
    .filter(isExposedByDisclosure)
    .filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    });
}

function focusFirstNode(container: HTMLElement): void {
  const first = visibleFocusableNodes(container)[0];
  if (first !== undefined) {
    first.focus();
    return;
  }
  if (!container.hasAttribute("tabindex")) {
    container.setAttribute("tabindex", "-1");
  }
  container.focus();
}

/**
 * Returns a ref to attach to the modal/dialog container.
 * While mounted, focus is moved into the container and Tab/Shift+Tab cycle
 * inside it even if the opener still owns focus for a frame after mount.
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
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    window.requestAnimationFrame(() => {
      if (document.contains(el) && !el.contains(document.activeElement)) {
        focusFirstNode(el);
      }
    });

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Tab") return;

      const focusable = visibleFocusableNodes(el);

      if (focusable.length === 0) {
        e.preventDefault();
        focusFirstNode(el);
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        if (e.shiftKey) {
          last.focus();
        } else {
          first.focus();
        }
        return;
      }

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

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Hand focus back to whatever opened the dialog, but only when it would
      // otherwise be lost: still inside the closing dialog, or dropped on the
      // page. A dialog whose action has already put focus somewhere on
      // purpose (the Diary palette focuses the booking it found) keeps it.
      const current = document.activeElement;
      const lost = current === null || current === document.body || el.contains(current);
      if (lost && previousActive !== null && document.contains(previousActive)) {
        previousActive.focus();
      }
    };
  }, [active]);

  return containerRef;
}

// ---------------------------------------------------------------------------
// useEscapeToClose — the other half of the modal contract
//
// T-615: five aria-modal dialogs shipped without either a focus trap or an
// Escape key, and several more handled Escape with a React onKeyDown on the
// overlay — which only fires while focus is already inside, so Escape did
// nothing whenever the opener still held focus. This listens on the document
// in the capture phase, alongside the trap, so the two always agree.
//
// Pass `active: false` (not "omit the hook") while an irreversible write is in
// flight: the dialog keeps its trap and simply refuses to dismiss.
// ---------------------------------------------------------------------------
export function useEscapeToClose(onClose: () => void, active = true): void {
  const handlerRef = useRef(onClose);
  handlerRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      handlerRef.current();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => { document.removeEventListener("keydown", handleKeyDown, true); };
  }, [active]);
}
