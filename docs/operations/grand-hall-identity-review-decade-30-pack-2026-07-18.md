# Grand Hall identity review — decade-30 evidence pack

**Status:** `AWAITING HUMAN REVIEW — NOTHING IN THIS PACK IS REVIEWED OR APPROVED`
**Created:** 2026-07-18 (Foundry phase-1 goal, gate-closure preparation)
**Extends:** `grand-hall-review-gate-intake-2026-07-13.json` → `identityAttestation`

## Why this pack exists

The recorded identity review (decision "B": sweeps 0/10/20/40 confirmed, sweep 49
excluded) sampled no sweep from the 30s decade, so a capture path that left the
Grand Hall between sweeps 21 and 39 and returned would evade it. The phase-1
gate requires a sample from **every** decade of 0–49. This pack pins the exact
decade-30 review subject so a reviewer can close that gap in one sitting. It
marks nothing reviewed; it only fixes what would be reviewed.

## Review subject

The 60 files `scan_030_*` through `scan_039_*` (six cubefaces per sweep) under
`F:\E57\colmap_v2\images`, byte-pinned below. SHA-256 over exact file bytes,
computed read-only 2026-07-18.

## Lineage statement (verified vs unverified)

- **Verified:** `F:\E57\cloud_0.e57` (20,518,437,888 bytes, ASTM E57) embeds
  894 pinhole cubefaces at 4096×4096 — six per scan for all 149 scans. The
  review-subject files are 1024×1024 JPEGs named per scan index and face and
  are the same set the registered COLMAP reconstruction (231/300 cameras)
  consumed.
- **Unverified:** the byte-level derivation chain from the E57-embedded
  4096×4096 faces to these 1024×1024 JPEGs (resampling tool, compression
  settings, any colour transformation) is not established. Per the T-507
  audit, source compression/lineage must remain explicit.
- **Consequence for the signature:** a reviewer signing on this pack attests
  to **room identity of the derived JPEG set** with the lineage caveat above.
  If the reviewer requires identity attested against the E57-embedded bytes
  themselves, tick option (b) in the scope section and the pack must be
  regenerated from an E57-side extraction before signing.

## Reference basis

Compare against the venue's officially published Grand Hall characteristics
(21 m × 10 m × 7 m hall with dome) and the reviewer's own knowledge of the
room. Third-party reference photographs may be consulted but must NOT be
embedded or hashed into this pack until the intake's `identityReferences`
rights section is resolved (`requires_written_permission_or_replacement`).

## Attestation template (all fields intentionally blank)

Completing and signing this section — or recording the equivalent decision in
an append-only platform audit event — is the human act this pack prepares.

- authenticatedReviewerSubject: ______
- reviewerRoleAndVenueAuthority: ______
- knowledgeBasis: ______
- exactEvidenceIndexSha256: sha256 of the "Byte-pinned inventory" block below, computed at signing time: ______
- exactCubefaceAndReferenceSha256Values: the 60 values below, plus any reference hashes once rights-cleared
- completeNodeOrSweepScopeDecision — tick one:
  - [ ] (a) identity attested on the derived JPEG set for sweeps 30–39, lineage caveat accepted
  - [ ] (b) E57-side extraction required before attestation
- perSweepVerdict (30–39, each `grand_hall` / `not_grand_hall` / `uncertain`): ______
- reviewedAt: ______
- signatureOrAppendOnlyPlatformAuditEvent: ______

## Byte-pinned inventory (60 files, SHA-256, filename)

