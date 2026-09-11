"""``python -m app.data.processing`` -- clean every dataset and print a summary
plus write the JSON manifests under ``data/processed/``. Read-only w.r.t.
``data/raw/``.
"""

from __future__ import annotations

from . import process_all, write_manifest


def main() -> int:
    for name, cleaned in process_all().items():
        print("=" * 78)
        print(cleaned.summary())
        path = write_manifest(cleaned)
        print(f"\n  manifest written: {path}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
