# Trades Hall card selection review

The independent `/trades-hall/cards/` page lets invited staff choose one of the
13 shortlisted business-card designs and leave comments. It is deliberately
separate from event enquiries, venue operations, Clerk and the Railway API.

`api/card-review.js` is a Node Vercel Function. It uses the dedicated
`trades_hall_card_review` Neon database, never the venue application's database.
The runtime role has only schema usage, response SELECT/INSERT/UPDATE and rate
limit SELECT/INSERT/UPDATE/DELETE. It cannot delete responses or create databases.
The schema is recorded in `card-review-schema.sql`; this is not a migration of
the venue database and must not be added to its migration journal.

## HTTP contract

Every request has `Authorization: Bearer <token>`. A respondent's token is 32
cryptographically random bytes encoded as 43 base64url characters, generated in
the browser and retained only on that browser. The server stores its SHA-256
digest. A token identifies one respondent's response, never another's.

- `GET /api/card-review`: `{response: null | Response}` for the caller's token.
- `POST /api/card-review`: body `{reviewerName, favourite, comments,
  generalComment, revision}`. Returns `{response: Response}`.
- `GET /api/card-review?view=all`: owner token only. Returns
  `{responses: Response[], updatedAt}`. The owner token cannot submit responses.

Response fields: `id`, `reviewerName`, `favourite`, `comments`, `generalComment`,
`revision`, `createdAt`, `updatedAt`. Timestamps are ISO strings on the wire.
No session digests or secret values are returned.

Initial POST uses revision 0. An edit supplies the saved revision. Unique insert
and compare-and-swap UPDATE admit one simultaneous write; a stale save receives
409 `STALE_RESPONSE`. The client must reload the saved response before an edit.

Name is required (100 characters). Favourite is null or one of the 13 IDs.
Comments are keyed only by those IDs, with 2,000 characters each. Overall comment
is at most 2,000 characters. At least one favourite or nonempty comment is needed.
Unknown fields, malformed tokens, excessive bodies and invalid designs fail
closed. All API responses prevent caching. Errors expose `{error, code}` only.

POST requires an allowed Origin. Cross-site requests are rejected. Durable
hourly rate limits allow 60 POSTs and 240 GETs per source address; storage holds
only a keyed one-way address digest and removes expired windows on later use.
The deployed adapter trusts Vercel's overwritten `X-Forwarded-For`, as documented
in its [request headers reference](https://vercel.com/docs/headers/request-headers).
No raw IP address is retained in this database. Vercel's platform request logs
are subject to the hosting provider's own retention.

## Environments and recovery

Server environment keys: `CARD_REVIEW_DATABASE_URL`, `CARD_REVIEW_OWNER_TOKEN`,
`CARD_REVIEW_RATE_SECRET`. None have the public `VITE_` prefix. Production and
preview use distinct databases and distinct owner tokens. The private owner
link uses a URL fragment, which does not enter an HTTP request or referrer.

The owner link and credentials are stored outside Git in Blake's local
`deploy-secrets/trades-hall-card-review.json`; never copy them into static assets,
logs, screenshots, documentation or commit messages. The owner should share only
the ordinary selection URL, not the results link. Respondents can reopen/edit in
the same browser; losing browser storage loses that response's edit capability.

Schema changes and production restore remain explicit maintenance operations.
To roll back the page/function, restore the preceding Vercel deployment; this
does not erase existing responses. The separate database retains them.

## Verification

`node packages/web/scripts/verify-card-review.mjs` checks all thirteen selected
design IDs, their preview/proof assets and the form/results files before release.
It also scans public text assets for configured server secret values. This runs
at the start of the web test command without changing the Vite build pipeline.

`node --test packages/web/server/card-review.test.mjs` covers the actual HTTP
handler's validation, ownership, origin, limits and failure responses.

`CARD_REVIEW_TEST_DATABASE_URL=... node --test
packages/web/server/card-review-postgres.test.mjs` covers actual Neon persistence,
concurrent first saves, concurrent edits and rate counting. This suite rejects
every database name except `trades_hall_card_review_test_20261002` and removes
only its own random fixture rows. Never point tests at the production review or
venue database.
