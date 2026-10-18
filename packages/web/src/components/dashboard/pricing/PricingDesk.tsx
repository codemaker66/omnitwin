import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { PricingAdvice, PricingAdviceItem } from "@omnitwin/types";
import * as pricingApi from "../../../api/pricing.js";
import type { CreatePricingRuleInput } from "../../../api/pricing.js";
import {
  dismissPricingAdvice,
  getPricingAdvice,
  getPricingDesk,
  restorePricingAdvice,
  type DeskRule,
  type PricingDesk as Desk,
} from "../../../api/pricing-desk.js";
import { useMediaQuery } from "../../../hooks/use-media-query.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { deskGreeting } from "../enquiries/enquiry-desk-format.js";
import { ruleSaveError } from "../pricing-rule-window.js";
import { AdvicePanel, DeskOverview, RatePanel } from "./PricingPanels.js";
import { RateForm } from "./RateForm.js";
import {
  adviceKindWords,
  basisWords,
  changeOf,
  dateTile,
  datesWords,
  dayWords,
  draftFromAdvice,
  draftOf,
  EMPTY_DRAFT,
  groupAdvice,
  groupRates,
  lastChangeLine,
  moneyWords,
  priceWords,
  rangeWords,
  roomName,
  settersWords,
  timeTile,
  timeWords,
  type DeskFilter,
  type RateDraft,
} from "./pricing-desk-format.js";
import "../enquiries/EnquiriesDesk.css";
import "./PricingDesk.css";

// ---------------------------------------------------------------------------
// The Pricing desk (Blake, 17 October 2026): "we want the venue admin to be
// able to add/change their pricing on their own, but also we could perhaps
// give them suggestions to pricing like hotels and airways do".
//
// The Enquiries desk's composition: the ivory sheet holds the price list,
// room by room, each rate with who changed it and when; the copper plane's
// counts are its filters; the forest panel beside it opens one rate, one
// suggestion or the rate form, so the list is never lost.
//
// Who sees what follows the API (routes/pricing-desk.ts): the venue's
// commercial team reads the list; only those who set prices see edit
// controls and suggestions, and everyone else is told, by name, who to ask.
// A suggestion is advice: it opens the form filled in, and nothing changes
// until a person saves it.
// ---------------------------------------------------------------------------

const WIDE_DESK = "(min-width: 1180px)";

type DeskRead =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly desk: Desk; readonly refreshing: boolean };

type AdviceRead =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly advice: PricingAdvice };

type FormOpen = {
  readonly kind: "form";
  readonly mode: "create" | "edit";
  readonly ruleId: string | null;
  /** The rate as it stands, for a change; null for a new rate. */
  readonly original: RateDraft | null;
  /** What the form opens with: the rate, or a suggestion's figure on it. */
  readonly initial: RateDraft;
  readonly adviceKey: string | null;
  readonly fromAdvice: string | null;
};

type Open =
  | { readonly kind: "rate"; readonly id: string }
  | { readonly kind: "advice"; readonly key: string }
  | FormOpen;

type Notice =
  | { readonly kind: "saved"; readonly name: string }
  | { readonly kind: "retired"; readonly rule: DeskRule }
  | { readonly kind: "restored"; readonly name: string }
  | { readonly kind: "dismissed"; readonly item: PricingAdviceItem }
  | { readonly kind: "failed"; readonly text: string };

type Busy = "save" | "retire" | "restore" | "dismiss" | "undo" | null;

const MOVE_KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  j: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  k: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

