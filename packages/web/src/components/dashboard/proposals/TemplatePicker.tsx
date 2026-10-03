import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import type { ProposalTemplate } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { listPricingRules, type PricingRule } from "../../../api/pricing.js";
import { listProposalTemplates, removeProposalTemplate, restoreProposalTemplate } from "../../../api/proposal-templates.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { venueCalendarDate, venueDate, venueSince } from "../enquiries/enquiry-desk-format.js";
import type { ComposerDraft } from "./proposals-desk-format.js";
import {
  hasWords,
  templateContents,
  templateGroups,
  templateScope,
  wordsInComposer,
  type ApplyMode,
  type TemplateEvent,
} from "./template-format.js";

// ---------------------------------------------------------------------------
// Start from a template (roadmap X1; Tier B #16), under the composer's start
// line. Each opening reads the venue's templates and the event afresh; Use
// reads the price list afresh, and the composer puts the template in against
// the words it holds when the prices arrive, so nothing typed meanwhile is
// lost. Templates for this event's room and occasion come first. With words
// already in the composer, it asks whether to replace them (kept to copy) or
// add the template's lines. Escape closes the choice, then the list, alone.
// Focus always has somewhere to go: to the question, back to the template's
// Use, to Undo, to what was said, or to Try again; never away from where the
// booker has gone meanwhile.
// ---------------------------------------------------------------------------

/** The templates, kept on screen while they are read again. */
interface TemplatesRead {
  readonly status: "loading" | "error" | "ready";
  readonly templates: readonly ProposalTemplate[] | null;
}

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "choosing"; readonly template: ProposalTemplate }
  | { readonly kind: "pricing" | "unpriced"; readonly template: ProposalTemplate; readonly mode: ApplyMode; readonly fromChoice: boolean };

/** Where focus goes once the list has drawn what just happened. */
type FocusTo = { readonly kind: "use"; readonly id: string } | { readonly kind: "choice" | "undo" | "said" | "retry" };

interface TemplatePickerProps {
  readonly venueId: string;
  /** The event, once read; null until then, and while it is read again. */
  readonly event: TemplateEvent | null;
  readonly eventStatus: "idle" | "loading" | "error" | "ready";
  /** Reads the event again. */
  readonly onNeedEvent: () => void;
  readonly draft: ComposerDraft;
  readonly disabled: boolean;
  readonly nowMs: number;
  /** Puts the template into the composer, priced with this price list;
   *  `from` is where focus was when Use was pressed. */
  readonly onUse: (template: ProposalTemplate, rules: readonly PricingRule[], mode: ApplyMode, from: Element | null) => void;
  /** Whether a template is being priced, removed or brought back, so the
   *  composer holds what would replace it meanwhile. */
  readonly onBusy: (busy: boolean) => void;
}

/** An answer that never came, or a failure on the venue's side: what was
 *  asked may have happened. */
function unconfirmed(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status < 400 || error.status >= 500;
}

/** Focus may be moved only from where the action began, from nowhere, from
 *  within `scope`, or from a place focus was put rather than gone to (a
 *  heading or a line said, focusable only by the page): never away from a
 *  field or control the booker has gone to meanwhile. */
export function focusIsFree(from: Element | null, scope: Element | null = null): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body || active === from || (scope !== null && scope.contains(active))) return true;
  return active.getAttribute("tabindex") === "-1" && !(active instanceof HTMLElement && active.isContentEditable);
}

/** When a template was last saved: a time today, a day this year, and a
 *  date with its year before, so an old template never reads as recent. */
function savedWhen(iso: string, nowMs: number): string | null {
  const year = venueCalendarDate(iso)?.slice(0, 4);
  return year !== undefined && year === venueCalendarDate(new Date(nowMs).toISOString())?.slice(0, 4)
    ? venueSince(iso, nowMs) : venueDate(iso);
}

