# Upload Access Policy

Venviewer upload authorization is scope-first. A signed-in identity is not enough to upload customer or venue assets.

## Policy

- Every upload request must declare a known context and UUID scope.
- Private venue/customer assets use private R2 key prefixes and do not receive permanent public URLs.
- Public URLs are only returned for the explicit `public_marketing` context.
- `venue` uploads require staff, hallkeeper, or admin access to that venue.
- `space` and `loadout` uploads resolve their parent venue before applying the same venue access rule.
- `enquiry` uploads require enquiry ownership or staff/admin access to the enquiry venue.
- Global `asset` catalogue uploads are admin-only.
- `public_marketing` uploads are admin-only and must request `public` visibility explicitly.

## File Safety

The presign API validates:

- declared content type against an allowlist: JPEG, PNG, WebP, PDF
- filename extension against declared content type
- declared content length against type-specific limits
- optional SHA-256 format when supplied

## Storage

Private and public uploads live in different buckets, because R2 cannot keep one prefix of a public bucket private: a bucket's r2.dev URL (or custom domain) serves every object in it to anyone holding the key, and presigned URLs work only on the S3 API endpoint, so a public bucket makes signatures irrelevant.

- `private/…` keys are written to and signed against `PRIVATE_UPLOADS_R2_BUCKET` only. That bucket has no r2.dev URL and no custom domain, so an unsigned request cannot read it. Its token is scoped to that bucket alone and must differ from `R2_ACCESS_KEY_ID`, which also lives in developer `.env` files for splat publishing.
- `public/…` keys (explicit `public_marketing` uploads) go to `R2_BUCKET_NAME`, the publicly served bucket that also holds published splats and capture assets.
- The bucket comes from the visibility and the key prefix must agree with it (`uploadStorageFor` in `packages/api/src/routes/uploads.ts`). There is no fallback: if the private bucket is not configured, private uploads return 503 rather than landing in the public bucket. Production refuses to boot without it.
- Private files are read only through five-minute signed URLs returned by the API (`readUrl`). Clients never build a URL from a file key; the web app has no public bucket base for uploads.
- Reference loadout reads (`GET /venues/:venueId/spaces/:spaceId/loadouts[/:id]`) require venue staff or admin access, and sign only files uploaded into that loadout's own scope. Their photo counts and covers use the same scope.
- Presigned writes sign `Content-Type` as well as `Content-Length`, so the stored type is the declared, allow-listed one. The client sets `requestChecksumCalculation: "WHEN_REQUIRED"`, as the asset clients do: otherwise SDK 3.729+ presigns the CRC32 of an empty body. Responses carrying signed URLs are `Cache-Control: private, no-store`.

Guard tests: `private-upload-storage.test.ts` (routing for every context, the no-fallback refusal, the loadout gates), `private-upload-signing.test.ts` (the real presigner's URLs), `reference-loadouts-postgres.test.ts` (the loadout reads on real PostgreSQL), and the private-upload cases in `env.test.ts`, all in `packages/api/src/__tests__/`.

## Keeping the private bucket private

The code cannot see the bucket's dashboard settings, so these are checked by hand after any change to the bucket or its tokens:

- Cloudflare dashboard → R2 → `omnitwin-private-uploads` → Settings: Public Development URL **disabled**, Custom Domains **none**. Turning either on publishes every private upload.
- Its token is `Object Read & Write`, scoped to this bucket only. An `Admin` R2 token reaches every bucket in the account, so no Admin token belongs in a developer `.env`.
- Run the production probe recorded in `docs/sessions/2026-10-18.md` (T-668). An unsigned GET of the canary `private/_probe/signed-read-canary.txt` must fail in both URL styles while its signed URL returns it. The public token must be refused on this bucket, the public bucket must hold no `private/` keys, and CORS must admit only the app's origins.
