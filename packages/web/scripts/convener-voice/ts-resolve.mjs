// Lets the voice generator import the app's TypeScript modules as they are
// written. TS-ESM source imports "./x.js" (the emitted name); Node's type
// stripping runs the .ts file but does not remap that specifier, so a module
// that imports another module fails to resolve. This hook maps a missing
// "./x.js" onto its "./x.ts" neighbour when one exists — and nothing else.
//   node --experimental-strip-types --import ./scripts/convener-voice/register.mjs ...
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL !== undefined) {
    const asJs = new URL(specifier, context.parentURL);
    if (asJs.protocol === "file:" && !existsSync(fileURLToPath(asJs))) {
      const asTs = fileURLToPath(asJs).replace(/\.js$/, ".ts");
      if (existsSync(asTs)) return next(pathToFileURL(asTs).href, context);
    }
  }
  return next(specifier, context);
}
