const unsafePublicClaimPhrases = [
  ["cert", "ified"],
  ["fire", " ", "approved"],
  ["cert", "ified", " ", "safe"],
  ["legally", " ", "compliant"],
  ["survey", "-", "grade"],
  ["approved", " ", "for", " ", "occupancy"],
  ["guaranteed", " ", "accessible"],
  ["black", " ", "label"],
  ["production", " ", "ready"],
  ["photo", "real", " ", "digital", " ", "twin"],
] as const;

export function containsUnsafePublicClaim(text: string): boolean {
  const normalisedText = text.toLowerCase();
  return unsafePublicClaimPhrases
    .map((parts) => parts.join("").toLowerCase())
    .some((phrase) => normalisedText.includes(phrase));
}

export function safePublicCopy(text: string): string {
  if (!containsUnsafePublicClaim(text)) return text;
  return "Planning-grade guidance. Human review required before final details are confirmed by the venue team.";
}
