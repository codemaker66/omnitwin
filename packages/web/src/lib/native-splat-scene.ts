import { Matrix4, Object3D, Scene, Vector3, SRGBColorSpace, type BufferGeometry, type Camera } from "three";
import { StorageBufferAttribute, type UniformNode, type WebGPURenderer } from "three/webgpu";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { Fn, If, float, length, max, min, storage, uniform, uniformArray, vec3 } from "three/tsl";
import { mergeNativeSplatSources, type NativeRoomClip } from "./native-splat-merge.js";
import { afterNativeCanvasGpuWork, isNativeCanvasRender, nativeRendererStorageLimit } from "./native-renderer.js";
import { NativeCpuSortPool, type NativeCpuSortHandle } from "./native-cpu-sort-pool.js";

type NativeGaussianObject = GaussianSplat;

export interface NativeSourceRegistration {
  readonly anchor: Object3D;
  readonly opacity: () => number;
  readonly maxSh: () => number;
  readonly residencyGroup: () => string | undefined;
  readonly onError: (error: Error) => void;
  readonly onRendered?: () => void;
}

interface Source extends NativeSourceRegistration {
  geometry: BufferGeometry | null;
  matrix: Matrix4;
  version: number;
  renderedOnce: boolean;
}
interface ReadySource extends Source { geometry: BufferGeometry }

interface Snapshot {
  readonly key: string;
  readonly mesh: NativeGaussianObject;
  readonly geometry: BufferGeometry;
  readonly tileAttribute: StorageBufferAttribute;
  readonly sources: readonly ReadySource[];
  readonly opacityValues: number[];
  readonly center: UniformNode<"vec3", Vector3>;
  readonly halfExtent: UniformNode<"vec3", Vector3>;
  readonly softEdge: UniformNode<"float", number>;
  readonly clipEnabled: UniformNode<"float", number>;
  readonly dispose: () => void;
  readonly cpuSort: NativeCpuSortHandle | null;
  sortFailed: boolean;
  completionFailed: boolean;
}

interface FirstFrameListener {
  readonly camera: Camera;
  readonly callback: () => void;
  readonly minimumSources: number;
}

