# Grand Hall native LCC visible-UI evidence

> **DIAGNOSTIC ONLY · AUTHORITY NONE · HUMAN ACCEPTANCE PENDING**

The installed vendor editor successfully loaded and visibly rendered the real
Grand Hall lineage after its own UI upgraded an exact scratch clone of the
legacy `_9` LCC package to LCC2. The saved 1600×900 frame shows the Grand Hall
interior with a continuous timber floor, timber panelling, ornate ceiling,
chandeliers, fireplace, portraits, and tall windows. This is the first genuine
visible vendor-editor view in this lane; it is not yet the deterministic native
comparison frame.

![Grand Hall rendered in the vendor editor with full UI chrome](../../artifacts/grand-hall-native-lcc-ui-evidence/grand-hall-native-lcc-ui-full-1600x900.png)

The complete machine-readable record is
[`grand-hall-native-lcc-ui-evidence-v1.json`](../operations/grand-hall-native-lcc-ui-evidence-v1.json).

## Exact evidence

| Field | Frozen value |
| --- | --- |
| Machine receipt | 14,917 bytes · SHA-256 `3cd6d5d788a38f4a9c8483ef2107a8082782a0242ce1e57f0fa7379f51e6eb63` |
| UI PNG | 1,824,870 bytes · 1600×900 · PNG · `Format32bppArgb` |
| UI PNG SHA-256 | `2e4dfe18a951a5764c09a7d3fcdbb2d0f32085b8d5eb46df9c7a11f53c89e12f` |
| Canonical legacy package | 11 files · 1,127,138,769 bytes |
| Canonical package digest | `d4f98368b737857038cab3fe2ac439057484b304ef0215abb649a6bc606f16a3` |
| Scratch clone | 11 source members, byte-for-byte identical after conversion |
| Vendor LCC2 output | 60 files · 214,350,601 bytes |
| LCC2 output inventory | 24 SOG, 16 PLY, 16 BTREE, 1 LCC2, 1 JPG, 2 JSON |
| Post-run adapter build | live source and 890-file runtime closure verified; tests passed |

The Windows operator-inventory digests are
`9575bcadea5bcf8989bd96a27e2006390c32d9017076435c322f00ea13365f2f`
for both the source and scratch-original records, and
`08cfb58808f73f878b6b817de2fdc3ddf1bf0af7963b99dd8addeaf40d1ffca8`
for the converted LCC2 tree. Those two digests retain Windows backslashes in
their compact-JSON preimages and are deliberately labelled Windows-specific,
not cross-platform canonical.

## Capture and settings boundary

The editor's settings UI visibly showed `Ultra Quality`, `Direct12`, and frame
lock `On` before capture. Those values were operator-observed; they are not
programmatically attested and do not appear in the final PNG. The native
snapshot control did not emit a file, so the evidence was captured honestly as
an active-window screenshot: `Alt+PrintScreen`, paste into Paint, crop only the
unused Paint canvas outside the selected 1600×900 raster, then lossless PNG
save. The vendor UI chrome remains visible. No post-capture resampling, colour
adjustment, or generative image operation was used.

In this single frame, no facade, neighbouring room, or large dark central floor
patch is visible. That observation is not a whole-scene claim: one view cannot
prove that every camera is artifact-free or that every visible surface is
architecturally complete.

## Source mutation boundary

The original package under `C:\GRAND_HALL_BIG_MODEL_VARIATIONS` was not used as
the conversion target. All conversion output went beneath the disjoint local
scratch root. After the visible run, the adapter build re-opened the canonical
source, matched all 11 locked files and 1,127,138,769 bytes, verified the full
runtime closure, and passed its tests. The post-run build-receipt SHA-256 is
`1f1ddba519fded0d0078e5a32d02c46f788b18c145b52cc2afc51c2cb82b7548`.

## Why the unattended capture did not produce the frame

The prior unattended adapter run reached its fixed 900-second wall-clock limit,
terminated the disposable editor process tree, and produced only its operator
receipt. It produced no native PNG and no native in-process receipt. The
operator-receipt SHA-256 is
`64ebad704c7c48133ee3402583f11261b7acc5cc4a7e777acda6cfe2a0581f24`.

Subsequent read-only inspection found that editor module discovery consulted
`FeatureToggleService.IsEnabled(manifest.Id)` before assembly load. The custom
ID `com.venviewer.native_capture` was absent from the ten stock IDs, so the
module was not loaded; the positional `.lcc` argument was also ignored. This is
a diagnostic root-cause finding, not an assertion from the failed native
receipt. No editor patch, stock-module impersonation, or licensing bypass was
used.

The adapter bytes themselves remain stable: module
`3465b1c62a1ffae305f373cf873557d04e33ee374cfa668f6511939d0f1d946d`,
plugin
`59df0cc71d9c8ccae6365f2e144bc62281b5cfdcedb53278b1cdc8aef174ec89`,
closure lock
`f3ced55c3bd215fbc8bba49be453829d67d689a6a42d2f3a338eff2a0d95cec5`,
and 890-member closure inventory
`e76dae03144f07e47c1600582ac6a15b19a21812c5648e0c864f86b61f328cf8`.

## What this does not authorize

This frame has no deterministic camera receipt, recovered source-camera pose,
projection receipt, or convergence proof. It grants no training, runtime,
staging, deployment, publication, measurement, collision, export, or
architectural-truth authority. It cannot enter the matched-camera SOG/SPZ/LCC
quality ranking until the native lane produces a receipt-bound camera-only
frame.

The first-party build receipt says the build used no network. The visible run
used the vendor editor and retained no packet capture, so this report makes no
claim that the vendor process was network-silent.
