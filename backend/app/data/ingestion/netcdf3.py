"""Minimal, dependency-free reader for **NetCDF-3 classic** files (``CDF\\x01`` /
``CDF\\x02``).

Why a hand-rolled reader instead of ``netCDF4`` / ``xarray`` / ``scipy``?

* Every real INCOIS file acquired in D4 is NetCDF-3 classic -- confirmed by the
  file magic (``CDF\\x01``) in D5, and both INCOIS services (ERDDAP griddap and
  the THREDDS NetCDF Subset Service) return classic NetCDF-3 by default.
* The backend virtual-env (Python 3.14) has none of those libraries, and
  ``netCDF4`` needs the HDF5 / netcdf-c C toolchain plus wheels that do not yet
  exist for 3.14. Pulling in that stack for a format this simple is not worth
  it at D7.
* The NetCDF-3 classic format is small and fully specified
  (https://docs.unidata.ucar.edu/nug/current/file_format_specifications.html).

Scope / limitations (documented on purpose):

* Reads **NetCDF-3 classic** only (32-bit and 64-bit offset, versions 1 and 2).
  It raises :class:`UnsupportedNetCDFError` for NetCDF-4 / HDF5 (``\\x89HDF``).
  If INCOIS ever serves HDF5-backed NetCDF-4, swap in a real library *then*.
* Read-only. Nothing in this module opens a file for writing.
* All multi-byte numbers in the format are big-endian; values are returned in a
  native-endian :class:`array.array` for convenient downstream use.

The reader returns raw values exactly as stored -- no scaling, no masking,
no unit handling. That is the ingestor's job (and cleaning is D8's).
"""

from __future__ import annotations

import array
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

# ---------------------------------------------------------------------------
# NetCDF-3 constants
# ---------------------------------------------------------------------------
_NC_BYTE, _NC_CHAR, _NC_SHORT, _NC_INT, _NC_FLOAT, _NC_DOUBLE = 1, 2, 3, 4, 5, 6

_TAG_DIMENSION = 0x0A
_TAG_VARIABLE = 0x0B
_TAG_ATTRIBUTE = 0x0C

_TYPE_NAME = {
    _NC_BYTE: "int8",
    _NC_CHAR: "char",
    _NC_SHORT: "int16",
    _NC_INT: "int32",
    _NC_FLOAT: "float32",
    _NC_DOUBLE: "float64",
}
_TYPE_SIZE = {_NC_BYTE: 1, _NC_CHAR: 1, _NC_SHORT: 2, _NC_INT: 4, _NC_FLOAT: 4, _NC_DOUBLE: 8}
_STRUCT_CHAR = {_NC_BYTE: "b", _NC_SHORT: "h", _NC_INT: "i", _NC_FLOAT: "f", _NC_DOUBLE: "d"}
_ARRAY_CHAR = {_NC_BYTE: "b", _NC_SHORT: "h", _NC_INT: "i", _NC_FLOAT: "f", _NC_DOUBLE: "d"}


class NetCDFError(Exception):
    """Base class for problems reading a NetCDF-3 file."""


class UnsupportedNetCDFError(NetCDFError):
    """The file is not NetCDF-3 classic (e.g. NetCDF-4 / HDF5)."""


@dataclass(frozen=True)
class NC3Dimension:
    name: str
    size: int          # effective length (record dim resolved via numrecs)
    is_unlimited: bool


@dataclass(frozen=True)
class NC3Variable:
    name: str
    dimensions: tuple[str, ...]      # logical order, as declared in the file
    nc_type: int
    dtype: str                       # human name: "float32", ...
    attributes: Mapping[str, object]
    shape: tuple[int, ...]
    is_record: bool
    _begin: int = field(repr=False)
    _vsize: int = field(repr=False)


