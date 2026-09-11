"""The xarray scientific-layer wrappers.

Two thin, read-only wrappers:

* :class:`ScientificDataset` around :class:`xarray.Dataset`
* :class:`ScientificVariable` around :class:`xarray.DataArray`

Both hold a *reference* to the underlying xarray object (no eager copy, no
``.load()`` / ``.compute()``). Structure queries return plain Python
containers; value access returns the xarray-native array with NaN / missing
entries untouched. Slicing delegates to xarray's own ``isel`` / ``sel`` and
returns a fresh wrapper -- the original object is never mutated.
"""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np
import xarray as xr

__all__ = ["ScientificDataset", "ScientificVariable"]


class ScientificVariable:
    """Read-only view over one :class:`xarray.DataArray`.

    Works for both data variables and coordinate variables -- in xarray both
    are ``DataArray`` objects.
    """

    __slots__ = ("_da",)

    def __init__(self, data_array: xr.DataArray) -> None:
        if not isinstance(data_array, xr.DataArray):
            raise TypeError(
                f"ScientificVariable expects an xarray.DataArray, got {type(data_array)!r}"
            )
        self._da = data_array

    # -- underlying object -------------------------------------------------
    @property
    def data_array(self) -> xr.DataArray:
        """The wrapped :class:`xarray.DataArray` (not a copy)."""
        return self._da

    @property
    def name(self) -> str | None:
        return None if self._da.name is None else str(self._da.name)

    # -- structure -------------------------------------------------------
    @property
    def dimensions(self) -> tuple[str, ...]:
        """Dimension names in the array's own (preserved) order."""
        return tuple(str(d) for d in self._da.dims)

    @property
    def sizes(self) -> dict[str, int]:
        """``{dimension name: length}`` in array order."""
        return {str(k): int(v) for k, v in self._da.sizes.items()}

    @property
    def shape(self) -> tuple[int, ...]:
        return tuple(int(n) for n in self._da.shape)

    @property
    def ndim(self) -> int:
        return int(self._da.ndim)

    @property
    def dtype(self) -> str:
        return str(self._da.dtype)

    # -- metadata ------------------------------------------------------
    @property
    def attributes(self) -> dict[str, Any]:
        """A shallow copy of the variable's attributes (safe to mutate)."""
        return dict(self._da.attrs)

    @property
    def units(self) -> str | None:
        """The ``units`` attribute exactly as stored, or ``None`` if absent."""
        units = self._da.attrs.get("units")
        return None if units is None else str(units)

    def attribute(self, key: str, default: Any = None) -> Any:
        return self._da.attrs.get(key, default)

    @property
    def coordinate_names(self) -> tuple[str, ...]:
        """Coordinates associated with this variable."""
        return tuple(str(c) for c in self._da.coords)

    # -- slicing (delegates to xarray, returns a new wrapper) -----------
    def isel(self, indexers: Mapping[str, Any] | None = None, **indexers_kwargs: Any) -> "ScientificVariable":
        """Positional / integer-indexed slicing along named dimensions.

        Thin pass-through to :meth:`xarray.DataArray.isel`; attributes are
        kept. The wrapped array is not modified.
        """
        merged = {**(indexers or {}), **indexers_kwargs}
        return ScientificVariable(self._da.isel(merged))

    def sel(self, indexers: Mapping[str, Any] | None = None, **indexers_kwargs: Any) -> "ScientificVariable":
        """Label-based slicing along named dimensions (pass-through to
        :meth:`xarray.DataArray.sel`)."""
        merged = {**(indexers or {}), **indexers_kwargs}
        return ScientificVariable(self._da.sel(merged))

    # -- scientific values (lossless) --------------------------------
    def values(self) -> np.ndarray:
        """The scientific values as a NumPy array.

        NaN / missing entries are preserved exactly as xarray holds them.
        Nothing is masked, filled, scaled or reordered.
        """
        return np.asarray(self._da.values)

    def to_numpy(self) -> np.ndarray:
        """Alias for :meth:`values`."""
        return self.values()

    def item(self) -> Any:
        """Scalar value of a 0-d selection (NaN preserved)."""
        return self._da.values[()].item() if self._da.ndim == 0 else self._da.item()

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"ScientificVariable(name={self.name!r}, dims={self.dimensions}, dtype={self.dtype!r})"


