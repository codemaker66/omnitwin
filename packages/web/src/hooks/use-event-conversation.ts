import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, Thread } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { getEventConversation } from "../api/conversations.js";
import { observeServerNow } from "../lib/clock-offset.js";

// ---------------------------------------------------------------------------
// The client's side of a conversation (goal 19 D5, S2).
//
// A client cannot join the venue's socket, so their event page asks every
// five seconds while it is visible: "everything after the cursor I last
// saw". The answer is appended, never trusted as a replacement; a page that
// was hidden asks the moment it is shown again. Realtime for a client means
// seeing "Elaine has this" within five seconds, which this gives; S7 upgrades
// it to a token-authenticated socket if the measured experience needs it.
//
// A revoked link answers 403 the same instant and the poll stops: the page
// says so rather than asking forever.
// ---------------------------------------------------------------------------

export const EVENT_CONVERSATION_POLL_MS = 5_000;

export interface EventConversation {
  readonly status: "loading" | "ready" | "error";
  readonly threads: readonly Thread[];
  readonly messages: readonly Message[];
  /** The newest cursor seen; the next poll asks for everything after it. */
  readonly cursor: number;
  readonly error: string | null;
  /** True once the link has been refused: nothing more will be asked. */
  readonly closed: boolean;
  /** Ask now, regardless of the timer. */
  readonly refresh: () => void;
}

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function useEventConversation(
  eventId: string | null,
  options: { readonly pollMs?: number } = {},
): EventConversation {
  const pollMs = options.pollMs ?? EVENT_CONVERSATION_POLL_MS;
  const [status, setStatus] = useState<EventConversation["status"]>("loading");
  const [threads, setThreads] = useState<readonly Thread[]>([]);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const cursorRef = useRef(0);
  const closedRef = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  const ask = useCallback((): void => {
    if (eventId === null || closedRef.current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    sequence.current += 1;
    const mine = sequence.current;
    const after = cursorRef.current;
    void getEventConversation(eventId, after, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted || mine !== sequence.current) return;
        observeServerNow(snapshot.serverNowMs);
        setThreads(snapshot.threads);
        if (snapshot.messages.length > 0) {
          setMessages((current) => {
            const known = new Set(current.map((message) => message.id));
            const fresh = snapshot.messages.filter((message) => !known.has(message.id));
            return fresh.length === 0 ? current : [...current, ...fresh];
          });
        }
        if (snapshot.cursor > cursorRef.current) {
          cursorRef.current = snapshot.cursor;
          setCursor(snapshot.cursor);
        }
        setStatus("ready");
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || mine !== sequence.current) return;
        if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
          closedRef.current = true;
          setClosed(true);
          setStatus("error");
          setError(caught.status === 403
            ? "This event is no longer linked to your account."
            : "This event no longer exists.");
          return;
        }
        // A network wobble keeps what is on screen; the next tick asks again.
        setStatus((current) => (current === "loading" ? "error" : current));
        setError(caught instanceof Error && caught.message !== "" ? caught.message : "The conversation could not be read.");
      });
  }, [eventId]);

  // A new event starts from nothing.
  useEffect(() => {
    cursorRef.current = 0;
    closedRef.current = false;
    setCursor(0);
    setClosed(false);
    setThreads([]);
    setMessages([]);
    setStatus("loading");
    setError(null);
    if (eventId === null) return;
    ask();
    return () => { inFlight.current?.abort(); };
  }, [eventId, ask]);

  // The five-second ask, only while the page is visible; and at once when it
  // becomes visible again.
  useEffect(() => {
    if (eventId === null) return;
    const timer = window.setInterval(() => { if (visible()) ask(); }, pollMs);
    const onVisible = (): void => { if (visible()) ask(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [eventId, pollMs, ask]);

  return { status, threads, messages, cursor, error, closed, refresh: ask };
}
