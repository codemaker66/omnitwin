# OmniTwin Foundry real-input check — 2026-07-13

This is a read-only safety check. The tool opened each source only to identify
and hash it. It did not copy, convert, upload, reconstruct, or approve any file.

## Result in plain English

| Real source | What the tool found | Safe result |
|---|---|---|
| 20.5 GB E57 venue scan | E57 point-cloud container | Recognized, but **not approved yet** because source rights and history still need a person to confirm them. |
| 8.7 GB XGRIDS PortalCam file | High-confidence proprietary XGRIDS XBIN container | Recognized, but **not approved yet**. The payload remains closed/opaque, and rights and history are unreviewed. |
| 38.4 MB Matterport OBJ | Medium-confidence OBJ mesh | Recognized, but **not approved yet** because rights and history are unreviewed. |
| 208 KB XGRIDS preview photo | An image, but its exact capture role is ambiguous | Held for review. A filename and JPEG header cannot prove whether it is a phone photo, panorama, Matterport image, or another image role. |

None of the four files was eligible to enter a release manifest. This is the
intended fail-safe result: recognition is not the same as permission or truth.

## Reproducible evidence

| Source | Bytes hashed | Source SHA-256 | Receipt SHA-256 | Intake time |
|---|---:|---|---|---:|
| `cloud_0.e57` | 20,518,437,888 | `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd` | `6eddf4a3f62f91febc6e84231da9c6afd791c82525d49680846a803545f9a4fc` | 216.67 s |
| `2026-06-01-150618.xbin` | 8,696,471,552 | `625d942745db807e26841c9e86f10fa9f93b9f276c56e7fd312b094d3f16b565` | `35bd380a7cc67e62ce768c35595dd0600828ee61a09ab18de3959917b374411b` | 94.75 s |
| `424ff41f6e5d41969c635fcd61be9b3f.obj` | 38,381,816 | `cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7` | `88d9eb0c7c7d78f510a0d8dd2f92f3e0fdc7e5cc425c2d400273c72390418fde` | 2.73 s |
| `preview_photo.jpg` | 208,529 | `5b91c0ec0506ba711cd9fc040be202aea7de3b5d3d9725e48467ef36b2aee5ee` | `bcb13d840057ca91c1d93a6ab609d58afaa407f0c6f759a56f2a9fdbccda7b86` | 2.54 s |

## What this proves—and does not prove

It proves that the current intake foundation can safely identify and hash these
real local files without mutating them, and that it fails closed when a format,
rights record, or provenance record is not good enough.

It does **not** prove that XBIN can be decoded, that any source may be used for
commercial training, that the OBJ is metrically correct, that the photo's role
is known, or that a reconstruction will be visually better.

## Local companion smoke check

The loopback companion was then started programmatically on the real
`preview_photo.jpg` source and queried through the same HTTP surface used by its
browser page. It reached `ready`, reported one file, exposed only the safe label
`preview_photo.jpg`, contained no private absolute source path, accepted the
authenticated same-origin stop request with HTTP 202, and left no listener on
the test port. This proves the local screen can complete one real small-file
inspection; it does not substitute for the separate 8.7 GB XBIN or 20.5 GB E57
CLI hash results above.
