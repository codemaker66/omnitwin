import type { ReactElement, ReactNode, CSSProperties } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { WORKSPACE_COLOURS, WORKSPACE_FONTS } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Email templates — react-email JSX
//
// Migration from raw-HTML string templates to react-email 6.0 components.
// Rationale:
//   1. Type-safe composition — the Html/Body/Container/Section primitives
//      emit inline-styled tables that Gmail/Outlook reliably render, and
//      they ship with accessibility attributes we used to hand-roll.
//   2. Preview ergonomics — `pnpm email dev` surfaces every template
//      locally at http://localhost:3001 for visual review without
//      deploying or sending a real mail.
//   3. Consistent escaping — JSX handles HTML escaping automatically,
//      removing the handful of `escapeHtml()` call sites that used to
//      guard every interpolation.
//
// Public contract: every template function is `async` and returns
// `Promise<{ subject, html }>`. Callers in Fastify routes `await` the
// template, then pass the result to `sendEmailAsync`. The subject is a
// plain string (not rendered), set outside the JSX so renderer cost
// stays linear in body length.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Brand + shared styles
// ---------------------------------------------------------------------------

const BRAND_NAVY = "#1a1a2e";
const BRAND_BLUE = "#3b82f6";
const BRAND_BG = "#f5f5f0";
const INK = "#333";
const INK_MUTED = "#999";
const INK_SOFT = "#555";

const cardStyle: CSSProperties = {
  maxWidth: 600,
  width: "100%",
  background: "#fff",
  borderRadius: 8,
  overflow: "hidden",
  margin: "20px auto",
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  background: BRAND_BG,
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
};

const headerBarStyle: CSSProperties = {
  background: BRAND_NAVY,
  padding: "20px 24px",
};

const brandWordmarkStyle: CSSProperties = {
  color: "#fff",
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "-0.5px",
  margin: 0,
  display: "inline",
};

const brandCaptionStyle: CSSProperties = {
  color: "rgba(255,255,255,0.6)",
  fontSize: 13,
  margin: "0 0 0 12px",
  display: "inline",
};

const mainSectionStyle: CSSProperties = {
  padding: 24,
};

const footerStyle: CSSProperties = {
  padding: "16px 24px",
  borderTop: "1px solid #eee",
  fontSize: 11,
  color: INK_MUTED,
};

const h2Style = (color: string = BRAND_NAVY): CSSProperties => ({
  margin: "0 0 16px",
  fontSize: 18,
  fontWeight: 700,
  color,
});

const paragraphStyle: CSSProperties = {
  fontSize: 14,
  color: INK,
  lineHeight: 1.5,
  margin: "0 0 12px",
};

const buttonStyle: CSSProperties = {
  padding: "10px 20px",
  background: BRAND_BLUE,
  color: "#fff",
  textDecoration: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
};

const buttonSecondaryStyle: CSSProperties = {
  padding: "10px 20px",
  background: "#fff",
  color: BRAND_NAVY,
  textDecoration: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid #e5e7eb",
  marginLeft: 8,
};

const metaTableStyle: CSSProperties = {
  width: "100%",
  marginTop: 12,
};

const metaLabelStyle: CSSProperties = {
  padding: "4px 0",
  color: INK_MUTED,
  fontSize: 13,
  width: 120,
  verticalAlign: "top",
};

const metaValueStyle: CSSProperties = {
  padding: "4px 0",
  fontSize: 13,
  color: INK,
};

type CalloutTone = "critical" | "warning" | "success" | "neutral";

