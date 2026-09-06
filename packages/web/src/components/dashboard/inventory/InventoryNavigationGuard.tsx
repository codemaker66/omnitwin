import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UNSAFE_DataRouterContext, useBlocker, type BlockerFunction } from "react-router-dom";
import { useFocusTrap } from "../../../lib/use-focus-trap.js";
import { ActivityStatus } from "../../shared/Activity.js";

interface InventoryNavigationGuardProps {
  readonly dirty: boolean;
  readonly busy: boolean;
}

type ExitAction = () => void;
type ExitGuard = (action: ExitAction) => boolean;
const InventoryExitContext = createContext<{
  readonly register: (guard: ExitGuard) => () => void;
  readonly request: (action: ExitAction) => void;
} | null>(null);

/** Local to one dashboard shell: a stock editor may defer an explicit sign-out
 * before either local auth or Clerk is changed. No global navigation registry. */
export function InventoryExitBoundary({ children }: { readonly children: ReactNode }): ReactElement {
  const guardRef = useRef<ExitGuard | null>(null);
  const register = useCallback((guard: ExitGuard): (() => void) => {
    guardRef.current = guard;
    return () => { if (guardRef.current === guard) guardRef.current = null; };
  }, []);
  const request = useCallback((action: ExitAction): void => {
    if (guardRef.current === null || !guardRef.current(action)) action();
  }, []);
  const value = useMemo(() => ({ register, request }), [register, request]);
  return <InventoryExitContext.Provider value={value}>{children}</InventoryExitContext.Provider>;
}

function immediateExit(action: ExitAction): void { action(); }
export function useInventoryExit(): (action: ExitAction) => void {
  return useContext(InventoryExitContext)?.request ?? immediateExit;
}

function LeaveCorrectionDialog({ busy, signOut = false, onStay, onLeave }: {
  readonly busy: boolean;
  readonly signOut?: boolean;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const trap = useFocusTrap<HTMLDivElement>();
  const stay = (): void => {
    onStay();
    // More/Account closes when this portal receives focus. Its submenu opener
    // is then hidden; return to a usable stock field after trap cleanup instead.
    requestAnimationFrame(() => {
      const pane = document.getElementById("inventory-correction");
      if (pane === null) return;
      const field = pane.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])");
      if (field !== null) field.focus();
      else { pane.setAttribute("tabindex", "-1"); pane.focus(); }
    });
  };
  return createPortal(<div className="inventory-overlay">
    <div className="inventory-editor inventory-action-dialog" ref={trap} role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stay(); }
      }}>
      <header className="inventory-editor-header"><h2 id={titleId}>
        {busy ? "Saving your stock correction" : signOut ? "Sign out with an unfinished correction?" : "Leave this stock correction?"}
      </h2></header>
      <p id={descriptionId}>{busy
        ? signOut ? "Your save is still in progress. Once it is confirmed, we’ll sign you out. Keep editing cancels sign-out, without cancelling the save."
          : "Your save is still in progress. Once it is confirmed, we’ll continue to the page you chose. Keep editing cancels that navigation, without cancelling the save."
        : "Your unsaved counts and reason will be lost if you leave. Keep editing to stay with this correction."}</p>
      {busy ? <ActivityStatus>Waiting for the stock save to finish…</ActivityStatus> : null}
      <div className="inventory-actions">
        <button className="inventory-button inventory-button--primary" type="button" onClick={stay}>Keep editing</button>
        <button className="inventory-button" type="button" disabled={busy} onClick={onLeave}>{signOut ? "Discard and sign out" : "Discard and leave"}</button>
      </div>
    </div>
  </div>, document.body);
}

function DataRouterInventoryNavigationGuard({ dirty, busy }: InventoryNavigationGuardProps): ReactElement | null {
  const exits = useContext(InventoryExitContext);
  const [pendingExit, setPendingExit] = useState<ExitAction | null>(null);
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) =>
    (dirty || busy) && (currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search), [dirty, busy]);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => exits?.register((action) => {
    if (!dirty && !busy) return false;
    setPendingExit(() => action);
    return true;
  }), [exits, dirty, busy]);

  useEffect(() => {
    // A successful in-flight save may clear the draft while navigation is held.
    // Resume the original router transition; do not recreate it as a fresh PUSH.
    if (pendingExit !== null) {
      // A browser Back pressed behind the sign-out confirmation must not queue
      // a second destination after Keep editing or replace the explicit exit.
      if (blocker.state === "blocked") blocker.reset();
      if (!dirty && !busy) { setPendingExit(null); pendingExit(); }
    } else if (blocker.state === "blocked" && !dirty && !busy) blocker.proceed();
  }, [blocker, dirty, busy, pendingExit]);

  if (pendingExit !== null && (dirty || busy)) return <LeaveCorrectionDialog busy={busy} signOut
    onStay={() => { setPendingExit(null); if (blocker.state === "blocked") blocker.reset(); }}
    onLeave={() => { if (!busy) { setPendingExit(null); pendingExit(); } }} />;

  if (blocker.state !== "blocked" || (!dirty && !busy)) return null;
  return <LeaveCorrectionDialog busy={busy} onStay={blocker.reset} onLeave={() => {
    if (!busy) blocker.proceed();
  }} />;
}

/** The application owns a data router. Standalone editor/MemoryRouter consumers
 * have no data-router blocker API; leave them safe to render without violating
 * hook ordering. Native document unload protection belongs to InventoryEditor. */
export function InventoryNavigationGuard(props: InventoryNavigationGuardProps): ReactElement | null {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter === null ? null : <DataRouterInventoryNavigationGuard {...props} />;
}
