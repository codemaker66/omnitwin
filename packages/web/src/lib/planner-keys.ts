import { useEffect, useRef, type RefObject } from "react";
import { isLayoutTimelineMutationLocked } from "./layout-timeline-preview-lock.js";

// ---------------------------------------------------------------------------
// The planner's one keyboard owner (spec 4.5 and 11; T-671 slice 5).
//
// One keydown listener on the window answers every planner shortcut and every
// Escape; before it, twenty-two handlers each listened for themselves, so one
// Escape could cancel the placing and clear the selection at once, and Q and
// E could turn a held selection and the piece in hand together.
//
// Shortcuts are bindings: a chord with an exact modifier policy (M is not
// Shift M; Ctrl and Cmd are one key), a priority, and a condition. One press
// does one thing: the highest-priority binding whose condition holds runs,
// and the key is spent.
//
// Escape walks one stack of layers in a fixed order: a dialog that holds the
// keyboard, then the operation in progress (placing, measuring, drawing, a
// held hour, a typed value, Present), then the open popover, then the open
// panel (focus goes back to the key that opened it), then the selection. One
// press steps back exactly one layer. Esc never leaves Walk or the planner.
//
// The listener sits in the bubble phase and leaves any press a focused widget
// has already claimed (a slider's arrows, a field's own Enter), and it only
// listens while something is registered, so a page outside the planner that
// borrows a layer (the sign-in dialog) gets the same order for free.
// ---------------------------------------------------------------------------

/**
 * What Escape steps back from, in the order it does so. A tooltip on screen
 * goes first and alone (WCAG 1.4.13: it can be dismissed without moving the
 * pointer or focus, and that press does nothing else).
 */
export type EscapeLayerKind = "tooltip" | "modal" | "operation" | "popover" | "panel" | "selection";

export const ESCAPE_ORDER: readonly EscapeLayerKind[] = ["tooltip", "modal", "operation", "popover", "panel", "selection"];

export interface EscapeLayer {
  readonly kind: EscapeLayerKind;
  /** Whether it has anything to step back from, read at the moment of the press. */
  readonly isOpen: () => boolean;
  /** Steps back exactly this one layer. */
  readonly escape: () => void;
  /** The key that opened it, which takes focus back once it has closed. */
  readonly returnFocusTo?: () => HTMLElement | null;
}

/**
 * One chord. Letters, digits, arrows and named keys match by `code` (where the
 * key sits); symbols match by `key` (the character typed, + or [).
 * Modifiers must match exactly unless a chord says "any": `mod` is Ctrl or
 * Cmd. A symbol's Shift is part of typing it, so `key` chords take any Shift.
 */
export interface KeyChord {
  readonly code?: string;
  readonly key?: string;
  readonly mod?: boolean;
  readonly shift?: boolean | "any";
  readonly alt?: boolean | "any";
}

interface ChordModifiers {
  readonly mod?: boolean;
  readonly alt?: boolean | "any";
}

/**
 * A mnemonic letter (M for Measure, Ctrl Z for undo) by the letter typed, so
 * it is the same key on any layout; Caps Lock or not, and never with Shift,
 * which makes another chord (Shift M is not M).
 */
export function letter(char: string, modifiers: ChordModifiers = {}): KeyChord[] {
  const lower = char.toLowerCase();
  return [lower, lower.toUpperCase()].map((key) => ({ key, shift: false, ...modifiers }));
}

/** The same letter with Shift held. */
export function shiftedLetter(char: string, modifiers: ChordModifiers = {}): KeyChord[] {
  const lower = char.toLowerCase();
  return [lower, lower.toUpperCase()].map((key) => ({ key, shift: true, ...modifiers }));
}

export interface KeyBinding {
  /** Any of these chords runs it. */
  readonly keys: readonly KeyChord[];
  /** Does the thing. Returning false (and only false) declines, and the next binding is tried. */
  readonly run: (event: KeyboardEvent) => unknown;
  /** Whether it applies right now. */
  readonly when?: () => boolean;
  /** Higher runs first; ties go to the most recently registered. */
  readonly priority?: number;
  /** Runs again while the key is held (nudges, walking). Off by default. */
  readonly repeat?: boolean;
  /** Runs while a text field has focus. Off by default: typing must type. */
  readonly inFields?: boolean;
  /** Runs while a dialog holds the keyboard (the dialog's own keys). */
  readonly duringModal?: boolean;
  /** Changes the layout, so an act's previewed layout swallows it. */
  readonly mutates?: boolean;
  /** For held keys: called with the keyup of one of its keys, and with null when the window loses focus. */
  readonly release?: (event: KeyboardEvent | null) => void;
}

/**
 * Priorities, highest first: walking (in Walk only), the pen's own undo, the
 * piece in hand, the selection, everything else.
 */
export const KEY_PRIORITY = {
  walk: 40,
  pen: 30,
  placing: 20,
  selection: 10,
  planner: 0,
} as const;

interface Registered<T> {
  readonly seq: number;
  readonly value: T;
}

