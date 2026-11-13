import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { Check, Copy, Send } from "lucide-react";
import {
  EmailSchema,
  VENUE_TEAM_ROLE_LABELS,
  VENUE_TEAM_ROLE_SUMMARIES,
  VENUE_TEAM_ROLES,
  type UserRole,
  type VenueTeam,
  type VenueTeamEmailDelivery,
  type VenueTeamInvitation,
  type VenueTeamMember,
  type VenueTeamRole,
} from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { cancelVenueTeamInvitation, getVenueTeam, inviteVenueTeamMember } from "../../api/venue-team.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./TeamView.css";

// ---------------------------------------------------------------------------
// The Team (Plan 19 L1: "venue admins invite their own staff"). A venue
// administrator sees who has access, invites a person by email with a role,
// and cancels an invitation not yet used. The grant is accepted when that
// email signs up and verifies, so every outcome says how the person joins.
// The API (routes/venue-team.ts) words its refusals for people: they are
// shown as given.
// ---------------------------------------------------------------------------

type Load =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly words: string | null }
  | { readonly status: "ready"; readonly team: VenueTeam; readonly refreshing: boolean; readonly refreshFailed: boolean };

interface Outcome {
  readonly key: number;
  readonly email: string;
  readonly delivery: VenueTeamEmailDelivery;
}

interface Notice {
  readonly tone: "settled" | "alert";
  readonly text: string;
}

/** Clients & access may record a grant for the venue's customers too; those
 *  wait here under the names that screen gives them. */
const CUSTOMER_ROLE_LABELS: Readonly<Record<Exclude<UserRole, VenueTeamRole>, string>> = {
  client: "Client",
  planner: "Planner",
};

function isTeamRole(role: UserRole): role is VenueTeamRole {
  return VENUE_TEAM_ROLES.some((teamRole) => teamRole === role);
}

