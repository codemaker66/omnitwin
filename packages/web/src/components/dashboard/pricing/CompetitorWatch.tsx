import type { ReactElement } from "react";
import type { CompetitorWatch } from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import type { WatchBusy } from "./CompetitorPanels.js";
import {
  ATTENTION_WORDS,
  FRESHNESS_WORDS,
  attentionOf,
  figureWords,
  groupCompetitors,
  latestFigure,
  reviewWords,
  seenWords,
  watchSummary,
} from "./competitor-watch-format.js";
import { dateTile } from "./pricing-desk-format.js";

// ---------------------------------------------------------------------------
// The competitor watch on the Pricing desk's ivory sheet: the set, primary
// then secondary, each venue with the newest figure it has published (dated,
// with its basis), and what needs a person: a changed page, a review due.
// In the set's own order, never by price.
// ---------------------------------------------------------------------------

export type WatchRead =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly watch: CompetitorWatch; readonly refreshing: boolean };

export function CompetitorLedger({ read, titleId, openId, busy, onRetry, onOpen, onStart, onAdd, onCheckPages }: {
  readonly read: WatchRead;
  readonly titleId: string;
  readonly openId: string | null;
  readonly busy: WatchBusy | null;
  readonly onRetry: () => void;
  readonly onOpen: (competitorId: string) => void;
  readonly onStart: () => void;
  readonly onAdd: () => void;
  readonly onCheckPages: () => void;
}): ReactElement {
  if (read.status === "error") {
    return (
      <div className="enq-notice enq-notice--alert" role="alert">
        <p>The competitor watch could not be read. The price list is unaffected.</p>
        <button type="button" className="enq-button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (read.status !== "ready") {
    return <ActivityStatus className="enq-sheet__activity">Reading the competitor watch…</ActivityStatus>;
  }
  const { watch } = read;
  const allowed = watch.competitors.some((competitor) => competitor.pageCheck.allowedAt !== null);

  if (watch.competitors.length === 0) {
    return (
      <div className="enq-empty">
        <h2>No venues in the set yet</h2>
        <p>The set is the handful of venues your clients weigh you against, each with the reason it is there. Their own published prices are recorded here, dated, as context beside yours.</p>
        <div className="enq-actions cw-empty__actions">
          {watch.suggestedSetOffered && (
            <button type="button" className="enq-button cw-sheet-cta" disabled={busy !== null} aria-busy={busy === "start"} onClick={onStart}>
              {busy === "start" && <ActivityIndicator size={18} />}
              {busy === "start" ? "Adding the suggested set…" : "Start from the suggested set"}
            </button>
          )}
          <button type="button" className="enq-button" disabled={busy !== null} onClick={onAdd}>Add a venue</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cw-bar">
        <p className="pdk-basis pdk-basis--quiet">{watchSummary(watch.competitors)} Context only: no figure here sets or suggests a price.</p>
        <div className="cw-bar__actions">
          {allowed && (
            <button type="button" className="enq-button" disabled={busy !== null} aria-busy={busy === "check"} onClick={onCheckPages}>
              {busy === "check" && <ActivityIndicator size={18} />}
              {busy === "check" ? "Checking the pages…" : "Check the pages now"}
            </button>
          )}
          {watch.competitors.length < watch.limit && (
            <button type="button" className="enq-button" disabled={busy !== null} onClick={onAdd}>Add a venue</button>
          )}
        </div>
      </div>
      {groupCompetitors(watch.competitors).map((group) => (
        <section key={group.key} aria-labelledby={`${titleId}-set-${group.key}`}>
          <h2 className="enq-group" id={`${titleId}-set-${group.key}`}>
            {group.heading}
            <span className="enq-group__count"><span className="vv-sr-only">, </span>{group.competitors.length.toLocaleString("en-GB")}</span>
          </h2>
          <ul className="enq-rows">
            {group.competitors.map((competitor) => {
              const latest = latestFigure(competitor);
              const tile = latest === null ? null : dateTile(latest.seenOn);
              const attention = attentionOf(competitor);
              const figure = latest === null ? "No figure recorded yet" : `${figureWords(latest)}, ${latest.packageName}`;
              const seen = latest === null ? null : `${seenWords(latest.seenOn, latest.capturedByName)} · ${FRESHNESS_WORDS[latest.freshness]}`;
              const label = [
                competitor.name, figure, seen, reviewWords(competitor), ...attention.map((entry) => ATTENTION_WORDS[entry]),
              ].filter((part): part is string => part !== null).join(". ");
              return (
                <li key={competitor.id}>
                  <button type="button" className="enq-row pdk-row cw-row" data-row-key={`competitor:${competitor.id}`}
                    aria-current={openId === competitor.id ? "true" : undefined} aria-label={`${label}.`}
                    onClick={() => { onOpen(competitor.id); }}>
                    {tile === null ? (
                      <span className="enq-date cw-date--none" aria-hidden="true"><span className="enq-date__month">No figure</span></span>
                    ) : (
                      <span className="enq-date" aria-hidden="true">
                        <span className="enq-date__weekday">Seen</span>
                        <span className="enq-date__day">{tile.day}</span>
                        <span className="enq-date__month">{tile.month}</span>
                      </span>
                    )}
                    <span className="enq-row__main" aria-hidden="true">
                      <span className="enq-row__title">{competitor.name}</span>
                      <span className="enq-row__meta">{competitor.reason}</span>
                      <span className="pdk-row__change">{seen ?? "No figure recorded yet"} · {reviewWords(competitor)}</span>
                    </span>
                    <span className="enq-row__side" aria-hidden="true">
                      <span className="cw-figure">{latest === null ? "" : figureWords(latest)}</span>
                      {attention.map((entry) => (
                        <span key={entry} className="enq-chip pdk-chip cw-chip" data-attention={entry}>{ATTENTION_WORDS[entry]}</span>
                      ))}
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