class _Cursor:
    __slots__ = ("d", "p")

    def __init__(self, data: bytes) -> None:
        self.d = data
        self.p = 0

    def u32(self) -> int:
        v = struct.unpack_from(">I", self.d, self.p)[0]
        self.p += 4
        return v

    def u64(self) -> int:
        v = struct.unpack_from(">Q", self.d, self.p)[0]
        self.p += 8
        return v

    def take(self, n: int) -> bytes:
        v = self.d[self.p : self.p + n]
        self.p += n
        return v

    def pad4(self) -> None:
        while self.p % 4:
            self.p += 1

    def name(self) -> str:
        n = self.u32()
        s = self.take(n).decode("utf-8", "replace")
        self.pad4()
        return s

    def attributes(self) -> dict[str, object]:
        tag = self.u32()
        count = self.u32()
        out: dict[str, object] = {}
        if tag == 0 and count == 0:
            return out
        if tag != _TAG_ATTRIBUTE:
            raise NetCDFError(f"expected attribute list, got tag {tag:#x}")
        for _ in range(count):
            key = self.name()
            nc_type = self.u32()
            n = self.u32()
            if nc_type == _NC_CHAR:
                val: object = self.take(n).decode("utf-8", "replace")
            else:
                sc = _STRUCT_CHAR[nc_type]
                sz = _TYPE_SIZE[nc_type]
                vals = list(struct.unpack_from(f">{n}{sc}", self.d, self.p))
                self.p += n * sz
                val = vals[0] if len(vals) == 1 else vals
            self.pad4()
            out[key] = val
        return out


