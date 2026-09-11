"""Basic **ingestion / schema** checks for D7.

These answer "can we trust that we read the file correctly and it is the file
we expect?" -- file presence, readability, expected variables/dimensions,
shape/dimension agreement, coordinate presence, fill-value metadata, dtype,
and the two structural depth facts (currents = 1 level, temp/salinity = 24
levels).

They are deliberately **not** the D6 scientific validation: no physical range
checks, no unit sanity beyond "is an attribute present", no missing-fraction
thresholds, no cross-variable science.

``run_checks`` returns a :class:`CheckReport`. ``ERROR`` results mean the
ingest cannot be trusted; ``WARNING`` results are advisory (e.g. a dimension
size differs from the D4 sample -- a newer sample may legitimately differ).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

from .netcdf3 import peek_format

if TYPE_CHECKING:  # avoid a runtime import cycle
    from .models import IngestedDataset
    from .registry import DatasetSpec


class Severity(str, Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


@dataclass(frozen=True)
class Check:
    name: str
    severity: Severity
    passed: bool
    detail: str

    def __str__(self) -> str:
        flag = "ok  " if self.passed else f"{self.severity.value:<5}"
        return f"[{flag}] {self.name}: {self.detail}"


@dataclass(frozen=True)
class CheckReport:
    dataset: str
    checks: tuple[Check, ...]

    @property
    def ok(self) -> bool:
        return all(c.passed or c.severity is not Severity.ERROR for c in self.checks)

    @property
    def errors(self) -> tuple[Check, ...]:
        return tuple(c for c in self.checks if not c.passed and c.severity is Severity.ERROR)

    @property
    def warnings(self) -> tuple[Check, ...]:
        return tuple(c for c in self.checks if not c.passed and c.severity is Severity.WARNING)

    def __str__(self) -> str:
        head = f"schema report for {self.dataset}: {'PASS' if self.ok else 'FAIL'}"
        return "\n".join([head, *(f"  {c}" for c in self.checks)])


def _add(checks: list[Check], name: str, sev: Severity, passed: bool, detail: str) -> None:
    checks.append(Check(name, sev, passed, detail))


def check_file_present(spec: "DatasetSpec") -> CheckReport:
    """Pre-open checks: the file exists, is non-empty, and looks like NetCDF-3."""
    checks: list[Check] = []
    path = spec.path()
    exists = path.is_file()
    _add(checks, "file_exists", Severity.ERROR, exists, str(path))
    if exists:
        size = path.stat().st_size
        _add(checks, "file_non_empty", Severity.ERROR, size > 0, f"{size} bytes")
        fmt = peek_format(path)
        _add(
            checks,
            "file_is_netcdf3_classic",
            Severity.ERROR,
            fmt.startswith("NetCDF-3"),
            fmt,
        )
    return CheckReport(spec.name, tuple(checks))


def run_checks(ds: "IngestedDataset", spec: "DatasetSpec") -> CheckReport:
    """Post-ingest schema checks against *spec*."""
    checks: list[Check] = []
    dim_sizes = ds.dimension_sizes

    # -- expected dimensions present ----------------------------------
    for dname, expected in spec.expected_dimensions.items():
        present = dname in dim_sizes
        _add(checks, f"dimension_present[{dname}]", Severity.ERROR, present,
             "present" if present else "MISSING")
        if present:
            match = dim_sizes[dname] == expected
            _add(
                checks,
                f"dimension_size[{dname}]",
                Severity.WARNING,
                match,
                f"{dim_sizes[dname]} (D4 sample had {expected})",
            )

    # -- expected coordinate variables present -----------------------
    for cname in spec.expected_coordinates:
        present = cname in ds.coordinates
        _add(checks, f"coordinate_present[{cname}]", Severity.ERROR, present,
             "present" if present else "MISSING")

    # -- role coverage ---------------------------------------------
    roles = {cv.axis_role for cv in ds.coordinates.values()}
    for role in ("time", "latitude", "longitude"):
        _add(checks, f"axis_role[{role}]", Severity.ERROR, role in roles,
             "mapped" if role in roles else "no coordinate mapped to this role")
    _add(checks, "axis_role[depth]", Severity.WARNING, "depth" in roles,
         "mapped" if "depth" in roles else "no depth axis")

    # -- expected scientific variables + their structure -------------
    for vs in spec.variables:
        v = ds.variables.get(vs.name)
        _add(checks, f"variable_present[{vs.name}]", Severity.ERROR, v is not None,
             "present" if v is not None else "MISSING")
        if v is None:
            continue

        # shape vs. declared dimensions
        shape_from_dims = tuple(dim_sizes.get(d, -1) for d in v.dimensions)
        _add(
            checks,
            f"variable_shape_matches_dims[{vs.name}]",
            Severity.ERROR,
            shape_from_dims == v.shape and -1 not in shape_from_dims,
            f"shape {v.shape} vs dims {v.dimensions} -> {shape_from_dims}",
        )

        # values buffer length vs. shape product
        expected_n = 1
        for s in v.shape:
            expected_n *= s
        _add(
            checks,
            f"variable_value_count[{vs.name}]",
            Severity.ERROR,
            v.size == expected_n,
            f"{v.size} values, expected {expected_n}",
        )

        # dtype present / recognised
        _add(checks, f"variable_dtype[{vs.name}]", Severity.INFO, bool(v.dtype),
             v.dtype)

        # fill-value metadata available
        has_fill = v.fill_value is not None
        _add(checks, f"variable_fill_metadata[{vs.name}]", Severity.WARNING, has_fill,
             f"fill_value={v.fill_value}")
        if has_fill and vs.name in spec.expected_fill_values:
            exp = spec.expected_fill_values[vs.name]
            match = v.fill_value == exp or abs(v.fill_value - exp) <= abs(exp) * 1e-6
            _add(checks, f"variable_fill_value[{vs.name}]", Severity.WARNING, match,
                 f"{v.fill_value} (D6 saw {exp})")

        # observed missing-value representation (structural observation)
        _add(
            checks,
            f"variable_missing_representation[{vs.name}]",
            Severity.INFO,
            True,
            f"{v.missing_representation} "
            f"(nan={v.observed_nan_count}, sentinel=={v.fill_value}:{v.observed_sentinel_count})",
        )

        # units metadata: raw string present OR a normalized interpretation recorded
        _add(
            checks,
            f"variable_units_metadata[{vs.name}]",
            Severity.INFO,
            v.units.raw_units is not None or v.units.normalized_units is not None,
            f"raw={v.units.raw_units!r} normalized={v.units.normalized_units!r}",
        )

    # -- structural depth facts -------------------------------------
    if ds.depth is not None:
        n = ds.depth.count
        if spec.name == "incois_io_hoofs_surface_currents":
            _add(checks, "currents_depth_single_level", Severity.ERROR, n == 1,
                 f"{n} level(s)")
            if n == 1:
                surf = abs(ds.depth.values[0]) < 1e-9
                _add(checks, "currents_depth_is_surface", Severity.WARNING, surf,
                     f"depth[0] = {ds.depth.values[0]}")
        if spec.name == "incois_argo_10day_analysis":
            _add(checks, "ts_depth_has_24_levels", Severity.WARNING, n == 24,
                 f"{n} level(s)")
            _add(checks, "ts_depth_not_assumed_even", Severity.INFO,
                 ds.depth.step_if_regular() is None,
                 "irregular spacing (as expected)" if ds.depth.step_if_regular() is None
                 else "spacing looks regular -- double check")

    # -- coordinate monotonicity (structural, not scientific) -------
    for cv in ds.coordinates.values():
        mono = cv.is_monotonic_ascending or cv.is_monotonic_descending or cv.count <= 1
        _add(checks, f"coordinate_monotonic[{cv.name}]", Severity.WARNING, mono,
             "monotonic" if mono else "NOT monotonic")

    return CheckReport(spec.name, tuple(checks))


class SchemaError(Exception):
    """Raised by :func:`validate_or_raise` when an ERROR-level check fails."""

    def __init__(self, report: CheckReport) -> None:
        self.report = report
        errs = "; ".join(f"{c.name}: {c.detail}" for c in report.errors)
        super().__init__(f"{report.dataset}: schema check failed -- {errs}")


def validate_or_raise(ds: "IngestedDataset", spec: "DatasetSpec") -> CheckReport:
    report = run_checks(ds, spec)
    if not report.ok:
        raise SchemaError(report)
    return report
