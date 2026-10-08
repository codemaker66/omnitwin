import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Check, CircleAlert, Quote, Sparkles } from "lucide-react";
import {
  EVENT_BRIEF_DESCRIPTION_MAX_LENGTH,
  type EventArchitectAccessibilityRequirement,
  type EventBriefDraft,
  type EventBriefDraftField,
  type EventBriefUnsupported,
  type EventBriefUnsupportedKind,
} from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { readEventBrief } from "../../api/event-architect.js";
import {
  markEventBriefReaderUnavailable,
  useEventBriefReaderAvailable,
} from "../../hooks/use-event-brief-reader-available.js";
import { ActivityIndicator } from "../shared/Activity.js";
import "./EventBriefReader.css";

// ---------------------------------------------------------------------------
// "Describe the event" (T-650): the planner writes the event in their own
// words, the server's AI reads it into a draft of the brief, and the planner
// checks every value before an explicit action fills the request form. Values
// the AI inferred are marked "Assumed"; what the Event Architect cannot
// represent is listed in the planner's own words and stays in view after the
// form is filled. Nothing runs until the planner generates the options.
// Offered only where the server reads briefs; its "AI is off" hides it.
// ---------------------------------------------------------------------------

type LayoutChoice = "dinner-rounds" | "theatre";
type ServiceChoice = "none" | "plated" | "buffet" | "reception";

/** What filling the request form sets: the form's own field values. */
export interface BriefFormValues {
  readonly eventName: string;
  readonly eventType: string;
  readonly guestCount: string;
  readonly layoutStyle: LayoutChoice;
  readonly budgetPounds: string;
  readonly preferredDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly serviceModel: ServiceChoice;
  readonly stepFreeRoute: boolean;
  readonly wheelchairSpaces: boolean;
  readonly hearingLoop: boolean;
  readonly planningPrompt: string;
}

/** The preview's values: a layout or service may be unset. */
interface PreviewValues extends Omit<BriefFormValues, "layoutStyle" | "serviceModel"> {
  readonly layoutStyle: LayoutChoice | "";
  readonly serviceModel: ServiceChoice | "";
}

type PreviewKey = keyof PreviewValues;
type AccessibilityKey = "stepFreeRoute" | "wheelchairSpaces" | "hearingLoop";

interface ReadFor {
  readonly spaceId: string;
  readonly roomName: string | null;
}

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "ready"; readonly draft: EventBriefDraft; readonly readFor: ReadFor }
  | { readonly kind: "filled"; readonly draft: EventBriefDraft; readonly readFor: ReadFor }
  | { readonly kind: "failed" }
  | { readonly kind: "refused" }
  | { readonly kind: "gone" };

const FIELD_LABELS: Readonly<Record<EventBriefDraftField, string>> = {
  eventName: "Event name",
  eventType: "Event type",
  guestCount: "Guests",
  layoutStyle: "Layout style",
  budgetLimitMinor: "Budget",
  preferredDate: "Date",
  startTime: "Start time",
  endTime: "End time",
  serviceModel: "Service",
  accessibilityRequirements: "Accessibility",
  planningPrompt: "Planning emphasis",
};

const LAYOUT_LABELS: Readonly<Record<LayoutChoice, string>> = {
  "dinner-rounds": "Dinner rounds",
  theatre: "Theatre seating",
};

const SERVICE_CHOICES: readonly ServiceChoice[] = ["none", "plated", "buffet", "reception"];
const SERVICE_LABELS: Readonly<Record<ServiceChoice, string>> = {
  none: "No catering service",
  plated: "Plated",
  buffet: "Buffet",
  reception: "Reception",
};

const ACCESSIBILITY_REQUIREMENTS: readonly EventArchitectAccessibilityRequirement[] = ["step_free_route", "wheelchair_spaces", "hearing_loop"];
const ACCESSIBILITY_LABELS: Readonly<Record<EventArchitectAccessibilityRequirement, string>> = {
  step_free_route: "Step-free route",
  wheelchair_spaces: "Wheelchair spaces",
  hearing_loop: "Hearing loop",
};
const ACCESSIBILITY_INPUTS: Readonly<Record<EventArchitectAccessibilityRequirement, AccessibilityKey>> = {
  step_free_route: "stepFreeRoute",
  wheelchair_spaces: "wheelchairSpaces",
  hearing_loop: "hearingLoop",
};

const KIND_LABELS: Readonly<Record<EventBriefUnsupportedKind, string>> = {
  not_modelled: "Not placed",
  layout_style: "Layout not offered",
  service_style: "Service not offered",
  beyond_limits: "Beyond its limits",
  needs_exact_value: "Needs an exact value",
  other_room: "Another room",
  other: "Not represented",
};

