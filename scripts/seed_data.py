"""Explicitly import the fictional demonstration data; never run automatically."""

from pathlib import Path

from scripts.cli import main

if __name__ == "__main__":
    sample = Path(__file__).resolve().parents[1] / "examples" / "sample_cafes.csv"
    raise SystemExit(main(["import-data", str(sample)]))
