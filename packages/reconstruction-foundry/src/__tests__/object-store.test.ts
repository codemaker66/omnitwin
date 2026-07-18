import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  assertSafeCandidateKey,
  assertSafePublicReleaseKey,
  verifyCandidateObject,
  type CandidateGetResult,
  type CandidateObjectStore,
  type CandidatePutInput,
} from "../object-store.js";
import { buildCandidatePutRequest, buildScopedImmutablePutRequest } from "../s3-candidate-store.js";
import { sha256Bytes } from "../hash.js";

class TestCandidateStore implements CandidateObjectStore {
  readonly #objects = new Map<string, Uint8Array>();

  constructor(initial: ReadonlyMap<string, Uint8Array> = new Map()) {
    for (const [key, value] of initial) this.#objects.set(key, value);
  }

  async putIfAbsent(input: CandidatePutInput): Promise<"created" | "exists"> {
    if (this.#objects.has(input.key)) return "exists";
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.#objects.set(input.key, Buffer.concat(chunks));
    return "created";
  }

  get(key: string): Promise<CandidateGetResult> {
    const bytes = this.#objects.get(key);
    if (bytes === undefined) return Promise.reject(new Error("missing object"));
    return Promise.resolve({ contentLength: bytes.byteLength, body: Readable.from([bytes]) });
  }
}

describe("private immutable candidate object boundary", () => {
  it("requires candidates/ confinement", () => {
    expect(() => { assertSafeCandidateKey("public/releases/x"); }).toThrow("must stay under candidates");
    expect(() => { assertSafeCandidateKey("candidates/../public/x"); }).toThrow("Unsafe bundle path");
  });

  it("pins an S3 put to no-store and If-None-Match", () => {
    const request = buildCandidatePutRequest("private-candidates", {
      key: "candidates/fixture/release/bundle/manifest.json",
      contentType: "application/json",
      contentLength: 2,
      body: Readable.from(["{}"]),
    });
    expect(request).toMatchObject({
      Bucket: "private-candidates",
      Key: "candidates/fixture/release/bundle/manifest.json",
      CacheControl: "private, no-store",
      IfNoneMatch: "*",
      ContentLength: 2,
    });
  });

  it("pins public writes to an exact digest prefix and immutable caching", () => {
    const digest = "a".repeat(64);
    const key = `releases/sha256/aa/${digest}/manifest.json`;
    const request = buildScopedImmutablePutRequest("public-releases", {
      key,
      contentType: "application/json",
      contentLength: 2,
      body: Readable.from(["{}"]),
    }, "public-release");
    expect(request).toMatchObject({
      Bucket: "public-releases",
      Key: key,
      CacheControl: "public, max-age=31536000, immutable",
      IfNoneMatch: "*",
    });
    expect(() => { assertSafePublicReleaseKey(`releases/sha256/bb/${digest}/manifest.json`); })
      .toThrow("digest-addressed");
  });

  it("streams and verifies exact candidate bytes", async () => {
    const key = "candidates/fixture/release/bundle/manifest.json";
    const bytes = Buffer.from("verified", "utf8");
    const store = new TestCandidateStore(new Map([[key, bytes]]));
    await expect(verifyCandidateObject(store, {
      key,
      sha256: sha256Bytes(bytes),
      sizeBytes: bytes.length,
    })).resolves.toEqual({ key, sha256: sha256Bytes(bytes), sizeBytes: bytes.length });
  });

  it("fails closed on content or byte-length drift", async () => {
    const key = "candidates/fixture/release/bundle/manifest.json";
    const bytes = Buffer.from("tampered", "utf8");
    const store = new TestCandidateStore(new Map([[key, bytes]]));
    await expect(verifyCandidateObject(store, {
      key,
      sha256: "a".repeat(64),
      sizeBytes: bytes.length,
    })).rejects.toThrow("readback verification failed");
  });
});
