import { useLayoutEffect, useMemo, useRef, type ReactElement, type RefObject } from "react";
import { FrontSide, Matrix4, Shape, type InstancedMesh } from "three";

type Vector3Tuple = readonly [number, number, number];

export interface SyntheticTradesHallFacadeDimensions {
  readonly width: number;
  readonly length: number;
  readonly height: number;
}

export interface SyntheticTradesHallFacadeInstance {
  readonly position: Vector3Tuple;
  readonly scale: Vector3Tuple;
}

interface SyntheticTradesHallPediment {
  readonly position: Vector3Tuple;
  readonly width: number;
  readonly height: number;
}

interface SyntheticTradesHallDome {
  readonly position: Vector3Tuple;
  readonly radius: number;
}

interface SyntheticTradesHallFacadeMetrics {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly frontZ: number;
  readonly detailZ: number;
  readonly lowerStoreyHeight: number;
  readonly principalStoreyHeight: number;
  readonly wallTop: number;
  readonly pavilionHeight: number;
  readonly parapetHeight: number;
}

interface SyntheticTradesHallFacadeOpenings {
  readonly trim: readonly SyntheticTradesHallFacadeInstance[];
  readonly glass: readonly SyntheticTradesHallFacadeInstance[];
  readonly archGlass: readonly SyntheticTradesHallFacadeInstance[];
}

export interface SyntheticTradesHallFacadeLayout {
  readonly presentationOnly: true;
  readonly position: Vector3Tuple;
  readonly massing: readonly SyntheticTradesHallFacadeInstance[];
  readonly trim: readonly SyntheticTradesHallFacadeInstance[];
  readonly glass: readonly SyntheticTradesHallFacadeInstance[];
  readonly archGlass: readonly SyntheticTradesHallFacadeInstance[];
  readonly medallions: readonly SyntheticTradesHallFacadeInstance[];
  readonly columns: readonly SyntheticTradesHallFacadeInstance[];
  readonly copperDetails: readonly SyntheticTradesHallFacadeInstance[];
  readonly pediment: SyntheticTradesHallPediment;
  readonly dome: SyntheticTradesHallDome;
  readonly estimatedDrawCalls: number;
}

const MIN_FACADE_WIDTH = 15.5;
const MAX_FACADE_WIDTH = 19.5;
const FACADE_TO_ROOM_WIDTH_RATIO = 0.86;
const MIN_FACADE_HEIGHT = 7.2;
const MAX_FACADE_HEIGHT = 8.2;
const FACADE_TO_ROOM_HEIGHT_RATIO = 1.08;
const MIN_FACADE_DEPTH = 0.62;
const MAX_FACADE_DEPTH = 0.82;
const FACADE_TO_ROOM_LENGTH_RATIO = 0.07;
const FACADE_CLEARANCE_FROM_ROOM = 1.85;
const FACADE_BASE_Y = -0.36;
const WINDOW_FRAME_THICKNESS = 0.075;
const WINDOW_SURFACE_DEPTH = 0.055;
const FACADE_DETAIL_DEPTH = 0.12;
const LOWER_WINDOW_X_RATIOS = [-0.43, -0.286, -0.143, 0, 0.143, 0.286, 0.43] as const;
const PRINCIPAL_WINDOW_X_RATIOS = [-0.37, -0.185, 0, 0.185, 0.37] as const;
const PORTICO_COLUMN_X_RATIOS = [-0.14, -0.05, 0.05, 0.14] as const;
const MEDALLION_COUNT = 13;
const BALUSTER_COUNT = 19;

/** Nine material/geometry batches; every repeated element is instanced. */
export const SYNTHETIC_TRADES_HALL_FACADE_MAX_DRAW_CALLS = 9;

