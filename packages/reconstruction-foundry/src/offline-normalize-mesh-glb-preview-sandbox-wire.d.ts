import { z } from "zod";
import { type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0, type FoundryOfflineNormalizeMeshGlbPreviewReportV0 } from "./offline-normalize-mesh-glb-preview.js";
export declare const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0 = "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
export declare const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES: number;
export declare const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES = 48;
export declare const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES = 40;
type RequestRole = "transform" | "fresh_verifier";
export declare const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES: readonly ["REQUEST_INVALID", "DEADLINE_EXCEEDED", "TRANSFORM_FAILED", "VERIFICATION_FAILED", "OUTPUT_LIMIT_EXCEEDED", "CANCELLED", "INTERNAL_FAILURE"];
export declare const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES: number;
export declare const FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0">;
    messageType: z.ZodLiteral<"request">;
    role: z.ZodLiteral<"transform">;
    requestId: z.ZodString;
    deadlineAt: z.ZodEffects<z.ZodString, string, string>;
    invocation: z.ZodEffects<z.ZodObject<{
        schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0">;
        operation: z.ZodLiteral<"normalize_mesh_glb">;
        operationVersion: z.ZodLiteral<"v0">;
        sealedIdentity: z.ZodTuple<[z.ZodLiteral<"normalize_mesh_glb">, z.ZodLiteral<"v0">, z.ZodLiteral<"core-static-triangles-meshopt-lossless-proof">], null>;
        executionMode: z.ZodLiteral<"offline_private_authority_none_preview">;
        source: z.ZodObject<{
            assetId: z.ZodString;
            inputType: z.ZodLiteral<"glb_gltf">;
            mediaType: z.ZodLiteral<"model/gltf-binary">;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }>;
        permit: z.ZodObject<{
            payloadSha256: z.ZodString;
            keyId: z.ZodString;
            expiresAt: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }>;
        operatorAcknowledgement: z.ZodEffects<z.ZodObject<z.objectUtil.extendShape<{
            schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0">;
            acknowledgementId: z.ZodString;
            operatorId: z.ZodString;
            recordedAt: z.ZodString;
            acknowledgement: z.ZodLiteral<"operator_records_private_offline_preview_intent">;
            statement: z.ZodLiteral<"I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.">;
            legalPosture: z.ZodLiteral<"operator_statement_not_independent_rights_approval">;
            authorizationPosture: z.ZodLiteral<"operator_statement_recorded_not_a_permit">;
            independentRightsApprovalEstablished: z.ZodLiteral<false>;
            operatorStatementEstablishesExecutionPermit: z.ZodLiteral<false>;
            source: z.ZodObject<Pick<{
                assetId: z.ZodString;
                inputType: z.ZodLiteral<"glb_gltf">;
                mediaType: z.ZodLiteral<"model/gltf-binary">;
                sizeBytes: z.ZodNumber;
                sha256: z.ZodString;
            }, "sizeBytes" | "sha256" | "assetId">, "strict", z.ZodTypeAny, {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            }, {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            }>;
            operation: z.ZodObject<{
                operation: z.ZodLiteral<"normalize_mesh_glb">;
                operationVersion: z.ZodLiteral<"v0">;
                sealedIdentity: z.ZodTuple<[z.ZodLiteral<"normalize_mesh_glb">, z.ZodLiteral<"v0">, z.ZodLiteral<"core-static-triangles-meshopt-lossless-proof">], null>;
            }, "strict", z.ZodTypeAny, {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            }, {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            }>;
            authority: z.ZodLiteral<"none">;
        }, {
            acknowledgementSha256: z.ZodString;
        }>, "strict", z.ZodTypeAny, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }>, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }>;
        operatorAcknowledgementSha256: z.ZodString;
        outputPolicy: z.ZodObject<{
            disposition: z.ZodLiteral<"private_quarantine_only">;
            persistence: z.ZodLiteral<"not_performed_by_pure_in_memory_primitive">;
            releaseEligible: z.ZodLiteral<false>;
            trainingEligible: z.ZodLiteral<false>;
            redistributionEligible: z.ZodLiteral<false>;
            signingEligible: z.ZodLiteral<false>;
            registrationEligible: z.ZodLiteral<false>;
            publicationEligible: z.ZodLiteral<false>;
            promotionEligible: z.ZodLiteral<false>;
            measurementEligible: z.ZodLiteral<false>;
            authority: z.ZodLiteral<"none">;
        }, "strict", z.ZodTypeAny, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }>;
        executionBoundary: z.ZodObject<{
            primitiveKind: z.ZodLiteral<"pure_in_memory">;
            filesystemAccess: z.ZodLiteral<"none">;
            networkAccess: z.ZodLiteral<"none">;
            childProcesses: z.ZodLiteral<"none">;
            sandboxEstablished: z.ZodLiteral<false>;
            custodyEstablished: z.ZodLiteral<false>;
            rightsAuthorizationEstablished: z.ZodLiteral<false>;
            replayProtectionEstablished: z.ZodLiteral<false>;
            sandboxStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            custodyStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            rightsAuthorizationStatement: z.ZodLiteral<"not_established_by_operator_acknowledgement_or_pure_in_memory_primitive">;
            replayProtectionStatement: z.ZodLiteral<"one_run_permit_consumption_requires_trusted_process_controller">;
        }, "strict", z.ZodTypeAny, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }>;
        authority: z.ZodLiteral<"none">;
    }, "strict", z.ZodTypeAny, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }>, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }>;
    permitEnvelope: z.ZodEffects<z.ZodObject<{
        payloadType: z.ZodString;
        payload: z.ZodEffects<z.ZodString, string, string>;
        signatures: z.ZodArray<z.ZodObject<{
            keyid: z.ZodString;
            sig: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
        }, "strict", z.ZodTypeAny, {
            keyid: string;
            sig: string;
        }, {
            keyid: string;
            sig: string;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }>, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }>;
    permitPublicKey: z.ZodObject<{
        keyId: z.ZodString;
        spkiDerBase64: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        keyId: string;
        spkiDerBase64: string;
    }, {
        keyId: string;
        spkiDerBase64: string;
    }>;
    blobs: z.ZodTuple<[z.ZodObject<{
        kind: z.ZodLiteral<"source">;
        sizeBytes: z.ZodNumber;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }>], null>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "transform";
    messageType: "request";
    requestId: string;
    deadlineAt: string;
    invocation: {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    };
    permitEnvelope: {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    };
    permitPublicKey: {
        keyId: string;
        spkiDerBase64: string;
    };
    blobs: [{
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }];
}, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "transform";
    messageType: "request";
    requestId: string;
    deadlineAt: string;
    invocation: {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    };
    permitEnvelope: {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    };
    permitPublicKey: {
        keyId: string;
        spkiDerBase64: string;
    };
    blobs: [{
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }];
}>;
export declare const FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0">;
    messageType: z.ZodLiteral<"request">;
    role: z.ZodLiteral<"fresh_verifier">;
    requestId: z.ZodString;
    deadlineAt: z.ZodEffects<z.ZodString, string, string>;
    invocation: z.ZodEffects<z.ZodObject<{
        schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0">;
        operation: z.ZodLiteral<"normalize_mesh_glb">;
        operationVersion: z.ZodLiteral<"v0">;
        sealedIdentity: z.ZodTuple<[z.ZodLiteral<"normalize_mesh_glb">, z.ZodLiteral<"v0">, z.ZodLiteral<"core-static-triangles-meshopt-lossless-proof">], null>;
        executionMode: z.ZodLiteral<"offline_private_authority_none_preview">;
        source: z.ZodObject<{
            assetId: z.ZodString;
            inputType: z.ZodLiteral<"glb_gltf">;
            mediaType: z.ZodLiteral<"model/gltf-binary">;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }>;
        permit: z.ZodObject<{
            payloadSha256: z.ZodString;
            keyId: z.ZodString;
            expiresAt: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }>;
        operatorAcknowledgement: z.ZodEffects<z.ZodObject<z.objectUtil.extendShape<{
            schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0">;
            acknowledgementId: z.ZodString;
            operatorId: z.ZodString;
            recordedAt: z.ZodString;
            acknowledgement: z.ZodLiteral<"operator_records_private_offline_preview_intent">;
            statement: z.ZodLiteral<"I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.">;
            legalPosture: z.ZodLiteral<"operator_statement_not_independent_rights_approval">;
            authorizationPosture: z.ZodLiteral<"operator_statement_recorded_not_a_permit">;
            independentRightsApprovalEstablished: z.ZodLiteral<false>;
            operatorStatementEstablishesExecutionPermit: z.ZodLiteral<false>;
            source: z.ZodObject<Pick<{
                assetId: z.ZodString;
                inputType: z.ZodLiteral<"glb_gltf">;
                mediaType: z.ZodLiteral<"model/gltf-binary">;
                sizeBytes: z.ZodNumber;
                sha256: z.ZodString;
            }, "sizeBytes" | "sha256" | "assetId">, "strict", z.ZodTypeAny, {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            }, {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            }>;
            operation: z.ZodObject<{
                operation: z.ZodLiteral<"normalize_mesh_glb">;
                operationVersion: z.ZodLiteral<"v0">;
                sealedIdentity: z.ZodTuple<[z.ZodLiteral<"normalize_mesh_glb">, z.ZodLiteral<"v0">, z.ZodLiteral<"core-static-triangles-meshopt-lossless-proof">], null>;
            }, "strict", z.ZodTypeAny, {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            }, {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            }>;
            authority: z.ZodLiteral<"none">;
        }, {
            acknowledgementSha256: z.ZodString;
        }>, "strict", z.ZodTypeAny, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }>, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }, {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        }>;
        operatorAcknowledgementSha256: z.ZodString;
        outputPolicy: z.ZodObject<{
            disposition: z.ZodLiteral<"private_quarantine_only">;
            persistence: z.ZodLiteral<"not_performed_by_pure_in_memory_primitive">;
            releaseEligible: z.ZodLiteral<false>;
            trainingEligible: z.ZodLiteral<false>;
            redistributionEligible: z.ZodLiteral<false>;
            signingEligible: z.ZodLiteral<false>;
            registrationEligible: z.ZodLiteral<false>;
            publicationEligible: z.ZodLiteral<false>;
            promotionEligible: z.ZodLiteral<false>;
            measurementEligible: z.ZodLiteral<false>;
            authority: z.ZodLiteral<"none">;
        }, "strict", z.ZodTypeAny, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }>;
        executionBoundary: z.ZodObject<{
            primitiveKind: z.ZodLiteral<"pure_in_memory">;
            filesystemAccess: z.ZodLiteral<"none">;
            networkAccess: z.ZodLiteral<"none">;
            childProcesses: z.ZodLiteral<"none">;
            sandboxEstablished: z.ZodLiteral<false>;
            custodyEstablished: z.ZodLiteral<false>;
            rightsAuthorizationEstablished: z.ZodLiteral<false>;
            replayProtectionEstablished: z.ZodLiteral<false>;
            sandboxStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            custodyStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            rightsAuthorizationStatement: z.ZodLiteral<"not_established_by_operator_acknowledgement_or_pure_in_memory_primitive">;
            replayProtectionStatement: z.ZodLiteral<"one_run_permit_consumption_requires_trusted_process_controller">;
        }, "strict", z.ZodTypeAny, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }>;
        authority: z.ZodLiteral<"none">;
    }, "strict", z.ZodTypeAny, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }>, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }, {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    }>;
    permitEnvelope: z.ZodEffects<z.ZodObject<{
        payloadType: z.ZodString;
        payload: z.ZodEffects<z.ZodString, string, string>;
        signatures: z.ZodArray<z.ZodObject<{
            keyid: z.ZodString;
            sig: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
        }, "strict", z.ZodTypeAny, {
            keyid: string;
            sig: string;
        }, {
            keyid: string;
            sig: string;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }>, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }, {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    }>;
    permitPublicKey: z.ZodObject<{
        keyId: z.ZodString;
        spkiDerBase64: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        keyId: string;
        spkiDerBase64: string;
    }, {
        keyId: string;
        spkiDerBase64: string;
    }>;
    report: z.ZodEffects<z.ZodObject<z.objectUtil.extendShape<{
        schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0">;
        invocationSha256: z.ZodString;
        executionMode: z.ZodLiteral<"offline_private_authority_none_preview">;
        operation: z.ZodLiteral<"normalize_mesh_glb">;
        operationVersion: z.ZodLiteral<"v0">;
        source: z.ZodObject<{
            assetId: z.ZodString;
            inputType: z.ZodLiteral<"glb_gltf">;
            mediaType: z.ZodLiteral<"model/gltf-binary">;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }>;
        permit: z.ZodObject<{
            payloadSha256: z.ZodString;
            keyId: z.ZodString;
            expiresAt: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }>;
        operatorAcknowledgementSha256: z.ZodString;
        output: z.ZodObject<{
            mediaType: z.ZodLiteral<"model/gltf-binary">;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        }, {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        }>;
        semanticProof: z.ZodObject<{
            schemaVersion: z.ZodLiteral<"omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0">;
            beforeSha256: z.ZodString;
            afterSha256: z.ZodString;
            exactMatch: z.ZodLiteral<true>;
            accessorCount: z.ZodNumber;
            compressedBufferViewCount: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        }, {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        }>;
        validation: z.ZodObject<{
            before: z.ZodObject<{
                version: z.ZodString;
                errors: z.ZodLiteral<0>;
                warnings: z.ZodLiteral<0>;
            }, "strict", z.ZodTypeAny, {
                version: string;
                errors: 0;
                warnings: 0;
            }, {
                version: string;
                errors: 0;
                warnings: 0;
            }>;
            after: z.ZodObject<{
                version: z.ZodString;
                errors: z.ZodLiteral<0>;
                warnings: z.ZodLiteral<0>;
            }, "strict", z.ZodTypeAny, {
                version: string;
                errors: 0;
                warnings: 0;
            }, {
                version: string;
                errors: 0;
                warnings: 0;
            }>;
        }, "strict", z.ZodTypeAny, {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        }, {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        }>;
        transform: z.ZodObject<{
            sealedIdentity: z.ZodTuple<[z.ZodLiteral<"normalize_mesh_glb">, z.ZodLiteral<"v0">, z.ZodLiteral<"core-static-triangles-meshopt-lossless-proof">], null>;
            extension: z.ZodLiteral<"EXT_meshopt_compression">;
            required: z.ZodLiteral<true>;
            encoderMethod: z.ZodLiteral<"quantize">;
            meshoptFilter: z.ZodLiteral<"NONE">;
            logicalAccessorMutation: z.ZodLiteral<"none_proven_by_exact_decoded_snapshot">;
        }, "strict", z.ZodTypeAny, {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        }, {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        }>;
        outputPolicy: z.ZodObject<{
            disposition: z.ZodLiteral<"private_quarantine_only">;
            persistence: z.ZodLiteral<"not_performed_by_pure_in_memory_primitive">;
            releaseEligible: z.ZodLiteral<false>;
            trainingEligible: z.ZodLiteral<false>;
            redistributionEligible: z.ZodLiteral<false>;
            signingEligible: z.ZodLiteral<false>;
            registrationEligible: z.ZodLiteral<false>;
            publicationEligible: z.ZodLiteral<false>;
            promotionEligible: z.ZodLiteral<false>;
            measurementEligible: z.ZodLiteral<false>;
            authority: z.ZodLiteral<"none">;
        }, "strict", z.ZodTypeAny, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }>;
        executionBoundary: z.ZodObject<{
            primitiveKind: z.ZodLiteral<"pure_in_memory">;
            filesystemAccess: z.ZodLiteral<"none">;
            networkAccess: z.ZodLiteral<"none">;
            childProcesses: z.ZodLiteral<"none">;
            sandboxEstablished: z.ZodLiteral<false>;
            custodyEstablished: z.ZodLiteral<false>;
            rightsAuthorizationEstablished: z.ZodLiteral<false>;
            replayProtectionEstablished: z.ZodLiteral<false>;
            sandboxStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            custodyStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            rightsAuthorizationStatement: z.ZodLiteral<"not_established_by_operator_acknowledgement_or_pure_in_memory_primitive">;
            replayProtectionStatement: z.ZodLiteral<"one_run_permit_consumption_requires_trusted_process_controller">;
        }, "strict", z.ZodTypeAny, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }>;
        limitations: z.ZodTuple<[z.ZodLiteral<"This result is an authority-none private offline format-normalization preview only.">, z.ZodLiteral<"The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.">, z.ZodLiteral<"Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.">, z.ZodLiteral<"The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.">, z.ZodLiteral<"This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.">, z.ZodLiteral<"Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.">, z.ZodLiteral<"This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.">, z.ZodLiteral<"This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest.">], null>;
        authority: z.ZodLiteral<"none">;
    }, {
        reportSha256: z.ZodString;
    }>, "strict", z.ZodTypeAny, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }>, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }>;
    blobs: z.ZodTuple<[z.ZodObject<{
        kind: z.ZodLiteral<"source">;
        sizeBytes: z.ZodNumber;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"candidate">;
        sizeBytes: z.ZodNumber;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    }>], null>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "fresh_verifier";
    messageType: "request";
    requestId: string;
    deadlineAt: string;
    invocation: {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    };
    permitEnvelope: {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    };
    permitPublicKey: {
        keyId: string;
        spkiDerBase64: string;
    };
    blobs: [{
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    }];
    report: {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    };
}, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "fresh_verifier";
    messageType: "request";
    requestId: string;
    deadlineAt: string;
    invocation: {
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgement: {
            schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
            source: {
                sizeBytes: number;
                sha256: string;
                assetId: string;
            };
            authority: "none";
            operation: {
                operation: "normalize_mesh_glb";
                operationVersion: "v0";
                sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            };
            acknowledgementId: string;
            operatorId: string;
            recordedAt: string;
            acknowledgement: "operator_records_private_offline_preview_intent";
            statement: "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";
            legalPosture: "operator_statement_not_independent_rights_approval";
            authorizationPosture: "operator_statement_recorded_not_a_permit";
            independentRightsApprovalEstablished: false;
            operatorStatementEstablishesExecutionPermit: false;
            acknowledgementSha256: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
    };
    permitEnvelope: {
        payload: string;
        payloadType: string;
        signatures: {
            keyid: string;
            sig: string;
        }[];
    };
    permitPublicKey: {
        keyId: string;
        spkiDerBase64: string;
    };
    blobs: [{
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    }];
    report: {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    };
}>;
export declare const FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0">;
    messageType: z.ZodLiteral<"success">;
    role: z.ZodLiteral<"transform">;
    requestId: z.ZodString;
    report: z.ZodEffects<z.ZodObject<z.objectUtil.extendShape<{
        schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0">;
        invocationSha256: z.ZodString;
        executionMode: z.ZodLiteral<"offline_private_authority_none_preview">;
        operation: z.ZodLiteral<"normalize_mesh_glb">;
        operationVersion: z.ZodLiteral<"v0">;
        source: z.ZodObject<{
            assetId: z.ZodString;
            inputType: z.ZodLiteral<"glb_gltf">;
            mediaType: z.ZodLiteral<"model/gltf-binary">;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }, {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        }>;
        permit: z.ZodObject<{
            payloadSha256: z.ZodString;
            keyId: z.ZodString;
            expiresAt: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }, {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        }>;
        operatorAcknowledgementSha256: z.ZodString;
        output: z.ZodObject<{
            mediaType: z.ZodLiteral<"model/gltf-binary">;
            sizeBytes: z.ZodNumber;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        }, {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        }>;
        semanticProof: z.ZodObject<{
            schemaVersion: z.ZodLiteral<"omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0">;
            beforeSha256: z.ZodString;
            afterSha256: z.ZodString;
            exactMatch: z.ZodLiteral<true>;
            accessorCount: z.ZodNumber;
            compressedBufferViewCount: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        }, {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        }>;
        validation: z.ZodObject<{
            before: z.ZodObject<{
                version: z.ZodString;
                errors: z.ZodLiteral<0>;
                warnings: z.ZodLiteral<0>;
            }, "strict", z.ZodTypeAny, {
                version: string;
                errors: 0;
                warnings: 0;
            }, {
                version: string;
                errors: 0;
                warnings: 0;
            }>;
            after: z.ZodObject<{
                version: z.ZodString;
                errors: z.ZodLiteral<0>;
                warnings: z.ZodLiteral<0>;
            }, "strict", z.ZodTypeAny, {
                version: string;
                errors: 0;
                warnings: 0;
            }, {
                version: string;
                errors: 0;
                warnings: 0;
            }>;
        }, "strict", z.ZodTypeAny, {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        }, {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        }>;
        transform: z.ZodObject<{
            sealedIdentity: z.ZodTuple<[z.ZodLiteral<"normalize_mesh_glb">, z.ZodLiteral<"v0">, z.ZodLiteral<"core-static-triangles-meshopt-lossless-proof">], null>;
            extension: z.ZodLiteral<"EXT_meshopt_compression">;
            required: z.ZodLiteral<true>;
            encoderMethod: z.ZodLiteral<"quantize">;
            meshoptFilter: z.ZodLiteral<"NONE">;
            logicalAccessorMutation: z.ZodLiteral<"none_proven_by_exact_decoded_snapshot">;
        }, "strict", z.ZodTypeAny, {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        }, {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        }>;
        outputPolicy: z.ZodObject<{
            disposition: z.ZodLiteral<"private_quarantine_only">;
            persistence: z.ZodLiteral<"not_performed_by_pure_in_memory_primitive">;
            releaseEligible: z.ZodLiteral<false>;
            trainingEligible: z.ZodLiteral<false>;
            redistributionEligible: z.ZodLiteral<false>;
            signingEligible: z.ZodLiteral<false>;
            registrationEligible: z.ZodLiteral<false>;
            publicationEligible: z.ZodLiteral<false>;
            promotionEligible: z.ZodLiteral<false>;
            measurementEligible: z.ZodLiteral<false>;
            authority: z.ZodLiteral<"none">;
        }, "strict", z.ZodTypeAny, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }, {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        }>;
        executionBoundary: z.ZodObject<{
            primitiveKind: z.ZodLiteral<"pure_in_memory">;
            filesystemAccess: z.ZodLiteral<"none">;
            networkAccess: z.ZodLiteral<"none">;
            childProcesses: z.ZodLiteral<"none">;
            sandboxEstablished: z.ZodLiteral<false>;
            custodyEstablished: z.ZodLiteral<false>;
            rightsAuthorizationEstablished: z.ZodLiteral<false>;
            replayProtectionEstablished: z.ZodLiteral<false>;
            sandboxStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            custodyStatement: z.ZodLiteral<"not_established_by_pure_in_memory_primitive">;
            rightsAuthorizationStatement: z.ZodLiteral<"not_established_by_operator_acknowledgement_or_pure_in_memory_primitive">;
            replayProtectionStatement: z.ZodLiteral<"one_run_permit_consumption_requires_trusted_process_controller">;
        }, "strict", z.ZodTypeAny, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }, {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        }>;
        limitations: z.ZodTuple<[z.ZodLiteral<"This result is an authority-none private offline format-normalization preview only.">, z.ZodLiteral<"The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.">, z.ZodLiteral<"Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.">, z.ZodLiteral<"The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.">, z.ZodLiteral<"This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.">, z.ZodLiteral<"Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.">, z.ZodLiteral<"This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.">, z.ZodLiteral<"This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest.">], null>;
        authority: z.ZodLiteral<"none">;
    }, {
        reportSha256: z.ZodString;
    }>, "strict", z.ZodTypeAny, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }>, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }, {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    }>;
    blobs: z.ZodTuple<[z.ZodObject<{
        kind: z.ZodLiteral<"output">;
        sizeBytes: z.ZodNumber;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        sizeBytes: number;
        sha256: string;
        kind: "output";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "output";
    }>], null>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "transform";
    messageType: "success";
    requestId: string;
    blobs: [{
        sizeBytes: number;
        sha256: string;
        kind: "output";
    }];
    report: {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    };
}, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "transform";
    messageType: "success";
    requestId: string;
    blobs: [{
        sizeBytes: number;
        sha256: string;
        kind: "output";
    }];
    report: {
        validation: {
            before: {
                version: string;
                errors: 0;
                warnings: 0;
            };
            after: {
                version: string;
                errors: 0;
                warnings: 0;
            };
        };
        schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
        source: {
            sizeBytes: number;
            sha256: string;
            inputType: "glb_gltf";
            mediaType: "model/gltf-binary";
            assetId: string;
        };
        authority: "none";
        limitations: ["This result is an authority-none private offline format-normalization preview only.", "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.", "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.", "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.", "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.", "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.", "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.", "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest."];
        transform: {
            sealedIdentity: ["normalize_mesh_glb", "v0", "core-static-triangles-meshopt-lossless-proof"];
            extension: "EXT_meshopt_compression";
            required: true;
            encoderMethod: "quantize";
            meshoptFilter: "NONE";
            logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot";
        };
        operation: "normalize_mesh_glb";
        operationVersion: "v0";
        executionMode: "offline_private_authority_none_preview";
        permit: {
            payloadSha256: string;
            keyId: string;
            expiresAt: string;
        };
        operatorAcknowledgementSha256: string;
        outputPolicy: {
            authority: "none";
            disposition: "private_quarantine_only";
            persistence: "not_performed_by_pure_in_memory_primitive";
            releaseEligible: false;
            trainingEligible: false;
            redistributionEligible: false;
            signingEligible: false;
            registrationEligible: false;
            publicationEligible: false;
            promotionEligible: false;
            measurementEligible: false;
        };
        executionBoundary: {
            networkAccess: "none";
            primitiveKind: "pure_in_memory";
            filesystemAccess: "none";
            childProcesses: "none";
            sandboxEstablished: false;
            custodyEstablished: false;
            rightsAuthorizationEstablished: false;
            replayProtectionEstablished: false;
            sandboxStatement: "not_established_by_pure_in_memory_primitive";
            custodyStatement: "not_established_by_pure_in_memory_primitive";
            rightsAuthorizationStatement: "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive";
            replayProtectionStatement: "one_run_permit_consumption_requires_trusted_process_controller";
        };
        invocationSha256: string;
        output: {
            sizeBytes: number;
            sha256: string;
            mediaType: "model/gltf-binary";
        };
        semanticProof: {
            schemaVersion: "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
            beforeSha256: string;
            afterSha256: string;
            exactMatch: true;
            accessorCount: number;
            compressedBufferViewCount: number;
        };
        reportSha256: string;
    };
}>;
export declare const FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0">;
    messageType: z.ZodLiteral<"success">;
    role: z.ZodLiteral<"fresh_verifier">;
    requestId: z.ZodString;
    requestWireSha256: z.ZodString;
    deadlineAt: z.ZodEffects<z.ZodString, string, string>;
    invocationSha256: z.ZodString;
    permitPayloadSha256: z.ZodString;
    source: z.ZodObject<{
        kind: z.ZodLiteral<"source">;
        sizeBytes: z.ZodNumber;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    }>;
    candidate: z.ZodObject<{
        kind: z.ZodLiteral<"candidate">;
        sizeBytes: z.ZodNumber;
        sha256: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    }, {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    }>;
    reportSha256: z.ZodString;
    blobs: z.ZodTuple<[], null>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    source: {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    };
    role: "fresh_verifier";
    messageType: "success";
    requestId: string;
    deadlineAt: string;
    blobs: [];
    invocationSha256: string;
    reportSha256: string;
    candidate: {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    };
    requestWireSha256: string;
    permitPayloadSha256: string;
}, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    source: {
        sizeBytes: number;
        sha256: string;
        kind: "source";
    };
    role: "fresh_verifier";
    messageType: "success";
    requestId: string;
    deadlineAt: string;
    blobs: [];
    invocationSha256: string;
    reportSha256: string;
    candidate: {
        sizeBytes: number;
        sha256: string;
        kind: "candidate";
    };
    requestWireSha256: string;
    permitPayloadSha256: string;
}>;
export declare const FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0">;
    messageType: z.ZodLiteral<"failure">;
    role: z.ZodUnion<[z.ZodLiteral<"transform">, z.ZodLiteral<"fresh_verifier">]>;
    requestId: z.ZodString;
    failure: z.ZodObject<{
        code: z.ZodEnum<["REQUEST_INVALID", "DEADLINE_EXCEEDED", "TRANSFORM_FAILED", "VERIFICATION_FAILED", "OUTPUT_LIMIT_EXCEEDED", "CANCELLED", "INTERNAL_FAILURE"]>;
    }, "strict", z.ZodTypeAny, {
        code: "REQUEST_INVALID" | "DEADLINE_EXCEEDED" | "TRANSFORM_FAILED" | "VERIFICATION_FAILED" | "OUTPUT_LIMIT_EXCEEDED" | "CANCELLED" | "INTERNAL_FAILURE";
    }, {
        code: "REQUEST_INVALID" | "DEADLINE_EXCEEDED" | "TRANSFORM_FAILED" | "VERIFICATION_FAILED" | "OUTPUT_LIMIT_EXCEEDED" | "CANCELLED" | "INTERNAL_FAILURE";
    }>;
    blobs: z.ZodTuple<[], null>;
}, "strict", z.ZodTypeAny, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "transform" | "fresh_verifier";
    messageType: "failure";
    requestId: string;
    blobs: [];
    failure: {
        code: "REQUEST_INVALID" | "DEADLINE_EXCEEDED" | "TRANSFORM_FAILED" | "VERIFICATION_FAILED" | "OUTPUT_LIMIT_EXCEEDED" | "CANCELLED" | "INTERNAL_FAILURE";
    };
}, {
    schemaVersion: "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
    role: "transform" | "fresh_verifier";
    messageType: "failure";
    requestId: string;
    blobs: [];
    failure: {
        code: "REQUEST_INVALID" | "DEADLINE_EXCEEDED" | "TRANSFORM_FAILED" | "VERIFICATION_FAILED" | "OUTPUT_LIMIT_EXCEEDED" | "CANCELLED" | "INTERNAL_FAILURE";
    };
}>;
type TransformRequestMetadata = z.infer<typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema>;
type FreshVerifierRequestMetadata = z.infer<typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema>;
type TransformSuccessMetadata = z.infer<typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema>;
type FreshVerifierSuccessMetadata = z.infer<typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema>;
type FailureMetadata = z.infer<typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema>;
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestInput {
    readonly kind: "transform_request";
    readonly requestId: string;
    readonly deadlineAt: string;
    readonly invocation: unknown;
    readonly permitEnvelope: unknown;
    readonly permitPublicKey: {
        readonly keyId: string;
        readonly spkiDerBase64: string;
    };
    readonly sourceBytes: Uint8Array;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestInput {
    readonly kind: "fresh_verifier_request";
    readonly requestId: string;
    readonly deadlineAt: string;
    readonly invocation: unknown;
    readonly permitEnvelope: unknown;
    readonly permitPublicKey: {
        readonly keyId: string;
        readonly spkiDerBase64: string;
    };
    readonly report: unknown;
    readonly sourceBytes: Uint8Array;
    readonly candidateBytes: Uint8Array;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessInput {
    readonly kind: "transform_success";
    readonly requestId: string;
    readonly report: unknown;
    readonly outputBytes: Uint8Array;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessInput {
    readonly kind: "fresh_verifier_success";
    readonly requestId: string;
    readonly requestWireSha256: string;
    readonly deadlineAt: string;
    readonly invocationSha256: string;
    readonly permitPayloadSha256: string;
    readonly source: {
        readonly kind: "source";
        readonly sizeBytes: number;
        readonly sha256: string;
    };
    readonly candidate: {
        readonly kind: "candidate";
        readonly sizeBytes: number;
        readonly sha256: string;
    };
    readonly reportSha256: string;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureInput {
    readonly kind: "failure";
    readonly role: RequestRole;
    readonly requestId: string;
    readonly failure: {
        readonly code: string;
    };
}
export type FoundryOfflineNormalizeMeshGlbPreviewSandboxWireInput = FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestInput | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestInput | FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessInput | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessInput | FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureInput;
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequest {
    readonly kind: "transform_request";
    readonly metadata: TransformRequestMetadata;
    readonly sourceBytes: Buffer;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequest {
    readonly kind: "fresh_verifier_request";
    readonly metadata: FreshVerifierRequestMetadata;
    readonly sourceBytes: Buffer;
    readonly candidateBytes: Buffer;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccess {
    readonly kind: "transform_success";
    readonly metadata: TransformSuccessMetadata;
    readonly outputBytes: Buffer;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccess {
    readonly kind: "fresh_verifier_success";
    readonly metadata: FreshVerifierSuccessMetadata;
}
export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFailure {
    readonly kind: "failure";
    readonly metadata: FailureMetadata;
}
export type FoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage = FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequest | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequest | FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccess | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccess | FoundryOfflineNormalizeMeshGlbPreviewSandboxFailure;
/**
 * Encodes only the bounded transport contract. A successfully encoded message
 * does not establish key trust, permit authority, sandboxing, or execution.
 */
export declare function encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(input: FoundryOfflineNormalizeMeshGlbPreviewSandboxWireInput): Buffer;
/**
 * Decodes and authenticates the transport framing and exact byte bindings.
 * The result establishes no trust root, permit authority, sandbox, or right to
 * execute. Callers retain ownership of the returned blob buffers and should
 * erase candidate/output bytes when their lifecycle ends.
 */
export declare function decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(input: Uint8Array): FoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage;
export type { FailureMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0, FreshVerifierRequestMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0, FreshVerifierSuccessMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0, TransformRequestMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0, TransformSuccessMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0, };
export type FoundryOfflineNormalizeMeshGlbPreviewSandboxInvocation = FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
export type FoundryOfflineNormalizeMeshGlbPreviewSandboxReport = FoundryOfflineNormalizeMeshGlbPreviewReportV0;
//# sourceMappingURL=offline-normalize-mesh-glb-preview-sandbox-wire.d.ts.map