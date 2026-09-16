import { z } from "zod";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "../api/client.js";
import { nextBackoffMs } from "../pages/diary/lib/live-protocol.js";

// ---------------------------------------------------------------------------
// The requests live channel (Ship Friday slice 10).
//
// ONE socket for the whole signed-in app, reference-counted by its listeners:
// it opens when the first surface that cares about requests mounts and closes
// when the last one leaves. It speaks the same /ws/diary protocol the Diary
// board already uses — same door, same authentication — but it deliberately
// does NOT register the T-537 command channel: this connection only listens.
//
// Reconnect replays rather than trusting deltas: after a drop, the listener
// is told "reconnected" and refetches the snapshot, exactly as the Diary does.
// A frame type this client does not know is ignored, so a newer server can
// speak a superset without breaking an older phone.
// ---------------------------------------------------------------------------

const CLIENT_PING_MS = 15_000;

const RequestEventFrame = z.object({
  type: z.literal("request.event"),
  venueId: z.string(),
  kind: z.string(),
  requestId: z.string(),
  bookingId: z.string().nullable(),
  roomId: z.string(),
  state: z.string(),
  at: z.string(),
});

const NotificationEventFrame = z.object({
  type: z.literal("notification.event"),
  venueId: z.string(),
  notificationIds: z.array(z.string()),
  title: z.string(),
  severity: z.string(),
  at: z.string(),
});

const HelloFrame = z.object({ type: z.literal("hello"), venueId: z.string() });
const PingFrame = z.object({ type: z.literal("ping") });
const ErrorFrame = z.object({ type: z.literal("error") });

export type RequestsLiveEvent =
  | {
      readonly kind: "request";
      readonly venueId: string;
      readonly requestId: string;
      readonly bookingId: string | null;
    }
  | { readonly kind: "notification"; readonly venueId: string }
  | { readonly kind: "reconnected" }
  | { readonly kind: "connection"; readonly connected: boolean };

type Listener = (event: RequestsLiveEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let attempt = 0;
let hadConnection = false;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let closing = false;

function announce(event: RequestsLiveEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // One surface throwing must never starve the next.
    }
  }
}

function stopPing(): void {
  if (pingTimer !== null) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
}

function handleFrame(raw: unknown): void {
  if (typeof raw !== "string") return;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (HelloFrame.safeParse(data).success) {
    const isReconnect = hadConnection;
    hadConnection = true;
    attempt = 0;
    announce({ kind: "connection", connected: true });
    // Snapshot doctrine: after a drop, refetch. Never trust what was missed.
    if (isReconnect) announce({ kind: "reconnected" });
    return;
  }

  const request = RequestEventFrame.safeParse(data);
  if (request.success) {
    announce({
      kind: "request",
      venueId: request.data.venueId,
      requestId: request.data.requestId,
      bookingId: request.data.bookingId,
    });
    return;
  }

  const notification = NotificationEventFrame.safeParse(data);
  if (notification.success) {
    announce({ kind: "notification", venueId: notification.data.venueId });
    return;
  }

  if (PingFrame.safeParse(data).success) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    return;
  }

  if (ErrorFrame.safeParse(data).success) socket?.close();
}

function scheduleReconnect(): void {
  if (closing || listeners.size === 0) return;
  const delay = nextBackoffMs(attempt);
  attempt += 1;
  reconnectTimer = window.setTimeout(() => { connect(); }, delay);
}

function connect(): void {
  if (closing || listeners.size === 0 || typeof WebSocket === "undefined") return;
  if (socket !== null) return;

  const ws = new WebSocket(`${API_URL.replace(/^http/u, "ws")}/ws/diary`);
  socket = ws;

  ws.onopen = () => {
    void (async () => {
      const token = await getAuthToken();
      if (token === null || socket !== ws) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: "auth", token }));
      stopPing();
      pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, CLIENT_PING_MS);
    })();
  };

  ws.onmessage = (frame: MessageEvent) => {
    if (socket !== ws) return;
    handleFrame(frame.data);
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    stopPing();
    announce({ kind: "connection", connected: false });
    scheduleReconnect();
  };

  ws.onerror = () => { ws.close(); };
}

function teardown(): void {
  closing = true;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopPing();
  const current = socket;
  socket = null;
  hadConnection = false;
  attempt = 0;
  current?.close();
  closing = false;
}

/**
 * Listen for request and notification activity in the signed-in venue. The
 * first listener opens the socket; the last one to leave closes it.
 */
export function subscribeRequestsLive(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    closing = false;
    connect();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) teardown();
  };
}

/** Test seam: how many surfaces are currently listening. */
export function requestsLiveListenerCount(): number {
  return listeners.size;
}
