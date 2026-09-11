import { useId, useMemo } from 'react'
import type { DepthValuePoint } from './modelComparison'
import styles from './ModelComparisonChart.module.css'

/* ==================================================================== *
 *  Step 46 — the model ↔ observation comparison visualisations.
 *
 *  Two hand-drawn SVGs (no charting dependency), in the BlueNexus dark
 *  scientific style:
 *
 *   1. ModelComparisonChart — GLORYS12V1 model temperature and Argo observed
 *      temperature on one Temperature (°C) × Depth (m) frame. Surface at the
 *      top, depth increasing downward. Two clearly distinct series + a legend.
 *
 *   2. DifferenceProfileChart — the signed model − observation difference
 *      (`difference_c`, verbatim) against native GLORYS depth, with a zero
 *      reference line: right of zero ⇒ model warmer, left ⇒ model colder.
 *
 *  Both consume ONLY the real points prepared by `modelComparison.ts` from the
 *  Step 45 response. No interpolation, no smoothing, no invented level, no
 *  null→0. Ordering by depth is the single display-only transform.
 * ==================================================================== */

/* ------------------------------------------------------------------ *
 * Shared scale helpers (mirrors TemperatureProfileChart)
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

function valueScale(values: readonly number[], padFraction = 0.08): Scale {
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const pad = (highest - lowest || 1) * padFraction
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

/** Depth axis: anchored at the surface (0 m), increasing downward. */
function depthScale(maxDepth: number): Scale {
  const step = niceStep((maxDepth || 1) / 4)
  return {
    min: 0,
    max: maxDepth || 1,
    ticks: tickSeries(0, maxDepth, step),
    decimals: step < 1 ? 1 : 0,
  }
}

