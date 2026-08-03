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
  readonly binding: PhaseLayoutRuntimeAvailableBinding;
  readonly status: HistoricalRuntimeCacheStatus;
  readonly resource: TResource | null;
  readonly error: Error | null;
}

export interface HistoricalRuntimeCacheSnapshot<TResource> {
  readonly revision: number;
  readonly records: ReadonlyMap<string, HistoricalRuntimeCacheRecord<TResource>>;
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
}

interface MutableRecord<TResource> {
  readonly key: string;
  readonly binding: PhaseLayoutRuntimeAvailableBinding;
  readonly generation: number;
  readonly controller: AbortController;
  status: HistoricalRuntimeCacheStatus;
  verifiedAssets: readonly VerifiedHistoricalRuntimeAsset[] | null;
  resource: TResource | null;
  error: Error | null;
  fetchPromise: Promise<readonly VerifiedHistoricalRuntimeAsset[]> | null;
  decodePromise: Promise<TResource | null> | null;
  verifiedExpiryTimer: ReturnType<typeof setTimeout> | null;
}

export interface HistoricalRuntimeCacheWindow {
  readonly active: PhaseLayoutRuntimeAvailableBinding | null;
  readonly adjacent: PhaseLayoutRuntimeAvailableBinding | null;
  readonly decodeAdjacent: boolean;
}

export const HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET =
  PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES;
export const HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS = 15_000;
export const HISTORICAL_RUNTIME_MAX_MEMBERS =
  PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS;
export const HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE = 4_000_000;
export const HISTORICAL_RUNTIME_CROSSFADE_SPLAT_BUDGET = 4_000_000;
export const HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET = 32 * 1_024 * 1_024;
export const HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET = 1_500_000;

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

/** Identity includes every frozen package, composition, transform, and scope proof. */
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
 * Two-entry cache for the selected package and, at most, one adjacent package.
 * Fetches dedupe per immutable binding, decode jobs are serialized globally,
 * and generation checks prevent evicted work from publishing across rooms.
 */
export class HistoricalRuntimeCache<TResource> {
  readonly #dependencies: HistoricalRuntimeCacheDependencies<TResource>;
  readonly #records = new Map<string, MutableRecord<TResource>>();
  readonly #listeners = new Set<() => void>();
  #generation = 0;
  #revision = 0;
  #snapshot: HistoricalRuntimeCacheSnapshot<TResource> = {
    revision: 0,
    records: new Map(),
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
    const requestedAdjacentKey = window.adjacent === null
      ? null
      : historicalRuntimeBindingKey(window.adjacent);
    const adjacentFitsBudget = activeBinding !== null && window.adjacent !== null &&
      window.adjacent.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
      historicalRuntimeCompressedBytes(activeBinding)
        + historicalRuntimeCompressedBytes(window.adjacent)
        <= HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET;
    const adjacentKey = adjacentFitsBudget ? requestedAdjacentKey : null;
    this.#activeKey = activeKey;
    const allowed = new Set<string>();
    if (activeKey !== null) allowed.add(activeKey);
    if (adjacentKey !== null && adjacentKey !== activeKey) allowed.add(adjacentKey);

    for (const [key, record] of this.#records) {
      if (allowed.has(key)) continue;
      this.#evictRecord(record);
      this.#records.delete(key);
    }

