import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  MESSAGE_BODY_MAX,
  describeRequestKind,
  type Message,
  type Thread,
  type ThreadAudience,
  type VenueRequest,
} from "@omnitwin/types";
import { listMessages, listThreads, markReceipt, openThread, sendMessage } from "../../api/conversations.js";
import { useConversationLive, type ConversationLiveEvent } from "../../hooks/use-conversation-live.js";
import { subscribeRequestsLive } from "../../lib/requests-live.js";
import { VENUE_TIME_ZONE, formatWallTime } from "../../pages/diary/lib/board-time.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { mintRequestKey } from "../requests/requests-context.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./slot-conversation.css";

// ---------------------------------------------------------------------------
// The slot's conversation (goal 19 S4; D4, D5, D6).
//
// A tap on a slot opens its threads: the floor's own notes on the booking
// (staff-private, opened on the first note), the thread of every request made
// against the slot, and, for the office, the thread the client can read. One
// tab per thread, never a merged feed, because the AUDIENCE is the point: a
// client-facing thread wears the copper "Client can read this" badge on its
// tab, its header and its composer, so nobody types a private note into it.
//
// Honest, never fabricated: a tick on a message of your own comes from the
// receipts the server recorded ("Seen by Elaine 14:02"); everybody else's
// messages carry none. A send mints one key per draft, so pressing Send again
// after a failure replays the same message rather than making a second. Live
// frames nudge the open thread to fetch forward from its cursor; a reconnect
// waits for caughtUp and then refetches, as every surface on the socket does.
// ---------------------------------------------------------------------------

export interface SlotConversationProps {
  readonly bookingId: string;
  readonly roomName: string;
  /** The slot's open requests, from the one provider snapshot: each names
   *  its thread and the words its tab reads. */
  readonly requests: readonly VenueRequest[];
}

interface ThreadPage {
  readonly messages: readonly Message[];
  readonly cursor: number;
}

interface Tab {
  readonly key: string;
  readonly label: string;
  readonly audience: ThreadAudience;
  /** Null for the floor's notes before the first one is written. */
  readonly thread: Thread | null;
}

const FLOOR_KEY = "floor";
const PAGE_LIMIT = 200;
/** Messages this device has already told the server it read or noted, so a
 *  thread reopened an hour later does not say so twice. */
const marked = new Set<string>();
const noted = new Set<string>();

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : "That could not be sent — try again in a moment.";
}

function whatWasAsked(request: VenueRequest): string {
  return request.quantity === null
    ? describeRequestKind(request.kind)
    : `${describeRequestKind(request.kind)} × ${String(request.quantity)}`;
}

/** The receipts of a message of your own, as words: who pressed, who has
 *  read it, who has it. Nothing for a message that is not yours. */
export function receiptLine(message: Message, meId: string | null): string | null {
  if (message.authorUserId === null || message.authorUserId !== meId || message.receipts.length === 0) return null;
  const acknowledged = message.receipts.filter((receipt) => receipt.acknowledgedAt !== null);
  if (acknowledged.length > 0) return `Noted by ${acknowledged.map((receipt) => receipt.recipientName).join(", ")}`;
  const read = message.receipts.filter((receipt) => receipt.readAt !== null);
  const first = read[0];
  if (first !== undefined && first.readAt !== null) {
    return `Seen by ${read.map((receipt) => receipt.recipientName).join(", ")} ${formatWallTime(Date.parse(first.readAt), VENUE_TIME_ZONE)}`;
  }
  return `Delivered to ${message.receipts.map((receipt) => receipt.recipientName).join(", ")}`;
}

function mergePage(current: ThreadPage | undefined, fresh: ThreadPage, replace: boolean): ThreadPage {
  if (replace || current === undefined) return fresh;
  const known = new Set(current.messages.map((message) => message.id));
  const added = fresh.messages.filter((message) => !known.has(message.id));
  return {
    messages: added.length === 0 ? current.messages : [...current.messages, ...added],
    cursor: Math.max(current.cursor, fresh.cursor),
  };
}