```
9ba0ca2b492f7fb0ae3e350ed62c19d840abead2c2a05f347836d95e5fcb8e4c  scan_030_back.jpg
de8f74653402ad3429d177f2d10c54fe184a0110cd3bfed55bf676e9d0fcfaea  scan_030_down.jpg
0799b7e71740c05619ef1b9beab0a59f208a6085ac3a9e059acf782087345de7  scan_030_front.jpg
4226cdda82f5ca51bed7821ea28fded4ee867a14f1c2cc12651bce46ca39c0be  scan_030_left.jpg
1e1476e45f55bbddebb2bf2c3621f8629a6366415acfad7ea8bde3c3ab96bfe9  scan_030_right.jpg
a794abe4aeb93b3d3bbd58db5ca70d876b6584dd2b51ebefbc5797228ef03d42  scan_030_up.jpg
8ed649231fd82ff4dceefda69b30cc39cd6146e352ec966221bab4969b520bdb  scan_031_back.jpg
af07104f1e3e7988664e2bb98b366f77134a3adcfb4f3bf3403d2ddd5fb093c9  scan_031_down.jpg
a0a5426811b630e9b00ce4c244e3bfbe09cdf6ed260dec66d8a00cd1f5c6c9ce  scan_031_front.jpg
79ace131137351cb013d9f01e1252ffaf9336e59b33485263042a022663fc4a6  scan_031_left.jpg
a08fbc6a6ecf4c91c377d8bda5e798a6ae520a22e871a25b042af83e0930c675  scan_031_right.jpg
8744cf2e47c728a625c509c4c751c3f02bd44b0a3f0e0ce6e439f675b48efd5f  scan_031_up.jpg
7221532436410a042a6fa8de0f3d86f09e8a9a854f11cb368dad842fd39623ac  scan_032_back.jpg
7087628e090b690e04f2a3f8e5a46e313e15c0d8378287f5fca0416173490b60  scan_032_down.jpg
42911a48e1d1b19616c0bb62a9043c3d98083da088066a1849d91b5e0f7ee244  scan_032_front.jpg
e0b19cd54a4f73e7f592f4651b73df85bed3ddf4027c2e9358d8798d7d8cc5b2  scan_032_left.jpg
fed4e71816f75365d4d1377eaaef2dec85fa91db30efe1b3f47181c64876147c  scan_032_right.jpg
a441a11d7deb42a85e4df02b0a7c05d63a7a563faa3336a65bbba117eb09ac95  scan_032_up.jpg
b1a826f1d6b230a810c4cac10cd9fb73bd378596a623634e76f1914c9ee54373  scan_033_back.jpg
5fbc78a426ccbee92361223f2a763b15be4e4a2be5aaa996afb0319a267bb6a3  scan_033_down.jpg
aac7463c9269852a8a0c0056deec8b01a182c600bd2d11bb6e4252ada8bbf270  scan_033_front.jpg
ce9915e80228599b6f4aff0340e0a0b3e6b32a3809f71a258979d4fbf97e2d72  scan_033_left.jpg
07858eb6dd51071b44f06d596d9708b657029acea6a15121cdc06b1459664ad8  scan_033_right.jpg
1e43cfbed9aa32b8059c894f9bd1a7adbba6b30aa5972d8659dad7a779a17944  scan_033_up.jpg
43d0d3634c1579e5f986d52720a6a61d426b957e6e235742de39d53246962a19  scan_034_back.jpg
ffcb14a10c5abbff2db9a78c7e60324e7200ae6e1503c9ceb453c5bb9e8b794c  scan_034_down.jpg
3adc25a06637de0cf8beb271cc5976b0efdf6ea043083abd4494661641ce89c9  scan_034_front.jpg
c283e42be1e0d9abd0c7342be9812f76ef1603dd3ea0be6cc34104dec5f24dd3  scan_034_left.jpg
6de2aa8958a2fef61818b9b511a79b456a1dcf90ee60f7620d6eeed6e941b689  scan_034_right.jpg
789242dbfb709d9f28dec8cb5e41d54d012783ebca72e37364b3da8c49995569  scan_034_up.jpg
14ddb32dc71a56a1eef3dea6593d13a8fd2cc04a7e787b5044b35205343cfd6e  scan_035_back.jpg
63e4b278b01a29f3d74b692cd8b9c3c3905d288c9af02b7f6e832400ed9af750  scan_035_down.jpg
e4c5cf0ccb97de74fb227946191a75cbbf3206efc83a7e10d42557e289cd9ee5  scan_035_front.jpg
9303e2ac75b866a64a01ff5c9edd2f3192c1d050c56f47714ec76dff280538ad  scan_035_left.jpg
263a1f09adbe63058b25b0a492b8b7c2c0fccc601c190fe436fbf791c72545fb  scan_035_right.jpg
3b8302ed634fbe5747a26a2d7a55b48efe119044a090a860fcfbb1981d85a27c  scan_035_up.jpg
5f60b604c12f05f44253c05822a9b5c639ea4b3563333c4d236070718e205512  scan_036_back.jpg
0e5f8d1a0ebc1d21641218a2e10f26d45aac6f57f9b740719f2c55af1b0519e6  scan_036_down.jpg
15607911fb8406d82f8e2247a71ea35a4e40876923492c237e0230167b0d508d  scan_036_front.jpg
0714a1ba76904659e721ae8f097325192970153da35265abf40875779fe7a062  scan_036_left.jpg
6dc216dac085ba7004e703eee230248bd329103ee955f1708d6501191059820d  scan_036_right.jpg
10d21bfb109161a47b3d62e912d9e7eca19772ac3b9fcec230b32f1a496bdd1d  scan_036_up.jpg
aa2c0e468eff4b49ca1559621e12374d7df2fb43df906c14f8bff3f0e67603fc  scan_037_back.jpg
878b3abb9de43f97a709e53a59199d3ead50460d11f1a03bc8140f5dfbf39d5f  scan_037_down.jpg
ba23e62b78aba7b0cbe7519188bb6d8f3877ac591947f11f414068ea5414ffcb  scan_037_front.jpg
a5b2dfd2c03ca60428a9d107fd2b7606bf747582064d4ab086aac91514700f7b  scan_037_left.jpg
8c9f52cd6eeb617faef7ad4c4e475d847810b6cb4533e82dd36a7e2c5734a926  scan_037_right.jpg
99f0a3c2035f0d4bf52a69aa99b18e0a70c97ae3588ac0fdb2f8ca3a5b0dce97  scan_037_up.jpg
e64a13b40729e14b466caedf302d2010994400a303f619c494d2edf8ffe6b772  scan_038_back.jpg
f9c7c5fe5c379e86e7273812069e233a3383d028c99de07343ddf5666892254a  scan_038_down.jpg
8a15614ce096ab92ebe4c81c07e70dce5202b3eca88cd0bbf9041a652c4e9577  scan_038_front.jpg
e1d4975e69230b8cdd825eac697dd566ce768e35d386b9e2b07e3a83c0b75e10  scan_038_left.jpg
d80cf88b8070fc4b52b53431390f1a46e46a122afe518bb19d4a41d2d8fb4bd9  scan_038_right.jpg
7f1557062cec228f22af89aa624b464ba5206ba75cf254960c2dc67fa970aa3f  scan_038_up.jpg
93d6d0ccc0ac832e163879416bc42896fa18c13e3859d51da15d6abd8acc0c08  scan_039_back.jpg
e654c3d8a3a86e9f86b47b9576ee74098a5fd7b73b44a2063a69965379c4a708  scan_039_down.jpg
ff189ab0012b50421bf1a26728abbce9853dfed053d5107542fc6d8581abc37a  scan_039_front.jpg
c4a2784750584b72b8d78f89442a1c5044df3b9de38e04064d533b3ec3829047  scan_039_left.jpg
f25041cb996b938744aaca8e6ee81f85dc5c887a080657d535a7da50d7847fad  scan_039_right.jpg
5428b53a56c962e8e9aefdc7ffdcf144f1bbb1d01cbed547142538ae74d08bf7  scan_039_up.jpg
```

## What remains after this decade is reviewed

Per the intake, signing this pack closes only the decade-30 sampling gap. The
gate as a whole still needs: the authenticated attestation fields above for
the ORIGINAL 0/10/20/40/49 review (or one combined re-review), the 8 fit
controls + 6 blind checks with survey metadata, the release-scope decision
(whole-release vs bounded Grand Hall), and the Matterport / identity-reference
rights decisions. Sweep 49's exclusion in decision "B" stands until a reviewer
supersedes it.
