# Spark ZIP64 parser patch

`@sparkjsdev/spark@2.1.0` bundles an older fflate ZIP parser into both its
main module and its legacy worker payload. Updating the external fflate
dependency does not replace that embedded code.

The ZIP64 patch applies the bounds check from
[fflate commit e6d5e6e](https://github.com/101arrowz/fflate/commit/e6d5e6e1076892f72770ac732d83c81da9f3316e),
which addresses [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98).
It passes the central-directory extra-field length to the ZIP64 scanner and
rejects a missing ZIP64 field when the scan reaches that boundary.

The patch covers `dist/spark.module.js` and `dist/spark.cjs.js`, the import
and require entry points declared by Spark. Both the top-level parser and
the embedded legacy worker are patched. The large diff comes from Spark's
single-line worker payload containing WASM; the semantic change is the
same small bounds check in four parser copies. Standalone `*.min.js`
distribution files are outside this patch and Venviewer's package imports.

The exported `getSplatFileType` API reaches this parser when inspecting ZIP
bytes. Spark's current default URL loader uses its Rust worker; this review
does not establish that the default URL flow invokes the vulnerable JS path.
Three.js versions, renderer interfaces and renderer lifecycle are unchanged.
Git preserves LF line endings for dependency patches so Windows and Linux
checkouts use the same bytes recorded by the pnpm lockfile.

`packages/web/src/__tests__/spark-zip64.test.ts` exercises the actual exported
ESM/CJS parsers and extracts the actual legacy-worker parser payloads. Stored,
deflated and valid ZIP64 SOG metadata must still parse. Malformed ZIP64 input
must terminate; a separate worker with a two-second parsing deadline bounds
the failure. All four malicious-input cases timed out before this patch.

Remove this patch after a compatible upstream Spark release fixes both
bundled copies and the regressions pass. The separate T-596 lifecycle branch
also patches Spark 2.1.0; combine its hunks with these when integrating that
branch, preserving both fixes under pnpm's single patch entry for this version.
