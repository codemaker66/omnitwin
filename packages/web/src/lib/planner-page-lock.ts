// ---------------------------------------------------------------------------
// Which open page wrote a kept draft. Every page that runs the planner has an
// id of its own and holds a Web Lock named for it until the page goes (the
// browser releases it on close, reload or crash). A second tab opening the
// same layout can then tell another tab's in-progress work, which is that
// tab's to save, from work a closed tab left behind, which is the person's to
// pick up again. Without Web Locks the answer is unknown (null).
// ---------------------------------------------------------------------------

const LOCK_PREFIX = "venviewer:planner-page:";

function newPageId(): string {
  // randomUUID exists only in secure contexts (https, localhost).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const PAGE_ID = newPageId();
let holding = false;

function lockManager(): LockManager | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return navigator.locks;
}

/** This page's id, written into the drafts it keeps. */
export function plannerPageId(): string {
  return PAGE_ID;
}

/** Hold this page's lock for as long as the page lives (once per page). */
export function holdPlannerPageLock(): void {
  if (holding) return;
  const locks = lockManager();
  if (locks === null) return;
  holding = true;
  // Never resolves: the browser releases the lock when the page goes.
  locks.request(`${LOCK_PREFIX}${PAGE_ID}`, () => new Promise<never>(() => undefined)).catch(() => {
    holding = false;
  });
}

/** Whether the page that wrote a draft is still open; null when the browser cannot say. */
export async function isPlannerPageOpen(pageId: string): Promise<boolean | null> {
  if (pageId === PAGE_ID) return true;
  const locks = lockManager();
  if (locks === null) return null;
  try {
    const snapshot = await locks.query();
    return (snapshot.held ?? []).some((lock) => lock.name === `${LOCK_PREFIX}${pageId}`);
  } catch {
    return null;
  }
}
