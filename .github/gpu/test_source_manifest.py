"""Disposable local object-store tests; no browser, network or publisher."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zlib

import source_manifest as sm


class SourceManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="venviewer-gpu-source-test-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.env = sm._git_environment()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Disposable source manifest test")
        self.git("config", "user.email", "source-test@example.invalid")
        self.git("config", "core.autocrlf", "false")
        self.git("config", "gc.auto", "0")
        self.expected = {}
        for name in sm.REQUIRED_SOURCES:
            data = (Path(__file__).parent / "fixtures/pinned-twin-performance.spec.ts").read_bytes() if name == sm.BENCHMARK_PATH else ("fixture " + name + "\n").encode()
            file = self.repo / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            self.expected[name] = hashlib.sha256(data).hexdigest()
        self.commit = self.commit_worktree()

    def git(self, *args, data=None):
        return subprocess.run([shutil.which("git"), *args], cwd=self.repo, env=self.env,
                              input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              check=True, shell=False, timeout=10).stdout

    def commit_worktree(self):
        self.git("add", "--all")
        self.git("commit", "-qm", "Disposable source fixture")
        return self.git("rev-parse", "HEAD").decode().strip()

    def object(self, kind, data):
        return self.git("hash-object", "--literally", "-t", kind, "-w", "--stdin", data=data).decode().strip()

    def with_entry(self, name, mode=b"100644", oid=None):
        if oid is None:
            oid = self.object("blob", b"extra fixture\0\xff\n")
        root = self.git("cat-file", "tree", self.commit + "^{tree}")
        root += mode + b" " + name + b"\0" + bytes.fromhex(oid)
        return self.with_tree_bytes(root)

    def with_tree_bytes(self, raw):
        tree = self.object("tree", raw)
        data = (f"tree {tree}\nauthor Test <test@example.invalid> 0 +0000\n"
                "committer Test <test@example.invalid> 0 +0000\n\nDisposable raw tree fixture\n").encode()
        return self.object("commit", data)

    def test_exact_committed_bytes_and_deterministic_complete_contract(self):
        for name, data in {"binary.bin": b"\0\xff\r\n", "empty": b"", "executable.sh": b"#!/bin/sh\necho test\n"}.items():
            (self.repo / name).write_bytes(data)
            self.expected[name] = hashlib.sha256(data).hexdigest()
        self.git("add", "--all")
        self.git("update-index", "--chmod=+x", "executable.sh")
        self.git("commit", "-qm", "Binary, empty and executable fixtures")
        commit = self.git("rev-parse", "HEAD").decode().strip()
        result = sm.build_source_manifest(self.repo, commit)
        self.assertEqual(set(result), {"repository", "commitSha", "treeSha", "sourceHashes"})
        self.assertEqual(result["repository"], sm.REPOSITORY)
        self.assertEqual(result["commitSha"], commit)
        self.assertEqual(result["treeSha"], self.git("rev-parse", commit + "^{tree}").decode().strip())
        self.assertEqual(result["sourceHashes"], self.expected)
        self.assertEqual(list(result["sourceHashes"]), sorted(self.expected))
        self.assertEqual(result, sm.build_source_manifest(self.repo, commit))

    def test_worktree_index_untracked_and_new_head_do_not_change_requested_commit(self):
        (self.repo / "package.json").write_bytes(b"unrelated new version\n")
        self.commit_worktree()
        (self.repo / "package.json").write_bytes(b"staged unrelated version\n")
        self.git("add", "package.json")
        (self.repo / "package.json").write_bytes(b"unstaged unrelated version\n")
        (self.repo / "untracked.bin").write_bytes(b"untracked")
        before = self.git("status", "--porcelain=v1", "-z")
        index_before = (self.repo / ".git/index").read_bytes()
        result = sm.build_source_manifest(self.repo, self.commit)
        self.assertEqual(result["sourceHashes"], self.expected)
        self.assertEqual(before, self.git("status", "--porcelain=v1", "-z"))
        self.assertEqual(index_before, (self.repo / ".git/index").read_bytes())

    def test_replacement_objects_and_ambient_git_database_overrides_are_ignored(self):
        (self.repo / "package.json").write_bytes(b"replacement\n")
        replacement = self.commit_worktree()
        self.git("replace", self.commit, replacement)
        with patch.dict(os.environ, {"GIT_DIR": str(self.repo / "nonexistent"),
                                    "GIT_WORK_TREE": str(self.repo / "wrong"),
                                    "GIT_INDEX_FILE": str(self.repo / "wrong-index"),
                                    "GIT_OBJECT_DIRECTORY": str(self.repo / "wrong-objects")}):
            result = sm.build_source_manifest(self.repo, self.commit)
        self.assertEqual(result["sourceHashes"], self.expected)

    def test_git_content_filters_are_not_run(self):
        (self.repo / ".gitattributes").write_bytes(b"*.json filter=untrusted\n")
        commit = self.commit_worktree()
        self.git("config", "filter.untrusted.process", "THIS_COMMAND_MUST_NEVER_RUN")
        self.git("config", "filter.untrusted.required", "true")
        result = sm.build_source_manifest(self.repo, commit)
        self.assertEqual(result["sourceHashes"]["package.json"], self.expected["package.json"])

    def test_refs_revisions_options_and_ambiguous_hashes_are_rejected(self):
        for value in ["HEAD", "main", self.commit[:12], self.commit.upper(), self.commit + "^{commit}",
                      "--help", "0" * 39, "z" * 40, "0" * 40 + "\n", None]:
            with self.subTest(value=value), self.assertRaisesRegex(sm.SourceManifestError, "exact lowercase 40-hex"):
                sm.build_source_manifest(self.repo, value)

    def test_missing_commit_is_rejected(self):
        with self.assertRaisesRegex(sm.SourceManifestError, "missing|header"):
            sm.build_source_manifest(self.repo, "0" * 40)

    def test_blob_tree_and_annotated_tag_identities_cannot_stand_for_commit(self):
        self.git("tag", "-am", "Annotated fixture", "tagged")
        identities = [self.object("blob", b"not a commit"),
                      self.git("rev-parse", "HEAD^{tree}").decode().strip(),
                      self.git("rev-parse", "tagged").decode().strip()]
        for identity in identities:
            with self.subTest(identity=identity), self.assertRaisesRegex(sm.SourceManifestError, "expected a Git commit"):
                sm.build_source_manifest(self.repo, identity)

    def test_missing_required_source_is_rejected(self):
        (self.repo / "pnpm-lock.yaml").unlink()
        commit = self.commit_worktree()
        with self.assertRaisesRegex(sm.SourceManifestError, "missing required"):
            sm.build_source_manifest(self.repo, commit)

    def test_changed_reviewed_benchmark_is_rejected(self):
        (self.repo / sm.BENCHMARK_PATH).write_bytes(b"unreviewed replacement")
        commit = self.commit_worktree()
        with self.assertRaisesRegex(sm.SourceManifestError, "benchmark hash mismatch"):
            sm.build_source_manifest(self.repo, commit)

    def test_symlink_is_rejected_without_following_target(self):
        commit = self.with_entry(b"external-link", b"120000", self.object("blob", b"../../private"))
        with self.assertRaisesRegex(sm.SourceManifestError, "symlinks"):
            sm.build_source_manifest(self.repo, commit)

    def test_submodule_is_rejected_without_fetching(self):
        commit = self.with_entry(b"nested-repo", b"160000", self.commit)
        with self.assertRaisesRegex(sm.SourceManifestError, "submodules"):
            sm.build_source_manifest(self.repo, commit)

    def test_noncanonical_or_cross_platform_unsafe_paths_are_rejected(self):
        names = [b"..", b".", b"a/b", b"a\\b", b"a:b", b"line\nbreak", b"nul\x7fbyte", b".GIT",
                 b"NUL", b"CON.txt", b"LPT1", b"COM9.data", b"trailing.", b"trailing ",
                 b"invalid\xff", "e\u0301".encode(), "a\u202eb".encode(), b"*", b"?", b"<tag>"]
        for name in names:
            with self.subTest(name=name), self.assertRaises(sm.SourceManifestError):
                sm.build_source_manifest(self.repo, self.with_entry(name))

    def test_duplicate_and_case_colliding_paths_are_rejected(self):
        for name in [b"package.json", b"PACKAGE.JSON", b"PACKAGES"]:
            with self.subTest(name=name), self.assertRaisesRegex(sm.SourceManifestError, "case-colliding"):
                sm.build_source_manifest(self.repo, self.with_entry(name))

    def test_malformed_tree_and_unsupported_mode_are_rejected(self):
        for raw in [b"100644 missing-delimiter", b"100644 x\0" + b"\0" * 19]:
            with self.subTest(raw=raw), self.assertRaisesRegex(sm.SourceManifestError, "malformed"):
                sm.build_source_manifest(self.repo, self.with_tree_bytes(raw))
        with self.assertRaisesRegex(sm.SourceManifestError, "unsupported Git source mode"):
            sm.build_source_manifest(self.repo, self.with_entry(b"odd", b"100664"))

    def test_wrong_object_kind_in_blob_entry_is_rejected(self):
        with self.assertRaisesRegex(sm.SourceManifestError, "expected a Git blob"):
            sm.build_source_manifest(self.repo, self.with_entry(b"wrong-kind", oid=self.commit))

    def test_missing_object_is_rejected_and_no_network_fetch_is_permitted(self):
        missing = self.git("rev-parse", self.commit + ":package.json").decode().strip()
        object_file = self.repo / ".git/objects" / missing[:2] / missing[2:]
        object_file.chmod(0o600)  # Git loose objects are read-only on Windows.
        object_file.unlink()
        self.git("config", "core.repositoryformatversion", "1")
        self.git("config", "extensions.partialClone", "origin")
        self.git("config", "remote.origin.promisor", "true")
        self.git("config", "remote.origin.url", "https://invalid.example.invalid/must-not-fetch")
        self.git("config", "protocol.https.allow", "always")
        with patch.dict(os.environ, {"GIT_ALLOW_PROTOCOL": "https", "GIT_NO_LAZY_FETCH": "0"}), self.assertRaisesRegex(sm.SourceManifestError, "missing|header"):
            sm.build_source_manifest(self.repo, self.commit)

    def test_empty_protocol_allowlist_overrides_ambient_fetch_permissions(self):
        with patch.dict(os.environ, {"GIT_ALLOW_PROTOCOL": "https:ssh:file:ext", "GIT_NO_LAZY_FETCH": "0"}):
            env = sm._git_environment()
        self.assertEqual(env["GIT_ALLOW_PROTOCOL"], "")
        self.assertEqual(env["GIT_NO_LAZY_FETCH"], "1")

    def test_corrupted_commit_tree_or_blob_identity_is_rejected(self):
        identities = [self.commit, self.git("rev-parse", self.commit + "^{tree}").decode().strip(),
                      self.git("rev-parse", self.commit + ":package.json").decode().strip()]
        for oid in identities:
            with self.subTest(oid=oid):
                file = self.repo / ".git/objects" / oid[:2] / oid[2:]
                original = file.read_bytes()
                raw = bytearray(zlib.decompress(original))
                raw[-1] ^= 1
                file.chmod(0o600)
                file.write_bytes(zlib.compress(raw))
                try:
                    with self.assertRaisesRegex(sm.SourceManifestError, "bytes do not match"):
                        sm.build_source_manifest(self.repo, self.commit)
                finally:
                    file.write_bytes(original)

    def test_size_and_count_limits_fail_closed(self):
        for constant, value, expected in [("MAX_OBJECT_BYTES", 1, "size limit"),
                                          ("MAX_TOTAL_BYTES", 1, "total size"),
                                          ("MAX_FILES", 1, "file count"),
                                          ("MAX_ENTRIES", 1, "entry count"),
                                          ("MAX_DEPTH", 1, "nesting")]:
            with self.subTest(constant=constant), patch.object(sm, constant, value), self.assertRaisesRegex(sm.SourceManifestError, expected):
                sm.build_source_manifest(self.repo, self.commit)

    def test_explicit_absolute_local_directory_is_required(self):
        for path in [".", self.repo / "absent", self.repo / "package.json"]:
            with self.subTest(path=path), self.assertRaises(sm.SourceManifestError):
                sm.build_source_manifest(path, self.commit)

    def test_json_serialization_preserves_contract(self):
        result = sm.build_source_manifest(self.repo, self.commit)
        self.assertEqual(json.loads(json.dumps(result, ensure_ascii=True)), result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
