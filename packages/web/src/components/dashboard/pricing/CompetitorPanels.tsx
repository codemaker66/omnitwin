import { useEffect, useId, useState, type ReactElement, type RefObject } from "react";
import {
  CAPTURE_INCLUDES,
  SUGGESTED_COMPETITOR_SET,
  captureSourceRefusal,
  pricePageRefusal,
  reviewDueFrom,
  websiteRefusal,
  type CaptureCreateInput,
  type CaptureInclude,
  type CaptureSourceKind,
  type Competitor,
  type CompetitorCapture,
  type CompetitorCreate,
  type CompetitorTier,
  type CompetitorWatch,
  type PriceBasis,
  type VatStatement,
} from "@omnitwin/types";
import { getEvidenceLinks } from "../../../api/competitor-watch.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { PanelFrame } from "./PricingPanels.js";
import {
  ATTENTION_WORDS,
  FRESHNESS_HINTS,
  FRESHNESS_WORDS,
  INCLUDE_WORDS,
  VAT_WORDS,
  attentionOf,
  figureWords,
  includesWords,
  pageCheckWords,
  poundsTyped,
  reviewWords,
  seenWords,
  sourceWords,
  splitCaptures,
  tierWords,
  watchSummary,
  yearWords,
} from "./competitor-watch-format.js";
import { dateWords, momentWords } from "./pricing-desk-format.js";

// ---------------------------------------------------------------------------
// The competitor watch's faces in the forest panel: the watch at rest, one
// venue in the set (why it is there, its dated figures, the page check, the
// deals lost to it), and the two forms. Every action says what it does
// before it does it; every refusal says what to do instead.
// ---------------------------------------------------------------------------

export type WatchBusy = "start" | "add" | "change" | "review" | "remove" | "allow" | "stop" | "dismiss" | "capture" | "gone" | "check";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const EVIDENCE_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

function capitalised(words: string): string {
  return words.replace(/^the /u, "").replace(/^./u, (first) => first.toUpperCase());
}

// ---------------------------------------------------------------------------
// At rest
// ---------------------------------------------------------------------------

