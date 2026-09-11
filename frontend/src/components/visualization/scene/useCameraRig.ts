import { useCallback, useEffect, useRef, type ComponentRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls } from '@react-three/drei'
import { MathUtils, Vector3 } from 'three'
import { CAMERA, homeCameraPosition, homeCameraTarget, homeDistance } from './sceneConfig'

/** The imperative controls object drei hands back through its ref. */
export type OrbitControlsHandle = ComponentRef<typeof OrbitControls>

/** A flight from wherever the camera is back to the default framing. */
interface Flight {
  elapsed: number
  fromPosition: Vector3
  fromTarget: Vector3
  toPosition: Vector3
  toTarget: Vector3
}

/* Scratch vectors. The rig runs every frame, so nothing in it allocates. */
const _position = new Vector3()
const _target = new Vector3()
const _pivot = new Vector3()
const _shift = new Vector3()

/** Ease in and out — a flight that starts and lands softly reads as a move. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2
}

/** Wheel delta in pixels, whatever unit the browser reported it in. */
function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * 400
  return event.deltaY
}

/**
 * Slides the view with the column as vertical exaggeration stretches it.
 *
 * The column grows downwards from a fixed surface, so its middle sinks as the
 * exaggeration rises. Moving the pivot *and* the eye by the same amount keeps
 * the water framed exactly as the reader left it — where snapping the pivot to
 * mid-depth would throw away their orbit every time the slider moved, and
 * leaving it alone would let a tenfold column grow straight out of the bottom
 * of the frame.
 */
function followColumn(
  controls: OrbitControlsHandle,
  height: number,
  pivotDepth: RefObject<number | null>,
  flight: Flight | null,
): void {
  const midDepth = -height / 2
  const shift = midDepth - (pivotDepth.current ?? midDepth)
  pivotDepth.current = midDepth

  if (shift === 0) return

  controls.object.position.y += shift
  controls.target.y += shift

  // A flight in progress started from a column that has since moved.
  if (flight !== null) {
    flight.fromPosition.y += shift
    flight.fromTarget.y += shift
  }
}

/**
 * Keeps the orbit pivot inside the domain.
 *
 * Panning is the one gesture that can lose the scene outright: rotation and
 * dolly both stay bound to the water, but a pan is free translation, and a
 * couple of seconds of it leaves the reader looking at empty fog with no cue
 * for the way back. The pivot is therefore tethered to a cylinder around the
 * column — loose enough to inspect any corner of the domain, never loose
 * enough to lose it.
 */
function clampPivot(controls: OrbitControlsHandle, height: number): void {
  const target = controls.target
  _pivot.copy(target)

  const radius = Math.hypot(target.x, target.z)
  if (radius > CAMERA.maxPivotRadius) {
    const scale = CAMERA.maxPivotRadius / radius
    target.x *= scale
    target.z *= scale
  }

  target.y = MathUtils.clamp(
    target.y,
    -height - CAMERA.maxPivotBelowFloor,
    CAMERA.maxPivotAboveSurface,
  )

  // Carry the eye with the pivot. Clamping the target on its own would leave
  // the camera behind and silently stretch the orbit distance, rather than
  // simply stopping the pan.
  _shift.subVectors(target, _pivot)
  if (_shift.lengthSq() > 0) controls.object.position.add(_shift)
}

/** Advances a flight and writes the eased pose onto the camera. */
function advanceFlight(
  controls: OrbitControlsHandle,
  flight: Flight,
  height: number,
  delta: number,
): void {
  flight.elapsed = Math.min(flight.elapsed + delta, CAMERA.flightSeconds)

  // Re-read the destination every frame: exaggeration can be dragged
  // mid-flight, and home is defined against the column as it currently stands.
  homeCameraPosition(height, flight.toPosition)
  homeCameraTarget(height, flight.toTarget)

  const t = ease(flight.elapsed / CAMERA.flightSeconds)
  controls.object.position.lerpVectors(flight.fromPosition, flight.toPosition, t)
  controls.target.lerpVectors(flight.fromTarget, flight.toTarget, t)
  controls.object.lookAt(controls.target)
}

/**
 * Eases the orbit distance towards the one the wheel asked for.
 *
 * OrbitControls applies its dolly in a single step per wheel event and resets
 * the scale on every update, so a mouse wheel arrives as a stack of discrete
 * jumps. Holding the requested distance separately and approaching it over a
 * few frames is what turns that into a glide — and it puts the zoom limits in
 * one place, since the request is clamped before the camera ever moves.
 */
function easeDolly(controls: OrbitControlsHandle, desired: number, rate: number): void {
  const camera = controls.object
  _shift.subVectors(camera.position, controls.target)

  const distance = _shift.length()
  if (distance === 0) return

  const next = distance + (desired - distance) * rate
  if (Math.abs(next - distance) < 1e-4) return

  camera.position.copy(controls.target).addScaledVector(_shift, next / distance)
}

/** True while the camera still holds the default framing for this column. */
function isAtHome(controls: OrbitControlsHandle, height: number): boolean {
  const epsilon = CAMERA.homeEpsilon * CAMERA.homeEpsilon

  const eyeOffset = homeCameraPosition(height, _position).distanceToSquared(
    controls.object.position,
  )
  const pivotOffset = homeCameraTarget(height, _target).distanceToSquared(controls.target)

  return eyeOffset < epsilon && pivotOffset < epsilon
}

interface CameraRigOptions {
  controlsRef: RefObject<OrbitControlsHandle | null>
  /** The column's current world height, written every frame by the volume. */
  columnHeightRef: RefObject<number>
  /** Bumped by the camera store each time a reset is requested. */
  resetRequest: number
  /** Called when the camera enters or leaves its default framing. */
  onAtHomeChange: (atHome: boolean) => void
  /** Cuts the flight and the dolly easing when the viewer asked for less motion. */
  reducedMotion: boolean
}

