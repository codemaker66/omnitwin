// ---------------------------------------------------------------------------
// LegalPage — the three public legal documents: privacy, terms, accessibility.
//
// NOT LEGAL ADVICE. These documents were drafted by the engineering team, not
// by a solicitor. They are honest, standard-shaped and grounded in what the
// code actually does — every factual claim here was read out of the enquiry
// schema, the public enquiry route, or the site's own markup — but they have
// NOT been reviewed by a qualified lawyer. The Trades House of Glasgow should
// have its own solicitor review this copy before, or very shortly after,
// public launch. Do not add a certification, an insurance position, a
// registration number, an ICO registration or a Data Protection Officer to
// this file unless someone has confirmed it exists.
//
// Copy rules that keep this file safe:
//   - No forward-looking placeholders ("will be updated", "before launch").
//     A legal page that promises a future legal page is worse than none.
//   - No conformance claim the site has not been audited against.
//   - Every processor named below is one actually in use.
// ---------------------------------------------------------------------------

import { useEffect, type ReactElement } from "react";
import { CONTRACT_CONSENT_STATEMENT, DIETARY_MEMORY_CONSENT, DIETARY_MEMORY_MONTHS_UNUSED, DIETARY_NOTE_RETENTION } from "@omnitwin/types";
import { REMEMBERED_NOTES_PATH } from "../lib/dietary-memory.js";
import { ROUTE_DOCUMENTS } from "../lib/route-documents.js";
import "./LegalPage.css";

interface LegalPageProps {
  readonly type: "accessibility" | "privacy" | "terms";
}

// ---------------------------------------------------------------------------
// Document model — content is data so the three documents share one renderer,
// one set of anchors, and one table-of-contents implementation.
// ---------------------------------------------------------------------------

interface LegalDefinition {
  readonly term: string;
  readonly detail: string;
}

interface LegalLink {
  readonly label: string;
  readonly text: string;
  readonly href: string;
  readonly external: boolean;
}

type LegalBlock =
  | { readonly kind: "p"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "defs"; readonly items: readonly LegalDefinition[] }
  | { readonly kind: "links"; readonly items: readonly LegalLink[] };

