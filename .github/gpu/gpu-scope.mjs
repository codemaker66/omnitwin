import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The GPU run measures the Twin benchmark on the operator's workstation. It is
// required when a change can reach what that run measures: the renderer, the
// tour, the benchmark and the toolchain that serves them (Blake's decision,
// 26 September 2026). Other changes ship on the CPU browser gate alone. When
// the change cannot be compared with a base commit, the run is required.
export const GPU_SCOPE_POLICY = 'venviewer-gpu-scope-v1';
const PATH_RULES = Object.freeze([
  ['benchmark', /^packages\/web\/e2e\/twin-performance\.spec\.ts$/u],
  ['benchmark configuration', /^packages\/web\/(?:playwright|vite)\.config\.ts$/u],
  ['tour', /^packages\/web\/src\/twin\//u],
  ['renderer', /^packages\/web\/src\/components\/(?:scene|rooms|meshes|cloth)\//u],
  ['renderer', /^packages\/web\/src\/(?:lib|hooks|data)\/[^/]*splat[^/]*$/iu],
  ['renderer', /^packages\/web\/src\/workers\//u],
  ['shader', /\.(?:glsl|wgsl|vert|frag)$/u],
]);
const SOURCE_FILE = /^packages\/web\/.+\.(?:[cm]?[jt]sx?)$/u;
const RENDERER_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](?:three(?:[-/][^"']*)?|@react-three\/[^"']+)["']/u;
const TOOLCHAIN_FILES = new Set(['pnpm-lock.yaml', 'package.json', 'packages/web/package.json']);
const TOOLCHAIN_CHANGE = /(?:^|[^\w-])(?:three[\w-]*|@react-three\/[\w-]+|@?playwright(?:\/test|-core)?|vite)(?![\w-])/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

/**
 * Decides whether a change set needs the GPU run.
 * `changes` lists `{ status, path }` rows (A, M, D, T, …); `readBase`/`readHead`
 * return a file's text at the base/head commit (or null), and
 * `changedLines(path)` returns only the added and removed lines of a toolchain
 * file's diff.
 */
export function gpuScope({ changes, readBase, readHead, changedLines }) {
  requireThat(Array.isArray(changes), 'change list missing');
  const reasons = [];
  for (const { status, path } of changes) {
    requireThat(typeof path === 'string' && path.length > 0 && typeof status === 'string', 'invalid change row');
    for (const [rule, pattern] of PATH_RULES) {
      if (pattern.test(path)) { reasons.push({ path, rule }); break; }
    }
    if (SOURCE_FILE.test(path)) {
      const texts = [status === 'D' ? null : readHead(path), status === 'A' ? null : readBase(path)];
      if (texts.some((text) => typeof text === 'string' && RENDERER_IMPORT.test(text)))
        reasons.push({ path, rule: 'imports three or React Three' });
    }
    if (TOOLCHAIN_FILES.has(path) && changedLines(path).some((line) => TOOLCHAIN_CHANGE.test(line)))
      reasons.push({ path, rule: 'renderer or benchmark toolchain dependency' });
  }
  const unique = [...new Map(reasons.map((reason) => [`${reason.path}\u0000${reason.rule}`, reason])).values()];
  return { required: unique.length > 0, reasons: unique, changedFiles: changes.length };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function isCommit(sha, cwd) {
  if (!COMMIT.test(sha) || /^0+$/u.test(sha)) return false;
  try { git(['cat-file', '-e', `${sha}^{commit}`], cwd); return true; } catch { return false; }
}

function textAt(commit, path, cwd) {
  try { return git(['show', `${commit}:${path}`], cwd); } catch { return null; }
}

export function decideFromGit(base, head, cwd = process.cwd()) {
  requireThat(COMMIT.test(head) && isCommit(head, cwd), 'head must be an existing full commit');
  if (!isCommit(base, cwd)) {
    return { schemaVersion: 1, policy: GPU_SCOPE_POLICY, base: base || null, head, required: true,
      reasons: [{ path: null, rule: 'no comparable base commit' }], changedFiles: null };
  }
  const fields = git(['diff', '--name-status', '--no-renames', '-z', base, head], cwd).split('\u0000');
  if (fields.at(-1) === '') fields.pop();
  requireThat(fields.length % 2 === 0, 'unexpected git diff output');
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) changes.push({ status: fields[index], path: fields[index + 1] });
  const decision = gpuScope({ changes,
    readBase: (path) => textAt(base, path, cwd), readHead: (path) => textAt(head, path, cwd),
    changedLines: (path) => git(['diff', '--unified=0', base, head, '--', path], cwd).split('\n')
      .filter((line) => /^[+-](?![+-]{2}\s)/u.test(line)) });
  return { schemaVersion: 1, policy: GPU_SCOPE_POLICY, base, head, ...decision };
}

function args(argv) {
  const values = new Map();
  requireThat(argv.length % 2 === 0, 'options require values');
  for (let i = 0; i < argv.length; i += 2) {
    requireThat(argv[i].startsWith('--') && !values.has(argv[i]), 'invalid or duplicate option');
    values.set(argv[i], argv[i + 1]);
  }
  return values;
}

function main() {
  const values = args(process.argv.slice(2));
  const base = values.get('--base') ?? '', head = values.get('--head'), output = values.get('--output');
  requireThat(typeof head === 'string' && typeof output === 'string' && values.size === 3, 'expected --base, --head and --output');
  const decision = decideFromGit(base, head);
  writeFileSync(resolve(output), `${JSON.stringify(decision, null, 2)}\n`, { flag: 'wx' });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `required=${decision.required}\n`);
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { process.stderr.write(`GPU scope rejected: ${error.message}\n`); process.exitCode = 1; }
}
