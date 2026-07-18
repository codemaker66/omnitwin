# Reconstruction Foundry operator runbook

This runbook begins with the current local multimodal super-app workflow. That
workflow is independent of the later optional release procedure: local intake,
facts, readiness and evidence review do not require an account, remote service,
cloud resource, production database, publication step or release approval.

## Local multimodal super-app workflow (current priority)

### 1. Start the local guided app

From the repository root, point the app at one file or one folder:

```powershell
pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source "F:\path\to\capture-or-folder"
```

The command prints a loopback address for this computer. Add `--open` if a
visible browser launch is wanted, or `--port 43167` to select a fixed local
port. The source remains read-only.

### 2. Read the four evidence stages in order

1. **Universal Intake Receipt** inventories every regular file, fingerprints
   its exact bytes, records format evidence and keeps duplicate content visible.
2. **Universal Source Facts** reports only facts established by the active
   immutable format profile. Format limitations and unresolved facts remain on
   each source card.
3. **Source Readiness** maps observed sources into point, mesh, visual,
   image/video, registration/control, context/evidence, opaque-package and
   unclassified families. This is a family view, not automatic route approval.
4. **Operator Evidence Checklist** turns every unresolved fact and missing
   selected family into a concrete next test.

Download buttons save the canonical JSON for the current fingerprints. If the
source changes, refresh and create a new chain instead of combining old and new
artifacts.

### 3. Interpret quarantine correctly

`quarantined` means the file is inspected but not admitted to a downstream
purpose. It is not a parse failure. For example, a structurally valid SOG may
still have unresolved provenance, rights, frame, units, physical accuracy,
registration and visual-fidelity questions.

An XBIN candidate stops the ordinary Source Facts chain. Use XGRIDS' official
export workflow to obtain SOG, SPZ, PLY, E57, GLB or another documented output;
do not treat the opaque package as decoded evidence.

### 4. Current versioned source facts and limits

Stored-ZIP SOG v2 is covered in Source Facts V1. The inspector checks the exact
member set, stored-member layout, metadata declarations, CRC values, supported
signed data descriptors, RIFF structure, VP8L headers, image dimensions and
declared Gaussian capacity. It does not decode pixels or Gaussian attributes.

The authority-none evidence chain for the current Reception export is:

`docs/reports/reception-room-sog-source-facts-v1-evidence-2026-07-16.json`

That record is structural evidence only. Its unresolved-fact list is part of
the result, not a defect to hide.

SPZ was introduced in Source Facts V2 and remains covered unchanged in the
active V5 chain. For legacy v1-v3 files,
the inspector checks one complete gzip member, CRC, input-size trailer, exact
decompressed header/payload equation, version, Gaussian count, raw fractional
bits byte, antialias flag, spherical-harmonics degree and packed attribute
layout. A declared legacy extension tail is parsed as bounded ILV records. For
v4 it checks the plaintext header, bounded extension records, exact TOC and
every complete independent Zstandard range. It does not decode Gaussian
values; `fractionalBitsRaw` is a literal header byte, not a physical precision
or accuracy claim.

The gzip-header inspection cap is 1 MiB. A larger optional-header area returns
`SPZ_GZIP_HEADER_SIZE_LIMIT_EXCEEDED`, which is a resource limit rather than a
malformed-file claim. Node versions without `createZstdDecompress` can still
load and use the rest of Foundry; v4 inspection returns
`SPZ_V4_ZSTD_RUNTIME_UNAVAILABLE` until run on a supporting Node version.

The canonical digest is a local self-consistency checksum, not authentication
or independent attestation. V2 issuance stays inside the inspected-intake
entrypoint and the artifact explicitly retains `authority: none`.

The authority-none chain for the eight current Reception SPZ files is:

`docs/reports/reception-room-spz-source-facts-v2-evidence-2026-07-17.json`

All eight establish SPZ v3 structure. Units, venue frame, renderer
compatibility, visual fidelity, provenance, accuracy, registration and usage
rights remain unresolved. Treat those unknowns as real next tests, not as
reasons to discard otherwise useful local structural evidence.

Classic Gaussian PLY was introduced in Source Facts V3 and remains covered in
the active V5 chain. The first
profile is intentionally narrower than general PLY: version 1.0,
`binary_little_endian`, exactly one fixed-width vertex element, the required
classic 3DGS float32 property families, optional all-or-none normal
placeholders, and a complete SH degree 0–4 property family. Property order is
not fixed; the inspector derives exact byte offsets from the declaration and
verifies `header bytes + Gaussian count × vertex stride = source bytes` on the
same identity-bound handle used for hashing.

