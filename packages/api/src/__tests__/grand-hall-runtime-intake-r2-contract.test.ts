import { describe, expect, it } from "vitest";
import { validateEnv } from "../env.js";
import {
  GRAND_HALL_FRONTIER_MEMBERS,
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
  DATABASE_URL: "postgresql://branch:secret@database.internal/venviewer",
  PUBLIC_API_ORIGIN: "https://api.venviewer.example",
  RUNTIME_PROFILE_R2_ACCOUNT_ID: "private-runtime-account",
  RUNTIME_PROFILE_R2_ACCESS_KEY_ID: "read-only-key",
  RUNTIME_PROFILE_R2_SECRET_ACCESS_KEY: "read-only-secret",
  RUNTIME_PROFILE_R2_PRIVATE_BUCKET: "private-runtime-profiles",
  RUNTIME_PROFILE_INTAKE_ENABLED: "true",
  RUNTIME_PROFILE_INTAKE_TARGET_ID: "production-grand-hall",
  RUNTIME_PROFILE_INTAKE_DEPLOYED_GIT_SHA: "a".repeat(40),
  GIT_SHA: "a".repeat(40),
  RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID: "put-only-key",
  RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: "put-only-secret",
});

describe("Grand Hall private R2 intake contract", () => {
  it("uses distinct serving and put-only credentials against one fixed private target", () => {
    const read = grandHallR2ReadClientOptions(env);
    const write = grandHallR2WriteClientOptions(env);

    expect(read.endpoint).toBe(write.endpoint);
    expect(read.credentials).toEqual({
      accessKeyId: "read-only-key",
      secretAccessKey: "read-only-secret",
    });
    expect(write.credentials).toEqual({
      accessKeyId: "put-only-key",
      secretAccessKey: "put-only-secret",
    });
    expect(write.credentials).not.toEqual(read.credentials);
  });

  it("pins GET and conditional PUT to the canonical server-owned key and exact bytes", () => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Grand Hall contract needs a first member.");
    const bytes = Buffer.alloc(member.sizeBytes, 7);

    expect(grandHallR2GetObjectInput(env, member)).toEqual({
      Bucket: "private-runtime-profiles",
      Key: grandHallObjectKey(member),
    });
    const putInput = grandHallR2PutObjectInput(env, member, bytes);
    expect(putInput).toMatchObject({
      Bucket: "private-runtime-profiles",
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
