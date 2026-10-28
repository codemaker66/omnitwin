import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { RecordFirstResponseResult } from "@omnitwin/types";
import * as enquiriesApi from "../../api/enquiries.js";
import type {
  Enquiry, EnquiryListOrder, EnquiryListQuery, EnquiryStageCounts, StatusHistoryEntry,
} from "../../api/enquiries.js";
import { ApiError } from "../../api/client.js";
import { createOpportunityFromEnquiry } from "../../api/crm.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import {
  appendEnquiryPage, describeEnquiryCount, ENQUIRY_PAGE_SIZE, firstPageWindow, hasMoreEnquiries,
  nextPageWindow, withoutListedEnquiry, type ListedEnquiries,
} from "./enquiry-list-paging.js";
import { EnquiryStages } from "./enquiries/EnquiryStages.js";
import { EnquiryLedger, enquiryName, type LedgerStamp } from "./enquiries/EnquiryLedger.js";
import { EnquiryPanel, type ConfirmTarget, type PanelDiary, type PanelReply, type TransitionTarget } from "./enquiries/EnquiryPanel.js";
import { EnquiryOverview } from "./enquiries/EnquiryOverview.js";
import { approveUnread, enquiryStanding } from "./enquiries/enquiry-standing.js";
import { useEnquiryDay } from "./enquiries/use-enquiry-day.js";
import { useVenueRooms } from "./enquiries/use-venue-rooms.js";
import { formatWallTime } from "../../pages/diary/lib/board-time.js";
import { dayAnswer } from "../../pages/diary/lib/day-answer.js";
import { canHoldDateFor, diaryHoldHref, holdRefusal } from "../../pages/diary/lib/enquiry-link.js";
import { deskGreeting, deskSummary, requestKind, stageLabel, type DeskFilter } from "./enquiries/enquiry-desk-format.js";
import { pendingFocusReady, type PendingFocus } from "./enquiries/desk-focus.js";
import { replyAlarmSummary } from "./enquiries/reply-format.js";
import { useReplyAlarm } from "./enquiries/use-reply-alarm.js";
import "./enquiries/EnquiriesDesk.css";

// ---------------------------------------------------------------------------
// EnquiriesView — the staff enquiries desk.
//
// The sheet lists enquiries newest first under the pipeline counts, which are
// also the filters; the decision panel beside it holds the open enquiry, so
// the list keeps its place while staff work through it. Below 1180px the two
// take turns, as the list and detail always did.
//
// Newest first by creation date. Whether staff would rather see the most
// recently active enquiries first is Blake's call; that order would need an
// `updated_desc` option (and index) in the API, which offers only
// `created_desc` and the default least-recently-updated order.
// ---------------------------------------------------------------------------

const LIST_ORDER: EnquiryListOrder = "created_desc";
const WIDE_DESK = "(min-width: 1180px)";
/** A Diary answer older than this says when it was read. */
const DIARY_STALE_MS = 2 * 60_000;

/** The list for one load of one stage filter. */
interface EnquiryListState extends ListedEnquiries {
  /** Identifies the load; a response for an older one is discarded. */
  readonly generation: number;
  readonly filter: DeskFilter;
  readonly status: "loading" | "ready" | "error";
  /** The order the server confirmed; null when an older API did not say. */
  readonly order: EnquiryListOrder | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  /** A later page could not be joined to the listed rows, or the finished
   *  list no longer matches the server's total. */
  readonly interrupted: boolean;
}

const UNLOADED_LIST: EnquiryListState = {
  generation: 0, filter: "all", status: "loading", rows: [], nextOffset: 0, total: 0,
  order: null, loadingMore: false, moreFailed: false, interrupted: false,
};

interface CountsState {
  readonly status: "loading" | "ready" | "error";
  /** The latest counts; kept while they are refreshed. */
  readonly value: EnquiryStageCounts | null;
}

interface HistoryState {
  readonly id: string | null;
  readonly entries: readonly StatusHistoryEntry[];
  readonly status: "loading" | "ready" | "error";
}

function listQuery(filter: DeskFilter): EnquiryListQuery {
  return filter === "all" ? { order: LIST_ORDER } : { status: filter, order: LIST_ORDER };
}

type CountedState = (typeof enquiriesApi.COUNTED_ENQUIRY_STATES)[number];

function isCountedState(state: string): state is CountedState {
  return (enquiriesApi.COUNTED_ENQUIRY_STATES as readonly string[]).includes(state);
}

/** The counts once one enquiry has moved between stages here, until the
 *  server's own counts replace them. */
