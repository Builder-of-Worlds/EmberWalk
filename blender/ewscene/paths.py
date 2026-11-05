import os
import re
import subprocess
import sys

MARKER = ".venture-root"
SESSION = re.compile(r"\d{3}-[a-z0-9]+(-[a-z0-9]+)*")
ASSETS_PART = "emberwalk-assets/"


def venture_root(start=None):
    here = os.path.dirname(os.path.abspath(start or __file__))
    common = subprocess.run(["git", "-C", here, "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True).stdout.strip()
    if common:
        return os.path.dirname(os.path.dirname(common))
    d = here
    while not os.path.isfile(os.path.join(d, MARKER)):
        parent = os.path.dirname(d)
        if parent == d:
            raise RuntimeError("no %s above %s; set EMBERWALK_RENDERS and EMBERWALK_ASSETS" % (MARKER, here))
        d = parent
    return d


def renders_dir():
    return os.environ.get("EMBERWALK_RENDERS") or os.path.join(venture_root(), "emberwalk-renders")


def session_dir(code_dir=None):
    name = os.environ.get("EMBERWALK_SESSION")
    if not name:
        head = subprocess.run(["git", "-C", code_dir or os.path.dirname(os.path.abspath(__file__)), "symbolic-ref", "-q", "--short", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
        name = head.rsplit("/", 1)[-1]
    if not SESSION.fullmatch(name):
        raise RuntimeError("renders go to emberwalk-renders/<NNN-slug>/; run from a branch ending in /NNN-slug or set EMBERWALK_SESSION=NNN-slug (got %r)" % name)
    return os.path.join(renders_dir(), name)


def assets_dir():
    return os.environ.get("EMBERWALK_ASSETS") or os.path.join(venture_root(), "emberwalk-assets")


def repath_images(images, assets=None):
    root = assets or assets_dir()
    moved = 0
    for im in images:
        if getattr(im, "source", "FILE") != "FILE" or ASSETS_PART not in im.filepath:
            continue
        new = os.path.join(root, im.filepath.split(ASSETS_PART, 1)[1])
        if new != im.filepath:
            im.filepath = new
            im.reload()
            moved += 1
    return moved


def relink(data, assets=None):
    return repath_images(data.libraries, assets) + repath_images(data.images, assets)


def script_args(argv=None):
    argv = sys.argv if argv is None else argv
    return argv[argv.index("--") + 1:] if "--" in argv else []
