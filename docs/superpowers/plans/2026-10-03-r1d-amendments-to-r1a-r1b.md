# R1d's amendments to the R1a and R1b plans (T-639, 3 October)

> **Status: applied 7 October; superseded in part (8 October).** A1–A8, A10 and A11 are applied in R1a's and R1b's consolidated texts. Their quoted anchors are historical: R1d anchors on the current plans' text (R1d Task 0), and nothing here is to be re-applied. Superseded in part on 8 October:
>
> - **A5's anchor** (`plus, when the sun is up, sunRGB × V(p) × cosθ + Σw b[w] × sunRGB ⊙ I[w].`) no longer exists. R1a's "The multiplier" and its Task 5 already carry both bodies, and R1b names A5's `visibility` local `v`.
> - **A9** is superseded by R1a Task 4's factored sky-body basis, computed by R1b (the controller's ruling of 7 October). Point 2's passes (`sunVisibilityNode` per patch ray, a sum pass, a coefficient pass) are now R1b Task 10's nine passes (`skyRayNode`, patch sums, ordered partials, coefficients, basis), and the CPU twin's lazily computed `P_w` is now R1b's `displaySky` (GPU read-backs, provisional values until one lands). Point 3's read access stands; R1d reads it at most four times a second while the light moves, never the CPU twin per frame (ruling E1). Point 4's 1 ms is judged by R1b Task 18 and measured by R1d Task 23.
> - **"Interfaces R1d expects from the bake and the frontier studies", items 1–3.** The bulb table now holds 173 entries over all five chandeliers, with a `confidence` per entry and no `not_yet_triangulated` key. The lamps are its 140 `high` and `medium` entries, with the centre chandelier's 7 crown tubes as a kind of their own (rulings L1 and L2). R1a Task 4b fits a colour per lamp group, so the line "today all four lamp groups share one measured colour" is stale. It writes one intensity per lamp of a group and kind, uniform within the group: `bulb-intensities.json` = `{ schema, wCrown, bulbs: { <id>: { kind, intensity } }, fit: { notLamps, tableSha256 } }`. These are not per-bulb shares from the clipped blobs, which are evidence only. The warm-down starts from each group's own colour (ruling L3), not from one temperature.
> - **"The R1c interface R1d consumes", item 4.** `SkinSurface` also carries R1c Task 20's optional `specularColour: Node<"vec3">` (the metal's Fresnel colour), which R1d's sheen takes for F0 (R1d Task 17).
>
> The body below is kept as written on 3 and 7 October.

R1d ("cinematic light", `docs/superpowers/plans/2026-10-03-restored-hall-r1d-cinematic-light.md`) builds on R1a and R1b as these amendments leave them. Apply them in one pass, with R1c's (`docs/superpowers/plans/2026-10-03-r1c-amendments-to-r1a-r1b.md`), before R1a Task 5 is dispatched; R1d's Task 0 checks that each one is present. Every edit below is a literal replacement in the named plan's code or text ("Replace … with …") or a literal addition ("Add … directly after …"). Where R1c's amendments touch the same lines (marked **Overlap**), apply both: the result keeps R1c's change and R1d's.

Sections: A1 the emitter rule · A2 the floor's base light on the GPU · A3 the Moon · A4 two sky bodies in the light setting · A5 the Moon's direct light in the multiplier · A6 the sky band (done in R1a) · A7 the presets · A8 the test vectors · A9 the sky-body bounce basis in the browser · A10 one preview at the end · A11 wording · the R1c interface R1d consumes · the interfaces R1d expects from the bake and the frontier studies.

Revised 7 October: A2 reads the folded scenario volume; A5 carries the Moon's direct light only; A6 and A9 follow R1a Task 4 as committed (`a2a25c56`: the band covers the Moon, the bounce is the factored sky-body basis); the R1c interface gains `SkinSurface.bodyVisibility` and the pass stride's listener; A1's tints follow R1d decision 11 (the lamps are LED; the warm-down is the owner's artistic choice); and the last section lists what R1d expects from the bake and the frontier studies (the bulb table, the house-light refit).

Plans: **R1a** = `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`; **R1b** = `docs/superpowers/plans/2026-09-29-restored-hall-r1b-relit-browser.md`.

---

## A1. The emitter rule: no boost, lamp tints

