import gzip, hashlib, json, os, tempfile, unittest
import numpy as np
from relight import codec, skinlight as SL

M = [0.05, 0, 0, 0.025, 0, 0, -1, 0.98, 0, -0.05, 0, 1.975, 0, 0, 0, 1]   # u +x, v -z: the bay faces -y


def write_grids(root):
    os.makedirs(os.path.join(root, "door-w2"))
    np.save(os.path.join(root, "door-w2", "light-normals.npy"), np.tile([0.0, -1.0, 0.0], (2, 3, 1)))
    with open(os.path.join(root, "light-grids.json"), "w", encoding="utf-8") as f:
        json.dump({"skins": [{"id": "door-w2", "group": 0, "lightTexel": 0.05, "size": [3, 2], "texelToModel": M,
                              "normals": "door-w2/light-normals.npy", "sun": None}]}, f)
    return os.path.join(root, "light-grids.json")


class SkinLight(unittest.TestCase):
    def test_grids_load_with_their_normals_and_points(self):
        grids = SL.skin_light_grids(write_grids(tempfile.mkdtemp()))
        self.assertEqual((grids[0]["id"], grids[0]["size"]), ("door-w2", (3, 2)))
        P = SL.grid_points(grids[0]["texelToModel"], grids[0]["size"])
        np.testing.assert_allclose(P[4], [0.025 + 0.05, 0.98, 1.975 - 0.05], atol=1e-12)        # column 1, row 1

    def test_records_round_trip_and_the_section_pins_both_packages(self):
        root = tempfile.mkdtemp()
        light = os.path.join(root, "skin-light"); os.makedirs(light)
        D = np.zeros((6, 9)); D[:, 0] = 0.5; D[:, 5] = 0.25
        ranges = [codec.source_range(D[:, k]) for k in range(9)]
        with open(os.path.join(light, "door-w2.records"), "wb") as f:
            f.write(SL.pack_skin_records(D, np.tile([0.0, -1.0, 0.0], (6, 1)), ranges))
        with open(os.path.join(light, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"ranges": [list(r) for r in ranges], "skins": [{"id": "door-w2", "group": 0, "lightTexel": 0.05, "size": [3, 2],
                                                                       "texelToModel": M, "reachShare": 0.0, "sun": None}]}, f)
        pkg = os.path.join(root, "grand-hall", "skins", "v1"); os.makedirs(pkg)
        with open(os.path.join(pkg, "manifest.json"), "wb") as f:
            f.write(b'{"schema": "venviewer.skins.v1"}')
        section, files = SL.skins_section(light, pkg, ["door", "window", "end_xmin", "end_xmax", "ceiling"])
        self.assertEqual(section["package"], "skins/v1")
        self.assertEqual(section["manifestSha256"], hashlib.sha256(b'{"schema": "venviewer.skins.v1"}').hexdigest())
        entry = section["entries"][0]
        np.testing.assert_allclose(entry["normal"], [0.0, -1.0, 0.0], atol=1e-12)
        direct, _n, flags = codec.unpack_records(gzip.decompress(files[entry["file"]]), ranges)
        np.testing.assert_allclose(direct[:, 0], 0.5, rtol=0.04)
        self.assertEqual(flags.tolist(), [codec.CLASS_INTERIOR] * 6)


if __name__ == "__main__":
    unittest.main()
