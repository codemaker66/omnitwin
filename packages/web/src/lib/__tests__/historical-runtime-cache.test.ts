import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhaseLayoutRuntimeAvailableBinding } from "@omnitwin/types";
import type { VerifiedHistoricalRuntimeAsset } from "../../api/historical-runtime-assets.js";
import {
  HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
  HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
  HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
  HISTORICAL_RUNTIME_MAX_MEMBERS,
  HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
  HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS,
  HistoricalRuntimeCache,
  historicalRuntimeBindingKey,
  historicalRuntimeBindingMatchesRoom,
  historicalRuntimeCacheScopeKey,
  historicalRuntimeCapturedVisualKey,
  historicalRuntimeResourceKey,
  historicalRuntimeCombinedSplatsWithinBudget,
  historicalRuntimeCrossfadeAllowed,
  historicalRuntimeDecodedSplatsWithinViewerBudget,
  historicalRuntimeResourceCanRender,
  historicalRuntimeRemainingAdjacentSplatBudget,
  historicalRuntimeViewerCapacity,
  guardHistoricalRuntimeCacheAuthRevision,
} from "../historical-runtime-cache.js";
import { historicalRuntimeBindingFixture } from "../../test-utils/historical-runtime-binding.js";
import { useAuthStore } from "../../stores/auth-store.js";
import type { PlacedItem } from "../placement.js";

interface TestResource {
  readonly id: string;
  visible: boolean;
  disposeCount: number;
}

function verifiedAsset(
  binding: PhaseLayoutRuntimeAvailableBinding,
): VerifiedHistoricalRuntimeAsset {
  const member = binding.visualAssets[0];
  if (member === undefined) throw new Error("Fixture member missing");
  return { member, bytes: new ArrayBuffer(Math.min(member.sizeBytes, 8)) };
}

function resource(id: string): TestResource {
  return { id, visible: false, disposeCount: 0 };
}

function furniture(
  id: string,
  catalogueItemId: string,
  x: number,
  z: number,
): PlacedItem {
  return {
    id,
    catalogueItemId,
    label: "",
    x,
    y: 0,
    z,
    rotationY: 0,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

function cacheWith(params: {
  readonly authorizeBinding?: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly fetchMember?: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    signal: AbortSignal,
  ) => Promise<VerifiedHistoricalRuntimeAsset>;
  readonly decode?: (
    binding: PhaseLayoutRuntimeAvailableBinding,
    signal: AbortSignal,
  ) => Promise<TestResource>;
}) {
  const authorizeBinding = vi.fn(
    async (binding: PhaseLayoutRuntimeAvailableBinding, signal: AbortSignal) =>
      params.authorizeBinding?.(binding, signal),
  );
  const fetchMember = vi.fn(
    async (
      binding: PhaseLayoutRuntimeAvailableBinding,
      _member: PhaseLayoutRuntimeAvailableBinding["visualAssets"][number],
      signal: AbortSignal,
    ) => params.fetchMember?.(binding, signal) ?? verifiedAsset(binding),
  );
  const decode = vi.fn(
    async (
      binding: PhaseLayoutRuntimeAvailableBinding,
      _assets: readonly VerifiedHistoricalRuntimeAsset[],
      signal: AbortSignal,
    ) => params.decode?.(binding, signal) ?? resource(binding.bindingId),
  );
  const dispose = vi.fn((value: TestResource) => {
    value.visible = false;
    value.disposeCount += 1;
  });
  return {
    cache: new HistoricalRuntimeCache<TestResource>({
      authorizeBinding,
      fetchMember,
      decode,
      dispose,
    }),
    authorizeBinding,
    fetchMember,
    decode,
    dispose,
  };
}

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    authSessionId: null,
    authContextRevision: 0,
  });
});

