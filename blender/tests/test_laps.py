import unittest

import support
from ewscene import laps

WALL_IN = 96.0


class LapBoards(unittest.TestCase):
    def test_boards_are_about_six_and_a_half_inches_and_fill_the_wall_exactly(self):
        pitch = laps.pitch(WALL_IN)
        self.assertGreaterEqual(pitch, 5.5)
        self.assertLessEqual(pitch, 7.5)
        self.assertAlmostEqual(WALL_IN / pitch, round(WALL_IN / pitch), places=6)

    def test_a_whole_wall_is_stacked_boards_with_no_gap_from_the_ground_to_the_eave(self):
        boards = laps.boards(0.0, WALL_IN, WALL_IN)
        self.assertEqual(len(boards), round(WALL_IN / laps.pitch(WALL_IN)))
        self.assertAlmostEqual(boards[0]["z0"], 0.0)
        self.assertAlmostEqual(boards[-1]["z1"], WALL_IN)
        for lower, upper in zip(boards, boards[1:]):
            self.assertAlmostEqual(lower["z1"], upper["z0"])

    def test_each_board_stands_proud_at_its_lower_edge_and_tucks_flat_at_its_top(self):
        for b in laps.boards(0.0, WALL_IN, WALL_IN):
            self.assertGreaterEqual(b["out0"], 0.5)
            self.assertLessEqual(b["out0"], 1.0)
            self.assertLessEqual(b["out1"], 0.1)
            self.assertGreater(b["out1"], 0.0)

    def test_a_panel_cut_by_a_window_keeps_the_same_board_lines_and_stays_inside_the_panel(self):
        boards = laps.boards(30.0, 66.0, WALL_IN)
        self.assertAlmostEqual(boards[0]["z0"], 30.0)
        self.assertAlmostEqual(boards[-1]["z1"], 66.0)
        pitch = laps.pitch(WALL_IN)
        for b in boards:
            self.assertGreaterEqual(b["z0"], 30.0 - 1e-6)
            self.assertLessEqual(b["z1"], 66.0 + 1e-6)
            line = b["z1"] / pitch
            self.assertTrue(abs(line - round(line)) < 1e-6 or abs(b["z1"] - 66.0) < 1e-6, b)
        full = [b for b in boards if abs((b["z1"] - b["z0"]) - pitch) < 1e-6]
        self.assertGreaterEqual(len(full), 4)

    def test_a_clipped_board_keeps_the_slope_of_its_full_board(self):
        top = laps.boards(0.0, 10.0, WALL_IN)[-1]
        full = laps.boards(0.0, WALL_IN, WALL_IN)[1]
        self.assertAlmostEqual(top["z1"], 10.0)
        self.assertLess(top["out0"], full["out0"] + 1e-9)
        slope = (top["out0"] - top["out1"]) / (top["z1"] - top["z0"])
        full_slope = (full["out0"] - full["out1"]) / (full["z1"] - full["z0"])
        self.assertAlmostEqual(slope, full_slope, places=6)

    def test_a_gable_row_narrows_toward_the_apex(self):
        rows = laps.gable_boards(WALL_IN, 150.0, 0.0, 300.0)
        spans = [(r["a0"], r["a1"]) for r in rows]
        self.assertGreater(len(rows), 5)
        widths = [r["a1"] - r["a0"] for r in rows]
        self.assertEqual(widths, sorted(widths, reverse=True))
        self.assertAlmostEqual(rows[0]["z0"], WALL_IN)
        for a0, a1 in spans:
            self.assertAlmostEqual((a0 + a1) / 2.0, 150.0)


if __name__ == "__main__":
    unittest.main()
