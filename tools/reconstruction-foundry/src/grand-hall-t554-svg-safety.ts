/** Rejects active content, external references, and operator paths in T-554 SVG evidence. */
export function verifyT554SvgSafety(svg: string): void {
  if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>\n")) {
    throw new Error("review SVG is not a complete SVG document");
  }
  const inspected = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
  const allowedElements = new Set([
    "circle", "desc", "line", "path", "polygon", "rect", "svg", "text", "title",
  ]);
  const elementPattern = /<\/?([A-Za-z][A-Za-z0-9:-]*)\b/gu;
  for (const match of inspected.matchAll(elementPattern)) {
    const element = match[1]?.toLowerCase();
    if (element === undefined || !allowedElements.has(element)) {
      throw new Error("review SVG contains a forbidden element");
    }
  }
  const forbidden = [
    /<script\b/iu,
    /<foreignObject\b/iu,
    /<style\b/iu,
    /@import\b/iu,
    /<\?/u,
    /<!/u,
    /&#(?:x[0-9a-f]+|[0-9]+);/iu,
    /\\/u,
    /\/\*|\*\//u,
    /\bon[a-z]+\s*=/iu,
    /\bstyle\s*=/iu,
    /(?:xlink:)?href\s*=/iu,
    /javascript:/iu,
    /url\s*\(/iu,
    /file:\/\//iu,
    /[A-Za-z]:[\\/]/u,
    /(?:^|[\\/])Users[\\/]/iu,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(inspected)) {
      throw new Error("review SVG contains a forbidden active or external reference");
    }
  }
  if (/https?:\/\//iu.test(inspected) || /\/\//u.test(inspected)) {
    throw new Error("review SVG contains an external URL");
  }
}
