import { useId, useState, type ReactElement, type ReactNode } from "react";
import {
  PHASE_METADATA,
  PROCEDURE_NOTE_MAX,
  PROTECTED_PREMISES_NOTES_MAX,
  PROTECTION_PROCEDURES,
  PROTECTION_PROCEDURE_COPY,
  SETUP_PHASES,
  ZONES,
  emptyAccessibilityRequirements,
  emptyDietarySummary,
  emptyDoorSchedule,
  type AccessibilityRequirements,
  type DayOfContact,
  type DietarySummary,
  type DoorEvent,
  type DoorScheduleEntry,
  type EventInstructions,
  type ProcedureBriefing,
  type ProtectedPremises,
  type ProtectionProcedure,
  type SetupPhase,
  type Zone,
} from "@omnitwin/types";
import { ActivityIndicator } from "../shared/Activity.js";
import { actNameProblem, durationProblem, type ActOverlap, type OrderedAct } from "../../lib/event-details-acts.js";
import { ALLERGY_NOTE_LINE, dietOverGuestsLine } from "../../lib/event-details-save.js";
import {
  durationWords,
  fromGlasgowWallInput,
  glasgowClock,
  glasgowWallInput,
  parseClock,
  startOnVenueDay,
} from "../../lib/event-details-times.js";
import { Segmented, Switch } from "./Controls.js";
import { QuietKey } from "./Keys.js";

// ---------------------------------------------------------------------------
// Event details' sections (T-674 slice 19; spec 6.13). Each is a plain form
// on lacquer that writes through its `onEdit` as the person types; the panel
// owns the saving. Every time is Glasgow time and says so. A field the person
// may not change is read-only, and an empty optional block says so in words.
// ---------------------------------------------------------------------------

/** What a section's save is doing, said beside its title. */
export type SectionMark =
  | { readonly kind: "none" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly at: string | null }
  | { readonly kind: "held"; readonly line: string }
  | { readonly kind: "failed"; readonly line: string };

export const NO_MARK: SectionMark = { kind: "none" };

export function MarkWords({ mark }: { readonly mark: SectionMark }): ReactElement | null {
  if (mark.kind === "none") return null;
  if (mark.kind === "saving") {
    return (
      <span className="pc-ed__mark">
        <ActivityIndicator size={16} />
        <span>Saving</span>
      </span>
    );
  }
  if (mark.kind === "saved") {
    return <span className="pc-ed__mark pc-ed__mark--saved" title={mark.at === null ? undefined : `Saved ${mark.at}`}>Saved</span>;
  }
  return <span className={`pc-ed__mark pc-ed__mark--${mark.kind}`}>{mark.kind === "held" ? "Not saved yet" : "Not saved"}</span>;
}

export interface SectionProps {
  readonly title: string;
  readonly mark?: SectionMark;
  /** One line under the title: what the section is for. */
  readonly hint?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
}

export function Section({ title, mark = NO_MARK, hint, children, testId }: SectionProps): ReactElement {
  const id = useId();
  const waiting = mark.kind === "held" || mark.kind === "failed" ? mark.line : null;
  return (
    <section className="pc-ed__section" aria-labelledby={id} data-testid={testId}>
      <div className="pc-ed__section-head">
        <h3 id={id} className="pc-caps pc-ed__section-title">{title}</h3>
        <MarkWords mark={mark} />
      </div>
      {hint !== undefined ? <p className="pc-meta pc-ed__hint">{hint}</p> : null}
      {waiting !== null ? <p className="pc-meta pc-ed__waiting">{waiting}</p> : null}
      <div className="pc-ed__section-body">{children}</div>
    </section>
  );
}

// -- Inputs -----------------------------------------------------------------

interface TextInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly readOnly: boolean;
  readonly maxLength: number;
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly type?: "text" | "tel" | "email";
  /** A visible label is the default; a field under its own heading can name itself for assistive technology only. */
  readonly hiddenLabel?: boolean;
  readonly describedBy?: string;
  readonly className?: string;
}

