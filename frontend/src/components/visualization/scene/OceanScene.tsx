import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { MOUSE, Vector3 } from 'three'
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion'
import { useCameraView, useCameraViewControls } from '../../../state/cameraViewState'
import { useCurrentData } from '../../../state/currentDataState'
import { useLocationState } from '../../../state/locationState'
import { useSalinityData } from '../../../state/salinityDataState'
import { useTemperatureData } from '../../../state/temperatureDataState'
import { useVisualizationState } from '../../../state/visualizationState'
import { CurrentField } from './CurrentField'
import { GeoContext } from './GeoContext'
import { ArgoMarkers, GliderTrajectories } from './ObservationMarkers'
import { OceanVolume } from './OceanVolume'
import { SceneAtmosphere } from './SceneAtmosphere'
import { SceneLighting } from './SceneLighting'
import {
  CAMERA,
  columnHeight,
  deepColor,
  depthFraction,
  homeCameraPosition,
  isSurfaceDepth,
  shallowColor,
} from './sceneConfig'
import { buildScalarFieldTexture, regionScalarRange } from './temperatureField'
import { useCameraRig, type OrbitControlsHandle } from './useCameraRig'

/**
 * Mouse bindings.
 *
 * Left rotates and both other buttons pan, which is OrbitControls' default
 * except for the middle button: its default is a drag-dolly, and the dolly now
 * belongs to the rig. Rebinding it to pan is better than leaving it dead —
 * and shift + left pans as well, which is what the viewport HUD advertises and
 * what OrbitControls already does for a modified rotate drag.
 */
const MOUSE_BUTTONS = {
  LEFT: MOUSE.ROTATE,
  MIDDLE: MOUSE.PAN,
  RIGHT: MOUSE.PAN,
} as const

/**
 * The ocean visualization scene.
 *
 * Self-contained: camera, controls, lighting and the ocean all live here, so a
 * host only has to supply a `<Canvas>`. It subscribes to the shared
 * visualization store directly — exactly as the Step 9 viewport predicted —
 * rather than taking the parameters as props, which keeps it a sibling reader
 * of the same state the control panel writes and the HUD displays.
 *
 * The division of labour is deliberate: this file owns the *view* and
 * translates store values into scene parameters, while `OceanVolume` owns the
 * *ocean* and knows nothing about where its numbers came from. The pieces of
 * the view that have their own reasoning live beside it rather than in it —
 * the camera's behaviour in `useCameraRig`, the light rig in `SceneLighting`,
 * the depth-driven haze in `SceneAtmosphere`, and the real grids' bridges into
 * the shaders (`temperatureField.ts`, `CurrentField.tsx`). What stays here is
 * the wiring: reading `activeRegion` and the loaded data stores to bake the
 * selected analysis scalar (temperature, D12 — or salinity, D13) into a texture
 * is the one piece of translation this file does that `OceanVolume` cannot,
 * because `OceanVolume` is never given the location or data stores to read. The
 * surface-current layer (D13) is a separate sibling — a vector field on its own
 * grid, never merged into the volumetric water.
 */
