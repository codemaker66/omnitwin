import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement } from "react";
import {
  findUnsupportedProposalClaim, PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION, ProposalVersionPayloadSchema, type ProposalNextVersion,
  type ProposalVersionPayload,
} from "@omnitwin/types";
import { Plus, X } from "lucide-react";
import { ApiError } from "../../api/client.js";
import {
  changeProposalLayout, createProposal, createProposalShareToken, createProposalVersion, createQuote, deleteQuote, getDeskProposal,
  getLatestProposalVersion, getProposalComments, getProposalHistory, getProposalNextVersion, listProposalDesk, postProposalComment,
  transitionProposal, type DeskProposal, type ProposalCommentRow, type ProposalDeskPage, type ProposalHistoryEntry, type StaffProposalVersion,
} from "../../api/proposals.js";
import { listSpaces, type Space } from "../../api/spaces.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useLatestRequest } from "../../hooks/use-latest-request.js";
import { parsePoundsToMinor } from "../../lib/money-input.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { deskGreeting, venueYear, type SummaryPart } from "./enquiries/enquiry-desk-format.js";
import {
  COMPOSABLE, ProposalPanel, type DraftMemory, type PartRead, type ProposalFailure, type ProposalPanelProps, type ProposalWork, type Said,
} from "./proposals/ProposalPanel.js";
import { recallDraft, recallKept, rememberDraft, subscribeKept, updateKept, type KeptCopies } from "./proposals/proposal-memory.js";
import { ProposalsLedger } from "./proposals/ProposalsLedger.js";
import { ProposalsStages } from "./proposals/ProposalsStages.js";
import {
  groupRows, groupWords, layoutChoice, proposalStatusWords, proposalsSummary, sameWords, startedAgainWords, type ComposerDraft, type KeptVersion, type LayoutChoice,
  type ProposalFilter,
} from "./proposals/proposals-desk-format.js";
import "./enquiries/EnquiriesDesk.css";
import "./pipeline/PipelineDesk.css";
import "./proposals/ProposalsDesk.css";

// ---------------------------------------------------------------------------
// ProposalsDesk — proposals as a desk (roadmap X1).
//
// The ledger groups proposals as a booker works them: what the client sent
// back, their own drafts, what is with the client, what was accepted, what is
// closed. Beside it the forest panel holds the one proposal open: who it is
// for and what it comes to, the next step its status allows (sending asks
// first), the next version starting from the last one, the conversation and
// the history. The open proposal is in the address (?proposal=), so the
// Clients desk and the pipeline land on it.
// ---------------------------------------------------------------------------

const WIDE_DESK = "(min-width: 1180px)";
const PAGE = 50;

export interface ProposalsDeskProps {
  /** A proposal to open from the address (?proposal=). */
  readonly proposalId?: string | null;
  /** Told which proposal is open, or null when none, so the address follows it. */
  readonly onProposalShown?: (proposalId: string | null) => void;
  /** Opens the proposal's deal in the pipeline. */
  readonly onOpenDeal?: (opportunityId: string) => void;
}

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly page: ProposalDeskPage; readonly rows: readonly DeskProposal[] }
  | { readonly status: "error"; readonly previous: { readonly page: ProposalDeskPage; readonly rows: readonly DeskProposal[] } | null };

type DetailState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly id: string }
  | { readonly status: "ready"; readonly proposal: DeskProposal }
  | { readonly status: "missing"; readonly id: string }
  | { readonly status: "error"; readonly id: string };

/** A part of the open proposal, remembered with the proposal it belongs to,
 *  so another proposal's answer is never shown under this one. */
interface Part<T> extends PartRead<T> {
  readonly id: string | null;
}

const NOTHING: Part<never> = { id: null, status: "loading", value: null };

/** "Couldn't save" in words that say what is and is not true afterwards. */
const FAILURE_WORDS: Readonly<Record<ProposalFailure["where"], string>> = {
  step: "That did not go through. The proposal is as it was.",
  version: "The version did not save. Your changes are still here.",
  reply: "The reply was not posted. Your words are still here.",
  layout: "The layout did not change. The proposal is as it was.",
};

/** The proposal moved before the request arrived (a client's answer, or a
 *  colleague), so nothing was done; the panel is read again to show it. */
/** A version refused because its deal, enquiry or layout changed meanwhile is one of them. */
const MOVED_CODES: readonly string[] = ["PROPOSAL_STATUS_CHANGED", "PROPOSAL_VERSION_CHANGED", "INVALID_TRANSITION", "NOT_EDITABLE", "REVISION_CONFLICT"];
const MOVED_WORDS: Readonly<Record<ProposalFailure["where"], string>> = {
  step: "It changed before that arrived, so nothing was done. It now shows where it stands.",
  version: "It changed before the version arrived, so it did not save. Your changes are still here, and it now shows where it stands.",
  reply: "It changed before the reply arrived, so it was not posted. Your words are still here.",
  layout: "It changed before that arrived, so the layout did not change. It now shows where it stands.",
};
/** A change to the layout whose answer never came back, or came back broken:
 *  it may have been made, so it is not said to be as it was. The proposal is
 *  read again, which may fail too, so only what is known is said. */
const LAYOUT_UNCONFIRMED_WORDS = "The change could not be confirmed. The layout shown is as last read.";
/** A version refused because what it would take changed after its check, or
 *  its links changed as it arrived. The start line above says what is known
 *  of it now, checked again or not, so this claims nothing more. */
