import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import type { JwtUser } from "../middleware/auth.js";
import type { Database } from "../db/client.js";
import {
  buildScopedFileKey,
  filenameMatchesContentType,
  publicUrlForVisibility,
  resolveUploadScope,
  type UploadScope,
} from "../routes/uploads.js";

const CTX_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_CTX_ID = "00000000-0000-0000-0000-000000000002";

const noopDb = {} as unknown as Database;

const admin: JwtUser = {
  id: "admin-user",
  email: "admin@test.com",
  role: "admin",
  venueId: null,
};

const staff: JwtUser = {
  id: "staff-user",
  email: "staff@test.com",
  role: "staff",
  venueId: CTX_ID,
};

const planner: JwtUser = {
  id: "planner-user",
  email: "planner@test.com",
  role: "planner",
  venueId: null,
};

describe("upload authorization policy helpers", () => {
  it("matches extensions to the declared content type", () => {
    expect(filenameMatchesContentType("photo.jpg", "image/jpeg")).toBe(true);
    expect(filenameMatchesContentType("photo.jpeg", "image/jpeg")).toBe(true);
    expect(filenameMatchesContentType("photo.png", "image/png")).toBe(true);
    expect(filenameMatchesContentType("photo.webp", "image/webp")).toBe(true);
    expect(filenameMatchesContentType("deck.pdf", "application/pdf")).toBe(true);
    expect(filenameMatchesContentType("photo.png", "image/jpeg")).toBe(false);
    expect(filenameMatchesContentType("no-extension", "image/jpeg")).toBe(false);
  });

  it("only returns permanent public URLs for explicitly public visibility", () => {
    const env = { R2_PUBLIC_URL: "https://assets.example.com/" } as unknown as Env;
    expect(publicUrlForVisibility(env, "private/venues/v1/file.jpg", "private")).toBeNull();
    expect(publicUrlForVisibility(env, "public/marketing/campaign/file.jpg", "public"))
      .toBe("https://assets.example.com/public/marketing/campaign/file.jpg");
  });

  it("builds private scoped keys under the authorized scope prefix", () => {
    const scope: UploadScope = {
      venueId: CTX_ID,
      keyPrefix: `private/venues/${CTX_ID}/venue-files`,
      visibility: "private",
    };

    const key = buildScopedFileKey(scope, "image/webp");

    expect(key.startsWith(`private/venues/${CTX_ID}/venue-files/`)).toBe(true);
    expect(key.endsWith(".webp")).toBe(true);
  });

  it("allows staff uploads only for their venue scope", async () => {
    const allowed = await resolveUploadScope(noopDb, staff, "venue", CTX_ID);
    const denied = await resolveUploadScope(noopDb, staff, "venue", OTHER_CTX_ID);

    expect(allowed).toMatchObject({
      venueId: CTX_ID,
      keyPrefix: `private/venues/${CTX_ID}/venue-files`,
      visibility: "private",
    });
    expect(denied).toBeNull();
  });

  it("restricts global asset uploads to admins", async () => {
    const adminScope = await resolveUploadScope(noopDb, admin, "asset", CTX_ID);
    const plannerScope = await resolveUploadScope(noopDb, planner, "asset", CTX_ID);

    expect(adminScope).toMatchObject({
      venueId: null,
      keyPrefix: `private/catalogue/assets/${CTX_ID}`,
      visibility: "private",
    });
    expect(plannerScope).toBeNull();
  });

  it("restricts public marketing uploads to explicit admin-public intent", async () => {
    const adminPublicScope = await resolveUploadScope(noopDb, admin, "public_marketing", CTX_ID, "public");
    const adminPrivateScope = await resolveUploadScope(noopDb, admin, "public_marketing", CTX_ID, "private");
    const plannerPublicScope = await resolveUploadScope(noopDb, planner, "public_marketing", CTX_ID, "public");

    expect(adminPublicScope).toMatchObject({
      venueId: null,
      keyPrefix: `public/marketing/${CTX_ID}`,
      visibility: "public",
    });
    expect(adminPrivateScope).toBeNull();
    expect(plannerPublicScope).toBeNull();
  });
});
