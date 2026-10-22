import type { ReactElement, ReactNode } from "react";
import "./chrome.css";

/**
 * One key glyph, as tooltips, the command line and the ? sheet show a chord
 * ("Ctrl" "D"). Keys appear only there, never on the controls at rest (spec 2,
 * the Instrument's weakness the final answers).
 */
export function Kbd({ children }: { readonly children: ReactNode }): ReactElement {
  return <kbd className="pc-kbd">{children}</kbd>;
}
