"""Read-boundary regressions; no browser, GPU, network or publication."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location('run_worker', Path(__file__).with_name('run-worker.py'))
run_worker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_worker)


class WorkerReadBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'source'
        (self.workspace / 'packages/web').mkdir(parents=True)
        self.file = self.workspace / 'app.txt'
        self.file.write_bytes(b'reviewed source\n')
        self.source = {'commitSha': 'a' * 40, 'treeSha': 'b' * 40,
                       'sourceHashes': {'app.txt': hashlib.sha256(self.file.read_bytes()).hexdigest()}}

    def test_exact_source_is_accepted(self):
        self.assertEqual(run_worker.source_check(self.workspace, self.source)['checkedFiles'], 1)

    def test_uncommitted_runner_cannot_execute(self):
        with self.assertRaises(ValueError):
            run_worker.runner_check(self.source)

    def test_runner_matches_all_four_committed_helpers(self):
        hashes = {'.github/gpu/' + name: run_worker.digest(run_worker.HERE / name)
                  for name in run_worker.RUNNER_FILES}
        self.assertEqual(len(run_worker.runner_check({'sourceHashes': hashes})), 4)
        hashes['.github/gpu/worker-inner.sh'] = '0' * 64
        with self.assertRaises(ValueError):
            run_worker.runner_check({'sourceHashes': hashes})

    def test_mutated_source_is_rejected(self):
        self.file.write_bytes(b'changed source\n')
        with self.assertRaises(ValueError):
            run_worker.source_check(self.workspace, self.source)

    def test_untracked_production_environment_is_rejected(self):
        (self.workspace / 'packages/web/.env.local').write_text('SECRET=fake-test-value')
        with self.assertRaises(ValueError):
            run_worker.source_check(self.workspace, self.source)

    def test_untracked_vite_javascript_override_is_rejected(self):
        (self.workspace / 'packages/web/vite.config.js').write_text('export default {}')
        with self.assertRaises(ValueError):
            run_worker.source_check(self.workspace, self.source)

    def test_parent_symlink_cannot_escape_source(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'file.txt').write_bytes(b'reviewed source\n')
        (self.workspace / 'link').symlink_to(outside, target_is_directory=True)
        self.source['sourceHashes'] = {'link/file.txt': self.source['sourceHashes']['app.txt']}
        with self.assertRaises(ValueError):
            run_worker.source_check(self.workspace, self.source)

    def test_parent_traversal_cannot_escape_source(self):
        (self.root / 'file.txt').write_bytes(b'reviewed source\n')
        self.source['sourceHashes'] = {'../file.txt': self.source['sourceHashes']['app.txt']}
        with self.assertRaises(ValueError):
            run_worker.source_check(self.workspace, self.source)

    def test_json_symlink_is_rejected(self):
        target = self.root / 'input.json'
        target.write_text(json.dumps({'safe': True}))
        link = self.root / 'link.json'
        link.symlink_to(target)
        with self.assertRaises(ValueError):
            run_worker.read_json(link)

    def test_missing_json_is_rejected(self):
        with self.assertRaises(ValueError):
            run_worker.read_json(self.root / 'missing.json')

    def test_large_json_is_rejected(self):
        path = self.root / 'too-large.json'
        with path.open('wb') as stream:
            stream.truncate(20 * 1024 * 1024 + 1)
        with self.assertRaises(ValueError):
            run_worker.read_json(path)


if __name__ == '__main__':
    unittest.main()
