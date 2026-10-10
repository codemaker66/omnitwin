import contextlib, hashlib, io, json, os, shutil, tempfile, unittest
from unittest import mock
from relight import __main__ as M, config


@contextlib.contextmanager
def host_env(pod=None, init_environ=None, job=None):
    """The host as a test names it, whatever machine runs the suite: RUNPOD_POD_ID and RELIGHT_JOB in this process's
    environment only when given, and the container's initial environment (M.INIT_ENVIRON) at `init_environ` (None:
    there is none to read, as on the PC)."""
    with mock.patch.dict(os.environ), mock.patch.object(M, "INIT_ENVIRON", init_environ):
        for name in ("RUNPOD_POD_ID", "RELIGHT_JOB"):
            os.environ.pop(name, None)
        if pod is not None:
            os.environ["RUNPOD_POD_ID"] = pod
        if job is not None:
            os.environ["RELIGHT_JOB"] = job
        yield


class Artifacts(unittest.TestCase):
    def test_an_artifact_is_recorded_by_its_exact_path_hash_and_size(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.npz")
            with open(path, "wb") as f:
                f.write(b"abc")
            record = M._artifact(path)
            self.assertEqual(record["sha256"], hashlib.sha256(b"abc").hexdigest())
            self.assertEqual(record["bytes"], 3)
            self.assertTrue(record["path"].endswith("/a.npz") and "\\" not in record["path"])

    def test_evidence_is_written_whole_with_non_finite_numbers_as_null(self):
        with tempfile.TemporaryDirectory() as d, host_env():
            path = os.path.join(d, "e.json")
            M._write_evidence(path, {"x": float("inf"), "artifact": None})
            with open(path, encoding="utf-8") as f:
                self.assertEqual(json.load(f), {"x": None, "artifact": None, "host": M._host()})
            self.assertFalse(os.path.exists(path + ".part"))

    def test_a_dump_that_raises_leaves_the_target_untouched_and_no_partial_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "e.json")
            M._write_evidence(path, {"pass": True, "host": "pc"})
            with open(path, "rb") as f:
                before = f.read()

            def crash(obj, f, **kwargs):
                f.write('{"pass": ')
                raise OSError("disk full")
            with mock.patch.object(M.json, "dump", side_effect=crash), self.assertRaises(OSError):
                M._write_evidence(path, {"pass": False, "host": "pc"})
            with open(path, "rb") as f:
                self.assertEqual(f.read(), before)
            self.assertEqual(os.listdir(d), ["e.json"])

    def test_evidence_reaches_the_disk_before_it_replaces_the_target(self):
        calls, fsync, replace = [], os.fsync, os.replace
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(M.os, "fsync", side_effect=lambda fd: (calls.append("fsync"), fsync(fd))[1]), \
                mock.patch.object(M.os, "replace", side_effect=lambda a, b: (calls.append(("replace", a, b)), replace(a, b))[1]):
            path = os.path.join(d, "e.json")
            M._write_evidence(path, {"pass": True, "host": "pc"})
        self.assertEqual(calls, ["fsync", ("replace", path + ".part", path)])


