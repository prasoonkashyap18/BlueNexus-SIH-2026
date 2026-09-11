"""Step 51 -- the real data-source / provenance catalogue.

One place that answers, for every real scientific dataset the application uses:
*what* it supplies, *where* it comes from, *which* dataset / product id, the
*variable* and its plain-language name, the *units*, the relevant *coverage*
and whether it is **analysis**, **forecast**, **reanalysis** or **observation**.

It does not read bulk arrays and it invents nothing: every value is taken from
an existing authoritative place --

* the gridded ``.bnx`` catalogue (``BlueNexusCatalog``) for the two INCOIS
  analysis / forecast datasets (temperature, salinity, currents),
* :mod:`app.data.observations.argo` / :mod:`app.data.observations.glider`
  ``SOURCE`` / ``UNITS`` constants for the two observation sources,
* :mod:`app.api.config` ``MODEL_*`` constants (and the live NetCDF service's
  ``coverage`` block) for the GLORYS12V1 model-comparison source.

GLORYS12V1 is Copernicus Marine / Mercator Ocean data and is labelled as such;
it is **never** described as INCOIS data.
"""

from __future__ import annotations

from typing import Any, Optional

from ..api import config as api_config
from ..services.catalog import BlueNexusCatalog
from ..services.netcdf_service import NetCDFDataService
from .observations import argo as argo_mod
from .observations import glider as glider_mod

# Plain-language names for the raw scientific variable identifiers, so the UI
# never has to guess (and never mislabels ``thetao`` as in-situ temperature).
_VARIABLE_DISPLAY: dict[str, str] = {
    "T_ANALYZED": "Objectively analysed sea-water temperature",
    "S_ANALYZED": "Objectively analysed practical salinity",
    "CURRENT": "Surface current speed (from U/V)",
    "U": "Eastward surface current",
    "V": "Northward surface current",
    "thetao": "Sea-water potential temperature (thetao)",
}


def _coverage_from_bnx_summary(summary: dict) -> dict[str, Any]:
    """Reshape a ``.bnx`` summary's four coverage blocks into a compact dict."""
    time_cov = summary.get("time_coverage") or {}
    depth_cov = summary.get("depth_coverage") or {}
    lat_cov = summary.get("latitude_coverage") or {}
    lon_cov = summary.get("longitude_coverage") or {}
    return {
        "time": {
            "start": time_cov.get("start_iso"),
            "end": time_cov.get("end_iso"),
            "count": time_cov.get("n"),
        },
        "depth": {
            "min": depth_cov.get("min"),
            "max": depth_cov.get("max"),
            "count": depth_cov.get("n"),
            "units": depth_cov.get("units"),
            "surface_only": bool(depth_cov.get("surface_only", False)),
        },
        "latitude": {"min": lat_cov.get("min"), "max": lat_cov.get("max"), "units": lat_cov.get("units")},
        "longitude": {"min": lon_cov.get("min"), "max": lon_cov.get("max"), "units": lon_cov.get("units")},
    }


def _first_param(params_payload: dict, parameter_id: str) -> dict:
    for entry in params_payload.get("parameters", []):
        if entry.get("parameter_id") == parameter_id:
            return entry
    return {}


def _variable_block(source_variable: Optional[str], standard_name: Optional[str], long_name: Optional[str]) -> dict:
    name = source_variable or ""
    return {
        "name": name,
        "display": _VARIABLE_DISPLAY.get(name) or long_name or name,
        "standard_name": standard_name,
    }


