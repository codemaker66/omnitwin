import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ApiError } from "../../api/client.js";
import {
  createSupplierPass,
  makeSupplierPassLink,
  type SupplierPassBoard,
  type SupplierPassScopeItem,
  type SupplierPassSummary,
} from "../../api/supplier-coordination.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import {
  dayAndTime,
  defaultScope,
  endOfVenueDay,
  longDay,
  offerableScope,
  passMessage,
  passState,
  passToReplace,
  roomList,
  sameHolder,
  seeSentence,
  shortDay,
  venueDateInput,
} from "./supplier-pass-words.js";

// ---------------------------------------------------------------------------
// The "Issue pass" sheet (A Door for Everyone Outside, stage 1).
//
// Staff choose who the pass is for and which parts of the approved layout go
// on it, see in one sentence what the holder will and will not see, and make
// the pass. Nothing is sent from here: the sheet hands back a message that
// carries the essentials itself (day, arrival, address, who to ask for, the
// link) for the person to send from their own phone or inbox.
//
// The same sheet makes a new link for a pass that already exists, which
// stops the earlier link working.
// ---------------------------------------------------------------------------

export type IssuePassRequest =
  | { readonly mode: "issue"; readonly replace: SupplierPassSummary | null }
  | { readonly mode: "link"; readonly pass: SupplierPassSummary };

type Phase =
  | { readonly kind: "form" }
  | { readonly kind: "working"; readonly step: "pass" | "link" }
  | { readonly kind: "link_failed"; readonly packId: string; readonly holder: string; readonly message: string }
  | { readonly kind: "ready"; readonly holder: string; readonly url: string; readonly message: string };

type CopyState = "idle" | "message" | "link" | "blocked";

type Contact = { readonly name: string; readonly phone: string | null } | null;
type Arrival = { readonly title: string; readonly window: string };

const OTHER = "other";

interface Holder {
  readonly supplierId: string | null;
  readonly name: string;
}

function holderKeyFor(supplierId: string): string {
  return `supplier:${supplierId}`;
}

function absoluteLink(shareUrl: string): string {
  try {
    return new URL(shareUrl, window.location.origin).toString();
  } catch {
    return shareUrl;
  }
}

function refusalWords(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Only the events team can issue passes. Ask one of them to make it.";
    // The API's refusals for a stop date or a withdrawn pass are written to
    // be read: they say what to choose instead.
    if (err.status === 409 || err.status === 422) return err.message;
  }
  return fallback;
}

function arrivalsOf(items: readonly { readonly title: string; readonly arrivalWindow: string | null }[]): readonly Arrival[] {
  return items.flatMap((item) => item.arrivalWindow === null ? [] : [{ title: item.title, window: item.arrivalWindow }]);
}

/** The parts a fresh pass for this holder starts with: their parts on the
 *  latest plan, plus any general note their earlier pass already carried. */
export function startingScope(
  scope: readonly SupplierPassScopeItem[],
  holder: Holder | null,
  replace: SupplierPassSummary | null,
): ReadonlySet<string> {
  if (holder === null) return new Set();
  const chosen = new Set(defaultScope(scope, holder.supplierId));
  if (replace !== null) {
    const carried = new Set(replace.items.map((item) => item.title));
    for (const item of offerableScope(scope, holder.supplierId)) {
      if (carried.has(item.title)) chosen.add(item.instructionId);
    }
  }
  return chosen;
}

