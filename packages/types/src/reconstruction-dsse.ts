import { z } from "zod";

export const RECONSTRUCTION_DSSE_MAX_SIGNATURES = 16;

const BASE64_SHAPE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function isCanonicalBase64(value: string): boolean {
  if (!BASE64_SHAPE.test(value)) return false;
  if (value.endsWith("==")) {
    const finalDataCharacter = value.at(-3) ?? "";
    return BASE64_ALPHABET.indexOf(finalDataCharacter) % 16 === 0;
  }
  if (value.endsWith("=")) {
    const finalDataCharacter = value.at(-2) ?? "";
    return BASE64_ALPHABET.indexOf(finalDataCharacter) % 4 === 0;
  }
  return true;
}

function canonicalBase64DecodedByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const ReconstructionDsseEnvelopeSchema = z
  .object({
    payloadType: z.string().trim().min(1).max(240),
    payload: z.string().min(1).refine(
      isCanonicalBase64,
      "DSSE payload must use canonical base64.",
    ),
    signatures: z.array(z.object({
      keyid: z.string().trim().min(1).max(200),
      sig: z.string().min(1)
        .refine(isCanonicalBase64, "DSSE signatures must use canonical base64.")
        .refine(
          (value) => canonicalBase64DecodedByteLength(value) === 64,
          "Ed25519 DSSE signatures must encode exactly 64 bytes.",
        ),
    }).strict()).min(1).max(RECONSTRUCTION_DSSE_MAX_SIGNATURES),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const keyIds = envelope.signatures.map((signature) => signature.keyid);
    if (new Set(keyIds).size !== keyIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatures"],
        message: "A DSSE envelope may contain at most one signature per key ID.",
      });
    }
  });

export type ReconstructionDsseEnvelope = z.infer<
  typeof ReconstructionDsseEnvelopeSchema
>;
