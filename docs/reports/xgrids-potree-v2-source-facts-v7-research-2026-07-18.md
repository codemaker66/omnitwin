# XGRIDS Potree-style preview research for Source Facts V7

Date: 18 July 2026  
Status: implemented, replayed and independently audited  
Authority: none

## Direct conclusion

The XGRIDS `project_data/model` directories are useful open-structure preview
bundles for the next bounded Foundry intake profile. They are not raw PortalCam
sensor data, do not identify their generating XGRIDS/LCC version, and do not
resolve units, frame, accuracy, provenance, rights, renderer fidelity, or
release authority.

The frozen Reception trio is internally exact under the official Potree viewer
hierarchy rules. It is best described as an **XGRIDS vendor preview using a
viewer-compatible Potree 2.0-style DEFAULT layout**, not as canonical current
PotreeConverter output.

## Primary implementation evidence

No standalone normative Potree 2.0 wire-format specification was found. The
bounded profile therefore uses the official converter and viewer implementations
as primary evidence:

- [PotreeConverter 2.1.3 release](https://github.com/potree/PotreeConverter/releases/tag/2.1.3)
- [PotreeConverter README: three core data files](https://github.com/potree/PotreeConverter/blob/2.1.3/README.md#L2-L13)
- [Metadata writer](https://github.com/potree/PotreeConverter/blob/a70ef212198b0e5ae1d071713a0c8cbda8fcc9a7/Converter/src/indexer.cpp#L417-L518)
- [Hierarchy record and proxy writer](https://github.com/potree/PotreeConverter/blob/a70ef212198b0e5ae1d071713a0c8cbda8fcc9a7/Converter/include/HierarchyBuilder.h#L240-L344)
- [Octree range writer](https://github.com/potree/PotreeConverter/blob/a70ef212198b0e5ae1d071713a0c8cbda8fcc9a7/Converter/src/indexer.cpp#L1434-L1516)
- [Official viewer hierarchy loader](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/modules/loader/2.0/OctreeLoader.js#L14-L264)
- [Official viewer metadata and child-octant loader](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/modules/loader/2.0/OctreeLoader.js#L293-L436)
- [Official DEFAULT point decoder](https://github.com/potree/potree/blob/5636cd471d9eb464969e758be45c44d7613d3859/src/modules/loader/2.0/DecoderWorker.js#L21-L150)
- [PotreeConverter BSD-2-Clause licence](https://github.com/potree/PotreeConverter/blob/2.1.3/LICENSE)
- [Potree viewer licence](https://github.com/potree/potree/blob/1.8.2/LICENSE)

Potree's code licence does not grant rights over XGRIDS software, captured venue
content, or vendor-produced outputs. The current public XGRIDS material lists
LCC, LCC2, PLY, Mesh, USD and 3D Tiles exports, but does not document this
internal preview layout or the meaning of `lcc prediction`:

- [XGRIDS downloads](https://xgrids.com/support/download?page=LCCStudio)
- [XGRIDS LCC Studio version documentation](https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.0.0/02-version-and-updates.html)
- [XGRIDS public repositories](https://github.com/orgs/xgrids/repositories)

## Frozen structural contract

The bundle has three required core members by exact leaf name while allowing
unrelated ancillary files such as `log.txt`:

1. `metadata.json`
2. `hierarchy.bin`
3. `octree.bin`

For this XGRIDS-specific profile, `metadata.json` must declare wire version
`2.0`, encoding `DEFAULT`, and this metadata-order record layout:

| Order | Attribute | Declared type | Bytes |
| ---: | --- | --- | ---: |
| 0 | `position` | `int32[3]` | 12 |
| 1 | `intensity` | `uint8` | 1 |
| 2 | `lcc prediction` | `uint8` | 1 |

This establishes a 14-byte interleaved record layout only. V7 does not decode
coordinate or attribute values.

Each hierarchy record is 22 little-endian bytes:

| Offset | Width | Field |
| ---: | ---: | --- |
| 0 | 1 | node type: `0=NORMAL`, `1=LEAF`, `2=PROXY` |
| 1 | 1 | child mask |
| 2 | 4 | unsigned point count |
| 6 | 8 | byte offset |
| 14 | 8 | byte size |

Records within a hierarchy chunk are breadth-first and children are appended
in index order 0 through 7. For `NORMAL` and `LEAF` records, offset and size
refer to `octree.bin`. For a `PROXY`, they refer to another hierarchy chunk.
The target chunk's first row replaces that same logical proxy node. Proxy point
counts must therefore never be double-counted or interpreted as octree ranges.

For viewer compatibility, every unsigned 64-bit range value is constrained to
`0..2^63-1`, because the official viewer reads the fields as signed 64-bit
integers.

## Local inventory

Read-only inventory found 21 complete co-located bundles: ten primary F: room
directories, ten matching F: copies, and one Downloads copy of Reception. No
bundle is stored in this repository.

The strongest positive is:

`F:\gaussian splat -- xgrids\model\Reception_Room_2026-06-01-150618\project_data\model`

| Member/fact | Exact value |
| --- | ---: |
| `metadata.json` | 1,299 bytes |
| `hierarchy.bin` | 2,046 bytes = 93 records |
| `octree.bin` | 2,453,318 bytes |
| metadata points | 175,237 |
| record stride | 14 bytes |
| point-byte equation | `175,237 x 14 = 2,453,318` |
| reachable hierarchy | 93 records, no proxies |
| octree ranges | disjoint, gapless, exact full coverage |

Exact Reception member SHA-256 values:

- metadata: `65e314ff0908ba9a87a4e149f82c3bc76fe529fd0aa63b621c7c69b8e94a0d7e`
- hierarchy: `40d1fe4a74f7cd5f92ec6752bc9f5aebe5ba262795da8748c00363017f76e21b`
- octree: `c49eb7a959be867ef27b63ca1e17b36505566a882f359b642b268afb979e98f5`

Four real negative bundles have octree lengths divisible by the frozen 14-byte
record stride but disagree with the metadata point count:

| Bundle | Metadata points | Octree-byte-derived records | Difference |
| --- | ---: | ---: | ---: |
| `default` | 153,300 | 141,285 | 12,015 |
| `Grand_Hall_Bright_Walls` | 466,860 | 434,348 | 32,512 |
| `Robert_Adam_Room` | 352,855 | 336,947 | 15,908 |
| `The_Grand_Hall` | 1,159,861 | 1,114,751 | 45,110 |

These are metadata/octet-length mismatches. V7 rejects them at that equation
before treating hierarchy facts as established. The available evidence does
not prove whether stale metadata, truncation earlier in the vendor workflow, or
another cause produced them.

The other five primary room bundles fail closed because the official
breadth-first/proxy traversal cannot reach all bytes in `hierarchy.bin`:

| Bundle | Unreferenced hierarchy bytes | V7 result |
| --- | ---: | --- |
| `DC_Room_2026-05-31-150245` | 572 | `POTREE_V2_HIERARCHY_UNREACHABLE_BYTES` |
| `Lady_Conveynor_2026-05-31-145027` | 154 | `POTREE_V2_HIERARCHY_UNREACHABLE_BYTES` |
| `North_Gallery_2026-06-01-160407` | 110 | `POTREE_V2_HIERARCHY_UNREACHABLE_BYTES` |
| `South_Gallery_2026-06-01-154429` | 88 | `POTREE_V2_HIERARCHY_UNREACHABLE_BYTES` |
| `The_Saloon_2026-05-29-142325` | 748 | `POTREE_V2_HIERARCHY_UNREACHABLE_BYTES` |

These are strict structural classifications under the frozen traversal rules,
not claims that the files are truncated, visually unusable, or corrupt in
some other vendor-specific reader.

## Reception compatibility deviations

The frozen Reception structure is accepted by the reviewed official-loader
traversal semantics, but V7 must retain rather than erase these deviations:

- metadata says `hierarchy.depth = 0`, while the breadth-first topology reaches
  derived depth 3;
- 13 records labeled `LEAF` have nonzero child masks;
- current PotreeConverter would normally label nodes with children `NORMAL`;
- current converter output commonly adds histograms for populated one-byte
  attributes, while this vendor metadata omits them.

The viewer ignores metadata `hierarchy.depth`, does not use `stepSize` during
traversal, and only gives node type `2` special loading behavior. These facts
support a status such as `accepted_with_vendor_compatibility_deviations`; they
do not establish which converter or XGRIDS version produced the files.

## V7 evidence boundary

V7 may establish only:

- exact member identities and the three-file bundle binding;
- bounded metadata syntax and frozen 14-byte declared layout;
- reachable hierarchy chunk and proxy topology;
- hierarchy record counts, derived depth, node-type counts and compatibility
  deviations;
- exact per-node point-count/byte-size equations;
- disjoint, gapless octree byte ranges and complete byte coverage;
- equality of resolved point counts, metadata point count and octree byte
  length.

V7 must not claim decoded values, units, metric scale, axes, frame, CRS,
occupied physical bounds, room identity, capture completeness, survey accuracy,
registration quality, raw-LiDAR status, producer identity, vendor attribute
semantics, visual fidelity, provenance, rights, training eligibility, release
eligibility, or authority.

Independent surveyed controls and human review remain necessary for physical
accuracy. Written, purpose-scoped rights and authenticated identity evidence
remain necessary for training, signing, publication, or release. Those gates
do not prevent this ordinary read-only local structural inspection.

## Implemented outcome

Source Facts V7 now preserves the exact V6 artifact and adds a separate,
digest-bound Potree bundle layer. Metadata and hierarchy capture is bounded;
`octree.bin` is streamed and hashed without whole-file retention. Candidate
bundles are inspected sequentially, cancellation issues no V7 artifact, and
same-stream size/SHA-256 checks bind every member to its intake identity.

The exact Reception replay established one three-member bundle with 175,237
declared and resolved points, a 14-byte record, 93 logical nodes, 2,046
reachable hierarchy bytes and 2,453,318 gapless octree bytes. It retained all
three compatibility notes and all ten unknowns. The readiness map adds one
path-specific refinement over three inherited paths, and the checklist adds ten
digest-bound requests without treating any request as completed work or
permission.

The machine-readable evidence and concise report are:

- `docs/reports/xgrids-potree-v2-source-facts-v7-evidence-2026-07-18.json`
- `docs/reports/xgrids-potree-v2-source-facts-v7-report-2026-07-18.md`
