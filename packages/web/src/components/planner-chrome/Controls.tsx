import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Minus, Plus } from "lucide-react";
import { Key, keyAccessibleName } from "./Keys.js";
import "./chrome.css";

// ---------------------------------------------------------------------------
// Controls — the chrome's form primitives (spec 6.7, 6.11, 12).
//
// Segmented: one choice from a few (seats 6–12, Bare · White · Black cloth,
// Off · Quiet · Full). A radio group: arrows move the choice and wrap, Home
// and End go to the ends, a choice that is not available says why.
// Stepper: a count with − and + (the caption's seats), a slider to assistive
// technology and the keyboard (spec 12), one tab stop.
// Switch: on or off, its words beside it (Send's "She can change the layout").
// Field: a typed value with its unit ("8.34 m from the fireplace wall"); Enter
// keeps it, Escape puts back what was there, a value it cannot use says why.
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
  /** Not available now; this says why. */
  readonly disabledReason?: string;
}

export interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  readonly className?: string;
}

export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>): ReactElement {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => option.disabledReason === undefined);
  // The one tab stop: the chosen option, or the first that can be chosen.
  const tabStop = enabled.some((option) => option.value === value) ? value : enabled[0]?.value;

  const choose = (next: T): void => {
    if (next !== value) onChange(next);
    refs.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((option) => option.value === value);
    let next: SegmentedOption<T> | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    choose(next.value);
  };

  return (
    <div className={["pc-seg", className ?? ""].filter(Boolean).join(" ")} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const checked = option.value === value;
        const disabled = option.disabledReason !== undefined;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element === null) refs.current.delete(option.value);
              else refs.current.set(option.value, element);
            }}
            type="button"
            role="radio"
            className="pc-seg__option"
            aria-checked={checked}
            aria-disabled={disabled ? true : undefined}
            aria-label={disabled ? keyAccessibleName({ label: option.label, disabledReason: option.disabledReason }) : undefined}
            title={option.disabledReason}
            tabIndex={option.value === tabStop ? 0 : -1}
            onClick={() => {
              if (disabled) return;
              choose(option.value);
            }}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface StepperProps {
  /** What is counted, for the accessible name ("Seats at Table 8"). */
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** The unit set beside the figure ("seats"). */
  readonly unit?: string;
  /** What assistive technology reads for a value ("10 seats"). */
  readonly valueText?: (value: number) => string;
  readonly onChange: (value: number) => void;
  /** Why the count cannot go lower or higher ("6 is the fewest for this table"). */
  readonly minReason?: string;
  readonly maxReason?: string;
  readonly className?: string;
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  valueText,
  onChange,
  minReason,
  maxReason,
  className,
}: StepperProps): ReactElement {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const change = (next: number): void => {
    const clamped = clamp(next);
    if (clamped !== value) onChange(clamped);
  };
  const atMin = value <= min;
  const atMax = value >= max;
  const spoken = valueText?.(value) ?? (unit === undefined ? String(value) : `${String(value)} ${unit}`);
  const fewer = unit === undefined ? "Fewer" : `Fewer ${unit}`;
  const more = unit === undefined ? "More" : `More ${unit}`;

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    let next: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = value + step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = value - step;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    change(next);
  };

  return (
    <div className={["pc-stepper", className ?? ""].filter(Boolean).join(" ")} role="group" aria-label={label}>
      <Key
        label={fewer}
        icon={<Minus className="pc-icon" aria-hidden="true" />}
        iconOnly
        small
        tabIndex={-1}
        disabledReason={atMin ? (minReason ?? `${String(min)} is the fewest`) : undefined}
        onPress={() => { change(value - step); }}
      />
      <span
        className="pc-stepper__value"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={spoken}
        onKeyDown={onKeyDown}
      >
        {value}
      </span>
      <Key
        label={more}
        icon={<Plus className="pc-icon" aria-hidden="true" />}
        iconOnly
        small
        tabIndex={-1}
        disabledReason={atMax ? (maxReason ?? `${String(max)} is the most`) : undefined}
        onPress={() => { change(value + step); }}
      />
      {unit !== undefined ? <span className="pc-stepper__unit" aria-hidden="true">{unit}</span> : null}
    </div>
  );
}

export interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabledReason?: string;
  readonly className?: string;
}

export function Switch({ label, checked, onChange, disabledReason, className }: SwitchProps): ReactElement {
  const id = useId();
  const disabled = disabledReason !== undefined;
  return (
    <div className={["pc-switch-row", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={id}>{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        className="pc-switch"
        aria-checked={checked}
        aria-disabled={disabled ? true : undefined}
        aria-label={disabled ? keyAccessibleName({ label, disabledReason }) : undefined}
        title={disabledReason}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
      />
    </div>
  );
}

export interface FieldProps {
  readonly label: string;
  /** The value as the layout holds it, or null when there is none. */
  readonly value: number | null;
  /** The unit set after the figure ("m", "°", "guests"). */
  readonly unit: string;
  /** Show a value: positions to 0.01 m, aisles to 0.1 m (spec 12). */
  readonly format?: (value: number) => string;
  /** Why a typed value cannot be used, or null when it can. */
  readonly problemFor?: (value: number) => string | null;
  readonly onCommit: (value: number) => void;
  readonly className?: string;
}

/** Reads what a person typed: "8,34", " 8.34 m" and "8.34" are all 8.34. */
export function parseTypedNumber(text: string): number | null {
  const cleaned = text.trim().replace(",", ".").replace(/[^\d.+-]/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "-" || cleaned === "+") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function Field({ label, value, unit, format = (n) => String(n), problemFor, onCommit, className }: FieldProps): ReactElement {
  const id = useId();
  const problemId = useId();
  const shown = value === null ? "" : format(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const text = draft ?? shown;

  const commit = (): boolean => {
    if (draft === null) return true;
    const parsed = parseTypedNumber(draft);
    if (parsed === null) {
      setProblem("Type a number");
      return false;
    }
    const why = problemFor?.(parsed) ?? null;
    if (why !== null) {
      setProblem(why);
      return false;
    }
    setProblem(null);
    setDraft(null);
    if (parsed !== value) onCommit(parsed);
    return true;
  };

  const revert = (): void => {
    setDraft(null);
    setProblem(null);
  };

  return (
    <div className={["pc-field", className ?? ""].filter(Boolean).join(" ")}>
      <label className="pc-field__label" htmlFor={id}>{label}</label>
      <div className="pc-field__well" data-invalid={problem !== null ? "true" : undefined}>
        <input
          id={id}
          className="pc-field__input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          aria-invalid={problem !== null ? true : undefined}
          aria-describedby={problem !== null ? problemId : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
          onBlur={() => {
            // Leaving keeps a value that works; one that does not stays, with its reason.
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape" && (draft !== null || problem !== null)) {
              // This Escape only puts the value back (spec 4.5: a typed value goes first).
              event.preventDefault();
              event.stopPropagation();
              revert();
            }
          }}
        />
        <span className="pc-field__unit" aria-hidden="true">{unit}</span>
      </div>
      {problem !== null ? <span id={problemId} className="pc-field__problem" role="alert">{problem}</span> : null}
    </div>
  );
}
