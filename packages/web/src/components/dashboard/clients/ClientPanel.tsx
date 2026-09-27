import { useEffect, useId, useState, type ReactElement, type RefObject } from "react";
import { occasionLabel } from "@omnitwin/types";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { ApiError } from "../../../api/client.js";
import * as clientsApi from "../../../api/clients.js";
import type { ClientProfile, ContactProfile, LeadProfile } from "../../../api/clients.js";
import { ActivityStatus } from "../../shared/Activity.js";
import { eventDateParts, venueDate, venueMoment } from "../enquiries/enquiry-desk-format.js";
import {
  contactFacts, contactTimeline, dealStageWords, enquiryStateWords, proposalStatusWords,
  type ClientRef, type LifetimeFact,
} from "./clients-desk-format.js";

// ---------------------------------------------------------------------------
// One client, in the forest panel beside the search: who they are, how to
// reach them, their lifetime in a few facts, and everything of theirs the
// venue holds, each a step away. Reading only; every change is made where
// the record lives (the Enquiries desk, the pipeline, the proposal).
// ---------------------------------------------------------------------------

type Loaded =
  | { readonly kind: "user"; readonly data: ClientProfile }
  | { readonly kind: "lead"; readonly data: LeadProfile }
  | { readonly kind: "contact"; readonly data: ContactProfile };

type PanelState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly loaded: Loaded }
  | { readonly status: "missing" }
  | { readonly status: "error" };

export interface ClientPanelProps {
  readonly client: ClientRef;
  readonly layout: "wide" | "single";
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onClose: () => void;
  readonly onViewEnquiry: (enquiryId: string) => void;
  readonly onOpenDeal: (dealId: string) => void;
  readonly onOpenProposal: (proposalId: string) => void;
}

async function load(client: ClientRef): Promise<Loaded> {
  switch (client.kind) {
    case "user": return { kind: "user", data: await clientsApi.getClientProfile(client.id) };
    case "lead": return { kind: "lead", data: await clientsApi.getLeadProfile(client.id) };
    case "contact": return { kind: "contact", data: await clientsApi.getContactProfile(client.id) };
  }
}

