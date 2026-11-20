import { afterEach, describe, expect, it } from "vitest";
import { canTakeFocus, handKeyboardOn, screenWithKeyboardIn } from "../keyboard-hand-off.js";

// ---------------------------------------------------------------------------
// The keyboard, handed on: the rule itself, without the screen round it. The
// parts that use it (a sheet, the piece's verbs, the first screen, a receipt)
// are held to it in hud-stations.test.tsx, each with its own places.
// ---------------------------------------------------------------------------

const made: HTMLElement[] = [];

function key(words: string, into: HTMLElement = document.body): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = words;
  into.append(button);
  if (into === document.body) made.push(button);
  return button;
}

function box(className: string, into: HTMLElement = document.body): HTMLDivElement {
  const div = document.createElement("div");
  div.className = className;
  into.append(div);
  if (into === document.body) made.push(div);
  return div;
}

/** The hand-off is made a moment after it is asked for: let that moment pass. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Leaves the keyboard nowhere, as a browser does when the key that had it leaves the page. */
function loseTheKeyboard(): void {
  const gone = key("gone");
  gone.focus();
  gone.remove();
}

afterEach(() => {
  for (const one of made.splice(0)) one.remove();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

describe("whether a key can take the keyboard", () => {
  it("can where it is on the page, not put away and not off", () => {
    expect(canTakeFocus(key("Undo"))).toBe(true);
  });

  it("cannot where there is none, or it has left the page, is put away, or is off", () => {
    expect(canTakeFocus(null)).toBe(false);
    const left = key("left");
    left.remove();
    expect(canTakeFocus(left)).toBe(false);
    const away = key("away");
    away.hidden = true;
    expect(canTakeFocus(away)).toBe(false);
    const off = key("off");
    off.disabled = true;
    expect(canTakeFocus(off)).toBe(false);
  });

  it("asks the page whether the key is laid out, where the page can say", () => {
    const folded = key("folded");
    // As a browser answers for a key inside something not displayed (a step the phone's bar has folded away).
    Object.defineProperty(folded, "checkVisibility", { configurable: true, value: () => false });
    expect(canTakeFocus(folded)).toBe(false);
    const shown = key("shown");
    Object.defineProperty(shown, "checkVisibility", { configurable: true, value: () => true });
    expect(canTakeFocus(shown)).toBe(true);
  });
});

describe("handing the keyboard on", () => {
  it("gives it to the first place that can take it, a moment after it is asked", async () => {
    const off = key("off");
    off.disabled = true;
    const away = key("away");
    away.hidden = true;
    const first = key("first");
    const second = key("second");
    loseTheKeyboard();
    handKeyboardOn(() => [null, off, away, first, second]);
    // Not yet: the screen settles first (a place may only then be back on the page).
    expect(document.activeElement).not.toBe(first);
    await settled();
    expect(document.activeElement).toBe(first);
  });

  it("reads its places only when its moment comes, so one that has just come back can be given", async () => {
    let back: HTMLElement | null = null;
    loseTheKeyboard();
    handKeyboardOn(() => [back]);
    back = key("back on the page");
    await settled();
    expect(document.activeElement).toBe(back);
  });

  it("asks the next place where a browser refuses one that looked able", async () => {
    const refuses = key("made unseen by a rule this cannot read");
    refuses.focus = (): void => undefined;
    const takes = key("takes it");
    loseTheKeyboard();
    handKeyboardOn(() => [refuses, takes]);
    await settled();
    expect(document.activeElement).toBe(takes);
  });

  it("leaves the keyboard where it is when it is somewhere", async () => {
    const somewhere = key("somewhere");
    const place = key("a place");
    somewhere.focus();
    handKeyboardOn(() => [place]);
    await settled();
    expect(document.activeElement).toBe(somewhere);
  });

  it("gives it to nothing where no place can take it, and throws nothing", async () => {
    const off = key("off");
    off.disabled = true;
    loseTheKeyboard();
    handKeyboardOn(() => [null, off]);
    await settled();
    expect(document.activeElement).not.toBe(off);
  });

  it("lets the later of two asks decide, where the second comes before the first one's moment", async () => {
    const firstsPlace = key("the first part's place");
    const secondsPlace = key("the second part's place");
    loseTheKeyboard();
    handKeyboardOn(() => [firstsPlace]);
    handKeyboardOn(() => [secondsPlace]);
    await settled();
    expect(document.activeElement).toBe(secondsPlace);
  });

  it("is each ask's own once the one before it has had its moment", async () => {
    const one = key("one");
    const two = key("two");
    loseTheKeyboard();
    handKeyboardOn(() => [one]);
    await settled();
    expect(document.activeElement).toBe(one);
    one.remove();
    handKeyboardOn(() => [two]);
    await settled();
    expect(document.activeElement).toBe(two);
  });
});

describe("the screen a part stands on, while the keyboard is in the part", () => {
  it("is the screen where the keyboard is in the part, and nothing where it is not", () => {
    const screen = box("hud-root");
    const part = box("hud-piece", screen);
    const inside = key("Put back", part);
    const outside = key("Undo", screen);
    inside.focus();
    expect(screenWithKeyboardIn(part)).toBe(screen);
    outside.focus();
    expect(screenWithKeyboardIn(part)).toBeNull();
  });

  it("is nothing for a part that stands on no screen", () => {
    const part = box("hud-piece");
    const inside = key("Put back", part);
    inside.focus();
    expect(screenWithKeyboardIn(part)).toBeNull();
  });
});
