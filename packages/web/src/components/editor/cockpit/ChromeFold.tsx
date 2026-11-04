import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactElement } from "react";
import { Building2 } from "lucide-react";
import { KEY_PRIORITY, useEscapeLayer, usePlannerKeyBindings, type KeyBinding, type KeyChord } from "../../../lib/planner-keys.js";
import { COCKPIT_MODES } from "../../../lib/cockpit-modes.js";
import { countLabel } from "../../../lib/count-label.js";
import { floorNames } from "../../../lib/floor-names.js";
import { PLANNER_TOOLS } from "../../../lib/planner-tools.js";
import { referenceSceneEntries } from "../../../lib/reference-scene-model.js";
import { useOnlineStatus } from "../../../hooks/use-online-status.js";
import { usePlannerVenueIdentity } from "../../../hooks/use-planner-venue-identity.js";
import {
  CHROME_CLEARED_ATTRIBUTE,
  CHROME_FOLD_UNITS,
  CHROME_SETTLE_MS,
  chromeFoldAttribute,
  useChromePresenceStore,
  type ChromeFoldUnit,
  type ChromePresenceState,
} from "../../../stores/chrome-presence-store.js";
import { useShownLens } from "../../../lib/use-lens-rail.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useToolStore } from "../../../stores/tool-store.js";
import { focusCrestQuietly } from "./CrestLabel.js";
import { headerSaveLabel } from "./ReferenceRoomHeader.js";
import "./ChromeFold.css";

// ---------------------------------------------------------------------------
// ChromeFold — the planner's chrome folds away (T-680).
//
// Blake, 28 Oct 2026: "The UI elements, I want to be able to minimise them
// for cleaner design. make it as aesthetic as possible, the philosophy of the
// sublime as we have discussed throughout the project should be employed."
// He chose: each panel folds to a slim spine at its edge and stays folded on
// this device; \ or the crest clears every panel so the hall fills the
// screen, and \, the crest or Esc brings them back; a panel's fold mark shows
// when the hand reaches for it.
//
// The state is mirrored onto <html> as data attributes because part of the
// chrome lives outside the cockpit (EditorPage's right-hand buttons, sheets
// portalled to <body>). ChromeFold.css folds the existing containers by those
// attributes, so no unit's own component changes, and every unit stays
// mounted: the right dock hosts the object notes' portal, and the
// frozen-preview camera measures the docks.
// ---------------------------------------------------------------------------

/** An animated unfold or restore keeps its transition this long. */
export { CHROME_SETTLE_MS };

/** How long the clear-all note stays on screen. */
export const CLEAR_HINT_MS = 4000;

/** What the clear-all note says, the first few times on a device. */
export const CLEAR_HINT_TEXT = "The tools are hidden · press \\ or the crest to bring them back";

/** The same, spoken: a screen reader at its usual punctuation level says nothing for a bare \. */
export const CLEAR_HINT_VOICE = "The tools are hidden. Press backslash or the crest to bring them back.";

/** Each unit's name, as its spine and fold mark say it (the right one follows the lens). */
export const CHROME_UNIT_NAMES: Readonly<Record<ChromeFoldUnit, string>> = {
  left: "On the floor",
  right: "Details",
  top: "the tool bar",
  bottom: "the bottom bar",
};

const MOTION = "data-planner-chrome-motion";
const CREST = "[data-planner-crest]";

/** Whether the person can see this element: a hidden unit hides everything in it. */
function isOnScreen(element: Element): boolean {
  return element.isConnected && getComputedStyle(element).visibility !== "hidden";
}

/** Where focus goes when the chrome it was on has gone: the first that can be seen and takes it. */
const FOCUS_WHEN_CLEARED = [CREST, ".chrome-phone-seal"] as const;
const FOCUS_WHEN_RESTORED = ["#chrome-spine-left", '[data-testid="mobile-planner-topbar"] button:not(:disabled)', CREST] as const;

/**
 * Keyboard focus never stays on chrome that has just gone (WCAG 2.4.3). If
 * what had focus before the chrome was cleared or brought back is hidden or
 * gone now, focus moves to the crest (or a phone's seal) while cleared, and
 * afterwards to the left spine (the crest is folded away with its dock) or a
 * phone's top bar. Nothing focused before means nothing to move.
 */
