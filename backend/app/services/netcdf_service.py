"""Step 39 -- NetCDF-backed scientific data service (feeds ``/api/netcdf``).

    NetCDF file
        -> app.data.scientific.open_netcdf        (Step 38 ingestion)
        -> ScientificDataset / ScientificVariable  (Step 37 abstraction)
        -> NetCDFDataService                       (this module)
        -> FastAPI route                           (app.api.routes.netcdf)
        -> JSON response

Additive and completely separate from :class:`app.services.catalog.BlueNexusCatalog`
and the ``.bnx`` pipeline -- it does not touch, replace or migrate any existing
dataset. One configured NetCDF file (``ApiConfig.netcdf_path`` /
``BLUENEXUS_NETCDF_PATH``) is opened **once** at startup and read fully into
memory (the project's sample files are small), so no NetCDF file handle is held
open for the process lifetime and no file is reopened per request.

By default scientific values are never transformed: no ``scale_factor`` /
``add_offset``, no interpolation, smoothing, regridding, normalization, unit
conversion or rounding. The only boundary conversion is that non-finite floats
(IEEE ``NaN`` / ``Inf``) become JSON ``null`` when a response is built.

**Step 42 -- CF decoding.** Some real model files store a variable packed as a
small integer with ``scale_factor`` / ``add_offset`` and an integer
``_FillValue`` (the GLORYS12V1 ``thetao`` field is packed ``int16``). Exposing
those raw integers as if they were the variable's units would be wrong, so the
service can be constructed with ``cf_decode=True`` (driven by
``ApiConfig.netcdf_cf_decode`` / ``BLUENEXUS_NETCDF_CF_DECODE``): the file is
then opened with xarray ``mask_and_scale=True`` and the values it yields are the
real, CF-decoded physical values (e.g. ``degrees_C``), with the integer fill
turned into ``NaN`` -> JSON ``null``. **The raw file on disk is never modified**
-- decoding happens entirely in memory. Every payload carries a ``decoding``
block stating exactly what was (or was not) applied, and ``dataset``/``variable``
payloads never round or unit-convert the decoded values.
"""

from __future__ import annotations

import math
import re
import threading
from pathlib import Path
from typing import Any, Optional

import numpy as np

from ..api.errors import (
    InvalidIndexError,
    NetCDFNotConfiguredError,
    NetCDFUnavailableError,
    SliceTooLargeError,
    UnknownVariableError,
)
from ..data.scientific import ScientificDataset, ScientificVariable, open_netcdf

#: Hard cap on the number of scientific values one ``/slice`` response may carry.
#: Consistent with the existing bounded ``.bnx`` slice endpoint (one lat x lon
#: plane). A larger selection is a ``422 slice_too_large`` -- add more indices.
MAX_SLICE_ELEMENTS = 300_000

#: How missing / non-finite floats are represented in JSON responses. Documented
#: on every payload so the contract is explicit at the serialization boundary.
NAN_ENCODING = (
    "Scientific values are verbatim from the NetCDF file. Non-finite floats "
    "(NaN / Infinity, which JSON cannot represent) are serialized as null; the "
    "underlying xarray/NetCDF data is not modified. Finite values are never "
    "rounded, scaled or unit-converted."
)

#: Same, when the file is opened with CF mask-and-scale decoding (Step 42).
NAN_ENCODING_DECODED = (
    "Scientific values are the CF-decoded physical values from the NetCDF file "
    "(scale_factor / add_offset applied, integer _FillValue -> NaN). Decoding "
    "happens in memory only; the raw file on disk is unchanged. Non-finite "
    "floats are serialized as null. Decoded values are never rounded, "
    "re-scaled or unit-converted -- see the `decoding` block for what was "
    "applied."
)

#: Encoding keys that describe CF packing -- the only ones surfaced in a
#: `decoding` block. `source` / `original_shape` etc. are deliberately excluded
#: (they can carry a filesystem path).
_DECODE_ENCODING_KEYS = ("dtype", "scale_factor", "add_offset", "_FillValue", "missing_value")

