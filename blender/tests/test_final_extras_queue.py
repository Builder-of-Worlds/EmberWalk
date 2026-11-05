import os
import stat
import subprocess
import tempfile
import time
import unittest

import support

QUEUE = os.path.join(support.BLENDER_DIR, "final_extras_queue.sh")
STUB = """#!/usr/bin/env python3
import os, sys
a = sys.argv
script = os.path.basename(a[a.index("--python") + 1])
with open(os.environ["STUB_CALLS"], "a") as f:
    f.write(script + "\\n")
if os.environ.get("STUB_FAIL") == script:
    sys.exit(1)
tail = a[a.index("--") + 1:]
if script == "final_after.py":
    open(tail[tail.index("--out") + 1], "w").write("x")
elif script == "final_aerial.py":
    open(tail[2], "w").write("x")
else:
    os.makedirs(tail[5], exist_ok=True)
    open(os.path.join(tail[5], "recheck.json"), "w").write("{}")
"""


class Queue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = self.tmp.name
        self.final = os.path.join(self.dir, "final")
        os.makedirs(self.final)
        os.makedirs(os.path.join(self.dir, "pile"))
        self.calls = os.path.join(self.dir, "calls")
        open(self.calls, "w").close()
        self.first_log = os.path.join(self.final, "queue.log")
        open(self.first_log, "w").write("CHUNK 1-200 exit 0 10:00\n")
        self.stub = os.path.join(self.dir, "blender-stub")
        with open(self.stub, "w") as f:
            f.write(STUB)
        os.chmod(self.stub, os.stat(self.stub).st_mode | stat.S_IXUSR)
        self.sleeper = subprocess.Popen(["sleep", "60"])
        self.addCleanup(self.sleeper.kill)

    def env(self, **extra):
        env = dict(os.environ, F=self.final, PILE=os.path.join(self.dir, "pile"), B=self.stub, C=support.REPO_DIR,
                   EW_QUEUE_PID=str(self.sleeper.pid), EW_POLL="0.05", STUB_CALLS=self.calls)
        env.update(extra)
        return env

    def run_queue(self, **extra):
        return subprocess.run(["sh", QUEUE], env=self.env(**extra), capture_output=True, text=True, timeout=30)

    def start_queue(self, **extra):
        return subprocess.Popen(["sh", QUEUE], env=self.env(**extra), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def seen(self):
        with open(self.calls) as f:
            return f.read().split()

    def log(self):
        with open(os.path.join(self.final, "queue2.log")) as f:
            return f.read()

    def finish_first(self):
        with open(self.first_log, "a") as f:
            f.write("ALL_DONE 0 23:59\n")

    def test_it_renders_nothing_while_the_first_queue_runs_then_the_three_in_order(self):
        p = self.start_queue()
        time.sleep(0.6)
        self.assertIsNone(p.poll())
        self.assertEqual(self.seen(), [])
        self.finish_first()
        self.assertEqual(p.wait(timeout=30), 0, p.stdout.read())
        self.assertEqual(self.seen(), ["final_after.py", "final_aerial.py", "final_recheck.py"])
        self.assertIn("EXTRAS_DONE", self.log())
        self.assertTrue(os.path.isfile(os.path.join(self.final, "aerial", "aerial.png")))
        self.assertFalse(os.path.exists(os.path.join(self.final, "aerial", "aerial.png.part")))

    def test_without_the_aerial_only_the_after_scene_and_the_stills_render(self):
        self.finish_first()
        r = self.run_queue(EW_AERIAL="0")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.seen(), ["final_after.py", "final_recheck.py"])
        self.assertFalse(os.path.exists(os.path.join(self.final, "aerial", "aerial.png")))
        open(self.calls, "w").close()
        self.assertEqual(self.run_queue().returncode, 0)
        self.assertEqual(self.seen(), ["final_aerial.py"])

    def test_a_first_queue_that_died_without_finishing_starts_nothing(self):
        self.sleeper.kill()
        self.sleeper.wait()
        r = self.run_queue()
        self.assertEqual(r.returncode, 4)
        self.assertEqual(self.seen(), [])
        self.assertIn("FIRST_QUEUE_GONE", self.log())

    def test_a_failed_step_stops_the_queue_and_names_it(self):
        self.finish_first()
        r = self.run_queue(STUB_FAIL="final_aerial.py")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.seen(), ["final_after.py", "final_aerial.py"])
        self.assertIn("AERIAL_FAILED", self.log())
        self.assertNotIn("EXTRAS_DONE", self.log())
        self.assertFalse(os.path.exists(os.path.join(self.final, "aerial", "aerial.png")))

    def test_a_rerun_skips_the_steps_that_finished(self):
        self.finish_first()
        self.run_queue(STUB_FAIL="final_recheck.py")
        open(self.calls, "w").close()
        r = self.run_queue()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.seen(), ["final_recheck.py"])
        self.assertIn("EXTRAS_DONE", self.log())
        open(self.calls, "w").close()
        self.assertEqual(self.run_queue().returncode, 0)
        self.assertEqual(self.seen(), [])


if __name__ == "__main__":
    unittest.main()
