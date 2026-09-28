// ---------------------------------------------------------------------------
// A page left on purpose. A sign-out on its way out that cannot first sign out
// on the page (the access gate's "Use another account", shown while access is
// checked or could not be) says so, so what holds the page against a reload
// (the Proposals desk's unsaved words, proposal-memory.ts) stands aside for it
// rather than ask once the person has already signed out.
// ---------------------------------------------------------------------------

let leaving = false;

/** The page is being left on purpose; or, the leaving having failed, it is not. */
export function letPageGo(going: boolean): void {
  leaving = going;
}

export function pageLetGo(): boolean {
  return leaving;
}
