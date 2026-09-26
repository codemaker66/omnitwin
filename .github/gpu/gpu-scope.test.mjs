import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { decideFromGit, gpuScope } from './gpu-scope.mjs';

function decide(changes, { base = {}, head = {}, lines = {} } = {}) {
  return gpuScope({ changes,
    readBase: (path) => base[path] ?? null, readHead: (path) => head[path] ?? null,
    changedLines: (path) => lines[path] ?? [] });
}

test('desk, Diary, API and document changes do not need the GPU run', () => {
  const result = decide([
    { status: 'M', path: 'packages/web/src/components/dashboard/enquiries/EnquiryPanel.tsx' },
    { status: 'M', path: 'packages/web/src/pages/diary/DiaryBoardPage.tsx' },
    { status: 'A', path: 'packages/api/src/routes/requests.ts' },
    { status: 'M', path: 'docs/sessions/2026-09-26.md' },
    { status: 'M', path: 'packages/web/index.html' },
    { status: 'M', path: '.github/gpu/source_manifest.py' },
  ], { head: { 'packages/web/src/components/dashboard/enquiries/EnquiryPanel.tsx': 'import { useState } from "react";' } });
  assert.deepEqual(result, { required: false, reasons: [], changedFiles: 6 });
});

for (const [path, rule] of [
  ['packages/web/e2e/twin-performance.spec.ts', 'benchmark'],
  ['packages/web/playwright.config.ts', 'benchmark configuration'],
  ['packages/web/vite.config.ts', 'benchmark configuration'],
  ['packages/web/src/twin/TwinViewer.tsx', 'tour'],
  ['packages/web/src/twin/__fixtures__/twin-fixture.ts', 'tour'],
  ['packages/web/src/components/scene/NativeSplatLayer.tsx', 'renderer'],
  ['packages/web/src/lib/native-splat-decode.ts', 'renderer'],
  ['packages/web/src/hooks/use-room-runtime-splat.ts', 'renderer'],
  ['packages/web/src/workers/splat-decoder.worker.ts', 'renderer'],
  ['packages/web/src/shaders/cutaway.frag', 'shader'],
]) {
  test(`${path} needs the GPU run (${rule})`, () => {
    const result = decide([{ status: 'M', path }]);
    assert.equal(result.required, true);
    assert.deepEqual(result.reasons[0], { path, rule });
  });
}

test('a web source file that imports three or React Three needs the GPU run', () => {
  const path = 'packages/web/src/components/editor/FurnitureGhost.tsx';
  for (const text of ['import * as THREE from "three";', "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';",
    'import { Canvas } from "@react-three/fiber";', 'const three = await import("three");']) {
    const result = decide([{ status: 'M', path }], { head: { [path]: text } });
    assert.deepEqual(result.reasons, [{ path, rule: 'imports three or React Three' }], text);
  }
});

test('removing the last three import, or deleting a renderer file, still needs the GPU run', () => {
  const path = 'packages/web/src/lib/room-lighting.ts';
  assert.equal(decide([{ status: 'M', path }], { base: { [path]: 'import { Color } from "three";' }, head: { [path]: 'export {};' } }).required, true);
  assert.equal(decide([{ status: 'D', path }], { base: { [path]: 'import { Color } from "three";' } }).required, true);
});

test('only renderer, benchmark and serving dependencies in lockfile changes need the GPU run', () => {
  const lock = 'pnpm-lock.yaml';
  assert.equal(decide([{ status: 'M', path: lock }], { lines: { [lock]: ['+  zod@3.24.2:', '-  zod@3.24.1:'] } }).required, false);
  assert.equal(decide([{ status: 'M', path: lock }], { lines: { [lock]: ['+  vitest@3.2.5:', "+  '@vitejs/plugin-react@4.3.5':"] } }).required, false);
  for (const line of ['+  three@0.187.0:', "+    '@react-three/fiber': 9.2.0", "+  '@playwright/test@1.60.0':", '+  vite@6.4.0:', '+  three-mesh-bvh@0.9.1:']) {
    const result = decide([{ status: 'M', path: lock }], { lines: { [lock]: [line] } });
    assert.deepEqual(result.reasons, [{ path: lock, rule: 'renderer or benchmark toolchain dependency' }], line);
  }
  const manifest = 'packages/web/package.json';
  assert.equal(decide([{ status: 'M', path: manifest }], { lines: { [manifest]: ['+    "three": "^0.187.0",'] } }).required, true);
  assert.equal(decide([{ status: 'M', path: manifest }], { lines: { [manifest]: ['+    "zod": "^3.24.2",'] } }).required, false);
});

test('rows are validated and repeated reasons are reported once', () => {
  assert.throws(() => decide([{ status: 'M' }]), /invalid change row/);
  const path = 'packages/web/src/twin/TwinViewer.tsx';
  const result = decide([{ status: 'M', path }, { status: 'M', path }], { head: { [path]: 'import * as THREE from "three";' } });
  assert.deepEqual(result.reasons, [{ path, rule: 'tour' }, { path, rule: 'imports three or React Three' }]);
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'gpu-scope-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Scope Test', GIT_AUTHOR_EMAIL: 'scope@example.invalid',
      GIT_COMMITTER_NAME: 'Scope Test', GIT_COMMITTER_EMAIL: 'scope@example.invalid' } }).trim();
  git('init', '--quiet');
  const commit = (files, message) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git('add', '--all'); git('commit', '--quiet', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { root, commit, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('git comparison: a desk change skips the run and a tour change requires it', (t) => {
  const repo = repository(); t.after(repo.cleanup);
  const first = repo.commit({ 'packages/web/src/components/dashboard/Desk.tsx': 'export const desk = 1;\n' }, 'desk');
  const desk = repo.commit({ 'packages/web/src/components/dashboard/Desk.tsx': 'export const desk = 2;\n',
    'docs/note.md': 'note\n' }, 'desk again');
  const tour = repo.commit({ 'packages/web/src/twin/TwinViewer.tsx': 'import * as THREE from "three";\n' }, 'tour');
  const quiet = decideFromGit(first, desk, repo.root);
  assert.equal(quiet.required, false);
  assert.equal(quiet.changedFiles, 2);
  const loud = decideFromGit(desk, tour, repo.root);
  assert.equal(loud.required, true);
  assert.deepEqual(loud.reasons.map((reason) => reason.rule), ['tour', 'imports three or React Three']);
});

test('git comparison: a missing, zero or unknown base requires the run; an unknown head is refused', (t) => {
  const repo = repository(); t.after(repo.cleanup);
  const head = repo.commit({ 'docs/note.md': 'note\n' }, 'docs');
  for (const base of ['', '0'.repeat(40), 'f'.repeat(40)]) {
    const result = decideFromGit(base, head, repo.root);
    assert.equal(result.required, true, base);
    assert.deepEqual(result.reasons, [{ path: null, rule: 'no comparable base commit' }]);
  }
  assert.throws(() => decideFromGit(head, 'e'.repeat(40), repo.root), /head must be an existing full commit/);
});
