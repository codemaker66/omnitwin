import {
  PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS,
  PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES,
  type PhaseLayoutRuntimeAvailableBinding,
} from "@omnitwin/types";
import type { VerifiedHistoricalRuntimeAsset } from "../api/historical-runtime-assets.js";

export type HistoricalRuntimeCacheStatus =
  | "fetching"
  | "verified"
  | "decoding"
  | "ready"
  | "error";

export interface HistoricalRuntimeCacheRecord<TResource> {
  readonly key: string;
  readonly resourceKey: string;
  readonly binding: PhaseLayoutRuntimeAvailableBinding;
  readonly status: HistoricalRuntimeCacheStatus;
  readonly resource: TResource | null;
  readonly error: Error | null;
}

export interface HistoricalRuntimeCacheSnapshot<TResource> {
  readonly revision: number;
  readonly records: ReadonlyMap<string, HistoricalRuntimeCacheRecord<TResource>>;
  readonly lifecycleError: HistoricalRuntimeLifecycleError | null;
}

export interface HistoricalRuntimeCacheDependencies<TResource> {
  readonly fetchMember: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    member: PhaseLayoutRuntimeAvailableBinding["visualAssets"][number],
    signal: AbortSignal,
  ) => Promise<VerifiedHistoricalRuntimeAsset>;
  readonly decode: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    assets: readonly VerifiedHistoricalRuntimeAsset[],
    signal: AbortSignal,
  ) => Promise<TResource>;
  readonly dispose: (resource: TResource) => void;
  readonly decodeTimeoutMs?: number;
  readonly onLifecycleError?: (error: HistoricalRuntimeLifecycleError) => void;
}

interface MutableBindingRecord<TResource> {
  readonly key: string;
  readonly resourceKey: string;
  readonly binding: PhaseLayoutRuntimeAvailableBinding;
  readonly generation: number;
  readonly controller: AbortController;
  status: HistoricalRuntimeCacheStatus;
  verifiedAssets: readonly VerifiedHistoricalRuntimeAsset[] | null;
  error: Error | null;
  fetchPromise: Promise<readonly VerifiedHistoricalRuntimeAsset[]> | null;
  readyPromise: Promise<TResource | null> | null;
  verifiedExpiryTimer: ReturnType<typeof setTimeout> | null;
}

interface MutableResourceRecord<TResource> {
  readonly key: string;
  readonly generation: number;
  readonly controller: AbortController;
  resource: TResource | null;
  decodePromise: Promise<TResource | null> | null;
  error: Error | null;
}

export interface HistoricalRuntimeCacheWindow {
  readonly active: PhaseLayoutRuntimeAvailableBinding | null;
  readonly adjacent: PhaseLayoutRuntimeAvailableBinding | null;
  readonly decodeAdjacent: boolean;
}

export const HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET =
  PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES;
export const HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS = 15_000;
export const HISTORICAL_RUNTIME_DECODE_TIMEOUT_MS = 30_000;
export const HISTORICAL_RUNTIME_MAX_MEMBERS =
  PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS;
export const HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE = 4_000_000;
export const HISTORICAL_RUNTIME_CROSSFADE_SPLAT_BUDGET = 4_000_000;
export const HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET = 32 * 1_024 * 1_024;
export const HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET = 1_500_000;
export const HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE =
  "Historical room rendering is unavailable until this page is reloaded because a runtime resource could not retire safely.";
export const HISTORICAL_RUNTIME_DECODE_TIMEOUT_ERROR_MESSAGE =
  "The exact historical room capture did not initialize within the safe viewer deadline.";

export class HistoricalRuntimeLifecycleError extends Error {
  constructor() {
    super(HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE);
    this.name = "HistoricalRuntimeLifecycleError";
  }
}

export interface HistoricalRuntimeViewerCapacity {
  readonly maxCompressedBytes: number;
  readonly maxSplats: number;
  readonly allowAdjacent: boolean;
}

