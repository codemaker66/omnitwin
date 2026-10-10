import { z } from "zod";
import {
  ConversationCaughtUpSchema,
  ConversationEventSchema,
  isStaffAudienceRole,
  type ConversationEvent,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "../api/client.js";
import { observeServerNow } from "./clock-offset.js";
import { isE2EAuthBypassEnabled } from "./e2e-auth-bypass.js";
import { nextBackoffMs } from "../pages/diary/lib/live-protocol.js";

// ---------------------------------------------------------------------------
// The requests live channel (Ship Friday slice 10; goal 19 S2).
//
// ONE socket for the whole signed-in app, reference-counted by its listeners:
// it opens when the first surface that cares about requests mounts and closes
// when the last one leaves. It speaks the same /ws/diary protocol the Diary
// board already uses — same door, same authentication — but it deliberately
// does NOT register the T-537 command channel: this connection only listens,
// and it says so (presence: false), so its person is not counted as being on
// the Diary while they are on some other page.
//
// Goal 19 S2: the socket also carries `conversation.event` frames (a message
// landed, with its cursor) and feeds the one corrected clock from every
// frame's `serverNowMs`. It remembers the newest cursor it has seen and asks
// for a replay from there when it reconnects; the server replays what was
// missed, then says caughtUp, and only then do surfaces refetch their
// snapshot. Reconnect replays rather than trusting deltas, as the Diary does.
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
/** Any frame that carries the server's clock feeds it. */
const ClockFrame = z.object({ serverNowMs: z.number().int().positive() });

export type RequestsLiveEvent =
  | {
      readonly kind: "request";
      readonly venueId: string;
      readonly requestId: string;
      readonly bookingId: string | null;
    }
  | { readonly kind: "notification"; readonly venueId: string }
  /** A message landed in a thread this person's audience admits. */
  | { readonly kind: "conversation"; readonly venueId: string; readonly event: ConversationEvent }
  /** The server has replayed everything after the cursor it was given. */
  | { readonly kind: "caughtUp"; readonly cursor: number }
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
/** The newest conversation cursor this app has seen; kept across reconnects
 *  so the next auth asks for exactly what was missed. */
let lastCursor = 0;

/** The newest conversation cursor seen on this socket (0 before any). */
export function conversationCursor(): number {
  return lastCursor;
}

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

  // D9: the one clock, fed by every frame that carries it.
  const clock = ClockFrame.safeParse(data);
  if (clock.success) observeServerNow(clock.data.serverNowMs);

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

  const conversation = ConversationEventSchema.safeParse(data);
  if (conversation.success) {
    lastCursor = Math.max(lastCursor, conversation.data.cursor);
    announce({ kind: "conversation", venueId: conversation.data.venueId, event: conversation.data });
    return;
  }

  const caughtUp = ConversationCaughtUpSchema.safeParse(data);
  if (caughtUp.success) {
    lastCursor = Math.max(lastCursor, caughtUp.data.cursor);
    announce({ kind: "caughtUp", cursor: caughtUp.data.cursor });
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
  // The E2E harness answers HTTP from route mocks and runs no websocket
  // server, so a socket here can only fail — and a refused handshake is a
  // console error the BROWSER writes, which no `catch` can swallow and which
  // the accessibility audit rightly refuses to ignore. The listeners still
  // register and the snapshot is still fetched; only the live nudge is absent,
  // and the live path is proved against a real server instead.
  if (isE2EAuthBypassEnabled()) return;
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
      // presence: false — this connection only listens. Its person may be
      // on any page, so the Diary must not count them as "here". afterCursor
      // asks the server to replay the conversation stream from the newest
      // cursor this app saw before the drop.
      ws.send(JSON.stringify({
        type: "auth",
        token,
        presence: false,
        ...(lastCursor > 0 ? { afterCursor: lastCursor } : {}),
      }));
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
 * Whether this person can receive anything on the channel at all. Request
 * frames go to a request's stored audience, the floor's roles, and escalation
 * frames to the venue's administrators by name, who are on the floor too; the
 * server refuses /ws/diary to the client's side and the event-scoped caterer.
 * Anybody else would open a socket that carries nothing for them, or one the
 * server closes and the backoff reopens, so surfaces ask this first.
 */
export function listensForFloorRequests(
  user: { readonly role: string; readonly venueId: string | null } | null,
): boolean {
  return user !== null && user.venueId !== null && isStaffAudienceRole(user.role);
}

/**
 * Listen for request, notification and conversation activity in the
 * signed-in venue. The first listener opens the socket; the last one to
 * leave closes it.
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

/** Test seam: feed one frame as if the socket had received it. */
export function __handleFrameForTests(raw: string): void {
  handleFrame(raw);
}

/** Test seam: forget the cursor between cases. */
export function __resetConversationCursorForTests(): void {
  lastCursor = 0;
}
