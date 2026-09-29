import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { listPricingRules, type PricingRule } from "../../../api/pricing.js";
import type { Space } from "../../../api/spaces.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { addedWords, priceListView, type PriceListEvent, type PriceListGroup, type PriceListOffer } from "./price-list-format.js";

// ---------------------------------------------------------------------------
// Add from price list (roadmap X1), beside Add a line. Opening it reads the
// venue's price list; a price picked is added as a line and said, and the
// list stays open for another. A price an hour, or a head with no guest
// count, hands focus to the new line's quantity. Done, or Escape, closes it
// and gives focus back to the button that opened it.
// ---------------------------------------------------------------------------

type ListRead =
  | { readonly status: "idle" | "loading" | "error"; readonly venueId: string }
  | { readonly status: "ready"; readonly venueId: string; readonly rules: readonly PricingRule[] };

interface PriceListProps {
  readonly venueId: string;
  readonly event: PriceListEvent;
  readonly rooms: readonly Space[];
  readonly disabled: boolean;
  /** Adds the offer's line and gives back its number. */
  readonly onAdd: (offer: PriceListOffer) => number;
}

export function PriceList({ venueId, event, rooms, disabled, onAdd }: PriceListProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<ListRead>({ status: "idle", venueId });
  const [otherRooms, setOtherRooms] = useState(false);
  const [said, setSaid] = useState("");
  const panelId = useId();
  const titleId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Each read is numbered, so an answer overtaken by another, or arriving
  // after the composer has gone, is dropped.
  const readNumber = useRef(0);
  useEffect(() => () => { readNumber.current += 1; }, []);

  const load = useCallback(() => {
    readNumber.current += 1;
    const mine = readNumber.current;
    setRead({ status: "loading", venueId });
    listPricingRules(venueId)
      .then((rules) => { if (readNumber.current === mine) setRead({ status: "ready", venueId, rules }); })
      .catch(() => { if (readNumber.current === mine) setRead({ status: "error", venueId }); });
  }, [venueId]);

  // A list read for another venue is not this one's.
  const current: ListRead = read.venueId === venueId ? read : { status: "idle", venueId };
  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setSaid("");
    if (current.status === "idle" || current.status === "error") load();
  };
  const close = (): void => {
    setOpen(false);
    toggleRef.current?.focus();
  };
  const onKeyDown = (keyboard: KeyboardEvent<HTMLDivElement>): void => {
    if (keyboard.key !== "Escape") return;
    // Only the list closes; the proposal stays open.
    keyboard.preventDefault();
    keyboard.stopPropagation();
    close();
  };
  const pick = (offer: PriceListOffer): void => {
    setSaid(addedWords(offer, onAdd(offer)));
  };

  return (
    <>
      <button type="button" className="enq-quiet" ref={toggleRef} data-testid="price-list-toggle" aria-expanded={open}
        aria-controls={open ? panelId : undefined} disabled={disabled} onClick={toggle}>
        Add from price list
      </button>
      {open && (
        <div className="pr-prices" id={panelId} role="region" aria-labelledby={titleId} data-testid="price-list" onKeyDown={onKeyDown}>
          <p className="pr-prices__title" id={titleId}>Price list</p>
          {current.status === "loading" && <ActivityStatus>Reading the price list…</ActivityStatus>}
          {current.status === "error" && (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="price-list-error">The price list could not be read.</p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" data-testid="price-list-retry" onClick={load}>Try again</button>
              </div>
            </>
          )}
          {current.status === "ready" && (
            <Offers rules={current.rules} rooms={rooms} event={event} disabled={disabled}
              otherRooms={otherRooms} onOtherRooms={() => { setOtherRooms((shown) => !shown); }} onPick={pick} />
          )}
          <p className="enq-next__hint" role="status" data-testid="price-list-said">{said}</p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="price-list-done" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}

function Offers({ rules, rooms, event, disabled, otherRooms, onOtherRooms, onPick }: {
  readonly rules: readonly PricingRule[];
  readonly rooms: readonly Space[];
  readonly event: PriceListEvent;
  readonly disabled: boolean;
  readonly otherRooms: boolean;
  readonly onOtherRooms: () => void;
  readonly onPick: (offer: PriceListOffer) => void;
}): ReactElement {
  const view = priceListView(rules, rooms, event);
  const othersId = useId();
  const nothing = view.first.length === 0 && view.rooms.length === 0;
  // With the event's room known, other rooms' prices wait behind a button;
  // with it unknown, every room's are shown.
  const roomKnown = event.spaceId !== null;
  const shownRooms = !roomKnown || otherRooms;
  return (
    <>
      {nothing && view.leftOut.length === 0 && <p className="enq-next__hint" data-testid="price-list-empty">The venue's price list is empty.</p>}
      {!nothing && <p className="enq-next__hint">Pick a price to add it as a line.</p>}
      {view.first.map((group) => <OfferGroup key={group.key} group={group} disabled={disabled} onPick={onPick} />)}
      {roomKnown && view.rooms.length > 0 && (
        <div className="enq-actions">
          <button type="button" className="enq-quiet" data-testid="price-list-other-rooms" aria-expanded={otherRooms}
            aria-controls={otherRooms ? othersId : undefined} onClick={onOtherRooms}>
            Other rooms' prices
          </button>
        </div>
      )}
      {shownRooms && view.rooms.length > 0 && (
        <div id={othersId} className="pr-prices__rooms">
          {view.rooms.map((group) => <OfferGroup key={group.key} group={group} disabled={disabled} onPick={onPick} />)}
        </div>
      )}
      {view.leftOut.length > 0 && (
        <div className="pr-prices__left" data-testid="price-list-left-out">
          {view.leftOut.map((sentence) => <p key={sentence} className="enq-next__hint">{sentence}</p>)}
        </div>
      )}
    </>
  );
}

function OfferGroup({ group, disabled, onPick }: {
  readonly group: PriceListGroup;
  readonly disabled: boolean;
  readonly onPick: (offer: PriceListOffer) => void;
}): ReactElement {
  const headingId = useId();
  return (
    <div className="pr-prices__group" role="group" aria-labelledby={headingId}>
      <p className="pr-prices__heading" id={headingId}>{group.heading}</p>
      <ul className="pr-prices__list">
        {group.offers.map((offer) => (
          <li key={offer.id}>
            <button type="button" className="pr-price" data-testid={`price-${offer.id}`} disabled={disabled}
              onClick={() => { onPick(offer); }}>
              <span className="pr-price__name">{offer.name}</span>
              <span className="pr-price__figure">{offer.price}</span>
              {offer.adjustment !== null && <span className="pr-price__note">{offer.adjustment}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
