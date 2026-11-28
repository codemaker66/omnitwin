/**
 * The planner's kit: guest lists past their removal day go when Venviewer
 * opens in this browser, on whichever page. A planner who prints, holds the
 * event and never opens a guest list here again still has the names removed
 * the next time they use Venviewer on this device.
 *
 * It runs for every visitor, a while after the page has settled, so it is
 * careful on three counts. A visitor who never kept a list has no database,
 * and is given none: where the browser can say which databases it holds and
 * the kit's is not among them, nothing is opened. It never throws. And it
 * reads no name into anything: the device store checks each list's removal
 * day and removes it, and nothing of a list comes back here.
 */

import { guestListDatabaseMayExist, guestListStore } from "./store.js";

export async function sweepGuestListsAtBoot(nowMs: number = Date.now()): Promise<void> {
  try {
    if (!(await guestListDatabaseMayExist())) return;
    await guestListStore().sweep(nowMs);
  } catch {
    // A tidy-up only: the pages sweep again whenever a guest list is opened.
  }
}
