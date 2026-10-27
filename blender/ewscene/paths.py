import os
import sys


def renders_dir():
    return os.environ.get("EMBERWALK_RENDERS") or os.path.expanduser("~/emberwalk-renders")


def script_args(argv=None):
    argv = sys.argv if argv is None else argv
    return argv[argv.index("--") + 1:] if "--" in argv else []