export function settleChromeFocus(doc: Document, before: Element | null, cleared: boolean, onScreen: (element: Element) => boolean = isOnScreen): void {
  if (before === null || before === doc.body) return;
  const active = doc.activeElement;
  if (active !== null && active !== doc.body && onScreen(active)) return;
  for (const selector of cleared ? FOCUS_WHEN_CLEARED : FOCUS_WHEN_RESTORED) {
    const next = doc.querySelector<HTMLElement>(selector);
    if (next === null || !onScreen(next)) continue;
    if (next.matches(CREST)) focusCrestQuietly(next);
    else next.focus({ preventScroll: true });
    if (doc.activeElement === next) return;
  }
}

/**
 * When a phase preview ends, the remembered folds come back over its exit
 * and the right-hand column: focus left on a control inside them moves to
 * that unit's spine, which returns with the folds.
 */
export function settleFocusAfterPreview(doc: Document): void {
  const active = doc.activeElement;
  if (active === null) return;
  const { folded } = useChromePresenceStore.getState();
  if (folded.bottom && active.closest(".reference-viewer > .cockpit-bottom") !== null) focusSoon(spineId("bottom"));
  else if (folded.right && active.closest(".reference-view-switch, .reference-handoff-action, .reference-event-details") !== null) focusSoon(spineId("right"));
}

/**
 * Writes the chrome's state onto `root` until the returned function takes it
 * all away again. A unit that unfolds (or chrome that comes back) holds a
 * passing state for one settle, so its motion runs and the unit then rests in
 * its own CSS; anything the keyboard did is instant.
 */
export function mirrorChromePresence(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const settling = new Map<string, number>();
  let focusFrame: number | null = null;
  let focusLater: number | undefined;
  const write = (name: string, value: string | null): void => {
    const timer = settling.get(name);
    if (timer !== undefined) window.clearTimeout(timer);
    settling.delete(name);
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  };
  const pass = (name: string, value: string): void => {
    write(name, value);
    settling.set(name, window.setTimeout(() => {
      settling.delete(name);
      root.removeAttribute(name);
    }, CHROME_SETTLE_MS));
  };
  const apply = (state: ChromePresenceState, previous: ChromePresenceState | null): void => {
    if (state.instant || previous === null) root.setAttribute(MOTION, "instant");
    else root.removeAttribute(MOTION);
    for (const unit of CHROME_FOLD_UNITS) {
      const name = chromeFoldAttribute(unit);
      if (state.folded[unit]) write(name, "folded");
      else if (previous?.folded[unit] === true && !state.instant) pass(name, "unfolding");
      else if (previous === null || previous.folded[unit]) write(name, null);
    }
    if (state.cleared) write(CHROME_CLEARED_ATTRIBUTE, "cleared");
    else if (previous?.cleared === true && !state.instant) pass(CHROME_CLEARED_ATTRIBUTE, "restoring");
    else if (previous === null || previous.cleared) write(CHROME_CLEARED_ATTRIBUTE, null);
  };
  apply(useChromePresenceStore.getState(), null);
  // The first frame shows remembered folds as they are, not folding; motion
  // comes back on the next unless the person has changed something since.
  // (The store's own `instant` is no guide here: the cockpit last left it
  // set, and React's development mount leaves and comes back at once.)
  let changed = false;
  const firstFrame = window.requestAnimationFrame(() => {
    if (!changed) root.removeAttribute(MOTION);
  });
  const unsubscribe = useChromePresenceStore.subscribe((state, previous) => {
    changed = true;
    const before = doc.activeElement;
    apply(state, previous);
    if (state.cleared === previous.cleared) return;
    if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    window.clearTimeout(focusLater);
    // A frame on, once React has drawn the change: a phone's seal comes and goes with it.
    focusFrame = window.requestAnimationFrame(() => {
      focusFrame = null;
      settleChromeFocus(doc, before, state.cleared);
    });
    // The pointer's change hides chrome only once its fade has run. A browser
    // that leaves focus on what has then gone has it moved too; focus that has
    // moved on, or fallen to the page, is the person's and stays.
    if (!state.instant) {
      focusLater = window.setTimeout(() => {
        if (before !== null && doc.activeElement === before && !isOnScreen(before)) settleChromeFocus(doc, before, state.cleared);
      }, CHROME_SETTLE_MS);
    }
  });
  return () => {
    unsubscribe();
    window.cancelAnimationFrame(firstFrame);
    if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    window.clearTimeout(focusLater);
    for (const timer of settling.values()) window.clearTimeout(timer);
    for (const unit of CHROME_FOLD_UNITS) root.removeAttribute(chromeFoldAttribute(unit));
    root.removeAttribute(CHROME_CLEARED_ATTRIBUTE);
    root.removeAttribute(MOTION);
    useChromePresenceStore.getState().resetCleared();
  };
}