function roleLabel(role: UserRole): string {
  return isTeamRole(role) ? VENUE_TEAM_ROLE_LABELS[role] : CUSTOMER_ROLE_LABELS[role];
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

function day(iso: string): string {
  return DAY.format(new Date(iso));
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A refusal the API answered in words (4xx); anything else is not its copy. */
function refusalWords(error: unknown): string | null {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 ? error.message : null;
}

export function TeamView(): ReactElement {
  const venueId = useAuthStore((state) => state.user?.venueId ?? null);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const platformAdmin = useAuthStore((state) => state.user?.platformRole === "admin");

  if (venueId === null) {
    return (
      <div className="team" data-register="ivory">
        <div className="team__sheet">
          <h1 className="team__title">Team</h1>
          <p className="team__lede">
            {platformAdmin
              ? "This account is not connected to a venue, so there is no team to show here. Clients & access manages each venue's access."
              : "Your account has no venue yet, so there is no team to show. Ask an administrator to link one."}
          </p>
        </div>
      </div>
    );
  }
  return <TeamWorkspace key={venueId} venueId={venueId} viewerId={viewerId} />;
}

function TeamWorkspace({ venueId, viewerId }: { readonly venueId: string; readonly viewerId: string | null }): ReactElement {
  const [reloads, setReloads] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  // The first read starts from nothing; a read after a change keeps the list
  // on screen while it refreshes. A newer read always replaces an older one.
  useEffect(() => {
    const controller = new AbortController();
    setLoad((previous) => previous.status === "ready" ? { ...previous, refreshing: true, refreshFailed: false } : { status: "loading" });
    getVenueTeam(venueId, controller.signal)
      .then((team) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", team, refreshing: false, refreshFailed: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad((previous) => previous.status === "ready"
          ? { ...previous, refreshing: false, refreshFailed: true }
          : { status: "error", words: refusalWords(error) });
      });
    return () => { controller.abort(); };
  }, [venueId, reloads]);

  const refresh = (): void => { setReloads((count) => count + 1); };

  // A change shows at once; the list is then read again for anything else
  // it touched (sending again replaces that email's open invitation).
  const invited = (invitation: VenueTeamInvitation): void => {
    setLoad((previous) => previous.status !== "ready" ? previous : {
      ...previous,
      team: {
        ...previous.team,
        invitations: [invitation, ...previous.team.invitations.filter((open) => open.id !== invitation.id && !sameEmail(open.email, invitation.email))],
      },
    });
    refresh();
  };
  const cancelled = (invitationId: string): void => {
    setLoad((previous) => previous.status !== "ready" ? previous : {
      ...previous,
      team: { ...previous.team, invitations: previous.team.invitations.filter((open) => open.id !== invitationId) },
    });
    refresh();
  };

  if (load.status !== "ready") {
    return (
      <div className="team" data-register="ivory">
        <div className="team__sheet">
          <h1 className="team__title">Team</h1>
          {load.status === "error" ? (
            <div className="team-state" role="alert">
              <p className="team-state__lead">The team could not be loaded. Nothing has changed.</p>
              {load.words !== null && <p className="team-state__detail">{load.words}</p>}
              <button type="button" className="team-button" onClick={refresh}>Try again</button>
            </div>
          ) : <ActivityStatus variant="panel" className="team-state">Loading the team…</ActivityStatus>}
        </div>
      </div>
    );
  }

  const { team } = load;
  return (
    <div className="team" data-register="ivory">
      <div className="team__sheet">
        <header className="team__head">
          <h1 className="team__title">Team</h1>
          <p className="team__lede">Everyone with access to this venue, and the people invited to join it.</p>
          <div className="team__bar">
            <dl className="team__plane ws-plane" aria-label="The team in numbers">
              <div><dt>Has access</dt><dd>{team.members.length}</dd></div>
              <div><dt>Waiting to join</dt><dd>{team.invitations.length}</dd></div>
            </dl>
            {load.refreshing && <ActivityStatus className="team__refreshing">Updating the list…</ActivityStatus>}
          </div>
        </header>

        {load.refreshFailed && (
          <div className="team-notice" data-tone="alert" role="alert">
            <span>The list could not be read again, so it shows the team as last loaded.</span>
            <button type="button" className="team-link" onClick={refresh}>Try again</button>
          </div>
        )}

        <InviteForm venueId={venueId} team={team} onInvited={invited} onUncertain={refresh} />
        <WaitingList venueId={venueId} invitations={team.invitations} onCancelled={cancelled} onStale={refresh} />
        <MemberList members={team.members} viewerId={viewerId} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inviting someone
// ---------------------------------------------------------------------------

interface InviteFormProps {
  readonly venueId: string;
  readonly team: VenueTeam;
  readonly onInvited: (invitation: VenueTeamInvitation) => void;
  /** The send's fate is unknown (no reply, or one that could not be read):
   *  the list is read again so it shows what was recorded. */
  readonly onUncertain: () => void;
}

/** 4xx: the API refused in words and recorded nothing. Anything else leaves
 *  the outcome unknown, so the page says so rather than guessing. */
function inviteFailure(error: unknown): { readonly message: string; readonly uncertain: boolean } {
  const words = refusalWords(error);
  if (words !== null) return { message: words, uncertain: false };
  if (!(error instanceof ApiError)) return { message: "The invitation could not be sent. Nothing was recorded.", uncertain: false };
  return { message: "The invitation could not be confirmed. It may have been recorded, so check the list below before sending again.", uncertain: true };
}

function InviteForm({ venueId, team, onInvited, onUncertain }: InviteFormProps): ReactElement {
  const id = useId();
  const emailId = `${id}-email`;
  const emailErrorId = `${id}-email-error`;
  const emailHintId = `${id}-email-hint`;
  const roleErrorId = `${id}-role-error`;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<VenueTeamRole | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const lock = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstRoleRef = useRef<HTMLInputElement>(null);

  // What the list already says about the address typed, before anything is sent.
  const typed = email.trim();
  const member = typed === "" ? undefined : team.members.find((person) => sameEmail(person.email, typed));
  const waiting = typed === "" ? undefined : team.invitations.find((open) => sameEmail(open.email, typed));
  const hint = member !== undefined
    ? `${member.email} already has access as ${roleLabel(member.role)}.`
    : waiting !== undefined
      ? `${waiting.email} is already waiting to join as ${roleLabel(waiting.role)}. Sending again replaces that invitation.`
      : null;
  const emailDescription = [emailError === null ? null : emailErrorId, hint === null ? null : emailHintId].filter((part) => part !== null).join(" ");

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current) return;
    const parsed = EmailSchema.safeParse(email);
    const nextEmailError = typed === "" ? "Enter the email address they will sign up with."
      : parsed.success ? null : "Enter a whole email address, such as name@example.com.";
    const nextRoleError = role === null ? "Choose what they can open at the venue." : null;
    setEmailError(nextEmailError);
    setRoleError(nextRoleError);
    if (!parsed.success) { emailRef.current?.focus(); return; }
    if (role === null) { firstRoleRef.current?.focus(); return; }

    lock.current = true;
    setSending(true);
    setFailure(null);
    setOutcome(null);
    try {
      const result = await inviteVenueTeamMember(venueId, { email: parsed.data, role });
      onInvited(result.invitation);
      setOutcome((previous) => ({ key: (previous?.key ?? 0) + 1, email: result.invitation.email, delivery: result.emailDelivery }));
      setEmail("");
      setRole(null);
    } catch (error: unknown) {
      const { message, uncertain } = inviteFailure(error);
      setFailure(message);
      if (uncertain) onUncertain();
    } finally {
      lock.current = false;
      setSending(false);
    }
  };

  return (
    <section className="team-invite" aria-labelledby={`${id}-title`}>
      <form className="team-invite__panel" data-register="forest" noValidate
        onSubmit={(event) => { void submit(event); }}>
        <h2 className="team-invite__title" id={`${id}-title`}>Invite someone</h2>

        <div className="team-field">
          <label className="team-field__label" htmlFor={emailId}>Email address</label>
          <input ref={emailRef} id={emailId} className="team-field__input" type="email" required
            autoComplete="off" spellCheck={false} value={email}
            aria-invalid={emailError !== null}
            aria-describedby={emailDescription === "" ? undefined : emailDescription}
            onChange={(event) => { setEmail(event.target.value); setEmailError(null); }} />
          {emailError !== null && <p className="team-field__error" id={emailErrorId} role="alert">{emailError}</p>}
          {hint !== null && <p className="team-field__hint" id={emailHintId}>{hint}</p>}
        </div>

        <fieldset className="team-roles">
          <legend className="team-field__label">Role</legend>
          <div className="team-roles__options">
            {VENUE_TEAM_ROLES.map((option, index) => (
              <label key={option} className="team-role">
                <input ref={index === 0 ? firstRoleRef : undefined} type="radio" name={`${id}-role`} value={option}
                  checked={role === option}
                  aria-labelledby={`${id}-${option}-label`}
                  aria-describedby={roleError === null ? `${id}-${option}-summary` : `${id}-${option}-summary ${roleErrorId}`}
                  onChange={() => { setRole(option); setRoleError(null); }} />
                <span className="team-role__label" id={`${id}-${option}-label`}>{VENUE_TEAM_ROLE_LABELS[option]}</span>
                <span className="team-role__summary" id={`${id}-${option}-summary`}>{VENUE_TEAM_ROLE_SUMMARIES[option]}</span>
              </label>
            ))}
          </div>
          {roleError !== null && <p className="team-field__error" id={roleErrorId} role="alert">{roleError}</p>}
        </fieldset>

        <div className="team-invite__send">
          <p className="team-invite__consequence">Their access is recorded and an email goes to this address. They join by signing up with it.</p>
          <button type="submit" className="team-button team-button--primary team-invite__button"
            aria-busy={sending} aria-disabled={sending}>
            {sending ? <ActivityIndicator size={18} /> : <Send aria-hidden="true" size={17} />}
            {sending ? "Sending invitation…" : "Send invitation"}
          </button>
        </div>
        {failure !== null && <p className="team-invite__failure" role="alert">{failure}</p>}
      </form>

      <InviteOutcome outcome={outcome} />
    </section>
  );
}

