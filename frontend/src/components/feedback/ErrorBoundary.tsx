import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import {
  ERROR_BOUNDARY_COPY,
  INITIAL_ERROR_BOUNDARY_STATE,
  logBoundaryError,
  reduceRetry,
  type ErrorBoundaryState,
} from './errorBoundary'
import styles from './ErrorBoundary.module.css'

/* ==================================================================== *
 *  Step 55 — application error boundary.
 *
 *  Wraps the whole BlueNexus surface (see `main.tsx`). If any descendant
 *  throws during render, in a lifecycle method, or in a constructor, React
 *  unwinds to here instead of unmounting the page to a blank document, and
 *  this renders a calm, dark, BlueNexus-consistent fallback with two safe
 *  recovery actions:
 *
 *    • Try again        — clears the error and remounts the entire subtree
 *                         (keyed by `resetCount`), so providers, the Three.js
 *                         canvas, in-flight fetches and comparison state all
 *                         start clean. No duplicate root, no second canvas,
 *                         no retry loop.
 *    • Reload application — a full `location.reload()` for the rare case the
 *                         module state itself is wedged.
 *
 *  It intentionally shows the user no stack trace, file path, exception
 *  message, backend payload, or other internal — {@link ERROR_BOUNDARY_COPY}
 *  is the entire vocabulary. In a development build the raw cause is written
 *  to the console (only) via {@link logBoundaryError}.
 *
 *  Errors it does NOT catch (React's documented limits): event-handler
 *  errors, async / Promise rejections, and SSR — those are already handled
 *  by the Step 36/48 data layer, which throws into the panels' own
 *  {@link DataErrorState}, not into render.
 * ==================================================================== */

interface ErrorBoundaryProps {
  children: ReactNode
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_ERROR_BOUNDARY_STATE

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    // React shallow-merges this into the current state, so `resetCount` is
    // preserved — the equivalent of `reduceCaughtError` (which the unit test
    // pins). The current subtree identity is kept until the user recovers.
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    logBoundaryError(error, import.meta.env.DEV)
    void info
  }

  private handleRetry = (): void => {
    this.setState((prev) => reduceRetry(prev))
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className={styles.screen} role="alert" aria-live="assertive">
          <div className={styles.card}>
            <span className={styles.eyebrow}>{ERROR_BOUNDARY_COPY.eyebrow}</span>
            <h1 className={styles.title}>{ERROR_BOUNDARY_COPY.title}</h1>
            <p className={styles.detail}>{ERROR_BOUNDARY_COPY.detail}</p>
            <p className={styles.hint}>{ERROR_BOUNDARY_COPY.hint}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={this.handleRetry}>
                {ERROR_BOUNDARY_COPY.retry}
              </button>
              <button type="button" className={styles.secondary} onClick={this.handleReload}>
                {ERROR_BOUNDARY_COPY.reload}
              </button>
            </div>
          </div>
        </div>
      )
    }

    // A distinct key per recovery forces a full remount of the application on
    // "Try again" — nothing stale survives the boundary. A keyed Fragment adds
    // no DOM of its own, so the shell's full-bleed layout is untouched.
    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>
  }
}
