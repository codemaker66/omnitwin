import { useId, useState, type ReactElement, type ReactNode } from "react";
import type { PublicProposal } from "../../api/proposals.js";
import { ProposalLayoutVisual } from "./ProposalLayoutVisual.js";
import {
  documentFacts, documentMoney, preparedLine, printedDecision, roomPhotograph, standingSentence,
} from "./proposal-document-format.js";
import "./ProposalDocument.css";

// ---------------------------------------------------------------------------
// The proposal as its client reads it (roadmap X1): an ivory document with
// the event's facts, where it stands, the room, the venue's message, the
// layout, the quote with its total on the copper plane, and, last, the
// conversation and the decision. The client's page and the venue team's
// preview both render this, so the preview is the page.
//
// CLIENT-SAFE by construction: it renders only the public proposal shape.
// Numbers and layout are planning estimates the events team confirms, said
// once at the foot (Blake, 29 September 2026); the price is the price.
// ---------------------------------------------------------------------------

export interface ProposalDocumentProps {
  readonly proposal: PublicProposal;
  /** Above the document: the venue team's preview says what it is. */
  readonly band?: ReactNode;
  readonly conversation?: ReactNode;
  readonly decision?: ReactNode;
  /** Where the proposal stands belongs to the version the client was sent;
   *  a preview of a version not yet sent leaves it to the band. */
  readonly showStanding?: boolean;
}

function RoomPhotograph({ proposal }: { readonly proposal: PublicProposal }): ReactElement | null {
  const [failed, setFailed] = useState(false);
  const photo = roomPhotograph(proposal.venueSlug, proposal.facts.roomSlug);
  if (photo === null || failed || proposal.facts.roomName === null) return null;
  return (
    <figure className="pd-photo">
      <img
        src={photo.src}
        {...(photo.srcSet === undefined ? {} : { srcSet: photo.srcSet, sizes: "(max-width: 800px) 100vw, 760px" })}
        alt={`The ${proposal.facts.roomName}`}
        loading="lazy"
        decoding="async"
        onError={() => { setFailed(true); }}
      />
      <figcaption>The {proposal.facts.roomName}</figcaption>
    </figure>
  );
}

export function ProposalDocument({ proposal, band, conversation, decision, showStanding = true }: ProposalDocumentProps): ReactElement {
  const titleId = useId();
  const quoteId = useId();
  const layoutId = useId();
  const facts = documentFacts(proposal.facts);
  const standing = showStanding ? standingSentence(proposal) : null;
  const currency = proposal.quote?.currency ?? "GBP";
  const included = proposal.packageSummary ?? [];
  const venueLine = [proposal.venueName, proposal.venueAddress]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "").join(", ");

  return (
    <div className="pd-page" data-register="ivory">
      {band}
      <article className="pd-sheet" aria-labelledby={titleId}>
        <header className="pd-head">
          {proposal.venueName !== null && <p className="pd-venue">{proposal.venueName}</p>}
          <h1 id={titleId} className="pd-title">{proposal.title}</h1>
          <p className="pd-prepared">{preparedLine(proposal.version, proposal.preparedAt)}</p>
        </header>

        {facts.length > 0 && (
          <dl className="pd-facts" data-testid="proposal-facts">
            {facts.map((fact) => (
              <div key={fact.label} data-fact={fact.label.toLowerCase()}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {standing !== null && (
          <p className="pd-standing" data-status={proposal.status} data-testid="proposal-standing">{standing}</p>
        )}

        <RoomPhotograph proposal={proposal} />

        {proposal.clientMessage !== null && proposal.clientMessage.trim() !== "" && (
          <p className="pd-message">{proposal.clientMessage}</p>
        )}

        {proposal.layoutSnapshot !== null && proposal.layoutSnapshot !== undefined && (
          <section className="pd-section" aria-labelledby={layoutId}>
            <h2 id={layoutId}>The layout</h2>
            <ProposalLayoutVisual snapshot={proposal.layoutSnapshot} tone="ivory" />
            <p className="pd-aside">Seen from above, to scale.</p>
          </section>
        )}

        {proposal.quote !== null && (
          <section className="pd-section pd-quote" aria-labelledby={quoteId}>
            <h2 id={quoteId}>The quote</h2>
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="pd-num">Qty</th>
                  <th scope="col" className="pd-num">Each</th>
                  <th scope="col" className="pd-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {proposal.quote.lineItems.map((item, index) => (
                  <tr key={index}>
                    <td>{item.description}</td>
                    <td className="pd-num">{item.quantity.toLocaleString("en-GB")}</td>
                    <td className="pd-num">{documentMoney(item.unitAmountMinor, currency)}</td>
                    <td className="pd-num">{documentMoney(item.lineTotalMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pd-total ws-plane" data-testid="proposal-total">
              <span>Total</span>
              <strong>{documentMoney(proposal.quote.totalMinor, currency)}</strong>
            </div>
          </section>
        )}

        {(proposal.roomSummary ?? null) !== null && (
          <section className="pd-section" aria-label="The room">
            <h2>The room</h2>
            <p>{proposal.roomSummary}</p>
          </section>
        )}
        {(proposal.layoutSummary ?? null) !== null && (
          <section className="pd-section" aria-label="How it is laid out">
            <h2>How it is laid out</h2>
            <p>{proposal.layoutSummary}</p>
          </section>
        )}
        {included.length > 0 && (
          <section className="pd-section" aria-label="Included">
            <h2>Included</h2>
            <ul className="pd-included">{included.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </section>
        )}
        {proposal.capacityNote !== null && proposal.capacityNote.trim() !== "" && (
          <section className="pd-section" aria-label="Capacity">
            <h2>Capacity</h2>
            <p>{proposal.capacityNote}</p>
          </section>
        )}

        {conversation}
        {decision}
        {showStanding && <p className="pd-printed-decision">{printedDecision(proposal)}</p>}

        <footer className="pd-foot">
          <p>Numbers and layout are planning estimates; the events team confirms them. Nothing here is a safety, occupancy or compliance determination.</p>
          {venueLine !== "" && <p className="pd-foot__venue">{venueLine}</p>}
        </footer>
      </article>
    </div>
  );
}