describe("HistoricalRuntimeCache", () => {
  it("deduplicates one immutable binding fetch and decode", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const harness = cacheWith({});
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });

    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(binding))?.status,
      ).toBe("ready");
    });
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(harness.decode).toHaveBeenCalledOnce();
    harness.cache.clear();
  });

  it("reuses one immutable captured-content resource while Day and Week furniture changes", async () => {
    const dayFurniture = [
      furniture("day-table", "c95895c6-0051-5b5c-b1a9-353f47c366ca", 1, 2),
      furniture("day-chair", "4dad7281-1978-5e93-ad03-61f55bc6e2ca", 3, 2),
    ];
    const weekFurniture = [
      furniture("week-stage", "7fc7ee77-11e5-5bbb-b6c0-a46ca0571c54", 18, 8),
    ];
    const dayBinding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const weekBinding = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: dayBinding.runtimePackageContentDigest,
      sizeBytes: 1,
    });
    const scopeKey = historicalRuntimeCacheScopeKey({
      user: {
        id: "planner-1",
        venueId: dayBinding.venueId,
        role: "planner",
        platformRole: "none",
      },
      venueId: dayBinding.venueId,
      spaceId: dayBinding.spaceId,
      authSessionId: "session-day-week",
      authContextRevision: 1,
    });
    const harness = cacheWith({});
    harness.cache.setScope(scopeKey);
    harness.cache.setWindow({
      active: dayBinding,
      adjacent: weekBinding,
      decodeAdjacent: true,
      expectedRoom: {
        venueId: dayBinding.venueId,
        spaceId: dayBinding.spaceId,
      },
    });
    // An overlapping Week request supplies the same immutable room content even
    // though its furniture state is wholly different. `showPending` makes no
    // empty-window update between these views in the real layer.
    expect(dayFurniture).not.toEqual(weekFurniture);
    expect(weekBinding.phaseLayoutSnapshotId).not.toBe(
      dayBinding.phaseLayoutSnapshotId,
    );
    expect(weekBinding.runtimePackageId).not.toBe(dayBinding.runtimePackageId);
    expect(historicalRuntimeBindingKey(weekBinding)).not.toBe(
      historicalRuntimeBindingKey(dayBinding),
    );
    expect(historicalRuntimeResourceKey(weekBinding)).toBe(
      historicalRuntimeResourceKey(dayBinding),
    );
    const identicalCaptureTransitions = [
      { label: "forward", from: dayBinding, to: weekBinding },
      { label: "reverse", from: weekBinding, to: dayBinding },
      { label: "direct phase selection", from: dayBinding, to: weekBinding },
    ] as const;
    for (const transition of identicalCaptureTransitions) {
      expect(
        historicalRuntimeCrossfadeAllowed({
          from: transition.from,
          to: transition.to,
          sameEnvelope: true,
          reducedMotion: false,
          combinedByteBudget: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
          fromSplatCount: 1,
          toSplatCount: 1,
          combinedSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
        }),
        transition.label,
      ).toBe(false);
    }
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(dayBinding))?.status,
      ).toBe("ready");
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(weekBinding))?.status,
      ).toBe("ready");
    });
    const shared = harness.cache
      .getSnapshot()
      .records.get(historicalRuntimeBindingKey(dayBinding))?.resource;
    expect(shared).not.toBeNull();
    expect(
      harness.cache
        .getSnapshot()
        .records.get(historicalRuntimeBindingKey(weekBinding))?.resource,
    ).toBe(shared);
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(harness.decode).toHaveBeenCalledOnce();
    expect(harness.authorizeBinding).toHaveBeenCalledOnce();
    expect(harness.authorizeBinding).toHaveBeenCalledWith(
      weekBinding,
      expect.any(AbortSignal),
    );

    // Forward scrub, reverse scrub, then direct Week selection all retain the
    // exact same decoded resource and remembered per-binding authorization.
    for (const active of [weekBinding, dayBinding, weekBinding]) {
      harness.cache.setWindow({
        active,
        adjacent: null,
        decodeAdjacent: false,
        expectedRoom: { venueId: active.venueId, spaceId: active.spaceId },
      });
      await vi.waitFor(() => {
        expect(
          harness.cache
            .getSnapshot()
            .records.get(historicalRuntimeBindingKey(active))?.resource,
        ).toBe(shared);
      });
    }
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(harness.decode).toHaveBeenCalledOnce();
    expect(harness.authorizeBinding).toHaveBeenCalledOnce();
    harness.cache.clear();
  });

  it("reuses one same-package revision across distinct frozen snapshot bindings", async () => {
    const phaseOne = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const phaseTwo = historicalRuntimeBindingFixture({
      bindingId: "15111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "26222222-2222-4222-8222-222222222222",
      runtimePackageId: phaseOne.runtimePackageId,
      runtimePackageContentDigest: phaseOne.runtimePackageContentDigest,
      sizeBytes: 1,
    });
    expect(phaseTwo.phaseLayoutSnapshotId).not.toBe(
      phaseOne.phaseLayoutSnapshotId,
    );
    expect(phaseTwo.runtimePackageId).toBe(phaseOne.runtimePackageId);
    expect(historicalRuntimeBindingKey(phaseTwo)).not.toBe(
      historicalRuntimeBindingKey(phaseOne),
    );
    expect(historicalRuntimeResourceKey(phaseTwo)).toBe(
      historicalRuntimeResourceKey(phaseOne),
    );

    const harness = cacheWith({});
    harness.cache.setWindow({
      active: phaseOne,
      adjacent: phaseTwo,
      decodeAdjacent: true,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(phaseOne))?.status,
      ).toBe("ready");
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(phaseTwo))?.status,
      ).toBe("ready");
    });
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(harness.decode).toHaveBeenCalledOnce();
    expect(harness.authorizeBinding).toHaveBeenCalledOnce();
    harness.cache.clear();
  });

  it("keeps ordered member file and asset-version identities out of decoded-resource aliases", async () => {
    const original = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const renamedMember = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: original.runtimePackageContentDigest,
      fileName: "grand-hall-renamed.sog",
      sizeBytes: 1,
    });
    const reversionedMember = historicalRuntimeBindingFixture({
      bindingId: "13111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "24222222-2222-4222-8222-222222222222",
      runtimePackageId: "68666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: original.runtimePackageContentDigest,
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });

    expect(historicalRuntimeResourceKey(renamedMember)).not.toBe(
      historicalRuntimeResourceKey(original),
    );
    expect(historicalRuntimeResourceKey(reversionedMember)).not.toBe(
      historicalRuntimeResourceKey(original),
    );
    const tamperedAlias = {
      ...original,
      visualAssets: original.visualAssets.map((member) =>
        member.memberIndex === 0
          ? { ...member, fileName: "grand-hall-post-parse-tamper.sog" }
          : member,
      ),
    };
    expect(tamperedAlias.bindingDigest).toBe(original.bindingDigest);
    expect(historicalRuntimeBindingKey(tamperedAlias)).not.toBe(
      historicalRuntimeBindingKey(original),
    );
    expect(historicalRuntimeResourceKey(tamperedAlias)).not.toBe(
      historicalRuntimeResourceKey(original),
    );

    const harness = cacheWith({});
    harness.cache.setWindow({
      active: original,
      adjacent: renamedMember,
      decodeAdjacent: true,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(original))?.status,
      ).toBe("ready");
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(renamedMember))?.status,
      ).toBe("ready");
    });
    expect(
      harness.cache
        .getSnapshot()
        .records.get(historicalRuntimeBindingKey(renamedMember))?.resource,
    ).not.toBe(
      harness.cache
        .getSnapshot()
        .records.get(historicalRuntimeBindingKey(original))?.resource,
    );
    expect(harness.fetchMember).toHaveBeenCalledTimes(2);
    expect(harness.decode).toHaveBeenCalledTimes(2);

    harness.cache.setWindow({
      active: reversionedMember,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(reversionedMember))?.status,
      ).toBe("ready");
    });
    expect(harness.fetchMember).toHaveBeenCalledTimes(3);
    expect(harness.decode).toHaveBeenCalledTimes(3);
    harness.cache.clear();
  });

  it("does not expose a shared decoded resource when the new snapshot binding is unauthorized", async () => {
    const day = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const deniedWeek = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: day.runtimePackageContentDigest,
      sizeBytes: 1,
    });
    const harness = cacheWith({
      authorizeBinding: (binding) =>
        binding.bindingId === deniedWeek.bindingId
          ? Promise.reject(new Error("binding denied"))
          : Promise.resolve(),
    });
    harness.cache.setWindow({
      active: day,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(day))?.status,
      ).toBe("ready");
    });
    harness.cache.setWindow({
      active: deniedWeek,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(deniedWeek)),
      ).toMatchObject({ status: "error", resource: null });
    });
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(harness.decode).toHaveBeenCalledOnce();
    expect(harness.authorizeBinding).toHaveBeenCalledOnce();
    harness.cache.clear();
  });

  it("aborts synchronously across logout and same-user session replacement", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const user = {
      id: "planner-1",
      email: "planner@example.test",
      venueId: binding.venueId,
      role: "planner",
      platformRole: "none" as const,
      name: "Planner",
    };
    const observedSignals: AbortSignal[] = [];
    const harness = cacheWith({
      fetchMember: (_binding, signal) =>
        new Promise<VerifiedHistoricalRuntimeAsset>((_resolve, reject) => {
          observedSignals.push(signal);
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    });
    useAuthStore.setState({ authContextRevision: 0 });
    const releaseGuard = guardHistoricalRuntimeCacheAuthRevision(
      harness.cache,
      useAuthStore,
    );
    useAuthStore.getState().setUser(user, "session-a");
    const signedIn = useAuthStore.getState();
    const firstSessionScope = historicalRuntimeCacheScopeKey({
      user: signedIn.user,
      venueId: binding.venueId,
      spaceId: binding.spaceId,
      authSessionId: signedIn.authSessionId,
      authContextRevision: signedIn.authContextRevision,
    });
    harness.cache.setScope(firstSessionScope);
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(1);
    });
    const firstSessionSignal = observedSignals[0];
    if (firstSessionSignal === undefined)
      throw new Error("Fetch did not expose an abort signal");

    useAuthStore.getState().setUser(user, "session-b");
    expect(firstSessionSignal.aborted).toBe(true);
    expect(harness.cache.getSnapshot().records.size).toBe(0);
    expect(harness.decode).not.toHaveBeenCalled();

    const replaced = useAuthStore.getState();
    expect(replaced.authContextRevision).toBe(signedIn.authContextRevision + 1);
    const replacementScope = historicalRuntimeCacheScopeKey({
      user: replaced.user,
      venueId: binding.venueId,
      spaceId: binding.spaceId,
      authSessionId: replaced.authSessionId,
      authContextRevision: replaced.authContextRevision,
    });
    expect(replacementScope).not.toBe(firstSessionScope);
    harness.cache.setScope(replacementScope);
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(observedSignals).toHaveLength(2);
    });
    const replacementSignal = observedSignals[1];
    if (replacementSignal === undefined)
      throw new Error("Replacement fetch did not start");

    useAuthStore.getState().logout();
    expect(replacementSignal.aborted).toBe(true);
    expect(harness.cache.getSnapshot().records.size).toBe(0);
    releaseGuard();
  });

  it("disposes decoded private resources when an authoritative permission update reaches the auth store", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const planner = {
      id: "planner-1",
      email: "planner@example.test",
      venueId: binding.venueId,
      role: "planner",
      platformRole: "none" as const,
      name: "Planner",
    };
    useAuthStore.setState({ authContextRevision: 0 });
    const harness = cacheWith({});
    const releaseGuard = guardHistoricalRuntimeCacheAuthRevision(
      harness.cache,
      useAuthStore,
    );
    useAuthStore.getState().setUser(planner, "session-a");
    const authorized = useAuthStore.getState();
    harness.cache.setScope(
      historicalRuntimeCacheScopeKey({
        user: authorized.user,
        venueId: binding.venueId,
        spaceId: binding.spaceId,
        authSessionId: authorized.authSessionId,
        authContextRevision: authorized.authContextRevision,
      }),
    );
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(binding))?.status,
      ).toBe("ready");
    });
    const decoded = harness.cache
      .getSnapshot()
      .records.get(historicalRuntimeBindingKey(binding))?.resource;
    if (decoded === null || decoded === undefined)
      throw new Error("Resource did not decode");

    // T-541 still needs a live server/DB permission-revision notification. The
    // synchronous guarantee begins only when authoritative claims reach here.
    useAuthStore
      .getState()
      .setUser({ ...planner, role: "viewer" }, "session-a");
    expect(harness.cache.getSnapshot().records.size).toBe(0);
    expect(decoded.disposeCount).toBe(1);
    releaseGuard();
  });

  it("rejects a wrong-room binding before fetch and retires the selected room", async () => {
    const selected = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const wrongRoom = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      spaceId: "45444444-4444-4444-8444-444444444444",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const harness = cacheWith({});
    const selectedRoom = {
      venueId: selected.venueId,
      spaceId: selected.spaceId,
    };
    harness.cache.setWindow({
      active: selected,
      adjacent: null,
      decodeAdjacent: false,
      expectedRoom: selectedRoom,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(selected))?.status,
      ).toBe("ready");
    });
    const selectedResource = harness.cache
      .getSnapshot()
      .records.get(historicalRuntimeBindingKey(selected))?.resource;
    if (selectedResource === null || selectedResource === undefined)
      throw new Error("Resource did not decode");

    expect(historicalRuntimeBindingMatchesRoom(wrongRoom, selectedRoom)).toBe(
      false,
    );
    harness.cache.setWindow({
      active: wrongRoom,
      adjacent: null,
      decodeAdjacent: false,
      expectedRoom: selectedRoom,
    });
    expect(harness.cache.getSnapshot().records.size).toBe(0);
    expect(harness.fetchMember).toHaveBeenCalledOnce();
    expect(selectedResource.disposeCount).toBe(1);
  });

  it("disposes and replaces a changed immutable package revision", async () => {
    const first = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const revised = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: first.runtimePackageId,
      runtimePackageRevision: first.runtimePackageRevision + 1,
      runtimePackageContentDigest: "3".repeat(64),
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sha256: "4".repeat(64),
      sizeBytes: 1,
    });
    const harness = cacheWith({});
    const expectedRoom = { venueId: first.venueId, spaceId: first.spaceId };
    harness.cache.setWindow({
      active: first,
      adjacent: null,
      decodeAdjacent: false,
      expectedRoom,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(first))?.status,
      ).toBe("ready");
    });
    const firstResource = harness.cache
      .getSnapshot()
      .records.get(historicalRuntimeBindingKey(first))?.resource;
    if (firstResource === null || firstResource === undefined)
      throw new Error("Resource did not decode");
    expect(historicalRuntimeBindingKey(revised)).not.toBe(
      historicalRuntimeBindingKey(first),
    );

    harness.cache.setWindow({
      active: revised,
      adjacent: null,
      decodeAdjacent: false,
      expectedRoom,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(revised))?.status,
      ).toBe("ready");
    });
    expect(firstResource.disposeCount).toBe(1);
    expect(harness.fetchMember).toHaveBeenCalledTimes(2);
    expect(harness.decode).toHaveBeenCalledTimes(2);
    harness.cache.clear();
  });

  it("fetches the selected package before its adjacent prefetch", async () => {
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sha256: "9".repeat(64),
      sizeBytes: 1,
    });
    const started: string[] = [];
    const finishFetch = new Map<string, () => void>();
    const harness = cacheWith({
      fetchMember: (binding) =>
        new Promise<VerifiedHistoricalRuntimeAsset>((resolve) => {
          started.push(binding.bindingId);
          finishFetch.set(binding.bindingId, () => {
            resolve(verifiedAsset(binding));
          });
        }),
    });

    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(started).toEqual([active.bindingId]);
    });
    finishFetch.get(active.bindingId)?.();
    await vi.waitFor(() => {
      expect(started).toEqual([active.bindingId, adjacent.bindingId]);
    });
    finishFetch.get(adjacent.bindingId)?.();
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(active))?.status,
      ).toBe("ready");
    });
    harness.cache.clear();
  });

  it("runs only one package decoder at a time", async () => {
    const first = historicalRuntimeBindingFixture({
      bindingId: "11111111-1111-4111-8111-111111111111",
      runtimePackageId: "66666666-6666-4666-8666-666666666666",
      sizeBytes: 1,
    });
    const second = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const resolvers: Array<(value: TestResource) => void> = [];
    let activeDecoders = 0;
    let maxActiveDecoders = 0;
    const harness = cacheWith({
      decode: (binding) =>
        new Promise<TestResource>((resolve) => {
          activeDecoders += 1;
          maxActiveDecoders = Math.max(maxActiveDecoders, activeDecoders);
          resolvers.push((value) => {
            activeDecoders -= 1;
            resolve(value);
          });
          void binding;
        }),
    });
    harness.cache.setWindow({
      active: first,
      adjacent: second,
      decodeAdjacent: true,
    });
    await vi.waitFor(() => {
      expect(resolvers).toHaveLength(1);
    });
    resolvers[0]?.(resource("first"));
    await vi.waitFor(() => {
      expect(resolvers).toHaveLength(2);
    });
    resolvers[1]?.(resource("second"));
    await vi.waitFor(() => {
      expect(harness.decode).toHaveBeenCalledTimes(2);
    });
    expect(maxActiveDecoders).toBe(1);
    harness.cache.clear();
  });

  it("bounds rapid A to B to C verification and drops aborted queued work before fetch", async () => {
    const first = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const second = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const third = historicalRuntimeBindingFixture({
      bindingId: "13111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "24222222-2222-4222-8222-222222222222",
      runtimePackageId: "68666666-6666-4666-8666-666666666666",
      assetVersionId: "97999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const started: string[] = [];
    const verificationResolvers = new Map<string, () => void>();
    let inFlight = 0;
    let maxInFlight = 0;
    const harness = cacheWith({
      fetchMember: (binding) =>
        new Promise<VerifiedHistoricalRuntimeAsset>((resolve) => {
          started.push(binding.bindingId);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          verificationResolvers.set(binding.bindingId, () => {
            inFlight -= 1;
            resolve(verifiedAsset(binding));
          });
        }),
    });

    harness.cache.setWindow({
      active: first,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(started).toEqual([first.bindingId]);
    });
    harness.cache.setWindow({
      active: second,
      adjacent: null,
      decodeAdjacent: false,
    });
    harness.cache.setWindow({
      active: third,
      adjacent: null,
      decodeAdjacent: false,
    });
    expect(started).toEqual([first.bindingId]);

    verificationResolvers.get(first.bindingId)?.();
    await vi.waitFor(() => {
      expect(started).toContain(third.bindingId);
    });
    expect(started).not.toContain(second.bindingId);
    verificationResolvers.get(third.bindingId)?.();
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(third))?.status,
      ).toBe("ready");
    });
    expect(maxInFlight).toBe(1);
    harness.cache.clear();
  });

  it("keeps an aborted decoder's resource invisible, then disposes it exactly once after settlement", async () => {
    const first = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const second = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const settleIgnoredAbort: {
      current: ((value: TestResource) => void) | null;
    } = {
      current: null,
    };
    const staleResource = resource("stale");
    const harness = cacheWith({
      decode: (binding) =>
        binding.bindingId === first.bindingId
          ? new Promise<TestResource>((resolve) => {
              settleIgnoredAbort.current = resolve;
            })
          : Promise.resolve(resource("second")),
    });
    harness.cache.setWindow({
      active: first,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(settleIgnoredAbort.current).not.toBeNull();
    });
    harness.cache.setWindow({
      active: second,
      adjacent: null,
      decodeAdjacent: false,
    });
    expect(staleResource.visible).toBe(false);
    const settle = settleIgnoredAbort.current;
    if (settle === null) throw new Error("Ignored-abort decoder did not start");
    settle(staleResource);
    await vi.waitFor(() => {
      expect(staleResource.disposeCount).toBe(1);
    });
    expect(harness.dispose).toHaveBeenCalledWith(staleResource);
    expect(
      harness.cache
        .getSnapshot()
        .records.has(historicalRuntimeBindingKey(first)),
    ).toBe(false);
    harness.cache.clear();
    expect(staleResource.disposeCount).toBe(1);
  });

  it("recreates a failed binding generation and succeeds on explicit reselection", async () => {
    const binding = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    let attempt = 0;
    const harness = cacheWith({
      decode: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error("decode failed"));
        return Promise.resolve(resource("retry-ready"));
      },
    });
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(binding))?.status,
      ).toBe("error");
    });
    harness.cache.setWindow({
      active: binding,
      adjacent: null,
      decodeAdjacent: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(binding))?.status,
      ).toBe("ready");
    });
    expect(harness.decode).toHaveBeenCalledTimes(2);
    expect(harness.fetchMember).toHaveBeenCalledTimes(2);
    harness.cache.clear();
  });

  it("does not fetch or decode an active package over the supported byte budget", async () => {
    const base = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const firstMember = base.visualAssets[0];
    if (firstMember === undefined) throw new Error("Fixture member missing");
    const oversized: PhaseLayoutRuntimeAvailableBinding = {
      ...base,
      visualAssets: [
        {
          ...firstMember,
          sizeBytes: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET + 1,
        },
      ],
    };
    const harness = cacheWith({});
    harness.cache.setWindow({
      active: oversized,
      adjacent: null,
      decodeAdjacent: false,
    });
    await Promise.resolve();
    expect(harness.fetchMember).not.toHaveBeenCalled();
    expect(harness.decode).not.toHaveBeenCalled();
    expect(harness.cache.getSnapshot().records.size).toBe(0);
  });

  it("does not fetch a synthetic package with more than the hard member cap", async () => {
    const base = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const firstMember = base.visualAssets[0];
    if (firstMember === undefined) throw new Error("Fixture member missing");
    const tooManyMembers: PhaseLayoutRuntimeAvailableBinding = {
      ...base,
      visualAssets: Array.from(
        { length: HISTORICAL_RUNTIME_MAX_MEMBERS + 1 },
        (_, index) => ({
          ...firstMember,
          memberIndex: index,
          fileName: `synthetic-${String(index)}.sog`,
        }),
      ),
    };
    const harness = cacheWith({});

    harness.cache.setWindow({
      active: tooManyMembers,
      adjacent: null,
      decodeAdjacent: false,
    });
    await Promise.resolve();

    expect(harness.fetchMember).not.toHaveBeenCalled();
    expect(harness.decode).not.toHaveBeenCalled();
    expect(harness.cache.getSnapshot().records.size).toBe(0);
  });

  it("does not fetch an adjacent package when its combined bytes exceed the budget", async () => {
    const active = historicalRuntimeBindingFixture({
      memberSizeBytes: Array.from({ length: 4 }, () => 15 * 1_024 * 1_024),
    });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      memberSizeBytes: [
        14 * 1_024 * 1_024,
        13 * 1_024 * 1_024,
        13 * 1_024 * 1_024,
      ],
    });
    const harness = cacheWith({});
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: true });
    await vi.waitFor(() => {
      expect(harness.decode).toHaveBeenCalledOnce();
    });
    expect(harness.fetchMember).toHaveBeenCalledTimes(
      active.visualAssets.length,
    );
    expect(
      harness.fetchMember.mock.calls.every(
        ([binding]) => binding.bindingId === active.bindingId,
      ),
    ).toBe(true);
    expect(
      harness.cache
        .getSnapshot()
        .records.has(historicalRuntimeBindingKey(adjacent)),
    ).toBe(false);
    harness.cache.clear();
  });

  it("expires verified-only adjacent bytes instead of retaining them indefinitely", async () => {
    vi.useFakeTimers();
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    const harness = cacheWith({});
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(adjacent))?.status,
      ).toBe("verified");
    });
    await vi.advanceTimersByTimeAsync(
      HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS,
    );
    expect(
      harness.cache
        .getSnapshot()
        .records.has(historicalRuntimeBindingKey(adjacent)),
    ).toBe(false);
    harness.cache.clear();
  });

  it("does not expire an adjacent package while its scheduled decode is still running", async () => {
    vi.useFakeTimers();
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    let finishAdjacentDecode = (_value: TestResource): void => {
      throw new Error("Adjacent decode was not started");
    };
    const harness = cacheWith({
      decode: (binding) =>
        binding.bindingId === active.bindingId
          ? Promise.resolve(resource("active"))
          : new Promise<TestResource>((resolve) => {
              finishAdjacentDecode = resolve;
            }),
    });

    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(adjacent))?.status,
      ).toBe("verified");
    });
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: true });
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(adjacent))?.status,
      ).toBe("decoding");
    });
    await vi.advanceTimersByTimeAsync(
      HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS + 1,
    );
    expect(
      harness.cache
        .getSnapshot()
        .records.has(historicalRuntimeBindingKey(adjacent)),
    ).toBe(true);
    finishAdjacentDecode(resource("adjacent"));
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(adjacent))?.status,
      ).toBe("ready");
    });
    harness.cache.clear();
  });

  it("does not expire an adjacent package while its decode waits behind the active package", async () => {
    vi.useFakeTimers();
    const active = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const adjacent = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sizeBytes: 1,
    });
    let adjacentFetchStarted = false;
    let finishAdjacentFetch = (): void => {
      throw new Error("Adjacent fetch was not started");
    };
    let finishActiveDecode = (_value: TestResource): void => {
      throw new Error("Active decode was not started");
    };
    const harness = cacheWith({
      fetchMember: (binding) => {
        if (binding.bindingId === active.bindingId) {
          return Promise.resolve(verifiedAsset(binding));
        }
        adjacentFetchStarted = true;
        return new Promise<VerifiedHistoricalRuntimeAsset>((resolve) => {
          finishAdjacentFetch = () => {
            resolve(verifiedAsset(binding));
          };
        });
      },
      decode: (binding) =>
        binding.bindingId === active.bindingId
          ? new Promise<TestResource>((resolve) => {
              finishActiveDecode = resolve;
            })
          : Promise.resolve(resource("adjacent")),
    });

    harness.cache.setWindow({ active, adjacent: null, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(harness.decode).toHaveBeenCalledOnce();
    });
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: false });
    await vi.waitFor(() => {
      expect(adjacentFetchStarted).toBe(true);
    });
    harness.cache.setWindow({ active, adjacent, decodeAdjacent: true });
    finishAdjacentFetch();
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(adjacent))?.status,
      ).toBe("verified");
    });

    await vi.advanceTimersByTimeAsync(
      HISTORICAL_RUNTIME_VERIFIED_PREFETCH_TTL_MS + 1,
    );
    expect(
      harness.cache
        .getSnapshot()
        .records.has(historicalRuntimeBindingKey(adjacent)),
    ).toBe(true);
    expect(harness.decode).toHaveBeenCalledOnce();

    finishActiveDecode(resource("active"));
    await vi.waitFor(() => {
      expect(
        harness.cache
          .getSnapshot()
          .records.get(historicalRuntimeBindingKey(adjacent))?.status,
      ).toBe("ready");
    });
    expect(harness.decode).toHaveBeenCalledTimes(2);
    harness.cache.clear();
  });
});