export function ClientPanel(props: ClientPanelProps): ReactElement {
  const { client, layout, onClose } = props;
  const headingId = useId();
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    load(client)
      .then((loaded) => { if (current) setState({ status: "ready", loaded }); })
      .catch((error: unknown) => {
        if (!current) return;
        setState(error instanceof ApiError && error.status === 404 ? { status: "missing" } : { status: "error" });
      });
    return () => { current = false; };
  }, [client, attempt]);

  // One heading throughout, so the focus a reader was given as the client
  // opened stays on it while it loads, and reads its name once it has.
  const who = state.status === "ready" ? whoOf(state.loaded) : null;
  const heading = who !== null ? who.name
    : state.status === "missing" ? "Not found" : state.status === "error" ? "Could not open" : "Opening client";

  return (
    <section className="enq-panel cl-panel" data-register="forest" aria-labelledby={headingId} aria-busy={state.status === "loading"}>
      <div className="enq-panel__body">
        <div className="enq-panel__bar">
          {layout === "single" ? (
            <button type="button" className="enq-back" onClick={onClose}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to clients
            </button>
          ) : <span />}
          {layout === "wide" && (
            <button type="button" className="enq-close" onClick={onClose} aria-label="Close client" aria-keyshortcuts="Escape">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        {who !== null && <p className="enq-eyebrow">{who.eyebrow}</p>}
        <h2 className={state.status === "loading" ? "vv-sr-only" : "enq-panel__name"} id={headingId} ref={props.headingRef} tabIndex={-1}>
          {heading}
        </h2>
        {state.status === "loading" && <ActivityStatus variant="panel">Opening client…</ActivityStatus>}
        {state.status === "missing" && (
          <p className="enq-next__hint">This client is not on this venue's record, or has been removed.</p>
        )}
        {state.status === "error" && (
          <>
            <p className="enq-next__hint" role="alert">This client could not be read.</p>
            <div className="enq-actions">
              <button type="button" className="enq-quiet" onClick={() => { setAttempt((count) => count + 1); }}>Try again</button>
            </div>
          </>
        )}
        {state.status === "ready" && who !== null && <Profile {...props} loaded={state.loaded} who={who} />}
      </div>
    </section>
  );
}

interface Who {
  readonly eyebrow: string;
  readonly name: string;
  readonly organisation: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly since: string;
}

function whoOf(loaded: Loaded): Who {
  switch (loaded.kind) {
    case "user": return {
      eyebrow: "Client", name: loaded.data.user.displayName ?? loaded.data.user.name,
      organisation: loaded.data.user.organizationName, email: loaded.data.user.email, phone: loaded.data.user.phone,
      since: loaded.data.user.createdAt,
    };
    case "lead": return {
      eyebrow: "Guest", name: loaded.data.lead.name ?? loaded.data.lead.email,
      organisation: null, email: loaded.data.lead.email, phone: loaded.data.lead.phone, since: loaded.data.lead.createdAt,
    };
    case "contact": return {
      eyebrow: loaded.data.contact.roleLabel === null ? "Contact" : `Contact · ${loaded.data.contact.roleLabel}`,
      name: loaded.data.contact.name, organisation: loaded.data.contact.account?.name ?? null,
      email: loaded.data.contact.email, phone: loaded.data.contact.phone, since: loaded.data.contact.createdAt,
    };
  }
}

function Profile(props: ClientPanelProps & { readonly loaded: Loaded; readonly who: Who }): ReactElement {
  const { loaded, who } = props;
  const since = venueDate(who.since);
  const facts: LifetimeFact[] = loaded.kind === "contact" ? contactFacts(loaded.data)
    : loaded.kind === "user" ? [
      { value: loaded.data.enquiries.length.toLocaleString("en-GB"), label: loaded.data.enquiries.length === 1 ? "enquiry" : "enquiries" },
      { value: loaded.data.configurations.length.toLocaleString("en-GB"), label: loaded.data.configurations.length === 1 ? "layout" : "layouts" },
      { value: since ?? "Not recorded", label: "with the venue since", tone: since === null ? "muted" : "words" },
    ] : [
      { value: loaded.data.enquiries.length.toLocaleString("en-GB"), label: loaded.data.enquiries.length === 1 ? "enquiry" : "enquiries" },
      { value: since ?? "Not recorded", label: "first in touch", tone: since === null ? "muted" : "words" },
    ];

  return (
    <>
      {who.organisation !== null && <p className="cl-organisation">{who.organisation}</p>}
      <div className="enq-contact cl-reach">
        <a href={`mailto:${who.email}`}>{who.email}</a>
        {who.phone !== null && who.phone.trim() !== "" && <a href={`tel:${who.phone.replace(/[^\d+]/gu, "")}`}>{who.phone}</a>}
        {loaded.kind === "lead" && loaded.data.lead.convertedToUserId !== null
          && <span className="enq-contact__note">Now has a Venviewer account</span>}
      </div>

      <dl className="enq-facts cl-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd className={fact.tone === "muted" ? "enq-facts__muted" : fact.tone === "words" ? "enq-facts__room" : undefined}>{fact.value}</dd>
          </div>
        ))}
      </dl>

      {loaded.kind === "contact" && <ContactRecord {...props} data={loaded.data} />}
      {loaded.kind !== "contact" && (
        <EnquiryList enquiries={loaded.data.enquiries} onViewEnquiry={props.onViewEnquiry} />
      )}
      {loaded.kind === "user" && loaded.data.configurations.length > 0 && (
        <section className="enq-section">
          <h3>Layouts</h3>
          <ul className="cl-list">
            {loaded.data.configurations.map((layout) => (
              <li key={layout.id}>
                <a className="cl-item" href={`/plan/${layout.id}`} target="_blank" rel="noreferrer">
                  <span className="cl-item__title">{layout.name}</span>
                  <span className="cl-item__detail">
                    {layout.spaceName} · {layout.objectCount.toLocaleString("en-GB")} {layout.objectCount === 1 ? "piece" : "pieces"}
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" className="cl-item__go" />
                  <span className="vv-sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function EnquiryList({ enquiries, onViewEnquiry }: {
  readonly enquiries: readonly { id: string; state: string; eventType: string | null; preferredDate: string | null; spaceName: string; roomChosen?: boolean | undefined }[];
  readonly onViewEnquiry: (enquiryId: string) => void;
}): ReactElement {
  return (
    <section className="enq-section">
      <h3>Enquiries</h3>
      {enquiries.length === 0 ? <p className="enq-next__hint">No enquiries at this venue.</p> : (
        <ul className="cl-list">
          {enquiries.map((enquiry) => {
            const date = eventDateParts(enquiry.preferredDate);
            // The room a roomless enquiry is filed under is not the guest's choice.
            const room = enquiry.roomChosen === false ? "room not chosen" : enquiry.spaceName;
            return (
              <li key={enquiry.id}>
                <button type="button" className="cl-item" onClick={() => { onViewEnquiry(enquiry.id); }}>
                  <span className="cl-item__title">{occasionLabel(enquiry.eventType) ?? "Enquiry"}{date === null ? "" : `, ${date.full}`}</span>
                  <span className="cl-item__detail">{enquiryStateWords(enquiry.state)} · {room}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ContactRecord({ data, onOpenDeal, onOpenProposal, onViewEnquiry }: ClientPanelProps & { readonly data: ContactProfile }): ReactElement {
  const timeline = contactTimeline(data);
  return (
    <>
      <section className="enq-section">
        <h3>Deals</h3>
        {data.deals.length === 0 ? <p className="enq-next__hint">No deals yet.</p> : (
          <ul className="cl-list">
            {data.deals.map((deal) => {
              const date = eventDateParts(deal.preferredDate);
              return (
                <li key={deal.id}>
                  <button type="button" className="cl-item" onClick={() => { onOpenDeal(deal.id); }}>
                    <span className="cl-item__title">{deal.title}</span>
                    <span className="cl-item__detail">
                      {[dealStageWords(deal.stage), date?.full ?? null, deal.guestCount === null ? null : `${deal.guestCount.toLocaleString("en-GB")} guests`]
                        .filter((part): part is string => part !== null).join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {data.proposals.length > 0 && (
        <section className="enq-section">
          <h3>Proposals</h3>
          <ul className="cl-list">
            {data.proposals.map((proposal) => (
              <li key={proposal.id}>
                <button type="button" className="cl-item" onClick={() => { onOpenProposal(proposal.id); }}>
                  <span className="cl-item__title">{proposal.title}</span>
                  <span className="cl-item__detail">
                    {proposalStatusWords(proposal.status)} · version {proposal.currentVersion.toLocaleString("en-GB")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.contact.sourceEnquiryId !== null && (
        <section className="enq-section">
          <h3>Where they came from</h3>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" onClick={() => { if (data.contact.sourceEnquiryId !== null) onViewEnquiry(data.contact.sourceEnquiryId); }}>
              Open the enquiry they sent
            </button>
          </div>
        </section>
      )}
      <section className="enq-section">
        <h3>Timeline</h3>
        <ol className="enq-timeline">
          {timeline.map((moment) => (
            <li key={moment.key}>
              <span className="enq-dot" aria-hidden="true" />
              <strong>{moment.sentence}</strong>
              <time dateTime={moment.at}>{venueMoment(moment.at) ?? moment.at}</time>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