/** Difference axis: symmetric about 0 so the sign reads off the centre line. */
function symmetricScale(values: readonly number[]): Scale {
  const extent = Math.max(0.05, ...values.map((v) => Math.abs(v)))
  const pad = extent * 0.12
  const min = -(extent + pad)
  const max = extent + pad
  const step = niceStep((max - min) / 6)
  return {
    min,
    max,
    ticks: tickSeries(Math.ceil(min / step) * step, max, step),
    decimals: step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0,
  }
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

const VIEW = { width: 300, height: 224 } as const
const PLOT = { left: 46, right: 288, top: 30, bottom: 190 } as const
const PLOT_WIDTH = PLOT.right - PLOT.left
const PLOT_HEIGHT = PLOT.bottom - PLOT.top

function polyline(points: readonly { cx: number; cy: number }[]): string {
  return points.map((p) => `${p.cx},${p.cy}`).join(' ')
}

/* ================================================================== *
 * 1. Model vs Observation
 * ================================================================== */

interface ModelComparisonChartProps {
  platformId: string
  model: readonly DepthValuePoint[]
  observed: readonly DepthValuePoint[]
}

export function ModelComparisonChart({
  platformId,
  model,
  observed,
}: ModelComparisonChartProps) {
  const geom = useMemo(() => {
    const temps = [...model, ...observed].map((p) => p.value)
    const depths = [...model, ...observed].map((p) => p.depth)
    if (temps.length < 2) return null

    const temperature = valueScale(temps)
    const depth = depthScale(Math.max(...depths))

    const xAt = (t: number) =>
      PLOT.left + ((t - temperature.min) / (temperature.max - temperature.min)) * PLOT_WIDTH
    const span = depth.max - depth.min || 1
    const yAt = (d: number) => PLOT.top + ((d - depth.min) / span) * PLOT_HEIGHT

    const project = (points: readonly DepthValuePoint[]) =>
      points.map((p) => ({
        cx: Number(xAt(p.value).toFixed(2)),
        cy: Number(yAt(p.depth).toFixed(2)),
      }))

    return { temperature, depth, xAt, yAt, model: project(model), observed: project(observed) }
  }, [model, observed])

  if (geom === null) {
    return (
      <figure className={styles.chart}>
        <p className={styles.state}>
          <span className={styles.stateIcon} aria-hidden="true">◎</span>
          Not enough matched levels to draw the comparison.
        </p>
      </figure>
    )
  }

  const { temperature, depth, xAt, yAt } = geom
  const midY = PLOT.top + PLOT_HEIGHT / 2

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchModel}`} aria-hidden="true" />
          GLORYS12V1 model
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchObs}`} aria-hidden="true" />
          Argo observation
        </span>
      </figcaption>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={
          `Model minus observation temperature comparison for Argo ${platformId}. ` +
          `Two profiles on a temperature versus depth frame: the GLORYS12V1 model ` +
          `temperature and the Argo observed temperature, ${geom.model.length} model ` +
          `levels and ${geom.observed.length} matched observation levels. ` +
          `Depth increases downward.`
        }
      >
        <g className={styles.grid}>
          {temperature.ticks.map((tick) => (
            <line key={`t-${tick}`} x1={xAt(tick)} y1={PLOT.top} x2={xAt(tick)} y2={PLOT.bottom} />
          ))}
          {depth.ticks.map((tick) => (
            <line key={`d-${tick}`} x1={PLOT.left} y1={yAt(tick)} x2={PLOT.right} y2={yAt(tick)} />
          ))}
        </g>

        <g className={styles.axis}>
          <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.right} y2={PLOT.top} />
          <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} />
        </g>

        <g className={styles.tickLabel}>
          {temperature.ticks.map((tick) => (
            <text key={`t-${tick}`} x={xAt(tick)} y={PLOT.top - 6} textAnchor="middle">
              {tick.toFixed(temperature.decimals)}
            </text>
          ))}
          {depth.ticks.map((tick) => (
            <text
              key={`d-${tick}`}
              x={PLOT.left - 6}
              y={yAt(tick)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.toFixed(depth.decimals)}
            </text>
          ))}
        </g>

        <text className={styles.axisTitle} x={PLOT.left} y={12}>
          Temperature (°C)
        </text>
        <text
          className={styles.axisTitle}
          x={12}
          y={midY}
          textAnchor="middle"
          transform={`rotate(-90 12 ${midY})`}
        >
          Depth (m)
        </text>

        {/* Observation first, model on top — model is the series being assessed. */}
        <polyline className={styles.obsLine} points={polyline(geom.observed)} />
        <g className={styles.obsMarkers}>
          {geom.observed.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r="1.5" />
          ))}
        </g>

        <polyline className={styles.modelGlow} points={polyline(geom.model)} />
        <polyline className={styles.modelLine} points={polyline(geom.model)} />
        <g className={styles.modelMarkers}>
          {geom.model.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r="1.3" />
          ))}
        </g>
      </svg>
    </figure>
  )
}

/* ================================================================== *
 * 2. Model − Observation difference
 * ================================================================== */

interface DifferenceProfileChartProps {
  platformId: string
  difference: readonly DepthValuePoint[]
}

const DIFF_VIEW = { width: 300, height: 200 } as const
const DIFF_PLOT = { left: 46, right: 288, top: 26, bottom: 168 } as const
const DIFF_PLOT_WIDTH = DIFF_PLOT.right - DIFF_PLOT.left
const DIFF_PLOT_HEIGHT = DIFF_PLOT.bottom - DIFF_PLOT.top