/** Which preview input each brief field fills. */
const FIELD_INPUTS: Readonly<Record<Exclude<EventBriefDraftField, "accessibilityRequirements">, PreviewKey>> = {
  eventName: "eventName",
  eventType: "eventType",
  guestCount: "guestCount",
  layoutStyle: "layoutStyle",
  budgetLimitMinor: "budgetPounds",
  preferredDate: "preferredDate",
  startTime: "startTime",
  endTime: "endTime",
  serviceModel: "serviceModel",
  planningPrompt: "planningPrompt",
};

const WHOLE_POUNDS = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const POUNDS_AND_PENCE = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });

function money(minor: number): string {
  return minor % 100 === 0 ? WHOLE_POUNDS.format(minor / 100) : POUNDS_AND_PENCE.format(minor / 100);
}
const LONG_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function poundsText(minor: number | null): string {
  if (minor === null) return "";
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

function valuesFrom(draft: EventBriefDraft): PreviewValues {
  const { brief } = draft;
  return {
    eventName: brief.eventName ?? "",
    eventType: brief.eventType ?? "",
    guestCount: brief.guestCount === null ? "" : String(brief.guestCount),
    layoutStyle: brief.layoutStyle ?? "",
    budgetPounds: poundsText(brief.budgetLimitMinor),
    preferredDate: brief.preferredDate ?? "",
    startTime: brief.startTime ?? "",
    endTime: brief.endTime ?? "",
    serviceModel: brief.serviceModel ?? "",
    stepFreeRoute: brief.accessibilityRequirements.includes("step_free_route"),
    wheelchairSpaces: brief.accessibilityRequirements.includes("wheelchair_spaces"),
    hearingLoop: brief.accessibilityRequirements.includes("hearing_loop"),
    planningPrompt: brief.planningPrompt ?? "",
  };
}

/** The value the AI read for a field, in words. */
function valueWords(draft: EventBriefDraft, field: EventBriefDraftField, requirement: EventArchitectAccessibilityRequirement | null): string {
  const { brief } = draft;
  switch (field) {
    case "guestCount": return brief.guestCount === null ? "not set" : String(brief.guestCount);
    case "layoutStyle": return brief.layoutStyle === null ? "not set" : LAYOUT_LABELS[brief.layoutStyle];
    case "serviceModel": return brief.serviceModel === null ? "not set" : SERVICE_LABELS[brief.serviceModel];
    case "budgetLimitMinor": return brief.budgetLimitMinor === null ? "not set" : money(brief.budgetLimitMinor);
    case "preferredDate": return brief.preferredDate === null ? "not set" : LONG_DATE.format(new Date(`${brief.preferredDate}T00:00:00Z`));
    case "accessibilityRequirements": return requirement === null ? "recorded" : ACCESSIBILITY_LABELS[requirement];
    default: return brief[field] ?? "not set";
  }
}

function Words({ item }: { readonly item: EventBriefUnsupported }): ReactElement {
  return item.verbatim
    ? <q className="ea-reading__words">{item.words}</q>
    : <span className="ea-reading__words ea-reading__words--described">Described as: {item.words}</span>;
}

function HeldBack({ items, title, id }: { readonly items: readonly EventBriefUnsupported[]; readonly title: string; readonly id: string }): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section className="ea-reading__list ea-reading__list--held" aria-labelledby={id} data-testid="brief-unsupported">
      <h4 id={id}>{title} <span aria-label={`${String(items.length)} items`}>{items.length}</span></h4>
      <p>The Event Architect cannot represent these. Plan them with the venue team.</p>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.words}-${String(index)}`}>
            <Words item={item} />
            <span className="ea-reading__tag">{KIND_LABELS[item.kind]}</span>
            <span className="ea-reading__note">{item.explanation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface EventBriefReaderProps {
  readonly venueId: string;
  readonly spaceId: string;
  /** The room chosen above, named in what the brief was read for. */
  readonly roomName: string | null;
  /** Puts the checked values into the request form; nothing runs. */
  readonly onFill: (values: BriefFormValues) => void;
}

export function EventBriefReader({ venueId, spaceId, roomName, onFill }: EventBriefReaderProps): ReactElement | null {
  const available = useEventBriefReaderAvailable();
  const [description, setDescription] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [values, setValues] = useState<PreviewValues | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<PreviewKey>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const ids = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const layoutRef = useRef<HTMLSelectElement>(null);
  const serviceRef = useRef<HTMLSelectElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const readingFor = useRef<string | null>(null);
  // An answer overtaken by a newer read, a stop or unmounting is dropped.
  const askNumber = useRef(0);

  useEffect(() => () => {
    askNumber.current += 1;
    controllerRef.current?.abort();
  }, []);

  const stop = useCallback((why: string) => {
    askNumber.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStep({ kind: "idle" });
    setSaid(why);
  }, []);

  // A read is for the room chosen when it was asked; choosing another room
  // stops one still on its way.
  useEffect(() => {
    if (step.kind === "reading" && readingFor.current !== null && readingFor.current !== spaceId) {
      stop("Stopped: the room changed. Your description is unchanged.");
    }
  }, [spaceId, step.kind, stop]);

  const read = (): void => {
    const text = description.trim();
    if (text.length === 0) {
      setProblem("Write a few words about the event first.");
      textareaRef.current?.focus();
      return;
    }
    // A brief is read for a room: none is chosen while a venue's rooms load.
    if (venueId.length === 0 || spaceId.length === 0) {
      setProblem("Choose a room above before reading the brief.");
      return;
    }
    setProblem(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    askNumber.current += 1;
    const mine = askNumber.current;
    readingFor.current = spaceId;
    const readFor: ReadFor = { spaceId, roomName };
    setStep({ kind: "reading" });
    setSaid("Reading the brief.");
    readEventBrief({ venueId, spaceId, description: text }, controller.signal)
      .then((draft) => {
        if (askNumber.current !== mine) return;
        controllerRef.current = null;
        setValues(valuesFrom(draft));
        setTouched(new Set());
        setStep({ kind: "ready", draft, readFor });
        setSaid("The brief has been read. Check it below.");
        window.requestAnimationFrame(() => { previewHeadingRef.current?.focus(); });
      })
      .catch((error: unknown) => {
        if (askNumber.current !== mine) return;
        controllerRef.current = null;
        setSaid("");
        // Only the server's own word that AI is off takes the feature away
        // for the visit; a proxy's 503 is a failure to try again.
        if (error instanceof ApiError && error.status === 503 && error.code === "AI_ASSISTANT_DISABLED") {
          markEventBriefReaderUnavailable();
          setStep({ kind: "gone" });
          return;
        }
        // Refused as it stands (a room no longer there, a description it will
        // not take): asking again would be refused again.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
          setStep({ kind: "refused" });
          return;
        }
        setStep({ kind: "failed" });
        window.requestAnimationFrame(() => { retryRef.current?.focus(); });
      });
  };

  const stopReading = (): void => {
    stop("Stopped. Your description is unchanged.");
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (step.kind !== "reading") read();
    } else if (event.key === "Escape" && step.kind === "reading") {
      event.preventDefault();
      stopReading();
    }
  };

  const change = <K extends PreviewKey>(key: K, value: PreviewValues[K]): void => {
    setValues((current) => current === null ? current : { ...current, [key]: value });
    setTouched((current) => new Set(current).add(key));
    setProblem(null);
  };

  const fill = (): void => {
    if (step.kind !== "ready" || values === null) return;
    const { layoutStyle, serviceModel } = values;
    if (layoutStyle === "" || serviceModel === "") {
      const missing = [layoutStyle === "" ? "a layout style" : null, serviceModel === "" ? "a service" : null]
        .filter((name) => name !== null);
      setProblem(`Choose ${missing.join(" and ")} before filling the form.`);
      (layoutStyle === "" ? layoutRef : serviceRef).current?.focus();
      return;
    }
    onFill({ ...values, layoutStyle, serviceModel });
    setStep({ kind: "filled", draft: step.draft, readFor: step.readFor });
    setSaid("The request form now holds this brief. Nothing has run.");
  };

  const putAway = (): void => {
    setStep({ kind: "idle" });
    setValues(null);
    setProblem(null);
    setSaid("Put away. The request form is unchanged.");
    textareaRef.current?.focus();
  };

  if (step.kind !== "gone" && available !== true) return null;

  const reading = step.kind === "reading";
  const draft = step.kind === "ready" || step.kind === "filled" ? step.draft : null;
  const readFor = step.kind === "ready" || step.kind === "filled" ? step.readFor : null;
  const assumed = new Set<PreviewKey>(
    (draft?.assumptions ?? []).flatMap((assumption): PreviewKey[] => {
      if (assumption.field !== "accessibilityRequirements") return [FIELD_INPUTS[assumption.field]];
      return assumption.accessibilityRequirement === null ? [] : [ACCESSIBILITY_INPUTS[assumption.accessibilityRequirement]];
    }),
  );
  const mark = (input: PreviewKey): ReactElement | null =>
    assumed.has(input) && !touched.has(input) ? <span className="ea-reading__assumed">Assumed</span> : null;
  const roomChanged = readFor !== null && readFor.spaceId !== spaceId;

  return (
    <section className="ea-reader" aria-labelledby={`${ids}-title`} data-testid="brief-reader">
      <p className="vv-sr-only" role="status" data-testid="brief-reader-said">{said}</p>
      <Quote className="ea-reader__mark" aria-hidden="true" strokeWidth={0.6} />

      {step.kind === "gone" ? (
        <p className="ea-reader__quiet-note" data-testid="brief-reader-gone">
          Reading briefs is not available now. The request form below works as before.
        </p>
      ) : (
        <>
          <div className="ea-reader__intro">
            <p className="ea-reader__kicker" id={`${ids}-title`}><Sparkles aria-hidden="true" /> In your own words</p>
            <p className="ea-reader__lede">
              Write the event as it was put to you. It is read into the brief for you to check, value by value;
              nothing runs until you generate the options.
            </p>
          </div>

          <label className="ea-reader__field">
            <span>Describe the event</span>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={(event) => { setDescription(event.target.value); setProblem(null); }}
              onKeyDown={onKeyDown}
              readOnly={reading}
              aria-describedby={`${ids}-help`}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              maxLength={EVENT_BRIEF_DESCRIPTION_MAX_LENGTH}
              rows={4}
              placeholder="A wedding breakfast for about 120 on Saturday 12 June, round tables, plated, a top table and a dance floor"
            />
          </label>
          <p className="ea-reader__help" id={`${ids}-help`}>
            Email addresses and phone numbers are taken out before it is read. Ctrl + Enter reads it.
          </p>

          <div className="ea-reader__actions">
            <button type="button" className="ea-reader__read" onClick={() => { if (!reading) read(); }}
              aria-busy={reading} aria-disabled={reading} data-testid="brief-read">
              {reading ? <ActivityIndicator size={18} /> : <Sparkles aria-hidden="true" />}
              {reading ? "Reading the brief…" : draft === null ? "Read the brief" : "Read it again"}
            </button>
            {reading && (
              <button type="button" className="ea-reader__quiet" onClick={stopReading} data-testid="brief-stop">Stop</button>
            )}
          </div>

          {problem !== null && step.kind !== "ready" && (
            <p className="ea-reader__problem" role="alert">{problem}</p>
          )}
          {step.kind === "failed" && (
            <div className="ea-reader__problem" role="alert" data-testid="brief-failed">
              <CircleAlert aria-hidden="true" />
              <span>The brief could not be read. Your description is still here.</span>
              <button type="button" ref={retryRef} className="ea-reader__quiet" onClick={() => { read(); }}>Try again</button>
            </div>
          )}
          {step.kind === "refused" && (
            <p className="ea-reader__problem" role="alert" data-testid="brief-refused">
              This description cannot be read for the room chosen. The request form below works as before.
            </p>
          )}
        </>
      )}

      {step.kind === "ready" && values !== null && draft !== null && (
        <section className="ea-reading" aria-labelledby={`${ids}-reading`} data-testid="brief-preview">
          <header className="ea-reading__head">
            <p className="ea-reading__kicker"><span className="ea-reading__chip">Draft</span> Not checked</p>
            <h3 id={`${ids}-reading`} ref={previewHeadingRef} tabIndex={-1}>The brief as read</h3>
            <p>
              Read for the {readFor?.roomName ?? "room chosen"}. Change anything that is not right; a value marked
              Assumed was not stated in your words.
              {draft.contactDetailsRemoved ? " Contact details were taken out before it was read." : ""}
            </p>
            {roomChanged && <p className="ea-reading__warning">The room chosen above has changed since this was read.</p>}
          </header>

          <div className="ea-reading__grid">
            <label className="ea-reading__wide">
              <span>Event name {mark("eventName")}</span>
              <input value={values.eventName} maxLength={200} onChange={(event) => { change("eventName", event.target.value); }} />
            </label>
            <label>
              <span>Event type {mark("eventType")}</span>
              <input value={values.eventType} maxLength={120} onChange={(event) => { change("eventType", event.target.value); }} />
            </label>
            <label>
              <span>Guests {mark("guestCount")}</span>
              <input type="number" inputMode="numeric" min={1} max={300} value={values.guestCount}
                onChange={(event) => { change("guestCount", event.target.value); }} />
            </label>
            <label>
              <span>Layout style {mark("layoutStyle")}</span>
              <select ref={layoutRef} value={values.layoutStyle} onChange={(event) => {
                const value = event.target.value;
                if (value === "" || value === "dinner-rounds" || value === "theatre") change("layoutStyle", value);
              }}>
                <option value="">Not set: choose one</option>
                <option value="dinner-rounds">{LAYOUT_LABELS["dinner-rounds"]}</option>
                <option value="theatre">{LAYOUT_LABELS.theatre}</option>
              </select>
            </label>
            <label>
              <span>Service {mark("serviceModel")}</span>
              <select ref={serviceRef} value={values.serviceModel} onChange={(event) => {
                const value = SERVICE_CHOICES.find((choice) => choice === event.target.value) ?? "";
                change("serviceModel", value);
              }}>
                <option value="">Not set: choose one</option>
                {SERVICE_CHOICES.map((choice) => <option key={choice} value={choice}>{SERVICE_LABELS[choice]}</option>)}
              </select>
            </label>
            <label>
              <span>Budget in GBP {mark("budgetPounds")}</span>
              <input type="text" inputMode="decimal" value={values.budgetPounds} onChange={(event) => { change("budgetPounds", event.target.value); }} />
            </label>
            <label>
              <span>Date {mark("preferredDate")}</span>
              <input type="date" value={values.preferredDate} onChange={(event) => { change("preferredDate", event.target.value); }} />
            </label>
            <label>
              <span>Start time {mark("startTime")}</span>
              <input type="time" value={values.startTime} onChange={(event) => { change("startTime", event.target.value); }} />
            </label>
            <label>
              <span>End time {mark("endTime")}</span>
              <input type="time" value={values.endTime} onChange={(event) => { change("endTime", event.target.value); }} />
            </label>
          </div>

          <fieldset className="ea-reading__access">
            <legend>Accessibility requirements</legend>
            {ACCESSIBILITY_REQUIREMENTS.map((requirement) => {
              const input = ACCESSIBILITY_INPUTS[requirement];
              return (
                <label key={requirement}>
                  <input type="checkbox" checked={values[input]} onChange={(event) => { change(input, event.target.checked); }} />
                  {ACCESSIBILITY_LABELS[requirement]} {mark(input)}
                </label>
              );
            })}
          </fieldset>

          <label className="ea-reading__emphasis">
            <span>Planning emphasis {mark("planningPrompt")}</span>
            <textarea value={values.planningPrompt} maxLength={2000} rows={2} onChange={(event) => { change("planningPrompt", event.target.value); }} />
          </label>

          {draft.assumptions.length > 0 && (
            <section className="ea-reading__list ea-reading__list--assumed" aria-labelledby={`${ids}-assumed`} data-testid="brief-assumptions">
              <h4 id={`${ids}-assumed`}>Assumed, not stated <span aria-label={`${String(draft.assumptions.length)} items`}>{draft.assumptions.length}</span></h4>
              <ul>
                {draft.assumptions.map((assumption, index) => (
                  <li key={`${assumption.field}-${String(index)}`}>
                    <strong>{FIELD_LABELS[assumption.field]}: {valueWords(draft, assumption.field, assumption.accessibilityRequirement)}</strong>
                    <span className="ea-reading__note">{assumption.basis}</span>
                    {assumption.words !== null && <span className="ea-reading__from">From <q>{assumption.words}</q></span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <HeldBack items={draft.unsupported} title="Not carried into the plan" id={`${ids}-held`} />

          {problem !== null && <p className="ea-reader__problem" role="alert">{problem}</p>}

          <div className="ea-reading__actions">
            <button type="button" className="ea-reading__fill" onClick={fill} data-testid="brief-fill">
              <Check aria-hidden="true" /> Fill the request form
            </button>
            <button type="button" className="ea-reader__quiet" onClick={putAway} data-testid="brief-put-away">Put it away</button>
          </div>
        </section>
      )}

      {step.kind === "filled" && draft !== null && (
        <div className="ea-reader__filled" data-testid="brief-filled">
          <div className="ea-reader__filled-note">
            <Check aria-hidden="true" />
            <div>
              <strong>The request form below holds this brief.</strong>
              <span>Nothing has run. Check it there, then generate the three options.</span>
            </div>
          </div>
          <HeldBack items={draft.unsupported} title="Still not carried into the plan" id={`${ids}-still-held`} />
        </div>
      )}
    </section>
  );
}
