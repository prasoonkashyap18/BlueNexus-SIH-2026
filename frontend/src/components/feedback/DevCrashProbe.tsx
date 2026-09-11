import { useEffect, useState } from 'react'
import styles from './DevCrashProbe.module.css'

/* ==================================================================== *
 *  Step 55 — development-only error-boundary probe.
 *
 *  Renders nothing users ever see: it is mounted only when
 *  `import.meta.env.DEV` is true (see `App.tsx`), so it is absent from every
 *  production build. Its single job is to let the validation flow force a
 *  *real* descendant render failure — deep inside every provider — so the
 *  root {@link ErrorBoundary} can be exercised for real.
 *
 *  Three equivalent ways to arm it, all development-only:
 *    • click the low-profile "force render error" control it draws
 *    • dispatch `window` event `bluenexus:dev-force-render-error` (CDP)
 *    • load the app with `?crash` in the query string (one-shot; the param
 *      is stripped immediately so a "Try again" recovers cleanly)
 *
 *  When armed it throws during render; recovery ("Try again" → the boundary
 *  remounts the whole app) brings it back disarmed.
 * ==================================================================== */

const FORCE_EVENT = 'bluenexus:dev-force-render-error'

/** Throws synchronously during render — the failure the boundary must catch. */
function Boom(): never {
  throw new Error('Forced render error — development error-boundary probe')
}

/* Read the one-shot `?crash` trigger exactly once, at module load — before
   React mounts — and strip it from the URL immediately so a later "Try again"
   or "Reload application" is never stuck re-crashing. Doing this at module
   scope (not in a `useState` initializer) keeps the initializer pure under
   StrictMode's double invocation. */
const CRASH_REQUESTED =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('crash')

if (CRASH_REQUESTED) {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
}

export function DevCrashProbe() {
  const [armed, setArmed] = useState(CRASH_REQUESTED)

  useEffect(() => {
    const arm = () => setArmed(true)
    window.addEventListener(FORCE_EVENT, arm)
    return () => window.removeEventListener(FORCE_EVENT, arm)
  }, [])

  if (armed) return <Boom />

  return (
    <button
      type="button"
      className={styles.trigger}
      onClick={() => setArmed(true)}
      aria-hidden="true"
      tabIndex={-1}
      title="Development only: force a render error to exercise the error boundary"
    >
      force render error
    </button>
  )
}
