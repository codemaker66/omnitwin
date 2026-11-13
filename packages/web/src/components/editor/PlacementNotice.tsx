import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import "./PlacementNotice.css";

// ---------------------------------------------------------------------------
// PlacementNotice — one plain line near the floor when a tap placed nothing,
// such as "The venue has one of these, and it is already placed; move it to
// use it elsewhere." It sits above the command deck on a desk and above the
// toolbar on a phone, where the placement coach (desktop only) cannot reach.
//
// The status region is always mounted so a screen reader hears each new line
// (polite, never interrupting). The line clears itself after a few seconds,
// or as soon as the piece being placed is put down or another is chosen.
// Under reduced motion it simply appears.
//
// In the new chrome it sits in the zone above the dock (`zoned`), under the
// door line, and `line` draws it with that chrome's own notice (ruling C2 on
// #388); the rules above are the same there.
// ---------------------------------------------------------------------------

export interface PlacementNoticeProps {
  readonly mobile?: boolean;
  /** In the new chrome's zone above the dock, not fixed near the floor. */
  readonly zoned?: boolean;
  /** How the line is drawn; a plain line when not given. */
  readonly line?: (text: string) => ReactNode;
}

export function PlacementNotice({ mobile = false, zoned = false, line }: PlacementNoticeProps): ReactElement {
  const notice = usePlacementNoticeStore((state) => state.notice);
  const dismiss = usePlacementNoticeStore((state) => state.dismiss);
  const selectedItemId = useCatalogueStore((state) => state.selectedItemId);

  // A line already standing when the region mounts (a reload that puts a held
  // piece back posts it as the loading screen gives way) goes in after the
  // region's first render: a region created already holding its words is not
  // reliably announced (delta review of #388 at 713dc3f1, C5).
  const [inPage, setInPage] = useState(false);
  useEffect(() => { setInPage(true); }, []);

  // Putting the piece down, or choosing another, makes the line about it stale.
  const shownFor = useRef(selectedItemId);
  useEffect(() => {
    if (shownFor.current === selectedItemId) return;
    shownFor.current = selectedItemId;
    dismiss();
  }, [selectedItemId, dismiss]);

  return (
    <div
      className={zoned ? "placement-notice is-zoned" : mobile ? "placement-notice is-mobile" : "placement-notice"}
      role="status"
      aria-live="polite"
      data-testid="placement-notice-region"
    >
      {inPage && notice !== null && (line === undefined ? (
        <p key={notice.id} className="placement-notice__line" data-testid="placement-notice">
          {notice.text}
        </p>
      ) : (
        <div key={notice.id} className="placement-notice__drawn" data-testid="placement-notice">
          {line(notice.text)}
        </div>
      ))}
    </div>
  );
}
