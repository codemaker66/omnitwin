import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EnquiryTrapField } from "../components/shared/EnquiryTrap.js";
import { unnamedControlsInPage, visibleControlsInPage } from "../test/in-page-controls.js";

// ---------------------------------------------------------------------------
// The browser audits' rule for a control no person can reach (review of #438).
//
// Two end-to-end audits read every control a page draws: one reports those
// with no accessible name, the other asks each a name, a real address and a
// usable size. The public enquiry forms carry a hidden field against scripts,
// which no person reaches, and the audits must not ask it for a name: a label
// or a title on it is exactly what autofill reads.
//
// A control is passed over only when three things hold together: an ancestor
// hides it from assistive technology (aria-hidden), it is out of the tab order
// (a negative tabIndex), and it is drawn wholly left of or above the page's
// origin, where no scroll reaches. Any one alone is a defect the audits must
// keep reporting: an aria-hidden, untabbable control drawn on the page can
// still be clicked by a person who sees it.
//
// These are the audits' own functions, the same ones the end-to-end runs send
// to the page. happy-dom lays nothing out, so each control is given the box a
// browser would draw for it, in page coordinates; nothing else is stood in.
// ---------------------------------------------------------------------------

/** The box a browser would draw for an element, by its left and top on the page. */
function drawnAt(element: Element, left: number, top: number, width = 194, height = 30): void {
  const box = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: (): object => ({}) };
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => box });
}

function scrolledTo(x: number, y: number): void {
  Object.defineProperty(window, "scrollX", { configurable: true, value: x });
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

/** One control built from markup, drawn at a place on the page. */
function control(markup: string, left: number, top: number): Element {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  document.body.append(holder);
  const made = holder.querySelector("input, button");
  if (made === null) throw new Error("No control in the markup");
  drawnAt(made, left, top);
  return made;
}

/** What each audit says of the page: the tags of the controls with no name, and of every control it reads. */
function audited(): { readonly unnamed: readonly string[]; readonly read: readonly string[] } {
  return {
    unnamed: unnamedControlsInPage().map((issue) => issue.tagName),
    read: visibleControlsInPage().map((snapshot) => `${snapshot.tagName} "${snapshot.label}"`),
  };
}

describe("the browser audits and a control no person can reach", () => {
  beforeEach(() => {
    // What every browser computes for a control that sets no opacity.
    const style = document.createElement("style");
    style.textContent = "input, button { opacity: 1; }";
    document.head.append(style);
    scrolledTo(0, 0);
    // A named control, so that a page with nothing else to report still has one control to read.
    control('<button type="button" tabindex="0">Send enquiry</button>', 40, 400);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    scrolledTo(0, 0);
  });

  it("passes over the enquiry forms' hidden field: hidden from assistive technology, out of the tab order and drawn off the page", () => {
    const { container } = render(<EnquiryTrapField inputRef={createRef<HTMLInputElement>()} />);
    const field = container.querySelector("input");
    if (field === null) throw new Error("No hidden field");
    // Where a browser draws it: the box holding it sits 10,000 px left of the form.
    drawnAt(field, -10000, 300);
    expect(audited()).toEqual({ unnamed: [], read: ['button "Send enquiry"'] });
  });

  it("still reports an aria-hidden, untabbable control that is drawn on the page, where a person who sees it can click it", () => {
    control('<div aria-hidden="true"><button type="button" tabindex="-1"></button></div>', 40, 40);
    expect(audited()).toEqual({ unnamed: ["button"], read: ['button "Send enquiry"', 'button ""'] });
  });

  it("still reports a control drawn off to the left that nothing hides from assistive technology", () => {
    control('<input type="text" tabindex="-1">', -10000, 300);
    expect(audited()).toEqual({ unnamed: ["input"], read: ['button "Send enquiry"', 'input ""'] });
  });

  it("still reports a hidden control drawn off the page that the keyboard can land on", () => {
    control('<div aria-hidden="true"><input type="text" tabindex="0"></div>', -10000, 300);
    expect(audited()).toEqual({ unnamed: ["input"], read: ['button "Send enquiry"', 'input ""'] });
  });

  it("measures on the page, not in the window: a control scrolled out of sight to the left or above is still on the page", () => {
    // The page is scrolled 500 px right and down; these boxes are in the window's coordinates.
    scrolledTo(500, 500);
    control('<div aria-hidden="true"><input type="text" tabindex="-1"></div>', -300, 40);
    control('<div aria-hidden="true"><button type="button" tabindex="-1"></button></div>', 40, -300);
    expect(audited().unnamed).toEqual(["input", "button"]);
  });

  it("passes over a hidden, untabbable control drawn wholly above the page as it does one to the left", () => {
    control('<div aria-hidden="true"><input type="text" tabindex="-1"></div>', 40, -10000);
    expect(audited()).toEqual({ unnamed: [], read: ['button "Send enquiry"'] });
  });
});