const MASSING_COLOR = "#aa8a5e";
const TRIM_COLOR = "#d1b783";
const GLASS_COLOR = "#15282d";
const COPPER_COLOR = "#6ca285";
const DISABLED_RAYCAST = (): void => undefined;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertValidDimensions({ width, length, height }: SyntheticTradesHallFacadeDimensions): void {
  if (![width, length, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError("Synthetic Trades Hall facade dimensions must be finite positive numbers.");
  }
}

function facadeInstance(
  position: Vector3Tuple,
  scale: Vector3Tuple,
): SyntheticTradesHallFacadeInstance {
  return { position, scale };
}

function appendWindowFrame(
  target: SyntheticTradesHallFacadeInstance[],
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
): void {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  target.push(
    facadeInstance([x - halfWidth, y, z], [WINDOW_FRAME_THICKNESS, height, FACADE_DETAIL_DEPTH]),
    facadeInstance([x + halfWidth, y, z], [WINDOW_FRAME_THICKNESS, height, FACADE_DETAIL_DEPTH]),
    facadeInstance([x, y - halfHeight, z], [width, WINDOW_FRAME_THICKNESS, FACADE_DETAIL_DEPTH]),
    facadeInstance([x, y + halfHeight, z], [width, WINDOW_FRAME_THICKNESS, FACADE_DETAIL_DEPTH]),
  );
}

function computeFacadeMetrics(
  dimensions: SyntheticTradesHallFacadeDimensions,
): SyntheticTradesHallFacadeMetrics {
  const width = clamp(
    dimensions.width * FACADE_TO_ROOM_WIDTH_RATIO,
    MIN_FACADE_WIDTH,
    MAX_FACADE_WIDTH,
  );
  const height = clamp(
    dimensions.height * FACADE_TO_ROOM_HEIGHT_RATIO,
    MIN_FACADE_HEIGHT,
    MAX_FACADE_HEIGHT,
  );
  const depth = clamp(
    dimensions.length * FACADE_TO_ROOM_LENGTH_RATIO,
    MIN_FACADE_DEPTH,
    MAX_FACADE_DEPTH,
  );
  const lowerStoreyHeight = height * 0.48;
  const principalStoreyHeight = height * 0.4;
  return {
    width,
    height,
    depth,
    frontZ: depth / 2 + WINDOW_SURFACE_DEPTH,
    detailZ: depth / 2 + FACADE_DETAIL_DEPTH / 2,
    lowerStoreyHeight,
    principalStoreyHeight,
    wallTop: lowerStoreyHeight + principalStoreyHeight,
    pavilionHeight: height * 0.16,
    parapetHeight: height * 0.085,
  };
}

function createFacadeMassing(
  metrics: SyntheticTradesHallFacadeMetrics,
): readonly SyntheticTradesHallFacadeInstance[] {
  const { width, depth, lowerStoreyHeight, principalStoreyHeight, wallTop, pavilionHeight, parapetHeight } = metrics;
  return [
    facadeInstance([0, lowerStoreyHeight / 2, 0], [width, lowerStoreyHeight, depth]),
    facadeInstance([0, lowerStoreyHeight + principalStoreyHeight / 2, 0], [
      width * 0.92,
      principalStoreyHeight,
      depth * 0.94,
    ]),
    facadeInstance([-width * 0.37, wallTop + pavilionHeight / 2, 0], [
      width * 0.19,
      pavilionHeight,
      depth * 0.9,
    ]),
    facadeInstance([width * 0.37, wallTop + pavilionHeight / 2, 0], [
      width * 0.19,
      pavilionHeight,
      depth * 0.9,
    ]),
    facadeInstance([0, wallTop + parapetHeight / 2, 0], [width * 0.32, parapetHeight, depth * 0.88]),
  ];
}

function createFacadeBaseTrim(
  metrics: SyntheticTradesHallFacadeMetrics,
): SyntheticTradesHallFacadeInstance[] {
  const { width, depth, detailZ, lowerStoreyHeight, wallTop, pavilionHeight } = metrics;
  return [
    facadeInstance([0, 0.15, detailZ], [width + 0.38, 0.3, depth + 0.16]),
    facadeInstance([0, lowerStoreyHeight - 0.1, detailZ], [width + 0.12, 0.2, depth + 0.12]),
    facadeInstance([0, lowerStoreyHeight + 0.17, detailZ], [width * 0.95, 0.14, depth + 0.08]),
    facadeInstance([0, wallTop - 0.08, detailZ], [width * 0.96, 0.24, depth + 0.14]),
    facadeInstance([-width * 0.37, wallTop + pavilionHeight, detailZ], [
      width * 0.21,
      0.2,
      depth + 0.1,
    ]),
    facadeInstance([width * 0.37, wallTop + pavilionHeight, detailZ], [
      width * 0.21,
      0.2,
      depth + 0.1,
    ]),
  ];
}

function appendLowerWindows(
  metrics: SyntheticTradesHallFacadeMetrics,
  trim: SyntheticTradesHallFacadeInstance[],
  glass: SyntheticTradesHallFacadeInstance[],
): void {
  const windowWidth = metrics.width * 0.072;
  const windowHeight = metrics.lowerStoreyHeight * 0.48;
  const windowY = metrics.lowerStoreyHeight * 0.44;
  for (const xRatio of LOWER_WINDOW_X_RATIOS) {
    const x = metrics.width * xRatio;
    glass.push(facadeInstance(
      [x, windowY, metrics.frontZ],
      [windowWidth, windowHeight, WINDOW_SURFACE_DEPTH],
    ));
    appendWindowFrame(trim, x, windowY, windowWidth, windowHeight, metrics.detailZ);
  }
}

function appendPrincipalWindows(
  metrics: SyntheticTradesHallFacadeMetrics,
  trim: SyntheticTradesHallFacadeInstance[],
  glass: SyntheticTradesHallFacadeInstance[],
  archGlass: SyntheticTradesHallFacadeInstance[],
): void {
  const windowWidth = metrics.width * 0.09;
  const windowHeight = metrics.principalStoreyHeight * 0.42;
  const windowY = metrics.lowerStoreyHeight + metrics.principalStoreyHeight * 0.38;
  for (const xRatio of PRINCIPAL_WINDOW_X_RATIOS) {
    const x = metrics.width * xRatio;
    glass.push(facadeInstance(
      [x, windowY, metrics.frontZ],
      [windowWidth, windowHeight, WINDOW_SURFACE_DEPTH],
    ));
    archGlass.push(facadeInstance(
      [x, windowY + windowHeight / 2, metrics.frontZ],
      [windowWidth, windowWidth, WINDOW_SURFACE_DEPTH],
    ));
    appendWindowFrame(trim, x, windowY, windowWidth, windowHeight, metrics.detailZ);
    trim.push(facadeInstance(
      [x, windowY, metrics.detailZ + FACADE_DETAIL_DEPTH * 0.1],
      [WINDOW_FRAME_THICKNESS, windowHeight, FACADE_DETAIL_DEPTH],
    ));
  }
}

function appendPavilionWindows(
  metrics: SyntheticTradesHallFacadeMetrics,
  trim: SyntheticTradesHallFacadeInstance[],
  glass: SyntheticTradesHallFacadeInstance[],
): void {
  const windowWidth = metrics.width * 0.05;
  const windowHeight = metrics.pavilionHeight * 0.45;
  const windowY = metrics.wallTop + metrics.pavilionHeight * 0.48;
  for (const xRatio of [-0.37, 0.37] as const) {
    const x = metrics.width * xRatio;
    glass.push(facadeInstance(
      [x, windowY, metrics.frontZ],
      [windowWidth, windowHeight, WINDOW_SURFACE_DEPTH],
    ));
    appendWindowFrame(trim, x, windowY, windowWidth, windowHeight, metrics.detailZ);
  }
}

function appendRustication(
  metrics: SyntheticTradesHallFacadeMetrics,
  trim: SyntheticTradesHallFacadeInstance[],
): void {
  const step = metrics.lowerStoreyHeight / 8;
  const recessedZ = metrics.depth / 2 + 0.018;
  for (let index = 1; index < 8; index += 1) {
    trim.push(facadeInstance(
      [0, index * step, recessedZ],
      [metrics.width * 0.99, 0.025, FACADE_DETAIL_DEPTH * 0.45],
    ));
  }
}

function appendBalustrade(
  metrics: SyntheticTradesHallFacadeMetrics,
  trim: SyntheticTradesHallFacadeInstance[],
): void {
  const span = metrics.width * 0.88;
  const y = metrics.wallTop + metrics.parapetHeight * 0.66;
  for (let index = 0; index < BALUSTER_COUNT; index += 1) {
    const progress = index / (BALUSTER_COUNT - 1);
    const x = -span / 2 + progress * span;
    trim.push(facadeInstance([x, y, metrics.detailZ], [0.07, metrics.parapetHeight * 0.8, 0.08]));
  }
  trim.push(
    facadeInstance([0, y - metrics.parapetHeight * 0.38, metrics.detailZ], [span, 0.07, 0.09]),
    facadeInstance([0, y + metrics.parapetHeight * 0.38, metrics.detailZ], [span, 0.07, 0.09]),
  );
}

function createFacadeOpenings(
  metrics: SyntheticTradesHallFacadeMetrics,
): SyntheticTradesHallFacadeOpenings {
  const trim = createFacadeBaseTrim(metrics);
  const glass: SyntheticTradesHallFacadeInstance[] = [];
  const archGlass: SyntheticTradesHallFacadeInstance[] = [];
  appendLowerWindows(metrics, trim, glass);
  appendPrincipalWindows(metrics, trim, glass, archGlass);
  appendPavilionWindows(metrics, trim, glass);
  appendRustication(metrics, trim);
  appendBalustrade(metrics, trim);
  return { trim, glass, archGlass };
}

function createMedallions(
  metrics: SyntheticTradesHallFacadeMetrics,
): readonly SyntheticTradesHallFacadeInstance[] {
  const instances: SyntheticTradesHallFacadeInstance[] = [];
  const span = metrics.width * 0.48;
  for (let index = 0; index < MEDALLION_COUNT; index += 1) {
    const progress = index / (MEDALLION_COUNT - 1);
    const x = -span / 2 + progress * span;
    instances.push(facadeInstance(
      [x, metrics.wallTop + metrics.parapetHeight * 0.48, metrics.detailZ + 0.01],
      [0.19, 0.19, 0.05],
    ));
  }
  return instances;
}

function createColumns(
  metrics: SyntheticTradesHallFacadeMetrics,
): readonly SyntheticTradesHallFacadeInstance[] {
  const height = metrics.principalStoreyHeight * 0.86;
  const diameter = metrics.width * 0.021;
  return PORTICO_COLUMN_X_RATIOS.map((xRatio) => facadeInstance(
    [metrics.width * xRatio, metrics.lowerStoreyHeight + height / 2 - 0.08, metrics.detailZ + 0.16],
    [diameter, height, diameter],
  ));
}

function createPediment(metrics: SyntheticTradesHallFacadeMetrics): SyntheticTradesHallPediment {
  return {
    position: [
      0,
      metrics.lowerStoreyHeight + metrics.principalStoreyHeight * 0.78,
      metrics.detailZ + 0.04,
    ],
    width: metrics.width * 0.38,
    height: metrics.height * 0.14,
  };
}

function createDome(metrics: SyntheticTradesHallFacadeMetrics): SyntheticTradesHallDome {
  return {
    position: [0, metrics.wallTop + metrics.pavilionHeight * 0.62, 0],
    radius: metrics.width * 0.105,
  };
}

function createCopperDetails(
  dome: SyntheticTradesHallDome,
): readonly SyntheticTradesHallFacadeInstance[] {
  const domeSpringY = dome.position[1];
  return [
    facadeInstance([0, domeSpringY - 0.34, 0], [dome.radius * 1.46, 0.72, dome.radius * 1.46]),
    facadeInstance([0, domeSpringY + dome.radius + 0.2, 0], [0.48, 0.5, 0.48]),
    facadeInstance([0, domeSpringY + dome.radius + 0.78, 0], [0.11, 0.86, 0.11]),
  ];
}

/**
 * A deliberately shallow, photo-informed presentation shell. The returned
 * transform sits beyond the room envelope and is never consumed by layout,
 * collision, capacity, or historical-runtime code.
 */
export function createSyntheticTradesHallFacadeLayout(
  dimensions: SyntheticTradesHallFacadeDimensions,
): SyntheticTradesHallFacadeLayout {
  assertValidDimensions(dimensions);
  const metrics = computeFacadeMetrics(dimensions);
  const openings = createFacadeOpenings(metrics);
  const dome = createDome(metrics);
  return {
    presentationOnly: true,
    position: [0, FACADE_BASE_Y, -(dimensions.length / 2 + FACADE_CLEARANCE_FROM_ROOM)],
    massing: createFacadeMassing(metrics),
    trim: openings.trim,
    glass: openings.glass,
    archGlass: openings.archGlass,
    medallions: createMedallions(metrics),
    columns: createColumns(metrics),
    copperDetails: createCopperDetails(dome),
    pediment: createPediment(metrics),
    dome,
    estimatedDrawCalls: SYNTHETIC_TRADES_HALL_FACADE_MAX_DRAW_CALLS,
  };
}

function useInstancedFacadeMatrices(
  instances: readonly SyntheticTradesHallFacadeInstance[],
): RefObject<InstancedMesh> {
  const meshRef = useRef<InstancedMesh>(null);
  const matrix = useMemo(() => new Matrix4(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    mesh.raycast = DISABLED_RAYCAST;
    mesh.count = instances.length;
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      if (instance === undefined) continue;
      matrix.makeScale(instance.scale[0], instance.scale[1], instance.scale[2]);
      matrix.setPosition(instance.position[0], instance.position[1], instance.position[2]);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, matrix]);

  return meshRef;
}

function InstancedFacadeBoxes({
  name,
  instances,
  color,
  roughness,
  metalness,
}: {
  readonly name: string;
  readonly instances: readonly SyntheticTradesHallFacadeInstance[];
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
}): ReactElement {
  const meshRef = useInstancedFacadeMatrices(instances);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, instances.length]} name={name}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        side={FrontSide}
      />
    </instancedMesh>
  );
}

