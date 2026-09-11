"""``python -m app.data.bluenexus`` -- convert every D8 dataset to the BlueNexus
format, write a ``.bnx`` container per dataset under ``data/bluenexus/``, and
print a summary + a round-trip check. Read-only w.r.t. ``data/raw/``.
"""

from __future__ import annotations

import math

from ..ingestion import project_root
from . import contract_sha256, convert_all, read_bluenexus, write_bluenexus


def main() -> int:
    out_dir = project_root() / "data" / "bluenexus"
    for name, ds in convert_all().items():
        print("=" * 78)
        print(ds.summary())
        path = write_bluenexus(ds, out_dir / f"{name}.bnx")
        size = path.stat().st_size
        back = read_bluenexus(path)
        ok = contract_sha256(back) == contract_sha256(ds)
        # spot-check one array round-trips (NaN-safe)
        pid = next(iter(ds.parameters))
        a, b = ds.arrays[pid].values, back.arrays[pid].values
        same = all(
            (math.isnan(x) and math.isnan(y)) or x == y
            for x, y in zip(a[:: max(1, len(a) // 5000)], b[:: max(1, len(b) // 5000)])
        )
        print(f"\n  wrote {path}  ({size:,} bytes)")
        print(f"  contract_sha256 : {contract_sha256(ds)}")
        print(f"  round-trip contract match : {ok}")
        print(f"  round-trip array sample match : {same}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
