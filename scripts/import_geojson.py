"""Import validated point GeoJSON using the data utilities."""

import sys

from scripts.data import main

if __name__ == "__main__":
    raise SystemExit(main(["import-data", *sys.argv[1:]]))
