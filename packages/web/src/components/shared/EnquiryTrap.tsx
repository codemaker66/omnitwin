import { useCallback, useEffect, useRef, type CSSProperties, type ReactElement, type RefObject } from "react";

// -----------------------------------------------------------------------------
// The public enquiry forms' hidden trap (Blake, 12 November 2026): "off-screen
// honeypot, aria-hidden, tabindex=-1, autocomplete=off, plus a minimum fill of
// about 3 s ... a hit keeps the enquiry, suppresses the emails and logs it,
// never refuses; no third party, no cookies."
//
// The walkthrough's, the planner's and the front door's forms each render the
// field and send two readings with the enquiry: what the field holds, and how
// long the form was open before Send. The API judges a hit from them
// (routes/public-enquiries.ts), so the guest sees exactly what any guest sees.
//
// A person never reaches the field. It sits off screen, inside a box hidden
// from the accessibility tree, out of the tab order. It is displayed rather
// than set display:none, because some scripts skip fields that are not
// displayed, and so would never fill it. Autofill and password managers fill
// a field they recognise, displayed or not, by its name, id, label or
// placeholder; this one has no label, id or placeholder, a name that carries
// no word any of them reads ("vv-enq-k"), and autocomplete off.
//
// The value is read from the field itself at Send, never from React state: a
// script that sets it without an input event is still read.
// -----------------------------------------------------------------------------

/** Off screen to the left, and still displayed. Overflow to the left of a
 *  box scrolls nothing, so neither the page nor a dialog grows a scrollbar. */
const OFF_SCREEN: CSSProperties = { position: "absolute", left: "-10000px" };

/** What a form sends of the trap with its enquiry. `openMs` is left out
 *  where the form does not time itself (useEnquiryTrap), which the API reads
 *  as no hit by time. */
export interface EnquiryTrapReading {
  readonly trap: string;
  readonly openMs?: number;
}

export interface EnquiryTrap {
  /** For the form's EnquiryTrapField. */
  readonly inputRef: RefObject<HTMLInputElement>;
  /** The two readings, taken when the form is sent. */
  readonly read: () => EnquiryTrapReading;
}

/**
 * The trap's readings for one form, timed from the moment the form appears.
 * `timed` false sends no time: for a form that opens already filled with what
 * the same guest typed earlier in this tab, where Send at once is a person.
 */
export function useEnquiryTrap(timed = true): EnquiryTrap {
  const inputRef = useRef<HTMLInputElement>(null);
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    // A monotonic clock, so a change to the device's time cannot make a
    // guest's form look as if it was sent the moment it opened.
    openedAt.current = performance.now();
  }, []);
  const read = useCallback((): EnquiryTrapReading => {
    const trap = inputRef.current?.value ?? "";
    const opened = openedAt.current;
    if (!timed || opened === null) return { trap };
    return { trap, openMs: Math.max(0, Math.round(performance.now() - opened)) };
  }, [timed]);
  return { inputRef, read };
}

/** The hidden field itself, rendered inside the form it guards. */
export function EnquiryTrapField({ inputRef }: { readonly inputRef: RefObject<HTMLInputElement> }): ReactElement {
  return (
    <div aria-hidden="true" style={OFF_SCREEN}>
      <input ref={inputRef} type="text" name="vv-enq-k" tabIndex={-1} autoComplete="off" />
    </div>
  );
}
