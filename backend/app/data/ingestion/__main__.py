"""``python -m app.data.ingestion`` -- print a read-only summary of every
registered INCOIS dataset and its schema report. Handy for a quick manual
check; it ingests and prints, nothing else.
"""

from __future__ import annotations

from . import ALL_SPECS, ingest_dataset, run_checks, sha256_of


def main() -> int:
    for spec in ALL_SPECS:
        print("=" * 78)
        path = spec.path()
        print(f"{spec.name}")
        print(f"  file   : {path}")
        print(f"  sha256 : {sha256_of(path)}")
        ds = ingest_dataset(spec, run_schema_checks=False)
        print(ds.summary())
        report = run_checks(ds, spec)
        print()
        print(report)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
