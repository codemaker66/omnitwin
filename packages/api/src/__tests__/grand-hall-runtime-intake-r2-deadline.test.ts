import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateEnv } from "../env.js";
import { GRAND_HALL_FRONTIER_MEMBERS } from "../lib/grand-hall-frontier-contract.js";
import {
  GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS,
  GrandHallRuntimeIntakeError,
  prepareGrandHallRuntimeIntake,
} from "../services/grand-hall-runtime-intake.js";

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn<(
    command: unknown,
    options?: { readonly abortSignal?: AbortSignal },
  ) => Promise<unknown>>(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(readonly input: unknown) {}
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(readonly input: unknown) {}
  },
  S3Client: class S3Client {
    send(
      command: unknown,
      options?: { readonly abortSignal?: AbortSignal },
    ): Promise<unknown> {
      return s3Mocks.send(command, options);
    }
  },
}));

const { createGrandHallR2ObjectStore } = await import(
  "../routes/grand-hall-runtime-intake.js"
);

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

function rejectWhenAborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) return Promise.reject(new Error("Missing storage abort signal."));
  return new Promise((_resolve, reject) => {
    const rejectForAbort = (): void => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("aborted", "AbortError"),
      );
    };
    if (signal.aborted) rejectForAbort();
    else signal.addEventListener("abort", rejectForAbort, { once: true });
  });
}

beforeEach(() => {
  s3Mocks.send.mockReset();
});

describe("Grand Hall private R2 operation deadlines", () => {
  it("aborts a hung GET send and maps the deadline to a generic storage failure", async () => {
    vi.useFakeTimers();
    try {
      let storageSignal: AbortSignal | undefined;
      s3Mocks.send.mockImplementation(async (_command, options) => {
        storageSignal = options?.abortSignal;
        return new Promise<never>(() => undefined);
      });
      const operation = prepareGrandHallRuntimeIntake(createGrandHallR2ObjectStore(env));
      const rejected = expect(operation).rejects.toMatchObject({
        statusCode: 502,
        code: "GRAND_HALL_STORAGE_FAILED",
      } satisfies Partial<GrandHallRuntimeIntakeError>);

      await vi.advanceTimersByTimeAsync(0);
      expect(s3Mocks.send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS);
      await rejected;

      expect(storageSignal?.aborted).toBe(true);
      expect(s3Mocks.send.mock.calls[0]?.[1]?.abortSignal).toBe(storageSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a GET response body whose async stream hangs past the deadline", async () => {
    vi.useFakeTimers();
    try {
      const member = GRAND_HALL_FRONTIER_MEMBERS[0];
      if (member === undefined) throw new Error("Grand Hall contract needs a first member.");
      const destroy = vi.fn();
      const next = vi.fn<() => Promise<IteratorResult<Uint8Array>>>(
        async () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
      );
      s3Mocks.send.mockResolvedValue({
        Body: {
          [Symbol.asyncIterator]: () => ({ next }),
          destroy,
        },
        ContentLength: member.sizeBytes,
      });
      const operation = prepareGrandHallRuntimeIntake(createGrandHallR2ObjectStore(env));
      const rejected = expect(operation).rejects.toMatchObject({
        statusCode: 502,
        code: "GRAND_HALL_STORAGE_FAILED",
      } satisfies Partial<GrandHallRuntimeIntakeError>);

      await vi.advanceTimersByTimeAsync(0);
      expect(next).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(GRAND_HALL_STORAGE_OPERATION_DEADLINE_MS);
      await rejected;

      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes an abort signal to a hung conditional PUT send", async () => {
    vi.useFakeTimers();
    try {
      const member = GRAND_HALL_FRONTIER_MEMBERS[0];
      if (member === undefined) throw new Error("Grand Hall contract needs a first member.");
      let storageSignal: AbortSignal | undefined;
      s3Mocks.send.mockImplementation((_command, options) => {
        storageSignal = options?.abortSignal;
        return rejectWhenAborted(storageSignal);
      });
      const controller = new AbortController();
      const operation = createGrandHallR2ObjectStore(env).putCreateOnly(
        member,
        Buffer.alloc(1),
        controller.signal,
      );
      const rejected = expect(operation).rejects.toMatchObject({ name: "AbortError" });
      const timeout = setTimeout(() => {
        controller.abort();
      }, 10);

      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      clearTimeout(timeout);

      expect(storageSignal).toBe(controller.signal);
      expect(s3Mocks.send.mock.calls[0]?.[1]?.abortSignal).toBe(controller.signal);
    } finally {
      vi.useRealTimers();
    }
  });
});