describe("historicalRuntimeCrossfadeAllowed", () => {
  it("requires the same room, envelope, exact transform, budget, and motion permission", () => {
    const from = historicalRuntimeBindingFixture({ sizeBytes: 1 });
    const to = historicalRuntimeBindingFixture({
      bindingId: "12111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "23222222-2222-4222-8222-222222222222",
      runtimePackageId: "67666666-6666-4666-8666-666666666666",
      assetVersionId: "98999999-9999-4999-8999-999999999999",
      sha256: "9".repeat(64),
      sizeBytes: 1,
    });
    const base = {
      from,
      to,
      sameEnvelope: true,
      reducedMotion: false,
      combinedByteBudget: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
      fromSplatCount: 1_000_000,
      toSplatCount: 1_000_000,
      combinedSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
    };
    expect(historicalRuntimeCrossfadeAllowed(base)).toBe(true);
    expect(historicalRuntimeCapturedVisualKey(to)).not.toBe(
      historicalRuntimeCapturedVisualKey(from),
    );
    const sameCapturedContent = historicalRuntimeBindingFixture({
      bindingId: "13111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "24222222-2222-4222-8222-222222222222",
      runtimePackageId: "68666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: from.runtimePackageContentDigest,
      sizeBytes: 1,
    });
    expect(historicalRuntimeResourceKey(sameCapturedContent)).toBe(
      historicalRuntimeResourceKey(from),
    );
    expect(
      historicalRuntimeCrossfadeAllowed({ ...base, to: sameCapturedContent }),
    ).toBe(false);
    const sameCapturedAlias = historicalRuntimeBindingFixture({
      bindingId: "14111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "25222222-2222-4222-8222-222222222222",
      runtimePackageId: "69666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: from.runtimePackageContentDigest,
      assetVersionId: "97999999-9999-4999-8999-999999999999",
      fileName: "grand-hall-alias.sog",
      sizeBytes: 1,
    });
    expect(historicalRuntimeResourceKey(sameCapturedAlias)).not.toBe(
      historicalRuntimeResourceKey(from),
    );
    expect(
      historicalRuntimeCrossfadeAllowed({ ...base, to: sameCapturedAlias }),
    ).toBe(false);
    const nonvisualRevisionOnly = historicalRuntimeBindingFixture({
      bindingId: "15111111-1111-4111-8111-111111111111",
      canonicalSnapshotId: "26222222-2222-4222-8222-222222222222",
      runtimePackageId: "70666666-6666-4666-8666-666666666666",
      runtimePackageContentDigest: "8".repeat(64),
      sizeBytes: 1,
    });
    expect(nonvisualRevisionOnly.runtimePackageContentDigest).not.toBe(
      from.runtimePackageContentDigest,
    );
    expect(historicalRuntimeCapturedVisualKey(nonvisualRevisionOnly)).toBe(
      historicalRuntimeCapturedVisualKey(from),
    );
    expect(
      historicalRuntimeCrossfadeAllowed({
        ...base,
        to: nonvisualRevisionOnly,
      }),
    ).toBe(false);
    expect(
      historicalRuntimeCrossfadeAllowed({
        ...base,
        from: nonvisualRevisionOnly,
        to: from,
      }),
    ).toBe(false);
    expect(historicalRuntimeResourceKey(nonvisualRevisionOnly)).toBe(
      historicalRuntimeResourceKey(from),
    );
    expect(
      historicalRuntimeCrossfadeAllowed({ ...base, sameEnvelope: false }),
    ).toBe(false);
    expect(
      historicalRuntimeCrossfadeAllowed({ ...base, reducedMotion: true }),
    ).toBe(false);
    expect(
      historicalRuntimeCrossfadeAllowed({ ...base, combinedByteBudget: 1 }),
    ).toBe(false);
    expect(
      historicalRuntimeCrossfadeAllowed({
        ...base,
        toSplatCount: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      }),
    ).toBe(false);
    expect(
      historicalRuntimeCrossfadeAllowed({
        ...base,
        to: { ...to, transformArtifactDigest: "0".repeat(64) },
      }),
    ).toBe(false);
  });
});