export function TextInput({
  label, value, onChange, readOnly, maxLength, multiline = false, rows = 3, placeholder, type = "text",
  hiddenLabel = false, describedBy, className,
}: TextInputProps): ReactElement {
  const id = useId();
  const shared = {
    id,
    className: "pc-ed__input",
    value,
    readOnly,
    placeholder: readOnly ? undefined : placeholder,
    maxLength,
    autoComplete: "off",
    "aria-describedby": describedBy,
  } as const;
  return (
    <div className={["pc-ed__field", className ?? ""].filter(Boolean).join(" ")}>
      <label className={hiddenLabel ? "vv-sr-only" : "pc-ed__label"} htmlFor={id}>{label}</label>
      <div className={multiline ? "pc-ed__well pc-ed__well--multi" : "pc-ed__well"} data-readonly={readOnly ? "true" : undefined}>
        {multiline
          ? <textarea {...shared} rows={rows} onChange={(event) => { onChange(event.target.value.slice(0, maxLength)); }} />
          : <input {...shared} type={type} spellCheck={type === "text"} onChange={(event) => { onChange(event.target.value.slice(0, maxLength)); }} />}
      </div>
    </div>
  );
}

/** Why typed text is not a count up to `max`, or null when it is. */
export function countProblem(text: string, max: number): string | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return "Type a whole number";
  if (Number(trimmed) > max) return `Up to ${String(max)}`;
  return null;
}

interface CountInputProps {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly readOnly: boolean;
  readonly unit?: string;
  readonly className?: string;
}

/** A whole number as typed: it saves as soon as it reads, and says why when it cannot. */
export function CountInput({ label, value, max, onChange, readOnly, unit, className }: CountInputProps): ReactElement {
  const id = useId();
  const problemId = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value);
  const problem = text === null ? null : countProblem(text, max);
  return (
    <div className={["pc-ed__field", className ?? ""].filter(Boolean).join(" ")}>
      <label className="pc-ed__label" htmlFor={id}>{label}</label>
      <div className="pc-ed__well" data-invalid={problem !== null ? "true" : undefined} data-readonly={readOnly ? "true" : undefined}>
        <input
          id={id}
          className="pc-ed__input pc-num"
          inputMode="numeric"
          autoComplete="off"
          value={shown}
          readOnly={readOnly}
          aria-invalid={problem !== null ? true : undefined}
          aria-describedby={problem !== null ? problemId : undefined}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (countProblem(next, max) === null) onChange(Number(next.trim()));
          }}
          onBlur={() => { if (text !== null && countProblem(text, max) === null) setText(null); }}
        />
        {unit !== undefined ? <span className="pc-ed__unit" aria-hidden="true">{unit}</span> : null}
      </div>
      {problem !== null ? <span id={problemId} className="pc-ed__problem">{problem}</span> : null}
    </div>
  );
}

interface WallTimeInputProps {
  readonly label: string;
  readonly iso: string | undefined;
  readonly onChange: (iso: string | undefined) => void;
  readonly readOnly: boolean;
  /** Clearing leaves no time (Martyn's Law briefing), rather than keeping the last. */
  readonly clearable?: boolean;
}

/** A date and time in Glasgow, whatever the device's zone (lens C-16). */
export function WallTimeInput({ label, iso, onChange, readOnly, clearable = false }: WallTimeInputProps): ReactElement {
  const id = useId();
  return (
    <div className="pc-ed__field">
      <label className="pc-ed__label" htmlFor={id}>{label} <span className="pc-ed__zone">Glasgow time</span></label>
      <div className="pc-ed__well" data-readonly={readOnly ? "true" : undefined}>
        <input
          id={id}
          type="datetime-local"
          className="pc-ed__input pc-num"
          value={glasgowWallInput(iso)}
          readOnly={readOnly}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "" && clearable) {
              onChange(undefined);
              return;
            }
            const next = fromGlasgowWallInput(value, iso ?? "");
            if (next !== "") onChange(next);
          }}
        />
      </div>
    </div>
  );
}

interface ClockInputProps {
  readonly label: string;
  readonly iso: string | null;
  /** The day the time goes on when the act has none yet: the event's start. */
  readonly anchor: string | null;
  readonly onChange: (iso: string) => void;
  readonly readOnly: boolean;
}

