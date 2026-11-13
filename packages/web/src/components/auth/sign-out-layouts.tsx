import { useCallback, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "../shared/ConfirmModal.js";
import { countPlannerDraftsOf, purgePlannerDraftsOf } from "../../lib/planner-draft-storage.js";

// ---------------------------------------------------------------------------
// Signing out of a browser someone else may use next takes this person's
// unsaved planner work off it (planner-draft-storage.ts): kept for a reload or
// a dropped network, it would otherwise sit readable for up to thirty days.
// While any is here they are asked first, as the Proposals desk asks about its
// words (sign-out-words.tsx); with nothing unsaved the sign-out goes at once.
// ---------------------------------------------------------------------------

interface Asking {
  readonly person: string;
  readonly signOut: () => void;
  readonly layouts: number;
}

function unsavedLayouts(layouts: number): string {
  const what = layouts === 1 ? "one layout" : `${String(layouts)} layouts`;
  return `Your changes to ${what} are not saved yet. They are kept on this device; signing out removes them.`;
}

/** `askFirst` signs out at once (taking this person's kept work off the
 *  device), or once the person chooses to leave unsaved layout changes;
 *  `question` is the dialog to show meanwhile. Staying, focus goes back to the
 *  control signed out from, as the dialog hands it back; `onStay` gives it a
 *  place when that control has gone from sight. */
export function useSignOutLayouts(person: string | null, onStay: () => void): {
  readonly askFirst: (signOut: () => void) => void;
  readonly question: ReactElement | null;
} {
  const [asking, setAsking] = useState<Asking | null>(null);
  const askFirst = useCallback((signOut: () => void): void => {
    if (person === null) {
      signOut();
      return;
    }
    const layouts = countPlannerDraftsOf(person);
    if (layouts === 0) {
      purgePlannerDraftsOf(person);
      signOut();
    } else {
      setAsking({ person, signOut, layouts });
    }
  }, [person]);
  const stay = (): void => {
    setAsking(null);
    // Once the dialog has gone and handed focus back.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || active.closest("[hidden]") !== null) onStay();
    });
  };
  const question = asking === null ? null : createPortal(
    <ConfirmModal title="Sign out with layout changes not saved?" message={unsavedLayouts(asking.layouts)} confirmLabel="Discard and sign out"
      onCancel={stay}
      onConfirm={() => { setAsking(null); purgePlannerDraftsOf(asking.person); asking.signOut(); }} />,
    document.body,
  );
  return { askFirst, question };
}