export function OceanScene() {
  const state = useVisualizationState()
  const { activeRegion } = useLocationState()
  const temperatureData = useTemperatureData()
  const salinityData = useSalinityData()
  const currentData = useCurrentData()
  const { resetRequest } = useCameraView()
  const { reportAtHome, resetView } = useCameraViewControls()
  const reducedMotion = usePrefersReducedMotion()

  const controlsRef = useRef<OrbitControlsHandle>(null)

  const shallow = useMemo(() => shallowColor(state.selectedVariable), [state.selectedVariable])
  const deep = useMemo(() => deepColor(state.selectedVariable), [state.selectedVariable])

  const slice = depthFraction(state.selectedDepth)

  /**
   * The real INCOIS analysis scalar grid — temperature (D12) or salinity (D13)
   * — baked into one small texture for the region and loaded time currently in
   * view. Both share the `incois_argo_10day_analysis` grid, depths and times,
   * so one bridge (`buildScalarFieldTexture`) serves both.
   *
   * Built here rather than in `OceanVolume` because it depends on state that
   * component does not otherwise need — `activeRegion`. Both fields are baked
   * whenever their D10 slices are loaded (not only while selected), so
   * switching variable shows data immediately. Each is `null` until its slices
   * have actually loaded: no mock stands in for them, so while the data loads
   * (or if it fails) the water simply shows its procedural colour, exactly as
   * every non-scalar variable does. Rebuilt only when the region or the loaded
   * time index changes — a few thousand grid lookups, once, on the CPU.
   */
  const temperatureReady =
    temperatureData.phase === 'success' &&
    temperatureData.slices.length > 0 &&
    temperatureData.min !== null &&
    temperatureData.max !== null

  const salinityReady =
    salinityData.phase === 'success' &&
    salinityData.slices.length > 0 &&
    salinityData.min !== null &&
    salinityData.max !== null

  const temperatureField = useMemo(
    () => (temperatureReady ? buildScalarFieldTexture(activeRegion, temperatureData) : null),
    [temperatureReady, activeRegion, temperatureData],
  )

  // Salinity is normalised against the range of the real cells in *this
  // region's* window (D25). Ocean salinity spans ~5 PSU globally but only
  // ~1 PSU across a coastal window, so the global min/max flattens a region
  // to one colour; the region range spreads its real structure across the
  // ramp. Temperature keeps the global range — its window already spans
  // nearly the whole dataset (warm surface to ~2 °C abyss), so it is
  // untouched. `null` → `buildScalarFieldTexture` falls back to the dataset
  // range on its own.
  const salinityRange = useMemo(
    () => (salinityReady ? regionScalarRange(activeRegion, salinityData) : null),
    [salinityReady, activeRegion, salinityData],
  )
  const salinityField = useMemo(
    () => (salinityReady ? buildScalarFieldTexture(activeRegion, salinityData, salinityRange) : null),
    [salinityReady, activeRegion, salinityData, salinityRange],
  )
  useEffect(() => {
    const texture = temperatureField?.texture
    return () => {
      texture?.dispose()
    }
  }, [temperatureField])
  useEffect(() => {
    const texture = salinityField?.texture
    return () => {
      texture?.dispose()
    }
  }, [salinityField])

  // The analysis scalar the volumetric water is currently drawing: temperature
  // by default, salinity when it is the selected variable. Currents never feed
  // this — they are a separate surface vector layer.
  const scalarField =
    state.selectedVariable === 'salinity' ? salinityField : temperatureField

  // 1 while an analysis scalar (temperature or salinity) is selected *and* its
  // real data is baked; 0 otherwise and while the data is still loading. Eased
  // in the shaders, so it crossfades rather than cuts.
  const analysisSelected =
    state.selectedVariable === 'temperature' || state.selectedVariable === 'salinity'
  const fieldMix = analysisSelected && scalarField !== null ? 1 : 0

  // Surface currents (D13): shown only while "Current" is selected. Surface-only
  // — drawn at 0 m regardless of the depth slider; a HUD note covers the case
  // where the reader has dragged below the surface.
  const showCurrents = state.selectedVariable === 'currentSpeed'

  /**
   * The column's height as the volume is currently drawing it — reported by
   * `OceanVolume` every frame, because the exaggeration eases in and the
   * camera has to follow the water rather than jump to its eventual size.
   */
  const columnHeightRef = useRef(columnHeight(state.verticalExaggeration))
  const trackColumnHeight = useCallback((height: number) => {
    columnHeightRef.current = height
  }, [])

  /**
   * Opening eye position, framed against the column the store starts with.
   *
   * The rig re-frames on its first frame regardless; this is what the very
   * first rendered frame is drawn from, so the scene never opens at the
   * default camera's origin and then slides into place.
   */
  const [startPosition] = useState(() =>
    homeCameraPosition(columnHeight(state.verticalExaggeration), new Vector3()),
  )

  const { onControlStart } = useCameraRig({
    controlsRef,
    columnHeightRef,
    resetRequest,
    onAtHomeChange: reportAtHome,
    reducedMotion,
  })

  /*
   * Arriving at a new region.
   *
   * The domain is always drawn at the origin, so navigating somewhere else
   * does not move the water — it re-points the geographic frame underneath it.
   * The camera flight is what makes that read as travel rather than as a
   * redraw, and the default framing is the right place to land: it is the view
   * that shows the whole volume, which is what a reader wants first at a place
   * they have not looked at before.
   */
  const framedRegion = useRef(activeRegion.id)
  useEffect(() => {
    if (framedRegion.current === activeRegion.id) return
    framedRegion.current = activeRegion.id
    resetView()
  }, [activeRegion.id, resetView])

  return (
    <>
      <SceneAtmosphere />

      <PerspectiveCamera
        makeDefault
        position={startPosition}
        fov={CAMERA.fov}
        near={CAMERA.near}
        far={CAMERA.far}
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        onStart={onControlStart}
        // Inertia on every gesture: the orbit and the pan glide to a stop
        // rather than ending on the frame the pointer was released.
        enableDamping
        dampingFactor={0.05}
        // Below 1 throughout — a scientific view is read by aiming it, and a
        // one-to-one gesture overshoots whatever the reader was aiming at.
        rotateSpeed={0.55}
        panSpeed={0.6}
        // The dolly is the rig's: OrbitControls steps it, the rig eases it.
        enableZoom={false}
        minDistance={CAMERA.minDistance}
        maxDistance={CAMERA.maxDistance}
        minPolarAngle={CAMERA.minPolarAngle}
        maxPolarAngle={CAMERA.maxPolarAngle}
        // Pan in the screen plane, so dragging up moves the water up whatever
        // the elevation — panning along the ground plane instead turns into a
        // slide across the sea floor as the camera approaches top-down.
        screenSpacePanning
        mouseButtons={MOUSE_BUTTONS}
      />

      <SceneLighting />

      <GeoContext region={activeRegion} animated={!reducedMotion} />

      <OceanVolume
        shallow={shallow}
        deep={deep}
        opacity={state.opacity}
        depth={slice}
        exaggeration={state.verticalExaggeration}
        showField={state.layers.model}
        showBathymetry={state.layers.bathymetry}
        animated={!reducedMotion}
        temperatureField={scalarField}
        fieldMix={fieldMix}
        onColumnHeight={trackColumnHeight}
      />

      {/* D13 surface-current vectors — INCOIS IO-HOOFS forecast, its own
          421 × 601 grid, drawn at the surface only. Hidden unless "Current"
          is the selected variable. */}
      <CurrentField
        region={activeRegion}
        data={currentData}
        visible={showCurrents && state.layers.model}
        atSurface={isSurfaceDepth(state.selectedDepth)}
      />

      {/* Step 30 real in-situ observation markers — one sphere per real Argo
          profile, the real (decimated) track per real glider deployment. Their
          positions come from the Steps 28–29 providers' real lat/lon; the
          "Argo Floats" / "Gliders" layer toggles gate them. Markers whose real
          coordinates fall outside the current region window sit beyond the
          water box — never repositioned to force them into view. */}
      <ArgoMarkers region={activeRegion} visible={state.layers.argo} />
      <GliderTrajectories region={activeRegion} visible={state.layers.gliders} />
    </>
  )
}