/**
 * \ wherever the keyboard keeps it: under AltGr on German, French, Spanish
 * and Nordic keyboards (the browser reports Ctrl and Alt with it) and under
 * Option on a Mac's. In a text field it still only types.
 */
const BACKSLASH: readonly KeyChord[] = [{ key: "\\" }, { key: "\\", mod: true, alt: true }, { key: "\\", alt: true }];

const CHROME_KEYS: readonly KeyBinding[] = [
  { keys: BACKSLASH, priority: KEY_PRIORITY.planner, run: () => { useChromePresenceStore.getState().toggleCleared(); } },
];

/**
 * The chrome's page-wide side: the attributes on <html>, the \ key, and Esc's
 * last rung while the chrome is cleared. Mount once, in the cockpit; leaving
 * the cockpit takes every attribute away and ends a clear-all.
 */
export function useChromePresence(): void {
  const cleared = useChromePresenceStore((state) => state.cleared);
  usePlannerKeyBindings(CHROME_KEYS);
  useEscapeLayer("chrome", { open: cleared, onEscape: () => { useChromePresenceStore.getState().restoreAll(); } });
  useLayoutEffect(() => mirrorChromePresence(document.documentElement), []);
  useEffect(() => useLayoutTimelinePreviewStore.subscribe((state, previous) => {
    if (state.mode === "inactive" && previous.mode !== "inactive") settleFocusAfterPreview(document);
  }), []);
}

/** What a unit is called right now: the right dock is whichever lens is open. */
function useUnitName(unit: ChromeFoldUnit): string {
  // The lens the cockpit shows, which is Design for one this viewer is not offered.
  const mode = useShownLens();
  if (unit !== "right" || mode === "design") return CHROME_UNIT_NAMES[unit];
  return COCKPIT_MODES.find((entry) => entry.id === mode)?.label ?? CHROME_UNIT_NAMES.right;
}

/** The hand the person is holding, which the folded tool bar's spine names. */
function useToolInHand(enabled: boolean): string | null {
  return useToolStore((state) => (enabled ? PLANNER_TOOLS.find((tool) => tool.id === state.activeTool)?.label ?? null : null));
}

const CHEVRONS = {
  left: "M9.5 3.5 5 8l4.5 4.5",
  right: "M6.5 3.5 11 8l-4.5 4.5",
  up: "M3.5 9.5 8 5l4.5 4.5",
  down: "M3.5 6.5 8 11l4.5-4.5",
} as const;

/** A fold mark points to the edge its unit folds into; a spine points back into the room. */
const FOLDS_TOWARDS = { left: "left", right: "right", top: "up", bottom: "down" } as const;
const OPENS_TOWARDS = { left: "right", right: "left", top: "down", bottom: "up" } as const;

function Chevron({ towards }: { readonly towards: keyof typeof CHEVRONS }): ReactElement {
  return (
    <svg className="chrome-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={CHEVRONS[towards]} />
    </svg>
  );
}

function spineId(unit: ChromeFoldUnit): string {
  return `chrome-spine-${unit}`;
}

function markId(unit: ChromeFoldUnit): string {
  return `chrome-fold-mark-${unit}`;
}

/** Focus follows the fold, so the same key reverses it. */
function focusSoon(id: string): void {
  window.requestAnimationFrame(() => { document.getElementById(id)?.focus({ preventScroll: true }); });
}

/**
 * The mark that folds one unit into its own edge, shown when the hand reaches
 * for the unit. It sits on the unit's edge, half in and half out, where no
 * control of the unit's own can be under it.
 */
export function ChromeFoldMark({ unit }: { readonly unit: ChromeFoldUnit }): ReactElement {
  const name = useUnitName(unit);
  return (
    <button
      type="button"
      id={markId(unit)}
      className={`chrome-fold-mark chrome-fold-mark--${unit}`}
      aria-expanded="true"
      aria-label={`Fold ${name}`}
      onClick={() => {
        useChromePresenceStore.getState().fold(unit);
        focusSoon(spineId(unit));
      }}
    >
      <Chevron towards={FOLDS_TOWARDS[unit]} />
    </button>
  );
}

