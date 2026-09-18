import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeFramePacer, type NativeFramePacer } from "../native-frame-pacer.js";
import type { NativeGpuWorkResult } from "../native-gpu-completion.js";

interface ControlledTicket {
  result: NativeGpuWorkResult;
  readonly completion: Promise<void>;
  readonly signal: AbortSignal;
  readonly poll: ReturnType<typeof vi.fn<() => NativeGpuWorkResult>>;
  resolve(): void;
  reject(cause: Error): void;
}

const owners: NativeFramePacer[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); });

function setup() {
  let time = 0;
  const tickets: ControlledTicket[] = [];
  const invalidate = vi.fn();
  const onError = vi.fn();
  const createTicket = vi.fn((signal: AbortSignal): ControlledTicket => {
    let resolve = (): void => { throw new Error("Ticket not initialized"); };
    let reject = (_cause: Error): void => { throw new Error("Ticket not initialized"); };
    const completion = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    const ticket: ControlledTicket = {
      result: { status: "pending" }, completion, signal,
      poll: vi.fn(() => ticket.result), resolve, reject,
    };
    signal.addEventListener("abort", () => {
      ticket.result = { status: "failed", error: new DOMException("Cancelled", "AbortError") };
      ticket.reject(ticket.result.error);
    }, { once: true });
    tickets.push(ticket);
    return ticket;
  });
  const pacer = createNativeFramePacer({ createTicket, invalidate, onError, now: () => time });
  owners.push(pacer);
  const ticket = (index: number): ControlledTicket => {
    const found = tickets[index];
    if (found === undefined) throw new Error(`Missing ticket ${String(index)}`);
    return found;
  };
  const complete = async (index: number, completedAt: number): Promise<void> => {
    const current = ticket(index);
    current.result = { status: "complete", completedAt };
    current.resolve();
    await Promise.resolve();
  };
  return { pacer, tickets, ticket, complete, createTicket, invalidate, onError,
    setTime: (value: number): void => { time = value; } };
}