interface CameraRig {
  /** Hand to `<OrbitControls onStart>` so a gesture cancels a flight in progress. */
  onControlStart: () => void
}

/**
 * The viewport's camera behaviour, as one unit.
 *
 * OrbitControls supplies an orbit, a dolly and a pan. What makes a scene feel
 * like an instrument rather than a turntable is everything around them: a
 * framing derived from the domain instead of hard-coded, limits that keep the
 * subject in view, motion that eases instead of stepping, and a way back. That
 * is what this hook adds, and it adds it *around* the controls rather than in
 * place of them — every gesture is still theirs, and the rig only shapes the
 * result.
 *
 * It runs at the default frame priority, which puts it after drei's own
 * `controls.update()` at priority -1. That ordering is the whole trick: the
 * controls resolve the gesture first and the rig then corrects the pose they
 * produced, so a flight never fights the orbit and a clamped pan is simply a
 * pan that stopped.
 */
export function useCameraRig({
  controlsRef,
  columnHeightRef,
  resetRequest,
  onAtHomeChange,
  reducedMotion,
}: CameraRigOptions): CameraRig {
  const domElement = useThree((state) => state.gl.domElement)

  const flight = useRef<Flight | null>(null)
  /** Mid-depth of the column as of the previous frame. */
  const pivotDepth = useRef<number | null>(null)
  /** Orbit distance the wheel has asked for; null until the opening framing. */
  const desiredDistance = useRef<number | null>(null)
  const atHome = useRef(true)

  // Read from the frame loop rather than closed over, so that changing the
  // preference does not itself re-frame the camera.
  const instant = useRef(reducedMotion)
  useEffect(() => {
    instant.current = reducedMotion
  }, [reducedMotion])

  /** Puts the camera back on the default framing, flying or immediately. */
  const frameView = useCallback(
    (immediate: boolean) => {
      const controls = controlsRef.current
      if (controls === null) return

      const height = columnHeightRef.current
      desiredDistance.current = homeDistance(height)

      if (immediate) {
        flight.current = null
        controls.enableDamping = true
        controls.object.position.copy(homeCameraPosition(height, _position))
        controls.target.copy(homeCameraTarget(height, _target))
        controls.object.lookAt(controls.target)
        return
      }

      flight.current = {
        elapsed: 0,
        fromPosition: controls.object.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition: homeCameraPosition(height),
        toTarget: homeCameraTarget(height),
      }

      // Damping is momentum, and the controls are still carrying whatever the
      // last gesture left behind. Switching it off for the flight makes the
      // next `update()` spend that momentum in one invisible step — under a
      // pose the rig overwrites anyway — instead of nudging the camera all the
      // way home and past the point where the view still counts as reset.
      controls.enableDamping = false
    },
    [columnHeightRef, controlsRef],
  )

  /** Ends a flight, whether it landed or the viewer took over mid-air. */
  const endFlight = useCallback(() => {
    const controls = controlsRef.current
    if (controls === null) return

    flight.current = null
    controls.enableDamping = true
    // Adopt the distance actually reached, so the eased dolly does not drag
    // the camera on towards a destination the viewer has just abandoned.
    desiredDistance.current = controls.object.position.distanceTo(controls.target)
  }, [controlsRef])

  const onControlStart = useCallback(() => {
    if (flight.current !== null) endFlight()
  }, [endFlight])

  // A reset request, from the control panel or from the keyboard shortcut.
  useEffect(() => {
    // 0 is the store's initial value rather than a request; the opening
    // framing is done by the frame loop, once drei has bound the controls to
    // the scene's own camera.
    if (resetRequest === 0) return
    frameView(instant.current)
  }, [frameView, resetRequest])

  // The wheel is handled here rather than by OrbitControls so that the dolly
  // can be eased and clamped in one place. See `easeDolly`.
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const controls = controlsRef.current
      if (controls === null) return

      // The viewport owns the wheel: without this, a trackpad pinch — which
      // arrives as ctrl+wheel — zooms the whole page out from under the scene.
      event.preventDefault()

      if (flight.current !== null) endFlight()

      const current =
        desiredDistance.current ?? controls.object.position.distanceTo(controls.target)

      desiredDistance.current = MathUtils.clamp(
        current * Math.exp(wheelPixels(event) * CAMERA.zoomSensitivity),
        CAMERA.minDistance,
        CAMERA.maxDistance,
      )
    }

    domElement.addEventListener('wheel', onWheel, { passive: false })
    return () => domElement.removeEventListener('wheel', onWheel)
  }, [controlsRef, domElement, endFlight])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (controls === null) return

    const height = columnHeightRef.current

    // First frame. The opening framing happens here rather than in an effect
    // because drei rebuilds the controls when the scene's camera is made the
    // default, which lands after this component's effects have already run.
    if (desiredDistance.current === null) {
      frameView(true)
      pivotDepth.current = -height / 2
      return
    }

    followColumn(controls, height, pivotDepth, flight.current)

    if (flight.current !== null) {
      advanceFlight(controls, flight.current, height, delta)
      if (flight.current.elapsed >= CAMERA.flightSeconds) endFlight()
    } else {
      clampPivot(controls, height)
      easeDolly(
        controls,
        desiredDistance.current,
        instant.current ? 1 : Math.min(delta * CAMERA.zoomDamping, 1),
      )
    }

    const home = isAtHome(controls, height)
    if (home !== atHome.current) {
      atHome.current = home
      onAtHomeChange(home)
    }
  })

  return { onControlStart }
}