The inspector does not decode scalar values. Physical bounds, units, frame,
Gaussian encoding semantics, renderer compatibility, visual fidelity,
provenance, accuracy, registration and usage rights remain explicit unknowns.
ASCII/mesh PLY stays outside this target, while big-endian, list/multi-element
and recognizable PlayCanvas packed layouts receive stable unsupported results.
Do not rename those variants to make them pass.

The authority-none real-source chain is:

`docs/reports/reception-room-gaussian-ply-source-facts-v3-evidence-2026-07-17.json`

Use the collapsible property table in the local app to review declared order,
name, scalar type, byte offset and semantic role. Those are structural facts,
not evidence that the values are finite, physically meaningful or visually
correct.

Source Facts V4 adds bounded SOF0/SOF2 eight-bit Huffman JPEG, static PNG and
selected ISO-BMFF movie/video declarations. Container success does not assign
DSLR, phone, panorama, drone, captured/generated or other provenance roles and
does not establish decoded pixels/samples, calibration, visual fidelity,
sequence, rights or permission to process. The exact V4 evidence is in:

`docs/reports/reception-room-image-video-container-source-facts-v4-evidence-2026-07-17.json`

Source Facts V5 adds one-candidate `trajectory` and `calibration_bundle`
documents. Its CSV profile establishes complete record/field structure; its
JSON profile establishes complete bounded syntax/tree shape. Both bind the
exact byte length and SHA-256 from the same already-open handle. Decimal
lexemes remain text: never infer time units, cadence, frame/CRS/units,
transform or quaternion convention, calibration applicability,
synchronization, accuracy, drift, provenance, rights or registration from a
successful V5 parse. Cancellation issues no artifact, and CSV/JSON failure
codes cannot cross formats. The exact V5 evidence is in:

`docs/reports/calibration-trajectory-source-facts-v5-evidence-2026-07-17.json`

This local workflow is sufficient for the next super-app source profile. It
does not require cybersecurity, credentials, cloud setup, deployment or the
optional reviewed-release workflow later in this document.

### 5. Stop the local app

Press `Ctrl+C` in the terminal. The app does not leave a worker, upload, remote
job or source mutation behind.

### 6. Developer verification

Run the two local packages before handing off a profile change:

```powershell
pnpm --filter @omnitwin/reconstruction-foundry test
pnpm --filter @omnitwin/reconstruction-foundry lint
pnpm --filter @omnitwin/reconstruction-foundry typecheck
pnpm --filter @omnitwin/reconstruction-foundry build
pnpm --filter @omnitwin/reconstruction-foundry-cli test
pnpm --filter @omnitwin/reconstruction-foundry-cli lint
pnpm --filter @omnitwin/reconstruction-foundry-cli typecheck
pnpm --filter @omnitwin/reconstruction-foundry-cli build
```

For a new source family, add a new immutable profile/version, synthetic edge
fixtures, at least one real read-only evidence pass, the readiness/checklist
mapping, canonical-download coverage and desktop/mobile UI checks.

## Optional reviewed-release workflow

The remainder of this runbook takes an already reviewed Twin bundle from local
bytes to an immutable, digest-addressed production release. Candidate
verification, human approval, detached attestation, public publication, and
production promotion remain separate gates and are not part of the local
super-app intake path.

## What is already complete locally

- Operator UI: `/dashboard?view=foundry` (platform-admin only).
- Capture Factory link: `/dev/capture-intake` → **Open Runtime Foundry**.
- Compatibility diagnostics: **Open legacy room registry** inside Foundry.
- Local CLI: `pnpm reconstruction:foundry --help`.
- Verified Trades Hall evidence:
  `output/foundry/trades-hall-prepared`.
- Verified release digest:
  `e3525acfd76bdd89d621c6eefaae8494f9c459e52702d351545f685655a917d8`.
- Verified QA result: 449 files, 498,035,687 bytes, all deterministic gates
  passed.

No production migration, R2 upload, public publication, promotion, rollback,
or deployment was performed while building this feature.

## One-time production setup

### 1. Create two new Cloudflare R2 buckets

Create these as separate buckets, in addition to the existing legacy upload
bucket:

1. `venviewer-foundry-private-candidates`
   - keep it private;
   - do not enable an `r2.dev` address or public custom domain;
   - restrict the Foundry credential to object reads and writes for this bucket.