export function SlotConversation({ bookingId, roomName, requests }: SlotConversationProps): ReactElement | null {
  const user = useAuthStore((state) => state.user);
  const venueId = user?.venueId ?? null;
  const meId = user?.id ?? null;

  const [threads, setThreads] = useState<readonly Thread[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState(FLOOR_KEY);
  const [pages, setPages] = useState<ReadonlyMap<string, ThreadPage>>(() => new Map());
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // One key per draft: a resend after a failure is the same message.
  const [draftKey, setDraftKey] = useState(mintRequestKey);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [notedIds, setNotedIds] = useState<ReadonlySet<string>>(() => new Set(noted));
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // --- the threads of this slot -------------------------------------------
  const requestKey = requests.map((request) => request.threadId ?? "").join("|");
  const loadThreads = useCallback((): void => {
    if (venueId === null) return;
    void listThreads(venueId, { bookingId })
      .then((rows) => { setThreads(rows); setThreadsError(null); })
      .catch((cause: unknown) => { setThreadsError(messageFor(cause)); setThreads((current) => current ?? []); });
  }, [venueId, bookingId]);
  useEffect(() => { loadThreads(); }, [loadThreads, requestKey]);

  const tabs = useMemo<readonly Tab[]>(() => {
    const rows = threads ?? [];
    const floor = rows.find((thread) => thread.subject === "booking" && thread.audience === "staff-private") ?? null;
    const withClient = rows.find((thread) => thread.subject === "booking" && thread.audience === "client-facing") ?? null;
    const byThreadId = new Map(requests.filter((request) => request.threadId !== null).map((request) => [request.threadId ?? "", request]));
    const requestTabs = rows
      .filter((thread) => thread.subject === "request")
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((thread): Tab => {
        const request = byThreadId.get(thread.id);
        return { key: thread.id, label: request === undefined ? thread.title ?? "Request" : whatWasAsked(request), audience: thread.audience, thread };
      });
    return [
      { key: FLOOR_KEY, label: "Floor notes", audience: "staff-private", thread: floor },
      ...(withClient === null ? [] : [{ key: withClient.id, label: "With the client", audience: "client-facing" as const, thread: withClient }]),
      ...requestTabs,
    ];
  }, [threads, requests]);

  const selected = tabs.find((tab) => tab.key === selectedKey) ?? tabs[0] ?? null;
  const selectedThreadId = selected?.thread?.id ?? null;
  const page = selectedThreadId === null ? undefined : pages.get(selectedThreadId);

  // --- messages, from the cursor -------------------------------------------
  const fetchThread = useCallback((threadId: string, replace: boolean): void => {
    const after = replace ? 0 : pagesRef.current.get(threadId)?.cursor ?? 0;
    if (replace || after === 0) setLoadingThreadId((current) => current ?? threadId);
    void listMessages(threadId, { after, limit: PAGE_LIMIT })
      .then((fresh) => {
        const before = pagesRef.current.get(threadId);
        const known = new Set(before?.messages.map((message) => message.id) ?? []);
        const newcomer = fresh.messages.find((message) => !known.has(message.id) && message.authorUserId !== meId && message.kind !== "system");
        if (newcomer !== undefined && before !== undefined) setAnnouncement(`New message from ${newcomer.authorName}`);
        setPages((current) => {
          const next = new Map(current);
          next.set(threadId, mergePage(current.get(threadId), { messages: fresh.messages, cursor: fresh.cursor }, replace));
          return next;
        });
      })
      .catch(() => {
        // The thread keeps what it had; the next nudge or reopen asks again.
      })
      .finally(() => { setLoadingThreadId((current) => (current === threadId ? null : current)); });
  }, [meId]);

  useEffect(() => {
    if (selectedThreadId === null) return;
    fetchThread(selectedThreadId, pagesRef.current.get(selectedThreadId) === undefined);
  }, [selectedThreadId, fetchThread]);

  // Live: a message in the open thread fetches forward; caughtUp after a
  // reconnect refetches it and the thread list; a request step (a system
  // line the request wrote) nudges the request's own thread.
  const selectedRequestId = selected?.thread?.requestId ?? null;
  const onLive = useCallback((event: ConversationLiveEvent): void => {
    if (event.kind === "message") {
      if (selectedThreadId !== null && event.event.threadId === selectedThreadId) fetchThread(selectedThreadId, false);
      return;
    }
    if (event.kind === "caughtUp") {
      loadThreads();
      if (selectedThreadId !== null) fetchThread(selectedThreadId, true);
    }
  }, [selectedThreadId, fetchThread, loadThreads]);
  useConversationLive(venueId !== null, onLive);
  useEffect(() => {
    if (venueId === null) return;
    return subscribeRequestsLive((event) => {
      if (event.kind !== "request" || event.venueId !== venueId) return;
      if (selectedThreadId !== null && selectedRequestId !== null && event.requestId === selectedRequestId) fetchThread(selectedThreadId, false);
    });
  }, [venueId, selectedThreadId, selectedRequestId, fetchThread]);

  // Read, as a fact: this screen has the thread open and the page is visible.
  useEffect(() => {
    if (page === undefined || typeof document === "undefined" || document.visibilityState !== "visible") return;
    for (const message of page.messages) {
      if (message.authorUserId === null || message.authorUserId === meId || marked.has(message.id)) continue;
      marked.add(message.id);
      void markReceipt(message.id, { mark: "read" }).catch(() => { marked.delete(message.id); });
    }
  }, [page, meId]);

  const note = useCallback((message: Message): void => {
    if (noted.has(message.id)) return;
    noted.add(message.id);
    setNotedIds(new Set(noted));
    void markReceipt(message.id, { mark: "acknowledged" }).catch(() => {
      noted.delete(message.id);
      setNotedIds(new Set(noted));
    });
  }, []);

  // --- sending ------------------------------------------------------------
  const submit = useCallback((): void => {
    if (selected === null || venueId === null || sending) return;
    const body = draft.trim();
    if (body === "") return;
    setSending(true);
    setSendError(null);
    void (async () => {
      try {
        let thread = selected.thread;
        if (thread === null) {
          // The floor's first note opens the floor's thread; get-or-create on
          // the server, so two phones writing at once share one thread.
          thread = await openThread(venueId, { audience: "staff-private", subject: "booking", bookingId });
          const opened = thread;
          setThreads((current) => (current ?? []).some((row) => row.id === opened.id) ? current : [...(current ?? []), opened]);
          setSelectedKey(FLOOR_KEY);
        }
        const message = await sendMessage(thread.id, { body, idempotencyKey: draftKey });
        const threadId = thread.id;
        setPages((current) => {
          const next = new Map(current);
          next.set(threadId, mergePage(current.get(threadId), { messages: [message], cursor: message.cursor }, false));
          return next;
        });
        setDraft("");
        setDraftKey(mintRequestKey());
      } catch (cause: unknown) {
        setSendError(messageFor(cause));
      } finally {
        setSending(false);
      }
    })();
  }, [selected, venueId, sending, draft, draftKey, bookingId]);

  if (venueId === null || selected === null) return null;
  const clientFacing = selected.audience === "client-facing";
  const composerLabel = clientFacing ? "Reply to the client" : "Note to the floor";
  const loading = threads === null || (selectedThreadId !== null && loadingThreadId === selectedThreadId && page === undefined);
  const panelId = `vv-conversation-panel-${bookingId}`;

  return (
    <div className="vv-conversation" data-audience={selected.audience}>
      <div className="vv-conversation-tabs" role="tablist" aria-label={`Conversations for ${roomName}`}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`vv-conversation-tab-${bookingId}-${tab.key}`}
            className="vv-conversation-tab"
            aria-selected={tab.key === selected.key}
            aria-controls={panelId}
            data-audience={tab.audience}
            onClick={() => { setSelectedKey(tab.key); setSendError(null); }}
          >
            {tab.label}
            {tab.audience === "client-facing" && <span className="vv-thread-badge">Client can read this</span>}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`vv-conversation-tab-${bookingId}-${selected.key}`} className="vv-conversation-panel">
        {threadsError !== null && <p className="vv-conversation-note" role="alert">{threadsError}</p>}
        {loading ? (
          <ActivityStatus>Opening the conversation…</ActivityStatus>
        ) : page === undefined || page.messages.length === 0 ? (
          <p className="vv-conversation-note">
            {selected.thread === null
              ? "No notes yet. The first one opens the floor’s thread for this slot."
              : "Nothing said here yet."}
          </p>
        ) : (
          <ol className="vv-messages" aria-label="Messages">
            {page.messages.map((message) => {
              const mine = message.authorUserId !== null && message.authorUserId === meId;
              const receipt = receiptLine(message, meId);
              const canNote = !mine && message.kind !== "system" && !clientFacing;
              return (
                <li key={message.id} className="vv-message" data-kind={message.kind} data-mine={mine ? "true" : "false"}>
                  <p className="vv-message-who">
                    <span className="vv-message-author">{message.kind === "system" ? "Venviewer" : message.authorName}</span>
                    <span className="vv-message-when">{formatWallTime(Date.parse(message.createdAt), VENUE_TIME_ZONE)}</span>
                  </p>
                  <p className="vv-message-body">{message.body}</p>
                  {receipt !== null && <p className="vv-message-receipt">{receipt}</p>}
                  {canNote && (
                    notedIds.has(message.id)
                      ? <p className="vv-message-receipt">Noted</p>
                      : <button type="button" className="vv-message-note" onClick={() => { note(message); }}>Noted</button>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <form
          className="vv-conversation-composer"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          {clientFacing && <p className="vv-thread-badge vv-thread-badge--composer">Client can read this</p>}
          <label className="vv-conversation-field">
            {composerLabel}
            <textarea
              value={draft}
              maxLength={MESSAGE_BODY_MAX}
              rows={2}
              onChange={(event) => { setDraft(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
              }}
            />
          </label>
          <div className="vv-conversation-actions">
            <button type="submit" className="vv-request-action vv-request-action--take" disabled={sending || draft.trim() === ""} aria-busy={sending}>
              {sending ? <ActivityIndicator size={16} /> : null}
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {sendError !== null && !sending && <p className="vv-request-error" role="alert">{sendError}</p>}
        </form>
      </div>
      <span className="vv-conversation-announcer" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}

export default SlotConversation;
