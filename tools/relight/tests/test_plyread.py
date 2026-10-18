import os
import tempfile
import unittest

import numpy as np

from relight import plyread

C0 = 0.28209479177387814
NAMES = (["x", "y", "z", "nx", "ny", "nz"] + ["f_dc_%d" % i for i in range(3)] + ["f_rest_%d" % i for i in range(45)]
         + ["opacity"] + ["scale_%d" % i for i in range(3)] + ["rot_%d" % i for i in range(4)])


def write_ply(path, rows):
    """A 3DGS PLY as the pano lane's train.export_ply writes it: float32, binary little endian, NAMES in order."""
    data = np.asarray(rows, np.float32)
    header = "ply\nformat binary_little_endian 1.0\nelement vertex %d\n" % len(data)
    header += "".join("property float %s\n" % nm for nm in NAMES) + "end_header\n"
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(data.tobytes())


def row(pos, dc, logit_opacity, log_scales, quat_wxyz):
    r = np.zeros(len(NAMES), np.float32)
    r[0:3] = pos
    r[6:9] = dc
    r[54] = logit_opacity
    r[55:58] = log_scales
    r[58:62] = quat_wxyz
    return r


class PlyRead(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "hall.ply")
        s = np.sqrt(0.5)
        self.rows = [
            # identity rotation; the smallest scale on the local z axis
            row([1.0, 2.0, 3.0], [0.0, 1.0, -1.0], 0.0, np.log([0.3, 0.2, 0.01]), [1, 0, 0, 0]),
            # 90 degrees about x (w = x = sqrt 1/2): local z becomes -y; the smallest scale again on local z
            row([-4.0, 0.5, 2.0], [2.0, -2.0, 0.5], 2.0, np.log([0.05, 0.4, 0.002]), [s, s, 0, 0]),
            # an unnormalised quaternion (the reader normalises as gsplat does), smallest scale on local x
            row([0.0, 0.0, 0.0], [10.0, -10.0, 0.0], -3.0, np.log([0.001, 0.5, 0.6]), [2, 0, 0, 0]),
        ]
        write_ply(self.path, self.rows)

    def test_the_header_is_read_and_checked(self):
        n, names, offset = plyread.header(self.path)
        self.assertEqual((n, names), (3, NAMES))
        self.assertEqual(os.path.getsize(self.path), offset + 3 * len(NAMES) * 4)

    def test_a_file_whose_size_disagrees_with_its_header_is_refused(self):
        with open(self.path, "ab") as f:
            f.write(b"\0" * 8)
        with self.assertRaises(ValueError):
            plyread.header(self.path)

    def test_opacity_scales_and_colour_follow_the_exporters_conventions(self):
        t = plyread.tables(self.path, transform=np.eye(4))
        np.testing.assert_allclose(t["opa"].astype(np.float32), 1 / (1 + np.exp(-np.array([0.0, 2.0, -3.0]))), rtol=1e-3)
        np.testing.assert_allclose(t["scl"][0].astype(np.float32), [0.01, 0.2, 0.3], rtol=1e-3)        # sorted, metres
        want = np.clip(np.round((0.5 + C0 * np.array([0.0, 1.0, -1.0])) * 255), 0, 255)
        np.testing.assert_array_equal(t["rgb"][0], want.astype(np.uint8))                            # as 01_extract packs it
        np.testing.assert_array_equal(t["rgb"][2], [255, 0, 128])                                     # clamped like the product

    def test_the_normal_is_the_smallest_axis_rotated_into_the_frame(self):
        t = plyread.tables(self.path, transform=np.eye(4))
        n = t["nrm"].astype(np.float32)
        np.testing.assert_allclose(np.abs(n[0]), [0, 0, 1], atol=1e-3)
        np.testing.assert_allclose(np.abs(n[1]), [0, 1, 0], atol=1e-3)     # 90 degrees about x takes local z to y
        np.testing.assert_allclose(np.abs(n[2]), [1, 0, 0], atol=1e-3)

    def test_positions_and_normals_go_through_the_frame_transform_as_01_extract_does(self):
        T = np.eye(4)
        T[:3, :3] = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]                     # a json-from-e57 rotation of 90 degrees about z
        T[:3, 3] = [5.0, -2.0, 0.5]
        t = plyread.tables(self.path, transform=T)
        P = np.asarray([r[0:3] for r in self.rows], np.float64)
        np.testing.assert_allclose(t["pos"], ((P - T[:3, 3]) @ T[:3, :3]).astype(np.float32), atol=1e-6)
        n_e = np.abs(t["nrm"][1].astype(np.float32))
        np.testing.assert_allclose(n_e, np.abs(np.array([0, 1, 0]) @ T[:3, :3]), atol=1e-3)

    def test_the_evening_base_colour_comes_from_its_own_file(self):
        eve = np.array([[0.5, 0.5, 0.5], [-1.0, 0.0, 1.0], [0.0, 0.0, 0.0]], np.float32)
        np.save(os.path.join(self.dir, "evening_f_dc.npy"), eve)
        t = plyread.tables(self.path, transform=np.eye(4), evening_dc=os.path.join(self.dir, "evening_f_dc.npy"))
        want = np.clip(np.round((0.5 + C0 * eve) * 255), 0, 255).astype(np.uint8)
        np.testing.assert_array_equal(t["rgb_eve"], want)
        np.testing.assert_array_equal(t["rgb"][0], np.clip(np.round((0.5 + C0 * np.array([0.0, 1.0, -1.0])) * 255), 0, 255))

    def test_an_evening_file_of_another_length_is_refused(self):
        np.save(os.path.join(self.dir, "eve.npy"), np.zeros((2, 3), np.float32))
        with self.assertRaises(ValueError):
            plyread.tables(self.path, transform=np.eye(4), evening_dc=os.path.join(self.dir, "eve.npy"))

    def test_chunked_reading_gives_the_same_tables(self):
        a = plyread.tables(self.path, transform=np.eye(4))
        b = plyread.tables(self.path, transform=np.eye(4), chunk=1)
        for k in a:
            np.testing.assert_array_equal(a[k], b[k])


if __name__ == "__main__":
    unittest.main()