_VAR_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,127}$")

_TIME_RE = re.compile(r"(^t$|^time|_time$|time$|taxis|^tax$|^t_|julian)", re.I)
_DEPTH_RE = re.compile(r"(depth|^dep|zax|^z$|^z_|_z$|^lev|lev$|zlev|sigma|pres)", re.I)
_LAT_RE = re.compile(r"(lat|^y$|yaxis|northing)", re.I)
_LON_RE = re.compile(r"(lon|^x$|xaxis|easting)", re.I)

_ROLE_UNITS = {
    "latitude": {"degrees_north", "degree_north", "degrees_n", "degreen"},
    "longitude": {"degrees_east", "degree_east", "degrees_e", "degreee"},
}


# ---------------------------------------------------------------------------
# JSON-safety helpers -- the ONLY value transformation, and only at this edge.
# ---------------------------------------------------------------------------
def _iso(value: Any) -> Optional[str]:
    try:
        s = np.datetime_as_string(np.datetime64(value), unit="s", timezone="UTC")
    except Exception:
        return None
    return None if s == "NaT" else str(s)


def _parse_iso_utc(value: Any) -> str:
    """An ISO-8601 string numpy's ``datetime64`` accepts (drops the ``Z`` /
    ``+00:00`` suffix; all project timestamps are UTC). Non-strings pass
    through unchanged for numpy to handle."""
    if not isinstance(value, str):
        return value
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1]
    if v.endswith("+00:00"):
        v = v[:-6]
    return v


def _json_safe(obj: Any) -> Any:
    """Recursively coerce ``obj`` to JSON-serializable types.

    Non-finite floats -> ``None``. numpy scalars/arrays -> Python builtins.
    ``datetime64`` -> ISO-8601 UTC string. Bytes -> UTF-8 text. Used for
    metadata / attributes / coordinate axes (all small).
    """
    if obj is None or isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, int):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (bytes, bytearray)):
        return bytes(obj).decode("utf-8", "replace")
    if isinstance(obj, np.datetime64):
        return _iso(obj)
    if isinstance(obj, np.generic):
        if isinstance(obj, np.floating):
            v = float(obj)
            return v if math.isfinite(v) else None
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        return _json_safe(obj.item())
    if isinstance(obj, np.ndarray):
        if obj.dtype.kind == "M":
            return np.datetime_as_string(obj, unit="s", timezone="UTC").tolist()
        return _json_safe(obj.tolist())
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_json_safe(v) for v in obj]
    return str(obj)


def _values_to_json(array: np.ndarray) -> Any:
    """Scientific-value array -> nested lists / scalar, NaN/Inf -> ``None``.

    Finite values pass through unchanged (float64 exact; float32 widened to its
    exact double, never rounded).
    """
    array = np.asarray(array)
    if array.ndim == 0:
        item = array.item()
        if isinstance(item, float) and not math.isfinite(item):
            return None
        if isinstance(item, np.datetime64) or array.dtype.kind == "M":
            return _iso(array)
        return item
    if array.dtype.kind == "M":
        return np.datetime_as_string(array, unit="s", timezone="UTC").tolist()
    if array.dtype.kind in "fc":
        boxed = array.astype(object)
        boxed[~np.isfinite(array)] = None
        return boxed.tolist()
    return array.tolist()


