import { z } from "zod";
export declare const FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0 = "omnitwin.foundry.captured-quality-comparison-report.v0";
export declare const FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0";
export declare const FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS: readonly ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
declare const ReportPayloadSchema: z.ZodEffects<z.ZodObject<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.captured-quality-comparison-report.v0">;
    generatedAt: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    authority: z.ZodLiteral<"none">;
    resultType: z.ZodLiteral<"regression_triage_not_acceptance">;
    winner: z.ZodLiteral<"not_selected">;
    sourceReceiptSha256: z.ZodNullable<z.ZodString>;
    candidateProfiles: z.ZodTuple<[z.ZodEffects<z.ZodObject<{
        profileId: z.ZodLiteral<"quality-sog-fine-v1">;
        expectedGaussianCount: z.ZodNumber;
        decodedGaussianCount: z.ZodNumber;
        assets: z.ZodTuple<[z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>], null>;
    }, "strict", z.ZodTypeAny, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>, z.ZodEffects<z.ZodObject<{
        profileId: z.ZodLiteral<"mobile-spz-fine-v1">;
        expectedGaussianCount: z.ZodNumber;
        decodedGaussianCount: z.ZodNumber;
        assets: z.ZodTuple<[z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>], null>;
    }, "strict", z.ZodTypeAny, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>], null>;
    rendererProfile: z.ZodObject<{
        id: z.ZodString;
        profileSha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        profileSha256: string;
    }, {
        id: string;
        profileSha256: string;
    }>;
    viewport: z.ZodObject<{
        widthPx: z.ZodNumber;
        heightPx: z.ZodNumber;
        deviceScaleFactor: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    }, {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    }>;
    views: z.ZodArray<z.ZodObject<{
        viewId: z.ZodString;
        kind: z.ZodEnum<["e57_matched", "spatial_near", "spatial_mid", "spatial_far", "orbit", "other_reviewed"]>;
        camera: z.ZodEffects<z.ZodObject<{
            model: z.ZodLiteral<"perspective">;
            position: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            target: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            up: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            verticalFovDegrees: z.ZodNumber;
            nearClip: z.ZodNumber;
            farClip: z.ZodNumber;
            viewMatrix: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            projectionMatrix: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
        }, "strict", z.ZodTypeAny, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }>, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }>;
    }, "strict", z.ZodTypeAny, {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }, {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }>, "many">;
    captures: z.ZodTuple<[z.ZodObject<{
        profileId: z.ZodLiteral<"quality-sog-fine-v1">;
        views: z.ZodArray<z.ZodObject<{
            viewId: z.ZodString;
            repeats: z.ZodTuple<[z.ZodObject<{
                repeat: z.ZodLiteral<1>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>, z.ZodObject<{
                repeat: z.ZodLiteral<2>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>], null>;
        }, "strict", z.ZodTypeAny, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }>, z.ZodObject<{
        profileId: z.ZodLiteral<"mobile-spz-fine-v1">;
        views: z.ZodArray<z.ZodObject<{
            viewId: z.ZodString;
            repeats: z.ZodTuple<[z.ZodObject<{
                repeat: z.ZodLiteral<1>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>, z.ZodObject<{
                repeat: z.ZodLiteral<2>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>], null>;
        }, "strict", z.ZodTypeAny, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }>], null>;
    pairMetrics: z.ZodArray<z.ZodObject<{
        viewId: z.ZodString;
        repeats: z.ZodTuple<[z.ZodObject<{
            repeat: z.ZodLiteral<1>;
            qualityScreenshotSha256: z.ZodString;
            mobileScreenshotSha256: z.ZodString;
            metrics: z.ZodObject<{
                comparedPixelCount: z.ZodNumber;
                meanAbsoluteError: z.ZodNumber;
                rootMeanSquareError: z.ZodNumber;
                psnrDb: z.ZodNullable<z.ZodNumber>;
                ssim: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }>;
        }, "strict", z.ZodTypeAny, {
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }>, z.ZodObject<{
            repeat: z.ZodLiteral<2>;
            qualityScreenshotSha256: z.ZodString;
            mobileScreenshotSha256: z.ZodString;
            metrics: z.ZodObject<{
                comparedPixelCount: z.ZodNumber;
                meanAbsoluteError: z.ZodNumber;
                rootMeanSquareError: z.ZodNumber;
                psnrDb: z.ZodNullable<z.ZodNumber>;
                ssim: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }>;
        }, "strict", z.ZodTypeAny, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }>], null>;
    }, "strict", z.ZodTypeAny, {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }, {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }>, "many">;
    sourceIntegrity: z.ZodObject<{
        preCapture: z.ZodArray<z.ZodObject<{
            profileId: z.ZodEnum<["quality-sog-fine-v1", "mobile-spz-fine-v1"]>;
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }>, "many">;
        postCapture: z.ZodArray<z.ZodObject<{
            profileId: z.ZodEnum<["quality-sog-fine-v1", "mobile-spz-fine-v1"]>;
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }>, "many">;
        allSourcesUnchanged: z.ZodLiteral<true>;
    }, "strict", z.ZodTypeAny, {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    }, {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    }>;
    scorer: z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
        implementationSha256: z.ZodString;
        receiptSha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    }, {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    }>;
    limitations: z.ZodTuple<[z.ZodLiteral<"This authority-none report is regression-triage evidence only and is not a product-acceptance decision.">, z.ZodLiteral<"Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.">, z.ZodLiteral<"No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.">, z.ZodLiteral<"A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.">, z.ZodLiteral<"This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.">, z.ZodLiteral<"Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation.">], null>;
    externalRequests: z.ZodLiteral<0>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}>, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}>;