def _bnx_field_source(
    catalog: BlueNexusCatalog,
    *,
    key: str,
    context_label: str,
    dataset_id: str,
    parameter_id: str,
) -> Optional[dict]:
    try:
        summaries = {s["dataset_id"]: s for s in catalog.list_summaries()}
    except Exception:  # catalogue not loaded -- caller falls back
        return None
    summary = summaries.get(dataset_id)
    if summary is None:
        return None

    try:
        params_payload = catalog.parameters(dataset_id)
    except Exception:
        params_payload = {"parameters": []}
    param = _first_param(params_payload, parameter_id)

    src = summary.get("source") or {}
    product_type = str(summary.get("product_type") or "analysis")
    return {
        "key": key,
        "category": "field",
        "context_label": context_label,
        "label": "INCOIS Ocean Analysis" if product_type == "analysis" else "INCOIS IO-HOOFS",
        "kind": product_type,  # "analysis" | "forecast"
        # An objective analysis is derived from the observations, not a free model
        # run; the IO-HOOFS forecast is a model product.
        "is_model": product_type in ("forecast", "reanalysis"),
        "is_incois": True,
        "organization": "Indian National Centre for Ocean Information Services (INCOIS)",
        "dataset_id": dataset_id,
        "product_identifier": src.get("dataset_id"),
        "product_title": src.get("product_title"),
        "variable": _variable_block(
            param.get("source_variable"),
            param.get("standard_name"),
            param.get("long_name") or param.get("display_name"),
        ),
        "units": param.get("units") or param.get("raw_units"),
        "temporal_semantics": summary.get("temporal_semantics"),
        "coverage": _coverage_from_bnx_summary(summary),
        "subset_note": None,
        "url": src.get("url"),
        "attribution": None,
    }


def _observation_source(source: dict, units: dict, *, key: str, context_label: str, dataset_id: str, variable_names: list[str]) -> dict:
    if key == "argo":
        label = "INCOIS Indian_ARGO_Floats"
        organization = "Indian National Centre for Ocean Information Services (INCOIS)"
    else:
        label = "EGO / OceanGliders GDAC"
        organization = source.get("programme") or "EGO / OceanGliders (IFREMER / Coriolis GDAC)"
    return {
        "key": key,
        "category": "observation",
        "context_label": context_label,
        "label": label,
        "kind": "observation",
        "is_model": False,
        "is_incois": key == "argo",
        "organization": organization,
        "access_via": source.get("source_name"),
        "dataset_id": dataset_id,
        "product_identifier": source.get("source_dataset_id"),
        "product_title": source.get("product_title") or source.get("programme"),
        "variable": {
            "name": ", ".join(variable_names),
            "display": "In-situ CTD temperature & practical salinity vs pressure",
            "standard_name": None,
        },
        "units": {
            "temperature": units.get("temperature"),
            "salinity": units.get("salinity"),
            "pressure": units.get("pressure"),
        },
        "temporal_semantics": source.get("temporal_semantics"),
        "coverage": None,
        "subset_note": None,
        "url": source.get("source_url"),
        "attribution": None,
    }


