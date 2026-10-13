// ---------------------------------------------------------------------------
// The hall's reflection environment
//
// Varnished floorboards, gilt frames, brass and the chandeliers' gilt reflect
// the room around them. A tiny stand-in of the hall — dark dado, ivory
// plaster, the uplit frieze band, the warm ceiling, the windows' sky and five
// bright chandeliers — is rendered into a pre-filtered environment map
// whenever the mood changes. It costs one small cube render, not a frame, and
// reuses one texture, so no material is rebuilt for a new mood.
// ---------------------------------------------------------------------------

import {
  BackSide,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial, type PMREMGenerator, type RenderTarget, type WebGPURenderer } from "three/webgpu";
import { HALL_CHANDELIERS, HALL_ELEVATION, HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_OPENINGS, hallWall, isWindow, openingTop, wallPoint } from "./hall-spec.js";
import type { HallMoodSpec } from "./hall-mood.js";

function shade(hex: string, intensity: number): Color {
  return new Color(hex).multiplyScalar(intensity);
}

/** Builds the stand-in room whose reflection the hall's glossy surfaces show. */
export function createEnvironmentScene(mood: HallMoodSpec): { scene: Scene; dispose: () => void } {
  const scene = new Scene();
  const disposables: { dispose: () => void }[] = [];
  const room = new BoxGeometry(HALL_HALF_LENGTH * 2, HALL_HEIGHT, HALL_HALF_WIDTH * 2, 8, 24, 8);
  room.translate(0, HALL_HEIGHT / 2, 0);
  const position = room.getAttribute("position");
  const colors: number[] = [];
  const ambient = new Color(mood.ambient).multiplyScalar(mood.ambientIntensity * 2.2);
  const warm = new Color(mood.chandelier).multiplyScalar(mood.chandelierIntensity);
  const uplight = new Color(mood.uplight).multiplyScalar(mood.uplightIntensity);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    let c: Color;
    if (y < 0.01) c = new Color("#6a4123").multiply(ambient.clone().add(warm.clone().multiplyScalar(0.4)));
    else if (y > HALL_HEIGHT - 0.01) c = new Color("#b77a3c").multiply(ambient.clone().add(warm.clone().multiplyScalar(0.9)));
    else if (y < HALL_ELEVATION.dadoTop) c = new Color("#3a1a0e").multiply(ambient.clone().add(warm.clone().multiplyScalar(0.3)));
    else if (y < HALL_ELEVATION.friezeBottom) c = new Color("#e9dcc2").multiply(ambient.clone().add(warm.clone().multiplyScalar(0.5)));
    else if (y < HALL_ELEVATION.friezeTop) c = new Color("#c99e5c").multiply(ambient.clone().add(uplight.clone().multiplyScalar(1.4)));
    else c = new Color("#8a5a30").multiply(ambient.clone().add(warm.clone().multiplyScalar(0.5)));
    colors.push(c.r, c.g, c.b);
  }
  room.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const roomMaterial = new MeshBasicNodeMaterial({ side: BackSide, vertexColors: true });
  scene.add(new Mesh(room, roomMaterial));
  disposables.push(room, roomMaterial);

  // The windows' sky.
  const sky = shade(mood.skyHorizon, mood.skyIntensity * 1.6);
  const skyMaterial = new MeshBasicNodeMaterial({ color: sky });
  disposables.push(skyMaterial);
  for (const opening of HALL_OPENINGS.filter(isWindow)) {
    const wall = hallWall(opening.wall);
    const height = openingTop(opening) - opening.sill;
    const plane = new PlaneGeometry(opening.width, height);
    disposables.push(plane);
    const mesh = new Mesh(plane, skyMaterial);
    const centre = wallPoint(wall, opening.centre, opening.sill + height / 2, 0.02);
    mesh.position.set(centre[0], centre[1], centre[2]);
    mesh.lookAt(centre[0] + wall.normal[0], centre[1], centre[2] + wall.normal[2]);
    scene.add(mesh);
  }

  // Chandeliers as bright warm bodies.
  const bulbGeometry = new SphereGeometry(0.42, 16, 10);
  const bulbMaterial = new MeshBasicNodeMaterial({ color: shade(mood.chandelier, 3 + 9 * mood.glow * mood.chandelierIntensity) });
  disposables.push(bulbGeometry, bulbMaterial);
  for (const chandelier of HALL_CHANDELIERS) {
    const mesh = new Mesh(bulbGeometry, bulbMaterial);
    mesh.position.set(chandelier.position[0], chandelier.position[1], chandelier.position[2]);
    mesh.scale.setScalar(chandelier.glowRadius / 0.42);
    scene.add(mesh);
  }
  return { scene, dispose: () => { for (const item of disposables) item.dispose(); } };
}

/**
 * Renders the stand-in room into a pre-filtered environment map with
 * `generator`, into `target` when given (both kept by the caller across
 * moods, so the filters compile once and the texture never changes), leaving
 * the renderer's target and state as it found them. Returns the target.
 */
export function renderHallEnvironment(renderer: WebGPURenderer, generator: PMREMGenerator, mood: HallMoodSpec, target: RenderTarget | null): RenderTarget {
  const { scene, dispose } = createEnvironmentScene(mood);
  const previousTarget = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mip = renderer.getActiveMipmapLevel();
  const autoClear = renderer.autoClear;
  try {
    return generator.fromScene(scene, 0.035, 0.1, 60, { size: 256, position: new Vector3(0, 1.4, 0), renderTarget: target });
  } finally {
    dispose();
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(previousTarget, face, mip);
  }
}