export function WatchOverview({ watch, busy, onStart, onAdd, onCheckPages }: {
  readonly watch: CompetitorWatch;
  readonly busy: WatchBusy | null;
  readonly onStart: () => void;
  readonly onAdd: () => void;
  readonly onCheckPages: () => void;
}): ReactElement {
  const allowed = watch.competitors.filter((competitor) => competitor.pageCheck.allowedAt !== null).length;
  return (
    <aside className="enq-panel pr-panel" data-register="forest" aria-label="The competitor watch">
      <div className="enq-panel__body enq-overview">
        <h2>The competitor watch</h2>
        <p>Other venues' own published prices, each dated and sourced, kept beside yours. Context only: nothing here sets or suggests a price.</p>
        {watch.suggestedSetOffered ? (
          <>
            <div className="enq-actions">
              <button type="button" className="enq-cta" disabled={busy !== null} aria-busy={busy === "start"} onClick={onStart}>
                {busy === "start" && <ActivityIndicator size={18} />}
                {busy === "start" ? "Adding the suggested set…" : "Start from the suggested set"}
              </button>
            </div>
            <p className="enq-next__hint">Adds these ten, each with the reason it is in the set. Page checks stay off until you allow each one. You can change or remove any of them.</p>
            <ul className="cw-suggested">
              {SUGGESTED_COMPETITOR_SET.map((entry) => <li key={entry.name}>{entry.name}<span>{tierWords(entry.tier)}</span></li>)}
            </ul>
          </>
        ) : (
          <>
            <p>{watchSummary(watch.competitors)}</p>
            <div className="enq-actions">
              {allowed > 0 && (
                <button type="button" className="enq-cta" disabled={busy !== null} aria-busy={busy === "check"} onClick={onCheckPages}>
                  {busy === "check" && <ActivityIndicator size={18} />}
                  {busy === "check" ? "Checking the pages…" : "Check the pages now"}
                </button>
              )}
              {watch.competitors.length < watch.limit && (
                <button type="button" className={allowed > 0 ? "enq-quiet" : "enq-cta"} disabled={busy !== null} onClick={onAdd}>Add a venue</button>
              )}
            </div>
            <p className="enq-next__hint">
              {allowed > 0
                ? `Reads only the ${allowed === 1 ? "page" : `${String(allowed)} pages`} whose check is allowed, at most once a week each, and says which have changed.`
                : "Choose a venue to record a figure, or to allow its weekly page check."}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// One venue in the set
// ---------------------------------------------------------------------------

export function CompetitorPanel(props: {
  readonly competitor: Competitor;
  readonly today: string;
  readonly timeZone: string;
  readonly busy: WatchBusy | null;
  readonly error: string | null;
  readonly layout: "wide" | "single";
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onClose: () => void;
  readonly onRecord: (replaces: CompetitorCapture | null) => void;
  readonly onChange: () => void;
  readonly onReviewed: () => void;
  readonly onRemove: () => void;
  readonly onAllowCheck: () => void;
  readonly onStopCheck: () => void;
  readonly onDismissChange: () => void;
  readonly onSourceGone: (capture: CompetitorCapture) => void;
}): ReactElement {
  const { competitor, busy, timeZone } = props;
  const [removing, setRemoving] = useState(false);
  const whyId = useId();
  const attention = attentionOf(competitor);
  const latest = splitCaptures(competitor.captures).standing[0] ?? null;
  return (
    <PanelFrame label={`Competitor: ${competitor.name}`} layout={props.layout} onClose={props.onClose}>
      <p className="enq-eyebrow">{tierWords(competitor.tier)} · in the set since {momentWords(competitor.addedAt, timeZone).split(",")[0] ?? ""}</p>
      <h2 className="enq-panel__name" ref={props.headingRef} tabIndex={-1}>{competitor.name}</h2>
      {attention.length > 0 && (
        <div className="enq-panel__status">
          {attention.map((entry) => <span key={entry} className="enq-chip pr-chip cw-chip" data-attention={entry}>{ATTENTION_WORDS[entry]}</span>)}
        </div>
      )}

      <section className="enq-section" aria-labelledby={whyId}>
        <h3 id={whyId}>Why it is in the set</h3>
        <p className="cw-reason">{competitor.reason}</p>
        <dl className="cw-facts">
          <div>
            <dt>Website</dt>
            <dd>{competitor.website === null ? "Not recorded" : <a className="cw-link" href={competitor.website} target="_blank" rel="noopener noreferrer">{competitor.website}<span className="vv-sr-only"> (opens in a new tab)</span></a>}</dd>
          </div>
          <div>
            <dt>Page with their prices</dt>
            <dd>{competitor.pricePageUrl === null ? "Not recorded" : <a className="cw-link" href={competitor.pricePageUrl} target="_blank" rel="noopener noreferrer">{competitor.pricePageUrl}<span className="vv-sr-only"> (opens in a new tab)</span></a>}</dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>{reviewWords(competitor)}{competitor.reviewedAt !== null ? `; last reviewed by ${competitor.reviewedByName ?? "someone no longer on the team"}, ${momentWords(competitor.reviewedAt, timeZone)}` : ""}</dd>
          </div>
        </dl>
      </section>

      {props.error !== null && <p className="enq-confirm__error" role="alert">{props.error}</p>}

      {!removing ? (
        <>
          <div className="enq-actions pr-panel__actions">
            <button type="button" className="enq-cta" disabled={busy !== null} onClick={() => { props.onRecord(null); }}>Record a figure</button>
            <button type="button" className="enq-quiet" disabled={busy !== null} onClick={props.onChange}>Change</button>
            <button type="button" className="enq-quiet" disabled={busy !== null} aria-busy={busy === "review"} onClick={props.onReviewed}>
              {busy === "review" && <ActivityIndicator size={16} />}
              {busy === "review" ? "Saving…" : "Mark reviewed"}
            </button>
            <button type="button" className="enq-quiet" disabled={busy !== null} onClick={() => { setRemoving(true); }}>Remove…</button>
          </div>
          <p className="enq-next__hint">Marking it reviewed sets the next review for {dateWords(reviewDueFrom(props.today))}.</p>
        </>
      ) : (
        <div className="enq-confirm" data-tone="declined">
          <p className="enq-confirm__question">Remove {competitor.name} from the set?</p>
          <p className="enq-confirm__consequence">It leaves the set and the market context. Its figures and the deals lost to it are kept, under its name.</p>
          <div className="enq-actions">
            <button type="button" className="enq-cta" disabled={busy !== null} aria-busy={busy === "remove"} onClick={props.onRemove}>
              {busy === "remove" && <ActivityIndicator size={18} />}
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
            <button type="button" className="enq-quiet" disabled={busy !== null} onClick={() => { setRemoving(false); }}>Keep it</button>
          </div>
        </div>
      )}

      <FiguresSection competitor={competitor} busy={busy} onRecord={props.onRecord} onSourceGone={props.onSourceGone} />
      <PageCheckSection competitor={competitor} timeZone={timeZone} busy={busy}
        onAllow={props.onAllowCheck} onStop={props.onStopCheck} onDismiss={props.onDismissChange}
        onRecord={() => { props.onRecord(latest); }} />
      <LossesSection competitor={competitor} timeZone={timeZone} />
    </PanelFrame>
  );
}

/** The kept screenshots' links, read once a venue with any is opened. */
function useEvidenceLinks(competitor: Competitor): ReadonlyMap<string, string | null> | "unavailable" | null {
  const wanted = competitor.captures.some((capture) => capture.evidenceFileId !== null);
  const [links, setLinks] = useState<ReadonlyMap<string, string | null> | "unavailable" | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    getEvidenceLinks(competitor.id, controller.signal)
      .then((found) => { setLinks(found); })
      .catch(() => { if (!controller.signal.aborted) setLinks("unavailable"); });
    return () => { controller.abort(); };
  }, [competitor.id, wanted]);
  return links;
}

function EvidenceLine({ capture, links }: { readonly capture: CompetitorCapture; readonly links: ReadonlyMap<string, string | null> | "unavailable" | null }): ReactElement | null {
  if (capture.evidenceFileId === null) return null;
  const url = links === null || links === "unavailable" ? null : links.get(capture.evidenceFileId) ?? null;
  if (url !== null) {
    return (
      <p className="cw-capture__source">
        <a className="cw-link" href={url} target="_blank" rel="noopener noreferrer">Open the screenshot<span className="vv-sr-only"> for {capture.packageName} (opens in a new tab)</span></a>
      </p>
    );
  }
  return <p className="cw-capture__hint">{links === null ? "A screenshot is kept with it." : "A screenshot is kept with it; it cannot be opened from here."}</p>;
}

function CaptureItem({ capture, busy, replaced, links, onRecord, onSourceGone }: {
  readonly capture: CompetitorCapture;
  readonly busy: WatchBusy | null;
  readonly replaced: boolean;
  readonly links: ReadonlyMap<string, string | null> | "unavailable" | null;
  readonly onRecord?: () => void;
  readonly onSourceGone?: () => void;
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="cw-capture">
      <div className="cw-capture__head">
        <span className="cw-capture__name">{capture.packageName}</span>
        <span className="enq-chip pr-chip cw-chip" data-freshness={replaced ? "replaced" : capture.freshness}>{replaced ? "Replaced" : FRESHNESS_WORDS[capture.freshness]}</span>
      </div>
      <p className="cw-capture__figure">{figureWords(capture)}</p>
      <p className="cw-capture__terms">{yearWords(capture.priceYear)} · {VAT_WORDS[capture.vat]} · {includesWords(capture.includes, capture.includesNote)}</p>
      <p className="cw-capture__source">
        {seenWords(capture.seenOn, capture.capturedByName)} · {sourceWords(capture.sourceKind, capture.sourceUrl)} ·{" "}
        <a className="cw-link" href={capture.sourceUrl} target="_blank" rel="noopener noreferrer">Open the source<span className="vv-sr-only"> for {capture.packageName} (opens in a new tab)</span></a>
      </p>
      <EvidenceLine capture={capture} links={links} />
      {capture.note !== null && <p className="cw-capture__note">{capture.note}</p>}
      {!replaced && <p className="cw-capture__hint">{FRESHNESS_HINTS[capture.freshness]}</p>}
      {capture.sourceGoneAt !== null && (
        <p className="cw-capture__hint">Marked gone by {capture.sourceGoneByName ?? "someone no longer on the team"}.</p>
      )}
      {!replaced && onRecord !== undefined && (
        confirming ? (
          <div className="enq-confirm cw-capture__confirm">
            <p className="enq-confirm__question">Mark its source gone?</p>
            <p className="enq-confirm__consequence">The figure stays on record, marked Source gone, and leaves the market context. It cannot be unmarked; a newer figure can be recorded at any time.</p>
            <div className="enq-actions">
              <button type="button" className="enq-cta" disabled={busy !== null} aria-busy={busy === "gone"} onClick={() => { onSourceGone?.(); }}>
                {busy === "gone" && <ActivityIndicator size={18} />}
                {busy === "gone" ? "Marking…" : "Mark gone"}
              </button>
              <button type="button" className="enq-quiet" disabled={busy !== null} onClick={() => { setConfirming(false); }}>Keep it</button>
            </div>
          </div>
        ) : (
          <div className="enq-actions cw-capture__actions">
            <button type="button" className="enq-quiet" disabled={busy !== null} onClick={onRecord}>Record a newer figure</button>
            {capture.sourceGoneAt === null && (
              <button type="button" className="enq-quiet" disabled={busy !== null} onClick={() => { setConfirming(true); }}>Source gone…</button>
            )}
          </div>
        )
      )}
    </li>
  );
}

function FiguresSection({ competitor, busy, onRecord, onSourceGone }: {
  readonly competitor: Competitor;
  readonly busy: WatchBusy | null;
  readonly onRecord: (replaces: CompetitorCapture | null) => void;
  readonly onSourceGone: (capture: CompetitorCapture) => void;
}): ReactElement {
  const headingId = useId();
  const { standing, replaced } = splitCaptures(competitor.captures);
  const links = useEvidenceLinks(competitor);
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Their figures</h3>
      {standing.length === 0 ? (
        <p className="pr-quiet">No figure recorded yet. Record one from their own page or brochure, with the date you saw it.</p>
      ) : (
        <ul className="cw-captures">
          {standing.map((capture) => (
            <CaptureItem key={capture.id} capture={capture} busy={busy} replaced={false} links={links}
              onRecord={() => { onRecord(capture); }} onSourceGone={() => { onSourceGone(capture); }} />
          ))}
        </ul>
      )}
      {replaced.length > 0 && (
        <details className="cw-replaced">
          <summary>Replaced figures, {replaced.length.toLocaleString("en-GB")}</summary>
          <ul className="cw-captures">
            {replaced.map((capture) => <CaptureItem key={capture.id} capture={capture} busy={busy} replaced links={links} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

function PageCheckSection({ competitor, timeZone, busy, onAllow, onStop, onDismiss, onRecord }: {
  readonly competitor: Competitor;
  readonly timeZone: string;
  readonly busy: WatchBusy | null;
  readonly onAllow: () => void;
  readonly onStop: () => void;
  readonly onDismiss: () => void;
  readonly onRecord: () => void;
}): ReactElement {
  const headingId = useId();
  const [termsRead, setTermsRead] = useState(false);
  const [robotsRead, setRobotsRead] = useState(false);
  const check = competitor.pageCheck;
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Weekly page check</h3>
      {competitor.pricePageUrl === null ? (
        <p className="pr-quiet">No page with their prices is recorded. Add it with Change: a page on their own website.</p>
      ) : check.allowedAt === null ? (
        <>
          <p className="pr-quiet">{pageCheckWords(check, timeZone)}</p>
          <fieldset className="cw-ticks">
            <legend>Before turning it on</legend>
            <label className="pr-check"><input type="checkbox" checked={termsRead} onChange={(event) => { setTermsRead(event.target.checked); }} />I have read the site's terms, and they allow an automated check</label>
            <label className="pr-check"><input type="checkbox" checked={robotsRead} onChange={(event) => { setRobotsRead(event.target.checked); }} />I have read its robots.txt, and it allows this page</label>
          </fieldset>
          <p className="enq-next__hint">At most once a week the check reads this one page, names itself as Venviewer's page check, obeys robots.txt and keeps no copy of the page: only enough to tell whether its words have changed, and the date. It never reads a price. Your name and the date are recorded.</p>
          <div className="enq-actions">
            <button type="button" className="enq-cta" disabled={busy !== null || !termsRead || !robotsRead} aria-busy={busy === "allow"} onClick={onAllow}>
              {busy === "allow" && <ActivityIndicator size={18} />}
              {busy === "allow" ? "Saving…" : "Allow the weekly check"}
            </button>
          </div>
        </>
      ) : (
        <>
          {check.changedAt !== null && (
            <div className="enq-confirm cw-changed">
              <p className="enq-confirm__question">Page changed: re-capture</p>
              <p className="enq-confirm__consequence">Found {momentWords(check.changedAt, timeZone)}. Its figures seen before then are due a check. Record what the page says now, or say it was no real change.</p>
              <div className="enq-actions">
                <button type="button" className="enq-cta" disabled={busy !== null} onClick={onRecord}>Record a newer figure</button>
                <button type="button" className="enq-quiet" disabled={busy !== null} aria-busy={busy === "dismiss"} onClick={onDismiss}>
                  {busy === "dismiss" && <ActivityIndicator size={16} />}
                  {busy === "dismiss" ? "Saving…" : "No real change"}
                </button>
              </div>
            </div>
          )}
          <p className="pr-quiet">{pageCheckWords(check, timeZone)}</p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" disabled={busy !== null} aria-busy={busy === "stop"} onClick={onStop}>
              {busy === "stop" && <ActivityIndicator size={16} />}
              {busy === "stop" ? "Stopping…" : "Stop the check"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LossesSection({ competitor, timeZone }: { readonly competitor: Competitor; readonly timeZone: string }): ReactElement {
  const headingId = useId();
  const { losses } = competitor;
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Deals lost to them</h3>
      {losses.count === 0 ? (
        <p className="pr-quiet">No deal has been marked lost to them in the last twelve months.</p>
      ) : (
        <>
          <p className="pr-quiet">{losses.count === 1 ? "1 deal" : `${losses.count.toLocaleString("en-GB")} deals`} marked lost to them in the last twelve months.</p>
          <ol className="enq-timeline">
            {losses.recent.map((loss) => (
              <li key={`${loss.at}-${loss.dealTitle}`}>
                <span className="enq-dot" aria-hidden="true" />
                <strong>{loss.dealTitle}</strong>
                {loss.reason !== null && <q className="pl-quote">{loss.reason}</q>}
                <span>{momentWords(loss.at, timeZone)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Adding or changing a venue
// ---------------------------------------------------------------------------

export interface CompetitorDraft {
  readonly name: string;
  readonly website: string;
  readonly pricePageUrl: string;
  readonly tier: CompetitorTier;
  readonly reason: string;
}

function draftOfCompetitor(competitor: Competitor | null): CompetitorDraft {
  return competitor === null
    ? { name: "", website: "", pricePageUrl: "", tier: "primary", reason: "" }
    : { name: competitor.name, website: competitor.website ?? "", pricePageUrl: competitor.pricePageUrl ?? "", tier: competitor.tier, reason: competitor.reason };
}

/** What stops a venue being saved, in the order the form reads. */
export function competitorDraftProblem(draft: CompetitorDraft): string | null {
  if (draft.name.trim() === "") return "Give the venue's name.";
  const website = draft.website.trim();
  if (website !== "") {
    const refused = websiteRefusal(website);
    if (refused !== null) return refused;
  }
  const page = draft.pricePageUrl.trim();
  if (page !== "") {
    const refused = pricePageRefusal(page, website === "" ? null : website);
    if (refused !== null) return refused;
  }
  if (draft.reason.trim() === "") return "Say why it is in the set: who it competes for, and how.";
  return null;
}

export function CompetitorForm({ competitor, today, saving, error, headingRef, onCancel, onSave }: {
  readonly competitor: Competitor | null;
  readonly today: string;
  readonly saving: boolean;
  readonly error: string | null;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onCancel: () => void;
  readonly onSave: (body: CompetitorCreate) => void;
}): ReactElement {
  const [draft, setDraft] = useState<CompetitorDraft>(() => draftOfCompetitor(competitor));
  const [tried, setTried] = useState(false);
  const problem = competitorDraftProblem(draft);
  const set = <K extends keyof CompetitorDraft>(key: K, value: CompetitorDraft[K]): void => { setDraft((now) => ({ ...now, [key]: value })); };
  const original = draftOfCompetitor(competitor);
  const addressChanged = competitor !== null && (draft.website.trim() !== original.website || draft.pricePageUrl.trim() !== original.pricePageUrl);
  const consequence = competitor === null
    ? `Adds ${draft.name.trim() === "" ? "the venue" : draft.name.trim()} to the set, to be reviewed again on ${dateWords(reviewDueFrom(today))}. Its page check stays off until you allow it.`
    : addressChanged && competitor.pageCheck.allowedAt !== null
      ? "Changing the website or the page turns the weekly check off until someone records again that it is allowed."
      : "Saves the change. Its figures and the deals lost to it stay with it.";

  const save = (): void => {
    setTried(true);
    if (problem !== null || saving) return;
    onSave({
      name: draft.name.trim(),
      website: draft.website.trim() === "" ? null : draft.website.trim(),
      pricePageUrl: draft.pricePageUrl.trim() === "" ? null : draft.pricePageUrl.trim(),
      tier: draft.tier,
      reason: draft.reason.trim(),
    });
  };

  return (
    <form className="pr-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
      <p className="enq-eyebrow">The competitor set</p>
      <h2 className="enq-panel__name" ref={headingRef} tabIndex={-1}>{competitor === null ? "Add a venue" : `Change ${competitor.name}`}</h2>
      <div className="pr-fields">
        <label className="pr-field pr-field--wide">
          <span>Name</span>
          <input value={draft.name} maxLength={160} disabled={saving} onChange={(event) => { set("name", event.target.value); }} />
        </label>
        <label className="pr-field pr-field--wide">
          <span>Their website</span>
          <input type="url" inputMode="url" value={draft.website} placeholder="https://" maxLength={2000} disabled={saving} onChange={(event) => { set("website", event.target.value); }} />
        </label>
        <label className="pr-field pr-field--wide">
          <span>The page with their prices, on that website (optional)</span>
          <input type="url" inputMode="url" value={draft.pricePageUrl} placeholder="https://" maxLength={2000} disabled={saving} onChange={(event) => { set("pricePageUrl", event.target.value); }} />
        </label>
        <fieldset className="pr-pair pr-field--wide">
          <legend>In the set as</legend>
          {(["primary", "secondary"] as const).map((tier) => (
            <label key={tier} className="pr-check">
              <input type="radio" name="cw-tier" checked={draft.tier === tier} disabled={saving} onChange={() => { set("tier", tier); }} />
              {tierWords(tier)}
            </label>
          ))}
        </fieldset>
        <label className="pr-field pr-field--wide">
          <span>Why it is in the set</span>
          <textarea className="cw-textarea" rows={3} value={draft.reason} maxLength={400} disabled={saving}
            aria-invalid={tried && draft.reason.trim() === "" ? "true" : undefined}
            onChange={(event) => { set("reason", event.target.value); }} />
        </label>
      </div>
      {tried && problem !== null && <p className="pr-problem" role="alert">{problem}</p>}
      {error !== null && <p className="enq-confirm__error" role="alert">{error}</p>}
      <p className="enq-confirm__consequence pr-consequence">{consequence}</p>
      <div className="enq-actions pr-form__actions">
        <button type="submit" className="enq-cta" disabled={saving} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Saving…" : competitor === null ? "Add to the set" : "Save the change"}
        </button>
        <button type="button" className="enq-quiet" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Recording a figure
// ---------------------------------------------------------------------------

export interface CaptureDraft {
  readonly sourceKind: CaptureSourceKind;
  readonly sourceUrl: string;
  readonly seenOn: string;
  readonly packageName: string;
  readonly price: string;
  readonly priceBasis: PriceBasis;
  readonly guests: string;
  readonly priceYear: string;
  readonly noYear: boolean;
  readonly includes: readonly CaptureInclude[];
  readonly includesNote: string;
  readonly vat: VatStatement | null;
  readonly note: string;
}

export function captureDraft(competitor: Pick<Competitor, "pricePageUrl">, replaces: CompetitorCapture | null, today: string): CaptureDraft {
  if (replaces !== null) {
    return {
      sourceKind: replaces.sourceKind, sourceUrl: replaces.sourceUrl, seenOn: today, packageName: replaces.packageName, price: "",
      priceBasis: replaces.priceBasis, guests: replaces.guests === null ? "" : String(replaces.guests),
      priceYear: replaces.priceYear === null ? "" : String(replaces.priceYear), noYear: replaces.priceYear === null,
      includes: replaces.includes, includesNote: replaces.includesNote ?? "", vat: replaces.vat, note: "",
    };
  }
  return {
    sourceKind: "own_page", sourceUrl: competitor.pricePageUrl ?? "", seenOn: today, packageName: "", price: "", priceBasis: "per_head",
    guests: "", priceYear: "", noYear: false, includes: [], includesNote: "", vat: null, note: "",
  };
}

/** The draft as the API takes it, or the first thing wrong with it. */
export function readCaptureDraft(draft: CaptureDraft, website: string | null, today: string): { readonly body: CaptureCreateInput } | { readonly problem: string } {
  const url = draft.sourceUrl.trim();
  if (url === "") return { problem: "Give the address of the page or brochure you saw it on." };
  const refused = captureSourceRefusal(url, draft.sourceKind, website);
  if (refused !== null) return { problem: refused };
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.seenOn)) return { problem: "Give the date you saw it." };
  if (draft.seenOn > today) return { problem: "The date seen cannot be after today." };
  if (draft.packageName.trim() === "") return { problem: "Give the package's name, as they write it." };
  const amountMinor = poundsTyped(draft.price);
  if (amountMinor === null) return { problem: "Give the price in pounds, such as 130 or 11,000." };
  const guests = draft.guests.trim() === "" ? null : Number(draft.guests.trim());
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 5000)) return { problem: "Give the guests as a whole number." };
  const year = draft.noYear ? null : Number(draft.priceYear.trim());
  if (year !== null && (draft.priceYear.trim() === "" || !Number.isInteger(year) || year < 2000 || year > 2100)) {
    return { problem: "Give the year the price is for, or tick that the page gives none." };
  }
  if (draft.vat === null) return { problem: "Say what the page says about VAT." };
  return {
    body: {
      sourceUrl: url, sourceKind: draft.sourceKind, seenOn: draft.seenOn, packageName: draft.packageName.trim(), amountMinor,
      currency: "GBP", priceBasis: draft.priceBasis, guests, priceYear: year, includes: [...draft.includes],
      includesNote: draft.includesNote.trim() === "" ? null : draft.includesNote.trim(), vat: draft.vat,
      evidenceFileId: null, note: draft.note.trim() === "" ? null : draft.note.trim(), supersedesId: null,
    },
  };
}

function evidenceProblem(file: File | null): string | null {
  if (file === null) return null;
  if (!EVIDENCE_TYPES.includes(file.type)) return "A screenshot must be a PNG, JPEG or WebP image, or a PDF.";
  const limit = file.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) return file.type === "application/pdf" ? "A PDF must be under 25 MB." : "An image must be under 10 MB.";
  return null;
}

export function CaptureForm({ competitor, replaces, today, saving, uploadPercent, error, headingRef, onCancel, onSave }: {
  readonly competitor: Competitor;
  readonly replaces: CompetitorCapture | null;
  readonly today: string;
  readonly saving: boolean;
  /** Measured upload progress while a screenshot goes up; null otherwise. */
  readonly uploadPercent: number | null;
  readonly error: string | null;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onCancel: () => void;
  readonly onSave: (body: CaptureCreateInput, evidence: File | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState<CaptureDraft>(() => captureDraft(competitor, replaces, today));
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const read = readCaptureDraft(draft, competitor.website, today);
  const fileProblem = evidenceProblem(file);
  const problem = "problem" in read ? read.problem : fileProblem;
  const set = <K extends keyof CaptureDraft>(key: K, value: CaptureDraft[K]): void => { setDraft((now) => ({ ...now, [key]: value })); };
  const toggleInclude = (entry: CaptureInclude): void => {
    setDraft((now) => ({ ...now, includes: now.includes.includes(entry) ? now.includes.filter((item) => item !== entry) : [...now.includes, entry] }));
  };

  const save = (): void => {
    setTried(true);
    if (saving || !("body" in read) || fileProblem !== null) return;
    onSave({ ...read.body, supersedesId: replaces?.id ?? null }, file);
  };

  const seen = /^\d{4}-\d{2}-\d{2}$/u.test(draft.seenOn) ? dateWords(draft.seenOn) : "on the date you give";
  return (
    <form className="pr-form" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
      <p className="enq-eyebrow">{competitor.name}</p>
      <h2 className="enq-panel__name" ref={headingRef} tabIndex={-1}>{replaces === null ? "Record a figure" : "Record a newer figure"}</h2>
      {replaces !== null && <p className="pr-quiet">For {replaces.packageName}, last seen {dateWords(replaces.seenOn)} at {figureWords(replaces)}.</p>}
      <div className="pr-fields">
        <fieldset className="pr-pair pr-field--wide">
          <legend>Where you saw it</legend>
          <label className="pr-check"><input type="radio" name="cw-kind" checked={draft.sourceKind === "own_page"} disabled={saving} onChange={() => { set("sourceKind", "own_page"); }} />Their own website</label>
          <label className="pr-check"><input type="radio" name="cw-kind" checked={draft.sourceKind === "brochure"} disabled={saving} onChange={() => { set("sourceKind", "brochure"); }} />Their brochure</label>
        </fieldset>
        <label className="pr-field pr-field--wide">
          <span>{draft.sourceKind === "own_page" ? "The page's address" : "The brochure's address"}</span>
          <input type="url" inputMode="url" value={draft.sourceUrl} placeholder="https://" maxLength={2000} disabled={saving} onChange={(event) => { set("sourceUrl", event.target.value); }} />
        </label>
        <label className="pr-field">
          <span>Seen on</span>
          <input type="date" value={draft.seenOn} max={today} disabled={saving} onChange={(event) => { set("seenOn", event.target.value); }} />
        </label>
        <label className="pr-field">
          <span>Package, as they name it</span>
          <input value={draft.packageName} maxLength={160} disabled={saving} onChange={(event) => { set("packageName", event.target.value); }} />
        </label>
        <label className="pr-field">
          <span>Price, £</span>
          <input inputMode="decimal" value={draft.price} disabled={saving} onChange={(event) => { set("price", event.target.value); }} />
        </label>
        <fieldset className="pr-pair">
          <legend>Charged</legend>
          <label className="pr-check"><input type="radio" name="cw-basis" checked={draft.priceBasis === "per_head"} disabled={saving} onChange={() => { set("priceBasis", "per_head"); }} />A head</label>
          <label className="pr-check"><input type="radio" name="cw-basis" checked={draft.priceBasis === "fixed"} disabled={saving} onChange={() => { set("priceBasis", "fixed"); }} />In total</label>
        </fieldset>
        <label className="pr-field">
          <span>{draft.priceBasis === "per_head" ? "At least how many guests (optional)" : "For how many guests (optional)"}</span>
          <input inputMode="numeric" value={draft.guests} disabled={saving} onChange={(event) => { set("guests", event.target.value); }} />
        </label>
        <div className="pr-field">
          <label className="cw-stack">
            <span>The year it is for</span>
            <input inputMode="numeric" value={draft.noYear ? "" : draft.priceYear} disabled={saving || draft.noYear}
              onChange={(event) => { set("priceYear", event.target.value); }} />
          </label>
          <label className="pr-check"><input type="checkbox" checked={draft.noYear} disabled={saving} onChange={(event) => { set("noYear", event.target.checked); }} />The page gives no year</label>
        </div>
        <fieldset className="pr-pair pr-field--wide cw-includes">
          <legend>What it includes</legend>
          {CAPTURE_INCLUDES.map((entry) => (
            <label key={entry} className="pr-check">
              <input type="checkbox" checked={draft.includes.includes(entry)} disabled={saving} onChange={() => { toggleInclude(entry); }} />
              {capitalised(INCLUDE_WORDS[entry])}
            </label>
          ))}
        </fieldset>
        <label className="pr-field pr-field--wide">
          <span>Anything else it includes (optional)</span>
          <input value={draft.includesNote} maxLength={400} disabled={saving} onChange={(event) => { set("includesNote", event.target.value); }} />
        </label>
        <fieldset className="pr-pair pr-field--wide">
          <legend>VAT, as the page says</legend>
          {(["included", "excluded", "not_stated"] as const).map((vat) => (
            <label key={vat} className="pr-check">
              <input type="radio" name="cw-vat" checked={draft.vat === vat} disabled={saving} onChange={() => { set("vat", vat); }} />
              {capitalised(VAT_WORDS[vat])}
            </label>
          ))}
        </fieldset>
        <label className="pr-field pr-field--wide">
          <span>A screenshot or the brochure (optional)</span>
          <input type="file" accept={EVIDENCE_TYPES.join(",")} disabled={saving} onChange={(event) => { setFile(event.target.files?.[0] ?? null); }} />
        </label>
        <label className="pr-field pr-field--wide">
          <span>Note (optional)</span>
          <input value={draft.note} maxLength={1000} disabled={saving} onChange={(event) => { set("note", event.target.value); }} />
        </label>
      </div>
      {tried && problem !== null && <p className="pr-problem" role="alert">{problem}</p>}
      {error !== null && <p className="enq-confirm__error" role="alert">{error}</p>}
      {uploadPercent !== null && <ActivityStatus progress={uploadPercent}>Storing the screenshot…</ActivityStatus>}
      <p className="enq-confirm__consequence pr-consequence">
        Saving adds this figure, seen {seen}, to {competitor.name}'s record under your name. It is never edited afterwards; a newer figure replaces it.
        {replaces !== null ? ` It replaces the figure seen ${dateWords(replaces.seenOn)}.` : ""}
      </p>
      <div className="enq-actions pr-form__actions">
        <button type="submit" className="enq-cta" disabled={saving} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Saving…" : "Save the figure"}
        </button>
        <button type="button" className="enq-quiet" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