Why (R1 polished §4.3, §4.1 as amended 7 October): "the bulb splats are no longer boosted"; crisp frosted candle lamps carry the chandeliers (R1d Task 11) and, while they draw, a chandelier's glow splats (class 3) are hidden rather than tinted (R1d decision 1); and a lamp group's colour warms as it dims by Blake's artistic choice (R1d Task 4: the hall's lamps are LED, and a group flagged `led` keeps its colour), which the remaining lamp splats (the dome's crests, the cove, a chandelier without crisp lamps) must follow.

**R1a, section "The multiplier (normative)", the lamp emitters bullet.** Replace:

`- Lamp emitters (class 3 chandelier bulbs, class 4 dome lamps, class 5 cove strip) and fixtures (class 6) at lamp level ℓ ∈ [0, 1] of their group: \`Mlit = 1 + (β − 1) × smoothstep(0.45, 0.9, L)\` for classes 3 and 4, where β is the setting's emitter boost: 1 at the captured setting, so the captured setting stays exactly neutral, and 4 for the proof's night with the lamps lit; \`1\` for class 5, and the interior rule for class 6.`

with:

`- Lamp emitters (class 3 chandelier bulbs, class 4 dome lamps, class 5 cove strip) and fixtures (class 6) at lamp level ℓ ∈ [0, 1] of their group: \`Mlit = t × (1 + (β − 1) × smoothstep(0.45, 0.9, L))\` for classes 3 and 4 and \`Mlit = t\` for class 5, where t is the group's lamp tint (RGB, the colour of the dimmed lamp relative to its full-power colour; 1 at full power and in every preset) and β the setting's emitter boost, 1 in every setting (amended 3 October for R1d: crisp bulbs replace the boost), so the captured setting stays exactly neutral; the interior rule for class 6.`

(The rest of the bullet, `Munlit = …`, is unchanged.)

**R1a, Revisions (30 September), item 19.** Replace `with \`emitterBoost\` 1 for \`captured\` and \`sunny_morning\` and 4 for \`night\`.` with `with \`emitterBoost\` 1 for every setting (R1d amendment A1).`

**R1a, Task 5, Step 3 (`reference.py`).** In `class Setting`, replace:

```python
    emitter_boost: float = 1.0   # 1 at the captured setting; 4 for the proof's night with the lamps lit
```

with:

```python
    emitter_boost: float = 1.0   # 1 in every setting (R1d draws crisp bulbs instead of boosting the bulb splats)
    lamp_tints: dict = field(default_factory=lambda: {g: (1.0, 1.0, 1.0) for g in LAMP_GROUPS})   # group -> RGB tint
    moon_dir: np.ndarray | None = None   # (3,) toward the Moon, model frame (amendment A5)
    moon_rgb: np.ndarray = field(default_factory=lambda: np.zeros(3))
```

and replace:

```python
        lit = np.where(bulb, (1.0 + (setting.emitter_boost - 1.0) * smoothstep(0.45, 0.9, L[fx]))[:, None], np.where(cove, 1.0, M[fx]))
```

with:

```python
        tint = np.array([setting.lamp_tints[g] for g in group[fx]], np.float64)
        lit = np.where(bulb, (1.0 + (setting.emitter_boost - 1.0) * smoothstep(0.45, 0.9, L[fx]))[:, None] * tint,
                       np.where(cove, tint, M[fx]))
```

(`LAMP_GROUPS` is defined above `Setting` in the same file; `field` is already imported.) Add to `tools/relight/tests/test_reference.py`, in `class Rules`, after `test_lit_bulbs_are_boosted_and_unlit_bulbs_reflect`:

```python
    def test_a_lamp_tint_colours_lit_bulbs_and_the_cove(self):
        from dataclasses import replace
        m = model()
        d, n, f, p, c = splats()
        f[:] = codec.CLASS_CH_EMITTER
        c[:] = 0.95
        tints = {g: (1.0, 1.0, 1.0) for g in reference.LAMP_GROUPS}
        tints["ch_end"] = (1.2, 1.0, 0.6)
        lit, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), lamp_tints=tints))
        np.testing.assert_allclose(lit, np.tile([1.2, 1.0, 0.6], (4, 1)), atol=1e-9)
```

and change Step 4's expected count from `PASS, 7 tests.` to `PASS, 8 tests.` (A5 adds a ninth).

**R1a, Task 5, Step 7 (the vectors' `settings`).** Replace `\`emitterBoost\` is 1 for \`captured\` and \`sunny_morning\` and 4 for \`night\`; R1b compares it exactly.` with `\`emitterBoost\` is 1 for every setting; R1b compares it exactly. Every setting also carries \`moonDir\` and \`moonRgb\` (amendment A8).`

**R1b, Global Constraints, the multiplier bullet.** Replace `where β (\`emitterBoost\`) is 1 at the captured light, 4 for the night preset and 1 otherwise.` with `where β (\`emitterBoost\`) is 1 in every preset (R1d amendment A1: crisp bulbs replace the boost), and the lit bulbs and the cove are tinted by their group's lamp tint (\`RelightSetting.lampTints\`, ones unless R1d dims a lamp).` In the Presets bullet replace `night = lamps lit with emitter boost 4,` with `night = lamps lit (emitter boost 1),`.

**R1b, Task 4 (`relight-kernel.ts`).** In `export interface RelightSetting`, replace:

```ts
  /** β: lit bulbs brighten by Mlit = 1 + (β − 1) smoothstep(0.45, 0.9, L); 1 at the captured light. */
  readonly emitterBoost: number;
```

with:

```ts
  /** β: lit bulbs brighten by Mlit = 1 + (β − 1) smoothstep(0.45, 0.9, L); 1 in every preset (R1d amendment A1). */
  readonly emitterBoost: number;
  /** Each lamp group's tint (RGB, the dimmed lamp's colour relative to full power); absent means ones (A1). */
  readonly lampTints?: Readonly<Record<LampGroup, Rgb>>;
```

In `relightSplat`, replace:

```ts
      const lit = bulb ? litBulb : cove ? 1 : at(m, c);
```

with:

```ts
      const tint = channel(frame.setting.lampTints?.[group] ?? [1, 1, 1], c);
      const lit = bulb ? litBulb * tint : cove ? tint : at(m, c);
```

Add to `relight-kernel.test.ts`, inside its last `describe`, a test:

```ts
  it("tints lit bulbs and the cove by their group's lamp tint (amendment A1)", () => {
    const model = syntheticModel();
    const record = new Uint8Array(12);
    record[11] = CLASS_CH_EMITTER;
    const setting: RelightSetting = { ...capturedSetting(model), lampTints: { cove: [1, 1, 1], ch_end: [1.2, 1, 0.6], ch_centre: [1, 1, 1], dome: [1, 1, 1] } };
    const { m } = relightSplat(model, prepareKernelFrame(model, setting), record, [0.5, 0.5, 0.5], [0.95, 0.95, 0.95]);
    [1.2, 1, 0.6].forEach((value, c) => { expect(m[c]).toBeCloseTo(value, 9); });
  });
```

(`syntheticModel`, `CLASS_CH_EMITTER`, `capturedSetting`, `prepareKernelFrame`, `relightSplat` and `RelightSetting` are imported by that test file; add any that is not.) Raise that file's expected count by one.

**R1b, Task 10 (`relight-frame.ts`).** In `createRelightUniforms`, directly after `  const sunBounce = Array.from({ length: WINDOW_COUNT }, () => 0);` add `  const lampTints = [new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1)];`; replace `    values: { sourceWeights, windowOpen, sunBounce },` with `    values: { sourceWeights, windowOpen, sunBounce, lampTints },`; and directly after the line `    emitterBoost: uniform(1),` add:

```ts
    /** Each lamp group's tint (cove, ch_end, ch_centre, dome), written by apply (amendment A1). */
    lampTints: uniformArray<"vec3">(lampTints, "vec3"),
```

In `apply`, directly after `    u.emitterBoost.value = setting.emitterBoost;` add:

```ts
    (["cove", "ch_end", "ch_centre", "dome"] as const).forEach((group, index) => {
      const tint = setting.lampTints?.[group] ?? [1, 1, 1];
      u.values.lampTints[index]?.set(tint[0], tint[1], tint[2]);
    });
```

**R1b, Task 11 (`relight-draw.ts`).** Replace:

```ts
      const lit = select(bulb, vec3(float(1).add(u.emitterBoost.sub(1).mul(smoothstep(0.45, 0.9, luminance)))), select(cove, vec3(1), m));
```

with:

```ts
      const group = select(cls.equal(4), uint(3), select(cove, uint(0), select(centre, uint(2), uint(1))));
      const tint = u.lampTints.element(group);
      const lit = select(bulb, tint.mul(float(1).add(u.emitterBoost.sub(1).mul(smoothstep(0.45, 0.9, luminance)))), select(cove, tint, m));
```

**R1b, Task 8 (`light-setting.ts`).** Replace:

```ts
/** β, the lit bulbs' boost (R1a's emitter boost): 4 at night, 1 otherwise, so the captured light stays exactly neutral. */
export const PRESET_EMITTER_BOOST: Readonly<Record<LightPresetId, number>> = { captured: 1, night: 4, sunny: 1, overcast: 1 };
```

with:

```ts
/** β, the lit bulbs' boost (R1a's emitter boost): 1 in every preset (R1d amendment A1: crisp bulbs replace the boost). */
export const PRESET_EMITTER_BOOST: Readonly<Record<LightPresetId, number>> = { captured: 1, night: 1, moonlit: 1, sunny: 1, overcast: 1 };
```

(`moonlit` is amendment A7.) In `light-setting.test.ts`, replace:

```ts
  it("has no sky and no sun at night, the lamps lit and their bulbs boosted fourfold", () => {
    const { setting } = settingForChoice(inputs(), defaultChoice("night"));
    expect([setting.skyLevel, setting.sunDir, setting.lampLevels.dome, setting.emitterBoost]).toEqual([0, null, 1, 4]);
  });
```

with:

```ts
  it("has no sky and no sun at night, the lamps lit and their bulbs unboosted", () => {
    const { setting } = settingForChoice(inputs(), defaultChoice("night"));
    expect([setting.skyLevel, setting.sunDir, setting.lampLevels.dome, setting.emitterBoost]).toEqual([0, null, 1, 1]);
  });
```

**R1b, Task 10 (`relight-frame.test.ts`).** Replace `    expect([u.emitterBoost.value, u.sunOn.value]).toEqual([4, 0]);` with `    expect([u.emitterBoost.value, u.sunOn.value]).toEqual([1, 0]);`.

**R1b, Task 18's photo check.** Its thresholds stand. With β = 1 the night's bulb splats are drawn as captured; the correlation is measured over coarse cells, which the bulbs barely move. If the night check misses with β = 1, report the numbers: R1d's crisp bulbs and night calibration (R1d Tasks 11 and 21) finish the night, and the boost is not restored.

---

## A2. The floor's base light on the GPU

Why: R1d applies a light change every animation frame while the light moves (R1 polished §4.6). R1b's `apply` recomputes the floor's base light on the main thread (about 90,000 texels × nine sources, then 360,000 half-float conversions and a 720 kB upload): several milliseconds per change. The floor's base light becomes a compute pass in the frame's `prepare`, run after the probe fold and read bilinearly by the floor material, as the floor's sun already is. It reads the folded scenario volume for the bounce, so the sky bodies' bounce (A9) reaches the floor with no floor-specific bounce data: per source, the folded volume's +z face, trilinear over valid probes at the texel's centre, is exactly R1b's `floorBounce` (contract 4: the probes' +z face, trilinear at each texel centre), weighted by the setting.

**R1b, Task 10 (`relight-frame.ts`).** Replace the `three` import `import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, Matrix4, RGBAFormat, Vector2, Vector3, Vector4 } from "three";` with `import { Matrix4, Vector2, Vector3, Vector4 } from "three";`. In the `three/tsl` import add `clamp` and `min` if absent. Replace the import of `./floor-light.js` with:

```ts
import { FLOOR_SUN_TEXEL, floorSunScale, floorSunSize, modelToLightUvMatrix, roomLight, type FloorLightData } from "./floor-light.js";
```

and add `PROBE_CAPTURE_STRIDE` to the import from `./relight-assets.js`. Remove the function `prepared(texture: DataTexture): DataTexture` and add, directly after `createFloorSunPass`:

```ts
/**
 * The floor's base light on the GPU (amendment A2): per 5 cm texel, Σk s[k] D[k] plus the scenario bounce at the
 * texel's centre (the folded probe volume's +z face, trilinear over valid probes, weights renormalised: R1b's
 * floorBounce weighted by the setting, and the sky bodies' bounce with it); RGBA float32, alpha 1.
 */
function createFloorBasePass(
  direct: StorageBufferAttribute, capture: StorageBufferAttribute, scenario: StorageBufferAttribute, probeCount: number,
  out: StorageBufferAttribute, width: number, height: number, u: RelightUniforms,
): ComputeNode {
  const texels = width * height;
  const directRead = storage(direct, "float", texels * SOURCE_COUNT).toReadOnly();
  const captureRead = storage(capture, "float", probeCount * PROBE_CAPTURE_STRIDE).toReadOnly();
  const scenarioRead = storage(scenario, "float", probeCount * PROBE_FOLDED).toReadOnly();
  const write = storage(out, "vec4", texels);
  return Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uint(texels)), () => { Return(); });
    const p = u.texelToModel.mul(vec4(float(i.mod(width)), float(i.div(width)), 0, 1)).xyz;
    const q = clamp(p.sub(u.probeOrigin).div(u.probeSpacing), vec3(0), u.probeShape.sub(1 + 1e-6)).toVar();
    const cell = floor(q).toVar();
    const f = q.sub(cell).toVar();
    const bounce = vec3(0).toVar(), weightSum = float(0).toVar();
    for (const dx of [0, 1]) {
      for (const dy of [0, 1]) {
        for (const dz of [0, 1]) {
          const cx = min(cell.x.add(dx), u.probeShape.x.sub(1)), cy = min(cell.y.add(dy), u.probeShape.y.sub(1)), cz = min(cell.z.add(dz), u.probeShape.z.sub(1));
          const index = uint(cx.mul(u.probeShape.y).add(cy).mul(u.probeShape.z).add(cz)).toVar();
          const weight = (dx === 1 ? f.x : float(1).sub(f.x)).mul(dy === 1 ? f.y : float(1).sub(f.y)).mul(dz === 1 ? f.z : float(1).sub(f.z))
            .mul(captureRead.element(index.mul(PROBE_CAPTURE_STRIDE).add(PROBE_FOLDED))).toVar();
          const base = index.mul(PROBE_FOLDED).toVar();
          // the +z face (index 4) of each channel's six faces
          bounce.addAssign(vec3(scenarioRead.element(base.add(4)), scenarioRead.element(base.add(10)), scenarioRead.element(base.add(16))).mul(weight));
          weightSum.addAssign(weight);
        }
      }
    }
    const sum = bounce.mul(select(weightSum.greaterThan(0), float(1).div(max(weightSum, 1e-12)), float(0))).toVar();
    for (let k = 0; k < SOURCE_COUNT; k += 1) sum.addAssign(u.sourceWeights.element(k).mul(directRead.element(i.mul(SOURCE_COUNT).add(k))));
    write.element(i).assign(vec4(sum, 1));
  })().compute(texels, [WORKGROUP]).setName("RelightFloorBase");
}
```

In `class RelightFrame`, replace the field `  readonly floorLight: DataTexture;` with:

```ts
  /** The floor's base light per 5 cm texel, RGBA float32, row-major, written on the GPU (amendment A2). */
  readonly floorBase: StorageBufferAttribute;
```

and replace the field `  private readonly floorHalves: Uint16Array;` with:

```ts
  private readonly floorBasePass: ComputeNode;
  private readonly floorDirectBuffer: StorageBufferAttribute;
```

In the constructor replace:

```ts
    this.floorHalves = new Uint16Array(width * height * 4);
    this.floorLight = prepared(new DataTexture(this.floorHalves, width, height, RGBAFormat, HalfFloatType));
```

with:

```ts
    this.floorDirectBuffer = new StorageBufferAttribute(data.floorDirect, 1);
    this.floorBase = new StorageBufferAttribute(new Float32Array(width * height * 4), 4);
```

and directly after the line that creates `this.floorSunPass` add:

```ts
    this.floorBasePass = createFloorBasePass(this.floorDirectBuffer, this.probeCapture, this.probeScenario, data.probeCount, this.floorBase, width, height, this.uniforms);
```

In `apply`, replace:

```ts
    const rgba = floorBaseLight(this.floor, frame);
    for (let index = 0; index < rgba.length; index += 1) this.floorHalves[index] = DataUtils.toHalfFloat(rgba[index] ?? 0);
    this.floorLight.needsUpdate = true;
    const u = this.uniforms;
```

with:

```ts
    const u = this.uniforms;
```

In `prepare`, replace `    void renderer.compute([this.foldPass, this.floorSunPass]);` with `    void renderer.compute([...this.skyBouncePasses, this.foldPass, this.floorBasePass, this.floorSunPass, this.floorMoonPass, ...this.extraPasses]);` (`skyBouncePasses` is A9's: the sky bodies' power and coefficients, which the fold reads; `floorMoonPass` is A5's; `extraPasses` is the list R1c's `addPasses` fills. **Overlap** with R1c's A8/A9, which edits the same call: the merged call runs A9's passes, the fold, the floor's base light, its sun, its moon, then R1c's passes. Dispatches in one compute call are ordered and see each other's storage writes.) In `dispose`, replace `    this.floorLight.dispose();` with:

```ts
    this.floorBasePass.dispose();
    this.floorBase.dispose();
    this.floorDirectBuffer.dispose();
```

In Task 10's text, replace "rewrites the floor's base light texture (about 135,000 texels)" with "sets the uniforms the floor's base-light pass reads (amendment A2)", and in the class's doc comment "the floor's light and sun" with "the floor's base light, sun and moon (computed on the GPU)". `RelightModelData.floorBounce` (Task 5) stays: the CPU twin `texelBaseLight` reads it.

**R1b, Task 10 (`relight-frame.test.ts`).** Replace the whole test `it("writes the floor's base light as half floats, alpha 1", () => { … });` with:

```ts
  it("computes the floor's base light on the GPU in the frame's one compute call (amendment A2)", () => {
    const frame = new RelightFrame(data);
    expect(frame.floorBase.array).toHaveLength(frame.floor.width * frame.floor.height * 4);
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    frame.apply(application(frame, "captured"));
    frame.prepare(renderer);
    const passes = compute.mock.calls[0]?.[0];
    expect(Array.isArray(passes) ? passes.map((pass) => pass.name) : []).toEqual(expect.arrayContaining(["RelightProbeFold", "RelightFloorBase", "RelightFloorSun", "RelightFloorMoon"]));
  });
```

remove `DataUtils` from that file's `three` import and `texelBaseLight` from its `floor-light` import where no other test uses them, and in the test "keeps the probes and the window volumes on the GPU, …" replace `    expect(compute.mock.calls[0]?.[0]).toHaveLength(2); // the probe fold and the floor's sun` with `    expect(compute.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ name: "RelightProbeFold" }), expect.objectContaining({ name: "RelightFloorSun" })])); // A2, A5 and A9 add passes`. Tasks 11 and 12 count compute calls, not array lengths, and are unchanged.