class NetCDF3File:
    """Parsed header + lazy value reader for one NetCDF-3 classic file.

    Use as a context manager::

        with NetCDF3File(path) as nc:
            nc.dimensions            # tuple[NC3Dimension, ...]
            nc.global_attributes     # dict
            nc.variables             # dict[str, NC3Variable]
            nc.read_values("time")   # array.array (native endian) or str for char vars
    """

    MAGIC_CLASSIC = (b"CDF\x01", b"CDF\x02")
    MAGIC_HDF5 = b"\x89HDF"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._data: bytes = b""
        self.version: int = 0
        self.numrecs: int = 0
        self.record_bytes: int = 0
        self.dimensions: tuple[NC3Dimension, ...] = ()
        self.global_attributes: dict[str, object] = {}
        self.variables: dict[str, NC3Variable] = {}

    # -- lifecycle ----------------------------------------------------------
    def __enter__(self) -> "NetCDF3File":
        self.open()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def open(self) -> "NetCDF3File":
        with open(self.path, "rb") as fh:          # read-only, always
            self._data = fh.read()
        self._parse_header()
        return self

    def close(self) -> None:
        self._data = b""

    # -- parsing ----------------------------------------------------------
    def _parse_header(self) -> None:
        d = self._data
        if len(d) < 4:
            raise NetCDFError(f"{self.path.name}: file too small to be NetCDF")
        magic = d[:4]
        if magic.startswith(self.MAGIC_HDF5):
            raise UnsupportedNetCDFError(
                f"{self.path.name}: NetCDF-4 / HDF5 file -- this reader only "
                "handles NetCDF-3 classic"
            )
        if magic not in self.MAGIC_CLASSIC:
            raise UnsupportedNetCDFError(
                f"{self.path.name}: not a NetCDF-3 classic file (magic {magic!r})"
            )
        self.version = magic[3]
        c = _Cursor(d)
        c.p = 4
        self.numrecs = c.u32()

        # dimension list
        raw_dims: list[tuple[str, int]] = []
        tag = c.u32()
        ndims = c.u32()
        if not (tag == 0 and ndims == 0):
            if tag != _TAG_DIMENSION:
                raise NetCDFError("expected dimension list")
            for _ in range(ndims):
                nm = c.name()
                length = c.u32()
                raw_dims.append((nm, length))
        self.dimensions = tuple(
            NC3Dimension(
                name=nm,
                size=self.numrecs if length == 0 else length,
                is_unlimited=(length == 0),
            )
            for nm, length in raw_dims
        )
        dim_by_index = self.dimensions

        # global attributes
        self.global_attributes = c.attributes()

        # variable list
        tag = c.u32()
        nvars = c.u32()
        record_vars: list[str] = []
        if not (tag == 0 and nvars == 0):
            if tag != _TAG_VARIABLE:
                raise NetCDFError("expected variable list")
            for _ in range(nvars):
                nm = c.name()
                nd = c.u32()
                dimids = [c.u32() for _ in range(nd)]
                attrs = c.attributes()
                nc_type = c.u32()
                vsize = c.u32()
                begin = c.u64() if self.version == 2 else c.u32()
                dim_names = tuple(dim_by_index[i].name for i in dimids)
                shape = tuple(dim_by_index[i].size for i in dimids)
                is_rec = any(dim_by_index[i].is_unlimited for i in dimids)
                if is_rec:
                    record_vars.append(nm)
                self.variables[nm] = NC3Variable(
                    name=nm,
                    dimensions=dim_names,
                    nc_type=nc_type,
                    dtype=_TYPE_NAME[nc_type],
                    attributes=attrs,
                    shape=shape,
                    is_record=is_rec,
                    _begin=begin,
                    _vsize=vsize,
                )
        # size of one record slab (sum of every record variable's vsize)
        self.record_bytes = sum(
            self.variables[nm]._vsize for nm in record_vars
        )

    # -- value access ---------------------------------------------------
    def read_values(self, name: str) -> "array.array | str":
        """Return the raw values of *name*, exactly as stored.

        * char variables -> ``str``
        * numeric variables -> :class:`array.array` in **native** byte order
          (the on-disk big-endian bytes are swapped if needed).

        Row-major ("C") ordering is preserved; the fastest-varying axis is the
        last dimension. No masking, scaling or unit handling.
        """
        if name not in self.variables:
            raise KeyError(f"{self.path.name}: no variable {name!r}")
        var = self.variables[name]
        total = 1
        for s in var.shape:
            total *= s

        if var.nc_type == _NC_CHAR:
            raw = self._char_bytes(var, total)
            return raw.decode("utf-8", "replace")

        buf = self._numeric_bytes(var, total)
        arr = array.array(_ARRAY_CHAR[var.nc_type])
        arr.frombytes(buf)
        if sys.byteorder == "little":
            arr.byteswap()          # file is big-endian
        return arr

    def _numeric_bytes(self, var: NC3Variable, total: int) -> bytes:
        itemsize = _TYPE_SIZE[var.nc_type]
        if not var.is_record:
            start = var._begin
            return self._data[start : start + total * itemsize]
        # record variable: gather one slab per record
        inner = total // max(self.numrecs, 1)
        slab = inner * itemsize
        chunks = [
            self._data[
                var._begin + rec * self.record_bytes : var._begin + rec * self.record_bytes + slab
            ]
            for rec in range(self.numrecs)
        ]
        return b"".join(chunks)

    def _char_bytes(self, var: NC3Variable, total: int) -> bytes:
        if not var.is_record:
            return self._data[var._begin : var._begin + total]
        inner = total // max(self.numrecs, 1)
        chunks = [
            self._data[
                var._begin + rec * self.record_bytes : var._begin + rec * self.record_bytes + inner
            ]
            for rec in range(self.numrecs)
        ]
        return b"".join(chunks)


def peek_format(path: str | Path) -> str:
    """Cheap classification of *path* by magic bytes (opens read-only)."""
    with open(path, "rb") as fh:
        magic = fh.read(4)
    if magic == b"CDF\x01":
        return "NetCDF-3 classic (CDF\\x01, 32-bit offset)"
    if magic == b"CDF\x02":
        return "NetCDF-3 64-bit offset (CDF\\x02)"
    if magic.startswith(b"\x89HDF"):
        return "HDF5 / NetCDF-4 (unsupported by this reader)"
    return f"unknown (magic {magic!r})"
