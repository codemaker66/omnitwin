import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import type {
  CandidateObjectStore,
  CandidatePutInput,
  ImmutableGetResult,
  ImmutableObjectKeyScope,
  ImmutableObjectStore,
} from "./object-store.js";
import { assertSafeCandidateKey, assertSafeImmutableObjectKey } from "./object-store.js";
import { FoundryIntegrityError } from "./errors.js";

export interface S3CandidateStoreConfig {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly bucketName: string;
  readonly endpoint?: string;
}

export interface S3ImmutableStoreConfig extends S3CandidateStoreConfig {
  readonly keyScope: ImmutableObjectKeyScope;
}

interface AsyncUnknownIterable {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
}

function hasAsyncIterator(value: unknown): value is AsyncUnknownIterable {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

async function* byteChunks(body: unknown): AsyncIterable<Uint8Array> {
  if (!hasAsyncIterator(body)) {
    throw new FoundryIntegrityError("R2_BODY_NOT_STREAMABLE", "R2 candidate response body is not an async byte stream.");
  }
  for await (const chunk of body) {
    if (typeof chunk === "string") {
      yield Buffer.from(chunk);
    } else if (chunk instanceof Uint8Array) {
      yield chunk;
    } else {
      throw new FoundryIntegrityError("R2_BODY_CHUNK_INVALID", "R2 candidate response yielded a non-byte chunk.");
    }
  }
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return null;
  const metadata = error.$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) return null;
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function errorName(error: unknown): string | null {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
}

function configured(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new FoundryIntegrityError("R2_CONFIG_MISSING", `${label} is required.`);
  return trimmed;
}

export function buildCandidatePutRequest(
  bucketName: string,
  input: CandidatePutInput,
): PutObjectCommandInput {
  assertSafeCandidateKey(input.key);
  if (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0) {
    throw new FoundryIntegrityError("INVALID_CANDIDATE_LENGTH", `Candidate content length is invalid for ${input.key}.`);
  }
  return {
    Bucket: bucketName,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
    CacheControl: "private, no-store",
    IfNoneMatch: "*",
  };
}

export function buildScopedImmutablePutRequest(
  bucketName: string,
  input: CandidatePutInput,
  scope: ImmutableObjectKeyScope,
): PutObjectCommandInput {
  assertSafeImmutableObjectKey(input.key, scope);
  if (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0) {
    throw new FoundryIntegrityError("INVALID_IMMUTABLE_LENGTH", `Immutable content length is invalid for ${input.key}.`);
  }
  return {
    Bucket: bucketName,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
    CacheControl: scope === "candidate" ? "private, no-store" : "public, max-age=31536000, immutable",
    IfNoneMatch: "*",
  };
}

export class S3ImmutableObjectStore implements ImmutableObjectStore {
  readonly #bucketName: string;
  readonly #client: S3Client;
  readonly #keyScope: ImmutableObjectKeyScope;

  constructor(config: S3ImmutableStoreConfig) {
    const accountId = configured(config.accountId, "Foundry R2 account ID");
    this.#bucketName = configured(config.bucketName, "Foundry immutable bucket name");
    this.#keyScope = config.keyScope;
    const clientConfig: S3ClientConfig = {
      region: "auto",
      endpoint: config.endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      maxAttempts: 3,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: configured(config.accessKeyId, "Foundry R2 access key ID"),
        secretAccessKey: configured(config.secretAccessKey, "Foundry R2 secret access key"),
        ...(config.sessionToken === undefined ? {} : { sessionToken: configured(config.sessionToken, "Foundry R2 session token") }),
      },
    };
    this.#client = new S3Client(clientConfig);
  }

  async putIfAbsent(input: CandidatePutInput): Promise<"created" | "exists"> {
    try {
      await this.#client.send(new PutObjectCommand(buildScopedImmutablePutRequest(
        this.#bucketName,
        input,
        this.#keyScope,
      )));
      return "created";
    } catch (error: unknown) {
      if (errorStatus(error) === 412 || errorName(error) === "PreconditionFailed") return "exists";
      throw error;
    }
  }

  async get(key: string): Promise<ImmutableGetResult> {
    assertSafeImmutableObjectKey(key, this.#keyScope);
    const result = await this.#client.send(new GetObjectCommand({
      Bucket: this.#bucketName,
      Key: key,
    }));
    if (result.Body === undefined) {
      throw new FoundryIntegrityError("R2_BODY_MISSING", `R2 candidate object has no body: ${key}.`);
    }
    return {
      contentLength: result.ContentLength ?? null,
      body: byteChunks(result.Body),
    };
  }
}

export class S3CandidateObjectStore extends S3ImmutableObjectStore implements CandidateObjectStore {
  constructor(config: S3CandidateStoreConfig) {
    super({ ...config, keyScope: "candidate" });
  }
}