function countsAfterMove(counts: EnquiryStageCounts, enquiryId: string, from: string, to: string): EnquiryStageCounts {
  const byState = { ...counts.byState };
  if (isCountedState(from)) byState[from] = Math.max(0, byState[from] - 1);
  if (isCountedState(to)) byState[to] += 1;
  return { ...counts, byState, longestWaiting: counts.longestWaiting?.id === enquiryId ? null : counts.longestWaiting };
}

const ANNOUNCEMENTS: Readonly<Record<string, string>> = {
  under_review: "Now in review.",
  approved: "Approved.",
  rejected: "Declined.",
  // The desk files only requests: they are marked done, and reopened.
  archived: "Marked done.",
  submitted: "Reopened.",
};

/** Empty-list words for each stage: an empty "New" is a finished job. */
const EMPTY_WORDS: Readonly<Record<DeskFilter, readonly [heading: string, detail: string]>> = {
  submitted: ["Nothing new to answer", "Every new enquiry has had a first look."],
  under_review: ["No decisions waiting", "Nothing is in review."],
  approved: ["No approved enquiries", "Approved enquiries appear here."],
  rejected: ["No declined enquiries", "Declined enquiries appear here."],
  withdrawn: ["No withdrawn enquiries", "Enquiries a client withdraws appear here."],
  all: ["No enquiries yet", "Enquiries from the venue’s website and planner arrive here."],
};

// ---------------------------------------------------------------------------
// Props — punch list #34
//
// `initialSelectedId` is set when the user navigates here from a different
// view (e.g. opening an enquiry from a client on the Clients desk). The component pre-selects
// that enquiry on mount AND fetches it independently via `getEnquiry`, so
// the decision panel renders even when the loaded pages of the current stage
// filter don't include it.
//
// `onDetailClose` is called when the user closes the open enquiry. When
// provided, the parent decides where that goes (e.g. restoring the
// client they came from). When omitted, closing returns to the desk.
// ---------------------------------------------------------------------------

interface EnquiriesViewProps {
  readonly initialSelectedId?: string | null;
  readonly onDetailClose?: () => void;
  /** Whether this actor may turn an enquiry into an opportunity. The API
   *  grants that to the venue's commercial team only, so offering the button
   *  to anyone else was an invitation to a 403. Passed down from the dashboard
   *  rather than re-derived here, so the client keeps ONE definition of who
   *  may reach the commercial surface.
   *
   *  Defaults to FALSE. It is a permission flag, and a permission flag that
   *  defaults to "allowed" fails open: a future mount that forgets to pass it
   *  would silently offer the control to every role. The cost of the safe
   *  default is a missing button on a surface that forgot to ask — a visible
   *  bug. The cost of the unsafe one is a role seeing a control it must not,
   *  which is invisible until someone presses it. */
  readonly canCreateOpportunity?: boolean;
  /** Opens the pipeline on the deal Create opportunity made or found, so the
   *  press lands on it rather than on a notice that it exists. */
  readonly onOpenOpportunity?: (opportunityId: string) => void;
  /** Whether this actor works at the venue and so is offered an AI summary
   *  of an enquiry: the general AI drafts are the venue team's, charged to
   *  its AI allowance, and refuse anyone else (T-656). A permission flag, so
   *  it defaults to false for the reason canCreateOpportunity does. */
  readonly canDraftWithAI?: boolean;
  /** Whether this actor writes the Diary, and so may hold a date there for
   *  an enquiry. A permission flag, so it defaults to false for the reason
   *  canCreateOpportunity does. */
  readonly canHoldDate?: boolean;
  /** The venue whose Diary this actor reads (Find's rule, diaryVenueOf):
   *  only that venue's enquiries say where they stand in the Diary. Null,
   *  the default, reads none, for the reason canCreateOpportunity defaults
   *  to false. */
  readonly diaryVenueId?: string | null;
  /** The venue whose enquiries this actor records replies to and reads the
   *  reply-time alarm for (replyVenueOf): the venue's commercial team only.
   *  Null, the default, offers neither, for the reason canCreateOpportunity
   *  defaults to false. */
  readonly replyVenueId?: string | null;
}

