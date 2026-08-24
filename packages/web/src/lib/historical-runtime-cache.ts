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
  readonly records: ReadonlyMap<
    string,
    HistoricalRuntimeCacheRecord<TResource>
  >;
}

export interface HistoricalRuntimeCacheDependencies<TResource> {
  readonly authorizeBinding: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    signal: AbortSignal,
  ) => Promise<void>;
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

interface MutableBindingRecord {
  readonly key: string;
  readonly binding: PhaseLayoutRuntimeAvailableBinding;
  readonly resourceKey: string;
  readonly generation: number;
  readonly controller: AbortController;
  authorizationStatus: "authorizing" | "authorized" | "error";
  authorizationPromise: Promise<void> | null;
  error: Error | null;
}

interface MutableResourceRecord<TResource> {
  readonly key: string;
  readonly ownerBinding: PhaseLayoutRuntimeAvailableBinding;
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
  /** Reject stale or malformed bindings before private member bytes are requested. */
  readonly expectedRoom?: {
    readonly venueId: string;
    readonly spaceId: string;
  };
}

export interface HistoricalRuntimeCacheScopeInput {
  readonly user: {
    readonly id: string;
    readonly venueId: string | null;
    readonly role: string;
    readonly platformRole: string;
  } | null;
  readonly venueId: string | null;
  readonly spaceId: string | null;
  /** Clerk session identity; null only for explicitly sessionless/dev auth. */
  readonly authSessionId: string | null;
  readonly authContextRevision: number;
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
  return (
    Number.isInteger(decodedSplats) &&
    decodedSplats >= 0 &&
    decodedSplats <= maxSplats
  );
}

