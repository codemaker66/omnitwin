import { sql } from "drizzle-orm";
import type { PeopleTx } from "./people-records.js";

// ---------------------------------------------------------------------------
// One guest lead per address, across venues (guest_leads has no venue). A
// public enquiry writes the lead for its address if there is none; an erasure
// deletes it when no enquiry anywhere still uses the address. Both take this
// lock first, for the transaction, so neither decides on what the other has
// not yet committed: an enquiry sent meanwhile either commits first and keeps
// the lead, or writes it again after the erasure.
// ---------------------------------------------------------------------------

export function guestLeadLockKey(address: string): string {
  return `guest-lead:${address.trim().toLowerCase()}`;
}

export async function lockGuestLead(tx: Pick<PeopleTx, "execute">, address: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${guestLeadLockKey(address)}, 0))`);
}