function InstancedFacadeCircles({
  name,
  instances,
  color,
  roughness,
  metalness,
}: {
  readonly name: string;
  readonly instances: readonly SyntheticTradesHallFacadeInstance[];
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
}): ReactElement {
  const meshRef = useInstancedFacadeMatrices(instances);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, instances.length]} name={name}>
      <circleGeometry args={[0.5, 18]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        side={FrontSide}
      />
    </instancedMesh>
  );
}

function InstancedFacadeCylinders({
  name,
  instances,
  color,
  roughness,
  metalness,
}: {
  readonly name: string;
  readonly instances: readonly SyntheticTradesHallFacadeInstance[];
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
}): ReactElement {
  const meshRef = useInstancedFacadeMatrices(instances);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, instances.length]} name={name}>
      <cylinderGeometry args={[0.5, 0.5, 1, 14]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        side={FrontSide}
      />
    </instancedMesh>
  );
}

function SyntheticFacadePediment({ pediment }: { readonly pediment: SyntheticTradesHallPediment }): ReactElement {
  const shape = useMemo(() => {
    const triangle = new Shape();
    triangle.moveTo(-pediment.width / 2, 0);
    triangle.lineTo(0, pediment.height);
    triangle.lineTo(pediment.width / 2, 0);
    triangle.closePath();
    return triangle;
  }, [pediment.height, pediment.width]);

  return (
    <mesh
      name="synthetic-trades-hall-pediment"
      position={[pediment.position[0], pediment.position[1], pediment.position[2]]}
      raycast={DISABLED_RAYCAST}
    >
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={TRIM_COLOR} roughness={0.82} metalness={0.02} side={FrontSide} />
    </mesh>
  );
}

