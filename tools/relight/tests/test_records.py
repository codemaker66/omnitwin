import unittest
import numpy as np
from relight import codec, records


class Flags(unittest.TestCase):
    def test_flags_pack_class_iso_reach_and_group(self):
        f = records.flags_for(cls=np.array([0, 1, 2, 3, 3, 4]), iso=np.array([1, 0, 0, 0, 0, 0], bool),
                              reach=np.array([1, 1, 0, 0, 0, 0], bool), chand_id=np.array([-1, -1, -1, 0, 4, -1]),
                              centre_ids=(4,), cove=np.zeros(6, bool), fixture=np.zeros(6, bool), pane=np.zeros(6, bool))
        self.assertEqual(int(f[0]), codec.CLASS_INTERIOR | codec.FLAG_ISO | codec.FLAG_SUN)
        self.assertEqual(int(f[1]) & codec.CLASS_MASK, codec.CLASS_EMBRASURE)
        self.assertEqual(int(f[2]) & codec.CLASS_MASK, codec.CLASS_HIDDEN)
        self.assertEqual(int(f[3]), codec.CLASS_CH_EMITTER)
        self.assertEqual(int(f[4]), codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE)
        self.assertEqual(int(f[5]) & codec.CLASS_MASK, codec.CLASS_DOME_EMITTER)

    def test_pane_haze_is_hidden_and_the_cove_strip_is_its_own_class(self):
        f = records.flags_for(cls=np.array([1, 0]), iso=np.zeros(2, bool), reach=np.zeros(2, bool), chand_id=np.array([-1, -1]),
                              centre_ids=(4,), cove=np.array([False, True]), fixture=np.zeros(2, bool), pane=np.array([True, False]))
        self.assertEqual(int(f[0]) & codec.CLASS_MASK, codec.CLASS_HIDDEN)
        self.assertEqual(int(f[1]) & codec.CLASS_MASK, codec.CLASS_COVE)


class Transfer(unittest.TestCase):
    def test_transfer_takes_the_nearest_values(self):
        src = np.array([[0.0, 0, 0], [10.0, 0, 0]]); vals = np.array([[1.0], [3.0]])
        out = records.transfer(src, vals, np.array([[0.1, 0, 0], [9.8, 0, 0]]), k=1)
        self.assertEqual(out[:, 0].tolist(), [1.0, 3.0])

    def test_transfer_blends_by_inverse_distance(self):
        src = np.array([[0.0, 0, 0], [2.0, 0, 0]]); vals = np.array([[1.0], [3.0]])
        out = records.transfer(src, vals, np.array([[1.0, 0, 0]]), k=2)
        self.assertAlmostEqual(float(out[0, 0]), 2.0, places=6)


class Covers(unittest.TestCase):
    COVERS = {"ids": np.array(["door-w2"]), "groups": np.array([0], np.int8),
              "frames": np.array([[0.0, 0, 0, 1, 0, 0, 0, 0, -1, 0, -1, 0]]),     # origin, u +x, v -z, normal -y
              "cell": np.float64(0.05), "shapes": np.array([[2, 2]]), "offsets": np.array([0]),
              "wmin": np.array([0.0, 0.0, 0.0, np.nan], np.float32), "wmax": np.array([0.01, 0.01, 0.01, np.nan], np.float32)}

    def test_splats_in_the_envelope_are_covered_in_their_group(self):
        P = np.array([[0.02, -0.02, -0.02], [0.02, -0.20, -0.02], [0.07, -0.02, -0.07], [0.02, 0.05, -0.02]])
        self.assertEqual(records.cover_test(P, np.full(4, 0.002), self.COVERS).tolist(), [0, -1, -1, 0])

    def test_boxes_keep_objects_as_splats_and_toggle_them(self):
        P = np.array([[0.02, -0.02, -0.02], [0.03, -0.02, -0.03], [5.0, 5.0, 5.0]])
        box = (np.array([0.025, -0.1, -0.05]), np.array([0.05, 0.0, 0.0]))
        covered = records.apply_covers(np.zeros(3, np.uint8), P, np.full(3, 0.002), self.COVERS, [box])
        self.assertEqual(codec.skin_group_of(covered).tolist(), [0, -1, -1])
        toggled = records.apply_toggles(covered, P, [(box[0], box[1], 1)])
        self.assertEqual(codec.toggle_of(toggled).tolist(), [0, 1, 0])


if __name__ == "__main__":
    unittest.main()
