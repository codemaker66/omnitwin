import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../../config/env.js";
import { getAuthToken } from "../../../api/client.js";
import {
  nextBackoffMs,
  parseLiveMessage,
  type LivePresenceUser,
} from "../lib/live-protocol.js";

// ---------------------------------------------------------------------------
// useDiaryLive (T-497; Canon §15) — the Board's live subscription.
//
// Connects to /ws/diary, authenticates auto-save-style with the first
// message, answers heartbeats, and:
//   - diary.event  → onEvent() (the page refetches; server truth wins)
//   - presence     → colleague chips
//   - reconnect    → exponential backoff; a fresh snapshot is pulled on every
//                    RE-connect (hello after a drop), never trusted deltas.
//
// Presence is advisory display, never a correctness mechanism (Canon §9).
// ---------------------------------------------------------------------------

const CLIENT_PING_MS = 15_000;

export interface DiaryLive {
  readonly connected: boolean;
  readonly presence: readonly LivePresenceUser[];
}

export function useDiaryLive(enabled: boolean, onEvent: () => void): DiaryLive {
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<readonly LivePresenceUser[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let hadConnection = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const wsUrl = `${API_URL.replace(/^http/u, "ws")}/ws/diary`;

    const stopPing = (): void => {
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const scheduleReconnect = (): void => {
      if (disposed) return;
      setConnected(false);
      const delay = nextBackoffMs(attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        connect();
      }, delay);
    };

    function connect(): void {
      if (disposed) return;
      const ws = new WebSocket(wsUrl);
      socket = ws;

      ws.onopen = () => {
        void (async () => {
          const token = await getAuthToken();
          if (token === null || disposed) {
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: "auth", token }));
          stopPing();
          pingTimer = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, CLIENT_PING_MS);
        })();
      };

      ws.onmessage = (frame: MessageEvent) => {
        const message = parseLiveMessage(frame.data);
        if (message === null) return;
        if (message.type === "hello") {
          const isReconnect = hadConnection;
          hadConnection = true;
          attempt = 0;
          setConnected(true);
          setPresence(message.presence);
          // Snapshot/delta doctrine: after a drop, refetch — never trust
          // whatever was missed while offline.
          if (isReconnect) onEventRef.current();
          return;
        }
        if (message.type === "presence") {
          setPresence(message.users);
          return;
        }
        if (message.type === "diary.event") {
          onEventRef.current();
          return;
        }
        if (message.type === "ping") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
          return;
        }
        if (message.type === "error") {
          ws.close();
        }
      };

      ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        stopPing();
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      stopPing();
      socket?.close();
      socket = null;
      setConnected(false);
      setPresence([]);
    };
  }, [enabled]);

  return { connected, presence };
}
