# Reception Room private exact-package preview — 2026-07-14

## Plain-language result

Yes, computer vision was used.

It examined all 14 failed geometry views beside matching passing views. It
found three practical failure types:

- four views do not contain enough geometry edges in one part of the picture;
- seven downward views contain repeating floorboards and a large low-detail
  centre; and
- three views are dominated by repeated curtain folds and differences between
  what the camera and laser can see.

It did **not** find one global wrong rotation or calibration change that would
safely fix every view. The frozen result therefore stays negative at 82 passes
out of 96 views. The failed views must not be relabelled or reused as fresh
held-out evidence.

The next useful step is a controlled visual comparison of the real runtime
packages. The product now has the local code for that comparison: a signed-in
platform administrator can open one exact private runtime-package ID without
publishing it, changing the public room, or silently receiving a different
package.

**Not live yet:** this feature exists in local code only. It cannot be used
until the reviewed code and required database migration are safely deployed and
an exact candidate is registered. None of those actions happened during this
work.

## How a human uses it

This works only after the candidate has been registered as a new immutable
`internal_ready` runtime package. Here, `internal_ready` means privately
reviewable, not public. Registration is a separate controlled step; it was
**not** performed during this work.

1. Sign in with a platform-administrator account.
2. Copy the value named `receipt.packageId` from the candidate-registration
   receipt.
3. Open this address, replacing both placeholders:

   ```text
   https://<VENVIEWER_HOST>/admin/runtime-package-previews/<PACKAGE_UUID>/view
   ```

4. Read the fixed notice in the lower-left corner.

The notice shows the exact package ID and one of three clear states:

- the exact package is loading;
- the exact package is loaded; or
- the exact package failed, the normal photograph is shown, and nothing else
  was substituted.

The notice also says that this screen cannot publish or replace the public
room.

## What the software now does

The browser first asks for metadata for the exact UUID in the address. The API
accepts only a content-identified package whose status is `internal_ready` or
`published`, whose evidence is not rejected, and whose complete visual
composition can be resolved in the order declared by its manifest.

The metadata contains package identity, manifest, status, ordered asset IDs,
filenames, file sizes and SHA-256 fingerprints. It contains no R2 key, storage
path, direct object URL, signed URL, session token or other reusable access
credential.

The immutable package manifest also carries an ordered receipt for each visual
member: asset ID, filename, extension, size, byte fingerprint and a SHA-256 of
the server-only storage key. The package fingerprint covers those receipts.
On every preview read, the API recalculates the package fingerprint and compares
the receipts with the current database rows. Changing an asset row therefore
cannot silently change what an existing package ID means.

For every file, the browser makes a new authenticated request. The server
repeats the platform-admin check, re-resolves the exact package, checks exact
manifest membership, and requires the asset ID and filename to agree. It then
reads the protected R2 object into a bounded verifier, checks the complete
SHA-256 fingerprint, and only after a match returns the file to Spark. A file
with the right name and size but different bytes is rejected.

For this Reception comparison, each member is limited to 16 MiB. At most four
verified transfers may retain a response buffer at once, which matches the
four-file frontier. A single preallocated buffer is used per transfer, and an
upstream read is cancelled after 60 seconds. Extra simultaneous requests get a
clear temporary-busy response instead of causing unbounded memory growth.

The response is marked private and `no-store`. The access token stays in the
HTTP authorization header, never in the URL. The browser cancels the request
when a layer is removed, when a route changes, or when Spark rejects the file.
The API also cancels the upstream object-store request when the browser closes
the connection.

The ordinary public routes remain separate. They still accept only
`published` packages. A route-level test seeds an `internal_ready` package and
proves that it is absent from:

- the public latest-package response;
- the public room-visual response; and
- the public runtime-byte route.

## Exact candidate support

The private page now recognizes two separate audited profiles. It does not
accept a package merely because four filenames look right. For every member it
checks the ordered asset ID, filename, extension, byte count and SHA-256. It
also checks the hashed storage identity and the exact hierarchy basis recorded
inside the immutable package receipt.

The Quality SOG profile is:

- `0_15_0_0.sog`
- `0_1_0_5.sog`
- `0_6_0_0.sog`
- `0_7_0_0.sog`

The Mobile SPZ profile is:

- `0_13_0_0.spz`
- `0_3_0_0.spz`
- `0_7_0_1.spz`
- `0_8_0_0.spz`

The Mobile profile is backed by a separate read-only registration preflight.
It rereads the actual `Reception Room Mobile.lcc2` manifest, validates every
declared SPZ container, requires the authoritative receipt
`sha256:c897dd55fd8efc5397a76d96572a654058defd232f10767b1827fe684e7b6357`,
and checks all seven existing asset records in the configured database. A
read-only dry run against that database and the local LCC2/SPZ files passed the
payload checks and produced candidate content digest
`9d35c8cf339e618e68349d637199f9200019dd4fcabee6ffb6be72172f88dc93`.
It made no write and downloaded no R2 bytes. Its separate database-contract
check correctly reports `databaseReady: false`: migration 0052's three columns,
four constraints and four safety triggers are all absent.

