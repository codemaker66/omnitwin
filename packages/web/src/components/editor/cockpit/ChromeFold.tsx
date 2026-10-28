import { useEffect, useLayoutEffect, type ReactElement } from "react";
import { Building2 } from "lucide-react";
import { KEY_PRIORITY, useEscapeLayer, usePlannerKeyBindings, type KeyBinding } from "../../../lib/planner-keys.js";
import { COCKPIT_MODES } from "../../../lib/cockpit-modes.js";
import { floorNames } from "../../../lib/floor-names.js";
import { referenceSceneEntries } from "../../../lib/reference-scene-model.js";
import { useOnlineStatus } from "../../../hooks/use-online-status.js";
import { usePlannerVenueIdentity } from "../../../hooks/use-planner-venue-identity.js";
import {
  CHROME_FOLD_UNITS,
  useChromePresenceStore,
  type ChromeFoldUnit,
  type ChromePresenceState,
} from "../../../stores/chrome-presence-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
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

/** An animated unfold or restore keeps its transition this long (--house-motion-deliberate). */
export const CHROME_SETTLE_MS = 240;

/** How long the clear-all note stays on screen. */
export const CLEAR_HINT_MS = 4000;

/** Each unit's name, as its spine and fold mark say it (the right one follows the lens). */
export const CHROME_UNIT_NAMES: Readonly<Record<ChromeFoldUnit, string>> = {
  left: "On the floor",
  right: "Details",
  top: "the tool bar",
  bottom: "the bottom bar",
};

const MOTION = "data-planner-chrome-motion";
const CHROME = "data-planner-chrome";

function foldAttribute(unit: ChromeFoldUnit): string {
  return `data-planner-fold-${unit}`;
}

/**
 * Writes the chrome's state onto `root` until the returned function takes it
 * all away again. A unit that unfolds (or chrome that comes back) holds a
 * passing state for one settle, so its motion runs and the unit then rests in
 * its own CSS; anything the keyboard did is instant.
 */
export function mirrorChromePresence(root: HTMLElement): () => void {
  const settling = new Map<string, number>();
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
      const name = foldAttribute(unit);
      if (state.folded[unit]) write(name, "folded");
      else if (previous?.folded[unit] === true && !state.instant) pass(name, "unfolding");
      else if (previous === null || previous.folded[unit]) write(name, null);
    }
    if (state.cleared) write(CHROME, "cleared");
    else if (previous?.cleared === true && !state.instant) pass(CHROME, "restoring");
    else if (previous === null || previous.cleared) write(CHROME, null);
  };
  apply(useChromePresenceStore.getState(), null);
  // The first frame shows remembered folds as they are, not folding.
  const firstFrame = window.requestAnimationFrame(() => {
    if (!useChromePresenceStore.getState().instant) root.removeAttribute(MOTION);
  });
  const unsubscribe = useChromePresenceStore.subscribe((state, previous) => { apply(state, previous); });
  return () => {
    unsubscribe();
    window.cancelAnimationFrame(firstFrame);
    for (const timer of settling.values()) window.clearTimeout(timer);
    for (const unit of CHROME_FOLD_UNITS) root.removeAttribute(foldAttribute(unit));
    root.removeAttribute(CHROME);
    root.removeAttribute(MOTION);
    useChromePresenceStore.getState().resetCleared();
  };
}

const CHROME_KEYS: readonly KeyBinding[] = [
  { keys: [{ key: "\\" }], priority: KEY_PRIORITY.planner, run: () => { useChromePresenceStore.getState().toggleCleared(); } },
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
}

/** What a unit is called right now: the right dock is whichever lens is open. */
function useUnitName(unit: ChromeFoldUnit): string {
  const mode = useCockpitStore((state) => state.activeMode);
  if (unit !== "right" || mode === "design") return CHROME_UNIT_NAMES[unit];
  return COCKPIT_MODES.find((entry) => entry.id === mode)?.label ?? CHROME_UNIT_NAMES.right;
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

/** The mark that folds one unit into its own edge, shown when the hand reaches for the unit. */
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

function useChromeSaveTrouble(): string | null {
  const configId = useEditorStore((state) => state.configId);
  const saving = useEditorStore((state) => state.isSaving);
  const dirty = useEditorStore((state) => state.isDirty);
  const saveError = useEditorStore((state) => state.saveError);
  const conflicted = useEditorStore((state) => state.saveConflict !== null);
  const online = useOnlineStatus();
  return chromeSaveTrouble({ configId, saving, dirty, saveError, conflicted, online });
}

function LeftSpineWords(): ReactElement {
  const folded = useChromePresenceStore((state) => state.folded.left);
  const count = usePlacementStore((state) => (folded ? referenceSceneEntries(state.placedItems).length : 0));
  const trouble = useChromeSaveTrouble();
  return (
    <>
      <span className="chrome-spine__label">{CHROME_UNIT_NAMES.left}</span>
      <span className="chrome-spine__count">{count}</span>
      {trouble !== null && <span className="chrome-spine__trouble">{trouble}</span>}
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
      {piece !== null && <span className="chrome-spine__detail">{piece}</span>}
    </>
  );
}

/** A folded unit's spine at its own edge; a press opens the unit again. */
export function ChromeSpine({ unit }: { readonly unit: ChromeFoldUnit }): ReactElement {
  const name = useUnitName(unit);
  return (
    <button
      type="button"
      id={spineId(unit)}
      className={`chrome-spine chrome-spine--${unit}`}
      aria-expanded="false"
      aria-label={`Show ${name}`}
      onClick={() => {
        useChromePresenceStore.getState().unfold(unit);
        focusSoon(markId(unit));
      }}
    >
      <Chevron towards={OPENS_TOWARDS[unit]} />
      {unit === "left" ? <LeftSpineWords /> : unit === "right" ? <RightSpineWords name={name} /> : null}
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

/** Says, the first few times on a device, how cleared chrome comes back. */
export function ChromeClearHint(): ReactElement {
  const pending = useChromePresenceStore((state) => state.hintPending);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => { useChromePresenceStore.getState().dismissHint(); }, CLEAR_HINT_MS);
    return () => { window.clearTimeout(timer); };
  }, [pending]);
  // The live region is always there, so the line is spoken when it arrives.
  return (
    <p className="chrome-clear-hint" role="status" data-shown={pending ? "true" : "false"}>
      {pending ? "The tools are hidden · press \\ or the crest to bring them back" : ""}
    </p>
  );
}

/** Save trouble beside the crest while the chrome is cleared. */
export function ChromeSaveWord(): ReactElement {
  const trouble = useChromeSaveTrouble();
  return (
    <span className="chrome-save-word" role="status" data-trouble={trouble === null ? "false" : "true"}>
      {trouble ?? ""}
    </span>
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