export function TemplatePicker(props: TemplatePickerProps): ReactElement {
  const { venueId, event, eventStatus, onNeedEvent, draft, disabled, nowMs, onUse, onBusy } = props;
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<TemplatesRead>({ status: "loading", templates: null });
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [said, setSaid] = useState("");
  const [removed, setRemoved] = useState<ProposalTemplate | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [focusTo, setFocusTo] = useState<FocusTo | null>(null);
  const panelId = useId();
  const titleId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const useButtons = useRef(new Map<string, HTMLButtonElement>());
  const choiceRef = useRef<HTMLParagraphElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const saidRef = useRef<HTMLParagraphElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  // Where focus was when the booker last acted here.
  const actedFrom = useRef<Element | null>(null);
  const mark = (): void => { actedFrom.current = document.activeElement; };
  // Each read and each use is numbered, so an answer overtaken by another,
  // or arriving after the list or the composer has gone, is dropped.
  const readNumber = useRef(0);
  const useNumber = useRef(0);
  useEffect(() => () => { readNumber.current += 1; useNumber.current += 1; }, []);
  // An answer is put in with the composer as it is then, never as it was
  // when Use was pressed: a save begun meanwhile holds the template out.
  const latest = useRef({ onUse, disabled });
  useEffect(() => { latest.current = { onUse, disabled }; });

  const busy = disabled || step.kind === "pricing" || working !== null;
  useEffect(() => { onBusy(step.kind === "pricing" || working !== null); }, [onBusy, step.kind, working]);
  useEffect(() => () => { onBusy(false); }, [onBusy]);

  useEffect(() => {
    if (focusTo === null) return;
    const target = focusTo.kind === "use" ? useButtons.current.get(focusTo.id)
      : focusTo.kind === "choice" ? choiceRef.current
        : focusTo.kind === "undo" ? undoRef.current
          : focusTo.kind === "retry" ? retryRef.current : saidRef.current;
    if (target === undefined || target === null) return;
    setFocusTo(null);
    if (focusIsFree(actedFrom.current, panelRef.current)) target.focus();
  }, [focusTo, read, step, removed]);

  /** Reads the templates; true once they are read. */
  const load = useCallback((): Promise<boolean> => {
    readNumber.current += 1;
    const mine = readNumber.current;
    setRead((current) => ({ status: "loading", templates: current.templates }));
    return listProposalTemplates(venueId)
      .then((templates) => {
        if (readNumber.current === mine) setRead({ status: "ready", templates });
        return true;
      })
      .catch(() => {
        if (readNumber.current === mine) setRead((current) => ({ status: "error", templates: current.templates }));
        return false;
      });
  }, [venueId]);
  /** What the venue is known to have done, kept in the list whether or not it is read again. */
  const keep = (change: (templates: readonly ProposalTemplate[]) => readonly ProposalTemplate[]): void => {
    setRead((current) => ({ ...current, templates: current.templates === null ? null : change(current.templates) }));
  };

  // A removal or a restore on its way is answered before the list closes.
  const close = (): void => {
    if (working !== null) return;
    useNumber.current += 1;
    setStep({ kind: "idle" });
    setFocusTo(null);
    setOpen(false);
    toggleRef.current?.focus();
  };
  const toggle = (): void => {
    // Closing drops a template being priced, as Done and Escape do.
    if (open) {
      close();
      return;
    }
    setOpen(true);
    setSaid("");
    setStep({ kind: "idle" });
    setRemoved(null);
    setFocusTo(null);
    setRead({ status: "loading", templates: null });
    void load();
    // The event is read afresh each time, so a template takes its guests and date as they now are.
    if (eventStatus !== "loading") onNeedEvent();
  };
  const cancelChoice = (template: ProposalTemplate): void => {
    mark();
    setStep({ kind: "idle" });
    setFocusTo({ kind: "use", id: template.id });
  };
  const onKeyDown = (keyboard: KeyboardEvent<HTMLElement>): void => {
    if (keyboard.key !== "Escape") return;
    keyboard.preventDefault();
    keyboard.stopPropagation();
    if (step.kind === "choosing") {
      cancelChoice(step.template);
      return;
    }
    close();
  };
  /** Try again moves focus to the list's title first, as the block that holds it goes. */
  const retry = (again: () => void): void => {
    titleRef.current?.focus();
    again();
  };

  const price = (template: ProposalTemplate, mode: ApplyMode, fromChoice: boolean): void => {
    if (event === null) return;
    mark();
    const from = actedFrom.current;
    useNumber.current += 1;
    const mine = useNumber.current;
    setStep({ kind: "pricing", template, mode, fromChoice });
    setSaid("");
    listPricingRules(venueId)
      .then((rules) => {
        if (useNumber.current !== mine) return;
        setStep({ kind: "idle" });
        if (latest.current.disabled) {
          setSaid(`${template.name} was not used, as the proposal changed while it was priced. Use it again to put it in.`);
          setFocusTo({ kind: "said" });
          return;
        }
        setOpen(false);
        latest.current.onUse(template, rules, mode, from);
      })
      .catch(() => {
        if (useNumber.current !== mine) return;
        setStep({ kind: "unpriced", template, mode, fromChoice });
        setFocusTo({ kind: "retry" });
      });
  };
  const use = (template: ProposalTemplate): void => {
    if (busy) return;
    if (hasWords(draft)) {
      mark();
      setStep({ kind: "choosing", template });
      setFocusTo({ kind: "choice" });
      return;
    }
    price(template, "replace", false);
  };

  const remove = (template: ProposalTemplate): void => {
    if (busy) return;
    mark();
    setWorking(template.id);
    setSaid("");
    setRemoved(null);
    void (async () => {
      let outcome: "removed" | "gone" | "refused" | "unconfirmed";
      try {
        await removeProposalTemplate(venueId, template.id);
        outcome = "removed";
      } catch (error) {
        outcome = unconfirmed(error) ? "unconfirmed" : error instanceof ApiError && error.status === 404 ? "gone" : "refused";
      }
      // Known to be gone, it leaves the list at once, read again or not.
      if (outcome === "removed" || outcome === "gone") keep((templates) => templates.filter((one) => one.id !== template.id));
      const reread = await load();
      setWorking(null);
      if (outcome === "removed") {
        setRemoved(template);
        setSaid(`Removed ${template.name} for everyone at the venue.`);
        setFocusTo({ kind: "undo" });
        return;
      }
      setSaid(outcome === "gone" ? `${template.name} was already removed.`
        : outcome === "refused" ? `${template.name} could not be removed. Try again.`
          : `Removing ${template.name} could not be confirmed. ${reread ? "The list shows the templates as the venue now has them." : "The list is as it was last read."}`);
      setFocusTo({ kind: "said" });
    })();
  };
  const undo = (template: ProposalTemplate): void => {
    if (working !== null) return;
    mark();
    setWorking(template.id);
    void (async () => {
      let outcome: "back" | "taken" | "refused" | "unconfirmed";
      try {
        const back = await restoreProposalTemplate(venueId, template.id);
        keep((templates) => templates.some((one) => one.id === back.id) ? templates : [...templates, back]);
        outcome = "back";
      } catch (error) {
        outcome = error instanceof ApiError && error.code === "NAME_TAKEN" ? "taken" : unconfirmed(error) ? "unconfirmed" : "refused";
      }
      const reread = await load();
      setRemoved(null);
      setWorking(null);
      setSaid(outcome === "back" ? `${template.name} is back.`
        : outcome === "taken" ? `Another template is now called ${template.name}, so this one cannot come back.`
          : outcome === "refused" ? `${template.name} could not be brought back.`
            : `Bringing ${template.name} back could not be confirmed. ${reread ? "The list shows the templates as the venue now has them." : "The list is as it was last read."}`);
      setFocusTo({ kind: "said" });
    })();
  };

  const templates = read.templates;
  return (
    <>
      <div className="enq-actions">
        <button type="button" className="enq-quiet" ref={toggleRef} data-testid="template-toggle" aria-expanded={open}
          aria-controls={open ? panelId : undefined} disabled={disabled} onClick={toggle} onKeyDown={open ? onKeyDown : undefined}>
          Start from a template
        </button>
      </div>
      {open && (
        <div className="pr-prices pr-templates" id={panelId} ref={panelRef} role="region" aria-labelledby={titleId} data-testid="templates"
          onKeyDown={onKeyDown}>
          <p className="pr-prices__title" id={titleId} ref={titleRef} tabIndex={-1}>Templates</p>
          {read.status === "loading" && <ActivityStatus>Reading the templates…</ActivityStatus>}
          {read.status === "error" && (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="templates-error">The templates could not be read.</p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" data-testid="templates-retry" onClick={() => { retry(() => { void load(); }); }}>
                  Try again
                </button>
              </div>
            </>
          )}
          {eventStatus === "loading" && <ActivityStatus>Reading the event…</ActivityStatus>}
          {eventStatus === "error" && (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="templates-event-error">
                The event's details could not be read, so a template cannot be priced for it yet.
              </p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" data-testid="templates-event-retry" onClick={() => { retry(onNeedEvent); }}>Try again</button>
              </div>
            </>
          )}
          {read.status === "ready" && templates !== null && templates.length === 0 && (
            <p className="enq-next__hint" data-testid="templates-empty">
              No templates yet. Save as template, beside Save version, keeps one from the proposal you are writing.
            </p>
          )}
          {templates !== null && templates.length > 0 && (
            <TemplateList templates={templates} event={event} step={step} busy={busy} working={working} nowMs={nowMs}
              choiceWords={wordsInComposer(draft)} useButtons={useButtons.current} choiceRef={choiceRef}
              onUse={use} onRemove={remove}
              onChoose={(template, mode) => { if (!busy) price(template, mode, true); }}
              onCancel={cancelChoice} />
          )}
          {step.kind === "pricing" && <ActivityStatus>Pricing {step.template.name}…</ActivityStatus>}
          {step.kind === "unpriced" && (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="templates-price-error">
                The price list could not be read, so {step.template.name} was not used.
              </p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" ref={retryRef} data-testid="templates-price-retry" aria-disabled={busy}
                  onClick={() => { if (!busy) price(step.template, step.mode, step.fromChoice); }}>
                  Try again
                </button>
              </div>
            </>
          )}
          <p className="enq-next__hint" role="status" ref={saidRef} tabIndex={-1} data-testid="templates-said">{said}</p>
          {removed !== null && (
            <div className="enq-actions">
              <button type="button" className="enq-quiet" ref={undoRef} data-testid="template-undo" aria-disabled={working !== null}
                aria-busy={working === removed.id} onClick={() => { undo(removed); }}>
                {working === removed.id && <ActivityIndicator size={18} />}
                Undo
              </button>
            </div>
          )}
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="templates-done" aria-disabled={working !== null} onClick={close}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}

function TemplateList({ templates, event, step, busy, working, nowMs, choiceWords, useButtons, choiceRef, onUse, onRemove, onChoose, onCancel }: {
  readonly templates: readonly ProposalTemplate[];
  readonly choiceWords: string;
  readonly event: TemplateEvent | null;
  readonly step: Step;
  readonly busy: boolean;
  readonly working: string | null;
  readonly nowMs: number;
  readonly useButtons: Map<string, HTMLButtonElement>;
  readonly choiceRef: RefObject<HTMLParagraphElement>;
  readonly onUse: (template: ProposalTemplate) => void;
  readonly onRemove: (template: ProposalTemplate) => void;
  readonly onChoose: (template: ProposalTemplate, mode: ApplyMode) => void;
  readonly onCancel: (template: ProposalTemplate) => void;
}): ReactElement {
  const groups = templateGroups(templates, event);
  // The question stays on screen while its answer is priced, so focus stays.
  const choosing = (template: ProposalTemplate): boolean => (step.kind === "choosing" || (step.kind === "pricing" && step.fromChoice))
    && step.template.id === template.id;
  return (
    <>
      {groups.map((group) => (
        <TemplateGroup key={group.key} heading={group.heading}>
          {group.rows.map(({ template, reason }) => (
            <TemplateRow key={template.id} template={template} reason={reason} canUse={event !== null && template.readable} choiceWords={choiceWords}
              busy={busy} removing={working === template.id} nowMs={nowMs} choosing={choosing(template)} useButtons={useButtons}
              choiceRef={choiceRef} onUse={onUse} onRemove={onRemove} onChoose={onChoose} onCancel={onCancel} />
          ))}
        </TemplateGroup>
      ))}
    </>
  );
}

function TemplateGroup({ heading, children }: { readonly heading: string; readonly children: ReactNode }): ReactElement {
  const headingId = useId();
  return (
    <div className="pr-prices__group" role="group" aria-labelledby={headingId}>
      <p className="pr-prices__heading" id={headingId}>{heading}</p>
      <ul className="pr-prices__list">{children}</ul>
    </div>
  );
}

function TemplateRow({ template, reason, canUse, choiceWords, busy, removing, choosing, nowMs, useButtons, choiceRef, onUse, onRemove, onChoose, onCancel }: {
  readonly template: ProposalTemplate;
  readonly choiceWords: string;
  readonly reason: string | null;
  readonly canUse: boolean;
  readonly busy: boolean;
  readonly removing: boolean;
  readonly choosing: boolean;
  readonly nowMs: number;
  readonly useButtons: Map<string, HTMLButtonElement>;
  readonly choiceRef: RefObject<HTMLParagraphElement>;
  readonly onUse: (template: ProposalTemplate) => void;
  readonly onRemove: (template: ProposalTemplate) => void;
  readonly onChoose: (template: ProposalTemplate, mode: ApplyMode) => void;
  readonly onCancel: (template: ProposalTemplate) => void;
}): ReactElement {
  const choiceId = useId();
  const saved = savedWhen(template.updatedAt, nowMs);
  return (
    <li className="pr-template" data-testid={`template-${template.id}`}>
      <p className="pr-template__name">{template.name}</p>
      <p className="pr-template__about">
        {templateScope(template)}
        {reason !== null && <> · {reason}</>}
      </p>
      <p className="pr-template__about">
        {templateContents(template)}
        {template.updatedByName !== null && saved !== null ? ` · Saved by ${template.updatedByName}, ${saved}` : ""}
      </p>
      {choosing ? (
        <div className="pr-template__choice" role="group" aria-labelledby={choiceId} data-testid="template-choice">
          {/* Focus comes here when the question is asked, so it is heard and Escape answers it. */}
          <p className="enq-next__hint" id={choiceId} ref={choiceRef} tabIndex={-1} data-testid="template-question">
            {choiceWords} Replace keeps what is there now to copy. The capacity note stays.
          </p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="template-replace" aria-disabled={busy} onClick={() => { onChoose(template, "replace"); }}>
              Replace them
            </button>
            {template.lines.length > 0 && (
              <button type="button" className="enq-quiet" data-testid="template-add" aria-disabled={busy} onClick={() => { onChoose(template, "add"); }}>
                Add its lines
              </button>
            )}
            <button type="button" className="enq-quiet" data-testid="template-cancel" aria-disabled={busy}
              onClick={() => { if (!busy) onCancel(template); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="enq-actions">
          {canUse && (
            <button type="button" className="enq-quiet" data-testid={`template-use-${template.id}`} aria-label={`Use ${template.name}`}
              ref={(element) => { if (element === null) useButtons.delete(template.id); else useButtons.set(template.id, element); }}
              aria-disabled={busy} onClick={() => { onUse(template); }}>
              Use
            </button>
          )}
          <button type="button" className="enq-quiet" data-testid={`template-remove-${template.id}`} aria-label={`Remove ${template.name}`}
            aria-disabled={busy} aria-busy={removing} onClick={() => { onRemove(template); }}>
            {removing && <ActivityIndicator size={18} />}
            Remove
          </button>
        </div>
      )}
    </li>
  );
}