const layers = new Set<Registered<EscapeLayer>>();
const bindings = new Set<Registered<KeyBinding>>();
let nextSeq = 0;
let listening = false;

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);
const ARROW_ROLES = "[role='slider'], [role='spinbutton'], [role='radiogroup'], [role='radio'], [role='tablist'], [role='tab'], [role='menu'], [role='menubar'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='listbox'], [role='option'], [role='grid'], [role='tree'], [role='toolbar'], [data-keys-own-arrows='true']";
const ACTIVATES_ON_KEYS = "button, a[href], summary, [role='button'], [role='link'], [role='checkbox'], [role='switch'], [role='menuitem'], [role='option'], [role='tab'], [role='radio'], input[type='checkbox'], input[type='radio'], input[type='button'], input[type='submit'], input[type='reset']";

/** Where keys type text: a key pressed here belongs to the text. */
export function typesText(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return target.getAttribute("role") === "textbox";
}

/** What the last pointer press landed on; Tab forgets it (keyboard navigation took over). */
let lastPointerPress: Node | null = null;

/** Whether the person's last input was a key press (true) or the pointer (false). */
let lastInputKeys = false;

/**
 * Whether the last thing the person did was press a key: motion that answers
 * the keyboard is instant (spec 8; a figure the keys changed does not roll).
 */
export function lastInputWasKeys(): boolean {
  return lastInputKeys;
}

/**
 * Widgets that move with the arrows themselves: a slider, a radio group, a
 * menu, a toolbar's keys. A key someone pressed with the pointer gives the
 * arrows back to the room, so a click on the dock or the pill leaves the
 * arrows nudging and panning (F-21); native sliders and fields keep theirs.
 */
function usesArrows(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement && (target.type === "range" || target.type === "radio")) return true;
  if (target.closest(ARROW_ROLES) === null) return false;
  return !(lastPointerPress !== null && target.contains(lastPointerPress) && activatesOnKeys(target));
}

/** Whether the focused element keeps the arrow keys (text fields and arrow widgets do). */
export function focusOwnsArrows(target: EventTarget | null): boolean {
  return typesText(target) || usesArrows(target);
}

/** Controls that a press of Space or Enter activates. */
function activatesOnKeys(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest(ACTIVATES_ON_KEYS) !== null;
}

const ARROW_CODES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const ACTIVATING_CODES = new Set(["Space", "Enter", "NumpadEnter"]);

/** Whether the focused element already owns this key, so the planner leaves it alone. */
function focusOwnsKey(event: KeyboardEvent, binding: KeyBinding): boolean {
  const target = event.target;
  if (typesText(target)) return binding.inFields !== true;
  if (ARROW_CODES.has(event.code) && usesArrows(target)) return true;
  return ACTIVATING_CODES.has(event.code) && activatesOnKeys(target);
}

function modifierMatches(want: boolean | "any" | undefined, pressed: boolean, fallback: boolean | "any"): boolean {
  const expected = want ?? fallback;
  return expected === "any" || expected === pressed;
}

function chordMatches(chord: KeyChord, event: KeyboardEvent): boolean {
  if (chord.code === undefined && chord.key === undefined) return false;
  if (chord.code !== undefined && chord.code !== event.code) return false;
  if (chord.key !== undefined && chord.key !== event.key) return false;
  if ((chord.mod ?? false) !== (event.ctrlKey || event.metaKey)) return false;
  if (!modifierMatches(chord.shift, event.shiftKey, chord.key !== undefined ? "any" : false)) return false;
  return modifierMatches(chord.alt, event.altKey, false);
}

function byPrecedence<T>(rank: (value: T) => number): (a: Registered<T>, b: Registered<T>) => number {
  return (a, b) => rank(a.value) - rank(b.value) || b.seq - a.seq;
}

function openLayers(): Registered<EscapeLayer>[] {
  return [...layers]
    .filter((entry) => entry.value.isOpen())
    .sort(byPrecedence((layer) => ESCAPE_ORDER.indexOf(layer.kind)));
}

function aDialogHoldsTheKeyboard(): boolean {
  for (const entry of layers) {
    if (entry.value.kind === "modal" && entry.value.isOpen()) return true;
  }
  return false;
}

function stepBack(event: KeyboardEvent): void {
  if (event.repeat) return;
  // An open native <dialog> closes on Escape by the browser's own default
  // action (the arrival's welcome); claiming the press would keep it open.
  if (event.target instanceof Element && event.target.closest("dialog[open]") !== null) return;
  const top = openLayers()[0];
  if (top === undefined) return;
  event.preventDefault();
  top.value.escape();
  const trigger = top.value.returnFocusTo?.() ?? null;
  if (trigger?.isConnected === true) trigger.focus({ preventScroll: true });
}

