import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import {
  ENQUIRY_OCCASION_KEYS,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TEMPLATE_OCCASION_LENGTH,
  ProposalTemplateSchema,
  findUnsupportedProposalClaim,
  occasionLabel,
  type CreateProposalTemplateInput,
  type ProposalTemplate,
} from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { listPricingRules, type PricingRule } from "../../../api/pricing.js";
import { createProposalTemplate, replaceProposalTemplate } from "../../../api/proposal-templates.js";
import type { Space } from "../../../api/spaces.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { venueSince } from "../enquiries/enquiry-desk-format.js";
import type { ComposerDraft } from "./proposals-desk-format.js";
import { focusIsFree } from "./TemplatePicker.js";
import { hasKeepableWords, occasionKeyOf, suggestedTemplateName, templateFromDraft, type TemplateEvent } from "./template-format.js";

// ---------------------------------------------------------------------------
// Save as template (roadmap X1; Tier B #16), beside Start again. The form
// offers a name, the event's room and occasion, and says what the template
// keeps: the message, each price-list line as the entry (priced each time it
// is used), each typed line with its price asked for each time, never the
// capacity note. What it keeps is worked out against the event as it now is,
// read afresh each time the form opens, so a price is never said to differ
// from the list's when the list gave it. A name already used offers to
// replace that template; a template a colleague changed meanwhile is never
// overwritten unseen. A save on its way is not dropped while the booker
// stays: the form waits for its answer, the composer holds what would
// replace it meanwhile, and what came of it is said. If the composer closes
// under it (the proposal is sent from elsewhere, or the booker leaves), the
// answer is not said, as with every answer on the desk; Start from a
// template shows whether it was kept.
// ---------------------------------------------------------------------------

type RulesRead =
  | { readonly status: "loading" | "error" }
  | { readonly status: "ready"; readonly rules: readonly PricingRule[] };

/** A question the answer to a save asks: replace the template named so, or
 *  the one a colleague changed meanwhile. */
type Question =
  | { readonly kind: "taken"; readonly existing: ProposalTemplate }
  | { readonly kind: "changed"; readonly current: ProposalTemplate };

type Phase =
  | { readonly kind: "editing" }
  /** The question that led to this save stays on screen while it is on its way. */
  | { readonly kind: "saving"; readonly asking: Question | null }
  | Question
  | { readonly kind: "refused"; readonly words: string };

/** A field the booker has typed in or chosen from. */
type Field = "name" | "room" | "occasion";
const NOTHING_TOUCHED: ReadonlySet<Field> = new Set();

interface TemplateSaveProps {
  readonly venueId: string;
  /** The event, once read; null until then, and while it is read again. */
  readonly event: TemplateEvent | null;
  readonly eventStatus: "idle" | "loading" | "error" | "ready";
  /** Reads the event again. */
  readonly onNeedEvent: () => void;
  readonly rooms: readonly Space[];
  readonly draft: ComposerDraft;
  readonly disabled: boolean;
  readonly nowMs: number;
  /** Whether a save is on its way, so the composer holds what would replace it meanwhile. */
  readonly onSaving: (saving: boolean) => void;
}

/** The occasion as a template keeps it: a key, or the event's own wording,
 *  lower-cased; none when it would not fit. */
function occasionKey(occasion: string | null): string {
  const key = occasionKeyOf(occasion) ?? "";
  return key.length <= MAX_TEMPLATE_OCCASION_LENGTH ? key : "";
}