function noteCallout(
  tone: CalloutTone,
  label: string,
  body: string,
): ReactElement {
  const palette: Record<CalloutTone, { background: string; border: string; heading: string }> = {
    critical: { background: "#fef2f2", border: "#ef4444", heading: "#a02020" },
    warning:  { background: "#fffbeb", border: "#d97706", heading: "#8c5a00" },
    success:  { background: "#f0fdf4", border: "#059669", heading: "#065f2b" },
    neutral:  { background: "#f9f9f6", border: "#d0c8b0", heading: INK_SOFT },
  };
  const p = palette[tone];
  return (
    <Section
      style={{
        margin: "16px 0",
        padding: 12,
        background: p.background,
        borderRadius: 6,
        borderLeft: `3px solid ${p.border}`,
      }}
    >
      <Text style={{ margin: 0, fontSize: 13, color: p.heading, fontWeight: 700 }}>
        {label}
      </Text>
      <Text style={{ margin: "4px 0 0", fontSize: 13, color: INK }}>{body}</Text>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Layout component — shared by every email
// ---------------------------------------------------------------------------

interface LayoutProps {
  readonly label: string;
  readonly preview: string;
  readonly children: ReactNode;
}

function Layout({ label, preview, children }: LayoutProps): ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={cardStyle}>
          <Section style={headerBarStyle}>
            <Text style={brandWordmarkStyle}>VENVIEWER</Text>
            <Text style={brandCaptionStyle}>{label}</Text>
          </Section>
          <Section style={mainSectionStyle}>{children}</Section>
          <Section style={footerStyle}>
            Sent by Venviewer — Venue Planning Platform
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Meta row — skips falsy values so conditional fields don't render empty
// ---------------------------------------------------------------------------

function MetaRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null | undefined;
}): ReactElement | null {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Row>
      <td style={metaLabelStyle}>{label}</td>
      <td style={metaValueStyle}>{value}</td>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// newEnquiryNotification — sent to hallkeeper
// ---------------------------------------------------------------------------

export interface NewEnquiryData {
  readonly spaceName: string;
  readonly eventType: string | null;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly eventDate: string | null;
  readonly guestCount: number | null;
  readonly message: string | null;
  readonly dashboardUrl: string;
}

export function NewEnquiryEmail(props: NewEnquiryData): ReactElement {
  return (
    <Layout label="New Enquiry" preview={`New enquiry for ${props.spaceName}`}>
      <Heading style={h2Style()}>New Enquiry Received</Heading>
      <Section>
        <table cellPadding={0} cellSpacing={0} style={metaTableStyle}>
          <tbody>
            <MetaRow label="Contact" value={props.contactName} />
            <MetaRow label="Email" value={props.contactEmail} />
            <MetaRow label="Phone" value={props.contactPhone} />
            <MetaRow label="Space" value={props.spaceName} />
            <MetaRow label="Event type" value={props.eventType} />
            <MetaRow label="Date" value={props.eventDate} />
            <MetaRow
              label="Guests"
              value={props.guestCount === null ? null : String(props.guestCount)}
            />
          </tbody>
        </table>
      </Section>
      {props.message !== null && props.message !== "" && (
        <Section
          style={{
            marginTop: 16,
            padding: 12,
            background: "#f9f9f6",
            borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 13, color: INK_SOFT, margin: 0 }}>{props.message}</Text>
        </Section>
      )}
      <Section style={{ marginTop: 20 }}>
        <Button href={props.dashboardUrl} style={buttonStyle}>
          View in Dashboard
        </Button>
      </Section>
    </Layout>
  );
}

export async function newEnquiryNotification(
  data: NewEnquiryData,
): Promise<{ subject: string; html: string }> {
  const subject = data.eventType !== null
    ? `New enquiry for ${data.spaceName} — ${data.eventType}`
    : `New enquiry for ${data.spaceName}`;
  const html = await render(<NewEnquiryEmail {...data} />);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// enquiryAcknowledgement — sent to the ORGANISER, the moment they enquire
//
// Until this template existed, a guest who sent an enquiry through the public
// site got a 201 and silence: the only mail raised went to the venue's
// hallkeepers. This is the venue's own reply, in the venue's voice — the
// wordmark, the sign-off and the From address are the venue's, not the
// platform's (EMAIL_FROM carries the venue's name; EMAIL_REPLY_TO carries the
// monitored inbox the organiser's reply should land in).
//
// Deliberately no unsubscribe link: this is a one-off transactional reply to
// a message the organiser has just sent, not marketing they can be enrolled in.
// ---------------------------------------------------------------------------

/** An en-GB long date: "Friday 2 October 2026". The input is the stored
 *  calendar date (YYYY-MM-DD) with no time zone, so it is read and formatted
 *  in UTC — a British organiser must never be shown the day before the date
 *  they typed. An unparseable value passes through verbatim rather than
 *  rendering as "Invalid Date". */
export function formatEnGbDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) return isoDate;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/** The venue's own letterhead. Same tested primitives as `Layout`, but the
 *  venue's name leads and the footer is the venue's sign-off — a client
 *  reading this should see their venue writing to them. */
function VenueLayout({
  venueName,
  label,
  preview,
  children,
}: {
  readonly venueName: string;
  readonly label: string;
  readonly preview: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Html lang="en-GB">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={cardStyle}>
          <Section style={headerBarStyle}>
            <Text style={brandWordmarkStyle}>{venueName}</Text>
            <Text style={brandCaptionStyle}>{label}</Text>
          </Section>
          <Section style={mainSectionStyle}>{children}</Section>
          <Section style={footerStyle}>
            Sent by the events team at {venueName}.
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export interface EnquiryAcknowledgementData {
  readonly venueName: string;
  readonly spaceName: string;
  /** The organiser's own name, as they gave it. */
  readonly organiserName: string;
  readonly eventType: string | null;
  /** Stored calendar date, YYYY-MM-DD. */
  readonly eventDate: string | null;
  readonly guestCount: number | null;
  /** The monitored address a reply reaches. Rendered as well as set as the
   *  Reply-To header, so the organiser can see where their reply goes. */
  readonly replyToEmail: string | null;
}

export function EnquiryAcknowledgementEmail(props: EnquiryAcknowledgementData): ReactElement {
  const formattedDate = props.eventDate === null ? null : formatEnGbDate(props.eventDate);
  const replyTo = props.replyToEmail;
  return (
    <VenueLayout
      venueName={props.venueName}
      label="Your enquiry"
      preview={`${props.venueName} has your enquiry`}
    >
      <Heading style={h2Style()}>Thank you — we have your enquiry</Heading>
      <Text style={paragraphStyle}>Dear {props.organiserName},</Text>
      <Text style={paragraphStyle}>
        Thank you for thinking of {props.venueName}. Your enquiry about{" "}
        <strong>{props.spaceName}</strong> is with our events team, and one of us
        will come back to you personally — normally within one working day.
      </Text>
      <Text style={paragraphStyle}>Here is what you told us:</Text>
      <Section>
        <table cellPadding={0} cellSpacing={0} style={metaTableStyle}>
          <tbody>
            <MetaRow label="Room" value={props.spaceName} />
            <MetaRow label="Occasion" value={props.eventType} />
            <MetaRow label="Date" value={formattedDate} />
            <MetaRow
              label="Guests"
              value={props.guestCount === null ? null : String(props.guestCount)}
            />
          </tbody>
        </table>
      </Section>
      <Text style={paragraphStyle}>
        If anything above is wrong, or you would like to add to it, simply reply
        to this message
        {replyTo !== null && replyTo !== "" ? (
          <>
            {" — it reaches us at "}
            <Link href={`mailto:${replyTo}`}>{replyTo}</Link>
          </>
        ) : null}
        .
      </Text>
      <Text style={paragraphStyle}>
        Nothing is held or confirmed yet; we will talk you through dates, rooms
        and costs before anything is agreed.
      </Text>
      <Text style={{ ...paragraphStyle, marginTop: 20 }}>
        With best wishes,
        <br />
        The events team, {props.venueName}
      </Text>
    </VenueLayout>
  );
}

export async function enquiryAcknowledgement(
  data: EnquiryAcknowledgementData,
): Promise<{ subject: string; html: string }> {
  const subject = `We have your enquiry — ${data.venueName}`;
  const html = await render(<EnquiryAcknowledgementEmail {...data} />);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// enquiryApproved — sent to planner/guest
// ---------------------------------------------------------------------------

export interface EnquiryApprovedData {
  readonly venueName: string;
  readonly spaceName: string;
  readonly eventDate: string | null;
  readonly configUrl: string | null;
}

export function EnquiryApprovedEmail(props: EnquiryApprovedData): ReactElement {
  return (
    <Layout
      label="Approved"
      preview={`Your enquiry for ${props.spaceName} has been approved`}
    >
      <Heading style={h2Style("#059669")}>Enquiry Approved</Heading>
      <Text style={paragraphStyle}>
        Great news! Your enquiry for <strong>{props.spaceName}</strong> at{" "}
        <strong>{props.venueName}</strong>
        {props.eventDate !== null ? (
          <>
            {" "}on <strong>{props.eventDate}</strong>
          </>
        ) : null}{" "}
        has been approved.
      </Text>
      <Text style={paragraphStyle}>
        The events team will be in touch shortly to confirm final details and arrangements.
      </Text>
      {props.configUrl !== null && (
        <Section style={{ marginTop: 16 }}>
          <Button href={props.configUrl} style={buttonStyle}>
            View Your Layout
          </Button>
        </Section>
      )}
    </Layout>
  );
}

export async function enquiryApproved(
  data: EnquiryApprovedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Your enquiry for ${data.spaceName} has been approved`;
  const html = await render(<EnquiryApprovedEmail {...data} />);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// enquiryRejected — sent to planner/guest
// ---------------------------------------------------------------------------

export interface EnquiryRejectedData {
  readonly venueName: string;
  readonly spaceName: string;
  readonly eventDate: string | null;
  readonly note: string | null;
}

export function EnquiryRejectedEmail(props: EnquiryRejectedData): ReactElement {
  return (
    <Layout label="Update" preview={`Update on your enquiry for ${props.spaceName}`}>
      <Heading style={h2Style()}>Enquiry Update</Heading>
      <Text style={paragraphStyle}>
        Thank you for your interest in <strong>{props.spaceName}</strong> at{" "}
        <strong>{props.venueName}</strong>
        {props.eventDate !== null ? (
          <>
            {" "}on <strong>{props.eventDate}</strong>
          </>
        ) : null}
        . Unfortunately, we&apos;re unable to accommodate this particular request at this time.
      </Text>
      {props.note !== null && props.note !== "" &&
        noteCallout("critical", "Note from the events team", props.note)}
      <Text style={paragraphStyle}>
        We&apos;d love to help you find an alternative — please don&apos;t hesitate to try
        different dates or explore our other spaces.
      </Text>
    </Layout>
  );
}

export async function enquiryRejected(
  data: EnquiryRejectedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Update on your enquiry for ${data.spaceName}`;
  const html = await render(<EnquiryRejectedEmail {...data} />);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Configuration review lifecycle templates
//
// Shared shape. Every review email references the event + venue + space
// at-a-glance and a snapshot version so the planner knows which revision
// the action applied to.
// ---------------------------------------------------------------------------

interface ConfigReviewCommon {
  readonly eventName: string;
  readonly venueName: string;
  readonly spaceName: string;
  readonly snapshotVersion: number;
}

function EventMetaTable({
  data,
  extra,
}: {
  readonly data: ConfigReviewCommon;
  readonly extra?: readonly { label: string; value: string | null }[];
}): ReactElement {
  return (
    <Section>
      <table cellPadding={0} cellSpacing={0} style={metaTableStyle}>
        <tbody>
          <MetaRow label="Event" value={data.eventName} />
          <MetaRow label="Venue" value={data.venueName} />
          <MetaRow label="Space" value={data.spaceName} />
          <MetaRow label="Version" value={`v${String(data.snapshotVersion)}`} />
          {extra?.map((row) => (
            <MetaRow key={row.label} label={row.label} value={row.value} />
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// --- configSubmitted ---

export interface ConfigSubmittedData extends ConfigReviewCommon {
  readonly submittedByName: string;
  readonly reviewUrl: string;
}

export function ConfigSubmittedEmail(props: ConfigSubmittedData): ReactElement {
  return (
    <Layout
      label="Review Required"
      preview={`${props.submittedByName} submitted a layout for approval`}
    >
      <Heading style={h2Style()}>Layout Awaiting Review</Heading>
      <Text style={paragraphStyle}>
        <strong>{props.submittedByName}</strong> has submitted a layout for approval.
      </Text>
      <EventMetaTable data={props} />
      <Section style={{ marginTop: 20 }}>
        <Button href={props.reviewUrl} style={buttonStyle}>
          Open Review
        </Button>
      </Section>
      <Text style={{ fontSize: 12, color: INK_MUTED, marginTop: 24 }}>
        Approving will freeze the layout snapshot and notify the hallkeeper.
      </Text>
    </Layout>
  );
}

export async function configSubmitted(
  data: ConfigSubmittedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Layout submitted for approval — ${data.eventName}`;
  const html = await render(<ConfigSubmittedEmail {...data} />);
  return { subject, html };
}

// --- configApproved ---

export interface ConfigApprovedData extends ConfigReviewCommon {
  readonly approvedByName: string;
  readonly approvedAt: string;
  readonly hallkeeperUrl: string;
  readonly editorUrl: string;
  readonly note: string | null;
}

export function ConfigApprovedEmail(props: ConfigApprovedData): ReactElement {
  return (
    <Layout
      label="Approved"
      preview={`Your layout for ${props.eventName} has been approved`}
    >
      <Heading style={h2Style("#059669")}>Layout Approved</Heading>
      <Text style={paragraphStyle}>
        <strong>{props.approvedByName}</strong> has approved your layout for{" "}
        <strong>{props.eventName}</strong>.
      </Text>
      <EventMetaTable
        data={props}
        extra={[{ label: "Approved", value: props.approvedAt }]}
      />
      {props.note !== null && props.note !== "" &&
        noteCallout("success", "Approver note", props.note)}
      <Text style={paragraphStyle}>
        The hallkeeper now sees this layout as the source of truth. Any edits
        you make after this point will require a new submission to propagate.
      </Text>
      <Section style={{ marginTop: 20 }}>
        <Button href={props.hallkeeperUrl} style={buttonStyle}>
          View Hallkeeper Sheet
        </Button>
        <Link href={props.editorUrl} style={buttonSecondaryStyle}>
          Open Layout
        </Link>
      </Section>
    </Layout>
  );
}

export async function configApproved(
  data: ConfigApprovedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Layout approved — ${data.eventName}`;
  const html = await render(<ConfigApprovedEmail {...data} />);
  return { subject, html };
}

// --- configRejected ---

export interface ConfigRejectedData extends ConfigReviewCommon {
  readonly rejectedByName: string;
  readonly editorUrl: string;
  readonly note: string;
}

export function ConfigRejectedEmail(props: ConfigRejectedData): ReactElement {
  return (
    <Layout
      label="Action Required"
      preview={`Your layout for ${props.eventName} needs attention`}
    >
      <Heading style={h2Style()}>Layout Rejected</Heading>
      <Text style={paragraphStyle}>
        <strong>{props.rejectedByName}</strong> has reviewed your layout for{" "}
        <strong>{props.eventName}</strong> and was unable to approve it in its current form.
      </Text>
      <EventMetaTable data={props} />
      {noteCallout("critical", "Reason from the events team", props.note)}
      <Text style={paragraphStyle}>
        You can revise the layout and submit again, or contact the events team to discuss alternatives.
      </Text>
      <Section style={{ marginTop: 20 }}>
        <Button href={props.editorUrl} style={buttonStyle}>
          Open Layout
        </Button>
      </Section>
    </Layout>
  );
}

export async function configRejected(
  data: ConfigRejectedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Layout needs attention — ${data.eventName}`;
  const html = await render(<ConfigRejectedEmail {...data} />);
  return { subject, html };
}

// --- configChangesRequested ---

export interface ConfigChangesRequestedData extends ConfigReviewCommon {
  readonly requestedByName: string;
  readonly editorUrl: string;
  readonly note: string;
}

export function ConfigChangesRequestedEmail(props: ConfigChangesRequestedData): ReactElement {
  return (
    <Layout
      label="Revisions Requested"
      preview={`Changes requested on your layout for ${props.eventName}`}
    >
      <Heading style={h2Style()}>Revisions Requested</Heading>
      <Text style={paragraphStyle}>
        <strong>{props.requestedByName}</strong> has reviewed your layout for{" "}
        <strong>{props.eventName}</strong> and asked for some revisions before approval.
      </Text>
      <EventMetaTable data={props} />
      {noteCallout("warning", "Requested changes", props.note)}
      <Text style={paragraphStyle}>
        Open the layout in the planner, make your revisions, and resubmit for approval.
        Your planner-authored instructions, contact details, and accessibility notes carry through.
      </Text>
      <Section style={{ marginTop: 20 }}>
        <Button href={props.editorUrl} style={buttonStyle}>
          Revise Layout
        </Button>
      </Section>
    </Layout>
  );
}

export async function configChangesRequested(
  data: ConfigChangesRequestedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Changes requested on your layout — ${data.eventName}`;
  const html = await render(<ConfigChangesRequestedEmail {...data} />);
  return { subject, html };
}

// --- hallkeeperNotified ---

export interface HallkeeperNotifiedData extends ConfigReviewCommon {
  readonly eventDate: string | null;
  readonly hallkeeperUrl: string;
}

export function HallkeeperNotifiedEmail(props: HallkeeperNotifiedData): ReactElement {
  return (
    <Layout
      label="New Event"
      preview={`New event approved for ${props.venueName} — ${props.eventName}`}
    >
      <Heading style={h2Style()}>New Event Approved</Heading>
      <Text style={paragraphStyle}>A new event layout has been approved and is ready for you.</Text>
      <EventMetaTable
        data={props}
        extra={[{ label: "Date", value: props.eventDate }]}
      />
      <Text style={{ ...paragraphStyle, marginTop: 16 }}>
        Your sheet includes the furniture manifest, technical requirements,
        accessibility callouts, dietary summary, and door schedule — everything
        you need to prep and run the event.
      </Text>
      <Section style={{ marginTop: 20 }}>
        <Button href={props.hallkeeperUrl} style={buttonStyle}>
          Open Hallkeeper Sheet
        </Button>
      </Section>
      <Hr style={{ marginTop: 24, borderColor: "#eee" }} />
    </Layout>
  );
}

export async function hallkeeperNotified(
  data: HallkeeperNotifiedData,
): Promise<{ subject: string; html: string }> {
  const subject = `Event approved for ${data.venueName} — ${data.eventName}`;
  const html = await render(<HallkeeperNotifiedEmail {...data} />);
  return { subject, html };
}

// ---------------------------------------------------------------------------
// holdDecisionReminder — sent to the member of staff who owns a provisional
// booking, 7, 3 and 1 days before its decision date (Diary hold hygiene,
// T-527; wording and House styling T-619). Never sent to the client.
//
// Blake's hold words only: "Provisional", "1st option", "2nd option",
// "Joint 1st", "Confirmed". The internal vocabulary (pencil, ink, prospect,
// ladder position, "hold decision", "Joint hold") never reaches a person.
// Plain and factual: no praise, no exclamation marks. It says what the owner
// can do and what has NOT happened — nothing in the Diary changed and the
// client was not emailed — because an email that implies an action was
// taken on someone's behalf is worse than no email.
//
// Styled in the House workspace register (WORKSPACE_COLOURS, the values the
// web declares as --house-*): an ivory sheet, ink text, an amber status chip
// ("pending elsewhere"), a forest button with its own light ink, and a serif
// heading with a Georgia fallback for mail clients (design system §5.3).
// ---------------------------------------------------------------------------

export interface HoldDecisionReminderData {
  readonly holdTitle: string;
  readonly spaceName: string;
  /** The hold owner's display name; null or empty renders without a salutation. */
  readonly ownerName: string | null;
  /** The date the provisional booking holds, e.g. "Saturday 14 November 2026". */
  readonly holdDate: string;
  /** The decision date, e.g. "Friday 2 October 2026". */
  readonly decisionDate: string;
  /** Whole venue-local days from the day this is sent to the decision date:
   *  0 is today, 1 tomorrow. Worded from the calendar, not the schedule
   *  stage, because a daily run can deliver a T-1 reminder on the day. */
  readonly daysUntilDecision: number;
  readonly rank: number | null;
  readonly jointFlag: boolean;
  readonly diaryUrl: string;
}

function ordinalRank(rank: number): string {
  const suffix =
    rank % 100 >= 11 && rank % 100 <= 13
      ? "th"
      : rank % 10 === 1
        ? "st"
        : rank % 10 === 2
          ? "nd"
          : rank % 10 === 3
            ? "rd"
            : "th";
  return `${String(rank)}${suffix}`;
}

/** The hold's standing in Blake's words: "Provisional · 1st option",
 *  "Provisional · Joint 1st", or plain "Provisional" when no option is set. */
export function provisionalStatus(rank: number | null, jointFlag: boolean): string {
  if (rank === null) return "Provisional";
  if (rank === 1 && jointFlag) return "Provisional · Joint 1st";
  return `Provisional · ${ordinalRank(rank)} option`;
}

/** "today", "tomorrow" or "in 7 days". */
export function decisionWhen(daysUntilDecision: number): string {
  if (daysUntilDecision <= 0) return "today";
  if (daysUntilDecision === 1) return "tomorrow";
  return `in ${String(daysUntilDecision)} days`;
}

const HOUSE = WORKSPACE_COLOURS;

const houseBodyStyle: CSSProperties = {
  margin: 0,
  padding: "24px 12px",
  background: HOUSE["ground-plane"],
  fontFamily: WORKSPACE_FONTS.sans,
};

const houseSheetStyle: CSSProperties = {
  maxWidth: 560,
  width: "100%",
  margin: "0 auto",
  background: HOUSE.sheet,
  border: `1px solid ${HOUSE.rule}`,
  borderRadius: 10,
  overflow: "hidden",
};

const houseBandStyle: CSSProperties = {
  background: HOUSE.overlay,
  borderBottom: `1px solid ${HOUSE.rule}`,
  padding: "16px 24px",
};

const houseWordmarkStyle: CSSProperties = {
  margin: 0,
  display: "inline",
  fontFamily: WORKSPACE_FONTS.serif,
  fontSize: 18,
  letterSpacing: "0.08em",
  color: HOUSE["ink-1"],
};

const houseCaptionStyle: CSSProperties = {
  margin: "0 0 0 12px",
  display: "inline",
  fontSize: 13,
  color: HOUSE["ink-3"],
};

const houseHeadingStyle: CSSProperties = {
  margin: "0 0 12px",
  fontFamily: WORKSPACE_FONTS.serif,
  fontSize: 24,
  fontWeight: 500,
  lineHeight: 1.25,
  color: HOUSE["ink-1"],
};

const houseTextStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  lineHeight: 1.55,
  color: HOUSE["ink-2"],
};

const houseFactLabelStyle: CSSProperties = {
  padding: "6px 12px 6px 0",
  width: 120,
  verticalAlign: "top",
  fontSize: 13,
  color: HOUSE["ink-3"],
};

const houseFactValueStyle: CSSProperties = {
  padding: "6px 0",
  fontSize: 14,
  color: HOUSE["ink-1"],
};

const houseChipStyle: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  background: HOUSE["amber-wash"],
  color: HOUSE["amber-chip"],
  fontSize: 13,
};

const houseButtonStyle: CSSProperties = {
  padding: "12px 20px",
  background: HOUSE.forest,
  color: HOUSE["forest-ink-1"],
  textDecoration: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
};

const houseFooterStyle: CSSProperties = {
  padding: "14px 24px",
  borderTop: `1px solid ${HOUSE.rule}`,
  fontSize: 12,
  lineHeight: 1.5,
  color: HOUSE["ink-3"],
};

/** One row of the facts table: a bare <tr>. react-email's <Row> renders a
 *  whole <table>, and a table inside a <tbody> is invalid HTML that a
 *  browser repairs by closing the surrounding tables early — which pushed
 *  the closing text and button out of the sheet's padding and the footer out
 *  of the sheet. */
function HouseFact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <tr>
      <td style={houseFactLabelStyle}>{label}</td>
      <td style={houseFactValueStyle}>{children}</td>
    </tr>
  );
}

export function HoldDecisionReminderEmail(props: HoldDecisionReminderData): ReactElement {
  const when = decisionWhen(props.daysUntilDecision);
  const name = props.ownerName?.trim() ?? "";
  return (
    <Html lang="en-GB">
      <Head />
      <Preview>{`${props.holdTitle}, ${props.spaceName}: decision date ${when}.`}</Preview>
      <Body style={houseBodyStyle}>
        <Container style={houseSheetStyle}>
          <Section style={houseBandStyle}>
            <Text style={houseWordmarkStyle}>VENVIEWER</Text>
            <Text style={houseCaptionStyle}>The Diary</Text>
          </Section>
          <Section style={{ padding: "24px 24px 8px" }}>
            {/* Whole sentences as single strings, so the HTML carries each
                one as a single text node rather than fragments separated by
                React's comment markers. */}
            {name === "" ? null : <Text style={houseTextStyle}>{`Hi ${name},`}</Text>}
            <Heading style={houseHeadingStyle}>{`Decision date ${when}`}</Heading>
            <Text style={houseTextStyle}>
              {`A provisional booking you own reaches its decision date ${when}.`}
            </Text>
            <table cellPadding={0} cellSpacing={0} style={{ width: "100%", margin: "8px 0 16px" }}>
              <tbody>
                <HouseFact label="Booking">{props.holdTitle}</HouseFact>
                <HouseFact label="Room">{props.spaceName}</HouseFact>
                <HouseFact label="Date">{props.holdDate}</HouseFact>
                <HouseFact label="Status">
                  <span style={houseChipStyle}>{provisionalStatus(props.rank, props.jointFlag)}</span>
                </HouseFact>
                <HouseFact label="Decision date">{props.decisionDate}</HouseFact>
              </tbody>
            </table>
            <Text style={houseTextStyle}>
              Confirm it, release it, or agree a new decision date with the client.
              Nothing in the Diary has changed, and the client has not been emailed.
            </Text>
            <Section style={{ margin: "20px 0 16px" }}>
              <Button href={props.diaryUrl} style={houseButtonStyle}>
                Open the Diary
              </Button>
            </Section>
          </Section>
          <Section style={houseFooterStyle}>
            You receive this because you own this provisional booking in the Diary.
            Reminders go 7, 3 and 1 days before a decision date.
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function holdDecisionReminder(
  data: HoldDecisionReminderData,
): Promise<{ subject: string; html: string }> {
  const subject = `Decision date ${decisionWhen(data.daysUntilDecision)} — ${data.holdTitle}, ${data.spaceName}`;
  const html = await render(<HoldDecisionReminderEmail {...data} />);
  return { subject, html };
}
