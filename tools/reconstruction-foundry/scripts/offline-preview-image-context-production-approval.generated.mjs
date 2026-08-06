/**
 * Build-owned production allowlist generated from the reviewed worker artifact.
 * A null seccomp digest deliberately keeps production context generation closed.
 */
export const OFFLINE_PREVIEW_IMAGE_CONTEXT_PRODUCTION_APPROVAL = Object.freeze({
  schemaVersion:
    "omnitwin.reconstruction-foundry.offline-preview-image-context-production-approval.v1",
  approvalKind: "build_owned_generated_production",
  artifactManifestSha256:
    "sha256:c28e80c5db8c724eb4ba7a1c4e60d2e8aa22f597d0f87fa5060fd958f5b33725",
  buildGraphSha256:
    "sha256:0b7fdf7674cdd0645d268e241908f93077c7d952c99db87db554fd9c67f80d77",
  workerBundleSha256:
    "sha256:de2e5a92f9a9b08352fe54fa0ac9c423c4eb6fe8c3e27c88744df82a63870cea",
  seccompProfileSha256: null,
  buildGraphInputs: Object.freeze([
    Object.freeze({
      path: "node_modules/.pnpm/@gltf-transform+core@4.3.0/node_modules/@gltf-transform/core/dist/index.modern.js",
      sha256: "sha256:da6293b2532d875f41dfd6ce72b3aec5a973375fe029d32d216e918e3415c458",
      sizeBytes: 231479,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/@gltf-transform+extensions@4.3.0/node_modules/@gltf-transform/extensions/dist/index.modern.js",
      sha256: "sha256:cadbccd148a4b5dcbcb2d8370981d23585e01c7a16e6b5c170cdf65acb02272a",
      sizeBytes: 210410,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/gltf-validator@2.0.0-dev.3.10/node_modules/gltf-validator/gltf_validator.dart.js",
      sha256: "sha256:b73a7b2d455ac217567725138b46d826a13d7d1bb0c88c15f7c571bfb349298c",
      sizeBytes: 307792,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/gltf-validator@2.0.0-dev.3.10/node_modules/gltf-validator/index.js",
      sha256: "sha256:78deff9ea85743e86461c2d14fae76e7fc3ca0432e652f62948066b55fa16f0d",
      sizeBytes: 2829,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/ktx-parse@1.1.0/node_modules/ktx-parse/dist/ktx-parse.modern.js",
      sha256: "sha256:56248dd988dc5a87e486d9d794e0e481b4a66db605afa9ef81b3bf1bd0bc8432",
      sizeBytes: 40532,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/index.js",
      sha256: "sha256:0afb975db2733391c2d0cabfbe707ee6d9a9651dddc221aeda5d819379958a89",
      sizeBytes: 199,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_clusterizer.js",
      sha256: "sha256:633b7fd92c308b830e62f36d2a5d45a67ad806df8a80d53f54a3ad282eff590d",
      sizeBytes: 32101,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_decoder.mjs",
      sha256: "sha256:cb08bf53ad8ad9693d8bb759b2dbade350eb38bcce63d005385e225b564c5f6a",
      sizeBytes: 29059,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_encoder.js",
      sha256: "sha256:f82f201a778333291ba1ca63035321f1c6d2770ef52d219e69e13f6cb2098429",
      sizeBytes: 24348,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_simplifier.js",
      sha256: "sha256:c77634874ca565e1445bbb140c1a626ae8f4c71d7fa69e332806955fb1337824",
      sizeBytes: 55177,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_tangents.js",
      sha256: "sha256:fccccf8a37f4ed32b8d3980d3901959a47bd4a4e0703e77d6e5202098b6086af",
      sizeBytes: 10102,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/property-graph@4.1.0/node_modules/property-graph/dist/index.mjs",
      sha256: "sha256:e02a6661824ee4c5c3d0e036f4b66c84fa0e97ba1e5a1af815fa75c07e9d124d",
      sizeBytes: 16685,
    }),
    Object.freeze({
      path: "node_modules/.pnpm/zod@3.24.2/node_modules/zod/lib/index.mjs",
      sha256: "sha256:f4587d736f8f981db3f0234b944e70acd8b1eb7b9a5152b533ff9fc1e5cfebd2",
      sizeBytes: 156989,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/canonical-json.ts",
      sha256: "sha256:0e0b8ec742ee60fb49702d56a42366b6a98da169d8eaac1700e9a16803d53074",
      sizeBytes: 2582,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/dsse.ts",
      sha256: "sha256:ab58c1a2ab41ae38e584d2046966e01bd0082981f5d0302b33048772cf44d720",
      sizeBytes: 2914,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/errors.ts",
      sha256: "sha256:b16deaa1f450beac972a01bfae930451fbc15735e7cde06c127abe2b40d4b5d1",
      sizeBytes: 379,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/hash.ts",
      sha256: "sha256:3208dca57440fbb89947fe876d331bfcc8fd3797709346550182b00ba826f25d",
      sizeBytes: 6471,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/normalize-mesh-glb-worker.ts",
      sha256: "sha256:44ba4666c777d05a941dcd4541d2271ca29b885a931047d9f08358bc35c03a9e",
      sizeBytes: 55498,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.ts",
      sha256: "sha256:e8fe93d7d375c283764af21a909e00fc9bb09e11e73702068a0a8c429047fa42",
      sizeBytes: 38899,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-worker.ts",
      sha256: "sha256:abbbd6a8a445231c3d144706c3a581ccd1b1695f65548294c5cbde7f1c153005",
      sizeBytes: 7134,
    }),
    Object.freeze({
      path: "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.ts",
      sha256: "sha256:41d925afa86fdf5de8bde3a5110711ac2a305c9c1be784d45d8641eb023d5e66",
      sizeBytes: 32246,
    }),
    Object.freeze({
      path: "packages/types/dist/reconstruction-dsse.js",
      sha256: "sha256:2cafc858a2dac0628186206a3bba113b785a9581af751430753353923c9548f5",
      sizeBytes: 1927,
    }),
    Object.freeze({
      path: "tools/reconstruction-foundry/src/offline-normalization-preview-container-entry.ts",
      sha256: "sha256:f9949680bff321e2a20f9c2430e23e1a1ef3079aa5a9a5facaa647fad28e3a54",
      sizeBytes: 7517,
    }),
  ]),
});
