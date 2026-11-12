import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { createPresignedUrl } from "../routes/uploads.js";

// ---------------------------------------------------------------------------
// The browser PUTs the file's real bytes to the URL this route hands out, so
// whatever the URL signs about the body has to be true of bytes the API never
// sees. A checksum worked out when the URL is signed is the checksum of an
// empty body, and the store then refuses every real upload.
//
// Nothing is mocked: the installed AWS SDK builds the URL. Signing is local,
// so no network is touched.
// ---------------------------------------------------------------------------

const BUCKET = "venviewer-test-uploads";
const KEY = "venues/00000000-0000-4000-8000-000000000001/loadouts/photo.jpg";

const env = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET_NAME: BUCKET,
} as Env;

async function presign(): Promise<URL> {
  return new URL(await createPresignedUrl(env, KEY, "image/jpeg", 2048));
}

function isBodyChecksumName(name: string): boolean {
  return name.startsWith("x-amz-checksum-") || name === "x-amz-sdk-checksum-algorithm";
}

describe("presigned upload URL (real AWS SDK presigner)", () => {
  it("signs no checksum of a body the browser has yet to send", async () => {
    const url = await presign();

    const queryNames = [...url.searchParams.keys()].map((name) => name.toLowerCase());
    expect(queryNames.filter(isBodyChecksumName)).toEqual([]);

    const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signedHeaders.filter(isBodyChecksumName)).toEqual([]);
  });

  it("still signs a ten-minute link to exactly that object", async () => {
    const url = await presign();

    expect(`${url.host}${url.pathname}`).toContain(BUCKET);
    expect(url.pathname.endsWith(`/${KEY}`)).toBe(true);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