# ---------------------------------------------------------------------------
# Axis-role resolution -- generic, CF-first, name-fallback.
# ---------------------------------------------------------------------------
def _role_for_dimension(dim: str, coord: Optional[ScientificVariable]) -> Optional[str]:
    """Best-effort ``time`` / ``depth`` / ``latitude`` / ``longitude`` role for a
    dimension, from its coordinate's CF attributes, then its name."""
    attrs = coord.attributes if coord is not None else {}
    axis = str(attrs.get("axis", "")).strip().upper()
    std = str(attrs.get("standard_name", "")).strip().lower()
    units = str(attrs.get("units", "")).strip().lower()
    dtype = coord.dtype if coord is not None else ""
    positive = "positive" in attrs

    if axis == "T" or std == "time" or dtype.startswith("datetime64") or "since" in units:
        return "time"
    if axis == "Z" or std in {"depth", "sea_water_pressure", "altitude", "model_level_number"} or positive:
        return "depth"
    if axis == "Y" or std == "latitude" or units in _ROLE_UNITS["latitude"]:
        return "latitude"
    if axis == "X" or std == "longitude" or units in _ROLE_UNITS["longitude"]:
        return "longitude"

    if _TIME_RE.search(dim):
        return "time"
    if _LAT_RE.search(dim):
        return "latitude"
    if _LON_RE.search(dim):
        return "longitude"
    if _DEPTH_RE.search(dim):
        return "depth"
    return None