function runShortcut(event: KeyboardEvent): void {
  const modal = aDialogHoldsTheKeyboard();
  const candidates = [...bindings]
    .filter(({ value }) => value.keys.some((chord) => chordMatches(chord, event)))
    .sort(byPrecedence((binding) => -(binding.priority ?? 0)));
  for (const { value: binding } of candidates) {
    if (event.repeat && binding.repeat !== true) continue;
    if (modal && binding.duringModal !== true) continue;
    if (focusOwnsKey(event, binding)) continue;
    if (binding.when !== undefined && !binding.when()) continue;
    if (binding.mutates === true && isLayoutTimelineMutationLocked()) {
      event.preventDefault();
      return;
    }
    if (binding.run(event) === false) continue;
    event.preventDefault();
    return;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  lastInputKeys = true;
  if (event.code === "Tab" || event.key === "Tab") lastPointerPress = null;
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === "Escape" || event.code === "Escape") {
    stepBack(event);
    return;
  }
  runShortcut(event);
}

function onPointerDown(event: PointerEvent): void {
  lastInputKeys = false;
  lastPointerPress = event.target instanceof Node ? event.target : null;
}

/** Whether a keyup lets go of this chord's key (Shift may have changed the character since). */
function releases(chord: KeyChord, event: KeyboardEvent): boolean {
  if (chord.code !== undefined) return chord.code === event.code;
  return chord.key !== undefined && chord.key.toLowerCase() === event.key.toLowerCase();
}

function onKeyUp(event: KeyboardEvent): void {
  for (const { value: binding } of bindings) {
    if (binding.release === undefined) continue;
    if (binding.keys.some((chord) => releases(chord, event))) binding.release(event);
  }
}

function onBlur(): void {
  for (const { value: binding } of bindings) binding.release?.(null);
}

function syncListener(): void {
  if (typeof window === "undefined") return;
  const wanted = layers.size > 0 || bindings.size > 0;
  if (wanted === listening) return;
  listening = wanted;
  if (wanted) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown, true);
  } else {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("pointerdown", onPointerDown, true);
    lastPointerPress = null;
    lastInputKeys = false;
  }
}

/** Whether the one listener is on the window (for tests). */
export function hasPlannerKeyListener(): boolean {
  return listening;
}

/** Adds a layer to the Escape stack until the returned function removes it. */
export function registerEscapeLayer(layer: EscapeLayer): () => void {
  const entry: Registered<EscapeLayer> = { seq: nextSeq++, value: layer };
  layers.add(entry);
  syncListener();
  return () => {
    layers.delete(entry);
    syncListener();
  };
}

/** Adds bindings to the keymap until the returned function removes them. */
export function registerKeyBindings(list: readonly KeyBinding[]): () => void {
  const entries = list.map((value): Registered<KeyBinding> => ({ seq: nextSeq++, value }));
  for (const entry of entries) bindings.add(entry);
  syncListener();
  return () => {
    for (const entry of entries) bindings.delete(entry);
    syncListener();
  };
}

export interface EscapeLayerOptions {
  /** Open now: a flag from React state, or a reading of a store at the press. */
  readonly open: boolean | (() => boolean);
  readonly onEscape: () => void;
  /** The key that opened it. */
  readonly returnFocusTo?: RefObject<HTMLElement | null> | (() => HTMLElement | null);
}

/** Holds a layer in the Escape stack while the component is mounted. */
export function useEscapeLayer(kind: EscapeLayerKind, options: EscapeLayerOptions): void {
  const latest = useRef(options);
  latest.current = options;
  // A layer that is plainly shut is not registered at all, so the most
  // recently opened of a kind is also the most recently registered.
  const registered = typeof options.open === "function" || options.open;
  useEffect(() => {
    if (!registered) return;
    return registerEscapeLayer({
      kind,
      isOpen: () => {
        const { open } = latest.current;
        return typeof open === "function" ? open() : open;
      },
      escape: () => { latest.current.onEscape(); },
      returnFocusTo: () => {
        const target = latest.current.returnFocusTo;
        if (target === undefined) return null;
        return typeof target === "function" ? target() : target.current;
      },
    });
  }, [kind, registered]);
}

/** What makes two lists of bindings different keymaps (not just new closures). */
function keymapSignature(list: readonly KeyBinding[]): string {
  return JSON.stringify(list.map((binding) => [
    binding.keys,
    binding.priority ?? 0,
    binding.repeat === true,
    binding.inFields === true,
    binding.duringModal === true,
    binding.mutates === true,
    binding.when !== undefined,
    binding.release !== undefined,
  ]));
}

/**
 * Holds bindings in the keymap while the component is mounted. Each binding
 * calls the latest render's closures through a ref, so the keymap changes
 * only when the keys themselves do, not on every render.
 */
export function usePlannerKeyBindings(list: readonly KeyBinding[]): void {
  const latest = useRef(list);
  latest.current = list;
  const signature = keymapSignature(list);
  useEffect(() => {
    const proxies = latest.current.map((initial, index): KeyBinding => {
      const at = (): KeyBinding | undefined => latest.current[index];
      return {
        ...initial,
        run: (event) => at()?.run(event),
        when: initial.when === undefined ? undefined : () => at()?.when?.() ?? false,
        release: initial.release === undefined ? undefined : (event) => { at()?.release?.(event); },
      };
    });
    return registerKeyBindings(proxies);
  }, [signature]);
}
