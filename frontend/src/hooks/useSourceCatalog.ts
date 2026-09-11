import { useEffect, useState } from 'react'
import { dataApi, isAbortError } from '../api/client.ts'
import type { SourceCatalogResponse } from '../api/types.ts'
import { STATIC_SOURCE_CATALOG } from '../components/controls/dataSources.ts'

/* ==================================================================== *
 *  Step 51 — the data-source / provenance catalogue, from the backend.
 *
 *  `GET /api/sources` is small, stable and identical for every reader, so it is
 *  fetched once per session and memoised at module scope. Until (or unless) it
 *  resolves, `STATIC_SOURCE_CATALOG` is served — an identity-only fallback that
 *  still names every dataset, variable and unit correctly (it just omits the
 *  live coverage / time extents). So the source panel is always accurate and
 *  never blocks on the network.
 *
 *  No polling, no retry loop. If the one request fails the fallback stands.
 * ==================================================================== */

let cached: SourceCatalogResponse | null = null
let inFlight: Promise<SourceCatalogResponse> | null = null

function load(): Promise<SourceCatalogResponse> {
  if (cached !== null) return Promise.resolve(cached)
  if (inFlight !== null) return inFlight
  inFlight = dataApi
    .getSourceCatalog()
    .then((response) => {
      cached = response
      return response
    })
    .catch((cause) => {
      inFlight = null
      throw cause
    })
  return inFlight
}

export interface SourceCatalogHook {
  catalog: SourceCatalogResponse
  /** `true` once the real backend catalogue has replaced the static fallback. */
  live: boolean
}

export function useSourceCatalog(): SourceCatalogHook {
  const [catalog, setCatalog] = useState<SourceCatalogResponse>(cached ?? STATIC_SOURCE_CATALOG)
  const [live, setLive] = useState(cached !== null)

  useEffect(() => {
    if (cached !== null) return
    let active = true
    load()
      .then((response) => {
        if (active) {
          setCatalog(response)
          setLive(true)
        }
      })
      .catch((cause) => {
        if (!active || isAbortError(cause)) return
        // Keep the static fallback — it is still correct for identity.
      })
    return () => {
      active = false
    }
  }, [])

  return { catalog, live }
}

/** Test-only — drop the module cache between cases. */
export function __resetSourceCatalogCache(): void {
  cached = null
  inFlight = null
}
