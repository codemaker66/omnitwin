import type { TransitionTarget } from "./EnquiryPanel.js";

// ---------------------------------------------------------------------------
// Where keyboard focus goes after the desk's next render.
//
// A handler records the target and an effect applies it after a commit. The
// effect runs after every commit, and React flushes an earlier commit's
// pending effects before it renders a keypress. So a render that does not yet
// show the target can see the request: without a check, it spent the request
// on the enquiry being replaced, and focus fell to the page once that panel
// unmounted. It happened when j followed an approval's background refresh:
// one run in five on the browser suite, 26 September 2026.
//
// Each target therefore names the render it waits for, and the effect leaves
// it pending until a render shows that state.
// ---------------------------------------------------------------------------

export type PendingFocus =
  /** The heading of the enquiry just opened. */
  | { readonly kind: "panel"; readonly id: string }
  /** The row of the enquiry just closed. */
  | { readonly kind: "row"; readonly id: string }
  /** The control that asked for a confirmation the reader then cancelled. */
  | { readonly kind: "action"; readonly to: TransitionTarget };

export interface RenderedDesk {
  /** The enquiry this render shows in the panel, or null when none is shown. */
  readonly shownId: string | null;
  /** The decision this render is asking the reader to confirm, if any. */
  readonly confirming: TransitionTarget | null;
}

/** Whether this render shows what the pending focus is waiting for. */
export function pendingFocusReady(pending: PendingFocus, rendered: RenderedDesk): boolean {
  switch (pending.kind) {
    case "panel":
      return rendered.shownId === pending.id;
    case "row":
      return rendered.shownId === null;
    case "action":
      return rendered.confirming === null;
  }
}
