"""Offline, read-only Git source identity for the GPU controller proposal.

Only independently chosen repository/commit inputs belong here. This proves the
local Git object graph, not repository ownership or authenticated worker execution.
No receipt input, checkout, network, filter, shell command or publisher is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import unicodedata


REPOSITORY = "codemaker66/omnitwin"
BENCHMARK_PATH = "packages/web/e2e/twin-performance.spec.ts"
BENCHMARK_SHA256 = "7d1a8adf56775ffb5ad8d94763841c32d8c7fb6b52fd7fe8cb3325a57b7eadde"
REQUIRED_SOURCES = (
    "package.json", "pnpm-lock.yaml", "packages/web/package.json",
    "packages/web/playwright.config.ts", BENCHMARK_PATH,
    "packages/web/src/twin/__fixtures__/twin-fixture.ts",
    "packages/web/src/twin/shell/twin-rooms.ts", "packages/web/src/twin/twin-copy.ts",
)
MAX_FILES = 50_000
MAX_ENTRIES = 100_000
MAX_OBJECT_BYTES = 128 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_METADATA_BYTES = 4 * 1024 * 1024
MAX_DEPTH = 64
READ_DEADLINE_SECONDS = 60
_OID = re.compile(r"[0-9a-f]{40}\Z")
_RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)", re.IGNORECASE)


class SourceManifestError(ValueError):
    """The local object graph cannot establish the required source contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SourceManifestError(message)


def _git_environment() -> dict[str, str]:
    # Ambient Git overrides may point at another object database, config or index.
    # Ordinary host/process execution remains a trusted controller prerequisite.
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}
    env.update({
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_NO_LAZY_FETCH": "1", "GIT_ALLOW_PROTOCOL": "", "GIT_TERMINAL_PROMPT": "0",
        "GIT_ATTR_NOSYSTEM": "1", "GCM_INTERACTIVE": "Never",
    })
    return env


def _canonical_path(path: str) -> None:
    _require(0 < len(path) <= 1024, "source path length is invalid")
    _require(unicodedata.normalize("NFC", path) == path, "noncanonical Unicode source path")
    _require(not any(unicodedata.category(char) in {"Cc", "Cf", "Cs"} for char in path),
             "control character in source path")
    _require(not any(char in path for char in "\\:<>\"|?*"), "unsafe source path character")
    for part in path.split("/"):
        _require(part not in {"", ".", ".."}, "noncanonical source path component")
        _require(part.casefold() != ".git", "Git administration path is forbidden")
        _require(not part.endswith((".", " ")), "ambiguous Windows source path")
        _require(_RESERVED.match(part) is None, "reserved Windows source path")


