"""``python -m app.data.updater`` -- the controlled update CLI (D14 §15, §34).

    python -m app.data.updater --check                       # dry run (default)
    python -m app.data.updater --update                      # do the update
    python -m app.data.updater --check  --dataset currents
    python -m app.data.updater --update --dataset temperature-salinity
    python -m app.data.updater --check  --json

``--check`` never downloads bulk data and never writes a ``.bnx``. ``--update``
acquires only the D4 regional subset, runs D7/D8/D9, verifies, and atomically
publishes; on any failure the installed dataset is untouched.

This command is **not** run automatically. See ``docs/data-updating.md`` for how
a future scheduler could invoke it, and why scheduling is out of scope for D14.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from typing import Optional

from .core import CheckResult, UpdateResult, make_updater
from .sources import ALL_GROUPS, GROUP_CURRENTS, GROUP_TEMPERATURE_SALINITY

_DATASET_CHOICES = {
    "all": list(ALL_GROUPS),
    "temperature-salinity": [GROUP_TEMPERATURE_SALINITY],
    "currents": [GROUP_CURRENTS],
}


def _parse_args(argv: Optional[list[str]]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="python -m app.data.updater",
        description="Controlled INCOIS data updating (D14). Not a scheduler.",
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true",
                      help="dry run: report whether a newer source exists (default)")
    mode.add_argument("--update", action="store_true",
                      help="acquire + D7/D8/D9 + verify + atomically publish a newer source")
    p.add_argument("--dataset", choices=sorted(_DATASET_CHOICES), default="all")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--erddap-url", default=None, help="override the ERDDAP base URL")
    p.add_argument("--thredds-url", default=None, help="override the THREDDS base URL")
    return p.parse_args(argv)


def _print_check(results: list[CheckResult], as_json: bool) -> int:
    if as_json:
        print(json.dumps([dataclasses.asdict(r) for r in results], indent=2))
    else:
        print("D14 source check (dry run -- nothing was downloaded or written)\n")
        for r in results:
            if not r.ok:
                print(f"  {r.logical_dataset_id:32}  SOURCE CHECK FAILED  ({r.error})")
                continue
            state = "NEWER SOURCE AVAILABLE" if r.newer_available else "up to date"
            print(f"  {r.logical_dataset_id:32}  {state}")
            print(f"      source          : {r.source_name}")
            print(f"      installed        : {r.installed_version}")
            print(f"      latest available : {r.latest_version}")
            if r.remote_last_modified:
                print(f"      source modified  : {r.remote_last_modified}")
        newer = [r for r in results if r.newer_available]
        errs = [r for r in results if not r.ok]
        print()
        if newer:
            names = ", ".join(r.logical_dataset_id for r in newer)
            print(f"  -> run:  python -m app.data.updater --update  ({names} would update)")
        elif not errs:
            print("  All datasets are up to date.")
    return 2 if any(not r.ok for r in results) else 0


def _print_update(results: list[UpdateResult], as_json: bool) -> int:
    if as_json:
        print(json.dumps([dataclasses.asdict(r) for r in results], indent=2))
        return 0 if all(r.ok for r in results) else 1

    print("D14 controlled update\n")
    for r in results:
        head = {"updated": "UPDATED", "up-to-date": "up to date", "failed": "FAILED"}[r.action]
        print(f"  {r.logical_dataset_id:32}  {head}")
        for m in r.messages:
            print(f"      - {m}")
        if r.action == "updated":
            print(f"      from {r.from_version}  ->  {r.to_version}")
            print(f"      artifact sha256 : {r.artifact_sha256}")
        if r.action == "failed":
            print(f"      stage  : {r.stage_failed}")
            print(f"      reason : {r.error}")
            print("      the previously installed dataset was NOT replaced.")
        print()

    failed = [r for r in results if not r.ok]
    updated = [r for r in results if r.action == "updated"]
    if failed and updated:
        print("  Partial update: "
              + ", ".join(r.logical_dataset_id for r in updated) + " updated; "
              + ", ".join(r.logical_dataset_id for r in failed)
              + " kept its previous version.")
    return 1 if failed else 0


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)
    groups = _DATASET_CHOICES[args.dataset]
    updater = make_updater(erddap_url=args.erddap_url, thredds_url=args.thredds_url)

    if args.update:
        return _print_update(updater.update(groups), args.json)
    return _print_check(updater.check(groups), args.json)


if __name__ == "__main__":
    raise SystemExit(main())
