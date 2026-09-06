// -----------------------------------------------------------------------------
// fire.glsl — the flame alone, for a later scene (the Fire, scene 11, and any
// candle). The candle maths of pages/landing/FlameCanvas.tsx, centred on the
// canvas, transparent around it, premultiplied so it adds light over whatever
// plane it sits on. u_lanternIntensity drives the gutter; under
// u_reducedMotion the flame is a still frame that still dims and rights
// itself, since brightness is a colour step, not a movement.
// Provenance: kind "Pr", code (WebGL fragment shader), this file.
// -----------------------------------------------------------------------------
export const FIRE_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_lanternIntensity;
uniform float u_reducedMotion;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float side = min(u_res.x, u_res.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / side * 2.0;
  uv.y += 0.30;
  float t = mix(u_time, 41.0, u_reducedMotion);
  float unrest = 1.0 - u_lanternIntensity;

  float sway = (noise(vec2(t * 1.4, uv.y * 3.0)) - 0.5) * 0.35 * (uv.y * 0.5 + 0.55) * (1.0 + unrest * 2.4);
  float x = uv.x + sway * smoothstep(-0.4, 0.9, uv.y);

  float widthBase = mix(0.085, 0.21, smoothstep(-0.45, 0.05, uv.y));
  float width = widthBase * (0.72 + 0.28 * u_lanternIntensity);
  float tipY = 0.20 + 0.64 * u_lanternIntensity;
  width *= 1.0 - smoothstep(0.02, tipY, uv.y);
  float body = 1.0 - smoothstep(0.0, max(width, 0.001), abs(x));
  body *= smoothstep(-0.54, -0.42, uv.y);
  float flame = body * (1.0 - smoothstep(tipY * 0.5, tipY, uv.y));
  flame = pow(clamp(flame * 1.35, 0.0, 1.0), 0.85);
  flame *= 0.98 + 0.02 * sin(t * 0.9);

  vec3 col = mix(vec3(0.10, 0.22, 0.50), vec3(0.96, 0.60, 0.16), smoothstep(-0.44, -0.16, uv.y));
  col = mix(col, vec3(1.0, 0.90, 0.70), smoothstep(0.15, 0.75, flame));

  float d = length(vec2(x, (uv.y + 0.12) * 1.35));
  float halo = exp(-d * 3.2) * 0.5 * u_lanternIntensity;

  vec3 rgb = col * flame + vec3(1.0, 0.74, 0.38) * halo;
  float alpha = clamp(max(flame, halo * 1.6), 0.0, 1.0);
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;
