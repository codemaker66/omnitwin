import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { createPresignedUrl, uploadStorageFor, type UploadVisibility } from "../routes/uploads.js";

// ---------------------------------------------------------------------------
// The browser PUTs the file's real bytes to the URL this route hands out, so
// whatever the URL signs about the body has to be true of bytes the API never
// sees. A checksum worked out when the URL is signed is the checksum of an
// empty body, and the store then refuses every real upload.
//
// Nothing is mocked: the installed AWS SDK builds the URL, for each bucket an
// upload can go to. Signing is local, so no network is touched.
// ---------------------------------------------------------------------------

const PUBLIC_BUCKET = "venviewer-test-uploads";
const PRIVATE_BUCKET = "venviewer-test-private-uploads";
const VENUE_ID = "00000000-0000-4000-8000-000000000001";

const env = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET_NAME: PUBLIC_BUCKET,
  PRIVATE_UPLOADS_R2_ACCOUNT_ID: "fedcba9876543210fedcba9876543210",
  PRIVATE_UPLOADS_R2_ACCESS_KEY_ID: "test-private-access-key-id",
  PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY: "test-private-secret-access-key",
  PRIVATE_UPLOADS_R2_BUCKET: PRIVATE_BUCKET,
} as Env;

const CASES: readonly (readonly [UploadVisibility, string, string])[] = [
  ["private", `private/venues/${VENUE_ID}/loadouts/photo.jpg`, PRIVATE_BUCKET],
  ["public", "public/marketing/hero/photo.jpg", PUBLIC_BUCKET],
];

async function presign(visibility: UploadVisibility, key: string): Promise<URL> {
  const storage = uploadStorageFor(env, visibility, key);
  if (storage === null) throw new Error(`no ${visibility} storage for ${key}`);
  return new URL(await createPresignedUrl(storage, key, "image/jpeg", 2048));
}

function isBodyChecksumName(name: string): boolean {
  return name.startsWith("x-amz-checksum-") || name === "x-amz-sdk-checksum-algorithm";
}

describe.each(CASES)("presigned %s upload URL (real AWS SDK presigner)", (visibility, key, bucket) => {
  it("signs no checksum of a body the browser has yet to send", async () => {
    const url = await presign(visibility, key);

    const queryNames = [...url.searchParams.keys()].map((name) => name.toLowerCase());
    expect(queryNames.filter(isBodyChecksumName)).toEqual([]);

    const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signedHeaders.filter(isBodyChecksumName)).toEqual([]);
  });

  it("still signs a ten-minute link to exactly that object", async () => {
    const url = await presign(visibility, key);

    expect(`${url.host}${url.pathname}`).toContain(bucket);
    expect(url.pathname.endsWith(`/${key}`)).toBe(true);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