export function DifferenceProfileChart({
  platformId,
  difference,
}: DifferenceProfileChartProps) {
  const gradientId = useId()

  const geom = useMemo(() => {
    if (difference.length < 1) return null
    const diff = symmetricScale(difference.map((p) => p.value))
    const depth = depthScale(Math.max(...difference.map((p) => p.depth)))

    const xAt = (t: number) =>
      DIFF_PLOT.left + ((t - diff.min) / (diff.max - diff.min)) * DIFF_PLOT_WIDTH
    const span = depth.max - depth.min || 1
    const yAt = (d: number) =>
      DIFF_PLOT.top + ((d - depth.min) / span) * DIFF_PLOT_HEIGHT

    const zeroX = Number(xAt(0).toFixed(2))
    const coords = difference.map((p) => ({
      cx: Number(xAt(p.value).toFixed(2)),
      cy: Number(yAt(p.depth).toFixed(2)),
      value: p.value,
    }))
    return { diff, depth, xAt, yAt, zeroX, coords }
  }, [difference])

  if (geom === null) {
    return (
      <figure className={styles.chart}>
        <p className={styles.state}>
          <span className={styles.stateIcon} aria-hidden="true">◎</span>
          No matched levels — no model − observation difference to show.
        </p>
      </figure>
    )
  }

  const { diff, depth, xAt, yAt, zeroX, coords } = geom
  const midY = DIFF_PLOT.top + DIFF_PLOT_HEIGHT / 2

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchDiff}`} aria-hidden="true" />
          Model − Observation
        </span>
        <span className={styles.legendHint}>right of 0 = model warmer</span>
      </figcaption>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${DIFF_VIEW.width} ${DIFF_VIEW.height}`}
        role="img"
        aria-label={
          `Signed model minus observation temperature difference for Argo ${platformId} ` +
          `against depth, over ${coords.length} matched levels. Positive means the ` +
          `GLORYS12V1 model is warmer than the Argo observation; negative means colder. ` +
          `Depth increases downward.`
        }
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--mc-cold)" />
            <stop offset="50%" stopColor="var(--mc-cold)" />
            <stop offset="50%" stopColor="var(--mc-warm)" />
            <stop offset="100%" stopColor="var(--mc-warm)" />
          </linearGradient>
        </defs>

        <g className={styles.grid}>
          {depth.ticks.map((tick) => (
            <line
              key={`d-${tick}`}
              x1={DIFF_PLOT.left}
              y1={yAt(tick)}
              x2={DIFF_PLOT.right}
              y2={yAt(tick)}
            />
          ))}
        </g>

        <g className={styles.tickLabel}>
          {diff.ticks.map((tick) => (
            <text key={`x-${tick}`} x={xAt(tick)} y={DIFF_PLOT.top - 6} textAnchor="middle">
              {tick > 0 ? `+${tick.toFixed(diff.decimals)}` : tick.toFixed(diff.decimals)}
            </text>
          ))}
          {depth.ticks.map((tick) => (
            <text
              key={`d-${tick}`}
              x={DIFF_PLOT.left - 6}
              y={yAt(tick)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick.toFixed(depth.decimals)}
            </text>
          ))}
        </g>

        <text className={styles.axisTitle} x={DIFF_PLOT.left} y={12}>
          Δ Temperature (°C)
        </text>
        <text
          className={styles.axisTitle}
          x={12}
          y={midY}
          textAnchor="middle"
          transform={`rotate(-90 12 ${midY})`}
        >
          Depth (m)
        </text>

        {/* Zero reference — the scientifically primary line. */}
        <line
          className={styles.zeroLine}
          x1={zeroX}
          y1={DIFF_PLOT.top}
          x2={zeroX}
          y2={DIFF_PLOT.bottom}
        />

        {/* Lollipop from zero to each real difference. */}
        <g>
          {coords.map((c, i) => (
            <line
              key={`s-${i}`}
              className={c.value >= 0 ? styles.stemWarm : styles.stemCold}
              x1={zeroX}
              y1={c.cy}
              x2={c.cx}
              y2={c.cy}
            />
          ))}
        </g>
        <polyline
          className={styles.diffLine}
          points={polyline(coords)}
          stroke={`url(#${gradientId})`}
        />
        <g>
          {coords.map((c, i) => (
            <circle
              key={`p-${i}`}
              className={c.value >= 0 ? styles.dotWarm : styles.dotCold}
              cx={c.cx}
              cy={c.cy}
              r="1.7"
            />
          ))}
        </g>
      </svg>
    </figure>
  )
}
