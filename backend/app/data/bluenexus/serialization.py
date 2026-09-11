"""D9 serialisation -- the ``.bnx`` container.

Why this format (evaluated alternatives -- see ``docs/data-format.md`` §"format"):

* **Plain JSON** for everything: the currents arrays are ~3.0 M float64 values;
  as JSON text that is ~150 MB and cannot represent NaN. Rejected for bulk data.
* **NPZ / NetCDF**: both need a third-party library (`numpy` / `netCDF4`); the
  backend venv is pure-stdlib and Python 3.14 wheels are thin. Rejected.
* **`.bnx` = a tiny header + one JSON manifest + raw little-endian binary blobs**
  (chosen): deterministic, dependency-free (stdlib ``array``/``json``/``struct``),
  compact (float64 + uint8, no per-cell overhead), and trivial for D10 to serve
  (read manifest, seek to a blob, stream a byte range) and for browser JS to
  read (``DataView`` + ``Float64Array``).

Container layout::

    magic          12 bytes   b"BLUENEXUS/1\\n"
    manifest_len    8 bytes   uint64 little-endian
    manifest       <len>      UTF-8 JSON, json.dumps(sort_keys=True, separators=(",",":"))
    blobs          rest       concatenated in manifest["arrays_index"] order

    manifest = {
      "contract":  <BlueNexusDataset.contract()>,        # deterministic
      "arrays_index": [ {key, parameter_id, kind, dtype, count, byte_offset, byte_length}, ... ],
      "generation": { generated_at_utc, generator, contract_sha256 }   # NOT part of the contract
    }

``byte_offset`` is relative to the first byte after the manifest.
"""

from __future__ import annotations

import array
import hashlib
import json
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import (
    JSON_MISSING,
    SCHEMA_VERSION,
    BlueNexusArray,
    BlueNexusCoordinate,
    BlueNexusDataset,
    BlueNexusDimension,
    BlueNexusMetadata,
    BlueNexusParameter,
    BlueNexusProvenance,
)

MAGIC = b"BLUENEXUS/1\n"          # 12 bytes
_GENERATOR = "bluenexus-d9/1"