const TAKEN_CHANGED_WORDS = "The layout or the event's details changed before the version arrived, so it did not save. Your changes are still here.";

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function SummarySentence({ parts }: { readonly parts: readonly SummaryPart[] }): ReactElement {
  return (
    <p className="enq-summary" data-testid="proposals-summary">
      {parts.map((part, index) => typeof part === "string"
        ? <span key={index}>{part}</span>
        : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
    </p>
  );
}

/** Reads a part of the open proposal whenever it opens or `read` changes,
 *  and lets a value the desk already holds (a version just saved) stand in
 *  for a read. */
function usePart<T>(id: string | null, read: string, load: (id: string) => Promise<T>): readonly [Part<T>, (id: string, value: T) => void] {
  const [part, setPart] = useState<Part<T>>(NOTHING);
  useEffect(() => {
    if (id === null) return;
    let current = true;
    // Asked again for the same proposal, what was read stays until the answer.
    setPart((previous) => ({ id, status: "loading", value: previous.id === id ? previous.value : null }));
    load(id)
      .then((value) => { if (current) setPart({ id, status: "ready", value }); })
      .catch(() => { if (current) setPart((previous) => ({ id, status: "error", value: previous.id === id ? previous.value : null })); });
    return () => { current = false; };
  }, [id, read, load]);
  const seed = useCallback((seedId: string, value: T): void => { setPart({ id: seedId, status: "ready", value }); }, []);
  return [part.id === id ? part : { id, status: "loading", value: null }, seed];
}

/** The composer's check, as read and as it may be said. */
interface CheckRead extends PartRead<ProposalNextVersion> {
  /** The last answer for the proposal as it reads could not be made: what was
   *  checked before is not said as current until a check answers (a save is
   *  still held to it), and a check made again says it is checking. */
  readonly failed: boolean;
}

/** The composer's check: read while `id` is set, and again at each `again`.
 *  What was read stays while it is read again for the same proposal, version
 *  and links; once any of those change, or the composer closes, it is of
 *  something else and is dropped. */
function useCheck(id: string | null, identity: string, again: number, load: (id: string) => Promise<ProposalNextVersion>): CheckRead {
  const key = id === null ? null : `${id}:${identity}`;
  const [check, setCheck] = useState<{ readonly key: string | null } & CheckRead>({ key: null, status: "loading", value: null, failed: false });
  useEffect(() => {
    if (id === null || key === null) {
      setCheck({ key: null, status: "loading", value: null, failed: false });
      return;
    }
    let current = true;
    setCheck((previous) => previous.key === key ? { ...previous, status: "loading" } : { key, status: "loading", value: null, failed: false });
    load(id)
      .then((value) => { if (current) setCheck({ key, status: "ready", value, failed: false }); })
      .catch(() => {
        if (!current) return;
        setCheck((previous) => previous.key === key
          ? { ...previous, status: "error", failed: true }
          : { key, status: "error", value: null, failed: true });
      });
    return () => { current = false; };
  }, [id, key, again, load]);
  return key !== null && check.key === key
    ? { status: check.status, value: check.value, failed: check.failed }
    : { status: "loading", value: null, failed: false };
}

/** Everything on the desk belongs to the person signed in: another account
 *  signed in on this page is given a desk of its own, so nothing of the last
 *  one's shows there (what they wrote, a link they made, their venue's rows). */
export function ProposalsDesk(props: ProposalsDeskProps = {}): ReactElement {
  const person = useAuthStore((state) => state.user?.id ?? "");
  return <PersonalDesk key={person} {...props} person={person} />;
}

function PersonalDesk({ proposalId = null, onProposalShown, onOpenDeal, person }: ProposalsDeskProps & { readonly person: string }): ReactElement {
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const user = useAuthStore((state) => state.user);
  const [nowMs] = useState(() => Date.now());
  const [filter, setFilter] = useState<ProposalFilter>("all");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [listReading, setListReading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [working, setWorking] = useState<ProposalWork>(null);
  const [failure, setFailure] = useState<ProposalFailure | null>(null);
  // What a step says, and apart from it, so neither is lost, that words were
  // kept to copy. Each saying is counted, so the same words said again are
  // heard again.
  const saidRef = useRef(0);
  const [announcement, setAnnouncement] = useState<Said | null>(null);
  const [keptNote, setKeptNote] = useState<Said | null>(null);
  const say = (text: string): Said => { saidRef.current += 1; return { text, n: saidRef.current }; };
  const [stampKey, setStampKey] = useState<number | null>(null);
  const [links, setLinks] = useState<Readonly<Record<string, string>>>({});
  // Versions that did not save, and words put aside, kept per proposal and
  // per composer so each can be copied once the composer that wrote it is
  // gone. They live for the page (proposal-memory.ts), so moving to another
  // part of the dashboard and back loses none of them, and a save that
  // answers after the desk was left still keeps or puts away its copy.
  const keptDrafts = useSyncExternalStore(subscribeKept, () => recallKept(person));
  const setKeptDrafts = useCallback((update: (current: KeptCopies) => KeptCopies): void => { updateKept(person, update); }, [person]);
  const [creating, setCreating] = useState(false);
  const [reads, setReads] = useState({ latest: 0, history: 0, comments: 0, next: 0 });
  const listRequest = useLatestRequest();
  // The proposal that should be open, and each time it should be read again.
  // The read is an effect keyed on it, so a read cut short (a newer proposal,
  // React's development double run) is simply made again, and a late answer
  // for a proposal no longer open is never shown.
  // A quiet read keeps the proposal on screen while it is read; a silent one
  // (someone coming back to the page) does not say it is reading either.
  const [target, setTarget] = useState<{ readonly id: string; readonly read: number; readonly quietly: boolean; readonly silent?: boolean } | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPanelRef = useRef(false);
  const returnFocusRef = useRef<string | null>(null);
  const reportedRef = useRef<string | null>(null);
  const onShownRef = useRef(onProposalShown);
  useEffect(() => { onShownRef.current = onProposalShown; });
  // A step of the booker's own that took the proposal out of their hands (a
  // send, a withdrawal): words it puts aside are said without its reason,
  // which the step has just said itself.
  const stepClosedRef = useRef<{ readonly id: string; readonly status: string } | null>(null);

  const rows = list.status === "ready" ? list.rows : list.status === "error" ? list.previous?.rows ?? [] : [];
  const page = list.status === "ready" ? list.page : list.status === "error" ? list.previous?.page ?? null : null;
  const openId = target?.id ?? null;
  // The words in the open proposal's composer, remembered for this person.
  const memory = useMemo((): DraftMemory | null => openId === null ? null : {
    recall: () => recallDraft(person, openId),
    remember: (written) => { rememberDraft(person, openId, written); },
  }, [person, openId]);

  /** Reads the list from its start; `keep` rows keeps as many as are shown.
   *  A read started later wins, and drops a next page still on its way. */
  const readList = useCallback((keep = PAGE): void => {
    const owns = listRequest.begin();
    setListReading(true);
    setLoadingMore(false);
    setMoreFailed(false);
    const group = filter === "all" ? undefined : filter;
    listProposalDesk({ limit: Math.min(100, Math.max(PAGE, keep)), offset: 0, ...(group === undefined ? {} : { group }) })
      .then((next) => { if (owns()) setList({ status: "ready", page: next, rows: next.rows }); })
      .catch(() => {
        if (!owns()) return;
        setList((current) => ({
          status: "error",
          previous: current.status === "ready" ? { page: current.page, rows: current.rows } : current.status === "error" ? current.previous : null,
        }));
      })
      .finally(() => { if (owns()) setListReading(false); });
  }, [filter, listRequest]);

  useEffect(() => {
    setList({ status: "loading" });
    readList();
  }, [readList]);

  const loadMore = (): void => {
    if (list.status !== "ready" || loadingMore || listReading) return;
    const current = list;
    const owns = listRequest.begin();
    const group = filter === "all" ? undefined : filter;
    setLoadingMore(true);
    setMoreFailed(false);
    listProposalDesk({ limit: PAGE, offset: current.rows.length, ...(group === undefined ? {} : { group }) })
      .then((next) => {
        if (!owns()) return;
        setList({ status: "ready", page: next, rows: [...current.rows, ...next.rows.filter((row) => !current.rows.some((shown) => shown.id === row.id))] });
      })
      .catch(() => { if (owns()) setMoreFailed(true); })
      .finally(() => { if (owns()) setLoadingMore(false); });
  };

  // ---------------------------------------------------------------------------
  // The open proposal and its parts
  // ---------------------------------------------------------------------------

  // The read of the open proposal last answered, or given up on. A proposal
  // read again while it stays on screen is then known to be on its way in the
  // very render that asks for it, so nothing waiting on that read slips in
  // first; said ("Refreshing the proposal…") unless it is silent.
  const [answered, setAnswered] = useState<{ readonly id: string; readonly read: number } | null>(null);
  const rereading = target !== null && target.quietly && (answered?.id !== target.id || answered.read !== target.read);
  const refreshing = rereading && target.silent !== true;
  useEffect(() => {
    if (target === null) {
      setDetail({ status: "idle" });
      return;
    }
    let current = true;
    const { id, read, quietly } = target;
    if (!quietly) setDetail({ status: "loading", id });
    getDeskProposal(id)
      .then((next) => {
        if (!current) return;
        setDetail({ status: "ready", proposal: next });
        setAnswered({ id, read });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setAnswered({ id, read });
        // A quiet re-read that fails keeps the proposal as it was last read.
        if (quietly) return;
        setDetail(error instanceof ApiError && error.status === 404 ? { status: "missing", id } : { status: "error", id });
      });
    return () => { current = false; };
  }, [target]);

  const proposal = detail.status === "ready" && detail.proposal.id === openId ? detail.proposal : null;
  const openVersion = proposal?.currentVersion ?? null;
  const loadLatest = useCallback((id: string): Promise<StaffProposalVersion> => getLatestProposalVersion(id), []);
  const loadHistory = useCallback((id: string): Promise<readonly ProposalHistoryEntry[]> => getProposalHistory(id), []);
  const loadComments = useCallback((id: string): Promise<readonly ProposalCommentRow[]> => getProposalComments(id), []);
  // The latest version is read once the proposal says there is one, and again
  // whenever its number changes.
  const [latest, seedLatest] = usePart(openVersion !== null && openVersion > 0 ? openId : null,
    `${String(openVersion)}:${String(reads.latest)}`, loadLatest);
  const [history] = usePart(openId, String(reads.history), loadHistory);
  const [comments] = usePart(openId, String(reads.comments), loadComments);

  // The venue's rooms power the capacity guidance; without them the note is
  // written by hand.
  const [spaces, setSpaces] = useState<PartRead<readonly Space[]>>({ status: "loading", value: null });
  const venueId = user?.venueId ?? null;
  useEffect(() => {
    if (venueId === null) {
      setSpaces({ status: "ready", value: [] });
      return;
    }
    let current = true;
    listSpaces(venueId)
      .then((rows) => { if (current) setSpaces({ status: "ready", value: rows }); })
      .catch(() => { if (current) setSpaces({ status: "error", value: [] }); });
    return () => { current = false; };
  }, [venueId]);

  // The address follows the proposal that is open.
  const targetId = target?.id ?? null;
  useEffect(() => {
    if (reportedRef.current === targetId) return;
    reportedRef.current = targetId;
    onShownRef.current?.(targetId);
  }, [targetId]);

  const openProposal = useCallback((id: string, byReader: boolean): void => {
    if (byReader) focusPanelRef.current = true;
    setFailure(null);
    setAnnouncement(null);
    setKeptNote(null);
    setStampKey(null);
    stepClosedRef.current = null;
    setTarget((current) => {
      if (current?.id === id) {
        if (byReader) panelHeadingRef.current?.focus();
        return current;
      }
      return { id, read: 0, quietly: false };
    });
  }, []);

  const readAgain = useCallback((id: string, silent = false): void => {
    setTarget((current) => current?.id === id ? { id, read: current.read + 1, quietly: true, silent } : current);
  }, []);

  // What a version saved now would take that the latest does not show its
  // client (the layout's drawing, the event's facts), for a proposal the
  // composer is open on. Checked again when its version or links change, when
  // someone comes back to the page (a layout changed in another tab, say; the
  // proposal is read again with it, so its facts agree), and after a save is
  // refused. A proposal sent meanwhile is read again, to say where it stands.
  const nextFor = proposal !== null && openVersion !== null && openVersion > 0 && COMPOSABLE.includes(proposal.status) ? openId : null;
  const loadNext = useCallback((id: string): Promise<ProposalNextVersion> => getProposalNextVersion(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_EDITABLE") readAgain(id, true);
    throw error;
  }), [readAgain]);
  const next = useCheck(nextFor, [openVersion, proposal?.configurationId, proposal?.opportunityId, proposal?.enquiryId].map(String).join(":"),
    reads.next, loadNext);
  // A check is not said as current while it is made again after a save was
  // refused for it, or after it could not be made; a save is still held to it.
  const [refusedBasis, setRefusedBasis] = useState<string | null>(null);
  const nextShown: PartRead<ProposalNextVersion> = next.status === "loading" && next.value !== null && (next.failed || next.value.basis === refusedBasis)
    ? { status: "loading", value: null } : { status: next.status, value: next.value };
  // While the composer is open, coming back to the page reads the proposal
  // again (a version saved or a send made elsewhere) and, once it has a
  // version, makes the check again (a layout changed in another tab).
  const composingFor = proposal !== null && COMPOSABLE.includes(proposal.status) ? openId : null;
  useEffect(() => {
    if (composingFor === null) return;
    let last = -Infinity;
    const checkAgain = (): void => {
      // Coming back fires both; one read answers both.
      if (document.visibilityState !== "visible" || performance.now() - last < 1000) return;
      last = performance.now();
      setReads((current) => ({ ...current, next: current.next + 1 }));
      readAgain(composingFor, true);
    };
    window.addEventListener("focus", checkAgain);
    document.addEventListener("visibilitychange", checkAgain);
    return () => {
      window.removeEventListener("focus", checkAgain);
      document.removeEventListener("visibilitychange", checkAgain);
    };
  }, [composingFor, readAgain]);

  // The open proposal and its ledger row are made to agree when either has
  // moved on without the other (a proposal read again on coming back, a list
  // read while a colleague changed it): whichever is behind is read again,
  // once for each pair of states, and never while a read that would settle it
  // is on its way or more rows are coming.
  const ledgerSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (proposal === null || listReading || loadingMore || rereading) return;
    const row = rows.find((candidate) => candidate.id === proposal.id);
    if (row === undefined || (row.status === proposal.status && row.currentVersion === proposal.currentVersion)) return;
    const pair = [proposal.id, proposal.status, proposal.currentVersion, row.status, row.currentVersion].map(String).join(":");
    if (ledgerSyncedRef.current === pair) return;
    ledgerSyncedRef.current = pair;
    if (Date.parse(row.updatedAt) > Date.parse(proposal.updatedAt)) readAgain(proposal.id, true);
    else readList(Math.max(PAGE, rows.length));
  }, [proposal, rows, listReading, loadingMore, rereading, readList, readAgain]);

  const closeProposal = useCallback((): void => {
    setTarget((current) => {
      returnFocusRef.current = current?.id ?? null;
      return null;
    });
    setFailure(null);
  }, []);

  // A proposal linked from the address opens beside the ledger; the browser's
  // Back closes it, and a reader who was in it returns to its row.
  useEffect(() => {
    if (proposalId !== null) {
      openProposal(proposalId, false);
      return;
    }
    setTarget((current) => {
      if (current === null) return current;
      const active = document.activeElement;
      if (active === null || active === document.body || active.closest(".pr-panel") !== null) returnFocusRef.current = current.id;
      return null;
    });
  }, [proposalId, openProposal]);

  // Focus follows the reader into a proposal they opened, and back to its row
  // once it is closed and the ledger is on screen again.
  useEffect(() => {
    if (detail.status === "ready" && focusPanelRef.current) {
      focusPanelRef.current = false;
      panelHeadingRef.current?.focus();
    }
    if (detail.status === "idle" && returnFocusRef.current !== null) {
      const id = returnFocusRef.current;
      returnFocusRef.current = null;
      document.querySelector<HTMLElement>(`button[data-proposal-id="${CSS.escape(id)}"]`)?.focus();
    }
  }, [detail]);

  const ordered = groupRows(rows).flatMap((group) => group.rows);
  const openIndex = ordered.findIndex((row) => row.id === openId);
  const stepTo = (direction: 1 | -1): void => {
    const next = ordered[openIndex + direction];
    if (openIndex >= 0 && next !== undefined) openProposal(next.id, true);
  };

  // ---------------------------------------------------------------------------
  // What the panel changes. Each is made for the proposal it was started on,
  // whatever is open when it answers, and says so only there.
  // ---------------------------------------------------------------------------

  const openIdRef = useRef<string | null>(null);
  useEffect(() => { openIdRef.current = openId; }, [openId]);

  /** A proposal the API has just answered with, over the one open. */
  const applyProposal = (next: Partial<DeskProposal> & { readonly id: string }): void => {
    setDetail((state) => state.status === "ready" && state.proposal.id === next.id
      ? { status: "ready", proposal: { ...state.proposal, ...next } } : state);
  };

  /** `composer` names the composer a version's failure belongs to. */
  const attempt = async (where: ProposalFailure["where"], work: ProposalWork, action: (id: string) => Promise<string | null>,
    composer?: number): Promise<boolean> => {
    if (proposal === null || working !== null) return false;
    const id = proposal.id;
    setWorking(work);
    setFailure(null);
    stepClosedRef.current = null;
    try {
      const said = await action(id);
      if (openIdRef.current === id && said !== null) setAnnouncement(say(said));
      return true;
    } catch (error: unknown) {
      if (openIdRef.current === id) {
        const moved = error instanceof ApiError && MOVED_CODES.includes(error.code);
        const taken = where === "version" && error instanceof ApiError && error.code === "REVISION_CONFLICT";
        setFailure({
          where,
          message: error instanceof RefusedHere ? error.message : taken ? TAKEN_CHANGED_WORDS : moved ? MOVED_WORDS[where] : FAILURE_WORDS[where],
          ...(composer === undefined ? {} : { composer }), moved,
        });
        if (moved) {
          readAgain(id);
          // The latest version too, even when the proposal's number has not
          // changed since it was last read: a composer left starting from an
          // older version would otherwise be refused at every save.
          setReads((current) => ({ ...current, history: current.history + 1, latest: current.latest + 1, next: current.next + 1 }));
          readList(Math.max(PAGE, rows.length));
        }
      }
      return false;
    } finally {
      setWorking(null);
    }
  };

  const onMakeLink = (): Promise<boolean> => attempt("step", "link", async (id) => {
    // The version the booker was asked about is the one sent; a newer one
    // saved meanwhile is refused rather than sent unseen.
    const before = proposal;
    const made = await createProposalShareToken(id, before?.currentVersion);
    setLinks((current) => ({ ...current, [id]: `${window.location.origin}${made.shareUrl}` }));
    if (made.proposal.status !== before?.status) setStampKey(Date.now());
    // The API answers with its row as the desk now reads it: the version the
    // link shows, the send's stamp and that it has not been opened since.
    applyProposal(made.proposal);
    if (!COMPOSABLE.includes(made.proposal.status)) stepClosedRef.current = { id, status: made.proposal.status };
    readAgain(id);
    setReads((current) => ({ ...current, history: current.history + 1 }));
    readList(Math.max(PAGE, rows.length));
    return "The client's link is made. Copy it into your message to them.";
  });

  const onTransition = (to: "withdrawn" | "archived"): Promise<boolean> => attempt("step", to === "withdrawn" ? "withdraw" : "archive", async (id) => {
    const moved = await transitionProposal(id, to);
    applyProposal(moved);
    stepClosedRef.current = { id, status: moved.status };
    setStampKey(Date.now());
    readAgain(id);
    setReads((current) => ({ ...current, history: current.history + 1 }));
    readList(Math.max(PAGE, rows.length));
    return `The proposal is ${proposalStatusWords(to).toLowerCase()}.`;
  });

  const saveVersion = (draft: ComposerDraft, composer: number, basedOn: number, basis: string | undefined): Promise<boolean> => attempt("version", "version", async (id) => {
    if (proposal === null) return null;
    const lines = readQuoteLines(draft);
    const candidate = {
      schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
      title: proposal.title,
      clientMessage: draft.message.trim() === "" ? null : draft.message.trim(),
      configurationId: proposal.configurationId,
      layoutRevision: null,
      capacityNote: draft.capacityNote.trim() === "" ? null : draft.capacityNote.trim(),
      quote: null,
    };
    // The claim guard runs before anything is kept, so unsupported certainty
    // wording is explained here rather than refused by the API.
    const checked = ProposalVersionPayloadSchema.safeParse(candidate);
    if (!checked.success) throw new RefusedHere(checked.error.issues[0]?.message ?? "The proposal's words are not valid.");
    let quote: ProposalVersionPayload["quote"] = null;
    let madeQuoteId: string | null = null;
    if (lines.length > 0) {
      // Totals come back from the server's exact money engine; the snapshot
      // uses them as they are, never adding them up here.
      const made = await createQuote({
        venueId: proposal.venueId, opportunityId: proposal.opportunityId, proposalId: id,
        name: `${proposal.title} quote`, currency: "GBP", lineItems: [...lines],
      });
      madeQuoteId = made.id;
      quote = {
        quoteId: made.id,
        currency: "GBP",
        lineItems: made.lineItems.map((item) => ({
          description: item.description, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor, lineTotalMinor: item.lineTotalMinor,
        })),
        subtotalMinor: made.subtotalMinor,
        totalMinor: made.totalMinor,
      };
    }
    let saved: StaffProposalVersion;
    try {
      saved = await createProposalVersion(id, { ...checked.data, quote }, basedOn, basis);
    } catch (error) {
      if (basis !== undefined && error instanceof ApiError && MOVED_CODES.includes(error.code)) setRefusedBasis(basis);
      // A version refused outright leaves no draft quote for the deal to offer
      // as its latest figure. One that may have saved (no answer, or the
      // server's own failure) keeps it: the version would point at it.
      if (madeQuoteId !== null && error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await deleteQuote(madeQuoteId).catch(() => undefined);
      }
      throw error;
    }
    // The words are the version now: nothing of them is left to remember,
    // unless other words have taken their place (the desk was left and
    // opened again while this save was on its way, and more was written, or
    // the same written over a version saved since).
    const written = recallDraft(person, id);
    if (written !== null && written.start === basedOn && sameWords(written.draft, draft)) rememberDraft(person, id, null);
    // The next version starts from this one at once, if it is still open; the
    // proposal is then read again for what the server made of it.
    if (openIdRef.current === id) seedLatest(id, saved);
    applyProposal({ id, currentVersion: saved.version, latestTotalMinor: quote?.totalMinor ?? null, latestCurrency: quote === null ? null : "GBP" });
    readAgain(id);
    readList(Math.max(PAGE, rows.length));
    return `Version ${String(saved.version)} is saved.`;
  }, composer);

  /** Forgets those of the proposal's kept versions that `which` picks. */
  const forgetKept = (id: string, which: (entry: KeptVersion) => boolean): void => {
    setKeptDrafts((current) => {
      const kept = current[id];
      if (kept === undefined) return current;
      const left = kept.filter((entry) => !which(entry));
      if (left.length === kept.length) return current;
      const { [id]: _done, ...rest } = current;
      return left.length === 0 ? rest : { ...rest, [id]: left };
    });
  };

  // The composer whose save is under way or has saved: its own save keeps or
  // saves its words, so they are never put aside as though the proposal had
  // moved on without them.
  const savingRef = useRef<number | null>(null);
  // Composers that went, words and all, while their save was on its way.
  const goneWhileSavingRef = useRef(new Set<number>());

  // A version that did not save is kept to copy when the composer that wrote
  // it went while the save was on its way (a colleague's version or a send
  // found meanwhile), taking the words with it; a composer still there holds
  // them itself. A version that saves puts away the copies there were when
  // it began, and any since of the very words it saved (a desk opened while
  // it was on its way kept them), but no other words written since.
  const onSaveVersion = async (draft: ComposerDraft, composer: number, basedOn: number, basis?: string): Promise<boolean> => {
    const id = proposal?.id ?? null;
    const before = id === null ? [] : recallKept(person)[id] ?? [];
    savingRef.current = composer;
    const saved = await saveVersion(draft, composer, basedOn, basis);
    const gone = goneWhileSavingRef.current.delete(composer);
    if (!saved && savingRef.current === composer) savingRef.current = null;
    if (id !== null) {
      if (saved) forgetKept(id, (entry) => before.includes(entry) || sameWords(entry.draft, draft));
      else if (gone) {
        setKeptDrafts((current) => ({
          ...current,
          [id]: [...(current[id] ?? []).filter((entry) => entry.composer !== composer), { draft, composer, why: null }],
        }));
      }
    }
    return saved;
  };

  // A composer the proposal moved on from (a version saved elsewhere, a send
  // or a withdrawal, words left when another proposal was opened): its words,
  // if any, are kept to copy with why, and said. Its own save keeps or saves
  // them instead. Replaced as its own refused save said it would be, its words
  // are kept as that refusal left them, which the refusal explains; any other
  // failure on screen belongs to a composer now gone and is put away.
  const onComposerGone = (composer: number, draft: ComposerDraft | null, why: string): boolean => {
    const id = proposal?.id ?? null;
    if (id === null) return false;
    const step = stepClosedRef.current;
    const byStep = step !== null && step.id === id && step.status === proposal?.status;
    if (byStep) stepClosedRef.current = null;
    if (savingRef.current === composer) {
      // Should that save be refused, the words it sent are kept then.
      if (draft !== null) goneWhileSavingRef.current.add(composer);
      return false;
    }
    const ownRefusal = failure?.where === "version" && failure.composer === composer && failure.moved === true;
    if (failure?.where === "version" && !ownRefusal) setFailure(null);
    if (draft === null) return false;
    // Its own refusal explains itself, so the words it kept need no reason.
    const entry = { draft, composer, why: ownRefusal ? null : why };
    setKeptDrafts((current) => ({ ...current, [id]: [...(current[id] ?? []).filter((other) => other.composer !== composer), entry] }));
    if (!ownRefusal) setKeptNote(say(byStep ? "What you wrote is kept here to copy." : `${why} What you wrote is kept here to copy.`));
    return true;
  };

  // Starting again puts the words aside to copy, rather than throwing them
  // away: one more step clears them for good.
  const onStartAgain = (composer: number, draft: ComposerDraft, fromVersion: number | null): void => {
    const id = proposal?.id ?? null;
    if (id === null) return;
    const why = startedAgainWords(fromVersion);
    setKeptDrafts((current) => ({
      ...current,
      [id]: [...(current[id] ?? []).filter((entry) => entry.composer !== composer), { draft, composer, why }],
    }));
    if (failure?.where === "version") setFailure(null);
    rememberDraft(person, id, null);
    setKeptNote(say(`${why} What you wrote is kept here to copy.`));
  };

  const onDiscardKept = (composer: number): void => {
    if (openId === null) return;
    forgetKept(openId, (entry) => entry.composer === composer);
    panelHeadingRef.current?.focus({ preventScroll: true });
  };

  const onReply = (body: string): Promise<boolean> => attempt("reply", "reply", async (id) => {
    const claim = findUnsupportedProposalClaim(body);
    if (claim !== null) {
      throw new RefusedHere(`The reply says "${claim}", a certainty the venue cannot show a client. Reword it and post again.`);
    }
    await postProposalComment(id, body.trim());
    setReads((current) => ({ ...current, comments: current.comments + 1 }));
    return "The reply is posted.";
  });

  // Leaves the client's own layout out of the versions saved from now, or puts
  // it back (A10), only while the proposal stands where this screen shows it.
  // Its answer is shown at once; the proposal and the ledger are read again,
  // and with its layout the check of what the next version takes is made again.
  const onLayout = (change: LayoutChoice["change"]): Promise<boolean> => attempt("layout", "layout", async (id) => {
    const choice = proposal === null ? null : layoutChoice(proposal);
    if (proposal === null || choice?.change !== change) return null;
    const changed = await changeProposalLayout(id, choice.configurationId, proposal.status).catch((error: unknown) => {
      // Whatever the answer, the panel is read again to show the proposal as
      // it is. A refusal changed nothing; with no answer, or a broken one,
      // the change may have been made, so that is not said.
      readAgain(id);
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      throw new RefusedHere(LAYOUT_UNCONFIRMED_WORDS);
    });
    const carried = changed.configurationId !== null;
    applyProposal({ id, configurationId: changed.configurationId, updatedAt: changed.updatedAt,
      layoutRoomName: carried ? choice.room : null, layoutFromEnquiry: carried });
    readAgain(id);
    readList(Math.max(PAGE, rows.length));
    return change === "leave_out"
      ? `Their ${choice.room} layout is left out of the versions you save from now.`
      : `Their ${choice.room} layout goes with the versions you save from now.`;
  });

  // ---------------------------------------------------------------------------
  // The desk
  // ---------------------------------------------------------------------------

  const onDeskKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || openId === null || isEditable(event.target)) return;
    event.preventDefault();
    closeProposal();
  };

  const greeting = deskGreeting(nowMs, user?.name ?? null);
  const year = venueYear(nowMs);
  const sentence = proposalsSummary(page?.statusCounts ?? null);
  const total = page?.total ?? null;
  const showSheet = wide || openId === null;

  const panelProps: Omit<ProposalPanelProps, "proposal"> = {
    refreshing,
    nowMs,
    navigation: {
      layout: wide ? "wide" : "single",
      canPrevious: openIndex > 0,
      canNext: openIndex >= 0 && openIndex < ordered.length - 1,
      onClose: closeProposal,
      onStep: stepTo,
    },
    headingRef: panelHeadingRef,
    announcement,
    stampKey,
    latest,
    next: nextShown,
    lastCheck: next.value,
    checkRetrying: next.status === "loading" && next.failed,
    // The proposal is read again with it, so the facts agree with what it says.
    onRetryCheck: () => {
      setReads((current) => ({ ...current, next: current.next + 1 }));
      if (openId !== null) readAgain(openId, true);
    },
    memory,
    keptNote,
    history,
    comments,
    spaces,
    shareUrl: openId === null ? null : links[openId] ?? null,
    keptDrafts: openId === null ? [] : keptDrafts[openId] ?? [],
    working,
    failure,
    onMakeLink,
    onTransition,
    onSaveVersion,
    onComposerGone,
    onStartAgain,
    onDiscardKept,
    onReply,
    onLayout,
    onRetryLatest: () => { setReads((current) => ({ ...current, latest: current.latest + 1 })); },
    onRetryHistory: () => { setReads((current) => ({ ...current, history: current.history + 1 })); },
    onRetryComments: () => { setReads((current) => ({ ...current, comments: current.comments + 1 })); },
    onOpenDeal: onOpenDeal ?? null,
  };

  return (
    <div className={`enq-desk pr-desk${wide ? "" : " enq-desk--single"}`} data-register="ivory" onKeyDown={onDeskKey}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head pl-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <div className="pl-title">
              <h1 id={titleId}>Proposals</h1>
              <button type="button" className="enq-quiet pl-new" aria-expanded={creating} onClick={() => { setCreating((open) => !open); }}>
                <Plus size={16} aria-hidden="true" /> New proposal
              </button>
            </div>
            {sentence !== null && <SummarySentence parts={sentence} />}
          </header>

          {creating && (
            <NewProposal venueId={venueId} onCancel={() => { setCreating(false); }}
              onCreated={(id) => { setCreating(false); readList(Math.max(PAGE, rows.length + 1)); openProposal(id, true); }} />
          )}

          <ProposalsStages filter={filter} counts={page?.statusCounts ?? null} onFilter={(next) => { setFilter(next); }} />

          {list.status === "loading" && <ActivityStatus className="enq-sheet__activity">Reading the proposals…</ActivityStatus>}
          {list.status === "ready" && listReading && <ActivityStatus className="enq-sheet__activity">Reading the proposals again…</ActivityStatus>}
          {list.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert" data-testid="proposal-list-error">
              <p>{list.previous === null ? "The proposals could not be read." : "The proposals could not be read again. This is how they last stood."}</p>
              <button type="button" className="enq-button" disabled={listReading} onClick={() => { readList(Math.max(PAGE, rows.length)); }}>Try again</button>
            </div>
          )}
          {list.status === "ready" && rows.length === 0 && (
            <div className="enq-empty">
              <h2>{filter === "all" ? "No proposals yet" : `Nothing under ${groupWords(filter)}`}</h2>
              <p>{filter === "all" ? "A proposal is drafted from a deal in the pipeline, or with New proposal." : "Choose All to see every proposal."}</p>
            </div>
          )}

          <ProposalsLedger rows={rows} selectedId={openId} nowMs={nowMs} year={year} onOpen={(row) => { openProposal(row.id, true); }} />

          {total !== null && total > rows.length && list.status === "ready" && (
            <div className="enq-more" data-testid="proposals-more">
              <p className="enq-next__hint">Showing {rows.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}.</p>
              <button type="button" className="enq-button" onClick={loadMore} disabled={loadingMore || listReading} aria-busy={loadingMore}>
                {loadingMore && <ActivityIndicator size={18} />}
                {loadingMore ? "Reading more…" : `Show more (${(total - rows.length).toLocaleString("en-GB")} more)`}
              </button>
              {moreFailed && <p className="enq-confirm__error" role="alert">The next proposals could not be read. Those shown are as they were.</p>}
            </div>
          )}
        </section>
      )}

      {proposal !== null ? (
        <ProposalPanel key={proposal.id} proposal={proposal} {...panelProps} />
      ) : detail.status !== "idle" ? (
        <section className="enq-panel pr-panel" data-register="forest" aria-label="Proposal" aria-busy={detail.status === "loading"}>
          <div className="enq-panel__body">
            <div className="enq-panel__bar">
              <span />
              <button type="button" className="enq-close" onClick={closeProposal} aria-label="Close proposal"><X size={18} aria-hidden="true" /></button>
            </div>
            {detail.status === "loading" && <ActivityStatus variant="panel">Opening the proposal…</ActivityStatus>}
            {detail.status === "missing" && (
              <p className="enq-next__hint" role="alert" data-testid="proposal-link-failure">This proposal is not here any more. It may have been removed.</p>
            )}
            {detail.status === "error" && (
              <>
                <p className="enq-next__hint" role="alert" data-testid="proposal-link-failure">The proposal could not be opened.</p>
                <div className="enq-actions">
                  <button type="button" className="enq-quiet" onClick={() => { setTarget((current) => current === null ? null : { ...current, read: current.read + 1, quietly: false }); }}>
                    Try again
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      ) : wide ? (
        <section className="enq-panel enq-panel--rest pr-panel" data-register="forest" aria-label="No proposal open">
          <div className="enq-panel__body">
            <p className="enq-eyebrow">Proposals</p>
            <p className="pr-rest">Open a proposal to write its next version, send it, and read what the client said.</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A refusal the desk can put in words before anything is kept. */
class RefusedHere extends Error {}

/** The quote lines as the API takes them, or a refusal naming the line. */
function readQuoteLines(draft: ComposerDraft): readonly { description: string; quantity: number; unitAmountMinor: number }[] {
  return draft.lines.map((line, index) => {
    const at = `Quote line ${String(index + 1)}`;
    const quantity = Number(line.quantity);
    const unitAmountMinor = parsePoundsToMinor(line.pounds);
    if (line.description.trim() === "") throw new RefusedHere(`${at} needs a description.`);
    if (!Number.isInteger(quantity) || quantity < 1) throw new RefusedHere(`${at} needs a whole-number quantity of at least 1.`);
    if (unitAmountMinor === null) throw new RefusedHere(`${at} needs a price like 120 or 120.50.`);
    return { description: line.description.trim(), quantity, unitAmountMinor };
  });
}

// ---------------------------------------------------------------------------
// A new proposal, started in the sheet
// ---------------------------------------------------------------------------

interface NewProposalProps {
  readonly venueId: string | null;
  readonly onCancel: () => void;
  readonly onCreated: (id: string) => void;
}

function NewProposal({ venueId, onCancel, onCreated }: NewProposalProps): ReactElement {
  const headingId = useId();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (venueId === null || title.trim() === "" || saving) return;
    setSaving(true);
    setError(null);
    createProposal({ venueId, title: title.trim() })
      .then((created) => { onCreated(created.id); })
      .catch(() => { setError("The proposal was not started. Check the title and try again."); })
      .finally(() => { setSaving(false); });
  };

  if (venueId === null) {
    return (
      <div className="pl-new-deal" role="group" aria-labelledby={headingId}>
        <h2 id={headingId}>New proposal</h2>
        <p className="enq-next__hint">Your account is not linked to a venue, so a proposal cannot be started here.</p>
      </div>
    );
  }

  return (
    <form className="pl-new-deal" aria-labelledby={headingId} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <h2 id={headingId}>New proposal</h2>
      <p className="enq-next__hint">A proposal made from a deal in the pipeline brings its client, date and guests with it, and their layout when their enquiry has one.</p>
      <label className="pr-field">
        <span>What it is</span>
        <input data-testid="create-title" value={title} maxLength={200} placeholder="Autumn gala in the Grand Hall" disabled={saving}
          onChange={(event) => { setTitle(event.target.value); }} />
      </label>
      {error !== null && <p className="enq-confirm__error" role="alert" data-testid="create-error">{error}</p>}
      <div className="enq-actions">
        <button type="submit" className="enq-cta" data-testid="create-submit" disabled={saving || title.trim() === ""} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Starting…" : "Start the proposal"}
        </button>
        <button type="button" className="enq-quiet" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
