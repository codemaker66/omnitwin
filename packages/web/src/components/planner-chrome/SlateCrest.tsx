import { useEffect, useState, type ReactElement } from "react";
import { Building2 } from "lucide-react";
import { useChromePresenceStore } from "../../stores/chrome-presence-store.js";
import { CLEAR_HINT_MS } from "../editor/cockpit/ChromeFold.js";
import { crestFocusIsQuiet } from "../editor/cockpit/CrestLabel.js";
import { useTooltip, useTooltipStore } from "./Tooltip.js";
import "./chrome.css";
import "./slate.css";
import "./fold.css";

// ---------------------------------------------------------------------------
// The crest on the slate hides and shows the tools (T-680, in the new chrome;
// T-671). Blake chose for the planner on 28 Oct 2026: "Crest hides; name goes
// home". The crest is the switch; on a cleared screen it is the one mark left,
// at rest exactly where it always is, so nobody is ever stranded. \ and Esc
// work as they do in today's planner (ChromePresence); fold.css draws the rest.
// ---------------------------------------------------------------------------

/** What the crest is called while the tools show, and while they are hidden. */
export function crestName(cleared: boolean): string {
  return cleared ? "Show the tools" : "Hide the tools";
}

export interface CrestNoteWords {
  /** What the eye reads beside the crest. */
  readonly text: string;
  /** What a screen reader says: at its usual punctuation level a bare \ is silent. */
  readonly voice: string;
}

/** The first-use note. Without a hover there is likely no keyboard either, so a finger is told to tap. */
export function crestNoteWords(touchOnly: boolean): CrestNoteWords {
  return touchOnly
    ? { text: "The tools are hidden · tap the crest to bring them back", voice: "The tools are hidden. Tap the crest to bring them back." }
    : { text: "The tools are hidden · press \\ or the crest to bring them back", voice: "The tools are hidden. Press backslash or the crest to bring them back." };
}

function touchOnlyDevice(): boolean {
  try {
    return window.matchMedia("(hover: none)").matches;
  } catch {
    return false;
  }
}

/**
 * Says, the first few times on a device, how cleared chrome comes back. The
 * voice is in the accessibility tree before its words arrive, so they are
 * spoken; the ink beside the crest is what the eye reads, and fades.
 */
function CrestNote(): ReactElement {
  const pending = useChromePresenceStore((state) => state.hintPending);
  const [words] = useState(() => crestNoteWords(touchOnlyDevice()));
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => { useChromePresenceStore.getState().dismissHint(); }, CLEAR_HINT_MS);
    return () => { window.clearTimeout(timer); };
  }, [pending]);
  return (
    <p className="pc-lacquer pc-crest-note" data-shown={pending ? "true" : "false"} data-testid="crest-note">
      <span className="vv-sr-only" role="status">{pending ? words.voice : ""}</span>
      <span aria-hidden="true">{words.text}</span>
    </p>
  );
}

export interface SlateCrestProps {
  /** The venue's crest, or null for the house mark. */
  readonly logoUrl: string | null;
  readonly onLogoError: () => void;
}

export function SlateCrest({ logoUrl, onLogoError }: SlateCrestProps): ReactElement {
  const cleared = useChromePresenceStore((state) => state.cleared);
  const name = crestName(cleared);
  const tooltip = useTooltip({ text: name, keys: ["\\"], side: "below" });
  // The tools going or coming answers the crest's name, and any other name
  // over chrome that has gone, so the next Esc brings the tools back instead
  // of putting a name away (the 4 Nov fix in today's planner).
  useEffect(() => useChromePresenceStore.subscribe((state, previous) => {
    if (state.cleared !== previous.cleared) useTooltipStore.getState().hide();
  }), []);
  return (
    <div className="pc-slate__crest-seat">
      <button
        type="button"
        className="pc-slate__crest"
        data-planner-crest=""
        aria-label={name}
        aria-keyshortcuts={"\\"}
        {...tooltip}
        // Focus the chrome moves here itself arrives without the name (focusCrestQuietly).
        onFocus={(event) => { if (!crestFocusIsQuiet()) tooltip.onFocus(event); }}
        onClick={() => { useChromePresenceStore.getState().toggleCleared(); }}
      >
        {logoUrl !== null
          ? <img src={logoUrl} alt="" onError={onLogoError} />
          : <Building2 className="pc-icon" aria-hidden="true" />}
      </button>
      <CrestNote />
    </div>
  );
}
