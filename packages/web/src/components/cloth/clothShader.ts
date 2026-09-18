// Native Three.js TSL cloth: the same catenary, waves and fabric shading on
// both WebGPU and Three's WebGL fallback.
import { DoubleSide, Color } from "three";
import type { IUniform } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs, atan, cameraPosition, clamp, cos, cross, dot, float, length, max, min,
  modelWorldMatrix, normalize, positionLocal, pow, sin, uniform, varying, vec3, vec4,
} from "three/tsl";

export interface ClothShaderUniforms {
  [uniform: string]: IUniform;
  uTime: IUniform<number>;
  uDisplacement: IUniform<number>;
  uSpeed: IUniform<number>;
  uHoverHeight: IUniform<number>;
  uEdgeSag: IUniform<number>;
  uRadius: IUniform<number>;
  uColor: IUniform<Color>;
  uOpacity: IUniform<number>;
}

export function createClothUniforms(
  hoverHeight: number,
  edgeSag: number,
  radius: number,
): ClothShaderUniforms {
  return {
    uTime: { value: 0 },
    uDisplacement: { value: 0 },
    uSpeed: { value: 0 },
    uHoverHeight: { value: hoverHeight },
    uEdgeSag: { value: edgeSag },
    uRadius: { value: radius },
    uColor: { value: new Color("#1a1a1a") },
    uOpacity: { value: 0.85 },
  };
}

export function createClothMaterial(uniforms: ClothShaderUniforms): MeshBasicNodeMaterial {
  const time = uniform(0).onRenderUpdate(() => uniforms.uTime.value);
  const displacement = uniform(0).onRenderUpdate(() => uniforms.uDisplacement.value);
  const speed = uniform(0).onRenderUpdate(() => uniforms.uSpeed.value);
  const hoverHeight = uniform(0).onRenderUpdate(() => uniforms.uHoverHeight.value);
  const edgeSag = uniform(0).onRenderUpdate(() => uniforms.uEdgeSag.value);
  const radius = uniform(1).onRenderUpdate(() => uniforms.uRadius.value);
  const color = uniform(uniforms.uColor.value).onRenderUpdate(() => uniforms.uColor.value);
  const opacity = uniform(0.85).onRenderUpdate(() => uniforms.uOpacity.value);
  const r = length(positionLocal.xz).div(radius);
  const fraction = clamp(r, 0, 1);
  const angle = atan(positionLocal.z, positionLocal.x);
  const drape = hoverHeight.sub(edgeSag.mul(fraction).mul(fraction));
  const primary = sin(fraction.mul(3 * 3.14159).sub(time.mul(4))).mul(displacement).mul(0.15);
  const secondary = sin(angle.mul(5).add(time.mul(2))).mul(displacement).mul(0.08).mul(fraction);
  const turbulence = sin(fraction.mul(7).sub(time.mul(6)).add(angle.mul(3)))
    .mul(min(speed.mul(0.2), 1)).mul(displacement).mul(0.06);
  const wave = displacement.greaterThan(0.001).select(
    primary.add(secondary).add(turbulence).mul(fraction.mul(fraction).mul(0.7).add(0.3)), float(0),
  );
  const displaced = vec3(positionLocal.x, drape.add(wave), positionLocal.z);
  const plus = clamp(r.add(0.01), 0, 1);
  const minus = clamp(r.sub(0.01), 0, 1);
  const gradient = edgeSag.mul(minus.mul(minus).sub(plus.mul(plus))).div(radius.mul(0.02));
  const radial = normalize(vec3(cos(angle), gradient, sin(angle)));
  const angular = normalize(vec3(sin(angle).negate(), 0, cos(angle)));
  const normal = normalize(varying(normalize(cross(angular, radial))));
  const view = normalize(varying(normalize(cameraPosition.sub(modelWorldMatrix.mul(vec4(displaced, 1)).xyz))));
  const diffuse = max(dot(normal, normalize(vec3(0.3, 1, 0.2))), 0).mul(0.55).add(0.35);
  const fresnel = pow(float(1).sub(max(dot(normal, view), 0)), 3);
  const fold = float(1).sub(clamp(abs(varying(wave)).mul(1.5), 0, 0.2));
  const shaded = color.mul(diffuse).mul(fold).add(vec3(fresnel.mul(0.2)))
    .add(vec3(0.02, 0.03, 0.06).mul(displacement).mul(fresnel));
  const alpha = opacity.mul(float(1).sub(varying(fraction).mul(0.15)));
  const material = new MeshBasicNodeMaterial({ fog: false, transparent: true, side: DoubleSide, depthWrite: false });
  material.positionNode = displaced;
  material.fragmentNode = vec4(shaded, alpha);
  return material;
}
