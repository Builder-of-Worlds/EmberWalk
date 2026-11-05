import os
import tempfile
import unittest

import support  # noqa: F401
import render_chunks
from ewscene import chunks


def touch(folder, frame, size=1):
    with open(os.path.join(folder, chunks.frame_name(frame)), "wb") as f:
        f.write(b"x" * size)


class PickTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = self.tmp.name
        self.plan = chunks.plan(10, {8, 9}, 4)

    def tearDown(self):
        self.tmp.cleanup()

    def test_skips_every_frame_already_on_disk_in_plan_order(self):
        for f in (9, 10, 2):
            touch(self.folder, f)
        touch(self.folder, 3, size=0)
        self.assertEqual(chunks.pick(self.plan, self.folder, 1, 10, 100), [5, 6, 7, 8, 1, 3, 4])

    def test_stops_at_the_frame_limit(self):
        self.assertEqual(chunks.pick(self.plan, self.folder, 1, 10, 3), [5, 6, 7])

    def test_keeps_to_the_range(self):
        self.assertEqual(chunks.pick(self.plan, self.folder, 2, 4, 100), [2, 3, 4])

    def test_refuses_a_limit_below_one(self):
        with self.assertRaises(ValueError):
            chunks.pick(self.plan, self.folder, 1, 10, 0)

    def test_counts_the_frames_still_missing(self):
        for f in (1, 4, 10):
            touch(self.folder, f)
        touch(self.folder, 5, size=0)
        self.assertEqual(chunks.missing(10, self.folder), 7)


class DriverTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = self.tmp.name
        self.lines = []

    def tearDown(self):
        self.tmp.cleanup()

    def left(self):
        return chunks.missing(10, self.folder)

    def renderer(self, codes=None, per_call=None):
        calls = []

        def render(limit):
            calls.append(limit)
            if len(calls) > 20:
                raise AssertionError("the driver kept starting processes")
            todo = [f for f in range(1, 11) if not os.path.isfile(os.path.join(self.folder, chunks.frame_name(f)))]
            for f in todo[: per_call if per_call is not None else limit]:
                touch(self.folder, f)
            return codes.pop(0) if codes else 0

        return render, calls

    def test_starts_a_fresh_process_per_chunk_until_every_frame_exists(self):
        touch(self.folder, 2)
        render, calls = self.renderer()
        self.assertEqual(render_chunks.run(self.left, render, 4, self.lines.append), 0)
        self.assertEqual(calls, [4, 4, 4])
        self.assertEqual(self.left(), 0)

    def test_starts_no_process_when_every_frame_is_there(self):
        for f in range(1, 11):
            touch(self.folder, f)
        render, calls = self.renderer()
        self.assertEqual(render_chunks.run(self.left, render, 4, self.lines.append), 0)
        self.assertEqual(calls, [])

    def test_stops_when_a_process_fails(self):
        render, calls = self.renderer(codes=[0, 1])
        self.assertEqual(render_chunks.run(self.left, render, 4, self.lines.append), 1)
        self.assertEqual(calls, [4, 4])

    def test_stops_when_a_chunk_renders_nothing(self):
        render, calls = self.renderer(per_call=0)
        self.assertEqual(render_chunks.run(self.left, render, 4, self.lines.append), 1)
        self.assertEqual(calls, [4])


if __name__ == "__main__":
    unittest.main()
