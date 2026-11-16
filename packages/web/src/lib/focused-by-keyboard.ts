/**
 * Whether focus arrived from the keyboard, as the browser's own :focus-visible
 * judges it: a Tab or an arrow key says yes, a click says no. A tooltip shows
 * for the first and not the second. An engine without :focus-visible says no.
 */
export function focusedByKeyboard(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}