export function historicalRuntimeViewerCapacity(params: {
  readonly deviceMemoryGb: number;
  readonly mobile: boolean;
}): HistoricalRuntimeViewerCapacity {
  if (params.mobile || params.deviceMemoryGb < 8) {
    return {
      maxCompressedBytes: HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
      allowAdjacent: false,
    };
  }
  return {
    maxCompressedBytes: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
    maxSplats: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    allowAdjacent: true,
  };
}

export function historicalRuntimeDecodedSplatsWithinViewerBudget(
  decodedSplats: number,
  maxSplats: number,
): boolean {
  return Number.isInteger(decodedSplats) &&
    decodedSplats >= 0 &&
    decodedSplats <= maxSplats;
}

export function historicalRuntimeCombinedSplatsWithinBudget(
  activeSplats: number,
  adjacentSplats: number,
  combinedBudget: number,
): boolean {
  return historicalRuntimeDecodedSplatsWithinViewerBudget(activeSplats, combinedBudget) &&
    historicalRuntimeDecodedSplatsWithinViewerBudget(adjacentSplats, combinedBudget) &&
    activeSplats + adjacentSplats <= combinedBudget;
}

export function historicalRuntimeRemainingAdjacentSplatBudget(params: {
  readonly activeSplatCount: number | undefined;
  readonly viewerSplatBudget: number;
  readonly combinedResidentSplatBudget: number;
}): number {
  if (params.activeSplatCount === undefined) return 0;
  const residentBudget = Math.min(
    params.viewerSplatBudget,
    params.combinedResidentSplatBudget,
  );
  if (!historicalRuntimeDecodedSplatsWithinViewerBudget(
    params.activeSplatCount,
    residentBudget,
  )) return 0;
  return residentBudget - params.activeSplatCount;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Per-snapshot proof used for the exact authenticated member request. */
export function historicalRuntimeBindingKey(binding: PhaseLayoutRuntimeAvailableBinding): string {
  return [
    binding.venueId,
    binding.spaceId,
    binding.bindingId,
    binding.bindingDigest,
    binding.runtimePackageId,
    binding.runtimePackageContentDigest,
    binding.compositionDigest,
    binding.transformArtifactDigest,
  ].join(":");
}

/**
 * Decoded room identity. Package and snapshot aliases are deliberately absent:
 * reuse is allowed only inside the same venue/space scope when the ordered
 * visual bytes and frozen transform are byte-for-byte equivalent.
 */
export function historicalRuntimeResourceKey(
  binding: PhaseLayoutRuntimeAvailableBinding,
): string {
  return JSON.stringify([
    "historical-runtime-resource-v1",
    binding.venueId,
    binding.spaceId,
    binding.transformArtifactId,
    binding.transformArtifactDigest,
    binding.visualAssets.map((member) => [
      member.memberIndex,
      member.sha256,
      member.sizeBytes,
      member.fileExt,
      member.mimeType,
    ]),
  ]);
}

export function historicalRuntimeCompressedBytes(
  binding: PhaseLayoutRuntimeAvailableBinding,
): number {
  return binding.visualAssets.reduce((total, member) => total + member.sizeBytes, 0);
}

export function historicalRuntimeCrossfadeAllowed(params: {
  readonly from: PhaseLayoutRuntimeAvailableBinding;
  readonly to: PhaseLayoutRuntimeAvailableBinding;
  readonly sameEnvelope: boolean;
  readonly reducedMotion: boolean;
  readonly combinedByteBudget: number;
  readonly fromSplatCount: number;
  readonly toSplatCount: number;
  readonly combinedSplatBudget: number;
}): boolean {
  const { from, to } = params;
  return !params.reducedMotion &&
    params.sameEnvelope &&
    historicalRuntimeResourceKey(from) !== historicalRuntimeResourceKey(to) &&
    from.venueId === to.venueId &&
    from.spaceId === to.spaceId &&
    from.transformArtifactId === to.transformArtifactId &&
    from.transformArtifactDigest === to.transformArtifactDigest &&
    historicalRuntimeCompressedBytes(from) + historicalRuntimeCompressedBytes(to) <=
      params.combinedByteBudget &&
    historicalRuntimeCombinedSplatsWithinBudget(
      params.fromSplatCount,
      params.toSplatCount,
      params.combinedSplatBudget,
    );
}

export function historicalRuntimeBindingWithinViewerBudget(
  binding: PhaseLayoutRuntimeAvailableBinding,
): boolean {
  return binding.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
    historicalRuntimeCompressedBytes(binding) <= HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET;
}

export function historicalRuntimeResourceCanRender<TResource>(params: {
  readonly displayKey: string | null;
  readonly activeKey: string | null;
  readonly activeStatus: HistoricalRuntimeCacheStatus | null;
  readonly displayedResource: TResource | null;
  readonly activeResource: TResource | null;
}): boolean {
  return params.activeKey !== null &&
    params.displayKey === params.activeKey &&
    params.activeStatus === "ready" &&
    params.displayedResource !== null &&
    params.activeResource === params.displayedResource;
}

/**
 * Two-binding window backed by at most two decoded room resources. Exact
 * binding records retain their own authorization state, while byte-identical
 * aliases share one decoded resource inside the same venue/space scope.
 */
export class HistoricalRuntimeCache<TResource> {
  readonly #dependencies: HistoricalRuntimeCacheDependencies<TResource>;
  readonly #records = new Map<string, MutableBindingRecord<TResource>>();
  readonly #resources = new Map<string, MutableResourceRecord<TResource>>();
  readonly #listeners = new Set<() => void>();
  #generation = 0;
  #revision = 0;
  #lifecycleError: HistoricalRuntimeLifecycleError | null = null;
  #snapshot: HistoricalRuntimeCacheSnapshot<TResource> = {
    revision: 0,
    records: new Map(),
    lifecycleError: null,
  };
  #fetchTail: Promise<void> = Promise.resolve();
  #decodeTail: Promise<void> = Promise.resolve();
  #activeKey: string | null = null;

  constructor(dependencies: HistoricalRuntimeCacheDependencies<TResource>) {
    this.#dependencies = dependencies;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  readonly getSnapshot = (): HistoricalRuntimeCacheSnapshot<TResource> => this.#snapshot;

  setWindow(window: HistoricalRuntimeCacheWindow): void {
    const activeFitsBudget = window.active === null ||
      historicalRuntimeBindingWithinViewerBudget(window.active);
    const activeBinding = activeFitsBudget ? window.active : null;
    const activeKey = activeBinding === null ? null : historicalRuntimeBindingKey(activeBinding);
    const activeResourceKey = activeBinding === null
      ? null
      : historicalRuntimeResourceKey(activeBinding);
    const requestedAdjacentKey = window.adjacent === null
      ? null
      : historicalRuntimeBindingKey(window.adjacent);
    const requestedAdjacentResourceKey = window.adjacent === null
      ? null
      : historicalRuntimeResourceKey(window.adjacent);
    const adjacentSharesResource = activeResourceKey !== null &&
      requestedAdjacentResourceKey === activeResourceKey;
    const adjacentFitsBudget = activeBinding !== null && window.adjacent !== null &&
      historicalRuntimeBindingWithinViewerBudget(window.adjacent) &&
      (adjacentSharesResource ||
        historicalRuntimeCompressedBytes(activeBinding)
          + historicalRuntimeCompressedBytes(window.adjacent)
          <= HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET);
    const adjacentBinding = adjacentFitsBudget ? window.adjacent : null;
    const adjacentKey = adjacentBinding === null ? null : requestedAdjacentKey;

    this.#activeKey = activeKey;
    const allowedBindingKeys = new Set<string>();
    const allowedResourceKeys = new Set<string>();
    let activeRecord: MutableBindingRecord<TResource> | null = null;
    let adjacentRecord: MutableBindingRecord<TResource> | null = null;

    if (activeBinding !== null && activeKey !== null && activeResourceKey !== null) {
      allowedBindingKeys.add(activeKey);
      allowedResourceKeys.add(activeResourceKey);
      activeRecord = this.#recordFor(activeBinding);
    }
    if (
      adjacentBinding !== null &&
      adjacentKey !== null &&
      adjacentKey !== activeKey &&
      requestedAdjacentResourceKey !== null
    ) {
      allowedBindingKeys.add(adjacentKey);
      allowedResourceKeys.add(requestedAdjacentResourceKey);
      adjacentRecord = this.#recordFor(adjacentBinding);
    }

    for (const [key, record] of this.#records) {
      if (allowedBindingKeys.has(key)) continue;
      this.#evictBindingRecord(record);
      this.#records.delete(key);
    }
    for (const [key, resource] of this.#resources) {
      if (allowedResourceKeys.has(key)) continue;
      this.#evictResourceRecord(resource);
      this.#resources.delete(key);
    }

    if (activeRecord !== null) {
      this.#cancelVerifiedExpiry(activeRecord);
      void this.#ensureReady(activeRecord);
    }
    if (adjacentRecord !== null) {
      if (window.decodeAdjacent) {
        void this.#ensureReady(adjacentRecord);
      } else {
        void this.#ensureFetched(adjacentRecord).catch(() => undefined);
      }
    }
    this.#publish();
  }

  clear(): void {
    this.#activeKey = null;
    for (const record of this.#records.values()) this.#evictBindingRecord(record);
    this.#records.clear();
    for (const resource of this.#resources.values()) this.#evictResourceRecord(resource);
    this.#resources.clear();
    this.#publish();
  }

  #recordFor(
    binding: PhaseLayoutRuntimeAvailableBinding,
  ): MutableBindingRecord<TResource> {
    const key = historicalRuntimeBindingKey(binding);
    const existing = this.#records.get(key);
    if (existing !== undefined && existing.status !== "error") return existing;
    if (existing !== undefined) {
      this.#evictBindingRecord(existing);
      this.#records.delete(key);
    }
    const record: MutableBindingRecord<TResource> = {
      key,
      resourceKey: historicalRuntimeResourceKey(binding),
      binding,
      generation: ++this.#generation,
      controller: new AbortController(),
      status: "fetching",
      verifiedAssets: null,
      error: null,
      fetchPromise: null,
      readyPromise: null,
      verifiedExpiryTimer: null,
    };
    this.#records.set(key, record);
    return record;
  }

  #resourceFor(resourceKey: string): MutableResourceRecord<TResource> {
    const existing = this.#resources.get(resourceKey);
    if (
      existing !== undefined &&
      existing.error === null &&
      !existing.controller.signal.aborted
    ) return existing;
    if (existing !== undefined) {
      this.#evictResourceRecord(existing);
      this.#resources.delete(resourceKey);
    }
    const resource: MutableResourceRecord<TResource> = {
      key: resourceKey,
      generation: ++this.#generation,
      controller: new AbortController(),
      resource: null,
      decodePromise: null,
      error: null,
    };
    this.#resources.set(resourceKey, resource);
    return resource;
  }

  #isBindingCurrent(record: MutableBindingRecord<TResource>): boolean {
    const current = this.#records.get(record.key);
    return current === record &&
      current.generation === record.generation &&
      !record.controller.signal.aborted;
  }

  #isResourceCurrent(record: MutableResourceRecord<TResource>): boolean {
    const current = this.#resources.get(record.key);
    return current === record &&
      current.generation === record.generation &&
      !record.controller.signal.aborted;
  }

  #ensureFetched(
    record: MutableBindingRecord<TResource>,
  ): Promise<readonly VerifiedHistoricalRuntimeAsset[]> {
    if (record.verifiedAssets !== null) return Promise.resolve(record.verifiedAssets);
    if (record.fetchPromise !== null) return record.fetchPromise;

    record.status = "fetching";
    record.error = null;
    this.#publish();
    const job = async (): Promise<readonly VerifiedHistoricalRuntimeAsset[]> => {
      if (!this.#isBindingCurrent(record)) throw new DOMException("Aborted", "AbortError");
      const assets: VerifiedHistoricalRuntimeAsset[] = [];
      for (const member of record.binding.visualAssets) {
        if (!this.#isBindingCurrent(record)) throw new DOMException("Aborted", "AbortError");
        assets.push(await this.#dependencies.fetchMember(
          record.binding,
          member,
          record.controller.signal,
        ));
      }
      if (!this.#isBindingCurrent(record)) throw new DOMException("Aborted", "AbortError");
      record.verifiedAssets = assets;
      record.status = "verified";
      if (record.key !== this.#activeKey && record.readyPromise === null) {
        this.#scheduleVerifiedExpiry(record);
      }
      this.#publish();
      return assets;
    };
    const queued = this.#fetchTail.then(job, job);
    this.#fetchTail = queued.then(() => undefined, () => undefined);
    const promise = queued.catch((value: unknown) => {
      if (this.#isBindingCurrent(record)) {
        record.error = asError(value);
        record.status = "error";
        this.#publish();
      }
      throw value;
    });
    record.fetchPromise = promise;
    void promise.then(
      () => {
        if (record.fetchPromise === promise) record.fetchPromise = null;
      },
      () => {
        if (record.fetchPromise === promise) record.fetchPromise = null;
      },
    );
    return promise;
  }

  #ensureReady(record: MutableBindingRecord<TResource>): Promise<TResource | null> {
    const existingResource = this.#resources.get(record.resourceKey)?.resource ?? null;
    if (record.status === "ready" && existingResource !== null) {
      return Promise.resolve(existingResource);
    }
    if (record.readyPromise !== null) return record.readyPromise;
    this.#cancelVerifiedExpiry(record);
    const verifiedAssets = this.#ensureFetched(record);

    const job = async (): Promise<TResource | null> => {
      let assets: readonly VerifiedHistoricalRuntimeAsset[];
      try {
        assets = await verifiedAssets;
      } catch {
        return null;
      }
      if (!this.#isBindingCurrent(record)) return null;

      const shared = this.#resourceFor(record.resourceKey);
      let resource = shared.resource;
      if (resource === null) {
        record.status = "decoding";
        this.#publish();
        try {
          resource = await this.#ensureResourceDecoded(
            shared,
            record.binding,
            assets,
          );
        } catch (value: unknown) {
          if (value instanceof HistoricalRuntimeLifecycleError) {
            this.#recordLifecycleError();
          }
          if (this.#isBindingCurrent(record)) {
            record.error = value instanceof HistoricalRuntimeLifecycleError
              ? new HistoricalRuntimeLifecycleError()
              : asError(value);
            record.status = "error";
            record.verifiedAssets = null;
            this.#publish();
          }
          return null;
        }
      }

      if (!this.#isBindingCurrent(record) || resource === null) return null;
      record.verifiedAssets = null;
      this.#cancelVerifiedExpiry(record);
      record.status = "ready";
      record.error = null;
      this.#publish();
      return resource;
    };

    record.readyPromise = job();
    const promise = record.readyPromise;
    void promise.then(
      () => {
        if (record.readyPromise === promise) record.readyPromise = null;
      },
      () => {
        if (record.readyPromise === promise) record.readyPromise = null;
      },
    );
    return promise;
  }

  #ensureResourceDecoded(
    record: MutableResourceRecord<TResource>,
    binding: PhaseLayoutRuntimeAvailableBinding,
    assets: readonly VerifiedHistoricalRuntimeAsset[],
  ): Promise<TResource | null> {
    if (record.resource !== null) return Promise.resolve(record.resource);
    if (record.decodePromise !== null) return record.decodePromise;

    const job = async (): Promise<TResource | null> => {
      if (!this.#isResourceCurrent(record)) return null;
      let resource: TResource;
      try {
        resource = await this.#decodeWithinDeadline(record, binding, assets);
      } catch (value: unknown) {
        if (value instanceof HistoricalRuntimeLifecycleError) {
          this.#recordLifecycleError();
        }
        if (this.#resources.get(record.key) === record) record.error = asError(value);
        throw value;
      }
      if (!this.#isResourceCurrent(record)) {
        this.#disposeResourceSafely(resource);
        return null;
      }
      record.resource = resource;
      record.error = null;
      return resource;
    };

    const queued = this.#decodeTail.then(job, job);
    this.#decodeTail = queued.then(() => undefined, () => undefined);
    record.decodePromise = queued;
    void queued.then(
      () => {
        if (record.decodePromise === queued) record.decodePromise = null;
      },
      () => {
        if (record.decodePromise === queued) record.decodePromise = null;
      },
    );
    return queued;
  }

  async #decodeWithinDeadline(
    record: MutableResourceRecord<TResource>,
    binding: PhaseLayoutRuntimeAvailableBinding,
    assets: readonly VerifiedHistoricalRuntimeAsset[],
  ): Promise<TResource> {
    const signal = record.controller.signal;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const timeoutMs = Math.max(
      1,
      this.#dependencies.decodeTimeoutMs ?? HISTORICAL_RUNTIME_DECODE_TIMEOUT_MS,
    );
    let rejectAbort = (_error: DOMException): void => undefined;
    const onAbort = (): void => {
      rejectAbort(new DOMException("Aborted", "AbortError"));
    };
    const abort = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
      signal.addEventListener("abort", onAbort, { once: true });
    });
    let rejectDeadline = (_error: Error): void => undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timeoutId = setTimeout(() => {
      rejectDeadline(new Error(HISTORICAL_RUNTIME_DECODE_TIMEOUT_ERROR_MESSAGE));
      record.controller.abort();
    }, timeoutMs);
    const decode = Promise.resolve().then(() => this.#dependencies.decode(
      binding,
      assets,
      signal,
    ));

    try {
      return await Promise.race([decode, abort, deadline]);
    } catch (value: unknown) {
      void decode.then(
        (lateResource) => { this.#disposeResourceSafely(lateResource); },
        () => undefined,
      );
      throw value;
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    }
  }

  #evictBindingRecord(record: MutableBindingRecord<TResource>): void {
    record.controller.abort();
    this.#cancelVerifiedExpiry(record);
    record.verifiedAssets = null;
  }

  #evictResourceRecord(record: MutableResourceRecord<TResource>): void {
    record.controller.abort();
    if (record.resource !== null) {
      this.#disposeResourceSafely(record.resource);
      record.resource = null;
    }
  }

  #disposeResourceSafely(resource: TResource): void {
    try {
      this.#dependencies.dispose(resource);
    } catch {
      this.#recordLifecycleError();
    }
  }

  #recordLifecycleError(): void {
    if (this.#lifecycleError !== null) return;
    const error = new HistoricalRuntimeLifecycleError();
    this.#lifecycleError = error;
    try {
      this.#dependencies.onLifecycleError?.(error);
    } catch {
      // Quarantine reporting cannot interrupt remaining cache cleanup.
    }
    this.#publish();
  }

  #scheduleVerifiedExpiry(record: MutableBindingRecord<TResource>): void {
    this.#cancelVerifiedExpiry(record);
    record.verifiedExpiryTimer = setTimeout(() => {
      record.verifiedExpiryTimer = null;
      if (
        !this.#isBindingCurrent(record) ||
        record.key === this.#activeKey ||
        record.readyPromise !== null ||
        record.status !== "verified"
      ) return;
      this.#evictBindingRecord(record);
      this.#records.delete(record.key);
      this.#evictUnusedResources();
      this.#publish();
    }, HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS);
  }

  #evictUnusedResources(): void {
    const retained = new Set(
      Array.from(this.#records.values(), (record) => record.resourceKey),
    );
    for (const [key, resource] of this.#resources) {
      if (retained.has(key)) continue;
      this.#evictResourceRecord(resource);
      this.#resources.delete(key);
    }
  }

  #cancelVerifiedExpiry(record: MutableBindingRecord<TResource>): void {
    if (record.verifiedExpiryTimer === null) return;
    clearTimeout(record.verifiedExpiryTimer);
    record.verifiedExpiryTimer = null;
  }

  #publish(): void {
    const records = new Map<string, HistoricalRuntimeCacheRecord<TResource>>();
    for (const [key, record] of this.#records) {
      const resource = this.#resources.get(record.resourceKey)?.resource ?? null;
      records.set(key, {
        key,
        resourceKey: record.resourceKey,
        binding: record.binding,
        status: record.status,
        resource: record.status === "ready" ? resource : null,
        error: record.error,
      });
    }
    this.#revision += 1;
    this.#snapshot = {
      revision: this.#revision,
      records,
      lifecycleError: this.#lifecycleError,
    };
    for (const listener of this.#listeners) listener();
  }
}
