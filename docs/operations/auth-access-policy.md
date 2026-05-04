# Auth Access Policy

Venviewer treats authentication and authorization as separate gates. A valid
Clerk session proves identity; it does not grant planner access by itself.

## User creation policy

The API may create or link a local `users` row only when one of these is true:

- A pre-provisioned local user row already exists for the verified email.
- A pending `user_invitations` record matches the verified email or email domain.
- An approved-domain policy is explicitly configured in environment variables.

Missing email, invalid email, and unverified email fail closed. The Clerk JWT
template must include an explicit verified-email claim, such as
`email_verified=true` or a supported `*_verification_status=verified` claim.

## Invitation records

`user_invitations` records carry the authorized email/domain, role, optional
venue scope, expiry, and acceptance audit fields. When an invitation creates a
local user, the API marks the invitation `accepted` and records `accepted_at`
and `accepted_by`.

## Approved-domain policy

Domain approval is disabled unless configured. The supported environment
variables are:

- `VENVIEWER_APPROVED_AUTH_DOMAINS`: comma-separated email domains.
- `VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE`: role for domain-approved users,
  defaulting to `planner`.
- `VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID`: optional venue scope.

Use invitation records as the primary production path. Domain approval is for
explicit, reviewed venue/staff domains only; never configure a broad public
email domain.
