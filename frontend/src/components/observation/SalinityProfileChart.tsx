import { useMemo } from 'react'
import type { ArgoObservationsPhase } from '../../state/argoObservationsState'
import { DataErrorState } from '../feedback/DataErrorState'
import { measuredSalinityPoints, type SalinityProfileRow } from './salinityProfile'
import styles from './SalinityProfileChart.module.css'

/* ==================================================================== *
 *  Step 33 — real vertical salinity profile.
 *
 *  Plots the REAL `salinity` (PSU) against the REAL `pressure` (dbar) from
 *  the selected Argo profile's measured `levels` or the selected glider
 *  deployment's trajectory `samples` — loaded through the existing
 *  `useArgoProfile(id)` / `useGliderDeployment(id)` hooks
 *  (`GET /api/observations/argo/{id}` · `GET /api/observations/gliders/{id}`).
 *
 *  Data rules (Step 33 — identical to the Step 32 temperature chart):
 *   - native units only: pressure stays in dbar, salinity in PSU
 *   - a pair is dropped only when its pressure OR salinity is null / non-finite
 *   - no interpolation, no in-fill, no artificial smoothing, no QC filtering
 *   - NO pressure→depth conversion — the vertical axis is pressure (dbar)
 *
 *  The one display-only transform is ordering the kept points by ascending
 *  pressure so the polyline reads down the water column; no value is added,
 *  removed or altered by it.
 * ==================================================================== */

interface SalinityProfileChartProps {
  phase: ArgoObservationsPhase
  /** `detail.levels` (Argo) or `detail.samples` (glider); `null` until loaded. */
  rows: readonly SalinityProfileRow[] | null
  /** `level_count` / `sample_count` from the summary record, for the readout. */
  measuredCount: number | null
  /** Step 48 — the profile fetch's error object; drives the failure notice. */
  error?: unknown
  /** Step 48 — re-fetch this profile. */
  onRetry?: () => void
  platformId: string
}

/* ------------------------------------------------------------------ *
 * Geometry (SVG user units; the viewBox scales to the dock width)
 * ------------------------------------------------------------------ */

const VIEW = { width: 260, height: 200 } as const
const PLOT = { left: 44, right: 250, top: 28, bottom: 172 } as const
const PLOT_WIDTH = PLOT.right - PLOT.left
const PLOT_HEIGHT = PLOT.bottom - PLOT.top

/* ------------------------------------------------------------------ *
 * Scales — a readable 1 / 2 / 5 × 10ⁿ tick step over the real extent
 * ------------------------------------------------------------------ */