**R1b, Task 14 (`floor-material.ts`).** Replace `import { Fn, float, floor, max, min, positionLocal, storage, texture as textureNode, uint, uv, vec4 } from "three/tsl";` with `import { Fn, float, floor, max, min, positionLocal, storage, texture as textureNode, uint, uv, vec3, vec4 } from "three/tsl";` and, directly after the `floorSunNode` function, add:

```ts
/** The floor's base light at light-map UV: the frame's 5 cm base-light buffer read bilinearly (amendment A2), texel centres at whole numbers. */
export function floorBaseNode(frame: RelightFrame, lightUv: Node<"vec2">): Node<"vec3"> {
  const width = frame.floor.width, height = frame.floor.height;
  const read = storage(frame.floorBase, "vec4", width * height).toReadOnly();
  const x = min(max(lightUv.x.mul(width).sub(0.5), float(0)), float(width - 1)).toVar();
  const y = min(max(lightUv.y.mul(height).sub(0.5), float(0)), float(height - 1)).toVar();
  const i = min(floor(x), float(width - 2)).toVar(), j = min(floor(y), float(height - 2)).toVar();
  const fx = x.sub(i), fy = y.sub(j);
  const at = (column: Node<"float">, row: Node<"float">): Node<"vec3"> => read.element(uint(row).mul(width).add(uint(column))).xyz;
  const v0 = at(i, j).mul(float(1).sub(fx)).add(at(i.add(1), j).mul(fx));
  const v1 = at(i, j.add(1)).mul(float(1).sub(fx)).add(at(i.add(1), j.add(1)).mul(fx));
  return vec3(v0.mul(float(1).sub(fy)).add(v1.mul(fy)));
}
```

and in `litFloorMaterial` replace `    const base = textureNode(frame.floorLight, lightUv).level(float(0)).rgb;` with `    const base = floorBaseNode(frame, lightUv);`. (`textureNode` stays imported for the albedo.) Task 14's text now says the base light comes "from the frame's 5 cm base-light buffer, read bilinearly per pixel (amendment A2)".

**R1b, Task 17 (`relight-debug.ts`).** Add to `RelightDebug` the method `floorBase(stride: number): Promise<FloorSunCheck>`, implemented beside `floorSun` (import `texelBaseLight` from `./floor-light.js`):

```ts
    floorBase: async (stride) => {
      const kernel = appliedFrame();
      frame.prepare(renderer);
      const values = new Float32Array(await renderer.getArrayBufferAsync(frame.floorBase));
      const step = Math.max(1, Math.floor(stride));
      let checked = 0, lit = 0, worst = 0;
      for (let row = 0; row < frame.floor.height; row += step) {
        for (let column = 0; column < frame.floor.width; column += step) {
          const texel = row * frame.floor.width + column;
          const expected = texelBaseLight(frame.floor, texel, kernel);
          expected.forEach((value, c) => {
            const relative = Math.abs((values[texel * 4 + c] ?? Number.NaN) - value) / Math.max(Math.abs(value), 1e-6);
            worst = Math.max(worst, Number.isFinite(relative) ? relative : Infinity);
          });
          if (expected[1] > 0) lit += 1;
          checked += 1;
        }
      }
      return { checked, lit, worstDifference: worst, excused: 0 };
    },
```

**R1b, Task 18.** The driver records `gpu[\`floorBase_${preset}\`] = await relit.page.evaluate(() => window.__relight.floorBase(4));` beside each `floorSun_*` line; `gpu_report` adds `base = {k: v for k, v in gpu.items() if k.startswith("floorBase_")}`, each requiring `v["checked"] > 0` and a numeric `v["worstDifference"] <= 2e-3` (relative: the GPU folds the float16 cubes in float32 while the CPU twin sums the decoded bounce in double, the same quantities in another order; 2e-3 is 0.003 stop), all required for `pass`.

---

## A3. The Moon's position, phase and light: the bake's ephemeris in the browser

Why (the owner's requirement of 3 October, and the coordinator's direction of 7 October: one lunar ephemeris, as there is one NOAA Sun): the Moon lights the hall through the same machinery as the Sun, and the bake and the browser must put it in the same place. The bake's Moon is R1a's `tools/relight/relight/moon.py` (Meeus ch. 47 in full, committed in `a2a25c56`; R1a Task 4's review checked it against JPL Horizons: median 2″, worst 15″ over 2020–2038). The browser ports it line for line; no second lunar series is used. **R1b, Task 6** gains a second file, `packages/web/src/lib/moon.ts`, and its test, `packages/web/src/lib/__tests__/moon.test.ts`, and `sun.ts` gains `sunEcliptic` (the Moon's phase needs the Sun's apparent longitude and distance, and takes them from the same NOAA expressions as `solarPosition`); Task 6's Files, Interfaces and commit name all three.

Added to Task 6's Produces: (`sun.ts`) `sunEcliptic(jd: number): { readonly longitude: number; readonly distanceAu: number }`; (`moon.ts`) `DELTA_T_SECONDS = 69`, `SUN_ILLUMINANCE_TOA = 127_500`, `EXTINCTION_V = 0.25`, `MOON_CCT = 4100`, `MOON_ANGULAR_RADIUS = 0.2589` (degrees, at the mean distance), `MEAN_MOON_DISTANCE_KM = 384_400`, `EARTH_RADIUS_KM = 6378.14`; `interface MoonPosition extends SolarPosition { readonly distanceKm: number; readonly phaseAngle: number; readonly illuminatedFraction: number; readonly illuminance: number }`; `julianDayOf(year, month, day, hour?): number` (Meeus 7.1, `moon.julian_day`); `julianDay(utc: Date): number`; `moonEcliptic(jde)`, `nutation(jde)`, `meanObliquity(jde)`, `moonEquatorial(jde)`, `siderealTime(jdUt, jde)`, `topocentric(hourAngle, declination, distanceKm, latitude, height?)`, `horizontal(hourAngle, declination, latitude): SolarPosition`, `refract(elevation)` (each `moon.py`'s function of the same name); `airmass(elevation)`, `atmosphericTransmission(elevation)`, `moonIlluminanceAboveAtmosphere(phaseAngle, distanceKm)` (lux), `sunIlluminance(elevation)` (lux, direct normal); `moonPhaseAngle(jdUt, jde)`; `moonAt(jdUt, latitude, longitude, height?): MoonPosition`; `moonPosition(utc: Date, latitude?, longitude?, heightMetres?): MoonPosition`.

