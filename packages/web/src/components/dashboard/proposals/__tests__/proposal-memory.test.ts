import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../../../stores/auth-store.js";
import { forgetProposalMemory, forgetWords, proposalsWithWords, recallDraft, recallKept, rememberDraft, subscribeKept, updateKept } from "../proposal-memory.js";

// ---------------------------------------------------------------------------
// What a booker has written on the Proposals desk this visit: counted and let
// go per person at sign-out, and held against a reload only while someone is
// signed in.
// ---------------------------------------------------------------------------

const person: AuthUser = { id: "u1", email: "catherine@example.test", role: "staff", platformRole: "none", venueId: "v1", name: "Catherine Tait" };
const words = { message: "Words not yet saved.", capacityNote: "", lines: [] };

function reloadHeld(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  forgetProposalMemory();
  useAuthStore.getState().setUser(null);
});

describe("the words a person has not yet saved", () => {
  it("counts the proposals holding them, in a composer or kept to copy, and no one else's", () => {
    rememberDraft("u1", "p1", { composer: 1, start: 1, draft: words });
    updateKept("u1", () => ({ p1: [{ draft: words, composer: 2, why: null }], p2: [{ draft: words, composer: 3, why: null }] }));
    rememberDraft("u12", "p3", { composer: 4, start: 1, draft: words });
    expect(proposalsWithWords("u1")).toBe(2);
    expect(proposalsWithWords("u12")).toBe(1);
    expect(proposalsWithWords("u2")).toBe(0);
  });

  it("are forgotten for that person alone at sign-out, telling any desk, and a reload is let go once none are left", () => {
    useAuthStore.getState().setUser(person);
    rememberDraft("u1", "p1", { composer: 1, start: 1, draft: words });
    updateKept("u1", () => ({ p2: [{ draft: words, composer: 2, why: null }] }));
    rememberDraft("u2", "p1", { composer: 3, start: 1, draft: words });
    const told = vi.fn();
    const stop = subscribeKept(told);
    forgetWords("u1");
    stop();
    expect(told).toHaveBeenCalledOnce();
    expect(recallDraft("u1", "p1")).toBeNull();
    expect(recallKept("u1")).toEqual({});
    expect(proposalsWithWords("u1")).toBe(0);
    expect(recallDraft("u2", "p1")?.draft).toBe(words);
    expect(reloadHeld()).toBe(true);
    forgetWords("u2");
    expect(reloadHeld()).toBe(false);
  });

  it("hold a reload only while someone is signed in", () => {
    useAuthStore.getState().setUser(person);
    rememberDraft("u1", "p1", { composer: 1, start: 1, draft: words });
    expect(reloadHeld()).toBe(true);
    useAuthStore.getState().setUser(null);
    expect(reloadHeld()).toBe(false);
    useAuthStore.getState().setUser(person);
    expect(reloadHeld()).toBe(true);
  });
});