function niceStep(rough: number): number {
  if (!(rough > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / magnitude
  const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
  return nice * magnitude
}

function tickSeries(from: number, to: number, step: number): number[] {
  const ticks: number[] = []
  for (let tick = from; tick <= to + step * 1e-6 && ticks.length < 14; tick += step) {
    ticks.push(Number(tick.toFixed(4)))
  }
  return ticks
}

interface Scale {
  min: number
  max: number
  ticks: number[]
  decimals: number
}

/** Salinity axis: the data's own span plus a little breathing room. */
function salinityScale(values: readonly number[]): Scale {
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const pad = (highest - lowest || 1) * 0.08
  const min = lowest - pad
  const max = highest + pad
  const step = niceStep((max - min) / 5)
  return {
    min,
    max,
    ticks: tickSeries(Math.ceil(min / step) * step, max, step),
    decimals: step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0,
  }
}

/** Pressure axis: anchored at the surface (0 dbar), increasing downward. */
function pressureScale(minPressure: number, maxPressure: number): Scale {
  const top = Math.min(0, minPressure)
  const step = niceStep((maxPressure - top) / 4)
  const firstTick = Math.max(0, Math.ceil(top / step) * step)
  return {
    min: top,
    max: maxPressure,
    ticks: tickSeries(firstTick, maxPressure, step),
    decimals: step < 1 ? 1 : 0,
  }
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function SalinityProfileChart({
  phase,
  rows,
  measuredCount,
  error,
  onRetry,
  platformId,
}: SalinityProfileChartProps) {
  const model = useMemo(() => {
    if (rows === null) return null

    // Real, finite (pressure, salinity) pairs only — ordered by pressure.
    // No interpolation, smoothing, QC filtering or unit change (see the module).
    const points = measuredSalinityPoints(rows)

    if (points.length < 2) return { plottable: false as const, valid: points.length }

    const sals = points.map((p) => p.salinity)
    const salinity = salinityScale(sals)
    const pressure = pressureScale(points[0]!.pressure, points[points.length - 1]!.pressure)

    const xAt = (s: number) =>
      PLOT.left + ((s - salinity.min) / (salinity.max - salinity.min)) * PLOT_WIDTH
    const span = pressure.max - pressure.min || 1
    const yAt = (p: number) => PLOT.top + ((p - pressure.min) / span) * PLOT_HEIGHT

    const coords = points.map((p) => ({
      cx: Number(xAt(p.salinity).toFixed(2)),
      cy: Number(yAt(p.pressure).toFixed(2)),
    }))

    return {
      plottable: true as const,
      valid: points.length,
      salinity,
      pressure,
      xAt,
      yAt,
      coords,
      polyline: coords.map((c) => `${c.cx},${c.cy}`).join(' '),
      shallow: points[0]!,
      deep: points[points.length - 1]!,
    }
  }, [rows])

  const heading = <h4 className={styles.title}>Salinity Profile</h4>

  if (phase === 'idle' || phase === 'loading') {
    return (
      <figure className={styles.chart}>
        <div className={styles.head}>{heading}</div>
        <p className={styles.state}>
          <span className={styles.stateIcon} aria-hidden="true">◌</span>
          Loading the real measured profile…
        </p>
      </figure>
    )
  }

  if (phase === 'error') {
    return (
      <figure className={styles.chart}>
        <div className={styles.head}>{heading}</div>
        <DataErrorState
          compact
          title="Salinity profile unavailable"
          error={error}
          onRetry={onRetry}
        />
      </figure>
    )
  }

  if (model === null || !model.plottable) {
    return (
      <figure className={styles.chart}>
        <div className={styles.head}>{heading}</div>
        <p className={styles.state}>
          <span className={styles.stateIcon} aria-hidden="true">◎</span>
          No valid pressure / salinity pairs in this record.
        </p>
      </figure>
    )
  }

  const { salinity, pressure, xAt, yAt, coords, valid, shallow, deep } = model
  const showVertices = valid <= 140
  const midY = PLOT.top + PLOT_HEIGHT / 2
  const readout =
    measuredCount !== null && measuredCount !== valid
      ? `${valid} of ${measuredCount} valid`
      : `${valid} valid measurements`

  return (
    <figure className={styles.chart}>
      <div className={styles.head}>
        {heading}
        <span className={styles.count}>{readout}</span>
      </div>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={
          `Real measured salinity profile for ${platformId}: ` +
          `${shallow.salinity.toFixed(2)} PSU at ${shallow.pressure.toFixed(1)} dbar, ` +
          `${deep.salinity.toFixed(2)} PSU at ${deep.pressure.toFixed(1)} dbar, ` +
          `across ${valid} valid levels. Pressure increases downward.`
        }
      >
        <g className={styles.grid}>
          {salinity.ticks.map((tick) => (
            <line key={`s-${tick}`} x1={xAt(tick)} y1={PLOT.top} x2={xAt(tick)} y2={PLOT.bottom} />
          ))}
          {pressure.ticks.map((tick) => (
            <line key={`p-${tick}`} x1={PLOT.left} y1={yAt(tick)} x2={PLOT.right} y2={yAt(tick)} />
          ))}
        </g>

        <g className={styles.axis}>
          <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.right} y2={PLOT.top} />
          <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} />
        </g>

        <g className={styles.tickLabel}>
          {salinity.ticks.map((tick) => (
            <text key={`s-${tick}`} x={xAt(tick)} y={PLOT.top - 6} textAnchor="middle">
              {tick.toFixed(salinity.decimals)}
            </text>
          ))}
          {pressure.ticks.map((tick) => (
            <text
              key={`p-${tick}`}
              x={PLOT.left - 6}
              y={yAt(tick)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.toFixed(pressure.decimals)}
            </text>
          ))}
        </g>

        <text className={styles.axisTitle} x={PLOT.left} y={11}>
          Salinity (PSU)
        </text>
        <text
          className={styles.axisTitle}
          x={11}
          y={midY}
          textAnchor="middle"
          transform={`rotate(-90 11 ${midY})`}
        >
          Pressure (dbar)
        </text>

        <polyline className={styles.glow} points={model.polyline} />
        <polyline className={styles.line} points={model.polyline} />

        {showVertices ? (
          <g className={styles.markers}>
            {coords.map((c, i) => (
              <circle key={i} cx={c.cx} cy={c.cy} r="1.3" />
            ))}
          </g>
        ) : null}
      </svg>
    </figure>
  )
}
