"""Verify the 22 July 2026 Reception investigation snapshot and its five artifacts.

This deliberately date-pinned verifier checks completeness and consistency. It
does not read raw venue assets, protected references, or LCC project data, and
it deliberately does not turn a decision-ready investigation into a claim that
the product-quality goal has passed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable


REQUIRED_ARTIFACTS = {
    "rootReport": Path("docs/reports/reception-room-hd-root-investigation.md"),
    "evidence": Path("docs/reports/reception-room-hd-evidence.json"),
    "fixedViews": Path("docs/reports/reception-room-fixed-view-manifest.json"),
    "decisionMatrix": Path("docs/reports/reception-room-quality-decision-matrix.md"),
    "strategyPatch": Path(
        "docs/reports/reception-room-splat-quality-strategy-patch-list.md"
    ),
}
EXPECTED_ARTIFACT_SHA256 = {
    "rootReport": "551c8d20723b12b1160f1a7228bd5db79dacb36f8fb11bc1727db78b5fff9734",
    "evidence": "1bb1f311fc6575cc68d5e77a948b99dde9423a985886148fdb18668e1ff004af",
    "fixedViews": "2a9ebe73e40ecd135758f11b7f8a673a5cf03b3e0f5e1e343b77d0fdd7fb4bad",
    "decisionMatrix": "e2eaa9e480e8d51cd7cad798f049c036bf2398c2dee1415f5c04eb4124d16777",
    "strategyPatch": "c4c769ed289516bd687670402f4fd51dc18c68e7e45643987941580604a696b6",
}

EXPECTED_CURRENT_DECISION = "no_stable_physical_or_commercial_winner"
EXPECTED_RESUME_PHRASE = "Resume LCC capture"
EXPECTED_CURRENT_DATE = "2026-07-22"
EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
EXPECTED_APPROACH_IDS = set(range(1, 13))
EXPECTED_BLOCKER_IDS = {
    "RR-LCC-HERO-CAPTURE-SET",
    "RR-INDEPENDENT-VIEWER-CAPTURE-SET",
    "RR-ACTUAL-ROUTE-CAPTURE-SET",
    "RR-E57-CROP-CONFIRMATION",
    "RR-E57-METRIC-CONTROL",
    "RR-PHOTO-METRIC-CONTROL",
    "RR-XGRIDS-OPEN-EXPORT",
    "LEGAL-RIGHTS-MEMO",
    "LEGAL-SOURCE-SNAPSHOT-SET",
    "CAPTURE-RIGHTS-PACK",
    "RR-PILOT-CLI-BUNDLE",
    "RR-TRAINER-RUNNABLE-BUNDLE",
    "RR-RUNTIME-DEVICE-MATRIX",
    "RR-ROLLOUT-REPLICATION-GATE",
}
EXPECTED_RAW_ITEMS = {
    "frame availability",
    "frame format",
    "camera count",
    "image dimensions",
    "timestamps",
    "pose source",
    "pose coordinate frame",
    "intrinsics",
    "distortion",
    "point cloud",
    "depth",
    "LiDAR alignment",
    "calibration",
    "firmware/software version",
}
EXPECTED_PIPELINE_CAPABILITIES = {
    "MCMC",
    "3DGUT",
    "bilateral-grid correction",
    "antialiased rendering",
    "depth supervision",
    "mixed cameras",
    "high-resolution photo inputs",
    "evaluation",
    "manifest creation",
    "runtime packaging",
}
EXPECTED_RAW_STATES = {
    "frame availability": "preview_only_requires_vendor_sensor_frame_export",
    "frame format": "indeterminate_proprietary",
    "camera count": "four_labelled_event_sources_optical_count_unverified",
    "image dimensions": "indeterminate",
    "timestamps": "verified_event_and_trajectory_timestamps",
    "pose source": "verified_poses_csv",
    "pose coordinate frame": "indeterminate",
    "intrinsics": "encrypted_or_requires_vendor_export",
    "distortion": "indeterminate",
    "point cloud": "decimated_preview_and_vendor_reconstructions_only",
    "depth": "indeterminate_or_embedded",
    "LiDAR alignment": "encrypted_or_requires_vendor_export",
    "calibration": "encrypted_or_requires_vendor_export",
    "firmware/software version": "verified_in_json_metadata",
}
EXPECTED_PIPELINE_STATES = {
    "MCMC": "named_but_not_wired",
    "3DGUT": "partial_broken",
    "bilateral-grid correction": "missing_dependency_and_output",
    "antialiased rendering": "claimed_not_end_to_end_verified",
    "depth supervision": "partial_broken",
    "mixed cameras": "limited_unverified",
    "high-resolution photo inputs": "unproven",
    "evaluation": "broken",
    "manifest creation": "not_enforced",
    "runtime packaging": "manual_separate",
}
EXPECTED_REPORT_RECEIPTS = {
    "method-specific holdout": (
        "docs/reports/reception-room-e57-method-holdout-cv-2026-07-17.md",
        6262,
        "efcd497304cfb3b507e31b900b75e155bdb8f6b3ae0b97df5fb2168273195977",
    ),
    "no-reference IQA": (
        "docs/reports/reception-room-no-reference-iqa-2026-07-22-receipt.md",
        4230,
        "f7f5fd754ea446751669cedd706e8b731ad25f62b88f19610d6383462e48b3ce",
    ),
    "artifact diagnosis": (
        "docs/reports/reception-room-cv-artifact-diagnosis-2026-07-18-receipt.md",
        10317,
        "7c3f925c67ffecc325d4cc8431a42012e2c6b9f123dfdacc3fa97235cb97bb65",
    ),
}
EXPECTED_ASSET_RECEIPT_DIGEST = (
    "a524033be52d58725122e96893e72abb94d43b90fdeb920a5f31282f93ec01c1"
)
EXPECTED_SCREENSHOT_RECEIPT_DIGEST = (
    "1cbc742ecfa32f884a4f595ca2ec405e9aed2791b72794ecbc4fb793e11cfd9e"
)
EXPECTED_TRIAGE_CANONICAL = {
    "reportSha256": "7f3e11b92ee6a2c60ca13a5391b02a319f25dda80de7db3f8ff61a442ae3fe99",
    "fileSha256": "bf824e25d7c8a7750fa5a5aef5964b96b6559de3ab7dc5e106d9e8a50678b5a7",
}
EXPECTED_TRIAGE_FILES = {
    "evidenceRef": (
        "docs/reports/reception-room-captured-quality-comparison-v0-evidence-2026-07-18.json",
        "evidenceSha256",
        "008f3dfec922d055c57801a9d85315b666f08b7f784a5c961118da7370ac0f4a",
        "triage evidence",
    ),
    "report": (
        "docs/reports/reception-room-captured-quality-comparison-v0-report-2026-07-18.md",
        "reportSha256",
        "3c7503f7d605ddf3cddf0b74beee110d9cd34d9da11d4f17a48f52c8376e61b6",
        "triage report",
    ),
}
EXPECTED_POST_CAPTURE_RUN_IDS = {
    "reception-local-real-component-2026-07-16",
    "reception-captured-quality-triage-2026-07-18",
}
EXPECTED_CURRENT_INTERPRETATION_KEYS = {
    "candidateDecision",
    "controllingEvidenceRef",
    "historicalCaptureReceiptsChanged",
    "plainLanguage",
    "nextDecisiveCapture",
    "lccCapturePaused",
    "requiredExactResumePhrase",
    "protectedReferencesReadForThisReconciliation",
}
EXPECTED_CURRENT_INTERPRETATION_DIGEST = (
    "766946a7d0fb84b3d0a74fa91d50848ea6371ef7f94de142fb7d6fe0fdd1bde2"
)
EXPECTED_NEXT_CAPTURE_DIGEST = (
    "b6b0d5ed84aff3132de47a920d976cfc8842db98d969ac8a7a3b47e5023051a1"
)
EXPECTED_CROSS_CONTEXT_KEYS = {
    "status",
    "blockerIds",
    "outputRoot",
    "featureCodes",
    "contexts",
    "historicalDiagnosticControls",
    "sidecarPattern",
    "sidecarRequiredFields",
    "cameraRule",
}
EXPECTED_CROSS_CONTEXT_BLOCKERS = [
    "RR-INDEPENDENT-VIEWER-CAPTURE-SET",
    "RR-ACTUAL-ROUTE-CAPTURE-SET",
]
EXPECTED_CROSS_CONTEXT_IDS = [
    "independent-ply-sh3",
    "independent-sog-sh3-fine",
    "independent-sog-sh0-fine",
    "independent-spz-sh0-fine",
    "actual-mobile-fine",
    "actual-quality-fine",
]
EXPECTED_HISTORICAL_CONTROL_IDS = [
    "diagnostic-mobile-all-invalid",
    "diagnostic-mobile-coarse",
]
EXPECTED_CROSS_CONTEXT_DIGEST_WITHOUT_OUTPUT_ROOT = (
    "9c9b54214cd09445fa180abc0359c68a80d89de025b6a3b1aae6f9db53b04f30"
)
EXPECTED_REPLAY_KEYS = {
    "status",
    "historicalOnly",
    "authorizationState",
    "requiredExactResumePhrase",
    "historicalServerCommands",
    "historicalBrowserCommands",
    "runRule",
}
EXPECTED_REPLAY_DIGEST = (
    "3f5b4c5d5230dbc2b8854b2975f37dff55950bbd559bad8005621156cfff07eb"
)
EXPECTED_RECONCILIATION_KEYS = {
    "asOf",
    "authority",
    "currentDecision",
    "plainLanguage",
    "historicalReceiptRule",
    "methodSpecificHoldout",
    "noReferenceIqa",
    "artifactDiagnosis",
    "controllingConclusion",
    "currentAction",
    "protectedReferencesReadFor2026-07-22NoReferenceAddenda",
}
EXPECTED_CURRENT_ACTION_KEYS = {
    "lccCapturePaused",
    "requiredExactResumePhrase",
    "staticTest",
    "motionTest",
    "heldoutExecutionAvailable",
    "heldoutBlocker",
}
EXPECTED_CURRENT_ACTION_DIGEST = (
    "45233572da6a81bd50c86730d997c874a6e2b17d0c5ffc175f96d619f9674c72"
)
EXPECTED_SOURCE_PHOTO_ID = "RR-ORIGINAL-SOURCE-MATCHED-COMPARISON-V0"
EXPECTED_SOURCE_PHOTO_STATUS = (
    "source_view_diagnostic_implementation_proved_generated_inputs_only"
)
EXPECTED_SOURCE_PHOTO_AUTHORITY = "diagnostic_only_never_selects_quality_or_mobile"
EXPECTED_SCORER_TEST_COUNT = 38
EXPECTED_BROWSER_HELPER_TEST_COUNT = 26
EXPECTED_SOURCE_PHOTO_KEYS = {
    "schemaVersion",
    "id",
    "asOf",
    "authority",
    "status",
    "plainLanguage",
    "scorer",
    "browserHelper",
    "rendererCapture",
    "operatorGuide",
    "sourceViewDecisionAuthority",
    "heldoutExecutionAvailable",
    "heldoutBlocker",
    "trustedHeldoutRunnerAllowlistEmpty",
    "realVenviewerTelemetryWired",
    "realReceptionRunCompleted",
    "productWinnerEnabled",
    "receiptsAreIndependentAuthentication",
    "receiptBoundary",
    "lccReadOrResumed",
    "protectedReferencePixelsRead",
    "cloudPaidDeployOrPublicationAction",
}
EXPECTED_SOURCE_PHOTO_SCORER_KEYS = {
    "path",
    "sizeBytes",
    "sha256",
    "testPath",
    "testSizeBytes",
    "testSha256",
    "passingGeneratedTests",
    "allFunctionsAtMost50Lines",
}
EXPECTED_SOURCE_PHOTO_BROWSER_KEYS = {
    "path",
    "sizeBytes",
    "sha256",
    "testPath",
    "testSizeBytes",
    "testSha256",
    "passingGeneratedFixtureTests",
    "proofBoundary",
}
EXPECTED_RENDERER_CAPTURE_KEYS = {
    "schemaVersion",
    "authority",
    "developmentRealComponentRouteWired",
    "runtimeBuildDigest",
    "runtimeBuildInputCount",
    "runtimeEnvironment",
    "runtimeEnvironmentDigest",
    "runtimeEnvironmentBoundToPlanPerRun",
    "runtimeInputBytesRecheckedPerFrame",
    "runtimeInputSetReenumeratedBeforeAndAfterEachFrame",
    "runtimeInputSetChangesRejected",
    "installedRuntimeVersionsRecheckedPerFrame",
    "liveCodeUpdatesBlocked",
    "savedFrameEvidenceRecomputable",
    "captureAdapter",
    "bindingManifest",
    "runtimeBuildHelper",
    "generatedSparkE2e",
    "proofBoundary",
}
EXPECTED_RENDERER_ARTIFACT_KEYS = {"path", "sizeBytes", "sha256"}
EXPECTED_RENDERER_E2E_KEYS = {"path", "sizeBytes", "sha256", "passingTests"}
EXPECTED_SOURCE_PHOTO_GUIDE_KEYS = {"path", "sizeBytes", "sha256"}
EXPECTED_PREPARED_LOCAL_COMPARISON_KEYS = {
    "schemaVersion",
    "id",
    "asOf",
    "authority",
    "evidenceRecord",
    "status",
    "sourceViewDecisionAuthority",
    "browserHelperProofBoundary",
    "scorerPassingGeneratedTests",
    "browserHelperPassingGeneratedFixtureTests",
    "realVenviewerTelemetryWired",
    "heldoutExecutionAvailable",
    "heldoutBlocker",
    "trustedHeldoutRunnerAllowlistEmpty",
    "realReceptionRunCompleted",
    "productWinnerEnabled",
    "receiptsAreIndependentAuthentication",
    "receiptBoundary",
    "lccReadOrResumed",
    "protectedReferencePixelsRead",
    "cloudPaidDeployOrPublicationAction",
    "operatorGuide",
}
EXPECTED_SOURCE_PHOTO_BOUNDARY = {
    "schemaVersion": "venviewer.reception-source-photo-comparison-evidence.v2",
    "id": EXPECTED_SOURCE_PHOTO_ID,
    "asOf": EXPECTED_CURRENT_DATE,
    "authority": "none",
    "status": EXPECTED_SOURCE_PHOTO_STATUS,
    "sourceViewDecisionAuthority": EXPECTED_SOURCE_PHOTO_AUTHORITY,
    "heldoutExecutionAvailable": False,
    "heldoutBlocker": "no independently reviewed and allowlisted renderer-owned capture adapter",
    "trustedHeldoutRunnerAllowlistEmpty": True,
    "realVenviewerTelemetryWired": True,
    "realReceptionRunCompleted": False,
    "productWinnerEnabled": False,
    "receiptsAreIndependentAuthentication": False,
    "lccReadOrResumed": False,
    "protectedReferencePixelsRead": False,
    "cloudPaidDeployOrPublicationAction": False,
}
EXPECTED_PREPARED_LOCAL_BOUNDARY = {
    "schemaVersion": "venviewer.reception-prepared-local-comparison.v2",
    "id": EXPECTED_SOURCE_PHOTO_ID,
    "asOf": EXPECTED_CURRENT_DATE,
    "authority": "none",
    "evidenceRecord": "docs/reports/reception-room-hd-evidence.json#sourcePhotoComparisonV0",
    "status": EXPECTED_SOURCE_PHOTO_STATUS,
    "sourceViewDecisionAuthority": EXPECTED_SOURCE_PHOTO_AUTHORITY,
    "scorerPassingGeneratedTests": EXPECTED_SCORER_TEST_COUNT,
    "browserHelperPassingGeneratedFixtureTests": EXPECTED_BROWSER_HELPER_TEST_COUNT,
    "realVenviewerTelemetryWired": True,
    "heldoutExecutionAvailable": False,
    "heldoutBlocker": "no independently reviewed and allowlisted renderer-owned capture adapter",
    "trustedHeldoutRunnerAllowlistEmpty": True,
    "realReceptionRunCompleted": False,
    "productWinnerEnabled": False,
    "receiptsAreIndependentAuthentication": False,
    "lccReadOrResumed": False,
    "protectedReferencePixelsRead": False,
    "cloudPaidDeployOrPublicationAction": False,
    "operatorGuide": "docs/reports/reception-room-source-photo-comparison-v0.md",
}
EXPECTED_SOURCE_PHOTO_SUPPORT_ARTIFACTS = {
    "scorer": {
        "section": "scorer",
        "pathField": "path",
        "sizeField": "sizeBytes",
        "hashField": "sha256",
        "path": Path("tools/reception-hd/compare_source_photo_renders.py"),
        "sizeBytes": 163552,
        "sha256": "cc88205817318bee27e5a1b0201df16050c71ce92275b11399674bc4c95cc5e9",
    },
    "scorerTests": {
        "section": "scorer",
        "pathField": "testPath",
        "sizeField": "testSizeBytes",
        "hashField": "testSha256",
        "path": Path("tools/reception-hd/tests/test_compare_source_photo_renders.py"),
        "sizeBytes": 77572,
        "sha256": "972a52e909e91105af3de6780f4fd368a66507343ef488d6b2da2382ebb20ad2",
    },
    "browserHelper": {
        "section": "browserHelper",
        "pathField": "path",
        "sizeField": "sizeBytes",
        "hashField": "sha256",
        "path": Path("tools/reception-hd/run_source_photo_capture.mjs"),
        "sizeBytes": 74690,
        "sha256": "37eb2999740e40fe361f826fcf84a0e5862ab564054259c777a5e3007da29b36",
    },
    "browserHelperTests": {
        "section": "browserHelper",
        "pathField": "testPath",
        "sizeField": "testSizeBytes",
        "hashField": "testSha256",
        "path": Path("tools/reception-hd/tests/run_source_photo_capture.test.mjs"),
        "sizeBytes": 38313,
        "sha256": "4378f5a483e4b15eba59efd13dba18713f50241b59fef2d76f2c3ecb41535bf5",
    },
    "operatorGuide": {
        "section": "operatorGuide",
        "pathField": "path",
        "sizeField": "sizeBytes",
        "hashField": "sha256",
        "path": Path("docs/reports/reception-room-source-photo-comparison-v0.md"),
        "sizeBytes": 14737,
        "sha256": "0024fcab8819229f96947d875a20b4d515dc085bd280921f6aafbf8fe509c69b",
    },
}
EXPECTED_RENDERER_CAPTURE_SUPPORT_ARTIFACTS = {
    "captureAdapter": {
        "path": Path("packages/web/src/pages/living-hall/ReceptionCaptureAdapter.tsx"),
        "sizeBytes": 21234,
        "sha256": "cf9a9580bcfba4c2d003dbe7c601f589ef77a8fcbfae99d2cabc276ca50c722c",
    },
    "bindingManifest": {
        "path": Path("packages/web/src/pages/living-hall/reception-capture-binding-v1.json"),
        "sizeBytes": 2225,
        "sha256": "11d403311a51513ceda2ece850fc1f6ada83b51074bb69f94bafb0662bfd8570",
    },
    "runtimeBuildHelper": {
        "path": Path("packages/web/scripts/reception-capture-runtime-build-digest.mjs"),
        "sizeBytes": 8689,
        "sha256": "8b632312eaac8ba1ace0f3db3903c92ecb92b5e8977b161ab606e404e020301f",
    },
    "generatedSparkE2e": {
        "path": Path("packages/web/e2e/reception-renderer-capture.spec.ts"),
        "sizeBytes": 6183,
        "sha256": "7211361f267887b5ee76447a6c9626e4733a635e91cc05c9c71eafdbb9c8ab57",
    },
}
EXPECTED_RUNTIME_DELIVERY_RECEIPT_SCHEMA = (
    "venviewer.reception-runtime-delivery-hardening-implementation-receipt.v1"
)
EXPECTED_RUNTIME_DELIVERY_RECEIPT_DIGEST = (
    "cdd83b5de225b7b3957bd780ecbe6a22752dd00cb2056d3afe0d00fb4d807d66"
)
EXPECTED_RUNTIME_PROFILE_SECURITY_DIGEST = (
    "f17f4275ad53d9b1a0fa4c14cb08109b47c89e80f859ac5180e710abf4f54a45"
)
EXPECTED_POST_CAPTURE_RUNTIME_DELIVERY_DIGEST = (
    "cecdc4246251703e2a42feda6156e9203aa40749d9a73e010989c9c62c7858e7"
)
EXPECTED_RUNTIME_DELIVERY_ARTIFACT_KEYS = {"path", "role", "sizeBytes", "sha256"}
EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS = {
    "apiEnvironment": {"path": Path("packages/api/src/env.ts"), "role": "dedicated private storage and trusted-origin configuration", "sizeBytes": 15295, "sha256": "107f5dc17a3ba76e9f5252c6502a816ed08c3c17e49f1d601b1d8bb9393fb057"},
    "apiReviewedProfileMatcher": {"path": Path("packages/api/src/lib/reception-reviewed-runtime-profile.ts"), "role": "server-only reviewed profile, presentation, and immutable-byte matcher", "sizeBytes": 10130, "sha256": "f43eb2d4564eaab333e4ae753290f581ef42d35b011226d519b4541ada4ac9b0"},
    "apiVerifiedByteCache": {"path": Path("packages/api/src/lib/runtime-profile-verified-byte-cache.ts"), "role": "bounded verified-byte cache and per-request consumer isolation", "sizeBytes": 6536, "sha256": "9dceacac29a6ed6fb72417497d76c93f5bf3e2f1cc294d08ff06bb7ee566d31c"},
    "apiPublicAndAdminRoutes": {"path": Path("packages/api/src/routes/assets.ts"), "role": "public metadata/member fail-closed gate and administrator registration routes", "sizeBytes": 119431, "sha256": "25ae348b314cf906d6916d902a49b53e63e8409d8a6b06b78ffa61e1fe6a71d7"},
    "apiPrivatePreviewRoutes": {"path": Path("packages/api/src/routes/runtime-package-previews.ts"), "role": "authenticated exact-package preview routes", "sizeBytes": 22745, "sha256": "3ddd6ed35e3765ed6843598152343893d15ae9a1125a1045df0886d2c89224e1"},
    "publicRuntimeSchema": {"path": Path("packages/types/src/asset-version.ts"), "role": "strict redacted public profile and presentation contract schema", "sizeBytes": 59895, "sha256": "6f053c840da917c0580cdb74cf401b47dd3985732831424bfedb0778807a1b14"},
    "runtimeQaSchema": {"path": Path("packages/types/src/runtime-qa-record.ts"), "role": "QA package-composition and transform-matrix binding schema", "sizeBytes": 35081, "sha256": "d5bbb2e01bc30be3d14ee5870c628c04c70608d7127e633390688aca7f30a053"},
    "webRuntimeApi": {"path": Path("packages/web/src/api/runtime-packages.ts"), "role": "redacted public-profile client and authenticated preview client", "sizeBytes": 5262, "sha256": "31771bbcea6f0dcf21b1ef5e99499c073c817f71da4a49c3b979fa17d5a57183"},
    "webRuntimeResolution": {"path": Path("packages/web/src/lib/runtime-package-resolution.ts"), "role": "atomic ordered composition and mixed-level fail-closed resolver", "sizeBytes": 15570, "sha256": "26228b4054a00e9db0d02f7645c79f867c4943fb58c321ee5f0e8afd14edf942"},
    "webPresentationContract": {"path": Path("packages/web/src/pages/living-hall/reception-presentation-contract.ts"), "role": "exact browser presentation contract builder and matcher", "sizeBytes": 3671, "sha256": "f6f2298a403fc8ed343ebf0105e4faaa4b5fcd64cf5aa19767b77dd8b5d5cb73"},
    "webLivingHallRuntimeHook": {"path": Path("packages/web/src/pages/living-hall/useLivingHallRuntimeAsset.ts"), "role": "public-profile identity, origin, order, and presentation enforcement", "sizeBytes": 10151, "sha256": "b30b614e5b80cc283d0c4fc377589c60e3c58e67238fb979b6578ee1454517ae"},
    "webLivingHallPage": {"path": Path("packages/web/src/pages/living-hall/LivingHallPage.tsx"), "role": "fail-closed presentation-contract selection", "sizeBytes": 19018, "sha256": "88665064544c4bfb1da92c0d1f692ffb9222128647a872bd93c9da0fac69ee7f"},
    "webLivingHallScene": {"path": Path("packages/web/src/pages/living-hall/LivingHallScene.tsx"), "role": "exact camera, group-transform, and renderer-profile application", "sizeBytes": 19307, "sha256": "2cab6a834cf8676b0c2c5087f5bf47f2f08cf8bc884fd40b7358de13b13ba89f"},
    "webCameraPath": {"path": Path("packages/web/src/pages/living-hall/reception-dolly-path.ts"), "role": "presentation camera-path source", "sizeBytes": 3618, "sha256": "d84c9644b059c824831f387bfe803e965b043ea6a318319cf6a74997feaad2f3"},
    "webViewerProfile": {"path": Path("packages/web/src/pages/living-hall/reception-viewer-profile.ts"), "role": "reviewed renderer-profile source", "sizeBytes": 1361, "sha256": "c6b51ce451e8d4e9050b4045102735ee654ad643df4e748effdc16d79e918601"},
    "webCaptureBinding": {"path": Path("packages/web/src/pages/living-hall/reception-capture-binding-v1.json"), "role": "renderer digest-domain and installed-version binding", "sizeBytes": 2225, "sha256": "11d403311a51513ceda2ece850fc1f6ada83b51074bb69f94bafb0662bfd8570"},
    "databaseSchema": {"path": Path("packages/api/src/db/schema.ts"), "role": "runtime package, transform-artifact, and QA record database schema", "sizeBytes": 322482, "sha256": "8cb6b89c3e6c364de99b9656a08dfb06afdd55257fa82db1a900fe52269fffa0"},
    "runtimeAssetsMigration": {"path": Path("packages/api/drizzle/0024_runtime_assets.sql"), "role": "existing runtime package and asset migration", "sizeBytes": 19783, "sha256": "23a0c196b0ec16ffdd22b1c7f11284476baf252b27c4459361d07a78dfb3e978"},
    "runtimeTransformMigration": {"path": Path("packages/api/drizzle/0039_runtime_transform_artifacts.sql"), "role": "existing transform-artifact migration without an append-only trigger", "sizeBytes": 3764, "sha256": "bf7a46eda009064f28daf3b541ada620d7a58b5af5b6093eec147d9d1c2b1782"},
    "runtimeQaMigration": {"path": Path("packages/api/drizzle/0040_runtime_qa_records.sql"), "role": "existing QA-record migration without an append-only trigger", "sizeBytes": 6591, "sha256": "8346b55791c7584178f983a2d5c7fe69220cddcbbee310e848c553d836297c5d"},
    "runtimeRevisionMigration": {"path": Path("packages/api/drizzle/0052_runtime_package_revisions.sql"), "role": "existing append-only immutable runtime-package revision migration", "sizeBytes": 3595, "sha256": "f7bc06ec9edc277093af219babec9e5ffa59f14bc791003e36cb317ef128bf27"},
    "apiProfileMatcherTests": {"path": Path("packages/api/src/__tests__/reception-reviewed-runtime-profile.test.ts"), "role": "reviewed-profile identity and disabled-candidate negative tests", "sizeBytes": 11942, "sha256": "e1de29fc55560c0b6bb6d40c35e173d07f0c361fc7e6f1bfdcf1e24f56b0265f"},
    "apiVerifiedByteCacheTests": {"path": Path("packages/api/src/__tests__/runtime-profile-verified-byte-cache.test.ts"), "role": "verified-byte cache bound and abort negative tests", "sizeBytes": 4560, "sha256": "fb8dae241d912b1a99c6b49336334eef7eb68578c94b43ad3cce88eeab1ba82b"},
    "apiPublicGateTests": {"path": Path("packages/api/src/__tests__/runtime-public-exposure-gate.test.ts"), "role": "public release, QA, composition, transform, and transfer negative tests", "sizeBytes": 34024, "sha256": "8cb40b741c81afb33d7a23fef204833af8f12ff44009a3bf7ff61d5ee5a17635"},
    "apiPublicRouteTests": {"path": Path("packages/api/src/__tests__/runtime-public-profile-route.test.ts"), "role": "public metadata/member route revocation, timeout, queue, and rate-limit tests", "sizeBytes": 18715, "sha256": "51a030cf22b2895ed4cc1d164d0a8c54477a793db0b648b3f5e9f777861aeb84"},
    "apiPrivatePreviewTests": {"path": Path("packages/api/src/__tests__/runtime-package-previews-route.test.ts"), "role": "authenticated preview authorization and disconnect negative tests", "sizeBytes": 25317, "sha256": "24c19d59d7d4a2f151c97b41f78a644a04a77780ebc268b26215570dd9e50a19"},
    "publicRuntimeSchemaTests": {"path": Path("packages/types/src/__tests__/asset-version.test.ts"), "role": "public schema redaction and presentation digest negative tests", "sizeBytes": 51185, "sha256": "f323e8efff1a06839c54d2f53917c9483aa2c93240ab07953b1fd7fb9db5282c"},
    "runtimeQaSchemaTests": {"path": Path("packages/types/src/__tests__/runtime-qa-record.test.ts"), "role": "QA fail-closed and package-binding schema tests", "sizeBytes": 30315, "sha256": "2c424cd816f1647d81b7640bd5f3057738ad684d6f11f87aa18ca9b5e051c514"},
    "runtimeQaMigrationTests": {"path": Path("packages/api/src/__tests__/runtime-qa-records-schema.test.ts"), "role": "existing QA migration schema tests", "sizeBytes": 3569, "sha256": "0a4562aff24878d0b77f9a818f596feddb96da63124e8e65a303749b9dc7a5a2"},
    "runtimeRevisionMigrationTests": {"path": Path("packages/api/src/__tests__/runtime-package-revisions-schema.test.ts"), "role": "immutable runtime-package revision migration tests", "sizeBytes": 4363, "sha256": "ad1c30cd64dda4f289e06e12b86c4120a3b145c49690ec3bc2fc1fdeb17cf741"},
    "webRuntimeApiTests": {"path": Path("packages/web/src/__tests__/runtime-packages-api.test.ts"), "role": "public response redaction and authenticated preview client negative tests", "sizeBytes": 9895, "sha256": "56cc66e0b1adb14e57d2a778db7a7058787186447fc2f0ecedff3c39496edf50"},
    "webRuntimeResolutionTests": {"path": Path("packages/web/src/lib/__tests__/runtime-package-resolution.test.ts"), "role": "atomic composition and mixed-level fallback negative tests", "sizeBytes": 23576, "sha256": "e5611e00290922ea22281d48e56b6fdb2367fb9d920aacd847a15480dd33b0aa"},
    "webLivingHallRuntimeTests": {"path": Path("packages/web/src/pages/living-hall/__tests__/living-hall-runtime.test.tsx"), "role": "public identity, URL, presentation, and fallback negative tests", "sizeBytes": 18622, "sha256": "787e0e6161bf3f2821bf8b547c79b462d7ecfed8d6fcf1f905a9c20cfba7704b"},
    "webLivingHallSceneRenderTests": {"path": Path("packages/web/src/pages/living-hall/__tests__/living-hall-scene-render.test.tsx"), "role": "atomic splat-layer failure and empty-composition render tests", "sizeBytes": 8875, "sha256": "69f1f63c514e49dcec6236da3517d11f10581b7291fc78ef779f6038c6dbb71c"},
}
EXPECTED_RUNTIME_DELIVERY_REQUIRED_TOKENS = {
    "apiEnvironment": ("RUNTIME_PROFILE_R2_PRIVATE_BUCKET", "PUBLIC_API_ORIGIN"),
    "apiReviewedProfileMatcher": ("publicPresentationCandidate: false", "reviewedTransformArtifactSha256: null", "97f902723a8e3e9d833dec556eec8fc02a93e4cc58e715903ddad19f5428e239", "runtimeQaViewTransformMatchesMatrix", "runtimeGroupTransformMatchesMatrix"),
    "apiVerifiedByteCache": ("maximumBytes", "maximumEntries", "ttlMilliseconds", "Authorization is"),
    "apiPublicAndAdminRoutes": ("runtimeQaPublicPackageBinding", "record.runtimePackageBinding === undefined", "presentationContractDigest", "samePublicRuntimeProfileMemberAuthorization", "PUBLIC_RUNTIME_PROFILE_ROUTE_RATE_LIMIT_PER_MINUTE = 24"),
    "apiPrivatePreviewRoutes": ("Register before the database lookup so a disconnect cannot be missed", "previewStorageConfigured"),
    "publicRuntimeSchema": ("ApprovedRoomRuntimePresentationContractSchema", "venviewer.approved-room-runtime-presentation.v1", "presentationContract: ApprovedRoomRuntimePresentationContractSchema"),
    "runtimeQaSchema": ("runtimePackageContentSha256", "orderedVisualCompositionSha256", "runtimeQaViewTransformMatchesMatrix"),
    "webRuntimeApi": ("ApprovedRoomRuntimeProfileSchema.nullable()", "getLatestRuntimePackage", "Promise.resolve(null)"),
    "webRuntimeResolution": ("selectNonOverlappingLcc2UrlFrontier", "if (declaredUrls.length !== declaredIds.length) return []"),
    "webPresentationContract": ("matchesReceptionLivingHallPresentationContract", "runtimeGroupTransformMatchesMatrix", "RECEPTION_RENDERER_PROFILE_DIGEST"),
    "webLivingHallRuntimeHook": ("matchesReceptionLivingHallPresentationContract", "presentationContract: null"),
    "webLivingHallPage": ("activePresentationContract", "presentationContract={activePresentationContract}"),
    "webLivingHallScene": ("presentationContract.cameraPolicy", "presentationContract.groupTransform", "data-presentation-contract-digest"),
    "webCameraPath": ("RECEPTION_DOLLY_STATIONS", "MIN_GAZE_DISTANCE_M"),
    "webViewerProfile": ("RECEPTION_FIXED_FINE_REVIEW_PROFILE", "expectedSplatMeshMatrixWorld"),
    "webCaptureBinding": ("venviewer.reception-viewer-profile.v1", '"spark": "2.0.0"'),
    "databaseSchema": ("runtimeTransformArtifacts", "runtimeQaRecords", "runtime_packages_venue_room_digest_unique"),
    "runtimeAssetsMigration": ('CREATE TABLE IF NOT EXISTS "runtime_packages"', "runtime_packages_manifest_shape"),
    "runtimeTransformMigration": ('CREATE TABLE IF NOT EXISTS "runtime_transform_artifacts"', "runtime_transform_artifacts_package_artifact_unique"),
    "runtimeQaMigration": ('CREATE TABLE IF NOT EXISTS "runtime_qa_records"', "runtime_qa_records_signed_transform_artifact_fk"),
    "runtimeRevisionMigration": ('runtime_packages is append-only', 'BEFORE UPDATE ON "runtime_packages"'),
    "apiProfileMatcherTests": ("matches exact Quality bytes but blocks anonymous presentation without a reviewed transform", "rejects a composition mutation even when the content digest is updated"),
    "apiVerifiedByteCacheTests": ("never caches bytes whose size or SHA-256 differs from the immutable identity", "aborts a shared upstream load only after every waiting consumer leaves"),
    "apiPublicGateTests": ("fails closed when QA package identity, composition, chunk count, or bytes drift", "rejects non-identity QA presentation values bound to identity transform bytes"),
    "apiPublicRouteTests": ("returns no bytes when approval is revoked during the storage fetch", "applies the tighter anonymous route limit"),
    "apiPrivatePreviewTests": ("requires platform-admin access before metadata lookup", "does not claim or leak a transfer slot after a client closes during lookup"),
    "publicRuntimeSchemaTests": ("rejects a presentation contract whose body no longer matches its digest", "keeps server-only package and asset receipts out of the public shape"),
    "runtimeQaSchemaTests": ("rejects public exposure while evidence is unverified", "keeps a signed transform without a digest internal-only"),
    "runtimeQaMigrationTests": ("runtime_qa_records_public_gate", "runtime_qa_records_signed_transform_artifact_fk"),
    "runtimeRevisionMigrationTests": ('BEFORE UPDATE ON "runtime_packages"', "runtime_packages_no_update"),
    "webRuntimeApiTests": ("rejects private package evidence added to the public approved-profile response", "keeps the retired detailed-package browser resolver on safe fallback"),
    "webRuntimeResolutionTests": ("rejects mixed replacement levels", "rejects a partial three-of-four Reception Room composition"),
    "webLivingHallRuntimeTests": ("rejects self-consistent transform, camera, renderer, and route contract drift", "keeps the fallback when no approved profile exists"),
    "webLivingHallSceneRenderTests": ("removes every splat layer and keeps the poster when any tile fails", "mounts no canvas or splat requests for an empty URL set"),
}
EXPECTED_RUNTIME_DELIVERY_FORBIDDEN_TOKENS = {
    "runtimeTransformMigration": (
        'BEFORE UPDATE ON "runtime_transform_artifacts"',
        'BEFORE DELETE ON "runtime_transform_artifacts"',
        'BEFORE TRUNCATE ON "runtime_transform_artifacts"',
    ),
    "runtimeQaMigration": (
        'BEFORE UPDATE ON "runtime_qa_records"',
        'BEFORE DELETE ON "runtime_qa_records"',
        'BEFORE TRUNCATE ON "runtime_qa_records"',
    ),
}
EXPECTED_RUNTIME_DELIVERY_PRESENTATION_STATE = {
    "schemaVersion": "venviewer.approved-room-runtime-presentation.v1",
    "contractDigest": "97f902723a8e3e9d833dec556eec8fc02a93e4cc58e715903ddad19f5428e239",
    "localSchemaServerGateAndClientExactMatchImplemented": True,
    "anonymousProfileCandidatesEnabled": False,
    "reviewedTransformArtifactSha256Bound": False,
    "deployedQaAndReleaseBindingProven": False,
}
EXPECTED_RUNTIME_DELIVERY_COMPOSITION_BINDING = {
    "qaRuntimePackageBindingRequired": True,
    "runtimePackageContentSha256Required": True,
    "orderedVisualCompositionSha256Required": True,
    "visualChunkCountRequired": True,
    "totalVisualBytesRequired": True,
    "qaTransformMatrixMustMatchSignedTransform": True,
    "memberAuthorizationRecheckedBeforeSend": True,
}
EXPECTED_RUNTIME_DELIVERY_ACTIVATION_REQUIREMENTS = [
    "review and bind the exact group transform, camera policy/route and renderer-profile digest",
    "make the browser apply the reviewed presentation values exactly",
    "provision dedicated least-privilege private runtime-profile R2 credentials and bucket",
    "copy and byte-verify exact reviewed objects",
    "prove direct anonymous/public bucket access is denied",
    "install edge rate-limit and WAF controls",
    "keep public showcase disabled until every activation gate passes",
]
EXPECTED_RUNTIME_DELIVERY_IMMUTABLE_ID_BOUNDARY = (
    "API idempotency only: transform-artifact and QA-record IDs permit exact "
    "idempotent retries in the application routes; changed content requires a new ID. "
    "Database append-only triggers for runtime_transform_artifacts and runtime_qa_records "
    "are not proven or implemented."
)
EXPECTED_RUNTIME_DELIVERY_ELIGIBILITY = {
    "quality-sog-fine-v1": False,
    "mobile-spz-fine-v1": False,
    "reason": (
        "Both reviewed byte identities have an exact local presentation contract, but "
        "their server receipts keep publicPresentationCandidate=false and "
        "reviewedTransformArtifactSha256=null."
    ),
}
EXPECTED_RUNTIME_DELIVERY_METADATA_GATES = [
    "room showcase opt-in",
    "exact reviewed byte identity",
    "exact approved presentation contract",
    "published immutable package revision",
    "human-reviewed public QA with every required check present and passed",
    "QA binds exact runtime-package content digest, ordered visual composition digest, chunk count and total bytes",
    "linked signed transform whose matrix matches the QA view transform",
    "QA and transform match exact package, venue and room",
    "same package revision, presentation-contract digest and member immediately before send",
]
EXPECTED_RUNTIME_DELIVERY_RECEIPT_SEMANTICS = {
    "criticalSourceTokensPinned": True,
    "focusedNegativeTestSourcesPinned": True,
    "transformAndQaAppendOnlyDatabaseTriggersProvenOrImplemented": False,
}
EXPECTED_RUNTIME_PROFILE_SECURITY_CRITICAL = {
    "status": "implemented_locally_not_deployed",
    "identityAndReleaseAreSeparate": True,
    "anonymousPresentationAllowlist": [],
    "receptionPublicShowcaseEnabled": False,
    "publicReleaseChanged": False,
    "deploymentOrRegistrationChanged": False,
    "runtimeProfilePrivateStorageProvisionedOrCopied": False,
    "directAnonymousPrivateBucketAccessDenialVerified": False,
    "edgeRateLimitOrWafConfiguredByThisWork": False,
}
EXPECTED_POST_CAPTURE_RUNTIME_DELIVERY_CRITICAL = {
    "asOf": "2026-07-16",
    "authority": "local_implementation_and_tests_only",
    "captureArtifactHashesChanged": False,
    "serverReviewedProfiles": ["quality-sog-fine-v1", "mobile-spz-fine-v1"],
    "publicPresentationCandidate": None,
    "currentPublicResponse": None,
    "currentReceptionShowcaseState": "disabled_fail_closed",
    "runtimeProfilePrivateStorageProvisionedOrCopied": False,
    "directAnonymousPrivateBucketAccessDenialVerified": False,
    "edgeRateLimitOrWafConfiguredByThisWork": False,
    "deploymentRegistrationMigrationPublicPointerOrReleaseChanged": False,
    "qualityConclusionChanged": False,
}
EXPECTED_RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS = (
    "package.json",
    "packages/types/package.json",
    "packages/types/tsconfig.build.json",
    "packages/types/tsconfig.json",
    "packages/web/index.html",
    "packages/web/package.json",
    "packages/web/scripts/reception-capture-runtime-build-digest.mjs",
    "packages/web/tsconfig.json",
    "packages/web/vite.config.ts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
)
EXPECTED_RECEPTION_CAPTURE_RUNTIME_SOURCE_ROOTS = (
    "packages/types/dist",
    "packages/types/src",
    "packages/web/src",
)
RUNTIME_TEST_FILE = re.compile(r"\.(?:spec|stories|test)\.[^.]+$")
EXPECTED_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST = (
    "531e961884b0383e510ea4a063520bd48adc933edfca528f527256c291ec34eb"
)
EXPECTED_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT = {
    "mobileOrigin": "http://127.0.0.1:4174",
    "qualityOrigin": "",
}
EXPECTED_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST = (
    "1764fd0510f9f8bd754d8811eb41a5910e2a6ffaa9b4491aae902fdf0c8b68c4"
)
RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DOMAIN = (
    b"venviewer.reception-capture-runtime-environment.v1\0"
)
EXPECTED_SOURCE_PHOTO_COMPARISON_DIGEST = (
    "89d167b706b9085c4e4a540bca5a751bea500a8f6f69b695547f967e6b8da8ef"
)
EXPECTED_PREPARED_LOCAL_COMPARISON_DIGEST = (
    "587976fc20f548bf906903dd954f7c242a0a5a84384a0b1ba86cdc848d875d01"
)
EXPECTED_FEATURE_IDS = {
    "timber-doors-a",
    "curtains-windows-a",
    "column-moulding-a",
    "floorboards-a",
    "room-depth-detail-a",
}
EXPECTED_COVERAGE_STAGES = [
    "original_lcc_studio_model",
    "master_ply_or_lcc2_independent_viewer",
    "sog_or_spz_independent_viewer",
    "venviewer_spark_protected_product_route",
]
COVERAGE_FIELDS = (
    "originalLccStudio",
    "masterIndependentViewer",
    "compressedIndependentViewer",
    "protectedProductRoute",
)
MANUAL_FILE_SUFFIXES = (
    "-LCC-QUALITY.png",
    "-PLY-SH3.png",
    "-SOG-SH3-FINE.png",
    "-SOG-SH0-FINE.png",
    "-SPZ-SH0-FINE.png",
    "-VENVIEWER-CANDIDATE.png",
)
EXPECTED_CRITERIA = {
    "A": "partial",
    "B": "satisfied_to_lawful_inspection_boundary",
    "C": "satisfied_as_audit_trainer_not_runnable",
    "D": "satisfied_as_decision_screen",
    "E": "partial",
    "F": "partial",
    "G": "partial",
    "H": "partial",
    "I": "satisfied_for_current_boundary",
}
EXPECTED_BLOCKING_CRITERIA = ["A", "E", "F", "G", "H"]
CURRENT_CRITERIA_MARKERS = {
    "A": "| A. Dominant-loss diagnosis | **Partial.**",
    "B": "| B. Raw-project go/no-go | **Satisfied to the lawful inspection boundary.**",
    "C": "| C. Existing pipeline audit | **Satisfied as an audit, not as a working trainer.**",
    "D": "| D. Approach comparison | **Satisfied as a decision screen.**",
    "E": "| E. Recommended stack | **Partial.**",
    "F": "| F. Bounded Reception pilot | **Partial.**",
    "G": "| G. Measurable quality gate | **Partial.**",
    "H": "| H. Commercial cleanliness | **Partial.**",
    "I": "| I. Exact next actions | **Satisfied for the current boundary.**",
}
REQUIRED_APPROACH_FACTORS = (
    "Mechanism",
    "Inputs required",
    "Expected quality gain",
    "Adds real information?",
    "Generated?",
    "Engineering effort",
    "Compute cost",
    "Licence/commercial",
    "Risks",
    "Falsifying test",
    "Current blocker",
    "Recommendation",
)
REQUIRED_FINAL_SECTIONS = {
    1: "DIRECT ANSWER",
    2: "SUCCESS-CRITERIA AUDIT",
    3: "EVIDENCE CHAIN",
    4: "FOUR-VIEW DIAGNOSIS",
    5: "RAW-PROJECT GO / NO-GO",
    6: "APPROACH REGISTRY",
    7: "RECOMMENDED PIPELINE",
    8: "RECEPTION ROOM PILOT",
    9: "HIGH-RES PHOTO CAPTURE PLAN",
    10: "COST AND TIME",
    11: "LICENCE MATRIX",
    12: "ADVERSARIAL FINDINGS",
    13: "UNRESOLVED GAPS",
    14: "RECOMMENDED NEXT ACTION",
    15: "HANDOFF SUMMARY",
}
ASSET_REQUIRED_FIELDS = {
    "id",
    "path",
    "fileType",
    "sizeBytes",
    "sha256",
    "sourceRole",
    "compressionLineage",
    "evidenceStrength",
    "limitations",
    "nextTest",
}


class VerificationError(RuntimeError):
    """A goal artifact is missing, stale, or internally inconsistent."""


def _reject_constant(value: str) -> None:
    raise VerificationError(f"INVALID_JSON_CONSTANT: {value}")


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError(f"DUPLICATE_JSON_KEY: {key}")
        result[key] = value
    return result


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"INVALID_JSON: {path}: {error}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"JSON_ROOT_NOT_OBJECT: {path}")
    return value


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise VerificationError(f"TEXT_READ_FAILED: {path}: {error}") from error


def _require(condition: bool, code: str, detail: str) -> None:
    if not condition:
        raise VerificationError(f"{code}: {detail}")


def _as_list(value: Any, label: str) -> list[Any]:
    _require(isinstance(value, list), "EXPECTED_LIST", label)
    return value


def _as_dict(value: Any, label: str) -> dict[str, Any]:
    _require(isinstance(value, dict), "EXPECTED_OBJECT", label)
    return value


def _nonempty_string(value: Any, label: str) -> str:
    _require(isinstance(value, str) and bool(value.strip()), "EXPECTED_TEXT", label)
    return value


def _same_json_value(actual: Any, expected: Any) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            _same_json_value(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(
            _same_json_value(left, right) for left, right in zip(actual, expected)
        )
    return actual == expected


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise VerificationError(f"REPORT_READ_FAILED: {path}: {error}") from error
    return digest.hexdigest()


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _contained_repo_path(repo_root: Path, value: Any, label: str) -> Path:
    raw = _nonempty_string(value, label)
    relative = Path(raw)
    _require(not relative.is_absolute(), "EXPECTED_REPO_RELATIVE_PATH", f"{label}: {raw}")
    _require(".." not in relative.parts, "REPO_PATH_TRAVERSAL", f"{label}: {raw}")
    root = repo_root.resolve()
    path = (root / relative).resolve()
    _require(path.is_relative_to(root), "REPO_PATH_ESCAPES_ROOT", f"{label}: {path}")
    return path


def _verify_report_receipt(repo_root: Path, record: dict[str, Any], label: str) -> None:
    pinned_path, pinned_size, pinned_hash = EXPECTED_REPORT_RECEIPTS[label]
    _require(record.get("report") == pinned_path, "REPORT_RECEIPT_PATH_CHANGED", label)
    path = _contained_repo_path(repo_root, pinned_path, f"{label}.report")
    _require(path.is_file(), "EXTERNAL_ANALYSIS_REPORT_MISSING", f"{label}: {path}")
    expected_size = record.get("reportSizeBytes")
    _require(expected_size == pinned_size, "REPORT_RECEIPT_SIZE_CHANGED", label)
    try:
        actual_size = path.stat().st_size
    except OSError as error:
        raise VerificationError(f"REPORT_READ_FAILED: {path}: {error}") from error
    _require(actual_size == pinned_size, "REPORT_SIZE_MISMATCH", f"{label}: {path}")
    expected_hash = _nonempty_string(record.get("reportSha256"), f"{label}.reportSha256")
    _require(
        expected_hash == pinned_hash,
        "REPORT_RECEIPT_SHA256_CHANGED",
        label,
    )
    _require(_sha256(path) == pinned_hash, "REPORT_SHA256_MISMATCH", f"{label}: {path}")


def _unique_field(items: list[Any], field: str, label: str) -> list[str]:
    values: list[str] = []
    for index, item in enumerate(items):
        record = _as_dict(item, f"{label}[{index}]")
        values.append(_nonempty_string(record.get(field), f"{label}[{index}].{field}"))
    _require(len(values) == len(set(values)), "DUPLICATE_VALUES", f"{label}.{field}")
    return values


def _approach_sections(matrix: str) -> dict[int, str]:
    matches = list(re.finditer(r"^### R(\d+)\s+—[^\n]*$", matrix, re.MULTILINE))
    sections: dict[int, str] = {}
    for index, match in enumerate(matches):
        approach_id = int(match.group(1))
        _require(approach_id not in sections, "DUPLICATE_APPROACH_ID", str(approach_id))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(matrix)
        sections[approach_id] = matrix[match.start() : end]
    return sections


def _resolve_artifact_paths(repo_root: Path) -> dict[str, Path]:
    root = repo_root.resolve()
    paths = {name: root / relative for name, relative in REQUIRED_ARTIFACTS.items()}
    missing = [str(path) for path in paths.values() if not path.is_file()]
    _require(not missing, "MISSING_REQUIRED_ARTIFACTS", "; ".join(missing))
    return paths


def _verify_holdout(repo_root: Path, reconciliation: dict[str, Any]) -> None:
    holdout = _as_dict(reconciliation.get("methodSpecificHoldout"), "methodSpecificHoldout")
    _verify_report_receipt(repo_root, holdout, "method-specific holdout")
    expected = {
        "candidate": "mobile",
        "status": "small_directional_lead_not_a_product_win",
        "multiscaleEdgeChamferWins": {"mobile": 2, "quality": 1},
        "normalizedGradientOrientationWins": {"mobile": 2, "quality": 1},
        "relativeEffectRangePercent": [0.07, 1.38],
        "practicalMateriality": "not_calibrated",
        "physicalApproval": False,
        "commercialApproval": False,
    }
    for field, value in expected.items():
        _require(
            _same_json_value(holdout.get(field), value),
            "METHOD_HOLDOUT_CHANGED",
            f"{field}: {holdout.get(field)!r}",
        )


def _verify_no_reference_iqa(repo_root: Path, reconciliation: dict[str, Any]) -> None:
    record = _as_dict(reconciliation.get("noReferenceIqa"), "noReferenceIqa")
    _verify_report_receipt(repo_root, record, "no-reference IQA")
    expected = {
        "conditions": 15,
        "openCvBrisquePreference": {"mobile": 14, "quality": 1},
        "piqBrisquePreference": {"mobile": 13, "quality": 2},
        "clipIqaPreference": {"quality": 14, "mobile": 1},
        "crossFamilyDisagreementConditions": 13,
        "decision": "appearance_scoring_families_conflict_and_cannot_select_physical_truth",
    }
    _require(
        all(_same_json_value(record.get(field), value) for field, value in expected.items()),
        "NO_REFERENCE_IQA_COUNTS_CHANGED",
        json.dumps(record, sort_keys=True),
    )


def _verify_artifact_diagnosis(repo_root: Path, reconciliation: dict[str, Any]) -> None:
    record = _as_dict(reconciliation.get("artifactDiagnosis"), "artifactDiagnosis")
    _verify_report_receipt(repo_root, record, "artifact diagnosis")
    expected = {
        "qualityNearWhiteExcessPercentByScan": {"126": 34.3, "129": 28.7, "141": 42.0},
        "fineDetailRankIsStableAcrossAllViews": False,
        "largestMismatchRegionScans126And129": "lower_floor",
        "candidateSpecificFloaterProved": False,
    }
    _require(
        all(_same_json_value(record.get(field), value) for field, value in expected.items()),
        "ARTIFACT_DIAGNOSIS_CHANGED",
        json.dumps(record, sort_keys=True),
    )


def _verify_current_action(reconciliation: dict[str, Any]) -> None:
    action = _as_dict(reconciliation.get("currentAction"), "currentAction")
    _require(
        set(action) == EXPECTED_CURRENT_ACTION_KEYS,
        "CURRENT_ACTION_FIELDS_CHANGED",
        repr(sorted(action)),
    )
    _require(
        action.get("lccCapturePaused") is True
        and action.get("requiredExactResumePhrase") == EXPECTED_RESUME_PHRASE,
        "EVIDENCE_ACTION_PERMISSION_MISMATCH",
        json.dumps(action, sort_keys=True),
    )
    static_test = _nonempty_string(action.get("staticTest"), "currentAction.staticTest")
    motion_test = _nonempty_string(action.get("motionTest"), "currentAction.motionTest")
    _require(
        "development real-component route" in static_test
        and "renderer-owned" in static_test
        and "generated Spark data" in static_test
        and "source_view_diagnostic only" in static_test
        and "must never select Quality or Mobile" in static_test
        and "21-frame" in motion_test
        and "separately" in motion_test,
        "EVIDENCE_ACTION_TESTS_MISMATCH",
        json.dumps(action, sort_keys=True),
    )
    _require(
        action.get("heldoutExecutionAvailable") is False
        and action.get("heldoutBlocker")
        == "No independently reviewed and allowlisted renderer-owned capture adapter exists.",
        "EVIDENCE_ACTION_HELDOUT_BOUNDARY_MISMATCH",
        json.dumps(action, sort_keys=True),
    )
    _require(
        _canonical_digest(action) == EXPECTED_CURRENT_ACTION_DIGEST,
        "CURRENT_ACTION_CHANGED",
        _canonical_digest(action),
    )


def _verify_support_artifact(
    repo_root: Path, record: dict[str, Any], expected: dict[str, Any], label: str
) -> None:
    relative = expected["path"]
    declared_path = record.get(expected["pathField"])
    _require(
        declared_path == relative.as_posix(),
        "SUPPORT_ARTIFACT_PATH_CHANGED",
        f"{label}: {declared_path}",
    )
    declared_size = record.get(expected["sizeField"])
    _require(
        _same_json_value(declared_size, expected["sizeBytes"]),
        "SUPPORT_ARTIFACT_SIZE_CHANGED",
        f"{label}: {declared_size}",
    )
    declared_hash = record.get(expected["hashField"])
    _require(
        declared_hash == expected["sha256"],
        "SUPPORT_ARTIFACT_SHA256_CHANGED",
        f"{label}: {declared_hash}",
    )
    path = _contained_repo_path(repo_root, declared_path, label)
    _require(path.is_file(), "SUPPORT_ARTIFACT_MISSING", f"{label}: {path}")
    try:
        actual_size = path.stat().st_size
    except OSError as error:
        raise VerificationError(f"SUPPORT_ARTIFACT_READ_FAILED: {path}: {error}") from error
    _require(actual_size == expected["sizeBytes"], "SUPPORT_ARTIFACT_SIZE_MISMATCH", label)
    _require(_sha256(path) == expected["sha256"], "SUPPORT_ARTIFACT_SHA256_MISMATCH", label)


def _verify_runtime_delivery_source_semantics(
    path: Path, label: str
) -> None:
    text = _read_text(path)
    for token in EXPECTED_RUNTIME_DELIVERY_REQUIRED_TOKENS[label]:
        _require(
            token in text,
            "RUNTIME_DELIVERY_REQUIRED_SOURCE_TOKEN_MISSING",
            f"{label}: {token}",
        )
    for token in EXPECTED_RUNTIME_DELIVERY_FORBIDDEN_TOKENS.get(label, ()):
        _require(
            token not in text,
            "RUNTIME_DELIVERY_FORBIDDEN_SOURCE_TOKEN_PRESENT",
            f"{label}: {token}",
        )
    if label == "apiReviewedProfileMatcher":
        _require(
            text.count("publicPresentationCandidate: false") == 2
            and text.count("reviewedTransformArtifactSha256: null") == 2,
            "RUNTIME_DELIVERY_PROFILE_CANDIDATE_COUNT_CHANGED",
            label,
        )


def _verify_runtime_delivery_support_artifacts(
    repo_root: Path, receipt: dict[str, Any]
) -> None:
    records = _as_dict(receipt.get("supportArtifacts"), "runtimeDelivery.supportArtifacts")
    _require(
        set(records) == set(EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS),
        "RUNTIME_DELIVERY_SUPPORT_ARTIFACT_SET_CHANGED",
        repr(sorted(records)),
    )
    for label, expected in EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS.items():
        record = _as_dict(records.get(label), f"runtimeDelivery.supportArtifacts.{label}")
        _require(
            set(record) == EXPECTED_RUNTIME_DELIVERY_ARTIFACT_KEYS,
            "RUNTIME_DELIVERY_SUPPORT_ARTIFACT_FIELDS_CHANGED",
            label,
        )
        _require(
            record.get("role") == expected["role"],
            "RUNTIME_DELIVERY_SUPPORT_ARTIFACT_ROLE_CHANGED",
            label,
        )
        path = _contained_repo_path(repo_root, record.get("path"), label)
        _verify_runtime_delivery_source_semantics(path, label)
        pinned = dict(expected, pathField="path", sizeField="sizeBytes", hashField="sha256")
        _verify_support_artifact(repo_root, record, pinned, label)


def _verify_runtime_delivery_receipt(evidence: dict[str, Any]) -> tuple[dict[str, Any], str]:
    receipt = _as_dict(
        evidence.get("runtimeDeliveryHardeningImplementationReceipt"),
        "runtimeDeliveryHardeningImplementationReceipt",
    )
    _require(
        set(receipt) == {"schemaVersion", "authority", "supportArtifacts", "semanticChecks"},
        "RUNTIME_DELIVERY_RECEIPT_FIELDS_CHANGED",
        repr(sorted(receipt)),
    )
    _require(
        receipt.get("schemaVersion") == EXPECTED_RUNTIME_DELIVERY_RECEIPT_SCHEMA
        and receipt.get("authority") == "local_implementation_and_tests_only",
        "RUNTIME_DELIVERY_RECEIPT_BOUNDARY_CHANGED",
        json.dumps(receipt, sort_keys=True),
    )
    semantics = _as_dict(receipt.get("semanticChecks"), "runtimeDelivery.semanticChecks")
    _require(
        _same_json_value(semantics, EXPECTED_RUNTIME_DELIVERY_RECEIPT_SEMANTICS),
        "RUNTIME_DELIVERY_RECEIPT_SEMANTICS_CHANGED",
        json.dumps(semantics, sort_keys=True),
    )
    digest = _canonical_digest(receipt)
    _require(
        digest == EXPECTED_RUNTIME_DELIVERY_RECEIPT_DIGEST,
        "RUNTIME_DELIVERY_RECEIPT_CHANGED",
        digest,
    )
    return receipt, digest


def _verify_runtime_delivery_common_fields(block: dict[str, Any], label: str) -> None:
    _require(
        _same_json_value(
            block.get("anonymousPresentationEligibility"),
            EXPECTED_RUNTIME_DELIVERY_ELIGIBILITY,
        ),
        "RUNTIME_DELIVERY_ELIGIBILITY_CHANGED",
        label,
    )
    _require(
        _same_json_value(
            block.get("presentationContractState"),
            EXPECTED_RUNTIME_DELIVERY_PRESENTATION_STATE,
        ),
        "RUNTIME_DELIVERY_PRESENTATION_STATE_CHANGED",
        label,
    )
    _require(
        _same_json_value(
            block.get("compositionBinding"),
            EXPECTED_RUNTIME_DELIVERY_COMPOSITION_BINDING,
        ),
        "RUNTIME_DELIVERY_COMPOSITION_BINDING_CHANGED",
        label,
    )


def _verify_runtime_delivery_activation_fields(block: dict[str, Any], label: str) -> None:
    _require(
        block.get("immutableReviewIds") == EXPECTED_RUNTIME_DELIVERY_IMMUTABLE_ID_BOUNDARY,
        "RUNTIME_DELIVERY_IMMUTABLE_ID_BOUNDARY_CHANGED",
        label,
    )
    _require(
        _same_json_value(
            block.get("externalActivationRequirements"),
            EXPECTED_RUNTIME_DELIVERY_ACTIVATION_REQUIREMENTS,
        ),
        "RUNTIME_DELIVERY_ACTIVATION_REQUIREMENTS_CHANGED",
        label,
    )


def _verify_runtime_profile_security_block(
    evidence: dict[str, Any], receipt_digest: str
) -> None:
    addenda = _as_dict(evidence.get("postCutoffAddenda"), "postCutoffAddenda")
    block = _as_dict(addenda.get("runtimeProfileSecurityHardening"), "runtimeProfileSecurityHardening")
    valid = set(EXPECTED_RUNTIME_PROFILE_SECURITY_CRITICAL).issubset(block) and all(
        _same_json_value(block.get(field), value)
        for field, value in EXPECTED_RUNTIME_PROFILE_SECURITY_CRITICAL.items()
    )
    _require(valid, "RUNTIME_PROFILE_SECURITY_FAIL_CLOSED_STATE_CHANGED", json.dumps(block, sort_keys=True))
    _verify_runtime_delivery_common_fields(block, "runtimeProfileSecurityHardening")
    _verify_runtime_delivery_activation_fields(block, "runtimeProfileSecurityHardening")
    _require(
        _same_json_value(block.get("publicMetadataAndMemberRequestGates"), EXPECTED_RUNTIME_DELIVERY_METADATA_GATES),
        "RUNTIME_DELIVERY_METADATA_GATES_CHANGED",
        "runtimeProfileSecurityHardening",
    )
    _require(
        block.get("implementationReceiptDigest") == receipt_digest,
        "RUNTIME_DELIVERY_RECEIPT_BINDING_CHANGED",
        "runtimeProfileSecurityHardening",
    )
    _require(
        _canonical_digest(block) == EXPECTED_RUNTIME_PROFILE_SECURITY_DIGEST,
        "RUNTIME_PROFILE_SECURITY_BLOCK_CHANGED",
        _canonical_digest(block),
    )


def _verify_post_capture_runtime_delivery_block(
    evidence: dict[str, Any], receipt_digest: str
) -> None:
    block = _as_dict(
        evidence.get("postCaptureRuntimeDeliveryHardening"),
        "postCaptureRuntimeDeliveryHardening",
    )
    valid = set(EXPECTED_POST_CAPTURE_RUNTIME_DELIVERY_CRITICAL).issubset(block) and all(
        _same_json_value(block.get(field), value)
        for field, value in EXPECTED_POST_CAPTURE_RUNTIME_DELIVERY_CRITICAL.items()
    )
    _require(valid, "POST_CAPTURE_RUNTIME_DELIVERY_FAIL_CLOSED_STATE_CHANGED", json.dumps(block, sort_keys=True))
    _verify_runtime_delivery_common_fields(block, "postCaptureRuntimeDeliveryHardening")
    _verify_runtime_delivery_activation_fields(block, "postCaptureRuntimeDeliveryHardening")
    metadata_gate = _nonempty_string(block.get("metadataGate"), "postCapture.metadataGate")
    for token in ("runtime-package content digest", "ordered visual composition digest", "presentation contract"):
        _require(token in metadata_gate, "RUNTIME_DELIVERY_METADATA_GATES_CHANGED", token)
    _require(
        block.get("implementationReceiptDigest") == receipt_digest,
        "RUNTIME_DELIVERY_RECEIPT_BINDING_CHANGED",
        "postCaptureRuntimeDeliveryHardening",
    )
    _require(
        _canonical_digest(block) == EXPECTED_POST_CAPTURE_RUNTIME_DELIVERY_DIGEST,
        "POST_CAPTURE_RUNTIME_DELIVERY_BLOCK_CHANGED",
        _canonical_digest(block),
    )


def _verify_runtime_delivery_hardening(
    evidence: dict[str, Any], repo_root: Path
) -> None:
    receipt, digest = _verify_runtime_delivery_receipt(evidence)
    _verify_runtime_profile_security_block(evidence, digest)
    _verify_post_capture_runtime_delivery_block(evidence, digest)
    _verify_runtime_delivery_support_artifacts(repo_root, receipt)


def _is_reception_capture_runtime_source(repository_path: str, source_root: str) -> bool:
    path = Path(repository_path)
    if "__tests__" in path.parts or "__mocks__" in path.parts:
        return False
    if RUNTIME_TEST_FILE.search(path.name):
        return False
    return source_root != "packages/types/dist" or path.suffix == ".js"


def _reception_capture_runtime_build_inputs(repo_root: Path) -> tuple[str, ...]:
    root = repo_root.resolve()
    inputs = set(EXPECTED_RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS)
    for source_root in EXPECTED_RECEPTION_CAPTURE_RUNTIME_SOURCE_ROOTS:
        source = _contained_repo_path(root, source_root, "runtimeBuildSourceRoot")
        _require(source.is_dir(), "RUNTIME_BUILD_SOURCE_ROOT_MISSING", source_root)
        for current, directories, files in os.walk(source, followlinks=False):
            current_path = Path(current)
            for directory in directories:
                linked = current_path / directory
                _require(not linked.is_symlink(), "RUNTIME_BUILD_INPUT_LINKED", str(linked))
            for file_name in files:
                path = current_path / file_name
                repository_path = path.relative_to(root).as_posix()
                _require(not path.is_symlink(), "RUNTIME_BUILD_INPUT_LINKED", repository_path)
                if path.is_file() and _is_reception_capture_runtime_source(repository_path, source_root):
                    inputs.add(repository_path)
    return tuple(sorted(inputs))


def _reception_capture_runtime_build_digest(repo_root: Path) -> str:
    entries: list[dict[str, Any]] = []
    root = repo_root.resolve()
    for repository_path in _reception_capture_runtime_build_inputs(root):
        unresolved = root / Path(repository_path)
        _require(not unresolved.is_symlink(), "RUNTIME_BUILD_INPUT_LINKED", repository_path)
        path = _contained_repo_path(root, repository_path, "runtimeBuildInput")
        _require(path.is_file(), "RUNTIME_BUILD_INPUT_MISSING", repository_path)
        try:
            data = path.read_bytes()
        except OSError as error:
            raise VerificationError(f"RUNTIME_BUILD_INPUT_READ_FAILED: {path}: {error}") from error
        entries.append({
            "path": repository_path,
            "sizeBytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    manifest = {
        "schemaVersion": "venviewer.reception-capture-runtime-build.v1",
        "entries": entries,
    }
    return hashlib.sha256(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _reception_capture_runtime_environment_digest(environment: Any) -> str:
    record = _as_dict(environment, "rendererCapture.runtimeEnvironment")
    _require(
        set(record) == {"mobileOrigin", "qualityOrigin"},
        "RUNTIME_ENVIRONMENT_FIELDS_CHANGED",
        repr(sorted(record)),
    )
    _require(
        record == EXPECTED_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT,
        "RUNTIME_ENVIRONMENT_CHANGED",
        json.dumps(record, sort_keys=True),
    )
    canonical = json.dumps(
        record,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(
        RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DOMAIN + canonical
    ).hexdigest()


def _verify_renderer_capture(repo_root: Path, comparison: dict[str, Any]) -> None:
    capture = _as_dict(comparison.get("rendererCapture"), "rendererCapture")
    runtime_inputs = _reception_capture_runtime_build_inputs(repo_root)
    _require(set(capture) == EXPECTED_RENDERER_CAPTURE_KEYS,
             "RENDERER_CAPTURE_FIELDS_CHANGED", repr(sorted(capture)))
    boundary = (
        capture.get("schemaVersion") == "venviewer.reception-renderer-capture-evidence.v2"
        and capture.get("authority") == "none"
        and capture.get("developmentRealComponentRouteWired") is True
        and capture.get("runtimeEnvironmentBoundToPlanPerRun") is True
        and capture.get("runtimeInputBytesRecheckedPerFrame") is True
        and capture.get("runtimeInputSetReenumeratedBeforeAndAfterEachFrame") is True
        and capture.get("runtimeInputSetChangesRejected") is True
        and capture.get("installedRuntimeVersionsRecheckedPerFrame") is True
        and capture.get("liveCodeUpdatesBlocked") is True
        and capture.get("savedFrameEvidenceRecomputable") is True
        and capture.get("runtimeBuildInputCount") == len(runtime_inputs)
        and capture.get("runtimeBuildDigest") == EXPECTED_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST
        and capture.get("runtimeEnvironmentDigest")
        == EXPECTED_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST
        and _reception_capture_runtime_environment_digest(
            capture.get("runtimeEnvironment")
        ) == EXPECTED_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST
    )
    _require(boundary, "RENDERER_CAPTURE_BOUNDARY_CHANGED", json.dumps(capture, sort_keys=True))
    proof = _nonempty_string(capture.get("proofBoundary"), "rendererCapture.proofBoundary")
    _require("generated Gaussian" in proof
             and "no authorized Reception source-photo package" in proof
             and "real customer-facing app page" in proof,
             "RENDERER_CAPTURE_PROOF_OVERCLAIMED", proof)
    for label, expected in EXPECTED_RENDERER_CAPTURE_SUPPORT_ARTIFACTS.items():
        record = _as_dict(capture.get(label), f"rendererCapture.{label}")
        keys = EXPECTED_RENDERER_E2E_KEYS if label == "generatedSparkE2e" else EXPECTED_RENDERER_ARTIFACT_KEYS
        _require(set(record) == keys, "RENDERER_CAPTURE_SUPPORT_FIELDS_CHANGED", label)
        if label == "generatedSparkE2e":
            _require(record.get("passingTests") == 1, "RENDERER_CAPTURE_TEST_COUNT_CHANGED", label)
        pinned = {
            "path": expected["path"], "sizeBytes": expected["sizeBytes"],
            "sha256": expected["sha256"], "pathField": "path",
            "sizeField": "sizeBytes", "hashField": "sha256",
        }
        _verify_support_artifact(repo_root, record, pinned, label)
    actual_digest = _reception_capture_runtime_build_digest(repo_root)
    _require(actual_digest == EXPECTED_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST,
             "RUNTIME_BUILD_DIGEST_MISMATCH", actual_digest)


def _verify_source_photo_support_artifacts(
    repo_root: Path, comparison: dict[str, Any]
) -> None:
    records = {
        "scorer": _as_dict(comparison.get("scorer"), "sourcePhotoComparisonV0.scorer"),
        "browserHelper": _as_dict(
            comparison.get("browserHelper"), "sourcePhotoComparisonV0.browserHelper"
        ),
        "operatorGuide": _as_dict(
            comparison.get("operatorGuide"), "sourcePhotoComparisonV0.operatorGuide"
        ),
    }
    expected_keys = {
        "scorer": EXPECTED_SOURCE_PHOTO_SCORER_KEYS,
        "browserHelper": EXPECTED_SOURCE_PHOTO_BROWSER_KEYS,
        "operatorGuide": EXPECTED_SOURCE_PHOTO_GUIDE_KEYS,
    }
    for section, keys in expected_keys.items():
        _require(
            set(records[section]) == keys,
            "SOURCE_PHOTO_SUPPORT_FIELDS_CHANGED",
            f"{section}: {sorted(records[section])}",
        )
    for label, expected in EXPECTED_SOURCE_PHOTO_SUPPORT_ARTIFACTS.items():
        _verify_support_artifact(repo_root, records[expected["section"]], expected, label)
    scorer = records["scorer"]
    browser = records["browserHelper"]
    valid_tests = _same_json_value(
        scorer.get("passingGeneratedTests"), EXPECTED_SCORER_TEST_COUNT
    )
    valid_tests &= scorer.get("allFunctionsAtMost50Lines") is True
    valid_tests &= _same_json_value(
        browser.get("passingGeneratedFixtureTests"), EXPECTED_BROWSER_HELPER_TEST_COUNT
    )
    _require(valid_tests, "SOURCE_PHOTO_TEST_COUNTS_CHANGED", repr(records))


def _verify_source_photo_boundaries(comparison: dict[str, Any]) -> None:
    _require(
        set(comparison) == EXPECTED_SOURCE_PHOTO_KEYS,
        "SOURCE_PHOTO_FIELDS_CHANGED",
        repr(sorted(comparison)),
    )
    valid = all(
        _same_json_value(comparison.get(field), value)
        for field, value in EXPECTED_SOURCE_PHOTO_BOUNDARY.items()
    )
    _require(
        valid,
        "SOURCE_PHOTO_SAFETY_BOUNDARY_CHANGED",
        json.dumps(comparison, sort_keys=True),
    )
    receipt_boundary = _nonempty_string(
        comparison.get("receiptBoundary"), "sourcePhotoComparisonV0.receiptBoundary"
    )
    _require(
        "not independently authenticated proof" in receipt_boundary,
        "SOURCE_PHOTO_RECEIPT_BOUNDARY_CHANGED",
        receipt_boundary,
    )


def _verify_source_photo_comparison(evidence: dict[str, Any], repo_root: Path) -> None:
    comparison = _as_dict(
        evidence.get("sourcePhotoComparisonV0"), "sourcePhotoComparisonV0"
    )
    _verify_source_photo_boundaries(comparison)
    _verify_source_photo_support_artifacts(repo_root, comparison)
    _verify_renderer_capture(repo_root, comparison)
    digest = _canonical_digest(comparison)
    _require(
        digest == EXPECTED_SOURCE_PHOTO_COMPARISON_DIGEST,
        "SOURCE_PHOTO_COMPARISON_CHANGED",
        digest,
    )


def _verify_prepared_local_comparison(fixed_views: dict[str, Any]) -> None:
    prepared = _as_dict(
        fixed_views.get("preparedLocalComparison"), "preparedLocalComparison"
    )
    _require(
        set(prepared) == EXPECTED_PREPARED_LOCAL_COMPARISON_KEYS,
        "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED",
        repr(sorted(prepared)),
    )
    valid = all(
        _same_json_value(prepared.get(field), value)
        for field, value in EXPECTED_PREPARED_LOCAL_BOUNDARY.items()
    )
    _require(
        valid,
        "PREPARED_LOCAL_COMPARISON_BOUNDARY_CHANGED",
        json.dumps(prepared, sort_keys=True),
    )
    proof = _nonempty_string(
        prepared.get("browserHelperProofBoundary"),
        "preparedLocalComparison.browserHelperProofBoundary",
    )
    receipts = _nonempty_string(
        prepared.get("receiptBoundary"), "preparedLocalComparison.receiptBoundary"
    )
    _require(
        "generated fixtures" in proof
        and "generated-Gaussian Spark/Three framebuffer test" in proof
        and "no authorized Reception source-photo run" in proof
        and "real customer-facing app-page run" in proof,
        "PREPARED_LOCAL_BROWSER_BOUNDARY_CHANGED",
        proof,
    )
    _require("not independent proof" in receipts, "PREPARED_LOCAL_RECEIPTS_CHANGED", receipts)
    digest = _canonical_digest(prepared)
    _require(
        digest == EXPECTED_PREPARED_LOCAL_COMPARISON_DIGEST,
        "PREPARED_LOCAL_COMPARISON_CHANGED",
        digest,
    )


def _verify_current_reconciliation(
    evidence: dict[str, Any], repo_root: Path
) -> dict[str, Any]:
    _require(
        evidence.get("currentAsOf") == EXPECTED_CURRENT_DATE,
        "STALE_EVIDENCE_DATE",
        str(evidence.get("currentAsOf")),
    )
    reconciliation = _as_dict(
        evidence.get("currentQualityReconciliation"), "currentQualityReconciliation"
    )
    _require(
        set(reconciliation) == EXPECTED_RECONCILIATION_KEYS,
        "CURRENT_RECONCILIATION_FIELDS_CHANGED",
        repr(sorted(reconciliation)),
    )
    _require(reconciliation.get("asOf") == EXPECTED_CURRENT_DATE, "STALE_RECONCILIATION", str(reconciliation.get("asOf")))
    _require(
        reconciliation.get("currentDecision") == EXPECTED_CURRENT_DECISION,
        "STALE_OR_UNSAFE_CANDIDATE_DECISION",
        str(reconciliation.get("currentDecision")),
    )
    _require(reconciliation.get("authority") == "none", "INVALID_RECONCILIATION_AUTHORITY", str(reconciliation.get("authority")))
    _require(
        reconciliation.get("protectedReferencesReadFor2026-07-22NoReferenceAddenda") is False,
        "PROTECTED_REFERENCE_BOUNDARY_MISSING",
        "The no-reference reconciliation must explicitly record false.",
    )
    conclusion = _nonempty_string(reconciliation.get("controllingConclusion"), "controllingConclusion")
    _require("Do not declare Quality or Mobile the winner" in conclusion, "UNSAFE_CONTROLLING_CONCLUSION", conclusion)
    _verify_current_action(reconciliation)
    _verify_holdout(repo_root, reconciliation)
    _verify_no_reference_iqa(repo_root, reconciliation)
    _verify_artifact_diagnosis(repo_root, reconciliation)
    return reconciliation


def _verify_historical_candidate_receipt(evidence: dict[str, Any]) -> None:
    historical = _as_dict(
        evidence.get("latestMatchedCameraComputerVision"),
        "latestMatchedCameraComputerVision",
    )
    _require(
        historical.get("asOf") == "2026-07-16"
        and historical.get("authority") == "none"
        and historical.get("historicalOnly") is True,
        "HISTORICAL_CANDIDATE_RECEIPT_UNSAFE",
        json.dumps(historical, sort_keys=True),
    )
    scope = _as_dict(historical.get("scope"), "latestMatchedCameraComputerVision.scope")
    for field in ("physicalApproval", "runtimePromotionApproval", "publicationApproval", "trainingApproval"):
        _require(scope.get(field) is False, "HISTORICAL_APPROVAL_CHANGED", field)


def _verify_asset(asset_value: Any, index: int) -> str:
    asset = _as_dict(asset_value, f"evidence.assets[{index}]")
    missing_fields = ASSET_REQUIRED_FIELDS - set(asset)
    _require(
        not missing_fields,
        "ASSET_FIELDS_MISSING",
        f"{asset.get('id', index)}: {sorted(missing_fields)}",
    )
    asset_id = _nonempty_string(asset.get("id"), f"assets[{index}].id")
    for field in (
        "path",
        "fileType",
        "sourceRole",
        "compressionLineage",
        "limitations",
        "nextTest",
    ):
        _nonempty_string(asset.get(field), f"{asset_id}.{field}")
    _require(asset.get("evidenceStrength") == "verified", "INVALID_EVIDENCE_STRENGTH", asset_id)
    size = asset.get("sizeBytes")
    _require(type(size) is int and size >= 0, "INVALID_ASSET_SIZE", asset_id)
    sha256 = asset.get("sha256")
    _require(
        isinstance(sha256, str) and re.fullmatch(r"[0-9A-Fa-f]{64}", sha256) is not None,
        "INVALID_ASSET_SHA256",
        asset_id,
    )
    if size == 0:
        _require(sha256.lower() == EMPTY_SHA256, "INVALID_EMPTY_ASSET_SHA256", asset_id)
    return asset_id


def _verify_asset_receipts(evidence: dict[str, Any]) -> list[Any]:
    assets = _as_list(evidence.get("assets"), "evidence.assets")
    _require(len(assets) == 50, "UNEXPECTED_ASSET_COUNT", str(len(assets)))
    asset_ids = [_verify_asset(asset, index) for index, asset in enumerate(assets)]
    _require(
        len(set(asset_ids)) == len(asset_ids),
        "DUPLICATE_ASSET_IDS",
        str(len(asset_ids) - len(set(asset_ids))),
    )
    digest = _canonical_digest(sorted(assets, key=lambda item: item["id"]))
    _require(
        digest == EXPECTED_ASSET_RECEIPT_DIGEST,
        "ASSET_RECEIPT_SET_CHANGED",
        digest,
    )
    return assets


def _verify_raw_rows(raw_values: list[Any]) -> set[str]:
    raw_labels = _unique_field(raw_values, "item", "rawGoNoGo.items")
    raw_items = set(raw_labels)
    _require(
        raw_items == EXPECTED_RAW_ITEMS,
        "RAW_GO_NO_GO_FIELDS_CHANGED",
        f"missing={sorted(EXPECTED_RAW_ITEMS - raw_items)} extra={sorted(raw_items - EXPECTED_RAW_ITEMS)}",
    )
    for index, value in enumerate(raw_values):
        row = _as_dict(value, f"rawGoNoGo.items[{index}]")
        label = raw_labels[index]
        state = _nonempty_string(row.get("state"), f"{label}.state")
        _nonempty_string(row.get("evidenceStrength"), f"{label}.evidenceStrength")
        _require(state == EXPECTED_RAW_STATES[label], "RAW_STATE_CHANGED", f"{label}: {state}")
    return raw_items


def _verify_pipeline_rows(capability_values: list[Any]) -> set[str]:
    capability_labels = _unique_field(
        capability_values, "capability", "pipelineAudit.capabilities"
    )
    capabilities = set(capability_labels)
    _require(
        capabilities == EXPECTED_PIPELINE_CAPABILITIES,
        "PIPELINE_AUDIT_FIELDS_CHANGED",
        f"missing={sorted(EXPECTED_PIPELINE_CAPABILITIES - capabilities)} extra={sorted(capabilities - EXPECTED_PIPELINE_CAPABILITIES)}",
    )
    for index, value in enumerate(capability_values):
        row = _as_dict(value, f"pipelineAudit.capabilities[{index}]")
        label = capability_labels[index]
        state = _nonempty_string(row.get("state"), f"{label}.state")
        _nonempty_string(row.get("evidence"), f"{label}.evidence")
        _require(state == EXPECTED_PIPELINE_STATES[label], "PIPELINE_STATE_CHANGED", f"{label}: {state}")
    return capabilities


def _verify_blocker_rows(blocker_values: list[Any]) -> set[str]:
    blocker_labels = _unique_field(blocker_values, "id", "namedBlockers")
    blockers = set(blocker_labels)
    for index, value in enumerate(blocker_values):
        row = _as_dict(value, f"namedBlockers[{index}]")
        blocker_id = blocker_labels[index]
        for field in ("missing", "owner", "cheapestTest", "estimatedTime"):
            _nonempty_string(row.get(field), f"{blocker_id}.{field}")
        cash = row.get("externalCash")
        valid_cash = (type(cash) is int and cash >= 0) or (
            isinstance(cash, str) and bool(cash.strip())
        )
        _require(valid_cash, "INVALID_BLOCKER_EXTERNAL_CASH", blocker_id)
    return blockers


def _verify_raw_and_pipeline(evidence: dict[str, Any]) -> set[str]:
    raw_go_no_go = _as_dict(evidence.get("rawGoNoGo"), "rawGoNoGo")
    raw_values = _as_list(raw_go_no_go.get("items"), "rawGoNoGo.items")
    _verify_raw_rows(raw_values)
    pipeline = _as_dict(evidence.get("pipelineAudit"), "pipelineAudit")
    capability_values = _as_list(pipeline.get("capabilities"), "pipelineAudit.capabilities")
    _verify_pipeline_rows(capability_values)
    _require(
        pipeline.get("overall") == "not_runnable",
        "TRAINER_STATE_OVERSTATED",
        str(pipeline.get("overall")),
    )
    blocker_values = _as_list(evidence.get("namedBlockers"), "namedBlockers")
    blockers = _verify_blocker_rows(blocker_values)
    _require(
        blockers == EXPECTED_BLOCKER_IDS,
        "BLOCKER_SET_CHANGED",
        f"missing={sorted(EXPECTED_BLOCKER_IDS - blockers)} extra={sorted(blockers - EXPECTED_BLOCKER_IDS)}",
    )
    return blockers


def _find_run(post_runs: list[Any], run_id: str) -> dict[str, Any] | None:
    return next(
        (
            run
            for run in post_runs
            if isinstance(run, dict) and run.get("id") == run_id
        ),
        None,
    )


def _verify_manual_views(required: dict[str, Any]) -> list[Any]:
    manual_views = _as_list(required.get("views"), "requiredManualViews.views")
    view_ids = _unique_field(manual_views, "id", "requiredManualViews.views")
    _require(set(view_ids) == EXPECTED_FEATURE_IDS, "MANUAL_VIEW_IDS_CHANGED", repr(view_ids))
    for index, value in enumerate(manual_views):
        view = _as_dict(value, f"requiredManualViews.views[{index}]")
        _nonempty_string(view.get("featureClass"), f"{view_ids[index]}.featureClass")
        _nonempty_string(view.get("status"), f"{view_ids[index]}.status")
        files = _as_list(view.get("requiredFiles"), f"{view_ids[index]}.requiredFiles")
        file_names = [_nonempty_string(item, f"{view_ids[index]}.requiredFiles") for item in files]
        prefix = f"RR-{view_ids[index].upper()}"
        expected_files = [f"{prefix}{suffix}" for suffix in MANUAL_FILE_SUFFIXES]
        _require(file_names == expected_files, "MANUAL_VIEW_FILES_CHANGED", view_ids[index])
        sidecar = _nonempty_string(
            view.get("cameraSidecarIfUnavailable"),
            f"{view_ids[index]}.cameraSidecarIfUnavailable",
        )
        _require(
            sidecar == f"{prefix}-LCC-QUALITY-camera-unavailable.txt",
            "MANUAL_VIEW_SIDECAR_CHANGED",
            view_ids[index],
        )
    return manual_views


def _verify_feature_coverage(required: dict[str, Any]) -> None:
    coverage = _as_dict(required.get("featureStageCoverage"), "featureStageCoverage")
    _require(
        coverage.get("stages") == EXPECTED_COVERAGE_STAGES,
        "FEATURE_COVERAGE_STAGES_CHANGED",
        repr(coverage.get("stages")),
    )
    meaning = _nonempty_string(coverage.get("meaning"), "featureStageCoverage.meaning")
    _require("satisfy none" in meaning, "FEATURE_COVERAGE_MEANING_UNSAFE", meaning)
    rows = _as_list(coverage.get("rows"), "featureStageCoverage.rows")
    feature_ids = _unique_field(rows, "featureId", "featureStageCoverage.rows")
    _require(set(feature_ids) == EXPECTED_FEATURE_IDS, "FEATURE_COVERAGE_IDS_CHANGED", repr(feature_ids))
    for index, value in enumerate(rows):
        row = _as_dict(value, f"featureStageCoverage.rows[{index}]")
        for field in COVERAGE_FIELDS:
            _require(row.get(field) == "missing", "FEATURE_STAGE_FALSE_POSITIVE", f"{feature_ids[index]}.{field}")


def _verify_screenshot_receipts(fixed_views: dict[str, Any]) -> None:
    receipts = _as_list(fixed_views.get("screenshotIntegrity"), "screenshotIntegrity")
    names = _unique_field(receipts, "name", "screenshotIntegrity")
    _require(len(names) == 42, "HISTORICAL_SCREENSHOT_RECEIPTS_MISSING", "expected exactly 42")
    for index, value in enumerate(receipts):
        receipt = _as_dict(value, f"screenshotIntegrity[{index}]")
        size = receipt.get("bytes")
        sha256 = receipt.get("sha256")
        _require(type(size) is int and size > 0, "INVALID_SCREENSHOT_SIZE", names[index])
        _require(
            isinstance(sha256, str) and re.fullmatch(r"[0-9A-Fa-f]{64}", sha256) is not None,
            "INVALID_SCREENSHOT_SHA256",
            names[index],
        )
    canonical = json.dumps(
        sorted(receipts, key=lambda item: item["name"]),
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    _require(
        digest == EXPECTED_SCREENSHOT_RECEIPT_DIGEST,
        "SCREENSHOT_RECEIPT_SET_CHANGED",
        digest,
    )


def _verify_local_component_run(run: dict[str, Any]) -> None:
    _require(
        run.get("status") == "complete_pairwise_diagnostic_no_quality_winner",
        "LOCAL_RUN_STATUS_CHANGED",
        str(run.get("status")),
    )
    route_boundary = _as_dict(run.get("routeBoundary"), "localRun.routeBoundary")
    expected_boundary = {
        "developmentOnly": True,
        "hardCodedCandidatesAndViews": True,
        "arbitraryAssetUrlAccepted": False,
        "protectedAuthenticatedRoute": False,
        "excludedFromProductionBundle": True,
    }
    _require(
        _same_json_value(route_boundary, expected_boundary),
        "LOCAL_RUN_ROUTE_OVERSTATED",
        repr(route_boundary),
    )
    capture = _as_dict(run.get("capture"), "localRun.capture")
    expected_capture = {"screenshotCount": 24, "sidecarCount": 12, "byteIdenticalRepeatPairs": 12}
    _require(
        all(_same_json_value(capture.get(field), value) for field, value in expected_capture.items()),
        "LOCAL_REAL_COMPONENT_RECEIPTS_CHANGED",
        json.dumps(capture, sort_keys=True),
    )


def _verify_repo_file(repo_root: Path, value: Any, expected_hash: Any, label: str) -> None:
    path = _contained_repo_path(repo_root, value, label)
    _require(path.is_file(), "RUN_EVIDENCE_FILE_MISSING", f"{label}: {path}")
    digest = _nonempty_string(expected_hash, f"{label}.sha256")
    _require(re.fullmatch(r"[0-9a-f]{64}", digest) is not None, "INVALID_RUN_FILE_SHA256", label)
    _require(_sha256(path) == digest, "RUN_FILE_SHA256_MISMATCH", f"{label}: {path}")


def _verify_triage_source_files(repo_root: Path, run: dict[str, Any]) -> None:
    receipts = _as_dict(run.get("sourceFileReceipts"), "triageRun.sourceFileReceipts")
    expected_receipt_fields = {value[1] for value in EXPECTED_TRIAGE_FILES.values()}
    _require(
        set(receipts) == expected_receipt_fields,
        "TRIAGE_SOURCE_RECEIPT_FIELDS_CHANGED",
        repr(sorted(receipts)),
    )
    for run_field, expected in EXPECTED_TRIAGE_FILES.items():
        path, receipt_field, digest, label = expected
        _require(run.get(run_field) == path, "TRIAGE_SOURCE_PATH_CHANGED", run_field)
        _require(receipts.get(receipt_field) == digest, "TRIAGE_SOURCE_HASH_CHANGED", label)
        _verify_repo_file(repo_root, path, digest, label)


def _verify_triage_run(repo_root: Path, run: dict[str, Any]) -> None:
    _require(run.get("status") == "complete_regression_triage_no_winner", "TRIAGE_RUN_STATUS_CHANGED", str(run.get("status")))
    capture = _as_dict(run.get("capture"), "triageRun.capture")
    expected_capture = {"screenshotCount": 24, "byteIdenticalRepeatPairs": 12, "allEightSourcesUnchanged": True}
    _require(all(_same_json_value(capture.get(field), value) for field, value in expected_capture.items()), "CAPTURED_QUALITY_RECEIPTS_CHANGED", json.dumps(capture, sort_keys=True))
    metrics = _as_dict(run.get("metrics"), "triageRun.metrics")
    expected_metrics = {
        "meanAbsoluteErrorRange": [0.028078, 0.044548],
        "ssimRange": [0.939355, 0.963672],
        "psnrDbRange": [25.698124, 29.266582],
        "verdict": "review",
        "winner": "not_selected",
    }
    _require(all(_same_json_value(metrics.get(field), value) for field, value in expected_metrics.items()), "TRIAGE_METRICS_CHANGED", json.dumps(metrics, sort_keys=True))
    canonical = _as_dict(run.get("canonicalReport"), "triageRun.canonicalReport")
    expected_canonical = {"selfDigestVerified": True, **EXPECTED_TRIAGE_CANONICAL}
    _require(
        _same_json_value(canonical, expected_canonical),
        "TRIAGE_CANONICAL_RECEIPT_CHANGED",
        json.dumps(canonical, sort_keys=True),
    )
    _verify_triage_source_files(repo_root, run)


def _verify_current_interpretation(fixed_views: dict[str, Any]) -> None:
    current_interpretation = _as_dict(fixed_views.get("currentInterpretation"), "currentInterpretation")
    _require(
        set(current_interpretation) == EXPECTED_CURRENT_INTERPRETATION_KEYS,
        "CURRENT_INTERPRETATION_FIELDS_CHANGED",
        repr(sorted(current_interpretation)),
    )
    _require(
        current_interpretation.get("candidateDecision") == EXPECTED_CURRENT_DECISION,
        "FIXED_VIEW_DECISION_MISMATCH",
        str(current_interpretation.get("candidateDecision")),
    )
    _require(
        current_interpretation.get("lccCapturePaused") is True
        and current_interpretation.get("requiredExactResumePhrase")
        == EXPECTED_RESUME_PHRASE,
        "LCC_PERMISSION_BOUNDARY_MISMATCH",
        json.dumps(current_interpretation, sort_keys=True),
    )
    _require(
        current_interpretation.get("protectedReferencesReadForThisReconciliation") is False,
        "FIXED_VIEW_PROTECTED_REFERENCE_BOUNDARY_MISSING",
        repr(current_interpretation),
    )
    _require(
        _canonical_digest(current_interpretation) == EXPECTED_CURRENT_INTERPRETATION_DIGEST,
        "CURRENT_INTERPRETATION_CHANGED",
        _canonical_digest(current_interpretation),
    )


def _verify_cross_context_views(fixed_views: dict[str, Any]) -> None:
    cross = _as_dict(fixed_views.get("requiredCrossContextViews"), "requiredCrossContextViews")
    _require(set(cross) == EXPECTED_CROSS_CONTEXT_KEYS, "CROSS_CONTEXT_FIELDS_CHANGED", repr(sorted(cross)))
    _require(cross.get("status") == "blocked_missing_contexts", "CROSS_CONTEXT_STATUS_CHANGED", repr(cross.get("status")))
    _require(cross.get("blockerIds") == EXPECTED_CROSS_CONTEXT_BLOCKERS, "CROSS_CONTEXT_BLOCKERS_CHANGED", repr(cross.get("blockerIds")))
    contexts = _as_list(cross.get("contexts"), "requiredCrossContextViews.contexts")
    context_ids = _unique_field(contexts, "id", "requiredCrossContextViews.contexts")
    _require(context_ids == EXPECTED_CROSS_CONTEXT_IDS, "CROSS_CONTEXT_IDS_CHANGED", repr(context_ids))
    controls = _as_list(cross.get("historicalDiagnosticControls"), "historicalDiagnosticControls")
    control_ids = _unique_field(controls, "id", "historicalDiagnosticControls")
    _require(control_ids == EXPECTED_HISTORICAL_CONTROL_IDS, "HISTORICAL_CONTROL_IDS_CHANGED", repr(control_ids))
    portable = {key: value for key, value in cross.items() if key != "outputRoot"}
    digest = _canonical_digest(portable)
    _require(digest == EXPECTED_CROSS_CONTEXT_DIGEST_WITHOUT_OUTPUT_ROOT, "CROSS_CONTEXT_CONTENT_CHANGED", digest)


def _verify_replay_procedure(fixed_views: dict[str, Any]) -> None:
    replay = _as_dict(fixed_views.get("replayProcedure"), "replayProcedure")
    _require(set(replay) == EXPECTED_REPLAY_KEYS, "REPLAY_PROCEDURE_FIELDS_CHANGED", repr(sorted(replay)))
    safe_state = (
        replay.get("status") == "historical_do_not_run_without_exact_resume_phrase"
        and replay.get("historicalOnly") is True
        and replay.get("authorizationState") == "paused"
        and replay.get("requiredExactResumePhrase") == EXPECTED_RESUME_PHRASE
    )
    run_rule = _nonempty_string(replay.get("runRule"), "replayProcedure.runRule")
    _require(safe_state and "Do not run" in run_rule and EXPECTED_RESUME_PHRASE in run_rule, "REPLAY_PROCEDURE_UNSAFE", run_rule)
    _as_list(replay.get("historicalServerCommands"), "historicalServerCommands")
    _as_list(replay.get("historicalBrowserCommands"), "historicalBrowserCommands")
    digest = _canonical_digest(replay)
    _require(digest == EXPECTED_REPLAY_DIGEST, "REPLAY_PROCEDURE_CHANGED", digest)


def _verify_fixed_views(fixed_views: dict[str, Any], repo_root: Path) -> list[Any]:
    _require(fixed_views.get("currentAsOf") == EXPECTED_CURRENT_DATE, "STALE_FIXED_VIEW_DATE", str(fixed_views.get("currentAsOf")))
    _verify_current_interpretation(fixed_views)
    _verify_prepared_local_comparison(fixed_views)
    next_capture = _nonempty_string(fixed_views.get("nextCapture"), "nextCapture")
    _require(
        EXPECTED_RESUME_PHRASE in next_capture
        and "development real-component route" in next_capture
        and "renderer-owned asset" in next_capture
        and "source_view_diagnostic only" in next_capture
        and "Held-out execution stays disabled" in next_capture
        and "Separately" in next_capture,
        "FIXED_VIEW_NEXT_ACTION_STALE",
        next_capture,
    )
    _require(_canonical_digest(next_capture) == EXPECTED_NEXT_CAPTURE_DIGEST, "FIXED_VIEW_NEXT_ACTION_CHANGED", next_capture)
    required = _as_dict(fixed_views.get("requiredManualViews"), "requiredManualViews")
    manual_views = _verify_manual_views(required)
    _verify_feature_coverage(required)
    _verify_cross_context_views(fixed_views)
    _verify_replay_procedure(fixed_views)
    _verify_screenshot_receipts(fixed_views)
    post_runs = _as_list(fixed_views.get("postCaptureRuns"), "postCaptureRuns")
    run_ids = _unique_field(post_runs, "id", "postCaptureRuns")
    _require(set(run_ids) == EXPECTED_POST_CAPTURE_RUN_IDS, "POST_CAPTURE_RUN_SET_CHANGED", repr(run_ids))
    local_run = _find_run(post_runs, "reception-local-real-component-2026-07-16")
    _require(isinstance(local_run, dict), "LOCAL_REAL_COMPONENT_RUN_MISSING", "2026-07-16")
    _verify_local_component_run(local_run)
    triage_run = _find_run(post_runs, "reception-captured-quality-triage-2026-07-18")
    _require(isinstance(triage_run, dict), "CAPTURED_QUALITY_RUN_MISSING", "2026-07-18")
    _verify_triage_run(repo_root, triage_run)
    return manual_views


def _approach_factor_value(section: str, factor: str, approach_id: int) -> str:
    pattern = rf"^\|\s*{re.escape(factor)}\s*\|\s*(.*?)\s*\|\s*$"
    matches = re.findall(pattern, section, re.MULTILINE)
    label = f"R{approach_id}: {factor}"
    _require(bool(matches), "APPROACH_FACTOR_MISSING", label)
    _require(len(matches) == 1, "APPROACH_FACTOR_DUPLICATE", label)
    value = matches[0].strip()
    _require(bool(value), "APPROACH_FACTOR_EMPTY", label)
    return value


def _verify_decision_matrix(matrix: str) -> dict[int, str]:
    approaches = _approach_sections(matrix)
    _require(
        set(approaches) == EXPECTED_APPROACH_IDS,
        "APPROACH_REGISTRY_INCOMPLETE",
        f"found={sorted(approaches)}",
    )
    for approach_id, section in sorted(approaches.items()):
        for factor in REQUIRED_APPROACH_FACTORS:
            _approach_factor_value(section, factor, approach_id)
    _require(
        EXPECTED_CURRENT_DECISION in matrix,
        "MATRIX_CURRENT_DECISION_MISSING",
        EXPECTED_CURRENT_DECISION,
    )
    _require(
        "NVIDIA Fixer v2" in matrix and "ArtiFixer v1" in matrix,
        "GENERATED_ROUTE_NOT_SPLIT",
        "ArtiFixer v1 and NVIDIA Fixer v2 must be distinguished.",
    )
    return approaches


def _verify_historical_success_audit(root_report: str) -> None:
    start = "## 2. SUCCESS-CRITERIA AUDIT"
    end = "## 3. EVIDENCE CHAIN"
    section = root_report.split(start, 1)[1].split(end, 1)[0]
    marker = "Historical assessment — use Section 23 for the current A–I status."
    _require(marker in section, "HISTORICAL_AUDIT_MARKER_MISSING", marker)
    for criterion in "ABCDEFGHI":
        _require(
            f"| {criterion}." in section,
            "HISTORICAL_CRITERION_ROW_MISSING",
            criterion,
        )


def _verify_root_report(root_report: str) -> None:
    for number, title in REQUIRED_FINAL_SECTIONS.items():
        pattern = rf"^## {number}\. {re.escape(title)}\s*$"
        _require(
            re.search(pattern, root_report, re.MULTILINE) is not None,
            "FINAL_SECTION_MISSING",
            f"{number}. {title}",
        )
    _verify_historical_success_audit(root_report)
    _require(
        "## 23. 2026-07-22 CURRENT DECISION RECONCILIATION" in root_report,
        "CURRENT_ROOT_RECONCILIATION_MISSING",
        "section 23",
    )
    _require(
        EXPECTED_CURRENT_DECISION in root_report
        and f"`{EXPECTED_RESUME_PHRASE}`" in root_report,
        "ROOT_DECISION_OR_PERMISSION_MISSING",
        "current decision and exact resume phrase are required",
    )
    _require(
        "PRODUCT GOAL REMAINS OPEN" in root_report,
        "PRODUCT_GOAL_STATE_OVERSTATED",
        "The investigation must not claim product completion.",
    )
    for missing_interface in (
        "venviewer_training.register_reception",
        "venviewer_training.build_reception_scaffold",
        "venviewer_training.localize_holdout",
        "tools/reception-hd/package.ts",
        "tools/reception-hd/evaluate.ts",
        "configs/training/reception_config_b.yaml",
    ):
        _require(
            missing_interface not in root_report,
            "NONEXISTENT_PILOT_INTERFACE_PRESENT",
            missing_interface,
        )


def _verify_goal_status(
    evidence: dict[str, Any], root_report: str
) -> tuple[dict[str, str], list[str]]:
    status = _as_dict(evidence.get("currentGoalStatus"), "currentGoalStatus")
    _require(status.get("productGoalComplete") is False, "PRODUCT_GOAL_STATE_OVERSTATED", "evidence")
    criteria = _as_dict(status.get("criteria"), "currentGoalStatus.criteria")
    _require(criteria == EXPECTED_CRITERIA, "CURRENT_CRITERIA_CHANGED", json.dumps(criteria, sort_keys=True))
    blocking = _as_list(status.get("blockingCriteria"), "currentGoalStatus.blockingCriteria")
    _require(blocking == EXPECTED_BLOCKING_CRITERIA, "BLOCKING_CRITERIA_CHANGED", repr(blocking))
    heading = "## 23. 2026-07-22 CURRENT DECISION RECONCILIATION"
    current_section = root_report.split(heading, 1)[1]
    for criterion, marker in CURRENT_CRITERIA_MARKERS.items():
        _require(marker in current_section, "CURRENT_CRITERION_ROW_MISSING", criterion)
    return dict(criteria), list(blocking)


def _verify_strategy_patch(strategy_patch: str) -> None:
    _require(
        "**Status:** proposal only" in strategy_patch,
        "STRATEGY_PATCH_STATUS_CHANGED",
        "canonical strategy must not be silently rewritten",
    )
    for patch_id in ("P-42", "P-43", "P-44"):
        _require(
            f"| {patch_id} |" in strategy_patch,
            "CURRENT_STRATEGY_CORRECTION_MISSING",
            patch_id,
        )


def _verify_artifact_digests(paths: dict[str, Path]) -> None:
    _require(
        set(paths) == set(EXPECTED_ARTIFACT_SHA256),
        "ARTIFACT_DIGEST_KEYS_CHANGED",
        repr(sorted(paths)),
    )
    for label, expected in EXPECTED_ARTIFACT_SHA256.items():
        actual = _sha256(paths[label])
        _require(actual == expected, "ARTIFACT_SHA256_MISMATCH", f"{label}: {actual}")


def _verification_result(
    paths: dict[str, Path],
    assets: list[Any],
    approaches: dict[int, str],
    manual_views: list[Any],
    blockers: set[Any],
    criteria: dict[str, str],
    blocking_criteria: list[str],
) -> dict[str, Any]:
    return {
        "status": "PASS_DECISION_READY_PRODUCT_GOAL_OPEN",
        "productGoalComplete": False,
        "currentAsOf": "2026-07-22",
        "currentCandidateDecision": EXPECTED_CURRENT_DECISION,
        "requiredArtifactCount": len(paths),
        "sourcePhotoSupportArtifactCount": (
            len(EXPECTED_SOURCE_PHOTO_SUPPORT_ARTIFACTS)
            + len(EXPECTED_RENDERER_CAPTURE_SUPPORT_ARTIFACTS)
        ),
        "runtimeDeliverySupportArtifactCount": len(
            EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS
        ),
        "assetReceiptCount": len(assets),
        "approachCount": len(approaches),
        "manualFeatureViewCount": len(manual_views),
        "namedBlockerCount": len(blockers),
        "criteria": criteria,
        "blockingCriteria": blocking_criteria,
        "nextAuthorizedAction": {
            "state": "paused",
            "requiredExactPhrase": EXPECTED_RESUME_PHRASE,
        },
        "verificationScope": (
            "Five required reports, nine source-photo and renderer-capture support artifacts, "
            f"{len(EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS)} runtime-delivery support artifacts, "
            "their current reconciliation, structural receipts, approach-field coverage and "
            "permission boundary. Raw assets and protected references were not opened or re-hashed."
        ),
    }


def verify_goal_artifacts(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    paths = _resolve_artifact_paths(repo_root)
    evidence = _read_json(paths["evidence"])
    fixed_views = _read_json(paths["fixedViews"])
    root_report = _read_text(paths["rootReport"])
    matrix = _read_text(paths["decisionMatrix"])
    strategy_patch = _read_text(paths["strategyPatch"])

    _verify_current_reconciliation(evidence, root)
    _verify_runtime_delivery_hardening(evidence, root)
    _verify_source_photo_comparison(evidence, root)
    _verify_historical_candidate_receipt(evidence)
    assets = _verify_asset_receipts(evidence)
    blockers = _verify_raw_and_pipeline(evidence)
    manual_views = _verify_fixed_views(fixed_views, root)
    approaches = _verify_decision_matrix(matrix)
    _verify_root_report(root_report)
    criteria, blocking_criteria = _verify_goal_status(evidence, root_report)
    _verify_strategy_patch(strategy_patch)
    _verify_artifact_digests(paths)
    return _verification_result(
        paths,
        assets,
        approaches,
        manual_views,
        blockers,
        criteria,
        blocking_criteria,
    )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify the five Reception Room goal artifacts without touching raw assets, "
            "protected references, or LCC."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = verify_goal_artifacts(args.repo_root)
    except VerificationError as error:
        parser.exit(2, f"error: {error}\n")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
