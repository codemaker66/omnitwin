// -----------------------------------------------------------------------------
// river-gate.glsl — the light and the water of scene 1, The River Gate, on a
// Lammas dusk. One fragment program over a fullscreen triangle: the sky from
// deep indigo to the last ember at a horizon set at 58% of the height, thin
// cloud streaks, stars that arrive with u_dusk; below the horizon a near-black
// river with a slow swell, the ember stretched into a vertical shimmer, every
// light in u_lights reflected as a broken streak, a low mist over the far
// water; the lantern flame at the first light (FlameCanvas maths, small), its
// halo, six to ten moths; rings from u_ripples; a 4% warmth at the pointer.
//
// Coordinates are normalised stage coordinates (0..1, y down) in a 16:9
// reference frame: y spans the full height whatever the aspect, x is centred,
// so a 9:16 phone shows the same composition cropped at the sides
// (stageViewport in lantern-program.ts). Distances use height units (q).
//
// Under u_reducedMotion the motion clock is pinned: the water and the flame
// are still frames and the moths stand; brightness and fades still answer,
// since a colour step is not a movement. The dither is by pixel, never time.
// Provenance: kind "Pr", code (WebGL fragment shader), this file.
// -----------------------------------------------------------------------------
export const RIVER_GATE_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_dusk;
uniform float u_lanternIntensity;
uniform vec4 u_pointer;
uniform vec4 u_lights[16];
uniform int u_lightCount;
uniform vec3 u_ripples[8];
uniform int u_rippleCount;
uniform float u_reducedMotion;
uniform int u_particles;

const float H = 0.58;
const float SA = 1.7777778;
const vec3 INDIGO = vec3(0.047, 0.063, 0.125);
const vec3 SLATE = vec3(0.118, 0.137, 0.212);
const vec3 EMBER_DEEP = vec3(0.353, 0.165, 0.071);
const vec3 EMBER_HOT = vec3(0.690, 0.333, 0.165);
const vec3 AMBER = vec3(0.890, 0.608, 0.227);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

// Where the sun went down: the afterglow is brightest left of centre and
// thins to nothing at the sides, so the ember is a place, not a bar.
float afterglow(float x) { return exp(-pow((x - 0.44) * 1.9, 2.0)); }

float cloudCover(float x, float t, float mt) {
  vec2 cp = vec2(x * 2.6 + mt * 0.0035, t * 26.0);
  float band = smoothstep(0.34, 0.70, t) * (1.0 - smoothstep(0.96, 1.0, t));
  return smoothstep(0.50, 0.76, fbm(cp)) * band;
}

// The sky at stage (x, t) where t runs 0 at the top to 1 at the horizon.
// Shared by the sky and by the river's mirror of it.
vec3 sky(float x, float t, float mt, float detail) {
  float ex = afterglow(x);
  float night = 1.0 - 0.6 * u_dusk;
  vec3 col = mix(INDIGO, SLATE, smoothstep(0.0, 0.78, t));
  // A low mottle so the gradient is a sky and not a swatch.
  col *= 0.94 + 0.12 * fbm(vec2(x * 1.6 + 3.0, t * 2.2));
  // The bruise above the ember: mauve going brown where the glow was.
  float bruise = smoothstep(0.62, 0.92, t) * (1.0 - smoothstep(0.92, 1.0, t));
  col = mix(col, vec3(0.200, 0.128, 0.140), bruise * (0.35 + 0.5 * ex) * night);
  float ember = smoothstep(0.84, 0.985, t) * (0.10 + 0.90 * ex);
  float hot = smoothstep(0.955, 1.0, t) * ex * ex;
  col = mix(col, EMBER_DEEP, ember * night);
  col = mix(col, EMBER_HOT, hot * 0.9 * (1.0 - 0.72 * u_dusk));

  // Thin streaks: low frequency along x, high along y, drifting slowly;
  // dark against the glow, their undersides catching a little of it.
  float cloud = cloudCover(x, t, mt) * detail;
  vec3 cloudCol = mix(col * 0.5, vec3(0.120, 0.082, 0.078), 0.5);
  cloudCol += EMBER_HOT * 0.20 * smoothstep(0.7, 0.97, t) * ex * night;
  col = mix(col, cloudCol, cloud * 0.85);
  return col;
}

