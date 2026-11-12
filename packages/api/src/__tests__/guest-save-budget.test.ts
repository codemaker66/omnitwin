import { describe, expect, it } from "vitest";
import {
  GUEST_SAVE_ALLOWANCE_BYTES,
  GUEST_SAVE_REFILL_BYTES_PER_SECOND,
  GuestSaveBudget,
} from "../services/guest-save-budget.js";

// A thousand bytes saved up, ten more every second.
const small = (): GuestSaveBudget => new GuestSaveBudget({ allowanceBytes: 1000, refillBytesPerSecond: 10 });
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);

describe("GuestSaveBudget", () => {
  it("lets an address spend exactly what it has saved up", () => {
    const budget = small();
    expect(budget.charge("a", 400, T0)).toEqual({ ok: true });
    expect(budget.charge("a", 600, T0)).toEqual({ ok: true });
    expect(budget.charge("a", 1, T0)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("refuses a save that does not fit without spending anything, and says how long until it does", () => {
    const budget = small();
    expect(budget.charge("a", 700, T0)).toEqual({ ok: true });
    // 300 left: a 500-byte save is 200 short, twenty seconds of refill.
    expect(budget.charge("a", 500, T0)).toEqual({ ok: false, retryAfterSeconds: 20 });
    // The refusal cost nothing: the 300 are still there.
    expect(budget.charge("a", 300, T0)).toEqual({ ok: true });
  });

  it("refills steadily, so a spent address is slowed, not shut out", () => {
    const budget = small();
    expect(budget.charge("a", 1000, T0)).toEqual({ ok: true });
    expect(budget.charge("a", 100, T0 + 9_000)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(budget.charge("a", 100, T0 + 10_000)).toEqual({ ok: true });
    expect(budget.charge("a", 100, T0 + 20_000)).toEqual({ ok: true });
  });

  it("never saves up more than the allowance, however long an address stays away", () => {
    const budget = small();
    expect(budget.charge("a", 1000, T0)).toEqual({ ok: true });
    const muchLater = T0 + 30 * 24 * 60 * 60_000;
    expect(budget.charge("a", 1001, muchLater)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(budget.charge("a", 1000, muchLater)).toEqual({ ok: true });
  });

  it("keeps each address's allowance apart", () => {
    const budget = small();
    expect(budget.charge("a", 1000, T0)).toEqual({ ok: true });
    expect(budget.charge("b", 1000, T0)).toEqual({ ok: true });
    expect(budget.charge("a", 1, T0).ok).toBe(false);
  });

  it("does not go backwards when the clock does", () => {
    const budget = small();
    expect(budget.charge("a", 1000, T0)).toEqual({ ok: true });
    expect(budget.charge("a", 1, T0 - 60_000).ok).toBe(false);
  });

  it("holds no more addresses than its cap, forgetting the one seen longest ago", () => {
    const budget = new GuestSaveBudget({ allowanceBytes: 1000, refillBytesPerSecond: 10, maxAddresses: 2 });
    expect(budget.charge("a", 1000, T0)).toEqual({ ok: true });
    expect(budget.charge("b", 1000, T0)).toEqual({ ok: true });
    expect(budget.charge("c", 1000, T0)).toEqual({ ok: true });
    // "b" and "c" are remembered as spent; "a" was dropped to make room.
    expect(budget.charge("b", 1, T0).ok).toBe(false);
    expect(budget.charge("c", 1, T0).ok).toBe(false);
    expect(budget.charge("a", 1000, T0)).toEqual({ ok: true });
  });

  it("by default lets an address keep what the earlier limit let it store in an hour", () => {
    expect(GUEST_SAVE_ALLOWANCE_BYTES).toBe(60 * 2 * 1024 * 1024);
    expect(GUEST_SAVE_REFILL_BYTES_PER_SECOND * 3600).toBe(GUEST_SAVE_ALLOWANCE_BYTES);
    const budget = new GuestSaveBudget();
    // An engaged guest: a 120 KB plan saved every six seconds for an hour.
    let refused = 0;
    for (let save = 0; save < 600; save += 1) {
      if (!budget.charge("guest", 120 * 1024, T0 + save * 6_000).ok) refused += 1;
    }
    expect(refused).toBe(0);
  });
});
