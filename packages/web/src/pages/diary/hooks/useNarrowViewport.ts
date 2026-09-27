import { useEffect, useState } from "react";

// The Diary's phone width, as its stylesheet has it (diary-board.css).
const NARROW = "(max-width: 760px)";

function matchesNarrow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}

/** Whether the Diary is on a phone-width screen, following it as it turns
 *  or resizes: there, the week reads as an agenda (roadmap N3). */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(matchesNarrow);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW);
    const follow = (): void => { setNarrow(query.matches); };
    follow();
    query.addEventListener("change", follow);
    return () => { query.removeEventListener("change", follow); };
  }, []);
  return narrow;
}
