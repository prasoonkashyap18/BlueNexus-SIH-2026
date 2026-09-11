"""BlueNexus Data Track **D14 -- controlled data updating**.

Detects when a newer official INCOIS source dataset/file is available, runs it
through the *existing* D7 -> D8 -> D9 pipeline, verifies the result, and
atomically publishes it so the D10 API serves it -- while the previously working
``.bnx`` stays safe if anything fails.

    official INCOIS source (ERDDAP / THREDDS)
      -> D14 check  (is there a newer source? -- catalog/metadata only)
      -> D14 acquire (download the D4 regional subset, verify it)
      -> D7 ingest -> D8 process -> D9 convert
      -> verify the generated .bnx
      -> ATOMIC publish (os.replace)
      -> update the manifest
      -> D10 API serves the new artifact on next load

This is **not** a scheduler and makes **no** "real-time" claim: analysis
products report "latest available INCOIS analysis", the forecast reports "latest
INCOIS IO-HOOFS forecast". See ``docs/data-updating.md``.

CLI::

    python -m app.data.updater --check                 # dry run, no writes
    python -m app.data.updater --update                # controlled update
    python -m app.data.updater --check --dataset currents
"""

from .core import (
    CheckResult,
    UpdateError,
    UpdateResult,
    Updater,
    atomic_publish,
    make_updater,
    run_d7_d8_d9,
    verify_artifact,
)
from .manifest import MANIFEST_SCHEMA, ManifestStore, default_manifest_path
from .sources import (
    ALL_GROUPS,
    GROUP_CURRENTS,
    GROUP_TEMPERATURE_SALINITY,
    AcquiredFile,
    DatasetSource,
    ErddapArgoSource,
    FixtureSource,
    SourceError,
    SourceVersion,
    ThreddsCurrentsSource,
    default_sources,
    logical_dataset_id,
)

__all__ = [
    "CheckResult",
    "UpdateError",
    "UpdateResult",
    "Updater",
    "atomic_publish",
    "make_updater",
    "run_d7_d8_d9",
    "verify_artifact",
    "MANIFEST_SCHEMA",
    "ManifestStore",
    "default_manifest_path",
    "ALL_GROUPS",
    "GROUP_CURRENTS",
    "GROUP_TEMPERATURE_SALINITY",
    "AcquiredFile",
    "DatasetSource",
    "ErddapArgoSource",
    "FixtureSource",
    "SourceError",
    "SourceVersion",
    "ThreddsCurrentsSource",
    "default_sources",
    "logical_dataset_id",
]
