/**
 * `<DataApiConnectionProbe />` — renders nothing.
 *
 * Runs {@link useDataApiConnection} once so the app makes real requests to the
 * D10 backend on load, and logs a concise summary to the browser console in
 * development. This is the D11 "development connection mechanism": it proves
 * the frontend can reach and parse the API without changing any visible UI or
 * the mock visualization (that is D12).
 *
 * It is only mounted when `import.meta.env.DEV` is true (see `App.tsx`), so
 * production builds do not fire the probe.
 */

import { useEffect } from 'react'
import { useDataApiConnection } from './useDataApiConnection.ts'

const TAG = '[BlueNexus data API]'

export function DataApiConnectionProbe(): null {
  const connection = useDataApiConnection()

  useEffect(() => {
    if (connection.phase === 'idle' || connection.phase === 'loading') {
      return
    }

    if (connection.phase === 'error') {
      console.error(
        `${TAG} connection FAILED at step "${connection.error?.step}" ` +
          `(${connection.error?.type}): ${connection.error?.message}`,
        connection.error?.detail ?? '',
      )
      return
    }

    console.info(`${TAG} connected → ${connection.baseUrl}`, {
      health: (connection.health as { status?: string } | null)?.status,
      datasets: connection.datasetIds,
      temperature: {
        units: connection.temperatureParameter?.units,
        surface_only: connection.temperatureParameter?.surface_only,
        shape: connection.temperatureParameter?.shape,
      },
      coordinates: connection.coordinates,
      temperatureSlice: connection.temperatureSlice,
    })
  }, [connection])

  return null
}
