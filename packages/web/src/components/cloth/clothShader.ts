// ---------------------------------------------------------------------------
// clothShader — custom ShaderMaterial for floating cloth vertex displacement
// ---------------------------------------------------------------------------
// Vertex shader: catenary drape + wave displacement driven by uniforms.
// Fragment shader: simple PBR-like with Lambertian + Fresnel sheen.
// ---------------------------------------------------------------------------

import { DoubleSide, Color, ShaderMaterial } from "three";
import type { IUniform } from "three";

// ---------------------------------------------------------------------------
// GLSL source
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uDisplacement;
  uniform float uSpeed;
  uniform float uHoverHeight;
  uniform float uEdgeSag;
  uniform float uRadius;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vRadiusFrac;
  varying float vWave;

  void main() {
    // Normalized distance from center (0-1)
    float r = length(position.xz) / uRadius;
    float rClamped = clamp(r, 0.0, 1.0);
    vRadiusFrac = rClamped;

    // Catenary drape: center at hover height, edges sag
    float drapeY = uHoverHeight - uEdgeSag * rClamped * rClamped;

    // Angle around center
    float angle = atan(position.z, position.x);

    // Wave displacement (same math as JS for consistency)
    float wave = 0.0;
    if (uDisplacement > 0.001) {
      // Primary radial wave
      float primaryAmp = 0.15 * uDisplacement;
      float primary = sin(rClamped * 3.0 * 3.14159 - uTime * 4.0) * primaryAmp;

      // Secondary angular folds
      float secondaryAmp = 0.08 * uDisplacement;
      float secondary = sin(angle * 5.0 + uTime * 2.0) * secondaryAmp * rClamped;

      // Velocity turbulence
      float turbAmp = 0.06 * min(uSpeed * 0.2, 1.0) * uDisplacement;
      float turbulence = sin(rClamped * 7.0 - uTime * 6.0 + angle * 3.0) * turbAmp;

      // Edges ripple more
      float edgeFactor = rClamped * rClamped;
      wave = (primary + secondary + turbulence) * (0.3 + 0.7 * edgeFactor);
    }

    vWave = wave;

    // Final position: flat disc displaced to drape + waves
    vec3 displaced = vec3(position.x, drapeY + wave, position.z);

    // Approximate normal from displacement gradient
    float eps = 0.01;
    float rPlus = clamp((r + eps), 0.0, 1.0);
    float rMinus = clamp((r - eps), 0.0, 1.0);
    float yPlus = uHoverHeight - uEdgeSag * rPlus * rPlus;
    float yMinus = uHoverHeight - uEdgeSag * rMinus * rMinus;
    float dydx = (yPlus - yMinus) / (2.0 * eps * uRadius);

    vec3 tangentR = normalize(vec3(cos(angle), dydx, sin(angle)));
    vec3 tangentA = normalize(vec3(-sin(angle), 0.0, cos(angle)));
    vNormal = normalize(cross(tangentA, tangentR));

    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDisplacement;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vRadiusFrac;
  varying float vWave;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);

    // Simple directional light from above-right
    vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
    float NdotL = max(dot(N, lightDir), 0.0);

    // Ambient
    float ambient = 0.35;
    float diffuse = NdotL * 0.55;

    // Fresnel sheen — edges catch light like real fabric
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float sheen = fresnel * 0.2;

    // Subtle fold darkening from wave displacement
    float foldDark = abs(vWave) * 1.5;
    float foldFactor = 1.0 - clamp(foldDark, 0.0, 0.2);

    // Edge translucency
    float edgeAlpha = 1.0 - vRadiusFrac * 0.15;

    vec3 color = uColor * (ambient + diffuse) * foldFactor + vec3(sheen);

    // Subtle blue-ish highlight on moving cloth
    color += vec3(0.02, 0.03, 0.06) * uDisplacement * fresnel;

    gl_FragColor = vec4(color, uOpacity * edgeAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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

export function createClothMaterial(uniforms: ClothShaderUniforms): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });
}
