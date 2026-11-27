import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot, Message } from "@omnitwin/types";
import { getEventConversation } from "../../api/conversations.js";
import { mergeByCursor, useEventConversation } from "../use-event-conversation.js";

vi.mock("../../api/conversations.js", () => ({ getEventConversation: vi.fn() }));
const read = vi.mocked(getEventConversation);

const EVENT = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";

function message(cursor: number, body: string): Message {
  return {
    id: `00000000-0000-4000-8000-${String(cursor).padStart(12, "0")}`, threadId: THREAD, cursor, kind: "text",
    authorUserId: null, authorName: "Fiona", authorRole: "staff", body, createdAt: "2026-10-28T10:00:00.000Z", receipts: [],
  };
}

function snapshot(messages: readonly Message[], cursor: number): ConversationSnapshot {
  return { eventId: EVENT, threads: [], messages: [...messages], cursor, serverNowMs: Date.now() };
}

beforeEach(() => { read.mockReset(); });
afterEach(() => { cleanup(); });

describe("useEventConversation", () => {
  it("puts a message that arrives after a later one in its place, once, and never moves the cursor back (supplier-requests-5)", async () => {
    read.mockResolvedValueOnce(snapshot([message(1, "Could we come at nine?"), message(3, "Nine is fine.")], 3));
    const { result } = renderHook(() => useEventConversation(EVENT, { pollMs: 60_000 }));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });

    // A read that brings the message between them, and one already shown.
    read.mockResolvedValueOnce(snapshot([message(2, "Fiona has this"), message(3, "Nine is fine.")], 2));
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(result.current.messages).toHaveLength(3); });
    expect(result.current.messages.map((item) => item.body)).toEqual(["Could we come at nine?", "Fiona has this", "Nine is fine."]);
    expect(result.current.cursor).toBe(3);
    expect(read).toHaveBeenLastCalledWith(EVENT, 3, expect.any(AbortSignal));
  });

  it("keeps the same list when nothing new arrives", () => {
    const shown = [message(1, "One"), message(2, "Two")];
    expect(mergeByCursor(shown, [message(2, "Two")])).toBe(shown);
  });
});