class _ObjectReader:
    def __init__(self, repo: Path):
        git = shutil.which("git")
        _require(git is not None, "Git executable is unavailable")
        # No rev expression, pathspec or shell input comes from a receipt.
        self.process = subprocess.Popen(
            [str(Path(git).resolve()), "--no-pager", "--no-replace-objects",
             "-c", "protocol.allow=never", "-c", "core.fsmonitor=false",
             "-c", "gc.auto=0", "cat-file", "--batch"],
            cwd=repo, env=_git_environment(), shell=False,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        self.expired = threading.Event()
        self.timer = threading.Timer(READ_DEADLINE_SECONDS, self._expire)
        self.timer.daemon = True
        self.timer.start()
        self.total_bytes = 0

    def _expire(self) -> None:
        self.expired.set()
        self.process.kill()

    def __enter__(self) -> "_ObjectReader":
        return self

    def __exit__(self, *_: object) -> None:
        self.timer.cancel()
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except BrokenPipeError:
                pass
        if self.process.stdout is not None:
            self.process.stdout.close()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)

    def read(self, oid: str, expected_kind: str, *, retain: bool = False) -> tuple[str, bytes]:
        _require(_OID.fullmatch(oid) is not None, "invalid Git object identity")
        assert self.process.stdin is not None and self.process.stdout is not None
        try:
            self.process.stdin.write(oid.encode("ascii") + b"\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise SourceManifestError("Git object reader stopped") from exc
        header = self.process.stdout.readline(256)
        _require(not self.expired.is_set(), "Git object read deadline exceeded")
        _require(header.endswith(b"\n"), "missing or oversized Git object header")
        fields = header[:-1].split(b" ")
        _require(len(fields) == 3 and fields[0] == oid.encode("ascii"), "Git object missing or invalid header")
        _require(fields[1] == expected_kind.encode("ascii"), f"expected a Git {expected_kind} object")
        _require(re.fullmatch(rb"(?:0|[1-9][0-9]*)", fields[2]) is not None, "invalid Git object size")
        size = int(fields[2])
        maximum = MAX_METADATA_BYTES if retain else MAX_OBJECT_BYTES
        _require(size <= maximum, "Git object exceeds source size limit")
        self.total_bytes += size
        _require(self.total_bytes <= MAX_TOTAL_BYTES, "Git source exceeds total size limit")
        object_hash = hashlib.sha1(expected_kind.encode("ascii") + b" " + fields[2] + b"\0", usedforsecurity=False)
        content_hash = hashlib.sha256()
        parts = []
        remaining = size
        while remaining:
            chunk = self.process.stdout.read(min(1024 * 1024, remaining))
            _require(bool(chunk), "truncated Git object")
            object_hash.update(chunk)
            content_hash.update(chunk)
            if retain:
                parts.append(chunk)
            remaining -= len(chunk)
        _require(self.process.stdout.read(1) == b"\n", "invalid Git object delimiter")
        _require(not self.expired.is_set(), "Git object read deadline exceeded")
        _require(object_hash.hexdigest() == oid, "Git object bytes do not match their identity")
        return content_hash.hexdigest(), b"".join(parts)


def build_source_manifest(repo_path: str | os.PathLike[str], commit_sha: str) -> dict[str, object]:
    """Hash all committed tracked blobs, ignoring working-tree/index/ref changes.

    Returns exactly the existing offline verifier's four-field ``source`` shape.
    Inputs must be an explicit local absolute repository and a lowercase full
    SHA-1 commit object, chosen independently of any worker receipt.
    """
    _require(isinstance(commit_sha, str) and _OID.fullmatch(commit_sha) is not None,
             "commit must be an exact lowercase 40-hex Git commit identity")
    repo = Path(repo_path)
    _require(repo.is_absolute(), "repository path must be explicit and absolute")
    try:
        repo = repo.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise SourceManifestError("repository path is unavailable") from exc
    _require(repo.is_dir(), "repository path must be a directory")
    entries: dict[str, str] = {}
    seen_paths: set[str] = set()
    cached_trees: dict[str, bytes] = {}
    entry_count = 0
    with _ObjectReader(repo) as reader:
        _, commit = reader.read(commit_sha, "commit", retain=True)
        first_line = commit.partition(b"\n")[0]
        _require(re.fullmatch(rb"tree [0-9a-f]{40}", first_line) is not None,
                 "commit has no canonical root tree")
        tree_sha = first_line[5:].decode("ascii")

        def walk(tree_oid: str, prefix: str, depth: int) -> None:
            nonlocal entry_count
            _require(depth <= MAX_DEPTH, "source tree nesting limit exceeded")
            if tree_oid not in cached_trees:
                _, cached_trees[tree_oid] = reader.read(tree_oid, "tree", retain=True)
            data = cached_trees[tree_oid]
            at = 0
            while at < len(data):
                separator = data.find(b" ", at)
                terminator = data.find(b"\0", separator + 1)
                _require(separator > at and terminator > separator + 1 and terminator + 21 <= len(data),
                         "malformed Git tree entry")
                mode = data[at:separator]
                name_bytes = data[separator + 1:terminator]
                _require(b"/" not in name_bytes, "slash in Git tree entry name")
                try:
                    name = name_bytes.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise SourceManifestError("source path is not valid UTF-8") from exc
                path = prefix + name
                _canonical_path(path)
                key = path.casefold()
                _require(key not in seen_paths, "duplicate or case-colliding source path")
                seen_paths.add(key)
                entry_count += 1
                _require(entry_count <= MAX_ENTRIES, "source entry count limit exceeded")
                oid = data[terminator + 1:terminator + 21].hex()
                at = terminator + 21
                if mode == b"40000":
                    walk(oid, path + "/", depth + 1)
                elif mode in {b"100644", b"100755"}:
                    entries[path] = oid
                    _require(len(entries) <= MAX_FILES, "tracked source file count limit exceeded")
                elif mode == b"120000":
                    raise SourceManifestError("tracked symlinks require a separately reviewed source policy")
                elif mode == b"160000":
                    raise SourceManifestError("submodules require a separately reviewed source policy")
                else:
                    raise SourceManifestError("unsupported Git source mode")

        walk(tree_sha, "", 0)
        _require(all(path in entries for path in REQUIRED_SOURCES), "missing required reviewed source path")
        hashes: dict[str, str] = {}
        blob_hashes: dict[str, str] = {}
        for path in sorted(entries):
            oid = entries[path]
            if oid not in blob_hashes:
                blob_hashes[oid], _ = reader.read(oid, "blob")
            hashes[path] = blob_hashes[oid]
        _require(hashes[BENCHMARK_PATH] == BENCHMARK_SHA256, "reviewed benchmark hash mismatch")
    return {"repository": REPOSITORY, "commitSha": commit_sha,
            "treeSha": tree_sha, "sourceHashes": hashes}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Explicit absolute local repository path")
    parser.add_argument("--commit", required=True, help="Exact existing lowercase 40-hex commit")
    args = parser.parse_args()
    try:
        manifest = build_source_manifest(args.repo, args.commit)
    except (SourceManifestError, OSError) as exc:
        parser.exit(1, f"source manifest rejected: {exc}\n")
    print(json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", end="")


if __name__ == "__main__":
    main()