export function IssuePassSheet({ board, request, onClose }: {
  readonly board: SupplierPassBoard;
  readonly request: IssuePassRequest;
  readonly onClose: (changed: boolean) => void;
}): ReactElement {
  const headingId = useId();
  const trap = useFocusTrap<HTMLDivElement>();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const changedRef = useRef(false);
  const timeZone = board.venueTimeZone;

  const onPlanIds = useMemo(
    () => new Set(board.scope.map((item) => item.supplierId).filter((id): id is string => id !== null)),
    [board.scope],
  );
  const onPlan = useMemo(() => board.suppliers.filter((entry) => onPlanIds.has(entry.id)), [board.suppliers, onPlanIds]);
  const others = useMemo(() => board.suppliers.filter((entry) => !onPlanIds.has(entry.id)), [board.suppliers, onPlanIds]);
  const supplierFor = useCallback(
    (key: string): Holder | null => {
      const entry = board.suppliers.find((s) => holderKeyFor(s.id) === key);
      return entry === undefined ? null : { supplierId: entry.id, name: entry.name };
    },
    [board.suppliers],
  );

  const explicitReplace = request.mode === "issue" ? request.replace : null;

  // Who the sheet opens on: the holder of the pass being replaced, else the
  // first supplier on the plan who has no pass yet, so the usual next pass is
  // one tap away.
  const [initial] = useState((): { readonly key: string; readonly otherName: string; readonly addressedTo: string } => {
    if (explicitReplace !== null) {
      const entry = explicitReplace.supplierId === null ? undefined : board.suppliers.find((s) => s.id === explicitReplace.supplierId);
      return entry === undefined
        ? { key: OTHER, otherName: explicitReplace.title, addressedTo: explicitReplace.contactName ?? "" }
        : { key: holderKeyFor(entry.id), otherName: "", addressedTo: explicitReplace.contactName ?? entry.contactName ?? "" };
    }
    const waiting = onPlan.find((entry) => !board.passes.some((pass) => passState(pass) !== "withdrawn" && pass.supplierId === entry.id));
    const first = waiting ?? onPlan[0];
    return first === undefined
      ? { key: "", otherName: "", addressedTo: "" }
      : { key: holderKeyFor(first.id), otherName: "", addressedTo: first.contactName ?? "" };
  });

  const [holderKey, setHolderKey] = useState(initial.key);
  const [otherName, setOtherName] = useState(initial.otherName);
  const [addressedTo, setAddressedTo] = useState(initial.addressedTo);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => startingScope(
    board.scope,
    initial.key === OTHER ? { supplierId: null, name: initial.otherName } : supplierFor(initial.key),
    explicitReplace,
  ));

  const holder = useMemo((): Holder | null => {
    if (holderKey === OTHER) {
      const name = otherName.trim();
      return name.length === 0 ? null : { supplierId: null, name };
    }
    return supplierFor(holderKey);
  }, [holderKey, otherName, supplierFor]);

  const replace = useMemo((): SupplierPassSummary | null => {
    if (holder === null) return null;
    if (explicitReplace !== null && sameHolder(explicitReplace, holder)) return explicitReplace;
    return passToReplace(board.passes, holder);
  }, [board.passes, explicitReplace, holder]);

  const offerable = useMemo(() => {
    if (holderKey === OTHER) return offerableScope(board.scope, null);
    const supplier = supplierFor(holderKey);
    return supplier === null ? [] : offerableScope(board.scope, supplier.supplierId);
  }, [board.scope, holderKey, supplierFor]);

  const defaultDate = venueDateInput(board.defaultExpiresAt, timeZone);
  const latestDate = venueDateInput(board.latestExpiresAt, timeZone);
  const todayDate = venueDateInput(new Date().toISOString(), timeZone);
  const [untilDate, setUntilDate] = useState(defaultDate);

  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  const chooseHolder = useCallback((key: string) => {
    setHolderKey(key);
    setError(null);
    if (key === OTHER || key === "") {
      setChosen(new Set());
      setAddressedTo("");
      return;
    }
    const next = supplierFor(key);
    const entry = board.suppliers.find((s) => holderKeyFor(s.id) === key);
    const carried = next !== null && explicitReplace !== null && sameHolder(explicitReplace, next) ? explicitReplace : null;
    setChosen(startingScope(board.scope, next, carried));
    setAddressedTo(carried?.contactName ?? entry?.contactName ?? "");
  }, [board.scope, board.suppliers, explicitReplace, supplierFor]);

  const togglePart = useCallback((instructionId: string) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(instructionId)) next.delete(instructionId);
      else next.add(instructionId);
      return next;
    });
  }, []);

  const chosenItems = useMemo(
    () => offerable.filter((item) => chosen.has(item.instructionId)),
    [chosen, offerable],
  );

  // The stop date: the server's own default when untouched, else the end of
  // the chosen day on the venue's clock, never past the latest allowed.
  const untilProblem = useMemo((): string | null => {
    if (untilDate.length === 0) {
      return board.defaultExpiresAt === null
        ? "The event has no date in the Diary yet, so choose the day this pass stops working."
        : "Choose the day this pass stops working.";
    }
    if (untilDate < todayDate) return "That day has passed. Choose today or later.";
    if (latestDate.length > 0 && untilDate > latestDate) {
      return `A pass can stay open until ${shortDay(board.latestExpiresAt, timeZone) ?? latestDate} at the latest.`;
    }
    return null;
  }, [board.defaultExpiresAt, board.latestExpiresAt, latestDate, timeZone, todayDate, untilDate]);

  const expiresAtToSend = useMemo((): string | undefined => {
    if (board.defaultExpiresAt !== null && untilDate === defaultDate) return undefined;
    const end = endOfVenueDay(untilDate, timeZone);
    if (end === null) return undefined;
    const latest = Date.parse(board.latestExpiresAt);
    return new Date(Number.isFinite(latest) ? Math.min(end.getTime(), latest) : end.getTime()).toISOString();
  }, [board.defaultExpiresAt, board.latestExpiresAt, defaultDate, timeZone, untilDate]);

  const blocker = holder === null
    ? holderKey === OTHER ? "Write the name of the person or firm the pass is for." : "Choose who the pass is for."
    : chosenItems.length === 0
      ? "Tick at least one part to put on the pass."
      : untilProblem;

  const sentence = holder === null ? null : seeSentence({
    holder: holder.name,
    day: longDay(board.eventStartsAt, timeZone),
    rooms: roomList(board.rooms),
    parts: chosenItems.length,
    hasAddress: board.venueAddress !== null,
    contact: board.issuer,
  });

  const working = phase.kind === "working";

  const close = useCallback(() => {
    if (working) return;
    onClose(changedRef.current);
  }, [onClose, working]);

  const finish = useCallback((input: {
    readonly holder: string;
    readonly shareUrl: string;
    readonly expiresAt: string | null;
    readonly arrivals: readonly Arrival[];
    readonly contact: Contact;
  }) => {
    const url = absoluteLink(input.shareUrl);
    setCopy("idle");
    setPhase({
      kind: "ready",
      holder: input.holder,
      url,
      message: passMessage({
        venueName: board.venueName,
        day: longDay(board.eventStartsAt, timeZone),
        rooms: roomList(board.rooms),
        address: board.venueAddress,
        arrivals: input.arrivals,
        contact: input.contact,
        url,
        until: shortDay(input.expiresAt, timeZone),
      }),
    });
  }, [board.eventStartsAt, board.rooms, board.venueAddress, board.venueName, timeZone]);

  const makeLink = useCallback((input: {
    readonly packId: string;
    readonly holder: string;
    readonly supersedesPackId: string | null;
    readonly arrivals: readonly Arrival[];
    readonly contact: Contact;
  }) => {
    setPhase({ kind: "working", step: "link" });
    setError(null);
    void makeSupplierPassLink(input.packId, input.supersedesPackId === null ? {} : { supersedesPackId: input.supersedesPackId })
      .then((result) => {
        changedRef.current = true;
        finish({ holder: input.holder, shareUrl: result.shareUrl, expiresAt: result.pack.expiresAt, arrivals: input.arrivals, contact: input.contact });
      })
      .catch((err: unknown) => {
        setPhase({
          kind: "link_failed",
          packId: input.packId,
          holder: input.holder,
          message: refusalWords(err, "Nothing was sent."),
        });
      });
  }, [finish]);

  const issue = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working || blocker !== null || holder === null || board.handoff === null) return;
    const arrivals = arrivalsOf(chosenItems);
    const replacing = replace?.id ?? null;
    const addressee = addressedTo.trim();
    setPhase({ kind: "working", step: "pass" });
    setError(null);
    void createSupplierPass({
      handoffPackId: board.handoff.id,
      supplierInstructionIds: chosenItems.map((item) => item.instructionId),
      supplierId: holder.supplierId,
      title: holder.name,
      contactName: addressee.length === 0 ? null : addressee,
      ...(expiresAtToSend === undefined ? {} : { expiresAt: expiresAtToSend }),
    })
      .then((bundle) => {
        changedRef.current = true;
        makeLink({ packId: bundle.pack.id, holder: holder.name, supersedesPackId: replacing, arrivals, contact: board.issuer });
      })
      .catch((err: unknown) => {
        setPhase({ kind: "form" });
        setError(refusalWords(err, "The pass could not be made. Nothing was sent. Try again."));
      });
  }, [addressedTo, blocker, board.handoff, board.issuer, chosenItems, expiresAtToSend, holder, makeLink, replace, working]);

  const copyText = useCallback((text: string, which: "message" | "link") => {
    const select = (): void => {
      const area = messageRef.current;
      if (area !== null) {
        area.focus();
        area.select();
      }
      setCopy("blocked");
    };
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== "function") {
      select();
      return;
    }
    clipboard.writeText(text).then(() => { setCopy(which); }, select);
  }, []);

  const linkPass = request.mode === "link" ? request.pass : null;
  const title = phase.kind === "ready"
    ? `Pass ready for ${phase.holder}`
    : linkPass !== null
      ? `${passState(linkPass) === "draft" ? "Make the link" : "New link"} for ${linkPass.title}`
      : explicitReplace !== null ? `Fresh pass for ${explicitReplace.title}` : "Issue pass";

  const replaceWords = replace === null ? null : passState(replace) === "withdrawn"
    ? `This replaces their withdrawn pass from ${dayAndTime(replace.createdAt, timeZone) ?? "earlier"}; their page will say what changed for them.`
    : `Their earlier pass, made ${dayAndTime(replace.createdAt, timeZone) ?? "earlier"}, stops working when this one is made. What they confirmed on it stays on record, and their page will say what changed for them.`;

  const body = (): ReactElement => {
    if (phase.kind === "ready") {
      return (
        <div className="issue-pass-body">
          <p className="issue-pass-lede">
            Copy the message and send it by text, WhatsApp or email. It carries the day, the arrival times, the address and who to ask for, so it still helps with no signal.
          </p>
          <label className="issue-pass-field">
            <span>Message to send</span>
            <textarea ref={messageRef} readOnly value={phase.message} rows={9} />
          </label>
          <div className="issue-pass-row">
            <button type="button" className="issue-pass-button is-primary" onClick={() => { copyText(phase.message, "message"); }}>
              Copy message
            </button>
            <button type="button" className="issue-pass-button" onClick={() => { copyText(phase.url, "link"); }}>
              Copy link only
            </button>
          </div>
          <p className="issue-pass-status" role="status">
            {copy === "message" ? "Message copied." : copy === "link" ? "Link copied." : copy === "blocked"
              ? "This device would not copy. The message is selected: copy it with your keyboard, or press and hold."
              : ""}
          </p>
          <p className="issue-pass-note">
            The link is shown only here. If you close this before sending it, make a new link from the board; the one here then stops working.
          </p>
          <div className="issue-pass-row is-end">
            <button type="button" className="issue-pass-button" onClick={close}>Done</button>
          </div>
        </div>
      );
    }

    if (phase.kind === "link_failed") {
      return (
        <div className="issue-pass-body">
          <p className="issue-pass-error" role="alert">
            The pass for {phase.holder} was made, but its link was not. {phase.message}
          </p>
          <p className="issue-pass-note">It waits on the board as “Not sent” until its link is made.</p>
          <div className="issue-pass-row">
            <button
              type="button"
              className="issue-pass-button is-primary"
              onClick={() => {
                makeLink({
                  packId: phase.packId,
                  holder: phase.holder,
                  supersedesPackId: linkPass === null ? replace?.id ?? null : null,
                  arrivals: linkPass === null ? arrivalsOf(chosenItems) : arrivalsOf(linkPass.items),
                  contact: linkPass === null ? board.issuer : linkPass.madeBy,
                });
              }}
            >
              Make the link
            </button>
            <button type="button" className="issue-pass-button" onClick={close}>Close</button>
          </div>
        </div>
      );
    }

    if (linkPass !== null) {
      const draft = passState(linkPass) === "draft";
      return (
        <div className="issue-pass-body">
          <div className="issue-pass-decision" data-register="forest">
            <p>
              {draft
                ? `This makes the link for ${linkPass.title}'s pass.`
                : `This makes a new link to ${linkPass.title}'s pass. The link sent before stops working as soon as this one is made.`}
            </p>
            <p>Nothing is sent: you copy the message and send it yourself.</p>
            {error !== null && <p className="issue-pass-error" role="alert">{error}</p>}
            <button
              type="button"
              className="issue-pass-button is-primary"
              disabled={working}
              aria-busy={working}
              onClick={() => {
                makeLink({ packId: linkPass.id, holder: linkPass.title, supersedesPackId: null, arrivals: arrivalsOf(linkPass.items), contact: linkPass.madeBy });
              }}
            >
              {working && <ActivityIndicator size={18} />}
              {working ? "Making the link…" : draft ? "Make the link" : "Make the new link"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <form className="issue-pass-body" onSubmit={issue} noValidate>
        <fieldset className="issue-pass-group" disabled={working}>
          <legend>Who it is for</legend>
          <label className="issue-pass-field">
            <span>Supplier</span>
            <select value={holderKey} onChange={(event) => { chooseHolder(event.target.value); }}>
              {holderKey === "" && <option value="">Choose who the pass is for</option>}
              {onPlan.length > 0 && (
                <optgroup label="Named on this plan">
                  {onPlan.map((entry) => <option key={entry.id} value={holderKeyFor(entry.id)}>{entry.name}</option>)}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Other suppliers on file">
                  {others.map((entry) => <option key={entry.id} value={holderKeyFor(entry.id)}>{entry.name}</option>)}
                </optgroup>
              )}
              <option value={OTHER}>Someone not on file</option>
            </select>
          </label>
          {holderKey === OTHER && (
            <label className="issue-pass-field">
              <span>Their name or firm</span>
              <input value={otherName} maxLength={200} autoComplete="off" onChange={(event) => { setOtherName(event.target.value); }} />
            </label>
          )}
          <div className="issue-pass-field">
            <label htmlFor={`${headingId}-addressed`}>Addressed to</label>
            <input
              id={`${headingId}-addressed`}
              value={addressedTo}
              maxLength={160}
              autoComplete="off"
              aria-describedby={`${headingId}-addressed-hint`}
              onChange={(event) => { setAddressedTo(event.target.value); }}
            />
            <small id={`${headingId}-addressed-hint`}>The name their page opens with. Leave it empty to use the contact on file.</small>
          </div>
        </fieldset>

        <fieldset className="issue-pass-group" disabled={working}>
          <legend>What goes on the pass</legend>
          {offerable.length === 0 ? (
            <p className="issue-pass-note">
              {holderKey === OTHER
                ? "Only the plan's general notes can go to someone not on file, and this plan has none. Choose a supplier on the plan instead."
                : "Nothing on the approved layout is for them yet. Choose another supplier, or add their part to the plan and compile it again."}
            </p>
          ) : (
            <ul className="issue-pass-parts">
              {offerable.map((item) => (
                <li key={item.instructionId}>
                  <label className="issue-pass-part">
                    <input type="checkbox" checked={chosen.has(item.instructionId)} onChange={() => { togglePart(item.instructionId); }} />
                    <span className="issue-pass-part-text">
                      <strong>{item.title}</strong>
                      <span className="issue-pass-part-detail">{item.detail}</span>
                      <span className="issue-pass-part-meta">
                        {item.supplierId === null ? "General note" : "Their part"}
                        {item.arrivalWindow === null ? "" : ` · arrive ${item.arrivalWindow}`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset className="issue-pass-group" disabled={working}>
          <legend>Works until</legend>
          <div className="issue-pass-field">
            <label htmlFor={`${headingId}-until`}>Last day the link opens</label>
            <input
              id={`${headingId}-until`}
              type="date"
              value={untilDate}
              min={todayDate}
              max={latestDate.length > 0 ? latestDate : undefined}
              required
              aria-describedby={`${headingId}-until-hint`}
              onChange={(event) => { setUntilDate(event.target.value); }}
            />
            <small id={`${headingId}-until-hint`}>
              {board.defaultExpiresAt === null
                ? "The event has no date in the Diary yet, so choose one."
                : `Seven days after the event (${shortDay(board.defaultExpiresAt, timeZone) ?? defaultDate}) unless you choose another day.`}
              {` A pass can stay open until ${shortDay(board.latestExpiresAt, timeZone) ?? latestDate} at the latest.`}
            </small>
          </div>
        </fieldset>

        <div className="issue-pass-decision" data-register="forest">
          <h3>What they will see</h3>
          {sentence === null ? (
            <p>Choose who the pass is for to see what it will show them.</p>
          ) : (
            <>
              <p>{sentence.will}</p>
              <p>{sentence.willNot}</p>
            </>
          )}
          {replaceWords !== null && <p>{replaceWords}</p>}
          <p>Nothing is sent: making the pass gives you a message to copy and send yourself.</p>
          {blocker !== null && <p className="issue-pass-why" id={`${headingId}-why`}>{blocker}</p>}
          {error !== null && <p className="issue-pass-error" role="alert">{error}</p>}
          {working && <ActivityStatus>{phase.step === "pass" ? "Making the pass…" : "Making the link…"}</ActivityStatus>}
          <button
            type="submit"
            className="issue-pass-button is-primary"
            disabled={working || blocker !== null}
            aria-busy={working}
            aria-describedby={blocker === null ? undefined : `${headingId}-why`}
          >
            {working && <ActivityIndicator size={18} />}
            {working ? "Making the pass…" : "Make the pass"}
          </button>
        </div>
      </form>
    );
  };

  return createPortal(
    <div
      className="issue-pass-scrim"
      onMouseDown={(event) => { if (event.target === event.currentTarget && phase.kind === "form") close(); }}
    >
      <div
        ref={trap}
        className="issue-pass-sheet"
        data-register="ivory"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
      >
        <header className="issue-pass-header">
          <div>
            <p className="issue-pass-kicker">
              {board.venueName ?? "Supplier pass"}
              {board.eventStartsAt === null ? "" : ` · ${longDay(board.eventStartsAt, timeZone) ?? ""}`}
            </p>
            <h2 id={headingId}>{title}</h2>
          </div>
          <button type="button" className="issue-pass-close" aria-label="Close" disabled={working} onClick={close}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        {body()}
      </div>
    </div>,
    document.body,
  );
}