class EvidenceHost(unittest.TestCase):
    """Each evidence JSON records its host (R1a's Global Constraints, "Execution host", amended 10 October): the RunPod
    pod by RUNPOD_POD_ID, from this process's environment or else the container's initial environment (a runner job's
    own environment lacks it); the PC otherwise, except that a runner job with no pod id refuses to guess. Evidence that
    already records the host that measured it keeps it."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def initial_environment(self, *entries):
        """A file like /proc/1/environ: NUL-separated NAME=value entries."""
        path = os.path.join(self.dir, "environ")
        with open(path, "wb") as f:
            f.write(b"\0".join(e.encode() for e in entries) + b"\0")
        return path

    def written(self, data, **env):
        path = os.path.join(self.dir, "e.json")
        with host_env(**env):
            M._write_evidence(path, data)
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def test_evidence_written_on_a_pod_records_the_pod(self):
        self.assertEqual(self.written({"pass": True}, pod="testpod01"), {"pass": True, "host": "pod:testpod01"})

    def test_a_runner_job_finds_the_pod_in_the_containers_initial_environment(self):
        environ = self.initial_environment("PATH=/usr/bin", "RUNPOD_POD_ID=abc123xyz", "HOME=/root")
        self.assertEqual(self.written({"pass": True}, init_environ=environ, job="probes-run1"),
                         {"pass": True, "host": "pod:abc123xyz"})

    def test_evidence_written_off_a_pod_records_the_pc(self):
        for init_environ in (None, os.path.join(self.dir, "no-such-environ")):
            self.assertEqual(self.written({"pass": True}, init_environ=init_environ), {"pass": True, "host": "pc"})

    def test_a_runner_job_with_no_pod_id_refuses_to_guess(self):
        for init_environ in (os.path.join(self.dir, "no-such-environ"), self.initial_environment("PATH=/usr/bin", "HOME=/root")):
            with self.assertRaisesRegex(RuntimeError, "probes-run1"):
                self.written({"pass": True}, init_environ=init_environ, job="probes-run1")
            self.assertFalse(os.path.exists(os.path.join(self.dir, "e.json")) or os.path.exists(os.path.join(self.dir, "e.json.part")))

    def test_rewritten_evidence_keeps_the_host_that_measured_it(self):
        self.assertEqual(self.written({"pass": True, "host": "pc"}, pod="testpod01"), {"pass": True, "host": "pc"})


class RecordArtifacts(unittest.TestCase):
    """record-artifacts adds each earlier artifact's record to its evidence. An evidence file that already records its
    artifact (Task 4b wrote probes-check.json's and sun-bounce-check.json's in this shape) is checked against the file
    and rewritten identically, or refused: never rewritten differently."""

    def setUp(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root)
        self.work, self.ev = os.path.join(root, "work"), os.path.join(root, "evidence")
        os.makedirs(self.work), os.makedirs(self.ev)
        for name, _evidence in M.ARTIFACTS:
            with open(os.path.join(self.work, name), "wb") as f:
                f.write(name.encode())
        self.cfg = config.Config(paths={"work": self.work, "evidence": self.ev}, room={})
        self.enterContext(host_env())

    def evidence(self, name, data=None):
        """The evidence file's bytes, after writing `data` as Task 4b's stamp_host.py wrote it when given."""
        path = os.path.join(self.ev, name)
        if data is not None:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=1, allow_nan=False)
        with open(path, "rb") as f:
            return f.read()

    def record(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = M.cmd_record_artifacts(self.cfg, None)
        return code, out.getvalue()

    def test_records_are_added_and_existing_ones_rewritten_identically(self):
        probes = os.path.join(self.work, "probes-coarse.npz")
        before = self.evidence("probes-check.json", {"pass": True, "host": "pc", "artifact": M._artifact(probes)})
        self.evidence("sun-bounce-check.json", {"pass": True, "K": 40})
        code, out = self.record()
        self.assertEqual((code, len(out.splitlines())), (0, 4))
        self.assertEqual(self.evidence("probes-check.json"), before)
        for name, evidence in M.ARTIFACTS:
            with open(os.path.join(self.ev, evidence), encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual((data["artifact"], data["host"]), (M._artifact(os.path.join(self.work, name)), "pc"))
        after = {e: self.evidence(e) for _n, e in M.ARTIFACTS}
        self.assertEqual(self.record()[0], 0)                       # a second run checks every record and changes nothing
        self.assertEqual({e: self.evidence(e) for _n, e in M.ARTIFACTS}, after)

    def test_a_record_that_differs_from_its_file_is_refused_and_left_alone(self):
        record = M._artifact(os.path.join(self.work, "probes-coarse.npz"))
        for old in ({**record, "sha256": "0" * 64}, {**record, "path": "/workspace/relight/D/other/probes-coarse.npz"},
                    {**record, "bytes": record["bytes"] + 1}):
            before = self.evidence("probes-check.json", {"pass": True, "host": "pc", "artifact": old})
            code, out = self.record()
            self.assertEqual(code, 1)
            self.assertIn("FAIL: probes-check.json records", out)
            self.assertEqual(self.evidence("probes-check.json"), before)
        before = self.evidence("probes-check.json", {"pass": False, "host": "pc"})
        code, out = self.record()
        self.assertEqual((code, self.evidence("probes-check.json")), (1, before))
        self.assertIn("records a failing run", out)


if __name__ == "__main__":
    unittest.main()
