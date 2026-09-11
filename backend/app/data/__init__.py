"""Data Integration Track code (steps D7+).

``app.data.ingestion`` -- D7 read-only ingestion layer for the real INCOIS
NetCDF files acquired in D4. Processing/cleaning (D8), format conversion (D9)
and the backend/API layer (D10) will land in sibling packages later.

``app.data.scientific`` -- Step 37 xarray-backed scientific data layer: a small,
generic, read-only abstraction over ``xarray.Dataset`` / ``xarray.DataArray``
for future NetCDF ingestion work. Step 38 adds ``app.data.scientific.netcdf``
(``open_netcdf`` / ``open_scientific_netcdf``): NetCDF file -> xarray ->
``ScientificDataset``. Neither replaces the pure-stdlib D7 ingestion layer or
the BlueNexus ``.bnx`` pipeline. Step 39 exposes one configured NetCDF file
through the additive ``/api/netcdf`` namespace (via
``app.services.netcdf_service``); the existing ``.bnx`` datasets and endpoints
are unchanged.
"""