export function historicalRuntimeCombinedSplatsWithinBudget(
  activeSplats: number,
  adjacentSplats: number,
  combinedBudget: number,
): boolean {
  return (
    historicalRuntimeDecodedSplatsWithinViewerBudget(
      activeSplats,
      combinedBudget,
    ) &&
    historicalRuntimeDecodedSplatsWithinViewerBudget(
      adjacentSplats,
      combinedBudget,
    ) &&
    activeSplats + adjacentSplats <= combinedBudget
  );
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
  if (
    !historicalRuntimeDecodedSplatsWithinViewerBudget(
      params.activeSplatCount,
      residentBudget,
    )
  )
    return 0;
  return residentBudget - params.activeSplatCount;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function historicalRuntimeOrderedMemberIdentity(
  binding: PhaseLayoutRuntimeAvailableBinding,
): readonly (readonly [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
])[] {
  return binding.visualAssets.map(
    (member) =>
      [
        member.memberIndex,
        member.assetVersionId,
        member.fileName,
        member.fileExt,
        member.mimeType,
        member.sha256,
        member.sizeBytes,
      ] as const,
  );
}

/** Identity includes every frozen binding proof and exact ordered member. */
export function historicalRuntimeBindingKey(
  binding: PhaseLayoutRuntimeAvailableBinding,
): string {
  return JSON.stringify([
    binding.venueId,
    binding.spaceId,
    binding.bindingId,
    binding.bindingDigest,
    binding.runtimePackageId,
    binding.runtimePackageContentDigest,
    binding.compositionDigest,
    binding.transformArtifactDigest,
    historicalRuntimeOrderedMemberIdentity(binding),
  ]);
}

/**
 * Exact decoded room identity. Snapshot/binding/package database IDs stay
 * outside this key because each binding is authorized separately before
 * sharing identical captured content and decoder-visible ordered members.
 */
export function historicalRuntimeResourceKey(
  binding: PhaseLayoutRuntimeAvailableBinding,
): string {
  return JSON.stringify([
    binding.venueId,
    binding.spaceId,
    binding.transformArtifactDigest,
    historicalRuntimeOrderedMemberIdentity(binding),
  ]);
}

/**
 * Decoder-visible captured-room identity. Database aliases and nonvisual
 * package members are deliberately excluded: neither can justify a visual
 * room crossfade. Exact transform equality is still checked separately by the
 * crossfade policy.
 */
export function historicalRuntimeCapturedVisualKey(
  binding: PhaseLayoutRuntimeAvailableBinding,
): string {
  return JSON.stringify([
    binding.venueId,
    binding.spaceId,
    binding.transformArtifactDigest,
    binding.visualAssets.map((member) => [
      member.memberIndex,
      member.fileExt,
      member.mimeType,
      member.sha256,
      member.sizeBytes,
    ]),
  ]);
}

/** Private browser-memory ownership, including claims that can change for the same user. */
export function historicalRuntimeCacheScopeKey(
  input: HistoricalRuntimeCacheScopeInput,
): string | null {
  if (input.user === null || input.venueId === null || input.spaceId === null)
    return null;
  return JSON.stringify([
    input.user.id,
    input.user.venueId,
    input.user.role,
    input.user.platformRole,
    input.venueId,
    input.spaceId,
    input.authSessionId,
    input.authContextRevision,
  ]);
}

export function historicalRuntimeBindingMatchesRoom(
  binding: PhaseLayoutRuntimeAvailableBinding,
  room: { readonly venueId: string; readonly spaceId: string },
): boolean {
  return binding.venueId === room.venueId && binding.spaceId === room.spaceId;
}

export function historicalRuntimeCompressedBytes(
  binding: PhaseLayoutRuntimeAvailableBinding,
): number {
  return binding.visualAssets.reduce(
    (total, member) => total + member.sizeBytes,
    0,
  );
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
  return (
    !params.reducedMotion &&
    params.sameEnvelope &&
    // Resource identity is deliberately stricter than captured-visual
    // identity (it includes ordered member aliases/versions). Package content
    // digests also bind nonvisual members and evidence, so only a changed
    // decoder-visible capture can justify a visual crossfade.
    historicalRuntimeCapturedVisualKey(from) !==
      historicalRuntimeCapturedVisualKey(to) &&
    historicalRuntimeResourceKey(from) !== historicalRuntimeResourceKey(to) &&
    from.venueId === to.venueId &&
    from.spaceId === to.spaceId &&
    from.transformArtifactId === to.transformArtifactId &&
    from.transformArtifactDigest === to.transformArtifactDigest &&
    historicalRuntimeCompressedBytes(from) +
      historicalRuntimeCompressedBytes(to) <=
      params.combinedByteBudget &&
    historicalRuntimeCombinedSplatsWithinBudget(
      params.fromSplatCount,
      params.toSplatCount,
      params.combinedSplatBudget,
    )
  );
}

export function historicalRuntimeBindingWithinViewerBudget(
  binding: PhaseLayoutRuntimeAvailableBinding,
): boolean {
  return (
    binding.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
    historicalRuntimeCompressedBytes(binding) <=
      HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET
  );
}

export function historicalRuntimeResourceCanRender<TResource>(params: {
  readonly displayKey: string | null;
  readonly activeKey: string | null;
  readonly activeStatus: HistoricalRuntimeCacheStatus | null;
  readonly displayedResource: TResource | null;
  readonly activeResource: TResource | null;
}): boolean {
  return (
    params.activeKey !== null &&
    params.displayKey === params.activeKey &&
    params.activeStatus === "ready" &&
    params.displayedResource !== null &&
    params.activeResource === params.displayedResource
  );
}

/**
 * Binding authorization records and decoded package resources have separate
 * identities. Snapshot bindings are authorized independently while identical
 * immutable room content shares one bounded fetch/decode/resource.
 */
export class HistoricalRuntimeCache<TResource> {
  readonly #dependencies: HistoricalRuntimeCacheDependencies<TResource>;
  readonly #bindings = new Map<string, MutableBindingRecord>();
  readonly #resources = new Map<string, MutableResourceRecord<TResource>>();
  readonly #authorizedBindingKeys = new Set<string>();
  readonly #listeners = new Set<() => void>();
  #generation = 0;
  #revision = 0;
  #snapshot: HistoricalRuntimeCacheSnapshot<TResource> = {
    revision: 0,
    records: new Map(),
  };
  #fetchTail: Promise<void> = Promise.resolve();
  #decodeTail: Promise<void> = Promise.resolve();
  #activeResourceKey: string | null = null;
  #scopeKey: string | null = null;

  constructor(dependencies: HistoricalRuntimeCacheDependencies<TResource>) {
    this.#dependencies = dependencies;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): HistoricalRuntimeCacheSnapshot<TResource> =>
    this.#snapshot;

  /** Same-scope Day/Week views reuse resources; auth or selected-room changes retire them. */
  setScope(scopeKey: string | null): void {
    if (scopeKey === this.#scopeKey) return;
    this.#scopeKey = scopeKey;
    this.clear();
  }

  setWindow(window: HistoricalRuntimeCacheWindow): void {
    const roomMatches = (
      binding: PhaseLayoutRuntimeAvailableBinding | null,
    ): boolean =>
      binding !== null &&
      (window.expectedRoom === undefined ||
        historicalRuntimeBindingMatchesRoom(binding, window.expectedRoom));
    const requestedActive = roomMatches(window.active) ? window.active : null;
    const requestedAdjacent = roomMatches(window.adjacent)
      ? window.adjacent
      : null;
    const activeFitsBudget =
      requestedActive === null ||
      historicalRuntimeBindingWithinViewerBudget(requestedActive);
    const activeBinding = activeFitsBudget ? requestedActive : null;
    const activeBindingKey =
      activeBinding === null
        ? null
        : historicalRuntimeBindingKey(activeBinding);
    const activeResourceKey =
      activeBinding === null
        ? null
        : historicalRuntimeResourceKey(activeBinding);
    const adjacentBindingKey =
      requestedAdjacent === null
        ? null
        : historicalRuntimeBindingKey(requestedAdjacent);
    const adjacentResourceKey =
      requestedAdjacent === null
        ? null
        : historicalRuntimeResourceKey(requestedAdjacent);
    const adjacentAdditionalBytes =
      activeResourceKey !== null && adjacentResourceKey === activeResourceKey
        ? 0
        : requestedAdjacent === null
          ? 0
          : historicalRuntimeCompressedBytes(requestedAdjacent);
    const adjacentFitsBudget =
      activeBinding !== null &&
      requestedAdjacent !== null &&
      requestedAdjacent.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
      historicalRuntimeCompressedBytes(activeBinding) +
        adjacentAdditionalBytes <=
        HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET;
    const admittedAdjacentBindingKey = adjacentFitsBudget
      ? adjacentBindingKey
      : null;
    const admittedAdjacentResourceKey = adjacentFitsBudget
      ? adjacentResourceKey
      : null;
    this.#activeResourceKey = activeResourceKey;

    const allowedBindings = new Set<string>();
    const allowedResources = new Set<string>();
    if (activeBindingKey !== null && activeResourceKey !== null) {
      allowedBindings.add(activeBindingKey);
      allowedResources.add(activeResourceKey);
    }
    if (
      admittedAdjacentBindingKey !== null &&
      admittedAdjacentResourceKey !== null
    ) {
      allowedBindings.add(admittedAdjacentBindingKey);
      allowedResources.add(admittedAdjacentResourceKey);
    }

    for (const [key, binding] of this.#bindings) {
      if (allowedBindings.has(key)) continue;
      this.#evictBinding(binding);
      this.#bindings.delete(key);
    }
    for (const [key, resource] of this.#resources) {
      if (allowedResources.has(key)) continue;
      this.#evictResource(resource);
      this.#resources.delete(key);
    }

    if (activeBinding !== null) {
      const resource = this.#resourceFor(activeBinding);
      const active = this.#bindingFor(activeBinding, resource);
      this.#cancelVerifiedExpiry(resource);
      void this.#ensureReady(active, resource);
    }
    if (
      activeBinding !== null &&
      requestedAdjacent !== null &&
      admittedAdjacentBindingKey !== null &&
      admittedAdjacentBindingKey !== activeBindingKey
    ) {
      const resource = this.#resourceFor(requestedAdjacent);
      const adjacent = this.#bindingFor(requestedAdjacent, resource);
      if (resource.key === activeResourceKey) {
        void this.#ensureAuthorized(adjacent, resource).catch(() => undefined);
      } else if (window.decodeAdjacent) {
        void this.#ensureReady(adjacent, resource);
      } else {
        void this.#ensureAuthorized(adjacent, resource).catch(() => undefined);
        void this.#ensureFetched(resource).catch(() => undefined);
      }
    }
    this.#publish();
  }

  clear(): void {
    this.#activeResourceKey = null;
    for (const binding of this.#bindings.values()) this.#evictBinding(binding);
    for (const resource of this.#resources.values())
      this.#evictResource(resource);
    this.#bindings.clear();
    this.#resources.clear();
    this.#authorizedBindingKeys.clear();
    this.#publish();
  }

  #resourceFor(
    binding: PhaseLayoutRuntimeAvailableBinding,
  ): MutableResourceRecord<TResource> {
    const key = historicalRuntimeResourceKey(binding);
    const existing = this.#resources.get(key);
    if (existing !== undefined && existing.status !== "error") return existing;
    if (existing !== undefined) {
      this.#evictResource(existing);
      this.#resources.delete(key);
    }
    const resource: MutableResourceRecord<TResource> = {
      key,
      ownerBinding: binding,
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
    this.#resources.set(key, resource);
    return resource;
  }

  #bindingFor(
    binding: PhaseLayoutRuntimeAvailableBinding,
    resource: MutableResourceRecord<TResource>,
  ): MutableBindingRecord {
    const key = historicalRuntimeBindingKey(binding);
    const existing = this.#bindings.get(key);
    if (
      existing !== undefined &&
      existing.authorizationStatus !== "error" &&
      existing.resourceKey === resource.key
    )
      return existing;
    if (existing !== undefined) {
      this.#evictBinding(existing);
      this.#bindings.delete(key);
    }
    const authorized = this.#authorizedBindingKeys.has(key);
    const record: MutableBindingRecord = {
      key,
      binding,
      resourceKey: resource.key,
      generation: ++this.#generation,
      controller: new AbortController(),
      authorizationStatus: authorized ? "authorized" : "authorizing",
      authorizationPromise: null,
      error: null,
    };
    this.#bindings.set(key, record);
    return record;
  }

  #isCurrentBinding(record: MutableBindingRecord): boolean {
    const current = this.#bindings.get(record.key);
    return (
      current === record &&
      current.generation === record.generation &&
      !record.controller.signal.aborted
    );
  }

  #isCurrentResource(record: MutableResourceRecord<TResource>): boolean {
    const current = this.#resources.get(record.key);
    return (
      current === record &&
      current.generation === record.generation &&
      !record.controller.signal.aborted
    );
  }

  #rememberAuthorizedBinding(key: string): void {
    this.#authorizedBindingKeys.delete(key);
    this.#authorizedBindingKeys.add(key);
    while (this.#authorizedBindingKeys.size > 64) {
      const oldest = this.#authorizedBindingKeys.values().next();
      if (oldest.done === true) break;
      this.#authorizedBindingKeys.delete(oldest.value);
    }
  }

  #ensureAuthorized(
    record: MutableBindingRecord,
    resource: MutableResourceRecord<TResource>,
  ): Promise<void> {
    if (record.authorizationStatus === "authorized") return Promise.resolve();
    if (record.authorizationPromise !== null)
      return record.authorizationPromise;
    record.authorizationStatus = "authorizing";
    record.error = null;
    this.#publish();
    const ownerKey = historicalRuntimeBindingKey(resource.ownerBinding);
    const authorization =
      record.key === ownerKey
        ? this.#ensureFetched(resource).then(() => undefined)
        : this.#dependencies.authorizeBinding(
            record.binding,
            record.controller.signal,
          );
    const promise = authorization.then(
      () => {
        if (
          !this.#isCurrentBinding(record) ||
          !this.#isCurrentResource(resource)
        ) {
          throw new DOMException("Aborted", "AbortError");
        }
        this.#rememberAuthorizedBinding(record.key);
        record.authorizationStatus = "authorized";
        record.error = null;
        this.#publish();
      },
      (value: unknown) => {
        if (this.#isCurrentBinding(record)) {
          record.authorizationStatus = "error";
          record.error = asError(value);
          this.#publish();
        }
        throw value;
      },
    );
    record.authorizationPromise = promise;
    void promise.then(
      () => {
        if (record.authorizationPromise === promise)
          record.authorizationPromise = null;
      },
      () => {
        if (record.authorizationPromise === promise)
          record.authorizationPromise = null;
      },
    );
    return promise;
  }

  #ensureFetched(
    record: MutableResourceRecord<TResource>,
  ): Promise<readonly VerifiedHistoricalRuntimeAsset[]> {
    if (record.verifiedAssets !== null)
      return Promise.resolve(record.verifiedAssets);
    if (record.fetchPromise !== null) return record.fetchPromise;

    record.status = "fetching";
    record.error = null;
    this.#publish();
    const job = async (): Promise<
      readonly VerifiedHistoricalRuntimeAsset[]
    > => {
      if (!this.#isCurrentResource(record))
        throw new DOMException("Aborted", "AbortError");
      const assets: VerifiedHistoricalRuntimeAsset[] = [];
      for (const member of record.ownerBinding.visualAssets) {
        if (!this.#isCurrentResource(record))
          throw new DOMException("Aborted", "AbortError");
        assets.push(
          await this.#dependencies.fetchMember(
            record.ownerBinding,
            member,
            record.controller.signal,
          ),
        );
      }
      if (!this.#isCurrentResource(record))
        throw new DOMException("Aborted", "AbortError");
      this.#rememberAuthorizedBinding(
        historicalRuntimeBindingKey(record.ownerBinding),
      );
      record.verifiedAssets = assets;
      record.status = "verified";
      if (
        record.key !== this.#activeResourceKey &&
        record.decodePromise === null
      ) {
        this.#scheduleVerifiedExpiry(record);
      }
      this.#publish();
      return assets;
    };
    const queued = this.#fetchTail.then(job, job);
    this.#fetchTail = queued.then(
      () => undefined,
      () => undefined,
    );
    const promise = queued.catch((value: unknown) => {
      if (this.#isCurrentResource(record)) {
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

  #ensureDecoded(
    record: MutableResourceRecord<TResource>,
  ): Promise<TResource | null> {
    if (record.resource !== null) return Promise.resolve(record.resource);
    if (record.decodePromise !== null) return record.decodePromise;
    this.#cancelVerifiedExpiry(record);
    const verifiedAssets = this.#ensureFetched(record);

    const job = async (): Promise<TResource | null> => {
      let assets: readonly VerifiedHistoricalRuntimeAsset[];
      try {
        assets = await verifiedAssets;
      } catch {
        return null;
      }
      if (!this.#isCurrentResource(record)) return null;
      record.status = "decoding";
      this.#publish();

      let resource: TResource;
      try {
        resource = await this.#dependencies.decode(
          record.ownerBinding,
          assets,
          record.controller.signal,
        );
      } catch (value: unknown) {
        if (this.#isCurrentResource(record)) {
          record.error = asError(value);
          record.status = "error";
          record.verifiedAssets = null;
          this.#publish();
        }
        return null;
      }

      if (!this.#isCurrentResource(record)) {
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
    this.#decodeTail = queued.then(
      () => undefined,
      () => undefined,
    );
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

  async #ensureReady(
    binding: MutableBindingRecord,
    resource: MutableResourceRecord<TResource>,
  ): Promise<TResource | null> {
    const authorization = this.#ensureAuthorized(binding, resource).then(
      () => true,
      () => false,
    );
    const decoded = this.#ensureDecoded(resource);
    const [authorized, value] = await Promise.all([authorization, decoded]);
    return authorized ? value : null;
  }

  #evictBinding(record: MutableBindingRecord): void {
    record.controller.abort();
  }

  #evictResource(record: MutableResourceRecord<TResource>): void {
    record.controller.abort();
    this.#cancelVerifiedExpiry(record);
    if (record.resource !== null) {
      this.#dependencies.dispose(record.resource);
      record.resource = null;
    }
    record.verifiedAssets = null;
  }

  #scheduleVerifiedExpiry(record: MutableResourceRecord<TResource>): void {
    this.#cancelVerifiedExpiry(record);
    record.verifiedExpiryTimer = setTimeout(() => {
      record.verifiedExpiryTimer = null;
      if (
        !this.#isCurrentResource(record) ||
        record.key === this.#activeResourceKey ||
        record.decodePromise !== null ||
        record.resource !== null ||
        record.status !== "verified"
      )
        return;
      for (const [key, binding] of this.#bindings) {
        if (binding.resourceKey !== record.key) continue;
        this.#evictBinding(binding);
        this.#bindings.delete(key);
      }
      this.#evictResource(record);
      this.#resources.delete(record.key);
      this.#publish();
    }, HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS);
  }

  #cancelVerifiedExpiry(record: MutableResourceRecord<TResource>): void {
    if (record.verifiedExpiryTimer === null) return;
    clearTimeout(record.verifiedExpiryTimer);
    record.verifiedExpiryTimer = null;
  }

  #publish(): void {
    const records = new Map<string, HistoricalRuntimeCacheRecord<TResource>>();
    for (const [key, binding] of this.#bindings) {
      const resource = this.#resources.get(binding.resourceKey);
      const authorizationPending =
        binding.authorizationStatus === "authorizing";
      const authorizationFailed = binding.authorizationStatus === "error";
      const status: HistoricalRuntimeCacheStatus = authorizationFailed
        ? "error"
        : authorizationPending
          ? "fetching"
          : (resource?.status ?? "error");
      records.set(key, {
        key,
        binding: binding.binding,
        status,
        resource: status === "ready" ? (resource?.resource ?? null) : null,
        error: authorizationFailed ? binding.error : (resource?.error ?? null),
      });
    }
    this.#revision += 1;
    this.#snapshot = { revision: this.#revision, records };
    for (const listener of this.#listeners) listener();
  }
}

export interface HistoricalRuntimeAuthRevisionSource {
  readonly getState: () => { readonly authContextRevision: number };
  readonly subscribe: (
    listener: (state: { readonly authContextRevision: number }) => void,
  ) => () => void;
}

/** Abort private resources in the same synchronous store transition that changes auth. */
export function guardHistoricalRuntimeCacheAuthRevision<TResource>(
  cache: HistoricalRuntimeCache<TResource>,
  source: HistoricalRuntimeAuthRevisionSource,
  onClear?: () => void,
): () => void {
  let revision = source.getState().authContextRevision;
  return source.subscribe((state) => {
    if (state.authContextRevision === revision) return;
    revision = state.authContextRevision;
    cache.clear();
    onClear?.();
  });
}