class NetCDFDataService:
    """Opens the configured NetCDF file once and answers metadata / slice queries."""

    def __init__(
        self,
        path: Optional[Path],
        dataset_id: str,
        *,
        cf_decode: bool = False,
        source_label: Optional[str] = None,
    ) -> None:
        self._path = Path(path) if path is not None else None
        self._dataset_id = dataset_id or "netcdf_dataset"
        #: Step 42: open with xarray ``mask_and_scale=True`` (CF decode) when set.
        self._cf_decode = bool(cf_decode)
        #: Step 42: explicit human-readable model identity, or ``None``.
        self._source_label = source_label
        self._lock = threading.Lock()
        self._sci: Optional[ScientificDataset] = None
        self._state: str = "not_configured"   # not_configured | unavailable | ready
        self._reason: Optional[str] = None

    @property
    def cf_decode(self) -> bool:
        return self._cf_decode

    # -- lifecycle ---------------------------------------------------
    def load(self) -> None:
        with self._lock:
            self._close_locked()
            self._sci = None
            self._reason = None

            if self._path is None:
                self._state = "not_configured"
                return
            if not self._path.is_file():
                self._state = "unavailable"
                self._reason = "configured NetCDF file was not found"
                return
            try:
                # Step 38: read fully into memory and release the OS file handle
                # immediately (load=True). Step 42: ``mask_and_scale`` follows the
                # configured CF-decode flag -- lossless by default, CF-decoded for
                # a packed model file such as GLORYS ``thetao``.
                self._sci = open_netcdf(
                    self._path, load=True, mask_and_scale=self._cf_decode
                )
                self._state = "ready"
            except Exception as exc:  # unreadable / not a NetCDF / engine error
                self._state = "unavailable"
                self._reason = f"could not open NetCDF file ({type(exc).__name__})"

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._sci is not None:
            try:
                self._sci.dataset.close()
            except Exception:
                pass

    # -- readiness -------------------------------------------------
    @property
    def state(self) -> str:
        return self._state

    @property
    def dataset_id(self) -> str:
        return self._dataset_id

    @property
    def source_label(self) -> Optional[str]:
        return self._source_label

    @property
    def file_name(self) -> Optional[str]:
        return self._path.name if self._path else None

    def _require_ready(self) -> ScientificDataset:
        if self._state == "not_configured":
            raise NetCDFNotConfiguredError(
                "no NetCDF dataset is configured for this API",
                {"hint": "set BLUENEXUS_NETCDF_PATH to a NetCDF file and restart"},
            )
        if self._state != "ready" or self._sci is None:
            raise NetCDFUnavailableError(
                "the configured NetCDF dataset is not available",
                {"reason": self._reason or "unknown"},
            )
        return self._sci

    # -- coordinate / axis helpers -------------------------------
    def _coord(self, sci: ScientificDataset, name: str) -> Optional[ScientificVariable]:
        try:
            return sci.coordinate(name)
        except KeyError:
            return None

    def _axis_roles(self, sci: ScientificDataset, dims: tuple[str, ...]) -> dict[str, str]:
        roles: dict[str, str] = {}
        for dim in dims:
            role = _role_for_dimension(dim, self._coord(sci, dim))
            if role is not None:
                roles[dim] = role
        return roles

    def _coord_axis_payload(self, coord: ScientificVariable, role: Optional[str]) -> dict:
        values = coord.values()
        return {
            "name": coord.name,
            "role": role,
            "dimensions": list(coord.dimensions),
            "size": int(values.size),
            "dtype": str(coord.dtype),
            "units": coord.units,
            "attributes": _json_safe(coord.attributes),
            "values": _values_to_json(values),
        }

    @property
    def _nan_encoding(self) -> str:
        return NAN_ENCODING_DECODED if self._cf_decode else NAN_ENCODING

    # -- Step 42: CF-decoding transparency --------------------------
    def _variable_decoding(self, var: ScientificVariable) -> dict:
        """What CF decoding was (or was not) applied to ``var``'s values.

        Reports the CF packing parameters (``scale_factor`` / ``add_offset`` /
        ``_FillValue`` / raw dtype) so a client can see whether the served
        values are real physical units (e.g. ``degrees_C``) or packed integers.
        """
        enc = dict(getattr(var.data_array, "encoding", {}) or {})
        attrs = var.attributes
        # CF packing parameters live in `encoding` after mask_and_scale=True and
        # in `attrs` when the file is opened verbatim -- check both.
        source = {**{k: attrs[k] for k in _DECODE_ENCODING_KEYS if k in attrs}, **{
            k: enc[k] for k in _DECODE_ENCODING_KEYS if k in enc
        }}
        packing = {k: _json_safe(v) for k, v in source.items()}
        is_packed = "scale_factor" in source or "add_offset" in source
        raw_dtype = str(source["dtype"]) if source.get("dtype") is not None else (
            str(var.dtype) if (is_packed and not self._cf_decode) else None
        )
        if self._cf_decode:
            applied = [k for k in ("scale_factor", "add_offset") if k in source]
            if "_FillValue" in source or "missing_value" in source:
                applied.append("_FillValue")
            note = (
                "CF mask-and-scale decoding is ON. "
                + (
                    f"The source stores this variable packed as {raw_dtype}; "
                    f"{' / '.join(applied)} were applied in memory to yield real "
                    f"{var.units or 'physical'} values. "
                    if is_packed
                    else "This variable is not packed in the source. "
                )
                + "The raw file on disk is unchanged. Any valid_min / valid_max "
                "in `attributes` are in the source's packed units."
            )
        else:
            applied = []
            note = (
                "CF mask-and-scale decoding is OFF -- values are verbatim from "
                "the file, no scale_factor / add_offset / _FillValue applied."
                + (
                    f" NOTE: this variable IS packed as {raw_dtype} in the "
                    "source (scale_factor / add_offset present); the verbatim "
                    "values are the packed integers, not physical units."
                    if is_packed
                    else ""
                )
            )
        return {
            "cf_mask_and_scale": self._cf_decode,
            "source_packed": is_packed,
            "raw_dtype": raw_dtype,
            "decoded_dtype": str(var.dtype),
            "applied": applied,
            "packing": packing,
            "note": note,
        }

    def _dataset_decoding(self) -> dict:
        return {
            "cf_mask_and_scale": self._cf_decode,
            "note": (
                "Variables were opened with xarray mask_and_scale=True: "
                "scale_factor / add_offset / integer _FillValue are decoded in "
                "memory to real physical values. The raw NetCDF file is "
                "unchanged. See each variable's `decoding` block for detail."
            )
            if self._cf_decode
            else (
                "Variables are served verbatim (xarray mask_and_scale=False): "
                "no scale_factor / add_offset / _FillValue decoding."
            ),
        }

    # -- Step 42: coverage of the configured sample ----------------
    def _coverage_payload(self, sci: ScientificDataset) -> dict:
        """A plain-language summary of *what extent this file actually covers*.

        Derived only from the real coordinate vectors, so the API never implies
        basin-wide coverage when the configured file is a small subset. Axes
        with no resolvable role (or no coordinate) are simply omitted.
        """
        roles: dict[str, str] = {}
        for name in sci.dimension_coordinate_names():
            role = _role_for_dimension(name, self._coord(sci, name))
            if role is not None and role not in roles:
                roles[role] = name

        coverage: dict[str, Any] = {}
        for role, dim in roles.items():
            coord = self._coord(sci, dim)
            if coord is None:
                continue
            values = np.asarray(coord.values())
            if values.size == 0:
                continue
            if role == "time" or values.dtype.kind == "M":
                lo, hi = np.min(values), np.max(values)
                coverage["time"] = {
                    "start": _iso(lo),
                    "end": _iso(hi),
                    "count": int(values.size),
                }
            else:
                finite = values[np.isfinite(values)] if values.dtype.kind in "fc" else values
                if finite.size == 0:
                    continue
                entry = {
                    "min": _json_safe(float(np.min(finite))),
                    "max": _json_safe(float(np.max(finite))),
                    "count": int(values.size),
                    "units": coord.units,
                }
                if role == "depth":
                    entry["positive"] = coord.attributes.get("positive")
                coverage[role] = entry

        if "latitude" in coverage and "longitude" in coverage:
            coverage["bounding_box"] = {
                "latitude": [coverage["latitude"]["min"], coverage["latitude"]["max"]],
                "longitude": [coverage["longitude"]["min"], coverage["longitude"]["max"]],
            }
        coverage["note"] = (
            "This is the full extent of the configured NetCDF sample -- it is "
            "not basin-wide coverage. Requests outside this box / time / depth "
            "range have no model data."
        )
        return coverage

    # -- endpoint payloads --------------------------------------
    def dataset_info(self) -> dict:
        sci = self._require_ready()
        coords = []
        for name in sci.coordinate_names():
            coord = sci.coordinate(name)
            role = _role_for_dimension(name, coord) if name in sci.dimension_names() else None
            coords.append(self._coord_axis_payload(coord, role))
        return {
            "dataset_id": self._dataset_id,
            "source": {
                "file_name": self._path.name if self._path else None,
                "engine": "netcdf4",
                "read_mode": "in-memory (opened once at startup, no handle held)",
                # Step 42: explicit model identity, verbatim from config. Never
                # "INCOIS model" / "INCOIS-GODAS".
                "label": self._source_label,
            },
            "dimensions": sci.dimensions(),
            "coordinates": coords,
            "variables": list(sci.variable_names()),
            "variable_count": len(sci.variable_names()),
            "global_attributes": _json_safe(sci.attributes),
            "coverage": self._coverage_payload(sci),
            "decoding": self._dataset_decoding(),
            "nan_encoding": self._nan_encoding,
        }

    def coverage(self) -> dict:
        """The configured file's real extent (from its coordinate vectors).

        Same block as ``dataset_info()["coverage"]`` -- exposed on its own so a
        caller (Step 43 model-at-observation extraction) can validate whether an
        observation falls inside the model's space / time before extracting.
        """
        return self._coverage_payload(self._require_ready())

    def nearest_profile(
        self,
        variable: str,
        *,
        latitude: float,
        longitude: float,
        time: Optional[Any] = None,
    ) -> dict:
        """The full-depth column of ``variable`` at the **nearest native**
        (latitude, longitude, time) grid cell.

        Nearest-neighbour only -- this delegates to xarray ``.sel(method=
        "nearest")``, which *snaps to existing grid coordinates*. It never
        interpolates, regrids or resamples. The depth axis is returned at its
        full native extent (no vertical selection). Decoded values follow the
        service's ``cf_decode`` setting; non-finite -> ``None``.

        Returns ``requested`` vs ``matched`` coordinates so the caller can
        report the exact spatial / temporal mismatch.
        """
        sci = self._require_ready()
        var = self._variable(sci, variable)  # reuses UnknownVariableError (404)
        roles = self._axis_roles(sci, var.dimensions)
        dim_by_role = {role: dim for dim, role in roles.items()}

        for required in ("latitude", "longitude", "depth"):
            if required not in dim_by_role:
                raise UnknownVariableError(
                    f"variable {variable!r} has no {required} axis -- cannot "
                    "extract a vertical profile at a point",
                    {"variable": variable, "axis_roles": roles},
                )

        da = var.data_array
        lat_dim = dim_by_role["latitude"]
        lon_dim = dim_by_role["longitude"]
        depth_dim = dim_by_role["depth"]
        time_dim = dim_by_role.get("time")

        selectors: dict[str, Any] = {
            lat_dim: float(latitude),
            lon_dim: float(longitude),
        }
        requested_time_iso: Optional[str] = None
        if time is not None and time_dim is not None:
            target = np.datetime64(_parse_iso_utc(time))
            selectors[time_dim] = target
            requested_time_iso = _iso(target)

        picked = da.sel(selectors, method="nearest")

        matched_lat = float(np.asarray(picked[lat_dim].values))
        matched_lon = float(np.asarray(picked[lon_dim].values))
        matched_time_iso: Optional[str] = None
        if time_dim is not None and time_dim in picked.coords:
            matched_time_iso = _iso(picked[time_dim].values)

        depth_coord = self._coord(sci, depth_dim)
        depth_values = (
            _values_to_json(np.asarray(picked[depth_dim].values))
            if depth_dim in picked.coords
            else None
        )
        column = _values_to_json(np.asarray(picked.values))
        finite = int(np.isfinite(np.asarray(picked.values, dtype="float64")).sum())

        return {
            "variable": variable,
            "units": var.units,
            "standard_name": var.attributes.get("standard_name"),
            "dtype": str(picked.dtype),
            "requested": {
                "latitude": float(latitude),
                "longitude": float(longitude),
                "time": requested_time_iso,
            },
            "matched": {
                "latitude": matched_lat,
                "longitude": matched_lon,
                "time": matched_time_iso,
            },
            "depth": depth_values,
            "depth_units": depth_coord.units if depth_coord is not None else None,
            "depth_positive": (
                depth_coord.attributes.get("positive") if depth_coord is not None else None
            ),
            "level_count": len(column) if isinstance(column, list) else 1,
            "finite_level_count": finite,
            "values": column,
            "decoding": self._variable_decoding(var),
            "nan_encoding": self._nan_encoding,
        }

    def _variable(self, sci: ScientificDataset, name: str) -> ScientificVariable:
        if not isinstance(name, str) or not _VAR_NAME_RE.match(name):
            raise UnknownVariableError(
                f"unknown variable {name!r}",
                {"available_variables": list(sci.variable_names())},
            )
        if not sci.has_variable(name):
            raise UnknownVariableError(
                f"unknown variable {name!r}",
                {"available_variables": list(sci.variable_names())},
            )
        return sci.variable(name)

    def variable_info(self, name: str) -> dict:
        sci = self._require_ready()
        var = self._variable(sci, name)
        return {
            "dataset_id": self._dataset_id,
            "name": name,
            "dimensions": list(var.dimensions),
            "shape": list(var.shape),
            "dtype": str(var.dtype),
            "units": var.units,
            "attributes": _json_safe(var.attributes),
            "axis_roles": self._axis_roles(sci, var.dimensions),
            "decoding": self._variable_decoding(var),
            "nan_encoding": self._nan_encoding,
        }

    def slice(
        self,
        name: str,
        *,
        time_index: Optional[int] = None,
        depth_index: Optional[int] = None,
        latitude_index: Optional[int] = None,
        longitude_index: Optional[int] = None,
    ) -> dict:
        sci = self._require_ready()
        var = self._variable(sci, name)

        roles = self._axis_roles(sci, var.dimensions)
        dim_by_role = {role: dim for dim, role in roles.items()}
        requested = {
            "time": time_index,
            "depth": depth_index,
            "latitude": latitude_index,
            "longitude": longitude_index,
        }

        isel: dict[str, int] = {}
        selection: list[dict] = []
        for role, idx in requested.items():
            if idx is None:
                continue
            dim = dim_by_role.get(role)
            if dim is None:
                raise InvalidIndexError(
                    f"variable {name!r} has no {role} axis",
                    {
                        "variable": name,
                        "dimensions": list(var.dimensions),
                        "axis_roles": roles,
                    },
                )
            size = var.sizes[dim]
            if not (0 <= idx < size):
                raise InvalidIndexError(
                    f"{role}_index {idx} out of range for axis {dim!r}",
                    {"variable": name, "axis": dim, "valid_range": [0, size - 1]},
                )
            isel[dim] = idx

        # coordinate value at each selected index (from the original dataset)
        for role, idx in requested.items():
            if idx is None:
                continue
            dim = dim_by_role[role]
            coord = self._coord(sci, dim)
            value: Any = None
            iso: Optional[str] = None
            if coord is not None:
                raw = coord.isel({dim: idx}).values()
                if raw.dtype.kind == "M":
                    iso = _iso(raw)
                    value = iso
                else:
                    value = _values_to_json(raw)
            selection.append(
                {"role": role, "dimension": dim, "index": idx, "value": value, "iso": iso}
            )

        selected = var.isel(isel) if isel else var

        element_count = int(np.prod(selected.shape)) if selected.shape else 1
        if element_count > MAX_SLICE_ELEMENTS:
            raise SliceTooLargeError(
                "the requested selection is too large to return in one response",
                {
                    "variable": name,
                    "element_count": element_count,
                    "max_elements": MAX_SLICE_ELEMENTS,
                    "hint": "provide more of time_index / depth_index / "
                    "latitude_index / longitude_index",
                    "unselected_axes": [
                        d for d in selected.dimensions
                    ],
                },
            )

        remaining_coords: dict[str, Any] = {}
        for dim in selected.dimensions:
            coord = self._coord(sci, dim)
            if coord is None:
                continue
            axis_coord = coord.isel({dim: isel[dim]}) if dim in isel else coord
            remaining_coords[dim] = _values_to_json(axis_coord.values())

        return {
            "dataset_id": self._dataset_id,
            "variable": name,
            "units": var.units,
            "dtype": str(selected.dtype),
            "selection": selection,
            "dimensions": list(selected.dimensions),
            "shape": list(selected.shape),
            "element_count": element_count,
            "coordinates": remaining_coords,
            "values": _values_to_json(selected.values()),
            "missing_value": None,
            "decoding": self._variable_decoding(var),
            "variable_metadata": {
                "name": name,
                "dimensions": list(var.dimensions),
                "shape": list(var.shape),
                "dtype": str(var.dtype),
                "units": var.units,
                "attributes": _json_safe(var.attributes),
                "axis_roles": roles,
            },
            "nan_encoding": self._nan_encoding,
        }


# -- app wiring -------------------------------------------------------------
# Unlike the older catalog singleton, the NetCDF service is stored on
# ``app.state`` (see ``app.api.app`` and ``app.api.routes.netcdf``) so that
# multiple app instances in one process (the test suite spins up several) never
# share or clobber each other's state.
def build_netcdf_service(config) -> NetCDFDataService:
    """Construct and load the service for one app instance."""
    service = NetCDFDataService(
        config.netcdf_path,
        config.netcdf_dataset_id,
        cf_decode=getattr(config, "netcdf_cf_decode", False),
        source_label=getattr(config, "netcdf_source_label", None),
    )
    service.load()
    return service