function errorWords(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

export function PricingDesk(): ReactElement {
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);
  const userName = useAuthStore((state) => state.user?.name ?? null);
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const [nowMs] = useState(() => Date.now());
  const [read, setRead] = useState<DeskRead>({ status: "loading" });
  const [adviceRead, setAdviceRead] = useState<AdviceRead>({ status: "idle" });
  const [deskReloads, setDeskReloads] = useState(0);
  const [adviceReloads, setAdviceReloads] = useState(0);
  const [filter, setFilter] = useState<DeskFilter>("in_use");
  const [open, setOpen] = useState<Open | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The row the open panel came from, for focus to return to. */
  const lastRow = useRef<string | null>(null);
  const returnRowRef = useRef<string | null>(null);
  const focusPanelRef = useRef(false);

  // The list. A refresh keeps the list on screen while it is read again.
  useEffect(() => {
    if (venueId === null) return;
    const controller = new AbortController();
    setRead((previous) => (previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" }));
    getPricingDesk(venueId, controller.signal)
      .then((desk) => { setRead({ status: "ready", desk, refreshing: false }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRead((previous) => (previous.status === "ready" ? { ...previous, refreshing: false } : { status: "error" }));
        setNotice((current) => (current === null || current.kind !== "failed"
          ? { kind: "failed", text: errorWords(error, "The price list could not be read again. What is shown may be out of date.") }
          : current));
      });
    return () => { controller.abort(); };
  }, [venueId, deskReloads]);

  const desk = read.status === "ready" ? read.desk : null;
  const canSetPrices = desk?.canSetPrices ?? false;

  // Suggestions, for the people who set prices only.
  useEffect(() => {
    if (venueId === null || !canSetPrices) return;
    const controller = new AbortController();
    setAdviceRead((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    getPricingAdvice(venueId, controller.signal)
      .then((advice) => { setAdviceRead({ status: "ready", advice }); })
      .catch(() => { if (!controller.signal.aborted) setAdviceRead({ status: "error" }); });
    return () => { controller.abort(); };
  }, [venueId, canSetPrices, adviceReloads]);

  // Focus follows the reader into what they opened, and back to its row.
  useEffect(() => {
    if (open !== null && focusPanelRef.current) {
      focusPanelRef.current = false;
      headingRef.current?.focus();
    }
    if (open === null && returnRowRef.current !== null) {
      const key = returnRowRef.current;
      returnRowRef.current = null;
      listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus();
    }
  }, [open]);

  const advice = adviceRead.status === "ready" ? adviceRead.advice : null;
  const live = desk?.rules ?? [];
  const inUse = live.filter((rule) => rule.isActive);
  const paused = live.filter((rule) => !rule.isActive);
  const retired = desk?.retired ?? [];
  const rooms = desk?.rooms ?? [];
  const timeZone = desk?.venue.timezone ?? "Europe/London";
  const currency = live[0]?.currency ?? "GBP";

  const openThing = (next: Open, rowKey: string | null): void => {
    focusPanelRef.current = true;
    setPanelError(null);
    setFormDirty(false);
    lastRow.current = rowKey;
    setOpen(next);
  };

  const close = useCallback((): void => {
    returnRowRef.current = lastRow.current;
    setPanelError(null);
    setFormDirty(false);
    setOpen(null);
  }, []);

  const reloadAll = (): void => {
    setDeskReloads((count) => count + 1);
    if (canSetPrices) setAdviceReloads((count) => count + 1);
  };

  const ruleById = (id: string): DeskRule | undefined => live.find((rule) => rule.id === id) ?? retired.find((rule) => rule.id === id);

  // --- Writes -------------------------------------------------------------

  const save = (form: FormOpen, draft: RateDraft, body: CreatePricingRuleInput): void => {
    if (venueId === null || busy !== null) return;
    setBusy("save");
    setPanelError(null);
    const followed = form.adviceKey === null ? {} : { adviceKey: form.adviceKey };
    const write = form.mode === "edit" && form.ruleId !== null
      ? pricingApi.updatePricingRule(venueId, form.ruleId, { ...changeOf(form.original ?? form.initial, body, draft), ...followed })
      : pricingApi.createPricingRule(venueId, { ...body, ...followed });
    write
      .then((saved) => {
        setNotice({ kind: "saved", name: saved.name });
        setFormDirty(false);
        focusPanelRef.current = true;
        setOpen({ kind: "rate", id: saved.id });
        reloadAll();
      })
      .catch((error: unknown) => { setPanelError(ruleSaveError(error, "The rate could not be saved. Nothing was changed.")); })
      .finally(() => { setBusy(null); });
  };

  const retire = (rule: DeskRule): void => {
    if (venueId === null || busy !== null) return;
    setBusy("retire");
    setPanelError(null);
    pricingApi.deletePricingRule(venueId, rule.id)
      .then(() => {
        setNotice({ kind: "retired", rule });
        lastRow.current = null;
        setOpen(null);
        reloadAll();
      })
      .catch((error: unknown) => { setPanelError(errorWords(error, "The rate could not be retired. It is still in use.")); })
      .finally(() => { setBusy(null); });
  };

  /** Brings a retired rate back: as it was before it was just retired
   *  (Undo), or not in use from the Retired list, so nothing quotes it
   *  before someone has looked at it. */
  const restore = (rule: DeskRule, isActive: boolean, from: "notice" | "panel"): void => {
    if (venueId === null || busy !== null) return;
    setBusy("restore");
    setPanelError(null);
    pricingApi.restorePricingRule(venueId, rule.id, isActive)
      .then((back) => {
        setNotice({ kind: "restored", name: back.name });
        focusPanelRef.current = true;
        setOpen({ kind: "rate", id: back.id });
        reloadAll();
      })
      .catch((error: unknown) => {
        const text = errorWords(error, "The rate could not be brought back. It is still retired.");
        if (from === "notice") setNotice({ kind: "failed", text });
        else setPanelError(text);
      })
      .finally(() => { setBusy(null); });
  };

  const dismiss = (item: PricingAdviceItem): void => {
    if (venueId === null || busy !== null) return;
    setBusy("dismiss");
    setPanelError(null);
    dismissPricingAdvice(venueId, item.key)
      .then(() => {
        setNotice({ kind: "dismissed", item });
        lastRow.current = null;
        setOpen(null);
        setAdviceReloads((count) => count + 1);
      })
      .catch((error: unknown) => { setPanelError(errorWords(error, "The suggestion could not be dismissed. It is still listed.")); })
      .finally(() => { setBusy(null); });
  };

  const undoDismiss = (item: PricingAdviceItem): void => {
    if (venueId === null || busy !== null) return;
    setBusy("undo");
    restorePricingAdvice(venueId, item.key)
      .then(() => {
        setNotice(null);
        setAdviceReloads((count) => count + 1);
      })
      .catch((error: unknown) => { setNotice({ kind: "failed", text: errorWords(error, "The suggestion could not be brought back.") }); })
      .finally(() => { setBusy(null); });
  };

  const acceptAdvice = (item: PricingAdviceItem, rule: DeskRule): void => {
    const opened = draftFromAdvice(item, rule);
    openThing({
      kind: "form", mode: opened.mode, ruleId: opened.mode === "edit" ? rule.id : null,
      original: opened.mode === "edit" ? draftOf(rule) : null, initial: opened.draft,
      adviceKey: item.key, fromAdvice: `From a suggestion for ${dayWords(item.date)}`,
    }, lastRow.current);
  };

  const addRate = (): void => {
    openThing({
      kind: "form", mode: "create", ruleId: null, original: null,
      initial: { ...EMPTY_DRAFT, spaceId: rooms[0]?.id ?? "" }, adviceKey: null, fromAdvice: null,
    }, null);
  };

  // --- Keys ---------------------------------------------------------------

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const move = MOVE_KEYS[event.key];
    if (move === undefined) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [])];
    const index = rows.findIndex((row) => row === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    rows[move(index, rows.length - 1)]?.focus();
  };

  const onDeskKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || open === null || busy !== null) return;
    if (open.kind === "form" && formDirty) return;
    event.preventDefault();
    close();
  };

  // --- What is shown --------------------------------------------------------

  if (venueId === null) {
    return (
      <div className="enq-desk enq-desk--single pdk-desk" data-register="ivory">
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head"><h1 id={titleId}>Pricing</h1></header>
          <p className="enq-summary">Prices are kept for each venue, and this account is not connected to one. A Venviewer administrator can change any venue's prices from Admin.</p>
        </section>
      </div>
    );
  }

  const greeting = deskGreeting(nowMs, userName);
  const suggestionsTotal = advice?.total ?? null;
  const openRule = open?.kind === "rate" ? ruleById(open.id) ?? null : null;
  const openItem = open?.kind === "advice" ? advice?.items.find((item) => item.key === open.key) ?? null : null;
  const showPanel = open !== null && (open.kind === "form" || openRule !== null || openItem !== null);
  const showSheet = wide || !showPanel;
  const layout = wide ? "wide" as const : "single" as const;

  const stages: readonly { readonly filter: DeskFilter; readonly label: string; readonly count: number | null }[] = [
    { filter: "in_use", label: "In use", count: desk === null ? null : inUse.length },
    { filter: "paused", label: "Not in use", count: desk === null ? null : paused.length },
    ...(canSetPrices ? [{ filter: "suggestions" as const, label: "Suggestions", count: suggestionsTotal }] : []),
    { filter: "retired", label: "Retired", count: desk === null ? null : retired.length },
  ];

  return (
    <div className={`enq-desk pdk-desk${wide ? "" : " enq-desk--single"}`} data-register="ivory" onKeyDown={onDeskKey}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <div className="pdk-head">
              <h1 id={titleId}>Pricing</h1>
              {canSetPrices && (
                <button type="button" className="enq-button pdk-add" onClick={addRate} disabled={busy !== null}>Add a rate</button>
              )}
            </div>
          </header>
          <div className="enq-summary">
            {read.status === "loading" && <ActivityStatus>Reading the price list…</ActivityStatus>}
            {read.status === "error" && (
              <div className="enq-summary__retry">
                <p>The price list could not be read. Nothing has changed.</p>
                <button type="button" className="enq-button" onClick={() => { setDeskReloads((count) => count + 1); }}>Try again</button>
              </div>
            )}
            {desk !== null && (
              <p data-testid="pricing-summary">
                <strong>{inUse.length === 1 ? "1 rate" : `${inUse.length.toLocaleString("en-GB")} rates`}</strong> in use across{" "}
                <strong>{rooms.length === 1 ? "1 room" : `${rooms.length.toLocaleString("en-GB")} rooms`}</strong>.
                {canSetPrices
                  ? suggestionsTotal !== null && suggestionsTotal > 0
                    ? <> <strong>{suggestionsTotal === 1 ? "1 suggestion" : `${suggestionsTotal.toLocaleString("en-GB")} suggestions`}</strong> to look at.</>
                    : null
                  : <> Prices are set by {settersWords(desk.setters)}.</>}
              </p>
            )}
          </div>

          {desk !== null && (
            <div className="enq-stages pdk-stages" role="group" aria-label="Show rates">
              {stages.map((stage) => {
                const shown = stage.count === null ? "" : stage.count.toLocaleString("en-GB");
                return (
                  <button key={stage.filter} type="button" className="enq-stage" aria-pressed={filter === stage.filter}
                    aria-label={stage.count === null ? stage.label : `${stage.label}, ${shown}`}
                    onClick={() => { setFilter(stage.filter); }}>
                    <span className="enq-stage__count" aria-hidden="true">{shown}</span>
                    <span className="enq-stage__label" aria-hidden="true">{stage.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <NoticeLine notice={notice} busy={busy}
            onUndoRetire={(rule) => { restore(rule, rule.isActive, "notice"); }}
            onUndoDismiss={undoDismiss}
            onDone={() => { setNotice(null); }} />
          {read.status === "ready" && read.refreshing && <ActivityStatus className="enq-sheet__activity">Reading the price list again…</ActivityStatus>}

          {desk !== null && (
            <div className="enq-ledger pdk-ledger" ref={listRef} onKeyDown={moveFocus}>
              {filter === "suggestions" ? (
                <AdviceList read={adviceRead} openKey={open?.kind === "advice" ? open.key : null}
                  onRetry={() => { setAdviceReloads((count) => count + 1); }}
                  onOpen={(item) => { openThing({ kind: "advice", key: item.key }, `advice:${item.key}`); }} />
              ) : (
                <RateList
                  rules={filter === "in_use" ? inUse : filter === "paused" ? paused : retired}
                  filter={filter}
                  rooms={rooms}
                  timeZone={timeZone}
                  titleId={titleId}
                  openId={open?.kind === "rate" ? open.id : open?.kind === "form" ? open.ruleId : null}
                  onOpen={(rule) => { openThing({ kind: "rate", id: rule.id }, `rate:${rule.id}`); }}
                />
              )}
            </div>
          )}
        </section>
      )}

      {showPanel && open.kind === "form" && (
        <aside className="enq-panel pdk-panel" data-register="forest" aria-label={open.mode === "create" ? "Add a rate" : "Change a rate"}>
          <div className="enq-panel__body">
            <RateForm
              key={`${open.mode}:${open.ruleId ?? "new"}:${open.adviceKey ?? ""}`}
              mode={open.mode}
              ruleName={open.ruleId === null ? null : ruleById(open.ruleId)?.name ?? null}
              original={open.original}
              initial={open.initial}
              rooms={rooms}
              currency={currency}
              others={live.filter((rule) => rule.id !== open.ruleId)}
              fromAdvice={open.fromAdvice}
              saving={busy === "save"}
              error={panelError}
              headingRef={headingRef}
              onCancel={close}
              onSave={(draft, body) => { save(open, draft, body); }}
              onDirtyChange={setFormDirty}
            />
          </div>
        </aside>
      )}
      {showPanel && openRule !== null && (
        <RatePanel
          key={openRule.id}
          rule={openRule}
          rooms={rooms}
          timeZone={timeZone}
          canSetPrices={canSetPrices}
          setters={desk?.setters ?? []}
          retired={openRule.deletedAt !== null}
          busy={busy === "retire" || busy === "restore" ? busy : null}
          error={panelError}
          layout={layout}
          headingRef={headingRef}
          onClose={close}
          onEdit={() => {
            const current = draftOf(openRule);
            openThing({ kind: "form", mode: "edit", ruleId: openRule.id, original: current, initial: current, adviceKey: null, fromAdvice: null }, lastRow.current);
          }}
          onRetire={() => { retire(openRule); }}
          onRestore={() => { restore(openRule, false, "panel"); }}
        />
      )}
      {showPanel && openItem !== null && (
        <AdvicePanel
          key={openItem.key}
          item={openItem}
          rule={live.find((rule) => rule.id === openItem.ruleId) ?? null}
          busy={busy === "dismiss"}
          error={panelError}
          layout={layout}
          headingRef={headingRef}
          onClose={close}
          onUse={() => {
            const rule = live.find((candidate) => candidate.id === openItem.ruleId);
            if (rule !== undefined) acceptAdvice(openItem, rule);
          }}
          onDismiss={() => { dismiss(openItem); }}
        />
      )}
      {!showPanel && wide && desk !== null && (
        <DeskOverview
          canSetPrices={canSetPrices}
          setters={desk.setters}
          inUse={inUse.length}
          suggestions={suggestionsTotal}
          onShowSuggestions={() => { setFilter("suggestions"); }}
          onAdd={addRate}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The notice under the counts: what was just done, with its way back.
// ---------------------------------------------------------------------------

function NoticeLine({ notice, busy, onUndoRetire, onUndoDismiss, onDone }: {
  readonly notice: Notice | null;
  readonly busy: Busy;
  readonly onUndoRetire: (rule: DeskRule) => void;
  readonly onUndoDismiss: (item: PricingAdviceItem) => void;
  readonly onDone: () => void;
}): ReactElement {
  return (
    <div className="pdk-notice-slot" role="status" aria-live="polite">
      {notice !== null && (
        <div className={`enq-notice${notice.kind === "failed" ? " enq-notice--alert" : ""}`}>
          {notice.kind === "saved" && <p>Saved “{notice.name}”.</p>}
          {notice.kind === "restored" && <p>Brought back “{notice.name}”.</p>}
          {notice.kind === "retired" && (
            <>
              <p>Retired “{notice.rule.name}”.</p>
              <button type="button" className="enq-button" disabled={busy !== null} onClick={() => { onUndoRetire(notice.rule); }}>Undo</button>
            </>
          )}
          {notice.kind === "dismissed" && (
            <>
              <p>Dismissed the suggestion for {dayWords(notice.item.date)}.</p>
              <button type="button" className="enq-button" disabled={busy !== null} onClick={() => { onUndoDismiss(notice.item); }}>Undo</button>
            </>
          )}
          {notice.kind === "failed" && <p>{notice.text}</p>}
          <button type="button" className="enq-button pdk-notice__done" onClick={onDone}>Done</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The rates, room by room
// ---------------------------------------------------------------------------

const EMPTY_WORDS: Readonly<Record<Exclude<DeskFilter, "suggestions">, { readonly heading: string; readonly text: string }>> = {
  in_use: { heading: "No rates in use yet", text: "Rates added here are offered in quotes and enquiry estimates." },
  paused: { heading: "Every rate on the list is in use", text: "A rate switched off in its form waits here, kept but not offered." },
  retired: { heading: "Nothing retired", text: "A retired rate waits here, with its history, until it is brought back." },
};

function RateList({ rules, filter, rooms, timeZone, titleId, openId, onOpen }: {
  readonly rules: readonly DeskRule[];
  readonly filter: Exclude<DeskFilter, "suggestions">;
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly timeZone: string;
  readonly titleId: string;
  readonly openId: string | null;
  readonly onOpen: (rule: DeskRule) => void;
}): ReactElement {
  if (rules.length === 0) {
    return (
      <div className="enq-empty">
        <h2>{EMPTY_WORDS[filter].heading}</h2>
        <p>{EMPTY_WORDS[filter].text}</p>
      </div>
    );
  }
  return (
    <>
      {groupRates(rules, rooms).map((group, index) => (
        <section key={group.key} aria-labelledby={`${titleId}-room-${String(index)}`}>
          <h2 className="enq-group" id={`${titleId}-room-${String(index)}`}>
            {group.heading}
            <span className="enq-group__count"><span className="vv-sr-only">, </span>{group.rules.length.toLocaleString("en-GB")}</span>
          </h2>
          <ul className="enq-rows">
            {group.rules.map((rule) => {
              const tile = timeTile(rule);
              const change = lastChangeLine(rule, timeZone);
              return (
                <li key={rule.id}>
                  <button type="button" className="enq-row pdk-row" data-row-key={`rate:${rule.id}`}
                    aria-current={openId === rule.id ? "true" : undefined}
                    aria-label={`${rule.name}, ${priceWords(rule)}, ${timeWords(rule)}, ${datesWords(rule)}. ${change}.`}
                    onClick={() => { onOpen(rule); }}>
                    <span className={`pdk-time${tile.until === null ? " pdk-time--any" : ""}`} aria-hidden="true">
                      <span className="pdk-time__from">{tile.from}</span>
                      <span className="pdk-time__until">{tile.until === null ? "time" : `to ${tile.until}`}</span>
                    </span>
                    <span className="enq-row__main" aria-hidden="true">
                      <span className="enq-row__title">{rule.name}</span>
                      <span className="enq-row__meta">{roomName(rule.spaceId, rooms)} · {datesWords(rule)}</span>
                      <span className="pdk-row__change">{change}</span>
                    </span>
                    <span className="enq-row__side" aria-hidden="true">
                      <span className="pdk-price">{priceWords(rule)}</span>
                      {filter === "paused" && <span className="enq-chip pdk-chip" data-state="paused">Not in use</span>}
                      {filter === "retired" && <span className="enq-chip pdk-chip" data-state="retired">Retired</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// The suggestions, month by month
// ---------------------------------------------------------------------------

function AdviceList({ read, openKey, onRetry, onOpen }: {
  readonly read: AdviceRead;
  readonly openKey: string | null;
  readonly onRetry: () => void;
  readonly onOpen: (item: PricingAdviceItem) => void;
}): ReactElement {
  const headingId = useId();
  if (read.status === "error") {
    return (
      <div className="enq-notice enq-notice--alert" role="alert">
        <p>The suggestions could not be worked out. The price list is unaffected.</p>
        <button type="button" className="enq-button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (read.status !== "ready") {
    return <ActivityStatus className="enq-sheet__activity">Working out suggestions from the venue's record…</ActivityStatus>;
  }
  const { advice } = read;
  const looked = `Looked at ${advice.checked.toLocaleString("en-GB")} room, date and time combinations from ${dayWords(advice.from)} to ${dayWords(advice.through)}: the current rate suits ${advice.rateHolds.toLocaleString("en-GB")}, and the record is too thin to judge ${advice.tooLittleHistory.toLocaleString("en-GB")}.`;
  return (
    <>
      <p className="pdk-basis">{basisWords(advice)}</p>
      <p className="pdk-basis pdk-basis--quiet">
        {looked}
        {advice.dismissed > 0 ? ` ${advice.dismissed.toLocaleString("en-GB")} dismissed.` : ""}
        {advice.total > advice.items.length ? ` The first ${advice.items.length.toLocaleString("en-GB")} of ${advice.total.toLocaleString("en-GB")} are listed.` : ""}
      </p>
      {advice.items.length === 0 ? (
        <div className="enq-empty">
          <h2>No change suggested</h2>
          <p>Nothing in the venue's record points to a different rate for the dates ahead.</p>
        </div>
      ) : groupAdvice(advice.items).map((group, index) => (
        <section key={group.key} aria-labelledby={`${headingId}-${String(index)}`}>
          <h2 className="enq-group" id={`${headingId}-${String(index)}`}>
            {group.heading}
            <span className="enq-group__count"><span className="vv-sr-only">, </span>{group.items.length.toLocaleString("en-GB")}</span>
          </h2>
          <ul className="enq-rows">
            {group.items.map((item) => {
              const tile = dateTile(item.date);
              const range = rangeWords(item);
              const now = `Now ${moneyWords(item.currentMinor, item.currency)}`;
              return (
                <li key={item.key}>
                  <button type="button" className="enq-row pdk-row" data-row-key={`advice:${item.key}`}
                    aria-current={openKey === item.key ? "true" : undefined}
                    aria-label={`${dayWords(item.date)}, ${item.ruleName}. ${adviceKindWords(item)}${range === null ? "" : `, ${range}`}. ${now}.`}
                    onClick={() => { onOpen(item); }}>
                    {tile === null ? <span className="enq-date" aria-hidden="true" /> : (
                      <span className="enq-date" aria-hidden="true">
                        <span className="enq-date__weekday">{tile.weekday}</span>
                        <span className="enq-date__day">{tile.day}</span>
                        <span className="enq-date__month">{tile.month}</span>
                      </span>
                    )}
                    <span className="enq-row__main" aria-hidden="true">
                      <span className="enq-row__title">{item.ruleName}</span>
                      <span className="enq-row__meta">{now}{range === null ? "" : ` · suggested ${range}`}</span>
                    </span>
                    <span className="enq-row__side" aria-hidden="true">
                      <span className="enq-chip pdk-chip" data-kind={item.kind}>{adviceKindWords(item)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
