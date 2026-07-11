import { describe, expect, it } from "vitest";
import { popMove, pushMove, type UndoEntry } from "../undo-stack.js";

function entry(id: string, atMs: number): UndoEntry {
  return {
    bookingId: id,
    title: `Booking ${id}`,
    before: { spaceId: "a", startsAt: "2026-09-18T17:00:00.000Z", endsAt: "2026-09-18T23:00:00.000Z" },
    after: { spaceId: "b", startsAt: "2026-09-18T18:00:00.000Z", endsAt: "2026-09-19T00:00:00.000Z" },
    atMs,
  };
}

describe("undo stack", () => {
  it("pushes and pops in LIFO order without mutating inputs", () => {
    const first = pushMove([], entry("1", 1));
    const second = pushMove(first, entry("2", 2));
    expect(first).toHaveLength(1);
    const { entry: popped, stack } = popMove(second);
    expect(popped?.bookingId).toBe("2");
    expect(stack).toHaveLength(1);
    expect(second).toHaveLength(2);
  });

  it("caps the history at the limit, dropping the oldest", () => {
    let stack: readonly UndoEntry[] = [];
    for (let i = 0; i < 25; i += 1) stack = pushMove(stack, entry(String(i), i), 20);
    expect(stack).toHaveLength(20);
    expect(stack[0]?.bookingId).toBe("5");
  });

  it("popping an empty stack yields null", () => {
    expect(popMove([]).entry).toBeNull();
  });
});