function templateOf(details: unknown): ProposalTemplate | null {
  const parsed = ProposalTemplateSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

/** "at 10:14" today, "on Tue 22 Sep, 10:14" before. */
function changedWhen(updatedAt: string, nowMs: number): string {
  const since = venueSince(updatedAt, nowMs);
  if (since === null) return "";
  return /^\d{2}:\d{2}$/u.test(since) ? ` at ${since}` : ` on ${since}`;
}

export function TemplateSave({ venueId, event, eventStatus, onNeedEvent, rooms, draft, disabled, nowMs, onSaving }: TemplateSaveProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<RulesRead>({ status: "loading" });
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [occasion, setOccasion] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [said, setSaid] = useState("");
  // The name, room and occasion are each offered from the event whenever it
  // is read, never over what the booker has typed or chosen in that field
  // since the form opened.
  const [touched, setTouched] = useState<ReadonlySet<Field>>(NOTHING_TOUCHED);
  // An answer draws a new question or a refusal; focus follows it there when
  // the button pressed has gone.
  const [answeredCount, setAnsweredCount] = useState(0);
  // Whether the button keeps its place after the form closes, while it has focus.
  const [lingering, setLingering] = useState(false);
  const formId = useId();
  const titleId = useId();
  const keptId = useId();
  const refusalId = useId();
  const questionId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const readNumber = useRef(0);
  const saveNumber = useRef(0);
  useEffect(() => () => { readNumber.current += 1; saveNumber.current += 1; }, []);
  useEffect(() => {
    if (!open || event === null) return;
    if (!touched.has("name")) setName(suggestedTemplateName(event.roomName, event.occasion));
    if (!touched.has("room")) setSpaceId(event.spaceId ?? "");
    if (!touched.has("occasion")) setOccasion(occasionKey(event.occasion));
  }, [open, touched, event]);

  const saving = phase.kind === "saving";
  useEffect(() => { onSaving(saving); }, [onSaving, saving]);
  useEffect(() => () => { onSaving(false); }, [onSaving]);
  useEffect(() => {
    if (answeredCount === 0) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (replaceRef.current ?? submitRef.current)?.focus();
  }, [answeredCount]);

  const load = useCallback(() => {
    readNumber.current += 1;
    const mine = readNumber.current;
    setRules({ status: "loading" });
    listPricingRules(venueId)
      .then((read) => { if (readNumber.current === mine) setRules({ status: "ready", rules: read }); })
      .catch(() => { if (readNumber.current === mine) setRules({ status: "error" }); });
  }, [venueId]);

  /** Closes the form; focus goes back to its button unless the booker has
   *  gone elsewhere while a save was on its way. */
  const close = (words: string, from: Element | null = null): void => {
    saveNumber.current += 1;
    // Inside the form is found by the form's id: a form element may be
    // wrapped, so the one a ref holds need not be the one focus is in.
    const free = document.activeElement?.closest("form")?.id === formId || focusIsFree(from);
    setOpen(false);
    setSaid(words);
    if (free) toggleRef.current?.focus();
    // The button that takes focus back stays while it has it, even with
    // nothing left to keep, so focus never falls to the page.
    setLingering(free || document.activeElement === toggleRef.current);
  };
  const keepable = hasKeepableWords(draft);
  const toggle = (): void => {
    if (open) {
      // A save on its way is answered before the form closes.
      if (!saving) close("");
      return;
    }
    // Held, it stays where focus can rest, and opens once the work it waits
    // for is done; with nothing to keep, it does not open.
    if (disabled || !keepable) return;
    setOpen(true);
    setSaid("");
    setPhase({ kind: "editing" });
    setName("");
    setSpaceId("");
    setOccasion("");
    setTouched(NOTHING_TOUCHED);
    load();
    // The event is read afresh each time, so what is kept is checked against it as it now is.
    if (eventStatus !== "loading") onNeedEvent();
  };
  const onKeyDown = (keyboard: KeyboardEvent<HTMLElement>): void => {
    if (keyboard.key !== "Escape") return;
    keyboard.preventDefault();
    keyboard.stopPropagation();
    if (!saving) close("");
  };
  /** Try again moves focus to the form's title first, as the block that holds it goes. */
  const retry = (again: () => void): void => {
    titleRef.current?.focus();
    again();
  };

  // The event's room is offered even when the venue's rooms could not be
  // read, so what the field shows is what is kept.
  const roomChoices = spaceId === "" || rooms.some((room) => room.id === spaceId)
    ? rooms
    : [...rooms, { id: spaceId, name: event?.spaceId === spaceId && event.roomName !== null ? event.roomName : "The event's room" }];
  const roomName = (id: string): string | null => roomChoices.find((room) => room.id === id)?.name ?? null;
  // What is kept, and any price said to differ, waits for the event: priced
  // without it, the list's own price for this event could read as the booker's.
  const kept = rules.status === "ready" && event !== null
    ? templateFromDraft(draft, rules.rules, event, spaceId === "" ? null : spaceId, roomName) : null;
  const claim = findUnsupportedProposalClaim(draft.message);
  // AI wording not yet read through is never kept for the venue to reuse.
  const refusal = kept?.refusal
    ?? (draft.aiUnread === true ? "The message holds AI wording not yet read through. Press I have read it under the message first." : null)
    ?? (claim === null ? null : `The message says "${claim}", a certainty the venue cannot show a client. Reword it first.`)
    ?? (name.trim() === "" ? "Give the template a name." : null);
  const typedOccasion = occasion !== "" && !ENQUIRY_OCCASION_KEYS.includes(occasion);

  const body = (): CreateProposalTemplateInput | null => kept === null ? null : {
    name: name.trim(),
    spaceId: spaceId === "" ? null : spaceId,
    occasion: occasion === "" ? null : occasion,
    message: draft.message,
    lines: [...kept.lines],
  };

  const answered = (error: unknown, replacing: boolean): void => {
    // Only a refusal (4xx) says the template was not kept; no answer, or a
    // broken one, may follow a save that was made.
    if (!(error instanceof ApiError) || error.status < 400 || error.status >= 500) {
      setPhase({ kind: "refused", words: "The save could not be confirmed. Start from a template shows whether it was kept." });
      return;
    }
    const template = templateOf(error.details);
    if (error.code === "NAME_TAKEN" && template !== null) {
      setPhase({ kind: "taken", existing: template });
      return;
    }
    if (error.code === "TEMPLATE_CHANGED" && template !== null) {
      setPhase({ kind: "changed", current: template });
      return;
    }
    if (error.code === "PRICE_ENTRY_NOT_AT_VENUE" || error.code === "PRICE_ENTRY_CHANGED" || error.code === "ROOM_PRICE_NEEDS_ROOM") {
      load();
      setPhase({ kind: "refused", words: "The price list changed while you saved. Check what is kept and save again." });
      return;
    }
    if (error.code === "ROOM_NOT_AT_VENUE") {
      setPhase({ kind: "refused", words: "That room is no longer listed. Choose another room." });
      return;
    }
    if (replacing && error.status === 404) {
      setPhase({ kind: "refused", words: `${name.trim()} was removed meanwhile. Save again to keep yours.` });
      return;
    }
    setPhase({ kind: "refused", words: "The template could not be saved as it stands." });
  };

  const question: Question | null = phase.kind === "taken" || phase.kind === "changed" ? phase
    : phase.kind === "saving" ? phase.asking : null;
  const save = (overwrite: ProposalTemplate | null): void => {
    const sent = body();
    // Nothing is saved while the composer could be replaced before the answer comes.
    if (sent === null || refusal !== null || saving || disabled) return;
    const from = document.activeElement;
    saveNumber.current += 1;
    const mine = saveNumber.current;
    setPhase({ kind: "saving", asking: overwrite === null ? null : question });
    const request = overwrite === null
      ? createProposalTemplate(venueId, sent)
      : replaceProposalTemplate(venueId, overwrite.id, { ...sent, expectedUpdatedAt: overwrite.updatedAt });
    request
      .then((template) => {
        if (saveNumber.current !== mine) return;
        setPhase({ kind: "editing" });
        close(overwrite === null ? `Saved the template ${template.name}.` : `Replaced the template ${template.name}.`, from);
      })
      .catch((error: unknown) => {
        if (saveNumber.current !== mine) return;
        answered(error, overwrite !== null);
        setAnsweredCount((count) => count + 1);
      });
  };
  const submit = (form: FormEvent): void => {
    form.preventDefault();
    save(null);
  };
  const touch = (field: Field): void => {
    setTouched((current) => current.has(field) ? current : new Set([...current, field]));
    if (!saving) setPhase({ kind: "editing" });
  };

  const theirs = question === null ? null : question.kind === "taken" ? question.existing : question.current;
  return (
    <>
      {(keepable || open || lingering) && (
        <button type="button" className="enq-quiet" ref={toggleRef} data-testid="template-save-toggle" aria-expanded={open}
          aria-controls={open ? formId : undefined} aria-disabled={(disabled || !keepable) && !open} onClick={toggle}
          onKeyDown={open ? onKeyDown : undefined}
          // A blur while it is still the focused element is the window or tab
          // losing focus; the button stays, so focus is on it on return.
          onBlur={(event) => { if (document.activeElement !== event.currentTarget) setLingering(false); }}>
          Save as template
        </button>
      )}
      {/* Mounted before anything is said, so what is said is heard. */}
      <p className="enq-next__hint pr-template-save-said" role="status" data-testid="template-save-said">{open ? "" : said}</p>
      {open && (
        <form className="pr-prices" id={formId} aria-labelledby={titleId} aria-busy={saving} data-testid="template-save" onSubmit={submit}
          onKeyDown={onKeyDown}>
          <p className="pr-prices__title" id={titleId} ref={titleRef} tabIndex={-1}>Save as a template</p>
          <label className="pr-field">
            <span>Name</span>
            <input ref={nameRef} data-testid="template-name" maxLength={MAX_TEMPLATE_NAME_LENGTH} value={name} readOnly={saving}
              onChange={(change) => { setName(change.target.value); touch("name"); }} />
          </label>
          <label className="pr-field">
            <span>Room</span>
            <select data-testid="template-room" value={spaceId} disabled={saving} onChange={(change) => { setSpaceId(change.target.value); touch("room"); }}>
              <option value="">Any room</option>
              {roomChoices.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select>
          </label>
          <label className="pr-field">
            <span>Occasion</span>
            <select data-testid="template-occasion" value={occasion} disabled={saving} onChange={(change) => { setOccasion(change.target.value); touch("occasion"); }}>
              <option value="">Any occasion</option>
              {ENQUIRY_OCCASION_KEYS.map((key) => <option key={key} value={key}>{occasionLabel(key)}</option>)}
              {typedOccasion && <option value={occasion}>{occasionLabel(occasion)}</option>}
            </select>
          </label>
          {eventStatus === "loading" && <ActivityStatus>Reading the event…</ActivityStatus>}
          {eventStatus === "error" && (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="template-save-event-error">
                The event's details could not be read, so what the template keeps cannot be checked against its prices yet.
              </p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" onClick={() => { retry(onNeedEvent); }}>Try again</button>
              </div>
            </>
          )}
          {rules.status === "loading" && <ActivityStatus>Reading the price list…</ActivityStatus>}
          {rules.status === "error" && (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="template-save-rules-error">
                The price list could not be read, so what the template keeps cannot be checked yet.
              </p>
              <div className="enq-actions"><button type="button" className="enq-quiet" onClick={() => { retry(load); }}>Try again</button></div>
            </>
          )}
          {kept !== null && (
            <div id={keptId} className="pr-prices__left" data-testid="template-kept">
              {kept.said.map((sentence, index) => <p key={`${String(index)}:${sentence}`} className="enq-next__hint">{sentence}</p>)}
            </div>
          )}
          {refusal !== null && kept !== null && <p className="enq-next__hint" id={refusalId} data-testid="template-save-refusal">{refusal}</p>}
          {phase.kind === "refused" && <p className="enq-confirm__error" role="alert" data-testid="template-save-error">{phase.words}</p>}
          {question !== null && theirs !== null && (
            // One group for either question, kept while its Replace is on its
            // way, so the button pressed keeps focus through the answer.
            <div role="group" aria-labelledby={questionId} aria-busy={saving}
              data-testid={question.kind === "taken" ? "template-name-taken" : "template-changed"}>
              <p className="enq-confirm__error" role="alert" id={questionId}>
                {question.kind === "taken"
                  ? `A template is already called ${theirs.name}.`
                  : `${theirs.updatedByName ?? "Someone"} changed ${theirs.name}${changedWhen(theirs.updatedAt, nowMs)}.`}
              </p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" ref={replaceRef} aria-disabled={saving || disabled} aria-busy={saving}
                  data-testid={question.kind === "taken" ? "template-replace-existing" : "template-replace-changed"}
                  onClick={() => { save(theirs); }}>
                  {saving && <ActivityIndicator size={18} />}
                  Replace it
                </button>
                {question.kind === "taken" ? (
                  <button type="button" className="enq-quiet" aria-disabled={saving}
                    onClick={() => { if (!saving) { setPhase({ kind: "editing" }); nameRef.current?.focus(); } }}>
                    Choose another name
                  </button>
                ) : (
                  <button type="button" className="enq-quiet" data-testid="template-keep-theirs" aria-disabled={saving}
                    onClick={() => { if (!saving) close(`Kept ${theirs.updatedByName === null ? "the saved" : `${theirs.updatedByName}'s`} ${theirs.name}.`); }}>
                    Keep theirs
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="enq-actions">
            <button type="submit" className="enq-quiet" ref={submitRef} data-testid="template-save-submit"
              aria-disabled={saving || disabled || refusal !== null || kept === null} aria-busy={saving && question === null}
              aria-describedby={refusal !== null && kept !== null ? refusalId : kept !== null ? keptId : undefined}>
              {saving && question === null && <ActivityIndicator size={18} />}
              {saving && question === null ? "Saving…" : "Save template"}
            </button>
            <button type="button" className="enq-quiet" aria-disabled={saving} onClick={() => { if (!saving) close(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </>
  );
}
