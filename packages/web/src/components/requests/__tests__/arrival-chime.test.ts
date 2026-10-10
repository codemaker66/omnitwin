import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueRequest } from "@omnitwin/types";
import {
  __resetChimeForTests,
  chimeWorthy,
  isChimeEnabled,
  playArrivalChime,
  rememberForChime,
  setChimeEnabled,
} from "../arrival-chime.js";

// ---------------------------------------------------------------------------
// The arrival chime: off until somebody turns it on, one bell per arrival
// that is not this person's own ask, one per escalation to an administrator,
// nothing on the first snapshot and nothing on a tick that changes nothing.
// ---------------------------------------------------------------------------

/** An audio context that only counts what it is asked to play. */
class CountingAudioContext {
  static created = 0;
  static started = 0;
  readonly currentTime = 0;
  readonly state = "running";
  readonly destination = {};
  constructor() { CountingAudioContext.created += 1; }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain(): { gain: { setValueAtTime(): void; linearRampToValueAtTime(): void; exponentialRampToValueAtTime(): void }; connect(): void } {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  createOscillator(): { type: string; frequency: { setValueAtTime(): void }; connect(): void; start(): void; stop(): void } {
    return { type: "sine", frequency: { setValueAtTime() {} }, connect() {}, start() { CountingAudioContext.started += 1; }, stop() {} };
  }
}

const ME = { id: "00000000-0000-4000-8000-0000000000ff", role: "hallkeeper" };
const ADMIN = { id: "00000000-0000-4000-8000-0000000000fe", role: "admin" };

function request(id: string, overrides: Partial<VenueRequest> = {}): VenueRequest {
  return {
    id, venueId: "00000000-0000-4000-8000-00000000a001", bookingId: null, eventId: null,
    roomId: "00000000-0000-4000-8000-0000000000a1", roomName: "Grand Hall", kind: "chairs", quantity: 10, urgency: "soon",
    detail: null, requestedByUserId: "00000000-0000-4000-8000-0000000000aa", requestedByName: "Morag", requestedByRole: "client",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"], ownerUserId: null, ownerName: null, state: "sent",
    outcome: null, outcomeNote: null, escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null,
    resolvedAt: null, threadId: null, handoverToUserId: null, handoverToName: null, handedOverAt: null, underwayAt: null,
    reopenedAt: null, createdAt: "2026-10-10T10:00:00.000Z", updatedAt: "2026-10-10T10:00:00.000Z", ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  CountingAudioContext.created = 0;
  CountingAudioContext.started = 0;
  __resetChimeForTests();
  vi.stubGlobal("AudioContext", CountingAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  __resetChimeForTests();
});

describe("the chime setting", () => {
  it("is off until this device turns it on, and remembers the answer", () => {
    expect(isChimeEnabled()).toBe(false);
    expect(playArrivalChime()).toBe(false);
    expect(CountingAudioContext.started).toBe(0);
    setChimeEnabled(true);
    expect(isChimeEnabled()).toBe(true);
    expect(localStorage.getItem("venviewer.chime-on-arrivals")).toBe("true");
    setChimeEnabled(false);
    expect(isChimeEnabled()).toBe(false);
  });

  it("plays one plain bell, two partials, on one context", () => {
    setChimeEnabled(true);
    expect(playArrivalChime()).toBe(true);
    expect(playArrivalChime()).toBe(true);
    expect(CountingAudioContext.created).toBe(1);
    expect(CountingAudioContext.started).toBe(4);
  });
});

describe("which arrivals chime", () => {
  it("chimes for nothing on the first snapshot, however busy the board", () => {
    expect(chimeWorthy(null, [request("a"), request("b")], ME)).toEqual({ arrivals: [], escalations: [] });
  });

  it("chimes once for a new request nobody owns, and never for one somebody already has", () => {
    const memory = rememberForChime([request("a")]);
    const decision = chimeWorthy(memory, [request("a"), request("b"), request("c", { state: "accepted", ownerUserId: ADMIN.id, ownerName: "Fiona" })], ME);
    expect(decision.arrivals).toEqual(["b"]);
    expect(decision.escalations).toEqual([]);
    // The same snapshot again is a tick, not an arrival.
    const again = rememberForChime([request("a"), request("b")]);
    expect(chimeWorthy(again, [request("a"), request("b")], ME)).toEqual({ arrivals: [], escalations: [] });
  });

  it("does not chime for this person's own ask", () => {
    const memory = rememberForChime([]);
    expect(chimeWorthy(memory, [request("mine", { requestedByUserId: ME.id })], ME).arrivals).toEqual([]);
  });

  it("chimes for an administrator when a request they already knew is escalated, once", () => {
    const memory = rememberForChime([request("a")]);
    const escalated = request("a", { escalatedAt: "2026-10-10T10:03:00.000Z" });
    expect(chimeWorthy(memory, [escalated], ADMIN).escalations).toEqual(["a"]);
    expect(chimeWorthy(memory, [escalated], ME).escalations).toEqual([]);
    expect(chimeWorthy(rememberForChime([escalated]), [escalated], ADMIN).escalations).toEqual([]);
  });

  it("counts a request that is new and already escalated once, as an arrival", () => {
    const decision = chimeWorthy(rememberForChime([]), [request("a", { escalatedAt: "2026-10-10T10:03:00.000Z" })], ADMIN);
    expect(decision).toEqual({ arrivals: ["a"], escalations: [] });
  });
});
