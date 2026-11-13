// ---------------------------------------------------------------------------
// What one address may store through the anonymous planner save.
//
// A guest's planner saves itself three seconds after every change, so the
// number of saves says little about abuse: an engaged guest makes hundreds an
// hour, each a few tens of kilobytes. What costs the database is bytes,
// because every accepted save is also kept whole in the layout's revision
// log. So this limits the save by what it stores. Each address holds an
// allowance in bytes that refills steadily; an honest guest never comes near
// it, and an address that spends it is slowed to the refill rate instead of
// being shut out for an hour.
//
// The route's request limit stays the floor beneath this: it bounds how often
// an address may ask, this bounds how much it may keep.
//
// State is in memory, per API process, like the rate limiter's own store and
// the public MCP budget beside this file (services/public-mcp-budget.ts), and
// the map is capped so callers cannot grow it. An address dropped from a full
// map gets a whole allowance back, which only helps a caller who already
// commands more addresses than the cap.
// ---------------------------------------------------------------------------

const MEBIBYTE = 1024 * 1024;

/** What an address can have saved up, and what it starts with: the most the
 *  earlier limit (sixty saves an hour, two megabytes each) let it store. */
export const GUEST_SAVE_ALLOWANCE_BYTES = 120 * MEBIBYTE;
/** A spent allowance is whole again in an hour. */
export const GUEST_SAVE_REFILL_BYTES_PER_SECOND = GUEST_SAVE_ALLOWANCE_BYTES / 3600;
const MAX_ADDRESSES = 20_000;

export interface GuestSaveBudgetOptions {
  readonly allowanceBytes?: number;
  readonly refillBytesPerSecond?: number;
  readonly maxAddresses?: number;
}

export type GuestSaveDecision =
  | { readonly ok: true }
  | {
    readonly ok: false;
    /** Whole seconds until a save of this size fits. */
    readonly retryAfterSeconds: number;
  };

interface Allowance {
  readonly bytes: number;
  readonly atMs: number;
}

export class GuestSaveBudget {
  private readonly allowanceBytes: number;
  private readonly refillBytesPerSecond: number;
  private readonly maxAddresses: number;
  /** Address → what it held when last seen. Insertion order is last-seen order. */
  private readonly allowances = new Map<string, Allowance>();

  constructor(options: GuestSaveBudgetOptions = {}) {
    this.allowanceBytes = options.allowanceBytes ?? GUEST_SAVE_ALLOWANCE_BYTES;
    this.refillBytesPerSecond = options.refillBytesPerSecond ?? GUEST_SAVE_REFILL_BYTES_PER_SECOND;
    this.maxAddresses = options.maxAddresses ?? MAX_ADDRESSES;
  }

  /** Spends `bytes` of this address's allowance, or refuses without spending
   *  any, so a smaller save can still fit in what is left. */
  charge(address: string, bytes: number, nowMs: number): GuestSaveDecision {
    const cost = Math.max(0, Math.ceil(bytes));
    const held = this.allowances.get(address);
    // A clock that steps back earns nothing, then or when it steps forward again.
    const atMs = held === undefined ? nowMs : Math.max(nowMs, held.atMs);
    const available = held === undefined
      ? this.allowanceBytes
      : Math.min(this.allowanceBytes, held.bytes + ((atMs - held.atMs) / 1000) * this.refillBytesPerSecond);
    if (cost > available) {
      this.remember(address, { bytes: available, atMs });
      // A save larger than the whole allowance never fits; the wait named is
      // then the wait for a full allowance.
      const short = Math.min(cost, this.allowanceBytes) - available;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(short / this.refillBytesPerSecond)) };
    }
    this.remember(address, { bytes: available - cost, atMs });
    return { ok: true };
  }

  private remember(address: string, allowance: Allowance): void {
    this.allowances.delete(address);
    this.allowances.set(address, allowance);
    while (this.allowances.size > this.maxAddresses) {
      const oldest = this.allowances.keys().next();
      if (oldest.done === true) break;
      this.allowances.delete(oldest.value);
    }
  }
}
