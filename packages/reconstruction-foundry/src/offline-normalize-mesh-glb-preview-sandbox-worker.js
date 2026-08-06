import { createPublicKey } from "node:crypto";
import { computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256, runFoundryOfflineNormalizeMeshGlbPreview, verifyFoundryOfflineNormalizeMeshGlbPreview, verifyFoundryOfflineNormalizeMeshGlbPreviewPermit, } from "./offline-normalize-mesh-glb-preview.js";
import { sha256Bytes } from "./hash.js";
import { decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage, encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage, FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES, } from "./offline-normalize-mesh-glb-preview-sandbox-wire.js";
/** Deliberately outside the host's exact 32-lowercase-hex request-ID profile. */
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID = "unbound-request";
function bestEffortZeroize(bytes) {
    if (bytes === null || bytes === undefined)
        return;
    try {
        bytes.fill(0);
    }
    catch {
        // This is an in-memory hygiene attempt, not a secure-erasure claim.
    }
}
function requestFromMessage(message) {
    if (message.kind !== "transform_request" &&
        message.kind !== "fresh_verifier_request") {
        throw new TypeError("Only sandbox worker request messages are accepted.");
    }
    return message;
}
function deadlineIsActive(deadlineAt) {
    return Date.now() < Date.parse(deadlineAt);
}
function importBoundPermitKey(request) {
    const { permitPublicKey, invocation, permitEnvelope } = request.metadata;
    if (permitPublicKey.keyId !== invocation.permit.keyId ||
        !permitEnvelope.signatures.some((signature) => signature.keyid === permitPublicKey.keyId)) {
        throw new TypeError("The transported permit key binding is invalid.");
    }
    const spki = Buffer.from(permitPublicKey.spkiDerBase64, "base64");
    try {
        const key = createPublicKey({ key: spki, format: "der", type: "spki" });
        if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
            throw new TypeError("The transported permit key is not Ed25519.");
        }
        return key;
    }
    finally {
        bestEffortZeroize(spki);
    }
}
function fixedFailure(role, requestId, code) {
    return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "failure",
        role,
        requestId,
        failure: {
            code,
        },
    });
}
/**
 * Executes one authority-none semantic transform or fresh verification request.
 *
 * This dispatcher performs no filesystem, network, subprocess, persistence, or
 * production-authority work. Its name describes the intended container worker
 * boundary; this function alone does not establish an operating-system sandbox.
 */
export async function runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(wireInput) {
    let role = "transform";
    let requestId = FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID;
    let failureCode = "REQUEST_INVALID";
    let message = null;
    let request = null;
    let output = null;
    try {
        message =
            decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(wireInput);
        role = message.metadata.role;
        requestId = message.metadata.requestId;
        request = requestFromMessage(message);
        const requestWireSha256 = `sha256:${sha256Bytes(wireInput)}`;
        if (!deadlineIsActive(request.metadata.deadlineAt)) {
            failureCode = "DEADLINE_EXCEEDED";
            throw new TypeError("The sandbox worker request deadline has passed.");
        }
        const permitKey = importBoundPermitKey(request);
        const pinnedTrustedPermitKeys = new Map([
            [request.metadata.permitPublicKey.keyId, permitKey],
        ]);
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
            invocation: request.metadata.invocation,
            permitEnvelope: request.metadata.permitEnvelope,
            pinnedTrustedPermitKeys,
        });
        if (request.kind === "transform_request") {
            failureCode = "TRANSFORM_FAILED";
            const result = await runFoundryOfflineNormalizeMeshGlbPreview({
                invocation: request.metadata.invocation,
                sourceBytes: request.sourceBytes,
                permitEnvelope: request.metadata.permitEnvelope,
                pinnedTrustedPermitKeys,
            });
            output = result.normalizedGlb;
            if (!deadlineIsActive(request.metadata.deadlineAt)) {
                failureCode = "DEADLINE_EXCEEDED";
                throw new TypeError("The sandbox worker request deadline has passed.");
            }
            return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
                kind: "transform_success",
                requestId,
                report: result.report,
                outputBytes: output,
            });
        }
        failureCode = "VERIFICATION_FAILED";
        await verifyFoundryOfflineNormalizeMeshGlbPreview({
            invocation: request.metadata.invocation,
            sourceBytes: request.sourceBytes,
            permitEnvelope: request.metadata.permitEnvelope,
            pinnedTrustedPermitKeys,
            normalizedGlb: request.candidateBytes,
            report: request.metadata.report,
        });
        if (!deadlineIsActive(request.metadata.deadlineAt)) {
            failureCode = "DEADLINE_EXCEEDED";
            throw new TypeError("The sandbox worker request deadline has passed.");
        }
        return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
            kind: "fresh_verifier_success",
            requestId,
            requestWireSha256,
            deadlineAt: request.metadata.deadlineAt,
            invocationSha256: computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(request.metadata.invocation),
            permitPayloadSha256: request.metadata.invocation.permit.payloadSha256,
            source: request.metadata.blobs[0],
            candidate: request.metadata.blobs[1],
            reportSha256: request.metadata.report.reportSha256,
        });
    }
    catch {
        return fixedFailure(role, requestId, failureCode);
    }
    finally {
        if (message?.kind === "transform_request") {
            bestEffortZeroize(message.sourceBytes);
        }
        else if (message?.kind === "fresh_verifier_request") {
            bestEffortZeroize(message.sourceBytes);
            bestEffortZeroize(message.candidateBytes);
        }
        else if (message?.kind === "transform_success") {
            bestEffortZeroize(message.outputBytes);
        }
        bestEffortZeroize(output);
    }
}
//# sourceMappingURL=offline-normalize-mesh-glb-preview-sandbox-worker.js.map