import { useEffect, useRef, useState } from "react";
import type { ConversationEvent } from "@omnitwin/types";
import { conversationCursor, subscribeRequestsLive } from "../lib/requests-live.js";

// ---------------------------------------------------------------------------
// useConversationLive (goal 19 S2) — the staff side of a conversation, beside
// useDiaryLive.
//
// One socket for the signed-in app (lib/requests-live.ts) already carries
// request frames; it now carries `conversation.event` frames too, each with
// the message's cursor. This hook hands them to a surface and keeps the
// reconnect doctrine honest:
//
//   connected  → every frame is a nudge: "a message landed in thread T";
//                the surface fetches the thread forward from its cursor.
//   reconnect  → the socket re-authenticates with the last cursor it saw, the
//                server replays every event after it, then says caughtUp;
//                only then does the surface refetch its snapshot. Replay
//                first, snapshot second, never trusted deltas.
//
// Audience is decided on the server per connection; a frame that arrives
// here was already admitted for this person.
// ---------------------------------------------------------------------------

export type ConversationLiveEvent =
  | { readonly kind: "message"; readonly event: ConversationEvent }
  /** The server has replayed everything after the cursor it was given. */
  | { readonly kind: "caughtUp"; readonly cursor: number }
  /** The socket came back: wait for caughtUp, then refetch the snapshot. */
  | { readonly kind: "reconnected" };

export interface ConversationLive {
  readonly connected: boolean;
  /** The newest cursor this app has seen on the socket. */
  readonly lastCursor: number;
  /** False between a reconnect and the server's caughtUp. */
  readonly caughtUp: boolean;
}

export function useConversationLive(
  enabled: boolean,
  onEvent: (event: ConversationLiveEvent) => void,
): ConversationLive {
  const [connected, setConnected] = useState(false);
  const [lastCursor, setLastCursor] = useState(() => conversationCursor());
  const [caughtUp, setCaughtUp] = useState(true);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeRequestsLive((event) => {
      switch (event.kind) {
        case "connection":
          setConnected(event.connected);
          return;
        case "reconnected":
          setCaughtUp(false);
          onEventRef.current({ kind: "reconnected" });
          return;
        case "conversation":
          setLastCursor((current) => Math.max(current, event.event.cursor));
          onEventRef.current({ kind: "message", event: event.event });
          return;
        case "caughtUp":
          setLastCursor((current) => Math.max(current, event.cursor));
          setCaughtUp(true);
          onEventRef.current({ kind: "caughtUp", cursor: event.cursor });
          return;
        default:
          return;
      }
    });
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [enabled]);

  return { connected, lastCursor, caughtUp };
}