2. `venviewer-foundry-public-releases`
   - attach the public release custom domain, for example
     `https://releases.venviewer.com`;
   - keep it separate from the legacy upload bucket;
   - the application writes only digest-addressed keys with create-if-absent
     semantics and immutable cache headers.

The Foundry application and CLI have no list, delete, bucket-policy, or
overwrite operation.

### 2. Create the R2 credential

Create a dedicated R2 API token scoped only to the two Foundry buckets. Record:

- account ID;
- access-key ID;
- secret access key.

Do not place these values in git, screenshots, tickets, or chat.

### 3. Create the controlled Ed25519 signing key

Create an Ed25519 signing key in the KMS/HSM your organisation controls. The
private key must be non-exportable. Export only its public key as SPKI DER and
base64-encode it.

If the KMS exports a PEM public key, save that public key as
`foundry-public-key.pem` and run this locally:

```powershell
node -e "const fs=require('node:fs'),c=require('node:crypto');const k=c.createPublicKey(fs.readFileSync('foundry-public-key.pem'));process.stdout.write(k.export({format:'der',type:'spki'}).toString('base64'))"
```

Choose a stable key ID such as `foundry-release-2026-01`. Build the environment
value as one line:

```text
{"foundry-release-2026-01":"PASTE_BASE64_SPKI_DER_HERE"}
```

The API validates at startup that every configured key really is an Ed25519
SPKI public key.

### 4. Set API environment variables

In the production API service, set:

```text
FOUNDRY_R2_CANDIDATE_BUCKET=venviewer-foundry-private-candidates
FOUNDRY_R2_RELEASE_BUCKET=venviewer-foundry-public-releases
FOUNDRY_R2_PUBLIC_URL=https://releases.venviewer.com
FOUNDRY_ED25519_PUBLIC_KEYS_JSON={"foundry-release-2026-01":"PASTE_BASE64_SPKI_DER_HERE"}
```

Set the dedicated `FOUNDRY_R2_ACCOUNT_ID`, `FOUNDRY_R2_ACCESS_KEY_ID`, and
`FOUNDRY_R2_SECRET_ACCESS_KEY` variables from step 2. They are deliberately
separate from the legacy upload credential. Startup fails if the
configuration is partial, the buckets are not segregated, the URL is not clean
HTTPS, or the verification key is malformed.

### 5. Apply migration 0049 safely

First take the normal production database backup/snapshot. Then, from the
exact commit being deployed:

```powershell
pnpm --filter @omnitwin/api db:verify-tail
pnpm --filter @omnitwin/api db:migrate
```

Do this in staging first. Migration `0049_reconstruction_foundry.sql` creates
the append-only release, QA, review, attestation, publication, and channel-event
ledgers plus the compare-and-swap production pointer. Do not manually edit its
rows.

### 6. Deploy the API and web application

Deploy the API first, then the web application. Confirm:

1. `/health/ready` returns `200`;
2. a platform admin can open **Dashboard → Runtime Foundry**;
3. the Foundry shows an empty release ledger rather than an integration error.

## Release Trades Hall step by step

### 1. Prepare and QA the local bundle

From the repository root:

```powershell
pnpm reconstruction:foundry -- prepare --bundle "packages\web\public\twin\trades-hall" --out "output\foundry\trades-hall-prepared"
```

The source folder is read-only to this command. It inventories regular files,
rejects symlinks/path collisions, hashes every byte, verifies the exact Twin
file set, WebP dimensions, GLB structure/budget, coordinates, floors, and the
navigation graph, then writes three evidence sidecars to the separate output
folder.

### 2. Load the R2 credential into this PowerShell session

```powershell
$env:FOUNDRY_R2_ACCOUNT_ID="YOUR_ACCOUNT_ID"
$env:FOUNDRY_R2_ACCESS_KEY_ID="YOUR_ACCESS_KEY_ID"
$env:FOUNDRY_R2_SECRET_ACCESS_KEY="YOUR_SECRET_ACCESS_KEY"
$env:FOUNDRY_R2_CANDIDATE_BUCKET="venviewer-foundry-private-candidates"
```

### 3. Upload the private candidate

```powershell
pnpm reconstruction:foundry -- upload-candidate --prepared "output\foundry\trades-hall-prepared"
```

The command uploads content first, QA second, and the release-manifest commit
marker last. Every put is create-if-absent and immediately read back. A retry
reuses only byte-identical objects.

### 4. Independently verify the remote candidate

```powershell
pnpm reconstruction:foundry -- verify-candidate --prefix "candidates/trades-hall/e3525acfd76bdd89d621c6eefaae8494f9c459e52702d351545f685655a917d8"
```

