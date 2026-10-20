import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { useSpringValue } from "../../lib/use-spring-value.js";
import { useTooltip, type TooltipSide } from "./Tooltip.js";
import "./chrome.css";

// ---------------------------------------------------------------------------
// Keys — every button on lacquer (spec 7.3, 8).
//
// Key: a text or icon key. Its on state is a cream wash; a row of keys draws
// one copper underline that slides between them on `detent` (KeyRow), and a
// key on its own may carry its own. A key that cannot act stays where it is,
// dimmed, and says why in its tooltip and its accessible name (law 3; copy
// rule 6). Keys name their shortcut in the tooltip and the accessible name,
// never on the key at rest.
//
// CreamKey: the one primary (the next step). QuietKey: secondary actions in
// panels. Hovers are colour, presses a small press-down (chrome.css).
// ---------------------------------------------------------------------------

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "style" | "children" | "aria-label" | "disabled" | "onClick" | "type" | "className"
>;

/** The words a person hears for a key: what it does, its keys, or why it cannot. */
export function keyAccessibleName(input: {
  readonly label: string;
  readonly tip?: string;
  readonly shortcut?: readonly string[];
  readonly disabledReason?: string;
}): string {
  const base = input.tip ?? input.label;
  if (input.disabledReason !== undefined) return `${base}: ${input.disabledReason}`;
  if (input.shortcut !== undefined && input.shortcut.length > 0) return `${base}, ${input.shortcut.join(" ")}`;
  return base;
}

const ARIA_KEY_NAMES: Readonly<Record<string, string>> = {
  Ctrl: "Control",
  Cmd: "Meta",
  Esc: "Escape",
  Del: "Delete",
};

/** A chord as aria-keyshortcuts writes it: ["Ctrl", "D"] → "Control+D". */
export function ariaKeyShortcut(shortcut: readonly string[]): string {
  return shortcut.map((key) => ARIA_KEY_NAMES[key] ?? key).join("+");
}

export interface KeyProps extends NativeButtonProps {
  /** What the key says, or (icon only) what it is called. */
  readonly label: string;
  /** A 16 px icon (Lucide, 1.5 stroke). */
  readonly icon?: ReactNode;
  /** Icon only: the label becomes the tooltip and the accessible name. */
  readonly iconOnly?: boolean;
  /** The on state: a cream wash. */
  readonly on?: boolean;
  /** Draw this key's own underline when it is on (outside a KeyRow). */
  readonly marked?: boolean;
  /** A tool that stays on: aria-pressed follows `on`. */
  readonly toggle?: boolean;
  /** One of a radio group: role radio, aria-checked follows `on`. */
  readonly radio?: boolean;
  /** What the tooltip and accessible name say when it differs from the label ("Undo Move Table 8"). */
  readonly tip?: string;
  /** The keys that do the same ("Ctrl", "D"). */
  readonly shortcut?: readonly string[];
  /** The key cannot act now; this says why ("Nothing to undo yet"). */
  readonly disabledReason?: string;
  /** 36 px (utilities, panels, the caption) rather than the dock's 40. */
  readonly small?: boolean;
  readonly tooltipSide?: TooltipSide;
  /** Show the tooltip without the first delay. */
  readonly tooltipImmediate?: boolean;
  /** Something after the words: a chevron for a menu key. */
  readonly trailing?: ReactNode;
  /** This key's id in its KeyRow, for the sliding underline. */
  readonly rowKey?: string;
  readonly className?: string;
  readonly onPress?: () => void;
}

export const Key = forwardRef<HTMLButtonElement, KeyProps>(function Key(
  {
    label,
    icon,
    iconOnly = false,
    on = false,
    marked = false,
    toggle = false,
    radio = false,
    tip,
    shortcut,
    disabledReason,
    small = false,
    tooltipSide = "above",
    tooltipImmediate = false,
    trailing,
    rowKey,
    className,
    onPress,
    ...rest
  },
  ref,
): ReactElement {
  const disabled = disabledReason !== undefined;
  const name = keyAccessibleName({ label, tip, shortcut, disabledReason });
  const showsTooltip = iconOnly || disabled || tip !== undefined || (shortcut !== undefined && shortcut.length > 0);
  const tooltip = useTooltip({
    text: showsTooltip ? (disabled ? disabledReason : (tip ?? label)) : null,
    keys: disabled ? undefined : shortcut,
    side: tooltipSide,
    immediate: tooltipImmediate,
  });
  const classes = [
    "pc-key",
    iconOnly ? "pc-key--icon" : "",
    small ? "pc-key--small" : "",
    on ? "is-on" : "",
    on && marked ? "is-marked" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onPress?.();
  };
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={classes}
      role={radio ? "radio" : rest.role}
      aria-checked={radio ? on : undefined}
      aria-pressed={toggle && !radio ? on : undefined}
      aria-disabled={disabled ? true : undefined}
      aria-label={iconOnly || name !== label ? name : undefined}
      aria-keyshortcuts={!disabled && shortcut !== undefined && shortcut.length > 0 ? ariaKeyShortcut(shortcut) : undefined}
      data-pc-key={rowKey}
      onClick={onClick}
      {...tooltip}
    >
      {icon}
      {iconOnly ? null : <span>{label}</span>}
      {trailing !== undefined ? <span className="pc-key__trail" aria-hidden="true">{trailing}</span> : null}
    </button>
  );
});

