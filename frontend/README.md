# BlueNexus frontend

React 19 + TypeScript + Vite + Three.js client for the INCOIS Ocean Visualization
Platform. See the [repository README](../README.md) for the project overview, data
sources and deployment architecture.

## Scripts

```bash
npm install        # first time only
npm run dev        # dev server at http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run lint       # oxlint
npm test           # logic tests (node --test)
```

## Configuration

The API base URL is the only environment value the client reads:

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | The deployed backend URL. Set this at build time for production. Only `VITE_`-prefixed vars reach the bundle; this is a plain URL, **never a secret**. |

Copy `.env.example` to `.env.local` (git-ignored) to override it for your machine.

## Notes

- `src/api/config.ts` is the single source of truth for the backend URL — nothing
  else hard-codes it.
- A `DevCrashProbe` component exists only to exercise the application error boundary
  during development/testing. It is guarded by `import.meta.env.DEV` and is **absent
  from production builds** (verified: no `DevCrashProbe` string in `dist/`).
