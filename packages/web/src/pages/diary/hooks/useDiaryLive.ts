import { useEffect, useRef, useState } from "react";
import type { DiaryCommand, DiaryCommandAck } from "@omnitwin/types";
import { API_URL } from "../../../config/env.js";
import { getAuthToken } from "../../../api/client.js";
import {
  COMMAND_ACK_TIMEOUT_MS,
  nextBackoffMs,
  parseLiveMessage,
  type LivePresenceUser,
} from "../lib/live-protocol.js";
import { setDiaryCommandChannel } from "../lib/diary-command-channel.js";

// ---------------------------------------------------------------------------
// useDiaryLive (T-497; Canon §15) — the Board's live subscription.
//
// Connects to /ws/diary, authenticates auto-save-style with the first
// message, answers heartbeats, and:
//   - diary.event  → onEvent() (the page refetches; server truth wins)
//   - presence     → colleague chips
//   - reconnect    → exponential backoff; a fresh snapshot is pulled on every
//                    RE-connect (hello after a drop), never trusted deltas.
//   - commands     → T-537: while authenticated, the hook registers a sender
//                    with the command-channel registry; api/diary.ts routes
//                    mutations through it. Acks settle in-flight promises by
//                    commandId; a drop rejects every in-flight command so
//                    the api layer falls back to REST.
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

    // T-537: commands awaiting their ack, keyed by commandId.
    const inFlight = new Map<
      string,
      { resolve: (ack: DiaryCommandAck) => void; reject: (reason: Error) => void; timer: number }
    >();

    const rejectAllInFlight = (reason: string): void => {
      for (const [, pending] of inFlight) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error(reason));
      }
      inFlight.clear();
    };

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
        // A frame can already be queued when cleanup runs — never let it
        // resurrect state on an unmounted hook (review P2).
        if (disposed || socket !== ws) return;
        const message = parseLiveMessage(frame.data);
        if (message === null) return;
        if (message.type === "hello") {
          const isReconnect = hadConnection;
          hadConnection = true;
          attempt = 0;
          setConnected(true);
          setPresence(message.presence);
          // T-537: the channel is open for commands — register the sender.
          setDiaryCommandChannel((command: DiaryCommand) => {
            return new Promise<DiaryCommandAck>((resolve, reject) => {
              if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
                reject(new Error("command channel closed"));
                return;
              }
              const timer = window.setTimeout(() => {
                inFlight.delete(command.commandId);
                reject(new Error("command ack timed out"));
              }, COMMAND_ACK_TIMEOUT_MS);
              inFlight.set(command.commandId, { resolve, reject, timer });
              ws.send(JSON.stringify({ type: "diary.command", command }));
            });
          });
          // Snapshot/delta doctrine: after a drop, refetch — never trust
          // whatever was missed while offline.
          if (isReconnect) onEventRef.current();
          return;
        }
        if (message.type === "diary.ack") {
          const pending = inFlight.get(message.commandId);
          if (pending !== undefined) {
            inFlight.delete(message.commandId);
            window.clearTimeout(pending.timer);
            pending.resolve(message);
          }
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
        // T-537: the channel died — unregister and fail every in-flight
        // command so the api layer falls back to REST immediately.
        setDiaryCommandChannel(null);
        rejectAllInFlight("command channel closed");
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
      setDiaryCommandChannel(null);
      rejectAllInFlight("diary live unmounted");
      socket?.close();
      socket = null;
      setConnected(false);
      setPresence([]);
    };
  }, [enabled]);

  return { connected, presence };
}
