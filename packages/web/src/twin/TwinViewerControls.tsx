import {
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import {
  TWIN_ENQUIRE_LABEL,
  TWIN_FULLSCREEN_ENTER,
  TWIN_FULLSCREEN_EXIT,
  TWIN_SHARE_COPIED,
  TWIN_SHARE_LABEL,
  twinEnquireAria,
} from "./twin-copy.js";
import { TwinEnquiryModal } from "./TwinEnquiryModal.js";
import { useFullscreen } from "./useFullscreen.js";

// -----------------------------------------------------------------------------
// TwinViewerControls — the right-edge utility rail (finding [2]/[4]/[5]).
//
// One governed cluster so nothing can collide with the label / mode / surface /
// disclosure / minimap / coach: a flex column below the mode+surface stack.
// Enquire (the only gold-filled HUD element) is the way OUT of the walkthrough
// into the venue's real planning + enquiry funnel — the twin is no longer a
// dead-end. Share prefers the native sheet, falls back to the clipboard, and
// announces "Link copied" in a polite live region (not colour alone). Fullscreen
// is shown only where the Fullscreen API exists (never a no-op button). The rail
// itself is pointer-events:none so its dead gaps stay click-through to travel;
// only the controls take the pointer.
// -----------------------------------------------------------------------------

/** How long the share button shows its "copied" check before reverting. */
const COPIED_REVERT_MS = 1600;

type ShareOutcome = "shared" | "copied" | "failed";

/** Prefer the OS share sheet (mobile); otherwise copy the link. Never throws. */
async function shareOrCopyLink(url: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ url });
      return "shared";
    } catch {
      // Cancelled or unsupported payload — fall through to the clipboard.
    }
  }
  const clipboard =
    typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard !== undefined && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(url);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}

export interface TwinViewerControlsProps {
  readonly venueSlug: string;
  readonly venueName: string;
  /** The element to take fullscreen — the viewer root (canvas + HUD). */
  readonly viewerRef: RefObject<HTMLDivElement | null>;
}

export function TwinViewerControls({
  venueSlug,
  venueName,
  viewerRef,
}: TwinViewerControlsProps): ReactElement {
  const fullscreen = useFullscreen(viewerRef);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [enquireOpen, setEnquireOpen] = useState(false);
  const revertTimer = useRef<number | null>(null);

  const onShare = useCallback((): void => {
    void shareOrCopyLink(window.location.href).then((outcome) => {
      if (outcome !== "copied") {
        // "shared" carries the OS sheet's own confirmation; "failed" stays quiet.
        return;
      }
      setCopied(true);
      setAnnounce(TWIN_SHARE_COPIED);
      if (revertTimer.current !== null) {
        window.clearTimeout(revertTimer.current);
      }
      revertTimer.current = window.setTimeout(() => {
        setCopied(false);
        setAnnounce("");
      }, COPIED_REVERT_MS);
    });
  }, []);

  return (
    <>
      {enquireOpen && (
        <TwinEnquiryModal
          venueSlug={venueSlug}
          venueName={venueName}
          onClose={() => {
            setEnquireOpen(false);
          }}
        />
      )}
      <div className="vv-twin-controls">
        <button
          type="button"
          className="vv-twin-enquire"
          aria-label={twinEnquireAria(venueName)}
          aria-haspopup="dialog"
          onClick={() => {
            setEnquireOpen(true);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />
          </svg>
          {TWIN_ENQUIRE_LABEL}
        </button>

      <button
        type="button"
        className="vv-twin-utility-btn"
        onClick={onShare}
        aria-label={TWIN_SHARE_LABEL}
      >
        {copied ? (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
          </svg>
        )}
      </button>

      {fullscreen.supported && (
        <button
          type="button"
          className="vv-twin-utility-btn vv-twin-fullscreen"
          onClick={fullscreen.toggle}
          aria-label={
            fullscreen.isFullscreen ? TWIN_FULLSCREEN_EXIT : TWIN_FULLSCREEN_ENTER
          }
          aria-pressed={fullscreen.isFullscreen}
        >
          {fullscreen.isFullscreen ? (
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden
            >
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden
            >
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          )}
        </button>
      )}

        <p
          className="vv-sr-only"
          aria-live="polite"
          data-testid="twin-share-status"
        >
          {announce}
        </p>
      </div>
    </>
  );
}