This reads the private R2 objects again and reconstructs the release and QA
digests without trusting the local preparation folder.

### 5. Register it through the visible operator UI

1. Sign in as a Venviewer platform admin.
2. Open **Dashboard → Runtime Foundry**.
3. Paste the candidate prefix into **Private candidate prefix**.
4. Select **Verify candidate**.
5. Leave the page open; the first verification reads roughly 498 MB and can
   take several minutes.
6. Confirm the release ledger shows the expected digest, 449 files, QA passed,
   and `awaiting review`.

### 6. Record the human public review

1. Open the release and select **QA evidence**.
2. Select the exact visual evidence files you reviewed.
3. Enter the reviewed `TransformArtifact` ID and SHA-256.
4. Enter the reviewed Scene Authority Map ID and SHA-256.
5. Select **Approve public evidence**.
6. Write a specific operator note of at least 20 characters.
7. Confirm **Record approval**.

The approval is append-only and binds the exact release, QA, visual,
transform, and scene-authority digests. It does not publish or promote.

### 7. Download and prepare the keyless signing request

1. In the release signing panel, select **Download signing payload**.
2. Run, replacing the download filename:

```powershell
pnpm reconstruction:foundry -- prepare-signing-request --payload "$HOME\Downloads\venviewer-REPLACE-signing-payload.json" --out "output\foundry\trades-hall-signing-request"
```

The output contains:

- `dsse-pae.bin` — the exact bytes the KMS must sign;
- `signing-request.json` — the release/review and PAE digests;
- `dsse-envelope-template.json` — deliberately not accepted as a signed envelope.

### 8. Sign with the controlled KMS key

Ask the KMS to sign `dsse-pae.bin` as a **RAW Ed25519 message**. Do not hash the
file again unless the KMS API explicitly requires the already-selected raw
message mode. Record the returned canonical base64 64-byte signature and the
configured key ID.

The exact KMS command is provider-specific. Do not improvise this step: choose
the provider first and test it in staging against the configured public key.

### 9. Assemble and verify the detached envelope

```powershell
pnpm reconstruction:foundry -- assemble-attestation --payload "$HOME\Downloads\venviewer-REPLACE-signing-payload.json" --key-id "foundry-release-2026-01" --signature-base64 "PASTE_KMS_SIGNATURE" --out "output\foundry\trades-hall.dsse.json"
```

Back in Runtime Foundry:

1. select **Upload DSSE JSON**;
2. choose `output\foundry\trades-hall.dsse.json`;
3. select **Verify signed envelope**.

The API verifies DSSE PAE over the exact payload bytes before parsing the
statement, requires a configured Ed25519 public key, then stores and reads back
the envelope in private R2.

### 10. Publish the immutable public release

1. Select **Publish release**.
2. Record why this exact reviewed/attested release is being published.
3. Confirm.

The API streams only manifest-declared files to
`releases/sha256/<first-two-digest-characters>/<full-release-digest>/`, uses
create-if-absent writes, and readback-verifies source and destination bytes.
Publication does not change production.

### 11. Promote it to production

1. Select **Promote to production**.
2. Review the current and target digests.
3. Record the promotion reason.
4. Confirm.

The pointer changes only if the displayed revision and active release are
still current. A conflict reloads the Foundry instead of overwriting another
operator's decision.

### 12. Verify the user-facing Twin

Open `/venues/trades-hall/twin`. The browser resolves the production channel,
downloads the exact immutable `manifest.json`, hashes its raw bytes with
SHA-256, validates the Twin schema and venue, then loads assets from the same
digest-addressed base. A digest mismatch fails closed and never falls back.

## One-click rollback

1. Open **Dashboard → Runtime Foundry**.
2. Select a previously active, still-eligible release.
3. Select **Roll back production**.
4. Review the current and rollback-target digests.
5. Enter the incident/change reason and confirm.

Rollback appends a new channel event. It does not edit, copy, overwrite, or
delete either release. The target must have been active before and must still
have a current approval, verified attestation, and publication receipt.

## Stop conditions

Stop and investigate rather than bypassing a gate when:

- a local or remote digest differs;
- deterministic QA fails;
- an evidence file is not in the immutable manifest;
- the TransformArtifact or Scene Authority Map digest is unknown;
- DSSE verification rejects the key, payload, PAE, or signature;
- public readback differs from the candidate;
- the channel returns a revision conflict;
- production environment or migration readiness checks fail.
