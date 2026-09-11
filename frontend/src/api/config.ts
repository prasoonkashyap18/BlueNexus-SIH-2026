/**
 * Single source of truth for the BlueNexus data-API base URL (D11).
 *
 * Resolution order:
 *   1. `VITE_API_BASE_URL` (Vite env — see `frontend/.env.example`)
 *   2. `http://localhost:8000` (the D10 backend's development default)
 *
 * Nothing else in the app should hard-code the backend URL — import
 * `API_BASE_URL` (or go through `src/api/client.ts`) instead.
 *
 * This is a plain URL, never a secret. Do not put credentials in `VITE_*`
 * variables: Vite inlines them into the client bundle.
 */

const DEVELOPMENT_DEFAULT = 'http://localhost:8000'

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

function readConfiguredBaseUrl(): string | undefined {
  // Vite replaces `import.meta.env.VITE_*` at build time. Guard the access so
  // this module also loads under a plain Node test runner, where
  // `import.meta.env` is undefined.
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env
  const fromVite = viteEnv?.VITE_API_BASE_URL
  if (fromVite && fromVite.trim() !== '') {
    return fromVite.trim()
  }

  // Non-Vite runtimes (the Node test runner) expose config via process.env.
  // Reached through globalThis so this file needs no Node type definitions.
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const fromNode = nodeEnv?.VITE_API_BASE_URL
  if (fromNode && fromNode.trim() !== '') {
    return fromNode.trim()
  }

  return undefined
}

/** Absolute base URL for the D10 API, with any trailing slash removed. */
export const API_BASE_URL: string = stripTrailingSlashes(
  readConfiguredBaseUrl() ?? DEVELOPMENT_DEFAULT,
)

/** True when the base URL came from configuration rather than the built-in default. */
export const API_BASE_URL_IS_CONFIGURED: boolean = readConfiguredBaseUrl() !== undefined
