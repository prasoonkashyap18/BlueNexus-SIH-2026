import { memo, useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useObservationControls } from '../../../state/observationState'
import { useArgoObservations } from '../../../state/argoObservationsState'
import {
  useGliderObservations,
  useGliderDeployment,
} from '../../../state/gliderObservationsState'
import type { OceanRegion } from '../../../state/locationState'
import { RENDER_ORDER } from './sceneConfig'
import {
  ARGO_COLOR,
  ARGO_RADIUS,
  GLIDER_COLOR,
  GLIDER_NODE_RADIUS,
  MARKER_RIM,
  argoMarkersFor,
  gliderTrackPositions,
} from './observationMarkerLayout'

/** A dark rim shell behind a bright marker so it reads on any surface colour. */
const RIM_SCALE = 1.5

/**
 * Step 30 — real Argo & glider observation markers in the 3D scene.
 *
 * Every visible marker is **source-derived**: its world position comes from the
 * real `latitude` / `longitude` served by `/api/observations/argo` and
 * `/api/observations/gliders` (Steps 28–29), run through the scene's existing
 * `projectGeo` geographic→world transform (see `observationMarkerLayout.ts`);
 * its identity is the real `platform_id`. Nothing here invents a coordinate or
 * interpolates a position. While a provider is still loading, or on failure, no
 * marker is drawn — there is no fake stand-in.
 *
 * Argo — one lightweight sphere per profile/platform-cycle.
 * Glider — the real (decimated) trajectory as one `lineSegments` buffer plus an
 *          octahedron at the first real fix. A glider deployment is a
 *          time-series, so the line's vertices are real source samples; only
 *          the sampling stride is reduced, never in-filled.
 *
 * Clicking a marker calls the existing `selectPlatform(id, type)` action with
 * the real id; Step 31's observation panel resolves it back to the real record.
 *
 * Horizontal placement only: markers sit on the sea-surface plane (a small lift
 * clear of the swell), never at a fabricated depth.
 */

interface MarkersProps {
  region: OceanRegion
  /** From `state.layers.argo` / `state.layers.gliders`. */
  visible: boolean
}

const setCursor = (value: string) => () => {
  document.body.style.cursor = value
}

/**
 * Hand the real id to the shared observation selection. In development it is
 * also logged (like the D11 connection probe) so a marker click is traceable;
 * the log is stripped from production builds.
 */
function selectObservation(
  select: (id: string, type: 'argo' | 'glider') => void,
  id: string,
  type: 'argo' | 'glider',
): void {
  if (import.meta.env.DEV) {
    console.info(`[observation] selected real ${type} ${id}`)
  }
  select(id, type)
}

/* ------------------------------------------------------------------ *
 * Argo
 * ------------------------------------------------------------------ */

function ArgoMarkersImpl({ region, visible }: MarkersProps) {
  const data = useArgoObservations()
  const { selectPlatform } = useObservationControls()

  const markers = useMemo(
    () => (data.phase === 'success' ? argoMarkersFor(region, data.platforms) : []),
    [data.phase, data.platforms, region],
  )

  if (!visible || markers.length === 0) return null

  return (
    <group>
      {markers.map((m) => (
        <group
          key={m.id}
          position={m.position}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation()
            selectObservation(selectPlatform, m.id, 'argo')
          }}
          onPointerOver={setCursor('pointer')}
          onPointerOut={setCursor('')}
        >
          <mesh renderOrder={RENDER_ORDER.label + 1}>
            <sphereGeometry args={[ARGO_RADIUS * RIM_SCALE, 16, 12]} />
            <meshBasicMaterial color={MARKER_RIM} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh renderOrder={RENDER_ORDER.label + 2}>
            <sphereGeometry args={[ARGO_RADIUS, 16, 12]} />
            <meshBasicMaterial color={ARGO_COLOR} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/**
 * Step 49 — memoised. Props are a region ref and one boolean; the real Argo
 * data is read from context inside, so a context change still re-renders. This
 * only skips the re-renders driven by an unrelated `OceanScene` change (depth
 * drag, playback tick, other layer toggles).
 */
export const ArgoMarkers = memo(ArgoMarkersImpl)

/* ------------------------------------------------------------------ *
 * Gliders
 * ------------------------------------------------------------------ */

function GliderTrajectoriesImpl({ region, visible }: MarkersProps) {
  const data = useGliderObservations()

  if (!visible || data.phase !== 'success' || data.platforms.length === 0) return null

  return (
    <group>
      {data.platforms.map((p) => (
        <GliderTrajectory key={p.platform_id} deploymentId={p.platform_id} region={region} />
      ))}
    </group>
  )
}

/**
 * Step 49 — memoised. Props are a deployment-id string and a region ref; the
 * per-deployment detail fetch and the track geometry already live in a
 * self-contained hook and a `useMemo`, so once the parent list stops
 * re-rendering for unrelated reasons this component only re-renders when its
 * own fetch resolves.
 */
export const GliderTrajectories = memo(GliderTrajectoriesImpl)

interface GliderTrajectoryProps {
  deploymentId: string
  region: OceanRegion
}

const GliderTrajectory = memo(function GliderTrajectory({
  deploymentId,
  region,
}: GliderTrajectoryProps) {
  const { detail, phase } = useGliderDeployment(deploymentId)
  const { selectPlatform } = useObservationControls()

  const track = useMemo(() => {
    if (detail === null) return null
    const built = gliderTrackPositions(region, detail.samples)
    if (built === null) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(built.positions, 3))
    return { geometry, start: built.start }
  }, [detail, region])

  useEffect(() => {
    const geometry = track?.geometry
    return () => geometry?.dispose()
  }, [track])

  if (phase !== 'success' || track === null) return null

  return (
    <group
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        selectObservation(selectPlatform, deploymentId, 'glider')
      }}
      onPointerOver={setCursor('pointer')}
      onPointerOut={setCursor('')}
    >
      <lineSegments geometry={track.geometry} renderOrder={RENDER_ORDER.label + 2}>
        <lineBasicMaterial color={GLIDER_COLOR} toneMapped={false} depthWrite={false} />
      </lineSegments>
      <group position={track.start}>
        <mesh renderOrder={RENDER_ORDER.label + 1}>
          <octahedronGeometry args={[GLIDER_NODE_RADIUS * RIM_SCALE, 0]} />
          <meshBasicMaterial color={MARKER_RIM} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh renderOrder={RENDER_ORDER.label + 2}>
          <octahedronGeometry args={[GLIDER_NODE_RADIUS, 0]} />
          <meshBasicMaterial color={GLIDER_COLOR} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
})