def _canonical_json(obj) -> bytes:
    return json.dumps(
        obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("utf-8")


def contract_sha256(ds: BlueNexusDataset) -> str:
    return hashlib.sha256(_canonical_json(ds.contract())).hexdigest()


def _to_le_f64(a: array.array) -> bytes:
    b = array.array("d", a)
    if sys.byteorder == "big":
        b.byteswap()
    return b.tobytes()


def _from_le_f64(raw: bytes) -> array.array:
    a = array.array("d")
    a.frombytes(raw)
    if sys.byteorder == "big":
        a.byteswap()
    return a


# ----------------------------------------------------------------------
# write
# ----------------------------------------------------------------------
def write_bluenexus(
    ds: BlueNexusDataset,
    path: str | Path,
    *,
    generated_at: Optional[str] = None,
) -> Path:
    """Serialise *ds* to ``path`` (a ``.bnx`` file). Refuses to write under
    ``data/raw/``.

    ``generated_at`` — pass a fixed ISO string for byte-reproducible output;
    ``None`` stamps the current UTC time (kept in ``generation``, which is *not*
    part of the deterministic contract).
    """
    path = Path(path)
    resolved = path.resolve()
    if any(p.name == "raw" and p.parent.name == "data" for p in resolved.parents):
        raise RuntimeError(f"refusing to write a BlueNexus artifact under data/raw/: {path}")

    contract = ds.contract()
    contract_bytes = _canonical_json(contract)
    csha = hashlib.sha256(contract_bytes).hexdigest()

    blobs: list[bytes] = []
    arrays_index: list[dict] = []
    offset = 0
    for pid in ds.contract()["metadata"]["parameter_ids"]:
        payload = ds.arrays[pid]
        for kind, buf, dtype, elem in (
            ("values", _to_le_f64(payload.values), "float64-le", 8),
            ("quality", bytes(payload.quality), "uint8", 1),
        ):
            arrays_index.append(
                {
                    "key": f"{pid}.{kind}",
                    "parameter_id": pid,
                    "kind": kind,
                    "dtype": dtype,
                    "count": len(buf) // elem,
                    "byte_offset": offset,
                    "byte_length": len(buf),
                }
            )
            blobs.append(buf)
            offset += len(buf)

    manifest = {
        "contract": contract,
        "arrays_index": arrays_index,
        "generation": {
            "generated_at_utc": generated_at
            or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generator": _GENERATOR,
            "contract_sha256": csha,
            "byte_order": "little-endian",
        },
    }
    manifest_bytes = json.dumps(
        manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("utf-8")

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack("<Q", len(manifest_bytes)))
        fh.write(manifest_bytes)
        for b in blobs:
            fh.write(b)
    return path


# ----------------------------------------------------------------------
# read
# ----------------------------------------------------------------------
def read_manifest(path: str | Path) -> dict:
    with open(path, "rb") as fh:
        magic = fh.read(len(MAGIC))
        if magic != MAGIC:
            raise ValueError(f"{path}: not a BlueNexus container (magic {magic!r})")
        (mlen,) = struct.unpack("<Q", fh.read(8))
        return json.loads(fh.read(mlen).decode("utf-8"))


def read_bluenexus(path: str | Path) -> BlueNexusDataset:
    path = Path(path)
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw[: len(MAGIC)] != MAGIC:
        raise ValueError(f"{path}: not a BlueNexus container")
    (mlen,) = struct.unpack("<Q", raw[len(MAGIC) : len(MAGIC) + 8])
    m_start = len(MAGIC) + 8
    manifest = json.loads(raw[m_start : m_start + mlen].decode("utf-8"))
    blob_base = m_start + mlen

    contract = manifest["contract"]
    idx = {e["key"]: e for e in manifest["arrays_index"]}

    # -- rebuild arrays ------------------------------------------------
    arrays: dict[str, BlueNexusArray] = {}
    for pid in contract["metadata"]["parameter_ids"]:
        ve = idx[f"{pid}.values"]
        qe = idx[f"{pid}.quality"]
        vbytes = raw[blob_base + ve["byte_offset"] : blob_base + ve["byte_offset"] + ve["byte_length"]]
        qbytes = raw[blob_base + qe["byte_offset"] : blob_base + qe["byte_offset"] + qe["byte_length"]]
        values = _from_le_f64(vbytes)
        quality = array.array("B")
        quality.frombytes(qbytes)
        shape = tuple(contract["parameters"][pid]["shape"])
        arrays[pid] = BlueNexusArray(pid, shape, values, quality)

    # -- rebuild the model from the contract -------------------------
    dims = tuple(
        BlueNexusDimension(d["name"], d["role"], d["size"], d["is_unlimited"])
        for d in contract["dimensions"]
    )
    coordinates: dict[str, BlueNexusCoordinate] = {}
    for role, c in contract["coordinates"].items():
        coordinates[role] = BlueNexusCoordinate(
            role=c["role"],
            name=c["name"],
            units=c["units"],
            calendar=c["calendar"],
            direction=c["direction"],
            ordering=c["ordering"],
            count=c["count"],
            values=tuple(c["values"]),
            regular_step=c["regular_step"],
            iso_times=tuple(c["iso_times"]) if c.get("iso_times") is not None else None,
            reference_epoch_iso=c.get("reference_epoch_iso"),
            timezone=c.get("timezone"),
            timezone_is_assumed=c.get("timezone_is_assumed", False),
        )
    parameters: dict[str, BlueNexusParameter] = {}
    for pid, p in contract["parameters"].items():
        parameters[pid] = BlueNexusParameter(
            parameter_id=p["parameter_id"],
            display_name=p["display_name"],
            display_aliases=tuple(p["display_aliases"]),
            source_variable=p["source_variable"],
            source_dataset=p["source_dataset"],
            units=p["units"],
            raw_units=p["raw_units"],
            units_source=p["units_source"],
            dimensions=tuple(p["dimensions"]),
            shape=tuple(p["shape"]),
            standard_name=p["standard_name"],
            long_name=p["long_name"],
            kind=p["kind"],
            vector_group=p["vector_group"],
            vector_role=p["vector_role"],
            authoritative=p["authoritative"],
            surface_only=p["surface_only"],
            valid_count=p["valid_count"],
            missing_count=p["missing_count"],
            valid_min=p["valid_min"],
            valid_max=p["valid_max"],
            notes=tuple(p["notes"]),
        )
    md = contract["metadata"]
    metadata = BlueNexusMetadata(
        dataset_id=md["dataset_id"],
        display_name=md["display_name"],
        parameter_ids=tuple(md["parameter_ids"]),
        product_type=md["product_type"],
        data_status=md["data_status"],
        temporal_semantics=md["temporal_semantics"],
        time_coverage=md["time_coverage"],
        depth_coverage=md["depth_coverage"],
        latitude_coverage=md["latitude_coverage"],
        longitude_coverage=md["longitude_coverage"],
        source=md["source"],
        quality_definition=md["quality_definition"],
        missing_value_definition=md["missing_value_definition"],
        vector_groups=md["vector_groups"],
        notes=tuple(md["notes"]),
    )
    pr = contract["provenance"]
    provenance = BlueNexusProvenance(
        source_name=pr["source_name"],
        source_url=pr["source_url"],
        source_dataset_id=pr["source_dataset_id"],
        source_file=pr["source_file"],
        source_file_sha256=pr["source_file_sha256"],
        source_file_bytes=pr["source_file_bytes"],
        source_file_format=pr["source_file_format"],
        conventions=pr["conventions"],
        pipeline_stages=tuple(pr["pipeline_stages"]),
        d8_processing_log=tuple(pr["d8_processing_log"]),
        original_units=pr["original_units"],
        canonical_units=pr["canonical_units"],
    )

    return BlueNexusDataset(
        schema_version=contract["schema_version"],
        dataset_id=contract["dataset_id"],
        product_type=contract["product_type"],
        title=contract["title"],
        dimensions=dims,
        coordinates=coordinates,
        parameters=parameters,
        metadata=metadata,
        provenance=provenance,
        arrays=arrays,
        generation=manifest.get("generation", {}),
    )


# ----------------------------------------------------------------------
# JSON projection (NOT an API -- a helper D10 can build an endpoint on)
# ----------------------------------------------------------------------
def parameter_slice(
    ds: BlueNexusDataset,
    parameter_id: str,
    *,
    time_index: int = 0,
    depth_index: int = 0,
) -> dict:
    """A single lat x lon slice of one parameter as JSON-safe nested lists.

    Missing cells are ``null`` (never 0 / -1 / -9999 / -1e34). This demonstrates
    the D9 contract for a JSON transport; it does not start a server.
    """
    p = ds.parameters[parameter_id]
    payload = ds.arrays[parameter_id]
    nt, nz, ny, nx = p.shape
    if not (0 <= time_index < nt):
        raise IndexError(f"time_index {time_index} out of range 0..{nt - 1}")
    if not (0 <= depth_index < nz):
        raise IndexError(f"depth_index {depth_index} out of range 0..{nz - 1}")

    lat = ds.coordinates["latitude"].values
    lon = ds.coordinates["longitude"].values
    base = ((time_index * nz) + depth_index) * ny * nx

    values: list[list[Optional[float]]] = []
    quality: list[list[int]] = []
    for j in range(ny):
        row_v: list[Optional[float]] = []
        row_q: list[int] = []
        row_base = base + j * nx
        for i in range(nx):
            q = payload.quality[row_base + i]
            row_q.append(q)
            row_v.append(JSON_MISSING if q == 1 else payload.values[row_base + i])
        values.append(row_v)
        quality.append(row_q)

    tcoord = ds.coordinates.get("time")
    dcoord = ds.coordinates.get("depth")
    return {
        "schema_version": ds.schema_version,
        "dataset_id": ds.dataset_id,
        "parameter": parameter_id,
        "units": p.units,
        "product_type": ds.product_type,
        "data_status": ds.metadata.data_status,
        "missing_value": JSON_MISSING,
        "quality_definition": dict(ds.metadata.quality_definition),
        "time": {
            "index": time_index,
            "value": tcoord.values[time_index] if tcoord else None,
            "iso": tcoord.iso_times[time_index] if tcoord and tcoord.iso_times else None,
            "units": tcoord.units if tcoord else None,
        },
        "depth": {
            "index": depth_index,
            "value": dcoord.values[depth_index] if dcoord else None,
            "units": dcoord.units if dcoord else None,
        },
        "latitude": list(lat),
        "longitude": list(lon),
        "values": values,
        "quality": quality,
    }


# ----------------------------------------------------------------------
# BnxReader -- partial reads for an efficient D10 slice endpoint
# ----------------------------------------------------------------------
#
# Added for D10: ``read_bluenexus()`` loads the *whole* container into memory
# (fine for a one-off conversion round-trip, ~27 MB for the currents bundle).
# An API that answers one lat x lon slice per request must NOT pay that cost
# every time. ``BnxReader`` opens the header + manifest once (a few KB), then
# ``slice()`` seeks straight to the requested (time, depth) plane and reads only
# ``ny * nx * (8 + 1)`` bytes -- ~16 KB for a 36x51 temperature plane, ~2.1 MB
# for a 421x601 current plane -- instead of the full file.
#
# The manifest layout it relies on (magic, 8-byte length, blob base, per-array
# byte_offset/byte_length, row-major [time][depth][lat][lon]) is exactly what
# ``write_bluenexus`` produces above; nothing about the D9 format changed.


class BnxReader:
    """Lightweight, reusable reader over one ``.bnx`` file.

    Holds only the parsed manifest (KB); ``slice()`` does bounded partial reads.
    ``last_bytes_read`` reports the payload bytes touched by the most recent
    ``slice()`` call (for D10 efficiency assertions).
    """

    __slots__ = ("path", "manifest", "_blob_base", "_index", "last_bytes_read")

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        with open(self.path, "rb") as fh:
            magic = fh.read(len(MAGIC))
            if magic != MAGIC:
                raise ValueError(f"{self.path}: not a BlueNexus container (magic {magic!r})")
            (mlen,) = struct.unpack("<Q", fh.read(8))
            self.manifest = json.loads(fh.read(mlen).decode("utf-8"))
        self._blob_base = len(MAGIC) + 8 + mlen
        self._index = {e["key"]: e for e in self.manifest["arrays_index"]}
        self.last_bytes_read = 0

    # -- cheap metadata (no bulk arrays) ------------------------------
    @property
    def contract(self) -> dict:
        return self.manifest["contract"]

    @property
    def dataset_id(self) -> str:
        return self.contract["dataset_id"]

    @property
    def generation(self) -> dict:
        return self.manifest.get("generation", {})

    def parameter_ids(self) -> list[str]:
        return list(self.contract["metadata"]["parameter_ids"])

    def shape(self, parameter_id: str) -> tuple[int, int, int, int]:
        return tuple(self.contract["parameters"][parameter_id]["shape"])  # type: ignore[return-value]

    # -- the partial read ------------------------------------------
    def slice(
        self, parameter_id: str, *, time_index: int = 0, depth_index: int = 0
    ) -> dict:
        params = self.contract["parameters"]
        if parameter_id not in params:
            raise KeyError(parameter_id)
        nt, nz, ny, nx = self.shape(parameter_id)
        if not isinstance(time_index, int) or not (0 <= time_index < nt):
            raise IndexError(f"time_index {time_index!r} out of range 0..{nt - 1}")
        if not isinstance(depth_index, int) or not (0 <= depth_index < nz):
            raise IndexError(f"depth_index {depth_index!r} out of range 0..{nz - 1}")

        plane = ny * nx
        base = ((time_index * nz) + depth_index) * plane
        ve = self._index[f"{parameter_id}.values"]
        qe = self._index[f"{parameter_id}.quality"]

        with open(self.path, "rb") as fh:
            fh.seek(self._blob_base + ve["byte_offset"] + base * 8)
            vbytes = fh.read(plane * 8)
            fh.seek(self._blob_base + qe["byte_offset"] + base * 1)
            qbytes = fh.read(plane)
        self.last_bytes_read = len(vbytes) + len(qbytes)

        vals = array.array("d")
        vals.frombytes(vbytes)
        if sys.byteorder == "big":
            vals.byteswap()
        quality = array.array("B")
        quality.frombytes(qbytes)

        import math as _math

        values: list[list[Optional[float]]] = []
        qgrid: list[list[int]] = []
        for j in range(ny):
            row_v: list[Optional[float]] = []
            row_q: list[int] = []
            off = j * nx
            for i in range(nx):
                q = quality[off + i]
                v = vals[off + i]
                missing = q == 1 or (isinstance(v, float) and _math.isnan(v))
                row_q.append(1 if missing else 0)
                row_v.append(JSON_MISSING if missing else v)
            values.append(row_v)
            qgrid.append(row_q)

        coords = self.contract["coordinates"]
        p = params[parameter_id]
        tc = coords.get("time")
        dc = coords.get("depth")
        return {
            "schema_version": self.contract["schema_version"],
            "dataset_id": self.dataset_id,
            "parameter": parameter_id,
            "units": p["units"],
            "product_type": self.contract["product_type"],
            "data_status": self.contract["metadata"]["data_status"],
            "missing_value": JSON_MISSING,
            "quality_definition": dict(self.contract["metadata"]["quality_definition"]),
            "time": {
                "index": time_index,
                "value": tc["values"][time_index] if tc else None,
                "iso": (tc.get("iso_times") or [None] * (time_index + 1))[time_index] if tc else None,
                "units": tc["units"] if tc else None,
            },
            "depth": {
                "index": depth_index,
                "value": dc["values"][depth_index] if dc else None,
                "units": dc["units"] if dc else None,
            },
            "latitude": list(coords["latitude"]["values"]),
            "longitude": list(coords["longitude"]["values"]),
            "values": values,
            "quality": qgrid,
        }
