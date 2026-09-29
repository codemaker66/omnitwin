import unittest
import numpy as np
from relight import codec


class LogCodes(unittest.TestCase):
    def test_round_trip_within_a_twentieth_of_a_stop(self):
        rng = np.random.default_rng(1)
        lo, hi = -20.0, 5.0
        v = np.exp2(rng.uniform(lo, hi, 100_000))
        back = codec.decode_log(codec.encode_log(v, lo, hi), lo, hi)
        self.assertLessEqual(float(np.abs(np.log2(back) - np.log2(v)).max()), 0.05)

    def test_zero_is_code_zero_and_decodes_to_zero(self):
        c = codec.encode_log(np.array([0.0, -1.0, 1e-30]), -25.0, 0.0)
        self.assertEqual(c.tolist(), [0, 0, 1])
        self.assertEqual(codec.decode_log(np.array([0]), -25.0, 0.0).tolist(), [0.0])

    def test_source_range_spans_25_stops_below_the_maximum(self):
        lo, hi = codec.source_range(np.array([0.0, 0.3, 5.0]))
        self.assertEqual((lo, hi), (-22.0, 3.0))

    def test_empty_source_has_a_valid_range(self):
        self.assertEqual(codec.source_range(np.zeros(4)), (-25.0, 0.0))


class Normals(unittest.TestCase):
    def test_octahedral_round_trip_within_two_degrees(self):
        rng = np.random.default_rng(2)
        n = rng.normal(size=(50_000, 3)); n /= np.linalg.norm(n, axis=1, keepdims=True)
        back = codec.decode_octahedral(codec.encode_octahedral(n))
        ang = np.degrees(np.arccos(np.clip((n * back).sum(1), -1, 1)))
        self.assertLessEqual(float(ang.max()), 2.0)

    def test_axis_normals_are_exact_enough(self):
        n = np.array([[0, 0, 1.0], [0, 0, -1.0], [1.0, 0, 0], [0, -1.0, 0]])
        back = codec.decode_octahedral(codec.encode_octahedral(n))
        self.assertTrue(np.allclose(back, n, atol=0.01))


class Records(unittest.TestCase):
    def test_records_round_trip(self):
        rng = np.random.default_rng(3)
        direct = np.exp2(rng.uniform(-10, 2, size=(1000, 9))); direct[::7, 3] = 0.0
        normals = rng.normal(size=(1000, 3)); normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        flags = rng.integers(0, 256, 1000).astype(np.uint8)
        ranges = [codec.source_range(direct[:, k]) for k in range(9)]
        buf = codec.pack_records(direct, normals, flags, ranges)
        self.assertEqual(len(buf), 1000 * codec.RECORD_BYTES)
        d2, n2, f2 = codec.unpack_records(buf, ranges)
        ok = direct > 0
        self.assertTrue(np.array_equal(d2 == 0, ~ok))
        self.assertLessEqual(float(np.abs(np.log2(d2[ok]) - np.log2(direct[ok])).max()), 0.05)
        self.assertTrue(np.array_equal(f2, flags))

    def test_flags_layout(self):
        self.assertEqual(codec.CLASS_MASK, 0b111)
        self.assertEqual((codec.FLAG_ISO, codec.FLAG_SUN, codec.FLAG_CH_CENTRE), (8, 16, 32))


class Multipliers(unittest.TestCase):
    def test_multiplier_words_round_trip(self):
        rgb = np.array([[1.0, 0.5, 8.0], [1 / 16, 2.0, 0.0], [3.0, 3.0, 3.0]])
        alpha = np.array([1.0, 1.0, 0.0])
        words = codec.pack_multiplier(rgb, alpha)
        self.assertEqual(words.dtype, np.uint32)
        back, a = codec.unpack_multiplier(words)
        nz = rgb > 0
        self.assertLessEqual(float(np.abs(np.log2(back[nz]) - np.log2(rgb[nz])).max()), 0.05)
        self.assertEqual(float(back[1, 2]), 0.0)
        self.assertEqual(a.tolist(), [1.0, 1.0, 0.0])

    def test_multipliers_are_clamped_to_the_spec_range(self):
        back, _ = codec.unpack_multiplier(codec.pack_multiplier(np.array([[100.0, 1e-9, 1.0]]), np.array([1.0])))
        self.assertAlmostEqual(float(back[0, 0]), 8.0, places=6)
        self.assertAlmostEqual(float(back[0, 1]), 1 / 16, places=6)


if __name__ == "__main__":
    unittest.main()
