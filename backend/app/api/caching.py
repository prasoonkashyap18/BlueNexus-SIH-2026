"""Step 57 -- CDN caching headers for immutable, read-only GET responses.

Investigation context: the deployed API was consuming its entire Vercel
"Fast Origin Transfer" allowance because every GET request -- including the
multi-megabyte IO-HOOFS current-vector slices -- was re-executed and
re-transferred from the origin function on every hit. None of these
responses carried a ``Cache-Control`` header, so Vercel's edge network had no
basis to serve a repeat request out of its CDN cache; it always fell through
to the function.

This module adds exactly one thing: a long-lived, CDN-cacheable
``Cache-Control`` header on the GET endpoints whose response body is a pure
function of (path params, query params) over data that is fixed for the
lifetime of one deployment. It does not touch any response body, schema, or
scientific value -- see ``docs/api-caching.md`` for the full decision record.

**What makes an endpoint eligible (all of these must hold):**

* It only ever reads data loaded once at process startup -- the D9
  ``.bnx`` containers (``app.services.catalog``), the D4 raw CSV
  observation snapshots (``app.services.observations``), or the one
  configured NetCDF file (``app.services.netcdf_service``). Nothing in this
  codebase mutates any of those after startup; there is no write path, no
  per-request file I/O beyond a bounded partial read, and no database.
* Its response depends only on the request URL (path segments + query
  string) -- never on a cookie, an auth header, or any other per-caller
  state. Different ``dataset_id`` / ``parameter_id`` / ``variable_name`` /
  ``platform_id`` / ``time_index`` / ``depth_index`` / ``latitude_index`` /
  ``longitude_index`` values are different URLs, so a CDN keys them as
  distinct cache entries automatically -- no ``Vary`` header is needed.
* It is not a liveness/status signal. ``GET /api/health`` is deliberately
  excluded even though its ``data_layer`` block rarely changes: its whole
  purpose is to answer "is this process currently serving?", which a CDN
  must never answer from a stale cache.

Every route module keeps returning exactly what it returned before; this
middleware only ever *adds* a response header, and only for a successful
(``200``) GET on an allow-listed path. Every non-2xx response (a transient
``404`` / ``422`` / ``503``) is left untouched, matching the rule that error
responses are never cached.
"""

from __future__ import annotations

import re

# One regex per immutable GET route shape (matched against `request.url.path`
# only -- the query string is not part of `path`, so it plays no role in this
# match; it still becomes part of the full URL a CDN uses as its cache key).
_IMMUTABLE_GET_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        # Gridded BlueNexus datasets (app/api/routes/datasets.py) -- metadata
        # reads of the cached .bnx manifest.
        r"^/api/datasets$",
        r"^/api/datasets/[^/]+$",
        r"^/api/datasets/[^/]+/parameters$",
        r"^/api/datasets/[^/]+/coordinates$",
        # The bounded lat/lon plane slice (app/api/routes/slices.py) -- the
        # single largest response in the app (the 421x601 IO-HOOFS current
        # planes) and the primary driver of the Fast Origin Transfer usage
        # this change targets.
        r"^/api/datasets/[^/]+/parameters/[^/]+/slice$",
        # Real in-situ observation snapshots (app/api/routes/observations.py)
        # -- fixed D4 CSV snapshots, loaded once at startup.
        r"^/api/observations/argo$",
        r"^/api/observations/argo/[^/]+$",
        r"^/api/observations/argo/[^/]+/temperature-profile$",
        r"^/api/observations/gliders$",
        r"^/api/observations/gliders/[^/]+$",
        # The additive NetCDF namespace (app/api/routes/netcdf.py) -- one
        # configured file, opened once at startup; the GLORYS `thetao` slice
        # is the other multi-megabyte response in the app.
        r"^/api/netcdf/dataset$",
        r"^/api/netcdf/variables/[^/]+$",
        r"^/api/netcdf/variables/[^/]+/slice$",
        # Model-at-observation extraction / comparison
        # (app/api/routes/model_observations.py) -- a pure function of the
        # same two fixed snapshots (GLORYS NetCDF + Argo CSV).
        r"^/api/model-observations/argo/[^/]+/temperature$",
        r"^/api/model-observations/argo/[^/]+/temperature-comparison$",
        # The data-source / provenance catalogue (app/api/routes/sources.py)
        # -- derived entirely from the same fixed metadata.
        r"^/api/sources$",
    )
)

#: Deliberately excluded: `GET /api/health` (liveness, not immutable data).

#: Applied verbatim to every allow-listed, 200-status GET response.
#:
#: * ``public``                        -- cacheable by shared caches (Vercel's
#:                                         CDN edge), not just the browser.
#: * ``max-age=3600``                   -- the browser itself may reuse its own
#:                                         copy for up to 1 hour without even
#:                                         asking the CDN.
#: * ``s-maxage=2592000``               -- the CDN edge may serve its cached
#:                                         copy for up to 30 days without
#:                                         invoking the origin function at
#:                                         all. This is the number that
#:                                         directly cuts Fast Origin Transfer:
#:                                         a request served from the edge
#:                                         cache never reaches the function,
#:                                         so it is not billed as origin
#:                                         transfer.
#: * ``stale-while-revalidate=86400``   -- if the CDN entry does expire, it
#:                                         may still serve the (still
#:                                         correct) stale copy for up to 1
#:                                         more day while it revalidates in
#:                                         the background, instead of forcing
#:                                         every caller through a blocking
#:                                         origin hit at the exact expiry
#:                                         instant.
IMMUTABLE_CACHE_CONTROL = "public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400"


def is_immutable_get_path(path: str) -> bool:
    """Whether ``path`` (no query string) is one of the allow-listed shapes."""
    return any(pattern.match(path) for pattern in _IMMUTABLE_GET_PATTERNS)
