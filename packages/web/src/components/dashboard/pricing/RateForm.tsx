import { useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import type { CreatePricingRuleInput } from "../../../api/pricing.js";
import type { DeskRule } from "../../../api/pricing-desk.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import { WINDOW_COPY } from "../pricing-rule-window.js";
import {
  consequenceWords,
  draftChanged,
  readDraft,
  type DraftField,
  type RateDraft,
} from "./pricing-desk-format.js";

// ---------------------------------------------------------------------------
// Add or change a rate, in the forest panel beside the list. What saving
// does is said above Save before it is pressed; nothing is sent until it is.
// A form opened from a suggestion says so, and is the person's to change.
// ---------------------------------------------------------------------------

const TYPES: readonly { readonly value: RateDraft["type"]; readonly label: string }[] = [
  { value: "flat_rate", label: "For the booking" },
  { value: "per_hour", label: "By the hour" },
  { value: "per_head", label: "By the head" },
];

export interface RateFormProps {
  readonly mode: "create" | "edit";
  /** The rate being changed, for the heading. */
  readonly ruleName: string | null;
  /** What the rate was when the form opened; null for a new rate. */
  readonly original: RateDraft | null;
  readonly initial: RateDraft;
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly currency: string;
  /** The venue's other live rates, to say which one a dated rate replaces. */
  readonly others: readonly DeskRule[];
  /** Opened from a suggestion: "From a suggestion for Sat 12 Jun 2027". */
  readonly fromAdvice: string | null;
  readonly saving: boolean;
  readonly error: string | null;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onCancel: () => void;
  readonly onSave: (draft: RateDraft, body: CreatePricingRuleInput) => void;
  /** Whether something is typed that closing the form would lose. */
  readonly onDirtyChange: (dirty: boolean) => void;
}

export function RateForm(props: RateFormProps): ReactElement {
  const { mode, original, initial, rooms, currency, others, saving, error, headingRef, onDirtyChange } = props;
  const [draft, setDraft] = useState<RateDraft>(initial);
  // A half-typed date reads as empty to the page; it is held here so it is
  // never taken for "every date".
  const [unfinished, setUnfinished] = useState<ReadonlySet<"validFrom" | "validTo">>(new Set());
  const ids = { title: useId(), problem: useId(), time: useId(), dates: useId(), consequence: useId() };
  const dirty = draftChanged(initial, draft);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const reading = readDraft(draft);
  const problem: { readonly field: DraftField; readonly text: string } | null = unfinished.size > 0
    ? { field: "dates", text: "Finish the date, or clear it." }
    : reading.ok ? null : { field: reading.field, text: reading.problem };
  const unchanged = mode === "edit" && original !== null && !draftChanged(original, draft);
  const consequence = reading.ok && problem === null && !unchanged
    ? consequenceWords({ mode, original, body: reading.body, currency, others })
    : [];

  const set = <K extends keyof RateDraft>(key: K, value: RateDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const readDate = (key: "validFrom" | "validTo", input: HTMLInputElement): void => {
    const bad = input.validity.badInput;
    setUnfinished((current) => {
      if (bad === current.has(key)) return current;
      const next = new Set(current);
      if (bad) next.add(key);
      else next.delete(key);
      return next;
    });
    set(key, input.value);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (saving || problem !== null || unchanged || !reading.ok) return;
    props.onSave(draft, reading.body);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== "Escape") return;
    // Escape leaves an untouched form; with something typed, Cancel does.
    event.stopPropagation();
    if (!dirty && !saving) props.onCancel();
  };

  const describedBy = (field: DraftField, ...more: string[]): string | undefined => {
    const list = [problem?.field === field ? ids.problem : "", ...more].filter((id) => id !== "");
    return list.length === 0 ? undefined : list.join(" ");
  };
  const counted = draft.type === "per_head" || draft.type === "per_hour";
  const types = draft.type === "tiered" ? [...TYPES, { value: "tiered" as const, label: "Tiered by guest numbers" }] : TYPES;
  const priceLabel = draft.type === "per_head" ? "Price a head, £" : draft.type === "per_hour" ? "Price an hour, £"
    : draft.type === "tiered" ? "Base price, £" : "Price, £";

  return (
    <form className="pdk-form" aria-labelledby={ids.title} onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <p className="enq-eyebrow">{props.fromAdvice ?? (mode === "create" ? "New rate" : "Change a rate")}</p>
      <h2 id={ids.title} ref={headingRef} tabIndex={-1} className="enq-panel__name">
        {mode === "create" ? "Add a rate" : props.ruleName ?? "Change this rate"}
      </h2>

      <div className="pdk-fields">
        <label className="pdk-field pdk-field--wide">
          <span>Name, as the price list shows it</span>
          <input type="text" value={draft.name} maxLength={200} autoComplete="off" disabled={saving}
            aria-invalid={problem?.field === "name"} aria-describedby={describedBy("name")}
            onChange={(event) => { set("name", event.target.value); }} />
        </label>

        <label className="pdk-field">
          <span>Room</span>
          <select value={draft.spaceId} disabled={saving} onChange={(event) => { set("spaceId", event.target.value); }}>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            <option value="">Every room</option>
          </select>
        </label>

        <label className="pdk-field">
          <span>Charged</span>
          <select value={draft.type} disabled={saving}
            onChange={(event) => { set("type", event.target.value as RateDraft["type"]); }}>
            {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>

        <label className="pdk-field">
          <span>{priceLabel}</span>
          <input type="text" inputMode="decimal" value={draft.amount} autoComplete="off" disabled={saving}
            aria-invalid={problem?.field === "amount"} aria-describedby={describedBy("amount")}
            onChange={(event) => { set("amount", event.target.value); }} />
        </label>

        {counted && (
          <label className="pdk-field">
            <span>{draft.type === "per_head" ? "At least, guests" : "At least, hours"}</span>
            <input type="text" inputMode="numeric" value={draft.minimum} autoComplete="off" disabled={saving}
              aria-invalid={problem?.field === "minimum"} aria-describedby={describedBy("minimum")}
              onChange={(event) => { set("minimum", event.target.value); }} />
          </label>
        )}

        <fieldset className="pdk-pair pdk-field--wide" aria-describedby={describedBy("time", ids.time)}>
          <legend>Time of day</legend>
          <label className="pdk-field">
            <span>From</span>
            <input type="text" inputMode="numeric" placeholder="19:00" value={draft.from} autoComplete="off" disabled={saving}
              aria-invalid={problem?.field === "time"} onChange={(event) => { set("from", event.target.value); }} />
          </label>
          <label className="pdk-field">
            <span>Until</span>
            <input type="text" inputMode="numeric" placeholder="00:30" value={draft.until} autoComplete="off" disabled={saving}
              aria-invalid={problem?.field === "time"} onChange={(event) => { set("until", event.target.value); }} />
          </label>
          <p className="pdk-hint" id={ids.time}>{WINDOW_COPY.hint}</p>
        </fieldset>

        <fieldset className="pdk-pair pdk-field--wide" aria-describedby={describedBy("dates", ids.dates)}>
          <legend>Dates</legend>
          <label className="pdk-field">
            <span>First date</span>
            <input type="date" value={draft.validFrom} disabled={saving} aria-invalid={problem?.field === "dates"}
              onChange={(event) => { readDate("validFrom", event.currentTarget); }}
              onBlur={(event) => { readDate("validFrom", event.currentTarget); }} />
          </label>
          <label className="pdk-field">
            <span>Last date</span>
            <input type="date" value={draft.validTo} disabled={saving} aria-invalid={problem?.field === "dates"}
              onChange={(event) => { readDate("validTo", event.currentTarget); }}
              onBlur={(event) => { readDate("validTo", event.currentTarget); }} />
          </label>
          <p className="pdk-hint" id={ids.dates}>Leave both empty for every date. A rate for particular dates takes the place of the everyday rate for the same room, time and charge on those dates.</p>
        </fieldset>

        <label className="pdk-check pdk-field--wide">
          <input type="checkbox" checked={draft.isActive} disabled={saving} onChange={(event) => { set("isActive", event.target.checked); }} />
          <span>Offer this rate in quotes and estimates</span>
        </label>
      </div>

      {problem !== null && <p className="pdk-problem" id={ids.problem}>{problem.text}</p>}
      {unchanged && <p className="pdk-problem">Nothing has changed yet.</p>}

      {consequence.length > 0 && (
        <div className="enq-confirm pdk-consequence" id={ids.consequence}>
          <p className="enq-confirm__question">When you save</p>
          {consequence.map((line) => <p key={line} className="enq-confirm__consequence">{line}</p>)}
        </div>
      )}

      {error !== null && <p className="enq-confirm__error" role="alert">{error}</p>}

      <div className="enq-actions pdk-form__actions">
        <button type="submit" className="enq-cta" aria-busy={saving} aria-describedby={consequence.length > 0 ? ids.consequence : undefined}
          disabled={saving || problem !== null || unchanged}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Saving…" : mode === "create" ? "Save rate" : "Save change"}
        </button>
        <button type="button" className="enq-quiet" disabled={saving} onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}
