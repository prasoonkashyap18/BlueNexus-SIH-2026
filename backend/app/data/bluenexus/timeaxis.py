"""Minimal CF-style time-axis normalisation for D9.

Turns a ``"<unit> since <reference>"`` string plus numeric offsets into ISO-8601
UTC timestamps, deterministically. Only the forms the two acquired INCOIS files
actually use are supported:

* ``seconds since 1970-01-01T00:00:00Z``   (temperature / salinity)
* ``hours since 2026-09-03 01:30``         (currents -- no offset in the string)

The currents reference string carries no timezone. D6 established that INCOIS
IO-HOOFS / Ocean State Forecast operates in UTC, so a naive reference is read
as UTC and :func:`normalise_time_axis` reports ``assumed_timezone = "UTC"`` for
that case.

Raw numeric coordinate values are never discarded -- the ISO strings are an
*additional* representation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

_UNIT_SECONDS = {
    "second": 1.0,
    "seconds": 1.0,
    "sec": 1.0,
    "s": 1.0,
    "minute": 60.0,
    "minutes": 60.0,
    "min": 60.0,
    "hour": 3600.0,
    "hours": 3600.0,
    "hr": 3600.0,
    "h": 3600.0,
    "day": 86400.0,
    "days": 86400.0,
    "d": 86400.0,
}

_REFERENCE_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d %H",
    "%Y-%m-%d",
)


@dataclass(frozen=True)
class TimeAxisNormalisation:
    units: str                      # the raw units string, unchanged
    unit_name: str                  # "seconds" | "hours" | ...
    reference_iso: str              # reference epoch as ISO-8601 UTC
    had_explicit_timezone: bool
    assumed_timezone: str | None    # "UTC" when we had to assume, else None
    iso_times: tuple[str, ...]      # one ISO-8601 UTC string per input value
    epoch_seconds: tuple[float, ...]  # POSIX seconds per input value (derived)


def _parse_reference(text: str) -> tuple[datetime, bool]:
    raw = text.strip()
    explicit_tz = False
    if raw.endswith("Z"):
        raw = raw[:-1].strip()
        explicit_tz = True
    for fmt in _REFERENCE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        return dt.replace(tzinfo=timezone.utc), explicit_tz
    raise ValueError(f"unrecognised time reference epoch: {text!r}")


def parse_units(units: str) -> tuple[str, float, datetime, bool]:
    """``("hours since 2026-09-03 01:30")`` -> (unit_name, seconds_per_unit, ref_dt_utc, had_tz)."""
    if " since " not in units:
        raise ValueError(f"not a CF time-units string: {units!r}")
    unit_part, ref_part = units.split(" since ", 1)
    unit_name = unit_part.strip().lower()
    if unit_name not in _UNIT_SECONDS:
        raise ValueError(f"unsupported time unit {unit_part!r} in {units!r}")
    ref_dt, had_tz = _parse_reference(ref_part)
    return unit_name, _UNIT_SECONDS[unit_name], ref_dt, had_tz


def normalise_time_axis(units: str, values) -> TimeAxisNormalisation:
    unit_name, per_unit, ref_dt, had_tz = parse_units(units)
    iso: list[str] = []
    epoch: list[float] = []
    for v in values:
        dt = ref_dt + timedelta(seconds=float(v) * per_unit)
        # deterministic ISO-8601 UTC, always with a trailing Z
        iso.append(dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        epoch.append(dt.timestamp())
    return TimeAxisNormalisation(
        units=units,
        unit_name=unit_name,
        reference_iso=ref_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        had_explicit_timezone=had_tz,
        assumed_timezone=None if had_tz else "UTC",
        iso_times=tuple(iso),
        epoch_seconds=tuple(epoch),
    )
