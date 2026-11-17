import { isInaccessible, screen } from "@testing-library/react";
import { expect } from "vitest";

// ---------------------------------------------------------------------------
// The public enquiry forms' hidden trap, as a person meets it: not at all.
//
// Blake, 12 November 2026: an off-screen field, aria-hidden, tabindex -1 and
// autocomplete off, on the walkthrough's, the planner's and the front door's
// forms. A script that fills every field fills it; a person never reaches it,
// by eye, by keyboard or by screen reader, and no autofill or password
// manager puts anything in it.
// ---------------------------------------------------------------------------

/** Words autofill and password managers read in a field's name, id, label or
 *  placeholder to decide what to put in it (Chromium's and Firefox's address,
 *  payment and login heuristics, and the identity fields of the common
 *  password managers). The trap's attributes carry none of them. */
const AUTOFILL_READS = /name|mail|phone|tel|mobile|company|org|address|addr|street|city|town|zip|post|country|region|url|web|site|home|user|login|account|pass|card|cc|cvc|exp|search|title|first|last|birth|code|ext|unit|apt|flat|house/iu;

/** The form's one field that no person can perceive. */
export function hiddenTrapIn(form: HTMLElement): HTMLInputElement {
  const unseen = [...form.querySelectorAll("input")].filter((input) => isInaccessible(input));
  expect(unseen, "the form has exactly one field no person can perceive").toHaveLength(1);
  const [trap] = unseen;
  if (trap === undefined) throw new Error("No hidden trap in the form");
  return trap;
}

/** The elements a keyboard reaches with Tab, as a browser orders them: any
 *  enabled control or link whose tabIndex is not negative. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href], [tabindex]")]
    .filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));
}

/**
 * The trap is out of every person's reach and every filler's: off screen but
 * displayed (a script that skips display:none and visibility:hidden fields
 * still fills it), out of the tab order and the accessibility tree, with
 * autocomplete off, no label, and nothing in its attributes that autofill or
 * a password manager reads as a field it knows.
 */
export function expectOutOfReach(trap: HTMLInputElement, form: HTMLElement): void {
  expect(trap.type).toBe("text");
  // Out of the accessibility tree: a screen reader never meets it.
  expect(isInaccessible(trap)).toBe(true);
  expect(screen.queryAllByRole("textbox")).not.toContain(trap);
  expect(screen.queryAllByRole("textbox", { hidden: true }), "hidden from the tree, not removed from the page").toContain(trap);
  // Out of the tab order: a keyboard never lands on it.
  expect(trap.tabIndex).toBe(-1);
  expect(tabbable(form)).not.toContain(trap);
  expect(tabbable(document.body)).not.toContain(trap);
  // Off screen, yet displayed.
  const box = trap.closest<HTMLElement>("[aria-hidden='true']");
  expect(box, "an aria-hidden box holds it").not.toBeNull();
  expect({ position: box?.style.position, left: box?.style.left }).toEqual({ position: "absolute", left: "-10000px" });
  for (let node: HTMLElement | null = trap; node !== null; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    expect(style.display, "display:none is skipped by some scripts").not.toBe("none");
    expect(style.visibility, "visibility:hidden is skipped by some scripts").not.toBe("hidden");
  }
  // Nothing an autofill or a password manager fills.
  expect(trap.getAttribute("autocomplete")).toBe("off");
  expect(trap.labels?.length ?? 0, "no label names it").toBe(0);
  for (const attribute of ["name", "id", "placeholder", "aria-label", "title"]) {
    expect(trap.getAttribute(attribute) ?? "", attribute).not.toMatch(AUTOFILL_READS);
  }
}