export function SyntheticTradesHallFacade({
  width,
  length,
  height,
}: SyntheticTradesHallFacadeDimensions): ReactElement {
  const layout = useMemo(
    () => createSyntheticTradesHallFacadeLayout({ width, length, height }),
    [height, length, width],
  );

  return (
    <group
      name="synthetic-trades-hall-facade-stand-in"
      position={[layout.position[0], layout.position[1], layout.position[2]]}
      userData={{
        presentationSource: "synthetic-stand-in",
        presentationOnly: true,
        affectsRoomEnvelope: false,
        affectsCapacity: false,
        affectsHistory: false,
      }}
    >
      <InstancedFacadeBoxes
        name="synthetic-trades-hall-facade-massing"
        instances={layout.massing}
        color={MASSING_COLOR}
        roughness={0.9}
        metalness={0.01}
      />
      <InstancedFacadeBoxes
        name="synthetic-trades-hall-facade-trim"
        instances={layout.trim}
        color={TRIM_COLOR}
        roughness={0.8}
        metalness={0.02}
      />
      <InstancedFacadeBoxes
        name="synthetic-trades-hall-facade-glass"
        instances={layout.glass}
        color={GLASS_COLOR}
        roughness={0.2}
        metalness={0.28}
      />
      <InstancedFacadeCircles
        name="synthetic-trades-hall-arched-window-glass"
        instances={layout.archGlass}
        color={GLASS_COLOR}
        roughness={0.2}
        metalness={0.28}
      />
      <InstancedFacadeCircles
        name="synthetic-trades-hall-medallions"
        instances={layout.medallions}
        color={TRIM_COLOR}
        roughness={0.76}
        metalness={0.02}
      />
      <InstancedFacadeCylinders
        name="synthetic-trades-hall-portico-columns"
        instances={layout.columns}
        color={TRIM_COLOR}
        roughness={0.78}
        metalness={0.02}
      />
      <SyntheticFacadePediment pediment={layout.pediment} />
      <mesh
        name="synthetic-trades-hall-copper-dome"
        position={[layout.dome.position[0], layout.dome.position[1], layout.dome.position[2]]}
        raycast={DISABLED_RAYCAST}
      >
        <sphereGeometry args={[layout.dome.radius, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={COPPER_COLOR} roughness={0.54} metalness={0.38} side={FrontSide} />
      </mesh>
      <InstancedFacadeCylinders
        name="synthetic-trades-hall-copper-details"
        instances={layout.copperDetails}
        color={COPPER_COLOR}
        roughness={0.54}
        metalness={0.38}
      />
    </group>
  );
}
