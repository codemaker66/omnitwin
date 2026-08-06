# XGRIDS Potree-style point-value research for V8

Date: 18 July 2026  
Status: implemented, replayed and independently audited  
Authority: none

## Direct conclusion

The exact Reception XGRIDS `project_data/model` bundle can support a bounded,
deterministic local point-value diagnostic. Its 175,237 established 14-byte
records decode consistently under the official Potree DEFAULT worker convention
and satisfy the V7 hierarchy and declared numeric bounds.

That result is narrower than a metric or viewer claim. It does not identify the
coordinate system, units, axis meaning, physical accuracy, completeness or
producer. The one-byte field named `lcc prediction` remains an opaque vendor
attribute. The generated images are intentionally private CPU diagnostics, not
reproductions of the official Potree renderer.

## Primary implementation evidence

The bounded decoder and node interpretation follow the official viewer source:

- [Official Potree DEFAULT point decoder](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/modules/loader/2.0/DecoderWorker.js#L21-L150)
- [Official Potree v2 loader](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/modules/loader/2.0/OctreeLoader.js#L14-L436)
- [Potree viewer licence](https://github.com/potree/potree/blob/1.8.2/LICENSE)

The worker reads little-endian signed 32-bit position components and applies the
metadata scale and offset. It advances through attributes in metadata order. V8
freezes that behavior only for the V7-established XGRIDS layout:

| Byte offset | Width | V8 interpretation |
| ---: | ---: | --- |
| 0 | 12 | little-endian `int32[3]` raw position |
| 12 | 1 | raw `uint8` intensity |
| 13 | 1 | opaque raw `uint8`, declared name `lcc prediction` |

These implementation sources do not define the vendor attribute's meaning or
grant rights over venue content or XGRIDS-produced outputs.

## Frozen point-value contract

V8 is a separate layer over the immutable V7 artifact. Before interpreting any
point record, it requires the exact established V7 bundle root, bundle digest,
member paths, member sizes and member SHA-256 values. The supplied octree bytes
must reproduce that identity.

The frozen limits are:

| Limit | Value |
| --- | ---: |
| Octree bytes | 64 MiB |
| Point records | 4,000,000 |
| Exact deep duplicate profile | at most 500,000 records |
| Synchronous phase budget | 30,000 ms |
| Preview raster | 1024×1024 RGBA, 32-pixel margin |

The inspector replays the V7 breadth-first node topology and exact octree byte
ranges. Every record is decoded exactly once. Each numeric coordinate must be
finite, fall within the metadata-declared numeric range, and fall within its
node's derived bounds. The node comparison allows exactly one declared scale
unit per component to absorb the converter's integer-grid boundary convention.

Raw quantiles are order statistics over signed integers. Decoded quantiles are
derived from those exact raw values and the embedded V7 scale/offset rather than
independently sampled. The intensity and opaque-byte distributions retain all
256 histogram bins, their sum, extrema and distinct-value count.

Cancellation is checked before the synchronous work and at explicit phase
guards. A cancellation request cannot issue a V8 artifact when observed at one
of those guards. JavaScript cannot process a same-thread cancellation callback
while a synchronous decode or `fflate` PNG compression call is executing, so
the contract does not claim an abort in the middle of such a phase.

## Reception decoded evidence

The unchanged V7 bundle digest is
`f226739d3f8e94605b8c363a1b135986388b5cf920df0194ff960bfed5940fb2`.
The exact point-value outcome is established for 175,237 records and 525,711
coordinate components, with zero non-finite components and zero node-bound or
declared-range violations.

Raw component evidence:

| Component | Minimum | q01 | q05 | q25 | q50 | q75 | q95 | q99 | Maximum |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 4,560 | 9,930 | 27,090 | 53,450 | 73,830 | 103,850 | 111,380 | 149,560 |
| 1 | 0 | 4,829 | 10,439 | 37,030 | 74,800 | 113,270 | 137,300 | 144,490 | 160,520 |
| 2 | 0 | 5,050 | 5,260 | 5,529 | 15,520 | 29,590 | 36,340 | 36,570 | 38,990 |

Decoded quantiles, kept as unlabelled numeric coordinates:

| Component | q01 | q05 | q25 | q50 | q75 | q95 | q99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | -6.529000145033933 | -5.992000158599694 | -4.2760002019495005 | -1.6400002685404615 | 0.39799967997532804 | 3.3999996041384293 | 4.152999585116049 |
| 1 | -12.776099836723006 | -12.215099850895058 | -9.555999918069574 | -5.77900001348462 | -1.9320001106680138 | 0.4709998286271002 | 1.1899998104636325 |
| 2 | -1.4370000442286255 | -1.41600004475913 | -1.3891000454386813 | -0.3900000706780702 | 1.0169998937781202 | 1.691999876726186 | 1.714999876145157 |

The full decoded extrema are
`[-6.985000133514404,-13.258999824523926,-1.9420000314712524]` to
`[7.970999488665257,2.7929997699684463,1.9569998700317228]`. These values are
not labelled as metres, room bounds or surveyed coordinates.

Intensity occupies byte offset 12 and observed values 1–255, with sum 6,967,027
and 186 distinct values. The opaque byte occupies offset 13 and observed values
20–100, with sum 14,415,430 and 79 distinct values. Satisfying the declared
`uint8` range does not reveal what that byte means.

## Duplicate-position profile

Because Reception has fewer than 500,000 records, V8 performs an exact deep
profile rather than a sample:

- unique raw positions: 168,929;
- records beyond the first at duplicate positions: 6,308;
- positions with multiplicity: 12;
- greatest multiplicity: 6,298;
- most repeated raw position: `[62270,125420,30490]`;
- unique complete records: 168,936;
- duplicate complete records: 6,301.

The warning threshold is exact duplicate-position excess greater than 1% of the
record count. Regression coverage proves the 100-of-10,000 boundary does not
warn and 101-of-10,000 does. Reception exceeds that threshold. The warning says
only that concentration was observed; it does not classify the bundle as
corrupt or establish why the concentration exists.

## Deterministic preview contract

The profile
`deterministic_cpu_triplanar_rgba_png_fflate_0_8_2_v1` freezes three views in
this order: components `0/1`, `0/2`, then `1/2`. Each view freezes four modes in
this order: greatest omitted component, raw intensity, opaque vendor byte, and
log record density.

Positions are uniformly fitted to observed extrema without cropping. The
camera looks in the positive omitted-component direction. For collisions, the
numerically greatest omitted component is frontmost and an exact tie selects
the lowest record ordinal. Colour maps are fixed literals. RGBA pixel bytes are
hashed before lossless PNG encoding, and PNG bytes are independently hashed.
Compression is pinned to `fflate` 0.8.2. Those choices make the local evidence
repeatable without claiming parity with Potree's WebGL renderer.

Across the three planes, occupied pixels are 107,704, 68,792 and 66,340; maximum
records per occupied pixel are 6,298, 6,300 and 6,301. All twelve final pixel
and PNG identities are recorded in
`docs/reports/xgrids-potree-v2-point-values-v8-evidence-2026-07-18.json`.

## V8 evidence boundary

V8 may establish only:

- exact decoding of the exact V7-established 14-byte records;
- finite, declared-range and derived-node-bound checks;
- exact raw/decoded numeric extrema and quantiles;
- exact one-byte distributions and the opaque field's declared name;
- an exact duplicate profile under the frozen threshold;
- deterministic private local raster identities under the frozen CPU profile.

V8 must not claim units, axis labels, frame, CRS, physical bounds, room identity,
capture completeness, survey accuracy, registration quality, raw-LiDAR status,
producer identity, vendor semantics, official-viewer fidelity, provenance,
rights, training eligibility, release eligibility or authority.

## Implemented outcome

The exact final V8 facts, readiness and effective checklist SHA-256 values are:

- Source Facts V8:
  `29da55f12cbe20d519ce33a1901242ca073f06059cb1b5731eb1216b17e4706d`;
- Source Readiness V8:
  `0106b768f7cee2e2cf8f251f77460f1a358a05ba188843c98ec0caebab928832`;
- Operator Evidence Checklist V8:
  `234e6dc256938aa53109d08a2b5ff51a562f311a18aa46dd4e8873e7bad6ab5d`.

One inherited unknown and its effective evidence request are resolved by the
exact outcome reference; every V7 request remains byte-preserved inside V8 and
nine unresolved requests remain effective. The responsive loopback surface
exposes the exact facts, controls, selected PNG identity and canonical V8
downloads while retaining every V7 public endpoint and filename.

No source mutation, reconstruction, network service, paid compute, signing,
release or publication occurred. T-531 is complete only as this bounded slice;
T-508 and the broader `/goal` remain active.