interface LegalSection {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

interface LegalDocument {
  readonly title: string;
  readonly standfirst: string;
  /** When this document last changed: each document carries its own, so a
   *  change to one does not re-date the others. */
  readonly updated: { readonly text: string; readonly iso: string };
  readonly sections: readonly LegalSection[];
}

// ---------------------------------------------------------------------------
// Venue facts. One source for the controller's identity across all three
// documents so a change of address or number cannot land in two of three.
// ---------------------------------------------------------------------------

const VENUE_NAME = "The Trades House of Glasgow";
const VENUE_ADDRESS = "85 Glassford Street, Glasgow, G1 1UH";
const VENUE_EMAIL = "info@tradeshallglasgow.co.uk";
const VENUE_PHONE = "+44 141 552 2418";
const VENUE_PHONE_HREF = "tel:+441415522418";

/** The date the terms and the accessibility statement were written. Shown on
 *  those pages, and the only place it is written down. */
const LAST_UPDATED = "15 August 2026";
const ORIGINAL_EDITION = { text: LAST_UPDATED, iso: "2026-08-15" } as const;

/** The privacy policy's own date: it changed when the dietary note gained its
 *  retention rule (fix-first item 18) and, the same day, the choice to have
 *  it remembered ("ask once, then remember"); on 26 October, when it said
 *  how long deleted data stays in the database's backups (T-068); and on 27
 *  October, when it named Stripe for deposits and said what a contract's
 *  signature record keeps (Plan 19 L5). */
const PRIVACY_UPDATED = { text: "27 October 2026", iso: "2026-10-27" } as const;

/** The allergy note's keeping period, from the one definition the API's
 *  retention pass and the planner also read. */
const NOTE_DAYS_AFTER_EVENT = DIETARY_NOTE_RETENTION.daysAfterEvent;
const NOTE_MONTHS_WITHOUT_EVENT = Math.round(DIETARY_NOTE_RETENTION.daysWithoutEvent / 30.4);

/** The box beside the note, word for word as the planner shows it. Both
 *  paths are described; the lawful condition for health information is the
 *  venue's adviser's to confirm, so none is named for it here. */
const REMEMBER_QUESTION = DIETARY_MEMORY_CONSENT.question;

// T-616 / gate line 4 replaced every "Enquire" mailto on the public site with
// the composer, because a mailto leaves no row in `enquiries` and the events
// team cannot answer what it never received. This one stays, deliberately.
//
// It is not an Enquire. It is the data controller's contact, which UK GDPR
// Article 13(1)(a)–(b) requires these documents to publish so a data subject
// can exercise their rights — and an access, rectification or erasure request
// is not a venue enquiry: routing it into the booking queue would misfile a
// statutory request and start its one-month clock in the wrong place. The
// composer link beside it is the booking route, so a reader who came here
// wanting a date still reaches the form, without the two being confused.
const CONTACT_LINKS: readonly LegalLink[] = [
  { label: "Email", text: VENUE_EMAIL, href: `mailto:${VENUE_EMAIL}`, external: false },
  { label: "Phone", text: VENUE_PHONE, href: VENUE_PHONE_HREF, external: false },
  { label: "Asking about a date", text: "Send an enquiry", href: "/#enquire", external: false },
];

const POSTAL_ADDRESS_DEFS: readonly LegalDefinition[] = [
  { term: "By post", detail: `${VENUE_NAME}, ${VENUE_ADDRESS}.` },
];

// ---------------------------------------------------------------------------
// Privacy Policy
//
// Data categories are taken field-for-field from GuestEnquirySchema in
// @omnitwin/types (the schema the public POST /public/enquiries endpoint
// validates against), plus the records that route writes: the enquiry row, its
// status history, and the guest contact record.
// ---------------------------------------------------------------------------

const PRIVACY: LegalDocument = {
  title: "Privacy Policy",
  standfirst:
    "How the Trades House of Glasgow handles the personal information you send through this site, why we hold it, how long we keep it, and what you can ask us to do with it.",
  updated: PRIVACY_UPDATED,
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are",
      blocks: [
        {
          kind: "p",
          text: `${VENUE_NAME} is the data controller for the personal information collected through this site. That means the Trades House decides why your information is held and what happens to it, and is answerable for it under the UK General Data Protection Regulation and the Data Protection Act 2018.`,
        },
        {
          kind: "defs",
          items: [
            {
              term: "Data controller",
              detail: `${VENUE_NAME}, ${VENUE_ADDRESS}.`,
            },
            {
              term: "The platform",
              detail:
                "Venviewer is the venue planning platform that runs this site for the Trades House. Venviewer processes enquiry information on the venue's instructions, to operate the service, and for no other purpose.",
            },
            {
              term: "Data Protection Officer",
              detail:
                "No Data Protection Officer has been appointed. Data protection questions are handled by the venue's events team, using the contact details at the end of this policy.",
            },
          ],
        },
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect when you send an enquiry",
      blocks: [
        {
          kind: "p",
          text: "Everything below comes from the enquiry form on this site. Only your email address is required. Every other field is optional and is stored only if you choose to fill it in.",
        },
        {
          kind: "defs",
          items: [
            {
              term: "Email address (required)",
              detail:
                "How the events team replies to you. It is the only field you have to give us.",
            },
            {
              term: "Your name (optional)",
              detail: "So the team can address you properly rather than by email address.",
            },
            {
              term: "Phone number (optional)",
              detail:
                "Used only to reach you about your enquiry — for example if a date needs a quick conversation rather than a chain of emails.",
            },
            {
              term: "Event date (optional)",
              detail: "The date you are asking about, so the team can check availability.",
            },
            {
              term: "Event type (optional)",
              detail:
                "For example a wedding, a dinner, a conference. It tells the team which rooms and which arrangements are worth suggesting.",
            },
            {
              term: "Guest count (optional)",
              detail:
                "Your estimate of how many people you expect, so the team can tell you which rooms fit.",
            },
            {
              term: "Message (optional)",
              detail:
                "A free-text note, up to 2,000 characters, in your own words. Whatever you write here is stored and read by the events team.",
            },
            {
              term: "What you were looking at",
              detail:
                "The identifier of the saved layout you had open, or a note that the enquiry came from the venue's virtual walkthrough. This tells the team which room and which arrangement you are asking about.",
            },
            {
              term: "Enquiry record",
              detail:
                "The date and time you sent the enquiry, and the status the events team gives it as they work through it (received, under review, and so on), with a note of when each change happened.",
            },
          ],
        },
        {
          kind: "p",
          text: "If you send more than one enquiry, we keep a single contact record — your email address, plus your name and phone number if you gave them — so the team can see that they have spoken to you before and does not ask you the same questions twice.",
        },
        {
          kind: "p",
          text: "Please do not put health information, financial details, or other sensitive personal information into the message field. It is there for event details, and we do not need anything more than that to answer you. If your event has requirements you would rather discuss privately, say so in the message and the team will call you.",
        },
      ],
    },
    {
      id: "other-information",
      heading: "Other information we hold",
      blocks: [
        {
          kind: "defs",
          items: [
            {
              term: "Server and request logs",
              detail:
                "Our hosting providers record standard technical logs of requests to the site. These can include your network (IP) address, your browser's user-agent string, and which pages were requested. They are used to keep the service running, to diagnose faults, and to spot abuse.",
            },
            {
              term: "Error diagnostics",
              detail:
                "When something goes wrong in the browser or on the server, our error-monitoring service records technical details about the failure. That can include the page you were on and the technical state of the application at the time.",
            },
            {
              term: "Dietary and allergy notes for an event",
              detail:
                "When an event is planned with the venue, its layout can record how many guests need each kind of meal (vegetarian, vegan, gluten-free, nut-free, halal, kosher) and a short note about other allergies. The note is health information. It is read by the venue's events team and the staff preparing the room, and it is printed on the event sheets they work from. Please give allergens and numbers, not guests' names. The note is kept out of our server logs and error reports. "
                + `Beside the note, the person planning the event is asked "${REMEMBER_QUESTION}" The box starts unticked. Left unticked, the note stays with that event only. Ticked, we also keep a copy with that person's account, shown to them alone, and fill it in on their next layout with us; we record who ticked the box, when, and the words beside it. They can see and remove that copy at any time.`,
            },
            {
              term: "Your signature on a contract",
              detail:
                "Once you have accepted a proposal, the venue may ask you to sign its contract on your proposal link. You sign by typing your name and ticking the statement \"" + CONTRACT_CONSENT_STATEMENT + "\" "
                + "We keep a record of that signature: the name you typed; the email address of the client the venue addressed the proposal to, which the contract itself names; the date and time; a fingerprint (a SHA-256 hash) of the exact version of the contract you signed; the statement you agreed to, word for word; the description your browser gives of itself (its user-agent string); and which of the proposal's links you signed through, by its first characters. "
                + "We do not keep your network (IP) address with it. The record cannot be changed after you sign. If the contract changes, you are asked to sign the new version, and your earlier signature stays with the version you signed.",
            },
            {
              term: "Deposit payments",
              detail:
                "If the venue asks for a deposit, you pay it on Stripe's own payment page, not on ours. Your card or bank details go to Stripe and never reach us. From Stripe we keep the amount, Stripe's reference for the payment, and what Stripe reports: paid, still settling, declined (with Stripe's own words for why), refunded, or not the amount asked for. While the venue uses Stripe's test mode, no real money is taken.",
            },
            {
              term: "Venue staff accounts",
              detail:
                "People who work for the venue have accounts on the planning tools. For them we hold a name, an email address and a role. This part of the policy is about them, not about you as a visitor.",
            },
            {
              term: "Preferences kept in your browser",
              detail:
                "The site remembers small preferences on your own device — for example whether you chose the light or the dark theme. These stay in your browser's local storage and are not sent to us.",
            },
          ],
        },
      ],
    },
    {
      id: "why-we-use-it",
      heading: "Why we use it, and our lawful basis",
      blocks: [
        {
          kind: "p",
          text: `UK GDPR requires a lawful basis for every use of personal information. Ours are set out below. We do not rely on consent for any of them, so nothing here hides behind a consent box. The one thing on this site that waits for a tick is keeping an allergy note for your next event ("${REMEMBER_QUESTION}", described under "Dietary and allergy notes for an event"): it happens only if you ask for it.`,
        },
        {
          kind: "defs",
          items: [
            {
              term: "Answering your enquiry",
              detail:
                "Article 6(1)(b): steps taken at your request before entering into a contract. You asked us about hiring a room, so we use what you sent to answer you and to work out whether we can host your event. Where you are only asking a question and have no intention of hiring, we rely instead on Article 6(1)(f), our legitimate interest in answering people who ask us about the venue.",
            },
            {
              term: "Keeping a record of enquiries and contacts",
              detail:
                "Article 6(1)(f), legitimate interests: running an events business properly, giving consistent answers, and being able to show what was said and when. We have weighed this against your interests; the information involved is ordinary business contact information, and you can object at any time.",
            },
            {
              term: "Contracts, signatures and deposits",
              detail:
                "Article 6(1)(b): entering into and performing the contract for your event. Keeping the signature record and the payment records afterwards is Article 6(1)(c), the venue's legal obligation to keep accounting records, and Article 6(1)(f), our legitimate interest in being able to show what was agreed, by whom and when.",
            },
            {
              term: "Keeping the service secure and working",
              detail:
                "Article 6(1)(f), legitimate interests: protecting the site from abuse, spam and bulk harvesting, and diagnosing faults so that the service stays available.",
            },
            {
              term: "Venue staff accounts",
              detail:
                "Article 6(1)(b) where an account is part of someone's contract with the venue, and Article 6(1)(f) — our legitimate interest in controlling who can see enquiry records — otherwise.",
            },
          ],
        },
      ],
    },
    {
      id: "what-we-do-not-do",
      heading: "What we do not do",
      blocks: [
        {
          kind: "list",
          items: [
            "We do not sell, rent or trade personal information.",
            "We do not use your enquiry to add you to a marketing list, and this service sends no marketing email. If that ever changes we would ask for your consent first, and you could withdraw it at any time.",
            "We run no analytics product and set no advertising or tracking cookies. There are no advertising networks in this site.",
            "We make no decisions about you by automated means that produce legal effects or similarly significant effects, and we do not profile you.",
          ],
        },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies, browser storage and third-party requests",
      blocks: [
        {
          kind: "p",
          text: "There is no cookie consent banner on this site, because there is nothing here to consent to: we set no analytics cookies and no advertising cookies. Under the Privacy and Electronic Communications Regulations, consent is not required for storage that is strictly necessary to provide the service you asked for. What the site does use is listed below.",
        },
        {
          kind: "defs",
          items: [
            {
              term: "Authentication cookies",
              detail:
                "Our authentication provider sets strictly necessary cookies so that venue staff stay signed in to the planning tools. They exist to hold a session together, not to follow anybody around the web.",
            },
            {
              term: "Local storage preferences",
              detail:
                "Your light or dark theme choice, and similar view preferences, are stored by your browser on your own device. They are not transmitted to us and are not used to identify you.",
            },
            {
              term: "Web fonts",
              detail:
                "The typefaces used by this site are served by Google Fonts. Loading them means Google receives the network address of the device making the request. No advertising or analytics identifier is involved, but the request does leave our own servers, and we would rather say so than imply the page is entirely self-contained.",
            },
          ],
        },
      ],
    },
    {
      id: "who-else",
      heading: "Who else processes your information",
      blocks: [
        {
          kind: "p",
          text: "We use a small number of service providers to run the site. Each acts on our instructions under a contract, and none of them is permitted to use your information for its own purposes. These are the ones actually in use:",
        },
        {
          kind: "defs",
          items: [
            {
              term: "Neon",
              detail:
                "Hosted PostgreSQL database. Your enquiry record and the venue's contact record are stored here.",
            },
            {
              term: "Railway",
              detail:
                "Hosting for the application interface that receives your enquiry and serves the venue's planning tools.",
            },
            {
              term: "Vercel",
              detail:
                "Hosting and content delivery for the website you are reading. It serves the pages and the images.",
            },
            {
              term: "Resend",
              detail:
                "Transactional email delivery. It carries the notification of your enquiry to the venue's events team.",
            },
            {
              term: "Clerk",
              detail:
                "Authentication for venue staff accounts. It handles staff sign-in; it does not sign in visitors sending enquiries.",
            },
            {
              term: "Sentry",
              detail:
                "Error monitoring. It records technical diagnostics when something in the site fails, so that we can fix it.",
            },
            {
              term: "Cloudflare R2",
              detail:
                "Object storage for the venue's imagery and for the 3D capture of its rooms.",
            },
            {
              term: "Stripe",
              detail:
                "Payment processing for deposits, when the venue asks for one. You pay on Stripe's own page; Stripe receives your card or bank details, the amount, the title of the proposal the deposit is for (often your event's name), our references for it, and the email address the venue holds for you (for Stripe's receipt), and tells us whether the payment succeeded. For its own fraud prevention and legal duties Stripe also acts on its own account, under its own privacy policy.",
            },
          ],
        },
        {
          kind: "p",
          text: "We may also share information where the law requires it — with a regulator, or in response to a valid legal request — and with the venue's professional advisers where that is necessary to deal with a dispute or a claim.",
        },
      ],
    },
    {
      id: "where-processed",
      heading: "Where your information is processed",
      blocks: [
        {
          kind: "p",
          text: "The providers listed above are internationally operated services, and several of them are established in the United States. Some processing of your information may therefore take place outside the United Kingdom and the European Economic Area.",
        },
        {
          kind: "p",
          text: "Where that happens, the transfer is made under one of the safeguards UK law allows: the UK International Data Transfer Agreement, the UK Addendum to the European Commission's Standard Contractual Clauses, or the UK Extension to the EU–US Data Privacy Framework where the provider takes part in it. If you want to know which safeguard applies to a particular provider, ask us and we will tell you.",
        },
      ],
    },
    {
      id: "how-long",
      heading: "How long we keep it",
      blocks: [
        {
          kind: "defs",
          items: [
            {
              term: "Enquiries that do not become bookings",
              detail:
                "Deleted 24 months after our last contact with you. Event planning runs on long lead times, and people come back a year later about the same wedding, which is why the period is not shorter.",
            },
            {
              term: "Enquiries that become bookings",
              detail:
                "Kept for the life of the booking and for six years after the end of the financial year in which the event took place, so that the venue can meet its accounting obligations and answer any claim arising from the event.",
            },
            {
              term: "The contact record",
              detail:
                "Your email address, name and phone number held as a single contact record: deleted on the same 24-month rule, counted from our last contact with you.",
            },
            {
              term: "The allergy note on an event's layout",
              detail:
                `Removed from the layout, and from the event sheets and their stored copies, ${String(NOTE_DAYS_AFTER_EVENT)} days after the event. A layout with no event date loses the note ${String(NOTE_MONTHS_WITHOUT_EVENT)} months after it last changed. The counts per meal, which do not identify anyone, stay with the layout and its event sheets.`,
            },
            {
              term: "An allergy note you asked us to remember",
              detail:
                `Kept with your account until you remove it, which you can do at any time. If ${String(DIETARY_MEMORY_MONTHS_UNUSED)} months pass without it being saved with a layout, we remove it. Once it is removed, we keep only the record that you agreed, when, the words you agreed to, and when it ended, without the note itself.`,
            },
            {
              term: "Signed contracts and deposit records",
              detail:
                "Kept with the booking's records: for the life of the booking and for six years after the end of the financial year in which the event took place, the same period as a booking, because they are the record of what was agreed and paid. A contract you did not sign is kept on the same rule.",
            },
            {
              term: "Logs and error diagnostics",
              detail:
                "Kept only for as long as our hosting and error-monitoring providers retain them under their standard settings. We do not take separate copies of them.",
            },
            {
              term: "Backups",
              detail:
                "The database keeps a seven-day history it can be restored from and a daily copy that is kept for 14 days, so that a mistake or a failure does not lose anyone's booking. Something deleted under these rules is gone from the backups 14 days later. If the service is ever restored from a backup, anything deleted since that backup is deleted again before the service reopens.",
            },
          ],
        },
        {
          kind: "p",
          text: "You can ask us to delete your enquiry sooner. We will do that unless we still need it for a live booking or to meet a legal obligation, and if we cannot delete something we will tell you why.",
        },
        {
          kind: "links",
          items: [
            { label: "Allergy notes you asked us to remember", text: "See or remove them (sign in first)", href: REMEMBERED_NOTES_PATH, external: false },
          ],
        },
      ],
    },
    {
      id: "security",
      heading: "How we protect it",
      blocks: [
        {
          kind: "list",
          items: [
            "Everything you send travels over an encrypted connection (HTTPS).",
            "Enquiry records are visible only to signed-in venue staff who hold the events role. They are not public, and they are not reachable without an account.",
            "The public enquiry form is rate-limited to ten submissions an hour from one source, which limits both abuse and bulk harvesting.",
            "Database access is restricted to the application itself and to the people who maintain it.",
            "No system is perfectly secure. If we become aware of a breach of your personal information that is likely to put you at risk, we will tell you, and we will report it to the Information Commissioner's Office where the law requires.",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      heading: "Your rights",
      blocks: [
        {
          kind: "p",
          text: "UK GDPR gives you the following rights over the information we hold about you. They are free to exercise.",
        },
        {
          kind: "defs",
          items: [
            {
              term: "Access",
              detail:
                "Ask for a copy of the personal information we hold about you, and for an explanation of what we do with it.",
            },
            {
              term: "Rectification",
              detail:
                "Ask us to correct anything inaccurate, or to complete anything incomplete — a mistyped date, a wrong phone number.",
            },
            {
              term: "Erasure",
              detail:
                "Ask us to delete your information. This applies where we no longer need it, or where you object and we have no overriding reason to keep it.",
            },
            {
              term: "Restriction",
              detail:
                "Ask us to stop using your information while a question about its accuracy, or about our right to hold it, is being resolved.",
            },
            {
              term: "Portability",
              detail:
                "Ask for the information you gave us in a structured, commonly used, machine-readable format, or ask us to send it to someone else.",
            },
            {
              term: "Objection",
              detail:
                "Object to our using your information where we rely on legitimate interests. If you object, we stop unless we can show compelling grounds that override your interests.",
            },
            {
              term: "Withdrawing consent",
              detail:
                `If you ticked "${REMEMBER_QUESTION}" beside an allergy note, you can take that back at any time: remove the note on your remembered notes page, or untick the box and save. The copy kept with your account is removed at once, and that does not undo anything done before. Nothing else on this site waits for a tick, so there is nothing else to withdraw.`,
            },
          ],
        },
        {
          kind: "p",
          text: "To exercise any of these, contact the events team using the details at the end of this policy and say what you want. We will reply within one month. If your request is complex, or you have made several, we may take up to two further months — we will tell you within the first month if that happens, and why. We may ask you to confirm your identity before we release information, so that we do not hand your details to somebody else.",
        },
      ],
    },
    {
      id: "complaints",
      heading: "Complaints",
      blocks: [
        {
          kind: "p",
          text: "If you are unhappy with how we have handled your information, please tell us first. We would rather put it right ourselves.",
        },
        {
          kind: "p",
          text: "You also have the right to complain to the Information Commissioner's Office (the ICO), the UK's data protection regulator. You can do that whether or not you have raised it with us.",
        },
        {
          kind: "links",
          items: [
            { label: "ICO website", text: "ico.org.uk", href: "https://ico.org.uk", external: true },
            { label: "ICO helpline", text: "0303 123 1113", href: "tel:03031231113", external: false },
          ],
        },
      ],
    },
    {
      id: "children",
      heading: "Children",
      blocks: [
        {
          kind: "p",
          text: "This service is not directed at children. The enquiry form is intended for adults arranging an event. If you believe a child has sent us personal information through this site, contact us and we will delete it.",
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      blocks: [
        {
          kind: "p",
          text: `The version in force is the one on this page, dated ${PRIVACY_UPDATED.text}. If we change it, that date changes with it, and where a change directly affects people who have already sent us an enquiry we will tell them.`,
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact us",
      blocks: [
        {
          kind: "p",
          text: "For anything in this policy — a request, a question, or a complaint — contact the events team:",
        },
        { kind: "links", items: CONTACT_LINKS },
        { kind: "defs", items: POSTAL_ADDRESS_DEFS },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------

const TERMS: LegalDocument = {
  title: "Terms of Service",
  standfirst:
    "The terms on which you may use this site and the planning tools on it — what the service is, what it is not, and what happens when you send an enquiry.",
  updated: ORIGINAL_EDITION,
  sections: [
    {
      id: "these-terms",
      heading: "These terms",
      blocks: [
        {
          kind: "p",
          text: `These terms are between you and ${VENUE_NAME}, which operates this site with the Venviewer planning platform. By using the site you accept them. If you do not accept them, please do not use the site.`,
        },
        {
          kind: "p",
          text: "If you are a consumer, nothing in these terms takes away rights the law gives you.",
        },
      ],
    },
    {
      id: "what-this-is",
      heading: "What this service is",
      blocks: [
        {
          kind: "p",
          text: "This site lets you look at the rooms of the Trades House, arrange furniture within a plan of them, and send an enquiry to the events team. It is a planning and visualisation aid, and it should be treated as one.",
        },
        {
          kind: "list",
          items: [
            "The 3D views are a representation of the building, built from photography and capture of the rooms. They are close, not exact, and they are not measured drawings.",
            "A layout you build shows one way a room could be arranged. It is not a safety, fire or licensing document, and it is not a statement of what the venue will agree to on the day.",
            "Figures the tool produces — guest counts, spacing, circulation — come from its planning model, not from an inspection of the room as it will be set on the day of your event.",
          ],
        },
      ],
    },
    {
      id: "not-a-booking",
      heading: "An enquiry is not a booking",
      blocks: [
        {
          kind: "p",
          text: "Sending an enquiry does not reserve a date, hold a room, or create any right to either. It is a request for a conversation, and nothing more.",
        },
        {
          kind: "p",
          text: "A booking exists only when the Trades House confirms it to you in writing, under its own hire terms. Until that happens the date remains available to anyone else, however far your plan has progressed on this site.",
        },
        {
          kind: "p",
          text: "The events team may not be able to accommodate what you have planned. Rooms, dates, layouts, catering and any other service are all subject to confirmation by the venue.",
        },
      ],
    },
    {
      id: "capacities-and-rates",
      heading: "Capacities, dimensions and rates",
      blocks: [
        {
          kind: "p",
          text: "The room capacities, dimensions and rates shown on this site are the venue's own published figures.",
        },
        {
          kind: "p",
          text: "They are shown for guidance and are subject to confirmation. How many people a room will actually hold on a given day depends on the layout, on what your event needs, and on the venue's own operating rules. A number the planner shows you is a planning figure, not a permission.",
        },
        {
          kind: "p",
          text: "Rates can change, and a figure shown here does not include anything it does not say it includes. A price becomes fixed only in a written quotation or contract issued by the venue.",
        },
      ],
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      blocks: [
        { kind: "p", text: "When you use this site, please do not:" },
        {
          kind: "list",
          items: [
            "Submit anything unlawful, abusive, discriminatory, or deliberately false.",
            "Impersonate anyone, or send an enquiry using another person's contact details without their permission.",
            "Use automated tools to submit enquiries, to harvest content from the site, or to work around the limits on the enquiry form.",
            "Try to reach plans, accounts or records that are not yours, or probe or test the security of the service without our written permission.",
            "Copy, redistribute or republish the venue's photography or the 3D capture of its rooms, or use either to build a derivative model or dataset, without written permission.",
          ],
        },
        {
          kind: "p",
          text: "We may suspend access, remove content, or decline to act on enquiries where these rules are broken.",
        },
      ],
    },
    {
      id: "what-you-send",
      heading: "What you send us",
      blocks: [
        {
          kind: "p",
          text: "You keep ownership of what you send. You give the Trades House permission to store and use your enquiry, your layout and your message for the purpose of answering you and, if the event goes ahead, arranging it. How that information is handled is set out in the Privacy Policy.",
        },
        {
          kind: "p",
          text: "You confirm that you are entitled to send us what you send, and that it does not infringe anyone else's rights.",
        },
      ],
    },
    {
      id: "intellectual-property",
      heading: "Intellectual property",
      blocks: [
        {
          kind: "p",
          text: "The photography of the building, the 3D capture of its rooms, the venue's name and arms, and the text on this site belong to the Trades House of Glasgow or to those it licenses them from. The planning platform, its software and its design belong to Venviewer.",
        },
        {
          kind: "p",
          text: "You may view them, and use the planner to plan an event at the venue. Any other use — copying, redistribution, commercial reuse, or use as training material for a model or a dataset — needs written permission first.",
        },
        {
          kind: "p",
          text: "The city drawn round the Grand Hall in the planner, and the rooftop heights used to work out when the sun reaches its windows, are made from the Scottish Government's open LiDAR survey. Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0. That data is published under the Open Government Licence v3.0, and its reuse is governed by that licence, not by these terms.",
        },
        {
          kind: "p",
          text: "The street lamps drawn round the hall at night stand where Glasgow City Council's open street lighting data places them. Contains public sector information licensed under the Open Government Licence v3.0. Street lighting: Glasgow City Council. Contains OS data © Crown copyright and database right 2026.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Licence",
              text: "Open Government Licence v3.0",
              href: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
              external: true,
            },
          ],
        },
      ],
    },
    {
      id: "availability",
      heading: "Availability",
      blocks: [
        {
          kind: "p",
          text: "The site is provided as it is and as available. We do not promise that it will be uninterrupted or free of faults, and we may change, suspend or withdraw any part of it. Devices differ: parts of the 3D experience need hardware graphics support and will not run everywhere.",
        },
      ],
    },
    {
      id: "liability",
      heading: "Liability",
      blocks: [
        {
          kind: "p",
          text: "Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be limited.",
        },
        {
          kind: "p",
          text: "Subject to that, neither the Trades House nor Venviewer is liable for loss that follows from relying on the planning output of this site — for example a layout that turns out not to suit the room on the day, a capacity figure the events team revises, or a date that is no longer available. The planner is a guide; decisions about your event should be confirmed with the events team.",
        },
        {
          kind: "p",
          text: "We are not liable for indirect or consequential loss, or for loss of profit, revenue, or opportunity.",
        },
        {
          kind: "p",
          text: "If your event is booked, the venue's own hire contract governs that booking, and where it conflicts with these terms in relation to the booking, the hire contract prevails.",
        },
      ],
    },
    {
      id: "changes-to-terms",
      heading: "Changes to these terms",
      blocks: [
        {
          kind: "p",
          text: `We may change these terms. The version in force is the one on this page, dated ${LAST_UPDATED}. Continuing to use the site after a change means you accept the version then published.`,
        },
      ],
    },
    {
      id: "governing-law",
      heading: "Governing law",
      blocks: [
        {
          kind: "p",
          text: "These terms, and any dispute or claim arising from them or from your use of this site, are governed by the law of Scotland. The Scottish courts have jurisdiction.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        { kind: "p", text: "Questions about these terms go to the events team:" },
        { kind: "links", items: CONTACT_LINKS },
        { kind: "defs", items: POSTAL_ADDRESS_DEFS },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Accessibility Statement
//
// Honest by construction: it names the two measured contrast failures, and it
// makes NO conformance claim, because no third-party audit has been done.
// ---------------------------------------------------------------------------

const ACCESSIBILITY: LegalDocument = {
  title: "Accessibility Statement",
  standfirst:
    "What we have done to make this site usable, what we know is still wrong with it, and how to reach a person if something here blocks you.",
  updated: ORIGINAL_EDITION,
  sections: [
    {
      id: "scope",
      heading: "What this statement covers",
      blocks: [
        {
          kind: "p",
          text: `This statement covers the public pages of the Trades House of Glasgow's Venviewer site: the room pages, the enquiry form, the virtual walkthrough and the planning tools reached from them. It was written on ${LAST_UPDATED} by the team that builds the site, and it reflects our own testing.`,
        },
      ],
    },
    {
      id: "standard",
      heading: "The standard we work to, and what we do not claim",
      blocks: [
        {
          kind: "p",
          text: "We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. That is the target we design and build against.",
        },
        {
          kind: "p",
          text: "No third-party accessibility audit of this site has been carried out, and we have not completed a full assessment against WCAG 2.2 AA ourselves. We therefore make no claim that the site conforms to that standard. We would rather say that plainly than publish a conformance claim we cannot evidence — and there are known failures, listed below.",
        },
      ],
    },
    {
      id: "what-has-been-done",
      heading: "What has been done",
      blocks: [
        {
          kind: "list",
          items: [
            "The site can be operated with a keyboard, and a skip link takes you straight to the main content of a page.",
            "Headings and landmarks are used in order, so that a screen reader can navigate the structure of a page rather than reading it as one block.",
            "Images that carry meaning have text alternatives; images that are purely decorative are hidden from assistive technology.",
            "There is a light theme and a dark theme, and the site follows the setting your device already uses. You can override it.",
            "Motion is functional rather than decorative, and animated reveals are switched off entirely when your device asks for reduced motion.",
            "Pages are laid out to work at phone widths, and text can be enlarged with your browser's own zoom.",
            "Room dimensions, capacities, prices and contact details are given as text on the page, not only inside the 3D view.",
          ],
        },
      ],
    },
    {
      id: "known-problems",
      heading: "Known problems",
      blocks: [
        {
          kind: "p",
          text: "These are the accessibility problems we currently know about. Listing them is not an excuse for them.",
        },
        {
          kind: "defs",
          items: [
            {
              term: "Low-contrast text on the home page",
              detail:
                "Two pieces of text in the walkthrough section of the home page fail the contrast requirement. They measure 1.92:1 and 2.12:1, where 4.5:1 is required for text at normal size. Work to correct them is under way.",
            },
            {
              term: "The 3D walkthrough and the planner",
              detail:
                "These are visual by nature. There is no equivalent non-visual experience of the 3D view itself, and the planner's drag-and-drop arrangement has not been tested with assistive technology. Everything those views convey — room sizes, capacities, layouts, photographs and prices — is available as text and photography elsewhere on the site, and the events team will talk any of it through with you.",
            },
            {
              term: "Untested areas",
              detail:
                "We have not tested the site with people who use screen readers, magnifiers or voice control, and we have not checked every page against every assistive technology. Where we have not tested, we do not claim.",
            },
          ],
        },
      ],
    },
    {
      id: "if-something-blocks-you",
      heading: "If something on this site blocks you",
      blocks: [
        {
          kind: "p",
          text: "Tell us, and we will help you directly. You should not have to fight the website: the events team can give you room dimensions, capacities, photographs, prices and availability by phone or by email, and can arrange for you to see the rooms in person.",
        },
        {
          kind: "p",
          text: "We aim to reply within five working days. If we cannot fix the underlying problem quickly, we will tell you what we are doing about it and give you the information another way in the meantime.",
        },
        { kind: "links", items: CONTACT_LINKS },
      ],
    },
    {
      id: "how-we-test",
      heading: "How we test",
      blocks: [
        {
          kind: "p",
          text: "The site is checked by the team that builds it: keyboard navigation, heading structure, text alternatives, contrast measured against the WCAG formula, reduced-motion behaviour, and layout at phone widths. Some of those checks — heading structure and the skip link among them — run automatically with our test suite on every change. This is our own testing, not an independent assessment.",
        },
      ],
    },
    {
      id: "not-satisfied",
      heading: "If you are not satisfied with our response",
      blocks: [
        {
          kind: "p",
          text: "Come back to us first, and say so plainly — a second look by a person is usually faster than anything else. If you remain unhappy, the Equality Advisory and Support Service gives free, independent advice on disability discrimination in England, Scotland and Wales.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Equality Advisory and Support Service",
              text: "equalityadvisoryservice.com",
              href: "https://www.equalityadvisoryservice.com",
              external: true,
            },
          ],
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        { kind: "p", text: "Accessibility questions and problems go to the events team:" },
        { kind: "links", items: CONTACT_LINKS },
        { kind: "defs", items: POSTAL_ADDRESS_DEFS },
      ],
    },
  ],
};

const DOCUMENTS: Readonly<Record<LegalPageProps["type"], LegalDocument>> = {
  accessibility: ACCESSIBILITY,
  privacy: PRIVACY,
  terms: TERMS,
};

interface SiblingLink {
  readonly href: string;
  readonly label: string;
}

/** Sibling documents, so each page is one click from the other two. */
const SIBLINGS: Readonly<Record<LegalPageProps["type"], SiblingLink>> = {
  accessibility: { href: "/accessibility", label: "Accessibility Statement" },
  privacy: { href: "/privacy", label: "Privacy Policy" },
  terms: { href: "/terms", label: "Terms of Service" },
};

const SIBLING_ORDER: readonly LegalPageProps["type"][] = ["privacy", "terms", "accessibility"];

// ---------------------------------------------------------------------------
// Theme — these pages carry no toggle of their own, but they honour the choice
// made on the home page, so a reader who chose dark there is not handed a sheet
// of white paper here. Read once at render: the preference can only change on a
// page that owns the control.
// ---------------------------------------------------------------------------

const THEME_KEY = "fresh-theme.v1";

function storedTheme(): "dark" | "light" | undefined {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function LegalBlockView({ block }: { readonly block: LegalBlock }): ReactElement {
  switch (block.kind) {
    case "p":
      return <p className="lg-p">{block.text}</p>;
    case "list":
      return (
        <ul className="lg-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "defs":
      return (
        <dl className="lg-defs">
          {block.items.map((item) => (
            <div className="lg-def" key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      );
    case "links":
      return (
        <ul className="lg-links">
          {block.items.map((item) => (
            <li key={item.href}>
              <span className="lg-link-label">{item.label}</span>
              {item.external ? (
                <a href={item.href} target="_blank" rel="noreferrer noopener">
                  {item.text}
                </a>
              ) : (
                <a href={item.href}>{item.text}</a>
              )}
            </li>
          ))}
        </ul>
      );
  }
}

export function LegalPage({ type }: LegalPageProps): ReactElement {
  const doc = DOCUMENTS[type];
  // The same title the crawler-readable copy of index.html carries for this
  // address (lib/route-documents.ts), kept when moving here inside the app.
  const title = ROUTE_DOCUMENTS.find((entry) => entry.name === type)?.title ?? doc.title;
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
  const theme = storedTheme();
  const others = SIBLING_ORDER.filter((key) => key !== type);

  return (
    <div className="lg-root" {...(theme === undefined ? {} : { "data-theme": theme })}>
      <a className="lg-skip" href="#lg-main">
        Skip to the document
      </a>

      <header className="lg-header">
        <a className="lg-home" href="/">
          <span className="lg-home-arrow" aria-hidden="true">
            &larr;
          </span>
          {VENUE_NAME}
        </a>
      </header>

      <main className="lg-main" id="lg-main">
        <article className="lg-doc">
          <h1 className="lg-title">{doc.title}</h1>
          <p className="lg-standfirst">{doc.standfirst}</p>
          <p className="lg-updated">
            <span className="lg-updated-label">Last updated</span>
            <time dateTime={doc.updated.iso}>{doc.updated.text}</time>
          </p>

          <nav className="lg-toc" aria-labelledby="lg-toc-heading">
            <h2 className="lg-toc-heading" id="lg-toc-heading">
              Contents
            </h2>
            <ol className="lg-toc-list">
              {doc.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.heading}</a>
                </li>
              ))}
            </ol>
          </nav>

          {doc.sections.map((section) => (
            <section
              className="lg-section"
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
            >
              <h2 className="lg-heading" id={`${section.id}-heading`}>
                {section.heading}
              </h2>
              {section.blocks.map((block, index) => (
                <LegalBlockView block={block} key={`${section.id}-${String(index)}`} />
              ))}
            </section>
          ))}
        </article>
      </main>

      <footer className="lg-footer">
        <p className="lg-footer-note">
          {VENUE_NAME}, {VENUE_ADDRESS}
        </p>
        <ul className="lg-footer-links">
          <li>
            <a href="/">Home</a>
          </li>
          {others.map((key) => (
            <li key={key}>
              <a href={SIBLINGS[key].href}>{SIBLINGS[key].label}</a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
