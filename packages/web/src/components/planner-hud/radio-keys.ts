import type { KeyboardEvent } from "react";

// ---------------------------------------------------------------------------
// The keyboard's way round a group of choices
//
// A group that says it is a radio group (role="radiogroup") is expected to
// work as one: a single stop in the Tab order, and the arrow keys go to the
// next choice and choose it; Home and End go to the ends. A screen reader's
// user is told "radio button, 2 of 3" and reaches for the arrows.
//
// The group puts onRadioGroupKeyDown on its own element and gives each choice
// radioTabIndex. A choice that cannot be taken now (aria-disabled) is still
// stopped at, so its reason can be read, and is not chosen. The planner's own
// keys already leave the arrows to a radio (lib/planner-keys.ts).
// ---------------------------------------------------------------------------

const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The arrow keys, Home and End, for the element that holds the group's radios. */
export function onRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const step = STEP[event.key];
  if (step === undefined && event.key !== "Home" && event.key !== "End") return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
    .filter((radio) => !(radio instanceof HTMLButtonElement && radio.disabled));
  if (radios.length === 0) return;
  const at = radios.findIndex((radio) => radio === document.activeElement);
  const to = event.key === "Home" ? 0
    : event.key === "End" ? radios.length - 1
      : (Math.max(at, 0) + (step ?? 0) + radios.length) % radios.length;
  const next = radios[to];
  if (next === undefined) return;
  // The page does not scroll, and nothing else takes the key.
  event.preventDefault();
  event.stopPropagation();
  next.focus({ preventScroll: true });
  if (next.getAttribute("aria-disabled") !== "true" && next.getAttribute("aria-checked") !== "true") next.click();
}

/**
 * A choice's place in the Tab order: the chosen one is the group's one stop,
 * or its first choice where nothing is chosen yet.
 */
export function radioTabIndex(checked: boolean, isFirst: boolean, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && isFirst) ? 0 : -1;
}
