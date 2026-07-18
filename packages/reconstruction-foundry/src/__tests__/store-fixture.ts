import { Readable } from "node:stream";
import type {
  CandidateGetResult,
  CandidateObjectStore,
  CandidatePutInput,
} from "../object-store.js";

export class MemoryImmutableStore implements CandidateObjectStore {
  readonly #objects = new Map<string, Buffer>();
  readonly putOrder: string[] = [];

  constructor(initial: ReadonlyMap<string, Uint8Array> = new Map()) {
    for (const [key, value] of initial) this.#objects.set(key, Buffer.from(value));
  }

  async putIfAbsent(input: CandidatePutInput): Promise<"created" | "exists"> {
    this.putOrder.push(input.key);
    if (this.#objects.has(input.key)) return "exists";
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== input.contentLength) throw new Error("test store content-length mismatch");
    this.#objects.set(input.key, bytes);
    return "created";
  }

  get(key: string): Promise<CandidateGetResult> {
    const bytes = this.#objects.get(key);
    if (bytes === undefined) return Promise.reject(new Error(`missing test object: ${key}`));
    return Promise.resolve({ contentLength: bytes.length, body: Readable.from([Buffer.from(bytes)]) });
  }

  bytes(key: string): Buffer {
    const bytes = this.#objects.get(key);
    if (bytes === undefined) throw new Error(`missing test object: ${key}`);
    return Buffer.from(bytes);
  }

  set(key: string, bytes: Uint8Array): void {
    this.#objects.set(key, Buffer.from(bytes));
  }

  delete(key: string): void {
    this.#objects.delete(key);
  }
}
