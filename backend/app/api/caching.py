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

Step 58 -- CORS + CDN caching interaction fix
==============================================

**The incident.** Once Step 57 shipped, the production frontend started
showing "Temperature data unavailable". Chrome's Network panel showed the
*exact* mechanism: a cached response (`X-Vercel-Cache: HIT`,
`Cache-Control: public, max-age=3600`) came back **without**
`Access-Control-Allow-Origin`, so the browser refused to let the page read
it -- a CORS failure, even though a plain `curl` against the same URL (no
`Origin` header) looked perfectly healthy.

**Root cause.** Starlette's `CORSMiddleware` (see
``starlette/middleware/cors.py``) only ever touches a response when the
*request that produced it* carried an `Origin` header:

    if origin is None:
        await self.app(scope, receive, send)
        return

Any request with no `Origin` header -- a plain `curl`, a health-checker, a
crawler, or simply the first request that happens to warm a given URL's edge
cache slot -- sails straight through with **zero** CORS headers added. When
*that* response is the one Vercel's CDN caches (keyed on the URL alone, with
no `Vary: Origin` split happening at the edge), every subsequent `HIT` --
including a real browser's cross-origin `fetch()`, which does send `Origin`
-- is served the exact same CORS-header-less bytes. The browser then
(correctly) blocks it. This is not a caching bug in the sense of wrong data;
the JSON body is byte-identical either way -- it is a *header* bug: the one
header a browser needs was decided by an unrelated, earlier, Origin-less
request.

The alternative Starlette already offers for a *specific* allowed origin --
reflecting `Access-Control-Allow-Origin: <origin>` plus `Vary: Origin`
(`CORSMiddleware.allow_explicit_origin`) -- does not fix this: it depends on
the CDN re-running the origin-selection logic and creating one cached
variant *per distinct `Origin` value* whenever `Vary: Origin` is present.
Vercel's edge cache did not do that here (the incident is direct proof of
it), and relying on it would still leave GET requests from a bare `curl` /
bot / health-check permanently poisoning the cache for every browser after
them. It also is not verifiable read-only from outside the platform, and the
brief was to pick the option that does not depend on unverified CDN
behaviour.

**The fix.** These specific allow-listed routes are all: (a) plain `GET`,
(b) never send or read a cookie / `Authorization` header (`allow_credentials`
is `False` -- confirmed in ``app/api/app.py``'s `CORSMiddleware` setup and
never changed here), and (c) serve data that is already fully public to any
HTTP client with no auth at all (that is the whole point of a public ocean
data API). For exactly this shape of endpoint, the Fetch/CORS specification
allows `Access-Control-Allow-Origin: *` -- and, critically, a `*` response is
**origin-independent**: it is valid for literally any request, so it does
not matter which request (with or without `Origin`, from any host) happened
to populate a given CDN cache slot. This middleware now forces exactly that
value onto every allow-listed cacheable response, overriding whatever
`CORSMiddleware` computed (nothing, one echoed origin, or -- if a request
carried no `Origin` at all -- nothing), and drops any `Vary: Origin` that
`CORSMiddleware` may have added, since a `*` response does not vary by origin
and an inherited `Vary: Origin` would only fragment the CDN cache for no
benefit.

This intentionally narrows the origin allowlist's protection to exactly
where it still matters: `GET /api/health` and every non-2xx error response
(never touched by this module) keep the original, unmodified
`CORSMiddleware` behaviour -- an explicit allowlist, origin reflected only
when it matches, `Vary: Origin` present, nothing for a disallowed origin.
Only the deliberately-public, already-CDN-cached dataset surface becomes
openly cross-origin-fetchable, which is the minimum change that actually
stops a cache slot's CORS header from depending on which client happened to
warm it.
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

#: Step 58 -- forced onto every allow-listed cacheable response regardless of
#: the request's own `Origin` (or lack of one). Safe here specifically because
#: these routes never use credentials (`allow_credentials=False`, unchanged)
#: and serve data that is already fully public with no auth. A `*` response is
#: valid for every origin, so it cannot go stale/wrong no matter which request
#: populated a given CDN cache slot -- see the module docstring ("Step 58").
IMMUTABLE_CORS_ALLOW_ORIGIN = "*"


def is_immutable_get_path(path: str) -> bool:
    """Whether ``path`` (no query string) is one of the allow-listed shapes."""
    return any(pattern.match(path) for pattern in _IMMUTABLE_GET_PATTERNS)


def apply_immutable_response_headers(headers) -> None:
    """Make one allow-listed 200 GET response safe to serve from a shared CDN
    cache to any caller, regardless of which request originally populated
    that cache entry.

    Sets the long-lived ``Cache-Control`` (Step 57) and forces
    ``Access-Control-Allow-Origin: *`` (Step 58), replacing whatever
    ``CORSMiddleware`` computed for *this particular* request (an echoed
    origin, or nothing at all if the request had no ``Origin`` header).  Also
    drops any ``Vary: Origin`` ``CORSMiddleware`` may have added -- a ``*``
    response does not vary by origin, and leaving it in would only fragment
    the CDN cache across `Origin` values for no benefit.

    ``headers`` is a ``starlette.datastructures.MutableHeaders`` (or anything
    with the same ``__setitem__`` / ``__delitem__`` / ``__contains__``
    contract); this function never touches the response body or status code.
    """
    headers["Cache-Control"] = IMMUTABLE_CACHE_CONTROL
    headers["Access-Control-Allow-Origin"] = IMMUTABLE_CORS_ALLOW_ORIGIN
    if "vary" in headers:
        del headers["vary"]
