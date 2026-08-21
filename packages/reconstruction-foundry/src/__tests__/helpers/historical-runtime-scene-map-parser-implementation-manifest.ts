import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, extname, posix, resolve, sep } from "node:path";
import ts from "typescript";
import { stableCanonicalJson } from "@omnitwin/types";

export const SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_SCHEMA_VERSION =
  "venviewer.historical-runtime-scene-parser-implementation-manifest.v1";
export const SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DOMAIN =
  "venviewer.historical-runtime-scene-parser-implementation-manifest.v1\n";
export const SCENE_MAP_PARSER_PINNED_RUNTIME_IDENTITY =
  "nodejs22-esm-source-policy.v1";

export const SCENE_MAP_PARSER_RUNTIME_ROOTS = Object.freeze([
  "packages/reconstruction-foundry/src/historical-runtime-scene-map-authenticated-evidence-bytes.ts",
  "packages/reconstruction-foundry/src/historical-runtime-scene-map-parser-policy.ts",
  "packages/reconstruction-foundry/src/historical-runtime-twin-release-authenticated-evidence-bytes.ts",
  "packages/types/src/historical-runtime-evidence.ts",
] as const);

export const SCENE_MAP_PARSER_PINNED_BUILD_INPUTS = Object.freeze([
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "packages/reconstruction-foundry/package.json",
  "packages/reconstruction-foundry/tsconfig.json",
  "packages/reconstruction-foundry/tsconfig.build.json",
  "packages/reconstruction-foundry/src/__tests__/helpers/historical-runtime-scene-map-parser-implementation-manifest.ts",
  "packages/types/package.json",
  "packages/types/tsconfig.json",
  "packages/types/tsconfig.build.json",
] as const);

export const SCENE_MAP_PARSER_SELF_REFERENCE_EXCLUSIONS = Object.freeze([
  "packages/reconstruction-foundry/src/historical-runtime-scene-map-parser-implementation-manifest.generated.ts",
] as const);

const WORKSPACE_ENTRY_POINTS = new Map<string, string>([
  ["@omnitwin/types", "packages/types/src/index.ts"],
]);

export interface SceneMapParserSourceRecord {
  readonly path: string;
  readonly sha256: string;
}

export interface SceneMapParserImplementationManifestBody {
  readonly schemaVersion:
    typeof SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_SCHEMA_VERSION;
  readonly runtimeIdentity: typeof SCENE_MAP_PARSER_PINNED_RUNTIME_IDENTITY;
  readonly sources: readonly SceneMapParserSourceRecord[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeSceneMapParserManifestText(
  bytes: Uint8Array,
  sourcePath = "manifest source",
): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new TypeError(`${sourcePath} must be BOM-free UTF-8 text.`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new TypeError(`${sourcePath} must be strict UTF-8 text.`, { cause });
  }
  return text.replace(/\r\n?/gu, "\n");
}

function repoRelativePath(repoRoot: string, absolutePath: string): string {
  const normalizedRoot = resolve(repoRoot);
  const normalizedPath = resolve(absolutePath);
  const prefix = normalizedRoot.endsWith(sep)
    ? normalizedRoot
    : `${normalizedRoot}${sep}`;
  if (!normalizedPath.startsWith(prefix)) {
    throw new TypeError(`Parser manifest path escapes the repository: ${absolutePath}`);
  }
  return normalizedPath.slice(prefix.length).split(sep).join(posix.sep);
}

function resolveTypeScriptModule(
  repoRoot: string,
  importerPath: string,
  specifier: string,
): string | null {
  const workspaceEntry = WORKSPACE_ENTRY_POINTS.get(specifier);
  if (workspaceEntry !== undefined) return workspaceEntry;
  if (specifier.startsWith("@omnitwin/")) {
    throw new TypeError(
      `Unresolved workspace import ${specifier} from ${importerPath}.`,
    );
  }
  if (!specifier.startsWith(".")) return null;
  const base = resolve(repoRoot, dirname(importerPath), specifier);
  const withoutRuntimeExtension = [".js", ".mjs", ".cjs"].includes(extname(base))
    ? base.slice(0, -extname(base).length)
    : base;
  const candidates = [
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    resolve(withoutRuntimeExtension, "index.ts"),
    resolve(withoutRuntimeExtension, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return repoRelativePath(repoRoot, candidate);
    } catch {
      // Try the next exact TypeScript source candidate.
    }
  }
  throw new TypeError(
    `Unresolved local import ${specifier} from ${importerPath}.`,
  );
}

function localRuntimeImports(
  repoRoot: string,
  sourcePath: string,
  sourceText: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      throw new TypeError(
        `Dynamic import is forbidden in parser manifest source ${sourcePath}.`,
      );
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const resolved = resolveTypeScriptModule(
        repoRoot,
        sourcePath,
        node.moduleSpecifier.text,
      );
      if (resolved !== null) imports.add(resolved);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...imports].sort((left, right) =>
    Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"))
  );
}

export function buildSceneMapParserImplementationManifest(
  repoRoot: string,
): {
  readonly body: SceneMapParserImplementationManifestBody;
  readonly digest: string;
} {
  const pending: string[] = [...SCENE_MAP_PARSER_RUNTIME_ROOTS];
  const runtimeSources = new Set<string>();
  const selfReferenceExclusions = new Set<string>(
    SCENE_MAP_PARSER_SELF_REFERENCE_EXCLUSIONS,
  );
  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (sourcePath === undefined || runtimeSources.has(sourcePath)) continue;
    runtimeSources.add(sourcePath);
    const normalized = normalizeSceneMapParserManifestText(
      readFileSync(resolve(repoRoot, sourcePath)),
      sourcePath,
    );
    for (const dependency of localRuntimeImports(repoRoot, sourcePath, normalized)) {
      if (selfReferenceExclusions.has(dependency)) continue;
      if (!runtimeSources.has(dependency)) pending.push(dependency);
    }
  }
  const allSources = new Set<string>([
    ...runtimeSources,
    ...SCENE_MAP_PARSER_PINNED_BUILD_INPUTS,
  ]);
  const sortedPaths = [...allSources].sort((left, right) =>
    Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"))
  );
  const sources = sortedPaths.map((sourcePath) => {
    const normalized = normalizeSceneMapParserManifestText(
      readFileSync(resolve(repoRoot, sourcePath)),
      sourcePath,
    );
    return Object.freeze({ path: sourcePath, sha256: sha256(normalized) });
  });
  const body = Object.freeze({
    schemaVersion: SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_SCHEMA_VERSION,
    runtimeIdentity: SCENE_MAP_PARSER_PINNED_RUNTIME_IDENTITY,
    sources: Object.freeze(sources),
  });
  return Object.freeze({
    body,
    digest: sha256(
      `${SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DOMAIN}${stableCanonicalJson(body)}`,
    ),
  });
}
