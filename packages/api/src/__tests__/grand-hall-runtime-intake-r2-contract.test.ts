import { describe, expect, it } from "vitest";
import { validateEnv, type Env } from "../env.js";
import {
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
  GRAND_HALL_STAGING_GIT_BRANCH,
  GRAND_HALL_STAGING_PRIVATE_BUCKET,
  GRAND_HALL_STAGING_TARGET_ID,
  grandHallObjectKey,
} from "../lib/grand-hall-frontier-contract.js";
import {
  grandHallR2GetObjectInput,
  grandHallR2PutObjectInput,
  grandHallR2ReadClientOptions,
  grandHallR2WriteClientOptions,
  isGrandHallConditionalCreateConflict,
  isGrandHallMissingObjectError,
} from "../routes/grand-hall-runtime-intake.js";

const env = validateEnv({
  NODE_ENV: "test",
  DATABASE_URL:
    `postgresql://${GRAND_HALL_STAGING_DATABASE_ROLE}:secret@ep-grand-hall-pooler.eu-west-2.aws.neon.tech/${GRAND_HALL_STAGING_DATABASE_NAME}?sslmode=require`,
  CLERK_SECRET_KEY: "sk_test_r2-contract",
  CLERK_WEBHOOK_SECRET: "whsec_r2-contract",
  FRONTEND_URL: "https://codex-grand-hall-venviewer.vercel.app",
  CORS_ORIGINS: "https://codex-grand-hall-venviewer.vercel.app",
  PUBLIC_API_ORIGIN: "https://trades-hall-grand-hall-staging.up.railway.app",
  RUNTIME_PROFILE_R2_ACCOUNT_ID: "a".repeat(32),
  RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "read-only-key",
  RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: "read-only-secret",
  RUNTIME_PROFILE_R2_PRIVATE_BUCKET: GRAND_HALL_STAGING_PRIVATE_BUCKET,
  RUNTIME_PROFILE_INTAKE_ENABLED: "true",
  VENVIEWER_DEPLOYMENT_TARGET_ID: GRAND_HALL_STAGING_TARGET_ID,
  VENVIEWER_STAGING_REVIEWED_GIT_SHA: "a".repeat(40),
  VENVIEWER_STAGING_EXPECTED_WEB_ORIGIN:
    "https://codex-grand-hall-venviewer.vercel.app",
  RUNTIME_PROFILE_INTAKE_TARGET_ID: GRAND_HALL_STAGING_TARGET_ID,
  RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA: "a".repeat(40),
  GIT_SHA: "a".repeat(40),
  RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID: "put-only-key",
  RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: "put-only-secret",
  RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: "put-only-session-token",
  RAILWAY_PROJECT_NAME: GRAND_HALL_STAGING_TARGET_ID,
  RAILWAY_ENVIRONMENT_NAME: GRAND_HALL_STAGING_TARGET_ID,
  RAILWAY_SERVICE_NAME: GRAND_HALL_STAGING_TARGET_ID,
  RAILWAY_PUBLIC_DOMAIN: "trades-hall-grand-hall-staging.up.railway.app",
  RAILWAY_GIT_BRANCH: GRAND_HALL_STAGING_GIT_BRANCH,
  VENVIEWER_STAGING_EXPECTED_DATABASE_HOST:
    "ep-grand-hall-pooler.eu-west-2.aws.neon.tech",
});

describe("Grand Hall private R2 intake contract", () => {
  it("uses distinct serving and put-only credentials against one fixed private target", () => {
    const read = grandHallR2ReadClientOptions(env);
    const write = grandHallR2WriteClientOptions(env);

    expect(read.endpoint).toBe(write.endpoint);
    expect(read.endpoint).toBe(
      `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    );
    expect(read.credentials).toEqual({
      accessKeyId: "read-only-key",
      secretAccessKey: "read-only-secret",
    });
    expect(read.credentials).not.toHaveProperty("sessionToken");
    expect(write.credentials).toEqual({
      accessKeyId: "put-only-key",
      secretAccessKey: "put-only-secret",
      sessionToken: "put-only-session-token",
    });
    expect(write.credentials).not.toEqual(read.credentials);
  });

  it("rejects account-ID endpoint injection even if a caller bypasses env validation", () => {
    for (const injected of ["evil.example\\", "evil.example/", "evil.example?", "evil.example#"]) {
      const poisoned = {
        ...env,
        RUNTIME_PROFILE_R2_ACCOUNT_ID: injected,
      } as Env;
      expect(() => grandHallR2ReadClientOptions(poisoned)).toThrow(
        "private-storage account identity is invalid",
      );
    }
  });

  it("pins GET and conditional PUT to the canonical server-owned key and exact bytes", () => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Grand Hall contract needs a first member.");
    const bytes = Buffer.alloc(member.sizeBytes, 7);

    expect(grandHallR2GetObjectInput(env, member)).toEqual({
      Bucket: GRAND_HALL_STAGING_PRIVATE_BUCKET,
      Key: grandHallObjectKey(member),
    });
    const putInput = grandHallR2PutObjectInput(env, member, bytes);
    expect(putInput).toMatchObject({
      Bucket: GRAND_HALL_STAGING_PRIVATE_BUCKET,
      Key: grandHallObjectKey(member),
      ContentType: "application/octet-stream",
      ContentLength: member.sizeBytes,
      IfNoneMatch: "*",
    });
    expect(putInput.Body).toBe(bytes);
  });

  it("recognizes only missing-object and conditional-create conflict responses", () => {
    expect(isGrandHallMissingObjectError({ name: "NoSuchKey" })).toBe(true);
    expect(isGrandHallMissingObjectError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isGrandHallMissingObjectError({
      name: "NoSuchBucket",
      $metadata: { httpStatusCode: 404 },
    })).toBe(false);
    expect(isGrandHallMissingObjectError({
      name: "InvalidBucket",
      $metadata: { httpStatusCode: 404 },
    })).toBe(false);
    expect(isGrandHallMissingObjectError({ $metadata: { httpStatusCode: 403 } })).toBe(false);

    expect(isGrandHallConditionalCreateConflict({ name: "PreconditionFailed" })).toBe(true);
    expect(isGrandHallConditionalCreateConflict({ $metadata: { httpStatusCode: 409 } })).toBe(true);
    expect(isGrandHallConditionalCreateConflict({ $metadata: { httpStatusCode: 412 } })).toBe(true);
    expect(isGrandHallConditionalCreateConflict({ $metadata: { httpStatusCode: 500 } })).toBe(false);
  });
});
