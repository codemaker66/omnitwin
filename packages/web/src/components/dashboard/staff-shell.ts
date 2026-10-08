import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { DashboardView } from "./DashboardLayout.js";
import type { FindSource } from "./find/find-model.js";

// ---------------------------------------------------------------------------
// The persistent staff shell (roadmap N2). One parent route draws the header
// once for every staff page, so moving between them keeps it where it is: its
// unread count, its menus and the toasts beneath it. Each page still wears
// <DashboardLayout>; inside the shell that hands the page's frame (its view,
// its workspace's name, its surface) up to the header rather than drawing a
// second one.
// ---------------------------------------------------------------------------

/** What a page tells the header and the workspace landmark about itself. */
export interface ShellFrame {
  readonly activeView?: DashboardView;
  readonly onViewChange?: (view: DashboardView) => void;
  readonly mainLabel?: string;
  readonly surface?: "desk" | "rota";
  /** What the page adds to Find while it shows (the Diary's board). */
  readonly findSource?: FindSource;
}

export interface StaffShell {
  /** The frame of the page now showing; the latest holder wins. */
  readonly hold: (owner: symbol, frame: ShellFrame) => void;
  /** Lets go of a frame, unless a newer page already holds its own. */
  readonly release: (owner: symbol) => void;
}

export const StaffShellContext = createContext<StaffShell | null>(null);

/** True inside the persistent staff shell. */
export function useInStaffShell(): boolean {
  return useContext(StaffShellContext) !== null;
}

/** Signs out once the person has been asked about anything the page would
 *  lose with them (an unfinished stock correction, proposal words not yet
 *  saved). The shell's header gives it to the workspace beneath, so a page's
 *  own way to sign out asks the same; outside it, a sign-out goes at once. */
export type AskBeforeSignOut = (signOut: () => void) => void;
export const SignOutAskContext = createContext<AskBeforeSignOut | null>(null);
function signOutAtOnce(signOut: () => void): void { signOut(); }
export function useAskBeforeSignOut(): AskBeforeSignOut {
  return useContext(SignOutAskContext) ?? signOutAtOnce;
}

/** Hands this page's frame to the persistent shell while it is mounted, before
 *  the browser paints; does nothing outside the shell. */
export function useShellFrame(frame: ShellFrame): void {
  const shell = useContext(StaffShellContext);
  const [owner] = useState(() => Symbol("shell-frame"));
  // The view switch is the page's own callback, which may be new on every
  // render; the header calls the latest through one steady function.
  const viewChange = useRef(frame.onViewChange);
  useLayoutEffect(() => { viewChange.current = frame.onViewChange; });
  const switchesViews = frame.onViewChange !== undefined;
  // A page's Find source keeps its identity across its renders (FindSource),
  // so handing it up does not re-render the header on every page render.
  const { activeView, mainLabel, surface, findSource } = frame;
  useLayoutEffect(() => {
    if (shell === null) return;
    shell.hold(owner, {
      ...(activeView === undefined ? {} : { activeView }),
      ...(mainLabel === undefined ? {} : { mainLabel }),
      ...(surface === undefined ? {} : { surface }),
      ...(findSource === undefined ? {} : { findSource }),
      ...(switchesViews ? { onViewChange: (view: DashboardView) => { viewChange.current?.(view); } } : {}),
    });
  }, [activeView, findSource, mainLabel, owner, shell, surface, switchesViews]);
  useLayoutEffect(() => (shell === null ? undefined : () => { shell.release(owner); }), [owner, shell]);
}