export interface CreamKeyProps extends NativeButtonProps {
  readonly label: string;
  readonly icon?: ReactNode;
  /** Offline: the key waits, outlined, with its reason beside it. */
  readonly waiting?: boolean;
  /** 44 px for touch. */
  readonly touch?: boolean;
  readonly disabledReason?: string;
  readonly className?: string;
  readonly onPress?: () => void;
}

export const CreamKey = forwardRef<HTMLButtonElement, CreamKeyProps>(function CreamKey(
  { label, icon, waiting = false, touch = false, disabledReason, className, onPress, ...rest },
  ref,
): ReactElement {
  const disabled = disabledReason !== undefined;
  const classes = ["pc-cream", waiting ? "pc-cream--wait" : "", touch ? "pc-cream--touch" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={classes}
      aria-disabled={disabled ? true : undefined}
      aria-label={disabled ? keyAccessibleName({ label, disabledReason }) : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onPress?.();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

export interface QuietKeyProps extends NativeButtonProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabledReason?: string;
  readonly className?: string;
  readonly onPress?: () => void;
}

export const QuietKey = forwardRef<HTMLButtonElement, QuietKeyProps>(function QuietKey(
  { label, icon, disabledReason, className, onPress, ...rest },
  ref,
): ReactElement {
  const disabled = disabledReason !== undefined;
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={["pc-quiet", className ?? ""].filter(Boolean).join(" ")}
      aria-disabled={disabled ? true : undefined}
      aria-label={disabled ? keyAccessibleName({ label, disabledReason }) : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onPress?.();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

interface UnderlineGeometry {
  readonly x: number;
  readonly w: number;
}

/** Where the underline sits under a key: inside its padding, or 12 px in on an icon key. */
function underlineUnder(key: HTMLElement): UnderlineGeometry {
  const style = window.getComputedStyle(key);
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  const padRight = Number.parseFloat(style.paddingRight) || 0;
  const iconKey = padLeft === 0 && padRight === 0;
  const insetLeft = iconKey ? 12 : padLeft;
  const insetRight = iconKey ? 12 : padRight;
  return { x: key.offsetLeft + insetLeft, w: Math.max(0, key.offsetWidth - insetLeft - insetRight) };
}

export interface KeyRowProps {
  readonly role: "radiogroup" | "group" | "toolbar";
  readonly label: string;
  /** The key (by `rowKey`) the underline sits under, or none. */
  readonly activeKey: string | null;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A row of keys with one copper underline that slides to the active key on
 * `detent` (spec 6.3, 8). It appears in place the first time, follows on the
 * spring after, and is set directly under reduced motion and on a resize.
 */
export function KeyRow({ role, label, activeKey, children, className }: KeyRowProps): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = useState<UnderlineGeometry | null>(null);
  const [instant, setInstant] = useState(true);
  const shownBefore = useRef(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    const measure = (fromResize: boolean): void => {
      const key = activeKey === null
        ? undefined
        : Array.from(row.querySelectorAll<HTMLElement>("[data-pc-key]")).find((element) => element.dataset.pcKey === activeKey);
      if (key === undefined) {
        setGeometry(null);
        return;
      }
      // The first time it shows, and after a resize, it is simply there.
      setInstant(fromResize || !shownBefore.current);
      shownBefore.current = true;
      setGeometry(underlineUnder(key));
    };
    measure(false);
    if (typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      measure(true);
    });
    observer.observe(row);
    return () => { observer.disconnect(); };
  }, [activeKey]);

  useSpringValue(geometry?.x ?? 0, SPRING_PRESETS.detent, (value) => {
    lineRef.current?.style.setProperty("--pc-underline-x", `${String(Math.round(value * 100) / 100)}px`);
  }, { instant, epsilon: 0.05 });
  useSpringValue(geometry?.w ?? 0, SPRING_PRESETS.detent, (value) => {
    lineRef.current?.style.setProperty("--pc-underline-w", String(Math.round(value * 100) / 100));
  }, { instant, epsilon: 0.05 });

  return (
    <div ref={rowRef} className={["pc-keyrow", className ?? ""].filter(Boolean).join(" ")} role={role} aria-label={label}>
      {children}
      <span ref={lineRef} className={`pc-underline${geometry !== null ? " is-shown" : ""}`} aria-hidden="true" />
    </div>
  );
}

/** A thin rule between groups of keys. */
export function KeySeparator(): ReactElement {
  return <span className="pc-vsep" aria-hidden="true" />;
}