The method, cited and tested. Position: `moon.py` exactly (J. Meeus, *Astronomical Algorithms*, 2nd ed., 1998: ch. 47, ELP-2000/82's main terms in Tables 47.A and 47.B with E and E² on the terms in M and 2M and the additive terms; ch. 22, the mean obliquity and the low-accuracy nutation; ch. 12, the apparent sidereal time; ch. 40, the topocentric parallax for the geodetic latitude and height; ch. 13, the horizontal coordinates; the proof's refraction, Saemundsson above −0.575°), with TD = UT + 69 s. Phase: Meeus 48.2–48.3 from the Moon's apparent longitude and latitude and the Sun's apparent longitude and distance by sun.ts's NOAA expressions. Brightness: Krisciunas & Schaefer's phase law (1991, *PASP* 103:1033), `V(i) = −12.73 + 0.026|i| + 4×10⁻⁹ i⁴`, a restrained opposition surge (+20% at full, nothing from 5°), `E = 2.54×10⁻⁶ × 10^(−0.4 V)` lux above the atmosphere scaled by (384,400 km / distance)², and the atmosphere's V-band transmission `10^(−0.4 × 0.25 × X)` with K&S's air mass `X = 1 / (cos z + 0.025 e^(−11 cos z))` (0.25 mag per air mass for a sea-level site). A full Moon high in the sky gives about 0.3 lux (the frontier light study's own estimate is 0.24 lux at 30°, its §b3). The same transmission gives the Sun's direct illuminance (127,500 lux above the atmosphere), used only to put the Moon's light in the Sun's units (A4). Moonlight is about 4,100 K: reddened sunlight (the Moon's B−V of 0.92 against the Sun's 0.65; the frontier study's Δ(B−V) = 0.27), warmer than the clear Sun's 4,900 K in R1b's weather.

Verified on 7 October with this amendment's code (a scratch run under Node 22; `moon.py` run with `C:/Python313/python.exe`). The TypeScript and `moon.py` agree to 7×10⁻¹⁴° in azimuth and elevation and exactly in distance at eight instants from 1992 to 2038. Against JPL Horizons (fetched 3 October 2026; observer 4.2491° W, 55.8593° N, 40 m; `APPARENT=REFRACTED`) it is within 3.4″ in azimuth and elevation and 0.0045 of illuminated fraction in the three cases below. Meeus' Example 47.a gives λ 133.162655°, β −3.229126°, Δ 368,409.68 km (Meeus: 133.162655°, −3.229126°, 368,409.7 km). The moonlit preset (A7: 26 September 2026, 23:00 BST) stands at azimuth 139.280°, 32.298° up, 99.87% lit, 0.197 lux after the atmosphere.

Add to `packages/web/src/lib/sun.ts`, directly after `solarPosition`:

```ts
/**
 * The Sun's apparent ecliptic longitude (degrees) and distance (au) at a UT Julian day: solarPosition's NOAA
 * expressions (Meeus ch. 25, low accuracy), for the Moon's phase (amendment A3), so the hall has one Sun.
 */
export function sunEcliptic(jd: number): { readonly longitude: number; readonly distanceAu: number } {
  const t = (jd - 2451545) / 36525;
  const l0 = floorMod(280.46646 + t * (36000.76983 + 0.0003032 * t), 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const centre = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  return {
    longitude: l0 + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD),
    distanceAu: 1.000001018 * (1 - e * e) / (1 + e * Math.cos((m + centre) * RAD)),
  };
}
```

Add `packages/web/src/lib/__tests__/moon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EARTH_RADIUS_KM, EXTINCTION_V, MEAN_MOON_DISTANCE_KM, SUN_ILLUMINANCE_TOA, airmass, atmosphericTransmission, horizontal,
  julianDay, julianDayOf, moonAt, moonEcliptic, moonEquatorial, moonIlluminanceAboveAtmosphere, moonPosition, nutation,
  sunIlluminance, topocentric,
} from "../moon.js";
import { sunEcliptic } from "../sun.js";

const LAT = 55.8593, LON = -4.2491;
const RAD = Math.PI / 180;

describe("the Moon: the bake's ephemeris in the browser (T-639 R1d, amendment A3)", () => {
  it("follows Meeus' Example 47.a as moon.py does", () => {
    const ecl = moonEcliptic(2448724.5);
    expect(Math.abs(ecl.longitude - 133.162655)).toBeLessThan(1e-3);
    expect(Math.abs(ecl.latitude - -3.229126)).toBeLessThan(1e-3);
    expect(Math.abs(ecl.distanceKm - 368409.7)).toBeLessThan(1);
    const eq = moonEquatorial(2448724.5);
    expect(Math.abs(eq.rightAscension - 134.68847)).toBeLessThan(2e-3);
    expect(Math.abs(eq.declination - 13.768368)).toBeLessThan(2e-3);
  });

  it("shares the Sun's apparent longitude at the New Moon of Meeus' Example 49.a", () => {
    const jde = 2443192.65118;
    const moon = moonEcliptic(jde).longitude + nutation(jde).longitude;
    const sun = sunEcliptic(jde).longitude;
    expect(Math.abs(((moon - sun + 540) % 360) - 180)).toBeLessThan(0.02);
  });

  it("is the bake's moon.position to 1e-9 degree (values from tools/relight/relight/moon.py, 7 October)", () => {
    const cases = [
      [[2026, 9, 26, 22.0], 139.28020046851069, 32.298323682312045, 378601.60555655725],
      [[2026, 9, 29, 21.0], 81.56680696380859, 20.23323375904274, 370721.83270839177],
      [[2026, 10, 7, 9.0], 168.43367124702203, 42.82974843303166, 376856.52414093807],
      [[2026, 5, 31, 8.0], 276.38844117931257, -37.910565272075566, 406116.74858331046],
      [[1992, 4, 12, 0.0], 253.67372083477267, 26.343882345001727, 368408.8862664462],
      [[2038, 1, 1, 0.0], 65.92885830110549, -29.048259510262742, 371463.99292880396],
      [[2020, 3, 1, 18.25], 197.47489716683805, 49.660534987609985, 397288.15158432897],
      [[2031, 6, 15, 2.5], 81.70200428718243, 10.227784387306198, 393341.7226146615],
    ] as const;
    for (const [[year, month, day, hour], azimuth, elevation, distance] of cases) {
      const moon = moonAt(julianDayOf(year, month, day, hour), LAT, LON, 0);
      expect(Math.abs(moon.azimuth - azimuth)).toBeLessThan(1e-9);
      expect(Math.abs(moon.elevation - elevation)).toBeLessThan(1e-9);
      expect(Math.abs(moon.distanceKm - distance)).toBeLessThan(1e-6);
    }
  });

  it("stands where JPL Horizons puts it over Glasgow, within 5 arcseconds, and is lit as much", () => {
    // JPL Horizons, fetched 3 October 2026: apparent (refracted) azimuth, elevation and illuminated fraction, 40 m up.
    const cases = [
      ["2026-10-07T04:30:00Z", 97.214955, 17.267730, 0.1304312],
      ["2026-10-23T21:00:00Z", 159.740657, 34.511522, 0.9329895],
      ["2026-10-24T22:30:00Z", 171.890774, 42.633657, 0.9787391],
    ] as const;
    for (const [iso, azimuth, elevation, fraction] of cases) {
      const moon = moonPosition(new Date(iso), LAT, LON, 40);
      expect(Math.abs(moon.azimuth - azimuth) * 3600).toBeLessThan(5);
      expect(Math.abs(moon.elevation - elevation) * 3600).toBeLessThan(5);
      expect(Math.abs(moon.illuminatedFraction - fraction)).toBeLessThan(0.006);
    }
    expect(moonPosition(new Date("2026-11-06T00:00:00Z"), LAT, LON).elevation).toBeLessThan(-30);
  });

  it("lowers the Moon by its parallax and reads compass azimuths (moon.py's tests)", () => {
    const sinPi = EARTH_RADIUS_KM / 360000;
    for (let hourAngle = -150; hourAngle <= 150; hourAngle += 5) {
      const geocentric = horizontal(hourAngle, 10, LAT).elevation;
      const seen = topocentric(hourAngle, 10, 360000, LAT);
      const topo = horizontal(seen.hourAngle, seen.declination, LAT).elevation;
      expect(Math.abs(geocentric - topo - Math.asin(0.9977 * sinPi * Math.cos(topo * RAD)) / RAD)).toBeLessThan(4e-3);
    }
    expect([horizontal(0, 0, LAT).azimuth, horizontal(90, 0, LAT).azimuth, horizontal(-90, 0, LAT).azimuth]).toEqual([180, 270, 90]);
    expect(horizontal(0, 0, LAT).elevation).toBeCloseTo(90 - LAT, 9);
  });

  it("counts Julian days as Meeus 7.1, and from an instant", () => {
    expect([julianDayOf(1992, 4, 12), julianDayOf(2000, 1, 1, 12)]).toEqual([2448724.5, 2451545]);
    expect(julianDay(new Date("2000-01-01T12:00:00Z"))).toBe(2451545);
  });

  it("is about 0.3 lux at full Moon overhead, with the opposition surge, and dark below the horizon", () => {
    expect(moonIlluminanceAboveAtmosphere(0, MEAN_MOON_DISTANCE_KM)).toBeCloseTo(0.3767167777, 8);
    expect(moonIlluminanceAboveAtmosphere(0, MEAN_MOON_DISTANCE_KM) * atmosphericTransmission(90)).toBeCloseTo(0.2992368018, 8);
    expect(moonIlluminanceAboveAtmosphere(90, MEAN_MOON_DISTANCE_KM)).toBeCloseTo(0.02856654494, 9);
    // the surge: +20% at full, +8% at 3°, none from 5°
    expect(moonIlluminanceAboveAtmosphere(3, MEAN_MOON_DISTANCE_KM) / moonIlluminanceAboveAtmosphere(5, MEAN_MOON_DISTANCE_KM))
      .toBeCloseTo(1.08 * 10 ** (-0.4 * (0.026 * 3 + 4e-9 * 81 - 0.026 * 5 - 4e-9 * 625)), 9);
    expect(moonPosition(new Date("2026-11-06T00:00:00Z"), LAT, LON).illuminance).toBe(0);
    const moonlit = moonPosition(new Date("2026-09-26T22:00:00Z"), LAT, LON);
    expect(moonlit.illuminatedFraction).toBeGreaterThan(0.998);
    expect(moonlit.illuminance).toBeCloseTo(0.197, 2);
  });

  it("takes the Sun's direct light through the same atmosphere", () => {
    expect(airmass(90)).toBeCloseTo(1 / (1 + 0.025 * Math.exp(-11)), 12);
    expect(airmass(30)).toBeCloseTo(1.999591406, 8);
    expect(atmosphericTransmission(90)).toBeCloseTo(10 ** (-0.4 * EXTINCTION_V * airmass(90)), 12);
    expect(sunIlluminance(32.714)).toBeCloseTo(83272.23323, 2);
    expect(sunIlluminance(-1)).toBe(0);
    expect(SUN_ILLUMINANCE_TOA).toBe(127500);
    expect(sunEcliptic(2451545).distanceAu).toBeCloseTo(0.98331, 4);
  });
});
```

Add `packages/web/src/lib/moon.ts`:

```ts
import { sunEcliptic, type SolarPosition } from "./sun.js";

/**
 * The Moon for the relit hall (T-639 R1d, amendment A3): the bake's own ephemeris, R1a's tools/relight/relight/moon.py,
 * ported line for line, so the browser's Moon is the bake's (as sun.ts is the proof's NOAA Sun). J. Meeus,
 * Astronomical Algorithms, 2nd ed. (1998): ch. 47 (ELP-2000/82's main terms, Tables 47.A and 47.B), ch. 22 (mean
 * obliquity, low-accuracy nutation), ch. 12 (apparent sidereal time), ch. 40 (topocentric parallax), ch. 13
 * (horizontal coordinates); refraction as the proof's Sun (Saemundsson). Its phase angle (Meeus 48.2–48.3) takes the
 * Sun from sun.ts; its light, Krisciunas & Schaefer (1991) with a restrained opposition surge, through 0.25 mag of
 * V-band extinction per air mass.
 */
export const DELTA_T_SECONDS = 69;
export const SUN_ILLUMINANCE_TOA = 127_500;
export const EXTINCTION_V = 0.25;
export const MOON_CCT = 4100;
export const MOON_ANGULAR_RADIUS = 0.2589;
export const MEAN_MOON_DISTANCE_KM = 384_400;
export const EARTH_RADIUS_KM = 6378.14;
const FLATTENING_RATIO = 0.99664719;
const AU_KM = 149_597_870.7;
const RAD = Math.PI / 180;
const OPPOSITION_SURGE = 0.2;
const OPPOSITION_WIDTH = 5;
const wrap360 = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** Table 47.A: multiples of D, M, M′, F; longitude (1e-6 degree, sine); distance (1e-3 km, cosine). */
const TABLE_LR: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
/** Table 47.B: multiples of D, M, M′, F; latitude (1e-6 degree, sine). */
const TABLE_B: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833], [0, 0, 1, -3, 777], [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607], [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421], [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351], [4, 0, 0, 1, 331], [2, -1, 1, 1, 315], [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283], [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185], [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177], [4, 0, -2, -1, 176], [4, -1, -1, -1, 166], [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132], [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

export interface MoonPosition extends SolarPosition {
  /** Geocentric distance, km (as the bake's moon.position). */
  readonly distanceKm: number;
  /** Sun–Moon–Earth angle, degrees: 0 at full, 180 at new (Meeus 48.3). */
  readonly phaseAngle: number;
  readonly illuminatedFraction: number;
  /** Lux on a surface facing the Moon, after the atmosphere; 0 at or below the horizon. */
  readonly illuminance: number;
}

/** Meeus 7.1, Gregorian calendar: moon.julian_day. */
export function julianDayOf(year: number, month: number, day: number, hour = 0): number {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  return Math.trunc(365.25 * (y + 4716)) + Math.trunc(30.6001 * (m + 1)) + day + hour / 24 + 2 - a + Math.floor(a / 4) - 1524.5;
}

/** The UT Julian day of an instant. */
export function julianDay(utc: Date): number {
  return utc.getTime() / 86_400_000 + 2_440_587.5;
}

const centuries = (jd: number): number => (jd - 2_451_545) / 36_525;

/** moon.ecliptic: geocentric ecliptic longitude and latitude (degrees, mean equinox of date) and distance (km). */
export function moonEcliptic(jde: number): { readonly longitude: number; readonly latitude: number; readonly distanceKm: number } {
  const T = centuries(jde);
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2 + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2 + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2 + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2 + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T ** 2 - T ** 3 / 3526000 + T ** 4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T ** 2;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  const s = (degrees: number): number => Math.sin(degrees * RAD);
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of TABLE_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * RAD, e = E ** Math.abs(m);
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of TABLE_B) sb += cb * E ** Math.abs(m) * Math.sin((d * D + m * M + mp * Mp + f * F) * RAD);
  sl += 3958 * s(A1) + 1962 * s(Lp - F) + 318 * s(A2);
  sb += -2235 * s(Lp) + 382 * s(A3) + 175 * s(A1 - F) + 175 * s(A1 + F) + 127 * s(Lp - Mp) - 115 * s(Lp + Mp);
  return { longitude: wrap360(Lp + sl / 1e6), latitude: sb / 1e6, distanceKm: 385000.56 + sr / 1000 };
}

/** moon.nutation: nutation in longitude and obliquity (degrees), Meeus 22's low-accuracy terms. */
export function nutation(jde: number): { readonly longitude: number; readonly obliquity: number } {
  const T = centuries(jde);
  const om = (125.04452 - 1934.136261 * T) * RAD, L = (280.4665 + 36000.7698 * T) * RAD, Lm = (218.3165 + 481267.8813 * T) * RAD;
  const dpsi = -17.2 * Math.sin(om) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * om);
  const deps = 9.2 * Math.cos(om) + 0.57 * Math.cos(2 * L) + 0.1 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * om);
  return { longitude: dpsi / 3600, obliquity: deps / 3600 };
}

/** moon.mean_obliquity: Meeus 22.2, degrees. */
export function meanObliquity(jde: number): number {
  const T = centuries(jde);
  return 23.4392911 - 0.0130042 * T - 1.64e-7 * T ** 2 + 5.04e-7 * T ** 3;
}

/** moon.equatorial: apparent geocentric right ascension and declination (degrees) and distance (km). */
export function moonEquatorial(jde: number): { readonly rightAscension: number; readonly declination: number; readonly distanceKm: number } {
  const ecl = moonEcliptic(jde), nut = nutation(jde);
  const eps = (meanObliquity(jde) + nut.obliquity) * RAD;
  const lam = (ecl.longitude + nut.longitude) * RAD, beta = ecl.latitude * RAD;
  const rightAscension = wrap360(Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lam)) / RAD);
  const declination = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam)) / RAD;
  return { rightAscension, declination, distanceKm: ecl.distanceKm };
}

/** moon.sidereal_time: apparent sidereal time at Greenwich (degrees), Meeus 12.4 with the equation of the equinoxes. */
export function siderealTime(jdUt: number, jde: number): number {
  const days = jdUt - 2_451_545, T = days / 36_525;
  const theta = 280.46061837 + 360.98564736629 * days + 0.000387933 * T ** 2 - T ** 3 / 38710000;
  const nut = nutation(jde);
  return wrap360(theta + nut.longitude * Math.cos((meanObliquity(jde) + nut.obliquity) * RAD));
}

/** moon.topocentric: Meeus 40.2–40.3, the hour angle and declination (degrees) from geodetic latitude and height (m). */
export function topocentric(
  hourAngle: number, declination: number, distanceKm: number, latitude: number, height = 0,
): { readonly hourAngle: number; readonly declination: number } {
  const phi = latitude * RAD;
  const u = Math.atan(FLATTENING_RATIO * Math.tan(phi));
  const rhoSin = FLATTENING_RATIO * Math.sin(u) + height / 6_378_140 * Math.sin(phi);
  const rhoCos = Math.cos(u) + height / 6_378_140 * Math.cos(phi);
  const sinPi = EARTH_RADIUS_KM / distanceKm;
  const h = hourAngle * RAD, d = declination * RAD;
  const dra = Math.atan2(-rhoCos * sinPi * Math.sin(h), Math.cos(d) - rhoCos * sinPi * Math.cos(h));
  const dt = Math.atan2((Math.sin(d) - rhoSin * sinPi) * Math.cos(dra), Math.cos(d) - rhoCos * sinPi * Math.cos(h));
  return { hourAngle: (h - dra) / RAD, declination: dt / RAD };
}

/** moon.horizontal: Meeus 13.5–13.6, compass azimuth (from north, eastward) and elevation (degrees). */
export function horizontal(hourAngle: number, declination: number, latitude: number): SolarPosition {
  const h = hourAngle * RAD, d = declination * RAD, phi = latitude * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h)) / RAD;
  const azimuth = wrap360(Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) / RAD + 180);
  return { azimuth, elevation };
}

/** moon.refract: the proof's refraction (Saemundsson), added above −0.575°. */
export function refract(elevation: number): number {
  return elevation > -0.575 ? elevation + 1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * RAD) / 60 : elevation;
}

/** Krisciunas & Schaefer's air mass at an elevation (degrees). */
export function airmass(elevation: number): number {
  const cosZ = Math.cos((90 - elevation) * RAD);
  return 1 / (cosZ + 0.025 * Math.exp(-11 * cosZ));
}

/** The V-band transmission of the atmosphere toward an elevation (degrees); 0 at or below the horizon. */
export function atmosphericTransmission(elevation: number): number {
  return elevation <= 0 ? 0 : 10 ** (-0.4 * EXTINCTION_V * airmass(elevation));
}

/** The Moon's illuminance above the atmosphere (lux) at a phase angle (degrees) and distance (km). */
export function moonIlluminanceAboveAtmosphere(phaseAngle: number, distanceKm: number): number {
  const i = Math.abs(phaseAngle);
  const magnitude = -12.73 + 0.026 * i + 4e-9 * i ** 4;
  const surge = 1 + OPPOSITION_SURGE * Math.max(0, 1 - i / OPPOSITION_WIDTH);
  return 2.54e-6 * 10 ** (-0.4 * magnitude) * surge * (MEAN_MOON_DISTANCE_KM / distanceKm) ** 2;
}

/** The Sun's direct normal illuminance at an elevation (lux), through the same atmosphere. */
export function sunIlluminance(elevation: number): number {
  return SUN_ILLUMINANCE_TOA * atmosphericTransmission(elevation);
}

/** The phase angle (degrees, Meeus 48.2–48.3) from the Moon's apparent geocentric place and sun.ts's Sun. */
export function moonPhaseAngle(jdUt: number, jde: number): number {
  const ecl = moonEcliptic(jde), nut = nutation(jde), sun = sunEcliptic(jdUt);
  const lam = (ecl.longitude + nut.longitude) * RAD, beta = ecl.latitude * RAD;
  const elongation = Math.acos(Math.min(1, Math.max(-1, Math.cos(beta) * Math.cos(lam - sun.longitude * RAD))));
  const sunKm = sun.distanceAu * AU_KM;
  return Math.atan2(sunKm * Math.sin(elongation), ecl.distanceKm - sunKm * Math.cos(elongation)) / RAD;
}

/** moon.position at a UT Julian day, with the phase and the light: azimuth and refracted elevation from the site. */
export function moonAt(jdUt: number, latitude: number, longitude: number, height = 0): MoonPosition {
  const jde = jdUt + DELTA_T_SECONDS / 86_400;
  const eq = moonEquatorial(jde);
  const topo = topocentric(siderealTime(jdUt, jde) + longitude - eq.rightAscension, eq.declination, eq.distanceKm, latitude, height);
  const seen = horizontal(topo.hourAngle, topo.declination, latitude);
  const elevation = refract(seen.elevation);
  const phaseAngle = moonPhaseAngle(jdUt, jde);
  const illuminance = elevation <= 0 ? 0 : moonIlluminanceAboveAtmosphere(phaseAngle, eq.distanceKm) * atmosphericTransmission(elevation);
  return {
    azimuth: seen.azimuth, elevation, distanceKm: eq.distanceKm, phaseAngle,
    illuminatedFraction: (1 + Math.cos(phaseAngle * RAD)) / 2, illuminance,
  };
}

export function moonPosition(utc: Date, latitude = 55.8593, longitude = -4.2491, heightMetres = 0): MoonPosition {
  return moonAt(julianDay(utc), latitude, longitude, heightMetres);
}
```

Task 6's Step 4 gains: Run `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/moon.test.ts` — Expected: PASS, 8 tests.

---

## A4. Two sky bodies in the light setting

**R1b, Task 4 (`relight-kernel.ts`).** In `export interface RelightSetting`, directly after `  readonly sunRgb: Rgb;` add:

```ts
  /** Toward the Moon in the model frame; null when the setting has no moonlight (amendment A4). */
  readonly moonDir: Vec3 | null;
  readonly moonRgb: Rgb;
```

In `capturedSetting`, replace the two lines `    sunDir: null,\n    sunRgb: [0, 0, 0],` with `    sunDir: null,\n    sunRgb: [0, 0, 0],\n    moonDir: null,\n    moonRgb: [0, 0, 0],`. The test literals that spread `capturedSetting(…)` keep compiling.

**R1b, Task 4 (`relight-vectors.ts`).** In `settingFromVectors`, replace `    emitterBoost: value.emitterBoost, sunDir: value.sunDir, sunRgb: value.sunRgb,` with `    emitterBoost: value.emitterBoost, sunDir: value.sunDir, sunRgb: value.sunRgb, moonDir: value.moonDir, moonRgb: value.moonRgb,` (the schema's fields are A8's).

**R1b, Task 8 (`light-setting.ts`).** Replace `import { solarPosition, sunDirection, type SiteFrame, type SolarPosition } from "./sun.js";` with:

```ts
import { solarPosition, sunDirection, type SiteFrame, type SolarPosition } from "./sun.js";
import { MOON_CCT, moonPosition, sunIlluminance, type MoonPosition } from "./moon.js";
```

Replace `type WeatherPreset = Exclude<LightPresetId, "captured">;` with `export type WeatherPreset = Exclude<LightPresetId, "captured">;`. In `interface LightInputs`, directly after `  readonly meanWindowWeight: number;` add:

```ts
  /** Light units per lux: the clear weather's Sun at its reference hour over its direct illuminance there (A4). */
  readonly unitsPerLux: number;
```

In `lightInputsFromParts`, directly after `  const clear = weatherFrom(parts.presets.sunny_morning, "sunny", parts.site);` add:

```ts
  const meanWindow = windowWeights.reduce((sum, value) => sum + value, 0) / WINDOW_COUNT;
  const sunAtReference = clear.sunRatio * clear.referenceSky * meanWindow;
  const unitsPerLux = sunAtReference > 0 ? sunAtReference / Math.max(sunIlluminance(clear.referenceElevation), 1e-9) : 0;
```

and in its returned object replace `    meanWindowWeight: windowWeights.reduce((sum, value) => sum + value, 0) / WINDOW_COUNT,` with `    meanWindowWeight: meanWindow,\n    unitsPerLux,`. Replace `interface ChoiceLight`'s body with:

```ts
export interface ChoiceLight {
  readonly setting: RelightSetting;
  readonly sun: SolarPosition | null;
  /** The Moon at the choice's instant (A4); null for the captured light. */
  readonly moon: MoonPosition | null;
}
```

Replace the whole function `settingForChoice` with:

```ts
export function settingForChoice(inputs: LightInputs, choice: LightChoice): ChoiceLight {
  if (choice.preset === "captured") {
    return { setting: capturedSetting(inputs), sun: null, moon: null };
  }
  const instant = londonLocalToUtc(choice.date, choice.minutes);
  return settingForSky(inputs, choice.preset, solarPosition(instant, inputs.site.latitude, inputs.site.longitude),
    moonPosition(instant, inputs.site.latitude, inputs.site.longitude));
}

/**
 * A weather preset's setting for given Sun and Moon positions (A4; R1d gives positions between whole minutes and days):
 * the sky by the Sun's height, the Sun and, in clear weather, the Moon, each in the Sun's light units, every lamp group
 * at the preset's level.
 */
export function settingForSky(inputs: LightInputs, preset: WeatherPreset, sun: SolarPosition, moon: MoonPosition): ChoiceLight {
  const { weather, house, lampLevel } = inputs.presets[preset];
  const reference = skyFactor(weather.referenceElevation);
  // The ratio first: exactly 1 at the weather's own hour, so the proof's sky level is reproduced exactly.
  const skyLevel = reference > 0 ? weather.referenceSky * (skyFactor(sun.elevation) / reference) : 0;
  const skyShift = cctShift(weather.skyCct), sunShift = cctShift(weather.sunCct), moonShift = cctShift(MOON_CCT);
  const daylight = inputs.daylightColour;
  const skyColour: Rgb = [daylight[0] * skyShift[0], daylight[1] * skyShift[1], daylight[2] * skyShift[2]];
  const sunUp = weather.sunRatio > 0 && sun.elevation > 0;
  const sunStrength = sunUp ? weather.sunRatio * skyLevel * inputs.meanWindowWeight : 0;
  const sunRgb: Rgb = [sunStrength * (daylight[0] * sunShift[0]), sunStrength * (daylight[1] * sunShift[1]), sunStrength * (daylight[2] * sunShift[2])];
  // Moonlight is direct only in clear weather, like sunlight; its strength is its illuminance in the Sun's units.
  const moonUp = weather.sunRatio > 0 && moon.elevation > 0 && moon.illuminance > 0;
  const moonStrength = moonUp ? moon.illuminance * inputs.unitsPerLux : 0;
  const moonRgb: Rgb = [moonStrength * (daylight[0] * moonShift[0]), moonStrength * (daylight[1] * moonShift[1]), moonStrength * (daylight[2] * moonShift[2])];
  const weights = inputs.captureWeights.map((captured, k): Rgb => {
    if (k >= WINDOW_COUNT) return [house * captured[0], house * captured[1], house * captured[2]];
    const weight = inputs.windowWeights[k] ?? 0;
    return [weight * skyLevel * skyColour[0], weight * skyLevel * skyColour[1], weight * skyLevel * skyColour[2]];
  });
  return {
    setting: {
      weights, skyLevel, skyColour, sunRgb, moonRgb,
      lampLevels: { cove: lampLevel, ch_end: lampLevel, ch_centre: lampLevel, dome: lampLevel },
      emitterBoost: PRESET_EMITTER_BOOST[preset],
      sunDir: sunUp ? sunDirection(sun, inputs.site) : null,
      moonDir: moonUp ? sunDirection(moon, inputs.site) : null,
    },
    sun,
    moon,
  };
}
```

In `light-setting.test.ts`, in "uses the captured light itself, …", replace `    expect([light.setting.emitterBoost, light.sun]).toEqual([1, null]);` with `    expect([light.setting.emitterBoost, light.sun, light.moon, light.setting.moonDir]).toEqual([1, null, null, null]);`, and add after the overcast test:

```ts
  it("lights the moonlit night by the full Moon of 26 September in the Sun's units, and never in overcast weather (A4)", () => {
    const { setting, moon } = settingForChoice(inputs(), defaultChoice("moonlit"));
    expect(moon?.illuminatedFraction).toBeGreaterThan(0.99);
    expect(moon?.elevation).toBeGreaterThan(25);
    expect(setting.sunDir).toBeNull();
    expect(setting.moonDir).not.toBeNull();
    const luminance = (rgb: readonly number[]): number => 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    const sunny = settingForChoice(inputs(), defaultChoice("sunny")).setting;
    // about 0.3 lux against about 83,000 lux: some 3e-6 of the morning's Sun
    expect(luminance(setting.moonRgb) / luminance(sunny.sunRgb)).toBeGreaterThan(1e-6);
    expect(luminance(setting.moonRgb) / luminance(sunny.sunRgb)).toBeLessThan(1e-5);
    expect(setting.moonRgb[0]).toBeGreaterThan(setting.moonRgb[2]);   // moonlight is warmer than the Sun's 4,900 K
    const overcast = settingForChoice(inputs(), { ...defaultChoice("overcast"), date: "2026-09-26", minutes: 1380 }).setting;
    expect([overcast.moonDir, overcast.moonRgb]).toEqual([null, [0, 0, 0]]);
  });
```

and raise that file's expected count by one.

**R1b, Task 10 (`relight-apply.ts`).** Replace the file's body with:

```ts
import { MOONLIT_DISPLAY_KEY, PRESET_DEFAULTS, PRESET_DISPLAY, adaptDisplay, settingForChoice, type ChoiceLight, type LightChoice, type LightInputs, type LightPresetId } from "../light-setting.js";
import type { DisplayParams } from "./display.js";
import type { RelightApplication } from "./relight-frame.js";
import { LUMINANCE, type Rgb } from "./relight-kernel.js";

/** The moonlit night has no calibrated photograph: at its own hour it shows the floor's mean light at MOONLIT_DISPLAY_KEY (A7). */
function displayAtOwnHour(preset: LightPresetId, display: DisplayParams, light: ChoiceLight, meanLight: (light: ChoiceLight) => Rgb): DisplayParams {
  if (preset !== "moonlit") return display;
  const mean = meanLight(light);
  const luminance = mean[0] * LUMINANCE[0] + mean[1] * LUMINANCE[1] + mean[2] * LUMINANCE[2];
  return luminance > 0 ? { exposure: MOONLIT_DISPLAY_KEY / luminance, whiteBalance: display.whiteBalance } : display;
}

/**
 * A light choice resolved for the frame (decision 4): the setting for its date and hour, and the preset's display —
 * exactly the preset's at its own hour (neutral for the captured light; the moonlit night's from its key), otherwise
 * adapted to the floor's light.
 */
export function applicationForChoice(inputs: LightInputs, choice: LightChoice, meanLight: (light: ChoiceLight) => Rgb): RelightApplication {
  const light = settingForChoice(inputs, choice);
  const own = PRESET_DEFAULTS[choice.preset];
  if (choice.preset === "captured") return { setting: light.setting, sun: light.sun, display: PRESET_DISPLAY.captured };
  const reference = choice.date === own.date && choice.minutes === own.minutes ? light : settingForChoice(inputs, { ...choice, date: own.date, minutes: own.minutes });
  const display = displayAtOwnHour(choice.preset, PRESET_DISPLAY[choice.preset], reference, meanLight);
  if (reference === light) return { setting: light.setting, sun: light.sun, display };
  return { setting: light.setting, sun: light.sun, display: adaptDisplay(display, meanLight(reference), meanLight(light)) };
}
```

(The existing three tests still hold: the captured light and a preset at its own hour call `meanLight` zero times; another hour calls it twice.)

---

## A5. Two sky bodies in the multiplier: the Moon's direct light

The Moon's direct light goes through the Sun's machinery: the same window march, its own horizon gates and glass, its own floor grid. Its bounce goes through the sky-body basis (A9), never through the sunlit-area model R1a Task 4 replaced.

**R1a, section "The multiplier (normative)", the scenario light bullet.** Replace `plus, when the sun is up, \`sunRGB × V(p) × cosθ + Σw b[w] × sunRGB ⊙ I[w]\`.` with `plus, for each sky body that is up (the Sun, and the Moon; amended 3 October for R1d), \`bodyRGB × V_body(p) × cosθ_body\` and the body's bounce through the sky-body basis (R1a Task 4 as committed: \`sunbounce.sun_bounce\`); every rule below written for the Sun's direct light (the march, the gates, the glass, \`cosθ\`) applies to the Moon with the Moon's direction.`

**R1a, Task 5, Step 3 (`reference.py`).** Where the controller's bounce revision computes the Sun's direct term (the block that marches `sun_visibility` for `reach` splats and adds `(vis * cosv)[:, None] * setting.sun_rgb[None]`), wrap that direct term in `for body_dir, body_rgb in ((setting.sun_dir, setting.sun_rgb), (setting.moon_dir, setting.moon_rgb)):` (skipping a body whose direction is `None`), and add the body's bounce with `body_rgb` as A9 requires. Add to `test_reference.py`, in `class Rules`:

```python
    def test_the_moon_lights_like_the_sun_through_the_same_window(self):
        from dataclasses import replace
        d, n, f, p, c = splats(1)
        n[:] = [0.0, -1.0, 0.0]; f[:] = codec.FLAG_SUN; p[:] = [1.5, 1.0, 1.5]
        m = replace(model(), volumes={"W1": window_volume()}, horizons={"W1": np.zeros(360, np.float32)})
        by_sun, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3)))
        by_moon, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), moon_dir=OUT_OF_THE_WALL, moon_rgb=np.ones(3)))
        both, _ = reference.multiplier(d, n, f, p, c, m, replace(reference.Setting.captured(m), sun_dir=OUT_OF_THE_WALL, sun_rgb=np.ones(3),
                                                                    moon_dir=OUT_OF_THE_WALL, moon_rgb=np.ones(3)))
        np.testing.assert_allclose(by_moon, by_sun, atol=1e-12)
        self.assertTrue(np.all(both > by_sun))
```

(The synthetic model carries no bounce basis, so each body's term there is its direct light alone.)

**R1b, Task 4 (`relight-kernel.ts`).** In `export interface KernelFrame`, directly after `  readonly rBack: Rgb;` add:

```ts
  /** The Moon's counterparts of windowSun, windowOpen, sunOn and fresnelAtSun (A5). */
  readonly moonSun: WindowSun | null;
  readonly moonOpen: readonly number[];
  readonly moonOn: boolean;
  readonly fresnelAtMoon: number;
```

In `prepareKernelFrame`, directly after `  const fresnelAtSun = windowSun?.fresnel ?? 0;` add:

```ts
  // The Moon through the same windows, gates and glass (A5).
  const moonSun = model.windows.length > 0 ? prepareWindowSun(model.windows, model.fresnel, setting.moonDir) : null;
  const moonOn = moonSun !== null;
  const moonOpen = moonSun?.gates ?? model.windows.map(() => 1);
  const fresnelAtMoon = moonSun?.fresnel ?? 0;
```

and add `moonSun, moonOpen, moonOn, fresnelAtMoon,` to the returned object directly after `rBack,`. In `relightSplat`, directly after the sun block's closing `  }` (the block opening `  if (sun !== null && windowSun !== null && (flags & FLAG_SUN) !== 0) {`) add:

```ts
  const moon = frame.setting.moonDir, moonSun = frame.moonSun;
  if (moon !== null && moonSun !== null && (flags & FLAG_SUN) !== 0) {
    // The Moon: the same march, its own gates and glass (A5).
    const { visibility } = sunVisibility(model.windows, moonSun, position);
    const cosine = iso ? 0.25 : Math.max(dot(normal, moon), 0);
    for (let c = 0; c < 3; c += 1) e[c] = at(e, c) + visibility * cosine * channel(frame.setting.moonRgb, c);
  }
```

Test literals of type `KernelFrame` built by spreading a prepared frame keep compiling.

**R1b, Task 7 (`floor-light.ts`).** Replace `floorSunVisibility`:

```ts
export function floorSunVisibility(
  model: RelightKernelModel, frame: KernelFrame, data: Pick<FloorLightData, "texel" | "texelToModel">,
  column: number, row: number, rounding: WindowRounding | null = null,
): SunRay {
  if (frame.windowSun === null) return { visibility: 0, steps: 0, sensitive: false };
  return sunVisibility(model.windows, frame.windowSun, floorSunPoint(data, column, row), rounding);
}
```

with:

```ts
export function floorSunVisibility(
  model: RelightKernelModel, frame: KernelFrame, data: Pick<FloorLightData, "texel" | "texelToModel">,
  column: number, row: number, rounding: WindowRounding | null = null, body: "sun" | "moon" = "sun",
): SunRay {
  const windowSun = body === "sun" ? frame.windowSun : frame.moonSun;
  if (windowSun === null) return { visibility: 0, steps: 0, sensitive: false };
  return sunVisibility(model.windows, windowSun, floorSunPoint(data, column, row), rounding);
}
```

**R1b, Task 10 (`relight-frame.ts`).** In `createRelightUniforms`, add `  const moonOpen = Array.from({ length: WINDOW_COUNT }, () => 1);` beside `windowOpen`; replace `    values: { sourceWeights, windowOpen, sunBounce, lampTints },` (A1's) with `    values: { sourceWeights, windowOpen, sunBounce, lampTints, moonOpen },`; and directly after `    fresnelAtSun: uniform(0),` add:

```ts
    /** The Moon (A5): toward it (float32), its colour, on, its horizon gates and its glass. */
    moonDir: uniform(new Vector3(0, 0, 1)),
    moonRgb: uniform(new Vector3()),
    moonOn: uniform(0),
    fresnelAtMoon: uniform(0),
    moonOpen: uniformArray<"float">(moonOpen, "float"),
```

Directly after `export type RelightUniforms = ReturnType<typeof createRelightUniforms>;` add:

```ts
/** One sky body's uniforms as the march reads them (A5): the Sun's or the Moon's. */
export interface SkyBodyUniforms {
  readonly dir: RelightUniforms["sunDir"];
  readonly on: RelightUniforms["sunOn"];
  readonly open: RelightUniforms["windowOpen"];
  readonly fresnel: RelightUniforms["fresnelAtSun"];
}

export function skyBody(u: RelightUniforms, body: "sun" | "moon"): SkyBodyUniforms {
  return body === "sun"
    ? { dir: u.sunDir, on: u.sunOn, open: u.windowOpen, fresnel: u.fresnelAtSun }
    : { dir: u.moonDir, on: u.moonOn, open: u.moonOpen, fresnel: u.fresnelAtMoon };
}
```

Replace `export function sunVisibilityNode(u: RelightUniforms, volumes: WindowVolumeRead, p: Node<"vec3">): Node<"float"> {` with `export function sunVisibilityNode(u: RelightUniforms, volumes: WindowVolumeRead, p: Node<"vec3">, body: SkyBodyUniforms = skyBody(u, "sun")): Node<"float"> {`; inside it replace `  const sun = u.sunDir;` with `  const sun = body.dir;`, `  If(u.sunOn.greaterThan(0.5).and(sun.y.lessThan(DOWN)), () => {` with `  If(body.on.greaterThan(0.5).and(sun.y.lessThan(DOWN)), () => {`, both occurrences of `gate.assign(u.windowOpen.element(w));` with `gate.assign(body.open.element(w));`, and `        visibility.assign(exp(tau.negate()).mul(u.fresnelAtSun));` with `        visibility.assign(exp(tau.negate()).mul(body.fresnel));`. Replace `function createFloorSunPass(volumes: StorageBufferAttribute, out: StorageBufferAttribute, size: readonly [number, number], u: RelightUniforms): ComputeNode {` with `function createFloorSunPass(volumes: StorageBufferAttribute, out: StorageBufferAttribute, size: readonly [number, number], u: RelightUniforms, body: "sun" | "moon" = "sun"): ComputeNode {`, its write line `    write.element(i).assign(sunVisibilityNode(u, read, u.texelToModel.mul(texel).xyz));` with `    write.element(i).assign(sunVisibilityNode(u, read, u.texelToModel.mul(texel).xyz, skyBody(u, body)));`, and `.setName("RelightFloorSun")` with `.setName(body === "sun" ? "RelightFloorSun" : "RelightFloorMoon")`. In `class RelightFrame`, directly after `  readonly floorSun: StorageBufferAttribute;` add:

```ts
  /** The floor's Moon visibility per 2 cm texel (A5), as floorSun. */
  readonly floorMoon: StorageBufferAttribute;
```

directly after `  private readonly floorSunPass: ComputeNode;` add `  private readonly floorMoonPass: ComputeNode;`; in the constructor, directly after `    this.floorSun = new StorageBufferAttribute(new Float32Array(this.floorSunSize[0] * this.floorSunSize[1]), 1);` add `    this.floorMoon = new StorageBufferAttribute(new Float32Array(this.floorSunSize[0] * this.floorSunSize[1]), 1);`, and directly after the line creating `this.floorSunPass` add `    this.floorMoonPass = createFloorSunPass(this.windowVolumes, this.floorMoon, this.floorSunSize, this.uniforms, "moon");`. In `apply`, directly after `    u.fresnelAtSun.value = frame.fresnelAtSun;` add:

```ts
    frame.moonOpen.forEach((open, w) => { u.values.moonOpen[w] = open; });
    if (frame.moonSun !== null) u.moonDir.value.set(frame.moonSun.sun[0], frame.moonSun.sun[1], frame.moonSun.sun[2]);
    u.moonOn.value = frame.moonOn ? 1 : 0;
    u.moonRgb.value.set(setting.moonRgb[0], setting.moonRgb[1], setting.moonRgb[2]);
    u.fresnelAtMoon.value = frame.fresnelAtMoon;
```

and in `dispose` add `    this.floorMoonPass.dispose();` and `    this.floorMoon.dispose();`. (`prepare`'s call is A2's.) Add to `relight-frame.test.ts`:

```ts
  it("marches the Moon through the same windows into its own floor grid (A5)", () => {
    const frame = new RelightFrame(data);
    expect(frame.floorMoon.array).toHaveLength(frame.floorSun.array.length);
    const night = application(frame, "night");
    frame.apply({ ...night, setting: { ...night.setting, moonDir: [0, -0.6, 0.8], moonRgb: [0.001, 0.001, 0.001] } });
    expect(frame.uniforms.moonOn.value).toBe(1);
    expect(frame.uniforms.values.moonOpen).toEqual(frame.kernelFrame?.moonOpen);
  });
```

**R1b, Task 11 (`relight-draw.ts`).** Replace `import { sunVisibilityNode, windowVolumeRead, type RelightFrame } from "./relight-frame.js";` with `import { skyBody, sunVisibilityNode, windowVolumeRead, type RelightFrame } from "./relight-frame.js";`, and directly after the sun block

```ts
    If(u.sunOn.greaterThan(0.5).and(reach), () => {
      // V: the window volume march from the splat, its owner's horizon gate and the glass (Task 10, the twin of Task 4).
      const visibility = sunVisibilityNode(u, volumes, p);
      const cosine = select(iso, float(0.25), max(dot(normal, u.sunDir), 0));
      e.addAssign(u.sunRgb.mul(visibility.mul(cosine)));
    });
```

add:

```ts
    If(u.moonOn.greaterThan(0.5).and(reach), () => {
      // The Moon through the same march, its own gates and glass (A5).
      const visibility = sunVisibilityNode(u, volumes, p, skyBody(u, "moon"));
      const cosine = select(iso, float(0.25), max(dot(normal, u.moonDir), 0));
      e.addAssign(u.moonRgb.mul(visibility.mul(cosine)));
    });
```

**R1b, Task 14 (`floor-material.ts`).** Replace `function floorSunNode(frame: RelightFrame, lightUv: Node<"vec2">): Node<"float"> {` with `export function floorSunNode(frame: RelightFrame, lightUv: Node<"vec2">, grid: "sun" | "moon" = "sun"): Node<"float"> {` and its read line `  const read = storage(frame.floorSun, "float", columns * rows).toReadOnly();` with `  const read = storage(grid === "sun" ? frame.floorSun : frame.floorMoon, "float", columns * rows).toReadOnly();`; and in `litFloorMaterial` replace:

```ts
    const sun = u.sunRgb.mul(floorSunNode(frame, lightUv).mul(max(u.sunDir.z, 0)).mul(u.sunOn));
```

with:

```ts
    const sun = u.sunRgb.mul(floorSunNode(frame, lightUv).mul(max(u.sunDir.z, 0)).mul(u.sunOn))
      .add(u.moonRgb.mul(floorSunNode(frame, lightUv, "moon").mul(max(u.moonDir.z, 0)).mul(u.moonOn)));
```

**R1b, Task 17 (`relight-debug.ts`).** Add `floorMoon(stride: number): Promise<FloorSunCheck>` to `RelightDebug`, implemented exactly as `floorSun` but reading `frame.floorMoon` and calling `floorSunVisibility(frame.model, kernel, frame.floor, column, row, null, "moon")` and `floorSunVisibility(frame.model, kernel, frame.floor, column, row, WINDOW_ROUNDING, "moon")`. In `sample` and `fixture`, replace `const marched = kernel.windowSun !== null && …` with `const marched = (kernel.windowSun !== null || kernel.moonSun !== null) && …` (the rest of each line unchanged), and replace `sunRaySensitive`'s body with:

```ts
  return (kernel.windowSun !== null && sunVisibility(model.windows, kernel.windowSun, position, WINDOW_ROUNDING).sensitive)
    || (kernel.moonSun !== null && sunVisibility(model.windows, kernel.moonSun, position, WINDOW_ROUNDING).sensitive);
```

**R1b, Task 18.** The driver adds, after the `sample_sunny_*` loop: `await relit.page.evaluate(() => window.__relight.select("moonlit")); gpu.sample_moonlit = await relit.page.evaluate(() => window.__relight.sample(97)); gpu.floorMoon_moonlit = await relit.page.evaluate(() => window.__relight.floorMoon(4));`. `gpu_report` treats `floorMoon_*` keys as `floorSun_*` keys (`_floor_ok`, with the "lit" requirement for names containing `moonlit`), and `_word_ok` requires `sunMarched > 0` for names containing `moonlit` or `moon_test` as for `sunny`.

---

## A6. The sky band covers the Moon (done in R1a)

R1a Task 4 (commit `a2a25c56`) widened the reach band itself: `windows.SKY_DECLINATION_MAX = 28.75` and `SKY_PARALLAX_MAX = 1.03` (the Moon's geocentric declination bound, 23.44 + 5.30, and the closest perigee's horizontal parallax), with `check-sun` reporting `missedMoon 0`. Nothing to apply; R1d's Task 0 checks the two constants.

---

## A7. The presets: the moonlit night

**R1b, Task 8 (`light-setting.ts`).** Replace `export const LIGHT_PRESETS = ["captured", "night", "sunny", "overcast"] as const;` with `export const LIGHT_PRESETS = ["captured", "night", "moonlit", "sunny", "overcast"] as const;`. In `PRESET_DEFAULTS` add, after the `night` line, `  moonlit: { date: "2026-09-26", minutes: 1380 },` (the full Moon of 26 September at 23:00 BST: azimuth 139°, 32° up, 99.9% lit, above every window's horizon at that azimuth (14–22°); computed with A3's module and the windows' horizons on 3 October). In `PRESET_DISPLAY` add, after the `night` line, `  moonlit: { exposure: 0.825, whiteBalance: [0.9161, 1, 1.2254] },` and directly after `PRESET_DISPLAY` add:

```ts
/** The moonlit night has no calibrated photograph: at its own hour its exposure shows the floor's mean light at this key (A7). */
export const MOONLIT_DISPLAY_KEY = 0.05;
```

In `lightInputsFromParts`'s `presets`, add after the `night` entry `      moonlit: { weather: clear, house: 0, lampLevel: 0 },` (clear weather, every lamp off). In `light-setting.test.ts`, replace `    expect(defaultChoice()).toEqual({ preset: "captured", ...PRESET_DEFAULTS.captured });` with `    expect(defaultChoice()).toEqual({ preset: "captured", ...PRESET_DEFAULTS.captured });\n    expect(PRESET_DEFAULTS.moonlit).toEqual({ date: "2026-09-26", minutes: 1380 });`.

**R1b, Task 16 (`LightControl.tsx`).** In `LABELS`, add `  moonlit: "Moonlit night",` after the `night` line; in its test replace `["captured", "night", "sunny", "overcast"]` with `["captured", "night", "moonlit", "sunny", "overcast"]`. The Produces line reads "five radios ("As captured", "Night, lamps lit", "Moonlit night", "Sunny morning", "Overcast noon")".

**R1b, Task 10 (`relight-apply.test.ts`).** Add:

```ts
  it("shows the moonlit night at its key by the floor's light, with the night's white balance (A7)", () => {
    const meanLight = vi.fn((): Rgb => [0.002, 0.002, 0.002]);
    const applied = applicationForChoice(inputs, defaultChoice("moonlit"), meanLight);
    expect(applied.display.exposure).toBeCloseTo(0.05 / 0.002, 9);
    expect(applied.display.whiteBalance).toEqual(PRESET_DISPLAY.night.whiteBalance);
  });
```

(Task 10's apply tests: `PASS, 4 tests.`)

---

## A8. The test vectors

**R1a, Task 5, Step 7.** In the `settings` bullet, replace `- \`settings\`: \`captured\`, \`night\` and \`sunny_morning\`, each` with `- \`settings\`: \`captured\`, \`night\`, \`sunny_morning\` and \`moon_test\`, each`, and `\`sunDir: [x, y, z] or null, sunRgb: [r, g, b] }\`` with `\`sunDir: [x, y, z] or null, sunRgb: [r, g, b], moonDir: [x, y, z] or null, moonRgb: [r, g, b] }\``; and add to that bullet: "`moonDir` is null and `moonRgb` zero in the first three. `moon_test` is not a preset: every lamp at 0 (every lamp weight 0), sky 0, no Sun, `moonDir = common.sun_vec_e57(139.3, 32.3)` (the moonlit preset's full Moon) and `moonRgb` equal to `sunny_morning`'s `sunRgb` (a strong light, so the Moon's march, gates, glass and bounce are exercised above the clamp)." In the `windowRays` bullet, replace "then two of `_random_suns(common, 2, SPLAT_SEED + 2)`." with "then two of `_random_suns(common, 2, SPLAT_SEED + 2)`, then the `moon_test` setting's `moonDir` (nine directions)." In the `splats` bullet replace "`expected` with `captured`, `night` and `sunny_morning`," with "`expected` with `captured`, `night`, `sunny_morning` and `moon_test`,".

**R1b, Task 4 (`relight-vectors.ts`).** Replace:

```ts
  sunDir: vec3.nullable(),
  sunRgb: vec3,
});
```

with:

```ts
  sunDir: vec3.nullable(),
  sunRgb: vec3,
  moonDir: vec3.nullable(),
  moonRgb: vec3,
});
```

replace `export const RELIGHT_VECTOR_SETTINGS = ["captured", "night", "sunny_morning"] as const;` with `export const RELIGHT_VECTOR_SETTINGS = ["captured", "night", "sunny_morning", "moon_test"] as const;`, `  settings: z.object({ captured: setting, night: setting, sunny_morning: setting }),` with `  settings: z.object({ captured: setting, night: setting, sunny_morning: setting, moon_test: setting }),`, and `    expected: z.object({ captured: expectation, night: expectation, sunny_morning: expectation }),` with `    expected: z.object({ captured: expectation, night: expectation, sunny_morning: expectation, moon_test: expectation }),`. The kernel's vector tests that iterate `RELIGHT_VECTOR_SETTINGS` then cover `moon_test`; where a test lists the three settings literally, add `"moon_test"`.

**R1b, Task 17 (`relight-debug.ts`).** In `fixture`, replace `      await select(setting === "sunny_morning" ? "sunny" : setting);` with:

```ts
      if (setting === "moon_test") {
        // Not a preset: the vectors' own setting, applied as it is (A8).
        await new Promise<void>((resolve) => {
          const stop = frame.onApply(() => { stop(); void afterFrames(2).then(resolve); });
          frame.apply({ setting: settingFromVectors(vectors.settings.moon_test), display: NEUTRAL_DISPLAY, sun: null });
        });
      } else {
        await select(setting === "sunny_morning" ? "sunny" : setting);
      }
```

(import `settingFromVectors` from `./relight-vectors.js`). **R1b, Task 18:** the driver's fixture loop becomes `for (const setting of ["captured", "night", "sunny_morning", "moon_test"])`.

---

## A9. The sky-body bounce basis in the browser, both bodies

R1a Task 4 committed the sky bodies' bounce as a factored basis (`tools/relight/relight/sunbounce.py`; its contract is the Task 4 report's section "Data layout and the browser's contract, factored model"): per window w and body direction s, `B_w(s) = P_w(s) × R_w(s)`, where `P_w` is the exact power through window w (56,448 patch rays marched per light change, gated, with the glass) and `R_w` a K-volume basis on the 1 m grid mixed by a 4° coefficient table. The controller's revision of R1b's bounce (replacing the sunlit-area model) implements it. R1d relies on it in exactly this form, so the revision must meet these points:

1. **Both bodies, one fold.** The fold adds `Σ_k (sunRgb ⊗ c_sun,k + moonRgb ⊗ c_moon,k) × basis_k(probe)` per channel to the scenario volume, so the multiplier pass, the floor's base light (A2) and R1c's skins receive both bodies' bounce with no change of theirs.
2. **On the GPU, every light change, with no read-back.** Per body: a pass that marches the patch rays toward the body through the window volumes (`sunVisibilityNode` with `skyBody(u, body)` at each ray's origin: the same march, gates and glass) and writes each patch's per-window power; a pass that sums them into `P_w`; a pass that forms `c_k` from the four table corners (whose indices and bilinear weights the CPU computes in `apply` from the body's float32 direction, as `windows.sun_corners` does: cheap) and `P_w`. They run first in `prepare` (A2's call names them `skyBouncePasses`). `RelightFrame.apply` never marches a patch ray on the main thread: the CPU twin's `P_w` (`windowPower`) is computed lazily, only when a CPU caller (a test, a DEV check, the display's fallback) asks for it.
3. **Read access for R1d.** `RelightFrame` exposes `skyPower: StorageBufferAttribute` (10 floats: the Sun's `P_W1..P_W5`, then the Moon's), `bounceCoefficients: StorageBufferAttribute` (2K floats: the Sun's `c_k`, then the Moon's) and `floorMeanBasis: Float32Array` (`floorMean`, K × 3). R1d's eye uses them only for its fallback (read back asynchronously, at most four times a second).
4. **Cost.** On the RTX 4090 the passes of both bodies together take at most 1 ms of GPU time per light change (R1d Task 23 measures it within a light step); a miss is reported to the controller with the numbers.

---
## A10. One preview, at the end

R1 polished §5: "R1 is delivered as four plans, executed in order, with one preview at the end". **R1b, Task 19:** replace Steps 6–8 (the PR body for Blake, the Vercel preview check and the hand-over) with one step: "Push `claude/real-hall` and record the commits and Task 18's evidence in the session log; no preview is shown to Blake for R1b. The one preview is R1d's Task 24." **Overlap:** R1c's amendments may say the same; keep one copy.

---

## A11. Wording: passes while the light moves

**R1b**, the Architecture paragraph, Task 11's description, Task 12's description and Task 19 Step 2's `native-splats.md` text: replace each "never per frame" with "only when the light changes (R1d reruns it every frame while the light moves, and never while it is still)". No code changes.

---

## The R1c interface R1d consumes

R1d's Task 0 checks each item by name. Items marked "R1c" are R1c's own (its plan's Global Constraints and contracts); the rest are R1d's expectation of R1c's tasks, for the controller to reconcile with R1c's planner before either plan executes.

1. **Records** (R1c amendment A1): `TOGGLE_SHIFT = 6`, `TOGGLE_CLUTTER = 1` (loose cables, loudspeakers, stray items), `TOGGLE_CABINET = 2` (the AV cabinet), `CLASS_SKIN = 7` with its wall group in bits 5–7; `toggleOf(flags)` and `skinGroupOf(flags)` in `relight-codec.ts`. R1d adds no record class: its glow hiding reads class 3 and the nearest of the five chandelier centres (R1d Task 7); A6 and A8 are its only record-related changes.
2. **Visibility** (R1c A2): `interface RelightVisibility { readonly skinGroups: number; readonly hiddenToggles: number }`, `RelightFrame.setVisibility(visibility)`, `RelightFrame.visibility`, and R1c's `skinVisibility(...)` in `lib/skins/skin-visibility.ts`. R1d's clutter toggle sets `hiddenToggles` through the store (item 7) and never builds its own visibility.
3. **Passes** (R1c A8/A9): `RelightFrame.addPasses(passes)` and `SkinFrame.passes`: the skins' base-light and sun passes run inside `prepare`, so R1d's per-frame light steps rerun them. If R1d Task 23's budget needs amortisation, R1d's `RelightFrame.setPassStride(stride, phase)` tells every listener registered with `RelightFrame.onPassStride(listener: (stride: number, phase: number) => void): () => void` (R1d Task 7); R1c's skins subscribe once and call `SkinFrame.setStride(stride: number, phase: number): void`, so their passes handle the same interleaved share as the multiplier pass and finish with it when the light settles.
4. **The skin material's hooks** (expected): `litSkinMaterial(skin, frame, inputs, hooks?: SkinLightHooks)` in `lib/skins/skin-material.ts`, with
   - `interface SkinSurface { readonly position: Node<"vec3">; readonly normal: Node<"vec3">; readonly albedo: Node<"vec3">; readonly roughness: Node<"float">; readonly metal: Node<"float">; readonly bodyVisibility: (body: "sun" | "moon") => Node<"float"> }` (model frame; the per-pixel normal from `skinNormalNode`; R1c's `SkinMaterialInputs` maps; `bodyVisibility` is the window march's visibility at the pixel, read from the skin's sun or moon grid exactly as the material's own sun term reads it, so the sheen's direct speculars are gated by the same windows);
   - `interface SkinSheen { readonly diffuseScale: Node<"float">; readonly specular: Node<"vec3"> }`;
   - `interface SkinLightHooks { readonly sunShadow: ((position: Node<"vec3">, body: "sun" | "moon") => Node<"float">) | null; readonly sheen: ((surface: SkinSurface) => SkinSheen) | null }`;
   - the material's light is `albedo × (base × sheen.diffuseScale + Σ body light × sunShadow(position, body)) + sheen.specular`, then R1b's `displayNode(…, frame.uniforms.display, float(HIGHLIGHT_KNEE))`; with `hooks` absent or its members null, exactly R1c's own output;
   - `RelightSkins` reads the hooks from a React context `SkinLightHooksContext` exported by `components/scene/skin-hooks-context.ts` (default `{ sunShadow: null, sheen: null }`) and rebuilds its materials when the value changes; R1d's `RelightCinematic` provides it.
5. **Names** (expected): every skin mesh's material is named `relight-skin` (the provenance view's is not); R1d's reflection probes find the skins by it.
6. **The Moon on the skins** (expected, from A5): the skins' sun grid gains the Moon's grid exactly as the floor's does (a second pass with `skyBody(u, "moon")`, a second buffer), and the material adds the Moon's term beside the Sun's.
7. **The store** (expected): `useLightSettingStore` gains `hiddenToggles: number` (bit `1 << (toggle − 1)`; default relight package v2's `visibility.defaultHidden`: the loose clutter hidden, the cabinet shown) and `setToggleHidden(toggle: 1 | 2, hidden: boolean): void`; R1c's `RelightSkins` keeps `frame.setVisibility` in step with it. R1d's control (Task 20) shows the two switches.
8. **Queries** (R1c): `?skins=off` draws every wall group as splats (previewable only); R1d's captured-light check uses it.

---

## Interfaces R1d expects from the bake and the frontier studies (added 7 October)

R1d's Tasks 1, 3 and 21 read these; each has a stated fallback, so R1d never assumes a value it does not have.

1. **The bulb table** (the frontier splats study, `D:/claude/real-hall/frontier/splats/`): `evidence/bulbs.json`, schema `venviewer.frontier.bulbs.v1`, written by `scripts/10_bulb_table.py` from `05_build_obs.py`'s triangulation: `frames.T_json_from_e57` (equal to `canonical_frame.json`'s), and per bulb `id` (`c<chandelier>_b<nn>`), `chandelier` (0–4; 2 is the centre one), `position_json`, `position_e57`, `faces_used`, `ray_residual_mm_p50`, and `not_yet_triangulated`. R1d wants all five chandeliers: on 7 October the table holds 83 bulbs of chandeliers 0 and 2, and chandeliers 1, 3 and 4 are about a minute of single-threaded CPU each with the same scripts (their per-chandelier records `work/bulbs_c1.json` and `bulbs_c3.json` already existed that evening). Fallback: a chandelier the table does not cover keeps its captured glow, unboosted, and shines in the sheen as a sphere at its centre (R1d Tasks 1, 7, 17). Owner: the frontier splats study (or R1a's `bulbs` command, as the study proposes in its §e).
2. **The house-light refit** (the bake: R1a's Task 4b, which the R1a plan's "As built (7 October)" note names as re-running `probes` and `sun-bounce` after the house-light refit): R1a's capture fit gives the centre chandelier a weight of 1.4e-11 although it was lit for the whole 31 May walk (the splats study §b1: 244 keyframes within 4 m, every one lit). The bake refits the house lights with the centre chandelier's light attributed (the study suggests constraining ch_centre against the ch_end weight by the bulb-count ratio, 54 / 29 per chandelier) and per-bulb intensities constrained by the bulb table (its clipped-blob areas are a relative, monotone proxy within one face), reruns the capture checks, and republishes the relight package's weights (and per-group lamp colours if the refit separates them; today all four lamp groups share one measured colour). It writes `D:/claude/relight/grand-hall/work/bulb-intensities.json` = `{ "schema": "venviewer.bulb-intensities.v1", "bulbs": { "<bulb id>": <relative intensity, positive> }, "fit": { … } }`, naming every bulb of the table. R1d's Task 3 normalises the shares to a mean of 1 per group and divides each group's floor-solved intensity between its bulbs by them. Fallback: equal shares, and whatever weights the relight package carries; R1d's Task 21 refuses to calibrate a lamp group whose renders the bake leaves dark (below 1% of the lamps' light at both night stations) and says so, rather than inflating its gain.
3. **The lamps' colour and type** (decision 11): the colour of each group at full level is the relight package's own, never a constant in R1d; the warm-down's starting temperature comes from R1a's `lamp_daylight_ratio.json` (Task 3: about 3,700 K at D65, 3,540–3,990 K for D60–D75). The venue has been asked for the chandeliers' lamp product and the frieze tape's colour temperature (the light study §b9); an answer changes only package values (a group's measured colour after a refit, the envelope's size, or `dimming` should Blake ever choose `led`), never R1d's code.
4. **The frontier light study** (`D:/claude/real-hall/frontier/light/`): the luminance calibration (`LuminanceCalibration`, 54 cd/m² per fit unit today), the glare function (`GlareNode`; a fit to the CIE disability glare function takes its formula and parameters from the text of CIE 135/1-6:1999, never from memory), the window view (`WindowViewModel`), the night-vision stage (`nightVisionNode`) and the lamps' dimming colour (`dimmedTint`) are R1d's upgrade points (decision 10); spectral rendering stays an upgrade behind them, never a dependency.
