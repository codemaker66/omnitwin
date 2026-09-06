import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');

// This checks the repository's current literal COPY grammar, not an emulation of
// a Docker engine. Fail on new options rather than silently ignoring their inputs.
function copiedBy(stage, beforeCommand, requiredPath) {
  const start = dockerfile.indexOf(` AS ${stage}`);
  assert(start >= 0, `Missing ${stage} stage`);
  const end = dockerfile.indexOf('\nFROM ', start);
  const body = dockerfile.slice(start, end === -1 ? undefined : end);
  const command = body.indexOf(beforeCommand);
  assert(command >= 0, `Missing ${beforeCommand}`);
  for (const line of body.slice(0, command).split(/\r?\n/)) {
    if (!line.startsWith('COPY ') || line.startsWith('COPY --from=')) continue;
    const args = line.slice(5).trim().split(/\s+/);
    assert(args.every(arg => !arg.startsWith('--') && !arg.includes('"')), 'Review new COPY grammar');
    const destination = args.pop();
    for (const source of args) {
      const sourcePath = resolve(root, source);
      assert(statSync(sourcePath), `COPY source must exist: ${source}`);
      const suffix = relative(sourcePath, resolve(root, requiredPath));
      if (statSync(sourcePath).isDirectory() && suffix !== '..' && !suffix.startsWith(`..${sep}`)) {
        const installedPath = resolve('/app', destination, suffix);
        if (installedPath === resolve('/app', requiredPath)) return true;
      }
    }
  }
  return false;
}

test('the Docker default matches the verified repository Node minimum', () => {
  const minimum = /^>=(\d+\.\d+\.\d+)$/.exec(manifest.engines.node)?.[1];
  assert(minimum, 'Review a changed Node engine range explicitly');
  assert.equal(/^ARG NODE_VERSION=(.+)$/m.exec(dockerfile)?.[1].trim(), minimum);
  assert.equal([...dockerfile.matchAll(/^FROM node:\$\{NODE_VERSION\}-alpine AS /gm)].length, 3);
});

test('every declared patch is copied before the dependency-stage frozen install', () => {
  for (const patch of Object.values(manifest.pnpm.patchedDependencies)) {
    assert(statSync(resolve(root, patch)).isFile());
    assert(copiedBy('deps', 'RUN pnpm install --frozen-lockfile', patch), `${patch} unavailable during install`);
  }
});

test('every declared patch remains available when building the production deploy closure', () => {
  for (const patch of Object.values(manifest.pnpm.patchedDependencies)) {
    assert(copiedBy('build', 'RUN pnpm --filter @omnitwin/api --prod deploy', patch), `${patch} unavailable during pnpm deploy`);
  }
});