const OUTCOME_REASON: Readonly<Record<Exclude<VenueTeamEmailDelivery, "sent">, string>> = {
  not_configured: "this site is not sending email yet",
  not_sent: "the email did not go out",
};

/** One plain line on what became of the invitation. The line's region stays
 *  mounted so a screen reader hears each new outcome. */
function InviteOutcome({ outcome }: { readonly outcome: Outcome | null }): ReactElement {
  const sent = outcome?.delivery === "sent";
  return (
    <div className={`team-outcome${outcome === null ? " team-outcome--empty" : ""}`}
      data-tone={outcome === null ? undefined : sent ? "settled" : "attention"}>
      <p className="team-outcome__line" role="status">
        {outcome === null ? null : outcome.delivery === "sent" ? (
          <>The invitation went to <strong>{outcome.email}</strong>. They join by signing up with that address.</>
        ) : (
          <>Access is recorded for <strong>{outcome.email}</strong>, but {OUTCOME_REASON[outcome.delivery]}. Share the sign-up link with them; they join by signing up with that address.</>
        )}
      </p>
      {outcome !== null && !sent && <SignUpLink key={outcome.key} />}
    </div>
  );
}

function SignUpLink(): ReactElement {
  const id = useId();
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const link = `${window.location.origin}/register`;
  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };
  return (
    <div className="team-signup">
      <label className="team-signup__label" htmlFor={id}>Sign-up link</label>
      <div className="team-signup__row">
        <input id={id} className="team-signup__field" value={link} readOnly
          onFocus={(event) => { event.currentTarget.select(); }} />
        <button type="button" className="team-button" onClick={() => { void copyLink(); }}>
          {copy === "copied" ? <Check aria-hidden="true" size={17} /> : <Copy aria-hidden="true" size={17} />}
          {copy === "copied" ? "Link copied" : "Copy link"}
        </button>
      </div>
      <span className="team-sr-only" role="status">{copy === "copied" ? "Link copied" : ""}</span>
      {copy === "failed" && <p className="team-signup__failed" role="alert">Copying is not available here. Select the link and copy it.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting to join
// ---------------------------------------------------------------------------

interface WaitingListProps {
  readonly venueId: string;
  readonly invitations: readonly VenueTeamInvitation[];
  readonly onCancelled: (invitationId: string) => void;
  /** The list no longer matches the venue (already used, cancelled elsewhere,
   *  or a cancel whose fate is unknown): read it again. */
  readonly onStale: () => void;
}

function cancelFailure(error: unknown, email: string): { readonly message: string; readonly stale: boolean } {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return { message: error.message, stale: error.status === 404 || error.code === "INVITATION_NOT_PENDING" };
  }
  return { message: `The invitation for ${email} could not be cancelled. It may still be open, so the list has been read again.`, stale: true };
}

function WaitingList({ venueId, invitations, onCancelled, onStale }: WaitingListProps): ReactElement {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // The question opens on its safe answer, so Enter keeps the invitation.
  useEffect(() => {
    if (confirming !== null) keepRef.current?.focus();
  }, [confirming]);

  const keep = (invitationId: string): void => {
    setConfirming(null);
    triggers.current.get(invitationId)?.focus();
  };

  const cancel = async (invitation: VenueTeamInvitation): Promise<void> => {
    if (cancelling !== null) return;
    setCancelling(invitation.id);
    setNotice(null);
    try {
      await cancelVenueTeamInvitation(venueId, invitation.id);
      setConfirming(null);
      setNotice({ tone: "settled", text: `The invitation for ${invitation.email} is cancelled.` });
      onCancelled(invitation.id);
      headingRef.current?.focus();
    } catch (error: unknown) {
      const { message, stale } = cancelFailure(error, invitation.email);
      setConfirming(null);
      setNotice({ tone: "alert", text: message });
      triggers.current.get(invitation.id)?.focus();
      if (stale) onStale();
    } finally {
      setCancelling(null);
    }
  };

  const onConfirmKey = (event: KeyboardEvent<HTMLDivElement>, invitationId: string): void => {
    if (event.key !== "Escape" || cancelling !== null) return;
    event.preventDefault();
    keep(invitationId);
  };

  return (
    <section className="team-section" aria-labelledby={`${id}-title`}>
      <h2 className="team-section__title" id={`${id}-title`} ref={headingRef} tabIndex={-1}>Waiting to join</h2>
      {notice !== null && (
        <p className="team-notice" data-tone={notice.tone} role={notice.tone === "alert" ? "alert" : "status"}>{notice.text}</p>
      )}
      {invitations.length === 0 ? (
        <p className="team-empty">No invitations are waiting.</p>
      ) : (
        <ul className="team-list">
          {invitations.map((invitation) => {
            const open = confirming === invitation.id;
            const busy = cancelling === invitation.id;
            const confirmId = `${id}-${invitation.id}-confirm`;
            return (
              <li key={invitation.id} className="team-row">
                <div className="team-row__main">
                  <p className="team-row__primary">{invitation.email}</p>
                  <ul className="team-row__facts">
                    <li className="team-row__role">{roleLabel(invitation.role)}</li>
                    <li>{invitation.invitedByName === null ? "Sender not recorded" : `Invited by ${invitation.invitedByName}`}</li>
                    <li>{invitation.expiresAt === null ? "Open until cancelled" : `Open until ${day(invitation.expiresAt)}`}</li>
                  </ul>
                </div>
                <div className="team-row__action">
                  <button type="button" className="team-button team-button--quiet"
                    ref={(node) => { if (node === null) triggers.current.delete(invitation.id); else triggers.current.set(invitation.id, node); }}
                    aria-label={`Cancel the invitation for ${invitation.email}`}
                    aria-expanded={open} aria-controls={open ? confirmId : undefined}
                    aria-disabled={cancelling !== null}
                    onClick={() => {
                      if (cancelling !== null) return;
                      setNotice(null);
                      setConfirming(open ? null : invitation.id);
                    }}>
                    Cancel
                  </button>
                </div>
                {open && (
                  <div className="team-confirm" id={confirmId} role="group" aria-labelledby={`${confirmId}-question`}
                    onKeyDown={(event) => { onConfirmKey(event, invitation.id); }}>
                    <p className="team-confirm__question" id={`${confirmId}-question`}>Cancel the invitation for {invitation.email}?</p>
                    <p className="team-confirm__consequence">They will no longer be able to join with it. You can invite them again later.</p>
                    <div className="team-confirm__actions">
                      <button type="button" className="team-button team-button--alert" aria-busy={busy} aria-disabled={busy}
                        onClick={() => { void cancel(invitation); }}>
                        {busy && <ActivityIndicator size={16} />}
                        {busy ? "Cancelling…" : "Cancel invitation"}
                      </button>
                      <button type="button" className="team-button" ref={keepRef} disabled={busy}
                        onClick={() => { keep(invitation.id); }}>
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Has access
// ---------------------------------------------------------------------------

function MemberList({ members, viewerId }: { readonly members: readonly VenueTeamMember[]; readonly viewerId: string | null }): ReactElement {
  const id = useId();
  return (
    <section className="team-section" aria-labelledby={`${id}-title`}>
      <h2 className="team-section__title" id={`${id}-title`}>Has access</h2>
      {members.length === 0 ? (
        <p className="team-empty">Nobody has access yet.</p>
      ) : (
        <ul className="team-list">
          {members.map((member) => (
            <li key={member.id} className="team-row">
              <div className="team-row__main">
                <p className="team-row__primary">
                  {member.name}
                  {member.id === viewerId && <span className="team-row__you">You</span>}
                </p>
                <ul className="team-row__facts">
                  <li>{member.email}</li>
                  <li className="team-row__role">{roleLabel(member.role)}</li>
                  <li>Joined {day(member.joinedAt)}</li>
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