type SaveState = Parameters<typeof headerSaveLabel>[0];

/** The header's own words, but only when saving is in trouble: a folded or cleared chrome never hides it. */
export function chromeSaveTrouble(state: SaveState): string | null {
  if (state.configId === null || state.saving) return null;
  const trouble = state.conflicted || state.saveError !== null || (!state.online && state.dirty);
  return trouble ? headerSaveLabel(state) : null;
}

/** Where saving stands, as the room header reads it. */
function useSaveState(): SaveState {
  const configId = useEditorStore((state) => state.configId);
  const saving = useEditorStore((state) => state.isSaving);
  const dirty = useEditorStore((state) => state.isDirty);
  const saveError = useEditorStore((state) => state.saveError);
  const conflicted = useEditorStore((state) => state.saveConflict !== null);
  const online = useOnlineStatus();
  return { configId, saving, dirty, saveError, conflicted, online };
}

function useChromeSaveTrouble(): string | null {
  return chromeSaveTrouble(useSaveState());
}

function LeftSpineWords(): ReactElement {
  const folded = useChromePresenceStore((state) => state.folded.left);
  const count = usePlacementStore((state) => (folded ? referenceSceneEntries(state.placedItems).length : 0));
  const trouble = useChromeSaveTrouble();
  const id = spineId("left");
  return (
    <>
      <span className="chrome-spine__label">{CHROME_UNIT_NAMES.left}</span>
      <span className="chrome-spine__count" id={`${id}-count`}>
        <span aria-hidden="true">{count}</span>
        <span className="chrome-sr-only">{countLabel(count, "piece")} on the floor.</span>
      </span>
      <span className="chrome-spine__trouble" id={`${id}-trouble`}>{trouble ?? ""}</span>
    </>
  );
}

function RightSpineWords({ name }: { readonly name: string }): ReactElement {
  const folded = useChromePresenceStore((state) => state.folded.right);
  const selected = useSelectionStore((state) => (folded && state.selectedIds.size === 1 ? [...state.selectedIds][0] ?? null : null));
  const piece = usePlacementStore((state) => (selected === null ? null : floorNames(state.placedItems).get(selected)?.label ?? null));
  return (
    <>
      <span className="chrome-spine__label">{name}</span>
      <span className="chrome-spine__detail" id={`${spineId("right")}-detail`}>{piece ?? ""}</span>
    </>
  );
}

/**
 * A folded unit's spine at its own edge; a press opens the unit again. Its
 * name is short ("Show On the floor"); what it shows besides (the count, save
 * trouble, the piece in hand) is its description, so a screen reader hears
 * the save truth the folded header can no longer say.
 */
export function ChromeSpine({ unit }: { readonly unit: ChromeFoldUnit }): ReactElement {
  const name = useUnitName(unit);
  const tool = useToolInHand(unit === "top");
  const id = spineId(unit);
  const describedBy = unit === "left" ? `${id}-count ${id}-trouble` : unit === "right" ? `${id}-detail` : undefined;
  return (
    <button
      type="button"
      id={id}
      className={`chrome-spine chrome-spine--${unit}`}
      aria-expanded="false"
      aria-label={tool === null ? `Show ${name}` : `Show ${name} · ${tool}`}
      aria-describedby={describedBy}
      onClick={() => {
        useChromePresenceStore.getState().unfold(unit);
        focusSoon(markId(unit));
      }}
    >
      <Chevron towards={OPENS_TOWARDS[unit]} />
      {unit === "left" ? <LeftSpineWords />
        : unit === "right" ? <RightSpineWords name={name} />
          : tool === null ? null : <span className="chrome-spine__tool">{tool}</span>}
    </button>
  );
}

/** A unit's fold mark and spine together; the CSS shows whichever fits the unit's state. */
export function ChromeFoldControls({ unit }: { readonly unit: ChromeFoldUnit }): ReactElement {
  return (
    <>
      <ChromeFoldMark unit={unit} />
      <ChromeSpine unit={unit} />
    </>
  );
}