## What was verified

The latest focused checks passed:

- shared types: 53 focused tests, build and type-check;
- API preview, receipt admission, both candidate preflights, revision
  integrity, public-boundary and asset routes: 127 focused tests and type-check;
- web API, Spark cleanup, package selection, scene rendering, route guard and
  page copy: 62 focused tests and type-check.

Independent reviews tried to break the exact-package, authorization,
byte-integrity, memory-bound, public/private and Mobile-registration boundaries.
They found three low-priority provenance/readiness/instruction issues. All three
were corrected: the Mobile timestamp is historical rather than future-dated,
both preflights now block creation when migration 0052 is absent, and the
retired command prints complete copyable dry-run replacements.
A final independent re-audit found no remaining priority-0 through priority-3
issue.

The final full shared-types run passed 2,078 tests across 90 files. The final
full web run passed 3,121 tests across 260 files. The final full API run passed
2,508 individual tests across 127 files; six tests failed across six other
files. Those six are the already-known Foundry migration-tail assertions whose
fixed end-of-journal positions do not yet account for the existing
`0058_foundry_derivative_activation_disabled` migration. None exercises this
preview or preflight path. The API build passed. The web production build
stopped at its intentional safety gate because no `pk_live_...` Clerk key was
provided; type-check and the full web test suite passed, and no credential was
invented or bypassed.

Fresh browser checks also showed:

- `/living-hall` still loads its ordinary development preview, displays no
  private-review notice, and produced no console errors or warnings in a fresh
  tab; and
- a signed-out visit to the private admin path is redirected to `/login`
  before the private page mounts.

No real signed-in package was streamed from the configured database and R2 during
this work because no new candidate registration, object-store change or live
deployment was authorized. A separate read-only database check found nine
pending migrations (`0050`–`0058`), including required migration
`0052_runtime_package_revisions`; the migration preflight returned
`safeToApplyProduction: false`. Therefore neither candidate may be registered
yet.

## What this proves—and what it does not

This proves that the local product has a fail-closed delivery path for a named
private package and that its registered bytes are checked before Spark receives
them.

It does not prove that:

- the Quality candidate is registered in the configured database and present at the
  registered R2 keys;
- the Mobile SPZ candidate has an immutable package registration;
- either candidate looks better;
- either candidate is fast enough on desktop or mobile;
- the room transform is metrically reviewed;
- the source or derivatives are cleared for public distribution; or
- the public package should change.

No file was uploaded, no candidate was registered, no raw source was changed,
no training or paid compute ran, and no public pointer was changed.

## Exact next A/B

1. Do **not** run either command with `--apply` yet. The configured database is
   missing the immutable-revision migration and the complete migration-tail
   preflight is not approved for production. Do not cherry-pick migration 0052.
2. Have an engineer review and resolve the normal ordered migration/deployment
   plan. Deployment and database migration require separate operator approval.
3. After the matching API and database are safely deployed, rerun both dry-run
   preflights. The Quality check verifies pinned database rows and audited local
   files. The Mobile check verifies the `.lcc2` hierarchy, all declared local
   containers and all seven database rows. Neither dry run downloads R2 bytes.
4. With explicit approval, create Quality and Mobile as two separate immutable
   `internal_ready` revisions and retain each `receipt.packageId`. Do not use the
   retired `assets:register-reception-room-spz-runtime` command. Do not publish.
5. Open each candidate through its own exact private URL. The first private
   stream is the step that downloads and fully hashes the protected R2 bytes.
   Never use “latest”
   for this comparison.
6. On the same desktop and mobile devices, use native device-pixel ratio, the
   same Spark settings, and the same saved camera stations. Record first-load
   bytes and time, steady frame rate, long frames, memory, holes, seams,
   ghosting and fine-detail sharpness.
7. The current exact page accepts only the audited Quality-fine and Mobile-fine
   profiles. Keep the historical all-level and coarse controls in the existing
   fixture. Before capturing any control through the actual private route, add
   and test a separately audited exact profile for that control. Do not register
   a control as one of the two main candidates.
8. Give reviewers images with neutral labels so they do not know which source
   they are judging. Record both visual preference and technical failures.
9. Keep the public pointer unchanged unless one candidate passes the visual,
   performance, transform, provenance, rights and human-review gates.

Computer vision should be used again for aligned difference maps, repeated-edge
counts, hole/seam masks and sharpness measurements. Human review remains
necessary because a metric cannot decide whether a room looks believable or
whether a visible defect is acceptable.