def _glorys_source(netcdf_service: Optional[NetCDFDataService]) -> dict:
    coverage: Optional[dict] = None
    subset_note = (
        "Regional validation subset — a small Arabian Sea extract of the global "
        "product (not the full GLORYS12V1 archive), chosen to overlap real INCOIS "
        "Argo profiles for the model-observation comparison."
    )
    if netcdf_service is not None:
        try:
            info = netcdf_service.dataset_info()
            cov = info.get("coverage") or {}
            depth = cov.get("depth") or {}
            lat = cov.get("latitude") or {}
            lon = cov.get("longitude") or {}
            time_cov = cov.get("time") or {}
            coverage = {
                "time": {
                    "start": time_cov.get("start"),
                    "end": time_cov.get("end"),
                    "count": time_cov.get("count"),
                },
                "depth": {
                    "min": depth.get("min"),
                    "max": depth.get("max"),
                    "count": depth.get("count"),
                    "units": depth.get("units"),
                    "surface_only": False,
                },
                "latitude": {"min": lat.get("min"), "max": lat.get("max"), "units": lat.get("units")},
                "longitude": {"min": lon.get("min"), "max": lon.get("max"), "units": lon.get("units")},
            }
        except Exception:
            coverage = None

    return {
        "key": "model_comparison",
        "category": "comparison",
        "context_label": "Model (temperature comparison)",
        "label": api_config.MODEL_SOURCE_LABEL,  # "GLORYS12V1 / Copernicus Marine"
        "kind": "reanalysis",
        "is_model": True,
        "is_incois": False,
        "organization": "E.U. Copernicus Marine Service (CMEMS) / Mercator Ocean International",
        "dataset_id": api_config.MODEL_NETCDF_DATASET_ID,
        "product_identifier": api_config.MODEL_PRODUCT_ID,  # GLOBAL_MULTIYEAR_PHY_001_030
        "copernicus_dataset_id": api_config.MODEL_COPERNICUS_DATASET_ID,  # cmems_mod_glo_phy_my_0.083deg_P1D-m
        "doi": api_config.MODEL_DOI,
        "product_title": "Global Ocean Physics Reanalysis (GLORYS12V1)",
        "variable": _variable_block(
            api_config.MODEL_TEMPERATURE_VARIABLE, "sea_water_potential_temperature", "Potential temperature"
        ),
        "units": "degrees_C",
        "temporal_semantics": "Daily-mean reanalysis fields (not instantaneous, not a forecast, not an observation).",
        "coverage": coverage,
        "subset_note": subset_note,
        "url": "https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/description",
        "attribution": "Generated using E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00021",
    }


def build_source_catalog(
    *,
    catalog: BlueNexusCatalog,
    netcdf_service: Optional[NetCDFDataService] = None,
) -> dict:
    """Assemble the Step 51 data-source catalogue response.

    Every field-source entry that cannot be resolved from the loaded catalogue
    is simply omitted (the endpoint never fabricates a placeholder). The two
    observation sources and the GLORYS model source are always present -- they
    come from static provenance constants, not from a live file handle.
    """
    sources: list[dict] = []

    temp = _bnx_field_source(
        catalog,
        key="temperature",
        context_label="Temperature",
        dataset_id="incois_argo_10day_analysis",
        parameter_id="temperature",
    )
    if temp is not None:
        sources.append(temp)

    sal = _bnx_field_source(
        catalog,
        key="salinity",
        context_label="Salinity",
        dataset_id="incois_argo_10day_analysis",
        parameter_id="salinity",
    )
    if sal is not None:
        sources.append(sal)

    cur = _bnx_field_source(
        catalog,
        key="currents",
        context_label="Surface current",
        dataset_id="incois_io_hoofs_surface_currents",
        parameter_id="current_speed",
    )
    if cur is not None:
        sources.append(cur)

    sources.append(
        _observation_source(
            argo_mod.SOURCE,
            argo_mod.UNITS,
            key="argo",
            context_label="Argo observation",
            dataset_id=argo_mod.ARGO_DATASET_ID,
            variable_names=["temperature", "salinity", "pressure"],
        )
    )
    sources.append(
        _observation_source(
            glider_mod.SOURCE,
            glider_mod.UNITS,
            key="gliders",
            context_label="Glider observation",
            dataset_id=glider_mod.GLIDER_DATASET_ID,
            variable_names=["temperature", "salinity", "pressure"],
        )
    )

    sources.append(_glorys_source(netcdf_service))

    return {
        "count": len(sources),
        "sources": sources,
        "notes": [
            "Every label above corresponds to a real dataset the application uses; none is a demo or placeholder.",
            "Temperature and salinity are the INCOIS Argo 10-day objective analysis; surface currents are the INCOIS "
            "IO-HOOFS operational model forecast; both are served through the BlueNexus data API.",
            "Argo profiles are the INCOIS Indian_ARGO_Floats snapshot; glider profiles are the EGO / OceanGliders GDAC "
            "snapshot. Both are in-situ observations, not model output.",
            "GLORYS12V1 is Copernicus Marine / Mercator Ocean reanalysis data, used only for the model-observation "
            "temperature comparison. It is NOT INCOIS data, and the configured file is a small regional subset.",
        ],
    }