type FoundryCapturedQualityComparisonReportPayloadV0 = z.infer<typeof ReportPayloadSchema>;
export declare function computeFoundryCapturedQualityComparisonReportSha256(input: unknown): string;
export declare const FoundryCapturedQualityComparisonReportV0Schema: z.ZodEffects<z.ZodObject<z.objectUtil.extendShape<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.captured-quality-comparison-report.v0">;
    generatedAt: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    authority: z.ZodLiteral<"none">;
    resultType: z.ZodLiteral<"regression_triage_not_acceptance">;
    winner: z.ZodLiteral<"not_selected">;
    sourceReceiptSha256: z.ZodNullable<z.ZodString>;
    candidateProfiles: z.ZodTuple<[z.ZodEffects<z.ZodObject<{
        profileId: z.ZodLiteral<"quality-sog-fine-v1">;
        expectedGaussianCount: z.ZodNumber;
        decodedGaussianCount: z.ZodNumber;
        assets: z.ZodTuple<[z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>], null>;
    }, "strict", z.ZodTypeAny, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>, z.ZodEffects<z.ZodObject<{
        profileId: z.ZodLiteral<"mobile-spz-fine-v1">;
        expectedGaussianCount: z.ZodNumber;
        decodedGaussianCount: z.ZodNumber;
        assets: z.ZodTuple<[z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>, z.ZodObject<{
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }>], null>;
    }, "strict", z.ZodTypeAny, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }>], null>;
    rendererProfile: z.ZodObject<{
        id: z.ZodString;
        profileSha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        profileSha256: string;
    }, {
        id: string;
        profileSha256: string;
    }>;
    viewport: z.ZodObject<{
        widthPx: z.ZodNumber;
        heightPx: z.ZodNumber;
        deviceScaleFactor: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    }, {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    }>;
    views: z.ZodArray<z.ZodObject<{
        viewId: z.ZodString;
        kind: z.ZodEnum<["e57_matched", "spatial_near", "spatial_mid", "spatial_far", "orbit", "other_reviewed"]>;
        camera: z.ZodEffects<z.ZodObject<{
            model: z.ZodLiteral<"perspective">;
            position: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            target: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            up: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            verticalFovDegrees: z.ZodNumber;
            nearClip: z.ZodNumber;
            farClip: z.ZodNumber;
            viewMatrix: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
            projectionMatrix: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
        }, "strict", z.ZodTypeAny, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }>, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }, {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        }>;
    }, "strict", z.ZodTypeAny, {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }, {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }>, "many">;
    captures: z.ZodTuple<[z.ZodObject<{
        profileId: z.ZodLiteral<"quality-sog-fine-v1">;
        views: z.ZodArray<z.ZodObject<{
            viewId: z.ZodString;
            repeats: z.ZodTuple<[z.ZodObject<{
                repeat: z.ZodLiteral<1>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>, z.ZodObject<{
                repeat: z.ZodLiteral<2>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>], null>;
        }, "strict", z.ZodTypeAny, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }>, z.ZodObject<{
        profileId: z.ZodLiteral<"mobile-spz-fine-v1">;
        views: z.ZodArray<z.ZodObject<{
            viewId: z.ZodString;
            repeats: z.ZodTuple<[z.ZodObject<{
                repeat: z.ZodLiteral<1>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>, z.ZodObject<{
                repeat: z.ZodLiteral<2>;
                screenshot: z.ZodObject<{
                    mediaType: z.ZodLiteral<"image/png">;
                    widthPx: z.ZodNumber;
                    heightPx: z.ZodNumber;
                    sizeBytes: z.ZodNumber;
                    sha256: z.ZodString;
                }, "strict", z.ZodTypeAny, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }, {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                }>;
                telemetry: z.ZodEffects<z.ZodObject<{
                    loadedAssetCount: z.ZodLiteral<4>;
                    loadedBytes: z.ZodNumber;
                    decodedGaussianCount: z.ZodNumber;
                    assetLoadDurationMs: z.ZodNumber;
                    settleDurationMs: z.ZodNumber;
                    screenshotDurationMs: z.ZodNumber;
                    totalDurationMs: z.ZodNumber;
                    frameSampleCount: z.ZodNumber;
                    frameTimeP50Ms: z.ZodNumber;
                    frameTimeP95Ms: z.ZodNumber;
                    frameTimeP99Ms: z.ZodNumber;
                }, "strict", z.ZodTypeAny, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }, {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                }>;
            }, "strict", z.ZodTypeAny, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }>], null>;
        }, "strict", z.ZodTypeAny, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }, {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }>], null>;
    pairMetrics: z.ZodArray<z.ZodObject<{
        viewId: z.ZodString;
        repeats: z.ZodTuple<[z.ZodObject<{
            repeat: z.ZodLiteral<1>;
            qualityScreenshotSha256: z.ZodString;
            mobileScreenshotSha256: z.ZodString;
            metrics: z.ZodObject<{
                comparedPixelCount: z.ZodNumber;
                meanAbsoluteError: z.ZodNumber;
                rootMeanSquareError: z.ZodNumber;
                psnrDb: z.ZodNullable<z.ZodNumber>;
                ssim: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }>;
        }, "strict", z.ZodTypeAny, {
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }>, z.ZodObject<{
            repeat: z.ZodLiteral<2>;
            qualityScreenshotSha256: z.ZodString;
            mobileScreenshotSha256: z.ZodString;
            metrics: z.ZodObject<{
                comparedPixelCount: z.ZodNumber;
                meanAbsoluteError: z.ZodNumber;
                rootMeanSquareError: z.ZodNumber;
                psnrDb: z.ZodNullable<z.ZodNumber>;
                ssim: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }, {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            }>;
        }, "strict", z.ZodTypeAny, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }>], null>;
    }, "strict", z.ZodTypeAny, {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }, {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }>, "many">;
    sourceIntegrity: z.ZodObject<{
        preCapture: z.ZodArray<z.ZodObject<{
            profileId: z.ZodEnum<["quality-sog-fine-v1", "mobile-spz-fine-v1"]>;
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }>, "many">;
        postCapture: z.ZodArray<z.ZodObject<{
            profileId: z.ZodEnum<["quality-sog-fine-v1", "mobile-spz-fine-v1"]>;
            pathLabel: z.ZodEffects<z.ZodString, string, string>;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }>, "many">;
        allSourcesUnchanged: z.ZodLiteral<true>;
    }, "strict", z.ZodTypeAny, {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    }, {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    }>;
    scorer: z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
        implementationSha256: z.ZodString;
        receiptSha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    }, {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    }>;
    limitations: z.ZodTuple<[z.ZodLiteral<"This authority-none report is regression-triage evidence only and is not a product-acceptance decision.">, z.ZodLiteral<"Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.">, z.ZodLiteral<"No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.">, z.ZodLiteral<"A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.">, z.ZodLiteral<"This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.">, z.ZodLiteral<"Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation.">], null>;
    externalRequests: z.ZodLiteral<0>;
}, {
    reportSha256: z.ZodString;
}>, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    reportSha256: string;
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    reportSha256: string;
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}>, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    reportSha256: string;
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}, {
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0";
    authority: "none";
    limitations: ["This authority-none report is regression-triage evidence only and is not a product-acceptance decision.", "Rendered-image comparisons and camera matrices do not establish physical accuracy, metric registration, survey fitness, or real-world completeness.", "No candidate winner is selected by this report; any later selection requires a separately reviewed decision bound to the exact evidence.", "A self-digest detects un-recomputed changes only; it is not a signature, trusted timestamp, execution attestation, or provenance proof.", "This report does not establish source rights, privacy clearance, publication permission, training permission, or release authority.", "Zero external requests records the declared boundary of this comparison report; it does not independently prove operating-system or network isolation."];
    reportSha256: string;
    generatedAt: string;
    resultType: "regression_triage_not_acceptance";
    winner: "not_selected";
    sourceReceiptSha256: string | null;
    candidateProfiles: [{
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "quality-sog-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }, {
        assets: [{
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }, {
            sizeBytes: number;
            sha256: string;
            pathLabel: string;
        }];
        profileId: "mobile-spz-fine-v1";
        expectedGaussianCount: number;
        decodedGaussianCount: number;
    }];
    rendererProfile: {
        id: string;
        profileSha256: string;
    };
    viewport: {
        widthPx: number;
        heightPx: number;
        deviceScaleFactor: number;
    };
    views: {
        kind: "e57_matched" | "spatial_near" | "spatial_mid" | "spatial_far" | "orbit" | "other_reviewed";
        viewId: string;
        camera: {
            position: [number, number, number];
            target: [number, number, number];
            model: "perspective";
            up: [number, number, number];
            verticalFovDegrees: number;
            nearClip: number;
            farClip: number;
            viewMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
            projectionMatrix: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
        };
    }[];
    captures: [{
        profileId: "quality-sog-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }, {
        profileId: "mobile-spz-fine-v1";
        views: {
            viewId: string;
            repeats: [{
                repeat: 1;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }, {
                repeat: 2;
                screenshot: {
                    sizeBytes: number;
                    sha256: string;
                    mediaType: "image/png";
                    widthPx: number;
                    heightPx: number;
                };
                telemetry: {
                    decodedGaussianCount: number;
                    loadedAssetCount: 4;
                    loadedBytes: number;
                    assetLoadDurationMs: number;
                    settleDurationMs: number;
                    screenshotDurationMs: number;
                    totalDurationMs: number;
                    frameSampleCount: number;
                    frameTimeP50Ms: number;
                    frameTimeP95Ms: number;
                    frameTimeP99Ms: number;
                };
            }];
        }[];
    }];
    pairMetrics: {
        viewId: string;
        repeats: [{
            repeat: 1;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }, {
            repeat: 2;
            qualityScreenshotSha256: string;
            mobileScreenshotSha256: string;
            metrics: {
                comparedPixelCount: number;
                meanAbsoluteError: number;
                rootMeanSquareError: number;
                psnrDb: number | null;
                ssim: number;
            };
        }];
    }[];
    sourceIntegrity: {
        preCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        postCapture: {
            sizeBytes: number;
            sha256: string;
            profileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
            pathLabel: string;
        }[];
        allSourcesUnchanged: true;
    };
    scorer: {
        receiptSha256: string;
        version: string;
        id: string;
        implementationSha256: string;
    };
    externalRequests: 0;
}>;
export type FoundryCapturedQualityComparisonReportV0 = z.infer<typeof FoundryCapturedQualityComparisonReportV0Schema>;
export type CompileFoundryCapturedQualityComparisonReportV0Input = Omit<FoundryCapturedQualityComparisonReportPayloadV0, "schemaVersion" | "authority" | "resultType" | "winner" | "limitations" | "externalRequests">;
export declare function compileFoundryCapturedQualityComparisonReportV0(input: CompileFoundryCapturedQualityComparisonReportV0Input): FoundryCapturedQualityComparisonReportV0;
export declare function verifyFoundryCapturedQualityComparisonReportV0(input: unknown): FoundryCapturedQualityComparisonReportV0;
export declare function serializeFoundryCapturedQualityComparisonReportV0(value: FoundryCapturedQualityComparisonReportV0): string;
export {};
//# sourceMappingURL=captured-quality-comparison.d.ts.map