export function EnquiriesView({
  initialSelectedId = null,
  onDetailClose,
  canCreateOpportunity = false,
  onOpenOpportunity,
  canDraftWithAI = false,
  canHoldDate = false,
  diaryVenueId = null,
  replyVenueId = null,
}: EnquiriesViewProps = {}): ReactElement {
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const [list, setList] = useState<EnquiryListState>(UNLOADED_LIST);
  const [statusFilter, setStatusFilter] = useState<DeskFilter>("all");
  const [reloadCount, setReloadCount] = useState(0);
  const generationRef = useRef(0);
  const loadMoreRef = useRef<AbortController | null>(null);
  const [counts, setCounts] = useState<CountsState>({ status: "loading", value: null });
  const [countsVersion, setCountsVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // The enquiry the panel shows: the opened row, or the independent fetch
  // for the cross-view pre-selection case. It survives the list dropping the
  // row after a status change.
  const [openedEnquiry, setOpenedEnquiry] = useState<Enquiry | null>(null);
  const [preselectionLoading, setPreselectionLoading] = useState(initialSelectedId !== null);
  const [history, setHistory] = useState<HistoryState>({ id: null, entries: [], status: "ready" });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [confirming, setConfirming] = useState<ConfirmTarget | null>(null);
  // The status the enquiry showed when its confirmation was opened: the one
  // the person decided from, whatever a read landing meanwhile shows.
  const confirmFromRef = useRef<string | null>(null);
  const [saving, setSaving] = useState<TransitionTarget | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stamp, setStamp] = useState<LedgerStamp | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [moved, setMoved] = useState(0);
  const [creatingOpportunity, setCreatingOpportunity] = useState(false);
  // Said beside the button that failed, for the enquiry it failed on.
  const [opportunityFailure, setOpportunityFailure] = useState<{ readonly enquiryId: string; readonly message: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deskRef = useRef<HTMLDivElement>(null);
  const sheetHeadingRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedIdRef = useRef(selectedId);
  // Where the open enquiry sat in the list, so "next" still means the row
  // after it once a status change has taken it out of the filter.
  const [openedIndex, setOpenedIndex] = useState(-1);
  const pendingFocusRef = useRef<PendingFocus | null>(initialSelectedId === null ? null : { kind: "panel", id: initialSelectedId });
  const addToast = useToastStore((s) => s.addToast);
  const userName = useAuthStore((s) => s.user?.name ?? null);
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  // The reply-time alarm, read again after every change made here.
  const [alarmVersion, setAlarmVersion] = useState(0);
  const replyAlarm = useReplyAlarm(replyVenueId, alarmVersion);
  const [openingFlagged, setOpeningFlagged] = useState(false);
  // The read "Open the longest unanswered" waits on; opening anything else,
  // or leaving the desk, cancels it, so a late answer never takes the panel.
  const flaggedReadRef = useRef<AbortController | null>(null);
  useEffect(() => () => { flaggedReadRef.current?.abort(); }, []);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // "2 hours ago" stays true while the desk is open all day.
  useEffect(() => {
    const timer = window.setInterval(() => { setNowMs(Date.now()); }, 60_000);
    return () => { window.clearInterval(timer); };
  }, []);

  // A filter change or reload starts a new list: its first page, and any
  // in-flight first page or "show more" of the previous list, is aborted
  // and could not land anyway because its generation no longer matches.
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const controller = new AbortController();
    setList((previous) => ({
      ...UNLOADED_LIST,
      generation,
      filter: statusFilter,
      // A reload keeps the filter's rows visible until the new page lands.
      rows: previous.filter === statusFilter ? previous.rows : [],
    }));
    void enquiriesApi.listEnquiryPage({ ...listQuery(statusFilter), ...firstPageWindow() }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setList((previous) => previous.generation !== generation ? previous : {
          ...previous, status: "ready", rows: page.rows, nextOffset: page.offset + page.rows.length,
          total: page.total, order: page.order,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setList((previous) => previous.generation !== generation ? previous : { ...previous, status: "error" });
        addToast("Failed to load enquiries", "error");
      });
    return () => {
      controller.abort();
      loadMoreRef.current?.abort();
      loadMoreRef.current = null;
    };
  }, [statusFilter, reloadCount, addToast]);

  // The pipeline counts, refreshed after every change made here.
  useEffect(() => {
    const controller = new AbortController();
    setCounts((previous) => ({ ...previous, status: "loading" }));
    void enquiriesApi.countEnquiryStages(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCounts({ status: "ready", value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCounts((previous) => ({ ...previous, status: "error" }));
      });
    return () => { controller.abort(); };
  }, [countsVersion, reloadCount]);

  const showMore = useCallback((): void => {
    if (list.status !== "ready" || list.loadingMore || !hasMoreEnquiries(list)) return;
    const { generation, filter } = list;
    loadMoreRef.current?.abort();
    const controller = new AbortController();
    loadMoreRef.current = controller;
    setList((previous) => previous.generation !== generation ? previous
      : { ...previous, loadingMore: true, moreFailed: false });
    void enquiriesApi.listEnquiryPage({ ...listQuery(filter), ...nextPageWindow(list) }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setList((previous) => {
          if (previous.generation !== generation) return previous;
          const appended = appendEnquiryPage(previous, page);
          // A page in another order (an API redeployed mid-list) cannot be
          // joined either, and a finished list must hold what the total says.
          const finishedAdrift = !hasMoreEnquiries(appended) && appended.rows.length !== appended.total;
          return {
            ...previous, rows: appended.rows, nextOffset: appended.nextOffset, total: appended.total,
            loadingMore: false,
            interrupted: previous.interrupted || !appended.continuous || page.order !== previous.order || finishedAdrift,
          };
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setList((previous) => previous.generation !== generation ? previous
          : { ...previous, loadingMore: false, moreFailed: true });
      })
      .finally(() => {
        if (loadMoreRef.current === controller) loadMoreRef.current = null;
      });
  }, [list]);

  // Working through a stage empties its listed rows; when more wait on the
  // server, they follow without another click.
  const listRanDry = list.status === "ready" && list.rows.length === 0 && hasMoreEnquiries(list)
    && !list.loadingMore && !list.moreFailed;
  useEffect(() => {
    if (listRanDry) showMore();
  }, [listRanDry, showMore]);

  const reloadList = (): void => {
    setReloadCount((count) => count + 1);
    setAlarmVersion((version) => version + 1);
  };

  // When pre-selected via initialSelectedId, fetch the enquiry directly so
  // the panel can render regardless of the active stage filter.
  useEffect(() => {
    if (initialSelectedId === null) {
      setPreselectionLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreselectionLoading(true);
    setSelectedId(initialSelectedId);
    void enquiriesApi.getEnquiry(initialSelectedId, controller.signal)
      .then((enquiry) => {
        if (!controller.signal.aborted) setOpenedEnquiry(enquiry);
      })
      .catch(() => {
        if (!controller.signal.aborted) addToast("Failed to load enquiry", "error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreselectionLoading(false);
      });
    return () => { controller.abort(); };
  }, [initialSelectedId, addToast]);

  // Prefer the opened enquiry if it matches the selected id; otherwise fall
  // back to the list lookup.
  const selected = (openedEnquiry !== null && openedEnquiry.id === selectedId)
    ? openedEnquiry
    : list.rows.find((e) => e.id === selectedId);

  useEffect(() => {
    if (selectedId === null) {
      setHistory({ id: null, entries: [], status: "ready" });
      return;
    }
    const controller = new AbortController();
    // A refresh after a status change keeps the timeline it is extending.
    setHistory((previous) => previous.id === selectedId
      ? { ...previous, status: "loading" }
      : { id: selectedId, entries: [], status: "loading" });
    void enquiriesApi.getEnquiryHistory(selectedId, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setHistory({ id: selectedId, entries, status: "ready" });
      })
      .catch(() => {
        // An absent timeline does not block enquiry review.
        if (!controller.signal.aborted) setHistory((previous) => ({ ...previous, status: "error" }));
      });
    return () => { controller.abort(); };
  }, [selectedId, historyVersion]);

  // Keyboard focus follows the reader: into the panel when an enquiry opens,
  // back to its row when it closes. A request waits for the render that shows
  // its target (desk-focus.ts explains why).
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null || !pendingFocusReady(pending, { shownId: selected?.id ?? null, confirming })) return;
    if (pending.kind === "panel") {
      if (panelHeadingRef.current === null) return;
      pendingFocusRef.current = null;
      panelHeadingRef.current.focus();
      return;
    }
    pendingFocusRef.current = null;
    if (pending.kind === "action") {
      const action = deskRef.current?.querySelector<HTMLButtonElement>(`button[data-transition="${pending.to}"]`);
      (action ?? panelHeadingRef.current)?.focus();
      return;
    }
    const rows = deskRef.current?.querySelectorAll<HTMLButtonElement>("button[data-enquiry-id]") ?? [];
    const row = [...rows].find((button) => button.dataset.enquiryId === pending.id);
    (row ?? sheetHeadingRef.current)?.focus();
  });

  const { roomOf, venueOf } = useVenueRooms([
    ...list.rows.map((row) => row.venueId),
    ...(selected === undefined ? [] : [selected.venueId]),
    ...(counts.value?.longestWaiting === undefined || counts.value.longestWaiting === null ? [] : [counts.value.longestWaiting.venueId]),
  ]);

  // Where the open enquiry stands in the Diary (T-635): read only at the
  // venue whose Diary this person reads, and worded for the panel.
  const day = useEnquiryDay(selected, diaryVenueId);
  const venue = selected === undefined ? undefined : venueOf(selected.venueId);
  const standing = useMemo(() => {
    if (selected === undefined || day.answer === null) return null;
    const { answer } = day;
    const rooms = new Map(venue?.rooms ?? []);
    for (const room of answer.day?.rooms ?? []) rooms.set(room.id, { name: room.name, slug: room.slug });
    return enquiryStanding({
      enquiry: selected,
      day: answer.day === null ? null : {
        rooms: dayAnswer(answer.day.entries, answer.day.rooms, { startMs: answer.day.startMs, endMs: answer.day.endMs }, nowMs),
        startMs: answer.day.startMs,
        endMs: answer.day.endMs,
      },
      own: answer.own,
      rooms,
      published: venue?.published ?? false,
      nowMs,
    });
  }, [selected, day.answer, venue, nowMs]);

  // The panel's polite region says the answer once when a read lands after
  // the enquiry is opened, and again only when a later read changes it.
  const [diarySaid, setDiarySaid] = useState<string | null>(null);
  const saidRef = useRef<{ readonly id: string; readonly said: string; readonly landedAtMs: number } | null>(null);
  const openedAtRef = useRef(Date.now());
  const landedAtMs = day.answer?.readAtMs ?? null;
  const standingSaid = standing?.said ?? null;
  useEffect(() => {
    if (selectedId === null || standingSaid === null || landedAtMs === null || landedAtMs < openedAtRef.current) return;
    const previous = saidRef.current;
    if (previous !== null && previous.id === selectedId) {
      if (previous.landedAtMs === landedAtMs) return;
      saidRef.current = { id: selectedId, said: standingSaid, landedAtMs };
      if (previous.said === standingSaid) return;
    } else {
      saidRef.current = { id: selectedId, said: standingSaid, landedAtMs };
    }
    setDiarySaid(standingSaid);
  }, [selectedId, standingSaid, landedAtMs]);

  // What Approve says changes at most once: what was kept (or "Reading")
  // until the read Approve asks for lands, then that, and no more.
  const [approveRead, setApproveRead] = useState<{ readonly enquiryId: string; readonly after: number; readonly said: string | null } | null>(null);
  useEffect(() => {
    if (confirming !== "approved") setApproveRead(null);
  }, [confirming]);
  useEffect(() => {
    if (approveRead === null || approveRead.said !== null || day.settled <= approveRead.after) return;
    if (selected === undefined || selected.id !== approveRead.enquiryId) return;
    const said = day.failed || standing === null ? approveUnread(selected, roomOf(selected)?.name ?? null) : standing.approve;
    setApproveRead({ ...approveRead, said });
  }, [approveRead, day.settled, day.failed, selected, standing, roomOf]);

  const panelDiary = ((): PanelDiary | null => {
    if (selected === undefined || day.status === "off") return null;
    const frozen = approveRead !== null && approveRead.enquiryId === selected.id ? approveRead.said : null;
    const unread = day.status === "failed" ? approveUnread(selected, roomOf(selected)?.name ?? null) : null;
    const asked = day.plan?.day ?? null;
    return {
      status: day.status,
      standing,
      failed: day.failed,
      failure: asked === null ? "The Diary could not be read." : "The Diary could not be read for that day.",
      reading: day.reading,
      readAt: day.answer !== null && nowMs - day.answer.readAtMs > DIARY_STALE_MS ? formatWallTime(day.answer.readAtMs) : null,
      approve: frozen ?? standing?.approve ?? unread,
      // The drawer's own rule, so the link never opens onto a refusal.
      holdHref: canHoldDate && diaryVenueId !== null && canHoldDateFor(selected) && holdRefusal(selected, diaryVenueId) === null
        ? diaryHoldHref(selected) : null,
      dayHref: asked === null ? null : `/diary?${new URLSearchParams({ date: asked.iso, goto: asked.iso }).toString()}`,
      onRetry: day.readNow,
    };
  })();

  const open = (enquiry: Enquiry): void => {
    flaggedReadRef.current?.abort();
    setOpenedIndex(list.rows.findIndex((row) => row.id === enquiry.id));
    setSelectedId(enquiry.id);
    setOpenedEnquiry(enquiry);
    setConfirming(null);
    setFailure(null);
    setAnnouncement(null);
    openedAtRef.current = Date.now();
    saidRef.current = null;
    setDiarySaid(null);
    pendingFocusRef.current = { kind: "panel", id: enquiry.id };
  };

  const close = (): void => {
    const closing = selectedId;
    setSelectedId(null);
    setOpenedEnquiry(null);
    setConfirming(null);
    setFailure(null);
    setAnnouncement(null);
    saidRef.current = null;
    setDiarySaid(null);
    if (onDetailClose !== undefined) {
      onDetailClose();
      return;
    }
    if (closing !== null) pendingFocusRef.current = { kind: "row", id: closing };
  };

  const listedIndex = selectedId === null ? -1 : list.rows.findIndex((row) => row.id === selectedId);
  const stepTarget = (direction: 1 | -1): Enquiry | undefined => {
    if (listedIndex >= 0) return list.rows[listedIndex + direction];
    if (openedIndex < 0) return undefined;
    // The open enquiry left this filter: the row that took its place is next.
    return list.rows[direction === 1 ? openedIndex : openedIndex - 1];
  };
  const step = (direction: 1 | -1): void => {
    const target = stepTarget(direction);
    if (target !== undefined) open(target);
  };

  const applyUpdated = (updated: Enquiry): void => {
    // A stage-filtered list drops an enquiry that no longer matches, and its
    // later pages shift up one; "all" keeps it with its new status.
    setList((previous) => previous.filter === "all" || updated.state === previous.filter
      ? { ...previous, rows: previous.rows.map((e) => e.id === updated.id ? updated : e) }
      : { ...previous, ...withoutListedEnquiry(previous, updated.id) });
    setOpenedEnquiry((opened) => opened !== null && opened.id === updated.id ? updated : opened);
  };

  const runTransition = async (enquiry: Enquiry, to: TransitionTarget, note: string | undefined, from: string = enquiry.state): Promise<void> => {
    setSaving(to);
    setFailure(null);
    const stillOpen = (): boolean => selectedIdRef.current === enquiry.id;
    try {
      // Decided from what this screen showed: if the enquiry has moved on
      // since, nothing is done and it is read again.
      const updated = await enquiriesApi.transitionEnquiry(enquiry.id, to, note, from);
      applyUpdated(updated);
      setCounts((previous) => previous.value === null ? previous
        : { ...previous, value: countsAfterMove(previous.value, enquiry.id, from, updated.state) });
      setCountsVersion((version) => version + 1);
      setHistoryVersion((version) => version + 1);
      setAlarmVersion((version) => version + 1);
      setStamp((previous) => ({ id: updated.id, key: (previous?.key ?? 0) + 1 }));
      setMoved((count) => count + 1);
      if (stillOpen()) {
        setConfirming(null);
        setAnnouncement(ANNOUNCEMENTS[updated.state] ?? `${stageLabel(updated.state)}.`);
        panelHeadingRef.current?.focus();
      }
    } catch (error) {
      if (error instanceof ApiError && (error.code === "INVALID_TRANSITION" || error.code === "ENQUIRY_STATUS_CHANGED"
        || error.code === "NOT_A_BOOKING")) {
        // Someone else moved it on first (before this was sent, or while it
        // was on its way), or it turned out to be a request: show where it
        // really is, and the steps it really has.
        try {
          const current = await enquiriesApi.getEnquiry(enquiry.id);
          applyUpdated(current);
          setCountsVersion((version) => version + 1);
          setHistoryVersion((version) => version + 1);
          setAlarmVersion((version) => version + 1);
          if (stillOpen()) {
            setConfirming(null);
            setFailure(error.code === "NOT_A_BOOKING"
              ? "This is a request, not a booking, so it is marked done rather than approved or declined."
              : `This enquiry had already moved on. It is ${stageLabel(current.state, requestKind(current.eventType) !== null).toLowerCase()} now.`);
          }
        } catch {
          if (stillOpen()) setFailure("The status could not be changed. Reload the list to see where this enquiry is.");
        }
      } else if (stillOpen()) {
        setFailure("The status could not be changed. Try again.");
      }
      if (!stillOpen()) addToast(`${enquiryName(enquiry)}’s status could not be changed`, "error");
    } finally {
      setSaving(null);
    }
  };

  // A reply recorded here: the enquiry holds the reply that stands (this one,
  // or an earlier one it already had), and the alarm is read again.
  const applyReply = (result: RecordFirstResponseResult): void => {
    const reply = {
      firstResponseAt: result.firstResponse.at,
      firstResponseBy: result.firstResponse.byUserId,
      firstResponseChannel: result.firstResponse.channel,
    };
    setList((previous) => ({ ...previous, rows: previous.rows.map((row) => row.id === result.enquiryId ? { ...row, ...reply } : row) }));
    setOpenedEnquiry((opened) => opened !== null && opened.id === result.enquiryId ? { ...opened, ...reply } : opened);
    setAlarmVersion((version) => version + 1);
  };

  // The alarm's longest-waiting enquiry, opened whether or not the list holds it.
  const openFlagged = async (id: string): Promise<void> => {
    const listed = list.rows.find((row) => row.id === id);
    if (listed !== undefined) {
      open(listed);
      return;
    }
    flaggedReadRef.current?.abort();
    const controller = new AbortController();
    flaggedReadRef.current = controller;
    setOpeningFlagged(true);
    try {
      const enquiry = await enquiriesApi.getEnquiry(id, controller.signal);
      if (!controller.signal.aborted) open(enquiry);
    } catch {
      if (!controller.signal.aborted) addToast("Failed to load enquiry", "error");
    } finally {
      if (flaggedReadRef.current === controller) {
        flaggedReadRef.current = null;
        setOpeningFlagged(false);
      }
    }
  };

  const requestTransition = (to: TransitionTarget, withNote: boolean): void => {
    if (selected === undefined || saving !== null) return;
    setFailure(null);
    setAnnouncement(null);
    // A decision emails the client and is confirmed first. Anything else sends
    // nothing and happens at once, unless a note is wanted; reopening a
    // request takes none.
    if (to === "submitted" || (!withNote && to !== "approved" && to !== "rejected")) {
      void runTransition(selected, to, undefined);
      return;
    }
    confirmFromRef.current = selected.state;
    if (to === "approved") {
      // Approve says what the Diary says now, before the client is emailed.
      setApproveRead({ enquiryId: selected.id, after: day.settled, said: null });
      day.readNow();
    }
    setConfirming(to);
  };

  const confirmTransition = (note: string): void => {
    if (selected === undefined || confirming === null || saving !== null) return;
    const trimmed = note.trim();
    void runTransition(selected, confirming, trimmed === "" ? undefined : trimmed, confirmFromRef.current ?? selected.state);
  };

  const cancelTransition = (): void => {
    if (saving !== null || confirming === null) return;
    pendingFocusRef.current = { kind: "action", to: confirming };
    setConfirming(null);
    setFailure(null);
  };

  const handleCreateOpportunity = async (enquiry: Enquiry): Promise<void> => {
    if (creatingOpportunity) return;
    setCreatingOpportunity(true);
    setOpportunityFailure(null);
    try {
      const result = await createOpportunityFromEnquiry(enquiry.id);
      // A second press finds the deal the first made; either way the press
      // lands on it, selected in the pipeline.
      if (onOpenOpportunity !== undefined) onOpenOpportunity(result.opportunity.id);
      else addToast(result.created ? "Opportunity created. It is in the pipeline." : "This enquiry's opportunity is already in the pipeline.", "success");
    } catch {
      setOpportunityFailure({ enquiryId: enquiry.id, message: "The opportunity could not be created. Nothing was changed; try again." });
    } finally {
      setCreatingOpportunity(false);
    }
  };

  const onDeskKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (confirming !== null) {
      event.preventDefault();
      cancelTransition();
      return;
    }
    if (selectedId !== null) {
      event.preventDefault();
      close();
    }
  };

  const chooseFilter = (filter: DeskFilter): void => {
    // "Next" follows the open enquiry's place in the new list, if it has one.
    setOpenedIndex(-1);
    setStatusFilter(filter);
  };

  const opening = selectedId !== null && selected === undefined && preselectionLoading;
  const panelOpen = selectedId !== null && (selected !== undefined || preselectionLoading);
  const showSheet = wide || !panelOpen;
  const showPanel = wide || panelOpen;
  const backLabel = onDetailClose !== undefined ? "Back to profile" : wide ? "Close enquiry" : "Back to enquiries";

  const countNote = list.status === "ready"
    ? describeEnquiryCount({ shown: list.rows.length, total: list.total, filter: list.filter, newestFirst: list.order === "created_desc" })
    : null;
  const moreAvailable = list.status === "ready" && hasMoreEnquiries(list);
  const nextBatch = Math.min(ENQUIRY_PAGE_SIZE, list.total - list.nextOffset);
  const summary = deskSummary({
    newCount: counts.value?.byState.submitted ?? null,
    reviewCount: counts.value?.byState.under_review ?? null,
    longestWaitingCreatedAt: counts.value?.longestWaiting?.createdAt ?? null,
    nowMs,
  });
  const alarm = replyAlarm.alarm;
  const longestFlagged = alarm?.longest ?? null;
  const alarmSummary = alarm === null ? null : replyAlarmSummary({
    overdue: alarm.overdue,
    thresholdHours: alarm.thresholdHours,
    longestArrivedAtMs: longestFlagged === null ? null : Date.parse(longestFlagged.arrivedAt),
    nowMs,
  });
  const panelReply = (enquiry: Enquiry): PanelReply | null => replyVenueId === null || enquiry.venueId !== replyVenueId ? null : {
    canRecord: true,
    overdueSinceMs: replyAlarm.overdueSince.get(enquiry.id) ?? null,
    thresholdHours: alarm?.thresholdHours ?? null,
    viewerId,
    onRecorded: applyReply,
  };
  const [emptyHeading, emptyDetail] = EMPTY_WORDS[list.filter];
  const greeting = deskGreeting(nowMs, userName);

  return (
    <div ref={deskRef} className={`enq-desk${wide ? "" : " enq-desk--single"}`} data-register="ivory" onKeyDown={onDeskKeyDown}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <h1 id={titleId} ref={sheetHeadingRef} tabIndex={-1}>Enquiries</h1>
          </header>
          <div className="enq-summary">
            {summary !== null && (
              <p>
                {summary.map((part, index) => typeof part === "string" ? part
                  : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
              </p>
            )}
            {alarmSummary !== null && longestFlagged !== null && (
              <div className="enq-summary__alarm" data-testid="reply-alarm">
                <p>
                  {alarmSummary.map((part, index) => typeof part === "string" ? part
                    : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
                </p>
                <button type="button" className="enq-button" onClick={() => { void openFlagged(longestFlagged.id); }}
                  disabled={openingFlagged} aria-busy={openingFlagged}>
                  {openingFlagged && <ActivityIndicator size={16} />}
                  Open the longest unanswered
                </button>
              </div>
            )}
            {summary === null && counts.status === "loading" && <ActivityStatus>Counting enquiries…</ActivityStatus>}
            {summary === null && counts.status === "error" && (
              <div className="enq-summary__retry">
                <p>The stage counts could not be loaded.</p>
                <button type="button" className="enq-button" onClick={() => { setCountsVersion((version) => version + 1); }}>
                  Count again
                </button>
              </div>
            )}
          </div>

          <EnquiryStages filter={statusFilter} counts={counts.value} onFilter={chooseFilter} />

          {/* Stays mounted so a new count is announced when a page lands. */}
          <p className="enq-count" data-testid="enquiry-list-count" aria-live="polite">{countNote}</p>
          {list.status === "loading" && <ActivityStatus className="enq-sheet__activity">Loading enquiries…</ActivityStatus>}

          {list.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert">
              <p>Enquiries could not be loaded.</p>
              <button type="button" className="enq-button" onClick={reloadList}>Try again</button>
            </div>
          )}

          {list.status === "ready" && list.rows.length === 0 && !moreAvailable && (
            <div className="enq-empty">
              <h2>{emptyHeading}</h2>
              <p>{emptyDetail}</p>
            </div>
          )}

          <EnquiryLedger
            rows={list.rows}
            selectedId={selectedId}
            nowMs={nowMs}
            room={roomOf}
            complete={list.status === "ready" && !moreAvailable}
            stamp={stamp}
            overdueSince={replyAlarm.overdueSince}
            onOpen={open}
          />

          {list.interrupted && (
            <div className="enq-notice">
              <p role="status">Enquiries changed while this list was open, so it may be incomplete or out of date.</p>
              <button type="button" className="enq-button" onClick={reloadList}>Reload list</button>
            </div>
          )}

          {moreAvailable && (
            <div className="enq-more">
              <button type="button" className="enq-button" data-testid="enquiry-list-more"
                onClick={showMore} disabled={list.loadingMore} aria-busy={list.loadingMore}>
                {list.loadingMore && <ActivityIndicator size={16} />}
                {list.loadingMore ? "Loading more…" : `Show ${String(nextBatch)} more`}
              </button>
              {list.moreFailed && <p role="alert">More enquiries could not be loaded. Try again.</p>}
            </div>
          )}
        </section>
      )}

      {showPanel && (selected !== undefined ? (
        <EnquiryPanel
          key={selected.id}
          enquiry={selected}
          room={roomOf(selected)}
          nowMs={nowMs}
          history={history.id === selected.id ? history.entries : []}
          historyStatus={history.id === selected.id ? history.status : "loading"}
          transition={{ confirming, saving, failure }}
          stampKey={stamp !== null && stamp.id === selected.id ? stamp.key : null}
          announcement={announcement ?? diarySaid}
          canCreateOpportunity={canCreateOpportunity}
          creatingOpportunity={creatingOpportunity}
          opportunityFailure={opportunityFailure !== null && opportunityFailure.enquiryId === selected.id ? opportunityFailure.message : null}
          diary={panelDiary}
          canDraftWithAI={canDraftWithAI}
          reply={panelReply(selected)}
          navigation={{
            layout: wide ? "wide" : "single",
            backLabel,
            canPrevious: stepTarget(-1) !== undefined,
            canNext: stepTarget(1) !== undefined,
            onClose: close,
            onStep: step,
          }}
          headingRef={panelHeadingRef}
          onRequest={requestTransition}
          onConfirm={confirmTransition}
          onCancel={cancelTransition}
          onCreateOpportunity={() => { void handleCreateOpportunity(selected); }}
        />
      ) : opening ? (
        <section className="enq-panel enq-panel--opening" data-register="forest" aria-label="Opening enquiry">
          <div className="enq-panel__body">
            <ActivityStatus variant="panel">Opening enquiry…</ActivityStatus>
          </div>
        </section>
      ) : wide ? (
        <EnquiryOverview
          counts={counts.value}
          nowMs={nowMs}
          moved={moved}
          room={roomOf}
          onOpen={open}
          onFilter={chooseFilter}
        />
      ) : null)}
    </div>
  );
}
