import { useCallback, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "../../shared/ConfirmModal.js";
import { forgetWords, proposalsWithWords } from "./proposal-memory.js";

// ---------------------------------------------------------------------------
// Signing out leaves the page, and with it the words written on the Proposals
// desk and not yet saved as a version (proposal-memory.ts). The person
// signing out is asked first while any of theirs are here; leaving them, the
// words are forgotten before the sign-out goes.
// ---------------------------------------------------------------------------

interface Asking {
  readonly person: string;
  readonly signOut: () => void;
  readonly proposals: number;
}

function unsavedWords(proposals: number): string {
  const what = proposals === 1 ? "one proposal" : `${String(proposals)} proposals`;
  return `What you wrote for ${what} is not saved yet. It is still on the Proposals desk; signing out loses it.`;
}

/** `askFirst` signs out at once, or once the person chooses to leave their
 *  words; `question` is the dialog to show meanwhile. Staying, focus goes back
 *  to the control signed out from, as the dialog hands it back; `onStay` gives
 *  it a place when that control has gone from sight (in a menu that closed as
 *  the question took focus) or the click never gave it focus (Safari). */
export function useSignOutWords(person: string | null, onStay: () => void): {
  readonly askFirst: (signOut: () => void) => void;
  readonly question: ReactElement | null;
} {
  const [asking, setAsking] = useState<Asking | null>(null);
  const askFirst = useCallback((signOut: () => void): void => {
    const proposals = person === null ? 0 : proposalsWithWords(person);
    if (person === null || proposals === 0) signOut();
    else setAsking({ person, signOut, proposals });
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
    <ConfirmModal title="Sign out with proposal words not saved?" message={unsavedWords(asking.proposals)} confirmLabel="Discard and sign out"
      onCancel={stay}
      onConfirm={() => { setAsking(null); forgetWords(asking.person); asking.signOut(); }} />,
    document.body,
  );
  return { askFirst, question };
}