describe("historical runtime synthetic viewer capacity policy", () => {
  it("disables adjacency and lowers active budgets on low-memory and mobile viewers", () => {
    expect(
      historicalRuntimeViewerCapacity({ deviceMemoryGb: 4, mobile: false }),
    ).toEqual({
      maxCompressedBytes: HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
      allowAdjacent: false,
    });
    expect(
      historicalRuntimeViewerCapacity({ deviceMemoryGb: 16, mobile: true }),
    ).toEqual({
      maxCompressedBytes: HISTORICAL_RUNTIME_LOW_MEMORY_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
      allowAdjacent: false,
    });
    expect(
      historicalRuntimeViewerCapacity({ deviceMemoryGb: 16, mobile: false }),
    ).toEqual({
      maxCompressedBytes: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
      maxSplats: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      allowAdjacent: true,
    });
  });

  it("fails closed when a decoded desktop resource exceeds a later mobile policy", () => {
    expect(
      historicalRuntimeDecodedSplatsWithinViewerBudget(
        2_000_000,
        HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      ),
    ).toBe(true);
    expect(
      historicalRuntimeDecodedSplatsWithinViewerBudget(
        2_000_000,
        HISTORICAL_RUNTIME_LOW_MEMORY_SPLAT_BUDGET,
      ),
    ).toBe(false);
  });

  it("keeps adjacent decode within the combined resident cap", () => {
    expect(
      historicalRuntimeRemainingAdjacentSplatBudget({
        activeSplatCount: undefined,
        viewerSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
        combinedResidentSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      }),
    ).toBe(0);
    expect(
      historicalRuntimeRemainingAdjacentSplatBudget({
        activeSplatCount: 3_500_000,
        viewerSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
        combinedResidentSplatBudget: HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      }),
    ).toBe(500_000);
    expect(
      historicalRuntimeCombinedSplatsWithinBudget(
        3_500_000,
        500_000,
        HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      ),
    ).toBe(true);
    expect(
      historicalRuntimeCombinedSplatsWithinBudget(
        3_500_000,
        500_001,
        HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
      ),
    ).toBe(false);
  });
});

describe("historicalRuntimeResourceCanRender", () => {
  it("synchronously rejects A-ready when B is selected but still loading or unavailable", () => {
    const resourceA = resource("A");
    expect(
      historicalRuntimeResourceCanRender({
        displayKey: "binding-A",
        activeKey: "binding-A",
        activeStatus: "ready",
        displayedResource: resourceA,
        activeResource: resourceA,
      }),
    ).toBe(true);
    expect(
      historicalRuntimeResourceCanRender({
        displayKey: "binding-A",
        activeKey: "binding-B",
        activeStatus: "fetching",
        displayedResource: resourceA,
        activeResource: null,
      }),
    ).toBe(false);
    expect(
      historicalRuntimeResourceCanRender({
        displayKey: "binding-A",
        activeKey: null,
        activeStatus: null,
        displayedResource: resourceA,
        activeResource: null,
      }),
    ).toBe(false);
  });
});