class ScientificDataset:
    """Read-only, lossless view over one :class:`xarray.Dataset`.

    Holds a reference to the dataset -- it is never copied or loaded eagerly.
    Every accessor either returns a plain Python container describing the
    structure, or a :class:`ScientificVariable` / new :class:`ScientificDataset`
    wrapping an xarray view. The wrapped dataset is never mutated.
    """

    __slots__ = ("_ds",)

    def __init__(self, dataset: xr.Dataset) -> None:
        if not isinstance(dataset, xr.Dataset):
            raise TypeError(
                f"ScientificDataset expects an xarray.Dataset, got {type(dataset)!r}"
            )
        self._ds = dataset

    @classmethod
    def from_dataset(cls, dataset: xr.Dataset) -> "ScientificDataset":
        """Explicit constructor (mirrors the ingestion layer's factory style)."""
        return cls(dataset)

    # -- underlying object -------------------------------------------------
    @property
    def dataset(self) -> xr.Dataset:
        """The wrapped :class:`xarray.Dataset` (not a copy)."""
        return self._ds

    # -- dimensions ---------------------------------------------------
    def dimensions(self) -> dict[str, int]:
        """``{dimension name: length}`` for every dimension in the dataset."""
        return {str(k): int(v) for k, v in self._ds.sizes.items()}

    def dimension_names(self) -> tuple[str, ...]:
        return tuple(str(d) for d in self._ds.sizes)

    # -- coordinates ------------------------------------------------
    def coordinate_names(self) -> tuple[str, ...]:
        """Every coordinate name (dimension coordinates and auxiliary ones)."""
        return tuple(str(c) for c in self._ds.coords)

    def dimension_coordinate_names(self) -> tuple[str, ...]:
        """Coordinates that are themselves a dimension (the usual axes:
        time / depth / lat / lon)."""
        return tuple(str(c) for c in self._ds.coords if c in self._ds.sizes)

    def coordinate(self, name: str) -> ScientificVariable:
        """The coordinate axis ``name`` as a :class:`ScientificVariable`."""
        if name not in self._ds.coords:
            raise KeyError(f"{name!r} is not a coordinate of this dataset")
        return ScientificVariable(self._ds.coords[name])

    # -- variables --------------------------------------------------
    def variable_names(self) -> tuple[str, ...]:
        """Every data variable name (coordinates excluded)."""
        return tuple(str(v) for v in self._ds.data_vars)

    def has_variable(self, name: str) -> bool:
        return name in self._ds.data_vars

    def variable(self, name: str) -> ScientificVariable:
        """One data variable as a :class:`ScientificVariable`."""
        if name not in self._ds.data_vars:
            raise KeyError(f"{name!r} is not a data variable of this dataset")
        return ScientificVariable(self._ds[name])

    # -- metadata --------------------------------------------------
    @property
    def attributes(self) -> dict[str, Any]:
        """A shallow copy of the dataset's global attributes."""
        return dict(self._ds.attrs)

    def attribute(self, key: str, default: Any = None) -> Any:
        return self._ds.attrs.get(key, default)

    def variable_attributes(self, name: str) -> dict[str, Any]:
        """Attributes of a coordinate or data variable (shallow copy)."""
        if name in self._ds.variables:
            return dict(self._ds[name].attrs)
        raise KeyError(f"{name!r} is not a variable of this dataset")

    def units(self, name: str) -> str | None:
        """The ``units`` attribute of a coordinate or data variable."""
        if name not in self._ds.variables:
            raise KeyError(f"{name!r} is not a variable of this dataset")
        units = self._ds[name].attrs.get("units")
        return None if units is None else str(units)

    # -- slicing (delegates to xarray, returns a new wrapper) ---------
    def isel(
        self, indexers: Mapping[str, Any] | None = None, **indexers_kwargs: Any
    ) -> "ScientificDataset":
        """Positional / integer-indexed slicing across the whole dataset.

        Use this for indexed time / depth / spatial subsetting, e.g.
        ``sci.isel(time=0, depth=slice(0, 5))``. Pass-through to
        :meth:`xarray.Dataset.isel`; the original dataset is not modified.
        """
        merged = {**(indexers or {}), **indexers_kwargs}
        return ScientificDataset(self._ds.isel(merged))

    def sel(
        self, indexers: Mapping[str, Any] | None = None, **indexers_kwargs: Any
    ) -> "ScientificDataset":
        """Label-based slicing across the whole dataset (pass-through to
        :meth:`xarray.Dataset.sel`)."""
        merged = {**(indexers or {}), **indexers_kwargs}
        return ScientificDataset(self._ds.sel(merged))

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return (
            f"ScientificDataset(dims={self.dimensions()}, "
            f"coords={self.coordinate_names()}, vars={self.variable_names()})"
        )
