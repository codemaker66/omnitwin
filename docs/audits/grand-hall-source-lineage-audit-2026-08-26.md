# Grand Hall source-lineage audit

Date: 2026-08-26
Scope: user-supplied Grand Hall XGRIDS, panorama, OBJ, E57, processed BIG variants, and capture staging
Mode: read-only; no source mutation, upload, reconstruction, generation, acceptance, or authority grant

## Conclusion

The supplied roots contain three primary capture lineages, not nine independent
reconstructions:

1. one raw XGRIDS PortalCam capture;
2. one Matterport capture family represented by E57, MatterPak, and a rigidly
   aligned OBJ derivative;
3. one processed XGRIDS model packaged as three byte-level representation cores
   across nine directories: SOG, SPZ, and native LCC.

The 148 external panoramas are a separate exact image corpus. They are probably
related to the Matterport capture, but that correspondence and every pose remain
human-pending. No “highest quality” winner can be selected from directory count,
file size, compression format, or primitive count. The SOG, SPZ, and native LCC
cores must be compared at identical verified cameras and renderer settings
against held-out real imagery after Grand Hall-only scope and cross-frame
registration have been reviewed.

## Exact inventory matrix

| Family | Exact live identity | Duplicate or derivative finding | Use in the Grand Hall pipeline |
|---|---|---|---|
| Raw XGRIDS PortalCam | 12 files; 41,296,996,984 bytes; every live hash matches sealed inventory `6e6fe18c4944cb5a0e68a69c3bc9dbb808835be6293465f50652d47e8df68236`; XBIN SHA-256 `42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0`; four cameras and 42,850 poses | One raw capture, not a reconstruction variant | Richest potential XGRIDS source, but original frames and calibration remain inaccessible in the proprietary XBIN/encrypted calibration bundle |
| Processed XGRIDS BIG model | 399 files; 5,056,057,926 bytes; all live-hashed; 95 unique content hashes; shared model GUID `2d483e031ad40e259c75f765d6f5fcbb` | One reconstruction lineage, three byte-level cores, nine packages; optional OBJ/PLY copies add no reconstruction | Current visual candidates; winner requires matched-camera evidence |
| Matterport E57 | 20,518,437,888 bytes; live SHA-256 `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd`; 149 sweeps; 965,520,000 raw point records; 894 exact 4096×4096 JPEG faces | Primary Matterport capture representation | Strongest registered metric/photo evidence, but covers the whole building and has no reviewed Grand Hall crop |
| MatterPak export | 155 vendor files; 1,759,056,988 bytes; all live hashes match staging; original OBJ `cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7`; `cloud.xyz` `a1e5fc55f62897e4cd08851f4e7e07e3949cc8e1894fbc6c02d029863b821144`; OBJ stem matches E57 root GUID `424ff41f6e5d41969c635fcd61be9b3f` | Same Matterport family as E57 | Reconstructed scope/structure evidence; room 9 remains human-pending with 90 components, eight interfaces, and cleanup questions |
| Aligned MatterPak OBJ | 40,954,065 bytes; live SHA-256 `394f17f42d131669ff1667814b8801e25b576a3a37193be6bdb5c66bdb7f3fbf` | Rigid transform of the original OBJ with identical topology and material assignments | Coordinate reference only; no additional detail |
| TH Panoramic | 148 unique 8192×4096 JPEGs; 841,259,945 bytes; all live hashes match T-554; sweep 093 absent | Separate exact image corpus | Best accessible high-resolution colour evidence, but neither room-clean nor pose-authoritative |
| Capture staging | 156 payload files; 22,277,494,876 bytes; paths, sizes, and ledgers match sealed staging evidence | Immutable copy of E57 plus the 155-file MatterPak set | No additional source or reconstruction detail |

## Processed BIG decomposition

| Exact core | Packaging directories | Files / bytes | Comparison inventory digest |
|---|---|---:|---|
| SOG/LCC2 | `_1`–`_3` | 60 / 214,350,601 | `4585ff38e79858c35c4c1774a29a759ff85881bf5ee3d46bd7f96cae40e69c5a` |
| SPZ/LCC2 | `_4`–`_6` | 60 / 340,454,888 | `86194ace60022c0969caf24b53726c48d4a8ca3dad95c36e619e40fb166a16c0` |
| Native LCC | `_7`–`_9` | 11 / 1,127,138,769 | `71792335817d5e288ea1019907eef46ada72a2a0d11f1639e53d644c7ff52b01` |

SOG and SPZ expose identical five-level counts: 11,487,038 total and
6,019,684 finest. Decoded positions agree within 1.43 mm. Native LCC shares the
model GUID and near-identical root bounds but exposes 11,685,214 total and
6,127,396 finest splats, so exact primitive parity with SOG/SPZ is not proven.

## Unresolved evidence questions

- T-560 has 146 human-pending panorama/E57 candidates and two ambiguous rows,
  sweeps 078 and 079. No panorama pose is accepted.
- T-561 observed Grand Hall pixels in 74 panoramas and none in 74 at
  2048×1024 display resolution. All native 8192×4096 decisions and masks remain
  pending.
- “Sweeps 0–49 are Grand Hall” is unsafe: source observations extend through
  061, 065–075, and 148–149, and many frames cross room boundaries.
- MatterPak room 9 is a strong candidate, not a closed or accepted Grand Hall
  volume. All eight interfaces and closure planes remain unresolved.
- Cleanup evidence identifies five literal `Mirror` target groups, no explicit
  window locator, and no applied cleanup.
- No reviewed transform binds Matterport Z-up metres to the XGRIDS/BIG frame.
- No supplied artifact positively evidences diffusion or generative repair.
  Capture-derived reconstructions still do not independently prove every
  architectural surface.

## Evidence-gated next sequence

1. Complete the T-554 v3 native per-source review, masks, cleanup dispositions,
   eight interface decisions, closure planes, and closed selection volume.
2. Resolve panorama/E57 correspondence and review camera orientation.
3. Produce a signed Matterport-to-XGRIDS transform and exact Grand Hall-only
   output mask.
4. Compare native LCC, SOG, and SPZ at identical verified cameras and renderer
   settings against held-out real imagery.
5. Select the winner from those measurements and human comparisons. Any future
   generative repair must remain a separate, explicitly non-authoritative layer.
