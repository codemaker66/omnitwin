import { useEffect, useId, useState, type ReactElement } from "react";
import { getMarketContext, type MarketContext } from "../../../api/competitor-watch.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { contextLineWords } from "./competitor-watch-format.js";
import { perWords } from "./pricing-desk-format.js";

// ---------------------------------------------------------------------------
// The market context card beside a pricing suggestion (the competitor watch,
// 17 October 2026). Closed until asked for. When open it lists the Current
// figures other venues publish for the suggestion's year, each with its
// basis, what it includes, its VAT, who saw it, when and where: in the set's
// order, never by price, never averaged, never offered to match. The
// suggestion's own figure is worked out without any of it (the API's
// pricing-advice.ts reads none of the watch, and a test holds it so).
// ---------------------------------------------------------------------------

type Read =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly context: MarketContext };

export function MarketContextCard({ venueId, date, per }: {
  readonly venueId: string;
  /** The suggestion's date, "YYYY-MM-DD": its year picks the figures. */
  readonly date: string;
  readonly per: "booking" | "hour" | "head";
}): ReactElement {
  const headingId = useId();
  const regionId = useId();
  const year = Number(date.slice(0, 4));
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Read>({ status: "idle" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!open || !Number.isInteger(year)) return;
    const controller = new AbortController();
    setRead((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    getMarketContext(venueId, year, controller.signal)
      .then((context) => { setRead({ status: "ready", context }); })
      .catch(() => { if (!controller.signal.aborted) setRead({ status: "error" }); });
    return () => { controller.abort(); };
  }, [open, venueId, year, reloads]);

  return (
    <section className="enq-section cw-context" aria-labelledby={headingId}>
      <h3 id={headingId} className="cw-context__heading">
        <button type="button" className="cw-disclosure" aria-expanded={open} aria-controls={regionId}
          onClick={() => { setOpen((now) => !now); }}>
          <span>Market context</span>
          <span className="cw-disclosure__aside">{open ? "Close" : `Other venues' figures for ${String(year)}`}</span>
        </button>
      </h3>
      <p className="cw-context__rule">Context only. Not used to set the suggestion.</p>
      {open && (
        <div id={regionId} className="cw-context__body">
          {read.status === "loading" && <ActivityStatus>Reading the dated figures…</ActivityStatus>}
          {read.status === "error" && (
            <div className="cw-context__retry">
              <p role="alert">The figures could not be read. The suggestion is unaffected.</p>
              <button type="button" className="enq-quiet" onClick={() => { setReloads((count) => count + 1); }}>Try again</button>
            </div>
          )}
          {read.status === "ready" && <ContextLines context={read.context} per={per} />}
        </div>
      )}
    </section>
  );
}

function ContextLines({ context, per }: { readonly context: MarketContext; readonly per: "booking" | "hour" | "head" }): ReactElement {
  const year = String(context.year);
  return (
    <>
      {context.lines.length === 0 ? (
        <p className="pr-quiet">No current figures for {year} from the venues in the set. Figures are recorded under Competitors, with the date each was seen.</p>
      ) : (
        <>
          <p className="pr-quiet">This rate is charged {perWords(per)}. Each figure below keeps its own basis; none is converted, averaged or ranked.</p>
          <ul className="cw-lines" aria-label={`Other venues' current figures for ${year}`}>
            {context.lines.map((line) => {
              const words = contextLineWords(line);
              return (
                <li key={line.captureId}>
                  <span className="cw-lines__title">{words.title}</span>
                  <span className="cw-lines__figure">{words.figure}</span>
                  <span className="cw-lines__terms">{words.terms}</span>
                  <span className="cw-lines__source">
                    {words.provenance}
                    {" · "}
                    <a href={line.sourceUrl} target="_blank" rel="noopener noreferrer" className="cw-link">
                      Open the source<span className="vv-sr-only"> for {line.competitorName}, {line.packageName} (opens in a new tab)</span>
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {(context.more > 0 || context.checkDue > 0) && (
        <p className="enq-next__hint">
          {context.more > 0 ? `${String(context.more)} more current ${context.more === 1 ? "figure is" : "figures are"} under Competitors. ` : ""}
          {context.checkDue > 0 ? `${String(context.checkDue)} due a check ${context.checkDue === 1 ? "is" : "are"} not shown.` : ""}
        </p>
      )}
    </>
  );
}
