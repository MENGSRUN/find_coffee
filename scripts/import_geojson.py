"""Import validated point GeoJSON using the installed application's CLI."""

import sys

from scripts.cli import main

if __name__ == "__main__":
    raise SystemExit(main(["import-data", *sys.argv[1:]]))
