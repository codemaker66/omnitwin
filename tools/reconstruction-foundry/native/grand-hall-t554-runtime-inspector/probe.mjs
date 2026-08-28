import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const addonPath = process.argv[2] ?? path.join(here, "grand_hall_t554_runtime_inspector.node");
const secondAddonPath =
  process.argv[3] ?? path.join(here, "grand_hall_t554_runtime_inspector_copy.node");
const addon = require(addonPath);

assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
assert.equal(process.version, "v22.18.0");
assert.throws(() => addon.addDllDirectory(), /exactly 1 argument/);
assert.throws(() => addon.addDllDirectory(here, here), /exactly 1 argument/);
assert.throws(() => addon.addDllDirectory(42), /must be a string/);
assert.throws(() => addon.addDllDirectory("relative"), /absolute/);
assert.throws(
  () => addon.addDllDirectory("\\\\localhost\\c$\\Windows"),
  /local drive path/,
);
assert.throws(() => addon.removeDllDirectory(), /exactly 1 argument/);
assert.throws(() => addon.removeDllDirectory({}, {}), /exactly 1 argument/);
assert.throws(() => addon.removeDllDirectory({}), /napi_get_value_external/);
assert.throws(() => addon.revalidateDllDirectory(), /exactly 1 argument/);
assert.throws(() => addon.revalidateDllDirectory({}, {}), /exactly 1 argument/);
assert.throws(() => addon.revalidateDllDirectory({}), /napi_get_value_external/);
assert.throws(() => addon.enumerateLoadedModules("unexpected"), /exactly 0 argument/);

const pathFixtureRoot = mkdtempSync(path.join(os.tmpdir(), "t554-inspector-paths-"));
try {
  const realDirectory = path.join(pathFixtureRoot, "real");
  const junctionDirectory = path.join(pathFixtureRoot, "junction");
  const replacementDirectory = path.join(pathFixtureRoot, "\uFFFD");
  mkdirSync(realDirectory);
  mkdirSync(replacementDirectory);
  symlinkSync(realDirectory, junctionDirectory, "junction");
  assert.throws(
    () => addon.addDllDirectory(path.join(pathFixtureRoot, "missing")),
    /does not exist|inaccessible/,
  );
  assert.throws(
    () => addon.addDllDirectory(fileURLToPath(import.meta.url)),
    /existing directory|non-reparse local directories/,
  );
  assert.throws(() => addon.addDllDirectory(junctionDirectory), /non-reparse/);
  assert.throws(
    () => addon.addDllDirectory(path.join(pathFixtureRoot, "\uD800")),
    /unpaired UTF-16 surrogate/,
    "an unpaired surrogate must not alias to the existing U+FFFD directory",
  );
  const movedDirectory = path.join(pathFixtureRoot, "moved");
  const pathBindingHandle = addon.addDllDirectory(realDirectory);
  assert.equal(addon.revalidateDllDirectory(pathBindingHandle), true);
  renameSync(realDirectory, movedDirectory);
  mkdirSync(realDirectory);
  assert.throws(
    () => addon.revalidateDllDirectory(pathBindingHandle),
    /pathname identity changed/,
    "renaming and replacing the registered pathname must invalidate the binding",
  );
  assert.equal(addon.removeDllDirectory(pathBindingHandle), true);
} finally {
  rmSync(pathFixtureRoot, { recursive: true, force: true });
}

const handle = addon.addDllDirectory(here);
assert.equal(addon.revalidateDllDirectory(handle), true);
assert.throws(
  () => addon.addDllDirectory(here),
  /already has an active DLL directory/,
  "one loaded inspector image must never register two active directories",
);
assert.equal(addon.removeDllDirectory(handle), true);
assert.equal(addon.removeDllDirectory(handle), false);
assert.throws(() => addon.revalidateDllDirectory(handle), /no longer active/);

if (typeof global.gc !== "function") {
  throw new Error("probe requires Node --expose-gc");
}
let abandonedHandle = addon.addDllDirectory(here);
abandonedHandle = null;
let finalizerCleanupObserved = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  global.gc();
  await new Promise((resolve) => setImmediate(resolve));
  try {
    const replacementHandle = addon.addDllDirectory(here);
    assert.equal(addon.removeDllDirectory(replacementHandle), true);
    finalizerCleanupObserved = true;
    break;
  } catch (error) {
    if (!/already has an active DLL directory/.test(String(error))) {
      throw error;
    }
  }
}
assert.equal(finalizerCleanupObserved, true, "abandoned handles must be finalized and removed");

copyFileSync(addonPath, secondAddonPath);
const secondAddon = require(secondAddonPath);
const firstCopyHandle = addon.addDllDirectory(here);
const secondCopyHandle = secondAddon.addDllDirectory(here);
assert.throws(
  () => secondAddon.removeDllDirectory(firstCopyHandle),
  /not created by this addon/,
  "an external from one loaded addon copy must not resolve in another copy",
);
assert.throws(
  () => secondAddon.revalidateDllDirectory(firstCopyHandle),
  /not created by this addon/,
);
assert.equal(addon.removeDllDirectory(firstCopyHandle), true);
assert.equal(secondAddon.removeDllDirectory(secondCopyHandle), true);

const modules = addon.enumerateLoadedModules();
assert.deepEqual(addon.enumerateLoadedModules(), modules);
assert.deepEqual(addon.enumerateLoadedModules(), modules);
assert.ok(Array.isArray(modules));
assert.ok(modules.length > 0);
for (const modulePath of modules) {
  assert.equal(typeof modulePath, "string");
  assert.equal(path.isAbsolute(modulePath), true);
}
const expectedNodePath = path.toNamespacedPath(realpathSync.native(process.execPath));
const expectedAddonPath = path.toNamespacedPath(realpathSync.native(addonPath));
const expectedSecondAddonPath = path.toNamespacedPath(realpathSync.native(secondAddonPath));
assert.ok(modules.includes(expectedNodePath), "the exact canonical Node executable must be present");
assert.ok(modules.includes(expectedAddonPath), "the exact canonical inspector addon must be present");
assert.ok(
  modules.includes(expectedSecondAddonPath),
  "the exact canonical copied inspector addon must be present",
);

process.stdout.write(
  `${JSON.stringify({ addonPath, crossAddonHandleRejected: true, finalizerCleanupObserved, moduleCount: modules.length, stableSnapshots: 3 })}\n`,
);