describe("native automatic frame pacing", () => {
  it("bounds submissions at two, coalesces many attempts and draws only fresh state after a single wake", async () => {
    const h = setup();
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    h.pacer.request(draw);
    const obsolete = vi.fn(() => true);
    for (let i = 0; i < 20; i++) h.pacer.request(obsolete);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(obsolete).not.toHaveBeenCalled();
    expect(h.tickets).toHaveLength(2);
    await h.complete(0, 10);
    await h.complete(1, 12);
    expect(h.invalidate).toHaveBeenCalledOnce();
    expect(obsolete).not.toHaveBeenCalled();
    const current = vi.fn(() => true);
    h.pacer.request(current);
    expect(current).toHaveBeenCalledOnce();
    expect(h.tickets).toHaveLength(3);
  });

  it("does not manufacture frames when submitted work finishes with no skipped request", async () => {
    const h = setup();
    h.pacer.request(() => true);
    h.pacer.request(() => true);
    await h.complete(0, 8);
    await h.complete(1, 9);
    expect(h.invalidate).not.toHaveBeenCalled();
    expect(h.tickets).toHaveLength(2);
  });

  it("polls finished tickets synchronously before capacity and suppresses their later duplicate wake", async () => {
    const h = setup();
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    h.pacer.request(draw);
    h.pacer.request(draw);
    h.ticket(0).result = { status: "complete", completedAt: 5 };
    h.ticket(1).result = { status: "complete", completedAt: 7 };
    h.setTime(8);
    h.pacer.request(draw);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(h.invalidate).not.toHaveBeenCalled();
    h.ticket(0).resolve();
    h.ticket(1).resolve();
    await Promise.resolve();
    expect(h.invalidate).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("reduces capacity after a slow completion and drains the second live ticket before waking", async () => {
    const h = setup();
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    h.pacer.request(draw);
    h.pacer.request(draw);
    await h.complete(0, 60);
    expect(h.invalidate).not.toHaveBeenCalled();
    h.pacer.request(draw);
    expect(draw).toHaveBeenCalledTimes(2);
    await h.complete(1, 65);
    expect(h.invalidate).toHaveBeenCalledOnce();
    h.setTime(70);
    h.pacer.request(draw);
    h.pacer.request(draw);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it("restores two slots only after three consecutive completions below 25 ms", async () => {
    const h = setup();
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    await h.complete(0, 51);
    for (const [start, elapsed] of [[100, 10], [200, 25], [300, 10], [400, 10]] as const) {
      h.setTime(start);
      const count = h.tickets.length;
      h.pacer.request(draw);
      h.pacer.request(draw);
      expect(h.tickets).toHaveLength(count + 1);
      await h.complete(count, start + elapsed);
    }
    h.setTime(500);
    h.pacer.request(draw);
    h.pacer.request(draw);
    expect(h.tickets).toHaveLength(6);
    await h.complete(5, 510);
    h.setTime(600);
    h.pacer.request(draw);
    h.pacer.request(draw);
    h.pacer.request(draw);
    expect(h.tickets).toHaveLength(8);
  });

  it.each([[50, 2], [50.01, 1]])("uses the strict slow threshold for %s ms completion", async (elapsed, allowed) => {
    const h = setup();
    h.pacer.request(() => true);
    await h.complete(0, elapsed);
    h.setTime(100);
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    h.pacer.request(draw);
    expect(draw).toHaveBeenCalledTimes(allowed);
  });

  it("includes synchronous draw time and uses observed completion time instead of promise-delivery time", async () => {
    const h = setup();
    h.pacer.request(() => { h.setTime(60); return true; });
    await h.complete(0, 65); // Only 5 ms after ticket creation, but 65 ms since submission began.
    const draw = vi.fn(() => true);
    h.setTime(100);
    h.pacer.request(draw);
    h.pacer.request(draw);
    expect(draw).toHaveBeenCalledOnce();
    h.setTime(1000); // Delayed JavaScript delivery must not make this 10 ms completion slow.
    await h.complete(1, 110);
    h.setTime(1100);
    h.pacer.request(draw);
    await h.complete(2, 1110);
    h.setTime(1200);
    h.pacer.request(draw);
    await h.complete(3, 1210);
    h.pacer.request(draw);
    h.pacer.request(draw);
    expect(h.tickets).toHaveLength(6);
  });

  it("cancels all work and ignores late completions after disposal", async () => {
    const h = setup();
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    h.pacer.request(draw);
    h.pacer.request(draw);
    h.pacer.dispose();
    expect(h.tickets.every(ticket => ticket.signal.aborted)).toBe(true);
    await h.complete(0, 20);
    await h.complete(1, 21);
    h.pacer.request(draw);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(h.invalidate).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("reports a ticket failure once, aborts its peers and cannot wake a failed owner", async () => {
    const h = setup();
    h.pacer.request(() => true);
    h.pacer.request(() => true);
    h.pacer.request(() => true);
    const failure = new Error("GPU was lost");
    h.ticket(0).reject(failure);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(h.tickets.every(ticket => ticket.signal.aborted)).toBe(true);
    expect(h.invalidate).not.toHaveBeenCalled();
    const late = vi.fn(() => true);
    h.pacer.request(late);
    expect(late).not.toHaveBeenCalled();
  });

  it("stops before another draw if synchronous polling reports a failed fence", () => {
    const h = setup();
    h.pacer.request(() => true);
    const failure = new Error("Fence poll failed");
    h.ticket(0).result = { status: "failed", error: failure };
    const draw = vi.fn(() => true);
    h.pacer.request(draw);
    expect(draw).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("handles thrown polling and ticket creation through the same failure boundary", () => {
    const polling = setup();
    polling.pacer.request(() => true);
    const pollFailure = new Error("Context unavailable");
    polling.ticket(0).poll.mockImplementationOnce(() => { throw pollFailure; });
    polling.pacer.request(() => true);
    expect(polling.onError).toHaveBeenCalledExactlyOnceWith(pollFailure);

    const creating = setup();
    const createFailure = new Error("Cannot create GPU fence");
    creating.createTicket.mockImplementationOnce(() => { throw createFailure; });
    creating.pacer.request(() => true);
    expect(creating.onError).toHaveBeenCalledExactlyOnceWith(createFailure);
    expect(creating.createTicket.mock.calls[0]?.[0].aborted).toBe(true);
  });

  it("creates no ticket for a failed or disposed draw and reports a thrown draw once", () => {
    const invalid = setup();
    invalid.pacer.request(() => false);
    invalid.pacer.request(() => true);
    expect(invalid.createTicket).not.toHaveBeenCalled();
    expect(invalid.onError).not.toHaveBeenCalled();

    const removed = setup();
    removed.pacer.request(() => { removed.pacer.dispose(); return true; });
    expect(removed.createTicket).not.toHaveBeenCalled();

    const failed = setup();
    const error = new Error("Render rejected");
    failed.pacer.request(() => { throw error; });
    expect(failed.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(failed.createTicket).not.toHaveBeenCalled();
  });

  it("coalesces a reentrant request without submitting inside an unfinished draw", async () => {
    const h = setup();
    const nested = vi.fn(() => true);
    h.pacer.request(() => { h.pacer.request(nested); return true; });
    expect(nested).not.toHaveBeenCalled();
    expect(h.tickets).toHaveLength(1);
    await h.complete(0, 5);
    expect(h.invalidate).toHaveBeenCalledOnce();
  });

  it("reports wake failures once and isolates a throwing failure observer", async () => {
    const h = setup();
    h.pacer.request(() => true);
    h.pacer.request(() => true);
    h.pacer.request(() => true);
    const error = new Error("Root was removed");
    h.invalidate.mockImplementation(() => { throw error; });
    h.onError.mockImplementation(() => { throw new Error("Observer failed too"); });
    await h.complete(0, 5);
    await Promise.resolve();
    expect(h.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(h.ticket(1).signal.aborted).toBe(true);
  });

  it("fails closed if a completion promise resolves before its result is terminal", async () => {
    const h = setup();
    h.pacer.request(() => true);
    h.ticket(0).resolve();
    await Promise.resolve();
    expect(h.onError).toHaveBeenCalledOnce();
    expect(h.onError.mock.calls[0]?.[0]).toEqual(new Error("Native GPU completion resolved without a terminal result"));
  });
});
