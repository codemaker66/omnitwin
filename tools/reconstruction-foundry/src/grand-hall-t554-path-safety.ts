/** Canonical relative-path policy shared by T-554 acceptance and T-558 verification. */
export function isSafeGrandHallT554RelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[<>:"|?*]/u.test(value) ||
    !hasSafeUnicode(value)
  ) return false;
  return value.split("/").every((segment) => {
    const windowsStem = segment.split(".", 1)[0]?.toUpperCase() ?? "";
    return segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !/^(?:CON|PRN|AUX|NUL|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u.test(windowsStem);
  });
}

function hasSafeUnicode(value: string): boolean {
  for (const character of Array.from(value)) {
    const code = character.charCodeAt(0);
    const codePoint = character.codePointAt(0) ?? code;
    const bidiControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff;
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      bidiControl ||
      (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
    ) return false;
  }
  return true;
}
