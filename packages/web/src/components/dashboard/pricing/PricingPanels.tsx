import { useId, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { PricingAdviceItem } from "@omnitwin/types";
import type { DeskRule } from "../../../api/pricing-desk.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import {
  adviceHeadline,
  changeLine,
  datesWords,
  dayWords,
  leadWords,
  moneyWords,
  perWords,
  priceWords,
  rangeWords,
  recordsWords,
  retireWords,
  roomName,
  settersWords,
  timeWords,
} from "./pricing-desk-format.js";

// ---------------------------------------------------------------------------
// The forest panel's three faces: the desk at rest, one rate (its figures,
// who changed it and when, and what may be done with it), and one suggestion
// (the figure, the reasons and the records behind them). Every refusal names
// the people who can act, and every action says what it does first.
// ---------------------------------------------------------------------------

type Rooms = readonly { readonly id: string; readonly name: string }[];

function PanelFrame({ label, layout, onClose, children }: {
  readonly label: string;
  readonly layout: "wide" | "single";
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <aside className="enq-panel pr-panel" data-register="forest" aria-label={label}>
      <div className="enq-panel__body">
        <div className="enq-panel__bar">
          {layout === "single" ? (
            <button type="button" className="enq-back pr-back" onClick={onClose}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to the price list
            </button>
          ) : <span />}
          {layout === "wide" && (
            <button type="button" className="enq-close pr-close" aria-label="Close" aria-keyshortcuts="Escape" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// At rest
// ---------------------------------------------------------------------------

export function DeskOverview(props: {
  readonly canSetPrices: boolean;
  readonly setters: readonly string[];
  readonly inUse: number;
  readonly suggestions: number | null;
  readonly onShowSuggestions: () => void;
  readonly onAdd: () => void;
}): ReactElement {
  return (
    <aside className="enq-panel pr-panel" data-register="forest" aria-label="Price list overview">
      <div className="enq-panel__body enq-overview">
        <h2>The venue's prices</h2>
        {props.canSetPrices ? (
          <>
            <p>Choose a rate to see who changed it and when, or add one. Every quote starts from this list.</p>
            <div className="enq-actions">
              {props.suggestions !== null && props.suggestions > 0 ? (
                <button type="button" className="enq-cta" onClick={props.onShowSuggestions}>
                  Look at {props.suggestions === 1 ? "the suggestion" : `the ${String(props.suggestions)} suggestions`}
                </button>
              ) : (
                <button type="button" className="enq-cta" onClick={props.onAdd}>Add a rate</button>
              )}
            </div>
            <p className="enq-next__hint">Suggestions are advice from the venue's own bookings and enquiries. Nothing changes a price until someone saves it.</p>
          </>
        ) : (
          <>
            <p>{props.inUse === 0 ? "No rates are in use yet." : "Every quote starts from these rates."}</p>
            <p>Prices are set by {settersWords(props.setters)}. To change one, ask them.</p>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// One rate
// ---------------------------------------------------------------------------

export function RatePanel(props: {
  readonly rule: DeskRule;
  readonly rooms: Rooms;
  readonly timeZone: string;
  readonly canSetPrices: boolean;
  readonly setters: readonly string[];
  readonly retired: boolean;
  readonly busy: "retire" | "restore" | null;
  readonly error: string | null;
  readonly layout: "wide" | "single";
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onRetire: () => void;
  readonly onRestore: () => void;
}): ReactElement {
  const { rule, rooms, timeZone, canSetPrices, retired, busy } = props;
  const [confirming, setConfirming] = useState(false);
  const historyId = useId();
  const status = retired ? "Retired" : rule.isActive ? "In use" : "Not in use";
  return (
    <PanelFrame label={`Rate: ${rule.name}`} layout={props.layout} onClose={props.onClose}>
      <p className="enq-eyebrow">{roomName(rule.spaceId, rooms)}</p>
      <h2 className="enq-panel__name" ref={props.headingRef} tabIndex={-1}>{rule.name}</h2>
      <div className="enq-panel__status">
        <span className="enq-chip pr-chip" data-state={retired ? "retired" : rule.isActive ? "in_use" : "paused"}>{status}</span>
      </div>

      <dl className="enq-facts pr-facts">
        <div><dt>Price, {perWords(rule.type)}</dt><dd>{priceWords(rule)}</dd></div>
        <div><dt>Time of day</dt><dd className="enq-facts__room">{timeWords(rule)}</dd></div>
        <div><dt>Dates</dt><dd className="enq-facts__room">{datesWords(rule)}</dd></div>
      </dl>

      {canSetPrices && !retired && !confirming && (
        <div className="enq-actions pr-panel__actions">
          <button type="button" className="enq-cta" onClick={props.onEdit}>Change this rate</button>
          <button type="button" className="enq-quiet" onClick={() => { setConfirming(true); }}>Retire…</button>
        </div>
      )}
      {canSetPrices && !retired && confirming && (
        <div className="enq-confirm" data-tone="declined">
          <p className="enq-confirm__question">Retire “{rule.name}”?</p>
          <p className="enq-confirm__consequence">{retireWords(rule)}</p>
          {props.error !== null && <p className="enq-confirm__error" role="alert">{props.error}</p>}
          <div className="enq-actions">
            <button type="button" className="enq-cta" disabled={busy !== null} aria-busy={busy === "retire"} onClick={props.onRetire}>
              {busy === "retire" && <ActivityIndicator size={18} />}
              {busy === "retire" ? "Retiring…" : "Retire"}
            </button>
            <button type="button" className="enq-quiet" disabled={busy !== null} onClick={() => { setConfirming(false); }}>Keep it</button>
          </div>
        </div>
      )}
      {canSetPrices && retired && (
        <div className="enq-confirm">
          <p className="enq-confirm__consequence">Bringing it back puts it on the list as not in use, so nothing quotes it until you switch it on in its form.</p>
          {props.error !== null && <p className="enq-confirm__error" role="alert">{props.error}</p>}
          <div className="enq-actions">
            <button type="button" className="enq-cta" disabled={busy !== null} aria-busy={busy === "restore"} onClick={props.onRestore}>
              {busy === "restore" && <ActivityIndicator size={18} />}
              {busy === "restore" ? "Bringing it back…" : "Bring it back"}
            </button>
          </div>
        </div>
      )}
      {!canSetPrices && (
        <p className="enq-next__hint">Prices are set by {settersWords(props.setters)}. To change this rate, ask them.</p>
      )}

      <section className="enq-section" aria-labelledby={historyId}>
        <h3 id={historyId}>Who changed it</h3>
        {rule.history.length === 0 ? (
          <p className="pr-quiet">No change has been recorded since it was entered. Changes from now on are recorded here, with who made them and when.</p>
        ) : (
          <ol className="enq-timeline">
            {rule.history.map((entry) => (
              <li key={`${entry.at}-${entry.summary}`}>
                <span className="enq-dot" aria-hidden="true" />
                <strong>{entry.summary}</strong>
                <span>{changeLine(entry, timeZone)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </PanelFrame>
  );
}

// ---------------------------------------------------------------------------
// One suggestion
// ---------------------------------------------------------------------------

type Direction = PricingAdviceItem["reasons"][number]["direction"];

const MARK: Readonly<Record<Direction, { readonly glyph: string; readonly words: string }>> = {
  up: { glyph: "↑", words: "Points up" },
  down: { glyph: "↓", words: "Points down" },
  none: { glyph: "·", words: "For context" },
};

export function AdvicePanel(props: {
  readonly item: PricingAdviceItem;
  /** The rate it is about, while it is still on the list. */
  readonly rule: DeskRule | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly layout: "wide" | "single";
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onClose: () => void;
  readonly onUse: () => void;
  readonly onDismiss: () => void;
}): ReactElement {
  const { item, rule, busy } = props;
  const reasonsId = useId();
  const range = rangeWords(item);
  const usable = item.kind !== "too_little_history" && item.suggestedMinor !== null && rule !== null;
  return (
    <PanelFrame label={`Suggestion for ${item.ruleName} on ${dayWords(item.date)}`} layout={props.layout} onClose={props.onClose}>
      <p className="enq-eyebrow">Suggestion · {dayWords(item.date)}, {leadWords(item.leadDays)}</p>
      <h2 className="enq-panel__name" ref={props.headingRef} tabIndex={-1}>{item.ruleName}</h2>
      <p className="pr-advice__part">{item.roomName} · {item.dayPart}</p>

      {range === null ? (
        <p className="pr-advice__headline">Too little history to suggest a change</p>
      ) : (
        <>
          <p className="pr-advice__figure">{range}</p>
          <p className="pr-advice__headline">{adviceHeadline(item)}</p>
        </>
      )}
      <dl className="enq-facts pr-facts">
        <div><dt>Now, {perWords(item.per)}</dt><dd>{moneyWords(item.currentMinor, item.currency)}</dd></div>
        <div><dt>Records behind it</dt><dd>{item.records.toLocaleString("en-GB")}</dd></div>
      </dl>

      <section className="enq-section" aria-labelledby={reasonsId}>
        <h3 id={reasonsId}>Why</h3>
        <ul className="pr-reasons">
          {item.reasons.map((reason) => (
            <li key={reason.text} data-direction={reason.direction}>
              <span className="pr-reasons__mark" aria-hidden="true">{MARK[reason.direction].glyph}</span>
              <span className="vv-sr-only">{MARK[reason.direction].words}: </span>
              <span>{reason.text}</span>
            </li>
          ))}
        </ul>
        <p className="enq-next__hint">{recordsWords(item.records)}</p>
      </section>

      <section className="enq-section">
        {props.error !== null && <p className="enq-confirm__error" role="alert">{props.error}</p>}
        <div className="enq-actions">
          {usable && item.suggestedMinor !== null && (
            <button type="button" className="enq-cta" disabled={busy} onClick={props.onUse}>
              {item.accept === "edit" ? "Use" : "Add a rate for this date at"} {moneyWords(item.suggestedMinor, item.currency)}…
            </button>
          )}
          <button type="button" className="enq-quiet" disabled={busy} aria-busy={busy} onClick={props.onDismiss}>
            {busy && <ActivityIndicator size={18} />}
            {busy ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
        <p className="enq-next__hint">
          {item.kind === "too_little_history"
            ? "These are the facts so far. A figure is suggested once the record holds enough comparable dates."
            : rule === null
              ? "The rate it is about is no longer on the list, so it cannot be used from here."
              : "Using it opens the rate form filled in. Nothing changes until you save it there."}
        </p>
      </section>
    </PanelFrame>
  );
}
