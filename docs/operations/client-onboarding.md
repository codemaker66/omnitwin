# Onboard a Venviewer client

Use [Clients & access](https://venviewer.com/dashboard?view=onboarding) from the
dashboard's **More** menu. This area requires a Venviewer platform administrator.
A venue administrator manages their venue; that role does not grant platform
administration.

## Connect the venue and its first contact

1. Select **Add client**, or use the setup form when no client workspaces exist.
2. For a venue already in Venviewer, choose **Use an existing venue** and select
   its record. This preserves its rooms, bookings and inventory. For a new
   customer venue, choose **Create a new venue** and provide its name, address,
   web address identifier and time zone.
3. Set the client organisation, first administrator's exact email address and
   venue role. Use **Venue administrator** when that person should administer
   the venue. Team and setup options are available in the collapsed section.
4. Save with **Create client workspace**. The contact appears as **Awaiting
   sign-in**. Saving records access; it does not send an email.
5. Share the displayed account link through your normal customer communication.
   The recipient must create or sign in to their own account and verify the
   listed email address. Do not create credentials on their behalf.
6. After their verified sign-in, use **Refresh** and confirm **Account connected**
   beside the expected email and venue role.

For Trades Hall, select its existing **Trades Hall Glasgow** venue record. The
requested first administrator is Elaine Gilchrist,
`elaine@tradeshallglasgow.co.uk`. The implementation and test work did not create
her account, record a production invitation or send her a message.

## Add or maintain access

Choose the client workspace, enter an email under **Give someone access**, select
the venue role and save. Access is matched to the person's verified email when
they next sign in. **Manage access** can prepare a new invitation or renew an
expired invitation. The current invitation lifetime is 30 days.

**Cancel invitation** cancels an invitation awaiting acceptance. It does not
remove a connected account's access. Existing administrator access is preserved
when accepting a weaker invitation; this flow is not an administrator-demotion
or connected-account-removal tool.

One account currently belongs to one venue. If an email already belongs to a
different venue, the system rejects the grant and preserves the original access.
Do not create a duplicate venue or reuse another person's email to work around
that boundary.

## Help a contact finish sign-in

- **Verify your email to continue:** choose **Open account settings**. Under
  **Email addresses**, open the menu beside the invited email and choose
  **Complete verification**. Follow the email link, then return to Venviewer and
  choose **Check my access**. Registration alone does not establish verified
  venue access.
- **Your account is ready / access pending:** confirm the invitation email,
  venue and role, and that the contact verified that same email. They can use
  **Check my access** after the invitation is recorded.
- **Invitation expired:** renew it using **Manage access**, then ask the contact
  to sign in again.
- **We could not confirm your venue access:** retry the access check or use
  **Use another account** to sign in again. An API/service failure is distinct
  from an invitation wait.

Setup review and billing records are separate from identity verification. They
do not send invitations, collect payments or establish that a contact has signed
in. The first release provides platform-managed onboarding; automatic invitation
email, self-service subscription checkout and accounts spanning multiple venues
are separate capabilities.
