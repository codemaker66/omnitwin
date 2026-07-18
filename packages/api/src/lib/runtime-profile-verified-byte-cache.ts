import { createHash } from "node:crypto";

interface CacheEntry {
  readonly bytes: Buffer;
  readonly expiresAt: number;
}

interface FlightState {
  readonly controller: AbortController;
  consumers: number;
  settled: boolean;
}

interface Flight {
  readonly state: FlightState;
  readonly promise: Promise<Buffer>;
}

export interface RuntimeProfileVerifiedByteCacheOptions {
  readonly maximumBytes: number;
  readonly maximumEntries: number;
  readonly ttlMilliseconds: number;
  readonly now?: () => number;
}

export interface RuntimeProfileVerifiedByteIdentity {
  readonly sha256: string;
  readonly sizeBytes: number;
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException("Runtime profile byte request was aborted", "AbortError");
}

function cacheKey(identity: RuntimeProfileVerifiedByteIdentity): string {
  return `${identity.sha256}:${String(identity.sizeBytes)}`;
}

function verifyBytes(identity: RuntimeProfileVerifiedByteIdentity, bytes: Buffer): void {
  if (
    !Number.isSafeInteger(identity.sizeBytes) ||
    identity.sizeBytes <= 0 ||
    !/^[a-f0-9]{64}$/u.test(identity.sha256) ||
    bytes.byteLength !== identity.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== identity.sha256
  ) {
    throw new Error("Verified runtime profile bytes did not match their immutable identity");
  }
}

/**
 * A bounded, per-process cache and single-flight coordinator for bytes that
 * already passed the full registered size and SHA-256 check. Authorization is
 * deliberately outside this class and must be rerun for every response.
 */
export class RuntimeProfileVerifiedByteCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly flights = new Map<string, Flight>();
  private readonly now: () => number;
  private cachedBytes = 0;

  constructor(private readonly options: RuntimeProfileVerifiedByteCacheOptions) {
    if (
      !Number.isSafeInteger(options.maximumBytes) ||
      options.maximumBytes <= 0 ||
      !Number.isSafeInteger(options.maximumEntries) ||
      options.maximumEntries <= 0 ||
      !Number.isSafeInteger(options.ttlMilliseconds) ||
      options.ttlMilliseconds <= 0
    ) {
      throw new Error("Runtime profile byte cache limits must be positive safe integers");
    }
    this.now = options.now ?? Date.now;
  }

  private cached(key: string): Buffer | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.cachedBytes -= entry.bytes.byteLength;
      return null;
    }
    // Map insertion order is the LRU order. Move a hit to the newest end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.bytes;
  }

  private remember(key: string, bytes: Buffer): void {
    if (bytes.byteLength > this.options.maximumBytes) return;
    const prior = this.entries.get(key);
    if (prior !== undefined) {
      this.entries.delete(key);
      this.cachedBytes -= prior.bytes.byteLength;
    }
    this.entries.set(key, {
      bytes,
      expiresAt: this.now() + this.options.ttlMilliseconds,
    });
    this.cachedBytes += bytes.byteLength;
    while (
      this.entries.size > this.options.maximumEntries ||
      this.cachedBytes > this.options.maximumBytes
    ) {
      const oldest = this.entries.entries().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest[0]);
      this.cachedBytes -= oldest[1].bytes.byteLength;
    }
  }

  private subscribe(flight: Flight, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted === true) {
      if (flight.state.consumers === 0 && !flight.state.settled) {
        flight.state.controller.abort(signal.reason);
      }
      return Promise.reject(abortError(signal.reason));
    }
    flight.state.consumers += 1;
    return new Promise((resolve, reject) => {
      let consumerSettled = false;
      const finish = (complete: () => void): void => {
        if (consumerSettled) return;
        consumerSettled = true;
        signal?.removeEventListener("abort", handleAbort);
        flight.state.consumers -= 1;
        if (flight.state.consumers === 0 && !flight.state.settled) {
          flight.state.controller.abort(
            new DOMException("All runtime profile byte consumers disconnected", "AbortError"),
          );
        }
        complete();
      };
      const handleAbort = (): void => {
        finish(() => {
          reject(abortError(signal?.reason));
        });
      };
      signal?.addEventListener("abort", handleAbort, { once: true });
      // Close the AbortSignal listener-registration race.
      if (signal?.aborted === true) {
        handleAbort();
      }
      flight.promise.then(
        (bytes) => {
          finish(() => {
            resolve(bytes);
          });
        },
        (error: unknown) => {
          finish(() => {
            reject(abortError(error));
          });
        },
      );
    });
  }

  load(
    identity: RuntimeProfileVerifiedByteIdentity,
    signal: AbortSignal | undefined,
    loader: (signal: AbortSignal) => Promise<Buffer>,
  ): Promise<Buffer> {
    const key = cacheKey(identity);
    const cached = this.cached(key);
    if (cached !== null) {
      return signal?.aborted === true
        ? Promise.reject(abortError(signal.reason))
        : Promise.resolve(cached);
    }

    const currentFlight = this.flights.get(key);
    if (currentFlight !== undefined) return this.subscribe(currentFlight, signal);

    const state: FlightState = {
      controller: new AbortController(),
      consumers: 0,
      settled: false,
    };
    const promise = Promise.resolve()
      .then(() => loader(state.controller.signal))
      .then((bytes) => {
        verifyBytes(identity, bytes);
        this.remember(key, bytes);
        return bytes;
      })
      .finally(() => {
        state.settled = true;
        this.flights.delete(key);
      });
    const flight = { state, promise } satisfies Flight;
    this.flights.set(key, flight);
    return this.subscribe(flight, signal);
  }

  /** Introspection for deterministic unit tests and process metrics only. */
  snapshot(): {
    readonly cachedEntries: number;
    readonly cachedBytes: number;
    readonly activeFlights: number;
  } {
    return {
      cachedEntries: this.entries.size,
      cachedBytes: this.cachedBytes,
      activeFlights: this.flights.size,
    };
  }
}
