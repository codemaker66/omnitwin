"""Tests only: runs one old Grand Hall script the way build.sh does, in the current directory.

    python -X utf8 run_old.py <tools/grand-hall-survey/script.py> [args...]

project is imported first (its DATA is <cwd>/data), so SURVEYED_ROOMS_TEST_DEPTH_SIZE can set
project.DEPTH_SIZE for the small synthetic depth maps; the script then runs as __main__ with the
given arguments and finds that same module when it does `from project import *`.
"""
import os
import runpy
import sys

SURVEY = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "grand-hall-survey"))
sys.path.insert(0, SURVEY)
import project  # noqa: E402

size = os.environ.get("SURVEYED_ROOMS_TEST_DEPTH_SIZE")
if size:
    project.DEPTH_SIZE = int(size)
script = os.path.abspath(sys.argv[1])
sys.argv = [script] + sys.argv[2:]
runpy.run_path(script, run_name="__main__")
