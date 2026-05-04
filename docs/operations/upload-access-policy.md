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

The storage layer still relies on Cloudflare R2 bucket policy to keep private prefixes private. Production buckets must not expose `private/` prefixes through a public bucket policy or custom domain.