function ready(source: Source): source is ReadySource { return source.geometry !== null; }
function errorFrom(reason: unknown): Error { return reason instanceof Error ? reason : new Error(String(reason)); }
function sourceVisible(source: Source): boolean {
  for (let object: Object3D | null = source.anchor; object !== null; object = object.parent) {
    if (!object.visible) return false;
  }
  return true;
}
function opacityOf(source: Source): number {
  if (!sourceVisible(source)) return 0;
  const value = source.opacity();
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** One instance per scene; all native sources share one global sorting domain. */
export class NativeSplatScene {
  private readonly sources = new Map<string, Source>();
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly firstFrames = new Set<FirstFrameListener>();
  private readonly failedKeys = new Set<string>();
  private readonly inverseSceneMatrix = new Matrix4();
  private readonly relativeSourceMatrix = new Matrix4();
  private renderer: WebGPURenderer | null = null;
  private camera: Camera | null = null;
  private invalidate: () => void = () => undefined;
  private hosts = 0;
  private active: Snapshot | null = null;
  private desiredKey = "";
  private building = false;
  private generation = 0;
  private gpuCompletion: { snapshot: Snapshot; controller: AbortController } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFrame = -1;
  private kernelRadius = Math.sqrt(8);
  private minSortIntervalMs = 0;
  private clip: NativeRoomClip | null = null;
  private clipOwner: object | null = null;
  private cpuSortPool: NativeCpuSortPool | null = null;

  constructor(private readonly scene: Scene, private readonly createCpuSortPool: () => NativeCpuSortPool = () => new NativeCpuSortPool()) {}

  attach(renderer: WebGPURenderer, camera: Camera, invalidate: () => void): () => void {
    if (this.renderer !== null && this.renderer !== renderer) throw new Error("A native splat scene must have one active renderer");
    this.renderer = renderer;
    this.camera = camera;
    this.invalidate = invalidate;
    this.hosts++;
    this.schedule();
    return () => {
      this.hosts--;
      // React StrictMode immediately attaches again; do not dispose shared resources between those effects.
      queueMicrotask(() => {
        if (this.hosts !== 0) return;
        this.generation++;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.clearSnapshots();
        this.cpuSortPool?.dispose();
        this.cpuSortPool = null;
        this.renderer = null;
        this.camera = null;
        this.desiredKey = "";
      });
    };
  }

  configure(kernelRadius: number | undefined, minSortIntervalMs: number | undefined): void {
    const radius = Number.isFinite(kernelRadius) ? Math.max(0.25, Math.min(4, kernelRadius ?? Math.sqrt(8))) : Math.sqrt(8);
    const interval = Number.isFinite(minSortIntervalMs) ? Math.max(0, minSortIntervalMs ?? 0) : 0;
    if (this.kernelRadius !== radius) { this.kernelRadius = radius; this.invalidateSnapshots(); }
    this.minSortIntervalMs = interval;
    for (const snapshot of this.snapshots.values()) snapshot.mesh.minSortIntervalMs = interval;
  }

  register(registration: NativeSourceRegistration): { setGeometry: (geometry: BufferGeometry) => void; dispose: () => void } {
    const key = registration.anchor.uuid;
    const source: Source = { ...registration, geometry: null, matrix: new Matrix4(), version: 0, renderedOnce: false };
    this.sources.set(key, source);
    let disposed = false;
    return {
      setGeometry: (geometry) => {
        if (disposed) return;
        source.geometry = geometry;
        this.updateSceneFrame();
        registration.anchor.updateWorldMatrix(true, false);
        source.matrix.multiplyMatrices(this.inverseSceneMatrix, registration.anchor.matrixWorld);
        source.version++;
        this.schedule();
        this.invalidate();
      },
      dispose: () => {
        disposed = true;
        if (this.sources.get(key) === source) this.sources.delete(key);
        if (this.active !== null && this.active.sources.every((member) => this.sources.get(member.anchor.uuid) !== member)) {
          // A new room/URL must never inherit the previous room's draw while it loads or fails.
          const previous = this.active;
          this.active = null;
          this.snapshots.delete(previous.key);
          previous.dispose();
        }
        this.removeStaleSnapshots();
        this.schedule();
        this.invalidate();
      },
    };
  }

  setClip(owner: object, clip: NativeRoomClip | null): void {
    this.clipOwner = owner;
    this.clip = clip;
    for (const snapshot of this.snapshots.values()) this.updateSnapshot(snapshot);
    this.invalidate();
  }

  clearClip(owner: object): void {
    if (this.clipOwner !== owner) return;
    this.clip = null;
    this.clipOwner = null;
    for (const snapshot of this.snapshots.values()) this.updateSnapshot(snapshot);
    this.invalidate();
  }

  firstFrame(listener: FirstFrameListener): () => void {
    this.firstFrames.add(listener);
    this.invalidate();
    return () => { this.firstFrames.delete(listener); };
  }

  frame(time: number): void {
    if (time === this.lastFrame) return;
    this.lastFrame = time;
    this.updateSceneFrame();
    for (const source of this.sources.values()) {
      source.anchor.updateWorldMatrix(true, false);
      this.relativeSourceMatrix.multiplyMatrices(this.inverseSceneMatrix, source.anchor.matrixWorld);
      // Cancelling an animated common Scene transform introduces machine epsilon noise.
      // Do not rebuild millions of splats when their transform within the Scene is unchanged.
      const previous = source.matrix.elements;
      const changed = this.relativeSourceMatrix.elements.some((value, index) => {
        const old = previous[index] ?? NaN;
        return !Number.isFinite(value) || !Number.isFinite(old) || Math.abs(value - old) > 1e-12 * Math.max(1, Math.abs(value), Math.abs(old));
      });
      if (changed) {
        source.matrix.copy(this.relativeSourceMatrix);
        source.version++;
      }
    }
    const selected = this.selectedSources();
    this.desiredKey = this.key(selected);
    const cached = this.snapshots.get(this.desiredKey);
    if (cached !== undefined) this.activate(cached);
    else if (selected.length === 0) {
      if (this.active !== null) this.active.mesh.visible = false;
      if (this.sources.size === 0) this.clearSnapshots();
    } else this.schedule();
    if (this.active !== null) this.updateSnapshot(this.active, selected.length > 0 && this.active.key !== this.desiredKey && cached === undefined);
    this.removeStaleSnapshots();
  }

  private selectedSources(): ReadySource[] {
    return [...this.sources.values()].filter(ready).filter((source) => opacityOf(source) > 0.002);
  }

  private updateSceneFrame(): void {
    // The generated mesh is attached to this Scene. Bake source→Scene, not source→world,
    // so the Scene transform is applied once and RoomClipBox stays in the same local frame.
    this.scene.updateWorldMatrix(true, false);
    this.inverseSceneMatrix.copy(this.scene.matrixWorld).invert();
  }

  private key(sources: readonly ReadySource[]): string {
    return `${String(this.kernelRadius)}:` + sources.map((source) => `${source.anchor.uuid}/${String(source.version)}/${String(Math.floor(source.maxSh()))}`).join(";");
  }

  private schedule(): void {
    if (this.timer !== null || this.renderer === null || this.building) return;
    this.timer = setTimeout(() => { this.timer = null; void this.buildNext(); }, 16);
  }

  private async buildNext(): Promise<void> {
    const renderer = this.renderer, camera = this.camera;
    if (renderer === null || camera === null || this.building) return;
    let selected = this.selectedSources();
    this.desiredKey = this.key(selected);
    let key = this.desiredKey;
    if (selected.length === 0 || this.snapshots.has(key) || this.failedKeys.has(key)) {
      if (this.snapshots.size >= 2) return;
      // Named complete levels may remain resident at zero opacity; prewarm them for motion/rest switching.
      let found = false;
      const groups = new Set([...this.sources.values()].map((source) => source.residencyGroup()).filter((group) => group !== undefined));
      for (const group of groups) {
        const members = [...this.sources.values()].filter((source) => source.residencyGroup() === group);
        if (members.some((source) => !ready(source))) continue;
        const candidate = [...this.sources.values()].filter(ready).filter((source) => source.residencyGroup() === group
          || (source.residencyGroup() === undefined && opacityOf(source) > 0.002));
        const candidateKey = this.key(candidate);
        if (candidate.length > 0 && !this.snapshots.has(candidateKey) && !this.failedKeys.has(candidateKey)) {
          selected = candidate; key = candidateKey; found = true; break;
        }
      }
      if (!found) return;
    }
    this.building = true;
    const generation = this.generation;
    let snapshot: Snapshot | null = null;
    try {
      snapshot = this.createSnapshot(selected, key, renderer);
      const staging = new Scene();
      // Compile and pre-sort in the actual Scene frame before the atomic reparenting.
      staging.matrixAutoUpdate = false;
      staging.matrix.copy(this.scene.matrixWorld);
      staging.add(snapshot.mesh);
      camera.updateMatrixWorld();
      staging.updateMatrixWorld(true);
      // SH storage is allocated by the official addon before material compilation.
      snapshot.mesh.updateSphericalHarmonics(renderer, camera);
      snapshot.mesh.updateSort(renderer, camera);
      // No source-order or partially sorted first view: WebGL's initial order
      // must return from the worker before this snapshot compiles/activates.
      if (snapshot.cpuSort !== null) await snapshot.cpuSort.firstSort;
      await renderer.compileAsync(staging, camera);
      staging.remove(snapshot.mesh);
      if (generation !== this.generation || renderer !== this.renderer
        || selected.some((source) => this.sources.get(source.anchor.uuid) !== source)
        || key !== this.key(selected)) {
        snapshot.dispose(); snapshot = null;
      } else {
        this.snapshots.set(key, snapshot);
        if (key === this.key(this.selectedSources())) this.activate(snapshot);
        this.trimCache();
        snapshot = null;
        this.invalidate();
      }
    } catch (reason: unknown) {
      snapshot?.dispose();
      if (generation === this.generation) {
        this.failedKeys.add(key);
        const error = errorFrom(reason);
        for (const source of selected) source.onError(error);
      }
    } finally {
      this.building = false;
      this.schedule();
    }
  }

  private createSnapshot(sources: readonly ReadySource[], key: string, renderer: WebGPURenderer): Snapshot {
    const merged = mergeNativeSplatSources(sources.map((source) => ({ geometry: source.geometry, matrix: source.matrix, maxSh: source.maxSh() })), nativeRendererStorageLimit(renderer));
    const tileAttribute = new StorageBufferAttribute(merged.tileIndices, 1);
    const tileIds = storage(tileAttribute, "uint", merged.tileIndices.length).toReadOnly();
    if ("isWebGLBackend" in renderer.backend && renderer.backend.isWebGLBackend === true) tileIds.setPBO(true);
    const opacityValues = sources.map(opacityOf);
    const opacities = uniformArray<"float">(opacityValues, "float");
    const inverseMatrices = uniformArray<"mat3">(merged.inverseTransforms, "mat3");
    const center = uniform(new Vector3());
    const halfExtent = uniform(new Vector3(1, 1, 1));
    const softEdge = uniform(0.12);
    const clipEnabled = uniform(0);
    let mesh: NativeGaussianObject;
    try {
      mesh = new GaussianSplat(merged.geometry, {
        kernelRadius: this.kernelRadius,
        minSortIntervalMs: this.minSortIntervalMs,
        colorSpace: SRGBColorSpace,
        sphericalHarmonicsDirectionNode: (index, direction) => inverseMatrices.element(tileIds.element(index)).mul(direction),
        opacityNode: (index, position) => Fn(() => {
          const opacity = opacities.element(tileIds.element(index)).toVar();
          If(clipEnabled.greaterThan(0.5), () => {
            const q = position.sub(center).abs().sub(halfExtent).toVar();
            const distance = length(max(q, vec3(0))).add(min(max(q.x, max(q.y, q.z)), 0)).toVar();
            If(softEdge.greaterThan(0), () => {
              opacity.mulAssign(float(0.5).sub(distance.div(max(softEdge, 0.000001))).clamp(0, 1));
            }).Else(() => { If(distance.greaterThan(0), () => { opacity.assign(0); }); });
          });
          return opacity;
        })(),
      });
    } catch (reason: unknown) {
      tileAttribute.dispose(); merged.geometry.dispose(); throw reason;
    }
    mesh.name = "Native Gaussian splats (global sort)";
    mesh.frustumCulled = false;
    mesh.material.toneMapped = false;
    mesh.raycast = () => undefined;
    let cpuSort: NativeCpuSortHandle | null = null;
    if ("isWebGLBackend" in renderer.backend && renderer.backend.isWebGLBackend === true) {
      try {
        this.cpuSortPool ??= this.createCpuSortPool();
        const positions = merged.geometry.getAttribute("position").array;
        if (!(positions instanceof Float32Array)) throw new Error("Native worker sort requires Float32 centers");
        cpuSort = this.cpuSortPool.register(positions, (order) => {
          if (this.hosts === 0 || this.renderer !== renderer || key !== this.key(sources)
            || sources.some((source) => this.sources.get(source.anchor.uuid) !== source)) return;
          mesh.applySortOrder(order);
          this.invalidate();
        }, (error) => {
          snapshot.sortFailed = true;
          mesh.visible = false;
          if (this.gpuCompletion?.snapshot === snapshot) {
            this.gpuCompletion.controller.abort();
            this.gpuCompletion = null;
          }
          // A failed resident draw needs the existing canvas retry boundary.
          // Only the active snapshot reports it: cached levels share this pool,
          // and source progress may already have completed before a later crash.
          if (this.active === snapshot && this.renderer === renderer && this.hosts > 0) {
            renderer.onError(`Native splat sorting failed: ${error.message}`);
          }
          // Initial sort errors propagate through buildNext's awaited promise.
          // A resident snapshot instead reports the failure here exactly once.
          if (this.snapshots.get(key) === snapshot) {
            this.failedKeys.add(key);
            for (const source of sources) source.onError(error);
          }
        });
        mesh.cpuSort = cpuSort.request;
      } catch (reason: unknown) {
        cpuSort?.dispose(); mesh.dispose(); tileAttribute.dispose(); merged.geometry.dispose();
        throw reason;
      }
    }
    const snapshot: Snapshot = {
      key, mesh, geometry: merged.geometry, tileAttribute, sources, opacityValues,
      center, halfExtent, softEdge, clipEnabled,
      completionFailed: false, cpuSort, sortFailed: false,
      dispose: () => {
        if (this.gpuCompletion?.snapshot === snapshot) {
          this.gpuCompletion.controller.abort();
          this.gpuCompletion = null;
        }
        cpuSort?.dispose();
        mesh.cpuSort = null;
        mesh.removeFromParent(); mesh.dispose(); tileAttribute.dispose(); merged.geometry.dispose();
      },
    };
    mesh.onAfterRender = (drawRenderer, _scene, drawCamera) => {
      if ((drawRenderer as unknown) !== this.renderer || drawCamera !== this.camera || !isNativeCanvasRender(drawRenderer, this.scene, drawCamera) || this.active !== snapshot
        || snapshot.key !== this.key(this.selectedSources()) || mesh.geometry.instanceCount <= 0 || snapshot.completionFailed || snapshot.sortFailed || this.gpuCompletion !== null) return;
      // Use the opacity actually uploaded for this draw as well as current intent.
      // The reveal subscriber can advance its channel after the native host's poll.
      const prepared = sources.filter((source, index) => (snapshot.opacityValues[index] ?? 0) >= 0.98 && opacityOf(source) >= 0.98);
      const pendingSources = prepared.filter((source) => !source.renderedOnce);
      const listeners = [...this.firstFrames].filter((listener) => drawCamera === listener.camera && prepared.length >= listener.minimumSources);
      if (pendingSources.length === 0 && listeners.length === 0) return;
      const controller = new AbortController();
      const completion = { snapshot, controller };
      const generation = this.generation;
      this.gpuCompletion = completion;
      const valid = (): boolean => this.hosts > 0 && !controller.signal.aborted && !snapshot.sortFailed && generation === this.generation && this.renderer === renderer
        && this.camera === drawCamera && this.active === snapshot && snapshot.key === this.key(this.selectedSources())
        && sources.every((source) => this.sources.get(source.anchor.uuid) === source);
      const complete = (): void => {
        if (this.gpuCompletion !== completion) return;
        this.gpuCompletion = null;
        if (!valid()) { if (this.hosts > 0) this.invalidate(); return; }
        for (const source of pendingSources) {
          if (!valid()) { if (this.hosts > 0) this.invalidate(); return; }
          if (!source.renderedOnce && this.sources.get(source.anchor.uuid) === source && opacityOf(source) >= 0.98) {
            source.renderedOnce = true;
            source.onRendered?.();
          }
        }
        for (const listener of listeners) {
          if (!valid()) { if (this.hosts > 0) this.invalidate(); return; }
          const stillPrepared = prepared.filter((source) => opacityOf(source) >= 0.98).length;
          if (this.firstFrames.has(listener) && stillPrepared >= listener.minimumSources) {
            this.firstFrames.delete(listener); listener.callback();
          }
        }
        // New listeners and sources that finished fading during this wait need
        // their own later acknowledged draw; demand mode may otherwise be idle.
        if (this.selectedSources().some((source) => !source.renderedOnce && opacityOf(source) >= 0.98)
          || [...this.firstFrames].some((listener) => !listeners.includes(listener))) this.invalidate();
      };
      const failed = (reason: unknown): void => {
        if (this.gpuCompletion !== completion) return;
        this.gpuCompletion = null;
        if (!valid()) { if (this.hosts > 0) this.invalidate(); return; }
        snapshot.completionFailed = true;
        const error = errorFrom(reason);
        for (const source of sources) source.onError(error);
      };
      if (!afterNativeCanvasGpuWork(renderer, this.scene, drawCamera, controller.signal, complete, failed)) {
        this.gpuCompletion = null;
        controller.abort();
      }
    };
    this.updateSnapshot(snapshot);
    return snapshot;
  }

  private updateSnapshot(snapshot: Snapshot, preserveOpacity = false): void {
    for (const [index, source] of snapshot.sources.entries()) {
      const requestedOpacity = this.sources.get(source.anchor.uuid) === source ? opacityOf(source) : 0;
      if (requestedOpacity <= 0.002) {
        snapshot.opacityValues[index] = 0;
      } else if (!preserveOpacity) {
        snapshot.opacityValues[index] = requestedOpacity;
      }
    }
    snapshot.clipEnabled.value = this.clip === null ? 0 : 1;
    if (this.clip !== null) {
      snapshot.center.value.set(...this.clip.center);
      snapshot.halfExtent.value.set(...this.clip.halfExtent);
      snapshot.softEdge.value = this.clip.softEdge;
    }
  }

  private activate(snapshot: Snapshot): void {
    if (snapshot.sortFailed) { snapshot.mesh.visible = false; return; }
    snapshot.mesh.visible = true;
    this.updateSnapshot(snapshot);
    if (this.active === snapshot) return;
    this.active?.mesh.removeFromParent();
    this.active = snapshot;
    this.scene.add(snapshot.mesh);
    // Map order is the cache's least-recently-used order.
    this.snapshots.delete(snapshot.key);
    this.snapshots.set(snapshot.key, snapshot);
    this.removeDominatedSnapshots(snapshot);
  }

  /** Export sorting is scoped to its synchronous draw. The addon restores the
   * interactive order and request metadata before pixel readback can yield. */
  capture<T>(camera: Camera, draw: () => T): T {
    if (this.active?.cpuSort === null || this.active === null || this.renderer === null) return draw();
    return this.active.mesh.withSynchronousSort(this.renderer, camera, draw);
  }

  private removeDominatedSnapshots(active: Snapshot): void {
    if (active.key !== this.key(active.sources)) return;
    const members = new Set(active.sources);
    const groups = new Set(active.sources.map((source) => source.residencyGroup()).filter((group) => group !== undefined));
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot === active || snapshot.sources.length >= active.sources.length || key !== this.key(snapshot.sources)) continue;
      if (!snapshot.sources.every((source) => this.sources.get(source.anchor.uuid) === source && members.has(source))) continue;
      const snapshotGroups = new Set(snapshot.sources.map((source) => source.residencyGroup()).filter((group) => group !== undefined));
      // A complete named level remains useful during a mixed-level handover.
      if (snapshotGroups.size > 0 && (snapshotGroups.size !== groups.size || [...snapshotGroups].some((group) => !groups.has(group)))) continue;
      // Compilation succeeded and every captured source is present unchanged in the active draw.
      // Release the superseded loading subset instead of retaining a second near-full copy.
      this.snapshots.delete(key);
      snapshot.dispose();
    }
  }

  private trimCache(): void {
    while (this.snapshots.size > 2) {
      const candidates = [...this.snapshots.values()].filter((snapshot) => snapshot !== this.active);
      const mixed = candidates.find((snapshot) => new Set(snapshot.sources.map((source) => source.residencyGroup()).filter((group) => group !== undefined)).size > 1);
      const remove = mixed ?? candidates[0];
      if (remove === undefined) break;
      this.snapshots.delete(remove.key); remove.dispose();
    }
  }

  private removeStaleSnapshots(): void {
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot === this.active) continue; // Retain last complete draw until its replacement is ready.
      if (snapshot.sources.some((source) => this.sources.get(source.anchor.uuid) !== source) || key !== this.key(snapshot.sources)) {
        this.snapshots.delete(key); snapshot.dispose();
      }
    }
  }

  private invalidateSnapshots(): void { this.generation++; this.failedKeys.clear(); this.removeStaleSnapshots(); this.schedule(); }
  private clearSnapshots(): void {
    for (const snapshot of this.snapshots.values()) snapshot.dispose();
    this.snapshots.clear(); this.active = null; this.failedKeys.clear();
  }
}

const runtimes = new WeakMap<Scene, NativeSplatScene>();
export function nativeSplatScene(scene: Scene): NativeSplatScene {
  let runtime = runtimes.get(scene);
  if (runtime === undefined) { runtime = new NativeSplatScene(scene); runtimes.set(scene, runtime); }
  return runtime;
}

export function withNativeSplatCapture<T>(scene: Scene, camera: Camera, draw: () => T): T {
  const runtime = runtimes.get(scene);
  return runtime === undefined ? draw() : runtime.capture(camera, draw);
}