    if (activeBinding !== null) {
      const active = this.#recordFor(activeBinding);
      this.#cancelVerifiedExpiry(active);
      void this.#ensureDecoded(active);
    }
    if (activeBinding !== null && window.adjacent !== null && adjacentKey !== null && adjacentKey !== activeKey) {
      const adjacent = this.#recordFor(window.adjacent);
      if (window.decodeAdjacent) {
        void this.#ensureDecoded(adjacent);
      } else {
        void this.#ensureFetched(adjacent).catch(() => undefined);
      }
    }
    this.#publish();
  }

  clear(): void {
    this.#activeKey = null;
    for (const record of this.#records.values()) this.#evictRecord(record);
    this.#records.clear();
    this.#publish();
  }

  #recordFor(binding: PhaseLayoutRuntimeAvailableBinding): MutableRecord<TResource> {
    const key = historicalRuntimeBindingKey(binding);
    const existing = this.#records.get(key);
    if (existing !== undefined && existing.status !== "error") return existing;
    if (existing !== undefined) {
      this.#evictRecord(existing);
      this.#records.delete(key);
    }
    const record: MutableRecord<TResource> = {
      key,
      binding,
      generation: ++this.#generation,
      controller: new AbortController(),
      status: "fetching",
      verifiedAssets: null,
      resource: null,
      error: null,
      fetchPromise: null,
      decodePromise: null,
      verifiedExpiryTimer: null,
    };
    this.#records.set(key, record);
    return record;
  }

  #isCurrent(record: MutableRecord<TResource>): boolean {
    const current = this.#records.get(record.key);
    return current === record &&
      current.generation === record.generation &&
      !record.controller.signal.aborted;
  }

  #ensureFetched(
    record: MutableRecord<TResource>,
  ): Promise<readonly VerifiedHistoricalRuntimeAsset[]> {
    if (record.verifiedAssets !== null) return Promise.resolve(record.verifiedAssets);
    if (record.fetchPromise !== null) return record.fetchPromise;

    record.status = "fetching";
    record.error = null;
    this.#publish();
    const job = async (): Promise<readonly VerifiedHistoricalRuntimeAsset[]> => {
      if (!this.#isCurrent(record)) throw new DOMException("Aborted", "AbortError");
      const assets: VerifiedHistoricalRuntimeAsset[] = [];
      for (const member of record.binding.visualAssets) {
        if (!this.#isCurrent(record)) throw new DOMException("Aborted", "AbortError");
        assets.push(await this.#dependencies.fetchMember(
          record.binding,
          member,
          record.controller.signal,
        ));
      }
      if (!this.#isCurrent(record)) throw new DOMException("Aborted", "AbortError");
      record.verifiedAssets = assets;
      record.status = "verified";
      if (record.key !== this.#activeKey) this.#scheduleVerifiedExpiry(record);
      this.#publish();
      return assets;
    };
    const queued = this.#fetchTail.then(job, job);
    this.#fetchTail = queued.then(() => undefined, () => undefined);
    const promise = queued.catch((value: unknown) => {
      if (this.#isCurrent(record)) {
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

  #ensureDecoded(record: MutableRecord<TResource>): Promise<TResource | null> {
    if (record.resource !== null) return Promise.resolve(record.resource);
    if (record.decodePromise !== null) return record.decodePromise;
    // The verified-only TTL applies while an adjacent package is waiting to
    // be selected, not once a deliberately scheduled decode owns the bytes.
    this.#cancelVerifiedExpiry(record);

    const job = async (): Promise<TResource | null> => {
      let assets: readonly VerifiedHistoricalRuntimeAsset[];
      try {
        assets = await this.#ensureFetched(record);
      } catch {
        return null;
      }
      if (!this.#isCurrent(record)) return null;
      record.status = "decoding";
      this.#publish();

      let resource: TResource;
      try {
        resource = await this.#dependencies.decode(
          record.binding,
          assets,
          record.controller.signal,
        );
      } catch (value: unknown) {
        if (this.#isCurrent(record)) {
          record.error = asError(value);
          record.status = "error";
          record.verifiedAssets = null;
          this.#publish();
        }
        return null;
      }

      if (!this.#isCurrent(record)) {
        this.#dependencies.dispose(resource);
        return null;
      }
      record.resource = resource;
      record.verifiedAssets = null;
      this.#cancelVerifiedExpiry(record);
      record.status = "ready";
      this.#publish();
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

  #evictRecord(record: MutableRecord<TResource>): void {
    record.controller.abort();
    this.#cancelVerifiedExpiry(record);
    if (record.resource !== null) {
      this.#dependencies.dispose(record.resource);
      record.resource = null;
    }
    record.verifiedAssets = null;
  }

  #scheduleVerifiedExpiry(record: MutableRecord<TResource>): void {
    this.#cancelVerifiedExpiry(record);
    record.verifiedExpiryTimer = setTimeout(() => {
      record.verifiedExpiryTimer = null;
      if (
        !this.#isCurrent(record) ||
        record.key === this.#activeKey ||
        record.resource !== null ||
        record.status !== "verified"
      ) return;
      record.controller.abort();
      record.verifiedAssets = null;
      this.#records.delete(record.key);
      this.#publish();
    }, HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS);
  }

  #cancelVerifiedExpiry(record: MutableRecord<TResource>): void {
    if (record.verifiedExpiryTimer === null) return;
    clearTimeout(record.verifiedExpiryTimer);
    record.verifiedExpiryTimer = null;
  }

  #publish(): void {
    const records = new Map<string, HistoricalRuntimeCacheRecord<TResource>>();
    for (const [key, record] of this.#records) {
      records.set(key, {
        key,
        binding: record.binding,
        status: record.status,
        resource: record.resource,
        error: record.error,
      });
    }
    this.#revision += 1;
    this.#snapshot = { revision: this.#revision, records };
    for (const listener of this.#listeners) listener();
  }
}
