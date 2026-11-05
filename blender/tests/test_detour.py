import copy
import unittest

import support
from ewscene import detour


def walk(n=6441):
    return [{"frame": i + 1, "t": i / 30.0, "pos_in": [900.0, 700.0 - i * 0.1, 54.0], "heading_deg": (i * 0.01) % 360, "tilt_deg": 0.0, "roll_deg": 0.0, "shift_y": -0.118} for i in range(n)]


class Detour(unittest.TestCase):
    def test_only_positions_in_the_windows_change(self):
        before = walk()
        after = detour.apply(before)
        moved = detour.changed(before, after)
        self.assertTrue(moved)
        for n in moved:
            self.assertTrue(any(a <= n <= b for a, b in detour.WINDOWS), n)
        for a, b in zip(before, after):
            self.assertEqual({k: v for k, v in a.items() if k != "pos_in"}, {k: v for k, v in b.items() if k != "pos_in"})
            self.assertEqual(a["pos_in"][2], b["pos_in"][2])

    def test_the_input_is_left_alone(self):
        before = walk()
        keep = copy.deepcopy(before)
        detour.apply(before)
        self.assertEqual(before, keep)

    def test_each_window_starts_and_ends_on_the_original_path(self):
        before = walk()
        after = detour.apply(before)
        for a, b in detour.WINDOWS:
            self.assertEqual(before[a - 1]["pos_in"], after[a - 1]["pos_in"])
            self.assertEqual(before[b - 1]["pos_in"], after[b - 1]["pos_in"])

    def test_a_walker_at_the_route_pace_never_moves_faster_than_a_brisk_step(self):
        steady = walk()
        for s in steady:
            s["pos_in"][1] = 700.0 - (s["frame"] - 1) * 1.0
        self.assertAlmostEqual(detour.top_speed_m_s(steady, 30), 0.762, places=2)
        self.assertLess(detour.top_speed_m_s(detour.apply(steady), 30), 1.2)

    def test_the_offset_never_jumps_between_frames(self):
        before = walk()
        after = detour.apply(before)
        for a, b in zip(after, after[1:]):
            self.assertLess(abs(b["pos_in"][0] - a["pos_in"][0]) + abs(b["pos_in"][1] - a["pos_in"][1]), 12.0)


class MergeTruth(unittest.TestCase):
    def doc(self):
        rows = [{"frame": n, "t": (n - 1) / 30.0, "box_px": [1, 1, 5, 5], "area_px": 300} for n in (1, 2, 3, 4)]
        return {"hazards": [{"id": "a", "frame_boxes": rows, "visible_frames": 4, "visible_s": []}, {"id": "b", "label": "x"}]}

    def test_redone_frames_take_the_new_boxes_and_the_rest_keep_theirs(self):
        samples = walk(6)
        mask_pass = {"frames": [{"frame": 2, "boxes": {"a": None}}, {"frame": 3, "boxes": {"a": {"box_px": [9, 9, 20, 20], "area_px": 400}}}]}
        out = detour.merge_truth(self.doc(), mask_pass, samples)
        rows = {b["frame"]: b for b in out["hazards"][0]["frame_boxes"]}
        self.assertEqual(sorted(rows), [1, 3, 4])
        self.assertEqual(rows[3]["box_px"], [9, 9, 20, 20])
        self.assertEqual(rows[1]["box_px"], [1, 1, 5, 5])
        self.assertEqual(out["hazards"][0]["visible_frames"], 3)
        self.assertEqual(out["hazards"][0]["visible_s"], [[samples[0]["t"], samples[0]["t"]], [samples[2]["t"], samples[3]["t"]]])
        self.assertNotIn("frame_boxes", out["hazards"][1])

    def test_a_frame_a_hazard_gains_is_added_in_order(self):
        samples = walk(6)
        mask_pass = {"frames": [{"frame": 5, "boxes": {"a": {"box_px": [2, 2, 8, 8], "area_px": 250}}}]}
        out = detour.merge_truth(self.doc(), mask_pass, samples)
        self.assertEqual([b["frame"] for b in out["hazards"][0]["frame_boxes"]], [1, 2, 3, 4, 5])


if __name__ == "__main__":
    unittest.main()
