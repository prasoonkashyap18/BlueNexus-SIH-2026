"""Canonical BlueNexus parameter registry (D9).

One entry per parameter the BlueNexus contract exposes. The **canonical id** is
the only thing D10 / the frontend look things up by; ``display_aliases`` are
strictly cosmetic and are never resolved to a canonical id by this layer.

Design notes:

* ``temperature`` is a **multi-depth analysis field**, *not* SST. The id is
  ``temperature``; nothing here calls it ``sst``.
* ``current_u`` / ``current_v`` / ``current_speed`` are three separate
  parameters that share a ``vector_group``. ``current_speed`` is the
  INCOIS-supplied ``CURRENT`` field and is flagged ``authoritative`` -- it is
  never recomputed from the components.
* The surface-current parameters are ``surface_only`` (their depth axis is a
  single 0 m level).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ParameterSpec:
    parameter_id: str                     # canonical id -- the only lookup key
    display_name: str
    source_variable: str                  # variable name in the raw/cleaned data
    source_dataset: str                   # CleanedDataset.name it comes from
    canonical_units: str
    kind: str                             # "scalar_field" | "vector_component" | "vector_magnitude"
    display_aliases: tuple[str, ...] = ()  # cosmetic only; NOT resolved anywhere
    vector_group: str | None = None       # links u / v / speed
    vector_role: str | None = None        # "eastward" | "northward" | None
    authoritative: bool = True            # source field kept as-is (not derived)
    surface_only: bool = False
    notes: tuple[str, ...] = ()


TEMPERATURE = ParameterSpec(
    parameter_id="temperature",
    display_name="Sea Water Temperature",
    source_variable="T_ANALYZED",
    source_dataset="incois_argo_10day_analysis",
    canonical_units="degC",
    kind="scalar_field",
    display_aliases=("temp",),
    notes=(
        "Multi-depth objective-analysis field (24 levels, 5-2000 m). This is "
        "NOT sea-surface temperature -- the surface is only depth index 0.",
    ),
)

SALINITY = ParameterSpec(
    parameter_id="salinity",
    display_name="Sea Water Practical Salinity",
    source_variable="S_ANALYZED",
    source_dataset="incois_argo_10day_analysis",
    canonical_units="PSU",
    kind="scalar_field",
    display_aliases=("salt",),
    notes=("Multi-depth objective-analysis field (24 levels, 5-2000 m).",),
)

CURRENT_U = ParameterSpec(
    parameter_id="current_u",
    display_name="Eastward Surface Current",
    source_variable="U",
    source_dataset="incois_io_hoofs_surface_currents",
    canonical_units="m s-1",
    kind="vector_component",
    vector_group="surface_current",
    vector_role="eastward",
    surface_only=True,
)

CURRENT_V = ParameterSpec(
    parameter_id="current_v",
    display_name="Northward Surface Current",
    source_variable="V",
    source_dataset="incois_io_hoofs_surface_currents",
    canonical_units="m s-1",
    kind="vector_component",
    vector_group="surface_current",
    vector_role="northward",
    surface_only=True,
)

CURRENT_SPEED = ParameterSpec(
    parameter_id="current_speed",
    display_name="Surface Current Speed",
    source_variable="CURRENT",
    source_dataset="incois_io_hoofs_surface_currents",
    canonical_units="m s-1",
    kind="vector_magnitude",
    display_aliases=("current",),
    vector_group="surface_current",
    vector_role=None,
    authoritative=True,
    surface_only=True,
    notes=(
        "INCOIS-supplied speed (source variable CURRENT). Authoritative -- NOT "
        "recomputed from current_u / current_v. D6/D8 verified "
        "CURRENT == sqrt(U^2 + V^2) to ~4e-16.",
    ),
)


ALL_PARAMETERS: tuple[ParameterSpec, ...] = (
    TEMPERATURE,
    SALINITY,
    CURRENT_U,
    CURRENT_V,
    CURRENT_SPEED,
)

_BY_ID = {p.parameter_id: p for p in ALL_PARAMETERS}
_BY_SOURCE = {(p.source_dataset, p.source_variable): p for p in ALL_PARAMETERS}


def parameter(parameter_id: str) -> ParameterSpec:
    """Look up a parameter by its **canonical id** (aliases are not accepted)."""
    try:
        return _BY_ID[parameter_id]
    except KeyError:
        raise KeyError(
            f"unknown canonical parameter id {parameter_id!r}; "
            f"known: {sorted(_BY_ID)}"
        ) from None


def parameter_for_source(dataset_name: str, source_variable: str) -> ParameterSpec:
    return _BY_SOURCE[(dataset_name, source_variable)]


def parameters_for_dataset(dataset_name: str) -> tuple[ParameterSpec, ...]:
    return tuple(p for p in ALL_PARAMETERS if p.source_dataset == dataset_name)