/** An act's start as a clock time on the event's day ("18:45"), in Glasgow time. */
export function ClockInput({ label, iso, anchor, onChange, readOnly }: ClockInputProps): ReactElement {
  const id = useId();
  const problemId = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? glasgowClock(iso) ?? "";
  const minutes = text === null ? null : parseClock(text);
  const day = iso ?? anchor;
  const problem = text === null || text.trim() === "" ? null
    : minutes === null ? "Type a time like 18:45"
      : day === null ? "Give the event a date first"
        : null;
  return (
    <div className="pc-ed__field pc-ed__field--clock">
      <label className="pc-ed__label" htmlFor={id}>{label}</label>
      <div className="pc-ed__well" data-invalid={problem !== null ? "true" : undefined} data-readonly={readOnly ? "true" : undefined}>
        <input
          id={id}
          className="pc-ed__input pc-num"
          inputMode="numeric"
          autoComplete="off"
          placeholder={readOnly ? undefined : "18:45"}
          value={shown}
          readOnly={readOnly}
          aria-invalid={problem !== null ? true : undefined}
          aria-describedby={problem !== null ? problemId : undefined}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const parsed = parseClock(next);
            const at = parsed === null ? null : startOnVenueDay(parsed, day);
            if (at !== null) onChange(at);
          }}
          onBlur={() => { if (problem === null) setText(null); }}
        />
      </div>
      {problem !== null ? <span id={problemId} className="pc-ed__problem">{problem}</span> : null}
    </div>
  );
}

interface ChoiceProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly readOnly: boolean;
}

/** A native select on lacquer, for a longer list (the hearing loop's zone, a set-up part). */
export function Choice<T extends string>({ label, value, options, onChange, readOnly }: ChoiceProps<T>): ReactElement {
  const id = useId();
  return (
    <div className="pc-ed__field">
      <label className="pc-ed__label" htmlFor={id}>{label}</label>
      <div className="pc-ed__well" data-readonly={readOnly ? "true" : undefined}>
        <select
          id={id}
          className="pc-ed__input pc-ed__select"
          value={value}
          disabled={readOnly}
          onChange={(event) => {
            const next = options.find((option) => option.value === event.target.value);
            if (next !== undefined) onChange(next.value);
          }}
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </div>
  );
}

// -- The running order --------------------------------------------------------

export interface ActPatch {
  readonly name?: string;
  readonly startsAt?: string;
  readonly durationMinutes?: number;
}

export interface RunningOrderProps {
  readonly acts: readonly OrderedAct[];
  readonly overlaps: readonly ActOverlap[];
  readonly editable: boolean;
  /** The line under the title: what the acts are for, who sets them, or where they come from. */
  readonly line: string;
  /** No event linked, so no acts to list. */
  readonly noEvent: boolean;
  readonly eventStart: string | null;
  readonly marks: Readonly<Record<string, SectionMark>>;
  readonly onEdit: (act: OrderedAct, patch: ActPatch) => void;
  readonly onAdd: (() => void) | null;
  readonly adding: "idle" | "running" | "failed";
}