interface CrestAnchor {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the notes beside the crest sit: just right of it, on its centre line.
 * Measured, because the crest moves with the venue's name and the rail's
 * width. Null on a phone, which has a seal in a fixed place instead.
 */
function useCrestAnchor(active: boolean): CrestAnchor | null {
  const [anchor, setAnchor] = useState<CrestAnchor | null>(null);
  useLayoutEffect(() => {
    if (!active) return undefined;
    const measure = (): void => {
      const crest = document.querySelector(CREST);
      const shell = crest?.closest(".cockpit-shell") ?? null;
      if (crest === null || shell === null) {
        setAnchor(null);
        return;
      }
      const box = crest.getBoundingClientRect();
      const frame = shell.getBoundingClientRect();
      setAnchor({ left: Math.round(box.right - frame.left + 9), top: Math.round(box.top - frame.top + box.height / 2) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); };
  }, [active]);
  return anchor;
}

function besideTheCrest(anchor: CrestAnchor | null, below: number): CSSProperties | undefined {
  return anchor === null ? undefined : { left: anchor.left, top: anchor.top + below };
}

/** How far the save word sits under the note when both are showing. */
const NOTE_LINE = 34;

/**
 * Says, the first few times on a device, how cleared chrome comes back. The
 * voice is in the accessibility tree before its words arrive, so they are
 * spoken; the ink beside it is what the eye reads, and fades.
 */
export function ChromeClearHint(): ReactElement {
  const pending = useChromePresenceStore((state) => state.hintPending);
  const anchor = useCrestAnchor(pending);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => { useChromePresenceStore.getState().dismissHint(); }, CLEAR_HINT_MS);
    return () => { window.clearTimeout(timer); };
  }, [pending]);
  return (
    <p className="chrome-clear-hint" data-shown={pending ? "true" : "false"} style={besideTheCrest(anchor, 0)}>
      <span className="chrome-sr-only" role="status">{pending ? CLEAR_HINT_VOICE : ""}</span>
      <span aria-hidden="true">{CLEAR_HINT_TEXT}</span>
    </p>
  );
}

interface HeaderAway {
  readonly away: boolean;
  /** The line the header had said when it went; null once it has changed since. */
  readonly said: string | null;
}

/**
 * The room header's voice while the header is away. The header speaks its
 * own save line; folded or cleared away, that live region goes with it, so
 * this one speaks every change from the moment it went, and nothing the
 * header had already said (once is enough). On a phone the top bar keeps its
 * own voice, so this speaks only while the chrome is cleared. The ink shows
 * save trouble beside the crest while cleared; a folded left dock's spine
 * shows it there.
 */
export function ChromeSaveWord({ mobile = false }: { readonly mobile?: boolean }): ReactElement {
  const save = useSaveState();
  const trouble = chromeSaveTrouble(save);
  const line = headerSaveLabel(save);
  const cleared = useChromePresenceStore((state) => state.cleared);
  const away = useChromePresenceStore((state) => state.cleared || (!mobile && state.folded.left));
  const noteShowing = useChromePresenceStore((state) => state.hintPending);
  const [since, setSince] = useState<HeaderAway>({ away, said: line });
  if (since.away !== away) setSince({ away, said: line });
  else if (since.said !== null && line !== since.said) setSince({ away, said: null });
  const shown = cleared && trouble !== null;
  const anchor = useCrestAnchor(shown);
  return (
    <p className="chrome-save-word" data-shown={shown ? "true" : "false"} style={besideTheCrest(anchor, noteShowing ? NOTE_LINE : 0)}>
      <span className="chrome-sr-only" role="status">{away && since.said === null ? line : ""}</span>
      <span aria-hidden="true">{trouble ?? ""}</span>
    </p>
  );
}

/** On a phone, which has no room header, the venue's crest is the way back while the chrome is cleared. */
export function PhoneChromeSeal(): ReactElement | null {
  const cleared = useChromePresenceStore((state) => state.cleared);
  const venueId = useEditorStore((state) => state.venueId);
  const venue = usePlannerVenueIdentity(venueId);
  if (!cleared) return null;
  return (
    <button
      type="button"
      className="chrome-phone-seal"
      aria-label="Show the tools"
      aria-keyshortcuts={"\\"}
      onClick={() => { useChromePresenceStore.getState().restoreAll(); }}
    >
      {venue.logoUrl !== null
        ? <img src={venue.logoUrl} width="28" height="35" alt="" />
        : <Building2 size={22} aria-hidden="true" />}
    </button>
  );
}
