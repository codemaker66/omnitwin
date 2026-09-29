import json, os, shutil, tempfile, threading, time, unittest
from unittest import mock

from relight import gpulock


class GpuLock(unittest.TestCase):
    """hold() on a lock file in a temp folder: the real build-PC lock is never touched."""

    def setUp(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        self.lock = os.path.join(d, "gpu.lock")
        patcher = mock.patch.object(gpulock, "LOCK", self.lock)
        patcher.start()
        self.addCleanup(patcher.stop)

    def put(self, text):
        with open(self.lock, "w", encoding="utf-8") as f:
            f.write(text)

    def read(self):
        with open(self.lock, encoding="utf-8") as f:
            return f.read()

    def test_holds_our_record_then_releases_it(self):
        with gpulock.hold("relight-bake test"):
            rec = json.loads(self.read())
            self.assertEqual(rec["owner"], "relight-bake test")
            self.assertTrue(rec["since"])
        self.assertFalse(os.path.exists(self.lock))

    def test_releases_when_the_step_fails(self):
        with self.assertRaises(RuntimeError):
            with gpulock.hold("relight-bake test"):
                raise RuntimeError("step failed")
        self.assertFalse(os.path.exists(self.lock))

    def test_leaves_another_sessions_lock(self):
        other = "stella-film final render (another session), started 2026-01-01T00:00:00+00:00"
        with gpulock.hold("relight-bake test"):
            os.remove(self.lock)        # our lock was cleared while we held it ...
            self.put(other)             # ... and another session took the lock
        self.assertEqual(self.read(), other)

    def test_leaves_a_record_with_another_owner_or_time(self):
        for rec in ({"owner": "benchmark", "since": "2026-01-01T00:00:00+00:00"},
                    {"owner": "relight-bake test", "since": "2026-01-01T00:00:00+00:00"}):
            with gpulock.hold("relight-bake test"):
                self.put(json.dumps(rec))
            self.assertEqual(json.loads(self.read()), rec)
            os.remove(self.lock)

    def test_a_lock_already_gone_is_not_an_error(self):
        with gpulock.hold("relight-bake test"):
            os.remove(self.lock)
        self.assertFalse(os.path.exists(self.lock))

    def test_waits_while_another_holder_has_the_lock(self):
        self.put("another session")
        timer = threading.Timer(0.3, os.remove, [self.lock])
        timer.start()
        self.addCleanup(timer.join)
        t0 = time.monotonic()
        with gpulock.hold("relight-bake test", poll_s=0.02):
            waited = time.monotonic() - t0
            self.assertEqual(json.loads(self.read())["owner"], "relight-bake test")
        self.assertGreaterEqual(waited, 0.25)
        self.assertFalse(os.path.exists(self.lock))


if __name__ == "__main__":
    unittest.main()
