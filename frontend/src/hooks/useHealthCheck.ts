import { useEffect, useState } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client.ts'

export type HealthStatus = 'loading' | 'online' | 'offline'

interface HealthResult {
  status: HealthStatus
  detail: string
}

/**
 * Polls the FastAPI backend once on mount via GET /api/health.
 *
 * This is the existing frontend<->backend connection from Step 5. D11 rewired
 * it to go through `src/api/client.ts` / `src/api/config.ts` so the backend URL
 * lives in exactly one place — the observable behaviour (loading → online /
 * offline, and the `status === 'ok'` check) is unchanged.
 */
export function useHealthCheck(): HealthResult {
  const [status, setStatus] = useState<HealthStatus>('loading')
  const [detail, setDetail] = useState('Connecting to backend')

  useEffect(() => {
    const controller = new AbortController()

    dataApi
      .getHealth(controller.signal)
      .then((data) => {
        const ok = data.status === 'ok'
        setStatus(ok ? 'online' : 'offline')
        setDetail(ok ? 'Backend online' : `Backend status: ${data.status}`)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        setStatus('offline')
        setDetail(
          ApiError.is(error) && error.type !== 'network_error'
            ? `Backend unreachable (${error.type})`
            : 'Backend unreachable',
        )
      })

    return () => {
      controller.abort()
    }
  }, [])

  return { status, detail }
}