// The candle of FlameCanvas, in a local frame where the flame spans about
// -1..1 vertically. Returns flame coverage and writes its colour.
float flameAt(vec2 fuv, float mt, float intensity, out vec3 fcol) {
  fuv.y += 0.30;
  float unrest = 1.0 - intensity;
  float sway = (noise(vec2(mt * 1.4, fuv.y * 3.0)) - 0.5) * 0.35 * (fuv.y * 0.5 + 0.55) * (1.0 + unrest * 2.4);
  float x = fuv.x + sway * smoothstep(-0.4, 0.9, fuv.y);
  float widthBase = mix(0.085, 0.21, smoothstep(-0.45, 0.05, fuv.y));
  float width = widthBase * (0.72 + 0.28 * intensity);
  float tipY = 0.20 + 0.64 * intensity;
  width *= 1.0 - smoothstep(0.02, tipY, fuv.y);
  float body = 1.0 - smoothstep(0.0, max(width, 0.001), abs(x));
  body *= smoothstep(-0.54, -0.42, fuv.y);
  float flame = body * (1.0 - smoothstep(tipY * 0.5, tipY, fuv.y));
  flame = pow(clamp(flame * 1.35, 0.0, 1.0), 0.85);
  flame *= 0.98 + 0.02 * sin(mt * 0.9);
  fcol = mix(vec3(0.10, 0.22, 0.50), vec3(0.96, 0.60, 0.16), smoothstep(-0.44, -0.16, fuv.y));
  fcol = mix(fcol, vec3(1.0, 0.90, 0.70), smoothstep(0.15, 0.75, flame));
  return flame;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 st = vec2(0.5 + (uv.x - 0.5) * aspect / SA, 1.0 - uv.y);
  vec2 q = vec2(st.x * SA, st.y);
  float mt = mix(u_time, 41.0, u_reducedMotion);
  float still = u_reducedMotion;
  float quality = clamp(float(u_particles) / 400.0, 0.25, 1.0);

  vec4 l0 = u_lightCount > 0 ? u_lights[0] : vec4(0.5, 0.56, 0.0, 1.0);
  float inten0 = l0.z * clamp(u_lanternIntensity, 0.05, 1.15);
  vec2 lq = vec2(l0.x * SA, l0.y);
  float ex = afterglow(st.x);
  float night = 1.0 - 0.6 * u_dusk;

  vec3 col;
  if (st.y < H) {
    float t = st.y / H;
    col = sky(st.x, t, mt, 1.0);

    // Stars: cell hash, a few brighter, faint twinkle, more of them as the
    // night wears on and fewer in the haze near the horizon; clouds hide them.
    vec2 sp = q * 150.0;
    vec2 cell = floor(sp);
    float h = hash(cell);
    float thr = 1.0 - 0.05 * quality;
    float star = 0.0;
    if (h > thr) {
      vec2 jitter = vec2(hash(cell + 7.1), hash(cell + 3.3)) * 0.6 + 0.2;
      float mag = hash(cell + 11.7);
      float twinkle = mix(0.82 + 0.18 * sin(mt * (1.2 + mag * 2.8) + h * 40.0), 1.0, still);
      float dd = length(fract(sp) - jitter);
      star = smoothstep(0.16 + 0.14 * mag, 0.0, dd) * (0.25 + 0.75 * mag * mag) * twinkle;
    }
    float starVis = u_dusk * smoothstep(0.92, 0.12, t) * (1.0 - cloudCover(st.x, t, mt));
    col += vec3(0.82, 0.86, 1.0) * star * starVis * 0.85;
  } else {
    float d = (st.y - H) / (1.0 - H);

    // The swell: a slow, low displacement that the mirror and every streak
    // share, so the whole surface breathes as one body of water.
    float swell = (noise(vec2(st.x * 3.0 + mt * 0.035, d * 5.0 - mt * 0.05)) - 0.5) * (1.0 - still);
    float chop = noise(vec2(st.x * 46.0 + swell * 4.0, d * 28.0 + mt * 0.32)) - 0.5;
    float xs = st.x + swell * 0.012 + chop * 0.004 * d;

    // The mirror: what the far bank's sky looks like on a rough surface. Most
    // of the river is near-black; the glow comes through only in patches,
    // where two scales of chop agree, and only near the far shore.
    float tm = 1.0 - d * 0.724 * (1.0 + swell * 0.35) + chop * 0.06 * d;
    vec3 mirror = sky(xs, clamp(tm, 0.0, 1.0), mt, 0.35);
    float fine = noise(vec2(xs * 90.0, d * 7.0 - mt * 0.20));
    float coarse = noise(vec2(xs * 26.0 + 3.0, d * 2.4 - mt * 0.07));
    float shimmer = smoothstep(0.38, 0.82, fine) * smoothstep(0.30, 0.72, coarse);
    // The glow reaches to different depths in different places.
    float fres = mix(0.55, 0.02, smoothstep(0.0, 0.35 + 0.5 * coarse, d));
    vec3 base = vec3(0.006, 0.008, 0.015) + SLATE * 0.05 * (1.0 - d);
    col = base + mirror * fres * (0.18 + 1.1 * shimmer) * 0.5;

    // Every light on the far bank: a streak from its mirror point toward the
    // viewer, wider and longer the nearer it comes, broken by the chop and
    // wandering a little with the swell.
    vec3 streaks = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (i >= u_lightCount) { break; }
      vec4 l = u_lights[i];
      float inten = i == 0 ? inten0 : l.z;
      float hgt = max(H - l.y, 0.0);
      float mirrorY = H + hgt;
      // Length grows with the square of brightness: windows make short
      // dashes, the lantern alone makes a column.
      float len = 0.015 + inten * inten * 0.20 + hgt * 0.3;
      float wdt = (0.003 + 0.009 * (st.y - H)) * (0.5 + inten);
      float wander = (noise(vec2(mt * 0.25 + l.x * 31.0, d * 2.0)) - 0.5) * 0.012 * d * (1.0 - still);
      float dx = (xs - l.x + wander) * SA;
      float across = exp(-dx * dx / (wdt * wdt));
      float along = smoothstep(-0.015, 0.006, st.y - mirrorY + hgt * 0.7) * exp(-max(st.y - mirrorY, 0.0) / len);
      float b1 = noise(vec2(xs * 120.0 + l.x * 53.0, d * 12.0 - mt * 0.30));
      float b2 = noise(vec2(xs * 30.0 + l.x * 17.0, d * 5.0 - mt * 0.12));
      float broken = 0.08 + 1.9 * smoothstep(0.40, 0.84, b1) * smoothstep(0.30, 0.72, b2);
      vec3 lc = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.61, 0.24), l.w);
      streaks += lc * inten * sqrt(inten) * across * along * broken;
    }
    col += streaks * 0.75;

    // Rings from a poke: two concentric ellipses, foreshortened, catching the
    // sky, gone in three seconds. Still under reduced motion: they fade only.
    for (int i = 0; i < 8; i++) {
      if (i >= u_rippleCount) { break; }
      vec3 r = u_ripples[i];
      float age = u_time - r.z;
      if (age < 0.0 || age > 3.0) { continue; }
      float k = age / 3.0;
      float radius = mix(0.010 + k * 0.11, 0.045, still);
      vec2 dr = q - vec2(r.x * SA, r.y);
      dr.y /= 0.38;
      float dist = length(dr);
      float w1 = 0.0035 + k * 0.012;
      float ring = exp(-pow((dist - radius) / w1, 2.0));
      ring += 0.55 * exp(-pow((dist - radius * 0.6) / (w1 * 0.8), 2.0));
      float fade = (1.0 - k) * (1.0 - k);
      col += mix(SLATE, EMBER_HOT, ex * 0.6) * ring * fade * 0.55;
    }

    // Mist over the far water: a low, drifting band that veils the streaks.
    float mn = fbm(vec2(st.x * 3.4 + mt * 0.012, d * 11.0 + 4.0));
    float mist = smoothstep(0.0, 0.04, d) * (1.0 - smoothstep(0.06, 0.24, d)) * (0.35 + 0.65 * mn);
    vec3 mistCol = vec3(0.075, 0.088, 0.120) + EMBER_HOT * 0.16 * ex * night;
    col = mix(col, mistCol, mist * 0.55);
  }

  // The lantern: the halo it throws, the flame, the moths that found it.
  vec2 dl = q - lq;
  float dh = length(vec2(dl.x, (dl.y - 0.004) * 1.15));
  float halo = (exp(-dh * 45.0) * 1.1 + exp(-dh * 11.0) * 0.36) * inten0;
  col += AMBER * halo;

  float fs = 0.013;
  vec3 fcol;
  float flame = flameAt(vec2(dl.x / fs, -dl.y / fs), mt, clamp(u_lanternIntensity, 0.05, 1.15), fcol);
  flame *= step(0.001, l0.z);
  col = mix(col, fcol, flame);
  col += fcol * flame * 0.45;

  int moths = int(clamp(float(u_particles) / 40.0, 6.0, 10.0));
  for (int i = 0; i < 10; i++) {
    if (i >= moths) { break; }
    float fi = float(i);
    float ph = hash(vec2(fi, 3.7)) * 6.2832;
    float rad = 0.014 + 0.024 * hash(vec2(fi, 9.1));
    float dir = hash(vec2(fi, 5.5)) > 0.5 ? 1.0 : -1.0;
    float spd = (0.7 + hash(vec2(fi, 1.3)) * 1.1) * dir;
    float a = ph + mt * spd;
    float wob = noise(vec2(mt * 0.9 + fi * 7.0, fi * 1.7)) - 0.5;
    vec2 mp = lq + vec2(0.0, -0.008) + vec2(cos(a), sin(a) * 0.7) * rad * (1.0 + wob * 0.7) + vec2(0.0, wob * 0.012);
    float dm = length(q - mp);
    float dotm = smoothstep(0.0022, 0.0005, dm);
    float lit = 0.35 + 0.65 * exp(-rad * 45.0);
    col += vec3(0.95, 0.80, 0.60) * dotm * lit * 0.85 * inten0;
  }

  // The pointer warms what it passes by about 4%.
  vec2 pq = vec2(u_pointer.x * SA, u_pointer.y);
  float dp = length(q - pq);
  col += vec3(0.95, 0.70, 0.45) * 0.04 * exp(-dp * dp / (0.085 * 0.085)) * u_pointer.w;

  // Vignette, a soft shoulder so the ember and the halo never clip, and a
  // pixel dither so the dark gradients never band.
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.42;
  col = clamp(col, 0.0, 2.5);
  col = col * (1.0 + col / 2.6) / (1.0 + col);
  col += (hash(gl_FragCoord.xy * 0.37) - 0.5) * (1.6 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}
`;