export function RunningOrder(props: RunningOrderProps): ReactElement {
  const { acts, overlaps, editable, eventStart } = props;
  return (
    <Section title="Running order" hint={props.line} testId="planner-event-details-running-order">
      {!props.noEvent && acts.length === 0 ? <p className="pc-meta pc-ed__empty">No acts yet.</p> : null}
      {acts.length > 0 ? (
        <ol className="pc-ed__acts">
          {acts.map((act) => {
            const mark = props.marks[act.id] ?? NO_MARK;
            const nameProblem = actNameProblem(act.name);
            return (
              <li key={act.id} className={editable ? "pc-ed__act" : "pc-ed__act pc-ed__act--read"} data-testid="planner-event-details-act">
                {editable ? (
                  <>
                    <TextInput
                      label="Act"
                      className="pc-ed__act-name"
                      value={act.name}
                      maxLength={100}
                      readOnly={false}
                      onChange={(name) => { props.onEdit(act, { name }); }}
                    />
                    <ClockInput
                      label="Starts"
                      iso={act.startsAt}
                      anchor={eventStart}
                      readOnly={false}
                      onChange={(startsAt) => { props.onEdit(act, { startsAt }); }}
                    />
                    <CountInput
                      label="For"
                      className="pc-ed__act-length"
                      unit="min"
                      max={24 * 60}
                      value={act.durationMinutes}
                      readOnly={false}
                      onChange={(durationMinutes) => {
                        if (durationProblem(durationMinutes) === null) props.onEdit(act, { durationMinutes });
                      }}
                    />
                    <span className="pc-ed__act-mark">
                      {nameProblem !== null ? <span className="pc-ed__problem">{nameProblem}</span> : <MarkWords mark={mark} />}
                    </span>
                  </>
                ) : (
                  <p className="pc-ed__act-read">
                    <span className="pc-ed__act-time pc-num">{glasgowClock(act.startsAt) ?? "No time"}</span>
                    <span className="pc-ed__act-title">{act.name}</span>
                    <span className="pc-meta pc-ed__act-for">{durationWords(act.durationMinutes)}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      {overlaps.length > 0 ? (
        <ul className="pc-ed__overlaps" aria-label="Acts that overlap" data-testid="planner-event-details-overlaps">
          {overlaps.map((overlap) => <li key={`${overlap.earlierId}-${overlap.laterId}`} className="pc-meta">{overlap.line}</li>)}
        </ul>
      ) : null}
      {props.onAdd !== null ? (
        <div className="pc-ed__row-keys">
          <QuietKey
            label={props.adding === "running" ? "Adding an act" : "Add an act"}
            aria-busy={props.adding === "running" ? true : undefined}
            icon={props.adding === "running" ? <ActivityIndicator size={16} /> : undefined}
            disabledReason={props.adding === "running" ? "Adding an act" : undefined}
            onPress={props.onAdd}
          />
          {props.adding === "failed" ? <span className="pc-ed__problem" role="alert">The act was not added. Try again in a moment.</span> : null}
        </div>
      ) : null}
    </Section>
  );
}

// -- Guests -------------------------------------------------------------------

export interface GuestsProps {
  readonly value: number | null;
  readonly editable: boolean;
  readonly line: string;
  readonly mark: SectionMark;
  readonly onChange: (count: number) => void;
}

export function Guests({ value, editable, line, mark, onChange }: GuestsProps): ReactElement {
  return (
    <Section title="Guests" mark={mark} hint={line} testId="planner-event-details-guests">
      {editable ? (
        <CountInput label="Guests" unit="guests" max={10000} value={value ?? 0} readOnly={false} onChange={onChange} className="pc-ed__guests" />
      ) : (
        <p className="pc-figure pc-ed__guests-read">{value === null ? "Not set" : `${String(value)} guests`}</p>
      )}
    </Section>
  );
}

// -- The instructions' sections ------------------------------------------------

export interface InstructionsProps {
  readonly draft: EventInstructions;
  readonly readOnly: boolean;
  readonly marks: Readonly<Record<string, SectionMark>>;
  readonly guests: number | null;
  readonly onEdit: (section: string, change: (draft: EventInstructions) => EventInstructions) => void;
  /** Where a new deadline or door time starts. */
  readonly leadTime: () => string;
}

export function ContactOnTheDay({ draft, readOnly, marks, onEdit }: InstructionsProps): ReactElement {
  const contact = draft.dayOfContact;
  const set = (patch: Partial<DayOfContact>): void => {
    onEdit("dayOfContact", (current) => ({
      ...current,
      dayOfContact: { ...(current.dayOfContact ?? { name: "", role: "", phone: "", email: "" }), ...patch },
    }));
  };
  return (
    <Section title="Contact on the day" mark={marks["dayOfContact"] ?? NO_MARK} hint="Who the hallkeeper rings on the day." testId="planner-event-details-contact">
      {contact === null ? (
        readOnly ? <p className="pc-meta pc-ed__empty">No contact yet.</p> : (
          <div className="pc-ed__row-keys">
            <QuietKey label="Add a contact" onPress={() => { set({}); }} />
          </div>
        )
      ) : (
        <>
          <div className="pc-ed__grid">
            <TextInput label="Name" value={contact.name} maxLength={120} readOnly={readOnly} onChange={(name) => { set({ name }); }} />
            <TextInput label="Role" value={contact.role} maxLength={120} readOnly={readOnly} placeholder="Planner, best man" onChange={(role) => { set({ role }); }} />
            <TextInput label="Phone" type="tel" value={contact.phone} maxLength={40} readOnly={readOnly} placeholder="+44" onChange={(phone) => { set({ phone }); }} />
            <TextInput label="Email" type="email" value={contact.email} maxLength={255} readOnly={readOnly} onChange={(email) => { set({ email }); }} />
          </div>
          {!readOnly ? (
            <div className="pc-ed__row-keys">
              <QuietKey label="Remove contact" onPress={() => { onEdit("dayOfContact", (current) => ({ ...current, dayOfContact: null })); }} />
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

export function Access({ draft, readOnly, marks, onEdit }: InstructionsProps): ReactElement {
  return (
    <Section title="Access" mark={marks["accessNotes"] ?? NO_MARK}>
      <TextInput
        label="Access and deliveries"
        multiline
        rows={3}
        value={draft.accessNotes}
        maxLength={1500}
        readOnly={readOnly}
        placeholder="Service entrance at the south door. No vans after 15:00."
        onChange={(accessNotes) => { onEdit("accessNotes", (current) => ({ ...current, accessNotes })); }}
      />
    </Section>
  );
}

const DIET_FIELDS: readonly { readonly key: Exclude<keyof DietarySummary, "otherAllergies">; readonly label: string }[] = [
  { key: "vegetarian", label: "Vegetarian" },
  { key: "vegan", label: "Vegan" },
  { key: "glutenFree", label: "Gluten-free" },
  { key: "nutFree", label: "Nut-free" },
  { key: "halal", label: "Halal" },
  { key: "kosher", label: "Kosher" },
];

export function DietaryAndAccessibility({ draft, readOnly, marks, guests, onEdit }: InstructionsProps): ReactElement {
  const lineId = useId();
  const dietary = draft.dietary;
  const accessibility = draft.accessibility;
  const setDiet = (patch: Partial<DietarySummary>): void => {
    onEdit("dietary", (current) => ({ ...current, dietary: { ...(current.dietary ?? emptyDietarySummary()), ...patch } }));
  };
  const setAccess = (patch: Partial<AccessibilityRequirements>): void => {
    onEdit("accessibility", (current) => ({ ...current, accessibility: { ...(current.accessibility ?? emptyAccessibilityRequirements()), ...patch } }));
  };
  const viewOnly = readOnly ? "View only" : undefined;
  const over = dietOverGuestsLine(dietary, guests);
  return (
    <>
      <Section title="Dietary needs" mark={marks["dietary"] ?? NO_MARK} testId="planner-event-details-dietary">
        {dietary === null ? (
          readOnly ? <p className="pc-meta pc-ed__empty">None noted.</p> : (
            <div className="pc-ed__row-keys">
              <QuietKey label="Add dietary needs" onPress={() => { setDiet({}); }} />
            </div>
          )
        ) : (
          <>
            <div className="pc-ed__grid pc-ed__grid--three">
              {DIET_FIELDS.map(({ key, label }) => (
                <CountInput key={key} label={label} max={10000} value={dietary[key]} readOnly={readOnly} onChange={(value) => { setDiet({ [key]: value }); }} />
              ))}
            </div>
            {over !== null ? <p className="pc-meta pc-ed__note" data-testid="planner-event-details-diet-over">{over}</p> : null}
            <TextInput
              label="Allergies and other needs"
              multiline
              rows={2}
              value={dietary.otherAllergies}
              maxLength={1000}
              readOnly={readOnly}
              placeholder="One guest: shellfish, severe. Two guests: sesame."
              describedBy={lineId}
              onChange={(otherAllergies) => { setDiet({ otherAllergies }); }}
            />
            <p id={lineId} className="pc-meta pc-ed__hint">{ALLERGY_NOTE_LINE}</p>
            {!readOnly ? (
              <div className="pc-ed__row-keys">
                <QuietKey label="Remove dietary needs" onPress={() => { onEdit("dietary", (current) => ({ ...current, dietary: null })); }} />
              </div>
            ) : null}
          </>
        )}
      </Section>
      <Section title="Accessibility" mark={marks["accessibility"] ?? NO_MARK} testId="planner-event-details-accessibility">
        {accessibility === null ? (
          readOnly ? <p className="pc-meta pc-ed__empty">None noted.</p> : (
            <div className="pc-ed__row-keys">
              <QuietKey label="Add accessibility needs" onPress={() => { setAccess({}); }} />
            </div>
          )
        ) : (
          <>
            <div className="pc-ed__switches">
              <Switch label="Hearing loop" checked={accessibility.hearingLoopRequired} disabledReason={viewOnly} onChange={(hearingLoopRequired) => { setAccess({ hearingLoopRequired }); }} />
              {accessibility.hearingLoopRequired ? (
                <Choice<Zone | "">
                  label="Where the loop covers"
                  value={accessibility.hearingLoopZone ?? ""}
                  readOnly={readOnly}
                  options={[{ value: "", label: "Not set yet" }, ...ZONES.map((zone) => ({ value: zone, label: zone }))]}
                  onChange={(zone) => { setAccess({ hearingLoopZone: zone === "" ? null : zone }); }}
                />
              ) : null}
              <Switch label="Sign-language interpreter" checked={accessibility.signLanguageInterpreter} disabledReason={viewOnly} onChange={(signLanguageInterpreter) => { setAccess({ signLanguageInterpreter }); }} />
              <Switch label="Step-free route" checked={accessibility.stepFreeRouteRequired} disabledReason={viewOnly} onChange={(stepFreeRouteRequired) => { setAccess({ stepFreeRouteRequired }); }} />
            </div>
            <div className="pc-ed__grid">
              <CountInput label="Wheelchair spaces" max={50} value={accessibility.wheelchairSpaces} readOnly={readOnly} onChange={(wheelchairSpaces) => { setAccess({ wheelchairSpaces }); }} />
              <CountInput label="Large-print programmes" max={500} value={accessibility.largePrintProgrammes} readOnly={readOnly} onChange={(largePrintProgrammes) => { setAccess({ largePrintProgrammes }); }} />
            </div>
            <TextInput
              label="Notes"
              multiline
              rows={2}
              value={accessibility.notes}
              maxLength={1000}
              readOnly={readOnly}
              placeholder="BSL interpreter stage left. Assistance dogs welcome."
              onChange={(notes) => { setAccess({ notes }); }}
            />
            {!readOnly ? (
              <div className="pc-ed__row-keys">
                <QuietKey label="Remove accessibility needs" onPress={() => { onEdit("accessibility", (current) => ({ ...current, accessibility: null })); }} />
              </div>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}

const DOOR_KINDS: readonly { readonly value: DoorEvent["kind"]; readonly label: string }[] = [
  { value: "open", label: "Open" },
  { value: "lock", label: "Lock" },
];

export function DoorSchedule({ draft, readOnly, marks, onEdit, leadTime }: InstructionsProps): ReactElement {
  const schedule = draft.doorSchedule;
  const setEntries = (change: (entries: readonly DoorScheduleEntry[]) => readonly DoorScheduleEntry[]): void => {
    onEdit("doorSchedule", (current) => ({ ...current, doorSchedule: { entries: [...change((current.doorSchedule ?? emptyDoorSchedule()).entries)] } }));
  };
  const setDoor = (index: number, change: (entry: DoorScheduleEntry) => DoorScheduleEntry): void => {
    setEntries((entries) => entries.map((entry, i) => (i === index ? change(entry) : entry)));
  };
  const setTime = (doorIndex: number, eventIndex: number, patch: Partial<DoorEvent>): void => {
    setDoor(doorIndex, (entry) => ({ ...entry, events: entry.events.map((e, j) => (j === eventIndex ? { ...e, ...patch } : e)) }));
  };
  return (
    <Section title="Door schedule" mark={marks["doorSchedule"] ?? NO_MARK} testId="planner-event-details-doors">
      {schedule === null ? (
        readOnly ? <p className="pc-meta pc-ed__empty">No door times yet.</p> : (
          <div className="pc-ed__row-keys">
            <QuietKey label="Add a door schedule" onPress={() => { setEntries(() => [{ label: "Front door", events: [] }]); }} />
          </div>
        )
      ) : (
        <>
          {schedule.entries.map((door, doorIndex) => (
            <div key={doorIndex} className="pc-ed__door">
              <TextInput label="Door" value={door.label} maxLength={100} readOnly={readOnly} onChange={(label) => { setDoor(doorIndex, (entry) => ({ ...entry, label })); }} />
              {door.events.map((event, eventIndex) => (
                <div key={eventIndex} className="pc-ed__door-time">
                  <Segmented
                    label={`${door.label.trim() === "" ? "Door" : door.label}: open or lock`}
                    value={event.kind}
                    options={DOOR_KINDS.map((kind) => (readOnly ? { ...kind, disabledReason: "View only" } : kind))}
                    onChange={(kind) => { setTime(doorIndex, eventIndex, { kind }); }}
                  />
                  <WallTimeInput label="At" iso={event.at} readOnly={readOnly} onChange={(at) => { if (at !== undefined) setTime(doorIndex, eventIndex, { at }); }} />
                  <TextInput label="Note" value={event.note} maxLength={200} readOnly={readOnly} placeholder="After the guests arrive" onChange={(note) => { setTime(doorIndex, eventIndex, { note }); }} />
                  {!readOnly ? <QuietKey label="Remove this time" onPress={() => { setDoor(doorIndex, (entry) => ({ ...entry, events: entry.events.filter((_, j) => j !== eventIndex) })); }} /> : null}
                </div>
              ))}
              {!readOnly ? (
                <div className="pc-ed__row-keys">
                  {door.events.length < 10 ? <QuietKey label="Add a time" onPress={() => { setDoor(doorIndex, (entry) => ({ ...entry, events: [...entry.events, { at: leadTime(), kind: "open", note: "" }] })); }} /> : null}
                  <QuietKey label="Remove door" onPress={() => { setEntries((entries) => entries.filter((_, i) => i !== doorIndex)); }} />
                </div>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <div className="pc-ed__row-keys">
              {schedule.entries.length < 12 ? <QuietKey label="Add a door" onPress={() => { setEntries((entries) => [...entries, { label: "Side door", events: [] }]); }} /> : null}
              <QuietKey label="Remove door schedule" onPress={() => { onEdit("doorSchedule", (current) => ({ ...current, doorSchedule: null })); }} />
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

export function SetupDeadlines({ draft, readOnly, marks, onEdit, leadTime }: InstructionsProps): ReactElement {
  const set = (index: number, patch: { readonly phase?: SetupPhase; readonly deadline?: string; readonly reason?: string }): void => {
    onEdit("phaseDeadlines", (current) => ({ ...current, phaseDeadlines: current.phaseDeadlines.map((d, i) => (i === index ? { ...d, ...patch } : d)) }));
  };
  const free = SETUP_PHASES.find((phase) => !draft.phaseDeadlines.some((d) => d.phase === phase));
  return (
    <Section title="Set-up deadlines" mark={marks["phaseDeadlines"] ?? NO_MARK} hint="When each part of the set-up must be done.">
      {draft.phaseDeadlines.length === 0 && readOnly ? <p className="pc-meta pc-ed__empty">None set.</p> : null}
      {draft.phaseDeadlines.map((deadline, index) => (
        <div key={`${String(index)}-${deadline.phase}`} className="pc-ed__deadline">
          <Choice<SetupPhase>
            label="Part"
            value={deadline.phase}
            readOnly={readOnly}
            options={SETUP_PHASES.map((phase) => ({ value: phase, label: PHASE_METADATA[phase].label }))}
            onChange={(phase) => { set(index, { phase }); }}
          />
          <WallTimeInput label="Done by" iso={deadline.deadline} readOnly={readOnly} onChange={(at) => { if (at !== undefined) set(index, { deadline: at }); }} />
          <TextInput label="Why" value={deadline.reason} maxLength={200} readOnly={readOnly} placeholder="The board arrives early" onChange={(reason) => { set(index, { reason }); }} />
          {!readOnly ? <QuietKey label="Remove deadline" onPress={() => { onEdit("phaseDeadlines", (current) => ({ ...current, phaseDeadlines: current.phaseDeadlines.filter((_, i) => i !== index) })); }} /> : null}
        </div>
      ))}
      {!readOnly && free !== undefined ? (
        <div className="pc-ed__row-keys">
          <QuietKey label="Add a deadline" onPress={() => { onEdit("phaseDeadlines", (current) => ({ ...current, phaseDeadlines: [...current.phaseDeadlines, { phase: free, deadline: leadTime(), reason: "" }] })); }} />
        </div>
      ) : null}
    </Section>
  );
}

type TriState = "unset" | "yes" | "no";

function toTri(value: boolean | undefined): TriState {
  return value === undefined ? "unset" : value ? "yes" : "no";
}

function fromTri(value: TriState): boolean | undefined {
  return value === "unset" ? undefined : value === "yes";
}

function triOptions(labels: readonly [string, string, string], readOnly: boolean): readonly { readonly value: TriState; readonly label: string; readonly disabledReason?: string }[] {
  const values: readonly TriState[] = ["unset", "yes", "no"];
  return values.map((value, i) => ({ value, label: labels[i] ?? value, ...(readOnly ? { disabledReason: "View only" } : {}) }));
}

export function MartynsLaw({ draft, readOnly, marks, onEdit }: InstructionsProps): ReactElement {
  const premises = draft.protectedPremises ?? null;
  const change = (update: (current: ProtectedPremises) => ProtectedPremises): void => {
    onEdit("protectedPremises", (current) => ({ ...current, protectedPremises: update(current.protectedPremises ?? {}) }));
  };
  const setProcedure = (procedure: ProtectionProcedure, patch: Partial<ProcedureBriefing>): void => {
    change((current) => ({ ...current, procedures: { ...current.procedures, [procedure]: { ...current.procedures?.[procedure], ...patch } } }));
  };
  return (
    <Section
      title="Martyn's Law readiness"
      mark={marks["protectedPremises"] ?? NO_MARK}
      hint="Prompts for the function sheet, from what you enter here. Not a legal assessment: the venue's responsible person decides what the Act requires."
      testId="planner-event-details-martyns-law"
    >
      {premises === null ? (
        readOnly ? <p className="pc-meta pc-ed__empty">Nothing recorded.</p> : (
          <div className="pc-ed__row-keys">
            <QuietKey label="Add Martyn's Law readiness" onPress={() => { change(() => ({})); }} />
          </div>
        )
      ) : (
        <>
          <TextInput label="Responsible person" value={premises.responsiblePerson ?? ""} maxLength={200} readOnly={readOnly} placeholder="Who is in control of the premises for this event" onChange={(responsiblePerson) => { change((current) => ({ ...current, responsiblePerson })); }} />
          <div className="pc-ed__grid">
            <TextInput label="Lead on duty" value={premises.dutyLead?.name ?? ""} maxLength={120} readOnly={readOnly} onChange={(name) => { change((current) => ({ ...current, dutyLead: { ...current.dutyLead, name } })); }} />
            <TextInput label="Their role" value={premises.dutyLead?.role ?? ""} maxLength={120} readOnly={readOnly} placeholder="Duty manager" onChange={(role) => { change((current) => ({ ...current, dutyLead: { ...current.dutyLead, role } })); }} />
          </div>
          <p className="pc-ed__label">Staff briefed on</p>
          {PROTECTION_PROCEDURES.map((procedure) => {
            const briefing = premises.procedures?.[procedure];
            const copy = PROTECTION_PROCEDURE_COPY[procedure];
            return (
              <div key={procedure} className="pc-ed__procedure">
                <p className="pc-ed__procedure-name">{copy.label}</p>
                <p className="pc-meta pc-ed__hint">{copy.description}</p>
                <Segmented
                  label={copy.label}
                  value={toTri(briefing?.briefed)}
                  options={triOptions(["Not checked", "Briefed", "Not briefed"], readOnly)}
                  onChange={(next) => { setProcedure(procedure, { briefed: fromTri(next) }); }}
                />
                <TextInput label={`${copy.label}: note or document`} hiddenLabel value={briefing?.note ?? ""} maxLength={PROCEDURE_NOTE_MAX} readOnly={readOnly} placeholder="Note or document reference" onChange={(note) => { setProcedure(procedure, { note }); }} />
              </div>
            );
          })}
          <WallTimeInput label="Team briefing" iso={premises.briefingAt} readOnly={readOnly} clearable onChange={(briefingAt) => { change((current) => ({ ...current, briefingAt })); }} />
          <div className="pc-ed__procedure">
            <p className="pc-ed__procedure-name">Door supervision</p>
            <Segmented
              label="Door supervision"
              value={toTri(premises.doorSupervision?.arranged)}
              options={triOptions(["Not set", "Arranged", "Not arranged"], readOnly)}
              onChange={(next) => { change((current) => ({ ...current, doorSupervision: { ...current.doorSupervision, arranged: fromTri(next) } })); }}
            />
            <TextInput label="Door supervision note" hiddenLabel value={premises.doorSupervision?.note ?? ""} maxLength={PROCEDURE_NOTE_MAX} readOnly={readOnly} placeholder="Note" onChange={(note) => { change((current) => ({ ...current, doorSupervision: { ...current.doorSupervision, note } })); }} />
          </div>
          <TextInput label="Notes" multiline rows={3} value={premises.notes ?? ""} maxLength={PROTECTED_PREMISES_NOTES_MAX} readOnly={readOnly} onChange={(notes) => { change((current) => ({ ...current, notes })); }} />
          {!readOnly ? (
            <div className="pc-ed__row-keys">
              <QuietKey label="Remove Martyn's Law readiness" onPress={() => { onEdit("protectedPremises", (current) => ({ ...current, protectedPremises: undefined })); }} />
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

export function ForTheHallkeeper({ draft, readOnly, marks, onEdit }: InstructionsProps): ReactElement {
  return (
    <Section title="Instructions for the hallkeeper" mark={marks["specialInstructions"] ?? NO_MARK} hint="Printed at the top of the function sheet." testId="planner-event-details-hallkeeper">
      <TextInput
        label="Instructions for the hallkeeper"
        hiddenLabel
        multiline
        rows={5}
        value={draft.specialInstructions}
        maxLength={4000}
        readOnly={readOnly}
        placeholder="Board arriving at 18:45. The bride's family at Table 3."
        onChange={(specialInstructions) => { onEdit("specialInstructions", (current) => ({ ...current, specialInstructions })); }}
      />
    </Section>
  );
}
